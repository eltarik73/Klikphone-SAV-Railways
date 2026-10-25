"""
Authentification par PIN + JWT tokens.
Compatible avec le système de PIN existant (params: PIN_ACCUEIL, PIN_TECH).

Élévation admin : POST /api/admin/verify renvoie un jeton court (10 min) à
présenter dans l'en-tête X-Admin-Token pour les actions sensibles
(dépendance require_admin).
"""

import hashlib
import hmac
import os
import secrets
import threading
from collections import OrderedDict, deque
from datetime import datetime, timedelta, timezone
from time import monotonic, time as horloge
from typing import Any, Optional

import psycopg2
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.database import get_cursor
from app.services import params as params_cache
from app.services import presence
from app.models import LoginRequest, TokenResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])
security = HTTPBearer(auto_error=False)

_JWT_SECRET_DEV = "klikphone-secret-change-me-in-prod"
_VARIABLES_RAILWAY = ("RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_PROJECT_ID",
                      "RAILWAY_PUBLIC_DOMAIN", "RAILWAY_STATIC_URL")


def en_production() -> bool:
    """Vrai sur Railway (une variable RAILWAY_* est posée) : secret obligatoire, proxy devant
    l'application (cf. verifier_reglage_proxy), hôtes locaux refusés dans les liens de partage."""
    return any(os.getenv(v) for v in _VARIABLES_RAILWAY)


def _jwt_secret() -> str:
    """JWT_SECRET ; en production, jamais la valeur connue du dépôt.

    Sans variable sur Railway, un secret aléatoire propre au processus évite
    de signer des jetons forgeables (session et élévation admin) : les
    sessions sont alors perdues à chaque redémarrage, ce qui se remarque.
    """
    valeur = os.getenv("JWT_SECRET", "")
    if valeur and valeur != _JWT_SECRET_DEV:
        return valeur
    if en_production():
        print("[auth] ERREUR : JWT_SECRET absent ou par défaut en production. Secret aléatoire "
              "utilisé (sessions perdues au redémarrage) : définir JWT_SECRET sur Railway.")
        return secrets.token_urlsafe(48)
    return valeur or _JWT_SECRET_DEV


JWT_SECRET = _jwt_secret()
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 30
ADMIN_TOKEN_MINUTES = 10
_ADMIN_TYP = "admin_elevation"


# ─── Partie admin réservée à des membres nommés ──────────────────
# ADMIN_MEMBRES (params, noms séparés par des virgules) : seuls ces membres voient la partie admin et
# peuvent saisir le code admin. Vide : tout membre au rôle « admin » (comportement d'origine).
PARAM_ADMIN_MEMBRES = "ADMIN_MEMBRES"


def _cle_nom(nom) -> str:
    return " ".join(str(nom or "").split()).casefold()


def admin_autorise(nom, role=None) -> bool:
    liste = [_cle_nom(n) for n in params_cache.get_param(PARAM_ADMIN_MEMBRES, "").split(",") if n.strip()]
    if liste:
        return _cle_nom(nom) in liste
    return role == "admin"


# ─── Génération des sessions : « déconnecter tout le monde » ─────
# SESSIONS_GENERATION (params) : chaque jeton porte la génération en vigueur à sa création (claim
# gen) ; la changer refuse tous les jetons émis avant. Absente : aucun contrôle (jetons d'origine).
PARAM_GENERATION = "SESSIONS_GENERATION"


def generation_sessions() -> Optional[str]:
    return params_cache.get_param(PARAM_GENERATION, "").strip() or None


def create_token(target: str, utilisateur: str, sid: Optional[str] = None, cx: Optional[int] = None) -> str:
    """Crée un JWT token.

    `sid` : lignée de session du poste, nouvelle à chaque connexion par PIN et
    transmise par switch-user (preuve du code admin, cf. exiger_role_admin).
    `cx` : ligne du journal des connexions (connexions_equipe.id) de cette session.
    `gen` : génération des sessions en vigueur (cf. deconnecter_tout_le_monde).
    """
    expire = datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS)
    payload = {
        "sub": utilisateur,
        "target": target,
        "sid": sid or secrets.token_urlsafe(16),
        "exp": expire,
    }
    if isinstance(cx, int) and not isinstance(cx, bool):
        payload["cx"] = cx
    gen = generation_sessions()
    if gen:
        payload["gen"] = gen
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _sid_ancien(jeton: str) -> str:
    """Lignée d'un jeton émis avant les sid : dérivée du jeton lui-même."""
    return "h:" + hashlib.sha256(jeton.encode("utf-8")).hexdigest()[:32]


def decode_token(token: str) -> dict:
    """Décode et valide un JWT token."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        payload = None
    # Un jeton d'élévation n'ouvre pas de session : il accompagne le jeton normal
    if not payload or payload.get("typ") == _ADMIN_TYP:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalide ou expiré",
        )
    return payload


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    """Dépendance FastAPI pour vérifier l'authentification."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Non authentifié",
        )
    payload = decode_token(credentials.credentials)
    if not payload.get("sid"):
        payload["sid"] = _sid_ancien(credentials.credentials)
        payload["sid_ancien"] = True
    # Jeton d'une session close (déconnexion, changement d'utilisateur) : refusé
    if await run_in_threadpool(jeton_revoque, payload):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session terminée : reconnectez-vous.",
        )
    # Un poste qui présente un jeton valide est un poste de la boutique (cf. verrou global)
    _IP_CONNUES.noter(client_ip(request))
    # Activité de la session (journal des connexions), notée par le middleware après la réponse
    request.state.kp_user = payload
    return payload


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[dict]:
    """Auth optionnelle (pour les routes publiques qui bénéficient d'un contexte user).

    Un jeton de session close vaut absence de session : le visiteur est anonyme."""
    if credentials is None:
        return None
    try:
        payload = decode_token(credentials.credentials)
    except HTTPException:
        return None
    if await run_in_threadpool(jeton_revoque, payload):
        return None
    return payload


