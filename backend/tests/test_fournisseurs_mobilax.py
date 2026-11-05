"""Synchro automatique des tarifs Mobilax (services/fournisseurs, api/fournisseurs).

Aucune requête réseau : l'API Mobilax est simulée par httpx.MockTransport et les produits
viennent de tests/fixtures/mobilax_products.json (forme relevée sur mobilax.fr). Les tests sur
base réelle (KP_TEST_DATABASE_URL, base jetable migrée) écrivent des pièces fictives puis
annulent la transaction.
"""

import json
import os
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest

from app.api.auth import create_admin_token, create_token, decode_token
from app.services import fournisseurs as F
from app.services import import_prix
from app.services import params as params_cache
from tests.test_securite_c1 import _ADMIN_PROUVE, _headers, fake_db

FIXTURE = Path(__file__).parent / "fixtures" / "mobilax_products.json"
REFRESH = "r3fr3sh-" + "a" * 40
TOKEN = "t0k3n-" + "b" * 40


def _fixture() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _produits() -> list:
    return _fixture()["data"]["products"]


# ─── Jetons collés ───────────────────────────────────────────────

def test_lire_jetons_depuis_localstorage():
    texte = json.dumps({
        "web_mobi_token": json.dumps(TOKEN),             # localStorage : chaîne JSON entre guillemets
        "web_mobi_refresh_token": REFRESH,
        "web_mobi_user_id": "\"4242\"",
        "web_mobi_user_type": "customer",
    })
    j = F.lire_jetons(texte)
    assert j == {"refresh": REFRESH, "token": TOKEN, "id_client": "4242", "palier": {}}


def test_lire_jetons_fiche_client_donne_le_palier_et_l_id():
    # Le site range la fiche du compte dans localStorage (clé userId, chaîne JSON) : palier tarifaire
    fiche = json.dumps({"state": {"user": {"id": 1099, "show_prices": True, "company": "X",
                                           "category": {"id": 3, "name": "Gold", "rate": 0.5}}}, "version": 0})
    j = F.lire_jetons(json.dumps({"web_mobi_refresh_token": REFRESH, "userId": fiche}))
    assert j["id_client"] == "1099" and j["palier"] == {"id": 3, "nom": "Gold"}
    # web_mobi_user_id prime ; fiche illisible ou sans palier : rien de cassé
    j = F.lire_jetons(json.dumps({"web_mobi_refresh_token": REFRESH, "web_mobi_user_id": "7", "userId": fiche}))
    assert j["id_client"] == "7" and j["palier"]["nom"] == "Gold"
    j = F.lire_jetons(json.dumps({"web_mobi_refresh_token": REFRESH, "userId": "{pas du json"}))
    assert j["id_client"] == "" and j["palier"] == {}
    assert F.palier_compte({"category": {"name": "Silver"}}) == {"id": None, "nom": "Silver"}
    assert F.palier_compte({"category": "Gold"}) == {} and F.palier_compte(None) == {}


def test_lire_jetons_seul_jeton_ou_erreurs():
    assert F.lire_jetons(f"  {REFRESH}\n")["refresh"] == REFRESH
    with pytest.raises(ValueError, match="Collez"):
        F.lire_jetons("")
    with pytest.raises(ValueError, match="illisible"):
        F.lire_jetons("{pas du json")
    with pytest.raises(ValueError, match="introuvable"):
        F.lire_jetons(json.dumps({"web_mobi_token": TOKEN}))
    with pytest.raises(ValueError, match="introuvable"):
        F.lire_jetons("bonjour tout le monde")
    with pytest.raises(ValueError, match="trop long"):
        F.lire_jetons("x" * 40001)


# ─── Lecture des produits ────────────────────────────────────────

def test_lire_page_toutes_enveloppes():
    produits, pages = F.lire_page(_fixture())
    assert len(produits) == 7 and pages == 1
    assert F.lire_page({"products": [{"id": 1}], "totalPage": "3"}) == ([{"id": 1}], 3)
    assert F.lire_page({"data": {"data": [{"id": 2}]}}) == ([{"id": 2}], 1)
    assert F.lire_page([{"id": 3}, "bruit"]) == ([{"id": 3}], 1)
    assert F.lire_page(None) == ([], 1)
    assert F.lire_page({"data": {"products": "rien", "totalPage": -4}}) == ([], 1)


@pytest.mark.parametrize("produit, attendu", [
    ({"price": 128.9}, Decimal("128.90")),
    ({"price": "54,90"}, Decimal("54.90")),
    ({"price": "1 234,5 €"}, Decimal("1234.50")),
    ({"price": None, "prices": [{"quantity": 5, "price": 40}, {"quantity": 1, "price": 45.5}]}, Decimal("45.50")),
    ({"price": {"ht": "12", "ttc": "14.4"}}, Decimal("12.00")),
    ({"price_ht": 9.99, "price": 11.99}, Decimal("9.99")),
    ({"price": None}, None),
    ({"price": 0}, None),
    ({"price": -3}, None),
    ({"price": 99999}, None),
    ({"price": "abc"}, None),
    ({"name": "sans prix"}, None),
])
def test_prix_produit(produit, attendu):
    assert F.prix_produit(produit) == attendu


def test_prix_du_palier_du_compte():
    # Forme réelle : price = prix de base (Bronze), prices = un prix par palier client
    p = {"price": 1.7, "prices": [
        {"id": 1, "name": "Bronze", "rate": 0, "price": 1.7, "ca_min": 0, "ca_max": 1499.99},
        {"id": 2, "name": "Silver", "rate": 0.25, "price": 1.65, "ca_min": 1500, "ca_max": 2999.99},
        {"id": 3, "name": "Gold", "rate": 0.5, "price": 1.6, "ca_min": 3000, "ca_max": 5999.99},
        {"id": 4, "name": "Platinum", "rate": 0.75, "price": None, "ca_min": 6000, "ca_max": 14999.99},
    ]}
    assert F.prix_produit(p, {"id": 3, "nom": "Gold"}) == Decimal("1.60")
    assert F.prix_produit(p, {"id": None, "nom": "gold"}) == Decimal("1.60")      # par le nom
    assert F.prix_produit(p, {"id": 2, "nom": "Autre"}) == Decimal("1.65")        # l'id prime
    assert F.prix_produit(p, {"id": 4, "nom": "Platinum"}) == Decimal("1.70")     # palier sans prix : base
    assert F.prix_produit(p, {"id": 9, "nom": "Inconnu"}) == Decimal("1.70")
    assert F.prix_produit(p) == Decimal("1.70") and F.prix_produit(p, {}) == Decimal("1.70")
    # Paliers de quantité : la logique « plus petite quantité » reste
    q = {"prices": [{"quantity": 5, "price": 40}, {"quantity": 1, "price": 45.5}]}
    assert F.prix_produit(q, {"id": 3, "nom": "Gold"}) == Decimal("45.50")
    assert F.ligne_produit({"id": 5, "name": "Ecran X", **p}, {"id": 3, "nom": "Gold"})["prix_ht"] == Decimal("1.60")
    assert F.ligne_produit({"id": 5, "name": "Ecran X", **p})["prix_ht"] == Decimal("1.70")


def test_produit_pertinent_ecarte_protections_accessoires_et_inactifs():
    p = {x["id"]: x for x in _produits()}
    assert F.produit_pertinent(p[37985]) and F.produit_pertinent(p[40011]) and F.produit_pertinent(p[40012])
    assert not F.produit_pertinent(p[36686])      # verre trempé
    assert not F.produit_pertinent(p[40014])      # inactif
    assert not F.produit_pertinent({"name": "Coque silicone iPhone 13"})
    assert not F.produit_pertinent({"name": "Écran iPhone 13", "category_name": "Outils"})
    assert not F.produit_pertinent({"name": ""}) and not F.produit_pertinent(None)


@pytest.mark.parametrize("nom, attendu", [
    ("Batterie Originale Honor 200 5G 0235AKJJ HB496590EIW", "Batterie Originale Honor 200 5G"),
    ("Connecteur de Charge Premium Honor 200 5G", "Connecteur de Charge Compatible Honor 200 5G"),
    ("Bloc Écran Complet avec Châssis et Batterie Original Honor 200 5G 0235AKHV 0235ALRJ Noir",
     "Bloc Écran Complet avec Châssis Original Honor 200 5G"),
    ("Ecran Tactile Original Pulled avec Châssis (PIEC) Honor 200 5G Moonlight White", "Ecran Tactile Original Pulled avec Châssis Honor 200 5G"),
    ("Caméra Principale Premium Honor 200 5G 50MP", "Caméra Principale Compatible Honor 200 5G"),
    ("Batterie EB-BA166ASE Galaxy A18 4G (A185F)", "Batterie Galaxy A18 4G (A185F)"),
    ("Ecran Complet Graphite Galaxy S26 FE (S741B) (PA)", "Ecran Complet Graphite Galaxy S26 FE (S741B)"),
    ("Ecran OLED iPhone 13 Noir", "Ecran OLED iPhone 13"),
    ("Vitre Arrière Noire", "Vitre Arrière"),             # jamais réduit à moins de deux mots
    ("Rouge Noir", "Rouge Noir"),
    ("  Ecran   iPhone 15 Pro Max  ", "Ecran iPhone 15 Pro Max"),
    # Vocabulaire Mobilax → grille
    ("Cache Arrière Original Honor 200 5G 0235AKMV Noir", "Vitre Arrière Original Honor 200 5G"),
    ("Lentille Premium Honor 200 5G Noir", "Lentille caméra arrière Compatible Honor 200 5G"),
    ("Lentille Caméra Arrière iPhone 15 Pro Max", "Lentille Caméra Arrière iPhone 15 Pro Max"),
    ("Caméra Visio Premium Honor 200 5G 50MP", "Caméra avant Compatible Honor 200 5G"),
])
def test_designation_import(nom, attendu):
    assert F.designation_import(nom) == attendu


def test_cameras_secondaires_ignorees():
    assert not F.produit_pertinent({"name": "Caméra Ultra Grand Angle Premium Honor 200 5G/200 Pro 12MP"})
    assert not F.produit_pertinent({"name": "Téléobjectif Premium Honor 200 5G 50MP"})
    assert F.produit_pertinent({"name": "Caméra Principale Premium Honor 200 5G 50MP"})


