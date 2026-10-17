"""
Grille tarifaire branchée sur les lignes du ticket : suggestions de prestations
pour la marque et le modèle du ticket, toutes grilles confondues (prix client TTC).

Sources :
- tarifs_reparation : grille iPhone de la boutique (vitrine), une colonne par intervention ;
- tarifs : pièces fournisseur (type de pièce × qualité, stock fournisseur, coût HT) ;
- tarifs_apple_devices : iPad / MacBook (écran, batterie, coût HT) ;
- iphone_tarifs, smartphones_tarifs : téléphones à la vente, toujours classés
  après les réparations.

Correspondance de modèle tolérante mais exacte : clé normalisée (accents, casse,
« + » → plus, marque retirée, « Galaxy » facultatif, iPhone SE par année, noms
groupés « iPhone 7/8/7+/8+ » dépliés, lettres et chiffres collés ou non :
« Reno10 » = « Reno 10 », « Nord CE4 Lite » = « Nord CE 4 Lite », « Pixel 7 a » =
« Pixel 7a », références Apple A1234, « 3e gen », guillemets de taille retirés),
jamais par sous-chaîne : « iPhone 13 » ne reçoit pas les prix de l'« iPhone 13 Pro »,
ni « POCO X6 » ceux du « POCO X6 Pro ». Sans correspondance exacte, un second niveau
ignore 5G/4G et les années (hors iPhone SE). Les alias (table modeles_alias, admin)
ajoutent au modèle du ticket le nom qu'il porte dans les grilles (« iPhone Air » →
« iPhone 17 Air »).

Chaque suggestion porte la date et la source de son prix (fraîcheur : 'ok', 'a_revoir'
au-delà de 90 jours, 'perime' au-delà de 180 ou sans date, seuils de services/prix.regles) et son
groupe d'affichage : 'boutique' (liste principale), 'fournisseur' (pièce fournisseur
repliée sous « Autres pièces » : iPhone couvert par la grille boutique pour ce type de
pièce) ou 'vente' (téléphones à vendre). La limite s'applique après ce groupage : les pièces
repliées ne prennent que les places laissées par la grille boutique et les ventes. Les pièces
obsolètes ne sont jamais proposées.
"""

import re
import threading
import time
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator

from app.database import get_cursor
from app.api.auth import exiger_role_admin, get_current_user
from app.services import prestations as P
from app.services import prix as prix_srv
from app.services.prestations import normaliser

router = APIRouter(prefix="/api/grille", tags=["grille"])

# Marque saisie sous le nom de la gamme (« iPhone », « Redmi ») : marque canonique
_GAMMES = {"iphone": "apple", "ipad": "apple", "macbook": "apple", "redmi": "xiaomi", "poco": "xiaomi"}
_ALIAS_MARQUE = {**_GAMMES, "galaxy": "samsung"}
_RESEAU = {"5g", "4g", "lte"}
_ANNEE = re.compile(r"(19|20)\d{2}")
# iPhone SE : la génération se dit par l'année (« SE 2022 », « SE (3e génération) », « SE 22 »)
_SE_GENERATION = {
    "1": "2016", "16": "2016", "2016": "2016", "1re": "2016", "1st": "2016", "premiere": "2016",
    "2": "2020", "20": "2020", "2020": "2020", "2e": "2020", "2nd": "2020", "2eme": "2020", "deuxieme": "2020",
    "3": "2022", "22": "2022", "2022": "2022", "3e": "2022", "3rd": "2022", "3eme": "2022", "troisieme": "2022",
}
_MOTS_GENERATION = {"generation", "gen"}
# Marque devinée en tête du modèle quand le ticket n'en a pas (« Autre » + « Samsung Galaxy S21 »)
_MARQUES_CONNUES = {
    "apple", "samsung", "xiaomi", "google", "huawei", "oneplus", "oppo", "honor", "motorola", "sony",
    "nokia", "realme", "vivo", "asus", "lenovo", "wiko", "alcatel", "nothing", "fairphone", "crosscall",
}

_SANS_ACCENT_SQL = ("translate(replace(lower({}), '+', ' plus '), "
                    "'àâäáãéèêëíìîïóòôöõúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')")
_LIMITE_TARIFS = 3000

# (colonne, type de pièce, qualité, libellé de la ligne)
_COLONNES_GRILLE_IPHONE = [
    ("ecran_generique", "Écran", "Générique", "Forfait remplacement écran (Générique)"),
    ("ecran_confort", "Écran", "Confort", "Forfait remplacement écran (Confort)"),
    ("ecran_apple", "Écran", "Apple", "Forfait remplacement écran (Apple)"),
    ("batterie", "Batterie", None, "Forfait remplacement batterie"),
    ("connecteur_charge", "Connecteur de charge", None, "Forfait remplacement connecteur de charge"),
    ("ecouteur_apn", "Écouteur / caméra", None, "Forfait remplacement écouteur / caméra"),
    ("vitre_arriere", "Vitre arrière", None, "Forfait remplacement vitre arrière"),
    ("chassis", "Châssis", None, "Forfait remplacement châssis"),
    ("desoxydation", "Désoxydation", None, "Forfait désoxydation"),
    ("reparation_divers", "Réparation divers", None, "Forfait réparation"),
]

# Ordre d'affichage par clé de prestation (services/prestations.cle_panne)
_RANG_TYPE = {
    "ecran": 0, "batterie": 1, "connecteur": 2, "camera_arriere": 3, "camera_avant": 4,
    "vitre_arriere": 5, "vitre_camera": 6, "haut_parleur": 7, "ecouteur": 8, "micro": 9,
    "bouton_power": 10, "bouton_volume": 11, "face_id": 12, "desoxydation": 13,
}
_RANG_SOURCE = {"tarifs_reparation": 0, "tarifs": 1, "tarifs_apple_devices": 1,
                "iphone_tarifs": 5, "smartphones_tarifs": 5}
