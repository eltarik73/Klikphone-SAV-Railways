"""
Envoi de vrais SMS transactionnels via l'API Brevo.

La clé API vient uniquement de la variable d'environnement BREVO_API_KEY : jamais
en base, jamais renvoyée par une route, jamais écrite dans un log ni dans un
message d'erreur (les erreurs httpx ne sont pas recopiées).

Paramètres boutique (table params) :
  SMS_BREVO_ACTIF  « 1 » pour envoyer depuis le serveur (sinon lien sms: côté poste)
  SMS_SENDER       expéditeur alphanumérique (11 caractères max, défaut KLIKPHONE)

Appels réseau synchrones à délai court : routes en def uniquement (threadpool).
"""

import hashlib
import math
import os
import re
import threading
import time
from dataclasses import dataclass
from typing import Optional

import httpx

from app.services import params as params_cache
from app.services.search import phone_canonical

BREVO_SMS_URL = "https://api.brevo.com/v3/transactionalSMS/send"
BREVO_ACCOUNT_URL = "https://api.brevo.com/v3/account"
# Railway coupe une requête HTTP vers ~15 s : l'envoi doit répondre bien avant
TIMEOUT = httpx.Timeout(8.0, connect=3.0)

PARAM_ACTIF = "SMS_BREVO_ACTIF"
PARAM_EXPEDITEUR = "SMS_SENDER"
EXPEDITEUR_DEFAUT = "KLIKPHONE"
MAX_CARACTERES = 1000
DELAI_DOUBLON = 60
TAG = "klikphone-sav"


def cle_api() -> str:
    return (os.environ.get("BREVO_API_KEY") or "").strip()


# ─── EXPÉDITEUR ─────────────────────────────────────────────────

_EXP_ALPHA = re.compile(r"[A-Za-z0-9]{1,11}")
_EXP_NUM = re.compile(r"\d{1,15}")


def expediteur_valide(valeur) -> bool:
    """11 lettres/chiffres (au moins une lettre) ou 15 chiffres : règle Brevo."""
    v = str(valeur or "")
    if _EXP_NUM.fullmatch(v):
        return True
    return bool(_EXP_ALPHA.fullmatch(v)) and any(c.isalpha() for c in v)


def expediteur(cur=None) -> str:
    v = params_cache.get_param(PARAM_EXPEDITEUR, "", cur=cur).strip()
    return v if expediteur_valide(v) else EXPEDITEUR_DEFAUT


def etat(cur=None) -> dict:
    """État de l'envoi serveur, sans jamais la clé."""
    configuree = bool(cle_api())
    active = params_cache.get_param(PARAM_ACTIF, "0", cur=cur).strip() == "1"
    return {
        "cle_configuree": configuree,
        "active": active,
        "disponible": configuree and active,
        "expediteur": expediteur(cur),
    }


# ─── NUMÉRO ─────────────────────────────────────────────────────

def numero_international(tel) -> Optional[str]:
    """Format Brevo (indicatif sans « + » : 33612345678), None si le numéro est inexploitable."""
    c = phone_canonical(tel)
    if not c:
        return None
    if re.fullmatch(r"0[1-9]\d{8}", c):
        return "33" + c[1:]
    if re.fullmatch(r"\+\d{8,15}", c):
        return c[1:]
    return None


def est_mobile_fr(numero: str) -> bool:
    return bool(re.fullmatch(r"33[67]\d{8}", numero or ""))


def numero_affiche(numero: str) -> str:
    """06 12 34 56 78 pour la France, +41791234567 sinon."""
    if re.fullmatch(r"33\d{9}", numero or ""):
        n = "0" + numero[2:]
        return " ".join(n[i:i + 2] for i in range(0, 10, 2))
    return "+" + (numero or "")


# ─── TEXTE ──────────────────────────────────────────────────────

# Ponctuation typographique ramenée à l'ASCII : un seul « ’ » ferait passer
# tout le SMS en Unicode (70 caractères par SMS au lieu de 160).
_TYPO = str.maketrans({
    "’": "'", "‘": "'", "ʼ": "'", "“": '"', "”": '"', "«": '"', "»": '"',
    "–": "-", "—": "-", "‑": "-", "…": "...",
    " ": " ", " ": " ", " ": " ", "\r": None,
})

# Alphabet GSM 03.38 : jeu de base (1 caractère) et extension (2 caractères)
GSM_BASE = frozenset(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?"
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
)
GSM_EXT = frozenset("^{}\\[~]|€\f")


def normaliser_texte(texte) -> str:
    return str(texte or "").translate(_TYPO).strip()


def est_gsm(texte: str) -> bool:
    return all(c in GSM_BASE or c in GSM_EXT for c in texte)


def segments(texte: str) -> int:
    """Nombre de SMS facturés (miroir de smsSegments côté front)."""
    if not texte:
        return 0
    if est_gsm(texte):
        n = sum(2 if c in GSM_EXT else 1 for c in texte)
        return 1 if n <= 160 else math.ceil(n / 153)
    # UCS-2 : un emoji compte pour deux unités
    n = len(texte.encode("utf-16-le")) // 2
    return 1 if n <= 70 else math.ceil(n / 67)


# ─── ANTI DOUBLE ENVOI ──────────────────────────────────────────