def test_lignes_et_csv_relus_par_le_moteur_d_import():
    lignes = [l for l in (F.ligne_produit(p) for p in _produits() if F.produit_pertinent(p)) if l]
    # 4 pièces avec prix (le connecteur n'a pas de prix, le verre trempé et le tiroir inactif sont écartés)
    assert [l["reference"] for l in lignes] == ["3000000321676", "3000000321677", "3000000355123", "3000000355200"]
    # Pièce et qualité lues dans la catégorie Mobilax, modèle dans le nom (marque comprise)
    assert lignes[2] == {"reference": "3000000355123", "designation": "Ecran Tactile OEM Honor 200 5G",
                         "modele": "Honor 200 5G", "type_piece": "Ecran", "qualite": "Compatible",
                         "prix_ht": Decimal("54.90"), "en_stock": True, "url": None}
    assert lignes[3]["designation"] == "Batterie Originale Honor 200 5G"
    assert (lignes[3]["modele"], lignes[3]["type_piece"], lignes[3]["qualite"]) == ("Honor 200 5G", "Batterie", "Original")
    assert lignes[0]["type_piece"] == "Ecran" and lignes[0]["qualite"] == "Original"   # bloc écran complet
    sans_cat = F.ligne_produit({"id": 77, "name": "X", "price": 3})
    assert sans_cat["reference"] == "MX77" and sans_cat["modele"] == "" and sans_cat["type_piece"] == ""
    contenu = F.csv_lignes(lignes)
    tableau = import_prix.lire_tableau("mobilax-auto.csv", contenu)
    i_entete, colonnes, mapping = import_prix.detecter_entete(tableau)
    assert i_entete == 0 and set(mapping) == {"reference", "designation", "marque", "modele", "type_piece", "qualite", "prix_ht"}
    assert import_prix.lire_prix(tableau[3][colonnes.index(mapping["prix_ht"])]) == Decimal("54.90")
    assert tableau[3][colonnes.index(mapping["modele"])] == "Honor 200 5G" and tableau[3][colonnes.index(mapping["marque"])] == ""


def test_requetes_modeles_depliees_et_sans_doublon():
    modeles = [("Apple", "iPhone 12/12 Pro"), ("Oppo", "Reno 10"), ("Samsung", "Galaxy A52"), ("Apple", "iPad Air 4"),
               ("Autre", "Trucmuche"), ("samsung", "galaxy  a52"), ("", "")]
    assert F.requetes_modeles(modeles) == ["iPhone 12", "iPhone 12 Pro", "Oppo Reno 10", "Galaxy A52", "iPad Air 4", "Trucmuche"]


# ─── Choix des lignes d'un aperçu ────────────────────────────────

def _rec(n, cle, ht, alertes=(), verrou=False, obsolete=False, label=None):
    return {"n": n, "cle": cle, "label": label or cle, "nouveau_ht": ht, "alertes": list(alertes),
            "verrou": verrou, "obsolete": obsolete}


def test_planifier_applique_propose_et_laisse():
    ap = {"reconnues": [
        _rec(2, "tarifs:1", 55.0),                                   # simple → appliquée
        _rec(3, "tarifs:2", 20.0, ["variation"]),                    # grosse variation → proposition
        _rec(4, "tarifs:3", 60.0, ["conflit"]),                      # variantes de la même pièce : la moins chère
        _rec(5, "tarifs:3", 58.0, ["conflit"]),
        _rec(6, "tarifs:3", 58.0, ["doublon"]),                      # même prix : rien de plus
        _rec(7, "tarifs:4", 30.0, ["verrou"], verrou=True),          # verrouillée → jamais
        _rec(8, "tarifs:5", 12.0, [], obsolete=True),                # obsolète → laissée
        _rec(9, "tarifs:6", 70.0, ["marge"]),                        # marge faible : prix réel, appliqué
        _rec(10, "tarifs:7", 40.0), _rec(10, "tarifs:8", 40.0),      # nom groupé : deux pièces, même ligne
        _rec(11, "tarifs:8", 45.0),                                  # autre prix pour une pièce déjà visée
    ]}
    plan = F.planifier(ap)
    assert plan["lignes"] == [2, 5, 9, 10]
    assert plan["propositions"] == [{"cle": "tarifs:2", "ht": "20.0", "label": "tarifs:2"}]
    assert (plan["verrouillees"], plan["obsoletes"], plan["variantes"], plan["a_valider"]) == (1, 1, 2, 1)
    assert F.planifier({"reconnues": []}) == {"lignes": [], "propositions": [], "verrouillees": 0, "obsoletes": 0,
                                               "variantes": 0, "a_valider": 0, "remplaces": 0, "plus_cher_ailleurs": 0,
                                               "autre_fournisseur_choisi": 0}


# ─── Prix sans valeur de référence : remplacés sans validation ──

def test_remplacable_absent_estime_perime_ou_recent():
    from datetime import datetime
    now = datetime(2026, 11, 4, 12, 0, 0)
    r = {"jours_perime": 180}
    assert F.remplacable({"ht": None, "prix_source": "import", "prix_maj_le": now}, r, now)
    assert F.remplacable({"ht": 0, "prix_source": "import", "prix_maj_le": now}, r, now)
    assert F.remplacable({"ht": 42, "prix_source": "estimation_2026_02", "prix_maj_le": now}, r, now)
    assert F.remplacable({"ht": 42, "prix_source": "import", "prix_maj_le": None}, r, now)
    assert F.remplacable({"ht": 42, "prix_source": "import", "prix_maj_le": "2026-02-10T08:00:00"}, r, now)   # 267 j
    assert not F.remplacable({"ht": 42, "prix_source": "import", "prix_maj_le": "2026-09-01T08:00:00"}, r, now)
    assert not F.remplacable({"ht": 42, "prix_source": "manuel", "prix_maj_le": now}, r, now)
    assert F.remplacable(None, r, now) is False and F.remplacable({}, r, now) is True
    # Règle du magasin : « périmé » à 90 jours → un prix de 100 jours est remplacé
    assert F.remplacable({"ht": 42, "prix_source": "import", "prix_maj_le": "2026-07-20T08:00:00"}, {"jours_perime": 90}, now)


def test_planifier_remplace_les_prix_estimes_et_perimes_mais_propose_les_recents():
    from datetime import datetime
    now = datetime(2026, 11, 4, 12, 0, 0)
    ap = {"reconnues": [
        _rec(2, "tarifs:1", 55.0, ["variation"]),      # estimé → appliqué
        _rec(3, "tarifs:2", 20.0, ["variation"]),      # récent → proposition
        _rec(4, "tarifs:3", 30.0, ["variation"]),      # périmé → appliqué
        _rec(5, "tarifs:4", 12.0, ["variation"]),      # sans HT → appliqué
        _rec(6, "tarifs:5", 70.0),                     # pas de variation → appliqué
        _rec(7, "tarifs:6", 90.0, ["variation"]),      # pièce non décrite → proposition (prudence)
    ]}
    descs = {
        "tarifs:1": {"ht": 10, "prix_source": "estimation_2026_02", "prix_maj_le": now},
        "tarifs:2": {"ht": 10, "prix_source": "import", "prix_maj_le": datetime(2026, 10, 1)},
        "tarifs:3": {"ht": 10, "prix_source": "import", "prix_maj_le": datetime(2026, 1, 1)},
        "tarifs:4": {"ht": None, "prix_source": None, "prix_maj_le": None},
    }
    plan = F.planifier(ap, descs, {"jours_perime": 180}, now)
    assert plan["lignes"] == [2, 4, 5, 6]
    assert [p["cle"] for p in plan["propositions"]] == ["tarifs:2", "tarifs:6"]
    assert plan["remplaces"] == 3 and plan["a_valider"] == 2
    # Sans descriptions : comportement d'origine (toute grosse variation proposée)
    plan0 = F.planifier(ap)
    assert plan0["lignes"] == [6] and plan0["remplaces"] == 0 and plan0["a_valider"] == 5


# ─── Diagnostic : pièces de la grille sans prix ──────────────────

def _prod(i, nom, q, prix=10.0, actif=True):
    return {"id": i, "title_name": nom, "name": nom, "price": prix, "active": actif, "_q": q}


def test_diagnostic_pieces_raisons_et_candidats():
    pieces = [
        {"cle": "tarifs:1", "marque": "Google", "modele": "Pixel 7", "type_piece": "Ecran", "qualite": "Compatible"},
        {"cle": "tarifs:2", "marque": "Google", "modele": "Pixel 7", "type_piece": "Batterie", "qualite": None},
        {"cle": "tarifs:3", "marque": "Google", "modele": "Pixel 7", "type_piece": "Connecteur de charge", "qualite": None},
        {"cle": "tarifs:4", "marque": "Oppo", "modele": "Reno 10", "type_piece": "Ecran", "qualite": None},
        {"cle": "tarifs:5", "marque": "Sony", "modele": "Xperia 1", "type_piece": "Ecran", "qualite": None},
        {"cle": "tarifs_apple_devices:9:batterie", "marque": "Apple", "modele": "iPad 9", "type_piece": "Batterie", "qualite": None},
    ]
    produits = [
        _prod(1, "Ecran Complet Google Pixel 7 Noir", "Google Pixel 7", 61.9),
        _prod(2, "Batterie Google Pixel 7 GTF8P", "Google Pixel 7", 12.5),
        _prod(3, "Coque silicone Google Pixel 7", "Google Pixel 7", 2.0),
        _prod(4, "Batterie Apple iPad 9 A2602", "iPad 9", 14.0),
    ]
    modeles = [("Google", "Pixel 7"), ("Oppo", "Reno 10"), ("Sony", "Xperia 1"), ("Apple", "iPad 9")]
    d = F.diagnostic_pieces(pieces, produits, {"tarifs:1"}, modeles, {"id": 3, "nom": "Gold"},
                            cherchees=["Google Pixel 7", "Oppo Reno 10", "iPad 9"], maintenant="2026-11-04T13:00:00")
    assert d["n"] == 5 and d["le"] == "2026-11-04T13:00:00" and d["tronque"] is False
    par_cle = {p["cle"]: p for p in d["pieces"]}
    assert "tarifs:1" not in par_cle                                      # reconnue
    assert par_cle["tarifs:2"]["raison"] == "non_reconnue"               # une batterie Pixel 7 existe chez Mobilax
    assert par_cle["tarifs:2"]["candidats"] == [{"nom": "Batterie Google Pixel 7 GTF8P", "prix_ht": 12.5}]
    assert par_cle["tarifs:3"]["raison"] == "piece_absente" and par_cle["tarifs:3"]["candidats"] == []
    assert par_cle["tarifs:4"]["raison"] == "aucun_produit"
    assert par_cle["tarifs:5"]["raison"] == "non_cherchee"
    assert par_cle["tarifs_apple_devices:9:batterie"]["raison"] == "non_reconnue"
    assert d["par_raison"] == {"aucun_produit": 1, "piece_absente": 1, "non_reconnue": 2, "non_cherchee": 1,
                               "sans_prix_fournisseur": 0}
    assert set(F.RAISONS) == set(d["par_raison"])


