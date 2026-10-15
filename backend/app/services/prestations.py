"""
Symptôme (motif choisi par le client, stocké dans tickets.panne) → prestation
(libellé de la ligne facturée).

tickets.panne garde le symptôme stable (stats, filtres, champ « Motif ») ; le
forfait n'est dérivé que pour la ligne « legacy » d'un ticket sans lignes JSON.
Les lignes JSON de reparation_supp sont saisies par l'équipe : elles sont
rendues telles quelles, jamais réécrites. Exposé au front par
GET /api/catalog/prestations (source unique).
"""

import json
import math
import re
import unicodedata
from datetime import date, datetime

# (cle, symptôme du kiosque | None, prestation, libellé court, alias)
# Les alias sont comparés après normalisation (accents, casse, ponctuation) :
# correspondance exacte uniquement, jamais par sous-chaîne.
PRESTATIONS = [
    ("ecran", "Écran cassé", "Forfait remplacement écran", "Écran",
     ["Écran HS"]),
    ("batterie", "Batterie", "Forfait remplacement batterie", "Batterie",
     ["Batterie HS", "Batterie qui gonfle", "Batterie gonflée"]),
    ("connecteur", "Connecteur de charge", "Forfait remplacement connecteur de charge", "Connecteur de charge",
     ["Connecteur", "Connecteur charge", "Port de charge"]),
    ("camera_avant", "Caméra avant", "Forfait remplacement caméra avant", "Caméra avant",
     ["Caméra avant HS"]),
    ("camera_arriere", "Caméra arrière", "Forfait remplacement caméra arrière", "Caméra arrière",
     ["Caméra arrière HS"]),
    ("bouton_volume", "Bouton volume", "Forfait réparation bouton volume", "Bouton volume",
     ["Nappe volume", "Nappe volume HS"]),
    ("bouton_power", "Bouton power", "Forfait réparation bouton power", "Bouton power",
     ["Bouton power HS", "Bouton marche/arrêt", "Nappe power"]),
    ("haut_parleur", "Haut-parleur (je n'entends pas les gens ou la musique)",
     "Forfait remplacement haut-parleur", "Haut-parleur", ["Haut-parleur HS"]),
    ("micro", "Microphone (les gens ne m'entendent pas)", "Forfait réparation micro", "Micro",
     ["Microphone", "Micro HS"]),
    ("vitre_arriere", "Vitre arrière", "Forfait remplacement vitre arrière", "Vitre arrière",
     ["Vitre arrière cassée"]),
    ("desoxydation", "Désoxydation", "Forfait désoxydation", "Désoxydation", ["Oxydation"]),
    ("logiciel", "Problème logiciel", "Forfait intervention logicielle", "Logiciel", []),
    ("diagnostic", "Diagnostic", "Diagnostic", "Diagnostic", []),
    # Hors kiosque : types de pièce des tarifs et saisie automatique
    ("ecouteur", None, "Forfait remplacement écouteur interne", "Écouteur interne",
     ["Écouteur", "Écouteur interne HS"]),
    ("vitre_camera", None, "Forfait remplacement vitre caméra arrière", "Vitre caméra arrière",
     ["Lentille caméra"]),
    ("face_id", None, "Forfait réparation Face ID", "Face ID", ["Face ID HS"]),
]

# Liste du kiosque (/api/catalog/pannes) : même ordre qu'avant, accents corrigés
PANNES_CATALOGUE = [p[1] for p in PRESTATIONS if p[1]] + ["Autre"]

# Valeurs historiques encore stockées dans tickets.panne (pour une migration éventuelle)
PANNES_RENOMMEES = [
    ("Écran cassé", "Écran casse"), ("Caméra avant", "Camera avant"),
    ("Caméra arrière", "Camera arriere"), ("Vitre arrière", "Vitre arriere"),
]

_AUTRE_MAX = 35      # largeur utile de la colonne Désignation du PDF
_PIECE_MAX = 60

# Un document déjà remis (reçu, facture) ne doit pas changer de désignation à la
# réimpression : les tickets déposés avant l'arrivée des forfaits et déjà
# rendus, clôturés, facturés ou payés gardent le symptôme brut en ligne legacy.
FORFAITS_DEPUIS = date(2026, 10, 15)
_STATUTS_EMIS = {"Rendu au client", "Clôturé"}


def normaliser(s) -> str:
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", s).split())


_PAR_CLE = {}
_INDEX = {}
for _cle, _sympt, _presta, _court, _alias in PRESTATIONS:
    _PAR_CLE[_cle] = {"prestation": _presta, "court": _court}
    for _v in (_sympt, _presta, _court, *_alias):
        if _v:
            _INDEX.setdefault(normaliser(_v), _cle)


