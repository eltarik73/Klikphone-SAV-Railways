"""
Authentification par PIN + JWT tokens.
Compatible avec le système de PIN existant (params: PIN_ACCUEIL, PIN_TECH).

Élévation admin : POST /api/admin/verify renvoie un jeton court (10 min) à
présenter dans l'en-tête X-Admin-Token pour les actions sensibles
(dépendance require_admin).
"""

import hmac
import os
import secrets
import threading
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from time import monotonic
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from pydantic import BaseModel

from app.database import get_cursor
from app.models import LoginRequest, TokenResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])
security = HTTPBearer(auto_error=False)

_JWT_SECRET_DEV = "klikphone-secret-change-me-in-prod"


def _jwt_secret() -> str:
    """JWT_SECRET ; en production, jamais la valeur connue du dépôt.

    Sans variable sur Railway, un secret aléatoire propre au processus évite
    de signer des jetons forgeables (session et élévation admin) : les
    sessions sont alors perdues à chaque redémarrage, ce qui se remarque.
    """
    valeur = os.getenv("JWT_SECRET", "")
    if valeur and valeur != _JWT_SECRET_DEV:
        return valeur
    en_prod = any(os.getenv(v) for v in (
        "RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_PROJECT_ID", "RAILWAY_PUBLIC_DOMAIN",
    ))
    if en_prod:
        print("[auth] ERREUR : JWT_SECRET absent ou par défaut en production. Secret aléatoire "
              "utilisé (sessions perdues au redémarrage) : définir JWT_SECRET sur Railway.")
        return secrets.token_urlsafe(48)
    return valeur or _JWT_SECRET_DEV


JWT_SECRET = _jwt_secret()
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 30
ADMIN_TOKEN_MINUTES = 10
_ADMIN_TYP = "admin_elevation"


def create_token(target: str, utilisateur: str) -> str:
    """Crée un JWT token."""
    expire = datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS)
    payload = {
        "sub": utilisateur,
        "target": target,
        "exp": expire,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


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
    # Un poste qui présente un jeton valide est un poste de la boutique (cf. verrou global)
    _IP_CONNUES.noter(client_ip(request))
    return payload


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[dict]:
    """Auth optionnelle (pour les routes publiques qui bénéficient d'un contexte user)."""
    if credentials is None:
        return None
    try:
        return decode_token(credentials.credentials)
    except HTTPException:
        return None


# ─── IP RÉELLE ───────────────────────────────────────────────────

def client_ip(request: Request) -> str:
    # Le proxy Railway ajoute l'IP de connexion en DERNIER dans X-Forwarded-For :
    # les valeurs précédentes viennent du client et sont falsifiables.
    xff = request.headers.get("x-forwarded-for", "")
    dernier = xff.split(",")[-1].strip() if xff else ""
    if dernier:
        return dernier
    return request.client.host if request.client else "inconnu"


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


# Par IP et par cible : 5 essais, puis 30 s, 1 min, 2 min… jusqu'à 15 min. Le compteur
# survit au verrou de 15 min (fenêtre d'1 h) : sinon 5 essais neufs à chaque expiration.
_ESSAIS_IP = AntiBruteForce(seuil=5, base=30, plafond=900, fenetre=3600)
# Toutes IP inconnues confondues (attaque répartie) ; les postes connus n'y sont pas soumis.
_ESSAIS_CIBLE = AntiBruteForce(seuil=50, base=60, plafond=900, fenetre=3600)
_IP_CONNUES = IpConnues()


def _cles(request: Request, cible: str):
    return f"{client_ip(request)}|{cible}", f"*|{cible}"


def _refus_verrou(attente: float):
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=f"Trop d'essais incorrects. Réessayez dans {_duree(attente)}.",
        headers={"Retry-After": str(max(1, int(attente + 0.999)))},
    )


def verifier_essais(request: Request, cible: str):
    """429 si la cible est verrouillée pour cette IP (ou, IP inconnue, pour toutes)."""
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
    attente = _ESSAIS_IP.echec(cle_ip)
    if not _IP_CONNUES.connue(ip):
        attente = max(attente, _ESSAIS_CIBLE.echec(cle_cible))
    print(f"[auth] échec {cible} depuis {ip}")
    if attente > 0:
        _refus_verrou(attente)


def noter_succes(request: Request, cible: str):
    _ESSAIS_IP.succes(_cles(request, cible)[0])
    # Les 4 chiffres du suivi sont saisis par des clients : pas un poste de la boutique
    if not cible.startswith("suivi:"):
        _IP_CONNUES.noter(client_ip(request))


def reset_essais():
    _ESSAIS_IP.reset()
    _ESSAIS_CIBLE.reset()
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
            except Exception as e:
                print(f"[auth] migration du hash admin reportée : {e}")
    return True


# ─── ÉLÉVATION ADMIN ─────────────────────────────────────────────

def create_admin_token(user: dict) -> str:
    payload = {
        "sub": user.get("sub"),
        "target": user.get("target"),
        "typ": _ADMIN_TYP,
        "admin": True,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ADMIN_TOKEN_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _refus_admin(code: str, message: str):
    # Le front reconnaît « élévation » dans le message (et peut lire detail.code)
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": code, "message": message})


def exiger_elevation(request: Request, user: dict) -> dict:
    """403 sauf jeton d'élévation valide (X-Admin-Token) ou code admin (X-Admin-Password).

    403 et non 401 : le front déconnecte l'employé sur tout 401.
    """
    jeton = (request.headers.get("x-admin-token") or "").strip()
    if jeton:
        try:
            payload = jwt.decode(jeton, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        except JWTError:
            payload = None
        if (payload and payload.get("typ") == _ADMIN_TYP and payload.get("admin") is True
                and payload.get("sub") == user.get("sub")):
            return {**user, "admin": True}
    password = request.headers.get("x-admin-password")
    if password:
        if controler_admin_password(request, password):
            return {**user, "admin": True}
        _refus_admin("admin_invalide", "Code admin incorrect.")
    if jeton:
        _refus_admin("admin_expire", "Élévation administrateur expirée : identifiez-vous à nouveau.")
    _refus_admin("admin_requis", "Élévation administrateur requise pour cette action.")


def require_admin(request: Request, user: dict = Depends(get_current_user)) -> dict:
    """Dépendance : action réservée à l'admin (élévation de moins de 10 min)."""
    return exiger_elevation(request, user)


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
    token = create_token(req.target, utilisateur)

    return TokenResponse(
        access_token=token,
        target=req.target,
        utilisateur=utilisateur,
    )


class SwitchUserRequest(BaseModel):
    utilisateur: str


@router.post("/switch-user", response_model=TokenResponse)
def switch_user(req: SwitchUserRequest, user: dict = Depends(get_current_user)):
    """Change d'utilisateur sans re-saisir le PIN (le token courant est valide)."""
    target = user["target"]
    utilisateur = _membre_autorise(req.utilisateur, target)
    token = create_token(target, utilisateur)
    return TokenResponse(
        access_token=token,
        target=target,
        utilisateur=utilisateur,
    )


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
    return {
        "utilisateur": user["sub"],
        "target": user["target"],
        "role": role,
    }
