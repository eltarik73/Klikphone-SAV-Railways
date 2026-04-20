"""
Frame rendering for Story video 9:16 (1080×1920).

Design pro :
- Fonds radiaux premium adaptés à la couleur dominante de chaque iPhone
- Photos iPhone détourées avec shadow douce + glow subtil + reflet au sol
- Logo Klikphone (PNG orange/blanc) affiché en intro et outro
- Typographie hiérarchique : modèle en très gros, prix ENORME, badges lisibles
- Animations : ease-out sur les entrées, scale pulse sur la photo, exit fluide
"""

import math
from functools import lru_cache
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter


W, H = 1080, 1920
FONTS_DIR = Path(__file__).parent.parent / "assets" / "fonts"
LOGO_PATH = Path(__file__).parent / "assets" / "klikphone_logo.png"

# Palette Klikphone
ORANGE = (232, 100, 26)
ORANGE_BRIGHT = (255, 140, 60)
ORANGE_DEEP = (200, 70, 10)
DARK_BG = (10, 10, 14)
WHITE = (255, 255, 255)
GRAY_LIGHT = (180, 180, 195)
GRAY_DARK = (40, 40, 50)

# Fonds scène : gradient radial premium par index (couleurs cinématiques)
SCENE_BG = [
    ((20, 40, 70), (5, 10, 22)),    # bleu profond
    ((40, 15, 55), (10, 5, 20)),    # violet nuit
    ((15, 35, 45), (5, 12, 18)),    # teal sombre
    ((50, 25, 15), (15, 8, 5)),     # ambre chaud
    ((35, 15, 40), (12, 5, 18)),    # magenta nuit
    ((20, 30, 55), (8, 12, 22)),    # indigo
    ((15, 25, 35), (5, 10, 15)),    # graphite
    ((45, 30, 15), (18, 10, 5)),    # cuivre
]


@lru_cache(maxsize=16)
def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    size = max(1, int(size))
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    return ImageFont.truetype(str(FONTS_DIR / name), size)


@lru_cache(maxsize=1)
def _logo() -> Image.Image:
    """Logo Klikphone en RGBA, fond orange conservé."""
    if not LOGO_PATH.exists():
        return None
    return Image.open(LOGO_PATH).convert("RGBA")


def _ease_out(t: float) -> float:
    return 1 - (1 - t) ** 3


def _ease_in_out(t: float) -> float:
    return 0.5 * (1 - math.cos(math.pi * t))


