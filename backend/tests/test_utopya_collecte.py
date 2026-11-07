"""Collecte des prix Utopya depuis le navigateur du gérant (services/utopya, api/fournisseurs).

Aucune requête réseau : le menu et les tuiles viennent d'échantillons relevés sur utopya.fr ;
l'import est simulé (fournisseurs._importer), la base par le curseur des tests Mobilax.
"""

import json
import shutil
import subprocess
from contextlib import contextmanager
from decimal import Decimal
from unittest.mock import patch

import pytest

from app.services import fournisseurs as F
from app.services import params as params_cache
from app.services import utopya as U
from tests.test_fournisseurs_mobilax import _Base, _sur
from tests.test_securite_c1 import _ADMIN_PROUVE, _headers, fake_db

CLE = "c" * 48
IPHONE = "https://www.utopya.fr/apple/iphone/iphone-13.html"
A54 = "https://www.utopya.fr/samsung/galaxy-a/a54-5g-a546b.html"
PIXEL = "https://www.utopya.fr/autres-marques/google/pixel.html"
LIENS = [
    {"texte": "iPhone 13", "href": IPHONE},
    {"texte": "iPhone 13 Pro", "href": "https://www.utopya.fr/apple/iphone/iphone-13-pro.html"},
    {"texte": "A54 5G (A546B)", "href": A54},
    {"texte": "A14 5G (A146B)", "href": "https://www.utopya.fr/samsung/galaxy-a/a14-5g-a146b.html"},
    {"texte": "A14 4G (A145F)", "href": "https://www.utopya.fr/samsung/galaxy-a/a14-4g-a145f.html"},
    {"texte": "Pixel", "href": PIXEL},
    {"texte": "Redmi Note 13 Pro 5G", "href": "https://www.utopya.fr/xiaomi/redmi-note/redmi-note-13-pro-5g.html"},
    {"texte": 'Air 13" (A2179)', "href": "https://www.utopya.fr/apple/macbook/air-13-a2179.html"},
    {"texte": "G84 5G", "href": "https://www.utopya.fr/motorola/moto-g/g84-5g.html"},
    {"texte": "Série Reno", "href": "https://www.utopya.fr/autres-marques/oppo/serie-reno.html"},
    {"texte": "iPhone 13", "href": "https://www.utopya.fr/protection/iphone/iphone-13.html"},      # protections : ignoré
    {"texte": "Contact", "href": "https://www.utopya.fr/contact"},
    "bruit", {"texte": "x"}, {"href": "https://ailleurs.fr/a/b/c.html", "texte": "y"},
]
MODELES = [("Apple", "iPhone 13"), ("Samsung", "Galaxy A54"), ("Samsung", "Galaxy A14"), ("Google", "Pixel 7"),
           ("Xiaomi", "Redmi Note 13 Pro 5G"), ("Apple", 'MacBook Air 13" A2179 (2020 Intel)'), ("Motorola", "Moto G84"),
           ("Oppo", "Reno 10"), ("Samsung", "Galaxy S99"), ("Autre", "Trucmuche"), ("", "")]


def _tuile(nom, sku, page, texte="12,50 € HT", montant="12.5"):
    return {"nom": nom, "sku": sku, "page": page, "prix_texte": texte, "prix_montant": montant}


# ─── Plan des pages ──────────────────────────────────────────────

def test_lire_menu_reconnait_les_rubriques_et_prefixe_la_gamme():
    entrees = {e["href"]: e for e in U.lire_menu(LIENS)}
    assert "https://www.utopya.fr/protection/iphone/iphone-13.html" not in entrees
    assert "https://www.utopya.fr/contact" not in entrees and "https://ailleurs.fr/a/b/c.html" not in entrees
    assert entrees[A54]["marque"] == "samsung" and entrees[A54]["nom"] == "Galaxy A54 5G (A546B)" and entrees[A54]["chiffre"]
    assert entrees[PIXEL]["marque"] == "google" and entrees[PIXEL]["chiffre"] is False
    assert entrees["https://www.utopya.fr/motorola/moto-g/g84-5g.html"]["nom"] == "Moto G84 5G"
    assert entrees["https://www.utopya.fr/apple/macbook/air-13-a2179.html"]["nom"] == 'MacBook Air 13" (A2179)'
    assert entrees["https://www.utopya.fr/autres-marques/oppo/serie-reno.html"]["marque"] == "oppo"
    assert U.lire_menu(None) == [] and U.lire_menu([{"texte": "x", "href": "nope"}]) == []


