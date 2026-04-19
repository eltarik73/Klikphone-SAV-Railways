"""
API Ventes iPhone — stock de téléphones neufs + reconditionnés en vente.
Associé au générateur vidéo Story 9:16 pour Instagram/TikTok.
"""

import logging
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.database import get_cursor


router = APIRouter(prefix="/api/iphones", tags=["iphones-stock"])
_ASSETS_DIR = Path(__file__).parent.parent / "assets" / "iphone_tarifs"
logger = logging.getLogger(__name__)


def _ensure_table():
    """Crée la table iphones_stock si elle n'existe pas."""
    with get_cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS iphones_stock (
                id SERIAL PRIMARY KEY,
                model VARCHAR(100) NOT NULL,
                model_key VARCHAR(50) NOT NULL,
                storage VARCHAR(20) NOT NULL,
                color_name VARCHAR(50) NOT NULL,
                color_hex VARCHAR(10),
                color_key VARCHAR(30),
                condition VARCHAR(30) NOT NULL,
                price INTEGER NOT NULL,
                old_price INTEGER,
                stock INTEGER DEFAULT 0,
                image_url TEXT,
                active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_iphones_stock_active ON iphones_stock(active);
            CREATE INDEX IF NOT EXISTS idx_iphones_stock_model ON iphones_stock(model_key);
        """)


def _seed_default():
    """Seed 12 iPhones initiaux si la table est vide."""
    with get_cursor() as cur:
        cur.execute("SELECT COUNT(*) AS c FROM iphones_stock")
        row = cur.fetchone()
        count = row["c"] if isinstance(row, dict) else row[0]
        if count > 0:
            return

        data = [
            ("iPhone 16 Pro Max", "iphone-16-pro-max", "256GB", "Titane Naturel", "#b8a898", "natural-titanium", "Neuf", 1299, 1499, 3),
            ("iPhone 16 Pro", "iphone-16-pro", "128GB", "Titane Noir", "#3a3a3e", "black-titanium", "Neuf", 1049, 1229, 5),
            ("iPhone 16", "iphone-16", "128GB", "Noir", "#1a1a1e", "black", "Neuf", 849, 969, 8),
            ("iPhone 15 Pro Max", "iphone-15-pro-max", "256GB", "Titane Bleu", "#2d4a6e", "blue-titanium", "Reconditionné Premium", 949, 1099, 2),
            ("iPhone 15 Pro", "iphone-15-pro", "128GB", "Titane Naturel", "#b8a898", "natural-titanium", "Reconditionné Premium", 749, 899, 4),
            ("iPhone 15", "iphone-15", "128GB", "Rose", "#f5c7c7", "pink", "Reconditionné", 549, 699, 6),
            ("iPhone 14 Pro Max", "iphone-14-pro-max", "256GB", "Noir Sidéral", "#2a2a2e", "space-black", "Reconditionné", 649, 799, 3),
            ("iPhone 14 Pro", "iphone-14-pro", "128GB", "Violet Intense", "#6a4a7a", "deep-purple", "Reconditionné", 499, 649, 5),
            ("iPhone 14", "iphone-14", "128GB", "Bleu", "#3a5a7a", "blue", "Reconditionné", 399, 499, 7),
            ("iPhone 13 Pro Max", "iphone-13-pro-max", "256GB", "Graphite", "#4a4a4e", "graphite", "Reconditionné", 449, 599, 4),
            ("iPhone 13", "iphone-13", "128GB", "Minuit", "#1a2030", "midnight", "Reconditionné", 349, 449, 9),
            ("iPhone 12", "iphone-12", "64GB", "Bleu Pacifique", "#3a6a8a", "blue", "Reconditionné", 249, 349, 6),
        ]
        for d in data:
            cur.execute(
                """
                INSERT INTO iphones_stock
                (model, model_key, storage, color_name, color_hex, color_key,
                 condition, price, old_price, stock)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                d,
            )
        logger.info("iphones_stock : %d modèles seed", len(data))


def init_iphones_stock():
    """À appeler au startup (lifespan de main.py)."""
    _ensure_table()
    _seed_default()


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class IphoneCreate(BaseModel):
    model: str
    model_key: str
    storage: str
    color_name: str
    color_hex: Optional[str] = None
    color_key: Optional[str] = None
    condition: str
    price: int
    old_price: Optional[int] = None
    stock: int = 0
    image_url: Optional[str] = None


class IphoneUpdate(BaseModel):
    model: Optional[str] = None
    model_key: Optional[str] = None
    storage: Optional[str] = None
    color_name: Optional[str] = None
    color_hex: Optional[str] = None
    color_key: Optional[str] = None
    condition: Optional[str] = None
    price: Optional[int] = None
    old_price: Optional[int] = None
    stock: Optional[int] = None
    image_url: Optional[str] = None
    active: Optional[bool] = None


