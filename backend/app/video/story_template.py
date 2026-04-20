"""
Frame rendering for Story video 9:16 (1080×1920) — design premium Apple keynote.

Direction artistique :
- Fond : noir profond (#000) + spot lighting coloré derrière l'iPhone (mood cinématique)
- Hero : photo iPhone à 60% de la hauteur, glow subtil coloré par la teinte du phone
- Typographie : Inter (Black/Bold/Medium) → tension Apple-like, très lisible mobile
- Hiérarchie : badge condition (top) → photo hero (center) → nom/prix (bottom-heavy)
- Prix en Inter Black 170pt avec petit glow orange → effet "prix découverte" premium
- Pas de pill promo criarde, juste une ligne subtile "ancien prix barré"
- Logo Klikphone discret en haut + CTA outro

Inspiré des keynotes Apple : fond noir, lighting dramatique, zero friction visuelle.
"""

import math
from functools import lru_cache
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops


W, H = 1080, 1920
FONTS_DIR = Path(__file__).parent.parent / "assets" / "fonts"
LOGO_PATH = Path(__file__).parent / "assets" / "klikphone_logo.png"

# ─── Palette ────────────────────────────────────────────────────
BG_BLACK = (0, 0, 0)
BG_CARD = (14, 14, 16)
WHITE = (255, 255, 255)
GRAY_400 = (170, 170, 180)
GRAY_300 = (210, 210, 220)
GRAY_500 = (130, 130, 140)

# Orange Klikphone mais plus subtil dans ce design premium
ORANGE = (255, 110, 40)
ORANGE_SOFT = (255, 140, 70)

# Condition → couleur badge (émeraude / bleu / ambre)
CONDITION_COLORS = {
    "Neuf": (60, 200, 140),
    "Reconditionné Premium": (80, 150, 240),
    "Reconditionné": (240, 175, 60),
}

# Spot lighting (inner, outer) — varie par teinte dominante du phone
SPOT_COLORS = [
    ((40, 30, 80), (0, 0, 0)),      # violet profond
    ((60, 20, 30), (0, 0, 0)),      # bordeaux
    ((20, 40, 60), (0, 0, 0)),      # bleu nuit
    ((20, 55, 50), (0, 0, 0)),      # teal deep
    ((55, 30, 20), (0, 0, 0)),      # ambre chaud
    ((30, 30, 40), (0, 0, 0)),      # graphite
    ((50, 20, 50), (0, 0, 0)),      # magenta
    ((15, 40, 55), (0, 0, 0)),      # cyan deep
]


# ─── Fonts ──────────────────────────────────────────────────────
# Inter est préféré (créé pour ressembler à SF Pro), DejaVu fallback
_INTER_FILES = {
    "black": FONTS_DIR / "Inter-Black.ttf",
    "bold": FONTS_DIR / "Inter-Bold.ttf",
    "semibold": FONTS_DIR / "Inter-SemiBold.ttf",
    "medium": FONTS_DIR / "Inter-Medium.ttf",
    "regular": FONTS_DIR / "Inter-Regular.ttf",
}
_DEJAVU_BOLD = FONTS_DIR / "DejaVuSans-Bold.ttf"
_DEJAVU_REG = FONTS_DIR / "DejaVuSans.ttf"


@lru_cache(maxsize=40)
def _font(size: int, weight: str = "regular") -> ImageFont.FreeTypeFont:
    size = max(1, int(size))
    path = _INTER_FILES.get(weight)
    if path and path.exists():
        return ImageFont.truetype(str(path), size)
    # Fallback DejaVu
    fallback = _DEJAVU_BOLD if weight in ("black", "bold", "semibold") else _DEJAVU_REG
    return ImageFont.truetype(str(fallback), size)


@lru_cache(maxsize=1)
def _logo() -> Image.Image:
    if not LOGO_PATH.exists():
        return None
    return Image.open(LOGO_PATH).convert("RGBA")


# ─── Easings ────────────────────────────────────────────────────
def _ease_out(t: float) -> float:
    return 1 - (1 - t) ** 3


def _ease_in_out(t: float) -> float:
    return 0.5 * (1 - math.cos(math.pi * t))


