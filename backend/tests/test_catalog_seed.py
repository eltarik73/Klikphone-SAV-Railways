"""Tests du catalogue marques/modèles : données du seed et logique sans base."""

from contextlib import contextmanager
from unittest.mock import MagicMock

import pytest

from app.api import catalog
from app.api.catalog import CATEGORIES, assemble_tree, clear_catalog_cache, get_categories
from app.data import catalog_seed as seed
from app.services import catalog_seed as seed_service

ANNEE_MIN, ANNEE_MAX = 2010, 2027


def _propre(nom):
    return isinstance(nom, str) and nom == " ".join(nom.split()) and nom != ""


# ── Données du seed ─────────────────────────────────────

def test_seed_version():
    assert isinstance(seed.SEED_VERSION, str) and seed.SEED_VERSION.strip()


def test_marques_structure():
    categories = get_categories()
    vus = set()
    for item in seed.MARQUES:
        assert isinstance(item, tuple) and len(item) == 3, item
        categorie, marque, ordre = item
        assert categorie in categories, item
        assert _propre(marque) and len(marque) <= 80, item
        assert marque.lower() != "autre", item
        assert isinstance(ordre, int) and not isinstance(ordre, bool), item
        cle = (categorie, marque.lower())
        assert cle not in vus, f"marque en double : {item}"
        vus.add(cle)


def test_modeles_structure():
    categories = get_categories()
    marques = {(c, m) for c, m, _ in seed.MARQUES}
    assert isinstance(seed.MODELES, dict) and seed.MODELES
    cles_vues = set()
    for cle, modeles in seed.MODELES.items():
        assert isinstance(cle, tuple) and len(cle) == 2, cle
        categorie, marque = cle
        assert categorie in categories, cle
        assert cle in marques, f"{cle} absente de MARQUES (même casse attendue)"
        assert (categorie, marque.lower()) not in cles_vues, f"clé en double : {cle}"
        cles_vues.add((categorie, marque.lower()))
        assert isinstance(modeles, list) and modeles, cle

        vus = set()
        for item in modeles:
            assert isinstance(item, tuple) and len(item) == 2, (cle, item)
            modele, annee = item
            assert _propre(modele), (cle, item)
            assert len(modele) <= 80, (cle, item)
            assert modele.lower() != "autre", (cle, item)
            assert isinstance(annee, int) and not isinstance(annee, bool), (cle, item)
            assert ANNEE_MIN <= annee <= ANNEE_MAX, (cle, item)
            assert modele.lower() not in vus, f"modèle en double : {cle} {modele}"
            vus.add(modele.lower())


def test_apple_et_samsung_presents():
    assert seed.MODELES.get(("Smartphone", "Apple"))
    assert seed.MODELES.get(("Smartphone", "Samsung"))


def test_renames():
    marques = {(c, m) for c, m, _ in seed.MARQUES}
    for item in seed.RENAMES:
        assert isinstance(item, tuple) and len(item) == 4, item
        categorie, marque, ancien, nouveau = item
        assert (categorie, marque) in marques, item
        assert _propre(ancien) and _propre(nouveau), item
        assert len(nouveau) <= 80 and nouveau.lower() != "autre", item
        assert ancien != nouveau, item
        noms = {m.lower() for m, _ in seed.MODELES.get((categorie, marque), [])}
        if ancien.lower() != nouveau.lower():
            # sinon le seed renommerait la ligne puis réinsérerait l'ancien nom
            assert ancien.lower() not in noms, item


def test_rows_coherent():
    lignes = list(seed.rows())
    assert len(lignes) == sum(len(v) for v in seed.MODELES.values())
    attendu = [
        (categorie, marque, modele, annee, (i + 1) * 10)
        for (categorie, marque), modeles in seed.MODELES.items()
        for i, (modele, annee) in enumerate(modeles)
    ]
    assert lignes == attendu


def test_prepare_seed_sans_perte():
    marques, modeles, renames = seed_service.prepare_seed()
    assert len(marques) == len(seed.MARQUES)
    assert len(modeles) == len(list(seed.rows()))
    assert len(renames) == len(seed.RENAMES)


def test_seed_marker_stable():
    marker = seed_service.seed_marker()
    assert marker.startswith(seed.SEED_VERSION + "#")
    assert marker == seed_service.seed_marker()


# ── Service de seed (base simulée) ──────────────────────

def _fake_seed_cursor(monkeypatch, valeur, index_existants):
    cur = MagicMock()
    cur.fetchone.return_value = {"valeur": valeur} if valeur else None
    cur.fetchall.return_value = [{"indexname": nom} for nom in index_existants]
    appels = []

    @contextmanager
    def fake_cursor():
        appels.append(1)
        yield cur

    monkeypatch.setattr(seed_service, "get_cursor", fake_cursor)
    return cur, appels


