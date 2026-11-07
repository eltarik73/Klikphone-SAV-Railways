"""
Marketing module — Klikphone SAV.
- Avis Google (sync, IA response generation, publish)
- Posts réseaux sociaux (CRUD, generate with AI, schedule, publish)
- Calendrier marketing (CRUD)
- Templates marketing (CRUD + seed)
- Analytics (overview, posts performance)
"""

import os
import re
import json
from datetime import datetime, date, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import AliasChoices, BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app.database import get_cursor
from app.api.auth import exiger_role_admin, get_current_user
from app.services import reseaux_sociaux


def _require_admin_marketing(request: Request, user: dict = Depends(get_current_user)):
    """Dépendance : rôle admin du membre ET code admin saisi sur ce poste (auth.exiger_role_admin)."""
    return exiger_role_admin(request, user)

router = APIRouter(prefix="/api/marketing", tags=["marketing"])


# ─── TABLE CREATION ─────────────────────────────────────

_tables_checked = False


def _ensure_tables():
    """Crée les tables marketing si elles n'existent pas, puis seed les templates."""
    global _tables_checked
    if _tables_checked:
        return
    try:
        with get_cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS avis_google (
                    id SERIAL PRIMARY KEY,
                    google_review_id VARCHAR(255) UNIQUE NOT NULL,
                    auteur VARCHAR(255),
                    note INTEGER CHECK (note >= 1 AND note <= 5),
                    texte TEXT,
                    date_avis TIMESTAMP,
                    repondu BOOLEAN DEFAULT FALSE,
                    reponse_texte TEXT,
                    reponse_date TIMESTAMP,
                    reponse_par VARCHAR(100),
                    ia_suggestion TEXT,
                    synced_at TIMESTAMP DEFAULT NOW(),
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """)
        with get_cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS posts_marketing (
                    id SERIAL PRIMARY KEY,
                    titre VARCHAR(500) NOT NULL,
                    contenu TEXT NOT NULL,
                    plateforme VARCHAR(50) NOT NULL,
                    type_contenu VARCHAR(50),
                    statut VARCHAR(30) DEFAULT 'brouillon',
                    date_programmee TIMESTAMP,
                    date_publication TIMESTAMP,
                    image_url TEXT,
                    hashtags TEXT[],
                    engagement_vues INTEGER DEFAULT 0,
                    engagement_likes INTEGER DEFAULT 0,
                    engagement_commentaires INTEGER DEFAULT 0,
                    external_post_id VARCHAR(255),
                    genere_par_ia BOOLEAN DEFAULT FALSE,
                    contexte_ia TEXT,
                    created_by VARCHAR(100),
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """)
        with get_cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS calendrier_marketing (
                    id SERIAL PRIMARY KEY,
                    titre VARCHAR(255) NOT NULL,
                    description TEXT,
                    type VARCHAR(50) NOT NULL,
                    date_evenement DATE NOT NULL,
                    heure VARCHAR(10),
                    couleur VARCHAR(7) DEFAULT '#7C3AED',
                    post_id INTEGER REFERENCES posts_marketing(id),
                    recurrent BOOLEAN DEFAULT FALSE,
                    recurrence_pattern VARCHAR(50),
                    completed BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """)
        with get_cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS templates_marketing (
                    id SERIAL PRIMARY KEY,
                    nom VARCHAR(255) NOT NULL,
                    description TEXT,
                    plateforme VARCHAR(50),
                    type_contenu VARCHAR(50),
                    contenu_template TEXT NOT NULL,
                    hashtags_defaut TEXT[],
                    couleur VARCHAR(7) DEFAULT '#7C3AED',
                    icone VARCHAR(10) DEFAULT '📝',
                    actif BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """)
        with get_cursor() as cur:
            # Photos des posts (envoyées ou générées) : gardées en base, servies publiquement
            # à Late / Instagram (avant : en mémoire, perdues à chaque redéploiement)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS marketing_images (
                    id VARCHAR(40) PRIMARY KEY,
                    data BYTEA NOT NULL,
                    mime VARCHAR(30) NOT NULL DEFAULT 'image/jpeg',
                    largeur INTEGER,
                    hauteur INTEGER,
                    source VARCHAR(20),
                    created_by VARCHAR(100),
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """)
        _seed_templates()
        _tables_checked = True
    except Exception as e:
        print(f"Warning marketing tables: {e}")


def _seed_templates():
    """Insère les templates par défaut si la table est vide."""
    with get_cursor() as cur:
        cur.execute("SELECT COUNT(*) as c FROM templates_marketing")
        if cur.fetchone()["c"] > 0:
            return

        templates = [
            {
                "nom": "Promo écran",
                "description": "Promotion sur une réparation d'écran",
                "plateforme": "instagram",
                "type_contenu": "promo",
                "contenu_template": "📱 Votre écran {marque} cassé ? Chez Klikphone Chambéry, on le répare en {temps} ! 💪\n\nPrix à partir de {prix}€\n📍 Chambéry Centre",
                "hashtags_defaut": ["#Klikphone", "#RéparationTéléphone", "#Chambéry"],
                "couleur": "#EF4444",
                "icone": "📱",
            },
            {
                "nom": "Avis client",
                "description": "Partage d'un avis client positif",
                "plateforme": "facebook",
                "type_contenu": "temoignage",
                "contenu_template": '⭐ Merci à {nom_client} pour son avis 5 étoiles ! 🙏\n\n"{texte_avis}"\n\nVotre satisfaction est notre priorité ! 💜',
                "hashtags_defaut": ["#AvisClient", "#Klikphone", "#Satisfaction"],
                "couleur": "#F59E0B",
                "icone": "⭐",
            },
            {
                "nom": "Nouveau service",
                "description": "Annonce d'un nouveau service ou produit",
                "plateforme": "instagram",
                "type_contenu": "actualite",
                "contenu_template": "🆕 Nouveau chez Klikphone !\n\n{description_service}\n\nVenez nous voir en boutique 📍 Chambéry",
                "hashtags_defaut": ["#Klikphone", "#NouveauService", "#Chambéry"],
                "couleur": "#10B981",
                "icone": "🆕",
            },
            {
                "nom": "Stats du mois",
                "description": "Bilan mensuel de la boutique",
                "plateforme": "facebook",
                "type_contenu": "stats",
                "contenu_template": "📊 Ce mois-ci chez Klikphone :\n✅ {nb_reparations} réparations\n⭐ {note_moyenne}/5 de satisfaction\n⚡ {temps_moyen} de réparation moyen\n\nMerci pour votre confiance ! 💜",
                "hashtags_defaut": ["#Klikphone", "#Stats", "#Chambéry"],
                "couleur": "#3B82F6",
                "icone": "📊",
            },
            {
                "nom": "Conseil entretien",
                "description": "Conseil pour entretenir son téléphone",
                "plateforme": "instagram",
                "type_contenu": "conseil",
                "contenu_template": "💡 Le saviez-vous ?\n\n{conseil}\n\nPrenez soin de votre téléphone ! Et si besoin, Klikphone est là 💪📱",
                "hashtags_defaut": ["#ConseilTech", "#Klikphone", "#Astuce"],
                "couleur": "#8B5CF6",
                "icone": "💡",
            },
        ]

        for t in templates:
            cur.execute("""
                INSERT INTO templates_marketing
                    (nom, description, plateforme, type_contenu, contenu_template,
                     hashtags_defaut, couleur, icone)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                t["nom"], t["description"], t["plateforme"], t["type_contenu"],
                t["contenu_template"], t["hashtags_defaut"], t["couleur"], t["icone"],
            ))


# ─── PYDANTIC MODELS ────────────────────────────────────

