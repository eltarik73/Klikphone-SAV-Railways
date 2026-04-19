"""
Générateur de vidéo Story 9:16 MP4 à partir d'une liste d'iPhones.

Pipeline :
1. Rend chaque frame PNG avec Pillow via story_template
2. Assemble via ffmpeg en MP4 (H.264, yuv420p, faststart)
3. Upload vers Supabase Storage si les env vars sont présentes,
   sinon sauvegarde localement dans backend/app/video/generated/
   et retourne une URL publique via /generated-videos/<filename>
"""

import os
import logging
import subprocess
import tempfile
import time
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

GENERATED_DIR = Path(__file__).parent / "generated"
GENERATED_DIR.mkdir(parents=True, exist_ok=True)

ASSETS_DIR = Path(__file__).parent.parent / "assets" / "iphone_tarifs"


def _image_filename_for(phone: dict) -> Optional[Path]:
    """Mappe un iPhone vers son fichier image local."""
    model_key = phone.get("model_key", "")
    # Convention existante : iphone_XX_pro_max.jpeg
    stem = model_key.replace("-", "_")
    for ext in (".jpeg", ".jpg", ".png"):
        p = ASSETS_DIR / f"{stem}{ext}"
        if p.exists():
            return p
    return None


def _load_photo(phone: dict) -> Image.Image:
    """Charge la photo iPhone. Si image_url est un chemin local ou une URL, la télécharge.
    Sinon utilise le fichier local du mapping."""
    # 1. Override image_url (URL distante)
    url = phone.get("image_url")
    if url and url.startswith("http"):
        try:
            r = httpx.get(url, timeout=10.0, follow_redirects=True)
            r.raise_for_status()
            from io import BytesIO
            return Image.open(BytesIO(r.content)).convert("RGBA")
        except Exception as e:
            logger.warning("Fallback sur image locale (%s) : %s", phone.get("model"), e)

    # 2. Mapping local par model_key
    local = _image_filename_for(phone)
    if local and local.exists():
        return Image.open(local).convert("RGBA")

    # 3. Placeholder (rectangle coloré)
    logger.warning("Aucune image trouvée pour %s (%s)", phone.get("model"),
                   phone.get("model_key"))
    placeholder = Image.new("RGBA", (400, 800), (60, 60, 70, 255))
    return placeholder


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

        frame_idx = 0

        # INTRO
        for i in range(intro_frames):
            progress = i / max(1, intro_frames - 1)
            img = render_intro_frame(progress)
            img.convert("RGB").save(frames_dir / f"frame_{frame_idx:05d}.png",
                                    optimize=False, compress_level=1)
            frame_idx += 1

        # SCÈNES
        for idx, (phone, photo) in enumerate(zip(phones, photos)):
            for i in range(scene_frames):
                progress = i / max(1, scene_frames - 1)
                img = render_phone_frame(phone, photo, progress, idx, total_phones)
                img.convert("RGB").save(frames_dir / f"frame_{frame_idx:05d}.png",
                                        optimize=False, compress_level=1)
                frame_idx += 1

        # OUTRO
        for i in range(outro_frames):
            progress = i / max(1, outro_frames - 1)
            img = render_outro_frame(progress)
            img.convert("RGB").save(frames_dir / f"frame_{frame_idx:05d}.png",
                                    optimize=False, compress_level=1)
            frame_idx += 1

        elapsed_render = time.time() - start
        logger.info("Frames rendus en %.1fs", elapsed_render)

        # Assemble via ffmpeg
        filename = f"story-{int(time.time())}.mp4"
        output_path = Path(tmpdir) / filename

        # Musique optionnelle
        music_path = Path(__file__).parent / "assets" / "story_music.mp3"
        cmd = [
            "ffmpeg", "-y",
            "-framerate", str(FPS),
            "-i", str(frames_dir / "frame_%05d.png"),
        ]
        if music_path.exists():
            cmd += ["-i", str(music_path)]
        cmd += [
            "-c:v", "libx264",
            "-preset", "veryfast",
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