_VENTE = {"iphone_tarifs", "smartphones_tarifs"}

# Catégorie du ticket → grilles concernées (None : toutes)
_SOURCES_PAR_CATEGORIE = {
    "smartphone": {"tarifs", "tarifs_reparation", "iphone_tarifs", "smartphones_tarifs"},
    "tablette": {"tarifs", "tarifs_apple_devices"},
    "pc portable": {"tarifs", "tarifs_apple_devices"},
}


# ─── Normalisation ──────────────────────────────────────────────

def _compact(s) -> str:
    return normaliser(s).replace(" ", "")


def marque_canonique(marque) -> str:
    c = _compact(marque)
    if c == "autre":
        return ""
    return _ALIAS_MARQUE.get(c, c)


def deviner_marque(modele) -> str:
    """Premier mot du modèle s'il désigne une marque (ou une gamme : « iPhone »), sinon ''."""
    toks = normaliser(modele).split()
    if toks and (toks[0] in _MARQUES_CONNUES or toks[0] in _ALIAS_MARQUE):
        return toks[0]
    return ""


def _garder_parenthese(contenu: str) -> bool:
    # Année (« SE (2022) »), génération (« SE (2e génération) »), réseau (« (5G) ») ou numéro
    # du modèle (« Nothing Phone (2a) ») : gardés ; une référence (« (G991B) ») est retirée
    mots = normaliser(contenu).split()
    return bool(mots) and (_ANNEE.fullmatch(contenu.strip()) is not None
                           or any(m in _MOTS_GENERATION for m in mots)
                           or all(m in _RESEAU for m in mots)
                           or _NUMERO_MODELE.fullmatch(" ".join(mots)) is not None)


# « iPad 9 (2021) 10.2" » : la taille d'écran qui suit l'année ne distingue rien
_TAILLE_APRES_ANNEE = re.compile(r"(\(\s*(?:19|20)\d{2}\s*\))\s*\d{1,2}(?:[.,]\d{1,2})?\s*(?:\"|”|''|pouces?)\s*$",
                                 re.IGNORECASE)
_NUMERO_MODELE = re.compile(r"\d{1,2}[a-z]?")
_REF_APPLE = re.compile(r"a\d{4}")
_ORDINAL = re.compile(r"\d{1,2}(?:re|er|e|eme|nd|rd|st|th)")
_GAMME_COLLEE = re.compile(r"(iphone|ipad|macbook|redmi|poco)(\d\w*)")
_APPLE_TETES = {"iphone", "ipad", "macbook", "imac", "ipod"}
# Mots jamais collés au nombre qui suit : la gamme peut manquer au nom brut (prefiltre SQL),
# « plus » vient d'un « + »
_SANS_COLLE = set(_GAMMES) | {"plus"}


def _decoller_gammes(toks: list) -> list:
    """« iPhone13 » → iphone 13 (la gamme reste un mot à part, cf. _SANS_COLLE)."""
    out = []
    for t in toks:
        m = _GAMME_COLLEE.fullmatch(t)
        out.extend(m.groups() if m else (t,))
    return out


def _sans_generation(toks: list) -> list:
    """« 3e gen » après un numéro (« iPad Pro 11" 3e gen M1 ») : retiré, le modèle se dit par la
    puce ou l'année ; sans numéro avant (« iPad Air (4e génération) ») : c'est le numéro (air 4).
    L'iPhone SE est traité avant (_generation_se : la génération y devient l'année)."""
    out, i = [], 0
    while i < len(toks):
        if _ORDINAL.fullmatch(toks[i]) and i + 1 < len(toks) and toks[i + 1] in _MOTS_GENERATION:
            if not (out and out[-1][-1:].isdigit()):
                out.append(re.match(r"\d+", toks[i]).group(0))
            i += 2
            continue
        out.append(toks[i])
        i += 1
    return out


def _coller(toks: list) -> list:
    """Lettres et chiffres d'un même nom : « reno 10 » = « reno10 », « ce 4 » = « ce4 »,
    « 7 a » = « 7a », « 13pro » = « 13 pro ». Jamais une année ni un réseau (second niveau),
    ni après une gamme."""
    eclates = []
    for t in toks:
        eclates.extend(re.sub(r"(\d)([a-z]{2,})", r"\1 \2", t).split())
    out = []
    for t in eclates:
        prec = out[-1] if out else ""
        if (prec.isalpha() and prec not in _SANS_COLLE and t[:1].isdigit()
                and not _ANNEE.fullmatch(t) and t not in _RESEAU):
            out[-1] = prec + t
        elif prec[-1:].isdigit() and len(t) == 1 and t.isalpha() and not _ANNEE.fullmatch(prec):
            out[-1] = prec + t
        else:
            out.append(t)
    return out


def _sans_marque(toks: list, marque) -> list:
    noms = {n for n in (_compact(marque), marque_canonique(marque)) if n}
    while toks:
        if toks[0] in noms:
            toks = toks[1:]
        elif len(toks) > 1 and toks[0] + toks[1] in noms:
            toks = toks[2:]
        else:
            break
    return toks