# ─── RÉVOCATION DES JETONS DE SESSION (journal des connexions) ───
# Le jeton dure 30 jours (tablettes du magasin) mais la déconnexion et le changement
# d'utilisateur ferment sa ligne connexions_equipe (claim « cx ») : un jeton dont la ligne
# est close est refusé. La lecture (indexée par cx et par sid) est gardée 30 s, comme le
# contrôle du rôle admin ; une ligne close ne se rouvre jamais, l'état « close » est gardé.
# Une ligne close « expiree » (12 h d'inactivité, cf. services/presence) n'est PAS une
# révocation : la session reprend sur une NOUVELLE ligne de la même lignée (sid, utilisateur),
# que le jeton ne connaît pas ; la déconnexion clôt alors cette ligne postérieure, d'où la
# décision sur la lignée (ligne cx OU ligne postérieure close hors « expiree »).
# Un jeton sans cx (émis avant le journal) reste accepté.
SESSION_CLOSE_CACHE_S = 30.0
_SESSIONS_CACHE_MAX = 1024
_sessions_closes: "OrderedDict[int, tuple]" = OrderedDict()   # cx → (close, expire monotonic)
_sessions_verrou = threading.Lock()
_MOTIFS_SANS_REVOCATION = ("expiree",)


def _cx(payload: dict) -> Optional[int]:
    cx = (payload or {}).get("cx")
    if isinstance(cx, int) and not isinstance(cx, bool):
        return cx
    return None


def _session_close_en_base(payload: dict, cx: int) -> bool:
    """Vrai si la session du jeton est finie : sa ligne (cx) OU une ligne postérieure de la même
    lignée (sid, utilisateur) est close par une déconnexion ou un changement d'utilisateur.

    Après 12 h sans activité la ligne cx est close « expiree » et l'activité reprend sur une
    nouvelle ligne (services/presence._reprendre, retention_connexions) ; la déconnexion ou le
    changement d'utilisateur clôt cette nouvelle ligne, jamais la ligne cx : décider sur la
    seule ligne cx laisserait un jeton de 30 jours survivre à toute déconnexion dès le
    lendemain d'une nuit d'inactivité."""
    sid, sub = str(payload.get("sid") or ""), str(payload.get("sub") or "")
    try:
        with get_cursor() as cur:
            cur.execute("""SELECT 1 AS close FROM connexions_equipe
                           WHERE (id = %s OR (sid = %s AND utilisateur = %s AND id > %s))
                             AND fin IS NOT NULL AND COALESCE(fin_motif, '') <> ALL(%s)
                           LIMIT 1""", (cx, sid, sub, cx, list(_MOTIFS_SANS_REVOCATION)))
            row = cur.fetchone()
    except Exception as e:
        # Journal indisponible : ne déconnecte pas toute la boutique
        print(f"[auth] journal des connexions illisible : {e}")
        return False
    return bool(row)


def jeton_revoque(payload: dict) -> bool:
    """Vrai si la session du jeton (claim cx, lignée sid + utilisateur) est close par une
    déconnexion ou un changement d'utilisateur, ou s'il date d'avant la dernière déconnexion
    générale (génération des sessions). Lecture mise en cache 30 s par cx."""
    gen = generation_sessions()
    if gen and payload.get("gen") != gen:
        return True
    cx = _cx(payload)
    if cx is None:
        return False
    maintenant = monotonic()
    with _sessions_verrou:
        etat = _sessions_closes.get(cx)
        if etat is not None:
            close, expire = etat
            if close or expire > maintenant:
                _sessions_closes.move_to_end(cx)
                return close
            _sessions_closes.pop(cx, None)
    close = _session_close_en_base(payload, cx)
    with _sessions_verrou:
        if len(_sessions_closes) >= _SESSIONS_CACHE_MAX:
            for k in [k for k, (c, e) in _sessions_closes.items() if not c and e <= maintenant]:
                del _sessions_closes[k]
            while len(_sessions_closes) >= _SESSIONS_CACHE_MAX:
                _sessions_closes.popitem(last=False)
        _sessions_closes[cx] = (close, maintenant + SESSION_CLOSE_CACHE_S)
    return close


def oublier_session(cx) -> None:
    """La ligne vient d'être close (déconnexion, changement) : le prochain contrôle relit la base."""
    if isinstance(cx, dict):
        cx = _cx(cx)
    if cx is None:
        return
    with _sessions_verrou:
        _sessions_closes.pop(cx, None)


def oublier_sessions() -> None:
    with _sessions_verrou:
        _sessions_closes.clear()


def _deconnecter(cur) -> str:
    gen = secrets.token_urlsafe(8)
    cur.execute("""INSERT INTO params (cle, valeur) VALUES (%s, %s)
                   ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur""", (PARAM_GENERATION, gen))
    cur.execute("""UPDATE connexions_equipe SET fin = GREATEST(derniere_activite, timezone('UTC', NOW())),
                          fin_motif = 'forcee'
                   WHERE fin IS NULL""")
    cur.execute("DELETE FROM sessions_admin")
    return gen


def _apres_deconnexion():
    params_cache.invalidate()
    oublier_sessions()
    oublier_roles_admin()


def deconnecter_tout_le_monde() -> str:
    """Nouvelle génération des sessions : tout jeton émis avant est refusé (401 → écran de
    connexion, sur chaque poste), sessions du journal closes « forcee », preuves du code admin
    retirées. L'activité en mémoire est écrite avant, pour ne rien rouvrir ensuite."""
    presence.vider_activite()
    with get_cursor() as cur:
        gen = _deconnecter(cur)
    _apres_deconnexion()
    return gen


def deconnexion_generale_unique(etiquette: str) -> bool:
    """Au démarrage : déconnexion générale demandée par le gérant, une seule fois par étiquette
    (params DECONNEXION_GENERALE_<étiquette>, posée dans la même transaction)."""
    try:
        with get_cursor() as cur:
            cur.execute("""INSERT INTO params (cle, valeur) VALUES (%s, %s)
                           ON CONFLICT (cle) DO NOTHING RETURNING cle""",
                        (f"DECONNEXION_GENERALE_{etiquette}", datetime.now(timezone.utc).isoformat()))
            if not cur.fetchone():
                return False
            _deconnecter(cur)
    except Exception as e:
        print(f"[auth] déconnexion générale {etiquette} impossible : {e}")
        return False
    _apres_deconnexion()
    print(f"[auth] déconnexion générale {etiquette} : toutes les sessions sont closes")
    return True


# ─── IP RÉELLE ───────────────────────────────────────────────────