def cle_panne(texte):
    """Clé de prestation d'un symptôme ou d'un libellé connu, sinon None."""
    return _INDEX.get(normaliser(texte))


def _une_ligne(texte) -> str:
    return " ".join(str(texte or "").split())


def _tronquer(texte, n) -> str:
    if len(texte) <= n:
        return texte
    coupe = texte[: n - 3].rsplit(" ", 1)[0] or texte[: n - 3]
    return coupe.rstrip(" ,;:-") + "..."


def _nom_piece(panne_detail) -> str:
    # panne_detail = « nom de la pièce — notes internes » : seule la pièce sort
    return _une_ligne(re.split(r"\s*[—–]\s*", str(panne_detail or ""), maxsplit=1)[0])


def libelle_prestation(panne, panne_detail="") -> str:
    """Libellé de la ligne par défaut, dérivé du symptôme."""
    cle = cle_panne(panne)
    if cle:
        return _PAR_CLE[cle]["prestation"]
    n = normaliser(panne)
    if n == "autre":
        d = _une_ligne(panne_detail)
        return f"Réparation - {_tronquer(d, _AUTRE_MAX)}" if d else "Réparation"
    if n == "piece a commander":
        nom = _nom_piece(panne_detail)
        return _tronquer(nom, _PIECE_MAX) if nom else "Pièce à commander"
    return _une_ligne(panne) or "Réparation"


def detail_public(t: dict) -> str:
    """Détail de panne montré sur les documents client (jamais les notes internes d'une pièce)."""
    if normaliser(t.get("panne")) == "piece a commander":
        return _nom_piece(t.get("panne_detail"))
    return str(t.get("panne_detail") or "")


def libelle_court(label) -> str:
    cle = cle_panne(label)
    return _PAR_CLE[cle]["court"] if cle else _une_ligne(label)


def _prix(v) -> float:
    if v is None or isinstance(v, bool):
        return 0.0
    try:
        f = float(v)
    except (TypeError, ValueError):
        s = str(v).strip().replace(" ", "").replace(" ", "").replace("€", "").replace(",", ".")
        try:
            f = float(s)
        except ValueError:
            return 0.0
    return f if math.isfinite(f) else 0.0


def _date_depot(t):
    d = t.get("date_depot")
    if isinstance(d, datetime):
        return d.date()
    if isinstance(d, date):
        return d
    return None


def document_emis(t) -> bool:
    return (
        t.get("statut") in _STATUTS_EMIS
        or (t.get("type_document") or "").strip().lower() == "facture"
        or bool(t.get("paye"))
    )


def forfait_applicable(t) -> bool:
    """La ligne legacy reçoit-elle le forfait ? (cf. FORFAITS_DEPUIS)"""
    if not document_emis(t):
        return True
    depot = _date_depot(t)
    return depot is not None and depot >= FORFAITS_DEPUIS


def _lignes_json(brut):
    try:
        data = json.loads(brut)
    except (TypeError, ValueError):
        return None
    if not isinstance(data, list):
        return None
    lignes = []
    for r in data:
        if not isinstance(r, dict):
            continue
        label = str(r.get("label") or "").strip()
        if label:
            lignes.append({"label": label, "prix": _prix(r.get("prix")), "cle": cle_panne(label)})
    return lignes


def lignes_reparation(t: dict) -> list:
    """Lignes imprimées d'un ticket : [{"label", "prix", "cle"}]. Source unique des documents."""
    rs = str(t.get("reparation_supp") or "").strip()
    if rs[:1] in ("[", "{"):
        lignes = _lignes_json(rs)
        if lignes is not None:
            return lignes
    lignes = []
    panne = t.get("panne")
    if panne and str(panne).strip():
        if forfait_applicable(t):
            label = libelle_prestation(panne, t.get("panne_detail"))
        else:
            label = _une_ligne(panne)
        lignes.append({"label": label, "prix": _prix(t.get("devis_estime")), "cle": cle_panne(panne)})
    if rs and rs[:1] not in ("[", "{"):
        lignes.append({"label": rs, "prix": _prix(t.get("prix_supp")), "cle": cle_panne(rs)})
    return lignes


def index_ligne_ecran(lignes):
    """Ligne qui porte le badge type d'écran : clé 'ecran', sinon le mot « écran »."""
    for i, r in enumerate(lignes):
        if r.get("cle") == "ecran":
            return i
    for i, r in enumerate(lignes):
        if "ecran" in normaliser(r.get("label")).split():
            return i
    return None


def catalogue_prestations() -> dict:
    return {
        "pannes": list(PANNES_CATALOGUE),
        "prestations": [
            {"cle": cle, "symptome": sympt, "prestation": presta, "court": court, "alias": list(alias)}
            for cle, sympt, presta, court, alias in PRESTATIONS
        ],
    }
