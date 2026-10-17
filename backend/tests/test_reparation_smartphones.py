"""Réparation smartphones (B1 — backend prix) : marques → modèles → pièces avec le détail du calcul,
pièces courantes « prix à renseigner » (grille des pièces, ou fiche iPad / Mac avec la règle de
marge iPad / MacBook), alerte sur les pièces iPad / Mac rangées dans la grille des pièces,
modèle inconnu refusé (404), compteur `a_renseigner` de la santé des prix, encadré « Méthode de
calcul » selon le rôle, PATCH /prix étendu (source utopya / mobilax, référence et URL
fournisseur), liens profonds, vérification automatique du stock Mobilax retirée.

Les tests purs tournent toujours et n'ouvrent AUCUNE connexion réseau (socket bloqué par une
fixture du module). Ceux sur base réelle exigent une base PostgreSQL JETABLE chargée avec la copie
des grilles de la prod (mêmes fixtures que tests/test_prix_moteur.py) :
    KP_PRIX_DATABASE_URL="postgresql://postgres:<mdp>@127.0.0.1:5432/kp_prix?sslmode=disable" \\
    KP_PRIX_CSV_DIR=<dossier des CSV de la prod> pytest tests/test_reparation_smartphones.py
"""

import random
import socket
from decimal import Decimal
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.api import tarifs as tarifs_api
from app.services import params as params_cache
from app.services import prix
from tests.test_prix_moteur import (  # noqa: F401  (fixtures reel et base)
    CSV_DIR, _empreinte, _h_admin, _h_staff, _id, _n_historique, _sql, _tarif, base, reel,
)
from tests.test_securite_c1 import _ADMIN_PROUVE, _headers, fake_db

URL_PIECES = "/api/tarifs/reparation-smartphones/pieces-courantes"
URL_METHODE = "/api/tarifs/methode-calcul"


# ═══ Aucune requête réseau, jamais ═════════════════════════════

@pytest.fixture(autouse=True)
def _reseau_interdit(monkeypatch):
    """Tout accès réseau Python (DNS, connexion) échoue : les routes n'en font aucun.
    (psycopg2 passe par libpq, TestClient reste en mémoire : la base réelle fonctionne.)"""
    def refus(*a, **k):
        raise AssertionError("requête réseau interdite dans ces tests")
    monkeypatch.setattr(socket, "getaddrinfo", refus)
    monkeypatch.setattr(socket, "create_connection", refus)
    yield


def test_module_tarifs_sans_code_reseau():
    src = open(tarifs_api.__file__, encoding="utf-8").read()
    assert "httpx" not in src and "requests." not in src and "urlopen" not in src
    for nom in ("verifier_stock_mobilax", "_MOBILAX_HEADERS", "_extract_products", "_match_stock", "_tache_stock"):
        assert not hasattr(tarifs_api, nom)


# ═══ Détail du calcul = prix_client ════════════════════════════

def test_calcul_detail_exemple_du_contrat():
    d = prix.calcul_detail("42.00", "Ecran", "standard", prix.REGLES_DEFAUT)
    assert d == {"ht": 42.0, "tva": 1.2, "marge": 60, "brut": 110.4, "arrondi": 119}
    assert prix.calcul_detail(42, "Ecran", "haut_de_gamme", prix.REGLES_DEFAUT)["marge"] == 70
    assert prix.calcul_detail(42, "Écran", "pliant", prix.REGLES_DEFAUT)["marge"] == 100
    assert prix.calcul_detail(42, "Batterie", "haut_de_gamme", prix.REGLES_DEFAUT)["marge"] == 60
    assert prix.calcul_detail_apple(50, "ipad", prix.REGLES_DEFAUT) == {
        "ht": 50.0, "tva": 1.2, "marge": 110, "brut": 170.0, "arrondi": 179}
    assert prix.calcul_detail_apple(50, "macbook", prix.REGLES_DEFAUT)["marge"] == 120


def test_calcul_detail_coherent_avec_prix_client_toutes_regles():
    rng = random.Random(2026)
    regles_variantes = [
        prix.REGLES_DEFAUT,
        prix.valider_regles({"ecran": {"standard": 65, "haut_de_gamme": 75, "pliant": 120}, "autre": 55}),
        prix.valider_regles({"tva": 1.1, "arrondi": "entier", "ipad": 95, "macbook": 130}),
    ]
    types = ("Ecran", "Écran", "Batterie", "Connecteur de charge", "Vitre arriere", "Camera arriere")
    for r in regles_variantes:
        for _ in range(400):
            ht = Decimal(rng.randrange(1, 500000)) / 100
            tp, cat = rng.choice(types), rng.choice(prix.CATEGORIES_ECRAN + (None, ""))
            d = prix.calcul_detail(ht, tp, cat, r)
            assert d["arrondi"] == prix.prix_client(ht, tp, cat, r)
            assert d["marge"] == prix.marge_piece(tp, cat, r) and d["tva"] == r["tva"]
            assert d["brut"] == round(float(ht) * r["tva"] + d["marge"], 2)
            assert d["ht"] == float(ht) and d["arrondi"] >= d["brut"] - 0.005
            for cat_apple in ("ipad", "macbook"):
                da = prix.calcul_detail_apple(ht, cat_apple, r)
                assert da["arrondi"] == prix.prix_apple(ht, cat_apple, r)
                assert da["marge"] == (r["ipad"] if cat_apple == "ipad" else r["macbook"])


def test_sources_de_saisie_passent_le_verrou_pas_les_autres():
    assert set(prix.SOURCES_SAISIE) == {"manuel", "utopya", "mobilax"} and set(prix.SOURCES_SAISIE) <= set(prix.SOURCES)
    with pytest.raises(ValueError):
        prix.ecrire_prix_lot(None, "tarifs", [(1, "prix_client", 9)], "lcdphone", "x")

    class Cur:
        def __init__(self):
            self.sql = []

        def execute(self, sql, params=None):
            self.sql.append(sql)

        def fetchall(self):
            return [{"id": 1, "prix_fournisseur_ht": Decimal("10.00"), "prix_maj_le": None,
                     "prix_source": "manuel", "verrou_manuel": True}]

    for source, attendu in (("manuel", []), ("utopya", []), ("mobilax", []), ("import", [1]), ("commande", [1])):
        with patch("app.services.prix.execute_values") as ev:
            res = prix.ecrire_prix_lot(Cur(), "tarifs", [(1, "prix_fournisseur_ht", 12)], source, "x")
        assert res["verrouilles"] == attendu, source
        assert (ev.call_count > 0) == (attendu == [])
    # Écriture en masse de source de saisie : le verrou tient
    with patch("app.services.prix.execute_values"):
        assert prix.ecrire_prix_lot(Cur(), "tarifs", [(1, "prix_fournisseur_ht", 12)], "utopya", "x",
                                    saisie=False)["verrouilles"] == [1]


# ═══ Liens profonds (jamais ouverts par le serveur) ════════════