def test_plan_page_par_modele_series_et_modeles_sans_page():
    p = U.plan(LIENS, MODELES)
    par_modele = {}
    for pg in p["pages"]:
        par_modele.setdefault(pg["modele"], []).append(pg["url"])
    assert par_modele["iPhone 13"] == [IPHONE]                              # jamais la page iPhone 13 Pro
    assert par_modele["Galaxy A54"] == [A54]
    assert sorted(par_modele["Galaxy A14"]) == sorted(["https://www.utopya.fr/samsung/galaxy-a/a14-5g-a146b.html",
                                                        "https://www.utopya.fr/samsung/galaxy-a/a14-4g-a145f.html"])
    assert par_modele["Redmi Note 13 Pro 5G"] == ["https://www.utopya.fr/xiaomi/redmi-note/redmi-note-13-pro-5g.html"]
    assert par_modele['MacBook Air 13" A2179 (2020 Intel)'] == ["https://www.utopya.fr/apple/macbook/air-13-a2179.html"]
    assert par_modele["Moto G84"] == ["https://www.utopya.fr/motorola/moto-g/g84-5g.html"]
    # Marques sans page par modèle : la page de série (Pixel, Série Reno), une seule fois
    assert par_modele[None] == [PIXEL, "https://www.utopya.fr/autres-marques/oppo/serie-reno.html"]
    assert p["sans_page"] == [["Samsung", "Galaxy S99"]]
    assert p["modeles"] == len(MODELES) and p["liens_reconnus"] == 10
    assert len({pg["url"] for pg in p["pages"]}) == len(p["pages"])
    assert U.plan([], MODELES)["pages"] == [] and U.plan(LIENS, [])["pages"] == []


# ─── Tuiles → lignes d'import ────────────────────────────────────

@pytest.mark.parametrize("tuile, attendu", [
    ({"prix_texte": "12,50 € HT", "prix_montant": "12.5"}, Decimal("12.50")),
    ({"prix_texte": "7,90 € HT 9,48 € TTC", "prix_montant": "9.48"}, Decimal("7.90")),
    ({"prix_texte": "15,00 € TTC", "prix_montant": "15"}, Decimal("12.50")),
    ({"prix_texte": "15,00 € TTC"}, Decimal("12.50")),
    ({"prix_texte": "12,50 €", "prix_montant": None}, Decimal("12.50")),
    ({"prix_montant": "1 234,5"}, Decimal("1234.50")),
    ({"prix_texte": "S'identifier pour voir le prix"}, None),
    ({"prix_montant": "0"}, None),
    ({"prix_montant": "abc", "prix_texte": ""}, None),
    ({}, None),
])
def test_prix_collecte(tuile, attendu):
    assert U.prix_collecte(tuile, 1.2) == attendu


