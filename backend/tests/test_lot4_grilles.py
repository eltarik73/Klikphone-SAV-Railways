"""Lot 4 : grilles de prix, ventes iPhone / smartphones, catalogue téléphones.

Base simulée (conftest) : aucun accès PostgreSQL.
- PDF et ZIP des grilles : jeton exigé, rendu mis en cache par empreinte des lignes ;
- /api/iphones (écriture, vidéo) et l'envoi de photo iphone-tarifs : rôle admin + code ;
- bornes des formulaires (passer-commande public, stock iPhone) : 422 au lieu de 500 ;
- modèles Pydantic sans conflit d'espace de noms « model_ » (avertissement en Pydantic 2.9) ;
- catalogue téléphones : « reconditionné » ramené à « occasion », identifiants restés entiers.
"""

from contextlib import contextmanager
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

from app.api import iphone_tarifs, iphones_stock, smartphones_tarifs, telephones
from app.api.auth import create_token
from app.main import app


def _h(role="tech", nom="Pytest Tech Lot4"):
    return {"Authorization": f"Bearer {create_token(role, nom)}"}


@pytest.fixture(autouse=True)
def _cache_pdf_vide():
    cache = getattr(smartphones_tarifs, "_PDF_CACHE", {})
    cache.clear()
    yield
    cache.clear()


# ═══ PDF / ZIP des grilles ═════════════════════════════════════

@pytest.mark.parametrize("path", [
    "/api/iphone-tarifs/pdf",
    "/api/iphone-tarifs/pdf/all-zip",
    "/api/smartphones-tarifs/pdf",
])
def test_pdf_des_grilles_exigent_un_jeton(client, path):
    assert client.get(path).status_code == 401


def test_pdf_iphone_en_cache_tant_que_la_grille_ne_change_pas(client):
    modeles = [{"slug": "iphone-13", "modele": "iPhone 13"}]
    empreinte = {"v": "a"}
    with patch.object(iphone_tarifs, "_get_models", return_value=modeles), \
         patch.object(iphone_tarifs, "_empreinte_iphones", side_effect=lambda: empreinte["v"]), \
         patch.object(iphone_tarifs, "_render_pdf", return_value=b"%PDF-1") as rendu:
        for _ in range(3):
            r = client.get("/api/iphone-tarifs/pdf?slugs=iphone-13", headers=_h())
            assert r.status_code == 200 and r.content == b"%PDF-1"
        assert rendu.call_count == 1
        # Autre sélection : rendu distinct
        assert client.get("/api/iphone-tarifs/pdf", headers=_h()).status_code == 200
        assert rendu.call_count == 2
        # Grille modifiée (prix, stock, photo…) : nouvelle empreinte, nouveau rendu
        empreinte["v"] = "b"
        client.get("/api/iphone-tarifs/pdf?slugs=iphone-13", headers=_h())
        assert rendu.call_count == 3


def test_zip_iphone_en_cache(client):
    @contextmanager
    def cur_groupes():
        cur = MagicMock()
        cur.fetchall.return_value = [{"page_group": "13"}, {"page_group": "14"}]
        yield cur

    with patch.object(iphone_tarifs, "get_cursor", cur_groupes), \
         patch.object(iphone_tarifs, "_get_models", return_value=[{"slug": "x", "modele": "X"}]), \
         patch.object(iphone_tarifs, "_empreinte_iphones", return_value="a"), \
         patch.object(iphone_tarifs, "_render_pdf", return_value=b"%PDF-1") as rendu:
        r1 = client.get("/api/iphone-tarifs/pdf/all-zip", headers=_h())
        r2 = client.get("/api/iphone-tarifs/pdf/all-zip", headers=_h())
    assert r1.status_code == r2.status_code == 200
    assert r1.content == r2.content and r1.content[:2] == b"PK"
    assert rendu.call_count == 2  # un PDF par groupe, une seule fois


def test_pdf_smartphones_en_cache(client):
    phones = [{"id": 1, "marque": "Samsung", "modele": "Galaxy A55"}]
    with patch.object(smartphones_tarifs, "_phones_pour_pdf", return_value=phones) as lecture, \
         patch.object(smartphones_tarifs, "_empreinte_smartphones", return_value="a"), \
         patch.object(smartphones_tarifs, "_render_smartphones_pdf", return_value=b"%PDF-1") as rendu:
        for _ in range(3):
            r = client.get("/api/smartphones-tarifs/pdf?ids=1", headers=_h())
            assert r.status_code == 200 and r.content == b"%PDF-1"
    assert rendu.call_count == 1 and lecture.call_count == 1


def test_cache_pdf_borne_en_taille():
    for i in range(smartphones_tarifs._PDF_CACHE_MAX + 10):
        smartphones_tarifs.pdf_en_cache(("t", i), "e", lambda: b"x")
    assert len(smartphones_tarifs._PDF_CACHE) <= smartphones_tarifs._PDF_CACHE_MAX