@pytest.mark.parametrize("marque, modele, type_piece, utopya, mobilax", [
    ("Samsung", "Galaxy A54", "Ecran",
     "https://www.utopya.fr/catalogsearch/result/?q=Samsung+Galaxy+A54+ecran",
     "https://www.mobilax.fr/pieces-detachees/telephonie/samsung/galaxy-a/galaxy-a54"),
    ("Xiaomi", "Redmi Note 12", "Batterie",
     "https://www.utopya.fr/catalogsearch/result/?q=Xiaomi+Redmi+Note+12+batterie",
     "https://www.mobilax.fr/marques/xiaomi/telephonie/redmi-note-series/redmi-note-12"),
    ("Apple", "iPhone 13", "Ecran",
     "https://www.utopya.fr/catalogsearch/result/?q=Apple+iPhone+13+ecran",
     "https://www.mobilax.fr/pieces-detachees/telephonie/apple/iphone/iphone-13"),
    # iPad : pas de motif de catégorie connu → recherche du site
    ("Apple", "iPad 10", None,
     "https://www.utopya.fr/catalogsearch/result/?q=Apple+iPad+10",
     "https://www.mobilax.fr/recherche?q=Apple+iPad+10"),
    ("Realme", "C55", "Connecteur de charge",
     "https://www.utopya.fr/catalogsearch/result/?q=Realme+C55+connecteur+de+charge",
     "https://www.mobilax.fr/recherche?q=Realme+C55+connecteur+de+charge"),
    # Marque déjà en tête du modèle : pas répétée
    ("Xiaomi", "Xiaomi 13T", "Écran",
     "https://www.utopya.fr/catalogsearch/result/?q=Xiaomi+13T+ecran",
     "https://www.mobilax.fr/marques/xiaomi/telephonie/mi-series/xiaomi-13t"),
])
def test_liens_fournisseurs(marque, modele, type_piece, utopya, mobilax):
    assert tarifs_api.lien_utopya(marque, modele, type_piece) == utopya
    assert tarifs_api.lien_mobilax(marque, modele, type_piece) == mobilax
    liens = tarifs_api._liens(marque, modele, type_piece)
    assert set(liens) == {"utopya", "mobilax"} and liens["utopya"].startswith("https://www.utopya.fr/")
    assert liens["mobilax"].startswith("https://www.mobilax.fr/")


def test_slug_et_iphone():
    assert tarifs_api._slugify("Galaxy A54 5G") == "galaxy-a54-5g"
    assert tarifs_api._slugify("Écran Reno10 Pro+") == "ecran-reno10-pro"
    assert tarifs_api._est_iphone("iPhone 13", "Apple") and tarifs_api._est_iphone("iPhone SE 2022", "Apple")
    assert tarifs_api._est_iphone("iphone 12 / 12 Pro", "Apple")
    assert not tarifs_api._est_iphone("iPad 10", "Apple") and not tarifs_api._est_iphone("MacBook Air 13 M3", "Apple")


@pytest.mark.parametrize("url, source, attendu", [
    (None, "manuel", None),
    ("   ", "utopya", None),
    ("https://www.utopya.fr/ecran-galaxy-a54.html", "utopya", "https://www.utopya.fr/ecran-galaxy-a54.html"),
    ("https://mobilax.fr/x", "mobilax", "https://mobilax.fr/x"),
    ("https://www.example.com/piece", "manuel", "https://www.example.com/piece"),
    ("https://www.mobilax.fr/x", "utopya", 400),
    ("https://utopya.fr.evil.example/x", "utopya", 400),
    ("javascript:alert(1)", "manuel", 400),
    ("ftp://www.utopya.fr/x", "utopya", 400),
    ("www.utopya.fr/x", "utopya", 400),
    ("https://www.utopya.fr/x y", "utopya", 400),
    ("https://www.utopya.fr/" + "a" * 500, "utopya", 400),
])
def test_validation_url_fournisseur(url, source, attendu):
    if attendu == 400:
        with pytest.raises(HTTPException) as exc:
            tarifs_api._valider_url_fournisseur(url, source)
        assert exc.value.status_code == 400
    else:
        assert tarifs_api._valider_url_fournisseur(url, source) == attendu


# ═══ Routes avec base simulée : élévation et validation ════════

def test_patch_prix_403_sans_role_admin_puis_422_source_inconnue(client):
    _, gc_role = fake_db(lambda sql, params: None)
    with patch("app.api.auth.get_cursor", gc_role):
        r = client.patch("/api/tarifs/1/prix", headers=_headers(), json={"prix_fournisseur_ht": 10, "source": "utopya"})
        assert r.status_code == 403
        assert client.post("/api/tarifs/reparation-smartphones/pieces-courantes", headers=_headers(),
                           json={"marque": "Samsung", "modele": "Galaxy A54"}).status_code == 403
        assert client.patch("/api/tarifs/apple-devices/1/prix", headers=_headers(),
                            json={"piece": "ecran", "prix_fournisseur_ht": 10}).status_code == 403
    cur, gc_admin = fake_db(lambda sql, params: _ADMIN_PROUVE if "membres_equipe" in sql else None)
    with patch("app.api.auth.get_cursor", gc_admin), patch("app.api.tarifs.get_cursor", gc_admin):
        r = client.patch("/api/tarifs/1/prix", headers=_headers(), json={"prix_fournisseur_ht": 10, "source": "lcdphone"})
        assert r.status_code == 422
        r = client.patch("/api/tarifs/1/prix", headers=_headers(),
                         json={"prix_fournisseur_ht": 10, "source": "utopya", "url_fournisseur": "https://www.mobilax.fr/x"})
        assert r.status_code == 400 and "Utopya" in r.json()["detail"]
        r = client.patch("/api/tarifs/apple-devices/1/prix", headers=_headers(),
                         json={"piece": "clavier", "prix_fournisseur_ht": 10})
        assert r.status_code == 422
        r = client.post("/api/tarifs/reparation-smartphones/pieces-courantes", headers=_headers(),
                        json={"marque": "Apple", "modele": "iPhone 13"})
        assert r.status_code == 400 and "iPhone" in r.json()["detail"]
        # Modèle ni au catalogue ni dans la grille (base vide ici) : 404, pas de modèle fantôme
        r = client.post(URL_PIECES, headers=_headers(), json={"marque": "Samsung", "modele": "Galaxy Z99 Ultra"})
        assert r.status_code == 404 and "catalogue" in r.json()["detail"]
    assert not any("UPDATE tarifs" in s or "INSERT INTO tarifs" in s for s in cur.sql())


def test_methode_calcul_route_selon_le_role(client):
    _, gc_staff = fake_db(lambda sql, params: None if "membres_equipe" in sql else [])
    with patch("app.api.auth.get_cursor", gc_staff), patch("app.api.tarifs.get_cursor", gc_staff):
        r = client.get(URL_METHODE, headers=_headers())
        assert r.status_code == 200, r.text
        assert r.json() == prix.methode_calcul(prix.REGLES_DEFAUT, admin=False)
        assert r.json()["admin"] is False and "60" not in r.json()["texte"]
    _, gc_admin = fake_db(lambda sql, params: _ADMIN_PROUVE if "membres_equipe" in sql else [])
    with patch("app.api.auth.get_cursor", gc_admin), patch("app.api.tarifs.get_cursor", gc_admin):
        r = client.get(URL_METHODE, headers=_headers())
        assert r.status_code == 200 and r.json() == prix.methode_calcul(prix.REGLES_DEFAUT, admin=True)
        assert "marge 60 € (écran standard, autres pièces)" in r.json()["texte"]
    assert client.get(URL_METHODE).status_code in (401, 403)   # sans jeton


# ═══ Méthode de calcul : les montants des marges pour l'admin seulement ═══