def test_diagnostic_tronque_et_lecture_selon_le_role(monkeypatch):
    monkeypatch.setattr(F, "DIAG_MAX_PIECES", 2)
    pieces = [{"cle": f"tarifs:{i}", "marque": "Sony", "modele": "Xperia 1", "type_piece": "Ecran", "qualite": None}
              for i in range(4)]
    d = F.diagnostic_pieces(pieces, [_prod(1, "Ecran Sony Xperia 1", "Sony Xperia 1", 99.0)], set(), [("Sony", "Xperia 1")])
    assert d["n"] == 4 and len(d["pieces"]) == 2 and d["tronque"] is True
    base = _Base({F.P_DIAG: json.dumps(d)})
    with _sur(base):
        _params(monkeypatch, base.params)
        admin = F.diagnostic(admin=True)
        staff = F.diagnostic(admin=False)
    assert admin["n"] == 4 and admin["pieces"][0]["candidats"][0]["prix_ht"] == 99.0 and admin["raisons"] == F.RAISONS
    assert staff["pieces"][0]["candidats"] == [{"nom": "Ecran Sony Xperia 1"}]
    with _sur(_Base({})):
        _params(monkeypatch, {})
        vide = F.diagnostic(admin=True)
    assert vide == {"le": None, "n": 0, "par_raison": {}, "pieces": [], "tronque": False, "raisons": F.RAISONS,
                    "fournisseur": "Mobilax"}
    assert F.raisons_pour("Utopya")["aucun_produit"] == "Utopya ne renvoie aucun produit pour ce modèle"


def test_route_diagnostic_selon_le_role(client, monkeypatch):
    appels = []
    monkeypatch.setattr(F, "diagnostic", lambda admin=False, cur=None: appels.append(admin) or {"n": 1, "pieces": []})
    assert client.get("/api/tarifs/fournisseurs/mobilax/diagnostic").status_code == 401
    _, gc_staff = fake_db(lambda sql, params: None)
    with patch("app.api.auth.get_cursor", gc_staff):
        r = client.get("/api/tarifs/fournisseurs/mobilax/diagnostic", headers=_headers())
    assert r.status_code == 200 and r.json()["n"] == 1 and appels == [False]
    _, gc_admin = fake_db(lambda sql, params: _ADMIN_PROUVE if "membres_equipe" in sql else None)
    with patch("app.api.auth.get_cursor", gc_admin):
        r2 = client.get("/api/tarifs/fournisseurs/mobilax/diagnostic", headers=_headers())
    assert r2.status_code == 200 and appels == [False, True]


# ─── Client Mobilax (transport simulé) ───────────────────────────

def _transport(pages_par_recherche, journal, refresh_ok=True, nouveau_refresh="", details=None, prix_masques=False):
    def handler(request: httpx.Request) -> httpx.Response:
        journal.append(request)
        chemin = request.url.path
        assert request.headers["User-Agent"].startswith("KlikphoneSAV/")
        if chemin.endswith("/user/refresh-token"):
            corps = json.loads(request.content or b"{}")
            if not refresh_ok or corps.get("refreshToken") not in (REFRESH, nouveau_refresh):
                return httpx.Response(401, json={"message": "invalid token"})
            d = {"token": TOKEN}
            if nouveau_refresh:
                d["refreshToken"] = nouveau_refresh
            return httpx.Response(200, json={"data": d})
        if request.headers.get("Authorization") != f"Bearer {TOKEN}":
            return httpx.Response(401, json={"message": "invalid token"})
        if chemin.endswith("/user/customers/details"):
            return httpx.Response(200, json={"data": details if details is not None else {"id": 4242, "show_prices": True}})
        if chemin.endswith("/catalogs/web/products"):
            q = request.url.params
            assert q.get("id_lang") == "1" and q.get("no_log") == "true" and q.get("limit") == "50"
            pages = pages_par_recherche.get(q.get("search"), [[]])
            page = int(q.get("page", "1"))
            prods = pages[page - 1] if page - 1 < len(pages) else []
            if prix_masques:
                prods = [{k: v for k, v in p.items() if k not in ("price", "prices")} for p in prods]
            return httpx.Response(200, json={"data": {"currentPage": page, "limit": 50, "offset": (page - 1) * 50,
                                                      "total": sum(len(x) for x in pages), "totalPage": len(pages),
                                                      "products": prods}})
        return httpx.Response(404, text="not found")
    return httpx.MockTransport(handler)


def test_client_rafraichit_pagine_et_fait_tourner_le_jeton():
    journal, pauses = [], []
    produits = _produits()
    transport = _transport({"Honor 200 5G": [produits[:3], produits[3:]]}, journal, nouveau_refresh="nouveau-" + "c" * 30)
    c = F.ClientMobilax(REFRESH, transport=transport, dormir=pauses.append)
    try:
        lus = c.produits("Honor 200 5G")
        assert [p["id"] for p in lus] == [p["id"] for p in produits]
        assert c.refresh == "nouveau-" + "c" * 30 and c.token == TOKEN
        assert c.details_client()["show_prices"] is True and c.id_client == "4242"
        # id_customer transmis dès qu'il est connu
        c.page_produits("iPhone 13")
        assert journal[-1].url.params.get("id_customer") == "4242"
        # refresh + 2 pages + détails + 1 page
        assert c.requetes == 5 and pauses == [F.PAUSE]
    finally:
        c.close()


def test_client_jeton_expire_et_pages_max():
    journal = []
    c = F.ClientMobilax(REFRESH, transport=_transport({}, journal, refresh_ok=False))
    with pytest.raises(F.ErreurJeton):
        c.rafraichir()
    c.close()
    # Jeton d'accès périmé : renouvelé une fois puis la requête rejouée
    c = F.ClientMobilax(REFRESH, token="perime-" + "d" * 30, transport=_transport({"X": [[{"id": 1}]]}, journal))
    assert c.produits("X") == [{"id": 1}] and c.token == TOKEN
    # Au plus PAGES_MAX pages par modèle
    beaucoup = {"Y": [[{"id": i}] for i in range(10)]}
    c2 = F.ClientMobilax(REFRESH, token=TOKEN, transport=_transport(beaucoup, journal), dormir=lambda s: None)
    assert len(c2.produits("Y")) == F.PAGES_MAX
    c.close()
    c2.close()


def test_client_erreurs_reseau_et_http():
    def panne(request):
        raise httpx.ConnectError("boom", request=request)
    c = F.ClientMobilax(REFRESH, transport=httpx.MockTransport(panne))
    with pytest.raises(F.ErreurMobilax, match="injoignable"):
        c.rafraichir()
    c.close()
    codes = iter([200, 429, 500])
    def http(request):
        if request.url.path.endswith("refresh-token"):
            return httpx.Response(200, json={"data": {"token": TOKEN}})
        return httpx.Response(next(codes), json={"data": {"products": []}})
    c = F.ClientMobilax(REFRESH, transport=httpx.MockTransport(http))
    assert c.produits("a") == []
    with pytest.raises(F.ErreurMobilax, match="429"):
        c.produits("b")
    with pytest.raises(F.ErreurMobilax, match="500"):
        c.produits("c")
    c.close()


# ─── Passage complet sur une base simulée ────────────────────────

class _Base:
    """Curseur simulé : params en mémoire, modèles de la grille fixes, rowcount réaliste."""

    def __init__(self, params=None, modeles=()):
        self.params = dict(params or {})
        self.modeles = list(modeles)
        self.rowcount = 0
        self._res = None
        self.sql = []

    def execute(self, sql, p=None):
        s = " ".join(str(sql).split())
        self.sql.append((s, p))
        self.rowcount = 0
        if s.startswith("SELECT cle, valeur FROM params"):
            self._res = [{"cle": c, "valeur": self.params[c]} for c in p[0] if c in self.params]
        elif s.startswith("SELECT valeur FROM params"):
            self._res = {"valeur": self.params[p[0]]} if p[0] in self.params else None
        elif s.startswith("INSERT INTO params"):
            if "DO NOTHING" in s and p[0] in self.params:
                return
            self.params[p[0]] = p[1]
            self.rowcount = 1
        elif s.startswith("UPDATE params SET valeur = %s WHERE cle = %s AND valeur IS NOT DISTINCT FROM"):
            if self.params.get(p[1]) == p[2]:
                self.params[p[1]] = p[0]
                self.rowcount = 1
        elif s.startswith("UPDATE params SET valeur = '' WHERE cle"):
            self.params[p[0]] = ""
            self.rowcount = 1
        elif s.startswith("DELETE FROM params"):
            for c in p[0]:
                self.params.pop(c, None)
        elif "FROM tarifs" in s and "DISTINCT marque, modele" in s:
            self._res = [{"marque": m, "modele": x} for m, x in self.modeles]
        else:
            self._res = None

    def fetchone(self):
        r = self._res
        return (r[0] if r else None) if isinstance(r, list) else r

    def fetchall(self):
        r = self._res
        return r if isinstance(r, list) else ([] if r is None else [r])


@contextmanager
def _sur(base):
    @contextmanager
    def gc(*a, **k):
        yield base
    with patch.object(F, "get_cursor", gc):
        yield


