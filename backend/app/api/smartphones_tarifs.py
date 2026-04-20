"""
API Tarifs Smartphones (non-Apple) — Samsung, Xiaomi, Honor, Google Pixel, etc.

Meme structure que iphone_tarifs.py mais dedie aux autres marques.
Permet a l'admin de gerer sa propre liste de smartphones reconditionnes/neufs
avec prix, storage, condition et image auto-generée (par IA) ou uploadée.
"""

import hashlib
import io
import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import List, Optional

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from fpdf import FPDF
from PIL import Image
from psycopg2.extras import execute_values
from pydantic import BaseModel

from app.database import get_cursor

# Assets pour PDF (logo + fonts)
_ASSETS_DIR = Path(__file__).parent.parent / "assets" / "iphone_tarifs"
_FONTS_DIR = Path(__file__).parent.parent / "assets" / "fonts"
_LOGO_PATH = _ASSETS_DIR / "logo.png"

# Cache disque pour les images distantes (convertit WebP/JPEG/PNG → PNG)
_PDF_IMG_CACHE = Path(__file__).parent.parent / "video" / "cache" / "pdf_images"
_PDF_IMG_CACHE.mkdir(parents=True, exist_ok=True)


def _fetch_image_for_pdf(url: str) -> Optional[Path]:
    """Télécharge + convertit une image distante en PNG local.

    fpdf2 ne supporte que JPEG/PNG/GIF. Les images DuckDuckGo sont souvent
    en WebP ou d'autres formats exotiques → Pillow convertit systematiquement
    en PNG RGB. Cache disque SHA256 pour ne pas re-fetch a chaque PDF."""
    if not url or not url.startswith("http"):
        return None
    h = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
    cache = _PDF_IMG_CACHE / f"{h}.png"
    if cache.exists() and cache.stat().st_size > 200:
        return cache
    try:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 Chrome/120 Safari/537.36"
            ),
            "Accept": "image/webp,image/jpeg,image/png,image/*,*/*;q=0.8",
            "Referer": "https://duckduckgo.com/",
        }
        r = httpx.get(url, timeout=10.0, follow_redirects=True, headers=headers)
        if r.status_code != 200 or len(r.content) < 500:
            logger.info("PDF image skip (%s %d bytes) : %s", r.status_code, len(r.content), url[:80])
            return None
        # Ouvre avec Pillow (gère WebP, JPEG, PNG, etc.)
        img = Image.open(io.BytesIO(r.content))
        # Convertit en RGB avec fond blanc (pour les PNG avec alpha)
        if img.mode in ("RGBA", "LA", "P"):
            bg = Image.new("RGB", img.size, (255, 255, 255))
            img_rgba = img.convert("RGBA")
            bg.paste(img_rgba, mask=img_rgba.split()[-1] if img_rgba.mode == "RGBA" else None)
            img = bg
        else:
            img = img.convert("RGB")
        # Redimensionne si trop gros (pas besoin > 600px pour PDF)
        if img.width > 600 or img.height > 600:
            img.thumbnail((600, 600), Image.LANCZOS)
        img.save(cache, "PNG", optimize=True)
        return cache
    except Exception as e:
        logger.info("PDF image fetch failed for %s : %s", url[:80], e)
        return None


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

    # Valide chaque candidat en parallele : ne conserve que les URLs que
    # notre serveur peut reellement telecharger (certains CDN renvoient
    # 403 Cloudflare ou 500 selon l'User-Agent). Le cache de fetch rend
    # les PDFs ulterieurs instantanes sur ces URLs.
    with ThreadPoolExecutor(max_workers=6) as ex:
        fetched = list(ex.map(_fetch_image_for_pdf, candidates))
    valid = [url for url, path in zip(candidates, fetched) if path]
    if not valid:
        # Aucune URL telechargeable — dégradé propre : retourne la liste
        # brute, l'admin verra au moins les vignettes (chargees depuis
        # le navigateur, pas le serveur).
        valid = candidates
        logger.warning(
            "Aucune URL DDG telechargeable pour '%s' — retour de %d candidats non valides",
            query, len(candidates),
        )

    return {
        "image_url": valid[0],
        "alternatives": valid[1:8],
        "query": query,
        "source": "duckduckgo_images",
    }


