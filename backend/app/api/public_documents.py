"""
Documents client accessibles sans connexion, par le jeton aléatoire
tickets.suivi_token (liens envoyés par WhatsApp, SMS ou e-mail).

Seuls le ticket de dépôt, le devis et le reçu sont exposés : jamais la fiche
atelier (PIN, schéma, notes internes) ni le document combiné.
"""

import os
import re
import secrets
import threading
from collections import OrderedDict, deque
from datetime import datetime, timedelta, timezone
from time import time
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request

from app.database import get_cursor
from app.api.auth import client_ip, en_production
from app.api.print_tickets import (
    _get_frontend_url, _get_ticket_by_token, html_document, pdf_response, pdf_ticket, render_html,
)
from app.services import params as params_cache

router = APIRouter(prefix="/api/public/documents", tags=["documents-publics"])

TYPES_HTML = ("client", "devis", "recu")
TYPES_PDF = ("devis", "recu")
_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")

_HOTE_RE = re.compile(r"^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9A-Fa-f:]+\])(?::\d{1,5})?$")

# ─── Jeton de suivi expirable ─────────────────────────────────────
# Le jeton du QR / des liens envoyés ouvre le dossier sans autre preuve. Dossier rendu ou
# clôturé depuis plus de SUIVI_JETON_JOURS jours (param, défaut 180) : le jeton ne vaut plus
# (lien_invalide / 404) ; le numéro complet donné au dépôt reste accepté sans limite.
SUIVI_JETON_JOURS_DEFAUT = 180
STATUTS_JETON_EXPIRABLE = ("Clôturé", "Rendu au client")
_DATE_ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}")


def suivi_jeton_jours() -> int:
    """Durée de validité du jeton après restitution/clôture (param SUIVI_JETON_JOURS)."""
    try:
        v = int(str(params_cache.get_param("SUIVI_JETON_JOURS", str(SUIVI_JETON_JOURS_DEFAUT))).strip())
    except (TypeError, ValueError):
        return SUIVI_JETON_JOURS_DEFAUT
    except Exception:
        return SUIVI_JETON_JOURS_DEFAUT
    return v if v > 0 else SUIVI_JETON_JOURS_DEFAUT


def jeton_perime(statut, date_maj=None, date_cloture=None, date_rendu=None, jours: int = None,
                 maintenant: datetime = None) -> bool:
    """Vrai si le jeton de ce ticket ne vaut plus : statut rendu/clôturé et dernière
    modification plus ancienne que `jours`. date_maj est un TIMESTAMP (UTC naïf) ;
    date_cloture et date_rendu sont du TEXTE 'AAAA-MM-JJ HH:MM:SS', comparés comme
    chaînes (cf. CLAUDE.md). La plus récente des trois dates fait foi."""
    if (statut or "") not in STATUTS_JETON_EXPIRABLE:
        return False
    jours = suivi_jeton_jours() if jours is None else jours
    maintenant = maintenant or datetime.now(timezone.utc).replace(tzinfo=None)
    seuil = maintenant - timedelta(days=jours)
    seuil_texte = seuil.strftime("%Y-%m-%d %H:%M:%S")
    references = []
    if isinstance(date_maj, datetime):
        references.append(date_maj.replace(tzinfo=None) < seuil)
    for texte in (date_cloture, date_rendu):
        texte = str(texte or "").strip()
        if _DATE_ISO_RE.match(texte):
            references.append(texte[:19] < seuil_texte)
    if not references:
        return False       # aucune date lisible : le jeton reste valable
    return all(references)


# Clé réservée du compteur global (toutes IP confondues) dans le même dictionnaire que les
# compteurs par IP : « _buckets.clear() » (tests) remet aussi le plafond global à zéro.
CLE_GLOBALE = "*"
MESSAGE_DEBIT = "Trop de requêtes — attendez 1 minute avant de réessayer."
MESSAGE_PLAFOND = "Service momentanément saturé : réessayez dans quelques minutes."


