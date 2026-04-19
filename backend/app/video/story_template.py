"""
Frame rendering for Story video 9:16 (1080×1920).
Pillow-based rendering, no external image deps beyond Pillow + local fonts.
"""

import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter


W, H = 1080, 1920
FONTS_DIR = Path(__file__).parent.parent / "assets" / "fonts"
ASSETS_DIR = Path(__file__).parent.parent / "assets" / "iphone_tarifs"

ORANGE = (232, 100, 26)
ORANGE_BRIGHT = (255, 140, 60)
DARK_BG = (10, 10, 14)
WHITE = (255, 255, 255)
GRAY_LIGHT = (180, 180, 195)
GRAY_DARK = (40, 40, 50)

# Palette scene background per index
SCENE_BG = [
    ((30, 10, 20), (90, 30, 10)),   # orange-red radial
    ((10, 15, 40), (30, 50, 100)),  # deep blue
    ((25, 10, 40), (70, 30, 110)),  # violet
    ((10, 30, 25), (20, 80, 60)),   # teal
    ((40, 20, 10), (120, 60, 20)),  # amber
    ((10, 10, 10), (50, 50, 60)),   # neutral dark
    ((20, 10, 30), (80, 30, 90)),   # magenta
    ((10, 25, 35), (20, 90, 110)),  # cyan
]


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    return ImageFont.truetype(str(FONTS_DIR / name), size)


def _ease_out(t: float) -> float:
    return 1 - (1 - t) ** 3


def _ease_in_out(t: float) -> float:
    return 0.5 * (1 - math.cos(math.pi * t))


def _radial_gradient(inner: tuple, outer: tuple, cx: int = W // 2, cy: int = H // 2) -> Image.Image:
    """Fond radial simple et rapide — via Pillow seul."""
    img = Image.new("RGB", (W, H), outer)
    # Faster radial: draw concentric ellipses
    draw = ImageDraw.Draw(img)
    max_r = int(math.hypot(W, H) / 1.4)
    steps = 40
    for i in range(steps, 0, -1):
        t = i / steps
        r = int(max_r * t)
        r_c = int(inner[0] * (1 - t) + outer[0] * t)
        g_c = int(inner[1] * (1 - t) + outer[1] * t)
        b_c = int(inner[2] * (1 - t) + outer[2] * t)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(r_c, g_c, b_c))
    return img


