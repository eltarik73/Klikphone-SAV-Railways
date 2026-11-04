"""Batterie changée « par l'écran » : écran + batterie + marge (services/prix, api/tarifs).

Sur certains appareils (iPad, Google Pixel…), la batterie n'est accessible qu'en décollant
l'écran, qui peut casser : le gérant facture ce risque. Prix client de la batterie =
arrondi((HT écran + HT batterie) × TVA + marge « batterie par l'écran », 70 € par défaut —
règle `batterie_par_ecran` de prix.REGLES_DEFAUT).

- Quels modèles : case par modèle (table tarifs_modeles_options ; colonne batterie_par_ecran
  d'une fiche iPad / MacBook). Sans réglage, la règle vaut pour Google (Pixel) et les iPad
  (`defaut`), jamais pour les autres.
- Quel écran : l'original / reconditionné le moins cher du modèle (Original, Pulled,
  Refurbished, Reconditionné, Service Pack), sinon l'écran le moins cher (`choisir_ecran`).
- Dépendance entre lignes : toute écriture de prix (prix.ecrire_prix_lot) passe par
  `deriver_changements`, qui remplace le prix client de ces batteries par la formule et ajoute
  celles dont l'écran change — même lot, une ligne d'historique par valeur. Après une création
  de pièce ou un changement de case, `recalculer` écrit ce qui doit l'être. Une batterie
  verrouillée (verrou_manuel) n'est jamais touchée.
"""

from decimal import Decimal, InvalidOperation
from typing import Optional

from app.services import prix
from app.services.prestations import normaliser

REGLE = "batterie_par_ecran"                  # clé de la marge dans les règles (€)
MARQUES_DEFAUT = ("google",)                  # Pixel : batterie par l'écran
CATEGORIES_APPLE_DEFAUT = ("ipad",)
_QUALITES_ORIGINE = ("origin", "pulled", "refurb", "recondition", "service pack")
_COLS = ("id, marque, modele, type_piece, qualite, categorie, prix_fournisseur_ht, prix_client, "
         "verrou_manuel, obsolete")
_COLS_APPLE = ("id, categorie, modele, ecran_prix_ht, batterie_prix_ht, batterie_prix_vente, batterie_par_ecran, "
               "verrou_manuel, obsolete")


# ─── Règle ──────────────────────────────────────────────────────

def est_batterie(type_piece) -> bool:
    t = normaliser(type_piece or "")
    return t.startswith("batterie") or t.startswith("battery")


def defaut(marque=None, categorie=None) -> bool:
    """La règle sans réglage explicite : iPad (fiche Apple) et Google (Pixel)."""
    if categorie and normaliser(categorie) in CATEGORIES_APPLE_DEFAUT:
        return True
    return bool(marque) and normaliser(marque) in MARQUES_DEFAUT


def effectif(explicite, marque=None, categorie=None) -> bool:
    """Réglage explicite (True / False) s'il existe, sinon la valeur par défaut."""
    return bool(explicite) if explicite is not None else defaut(marque, categorie)


def _decimal(v) -> Optional[Decimal]:
    if v is None or isinstance(v, bool):
        return None
    try:
        d = Decimal(str(v).replace(",", ".").strip())
    except (InvalidOperation, ValueError):
        return None
    return d if d.is_finite() else None


def rang_qualite(qualite) -> int:
    """0 : écran d'origine ou reconditionné (retenu d'abord) ; 1 : les autres (Compatible, OLED…)."""
    q = normaliser(qualite or "")
    return 0 if any(m in q for m in _QUALITES_ORIGINE) else 1


def choisir_ecran(pieces) -> Optional[dict]:
    """L'écran du calcul parmi les pièces d'un modèle ({type_piece, qualite, ht, id?, cle?, obsolete?}) :
    origine / reconditionné le moins cher, sinon le moins cher ; None sans écran au prix connu.
    → {id, cle, qualite, ht (Decimal), origine}"""
    candidats = []
    for p in pieces or []:
        if not isinstance(p, dict) or p.get("obsolete") or not prix.est_ecran(p.get("type_piece")):
            continue
        ht = _decimal(p.get("ht"))
        if ht is None or ht <= 0:
            continue
        candidats.append((rang_qualite(p.get("qualite")), ht, int(p.get("id") or 0), p))
    if not candidats:
        return None
    candidats.sort(key=lambda c: (c[0], c[1], c[2]))
    rang, ht, _, p = candidats[0]
    return {"id": p.get("id"), "cle": p.get("cle"), "qualite": p.get("qualite"), "ht": ht, "origine": rang == 0}