def _generation_se(toks: list) -> list:
    if "iphone" not in toks or "se" not in toks:
        return toks
    i = toks.index("se")
    suite = toks[i + 1] if i + 1 < len(toks) else None
    if suite in _SE_GENERATION:
        toks[i + 1] = _SE_GENERATION[suite]
        if i + 2 < len(toks) and toks[i + 2] in _MOTS_GENERATION:
            del toks[i + 2]
    else:
        # « iPhone SE » sans année = le premier (2016)
        toks.insert(i + 1, "2016")
    return toks


@lru_cache(maxsize=4096)
def cle_modele(modele, marque="") -> str:
    """Clé de comparaison d'un modèle (cf. docstring du module)."""
    s = _TAILLE_APRES_ANNEE.sub(r"\1", str(modele or "").strip())
    s = re.sub(r"\(([^)]*)\)", lambda m: f" {m.group(1)} " if _garder_parenthese(m.group(1)) else " ", s)
    toks = _decoller_gammes(normaliser(s.replace("+", " plus ")).split())
    toks = _sans_marque(toks, marque)
    gamme = _compact(marque)
    if gamme in _GAMMES and (not toks or toks[0] != gamme):
        toks = [gamme] + toks
    toks = [t for t in toks if t != "galaxy"]
    if marque_canonique(marque) == "apple" or (toks and toks[0] in _APPLE_TETES):
        toks = [t for t in toks if not _REF_APPLE.fullmatch(t)]
    return " ".join(_coller(_sans_generation(_generation_se(toks))))


def cle_souple(cle: str) -> str:
    """Second niveau : sans 5G/4G/LTE ni année (sauf l'année d'un iPhone SE)."""
    toks = cle.split()
    garde = []
    for i, t in enumerate(toks):
        if t in _RESEAU:
            continue
        if _ANNEE.fullmatch(t) and not (i and toks[i - 1] == "se"):
            continue
        garde.append(t)
    return " ".join(garde)


def variantes(modele) -> list:
    """Noms groupés dépliés : « iPhone 7/8/7+/8+ » → iPhone 7, iPhone 8, iPhone 7+, iPhone 8+."""
    parties = [p.strip() for p in str(modele or "").split("/") if p.strip()]
    if len(parties) <= 1:
        return [str(modele or "")]
    mots = parties[0].split()
    prefixe = " ".join(mots[:-1])
    tete = normaliser(mots[0]) if mots else ""
    out = [parties[0]]
    for p in parties[1:]:
        out.append(p if not prefixe or normaliser(p).split()[:1] == [tete] else f"{prefixe} {p}")
    return out


@lru_cache(maxsize=4096)
def _cles_ligne(modele_ligne, marque_ligne) -> tuple:
    cles = tuple(cle_modele(v, marque_ligne) for v in variantes(modele_ligne))
    return cles, frozenset(cle_souple(c) for c in cles)


def _score(cle: str, souple: str, modele_ligne, marque_ligne) -> int:
    """2 : correspondance exacte, 1 : au second niveau, 0 : autre modèle."""
    cles, souples = _cles_ligne(str(modele_ligne or ""), str(marque_ligne or ""))
    if cle in cles:
        return 2
    if souple and souple in souples:
        return 1
    return 0


def _score_cles(cles_ticket: list, modele_ligne, marque_ligne) -> int:
    """Meilleur score parmi les clés du ticket (son modèle, puis les noms donnés par ses alias)."""
    return max((_score(c, s, modele_ligne, marque_ligne) for c, s in cles_ticket), default=0)


def _motifs_prefiltre(cle: str) -> list:
    """Mots du modèle sûrs d'apparaître dans le nom brut sans espaces ni ponctuation (sans gamme,
    « plus », réseau ni année) : « reno10 » se trouve dans « Reno 10 » comme dans « Reno10 »."""
    return [f"%{t}%" for t in cle.split()
            if t not in _GAMMES and t != "plus" and t not in _RESEAU and not _ANNEE.fullmatch(t)]


def _mots(q) -> list:
    return normaliser(q).split()


def _contient_tout(texte: str, mots: list) -> bool:
    return all(m in texte for m in mots)


# ─── Alias de modèles (table modeles_alias) ─────────────────────
# Lus au plus toutes les 60 s (suggestions appelées à chaque ligne de ticket), relus tout de
# suite après une modification par l'admin sur ce processus.

_ALIAS_TTL = 60
_alias_verrou = threading.Lock()
_alias_etat = {"valeurs": None, "expire": 0.0}