# Longueurs = tailles des colonnes VARCHAR (un texte plus long donnait une erreur 500),
# dates typées (une date impossible donnait une erreur 500) : refus 422 lisible.
class AvisReponsePublier(BaseModel):
    reponse_texte: str


class PostCreate(BaseModel):
    titre: str = Field(..., max_length=500)
    contenu: str
    plateforme: str = Field(..., max_length=50)
    type_contenu: Optional[str] = Field(None, max_length=50)
    hashtags: Optional[List[str]] = None
    image_url: Optional[str] = None
    statut: Optional[str] = Field("brouillon", max_length=30)


class PostUpdate(BaseModel):
    titre: Optional[str] = Field(None, max_length=500)
    contenu: Optional[str] = None
    plateforme: Optional[str] = Field(None, max_length=50)
    type_contenu: Optional[str] = Field(None, max_length=50)
    hashtags: Optional[List[str]] = None
    image_url: Optional[str] = None
    statut: Optional[str] = Field(None, max_length=30)


class PostProgrammer(BaseModel):
    date_programmee: datetime


class PostGenerer(BaseModel):
    plateforme: str = Field(..., max_length=50)
    type_contenu: str = Field(..., max_length=50)
    contexte: Optional[str] = None


# L'écran Community Manager envoie la date de l'événement sous le nom « date »
_DATE_EVENEMENT = AliasChoices("date_evenement", "date")


class CalendrierCreate(BaseModel):
    titre: str = Field(..., max_length=255)
    description: Optional[str] = None
    type: str = Field(..., max_length=50)
    date_evenement: date = Field(..., validation_alias=_DATE_EVENEMENT)
    heure: Optional[str] = Field(None, max_length=10)
    couleur: Optional[str] = Field("#7C3AED", max_length=7)
    post_id: Optional[int] = Field(None, ge=1, le=2_147_483_647)
    recurrent: Optional[bool] = False
    recurrence_pattern: Optional[str] = Field(None, max_length=50)


class CalendrierUpdate(BaseModel):
    titre: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    type: Optional[str] = Field(None, max_length=50)
    date_evenement: Optional[date] = Field(None, validation_alias=_DATE_EVENEMENT)
    heure: Optional[str] = Field(None, max_length=10)
    couleur: Optional[str] = Field(None, max_length=7)
    post_id: Optional[int] = Field(None, ge=1, le=2_147_483_647)
    recurrent: Optional[bool] = None
    recurrence_pattern: Optional[str] = Field(None, max_length=50)
    completed: Optional[bool] = None


class TemplateCreate(BaseModel):
    nom: str = Field(..., max_length=255)
    description: Optional[str] = None
    plateforme: Optional[str] = Field(None, max_length=50)
    type_contenu: Optional[str] = Field(None, max_length=50)
    contenu_template: str
    hashtags_defaut: Optional[List[str]] = None
    couleur: Optional[str] = Field("#7C3AED", max_length=7)
    icone: Optional[str] = Field("📝", max_length=10)


class TemplateUpdate(BaseModel):
    nom: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    plateforme: Optional[str] = Field(None, max_length=50)
    type_contenu: Optional[str] = Field(None, max_length=50)
    contenu_template: Optional[str] = None
    hashtags_defaut: Optional[List[str]] = None
    couleur: Optional[str] = Field(None, max_length=7)
    icone: Optional[str] = Field(None, max_length=10)
    actif: Optional[bool] = None


# ─── HELPERS ─────────────────────────────────────────────

def _row_to_dict(row):
    """Convertit un RealDictRow en dict sérialisable."""
    if row is None:
        return None
    d = dict(row)
    for k, v in d.items():
        if isinstance(v, datetime):
            d[k] = v.isoformat()
        elif isinstance(v, date):
            d[k] = v.isoformat()
    return d


# ═════════════════════════════════════════════════════════
# AVIS GOOGLE
# ═════════════════════════════════════════════════════════

@router.get("/avis")
def list_avis(
    repondu: Optional[bool] = Query(None),
    note_min: Optional[int] = Query(None),
    note_max: Optional[int] = Query(None),
    user: dict = Depends(_require_admin_marketing),
):
    """Liste tous les avis Google avec filtres optionnels."""
    _ensure_tables()
    conditions = []
    params = []

    if repondu is not None:
        conditions.append("repondu = %s")
        params.append(repondu)
    if note_min is not None:
        conditions.append("note >= %s")
        params.append(note_min)
    if note_max is not None:
        conditions.append("note <= %s")
        params.append(note_max)

    where = ""
    if conditions:
        where = "WHERE " + " AND ".join(conditions)

    with get_cursor() as cur:
        cur.execute(f"SELECT * FROM avis_google {where} ORDER BY date_avis DESC", params)
        rows = cur.fetchall()

    return [_row_to_dict(r) for r in rows]


@router.get("/avis/stats")
def avis_stats(user: dict = Depends(_require_admin_marketing)):
    """Statistiques des avis Google."""
    _ensure_tables()
    with get_cursor() as cur:
        cur.execute("""
            SELECT
                COALESCE(AVG(note), 0) as note_moyenne,
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE repondu = FALSE) as non_repondus
            FROM avis_google
        """)
        row = cur.fetchone()

    total = row["total"]
    non_repondus = row["non_repondus"]
    repondus = total - non_repondus
    taux_reponse = round((repondus / total * 100), 1) if total > 0 else 0

    return {
        "note_moyenne": round(float(row["note_moyenne"]), 2),
        "total": total,
        "non_repondus": non_repondus,
        "taux_reponse": taux_reponse,
    }


@router.get("/avis/search-place")
async def search_place(query: str = Query(..., description="Nom de la boutique + ville"), user: dict = Depends(_require_admin_marketing)):
    """Recherche un Place ID Google à partir du nom de la boutique."""
    api_key = os.getenv("GOOGLE_PLACES_API_KEY")
    if not api_key:
        raise HTTPException(400, "GOOGLE_PLACES_API_KEY non configurée. Ajoutez-la dans les variables d'environnement Railway.")

    import httpx
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            "https://maps.googleapis.com/maps/api/place/findplacefromtext/json",
            params={
                "input": query,
                "inputtype": "textquery",
                "fields": "place_id,name,formatted_address,rating,user_ratings_total",
                "key": api_key,
            },
        )
        data = resp.json()

    if data.get("status") != "OK" or not data.get("candidates"):
        return {"candidates": [], "message": f"Aucun résultat pour '{query}'. Status: {data.get('status')}"}

    return {"candidates": data["candidates"]}


def _enregistrer_avis(reviews: list) -> int:
    """Insère les avis Google absents de la base ; renvoie le nombre d'ajouts."""
    synced = 0
    with get_cursor() as cur:
        for review in reviews:
            author = review.get("author_name", "Anonyme")
            rating = review.get("rating", 5)
            text = review.get("text", "")
            timestamp = review.get("time", 0)
            # Créer un ID unique à partir de l'auteur + timestamp
            review_id = f"google_{author.replace(' ', '_').lower()}_{timestamp}"

            # Convertir le timestamp unix en datetime
            from datetime import datetime as dt
            date_avis = dt.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S") if timestamp else None

            # Vérifier si cet avis existe déjà (par google_review_id ou par auteur+date)
            cur.execute(
                "SELECT id FROM avis_google WHERE google_review_id = %s",
                (review_id,),
            )
            if cur.fetchone():
                continue

            # Vérifier aussi par auteur + note (pour éviter les doublons des anciens avis démo)
            cur.execute(
                "SELECT id FROM avis_google WHERE auteur = %s AND note = %s AND texte = %s",
                (author, rating, text),
            )
            if cur.fetchone():
                continue

            cur.execute("""
                INSERT INTO avis_google
                    (google_review_id, auteur, note, texte, date_avis,
                     repondu, reponse_texte, reponse_date, reponse_par)
                VALUES (%s, %s, %s, %s, %s, FALSE, NULL, NULL, NULL)
            """, (review_id, author, rating, text, date_avis))
            synced += 1
    return synced


