"""Moteur de prix — sources et fraîcheur (lots 4 à 7) : prix payés lors des commandes de pièces
→ propositions, fraîcheur des suggestions de grille, correspondance des noms de modèles et
alias, modèles sans prix, veille hebdomadaire, synchro LCD-Phone (parseur sur fixture, état
durable, type_produit).

Les tests purs tournent toujours (aucune requête réseau : le parseur LCD-Phone lit
tests/fixtures/lcdphone_productlist.json). Ceux sur base réelle exigent une base PostgreSQL
JETABLE (migrations du lifespan rejouées, lignes fictives ajoutées puis retirées) :
    KP_PRIX_DATABASE_URL="postgresql://postgres:<mot_de_passe>@127.0.0.1:5432/kp_prix?sslmode=disable" pytest tests/test_prix_sources.py
Chargée avec une copie des grilles de prix de la prod (tarifs, tarifs_reparation,
tarifs_apple_devices, iphone_tarifs, smartphones_tarifs, catalog_modeles, initialisation de
prix_maj_le / prix_source rejouée), elle fait aussi tourner les tests « prod » (noms réels,
fraîcheur des lignes saisies le 2026-02-15, couverture du catalogue).
"""

import json
import os
import re
import sys
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api import grille, parts as parts_api, telephones
from app.api.auth import create_admin_token, create_token, decode_token
from app.services import params as params_cache
from app.services import prix as prix_srv
from app.services import scraper_lcdphone as lcd
from app.services import veille_prix
from app.services.prestations import normaliser

FIXTURE_LCD = Path(__file__).parent / "fixtures" / "lcdphone_productlist.json"
MARQUEUR = "pytest-prix-b"
ADMIN = "PrixAdminB"


def _h(admin=False, user="Sophie"):
    tok = create_token("accueil", user)
    h = {"Authorization": f"Bearer {tok}"}
    if admin:
        h["X-Admin-Token"] = create_admin_token(decode_token(tok))
    return h


def _alias_initiaux():
    return [{"cle": grille.cle_alias(a), "alias": a, "canonique": c, "categorie": None} for a, c in grille.ALIAS_INITIAUX]


def _score(ticket, ligne, alias=None):
    modele, marque = ticket
    return grille._score_cles(grille.cles_ticket(modele, marque, None, alias), *ligne)


# ═══ Correspondance des noms (noms réels des grilles et du catalogue de la prod) ═══

@pytest.mark.parametrize("ticket, ligne, score", [
    # Lettres et chiffres collés ou non
    (("Reno10", "Oppo"), ("Reno 10", "Oppo"), 2),
    (("Reno10 Pro", "Oppo"), ("Reno 10 Pro", "Oppo"), 2),
    (("Reno 8 Lite", "Oppo"), ("Reno8 Lite", "Oppo"), 2),
    (("Nord CE4 Lite", "OnePlus"), ("Nord CE 4 Lite", "OnePlus"), 2),
    (("Pixel 7 a", "Google"), ("Pixel 7a", "Google"), 2),
    (("iPhone13", "Apple"), ("iPhone 13", "Apple"), 2),
    (("Redmi 9 A", "Xiaomi"), ("Redmi 9A", "Xiaomi"), 2),
    (("Galaxy S21FE", "Samsung"), ("Galaxy S21 FE", "Samsung"), 2),
    # Références Apple, guillemets de taille, années entre parenthèses, « Ne gen »
    (("MacBook Air 13 M3", "Apple"), ('MacBook Air 13" M3 A3113 (2024)', "Apple"), 1),
    (("MacBook Pro 13 M1", "Apple"), ('MacBook Pro 13" M1 A2338 (2020)', "Apple"), 1),
    (("iPad 9", "Apple"), ('iPad 9 (2021) 10.2"', "Apple"), 1),
    (("iPad Pro 11 M1", "Apple"), ('iPad Pro 11" 3e gen M1 (2021)', "Apple"), 1),
    (("iPad Pro 11 2020", "Apple"), ('iPad Pro 11" 2e gen (2020)', "Apple"), 2),
    (("iPad Pro 12.9 M2", "Apple"), ('iPad Pro 12.9" 6e gen M2 (2022)', "Apple"), 1),
    (("iPad Air (4e génération)", "Apple"), ("iPad Air 4 (2020)", "Apple"), 1),
    (("Nothing Phone (2a)", "Nothing"), ("Phone (2a)", "Nothing"), 2),
    # Jamais de faux positif
    (("POCO X6", "Xiaomi"), ("Poco X6 Pro 5G", "Xiaomi"), 0),
    (("P40", "Huawei"), ("P40 Lite", "Huawei"), 0),
    (("P40", "Huawei"), ("P40 Pro", "Huawei"), 0),
    (("P40 Lite E", "Huawei"), ("P40 Lite", "Huawei"), 0),
    (("Galaxy Tab S6", "Samsung"), ("Galaxy Tab S6 Lite", "Samsung"), 0),
    (("Galaxy Tab A7 Lite", "Samsung"), ("Galaxy Tab A7 10.4 (2020)", "Samsung"), 0),
    (("iPhone 13", "Apple"), ("iPhone 13 Mini", "Apple"), 0),
    (("iPhone 13", "Apple"), ("iPhone 13 mini", "Apple"), 0),
    (("iPhone 13 mini", "Apple"), ("iPhone 13", "Apple"), 0),
    (("Reno10", "Oppo"), ("Reno 10 Pro", "Oppo"), 0),
    (("Mi 10T", "Xiaomi"), ("Mi 10T Pro", "Xiaomi"), 0),
    (("Redmi 9AT", "Xiaomi"), ("Redmi 9", "Xiaomi"), 0),
    (("MacBook Air 13 M2", "Apple"), ('MacBook Air 13" M3 A3113 (2024)', "Apple"), 0),
    (("iPad Pro 11 M1", "Apple"), ('iPad Pro 11" 4e gen M2 (2022)', "Apple"), 0),
    (("iPad Air 4", "Apple"), ("iPad Air 5 (2022)", "Apple"), 0),
    (("Nothing Phone (2)", "Nothing"), ("Phone (2a)", "Nothing"), 0),
    (("Nothing Phone (2a)", "Nothing"), ("Phone (2a) Plus", "Nothing"), 0),
])
def test_correspondance_noms_reels(ticket, ligne, score):
    assert _score(ticket, ligne) == score


@pytest.mark.parametrize("ticket, ligne, score", [
    (("iPhone Air", "Apple"), ("iPhone 17 Air", "Apple"), 2),
    (("iPad Air M1", "Apple"), ("iPad Air 5 M1 (2022)", "Apple"), 2),
    (("iPad Air M1", "Apple"), ("iPad Air 5 (2022)", "Apple"), 2),
    (("iPad Air 11 M2", "Apple"), ('iPad Air 6 M2 11" (2024)', "Apple"), 2),
    (("iPad Air 11 M2", "Apple"), ('iPad Air 6 M2 13" (2024)', "Apple"), 0),
    (("Galaxy Tab A7", "Samsung"), ("Galaxy Tab A7 10.4 (2020)", "Samsung"), 2),
    (("Galaxy Tab A7 Lite", "Samsung"), ("Galaxy Tab A7 10.4 (2020)", "Samsung"), 0),
    (("MacBook Pro 16 M3", "Apple"), ('MacBook Pro 16" M3 Pro/Max A2991 (2023)', "Apple"), 2),
    # 14" M3 simple : son propre prix, jamais celui du M3 Pro/Max
    (("MacBook Pro 14 M3", "Apple"), ('MacBook Pro 14" M3 Pro/Max A2918 (2023)', "Apple"), 0),
    (("iPhone 17", "Apple"), ("iPhone 17 Air", "Apple"), 0),
])
def test_alias_initiaux(ticket, ligne, score):
    assert _score(ticket, ligne, _alias_initiaux()) == score


