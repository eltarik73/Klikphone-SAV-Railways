"""
API Tarifs - Gestion des prix de reparation.
Calcul automatique des prix clients a partir des prix fournisseur HT.
"""

import math
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.database import get_cursor
from app.api.auth import get_current_user

router = APIRouter(prefix="/api/tarifs", tags=["tarifs"])


# ---------------------------------------------------------------------------
# Table creation
# ---------------------------------------------------------------------------

def _ensure_table():
    """Cree la table tarifs si elle n'existe pas."""
    with get_cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS tarifs (
                id SERIAL PRIMARY KEY,
                marque VARCHAR(50) NOT NULL,
                modele VARCHAR(100) NOT NULL,
                type_piece VARCHAR(50) NOT NULL,
                qualite VARCHAR(50),
                nom_fournisseur TEXT,
                prix_fournisseur_ht DECIMAL(10,2),
                prix_client INTEGER NOT NULL,
                categorie VARCHAR(20) DEFAULT 'standard',
                source VARCHAR(50) DEFAULT 'mobilax',
                updated_at TIMESTAMP DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_tarifs_marque ON tarifs(marque);
            CREATE INDEX IF NOT EXISTS idx_tarifs_modele ON tarifs(modele);
            CREATE INDEX IF NOT EXISTS idx_tarifs_recherche ON tarifs(marque, modele, type_piece);
        """)


# NOTE: _ensure_table() is called from main.py lifespan, not here


# ---------------------------------------------------------------------------
# Pricing logic
# ---------------------------------------------------------------------------

def arrondi_9_superieur(prix: float) -> int:
    """Arrondit au 9 superieur.

    Exemples : 61->69, 72->79, 83->89, 91->99, 101->109, 145->149.
    """
    return int(math.ceil(prix / 10) * 10 - 1)


def calcul_prix_client(prix_ht: float, type_piece: str, categorie: str) -> int:
    """Calcule le prix client TTC a partir du prix fournisseur HT.

    Regles :
    - Ecrans standard  : prix_ht * 1.2 + 60, arrondi au 9 sup
    - Ecrans haut_de_gamme : prix_ht * 1.2 + 70, arrondi au 9 sup
    - Ecrans pliant    : prix_ht * 1.2 + 100, arrondi au 9 sup
    - Batteries / Connecteurs / Cameras : prix_ht * 1.2 + 60, arrondi au 9 sup
    """
    type_lower = (type_piece or "").lower()
    categorie_lower = (categorie or "standard").lower()

    is_ecran = "ecran" in type_lower or "écran" in type_lower

    if is_ecran:
        if categorie_lower == "haut_de_gamme":
            raw = prix_ht * 1.2 + 70
        elif categorie_lower == "pliant":
            raw = prix_ht * 1.2 + 100
        else:
            # standard or any other value
            raw = prix_ht * 1.2 + 60
    else:
        # Batteries, Connecteurs, Cameras, etc.
        raw = prix_ht * 1.2 + 60

    return arrondi_9_superieur(raw)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class TarifImportItem(BaseModel):
    marque: str
    modele: str
    type_piece: str
    qualite: Optional[str] = None
    nom_fournisseur: Optional[str] = None
    prix_fournisseur_ht: float
    categorie: Optional[str] = "standard"
    source: Optional[str] = "mobilax"


class TarifImportRequest(BaseModel):
    items: List[TarifImportItem]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
async def list_tarifs(
    q: Optional[str] = Query(None, description="Recherche sur marque ou modele"),
    marque: Optional[str] = Query(None, description="Filtre exact sur marque"),
):
    """Liste les tarifs avec filtres optionnels."""
    conditions = []
    params = []

    if q:
        conditions.append("(marque ILIKE %s OR modele ILIKE %s)")
        like_val = f"%{q}%"
        params.extend([like_val, like_val])

    if marque:
        conditions.append("marque = %s")
        params.append(marque)

    where = ""
    if conditions:
        where = "WHERE " + " AND ".join(conditions)

    query = f"SELECT * FROM tarifs {where} ORDER BY marque, modele, type_piece, qualite"

    with get_cursor() as cur:
        cur.execute(query, params)
        rows = cur.fetchall()

    return [dict(r) for r in rows]


@router.get("/stats")
async def get_stats():
    """Retourne des statistiques sur les tarifs."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT
                COUNT(*) AS total,
                COUNT(DISTINCT marque) AS marques,
                COUNT(DISTINCT modele) AS modeles,
                MIN(prix_client) AS prix_min,
                MAX(prix_client) AS prix_max
            FROM tarifs
        """)
        row = cur.fetchone()

    return dict(row)


@router.post("/import")
async def import_tarifs(
    body: TarifImportRequest,
    user: dict = Depends(get_current_user),
):
    """Importe une liste de tarifs. Calcule automatiquement le prix client."""
    inserted = 0

    with get_cursor() as cur:
        for item in body.items:
            prix_client = calcul_prix_client(
                item.prix_fournisseur_ht,
                item.type_piece,
                item.categorie or "standard",
            )
            cur.execute(
                """
                INSERT INTO tarifs
                    (marque, modele, type_piece, qualite, nom_fournisseur,
                     prix_fournisseur_ht, prix_client, categorie, source, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                """,
                (
                    item.marque,
                    item.modele,
                    item.type_piece,
                    item.qualite,
                    item.nom_fournisseur,
                    item.prix_fournisseur_ht,
                    prix_client,
                    item.categorie or "standard",
                    item.source or "mobilax",
                ),
            )
            inserted += 1

    return {"inserted": inserted}


@router.delete("/clear")
async def clear_tarifs(user: dict = Depends(get_current_user)):
    """Vide la table tarifs."""
    with get_cursor() as cur:
        cur.execute("TRUNCATE TABLE tarifs RESTART IDENTITY")

    return {"status": "ok"}