def test_synchroniser_sans_connexion_ni_reseau(monkeypatch):
    monkeypatch.delenv(F.ENV_REFRESH, raising=False)
    base = _Base()
    with _sur(base):
        r = F.synchroniser(transport=httpx.MockTransport(lambda req: pytest.fail("aucune requête attendue")))
    assert r["ok"] is False and r["code"] == "non_configure" and "non connecté" in r["erreur"]
    assert base.params[F.P_OK] == "0" and base.params[F.P_CONNEXION] == "" and base.params[F.P_DERNIERE]
    assert json.loads(base.params[F.P_RESUME])["code"] == "non_configure"


def test_synchroniser_jeton_refuse_passe_la_connexion_en_expiree():
    base = _Base({F.P_REFRESH: REFRESH}, [("Apple", "iPhone 13")])
    with _sur(base):
        r = F.synchroniser(transport=_transport({}, [], refresh_ok=False), dormir=lambda s: None)
    assert r["code"] == "jeton_expire" and base.params[F.P_CONNEXION] == "expiree" and base.params[F.P_OK] == "0"


def test_synchroniser_complet_avec_import_simule(monkeypatch):
    produits = _produits()
    journal = []
    base = _Base({F.P_REFRESH: REFRESH, F.P_ID_CLIENT: "4242"}, [("Honor", "200 5G"), ("Apple", "iPad Air 4")])
    transport = _transport({"Honor 200 5G": [produits], "iPad Air 4": [[
        {"id": 900, "name": "Ecran iPad Air 4 Original", "ean13": "3000000900000", "price": 79.0, "active": True},
        {"id": 37985, "name": "doublon du bloc écran", "ean13": "3000000321676", "price": 128.9},   # déjà vu : ignoré
    ]]}, journal, nouveau_refresh="rot-" + "e" * 30)
    imports = []

    def faux_import(cur, cible, contenu, nom, r, **kw):
        tableau = import_prix.lire_tableau(nom, contenu)
        imports.append((cible, nom, len(tableau) - 1))
        return {"cible": cible, "import_id": len(imports), "lot_id": f"lot-{cible}", "erreur": None,
                "lignes": len(tableau) - 1, "reconnues": 2, "non_reconnues": 1, "inconnues": 1, "verrouillees": 0,
                "obsoletes": 0, "variantes": 1, "a_valider": 1, "modifies": 1, "confirmes": 1, "propositions": 1}

    monkeypatch.setattr(F, "_importer", faux_import)
    monkeypatch.setattr(F.prix, "regles", lambda cur: {"tva": 1.2})
    with _sur(base):
        r = F.synchroniser(transport=transport, dormir=lambda s: None)
    assert r["ok"] is True and r["erreur"] is None, r
    assert r["modeles"] == 2 and r["recherches"] == 2 and r["produits"] == 8 and r["produits_prix"] == 5
    # tarifs : les 5 lignes avec prix ; iPad / MacBook : la seule ligne iPad
    assert imports == [("tarifs", f"mobilax-{date.today().isoformat()}.csv", 5),
                       ("tarifs_apple_devices", f"mobilax-{date.today().isoformat()}-apple.csv", 1)]
    assert r["modifies"] == 2 and r["propositions"] == 2 and r["lots"] == ["lot-tarifs", "lot-tarifs_apple_devices"]
    assert "price" in r["champs"] and "ean13" in r["champs"] and "_q" not in r["champs"]
    # Diagnostic du passage enregistré (pièces de la grille sans prix : aucune pièce dans la base simulée)
    diag = json.loads(base.params[F.P_DIAG])
    assert diag["n"] == 0 and diag["pieces"] == [] and r["sans_prix"] == 0
    # Jetons tournés et conservés ; état durable
    assert base.params[F.P_REFRESH] == "rot-" + "e" * 30 and base.params[F.P_TOKEN] == TOKEN
    assert base.params[F.P_OK] == "1" and base.params[F.P_CONNEXION] == "ok"
    assert json.loads(base.params[F.P_RESUME])["modifies"] == 2
    # Aucune requête vers un autre hôte que l'API Mobilax, id_customer du compte transmis
    assert {req.url.host for req in journal} == {"apiv2.mobilax.fr"}
    assert all(req.url.params.get("id_customer") == "4242" for req in journal if "web/products" in req.url.path)


def test_synchroniser_applique_le_palier_du_compte(monkeypatch):
    produits = _produits()
    base = _Base({F.P_REFRESH: REFRESH}, [("Honor", "200 5G")])
    details = {"id": 4242, "show_prices": True, "category": {"id": 3, "name": "Gold", "rate": 0.5}}
    transport = _transport({"Honor 200 5G": [produits]}, [], details=details)
    csv_recus = []

    def faux_import(cur, cible, contenu, nom, r, **kw):
        csv_recus.append(import_prix.lire_tableau(nom, contenu))
        return {"cible": cible, "import_id": 1, "lot_id": "lot", "erreur": None, "lignes": 4, "reconnues": 0,
                "non_reconnues": 0, "inconnues": 0, "verrouillees": 0, "obsoletes": 0, "variantes": 0,
                "a_valider": 0, "modifies": 0, "confirmes": 0, "propositions": 0}

    monkeypatch.setattr(F, "_importer", faux_import)
    monkeypatch.setattr(F.prix, "regles", lambda cur: {})
    with _sur(base):
        _params(monkeypatch, base.params)
        r = F.synchroniser(transport=transport, dormir=lambda s: None)
        assert r["ok"] is True and r["palier"] == "Gold", r
        # Le bloc écran (paliers) au prix Gold, les autres au seul prix affiché
        tableau = csv_recus[0]
        prix_par_ref = {ligne[0]: ligne[6] for ligne in tableau[1:]}
        assert import_prix.lire_prix(prix_par_ref["3000000321676"]) == Decimal("126.90")
        assert import_prix.lire_prix(prix_par_ref["3000000355123"]) == Decimal("54.90")
        assert json.loads(base.params[F.P_PALIER]) == {"id": 3, "nom": "Gold"} and base.params[F.P_ID_CLIENT] == "4242"
        assert F.etat()["mobilax"]["palier"] == "Gold"
        # Passage suivant : le palier mémorisé sert même si la fiche ne répond plus
        r2 = F.synchroniser(transport=_transport({"Honor 200 5G": [produits]}, [], details={}), dormir=lambda s: None)
        assert r2["ok"] and r2["palier"] == "Gold"
        assert import_prix.lire_prix({l[0]: l[6] for l in csv_recus[1][1:]}["3000000321676"]) == Decimal("126.90")


def test_synchroniser_prix_masques_et_budget_reseau(monkeypatch):
    base = _Base({F.P_REFRESH: REFRESH}, [("Honor", "200 5G")])
    with _sur(base):
        r = F.synchroniser(transport=_transport({"Honor 200 5G": [_produits()]}, [], prix_masques=True), dormir=lambda s: None)
    assert r["ok"] is False and r["code"] == "prix_masques" and r["prix_masques"] is True
    assert "affichage des prix" in r["erreur"]
    # Erreurs réseau répétées : le passage s'arrête sans planter
    appels = {"n": 0}

    def instable(request):
        if request.url.path.endswith("refresh-token"):
            return httpx.Response(200, json={"data": {"token": TOKEN}})
        if "web/products" in request.url.path:
            appels["n"] += 1
        return httpx.Response(503, text="maintenance")
    base = _Base({F.P_REFRESH: REFRESH}, [("Apple", f"iPhone {i}") for i in range(8, 18)])
    with _sur(base):
        r = F.synchroniser(transport=httpx.MockTransport(instable), dormir=lambda s: None)
    assert r["ok"] is False and r["code"] == "mobilax" and r["erreurs_reseau"] == F.ERREURS_MAX
    assert appels["n"] == F.ERREURS_MAX


# ─── Passage quotidien : réservation du jour, verrou, coupure ─────

def test_synchro_quotidienne_une_fois_par_jour(monkeypatch):
    passages = []
    monkeypatch.setattr(F, "synchroniser", lambda transport=None: passages.append(1) or {"ok": True})
    base = _Base({F.P_REFRESH: REFRESH})
    jour = date(2026, 11, 4)
    with _sur(base):
        assert F.synchro_quotidienne(jour)["ok"] is True
        assert F.synchro_quotidienne(jour) is None            # déjà fait
        assert F.synchro_quotidienne(date(2026, 11, 5))["ok"] is True
    assert passages == [1, 1] and base.params[F.P_JOUR] == "2026-11-05" and base.params[F.P_VERROU] == ""


def test_synchro_quotidienne_reessaie_trois_fois_puis_attend_demain(monkeypatch):
    monkeypatch.setattr(F, "synchroniser", lambda transport=None: {"ok": False, "code": "mobilax"})
    base = _Base({F.P_REFRESH: REFRESH})
    jour = date(2026, 11, 4)
    with _sur(base):
        for essai in range(1, F.ESSAIS_PAR_JOUR + 1):
            assert F.synchro_quotidienne(jour) is not None
            assert base.params[F.P_JOUR] == f"2026-11-04#{essai}"
        assert F.synchro_quotidienne(jour) is None
        assert F.synchro_quotidienne(date(2026, 11, 5)) is not None


def test_synchro_quotidienne_coupee_non_connectee_ou_verrouillee(monkeypatch):
    monkeypatch.delenv(F.ENV_REFRESH, raising=False)
    monkeypatch.setattr(F, "synchroniser", lambda transport=None: pytest.fail("ne doit pas tourner"))
    with _sur(_Base({F.P_REFRESH: REFRESH, F.P_ACTIVE: "0"})):
        assert F.synchro_quotidienne(date(2026, 11, 4)) is None
    with _sur(_Base({})):
        assert F.synchro_quotidienne(date(2026, 11, 4)) is None
    # Verrou tenu par un autre worker depuis 5 minutes
    recent = F._utc()
    base = _Base({F.P_REFRESH: REFRESH, F.P_VERROU: recent})
    with _sur(base):
        assert F.synchro_quotidienne(date(2026, 11, 4)) is None
    assert F.P_JOUR not in base.params