def test_methode_calcul_texte_selon_le_role():
    staff = prix.methode_calcul(prix.REGLES_DEFAUT, admin=False)
    assert staff == {
        "admin": False, "regles": None, "exemple": None,
        "texte": "Prix client = arrondi au 9 supérieur de (prix fournisseur HT × 1,2 + marge selon la pièce) · "
                 "le montant des marges est réservé au gérant (code admin)"}
    admin = prix.methode_calcul(prix.REGLES_DEFAUT, admin=True)
    assert admin["admin"] is True
    # Mot pour mot la phrase du contrat
    assert admin["texte"] == ("Prix client = arrondi au 9 supérieur de (prix fournisseur HT × 1,2 + marge) · "
                              "marge 60 € (écran standard, autres pièces), 70 € (écran haut de gamme), 100 € (pliant) · "
                              "iPad +110 €, MacBook +120 €")
    assert admin["regles"] == {"tva": 1.2, "arrondi": "9_sup", "ecran": {"standard": 60, "haut_de_gamme": 70, "pliant": 100},
                               "autre": 60, "ipad": 110, "macbook": 120}   # sans les seuils d'alerte
    assert admin["exemple"] == {"ht": 42.0, "tva": 1.2, "marge": 60, "brut": 110.4, "arrondi": 119}
    # Règles modifiées : la phrase de l'admin suit, celle du personnel ne révèle rien
    r = prix.valider_regles({"tva": 1.1, "arrondi": "entier", "autre": 55, "ecran": {"standard": 62.5}})
    a = prix.methode_calcul(r, admin=True)
    assert a["texte"] == ("Prix client = arrondi à l'euro supérieur de (prix fournisseur HT × 1,1 + marge) · "
                          "marge 62,5 € (écran standard), 70 € (écran haut de gamme), 100 € (pliant), 55 € (autres pièces) · "
                          "iPad +110 €, MacBook +120 €")
    assert a["regles"]["autre"] == 55 and a["exemple"]["arrondi"] == prix.prix_client(42, "Ecran", "standard", r)
    s = prix.methode_calcul(r, admin=False)
    assert "arrondi à l'euro supérieur" in s["texte"] and "× 1,1" in s["texte"]
    assert not any(m in s["texte"] for m in ("55", "62", "70", "100", "110", "120"))


# ═══ Lignes « prix à renseigner » : ni fraîches ni périmées ════

def test_fraicheur_ligne_a_renseigner():
    r = prix.REGLES_DEFAUT
    row = tarifs_api._fraicheur({"prix_client": 0, "prix_source": "a_renseigner", "age_jours": None}, r)
    assert (row["fraicheur"], row["a_renseigner"], row["estime"]) == (None, True, False)
    row = tarifs_api._fraicheur({"prix_client": 119, "prix_source": "utopya", "age_jours": 0, "age_secondes": 5.0}, r)
    assert (row["fraicheur"], row["a_renseigner"]) == ("ok", False) and "age_secondes" not in row
    assert tarifs_api._fraicheur({"prix_client": None, "age_jours": 300}, r)["fraicheur"] is None
    # iPad / MacBook : jugé sur l'écran (convention de prix.sante)
    assert tarifs_api._fraicheur({"ecran_prix_vente": 0, "batterie_prix_vente": 129, "age_jours": None}, r)["fraicheur"] is None
    assert tarifs_api._fraicheur({"ecran_prix_vente": 159, "age_jours": None}, r)["fraicheur"] == "perime"
    # Ligne sans colonne de prix : comportement inchangé
    assert tarifs_api._fraicheur({"age_jours": 200}, r) == {"age_jours": 200, "a_renseigner": False,
                                                            "fraicheur": "perime", "estime": False}


# ═══ iPad / MacBook : catégorie de la fiche Apple, familles de pièces ═══

@pytest.mark.parametrize("modele, cat, attendu", [
    ("iPad 11 A16", "Tablette", "ipad"), ("MacBook Pro 14 M5", "PC Portable", "macbook"),
    ("iPad Pro 11 (2021/2022)", None, "ipad"), ('MacBook Air 13" M3 A3113 (2024)', None, "macbook"),
    ("iMac 24", None, "macbook"), ("Apple Watch 9", None, None), ("iPhone 13", "Smartphone", None),
    ("Galaxy Tab S9", "Tablette", "ipad"),   # la catégorie du catalogue prime (marque Apple supposée par l'appelant)
])
def test_categorie_apple(modele, cat, attendu):
    assert tarifs_api._categorie_apple(modele, cat) == attendu


def test_famille_de_piece():
    assert tarifs_api._famille("Écran LCD") == tarifs_api._famille("Ecran") == "ecran"
    assert tarifs_api._famille("Connecteur de charge") == "connecteur" and tarifs_api._famille("Batterie") == "batterie"
    assert tarifs_api._famille("Vitre camera arriere") == "vitre camera arriere"


def test_alerte_marge_pieces_ipad_dans_la_grille_des_pieces():
    r = prix.REGLES_DEFAUT
    piece = {"table": "tarifs", "type_piece": "Ecran", "categorie": "standard", "ht": 48, "client": 119}
    assert tarifs_api._alerte_marge(piece, None, True, r) is None                       # pas un iPad / Mac
    assert tarifs_api._alerte_marge({**piece, "table": "tarifs_apple_devices"}, "ipad", True, r) is None
    a = tarifs_api._alerte_marge(piece, "ipad", True, r)
    assert a == {"code": "apple_grille_pieces", "categorie_attendue": "ipad", "message": a["message"],
                 "marge_appliquee": 60, "marge_attendue": 110, "prix_attendu": 169}    # 48 × 1,2 + 110 = 167,6 → 169
    assert "iPad" in a["message"] and "écran standard" in a["message"] and "arbitrer" in a["message"]
    staff = tarifs_api._alerte_marge(piece, "ipad", False, r)
    assert set(staff) == {"code", "categorie_attendue", "message"}                       # aucun montant
    b = tarifs_api._alerte_marge({**piece, "type_piece": "Batterie", "ht": 0, "client": 0}, "macbook", True, r)
    assert b["marge_attendue"] == 120 and b["prix_attendu"] is None and "autres pièces" in b["message"] and "MacBook" in b["message"]


def test_lecture_sans_admin_et_check_stock_desactive(client):
    cur, gc = fake_db(lambda sql, params: _ADMIN_PROUVE if "membres_equipe" in sql else [])
    with patch("app.api.auth.get_cursor", gc), patch("app.api.tarifs.get_cursor", gc), \
            patch("app.api.grille.get_cursor", gc):
        assert client.get("/api/tarifs/reparation-smartphones/marques", headers=_headers()).json() == []
        r = client.get("/api/tarifs/reparation-smartphones/modele", headers=_headers(),
                       params={"marque": "Samsung", "modele": "Galaxy A54"})
        assert r.status_code == 200 and r.json()["modele_trouve"] is False and r.json()["pieces"] == []
        assert r.json()["liens"]["mobilax"].endswith("/samsung/galaxy-a/galaxy-a54")
        r = client.post("/api/tarifs/check-stock", headers=_headers())
        assert r.status_code == 200 and r.json() == {"lance": False, **tarifs_api._etat_stock()}
        assert client.get("/api/tarifs/check-stock/status", headers=_headers()).json()["desactive"] is True


# ═══ Base réelle (copie des grilles de la prod) ════════════════

def _prod(base):
    if not CSV_DIR or _sql(base, "SELECT count(*) AS n FROM tarifs")[0]["n"] != 1202:
        pytest.skip("Base sans la copie des grilles de la prod (KP_PRIX_CSV_DIR)")


def _marques(base, h=None):
    r = base["c"].get("/api/tarifs/reparation-smartphones/marques", headers=h or _h_staff())
    assert r.status_code == 200, r.text
    return r.json()


def _modele(base, marque, modele, h=None):
    r = base["c"].get("/api/tarifs/reparation-smartphones/modele", headers=h or _h_staff(),
                      params={"marque": marque, "modele": modele})
    assert r.status_code == 200, r.text
    return r.json()


def _entree(marques, marque_c, modele):
    m = next(x for x in marques if x["marque_c"] == marque_c)
    return next(e for e in m["modeles"] if e["modele"] == modele)