# ---------------------------------------------------------------------------
# PDF Generation — affiche boutique smartphones (A4)
# ---------------------------------------------------------------------------
ORANGE = (245, 130, 32)
DARK = (40, 40, 40)
GRAY_BG = (248, 249, 251)
GRAY_BORDER = (220, 224, 230)
EMERALD = (34, 160, 110)
BLUE = (45, 120, 220)


def _find_font_file(bold: bool = False, italic: bool = False) -> str:
    if bold:
        p = _FONTS_DIR / "DejaVuSans-Bold.ttf"
    elif italic:
        p = _FONTS_DIR / "DejaVuSans-Oblique.ttf"
    else:
        p = _FONTS_DIR / "DejaVuSans.ttf"
    if not p.exists():
        raise RuntimeError(f"Police introuvable : {p}")
    return str(p)


class _SmartphonePDF(FPDF):
    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.add_font("UI", "", _find_font_file())
        self.add_font("UI", "B", _find_font_file(bold=True))
        self.add_font("UI", "I", _find_font_file(italic=True))

    def header(self):
        # Bandeau orange en haut
        self.set_fill_color(*ORANGE)
        self.rect(0, 0, 210, 8, style="F")

        # Logo centré
        if _LOGO_PATH.exists():
            self.image(str(_LOGO_PATH), x=(210 - 22) / 2, y=14, w=22, h=22)

        # Wordmark
        self.set_font("UI", "B", 22)
        self.set_text_color(*DARK)
        self.set_y(38)
        self.cell(0, 7, "KLIKPHONE", align="C", new_x="LMARGIN", new_y="NEXT")

        # Baseline
        self.set_font("UI", "I", 9)
        self.set_text_color(120, 120, 120)
        self.cell(0, 4, "Spécialiste Apple & Smartphones · Chambéry", align="C",
                  new_x="LMARGIN", new_y="NEXT")

        # Séparateur
        self.ln(2)
        self.set_draw_color(*ORANGE)
        self.set_line_width(0.8)
        self.line(40, self.get_y(), 170, self.get_y())
        self.ln(4)

        # Sous-titre
        self.set_font("UI", "B", 15)
        self.set_text_color(*DARK)
        self.cell(0, 7, "NOS SMARTPHONES — TARIFS", align="C",
                  new_x="LMARGIN", new_y="NEXT")
        self.ln(3)

    def footer(self):
        self.set_y(-15)
        self.set_font("UI", "", 8)
        self.set_text_color(140, 140, 140)
        self.cell(0, 4, "klikphone.com  ·  06 95 71 51 96  ·  79 Place Saint-Léger, Chambéry",
                  align="C", new_x="LMARGIN", new_y="NEXT")
        self.set_text_color(180, 180, 180)
        self.cell(0, 4, f"Page {self.page_no()}",
                  align="C", new_x="LMARGIN", new_y="NEXT")

    def _condition_pill(self, x: float, y: float, condition: str):
        """Petite pill colorée pour la condition."""
        is_neuf = (condition or "").lower() == "neuf"
        color = EMERALD if is_neuf else BLUE
        label = "NEUF" if is_neuf else "RECOND. PREMIUM"

        self.set_font("UI", "B", 7)
        tw = self.get_string_width(label) + 4
        self.set_fill_color(*color)
        self.set_draw_color(*color)
        self.set_text_color(255, 255, 255)
        self.rect(x, y, tw + 1, 4.5, style="F")
        self.set_xy(x + 0.5, y + 0.3)
        self.cell(tw, 4, label, align="C")
        return tw + 1

    def add_smartphone_row(self, phone: dict, y_top: float, row_idx: int,
                           card_h: float):
        """Une ligne smartphone sur `card_h` mm : photo | marque+modele+condition | prix.

        Design compact et adaptatif :
        - Pas de stock affiche (non pertinent sur affiche boutique)
        - Stockage + prix : une ligne par variante effectivement remplie
          (pas de "256 Go — vide")
        - Taille photo / fonts proportionnelles a card_h pour lisibilite"""
        margin = 10
        x = margin

        # Fond alterne subtil
        if row_idx % 2 == 1:
            self.set_fill_color(*GRAY_BG)
            self.rect(x, y_top, 210 - 2 * margin, card_h, style="F")

        # Border bottom fin
        self.set_draw_color(*GRAY_BORDER)
        self.set_line_width(0.2)
        self.line(x, y_top + card_h, 210 - margin, y_top + card_h)

        # ─ Photo (gauche) — carree et centree verticalement ─
        img_size = min(card_h - 4, 28)
        img_x = x + 2
        img_y = y_top + (card_h - img_size) / 2
        img_url = phone.get("image_url") or ""
        img_drawn = False
        if img_url:
            local = _fetch_image_for_pdf(img_url)
            if local:
                try:
                    self.image(str(local), x=img_x, y=img_y, w=img_size, h=img_size)
                    img_drawn = True
                except Exception as e:
                    logger.info("fpdf image failed %s : %s", local, e)
        if not img_drawn:
            # Placeholder : icone smartphone dans un fond gris clair
            self.set_fill_color(235, 237, 242)
            self.set_draw_color(210, 215, 222)
            self.rect(img_x, img_y, img_size, img_size, style="FD")
            # Petite silhouette de telephone au centre
            ph_w = img_size * 0.45
            ph_h = img_size * 0.7
            ph_x = img_x + (img_size - ph_w) / 2
            ph_y = img_y + (img_size - ph_h) / 2
            self.set_fill_color(200, 205, 215)
            self.rect(ph_x, ph_y, ph_w, ph_h, style="F")

        # ─ Marque + Modele + condition (milieu) ─
        text_x = x + img_size + 6
        # Taille fonts proportionnelle a card_h
        compact = card_h < 22
        brand_size = 7 if compact else 8
        model_size = 12 if compact else 14

        # Marque (petit, orange, majuscules)
        self.set_font("UI", "B", brand_size)
        self.set_text_color(*ORANGE)
        marque_y = y_top + (2.5 if compact else 3)
        self.set_xy(text_x, marque_y)
        self.cell(60, 4, (phone.get("marque") or "").upper())

        # Modele (gros, noir)
        self.set_font("UI", "B", model_size)
        self.set_text_color(*DARK)
        model_y = y_top + (6.5 if compact else 8)
        self.set_xy(text_x, model_y)
        modele = (phone.get("modele") or "")[:30]
        self.cell(75, 6, modele)

        # Condition pill (sous le modele)
        pill_y = y_top + (card_h - 6) if compact else y_top + 17
        self._condition_pill(text_x, pill_y, phone.get("condition") or "")

        # ─ Prix (droite) : une ligne par stockage non vide ─
        # Calcule les variantes qui ont vraiment un prix
        variants = []
        for i in (1, 2, 3):
            p = phone.get(f"prix_{i}")
            s = phone.get(f"stockage_{i}")
            if p:
                variants.append((s, p))

        if not variants:
            return

        # Zone prix : droite de la page
        price_x = 135
        price_w = 65
        # Taille fonts adaptative
        main_size = 17 if not compact else 14
        sub_size = 10 if not compact else 9
        stor_size = 8 if not compact else 7

        # Premier prix : plus gros, orange
        first_stor, first_price = variants[0]
        self.set_font("UI", "B", main_size)
        self.set_text_color(*ORANGE)
        first_y = y_top + (2 if compact else 4)
        self.set_xy(price_x, first_y)
        self.cell(price_w, main_size * 0.5,
                  f"{first_price}€", align="R")
        if first_stor:
            self.set_font("UI", "", stor_size)
            self.set_text_color(130, 130, 130)
            self.set_xy(price_x, first_y + main_size * 0.5 + 0.5)
            self.cell(price_w, 4, first_stor, align="R")

        # Variantes suivantes (si existent) : plus petites, gris
        if len(variants) > 1:
            sub_y = first_y + main_size * 0.5 + (4 if compact else 5)
            for stor, price in variants[1:]:
                label = f"{price}€"
                if stor:
                    label = f"{stor} · {price}€"
                self.set_font("UI", "B", sub_size)
                self.set_text_color(110, 110, 110)
                self.set_xy(price_x, sub_y)
                self.cell(price_w, 4, label, align="R")
                sub_y += sub_size * 0.42