@router.post("/avis/sync")
async def sync_avis(user: dict = Depends(_require_admin_marketing)):
    """Synchronise les avis depuis Google Places API. Nécessite GOOGLE_PLACES_API_KEY + GOOGLE_PLACE_ID."""
    await run_in_threadpool(_ensure_tables)

    api_key = os.getenv("GOOGLE_PLACES_API_KEY")
    place_id = os.getenv("GOOGLE_PLACE_ID", "").strip()

    if not api_key:
        raise HTTPException(
            400,
            "GOOGLE_PLACES_API_KEY non configurée dans les variables d'environnement Railway."
        )

    import httpx

    # Si pas de Place ID ou Place ID invalide, chercher automatiquement
    async def _fetch_details(pid):
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(
                "https://maps.googleapis.com/maps/api/place/details/json",
                params={
                    "place_id": pid,
                    "fields": "reviews,rating,user_ratings_total,name",
                    "reviews_sort": "newest",
                    "language": "fr",
                    "key": api_key,
                },
            )
            return resp.json()

    async def _search_place_id():
        """Recherche automatique du Place ID via Find Place API."""
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                "https://maps.googleapis.com/maps/api/place/findplacefromtext/json",
                params={
                    "input": "Klikphone Chambéry",
                    "inputtype": "textquery",
                    "fields": "place_id",
                    "key": api_key,
                },
            )
            result = resp.json()
        if result.get("status") == "OK" and result.get("candidates"):
            return result["candidates"][0]["place_id"]
        return None

    data = None
    # Essai 1 : avec le Place ID configuré
    if place_id:
        data = await _fetch_details(place_id)

    # Si NOT_FOUND ou pas de Place ID, recherche automatique
    if not place_id or (data and data.get("status") == "NOT_FOUND"):
        fresh_pid = await _search_place_id()
        if fresh_pid:
            place_id = fresh_pid
            data = await _fetch_details(place_id)
        elif not place_id:
            raise HTTPException(400, "GOOGLE_PLACE_ID non configuré et recherche automatique échouée.")

    if data.get("status") != "OK":
        raise HTTPException(502, f"Erreur Google Places API: {data.get('status')} — {data.get('error_message', '')}")

    result = data.get("result", {})
    reviews = result.get("reviews", [])

    if not reviews:
        return {"synced": 0, "total_google": result.get("user_ratings_total", 0), "message": "Aucun avis retourné par Google"}

    synced = await run_in_threadpool(_enregistrer_avis, reviews)

    return {
        "synced": synced,
        "total_reviews_found": len(reviews),
        "note_google": result.get("rating"),
        "total_avis_google": result.get("user_ratings_total"),
    }


@router.post("/avis/{avis_id}/generer-reponse")
def generer_reponse_avis(avis_id: int, user: dict = Depends(_require_admin_marketing)):
    """Génère une suggestion de réponse IA pour un avis Google."""
    _ensure_tables()

    with get_cursor() as cur:
        cur.execute("SELECT * FROM avis_google WHERE id = %s", (avis_id,))
        avis = cur.fetchone()

    if not avis:
        raise HTTPException(404, "Avis non trouvé")

    auteur = avis["auteur"] or "Client"
    note = avis["note"] or 5
    texte = avis["texte"] or ""

    prenom = auteur.split()[0] if auteur else "Client"

    system_prompt = (
        "Tu es le community manager de Klikphone, un magasin de réparation de "
        "téléphones à Chambéry, France. Nous sommes en 2026. "
        "Tu réponds aux avis Google de manière "
        "professionnelle mais chaleureuse, personnalisée (utilise le prénom du client), "
        "courte (3-4 phrases max), en français. Si l'avis est négatif (≤3 étoiles), "
        "sois empathique, propose une solution. Si positif (≥4 étoiles), remercie et "
        "invite à revenir. Signe toujours 'L'équipe Klikphone'."
    )

    user_message = (
        f"Avis de {auteur} ({note}/5 étoiles) :\n\"{texte}\"\n\n"
        f"Rédige une réponse appropriée."
    )

    api_key = os.getenv("ANTHROPIC_API_KEY")

    if api_key:
        try:
            import anthropic
            client = anthropic.Anthropic(api_key=api_key)
            message = client.messages.create(
                model="claude-sonnet-4-5-20250929",
                max_tokens=300,
                system=system_prompt,
                messages=[{"role": "user", "content": user_message}],
            )
            suggestion = message.content[0].text
        except Exception as e:
            print(f"[MARKETING] Erreur API Anthropic: {e}")
            suggestion = _fallback_reponse_avis(prenom, note, texte)
    else:
        suggestion = _fallback_reponse_avis(prenom, note, texte)

    # Sauvegarder la suggestion
    with get_cursor() as cur:
        cur.execute(
            "UPDATE avis_google SET ia_suggestion = %s WHERE id = %s",
            (suggestion, avis_id),
        )

    return {"suggestion": suggestion}


def _fallback_reponse_avis(prenom: str, note: int, texte: str) -> str:
    """Réponse de fallback si pas de clé API Anthropic."""
    if note >= 4:
        return (
            f"Bonjour {prenom}, merci beaucoup pour votre avis et votre confiance ! "
            f"Nous sommes ravis que votre expérience chez Klikphone vous ait satisfait(e). "
            f"N'hésitez pas à revenir nous voir pour tout besoin futur, notre équipe sera "
            f"toujours là pour vous aider. À très bientôt !\n\nL'équipe Klikphone"
        )
    else:
        return (
            f"Bonjour {prenom}, merci d'avoir pris le temps de partager votre retour. "
            f"Nous sommes désolés que votre expérience n'ait pas été à la hauteur de vos attentes. "
            f"Nous aimerions en discuter avec vous pour trouver une solution. "
            f"N'hésitez pas à nous contacter directement en boutique ou par téléphone.\n\n"
            f"L'équipe Klikphone"
        )


@router.post("/avis/{avis_id}/publier-reponse")
def publier_reponse_avis(
    avis_id: int,
    body: AvisReponsePublier,
    user: dict = Depends(_require_admin_marketing),
):
    """Publie une réponse à un avis Google (stub : marque comme répondu en BDD)."""
    _ensure_tables()

    with get_cursor() as cur:
        cur.execute("SELECT id FROM avis_google WHERE id = %s", (avis_id,))
        if not cur.fetchone():
            raise HTTPException(404, "Avis non trouvé")

        utilisateur = user.get("sub", "Inconnu")
        cur.execute("""
            UPDATE avis_google
            SET repondu = TRUE,
                reponse_texte = %s,
                reponse_date = NOW(),
                reponse_par = %s
            WHERE id = %s
            RETURNING *
        """, (body.reponse_texte, utilisateur, avis_id))
        updated = cur.fetchone()

    return _row_to_dict(updated)


