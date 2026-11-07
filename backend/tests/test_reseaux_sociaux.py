"""Publication Instagram / réseaux via Late (Zernio) et photos des posts — Community Manager.

Aucun appel réseau : httpx.MockTransport pour Late, base simulée pour les routes.
"""

import asyncio
import io
import json
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from PIL import Image

from app.api import auth, marketing
from app.api.auth import create_admin_token, create_token, decode_token
from app.services import reseaux_sociaux as rs

COMPTES = [
    {"_id": "acc_ig", "platform": "instagram", "username": "klikphone", "isActive": True,
     "profileId": {"_id": "prof_1", "name": "Klikphone"}},
    {"_id": "acc_li", "platform": "linkedin", "username": "KLIKPHONE", "isActive": True, "profileId": "prof_1"},
]
BASE_IMG = "https://klikphone-sav-v2-production.up.railway.app/api/marketing/images"


def _comptes():
    return [rs.normaliser_compte(a) for a in COMPTES]


def _png(w, h, alpha=False):
    img = Image.new("RGBA" if alpha else "RGB", (w, h), (200, 30, 30, 128) if alpha else (20, 120, 200))
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


class FauxLate:
    """Late simulé : enregistre les requêtes, répond selon les routes."""

    def __init__(self, reponse_post=None, comptes=None):
        self.requetes = []
        self.reponse_post = reponse_post or (201, {"message": "ok", "post": {
            "_id": "late_123", "status": "published",
            "platforms": [{"platform": "instagram", "status": "published"}]}})
        self.comptes = COMPTES if comptes is None else comptes

    def handler(self, request: httpx.Request):
        corps = json.loads(request.content) if request.content else None
        self.requetes.append((request.method, request.url.path, dict(request.url.params), corps))
        if request.url.path.endswith("/accounts"):
            return httpx.Response(200, json={"accounts": self.comptes})
        if request.url.path.endswith("/posts") and request.method == "POST":
            status, data = self.reponse_post
            return httpx.Response(status, json=data)
        if "/connect/" in request.url.path:
            return httpx.Response(200, json={"authUrl": "https://zernio.com/oauth/instagram?state=x"})
        return httpx.Response(404, json={"error": "inconnu"})

    @property
    def posts(self):
        return [r for r in self.requetes if r[0] == "POST" and r[1].endswith("/posts")]


@pytest.fixture
def late(monkeypatch):
    faux = FauxLate()
    monkeypatch.setenv("LATE_API_KEY", "cle_test")
    monkeypatch.delenv("LATE_API_BASE", raising=False)
    monkeypatch.setattr(rs, "_transport", httpx.MockTransport(faux.handler))
    return faux


# ─── Corps de publication ─────────────────────────────────────────────

def test_instagram_sans_photo_refuse_et_jamais_redirige_ailleurs():
    with pytest.raises(rs.LateErreur) as e:
        rs.corps_publication({"plateforme": "instagram", "contenu": "Hello"}, _comptes())
    assert e.value.code == "image_requise" and e.value.status == 400


def test_instagram_vise_seulement_le_compte_instagram_avec_photo_et_hashtags():
    corps, cibles = rs.corps_publication({
        "plateforme": "instagram", "titre": "Promo", "contenu": "Écran cassé ? #Chambery",
        "hashtags": ["Klikphone", "#Chambery", "#klikphone"], "image_url": f"{BASE_IMG}/abc.jpg",
    }, _comptes())
    assert corps["platforms"] == [{"platform": "instagram", "accountId": "acc_ig"}]
    assert corps["mediaItems"] == [{"type": "image", "url": f"{BASE_IMG}/abc.jpg"}]
    assert corps["publishNow"] is True and "scheduledFor" not in corps
    # Hashtag déjà dans le texte non répété, doublon (casse) retiré
    assert corps["content"] == "Écran cassé ? #Chambery\n\n#Klikphone"


def test_plateforme_non_connectee_message_clair_sans_repli():
    with pytest.raises(rs.LateErreur) as e:
        rs.corps_publication({"plateforme": "google", "contenu": "Avis"}, _comptes())
    assert e.value.code == "compte_absent"
    assert "Instagram (@klikphone)" in e.value.message and "LinkedIn" in e.value.message


