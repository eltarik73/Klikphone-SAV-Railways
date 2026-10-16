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
groupés « iPhone 7/8/7+/8+ » dépliés), jamais par sous-chaîne : « iPhone 13 »
ne reçoit pas les prix de l'« iPhone 13 Pro ». Sans correspondance exacte, un
second niveau ignore 5G/4G et les années (hors iPhone SE).
"""

import re
from functools import lru_cache
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.database import get_cursor
from app.api.auth import exiger_role_admin, get_current_user
from app.services import prestations as P
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
    # Année (« SE (2022) »), génération (« SE (2e génération) ») ou réseau (« (5G) ») : gardés ;
    # une référence (« (G991B) ») est retirée
    mots = normaliser(contenu).split()
    return bool(mots) and (_ANNEE.fullmatch(contenu.strip()) is not None
                           or any(m in _MOTS_GENERATION for m in mots)
                           or all(m in _RESEAU for m in mots))


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
    s = str(modele or "")
    s = re.sub(r"\(([^)]*)\)", lambda m: f" {m.group(1)} " if _garder_parenthese(m.group(1)) else " ", s)
    toks = normaliser(s.replace("+", " plus ")).split()
    toks = _sans_marque(toks, marque)
    gamme = _compact(marque)
    if gamme in _GAMMES and (not toks or toks[0] != gamme):
        toks = [gamme] + toks
    toks = [t for t in toks if t != "galaxy"]
    return " ".join(_generation_se(toks))


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


def _motifs_prefiltre(cle: str) -> list:
    """Mots du modèle sûrs d'apparaître dans le nom brut (sans gamme, « plus », réseau ni année)."""
    return [f"%{t}%" for t in cle.split()
            if t not in _GAMMES and t != "plus" and t not in _RESEAU and not _ANNEE.fullmatch(t)]


def _mots(q) -> list:
    return normaliser(q).split()


def _contient_tout(texte: str, mots: list) -> bool:
    return all(m in texte for m in mots)


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


def _suggestion(source, ident, label, type_piece, qualite, prix, stock, cout_ht, modele, marque, score):
    return {
        "source": source, "id": ident, "label": label, "type_piece": type_piece,
        "qualite": qualite or None, "prix": prix, "stock": stock,
        "cout_ht": _prix(cout_ht) if cout_ht is not None else None,
        "modele": modele, "_marque": marque, "_score": score,
    }


def _stock_fournisseur(en_stock) -> Optional[str]:
    if en_stock is None:
        return None
    return "En stock" if en_stock else "Rupture"


def _stock_boutique(n) -> Optional[str]:
    if n is None:
        return None
    return f"{n} en stock" if n > 0 else "Rupture"


