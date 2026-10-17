"""
Import d'un fichier de prix fournisseur (Excel .xlsx ou CSV ; « ; », « , » ou tabulation ;
décimales à virgule acceptées) : aperçu SANS écriture des prix, puis application des lignes
cochées en une transaction via le moteur de prix (services/prix).

Correspondance d'une ligne du fichier avec une pièce de la base, dans cet ordre :
(a) référence fournisseur ; (b) désignation identique au nom fournisseur enregistré ;
(c) marque, modèle, type de pièce et qualité : nom écrit à l'identique, puis normalisé
(grille.cle_modele, noms groupés « iPhone 12/12 Pro » ou « 12 / 12 Pro » dépliés, « Reno10 » =
« Reno 10 »), puis sans 5G/année, sans référence Apple A1234, sans taille en pouces. Mots de
libellé (« Ecran complet », « LCD + Tactile », « avec châssis ») ignorés ; accessoire nommé
avant la pièce (« Adhésif batterie ») jamais pris pour la pièce. Jamais par sous-chaîne, et une
ligne qui désigne plusieurs pièces (modèles distincts, ou que seule une référence distingue) est
laissée à associer à la main.

Garde-fous : aucune suppression (les pièces absentes du fichier ne sont marquées obsolètes que
sur demande, et seulement parmi les mêmes marque ET type de pièce — et qualité d'écran — qu'une
ligne reconnue ou nouvelle du fichier ; jamais une pièce qu'une ligne non reconnue, invalide ou
sans prix pourrait désigner), pièces verrouillées jamais modifiées, grosses variations décochées
par défaut, fichier contenant une ligne invalide refusé en entier (sauf confirmation explicite).

Association manuelle d'une ligne non reconnue (n → cle) : pré-évaluée sans écriture (evaluer),
recalculée à l'application avec les mêmes alertes que les lignes reconnues ; avec une alerte de
variation ou de marge, appliquée seulement si la ligne est confirmée (n dans `lignes` ou
`confirmees`).
"""

import csv
import io
import json
import re
from decimal import Decimal, InvalidOperation

from psycopg2.extras import execute_values

from app.api import grille
from app.services import params as params_cache
from app.services import prix
from app.services.prestations import normaliser

MAX_OCTETS = 5 * 1024 * 1024
MAX_LIGNES = 20000
_MAX_HT = Decimal("5000")
CIBLES = ("tarifs", "tarifs_apple_devices")
CHAMPS = ("reference", "designation", "marque", "modele", "type_piece", "qualite", "categorie", "prix_ht")
LIBELLES_CHAMPS = {
    "reference": "Référence", "designation": "Désignation", "marque": "Marque", "modele": "Modèle",
    "type_piece": "Type de pièce", "qualite": "Qualité", "categorie": "Catégorie", "prix_ht": "Prix HT",
}

_SYNONYMES = {
    "reference": {"reference", "references", "ref", "refs", "ref fournisseur", "reference fournisseur", "sku",
            "code", "code article", "code produit", "ref article", "reference article", "ean", "code ean"},
    "designation": {"designation", "libelle", "nom", "nom produit", "nom du produit", "produit", "article",
                    "description", "intitule", "libelle article", "designation article", "libelle produit"},
    "marque": {"marque", "brand", "fabricant", "constructeur"},
    "modele": {"modele", "model", "appareil", "modele compatible", "compatible avec", "device", "modele appareil"},
    "type_piece": {"type", "type piece", "type de piece", "piece", "famille", "categorie piece", "sous famille",
                   "type produit"},
    "qualite": {"qualite", "quality", "gamme", "grade"},
    "categorie": {"categorie", "category"},
    "prix_ht": {"prix ht", "pu ht", "prix unitaire ht", "tarif ht", "prix achat ht", "prix d achat ht",
                "prix pro ht", "prix net ht", "cout ht", "montant ht", "prix hors taxe", "prix hors taxes", "pht",
                "prix", "prix unitaire", "tarif", "prix achat", "prix d achat", "prix pro", "prix net", "price",
                "cout"},
}

# (clé, valeur enregistrée dans tarifs.type_piece, motifs normalisés)
_PIECES = [
    ("vitre_camera", "Vitre camera arriere", ["vitre camera arriere", "lentille camera arriere",
                                               "verre camera arriere", "cache camera arriere", "vitre camera",
                                               "lentille camera", "verre camera", "cache camera"]),
    ("vitre_arriere", "Vitre arriere", ["vitre arriere", "face arriere", "vitre dos", "back cover"]),
    # Caméra avant : pièce à part (jamais le prix de la caméra arrière)
    ("camera_avant", "Camera avant", ["camera avant", "camera frontale", "camera selfie", "appareil photo avant"]),
    ("camera_arriere", "Camera arriere", ["camera arriere", "camera principale", "appareil photo arriere", "camera"]),
    ("connecteur", "Connecteur de charge", ["nappe connecteur de charge", "nappe connecteur charge",
                                            "nappe connecteur", "connecteur de charge", "connecteur charge",
                                            "connecteur", "port de charge", "dock de charge"]),
    ("haut_parleur", "Haut-parleur", ["haut parleur", "buzzer", "speaker"]),
    ("ecouteur", "Ecouteur interne", ["ecouteur interne", "ecouteur"]),
    ("batterie", "Batterie", ["batterie", "battery"]),
    ("ecran", "Ecran", ["bloc ecran", "ecran", "afficheur", "screen", "display"]),
]
_TYPE_PIECE = {cle: valeur for cle, valeur, _ in _PIECES}
# (valeur enregistrée dans tarifs.qualite, motifs) : ordre = priorité (« Soft OLED » avant « OLED »)
_QUALITES = [
    ("Soft OLED", ["soft oled"]),
    ("OLED", ["hard oled", "oled", "amoled"]),
    ("Incell", ["incell", "in cell"]),
    ("Reconditionnee", ["reconditionnee", "reconditionne", "reconditionnes", "pulled", "refurb", "refurbished"]),
    ("Original", ["original", "originale", "origine", "service pack"]),
    ("Compatible", ["compatible", "oem", "aftermarket", "copie"]),
    ("LCD", ["lcd", "tft"]),
]
_MOTS_VIDES = {"de", "du", "d", "pour", "avec", "sans", "et", "le", "la", "les", "piece", "pieces", "remplacement",
               "rechange", "nappe", "charge", "reparation", "kit",
               # Mots de libellé fournisseur autour de la pièce (« Ecran complet », « LCD + Tactile »,
               # « avec châssis », « Caméra arrière principale ») : jamais dans un nom de modèle
               "complet", "complete", "tactile", "vitre", "assemble", "assemblee", "chassis", "cadre", "frame",
               "arriere", "avant", "principale", "principal", "interne", "externe", "neuf", "neuve", "haute",
               "qualite", "adhesif", "adhesifs",
               # Couleurs (jamais dans un nom de modèle)
               "noir", "noire", "blanc", "blanche", "bleu", "rouge", "vert", "violet", "rose", "gris", "jaune",
               "argent", "dore", "black", "white", "blue", "silver", "gold", "graphite"}
_PLIANTS = ("fold", "flip", "razr")
# Accessoire désigné AVANT la pièce (« Adhésif écran », « Film de protection caméra », « Coque
# batterie ») : la ligne n'est pas cette pièce (jamais le prix d'un adhésif sur une batterie)
_ACCESSOIRES = {"adhesif", "adhesifs", "colle", "film", "films", "protection", "protections", "protecteur",
                "protege", "trempe", "coque", "coques", "etui", "housse", "chargeur", "cable", "cables", "outil",
                "outils", "tournevis", "ventouse", "spatule", "sticker", "autocollant", "joint", "joints"}


class ImportErreur(ValueError):
    """Fichier ou choix refusé (message destiné à l'utilisateur)."""


# ─── Lecture du fichier ─────────────────────────────────────────