def ips_magasin() -> frozenset:
    """Adresses IP des postes du magasin : variable KP_IP_MAGASIN (adresses séparées par des
    virgules, posée sur Railway). Liste STATIQUE, distincte des « IP connues » dynamiques
    (auth._IP_CONNUES) qui ne valent plus d'exemption sur la voie anonyme."""
    brut = os.environ.get("KP_IP_MAGASIN", "") or ""
    return frozenset(x.strip() for x in brut.split(",") if x.strip())


def ip_magasin(ip) -> bool:
    """Vrai pour une IP du magasin (KP_IP_MAGASIN) : exemptée du seul plafond GLOBAL des
    limiteurs — jamais du quota par IP — pour qu'une saturation venue d'ailleurs (adresses
    multiples qui épuisent le plafond) ne bloque pas la borne du magasin."""
    ip = str(ip or "").strip()
    return bool(ip) and ip in ips_magasin()


class LimiteurDebit:
    """Fenêtre glissante par IP, mémoire bornée, sûre en threadpool (routes en def).

    `limite_globale` (par `fenetre_globale` secondes, défaut 1 h) plafonne le point d'entrée
    toutes IP confondues, en plus du quota par IP : une attaque répartie (ou un proxy qui
    masque les IP) ne multiplie pas le quota. Mono-worker uvicorn : la mémoire suffit.
    Messages des 429 : `message` (quota de l'IP) et `message_global` (plafond atteint).

    Deux usages :
      - `verifier(cle)` : quota de l'IP et plafond global comptés ensemble, à l'entrée (routes
        de lecture : preuve du suivi, documents publics) ;
      - `verifier_ip(cle)` à l'entrée (toute tentative), puis `compter_global(cle)` une fois la
        requête VALIDÉE (référence client vérifiée, preuve du suivi passée, nom et numéro
        valides) : seules les créations plausibles consomment le plafond global, des 422/403
        en rafale ne peuvent pas l'épuiser pour bloquer la borne du magasin.
    Une IP du magasin (KP_IP_MAGASIN) est exemptée du plafond global, jamais du quota par IP.
    """

    def __init__(self, limite: int, fenetre: float, max_ips: int = 5000,
                 limite_globale: int = None, fenetre_globale: float = 3600,
                 message: str = None, message_global: str = None):
        self.limite = limite
        self.fenetre = fenetre
        self.max_ips = max_ips
        self.limite_globale = limite_globale
        self.fenetre_globale = fenetre_globale
        self.message = message or MESSAGE_DEBIT
        self.message_global = message_global or MESSAGE_PLAFOND
        self._buckets: "OrderedDict[str, deque]" = OrderedDict()
        self._verrou = threading.Lock()

    @staticmethod
    def _purger(bucket: deque, now: float, fenetre: float):
        while bucket and now - bucket[0] > fenetre:
            bucket.popleft()

    def _verifier_global(self, now: float, cle: str = None) -> bool:
        """Compte l'appel dans le plafond global ; vrai s'il le dépasse (rien n'est compté alors).
        Une IP du magasin (KP_IP_MAGASIN) n'est ni comptée ni refusée."""
        if not self.limite_globale or ip_magasin(cle):
            return False
        bucket = self._buckets.pop(CLE_GLOBALE, None) or deque()
        self._purger(bucket, now, self.fenetre_globale)
        refuse = len(bucket) >= self.limite_globale
        if not refuse:
            bucket.append(now)
        # Toujours en fin : jamais la plus ancienne, donc jamais purgée comme une IP inactive
        self._buckets[CLE_GLOBALE] = bucket
        return refuse

    def compter_global(self, cle: str = None):
        """Plafond global pour une requête déjà validée (après `verifier_ip`) : 429 `message_global`
        s'il est atteint, sinon la compte. Sans plafond, ou pour une IP du magasin : rien."""
        if not self.limite_globale:
            return
        with self._verrou:
            refuse = self._verifier_global(time(), cle)
        if refuse:
            raise HTTPException(429, self.message_global, headers={"Retry-After": "300"})

    def verifier_ip(self, cle: str):
        """Quota de l'IP seul (toute tentative, avant validation) ; le plafond global se compte
        ensuite avec `compter_global`."""
        self._verifier(cle, global_=False)

    def verifier(self, cle: str):
        """Quota de l'IP et plafond global, comptés ensemble à l'entrée."""
        self._verifier(cle, global_=True)

    def _verifier(self, cle: str, global_: bool):
        now = time()
        with self._verrou:
            bucket = self._buckets.pop(cle, None) or deque()
            self._purger(bucket, now, self.fenetre)
            refuse = len(bucket) >= self.limite
            refuse_global = False
            if not refuse:
                if global_:
                    refuse_global = self._verifier_global(now, cle)
                if not refuse_global:
                    bucket.append(now)
            # Réinsérée en fin : l'ordre du dict suit le dernier accès, la purge part du début
            self._buckets[cle] = bucket
            if CLE_GLOBALE in self._buckets:
                self._buckets.move_to_end(CLE_GLOBALE)
            while self._buckets:
                plus_ancienne_cle, plus_ancienne = next(iter(self._buckets.items()))
                if plus_ancienne_cle == CLE_GLOBALE:
                    break
                if (len(self._buckets) > self.max_ips or not plus_ancienne
                        or now - plus_ancienne[-1] > self.fenetre):
                    self._buckets.popitem(last=False)
                else:
                    break
        if refuse:
            raise HTTPException(429, self.message, headers={"Retry-After": str(int(self.fenetre) or 1)})
        if refuse_global:
            raise HTTPException(429, self.message_global, headers={"Retry-After": "300"})

    def reinitialiser(self):
        with self._verrou:
            self._buckets.clear()

    def __len__(self):
        return len(self._buckets) - (1 if CLE_GLOBALE in self._buckets else 0)