def test_compte_inactif_ignore():
    comptes = [dict(c, isActive=False) if c["platform"] == "instagram" else c for c in _comptes()]
    with pytest.raises(rs.LateErreur):
        rs.corps_publication({"plateforme": "instagram", "contenu": "x", "image_url": "https://a/b.jpg"}, comptes)


def test_programmation_heure_de_paris():
    quand = datetime(2026, 11, 20, 10, 30)
    corps, _ = rs.corps_publication({"plateforme": "linkedin", "contenu": "x"}, _comptes(), programme_le=quand)
    assert corps["scheduledFor"] == "2026-11-20T10:30:00" and corps["timezone"] == "Europe/Paris"
    assert "publishNow" not in corps
    avec_fuseau = datetime(2026, 11, 20, 9, 30, tzinfo=timezone.utc)
    corps, _ = rs.corps_publication({"plateforme": "linkedin", "contenu": "x"}, _comptes(), programme_le=avec_fuseau)
    assert corps["scheduledFor"] == "2026-11-20T09:30:00+00:00" and "timezone" not in corps


def test_legende_instagram_trop_longue():
    with pytest.raises(rs.LateErreur) as e:
        rs.corps_publication({"plateforme": "instagram", "contenu": "a" * 2300, "image_url": "https://a/b.jpg"},
                             _comptes())
    assert e.value.code == "trop_long"


# ─── Réponses de Late ─────────────────────────────────────────────────

def test_lecture_201_identifiant_dans_post():
    resp = httpx.Response(201, json={"post": {"_id": "p1", "status": "published",
                                              "platforms": [{"platform": "instagram", "status": "published"}]}})
    r = rs.lire_publication(resp, "instagram")
    assert r["external_id"] == "p1" and r["publies"] == ["instagram"] and r["avertissements"] == []


def test_lecture_207_echec_total_leve_une_erreur():
    resp = httpx.Response(207, json={"post": {"_id": "p1"}, "error": "All platforms failed",
                                     "platformResults": [{"platform": "instagram", "status": "failed",
                                                          "error": "Media aspect ratio invalid"}]})
    with pytest.raises(rs.LateErreur) as e:
        rs.lire_publication(resp, "instagram")
    assert "Media aspect ratio invalid" in e.value.message


def test_lecture_207_partiel_avertit():
    resp = httpx.Response(207, json={"post": {"_id": "p1"}, "platformResults": [
        {"platform": "instagram", "status": "published"},
        {"platform": "linkedin", "status": "failed", "error": "token expired"}]})
    r = rs.lire_publication(resp, "instagram")
    assert r["publies"] == ["instagram"] and "token expired" in r["avertissements"][0]


@pytest.mark.parametrize("status, corps, attendu", [
    (403, {"code": "ACCOUNT_DISCONNECTED", "error": "x"}, "Reconnecter"),
    (409, {"error": "duplicate"}, "doublons"),
    (401, {"code": "invalid_credentials"}, "LATE_API_KEY"),
    (429, {}, "quelques minutes"),
])
def test_erreurs_traduites(status, corps, attendu):
    e = rs.erreur_reponse(httpx.Response(status, json=corps), "instagram")
    assert attendu in e.message


# ─── Client HTTP ──────────────────────────────────────────────────────

def test_requete_passe_au_domaine_zernio_si_getlate_disparait(monkeypatch):
    vus = []

    def handler(request):
        vus.append(request.url.host)
        if request.url.host == "getlate.dev":
            return httpx.Response(404, text="Not found")
        assert request.headers["Authorization"] == "Bearer cle_test"
        return httpx.Response(200, json={"accounts": COMPTES})

    monkeypatch.setenv("LATE_API_KEY", "cle_test")
    monkeypatch.delenv("LATE_API_BASE", raising=False)
    monkeypatch.setattr(rs, "_transport", httpx.MockTransport(handler))
    liste = asyncio.run(rs.comptes())
    assert vus == ["getlate.dev", "zernio.com"]
    assert [c["plateforme"] for c in liste] == ["instagram", "linkedin"]
    assert liste[0]["profileId"] == "prof_1"