def _decoder(contenu: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return contenu.decode(enc)
        except UnicodeDecodeError:
            continue
    return contenu.decode("latin-1")


def _separateur(texte: str) -> str:
    lignes = [l for l in texte.splitlines()[:60] if l.strip()]
    meilleur, score_max = ";", -1
    for sep in (";", "\t", "|", ","):
        comptes = [l.count(sep) for l in lignes]
        if not any(comptes):
            continue
        mode = max(set(comptes), key=comptes.count)
        score = sum(1 for c in comptes if c == mode and c > 0)
        if score > score_max:
            meilleur, score_max = sep, score
    return meilleur


def lire_tableau(nom: str, contenu: bytes) -> list:
    """Lignes du fichier (listes de cellules), en-tête compris."""
    if not contenu:
        raise ImportErreur("Fichier vide")
    if len(contenu) > MAX_OCTETS:
        raise ImportErreur("Fichier trop volumineux (5 Mo au plus)")
    nom = (nom or "").lower()
    if contenu[:4] == b"PK\x03\x04" or nom.endswith((".xlsx", ".xlsm")):
        from openpyxl import load_workbook
        try:
            classeur = load_workbook(io.BytesIO(contenu), read_only=True, data_only=True)
        except Exception:
            raise ImportErreur("Classeur Excel illisible (format .xlsx attendu)")
        try:
            feuille = next((f for f in classeur.worksheets if (f.max_row or 0) > 1), classeur.worksheets[0])
            lignes = []
            for i, row in enumerate(feuille.iter_rows(values_only=True)):
                if i > MAX_LIGNES + 50:
                    raise ImportErreur(f"Fichier trop long ({MAX_LIGNES} lignes au plus)")
                lignes.append(list(row))
            return lignes
        finally:
            classeur.close()
    if nom.endswith(".xls") or contenu[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        raise ImportErreur("Ancien format Excel (.xls) : enregistrez le fichier en .xlsx ou en CSV")
    texte = _decoder(contenu)
    lignes = list(csv.reader(io.StringIO(texte), delimiter=_separateur(texte)))
    if len(lignes) > MAX_LIGNES + 50:
        raise ImportErreur(f"Fichier trop long ({MAX_LIGNES} lignes au plus)")
    return lignes


def _texte(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return " ".join(str(v).split())


def lire_prix(v):
    """Decimal à 2 décimales ; None si vide ; ValueError si illisible.

    « 12,50 », « 1 234,56 », « 1.234,56 », « 12.50 € », cellule numérique Excel.
    """
    if v is None:
        return None
    if isinstance(v, bool):
        raise ValueError("prix illisible")
    if isinstance(v, (int, float, Decimal)):
        d = Decimal(str(v))
    else:
        s = str(v)
        for c in (" ", " ", " ", "€", "EUR", "eur", "Eur", "HT", "ht"):
            s = s.replace(c, "")
        if not s:
            return None
        if "," in s and "." in s:
            s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
        elif "," in s:
            s = s.replace(",", ".")
        try:
            d = Decimal(s)
        except InvalidOperation:
            raise ValueError("prix illisible")
    if not d.is_finite():
        raise ValueError("prix illisible")
    return d.quantize(Decimal("0.01"))


# ─── En-tête et correspondance des colonnes ─────────────────────

def _champ(cellule):
    n = normaliser(cellule)
    if not n or "ttc" in n.split():
        return None
    for champ, syns in _SYNONYMES.items():
        if n in syns:
            return champ
    mots = n.split()
    if mots[0] in ("prix", "tarif", "cout") and "ht" in mots:
        return "prix_ht"
    return None


def _priorite_prix(cellule) -> int:
    mots = normaliser(cellule).split()
    return 0 if "ht" in mots or "pht" in mots else 1


def detecter_entete(lignes: list, mapping: dict = None):
    """(index de la ligne d'en-tête, noms de colonnes, mapping {champ: colonne})."""
    for i, row in enumerate(lignes[:30]):
        noms = [_texte(c) for c in row]
        if mapping:
            if all(col in noms for col in mapping.values()):
                return i, noms, dict(mapping)
            continue
        trouve = {}
        for nom in noms:
            champ = _champ(nom)
            if champ is None:
                continue
            if champ not in trouve or (champ == "prix_ht" and _priorite_prix(nom) < _priorite_prix(trouve[champ])):
                trouve[champ] = nom
        if "prix_ht" in trouve and ({"designation", "modele", "reference"} & set(trouve)):
            return i, noms, trouve
    if mapping:
        raise ImportErreur("Colonnes indiquées introuvables dans le fichier")
    raise ImportErreur("En-tête introuvable : il faut au moins une colonne « Prix HT » et une colonne "
                       "« Désignation » ou « Modèle » (ou indiquez la correspondance des colonnes)")


def valider_mapping(m) -> dict:
    if m in (None, "", {}):
        return {}
    if isinstance(m, str):
        try:
            m = json.loads(m)
        except ValueError:
            raise ImportErreur("Correspondance des colonnes : JSON invalide")
    if not isinstance(m, dict):
        raise ImportErreur("Correspondance des colonnes : objet {champ: colonne} attendu")
    out = {}
    for champ, col in m.items():
        champ = "reference" if champ == "ref" else champ
        if champ not in CHAMPS:
            raise ImportErreur(f"Champ inconnu dans la correspondance : {champ}")
        if col in (None, ""):
            continue
        if not isinstance(col, str) or len(col) > 120:
            raise ImportErreur("Correspondance des colonnes : noms de colonnes attendus")
        out[champ] = " ".join(col.split())
    if out and "prix_ht" not in out:
        raise ImportErreur("Correspondance des colonnes : la colonne « Prix HT » est obligatoire")
    if out and not ({"reference", "designation", "modele"} & set(out)):
        raise ImportErreur("Correspondance des colonnes : une colonne « Référence », « Désignation » ou "
                           "« Modèle » est obligatoire")
    return out


def cle_mapping(fournisseur: str) -> str:
    return "IMPORT_MAPPING_" + (re.sub(r"[^A-Z0-9]+", "_", normaliser(fournisseur).upper()).strip("_")[:40] or "DEFAUT")


# ─── Interprétation d'une ligne ─────────────────────────────────

def _jetons(texte: str) -> list:
    """[(jeton brut, [sous-jetons normalisés])] : « Haut-parleur » → ['haut', 'parleur']."""
    return [(brut, normaliser(brut).split()) for brut in str(texte or "").split()]


def _trouver(plat: list, motif: list):
    """Position du motif (suite de sous-jetons) dans la liste aplatie, sinon None."""
    n = len(motif)
    for i in range(len(plat) - n + 1):
        if plat[i:i + n] == motif:
            return i
    return None


def piece_de(texte):
    """Clé de pièce ('ecran', 'batterie'…) : le motif le plus tôt dans le texte, le plus long à égalité."""
    plat = normaliser(texte).split()
    meilleur = None
    for cle, _, motifs in _PIECES:
        for m in motifs:
            pos = _trouver(plat, m.split())
            if pos is not None and (meilleur is None or (pos, -len(m)) < meilleur[0]):
                meilleur = ((pos, -len(m)), cle, m)
    return (meilleur[1], meilleur[2]) if meilleur else (None, None)


def qualite_de(texte):
    plat = normaliser(texte).split()
    for valeur, motifs in _QUALITES:
        for m in motifs:
            if _trouver(plat, m.split()) is not None:
                return valeur, m
    return None, None


def _motifs_qualite(texte) -> list:
    """Tous les motifs de qualité présents (retirés du nom du modèle)."""
    plat = normaliser(texte).split()
    return [m for _, motifs in _QUALITES for m in motifs if _trouver(plat, m.split()) is not None]


def _sans_motifs(texte: str, motifs: list) -> str:
    """Texte brut privé des jetons couverts par les motifs (et des mots vides)."""
    jetons = _jetons(texte)
    plat, origine = [], []
    for i, (_, subs) in enumerate(jetons):
        for s in subs:
            plat.append(s)
            origine.append(i)
    retires = set()
    for m in motifs:
        if not m:
            continue
        mm = m.split()
        # Chaque occurrence (« Écran LCD + Tactile LCD ») : jamais un nom de modèle
        for pos in range(len(plat) - len(mm) + 1):
            if plat[pos:pos + len(mm)] != mm:
                continue
            couverts = set(range(pos, pos + len(mm)))
            for i in {origine[p] for p in couverts}:
                if all(p in couverts for p, o in enumerate(origine) if o == i):
                    retires.add(i)
    garde = []
    for i, (brut, subs) in enumerate(jetons):
        if i in retires:
            continue
        if brut == "/":
            # Nom groupé écrit avec espaces (« iPhone 12 / 12 Pro ») : gardé pour grille.variantes
            if garde and garde[-1] != "/":
                garde.append("/")
        elif subs and not all(s in _MOTS_VIDES for s in subs):
            garde.append(brut)
    while garde and garde[-1] == "/":
        garde.pop()
    return " ".join(garde)


def _scinder(cle: str, sans_ref_apple: bool = False) -> str:
    """« reno10 » → « reno 10 », « ce4 » → « ce 4 » ; références Apple A1234 retirées au second niveau."""
    out = []
    for t in cle.split():
        if sans_ref_apple and re.fullmatch(r"a\d{4}", t):
            continue
        out.extend(re.findall(r"[a-z]+|\d+", t))
    return " ".join(out)


# Taille d'écran en pouces (« 10.2" », « 13 pouces ») : retirée au dernier niveau seulement
_TAILLE = re.compile(r"\b\d{1,2}(?:[.,]\d{1,2})?\s*(?:\"|”|″|''|pouces?\b|inch(?:es)?\b)", re.IGNORECASE)
# Niveaux de correspondance, du plus strict au plus tolérant : nom écrit à l'identique (références,
# années et tailles comprises) ; nom normalisé ; sans 5G/4G ni année ; sans référence Apple A1234 ;
# sans taille d'écran en pouces
NIVEAUX = ("exact", "modele", "souple", "sans_ref", "sans_taille")


def _cle_exacte(nom) -> str:
    """Nom complet normalisé, marque en tête retirée : « MacBook Air 13" A1466 (2013-2017) » garde
    sa référence et ses années (le nom normalisé les retire et le confond avec l'A1932)."""
    toks = _cle_texte(nom).split()
    if toks and toks[0] in grille._MARQUES_CONNUES:
        toks = toks[1:]
    return " ".join(toks)


def cles_modele(modele, marque) -> dict:
    """{niveau: clés} d'un modèle, une clé par nom déplié (« iPhone 12/12 Pro »)."""
    apple = grille.marque_canonique(marque) == "apple" or grille.marque_canonique(grille.deviner_marque(modele)) == "apple"
    out = {n: set() for n in NIVEAUX}
    for v in grille.variantes(modele):
        out["exact"].add(_cle_exacte(v))
        c = grille.cle_modele(v, marque or "")
        if c:
            souple = grille.cle_souple(c)
            out["modele"].add(_scinder(c))
            out["souple"].add(_scinder(souple))
            out["sans_ref"].add(_scinder(souple, sans_ref_apple=apple))
        c2 = grille.cle_modele(_TAILLE.sub(" ", v), marque or "")
        if c2:
            out["sans_taille"].add(_scinder(grille.cle_souple(c2), sans_ref_apple=apple))
    return {n: frozenset(x - {""}) for n, x in out.items()}


def _cle_texte(texte) -> str:
    return _scinder(normaliser(str(texte or "").replace("+", " plus ")))


def _cle_ref(ref) -> str:
    return normaliser(ref).replace(" ", "")


def interpreter(ligne: dict) -> dict:
    """Marque, modèle, pièce et qualité d'une ligne (colonnes dédiées, sinon désignation)."""
    designation = ligne.get("designation") or ""
    piece_des, motif_des = piece_de(designation)
    plat = normaliser(designation).split()
    # Accessoire nommé avant la pièce : ni la désignation ni une colonne « Type » n'en font la pièce
    accessoire = any(t in _ACCESSOIRES for t in plat[:_trouver(plat, motif_des.split())]) if piece_des else \
        any(t in _ACCESSOIRES for t in plat[:1])
    piece = piece_de(ligne["type_piece"])[0] if ligne.get("type_piece") else None
    piece = None if accessoire else (piece or piece_des)
    if ligne.get("qualite"):
        qualite = qualite_de(ligne["qualite"])[0] or " ".join(ligne["qualite"].split())[:50]
    else:
        qualite = qualite_de(designation)[0]
    if ligne.get("modele"):
        modele = ligne["modele"]
    else:
        modele = _sans_motifs(designation, [motif_des] + _motifs_qualite(designation))
    marque = ligne.get("marque") or ""
    devinee = False
    if not grille.marque_canonique(marque):
        marque = grille.deviner_marque(modele)
        devinee = bool(marque)
    return {"marque": marque, "marque_c": grille.marque_canonique(marque), "marque_devinee": devinee,
            "modele": " ".join(str(modele or "").split()), "piece": piece, "qualite": qualite}


# ─── Index des pièces de la base ────────────────────────────────

def _qualite_base(q):
    if not q or not str(q).strip():
        return None
    v, _ = qualite_de(q)
    return v or " ".join(str(q).split())


def _piece_base(type_piece):
    cle, _ = piece_de(type_piece)
    return cle or normaliser(type_piece)


class Index:
    """Pièces de la cible, indexées par référence, nom fournisseur et clés de modèle."""

    def __init__(self, cur, cible: str):
        self.cible = cible
        self.entrees = []
        self.par_ref, self.par_nom = {}, {}
        self.idx = {n: {} for n in NIVEAUX}
        self.marques_affichees, self.categories = {}, {}
        if cible == "tarifs":
            cur.execute("""
                SELECT id, marque, modele, type_piece, qualite, nom_fournisseur, ref_fournisseur, fournisseur,
                       prix_fournisseur_ht, prix_client, categorie, verrou_manuel, obsolete
                FROM tarifs ORDER BY id
            """)
            for r in cur.fetchall() or []:
                cles = cles_modele(r["modele"], r["marque"])
                e = {
                    "cle": f"tarifs:{r['id']}", "id": r["id"], "table": "tarifs", "colonne": None,
                    "label": prix._label_tarifs(r), "marque_c": grille.marque_canonique(r["marque"]),
                    "modele": r["modele"], "piece": _piece_base(r["type_piece"]), "qualite": _qualite_base(r["qualite"]),
                    "cles": cles, "ht": r["prix_fournisseur_ht"], "client": r["prix_client"],
                    "type_piece": r["type_piece"], "categorie": r["categorie"], "verrou": bool(r["verrou_manuel"]),
                    "obsolete": bool(r["obsolete"]), "fournisseur": r["fournisseur"], "ref": r["ref_fournisseur"],
                    "nom": r["nom_fournisseur"],
                }
                self._ajouter(e)
                self.marques_affichees.setdefault(e["marque_c"], r["marque"])
                for k in cles["modele"]:
                    self.categories.setdefault((e["marque_c"], k), r["categorie"])
        else:
            cur.execute("""
                SELECT id, categorie, modele, ecran_prix_ht, batterie_prix_ht, ecran_prix_vente, batterie_prix_vente,
                       verrou_manuel, obsolete, actif, fournisseur, ref_fournisseur
                FROM tarifs_apple_devices ORDER BY id
            """)
            for r in cur.fetchall() or []:
                cles = cles_modele(r["modele"], "Apple")
                for piece in prix.PIECES_APPLE:
                    self._ajouter({
                        "cle": prix.tarif_cle("tarifs_apple_devices", r["id"], piece), "id": r["id"],
                        "table": "tarifs_apple_devices", "colonne": piece, "label": prix._label_apple(r, piece),
                        "marque_c": "apple", "modele": r["modele"], "piece": piece, "qualite": None,
                        "cles": cles, "ht": r[f"{piece}_prix_ht"],
                        "client": r[f"{piece}_prix_vente"], "type_piece": piece, "categorie": r["categorie"],
                        "verrou": bool(r["verrou_manuel"]), "obsolete": bool(r["obsolete"]) or r["actif"] is False,
                        "fournisseur": r["fournisseur"], "ref": None, "nom": None,
                    })

    def _ajouter(self, e):
        self.entrees.append(e)
        if e.get("ref"):
            self.par_ref.setdefault(_cle_ref(e["ref"]), []).append(e)
        if e.get("nom"):
            self.par_nom.setdefault(_cle_texte(e["nom"]), []).append(e)
        for niveau in NIVEAUX:
            for k in e["cles"][niveau]:
                self.idx[niveau].setdefault((e["piece"], k), []).append(e)

    def _qualite(self, cands, piece, qualite):
        if self.cible != "tarifs":
            return cands
        if piece == "ecran":
            return [e for e in cands if e["qualite"] == qualite]
        meme = [e for e in cands if e["qualite"] == qualite]
        return meme or [e for e in cands if e["qualite"] is None]

    @staticmethod
    def _choisir(cands, cles, niveau):
        """(entrées visées, ambigu) : celles dont les clés égalent celles de la ligne, sinon, pour
        chaque modèle de la ligne, celle qui ne désigne que lui (à défaut celles qui le contiennent).
        ambigu : un modèle de la ligne désigne plusieurs pièces (ex. trois MacBook Air 13" que seule
        leur référence distingue) — jamais toutes à la fois, la ligne s'associe à la main."""
        egaux = [e for e in cands if e["cles"][niveau] == cles]
        if egaux:
            return egaux, len(egaux) > 1
        out, vus, ambigu = [], set(), False
        for k in sorted(cles):
            seuls = [e for e in cands if e["cles"][niveau] == {k}]
            groupe = seuls or [e for e in cands if k in e["cles"][niveau]]
            ambigu = ambigu or len(groupe) > 1
            for e in groupe:
                if e["cle"] not in vus:
                    vus.add(e["cle"])
                    out.append(e)
        return out, ambigu

    def associer(self, ligne: dict, interp: dict):
        """(entrées, niveau, raison) : entrées vides et raison si la ligne n'est pas reconnue."""
        if ligne.get("reference"):
            trouves = self.par_ref.get(_cle_ref(ligne["reference"]))
            if trouves:
                return trouves, "ref", None
        if ligne.get("designation"):
            trouves = self.par_nom.get(_cle_texte(ligne["designation"]))
            if trouves:
                return trouves, "designation", None
        piece = interp["piece"]
        if piece is None:
            return [], None, "type de pièce non reconnu"
        if self.cible == "tarifs_apple_devices" and piece not in prix.PIECES_APPLE:
            return [], None, "pièce non gérée pour iPad / MacBook (écran ou batterie)"
        if not interp["modele"]:
            return [], None, "modèle non reconnu"
        if self.cible == "tarifs_apple_devices" and interp["marque_c"] not in ("", "apple"):
            return [], None, "marque autre qu'Apple"
        toutes = cles_modele(interp["modele"], interp["marque"])
        partiel = None
        for niveau in NIVEAUX:
            cles = toutes[niveau]
            if not cles:
                continue
            cands, vus = [], set()
            for k in cles:
                for e in self.idx[niveau].get((piece, k), []):
                    if e["cle"] not in vus:
                        vus.add(e["cle"])
                        cands.append(e)
            if interp["marque_c"]:
                cands = [e for e in cands if e["marque_c"] == interp["marque_c"]]
            cands = self._qualite(cands, piece, interp["qualite"])
            if not cands:
                continue
            choisis, ambigu = self._choisir(cands, cles, niveau)
            if not choisis:
                continue
            if len({e["marque_c"] for e in choisis}) > 1:
                return [], None, "marque ambiguë : précisez la marque"
            if ambigu or (len(cles) == 1 and len({e["cles"]["modele"] for e in choisis}) > 1):
                return [], None, "plusieurs modèles possibles : associez la ligne à la main"
            if piece == "ecran" and self.cible == "tarifs" and len({e["qualite"] for e in choisis}) > 1:
                return [], None, "qualité d'écran à préciser"
            # Nom groupé (« Galaxy A52 / A52s ») : un niveau qui trouve chacun de ses modèles d'abord
            if len(cles) > 1 and not all(any(k in e["cles"][niveau] for e in choisis) for k in cles):
                partiel = partiel or (choisis, niveau)
                continue
            return choisis, niveau, None
        if partiel:
            return partiel[0], partiel[1], None
        if self.cible == "tarifs" and piece == "ecran" and interp["qualite"] is None:
            return [], None, "qualité d'écran à préciser"
        return [], None, "aucune pièce correspondante"

    def categorie_nouvelle(self, interp, cles) -> str:
        if self.cible == "tarifs_apple_devices":
            toks = " ".join(cles).split()
            return "macbook" if "macbook" in toks else "ipad" if "ipad" in toks else None
        for k in cles:
            c = self.categories.get((interp["marque_c"], k))
            if c:
                return c
        if any(p in " ".join(cles).split() for p in _PLIANTS):
            return "pliant"
        return "standard"


# ─── Ancien → nouveau d'une pièce (mêmes alertes partout) ──────

# Alertes qui exigent une confirmation explicite (ligne décochée par défaut dans l'aperçu ;
# association manuelle appliquée seulement si sa ligne est confirmée)
ALERTES_A_CONFIRMER = ("variation", "marge")


def _est_ecran(e: dict) -> bool:
    if e["table"] == "tarifs_apple_devices":
        return e["colonne"] == "ecran"
    return _piece_base(e["type_piece"]) == "ecran"


def evaluer_piece(e: dict, ht, r: dict) -> dict:
    """Ancien → nouveau d'une pièce pour le HT lu dans le fichier.

    e : entrée d'Index ou description de prix.decrire_tarifs (table, colonne, type_piece,
    categorie, ht, client, verrou). → {nouveau_client, change, alertes} ; alertes, dans l'ordre :
    'verrou' (jamais modifiée), 'variation' (> seuil en % ou en € des règles, si le prix change),
    'marge' (écran dont la marge passe sous le seuil des règles).
    """
    ht = Decimal(str(ht))
    if e["table"] == "tarifs":
        nouveau_client = prix.prix_client(ht, e["type_piece"], e["categorie"], r)
    else:
        nouveau_client = prix.prix_apple(ht, e["categorie"], r)
    change = e["ht"] is None or Decimal(e["ht"]) != ht or e["client"] != nouveau_client
    alertes = prix.alertes_variation(e["ht"], ht, r) if change else []
    if _est_ecran(e) and prix.marge(nouveau_client, ht, r) < r["seuil_marge_alerte"]:
        alertes.append("marge")
    if e["verrou"]:
        alertes.insert(0, "verrou")
    return {"nouveau_client": nouveau_client, "change": change, "alertes": alertes}


# ─── Aperçu ─────────────────────────────────────────────────────

def _ligne_fichier(row, positions) -> dict:
    out = {}
    for champ, pos in positions.items():
        v = row[pos] if pos < len(row) else None
        out[champ] = v if champ == "prix_ht" else _texte(v)
    return out


def _brut(ligne: dict) -> str:
    if ligne.get("designation"):
        return ligne["designation"][:200]
    return " ".join(str(ligne.get(c) or "") for c in ("reference", "marque", "modele", "type_piece", "qualite")).strip()[:200]


def _num(v):
    return None if v is None else float(v)


def _modele_affiche(interp: dict) -> str:
    modele = interp["modele"]
    if interp["marque_devinee"]:
        toks = modele.split()
        # Marque déduite du nom : « Samsung Galaxy S25 » → « Galaxy S25 » (une gamme reste : « iPhone 17 »)
        if toks and normaliser(toks[0]) in grille._MARQUES_CONNUES:
            modele = " ".join(toks[1:])
    return modele[:100]


# Marque écrite d'une marque reconnue absente de la base (sinon : celle de la base)
_MARQUES_ECRITES = {"oneplus": "OnePlus"}


def _marque_affichee(index, interp: dict):
    """« Samsung » pour samsung, « Apple » pour une ligne « iPhone 13 » (marque de la base d'abord)."""
    c = interp["marque_c"]
    if not c:
        return None
    return index.marques_affichees.get(c) or _MARQUES_ECRITES.get(c) or c.capitalize()


def _non_reconnue(ligne: dict, interp: dict, raison: str, index) -> dict:
    """Ligne à associer à la main : prix HT lu, désignation, et marque / modèle / type de pièce /
    qualité devinés (None si inconnus) pour préremplir la recherche de la pièce."""
    apple = index.cible == "tarifs_apple_devices"
    marque = "Apple" if apple and interp["marque_c"] in ("", "apple") else _marque_affichee(index, interp)
    piece = interp["piece"]
    return {
        "n": ligne["n"], "brut": _brut(ligne), "raison": raison,
        "designation": _brut(ligne), "nouveau_ht": float(ligne["prix_ht"]), "ref": ligne.get("reference") or None,
        "marque": marque, "modele": _modele_affiche(interp) or None,
        "type_piece": (piece if apple else _TYPE_PIECE.get(piece)) if piece else None,
        "qualite": None if apple else interp["qualite"],
    }


def _candidats(index, interp: dict) -> set:
    """Clés des pièces de la base qu'une ligne non reconnue pourrait désigner : même pièce et même
    modèle à l'un des niveaux de correspondance (marque égale si la ligne en a une). Ligne sans
    pièce ou sans modèle reconnus : aucune."""
    if not interp["piece"] or not interp["modele"]:
        return set()
    toutes = cles_modele(interp["modele"], interp["marque"])
    out = set()
    for niveau in NIVEAUX:
        for k in toutes[niveau]:
            for e in index.idx[niveau].get((interp["piece"], k), []):
                if not interp["marque_c"] or e["marque_c"] == interp["marque_c"]:
                    out.add(e["cle"])
    return out


def _absentes(index, vues: set, nouvelles_cles: dict, fournisseur: str, proteges: set = frozenset()) -> list:
    """Pièces du même fournisseur absentes du fichier, limitées à ce que le fichier couvre.

    Couvert = mêmes marque ET type de pièce (et qualité pour un écran) qu'une ligne reconnue ou
    nouvelle du fichier : un fichier d'écrans Samsung ne rend jamais absentes les batteries
    Samsung, ni les écrans Apple ; un fichier d'écrans « Original » jamais les « Incell ».
    iPad / MacBook : (catégorie, pièce), et une ligne n'est absente que si chacune de ses pièces
    à prix est couverte (l'obsolescence vaut pour la ligne).
    Jamais absente : une pièce visée, ni une pièce qu'une ligne non reconnue, invalide ou sans
    prix du fichier pourrait désigner (proteges) — elle est peut-être dans le fichier.
    """
    apple = index.cible == "tarifs_apple_devices"
    exclues = set(vues) | set(proteges)

    def couple(marque_c, piece, qualite, categorie):
        return (categorie, piece) if apple else (marque_c, piece, qualite if piece == "ecran" else None)

    def de(e):
        return couple(e["marque_c"], e["piece"], e["qualite"], e["categorie"])

    def vue(e):
        return {"cle": e["cle"], "label": e["label"], "verrou": e["verrou"],
                "type_piece": _TYPE_PIECE.get(e["piece"], e["piece"]) if apple else e["type_piece"]}

    couverts = {de(e) for e in index.entrees if e["cle"] in vues}
    couverts |= {couple(k[0], k[2], k[3], n["categorie"]) for k, n in nouvelles_cles.items()}
    meme = normaliser(fournisseur)
    candidates = [e for e in index.entrees
                  if not e["obsolete"] and normaliser(e["fournisseur"] or "Mobilax") == meme]
    if not apple:
        return [vue(e) for e in candidates if e["cle"] not in exclues and de(e) in couverts]
    par_ligne = {}
    for e in candidates:
        par_ligne.setdefault(e["id"], []).append(e)
    out = []
    for es in par_ligne.values():
        a_prix = [e for e in es if e["ht"] is not None or e["client"] is not None]
        if a_prix and not any(e["cle"] in exclues for e in es) and all(de(e) in couverts for e in a_prix):
            out += [vue(e) for e in a_prix]
    return out


def apercu(cur, nom_fichier: str, contenu: bytes, fournisseur: str, cible: str, mapping=None, r=None,
           par: str = None) -> dict:
    """Analyse le fichier et prépare l'import, SANS écrire aucun prix (une ligne tarifs_imports).

    → {import_id, evaluer_url, colonnes, mapping, reconnues, nouvelles, non_reconnues, invalides,
    absentes, resume}. non_reconnues : [{n, brut, raison, designation, nouveau_ht, ref, marque,
    modele, type_piece, qualite}] (marque… devinés, None si inconnus) ; une association manuelle
    se pré-évalue par evaluer_url (cf. evaluer) et s'applique par appliquer (associations).
    """
    if cible not in CIBLES:
        raise ImportErreur("Cible : 'tarifs' ou 'tarifs_apple_devices'")
    fournisseur = " ".join(str(fournisseur or "Mobilax").split())[:60] or "Mobilax"
    r = r or prix.regles(cur)
    mapping = valider_mapping(mapping)
    lignes_fichier = lire_tableau(nom_fichier, contenu)
    if not mapping:
        memorise = params_cache.get_param(cle_mapping(fournisseur), "", cur)
        try:
            m = valider_mapping(memorise) if memorise else {}
        except ImportErreur:
            m = {}
        if m:
            try:
                detecter_entete(lignes_fichier, m)
                mapping = m
            except ImportErreur:
                mapping = {}
    i_entete, colonnes, mapping = detecter_entete(lignes_fichier, mapping or None)
    positions = {champ: colonnes.index(col) for champ, col in mapping.items()}

    index = Index(cur, cible)
    lues, invalides, ignorees = [], [], 0
    sans_prix_valide = []   # lignes invalides ou sans prix : leurs pièces ne sont jamais « absentes »
    for i, row in enumerate(lignes_fichier[i_entete + 1:], start=i_entete + 2):
        if not any(_texte(c) for c in row):
            continue
        ligne = _ligne_fichier(row, positions)
        try:
            ht = lire_prix(ligne["prix_ht"])
        except ValueError:
            invalides.append({"n": i, "brut": _brut(ligne), "raison": f"prix illisible : {_texte(ligne['prix_ht'])[:30]}"})
            sans_prix_valide.append(ligne)
            continue
        if ht is None:
            ignorees += 1
            sans_prix_valide.append(ligne)
            continue
        if ht <= 0 or ht > _MAX_HT:
            invalides.append({"n": i, "brut": _brut(ligne), "raison": "prix nul, négatif ou hors limites"})
            sans_prix_valide.append(ligne)
            continue
        ligne["prix_ht"], ligne["n"] = ht, i
        lues.append(ligne)
    if not lues and not invalides:
        raise ImportErreur("Aucune ligne de prix dans le fichier")

    reconnues, nouvelles, non_reconnues = [], [], []
    par_cle, nouvelles_cles, proteges = {}, {}, set()
    for ligne in sans_prix_valide:
        proteges |= _candidats(index, interpreter(ligne))
    for ligne in lues:
        interp = interpreter(ligne)
        trouves, niveau, raison = index.associer(ligne, interp)
        if trouves:
            for e in trouves:
                ev = evaluer_piece(e, ligne["prix_ht"], r)
                rec = {
                    "n": ligne["n"], "cle": e["cle"], "label": e["label"], "designation": _brut(ligne),
                    "niveau": niveau, "ancien_ht": _num(e["ht"]), "nouveau_ht": float(ligne["prix_ht"]),
                    "ancien_client": e["client"], "nouveau_client": ev["nouveau_client"], "change": ev["change"],
                    "verrou": e["verrou"], "obsolete": e["obsolete"], "ref": ligne.get("reference") or None,
                    "alertes": ev["alertes"],
                }
                reconnues.append(rec)
                par_cle.setdefault(e["cle"], []).append(rec)
            continue
        cles = cles_modele(interp["modele"], interp["marque"])["modele"] if interp["modele"] else frozenset()
        complet = (interp["piece"] and cles and interp["marque_c"]
                   and (cible == "tarifs" or interp["piece"] in prix.PIECES_APPLE))
        categorie = index.categorie_nouvelle(interp, cles) if complet else None
        if complet and categorie and raison == "aucune pièce correspondante":
            if cible == "tarifs" and ligne.get("categorie") in prix.CATEGORIES_ECRAN:
                categorie = ligne["categorie"]
            cle_n = (interp["marque_c"], cles, interp["piece"], interp["qualite"])
            if cle_n in nouvelles_cles:
                non_reconnues.append(_non_reconnue(ligne, interp, "doublon d'une nouvelle pièce", index))
                proteges |= _candidats(index, interp)
                continue
            if cible == "tarifs":
                marque = _marque_affichee(index, interp)
                client = prix.prix_client(ligne["prix_ht"], _TYPE_PIECE[interp["piece"]], categorie, r)
            else:
                marque, client = "Apple", prix.prix_apple(ligne["prix_ht"], categorie, r)
            nouv = {
                "n": ligne["n"], "designation": _brut(ligne), "marque": marque, "modele": _modele_affiche(interp),
                "type_piece": _TYPE_PIECE[interp["piece"]] if cible == "tarifs" else interp["piece"],
                "qualite": interp["qualite"] if cible == "tarifs" else None, "categorie": categorie,
                "nouveau_ht": float(ligne["prix_ht"]), "nouveau_client": client, "ref": ligne.get("reference") or None,
                "coche": False,
            }
            nouvelles_cles[cle_n] = nouv
            nouvelles.append(nouv)
            continue
        non_reconnues.append(_non_reconnue(ligne, interp, raison or "ligne incomplète", index))
        proteges |= _candidats(index, interp)

    # Une pièce visée par plusieurs lignes : prix différents → conflit ; même prix → doublon
    for cle, recs in par_cle.items():
        if len(recs) > 1:
            prix_distincts = {rec["nouveau_ht"] for rec in recs}
            for j, rec in enumerate(recs):
                if len(prix_distincts) > 1:
                    rec["alertes"].insert(0, "conflit")
                elif j > 0:
                    rec["alertes"].insert(0, "doublon")
    for rec in reconnues:
        rec["alerte"] = rec["alertes"][0] if rec["alertes"] else None
        rec["coche"] = not ({"verrou", "conflit", "doublon", "variation"} & set(rec["alertes"]))

    absentes = _absentes(index, set(par_cle), nouvelles_cles, fournisseur, proteges)
    par_type = {}
    for a in absentes:
        par_type[a["type_piece"]] = par_type.get(a["type_piece"], 0) + 1

    resume = {
        "lignes": len(lues) + len(invalides), "reconnues": len({rec["n"] for rec in reconnues}),
        "pieces_reconnues": len(par_cle),
        "a_modifier": len({rec["cle"] for rec in reconnues if rec["change"] and not rec["verrou"]}),
        "inchangees": len({rec["cle"] for rec in reconnues if not rec["change"]}),
        "verrouillees": len({rec["cle"] for rec in reconnues if rec["verrou"]}),
        "alertes": sum(1 for rec in reconnues if rec["alertes"]),
        "nouvelles": len(nouvelles), "non_reconnues": len(non_reconnues), "invalides": len(invalides),
        "ignorees": ignorees, "absentes": len(absentes), "absentes_par_type": par_type,
    }
    resultat = {
        "colonnes": [c for c in colonnes if c], "mapping": mapping, "fichier": (nom_fichier or "")[:200],
        "fournisseur": fournisseur, "cible": cible, "reconnues": reconnues, "nouvelles": nouvelles,
        "non_reconnues": non_reconnues, "invalides": invalides, "absentes": absentes, "resume": resume,
    }
    donnees = {
        "lignes": {str(l["n"]): {"ht": str(l["prix_ht"]), "ref": l.get("reference") or None} for l in lues},
        "reconnues": [{"n": rec["n"], "cle": rec["cle"]} for rec in reconnues],
        "nouvelles": nouvelles, "invalides": [x["n"] for x in invalides],
        "absentes": [a["cle"] for a in absentes], "mapping": mapping,
    }
    cur.execute("""
        INSERT INTO tarifs_imports (fichier, fournisseur, cible, statut, resume, par, le)
        VALUES (%s, %s, %s, 'apercu', %s::jsonb, %s, NOW()) RETURNING id
    """, ((nom_fichier or "")[:200], fournisseur, cible,
          json.dumps({"resume": resume, "donnees": donnees}, default=str), par))
    resultat["import_id"] = cur.fetchone()["id"]
    # Pré-évaluation d'une association manuelle (sans écriture) : POST {associations:[{n, cle}]}
    resultat["evaluer_url"] = f"/api/tarifs/import-fichier/{resultat['import_id']}/evaluer"
    # Aperçus jamais appliqués : détail effacé au bout de 7 jours (le résumé reste)
    cur.execute("""
        UPDATE tarifs_imports SET statut = 'expire', resume = jsonb_build_object('resume', resume -> 'resume')
        WHERE statut = 'apercu' AND le < NOW() - INTERVAL '7 days'
    """)
    return resultat


# ─── Application ────────────────────────────────────────────────

def _liste_n(v, nom) -> list:
    if v in (None, []):
        return []
    if not isinstance(v, list) or len(v) > MAX_LIGNES:
        raise ImportErreur(f"{nom} : liste de numéros de ligne attendue")
    try:
        return [int(x) for x in v]
    except (TypeError, ValueError):
        raise ImportErreur(f"{nom} : numéros de ligne entiers attendus")


def _association(a, cible: str) -> tuple:
    """(n, clé canonique) d'une association {n, cle} ; ImportErreur si invalide."""
    if not isinstance(a, dict):
        raise ImportErreur("associations : objets {n, cle} attendus")
    try:
        n = int(a.get("n"))
        table, ligne_id, col = prix.parse_tarif_cle(a.get("cle"))
    except (TypeError, ValueError):
        raise ImportErreur(f"Association invalide : {a!r}"[:200])
    if table != cible:
        raise ImportErreur(f"Association {a.get('cle')} : pièce d'une autre table que la cible")
    return n, prix.tarif_cle(table, ligne_id, col)


def _imports_apercu(cur, import_id: int, verrouiller: bool):
    cur.execute("SELECT id, fournisseur, cible, statut, resume FROM tarifs_imports WHERE id = %s"
                + (" FOR UPDATE" if verrouiller else ""), (import_id,))
    imp = cur.fetchone()
    if imp is None:
        raise LookupError("Import inconnu")
    if imp["statut"] != "apercu":
        raise RuntimeError("Cet aperçu a déjà été appliqué, annulé ou a expiré : relancez l'aperçu")
    return imp


def _vue_association(n: int, cle: str, d: dict, ht: Decimal, r: dict) -> dict:
    ev = evaluer_piece(d, ht, r)
    return {
        "n": n, "cle": cle, "label": d["label"], "ancien_ht": _num(d["ht"]), "nouveau_ht": float(ht),
        "ancien_client": d["client"], "nouveau_client": ev["nouveau_client"], "change": ev["change"],
        "verrou": d["verrou"], "obsolete": d["obsolete"],
        "alerte": ev["alertes"][0] if ev["alertes"] else None, "alertes": ev["alertes"],
        "confirmation_requise": any(a in ALERTES_A_CONFIRMER for a in ev["alertes"]),
    }


def evaluer(cur, import_id: int, associations, r=None) -> list:
    """Pré-évalue des associations manuelles d'un aperçu, SANS rien écrire.

    associations : [{n, cle}] (n : ligne non reconnue du fichier, cle : pièce de la cible).
    → [{n, cle, label, ancien_ht, nouveau_ht, ancien_client, nouveau_client, change, verrou,
    obsolete, alerte, alertes, confirmation_requise}] dans l'ordre reçu ; mêmes calculs et mêmes
    alertes que les lignes reconnues (evaluer_piece). Association inapplicable (ligne absente de
    l'aperçu ou invalide, clé invalide, autre table, pièce introuvable) : {n, cle, erreur}.
    LookupError : import inconnu ; RuntimeError : aperçu déjà appliqué, annulé ou expiré.
    """
    if not isinstance(associations, list) or len(associations) > MAX_LIGNES:
        raise ImportErreur("associations : liste {n, cle} attendue")
    imp = _imports_apercu(cur, import_id, verrouiller=False)
    r = r or prix.regles(cur)
    lignes = ((imp["resume"] or {}).get("donnees") or {}).get("lignes") or {}
    lues = []
    for a in associations:
        if not isinstance(a, dict):
            raise ImportErreur("associations : objets {n, cle} attendus")
        try:
            lues.append(_association(a, imp["cible"]) + (None,))
        except ImportErreur as e:
            lues.append((a.get("n"), a.get("cle"), str(e)))
    descs = prix.decrire_tarifs(cur, [cle for _, cle, err in lues if err is None], r)
    out = []
    for n, cle, err in lues:
        info = lignes.get(str(n)) if err is None else None
        if err is None and info is None:
            err = f"Ligne {n} : absente de l'aperçu ou invalide"
        if err is None and cle not in descs:
            err = f"Pièce introuvable : {cle}"
        if err:
            out.append({"n": n, "cle": cle, "erreur": err})
            continue
        out.append(_vue_association(n, cle, descs[cle], Decimal(info["ht"]), r))
    return out


def appliquer(cur, import_id: int, choix: dict, par: str, r=None) -> dict:
    """Applique les lignes choisies d'un aperçu, en une transaction (celle de `cur`).

    choix : {lignes:[n], associations:[{n, cle}], nouvelles:[n], marquer_obsoletes:bool,
    ignorer_invalides:bool, confirmees:[n]}. Rien n'est écrit si un choix est invalide (ImportErreur).

    Association manuelle (n → cle) : ancien et nouveau HT / prix client recalculés à
    l'application, mêmes alertes que les lignes reconnues (evaluer_piece). Avec une alerte
    'variation' ou 'marge', elle n'est appliquée que si sa ligne est confirmée explicitement :
    n dans `lignes` (lignes cochées) ou dans `confirmees` ; sinon ignorée et listée dans
    associations_ignorees. Une pièce verrouillée n'est jamais modifiée : comptée dans verrouilles,
    et son association listée dans associations_verrouillees (pas comptée dans associees, qui ne
    compte que les associations écrites ou confirmées). Avec marquer_obsoletes, une pièce associée
    (appliquée, ignorée ou verrouillée) n'est jamais marquée obsolète : l'admin l'a désignée dans le fichier.

    → {lot_id, modifies, ajoutes, obsoletes, verrouilles, confirmes, inchanges, associees,
    associations_ignorees:[{n, cle, label, alertes, ...}], associations_verrouillees:[{n, cle, label, ...}]}
    """
    imp = _imports_apercu(cur, import_id, verrouiller=True)
    r = r or prix.regles(cur)
    donnees = (imp["resume"] or {}).get("donnees") or {}
    cible, fournisseur = imp["cible"], imp["fournisseur"] or "Mobilax"
    if donnees.get("invalides") and not choix.get("ignorer_invalides"):
        lignes_inv = ", ".join(str(n) for n in donnees["invalides"][:10])
        raise ImportErreur(f"Le fichier contient {len(donnees['invalides'])} ligne(s) invalide(s) "
                           f"(ligne {lignes_inv}) : rien n'est appliqué. Corrigez le fichier, "
                           f"ou confirmez l'import sans ces lignes.")
    choisies = set(_liste_n(choix.get("lignes"), "lignes"))
    confirmees = choisies | set(_liste_n(choix.get("confirmees"), "confirmees"))
    nouvelles_n = set(_liste_n(choix.get("nouvelles"), "nouvelles"))
    associations = choix.get("associations") or []
    if not isinstance(associations, list) or len(associations) > MAX_LIGNES:
        raise ImportErreur("associations : liste {n, cle} attendue")
    associations = [_association(a, cible) for a in associations]
    lignes = donnees.get("lignes") or {}

    cibles = {}   # cle → (n, ht, ref)

    def viser(cle, n):
        info = lignes.get(str(n))
        if info is None:
            raise ImportErreur(f"Ligne {n} : absente de l'aperçu ou invalide")
        ht = Decimal(info["ht"])
        if cle in cibles and cibles[cle][1] != ht:
            raise ImportErreur(f"Deux lignes de prix différents pour la même pièce ({cle}) : "
                               f"lignes {cibles[cle][0]} et {n}")
        cibles.setdefault(cle, (n, ht, info.get("ref")))

    reconnues_n = {}
    for rec in donnees.get("reconnues") or []:
        reconnues_n.setdefault(rec["n"], []).append(rec["cle"])
    # Une ligne cochée est reconnue, ou associée à la main (cochée = association confirmée)
    inconnues = choisies - set(reconnues_n) - {n for n, _ in associations}
    if inconnues:
        raise ImportErreur(f"Lignes non reconnues dans l'aperçu : {', '.join(map(str, sorted(inconnues)[:10]))}")
    for n in sorted(choisies):
        for cle in reconnues_n.get(n, []):
            viser(cle, n)
    nouvelles = [x for x in donnees.get("nouvelles") or [] if x["n"] in nouvelles_n]
    if len(nouvelles) != len(nouvelles_n):
        raise ImportErreur("Nouvelles pièces : numéro de ligne inconnu")

    descs = prix.decrire_tarifs(cur, list(cibles) + [cle for _, cle in associations], r)
    manquantes = [c for c in list(cibles) + [cle for _, cle in associations] if c not in descs]
    if manquantes:
        raise ImportErreur(f"Pièce introuvable : {manquantes[0]}")
    # Associations : recalculées ici avec les alertes des lignes reconnues ; alerte non confirmée → ignorée.
    # Pièce verrouillée : jamais écrite, donc pas « associée » (comptée dans verrouilles, listée à part).
    associees, associations_ignorees, associations_verrouillees = 0, [], []
    for n, cle in associations:
        info = lignes.get(str(n))
        if info is None:
            raise ImportErreur(f"Ligne {n} : absente de l'aperçu ou invalide")
        vue = _vue_association(n, cle, descs[cle], Decimal(info["ht"]), r)
        if vue["confirmation_requise"] and n not in confirmees:
            associations_ignorees.append(vue)
            continue
        viser(cle, n)
        if descs[cle]["verrou"]:
            associations_verrouillees.append(vue)
        else:
            associees += 1
    lot = prix.nouveau_lot()
    changements, a_confirmer, verrouilles, a_desobsoleter = [], {}, set(), set()
    for cle, (n, ht, ref) in cibles.items():
        d = descs[cle]
        if d["verrou"]:
            verrouilles.add(cle)
            continue
        client = prix.client_pour(d, ht, r)
        col_ht, col_client = prix.colonnes_ht(d["table"], d["colonne"])
        if d["ht"] is not None and Decimal(d["ht"]) == ht and d["client"] == client:
            a_confirmer.setdefault(d["id"], (d["prix_maj_le"], d["prix_source"]))
        else:
            changements += [(d["id"], col_ht, ht), (d["id"], col_client, client)]
        if d["obsolete"]:
            a_desobsoleter.add(d["id"])
    res = prix.ecrire_prix_lot(cur, cible, changements, "import", par, lot)
    ecrites = {(i, c) for i, c, _, _ in res["ecrits"]}
    ids_ecrits = {i for i, _ in ecrites}
    modifies = 0
    for cle in cibles:
        d = descs[cle]
        if cle not in verrouilles and any((d["id"], c) in ecrites for c in prix.colonnes_ht(cible, d["colonne"])):
            modifies += 1
    annulation = {"confirmes": {}, "ajoutes": {}, "obsoletes": {}, "desobsoletes": {}, "refs": {}}

    # Prix inchangés : confirmés à la date du jour (fraîcheur), sans ligne d'historique
    confirmes = [(i, m, s) for i, (m, s) in a_confirmer.items() if i not in ids_ecrits]
    if confirmes:
        cur.execute(f"UPDATE {cible} SET prix_maj_le = NOW(), prix_source = 'import' "
                    f"WHERE id = ANY(%s) AND verrou_manuel IS NOT TRUE", ([i for i, _, _ in confirmes],))
        annulation["confirmes"][cible] = [[i, m.isoformat() if m else None, s] for i, m, s in confirmes]

    # Fournisseur et référence des pièces touchées
    touches = ids_ecrits | {i for i, _, _ in confirmes}
    if touches:
        refs = {}
        if cible == "tarifs":
            for cle, (n, ht, ref) in cibles.items():
                d = descs[cle]
                if d["id"] in touches:
                    refs[d["id"]] = ref
        cur.execute(f"SELECT id, ref_fournisseur, fournisseur FROM {cible} WHERE id = ANY(%s)", (sorted(touches),))
        avant = {row["id"]: row for row in cur.fetchall() or []}
        maj = []
        for i in sorted(touches):
            row = avant.get(i)
            if row is None:
                continue
            nouvelle_ref = refs.get(i) or row["ref_fournisseur"]
            if nouvelle_ref != row["ref_fournisseur"] or (row["fournisseur"] or "") != fournisseur:
                maj.append((i, nouvelle_ref, fournisseur))
                annulation["refs"].setdefault(cible, []).append([i, row["ref_fournisseur"], row["fournisseur"]])
        if maj:
            execute_values(cur, f"UPDATE {cible} AS t SET ref_fournisseur = v.ref, fournisseur = v.f "
                                f"FROM (VALUES %s) AS v(id, ref, f) WHERE t.id = v.id",
                           maj, template="(%s::integer, %s::text, %s::text)", page_size=max(len(maj), 1))
    if a_desobsoleter:
        cur.execute(f"UPDATE {cible} SET obsolete = FALSE WHERE id = ANY(%s) AND verrou_manuel IS NOT TRUE "
                    f"RETURNING id", (sorted(a_desobsoleter),))
        annulation["desobsoletes"][cible] = [row["id"] for row in cur.fetchall() or []]

    # Nouvelles pièces
    ajoutes = _inserer(cur, cible, nouvelles, fournisseur, par, lot)
    if ajoutes:
        annulation["ajoutes"][cible] = ajoutes

    # Absentes du fichier : obsolètes seulement si demandé, jamais supprimées
    obsoletes = []
    if choix.get("marquer_obsoletes"):
        # Une pièce associée à une ligne du fichier y figure, que l'association soit appliquée,
        # ignorée faute de confirmation ou bloquée par un verrou : jamais obsolète
        visees = set(cibles) | {cle for _, cle in associations}
        ids = set()
        par_ligne = {}
        for cle in donnees.get("absentes") or []:
            table, ligne_id, col = prix.parse_tarif_cle(cle)
            par_ligne.setdefault(ligne_id, set()).add(cle)
        for ligne_id, cles in par_ligne.items():
            # iPad / MacBook : la ligne entière n'est obsolète que si aucune de ses pièces n'est visée
            if not any(prix.tarif_cle(cible, ligne_id, p) in visees for p in prix.PIECES_APPLE) and \
                    f"tarifs:{ligne_id}" not in visees:
                ids.add(ligne_id)
        if ids:
            cur.execute(f"UPDATE {cible} SET obsolete = TRUE WHERE id = ANY(%s) AND obsolete IS NOT TRUE "
                        f"AND verrou_manuel IS NOT TRUE RETURNING id", (sorted(ids),))
            obsoletes = [row["id"] for row in cur.fetchall() or []]
            if obsoletes:
                annulation["obsoletes"][cible] = obsoletes

    resultat = {
        "lot_id": lot, "modifies": modifies, "ajoutes": len(ajoutes), "obsoletes": len(obsoletes),
        "verrouilles": len(verrouilles), "confirmes": len(confirmes), "inchanges": res["inchanges"],
        "associees": associees, "associations_ignorees": associations_ignorees,
        "associations_verrouillees": associations_verrouillees,
    }
    resume = dict(imp["resume"] or {})
    resume["annulation"] = annulation
    resume["resultat"] = resultat
    cur.execute("""
        UPDATE tarifs_imports SET statut = 'applique', lot_id = %s, applique_le = NOW(), par = %s, resume = %s::jsonb
        WHERE id = %s
    """, (lot, par, json.dumps(resume, default=str), import_id))
    mapping = donnees.get("mapping")
    if mapping:
        cur.execute("INSERT INTO params (cle, valeur) VALUES (%s, %s) "
                    "ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur",
                    (cle_mapping(fournisseur), json.dumps(mapping, ensure_ascii=False)))
    return resultat


def _inserer(cur, cible, nouvelles, fournisseur, par, lot) -> list:
    """Insère les nouvelles pièces (prix daté, source 'import') ; une collision n'insère rien."""
    if not nouvelles:
        return []
    historique, ids = [], []
    if cible == "tarifs":
        lignes = [(x["marque"], x["modele"], x["type_piece"], x["qualite"], x["designation"][:250],
                   Decimal(str(x["nouveau_ht"])), x["nouveau_client"], x["categorie"] or "standard",
                   fournisseur, x.get("ref")) for x in nouvelles]
        rows = execute_values(cur, """
            INSERT INTO tarifs (marque, modele, type_piece, qualite, nom_fournisseur, prix_fournisseur_ht,
                                prix_client, categorie, source, en_stock, updated_at, prix_maj_le, prix_source,
                                fournisseur, ref_fournisseur, verrou_manuel, obsolete)
            SELECT v.marque, v.modele, v.type_piece, v.qualite, v.nom, v.ht, v.client, v.categorie,
                   lower(v.fournisseur), TRUE, NOW(), NOW(), 'import', v.fournisseur, v.ref, FALSE, FALSE
            FROM (VALUES %s) AS v(marque, modele, type_piece, qualite, nom, ht, client, categorie, fournisseur, ref)
            ON CONFLICT DO NOTHING
            RETURNING id, prix_fournisseur_ht, prix_client
        """, lignes, template="(%s, %s, %s, %s, %s, %s::numeric, %s::integer, %s, %s, %s)",
            page_size=max(len(lignes), 1), fetch=True)
        for row in rows or []:
            ids.append(row["id"])
            historique += [("tarifs", row["id"], "prix_fournisseur_ht", None, row["prix_fournisseur_ht"]),
                           ("tarifs", row["id"], "prix_client", None, row["prix_client"])]
    else:
        appareils = {}
        for x in nouvelles:
            cle = (x["categorie"], normaliser(x["modele"]))
            a = appareils.setdefault(cle, {"categorie": x["categorie"], "modele": x["modele"]})
            a[f"{x['type_piece']}_prix_ht"] = Decimal(str(x["nouveau_ht"]))
            a[f"{x['type_piece']}_prix_vente"] = x["nouveau_client"]
        for a in appareils.values():
            cur.execute("""
                INSERT INTO tarifs_apple_devices (categorie, modele, ecran_prix_ht, batterie_prix_ht,
                    ecran_prix_vente, batterie_prix_vente, actif, prix_maj_le, prix_source, fournisseur,
                    verrou_manuel, obsolete)
                VALUES (%s, %s, %s, %s, %s, %s, TRUE, NOW(), 'import', %s, FALSE, FALSE) RETURNING id
            """, (a["categorie"], a["modele"], a.get("ecran_prix_ht"), a.get("batterie_prix_ht"),
                  a.get("ecran_prix_vente"), a.get("batterie_prix_vente"), fournisseur))
            i = cur.fetchone()["id"]
            ids.append(i)
            for col in ("ecran_prix_ht", "ecran_prix_vente", "batterie_prix_ht", "batterie_prix_vente"):
                if a.get(col) is not None:
                    historique.append(("tarifs_apple_devices", i, col, None, a[col]))
    if historique:
        execute_values(cur, """
            INSERT INTO tarifs_historique (table_nom, ligne_id, colonne, ancien, nouveau, source, lot_id, par)
            VALUES %s
        """, [(t, i, c, a, n, "import", lot, par) for t, i, c, a, n in historique], page_size=len(historique))
    return ids