@pytest.mark.parametrize("nom, sku, attendu", [
    ("Ecran Complet iPhone 13 (Service Pack)", "102273", "Original"),
    ("Ecran Complet iPhone 13 (Soft OLED) (Prime)", "ECSO-IP13", "Soft OLED"),
    ("Ecran Complet iPhone 13 (Hard OLED)", "A13ECN-HOLED", "OLED"),
    ("Ecran Complet iPhone 13 (LTPS) (SPARK)", "IP13-INC", "Incell"),
    ("Ecran Complet iPhone 13 (ReLife)", "493000", "Compatible"),
    ("Ecran Complet iPhone 13 (Alcalian)", "935764", "Compatible"),
    ("Ecran Complet Noir OLED Galaxy A54 5G (A546B) (Avec châssis)", "A546-OLED@", "OLED"),
    ("Ecran Complet Incell Noir Galaxy A54 5G (A546B)", "EC@-A54IB", "Incell"),
    ("Ecran Complet Blanc Galaxy A54 5G (A546B)", "973876", "Original"),      # catalogue Utopya sans étiquette : origine
    ("Ecran Complet Google Pixel 8 Pro", "ECN-PIX8P@", "Compatible"),          # référence maison : compatible
    ("Châssis Complet Minuit iPhone 13 (Pulled A)", "116607", "Reconditionnee"),
])
def test_qualite_nom(nom, sku, attendu):
    assert U.qualite_nom(nom, sku) == attendu


def test_ligne_collecte_pieces_modeles_et_ecarts():
    l = U.ligne_collecte(_tuile("Ecran Complet Blanc Galaxy A54 5G (A546B)", "973876", A54), "Samsung", 1.2)
    assert l == {"reference": "973876", "designation": "Ecran Complet Blanc Galaxy A54 5G (A546B)", "marque": "Samsung",
                 "modele": "Galaxy A54 5G", "type_piece": "Ecran", "qualite": "Original", "prix_ht": Decimal("12.50"),
                 "en_stock": None, "url": None, "chassis": None}
    # Galaxy S25 (07/11/2026) : « (Sans Châssis) » = la dalle seule (67 €), l'écran complet (PA) n'en dit rien (94 €),
    # le ReLife précise « (Avec Châssis) » — lu dans le nom, jamais dans le modèle
    sans = U.ligne_collecte(_tuile("Ecran Complet Galaxy S25 (S931B) (Sans Châssis)", "420000", A54), "Samsung", 1.2)
    assert (sans["qualite"], sans["chassis"], sans["modele"]) == ("Original", False, "Galaxy S25")
    avec = U.ligne_collecte(_tuile("Ecran Complet Noir Galaxy S25 (S931B) (Avec Châssis) (Relife)", "GS25-EC", A54), "Samsung")
    assert (avec["qualite"], avec["chassis"], avec["modele"]) == ("Compatible", True, "Galaxy S25")
    assert U.ligne_collecte(_tuile("Ecran Complet Noir Absolu Galaxy S25 (S931B) (PA)", "420001", A54), "Samsung")["chassis"] is None
    # Favori version 3 : la tuile dit son stock (« Prévenez-moi quand il sera disponible. » = rupture)
    assert U.ligne_collecte({**_tuile("Batterie iPhone 13 (Ti)", "A2633-BAT", IPHONE), "stock": "rupture"}, "Apple")["en_stock"] is False
    assert U.ligne_collecte({**_tuile("Batterie iPhone 13 (Ti)", "A2633-BAT", IPHONE), "stock": "ok"}, "Apple")["en_stock"] is True
    assert U.en_stock_tuile({"stock": "rupture"}) is False and U.en_stock_tuile({"stock": "ok"}) is True and U.en_stock_tuile({}) is None
    assert U.VERSION == "3" and "Pr[ée]venez-moi quand il sera disponible" in U.SCRIPT and "stock:rupture?'rupture':'ok'" in U.SCRIPT
    cas = {
        "Connecteur de Charge Lumière Stellaire iPhone 13 (ReLife)": ("iPhone 13", "Connecteur de charge", ""),
        "Haut-Parleur iPhone 13": ("iPhone 13", "Haut-parleur", ""),
        "Ecouteur Interne Galaxy A54 5G (A546B)": ("Galaxy A54 5G", "Ecouteur interne", ""),
        "Vitre Arrière Verte Galaxy A54 5G (A546B)": ("Galaxy A54 5G", "Vitre arriere", ""),
        "Caméra Grand Angle 50MP Galaxy A54 5G (A546B)": ("Galaxy A54 5G", "Camera arriere", ""),
        "Caméra Arrière iPhone 13/13 mini (ReLife)": ("iPhone 13/13 mini", "Camera arriere", ""),
        "Lentille Caméra Galaxy A54 5G (A546B)": ("Galaxy A54 5G", "Vitre camera arriere", ""),
        "Batterie Galaxy A34 5G/A35 5G/A54 5G (A346B/A356B/A546B)": ("Galaxy A34 5G/A35 5G/A54 5G", "Batterie", ""),
        "Batterie iPhone 13 (Service Pack)": ("iPhone 13", "Batterie", "Original"),
        "Ecran Complet Google Pixel 7 Pro (5G)": ("Google Pixel 7 Pro (5G)", "Ecran", "Original"),
        "Ecran Complet Intérieur Google Pixel 9 Pro Fold": ("Google Pixel 9 Pro Fold", "Ecran", "Original"),
    }
    for nom, (modele, piece, qualite) in cas.items():
        l = U.ligne_collecte(_tuile(nom, "123456", A54), "Samsung")
        assert l is not None, nom
        assert (l["modele"], l["type_piece"], l["qualite"]) == (modele, piece, qualite), nom
    # Écartés : caméras secondaires, écran externe, lots, accessoires, châssis, sans prix, sans modèle
    for nom in ("Caméra Arrière Ultra Grand Angle 12MP Galaxy A52/A54 5G", "Ecran Complet Externe Google Pixel 9 Pro Fold",
                "Lentille Caméra iPhone 13/13 mini (lot de 2)", "Adhésif Vitre Arrière A54 5G (A546B)",
                "Adhésifs Ecran iPhone 13 (Boite de 200)", "Châssis Complet Minuit iPhone 13 (Pulled A)",
                "Batterie iPhone 13 Haute Capacité (Ti)", "Batterie Galaxy (Modèles Multiples)", "Tiroir Sim Vert iPhone 13", ""):
        assert U.ligne_collecte(_tuile(nom, "1", A54), "Samsung") is None, nom
    assert U.ligne_collecte(_tuile("Batterie iPhone 13 (Ti)", "1", IPHONE, "S'identifier pour voir le prix", None), "Apple") is None