def proxy_de_confiance() -> bool:
    """KP_TRUST_PROXY : '1' (défaut, Railway) = l'IP de connexion est la DERNIÈRE valeur de
    X-Forwarded-For, posée par le proxy ; '0' = aucun proxy, request.client.host seulement."""
    return os.getenv("KP_TRUST_PROXY", "1").strip().lower() not in ("0", "false", "non", "off", "no")


_XFF_ABSENT_SIGNALE = [False]


def client_ip(request: Request) -> str:
    """IP du client : seule fonction à lire X-Forwarded-For (limites de débit, verrous, journaux).

    Le proxy Railway ajoute l'IP de connexion en DERNIER dans X-Forwarded-For : les valeurs
    précédentes viennent du client et sont falsifiables. Sans proxy (KP_TRUST_PROXY=0),
    l'en-tête est ignoré ici ; mais uvicorn lui-même (proxy-headers, actif par défaut pour les
    connexions venant de 127.0.0.1, cf. --forwarded-allow-ips) réécrit request.client depuis
    X-Forwarded-For AVANT cette fonction : pour ignorer totalement l'en-tête, lancer uvicorn
    avec --no-proxy-headers (ou FORWARDED_ALLOW_IPS vide), cf. verifier_reglage_proxy."""
    if request is None:
        return "inconnu"
    if proxy_de_confiance():
        xff = request.headers.get("x-forwarded-for", "")
        dernier = xff.split(",")[-1].strip() if xff else ""
        if dernier:
            return dernier
        if not _XFF_ABSENT_SIGNALE[0]:
            # Une fois par processus : proxy mal configuré, ou application servie sans proxy
            _XFF_ABSENT_SIGNALE[0] = True
            print("[auth] X-Forwarded-For absent alors que KP_TRUST_PROXY=1 (défaut) : application servie "
                  "sans proxy ? Hors Railway, poser KP_TRUST_PROXY=0 (quotas et verrous par IP de connexion).")
    return request.client.host if request.client else "inconnu"


def verifier_reglage_proxy() -> list:
    """Garde au démarrage : KP_TRUST_PROXY incohérent avec l'environnement (messages imprimés et
    renvoyés). '0' sur Railway : toutes les requêtes porteraient l'IP du proxy (quotas, verrous
    de PIN, empreinte des références client communs à tous) ; '1' sans proxy : X-Forwarded-For
    forgeable par le client (quotas et verrous contournés par rotation d'en-tête)."""
    messages = []
    confiance = proxy_de_confiance()
    if en_production() and not confiance:
        messages.append("ERREUR : KP_TRUST_PROXY=0 derrière le proxy Railway : toutes les requêtes partagent "
                        "l'IP du proxy (quotas, verrous de PIN et références client communs à tous les "
                        "visiteurs). Retirer la variable (défaut 1).")
    if confiance and not en_production() and not os.getenv("BACKEND_URL"):
        messages.append("AVERTISSEMENT : KP_TRUST_PROXY=1 (défaut) sans proxy connu (aucune variable RAILWAY_*, "
                        "BACKEND_URL absent) : X-Forwarded-For serait forgeable par le client. Hors Railway, "
                        "poser KP_TRUST_PROXY=0 et lancer uvicorn avec --no-proxy-headers.")
    if not confiance and os.getenv("FORWARDED_ALLOW_IPS") is None:
        # L'option de ligne de commande --no-proxy-headers n'est pas visible d'ici : simple rappel
        messages.append("NOTE : KP_TRUST_PROXY=0 — vérifier qu'uvicorn est lancé avec --no-proxy-headers (ou "
                        "FORWARDED_ALLOW_IPS vide) : sinon il réécrit lui-même request.client depuis "
                        "X-Forwarded-For pour les connexions locales (forwarded-allow-ips=127.0.0.1).")
    for m in messages:
        print(f"[auth] {m}")
    return messages


verifier_reglage_proxy()


# ─── ANTI BRUTE-FORCE ────────────────────────────────────────────

def _duree(secondes: float) -> str:
    s = max(1, int(secondes + 0.999))
    if s < 60:
        return f"{s} s"
    m, s = divmod(s, 60)
    return f"{m} min {s:02d} s" if s else f"{m} min"


class AntiBruteForce:
    """Échecs comptés par clé ; au-delà du seuil, verrou doublé à chaque nouvel échec.

    Un compteur s'efface après `fenetre` secondes sans échec. Mémoire bornée,
    sûr en threadpool. Propre au processus (un seul worker uvicorn).
    """

    def __init__(self, seuil: int, base: float, plafond: float, fenetre: float = 900, max_cles: int = 5000):
        self.seuil = seuil
        self.base = base
        self.plafond = plafond
        self.fenetre = fenetre
        self.max_cles = max_cles
        self._etats: "OrderedDict[str, list]" = OrderedDict()  # cle → [échecs, dernier échec, verrou jusqu'à]
        self._verrou = threading.Lock()

    def _etat(self, cle: str, now: float):
        e = self._etats.get(cle)
        if e and now - e[1] > self.fenetre and now >= e[2]:
            del self._etats[cle]
            return None
        return e

    def attente(self, cle: str) -> float:
        now = monotonic()
        with self._verrou:
            e = self._etat(cle, now)
            return max(0.0, e[2] - now) if e else 0.0

    def echec(self, cle: str) -> float:
        """Enregistre un échec ; renvoie la durée du verrou posé (0 sinon)."""
        now = monotonic()
        with self._verrou:
            e = self._etat(cle, now) or [0, now, 0.0]
            e[0] += 1
            e[1] = now
            attente = 0.0
            if e[0] >= self.seuil:
                attente = min(self.plafond, self.base * (2 ** (e[0] - self.seuil)))
                e[2] = now + attente
            self._etats[cle] = e
            self._etats.move_to_end(cle)
            if len(self._etats) > self.max_cles:
                # Purge par l'ancien ; un verrou en cours n'est sacrifié qu'en dernier recours
                libres = [k for k, v in self._etats.items() if v[2] <= now]
                for k in (libres or list(self._etats))[: len(self._etats) - self.max_cles]:
                    del self._etats[k]
            return attente

    def succes(self, cle: str):
        with self._verrou:
            self._etats.pop(cle, None)

    def reset(self):
        with self._verrou:
            self._etats.clear()