class AntiDoublon:
    """Même texte au même numéro : un seul envoi par fenêtre de `delai` secondes.

    La place est réservée AVANT l'appel Brevo (deux clics simultanés ne partent
    pas deux fois) et rendue si l'envoi a certainement échoué. Seule une
    empreinte est gardée en mémoire, jamais le numéro ni le texte.
    """

    def __init__(self, delai: int = DELAI_DOUBLON):
        self.delai = delai
        self._verrou = threading.Lock()
        self._envois = {}

    @staticmethod
    def cle(numero: str, texte: str) -> str:
        return hashlib.sha256(f"{numero}\x00{texte}".encode("utf-8")).hexdigest()

    def reserver(self, cle: str) -> Optional[float]:
        """None si la place est prise par cet appel, sinon secondes depuis l'envoi précédent."""
        now = time.monotonic()
        with self._verrou:
            for k in [k for k, t in self._envois.items() if now - t >= self.delai]:
                del self._envois[k]
            precedent = self._envois.get(cle)
            if precedent is not None:
                return now - precedent
            self._envois[cle] = now
            return None

    def liberer(self, cle: str):
        with self._verrou:
            self._envois.pop(cle, None)

    def vider(self):
        with self._verrou:
            self._envois.clear()


ANTI_DOUBLON = AntiDoublon()


# ─── APPELS BREVO ───────────────────────────────────────────────

@dataclass
class ResultatEnvoi:
    ok: bool
    message_id: Optional[str] = None
    code: str = ""
    erreur: str = ""
    # Délai dépassé : Brevo a pu envoyer le SMS, on ne libère pas l'anti-doublon
    incertain: bool = False


def _entetes(cle: str) -> dict:
    return {"api-key": cle, "accept": "application/json", "content-type": "application/json"}


def _detail_brevo(resp) -> tuple:
    try:
        body = resp.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    code = str(body.get("code") or "")
    message = str(body.get("message") or "")[:200]
    return code, message


def _erreur_brevo(resp) -> ResultatEnvoi:
    code, message = _detail_brevo(resp)
    bas = f"{code} {message}".lower()
    s = resp.status_code
    if "credit" in bas or s == 402:
        return ResultatEnvoi(False, code="credits_epuises",
                             erreur="Crédits SMS Brevo épuisés : rechargez le compte Brevo")
    if s == 401 and re.search(r"\bip\b", bas):
        return ResultatEnvoi(False, code="ip_non_autorisee",
                             erreur="Brevo bloque l'adresse IP du serveur : autorisez-la ou désactivez "
                                    "le blocage des IP dans Brevo (Sécurité > IP autorisées)")
    if s in (401, 403):
        return ResultatEnvoi(False, code="cle_refusee",
                             erreur="Clé API Brevo refusée (invalide ou désactivée) : créez-en une nouvelle "
                                    "et mettez à jour BREVO_API_KEY")
    if s == 429:
        return ResultatEnvoi(False, code="trop_de_requetes",
                             erreur="Brevo limite les envois : réessayez dans un instant")
    if s >= 500:
        return ResultatEnvoi(False, code="brevo_indisponible",
                             erreur=f"Brevo est indisponible (erreur {s}), réessayez plus tard")
    detail = f" : {message}" if message else ""
    return ResultatEnvoi(False, code="refus_brevo", erreur=f"Brevo a refusé le SMS{detail}")


def envoyer(numero: str, texte: str, tags=None, cur=None) -> ResultatEnvoi:
    """Envoie un SMS transactionnel. `numero` au format international sans « + »."""
    cle = cle_api()
    if not cle:
        return ResultatEnvoi(False, code="sms_non_configure", erreur="Clé API Brevo absente du serveur")
    corps = {
        "sender": expediteur(cur),
        "recipient": numero,
        "content": texte,
        "type": "transactional",
        "tag": [TAG, *[t for t in (tags or []) if t]][:10],
        "unicodeEnabled": not est_gsm(texte),
    }
    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            resp = client.post(BREVO_SMS_URL, json=corps, headers=_entetes(cle))
    except httpx.TimeoutException:
        return ResultatEnvoi(False, code="delai_depasse", incertain=True,
                             erreur="Brevo n'a pas répondu à temps : le SMS a pu partir, "
                                    "vérifiez dans Brevo avant de le renvoyer")
    except httpx.HTTPError:
        return ResultatEnvoi(False, code="brevo_injoignable",
                             erreur="Brevo est injoignable depuis le serveur, réessayez plus tard")
    if resp.status_code in (200, 201, 202):
        try:
            body = resp.json()
        except Exception:
            body = {}
        mid = body.get("messageId") if isinstance(body, dict) else None
        return ResultatEnvoi(True, message_id=str(mid) if mid is not None else None)
    return _erreur_brevo(resp)


def credits() -> dict:
    """Solde de crédits SMS du compte Brevo (plan de type « sms »)."""
    cle = cle_api()
    if not cle:
        return {"ok": False, "code": "sms_non_configure", "erreur": "Clé API Brevo absente du serveur"}
    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            resp = client.get(BREVO_ACCOUNT_URL, headers=_entetes(cle))
    except httpx.HTTPError:
        return {"ok": False, "code": "brevo_injoignable", "erreur": "Brevo est injoignable depuis le serveur"}
    if resp.status_code != 200:
        r = _erreur_brevo(resp)
        return {"ok": False, "code": r.code, "erreur": r.erreur}
    try:
        body = resp.json()
    except Exception:
        body = {}
    plans = body.get("plan") if isinstance(body, dict) else None
    sms = [p for p in (plans or []) if isinstance(p, dict) and p.get("type") == "sms"]
    if not sms:
        return {"ok": True, "credits": 0.0}
    try:
        total = sum(float(p.get("credits") or 0) for p in sms)
    except (TypeError, ValueError):
        total = None
    return {"ok": True, "credits": total}