# ═══ Écritures réservées au rôle admin ═════════════════════════

@pytest.mark.parametrize("method,path,body", [
    ("POST", "/api/iphones", {"model": "iPhone 13", "model_key": "iphone-13", "storage": "128 Go",
                              "color_name": "Noir", "condition": "Neuf", "price": 499}),
    ("PUT", "/api/iphones/3", {"price": 1, "stock": 99}),
    ("DELETE", "/api/iphones/2", None),
    ("POST", "/api/iphones/generate-video", {"ids": ["it_1_1"]}),
])
def test_stock_iphones_ecriture_refusee_sans_role_admin(client, method, path, body):
    r = client.request(method, path, json=body, headers=_h())
    assert r.status_code == 403, (method, path, r.status_code)


def test_upload_image_iphone_refusee_sans_role_admin(client):
    r = client.post("/api/iphone-tarifs/1/upload-image", headers=_h(),
                    files={"file": ("p.png", b"\x89PNG" + b"0" * 400, "image/png")})
    assert r.status_code == 403


# ═══ Bornes des formulaires ════════════════════════════════════

def test_passer_commande_refuse_les_champs_geants(client):
    long = "x" * 100_000
    r = client.post("/api/iphone-tarifs/passer-commande",
                    json={"nom": long, "telephone": "06" + "1" * 99_998, "modele": long})
    assert r.status_code == 422


@pytest.mark.parametrize("prix", [10 ** 12, -1, 100_001])
def test_passer_commande_refuse_un_prix_hors_bornes(client, prix):
    r = client.post("/api/iphone-tarifs/passer-commande",
                    json={"nom": "Test Lot", "telephone": "0600000001", "modele": "iPhone 13", "prix": prix})
    assert r.status_code == 422


@pytest.fixture
def admin_iphones():
    app.dependency_overrides[iphones_stock._admin] = lambda: {"sub": "Pytest", "role": "admin"}
    yield
    app.dependency_overrides.pop(iphones_stock._admin, None)


_IPHONE_OK = {"model": "iPhone 13", "model_key": "iphone-13", "storage": "128 Go",
              "color_name": "Noir", "condition": "Neuf", "price": 499}


@pytest.mark.parametrize("champ,valeur", [
    ("storage", "1" * 21),
    ("color_hex", "#" * 11),
    ("condition", "c" * 31),
    ("model_key", "k" * 51),
    ("price", -2147483649),
    ("price", 10 ** 6),
    ("stock", 2 ** 31),
    ("old_price", -1),
])
def test_stock_iphone_bornes_creation(client, admin_iphones, champ, valeur):
    r = client.post("/api/iphones", json={**_IPHONE_OK, champ: valeur}, headers=_h())
    assert r.status_code == 422, (champ, r.status_code)


@pytest.mark.parametrize("champ,valeur", [("storage", "1" * 21), ("price", -5), ("condition", "c" * 31)])
def test_stock_iphone_bornes_modification(client, admin_iphones, champ, valeur):
    r = client.put("/api/iphones/3", json={champ: valeur}, headers=_h())
    assert r.status_code == 422, (champ, r.status_code)


def test_modeles_iphone_sans_conflit_espace_de_noms_model():
    # Pydantic 2.9 (prod) avertit pour model_key sans ce réglage
    for modele in (iphones_stock.IphoneCreate, iphones_stock.IphoneUpdate):
        assert modele.model_config.get("protected_namespaces") == ()


# ═══ Catalogue téléphones ══════════════════════════════════════

def test_catalogue_reconditionne_ramene_a_occasion(monkeypatch):
    executees = []

    @contextmanager
    def cur_espion():
        cur = MagicMock()
        cur.execute.side_effect = lambda sql, *a: executees.append(" ".join(str(sql).split()))
        yield cur

    monkeypatch.setattr(telephones, "get_cursor", cur_espion)
    monkeypatch.setattr(telephones, "_table_checked", False)
    telephones._ensure_table()
    migrations = [s for s in executees if s.startswith("UPDATE telephones_catalogue")]
    assert migrations, "aucune migration des valeurs de type_produit"
    assert "SET type_produit = 'occasion'" in migrations[0]
    assert "'neuf'" in migrations[0] and "'occasion'" in migrations[0]


def test_catalogue_identifiants_restent_entiers():
    d = telephones._row_to_dict({"id": 2724, "stock_fournisseur": 3, "prix_vente": Decimal("199.90"),
                                 "en_stock": True})
    assert d == {"id": 2724, "stock_fournisseur": 3, "prix_vente": 199.9, "en_stock": True}
    assert isinstance(d["id"], int) and isinstance(d["en_stock"], bool)