class IpConnues:
    """IP ayant ouvert une session ou présenté un jeton valide récemment : les postes
    de la boutique. Le verrou global ne s'applique pas à elles (sinon une attaque
    répartie suffirait à empêcher les employés de se connecter)."""

    def __init__(self, duree: float = 30 * 86400, max_cles: int = 2000):
        self.duree = duree
        self.max_cles = max_cles
        self._ips: "OrderedDict[str, float]" = OrderedDict()
        self._verrou = threading.Lock()

    def noter(self, ip: str):
        if not ip:
            return
        now = monotonic()
        with self._verrou:
            self._ips[ip] = now
            self._ips.move_to_end(ip)
            while len(self._ips) > self.max_cles:
                self._ips.popitem(last=False)

    def connue(self, ip: str) -> bool:
        now = monotonic()
        with self._verrou:
            vu = self._ips.get(ip)
            if vu is None:
                return False
            if now - vu > self.duree:
                del self._ips[ip]
                return False
            return True

    def reset(self):
        with self._verrou:
            self._ips.clear()


class FenetreEchecs:
    """Échecs comptés toutes clés confondues sur une fenêtre glissante : au-delà de `limite`,
    refus jusqu'à ce que le plus ancien échec sorte de la fenêtre. Sûr en threadpool."""

    def __init__(self, limite: int, fenetre: float):
        self.limite = limite
        self.fenetre = fenetre
        self._echecs: deque = deque()
        self._verrou = threading.Lock()

    def _purger(self, now: float):
        while self._echecs and now - self._echecs[0] > self.fenetre:
            self._echecs.popleft()

    def attente(self) -> float:
        """Secondes avant qu'un essai soit de nouveau admis (0 si le plafond n'est pas atteint)."""
        now = monotonic()
        with self._verrou:
            self._purger(now)
            if len(self._echecs) < self.limite:
                return 0.0
            return max(1.0, self.fenetre - (now - self._echecs[0]))

    def echec(self) -> float:
        now = monotonic()
        with self._verrou:
            self._purger(now)
            self._echecs.append(now)
            if len(self._echecs) < self.limite:
                return 0.0
            return max(1.0, self.fenetre - (now - self._echecs[0]))

    def __len__(self):
        with self._verrou:
            self._purger(monotonic())
            return len(self._echecs)

    def reset(self):
        with self._verrou:
            self._echecs.clear()


# Par IP et par cible : 5 essais, puis 30 s, 1 min, 2 min… jusqu'à 15 min. Le compteur
# survit au verrou de 15 min (fenêtre d'1 h) : sinon 5 essais neufs à chaque expiration.
_ESSAIS_IP = AntiBruteForce(seuil=5, base=30, plafond=900, fenetre=3600)
# Toutes IP inconnues confondues (attaque répartie) ; les postes connus n'y sont pas soumis.
_ESSAIS_CIBLE = AntiBruteForce(seuil=50, base=60, plafond=900, fenetre=3600)
_IP_CONNUES = IpConnues()
# Plafond d'échecs de PIN toutes IP confondues, postes connus compris (un attaquant sur le
# wifi de la boutique ou derrière un poste « connu ») : 200 par heure, puis 429 pour tous.
PIN_ECHECS_GLOBAL_H = 200
_ECHECS_PIN = FenetreEchecs(limite=PIN_ECHECS_GLOBAL_H, fenetre=3600)


def _cles(request: Request, cible: str):
    return f"{client_ip(request)}|{cible}", f"*|{cible}"


def _refus_verrou(attente: float):
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=f"Trop d'essais incorrects. Réessayez dans {_duree(attente)}.",
        headers={"Retry-After": str(max(1, int(attente + 0.999)))},
    )


def _refus_plafond_pin(attente: float):
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Trop d'essais de code PIN incorrects sur l'ensemble des postes. "
               f"Connexion suspendue : réessayez dans {_duree(attente)}.",
        headers={"Retry-After": str(max(1, int(attente + 0.999)))},
    )


def _cible_pin(cible: str) -> bool:
    return cible.startswith("pin:")


def verifier_essais(request: Request, cible: str):
    """429 si la cible est verrouillée pour cette IP (ou, IP inconnue, pour toutes),
    ou si le plafond global d'échecs de PIN est atteint (toutes IP confondues)."""
    if _cible_pin(cible):
        attente_pin = _ECHECS_PIN.attente()
        if attente_pin > 0:
            _refus_plafond_pin(attente_pin)
    cle_ip, cle_cible = _cles(request, cible)
    attente = _ESSAIS_IP.attente(cle_ip)
    if not _IP_CONNUES.connue(client_ip(request)):
        attente = max(attente, _ESSAIS_CIBLE.attente(cle_cible))
    if attente > 0:
        _refus_verrou(attente)


def noter_echec(request: Request, cible: str):
    """Compte un échec ; 429 tout de suite si cet échec déclenche le verrou."""
    cle_ip, cle_cible = _cles(request, cible)
    ip = client_ip(request)
    attente_pin = _ECHECS_PIN.echec() if _cible_pin(cible) else 0.0
    attente = _ESSAIS_IP.echec(cle_ip)
    if not _IP_CONNUES.connue(ip):
        attente = max(attente, _ESSAIS_CIBLE.echec(cle_cible))
    print(f"[auth] échec {cible} depuis {ip}")
    if attente > 0:
        _refus_verrou(attente)
    if attente_pin > 0:
        _refus_plafond_pin(attente_pin)


def noter_succes(request: Request, cible: str):
    _ESSAIS_IP.succes(_cles(request, cible)[0])
    # Les 4 chiffres du suivi sont saisis par des clients : pas un poste de la boutique
    if not cible.startswith("suivi:"):
        _IP_CONNUES.noter(client_ip(request))


def reset_essais():
    _ESSAIS_IP.reset()
    _ESSAIS_CIBLE.reset()
    _ECHECS_PIN.reset()
    _IP_CONNUES.reset()


# ─── SECRETS : comparaison en temps constant, hash bcrypt ────────

_BCRYPT_PREFIXES = ("$2a$", "$2b$", "$2y$")


def _bcrypt_lib():
    try:
        import bcrypt
        return bcrypt
    except Exception:
        return None


def _passlib_bcrypt():
    try:
        from passlib.hash import bcrypt as pl_bcrypt
        return pl_bcrypt
    except Exception:
        return None


def est_hash(valeur) -> bool:
    return isinstance(valeur, str) and valeur.startswith(_BCRYPT_PREFIXES)


