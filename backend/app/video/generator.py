"""
Générateur de vidéo Story 9:16 MP4 à partir d'une liste d'iPhones.

Pipeline :
1. Rend chaque frame PNG avec Pillow via story_template
2. Assemble via ffmpeg en MP4 (H.264, yuv420p, faststart)
3. Upload vers Supabase Storage si les env vars sont présentes,
   sinon sauvegarde localement dans backend/app/video/generated/
   et retourne une URL publique via /generated-videos/<filename>

Photos iPhone :
- Priorité 1 : image_url de la BDD (Apple CDN ou URL admin)
- Priorité 2 : PNG local dans backend/app/video/assets/iphones/<model_key>_<color>.png
- Priorité 3 : PNG local dans backend/app/video/assets/iphones/<model_key>.png
- Fallback  : silhouette iPhone en SVG (pas de JPEG foireux)

Le dossier backend/app/video/cache/ sert de cache disque TTL 7j pour les URLs
téléchargées — évite de rebougeoir le CDN Apple à chaque génération.
"""

import hashlib
import logging
import os
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

import httpx
from PIL import Image

from .story_template import (
    render_intro_frame, render_phone_frame, render_outro_frame,
    W, H,
)


logger = logging.getLogger(__name__)

FPS = 20
INTRO_DURATION_S = 1.8
SCENE_DURATION_S = 3.0
OUTRO_DURATION_S = 2.2

VIDEO_DIR = Path(__file__).parent
GENERATED_DIR = VIDEO_DIR / "generated"
GENERATED_DIR.mkdir(parents=True, exist_ok=True)

CACHE_DIR = VIDEO_DIR / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
# Sous-dossier pour les photos déjà processed (remove_bg + trim + feather)
PROCESSED_CACHE_DIR = CACHE_DIR / "processed"
PROCESSED_CACHE_DIR.mkdir(parents=True, exist_ok=True)
CACHE_TTL_SECONDS = 7 * 24 * 3600  # 7 jours

LOCAL_IPHONES_DIR = VIDEO_DIR / "assets" / "iphones"


def _slug(s: str) -> str:
    """Normalise pour nom de fichier : lowercase, underscore, ASCII-only."""
    import unicodedata
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return "".join(c if c.isalnum() else "_" for c in s.lower()).strip("_")


def _local_image_for(phone: dict) -> Optional[Path]:
    """Cherche une image locale détourée pour cet iPhone.
    Ordre :
    1. <model_key>_<color_slug>.png (exact match avec couleur)
    2. <model_key>.png (fallback sans couleur)
    3. premier fichier commencant par <model_key>_ (n'importe quelle couleur
       dispo — utile pour iphone_tarifs qui n'a pas de couleur)"""
    model_key = (phone.get("model_key") or "").replace("-", "_")
    if not model_key:
        return None
    color_key = phone.get("color_key") or phone.get("color_name") or ""
    color_slug = _slug(color_key)

    # 1. Match exact avec couleur
    if color_slug:
        p = LOCAL_IPHONES_DIR / f"{model_key}_{color_slug}.png"
        if p.exists():
            return p
    # 2. Fichier sans suffixe couleur
    p = LOCAL_IPHONES_DIR / f"{model_key}.png"
    if p.exists():
        return p
    # 3. Premiere image matchant le prefix model_key (ex: iphone_16_pro_max_*)
    if LOCAL_IPHONES_DIR.exists():
        matches = sorted(LOCAL_IPHONES_DIR.glob(f"{model_key}_*.png"))
        if matches:
            return matches[0]
    return None


def _cache_path_for(url: str) -> Path:
    h = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
    return CACHE_DIR / f"{h}.png"


def _download_cached(url: str) -> Optional[bytes]:
    """Télécharge une URL avec cache disque TTL 7j. None si échec."""
    cache = _cache_path_for(url)
    if cache.exists():
        age = time.time() - cache.stat().st_mtime
        if age < CACHE_TTL_SECONDS:
            return cache.read_bytes()
    try:
        # User-Agent nécessaire pour certains CDN (pngimg, cloudflare)
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                          "AppleWebKit/537.36 Chrome/120 Safari/537.36",
        }
        r = httpx.get(url, timeout=15.0, follow_redirects=True, headers=headers)
        r.raise_for_status()
        data = r.content
        # Sanity: refuse les réponses trop petites (pages d'erreur, redirects HTML)
        if len(data) < 5000:
            logger.warning("Image trop petite (%d bytes) pour %s — skip", len(data), url)
            return None
        cache.write_bytes(data)
        return data
    except Exception as e:
        logger.warning("Download failed for %s : %s", url, e)
        return None


