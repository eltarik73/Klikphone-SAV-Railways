"""Moteur de prix (lots 0 à 3) : règles de marge, recalcul, simulation et application, verrou,
historique et annulation d'un lot, import de fichier fournisseur, élévation admin sur chaque
écriture de prix.

Les tests purs tournent toujours. Ceux sur base réelle exigent une base PostgreSQL JETABLE
(schéma rejoué par le lifespan, tables de prix rechargées puis remises en l'état à la fin) :
    KP_PRIX_DATABASE_URL="postgresql://postgres:<mot_de_passe>@127.0.0.1:5432/kp_prix?sslmode=disable" pytest tests/test_prix_moteur.py
Données : la copie des grilles de la prod si KP_PRIX_CSV_DIR désigne le dossier de ses CSV
(tarifs.csv, tarifs_apple_devices.csv, tarifs_reparation.csv, iphone_tarifs.csv,
smartphones_tarifs.csv, avec en-tête) ; sinon les grilles déjà présentes dans la base si elle en
contient (1 000 prix estimés au moins) ; sinon les 1 202 + 49 estimations du dépôt
(import_tarifs.TARIFS, import_apple_devices.APPLE_DEVICES : mêmes lignes, mêmes ids que la prod).
"""

import csv
import io
import json
import os
import sys
import time
from contextlib import contextmanager
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import import_apple_devices
import import_tarifs
from app import main
from app.api import auth, config, iphone_tarifs, smartphones_tarifs, tarifs
from app.api.auth import create_admin_token, create_token, decode_token
from app.services import import_prix
from app.services import params as params_cache
from app.services import prix

FIXTURES = Path(__file__).parent / "fixtures"


def _texte(nom: str) -> bytes:
    return (FIXTURES / nom).read_bytes()


# ═══ Règles de marge et calcul (purs) ══════════════════════════

def test_regles_par_defaut_du_contrat():
    assert prix.REGLES_DEFAUT == {
        "tva": 1.2, "ecran": {"standard": 60, "haut_de_gamme": 70, "pliant": 100}, "autre": 60, "ipad": 110,
        "macbook": 120, "arrondi": "9_sup", "seuil_marge_alerte": 40, "variation_alerte_pct": 25,
        "variation_alerte_eur": 30, "jours_a_revoir": 90, "jours_perime": 180,
    }


def test_regles_par_defaut_zero_ecart_sur_les_1202_et_49_estimations():
    assert len(import_tarifs.TARIFS) == 1202 and len(import_apple_devices.APPLE_DEVICES) == 49
    ecarts = [row for row in import_tarifs.TARIFS
              if prix.prix_client(row[5], row[2], row[6], prix.REGLES_DEFAUT)
              != tarifs.calcul_prix_client(row[5], row[2], row[6])]
    assert ecarts == []
    for categorie, _, ecran, batterie in import_apple_devices.APPLE_DEVICES:
        ancien = tarifs.calc_prix_ipad if categorie == "ipad" else tarifs.calc_prix_macbook
        for ht in (ecran, batterie):
            assert prix.prix_apple(ht, categorie, prix.REGLES_DEFAUT) == ancien(ht)


def test_marge_ecran_standard_60_a_70_ne_touche_que_les_ecrans_standard():
    r = prix.valider_regles({"ecran": {"standard": 70}})
    assert r["ecran"] == {"standard": 70, "haut_de_gamme": 70, "pliant": 100} and r["autre"] == 60
    vus = set()
    for marque, modele, tp, q, nom, ht, cat, *_ in import_tarifs.TARIFS:
        avant, apres = prix.prix_client(ht, tp, cat, prix.REGLES_DEFAUT), prix.prix_client(ht, tp, cat, r)
        if prix.est_ecran(tp) and cat == "standard":
            assert apres == prix.arrondi_9_superieur(ht * 1.2 + 70)
            vus.add("ecran")
        else:
            assert apres == avant
            vus.add(tp)
    assert {"ecran", "Batterie", "Connecteur de charge"} <= vus


def test_ajustements_arrondis_au_9():
    plus_10 = {"type": "pct", "valeur": 10}
    assert prix.ajuster(99, plus_10, True) == 109              # iPhone 13 à 99 € : +10 % → 109
    assert prix.ajuster(109, {"type": "pct", "valeur": -10}, True) == 89   # baisse : 9 inférieur
    assert prix.ajuster(99, {"type": "eur", "valeur": 5}, True) == 109
    assert prix.ajuster(12.34, plus_10, False) == 13.57           # HT : 2 décimales
    assert prix.arrondi_9_inferieur(9.5) == 9 and prix.arrondi_9_inferieur(100) == 99
    with pytest.raises(ValueError):
        prix.valider_ajustement({"type": "pct", "valeur": 0})
    with pytest.raises(ValueError):
        prix.valider_ajustement({"type": "x", "valeur": 5})


@pytest.mark.parametrize("entree", [
    {"tva": 2}, {"tva": "abc"}, {"arrondi": "au_hasard"}, {"ecran": {"standard": -1}},
    {"jours_a_revoir": 200, "jours_perime": 180}, {"autre": True},
])
def test_regles_invalides_refusees(entree):
    with pytest.raises(ValueError):
        prix.valider_regles(entree)


def test_regles_lues_dans_params_completees_et_tolerantes():
    with patch.object(params_cache, "get_param", return_value=json.dumps({"ecran": {"standard": 65}, "inconnue": 1})):
        r = prix.regles()
    assert r["ecran"]["standard"] == 65 and r["ecran"]["pliant"] == 100 and "inconnue" not in r
    for brut in ("{pas du json", "[1, 2]", json.dumps({"tva": 9})):
        with patch.object(params_cache, "get_param", return_value=brut):
            assert prix.regles() == prix.REGLES_DEFAUT


def test_cles_de_tarif():
    assert prix.parse_tarif_cle("tarifs:123") == ("tarifs", 123, None)
    assert prix.parse_tarif_cle("tarifs_apple_devices:5:ecran") == ("tarifs_apple_devices", 5, "ecran")
    assert prix.parse_tarif_cle("tarifs_apple_devices:5:batterie_prix_ht") == ("tarifs_apple_devices", 5, "batterie")
    assert prix.parse_tarif_cle("tarifs_reparation:3:batterie") == ("tarifs_reparation", 3, "batterie")
    assert prix.parse_tarif_cle("iphone_tarifs:4:2") == ("iphone_tarifs", 4, "prix_2")
    assert prix.tarif_cle("iphone_tarifs", 4, "prix_2") == "iphone_tarifs:4:2"
    assert prix.tarif_cle("tarifs_apple_devices", 5, "ecran_prix_vente") == "tarifs_apple_devices:5:ecran"
    for faux in ("", "tickets:1", "tarifs:abc", "tarifs:0", "tarifs:1:x", "tarifs_reparation:3:modele",
                 "tarifs_apple_devices:5:chassis", "iphone_tarifs:4:9", "tarifs; DROP TABLE tarifs"):
        with pytest.raises(ValueError):
            prix.parse_tarif_cle(faux)


def test_liste_blanche_des_tables_et_colonnes():
    with pytest.raises(ValueError):
        prix.ecrire_prix_lot(None, "tickets", [(1, "prix", 1)], "manuel", "x")
    with pytest.raises(ValueError):
        prix.ecrire_prix_lot(None, "tarifs", [(1, "modele", 1)], "manuel", "x")
    with pytest.raises(ValueError):
        prix.ecrire_prix_lot(None, "tarifs", [(1, "prix_client", 1)], "scraping", "x")
    with pytest.raises(ValueError):
        prix.normaliser_valeur("integer", -5)


# ═══ Lecture de fichier et correspondance des noms (purs) ═══════

def test_lire_prix_formats_francais():
    assert import_prix.lire_prix("12,50") == Decimal("12.50")
    assert import_prix.lire_prix("1 234,56") == Decimal("1234.56")
    assert import_prix.lire_prix("1.234,56") == Decimal("1234.56")
    assert import_prix.lire_prix("1,234.56") == Decimal("1234.56")
    assert import_prix.lire_prix("12.5 €") == Decimal("12.50")
    assert import_prix.lire_prix(8.4) == Decimal("8.40")
    assert import_prix.lire_prix("") is None and import_prix.lire_prix(None) is None
    for faux in ("sur devis", "12,5,3", True):
        with pytest.raises(ValueError):
            import_prix.lire_prix(faux)


def test_csv_point_virgule_decimales_virgule_et_titre_avant_l_entete():
    lignes = import_prix.lire_tableau("mobilax.csv", _texte("prix_fournisseur_mobilax.csv"))
    i, colonnes, mapping = import_prix.detecter_entete(lignes)
    assert i == 2 and colonnes[:3] == ["Référence", "Désignation", "Prix HT"]
    assert mapping == {"reference": "Référence", "designation": "Désignation", "prix_ht": "Prix HT"}
    assert lignes[3][2] == "54,90"
    # Séparateur virgule, décimales à point ; Windows-1252
    lignes = import_prix.lire_tableau("apple.csv", _texte("prix_apple_devices.csv"))
    assert lignes[1][:2] == ["Ecran iPad 9 (2021)", "45.50"]
    texte = "Désignation;Prix HT\nÉcran iPhone 13;12,00\n".encode("cp1252")
    assert import_prix.lire_tableau("x.csv", texte)[1] == ["Écran iPhone 13", "12,00"]


def test_xlsx_entetes_varies_et_colonne_ttc_ignoree():
    lignes = import_prix.lire_tableau("utopya.xlsx", _texte("prix_fournisseur_utopya.xlsx"))
    i, colonnes, mapping = import_prix.detecter_entete(lignes)
    assert i == 2
    assert mapping == {"reference": "Réf.", "designation": "Libellé", "marque": "Marque", "modele": "Modèle",
                       "type_piece": "Type de pièce", "qualite": "Qualité", "prix_ht": "PU HT (€)"}