def test_amorcage_par_variable_d_environnement(monkeypatch):
    monkeypatch.setenv(F.ENV_REFRESH, REFRESH)
    monkeypatch.setenv(F.ENV_ID_CLIENT, "77")
    passages = []
    monkeypatch.setattr(F, "synchroniser", lambda transport=None: passages.append(1) or {"ok": True})
    base = _Base({})
    with _sur(base):
        assert F.synchro_quotidienne(date(2026, 11, 4))["ok"] is True
    assert base.params[F.P_REFRESH] == REFRESH and base.params[F.P_ID_CLIENT] == "77" and passages == [1]


def test_tache_de_fond_coupee_par_env(monkeypatch):
    monkeypatch.setenv("KP_SYNC_FOURNISSEURS", "0")
    monkeypatch.setattr(F, "_tache", {"thread": None})
    assert F.demarrer_synchro_quotidienne(0, 0) is False
    assert F._tache["thread"] is None


# ─── État, connexion, API ────────────────────────────────────────

def _params(monkeypatch, valeurs: dict):
    monkeypatch.setattr(params_cache, "get_params", lambda cles, defauts=None, cur=None: {c: valeurs.get(c, "") for c in cles})


def test_etat_et_sante_sans_jeton(monkeypatch):
    monkeypatch.delenv(F.ENV_REFRESH, raising=False)
    resume = {"ok": True, "modifies": 12, "propositions": 3, "produits": 400, "erreur": None}
    _params(monkeypatch, {F.P_REFRESH: REFRESH, F.P_DERNIERE: "2026-11-04T05:10:00", F.P_OK: "1",
                          F.P_RESUME: json.dumps(resume), F.P_CONNEXION: "ok", F.P_ID_CLIENT: "4242"})
    e = F.etat()
    assert e["mobilax"]["configure"] is True and e["mobilax"]["connexion"] == "ok" and e["mobilax"]["ok"] is True
    assert e["mobilax"]["derniere_synchro"] == "2026-11-04T05:10:00" and e["mobilax"]["resume"]["modifies"] == 12
    assert e["mobilax"]["active"] is True and e["mobilax"]["compte"] is True
    # Utopya : collecte depuis le navigateur (services/utopya), état sans clé
    assert e["utopya"]["disponible"] is True and e["utopya"]["configure"] is False and e["utopya"]["en_cours"] is False
    assert REFRESH not in json.dumps(e) and TOKEN not in json.dumps(e)
    s = F.sante()["mobilax"]
    assert s == {"derniere_synchro": "2026-11-04T05:10:00", "ok": True, "configure": True, "connexion": "ok",
                 "en_cours": False, "erreur": None, "modifies": 12, "propositions": 3}
    _params(monkeypatch, {})
    e = F.etat()["mobilax"]
    assert e["configure"] is False and e["connexion"] == "absente" and e["ok"] is None and e["resume"] is None
    _params(monkeypatch, {F.P_REFRESH: REFRESH, F.P_CONNEXION: "expiree", F.P_OK: "0", F.P_ACTIVE: "0"})
    e = F.etat()["mobilax"]
    assert e["connexion"] == "expiree" and e["ok"] is False and e["active"] is False


def test_enregistrer_connexion_verifie_puis_enregistre(monkeypatch):
    monkeypatch.delenv(F.ENV_REFRESH, raising=False)
    journal = []
    base = _Base({})
    texte = json.dumps({"web_mobi_refresh_token": REFRESH, "web_mobi_token": "vieux-" + "f" * 30})
    with _sur(base):
        _params(monkeypatch, base.params)
        e = F.enregistrer_connexion(texte, transport=_transport({}, journal))
    assert base.params[F.P_REFRESH] == REFRESH and base.params[F.P_TOKEN] == TOKEN
    assert base.params[F.P_ID_CLIENT] == "4242" and base.params[F.P_CONNEXION] == "ok" and base.params[F.P_ACTIVE] == "1"
    assert e["mobilax"]["configure"] is True and e["mobilax"]["palier"] is None
    # Fiche collée avec le palier : rien à demander à Mobilax, palier enregistré et affiché
    fiche = json.dumps({"state": {"user": {"id": 1099, "category": {"id": 4, "name": "Platinum"}}}})
    journal2, base2 = [], _Base({})
    with _sur(base2):
        _params(monkeypatch, base2.params)
        e2 = F.enregistrer_connexion(json.dumps({"web_mobi_refresh_token": REFRESH, "userId": fiche}),
                                     transport=_transport({}, journal2))
        assert [req.url.path.rsplit("/", 1)[-1] for req in journal2] == ["refresh-token"]
        assert base2.params[F.P_ID_CLIENT] == "1099" and json.loads(base2.params[F.P_PALIER])["nom"] == "Platinum"
        assert e2["mobilax"]["palier"] == "Platinum"
        F.oublier_connexion()
    assert F.P_PALIER not in base2.params and F.P_ID_CLIENT not in base2.params
    with _sur(_Base({})):
        with pytest.raises(F.ErreurJeton):
            F.enregistrer_connexion(texte, transport=_transport({}, journal, refresh_ok=False))
        with pytest.raises(ValueError):
            F.enregistrer_connexion("n'importe quoi", transport=_transport({}, journal))
    with _sur(base):
        F.oublier_connexion()
    assert F.P_REFRESH not in base.params and F.P_TOKEN not in base.params and base.params[F.P_CONNEXION] == ""


def test_routes_fournisseurs(client, monkeypatch):
    monkeypatch.delenv(F.ENV_REFRESH, raising=False)
    etat_vide = {"mobilax": {"configure": False, "connexion": "absente", "active": True, "en_cours": False, "debut": None,
                             "derniere_synchro": None, "ok": None, "resume": None, "erreur": None, "message": None,
                             "compte": False}, "utopya": {"disponible": True, "configure": False, "en_cours": False}}
    monkeypatch.setattr(F, "etat", lambda cur=None: etat_vide)
    assert client.get("/api/tarifs/fournisseurs/etat").status_code == 401
    r = client.get("/api/tarifs/fournisseurs/etat", headers=_headers())
    assert r.status_code == 200 and r.json()["mobilax"]["connexion"] == "absente" and r.json()["utopya"]["configure"] is False
    # Écritures : rôle admin et code prouvé
    _, gc_staff = fake_db(lambda sql, params: None)
    with patch("app.api.auth.get_cursor", gc_staff):
        assert client.post("/api/tarifs/fournisseurs/mobilax/sync", headers=_headers()).status_code == 403
        assert client.post("/api/tarifs/fournisseurs/mobilax/connexion", headers=_headers(), json={"texte": REFRESH}).status_code == 403
    _, gc_admin = fake_db(lambda sql, params: _ADMIN_PROUVE if "membres_equipe" in sql else None)
    lances = []
    monkeypatch.setattr(F, "lancer_en_arriere_plan", lambda transport=None: lances.append(1) or True)
    with patch("app.api.auth.get_cursor", gc_admin):
        # Pas connecté : rien n'est lancé
        assert client.post("/api/tarifs/fournisseurs/mobilax/sync", headers=_headers()).status_code == 409
        etat_vide["mobilax"]["configure"] = True
        r = client.post("/api/tarifs/fournisseurs/mobilax/sync", headers=_headers())
        assert r.status_code == 200 and r.json()["lance"] is True and lances == [1]
        connexions = []
        monkeypatch.setattr(F, "enregistrer_connexion", lambda texte, transport=None: connexions.append(texte) or etat_vide)
        r = client.post("/api/tarifs/fournisseurs/mobilax/connexion", headers=_headers(), json={"texte": REFRESH})
        assert r.status_code == 200 and connexions == [REFRESH]

        def refuse(texte, transport=None):
            raise F.ErreurJeton("Jeton Mobilax refusé ou expiré")
        monkeypatch.setattr(F, "enregistrer_connexion", refuse)
        assert client.post("/api/tarifs/fournisseurs/mobilax/connexion", headers=_headers(), json={"texte": REFRESH}).status_code == 422

        def illisible(texte, transport=None):
            raise ValueError("Texte illisible")
        monkeypatch.setattr(F, "enregistrer_connexion", illisible)
        assert client.post("/api/tarifs/fournisseurs/mobilax/connexion", headers=_headers(), json={"texte": "x"}).status_code == 400
        assert client.post("/api/tarifs/fournisseurs/mobilax/connexion", headers=_headers(), json={}).status_code == 422
        monkeypatch.setattr(F, "oublier_connexion", lambda: etat_vide)
        assert client.delete("/api/tarifs/fournisseurs/mobilax/connexion", headers=_headers()).status_code == 200
        regle = []
        monkeypatch.setattr(F, "regler_active", lambda a: regle.append(a) or etat_vide)
        assert client.post("/api/tarifs/fournisseurs/mobilax/active", headers=_headers(), json={"active": False}).status_code == 200
        assert regle == [False]


def test_cles_mobilax_hors_de_la_config_generique():
    from app.api import config
    assert config.est_cle_moteur_prix(F.P_REFRESH) and config.est_cle_moteur_prix(F.P_RESUME)
    # Les jetons sont des secrets pour la lecture de la configuration (masqués)
    assert config.est_secret(F.P_REFRESH) and config.est_secret(F.P_TOKEN)


# ─── Base réelle (KP_TEST_DATABASE_URL) : prix écrits, propositions, historique ───────────

DSN = os.environ.get("KP_TEST_DATABASE_URL")


@pytest.fixture
def db():
    if not DSN:
        pytest.skip("KP_TEST_DATABASE_URL absent : tests sur base réelle ignorés")
    psycopg2 = pytest.importorskip("psycopg2")
    import psycopg2.extras
    try:
        conn = psycopg2.connect(DSN, connect_timeout=3)
    except psycopg2.OperationalError as e:
        pytest.skip(f"base de test injoignable : {e}")
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT to_regclass('public.tarifs') IS NOT NULL AS t, to_regclass('public.tarifs_imports') IS NOT NULL AS i")
        r = cur.fetchone()
        if not (r["t"] and r["i"]):
            pytest.skip("base non migrée (démarrer l'API une fois sur cette base)")
        cur.execute("DELETE FROM params WHERE cle LIKE 'MOBILAX_%%'")
        yield cur
    finally:
        conn.rollback()
        conn.close()


