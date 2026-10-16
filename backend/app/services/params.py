"""
Paramètres boutique (table params) en cache mémoire : une requête toutes les 30 s au plus.

Toute écriture de params (config, admin, auth) appelle invalidate() APRÈS son commit.
Le cache contient aussi les secrets (webhook, clés API, SMTP) : il ne sert qu'aux
lectures côté serveur et n'est jamais renvoyé tel quel par un endpoint.
"""

import threading
import time

from app.database import get_cursor

TTL = 30

# Le verrou ne protège que l'état, jamais une requête : aucun thread n'attend
# une connexion du pool en le tenant.
_verrou = threading.Lock()
_etat = {"valeurs": None, "expire": 0.0, "generation": 0}


def _valeurs(cur=None) -> dict:
    with _verrou:
        if _etat["valeurs"] is not None and time.monotonic() < _etat["expire"]:
            return _etat["valeurs"]
        generation = _etat["generation"]
    # Curseur de l'appelant si fourni : pas de seconde connexion prise au pool
    if cur is not None:
        cur.execute("SELECT cle, valeur FROM params")
        rows = cur.fetchall()
    else:
        with get_cursor() as c:
            c.execute("SELECT cle, valeur FROM params")
            rows = c.fetchall()
    valeurs = {r["cle"]: r["valeur"] for r in rows or []}
    with _verrou:
        # Invalidé pendant la lecture : la valeur lue est servie, pas mise en cache
        if generation == _etat["generation"]:
            _etat["valeurs"] = valeurs
            _etat["expire"] = time.monotonic() + TTL
    return valeurs


def get_param(cle: str, defaut: str = "", cur=None) -> str:
    """Valeur du paramètre, `defaut` s'il est absent ou NULL."""
    v = _valeurs(cur).get(cle)
    return defaut if v is None else v


def get_params(cles, defauts: dict = None, cur=None) -> dict:
    """{cle: valeur} pour chaque clé demandée ; défaut (sinon "") si absente ou NULL."""
    valeurs = _valeurs(cur)
    defauts = defauts or {}
    out = {}
    for cle in cles:
        v = valeurs.get(cle)
        out[cle] = defauts.get(cle, "") if v is None else v
    return out


def invalidate():
    with _verrou:
        _etat["valeurs"] = None
        _etat["expire"] = 0.0
        _etat["generation"] += 1