def _ease_out_quint(t: float) -> float:
    return 1 - (1 - t) ** 5


# ─── Drawing helpers ────────────────────────────────────────────
def _radial_spot(inner: tuple, outer: tuple, cx: int = W // 2,
                 cy: int = int(H * 0.45), spread: float = 1.0) -> Image.Image:
    """Spot lighting radial (plus dramatique qu'un gradient full-screen)."""
    img = Image.new("RGB", (W, H), outer)
    draw = ImageDraw.Draw(img)
    max_r = int(math.hypot(W, H) * 0.6 * spread)
    steps = 50
    for i in range(steps, 0, -1):
        t = i / steps
        r = int(max_r * t)
        rc = int(inner[0] * (1 - t) + outer[0] * t)
        gc = int(inner[1] * (1 - t) + outer[1] * t)
        bc = int(inner[2] * (1 - t) + outer[2] * t)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(rc, gc, bc))
    return img


def _text_w(draw: ImageDraw.ImageDraw, text: str, font) -> int:
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0]


def _draw_text(draw: ImageDraw.ImageDraw, pos: tuple, text: str, font, fill):
    draw.text(pos, text, font=font, fill=fill)


def _paste_with_shadow(base: Image.Image, overlay: Image.Image, pos: tuple,
                       shadow_color: tuple = (0, 0, 0), offset: tuple = (0, 30),
                       blur: int = 50, opacity: int = 160):
    if overlay.mode != "RGBA":
        overlay = overlay.convert("RGBA")
    alpha = overlay.split()[-1]
    shadow = Image.new("RGBA", overlay.size, shadow_color + (0,))
    shadow.putalpha(alpha.point(lambda a: min(a, opacity)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(blur))
    base.alpha_composite(shadow, (pos[0] + offset[0], pos[1] + offset[1]))
    base.alpha_composite(overlay, pos)


def _paste_with_glow(base: Image.Image, overlay: Image.Image, pos: tuple,
                     glow_color: tuple, blur: int = 90, opacity: int = 60):
    if overlay.mode != "RGBA":
        overlay = overlay.convert("RGBA")
    alpha = overlay.split()[-1]
    glow = Image.new("RGBA", overlay.size, glow_color + (0,))
    glow.putalpha(alpha.point(lambda a: min(a, opacity)))
    glow = glow.filter(ImageFilter.GaussianBlur(blur))
    base.alpha_composite(glow, pos)
    base.alpha_composite(overlay, pos)


def _draw_klikphone_logo(base: Image.Image, cx: int, cy: int, size: int,
                         alpha: int = 255):
    """Logo Klikphone en squircle iOS."""
    logo = _logo()
    if logo is None:
        return
    s = max(1, int(size))
    resized = logo.resize((s, s), Image.LANCZOS)
    r, g, b, a = resized.split()
    if alpha < 255:
        a = a.point(lambda x: int(x * alpha / 255))
    # Squircle mask
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s, s], radius=s // 5, fill=255)
    a = ImageChops.multiply(a, mask)
    resized = Image.merge("RGBA", (r, g, b, a))
    base.alpha_composite(resized, (cx - s // 2, cy - s // 2))


def _draw_vignette(img: Image.Image, strength: float = 0.55):
    """Vignette sombre sur les bords pour concentrer l'attention (style keynote)."""
    vignette = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    vdraw = ImageDraw.Draw(vignette)
    max_r = int(math.hypot(W, H) * 0.55)
    steps = 30
    cx, cy = W // 2, H // 2
    for i in range(steps):
        t = i / steps
        r = int(max_r * (0.5 + 0.5 * t))
        alpha = int(strength * 255 * t)
        vdraw.ellipse([cx - r, cy - r, cx + r, cy + r],
                      outline=(0, 0, 0, alpha), width=20)
    vignette = vignette.filter(ImageFilter.GaussianBlur(60))
    img.alpha_composite(vignette)


# ─── Badge helpers ──────────────────────────────────────────────
def _draw_condition_badge(draw: ImageDraw.ImageDraw, img: Image.Image,
                          x: int, y: int, condition: str, alpha: int = 255):
    """Badge condition (Neuf / Recond. Premium / Reconditionné) en pill métallique."""
    color = CONDITION_COLORS.get(condition, (150, 150, 160))
    label = {"Reconditionné Premium": "RECONDITIONNÉ PREMIUM",
             "Reconditionné": "RECONDITIONNÉ",
             "Neuf": "NEUF"}.get(condition, condition.upper())
    font = _font(20, "bold")
    tw = _text_w(draw, label, font)
    # Marges : 22px à gauche (dot + espace), 24px à droite
    dot_space = 22
    pad_right = 24
    h = 44
    pill_w = dot_space + tw + pad_right
    # Fond pill vitré + outline colorée fine
    draw.rounded_rectangle([x, y, x + pill_w, y + h],
                           radius=h // 2,
                           fill=(255, 255, 255, int(22 * alpha / 255)),
                           outline=color + (int(180 * alpha / 255),),
                           width=1)
    # Dot couleur à gauche (centré verticalement)
    dot_r = 6
    dot_cx = x + 16
    dot_cy = y + h // 2
    # Glow subtil sous le dot
    glow = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([4, 4, 20, 20], fill=color + (int(180 * alpha / 255),))
    glow = glow.filter(ImageFilter.GaussianBlur(3))
    img.alpha_composite(glow, (dot_cx - 12, dot_cy - 12))
    # Dot net
    draw.ellipse([dot_cx - dot_r, dot_cy - dot_r,
                  dot_cx + dot_r, dot_cy + dot_r],
                 fill=color + (alpha,))
    # Label (centré verticalement avec la pill)
    label_y = y + (h - 20) // 2 - 3  # approx ajustement baseline
    draw.text((x + dot_space + 8, label_y), label, font=font,
              fill=(255, 255, 255, alpha))
    return pill_w


# ─── INTRO (1.8s) ───────────────────────────────────────────────
def render_intro_frame(progress: float) -> Image.Image:
    """Intro cinématique : logo Klikphone qui émerge, wordmark, baseline."""
    p = _ease_out(max(0.0, min(1.0, progress)))
    # Spot orange-ambre derrière le logo
    img = _radial_spot((55, 30, 15), BG_BLACK, cy=int(H * 0.42)).convert("RGBA")
    draw = ImageDraw.Draw(img)

    # Particules orange convergentes
    center_x, center_y = W // 2, int(H * 0.38)
    for i in range(24):
        angle = (i / 24) * 2 * math.pi
        radius = int((1 - p) * 650 + 50)
        px = int(center_x + math.cos(angle) * radius)
        py = int(center_y + math.sin(angle) * radius)
        size = int(2 + p * 3)
        a = int(60 + p * 120)
        draw.ellipse([px - size - 4, py - size - 4, px + size + 4, py + size + 4],
                     fill=ORANGE + (a // 4,))
        draw.ellipse([px - size, py - size, px + size, py + size],
                     fill=ORANGE_SOFT + (a,))

    # Logo Klikphone : zoom + fade
    logo_size = int(200 + 140 * p)
    _draw_klikphone_logo(img, W // 2, int(H * 0.40), logo_size,
                         alpha=int(255 * p))

    # Wordmark KLIKPHONE (Inter Black, tracking serré)
    title_font = _font(120, "black")
    title = "KLIKPHONE"
    title_alpha = int(255 * max(0, (p - 0.3) / 0.7))
    if title_alpha > 0:
        tw = _text_w(draw, title, title_font)
        ty = int(H * 0.58)
        # Ombre subtile
        draw.text(((W - tw) // 2, ty + 4), title, font=title_font,
                  fill=(0, 0, 0, title_alpha // 2))
        draw.text(((W - tw) // 2, ty), title, font=title_font,
                  fill=(255, 255, 255, title_alpha))

    # Baseline fine
    sub_font = _font(34, "medium")
    sub = "SPÉCIALISTE APPLE · CHAMBÉRY"
    sub_alpha = int(255 * max(0, (p - 0.5) / 0.5))
    if sub_alpha > 0:
        sw = _text_w(draw, sub, sub_font)
        draw.text(((W - sw) // 2, int(H * 0.68)), sub, font=sub_font,
                  fill=ORANGE_SOFT + (sub_alpha,))

    _draw_vignette(img, strength=0.5)
    return img


# ─── SCÈNE iPhone (3s) ──────────────────────────────────────────
def render_phone_frame(phone: dict, photo: Image.Image, progress: float,
                       idx: int, total: int) -> Image.Image:
    """Scène produit : photo hero + modèle + prix + ancien prix + condition."""
    p = max(0.0, min(1.0, progress))

    # Fond : spot lighting coloré selon teinte
    spot = SPOT_COLORS[idx % len(SPOT_COLORS)]
    img = _radial_spot(spot[0], BG_BLACK, cy=int(H * 0.40)).convert("RGBA")
    draw = ImageDraw.Draw(img)

    # Barres de progression story (top)
    bar_y = 44
    bar_h = 4
    gap = 10
    bar_w_total = W - 100
    per_bar = (bar_w_total - gap * (total - 1)) // max(1, total)
    for i in range(total):
        x = 50 + i * (per_bar + gap)
        draw.rounded_rectangle([x, bar_y, x + per_bar, bar_y + bar_h],
                               radius=bar_h // 2, fill=(255, 255, 255, 50))
        if i < idx:
            fill_w = per_bar
        elif i == idx:
            fill_w = int(per_bar * p)
        else:
            fill_w = 0
        if fill_w > 0:
            draw.rounded_rectangle([x, bar_y, x + fill_w, bar_y + bar_h],
                                   radius=bar_h // 2, fill=(255, 255, 255, 245))

    # Logo + marque + compteur (top, discret)
    logo_small = 44
    _draw_klikphone_logo(img, 50 + logo_small // 2, 90 + logo_small // 2,
                         logo_small, alpha=200)
    brand_font = _font(24, "semibold")
    draw.text((logo_small + 66, 100), "klikphone.com",
              font=brand_font, fill=(255, 255, 255, 180))
    counter_font = _font(22, "medium")
    counter = f"{idx + 1:02d} / {total:02d}"
    cw = _text_w(draw, counter, counter_font)
    draw.text((W - 50 - cw, 102), counter, font=counter_font,
              fill=(255, 255, 255, 130))

    # Animation entrée / sortie
    enter = _ease_out_quint(min(1.0, p / 0.25))
    exit_anim = 0
    if p > 0.90:
        exit_anim = _ease_in_out((p - 0.90) / 0.10)
    text_alpha = int(255 * enter * (1 - exit_anim))

    # ─── PHOTO HERO ─────────────────────────────────────────
    # Zone photo : plein centre, bien au-dessus de la fold texte
    photo_zone_top = 170
    photo_zone_h = 980
    ph = photo.copy()
    if ph.width >= ph.height:
        scale = min(940 / ph.width, photo_zone_h / ph.height)
    else:
        scale = min(photo_zone_h / ph.height, 720 / ph.width)
    base_w = max(1, int(ph.width * scale))
    base_h = max(1, int(ph.height * scale))
    ph = ph.resize((base_w, base_h), Image.LANCZOS)

    # Scale pulse subtil (respiration)
    pulse = 0.98 + 0.02 * _ease_in_out(p)
    new_w = max(1, int(base_w * pulse))
    new_h = max(1, int(base_h * pulse))
    ph_resized = ph.resize((new_w, new_h), Image.LANCZOS)

    ph_x = (W - new_w) // 2
    ph_y = photo_zone_top + max(0, (photo_zone_h - new_h) // 2) \
           + int((1 - enter) * 60 - exit_anim * 40)

    # Ombre très douce pour ancrer le phone (pas de glow coloré → l'iPhone
    # se fond directement dans le spot lighting du fond, sans halo visible)
    _paste_with_shadow(img, ph_resized, (ph_x, ph_y),
                       shadow_color=(0, 0, 0), offset=(0, 45),
                       blur=80, opacity=110)

    # ─── BADGE CONDITION (top-left sous header) ─────────────
    cond_y = 180
    _draw_condition_badge(draw, img, 50, cond_y, phone.get("condition", ""),
                          alpha=text_alpha)

    # ─── BLOC TEXTE BAS ─────────────────────────────────────
    # 1. Nom COMPLET "iPhone 15 Pro Max" (pas juste "15 Pro Max")
    model_full = phone["model"]  # ex: "iPhone 15 Pro Max"
    model_font = _font(74, "bold")
    model_y = 1230
    mw = _text_w(draw, model_full, model_font)
    # Soft shadow
    draw.text(((W - mw) // 2 + 2, model_y + 3), model_full, font=model_font,
              fill=(0, 0, 0, int(text_alpha * 0.7)))
    draw.text(((W - mw) // 2, model_y), model_full, font=model_font,
              fill=(255, 255, 255, text_alpha))

    # 2. Storage · couleur (Inter Medium)
    meta_font = _font(30, "medium")
    meta = f"{phone['storage']}   ·   {phone['color_name']}"
    meta_y = model_y + 92
    mw2 = _text_w(draw, meta, meta_font)
    draw.text(((W - mw2) // 2, meta_y), meta, font=meta_font,
              fill=(190, 190, 200, text_alpha))

    # 3. Prix ÉNORME avec glow orange subtil + ancien prix à côté
    price_font = _font(156, "black")
    price = f"{phone['price']}€"
    has_old = bool(phone.get("old_price") and phone["old_price"] > phone["price"])

    price_y = meta_y + 72
    pw = _text_w(draw, price, price_font)

    if has_old:
        old_font = _font(46, "medium")
        old_price = f"{phone['old_price']}€"
        opw = _text_w(draw, old_price, old_font)
        gap = 24
        total_w = pw + gap + opw
        price_x = (W - total_w) // 2
        old_x = price_x + pw + gap
        old_y = price_y + 80

        # Glow derrière le prix (très soft)
        glow_layer = Image.new("RGBA", (W, 240), (0, 0, 0, 0))
        ImageDraw.Draw(glow_layer).text(
            (price_x, 0), price, font=price_font,
            fill=ORANGE_SOFT + (int(140 * enter),))
        img.alpha_composite(
            glow_layer.filter(ImageFilter.GaussianBlur(28)), (0, price_y))

        # Prix blanc net avec léger stroke (effet "gravure")
        draw.text((price_x, price_y), price, font=price_font,
                  fill=(255, 255, 255, text_alpha))

        # Ancien prix barré gris
        draw.text((old_x, old_y), old_price, font=old_font,
                  fill=(140, 140, 150, int(210 * enter)))
        draw.line([(old_x - 4, old_y + 32), (old_x + opw + 4, old_y + 32)],
                  fill=ORANGE + (int(220 * enter),), width=4)

        # Économie (petite ligne en dessous, subtile, pas de pill criarde)
        diff = phone["old_price"] - phone["price"]
        save_font = _font(28, "bold")
        save_text = f"TU ÉCONOMISES {diff}€"
        sw = _text_w(draw, save_text, save_font)
        save_y = price_y + 210
        draw.text(((W - sw) // 2, save_y), save_text, font=save_font,
                  fill=ORANGE_SOFT + (text_alpha,))
    else:
        price_x = (W - pw) // 2
        glow_layer = Image.new("RGBA", (W, 240), (0, 0, 0, 0))
        ImageDraw.Draw(glow_layer).text(
            (price_x, 0), price, font=price_font,
            fill=ORANGE_SOFT + (int(140 * enter),))
        img.alpha_composite(
            glow_layer.filter(ImageFilter.GaussianBlur(28)), (0, price_y))
        draw.text((price_x, price_y), price, font=price_font,
                  fill=(255, 255, 255, text_alpha))

    # 4. Footer : stock + garantie (très discret)
    footer_font = _font(22, "medium")
    stock = phone.get("stock", 0)
    stock_part = f"{stock} DISPONIBLE" + ("S" if stock > 1 else "")
    footer = f"{stock_part}   ·   GARANTIE 12 MOIS"
    fw = _text_w(draw, footer, footer_font)
    draw.text(((W - fw) // 2, H - 90), footer, font=footer_font,
              fill=(150, 150, 160, int(210 * enter)))

    # Vignette finale
    _draw_vignette(img, strength=0.45)
    return img


# ─── OUTRO (2.2s) ───────────────────────────────────────────────
def render_outro_frame(progress: float) -> Image.Image:
    """Outro : branding Klikphone + CTA."""
    p = _ease_out(max(0.0, min(1.0, progress)))
    img = _radial_spot((55, 28, 12), BG_BLACK, cy=int(H * 0.35)).convert("RGBA")
    draw = ImageDraw.Draw(img)

    # Halo orange doux derrière le logo
    halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    hdraw = ImageDraw.Draw(halo)
    hr = int(380 * p)
    hdraw.ellipse([W // 2 - hr, int(H * 0.30) - hr,
                   W // 2 + hr, int(H * 0.30) + hr],
                  fill=ORANGE + (int(75 * p),))
    halo = halo.filter(ImageFilter.GaussianBlur(70))
    img.alpha_composite(halo)

    # Logo Klikphone grand
    logo_size = int(300 * (0.5 + 0.5 * p))
    _draw_klikphone_logo(img, W // 2, int(H * 0.30), logo_size,
                         alpha=int(255 * p))

    # Wordmark
    title_font = _font(94, "black")
    title = "KLIKPHONE"
    tw = _text_w(draw, title, title_font)
    ty = int(H * 0.49)
    title_alpha = int(255 * p)
    draw.text(((W - tw) // 2 + 2, ty + 3), title, font=title_font,
              fill=(0, 0, 0, title_alpha // 2))
    draw.text(((W - tw) // 2, ty), title, font=title_font,
              fill=(255, 255, 255, title_alpha))

    # Sous-titre
    sub_font = _font(34, "medium")
    sub = "Spécialiste Apple · Chambéry"
    sw = _text_w(draw, sub, sub_font)
    draw.text(((W - sw) // 2, int(H * 0.575)), sub, font=sub_font,
              fill=(210, 210, 220, int(240 * p)))

    # Séparateur orange fin
    sep_w = int(240 * p)
    sep_y = int(H * 0.63)
    draw.rounded_rectangle([W // 2 - sep_w // 2, sep_y,
                            W // 2 + sep_w // 2, sep_y + 4],
                           radius=2, fill=ORANGE + (int(255 * p),))

    # Adresse
    addr_font = _font(28, "medium")
    addr = "79 Place Saint-Léger, 73000 Chambéry"
    aw = _text_w(draw, addr, addr_font)
    draw.text(((W - aw) // 2, int(H * 0.67)), addr, font=addr_font,
              fill=(225, 225, 235, int(240 * p)))

    # Téléphone (accroche)
    tel_font = _font(56, "bold")
    tel = "06 95 71 51 96"
    tw2 = _text_w(draw, tel, tel_font)
    draw.text(((W - tw2) // 2, int(H * 0.735)), tel, font=tel_font,
              fill=ORANGE_SOFT + (int(255 * p),))

    # CTA button KLIKPHONE.FR
    btn_font = _font(40, "bold")
    btn_text = "KLIKPHONE.COM"
    btn_tw = _text_w(draw, btn_text, btn_font)
    btn_w = btn_tw + 100
    btn_h = 90
    btn_x = (W - btn_w) // 2
    btn_y = int(H * 0.84)
    # Glow bouton
    btn_glow = Image.new("RGBA", (btn_w + 100, btn_h + 100), (0, 0, 0, 0))
    ImageDraw.Draw(btn_glow).rounded_rectangle(
        [50, 50, btn_w + 50, btn_h + 50],
        radius=btn_h // 2, fill=ORANGE + (int(160 * p),))
    img.alpha_composite(
        btn_glow.filter(ImageFilter.GaussianBlur(22)),
        (btn_x - 50, btn_y - 50))
    # Bouton plein
    draw.rounded_rectangle([btn_x, btn_y, btn_x + btn_w, btn_y + btn_h],
                           radius=btn_h // 2,
                           fill=ORANGE + (int(255 * p),))
    draw.text((btn_x + (btn_w - btn_tw) // 2, btn_y + 22), btn_text,
              font=btn_font, fill=(255, 255, 255, int(255 * p)))

    _draw_vignette(img, strength=0.4)
    return img
