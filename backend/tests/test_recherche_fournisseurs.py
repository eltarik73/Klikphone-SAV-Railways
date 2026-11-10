"""Qualité d'écran cohérente (« Original » = l'officiel seulement), purge des prix faux, catalogue fournisseur et
recherche de tarifs pro (Mobilax et Utopya côte à côte). Aucune base : curseurs simulés, execute_values capturé."""

from decimal import Decimal
from unittest.mock import patch

import pytest

from app.api import fournisseurs as A
from app.api import tarifs as T
from app.services import fournisseurs as F
from app.services import prix as P
from tests.test_securite_c1 import _ADMIN_PROUVE, _headers, fake_db


class _Cur:
    def __init__(self, reponses=None):
        self.sql, self.rowcount, self._reponses = [], 1, reponses or {}

    def execute(self, sql, p=None):
        self.sql.append((" ".join(str(sql).split()), p))

    def fetchall(self):
        s = self.sql[-1][0] if self.sql else ""
        for debut, rows in self._reponses.items():
            if debut in s:
                return rows
        return []

    def fetchone(self):
        return None


# ─── qualite_coherente : vérifié sur les noms réels Mobilax / Utopya du Pixel 6 ───

@pytest.mark.parametrize("qualite, designation, ref, fournisseur, attendu", [
    # Mobilax, Pixel 6 : l'officiel porte la référence Google, le Refurb / Pulled est reconditionné, l'Oled est compatible
    ("Original", "Ecran Tactile Original Google Pixel 6 G949-00175-01 Noir", "1", "Mobilax", True),
    ("Original", "Ecran Tactile Original Refurb Google Pixel 6 Noir", "2", "Mobilax", False),
    ("Original", "Ecran Tactile Original Pulled Google Pixel 6a Noir", "3", "Mobilax", False),
    ("Original", "Ecran Tactile Original Assembled avec Chassis Compatible Apple iPhone 12", "4", "Mobilax", False),
    ("Original", "Ecran Tactile Oled Google Pixel 6 Noir", "5", "Mobilax", False),
    ("Original", "Ecran Tactile Incell Apple iPhone 13", "6", "Mobilax", False),
    ("Reconditionnee", "Ecran Tactile Original Refurb Google Pixel 6 Noir", "2", "Mobilax", True),
    ("Reconditionnee", "Ecran Tactile Original Google Pixel 6 G949-00175-01 Noir", "1", "Mobilax", False),
    ("Compatible", "Ecran Tactile Oled Google Pixel 6 Noir", "5", "Mobilax", True),
    ("Compatible", "Ecran Tactile Original Samsung Galaxy A54 5G", "7", "Mobilax", False),
    ("Compatible", "Ecran Tactile Original Pulled Google Pixel 6a", "3", "Mobilax", False),
    ("OLED", "Ecran Tactile Hard Oled Apple iPhone 13", "8", "Mobilax", True),
    # Utopya, Pixel 6 : « Ecran Complet Google Pixel 6 » (réf. 420921, 97 €) est l'officiel ; (ReLife) 54,91 € est compatible
    ("Original", "Ecran Complet Google Pixel 6", "420921", "Utopya", True),
    ("Original", "Ecran Complet Google Pixel 6 (ReLife)", "GPIX6-EC", "Utopya", False),
    ("Original", "Ecran Complet OLED Google Pixel 6", "213578", "Utopya", False),
    ("Original", "Ecran Complet Google Pixel 8 Pro", "ECN-PIX8P@", "Utopya", False),       # sans étiquette, réf. maison : compatible
    ("Original", "Ecran Complet iPhone 13 (Service Pack)", "102273", "Utopya", True),
    ("Original", "Ecran Complet Noir Galaxy A54 5G (A546B) (Pulled A)", "116607", "Utopya", False),
    ("Compatible", "Ecran Complet Google Pixel 6 (ReLife)", "GPIX6-EC", "Utopya", True),
    ("Compatible", "Ecran Complet Google Pixel 6", "420921", "Utopya", False),               # l'origine n'est pas un compatible
    ("Soft OLED", "Ecran Complet Noir Pixel 6 Pro (Soft OLED)", "EC@-GP6PRBSO", "Utopya", True),
    # Synchro serveur : UTN<id> = référence toute chiffrée (origine), UT<id> = référence maison
    ("Original", "Ecran Complet Vert OnePlus Nord 3 5G", "UTN62832", "Utopya", True),
    ("Original", "Ecran Complet Vert OnePlus Nord 3 5G", "UT62832", "Utopya", False),
    ("Compatible", "Ecran Complet Vert OnePlus Nord 3 5G", "UTN62832", "Utopya", False),
    ("Compatible", "Ecran Complet OnePlus Nord CE 3 Lite 5G (avec châssis)", "UT49204", "Utopya", True),
    # Mots de modèle ou de format qui ne sont pas des qualités (production, 10/11/2026)
    ("Original", "Bloc Écran Complet avec Châssis Original Huawei P Smart Z/Y9 Prime 2019", "3000000002353", "Mobilax", True),
    ("Compatible", "Ecran Tactile Oled avec Châssis Samsung Galaxy A05s A057 (Original Size)", "3000000272138", "Mobilax", True),
    ("OLED", "Ecran Tactile Oled Xiaomi Redmi Note 11 4G/Redmi Note 11S 4G (Original Size)", "3000000147283", "Mobilax", True),
    ("Incell", "Ecran Tactile Incell HD+ Apple iPhone 14 (Original Notch)", "3000000298435", "Mobilax", True),
    ("Original", "Ecran Complet Huawei Y9 Prime 2019", "386090", "Utopya", True),
    ("Original", "Ecran Complet Noir Galaxy A54 5G (Prime)", "123456", "Utopya", False),   # l'étiquette (Prime) reste
    ("Original", "Bloc Écran Complet avec Châssis Original Huawei P30 Pro (Grade A)", "3000000026878", "Mobilax", False),
    # Rien à juger
    (None, "Ecran Tactile Original Refurb", "1", "Mobilax", True),
    ("Original", "", "1", "Mobilax", True),
    ("Original", "Batterie Apple iPhone 13", None, None, True),
])
def test_qualite_coherente(qualite, designation, ref, fournisseur, attendu):
    assert F.qualite_coherente(qualite, designation, ref, fournisseur) is attendu


def test_purger_prix_incoherents_retire_reaffecte_ou_vide(monkeypatch):
    rows = [
        # Pixel 6, ligne Original : le Refurb Mobilax (55 €) y était rangé et retenu ; l'officiel Utopya (97 €) existe
        {"tarif_cle": "tarifs:1", "fournisseur": "Mobilax", "prix_ht": Decimal("55"), "ref_fournisseur": "MX1",
         "designation": "Ecran Tactile Original Refurb Google Pixel 6 Noir"},
        {"tarif_cle": "tarifs:1", "fournisseur": "Utopya", "prix_ht": Decimal("97"), "ref_fournisseur": "420921",
         "designation": "Ecran Complet Google Pixel 6"},
        # Pixel 7, ligne Original : seul un ReLife Utopya, retenu → plus rien de cohérent : prix à renseigner
        {"tarif_cle": "tarifs:2", "fournisseur": "Utopya", "prix_ht": Decimal("60"), "ref_fournisseur": "GPIX7-EC",
         "designation": "Ecran Complet Google Pixel 7 (ReLife)"},
        # Galaxy A54, ligne Original : officiel Mobilax, cohérent, rien à faire
        {"tarif_cle": "tarifs:3", "fournisseur": "Mobilax", "prix_ht": Decimal("80"), "ref_fournisseur": "MX3",
         "designation": "Ecran Tactile Original Samsung Galaxy A54 5G"},
        # Pixel 8, ligne Original : Pulled Mobilax retiré, mais le coût retenu venait d'ailleurs (saisie) : pièce laissée
        {"tarif_cle": "tarifs:4", "fournisseur": "Mobilax", "prix_ht": Decimal("50"), "ref_fournisseur": "MX4",
         "designation": "Ecran Tactile Original Pulled Google Pixel 8"},
        # Batterie : la qualité ne se juge pas
        {"tarif_cle": "tarifs:5", "fournisseur": "Mobilax", "prix_ht": Decimal("9"), "ref_fournisseur": "MX5",
         "designation": "Batterie Original Pulled Apple iPhone 13"},
        # Pièce verrouillée : retirée de la grille comparative, coût laissé
        {"tarif_cle": "tarifs:6", "fournisseur": "Mobilax", "prix_ht": Decimal("40"), "ref_fournisseur": "MX6",
         "designation": "Ecran Tactile Original Refurb Apple iPhone 12"},
    ]
    cur = _Cur({"FROM tarifs_fournisseurs_prix WHERE tarif_cle LIKE": rows})
    descs = {
        "tarifs:1": {"cle": "tarifs:1", "table": "tarifs", "id": 1, "type_piece": "Ecran", "qualite": "Original", "ht": Decimal("55"),
                     "fournisseur": "Mobilax", "fournisseur_choisi": None, "verrou": False, "obsolete": False},
        "tarifs:2": {"cle": "tarifs:2", "table": "tarifs", "id": 2, "type_piece": "Ecran", "qualite": "Original", "ht": Decimal("60"),
                     "fournisseur": "Utopya", "fournisseur_choisi": None, "verrou": False, "obsolete": False},
        "tarifs:3": {"cle": "tarifs:3", "table": "tarifs", "id": 3, "type_piece": "Ecran", "qualite": "Original", "ht": Decimal("80"),
                     "fournisseur": "Mobilax", "fournisseur_choisi": None, "verrou": False, "obsolete": False},
        "tarifs:4": {"cle": "tarifs:4", "table": "tarifs", "id": 4, "type_piece": "Ecran", "qualite": "Original", "ht": Decimal("70"),
                     "fournisseur": None, "fournisseur_choisi": None, "verrou": False, "obsolete": False},
        "tarifs:5": {"cle": "tarifs:5", "table": "tarifs", "id": 5, "type_piece": "Batterie", "qualite": None, "ht": Decimal("9"),
                     "fournisseur": "Mobilax", "fournisseur_choisi": None, "verrou": False, "obsolete": False},
        "tarifs:6": {"cle": "tarifs:6", "table": "tarifs", "id": 6, "type_piece": "Ecran", "qualite": "Original", "ht": Decimal("40"),
                     "fournisseur": "Mobilax", "fournisseur_choisi": None, "verrou": True, "obsolete": False},
    }
    monkeypatch.setattr(P, "regles", lambda c=None: {"tva": 1.2})
    monkeypatch.setattr(P, "decrire_tarifs", lambda c, cles, r=None: {k: v for k, v in descs.items() if k in cles})
    restants = {"tarifs:1": {"Utopya": {"ht": 97.0, "ref": "420921", "url": "https://www.utopya.fr/p6", "en_stock": False}}, "tarifs:2": {}}
    monkeypatch.setattr(P, "prix_fournisseurs", lambda c, cles: {k: restants.get(k, {}) for k in cles})
    monkeypatch.setattr(F, "preference", lambda cur=None: "Mobilax")
    appliques, notes, vides = [], [], []
    monkeypatch.setattr(P, "appliquer_ht", lambda c, cle, ht, source, par, lot=None, r=None: appliques.append((cle, ht, source, par)) or {"ok": True})
    monkeypatch.setattr(P, "noter_fournisseur_retenu", lambda c, cle, cible: notes.append((cle, cible["fournisseur"])))
    monkeypatch.setattr(P, "vider_prix", lambda c, cle, par, lot=None: vides.append((cle, par, lot)) or {"ecrits": [1], "verrouilles": []})
    res = F.purger_prix_incoherents(cur, "Synchro Mobilax")
    assert res["examines"] == 7 and res["supprimes"] == 4 and res["reassignees"] == 1 and res["videes"] == 1 and res["lot_id"]
    supprimes = [p for s, p in cur.sql if s.startswith("DELETE FROM tarifs_fournisseurs_prix")]
    assert sorted(supprimes) == [("tarifs:1", "Mobilax"), ("tarifs:2", "Utopya"), ("tarifs:4", "Mobilax"), ("tarifs:6", "Mobilax")]
    # Pixel 6 : l'officiel Utopya (97 €, en rupture mais seul écran officiel) remplace le Refurb, même plus cher
    assert appliques == [("tarifs:1", Decimal("97.0"), "utopya", "Synchro Mobilax")] and notes == [("tarifs:1", "Utopya")]
    # Pixel 7 : plus aucun écran officiel connu → prix à renseigner (jamais un prix faux gardé)
    assert vides == [("tarifs:2", "Synchro Mobilax", res["lot_id"])]
    # Rien d'incohérent : rien ne bouge
    cur2 = _Cur({"FROM tarifs_fournisseurs_prix WHERE tarif_cle LIKE": [rows[3]]})
    assert F.purger_prix_incoherents(cur2, "x") == {"examines": 1, "supprimes": 0, "reassignees": 0, "videes": 0, "lot_id": None}
    assert F.purger_prix_incoherents(_Cur(), "x")["examines"] == 0


def test_vider_prix_remet_la_piece_a_renseigner(monkeypatch):
    cur = _Cur()
    ecrits = []
    monkeypatch.setattr(P, "ecrire_prix_lot", lambda c, table, ch, source, par, lot=None, **kw: ecrits.append((table, ch, source, par, lot)) or {"ecrits": [(5, "prix_fournisseur_ht", Decimal("55"), Decimal("0"))], "verrouilles": [], "inchanges": 0, "absents": []})
    res = P.vider_prix(cur, "tarifs:5", "admin", "lot-1")
    assert ecrits == [("tarifs", [(5, "prix_fournisseur_ht", 0), (5, "prix_client", 0)], "import", "admin", "lot-1")]
    assert res["ecrits"] and cur.sql[-1][0].startswith("UPDATE tarifs SET prix_source = 'a_renseigner', prix_maj_le = NULL, fournisseur = NULL")
    assert cur.sql[-1][1] == (5,)
    with pytest.raises(ValueError):
        P.vider_prix(cur, "tarifs_apple_devices:3:ecran", "admin")
    # Pièce verrouillée : rien de plus que l'écriture refusée
    monkeypatch.setattr(P, "ecrire_prix_lot", lambda *a, **kw: {"ecrits": [], "verrouilles": [5], "inchanges": 0, "absents": []})
    n = len(cur.sql)
    P.vider_prix(cur, "tarifs:5", "admin")
    assert len(cur.sql) == n


# ─── Catalogue fournisseur ───────────────────────────────────────

def test_enregistrer_catalogue_et_recherche(monkeypatch):
    appels = []
    monkeypatch.setattr(P, "execute_values", lambda cur, sql, lignes, **kw: appels.append((" ".join(sql.split()), lignes, kw)))
    lignes = [
        {"reference": "MX1", "designation": "Ecran Tactile Original Refurb Google Pixel 6 Noir", "marque": "Google", "modele": "Google Pixel 6",
         "type_piece": "Ecran", "qualite": "Reconditionnee", "prix_ht": Decimal("55.00"), "en_stock": True, "url": "https://www.mobilax.fr/x"},
        {"reference": "MX1", "designation": "doublon même référence", "prix_ht": 1},
        {"reference": "MX2", "designation": "Nappe Power On/Off Google Pixel 6", "type_piece": "Bouton power", "qualite": "", "prix_ht": None, "en_stock": False},
        {"reference": "", "designation": "sans référence", "prix_ht": 3},
        "bruit",
    ]
    reconnues = [{"ref": "MX1", "cle": "tarifs:12"}, {"ref": "MX1", "cle": "tarifs:13"}, {"ref": "ZZ", "cle": "tarifs:1"}]
    assert P.enregistrer_catalogue(None, "mobilax", "mobilax", lignes, reconnues) == 2
    sql, valeurs, kw = appels[0]
    assert sql.startswith("INSERT INTO fournisseurs_catalogue") and "ON CONFLICT (fournisseur, ref) DO UPDATE" in sql
    assert valeurs[0][:4] == ("Mobilax", "MX1", "Ecran Tactile Original Refurb Google Pixel 6 Noir", Decimal("55.00"))
    assert valeurs[0][4:11] == (True, "https://www.mobilax.fr/x", "Google", "Google Pixel 6", "Ecran", "Reconditionnee", "tarifs:12")
    assert valeurs[0][11] == "google google pixel 6 ecran tactile original refurb google pixel 6 noir ecran reconditionnee"
    assert valeurs[0][12:] == ("mobilax", Decimal("55.00"))
    assert valeurs[1][:5] == ("Mobilax", "MX2", "Nappe Power On/Off Google Pixel 6", None, False) and valeurs[1][10] is None
    assert P.enregistrer_catalogue(None, "", "x", lignes) == 0 and P.enregistrer_catalogue(None, "Utopya", "x", []) == 0
    # Recherche : chaque mot (sans accents) doit être dans le texte ; filtre de type côté Python
    rows = [{"fournisseur": "Mobilax", "ref": "MX1", "nom": "Ecran Tactile Original Refurb Google Pixel 6 Noir", "prix_ht": Decimal("55"),
             "en_stock": True, "url": None, "marque": "Google", "modele": "Google Pixel 6", "type_piece": "Ecran", "qualite": "Reconditionnee",
             "tarif_cle": "tarifs:12", "vu_le": None, "prix_maj_le": None},
            {"fournisseur": "Utopya", "ref": "U2", "nom": "Batterie Google Pixel 6", "prix_ht": None, "en_stock": False, "url": None,
             "marque": "Google", "modele": "Pixel 6", "type_piece": "Batterie", "qualite": None, "tarif_cle": None, "vu_le": None, "prix_maj_le": None}]
    cur = _Cur({"FROM fournisseurs_catalogue WHERE": rows})
    out = P.rechercher_catalogue(cur, "Pixel 6 écran")
    sql, params = cur.sql[-1]
    assert sql.count("recherche LIKE %s") == 3 and params[:3] == ["%pixel%", "%6%", "%ecran%"] and params[-1] == 200
    assert [o["ref"] for o in out] == ["MX1", "U2"] and out[0]["prix_ht"] == 55.0 and out[1]["prix_ht"] is None
    assert [o["ref"] for o in P.rechercher_catalogue(cur, "pixel 6", type_piece="batterie")] == ["U2"]
    assert P.rechercher_catalogue(cur, "p") == [] and P.rechercher_catalogue(cur, "") == []
    out = P.rechercher_catalogue(cur, "pixel 6", fournisseurs=["utopya"], limite=9999)
    assert "fournisseur = ANY(%s)" in cur.sql[-1][0] and cur.sql[-1][1][-2] == ["Utopya"] and cur.sql[-1][1][-1] == 500
    # Nettoyage après un passage complet
    cur = _Cur()
    cur.rowcount = 12
    assert P.purger_catalogue(cur, "Utopya", 1800.5) == 12 and cur.sql[-1][1] == ("Utopya", 1800.5)
    assert P.purger_catalogue(cur, "", 10) == 0


# ─── Écran avec châssis d'abord (gérant, 07/11/2026 : « nous réparons avec châssis ») ───

@pytest.mark.parametrize("designation, attendu", [
    # Mobilax, Galaxy S25 : la catégorie dit « sans Châssis » ; l'officiel sans mention est l'écran complet
    ("Ecran Tactile Original sans Châssis Samsung Galaxy S25 S931 GH82-36327A Noir", False),
    ("Ecran Tactile Original Samsung Galaxy S25 S931 GH82-36329A Gris", None),
    ("Ecran Tactile Original Assembled avec Châssis Compatible Samsung Galaxy S25 S931", True),
    ("Ecran Tactile Soft Oled avec Châssis Samsung Galaxy S25 Plus S936 Bleu Nuit", True),
    ("Bloc Écran Complet avec Châssis et Batterie Original Honor 200 5G", True),
    # Utopya, Galaxy S25 : « (Sans Châssis) » 67 €, l'écran complet (PA) 94 €, le ReLife « (Avec Châssis) »
    ("Ecran Complet Galaxy S25 (S931B) (Sans Châssis)", False),
    ("Ecran Complet Noir Absolu Galaxy S25 (S931B) (PA)", None),
    ("Ecran Complet Argent Sombre Galaxy S25 (S931B) (Avec Châssis) (Relife)", True),
    # Pas un écran : rien à dire, même si le nom parle de châssis
    ("Châssis Central Corail Galaxy S25 (S931B)", None), ("Batterie Samsung Galaxy S25", None), ("", None), (None, None),
])
def test_chassis_designation(designation, attendu):
    assert P.chassis_designation(designation) is attendu
    assert P.rang_chassis(designation) == (1 if attendu is False else 0)


class _CurChassis(_Cur):
    """Grille comparative + catalogue par (fournisseur, pièce)."""
    def __init__(self, rows, catalogue):
        super().__init__({"FROM tarifs_fournisseurs_prix WHERE tarif_cle LIKE": rows})
        self.catalogue = catalogue

    def fetchall(self):
        s, p = self.sql[-1]
        if "FROM fournisseurs_catalogue" in s:
            return list(self.catalogue.get((p[0], p[1]), []))
        return super().fetchall()


def test_corriger_sans_chassis_passe_sur_l_ecran_avec_chassis_du_catalogue(monkeypatch):
    rows = [
        # S25 Original : Mobilax retenu sur le sans châssis (67 €) ; le catalogue a l'écran complet à 94 € (et un Refurb, écarté)
        {"tarif_cle": "tarifs:1", "fournisseur": "Mobilax", "prix_ht": Decimal("67"), "ref_fournisseur": "MXS",
         "designation": "Ecran Tactile Original sans Châssis Samsung Galaxy S25 S931"},
        # Même pièce chez Utopya, non retenue : la grille Utopya passe sur l'écran complet, le coût ne bouge pas
        {"tarif_cle": "tarifs:1", "fournisseur": "Utopya", "prix_ht": Decimal("67.09"), "ref_fournisseur": "420000",
         "designation": "Ecran Complet Galaxy S25 (S931B) (Sans Châssis)"},
        # S25 Plus : Utopya n'a que le sans châssis → laissé (signalé « Sans châssis » dans les grilles)
        {"tarif_cle": "tarifs:2", "fournisseur": "Utopya", "prix_ht": Decimal("70"), "ref_fournisseur": "420002",
         "designation": "Ecran Complet Galaxy S25 Plus (S936B) (Sans Châssis)"},
        # Pièce verrouillée : la grille comparative est corrigée, le coût retenu jamais touché
        {"tarif_cle": "tarifs:3", "fournisseur": "Mobilax", "prix_ht": Decimal("60"), "ref_fournisseur": "MX3S",
         "designation": "Ecran Tactile Original sans Châssis Samsung Galaxy S24 S921"},
        # Écran complet : rien à examiner
        {"tarif_cle": "tarifs:4", "fournisseur": "Mobilax", "prix_ht": Decimal("80"), "ref_fournisseur": "MX4",
         "designation": "Ecran Tactile Original Samsung Galaxy A54 5G"},
    ]
    catalogue = {
        ("Mobilax", "tarifs:1"): [
            {"ref": "MXR", "nom": "Ecran Tactile Original Refurb Samsung Galaxy S25 S931", "prix_ht": Decimal("50"), "url": None, "en_stock": True},
            {"ref": "MXS", "nom": "Ecran Tactile Original sans Châssis Samsung Galaxy S25 S931", "prix_ht": Decimal("67"), "url": None, "en_stock": True},
            {"ref": "MX94", "nom": "Ecran Tactile Original Samsung Galaxy S25 S931", "prix_ht": Decimal("94"), "url": "https://www.mobilax.fr/s25", "en_stock": None},
            {"ref": "MX96", "nom": "Ecran Tactile Original Samsung Galaxy S25 S931", "prix_ht": Decimal("96"), "url": None, "en_stock": True}],
        ("Utopya", "tarifs:1"): [
            {"ref": "420000", "nom": "Ecran Complet Galaxy S25 (S931B) (Sans Châssis)", "prix_ht": Decimal("67.09"), "url": None, "en_stock": True},
            {"ref": "420001", "nom": "Ecran Complet Noir Absolu Galaxy S25 (S931B) (PA)", "prix_ht": Decimal("94.63"), "url": None, "en_stock": False}],
        ("Utopya", "tarifs:2"): [
            {"ref": "420002", "nom": "Ecran Complet Galaxy S25 Plus (S936B) (Sans Châssis)", "prix_ht": Decimal("70"), "url": None, "en_stock": True}],
        ("Mobilax", "tarifs:3"): [
            {"ref": "MX3", "nom": "Ecran Tactile Original Samsung Galaxy S24 S921", "prix_ht": Decimal("88"), "url": None, "en_stock": True}],
    }
    cur = _CurChassis(rows, catalogue)
    descs = {
        "tarifs:1": {"cle": "tarifs:1", "table": "tarifs", "id": 1, "type_piece": "Ecran", "qualite": "Original", "ht": Decimal("67"),
                     "fournisseur": "Mobilax", "fournisseur_choisi": None, "verrou": False, "obsolete": False},
        "tarifs:2": {"cle": "tarifs:2", "table": "tarifs", "id": 2, "type_piece": "Ecran", "qualite": "Original", "ht": Decimal("70"),
                     "fournisseur": "Utopya", "fournisseur_choisi": None, "verrou": False, "obsolete": False},
        "tarifs:3": {"cle": "tarifs:3", "table": "tarifs", "id": 3, "type_piece": "Ecran", "qualite": "Original", "ht": Decimal("60"),
                     "fournisseur": "Mobilax", "fournisseur_choisi": None, "verrou": True, "obsolete": False},
    }
    monkeypatch.setattr(P, "regles", lambda c=None: {"tva": 1.2})
    monkeypatch.setattr(P, "decrire_tarifs", lambda c, cles, r=None: {k: v for k, v in descs.items() if k in cles})
    appliques, notes = [], []
    monkeypatch.setattr(P, "appliquer_ht", lambda c, cle, ht, source, par, lot=None, r=None: appliques.append((cle, ht, source, par, lot)) or {"ok": True})
    monkeypatch.setattr(P, "noter_fournisseur_retenu", lambda c, cle, cible: notes.append((cle, cible["fournisseur"], cible["ref"], cible["ht"])))
    res = F.corriger_sans_chassis(cur, "Synchro Mobilax")
    assert res["examines"] == 4 and res["corriges"] == 3 and res["reassignees"] == 1 and res["lot_id"]
    maj = [p for s, p in cur.sql if s.startswith("UPDATE tarifs_fournisseurs_prix")]
    # (ht pour prix_maj_le, ht, ref, désignation, url, en_stock, pièce, fournisseur)
    assert [(p[1], p[2], p[3], p[5], p[6], p[7]) for p in maj] == [
        (Decimal("94"), "MX94", "Ecran Tactile Original Samsung Galaxy S25 S931", True, "tarifs:1", "Mobilax"),
        (Decimal("94.63"), "420001", "Ecran Complet Noir Absolu Galaxy S25 (S931B) (PA)", False, "tarifs:1", "Utopya"),
        (Decimal("88"), "MX3", "Ecran Tactile Original Samsung Galaxy S24 S921", True, "tarifs:3", "Mobilax")]
    assert maj[0][4] == "https://www.mobilax.fr/s25"
    # Seul le coût retenu venu du sans châssis Mobilax est remplacé (94 €, même fournisseur) ; verrou et Utopya non retenu laissés
    assert appliques == [("tarifs:1", Decimal("94"), "mobilax", "Synchro Mobilax", res["lot_id"])]
    assert notes == [("tarifs:1", "Mobilax", "MX94", Decimal("94"))]
    # Rien de « sans châssis » : rien ne bouge
    assert F.corriger_sans_chassis(_CurChassis([rows[4]], {}), "x") == {"examines": 0, "corriges": 0, "reassignees": 0, "lot_id": None}


def test_prix_fournisseurs_et_sortie_api_disent_le_chassis(monkeypatch):
    rows = [{"tarif_cle": "tarifs:1", "fournisseur": "Utopya", "prix_ht": Decimal("67.09"), "ref_fournisseur": "420000",
             "designation": "Ecran Complet Galaxy S25 (S931B) (Sans Châssis)", "url": None, "en_stock": True,
             "vu_le": None, "prix_maj_le": None, "source": "utopya"},
            {"tarif_cle": "tarifs:1", "fournisseur": "Mobilax", "prix_ht": Decimal("94"), "ref_fournisseur": "MX94",
             "designation": "Ecran Tactile Original Samsung Galaxy S25 S931", "url": None, "en_stock": True,
             "vu_le": None, "prix_maj_le": None, "source": "mobilax"}]
    pf = P.prix_fournisseurs(_Cur({"FROM tarifs_fournisseurs_prix WHERE tarif_cle = ANY": rows}), ["tarifs:1"])
    assert pf["tarifs:1"]["Utopya"]["chassis"] is False and pf["tarifs:1"]["Mobilax"]["chassis"] is None
    p = {"table": "tarifs", "type_piece": "Ecran", "categorie": "standard"}
    out = T._prix_fournisseurs_out(pf["tarifs:1"], True, p, P.REGLES_DEFAUT)
    assert out["Utopya"]["chassis"] is False and out["Mobilax"]["chassis"] is None and out["Utopya"]["ht"] == 67.09
    assert T._prix_fournisseurs_out(pf["tarifs:1"], False, p, P.REGLES_DEFAUT)["Utopya"]["chassis"] is False
    # Catalogue : chaque produit dit s'il est vendu avec ou sans châssis
    cat = [{"fournisseur": "Utopya", "ref": "420000", "nom": "Ecran Complet Galaxy S25 (S931B) (Sans Châssis)", "prix_ht": Decimal("67.09"),
            "en_stock": True, "url": None, "marque": "Samsung", "modele": "Galaxy S25", "type_piece": "Ecran", "qualite": "Original",
            "tarif_cle": "tarifs:1", "vu_le": None, "prix_maj_le": None},
           {"fournisseur": "Utopya", "ref": "420001", "nom": "Ecran Complet Noir Absolu Galaxy S25 (S931B) (PA)", "prix_ht": Decimal("94.63"),
            "en_stock": False, "url": None, "marque": "Samsung", "modele": "Galaxy S25", "type_piece": "Ecran", "qualite": "Original",
            "tarif_cle": "tarifs:1", "vu_le": None, "prix_maj_le": None}]
    out = P.rechercher_catalogue(_Cur({"FROM fournisseurs_catalogue WHERE": cat}), "galaxy s25")
    assert [(o["ref"], o["chassis"]) for o in out] == [("420000", False), ("420001", None)]


# ─── Route de recherche ──────────────────────────────────────────

def _row(id_, marque, modele, type_piece, qualite, ht, client, fournisseur="Mobilax", source="import"):
    return {"id": id_, "marque": marque, "modele": modele, "type_piece": type_piece, "qualite": qualite, "categorie": "standard",
            "nom_fournisseur": None, "prix_fournisseur_ht": ht, "prix_client": client, "en_stock": None,
            "prix_maj_le": None, "prix_source": source, "verrou_manuel": False, "ref_fournisseur": None, "fournisseur": fournisseur,
            "url_fournisseur": None, "fournisseur_choisi": None}


def test_route_recherche_fournisseurs(client, monkeypatch):
    groupes = [
        {"marque": "Google", "marque_c": "google", "modele": "Pixel 6", "categorie": None,
         "pieces": [T._piece_tarif(_row(1, "Google", "Pixel 6", "Ecran", "Original", Decimal("97"), 199, "Utopya")),
                    T._piece_tarif(_row(2, "Google", "Pixel 6", "Batterie", None, Decimal("0"), 0, None, "a_renseigner"))]},
        {"marque": "Google", "marque_c": "google", "modele": "Pixel 6 Pro", "categorie": None,
         "pieces": [T._piece_tarif(_row(3, "Google", "Pixel 6 Pro", "Ecran", "Original", Decimal("120"), 229))]},
        {"marque": "Samsung", "marque_c": "samsung", "modele": "Galaxy A54", "categorie": None,
         "pieces": [T._piece_tarif(_row(4, "Samsung", "Galaxy A54", "Ecran", "Original", Decimal("80"), 169))]},
    ]
    monkeypatch.setattr(T, "_groupes_pieces", lambda cur, marque_c: groupes)
    monkeypatch.setattr(A.prix, "regles", lambda cur=None: dict(P.REGLES_DEFAUT))
    pf = {"tarifs:1": {"Mobilax": {"ht": 101.0, "ref": "MX1", "designation": "Ecran Tactile Original Google Pixel 6", "url": None,
                                   "en_stock": True, "vu_le": None, "prix_maj_le": None, "source": "mobilax"},
                       "Utopya": {"ht": 97.0, "ref": "420921", "designation": "Ecran Complet Google Pixel 6", "url": "https://www.utopya.fr/p6",
                                  "en_stock": False, "vu_le": None, "prix_maj_le": None, "source": "utopya"}}}
    monkeypatch.setattr(A.prix, "prix_fournisseurs", lambda cur, cles: {k: v for k, v in pf.items() if k in cles})
    produits = [{"fournisseur": "Mobilax", "ref": "MX9", "nom": "Ecran Tactile Original Refurb Google Pixel 6 Noir", "prix_ht": 55.0,
                 "en_stock": True, "url": None, "marque": "Google", "modele": "Google Pixel 6", "type_piece": "Ecran", "qualite": "Reconditionnee",
                 "tarif_cle": None, "vu_le": None, "prix_maj_le": None}]
    recherches = []
    monkeypatch.setattr(A.prix, "rechercher_catalogue", lambda cur, q, fournisseurs=None, type_piece=None, limite=200: recherches.append((q, type_piece)) or produits)
    monkeypatch.setattr(A.fournisseurs, "preference", lambda cur=None: "Mobilax")
    _, gc = fake_db(lambda sql, params: None)
    # Personnel : modèles et prix client de chaque fournisseur, jamais de HT ni de catalogue
    _, gc_staff = fake_db(lambda sql, params: None)
    with patch("app.api.auth.get_cursor", gc_staff), patch("app.api.fournisseurs.get_cursor", gc):
        r = client.get("/api/tarifs/fournisseurs/recherche?q=pixel%206", headers=_headers())
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["admin"] is False and d["preference"] == "Mobilax" and [m["modele"] for m in d["modeles"]] == ["Pixel 6", "Pixel 6 Pro"]
        ecran = d["modeles"][0]["pieces"][0]
        assert ecran["prix_fournisseur_ht"] is None and ecran["prix_client"] == 199
        assert ecran["prix_fournisseurs"]["Mobilax"]["ht"] is None and ecran["prix_fournisseurs"]["Mobilax"]["client"] > 0
        assert ecran["prix_fournisseurs"]["Utopya"]["en_stock"] is False and ecran["prix_fournisseurs"]["Mobilax"]["en_stock"] is True
        assert d["produits"] == {"Mobilax": [], "Utopya": []} and d["nb_produits"] == 0 and recherches == []
        assert d["modeles"][0]["pieces"][1]["a_renseigner"] is True
        assert client.get("/api/tarifs/fournisseurs/recherche?q=p", headers=_headers()).status_code == 422
        assert client.get("/api/tarifs/fournisseurs/recherche?q=pixel&type=coque", headers=_headers()).status_code == 400
    # Admin : HT, calcul et catalogue de chaque fournisseur ; filtre de type
    _, gc_admin = fake_db(lambda sql, params: _ADMIN_PROUVE if "membres_equipe" in sql else None)
    with patch("app.api.auth.get_cursor", gc_admin), patch("app.api.fournisseurs.get_cursor", gc):
        r = client.get("/api/tarifs/fournisseurs/recherche?q=Pixel%206&type=ecran", headers=_headers())
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["admin"] is True and [len(m["pieces"]) for m in d["modeles"]] == [1, 1]
        ecran = d["modeles"][0]["pieces"][0]
        assert ecran["prix_fournisseur_ht"] == 97.0 and ecran["prix_fournisseurs"]["Mobilax"]["ht"] == 101.0
        assert ecran["prix_fournisseurs"]["Utopya"]["calcul"]["ht"] == 97.0
        assert recherches == [("Pixel 6", "ecran")] and d["nb_produits"] == 1
        p = d["produits"]["Mobilax"][0]
        assert p["ref"] == "MX9" and p["qualite"] == "Reconditionnee" and p["client"] == P.prix_client(55.0, "Ecran", "standard", P.REGLES_DEFAUT)
        assert d["produits"]["Utopya"] == [] and d["tronque"] is False
        assert client.get("/api/tarifs/fournisseurs/recherche", headers=_headers()).status_code == 422
