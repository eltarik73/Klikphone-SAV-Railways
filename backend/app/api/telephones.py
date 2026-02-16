"""
Téléphones catalogue — vente de téléphones neufs et reconditionnés.
Scraping LCD-Phone.com pour les prix fournisseur + marge automatique.
"""

import os
import time
import threading
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel

from app.database import get_cursor
from app.api.auth import get_current_user

router = APIRouter(prefix="/api/telephones", tags=["telephones"])
logger = logging.getLogger(__name__)

_table_checked = False
_sync_status = {"running": False, "last_result": None, "started_at": None}


# ─── Simple TTL cache ────────────────────────────────
class _Cache:
    def __init__(self, ttl=300):
        self._data = {}
        self._ttl = ttl

    def get(self, key):
        entry = self._data.get(key)
        if entry and time.time() - entry[1] < self._ttl:
            return entry[0]
        self._data.pop(key, None)
        return None

    def set(self, key, value):
        self._data[key] = (value, time.time())

    def clear(self):
        self._data.clear()


_cache = _Cache(ttl=300)  # 5 min


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
            cur.execute("CREATE INDEX IF NOT EXISTS idx_telephones_prix ON telephones_catalogue(prix_vente)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_telephones_stock ON telephones_catalogue(en_stock)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_telephones_sync ON telephones_catalogue(derniere_sync DESC)")
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


def _run_sync_background():
    """Execute sync in background thread."""
    global _sync_status
    try:
        from app.services.scraper_lcdphone import sync_telephones_lcdphone
        from app.services.notifications import notif_sync_telephones
        result = sync_telephones_lcdphone()
        _sync_status["last_result"] = result
        _sync_status["finished_at"] = datetime.utcnow().isoformat()

        # Discord alert
        if result.get("success"):
            notif_sync_telephones(True, nb_produits=result.get("total", 0), nb_marques=result.get("marques", 0))
        else:
            notif_sync_telephones(False, error=result.get("error", "Erreur inconnue"))
    except Exception as e:
        logger.error(f"Background sync error: {e}")
        _sync_status["last_result"] = {"success": False, "error": str(e)}
        _sync_status["finished_at"] = datetime.utcnow().isoformat()
        try:
            from app.services.notifications import notif_sync_telephones
            notif_sync_telephones(False, error=str(e))
        except Exception:
            pass
    finally:
        _sync_status["running"] = False
        _cache.clear()  # Invalidate stats/marques cache after sync