def test_delai_depasse_jamais_rejoue(monkeypatch):
    vus = []

    def handler(request):
        vus.append(request.url.host)
        raise httpx.ReadTimeout("lent", request=request)

    monkeypatch.setenv("LATE_API_KEY", "cle_test")
    monkeypatch.setattr(rs, "_transport", httpx.MockTransport(handler))
    with pytest.raises(rs.LateErreur) as e:
        asyncio.run(rs.requete("POST", "/posts", json={}))
    assert e.value.code == "delai" and vus == ["getlate.dev"]


def test_sans_cle_message_railway(monkeypatch):
    monkeypatch.delenv("LATE_API_KEY", raising=False)
    monkeypatch.delenv("ZERNIO_API_KEY", raising=False)
    with pytest.raises(rs.LateErreur) as e:
        asyncio.run(rs.comptes())
    assert "LATE_API_KEY" in e.value.message


def test_lien_connexion_instagram(late):
    url = asyncio.run(rs.lien_connexion("instagram", "https://kp.example/tech/community?connexion=late", _comptes()))
    assert url.startswith("https://zernio.com/oauth/instagram")
    methode, chemin, params, _ = late.requetes[-1]
    assert chemin.endswith("/connect/instagram")
    assert params == {"profileId": "prof_1", "redirect_url": "https://kp.example/tech/community?connexion=late"}


# ─── Images ───────────────────────────────────────────────────────────

def test_photo_trop_haute_recadree_en_4_5_jpeg_fond_blanc():
    jpeg, w, h = rs.preparer_image(_png(600, 1200, alpha=True))
    assert jpeg[:3] == b"\xff\xd8\xff" and (w, h) == (600, 750)
    assert Image.open(io.BytesIO(jpeg)).mode == "RGB"


def test_photo_trop_large_recadree_et_reduite():
    jpeg, w, h = rs.preparer_image(_png(4000, 1000))
    assert w <= 1440 and abs(w / h - 1.91) < 0.01


def test_photo_carree_gardee():
    _jpeg, w, h = rs.preparer_image(_png(1080, 1080))
    assert (w, h) == (1080, 1080)


@pytest.mark.parametrize("contenu", [b"\x00" * 50, b"pas une image" * 20, b"\x00\x00\x00\x18ftypheic" + b"\x00" * 200])
def test_image_illisible_refusee(contenu):
    with pytest.raises(ValueError):
        rs.preparer_image(contenu)


# ─── Routes (base simulée, admin prouvé) ──────────────────────────────

class FausseBase:
    def __init__(self, post=None, images=None):
        self.role, self.prouve = "admin", True
        self.post = post
        self.images = dict(images or {})
        self.ecritures = []

    @contextmanager
    def get_cursor(self, *a, **k):
        base = self

        class Cur:
            rowcount = 1
            _r = None

            def execute(self, sql, params=None):
                sql = " ".join(str(sql).split())
                self._r = None
                if "FROM membres_equipe" in sql:
                    self._r = {"role": base.role, "prouve": base.prouve, "a_prolonger": False}
                elif sql.startswith("SELECT * FROM posts_marketing WHERE id"):
                    self._r = dict(base.post) if base.post else None
                elif sql.startswith("SELECT 1 FROM marketing_images"):
                    self._r = {"x": 1} if params[0] in base.images else None
                elif sql.startswith("SELECT data, mime FROM marketing_images"):
                    img = base.images.get(params[0])
                    self._r = {"data": img, "mime": "image/jpeg"} if img else None
                elif sql.startswith("INSERT INTO marketing_images"):
                    base.images[params[0]] = params[1]
                    base.ecritures.append(("image", params))
                elif sql.startswith("UPDATE posts_marketing"):
                    base.ecritures.append((sql, params))
                    self._r = dict(base.post, statut="publié" if "'publié'" in sql else "programmé",
                                   external_post_id=params[-2])

            def fetchone(self):
                return self._r

            def fetchall(self):
                return [self._r] if self._r else []

        yield Cur()