# Alias initiaux (catalogue → nom dans les grilles), vérifiés sur les grilles de la prod :
# posés une seule fois (drapeau params), un alias retiré par l'admin ne revient pas.
# MacBook Pro 14"/16" : la grille ne connaît que les puces Pro/Max ; seuls les modèles qui
# n'existent qu'en Pro/Max sont rattachés (le 14" M3 / M4 simple garde son propre prix).
ALIAS_INITIAUX = (
    ("iPhone Air", "iPhone 17 Air"),
    ("iPad Air M1", "iPad Air 5 M1 (2022) / iPad Air 5 (2022)"),
    ("iPad Air 11 M2", 'iPad Air 6 M2 11" (2024)'),
    ("iPad Air 13 M2", 'iPad Air 6 M2 13" (2024)'),
    ("Galaxy Tab A7", "Galaxy Tab A7 10.4 (2020)"),
    ("Galaxy Tab A8", "Galaxy Tab A8 10.5 (2022)"),
    ("MacBook Pro 14 M1", 'MacBook Pro 14" M1 Pro/Max A2442 (2021)'),
    ("MacBook Pro 14 M2", 'MacBook Pro 14" M2 Pro/Max A2779 (2023)'),
    ("MacBook Pro 16 M1", 'MacBook Pro 16" M1 Pro/Max A2485 (2021)'),
    ("MacBook Pro 16 M2", 'MacBook Pro 16" M2 Pro/Max A2780 (2023)'),
    ("MacBook Pro 16 M3", 'MacBook Pro 16" M3 Pro/Max A2991 (2023)'),
    ("MacBook Pro 16 M4", 'MacBook Pro 16" M4 Pro/Max (2024)'),
)
_DRAPEAU_ALIAS = "MODELES_ALIAS_INITIAUX_2026_10"
# Texte SQL fixe, sans valeur venue de l'extérieur (main._DONNEES_FIXES) ; tests/test_prix_sources.py
# vérifie qu'il reprend exactement ALIAS_INITIAUX et _DRAPEAU_ALIAS
SQL_ALIAS_INITIAUX = """INSERT INTO modeles_alias (alias, modele_canonique)
    SELECT v.alias, v.canonique FROM (VALUES
        ('iPhone Air', 'iPhone 17 Air'),
        ('iPad Air M1', 'iPad Air 5 M1 (2022) / iPad Air 5 (2022)'),
        ('iPad Air 11 M2', 'iPad Air 6 M2 11" (2024)'),
        ('iPad Air 13 M2', 'iPad Air 6 M2 13" (2024)'),
        ('Galaxy Tab A7', 'Galaxy Tab A7 10.4 (2020)'),
        ('Galaxy Tab A8', 'Galaxy Tab A8 10.5 (2022)'),
        ('MacBook Pro 14 M1', 'MacBook Pro 14" M1 Pro/Max A2442 (2021)'),
        ('MacBook Pro 14 M2', 'MacBook Pro 14" M2 Pro/Max A2779 (2023)'),
        ('MacBook Pro 16 M1', 'MacBook Pro 16" M1 Pro/Max A2485 (2021)'),
        ('MacBook Pro 16 M2', 'MacBook Pro 16" M2 Pro/Max A2780 (2023)'),
        ('MacBook Pro 16 M3', 'MacBook Pro 16" M3 Pro/Max A2991 (2023)'),
        ('MacBook Pro 16 M4', 'MacBook Pro 16" M4 Pro/Max (2024)')
    ) AS v(alias, canonique)
    WHERE NOT EXISTS (SELECT 1 FROM params WHERE cle = 'MODELES_ALIAS_INITIAUX_2026_10')
    ON CONFLICT (alias) DO NOTHING"""
# Drapeau posé seulement si les alias sont là (table absente : erreur, rejoué au démarrage suivant)
SQL_ALIAS_INITIAUX_FLAG = """INSERT INTO params (cle, valeur) SELECT 'MODELES_ALIAS_INITIAUX_2026_10', '1'
    WHERE EXISTS (SELECT 1 FROM modeles_alias)
    ON CONFLICT (cle) DO NOTHING"""


def invalider_alias():
    with _alias_verrou:
        _alias_etat["valeurs"] = None
        _alias_etat["expire"] = 0.0


def cle_alias(texte) -> str:
    """Clé d'un nom saisi sans marque séparée (« Oppo Reno10 », « iPhone Air »)."""
    texte = str(texte or "")
    return cle_modele(texte, deviner_marque(texte))


def _lire_alias_bruts(cur) -> list:
    """Lignes de modeles_alias ; table absente (migration en échec) : aucune, sans casser la requête."""
    cur.execute("SAVEPOINT kp_alias")
    try:
        cur.execute("SELECT id, alias, modele_canonique, categorie, le FROM modeles_alias ORDER BY alias, id")
        rows = [dict(r) for r in cur.fetchall() or []]
        cur.execute("RELEASE SAVEPOINT kp_alias")
        return rows
    except Exception:
        cur.execute("ROLLBACK TO SAVEPOINT kp_alias")
        return []


def charger_alias(cur) -> list:
    """[{cle, canonique, categorie}] : clé de l'alias, nom dans les grilles, catégorie (ou None)."""
    with _alias_verrou:
        if _alias_etat["valeurs"] is not None and time.monotonic() < _alias_etat["expire"]:
            return _alias_etat["valeurs"]
    valeurs = []
    for r in _lire_alias_bruts(cur):
        cle = cle_alias(r["alias"])
        if cle and str(r.get("modele_canonique") or "").strip():
            valeurs.append({"cle": cle, "alias": r["alias"], "canonique": r["modele_canonique"],
                            "categorie": normaliser(r.get("categorie")) or None})
    with _alias_verrou:
        _alias_etat["valeurs"] = valeurs
        _alias_etat["expire"] = time.monotonic() + _ALIAS_TTL
    return valeurs


def cles_ticket(modele, marque, categorie=None, alias=None) -> list:
    """[(clé, clé souple)] : celle du modèle, puis celles des noms canoniques de ses alias
    (« iPad Air 5 M1 (2022) / iPad Air 5 (2022) » : plusieurs noms, comme un nom groupé)."""
    cle = cle_modele(modele, marque or "")
    out = [(cle, cle_souple(cle))] if cle else []
    cat = normaliser(categorie)
    for a in alias or []:
        # Alias saisi avec ou sans la marque (« Oppo Reno10 », « Reno10 »)
        if cle not in (a["cle"], cle_modele(a.get("alias") or "", marque or "")):
            continue
        if a["categorie"] and cat and a["categorie"] != cat:
            continue
        for v in variantes(a["canonique"]):
            c = cle_modele(v, marque or "")
            if c and all(c != k for k, _ in out):
                out.append((c, cle_souple(c)))
    return out


