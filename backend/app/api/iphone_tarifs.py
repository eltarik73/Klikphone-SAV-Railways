"""
API Tarifs iPhones reconditionnés.
- CRUD pour la table iphone_tarifs (prix, stockages, DAS, image)
- Génération de PDFs imprimables pour affichage boutique (2 modèles par page)
  reproduisant le layout des .docx historiques avec mention DAS obligatoire.
"""

import hashlib
import io
import logging
import re
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import List, Optional

import httpx
from fastapi import APIRouter, HTTPException, Query, Response, UploadFile, File
from fastapi.responses import FileResponse, StreamingResponse
from fpdf import FPDF
from psycopg2.extras import execute_values
from pydantic import BaseModel

from app.database import get_cursor
from app.api.auth import get_current_user  # noqa: F401 (si besoin plus tard)
# Reutilise le fetch/validate d'image cote serveur deja teste et cache sur disque
from app.api.smartphones_tarifs import _fetch_image_for_pdf


router = APIRouter(prefix="/api/iphone-tarifs", tags=["iphone-tarifs"])
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Chemins assets
# ---------------------------------------------------------------------------
ASSETS_DIR = Path(__file__).parent.parent / "assets" / "iphone_tarifs"
FONTS_DIR = Path(__file__).parent.parent / "assets" / "fonts"
LOGO_PATH = ASSETS_DIR / "logo.png"

# Dossier pour les photos uploadees manuellement par l'admin (hors repo)
# Railway peut le reset au redeploy si pas monte en volume, mais au moins
# dans la session courante les photos restent accessibles.
UPLOADS_DIR = Path(__file__).parent.parent / "assets" / "iphone_uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