@pytest.fixture
def base(monkeypatch):
    b = FausseBase()
    monkeypatch.setattr(auth, "get_cursor", b.get_cursor)
    monkeypatch.setattr(marketing, "get_cursor", b.get_cursor)
    monkeypatch.setattr(marketing, "_tables_checked", True)
    return b


def _admin():
    tok = create_token("accueil", "Pytest Admin")
    return {"Authorization": f"Bearer {tok}", "X-Admin-Token": create_admin_token(decode_token(tok))}


def _post(**k):
    return {"id": 7, "titre": "Promo écran", "contenu": "Écran cassé ?", "plateforme": "instagram",
            "statut": "brouillon", "hashtags": ["Klikphone"], "image_url": f"{BASE_IMG}/{'a' * 32}.jpg", **k}


def test_route_publier_instagram(client, base, late):
    base.post, base.images = _post(), {"a" * 32: b"jpeg"}
    r = client.post("/api/marketing/posts/7/publier", headers=_admin())
    assert r.status_code == 200, r.text
    assert r.json()["platforms_published"] == ["instagram"]
    (_, _, _, corps), = late.posts
    assert corps["platforms"] == [{"platform": "instagram", "accountId": "acc_ig"}]
    sql, params = base.ecritures[-1]
    assert "'publié'" in sql and params == ("late_123", 7)


def test_route_publier_instagram_sans_photo_aucun_envoi(client, base, late):
    base.post = _post(image_url=None)
    r = client.post("/api/marketing/posts/7/publier", headers=_admin())
    assert r.status_code == 400 and "photo" in r.json()["detail"]
    assert late.posts == [] and base.ecritures == []


def test_route_publier_photo_perdue(client, base, late):
    base.post = _post(image_url=f"{BASE_IMG}/abcd1234-ab1.png")  # ancienne image en mémoire, perdue
    r = client.post("/api/marketing/posts/7/publier", headers=_admin())
    assert r.status_code == 400 and "remettez une photo" in r.json()["detail"]
    assert late.requetes == []


def test_route_publier_deja_publie(client, base, late):
    base.post = _post(statut="publié")
    assert client.post("/api/marketing/posts/7/publier", headers=_admin()).status_code == 400
    assert late.requetes == []