def _radial_gradient(inner: tuple, outer: tuple,
                     cx: int = W // 2, cy: int = H // 2) -> Image.Image:
    """Fond radial doux via interpolation par ellipses concentriques."""
    img = Image.new("RGB", (W, H), outer)
    draw = ImageDraw.Draw(img)
    max_r = int(math.hypot(W, H) / 1.3)
    steps = 60  # plus de steps = plus doux
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


def _text_h(draw: ImageDraw.ImageDraw, text: str, font) -> int:
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[3] - bbox[1]


def _draw_text_shadow(draw: ImageDraw.ImageDraw, pos: tuple, text: str,
                      font, fill=WHITE, shadow=(0, 0, 0, 160), offset=(0, 4)):
    """Texte avec ombre portée pour lisibilité."""
    x, y = pos
    draw.text((x + offset[0], y + offset[1]), text, font=font, fill=shadow)
    draw.text((x, y), text, font=font, fill=fill)


def _paste_with_shadow(base: Image.Image, overlay: Image.Image, pos: tuple,
                       shadow_color: tuple = (0, 0, 0), offset: tuple = (0, 30),
                       blur: int = 45, opacity: int = 160):
    """Colle avec ombre floue en dessous."""
    if overlay.mode != "RGBA":
        overlay = overlay.convert("RGBA")
    alpha = overlay.split()[-1]
    shadow = Image.new("RGBA", overlay.size, shadow_color + (0,))
    shadow.putalpha(alpha.point(lambda a: min(a, opacity)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(blur))
    base.alpha_composite(shadow, (pos[0] + offset[0], pos[1] + offset[1]))
    base.alpha_composite(overlay, pos)


def _paste_with_glow(base: Image.Image, overlay: Image.Image, pos: tuple,
                     glow_color: tuple = (255, 255, 255), blur: int = 60,
                     opacity: int = 90):
    """Colle avec un glow diffus (halo lumineux autour du sujet)."""
    if overlay.mode != "RGBA":
        overlay = overlay.convert("RGBA")
    alpha = overlay.split()[-1]
    glow = Image.new("RGBA", overlay.size, glow_color + (0,))
    glow.putalpha(alpha.point(lambda a: min(a, opacity)))
    glow = glow.filter(ImageFilter.GaussianBlur(blur))
    base.alpha_composite(glow, pos)
    base.alpha_composite(overlay, pos)


# ───────────────────────────────────────────────────────────
# Logo Klikphone
# ───────────────────────────────────────────────────────────
def _draw_klikphone_logo(base: Image.Image, cx: int, cy: int, size: int,
                         alpha: int = 255):
    """Compose le logo Klikphone carré centré sur (cx, cy), taille size×size.
    Le logo est squircle-maské (iOS-style) et alpha-modulé."""
    from PIL import ImageChops
    logo = _logo()
    if logo is None:
        return
    s = max(1, int(size))
    resized = logo.resize((s, s), Image.LANCZOS)
    # Module l'alpha global
    r, g, b, a = resized.split()
    if alpha < 255:
        a = a.point(lambda x: int(x * alpha / 255))
    # Squircle mask (coins arrondis à iOS)
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s, s],
                                           radius=s // 5, fill=255)
    a = ImageChops.multiply(a, mask)
    resized = Image.merge("RGBA", (r, g, b, a))
    base.alpha_composite(resized, (cx - s // 2, cy - s // 2))


# ───────────────────────────────────────────────────────────
# INTRO (1.8s)
# ───────────────────────────────────────────────────────────
def render_intro_frame(progress: float) -> Image.Image:
    """Intro cinématique : logo Klikphone qui apparaît en zoom + particules."""
    p = _ease_out(max(0.0, min(1.0, progress)))
    img = _radial_gradient((30, 15, 5), DARK_BG).convert("RGBA")
    draw = ImageDraw.Draw(img)

    # Particules orange convergentes vers le logo
    center_x, center_y = W // 2, int(H * 0.38)
    n_particles = 32
    for i in range(n_particles):
        angle = (i / n_particles) * 2 * math.pi
        radius = int((1 - p) * 700 + 60)
        px = int(center_x + math.cos(angle) * radius)
        py = int(center_y + math.sin(angle) * radius)
        size = int(3 + p * 5)
        alpha = int(60 + p * 140)
        glow_size = size + 6
        # Glow doux
        draw.ellipse([px - glow_size, py - glow_size, px + glow_size, py + glow_size],
                     fill=ORANGE + (alpha // 3,))
        draw.ellipse([px - size, py - size, px + size, py + size],
                     fill=ORANGE_BRIGHT + (alpha,))

    # Logo Klikphone : zoom in + fade
    logo_size = int(240 + 160 * p)
    logo_y = center_y
    _draw_klikphone_logo(img, W // 2, logo_y, logo_size, alpha=int(255 * p))

    # Wordmark "KLIKPHONE" (monte depuis le bas, fade)
    title_font = _font(110, bold=True)
    title = "KLIKPHONE"
    title_alpha = int(255 * max(0, (p - 0.3) / 0.7))
    if title_alpha > 0:
        tw = _text_w(draw, title, title_font)
        ty = int(H * 0.60 + (1 - p) * 30)
        # Letter-spacing doux
        spacing = 6
        parts_w = sum(_text_w(draw, ch, title_font) for ch in title) + spacing * (len(title) - 1)
        x = (W - parts_w) // 2
        for ch in title:
            _draw_text_shadow(draw, (x, ty), ch, title_font,
                              fill=WHITE + (title_alpha,),
                              shadow=(0, 0, 0, title_alpha // 2), offset=(0, 5))
            x += _text_w(draw, ch, title_font) + spacing

    # Baseline orange
    sub_font = _font(42, bold=True)
    sub = "VENTES iPHONE"
    sub_alpha = int(255 * max(0, (p - 0.5) / 0.5))
    if sub_alpha > 0:
        sw = _text_w(draw, sub, sub_font)
        sy = int(H * 0.68)
        draw.text(((W - sw) // 2, sy), sub, font=sub_font,
                  fill=ORANGE_BRIGHT + (sub_alpha,))

    return img


# ───────────────────────────────────────────────────────────
# SCÈNE iPhone (3s par phone)
# ───────────────────────────────────────────────────────────
def render_phone_frame(phone: dict, photo: Image.Image, progress: float,
                       idx: int, total: int) -> Image.Image:
    """Scène produit avec photo détourée, titre, prix, badges."""
    p = max(0.0, min(1.0, progress))
    color = SCENE_BG[idx % len(SCENE_BG)]
    img = _radial_gradient(color[0], color[1]).convert("RGBA")
    draw = ImageDraw.Draw(img)

    # Grain de lumière en haut (halo orange subtil)
    halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    halo_draw = ImageDraw.Draw(halo)
    halo_draw.ellipse([W // 2 - 500, -300, W // 2 + 500, 400],
                      fill=ORANGE + (20,))
    halo = halo.filter(ImageFilter.GaussianBlur(80))
    img.alpha_composite(halo)

    # Barres progression story-style (en haut)
    bar_y = 50
    bar_h = 5
    gap = 10
    bar_w_total = W - 100
    per_bar = (bar_w_total - gap * (total - 1)) // max(1, total)
    for i in range(total):
        x = 50 + i * (per_bar + gap)
        draw.rounded_rectangle([x, bar_y, x + per_bar, bar_y + bar_h],
                               radius=bar_h // 2, fill=(255, 255, 255, 70))
        if i < idx:
            fill_w = per_bar
        elif i == idx:
            fill_w = int(per_bar * p)
        else:
            fill_w = 0
        if fill_w > 0:
            draw.rounded_rectangle([x, bar_y, x + fill_w, bar_y + bar_h],
                                   radius=bar_h // 2, fill=(255, 255, 255, 240))

    # Mini logo + marque + compteur
    logo_small = 52
    _draw_klikphone_logo(img, 50 + logo_small // 2, 100 + logo_small // 2,
                         logo_small, alpha=230)
    brand_font = _font(28, bold=True)
    draw.text((logo_small + 70, 108), "klikphone.fr", font=brand_font,
              fill=(255, 255, 255, 220))
    counter_font = _font(28, bold=True)
    counter = f"{idx + 1} / {total}"
    cw = _text_w(draw, counter, counter_font)
    draw.text((W - 50 - cw, 108), counter, font=counter_font,
              fill=ORANGE_BRIGHT + (240,))

    # ───── PHOTO iPhone détourée ─────
    # Zone photo : hauteur 900, centrée en haut
    photo_zone_top = 180
    photo_zone_h = 900
    # Adapter la taille selon orientation (Apple CDN dos+face = landscape 940×549,
    # PNG portrait ~660×1276) : remplir intelligemment la zone.
    ph = photo.copy()
    if ph.width >= ph.height:
        # Landscape : remplir largeur, limiter hauteur
        scale = min(920 / ph.width, photo_zone_h / ph.height)
    else:
        # Portrait : remplir hauteur, limiter largeur
        scale = min(photo_zone_h / ph.height, 680 / ph.width)
    base_w = max(1, int(ph.width * scale))
    base_h = max(1, int(ph.height * scale))
    ph = ph.resize((base_w, base_h), Image.LANCZOS)

    # Animation : slide up + zoom (entrée)
    enter = _ease_out(min(1.0, p / 0.25))
    exit_anim = 0
    if p > 0.88:
        exit_anim = _ease_in_out((p - 0.88) / 0.12)

    # Scale pulse (respiration douce)
    pulse = 0.97 + 0.03 * _ease_in_out(p)
    new_w = max(1, int(base_w * pulse))
    new_h = max(1, int(base_h * pulse))
    ph_resized = ph.resize((new_w, new_h), Image.LANCZOS)

    ph_x = (W - new_w) // 2
    # Centrer verticalement dans la zone dédiée
    ph_y = photo_zone_top + max(0, (photo_zone_h - new_h) // 2) \
           + int((1 - enter) * 80 - exit_anim * 60)

    # 1. Ambient shadow large (halo sombre qui fond dans le fond)
    _paste_with_shadow(img, ph_resized, (ph_x, ph_y),
                       shadow_color=(0, 0, 0), offset=(0, 20),
                       blur=140, opacity=90)

    # 2. Glow doux coloré (très diffus — atmosphere premium)
    _paste_with_glow(img, ph_resized, (ph_x, ph_y),
                     glow_color=ORANGE_BRIGHT, blur=120, opacity=45)

    # 3. Contact shadow (ancre l'iPhone au sol, plus nette)
    _paste_with_shadow(img, ph_resized, (ph_x, ph_y),
                       shadow_color=(0, 0, 0), offset=(0, 70),
                       blur=50, opacity=150)

    # ───── TEXTES (zone basse) ─────
    text_alpha = int(255 * enter * (1 - exit_anim))

    # Modèle (sans "iPhone" pour impact)
    model_display = phone["model"].replace("iPhone ", "")
    model_font = _font(84, bold=True)
    model_y = 1130
    mw = _text_w(draw, model_display, model_font)
    _draw_text_shadow(draw, ((W - mw) // 2, model_y), model_display, model_font,
                      fill=(255, 255, 255, text_alpha),
                      shadow=(0, 0, 0, text_alpha // 2), offset=(0, 4))

    # Storage + couleur (sous le modèle)
    meta_font = _font(34)
    meta = f"{phone['storage']}  ·  {phone['color_name']}"
    meta_y = model_y + 108
    mw2 = _text_w(draw, meta, meta_font)
    draw.text(((W - mw2) // 2, meta_y), meta, font=meta_font,
              fill=(215, 215, 228, text_alpha))

    # Prix énorme + ancien prix sur la même ligne
    price_font = _font(150, bold=True)
    price = f"{phone['price']}€"
    has_old = bool(phone.get("old_price") and phone["old_price"] > phone["price"])

    price_y = meta_y + 70
    pw = _text_w(draw, price, price_font)

    if has_old:
        old_font = _font(48)
        old_price = f"{phone['old_price']}€"
        opw = _text_w(draw, old_price, old_font)
        gap = 20
        # Largeur totale (prix + gap + ancien prix)
        total_w = pw + gap + opw
        price_x = (W - total_w) // 2
        old_x = price_x + pw + gap
        old_y = price_y + 75  # centré verticalement avec le prix

        # Glow prix
        pg_layer = Image.new("RGBA", (W, 240), (0, 0, 0, 0))
        ImageDraw.Draw(pg_layer).text((price_x, 0), price, font=price_font,
                                       fill=ORANGE_BRIGHT + (int(160 * enter),))
        img.alpha_composite(pg_layer.filter(ImageFilter.GaussianBlur(22)),
                            (0, price_y))

        # Prix blanc net
        draw.text((price_x, price_y), price, font=price_font,
                  fill=(255, 255, 255, text_alpha))

        # Ancien prix gris barré
        draw.text((old_x, old_y), old_price, font=old_font,
                  fill=(180, 180, 195, int(200 * enter)))
        draw.line([(old_x - 4, old_y + 32), (old_x + opw + 4, old_y + 32)],
                  fill=ORANGE_BRIGHT + (int(230 * enter),), width=4)
    else:
        price_x = (W - pw) // 2
        pg_layer = Image.new("RGBA", (W, 240), (0, 0, 0, 0))
        ImageDraw.Draw(pg_layer).text((price_x, 0), price, font=price_font,
                                       fill=ORANGE_BRIGHT + (int(160 * enter),))
        img.alpha_composite(pg_layer.filter(ImageFilter.GaussianBlur(22)),
                            (0, price_y))
        draw.text((price_x, price_y), price, font=price_font,
                  fill=(255, 255, 255, text_alpha))

    # Pill remise (sous le prix)
    if has_old:
        diff = phone["old_price"] - phone["price"]
        pill_text = f"ÉCONOMIE −{diff}€"
        pill_font = _font(30, bold=True)
        pill_tw = _text_w(draw, pill_text, pill_font)
        pill_w = pill_tw + 56
        pill_h = 64
        px = (W - pill_w) // 2
        py = price_y + 190
        # Glow pill
        glow_layer = Image.new("RGBA", (pill_w + 100, pill_h + 100), (0, 0, 0, 0))
        ImageDraw.Draw(glow_layer).rounded_rectangle(
            [50, 50, pill_w + 50, pill_h + 50],
            radius=pill_h // 2, fill=ORANGE + (int(200 * enter),))
        img.alpha_composite(glow_layer.filter(ImageFilter.GaussianBlur(22)),
                            (px - 50, py - 50))
        # Pill
        draw.rounded_rectangle([px, py, px + pill_w, py + pill_h],
                               radius=pill_h // 2,
                               fill=ORANGE + (text_alpha,))
        draw.text((px + (pill_w - pill_tw) // 2, py + 16), pill_text,
                  font=pill_font, fill=(255, 255, 255, text_alpha))

    # Footer : stock + garantie
    footer_font = _font(26, bold=True)
    stock = phone.get('stock', 0)
    stock_part = f"{stock} DISPONIBLE" + ("S" if stock > 1 else "")
    footer_txt = f"{stock_part}   ·   GARANTIE 12 MOIS"
    fw = _text_w(draw, footer_txt, footer_font)
    draw.text(((W - fw) // 2, H - 90), footer_txt, font=footer_font,
              fill=(220, 220, 235, int(200 * enter)))

    return img


# ───────────────────────────────────────────────────────────
# OUTRO (2.2s)
# ───────────────────────────────────────────────────────────
def render_outro_frame(progress: float) -> Image.Image:
    """Outro : branding Klikphone avec logo grand + contact."""
    p = _ease_out(max(0.0, min(1.0, progress)))
    img = _radial_gradient((60, 25, 8), DARK_BG).convert("RGBA")
    draw = ImageDraw.Draw(img)

    # Halo orange derrière le logo
    halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    hdraw = ImageDraw.Draw(halo)
    hr = int(400 * p)
    hdraw.ellipse([W // 2 - hr, int(H * 0.30) - hr,
                   W // 2 + hr, int(H * 0.30) + hr],
                  fill=ORANGE + (int(90 * p),))
    halo = halo.filter(ImageFilter.GaussianBlur(60))
    img.alpha_composite(halo)

    # Logo Klikphone grand
    logo_size = int(320 * (0.5 + 0.5 * p))
    logo_y = int(H * 0.30)
    _draw_klikphone_logo(img, W // 2, logo_y, logo_size, alpha=int(255 * p))

    # KLIKPHONE wordmark
    title_font = _font(96, bold=True)
    title = "KLIKPHONE"
    tw = _text_w(draw, title, title_font)
    ty = int(H * 0.50)
    title_alpha = int(255 * p)
    _draw_text_shadow(draw, ((W - tw) // 2, ty), title, title_font,
                      fill=(255, 255, 255, title_alpha),
                      shadow=(0, 0, 0, title_alpha // 2), offset=(0, 4))

    # Sous-titre
    sub_font = _font(38)
    sub = "Spécialiste Apple · Chambéry"
    sw = _text_w(draw, sub, sub_font)
    draw.text(((W - sw) // 2, int(H * 0.585)), sub, font=sub_font,
              fill=(220, 220, 235, int(240 * p)))

    # Séparateur orange
    sep_w = int(220 * p)
    sep_y = int(H * 0.64)
    draw.rounded_rectangle([W // 2 - sep_w // 2, sep_y,
                            W // 2 + sep_w // 2, sep_y + 5],
                           radius=3, fill=ORANGE_BRIGHT + (int(255 * p),))

    # Adresse
    addr_font = _font(32)
    addr = "79 Place Saint-Léger, 73000 Chambéry"
    aw = _text_w(draw, addr, addr_font)
    draw.text(((W - aw) // 2, int(H * 0.68)), addr, font=addr_font,
              fill=(235, 235, 245, int(240 * p)))

    # Téléphone
    tel_font = _font(56, bold=True)
    tel = "06 95 71 51 96"
    tw2 = _text_w(draw, tel, tel_font)
    _draw_text_shadow(draw, ((W - tw2) // 2, int(H * 0.74)), tel, tel_font,
                      fill=ORANGE_BRIGHT + (int(255 * p),),
                      shadow=(0, 0, 0, int(120 * p)), offset=(0, 3))

    # Bouton KLIKPHONE.FR
    btn_font = _font(42, bold=True)
    btn_text = "KLIKPHONE.FR"
    btn_tw = _text_w(draw, btn_text, btn_font)
    btn_w = btn_tw + 100
    btn_h = 96
    btn_x = (W - btn_w) // 2
    btn_y = int(H * 0.83)
    # Glow bouton
    btn_glow = Image.new("RGBA", (btn_w + 100, btn_h + 100), (0, 0, 0, 0))
    bgdraw = ImageDraw.Draw(btn_glow)
    bgdraw.rounded_rectangle([50, 50, btn_w + 50, btn_h + 50],
                             radius=btn_h // 2,
                             fill=ORANGE + (int(180 * p),))
    btn_glow = btn_glow.filter(ImageFilter.GaussianBlur(22))
    img.alpha_composite(btn_glow, (btn_x - 50, btn_y - 50))
    # Bouton plein
    draw.rounded_rectangle([btn_x, btn_y, btn_x + btn_w, btn_y + btn_h],
                           radius=btn_h // 2,
                           fill=ORANGE + (int(255 * p),))
    draw.text((btn_x + (btn_w - btn_tw) // 2, btn_y + 26), btn_text,
              font=btn_font, fill=(255, 255, 255, int(255 * p)))

    return img