def _remove_white_bg(img: Image.Image, feather_px: float = 1.0) -> Image.Image:
    """Détourage robuste : flood-fill + fill-holes + seuil blanc final.

    Problème : le flood-fill 2e passe (tolérance large) peut s'infiltrer
    dans les zones d'ombre interne de l'iPhone (reflets sombres titane,
    ombres de caméra) → crée des semi-transparences qui apparaissent
    comme "taches noires" sur fond sombre dans la vidéo.

    Pipeline :
    1. Flood-fill depuis les 4 coins (tolérance 50, équilibrée) →
       attrape le fond blanc + ombre proche sans pénétrer l'iPhone.
    2. Fill-holes : re-flood depuis les coins sur le MASQUE binaire pour
       identifier uniquement le vrai "fond connecté aux bords". Les
       trous internes de l'iPhone (zones noires non-connectées aux bords)
       sont restaurés à opaque.
    3. Seuil blanc pur (>= 240) sur pixels restants pour capturer ceux
       qui ont échappé aux deux passes.
    4. Feather 1px pour bords doux."""
    from PIL import ImageChops, ImageDraw, ImageFilter
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    w, h = img.size
    work = img.convert("RGB")
    MARKER = (254, 0, 254)  # magenta = fond supprimé
    corners = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]

    # Passe unique, tolérance équilibrée : attrape blanc + ombre proche
    # mais s'arrête au phone (évite de manger les reflets titane)
    for c in corners:
        try:
            ImageDraw.floodfill(work, c, MARKER, thresh=50)
        except Exception:
            pass

    # Masque binaire initial : MARKER = 0 (fond), autre = 255 (iPhone candidate)
    pixels = work.getdata()
    mask_data = bytes(0 if p == MARKER else 255 for p in pixels)
    mask = Image.frombytes("L", (w, h), mask_data)

    # Fill-holes : re-flood depuis les coins sur le masque binaire pour
    # distinguer "vrai fond (connecté aux bords)" vs "trou interne iPhone"
    fm = mask.convert("RGB")  # pixel (0,0,0)=fond, (255,255,255)=phone
    HOLE_MARKER = (100, 200, 100)  # vert = fond certifié (connecté bord)
    for c in corners:
        if fm.getpixel(c) == (0, 0, 0):
            try:
                ImageDraw.floodfill(fm, c, HOLE_MARKER, thresh=5)
            except Exception:
                pass
    # Après : vert=vrai fond, noir=trou interne iPhone (à restaurer),
    # blanc=iPhone. final_mask : 0 seulement pour vert, 255 sinon.
    fm_pixels = fm.getdata()
    final_mask_data = bytes(0 if p == HOLE_MARKER else 255 for p in fm_pixels)
    final_mask = Image.frombytes("L", (w, h), final_mask_data)

    # Combine avec alpha original
    orig_alpha = img.split()[-1]
    new_alpha = ImageChops.multiply(orig_alpha, final_mask)

    # Seuil blanc pur pour pixels echapés
    r, g, b, _ = img.split()
    rgb_min = ImageChops.darker(ImageChops.darker(r, g), b)
    not_white = rgb_min.point(lambda x: 255 if x < 240 else 0)
    new_alpha = ImageChops.multiply(new_alpha, not_white)

    # Seuillage net sur l'alpha : <128 = totalement transparent, >=128 = opaque
    # → élimine les pixels semi-transparents résiduels qui créent un halo
    new_alpha = new_alpha.point(lambda a: 0 if a < 128 else 255)

    if feather_px > 0:
        new_alpha = new_alpha.filter(ImageFilter.GaussianBlur(feather_px))

    img.putalpha(new_alpha)
    return img


def _trim_alpha(img: Image.Image, padding: int = 10) -> Image.Image:
    """Auto-crop sur la bbox des pixels opaques (alpha > 10).
    Garantit un détourage propre peu importe la source (Apple CDN, pngimg, etc.)."""
    if img.mode != "RGBA":
        return img
    alpha = img.split()[-1]
    bbox = alpha.getbbox()  # calcule déjà sur pixels non-nuls
    if not bbox:
        return img
    x1, y1, x2, y2 = bbox
    x1 = max(0, x1 - padding)
    y1 = max(0, y1 - padding)
    x2 = min(img.width, x2 + padding)
    y2 = min(img.height, y2 + padding)
    return img.crop((x1, y1, x2, y2))