def _motifs_communs(cles: list) -> list:
    """Motifs de préfiltre présents pour toutes les clés (aucun : toute la marque est lue)."""
    listes = [_motifs_prefiltre(c) for c, _ in cles]
    if not listes:
        return []
    return [m for m in listes[0] if all(m in l for l in listes[1:])]


# ─── Fraîcheur des prix ─────────────────────────────────────────

def _seuils(cur) -> tuple:
    try:
        r = prix_srv.regles(cur) or {}
    except Exception:
        r = {}
    try:
        a_revoir, perime = int(r.get("jours_a_revoir", 90)), int(r.get("jours_perime", 180))
    except (TypeError, ValueError):
        a_revoir, perime = 90, 180
    return a_revoir, perime


def maintenant_utc() -> datetime:
    """Heure UTC sans fuseau : celle des TIMESTAMP écrits par NOW() (base et serveur en UTC)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def fraicheur(prix_maj_le, prix_source, seuils=(90, 180), maintenant: Optional[datetime] = None) -> dict:
    """Date (ISO), source, âge en jours, niveau et estime d'un prix.

    Niveau comme services/prix.sante : 'perime' au-delà de 180 jours ou date inconnue (prix jamais
    daté), 'a_revoir' au-delà de 90 jours, sinon 'ok'. estime : source 'estimation_…' (prix saisi
    le 2026-02-15, jamais confirmé par une facture ni un fichier fournisseur)."""
    a_revoir, perime = seuils
    age, niveau = None, "perime"
    if isinstance(prix_maj_le, datetime):
        tz = prix_maj_le.tzinfo
        ref = maintenant or (datetime.now(tz) if tz else maintenant_utc())
        if (ref.tzinfo is None) != (tz is None):
            ref = ref.replace(tzinfo=tz)
        ecart = ref - prix_maj_le
        age = max(0, ecart.days)
        if ecart > timedelta(days=perime):
            niveau = "perime"
        elif ecart > timedelta(days=a_revoir):
            niveau = "a_revoir"
        else:
            niveau = "ok"
    source = prix_source or None
    return {
        "prix_maj_le": prix_maj_le.isoformat() if isinstance(prix_maj_le, datetime) else None,
        "prix_source": source,
        "age_jours": age,
        "fraicheur": niveau,
        "estime": str(source or "").startswith("estimation"),
    }


# ─── Construction des suggestions ───────────────────────────────

def _prix(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return round(f, 2) if f > 0 else None


def _libelle_piece(type_piece, qualite) -> str:
    tp = " ".join(str(type_piece or "").split())
    if P.cle_panne(tp):
        base = P.libelle_prestation(tp)
    elif tp:
        base = "Remplacement " + tp[:1].lower() + tp[1:]
    else:
        base = "Réparation"
    q = " ".join(str(qualite or "").split())
    return f"{base} ({q})" if q else base


def _suggestion(source, ident, label, type_piece, qualite, prix, stock, cout_ht, modele, marque, score,
                maj=None, source_prix=None, colonne=None):
    return {
        "source": source, "id": ident, "label": label, "type_piece": type_piece,
        "qualite": qualite or None, "prix": prix, "stock": stock,
        "cout_ht": _prix(cout_ht) if cout_ht is not None else None,
        "modele": modele, "_marque": marque, "_score": score,
        "_maj": maj, "_source_prix": source_prix, "_colonne": colonne,
    }


def _stock_fournisseur(en_stock) -> Optional[str]:
    if en_stock is None:
        return None
    return "En stock" if en_stock else "Rupture"


def _stock_boutique(n) -> Optional[str]:
    if n is None:
        return None
    return f"{n} en stock" if n > 0 else "Rupture"


# Nom brut sans accents, espaces ni ponctuation : « Reno 10 » et « Reno10 » donnent « reno10 »
_COMPACT_SQL = "regexp_replace(" + _SANS_ACCENT_SQL + ", '[^a-z0-9]+', '', 'g')"


def _lire_tarifs(cur, marques: Optional[list], motifs: list, mode_libre: bool):
    conds, params = ["obsolete IS NOT TRUE"], []
    if marques:
        conds.append("regexp_replace(lower(marque), '[^a-z0-9]+', '', 'g') = ANY(%s::text[])")
        params.append(marques)
    if motifs:
        if mode_libre:
            champ = _SANS_ACCENT_SQL.format("concat_ws(' ', marque, modele, type_piece, qualite)")
        else:
            champ = _COMPACT_SQL.format("modele")
        conds.append(champ + " LIKE ALL(%s::text[])")
        params.append(motifs)
    where = "WHERE " + " AND ".join(conds)
    cur.execute(f"""
        SELECT id, marque, modele, type_piece, qualite, prix_client, prix_fournisseur_ht, en_stock,
               prix_maj_le, prix_source
        FROM tarifs {where}
        ORDER BY id
        LIMIT {_LIMITE_TARIFS}
    """, params)
    return cur.fetchall() or []


# Grille boutique iPhone : types de pièces fournisseur repliés sous elle quand elle a le prix
_REPLI_PAR_COLONNE = {
    "ecran_generique": {"ecran"}, "ecran_confort": {"ecran"}, "ecran_apple": {"ecran"},
    "batterie": {"batterie"}, "connecteur_charge": {"connecteur"},
    "ecouteur_apn": {"ecouteur", "camera_arriere", "camera_avant"},
    "vitre_arriere": {"vitre_arriere"},
}


def _candidats(cur, sources: set, marque_c: str, marques_sql: Optional[list], motifs: list, mode_libre: bool):
    """Toutes les suggestions possibles (avant filtrage par modèle ou recherche)."""
    out = []
    apple = marque_c in ("", "apple")

    if "tarifs" in sources:
        for r in _lire_tarifs(cur, marques_sql, motifs, mode_libre):
            prix = _prix(r["prix_client"])
            if prix is None:
                continue
            out.append(_suggestion(
                "tarifs", f"tarifs:{r['id']}", _libelle_piece(r["type_piece"], r["qualite"]),
                r["type_piece"], r["qualite"], prix, _stock_fournisseur(r["en_stock"]),
                r["prix_fournisseur_ht"], r["modele"], r["marque"], None,
                maj=r.get("prix_maj_le"), source_prix=r.get("prix_source"),
            ))

    if "tarifs_reparation" in sources and apple:
        colonnes = ", ".join(c for c, *_ in _COLONNES_GRILLE_IPHONE)
        cur.execute(f"SELECT id, modele, {colonnes}, prix_maj_le FROM tarifs_reparation ORDER BY ordre, id")
        for r in cur.fetchall() or []:
            for col, type_piece, qualite, label in _COLONNES_GRILLE_IPHONE:
                prix = _prix(r.get(col))
                if prix is not None:
                    out.append(_suggestion("tarifs_reparation", f"tarifs_reparation:{r['id']}:{col}", label,
                                           type_piece, qualite, prix, None, None, r["modele"], "Apple", None,
                                           maj=r.get("prix_maj_le"), colonne=col))

    if "tarifs_apple_devices" in sources and apple:
        cur.execute("""
            SELECT id, categorie, modele, ecran_prix_ht, batterie_prix_ht, ecran_prix_vente, batterie_prix_vente,
                   prix_maj_le, prix_source
            FROM tarifs_apple_devices WHERE actif IS NOT FALSE AND obsolete IS NOT TRUE ORDER BY categorie, modele
        """)
        for r in cur.fetchall() or []:
            for piece, type_piece, label in (("ecran", "Écran", "Forfait remplacement écran"),
                                             ("batterie", "Batterie", "Forfait remplacement batterie")):
                prix = _prix(r.get(f"{piece}_prix_vente"))
                if prix is not None:
                    out.append(_suggestion("tarifs_apple_devices", f"tarifs_apple_devices:{r['id']}:{piece}",
                                           label, type_piece, None, prix, None, r.get(f"{piece}_prix_ht"),
                                           r["modele"], "Apple", None,
                                           maj=r.get("prix_maj_le"), source_prix=r.get("prix_source")))

    ventes = []
    if "iphone_tarifs" in sources and apple:
        cur.execute("""
            SELECT id, 'Apple' AS marque, modele, condition, stockage_1, prix_1, stock_1,
                   stockage_2, prix_2, stock_2, stockage_3, prix_3, stock_3, prix_maj_le
            FROM iphone_tarifs WHERE actif IS NOT FALSE ORDER BY ordre, id
        """)
        ventes += [("iphone_tarifs", r) for r in cur.fetchall() or []]
    if "smartphones_tarifs" in sources:
        cur.execute("""
            SELECT id, marque, modele, condition, stockage_1, prix_1, stock_1,
                   stockage_2, prix_2, stock_2, stockage_3, prix_3, stock_3, prix_maj_le
            FROM smartphones_tarifs WHERE actif IS NOT FALSE ORDER BY ordre, id
        """)
        ventes += [("smartphones_tarifs", r) for r in cur.fetchall() or []
                   if not marque_c or marque_canonique(r["marque"]) == marque_c]
    for source, r in ventes:
        for i in (1, 2, 3):
            prix = _prix(r.get(f"prix_{i}"))
            if prix is None:
                continue
            stockage = " ".join(str(r.get(f"stockage_{i}") or "").split())
            condition = " ".join(str(r.get("condition") or "").split())
            label = " ".join(p for p in (r["modele"], stockage) if p) + (f" — {condition}" if condition else "")
            out.append(_suggestion(source, f"{source}:{r['id']}:{i}", label, "Téléphone (vente)", condition,
                                   prix, _stock_boutique(r.get(f"stock_{i}")), None, r["modele"], r["marque"], None,
                                   maj=r.get("prix_maj_le")))
    return out


def _texte(s: dict) -> str:
    brut = " ".join(str(s.get(k) or "") for k in ("_marque", "modele", "label", "type_piece", "qualite"))
    return normaliser(brut.replace("+", " plus "))


def _ordre(s: dict):
    return (-(s["_score"] or 0), s["source"] in _VENTE,
            _RANG_TYPE.get(P.cle_panne(s["type_piece"]) or P.cle_panne(s["label"]), 20),
            _RANG_SOURCE.get(s["source"], 9), s["prix"], s["label"])


def _ordre_groupe(s: dict):
    """Modèle reconnu : pièces repliées (groupe 'fournisseur', masquées par défaut) après la grille
    boutique et les ventes, AVANT la coupe à `limit` : elles ne prennent que les places restantes."""
    return (s["_groupe"] == "fournisseur", _ordre(s))


def _ordre_libre(s: dict):
    return (s["source"] in _VENTE, normaliser(s["modele"]), _ordre(s)[2:])


def _grouper(suggestions: list, repli: bool):
    """Groupe d'affichage (cf. docstring du module). repli : modèle reconnu (pas la recherche libre)."""
    couverts = set()
    if repli:
        for s in suggestions:
            if s["source"] == "tarifs_reparation":
                couverts |= _REPLI_PAR_COLONNE.get(s["_colonne"], set())
    for s in suggestions:
        if s["source"] in _VENTE:
            s["_groupe"] = "vente"
        elif s["source"] == "tarifs" and P.cle_panne(s["type_piece"]) in couverts:
            s["_groupe"] = "fournisseur"
        else:
            s["_groupe"] = "boutique"