_LIMITEUR = LimiteurDebit(limite=30, fenetre=60)


def _rate_limit(request: Request):
    _LIMITEUR.verifier(client_ip(request))


def _ticket_par_jeton(token: str) -> dict:
    # Même réponse pour un jeton mal formé, inconnu ou périmé (dossier rendu/clôturé depuis
    # plus de SUIVI_JETON_JOURS jours) : pas d'indice à l'énumération
    t = _get_ticket_by_token(token) if _TOKEN_RE.match(token or "") else None
    if t and jeton_perime(t.get("statut"), t.get("date_maj"), t.get("date_cloture"), t.get("date_rendu")):
        t = None
    if not t:
        raise HTTPException(404, "Document introuvable")
    return t


def nouveau_jeton() -> str:
    return secrets.token_urlsafe(16)


def jeton_suivi(ticket_id: int):
    """Jeton du ticket, créé à la volée pour les tickets qui n'en ont pas encore.

    Jamais recréé pour le ticket d'un client anonymisé (RGPD : suivi_token = NULL)."""
    with get_cursor() as cur:
        cur.execute("SELECT suivi_token FROM tickets WHERE id = %s", (ticket_id,))
        row = cur.fetchone()
        if not row:
            return None
        if row["suivi_token"]:
            return row["suivi_token"]
        cur.execute(
            """UPDATE tickets t SET suivi_token = %s
               WHERE t.id = %s AND t.suivi_token IS NULL
                 AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = t.client_id AND c.anonymise_le IS NOT NULL)
               RETURNING t.suivi_token""",
            (nouveau_jeton(), ticket_id),
        )
        row = cur.fetchone()
        if row:
            return row["suivi_token"]
        cur.execute("SELECT suivi_token FROM tickets WHERE id = %s", (ticket_id,))
        row = cur.fetchone()
        return row["suivi_token"] if row else None