def hasher_secret(clair: str) -> Optional[str]:
    """Hash bcrypt, ou None si aucune bibliothèque bcrypt n'est disponible."""
    octets = str(clair).encode("utf-8")[:72]
    lib = _bcrypt_lib()
    if lib:
        try:
            return lib.hashpw(octets, lib.gensalt()).decode("ascii")
        except Exception:
            pass
    pl = _passlib_bcrypt()
    if pl:
        try:
            return pl.hash(octets.decode("utf-8", "ignore"))
        except Exception:
            pass
    return None


def verifier_secret(clair, stocke) -> bool:
    if not stocke:
        return False
    clair_b = str(clair or "").encode("utf-8")
    if not est_hash(stocke):
        return hmac.compare_digest(clair_b, str(stocke).encode("utf-8"))
    lib = _bcrypt_lib()
    if lib:
        try:
            return lib.checkpw(clair_b[:72], stocke.encode("ascii"))
        except Exception:
            return False
    pl = _passlib_bcrypt()
    if pl:
        try:
            return pl.verify(clair_b[:72].decode("utf-8", "ignore"), stocke)
        except Exception:
            return False
    raise HTTPException(503, "Vérification du code admin impossible : bibliothèque bcrypt absente")


def lire_admin_password(cur) -> Optional[str]:
    cur.execute("SELECT valeur FROM params WHERE cle = 'ADMIN_PASSWORD'")
    row = cur.fetchone()
    return row["valeur"] if row else None


def ecrire_admin_password(cur, clair: str):
    """Stocke le mot de passe admin, haché quand bcrypt est disponible."""
    valeur = hasher_secret(clair) or clair
    cur.execute("""
        INSERT INTO params (cle, valeur) VALUES ('ADMIN_PASSWORD', %s)
        ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur
    """, (valeur,))


def controler_admin_password(request: Request, password: str) -> bool:
    """Vérifie le mot de passe admin (temps constant, anti brute-force).

    Migration transparente : un mot de passe encore en clair est haché au
    premier succès. Lève 429 si verrouillé, 503 si non configuré.
    """
    verifier_essais(request, "admin")
    with get_cursor() as cur:
        stocke = lire_admin_password(cur)
    # Fail-closed : sans mot de passe admin configuré, on refuse.
    if not stocke:
        raise HTTPException(503, "Code admin non configuré — définir ADMIN_PASSWORD")
    if not verifier_secret(password, stocke):
        noter_echec(request, "admin")
        return False
    noter_succes(request, "admin")
    if not est_hash(stocke):
        nouveau = hasher_secret(password)
        if nouveau:
            try:
                with get_cursor() as cur:
                    cur.execute(
                        "UPDATE params SET valeur = %s WHERE cle = 'ADMIN_PASSWORD' AND valeur = %s",
                        (nouveau, stocke),
                    )
                params_cache.invalidate()
            except Exception as e:
                print(f"[auth] migration du hash admin reportée : {e}")
    return True


# ─── ÉLÉVATION ADMIN ─────────────────────────────────────────────

# Dernier jeton d'élévation émis par lignée (iat) : une révocation n'est jamais datée avant
# lui et un nouveau jeton jamais avant la dernière révocation (horloge murale ramenée en
# arrière par NTP), cf. _noter_revocation
_DERNIERS_IAT_MAX = 4096
_derniers_iat: "OrderedDict[str, float]" = OrderedDict()


def _tailler(d: "OrderedDict", maxi: int) -> None:
    while len(d) > maxi:
        d.popitem(last=False)