def test_alias_sql_initial_reprend_la_liste():
    vals = re.findall(r"\('([^']*)', '([^']*)'\)", grille.SQL_ALIAS_INITIAUX)
    assert vals == list(grille.ALIAS_INITIAUX)
    assert grille._DRAPEAU_ALIAS in grille.SQL_ALIAS_INITIAUX and grille._DRAPEAU_ALIAS in grille.SQL_ALIAS_INITIAUX_FLAG
    # Chaque alias initial désigne un autre modèle que son nom canonique
    for a, c in grille.ALIAS_INITIAUX:
        assert grille.cle_alias(a) not in {grille.cle_modele(v, "") for v in grille.variantes(c)}


def test_prefiltre_compact():
    # Motifs cherchés dans le nom brut sans espaces : « reno10 » trouve « Reno 10 » et « Reno10 »
    assert grille._motifs_prefiltre(grille.cle_modele("Reno 10", "Oppo")) == ["%reno10%"]
    assert grille._motifs_prefiltre(grille.cle_modele("Nord CE 4 Lite", "OnePlus")) == ["%nord%", "%ce4%", "%lite%"]
    assert "[^a-z0-9]+" in grille._COMPACT_SQL.format("modele")
    cles = grille.cles_ticket("iPad Air M1", "Apple", None, _alias_initiaux())
    assert len(cles) == 3 and grille._motifs_communs(cles) == []   # aucun mot commun : toute la marque


@pytest.mark.parametrize("maj, source, niveau, estime", [
    (timedelta(days=10), "commande", "ok", False),
    (timedelta(days=90, hours=1), "import", "a_revoir", False),
    (timedelta(days=100), "estimation_2026_02", "a_revoir", True),
    (timedelta(days=181), "estimation_2026_02", "perime", True),
    (None, None, "perime", False),
])
def test_fraicheur(maj, source, niveau, estime):
    maintenant = datetime(2026, 10, 16, 12, 0)
    f = grille.fraicheur(maintenant - maj if maj else None, source, (90, 180), maintenant)
    assert f["fraicheur"] == niveau and f["estime"] is estime and f["prix_source"] == source
    assert f["age_jours"] == (maj.days if maj else None)
    assert f["prix_maj_le"] == ((maintenant - maj).isoformat() if maj else None)


def test_groupes_repli_fournisseur():
    s = [grille._suggestion("tarifs_reparation", "tarifs_reparation:1:ecran_generique", "Forfait", "Écran",
                            "Générique", 99, None, None, "iPhone 13", "Apple", 2, colonne="ecran_generique"),
         grille._suggestion("tarifs", "tarifs:1", "Écran", "Ecran", "Incell", 109, None, 40, "iPhone 13", "Apple", 2),
         grille._suggestion("tarifs", "tarifs:2", "HP", "Haut-parleur", None, 69, None, 5, "iPhone 13", "Apple", 2),
         grille._suggestion("iphone_tarifs", "iphone_tarifs:1:1", "iPhone 13", "Téléphone (vente)", None,
                            399, None, None, "iPhone 13", "Apple", 2)]
    grille._grouper(s, repli=True)
    assert [x["_groupe"] for x in s] == ["boutique", "fournisseur", "boutique", "vente"]
    grille._grouper(s, repli=False)
    assert [x["_groupe"] for x in s] == ["boutique", "boutique", "boutique", "vente"]


def test_limite_apres_repli():
    """Les pièces repliées ne prennent que les places laissées par la grille boutique et les ventes."""
    s = [grille._suggestion("tarifs", "tarifs:1", "Écran", "Ecran", "Incell", 109, None, 40, "iPhone 13", "Apple", 2),
         grille._suggestion("tarifs", "tarifs:2", "Batterie", "Batterie", None, 59, None, 15, "iPhone 13", "Apple", 2),
         grille._suggestion("tarifs_reparation", "tarifs_reparation:1:ecran_generique", "Forfait écran", "Écran",
                            "Générique", 99, None, None, "iPhone 13", "Apple", 2, colonne="ecran_generique"),
         grille._suggestion("tarifs_reparation", "tarifs_reparation:1:batterie", "Forfait batterie", "Batterie",
                            None, 79, None, None, "iPhone 13", "Apple", 2, colonne="batterie"),
         grille._suggestion("tarifs_reparation", "tarifs_reparation:1:chassis", "Forfait châssis", "Châssis",
                            None, 219, None, None, "iPhone 13", "Apple", 2, colonne="chassis"),
         grille._suggestion("iphone_tarifs", "iphone_tarifs:1:1", "iPhone 13 128 Go", "Téléphone (vente)", None,
                            399, None, None, "iPhone 13", "Apple", 2)]
    for x in s:
        x["_score"] = 3
    grille._grouper(s, repli=True)
    assert {x["id"]: x["_groupe"] for x in s}["tarifs:1"] == "fournisseur"
    garde = sorted(s, key=grille._ordre_groupe)[:4]
    assert {x["id"] for x in garde} == {"tarifs_reparation:1:ecran_generique", "tarifs_reparation:1:batterie",
                                        "tarifs_reparation:1:chassis", "iphone_tarifs:1:1"}
    assert [x["_groupe"] for x in sorted(s, key=grille._ordre_groupe)][-2:] == ["fournisseur", "fournisseur"]


# ═══ LCD-Phone : parseur sur fixture (aucune requête réseau) ════

def _pages():
    return json.loads(FIXTURE_LCD.read_text(encoding="utf-8"))["pages"]


CAT_IPHONE = lcd.CATEGORIES[0]     # iphone-occasion (Apple imposé)
CAT_ANDROID = lcd.CATEGORIES[1]    # android-occasion


def test_parseur_lcdphone_fixture():
    vus, debug = set(), {}
    p1 = lcd.parser_produits(_pages()[0], CAT_IPHONE, debug, vus)
    p2 = lcd.parser_produits(_pages()[1], CAT_ANDROID, debug, vus)
    noms = [p["modele"] for p in p1 + p2]
    # Gardés : les téléphones, même « avec boîte et câble » ; exclus : boîte vide, coque, câble,
    # kit chargeur, iPhone 8, doublon (même id_product), rupture, marque hors liste (ZTE)
    assert [p["reference_fournisseur"] for p in p1 + p2] == ["50730", "52337"]
    assert all("iPhone" in n for n in noms)
    assert debug["cards_skipped_excluded"] == 5 and debug["cards_skipped_doublon"] == 1
    assert debug["cards_skipped_stock"] == 1 and debug["cards_skipped_brand"] == 1
    iphone13 = p2[0]
    assert iphone13["prix_fournisseur"] == 1049.0          # prix affiché « 1 049,00 € » (sans price_amount)
    assert iphone13["prix_vente"] == 1129.0 and iphone13["type_produit"] == "occasion"
    assert p1[0]["image_url"].endswith("iphone-14.jpg") and iphone13["image_url"].endswith("iphone-13-pro.jpg")
    assert {p["type_produit"] for p in p1 + p2} <= set(lcd.TYPES_PRODUIT)


@pytest.mark.parametrize("nom, exclu", [
    ('Boite Tablette Vide 11"', True), ('Boite Tablette Vide 12.9"', True),
    ("Boîte téléphone vide toutes tailles", True), ("Coque Transparente avec MagSafe pour iPhone X - iPhone 17", True),
    ("Câble Type-C vers Lightning 20W -1M (Mayline)", True), ("Kit Chargeur 5W Câble USB vers Lightning 1M", True),
    ("Chargeur secteur 20W", True), ("iPhone 12 Factice", True),
    ("iPhone 14 256 Go Bleu Grade AB avec boîte et sans accessoire", False),
    ("Galaxy S23 128 Go Noir Grade A avec boite et cable", False),
    ("iPhone 13 Pro Max 128 Go Graphite Grade A avec boîte et accessoires", False),
])
def test_mots_exclus(nom, exclu):
    assert lcd.est_exclu(nom) is exclu