@router.put("/avis/{avis_id}/reponse")
def update_reponse_avis(
    avis_id: int,
    body: AvisReponsePublier,
    user: dict = Depends(_require_admin_marketing),
):
    """Met à jour manuellement la réponse d'un avis."""
    _ensure_tables()

    with get_cursor() as cur:
        cur.execute("SELECT id FROM avis_google WHERE id = %s", (avis_id,))
        if not cur.fetchone():
            raise HTTPException(404, "Avis non trouvé")

        utilisateur = user.get("sub", "Inconnu")
        cur.execute("""
            UPDATE avis_google
            SET repondu = TRUE,
                reponse_texte = %s,
                reponse_date = NOW(),
                reponse_par = %s
            WHERE id = %s
            RETURNING *
        """, (body.reponse_texte, utilisateur, avis_id))
        updated = cur.fetchone()

    return _row_to_dict(updated)


# ═════════════════════════════════════════════════════════
# POSTS MARKETING
# ═════════════════════════════════════════════════════════

@router.get("/posts")
def list_posts(
    plateforme: Optional[str] = Query(None),
    statut: Optional[str] = Query(None),
    type_contenu: Optional[str] = Query(None),
    user: dict = Depends(_require_admin_marketing),
):
    """Liste les posts marketing avec filtres optionnels."""
    _ensure_tables()
    conditions = []
    params = []

    if plateforme:
        conditions.append("plateforme = %s")
        params.append(plateforme)
    if statut:
        conditions.append("statut = %s")
        params.append(statut)
    if type_contenu:
        conditions.append("type_contenu = %s")
        params.append(type_contenu)

    where = ""
    if conditions:
        where = "WHERE " + " AND ".join(conditions)

    with get_cursor() as cur:
        cur.execute(
            f"SELECT * FROM posts_marketing {where} ORDER BY created_at DESC",
            params,
        )
        rows = cur.fetchall()

    return [_row_to_dict(r) for r in rows]


@router.post("/posts")
def create_post(body: PostCreate, user: dict = Depends(_require_admin_marketing)):
    """Crée un nouveau post marketing."""
    _ensure_tables()
    utilisateur = user.get("sub", "Inconnu")

    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO posts_marketing
                (titre, contenu, plateforme, type_contenu, hashtags,
                 image_url, statut, created_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (
            body.titre, body.contenu, body.plateforme, body.type_contenu,
            body.hashtags, body.image_url, body.statut or "brouillon", utilisateur,
        ))
        row = cur.fetchone()

    return _row_to_dict(row)


@router.put("/posts/{post_id}")
def update_post(
    post_id: int,
    body: PostUpdate,
    user: dict = Depends(_require_admin_marketing),
):
    """Met à jour un post marketing."""
    _ensure_tables()

    with get_cursor() as cur:
        cur.execute("SELECT * FROM posts_marketing WHERE id = %s", (post_id,))
        existing = cur.fetchone()
        if not existing:
            raise HTTPException(404, "Post non trouvé")

        fields = []
        params = []
        if body.titre is not None:
            fields.append("titre = %s")
            params.append(body.titre)
        if body.contenu is not None:
            fields.append("contenu = %s")
            params.append(body.contenu)
        if body.plateforme is not None:
            fields.append("plateforme = %s")
            params.append(body.plateforme)
        if body.type_contenu is not None:
            fields.append("type_contenu = %s")
            params.append(body.type_contenu)
        if body.hashtags is not None:
            fields.append("hashtags = %s")
            params.append(body.hashtags)
        if body.image_url is not None:
            fields.append("image_url = %s")
            params.append(body.image_url)
        if body.statut is not None:
            fields.append("statut = %s")
            params.append(body.statut)

        if not fields:
            return _row_to_dict(existing)

        fields.append("updated_at = NOW()")
        params.append(post_id)

        cur.execute(
            f"UPDATE posts_marketing SET {', '.join(fields)} WHERE id = %s RETURNING *",
            params,
        )
        row = cur.fetchone()

    return _row_to_dict(row)