def _render_smartphones_pdf(phones: list) -> bytes:
    """Génère un PDF A4 UNE PAGE listant tous les smartphones fournis.

    La hauteur de chaque ligne est calculee pour que tout tienne sur 1 page,
    entre 16mm (ultra-compact, ~13 phones max) et 34mm (aere, 6-7 phones)."""
    pdf = _SmartphonePDF(orientation="P", unit="mm", format="A4")
    # Pas de page break auto — on force tout sur une seule page
    pdf.set_auto_page_break(auto=False)
    pdf.add_page()

    # Espace disponible entre header et footer
    y_start = pdf.get_y() + 1
    y_end = 280  # laisse de la place pour le footer (footer commence a -15 = 282)
    usable_h = y_end - y_start

    n = max(1, len(phones))
    # Calcule hauteur de ligne : entre 16mm et 34mm
    row_h = max(16.0, min(34.0, usable_h / n))
    # Si trop de phones pour 1 page meme en compact → on limite visuellement
    # mais on tient quand meme sur 1 page
    max_rows = int(usable_h / 16)
    phones_to_render = phones[:max_rows]

    current_y = y_start
    for idx, phone in enumerate(phones_to_render):
        pdf.add_smartphone_row(phone, current_y, idx, row_h)
        current_y += row_h

    return bytes(pdf.output())