def test_type_produit_toujours_neuf_ou_occasion():
    assert {lcd.type_produit_valide(v) for v in ("neuf", "Neuf", "occasion", "reconditionné", "", None, "x")} \
        == {"neuf", "occasion"}
    assert {c["type_produit"] for c in lcd.CATEGORIES} <= set(lcd.TYPES_PRODUIT)
    import inspect
    assert "DEFAULT 'occasion'" in inspect.getsource(telephones._ensure_table)
    assert "reconditionné'" not in inspect.getsource(telephones._ensure_table)


class _Rep:
    def __init__(self, data):
        self.status_code, self._data = 200, data

    def json(self):
        return self._data


class _Client:
    def __init__(self, pages):
        self.pages, self.urls = pages, []

    def get(self, url, headers=None):
        self.urls.append(url)
        page = int(re.search(r"[?&]page=(\d+)", url).group(1))
        return _Rep(self.pages[page - 1])


def test_pages_lcdphone_sans_tri_et_avec_pause(monkeypatch):
    pauses = []
    monkeypatch.setattr(lcd.time, "sleep", pauses.append)
    client = _Client(_pages())
    produits, debug = lcd._scrape_category_ajax(client, CAT_IPHONE)
    assert len(client.urls) == 2 and all("order=" not in u for u in client.urls)
    assert pauses == [2.0] and debug["pages"] == 2 and debug["total_items"] == 10
    # Catégorie iPhone : marque imposée, le doublon de la page 2 écarté
    assert [p["reference_fournisseur"] for p in produits] == ["50730", "52337", "43717"]
    assert "order=" not in lcd._url_page(CAT_ANDROID, 3, 36)


def test_sync_compte_les_marques(monkeypatch):
    monkeypatch.setattr(lcd.time, "sleep", lambda s: None)
    monkeypatch.setattr(lcd, "_HAS_DEPS", True)

    class _C(_Client):
        def close(self):
            pass

    monkeypatch.setattr(lcd, "login_lcdphone", lambda: (_C(_pages()), None))
    vus_cats = []
    monkeypatch.setattr(lcd, "CATEGORIES", [CAT_ANDROID])
    monkeypatch.setattr(lcd, "enregistrer_produits", lambda cur, p: vus_cats.append(len(p)) or (len(p), 0))

    @contextmanager
    def faux_cursor():
        yield None

    monkeypatch.setattr(lcd, "get_cursor", faux_cursor)
    r = lcd.sync_telephones_lcdphone()
    assert r["success"] and r["total"] == 2 and r["marques"] == 1 and vus_cats == [2]


# ═══ Veille : démarrage du fil ══════════════════════════════════

def test_veille_coupee_par_variable(monkeypatch):
    monkeypatch.setenv("KP_VEILLE_PRIX", "0")
    monkeypatch.setattr(veille_prix, "_tache", {"thread": None})
    assert veille_prix.demarrer_veille_hebdomadaire(0, 0) is False
    assert veille_prix._tache["thread"] is None


def test_veille_un_seul_fil(monkeypatch):
    monkeypatch.delenv("KP_VEILLE_PRIX", raising=False)
    monkeypatch.setattr(veille_prix, "_tache", {"thread": None})
    stop = threading.Event()
    lances = []
    monkeypatch.setattr(veille_prix, "_boucle", lambda d, p: lances.append(1) or stop.wait(5))
    compte = lambda: sum(t.name == "veille_prix" for t in threading.enumerate())  # noqa: E731
    avant = compte()   # fil éventuel d'un lifespan d'un autre test, endormi
    try:
        assert veille_prix.demarrer_veille_hebdomadaire(0, 0) is True
        assert veille_prix.demarrer_veille_hebdomadaire(0, 0) is False
        assert compte() == avant + 1
    finally:
        stop.set()
        veille_prix._tache["thread"].join(2)
    assert lances == [1]


def test_message_veille():
    resume = {"a_revoir": 3, "perimes": 1202, "estimes": 1202, "propositions_en_attente": 2, "marges_faibles": 1,
              "modeles_sans_prix": 150, "lcdphone": {"age_jours": None, "ok": None},
              "seuils": {"jours_a_revoir": 90, "jours_perime": 180, "seuil_marge_alerte": 40}}
    m = veille_prix.message(resume)
    assert "3 prix à revoir" in m and "1202 périmés" in m and "1202 estimations" in m and "aucune synchro" in m


def test_routes_admin_sans_jeton(client):
    for methode, url in (("get", "/api/tarifs/propositions"), ("post", "/api/tarifs/propositions/1/accepter"),
                         ("post", "/api/tarifs/propositions/1/refuser"), ("get", "/api/grille/sans-prix"),
                         ("get", "/api/grille/alias"), ("post", "/api/telephones/sync"),
                         ("get", "/api/telephones/probe")):
        assert getattr(client, methode)(url).status_code == 401, url


def test_tarif_cle_validee(client, auth_headers):
    r = client.post("/api/parts", json={"description": "x", "tarif_cle": "tickets:1"}, headers=auth_headers)
    assert r.status_code == 422
    assert parts_api.CommandePieceUpdatePrix(tarif_cle=" ").tarif_cle is None
    assert parts_api.CommandePieceCreatePrix(description="x", tarif_cle="tarifs:12").tarif_cle == "tarifs:12"


# ═══ Base réelle ═══════════════════════════════════════════════

DB_URL = os.getenv("KP_PRIX_DATABASE_URL")


@pytest.fixture(scope="module")
def base():
    if not DB_URL:
        pytest.skip("KP_PRIX_DATABASE_URL non définie (base PostgreSQL de test jetable)")
    import psycopg2.extras
    import psycopg2.pool
    import app.database

    pool = psycopg2.pool.ThreadedConnectionPool(1, 8, DB_URL)

    @contextmanager
    def vrai_cursor(dict_cursor=True):
        conn = pool.getconn()
        try:
            factory = psycopg2.extras.RealDictCursor if dict_cursor else None
            with conn.cursor(cursor_factory=factory) as cur:
                yield cur
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            pool.putconn(conn)

    mp = pytest.MonkeyPatch()
    mp.setenv("KP_VEILLE_PRIX", "0")
    mp.setenv("KP_RETENTION_AUTO", "0")
    mp.setattr(app.database, "get_cursor", vrai_cursor)
    for nom, mod in list(sys.modules.items()):
        if nom.startswith("app.") and mod is not app.database and getattr(mod, "get_cursor", None) is not None:
            mp.setattr(mod, "get_cursor", vrai_cursor)
    from app.main import app as fastapi_app
    try:
        with TestClient(fastapi_app) as c:   # lifespan : schéma + migrations
            with vrai_cursor() as cur:
                cur.execute("DELETE FROM membres_equipe WHERE nom = %s", (ADMIN,))
                cur.execute("INSERT INTO membres_equipe (nom, role) VALUES (%s, 'admin')", (ADMIN,))
            _nettoyer(vrai_cursor)
            yield {"c": c, "cur": vrai_cursor, "pool": pool}
            _nettoyer(vrai_cursor)
    finally:
        mp.undo()
        pool.closeall()
        params_cache.invalidate()
        grille.invalider_alias()


