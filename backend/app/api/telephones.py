"""
Téléphones catalogue — vente de téléphones neufs et reconditionnés.
Scraping LCD-Phone.com pour les prix fournisseur + marge automatique.
"""

import os
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.database import get_cursor
from app.api.auth import get_current_user

router = APIRouter(prefix="/api/telephones", tags=["telephones"])

_table_checked = False


def _ensure_table():
    global _table_checked
    if _table_checked:
        return
    try:
        with get_cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS telephones_catalogue (
                    id SERIAL PRIMARY KEY,
                    marque VARCHAR(50) NOT NULL,
                    modele VARCHAR(255) NOT NULL,
                    stockage VARCHAR(20),
                    couleur VARCHAR(50),
                    grade VARCHAR(20),
                    type_produit VARCHAR(20) NOT NULL DEFAULT 'reconditionné',
                    prix_fournisseur DECIMAL(10,2),
                    prix_vente DECIMAL(10,2),
                    marge_appliquee DECIMAL(10,2),
                    stock_fournisseur INTEGER DEFAULT 0,
                    en_stock BOOLEAN DEFAULT FALSE,
                    reference_fournisseur VARCHAR(100),
                    das VARCHAR(20),
                    garantie_mois INTEGER DEFAULT 12,
                    image_url TEXT,
                    source_url TEXT,
                    derniere_sync TIMESTAMP DEFAULT NOW(),
                    actif BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_telephones_marque ON telephones_catalogue(marque)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_telephones_type ON telephones_catalogue(type_produit)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_telephones_actif ON telephones_catalogue(actif)")
        _table_checked = True
    except Exception as e:
        print(f"Warning telephones table: {e}")


def _row_to_dict(row):
    if row is None:
        return None
    d = dict(row)
    for k, v in d.items():
        if isinstance(v, datetime):
            d[k] = v.isoformat()
        elif hasattr(v, '__float__'):
            d[k] = float(v)
    return d


@router.post("/sync")
async def sync_catalogue(user: dict = Depends(get_current_user)):
    """Lance la synchronisation avec LCD-Phone."""
    _ensure_table()
    from app.services.scraper_lcdphone import sync_telephones_lcdphone
    result = sync_telephones_lcdphone()
    if result.get("success"):
        return result
    raise HTTPException(status_code=500, detail=result.get("error", "Erreur sync"))


@router.get("/probe")
async def probe_lcdphone_endpoint(user: dict = Depends(get_current_user)):
    """Diagnostic: teste le login LCD-Phone et analyse la structure HTML."""
    from app.services.scraper_lcdphone import probe_lcdphone
    return probe_lcdphone()


@router.get("/catalogue")
async def liste_telephones(
    marque: Optional[str] = None,
    type_produit: Optional[str] = None,
    grade: Optional[str] = None,
    en_stock: Optional[bool] = None,
    search: Optional[str] = None,
    tri: Optional[str] = "marque",
    user: dict = Depends(get_current_user),
):
    """Liste des téléphones avec filtres."""
    _ensure_table()
    with get_cursor() as cur:
        query = "SELECT * FROM telephones_catalogue WHERE actif = TRUE"
        params = []
        if marque:
            query += " AND marque = %s"
            params.append(marque)
        if type_produit:
            query += " AND type_produit = %s"
            params.append(type_produit)
        if grade:
            query += " AND grade = %s"
            params.append(grade)
        if en_stock is not None:
            query += " AND en_stock = %s"
            params.append(en_stock)
        if search:
            query += " AND (modele ILIKE %s OR marque ILIKE %s)"
            params.extend([f"%{search}%", f"%{search}%"])

        order_map = {
            "marque": "marque, modele, stockage",
            "prix_asc": "prix_vente ASC NULLS LAST",
            "prix_desc": "prix_vente DESC NULLS LAST",
            "nouveautes": "derniere_sync DESC",
        }
        query += f" ORDER BY {order_map.get(tri, 'marque, modele')}"
        cur.execute(query, params)
        return [_row_to_dict(r) for r in cur.fetchall()]


@router.get("/stats")
async def stats_catalogue(user: dict = Depends(get_current_user)):
    """Statistiques du catalogue."""
    _ensure_table()
    with get_cursor() as cur:
        cur.execute("""
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE en_stock = TRUE) as en_stock,
                COUNT(*) FILTER (WHERE type_produit = 'neuf') as neufs,
                COUNT(*) FILTER (WHERE type_produit = 'reconditionné') as reconditionnes,
                COUNT(DISTINCT marque) as nb_marques,
                MIN(prix_vente) as prix_min,
                MAX(prix_vente) as prix_max,
                MAX(derniere_sync) as derniere_sync
            FROM telephones_catalogue WHERE actif = TRUE
        """)
        row = cur.fetchone()
        return {
            "total": row["total"] or 0,
            "en_stock": row["en_stock"] or 0,
            "neufs": row["neufs"] or 0,
            "reconditionnes": row["reconditionnes"] or 0,
            "nb_marques": row["nb_marques"] or 0,
            "prix_min": float(row["prix_min"]) if row["prix_min"] else 0,
            "prix_max": float(row["prix_max"]) if row["prix_max"] else 0,
            "derniere_sync": row["derniere_sync"].isoformat() if row["derniere_sync"] else None,
        }


@router.get("/marques")
async def liste_marques(user: dict = Depends(get_current_user)):
    """Liste des marques disponibles."""
    _ensure_table()
    with get_cursor() as cur:
        cur.execute("""
            SELECT marque, COUNT(*) as nb_modeles,
                   COUNT(*) FILTER (WHERE en_stock = TRUE) as nb_en_stock
            FROM telephones_catalogue WHERE actif = TRUE
            GROUP BY marque ORDER BY nb_modeles DESC
        """)
        return [{"marque": r["marque"], "nb_modeles": r["nb_modeles"], "nb_en_stock": r["nb_en_stock"]} for r in cur.fetchall()]