def prix_batterie(ht_batterie, ht_ecran, r=None) -> int:
    """Prix client d'une batterie changée par l'écran : (HT écran + HT batterie) × TVA + marge, arrondi."""
    r = r or prix.regles()
    somme = Decimal(str(ht_batterie)) + Decimal(str(ht_ecran))
    return prix.arrondir(prix._brut(somme, r[REGLE], r), r["arrondi"])


def calcul_detail(ht_batterie, ht_ecran, r=None, ecran: dict = None) -> dict:
    """Détail affiché : « (13,00 + 15,00) × 1,2 + 70 = 103,60 → 109 € » ; `arrondi` = prix_batterie."""
    r = r or prix.regles()
    hb, he = float(ht_batterie), float(ht_ecran)
    brut = prix._brut(hb + he, r[REGLE], r)
    return {
        "ht": hb, "ht_ecran": he, "tva": r["tva"], "marge": r[REGLE], "brut": round(brut, 2),
        "arrondi": prix.arrondir(brut, r["arrondi"]), "par_ecran": True,
        "ecran_qualite": (ecran or {}).get("qualite"), "ecran_cle": (ecran or {}).get("cle"),
    }


# ─── Réglage par modèle (table tarifs_modeles_options) ──────────

def cle_modele(marque, modele) -> tuple:
    """Clé d'un modèle de la grille des pièces : (marque, modèle) en minuscules, sans espaces autour
    (lower(btrim(…)) côté SQL)."""
    return (str(marque or "").strip().lower(), str(modele or "").strip().lower())


def options_modeles(cur, cles=None) -> dict:
    """{(marque_cle, modele_cle): True | False} des réglages explicites (tous, ou ceux demandés)."""
    if cles is not None:
        cles = sorted({tuple(c) for c in cles})
        if not cles:
            return {}
        cur.execute("SELECT marque_cle, modele_cle, batterie_par_ecran FROM tarifs_modeles_options "
                    "WHERE (marque_cle, modele_cle) IN %s", (tuple(cles),))
    else:
        cur.execute("SELECT marque_cle, modele_cle, batterie_par_ecran FROM tarifs_modeles_options")
    return {(r["marque_cle"], r["modele_cle"]): bool(r["batterie_par_ecran"])
            for r in cur.fetchall() or [] if r["batterie_par_ecran"] is not None}


def regler_modele(cur, marque, modele, actif, par=None):
    """Case du modèle : True / False enregistré, None = retour à la valeur par défaut."""
    mc, mo = cle_modele(marque, modele)
    if actif is None:
        cur.execute("DELETE FROM tarifs_modeles_options WHERE marque_cle = %s AND modele_cle = %s", (mc, mo))
        return
    cur.execute("""
        INSERT INTO tarifs_modeles_options (marque_cle, modele_cle, marque, modele, batterie_par_ecran, par, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (marque_cle, modele_cle)
        DO UPDATE SET batterie_par_ecran = EXCLUDED.batterie_par_ecran, marque = EXCLUDED.marque,
                      modele = EXCLUDED.modele, par = EXCLUDED.par, updated_at = NOW()
    """, (mc, mo, str(marque).strip(), str(modele).strip(), bool(actif), par))


def etat_modele(cur, paires, categorie_apple=None, explicite_apple=None) -> dict:
    """{actif, explicite, defaut} de la règle pour un modèle : fiche iPad / Mac (colonne de la
    fiche) ou modèle de la grille des pièces (paires (marque, modèle) de ses lignes : le premier
    réglage explicite trouvé l'emporte)."""
    paires = [p for p in paires or [] if p and p[0] and p[1]]
    marque = paires[0][0] if paires else None
    if categorie_apple:
        explicite = None if explicite_apple is None else bool(explicite_apple)
        d = defaut(categorie=categorie_apple)
    else:
        options = options_modeles(cur, [cle_modele(m, mo) for m, mo in paires]) if paires else {}
        explicite = next((options[cle_modele(m, mo)] for m, mo in paires if cle_modele(m, mo) in options), None)
        d = defaut(marque=marque)
    return {"actif": bool(explicite) if explicite is not None else d, "explicite": explicite, "defaut": d}