def _draw_text_centered(draw: ImageDraw.ImageDraw, text: str, y: int, font, fill=WHITE):
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    draw.text(((W - tw) // 2, y), text, font=font, fill=fill)
    return tw


def _text_w(draw: ImageDraw.ImageDraw, text: str, font) -> int:
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0]


def _paste_with_shadow(base: Image.Image, overlay: Image.Image, pos: tuple,
                       shadow_color: tuple = (0, 0, 0), offset: tuple = (0, 20),
                       blur: int = 40, opacity: int = 120):
    """Pose l'image avec une ombre floue en dessous."""
    if overlay.mode != "RGBA":
        overlay = overlay.convert("RGBA")
    alpha = overlay.split()[-1]
    shadow = Image.new("RGBA", overlay.size, shadow_color + (0,))
    shadow.putalpha(alpha.point(lambda a: min(a, opacity)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(blur))
    base.alpha_composite(shadow, (pos[0] + offset[0], pos[1] + offset[1]))
    base.alpha_composite(overlay, pos)


# ───────────────────────────────────────────────────────────
# INTRO (2s)
# ───────────────────────────────────────────────────────────
def render_intro_frame(progress: float) -> Image.Image:
    """Intro: gradient radial noir → bleu nuit, titre qui fade in."""
    p = _ease_out(max(0.0, min(1.0, progress)))
    img = _radial_gradient((20, 30, 60), DARK_BG).convert("RGBA")
    draw = ImageDraw.Draw(img)

    # Particules convergentes (simples cercles)
    n_particles = 24
    center_x, center_y = W // 2, H // 2
    for i in range(n_particles):
        angle = (i / n_particles) * 2 * math.pi
        radius = int((1 - p) * 600 + 100)
        px = int(center_x + math.cos(angle) * radius)
        py = int(center_y + math.sin(angle) * radius - 150)
        size = int(4 + p * 3)
        alpha = int(100 + p * 155)
        draw.ellipse([px - size, py - size, px + size, py + size],
                     fill=ORANGE + (alpha,))

    # Apple logo (⌘ substitute — we draw a circle + leaf shape simplified)
    logo_y = int(H * 0.38)
    scale = 0.3 + 0.7 * p
    logo_size = int(180 * scale)
    _draw_apple_logo(draw, W // 2, logo_y, logo_size, (255, 255, 255, int(255 * p)))

    # Title "iPhone" (fade in, scales a bit)
    title_font = _font(int(130 * (0.8 + 0.2 * p)), bold=False)
    title_alpha = int(255 * p)
    title = "iPhone"
    tw = _text_w(draw, title, title_font)
    draw.text(((W - tw) // 2, int(H * 0.52)), title, font=title_font,
              fill=(255, 255, 255, title_alpha))

    # Sous-titre orange
    sub_font = _font(40, bold=True)
    sub = "CHEZ KLIKPHONE"
    # letter spacing simulated via split
    sub_alpha = int(255 * p)
    sub_w = _text_w(draw, sub, sub_font) + (len(sub) - 1) * 3
    x = (W - sub_w) // 2
    y = int(H * 0.65)
    for ch in sub:
        draw.text((x, y), ch, font=sub_font, fill=ORANGE + (sub_alpha,))
        x += _text_w(draw, ch, sub_font) + 3

    return img


def _draw_apple_logo(draw: ImageDraw.ImageDraw, cx: int, cy: int, size: int, fill: tuple):
    """Logo Apple stylisé — silhouette simplifiée."""
    r = size // 2
    # body : deux cercles qui se chevauchent
    draw.ellipse([cx - r, cy - r, cx + r, cy + int(r * 0.5)], fill=fill)
    # bite (petit cercle à droite qui enlève une part)
    # Simulé : on dessine pas la bite exacte mais une feuille au dessus
    leaf_r = max(size // 10, 6)
    draw.ellipse([cx - leaf_r, cy - r - leaf_r - 8,
                  cx + leaf_r, cy - r + leaf_r - 8], fill=fill)


# ───────────────────────────────────────────────────────────
# SCÈNE iPhone (3s par phone)
# ───────────────────────────────────────────────────────────
def render_phone_frame(phone: dict, photo: Image.Image, progress: float,
                       idx: int, total: int) -> Image.Image:
    """Scène produit avec photo, titre, prix."""
    p = max(0.0, min(1.0, progress))
    color = SCENE_BG[idx % len(SCENE_BG)]
    img = _radial_gradient(color[1], color[0]).convert("RGBA")
    draw = ImageDraw.Draw(img)

    # Barres de progression en haut (style story)
    bar_y = 40
    bar_h = 4
    gap = 8
    bar_w_total = W - 80
    per_bar = (bar_w_total - gap * (total - 1)) // total
    for i in range(total):
        x = 40 + i * (per_bar + gap)
        # Bar background
        draw.rectangle([x, bar_y, x + per_bar, bar_y + bar_h], fill=(255, 255, 255, 80))
        # Fill
        if i < idx:
            fill_w = per_bar
        elif i == idx:
            fill_w = int(per_bar * p)
        else:
            fill_w = 0
        if fill_w > 0:
            draw.rectangle([x, bar_y, x + fill_w, bar_y + bar_h],
                           fill=(255, 255, 255, 230))

    # Header : compteur
    header_font = _font(30, bold=True)
    counter = f"{idx + 1} / {total}"
    draw.text((40, 90), "klikphone.fr", font=header_font, fill=(255, 255, 255, 200))
    cw = _text_w(draw, counter, header_font)
    draw.text((W - 40 - cw, 90), counter, font=header_font,
              fill=ORANGE + (230,))

    # Photo iPhone centrée avec ombre portée
    max_ph_h = 900
    max_ph_w = 600
    ph = photo.copy()
    ph.thumbnail((max_ph_w, max_ph_h), Image.LANCZOS)
    # Animation : slide up + fade in sur première 300ms
    enter = _ease_out(min(1.0, p / 0.25))
    # Exit : slide + fade sur dernière 20%
    exit_anim = 0
    if p > 0.85:
        exit_anim = _ease_in_out((p - 0.85) / 0.15)

    ph_x = (W - ph.width) // 2
    ph_y = int(350 + (1 - enter) * 80 - exit_anim * 80)

    # Petit scale pulse
    scale = 0.95 + 0.05 * _ease_in_out(p)
    new_w = int(ph.width * scale)
    new_h = int(ph.height * scale)
    ph_resized = ph.resize((new_w, new_h), Image.LANCZOS)
    ph_x = (W - new_w) // 2
    ph_y = int(350 + (1 - enter) * 80 - exit_anim * 80)

    _paste_with_shadow(img, ph_resized, (ph_x, ph_y),
                       shadow_color=color[1], offset=(0, 40),
                       blur=60, opacity=180)

    # Texte en bas : modèle, storage, couleur, prix
    text_alpha = int(255 * enter * (1 - exit_anim))

    # Modèle (sans "iPhone" prefix pour plus d'impact)
    model_full = phone["model"]
    model_display = model_full.replace("iPhone ", "")
    model_font = _font(90, bold=True)
    model_y = int(H * 0.74)
    mw = _text_w(draw, model_display, model_font)
    draw.text(((W - mw) // 2, model_y), model_display, font=model_font,
              fill=(255, 255, 255, text_alpha))

    # Storage + couleur
    meta_font = _font(36)
    meta = f"{phone['storage']} · {phone['color_name']}"
    meta_y = model_y + 100
    metaw = _text_w(draw, meta, meta_font)
    draw.text(((W - metaw) // 2, meta_y), meta, font=meta_font,
              fill=GRAY_LIGHT + (text_alpha,))

    # Prix énorme
    price_font = _font(170, bold=True)
    price = f"{phone['price']}€"
    price_y = meta_y + 75
    pw = _text_w(draw, price, price_font)
    draw.text(((W - pw) // 2, price_y), price, font=price_font,
              fill=(255, 255, 255, text_alpha))

    # Ancien prix barré
    if phone.get("old_price"):
        old_font = _font(42)
        old_price = f"{phone['old_price']}€"
        opw = _text_w(draw, old_price, old_font)
        ox = (W - opw) // 2
        oy = price_y - 50
        draw.text((ox, oy), old_price, font=old_font,
                  fill=GRAY_LIGHT + (int(180 * enter),))
        # Ligne barrée
        draw.line([(ox, oy + 26), (ox + opw, oy + 26)],
                  fill=GRAY_LIGHT + (int(200 * enter),), width=3)

        # Pill "-X€ DE REMISE"
        diff = phone["old_price"] - phone["price"]
        pill = f"-{diff}€ DE REMISE"
        pill_font = _font(32, bold=True)
        pill_w = _text_w(draw, pill, pill_font) + 40
        pill_h = 60
        px = (W - pill_w) // 2
        py = price_y + 200
        # Glow
        glow = Image.new("RGBA", (pill_w + 60, pill_h + 60), (0, 0, 0, 0))
        gdraw = ImageDraw.Draw(glow)
        gdraw.rounded_rectangle([30, 30, pill_w + 30, pill_h + 30],
                                radius=pill_h // 2,
                                fill=ORANGE + (int(180 * enter),))
        glow = glow.filter(ImageFilter.GaussianBlur(18))
        img.alpha_composite(glow, (px - 30, py - 30))
        # Pill
        draw.rounded_rectangle([px, py, px + pill_w, py + pill_h],
                               radius=pill_h // 2,
                               fill=ORANGE + (text_alpha,))
        draw.text((px + 20, py + 12), pill, font=pill_font,
                  fill=(255, 255, 255, text_alpha))

    # Footer : stock + garantie
    footer_font = _font(28, bold=True)
    stock_txt = f"{phone.get('stock', 0)} DISPONIBLE" + ("S" if phone.get("stock", 0) > 1 else "") \
        + " · GARANTIE 12 MOIS"
    fw = _text_w(draw, stock_txt, footer_font)
    draw.text(((W - fw) // 2, H - 120), stock_txt, font=footer_font,
              fill=(255, 255, 255, int(180 * enter)))

    return img


# ───────────────────────────────────────────────────────────
# OUTRO (2s)
# ───────────────────────────────────────────────────────────
def render_outro_frame(progress: float) -> Image.Image:
    """Outro : branding Klikphone."""
    p = _ease_out(max(0.0, min(1.0, progress)))
    img = _radial_gradient((80, 30, 10), (10, 10, 14)).convert("RGBA")
    draw = ImageDraw.Draw(img)

    # Logo Klikphone
    logo_y = int(H * 0.32)
    _draw_apple_logo(draw, W // 2 - 120, logo_y, int(120 * p), (255, 255, 255, int(255 * p)))
    # K stylisé à côté
    k_font = _font(int(150 * p), bold=True)
    draw.text((W // 2 + 20, logo_y - 70), "K", font=k_font,
              fill=ORANGE + (int(255 * p),))

    # Title
    title_font = _font(100, bold=True)
    title = "KLIKPHONE"
    tw = _text_w(draw, title, title_font)
    draw.text(((W - tw) // 2, int(H * 0.48)), title, font=title_font,
              fill=(255, 255, 255, int(255 * p)))

    # Sous-titre
    sub_font = _font(38)
    sub = "Spécialiste Apple · Chambéry"
    subw = _text_w(draw, sub, sub_font)
    draw.text(((W - subw) // 2, int(H * 0.58)), sub, font=sub_font,
              fill=GRAY_LIGHT + (int(255 * p),))

    # Séparateur orange
    sep_w = int(200 * p)
    sep_y = int(H * 0.65)
    draw.rectangle([W // 2 - sep_w // 2, sep_y, W // 2 + sep_w // 2, sep_y + 4],
                   fill=ORANGE + (int(255 * p),))

    # Adresse
    addr_font = _font(32)
    addr = "79 Place Saint-Léger, 73000 Chambéry"
    aw = _text_w(draw, addr, addr_font)
    draw.text(((W - aw) // 2, int(H * 0.70)), addr, font=addr_font,
              fill=WHITE + (int(230 * p),))

    # Téléphone
    tel_font = _font(52, bold=True)
    tel = "06 95 71 51 96"
    tlw = _text_w(draw, tel, tel_font)
    draw.text(((W - tlw) // 2, int(H * 0.75)), tel, font=tel_font,
              fill=ORANGE + (int(255 * p),))

    # Bouton KLIKPHONE.FR
    btn_font = _font(42, bold=True)
    btn_text = "KLIKPHONE.FR"
    btn_w = _text_w(draw, btn_text, btn_font) + 80
    btn_h = 90
    btn_x = (W - btn_w) // 2
    btn_y = int(H * 0.84)
    draw.rounded_rectangle([btn_x, btn_y, btn_x + btn_w, btn_y + btn_h],
                           radius=btn_h // 2,
                           fill=ORANGE + (int(255 * p),))
    draw.text((btn_x + 40, btn_y + 20), btn_text, font=btn_font,
              fill=(255, 255, 255, int(255 * p)))

    return img