def _nettoyer(vrai_cursor):
    with vrai_cursor() as cur:
        cur.execute("SELECT id FROM tarifs WHERE nom_fournisseur = %s", (MARQUEUR,))
        ids = [r["id"] for r in cur.fetchall()]
        cles = [f"tarifs:{i}" for i in ids]
        cur.execute("DELETE FROM tarifs_propositions WHERE tarif_cle = ANY(%s)", (cles,))
        cur.execute("DELETE FROM tarifs_historique WHERE table_nom = 'tarifs' AND ligne_id = ANY(%s)", (ids,))
        cur.execute("DELETE FROM commandes_pieces WHERE notes = %s", (MARQUEUR,))
        cur.execute("DELETE FROM tarifs WHERE nom_fournisseur = %s", (MARQUEUR,))
        cur.execute("DELETE FROM tickets WHERE notes_internes = %s", (MARQUEUR,))
        cur.execute("DELETE FROM modeles_alias WHERE alias LIKE 'Pytest%%'")
        cur.execute("DELETE FROM notifications_center WHERE type = 'veille_prix'")
        cur.execute("DELETE FROM telephones_catalogue WHERE reference_fournisseur LIKE 'pytest-%%'")
        # États écrits par les tests (veille datée dans le futur, synchro fictive) : base jetable
        cur.execute("DELETE FROM params WHERE cle IN ('VEILLE_PRIX_RESUME', 'VEILLE_PRIX_DERNIERE', "
                    "'LCDPHONE_DERNIERE_SYNCHRO', 'LCDPHONE_SYNCHRO_OK', 'LCDPHONE_SYNCHRO_RESUME')")


def _sql(base, sql, *params):
    with base["cur"]() as cur:
        cur.execute(sql, params)
        return cur.fetchall() if cur.description else None


H = _h()
HA = _h(admin=True, user=ADMIN)


def _piece(base, modele="Pytest Phone B", type_piece="Ecran", qualite="Original", ht=100, categorie="standard",
           maj="2026-02-15 19:27:49", source="estimation_2026_02", verrou=False, marque="Pytest"):
    client = prix_srv.prix_client(ht, type_piece, categorie, prix_srv.REGLES_DEFAUT)
    r = _sql(base, """INSERT INTO tarifs (marque, modele, type_piece, qualite, nom_fournisseur, prix_fournisseur_ht,
                                          prix_client, categorie, source, en_stock, updated_at, prix_maj_le,
                                          prix_source, verrou_manuel)
                      VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'mobilax', TRUE, %s, %s, %s, %s) RETURNING id""",
             marque, modele, type_piece, qualite, MARQUEUR, ht, client, categorie, maj, maj, source, verrou)
    return r[0]["id"]


def _tarif(base, tid):
    return _sql(base, """SELECT prix_fournisseur_ht, prix_client, prix_maj_le, prix_source, verrou_manuel
                         FROM tarifs WHERE id = %s""", tid)[0]


def _commande(base, **kw):
    corps = {"description": "Écran pytest", "fournisseur": "Mobilax", "notes": MARQUEUR}
    corps.update(kw)
    r = base["c"].post("/api/parts", json=corps, headers=H)
    assert r.status_code == 200, r.text
    return r.json()


def _historique(base, tid):
    return _sql(base, "SELECT colonne, ancien, nouveau, source, lot_id, par FROM tarifs_historique "
                      "WHERE table_nom = 'tarifs' AND ligne_id = %s ORDER BY id", tid)


# ─── Commandes de pièces → propositions ─────────────────────────

def test_commande_ht_egal_aucune_proposition(base):
    tid = _piece(base)
    avant = _tarif(base, tid)
    r = _commande(base, prix_ht=100.8, tarif_cle=f"tarifs:{tid}")
    assert r["proposition_id"] is None
    assert _sql(base, "SELECT count(*) AS n FROM tarifs_propositions WHERE tarif_cle = %s", f"tarifs:{tid}")[0]["n"] == 0
    row = _sql(base, "SELECT prix_ht, tarif_cle FROM commandes_pieces WHERE id = %s", r["id"])[0]
    assert row == {"prix_ht": Decimal("100.80"), "tarif_cle": f"tarifs:{tid}"}
    assert _tarif(base, tid) == avant


def test_commande_ht_different_puis_accepter(base):
    c = base["c"]
    tid = _piece(base, modele="Pytest Phone B2")
    avant = _tarif(base, tid)
    tick = _sql(base, """INSERT INTO tickets (categorie, marque, modele, panne, notes_internes, ticket_code)
                         VALUES ('Smartphone', 'Pytest', 'Pytest Phone B2', 'Écran cassé', %s, 'KP-PRIXB1')
                         RETURNING id""", MARQUEUR)[0]["id"]
    r = _commande(base, ticket_id=tick, prix_ht=120, tarif_cle=f"tarifs:{tid}")
    pid = r["proposition_id"]
    assert pid
    # Jamais d'écriture directe : la pièce et son historique restent intacts
    assert _tarif(base, tid) == avant and _historique(base, tid) == []

    assert c.get("/api/tarifs/propositions", headers=H).status_code == 403
    sans_code = {"Authorization": f"Bearer {create_token('accueil', ADMIN)}"}
    r = c.get("/api/tarifs/propositions", headers=sans_code)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "admin_requis"
    liste = c.get("/api/tarifs/propositions", headers=HA).json()
    p = next(x for x in liste if x["id"] == pid)
    attendu_client = prix_srv.prix_client(120, "Ecran", "standard", prix_srv.REGLES_DEFAUT)
    assert {k: p[k] for k in ("tarif_cle", "ancien_ht", "nouveau_ht", "ancien_client", "nouveau_client",
                              "commande_id", "ticket_code", "verrou", "statut")} == {
        "tarif_cle": f"tarifs:{tid}", "ancien_ht": 100.0, "nouveau_ht": 120.0, "ancien_client": 189,
        "nouveau_client": attendu_client, "commande_id": r_id(base, pid), "ticket_code": "KP-PRIXB1",
        "verrou": False, "statut": "en_attente"}
    assert p["label"] == "Pytest Pytest Phone B2 — Ecran Original" and p["le"]

    # Une seule proposition en attente par pièce : une seconde commande l'actualise
    r2 = _commande(base, prix_ht=130, tarif_cle=f"tarifs:{tid}")
    assert r2["proposition_id"] == pid
    assert _sql(base, "SELECT nouveau_ht, commande_id FROM tarifs_propositions WHERE id = %s", pid)[0] == \
        {"nouveau_ht": Decimal("130.00"), "commande_id": r2["id"]}

    debut = grille.maintenant_utc() - timedelta(seconds=5)
    r = c.post(f"/api/tarifs/propositions/{pid}/accepter", headers=HA)
    assert r.status_code == 200, r.text
    res = r.json()
    nouveau_client = prix_srv.prix_client(130, "Ecran", "standard", prix_srv.REGLES_DEFAUT)
    assert res["statut"] == "acceptee" and res["nouveau_client"] == nouveau_client and res["lot_id"]
    t = _tarif(base, tid)
    assert t["prix_fournisseur_ht"] == Decimal("130.00") and t["prix_client"] == nouveau_client
    assert t["prix_source"] == "commande" and t["prix_maj_le"] >= debut
    hist = _historique(base, tid)
    assert [(h["colonne"], h["source"], h["lot_id"], h["par"]) for h in hist] == [
        ("prix_client", "commande", res["lot_id"], ADMIN), ("prix_fournisseur_ht", "commande", res["lot_id"], ADMIN)]
    assert {h["colonne"]: (h["ancien"], h["nouveau"]) for h in hist} == {
        "prix_fournisseur_ht": (Decimal("100.00"), Decimal("130.00")),
        "prix_client": (Decimal("189"), Decimal(nouveau_client))}
    prop = _sql(base, "SELECT statut, traite_par, traite_le FROM tarifs_propositions WHERE id = %s", pid)[0]
    assert prop["statut"] == "acceptee" and prop["traite_par"] == ADMIN and prop["traite_le"]
    r = c.post(f"/api/tarifs/propositions/{pid}/accepter", headers=HA)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "deja_traitee"

    # La suggestion suivante montre le nouveau prix, daté du jour, ni estimé ni périmé
    s = c.get("/api/grille/suggestions", params={"marque": "Pytest", "modele": "Pytest Phone B2"}, headers=H).json()
    ligne = next(x for x in s["suggestions"] if x["id"] == f"tarifs:{tid}")
    assert ligne["prix"] == nouveau_client and ligne["fraicheur"] == "ok" and ligne["estime"] is False
    assert ligne["prix_source"] == "commande" and ligne["age_jours"] == 0