# ─── Dérivation à l'écriture (prix.ecrire_prix_lot) ──────────────

def _lignes_modeles(cur, cles) -> dict:
    """{cle_modele: [lignes tarifs non obsolètes]} des modèles demandés."""
    cles = sorted({tuple(c) for c in cles})
    if not cles:
        return {}
    cur.execute(f"SELECT {_COLS} FROM tarifs WHERE (lower(btrim(marque)), lower(btrim(modele))) IN %s "
                "AND obsolete IS NOT TRUE ORDER BY id", (tuple(cles),))
    out = {}
    for row in cur.fetchall() or []:
        out.setdefault(cle_modele(row["marque"], row["modele"]), []).append(dict(row))
    return out


def _batteries_derivees(lignes: list, r: dict) -> dict:
    """{id batterie: prix client} des batteries d'un modèle (règle active), None sans écran."""
    ecran = choisir_ecran([{"type_piece": x["type_piece"], "qualite": x["qualite"], "ht": x["prix_fournisseur_ht"],
                            "id": x["id"], "cle": prix.tarif_cle("tarifs", x["id"])} for x in lignes])
    if ecran is None:
        return {}
    out = {}
    for x in lignes:
        if not est_batterie(x["type_piece"]) or x.get("verrou_manuel"):
            continue
        hb = _decimal(x["prix_fournisseur_ht"])
        if hb is None or hb <= 0:
            continue
        out[x["id"]] = prix_batterie(hb, ecran["ht"], r)
    return out


def _deriver_tarifs(cur, ch: list, r) -> list:
    ids = sorted({int(i) for i, _, _ in ch})
    cur.execute(f"SELECT {_COLS} FROM tarifs WHERE id = ANY(%s)", (ids,))
    touchees = cur.fetchall() or []
    cles = set()
    for t in touchees:
        lire = getattr(t, "get", None)
        if lire and lire("marque") and lire("modele"):
            cles.add(cle_modele(t["marque"], t["modele"]))
    if not cles:
        return ch
    explicites = options_modeles(cur, cles)
    actives = {c for c in cles if effectif(explicites.get(c), marque=c[0])}
    if not actives:
        return ch
    r = r or prix.regles(cur)
    ht_apres = {}
    for i, c, v in ch:
        if c == "prix_fournisseur_ht":
            ht_apres[int(i)] = v
    derives = {}
    for cle, lignes in _lignes_modeles(cur, actives).items():
        for x in lignes:
            if x["id"] in ht_apres:
                x["prix_fournisseur_ht"] = ht_apres[x["id"]]
        derives.update(_batteries_derivees(lignes, r))
    if not derives:
        return ch
    out = [(i, c, v) for i, c, v in ch if not (c == "prix_client" and int(i) in derives)]
    return out + [(i, "prix_client", v) for i, v in sorted(derives.items())]


def _deriver_apple(cur, ch: list, r) -> list:
    ids = sorted({int(i) for i, _, _ in ch})
    cur.execute(f"SELECT {_COLS_APPLE} FROM tarifs_apple_devices WHERE id = ANY(%s)", (ids,))
    rows = [x for x in cur.fetchall() or [] if getattr(x, "get", None) and x.get("categorie") is not None]
    apres = {(int(i), c): v for i, c, v in ch}
    derives = {}
    for row in rows:
        if row.get("obsolete") or row.get("verrou_manuel") or not effectif(row.get("batterie_par_ecran"), categorie=row["categorie"]):
            continue
        he = _decimal(apres.get((row["id"], "ecran_prix_ht"), row["ecran_prix_ht"]))
        hb = _decimal(apres.get((row["id"], "batterie_prix_ht"), row["batterie_prix_ht"]))
        if he is None or he <= 0 or hb is None or hb <= 0:
            continue
        r = r or prix.regles(cur)
        derives[row["id"]] = prix_batterie(hb, he, r)
    if not derives:
        return ch
    out = [(i, c, v) for i, c, v in ch if not (c == "batterie_prix_vente" and int(i) in derives)]
    return out + [(i, "batterie_prix_vente", v) for i, v in sorted(derives.items())]


def deriver_changements(cur, table: str, changements, r=None) -> list:
    """Changements [(id, colonne, valeur)] d'un lot, complétés : le prix client des batteries
    « par l'écran » des modèles touchés est recalculé depuis les HT après le lot (remplacé s'il
    était dans le lot, ajouté sinon). Tables tarifs et tarifs_apple_devices ; sinon inchangé."""
    ch = list(changements or [])
    if not ch:
        return ch
    if table == "tarifs":
        return _deriver_tarifs(cur, ch, r)
    if table == "tarifs_apple_devices":
        return _deriver_apple(cur, ch, r)
    return ch