@router.delete("/posts/{post_id}")
def delete_post(post_id: int, user: dict = Depends(_require_admin_marketing)):
    """Supprime un post (uniquement si brouillon)."""
    _ensure_tables()

    with get_cursor() as cur:
        cur.execute("SELECT statut FROM posts_marketing WHERE id = %s", (post_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Post non trouvé")
        if row["statut"] != "brouillon":
            raise HTTPException(400, "Seuls les brouillons peuvent être supprimés")

        cur.execute("DELETE FROM posts_marketing WHERE id = %s", (post_id,))

    return {"status": "ok", "deleted": post_id}


def _http_late(e: "reseaux_sociaux.LateErreur") -> HTTPException:
    return HTTPException(e.status, e.message)


@router.get("/late/accounts")
async def list_late_accounts(user: dict = Depends(_require_admin_marketing)):
    """Comptes sociaux connectés chez Late (Zernio)."""
    try:
        liste = await reseaux_sociaux.comptes()
    except reseaux_sociaux.LateErreur as e:
        raise _http_late(e)
    return [{k: c[k] for k in ("id", "platform", "plateforme", "username", "displayName",
                               "isActive", "profilePicture")} for c in liste]


# Pages du Community Manager où Late peut renvoyer le gérant après une connexion
_RETOURS_CONNEXION = re.compile(r"^/(tech|accueil)/community$")


@router.get("/late/connect/{plateforme}")
async def lien_connexion_late(
    plateforme: str,
    request: Request,
    retour: str = Query("/tech/community"),
    user: dict = Depends(_require_admin_marketing),
):
    """Adresse d'autorisation pour connecter (ou reconnecter) un réseau chez Late."""
    from app.api.public_documents import _base_publique

    if not _RETOURS_CONNEXION.match(retour or ""):
        retour = "/tech/community"
    redirection = f"{_base_publique(request)}{retour}?connexion=late"
    try:
        liste = await reseaux_sociaux.comptes()
        url = await reseaux_sociaux.lien_connexion(plateforme, redirection, liste)
    except reseaux_sociaux.LateErreur as e:
        raise _http_late(e)
    return {"url": url}


# Ancien mapping, gardé pour les imports existants
_PLATFORM_MAP = {k: v[0] for k, v in reseaux_sociaux.PLATEFORMES.items()}

_IMAGE_ID_RE = re.compile(r"^[0-9a-f-]{12,40}$")


def _id_image_locale(url: str) -> Optional[str]:
    """Identifiant d'une image servie par cette app (…/api/marketing/images/<id>.jpg), sinon None."""
    m = re.search(r"/api/marketing/images/([0-9a-f-]{12,40})(?:\.[a-z]{3,4})?(?:[?#].*)?$", url or "")
    return m.group(1) if m else None


def _image_disponible(image_id: str) -> bool:
    if image_id in _generated_images:
        return True
    with get_cursor() as cur:
        cur.execute("SELECT 1 FROM marketing_images WHERE id = %s", (image_id,))
        return cur.fetchone() is not None


async def _envoyer_late(post_id: int, programme_le: Optional[datetime] = None) -> dict:
    """Publie (ou programme chez Late) un post de l'app et met à jour sa ligne."""
    def _lire_post():
        _ensure_tables()
        with get_cursor() as cur:
            cur.execute("SELECT * FROM posts_marketing WHERE id = %s", (post_id,))
            return cur.fetchone()

    post = await run_in_threadpool(_lire_post)
    if not post:
        raise HTTPException(404, "Post non trouvé")
    post_dict = _row_to_dict(post)
    if post_dict.get("statut") == "publié":
        raise HTTPException(400, "Ce post est déjà publié.")

    image_id = _id_image_locale(post_dict.get("image_url") or "")
    if image_id and not await run_in_threadpool(_image_disponible, image_id):
        raise HTTPException(
            400, "La photo de ce post n'existe plus (image créée avant la mise à jour) : "
                 "remettez une photo au post puis republiez.")

    try:
        resultat = await reseaux_sociaux.publier(post_dict, programme_le=programme_le)
    except reseaux_sociaux.LateErreur as e:
        raise _http_late(e)

    def _marquer():
        with get_cursor() as cur:
            if programme_le is not None:
                cur.execute("""
                    UPDATE posts_marketing
                    SET statut = 'programmé', date_programmee = %s,
                        external_post_id = %s, updated_at = NOW()
                    WHERE id = %s RETURNING *
                """, (programme_le.replace(tzinfo=None), resultat["external_id"], post_id))
            else:
                cur.execute("""
                    UPDATE posts_marketing
                    SET statut = 'publié', date_publication = NOW(),
                        external_post_id = %s, updated_at = NOW()
                    WHERE id = %s RETURNING *
                """, (resultat["external_id"], post_id))
            return cur.fetchone()

    row = await run_in_threadpool(_marquer)
    result = _row_to_dict(row)
    result["platforms_published"] = resultat["publies"] or [post_dict.get("plateforme")]
    if resultat["avertissements"]:
        result["warning"] = " ".join(resultat["avertissements"])
    return result


@router.post("/posts/{post_id}/publier")
async def publier_post(post_id: int, user: dict = Depends(_require_admin_marketing)):
    """Publie tout de suite un post sur le compte de SA plateforme, via Late."""
    return await _envoyer_late(post_id)


def _maintenant_paris() -> datetime:
    from app.api.tickets import heure_paris
    return heure_paris()


@router.post("/posts/{post_id}/programmer")
async def programmer_post(
    post_id: int,
    body: PostProgrammer,
    user: dict = Depends(_require_admin_marketing),
):
    """Programme la publication chez Late (qui publie à l'heure dite, heure de Paris)."""
    quand = body.date_programmee
    if quand.tzinfo is not None:  # heure avec fuseau → heure de Paris (Late la lit dans ce fuseau)
        from app.api.tickets import heure_paris
        quand = heure_paris(quand)
    if quand <= _maintenant_paris() + timedelta(minutes=2):
        raise HTTPException(400, "Choisissez une date et une heure à venir.")
    return await _envoyer_late(post_id, programme_le=quand)


@router.post("/posts/actualiser")
async def actualiser_posts_programmes(user: dict = Depends(_require_admin_marketing)):
    """Posts programmés dont l'heure est passée : statut relu chez Late (publié / erreur)."""
    def _a_verifier():
        _ensure_tables()
        with get_cursor() as cur:
            cur.execute("""
                SELECT id, external_post_id FROM posts_marketing
                WHERE statut = 'programmé' AND date_programmee <= %s
                  AND COALESCE(external_post_id, '') <> ''
                ORDER BY date_programmee LIMIT 10
            """, (_maintenant_paris(),))
            return cur.fetchall()

    lignes = await run_in_threadpool(_a_verifier)
    changes = []
    for ligne in lignes:
        try:
            resp = await reseaux_sociaux.requete("GET", f"/posts/{ligne['external_post_id']}", timeout=15)
        except reseaux_sociaux.LateErreur:
            break
        if resp.status_code != 200:
            continue
        data = resp.json() if resp.content else {}
        late_post = data.get("post") if isinstance(data.get("post"), dict) else data
        statut_late = (late_post or {}).get("status")
        nouveau = {"published": "publié", "partial": "publié", "failed": "erreur"}.get(statut_late)
        if nouveau:
            changes.append((nouveau, ligne["id"]))

    def _ecrire():
        with get_cursor() as cur:
            for statut, pid in changes:
                cur.execute("""
                    UPDATE posts_marketing
                    SET statut = %s,
                        date_publication = CASE WHEN %s = 'publié' THEN COALESCE(date_programmee, NOW())
                                                ELSE date_publication END,
                        updated_at = NOW()
                    WHERE id = %s AND statut = 'programmé'
                """, (statut, statut, pid))

    if changes:
        await run_in_threadpool(_ecrire)
    return {"verifies": len(lignes), "mis_a_jour": len(changes)}


class ImageGenerer(BaseModel):
    prompt: str = Field(..., max_length=1000)  # Description de l'image souhaitée


# Ancien stockage en mémoire (images d'avant le passage en base) : lu en secours seulement
_generated_images: dict = {}


def _base_images() -> str:
    """Origine publique des images : Late / Instagram viennent les chercher à cette adresse."""
    for valeur in (os.getenv("BACKEND_URL", ""), os.getenv("RAILWAY_PUBLIC_DOMAIN", "")):
        valeur = (valeur or "").strip().rstrip("/")
        if valeur:
            return valeur if valeur.startswith("http") else f"https://{valeur}"
    return "https://klikphone-sav-v2-production.up.railway.app"


def _stocker_image(contenu: bytes, source: str, auteur: str = "") -> dict:
    """Image → JPEG compatible Instagram enregistré en base. ValueError si illisible."""
    import uuid

    jpeg, largeur, hauteur = reseaux_sociaux.preparer_image(contenu)
    image_id = uuid.uuid4().hex
    _ensure_tables()
    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO marketing_images (id, data, mime, largeur, hauteur, source, created_by)
            VALUES (%s, %s, 'image/jpeg', %s, %s, %s, %s)
        """, (image_id, jpeg, largeur, hauteur, source, (auteur or "")[:100]))
    return {
        "image_url": f"{_base_images()}/api/marketing/images/{image_id}.jpg",
        "largeur": largeur,
        "hauteur": hauteur,
    }


def _type_image(donnees: bytes) -> str:
    if donnees[:4] == b"RIFF":
        return "image/webp"
    if donnees[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    return "image/jpeg"


@router.get("/images/{image_id}")
def serve_generated_image(image_id: str):
    """Image d'un post, publique (Late et Instagram la téléchargent sans jeton)."""
    from fastapi.responses import Response

    clean_id = image_id.rsplit(".", 1)[0].lower()
    if not _IMAGE_ID_RE.match(clean_id):
        raise HTTPException(404, "Image non trouvée")
    donnees = _generated_images.get(clean_id)
    mime = _type_image(donnees) if donnees else None
    if donnees is None:
        _ensure_tables()
        with get_cursor() as cur:
            cur.execute("SELECT data, mime FROM marketing_images WHERE id = %s", (clean_id,))
            row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Image non trouvée ou expirée")
        donnees, mime = bytes(row["data"]), row["mime"] or "image/jpeg"
    return Response(content=donnees, media_type=mime,
                    headers={"Cache-Control": "public, max-age=31536000, immutable"})


@router.post("/images")
async def envoyer_image(
    fichier: UploadFile = File(...),
    user: dict = Depends(_require_admin_marketing),
):
    """Photo envoyée depuis le comptoir ou le téléphone → JPEG prêt pour Instagram."""
    contenu = await fichier.read(reseaux_sociaux.TAILLE_MAX_ENTREE + 1)
    if len(contenu) > reseaux_sociaux.TAILLE_MAX_ENTREE:
        raise HTTPException(413, "Photo trop lourde (15 Mo au plus).")
    try:
        return await run_in_threadpool(_stocker_image, contenu, "photo", user.get("sub", ""))
    except ValueError as e:
        raise HTTPException(400, str(e))


# ─── Génération d'image IA (tâche de fond, suivie par l'écran) ─────────

# Modèles photo-réalistes d'AI Horde : plusieurs = plus de serveurs bénévoles disponibles
_MODELES_HORDE = ["Juggernaut XL", "AlbedoBase XL 3.1", "AlbedoBase XL (SDXL)", "ICBINP XL"]
_ATTENTE_HORDE_S = 360
_GENERATIONS: dict = {}  # job_id → {statut, image_url, erreur, provider, debut, fin}
_TACHES: set = set()


async def _generate_with_together(prompt: str) -> bytes:
    """Image via Together AI (FLUX.1 schnell, payant : quelques millièmes d'euro par image)."""
    import httpx
    import base64

    together_key = os.getenv("TOGETHER_API_KEY")
    if not together_key:
        raise ValueError("TOGETHER_API_KEY non configurée")
    modele = os.getenv("TOGETHER_IMAGE_MODEL", "black-forest-labs/FLUX.1-schnell")
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            "https://api.together.xyz/v1/images/generations",
            headers={"Authorization": f"Bearer {together_key}"},
            json={"model": modele, "prompt": prompt, "width": 1024, "height": 1024,
                  "steps": 4, "n": 1, "response_format": "b64_json"},
        )
    if resp.status_code == 402:
        raise ValueError("crédit épuisé — ajoutez du crédit sur api.together.ai (environ 0,003 $ par image)")
    if resp.status_code in (401, 403):
        raise ValueError("clé TOGETHER_API_KEY refusée")
    if resp.status_code != 200:
        raise ValueError(f"erreur {resp.status_code} : {resp.text[:200]}")
    return base64.b64decode(resp.json()["data"][0]["b64_json"])


async def _generate_with_horde(prompt: str) -> bytes:
    """Image via AI Horde (gratuit, sans clé, file d'attente de serveurs bénévoles : 1 à 6 min)."""
    import httpx
    import base64
    import asyncio

    headers = {"apikey": "0000000000", "Content-Type": "application/json", "Client-Agent": "klikphone-sav:2:contact"}
    payload = {
        "prompt": prompt + " ### blurry, lowres, watermark, text, logo, deformed",
        "params": {"width": 1024, "height": 1024, "steps": 25, "cfg_scale": 6,
                   "sampler_name": "k_euler", "karras": True},
        "models": _MODELES_HORDE,
        "nsfw": False,
        "censor_nsfw": True,
        "r2": True,
    }
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post("https://aihorde.net/api/v2/generate/async", headers=headers, json=payload)
        if resp.status_code not in (200, 202):
            raise ValueError(f"refus {resp.status_code} : {resp.text[:200]}")
        job_id = resp.json()["id"]

        for _ in range(_ATTENTE_HORDE_S // 5):
            await asyncio.sleep(5)
            check = await client.get(f"https://aihorde.net/api/v2/generate/check/{job_id}", headers=headers)
            data = check.json() if check.status_code == 200 else {}
            if data.get("faulted"):
                raise ValueError("la génération a échoué chez AI Horde")
            if data.get("is_possible") is False:
                raise ValueError("aucun serveur AI Horde disponible pour l'instant")
            if data.get("done"):
                break
        else:
            raise TimeoutError(f"pas d'image après {_ATTENTE_HORDE_S // 60} min (file d'attente saturée)")

        status = await client.get(f"https://aihorde.net/api/v2/generate/status/{job_id}", headers=headers)
        generations = status.json().get("generations", [])
        if not generations:
            raise ValueError("aucune image renvoyée")
        img = generations[0].get("img", "")
        if img.startswith("http"):
            img_resp = await client.get(img)
            img_resp.raise_for_status()
            return img_resp.content
        return base64.b64decode(img)


async def _prompt_anglais(user_prompt: str) -> str:
    """Description française → prompt anglais détaillé (Claude) ; la description telle quelle sinon."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return user_prompt
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        resp = await run_in_threadpool(
            client.messages.create,
            model="claude-sonnet-4-5-20250929",
            max_tokens=300,
            messages=[{"role": "user", "content": user_prompt}],
            system=(
                "You are an expert image prompt engineer for AI image generation (Flux/SDXL). "
                "The user describes an image they want in French. Generate a detailed English prompt "
                "that will produce a stunning, professional, photorealistic image. "
                "The image is for Instagram/LinkedIn social media (1080x1080 square). "
                "Context: Klikphone is a smartphone repair shop in Chambéry, France. "
                "Rules:\n"
                "- Output ONLY the English prompt, nothing else\n"
                "- Be very descriptive: lighting, composition, colors, style\n"
                "- Make it photorealistic and professional\n"
                "- Include 'professional product photography', 'studio lighting', '4K' when relevant\n"
                "- If the user mentions phones/iPhones/Samsung, describe them realistically\n"
                "- No text, letters or logos in the image\n"
                "- Keep the prompt under 150 words"
            ),
        )
        return resp.content[0].text.strip() or user_prompt
    except Exception:
        return user_prompt


async def _travail_generation(job_id: str, prompt: str, auteur: str):
    import time

    job = _GENERATIONS[job_id]
    try:
        en_prompt = await _prompt_anglais(prompt)
        job["prompt_used"] = en_prompt
        image, provider, erreurs = None, None, []
        if os.getenv("TOGETHER_API_KEY"):  # rapide quand le compte a du crédit
            try:
                image, provider = await _generate_with_together(en_prompt), "together"
            except Exception as e:
                erreurs.append(f"Together AI : {e}")
        if image is None:
            try:
                image, provider = await _generate_with_horde(en_prompt), "horde"
            except Exception as e:
                erreurs.append(f"AI Horde : {e}")
        if image is None:
            job.update(statut="erreur", erreur="Génération impossible. " + " ; ".join(erreurs)
                       + ". Vous pouvez toujours ajouter votre propre photo.")
        else:
            stockee = await run_in_threadpool(_stocker_image, image, "ia", auteur)
            job.update(statut="termine", image_url=stockee["image_url"], provider=provider)
    except Exception as e:
        job.update(statut="erreur", erreur=f"Génération impossible : {e}")
    finally:
        job["fin"] = time.time()


def _purger_generations():
    import time

    limite = time.time() - 3600
    for cle_job in [k for k, j in _GENERATIONS.items() if (j.get("fin") or j["debut"]) < limite]:
        _GENERATIONS.pop(cle_job, None)


@router.post("/posts/generer-image")
async def generer_image(body: ImageGenerer, user: dict = Depends(_require_admin_marketing)):
    """Lance la génération d'une image IA en tâche de fond → {job_id} ; suivi par
    GET /posts/generer-image/{job_id}. Together AI d'abord (si crédit), sinon AI Horde (gratuit)."""
    import asyncio
    import time
    import uuid

    prompt = body.prompt.strip()
    if not prompt:
        raise HTTPException(400, "Décrivez l'image souhaitée.")
    _purger_generations()
    if sum(1 for j in _GENERATIONS.values() if j["statut"] == "en_cours") >= 3:
        raise HTTPException(429, "Trois images sont déjà en cours de génération : patientez.")
    job_id = uuid.uuid4().hex
    _GENERATIONS[job_id] = {"statut": "en_cours", "image_url": None, "erreur": None,
                            "provider": None, "debut": time.time(), "fin": None}
    tache = asyncio.create_task(_travail_generation(job_id, prompt, user.get("sub", "")))
    _TACHES.add(tache)
    tache.add_done_callback(_TACHES.discard)
    return {"job_id": job_id, "statut": "en_cours"}


@router.get("/posts/generer-image/{job_id}")
def suivi_generation_image(job_id: str, user: dict = Depends(_require_admin_marketing)):
    import time

    job = _GENERATIONS.get(job_id)
    if not job:
        raise HTTPException(404, "Génération introuvable (serveur redémarré ?) : relancez-la.")
    fin = job.get("fin") or time.time()
    return {
        "job_id": job_id,
        "statut": job["statut"],
        "image_url": job.get("image_url"),
        "erreur": job.get("erreur"),
        "provider": job.get("provider"),
        "secondes": int(fin - job["debut"]),
    }


@router.post("/posts/generer")
def generer_post(body: PostGenerer, user: dict = Depends(_require_admin_marketing)):
    """Génère un post avec Claude AI."""
    _ensure_tables()

    system_prompt = (
        "Tu es le community manager de Klikphone, magasin de réparation de téléphones "
        "à Chambéry (79 Place Saint-Léger). Nous sommes en 2026. "
        "Tu crées des posts pour les réseaux sociaux. Ton ton est professionnel "
        "mais accessible. Adapte la longueur à la plateforme. Inclus des emojis pertinents. "
        "Propose des hashtags adaptés. Mentionne Chambéry quand pertinent. Mets en avant "
        "l'expertise et la rapidité. Réponds en JSON avec les clés: titre, contenu, hashtags (array)."
    )

    user_message = (
        f"Crée un post pour {body.plateforme}, type: {body.type_contenu}."
    )
    if body.contexte:
        user_message += f"\nContexte supplémentaire : {body.contexte}"

    api_key = os.getenv("ANTHROPIC_API_KEY")

    if api_key:
        try:
            import anthropic
            client = anthropic.Anthropic(api_key=api_key)
            message = client.messages.create(
                model="claude-sonnet-4-5-20250929",
                max_tokens=500,
                system=system_prompt,
                messages=[{"role": "user", "content": user_message}],
            )
            response_text = message.content[0].text

            # Extraire le JSON de la réponse
            try:
                # Chercher un bloc JSON dans la réponse
                start = response_text.find("{")
                end = response_text.rfind("}") + 1
                if start >= 0 and end > start:
                    result = json.loads(response_text[start:end])
                    return {
                        "titre": result.get("titre", ""),
                        "contenu": result.get("contenu", ""),
                        "hashtags": result.get("hashtags", []),
                    }
            except json.JSONDecodeError:
                pass

            # Si le parsing JSON échoue, retourner le texte brut
            return {
                "titre": f"Post {body.type_contenu} - {body.plateforme}",
                "contenu": response_text,
                "hashtags": ["#Klikphone", "#Chambéry"],
            }

        except Exception as e:
            print(f"Erreur API Anthropic: {e}")
            return _fallback_post_genere(body.plateforme, body.type_contenu)
    else:
        return _fallback_post_genere(body.plateforme, body.type_contenu)


def _fallback_post_genere(plateforme: str, type_contenu: str) -> dict:
    """Post généré par défaut si pas de clé API Anthropic."""
    posts = {
        "promo": {
            "titre": "Promo réparation écran iPhone",
            "contenu": (
                "📱 Écran cassé ? Pas de panique !\n\n"
                "Chez Klikphone Chambéry, on répare votre écran iPhone en moins de 30 minutes ⚡\n\n"
                "✅ Pièces de qualité\n"
                "✅ Garantie 6 mois\n"
                "✅ Sans rendez-vous\n\n"
                "Passez nous voir au centre de Chambéry ! 📍\n\n"
                "💜 Klikphone — Votre expert en réparation"
            ),
            "hashtags": ["#Klikphone", "#RéparationiPhone", "#Chambéry", "#ÉcranCassé", "#Promo"],
        },
        "temoignage": {
            "titre": "Merci à nos clients !",
            "contenu": (
                "⭐⭐⭐⭐⭐\n\n"
                "\"Service impeccable, mon téléphone est comme neuf !\" 🙏\n\n"
                "Merci à tous nos clients pour leur confiance. "
                "Votre satisfaction est notre plus belle récompense ! 💜\n\n"
                "📍 Klikphone Chambéry — 4.8/5 sur Google"
            ),
            "hashtags": ["#AvisClient", "#Klikphone", "#Chambéry", "#Satisfaction", "#5étoiles"],
        },
        "actualite": {
            "titre": "Nouveau service chez Klikphone",
            "contenu": (
                "🆕 Nouveauté chez Klikphone Chambéry !\n\n"
                "Nous proposons maintenant la réparation de tablettes et PC portables 💻\n\n"
                "Écran, batterie, connecteur... On s'occupe de tout ! ⚡\n\n"
                "📍 Venez nous voir en boutique\n"
                "💜 Klikphone — Plus qu'un réparateur"
            ),
            "hashtags": ["#Klikphone", "#NouveauService", "#Chambéry", "#Réparation", "#Tablette"],
        },
        "conseil": {
            "titre": "Conseil : protéger son écran",
            "contenu": (
                "💡 Conseil du pro !\n\n"
                "Saviez-vous qu'un film en verre trempé peut sauver votre écran en cas de chute ? 📱\n\n"
                "3 gestes simples pour protéger votre téléphone :\n"
                "1️⃣ Utilisez une coque de protection\n"
                "2️⃣ Posez un film en verre trempé\n"
                "3️⃣ Évitez les températures extrêmes\n\n"
                "Et si malgré tout... Klikphone est là ! 💪\n"
                "📍 Chambéry Centre"
            ),
            "hashtags": ["#ConseilTech", "#Klikphone", "#Protection", "#Smartphone", "#Astuce"],
        },
        "stats": {
            "titre": "Bilan du mois chez Klikphone",
            "contenu": (
                "📊 Ce mois-ci chez Klikphone Chambéry :\n\n"
                "✅ 150+ réparations réalisées\n"
                "⭐ 4.8/5 de satisfaction client\n"
                "⚡ 45 min de réparation en moyenne\n"
                "📱 iPhone, Samsung, Xiaomi, Huawei...\n\n"
                "Merci pour votre confiance ! 💜\n"
                "On continue en 2025 ! 🚀"
            ),
            "hashtags": ["#Klikphone", "#Bilan", "#Chambéry", "#Réparation", "#Stats"],
        },
    }

    result = posts.get(type_contenu, posts["promo"])
    return {
        "titre": result["titre"],
        "contenu": result["contenu"],
        "hashtags": result["hashtags"],
    }


# ═════════════════════════════════════════════════════════
# CALENDRIER MARKETING
# ═════════════════════════════════════════════════════════

@router.get("/calendrier")
def list_calendrier(
    date_debut: Optional[date] = Query(None),
    date_fin: Optional[date] = Query(None),
    type: Optional[str] = Query(None, max_length=50),
    user: dict = Depends(_require_admin_marketing),
):
    """Liste les événements du calendrier marketing."""
    _ensure_tables()
    conditions = []
    params = []

    if date_debut:
        conditions.append("date_evenement >= %s")
        params.append(date_debut)
    if date_fin:
        conditions.append("date_evenement <= %s")
        params.append(date_fin)
    if type:
        conditions.append("type = %s")
        params.append(type)

    where = ""
    if conditions:
        where = "WHERE " + " AND ".join(conditions)

    with get_cursor() as cur:
        cur.execute(
            f"SELECT * FROM calendrier_marketing {where} ORDER BY date_evenement ASC, heure ASC",
            params,
        )
        rows = cur.fetchall()

    return [_row_to_dict(r) for r in rows]


@router.post("/calendrier")
def create_calendrier(body: CalendrierCreate, user: dict = Depends(_require_admin_marketing)):
    """Crée un événement dans le calendrier marketing."""
    _ensure_tables()

    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO calendrier_marketing
                (titre, description, type, date_evenement, heure,
                 couleur, post_id, recurrent, recurrence_pattern)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (
            body.titre, body.description, body.type, body.date_evenement,
            body.heure, body.couleur or "#7C3AED", body.post_id,
            body.recurrent or False, body.recurrence_pattern,
        ))
        row = cur.fetchone()

    return _row_to_dict(row)


@router.put("/calendrier/{event_id}")
def update_calendrier(
    event_id: int,
    body: CalendrierUpdate,
    user: dict = Depends(_require_admin_marketing),
):
    """Met à jour un événement du calendrier."""
    _ensure_tables()

    with get_cursor() as cur:
        cur.execute("SELECT * FROM calendrier_marketing WHERE id = %s", (event_id,))
        existing = cur.fetchone()
        if not existing:
            raise HTTPException(404, "Événement non trouvé")

        fields = []
        params = []
        if body.titre is not None:
            fields.append("titre = %s")
            params.append(body.titre)
        if body.description is not None:
            fields.append("description = %s")
            params.append(body.description)
        if body.type is not None:
            fields.append("type = %s")
            params.append(body.type)
        if body.date_evenement is not None:
            fields.append("date_evenement = %s")
            params.append(body.date_evenement)
        if body.heure is not None:
            fields.append("heure = %s")
            params.append(body.heure)
        if body.couleur is not None:
            fields.append("couleur = %s")
            params.append(body.couleur)
        if body.post_id is not None:
            fields.append("post_id = %s")
            params.append(body.post_id)
        if body.recurrent is not None:
            fields.append("recurrent = %s")
            params.append(body.recurrent)
        if body.recurrence_pattern is not None:
            fields.append("recurrence_pattern = %s")
            params.append(body.recurrence_pattern)
        if body.completed is not None:
            fields.append("completed = %s")
            params.append(body.completed)

        if not fields:
            return _row_to_dict(existing)

        params.append(event_id)
        cur.execute(
            f"UPDATE calendrier_marketing SET {', '.join(fields)} WHERE id = %s RETURNING *",
            params,
        )
        row = cur.fetchone()

    return _row_to_dict(row)


@router.delete("/calendrier/{event_id}")
def delete_calendrier(event_id: int, user: dict = Depends(_require_admin_marketing)):
    """Supprime un événement du calendrier."""
    _ensure_tables()

    with get_cursor() as cur:
        cur.execute("SELECT id FROM calendrier_marketing WHERE id = %s", (event_id,))
        if not cur.fetchone():
            raise HTTPException(404, "Événement non trouvé")

        cur.execute("DELETE FROM calendrier_marketing WHERE id = %s", (event_id,))

    return {"status": "ok", "deleted": event_id}


# ═════════════════════════════════════════════════════════
# TEMPLATES MARKETING
# ═════════════════════════════════════════════════════════

@router.get("/templates")
def list_templates(user: dict = Depends(_require_admin_marketing)):
    """Liste tous les templates marketing actifs."""
    _ensure_tables()

    with get_cursor() as cur:
        cur.execute(
            "SELECT * FROM templates_marketing WHERE actif = TRUE ORDER BY created_at ASC"
        )
        rows = cur.fetchall()

    return [_row_to_dict(r) for r in rows]


@router.post("/templates")
def create_template(body: TemplateCreate, user: dict = Depends(_require_admin_marketing)):
    """Crée un nouveau template marketing."""
    _ensure_tables()

    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO templates_marketing
                (nom, description, plateforme, type_contenu, contenu_template,
                 hashtags_defaut, couleur, icone)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (
            body.nom, body.description, body.plateforme, body.type_contenu,
            body.contenu_template, body.hashtags_defaut,
            body.couleur or "#7C3AED", body.icone or "📝",
        ))
        row = cur.fetchone()

    return _row_to_dict(row)