@router.post("/sync")
async def sync_catalogue(background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    """Lance la synchronisation avec LCD-Phone en arrière-plan."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin requis")
    global _sync_status
    _ensure_table()

    if _sync_status["running"]:
        return {
            "message": "Sync déjà en cours",
            "started_at": _sync_status.get("started_at"),
        }

    _sync_status = {
        "running": True,
        "last_result": None,
        "started_at": datetime.utcnow().isoformat(),
        "finished_at": None,
    }

    background_tasks.add_task(_run_sync_background)

    return {
        "message": "Sync lancée en arrière-plan",
        "started_at": _sync_status["started_at"],
    }


@router.get("/sync-status")
async def sync_status(user: dict = Depends(get_current_user)):
    """Vérifie l'état de la synchronisation."""
    return {
        "running": _sync_status["running"],
        "started_at": _sync_status.get("started_at"),
        "finished_at": _sync_status.get("finished_at"),
        "last_result": _sync_status.get("last_result"),
    }


@router.get("/probe")
async def probe_lcdphone_endpoint(user: dict = Depends(get_current_user)):
    """Diagnostic: teste le login LCD-Phone et analyse la structure HTML."""
    from app.services.scraper_lcdphone import probe_lcdphone
    return probe_lcdphone()


_CATALOGUE_COLS = (
    "id, marque, modele, stockage, couleur, grade, type_produit, "
    "prix_vente, en_stock, stock_fournisseur, image_url, garantie_mois"
)


@router.get("/catalogue")
async def liste_telephones(
    marque: Optional[str] = None,
    type_produit: Optional[str] = None,
    grade: Optional[str] = None,
    en_stock: Optional[bool] = None,
    search: Optional[str] = None,
    tri: Optional[str] = "marque",
    page: int = Query(1, ge=1),
    limit: int = Query(24, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    """Liste des téléphones avec filtres et pagination."""
    _ensure_table()
    with get_cursor() as cur:
        where = "actif = TRUE AND modele IS NOT NULL AND modele != '' AND prix_vente IS NOT NULL AND prix_vente > 0 AND marque IS NOT NULL AND marque != ''"
        params = []
        if marque:
            where += " AND marque = %s"
            params.append(marque)
        if type_produit:
            where += " AND type_produit = %s"
            params.append(type_produit)
        if grade:
            where += " AND grade = %s"
            params.append(grade)
        if en_stock is not None:
            where += " AND en_stock = %s"
            params.append(en_stock)
        if search:
            where += " AND (modele ILIKE %s OR marque ILIKE %s)"
            params.extend([f"%{search}%", f"%{search}%"])

        # Count total
        cur.execute(f"SELECT COUNT(*) as cnt FROM telephones_catalogue WHERE {where}", params)
        total = cur.fetchone()["cnt"]

        order_map = {
            "marque": "marque, modele, stockage",
            "prix_asc": "prix_vente ASC NULLS LAST",
            "prix_desc": "prix_vente DESC NULLS LAST",
            "nouveautes": "derniere_sync DESC",
        }
        order = order_map.get(tri, "marque, modele")
        offset = (page - 1) * limit

        cur.execute(
            f"SELECT {_CATALOGUE_COLS} FROM telephones_catalogue WHERE {where} ORDER BY {order} LIMIT %s OFFSET %s",
            params + [limit, offset],
        )
        items = [_row_to_dict(r) for r in cur.fetchall()]

        return {
            "items": items,
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": max(1, (total + limit - 1) // limit),
        }


@router.get("/stats")
async def stats_catalogue(user: dict = Depends(get_current_user)):
    """Statistiques du catalogue (cached 5 min)."""
    cached = _cache.get("stats")
    if cached:
        return cached
    _ensure_table()
    with get_cursor() as cur:
        cur.execute("""
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE en_stock = TRUE) as en_stock,
                COUNT(*) FILTER (WHERE type_produit = 'neuf') as neufs,
                COUNT(*) FILTER (WHERE type_produit = 'occasion') as reconditionnes,
                COUNT(DISTINCT marque) as nb_marques,
                MIN(prix_vente) as prix_min,
                MAX(prix_vente) as prix_max,
                MAX(derniere_sync) as derniere_sync
            FROM telephones_catalogue WHERE actif = TRUE
        """)
        row = cur.fetchone()
        result = {
            "total": row["total"] or 0,
            "en_stock": row["en_stock"] or 0,
            "neufs": row["neufs"] or 0,
            "reconditionnes": row["reconditionnes"] or 0,
            "nb_marques": row["nb_marques"] or 0,
            "prix_min": float(row["prix_min"]) if row["prix_min"] else 0,
            "prix_max": float(row["prix_max"]) if row["prix_max"] else 0,
            "derniere_sync": row["derniere_sync"].isoformat() if row["derniere_sync"] else None,
        }
        _cache.set("stats", result)
        return result


@router.get("/marques")
async def liste_marques(user: dict = Depends(get_current_user)):
    """Liste des marques disponibles (cached 5 min)."""
    cached = _cache.get("marques")
    if cached:
        return cached
    _ensure_table()
    with get_cursor() as cur:
        cur.execute("""
            SELECT marque, COUNT(*) as nb_modeles,
                   COUNT(*) FILTER (WHERE en_stock = TRUE) as nb_en_stock
            FROM telephones_catalogue WHERE actif = TRUE
            GROUP BY marque ORDER BY nb_modeles DESC
        """)
        result = [{"marque": r["marque"], "nb_modeles": r["nb_modeles"], "nb_en_stock": r["nb_en_stock"]} for r in cur.fetchall()]
        _cache.set("marques", result)
        return result
