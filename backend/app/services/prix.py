"""
Moteur de prix : règles de marge, écriture contrôlée des prix (historique, date et
source du prix, verrou manuel), propositions de prix, annulation d'un lot, santé des prix.

Trois sources contrôlées, jamais de scraping de prix :
- 'commande' : prix HT réellement payé lors d'une commande de pièce (proposition à valider) ;
- 'import'   : fichier fournisseur Excel/CSV (services/import_prix, aperçu puis application) ;
- 'formule'  : règles de marge et ajustements globaux (aperçu puis application).
Plus 'manuel' (saisie admin), 'annulation' (lot annulé) et 'estimation_2026_02'
(prix saisis le 2026-02-15, jamais mis à jour : initialisation unique dans main.py).

Garde-fous :
- toute écriture de prix passe par ecrire_prix / ecrire_prix_lot : n'écrit que si la valeur
  change, date le prix (prix_maj_le) et sa source, ajoute une ligne à tarifs_historique ;
- une ligne verrouillée — verrou_manuel des pièces fournisseur (tarifs, tarifs_apple_devices),
  ou cadenas des grilles boutique (params PRIX_LIGNES_VERROUILLEES = {table: [ids]} pour
  tarifs_reparation, iphone_tarifs, smartphones_tarifs) — n'est modifiée que par une SAISIE
  MANUELLE EXPLICITE d'un admin (source 'manuel', ligne par ligne : c'est le gérant qui tape le
  prix ; le verrou reste posé). Jamais par un recalcul, un ajustement global ou de nouvelles
  règles (/simuler et /appliquer l'excluent et la listent), un import, une mise à jour en masse
  de grille (/reparation/bulk), une proposition, ni l'annulation d'un lot (conflit listé) ;
- jamais de TRUNCATE ni de DELETE + INSERT : les ids restent stables (« tarifs:123 »
  dans les lignes de ticket) ; les tickets existants gardent leur prix ;
- tables et colonnes en liste blanche : aucun nom venu de l'utilisateur dans le SQL.
"""

import copy
import json
import uuid
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from psycopg2.extras import execute_values

from app.services import params as params_cache

# ─── Règles de marge ────────────────────────────────────────────

CLE_REGLES = "TARIFS_REGLES"
SOURCE_ESTIMATION = "estimation_2026_02"
SOURCES = ("manuel", "formule", "import", "commande", "annulation")

# Valeurs actuelles exactes (tarifs.calcul_prix_client, calc_prix_ipad, calc_prix_macbook
# historiques) : aucun prix ne bouge au déploiement.
REGLES_DEFAUT = {
    "tva": 1.2,
    "ecran": {"standard": 60, "haut_de_gamme": 70, "pliant": 100},
    "autre": 60,
    "ipad": 110,
    "macbook": 120,
    "arrondi": "9_sup",
    "seuil_marge_alerte": 40,
    "variation_alerte_pct": 25,
    "variation_alerte_eur": 30,
    "jours_a_revoir": 90,
    "jours_perime": 180,
}
ARRONDIS = ("9_sup", "entier")
CATEGORIES_ECRAN = ("standard", "haut_de_gamme", "pliant")


# Initialisation unique (drapeau dans params), exécutée au démarrage après les ALTER : chaque prix
# reçoit la date de sa dernière mise à jour, et les prix fournisseur la source « estimation »
# (saisis le 2026-02-15, jamais mis à jour). Colonne absente : le bloc échoue sans poser le drapeau.
FLAG_INITIALISATION = "MIGRATION_PRIX_INIT_2026_10"
SQL_INITIALISATION = """DO $kp$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM params WHERE cle = 'MIGRATION_PRIX_INIT_2026_10') THEN
        UPDATE tarifs SET prix_maj_le = COALESCE(updated_at, NOW()),
                          prix_source = COALESCE(prix_source, 'estimation_2026_02')
        WHERE prix_maj_le IS NULL;
        UPDATE tarifs_apple_devices SET prix_maj_le = COALESCE(updated_at, NOW()),
                                        prix_source = COALESCE(prix_source, 'estimation_2026_02')
        WHERE prix_maj_le IS NULL;
        UPDATE tarifs_reparation SET prix_maj_le = COALESCE(updated_at, NOW()) WHERE prix_maj_le IS NULL;
        UPDATE iphone_tarifs SET prix_maj_le = COALESCE(updated_at, NOW()) WHERE prix_maj_le IS NULL;
        UPDATE smartphones_tarifs SET prix_maj_le = COALESCE(updated_at, NOW()) WHERE prix_maj_le IS NULL;
        INSERT INTO params (cle, valeur) VALUES ('MIGRATION_PRIX_INIT_2026_10', '1') ON CONFLICT (cle) DO NOTHING;
    END IF;
END $kp$"""