@router.put("/templates/{template_id}")
def update_template(
    template_id: int,
    body: TemplateUpdate,
    user: dict = Depends(_require_admin_marketing),
):
    """Met à jour un template marketing."""
    _ensure_tables()

    with get_cursor() as cur:
        cur.execute("SELECT * FROM templates_marketing WHERE id = %s", (template_id,))
        existing = cur.fetchone()
        if not existing:
            raise HTTPException(404, "Template non trouvé")

        fields = []
        params = []
        if body.nom is not None:
            fields.append("nom = %s")
            params.append(body.nom)
        if body.description is not None:
            fields.append("description = %s")
            params.append(body.description)
        if body.plateforme is not None:
            fields.append("plateforme = %s")
            params.append(body.plateforme)
        if body.type_contenu is not None:
            fields.append("type_contenu = %s")
            params.append(body.type_contenu)
        if body.contenu_template is not None:
            fields.append("contenu_template = %s")
            params.append(body.contenu_template)
        if body.hashtags_defaut is not None:
            fields.append("hashtags_defaut = %s")
            params.append(body.hashtags_defaut)
        if body.couleur is not None:
            fields.append("couleur = %s")
            params.append(body.couleur)
        if body.icone is not None:
            fields.append("icone = %s")
            params.append(body.icone)
        if body.actif is not None:
            fields.append("actif = %s")
            params.append(body.actif)

        if not fields:
            return _row_to_dict(existing)

        params.append(template_id)
        cur.execute(
            f"UPDATE templates_marketing SET {', '.join(fields)} WHERE id = %s RETURNING *",
            params,
        )
        row = cur.fetchone()

    return _row_to_dict(row)


