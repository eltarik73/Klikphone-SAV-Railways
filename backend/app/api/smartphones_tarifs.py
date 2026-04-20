"""
API Tarifs Smartphones (non-Apple) — Samsung, Xiaomi, Honor, Google Pixel, etc.

Meme structure que iphone_tarifs.py mais dedie aux autres marques.
Permet a l'admin de gerer sa propre liste de smartphones reconditionnes/neufs
avec prix, storage, condition et image auto-generée (par IA) ou uploadée.
"""

import logging
from typing import List, Optional

import httpx
from fastapi import APIRouter, HTTPException
from psycopg2.extras import execute_values
from pydantic import BaseModel

from app.database import get_cursor


router = APIRouter(prefix="/api/smartphones-tarifs", tags=["smartphones-tarifs"])
logger = logging.getLogger(__name__)


def _ensure_table():
    """Crée la table smartphones_tarifs si elle n'existe pas.
    Migration idempotente : ajoute les colonnes stock_N si absentes."""
    with get_cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS smartphones_tarifs (
                id SERIAL PRIMARY KEY,
                slug TEXT UNIQUE NOT NULL,
                marque TEXT NOT NULL,
                modele TEXT NOT NULL,
                ordre INTEGER DEFAULT 0,
                stockage_1 TEXT,
                prix_1 INTEGER,
                stock_1 INTEGER DEFAULT 0,
                stockage_2 TEXT,
                prix_2 INTEGER,
                stock_2 INTEGER DEFAULT 0,
                stockage_3 TEXT,
                prix_3 INTEGER,
                stock_3 INTEGER DEFAULT 0,
                condition TEXT DEFAULT 'Reconditionné Premium',
                image_url TEXT,
                actif BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
            ALTER TABLE smartphones_tarifs ADD COLUMN IF NOT EXISTS stock_1 INTEGER DEFAULT 0;
            ALTER TABLE smartphones_tarifs ADD COLUMN IF NOT EXISTS stock_2 INTEGER DEFAULT 0;
            ALTER TABLE smartphones_tarifs ADD COLUMN IF NOT EXISTS stock_3 INTEGER DEFAULT 0;
            CREATE INDEX IF NOT EXISTS idx_smartphones_tarifs_ordre ON smartphones_tarifs(ordre);
            CREATE INDEX IF NOT EXISTS idx_smartphones_tarifs_marque ON smartphones_tarifs(marque);
        """)


def _seed_default():
    """Seed quelques modèles populaires si la table est vide."""
    with get_cursor() as cur:
        cur.execute("SELECT COUNT(*) AS c FROM smartphones_tarifs")
        row = cur.fetchone()
        count = row["c"] if isinstance(row, dict) else row[0]
        if count > 0:
            return

        # Modèles suggérés par défaut — l'admin peut tout modifier
        data = [
            # (slug, marque, modele, ordre, s1, p1, s2, p2, condition)
            ("samsung-galaxy-a17", "Samsung", "Galaxy A17", 10, "128 Go", 199, "256 Go", 249, "Neuf"),
            ("samsung-galaxy-a55", "Samsung", "Galaxy A55", 20, "128 Go", 349, "256 Go", 399, "Neuf"),
            ("samsung-galaxy-s24", "Samsung", "Galaxy S24", 30, "128 Go", 699, "256 Go", 799, "Reconditionné Premium"),
            ("samsung-galaxy-s24-ultra", "Samsung", "Galaxy S24 Ultra", 40, "256 Go", 999, "512 Go", 1199, "Reconditionné Premium"),
            ("xiaomi-redmi-a5", "Xiaomi", "Redmi A5", 50, "64 Go", 99, "128 Go", 129, "Neuf"),
            ("xiaomi-redmi-note-14", "Xiaomi", "Redmi Note 14", 60, "128 Go", 199, "256 Go", 249, "Neuf"),
            ("xiaomi-14", "Xiaomi", "Xiaomi 14", 70, "256 Go", 599, "512 Go", 699, "Reconditionné Premium"),
            ("google-pixel-8", "Google", "Pixel 8", 80, "128 Go", 499, "256 Go", 569, "Reconditionné Premium"),
            ("google-pixel-8-pro", "Google", "Pixel 8 Pro", 90, "128 Go", 699, "256 Go", 799, "Reconditionné Premium"),
            ("honor-magic6-pro", "Honor", "Magic6 Pro", 100, "512 Go", 899, None, None, "Reconditionné Premium"),
        ]
        # Batch INSERT en 1 round-trip (au lieu de 10) via execute_values
        execute_values(
            cur,
            """
            INSERT INTO smartphones_tarifs
            (slug, marque, modele, ordre, stockage_1, prix_1,
             stockage_2, prix_2, condition)
            VALUES %s
            ON CONFLICT (slug) DO NOTHING
            """,
            data,
        )
        logger.info("smartphones_tarifs : %d modèles seed", len(data))


def init_smartphones_tarifs():
    """À appeler au startup."""
    _ensure_table()
    try:
        _seed_default()
    except Exception as e:
        logger.warning("smartphones_tarifs seed: %s", e)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class SmartphoneCreate(BaseModel):
    slug: str
    marque: str
    modele: str
    ordre: int = 0
    stockage_1: Optional[str] = None
    prix_1: Optional[int] = None
    stock_1: Optional[int] = 0
    stockage_2: Optional[str] = None
    prix_2: Optional[int] = None
    stock_2: Optional[int] = 0
    stockage_3: Optional[str] = None
    prix_3: Optional[int] = None
    stock_3: Optional[int] = 0
    condition: str = "Reconditionné Premium"
    image_url: Optional[str] = None


class SmartphoneUpdate(BaseModel):
    marque: Optional[str] = None
    modele: Optional[str] = None
    ordre: Optional[int] = None
    stockage_1: Optional[str] = None
    prix_1: Optional[int] = None
    stock_1: Optional[int] = None
    stockage_2: Optional[str] = None
    prix_2: Optional[int] = None
    stock_2: Optional[int] = None
    stockage_3: Optional[str] = None
    prix_3: Optional[int] = None
    stock_3: Optional[int] = None
    condition: Optional[str] = None
    image_url: Optional[str] = None
    actif: Optional[bool] = None


# ---------------------------------------------------------------------------
# CRUD endpoints
# ---------------------------------------------------------------------------
@router.get("")
def list_smartphones(active_only: bool = True):
    """Liste tous les smartphones triés par ordre."""
    sql = "SELECT * FROM smartphones_tarifs"
    if active_only:
        sql += " WHERE actif = TRUE"
    sql += " ORDER BY marque ASC, ordre ASC, modele ASC"
    with get_cursor() as cur:
        cur.execute(sql)
        return [dict(r) for r in cur.fetchall()]


@router.post("")
def create_smartphone(payload: SmartphoneCreate):
    """Crée un nouveau smartphone (mode admin)."""
    with get_cursor() as cur:
        cur.execute(
            """
            INSERT INTO smartphones_tarifs
            (slug, marque, modele, ordre,
             stockage_1, prix_1, stock_1,
             stockage_2, prix_2, stock_2,
             stockage_3, prix_3, stock_3,
             condition, image_url)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (slug) DO UPDATE SET
                marque = EXCLUDED.marque, modele = EXCLUDED.modele,
                ordre = EXCLUDED.ordre,
                stockage_1 = EXCLUDED.stockage_1, prix_1 = EXCLUDED.prix_1,
                stock_1 = EXCLUDED.stock_1,
                stockage_2 = EXCLUDED.stockage_2, prix_2 = EXCLUDED.prix_2,
                stock_2 = EXCLUDED.stock_2,
                stockage_3 = EXCLUDED.stockage_3, prix_3 = EXCLUDED.prix_3,
                stock_3 = EXCLUDED.stock_3,
                condition = EXCLUDED.condition,
                image_url = EXCLUDED.image_url,
                updated_at = NOW()
            RETURNING *
            """,
            (payload.slug, payload.marque, payload.modele, payload.ordre,
             payload.stockage_1, payload.prix_1, payload.stock_1 or 0,
             payload.stockage_2, payload.prix_2, payload.stock_2 or 0,
             payload.stockage_3, payload.prix_3, payload.stock_3 or 0,
             payload.condition, payload.image_url),
        )
        row = cur.fetchone()
    _invalidate_phones_cache()
    return dict(row)


def _invalidate_phones_cache():
    """Invalide le cache in-memory de _tarifs_to_phones apres un CRUD."""
    try:
        from app.api.iphones_stock import _invalidate_tarifs_cache
        _invalidate_tarifs_cache()
    except Exception:
        pass


@router.patch("/{tarif_id}")
def update_smartphone(tarif_id: int, payload: SmartphoneUpdate):
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(400, "Aucun champ à mettre à jour")
    set_clauses = ", ".join(f"{k} = %s" for k in data.keys())
    values = list(data.values()) + [tarif_id]
    with get_cursor() as cur:
        cur.execute(
            f"UPDATE smartphones_tarifs SET {set_clauses}, updated_at = NOW() "
            f"WHERE id = %s RETURNING *",
            values,
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Smartphone non trouvé")
    _invalidate_phones_cache()
    return dict(row)


@router.delete("/{tarif_id}")
def delete_smartphone(tarif_id: int):
    """Soft delete (active = false)."""
    with get_cursor() as cur:
        cur.execute(
            "UPDATE smartphones_tarifs SET actif = FALSE, updated_at = NOW() "
            "WHERE id = %s RETURNING id",
            (tarif_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Smartphone non trouvé")
    _invalidate_phones_cache()
    return {"ok": True, "id": tarif_id}


# ---------------------------------------------------------------------------
# Génération image AI via Pollinations.ai (gratuit, sans API key)
# ---------------------------------------------------------------------------
class GenerateImageRequest(BaseModel):
    marque: str
    modele: str
    storage: Optional[str] = None


@router.post("/generate-image")
def generate_image(payload: GenerateImageRequest):
    """Recherche la vraie photo officielle du smartphone sur le web via
    DuckDuckGo Image Search (JSON API non-documentée mais stable).

    Au lieu de generer une image AI qui hallucine, on trouve une vraie photo
    marketing du produit. L'admin peut choisir parmi les alternatives
    renvoyees si la premiere ne convient pas."""
    import re
    import json
    from urllib.parse import quote

    query_parts = [payload.marque, payload.modele]
    if payload.storage:
        query_parts.append(payload.storage)
    query_parts.append("png transparent")
    query = " ".join(query_parts)

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
    }

    try:
        # Etape 1 : recuperer le token vqd depuis la page landing
        landing = httpx.get(
            f"https://duckduckgo.com/?q={quote(query)}&iar=images",
            headers=headers, timeout=10.0, follow_redirects=True,
        )
        m = re.search(r'vqd=[\'"]?(\d-[0-9\-]+)[\'"]?', landing.text)
        if not m:
            raise HTTPException(502, "Token de recherche DDG introuvable")
        vqd = m.group(1)

        # Etape 2 : appel API JSON (résultats images)
        api_url = (
            f"https://duckduckgo.com/i.js?q={quote(query)}"
            f"&o=json&p=-1&s=0&vqd={vqd}"
        )
        r = httpx.get(
            api_url,
            headers={**headers, "Referer": "https://duckduckgo.com/"},
            timeout=10.0, follow_redirects=True,
        )
        r.raise_for_status()
        data = json.loads(r.text)
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("DDG image search failed: %s", e)
        raise HTTPException(502, f"Recherche image impossible : {e}")

    results = data.get("results", [])
    candidates = []
    for res in results:
        img_url = res.get("image")
        if not img_url:
            continue
        # Filtre : prefere images de taille raisonnable et extensions
        width = res.get("width", 0)
        if width and width < 300:
            continue
        # Prefer PNG pour transparence
        candidates.append(img_url)
        if len(candidates) >= 10:
            break

    if not candidates:
        raise HTTPException(
            404, f"Aucune image trouvée pour '{query}'. Essayez autre chose."
        )

    return {
        "image_url": candidates[0],
        "alternatives": candidates[1:8],
        "query": query,
        "source": "duckduckgo_images",
    }