class GenerateVideoRequest(BaseModel):
    ids: List[int]


# ---------------------------------------------------------------------------
# Image server — sert les photos officielles iPhone depuis backend/app/assets
# ---------------------------------------------------------------------------
@router.get("/image/{filename}")
def get_iphone_image(filename: str):
    """Sert une image iPhone depuis les assets locaux.
    Ex: /api/iphones/image/iphone_16_pro_max.jpeg"""
    # Empêche le path traversal
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Nom de fichier invalide")
    path = _ASSETS_DIR / filename
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Image introuvable")
    # Cache long (les images changent rarement)
    return FileResponse(
        str(path),
        headers={"Cache-Control": "public, max-age=604800"},
    )


# ---------------------------------------------------------------------------
# Endpoints CRUD
# ---------------------------------------------------------------------------
@router.get("")
def list_iphones(
    condition: Optional[str] = Query(None),
    model: Optional[str] = Query(None),
    active_only: bool = Query(True),
):
    """Liste les iPhones en vente. Filtres : condition, model."""
    where = []
    params = []
    if active_only:
        where.append("active = TRUE")
    if condition:
        where.append("condition = %s")
        params.append(condition)
    if model:
        where.append("model ILIKE %s")
        params.append(f"%{model}%")
    sql = "SELECT * FROM iphones_stock"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY model DESC, price DESC"
    with get_cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
    return [dict(r) for r in rows]


@router.post("")
def create_iphone(payload: IphoneCreate):
    """Crée une entrée stock iPhone (mode admin)."""
    with get_cursor() as cur:
        cur.execute(
            """
            INSERT INTO iphones_stock
            (model, model_key, storage, color_name, color_hex, color_key,
             condition, price, old_price, stock, image_url)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING *
            """,
            (
                payload.model, payload.model_key, payload.storage,
                payload.color_name, payload.color_hex, payload.color_key,
                payload.condition, payload.price, payload.old_price,
                payload.stock, payload.image_url,
            ),
        )
        row = cur.fetchone()
    return dict(row)


@router.put("/{iphone_id}")
def update_iphone(iphone_id: int, payload: IphoneUpdate):
    """Met à jour une entrée stock (mode admin)."""
    updates = payload.dict(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="Aucun champ à mettre à jour")
    set_clauses = [f"{k} = %s" for k in updates.keys()]
    set_clauses.append("updated_at = NOW()")
    values = list(updates.values()) + [iphone_id]
    sql = f"UPDATE iphones_stock SET {', '.join(set_clauses)} WHERE id = %s RETURNING *"
    with get_cursor() as cur:
        cur.execute(sql, values)
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="iPhone introuvable")
    return dict(row)


@router.delete("/{iphone_id}")
def delete_iphone(iphone_id: int):
    """Soft delete (active = false), mode admin."""
    with get_cursor() as cur:
        cur.execute(
            "UPDATE iphones_stock SET active = FALSE, updated_at = NOW() WHERE id = %s RETURNING id",
            (iphone_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="iPhone introuvable")
    return {"status": "deleted", "id": iphone_id}


# ---------------------------------------------------------------------------
# Video generation
# ---------------------------------------------------------------------------
@router.post("/generate-video")
def generate_video(payload: GenerateVideoRequest):
    """Génère une vidéo Story 9:16 à partir des iPhones sélectionnés."""
    if not payload.ids:
        raise HTTPException(status_code=400, detail="Aucun iPhone sélectionné")
    if len(payload.ids) > 8:
        raise HTTPException(status_code=400, detail="Maximum 8 iPhones par vidéo")

    with get_cursor() as cur:
        cur.execute(
            "SELECT * FROM iphones_stock WHERE id = ANY(%s) AND active = TRUE",
            (payload.ids,),
        )
        phones = [dict(r) for r in cur.fetchall()]

    if not phones:
        raise HTTPException(status_code=404, detail="Aucun iPhone trouvé")

    # Réordonner selon l'ordre des IDs fournis
    order = {i: idx for idx, i in enumerate(payload.ids)}
    phones.sort(key=lambda p: order.get(p["id"], 999))

    try:
        from app.video.generator import generate_story_video
        result = generate_story_video(phones)
        return result
    except FileNotFoundError as e:
        logger.error("ffmpeg introuvable : %s", e)
        raise HTTPException(
            status_code=503,
            detail="ffmpeg non installé sur le serveur. Ajouter ffmpeg à nixpacks.toml.",
        )
    except Exception as e:
        logger.exception("Erreur génération vidéo")
        raise HTTPException(status_code=500, detail=f"Erreur génération : {e}")