def derives_plan(cur, rows, nouveaux_ht: dict, r=None) -> dict:
    """Pour un aperçu (prix._plan_fournisseur) : {id batterie: prix client dérivé} des batteries « par
    l'écran » parmi `rows` (toutes les lignes tarifs en vigueur), les HT des lignes du plan remplacés
    par `nouveaux_ht` (après ajustement) — l'écran du modèle compte même hors du plan."""
    par_modele = {}
    for row in rows or []:
        par_modele.setdefault(cle_modele(row["marque"], row["modele"]), []).append(dict(row))
    if not par_modele:
        return {}
    explicites = options_modeles(cur, par_modele.keys())
    r = r or prix.regles(cur)
    out = {}
    for cle, lignes in par_modele.items():
        if not effectif(explicites.get(cle), marque=cle[0]):
            continue
        for x in lignes:
            if x["id"] in nouveaux_ht:
                x["prix_fournisseur_ht"] = nouveaux_ht[x["id"]]
        out.update(_batteries_derivees(lignes, r))
    return out


# ─── Recalcul explicite (création de pièce, changement de case) ──

def recalculer(cur, source: str, par, lot_id=None, r=None, modeles=(), devices=()) -> dict:
    """Prix client des batteries des modèles (grille des pièces) et fiches (iPad / Mac) donnés remis
    d'équerre : formule « par l'écran » si la règle est active, formule ordinaire sinon.
    → {ecrits: [(table, id, ancien, nouveau)], verrouilles: [cle]}"""
    r = r or prix.regles(cur)
    res = {"ecrits": [], "verrouilles": []}
    cles = {cle_modele(m, mo) for m, mo in modeles or () if m and mo}
    if cles:
        explicites = options_modeles(cur, cles)
        changements = []
        for cle, lignes in _lignes_modeles(cur, cles).items():
            actif = effectif(explicites.get(cle), marque=cle[0])
            derives = _batteries_derivees(lignes, r) if actif else {}
            for x in lignes:
                if not est_batterie(x["type_piece"]) or x["verrou_manuel"]:
                    continue
                hb = _decimal(x["prix_fournisseur_ht"])
                if hb is None or hb <= 0:
                    continue
                nouveau = derives.get(x["id"])
                if nouveau is None:
                    nouveau = prix.prix_client(hb, x["type_piece"], x["categorie"], r)
                if x["prix_client"] != nouveau:
                    changements.append((x["id"], "prix_client", nouveau))
        if changements:
            e = prix.ecrire_prix_lot(cur, "tarifs", changements, source, par, lot_id, saisie=False, deriver=False)
            res["ecrits"] += [("tarifs", i, a, n) for i, _, a, n in e["ecrits"]]
            res["verrouilles"] += [f"tarifs:{i}" for i in e["verrouilles"]]
    ids = sorted({int(i) for i in devices or ()})
    if ids:
        cur.execute(f"SELECT {_COLS_APPLE} FROM tarifs_apple_devices WHERE id = ANY(%s)", (ids,))
        changements = []
        for row in cur.fetchall() or []:
            if row["obsolete"] or row["verrou_manuel"]:
                continue
            hb, he = _decimal(row["batterie_prix_ht"]), _decimal(row["ecran_prix_ht"])
            if hb is None or hb <= 0:
                continue
            if effectif(row["batterie_par_ecran"], categorie=row["categorie"]) and he is not None and he > 0:
                nouveau = prix_batterie(hb, he, r)
            else:
                nouveau = prix.prix_apple(hb, row["categorie"], r)
            if row["batterie_prix_vente"] != nouveau:
                changements.append((row["id"], "batterie_prix_vente", nouveau))
        if changements:
            e = prix.ecrire_prix_lot(cur, "tarifs_apple_devices", changements, source, par, lot_id, saisie=False,
                                     deriver=False)
            res["ecrits"] += [("tarifs_apple_devices", i, a, n) for i, _, a, n in e["ecrits"]]
            res["verrouilles"] += [prix.tarif_cle("tarifs_apple_devices", i, "batterie") for i in e["verrouilles"]]
    return res