def create_admin_token(user: dict) -> str:
    """Jeton d'élévation (10 min) lié au membre ET à la lignée de session du poste (sid) ;
    `iat` (horloge du processus, fraction de seconde) le date : une révocation du sid
    postérieure (verrouillage, déconnexion, changement de membre) l'invalide."""
    sid = user.get("sid") or ""
    iat = horloge()
    if sid:
        iat = max(iat, derniere_revocation(sid) + 1e-3)
        with _revocations_verrou:
            iat = max(iat, _derniers_iat.get(sid, 0.0) + 1e-3)
            _derniers_iat[sid] = iat
            _derniers_iat.move_to_end(sid)
            _tailler(_derniers_iat, _DERNIERS_IAT_MAX)
    payload = {
        "sub": user.get("sub"),
        "target": user.get("target"),
        "sid": sid,
        "typ": _ADMIN_TYP,
        "admin": True,
        "iat": iat,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ADMIN_TOKEN_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _refus_admin(code: str, message: str):
    # Le front reconnaît « élévation » dans le message (et peut lire detail.code)
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": code, "message": message})


# Dernière révocation par lignée de session (verrouillage du mode admin, déconnexion,
# changement de membre) : un jeton d'élévation émis avant est refusé. Mémoire du processus
# (accélérateur) ET table revocations_admin (sid → horodatage epoch) : un redéploiement dans
# les 10 minutes suivant un verrouillage ne ressuscite pas un jeton d'élévation. La base est
# relue au plus toutes les 30 s par sid (même motif que _roles_admin) ; une révocation faite
# ici est écrite aussitôt (mémoire d'abord, puis UPSERT).
_REVOCATIONS_MAX = 4096
REVOCATION_CACHE_S = 30.0
_revocations: "OrderedDict[str, float]" = OrderedDict()         # sid → horodatage (time.time)
_revocations_lues: "OrderedDict[str, float]" = OrderedDict()    # sid → validité (monotonic) de la lecture
_revocations_verrou = threading.Lock()


def _lire_revocation(sid: str) -> float:
    try:
        with get_cursor() as cur:
            cur.execute("SELECT revoque_epoch FROM revocations_admin WHERE sid = %s", (sid,))
            row = cur.fetchone()
    except psycopg2.Error as e:
        if getattr(e, "pgcode", None) != "42P01":
            print(f"[auth] révocations illisibles : {e}")
        return 0.0
    except Exception as e:
        print(f"[auth] révocations illisibles : {e}")
        return 0.0
    v = row.get("revoque_epoch") if isinstance(row, dict) else None
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else 0.0


def _ecrire_revocation(sid: str, t: float) -> None:
    """UPSERT (jamais en arrière) ; table absente ou base en panne : la mémoire suffit."""
    try:
        with get_cursor() as cur:
            cur.execute("""INSERT INTO revocations_admin (sid, revoque_epoch) VALUES (%s, %s)
                           ON CONFLICT (sid) DO UPDATE
                           SET revoque_epoch = GREATEST(revocations_admin.revoque_epoch, EXCLUDED.revoque_epoch),
                               revoque_le = timezone('UTC', NOW())""", (sid, t))
            # Un jeton d'élévation vit 10 min : une révocation d'hier n'invalide plus rien
            cur.execute("DELETE FROM revocations_admin WHERE revoque_le < timezone('UTC', NOW()) - INTERVAL '1 day'")
    except psycopg2.Error as e:
        if getattr(e, "pgcode", None) != "42P01":
            print(f"[auth] révocation non enregistrée en base : {e}")
    except Exception as e:
        print(f"[auth] révocation non enregistrée en base : {e}")


def _noter_revocation(sid: str) -> None:
    # Jamais antérieure à la révocation précédente ni au dernier jeton d'élévation émis sur la
    # lignée (saut d'horloge arrière) : un jeton émis avant cet instant est toujours refusé
    precedente = derniere_revocation(sid)
    with _revocations_verrou:
        t = max(horloge(), precedente + 1e-3, _derniers_iat.get(sid, 0.0) + 1e-3)
        _revocations[sid] = t
        _revocations.move_to_end(sid)
        _revocations_lues[sid] = monotonic() + REVOCATION_CACHE_S
        _revocations_lues.move_to_end(sid)
        _tailler(_revocations, _REVOCATIONS_MAX)
        _tailler(_revocations_lues, _REVOCATIONS_MAX)
    _ecrire_revocation(sid, t)


def derniere_revocation(sid: Optional[str]) -> float:
    """Horodatage (time.time) de la dernière révocation de cette lignée, 0 si aucune : mémoire du
    processus, complétée par la base (revocations_admin) au plus toutes les 30 s par sid."""
    if not sid:
        return 0.0
    maintenant = monotonic()
    with _revocations_verrou:
        if _revocations_lues.get(sid, 0.0) > maintenant:
            return _revocations.get(sid, 0.0)
    en_base = _lire_revocation(sid)
    with _revocations_verrou:
        valeur = max(_revocations.get(sid, 0.0), en_base)
        if valeur:
            _revocations[sid] = valeur
            _revocations.move_to_end(sid)
        _revocations_lues[sid] = maintenant + REVOCATION_CACHE_S
        _revocations_lues.move_to_end(sid)
        _tailler(_revocations, _REVOCATIONS_MAX)
        _tailler(_revocations_lues, _REVOCATIONS_MAX)
        return valeur


def oublier_revocations() -> None:
    """Mémoire des révocations et des jetons émis vidée (tests : simule un redémarrage, la base
    reste la référence)."""
    with _revocations_verrou:
        _revocations.clear()
        _revocations_lues.clear()
        _derniers_iat.clear()


def _jeton_elevation_valide(request: Request, user: dict) -> bool:
    jeton = (request.headers.get("x-admin-token") or "").strip()
    if not jeton:
        return False
    try:
        payload = jwt.decode(jeton, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        return False
    if payload.get("typ") != _ADMIN_TYP or payload.get("admin") is not True:
        return False
    if payload.get("sub") != user.get("sub"):
        return False
    sid = user.get("sid") or ""
    if not sid or payload.get("sid") != sid:
        return False
    iat = payload.get("iat")
    if not isinstance(iat, (int, float)) or isinstance(iat, bool):
        return False
    return float(iat) > derniere_revocation(sid)


def membre_admin(nom) -> bool:
    """admin_autorise, avec le rôle lu en base quand ADMIN_MEMBRES est vide."""
    if params_cache.get_param(PARAM_ADMIN_MEMBRES, "").strip():
        return admin_autorise(nom)
    try:
        with get_cursor() as cur:
            cur.execute("SELECT role FROM membres_equipe WHERE nom = %s LIMIT 1", (nom or "",))
            row = cur.fetchone()
    except psycopg2.Error:
        return False
    return bool(row) and row.get("role") == "admin"


def exiger_elevation(request: Request, user: dict) -> dict:
    """403 sauf jeton d'élévation valide (X-Admin-Token) ou code admin (X-Admin-Password), pour un
    membre autorisé à la partie admin (membre_admin) : le code seul ne suffit pas.

    403 et non 401 : le front déconnecte l'employé sur tout 401.
    """
    if not membre_admin(user.get("sub")):
        _refus_admin("admin_reserve", "Réservé à l'administrateur.")
    jeton = (request.headers.get("x-admin-token") or "").strip()
    if _jeton_elevation_valide(request, user):
        return {**user, "admin": True}
    password = request.headers.get("x-admin-password")
    if password:
        if controler_admin_password(request, password):
            noter_preuve_admin(user.get("sid"))
            return {**user, "admin": True}
        _refus_admin("admin_invalide", "Code admin incorrect.")
    if jeton:
        _refus_admin("admin_expire", "Élévation administrateur expirée : identifiez-vous à nouveau.")
    _refus_admin("admin_requis", "Élévation administrateur requise pour cette action.")


def require_admin(request: Request, user: dict = Depends(get_current_user)) -> dict:
    """Dépendance : action réservée à l'admin (élévation de moins de 10 min)."""
    return exiger_elevation(request, user)


# ─── RÔLE ADMIN : PREUVE DU CODE PAR POSTE ───────────────────────
# Le rôle (membres_equipe.role) se lit sur le nom de la session, et ce nom se
# choisit avec le seul PIN boutique. Les routes du rôle admin (stats, marketing)
# exigent donc aussi que la lignée de session du poste (sid) ait saisi le code
# admin : preuve gardée 30 jours, prolongée à l'usage. Elle est retirée quand le
# mode admin est verrouillé (POST /api/admin/lock) ou quand un autre membre prend
# la session (switch-user) : revenir sur le membre admin redemande le code.
PREUVE_ADMIN_JOURS = 30


def noter_preuve_admin(sid: Optional[str], origine: str = "code"):
    """Ce poste a saisi le code admin. « reprise » : jeton antérieur aux sid, non prolongée."""
    if not sid:
        return
    try:
        with get_cursor() as cur:
            cur.execute("""
                INSERT INTO sessions_admin (sid, origine, prouve_le, expire)
                VALUES (%s, %s, NOW(), NOW() + make_interval(days => %s))
                ON CONFLICT (sid) DO UPDATE
                SET origine = EXCLUDED.origine, prouve_le = NOW(), expire = EXCLUDED.expire
                WHERE EXCLUDED.origine = 'code' OR sessions_admin.origine <> 'code'
                   OR sessions_admin.expire <= NOW()
            """, (sid, origine, PREUVE_ADMIN_JOURS))
            # Ménage des preuves expirées
            cur.execute("DELETE FROM sessions_admin WHERE expire < NOW() - INTERVAL '1 day'")
    except Exception as e:
        print(f"[auth] preuve admin non enregistrée : {e}")


# Contrôle du rôle admin mis en cache 30 s par (sid, membre, jeton d'élévation) : une
# grille de prix envoie une écriture par cellule, chacune relisait rôle et preuve (une
# transaction de plus). Seul un succès est gardé. Toute révocation (verrouillage du mode
# admin, changement de membre, modification de l'équipe) vide le cache ; la génération
# empêche une lecture commencée avant la révocation de le remplir après.
ROLE_ADMIN_CACHE_S = 30.0
_ROLE_ADMIN_CACHE_MAX = 512
_roles_admin: dict = {}
_roles_admin_generation = 0
_roles_admin_verrou = threading.Lock()


def _cle_role_admin(request: Request, user: dict) -> tuple:
    jeton = (request.headers.get("x-admin-token") or "").strip()
    return (user.get("sid") or "", user.get("sub") or "", jeton)


def _role_admin_en_cache(cle: tuple) -> bool:
    with _roles_admin_verrou:
        expire = _roles_admin.get(cle)
        if expire is None:
            return False
        if expire <= monotonic():
            _roles_admin.pop(cle, None)
            return False
        return True


def _garder_role_admin(cle: tuple, generation: int, duree: float):
    if duree <= 0:
        return
    with _roles_admin_verrou:
        if generation != _roles_admin_generation:
            return   # révocation pendant le contrôle : rien n'est gardé
        if len(_roles_admin) >= _ROLE_ADMIN_CACHE_MAX:
            maintenant = monotonic()
            for k in [k for k, e in _roles_admin.items() if e <= maintenant]:
                del _roles_admin[k]
            if len(_roles_admin) >= _ROLE_ADMIN_CACHE_MAX:
                _roles_admin.clear()
        _roles_admin[cle] = monotonic() + duree


def oublier_roles_admin():
    """Vide le cache du contrôle de rôle admin (révocation, équipe modifiée)."""
    global _roles_admin_generation
    with _roles_admin_verrou:
        _roles_admin_generation += 1
        _roles_admin.clear()


def revoquer_preuve_admin(sid: Optional[str]):
    """Le code admin n'est plus prouvé sur cette lignée. Table absente : rien à retirer.

    Cache du rôle vidé avant ET après la suppression : un contrôle qui a lu la preuve
    avant qu'elle soit supprimée ne la garde pas (cf. _garder_role_admin).
    """
    if not sid:
        return
    # Les jetons d'élévation (X-Admin-Token) émis avant cet instant sur cette lignée sont refusés
    # (mémoire + table revocations_admin : survit à un redémarrage)
    _noter_revocation(sid)
    oublier_roles_admin()
    try:
        with get_cursor() as cur:
            cur.execute("DELETE FROM sessions_admin WHERE sid = %s", (sid,))
    except psycopg2.Error as e:
        if getattr(e, "pgcode", None) != "42P01":
            raise
    finally:
        oublier_roles_admin()


def _role_et_preuve(nom: str, sid: str) -> Optional[dict]:
    try:
        with get_cursor() as cur:
            cur.execute("""
                SELECT m.role, s.sid IS NOT NULL AS prouve,
                       COALESCE(s.origine = 'code' AND s.expire < NOW() + INTERVAL '29 days', FALSE) AS a_prolonger,
                       EXTRACT(EPOCH FROM s.expire - NOW()) AS reste_s
                FROM membres_equipe m
                LEFT JOIN sessions_admin s ON s.sid = %s AND s.expire > NOW()
                WHERE m.nom = %s
                LIMIT 1
            """, (sid, nom))
            return cur.fetchone()
    except psycopg2.Error as e:
        # Table des preuves absente (migration en échec) : rôle seul, jamais prouvé
        print(f"[auth] lecture des preuves admin impossible : {e}")
        with get_cursor() as cur:
            cur.execute("SELECT role, FALSE AS prouve, FALSE AS a_prolonger, NULL AS reste_s "
                        "FROM membres_equipe WHERE nom = %s LIMIT 1", (nom,))
            return cur.fetchone()


def exiger_role_admin(request: Request, user: dict) -> dict:
    """Rôle admin du membre de la session ET code admin saisi sur ce poste.

    - rôle absent : 403 « Admin requis » (texte : refus de rôle, le code n'y change rien) ;
    - rôle admin sans preuve : 403 {code: admin_requis}. Un jeton d'élévation
      valide (X-Admin-Token) vaut preuve et l'enregistre ;
    - jeton de session antérieur aux sid (avant cette version) : repris une fois,
      30 jours non prolongés, pour ne pas couper les gérants au déploiement ;
    - preuve retirée par POST /api/admin/lock et par un changement de membre.

    Un succès est gardé ROLE_ADMIN_CACHE_S (jamais au-delà de l'expiration de la
    preuve) ; toute révocation vide ce cache (oublier_roles_admin).
    """
    sid = user.get("sid") or ""
    cle = _cle_role_admin(request, user)
    if _role_admin_en_cache(cle):
        user["role"] = "admin"
        return user
    generation = _roles_admin_generation
    row = _role_et_preuve(user.get("sub") or "", sid)
    if not row or not admin_autorise(user.get("sub"), row.get("role")):
        raise HTTPException(403, "Admin requis")
    duree = ROLE_ADMIN_CACHE_S
    if not row.get("prouve"):
        if _jeton_elevation_valide(request, user):
            noter_preuve_admin(sid)
        elif user.get("sid_ancien"):
            noter_preuve_admin(sid, "reprise")
        else:
            _refus_admin("admin_requis", "Code admin requis sur ce poste : verrouillez le mode admin "
                                         "puis saisissez de nouveau le code admin.")
    else:
        if row.get("reste_s") is not None:
            duree = min(duree, float(row["reste_s"]))
        if row.get("a_prolonger"):
            noter_preuve_admin(sid)
            duree = ROLE_ADMIN_CACHE_S
    _garder_role_admin(cle, generation, duree)
    user["role"] = "admin"
    return user


# ─── ROUTES ──────────────────────────────────────────────────────

def _membre_autorise(nom: Optional[str], target: str) -> str:
    """Nom porté par la session : un membre actif de l'équipe, ou le nom générique du poste.

    Les droits liés au rôle (membres_equipe.role) se lisent sur ce nom : on ne
    laisse pas choisir un nom arbitraire (ex. un ancien membre admin désactivé).
    """
    nom = (nom or "").strip()
    if not nom or nom in ("Utilisateur", target.capitalize()):
        return nom or target.capitalize()
    with get_cursor() as cur:
        cur.execute("SELECT 1 AS ok FROM membres_equipe WHERE actif = 1 AND TRIM(nom) = %s LIMIT 1", (nom,))
        trouve = cur.fetchone()
    if not trouve:
        raise HTTPException(400, "Membre de l'équipe inconnu ou inactif")
    return nom


@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest, request: Request):
    """Authentification par PIN.

    Vérifie le PIN contre la table params (PIN_ACCUEIL ou PIN_TECH).
    Verrouillage progressif après 5 essais incorrects (par IP et par poste).
    """
    if req.target not in ("accueil", "tech"):
        raise HTTPException(400, "Target invalide: accueil ou tech")

    cible = f"pin:{req.target}"
    verifier_essais(request, cible)

    param_key = f"PIN_{req.target.upper()}"

    with get_cursor() as cur:
        cur.execute("SELECT valeur FROM params WHERE cle = %s", (param_key,))
        row = cur.fetchone()

    if not row:
        raise HTTPException(500, "PIN non configuré dans la base")

    if not verifier_secret(req.pin, row["valeur"]):
        noter_echec(request, cible)
        raise HTTPException(401, "PIN incorrect")
    noter_succes(request, cible)

    utilisateur = _membre_autorise(req.utilisateur, req.target)
    sid = secrets.token_urlsafe(16)
    # Journal des connexions : nouvelle ligne ; la session précédente de ce navigateur (jeton
    # encore présenté) est close « changement »
    precedent = _jeton_precedent(request)
    cx = presence.ouvrir_session(request, sid, utilisateur, req.target, req.poste, req.appareil,
                                 precedent=precedent)
    if precedent and cx != _cx(precedent):
        oublier_session(precedent)   # l'ancien jeton (ligne close « changement ») est refusé
    token = create_token(req.target, utilisateur, sid=sid, cx=cx)

    return TokenResponse(
        access_token=token,
        target=req.target,
        utilisateur=utilisateur,
    )


def _jeton_precedent(request: Request) -> Optional[dict]:
    """Jeton de session encore envoyé par le navigateur au moment d'une connexion par PIN."""
    entete = request.headers.get("authorization") or ""
    if not entete.lower().startswith("bearer "):
        return None
    jeton = entete[7:].strip()
    try:
        payload = decode_token(jeton)
    except HTTPException:
        return None
    if not payload.get("sid"):
        payload["sid"] = _sid_ancien(jeton)
    return payload


class SwitchUserRequest(BaseModel):
    utilisateur: str
    poste: Optional[Any] = None
    appareil: Optional[Any] = None


def _reprendre_preuve_ancienne(user: dict):
    """Jeton antérieur aux sid porté par un membre admin : sa lignée garde l'accès
    (preuve « reprise », 30 jours) après le changement d'utilisateur."""
    try:
        with get_cursor() as cur:
            cur.execute("SELECT role FROM membres_equipe WHERE nom = %s LIMIT 1", (user.get("sub") or "",))
            row = cur.fetchone()
    except Exception:
        return
    if row and admin_autorise(user.get("sub"), row.get("role")):
        noter_preuve_admin(user.get("sid"), "reprise")


@router.post("/switch-user", response_model=TokenResponse)
def switch_user(req: SwitchUserRequest, request: Request, user: dict = Depends(get_current_user)):
    """Change d'utilisateur sans re-saisir le PIN (le token courant est valide).

    La lignée (sid) suit, pas la preuve du code admin : un autre membre qui prend
    le poste ne garde pas l'accès du gérant en revenant sur son nom.
    """
    target = user["target"]
    utilisateur = _membre_autorise(req.utilisateur, target)
    if utilisateur != (user.get("sub") or "").strip():
        revoquer_preuve_admin(user.get("sid"))
    elif user.get("sid_ancien"):
        _reprendre_preuve_ancienne(user)
    # Journal des connexions : la session du membre précédent est close « changement »
    cx = presence.ouvrir_session(request, user.get("sid"), utilisateur, target, req.poste, req.appareil,
                                 precedent=user)
    if cx != _cx(user):
        oublier_session(user)   # l'ancien jeton (ligne close) est refusé dès la prochaine requête
    token = create_token(target, utilisateur, sid=user.get("sid"), cx=cx)
    return TokenResponse(
        access_token=token,
        target=target,
        utilisateur=utilisateur,
    )


@router.post("/logout")
def logout(user: dict = Depends(get_current_user)):
    """Déconnexion : la session courante est close dans le journal (motif « deconnexion ») et la
    preuve du code admin de cette lignée est retirée. Ne renvoie jamais d'erreur métier."""
    ferme = presence.fermer_session(user, "deconnexion")
    oublier_session(user)   # le jeton est refusé dès la prochaine requête (ligne close)
    try:
        revoquer_preuve_admin(user.get("sid"))
    except Exception:
        pass
    return {"ok": True, "session_close": ferme}


@router.get("/me")
def get_me(user: dict = Depends(get_current_user)):
    """Retourne les infos de l'utilisateur connecté."""
    role = ""
    try:
        with get_cursor() as cur:
            cur.execute("SELECT role FROM membres_equipe WHERE nom = %s", (user["sub"],))
            row = cur.fetchone()
            if row:
                role = row["role"] or ""
    except Exception:
        pass
    # « admin » seulement pour les membres autorisés (ADMIN_MEMBRES) : les autres ne voient pas la
    # partie admin, même si leur fiche porte encore ce rôle
    autorise = admin_autorise(user["sub"], role)
    if autorise:
        role = "admin"
    elif role == "admin":
        role = ""
    return {
        "utilisateur": user["sub"],
        "target": user["target"],
        "role": role,
    }