def _est_admin(request: Request, user: dict) -> bool:
    try:
        exiger_role_admin(request, dict(user))
        return True
    except HTTPException:
        return False


@router.get("/suggestions")
def suggestions(
    request: Request,
    marque: Optional[str] = Query(None, max_length=120),
    modele: Optional[str] = Query(None, max_length=160),
    categorie: Optional[str] = Query(None, max_length=60),
    q: Optional[str] = Query(None, max_length=100),
    limit: int = Query(20, ge=1, le=50),
    user: dict = Depends(get_current_user),
):
    """Lignes de réparation proposées pour un ticket, toutes grilles confondues.

    Avec un modèle : seules ses lignes (q filtre en plus par mot : « batt », « oled »…).
    Modèle introuvable ou absent : recherche libre sur q (marque comprise si donnée),
    modele_trouve=false. prix = prix client TTC ; stock = stock fournisseur (tarifs) ou
    boutique (vente) ; cout_ht seulement pour le rôle admin, sinon null. Chaque ligne porte
    prix_maj_le, prix_source, age_jours, fraicheur, estime et groupe (cf. docstring du module).
    """
    if not marque_canonique(marque):
        marque = deviner_marque(modele) or marque
    marque_c = marque_canonique(marque)
    marques_sql = sorted({marque_c} | {a for a, c in _ALIAS_MARQUE.items() if c == marque_c}) if marque_c else None
    cat = normaliser(categorie)
    sources = _SOURCES_PAR_CATEGORIE.get(cat, set(_RANG_SOURCE))
    mots_q = _mots(q)

    trouves = []
    with get_cursor() as cur:
        cles = cles_ticket(modele, marque, categorie, charger_alias(cur)) if normaliser(modele) else []
        if cles:
            for s in _candidats(cur, sources, marque_c, marques_sql, _motifs_communs(cles), False):
                if marque_c and marque_canonique(s["_marque"]) != marque_c:
                    continue
                s["_score"] = _score_cles(cles, s["modele"], s["_marque"])
                if s["_score"]:
                    trouves.append(s)
            if trouves:
                meilleur = max(s["_score"] for s in trouves)
                trouves = [s for s in trouves if s["_score"] == meilleur]
        libres = []
        if not trouves and mots_q:
            for s in _candidats(cur, sources, marque_c, marques_sql, [f"%{m}%" for m in mots_q], True):
                if marque_c and marque_canonique(s["_marque"]) != marque_c:
                    continue
                if _contient_tout(_texte(s), mots_q):
                    libres.append(s)
        seuils = _seuils(cur)

    modele_trouve = bool(trouves)
    if trouves:
        _grouper(trouves, repli=True)
        if mots_q:
            trouves = [s for s in trouves if _contient_tout(_texte(s), mots_q)]
        resultat = sorted(trouves, key=_ordre_groupe)[:limit]
    else:
        _grouper(libres, repli=False)
        resultat = sorted(libres, key=_ordre_libre)[:limit]

    admin = any(s["cout_ht"] is not None for s in resultat) and _est_admin(request, user)
    maintenant = maintenant_utc()
    out = []
    for s in resultat:
        d = {k: v for k, v in s.items() if not k.startswith("_")}
        if not admin:
            d["cout_ht"] = None
        d.update(fraicheur(s["_maj"], s["_source_prix"], seuils, maintenant))
        d["groupe"] = s["_groupe"]
        out.append(d)
    return {"modele_trouve": modele_trouve, "suggestions": out}


