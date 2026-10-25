"""
Référence client signée pour la voie anonyme (borne du magasin, formulaires publics).

Sans session du personnel, POST /api/clients ne renvoie plus l'identifiant nu d'une fiche
mais une référence opaque, signée (HMAC-SHA256 avec JWT_SECRET), que POST /api/tickets
exige à la place de `client_id`. Un identifiant nu ne rattache donc plus un ticket anonyme
à la fiche de n'importe qui.

Charge utile : {"cid": <id de la fiche>, "exp": <expiration, +20 min>, "ipf": <empreinte de
l'IP qui a obtenu la référence>}. La référence n'est valable que depuis la même IP et
pendant 20 minutes : le temps de remplir la borne.

Format : base64 url-safe (charge JSON) + "." + base64 url-safe (signature).
"""

import base64
import hashlib
import hmac
import json
from time import time
from typing import Optional

DUREE_S = 20 * 60


def _secret() -> bytes:
    # Import tardif : app.api.auth tire les services (presence, params) ; évite le cycle
    from app.api.auth import JWT_SECRET
    return ("kp-client-ref:" + JWT_SECRET).encode("utf-8")


def _b64(donnees: bytes) -> str:
    return base64.urlsafe_b64encode(donnees).rstrip(b"=").decode("ascii")


def _unb64(texte: str) -> bytes:
    texte = texte.strip()
    return base64.urlsafe_b64decode(texte + "=" * (-len(texte) % 4))


def empreinte_ip(ip: str) -> str:
    """Empreinte courte de l'IP (jamais l'IP en clair dans la référence)."""
    return hashlib.sha256(("kp-ref-ip:" + str(ip or "")).encode("utf-8")).hexdigest()[:16]


def signer(client_id: int, ip: str, maintenant: Optional[float] = None, duree: float = DUREE_S) -> str:
    """Référence signée pour cette fiche, cette IP et 20 minutes."""
    now = time() if maintenant is None else maintenant
    charge = json.dumps({"cid": int(client_id), "exp": int(now + duree), "ipf": empreinte_ip(ip)},
                        separators=(",", ":"), sort_keys=True).encode("utf-8")
    corps = _b64(charge)
    signature = hmac.new(_secret(), corps.encode("ascii"), hashlib.sha256).digest()
    return f"{corps}.{_b64(signature)}"


def verifier(reference, ip: str, maintenant: Optional[float] = None) -> Optional[int]:
    """Identifiant de la fiche si la référence est intacte, non expirée et obtenue depuis cette IP ;
    None sinon (jamais d'exception sur une valeur mal formée)."""
    if not isinstance(reference, str) or len(reference) > 512 or "." not in reference:
        return None
    corps, _, signature = reference.strip().partition(".")
    try:
        attendue = hmac.new(_secret(), corps.encode("ascii"), hashlib.sha256).digest()
        if not hmac.compare_digest(attendue, _unb64(signature)):
            return None
        charge = json.loads(_unb64(corps).decode("utf-8"))
    except (ValueError, UnicodeError, TypeError):
        return None
    if not isinstance(charge, dict):
        return None
    cid, exp, ipf = charge.get("cid"), charge.get("exp"), charge.get("ipf")
    if not isinstance(cid, int) or isinstance(cid, bool) or cid <= 0:
        return None
    if not isinstance(exp, (int, float)) or isinstance(exp, bool):
        return None
    now = time() if maintenant is None else maintenant
    if now > exp:
        return None
    if not isinstance(ipf, str) or not hmac.compare_digest(ipf, empreinte_ip(ip)):
        return None
    return cid
