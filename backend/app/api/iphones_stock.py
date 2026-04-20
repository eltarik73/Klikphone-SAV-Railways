"""
API Ventes iPhone — stock de téléphones neufs + reconditionnés en vente.
Associé au générateur vidéo Story 9:16 pour Instagram/TikTok.
"""

import logging
import threading
import time
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from psycopg2.extras import execute_values

from app.database import get_cursor


router = APIRouter(prefix="/api/iphones", tags=["iphones-stock"])
_ASSETS_DIR = Path(__file__).parent.parent / "assets" / "iphone_tarifs"
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Cache TTL in-memory pour _tarifs_to_phones()
# Evite 2 round-trips DB a chaque appel de list_iphones() / generate_video().
# TTL court (30s) car les prix peuvent bouger via admin, et l'invalidation
# manuelle via _invalidate_tarifs_cache() est deja branchee sur les CRUD.
# ---------------------------------------------------------------------------
_TARIFS_CACHE_TTL = 30.0  # seconds
_tarifs_cache: dict = {"ts": 0.0, "data": None}
_tarifs_cache_lock = threading.Lock()


def _invalidate_tarifs_cache():
    """Vide le cache. A appeler sur tout INSERT/UPDATE/DELETE de tarifs."""
    with _tarifs_cache_lock:
        _tarifs_cache["ts"] = 0.0
        _tarifs_cache["data"] = None


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
        # Batch INSERT 1 round-trip au lieu de 12
        execute_values(
            cur,
            """
            INSERT INTO iphones_stock
            (model, model_key, storage, color_name, color_hex, color_key,
             condition, price, old_price, stock, image_url)
            VALUES %s
            """,
            data,
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
    # Batch UPDATE via VALUES clause : 1 round-trip au lieu de ~50
    rows = [(model, color_name, _apple_url(slug)) for model, color_name, slug in mappings]
    if not rows:
        return
    with get_cursor() as cur:
        execute_values(
            cur,
            """
            UPDATE iphones_stock AS s
            SET image_url = v.url, updated_at = NOW()
            FROM (VALUES %s) AS v(model, color_name, url)
            WHERE s.model = v.model
              AND s.color_name = v.color_name
              AND (s.image_url IS NULL
                   OR s.image_url = ''
                   OR s.image_url LIKE 'https://pngimg.com/%%')
            """,
            rows,
            template="(%s, %s, %s)",
        )


def _ensure_full_catalog():
    """Idempotent : insère chaque (model, color_name) manquant avec prix
    et image_url par défaut. Les entrées existantes ne sont PAS modifiées
    (l'admin peut avoir ajusté prix, stock, image_url custom).

    Prix : prix réels Klikphone (Reconditionné Premium) — sync avec la table
    iphone_tarifs. Le champ old_price = prix Apple neuf officiel (crée la
    promo "−X€").

    Condition : uniquement "Neuf" (iPhone 16/17) et "Reconditionné Premium"
    (tout le reste). Pas de "Reconditionné" simple chez Klikphone."""
    a = _apple_url
    RP = "Reconditionné Premium"
    NEUF = "Neuf"
    # (model, model_key, storage, color_name, color_hex, color_key,
    #  condition, price, old_price, stock, image_slug)
    catalog = [
        # ─── iPhone 16 series (NEUF, tarifs Klikphone / Apple neuf) ────
        ("iPhone 16 Pro Max", "iphone-16-pro-max", "256GB", "Titane Naturel", "#b8a898", "natural-titanium", NEUF, 1149, 1479, 3, "iphone-16-pro-finish-select-202409-6-9inch-naturaltitanium"),
        ("iPhone 16 Pro Max", "iphone-16-pro-max", "256GB", "Titane Noir", "#3a3a3e", "black-titanium", NEUF, 1149, 1479, 2, "iphone-16-pro-finish-select-202409-6-9inch-blacktitanium"),
        ("iPhone 16 Pro Max", "iphone-16-pro-max", "256GB", "Titane Blanc", "#e6e3dd", "white-titanium", NEUF, 1149, 1479, 2, "iphone-16-pro-finish-select-202409-6-9inch-whitetitanium"),
        ("iPhone 16 Pro Max", "iphone-16-pro-max", "256GB", "Titane Désert", "#c9a482", "desert-titanium", NEUF, 1149, 1479, 2, "iphone-16-pro-finish-select-202409-6-9inch-deserttitanium"),
        ("iPhone 16 Pro", "iphone-16-pro", "128GB", "Titane Naturel", "#b8a898", "natural-titanium", NEUF, 949, 1229, 4, "iphone-16-pro-finish-select-202409-6-3inch-naturaltitanium"),
        ("iPhone 16 Pro", "iphone-16-pro", "128GB", "Titane Noir", "#3a3a3e", "black-titanium", NEUF, 949, 1229, 5, "iphone-16-pro-finish-select-202409-6-3inch-blacktitanium"),
        ("iPhone 16 Pro", "iphone-16-pro", "128GB", "Titane Blanc", "#e6e3dd", "white-titanium", NEUF, 949, 1229, 3, "iphone-16-pro-finish-select-202409-6-3inch-whitetitanium"),
        ("iPhone 16 Pro", "iphone-16-pro", "128GB", "Titane Désert", "#c9a482", "desert-titanium", NEUF, 949, 1229, 3, "iphone-16-pro-finish-select-202409-6-3inch-deserttitanium"),
        ("iPhone 16", "iphone-16", "128GB", "Noir", "#1c1c1e", "black", NEUF, 689, 969, 6, "iphone-16-finish-select-202409-6-1inch-black"),
        ("iPhone 16", "iphone-16", "128GB", "Blanc", "#f5f5f0", "white", NEUF, 689, 969, 5, "iphone-16-finish-select-202409-6-1inch-white"),
        ("iPhone 16", "iphone-16", "128GB", "Bleu Ultramarin", "#3a5a8a", "ultramarine", NEUF, 689, 969, 8, "iphone-16-finish-select-202409-6-1inch-ultramarine"),
        ("iPhone 16", "iphone-16", "128GB", "Rose", "#f5c7c7", "pink", NEUF, 689, 969, 4, "iphone-16-finish-select-202409-6-1inch-pink"),
        ("iPhone 16", "iphone-16", "128GB", "Vert Sarcelle", "#7ea89a", "teal", NEUF, 689, 969, 3, "iphone-16-finish-select-202409-6-1inch-teal"),
        # ─── iPhone 15 Pro / Pro Max (RECOND. PREMIUM) ──────────────────
        ("iPhone 15 Pro Max", "iphone-15-pro-max", "256GB", "Titane Naturel", "#b8a898", "natural-titanium", RP, 999, 1479, 2, "iphone-15-pro-finish-select-202309-6-7inch-naturaltitanium"),
        ("iPhone 15 Pro Max", "iphone-15-pro-max", "256GB", "Titane Bleu", "#2d4a6e", "blue-titanium", RP, 999, 1479, 2, "iphone-15-pro-finish-select-202309-6-7inch-bluetitanium"),
        ("iPhone 15 Pro Max", "iphone-15-pro-max", "256GB", "Titane Blanc", "#e6e3dd", "white-titanium", RP, 999, 1479, 1, "iphone-15-pro-finish-select-202309-6-7inch-whitetitanium"),
        ("iPhone 15 Pro Max", "iphone-15-pro-max", "256GB", "Titane Noir", "#3a3a3e", "black-titanium", RP, 999, 1479, 2, "iphone-15-pro-finish-select-202309-6-7inch-blacktitanium"),
        ("iPhone 15 Pro", "iphone-15-pro", "128GB", "Titane Naturel", "#b8a898", "natural-titanium", RP, 849, 1229, 3, "iphone-15-pro-finish-select-202309-6-1inch-naturaltitanium"),
        ("iPhone 15 Pro", "iphone-15-pro", "128GB", "Titane Bleu", "#2d4a6e", "blue-titanium", RP, 849, 1229, 4, "iphone-15-pro-finish-select-202309-6-1inch-bluetitanium"),
        # ─── iPhone 14 Pro / Pro Max (RECOND. PREMIUM) ──────────────────
        ("iPhone 14 Pro Max", "iphone-14-pro-max", "128GB", "Noir Sidéral", "#2a2a2e", "space-black", RP, 799, 1479, 3, "iphone-14-pro-finish-select-202209-6-7inch-spaceblack"),
        ("iPhone 14 Pro Max", "iphone-14-pro-max", "128GB", "Violet Intense", "#6a4a7a", "deep-purple", RP, 799, 1479, 2, "iphone-14-pro-finish-select-202209-6-7inch-deeppurple"),
        ("iPhone 14 Pro", "iphone-14-pro", "128GB", "Noir Sidéral", "#2a2a2e", "space-black", RP, 699, 1329, 4, "iphone-14-pro-finish-select-202209-6-1inch-spaceblack"),
        ("iPhone 14 Pro", "iphone-14-pro", "128GB", "Violet Intense", "#6a4a7a", "deep-purple", RP, 699, 1329, 5, "iphone-14-pro-finish-select-202209-6-1inch-deeppurple"),
        ("iPhone 14", "iphone-14", "128GB", "Bleu", "#3a5a7a", "blue", RP, 479, 1019, 7, "iphone-14-finish-select-202209-6-1inch-blue"),
        # ─── iPhone 13 Pro / Pro Max (RECOND. PREMIUM) ──────────────────
        ("iPhone 13 Pro Max", "iphone-13-pro-max", "128GB", "Bleu Sierra", "#3a5a7a", "sierra-blue", RP, 599, 1259, 3, "iphone-13-pro-max-blue-select"),
        ("iPhone 13 Pro Max", "iphone-13-pro-max", "128GB", "Graphite", "#3a3a3a", "graphite", RP, 599, 1259, 3, "iphone-13-pro-max-graphite-select"),
        ("iPhone 13 Pro Max", "iphone-13-pro-max", "128GB", "Or", "#d4b896", "gold", RP, 599, 1259, 2, "iphone-13-pro-max-gold-select"),
        ("iPhone 13 Pro Max", "iphone-13-pro-max", "128GB", "Argent", "#e6e6e6", "silver", RP, 599, 1259, 2, "iphone-13-pro-max-silver-select"),
        ("iPhone 13 Pro", "iphone-13-pro", "128GB", "Bleu Sierra", "#3a5a7a", "sierra-blue", RP, 529, 1159, 4, "iphone-13-pro-blue-select"),
        ("iPhone 13 Pro", "iphone-13-pro", "128GB", "Graphite", "#3a3a3a", "graphite", RP, 529, 1159, 4, "iphone-13-pro-graphite-select"),
        ("iPhone 13 Pro", "iphone-13-pro", "128GB", "Or", "#d4b896", "gold", RP, 529, 1159, 3, "iphone-13-pro-gold-select"),
        ("iPhone 13 Pro", "iphone-13-pro", "128GB", "Argent", "#e6e6e6", "silver", RP, 529, 1159, 3, "iphone-13-pro-silver-select"),
        # ─── iPhone 13 (RECOND. PREMIUM) ────────────────────────────────
        ("iPhone 13", "iphone-13", "128GB", "Minuit", "#1a2030", "midnight", RP, 429, 909, 6, "iphone-13-midnight-select-2021"),
        ("iPhone 13", "iphone-13", "128GB", "Bleu", "#4a6a9a", "blue", RP, 429, 909, 5, "iphone-13-blue-select-2021"),
        ("iPhone 13", "iphone-13", "128GB", "Rose", "#f5c7c7", "pink", RP, 429, 909, 4, "iphone-13-pink-select-2021"),
        ("iPhone 13", "iphone-13", "128GB", "Lumière Stellaire", "#eee5d6", "starlight", RP, 429, 909, 5, "iphone-13-starlight-select-2021"),
        ("iPhone 13", "iphone-13", "128GB", "Vert", "#3a5a4a", "green", RP, 429, 909, 3, "iphone-13-green-select"),
        ("iPhone 13", "iphone-13", "128GB", "(PRODUCT)RED", "#c32333", "product-red", RP, 429, 909, 3, "iphone-13-product-red-select-2021"),
        # ─── iPhone 12 (RECOND. PREMIUM) ────────────────────────────────
        ("iPhone 12", "iphone-12", "128GB", "Bleu", "#2a5a8a", "blue", RP, 359, 809, 6, "iphone-12-blue-select-2020"),
        ("iPhone 12", "iphone-12", "128GB", "Noir", "#1c1c1e", "black", RP, 359, 809, 5, "iphone-12-black-select-2020"),
        ("iPhone 12", "iphone-12", "128GB", "Blanc", "#f5f5f0", "white", RP, 359, 809, 4, "iphone-12-white-select-2020"),
        ("iPhone 12", "iphone-12", "128GB", "Vert", "#9ac2a8", "green", RP, 359, 809, 4, "iphone-12-green-select-2020"),
        ("iPhone 12", "iphone-12", "128GB", "Violet", "#bba1c8", "purple", RP, 359, 809, 3, "iphone-12-purple-select-2021"),
        ("iPhone 12", "iphone-12", "128GB", "(PRODUCT)RED", "#c32333", "product-red", RP, 359, 809, 3, "iphone-12-red-select-2020"),
    ]
    # Prepare rows avec image_url deja calcule
    rows = []
    for row in catalog:
        (model, model_key, storage, color_name, color_hex, color_key,
         condition, price, old_price, stock, slug) = row
        image_url = a(slug) if slug else None
        rows.append((model, model_key, storage, color_name, color_hex,
                     color_key, condition, price, old_price, stock, image_url))
    if not rows:
        return
    # Batch INSERT en 1 round-trip : SELECT des (model,color_name) existants,
    # puis INSERT en bulk de ceux qui manquent via execute_values.
    # Evite d'ajouter une contrainte UNIQUE (schema break).
    with get_cursor() as cur:
        cur.execute("SELECT model, color_name FROM iphones_stock")
        existing = {(r["model"], r["color_name"]) for r in cur.fetchall()}
        to_insert = [r for r in rows if (r[0], r[3]) not in existing]
        if not to_insert:
            return
        execute_values(
            cur,
            """
            INSERT INTO iphones_stock
            (model, model_key, storage, color_name, color_hex, color_key,
             condition, price, old_price, stock, image_url)
            VALUES %s
            """,
            to_insert,
        )
        logger.info("Catalogue iphones_stock : %d nouvelles entrees ajoutees", len(to_insert))


def _normalize_conditions_and_prices():
    """Sync les conditions et prix avec le catalogue Klikphone officiel :
    - "Reconditionné" simple → "Reconditionné Premium" (toute la gamme)
    - Aligne les prix des entrées existantes sur les prix catalogue
      (sauf si l'admin a custom modifié, détecté via prix != ancien seed)
    - Force old_price = prix Apple neuf officiel pour créer la promo."""
    price_map = {
        # (model, color_name) : (price, old_price, condition)
        ("iPhone 16 Pro Max", "Titane Naturel"): (1149, 1479, "Neuf"),
        ("iPhone 16 Pro Max", "Titane Noir"): (1149, 1479, "Neuf"),
        ("iPhone 16 Pro", "Titane Naturel"): (949, 1229, "Neuf"),
        ("iPhone 16 Pro", "Titane Noir"): (949, 1229, "Neuf"),
        ("iPhone 16", "Bleu Ultramarin"): (689, 969, "Neuf"),
        ("iPhone 16", "Rose"): (689, 969, "Neuf"),
        ("iPhone 16", "Vert Sarcelle"): (689, 969, "Neuf"),
        ("iPhone 15 Pro Max", "Titane Naturel"): (999, 1479, "Reconditionné Premium"),
        ("iPhone 15 Pro", "Titane Bleu"): (849, 1229, "Reconditionné Premium"),
        ("iPhone 14 Pro Max", "Noir Sidéral"): (799, 1479, "Reconditionné Premium"),
        ("iPhone 14 Pro", "Violet Intense"): (699, 1329, "Reconditionné Premium"),
        ("iPhone 14", "Bleu"): (479, 1019, "Reconditionné Premium"),
        ("iPhone 13", "Minuit"): (429, 909, "Reconditionné Premium"),
        ("iPhone 12", "Bleu Pacifique"): (359, 809, "Reconditionné Premium"),
    }
    # 1 seul UPDATE pour "Reconditionné" -> "Reconditionné Premium"
    # + 1 seul UPDATE batch via VALUES pour le price_map (au lieu de 13 roundtrips)
    with get_cursor() as cur:
        cur.execute(
            """UPDATE iphones_stock SET condition = 'Reconditionné Premium',
               updated_at = NOW() WHERE condition = 'Reconditionné'"""
        )
        rows = [(m, c, p, o, cond)
                for (m, c), (p, o, cond) in price_map.items()]
        if rows:
            execute_values(
                cur,
                """
                UPDATE iphones_stock AS s
                SET price = v.price, old_price = v.old_price,
                    condition = v.condition, updated_at = NOW()
                FROM (VALUES %s) AS v(model, color_name, price, old_price, condition)
                WHERE s.model = v.model AND s.color_name = v.color_name
                """,
                rows,
                template="(%s, %s, %s, %s, %s)",
            )


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
    try:
        _normalize_conditions_and_prices()
    except Exception as e:
        logger.warning("Normalize conditions: %s", e)


def init_iphones_stock():
    """Appelé au startup. Table + seed inline (rapide), reste en thread."""
    _ensure_table()
    _seed_default()
    # Backfill + catalogue lancés en background pour ne pas bloquer le boot Railway
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
    # IDs string (format "it_<id>_<storageIdx>" ou "st_<id>_<storageIdx>")
    # car la source est desormais iphone_tarifs + smartphones_tarifs.
    ids: List[str]


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


@router.get("/photo/{model_key}")
def get_iphone_photo(model_key: str):
    """Sert une photo iPhone PNG detourée pour l'UI front.
    Retourne la premiere image locale matchant le slug, ou 404."""
    if "/" in model_key or ".." in model_key:
        raise HTTPException(status_code=400, detail="Slug invalide")
    local_dir = Path(__file__).parent.parent / "video" / "assets" / "iphones"
    key = model_key.replace("-", "_")
    # 1. Exact match sans couleur
    p = local_dir / f"{key}.png"
    if p.exists():
        return FileResponse(str(p), headers={"Cache-Control": "public, max-age=604800"})
    # 2. Premier fichier matchant le prefix
    matches = sorted(local_dir.glob(f"{key}_*.png"))
    if matches:
        return FileResponse(str(matches[0]),
                            headers={"Cache-Control": "public, max-age=604800"})
    raise HTTPException(status_code=404, detail="Photo introuvable")


# ---------------------------------------------------------------------------
# Endpoints CRUD
# ---------------------------------------------------------------------------
def _tarifs_to_phones() -> list:
    """Fusionne iphone_tarifs + smartphones_tarifs en entrees "phone" compatibles
    avec VentesIphoneStory. Source de verite unique = les 2 pages Tarifs.

    Chaque tarif genere 1-3 entrees (une par stockage defini). Les IDs sont
    prefixes (it_<id>_<n> pour iphone_tarifs, st_<id>_<n> pour smartphones)
    pour eviter les collisions entre les 2 tables.

    Resultat cache en memoire (TTL 30s) pour eviter 2 round-trips DB a chaque
    appel. Invalide automatiquement sur tout CRUD via _invalidate_tarifs_cache().
    """
    # Lecture cache sous lock court
    with _tarifs_cache_lock:
        now = time.time()
        cached = _tarifs_cache.get("data")
        if cached is not None and (now - _tarifs_cache["ts"]) < _TARIFS_CACHE_TTL:
            return cached

    phones = []
    # Prix Apple neuf de reference pour creer old_price sur modeles Apple
    apple_neuf = {
        "iPhone 16 Pro Max": {"256 Go": 1479, "512 Go": 1729},
        "iPhone 16 Pro": {"128 Go": 1229, "256 Go": 1359},
        "iPhone 16": {"128 Go": 969, "256 Go": 1099},
        "iPhone 15 Pro Max": {"256 Go": 1479, "512 Go": 1729},
        "iPhone 15 Pro": {"128 Go": 1229, "256 Go": 1359},
        "iPhone 15": {"128 Go": 969, "256 Go": 1099},
        "iPhone 14 Pro Max": {"128 Go": 1479, "256 Go": 1609},
        "iPhone 14 Pro": {"128 Go": 1329, "256 Go": 1459},
        "iPhone 14": {"128 Go": 1019, "256 Go": 1149},
        "iPhone 13 Pro Max": {"128 Go": 1259, "256 Go": 1389},
        "iPhone 13 Pro": {"128 Go": 1159, "256 Go": 1289},
        "iPhone 13": {"128 Go": 909, "256 Go": 1029},
        "iPhone 12 Pro Max": {"128 Go": 1259, "256 Go": 1389},
        "iPhone 12 Pro": {"128 Go": 1159, "256 Go": 1289},
        "iPhone 12": {"128 Go": 809, "256 Go": 909},
    }

    with get_cursor() as cur:
        # iPhone tarifs (LIMIT 500 garde-fou, ~25 rows en prod)
        cur.execute("""
            SELECT id, slug, modele,
                   stockage_1, prix_1, stock_1,
                   stockage_2, prix_2, stock_2,
                   stockage_3, prix_3, stock_3,
                   condition, image_filename, actif
            FROM iphone_tarifs
            WHERE actif = TRUE
            ORDER BY ordre ASC
            LIMIT 500
        """)
        for r in cur.fetchall():
            d = dict(r)
            storages = [
                (d.get("stockage_1"), d.get("prix_1"), d.get("stock_1") or 0),
                (d.get("stockage_2"), d.get("prix_2"), d.get("stock_2") or 0),
                (d.get("stockage_3"), d.get("prix_3"), d.get("stock_3") or 0),
            ]
            for idx, (stor, prix, stock) in enumerate(storages):
                if not stor or not prix:
                    continue
                model = d["modele"]
                old = apple_neuf.get(model, {}).get(stor)
                phones.append({
                    "id": f"it_{d['id']}_{idx}",
                    "source": "iphone_tarifs",
                    "source_id": d["id"],
                    "storage_idx": idx,
                    "model": model,
                    "model_key": d["slug"],
                    "storage": stor,
                    "color_name": "—",
                    "color_hex": "#888",
                    "color_key": None,
                    "condition": d.get("condition") or "Reconditionné Premium",
                    "price": prix,
                    "old_price": old,
                    "stock": stock,
                    "image_url": f"/api/iphones/photo/{d['slug']}",
                    "active": True,
                })
        # Smartphones (non-Apple) (LIMIT 500 garde-fou)
        cur.execute("""
            SELECT id, slug, marque, modele,
                   stockage_1, prix_1, stock_1,
                   stockage_2, prix_2, stock_2,
                   stockage_3, prix_3, stock_3,
                   condition, image_url, actif
            FROM smartphones_tarifs
            WHERE actif = TRUE
            ORDER BY marque ASC, ordre ASC
            LIMIT 500
        """)
        for r in cur.fetchall():
            d = dict(r)
            storages = [
                (d.get("stockage_1"), d.get("prix_1"), d.get("stock_1") or 0),
                (d.get("stockage_2"), d.get("prix_2"), d.get("stock_2") or 0),
                (d.get("stockage_3"), d.get("prix_3"), d.get("stock_3") or 0),
            ]
            full_model = f"{d['marque']} {d['modele']}"
            for idx, (stor, prix, stock) in enumerate(storages):
                if not stor or not prix:
                    continue
                phones.append({
                    "id": f"st_{d['id']}_{idx}",
                    "source": "smartphones_tarifs",
                    "source_id": d["id"],
                    "storage_idx": idx,
                    "model": full_model,
                    "model_key": d["slug"],
                    "storage": stor,
                    "color_name": "—",
                    "color_hex": "#888",
                    "color_key": None,
                    "condition": d.get("condition") or "Reconditionné Premium",
                    "price": prix,
                    "old_price": None,
                    "stock": stock,
                    "image_url": d.get("image_url"),
                    "active": True,
                })
    # Stockage cache
    with _tarifs_cache_lock:
        _tarifs_cache["ts"] = time.time()
        _tarifs_cache["data"] = phones
    return phones


@router.get("")
def list_iphones(
    condition: Optional[str] = Query(None),
    model: Optional[str] = Query(None),
    active_only: bool = Query(True),
):
    """Liste les telephones en vente. Source : iphone_tarifs + smartphones_tarifs.
    Filtres : condition, model."""
    phones = _tarifs_to_phones()
    if condition:
        phones = [p for p in phones if p["condition"] == condition]
    if model:
        ml = model.lower()
        phones = [p for p in phones if ml in (p["model"] or "").lower()]
    # Tri : iPhone 16/17 en haut (plus cher → plus recent),
    # puis Samsung/Xiaomi, ordonnes par prix decroissant
    phones.sort(key=lambda p: (-(p["price"] or 0), p["model"]))
    return phones


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
    _invalidate_tarifs_cache()
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
    _invalidate_tarifs_cache()
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
    _invalidate_tarifs_cache()
    return {"status": "deleted", "id": iphone_id}


# ---------------------------------------------------------------------------
# Video generation
# ---------------------------------------------------------------------------
@router.post("/generate-video")
def generate_video(payload: GenerateVideoRequest):
    """Génère une vidéo Story 9:16 à partir des telephones selectionnes.
    Source : iphone_tarifs + smartphones_tarifs (IDs prefixes it_ / st_)."""
    if not payload.ids:
        raise HTTPException(status_code=400, detail="Aucun téléphone sélectionné")
    if len(payload.ids) > 8:
        raise HTTPException(status_code=400, detail="Maximum 8 téléphones par vidéo")

    # Recupere tous les phones de la source unifiee, filtre sur les IDs demandes
    all_phones = _tarifs_to_phones()
    phones_by_id = {p["id"]: p for p in all_phones}
    phones = [phones_by_id[i] for i in payload.ids if i in phones_by_id]

    if not phones:
        raise HTTPException(status_code=404, detail="Aucun téléphone trouvé")

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