def test_route_programmer(client, base, late):
    base.post, base.images = _post(plateforme="linkedin", image_url=None), {}
    passe = (datetime.now() - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:00")
    r = client.post("/api/marketing/posts/7/programmer", headers=_admin(), json={"date_programmee": passe})
    assert r.status_code == 400 and late.posts == []
    futur = (datetime.now() + timedelta(days=2)).strftime("%Y-%m-%dT10:00:00")
    r = client.post("/api/marketing/posts/7/programmer", headers=_admin(), json={"date_programmee": futur})
    assert r.status_code == 200, r.text
    (_, _, _, corps), = late.posts
    assert corps["scheduledFor"] == futur and corps["timezone"] == "Europe/Paris"
    sql, params = base.ecritures[-1]
    assert "'programmé'" in sql and params[1] == "late_123"


def test_route_erreur_late_lisible(client, base, late):
    base.post, base.images = _post(), {"a" * 32: b"jpeg"}
    late.reponse_post = (403, {"code": "ACCOUNT_DISCONNECTED", "error": "Token expired"})
    r = client.post("/api/marketing/posts/7/publier", headers=_admin())
    assert r.status_code == 409 and "Reconnecter" in r.json()["detail"]
    assert base.ecritures == []


def test_route_comptes_et_connexion(client, base, late):
    r = client.get("/api/marketing/late/accounts", headers=_admin())
    assert r.status_code == 200 and [c["plateforme"] for c in r.json()] == ["instagram", "linkedin"]
    r = client.get("/api/marketing/late/connect/instagram?retour=/accueil/community", headers=_admin())
    assert r.status_code == 200 and r.json()["url"].startswith("https://zernio.com/")
    redirection = late.requetes[-1][2]["redirect_url"]
    assert redirection.endswith("/accueil/community?connexion=late")
    # Retour hors Community Manager : ramené sur la page par défaut
    client.get("/api/marketing/late/connect/instagram?retour=https://evil.example", headers=_admin())
    assert late.requetes[-1][2]["redirect_url"].endswith("/tech/community?connexion=late")


@pytest.mark.parametrize("role, prouve", [("Technicien", True), ("admin", False)])
def test_routes_marketing_sans_admin_refusees(client, base, late, role, prouve):
    base.role, base.prouve, base.post = role, prouve, _post()
    tok = create_token("accueil", "Pytest Membre")
    for methode, chemin in (("post", "/api/marketing/posts/7/publier"), ("get", "/api/marketing/late/accounts"),
                            ("get", "/api/marketing/late/connect/instagram")):
        r = client.request(methode.upper(), chemin, headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 403, (chemin, r.text)
    assert late.requetes == [] and base.ecritures == []


def test_envoi_photo_puis_service_public(client, base):
    r = client.post("/api/marketing/images", headers=_admin(),
                    files={"fichier": ("photo.png", _png(900, 1600), "image/png")})
    assert r.status_code == 200, r.text
    url = r.json()["image_url"]
    assert url.endswith(".jpg") and (r.json()["largeur"], r.json()["hauteur"]) == (900, 1125)
    image_id = url.rsplit("/", 1)[1].split(".")[0]
    servie = client.get(f"/api/marketing/images/{image_id}.jpg")  # sans jeton : Late / Instagram
    assert servie.status_code == 200 and servie.headers["content-type"] == "image/jpeg"
    assert servie.content[:3] == b"\xff\xd8\xff"
    assert client.get("/api/marketing/images/" + "f" * 32 + ".jpg").status_code == 404
    assert client.get("/api/marketing/images/..%2Fetc.jpg").status_code == 404


def test_envoi_photo_illisible(client, base):
    r = client.post("/api/marketing/images", headers=_admin(),
                    files={"fichier": ("x.jpg", b"pas une image" * 30, "image/jpeg")})
    assert r.status_code == 400 and base.images == {}


def test_generation_ia_en_tache_de_fond(monkeypatch, base):
    async def horde(prompt):
        return _png(1024, 1024)

    monkeypatch.delenv("TOGETHER_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(marketing, "_generate_with_horde", horde)
    marketing._GENERATIONS["job1"] = {"statut": "en_cours", "debut": 0, "fin": None}
    asyncio.run(marketing._travail_generation("job1", "un iPhone", "Pytest"))
    job = marketing._GENERATIONS.pop("job1")
    assert job["statut"] == "termine" and job["provider"] == "horde" and job["image_url"].endswith(".jpg")


def test_generation_ia_echec_explique(monkeypatch, base):
    async def together(prompt):
        raise ValueError("crédit épuisé")

    async def horde(prompt):
        raise TimeoutError("pas d'image après 6 min")

    monkeypatch.setenv("TOGETHER_API_KEY", "x")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(marketing, "_generate_with_together", together)
    monkeypatch.setattr(marketing, "_generate_with_horde", horde)
    marketing._GENERATIONS["job2"] = {"statut": "en_cours", "debut": 0, "fin": None}
    asyncio.run(marketing._travail_generation("job2", "un iPhone", "Pytest"))
    job = marketing._GENERATIONS.pop("job2")
    assert job["statut"] == "erreur"
    assert "crédit épuisé" in job["erreur"] and "6 min" in job["erreur"] and "votre propre photo" in job["erreur"]


def test_suivi_generation(client, base):
    marketing._GENERATIONS["job3"] = {"statut": "termine", "image_url": "https://x/y.jpg", "erreur": None,
                                      "provider": "horde", "debut": 100.0, "fin": 145.0}
    try:
        r = client.get("/api/marketing/posts/generer-image/job3", headers=_admin())
        assert r.status_code == 200 and r.json()["statut"] == "termine" and r.json()["secondes"] == 45
        assert client.get("/api/marketing/posts/generer-image/inconnu", headers=_admin()).status_code == 404
    finally:
        marketing._GENERATIONS.pop("job3", None)
