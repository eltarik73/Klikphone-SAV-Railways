"""
API Autocomplete — recherche intelligente et apprentissage des termes.
Recherche publique (sauf catégorie client) ; apprentissage réservé au staff.
"""

import re
import threading
from collections import defaultdict, deque
from time import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import get_cursor
from app.api.auth import get_optional_user
from app.services import search as search_engine
from app.services.prestations import normaliser

router = APIRouter(prefix="/api/autocomplete", tags=["autocomplete"])


@router.get("/search")
def search(
    categorie: str = Query(...),
    q: str = Query(""),
    limit: int = Query(8, le=50),
    user: dict = Depends(get_optional_user),
):
    """Recherche autocomplete par catégorie.
    Les catégories panne/detail/modele sont publiques ; la catégorie 'client'
    expose des PII (téléphone, email) et exige donc un staff authentifié."""
    if len(q) < 1:
        return []
    if categorie == "client" and not user:
        raise HTTPException(401, "Authentification requise pour la recherche client")

    pattern = f"%{q}%"

    if categorie == "panne":
        with get_cursor() as cur:
            cur.execute(
                """SELECT terme, compteur FROM autocompletion
                   WHERE categorie='panne' AND LOWER(terme) LIKE LOWER(%s)
                   ORDER BY compteur DESC, derniere_utilisation DESC
                   LIMIT %s""",
                (pattern, limit),
            )
            rows = cur.fetchall()
        return [
            {"value": row["terme"], "count": row["compteur"], "source": "learned"}
            for row in rows
        ]

    elif categorie == "detail_panne":
        with get_cursor() as cur:
            cur.execute(
                """SELECT terme, compteur FROM autocompletion
                   WHERE categorie='detail_panne' AND LOWER(terme) LIKE LOWER(%s)
                   ORDER BY compteur DESC, derniere_utilisation DESC
                   LIMIT %s""",
                (pattern, limit),
            )
            rows = cur.fetchall()
        return [
            {"value": row["terme"], "count": row["compteur"], "source": "learned"}
            for row in rows
        ]

    elif categorie == "modele":
        results = []
        with get_cursor() as cur:
            cur.execute(
                """SELECT DISTINCT modele, marque FROM tarifs
                   WHERE LOWER(modele) LIKE LOWER(%s)
                   ORDER BY modele
                   LIMIT %s""",
                (pattern, limit),
            )
            rows = cur.fetchall()
        results = [
            {"value": row["modele"], "marque": row["marque"], "source": "tarifs"}
            for row in rows
        ]

        if len(results) < limit:
            remaining = limit - len(results)
            with get_cursor() as cur:
                cur.execute(
                    """SELECT terme, compteur FROM autocompletion
                       WHERE categorie='modele_custom'
                         AND LOWER(terme) LIKE LOWER(%s)
                         AND terme NOT IN (SELECT DISTINCT modele FROM tarifs)
                       ORDER BY compteur DESC, derniere_utilisation DESC
                       LIMIT %s""",
                    (pattern, remaining),
                )
                custom_rows = cur.fetchall()
            for row in custom_rows:
                results.append(
                    {"value": row["terme"], "count": row["compteur"], "source": "learned"}
                )

        return results

    elif categorie == "client":
        # Numéro tout format (06 12…, +33 6…, +33 7 11, 0612…) : clé à 9 chiffres indexée,
        # ou fragment de chiffres comparé à kp_phone_digits (comme la recherche)
        tel_sql, tel_params = "telephone LIKE %s", (pattern,)
        if re.fullmatch(r"[\d\s.+\-()/]+", q.strip()):
            look = search_engine.phone_lookup(q)
            if look and look[0] == "key":
                tel_sql, tel_params = "public.kp_phone_key(telephone) = %s", (look[1],)
            elif look:
                tel_sql, tel_params = "public.kp_phone_digits(telephone) LIKE ANY(%s::text[])", (look[1],)
        with get_cursor() as cur:
            cur.execute(
                """SELECT id, nom, prenom, telephone, email FROM clients
                   WHERE LOWER(nom) LIKE LOWER(%s)
                      OR LOWER(prenom) LIKE LOWER(%s)
                      OR """ + tel_sql + """
                   ORDER BY CASE WHEN LOWER(nom) LIKE LOWER(%s) THEN 0 ELSE 1 END,
                            nom, prenom
                   LIMIT %s""",
                (pattern, pattern, *tel_params, pattern, limit),
            )
            rows = cur.fetchall()
        return [
            {
                "id": row["id"],
                "nom": row["nom"],
                "prenom": row["prenom"],
                "telephone": row["telephone"],
                "email": row["email"],
                "source": "clients",
            }
            for row in rows
        ]

    return []