def _piece(cur, marque, modele, type_piece, qualite, nom, ht, client, verrou=False):
    cur.execute("""INSERT INTO tarifs (marque, modele, type_piece, qualite, nom_fournisseur, prix_fournisseur_ht, prix_client,
                                       categorie, source, en_stock, prix_maj_le, prix_source, verrou_manuel, fournisseur)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, 'standard', 'mobilax', TRUE, NOW() - INTERVAL '200 days', 'manuel', %s, 'Mobilax')
                   RETURNING id""", (marque, modele, type_piece, qualite, nom, ht, client, verrou))
    return cur.fetchone()["id"]


def test_synchro_reelle_ecrit_les_prix_et_propose_les_grosses_variations(db, monkeypatch):
    cur = db
    from app.services import prix as prix_srv
    r = prix_srv.regles(cur)
    marque, modele = "Honor", "200 5G"
    # Aucune autre pièce de ce modèle dans la base de test (elle serait comptée dans les correspondances)
    cur.execute("DELETE FROM tarifs WHERE marque = %s AND modele = %s", (marque, modele))
    # Pièces de la grille : écran compatible (prix proche → écrit), batterie (×2 → proposition), connecteur verrouillé
    id_ecran = _piece(cur, marque, modele, "Ecran", "Compatible", "Ecran OEM Honor 200 5G", 50, 129)
    id_batt = _piece(cur, marque, modele, "Batterie", None, "Batterie Honor 200 5G", 10, 39)
    id_conn = _piece(cur, marque, modele, "Connecteur de charge", None, "Connecteur de charge Honor 200 5G", 8, 35, verrou=True)
    cur.execute("INSERT INTO params (cle, valeur) VALUES (%s, %s)", (F.P_REFRESH, REFRESH))
    # Noms tels que Mobilax les écrit (coloris, codes constructeur, « Premium »)
    produits = [
        {"id": 1, "name": "Ecran Tactile OEM Honor 200 5G Noir", "ean13": "3000000000001", "price": 55.0, "active": True},
        {"id": 2, "name": "Ecran Tactile OEM Honor 200 5G Moonlight White", "ean13": "3000000000002", "price": 57.0, "active": True},
        {"id": 3, "name": "Batterie Originale Honor 200 5G 0235AKJJ HB496590EIW", "ean13": "3000000000003", "price": 20.0, "active": True},
        {"id": 4, "name": "Connecteur de Charge Premium Honor 200 5G", "ean13": "3000000000004", "price": 9.0, "active": True},
        {"id": 5, "name": "Coque Silicone Honor 200 5G", "ean13": "3000000000005", "price": 2.0, "active": True},
    ]
    journal = []
    transport = _transport({f"{marque} {modele}": [produits]}, journal)
    # Seul ce modèle : les autres pièces de la base n'engendrent aucune requête
    monkeypatch.setattr(F, "modeles_grille", lambda c: [(marque, modele)])

    @contextmanager
    def gc(*a, **k):
        yield cur
    monkeypatch.setattr(F, "get_cursor", gc)
    params_cache.invalidate()
    res = F.synchroniser(transport=transport, dormir=lambda s: None)
    assert res["ok"] is True, res
    assert res["recherches"] == 1 and res["produits"] == 5 and res["produits_prix"] == 4
    assert res["reconnues"] == 3 and res["modifies"] == 1 and res["propositions"] == 1 and res["verrouillees"] == 1
    assert res["variantes"] == 1 and len(res["lots"]) == 1
    cur.execute("SELECT id, prix_fournisseur_ht, prix_client, prix_source, ref_fournisseur, fournisseur, verrou_manuel "
                "FROM tarifs WHERE id = ANY(%s) ORDER BY id", ([id_ecran, id_batt, id_conn],))
    ecran, batt, conn = cur.fetchall()
    # Écran : la variante la moins chère, prix client recalculé par les règles, référence EAN notée
    assert ecran["prix_fournisseur_ht"] == Decimal("55.00") and ecran["prix_source"] == "import"
    assert ecran["prix_client"] == prix_srv.prix_client(Decimal("55"), "Ecran", "standard", r)
    assert ecran["ref_fournisseur"] == "3000000000001" and ecran["fournisseur"] == "Mobilax"
    # Batterie : prix inchangé (variation > seuil), proposition en attente
    assert batt["prix_fournisseur_ht"] == Decimal("10.00") and batt["prix_client"] == 39
    cur.execute("SELECT nouveau_ht, source, par, statut FROM tarifs_propositions WHERE tarif_cle = %s", (f"tarifs:{id_batt}",))
    prop = cur.fetchone()
    assert prop and prop["nouveau_ht"] == Decimal("20") and prop["source"] == "mobilax" and prop["par"] == F.AUTEUR
    assert prop["statut"] == "en_attente"
    # Verrou respecté
    assert conn["prix_fournisseur_ht"] == Decimal("8.00") and conn["verrou_manuel"] is True
    # Historique du lot, signé « Synchro Mobilax » ; import résumé sans le détail des lignes
    cur.execute("SELECT source, par, ancien, nouveau FROM tarifs_historique WHERE lot_id = %s AND colonne = 'prix_fournisseur_ht'",
                (res["lots"][0],))
    h = cur.fetchall()
    assert len(h) == 1 and h[0]["par"] == F.AUTEUR and h[0]["source"] == "import" and h[0]["nouveau"] == Decimal("55")
    cur.execute("SELECT statut, fournisseur, resume FROM tarifs_imports WHERE lot_id = %s", (res["lots"][0],))
    imp = cur.fetchone()
    assert imp["statut"] == "applique" and imp["fournisseur"] == "Mobilax"
    assert "donnees" not in imp["resume"] and imp["resume"]["resultat"]["modifies"] == 1 and "annulation" in imp["resume"]
    # État durable
    cur.execute("SELECT cle, valeur FROM params WHERE cle = ANY(%s)", ([F.P_OK, F.P_CONNEXION, F.P_TOKEN, F.P_ID_CLIENT],))
    p = {x["cle"]: x["valeur"] for x in cur.fetchall()}
    assert p[F.P_OK] == "1" and p[F.P_CONNEXION] == "ok" and p[F.P_TOKEN] == TOKEN and p[F.P_ID_CLIENT] == "4242"
    # Second passage le même jour : rien ne change (prix confirmés), aucun doublon de proposition
    res2 = F.synchroniser(transport=transport, dormir=lambda s: None)
    assert res2["ok"] and res2["modifies"] == 0 and res2["confirmes"] == 1
    cur.execute("SELECT count(*) AS n FROM tarifs_propositions WHERE tarif_cle = %s AND statut = 'en_attente'", (f"tarifs:{id_batt}",))
    assert cur.fetchone()["n"] == 1
    params_cache.invalidate()


# ─── Catégorie Mobilax → pièce, qualité, modèle ─────────────────

@pytest.mark.parametrize("categorie, attendu", [
    ("Ecran Tactile Soft Oled", ("Ecran", "Soft OLED")),
    ("Ecran Tactile Hard Oled", ("Ecran", "OLED")),
    ("Ecran Tactile Incell FHD LTPS", ("Ecran", "Incell")),
    ("Ecran Tactile Premium Plus Incell FHD LTPS", ("Ecran", "Incell")),
    ("Ecran Tactile Original Refurb (PIEC)", ("Ecran", "Reconditionnee")),
    ("Ecran Tactile Original Pulled avec Châssis (PIEC)", ("Ecran", "Reconditionnee")),
    ("Ecran Tactile Original", ("Ecran", "Original")),
    ("Ecran Tactile OEM avec Châssis", ("Ecran", "Compatible")),
    ("Ecran LCD Complet OEM", ("Ecran", "LCD")),          # ligne LCD du modèle, sinon Compatible (import_prix.REPLI_ECRAN)
    ("Ecran LCD Complet Original Pulled (PIEC)", ("Ecran", "Reconditionnee")),
    ("Ecran Tactile", ("Ecran", "Compatible")),
    ("Bloc Écran Complet avec Châssis et Batterie Original", ("Ecran", "Original")),
    ("Ecran Tactile Externe Original", None),
    ("Batterie", ("Batterie", None)),
    ("Batterie Originale", ("Batterie", "Original")),
    ("Batterie Premium", ("Batterie", "Compatible")),
    ("Batterie Diagnostic High Capacity", ("Batterie", None)),
    ("Batterie Secondaire Originale", None),
    ("Batterie sans BMS", None),
    ("Connecteur de Charge Original Pulled (PIEC)", ("Connecteur de charge", "Reconditionnee")),
    ("Connecteur de Charge à Souder Original", None),
    ("Connecteur FPC", None),
    ("Cache Arrière Premium", ("Vitre arriere", "Compatible")),
    ("Vitre Arrière", ("Vitre arriere", None)),
    ("Appareil Photo Original Pulled (PIEC)", ("Camera arriere", "Reconditionnee")),
    ("Caméra Visio Originale Pulled", ("Camera avant", "Reconditionnee")),
    ("Haut-Parleur Premium", ("Haut-parleur", "Compatible")),
    ("Écouteur Interne", ("Ecouteur interne", None)),
    ("Lentille Premium", ("Vitre camera arriere", "Compatible")),
    ("Protection Lentille", None),
    ("Vitre avec Film OCA", None),
    ("Nappe Écran", None),
    ("Coque de Réparation", None),
    ("", None), (None, None),
])
def test_piece_categorie(categorie, attendu):
    assert F.piece_categorie(categorie) == attendu


@pytest.mark.parametrize("produit, attendu", [
    ({"name": "Ecran Tactile Soft Oled Apple iPhone 13 (IC Removable) Noir", "category_name": "Ecran Tactile Soft Oled",
      "suffix": "(IC Removable)"}, "Apple iPhone 13"),
    ({"name": "Ecran Tactile Incell FHD LTPS Diagnostic Apple iPhone 12 Mini Noir", "category_name": "Ecran Tactile Incell FHD LTPS"},
     "Apple iPhone 12 Mini"),
    ({"name": "Batterie Apple iPhone 14 Plus Ti", "category_name": "Batterie"}, "Apple iPhone 14 Plus"),
    ({"name": "Batterie High Capacity Apple iPhone 13 (TI 3630mAh)", "category_name": "Batterie High Capacity",
      "suffix": "(TI 3630mAh)"}, "Apple iPhone 13"),
    ({"name": "Batterie Originale Google Pixel 7a G949-00398-00  GP5JE", "category_name": "Batterie Originale", "suffix": " GP5JE"},
     "Google Pixel 7a"),
    ({"name": "Ecran Tactile Original Google Pixel 7 Pro G949-00290-01 G949-00291-01 Noir", "category_name": "Ecran Tactile Original"},
     "Google Pixel 7 Pro"),
    ({"name": "Appareil Photo Original Apple iPhone XR 661-10851 (Service Pack) 12MP", "category_name": "Appareil Photo Original",
      "suffix": "(Service Pack) 12MP"}, "Apple iPhone XR"),
    ({"name": "Ecran Tactile Hard Oled Apple iPhone 12/iPhone 12 Pro (IC Removable) Noir", "category_name": "Ecran Tactile Hard Oled",
      "suffix": "(IC Removable)"}, "Apple iPhone 12/iPhone 12 Pro"),
    ({"name": "Ecran LCD Complet OEM Apple MacBook Air M1 13\" (2020) A2337 Gris Sidéral", "category_name": "Ecran LCD Complet OEM"},
     'Apple MacBook Air M1 13" (2020) A2337'),
    ({"name": "Cache Arrière Original Pulled (PIEC) Apple iPhone 15 Pro Max Grade A++ Titane Naturel",
      "category_name": "Cache Arrière Original Pulled (PIEC)", "suffix": "Grade A++"}, "Apple iPhone 15 Pro Max"),
    ({"name": "Ecran Tactile Premium Plus Incell FHD LTPS Apple iPhone 15 Pro Max (COF IC Removable) *1 An de Garantie Toute Casse* Noir",
      "category_name": "Ecran Tactile Premium Plus Incell FHD LTPS", "suffix": ""}, "Apple iPhone 15 Pro Max"),
    ({"name": "Batterie Originale Samsung Galaxy A15 5G A156B/Galaxy A15 4G A155 GH82-33000A", "category_name": "Batterie Originale"},
     "Samsung Galaxy A15 5G /Galaxy A15 4G"),
    ({"name": "Ecran Tactile Original OnePlus 10 Pro 5G 2011100371 Foret Emeraude", "category_name": "Ecran Tactile Original"},
     "OnePlus 10 Pro 5G Foret"),
    ({"name": "Connecteur de Charge Premium Huawei P20 Lite Avec Jack et Micro", "category_name": "Connecteur de Charge Premium"},
     "Huawei P20 Lite"),
    ({"name": "Haut-Parleur Apple MacBook Air M1 13\" (2020) A2337 Gauche", "category_name": "Haut-Parleur"},
     'Apple MacBook Air M1 13" (2020) A2337'),
    ({"name": "Appareil Photo Original Pulled (PIEC) Apple iPhone 15 Plus 48MP+12MP", "category_name": "Appareil Photo Original Pulled (PIEC)",
      "suffix": "48MP+12MP"}, "Apple iPhone 15 Plus"),
    ({"name": "Batterie Apple iPhone 13", "category_name": ""}, "Apple iPhone 13"),
])
def test_modele_produit(produit, attendu):
    assert F.modele_produit(produit) == attendu


def test_segments_marques_et_lignes_produit_multi_marques():
    assert F.segments_marques("Honor 20/8X/Play/View 10 Huawei Mate 20 Lite/Nova 5T/P10 Plus") == \
        ["Honor 20/8X/Play/View 10", "Huawei Mate 20 Lite/Nova 5T/P10 Plus"]
    assert F.segments_marques("Huawei P Smart 2021 Honor 10X Lite") == ["Huawei P Smart 2021", "Honor 10X Lite"]
    assert F.segments_marques("Samsung Galaxy A54 5G") == ["Samsung Galaxy A54 5G"]
    assert F.segments_marques("Apple iPhone 12/iPhone 12 Pro") == ["Apple iPhone 12/iPhone 12 Pro"]   # gamme ≠ marque
    assert F.segments_marques("") == [""]
    p = {"id": 5, "name": "Batterie Premium Huawei Y6p Honor 9A HB526489EEW", "category_name": "Batterie Premium",
         "price": 7.5, "ean13": "3000000000055"}
    lignes = F.lignes_produit(p)
    assert [(l["modele"], l["type_piece"], l["qualite"], l["reference"], l["prix_ht"]) for l in lignes] == [
        ("Huawei Y6p", "Batterie", "Compatible", "3000000000055", Decimal("7.50")),
        ("Honor 9A", "Batterie", "Compatible", "3000000000055", Decimal("7.50"))]
    assert F.ligne_produit(p)["modele"] == "Huawei Y6p"
    # Famille suivie mais variante écartée : aucune ligne ; sans prix : aucune
    assert F.lignes_produit({"id": 6, "name": "Ecran Tactile Externe Original Google Pixel 9 Pro Fold", "price": 90,
                             "category_name": "Ecran Tactile Externe Original"}) == []
    assert F.lignes_produit({"id": 7, "name": "Batterie Apple iPhone 13", "category_name": "Batterie"}) == []


def test_lignes_structurees_reconnues_par_le_moteur_d_import():
    """Le vrai moteur (Index.associer) sur des noms Mobilax réels : pièce et qualité de la catégorie, modèle du nom."""
    from tests.test_prix_moteur import _CurIndex

    def _tarif(i, marque, modele, type_piece, qualite):
        return {"id": i, "marque": marque, "modele": modele, "type_piece": type_piece, "qualite": qualite,
                "nom_fournisseur": None, "ref_fournisseur": None, "fournisseur": "Mobilax", "prix_fournisseur_ht": None,
                "prix_client": None, "categorie": "standard", "verrou_manuel": False, "obsolete": False}
    index = import_prix.Index(_CurIndex([
        _tarif(1, "Apple", "iPhone 13", "Ecran", "Incell"), _tarif(2, "Apple", "iPhone 13", "Ecran", "OLED"),
        _tarif(3, "Apple", "iPhone 14 Plus", "Batterie", None), _tarif(4, "Samsung", "Galaxy A54", "Ecran", "Original"),
        _tarif(5, "Samsung", "Galaxy A15", "Batterie", None), _tarif(6, "Huawei", "P Smart 2019", "Connecteur de charge", None),
        _tarif(7, "Huawei", "P Smart 2020", "Connecteur de charge", None), _tarif(8, "Google", "Pixel 9a", "Batterie", None),
    ]), "tarifs")
    produits = [
        ({"name": "Ecran Tactile Incell FHD LTPS Apple iPhone 13 (COF IC Removable) Noir", "category_name": "Ecran Tactile Incell FHD LTPS",
          "suffix": "(COF IC Removable)"}, ["tarifs:1"]),
        ({"name": "Ecran Tactile Hard Oled Apple iPhone 13 (IC Removable) Noir", "category_name": "Ecran Tactile Hard Oled",
          "suffix": "(IC Removable)"}, ["tarifs:2"]),
        ({"name": "Batterie Apple iPhone 14 Plus Ti", "category_name": "Batterie"}, ["tarifs:3"]),
        ({"name": "Ecran Tactile Original Samsung Galaxy A54 5G A546 GH82-31231A Noir", "category_name": "Ecran Tactile Original"}, ["tarifs:4"]),
        ({"name": "Batterie Originale Samsung Galaxy A15 5G A156B/Galaxy A15 4G A155 GH82-33000A", "category_name": "Batterie Originale"}, ["tarifs:5"]),
        ({"name": "Connecteur de Charge Premium Huawei P Smart 2019/P Smart Plus 2019", "category_name": "Connecteur de Charge Premium"}, ["tarifs:6"]),
        ({"name": "Batterie Premium Google Pixel 9a G526Q", "category_name": "Batterie Premium", "suffix": "G526Q"}, ["tarifs:8"]),
    ]
    for p, attendu in produits:
        l = F.ligne_produit({**p, "id": 1, "price": 10})
        trouves, niveau, raison = index.associer(l, import_prix.interpreter(l))
        assert [e["cle"] for e in trouves] == attendu, (p["name"], raison)


def test_planifier_moins_disant_entre_fournisseurs():
    desc = lambda f, ht, source="import": {"fournisseur": f, "ht": ht, "prix_source": source, "prix_maj_le": datetime.now()}
    assert F.moins_cher_ailleurs(desc("Mobilax", 10), 12, "Utopya") is True          # Mobilax moins cher : laissé
    assert F.moins_cher_ailleurs(desc("Mobilax", 10), 10, "Utopya") is True          # égal : laissé
    assert F.moins_cher_ailleurs(desc("Mobilax", 10), 9, "Utopya") is False          # Utopya moins cher : appliqué
    assert F.moins_cher_ailleurs(desc("Utopya", 10), 12, "Utopya") is False          # même fournisseur
    assert F.moins_cher_ailleurs(desc("Mobilax", 10, "estimation_2026_02"), 12, "Utopya") is False   # estimé : remplacé
    assert F.moins_cher_ailleurs(desc(None, 10), 12, "Utopya") is False and F.moins_cher_ailleurs(None, 12, "Utopya") is False
    assert F.moins_cher_ailleurs(desc("Mobilax", 10), 12, None) is False
    ap = {"reconnues": [_rec(1, "tarifs:1", 12.0), _rec(2, "tarifs:2", 9.0), _rec(3, "tarifs:3", 30.0, ["variation"])]}
    descs = {"tarifs:1": desc("Mobilax", 10), "tarifs:2": desc("Mobilax", 10), "tarifs:3": desc("Mobilax", 10)}
    plan = F.planifier(ap, descs, {"jours_perime": 180}, fournisseur="Utopya")
    assert plan["lignes"] == [2] and plan["plus_cher_ailleurs"] == 2 and plan["propositions"] == []
    # Même fournisseur : logique habituelle (variation → proposition)
    plan = F.planifier(ap, descs, {"jours_perime": 180}, fournisseur="Mobilax")
    assert plan["lignes"] == [1, 2] and plan["plus_cher_ailleurs"] == 0 and [p["cle"] for p in plan["propositions"]] == ["tarifs:3"]