# ─── Origine des liens de partage ─────────────────────────────────
# X-Forwarded-Host / X-Forwarded-Proto (et Host) viennent de la requête : un lien envoyé au
# client ne doit jamais pointer vers un hôte forgé. Seuls les hôtes du projet, en
# correspondance EXACTE, sont acceptés : BACKEND_URL, FRONTEND_URL, URL_SUIVI, le domaine
# Railway du service (RAILWAY_PUBLIC_DOMAIN, RAILWAY_STATIC_URL) et KP_HOTES_SUPPLEMENTAIRES
# (liste séparée par des virgules, ex. un environnement de recette). Aucune déclinaison par
# préfixe *.up.railway.app : ces sous-domaines vont au premier demandeur. Les hôtes locaux ne
# sont acceptés qu'hors production. Sinon _get_frontend_url(). BACKEND_URL posée
# court-circuite tout (cf. _base_publique) : la poser sur Railway clôt le sujet.
_HOTES_LOCAUX = ("localhost", "127.0.0.1", "[::1]")


def _hote_de(url: str) -> str:
    url = (url or "").strip()
    if not url:
        return ""
    if "://" not in url:
        url = "https://" + url
    try:
        return (urlsplit(url).netloc or "").strip().lower()
    except ValueError:
        return ""


def _sans_port(hote: str) -> str:
    if hote.startswith("["):
        return hote.split("]")[0] + "]"
    return hote.split(":")[0]


def _hotes_autorises() -> set:
    valeurs = [os.getenv("BACKEND_URL", ""), os.getenv("FRONTEND_URL", ""), _get_frontend_url(),
               os.getenv("RAILWAY_PUBLIC_DOMAIN", ""), os.getenv("RAILWAY_STATIC_URL", "")]
    valeurs += os.getenv("KP_HOTES_SUPPLEMENTAIRES", "").split(",")
    hotes = set()
    for valeur in valeurs:
        h = _hote_de(valeur)
        if h:
            hotes.add(h)
    return hotes


def hote_autorise(hote: str) -> bool:
    """Correspondance exacte (avec ou sans port) avec un hôte du projet ; hôte local hors production."""
    hote = (hote or "").strip().lower()
    if not hote or not _HOTE_RE.match(hote):
        return False
    nu = _sans_port(hote)
    autorises = _hotes_autorises()
    if hote in autorises or nu in {_sans_port(h) for h in autorises}:
        return True
    return nu in _HOTES_LOCAUX and not en_production()


def _origine_requete(request: Request):
    """Origine vue par l'équipe (même domaine que le front, qui sert /api), si l'hôte
    annoncé (X-Forwarded-Host, sinon Host) est un hôte du projet ; None sinon."""
    proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower() or request.url.scheme
    hote = request.headers.get("x-forwarded-host", "").split(",")[0].strip() or request.headers.get("host", "")
    if proto in ("http", "https") and hote_autorise(hote):
        return f"{proto}://{hote}"
    return None


def _base_publique(request: Request = None) -> str:
    """Origine publique du backend : BACKEND_URL, sinon celle de la requête, sinon URL_SUIVI."""
    env = os.getenv("BACKEND_URL", "").strip()
    if env.startswith("http"):
        return env.rstrip("/")
    origine = _origine_requete(request) if request is not None else None
    return origine or _get_frontend_url()


def liens_partage(token: str, request: Request = None) -> dict:
    base = f"{_base_publique(request)}/api/public/documents/{token}"
    return {
        "client": f"{base}/client",
        "devis": f"{base}/devis",
        "recu": f"{base}/recu",
        "devis_pdf": f"{base}/devis.pdf",
        "recu_pdf": f"{base}/recu.pdf",
    }


# Déclarée avant la route HTML, qui capturerait sinon « devis.pdf »
@router.get("/{token}/{doc_type}.pdf")
def document_public_pdf(token: str, doc_type: str, request: Request):
    _rate_limit(request)
    if doc_type not in TYPES_PDF:
        raise HTTPException(404, "Document introuvable")
    t = _ticket_par_jeton(token)
    pdf_bytes, filename = pdf_ticket(t, doc_type)
    return pdf_response(pdf_bytes, filename)


@router.get("/{token}/{doc_type}")
def document_public(token: str, doc_type: str, request: Request):
    _rate_limit(request)
    if doc_type not in TYPES_HTML:
        raise HTTPException(404, "Document introuvable")
    t = _ticket_par_jeton(token)
    return html_document(render_html(t, doc_type))