def _fusion(base: dict, ajout: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (ajout or {}).items():
        if k not in base:
            continue
        if isinstance(base[k], dict):
            if isinstance(v, dict):
                out[k] = {**out[k], **{kk: vv for kk, vv in v.items() if kk in base[k]}}
        else:
            out[k] = v
    return out


def regles(cur=None) -> dict:
    """Règles en vigueur (params TARIFS_REGLES, JSON) complétées par les valeurs par défaut."""
    brut = params_cache.get_param(CLE_REGLES, "", cur)
    try:
        lu = json.loads(brut) if brut else {}
    except (TypeError, ValueError):
        lu = {}
    if not isinstance(lu, dict):
        lu = {}
    r = _fusion(REGLES_DEFAUT, lu)
    try:
        return valider_regles({}, base=r)
    except ValueError:
        return copy.deepcopy(REGLES_DEFAUT)


def _nombre(v, mini, maxi, nom, entier=False):
    if isinstance(v, bool):
        raise ValueError(f"{nom} : nombre attendu")
    try:
        d = Decimal(str(v).replace(",", ".").strip())
    except (InvalidOperation, AttributeError):
        raise ValueError(f"{nom} : nombre attendu")
    if not d.is_finite() or d < mini or d > maxi:
        raise ValueError(f"{nom} : valeur attendue entre {mini} et {maxi}")
    if entier or d == d.to_integral_value():
        if entier and d != d.to_integral_value():
            raise ValueError(f"{nom} : nombre entier attendu")
        return int(d)
    return float(d)


def valider_regles(entree: dict, base: dict = None) -> dict:
    """Règles complètes et contrôlées (ValueError en français sinon) : `entree` sur `base`."""
    if not isinstance(entree, dict):
        raise ValueError("Règles : objet attendu")
    r = _fusion(base if base is not None else REGLES_DEFAUT, entree)
    r["tva"] = _nombre(r["tva"], 1, Decimal("1.5"), "TVA (coefficient)")
    if isinstance(r["tva"], int):
        r["tva"] = float(r["tva"])
    for k in CATEGORIES_ECRAN:
        r["ecran"][k] = _nombre(r["ecran"].get(k, REGLES_DEFAUT["ecran"][k]), 0, 1000, f"Marge écran {k}")
    for k, nom in (("autre", "Marge autres pièces"), ("ipad", "Marge iPad"), ("macbook", "Marge MacBook")):
        r[k] = _nombre(r[k], 0, 1000, nom)
    if r["arrondi"] not in ARRONDIS:
        raise ValueError("Arrondi : '9_sup' ou 'entier'")
    r["seuil_marge_alerte"] = _nombre(r["seuil_marge_alerte"], 0, 1000, "Seuil de marge")
    r["variation_alerte_pct"] = _nombre(r["variation_alerte_pct"], 0, 1000, "Seuil de variation (%)")
    r["variation_alerte_eur"] = _nombre(r["variation_alerte_eur"], 0, 10000, "Seuil de variation (€)")
    r["jours_a_revoir"] = _nombre(r["jours_a_revoir"], 1, 3650, "Jours avant « à revoir »", entier=True)
    r["jours_perime"] = _nombre(r["jours_perime"], 1, 3650, "Jours avant « périmé »", entier=True)
    if r["jours_perime"] <= r["jours_a_revoir"]:
        raise ValueError("« Périmé » doit venir après « à revoir »")
    return r


def enregistrer_regles(cur, r: dict):
    """Écrit les règles dans params (l'appelant invalide le cache après le commit)."""
    cur.execute(
        "INSERT INTO params (cle, valeur) VALUES (%s, %s) "
        "ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur",
        (CLE_REGLES, json.dumps(r, ensure_ascii=False, sort_keys=True)),
    )


def enregistrer_regles_lot(cur, avant: dict, apres: dict, lot_id: str, par: str):
    """Enregistre de nouvelles règles et garde les précédentes avec le lot (annuler_lot les remet)."""
    enregistrer_regles(cur, apres)
    cur.execute("""
        INSERT INTO tarifs_imports (fichier, fournisseur, cible, statut, resume, par, le, lot_id, applique_le)
        VALUES (NULL, NULL, 'regles', 'applique', %s::jsonb, %s, NOW(), %s, NOW())
    """, (json.dumps({"regles_avant": avant, "regles_apres": apres}), par, lot_id))


# ─── Calcul des prix ────────────────────────────────────────────

def arrondi_9_superieur(prix) -> int:
    """Plus petit entier finissant par 9 et >= prix (61 → 69, 90 → 99, 101 → 109)."""
    dizaine = int(prix) // 10
    candidat = dizaine * 10 + 9
    if candidat >= prix:
        return candidat
    return candidat + 10


def arrondi_9_inferieur(prix) -> int:
    """Plus grand entier finissant par 9 et <= prix (au moins 9) : baisses de prix."""
    candidat = int(prix) // 10 * 10 + 9
    if candidat > prix:
        candidat -= 10
    return max(9, candidat)


def _entier_sup(prix) -> int:
    n = int(prix)
    return n if n >= prix else n + 1


def arrondir(prix, mode="9_sup") -> int:
    if mode == "entier":
        return _entier_sup(prix)
    return arrondi_9_superieur(prix)


def est_ecran(type_piece) -> bool:
    t = (type_piece or "").lower()
    return "ecran" in t or "écran" in t


def prix_client(ht, type_piece, categorie, r=None) -> int:
    """Prix client TTC d'une pièce fournisseur (table tarifs) : HT × TVA + marge, arrondi.

    Avec les règles par défaut : exactement l'ancien tarifs.calcul_prix_client.
    """
    r = r or regles()
    cat = (categorie or "standard").lower()
    if est_ecran(type_piece):
        marge = r["ecran"].get(cat, r["ecran"]["standard"])
    else:
        marge = r["autre"]
    return arrondir(float(ht) * r["tva"] + marge, r["arrondi"])


def prix_apple(ht, categorie, r=None) -> int:
    """Prix de vente iPad / MacBook (table tarifs_apple_devices)."""
    r = r or regles()
    marge = r["ipad"] if categorie == "ipad" else r["macbook"]
    return arrondir(float(ht) * r["tva"] + marge, r["arrondi"])


def marge(prix, ht, r=None):
    """Marge TTC d'un prix client : prix − HT × TVA (même unité que les marges des règles)."""
    if prix is None or ht is None:
        return None
    r = r or regles()
    return round(float(prix) - float(ht) * r["tva"], 2)


def ajuster(valeur, ajustement: dict, entier: bool, mode_arrondi="9_sup"):
    """Ajustement global « +x % » ou « +x € » (valeur négative : baisse).

    Colonnes entières (prix affichés) : arrondi au 9 supérieur pour une hausse, au 9
    inférieur pour une baisse (« entier » : entier supérieur / inférieur).
    Colonnes HT : 2 décimales.
    """
    t, v = ajustement["type"], float(ajustement["valeur"])
    brut = float(valeur) * (1 + v / 100) if t == "pct" else float(valeur) + v
    if not entier:
        return float(Decimal(str(brut)).quantize(Decimal("0.01"), ROUND_HALF_UP))
    if brut <= 0:
        return 0
    if mode_arrondi == "entier":
        return _entier_sup(brut) if v >= 0 else int(brut)
    return arrondi_9_superieur(brut) if v >= 0 else arrondi_9_inferieur(brut)


def valider_ajustement(a) -> dict:
    if not isinstance(a, dict) or a.get("type") not in ("pct", "eur"):
        raise ValueError("Ajustement : type 'pct' ou 'eur' attendu")
    v = _nombre(a.get("valeur"), -90 if a["type"] == "pct" else -1000,
                500 if a["type"] == "pct" else 1000, "Ajustement")
    if v == 0:
        raise ValueError("Ajustement : valeur non nulle attendue")
    return {"type": a["type"], "valeur": v}


def alertes_variation(ancien, nouveau, r) -> list:
    """['variation'] si |Δ| dépasse le seuil en € ou en % (ancien connu et positif)."""
    if ancien is None or nouveau is None:
        return []
    a, n = float(ancien), float(nouveau)
    delta = abs(n - a)
    if delta > r["variation_alerte_eur"] or (a > 0 and delta / a * 100 > r["variation_alerte_pct"]):
        return ["variation"]
    return []


# ─── Tables et colonnes de prix (liste blanche) ─────────────────

COLONNES_REPARATION = (
    "ecran_generique", "ecran_confort", "ecran_apple", "batterie",
    "desoxydation", "connecteur_charge", "reparation_divers",
    "ecouteur_apn", "vitre_arriere", "chassis",
)
COLONNES_REPARATION_BARRE = tuple(c + "_barre" for c in COLONNES_REPARATION)
_PRIX_VENTE = {"prix_1": "integer", "prix_2": "integer", "prix_3": "integer"}

# base : prix « de référence » (coût HT, ou prix affiché d'une grille boutique) ;
# derivees : prix client calculé depuis la base par les règles.
TABLES = {
    "tarifs": {
        "base": {"prix_fournisseur_ht": "numeric"},
        "derivees": {"prix_client": "integer"},
        "source": True, "verrou": True,
    },
    "tarifs_apple_devices": {
        "base": {"ecran_prix_ht": "numeric", "batterie_prix_ht": "numeric"},
        "derivees": {"ecran_prix_vente": "integer", "batterie_prix_vente": "integer"},
        "source": True, "verrou": True,
    },
    "tarifs_reparation": {
        "base": {c: "integer" for c in COLONNES_REPARATION + COLONNES_REPARATION_BARRE},
        "derivees": {}, "source": False, "verrou": False,
    },
    "iphone_tarifs": {"base": dict(_PRIX_VENTE), "derivees": {}, "source": False, "verrou": False},
    "smartphones_tarifs": {"base": dict(_PRIX_VENTE), "derivees": {}, "source": False, "verrou": False},
}
PIECES_APPLE = ("ecran", "batterie")
_MAX_PRIX = Decimal("100000")

# Cadenas des grilles boutique (sans colonne verrou) : {table: [ids]} écrit par la configuration
# (api/config._controler_verrous_boutique, rôle admin et code), appliqué ici par le serveur.
PARAM_VERROUS_BOUTIQUE = "PRIX_LIGNES_VERROUILLEES"
TABLES_BOUTIQUE = ("tarifs_reparation", "iphone_tarifs", "smartphones_tarifs")


def lignes_verrouillees(cur) -> dict:
    """{table: set(ids)} des lignes cadenassées des grilles boutique.

    Lu en base dans la transaction de `cur` (jamais le cache des paramètres : un cadenas posé à
    l'instant sur un autre poste compte). Valeur illisible ou d'une forme inattendue : aucun
    cadenas (la configuration la valide et la normalise à l'écriture).
    """
    try:
        cur.execute("SELECT valeur FROM params WHERE cle = %s", (PARAM_VERROUS_BOUTIQUE,))
        row = cur.fetchone()
        brut = json.loads(row["valeur"]) if row and row["valeur"] else {}
    except (TypeError, ValueError, KeyError):
        return {}
    if not isinstance(brut, dict):
        return {}
    out = {}
    for table, ids in brut.items():
        if table in TABLES_BOUTIQUE and isinstance(ids, list):
            out[table] = {i for i in ids if isinstance(i, int) and not isinstance(i, bool)}
    return out


def _type_colonne(table: str, colonne: str) -> str:
    meta = TABLES.get(table)
    if meta is None:
        raise ValueError(f"Table de prix inconnue : {table}")
    t = meta["base"].get(colonne) or meta["derivees"].get(colonne)
    if t is None:
        raise ValueError(f"Colonne de prix inconnue : {table}.{colonne}")
    return t


def normaliser_valeur(type_col: str, v):
    """Valeur comparable et écrivable : int (colonnes entières), Decimal 2 décimales (HT)."""
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    if isinstance(v, bool):
        raise ValueError("Prix : nombre attendu")
    try:
        d = Decimal(str(v).strip().replace(",", "."))
    except InvalidOperation:
        raise ValueError(f"Prix illisible : {v!r}")
    if not d.is_finite() or d < 0 or d > _MAX_PRIX:
        raise ValueError(f"Prix hors limites : {v!r}")
    if type_col == "integer":
        return int(d.quantize(Decimal(1), ROUND_HALF_UP))
    return d.quantize(Decimal("0.01"), ROUND_HALF_UP)


def _valeur_lue(type_col: str, v):
    """Valeur actuelle en base, comparable à normaliser_valeur (jamais d'erreur sur une donnée ancienne)."""
    try:
        return normaliser_valeur(type_col, v)
    except ValueError:
        return v


def nouveau_lot() -> str:
    return uuid.uuid4().hex


def _fraiche(table: str, colonne: str, source: str) -> bool:
    """Le prix est-il « daté » par cette écriture ? Un prix client recalculé par la formule
    depuis un coût inchangé ne rajeunit pas le prix : seul le coût (ou une saisie) le date."""
    return not (source == "formule" and colonne in TABLES[table]["derivees"])


def ecrire_prix_lot(cur, table: str, changements, source: str, par: str, lot_id: str = None,
                    saisie: bool = None) -> dict:
    """Écrit un lot de prix d'une table en quelques requêtes (une par colonne modifiée).

    changements : [(ligne_id, colonne, nouveau)] — la dernière valeur d'un couple l'emporte.
    N'écrit que les valeurs qui changent ; date le prix (prix_maj_le, et prix_source pour
    tarifs et tarifs_apple_devices) sauf recalcul de formule d'un prix dérivé ; une ligne
    d'historique par valeur écrite.

    Lignes verrouillées (verrou_manuel, ou cadenas d'une grille boutique) : écrites seulement par
    une saisie manuelle explicite — source 'manuel' ET saisie vraie. `saisie` vaut par défaut
    (source == 'manuel') : un écran qui écrit le prix tapé par l'admin n'a rien à passer ; une
    écriture en masse de source 'manuel' (ajustement global d'une grille boutique, /bulk) passe
    saisie=False et laisse les lignes verrouillées, listées dans « verrouilles ».

    → {ecrits: [(id, colonne, ancien, nouveau)], verrouilles: [id], inchanges: n, absents: [id]}
    """
    if source not in SOURCES:
        raise ValueError(f"Source de prix inconnue : {source}")
    meta = TABLES.get(table)
    if meta is None:
        raise ValueError(f"Table de prix inconnue : {table}")
    saisie = (source == "manuel") if saisie is None else bool(saisie)
    passe_verrou = source == "manuel" and saisie
    voulu = {}
    for ligne_id, colonne, nouveau in changements:
        t = _type_colonne(table, colonne)
        voulu[(int(ligne_id), colonne)] = normaliser_valeur(t, nouveau)
    res = {"ecrits": [], "verrouilles": [], "inchanges": 0, "absents": []}
    if not voulu:
        return res
    ids = sorted({i for i, _ in voulu})
    colonnes = sorted({c for _, c in voulu})
    extra = ", prix_maj_le" + (", prix_source" if meta["source"] else "") + (", verrou_manuel" if meta["verrou"] else "")
    # Noms issus de la liste blanche TABLES uniquement
    cur.execute(
        f"SELECT id, {', '.join(colonnes)}{extra} FROM {table} WHERE id = ANY(%s) ORDER BY id FOR UPDATE",
        (ids,),
    )
    lignes = {r["id"]: r for r in cur.fetchall() or []}
    cadenas = set()
    if table in TABLES_BOUTIQUE and not passe_verrou:
        cadenas = lignes_verrouillees(cur).get(table, set())
    par_colonne, historique, verrouilles, absents = {}, [], set(), set()
    for (ligne_id, colonne), nouveau in sorted(voulu.items()):
        row = lignes.get(ligne_id)
        if row is None:
            absents.add(ligne_id)
            continue
        if not passe_verrou and ((meta["verrou"] and row.get("verrou_manuel")) or ligne_id in cadenas):
            verrouilles.add(ligne_id)
            continue
        t = _type_colonne(table, colonne)
        ancien = _valeur_lue(t, row.get(colonne))
        if ancien == nouveau:
            res["inchanges"] += 1
            continue
        fraiche = _fraiche(table, colonne, source)
        par_colonne.setdefault(colonne, []).append((ligne_id, nouveau, fraiche, source))
        historique.append((table, ligne_id, colonne, ancien, nouveau, source, lot_id, par,
                           row.get("prix_maj_le"), row.get("prix_source") if meta["source"] else None))
        res["ecrits"].append((ligne_id, colonne, ancien, nouveau))
    for colonne, valeurs in par_colonne.items():
        t = _type_colonne(table, colonne)
        maj_source = ", prix_source = CASE WHEN v.fraiche THEN v.src ELSE t.prix_source END" if meta["source"] else ""
        execute_values(
            cur,
            f"""UPDATE {table} AS t SET {colonne} = v.val::{t}, updated_at = NOW(),
                    prix_maj_le = CASE WHEN v.fraiche THEN NOW() ELSE t.prix_maj_le END{maj_source}
                FROM (VALUES %s) AS v(id, val, fraiche, src) WHERE t.id = v.id""",
            valeurs, template="(%s::integer, %s, %s::boolean, %s::text)", page_size=max(len(valeurs), 1),
        )
    if historique:
        execute_values(
            cur,
            """INSERT INTO tarifs_historique
                   (table_nom, ligne_id, colonne, ancien, nouveau, source, lot_id, par, ancien_maj_le, ancien_source)
               VALUES %s""",
            historique, page_size=max(len(historique), 1),
        )
    res["verrouilles"] = sorted(verrouilles)
    res["absents"] = sorted(absents)
    return res


def ecrire_prix(cur, table: str, ligne_id: int, colonne: str, nouveau, source: str, par: str,
                lot_id: str = None, saisie: bool = None) -> bool:
    """Écrit un prix (cf. ecrire_prix_lot). True si la valeur a été écrite ; False si elle est
    inchangée, si la ligne n'existe pas ou si elle est verrouillée (hors saisie manuelle)."""
    res = ecrire_prix_lot(cur, table, [(ligne_id, colonne, nouveau)], source, par, lot_id, saisie=saisie)
    return bool(res["ecrits"])


# ─── Clés de tarif (format de grille.py) ────────────────────────

def tarif_cle(table: str, ligne_id: int, colonne: str = None) -> str:
    """« tarifs:123 », « tarifs_apple_devices:5:ecran », « tarifs_reparation:3:batterie »,
    « iphone_tarifs:4:2 » (grille.py)."""
    if table == "tarifs":
        return f"tarifs:{int(ligne_id)}"
    if table in ("iphone_tarifs", "smartphones_tarifs") and colonne and colonne.startswith("prix_"):
        colonne = colonne[len("prix_"):]
    if table == "tarifs_apple_devices" and colonne:
        colonne = colonne.split("_")[0]
    return f"{table}:{int(ligne_id)}:{colonne}"


def parse_tarif_cle(cle) -> tuple:
    """(table, id, colonne) d'une clé de tarif ; ValueError si invalide.

    colonne : None pour tarifs ; 'ecran' | 'batterie' (pièce) pour tarifs_apple_devices ;
    nom de colonne pour tarifs_reparation ; 'prix_1' | 'prix_2' | 'prix_3' pour les grilles de vente.
    """
    parties = str(cle or "").strip().split(":")
    table = parties[0]
    if table not in TABLES or len(parties) < 2:
        raise ValueError(f"Clé de tarif invalide : {cle!r}")
    try:
        ligne_id = int(parties[1])
    except ValueError:
        raise ValueError(f"Clé de tarif invalide : {cle!r}")
    if ligne_id <= 0:
        raise ValueError(f"Clé de tarif invalide : {cle!r}")
    if table == "tarifs":
        if len(parties) != 2:
            raise ValueError(f"Clé de tarif invalide : {cle!r}")
        return table, ligne_id, None
    if len(parties) != 3:
        raise ValueError(f"Clé de tarif invalide : {cle!r}")
    col = parties[2]
    if table == "tarifs_apple_devices":
        piece = col.split("_")[0]
        if piece not in PIECES_APPLE or col not in (piece, f"{piece}_prix_ht", f"{piece}_prix_vente"):
            raise ValueError(f"Clé de tarif invalide : {cle!r}")
        return table, ligne_id, piece
    if table == "tarifs_reparation":
        if col not in TABLES[table]["base"]:
            raise ValueError(f"Clé de tarif invalide : {cle!r}")
        return table, ligne_id, col
    col = col if col.startswith("prix_") else f"prix_{col}"
    if col not in _PRIX_VENTE:
        raise ValueError(f"Clé de tarif invalide : {cle!r}")
    return table, ligne_id, col


def colonnes_ht(table: str, colonne=None) -> tuple:
    """(colonne HT, colonne prix client) d'une pièce fournisseur."""
    if table == "tarifs":
        return "prix_fournisseur_ht", "prix_client"
    if table == "tarifs_apple_devices" and colonne in PIECES_APPLE:
        return f"{colonne}_prix_ht", f"{colonne}_prix_vente"
    raise ValueError("Seules les pièces fournisseur (tarifs, tarifs_apple_devices) ont un prix HT")


def _label_tarifs(r) -> str:
    q = f" {r['qualite']}" if r.get("qualite") else ""
    return f"{r['marque']} {r['modele']} — {r['type_piece']}{q}"


def _label_apple(r, piece) -> str:
    return f"{r['modele']} — {'Écran' if piece == 'ecran' else 'Batterie'}"


def decrire_tarifs(cur, cles, r=None) -> dict:
    """{cle: description} des pièces fournisseur (tarifs, tarifs_apple_devices) en 2 requêtes au plus.

    description : {cle, table, id, colonne, label, marque, modele, type_piece, qualite,
    categorie, ht, client, verrou, obsolete, prix_maj_le, prix_source}. Clés invalides ou
    inconnues absentes du résultat.
    """
    r = r or regles(cur)
    voulues = {}
    for cle in cles or []:
        try:
            table, ligne_id, col = parse_tarif_cle(cle)
        except ValueError:
            continue
        if table in ("tarifs", "tarifs_apple_devices"):
            voulues.setdefault(table, {}).setdefault(ligne_id, []).append((tarif_cle(table, ligne_id, col), col))
    out = {}
    if voulues.get("tarifs"):
        cur.execute("""
            SELECT id, marque, modele, type_piece, qualite, categorie, prix_fournisseur_ht, prix_client,
                   verrou_manuel, obsolete, prix_maj_le, prix_source
            FROM tarifs WHERE id = ANY(%s)
        """, (list(voulues["tarifs"]),))
        for row in cur.fetchall() or []:
            for cle, _ in voulues["tarifs"].get(row["id"], []):
                out[cle] = {
                    "cle": cle, "table": "tarifs", "id": row["id"], "colonne": None,
                    "label": _label_tarifs(row), "marque": row["marque"], "modele": row["modele"],
                    "type_piece": row["type_piece"], "qualite": row["qualite"], "categorie": row["categorie"],
                    "ht": row["prix_fournisseur_ht"], "client": row["prix_client"],
                    "verrou": bool(row["verrou_manuel"]), "obsolete": bool(row["obsolete"]),
                    "prix_maj_le": row["prix_maj_le"], "prix_source": row["prix_source"],
                }
    if voulues.get("tarifs_apple_devices"):
        cur.execute("""
            SELECT id, categorie, modele, ecran_prix_ht, batterie_prix_ht, ecran_prix_vente, batterie_prix_vente,
                   verrou_manuel, obsolete, prix_maj_le, prix_source
            FROM tarifs_apple_devices WHERE id = ANY(%s)
        """, (list(voulues["tarifs_apple_devices"]),))
        for row in cur.fetchall() or []:
            for cle, piece in voulues["tarifs_apple_devices"].get(row["id"], []):
                out[cle] = {
                    "cle": cle, "table": "tarifs_apple_devices", "id": row["id"], "colonne": piece,
                    "label": _label_apple(row, piece), "marque": "Apple", "modele": row["modele"],
                    "type_piece": "Écran" if piece == "ecran" else "Batterie", "qualite": None,
                    "categorie": row["categorie"],
                    "ht": row[f"{piece}_prix_ht"], "client": row[f"{piece}_prix_vente"],
                    "verrou": bool(row["verrou_manuel"]), "obsolete": bool(row["obsolete"]),
                    "prix_maj_le": row["prix_maj_le"], "prix_source": row["prix_source"],
                }
    return out


def client_pour(desc: dict, ht, r) -> int:
    """Prix client d'une pièce décrite par decrire_tarifs pour un HT donné."""
    if desc["table"] == "tarifs":
        return prix_client(ht, desc["type_piece"], desc["categorie"], r)
    return prix_apple(ht, desc["categorie"], r)


def appliquer_ht(cur, cle: str, nouveau_ht, source: str, par: str, lot_id: str = None, r=None) -> dict:
    """Écrit le coût HT d'une pièce fournisseur et son prix client recalculé (même lot).

    → {ok, absent, verrouille, ancien_ht, nouveau_ht, ancien_client, nouveau_client}
    (ok : au moins une valeur écrite). Sert à l'acceptation d'une proposition de prix.
    """
    r = r or regles(cur)
    desc = decrire_tarifs(cur, [cle], r).get(tarif_cle(*parse_tarif_cle(cle)))
    if desc is None:
        return {"ok": False, "absent": True, "verrouille": False}
    ht = normaliser_valeur("numeric", nouveau_ht)
    if ht is None or ht <= 0:
        raise ValueError("Prix HT positif attendu")
    client = client_pour(desc, ht, r)
    col_ht, col_client = colonnes_ht(desc["table"], desc["colonne"])
    res = ecrire_prix_lot(cur, desc["table"], [(desc["id"], col_ht, ht), (desc["id"], col_client, client)],
                          source, par, lot_id)
    if lot_id and not res["verrouilles"]:
        # Proposition en cours d'acceptation (l'unique en attente de cette pièce) : son lot, pour
        # qu'annuler_lot la rouvre
        cur.execute("UPDATE tarifs_propositions SET lot_id = %s WHERE tarif_cle = %s AND statut = 'en_attente'",
                    (lot_id, desc["cle"]))
    return {
        "ok": bool(res["ecrits"]), "absent": False, "verrouille": bool(res["verrouilles"]),
        "ancien_ht": desc["ht"], "nouveau_ht": ht, "ancien_client": desc["client"], "nouveau_client": client,
    }


# ─── Plans de modification (recalcul, règles, ajustement global) ─

CIBLES = ("tarifs", "tarifs_apple_devices", "tarifs_reparation", "iphone_tarifs", "smartphones_tarifs")


def _norm(s) -> str:
    from app.services.prestations import normaliser
    return normaliser(s)


def _filtre(f) -> dict:
    if f is None:
        return {}
    if not isinstance(f, dict):
        raise ValueError("Filtre : objet attendu")
    out = {}
    for k in ("marque", "modele", "type_piece", "qualite", "categorie"):
        v = f.get(k)
        if v not in (None, ""):
            if not isinstance(v, str) or len(v) > 120:
                raise ValueError(f"Filtre {k} : texte attendu")
            out[k] = v.strip()
    if f.get("ids") not in (None, []):
        ids = f["ids"]
        if not isinstance(ids, list) or len(ids) > 5000:
            raise ValueError("Filtre ids : liste d'identifiants attendue")
        try:
            out["ids"] = {int(i) for i in ids}
        except (TypeError, ValueError):
            raise ValueError("Filtre ids : identifiants entiers attendus")
    cols = f.get("colonnes")
    if f.get("colonne") not in (None, ""):
        cols = [f["colonne"]] + list(cols or [])
    if cols not in (None, []):
        if not isinstance(cols, list) or not all(isinstance(c, str) for c in cols):
            raise ValueError("Filtre colonnes : liste de noms attendue")
        out["colonnes"] = set(cols)
    return out


def _garde(row, f, marque=None) -> bool:
    if "ids" in f and row["id"] not in f["ids"]:
        return False
    if "marque" in f and _norm(marque if marque is not None else row.get("marque")) != _norm(f["marque"]):
        return False
    if "modele" in f and _norm(f["modele"]) not in _norm(row.get("modele")):
        return False
    return True


def _entree(table, ligne_id, col_cle, label, ancien, nouveau, changements, verrou, alertes, **extra):
    return {"table": table, "id": ligne_id, "cle": tarif_cle(table, ligne_id, col_cle), "label": label,
            "ancien": ancien, "nouveau": nouveau, "changements": changements, "verrou": bool(verrou),
            "alertes": alertes, **extra}


def _alertes_piece(ancien, nouveau, client, ht, ecran, r) -> list:
    a = alertes_variation(ancien, nouveau, r)
    if ecran and ht is not None and client is not None and marge(client, ht, r) < r["seuil_marge_alerte"]:
        a.append("marge")
    return a


def _plan_fournisseur(cur, r_nouv, f, ajustement, r_actu, ignores):
    """Pièces fournisseur : prix client depuis le HT (règles r_nouv), HT ajusté le cas échéant."""
    out = []
    tp = _norm(f.get("type_piece"))
    cur.execute("""
        SELECT id, marque, modele, type_piece, qualite, categorie, prix_fournisseur_ht, prix_client, verrou_manuel
        FROM tarifs WHERE obsolete IS NOT TRUE ORDER BY id
    """)
    for row in cur.fetchall() or []:
        if not _garde(row, f) or (tp and tp != _norm(row["type_piece"])):
            continue
        if "qualite" in f and _norm(row["qualite"]) != _norm(f["qualite"]):
            continue
        if "categorie" in f and _norm(row["categorie"] or "standard") != _norm(f["categorie"]):
            continue
        ht = row["prix_fournisseur_ht"]
        if ht is None or ht <= 0:
            ignores.append(f"tarifs:{row['id']}")
            continue
        nouveau_ht = Decimal(str(ajuster(ht, ajustement, False))) if ajustement else Decimal(ht)
        if nouveau_ht <= 0:
            ignores.append(f"tarifs:{row['id']}")
            continue
        client = prix_client(nouveau_ht, row["type_piece"], row["categorie"], r_nouv)
        ch = [(row["id"], "prix_client", client)]
        if ajustement:
            ch.insert(0, (row["id"], "prix_fournisseur_ht", nouveau_ht))
        out.append(_entree(
            "tarifs", row["id"], None, _label_tarifs(row), row["prix_client"], client, ch, row["verrou_manuel"],
            _alertes_piece(row["prix_client"], client, client, nouveau_ht, est_ecran(row["type_piece"]), r_nouv),
            ancien_ht=float(ht), nouveau_ht=float(nouveau_ht)))
    return out


def _plan_apple(cur, r_nouv, f, ajustement, ignores):
    out = []
    tp = _norm(f.get("type_piece"))
    pieces = {c.split("_")[0] for c in f.get("colonnes", ())} & set(PIECES_APPLE)
    cur.execute("""
        SELECT id, categorie, modele, ecran_prix_ht, batterie_prix_ht, ecran_prix_vente, batterie_prix_vente,
               verrou_manuel
        FROM tarifs_apple_devices WHERE actif IS NOT FALSE AND obsolete IS NOT TRUE ORDER BY id
    """)
    for row in cur.fetchall() or []:
        if not _garde(row, f, marque="Apple"):
            continue
        if "categorie" in f and _norm(row["categorie"]) != _norm(f["categorie"]):
            continue
        for piece in PIECES_APPLE:
            if tp and not piece.startswith(tp) and not tp.startswith(piece):
                continue
            if pieces and piece not in pieces:
                continue
            ht = row[f"{piece}_prix_ht"]
            if ht is None or ht <= 0:
                if ht is not None:
                    ignores.append(tarif_cle("tarifs_apple_devices", row["id"], piece))
                continue
            nouveau_ht = Decimal(str(ajuster(ht, ajustement, False))) if ajustement else Decimal(ht)
            if nouveau_ht <= 0:
                ignores.append(tarif_cle("tarifs_apple_devices", row["id"], piece))
                continue
            client = prix_apple(nouveau_ht, row["categorie"], r_nouv)
            ancien = row[f"{piece}_prix_vente"]
            ch = [(row["id"], f"{piece}_prix_vente", client)]
            if ajustement:
                ch.insert(0, (row["id"], f"{piece}_prix_ht", nouveau_ht))
            out.append(_entree(
                "tarifs_apple_devices", row["id"], piece, _label_apple(row, piece), ancien, client, ch,
                row["verrou_manuel"], _alertes_piece(ancien, client, client, nouveau_ht, piece == "ecran", r_nouv),
                ancien_ht=float(ht), nouveau_ht=float(nouveau_ht)))
    return out


def _colonnes_grille(table, f) -> list:
    base = list(TABLES[table]["base"])
    if "colonnes" in f:
        inconnues = f["colonnes"] - set(base)
        if inconnues:
            raise ValueError(f"Colonnes inconnues : {', '.join(sorted(inconnues))}")
        return [c for c in base if c in f["colonnes"]]
    if table == "tarifs_reparation":
        principales = list(COLONNES_REPARATION)
        tp = f.get("type_piece")
        if tp:
            if tp in base:
                return [tp]
            n = _norm(tp).replace(" ", "_")
            return [c for c in principales if c.startswith(n)]
        return principales
    return base


def _plan_grille(cur, table, f, ajustement, r, ignores):
    """Grilles boutique (prix affichés) : ajustement direct de chaque colonne, arrondi au 9.
    Ligne cadenassée (PRIX_LIGNES_VERROUILLEES) : entrée marquée verrou, jamais appliquée."""
    cols = _colonnes_grille(table, f)
    if not cols:
        return []
    cadenas = lignes_verrouillees(cur).get(table, set())
    if table == "tarifs_reparation":
        cur.execute(f"SELECT id, modele, {', '.join(cols)} FROM tarifs_reparation ORDER BY ordre, id")
    elif table == "iphone_tarifs":
        cur.execute(f"SELECT id, 'Apple' AS marque, modele, stockage_1, stockage_2, stockage_3, {', '.join(cols)} "
                    f"FROM iphone_tarifs ORDER BY ordre, id")
    else:
        cur.execute(f"SELECT id, marque, modele, stockage_1, stockage_2, stockage_3, {', '.join(cols)} "
                    f"FROM smartphones_tarifs WHERE actif IS NOT FALSE ORDER BY ordre, id")
    out = []
    for row in cur.fetchall() or []:
        if not _garde(row, f, marque="Apple" if table != "smartphones_tarifs" else None):
            continue
        for col in cols:
            ancien = row.get(col)
            if ancien is None or ancien <= 0:
                continue
            nouveau = ajuster(ancien, ajustement, True, r["arrondi"])
            if nouveau <= 0:
                ignores.append(tarif_cle(table, row["id"], col))
                continue
            if table == "tarifs_reparation":
                label = f"{row['modele']} — {col.replace('_', ' ')}"
            else:
                stockage = row.get(f"stockage_{col[-1]}") or col
                label = f"{row['modele']} {stockage}".strip()
            out.append(_entree(table, row["id"], col, label, ancien, nouveau, [(row["id"], col, nouveau)],
                               row["id"] in cadenas, alertes_variation(ancien, nouveau, r)))
    return out


def planifier(cur, charge: dict, r_actu=None) -> dict:
    """Plan d'une modification de prix, sans aucune écriture.

    charge : {} (recalcul avec les règles en vigueur), {regles} (nouvelles règles sur tarifs et
    tarifs_apple_devices) ou {cible, filtre?, ajustement:{type:'pct'|'eur', valeur}}.
    → {mode, regles, entrees, ignores, source}
    """
    if not isinstance(charge, dict):
        raise ValueError("Charge : objet attendu")
    r_actu = r_actu or regles(cur)
    ignores = []
    if charge.get("ajustement") is not None or charge.get("cible") is not None:
        cible = charge.get("cible")
        if cible not in CIBLES:
            raise ValueError(f"Cible : {', '.join(CIBLES)}")
        ajustement = valider_ajustement(charge.get("ajustement"))
        f = _filtre(charge.get("filtre"))
        if cible == "tarifs":
            entrees = _plan_fournisseur(cur, r_actu, f, ajustement, r_actu, ignores)
        elif cible == "tarifs_apple_devices":
            entrees = _plan_apple(cur, r_actu, f, ajustement, ignores)
        else:
            entrees = _plan_grille(cur, cible, f, ajustement, r_actu, ignores)
        source = "formule" if cible in ("tarifs", "tarifs_apple_devices") else "manuel"
        return {"mode": "ajustement", "cible": cible, "regles": r_actu, "entrees": entrees,
                "ignores": ignores, "source": source}
    r_nouv = valider_regles(charge["regles"], base=r_actu) if charge.get("regles") is not None else r_actu
    entrees = _plan_fournisseur(cur, r_nouv, {}, None, r_actu, ignores) + _plan_apple(cur, r_nouv, {}, None, ignores)
    return {"mode": "regles" if charge.get("regles") is not None else "recalcul", "regles": r_nouv,
            "entrees": entrees, "ignores": ignores, "source": "formule"}


def _a_changer(e: dict) -> bool:
    """Une entrée de plan modifie-t-elle un prix (prix affiché ou coût HT) ?"""
    if e["ancien"] is None or float(e["ancien"]) != float(e["nouveau"]):
        return True
    return "ancien_ht" in e and e["ancien_ht"] != e["nouveau_ht"]


def resumer_plan(plan: dict, n_ecarts: int = 20) -> dict:
    """Comptages et plus gros écarts d'un plan (aperçu « ancien → nouveau »). Une ligne
    verrouillée (verrou_manuel ou cadenas boutique) n'est jamais modifiée par un plan, même de
    source 'manuel' (ajustement d'une grille boutique) : comptée et listée à part."""
    modifies, inchanges, verrouilles = [], 0, []
    for e in plan["entrees"]:
        if not _a_changer(e):
            inchanges += 1
        elif e["verrou"]:
            verrouilles.append(e)
        else:
            modifies.append(e)
    deltas = [float(e["nouveau"]) - float(e["ancien"] or 0) for e in modifies]
    pcts = [(float(e["nouveau"]) - float(e["ancien"])) / float(e["ancien"]) * 100
            for e in modifies if e["ancien"]]
    ecarts = sorted(modifies, key=lambda e: (-abs(float(e["nouveau"]) - float(e["ancien"] or 0)), e["cle"]))

    def vue(e):
        v = {"cle": e["cle"], "label": e["label"], "ancien": e["ancien"], "nouveau": e["nouveau"],
             "alerte": e["alertes"][0] if e["alertes"] else None, "alertes": e["alertes"]}
        if "ancien_ht" in e:
            v["ancien_ht"], v["nouveau_ht"] = e["ancien_ht"], e["nouveau_ht"]
        return v

    return {
        "modifies": len(modifies), "inchanges": inchanges, "verrouilles": len(verrouilles),
        "ignores": len(plan["ignores"]),
        "variation_moy": round(sum(deltas) / len(deltas), 2) if deltas else 0,
        "variation_min": round(min(deltas), 2) if deltas else 0,
        "variation_max": round(max(deltas), 2) if deltas else 0,
        "variation_moy_pct": round(sum(pcts) / len(pcts), 2) if pcts else 0,
        "alertes": sum(1 for e in modifies if e["alertes"]),
        "ecarts": [vue(e) for e in ecarts[:n_ecarts]],
        "verrouilles_liste": [{"cle": e["cle"], "label": e["label"]} for e in verrouilles[:50]],
    }


def appliquer_plan(cur, plan: dict, par: str, lot_id: str = None) -> dict:
    """Écrit un plan (une transaction : celle de `cur`) → {lot_id, modifies, verrouilles, inchanges}.

    Écriture en masse (saisie=False) : les lignes verrouillées — y compris celles cadenassées
    depuis l'aperçu — restent intactes, quelle que soit la source du plan.
    """
    lot_id = lot_id or nouveau_lot()
    par_table = {}
    for e in plan["entrees"]:
        if _a_changer(e):
            par_table.setdefault(e["table"], []).extend(e["changements"])
    modifies, verrouilles, inchanges = set(), set(), 0
    for table, changements in par_table.items():
        res = ecrire_prix_lot(cur, table, changements, plan["source"], par, lot_id, saisie=False)
        modifies |= {(table, i, c if table in ("tarifs_reparation", "iphone_tarifs", "smartphones_tarifs")
                      else c.split("_")[0] if table == "tarifs_apple_devices" else None)
                     for i, c, _, _ in res["ecrits"]}
        verrouilles |= {(table, i) for i in res["verrouilles"]}
        inchanges += res["inchanges"]
    return {"lot_id": lot_id if modifies else None, "modifies": len(modifies),
            "verrouilles": len(verrouilles), "inchanges": inchanges}


# ─── Propositions (commandes de pièces) ─────────────────────────

def creer_proposition(cur, tarif_cle_brute: str, nouveau_ht, source: str, par: str, commande_id: int = None):
    """Propose un nouveau coût HT pour une pièce fournisseur (jamais d'écriture du prix).

    None si la clé est invalide ou inconnue, si le HT est invalide, ou si l'écart avec le HT
    actuel est d'au plus 1 €. Sinon insère, ou actualise, l'unique proposition 'en_attente'
    de cette pièce et renvoie son id. Une pièce verrouillée reçoit quand même sa proposition.
    """
    try:
        table, ligne_id, col = parse_tarif_cle(tarif_cle_brute)
        col_ht, _ = colonnes_ht(table, col)
        ht = normaliser_valeur("numeric", nouveau_ht)
    except ValueError:
        return None
    if ht is None or ht <= 0:
        return None
    cle = tarif_cle(table, ligne_id, col)
    cur.execute(f"SELECT {col_ht} AS ht FROM {table} WHERE id = %s", (ligne_id,))
    row = cur.fetchone()
    if row is None:
        return None
    ancien = row["ht"]
    if ancien is not None and abs(Decimal(ancien) - ht) <= 1:
        return None
    cur.execute("""
        INSERT INTO tarifs_propositions (tarif_cle, ancien_ht, nouveau_ht, source, commande_id, statut, par, le)
        VALUES (%s, %s, %s, %s, %s, 'en_attente', %s, NOW())
        ON CONFLICT (tarif_cle) WHERE statut = 'en_attente' DO UPDATE SET
            ancien_ht = EXCLUDED.ancien_ht, nouveau_ht = EXCLUDED.nouveau_ht, source = EXCLUDED.source,
            commande_id = EXCLUDED.commande_id, par = EXCLUDED.par, le = NOW()
        RETURNING id
    """, (cle, ancien, ht, source or "commande", commande_id, par))
    return cur.fetchone()["id"]


# ─── Annulation d'un lot ────────────────────────────────────────

def lot_annulation(lot_id: str) -> str:
    return f"annulation:{lot_id}"


def _rouvrir_propositions(cur, lot_id: str, res: dict, par: str = None) -> tuple:
    """Propositions acceptées dans ce lot : aucune ne reste 'acceptee' une fois le lot annulé.

    - prix rétabli : de nouveau 'en_attente' (état d'avant le lot, à accepter ou refuser de
      nouveau), sauf si une autre proposition attend déjà pour la même pièce : 'annulee' (une
      seule en attente par pièce) ;
    - prix NON rétabli (modifié depuis le lot, ou pièce verrouillée depuis : conflit listé) alors
      qu'une autre partie du lot l'est : 'annulee' — le prix en place est plus récent que la
      proposition, la rouvrir inviterait à l'écraser avec un coût plus ancien. (Si rien du lot
      n'est rétabli, annuler_lot refuse avant d'arriver ici : la proposition reste 'acceptee'.)

    → (rouvertes, annulees)
    """
    cur.execute("SELECT id, tarif_cle FROM tarifs_propositions WHERE lot_id = %s AND statut = 'acceptee' "
                "ORDER BY id FOR UPDATE", (lot_id,))
    props = cur.fetchall() or []
    if not props:
        return 0, 0
    conflits, verrous = set(res["conflits"]), set(res["verrouilles"])
    rouvertes = annulees = 0
    for p in props:
        cle = p["tarif_cle"] or ""
        non_retabli = cle in conflits or cle in verrous or any(cle.startswith(v + ":") for v in verrous)
        attente = None
        if not non_retabli:
            cur.execute("SELECT 1 AS x FROM tarifs_propositions WHERE tarif_cle = %s AND statut = 'en_attente' "
                        "LIMIT 1", (cle,))
            attente = cur.fetchone()
        if not non_retabli and attente is None:
            cur.execute("UPDATE tarifs_propositions SET statut = 'en_attente', traite_le = NULL, traite_par = NULL "
                        "WHERE id = %s", (p["id"],))
            rouvertes += 1
        else:
            cur.execute("UPDATE tarifs_propositions SET statut = 'annulee', traite_le = NOW(), traite_par = %s "
                        "WHERE id = %s", (par, p["id"]))
            annulees += 1
    return rouvertes, annulees


def _rien_a_annuler(res: dict) -> str:
    """Message du refus d'une annulation qui ne rétablirait aucune valeur."""
    n = len(res["conflits"])
    if res["verrouilles"]:
        lignes = len(set(res["verrouilles"]))
        quoi = "1 ligne verrouillée" if lignes == 1 else f"{lignes} lignes verrouillées"
        return (f"Rien à annuler : les prix de ce lot sont verrouillés ou modifiés depuis ({quoi}). "
                "Retirez le verrou puis réessayez.")
    if n == 1:
        return "Rien à annuler : le prix de ce lot a été modifié depuis ; il reste tel quel."
    if n:
        return f"Rien à annuler : les {n} prix de ce lot ont été modifiés depuis ; ils restent tels quels."
    return "Rien à annuler dans ce lot."


def annuler_lot(cur, lot_id: str, par: str) -> dict:
    """Remet chaque valeur du lot à sa valeur d'avant le lot, avec sa date et sa source.

    Une valeur modifiée depuis le lot (valeur actuelle ≠ valeur écrite par le lot), ou dont la
    ligne est verrouillée (verrou_manuel, cadenas boutique), n'est pas touchée : listée dans
    « conflits » (et la ligne verrouillée dans « verrouilles »). Pièces créées par un import :
    marquées obsolètes (jamais supprimées). Propositions acceptées dans le lot : jamais laissées
    'acceptee' (cf. _rouvrir_propositions). LookupError : lot inconnu ; RuntimeError : déjà annulé,
    ou rien à rétablir.

    Un lot ne s'annule qu'une fois. Si une partie au moins est rétablie, l'annulation est définitive
    (ligne 'annulation:<lot>' dans l'historique ; tarifs_imports 'annule' pour un import ou des
    règles) et ce qui est en conflit reste tel quel. Si rien n'est rétabli (lot hors import dont
    toutes les valeurs sont verrouillées ou modifiées depuis) : RuntimeError, rien n'est changé
    (propositions comprises) et le lot reste annulable, par exemple une fois le verrou retiré.
    """
    cur.execute("""
        SELECT id, table_nom, ligne_id, colonne, ancien, nouveau, ancien_maj_le, ancien_source
        FROM tarifs_historique WHERE lot_id = %s ORDER BY id
    """, (lot_id,))
    lignes = cur.fetchall() or []
    cur.execute("SELECT id, resume FROM tarifs_imports WHERE lot_id = %s LIMIT 1", (lot_id,))
    imp = cur.fetchone()
    if not lignes and imp is None:
        # Acceptation d'une proposition qui n'a écrit aucune valeur (prix déjà égal) : le lot n'existe
        # que par la proposition, qu'on rouvre
        cur.execute("SELECT statut FROM tarifs_propositions WHERE lot_id = %s", (lot_id,))
        statuts = [p["statut"] for p in cur.fetchall() or []]
        if not statuts:
            raise LookupError("Lot inconnu")
        if "acceptee" not in statuts:
            raise RuntimeError("Ce lot a déjà été annulé")
    cur.execute("SELECT 1 AS x FROM tarifs_historique WHERE lot_id = %s LIMIT 1", (lot_annulation(lot_id),))
    deja = cur.fetchone() is not None
    if not deja and imp is not None:
        deja = (imp["resume"] or {}).get("statut_annulation") == "annule"
    if deja:
        raise RuntimeError("Ce lot a déjà été annulé")
    extra = ((imp or {}).get("resume") or {}).get("annulation") or {}
    crees = {(t, int(i)) for t, ids in (extra.get("ajoutes") or {}).items() for i in ids}
    # Pièce créée par le lot (toutes ses valeurs parties de rien, sans date antérieure) : obsolète
    par_ligne = {}
    for h in lignes:
        par_ligne.setdefault((h["table_nom"], h["ligne_id"]), []).append(h)
    for (t, i), hs in par_ligne.items():
        if t in ("tarifs", "tarifs_apple_devices") and all(h["ancien"] is None and h["ancien_maj_le"] is None for h in hs):
            crees.add((t, i))

    # Par (table, ligne, colonne) : valeur d'avant le lot (première écriture), valeur écrite (dernière)
    valeurs, avant_ligne = {}, {}
    for h in lignes:
        if h["table_nom"] not in TABLES or (h["table_nom"], h["ligne_id"]) in crees:
            continue
        try:
            _type_colonne(h["table_nom"], h["colonne"])
        except ValueError:
            continue
        k = (h["table_nom"], h["ligne_id"], h["colonne"])
        if k not in valeurs:
            valeurs[k] = [h["ancien"], h["nouveau"]]
        else:
            valeurs[k][1] = h["nouveau"]
        avant_ligne.setdefault((h["table_nom"], h["ligne_id"]), (h["ancien_maj_le"], h["ancien_source"]))

    lot = lot_annulation(lot_id)
    res = {"lot_id": lot_id, "annulation_lot": lot, "restaures": 0, "conflits": [], "verrouilles": [],
           "obsoletes_retablis": 0, "crees_retires": 0}

    def conflit(cle):
        # Une clé par pièce (« tarifs:12 » pour son HT et son prix client) : le front les compte
        if cle not in res["conflits"]:
            res["conflits"].append(cle)

    par_table = {}
    for (table, ligne_id, col), v in valeurs.items():
        par_table.setdefault(table, []).append((ligne_id, col, v))
    for table, items in par_table.items():
        meta = TABLES[table]
        cols = sorted({c for _, c, _ in items})
        ids = sorted({i for i, _, _ in items})
        cur.execute(f"SELECT id, {', '.join(cols)} FROM {table} WHERE id = ANY(%s) FOR UPDATE", (ids,))
        actuels = {r["id"]: r for r in cur.fetchall() or []}
        a_ecrire, conflits_lignes = [], set()
        for ligne_id, col, (ancien, ecrit) in items:
            t = _type_colonne(table, col)
            row = actuels.get(ligne_id)
            if row is None or _valeur_lue(t, row.get(col)) != _valeur_lue(t, ecrit):
                conflits_lignes.add(ligne_id)
                conflit(tarif_cle(table, ligne_id, col))
                continue
            a_ecrire.append((ligne_id, col, ancien))
        if not a_ecrire:
            continue
        # Source 'annulation' : une ligne verrouillée (depuis le lot) n'est jamais rétablie
        ecrit = ecrire_prix_lot(cur, table, a_ecrire, "annulation", par, lot)
        res["restaures"] += len(ecrit["ecrits"])
        res["verrouilles"] += [f"{table}:{i}" for i in ecrit["verrouilles"]]
        verrous_table = set(ecrit["verrouilles"])
        for ligne_id, col, _ in a_ecrire:
            if ligne_id in verrous_table:
                conflit(tarif_cle(table, ligne_id, col))
        # Date et source d'avant le lot, pour les lignes entièrement rétablies
        retablies = {i for i, _, _, _ in ecrit["ecrits"]} - conflits_lignes - set(ecrit["verrouilles"])
        dates = [(i, *avant_ligne[(table, i)]) for i in sorted(retablies) if (table, i) in avant_ligne]
        if dates:
            maj_src = ", prix_source = v.src" if meta["source"] else ""
            execute_values(
                cur,
                f"UPDATE {table} AS t SET prix_maj_le = v.maj{maj_src} "
                f"FROM (VALUES %s) AS v(id, maj, src) WHERE t.id = v.id",
                dates, template="(%s::integer, %s::timestamp, %s::text)", page_size=max(len(dates), 1),
            )

    # Spécifique à un import : confirmations, créations, obsolètes, références
    for table, liste in (extra.get("confirmes") or {}).items():
        if table not in ("tarifs", "tarifs_apple_devices") or not liste:
            continue
        execute_values(
            cur,
            f"UPDATE {table} AS t SET prix_maj_le = v.maj, prix_source = v.src "
            f"FROM (VALUES %s) AS v(id, maj, src) WHERE t.id = v.id AND t.prix_source = 'import'",
            [(int(i), m, s) for i, m, s in liste], template="(%s::integer, %s::timestamp, %s::text)",
            page_size=max(len(liste), 1),
        )
    for table in ("tarifs", "tarifs_apple_devices"):
        ids = sorted(i for t, i in crees if t == table)
        if ids:
            cur.execute(f"UPDATE {table} SET obsolete = TRUE WHERE id = ANY(%s) AND obsolete IS NOT TRUE", (ids,))
            res["crees_retires"] += cur.rowcount
    for table, ids in (extra.get("obsoletes") or {}).items():
        if table in ("tarifs", "tarifs_apple_devices") and ids:
            cur.execute(f"UPDATE {table} SET obsolete = FALSE WHERE id = ANY(%s) AND obsolete IS TRUE",
                        ([int(i) for i in ids],))
            res["obsoletes_retablis"] += cur.rowcount
    for table, ids in (extra.get("desobsoletes") or {}).items():
        if table in ("tarifs", "tarifs_apple_devices") and ids:
            cur.execute(f"UPDATE {table} SET obsolete = TRUE WHERE id = ANY(%s)", ([int(i) for i in ids],))
    for table, refs in (extra.get("refs") or {}).items():
        if table in ("tarifs", "tarifs_apple_devices") and refs:
            execute_values(
                cur,
                f"UPDATE {table} AS t SET ref_fournisseur = v.ref, fournisseur = COALESCE(v.f, t.fournisseur) "
                f"FROM (VALUES %s) AS v(id, ref, f) WHERE t.id = v.id",
                [(int(i), ref, f) for i, ref, f in refs], template="(%s::integer, %s::text, %s::text)",
                page_size=max(len(refs), 1),
            )
    if imp is None and lignes and res["restaures"] == 0 and not res["crees_retires"]:
        # Rien de rétabli : l'annulation n'aurait aucun effet sur les prix et ne laisserait aucune trace
        # (pas de ligne 'annulation:<lot>'), le lot resterait annulable. Refus (409, rollback de la
        # route) avant de toucher aux propositions : elles restent 'acceptee', le lot reste annulable
        # une fois le verrou retiré.
        raise RuntimeError(_rien_a_annuler(res))
    res["propositions_rouvertes"], res["propositions_annulees"] = _rouvrir_propositions(cur, lot_id, res, par)
    if imp is not None:
        resume = dict(imp["resume"] or {})
        # Lot de règles de marge : règles d'avant remises, sauf si elles ont changé depuis
        if resume.get("regles_avant"):
            if regles(cur) == valider_regles({}, base=_fusion(REGLES_DEFAUT, resume.get("regles_apres") or {})):
                enregistrer_regles(cur, valider_regles({}, base=_fusion(REGLES_DEFAUT, resume["regles_avant"])))
                res["regles"] = "retablies"
            else:
                res["regles"] = "conflit"
        resume["statut_annulation"] = "annule"
        cur.execute("UPDATE tarifs_imports SET statut = 'annule', resume = %s::jsonb WHERE id = %s",
                    (json.dumps(resume, default=str), imp["id"]))
    return res


# ─── Santé des prix ─────────────────────────────────────────────

def _vrai(v) -> bool:
    return str(v or "").strip().lower() in ("1", "true", "oui", "ok", "yes")


def sante(cur, r=None) -> dict:
    """Indicateurs agrégés (aucune donnée nominative) des prix fournisseur."""
    r = r or regles(cur)
    tva = Decimal(str(r["tva"]))
    cur.execute("""
        SELECT count(*) AS total,
               count(*) FILTER (WHERE prix_source = %(estim)s) AS estimes,
               count(*) FILTER (WHERE prix_maj_le < NOW() - make_interval(days => %(revoir)s)
                                  AND prix_maj_le >= NOW() - make_interval(days => %(perime)s)) AS a_revoir,
               count(*) FILTER (WHERE prix_maj_le IS NULL
                                   OR prix_maj_le < NOW() - make_interval(days => %(perime)s)) AS perimes,
               count(*) FILTER (WHERE ecran AND ht IS NOT NULL AND prix IS NOT NULL
                                  AND prix - ht * %(tva)s < %(seuil)s) AS marges_faibles,
               count(*) FILTER (WHERE verrou) AS verrouilles
        FROM (
            SELECT prix_source, prix_maj_le, type_piece ~* '[eé]cran' AS ecran,
                   prix_fournisseur_ht AS ht, prix_client AS prix, verrou_manuel AS verrou
            FROM tarifs WHERE obsolete IS NOT TRUE
            UNION ALL
            SELECT prix_source, prix_maj_le, TRUE, ecran_prix_ht, ecran_prix_vente, verrou_manuel
            FROM tarifs_apple_devices WHERE actif IS NOT FALSE AND obsolete IS NOT TRUE
        ) s
    """, {"estim": SOURCE_ESTIMATION, "revoir": r["jours_a_revoir"], "perime": r["jours_perime"],
          "tva": tva, "seuil": Decimal(str(r["seuil_marge_alerte"]))})
    out = {k: int(v or 0) for k, v in dict(cur.fetchone()).items()}
    cur.execute("SELECT count(*) AS n FROM tarifs_propositions WHERE statut = 'en_attente'")
    out["propositions_en_attente"] = int(cur.fetchone()["n"] or 0)
    p = params_cache.get_params(
        ["VEILLE_PRIX_RESUME", "VEILLE_PRIX_DERNIERE", "LCDPHONE_DERNIERE_SYNCHRO", "LCDPHONE_SYNCHRO_OK"], cur=cur)
    modeles_sans_prix = None
    try:
        veille = json.loads(p["VEILLE_PRIX_RESUME"]) if p["VEILLE_PRIX_RESUME"] else {}
        v = veille.get("modeles_sans_prix") if isinstance(veille, dict) else None
        modeles_sans_prix = len(v) if isinstance(v, list) else (int(v) if v is not None else None)
    except (TypeError, ValueError):
        modeles_sans_prix = None
    out["modeles_sans_prix"] = modeles_sans_prix
    out["derniere_veille"] = p["VEILLE_PRIX_DERNIERE"] or None
    out["lcdphone"] = {"derniere_synchro": p["LCDPHONE_DERNIERE_SYNCHRO"] or None,
                       "ok": _vrai(p["LCDPHONE_SYNCHRO_OK"]) if p["LCDPHONE_SYNCHRO_OK"] else None}
    out["seuils"] = {"jours_a_revoir": r["jours_a_revoir"], "jours_perime": r["jours_perime"],
                     "seuil_marge_alerte": r["seuil_marge_alerte"]}
    return out