def test_lignes_collecte_marque_de_la_page_doublons_et_diagnostic():
    pages = {IPHONE: {"marque": "apple", "modele": "iPhone 13"}, PIXEL: {"marque": "google", "modele": None}}
    produits = [_tuile("Batterie iPhone 13 (Ti)", "A2633-BAT", IPHONE), _tuile("Batterie iPhone 13 (Ti)", "A2633-BAT", IPHONE),
                _tuile("Ecran Complet Pixel 10a (Sans Châssis) (ReLife)", "EC-P10A", PIXEL),
                _tuile("Tiroir Sim iPhone 13", "T1", IPHONE), "bruit", {"nom": "", "page": IPHONE}]
    lignes, diag = U.lignes_collecte(produits, pages, 1.2)
    assert [(l["marque"], l["modele"], l["type_piece"]) for l in lignes] == [("Apple", "iPhone 13", "Batterie"),
                                                                              ("Google", "Pixel 10a", "Ecran")]
    # Diagnostic : chaque produit vu (même sans ligne), rattaché à la recherche de sa page modèle
    assert [(d["title_name"], d["_q"], d["price"]) for d in diag] == [
        ("Batterie iPhone 13 (Ti)", "iPhone 13", 12.5), ("Ecran Complet Pixel 10a (Sans Châssis) (ReLife)", "", 12.5),
        ("Tiroir Sim iPhone 13", "iPhone 13", None)]
    contenu = F.csv_lignes(lignes)
    assert "Apple;iPhone 13;Batterie;;12,50".encode("utf-8") in contenu


# ─── Traitement d'une collecte ───────────────────────────────────

@contextmanager
def _base_utopya(base, monkeypatch):
    @contextmanager
    def gc(*a, **k):
        yield base
    monkeypatch.setattr(U, "get_cursor", gc)
    with _sur(base):
        yield base