# ─── Modèles du catalogue sans aucun prix de réparation (admin) ─

_SOURCES_REPARATION = {"tarifs", "tarifs_reparation", "tarifs_apple_devices"}


def _index_prix(cur) -> dict:
    """{source: (clés exactes, clés souples)} des lignes de réparation qui ont un prix, par marque."""
    lignes = []
    cur.execute("SELECT marque, modele FROM tarifs WHERE prix_client > 0 AND obsolete IS NOT TRUE")
    lignes += [("tarifs", r["marque"], r["modele"]) for r in cur.fetchall() or []]
    colonnes = [c for c, *_ in _COLONNES_GRILLE_IPHONE]
    cur.execute("SELECT modele FROM tarifs_reparation WHERE GREATEST({}) > 0".format(
        ", ".join(f"COALESCE({c}, 0)" for c in colonnes)))
    lignes += [("tarifs_reparation", "Apple", r["modele"]) for r in cur.fetchall() or []]
    cur.execute("""SELECT modele FROM tarifs_apple_devices
                   WHERE actif IS NOT FALSE AND obsolete IS NOT TRUE
                     AND (COALESCE(ecran_prix_vente, 0) > 0 OR COALESCE(batterie_prix_vente, 0) > 0)""")
    lignes += [("tarifs_apple_devices", "Apple", r["modele"]) for r in cur.fetchall() or []]
    index = {s: (set(), set()) for s in _SOURCES_REPARATION}
    for source, marque, modele in lignes:
        m = marque_canonique(marque)
        exactes, souples = index[source]
        cles, souples_ligne = _cles_ligne(str(modele or ""), str(marque or ""))
        exactes.update((m, c) for c in cles)
        souples.update((m, s) for s in souples_ligne if s)
    return index


def _a_un_prix(index: dict, sources: set, marque_c: str, cles: list) -> bool:
    for source in sources & _SOURCES_REPARATION:
        exactes, souples = index[source]
        if any((marque_c, c) in exactes or (s and (marque_c, s) in souples) for c, s in cles):
            return True
    return False