def r_id(base, pid):
    return _sql(base, "SELECT commande_id FROM tarifs_propositions WHERE id = %s", pid)[0]["commande_id"]


def test_refuser_ne_change_rien(base):
    c = base["c"]
    tid = _piece(base, modele="Pytest Phone B3")
    avant = _tarif(base, tid)
    pid = _commande(base, prix_ht=150, tarif_cle=f"tarifs:{tid}")["proposition_id"]
    assert c.post(f"/api/tarifs/propositions/{pid}/refuser", headers=H).status_code == 403
    r = c.post(f"/api/tarifs/propositions/{pid}/refuser", headers=HA)
    assert r.status_code == 200 and r.json() == {"id": pid, "statut": "refusee"}
    assert _tarif(base, tid) == avant and _historique(base, tid) == []
    assert c.post(f"/api/tarifs/propositions/{pid}/refuser", headers=HA).status_code == 409
    assert c.post("/api/tarifs/propositions/999999999/refuser", headers=HA).status_code == 404
    refusees = c.get("/api/tarifs/propositions", params={"statut": "refusee"}, headers=HA).json()
    assert pid in {x["id"] for x in refusees}


def test_verrou_signale_jamais_ecrit(base):
    c = base["c"]
    tid = _piece(base, modele="Pytest Phone B4", verrou=True)
    avant = _tarif(base, tid)
    pid = _commande(base, prix_ht=160, tarif_cle=f"tarifs:{tid}")["proposition_id"]
    assert pid   # créée, mais signalée
    p = next(x for x in c.get("/api/tarifs/propositions", headers=HA).json() if x["id"] == pid)
    assert p["verrou"] is True
    r = c.post(f"/api/tarifs/propositions/{pid}/accepter", headers=HA)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "verrouille"
    assert _tarif(base, tid) == avant and _historique(base, tid) == []
    assert _sql(base, "SELECT statut FROM tarifs_propositions WHERE id = %s", pid)[0]["statut"] == "en_attente"
    r = c.post("/api/tarifs/propositions/accepter", json={"ids": [pid, 999999999]}, headers=HA)
    assert r.status_code == 200
    assert {k: r.json()[k] for k in ("acceptees", "verrouillees", "ignorees")} == {
        "acceptees": [], "verrouillees": [pid], "ignorees": [999999999]}


def test_accepter_plusieurs_un_seul_lot(base):
    c = base["c"]
    t1, t2 = _piece(base, modele="Pytest Phone B5"), _piece(base, modele="Pytest Phone B6", type_piece="Batterie",
                                                             qualite=None, ht=20)
    p1 = _commande(base, prix_ht=110, tarif_cle=f"tarifs:{t1}")["proposition_id"]
    p2 = _commande(base, prix_ht=25, tarif_cle=f"tarifs:{t2}")["proposition_id"]
    r = c.post("/api/tarifs/propositions/accepter", json={"ids": [p1, p2, p1]}, headers=HA).json()
    assert r["acceptees"] == [p1, p2] and r["modifies"] == 2
    lots = {h["lot_id"] for t in (t1, t2) for h in _historique(base, t)}
    assert lots == {r["lot_id"]}
    assert _tarif(base, t2)["prix_client"] == prix_srv.prix_client(25, "Batterie", "standard", prix_srv.REGLES_DEFAUT)
    assert c.post("/api/tarifs/propositions/accepter", json={"ids": []}, headers=HA).status_code == 422


def test_commande_sans_tarif_cle(base):
    c = base["c"]
    r = _commande(base, prix_ht=55)
    assert r["proposition_id"] is None
    assert c.patch(f"/api/parts/{r['id']}", json={"statut": "Reçu"}, headers=H).json() == \
        {"ok": True, "proposition_id": None}
    r = _commande(base)   # ni HT ni pièce : comme avant
    assert r["proposition_id"] is None
    assert c.post("/api/parts", json={"description": "x", "tarif_cle": "tarifs:abc"}, headers=H).status_code == 422
    # Pièce inconnue : la commande passe, sans proposition
    r = _commande(base, prix_ht=40, tarif_cle="tarifs:999999999")
    assert r["proposition_id"] is None and r["id"]
    liste = c.get("/api/parts", params={"search": "Écran pytest"}, headers=H).json()
    assert any(x["id"] == r["id"] and x["tarif_cle"] == "tarifs:999999999" for x in liste)


def test_patch_et_reception(base):
    c = base["c"]
    tid = _piece(base, modele="Pytest Phone B7")
    cle = f"tarifs:{tid}"
    r = _commande(base)
    cid = r["id"]
    # HT et pièce ajoutés ensuite : proposition
    r = c.patch(f"/api/parts/{cid}", json={"prix_ht": 140, "tarif_cle": cle}, headers=H).json()
    pid = r["proposition_id"]
    assert pid
    c.post(f"/api/tarifs/propositions/{pid}/refuser", headers=HA)
    # Réception : une proposition déjà venue de cette commande (même refusée) ne revient pas
    r = c.patch(f"/api/parts/{cid}", json={"statut": "Reçu"}, headers=H).json()
    assert r["proposition_id"] is None
    # HT corrigé : nouvelle proposition
    r = c.patch(f"/api/parts/{cid}", json={"prix_ht": 145}, headers=H).json()
    assert r["proposition_id"] and r["proposition_id"] != pid
    # Effacement du HT (null) accepté
    assert c.patch(f"/api/parts/{cid}", json={"prix_ht": None}, headers=H).status_code == 200
    assert _sql(base, "SELECT prix_ht FROM commandes_pieces WHERE id = %s", cid)[0]["prix_ht"] is None

    # Commande créée sans proposition (HT égal), puis reçue : toujours rien
    r = _commande(base, prix_ht=100, tarif_cle=cle)
    assert c.patch(f"/api/parts/{r['id']}", json={"statut": "Reçu"}, headers=H).json()["proposition_id"] is None
    # Créée avec un HT nouveau mais sans pièce, la pièce choisie à la réception
    r = _commande(base, prix_ht=99)
    assert c.patch(f"/api/parts/{r['id']}", json={"statut": "Reçu", "tarif_cle": cle}, headers=H).json()["proposition_id"] is None
    r = _commande(base, prix_ht=135)
    assert c.patch(f"/api/parts/{r['id']}", json={"tarif_cle": cle, "statut": "Reçu"}, headers=H).json()["proposition_id"]


# ─── Grille : fraîcheur, groupes, obsolètes, alias, modèles sans prix ─

def test_suggestions_fraicheur_et_obsolete(base):
    c = base["c"]
    vieux = _piece(base, modele="Pytest Phone B8", type_piece="Batterie", qualite=None, ht=20)
    recent = _piece(base, modele="Pytest Phone B8", qualite="Incell", ht=50,
                    maj=(grille.maintenant_utc() - timedelta(days=100, hours=1)).strftime("%Y-%m-%d %H:%M:%S"),
                    source="import")
    obsolete = _piece(base, modele="Pytest Phone B8", qualite="OLED", ht=70)
    _sql(base, "UPDATE tarifs SET obsolete = TRUE WHERE id = %s", obsolete)
    s = c.get("/api/grille/suggestions", params={"marque": "Pytest", "modele": "Pytest Phone B8"}, headers=H).json()
    par_id = {x["id"]: x for x in s["suggestions"]}
    assert f"tarifs:{obsolete}" not in par_id
    v, r = par_id[f"tarifs:{vieux}"], par_id[f"tarifs:{recent}"]
    assert set(v) == {"source", "id", "label", "type_piece", "qualite", "prix", "stock", "cout_ht", "modele",
                      "prix_maj_le", "prix_source", "age_jours", "fraicheur", "estime", "groupe"}
    assert (v["fraicheur"], v["estime"], v["prix_source"], v["groupe"]) == ("perime", True, "estimation_2026_02", "boutique")
    assert v["prix_maj_le"].startswith("2026-02-15") and v["age_jours"] >= 180
    assert (r["fraicheur"], r["estime"], r["age_jours"]) == ("a_revoir", False, 100)


def test_alias_crud_et_suggestions(base):
    c = base["c"]
    tid = _piece(base, modele="Pytest Canonique B9", type_piece="Batterie", qualite=None, ht=20)
    corps = {"alias": "Pytest  Alias   B9", "modele_canonique": "Pytest Canonique B9", "categorie": None}
    assert c.post("/api/grille/alias", json=corps, headers=H).status_code == 403
    r = c.post("/api/grille/alias", json=corps, headers=HA)
    assert r.status_code == 200 and r.json()["alias"] == "Pytest Alias B9"
    aid = r.json()["id"]
    # Même nom à la casse près : l'alias est remplacé, pas doublé
    r = c.post("/api/grille/alias", json={**corps, "alias": "pytest alias b9"}, headers=HA)
    assert r.json()["id"] == aid
    assert sum(1 for a in c.get("/api/grille/alias", headers=HA).json() if a["alias"].lower() == "pytest alias b9") == 1
    s = c.get("/api/grille/suggestions", params={"marque": "Pytest", "modele": "Pytest Alias B9"}, headers=H).json()
    assert s["modele_trouve"] and [x["id"] for x in s["suggestions"]] == [f"tarifs:{tid}"]
    r = c.post("/api/grille/alias", json={"alias": "Pytest Canonique B9", "modele_canonique": "pytest canonique b9"},
               headers=HA)
    assert r.status_code == 422
    assert c.delete(f"/api/grille/alias/{aid}", headers=HA).status_code == 200
    assert c.delete(f"/api/grille/alias/{aid}", headers=HA).status_code == 404
    s = c.get("/api/grille/suggestions", params={"marque": "Pytest", "modele": "Pytest Alias B9"}, headers=H).json()
    assert s == {"modele_trouve": False, "suggestions": []}


def test_alias_initiaux_poses_une_fois(base):
    from app import main
    alias = {r["alias"] for r in _sql(base, "SELECT alias FROM modeles_alias")}
    assert {a for a, _ in grille.ALIAS_INITIAUX} <= alias
    _sql(base, "DELETE FROM modeles_alias WHERE alias = 'Galaxy Tab A8'")
    try:
        main._donnees_de_demarrage()
        assert not _sql(base, "SELECT 1 FROM modeles_alias WHERE alias = 'Galaxy Tab A8'")
    finally:
        _sql(base, """INSERT INTO modeles_alias (alias, modele_canonique) VALUES ('Galaxy Tab A8', 'Galaxy Tab A8 10.5 (2022)')
                      ON CONFLICT (alias) DO NOTHING""")
        grille.invalider_alias()


def test_sans_prix(base):
    c = base["c"]
    _sql(base, "DELETE FROM catalog_modeles WHERE marque = 'Pytest'")
    _sql(base, """INSERT INTO catalog_modeles (categorie, marque, modele, annee) VALUES
                  ('Smartphone', 'Pytest', 'Pytest Phone B10', 2025), ('Smartphone', 'Pytest', 'Pytest Phone B11', 2024),
                  ('Smartphone', 'Pytest', 'Pytest Phone B12', 2025)""")
    try:
        _piece(base, modele="Pytest Phone B12", type_piece="Batterie", qualite=None, ht=20)
        for _ in range(2):
            _sql(base, """INSERT INTO tickets (categorie, marque, modele, panne, notes_internes)
                          VALUES ('Smartphone', 'Pytest', 'Pytest Phone B11', 'Batterie', %s)""", MARQUEUR)
        _sql(base, """INSERT INTO tickets (categorie, marque, modele, panne, notes_internes, date_depot)
                      VALUES ('Smartphone', 'Pytest', 'Pytest Phone B10', 'Batterie', %s, NOW() - INTERVAL '13 months')""",
             MARQUEUR)
        assert c.get("/api/grille/sans-prix", headers=H).status_code == 403
        r = c.get("/api/grille/sans-prix", headers=HA)
        assert r.status_code == 200
        liste = r.json()
        miens = [m for m in liste if m["marque"] == "Pytest"]
        assert miens == [
            {"categorie": "Smartphone", "marque": "Pytest", "modele": "Pytest Phone B11", "annee": 2024, "tickets_12_mois": 2},
            {"categorie": "Smartphone", "marque": "Pytest", "modele": "Pytest Phone B10", "annee": 2025, "tickets_12_mois": 0},
        ]
        cles = [(-m["tickets_12_mois"], -(m["annee"] or 0)) for m in liste]
        assert cles == sorted(cles)
        assert liste.index(miens[0]) < liste.index(miens[1])
    finally:
        _sql(base, "DELETE FROM catalog_modeles WHERE marque = 'Pytest'")


# ─── Veille : comptages, aucune écriture de prix ─────────────────

def _empreinte_prix(base):
    return _sql(base, """SELECT (SELECT count(*) FROM tarifs_historique) AS hist,
                                (SELECT md5(string_agg(concat_ws('|', id, prix_fournisseur_ht, prix_client, prix_maj_le,
                                                                 prix_source), ',' ORDER BY id)) FROM tarifs) AS t,
                                (SELECT md5(string_agg(concat_ws('|', id, ecran_prix_ht, ecran_prix_vente, prix_maj_le),
                                                       ',' ORDER BY id)) FROM tarifs_apple_devices) AS a""")[0]


def test_veille_comptages_sans_ecriture(base):
    _sql(base, "DELETE FROM params WHERE cle IN (%s, %s)", veille_prix.PARAM_DERNIERE, veille_prix.PARAM_RESUME)
    maintenant = veille_prix.maintenant_utc()
    avant = veille_prix.veille_prix(maintenant, notifier=False, forcer=True)
    jours = lambda n: (maintenant - timedelta(days=n)).strftime("%Y-%m-%d %H:%M:%S")  # noqa: E731
    # 3 lignes vieilles (100, 200, 400 jours), 1 récente à marge faible (écran vendu HT×1,2 + 10 €)
    _piece(base, modele="Pytest Veille 1", maj=jours(100), source="import")
    _piece(base, modele="Pytest Veille 2", maj=jours(200), source="import")
    _piece(base, modele="Pytest Veille 3", maj=jours(400))
    faible = _piece(base, modele="Pytest Veille 4", maj=jours(5), source="commande")
    _sql(base, "UPDATE tarifs SET prix_client = 130 WHERE id = %s", faible)
    empreinte = _empreinte_prix(base)
    apres = veille_prix.veille_prix(maintenant + timedelta(days=8), notifier=False)
    assert apres is not None
    delta = {k: apres[k] - avant[k] for k in ("total", "a_revoir", "perimes", "estimes", "marges_faibles")}
    assert delta == {"total": 4, "a_revoir": 1, "perimes": 2, "estimes": 1, "marges_faibles": 1}
    assert _empreinte_prix(base) == empreinte                 # aucun prix écrit, aucun historique
    # Passage déjà fait cette semaine : rien
    assert veille_prix.veille_prix(maintenant + timedelta(days=9), notifier=False) is None
    lu = json.loads(_sql(base, "SELECT valeur FROM params WHERE cle = %s", veille_prix.PARAM_RESUME)[0]["valeur"])
    assert lu["total"] == apres["total"] and isinstance(lu["modeles_sans_prix"], int)
    assert _sql(base, "SELECT valeur FROM params WHERE cle = %s", veille_prix.PARAM_DERNIERE)[0]["valeur"] == \
        (maintenant + timedelta(days=8)).isoformat(timespec="seconds")
    # /api/tarifs/sante relit le résumé (modèles sans prix, date de la veille)
    with base["cur"]() as cur:
        params_cache.invalidate()
        s = prix_srv.sante(cur)
    assert s["modeles_sans_prix"] == apres["modeles_sans_prix"] and s["derniere_veille"]


def test_veille_notifie(base):
    n0 = _sql(base, "SELECT count(*) AS n FROM notifications_center WHERE type = 'veille_prix'")[0]["n"]
    r = veille_prix.veille_prix(notifier=True, forcer=True)
    notifs = _sql(base, "SELECT title, message, target_user FROM notifications_center WHERE type = 'veille_prix' "
                        "ORDER BY id DESC")
    assert len(notifs) == n0 + 1 and notifs[0]["title"] == "Veille des prix" and notifs[0]["target_user"] is None
    assert notifs[0]["message"] == veille_prix.message(r)


# ─── LCD-Phone : routes admin, état durable, upsert ──────────────

def test_sync_et_probe_admin(base, monkeypatch):
    c = base["c"]
    lances = []
    monkeypatch.setattr(telephones, "_run_sync_background", lambda: lances.append(1))
    from app.services import scraper_lcdphone
    monkeypatch.setattr(scraper_lcdphone, "probe_lcdphone", lambda: {"success": True, "pytest": True})
    monkeypatch.setattr(telephones, "_sync_status", {"running": False, "last_result": None, "started_at": None})
    assert c.post("/api/telephones/sync", headers=H).status_code == 403
    assert c.get("/api/telephones/probe", headers=H).status_code == 403
    sans_code = {"Authorization": f"Bearer {create_token('accueil', ADMIN)}"}
    assert c.post("/api/telephones/sync", headers=sans_code).json()["detail"]["code"] == "admin_requis"
    r = c.post("/api/telephones/sync", headers=HA)
    assert r.status_code == 200 and lances == [1]       # plus de 403 pour un admin prouvé
    assert c.get("/api/telephones/probe", headers=HA).json() == {"success": True, "pytest": True}


def test_sync_status_relu_apres_redemarrage(base, monkeypatch):
    c = base["c"]
    resultat = {"success": True, "total": 42, "inserted": 2, "updated": 40, "marques": 4, "debug": {"x": 1}}
    telephones._noter_synchro(resultat, "2026-10-16T08:00:00", "2026-10-16T08:05:00")
    # Redémarrage : état mémoire perdu
    monkeypatch.setattr(telephones, "_sync_status", {"running": False, "last_result": None, "started_at": None})
    params_cache.invalidate()
    s = c.get("/api/telephones/sync-status", headers=H).json()
    assert s["running"] is False and s["derniere_synchro"] == "2026-10-16T08:05:00" and s["synchro_ok"] is True
    assert s["finished_at"] == "2026-10-16T08:05:00" and s["started_at"] == "2026-10-16T08:00:00"
    assert s["last_result"]["total"] == 42 and s["last_result"]["marques"] == 4 and "debug" not in s["last_result"]
    with base["cur"]() as cur:
        params_cache.invalidate()
        assert prix_srv.sante(cur)["lcdphone"] == {"derniere_synchro": "2026-10-16T08:05:00", "ok": True}
    telephones._noter_synchro({"success": False, "error": "Identifiants LCD-Phone invalides"},
                              "2026-10-16T09:00:00", "2026-10-16T09:00:02")
    params_cache.invalidate()
    s = c.get("/api/telephones/sync-status", headers=H).json()
    assert s["synchro_ok"] is False and s["last_result"]["error"] == "Identifiants LCD-Phone invalides"


def _produit(ref, **kw):
    p = {"marque": "Apple", "modele": "iPhone 14", "stockage": "128 Go", "couleur": "Bleu", "grade": "Grade A",
         "type_produit": "occasion", "prix_fournisseur": 400.0, "prix_vente": 480.0, "marge_appliquee": 80.0,
         "stock_fournisseur": 1, "en_stock": True, "reference_fournisseur": ref, "das": None,
         "image_url": "", "source_url": ""}
    p.update(kw)
    return p


def test_upsert_type_produit_et_rollback(base):
    import psycopg2.extras
    conn = base["pool"].getconn()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""INSERT INTO telephones_catalogue (marque, modele, type_produit, prix_fournisseur, prix_vente,
                                                         reference_fournisseur, actif)
                       VALUES ('Apple', 'iPhone 14', 'reconditionné', 390, 470, 'pytest-1', TRUE)""")
        ins, maj = lcd.enregistrer_produits(cur, [_produit("pytest-1"), _produit("pytest-2", type_produit="neuf"),
                                                  _produit("pytest-3", type_produit="reconditionné")])
        assert (ins, maj) == (2, 1)
        cur.execute("""SELECT reference_fournisseur AS ref, type_produit, actif FROM telephones_catalogue
                       WHERE reference_fournisseur LIKE 'pytest-%%' ORDER BY 1""")
        assert [tuple(r.values()) for r in cur.fetchall()] == [
            ("pytest-1", "occasion", True), ("pytest-2", "neuf", True), ("pytest-3", "occasion", True)]
        cur.execute("SELECT count(*) AS n FROM telephones_catalogue WHERE type_produit NOT IN ('neuf', 'occasion') AND actif")
        assert cur.fetchone()["n"] == 0
    finally:
        conn.rollback()
        base["pool"].putconn(conn)

    # Erreur au milieu : toute la synchro est annulée
    actifs = _sql(base, "SELECT count(*) AS n FROM telephones_catalogue WHERE actif")[0]["n"]
    with pytest.raises(Exception):
        with base["cur"]() as cur:
            lcd.enregistrer_produits(cur, [_produit("pytest-4"), _produit("pytest-5", prix_fournisseur="pas un prix")])
    assert _sql(base, "SELECT count(*) AS n FROM telephones_catalogue WHERE actif")[0]["n"] == actifs
    assert not _sql(base, "SELECT 1 FROM telephones_catalogue WHERE reference_fournisseur = 'pytest-4'")


# ═══ Base chargée avec les grilles de la prod ══════════════════

@pytest.fixture(scope="module")
def prod(base):
    n = _sql(base, "SELECT count(*) AS n FROM tarifs WHERE prix_source = 'estimation_2026_02' AND nom_fournisseur <> %s",
             MARQUEUR)[0]["n"]
    if n < 1000:
        pytest.skip("Base sans les grilles de la prod (tarifs estimés du 2026-02-15)")
    return base


def _suggest(base, **params):
    r = base["c"].get("/api/grille/suggestions", params=params, headers=H)
    assert r.status_code == 200, r.text
    return r.json()


def test_prod_iphone13_fraicheur_et_repli(prod):
    s = _suggest(prod, marque="Apple", modele="iPhone 13", categorie="Smartphone", limit=50)
    assert s["modele_trouve"] and {x["modele"] for x in s["suggestions"]} <= {"iPhone 13"}
    fournisseur = [x for x in s["suggestions"] if x["source"] == "tarifs"]
    assert fournisseur and all(x["fraicheur"] == "perime" and x["estime"] and x["prix_maj_le"].startswith("2026-02-15")
                               for x in fournisseur)
    boutique = [x for x in s["suggestions"] if x["source"] == "tarifs_reparation"]
    assert boutique and all(x["groupe"] == "boutique" and x["estime"] is False and x["prix_source"] is None
                            for x in boutique)
    # Écran, batterie, connecteur… couverts par la grille boutique : pièces fournisseur repliées
    for x in fournisseur:
        attendu = "fournisseur" if grille.P.cle_panne(x["type_piece"]) in {
            "ecran", "batterie", "connecteur", "ecouteur", "camera_arriere", "camera_avant", "vitre_arriere"} \
            else "boutique"
        assert x["groupe"] == attendu, x
    assert all(x["groupe"] == "vente" for x in s["suggestions"] if x["source"] == "iphone_tarifs")


@pytest.mark.parametrize("modele", ["iPhone 15 Pro", "iPhone 12", "iPhone 13 Pro Max", "iPhone 14 Pro Max", "iPhone 13"])
def test_prod_limite_20_garde_toute_la_grille_boutique(prod, modele):
    """limit=20 (TarifPicker) : toute la grille boutique et les ventes, les pièces repliées dans le reste."""
    tout = _suggest(prod, marque="Apple", modele=modele, categorie="Smartphone", limit=50)["suggestions"]
    vingt = _suggest(prod, marque="Apple", modele=modele, categorie="Smartphone", limit=20)["suggestions"]
    grille_boutique = {x["id"] for x in tout if x["source"] == "tarifs_reparation"}
    principales = {x["id"] for x in tout if x["groupe"] != "fournisseur"}
    assert len(grille_boutique) >= 10 and len(principales) <= 20
    ids = {x["id"] for x in vingt}
    assert grille_boutique <= ids and principales <= ids
    assert len(vingt) == min(20, len(tout))
    groupes = [x["groupe"] == "fournisseur" for x in vingt]
    assert groupes == sorted(groupes)          # pièces repliées après la grille boutique et les ventes


def test_prod_samsung_sans_repli(prod):
    s = _suggest(prod, marque="Samsung", modele="Galaxy S21", categorie="Smartphone")
    assert s["modele_trouve"]
    assert all(x["groupe"] in ("boutique", "vente") for x in s["suggestions"])
    assert {x["modele"] for x in s["suggestions"] if x["source"] == "tarifs"} == {"Galaxy S21"}


@pytest.mark.parametrize("marque, modele, attendu", [
    ("Oppo", "Reno10", {"Reno 10"}),
    ("Oppo", "Reno10 Pro", {"Reno 10 Pro"}),
    ("OnePlus", "Nord CE4 Lite", {"Nord CE 4 Lite"}),
    ("Apple", "MacBook Air 13 M3", {'MacBook Air 13" M3 A3113 (2024)'}),
    ("Apple", "iPad Pro 11 M1", {'iPad Pro 11" 3e gen M1 (2021)'}),
    ("Apple", "MacBook Pro 16 M3", {'MacBook Pro 16" M3 Pro/Max A2991 (2023)'}),     # alias initial
    ("Samsung", "Galaxy Tab A8", {"Galaxy Tab A8 10.5 (2022)"}),                     # alias initial
    ("Apple", "iPhone 13 mini", {"iPhone 13 Mini", "iPhone 13 mini"}),
])
def test_prod_noms_reels(prod, marque, modele, attendu):
    s = _suggest(prod, marque=marque, modele=modele, limit=50)
    assert s["modele_trouve"] and {x["modele"] for x in s["suggestions"]} == attendu


@pytest.mark.parametrize("marque, modele", [
    ("Xiaomi", "POCO X6"), ("Huawei", "P40"), ("Samsung", "Galaxy Tab S6"), ("Huawei", "P40 Lite E"),
])
def test_prod_sans_faux_positif(prod, marque, modele):
    assert _suggest(prod, marque=marque, modele=modele) == {"modele_trouve": False, "suggestions": []}


# Clé de modèle d'avant le lot 6 (référence de la couverture gagnée)
def _cle_ancienne(modele, marque=""):
    def garder(contenu):
        mots = normaliser(contenu).split()
        return bool(mots) and (grille._ANNEE.fullmatch(contenu.strip()) is not None
                               or any(m in grille._MOTS_GENERATION for m in mots)
                               or all(m in grille._RESEAU for m in mots))
    s = re.sub(r"\(([^)]*)\)", lambda m: f" {m.group(1)} " if garder(m.group(1)) else " ", str(modele or ""))
    toks = grille._sans_marque(normaliser(s.replace("+", " plus ")).split(), marque)
    gamme = grille._compact(marque)
    if gamme in grille._GAMMES and (not toks or toks[0] != gamme):
        toks = [gamme] + toks
    return " ".join(grille._generation_se([t for t in toks if t != "galaxy"]))


def _couverts_avant(base) -> int:
    lignes = _sql(base, "SELECT 'tarifs' AS s, marque, modele FROM tarifs WHERE prix_client > 0 AND nom_fournisseur <> %s "
                        "UNION ALL SELECT 'tarifs_reparation', 'Apple', modele FROM tarifs_reparation "
                        "WHERE GREATEST(COALESCE(ecran_generique,0), COALESCE(ecran_confort,0), COALESCE(ecran_apple,0), "
                        "COALESCE(batterie,0), COALESCE(desoxydation,0), COALESCE(connecteur_charge,0), "
                        "COALESCE(reparation_divers,0), COALESCE(ecouteur_apn,0), COALESCE(vitre_arriere,0), "
                        "COALESCE(chassis,0)) > 0 "
                        "UNION ALL SELECT 'tarifs_apple_devices', 'Apple', modele FROM tarifs_apple_devices "
                        "WHERE actif IS NOT FALSE AND (COALESCE(ecran_prix_vente,0) > 0 OR COALESCE(batterie_prix_vente,0) > 0)",
                 MARQUEUR)
    index = {}
    for l in lignes:
        m = grille.marque_canonique(l["marque"])
        for v in grille.variantes(l["modele"]):
            c = _cle_ancienne(v, l["marque"])
            index.setdefault(l["s"], set()).update({("e", m, c), ("s", m, grille.cle_souple(c))})
    n = 0
    for r in _sql(base, "SELECT categorie, marque, modele FROM catalog_modeles WHERE actif IS NOT FALSE"):
        sources = grille._SOURCES_PAR_CATEGORIE.get(normaliser(r["categorie"]), grille._SOURCES_REPARATION)
        m, c = grille.marque_canonique(r["marque"]), _cle_ancienne(r["modele"], r["marque"])
        if any(("e", m, c) in index.get(s, ()) or ("s", m, grille.cle_souple(c)) in index.get(s, ())
               for s in sources & grille._SOURCES_REPARATION):
            n += 1
    return n


def test_prod_couverture_du_catalogue(prod):
    total = _sql(prod, "SELECT count(*) AS n FROM catalog_modeles WHERE actif IS NOT FALSE")[0]["n"]
    with prod["cur"]() as cur:
        grille.invalider_alias()
        sans = grille.modeles_sans_prix(cur)
    apres, avant = total - len(sans), _couverts_avant(prod)
    print(f"\nCouverture du catalogue : {avant} → {apres} modèles avec un prix (+{apres - avant}) sur {total}")
    assert apres - avant >= 30
    sans_noms = {(m["marque"], m["modele"]) for m in sans}
    assert {("Oppo", "Reno10"), ("OnePlus", "Nord CE4 Lite"), ("Apple", "MacBook Air 13 M3"),
            ("Apple", "iPad Air M1"), ("Samsung", "Galaxy Tab A7")}.isdisjoint(sans_noms)
    assert {("Xiaomi", "POCO X6"), ("Huawei", "P40"), ("Samsung", "Galaxy Tab S6")} <= sans_noms