def test_reel_calcul_detail_egal_prix_client_sur_les_1202_lignes(base):
    _prod(base)
    with base["cur"]() as cur:
        r = prix.regles(cur)
    ecarts_stockes = 0
    for row in _sql(base, "SELECT prix_fournisseur_ht AS ht, type_piece, categorie, prix_client FROM tarifs"):
        d = prix.calcul_detail(row["ht"], row["type_piece"], row["categorie"], r)
        assert d["arrondi"] == prix.prix_client(row["ht"], row["type_piece"], row["categorie"], r)
        assert d["ht"] == float(row["ht"]) and d["brut"] <= d["arrondi"] + 0.005
        ecarts_stockes += d["arrondi"] != row["prix_client"]
    assert ecarts_stockes == 0   # la grille de la prod suit exactement la méthode de calcul
    for row in _sql(base, "SELECT categorie, ecran_prix_ht, batterie_prix_ht, ecran_prix_vente, batterie_prix_vente "
                          "FROM tarifs_apple_devices"):
        for p in ("ecran", "batterie"):
            d = prix.calcul_detail_apple(row[f"{p}_prix_ht"], row["categorie"], r)
            assert d["arrondi"] == prix.prix_apple(row[f"{p}_prix_ht"], row["categorie"], r) == row[f"{p}_prix_vente"]


def test_reel_marques_sans_iphone_avec_ipad_mac_et_chaque_piece_une_fois(base):
    _prod(base)
    marques = _marques(base)
    noms = [m["marque_c"] for m in marques]
    assert noms == sorted(noms) and {"apple", "samsung", "xiaomi", "honor", "nintendo"} <= set(noms)
    for m in marques:
        assert m["nb_modeles"] == len(m["modeles"]) >= 1
        for e in m["modeles"]:
            assert not (m["marque_c"] == "apple" and tarifs_api._est_iphone(e["modele"], "Apple")), e
            assert e["nb_sans_prix"] <= e["nb_pieces"]
            assert (e["fraicheur"] is None) == (e["nb_pieces"] == e["nb_sans_prix"])
    apple = next(m for m in marques if m["marque_c"] == "apple")
    assert apple["marque"] == "Apple"
    assert any(e["modele"].startswith("iPad") for e in apple["modeles"])
    assert any(e["modele"].startswith("MacBook") for e in apple["modeles"])
    # Catalogue : « iPad 10 » reçoit les pièces fournisseur « iPad 10 (2022) » et l'iPad 10 de
    # tarifs_apple_devices (clé souple, modèle de catalogue unique)
    ipad10 = _entree(marques, "apple", "iPad 10")
    assert ipad10["au_catalogue"] and ipad10["categorie"] == "Tablette" and ipad10["nb_pieces"] >= 3
    assert "iPad 10 (2022)" in ipad10["noms"] and any(n.startswith("iPad 10 (2022) 10.9") for n in ipad10["noms"])
    # Un modèle fournisseur hors catalogue fait sa propre entrée
    honor200 = _entree(marques, "honor", "200")
    assert not honor200["au_catalogue"] and honor200["categorie"] is None and honor200["nb_pieces"] >= 1
    # 4G / 5G : « Redmi Note 12 5G » (fournisseur) va exactement au « Redmi Note 12 5G » du
    # catalogue ; « Redmi Note 12 4G » rejoint alors le seul candidat restant, « Redmi Note 12 »
    # (clé souple), comme le feraient les suggestions d'un ticket « Redmi Note 12 »
    assert _entree(marques, "xiaomi", "Redmi Note 12 5G")["noms"] == []
    assert _entree(marques, "xiaomi", "Redmi Note 12")["noms"] == ["Redmi Note 12 4G"]
    assert _modele(base, "Xiaomi", "Redmi Note 12")["pieces"][0]["modele"] == "Redmi Note 12 4G"
    xiaomi = next(m for m in marques if m["marque_c"] == "xiaomi")
    assert not any(e["modele"] in ("Redmi Note 12 4G", "Redmi Note 12 Pro 4G") for e in xiaomi["modeles"])
    # Chaque pièce fournisseur (hors iPhone) et chaque écran / batterie iPad-Mac compte une fois
    total = sum(e["nb_pieces"] for m in marques for e in m["modeles"])
    n_tarifs = _sql(base, "SELECT count(*) AS n FROM tarifs WHERE obsolete IS NOT TRUE "
                          "AND NOT (marque ILIKE 'apple' AND modele ILIKE 'iphone%%')")[0]["n"]
    n_apple = _sql(base, "SELECT count(*) AS n FROM tarifs_apple_devices WHERE actif IS NOT FALSE AND obsolete IS NOT TRUE")[0]["n"]
    assert total == n_tarifs + 2 * n_apple
    # Catalogue entier (hors iPhone) présent
    n_cat = _sql(base, "SELECT count(*) AS n FROM catalog_modeles WHERE actif IS NOT FALSE "
                       "AND NOT (marque ILIKE 'apple' AND modele ILIKE 'iphone%%')")[0]["n"]
    assert sum(1 for m in marques for e in m["modeles"] if e["au_catalogue"]) == n_cat


def test_reel_modele_pieces_calcul_et_ht_masque_hors_admin(base):
    _prod(base)
    with base["cur"]() as cur:
        r = prix.regles(cur)
    staff = _modele(base, "Samsung", "Galaxy A54")
    assert staff["modele_trouve"] and staff["admin"] is False and staff["au_catalogue"]
    assert staff["pieces"] and all(p["prix_fournisseur_ht"] is None and p["calcul"] is None for p in staff["pieces"])
    assert staff["liens"] == tarifs_api._liens("Samsung", "Galaxy A54")
    admin = _modele(base, "Samsung", "Galaxy A54", _h_admin())
    assert admin["admin"] is True and len(admin["pieces"]) == len(staff["pieces"])
    assert [p["type_piece"] for p in admin["pieces"]][0].lower().startswith("ecran")
    for p in admin["pieces"]:
        t = _tarif(base, p["id"])
        assert p["cle"] == f"tarifs:{p['id']}" and p["table"] == "tarifs"
        assert p["prix_fournisseur_ht"] == float(t["prix_fournisseur_ht"]) and p["prix_client"] == t["prix_client"]
        assert p["calcul"]["arrondi"] == prix.prix_client(t["prix_fournisseur_ht"], t["type_piece"], t["categorie"], r)
        assert p["calcul"]["arrondi"] == p["prix_client"] and p["a_renseigner"] is False
        assert p["fraicheur"] in ("ok", "a_revoir", "perime") and p["prix_source"] == "estimation_2026_02" and p["estime"]
        assert p["liens"]["utopya"] == tarifs_api.lien_utopya("Samsung", t["modele"], t["type_piece"])
        assert "url_fournisseur" in p and "ref_fournisseur" in p and "verrou" in p and "en_stock" in p
    assert _entree(_marques(base), "samsung", "Galaxy A54")["nb_pieces"] == len(admin["pieces"])
    # Cohérence liste ↔ détail sur toute une marque
    for e in next(m for m in _marques(base) if m["marque_c"] == "oppo")["modeles"]:
        d = _modele(base, "Oppo", e["modele"])
        assert d["modele_trouve"] and len(d["pieces"]) == e["nb_pieces"], e["modele"]
    # Nom fournisseur rattaché : même résultat que le nom du catalogue
    assert _modele(base, "Apple", "iPad 10 (2022)")["modele"] == "iPad 10"
    inconnu = _modele(base, "Samsung", "Galaxy Z99 Ultra")
    assert inconnu["modele_trouve"] is False and inconnu["pieces"] == [] and inconnu["liens"]["mobilax"]