def test_traiter_importe_tarifs_et_apple_et_note_le_resume(monkeypatch):
    base = _Base({}, [("Apple", "iPhone 13"), ("Apple", 'MacBook Air 13" A2179 (2020 Intel)')])
    imports = []

    def faux_import(cur, cible, contenu, nom, r, fournisseur="Mobilax", auteur="x", source="mobilax", infos=None, lignes=None):
        imports.append((cible, nom, fournisseur, auteur, source, contenu.decode("utf-8-sig").count("\n") - 1, len(lignes or [])))
        return {"cible": cible, "import_id": len(imports), "lot_id": f"lot-{cible}", "erreur": None,
                "_cles": {f"tarifs:{len(imports)}"}, **{k: 1 for k in F._COMPTES}}

    monkeypatch.setattr(F, "_importer", faux_import)
    purges, nettoyages = [], []
    monkeypatch.setattr(F, "purger_prix_incoherents", lambda cur, par, r=None: purges.append(par) or {"examines": 3, "supprimes": 1, "reassignees": 1, "videes": 0, "lot_id": "lot-p"})
    monkeypatch.setattr(F, "corriger_sans_chassis", lambda cur, par, r=None: purges.append(("chassis", par)) or {"examines": 2, "corriges": 1, "reassignees": 1, "lot_id": "lot-c"})
    monkeypatch.setattr(U.prix, "purger_catalogue", lambda cur, f, age: nettoyages.append((f, age)) or 7)
    monkeypatch.setattr(U.prix, "regles", lambda cur: {"tva": 1.2})
    monkeypatch.setattr(F, "_pieces_grille", lambda cur: [
        {"cle": "tarifs:1", "marque": "Apple", "modele": "iPhone 13", "type_piece": "Batterie", "qualite": None},
        {"cle": "tarifs:9", "marque": "Apple", "modele": "iPhone 13", "type_piece": "Ecran", "qualite": "Original"}])
    pages = [{"url": IPHONE, "marque": "apple", "modele": "iPhone 13"},
             {"url": "https://www.utopya.fr/apple/macbook/air-13-a2179.html", "marque": "apple",
              "modele": 'MacBook Air 13" A2179 (2020 Intel)'}]
    collecte = {"produits": [_tuile("Batterie iPhone 13 (Ti)", "A2633-BAT", IPHONE),
                             _tuile("Ecran Complet iPhone 13 (Service Pack)", "102273", IPHONE, "S'identifier", None),
                             _tuile('Batterie MacBook Air 13" (A2179)', "MB1", pages[1]["url"], "49,00 € HT", "49")],
                "pages": pages, "pages_lues": 2, "pages_total": 2, "erreurs": [], "interrompu": False}
    with _base_utopya(base, monkeypatch):
        r = U.traiter(collecte)
    assert r["ok"] is True and r["erreur"] is None, r
    assert [(c, f, a, s, n, nl) for c, _, f, a, s, n, nl in imports] == [
        ("tarifs", "Utopya", "Collecte Utopya", "utopya", 2, 2), ("tarifs_apple_devices", "Utopya", "Collecte Utopya", "utopya", 1, 1)]
    assert imports[0][1].startswith("utopya-") and r["produits"] == 3 and r["produits_prix"] == 2
    assert r["lignes_envoyees"] == 2 and r["lignes"] == 2
    assert r["modifies"] == 2 and r["propositions"] == 2 and r["complements"] == 2
    # Purge des qualités incohérentes après chaque collecte ; catalogue nettoyé seulement après une collecte complète
    assert purges == ["Collecte Utopya", ("chassis", "Collecte Utopya")] and r["purge"]["supprimes"] == 1
    assert r["chassis"] == {"examines": 2, "corriges": 1, "reassignees": 1, "lot_id": "lot-c"}
    assert nettoyages and nettoyages[0][0] == "Utopya" and r["catalogue_retires"] == 7
    assert r["lots"] == ["lot-tarifs", "lot-tarifs_apple_devices"] and r["pages_lues"] == 2
    # Diagnostic : l'écran iPhone 13 (sans prix lu) reste sans prix Utopya, la batterie est reconnue
    diag = json.loads(base.params[U.P_DIAG])
    assert diag["n"] == 1 and diag["pieces"][0]["cle"] == "tarifs:9" and r["sans_prix"] == 1
    assert base.params[U.P_OK] == "1" and json.loads(base.params[U.P_RESUME])["modifies"] == 2
    assert base.params[U.P_DERNIERE]