@router.get("/pdf")
def generate_pdf(
    marque: Optional[str] = Query(None),
    ids: Optional[str] = Query(None, description="CSV d'IDs a inclure (prioritaire)"),
):
    """Génère un PDF A4 UNE PAGE avec les smartphones selectionnes.

    Priorite :
    1. `ids=1,2,3` → uniquement ces IDs, dans cet ordre
    2. `marque=Samsung` → tous les smartphones de cette marque
    3. Sinon → tous les smartphones actifs"""
    if ids:
        try:
            id_list = [int(x) for x in ids.split(",") if x.strip()]
        except ValueError:
            raise HTTPException(400, "Format d'IDs invalide (attendu : 1,2,3)")
        if not id_list:
            raise HTTPException(400, "Aucun ID fourni")
        sql = "SELECT * FROM smartphones_tarifs WHERE id = ANY(%s)"
        with get_cursor() as cur:
            cur.execute(sql, (id_list,))
            rows = {r["id"]: dict(r) for r in cur.fetchall()}
        # Preserve l'ordre fourni
        phones = [rows[i] for i in id_list if i in rows]
    else:
        where = ["actif = TRUE"]
        params: list = []
        if marque:
            where.append("marque = %s")
            params.append(marque)
        sql = (
            "SELECT * FROM smartphones_tarifs "
            f"WHERE {' AND '.join(where)} "
            "ORDER BY marque ASC, ordre ASC, modele ASC"
        )
        with get_cursor() as cur:
            cur.execute(sql, params)
            phones = [dict(r) for r in cur.fetchall()]

    if not phones:
        raise HTTPException(404, "Aucun smartphone à afficher")

    pdf_bytes = _render_smartphones_pdf(phones)
    filename = "smartphones_tarifs.pdf" if not marque else f"smartphones_{marque.lower()}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )
