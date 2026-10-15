"""Table symptôme → prestation et lignes imprimées (services/prestations.py)."""

import json
from datetime import datetime

import pytest

from app.services.pdf_text import _pdf_safe
from app.services.prestations import (
    PANNES_CATALOGUE, PRESTATIONS, catalogue_prestations, cle_panne, detail_public, index_ligne_ecran,
    libelle_court, libelle_prestation, lignes_reparation, normaliser,
)

CAS = [
    ("Écran cassé", "Forfait remplacement écran"),
    ("Écran casse", "Forfait remplacement écran"),
    ("ECRAN", "Forfait remplacement écran"),
    ("Ecran", "Forfait remplacement écran"),
    ("Batterie", "Forfait remplacement batterie"),
    ("Batterie HS", "Forfait remplacement batterie"),
    ("Camera arriere", "Forfait remplacement caméra arrière"),
    ("Caméra avant HS", "Forfait remplacement caméra avant"),
    ("Vitre arriere", "Forfait remplacement vitre arrière"),
    ("Vitre camera arriere", "Forfait remplacement vitre caméra arrière"),
    ("Ecouteur interne", "Forfait remplacement écouteur interne"),
    ("Haut-parleur (je n'entends pas les gens ou la musique)", "Forfait remplacement haut-parleur"),
    ("Haut-parleur", "Forfait remplacement haut-parleur"),
    ("Microphone (les gens ne m'entendent pas)", "Forfait réparation micro"),
    ("Bouton power", "Forfait réparation bouton power"),
    ("Bouton marche/arrêt", "Forfait réparation bouton power"),
    ("Désoxydation", "Forfait désoxydation"),
    ("Problème logiciel", "Forfait intervention logicielle"),
    ("Diagnostic", "Diagnostic"),
    ("  batterie  ", "Forfait remplacement batterie"),
    # Inconnus et sous-chaînes : jamais convertis
    ("Achat iPhone", "Achat iPhone"),
    ("Achat Accessoire", "Achat Accessoire"),
    ("Batterie externe", "Batterie externe"),
    ("Écran qui clignote", "Écran qui clignote"),
    ("Ne charge plus", "Ne charge plus"),
    ("Écran OLED + nappe", "Écran OLED + nappe"),
    ("Ecran (Soft OLED)", "Ecran (Soft OLED)"),
    ("Vitre avant", "Vitre avant"),
]


@pytest.mark.parametrize("entree,attendu", CAS)
def test_libelle_prestation(entree, attendu):
    assert libelle_prestation(entree) == attendu


@pytest.mark.parametrize("entree,_", CAS)
def test_idempotence(entree, _):
    une_fois = libelle_prestation(entree)
    assert libelle_prestation(une_fois) == une_fois


def test_autre_court_long_multiligne():
    assert libelle_prestation("Autre", "Face ID ne marche plus") == "Réparation - Face ID ne marche plus"
    assert libelle_prestation("Autre", "") == "Réparation"
    long = libelle_prestation("Autre", "Le téléphone redémarre\nen boucle après une chute dans l'eau de la piscine")
    assert "\n" not in long and long.startswith("Réparation - ") and long.endswith("...")
    assert len(long) <= len("Réparation - ") + 35


def test_piece_a_commander_garde_seulement_la_piece():
    assert libelle_prestation("Pièce à commander", "Écran OLED iPhone 14 Pro — fournisseur X réf 123") == "Écran OLED iPhone 14 Pro"
    assert libelle_prestation("Pièce à commander", "") == "Pièce à commander"


def test_detail_public_sans_notes_internes():
    piece = {"panne": "Pièce à commander", "panne_detail": "Écran OLED iPhone 14 Pro — MobileSentrix réf 123"}
    assert detail_public(piece) == "Écran OLED iPhone 14 Pro"
    assert detail_public({**piece, "panne_detail": "Nappe power – fournisseur Y"}) == "Nappe power"
    assert detail_public({**piece, "panne_detail": None}) == ""
    # Hors pièce à commander, le détail saisi par le client reste entier
    autre = {"panne": "Autre", "panne_detail": "Ne charge plus — sauf en sans fil"}
    assert detail_public(autre) == "Ne charge plus — sauf en sans fil"
    assert detail_public({"panne": "Batterie"}) == ""


def test_catalogue_kiosque():
    assert PANNES_CATALOGUE == [
        "Écran cassé", "Batterie", "Connecteur de charge", "Caméra avant", "Caméra arrière",
        "Bouton volume", "Bouton power",
        "Haut-parleur (je n'entends pas les gens ou la musique)",
        "Microphone (les gens ne m'entendent pas)",
        "Vitre arrière", "Désoxydation", "Problème logiciel", "Diagnostic", "Autre",
    ]
    data = catalogue_prestations()
    assert data["pannes"] == PANNES_CATALOGUE
    assert {"cle", "symptome", "prestation", "court", "alias"} <= set(data["prestations"][0])
    json.dumps(data)


def test_aucune_collision_dans_la_table():
    vus = {}
    for cle, sympt, presta, court, alias in PRESTATIONS:
        for v in (sympt, presta, court, *alias):
            if v:
                n = normaliser(v)
                assert vus.setdefault(n, cle) == cle, f"{v!r} déjà pris par {vus[n]}"


def test_libelles_encodables_latin1():
    for _, _, presta, court, _ in PRESTATIONS:
        presta.encode("latin-1")
        court.encode("latin-1")


def test_libelle_court():
    assert libelle_court("Forfait remplacement batterie") == "Batterie"
    assert libelle_court("Batterie externe") == "Batterie externe"


# ─── lignes_reparation ─────────────────────────────────────────

def test_legacy_recoit_le_forfait():
    lignes = lignes_reparation({"panne": "Écran casse", "devis_estime": 129, "statut": "En attente de diagnostic"})
    assert lignes == [{"label": "Forfait remplacement écran", "prix": 129.0, "cle": "ecran"}]


def test_lignes_json_jamais_reecrites():
    t = {"panne": "Batterie", "reparation_supp": json.dumps([
        {"label": "Batterie", "prix": 59}, {"label": "Protection verre trempé", "prix": 15},
    ])}
    assert [(r["label"], r["prix"]) for r in lignes_reparation(t)] == [("Batterie", 59.0), ("Protection verre trempé", 15.0)]


def test_prix_vide_ne_change_pas_la_liste():
    t = {"panne": "Écran cassé", "devis_estime": 0, "reparation_supp": json.dumps([
        {"label": "Écran OLED", "prix": "189"}, {"label": "Diagnostic", "prix": ""},
        {"label": "Nappe", "prix": None}, {"label": "Film", "prix": "12,5"}, {"label": "", "prix": 3},
    ])}
    assert [(r["label"], r["prix"]) for r in lignes_reparation(t)] == [
        ("Écran OLED", 189.0), ("Diagnostic", 0.0), ("Nappe", 0.0), ("Film", 12.5),
    ]


def test_json_invalide_ou_non_tableau():
    for brut in ("[{'label': 'x'", '{"label": "x"}', "[1, 2]"):
        lignes = lignes_reparation({"panne": "Batterie", "devis_estime": 59, "reparation_supp": brut})
        assert all(not r["label"].startswith(("[", "{")) for r in lignes)
    assert lignes_reparation({"panne": "Batterie", "reparation_supp": "[1, 2]"}) == []
    assert lignes_reparation({"panne": "Batterie", "devis_estime": 59, "reparation_supp": "{}"})[0]["prix"] == 59.0


def test_reparation_supp_texte_conserve():
    lignes = lignes_reparation({"panne": "Batterie", "devis_estime": 59, "reparation_supp": "Batterie", "prix_supp": 10})
    assert [r["label"] for r in lignes] == ["Forfait remplacement batterie", "Batterie"]


def test_document_deja_emis_garde_le_symptome():
    ancien = datetime(2026, 3, 1, 10, 0)
    for extra in ({"statut": "Clôturé"}, {"statut": "Rendu au client"}, {"type_document": "facture"}, {"paye": 1}):
        t = {"panne": "Batterie", "devis_estime": 59, "date_depot": ancien, **extra}
        assert lignes_reparation(t)[0]["label"] == "Batterie", extra
    en_cours = {"panne": "Batterie", "devis_estime": 59, "date_depot": ancien, "statut": "En cours de réparation"}
    assert lignes_reparation(en_cours)[0]["label"] == "Forfait remplacement batterie"
    recent = {"panne": "Batterie", "date_depot": datetime(2026, 11, 2), "statut": "Clôturé", "paye": 1}
    assert lignes_reparation(recent)[0]["label"] == "Forfait remplacement batterie"


def test_badge_sur_la_ligne_ecran():
    lignes = lignes_reparation({"reparation_supp": json.dumps([
        {"label": "Forfait remplacement batterie", "prix": 59},
        {"label": "Forfait remplacement écran", "prix": 129},
    ])})
    assert index_ligne_ecran(lignes) == 1
    assert index_ligne_ecran([{"label": "Écran OLED + nappe", "cle": None}]) == 0
    assert index_ligne_ecran([{"label": "Batterie", "cle": "batterie"}]) is None


def test_cle_panne():
    assert cle_panne("Forfait remplacement écran") == "ecran"
    assert cle_panne("") is None and cle_panne(None) is None


def test_pdf_safe():
    assert _pdf_safe("l’écran – test") == "l'écran - test"
    assert _pdf_safe("Réparation — détail…") == "Réparation - détail..."
    assert _pdf_safe("« ok »") == "« ok »"
    assert _pdf_safe(None) == "" and _pdf_safe(0) == "0"
    _pdf_safe("emoji 😀 ✓").encode("latin-1")
