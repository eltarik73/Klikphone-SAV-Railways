"""
Publication sur les réseaux sociaux via Late (rebaptisé Zernio) — Community Manager.

- Un seul client HTTP (`requete`) : base `LATE_API_BASE` si posée, sinon getlate.dev puis
  zernio.com (même service, même clé : le domaine historique peut disparaître un jour).
- `corps_publication` construit le POST /v1/posts d'un post de l'app : uniquement les comptes
  de SA plateforme (jamais de repli silencieux vers un autre réseau), photo obligatoire pour
  Instagram, publication immédiate ou programmée chez Late (`scheduledFor`, heure de Paris).
- `lire_publication` lit la réponse (201 / 200 / 207 partiel ou échoué) : identifiant du post
  Late (`post._id`), réseaux publiés, erreurs par réseau.
- `preparer_image` : photo ou image IA → JPEG compatible Instagram (rapport 4:5 à 1,91:1,
  1440 px de large au plus, orientation EXIF appliquée).
"""

import io
import os
from datetime import datetime
from typing import Optional

import httpx

BASES_DEFAUT = ("https://getlate.dev/api/v1", "https://zernio.com/api/v1")
FUSEAU = "Europe/Paris"
TABLEAU_DE_BORD = "https://zernio.com/dashboard"

# Plateforme de l'app → noms possibles chez Late
PLATEFORMES = {
    "instagram": ("instagram",),
    "facebook": ("facebook",),
    "linkedin": ("linkedin",),
    "google": ("googlebusiness", "google-business", "google_business"),
    "twitter": ("twitter",),
    "tiktok": ("tiktok",),
}
LIBELLES = {
    "instagram": "Instagram", "facebook": "Facebook", "linkedin": "LinkedIn",
    "google": "Google Business", "twitter": "X (Twitter)", "tiktok": "TikTok",
}
# Plateforme Late → plateforme de l'app
DEPUIS_LATE = {nom: interne for interne, noms in PLATEFORMES.items() for nom in noms}

LEGENDE_MAX_INSTAGRAM = 2200
HASHTAGS_MAX_INSTAGRAM = 30

# Instagram : rapport largeur / hauteur accepté pour une photo du fil
RAPPORT_MIN = 4 / 5
RAPPORT_MAX = 1.91
LARGEUR_MAX = 1440
TAILLE_MAX_ENTREE = 15 * 1024 * 1024

# Transport httpx injecté par les tests (httpx.MockTransport) ; None = réseau
_transport = None