def _tickets_par_modele(cur) -> dict:
    """{(marque canonique, clé du modèle): tickets déposés depuis 12 mois} — comptage agrégé."""
    cur.execute("""
        SELECT marque, COALESCE(NULLIF(btrim(modele_autre), ''), modele) AS modele, count(*) AS n
        FROM tickets
        WHERE date_depot >= NOW() - INTERVAL '12 months'
        GROUP BY 1, 2
    """)
    out = {}
    for r in cur.fetchall() or []:
        marque = r["marque"]
        if not marque_canonique(marque):
            marque = deviner_marque(r["modele"]) or marque
        cle = cle_modele(r["modele"], marque or "") if normaliser(r["modele"]) else ""
        if cle:
            k = (marque_canonique(marque), cle)
            out[k] = out.get(k, 0) + int(r["n"] or 0)
    return out


def modeles_sans_prix(cur) -> list:
    """Modèles actifs du catalogue sans aucun prix de réparation (alias compris), les plus
    demandés d'abord (tickets des 12 derniers mois), puis les plus récents."""
    index = _index_prix(cur)
    alias = charger_alias(cur)
    tickets = _tickets_par_modele(cur)
    cur.execute("""SELECT categorie, marque, modele, annee FROM catalog_modeles
                   WHERE actif IS NOT FALSE ORDER BY categorie, marque, modele""")
    out = []
    for r in cur.fetchall() or []:
        sources = _SOURCES_PAR_CATEGORIE.get(normaliser(r["categorie"]), _SOURCES_REPARATION)
        marque_c = marque_canonique(r["marque"])
        cles = cles_ticket(r["modele"], r["marque"], r["categorie"], alias)
        if not cles or _a_un_prix(index, sources, marque_c, cles):
            continue
        out.append({
            "categorie": r["categorie"], "marque": r["marque"], "modele": r["modele"], "annee": r["annee"],
            "tickets_12_mois": tickets.get((marque_c, cles[0][0]), 0),
        })
    out.sort(key=lambda m: (-m["tickets_12_mois"], -(m["annee"] or 0), m["marque"], m["modele"]))
    return out


@router.get("/sans-prix")
def sans_prix(request: Request, user: dict = Depends(get_current_user)):
    """Modèles du catalogue sans aucun prix de réparation (admin), triés par demande puis année."""
    exiger_role_admin(request, user)
    with get_cursor() as cur:
        return modeles_sans_prix(cur)


# ─── Alias de modèles : édition (admin) ─────────────────────────

class AliasIn(BaseModel):
    alias: str = Field(..., min_length=1, max_length=160)
    modele_canonique: str = Field(..., min_length=1, max_length=300)
    categorie: Optional[str] = Field(None, max_length=60)

    @field_validator("alias", "modele_canonique", "categorie", mode="before")
    @classmethod
    def _espaces(cls, v):
        return " ".join(str(v).split()) if v is not None else None


def _alias_out(r: dict) -> dict:
    d = dict(r)
    if d.get("le") is not None and hasattr(d["le"], "isoformat"):
        d["le"] = d["le"].isoformat()
    return d


@router.get("/alias")
def lister_alias(request: Request, user: dict = Depends(get_current_user)):
    exiger_role_admin(request, user)
    with get_cursor() as cur:
        cur.execute("SELECT id, alias, modele_canonique, categorie, le FROM modeles_alias ORDER BY alias, id")
        return [_alias_out(r) for r in cur.fetchall() or []]


@router.post("/alias")
def ajouter_alias(body: AliasIn, request: Request, user: dict = Depends(get_current_user)):
    """Ajoute (ou remplace) un alias : un même nom, à la casse ou aux espaces près, n'en a qu'un."""
    exiger_role_admin(request, user)
    cle = cle_alias(body.alias)
    if not cle or not body.modele_canonique:
        raise HTTPException(422, {"code": "alias_vide", "message": "Alias et nom dans la grille requis."})
    if all(cle_alias(v) == cle for v in variantes(body.modele_canonique)):
        raise HTTPException(422, {"code": "alias_inutile",
                                  "message": "L'alias et le nom dans la grille désignent déjà le même modèle."})
    categorie = body.categorie or None
    with get_cursor() as cur:
        existant = next((r for r in _lire_alias_bruts(cur) if cle_alias(r["alias"]) == cle), None)
        if existant:
            cur.execute("""UPDATE modeles_alias SET alias = %s, modele_canonique = %s, categorie = %s, le = NOW()
                           WHERE id = %s
                           RETURNING id, alias, modele_canonique, categorie, le""",
                        (body.alias, body.modele_canonique, categorie, existant["id"]))
        else:
            cur.execute("""INSERT INTO modeles_alias (alias, modele_canonique, categorie) VALUES (%s, %s, %s)
                           ON CONFLICT (alias) DO UPDATE
                           SET modele_canonique = EXCLUDED.modele_canonique, categorie = EXCLUDED.categorie, le = NOW()
                           RETURNING id, alias, modele_canonique, categorie, le""",
                        (body.alias, body.modele_canonique, categorie))
        row = cur.fetchone()
    invalider_alias()
    return _alias_out(row)


@router.delete("/alias/{alias_id}")
def supprimer_alias(alias_id: int, request: Request, user: dict = Depends(get_current_user)):
    exiger_role_admin(request, user)
    with get_cursor() as cur:
        cur.execute("DELETE FROM modeles_alias WHERE id = %s RETURNING id", (alias_id,))
        row = cur.fetchone()
    invalider_alias()
    if not row:
        raise HTTPException(404, "Alias introuvable")
    return {"ok": True}