def test_reel_modele_sans_piece_puis_pieces_courantes_puis_prix(base):
    _prod(base)
    marques = _marques(base)
    samsung = next(m for m in marques if m["marque_c"] == "samsung")
    vide = next(e for e in samsung["modeles"] if e["au_catalogue"] and e["nb_pieces"] == 0)
    modele = vide["modele"]
    d = _modele(base, "Samsung", modele)
    assert d["modele_trouve"] and d["pieces"] == [] and d["au_catalogue"]
    corps = {"marque": "samsung", "modele": modele.lower()}
    assert base["c"].post("/api/tarifs/reparation-smartphones/pieces-courantes", headers=_h_staff(), json=corps).status_code == 403
    n = _n_historique(base)
    r = base["c"].post("/api/tarifs/reparation-smartphones/pieces-courantes", headers=_h_admin(), json=corps)
    assert r.status_code == 200, r.text
    assert r.json()["marque"] == "Samsung" and r.json()["modele"] == modele   # orthographe du catalogue
    assert [c["type_piece"] for c in r.json()["crees"]] == list(tarifs_api.PIECES_COURANTES) and r.json()["existants"] == []
    assert _n_historique(base) == n   # pas de prix : rien dans l'historique des prix
    ids = [c["id"] for c in r.json()["crees"]]
    for t in (_tarif(base, i) for i in ids):
        assert (t["prix_fournisseur_ht"], t["prix_client"], t["prix_source"], t["prix_maj_le"]) == (0, 0, "a_renseigner", None)
        assert t["fournisseur"] is None and t["en_stock"] is None and t["verrou_manuel"] is False and t["categorie"] == "standard"
    d = _modele(base, "Samsung", modele, _h_admin())
    assert [p["id"] for p in d["pieces"]] == ids
    assert all(p["a_renseigner"] and p["prix_client"] == 0 and p["calcul"] is None and p["fraicheur"] is None
               and p["prix_fournisseur_ht"] == 0 for p in d["pieces"])
    e = _entree(_marques(base), "samsung", modele)
    assert (e["nb_pieces"], e["nb_sans_prix"], e["plus_vieux_jours"], e["fraicheur"]) == (3, 3, None, None)
    # Hors des suggestions de ticket tant que le prix est à 0
    s = base["c"].get("/api/grille/suggestions", params={"marque": "Samsung", "modele": modele}, headers=_h_staff()).json()
    assert not any(x["id"] in {f"tarifs:{i}" for i in ids} for x in s["suggestions"])
    # Idempotent
    r = base["c"].post("/api/tarifs/reparation-smartphones/pieces-courantes", headers=_h_admin(), json=corps)
    assert r.status_code == 200 and r.json()["crees"] == [] and r.json()["existants"] == list(tarifs_api.PIECES_COURANTES)
    # Le gérant relève le HT chez Utopya : prix client par la méthode de calcul
    ecran = ids[0]
    r = base["c"].patch(f"/api/tarifs/{ecran}/prix", headers=_h_admin(), json={
        "prix_fournisseur_ht": 42, "source": "utopya", "ref_fournisseur": " UT-123 ",
        "url_fournisseur": "https://www.utopya.fr/ecran-galaxy-test.html"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert (out["prix_fournisseur_ht"], out["prix_client"], out["prix_source"], out["fraicheur"]) == (42, 119, "utopya", "ok")
    assert out["calcul"] == {"ht": 42.0, "tva": 1.2, "marge": 60, "brut": 110.4, "arrondi": 119}
    assert (out["ref_fournisseur"], out["url_fournisseur"], out["fournisseur"]) == (
        "UT-123", "https://www.utopya.fr/ecran-galaxy-test.html", "Utopya")
    assert _n_historique(base) == n + 2
    assert {h["source"] for h in _sql(base, "SELECT source FROM tarifs_historique WHERE ligne_id = %s AND table_nom = 'tarifs'",
                                      ecran)} == {"utopya"}
    p = next(x for x in _modele(base, "Samsung", modele, _h_admin())["pieces"] if x["id"] == ecran)
    assert p["a_renseigner"] is False and p["calcul"]["arrondi"] == 119 and p["prix_source"] == "utopya"
    e = _entree(_marques(base), "samsung", modele)
    assert (e["nb_pieces"], e["nb_sans_prix"], e["plus_vieux_jours"], e["fraicheur"]) == (3, 2, 0, "ok")
    s = base["c"].get("/api/grille/suggestions", params={"marque": "Samsung", "modele": modele}, headers=_h_staff()).json()
    assert any(x["id"] == f"tarifs:{ecran}" and x["prix"] == 119 for x in s["suggestions"])
    assert not any(x["id"] in {f"tarifs:{i}" for i in ids[1:]} for x in s["suggestions"])


def test_reel_patch_source_mobilax_url_verrou_et_refus(base):
    _prod(base)
    tid = _id(base, "Oppo", "Reno 10", "Ecran", "Original")
    avant = _tarif(base, tid)
    # URL d'un autre fournisseur que la source : refusée, rien n'est écrit
    r = base["c"].patch(f"/api/tarifs/{tid}/prix", headers=_h_admin(), json={
        "prix_fournisseur_ht": 30, "source": "mobilax", "url_fournisseur": "https://www.utopya.fr/x"})
    assert r.status_code == 400 and _tarif(base, tid)["prix_fournisseur_ht"] == avant["prix_fournisseur_ht"]
    assert base["c"].patch(f"/api/tarifs/{tid}/prix", headers=_h_admin(),
                           json={"prix_fournisseur_ht": 30, "source": "import"}).status_code == 422
    r = base["c"].patch(f"/api/tarifs/{tid}/prix", headers=_h_admin(), json={
        "prix_fournisseur_ht": 30, "source": "mobilax",
        "url_fournisseur": "https://www.mobilax.fr/pieces-detachees/telephonie/oppo/reno-10"})
    assert r.status_code == 200, r.text
    t = _tarif(base, tid)
    assert (t["prix_fournisseur_ht"], t["prix_client"], t["prix_source"], t["fournisseur"]) == (
        Decimal("30.00"), prix.prix_client(30, "Ecran", t["categorie"]), "mobilax", "Mobilax")
    assert t["url_fournisseur"].endswith("/oppo/reno-10") and t["ref_fournisseur"] is None
    # Source 'manuel' sans URL : l'URL et le fournisseur restent
    r = base["c"].patch(f"/api/tarifs/{tid}/prix", headers=_h_admin(), json={"prix_fournisseur_ht": 31})
    assert r.status_code == 200 and r.json()["prix_source"] == "manuel"
    assert r.json()["url_fournisseur"].endswith("/oppo/reno-10") and r.json()["fournisseur"] == "Mobilax"
    # Ligne verrouillée : la saisie explicite 'utopya' écrit le HT, le prix client verrouillé ne bouge pas
    bid = _id(base, "Oppo", "Reno 10", "Batterie")
    _sql(base, "UPDATE tarifs SET verrou_manuel = TRUE WHERE id = %s", bid)
    client_avant = _tarif(base, bid)["prix_client"]
    r = base["c"].patch(f"/api/tarifs/{bid}/prix", headers=_h_admin(), json={"prix_fournisseur_ht": 9.5, "source": "utopya"})
    assert r.status_code == 200, r.text
    b = _tarif(base, bid)
    assert (b["prix_fournisseur_ht"], b["prix_client"], b["prix_source"], b["verrou_manuel"]) == (
        Decimal("9.50"), client_avant, "utopya", True)
    # La liste complète expose la nouvelle colonne (HT masqué pour le staff)
    ligne = next(x for x in base["c"].get("/api/tarifs", headers=_h_staff(), params={"marque": "Oppo"}).json()
                 if x["id"] == tid)
    assert ligne["url_fournisseur"].endswith("/oppo/reno-10") and "prix_fournisseur_ht" not in ligne


def test_reel_apple_ipad_mac_pieces_et_patch(base):
    _prod(base)
    with base["cur"]() as cur:
        r = prix.regles(cur)
    d = _modele(base, "Apple", "iPad 10", _h_admin())
    assert d["modele_trouve"] and d["categorie"] == "Tablette"
    apple = [p for p in d["pieces"] if p["table"] == "tarifs_apple_devices"]
    fourn = [p for p in d["pieces"] if p["table"] == "tarifs"]
    assert len(apple) == 2 and fourn
    for p in apple:
        assert p["id"] is None and p["cle"] == f"tarifs_apple_devices:{p['device_id']}:{p['piece']}"
        assert p["calcul"]["marge"] == r["ipad"] and p["calcul"]["arrondi"] == p["prix_client"]
        assert p["en_stock"] is None and p["url_fournisseur"] is None and p["categorie"] == "ipad"
    ecran = next(p for p in apple if p["piece"] == "ecran")
    assert _modele(base, "Apple", "iPad 10")["pieces"][0]["calcul"] is None
    device_id = ecran["device_id"]
    assert base["c"].patch(f"/api/tarifs/apple-devices/{device_id}/prix", headers=_h_staff(),
                           json={"piece": "ecran", "prix_fournisseur_ht": 50}).status_code == 403
    r2 = base["c"].patch(f"/api/tarifs/apple-devices/{device_id}/prix", headers=_h_admin(),
                         json={"piece": "ecran", "prix_fournisseur_ht": 50, "source": "utopya", "ref_fournisseur": "UT-9"})
    assert r2.status_code == 200, r2.text
    assert r2.json()["ok"] is True and r2.json()["nouveau_client"] == prix.prix_apple(50, "ipad", r) == 179
    row = _sql(base, "SELECT * FROM tarifs_apple_devices WHERE id = %s", device_id)[0]
    assert (row["ecran_prix_ht"], row["ecran_prix_vente"], row["prix_source"], row["fournisseur"], row["ref_fournisseur"]) == (
        Decimal("50.00"), 179, "utopya", "Utopya", "UT-9")
    assert base["c"].patch("/api/tarifs/apple-devices/999999/prix", headers=_h_admin(),
                           json={"piece": "ecran", "prix_fournisseur_ht": 50}).status_code == 404
    marques = _marques(base)
    air = _entree(marques, "apple", "MacBook Air 13 M3")
    assert air["nb_pieces"] == 2 and air["noms"] == ['MacBook Air 13" M3 A3113 (2024)'] and air["categorie"] == "PC Portable"
    # Un MacBook fournisseur sans modèle de catalogue reste seul, jamais confondu avec un voisin
    seuls = [e for e in _entree_marque(marques, "apple") if not e["au_catalogue"] and e["modele"].startswith("MacBook Pro 13")]
    assert {e["modele"] for e in seuls} >= {'MacBook Pro 13" A2159 (2019)', 'MacBook Pro 13" A2289/A2251 (2020 Intel)'}
    assert all(e["nb_pieces"] == 2 and e["noms"] == [] and e["categorie"] == "PC Portable" for e in seuls)
    # « Reno10 Pro+ » et « Reno10 Pro » restent distincts ; « Reno 10 Pro » (fournisseur) trouve « Reno10 Pro »
    assert _modele(base, "Oppo", "Reno10 Pro+")["pieces"] == []
    assert _modele(base, "Oppo", "Reno 10 Pro")["modele"] == "Reno10 Pro"
    assert len(_modele(base, "Oppo", "Reno10 Pro")["pieces"]) == 4


def _entree_marque(marques, marque_c):
    return next(m for m in marques if m["marque_c"] == marque_c)["modeles"]


def test_reel_403_sans_elevation_rien_n_est_ecrit(base):
    _prod(base)
    tid = _id(base, "Oppo", "Reno 10", "Ecran", "Original")
    avant, n = _tarif(base, tid), _n_historique(base)
    for h in (_h_staff(), _h_admin(code=False)):
        assert base["c"].patch(f"/api/tarifs/{tid}/prix", headers=h,
                               json={"prix_fournisseur_ht": 1, "source": "utopya"}).status_code == 403
        assert base["c"].post("/api/tarifs/reparation-smartphones/pieces-courantes", headers=h,
                              json={"marque": "Samsung", "modele": "Galaxy A54"}).status_code == 403
        assert base["c"].get("/api/tarifs/reparation-smartphones/marques", headers=h).status_code == 200
        assert base["c"].get("/api/tarifs/reparation-smartphones/modele", headers=h,
                             params={"marque": "Samsung", "modele": "Galaxy A54"}).json()["admin"] is False
    assert _tarif(base, tid) == avant and _n_historique(base) == n
    assert _sql(base, "SELECT count(*) AS n FROM tarifs WHERE prix_source = 'a_renseigner'")[0]["n"] == 0


# ═══ Base réelle : corrections de la revue (iPad / Mac, modèle inconnu, santé, méthode) ═══

def _sante(base):
    r = base["c"].get("/api/tarifs/sante", headers=_h_staff())
    assert r.status_code == 200, r.text
    return r.json()


def _suggestions(base, marque, modele):
    r = base["c"].get("/api/grille/suggestions", params={"marque": marque, "modele": modele}, headers=_h_staff())
    assert r.status_code == 200, r.text
    return r.json()["suggestions"]


def test_reel_pieces_courantes_ipad_mac_dans_la_fiche_apple(base):
    """Un iPad / MacBook du catalogue sans pièce reçoit écran + batterie dans tarifs_apple_devices
    (règle iPad +110 € / MacBook +120 €), jamais des lignes de la grille des pièces ni un connecteur."""
    _prod(base)
    with base["cur"]() as cur:
        r = prix.regles(cur)
    n_tarifs = _sql(base, "SELECT count(*) AS n FROM tarifs")[0]["n"]
    for modele, cat, ht, attendu in (("iPad 11 A16", "ipad", 30, 149), ("MacBook Pro 14 M5", "macbook", 30, 159)):
        e = _entree(_marques(base), "apple", modele)
        assert (e["au_catalogue"], e["nb_pieces"], e["categorie_apple"], e["nb_alertes_marge"]) == (True, 0, cat, 0)
        corps = {"marque": "apple", "modele": modele.lower()}
        assert base["c"].post(URL_PIECES, headers=_h_staff(), json=corps).status_code == 403
        avant = _sante(base)
        r1 = base["c"].post(URL_PIECES, headers=_h_admin(), json=corps)
        assert r1.status_code == 200, r1.text
        out = r1.json()
        assert (out["marque"], out["modele"], out["table"], out["categorie_apple"], out["existants"], out["reactive"]) == (
            "Apple", modele, "tarifs_apple_devices", cat, [], False)
        assert [c["type_piece"] for c in out["crees"]] == ["Écran", "Batterie"]          # jamais de connecteur
        did = out["device_id"]
        assert all(c["id"] is None and c["device_id"] == did and c["table"] == "tarifs_apple_devices"
                   and c["cle"] == f"tarifs_apple_devices:{did}:{c['piece']}" for c in out["crees"])
        assert _sql(base, "SELECT count(*) AS n FROM tarifs")[0]["n"] == n_tarifs          # rien dans la grille des pièces
        row = _sql(base, "SELECT * FROM tarifs_apple_devices WHERE id = %s", did)[0]
        assert (row["categorie"], row["modele"], row["ecran_prix_ht"], row["batterie_prix_ht"],
                row["ecran_prix_vente"], row["batterie_prix_vente"]) == (cat, modele, 0, 0, 0, 0)
        assert (row["prix_source"], row["prix_maj_le"], row["fournisseur"], row["actif"], row["obsolete"],
                row["verrou_manuel"]) == ("a_renseigner", None, None, True, False, False)
        d = _modele(base, "Apple", modele, _h_admin())
        assert d["categorie_apple"] == cat and d["modele_trouve"]
        assert [p["cle"] for p in d["pieces"]] == [f"tarifs_apple_devices:{did}:ecran", f"tarifs_apple_devices:{did}:batterie"]
        assert all(p["a_renseigner"] and p["prix_client"] == 0 and p["calcul"] is None and p["fraicheur"] is None
                   and p["alerte_marge"] is None and p["prix_fournisseur_ht"] == 0 and p["categorie"] == cat
                   for p in d["pieces"])
        e = _entree(_marques(base), "apple", modele)
        assert (e["nb_pieces"], e["nb_sans_prix"], e["fraicheur"], e["nb_alertes_marge"]) == (2, 2, None, 0)
        assert not any(x["id"].startswith(f"tarifs_apple_devices:{did}:") for x in _suggestions(base, "Apple", modele))
        ligne = next(x for x in base["c"].get("/api/tarifs/apple-devices", headers=_h_admin()).json() if x["id"] == did)
        assert ligne["fraicheur"] is None and ligne["a_renseigner"] is True
        apres = _sante(base)
        assert (apres["total"], apres["a_renseigner"]) == (avant["total"] + 1, avant["a_renseigner"] + 1)
        assert all(apres[k] == avant[k] for k in ("estimes", "a_revoir", "perimes", "marges_faibles"))
        # Idempotent
        r2 = base["c"].post(URL_PIECES, headers=_h_admin(), json=corps).json()
        assert (r2["crees"], r2["existants"], r2["device_id"]) == ([], ["Écran", "Batterie"], did)
        # Le gérant relève l'écran chez Utopya : règle iPad / MacBook, pas la marge écran standard
        r3 = base["c"].patch(f"/api/tarifs/apple-devices/{did}/prix", headers=_h_admin(),
                             json={"piece": "ecran", "prix_fournisseur_ht": ht, "source": "utopya"})
        assert r3.status_code == 200, r3.text
        assert r3.json()["nouveau_client"] == prix.prix_apple(ht, cat, r) == attendu
        assert attendu != prix.prix_client(ht, "Ecran", "standard", r) == 99
        p = next(x for x in _modele(base, "Apple", modele, _h_admin())["pieces"] if x["piece"] == "ecran")
        assert (p["a_renseigner"], p["calcul"]["marge"], p["calcul"]["arrondi"], p["prix_source"], p["fraicheur"]) == (
            False, r[cat], attendu, "utopya", "ok")
        s = _suggestions(base, "Apple", modele)
        assert any(x["id"] == f"tarifs_apple_devices:{did}:ecran" and x["prix"] == attendu for x in s)
        assert not any(x["id"] == f"tarifs_apple_devices:{did}:batterie" for x in s)
        fin = _sante(base)
        assert (fin["total"], fin["a_renseigner"], fin["perimes"], fin["a_revoir"]) == (
            avant["total"] + 1, avant["a_renseigner"], avant["perimes"], avant["a_revoir"])
    assert _sql(base, "SELECT count(*) AS n FROM tarifs WHERE prix_source = 'a_renseigner'")[0]["n"] == 0
    # Apple hors iPad / Mac : refusé
    assert base["c"].post(URL_PIECES, headers=_h_admin(), json={"marque": "Apple", "modele": "iPad 99 Z"}).status_code == 404


def test_reel_fiche_apple_incomplete_ou_inactive_completee(base):
    """Fiche déjà là sans batterie : complétée à 0 sans toucher l'écran ; fiche inactive : réactivée."""
    _prod(base)
    did = _sql(base, "SELECT id FROM tarifs_apple_devices WHERE modele = %s", "iPad Mini 4")[0]["id"]
    _sql(base, "UPDATE tarifs_apple_devices SET batterie_prix_ht = NULL, batterie_prix_vente = NULL WHERE id = %s", did)
    assert _entree(_marques(base), "apple", "iPad Mini 4")["nb_pieces"] == 1
    out = base["c"].post(URL_PIECES, headers=_h_admin(), json={"marque": "Apple", "modele": "iPad Mini 4"}).json()
    assert (out["device_id"], out["existants"], [c["piece"] for c in out["crees"]], out["reactive"]) == (did, ["Écran"], ["batterie"], False)
    row = _sql(base, "SELECT * FROM tarifs_apple_devices WHERE id = %s", did)[0]
    assert (row["ecran_prix_ht"], row["ecran_prix_vente"], row["batterie_prix_ht"], row["batterie_prix_vente"]) == (48, 169, 0, 0)
    assert row["prix_source"] == "estimation_2026_02"          # la source de la fiche (écran) reste
    pieces = _modele(base, "Apple", "iPad Mini 4", _h_admin())["pieces"]
    assert [(p["piece"], p["a_renseigner"]) for p in pieces] == [("ecran", False), ("batterie", True)]
    # Fiche désactivée d'un modèle hors catalogue : le modèle disparaît de l'écran → modèle inconnu (404)
    _sql(base, "UPDATE tarifs_apple_devices SET actif = FALSE WHERE id = %s", did)
    assert not any(e["modele"] == "iPad Mini 4" for e in _entree_marque(_marques(base), "apple"))
    assert base["c"].post(URL_PIECES, headers=_h_admin(), json={"marque": "Apple", "modele": "iPad Mini 4"}).status_code == 404
    # Fiche d'un modèle du catalogue désactivée : « Ajouter les pièces courantes » la réactive (même id,
    # prix intacts) au lieu d'en créer une seconde
    did2 = base["c"].post(URL_PIECES, headers=_h_admin(), json={"marque": "Apple", "modele": "iPad 11 A16"}).json()["device_id"]
    assert base["c"].patch(f"/api/tarifs/apple-devices/{did2}/prix", headers=_h_admin(),
                           json={"piece": "ecran", "prix_fournisseur_ht": 40}).status_code == 200
    _sql(base, "UPDATE tarifs_apple_devices SET actif = FALSE WHERE id = %s", did2)
    assert _entree(_marques(base), "apple", "iPad 11 A16")["nb_pieces"] == 0
    out = base["c"].post(URL_PIECES, headers=_h_admin(), json={"marque": "Apple", "modele": "iPad 11 A16"}).json()
    assert (out["device_id"], out["crees"], out["existants"], out["reactive"]) == (did2, [], ["Écran", "Batterie"], True)
    row = _sql(base, "SELECT * FROM tarifs_apple_devices WHERE id = %s", did2)[0]
    assert (row["actif"], row["obsolete"], row["ecran_prix_ht"], row["ecran_prix_vente"], row["batterie_prix_vente"]) == (
        True, False, 40, 159, 0)
    assert _sql(base, "SELECT count(*) AS n FROM tarifs_apple_devices WHERE lower(modele) = 'ipad 11 a16'")[0]["n"] == 1
    assert _entree(_marques(base), "apple", "iPad 11 A16")["nb_pieces"] == 2


def test_reel_alerte_marge_pieces_ipad_dans_la_grille_des_pieces(base):
    """Les pièces iPad de la prod rangées dans `tarifs` (marge écran standard 60 €) cohabitent avec la
    fiche iPad (+110 €) : signalées, montants pour l'admin seulement ; rien à créer pour ce modèle."""
    _prod(base)
    with base["cur"]() as cur:
        r = prix.regles(cur)
    marques = _marques(base)
    ipad9 = _entree(marques, "apple", "iPad 9")
    assert (ipad9["categorie_apple"], ipad9["nb_pieces"], ipad9["nb_alertes_marge"]) == ("ipad", 5, 3)
    assert all(e["nb_alertes_marge"] == 0 and e["categorie_apple"] is None for e in _entree_marque(marques, "samsung"))
    assert _entree(marques, "apple", "MacBook Air 13 M3")["categorie_apple"] == "macbook"
    assert sum(e["nb_alertes_marge"] for e in _entree_marque(marques, "apple")) == 17   # toutes les lignes iPad de `tarifs`
    admin = _modele(base, "Apple", "iPad 9", _h_admin())
    assert admin["categorie_apple"] == "ipad"
    fiche = [p for p in admin["pieces"] if p["table"] == "tarifs_apple_devices"]
    grille_pieces = [p for p in admin["pieces"] if p["table"] == "tarifs"]
    assert len(fiche) == 2 and all(p["alerte_marge"] is None for p in fiche)
    assert len(grille_pieces) == 3
    for p in grille_pieces:
        a = p["alerte_marge"]
        assert (a["code"], a["categorie_attendue"]) == ("apple_grille_pieces", "ipad") and "iPad" in a["message"]
        assert a["marge_appliquee"] == prix.marge_piece(p["type_piece"], p["categorie"], r) == 60
        assert a["marge_attendue"] == r["ipad"] == 110
        assert a["prix_attendu"] == prix.prix_apple(p["prix_fournisseur_ht"], "ipad", r) != p["prix_client"]
    ecran = next(p for p in grille_pieces if p["type_piece"] == "Ecran" and p["qualite"] == "Original")
    assert (ecran["prix_client"], ecran["alerte_marge"]["prix_attendu"]) == (119, 169)   # 48 × 1,2 + 60 → 119 ; + 110 → 169
    assert "écran standard" in ecran["alerte_marge"]["message"]
    assert "autres pièces" in next(p for p in grille_pieces if p["type_piece"] == "Batterie")["alerte_marge"]["message"]
    for p in (x for x in _modele(base, "Apple", "iPad 9")["pieces"] if x["table"] == "tarifs"):
        assert set(p["alerte_marge"]) == {"code", "categorie_attendue", "message"}      # staff : aucun montant
    # Fiche et pièces déjà là : rien à créer, rien d'écrit
    emp = (_empreinte(base), _empreinte(base, "tarifs_apple_devices"))
    out = base["c"].post(URL_PIECES, headers=_h_admin(), json={"marque": "Apple", "modele": "iPad 9"}).json()
    assert (out["crees"], out["existants"], out["table"]) == ([], ["Écran", "Batterie"], "tarifs_apple_devices")
    assert (_empreinte(base), _empreinte(base, "tarifs_apple_devices")) == emp


def test_reel_pieces_courantes_modele_inconnu_404_modele_fournisseur_et_orthographe_catalogue(base):
    _prod(base)
    n = _sql(base, "SELECT count(*) AS n FROM tarifs")[0]["n"]
    for corps in ({"marque": "Samsung", "modele": "Galaxy Z99 Ultra"}, {"marque": "Apple", "modele": "iPad 99 Z"},
                  {"marque": "Xiaomi", "modele": "Redmi Note 12 Pro Max Ultra"}):
        r = base["c"].post(URL_PIECES, headers=_h_admin(), json=corps)
        assert r.status_code == 404 and "catalogue" in r.json()["detail"], (corps, r.text)
    assert _sql(base, "SELECT count(*) AS n FROM tarifs")[0]["n"] == n
    assert not any(e["modele"] == "Galaxy Z99 Ultra" for e in _entree_marque(_marques(base), "samsung"))
    # Modèle fournisseur hors catalogue mais déjà dans la grille (Honor « 200 ») : complété sous son nom
    out = base["c"].post(URL_PIECES, headers=_h_admin(), json={"marque": "honor", "modele": "200"}).json()
    assert (out["table"], out["existants"], [c["type_piece"] for c in out["crees"]]) == (
        "tarifs", ["Ecran", "Batterie"], ["Connecteur de charge"])
    t = _tarif(base, out["crees"][0]["id"])
    assert (t["modele"], t["prix_client"], t["prix_source"]) == ("200", 0, "a_renseigner") and t["marque"].lower() == "honor"
    assert out["crees"][0]["cle"] == f"tarifs:{t['id']}"
    e = _entree(_marques(base), "honor", "200")
    assert (e["nb_pieces"], e["nb_sans_prix"], e["au_catalogue"]) == (3, 1, False)
    # Orthographe approchante d'un modèle du catalogue (« Reno 10 Pro » → « Reno10 Pro ») : familles présentes respectées
    out = base["c"].post(URL_PIECES, headers=_h_admin(), json={"marque": "Oppo", "modele": "Reno 10 Pro"}).json()
    assert (out["modele"], out["existants"], out["crees"]) == ("Reno10 Pro", list(tarifs_api.PIECES_COURANTES), [])


def test_reel_sante_et_liste_comptent_a_part_les_prix_a_renseigner(base):
    _prod(base)
    avant = _sante(base)
    assert (avant["total"], avant["perimes"], avant["a_renseigner"]) == (1251, 1251, 0)
    vide = next(e for e in _entree_marque(_marques(base), "samsung") if e["au_catalogue"] and e["nb_pieces"] == 0)["modele"]
    ids = [c["id"] for c in base["c"].post(URL_PIECES, headers=_h_admin(), json={"marque": "Samsung", "modele": vide}).json()["crees"]]
    assert len(ids) == 3
    apres = _sante(base)
    assert (apres["total"], apres["a_renseigner"]) == (1254, 3)
    assert {k: apres[k] for k in ("estimes", "a_revoir", "perimes", "marges_faibles")} == \
        {k: avant[k] for k in ("estimes", "a_revoir", "perimes", "marges_faibles")}
    lignes = {t["id"]: t for t in base["c"].get("/api/tarifs", headers=_h_admin()).json()}
    assert all(lignes[i]["fraicheur"] is None and lignes[i]["a_renseigner"] is True for i in ids)
    assert sum(1 for t in lignes.values() if t["a_renseigner"]) == 3
    apple = base["c"].get("/api/tarifs/apple-devices", headers=_h_admin()).json()
    assert all(t["a_renseigner"] is False for t in apple)
    # Même périmètre que la santé : les lignes à renseigner ne sont pas « périmées » dans la liste non plus
    assert sum(1 for t in list(lignes.values()) + apple if t["fraicheur"] == "perime") == apres["perimes"]
    # Un prix renseigné sort du compteur et devient un prix daté
    r = base["c"].patch(f"/api/tarifs/{ids[0]}/prix", headers=_h_admin(), json={"prix_fournisseur_ht": 12, "source": "mobilax"})
    assert r.status_code == 200, r.text
    assert (r.json()["a_renseigner"], r.json()["fraicheur"], r.json()["prix_client"]) == (False, "ok", 79)
    s = _sante(base)
    assert (s["total"], s["a_renseigner"], s["perimes"], s["a_revoir"]) == (1254, 2, avant["perimes"], avant["a_revoir"])


def test_reel_methode_calcul_selon_le_role_et_les_regles_en_vigueur(base):
    _prod(base)
    staff = base["c"].get(URL_METHODE, headers=_h_staff()).json()
    assert (staff["admin"], staff["regles"], staff["exemple"]) == (False, None, None) and "60" not in staff["texte"]
    sans_code = base["c"].get(URL_METHODE, headers=_h_admin(code=False)).json()
    assert sans_code == staff                                            # rôle admin sans code : rien de plus
    admin = base["c"].get(URL_METHODE, headers=_h_admin()).json()
    assert admin["admin"] is True and "marge 60 € (écran standard, autres pièces)" in admin["texte"]
    assert admin["regles"]["ecran"]["standard"] == 60 and "jours_perime" not in admin["regles"]
    assert admin["exemple"]["arrondi"] == 119
    with base["cur"]() as cur:
        prix.enregistrer_regles(cur, prix.valider_regles({"ecran": {"standard": 65}}, prix.regles(cur)))
    params_cache.invalidate()
    admin2 = base["c"].get(URL_METHODE, headers=_h_admin()).json()
    assert "marge 65 € (écran standard), 70 € (écran haut de gamme), 100 € (pliant), 60 € (autres pièces)" in admin2["texte"]
    assert admin2["regles"]["ecran"]["standard"] == 65 and admin2["exemple"]["arrondi"] == 119   # 42 × 1,2 + 65 = 115,4 → 119
    assert base["c"].get(URL_METHODE, headers=_h_staff()).json() == staff   # le personnel ne voit aucune différence