def _lire_tarifs(cur, marques: Optional[list], motifs: list, mode_libre: bool):
    conds, params = [], []
    if marques:
        conds.append("regexp_replace(lower(marque), '[^a-z0-9]+', '', 'g') = ANY(%s::text[])")
        params.append(marques)
    if motifs:
        champ = "modele" if not mode_libre else "concat_ws(' ', marque, modele, type_piece, qualite)"
        conds.append(_SANS_ACCENT_SQL.format(champ) + " LIKE ALL(%s::text[])")
        params.append(motifs)
    where = "WHERE " + " AND ".join(conds) if conds else ""
    cur.execute(f"""
        SELECT id, marque, modele, type_piece, qualite, prix_client, prix_fournisseur_ht, en_stock
        FROM tarifs {where}
        ORDER BY id
        LIMIT {_LIMITE_TARIFS}
    """, params)
    return cur.fetchall() or []


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
            ))

    if "tarifs_reparation" in sources and apple:
        colonnes = ", ".join(c for c, *_ in _COLONNES_GRILLE_IPHONE)
        cur.execute(f"SELECT id, modele, {colonnes} FROM tarifs_reparation ORDER BY ordre, id")
        for r in cur.fetchall() or []:
            for col, type_piece, qualite, label in _COLONNES_GRILLE_IPHONE:
                prix = _prix(r.get(col))
                if prix is not None:
                    out.append(_suggestion("tarifs_reparation", f"tarifs_reparation:{r['id']}:{col}", label,
                                           type_piece, qualite, prix, None, None, r["modele"], "Apple", None))

    if "tarifs_apple_devices" in sources and apple:
        cur.execute("""
            SELECT id, categorie, modele, ecran_prix_ht, batterie_prix_ht, ecran_prix_vente, batterie_prix_vente
            FROM tarifs_apple_devices WHERE actif IS NOT FALSE ORDER BY categorie, modele
        """)
        for r in cur.fetchall() or []:
            for piece, type_piece, label in (("ecran", "Écran", "Forfait remplacement écran"),
                                             ("batterie", "Batterie", "Forfait remplacement batterie")):
                prix = _prix(r.get(f"{piece}_prix_vente"))
                if prix is not None:
                    out.append(_suggestion("tarifs_apple_devices", f"tarifs_apple_devices:{r['id']}:{piece}",
                                           label, type_piece, None, prix, None, r.get(f"{piece}_prix_ht"),
                                           r["modele"], "Apple", None))

    ventes = []
    if "iphone_tarifs" in sources and apple:
        cur.execute("""
            SELECT id, 'Apple' AS marque, modele, condition, stockage_1, prix_1, stock_1,
                   stockage_2, prix_2, stock_2, stockage_3, prix_3, stock_3
            FROM iphone_tarifs WHERE actif IS NOT FALSE ORDER BY ordre, id
        """)
        ventes += [("iphone_tarifs", r) for r in cur.fetchall() or []]
    if "smartphones_tarifs" in sources:
        cur.execute("""
            SELECT id, marque, modele, condition, stockage_1, prix_1, stock_1,
                   stockage_2, prix_2, stock_2, stockage_3, prix_3, stock_3
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
                                   prix, _stock_boutique(r.get(f"stock_{i}")), None, r["modele"], r["marque"], None))
    return out


def _texte(s: dict) -> str:
    brut = " ".join(str(s.get(k) or "") for k in ("_marque", "modele", "label", "type_piece", "qualite"))
    return normaliser(brut.replace("+", " plus "))


def _ordre(s: dict):
    return (-(s["_score"] or 0), s["source"] in _VENTE,
            _RANG_TYPE.get(P.cle_panne(s["type_piece"]) or P.cle_panne(s["label"]), 20),
            _RANG_SOURCE.get(s["source"], 9), s["prix"], s["label"])


def _ordre_libre(s: dict):
    return (s["source"] in _VENTE, normaliser(s["modele"]), _ordre(s)[2:])


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
    boutique (vente) ; cout_ht seulement pour le rôle admin, sinon null.
    """
    if not marque_canonique(marque):
        marque = deviner_marque(modele) or marque
    marque_c = marque_canonique(marque)
    marques_sql = sorted({marque_c} | {a for a, c in _ALIAS_MARQUE.items() if c == marque_c}) if marque_c else None
    cat = normaliser(categorie)
    sources = _SOURCES_PAR_CATEGORIE.get(cat, set(_RANG_SOURCE))
    mots_q = _mots(q)
    cle = cle_modele(modele, marque or "") if normaliser(modele) else ""

    trouves = []
    with get_cursor() as cur:
        if cle:
            souple = cle_souple(cle)
            for s in _candidats(cur, sources, marque_c, marques_sql, _motifs_prefiltre(cle), False):
                if marque_c and marque_canonique(s["_marque"]) != marque_c:
                    continue
                s["_score"] = _score(cle, souple, s["modele"], s["_marque"])
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

    modele_trouve = bool(trouves)
    if trouves:
        if mots_q:
            trouves = [s for s in trouves if _contient_tout(_texte(s), mots_q)]
        resultat = sorted(trouves, key=_ordre)[:limit]
    else:
        resultat = sorted(libres, key=_ordre_libre)[:limit]

    admin = any(s["cout_ht"] is not None for s in resultat) and _est_admin(request, user)
    out = []
    for s in resultat:
        s = {k: v for k, v in s.items() if not k.startswith("_")}
        if not admin:
            s["cout_ht"] = None
        out.append(s)
    return {"modele_trouve": modele_trouve, "suggestions": out}
