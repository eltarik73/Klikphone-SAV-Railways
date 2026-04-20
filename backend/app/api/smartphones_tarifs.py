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
from pydantic import BaseModel

from app.database import get_cursor


router = APIRouter(prefix="/api/smartphones-tarifs", tags=["smartphones-tarifs"])
logger = logging.getLogger(__name__)


def _ensure_table():
    """Crée la table smartphones_tarifs si elle n'existe pas."""
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
                stockage_2 TEXT,
                prix_2 INTEGER,
                stockage_3 TEXT,
                prix_3 INTEGER,
                condition TEXT DEFAULT 'Reconditionné Premium',
                image_url TEXT,
                actif BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
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
        for d in data:
            slug, marque, modele, ordre, s1, p1, s2, p2, condition = d
            cur.execute(
                """
                INSERT INTO smartphones_tarifs
                (slug, marque, modele, ordre, stockage_1, prix_1,
                 stockage_2, prix_2, condition)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (slug) DO NOTHING
                """,
                (slug, marque, modele, ordre, s1, p1, s2, p2, condition),
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
    stockage_2: Optional[str] = None
    prix_2: Optional[int] = None
    stockage_3: Optional[str] = None
    prix_3: Optional[int] = None
    condition: str = "Reconditionné Premium"
    image_url: Optional[str] = None


class SmartphoneUpdate(BaseModel):
    marque: Optional[str] = None
    modele: Optional[str] = None
    ordre: Optional[int] = None
    stockage_1: Optional[str] = None
    prix_1: Optional[int] = None
    stockage_2: Optional[str] = None
    prix_2: Optional[int] = None
    stockage_3: Optional[str] = None
    prix_3: Optional[int] = None
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
            (slug, marque, modele, ordre, stockage_1, prix_1, stockage_2, prix_2,
             stockage_3, prix_3, condition, image_url)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (slug) DO UPDATE SET
                marque = EXCLUDED.marque, modele = EXCLUDED.modele,
                ordre = EXCLUDED.ordre,
                stockage_1 = EXCLUDED.stockage_1, prix_1 = EXCLUDED.prix_1,
                stockage_2 = EXCLUDED.stockage_2, prix_2 = EXCLUDED.prix_2,
                stockage_3 = EXCLUDED.stockage_3, prix_3 = EXCLUDED.prix_3,
                condition = EXCLUDED.condition,
                image_url = EXCLUDED.image_url,
                updated_at = NOW()
            RETURNING *
            """,
            (payload.slug, payload.marque, payload.modele, payload.ordre,
             payload.stockage_1, payload.prix_1, payload.stockage_2, payload.prix_2,
             payload.stockage_3, payload.prix_3, payload.condition, payload.image_url),
        )
        row = cur.fetchone()
    return dict(row)


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
    """Génère une URL d'image AI via Pollinations.ai pour un smartphone.
    Prompt optimisé pour un détourage propre et un look Apple-like."""
    prompt = (
        f"{payload.marque} {payload.modele} smartphone, "
        f"front and back view, isolated on pure white background, "
        f"product photography, studio lighting, high detail, 4K, "
        f"official marketing photo, transparent background"
    )
    # Pollinations API : URL lazy-generated, la 1re requête lance la gen
    from urllib.parse import quote
    url = (
        f"https://image.pollinations.ai/prompt/{quote(prompt)}"
        f"?width=940&height=1112&model=flux&nologo=true&enhance=true"
    )
    # Vérifie que l'URL répond (warm-up du cache Pollinations)
    try:
        r = httpx.get(url, timeout=60.0, follow_redirects=True)
        if r.status_code != 200 or len(r.content) < 5000:
            raise HTTPException(502, f"Pollinations returned {r.status_code}")
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Generation failed: {e}")
    return {"image_url": url, "prompt": prompt}