def test_fichiers_refuses():
    for nom, contenu in (("x.csv", b""), ("x.xls", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1xxxx"),
                         ("x.csv", b"Nom;Stock\nA;1\n"), ("x.xlsx", b"PK\x03\x04pas un classeur")):
        with pytest.raises(import_prix.ImportErreur):
            import_prix.detecter_entete(import_prix.lire_tableau(nom, contenu))
    with pytest.raises(import_prix.ImportErreur):
        import_prix.lire_tableau("x.csv", b"x" * (import_prix.MAX_OCTETS + 1))
    with pytest.raises(import_prix.ImportErreur):
        import_prix.valider_mapping({"prix_ht": "Prix", "colonne_sql": "x"})
    assert import_prix.valider_mapping('{"ref": "Code", "prix_ht": "Prix"}') == {"reference": "Code", "prix_ht": "Prix"}


@pytest.mark.parametrize("a, marque_a, b, marque_b", [
    ("Reno10", "Oppo", "Reno 10", "Oppo"),
    ("Nord CE4 Lite", "OnePlus", "Nord CE 4 Lite", "OnePlus"),
    ("Galaxy S23", "Samsung", "S23", "Samsung"),
    ("iPhone 8+", "Apple", "iPhone 8 Plus", "Apple"),
])
def test_noms_equivalents(a, marque_a, b, marque_b):
    assert import_prix.cles_modele(a, marque_a)["modele"] == import_prix.cles_modele(b, marque_b)["modele"]


@pytest.mark.parametrize("a, b, marque", [
    ("POCO X6", "POCO X6 Pro", "Xiaomi"), ("P40", "P40 Lite", "Huawei"),
    ("Galaxy Tab S6", "Galaxy Tab S6 Lite", "Samsung"), ("iPhone 13", "iPhone 13 mini", "Apple"),
])
def test_noms_distincts_a_tous_les_niveaux(a, b, marque):
    ka, kb = import_prix.cles_modele(a, marque), import_prix.cles_modele(b, marque)
    assert all(ka[n].isdisjoint(kb[n]) for n in import_prix.NIVEAUX)


def test_nom_groupe_deplie_et_tailles_d_ecran():
    assert import_prix.cles_modele("iPhone 12/12 Pro", "Apple")["modele"] == {"iphone 12", "iphone 12 pro"}
    assert (import_prix.cles_modele('iPad 9 (2021) 10.2"', "Apple")["sans_taille"]
            == import_prix.cles_modele("iPad 9 (2021)", "Apple")["sans_taille"])


@pytest.mark.parametrize("designation, piece, qualite, modele", [
    ("Ecran Hard OLED iPhone 16 Pro Max", "ecran", "OLED", "iPhone 16 Pro Max"),
    ("Ecran Soft OLED Samsung Galaxy S23", "ecran", "Soft OLED", "Samsung Galaxy S23"),
    ("Nappe connecteur charge iPhone 12/12 Pro", "connecteur", None, "iPhone 12/12 Pro"),
    ("Vitre camera arriere iPhone 11", "vitre_camera", None, "iPhone 11"),
    ("Haut-parleur iPhone 13", "haut_parleur", None, "iPhone 13"),
    ("Ecran Original pour Samsung Galaxy S20 noir", "ecran", "Original", "Samsung Galaxy S20"),
    ("Câble USB-C 1 m", None, None, "Câble USB-C 1 m"),
])
def test_interpretation_d_une_designation(designation, piece, qualite, modele):
    it = import_prix.interpreter({"designation": designation})
    assert (it["piece"], it["qualite"], it["modele"]) == (piece, qualite, modele)


@pytest.mark.parametrize("designation, piece, qualite, modele, marque", [
    # Mots de libellé fournisseur autour de la pièce : jamais dans le nom du modèle
    ("Ecran complet Original pour Samsung A25", "ecran", "Original", "Samsung A25", "samsung"),
    ("Ecran LCD + Tactile pour Samsung Galaxy A12 - Noir", "ecran", "LCD", "Samsung Galaxy A12", "samsung"),
    ("Écran LCD + Tactile LCD Samsung Galaxy A12", "ecran", "LCD", "Samsung Galaxy A12", "samsung"),
    ("Ecran complet avec châssis Soft OLED pour iPhone 13", "ecran", "Soft OLED", "iPhone 13", "apple"),
    ("Lentille caméra arrière pour iPhone 15 Pro Max", "vitre_camera", None, "iPhone 15 Pro Max", "apple"),
    ("Caméra arrière principale pour iPhone 13", "camera_arriere", None, "iPhone 13", "apple"),
    ("Batterie (avec adhésif) pour Oppo Reno10", "batterie", None, "Oppo Reno10", "oppo"),
    ("Batterie iPad 9 (2021) (avec adhésif)", "batterie", None, "iPad 9 (2021)", "apple"),
    # Nom groupé écrit avec espaces : le « / » reste, le nom se déplie
    ("Écran Incell pour iPhone 12 / 12 Pro", "ecran", "Incell", "iPhone 12 / 12 Pro", "apple"),
    ("Vitre arrière pour iPhone 12 / 12 Pro - Noir", "vitre_arriere", None, "iPhone 12 / 12 Pro", "apple"),
    ("Ecran / Vitre tactile Original Samsung A12", "ecran", "Original", "Samsung A12", "samsung"),
    # Caméra avant : pièce à part, jamais la caméra arrière
    ("Caméra avant pour iPhone 13", "camera_avant", None, "iPhone 13", "apple"),
])
def test_libelles_fournisseur_courants(designation, piece, qualite, modele, marque):
    it = import_prix.interpreter({"designation": designation})
    assert (it["piece"], it["qualite"], it["modele"], it["marque_c"]) == (piece, qualite, modele, marque)


def test_nom_groupe_avec_espaces_deplie():
    it = import_prix.interpreter({"designation": "Écran Incell pour iPhone 12 / 12 Pro"})
    assert import_prix.cles_modele(it["modele"], it["marque"])["modele"] == {"iphone 12", "iphone 12 pro"}
    assert import_prix.cles_modele(it["modele"], it["marque"]) == import_prix.cles_modele("iPhone 12 / 12 Pro", "Apple")


@pytest.mark.parametrize("ligne", [
    {"designation": "Adhésif batterie iPhone 13"}, {"designation": "Film de protection caméra iPhone 13"},
    {"designation": "Coque batterie iPhone 12"}, {"designation": "Joint étanchéité écran iPhone 13"},
    {"designation": "Adhésif batterie iPhone 13", "type_piece": "Batterie"},   # même avec une colonne « Type »
])
def test_accessoire_nomme_avant_la_piece_n_est_jamais_la_piece(ligne):
    assert import_prix.interpreter(ligne)["piece"] is None


def test_accessoire_apres_la_piece_ne_change_rien():
    assert import_prix.interpreter({"designation": "Batterie iPhone 13 avec adhésif"})["piece"] == "batterie"
    assert import_prix.interpreter({"designation": "Ecran complet avec adhésif Incell iPhone 13"})["piece"] == "ecran"


class _CurIndex:
    """Curseur minimal : Index lit ses pièces en une requête."""

    def __init__(self, lignes):
        self.lignes = lignes

    def execute(self, sql, params=None):
        pass

    def fetchall(self):
        return self.lignes


def _apple(i, modele, ecran=50, batterie=20):
    return {"id": i, "categorie": "macbook" if "MacBook" in modele else "ipad", "modele": modele,
            "ecran_prix_ht": ecran, "batterie_prix_ht": batterie, "ecran_prix_vente": 199, "batterie_prix_vente": 149,
            "verrou_manuel": False, "obsolete": False, "actif": True, "fournisseur": "Mobilax", "ref_fournisseur": None}


def test_pieces_que_seule_la_reference_distingue_jamais_toutes_a_la_fois():
    # Les trois MacBook Air 13" ont la même clé de modèle normalisée : une ligne sans référence
    # n'en vise aucune (association à la main) ; le nom complet, lui, vise la bonne
    index = import_prix.Index(_CurIndex([_apple(28, 'MacBook Air 13" A1466 (2013-2017)'),
                                         _apple(29, 'MacBook Air 13" A1932 (2018-2019)'),
                                         _apple(30, 'MacBook Air 13" A2179 (2020 Intel)')]), "tarifs_apple_devices")
    for d in ('Ecran MacBook Air 13"', "Batterie pour MacBook Air 13 pouces"):
        t, niveau, raison = index.associer({"designation": d}, import_prix.interpreter({"designation": d}))
        assert t == [] and raison.startswith("plusieurs modèles possibles"), d
    d = 'Ecran complet Original pour MacBook Air 13" A1932 (2018-2019)'
    t, niveau, raison = index.associer({"designation": d}, import_prix.interpreter({"designation": d}))
    assert [e["cle"] for e in t] == ["tarifs_apple_devices:29:ecran"] and niveau == "exact"


def test_marque_deduite_du_nom():
    assert import_prix.interpreter({"designation": "Batterie Poco F5"})["marque_c"] == "xiaomi"
    assert import_prix.interpreter({"designation": "Batterie iPhone 13"})["marque_c"] == "apple"
    it = import_prix.interpreter({"designation": "Ecran", "marque": "Oppo", "modele": "Reno10", "type_piece": "Écran",
                                  "qualite": "Original"})
    assert (it["marque_c"], it["modele"], it["piece"], it["qualite"]) == ("oppo", "Reno10", "ecran", "Original")


# ═══ Schéma, scripts neutralisés, sécurité (purs) ══════════════

def test_schema_declare_dans_main():
    tables = " ".join(main._DDL_TABLES)
    for t in ("tarifs_historique", "tarifs_imports", "tarifs_propositions"):
        assert f"CREATE TABLE IF NOT EXISTS {t} (" in tables
    for table in ("tarifs", "tarifs_apple_devices"):
        for col in ("prix_maj_le TIMESTAMP", "prix_source TEXT", "verrou_manuel BOOLEAN DEFAULT FALSE",
                    "ref_fournisseur TEXT", "fournisseur TEXT DEFAULT 'Mobilax'", "obsolete BOOLEAN DEFAULT FALSE"):
            assert f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col}" in main._DDL_ALTERS
    for table in ("tarifs_reparation", "iphone_tarifs", "smartphones_tarifs"):
        assert f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS prix_maj_le TIMESTAMP" in main._DDL_ALTERS
    index = " ".join(main._DDL_INDEXES)
    assert ("CREATE UNIQUE INDEX IF NOT EXISTS idx_tarifs_piece_unique ON tarifs "
            "(lower(marque), lower(modele), lower(type_piece), COALESCE(lower(qualite), ''))") in index
    assert "idx_tarifs_propositions_attente ON tarifs_propositions (tarif_cle) WHERE statut = 'en_attente'" in index
    # Initialisation unique : dans les données de démarrage, sans paramètre, avec son drapeau
    assert tarifs.SQL_INIT_PRIX in main._DONNEES_FIXES and "%" not in tarifs.SQL_INIT_PRIX
    assert prix.FLAG_INITIALISATION in tarifs.SQL_INIT_PRIX and "'estimation_2026_02'" in tarifs.SQL_INIT_PRIX


def test_scripts_d_import_neutralises(capsys):
    for script in (import_tarifs, import_apple_devices):
        with patch.dict(sys.modules, {"httpx": None}):
            assert script.main() == 1
        assert "obsolète" in capsys.readouterr().err
        source = Path(script.__file__).read_text()
        assert "httpx" not in source and "/clear" not in source


def test_plus_de_truncate_ni_de_delete_insert():
    import inspect
    source = inspect.getsource(tarifs)
    assert "TRUNCATE TABLE" not in source and "DELETE FROM tarifs_reparation\")" not in source
    assert 'user.get("role")' not in source
    assert "TRUNCATE TABLE" not in inspect.getsource(import_prix) + inspect.getsource(prix)
    assert "DELETE FROM tarifs " not in inspect.getsource(import_prix) + inspect.getsource(prix)


# Toutes les routes qui écrivent un prix (ou lisent les coûts et règles) : admin prouvé seulement
_CSV = "Désignation;Prix HT\nBatterie iPhone 13;11,00\n".encode()
ROUTES_ADMIN = [
    ("post", "/api/tarifs/import", {"json": {"items": [
        {"marque": "Apple", "modele": "iPhone 13", "type_piece": "Batterie", "prix_fournisseur_ht": 99}]}}),
    ("post", "/api/tarifs/recalculate", {}),
    ("delete", "/api/tarifs/clear", {}),
    ("patch", "/api/tarifs/123/stock", {}),
    ("patch", "/api/tarifs/123/verrou", {"json": {"verrou_manuel": True}}),
    ("patch", "/api/tarifs/123/prix", {"json": {"prix_client": 999}}),
    ("post", "/api/tarifs/ligne", {"json": {"marque": "Pytest", "modele": "Phone", "type_piece": "Batterie",
                                            "prix_client": 99}}),
    ("post", "/api/tarifs/apple-devices/import", {"json": {"items": [
        {"categorie": "ipad", "modele": "Pytest iPad", "ecran_prix_ht": 40}]}}),
    ("delete", "/api/tarifs/apple-devices/clear", {}),
    ("patch", "/api/tarifs/apple-devices/5/verrou", {"json": {"verrou_manuel": True}}),
    ("post", "/api/tarifs/simuler", {"json": {"regles": {"ecran": {"standard": 99}}}}),
    ("post", "/api/tarifs/appliquer", {"json": {"regles": {"ecran": {"standard": 99}}, "confirmer": True}}),
    ("post", "/api/tarifs/import-fichier/apercu", {"files": {"fichier": ("p.csv", _CSV)}}),
    ("post", "/api/tarifs/import-fichier/1/appliquer", {"json": {"lignes": [2]}}),
    ("post", "/api/tarifs/historique/annuler-lot/0123456789abcdef", {}),
    ("get", "/api/tarifs/regles", {}),
    ("get", "/api/tarifs/historique", {}),
    ("get", "/api/tarifs/historique/lots", {}),
    ("put", "/api/tarifs/reparation/13", {"json": {"batterie": 9}}),
    ("post", "/api/tarifs/reparation/bulk", {"json": [{"modele": "iPhone 13", "batterie": 9}]}),
    ("post", "/api/tarifs/reparation/add", {"json": {"modele": "Pytest Phone"}}),
    ("delete", "/api/tarifs/reparation/13", {}),
    ("post", "/api/tarifs/reparation/reorder", {"json": [{"id": 13, "ordre": 1}]}),
    ("patch", "/api/iphone-tarifs/7", {"json": {"prix_1": 1}}),
    ("post", "/api/smartphones-tarifs", {"json": {"slug": "pytest-phone", "marque": "Pytest", "modele": "P",
                                                  "prix_1": 1}}),
    ("patch", "/api/smartphones-tarifs/6", {"json": {"prix_1": 1}}),
    ("delete", "/api/smartphones-tarifs/6", {}),
]


class _Base:
    """Base simulée : seule la lecture du rôle et de la preuve admin répond ; toute autre requête
    est enregistrée (elle ne doit jamais avoir lieu pour un refus)."""

    def __init__(self, role, prouve=False):
        self.role, self.prouve, self.requetes = role, prouve, []

    @contextmanager
    def get_cursor(self, *a, **k):
        base = self

        class Cur:
            rowcount = 0
            _r = None

            def execute(self, sql, params=None):
                sql = " ".join(str(sql).split())
                if "FROM membres_equipe" in sql:
                    self._r = {"role": base.role, "prouve": base.prouve, "a_prolonger": False}
                else:
                    base.requetes.append(sql)
                    self._r = None

            def fetchone(self):
                return self._r

            def fetchall(self):
                return [self._r] if self._r else []

        yield Cur()


@pytest.mark.parametrize("role, code", [("Technicien", None), ("admin", "admin_requis")])
@pytest.mark.parametrize("methode, chemin, kw", ROUTES_ADMIN, ids=[f"{m} {c}" for m, c, _ in ROUTES_ADMIN])
def test_403_sans_role_admin_ou_sans_code_et_aucune_requete(client, monkeypatch, role, code, methode, chemin, kw):
    base = _Base(role)
    for mod in (auth, tarifs, iphone_tarifs, smartphones_tarifs):
        monkeypatch.setattr(mod, "get_cursor", base.get_cursor)
    tok = create_token("accueil", "Pytest Membre")
    r = client.request(methode.upper(), chemin, headers={"Authorization": f"Bearer {tok}"}, **kw)
    assert r.status_code == 403, r.text
    detail = r.json()["detail"]
    assert (detail.get("code") if isinstance(detail, dict) else None) == code
    assert base.requetes == []


# Clés du moteur de prix : jamais par PUT /api/config (règles : /api/tarifs/appliquer, lot annulable)
CLES_MOTEUR = [prix.CLE_REGLES, "tarifs_regles", "IMPORT_MAPPING_MOBILAX", "VEILLE_PRIX_DERNIERE", "VEILLE_PRIX_RESUME",
               "LCDPHONE_SYNCHRO_OK", "LCDPHONE_DERNIERE_SYNCHRO", prix.FLAG_INITIALISATION,
               "MODELES_ALIAS_INITIAUX_2026_10"]


@pytest.mark.parametrize("cle", CLES_MOTEUR)
@pytest.mark.parametrize("qui", ["tech", "accueil", "admin_prouve"])
def test_config_refuse_les_cles_du_moteur_de_prix_sans_aucune_requete(client, monkeypatch, cle, qui):
    base = _Base("admin", prouve=True)
    for mod in (auth, config):
        monkeypatch.setattr(mod, "get_cursor", base.get_cursor)
    tok = create_token("tech" if qui == "tech" else "accueil", "Pytest Membre")
    h = {"Authorization": f"Bearer {tok}"}
    if qui == "admin_prouve":
        h["X-Admin-Token"] = create_admin_token(decode_token(tok))
    valeur = json.dumps({"autre": 10, "ecran": {"standard": 0}})
    for chemin, corps in (("/api/config", {"cle": cle, "valeur": valeur}),
                          ("/api/config/batch", [{"cle": "NOM_BOUTIQUE", "valeur": "X"}, {"cle": cle, "valeur": valeur}])):
        r = client.put(chemin, headers=h, json=corps)
        assert r.status_code == 403, r.text
        assert not isinstance(r.json()["detail"], dict)       # pas une demande de code admin : refus définitif
    assert base.requetes == []


@pytest.mark.parametrize("role, code", [("Technicien", None), ("admin", "admin_requis")])
def test_config_cadenas_boutique_exige_role_admin_et_code(client, monkeypatch, role, code):
    base = _Base(role)
    for mod in (auth, config):
        monkeypatch.setattr(mod, "get_cursor", base.get_cursor)
    tok = create_token("accueil", "Pytest Membre")
    r = client.put("/api/config", headers={"Authorization": f"Bearer {tok}"},
                   json={"cle": config.PARAM_VERROUS_BOUTIQUE, "valeur": json.dumps({"tarifs_reparation": [9]})})
    assert r.status_code == 403, r.text
    detail = r.json()["detail"]
    assert (detail.get("code") if isinstance(detail, dict) else None) == code
    assert base.requetes == []


@pytest.mark.parametrize("valeur", ["pas du json", "[1, 2]", '{"tickets": [1]}', '{"tarifs_reparation": ["1"]}',
                                    '{"tarifs_reparation": [0]}', '{"iphone_tarifs": 5}'])
def test_config_cadenas_boutique_valeur_invalide(valeur):
    with pytest.raises(config.HTTPException) as e:
        config._controler_verrous_boutique(valeur)
    assert e.value.status_code == 400


def test_config_cadenas_boutique_normalise():
    assert config._controler_verrous_boutique('{"tarifs_reparation": [10, 9, 10], "iphone_tarifs": []}') == \
        '{"iphone_tarifs": [], "tarifs_reparation": [9, 10]}'
    assert config._controler_verrous_boutique("") == "{}"


# ═══ Base réelle ═══════════════════════════════════════════════

DB_URL = os.getenv("KP_PRIX_DATABASE_URL")
CSV_DIR = os.getenv("KP_PRIX_CSV_DIR")
ADMIN, STAFF = "Pytest Gérant Prix", "Pytest Accueil Prix"
TABLES_PRIX = ("tarifs", "tarifs_apple_devices", "tarifs_reparation", "iphone_tarifs", "smartphones_tarifs")
TABLES_JOURNAL = ("tarifs_historique", "tarifs_imports", "tarifs_propositions")
PARAMS_PRIX = (prix.CLE_REGLES, prix.FLAG_INITIALISATION, config.PARAM_VERROUS_BOUTIQUE)
MAJ_ESTIMATION = "2026-02-15 19:27:49.972983"


def _charger(cur):
    """Grilles de test : CSV de la prod, sinon celles de la base, sinon les estimations du dépôt."""
    if CSV_DIR:
        for t in TABLES_PRIX:
            chemin = Path(CSV_DIR) / f"{t}.csv"
            if not chemin.exists():
                continue
            with open(chemin, newline="") as f:
                colonnes = next(csv.reader(f))
            cur.execute(f"DELETE FROM {t}")
            with open(chemin) as f:
                cur.copy_expert(f"COPY {t} ({', '.join(colonnes)}) FROM STDIN WITH CSV HEADER", f)
    else:
        cur.execute("SELECT count(*) AS n FROM tarifs WHERE prix_source = 'estimation_2026_02'")
        if cur.fetchone()["n"] >= 1000:
            return
        cur.execute("DELETE FROM tarifs")
        lignes = []
        for i, row in enumerate(import_tarifs.TARIFS, 1):
            marque, modele, tp, q, nom, ht, cat = row[:7]
            lignes.append((i, marque, modele, tp, q, nom, ht, tarifs.calcul_prix_client(ht, tp, cat), cat,
                           row[7] if len(row) == 8 else True))
        from psycopg2.extras import execute_values
        execute_values(cur, """INSERT INTO tarifs (id, marque, modele, type_piece, qualite, nom_fournisseur,
                                   prix_fournisseur_ht, prix_client, categorie, en_stock, source, updated_at)
                               VALUES %s""",
                       [l + ("mobilax", MAJ_ESTIMATION) for l in lignes], page_size=2000)
        cur.execute("DELETE FROM tarifs_apple_devices")
        appareils = []
        for i, (cat, modele, ecran, batterie) in enumerate(import_apple_devices.APPLE_DEVICES, 1):
            calc = tarifs.calc_prix_ipad if cat == "ipad" else tarifs.calc_prix_macbook
            appareils.append((i, cat, modele, ecran, batterie, calc(ecran), calc(batterie), True,
                              MAJ_ESTIMATION, MAJ_ESTIMATION))
        execute_values(cur, """INSERT INTO tarifs_apple_devices (id, categorie, modele, ecran_prix_ht, batterie_prix_ht,
                                   ecran_prix_vente, batterie_prix_vente, actif, created_at, updated_at) VALUES %s""",
                       appareils)
    for t in TABLES_PRIX:
        cur.execute(f"SELECT setval(pg_get_serial_sequence('{t}', 'id'), (SELECT COALESCE(MAX(id), 1) FROM {t}))")
    # Initialisation de la date et de la source des prix, comme au premier déploiement
    cur.execute("DELETE FROM params WHERE cle = %s", (prix.FLAG_INITIALISATION,))
    cur.execute(prix.SQL_INITIALISATION)



def _photo(cur):
    for t in TABLES_PRIX + TABLES_JOURNAL:
        cur.execute(f"DROP TABLE IF EXISTS kp_pytest_photo_{t}")
        cur.execute(f"CREATE TABLE kp_pytest_photo_{t} AS SELECT * FROM {t}")
    cur.execute("SELECT cle, valeur FROM params WHERE cle = ANY(%s) OR cle LIKE 'IMPORT\\_MAPPING\\_%%'",
                (list(PARAMS_PRIX),))
    return {r["cle"]: r["valeur"] for r in cur.fetchall()}


def _restaurer(cur, params):
    for t in TABLES_PRIX + TABLES_JOURNAL:
        cur.execute(f"DELETE FROM {t}")
        cur.execute(f"INSERT INTO {t} SELECT * FROM kp_pytest_photo_{t}")
        cur.execute(f"SELECT setval(pg_get_serial_sequence('{t}', 'id'), (SELECT COALESCE(MAX(id), 1) FROM {t}))")
    cur.execute("DELETE FROM params WHERE cle = ANY(%s) OR cle LIKE 'IMPORT\\_MAPPING\\_%%'", (list(PARAMS_PRIX),))
    for cle, valeur in params.items():
        cur.execute("INSERT INTO params (cle, valeur) VALUES (%s, %s)", (cle, valeur))


@pytest.fixture(scope="module")
def reel():
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
    params = None
    try:
        with TestClient(fastapi_app) as c:   # lifespan : schéma + migrations
            with vrai_cursor() as cur:
                cur.execute("DELETE FROM membres_equipe WHERE nom = ANY(%s)", ([ADMIN, STAFF],))
                cur.execute("INSERT INTO membres_equipe (nom, role, actif) VALUES (%s, 'admin', 1), (%s, 'Accueil', 1)",
                            (ADMIN, STAFF))
                _charger(cur)
            with vrai_cursor() as cur:
                params = _photo(cur)
            params_cache.invalidate()
            yield {"c": c, "cur": vrai_cursor, "params": params}
    finally:
        try:
            if params is not None:
                with vrai_cursor() as cur:
                    _restaurer(cur, params)
                    for t in TABLES_PRIX + TABLES_JOURNAL:
                        cur.execute(f"DROP TABLE IF EXISTS kp_pytest_photo_{t}")
                    cur.execute("DELETE FROM membres_equipe WHERE nom = ANY(%s)", ([ADMIN, STAFF],))
        finally:
            mp.undo()
            pool.closeall()
            params_cache.invalidate()


@pytest.fixture
def base(reel):
    """Chaque test part des grilles chargées (et les y remet)."""
    with reel["cur"]() as cur:
        _restaurer(cur, reel["params"])
    params_cache.invalidate()
    tarifs._cache.clear()
    yield reel


def _h_staff():
    return {"Authorization": f"Bearer {create_token('accueil', STAFF)}"}


def _h_admin(code=True):
    tok = create_token("accueil", ADMIN)
    h = {"Authorization": f"Bearer {tok}"}
    if code:
        h["X-Admin-Token"] = create_admin_token(decode_token(tok))
    return h


def _sql(base, sql, *params):
    with base["cur"]() as cur:
        cur.execute(sql, params)
        return cur.fetchall() if cur.description else None


def _empreinte(base, table="tarifs"):
    cols = {
        "tarifs": "prix_fournisseur_ht, prix_client, prix_maj_le, prix_source, verrou_manuel, ref_fournisseur, "
                  "fournisseur, obsolete",
        "tarifs_apple_devices": "ecran_prix_ht, batterie_prix_ht, ecran_prix_vente, batterie_prix_vente, prix_maj_le, "
                                "prix_source, verrou_manuel, obsolete",
        "tarifs_reparation": "modele, ordre, " + ", ".join(prix.TABLES["tarifs_reparation"]["base"]) + ", prix_maj_le",
    }[table]
    return _sql(base, f"SELECT md5(string_agg(row({cols})::text, ',' ORDER BY id)) AS h, count(*) AS n FROM {table}")[0]


def _n_historique(base):
    return _sql(base, "SELECT count(*) AS n FROM tarifs_historique")[0]["n"]


def _id(base, marque, modele, type_piece, qualite=None):
    r = _sql(base, "SELECT id FROM tarifs WHERE marque = %s AND modele = %s AND type_piece = %s "
                   "AND COALESCE(qualite, '') = COALESCE(%s, '')", marque, modele, type_piece, qualite)
    assert r, (marque, modele, type_piece, qualite)
    return r[0]["id"]


def _tarif(base, tid):
    return _sql(base, "SELECT * FROM tarifs WHERE id = %s", tid)[0]


def _post(base, chemin, h=None, **kw):
    return base["c"].post(chemin, headers=h or _h_admin(), **kw)


# ─── Socle : initialisation, migrations, index unique ──────────

def test_reel_initialisation_des_dates_et_sources(base):
    tarifs_src = _sql(base, "SELECT prix_source, count(*) AS n, count(prix_maj_le) AS dates, "
                            "bool_and(prix_maj_le = updated_at) AS egales FROM tarifs GROUP BY 1")
    assert tarifs_src == [{"prix_source": "estimation_2026_02", "n": 1202, "dates": 1202, "egales": True}]
    apple = _sql(base, "SELECT prix_source, count(*) AS n, bool_and(prix_maj_le = updated_at) AS egales "
                       "FROM tarifs_apple_devices GROUP BY 1")
    assert apple == [{"prix_source": "estimation_2026_02", "n": 49, "egales": True}]
    for t in ("tarifs_reparation", "iphone_tarifs", "smartphones_tarifs"):
        assert _sql(base, f"SELECT count(*) AS n FROM {t} WHERE prix_maj_le IS NULL")[0]["n"] == 0
    assert _sql(base, "SELECT count(*) AS n FROM tarifs WHERE verrou_manuel OR obsolete OR fournisseur <> 'Mobilax'"
                )[0]["n"] == 0
    # Drapeau posé : relancer les données de démarrage ne réécrit rien
    avant = _empreinte(base)
    _sql(base, "UPDATE tarifs SET prix_maj_le = NULL WHERE id = 1")
    main._donnees_de_demarrage()
    assert _tarif(base, 1)["prix_maj_le"] is None
    _sql(base, "UPDATE tarifs SET prix_maj_le = updated_at WHERE id = 1")
    assert _empreinte(base) == avant


def test_reel_migrations_idempotentes(base):
    avant = (_empreinte(base), _empreinte(base, "tarifs_apple_devices"))
    assert main.appliquer_schema() is True
    assert main.appliquer_schema() is True
    main._donnees_de_demarrage()
    assert (_empreinte(base), _empreinte(base, "tarifs_apple_devices")) == avant


def test_reel_index_unique_refuse_un_doublon(base):
    import psycopg2
    t = _tarif(base, _id(base, "Oppo", "Reno 10", "Ecran", "Original"))
    with pytest.raises(psycopg2.errors.UniqueViolation):
        _sql(base, "INSERT INTO tarifs (marque, modele, type_piece, qualite, prix_client) VALUES (%s, %s, %s, %s, 1)",
             t["marque"].upper(), t["modele"].lower(), t["type_piece"], t["qualite"].upper())
    b = _tarif(base, _id(base, "Oppo", "Reno 10", "Batterie"))
    with pytest.raises(psycopg2.errors.UniqueViolation):   # qualité vide = absente
        _sql(base, "INSERT INTO tarifs (marque, modele, type_piece, qualite, prix_client) VALUES (%s, %s, %s, '', 1)",
             b["marque"], b["modele"], b["type_piece"])


# ─── Lot 0 : élévation admin sur chaque écriture ───────────────

@pytest.mark.parametrize("methode, chemin, kw", ROUTES_ADMIN, ids=[f"{m} {c}" for m, c, _ in ROUTES_ADMIN])
def test_reel_403_staff_et_admin_sans_code_rien_n_est_ecrit(base, methode, chemin, kw):
    avant = [_empreinte(base, t) for t in ("tarifs", "tarifs_apple_devices", "tarifs_reparation")]
    n = _n_historique(base)
    for h, code in ((_h_staff(), None), (_h_admin(code=False), "admin_requis")):
        r = base["c"].request(methode.upper(), chemin, headers=h, **kw)
        assert r.status_code == 403, r.text
        detail = r.json()["detail"]
        assert (detail.get("code") if isinstance(detail, dict) else None) == code
    assert [_empreinte(base, t) for t in ("tarifs", "tarifs_apple_devices", "tarifs_reparation")] == avant
    assert _n_historique(base) == n


def test_reel_admin_prouve_import_et_sync_plus_en_403(base, monkeypatch):
    from app.api import telephones
    monkeypatch.setattr(telephones, "_run_sync_background", lambda *a, **k: None)   # aucun appel à LCD-Phone
    h = _h_admin()
    r = _post(base, "/api/tarifs/import", h, json={"items": [
        {"marque": "Apple", "modele": "iPhone 13", "type_piece": "Batterie", "prix_fournisseur_ht": 11}]})
    assert r.status_code == 200, r.text
    assert r.json()["inserted"] == 0 and r.json()["modifies"] == 0   # même HT : rien ne bouge
    r = _post(base, "/api/telephones/sync", h)
    assert r.status_code == 200, r.text
    # Preuve enregistrée pour ce poste : plus besoin du jeton d'élévation
    r = _post(base, "/api/tarifs/recalculate", {"Authorization": h["Authorization"]})
    assert r.status_code == 200, r.text


def test_reel_clear_desactive_et_import_json_sans_doublon(base):
    for chemin in ("/api/tarifs/clear", "/api/tarifs/apple-devices/clear"):
        r = base["c"].delete(chemin, headers=_h_admin())
        assert r.status_code == 410
    assert _sql(base, "SELECT count(*) AS n FROM tarifs")[0]["n"] == 1202
    tid = _id(base, "Apple", "iPhone 13", "Batterie")
    r = _post(base, "/api/tarifs/import", json={"items": [
        {"marque": "APPLE", "modele": "iphone 13", "type_piece": "Batterie", "prix_fournisseur_ht": 20},
        {"marque": "Pytest", "modele": "Phone 1", "type_piece": "Ecran", "qualite": "OLED", "prix_fournisseur_ht": 30}]})
    assert r.status_code == 200, r.text
    assert (r.json()["inserted"], r.json()["modifies"]) == (1, 1)
    t = _tarif(base, tid)
    assert (t["prix_fournisseur_ht"], t["prix_client"], t["prix_source"]) == (Decimal("20.00"), 89, "import")
    assert _sql(base, "SELECT count(*) AS n FROM tarifs")[0]["n"] == 1203
    # Annulation : la pièce créée devient obsolète (jamais supprimée), l'autre retrouve son prix
    r = _post(base, f"/api/tarifs/historique/annuler-lot/{r.json()['lot_id']}")
    assert r.status_code == 200, r.text
    assert r.json()["crees_retires"] == 1 and r.json()["restaures"] == 2
    assert _tarif(base, tid)["prix_fournisseur_ht"] == Decimal("11.00")
    cree = _tarif(base, _id(base, "Pytest", "Phone 1", "Ecran", "OLED"))
    assert cree["obsolete"] is True and cree["prix_client"] == 99


# ─── Lot 1 : ecrire_prix, historique, verrou, annulation ───────

def test_reel_ecrire_prix_meme_valeur_puis_vraie_valeur(base):
    tid = _id(base, "Oppo", "Reno 10", "Batterie")
    avant = _tarif(base, tid)
    n = _n_historique(base)
    with base["cur"]() as cur:
        assert prix.ecrire_prix(cur, "tarifs", tid, "prix_fournisseur_ht", avant["prix_fournisseur_ht"],
                                "manuel", "pytest") is False
    assert _n_historique(base) == n and _tarif(base, tid)["prix_maj_le"] == avant["prix_maj_le"]
    with base["cur"]() as cur:
        assert prix.ecrire_prix(cur, "tarifs", tid, "prix_fournisseur_ht", "9,75", "commande", "pytest", "lot-x") is True
    apres = _tarif(base, tid)
    assert apres["prix_fournisseur_ht"] == Decimal("9.75") and apres["prix_source"] == "commande"
    assert apres["prix_maj_le"] > avant["prix_maj_le"]
    h = _sql(base, "SELECT * FROM tarifs_historique ORDER BY id DESC LIMIT 1")[0]
    assert (h["table_nom"], h["ligne_id"], h["colonne"], h["ancien"], h["nouveau"], h["source"], h["lot_id"],
            h["ancien_maj_le"], h["ancien_source"]) == (
        "tarifs", tid, "prix_fournisseur_ht", Decimal("9.00"), Decimal("9.75"), "commande", "lot-x",
        avant["prix_maj_le"], "estimation_2026_02")
    # Verrou : seule une saisie manuelle passe
    _sql(base, "UPDATE tarifs SET verrou_manuel = TRUE WHERE id = %s", tid)
    with base["cur"]() as cur:
        assert prix.ecrire_prix(cur, "tarifs", tid, "prix_client", 1, "import", "pytest") is False
        assert prix.ecrire_prix(cur, "tarifs", tid, "prix_client", 75, "manuel", "pytest") is True
    assert _tarif(base, tid)["prix_client"] == 75


def test_reel_toggle_stock_ne_date_pas_le_prix(base):
    tid = _id(base, "Oppo", "Reno 10", "Batterie")
    avant = _tarif(base, tid)
    r = base["c"].patch(f"/api/tarifs/{tid}/stock", headers=_h_admin())
    assert r.status_code == 200 and r.json()["en_stock"] is (not avant["en_stock"])
    apres = _tarif(base, tid)
    assert (apres["prix_maj_le"], apres["prix_source"]) == (avant["prix_maj_le"], avant["prix_source"])


def test_reel_verrou_route_et_liste(base):
    tid = _id(base, "Oppo", "Reno 10", "Batterie")
    r = base["c"].patch(f"/api/tarifs/{tid}/verrou", headers=_h_admin(), json={"verrou_manuel": True})
    assert r.status_code == 200 and r.json() == {"id": tid, "verrou_manuel": True}
    lignes = {t["id"]: t for t in base["c"].get("/api/tarifs", headers=_h_staff()).json()}
    assert lignes[tid]["verrou_manuel"] is True and "prix_fournisseur_ht" not in lignes[tid]
    assert lignes[tid]["fraicheur"] == "perime" and lignes[tid]["estime"] is True and lignes[tid]["age_jours"] > 180
    admin = {t["id"]: t for t in base["c"].get("/api/tarifs", headers=_h_admin()).json()}
    assert admin[tid]["prix_fournisseur_ht"] == 9.0
    assert base["c"].patch("/api/tarifs/999999/verrou", headers=_h_admin(), json={"verrou_manuel": True}).status_code == 404


def test_reel_bulk_reparation_conserve_ids_et_ordre(base):
    avant = {r["modele"]: r for r in _sql(base, "SELECT * FROM tarifs_reparation")}
    n = len(avant)
    i13 = avant["iPhone 13"]
    corps = [{"modele": "iPhone 13", "batterie": 109},
             {"id": avant["iPhone 14"]["id"], "modele": "iPhone 14", "ecran_generique": avant["iPhone 14"]["ecran_generique"]},
             {"modele": "Pytest Phone 99", "batterie": 59}]
    r = _post(base, "/api/tarifs/reparation/bulk", json=corps)
    assert r.status_code == 200, r.text
    assert (r.json()["ajoutes"], r.json()["modifies"]) == (1, 2)
    apres = {r["modele"]: r for r in _sql(base, "SELECT * FROM tarifs_reparation")}
    assert len(apres) == n + 1
    assert (apres["iPhone 13"]["id"], apres["iPhone 13"]["ordre"]) == (i13["id"], i13["ordre"])
    assert apres["iPhone 13"]["batterie"] == 109 and apres["iPhone 13"]["ecran_generique"] == i13["ecran_generique"]
    assert apres["iPhone 13"]["prix_maj_le"] > i13["prix_maj_le"]
    assert apres["iPhone 14"] == avant["iPhone 14"]   # même valeur : rien d'écrit, pas même la date
    assert apres["Pytest Phone 99"]["ordre"] > max(r["ordre"] for r in avant.values())
    h = _sql(base, "SELECT source, ancien, nouveau FROM tarifs_historique WHERE table_nom = 'tarifs_reparation' "
                   "AND ligne_id = %s", i13["id"])
    assert h == [{"source": "manuel", "ancien": Decimal(i13["batterie"]), "nouveau": Decimal(109)}]
    assert _post(base, "/api/tarifs/reparation/bulk", json=[{"modele": "iPhone 13"}, {"modele": "iphone 13"}]
                 ).status_code == 400


def test_reel_put_reparation_par_le_moteur_de_prix(base):
    i13 = _sql(base, "SELECT * FROM tarifs_reparation WHERE modele = 'iPhone 13'")[0]
    r = base["c"].put(f"/api/tarifs/reparation/{i13['id']}", headers=_h_admin(), json={"batterie": 105, "chassis": None})
    assert r.status_code == 200, r.text
    assert r.json()["batterie"] == 105 and r.json()["chassis"] is None
    assert base["c"].put(f"/api/tarifs/reparation/{i13['id']}", headers=_h_admin(), json={"batterie": -3}).status_code == 400
    assert base["c"].put(f"/api/tarifs/reparation/{i13['id']}", headers=_h_admin(),
                         json={"modele": "iPhone 14"}).status_code == 409


# ─── Lot 0 / 2 : recalcul, simulation, application ─────────────

class _Compteur:
    """Curseur qui garde le texte de chaque requête exécutée."""

    def __init__(self, cur, requetes):
        self._cur, self._requetes = cur, requetes

    def execute(self, sql, params=None):
        self._requetes.append(" ".join((sql.decode() if isinstance(sql, bytes) else str(sql)).split()))
        return self._cur.execute(sql, params)

    def __getattr__(self, nom):
        return getattr(self._cur, nom)


def test_reel_recalcul_zero_ecart_ensembliste_rapide_et_idempotent(base, monkeypatch):
    h = _h_admin()
    r = _post(base, "/api/tarifs/recalculate", h)
    assert r.status_code == 200, r.text
    assert r.json()["modifies"] == 0 and r.json()["inchanges"] == 1202 + 49 * 2   # 0 écart avec les règles par défaut
    # Tous les prix client faussés, un HT absent : une seule requête UPDATE, aucun crash
    _sql(base, "UPDATE tarifs SET prix_client = prix_client + 1")
    sans_ht = _id(base, "Oppo", "Reno 10", "Batterie")
    _sql(base, "UPDATE tarifs SET prix_fournisseur_ht = NULL WHERE id = %s", sans_ht)
    requetes = []

    @contextmanager
    def compteur(*a, **k):
        with base["cur"]() as cur:
            yield _Compteur(cur, requetes)

    monkeypatch.setattr(tarifs, "get_cursor", compteur)
    debut = time.perf_counter()
    r = _post(base, "/api/tarifs/recalculate", h)
    duree = time.perf_counter() - debut
    assert r.status_code == 200, r.text
    res = r.json()
    assert (res["modifies"], res["sans_prix_achat"], res["verrouilles"]) == (1201, 1, 0)
    assert len([q for q in requetes if q.startswith("UPDATE")]) == 1
    assert duree < 2, duree
    attendu = {row[4]: tarifs.calcul_prix_client(row[5], row[2], row[6]) for row in import_tarifs.TARIFS}
    for t in _sql(base, "SELECT nom_fournisseur, prix_client FROM tarifs WHERE id <> %s", sans_ht):
        assert t["prix_client"] == attendu[t["nom_fournisseur"]]
    assert _tarif(base, sans_ht)["prix_client"] == 80   # HT absent : ignoré, intact
    # Un prix client recalculé ne rajeunit pas le prix : le coût HT est toujours l'estimation
    assert _sql(base, "SELECT count(*) AS n FROM tarifs WHERE prix_source = 'estimation_2026_02'")[0]["n"] == 1202
    requetes.clear()
    r = _post(base, "/api/tarifs/recalculate", h)
    assert r.json()["modifies"] == 0 and not [q for q in requetes if q.startswith("UPDATE")]


def test_reel_simuler_n_ecrit_rien(base):
    avant = (_empreinte(base), _empreinte(base, "tarifs_apple_devices"), _empreinte(base, "tarifs_reparation"))
    n = _n_historique(base)
    for charge in ({"regles": {"ecran": {"standard": 70}, "ipad": 130}},
                   {"cible": "tarifs", "filtre": {"marque": "Samsung", "type_piece": "Ecran"},
                    "ajustement": {"type": "pct", "valeur": 5}},
                   {"cible": "tarifs_reparation", "filtre": {"colonne": "batterie"},
                    "ajustement": {"type": "eur", "valeur": 10}},
                   {}):
        r = _post(base, "/api/tarifs/simuler", json=charge)
        assert r.status_code == 200, r.text
        assert len(r.json()["ecarts"]) <= 20
    assert (_empreinte(base), _empreinte(base, "tarifs_apple_devices"), _empreinte(base, "tarifs_reparation")) == avant
    assert _n_historique(base) == n
    assert _sql(base, "SELECT count(*) AS n FROM params WHERE cle = %s", prix.CLE_REGLES)[0]["n"] == 0
    res = _post(base, "/api/tarifs/simuler", json={"regles": {"ecran": {"standard": 70}}}).json()
    ecrans_std = 0
    for marque, modele, tp, q, nom, ht, cat, *_ in import_tarifs.TARIFS:
        if prix.est_ecran(tp) and cat == "standard":
            ecrans_std += prix.arrondi_9_superieur(ht * 1.2 + 70) != tarifs.calcul_prix_client(ht, tp, cat)
    assert res["modifies"] == ecrans_std > 0 and res["variation_min"] == res["variation_max"] == 10
    assert _post(base, "/api/tarifs/simuler", json={"regles": {"tva": 3}}).status_code == 400
    assert _post(base, "/api/tarifs/simuler", json={"cible": "tickets", "ajustement": {"type": "pct", "valeur": 5}}
                 ).status_code == 400


def test_reel_appliquer_regles_respecte_le_verrou_et_lot_annulable_exactement(base):
    verrou = _id(base, "Apple", "iPhone 8 Plus", "Ecran", "Compatible")
    _sql(base, "UPDATE tarifs SET verrou_manuel = TRUE WHERE id = %s", verrou)
    avant, avant_apple = _empreinte(base), _empreinte(base, "tarifs_apple_devices")
    charge = {"regles": {"ecran": {"standard": 70}, "ipad": 130}}
    assert _post(base, "/api/tarifs/appliquer", json=charge).status_code == 400   # sans confirmer
    sim = _post(base, "/api/tarifs/simuler", json=charge).json()
    r = _post(base, "/api/tarifs/appliquer", json={**charge, "confirmer": True})
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["modifies"] == sim["modifies"] and res["verrouilles"] == 1 == sim["verrouilles"]
    assert res["verrouilles_liste"][0]["cle"] == f"tarifs:{verrou}"
    assert _tarif(base, verrou)["prix_client"] == 79
    assert prix.regles()["ecran"]["standard"] == 70
    hist = _sql(base, "SELECT DISTINCT source FROM tarifs_historique WHERE lot_id = %s", res["lot_id"])
    assert hist == [{"source": "formule"}]
    r = _post(base, f"/api/tarifs/historique/annuler-lot/{res['lot_id']}")
    assert r.status_code == 200, r.text
    assert r.json()["restaures"] > 0 and r.json()["conflits"] == [] and r.json()["regles"] == "retablies"
    assert (_empreinte(base), _empreinte(base, "tarifs_apple_devices")) == (avant, avant_apple)
    params_cache.invalidate()
    assert prix.regles() == prix.REGLES_DEFAUT
    assert _post(base, f"/api/tarifs/historique/annuler-lot/{res['lot_id']}").status_code == 409
    assert _post(base, "/api/tarifs/historique/annuler-lot/inconnu").status_code == 404


def test_reel_ajustement_grille_iphone_13_99_donne_109(base):
    i13 = _sql(base, "SELECT id, batterie, prix_maj_le FROM tarifs_reparation WHERE modele = 'iPhone 13'")[0]
    assert i13["batterie"] == 99
    charge = {"cible": "tarifs_reparation", "filtre": {"ids": [i13["id"]], "colonne": "batterie"},
              "ajustement": {"type": "pct", "valeur": 10}}
    sim = _post(base, "/api/tarifs/simuler", json=charge).json()
    assert sim["modifies"] == 1 and sim["ecarts"][0]["ancien"] == 99 and sim["ecarts"][0]["nouveau"] == 109
    res = _post(base, "/api/tarifs/appliquer", json={**charge, "confirmer": True}).json()
    apres = _sql(base, "SELECT batterie, prix_maj_le FROM tarifs_reparation WHERE id = %s", i13["id"])[0]
    assert apres["batterie"] == 109 and apres["prix_maj_le"] > i13["prix_maj_le"]
    assert _sql(base, "SELECT source FROM tarifs_historique WHERE lot_id = %s", res["lot_id"]) == [{"source": "manuel"}]
    _post(base, f"/api/tarifs/historique/annuler-lot/{res['lot_id']}")
    assert _sql(base, "SELECT batterie, prix_maj_le FROM tarifs_reparation WHERE id = %s", i13["id"])[0] == {
        "batterie": 99, "prix_maj_le": i13["prix_maj_le"]}


def test_reel_ajustement_ht_fournisseur_et_annulation_en_conflit(base):
    charge = {"cible": "tarifs", "filtre": {"marque": "Oppo", "modele": "Reno 10"},
              "ajustement": {"type": "pct", "valeur": 10}}
    res = _post(base, "/api/tarifs/appliquer", json={**charge, "confirmer": True}).json()
    assert res["modifies"] == 4 + _sql(base, "SELECT count(*) AS n FROM tarifs WHERE modele LIKE 'Reno 10 %%'")[0]["n"]
    ecran = _tarif(base, _id(base, "Oppo", "Reno 10", "Ecran", "Original"))
    assert ecran["prix_fournisseur_ht"] == Decimal("57.20") and ecran["prix_client"] == 129
    assert ecran["prix_source"] == "formule"
    # Modifiée depuis le lot : l'annulation ne l'écrase pas
    _sql(base, "UPDATE tarifs SET prix_fournisseur_ht = 60 WHERE id = %s", ecran["id"])
    r = _post(base, f"/api/tarifs/historique/annuler-lot/{res['lot_id']}").json()
    assert f"tarifs:{ecran['id']}" in r["conflits"]
    assert _tarif(base, ecran["id"])["prix_fournisseur_ht"] == Decimal("60.00")
    assert _tarif(base, _id(base, "Oppo", "Reno 10", "Batterie"))["prix_fournisseur_ht"] == Decimal("9.00")


def test_reel_regles_lues_et_historique(base):
    r = base["c"].get("/api/tarifs/regles", headers=_h_admin())
    assert r.status_code == 200 and r.json() == prix.REGLES_DEFAUT
    tid = _id(base, "Oppo", "Reno 10", "Batterie")
    base["c"].patch(f"/api/tarifs/{tid}/prix", headers=_h_admin(), json={"prix_fournisseur_ht": 20})
    h = base["c"].get("/api/tarifs/historique", headers=_h_admin(), params={"table": "tarifs", "ligne_id": tid}).json()
    assert sorted((x["colonne"], x["source"]) for x in h) == [("prix_client", "manuel"), ("prix_fournisseur_ht", "manuel")]
    assert h[0]["id"] > h[1]["id"] and h[0]["lot_id"] == h[1]["lot_id"]   # plus récent d'abord, un seul lot
    assert base["c"].get("/api/tarifs/historique", headers=_h_admin(), params={"table": "tickets"}).status_code == 400
    lots = base["c"].get("/api/tarifs/historique/lots", headers=_h_admin()).json()
    assert lots[0]["lot_id"] == h[0]["lot_id"] and lots[0]["annule"] is False


def test_reel_saisie_manuelle_verrouille(base):
    r = _post(base, "/api/tarifs/ligne", json={"marque": "Pytest", "modele": "Phone 7", "type_piece": "Ecran",
                                               "qualite": "OLED", "prix_client": 149})
    assert r.status_code == 200, r.text
    ligne = r.json()
    assert (ligne["prix_client"], ligne["verrou_manuel"], ligne["prix_source"]) == (149, True, "manuel")
    assert _post(base, "/api/tarifs/ligne", json={"marque": "pytest", "modele": "phone 7", "type_piece": "Ecran",
                                                  "qualite": "oled", "prix_client": 1}).status_code == 409
    # HT seul sur une pièce verrouillée : le prix client ne bouge pas
    r = base["c"].patch(f"/api/tarifs/{ligne['id']}/prix", headers=_h_admin(), json={"prix_fournisseur_ht": 50})
    assert r.json()["prix_client"] == 149 and r.json()["prix_fournisseur_ht"] == 50
    tid = _id(base, "Oppo", "Reno 10", "Batterie")
    r = base["c"].patch(f"/api/tarifs/{tid}/prix", headers=_h_admin(), json={"prix_fournisseur_ht": 20})
    assert (r.json()["prix_client"], r.json()["verrou_manuel"]) == (89, False)


def test_reel_grilles_de_vente_par_le_moteur_de_prix(base):
    it = _sql(base, "SELECT id, prix_1, prix_maj_le FROM iphone_tarifs WHERE prix_1 > 0 ORDER BY id LIMIT 1")[0]
    r = base["c"].patch(f"/api/iphone-tarifs/{it['id']}", headers=_h_admin(), json={"prix_1": it["prix_1"] + 10,
                                                                                      "grade": "Pytest"})
    assert r.status_code == 200, r.text
    apres = _sql(base, "SELECT prix_1, grade, prix_maj_le FROM iphone_tarifs WHERE id = %s", it["id"])[0]
    assert apres["prix_1"] == it["prix_1"] + 10 and apres["grade"] == "Pytest" and apres["prix_maj_le"] > it["prix_maj_le"]
    r = _post(base, "/api/smartphones-tarifs", json={"slug": "pytest-phone", "marque": "Pytest", "modele": "P1",
                                                     "prix_1": 199, "stockage_1": "128 Go"})
    assert r.status_code == 200, r.text
    assert r.json()["prix_1"] == 199 and r.json()["prix_maj_le"]
    sid = r.json()["id"]
    r = base["c"].patch(f"/api/smartphones-tarifs/{sid}", headers=_h_admin(), json={"prix_1": 209})
    assert r.json()["prix_1"] == 209
    assert _post(base, "/api/smartphones-tarifs", json={"slug": "pytest-phone", "marque": "Pytest", "modele": "P1",
                                                        "prix_1": 219}).json()["id"] == sid
    h = _sql(base, "SELECT nouveau FROM tarifs_historique WHERE table_nom = 'smartphones_tarifs' AND ligne_id = %s "
                   "ORDER BY id", sid)
    assert [x["nouveau"] for x in h] == [199, 209, 219]


def test_reel_sante_des_prix(base):
    r = base["c"].get("/api/tarifs/sante", headers=_h_staff())
    assert r.status_code == 200, r.text
    s = r.json()
    assert (s["total"], s["estimes"], s["perimes"], s["a_revoir"], s["marges_faibles"]) == (1251, 1251, 1251, 0, 0)
    assert s["propositions_en_attente"] == 0 and set(s["lcdphone"]) == {"derniere_synchro", "ok"}
    tid = _id(base, "Oppo", "Reno 10", "Ecran", "Original")
    _sql(base, "UPDATE tarifs SET prix_maj_le = NOW() - INTERVAL '100 days', prix_client = 70 WHERE id = %s", tid)
    with base["cur"]() as cur:
        assert prix.creer_proposition(cur, f"tarifs:{tid}", 60, "commande", "pytest") is not None
    s = base["c"].get("/api/tarifs/sante", headers=_h_staff()).json()
    assert (s["a_revoir"], s["perimes"], s["marges_faibles"], s["propositions_en_attente"]) == (1, 1250, 1, 1)


def test_reel_creer_proposition(base):
    tid = _id(base, "Oppo", "Reno 10", "Batterie")
    with base["cur"]() as cur:
        assert prix.creer_proposition(cur, f"tarifs:{tid}", "9,80", "commande", "pytest") is None   # ≤ 1 €
        assert prix.creer_proposition(cur, "tarifs:999999", 20, "commande", "pytest") is None
        assert prix.creer_proposition(cur, "tickets:1", 20, "commande", "pytest") is None
        p1 = prix.creer_proposition(cur, f"tarifs:{tid}", 12.5, "commande", "pytest", 41)
        p2 = prix.creer_proposition(cur, f"tarifs:{tid}", 13, "commande", "pytest", 42)
        a = prix.creer_proposition(cur, "tarifs_apple_devices:5:batterie_prix_ht", 20, "commande", "pytest")
    assert p1 == p2 and a
    rows = _sql(base, "SELECT tarif_cle, ancien_ht, nouveau_ht, commande_id, statut FROM tarifs_propositions "
                      "ORDER BY id")
    assert rows == [
        {"tarif_cle": f"tarifs:{tid}", "ancien_ht": Decimal("9.00"), "nouveau_ht": Decimal("13.00"), "commande_id": 42,
         "statut": "en_attente"},
        {"tarif_cle": "tarifs_apple_devices:5:batterie", "ancien_ht": Decimal("13.90"), "nouveau_ht": Decimal("20.00"),
         "commande_id": None, "statut": "en_attente"}]
    assert _tarif(base, tid)["prix_fournisseur_ht"] == Decimal("9.00")   # jamais d'écriture du prix


# ─── Lot 3 : import de fichier fournisseur ─────────────────────

def _apercu(base, nom, cible="tarifs", fournisseur="Mobilax", contenu=None, **data):
    r = _post(base, "/api/tarifs/import-fichier/apercu",
              files={"fichier": (nom, contenu if contenu is not None else _texte(nom))},
              data={"fournisseur": fournisseur, "cible": cible, **data})
    assert r.status_code == 200, r.text
    return r.json()


def _appliquer(base, import_id, **corps):
    return _post(base, f"/api/tarifs/import-fichier/{import_id}/appliquer", json=corps)


def test_reel_apercu_n_ecrit_rien_et_reconnait_les_lignes(base):
    avant, n = _empreinte(base), _n_historique(base)
    ap = _apercu(base, "prix_fournisseur_mobilax.csv")
    assert (_empreinte(base), _n_historique(base)) == (avant, n)
    rec = {x["n"]: x for x in ap["reconnues"]}
    reno = _id(base, "Oppo", "Reno 10", "Ecran", "Original")
    assert rec[4]["cle"] == f"tarifs:{reno}" and rec[4]["nouveau_ht"] == 54.9 and rec[4]["coche"] is True
    assert rec[5]["cle"] == f"tarifs:{_id(base, 'Apple', 'iPhone 16 Pro Max', 'Ecran', 'OLED')}"
    assert rec[5]["change"] is False                                          # même prix : confirmé
    assert rec[6]["cle"] == f"tarifs:{_id(base, 'Apple', 'iPhone 12 / 12 Pro', 'Batterie')}"
    assert rec[7]["alerte"] == "variation" and rec[7]["coche"] is False      # 95 → 1 234,50 : décochée
    assert rec[8]["cle"] == f"tarifs:{_id(base, 'OnePlus', 'Nord CE 4 Lite', 'Ecran', 'Original')}"
    nouvelles = {x["n"]: x for x in ap["nouvelles"]}
    assert (nouvelles[9]["marque"], nouvelles[9]["modele"], nouvelles[9]["type_piece"]) == (
        "Samsung", "Galaxy S99 Ultra", "Batterie")
    assert nouvelles[12]["modele"] == "Poco X6"                               # jamais le X6 Pro
    assert {x["n"]: x["raison"] for x in ap["non_reconnues"]} == {10: "type de pièce non reconnu"}
    assert ap["invalides"] == [] and ap["resume"]["ignorees"] == 1           # « ECRANS IPHONE » sans prix
    assert all(not a["cle"].startswith("tarifs_apple") for a in ap["absentes"])
    statut = _sql(base, "SELECT statut, fournisseur, cible, par FROM tarifs_imports WHERE id = %s", ap["import_id"])
    assert statut == [{"statut": "apercu", "fournisseur": "Mobilax", "cible": "tarifs", "par": ADMIN}]


def test_reel_import_applique_idempotent_ids_stables_et_annulable(base):
    avant, n_lignes = _empreinte(base), _sql(base, "SELECT count(*) AS n FROM tarifs")[0]["n"]
    ap = _apercu(base, "prix_fournisseur_mobilax.csv")
    coches = [x["n"] for x in ap["reconnues"] if x["coche"]]
    r = _appliquer(base, ap["import_id"], lignes=coches, nouvelles=[9])
    assert r.status_code == 200, r.text
    res = r.json()
    assert (res["modifies"], res["ajoutes"], res["confirmes"], res["verrouilles"], res["obsoletes"]) == (3, 1, 1, 0, 0)
    reno = _tarif(base, _id(base, "Oppo", "Reno 10", "Ecran", "Original"))
    assert (reno["prix_fournisseur_ht"], reno["prix_client"], reno["prix_source"], reno["ref_fournisseur"]) == (
        Decimal("54.90"), 129, "import", "MX-REN10-OR")
    s99 = _tarif(base, _id(base, "Samsung", "Galaxy S99 Ultra", "Batterie"))
    assert (s99["prix_client"], s99["prix_source"], s99["categorie"]) == (89, "import", "standard")
    confirme = _tarif(base, _id(base, "Apple", "iPhone 16 Pro Max", "Ecran", "OLED"))
    assert confirme["prix_source"] == "import" and confirme["prix_maj_le"].year == 2026 and confirme["prix_maj_le"].month >= 10
    assert _appliquer(base, ap["import_id"], lignes=coches).status_code == 409   # aperçu déjà appliqué
    # Deuxième import du même fichier : 0 changement, aucun id nouveau
    ids = [r["id"] for r in _sql(base, "SELECT id FROM tarifs ORDER BY id")]
    ap2 = _apercu(base, "prix_fournisseur_mobilax.csv")
    assert ap2["resume"]["a_modifier"] == 1 and ap2["resume"]["nouvelles"] == 1   # l'écran S23 décoché, le X6
    res2 = _appliquer(base, ap2["import_id"], lignes=[x["n"] for x in ap2["reconnues"] if x["coche"]]).json()
    assert (res2["modifies"], res2["ajoutes"]) == (0, 0)
    assert [r["id"] for r in _sql(base, "SELECT id FROM tarifs ORDER BY id")] == ids
    # Annuler le premier import : HT, prix client, date, source, référence d'avant ; la pièce créée devient obsolète
    r = _post(base, f"/api/tarifs/historique/annuler-lot/{res['lot_id']}").json()
    assert r["restaures"] > 0 and r["crees_retires"] == 1 and r["conflits"] == []
    _sql(base, "DELETE FROM tarifs WHERE id = %s", s99["id"])   # base de test : retour à la photo du départ
    assert _empreinte(base) == avant and _sql(base, "SELECT count(*) AS n FROM tarifs")[0]["n"] == n_lignes


def test_reel_import_ligne_invalide_refus_total(base):
    avant, n = _empreinte(base), _n_historique(base)
    ap = _apercu(base, "prix_fournisseur_invalide.csv")
    assert [x["n"] for x in ap["invalides"]] == [3] and len(ap["reconnues"]) == 2
    r = _appliquer(base, ap["import_id"], lignes=[2, 4])
    assert r.status_code == 422 and "invalide" in r.json()["detail"]
    assert (_empreinte(base), _n_historique(base)) == (avant, n)
    # Erreur dans les choix (ligne inconnue) : rien non plus
    assert _appliquer(base, ap["import_id"], lignes=[2, 99], ignorer_invalides=True).status_code == 422
    assert (_empreinte(base), _n_historique(base)) == (avant, n)
    # Confirmation explicite : les lignes valides seulement
    res = _appliquer(base, ap["import_id"], lignes=[2, 4], ignorer_invalides=True).json()
    assert res["modifies"] == 2


def test_reel_import_verrou_jamais_modifie_et_absentes_jamais_supprimees(base):
    reno = _id(base, "Oppo", "Reno 10", "Ecran", "Original")
    _sql(base, "UPDATE tarifs SET verrou_manuel = TRUE WHERE id = %s", reno)
    avant_reno = _tarif(base, reno)
    ap = _apercu(base, "prix_fournisseur_mobilax.csv")
    ligne = next(x for x in ap["reconnues"] if x["cle"] == f"tarifs:{reno}")
    assert ligne["verrou"] is True and ligne["alerte"] == "verrou" and ligne["coche"] is False
    # Absentes : seulement ce que le fichier couvre (écrans Oppo « Original », batteries Apple…)
    absente = _id(base, "Oppo", "Reno 8", "Ecran", "Original")
    hors_fichier = _id(base, "Oppo", "Reno 10", "Batterie")       # aucune batterie Oppo dans le fichier
    cles_absentes = {a["cle"] for a in ap["absentes"]}
    assert f"tarifs:{absente}" in cles_absentes and f"tarifs:{hors_fichier}" not in cles_absentes
    assert f"tarifs:{_id(base, 'Oppo', 'Reno 10', 'Ecran', 'Incell')}" not in cles_absentes   # autre qualité
    assert sum(ap["resume"]["absentes_par_type"].values()) == len(ap["absentes"])
    n = _sql(base, "SELECT count(*) AS n FROM tarifs")[0]["n"]
    res = _appliquer(base, ap["import_id"], lignes=[x["n"] for x in ap["reconnues"]], marquer_obsoletes=True,
                     associations=[]).json()
    assert res["verrouilles"] == 1 and res["obsoletes"] == len(ap["absentes"]) > 0
    assert _tarif(base, reno) == avant_reno
    assert _sql(base, "SELECT count(*) AS n FROM tarifs")[0]["n"] == n            # rien de supprimé
    assert _tarif(base, absente)["obsolete"] is True and _tarif(base, hors_fichier)["obsolete"] is False
    assert absente not in {t["id"] for t in base["c"].get("/api/tarifs", headers=_h_staff()).json()}
    r = _post(base, f"/api/tarifs/historique/annuler-lot/{res['lot_id']}").json()
    assert r["obsoletes_retablis"] == res["obsoletes"] and _tarif(base, absente)["obsolete"] is False


def test_reel_import_xlsx_nom_groupe_deplie_et_association_manuelle(base):
    i12 = _sql(base, "INSERT INTO tarifs (marque, modele, type_piece, qualite, prix_fournisseur_ht, prix_client) "
                     "VALUES ('Apple', 'iPhone 12', 'Ecran', 'LCD', 20, 89), ('Apple', 'iPhone 12 Pro', 'Ecran', 'LCD', 20, 89) "
                     "RETURNING id")
    ap = _apercu(base, "prix_fournisseur_utopya.xlsx", fournisseur="Utopya")
    assert ap["mapping"]["prix_ht"] == "PU HT (€)"
    rec = {}
    for x in ap["reconnues"]:
        rec.setdefault(x["n"], set()).add(x["cle"])
    assert rec[4] == {f"tarifs:{i12[0]['id']}", f"tarifs:{i12[1]['id']}"}           # « iPhone 12/12 Pro » déplié
    assert rec[5] == {f"tarifs:{_id(base, 'Oppo', 'Reno 10', 'Batterie')}"}         # « Reno10 »
    a54 = _id(base, "Samsung", "Galaxy A54", "Connecteur de charge")
    assert rec[6] == {f"tarifs:{a54}"}
    res = _appliquer(base, ap["import_id"], lignes=[4, 5, 6]).json()
    assert res["modifies"] == 4
    t = _tarif(base, i12[0]["id"])
    assert (t["prix_fournisseur_ht"], t["fournisseur"], t["ref_fournisseur"]) == (Decimal("21.50"), "Utopya", "UT-0001")
    assert _tarif(base, a54)["prix_fournisseur_ht"] == Decimal("8.40")
    # Mapping mémorisé pour ce fournisseur
    assert json.loads(_sql(base, "SELECT valeur FROM params WHERE cle = 'IMPORT_MAPPING_UTOPYA'")[0]["valeur"]
                      )["prix_ht"] == "PU HT (€)"
    # Association manuelle d'une ligne non reconnue
    csv_ = "Désignation;Prix HT\nPièce mystère 3000;7,00\n".encode()
    ap = _apercu(base, "m.csv", contenu=csv_)
    assert ap["non_reconnues"][0]["n"] == 2
    cible = _id(base, "Oppo", "Reno 10", "Connecteur de charge")
    res = _appliquer(base, ap["import_id"], associations=[{"n": 2, "cle": f"tarifs:{cible}"}]).json()
    assert res["modifies"] == 1 and _tarif(base, cible)["prix_fournisseur_ht"] == Decimal("7.00")
    ap = _apercu(base, "m.csv", contenu=csv_)
    assert _appliquer(base, ap["import_id"], associations=[{"n": 2, "cle": "tarifs_apple_devices:1:ecran"}]
                      ).status_code == 422


def test_reel_import_ipad_macbook(base):
    ap = _apercu(base, "prix_apple_devices.csv", cible="tarifs_apple_devices")
    rec = {x["n"]: x for x in ap["reconnues"]}
    ipad9 = _sql(base, "SELECT id FROM tarifs_apple_devices WHERE modele LIKE 'iPad 9 (2021)%%'")[0]["id"]
    mba = _sql(base, "SELECT id FROM tarifs_apple_devices WHERE modele LIKE 'MacBook Air 13\" M1 A2337%%'")[0]["id"]
    assert rec[2]["cle"] == f"tarifs_apple_devices:{ipad9}:ecran" and rec[2]["nouveau_client"] == 169
    assert rec[3]["cle"] == f"tarifs_apple_devices:{ipad9}:batterie" and rec[3]["change"] is False
    assert rec[4]["cle"] == f"tarifs_apple_devices:{mba}:batterie" and rec[4]["alerte"] == "variation"
    assert [x["n"] for x in ap["nouvelles"]] == [5] and ap["nouvelles"][0]["categorie"] == "ipad"
    res = _appliquer(base, ap["import_id"], lignes=[2, 3], nouvelles=[5]).json()
    assert (res["modifies"], res["confirmes"], res["ajoutes"]) == (1, 0, 1)
    d = _sql(base, "SELECT ecran_prix_ht, ecran_prix_vente, batterie_prix_ht, prix_source FROM tarifs_apple_devices "
                   "WHERE id = %s", ipad9)[0]
    assert d == {"ecran_prix_ht": Decimal("45.50"), "ecran_prix_vente": 169, "batterie_prix_ht": Decimal("13.90"),
                 "prix_source": "import"}


def test_reel_import_1202_lignes_moins_de_5_s(base):
    lignes = _sql(base, "SELECT id, nom_fournisseur, prix_fournisseur_ht FROM tarifs ORDER BY id")
    sortie = io.StringIO()
    sortie.write("Référence;Désignation;Prix HT\n")
    for t in lignes:
        ht = (t["prix_fournisseur_ht"] * Decimal("1.05")).quantize(Decimal("0.01"))
        sortie.write(f"MX{t['id']:05d};{t['nom_fournisseur']};{str(ht).replace('.', ',')}\n")
    contenu = sortie.getvalue().encode("utf-8")
    debut = time.perf_counter()
    ap = _apercu(base, "complet.csv", contenu=contenu)
    duree_apercu = time.perf_counter() - debut
    cles = {x["cle"] for x in ap["reconnues"]}
    assert len(cles) == 1202 and not ap["nouvelles"] and not ap["non_reconnues"] and not ap["absentes"]
    debut = time.perf_counter()
    res = _appliquer(base, ap["import_id"], lignes=[x["n"] for x in ap["reconnues"]]).json()
    duree = time.perf_counter() - debut
    assert res["modifies"] + res["confirmes"] == 1202 and res["modifies"] > 1100
    assert duree_apercu < 5 and duree < 5, (duree_apercu, duree)
    attendu = {t["id"]: (t["prix_fournisseur_ht"] * Decimal("1.05")).quantize(Decimal("0.01")) for t in lignes}
    for t in _sql(base, "SELECT id, prix_fournisseur_ht, prix_client, type_piece, categorie, ref_fournisseur FROM tarifs"):
        assert t["prix_fournisseur_ht"] == attendu[t["id"]] and t["ref_fournisseur"] == f"MX{t['id']:05d}"
        assert t["prix_client"] == tarifs.calcul_prix_client(float(t["prix_fournisseur_ht"]), t["type_piece"], t["categorie"])
    # Deuxième passage : les références suffisent, 0 changement
    ap = _apercu(base, "complet.csv", contenu=contenu)
    assert {x["niveau"] for x in ap["reconnues"]} == {"ref"} and ap["resume"]["a_modifier"] == 0


def test_reel_import_libelles_fournisseur_reconnus(base):
    """« Ecran complet », « LCD + Tactile », « avec châssis », « Lentille caméra arrière »,
    « iPhone 12 / 12 Pro » : chaque ligne vise la bonne pièce, aucune ne finit nouvelle ni non reconnue."""
    ap = _apercu(base, "prix_fournisseur_libelles.csv")
    attendu = {
        2: _id(base, "Samsung", "Galaxy A25", "Ecran", "Original"),
        3: _id(base, "Samsung", "Galaxy A12", "Ecran", "LCD"),
        4: _id(base, "Apple", "iPhone 13", "Ecran", "Soft OLED"),
        5: _id(base, "Apple", "iPhone 15 Pro Max", "Vitre camera arriere"),
        6: _id(base, "Apple", "iPhone 12 / 12 Pro", "Vitre arriere"),
        7: _id(base, "Apple", "iPhone 12 / 12 Pro", "Ecran", "Incell"),
        8: _id(base, "Apple", "iPhone 13", "Camera arriere"),
        9: _id(base, "Oppo", "Reno 10", "Batterie"),
    }
    rec = {}
    for x in ap["reconnues"]:
        rec.setdefault(x["n"], set()).add(x["cle"])
    assert rec == {n: {f"tarifs:{i}"} for n, i in attendu.items()}
    assert {x["n"]: x["raison"] for x in ap["non_reconnues"]} == {10: "type de pièce non reconnu"}   # l'adhésif
    assert [(x["n"], x["type_piece"], x["modele"]) for x in ap["nouvelles"]] == [(11, "Camera avant", "iPhone 13")]
    # Absentes : uniquement les types de pièce du fichier (jamais les connecteurs, haut-parleurs…)
    types = {a["type_piece"] for a in ap["absentes"]}
    assert types and types <= {"Ecran", "Vitre camera arriere", "Vitre arriere", "Camera arriere", "Batterie"}
    cles_absentes = {a["cle"] for a in ap["absentes"]}
    assert f"tarifs:{_id(base, 'Samsung', 'Galaxy A25', 'Batterie')}" not in cles_absentes   # batteries Samsung : hors fichier
    assert f"tarifs:{_id(base, 'Oppo', 'Reno 8', 'Ecran', 'Original')}" not in cles_absentes  # écrans Oppo : hors fichier
    res = _appliquer(base, ap["import_id"], lignes=[n for n in attendu]).json()
    assert res["modifies"] + res["confirmes"] == len(attendu) and res["ajoutes"] == 0
    assert _tarif(base, attendu[7])["prix_fournisseur_ht"] == Decimal("36.00")
    assert _tarif(base, attendu[7])["ref_fournisseur"] == "LB-I12-IN"


def test_reel_import_ipad_libelles_et_absentes_par_piece(base):
    contenu = ("Désignation;Prix HT\n"
               "Ecran complet Original pour iPad 9 (2021);45,50\n"
               "Batterie iPad 9 (2021) (avec adhésif);13,90\n"
               "Ecran LCD + Tactile pour iPad 8 (2020) - Noir;33,00\n"
               "Ecran MacBook Air 13 pouces;80,00\n").encode()
    ap = _apercu(base, "ipad.csv", cible="tarifs_apple_devices", contenu=contenu)
    ipad9 = _sql(base, "SELECT id FROM tarifs_apple_devices WHERE modele LIKE 'iPad 9 (2021)%%'")[0]["id"]
    ipad8 = _sql(base, "SELECT id FROM tarifs_apple_devices WHERE modele LIKE 'iPad 8 (2020)%%'")[0]["id"]
    assert {x["n"]: x["cle"] for x in ap["reconnues"]} == {
        2: f"tarifs_apple_devices:{ipad9}:ecran", 3: f"tarifs_apple_devices:{ipad9}:batterie",
        4: f"tarifs_apple_devices:{ipad8}:ecran"}
    # Trois MacBook Air 13" que seule leur référence distingue : aucun n'est visé, la ligne s'associe à la main
    assert [(x["n"], x["raison"].split(" :")[0]) for x in ap["non_reconnues"]] == [(5, "plusieurs modèles possibles")]
    assert ap["nouvelles"] == []
    # Écrans et batteries d'iPad couverts : iPad absents ; MacBook (non couverts) jamais absents
    ids_macbook = {r["id"] for r in _sql(base, "SELECT id FROM tarifs_apple_devices WHERE categorie = 'macbook'")}
    absentes = {prix.parse_tarif_cle(a["cle"])[1] for a in ap["absentes"]}
    ipad5 = _sql(base, "SELECT id FROM tarifs_apple_devices WHERE modele = 'iPad 5 (2017)'")[0]["id"]
    assert ipad5 in absentes and not absentes & ids_macbook
    assert ipad8 not in absentes and ipad9 not in absentes   # une de leurs pièces est dans le fichier


def test_reel_absentes_limitees_aux_types_de_piece_du_fichier(base):
    contenu = "Désignation;Prix HT\nEcran Original Oppo Reno10;52,00\n".encode()
    ap = _apercu(base, "ecrans.csv", contenu=contenu)
    oppo_ecrans_orig = {f"tarifs:{r['id']}" for r in _sql(
        base, "SELECT id FROM tarifs WHERE marque = 'Oppo' AND type_piece = 'Ecran' AND qualite = 'Original' "
              "AND modele <> 'Reno 10'")}
    assert {a["cle"] for a in ap["absentes"]} == oppo_ecrans_orig
    assert ap["resume"]["absentes_par_type"] == {"Ecran": len(oppo_ecrans_orig)}
    res = _appliquer(base, ap["import_id"], lignes=[2], marquer_obsoletes=True).json()
    assert res["obsoletes"] == len(oppo_ecrans_orig)
    assert _sql(base, "SELECT count(*) AS n FROM tarifs WHERE obsolete AND (marque <> 'Oppo' OR type_piece <> 'Ecran' "
                      "OR qualite <> 'Original')")[0]["n"] == 0                     # batteries, connecteurs… intacts


def test_reel_annuler_le_lot_d_une_proposition_acceptee_la_rouvre(base):
    tid = _id(base, "Oppo", "Reno 10", "Batterie")
    avant = _tarif(base, tid)
    with base["cur"]() as cur:
        pid = prix.creer_proposition(cur, f"tarifs:{tid}", "12,50", "commande", "pytest", 77)
    r = _post(base, f"/api/tarifs/propositions/{pid}/accepter")
    assert r.status_code == 200, r.text
    lot = r.json()["lot_id"]
    p = _sql(base, "SELECT statut, lot_id FROM tarifs_propositions WHERE id = %s", pid)[0]
    assert p == {"statut": "acceptee", "lot_id": lot} and _tarif(base, tid)["prix_fournisseur_ht"] == Decimal("12.50")
    r = _post(base, f"/api/tarifs/historique/annuler-lot/{lot}")
    assert r.status_code == 200, r.text
    assert r.json()["propositions_rouvertes"] == 1 and r.json()["conflits"] == []
    p = _sql(base, "SELECT statut, traite_le, traite_par FROM tarifs_propositions WHERE id = %s", pid)[0]
    assert p == {"statut": "en_attente", "traite_le": None, "traite_par": None}
    apres = _tarif(base, tid)
    assert (apres["prix_fournisseur_ht"], apres["prix_client"], apres["prix_maj_le"], apres["prix_source"]) == (
        avant["prix_fournisseur_ht"], avant["prix_client"], avant["prix_maj_le"], avant["prix_source"])
    # Acceptée de nouveau, puis une autre proposition arrive pour la même pièce : à l'annulation,
    # l'ancienne passe 'annulee' (une seule en attente par pièce)
    lot2 = _post(base, f"/api/tarifs/propositions/{pid}/accepter").json()["lot_id"]
    with base["cur"]() as cur:
        pid2 = prix.creer_proposition(cur, f"tarifs:{tid}", 15, "commande", "pytest", 78)
    assert pid2 != pid
    r = _post(base, f"/api/tarifs/historique/annuler-lot/{lot2}").json()
    assert r["propositions_rouvertes"] == 0
    statuts = {x["id"]: x["statut"] for x in _sql(base, "SELECT id, statut FROM tarifs_propositions")}
    assert statuts == {pid: "annulee", pid2: "en_attente"}


def test_reel_lot_de_regles_sans_effet_liste_et_annulable(base):
    n = _n_historique(base)
    r = _post(base, "/api/tarifs/appliquer", json={"regles": {"seuil_marge_alerte": 35}, "confirmer": True})
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["modifies"] == 0 and _n_historique(base) == n
    params_cache.invalidate()
    assert prix.regles()["seuil_marge_alerte"] == 35
    lots = base["c"].get("/api/tarifs/historique/lots", headers=_h_admin()).json()
    assert {k: lots[0][k] for k in ("lot_id", "source", "valeurs", "annule")} == {
        "lot_id": res["lot_id"], "source": "formule", "valeurs": 0, "annule": False}
    r = _post(base, f"/api/tarifs/historique/annuler-lot/{res['lot_id']}")
    assert r.status_code == 200 and r.json()["regles"] == "retablies"
    params_cache.invalidate()
    assert prix.regles() == prix.REGLES_DEFAUT
    lots = base["c"].get("/api/tarifs/historique/lots", headers=_h_admin()).json()
    assert lots[0]["lot_id"] == res["lot_id"] and lots[0]["annule"] is True


def test_reel_config_ne_modifie_jamais_les_regles_ni_l_etat_du_moteur(base):
    tech = {"Authorization": f"Bearer {create_token('tech', STAFF)}"}
    for h in (tech, _h_staff(), _h_admin()):
        for cle in (prix.CLE_REGLES, "VEILLE_PRIX_DERNIERE", "IMPORT_MAPPING_MOBILAX", prix.FLAG_INITIALISATION):
            r = base["c"].put("/api/config", headers=h, json={"cle": cle, "valeur": '{"autre": 0}'})
            assert r.status_code == 403, r.text
    assert _sql(base, "SELECT count(*) AS n FROM params WHERE cle = ANY(%s)",
                [prix.CLE_REGLES, "VEILLE_PRIX_DERNIERE", "IMPORT_MAPPING_MOBILAX"])[0]["n"] == 0
    params_cache.invalidate()
    assert prix.regles() == prix.REGLES_DEFAUT
    assert _post(base, "/api/tarifs/simuler", json={}).json()["modifies"] == 0
    assert _sql(base, "SELECT valeur FROM params WHERE cle = %s", prix.FLAG_INITIALISATION) == [{"valeur": "1"}]


def test_reel_cadenas_boutique_admin_prouve_seulement(base):
    cle, valeur = config.PARAM_VERROUS_BOUTIQUE, json.dumps({"tarifs_reparation": [10, 9]})
    assert base["c"].put("/api/config", headers=_h_staff(), json={"cle": cle, "valeur": valeur}).status_code == 403
    r = base["c"].put("/api/config", headers=_h_admin(code=False), json={"cle": cle, "valeur": valeur})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "admin_requis"
    assert _sql(base, "SELECT count(*) AS n FROM params WHERE cle = %s", cle)[0]["n"] == 0
    r = base["c"].put("/api/config", headers=_h_admin(), json={"cle": cle, "valeur": valeur})
    assert r.status_code == 200, r.text
    assert _sql(base, "SELECT valeur FROM params WHERE cle = %s", cle) == [{"valeur": '{"tarifs_reparation": [9, 10]}'}]


def test_reel_grille_iphone_date_des_prix_distincte_du_stock(base):
    it = _sql(base, "SELECT id, prix_maj_le, updated_at FROM iphone_tarifs ORDER BY id LIMIT 1")[0]
    r = base["c"].patch(f"/api/iphone-tarifs/{it['id']}", headers=_h_admin(), json={"stock_1": 3})
    assert r.status_code == 200, r.text
    lignes = {x["id"]: x for x in base["c"].get("/api/iphone-tarifs").json()}
    ligne = lignes[it["id"]]
    assert ligne["prix_maj_le"] is not None and isinstance(ligne["age_jours"], int)
    apres = _sql(base, "SELECT prix_maj_le, updated_at FROM iphone_tarifs WHERE id = %s", it["id"])[0]
    assert apres["prix_maj_le"] == it["prix_maj_le"] and apres["updated_at"] > it["updated_at"]
    assert ligne["prix_maj_le"].startswith(it["prix_maj_le"].isoformat()[:19])