def test_traiter_sans_prix_ni_lignes(monkeypatch):
    base = _Base({}, [("Apple", "iPhone 13")])
    monkeypatch.setattr(U.prix, "regles", lambda cur: {"tva": 1.2})
    monkeypatch.setattr(F, "_importer", lambda *a, **k: pytest.fail("aucun import attendu"))
    collecte = {"produits": [_tuile("Batterie iPhone 13 (Ti)", "A2633-BAT", IPHONE, "S'identifier pour voir le prix", None)],
                "pages": [{"url": IPHONE, "marque": "apple", "modele": "iPhone 13"}]}
    with _base_utopya(base, monkeypatch):
        r = U.traiter(collecte)
    assert r["ok"] is False and "connectez-vous" in r["erreur"] and base.params[U.P_OK] == "0"
    with _base_utopya(base, monkeypatch):
        r = U.traiter({"produits": [], "pages": []})
    assert r["ok"] is True and r["lignes_envoyees"] == 0 and r["modifies"] == 0


def test_lancer_une_collecte_a_la_fois(monkeypatch):
    import threading
    barriere = threading.Event()
    monkeypatch.setattr(U, "traiter", lambda c: barriere.wait(5))
    assert U.lancer({"produits": []}) is True
    assert U.en_cours() is True and U.lancer({"produits": []}) is False
    barriere.set()
    U._etat["thread"].join(5)
    assert U.en_cours() is False


# ─── État, clé, script ───────────────────────────────────────────

def _params(monkeypatch, valeurs: dict):
    monkeypatch.setattr(params_cache, "get_params", lambda cles, defauts=None, cur=None: {c: valeurs.get(c, "") for c in cles})
    monkeypatch.setattr(params_cache, "get_param", lambda cle, defaut="", cur=None: valeurs.get(cle, defaut))


def test_etat_sante_et_phrase_suivi(monkeypatch):
    resume = {"ok": True, "modifies": 40, "propositions": 2, "complements": 15, "purge": {"supprimes": 3},
              "chassis": {"corriges": 2}, "sans_prix": 120, "produits": 9000, "erreur": None}
    _params(monkeypatch, {U.P_CLE: CLE, U.P_DERNIERE: "2026-11-04T18:00:00", U.P_OK: "1", U.P_RESUME: json.dumps(resume)})
    e = U.etat()
    assert e["disponible"] and e["configure"] and e["ok"] is True and e["derniere_collecte"] == "2026-11-04T18:00:00"
    assert e["resume"]["modifies"] == 40 and e["erreur"] is None and CLE not in json.dumps(e)
    assert U.phrase_suivi(e) == ("Terminé : 40 prix mis à jour, 2 à valider dans Klikphone, 15 pièces que Mobilax n'a pas "
                                 "(complétées par Utopya), 3 prix retirés (qualité d'écran incohérente), "
                                 "2 écrans passés sur la variante avec châssis, "
                                 "120 pièces de la grille sans prix Utopya (9000 produits lus).")
    assert U.phrase_suivi({**e, "en_cours": True}) == "Klikphone met les prix à jour…"
    assert U.sante() == {"configure": True, "derniere_collecte": "2026-11-04T18:00:00", "ok": True, "en_cours": False,
                         "modifies": 40, "propositions": 2, "sans_prix": 120}
    _params(monkeypatch, {U.P_OK: "0", U.P_RESUME: json.dumps({"ok": False, "erreur": "boum"})})
    e = U.etat()
    assert e["configure"] is False and e["ok"] is False and e["erreur"] == "boum"
    assert U.phrase_suivi(e) == "Collecte échouée : boum"
    _params(monkeypatch, {})
    assert U.phrase_suivi(U.etat()) == "Aucune collecte encore."
    assert F.etat()["utopya"]["disponible"] is True