_CATEGORIES_APPRISES = {"panne", "detail_panne", "modele_custom"}
_TERME_MAX = 120
_JAMAIS_APPRIS = {"piece a commander"}
# Un même terme revu dans ce délai n'est pas recompté (création + appel du
# navigateur, sauvegardes automatiques successives).
_UPSERT_TERME = """
    INSERT INTO autocompletion (categorie, terme, compteur, derniere_utilisation)
    VALUES (%s, %s, 1, NOW())
    ON CONFLICT (categorie, terme) DO UPDATE
    SET compteur = autocompletion.compteur
            + CASE WHEN autocompletion.derniere_utilisation > NOW() - INTERVAL '30 seconds'
                   THEN 0 ELSE 1 END,
        derniere_utilisation = NOW()
"""

_LEARN_BUCKETS: dict = defaultdict(deque)
_LEARN_LIMIT = 30          # apprentissages par minute et par utilisateur
_LEARN_LOCK = threading.Lock()


def _quota_ok(cle: str) -> bool:
    now = time()
    with _LEARN_LOCK:
        bucket = _LEARN_BUCKETS[cle]
        while bucket and now - bucket[0] > 60:
            bucket.popleft()
        if len(bucket) >= _LEARN_LIMIT:
            return False
        bucket.append(now)
        if len(_LEARN_BUCKETS) > 500:
            for k in [k for k, b in _LEARN_BUCKETS.items() if not b]:
                del _LEARN_BUCKETS[k]
        return True


def est_terme_partiel(terme: str, connus) -> bool:
    """Vrai si `terme` est un mot coupé d'un terme déjà connu (« batt » de « Batterie HS »).

    Un mot entier (« Batterie » face à « Batterie HS ») n'est pas partiel.
    """
    n = normaliser(terme)
    if not n:
        return True
    for autre in connus:
        a = normaliser(autre)
        if len(a) > len(n) and a.startswith(n) and a[len(n)].isalnum():
            return True
    return False


def _terme_valide(terme) -> Optional[str]:
    if not isinstance(terme, str):
        return None
    t = " ".join(terme.split())
    if len(t) < 2 or len(t) > _TERME_MAX or normaliser(t) in _JAMAIS_APPRIS:
        return None
    return t


def _apprendre(cur, categorie: str, terme: str) -> bool:
    cur.execute(
        "SELECT terme FROM autocompletion WHERE categorie = %s AND length(terme) > %s"
        " ORDER BY compteur DESC LIMIT 500",
        (categorie, len(terme)),
    )
    if est_terme_partiel(terme, [r["terme"] for r in cur.fetchall()]):
        return False
    cur.execute(_UPSERT_TERME, (categorie, terme))
    return True


@router.post("/learn")
def learn(body: dict, user: dict = Depends(get_optional_user)):
    """Enregistre un terme pour l'autocomplétion (upsert compteur).

    Réservé au staff connecté : sans session, réponse neutre (pas de 401, qui
    déconnecterait le kiosque) — le serveur apprend déjà à la création du ticket.
    """
    categorie = body.get("categorie")
    terme = _terme_valide(body.get("terme"))
    if not user or categorie not in _CATEGORIES_APPRISES or not terme:
        return {"success": False}
    if not _quota_ok(str(user.get("sub") or "?")):
        return {"success": False}

    try:
        with get_cursor() as cur:
            appris = _apprendre(cur, categorie, terme)
        return {"success": appris}
    except Exception:
        return {"success": False}


def learn_terms(data: dict, anciens: Optional[dict] = None):
    """Apprend automatiquement les termes d'un ticket pour l'autocomplétion.

    Appelé après la création d'un ticket (ou une édition terminée). Avec
    `anciens`, seules les valeurs réellement modifiées sont apprises. Ne
    bloque jamais l'appelant en cas d'erreur (transaction à part).
    """
    try:
        entries = []
        for champ, categorie in (("panne", "panne"), ("panne_detail", "detail_panne"),
                                 ("modele_autre", "modele_custom")):
            terme = _terme_valide(data.get(champ))
            if not terme:
                continue
            if anciens is not None and normaliser(anciens.get(champ)) == normaliser(terme):
                continue
            entries.append((categorie, terme))

        if entries:
            with get_cursor() as cur:
                for categorie, terme in entries:
                    _apprendre(cur, categorie, terme)
    except Exception as e:
        print(f"[autocomplete] apprentissage ignoré : {e}")