def _sql_executes(cur):
    return [c.args[0] for c in cur.execute.call_args_list]


def test_seed_catalog_deja_applique(monkeypatch):
    noms = [nom for nom, _ in seed_service._UNIQUE_INDEXES]
    cur, appels = _fake_seed_cursor(monkeypatch, seed_service.seed_marker(), noms)
    assert seed_service.seed_catalog() is False
    # params + pg_indexes, aucun CREATE INDEX quand les index existent
    assert len(appels) == 2
    assert cur.execute.call_count == 2
    assert not any("CREATE" in sql for sql in _sql_executes(cur))


def test_seed_catalog_recree_index_manquant(monkeypatch):
    cur, _ = _fake_seed_cursor(monkeypatch, seed_service.seed_marker(), ["uq_catalog_marques_ci"])
    assert seed_service.seed_catalog() is False
    sqls = _sql_executes(cur)
    creates = [i for i, sql in enumerate(sqls) if "CREATE UNIQUE INDEX" in sql]
    assert len(creates) == 1 and "uq_catalog_modeles_ci" in sqls[creates[0]]
    assert "pg_advisory_xact_lock" in sqls[creates[0] - 1]


def test_seed_catalog_attend_le_verrou(monkeypatch):
    cur, _ = _fake_seed_cursor(monkeypatch, None, [])
    monkeypatch.setattr(seed_service, "execute_values", lambda *a, **k: [])
    assert seed_service.seed_catalog() is True
    sqls = _sql_executes(cur)
    verrou = next(i for i, sql in enumerate(sqls) if "pg_advisory_xact_lock" in sql)
    assert sqls[verrou - 1] == "SET LOCAL lock_timeout = 0"
    assert sum("CREATE UNIQUE INDEX" in sql for sql in sqls) == 2


# ── Arbre du catalogue ──────────────────────────────────

def test_assemble_tree_tri_et_filtres():
    marques = [
        {"marque": "Samsung", "ordre": 20, "actif": True},
        {"marque": "Apple", "ordre": 10, "actif": True},
        {"marque": "Nokia", "ordre": 5, "actif": False},
        {"marque": "Google", "ordre": 30, "actif": True},
    ]
    modeles = [
        {"marque": "Apple", "modele": "iPhone 17 Pro", "annee": 2025},
        {"marque": "apple", "modele": "iPhone 17 PRO", "annee": 2025},
        {"marque": "Samsung", "modele": "Galaxy S25", "annee": 2025},
        {"marque": "Nokia", "modele": "3310", "annee": 2017},
        {"marque": "Fairphone", "modele": "Fairphone 5", "annee": 2023},
        {"marque": "Apple", "modele": "iPhone 16", "annee": 2024},
    ]
    arbre = assemble_tree(marques, modeles)
    assert [e["marque"] for e in arbre] == ["Apple", "Samsung", "Google", "Fairphone"]
    assert arbre[0]["modeles"] == [
        {"m": "iPhone 17 Pro", "a": 2025},
        {"m": "iPhone 16", "a": 2024},
    ]
    assert arbre[2]["modeles"] == []


def _fake_catalog_cursor(marques, modeles, compteur):
    @contextmanager
    def fake_cursor():
        compteur.append(1)
        cur = MagicMock()
        resultats = []
        cur.execute.side_effect = lambda sql, params=None: resultats.append(
            marques if "FROM catalog_marques" in sql else modeles
        )
        cur.fetchall.side_effect = lambda: resultats[-1]
        yield cur
    return fake_cursor


def test_tree_endpoint_et_cache(client, monkeypatch):
    compteur = []
    monkeypatch.setattr(catalog, "get_cursor", _fake_catalog_cursor(
        [{"marque": "Apple", "ordre": 10, "actif": True}],
        [{"marque": "Apple", "modele": "iPhone 17 Pro Max", "annee": 2025}],
        compteur,
    ))
    clear_catalog_cache()
    try:
        r = client.get("/api/catalog/tree?categorie=Smartphone")
        assert r.status_code == 200
        assert r.headers["cache-control"] == "no-cache"
        assert r.json() == {
            "version": seed.SEED_VERSION,
            "marques": [{"marque": "Apple", "modeles": [{"m": "iPhone 17 Pro Max", "a": 2025}]}],
        }
        etag = r.headers["etag"]
        r304 = client.get("/api/catalog/tree?categorie=Smartphone", headers={"If-None-Match": f"W/{etag}"})
        assert r304.status_code == 304 and r304.content == b""
        assert r304.headers["etag"] == etag
        autre = client.get("/api/catalog/tree?categorie=Smartphone", headers={"If-None-Match": '"perime"'})
        assert autre.status_code == 200 and autre.json()["marques"]
        assert client.get("/api/catalog/marques?categorie=Smartphone").json() == ["Apple"]
        assert client.get("/api/catalog/modeles?categorie=Smartphone&marque=apple").json() == ["iPhone 17 Pro Max"]
        assert len(compteur) == 1

        clear_catalog_cache()
        client.get("/api/catalog/marques?categorie=Smartphone")
        assert len(compteur) == 2
    finally:
        clear_catalog_cache()


