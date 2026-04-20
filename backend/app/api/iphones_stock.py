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


_APPLE_CDN = "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is"


def _apple_url(slug: str) -> str:
    return f"{_APPLE_CDN}/{slug}?wid=940&hei=1112&fmt=png-alpha&.v=1"


def _seed_default():
    """Seed 12 iPhones initiaux si la table est vide."""
    with get_cursor() as cur:
        cur.execute("SELECT COUNT(*) AS c FROM iphones_stock")
        row = cur.fetchone()
        count = row["c"] if isinstance(row, dict) else row[0]
        if count > 0:
            return

        a = lambda slug: _apple_url(slug)
        data = [
            # (model, model_key, storage, color_name, color_hex, color_key, condition, price, old_price, stock, image_url)
            ("iPhone 16 Pro Max", "iphone-16-pro-max", "256GB", "Titane Naturel", "#b8a898", "natural-titanium", "Neuf", 1299, 1499, 3,
             a("iphone-16-pro-finish-select-202409-6-9inch-naturaltitanium")),
            ("iPhone 16 Pro", "iphone-16-pro", "128GB", "Titane Noir", "#3a3a3e", "black-titanium", "Neuf", 1049, 1229, 5,
             a("iphone-16-pro-finish-select-202409-6-3inch-blacktitanium")),
            ("iPhone 16", "iphone-16", "128GB", "Bleu Ultramarin", "#3a5a8a", "ultramarine", "Neuf", 849, 969, 8,
             a("iphone-16-finish-select-202409-6-1inch-ultramarine")),
            ("iPhone 16", "iphone-16", "128GB", "Rose", "#f5c7c7", "pink", "Neuf", 849, 969, 4,
             a("iphone-16-finish-select-202409-6-1inch-pink")),
            ("iPhone 16", "iphone-16", "128GB", "Vert Sarcelle", "#7ea89a", "teal", "Neuf", 849, 969, 3,
             a("iphone-16-finish-select-202409-6-1inch-teal")),
            ("iPhone 15 Pro Max", "iphone-15-pro-max", "256GB", "Titane Naturel", "#b8a898", "natural-titanium", "Reconditionné Premium", 949, 1099, 2,
             a("iphone-15-pro-finish-select-202309-6-7inch-naturaltitanium")),
            ("iPhone 15 Pro", "iphone-15-pro", "128GB", "Titane Bleu", "#2d4a6e", "blue-titanium", "Reconditionné Premium", 749, 899, 4,
             a("iphone-15-pro-finish-select-202309-6-1inch-bluetitanium")),
            ("iPhone 14 Pro Max", "iphone-14-pro-max", "256GB", "Noir Sidéral", "#2a2a2e", "space-black", "Reconditionné", 649, 799, 3,
             a("iphone-14-pro-finish-select-202209-6-7inch-spaceblack")),
            ("iPhone 14 Pro", "iphone-14-pro", "128GB", "Violet Intense", "#6a4a7a", "deep-purple", "Reconditionné", 499, 649, 5,
             a("iphone-14-pro-finish-select-202209-6-1inch-deeppurple")),
            ("iPhone 14", "iphone-14", "128GB", "Bleu", "#3a5a7a", "blue", "Reconditionné", 399, 499, 7,
             a("iphone-14-finish-select-202209-6-1inch-blue")),
            ("iPhone 13", "iphone-13", "128GB", "Minuit", "#1a2030", "midnight", "Reconditionné", 349, 449, 9, None),
            ("iPhone 12", "iphone-12", "64GB", "Bleu Pacifique", "#3a6a8a", "blue", "Reconditionné", 249, 349, 6, None),
        ]
        for d in data:
            cur.execute(
                """
                INSERT INTO iphones_stock
                (model, model_key, storage, color_name, color_hex, color_key,
                 condition, price, old_price, stock, image_url)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                d,
            )
        logger.info("iphones_stock : %d modèles seed", len(data))


def _backfill_image_urls():
    """Applique les URLs officielles apple.com aux lignes existantes
    dont image_url est NULL. Migration one-shot : ne touche que les rows
    sans image déjà définie (force=False).

    Si la ligne a une image pngimg.com (ancien seed), on la remplace aussi
    par l'officielle Apple (car pngimg est peu fiable)."""
    mappings = [
        # (model, color_name, slug Apple CDN)
        # iPhone 16 Pro Max (6.9 inch)
        ("iPhone 16 Pro Max", "Titane Naturel",
         "iphone-16-pro-finish-select-202409-6-9inch-naturaltitanium"),
        ("iPhone 16 Pro Max", "Titane Noir",
         "iphone-16-pro-finish-select-202409-6-9inch-blacktitanium"),
        ("iPhone 16 Pro Max", "Titane Blanc",
         "iphone-16-pro-finish-select-202409-6-9inch-whitetitanium"),
        ("iPhone 16 Pro Max", "Titane Désert",
         "iphone-16-pro-finish-select-202409-6-9inch-deserttitanium"),
        # iPhone 16 Pro (6.3 inch)
        ("iPhone 16 Pro", "Titane Naturel",
         "iphone-16-pro-finish-select-202409-6-3inch-naturaltitanium"),
        ("iPhone 16 Pro", "Titane Noir",
         "iphone-16-pro-finish-select-202409-6-3inch-blacktitanium"),
        ("iPhone 16 Pro", "Titane Blanc",
         "iphone-16-pro-finish-select-202409-6-3inch-whitetitanium"),
        ("iPhone 16 Pro", "Titane Désert",
         "iphone-16-pro-finish-select-202409-6-3inch-deserttitanium"),
        # iPhone 16 (standard)
        ("iPhone 16", "Noir",
         "iphone-16-finish-select-202409-6-1inch-black"),
        ("iPhone 16", "Blanc",
         "iphone-16-finish-select-202409-6-1inch-white"),
        ("iPhone 16", "Rose",
         "iphone-16-finish-select-202409-6-1inch-pink"),
        ("iPhone 16", "Vert Sarcelle",
         "iphone-16-finish-select-202409-6-1inch-teal"),
        ("iPhone 16", "Bleu Ultramarin",
         "iphone-16-finish-select-202409-6-1inch-ultramarine"),
        # iPhone 15 Pro Max (6.7 inch)
        ("iPhone 15 Pro Max", "Titane Naturel",
         "iphone-15-pro-finish-select-202309-6-7inch-naturaltitanium"),
        ("iPhone 15 Pro Max", "Titane Bleu",
         "iphone-15-pro-finish-select-202309-6-7inch-bluetitanium"),
        ("iPhone 15 Pro Max", "Titane Blanc",
         "iphone-15-pro-finish-select-202309-6-7inch-whitetitanium"),
        ("iPhone 15 Pro Max", "Titane Noir",
         "iphone-15-pro-finish-select-202309-6-7inch-blacktitanium"),
        # iPhone 15 Pro (6.1 inch)
        ("iPhone 15 Pro", "Titane Naturel",
         "iphone-15-pro-finish-select-202309-6-1inch-naturaltitanium"),
        ("iPhone 15 Pro", "Titane Bleu",
         "iphone-15-pro-finish-select-202309-6-1inch-bluetitanium"),
        # iPhone 14 Pro Max
        ("iPhone 14 Pro Max", "Noir Sidéral",
         "iphone-14-pro-finish-select-202209-6-7inch-spaceblack"),
        ("iPhone 14 Pro Max", "Violet Intense",
         "iphone-14-pro-finish-select-202209-6-7inch-deeppurple"),
        ("iPhone 14 Pro Max", "Or",
         "iphone-14-pro-finish-select-202209-6-7inch-gold"),
        ("iPhone 14 Pro Max", "Argent",
         "iphone-14-pro-finish-select-202209-6-7inch-silver"),
        # iPhone 14 Pro
        ("iPhone 14 Pro", "Noir Sidéral",
         "iphone-14-pro-finish-select-202209-6-1inch-spaceblack"),
        ("iPhone 14 Pro", "Violet Intense",
         "iphone-14-pro-finish-select-202209-6-1inch-deeppurple"),
        # iPhone 14
        ("iPhone 14", "Bleu",
         "iphone-14-finish-select-202209-6-1inch-blue"),
        ("iPhone 14", "Minuit",
         "iphone-14-finish-select-202209-6-1inch-midnight"),
        # iPhone 13 Pro Max (slug -select, CDN 4982)
        ("iPhone 13 Pro Max", "Bleu Alpin", "iphone-13-pro-max-blue-select"),
        ("iPhone 13 Pro Max", "Bleu Sierra", "iphone-13-pro-max-blue-select"),
        ("iPhone 13 Pro Max", "Graphite", "iphone-13-pro-max-graphite-select"),
        ("iPhone 13 Pro Max", "Or", "iphone-13-pro-max-gold-select"),
        ("iPhone 13 Pro Max", "Argent", "iphone-13-pro-max-silver-select"),
        # iPhone 13 Pro
        ("iPhone 13 Pro", "Bleu Alpin", "iphone-13-pro-blue-select"),
        ("iPhone 13 Pro", "Bleu Sierra", "iphone-13-pro-blue-select"),
        ("iPhone 13 Pro", "Graphite", "iphone-13-pro-graphite-select"),
        ("iPhone 13 Pro", "Or", "iphone-13-pro-gold-select"),
        ("iPhone 13 Pro", "Argent", "iphone-13-pro-silver-select"),
        # iPhone 13 (standard)
        ("iPhone 13", "Minuit", "iphone-13-midnight-select-2021"),
        ("iPhone 13", "Bleu", "iphone-13-blue-select-2021"),
        ("iPhone 13", "Rose", "iphone-13-pink-select-2021"),
        ("iPhone 13", "Lumière Stellaire", "iphone-13-starlight-select-2021"),
        ("iPhone 13", "Vert", "iphone-13-green-select"),
        ("iPhone 13", "(PRODUCT)RED", "iphone-13-product-red-select-2021"),
        # iPhone 12
        ("iPhone 12", "Bleu Pacifique", "iphone-12-blue-select-2020"),
        ("iPhone 12", "Bleu", "iphone-12-blue-select-2020"),
        ("iPhone 12", "Noir", "iphone-12-black-select-2020"),
        ("iPhone 12", "Blanc", "iphone-12-white-select-2020"),
        ("iPhone 12", "Vert", "iphone-12-green-select-2020"),
        ("iPhone 12", "Violet", "iphone-12-purple-select-2021"),
        ("iPhone 12", "(PRODUCT)RED", "iphone-12-red-select-2020"),
    ]
    with get_cursor() as cur:
        for model, color_name, slug in mappings:
            url = _apple_url(slug)
            # Remplace si NULL, vide, ou si c'est une URL pngimg (ancien seed)
            cur.execute(
                """
                UPDATE iphones_stock
                SET image_url = %s, updated_at = NOW()
                WHERE model = %s AND color_name = %s
                  AND (image_url IS NULL
                       OR image_url = ''
                       OR image_url LIKE 'https://pngimg.com/%%')
                """,
                (url, model, color_name),
            )


def _ensure_full_catalog():
    """Idempotent : insère chaque (model, color_name) manquant avec prix
    et image_url par défaut. Les entrées existantes ne sont PAS modifiées
    (l'admin peut avoir ajusté prix, stock, image_url custom).

    Appelé à chaque startup → la boutique se remplit automatiquement de tous
    les modèles vendables, même sur une base déjà seedée en production."""
    a = _apple_url
    # (model, model_key, storage, color_name, color_hex, color_key,
    #  condition, price, old_price, stock, image_slug)
    catalog = [
        # ─── iPhone 16 series (neuf) ───────────────────────────────
        ("iPhone 16 Pro Max", "iphone-16-pro-max", "256GB", "Titane Naturel", "#b8a898", "natural-titanium", "Neuf", 1299, 1499, 3, "iphone-16-pro-finish-select-202409-6-9inch-naturaltitanium"),
        ("iPhone 16 Pro Max", "iphone-16-pro-max", "256GB", "Titane Noir", "#3a3a3e", "black-titanium", "Neuf", 1299, 1499, 2, "iphone-16-pro-finish-select-202409-6-9inch-blacktitanium"),
        ("iPhone 16 Pro Max", "iphone-16-pro-max", "256GB", "Titane Blanc", "#e6e3dd", "white-titanium", "Neuf", 1299, 1499, 2, "iphone-16-pro-finish-select-202409-6-9inch-whitetitanium"),
        ("iPhone 16 Pro Max", "iphone-16-pro-max", "256GB", "Titane Désert", "#c9a482", "desert-titanium", "Neuf", 1299, 1499, 2, "iphone-16-pro-finish-select-202409-6-9inch-deserttitanium"),
        ("iPhone 16 Pro", "iphone-16-pro", "128GB", "Titane Naturel", "#b8a898", "natural-titanium", "Neuf", 1049, 1229, 4, "iphone-16-pro-finish-select-202409-6-3inch-naturaltitanium"),
        ("iPhone 16 Pro", "iphone-16-pro", "128GB", "Titane Noir", "#3a3a3e", "black-titanium", "Neuf", 1049, 1229, 5, "iphone-16-pro-finish-select-202409-6-3inch-blacktitanium"),
        ("iPhone 16 Pro", "iphone-16-pro", "128GB", "Titane Blanc", "#e6e3dd", "white-titanium", "Neuf", 1049, 1229, 3, "iphone-16-pro-finish-select-202409-6-3inch-whitetitanium"),
        ("iPhone 16 Pro", "iphone-16-pro", "128GB", "Titane Désert", "#c9a482", "desert-titanium", "Neuf", 1049, 1229, 3, "iphone-16-pro-finish-select-202409-6-3inch-deserttitanium"),
        ("iPhone 16", "iphone-16", "128GB", "Noir", "#1c1c1e", "black", "Neuf", 849, 969, 6, "iphone-16-finish-select-202409-6-1inch-black"),
        ("iPhone 16", "iphone-16", "128GB", "Blanc", "#f5f5f0", "white", "Neuf", 849, 969, 5, "iphone-16-finish-select-202409-6-1inch-white"),
        ("iPhone 16", "iphone-16", "128GB", "Bleu Ultramarin", "#3a5a8a", "ultramarine", "Neuf", 849, 969, 8, "iphone-16-finish-select-202409-6-1inch-ultramarine"),
        ("iPhone 16", "iphone-16", "128GB", "Rose", "#f5c7c7", "pink", "Neuf", 849, 969, 4, "iphone-16-finish-select-202409-6-1inch-pink"),
        ("iPhone 16", "iphone-16", "128GB", "Vert Sarcelle", "#7ea89a", "teal", "Neuf", 849, 969, 3, "iphone-16-finish-select-202409-6-1inch-teal"),
        # ─── iPhone 15 Pro / Pro Max (reconditionné premium) ───────
        ("iPhone 15 Pro Max", "iphone-15-pro-max", "256GB", "Titane Naturel", "#b8a898", "natural-titanium", "Reconditionné Premium", 949, 1099, 2, "iphone-15-pro-finish-select-202309-6-7inch-naturaltitanium"),
        ("iPhone 15 Pro Max", "iphone-15-pro-max", "256GB", "Titane Bleu", "#2d4a6e", "blue-titanium", "Reconditionné Premium", 949, 1099, 2, "iphone-15-pro-finish-select-202309-6-7inch-bluetitanium"),
        ("iPhone 15 Pro Max", "iphone-15-pro-max", "256GB", "Titane Blanc", "#e6e3dd", "white-titanium", "Reconditionné Premium", 949, 1099, 1, "iphone-15-pro-finish-select-202309-6-7inch-whitetitanium"),
        ("iPhone 15 Pro Max", "iphone-15-pro-max", "256GB", "Titane Noir", "#3a3a3e", "black-titanium", "Reconditionné Premium", 949, 1099, 2, "iphone-15-pro-finish-select-202309-6-7inch-blacktitanium"),
        ("iPhone 15 Pro", "iphone-15-pro", "128GB", "Titane Naturel", "#b8a898", "natural-titanium", "Reconditionné Premium", 749, 899, 3, "iphone-15-pro-finish-select-202309-6-1inch-naturaltitanium"),
        ("iPhone 15 Pro", "iphone-15-pro", "128GB", "Titane Bleu", "#2d4a6e", "blue-titanium", "Reconditionné Premium", 749, 899, 4, "iphone-15-pro-finish-select-202309-6-1inch-bluetitanium"),
        # ─── iPhone 14 Pro / Pro Max (reconditionné) ───────────────
        ("iPhone 14 Pro Max", "iphone-14-pro-max", "256GB", "Noir Sidéral", "#2a2a2e", "space-black", "Reconditionné", 649, 799, 3, "iphone-14-pro-finish-select-202209-6-7inch-spaceblack"),
        ("iPhone 14 Pro Max", "iphone-14-pro-max", "256GB", "Violet Intense", "#6a4a7a", "deep-purple", "Reconditionné", 649, 799, 2, "iphone-14-pro-finish-select-202209-6-7inch-deeppurple"),
        ("iPhone 14 Pro", "iphone-14-pro", "128GB", "Noir Sidéral", "#2a2a2e", "space-black", "Reconditionné", 499, 649, 4, "iphone-14-pro-finish-select-202209-6-1inch-spaceblack"),
        ("iPhone 14 Pro", "iphone-14-pro", "128GB", "Violet Intense", "#6a4a7a", "deep-purple", "Reconditionné", 499, 649, 5, "iphone-14-pro-finish-select-202209-6-1inch-deeppurple"),
        ("iPhone 14", "iphone-14", "128GB", "Bleu", "#3a5a7a", "blue", "Reconditionné", 399, 499, 7, "iphone-14-finish-select-202209-6-1inch-blue"),
        # ─── iPhone 13 Pro / Pro Max (reconditionné premium) ───────
        ("iPhone 13 Pro Max", "iphone-13-pro-max", "128GB", "Bleu Sierra", "#3a5a7a", "sierra-blue", "Reconditionné Premium", 649, 799, 3, "iphone-13-pro-max-blue-select"),
        ("iPhone 13 Pro Max", "iphone-13-pro-max", "128GB", "Graphite", "#3a3a3a", "graphite", "Reconditionné Premium", 649, 799, 3, "iphone-13-pro-max-graphite-select"),
        ("iPhone 13 Pro Max", "iphone-13-pro-max", "128GB", "Or", "#d4b896", "gold", "Reconditionné Premium", 649, 799, 2, "iphone-13-pro-max-gold-select"),
        ("iPhone 13 Pro Max", "iphone-13-pro-max", "128GB", "Argent", "#e6e6e6", "silver", "Reconditionné Premium", 649, 799, 2, "iphone-13-pro-max-silver-select"),
        ("iPhone 13 Pro", "iphone-13-pro", "128GB", "Bleu Sierra", "#3a5a7a", "sierra-blue", "Reconditionné Premium", 499, 649, 4, "iphone-13-pro-blue-select"),
        ("iPhone 13 Pro", "iphone-13-pro", "128GB", "Graphite", "#3a3a3a", "graphite", "Reconditionné Premium", 499, 649, 4, "iphone-13-pro-graphite-select"),
        ("iPhone 13 Pro", "iphone-13-pro", "128GB", "Or", "#d4b896", "gold", "Reconditionné Premium", 499, 649, 3, "iphone-13-pro-gold-select"),
        ("iPhone 13 Pro", "iphone-13-pro", "128GB", "Argent", "#e6e6e6", "silver", "Reconditionné Premium", 499, 649, 3, "iphone-13-pro-silver-select"),
        # ─── iPhone 13 (reconditionné) ─────────────────────────────
        ("iPhone 13", "iphone-13", "128GB", "Minuit", "#1a2030", "midnight", "Reconditionné", 349, 449, 6, "iphone-13-midnight-select-2021"),
        ("iPhone 13", "iphone-13", "128GB", "Bleu", "#4a6a9a", "blue", "Reconditionné", 349, 449, 5, "iphone-13-blue-select-2021"),
        ("iPhone 13", "iphone-13", "128GB", "Rose", "#f5c7c7", "pink", "Reconditionné", 349, 449, 4, "iphone-13-pink-select-2021"),
        ("iPhone 13", "iphone-13", "128GB", "Lumière Stellaire", "#eee5d6", "starlight", "Reconditionné", 349, 449, 5, "iphone-13-starlight-select-2021"),
        ("iPhone 13", "iphone-13", "128GB", "Vert", "#3a5a4a", "green", "Reconditionné", 349, 449, 3, "iphone-13-green-select"),
        ("iPhone 13", "iphone-13", "128GB", "(PRODUCT)RED", "#c32333", "product-red", "Reconditionné", 349, 449, 3, "iphone-13-product-red-select-2021"),
        # ─── iPhone 12 (reconditionné) ─────────────────────────────
        ("iPhone 12", "iphone-12", "64GB", "Bleu", "#2a5a8a", "blue", "Reconditionné", 249, 349, 6, "iphone-12-blue-select-2020"),
        ("iPhone 12", "iphone-12", "64GB", "Noir", "#1c1c1e", "black", "Reconditionné", 249, 349, 5, "iphone-12-black-select-2020"),
        ("iPhone 12", "iphone-12", "64GB", "Blanc", "#f5f5f0", "white", "Reconditionné", 249, 349, 4, "iphone-12-white-select-2020"),
        ("iPhone 12", "iphone-12", "64GB", "Vert", "#9ac2a8", "green", "Reconditionné", 249, 349, 4, "iphone-12-green-select-2020"),
        ("iPhone 12", "iphone-12", "64GB", "Violet", "#bba1c8", "purple", "Reconditionné", 249, 349, 3, "iphone-12-purple-select-2021"),
        ("iPhone 12", "iphone-12", "64GB", "(PRODUCT)RED", "#c32333", "product-red", "Reconditionné", 249, 349, 3, "iphone-12-red-select-2020"),
    ]
    added = 0
    with get_cursor() as cur:
        for row in catalog:
            (model, model_key, storage, color_name, color_hex, color_key,
             condition, price, old_price, stock, slug) = row
            image_url = a(slug) if slug else None
            # Check existence (model + color_name) — pas sur storage pour éviter
            # de dupliquer si l'admin a changé 128GB→256GB
            cur.execute(
                "SELECT id FROM iphones_stock WHERE model = %s AND color_name = %s LIMIT 1",
                (model, color_name),
            )
            if cur.fetchone():
                continue
            cur.execute(
                """
                INSERT INTO iphones_stock
                (model, model_key, storage, color_name, color_hex, color_key,
                 condition, price, old_price, stock, image_url)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (model, model_key, storage, color_name, color_hex, color_key,
                 condition, price, old_price, stock, image_url),
            )
            added += 1
    if added:
        logger.info("Catalogue iphones_stock : %d nouvelles entrees ajoutees", added)


def _deferred_init():
    """Backfill + catalogue en background (non-bloquant pour le startup Railway)."""
    try:
        _backfill_image_urls()
    except Exception as e:
        logger.warning("Backfill image_urls: %s", e)
    try:
        _ensure_full_catalog()
    except Exception as e:
        logger.warning("Ensure full catalog: %s", e)


def init_iphones_stock():
    """Appelé au startup. Table + seed inline (rapide), reste en thread."""
    _ensure_table()
    _seed_default()
    # Backfill + catalogue lancés en background pour ne pas bloquer le boot Railway
    import threading
    threading.Thread(target=_deferred_init, daemon=True, name="iphones_deferred_init").start()


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