# ─── Nappe power, produits sans prix, requêtes iPad et par famille, fournisseur choisi ──

def test_categorie_nappe_power_et_lignes_sans_prix():
    assert F.piece_categorie("Nappe Power On/Off et Volume Premium") == ("Bouton power", "Compatible")
    assert F.piece_categorie("Nappe Power On/Off Originale") == ("Bouton power", "Original")
    assert F.piece_categorie("Nappe de Connexion Premium") is None and F.piece_categorie("Nappe LCD Premium") is None
    assert F.piece_categorie("Bouton On/Off et Volume Premium") is None
    p = {"id": 7, "name": "Nappe Power On/Off Apple iPhone 11 (Flash)", "category_name": "Nappe Power On/Off",
         "active": True, "quantity": 0, "url": "https://www.mobilax.fr/nappe-power-iphone-11"}
    assert F.lignes_produit(p) == []
    l = F.lignes_produit(p, sans_prix=True)
    assert len(l) == 1 and l[0]["prix_ht"] is None and l[0]["type_piece"] == "Bouton power"
    assert l[0]["modele"] == "Apple iPhone 11" and l[0]["en_stock"] is False and l[0]["url"] == p["url"]
    l = F.lignes_produit({**p, "price": 9.5, "quantity": 3, "url": "nappe-power-iphone-11"})
    assert l[0]["prix_ht"] == Decimal("9.50") and l[0]["en_stock"] is True and l[0]["url"] is None
    assert F.en_stock_produit({"is_availibility_alert": True}) is False and F.en_stock_produit({}) is None
    assert F.infos_lignes(l) == {l[0]["reference"]: {"url": None, "en_stock": True}}


def test_requetes_ipad_canoniques():
    assert F.requetes_pour("Apple", 'iPad 7 (2019) 10.2"') == ["iPad 7"]
    assert F.requete_modele("Apple", 'iPad 9 (2021) 10.2"') == "iPad 9"
    assert F.requetes_pour("Apple", 'iPad Pro 11" 3e gen M1 (2021)') == ["iPad Pro 11", "A2377"]
    assert F.requetes_pour("Apple", 'iPad Air 6 M2 11" (2024)') == ["iPad Air 6", "A2902"]
    assert F.requetes_pour("Apple", "iPad Mini 6 (2021)") == ["iPad Mini 6"]
    assert F.requetes_pour("Apple", "iPhone 12/12 Pro") == ["iPhone 12", "iPhone 12 Pro"]
    assert F.requetes_pour("Samsung", "Galaxy A54 5G") == ["Galaxy A54 5G"]
    assert F.requetes_modeles([("Apple", 'iPad 7 (2019) 10.2"'), ("Apple", "iPad 7 (2019)")]) == ["iPad 7"]
    assert F.requetes_par_modele([("Apple", "iPad Mini 6 (2021)")]) == {("Apple", "iPad Mini 6 (2021)"): ["iPad Mini 6"]}


def test_synchroniser_cherche_par_famille_quand_la_recherche_deborde(monkeypatch):
    produits = _produits()
    journal = []
    base = _Base({F.P_REFRESH: REFRESH}, [("Honor", "200 5G")])
    pages = [produits[:2], produits[2:4], produits[4:6], produits[6:8], [produits[0]]]     # 5 pages > PAGES_MAX
    nappe = {"id": 777, "name": "Nappe Power On/Off et Volume Premium Honor 200 5G", "ean13": "3000000777777",
             "price": 7.9, "active": True, "category_name": "Nappe Power On/Off et Volume Premium", "quantity": 4}
    transport = _transport({"Honor 200 5G": pages, "Nappe Power Honor 200 5G": [[nappe]]}, journal)
    csv_recus = []

    def faux_import(cur, cible, contenu, nom, r, **kw):
        csv_recus.append((import_prix.lire_tableau(nom, contenu), kw.get("infos")))
        return {"cible": cible, "import_id": 1, "lot_id": "lot", "erreur": None, **{k: 0 for k in F._COMPTES}}

    monkeypatch.setattr(F, "_importer", faux_import)
    monkeypatch.setattr(F.prix, "regles", lambda cur: {"tva": 1.2})
    with _sur(base):
        r = F.synchroniser(transport=transport, dormir=lambda s: None)
    assert r["ok"] is True, r
    recherches = [req.url.params.get("search") for req in journal if "web/products" in req.url.path]
    assert recherches[:4] == ["Honor 200 5G"] * 4
    assert set(recherches[4:]) == {f"{fam} Honor 200 5G" for fam in F.FAMILLES_REQUETES}
    assert r["debordements"] == 1 and r["recherches"] == 1
    # La nappe power trouvée par la recherche de famille est importée, avec son stock
    tableau, infos = csv_recus[0]
    assert any("Nappe Power" in " ".join(str(c) for c in ligne) for ligne in tableau)
    assert infos["3000000777777"] == {"url": None, "en_stock": True}


def test_planifier_respecte_le_fournisseur_choisi():
    maintenant = datetime(2026, 11, 5, 12, 0)
    recent = maintenant - timedelta(days=3)
    ap = {"reconnues": [
        {"n": 1, "cle": "tarifs:1", "nouveau_ht": 30.0, "verrou": False, "obsolete": False, "alertes": [], "label": "a"},
        {"n": 2, "cle": "tarifs:2", "nouveau_ht": 30.0, "verrou": False, "obsolete": False, "alertes": [], "label": "b"},
        {"n": 3, "cle": "tarifs:3", "nouveau_ht": 30.0, "verrou": False, "obsolete": False, "alertes": [], "label": "c"},
    ]}
    descs = {
        # Utopya moins cher, mais le gérant a choisi Mobilax : appliqué quand même
        "tarifs:1": {"ht": 20, "fournisseur": "Utopya", "prix_source": "import", "prix_maj_le": recent, "fournisseur_choisi": "Mobilax"},
        # Le gérant a choisi Utopya : jamais touché par Mobilax
        "tarifs:2": {"ht": 50, "fournisseur": "Utopya", "prix_source": "import", "prix_maj_le": recent, "fournisseur_choisi": "Utopya"},
        # Sans choix : moins-disant (Utopya à 20 < 30 → laissé)
        "tarifs:3": {"ht": 20, "fournisseur": "Utopya", "prix_source": "import", "prix_maj_le": recent, "fournisseur_choisi": None},
    }
    plan = F.planifier(ap, descs, {"jours_perime": 180}, maintenant=maintenant, fournisseur="Mobilax")
    assert plan["lignes"] == [1] and plan["autre_fournisseur_choisi"] == 1 and plan["plus_cher_ailleurs"] == 1
    assert F.fournisseur_choisi(descs["tarifs:1"]) == "Mobilax" and F.fournisseur_choisi({}) is None


def test_diagnostic_sans_prix_fournisseur_et_familles():
    assert F.famille_piece("Vitre arriere") == "vitre arriere" and F.famille_piece("Vitre camera arriere") == "vitre camera"
    assert F.famille_piece("Bouton power") == "bouton power" and F.famille_piece("Ecran") == "ecran"
    pieces = [{"cle": "tarifs:1", "marque": "Apple", "modele": "iPhone 11", "type_piece": "Bouton power", "qualite": None},
              {"cle": "tarifs:2", "marque": "Apple", "modele": "iPhone 11", "type_piece": "Vitre arriere", "qualite": None}]
    cache = {"id": 1, "name": "Vitre avec Film OCA Apple iPhone 11", "category_name": "Vitre avec Film OCA", "active": True, "_q": "iPhone 11"}
    d = F.diagnostic_pieces(pieces, [cache], set(), modeles=[("Apple", "iPhone 11")], cherchees=["iPhone 11"],
                            sans_prix={"tarifs:1": [{"designation": "Nappe Power On/Off Apple iPhone 11 (Flash)", "en_stock": False}]})
    assert d["par_raison"]["sans_prix_fournisseur"] == 1 and d["par_raison"]["piece_absente"] == 1
    assert d["pieces"][0]["candidats"] == [{"nom": "Nappe Power On/Off Apple iPhone 11 (Flash)", "prix_ht": None,
                                            "sans_prix": True, "en_stock": False}]
    # « Vitre avec Film OCA » n'est pas une vitre arrière : aucun candidat trompeur
    assert d["pieces"][1]["raison"] == "piece_absente" and d["pieces"][1]["candidats"] == []
    assert "sans_prix_fournisseur" in F.RAISONS


def test_importer_memorise_le_prix_du_fournisseur(monkeypatch):
    ap = {"import_id": 5, "reconnues": [{"n": 1, "cle": "tarifs:1", "nouveau_ht": 12.0, "ref": "R1", "designation": "x",
                                          "verrou": False, "obsolete": False, "alertes": [], "label": "l"}],
          "resume": {"lignes": 1, "pieces_reconnues": 1, "non_reconnues": 0, "nouvelles": 0}}
    monkeypatch.setattr(F.import_prix, "apercu", lambda *a, **k: ap)
    monkeypatch.setattr(F.prix, "decrire_tarifs", lambda cur, cles, r: {"tarifs:1": {"ht": None, "fournisseur": None}})
    monkeypatch.setattr(F.import_prix, "appliquer", lambda *a, **k: {"modifies": 1, "confirmes": 0, "lot_id": "lot"})
    monkeypatch.setattr(F, "_fermer_propositions", lambda cur, lot, auteur: 0)
    notes = []
    monkeypatch.setattr(F.prix, "enregistrer_prix_fournisseur", lambda cur, f, s, recs, infos: notes.append((f, s, recs, infos)) or 1)
    base = _Base()
    res = F._importer(base, "tarifs", b"", "x.csv", {}, fournisseur="Utopya", source="utopya",
                      infos={"R1": {"url": "https://www.utopya.fr/x", "en_stock": None}})
    assert res["modifies"] == 1 and notes == [("Utopya", "utopya", ap["reconnues"], {"R1": {"url": "https://www.utopya.fr/x", "en_stock": None}})]
