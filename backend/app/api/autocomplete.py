"""
API Autocomplete — recherche intelligente et apprentissage des termes.
Endpoints publics (pas d'authentification requise).
"""

from fastapi import APIRouter, HTTPException, Query
from app.database import get_cursor

router = APIRouter(prefix="/api/autocomplete", tags=["autocomplete"])


@router.get("/search")
async def search(
    categorie: str = Query(...),
    q: str = Query(""),
    limit: int = Query(8, le=50),
):
    """Recherche autocomplete par catégorie."""
    if len(q) < 1:
        return []

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
                """SELECT DISTINCT modele, marque FROM tarifs_reparations
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
                         AND terme NOT IN (SELECT DISTINCT modele FROM tarifs_reparations)
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
        with get_cursor() as cur:
            cur.execute(
                """SELECT id, nom, prenom, telephone, email FROM clients
                   WHERE LOWER(nom) LIKE LOWER(%s)
                      OR LOWER(prenom) LIKE LOWER(%s)
                      OR telephone LIKE %s
                   ORDER BY CASE WHEN LOWER(nom) LIKE LOWER(%s) THEN 0 ELSE 1 END,
                            nom, prenom
                   LIMIT %s""",
                (pattern, pattern, pattern, pattern, limit),
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


@router.post("/learn")
async def learn(body: dict):
    """Enregistre un terme pour l'autocomplétion (upsert compteur)."""
    categorie = body.get("categorie")
    terme = body.get("terme")

    if not categorie or not terme or len(terme.strip()) < 2:
        return {"success": False}

    try:
        with get_cursor() as cur:
            cur.execute(
                """INSERT INTO autocompletion (categorie, terme, compteur, derniere_utilisation)
                   VALUES (%s, %s, 1, NOW())
                   ON CONFLICT (categorie, terme) DO UPDATE
                   SET compteur = autocompletion.compteur + 1,
                       derniere_utilisation = NOW()""",
                (categorie, terme.strip()),
            )
        return {"success": True}
    except Exception:
        return {"success": False}


def learn_terms(data: dict):
    """Apprend automatiquement les termes d'un ticket pour l'autocomplétion.

    Appelé après la création d'un ticket. Ne bloque jamais la création
    du ticket en cas d'erreur.
    """
    try:
        entries = []

        panne = data.get("panne")
        if panne and isinstance(panne, str) and len(panne.strip()) >= 2:
            entries.append(("panne", panne.strip()))

        panne_detail = data.get("panne_detail")
        if panne_detail and isinstance(panne_detail, str) and len(panne_detail.strip()) >= 2:
            entries.append(("detail_panne", panne_detail.strip()))

        modele_autre = data.get("modele_autre")
        if modele_autre and isinstance(modele_autre, str) and len(modele_autre.strip()) >= 2:
            entries.append(("modele_custom", modele_autre.strip()))

        if entries:
            with get_cursor() as cur:
                for categorie, terme in entries:
                    cur.execute(
                        """INSERT INTO autocompletion (categorie, terme, compteur, derniere_utilisation)
                           VALUES (%s, %s, 1, NOW())
                           ON CONFLICT (categorie, terme) DO UPDATE
                           SET compteur = autocompletion.compteur + 1,
                               derniere_utilisation = NOW()""",
                        (categorie, terme),
                    )
    except Exception:
        pass