# ═════════════════════════════════════════════════════════
# ANALYTICS
# ═════════════════════════════════════════════════════════

@router.get("/analytics/overview")
def analytics_overview(user: dict = Depends(_require_admin_marketing)):
    """Vue d'ensemble des analytics marketing."""
    _ensure_tables()

    with get_cursor() as cur:
        # Stats des posts
        cur.execute("""
            SELECT
                COUNT(*) FILTER (WHERE statut = 'publié') as posts_publies,
                COUNT(*) FILTER (WHERE statut = 'programmé') as posts_programmes,
                COUNT(*) FILTER (WHERE statut = 'brouillon') as posts_brouillons,
                COALESCE(SUM(engagement_vues), 0) as total_vues,
                COALESCE(SUM(engagement_likes), 0) as total_likes,
                COALESCE(SUM(engagement_commentaires), 0) as total_commentaires
            FROM posts_marketing
        """)
        posts_stats = cur.fetchone()

        # Stats des avis
        cur.execute("""
            SELECT
                COUNT(*) as total_avis,
                COALESCE(AVG(note), 0) as note_moyenne,
                COUNT(*) FILTER (WHERE repondu = FALSE) as non_repondus
            FROM avis_google
        """)
        avis_stats = cur.fetchone()

    total_vues = int(posts_stats["total_vues"])
    total_likes = int(posts_stats["total_likes"])
    total_commentaires = int(posts_stats["total_commentaires"])

    return {
        "portee_totale": total_vues,
        "interactions": total_likes + total_commentaires,
        "nouveaux_abonnes": 0,
        "portee_trend": 0,
        "interactions_trend": 0,
        "abonnes_trend": 0,
        "posts_publies": posts_stats["posts_publies"],
        "posts_programmes": posts_stats["posts_programmes"],
        "posts_brouillons": posts_stats["posts_brouillons"],
        "total_avis": avis_stats["total_avis"],
        "note_moyenne_avis": round(float(avis_stats["note_moyenne"]), 2),
        "avis_non_repondus": avis_stats["non_repondus"],
    }


@router.get("/analytics/posts")
def analytics_posts(user: dict = Depends(_require_admin_marketing)):
    """Liste des posts publiés avec leurs métriques d'engagement."""
    _ensure_tables()

    with get_cursor() as cur:
        cur.execute("""
            SELECT id, titre, plateforme, type_contenu, date_publication,
                   engagement_vues, engagement_likes, engagement_commentaires,
                   hashtags
            FROM posts_marketing
            WHERE statut = 'publié'
            ORDER BY date_publication DESC
        """)
        rows = cur.fetchall()

    return [_row_to_dict(r) for r in rows]