def test_cle_valide_et_script(monkeypatch):
    _params(monkeypatch, {U.P_CLE: CLE})
    assert U.cle_valide(CLE) and U.cle_valide(f" {CLE}\n") and not U.cle_valide("x" * 48) and not U.cle_valide("") and not U.cle_valide(None)
    _params(monkeypatch, {})
    assert not U.cle_valide(CLE)
    url = U.script_collecteur("https://klikphone.example/", CLE)
    assert url.startswith("javascript:void(") and "\n" not in url and "%" not in url
    assert url.endswith("})())") and not url.endswith(";)")
    assert "API='https://klikphone.example'" in url and "'/api/tarifs/fournisseurs/utopya/'+" in url
    assert f"CLE='{CLE}'" in url and "X-Collecte-Cle" in url and "utopya.fr" in url and "product_list_limit=200" in url
    assert "//" not in url.replace("https://", "").replace("http://", "")


def test_cle_creee_a_la_demande(monkeypatch):
    base = _Base({})
    monkeypatch.setattr(params_cache, "get_param", lambda cle, defaut="", cur=None: base.params.get(cle, defaut))
    with _base_utopya(base, monkeypatch):
        assert U.cle_collecteur() == ""
        c = U.collecteur("https://kp.example")
        assert c["configure"] and base.params[U.P_CLE] and base.params[U.P_CLE] in c["url"] and c["api"] == "https://kp.example"
        ancienne = base.params[U.P_CLE]
        assert U.regenerer_cle() != ancienne and base.params[U.P_CLE] != ancienne