class LateErreur(Exception):
    """Erreur lisible par le gérant, avec le statut HTTP à renvoyer par l'API."""

    def __init__(self, message: str, status: int = 502, code: Optional[str] = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


def libelle(plateforme: str) -> str:
    return LIBELLES.get(plateforme, (plateforme or "").capitalize())


def bases() -> tuple:
    env = (os.getenv("LATE_API_BASE") or "").strip().rstrip("/")
    return (env,) if env else BASES_DEFAUT


def cle() -> str:
    valeur = (os.getenv("LATE_API_KEY") or os.getenv("ZERNIO_API_KEY") or "").strip()
    if not valeur:
        raise LateErreur(
            "Clé Late absente : ajoutez LATE_API_KEY dans les variables Railway "
            "(Zernio → Settings → API Keys).", 400, "cle_absente")
    return valeur


async def requete(methode: str, chemin: str, *, json=None, params=None, timeout: float = 30):
    """Appel à l'API Late. Domaine suivant sur erreur réseau, redirection ou 404 (domaine
    déplacé) ; un délai dépassé n'est jamais rejoué (une publication a pu partir)."""
    entetes = {"Authorization": f"Bearer {cle()}"}
    liste = bases()
    derniere_erreur = None
    for i, base in enumerate(liste):
        dernier = i == len(liste) - 1
        try:
            async with httpx.AsyncClient(timeout=timeout, transport=_transport) as client:
                resp = await client.request(methode, base + chemin, json=json, params=params,
                                            headers=entetes)
        except httpx.TimeoutException:
            raise LateErreur(
                "Late ne répond pas (délai dépassé). Vérifiez dans Zernio si le post est parti "
                "avant de republier.", 504, "delai")
        except httpx.HTTPError as e:
            derniere_erreur = e
            continue
        if not dernier and (resp.status_code in (301, 302, 307, 308, 404, 410)):
            continue
        return resp
    raise LateErreur(f"Late injoignable : {derniere_erreur}", 502, "injoignable")


def _json(resp) -> dict:
    try:
        data = resp.json()
        return data if isinstance(data, dict) else {"data": data}
    except ValueError:
        return {}


def erreur_reponse(resp, plateforme: str = "") -> LateErreur:
    """Traduit une réponse d'erreur de Late en message pour le gérant."""
    data = _json(resp)
    code = str(data.get("code") or "")
    detail = data.get("error") or data.get("message") or (resp.text or "")[:300]
    if isinstance(detail, dict):
        detail = detail.get("message") or str(detail)
    nom = libelle(plateforme) if plateforme else "Le compte"
    s = resp.status_code
    if s == 401:
        return LateErreur("La clé Late est refusée : vérifiez LATE_API_KEY dans Railway.", 502, "cle_refusee")
    if code == "ACCOUNT_DISCONNECTED":
        return LateErreur(f"{nom} est déconnecté de Late : cliquez « Reconnecter » dans "
                          "« Comptes connectés », puis republiez.", 409, code)
    if code == "ACCOUNT_NOT_ENABLED_FOR_POSTING":
        return LateErreur(f"{nom} n'est pas autorisé à publier chez Late (compte en lecture "
                          "seule) : reconnectez-le.", 409, code)
    if code == "PROFILE_OVER_LIMIT":
        return LateErreur("Limite de l'abonnement Late atteinte (profils / comptes).", 409, code)
    if s == 409:
        return LateErreur("Ce texte a déjà été publié sur ce compte : Late refuse les doublons. "
                          "Modifiez le texte pour republier.", 409, code or "doublon")
    if s == 429:
        return LateErreur("Trop de publications d'un coup : réessayez dans quelques minutes.", 429, "limite")
    if s == 400:
        return LateErreur(f"Late refuse le post : {detail}", 400, code or "refus")
    return LateErreur(f"Late a répondu {s} : {detail}", 502, code or None)


def normaliser_compte(a: dict) -> dict:
    profil = a.get("profileId")
    if isinstance(profil, dict):
        profil = profil.get("_id") or profil.get("id")
    plateforme_late = a.get("platform") or ""
    return {
        "id": a.get("_id") or a.get("id"),
        "platform": plateforme_late,
        "plateforme": DEPUIS_LATE.get(plateforme_late, plateforme_late),
        "username": a.get("username"),
        "displayName": a.get("displayName"),
        "isActive": bool(a.get("isActive", True)),
        "profilePicture": a.get("profilePicture"),
        "profileId": profil,
    }


async def comptes() -> list:
    resp = await requete("GET", "/accounts", timeout=15)
    if resp.status_code != 200:
        raise erreur_reponse(resp)
    return [normaliser_compte(a) for a in (_json(resp).get("accounts") or []) if isinstance(a, dict)]


async def profil_id(liste_comptes: Optional[list] = None) -> str:
    """Profil Late où rattacher un nouveau compte : celui des comptes déjà connectés, sinon le premier."""
    for c in liste_comptes or []:
        if c.get("profileId"):
            return c["profileId"]
    resp = await requete("GET", "/profiles", timeout=15)
    if resp.status_code != 200:
        raise erreur_reponse(resp)
    data = _json(resp)
    profils = data.get("profiles") or data.get("data") or []
    for p in profils:
        if isinstance(p, dict) and (p.get("_id") or p.get("id")):
            return p.get("_id") or p.get("id")
    raise LateErreur("Aucun profil Late : créez-en un dans Zernio avant de connecter un compte.", 400, "sans_profil")


async def lien_connexion(plateforme: str, retour: str, liste_comptes: Optional[list] = None) -> str:
    """Adresse d'autorisation (OAuth) pour connecter ou reconnecter un réseau."""
    noms = PLATEFORMES.get(plateforme)
    if not noms:
        raise LateErreur(f"Réseau inconnu : {plateforme}", 400, "plateforme")
    params = {"profileId": await profil_id(liste_comptes), "redirect_url": retour}
    resp = await requete("GET", f"/connect/{noms[0]}", params=params, timeout=15)
    if resp.status_code != 200:
        raise erreur_reponse(resp, plateforme)
    data = _json(resp)
    url = data.get("authUrl") or data.get("url") or data.get("auth_url")
    if not url:
        raise LateErreur("Late n'a pas renvoyé d'adresse de connexion.", 502, "sans_lien")
    return url


def texte_complet(contenu: str, hashtags, plateforme: str) -> str:
    texte = (contenu or "").strip()
    tags = []
    for t in hashtags or []:
        t = (t or "").strip()
        if not t:
            continue
        t = t if t.startswith("#") else f"#{t}"
        if t.lower() not in {x.lower() for x in tags}:
            tags.append(t)
    if plateforme == "instagram":
        tags = tags[:HASHTAGS_MAX_INSTAGRAM]
    # Hashtags déjà présents dans le texte : pas de doublon en fin de post
    tags = [t for t in tags if t.lower() not in texte.lower()]
    if tags:
        texte += "\n\n" + " ".join(tags)
    return texte


def corps_publication(post: dict, liste_comptes: list, *, programme_le: Optional[datetime] = None):
    """Corps du POST /v1/posts et comptes visés. Lève LateErreur (400) si le post ne peut pas partir."""
    plateforme = (post.get("plateforme") or "").strip().lower()
    nom = libelle(plateforme)
    noms_late = PLATEFORMES.get(plateforme)
    if not noms_late:
        raise LateErreur(f"Réseau « {plateforme} » non pris en charge par la publication.", 400, "plateforme")

    cibles = [c for c in liste_comptes if c.get("platform") in noms_late and c.get("isActive") and c.get("id")]
    if not cibles:
        connectes = ", ".join(
            f"{libelle(c['plateforme'])} (@{c.get('username') or c.get('displayName') or '?'})"
            for c in liste_comptes if c.get("isActive")) or "aucun"
        raise LateErreur(
            f"Aucun compte {nom} connecté à Late (comptes connectés : {connectes}). "
            f"Connectez {nom} depuis « Comptes connectés » ou changez la plateforme du post.",
            400, "compte_absent")

    image_url = (post.get("image_url") or "").strip()
    if plateforme == "instagram" and not image_url:
        raise LateErreur("Instagram exige une photo : ajoutez une photo au post avant de publier.",
                         400, "image_requise")

    texte = texte_complet(post.get("contenu"), post.get("hashtags"), plateforme)
    if plateforme == "instagram" and len(texte) > LEGENDE_MAX_INSTAGRAM:
        raise LateErreur(f"Texte trop long pour Instagram ({len(texte)} caractères, "
                         f"{LEGENDE_MAX_INSTAGRAM} au plus) : raccourcissez-le.", 400, "trop_long")

    corps = {
        "content": texte,
        "platforms": [{"platform": c["platform"], "accountId": c["id"]} for c in cibles],
    }
    if post.get("titre"):
        corps["title"] = str(post["titre"])[:200]
    if image_url:
        corps["mediaItems"] = [{"type": "image", "url": image_url}]
    if programme_le is not None:
        # Heure sans fuseau = heure de Paris (celle saisie au comptoir) ; avec fuseau : telle quelle
        corps["scheduledFor"] = programme_le.isoformat(timespec="seconds")
        if programme_le.tzinfo is None:
            corps["timezone"] = FUSEAU
    else:
        corps["publishNow"] = True
    return corps, cibles


def _erreurs_plateformes(data: dict, post: dict) -> list:
    erreurs = []
    for r in data.get("platformResults") or []:
        if isinstance(r, dict) and (r.get("status") == "failed" or r.get("error")):
            erreurs.append({"platform": r.get("platform"), "error": r.get("error") or "échec"})
    for p in post.get("platforms") or []:
        if isinstance(p, dict) and p.get("status") == "failed":
            msg = p.get("errorMessage") or p.get("error") or "échec"
            if not any(e["platform"] == p.get("platform") for e in erreurs):
                erreurs.append({"platform": p.get("platform"), "error": msg})
    return erreurs


def lire_publication(resp, plateforme: str) -> dict:
    """Résultat d'un POST /v1/posts : {external_id, statut, publies, erreurs, avertissements}.
    Lève LateErreur si rien n'est parti."""
    if resp.status_code not in (200, 201, 207):
        raise erreur_reponse(resp, plateforme)
    data = _json(resp)
    post = data.get("post") if isinstance(data.get("post"), dict) else {}
    external_id = post.get("_id") or post.get("id") or data.get("_id") or data.get("id") or data.get("postId") or ""
    statut = post.get("status") or ""
    erreurs = _erreurs_plateformes(data, post)
    detail = "; ".join(f"{libelle(DEPUIS_LATE.get(e['platform'] or '', e['platform'] or ''))} : {e['error']}"
                       for e in erreurs)
    if (resp.status_code == 207 and data.get("error")) or statut == "failed":
        raise LateErreur(f"Late n'a pas pu publier : {detail or data.get('error') or data.get('message') or 'échec'}",
                         502, "echec")
    publies = []
    for r in data.get("platformResults") or []:
        if isinstance(r, dict) and r.get("status") in ("published", "processing", "pending", "uploading"):
            publies.append(r.get("platform"))
    if not publies:
        publies = [p.get("platform") for p in post.get("platforms") or []
                   if isinstance(p, dict) and p.get("status") != "failed"]
    avertissements = [str(w) for w in (data.get("warnings") or []) if w]
    if erreurs:
        avertissements.append(f"Échec partiel — {detail}")
    return {
        "external_id": str(external_id),
        "statut": statut,
        "publies": [DEPUIS_LATE.get(p, p) for p in publies if p],
        "erreurs": erreurs,
        "avertissements": avertissements,
    }


async def publier(post: dict, *, programme_le: Optional[datetime] = None) -> dict:
    liste = await comptes()
    corps, _cibles = corps_publication(post, liste, programme_le=programme_le)
    resp = await requete("POST", "/posts", json=corps, timeout=60)
    return lire_publication(resp, (post.get("plateforme") or "").lower())


# ─── Images ──────────────────────────────────────────────────────────

def preparer_image(contenu: bytes) -> tuple:
    """Image quelconque (JPEG, PNG, WebP…) → (jpeg, largeur, hauteur) publiable sur Instagram :
    orientation EXIF appliquée, fond blanc sous la transparence, recadrage au centre dans
    4:5 – 1,91:1, 1440 px de large au plus. Lève ValueError si l'image est illisible."""
    from PIL import Image, ImageOps, UnidentifiedImageError

    if not contenu or len(contenu) < 100:
        raise ValueError("Image vide.")
    if len(contenu) > TAILLE_MAX_ENTREE:
        raise ValueError("Image trop lourde (15 Mo au plus).")
    if contenu[4:12] in (b"ftypheic", b"ftypheix", b"ftypmif1", b"ftyphevc"):
        raise ValueError("Photo au format HEIC : choisissez-la depuis l'iPhone (convertie en JPEG "
                         "automatiquement) ou exportez-la en JPEG.")
    try:
        img = Image.open(io.BytesIO(contenu))
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as e:
        raise ValueError("Format d'image non reconnu (JPEG, PNG ou WebP).") from e

    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        fond = Image.new("RGB", img.size, (255, 255, 255))
        fond.paste(img, mask=img.split()[-1])
        img = fond
    elif img.mode != "RGB":
        img = img.convert("RGB")

    w, h = img.size
    if w < 1 or h < 1:
        raise ValueError("Image vide.")
    rapport = w / h
    if rapport < RAPPORT_MIN:  # trop haute : on garde le centre en 4:5
        nh = int(round(w / RAPPORT_MIN))
        haut = (h - nh) // 2
        img = img.crop((0, haut, w, haut + nh))
    elif rapport > RAPPORT_MAX:  # trop large : 1,91:1
        nw = int(round(h * RAPPORT_MAX))
        gauche = (w - nw) // 2
        img = img.crop((gauche, 0, gauche + nw, h))

    w, h = img.size
    if w > LARGEUR_MAX:
        img = img.resize((LARGEUR_MAX, max(1, int(round(h * LARGEUR_MAX / w)))), Image.LANCZOS)

    for qualite in (88, 80, 70):
        sortie = io.BytesIO()
        img.save(sortie, format="JPEG", quality=qualite, optimize=True, progressive=True)
        donnees = sortie.getvalue()
        if len(donnees) <= 8 * 1024 * 1024:
            break
    return donnees, img.size[0], img.size[1]