def _placeholder_silhouette() -> Image.Image:
    """Génère une silhouette iPhone élégante en PNG transparent (pas de JPEG moche)."""
    from PIL import ImageDraw
    w, h = 600, 1200
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # Corps avec coins arrondis
    draw.rounded_rectangle([20, 20, w - 20, h - 20], radius=80,
                           fill=(35, 35, 42, 255),
                           outline=(90, 90, 100, 255), width=3)
    # Encoche Dynamic Island
    draw.rounded_rectangle([w // 2 - 80, 60, w // 2 + 80, 110],
                           radius=25, fill=(10, 10, 14, 255))
    # Écran intérieur (pour effet de profondeur)
    draw.rounded_rectangle([40, 140, w - 40, h - 40], radius=60,
                           fill=(20, 20, 28, 255))
    return img


def _processed_cache_key(source_bytes: bytes) -> Path:
    """Clé sha256 des bytes source (url-data ou file content) pour le cache processed."""
    h = hashlib.sha256(source_bytes).hexdigest()[:24]
    return PROCESSED_CACHE_DIR / f"{h}.png"


def _load_and_process(source_bytes: bytes, label: str) -> Optional[Image.Image]:
    """Lit l'image source depuis bytes, la processe (remove_bg + trim) et cache le résultat.
    Le feather gaussien + flood fills coûtent ~150-300ms — on les saute si déjà en cache."""
    from io import BytesIO
    cache_path = _processed_cache_key(source_bytes)
    if cache_path.exists():
        try:
            return Image.open(cache_path).convert("RGBA")
        except Exception as e:
            logger.warning("Cache processed corrompu %s (%s) — reprocess", cache_path, e)
    try:
        img = Image.open(BytesIO(source_bytes)).convert("RGBA")
        processed = _trim_alpha(_remove_white_bg(img))
        try:
            processed.save(cache_path, "PNG", optimize=False, compress_level=1)
        except Exception as e:
            logger.debug("Save processed cache failed (%s) : %s", cache_path, e)
        return processed
    except Exception as e:
        logger.warning("Pillow failed to process %s : %s", label, e)
        return None


def _load_photo(phone: dict) -> Image.Image:
    """Charge la photo iPhone détourée.
    Ordre : URL distante (avec cache) → local detoured → placeholder silhouette.
    NE TOMBE JAMAIS sur les anciens JPEG studio du dossier iphone_tarifs.
    Les photos processées (remove_bg + trim + feather) sont mises en cache disque
    avec hash sha256 des bytes source — évite les ~200ms/photo au 2e appel."""
    # 1. image_url (Apple CDN ou upload admin)
    url = phone.get("image_url")
    if url and url.startswith("http"):
        data = _download_cached(url)
        if data:
            out = _load_and_process(data, url)
            if out is not None:
                return out

    # 2. PNG local détouré (model_key + color)
    local = _local_image_for(phone)
    if local:
        try:
            data = local.read_bytes()
            out = _load_and_process(data, str(local))
            if out is not None:
                return out
        except Exception as e:
            logger.warning("Read local %s failed : %s", local, e)

    # 3. Silhouette propre (pas de JPEG foireux)
    logger.info("Fallback silhouette pour %s %s", phone.get("model"), phone.get("color_name"))
    return _placeholder_silhouette()


def _upload_supabase(mp4_path: Path, filename: str) -> Optional[str]:
    """Upload vers Supabase Storage si env vars présentes.
    Retourne l'URL publique ou None."""
    supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    service_key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    bucket = os.getenv("SUPABASE_VIDEO_BUCKET", "videos-stories")

    if not supabase_url or not service_key:
        logger.info("SUPABASE_URL/SERVICE_KEY absents — skip upload Supabase")
        return None

    try:
        upload_url = f"{supabase_url}/storage/v1/object/{bucket}/{filename}"
        with open(mp4_path, "rb") as f:
            data = f.read()

        headers = {
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "video/mp4",
            "x-upsert": "true",
        }
        r = httpx.post(upload_url, content=data, headers=headers, timeout=60.0)
        if r.status_code not in (200, 201):
            logger.error("Supabase upload %s : %s", r.status_code, r.text)
            return None

        public_url = f"{supabase_url}/storage/v1/object/public/{bucket}/{filename}"
        logger.info("Upload Supabase OK : %s", public_url)
        return public_url
    except Exception as e:
        logger.exception("Erreur upload Supabase : %s", e)
        return None


def generate_story_video(phones: list) -> dict:
    """
    Génère la vidéo et retourne un dict avec :
    - video_url
    - duration_seconds
    - filename
    """
    if not phones:
        raise ValueError("Aucun iPhone fourni")

    start = time.time()
    total_phones = len(phones)

    intro_frames = int(INTRO_DURATION_S * FPS)
    scene_frames = int(SCENE_DURATION_S * FPS)
    outro_frames = int(OUTRO_DURATION_S * FPS)
    total_frames = intro_frames + scene_frames * total_phones + outro_frames
    duration_s = total_frames / FPS

    logger.info("Génération vidéo : %d iPhones, %d frames, %.1fs",
                total_phones, total_frames, duration_s)

    with tempfile.TemporaryDirectory() as tmpdir:
        frames_dir = Path(tmpdir) / "frames"
        frames_dir.mkdir()

        # Précharger toutes les photos
        photos = [_load_photo(p) for p in phones]

        # Helpers de rendu atomique (progress + index → PNG sur disque)
        def _render_intro(i: int, fidx: int):
            prog = i / max(1, intro_frames - 1)
            render_intro_frame(prog).convert("RGB").save(
                frames_dir / f"frame_{fidx:05d}.png",
                optimize=False, compress_level=1)

        def _render_outro(i: int, fidx: int):
            prog = i / max(1, outro_frames - 1)
            render_outro_frame(prog).convert("RGB").save(
                frames_dir / f"frame_{fidx:05d}.png",
                optimize=False, compress_level=1)

        frame_idx = 0
        intro_start = frame_idx
        frame_idx += intro_frames
        scenes_start = frame_idx
        frame_idx += scene_frames * total_phones
        outro_start = frame_idx
        frame_idx += outro_frames

        # INTRO + OUTRO en parallèle (indépendants, juste fonction de progress)
        # 2 workers : Pillow libère le GIL sur les ops natives → vrai parallélisme
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = []
            for i in range(intro_frames):
                futures.append(pool.submit(_render_intro, i, intro_start + i))
            for i in range(outro_frames):
                futures.append(pool.submit(_render_outro, i, outro_start + i))
            # Attendre la complétion (propage exceptions)
            for f in futures:
                f.result()

        # SCÈNES (séquentiel : dépendent des photos préchargées)
        fidx = scenes_start
        for idx, (phone, photo) in enumerate(zip(phones, photos)):
            for i in range(scene_frames):
                progress = i / max(1, scene_frames - 1)
                img = render_phone_frame(phone, photo, progress, idx, total_phones)
                img.convert("RGB").save(frames_dir / f"frame_{fidx:05d}.png",
                                        optimize=False, compress_level=1)
                fidx += 1

        elapsed_render = time.time() - start
        logger.info("Frames rendus en %.1fs", elapsed_render)

        # Assemble via ffmpeg
        filename = f"story-{int(time.time())}.mp4"
        output_path = Path(tmpdir) / filename

        # Musique optionnelle
        music_path = VIDEO_DIR / "assets" / "story_music.mp3"
        cmd = [
            "ffmpeg", "-y",
            "-threads", "4",
            "-framerate", str(FPS),
            "-i", str(frames_dir / "frame_%05d.png"),
        ]
        if music_path.exists():
            cmd += ["-i", str(music_path)]
        cmd += [
            "-c:v", "libx264",
            "-preset", "faster",  # veryfast→faster : -20% temps, diff qualité négligeable à CRF 22
            "-threads", "4",
            "-crf", "22",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
        ]
        if music_path.exists():
            cmd += ["-c:a", "aac", "-b:a", "128k", "-shortest"]
        cmd += [str(output_path)]

        try:
            proc = subprocess.run(cmd, check=True, capture_output=True, timeout=120)
        except FileNotFoundError:
            raise FileNotFoundError("ffmpeg introuvable dans le PATH")
        except subprocess.CalledProcessError as e:
            logger.error("ffmpeg stderr : %s", e.stderr.decode("utf-8", errors="replace"))
            raise RuntimeError(f"ffmpeg a échoué : {e.stderr.decode('utf-8', errors='replace')[-500:]}")

        # Upload Supabase ou sauvegarde locale servie en HTTP
        public_url = _upload_supabase(output_path, filename)
        if not public_url:
            final_path = GENERATED_DIR / filename
            final_path.write_bytes(output_path.read_bytes())
            frontend_url = os.getenv("FRONTEND_URL", "").rstrip("/")
            if frontend_url:
                public_url = f"{frontend_url}/generated-videos/{filename}"
            else:
                public_url = f"/generated-videos/{filename}"

        elapsed_total = time.time() - start
        logger.info("Vidéo prête en %.1fs : %s", elapsed_total, public_url)

        return {
            "video_url": public_url,
            "duration_seconds": round(duration_s, 2),
            "filename": filename,
            "render_time_s": round(elapsed_total, 1),
        }