def test_routes_collecteur_plan_collecte_suivi(client, monkeypatch):
    _params(monkeypatch, {U.P_CLE: CLE})
    # Favori : admin prouvé seulement
    assert client.get("/api/tarifs/fournisseurs/utopya/collecteur").status_code == 401
    _, gc_staff = fake_db(lambda sql, params: None)
    with patch("app.api.auth.get_cursor", gc_staff):
        assert client.get("/api/tarifs/fournisseurs/utopya/collecteur", headers=_headers()).status_code == 403
        assert client.post("/api/tarifs/fournisseurs/utopya/collecteur/regenerer", headers=_headers()).status_code == 403
    _, gc_admin = fake_db(lambda sql, params: _ADMIN_PROUVE if "membres_equipe" in sql else None)
    with patch("app.api.auth.get_cursor", gc_admin):
        r = client.get("/api/tarifs/fournisseurs/utopya/collecteur", headers=_headers())
        assert r.status_code == 200 and r.json()["url"].startswith("javascript:void(") and f"CLE='{CLE}'" in r.json()["url"]
        assert r.json()["api"].startswith("http")
        monkeypatch.setattr(U, "regenerer_cle", lambda: "n" * 48)
        assert client.post("/api/tarifs/fournisseurs/utopya/collecteur/regenerer", headers=_headers()).status_code == 200
    # Endpoints du collecteur : clé dans l'en-tête, jamais de session
    assert client.post("/api/tarifs/fournisseurs/utopya/plan", json={"liens": []}).status_code == 401
    assert client.post("/api/tarifs/fournisseurs/utopya/plan", json={"liens": []}, headers={"X-Collecte-Cle": "x" * 48}).status_code == 401
    assert client.get("/api/tarifs/fournisseurs/utopya/suivi").status_code == 401
    plans = []
    monkeypatch.setattr(U, "plan_grille", lambda cur, liens: plans.append(liens) or {"pages": [{"url": IPHONE}], "sans_page": []})
    _, gc = fake_db(lambda sql, params: None)
    with patch("app.api.fournisseurs.get_cursor", gc, create=True), patch("app.database.get_cursor", gc):
        r = client.post("/api/tarifs/fournisseurs/utopya/plan", json={"liens": LIENS[:2], "version": "1"},
                        headers={"X-Collecte-Cle": CLE})
    assert r.status_code == 200 and r.json()["pages"][0]["url"] == IPHONE and plans == [LIENS[:2]]
    lances = []
    monkeypatch.setattr(U, "lancer", lambda c: lances.append(len(c["produits"])) or len(lances) == 1)
    corps = {"produits": [_tuile("Batterie iPhone 13 (Ti)", "A2633-BAT", IPHONE)], "pages": [], "pages_lues": 1, "pages_total": 1}
    r = client.post("/api/tarifs/fournisseurs/utopya/collecte", json=corps, headers={"X-Collecte-Cle": CLE})
    assert r.status_code == 200 and r.json()["lance"] is True and "1 produits reçus" in r.json()["message"]
    assert client.post("/api/tarifs/fournisseurs/utopya/collecte", json=corps, headers={"X-Collecte-Cle": CLE}).status_code == 409
    assert client.post("/api/tarifs/fournisseurs/utopya/collecte", json={"produits": []}, headers={"X-Collecte-Cle": CLE}).status_code == 422
    assert lances == [1, 1]
    monkeypatch.setattr(U, "etat", lambda cur=None: {"en_cours": False, "ok": True, "resume": {"modifies": 3, "produits": 10}})
    r = client.get("/api/tarifs/fournisseurs/utopya/suivi", headers={"X-Collecte-Cle": CLE})
    assert r.status_code == 200 and r.json() == {"en_cours": False, "ok": True, "message": "Terminé : 3 prix mis à jour (10 produits lus)."}
    # Diagnostic : personnel sans prix, admin avec
    appels = []
    monkeypatch.setattr(U, "diagnostic", lambda admin=False, cur=None: appels.append(admin) or {"n": 0, "pieces": []})
    with patch("app.api.auth.get_cursor", gc_staff):
        assert client.get("/api/tarifs/fournisseurs/utopya/diagnostic", headers=_headers()).status_code == 200
    with patch("app.api.auth.get_cursor", gc_admin):
        assert client.get("/api/tarifs/fournisseurs/utopya/diagnostic", headers=_headers()).status_code == 200
    assert appels == [False, True]


def test_diagnostic_utopya_lit_sa_cle_et_nomme_le_fournisseur(monkeypatch):
    d = F.diagnostic_pieces([{"cle": "tarifs:1", "marque": "Apple", "modele": "iPhone 13", "type_piece": "Ecran", "qualite": "Original"}],
                            [{"title_name": "Ecran Complet iPhone 13 (ReLife)", "price": 40.0, "active": True, "_q": "iPhone 13"}],
                            set(), [("Apple", "iPhone 13")])
    _params(monkeypatch, {U.P_DIAG: json.dumps(d)})
    out = U.diagnostic(admin=True)
    assert out["n"] == 1 and out["fournisseur"] == "Utopya" and out["raisons"]["non_reconnue"].startswith("Des produits Utopya")
    assert out["pieces"][0]["candidats"][0] == {"nom": "Ecran Complet iPhone 13 (ReLife)", "prix_ht": 40.0}
    assert U.diagnostic(admin=False)["pieces"][0]["candidats"] == [{"nom": "Ecran Complet iPhone 13 (ReLife)"}]


def test_script_du_favori_est_du_javascript_valide(tmp_path):
    """Une adresse javascript: mal formée ne fait rien au clic (SyntaxError muette dans la console
    de Chrome) : le corps du favori est vérifié par node quand il est installé."""
    node = shutil.which("node")
    if not node:
        pytest.skip("node absent")
    url = U.script_collecteur("https://klikphone.example", CLE)
    fichier = tmp_path / "favori.js"
    fichier.write_text(url[len("javascript:"):], encoding="utf-8")
    r = subprocess.run([node, "--check", str(fichier)], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