@router.get("/image/{filename}")
def get_iphone_image(filename: str):
    """Sert les images iPhone stockées dans backend/app/assets/iphone_tarifs/.
    Utilisé par la page vitrine (Site Tarifs iPhone) pour afficher les photos."""
    if "/" in filename or ".." in filename:
        raise HTTPException(400, "Nom de fichier invalide")
    path = ASSETS_DIR / filename
    if not path.exists() or not path.is_file():
        raise HTTPException(404, f"Image {filename} introuvable")
    return FileResponse(
        str(path),
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.get("/image-upload/{filename}")
def get_iphone_upload(filename: str):
    """Sert les photos uploadees manuellement par l'admin."""
    if "/" in filename or ".." in filename:
        raise HTTPException(400, "Nom de fichier invalide")
    path = UPLOADS_DIR / filename
    if not path.exists() or not path.is_file():
        raise HTTPException(404, f"Upload {filename} introuvable")
    return FileResponse(
        str(path),
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.post("/{tarif_id}/upload-image")
async def upload_iphone_image(tarif_id: int, file: UploadFile = File(...)):
    """Upload une photo personnalisee depuis le navigateur de l'admin.

    - Accepte JPEG, PNG, WebP (max 5 MB)
    - Sauve dans UPLOADS_DIR avec hash pour eviter collisions
    - Met a jour image_url de l'iphone_tarifs vers la route /image-upload/{filename}
    """
    # Valide existence du tarif
    with get_cursor() as cur:
        cur.execute("SELECT id, slug FROM iphone_tarifs WHERE id = %s", (tarif_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Tarif non trouvé")
        slug = row["slug"] if isinstance(row, dict) else row[1]

    # Valide le type + taille (5MB max)
    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(413, "Fichier trop volumineux (max 5 Mo)")
    if len(content) < 200:
        raise HTTPException(400, "Fichier trop petit ou vide")

    # Ext depuis content-type ou filename
    ctype = (file.content_type or "").lower()
    if "png" in ctype:
        ext = "png"
    elif "webp" in ctype:
        ext = "webp"
    elif "jpeg" in ctype or "jpg" in ctype:
        ext = "jpg"
    else:
        # Fallback sur l'extension du filename
        ext = (file.filename or "").rsplit(".", 1)[-1].lower()
        if ext not in ("jpg", "jpeg", "png", "webp"):
            raise HTTPException(400, "Format non supporte (JPEG, PNG, WebP uniquement)")

    h = hashlib.sha256(content).hexdigest()[:12]
    filename = f"{slug}_{h}.{ext}"
    path = UPLOADS_DIR / filename
    path.write_bytes(content)

    # Patch image_url pour pointer vers cette photo uploadee
    image_url = f"/api/iphone-tarifs/image-upload/{filename}"
    with get_cursor() as cur:
        cur.execute(
            "UPDATE iphone_tarifs SET image_url = %s, updated_at = NOW() WHERE id = %s",
            (image_url, tarif_id),
        )

    # Invalide cache in-memory
    try:
        from app.api.iphones_stock import _invalidate_tarifs_cache
        _invalidate_tarifs_cache()
    except Exception:
        pass

    return {
        "ok": True,
        "image_url": image_url,
        "filename": filename,
        "size": len(content),
    }


# ---------------------------------------------------------------------------
# Recherche d'image via DuckDuckGo (meme pattern que smartphones_tarifs)
# ---------------------------------------------------------------------------
class GenerateIphoneImageRequest(BaseModel):
    modele: str
    storage: Optional[str] = None
    query: Optional[str] = None  # override manuel (ex: "iPhone 15 pro back view cutout")


@router.post("/generate-image")
def generate_iphone_image(payload: GenerateIphoneImageRequest):
    """Cherche une vraie photo d'iPhone sur le web via DuckDuckGo Images.

    Meme logique que /api/smartphones-tarifs/generate-image :
    - Recupere 10 candidats DDG
    - Valide chaque URL avec un vrai fetch cote serveur (filtre les CDN
      bloques par Cloudflare, 403, 500...)
    - Retourne uniquement les URLs reellement telechargeables.

    Si `query` est fourni, il remplace la construction auto — utile pour
    l'admin qui cherche un angle specifique (ex: "iPhone 15 mockup PNG")."""
    import json
    from urllib.parse import quote

    if payload.query and payload.query.strip():
        query = payload.query.strip()
    else:
        query_parts = ["Apple", payload.modele]
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
        landing = httpx.get(
            f"https://duckduckgo.com/?q={quote(query)}&iar=images",
            headers=headers, timeout=10.0, follow_redirects=True,
        )
        m = re.search(r'vqd=[\'"]?(\d-[0-9\-]+)[\'"]?', landing.text)
        if not m:
            raise HTTPException(502, "Token DDG introuvable")
        vqd = m.group(1)

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
        logger.warning("DDG image search (iphone) failed: %s", e)
        raise HTTPException(502, f"Recherche image impossible : {e}")

    results = data.get("results", [])
    candidates = []
    for res in results:
        img_url = res.get("image")
        if not img_url:
            continue
        if (res.get("width") or 0) and res.get("width", 0) < 300:
            continue
        candidates.append(img_url)
        if len(candidates) >= 10:
            break

    if not candidates:
        raise HTTPException(
            404, f"Aucune image trouvée pour '{query}'. Essayez autre chose."
        )

    # Valide en parallele : ne garde que les URLs telechargeables cote serveur
    with ThreadPoolExecutor(max_workers=6) as ex:
        fetched = list(ex.map(_fetch_image_for_pdf, candidates))
    valid = [url for url, path in zip(candidates, fetched) if path]
    if not valid:
        valid = candidates
        logger.warning(
            "Aucune URL DDG telechargeable pour iPhone '%s'", query
        )

    return {
        "image_url": valid[0],
        "alternatives": valid[1:8],
        "query": query,
        "source": "duckduckgo_images",
    }


# ---------------------------------------------------------------------------
# Generation IA via Pollinations.ai (gratuit, sans API key)
# ---------------------------------------------------------------------------
class GenerateAiImageRequest(BaseModel):
    modele: str
    storage: Optional[str] = None
    prompt: Optional[str] = None  # override complet du prompt
    count: int = 4  # nombre de variants (seeds differents)


@router.post("/generate-ai-image")
def generate_ai_iphone_image(payload: GenerateAiImageRequest):
    """Genere des photos d'iPhone via Pollinations.ai (image.pollinations.ai).

    Gratuit, pas de cle API. On genere `count` variants (4 par defaut) en
    changeant le seed. Toutes sont deja 'detourees' (fond blanc/transparent)
    car on force le prompt avec 'white background, product photography, cutout'.

    URLs retournees utilisables telles quelles (Pollinations sert directement
    en PNG, pas de CDN exotique a valider)."""
    from urllib.parse import quote

    base_prompt = payload.prompt or (
        f"Apple {payload.modele}"
        + (f" {payload.storage}" if payload.storage else "")
        + ", professional product photography, clean white background,"
        " no shadow, straight front view, sharp focus, 4k, studio lighting,"
        " cutout isolated, no text, no logo overlay"
    )

    count = max(1, min(8, int(payload.count or 4)))
    prompt_enc = quote(base_prompt)
    urls = []
    for i in range(count):
        seed = 100 + i * 7  # seeds differents pour varier les rendus
        url = (
            f"https://image.pollinations.ai/prompt/{prompt_enc}"
            f"?width=768&height=768&seed={seed}&nologo=true&enhance=true"
        )
        urls.append(url)

    return {
        "image_url": urls[0],
        "alternatives": urls[1:],
        "prompt": base_prompt,
        "source": "pollinations_ai",
    }

# Fonts Unicode — DejaVu Sans embarquée dans le repo (fonctionne sur Linux Railway et macOS dev).
def _find_font(regular: bool = True, bold: bool = False, italic: bool = False) -> str:
    if bold:
        candidates = [FONTS_DIR / "DejaVuSans-Bold.ttf", Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")]
    elif italic:
        candidates = [FONTS_DIR / "DejaVuSans-Oblique.ttf", Path("/System/Library/Fonts/Supplemental/Arial Italic.ttf")]
    else:
        candidates = [FONTS_DIR / "DejaVuSans.ttf", Path("/System/Library/Fonts/Supplemental/Arial.ttf")]
    for c in candidates:
        if c.exists():
            return str(c)
    raise RuntimeError("Aucune police Unicode trouvée (DejaVu ou Arial)")


# ---------------------------------------------------------------------------
# Table + seed
# ---------------------------------------------------------------------------
def _ensure_table():
    """Crée la table iphone_tarifs si elle n'existe pas et seed la gamme complète.
    Migration idempotente : ajoute les colonnes `condition` et `stock_N` si absentes."""
    with get_cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS iphone_tarifs (
                id SERIAL PRIMARY KEY,
                slug TEXT UNIQUE NOT NULL,
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
                grade TEXT DEFAULT '100% Satisfait',
                das_tete TEXT,
                das_corps TEXT,
                das_membre TEXT,
                image_filename TEXT,
                page_group TEXT,
                actif BOOLEAN DEFAULT TRUE,
                condition TEXT DEFAULT 'Reconditionné Premium',
                updated_at TIMESTAMP DEFAULT NOW()
            );
            ALTER TABLE iphone_tarifs
                ADD COLUMN IF NOT EXISTS condition TEXT DEFAULT 'Reconditionné Premium';
            ALTER TABLE iphone_tarifs ADD COLUMN IF NOT EXISTS stock_1 INTEGER DEFAULT 0;
            ALTER TABLE iphone_tarifs ADD COLUMN IF NOT EXISTS stock_2 INTEGER DEFAULT 0;
            ALTER TABLE iphone_tarifs ADD COLUMN IF NOT EXISTS stock_3 INTEGER DEFAULT 0;
            -- image_url = URL externe trouvee via DuckDuckGo (bouton Rechercher image).
            -- Si presente, elle prime sur image_filename pour l'affichage web/vitrine.
            ALTER TABLE iphone_tarifs ADD COLUMN IF NOT EXISTS image_url TEXT;
            CREATE INDEX IF NOT EXISTS idx_iphone_tarifs_ordre ON iphone_tarifs(ordre);
            CREATE INDEX IF NOT EXISTS idx_iphone_tarifs_group ON iphone_tarifs(page_group);
            -- iPhone 16 et 17 par défaut en Neuf (derniers modèles Apple)
            UPDATE iphone_tarifs SET condition = 'Neuf'
                WHERE condition IS NULL
                  AND (slug LIKE 'iphone-16%' OR slug LIKE 'iphone-17%');
        """)


def _seed_default_data():
    """Seed les données initiales — fait uniquement si la table est vide."""
    with get_cursor() as cur:
        cur.execute("SELECT COUNT(*) AS c FROM iphone_tarifs")
        row = cur.fetchone()
        if row and (row["c"] if isinstance(row, dict) else row[0]) > 0:
            return  # déjà seed

        # Gamme complète : SE 2020 → 17 Pro Max
        # Valeurs DAS : source apple.com/fr/legal/rfexposure (à affiner depuis l'admin)
        # Prix : extraits des .docx octobre 2025 pour les modèles existants, 0€ pour nouveautés à définir
        data = [
            # slug, modele, ordre, storage_1, prix_1, storage_2, prix_2, das_tete, das_corps, das_membre, image, page_group
            ("iphone-se-2020", "iPhone SE 2020", 10, "64 Go", 209, "128 Go", 239, "0.99", "0.99", "3.00", "iphone_se_2020.jpeg", "se"),
            ("iphone-se-2022", "iPhone SE 2022", 20, "64 Go", 279, "128 Go", 299, "0.99", "0.99", "3.00", "iphone_se_2022.jpeg", "se"),
            ("iphone-12", "iPhone 12", 30, "64 Go", 329, "128 Go", 359, "0.99", "0.99", "3.80", "iphone_12.jpeg", "12"),
            ("iphone-12-pro", "iPhone 12 Pro", 40, "128 Go", 399, "256 Go", 439, "0.99", "0.99", "3.85", "iphone_12_pro.jpeg", "12"),
            ("iphone-12-pro-max", "iPhone 12 Pro Max", 50, "128 Go", 449, "256 Go", 499, "0.99", "0.99", "3.93", "iphone_12_pro_max.jpeg", "12pm"),
            ("iphone-13-mini", "iPhone 13 mini", 60, "128 Go", 399, "256 Go", 429, "0.98", "0.97", "3.95", "iphone_13_mini.jpeg", "13mini"),
            ("iphone-13", "iPhone 13", 70, "128 Go", 429, "256 Go", 459, "0.97", "0.98", "2.98", "iphone_13.jpeg", "13"),
            ("iphone-13-pro", "iPhone 13 Pro", 80, "128 Go", 529, "256 Go", 579, "0.99", "0.98", "2.97", "iphone_13_pro.jpeg", "13"),
            ("iphone-13-pro-max", "iPhone 13 Pro Max", 90, "128 Go", 599, "256 Go", 649, "0.98", "0.98", "2.99", "iphone_13_pro_max.jpeg", "13pm"),
            ("iphone-14", "iPhone 14", 100, "128 Go", 479, "256 Go", 519, "0.98", "0.98", "2.98", "iphone_14.jpeg", "14"),
            ("iphone-14-plus", "iPhone 14 Plus", 110, "128 Go", 549, "256 Go", 599, "0.98", "0.98", "2.96", "iphone_14_plus.jpeg", "14plus"),
            ("iphone-14-pro", "iPhone 14 Pro", 120, "128 Go", 699, "256 Go", 759, "0.99", "0.98", "2.99", "iphone_14_pro.jpeg", "14"),
            ("iphone-14-pro-max", "iPhone 14 Pro Max", 130, "128 Go", 799, "256 Go", 859, "0.99", "0.98", "2.99", "iphone_14_pro_max.jpeg", "14pm"),
            ("iphone-15", "iPhone 15", 140, "128 Go", 689, "256 Go", 739, "0.98", "0.98", "2.99", "iphone_15.jpeg", "15"),
            ("iphone-15-plus", "iPhone 15 Plus", 150, "128 Go", 789, "256 Go", 849, "0.98", "0.98", "2.98", "iphone_15_plus.jpeg", "15plus"),
            ("iphone-15-pro", "iPhone 15 Pro", 160, "128 Go", 849, "256 Go", 909, "0.98", "0.98", "2.99", "iphone_15_pro.jpeg", "15"),
            ("iphone-15-pro-max", "iPhone 15 Pro Max", 170, "256 Go", 999, "512 Go", 1199, "0.99", "0.98", "2.98", "iphone_15_pro_max.jpeg", "15pm"),
            ("iphone-16e", "iPhone 16e", 180, "128 Go", 519, "256 Go", 569, "0.99", "0.98", "2.98", "iphone_16e.jpeg", "16e"),
            ("iphone-16", "iPhone 16", 190, "128 Go", 689, "256 Go", 739, "0.99", "0.98", "2.98", "iphone_16.jpeg", "16"),
            ("iphone-16-plus", "iPhone 16 Plus", 200, "128 Go", 789, "256 Go", 849, "0.99", "0.98", "2.97", "iphone_16_plus.jpeg", "16plus"),
            ("iphone-16-pro", "iPhone 16 Pro", 210, "128 Go", 949, "256 Go", 999, "0.98", "0.97", "2.97", "iphone_16_pro.jpeg", "16"),
            ("iphone-16-pro-max", "iPhone 16 Pro Max", 220, "256 Go", 1149, "512 Go", 1349, "0.99", "0.98", "2.97", "iphone_16_pro_max.jpeg", "16pm"),
            # iPhone 17 — prix à définir, valeurs DAS estimées (à valider Apple)
            ("iphone-17", "iPhone 17", 230, "128 Go", 0, "256 Go", 0, "0.98", "0.98", "2.99", "iphone_17.jpeg", "17"),
            ("iphone-17-pro", "iPhone 17 Pro", 240, "256 Go", 0, "512 Go", 0, "0.99", "0.98", "2.99", "iphone_17_pro.jpeg", "17"),
            ("iphone-17-pro-max", "iPhone 17 Pro Max", 250, "256 Go", 0, "512 Go", 0, "0.99", "0.98", "2.98", "iphone_17_pro_max.jpeg", "17pm"),
        ]

        # Batch INSERT en 1 round-trip via execute_values (au lieu de 25)
        execute_values(
            cur,
            """
            INSERT INTO iphone_tarifs
            (slug, modele, ordre, stockage_1, prix_1, stockage_2, prix_2,
             das_tete, das_corps, das_membre, image_filename, page_group)
            VALUES %s
            ON CONFLICT (slug) DO NOTHING
            """,
            data,
        )
        logger.info("iphone_tarifs : %d modèles seed", len(data))


def init_iphone_tarifs():
    """À appeler au startup (lifespan de main.py)."""
    _ensure_table()
    _seed_default_data()


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class IphoneTarifUpdate(BaseModel):
    modele: Optional[str] = None
    stockage_1: Optional[str] = None
    prix_1: Optional[int] = None
    stock_1: Optional[int] = None
    stockage_2: Optional[str] = None
    prix_2: Optional[int] = None
    stock_2: Optional[int] = None
    stockage_3: Optional[str] = None
    prix_3: Optional[int] = None
    stock_3: Optional[int] = None
    grade: Optional[str] = None
    das_tete: Optional[str] = None
    das_corps: Optional[str] = None
    das_membre: Optional[str] = None
    ordre: Optional[int] = None
    page_group: Optional[str] = None
    actif: Optional[bool] = None
    condition: Optional[str] = None
    image_url: Optional[str] = None


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------
@router.get("")
def list_tarifs():
    with get_cursor() as cur:
        cur.execute("""
            SELECT id, slug, modele, ordre,
                   stockage_1, prix_1, stock_1,
                   stockage_2, prix_2, stock_2,
                   stockage_3, prix_3, stock_3,
                   grade, das_tete, das_corps, das_membre,
                   image_filename, image_url, page_group, actif, condition, updated_at
            FROM iphone_tarifs
            ORDER BY ordre ASC
        """)
        return [dict(r) for r in cur.fetchall()]


@router.patch("/{tarif_id}")
def update_tarif(tarif_id: int, payload: IphoneTarifUpdate):
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(400, "Aucun champ à mettre à jour")

    set_clauses = ", ".join(f"{k} = %s" for k in data.keys())
    values = list(data.values()) + [tarif_id]

    with get_cursor() as cur:
        cur.execute(
            f"UPDATE iphone_tarifs SET {set_clauses}, updated_at = NOW() WHERE id = %s RETURNING id",
            values,
        )
        if not cur.fetchone():
            raise HTTPException(404, "Tarif non trouvé")
    # Invalide cache in-memory pour que list_iphones reflete immediatement
    try:
        from app.api.iphones_stock import _invalidate_tarifs_cache
        _invalidate_tarifs_cache()
    except Exception:
        pass
    return {"ok": True, "id": tarif_id}


# ---------------------------------------------------------------------------
# Génération PDF
# ---------------------------------------------------------------------------
ORANGE = (245, 130, 32)
DARK = (40, 40, 40)
GREY_BOX = (245, 245, 245)
GREY_BORDER = (200, 200, 200)
DAS_BG = (235, 240, 250)


class _TarifPDF(FPDF):
    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.add_font("UI", "", _find_font())
        self.add_font("UI", "B", _find_font(bold=True))
        self.add_font("UI", "I", _find_font(italic=True))

    def header(self):
        if LOGO_PATH.exists():
            self.image(str(LOGO_PATH), x=(210 - 22) / 2, y=8, w=22, h=22)
        self.set_font("UI", "B", 20)
        self.set_text_color(*DARK)
        self.set_y(31)
        self.cell(0, 7, "KlikPhone", align="C", new_x="LMARGIN", new_y="NEXT")
        self.set_font("UI", "I", 9)
        self.set_text_color(120, 120, 120)
        self.cell(0, 4, "Spécialiste Apple", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(3)
        self.set_font("UI", "", 11)
        self.set_text_color(*DARK)
        self.cell(
            0, 6,
            "Tous nos iPhones sont 100% pièces d'origine et Garantie 1 an",
            align="C", new_x="LMARGIN", new_y="NEXT",
        )

    def add_model_block(self, model: dict, y_start: int):
        # Titre modèle
        self.set_font("UI", "B", 18)
        self.set_text_color(*DARK)
        self.set_xy(105, y_start)
        self.cell(95, 9, model["modele"].upper(), align="C", new_x="LMARGIN", new_y="NEXT")

        # Image gauche
        img = ASSETS_DIR / (model.get("image_filename") or "")
        if img.exists():
            self.image(str(img), x=12, y=y_start + 8, w=85, h=60)
        else:
            self.set_fill_color(230, 230, 230)
            self.rect(12, y_start + 8, 85, 60, style="F")

        # Encadré prix droite
        bx, by, bw, bh = 105, y_start + 11, 95, 50
        self.set_fill_color(*GREY_BOX)
        self.set_draw_color(*GREY_BORDER)
        self.rect(bx, by, bw, bh, style="FD")

        line_h = 8
        y = by + 5

        def _price_string(model) -> str:
            parts = []
            for i in (1, 2, 3):
                s = model.get(f"stockage_{i}")
                p = model.get(f"prix_{i}")
                if s and p:
                    parts.append(f"{p} €")
            return " / ".join(parts) if parts else "—"

        def _storage_string(model) -> str:
            parts = []
            for i in (1, 2, 3):
                s = model.get(f"stockage_{i}")
                if s:
                    parts.append(s)
            return " / ".join(parts) if parts else "—"

        def row(label, value, value_color=ORANGE, big=False):
            nonlocal y
            self.set_font("UI", "B", 12)
            self.set_text_color(*DARK)
            self.set_xy(bx + 5, y)
            self.cell(32, line_h, label)
            self.set_text_color(*value_color)
            self.set_font("UI", "B", 14 if big else 12)
            self.set_xy(bx + 36, y)
            self.cell(0, line_h, value)
            y += line_h + 4

        row("Stockage :", _storage_string(model), DARK)
        row("Prix :", _price_string(model), ORANGE, big=True)
        row("Grade :", model.get("grade") or "100% Satisfait", DARK)

        # Bandeau DAS
        das_y = y_start + 70
        self.set_fill_color(*DAS_BG)
        self.set_draw_color(210, 220, 235)
        self.rect(12, das_y, 186, 14, style="FD")
        self.set_font("UI", "B", 10)
        self.set_text_color(60, 80, 130)
        self.set_xy(15, das_y + 2)
        self.cell(0, 4.5, "DAS (Débit d'Absorption Spécifique) — W/kg")
        self.set_font("UI", "", 9)
        self.set_text_color(*DARK)
        self.set_xy(15, das_y + 7.5)
        self.cell(
            0, 4.5,
            f"Tête : {model.get('das_tete') or '—'}   •   "
            f"Corps : {model.get('das_corps') or '—'}   •   "
            f"Membre : {model.get('das_membre') or '—'}       "
            "(source Apple — moyenné 10g)",
        )


def _render_pdf(models: list) -> bytes:
    """Génère un PDF avec 2 modèles par page max."""
    pdf = _TarifPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(False)

    # 2 modèles par page
    for i in range(0, len(models), 2):
        pdf.add_page()
        pdf.add_model_block(models[i], y_start=52)
        if i + 1 < len(models):
            pdf.add_model_block(models[i + 1], y_start=152)

        # Pied de page légal
        pdf.set_y(275)
        pdf.set_font("UI", "I", 8)
        pdf.set_text_color(130, 130, 130)
        pdf.cell(
            0, 4,
            "Mentions DAS obligatoires (art. R20-10-2 CPCE) — Les valeurs DAS indiquent la quantité d'énergie radiofréquence absorbée par le corps.",
            align="C", new_x="LMARGIN", new_y="NEXT",
        )
        pdf.cell(0, 4, "KlikPhone — Tarifs reconditionnés, pièces d'origine, garantie 1 an", align="C")

    return bytes(pdf.output())


def _get_models(slugs: Optional[List[str]] = None, group: Optional[str] = None) -> list:
    with get_cursor() as cur:
        if slugs:
            placeholders = ",".join(["%s"] * len(slugs))
            cur.execute(
                f"SELECT * FROM iphone_tarifs WHERE slug IN ({placeholders}) AND actif = TRUE ORDER BY ordre ASC",
                slugs,
            )
        elif group:
            cur.execute(
                "SELECT * FROM iphone_tarifs WHERE page_group = %s AND actif = TRUE ORDER BY ordre ASC",
                (group,),
            )
        else:
            cur.execute("SELECT * FROM iphone_tarifs WHERE actif = TRUE ORDER BY ordre ASC")
        return [dict(r) for r in cur.fetchall()]


@router.get("/pdf")
def generate_pdf(
    slugs: Optional[str] = Query(None, description="Liste de slugs séparés par virgule"),
    group: Optional[str] = Query(None, description="Grouper par page_group (ex: '13')"),
):
    """Génère un PDF pour les modèles sélectionnés (par défaut tous)."""
    slug_list = [s.strip() for s in slugs.split(",") if s.strip()] if slugs else None
    models = _get_models(slugs=slug_list, group=group)
    if not models:
        raise HTTPException(404, "Aucun modèle trouvé")

    pdf_bytes = _render_pdf(models)
    filename = "klikphone_tarifs_iphones.pdf"
    if slug_list and len(slug_list) <= 3:
        filename = f"klikphone_tarifs_{'_'.join(slug_list)}.pdf"
    elif group:
        filename = f"klikphone_tarifs_{group}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.get("/pdf/all-zip")
def generate_all_pdfs_zip():
    """Génère un ZIP contenant un PDF par page_group (un pack d'affiches)."""
    with get_cursor() as cur:
        cur.execute(
            "SELECT DISTINCT page_group FROM iphone_tarifs WHERE actif = TRUE AND page_group IS NOT NULL ORDER BY page_group"
        )
        groups = [r["page_group"] if isinstance(r, dict) else r[0] for r in cur.fetchall()]

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for g in groups:
            models = _get_models(group=g)
            if not models:
                continue
            pdf_bytes = _render_pdf(models)
            safe = re.sub(r"[^a-zA-Z0-9_-]", "", g)
            zf.writestr(f"klikphone_tarifs_{safe}.pdf", pdf_bytes)

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="klikphone_tarifs_iphones.zip"'},
    )