def test_categorie_inconnue_sans_bd(client, monkeypatch):
    compteur = []
    monkeypatch.setattr(catalog, "get_cursor", _fake_catalog_cursor([], [], compteur))
    clear_catalog_cache()
    for i in range(3):
        r = client.get(f"/api/catalog/tree?categorie=x{i}")
        assert r.status_code == 200
        assert r.json() == {"version": seed.SEED_VERSION, "marques": []}
    assert client.get("/api/catalog/marques?categorie=x9").json() == []
    assert client.get("/api/catalog/modeles?categorie=x9&marque=Apple").json() == []
    assert compteur == []


def _inserts_modele(client, auth_headers, monkeypatch, params):
    cur = MagicMock()
    cur.fetchone.return_value = {"id": 1, "marque": "Apple", "actif": True}
    cur.rowcount = 0

    @contextmanager
    def fake_cursor():
        yield cur

    monkeypatch.setattr(catalog, "get_cursor", fake_cursor)
    r = client.post("/api/catalog/modeles", params=params, headers=auth_headers)
    inserts = [c.args[1] for c in cur.execute.call_args_list if "INSERT INTO catalog_modeles" in c.args[0]]
    return r, inserts


def test_add_modele_annee_optionnelle(client, auth_headers, monkeypatch):
    base = {"categorie": "Smartphone", "marque": "apple", "modele": "iPhone 6"}
    r, inserts = _inserts_modele(client, auth_headers, monkeypatch, base)
    assert r.status_code == 200
    assert inserts == [("Smartphone", "Apple", "iPhone 6", None)]

    r, inserts = _inserts_modele(client, auth_headers, monkeypatch, {**base, "annee": 2014})
    assert r.status_code == 200
    assert inserts == [("Smartphone", "Apple", "iPhone 6", 2014)]

    r, _ = _inserts_modele(client, auth_headers, monkeypatch, {**base, "annee": 1800})
    assert r.status_code == 422


# ── Écritures : validation ──────────────────────────────

@pytest.mark.parametrize("modele", ["Autre", "  autre ", "x" * 81, "   "])
def test_add_modele_refuse(client, auth_headers, modele):
    r = client.post(
        "/api/catalog/modeles",
        params={"categorie": "Smartphone", "marque": "Apple", "modele": modele},
        headers=auth_headers,
    )
    assert r.status_code == 400


def test_add_modele_exige_auth(client):
    r = client.post("/api/catalog/modeles", params={"categorie": "Smartphone", "marque": "Apple", "modele": "iPhone 17"})
    assert r.status_code == 401


def test_bulk_trop_de_modeles(client, auth_headers):
    r = client.post(
        "/api/catalog/modeles/bulk",
        json={"categorie": "Smartphone", "marque": "Apple", "annee": 2025, "modeles": ["m"] * 501},
        headers=auth_headers,
    )
    assert r.status_code == 422


def test_bulk_normalise_et_compte(client, auth_headers, monkeypatch):
    envoyes = []

    def fake_execute_values(cur, sql, lignes, **kwargs):
        envoyes.append(lignes)
        return [{"id": i} for i, _ in enumerate(lignes)] if "INSERT" in sql else []

    monkeypatch.setattr(catalog, "execute_values", fake_execute_values)
    r = client.post(
        "/api/catalog/modeles/bulk",
        json={
            "categorie": "Smartphone",
            "marque": "Apple",
            "annee": None,
            "modeles": ["iPhone  17e", "iphone 17E", "", "Autre", "iPhone 16e"],
        },
        headers=auth_headers,
    )
    assert r.status_code == 200
    assert r.json() == {"ok": True, "ajoutes": 2, "reactives": 0}
    assert [l[2] for l in envoyes[0]] == ["iPhone 17e", "iPhone 16e"]
    assert [l[4] for l in envoyes[0]] == [10, 20]


def test_bulk_nom_trop_long(client, auth_headers):
    r = client.post(
        "/api/catalog/modeles/bulk",
        json={"categorie": "Smartphone", "marque": "Apple", "modeles": ["x" * 81]},
        headers=auth_headers,
    )
    assert r.status_code == 400


def test_categories_sans_bd():
    assert get_categories() == CATEGORIES
