"""
Moteur de prix : règles de marge, écriture contrôlée des prix (historique, date et
source du prix, verrou manuel), propositions de prix, annulation d'un lot, santé des prix.

Trois sources contrôlées, jamais de scraping de prix :
- 'commande' : prix HT réellement payé lors d'une commande de pièce (proposition à valider) ;
- 'import'   : fichier fournisseur Excel/CSV (services/import_prix, aperçu puis application) ;
- 'formule'  : règles de marge et ajustements globaux (aperçu puis application).
Plus 'manuel' (saisie admin), 'utopya' / 'mobilax' (saisie admin d'un prix relevé chez ce
fournisseur, écran « Réparation smartphones » : jamais lu automatiquement, le gérant le tape),
'annulation' (lot annulé) et 'estimation_2026_02' (prix saisis le 2026-02-15, jamais mis à
jour : initialisation unique dans main.py).

Garde-fous :
- toute écriture de prix passe par ecrire_prix / ecrire_prix_lot : n'écrit que si la valeur
  change, date le prix (prix_maj_le) et sa source, ajoute une ligne à tarifs_historique ;
- une ligne verrouillée — verrou_manuel des pièces fournisseur (tarifs, tarifs_apple_devices),
  ou cadenas des grilles boutique (params PRIX_LIGNES_VERROUILLEES = {table: [ids]} pour
  tarifs_reparation, iphone_tarifs, smartphones_tarifs) — n'est modifiée que par une SAISIE
  MANUELLE EXPLICITE d'un admin (source 'manuel', 'utopya' ou 'mobilax' — SOURCES_SAISIE —,
  ligne par ligne : c'est le gérant qui tape le prix ; le verrou reste posé). Jamais par un
  recalcul, un ajustement global ou de nouvelles
  règles (/simuler et /appliquer l'excluent et la listent), un import, une mise à jour en masse
  de grille (/reparation/bulk), une proposition, ni l'annulation d'un lot (conflit listé) ;
- jamais de TRUNCATE ni de DELETE + INSERT : les ids restent stables (« tarifs:123 »
  dans les lignes de ticket) ; les tickets existants gardent leur prix ;
- tables et colonnes en liste blanche : aucun nom venu de l'utilisateur dans le SQL.
"""

import copy
import re
import json
import uuid
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Optional

from psycopg2.extras import execute_values

from app.services import params as params_cache

# ─── Règles de marge ────────────────────────────────────────────

CLE_REGLES = "TARIFS_REGLES"
SOURCE_ESTIMATION = "estimation_2026_02"
# Saisies explicites d'un admin, ligne par ligne : la source dit seulement où le prix a été relevé
SOURCES_SAISIE = ("manuel", "utopya", "mobilax")
SOURCES = SOURCES_SAISIE + ("formule", "import", "commande", "annulation")

# Valeurs actuelles exactes (tarifs.calcul_prix_client, calc_prix_ipad, calc_prix_macbook
# historiques) : aucun prix ne bouge au déploiement.
REGLES_DEFAUT = {
    "tva": 1.2,
    "ecran": {"standard": 60, "haut_de_gamme": 70, "pliant": 100},
    "autre": 60,
    "ipad": 110,
    "macbook": 120,
    "batterie_par_ecran": 70,    # (HT écran + HT batterie) × TVA + cette marge (services/par_ecran)
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
    for k, nom in (("autre", "Marge autres pièces"), ("ipad", "Marge iPad"), ("macbook", "Marge MacBook"),
                   ("batterie_par_ecran", "Marge batterie par l'écran")):
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


def marge_piece(type_piece, categorie, r) -> float:
    """Marge (€) d'une pièce fournisseur selon les règles : écran par catégorie, sinon « autre »."""
    cat = (categorie or "standard").lower()
    if est_ecran(type_piece):
        return r["ecran"].get(cat, r["ecran"]["standard"])
    return r["autre"]


def marge_apple(categorie, r) -> float:
    return r["ipad"] if categorie == "ipad" else r["macbook"]


def _brut(ht, marge_eur, r) -> float:
    """HT × TVA + marge, avant arrondi : l'unique expression du calcul (prix_client, prix_apple,
    calcul_detail), pour que le détail affiché corresponde au prix écrit."""
    return float(ht) * r["tva"] + marge_eur


def prix_client(ht, type_piece, categorie, r=None) -> int:
    """Prix client TTC d'une pièce fournisseur (table tarifs) : HT × TVA + marge, arrondi.

    Avec les règles par défaut : exactement l'ancien tarifs.calcul_prix_client.
    """
    r = r or regles()
    return arrondir(_brut(ht, marge_piece(type_piece, categorie, r), r), r["arrondi"])


def prix_apple(ht, categorie, r=None) -> int:
    """Prix de vente iPad / MacBook (table tarifs_apple_devices)."""
    r = r or regles()
    return arrondir(_brut(ht, marge_apple(categorie, r), r), r["arrondi"])


def _detail(ht, marge_eur, r) -> dict:
    brut = _brut(ht, marge_eur, r)
    return {
        "ht": float(Decimal(str(ht)).quantize(Decimal("0.01"), ROUND_HALF_UP)),
        "tva": r["tva"], "marge": marge_eur,
        "brut": round(brut, 2),
        "arrondi": arrondir(brut, r["arrondi"]),
    }


def calcul_detail(ht, type_piece, categorie, r=None) -> dict:
    """Détail du calcul d'une pièce fournisseur, pour l'afficher au gérant :
    {ht, tva, marge, brut, arrondi} — « 42,00 × 1,2 + 60 = 110,40 → 119 € ».

    `arrondi` est exactement prix_client(ht, type_piece, categorie, r) (même expression) ;
    `brut` est arrondi à 2 décimales pour l'affichage seulement.
    """
    r = r or regles()
    return _detail(ht, marge_piece(type_piece, categorie, r), r)


def calcul_detail_apple(ht, categorie, r=None) -> dict:
    """Détail du calcul d'un iPad / MacBook (marge ipad ou macbook) ; `arrondi` = prix_apple."""
    r = r or regles()
    return _detail(ht, marge_apple(categorie, r), r)


def _euros(v) -> str:
    """« 60 », « 62,5 », « 1,2 » : nombre lisible en français (2 décimales au plus, sans zéro final)."""
    d = Decimal(str(v)).quantize(Decimal("0.01"), ROUND_HALF_UP)
    return str(int(d)) if d == d.to_integral_value() else format(d.normalize(), "f").replace(".", ",")


def regles_publiques(r: dict) -> dict:
    """Les règles qui font le prix (TVA, arrondi, marges), sans les seuils d'alerte."""
    return {"tva": r["tva"], "arrondi": r["arrondi"], "ecran": dict(r["ecran"]), "autre": r["autre"],
            "ipad": r["ipad"], "macbook": r["macbook"], "batterie_par_ecran": r["batterie_par_ecran"]}


def methode_calcul(r: dict = None, admin: bool = False) -> dict:
    """Encadré « Méthode de calcul » de l'écran Réparation smartphones, écrit par le serveur
    selon le rôle : → {admin, texte, regles, exemple}.

    Les montants des marges sont réservés au gérant (code admin) : avec la TVA et le prix
    client affiché, ils permettraient de retrouver le coût HT, masqué hors admin (règle
    cout_ht). Le personnel lit donc la méthode sans les montants — jamais des « valeurs par
    défaut » qui seraient fausses dès qu'une marge change. Admin : phrase complète avec les
    règles en vigueur, `regles` (regles_publiques) et `exemple` = calcul_detail(42, écran
    standard) — « 42,00 × 1,2 + 60 = 110,40 → 119 € »."""
    r = r or regles()
    tva = _euros(r["tva"])
    arrondi = "arrondi à l'euro supérieur" if r["arrondi"] == "entier" else "arrondi au 9 supérieur"
    if not admin:
        return {
            "admin": False,
            "texte": f"Prix client = {arrondi} de (prix fournisseur HT × {tva} + marge selon la pièce) · "
                     "le montant des marges est réservé au gérant (code admin)",
            "regles": None, "exemple": None,
        }
    e = r["ecran"]
    if e["standard"] == r["autre"]:
        marges = (f"marge {_euros(e['standard'])} € (écran standard, autres pièces), "
                  f"{_euros(e['haut_de_gamme'])} € (écran haut de gamme), {_euros(e['pliant'])} € (pliant)")
    else:
        marges = (f"marge {_euros(e['standard'])} € (écran standard), {_euros(e['haut_de_gamme'])} € "
                  f"(écran haut de gamme), {_euros(e['pliant'])} € (pliant), {_euros(r['autre'])} € (autres pièces)")
    return {
        "admin": True,
        "texte": f"Prix client = {arrondi} de (prix fournisseur HT × {tva} + marge) · {marges} · "
                 f"iPad +{_euros(r['ipad'])} €, MacBook +{_euros(r['macbook'])} € · "
                 f"batterie changée par l'écran (iPad, Pixel…) : (HT écran + HT batterie) × {tva} + "
                 f"{_euros(r['batterie_par_ecran'])} €",
        "regles": regles_publiques(r),
        "exemple": calcul_detail(42, "Ecran", "standard", r),
    }


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


def _valeurs(cur, template: str, lignes) -> bytes:
    """Liste VALUES composée par le pilote (mêmes échappements que execute_values)."""
    return b",".join(cur.mogrify(template, ligne) for ligne in lignes)


def _composer(cur, sql: str, params=None) -> bytes:
    return cur.mogrify(sql, params) if params is not None else sql.encode()


def ecrire_prix_lot(cur, table: str, changements, source: str, par: str, lot_id: str = None,
                    saisie: bool = None, *, lignes: dict = None, sql_joint=(), relire=None,
                    deriver: bool = True) -> dict:
    """Écrit un lot de prix d'une table en UN aller-retour (plus la lecture sous verrou).

    changements : [(ligne_id, colonne, nouveau)] — la dernière valeur d'un couple l'emporte.
    N'écrit que les valeurs qui changent ; date le prix (prix_maj_le, et prix_source pour
    tarifs et tarifs_apple_devices) sauf recalcul de formule d'un prix dérivé ; une ligne
    d'historique par valeur écrite.

    Lignes verrouillées (verrou_manuel, ou cadenas d'une grille boutique) : écrites seulement par
    une saisie manuelle explicite — source de SOURCES_SAISIE ('manuel', ou 'utopya' / 'mobilax'
    pour un prix relevé chez le fournisseur et tapé par l'admin) ET saisie vraie. `saisie` vaut
    par défaut (source de saisie) : un écran qui écrit le prix tapé par l'admin n'a rien à
    passer ; une écriture en masse de source 'manuel' (ajustement global d'une grille boutique,
    /bulk) passe saisie=False et laisse les lignes verrouillées, listées dans « verrouilles ».

    Allers-retours (chacun coûte ~20 ms en prod) : la lecture des lignes sous verrou, puis UN
    envoi qui porte les UPDATE (un par colonne modifiée), l'historique, et :
    - lignes : {id: ligne} déjà lues par l'appelant sous verrou (SELECT * … FOR UPDATE) —
      le moteur ne les relit pas (une route qui doit lire la ligne avant d'écrire) ;
    - sql_joint : [(sql, params)] instructions de la route envoyées avec les écritures de prix
      (nom du modèle, verrou, référence fournisseur…), avant elles ;
    - relire : (sql, params) lecture envoyée en dernier, qui voit les écritures ; ses lignes
      vont dans res["relu"] (la réponse de la route sans requête de plus).
    Fragments SQL fixes du code (noms de la liste blanche TABLES), jamais une saisie.

    deriver (tarifs, tarifs_apple_devices) : les batteries « changées par l'écran » des modèles
    touchés reçoivent leur prix client dérivé (services/par_ecran.deriver_changements) dans le
    même lot — passer False pour une valeur tapée par l'admin (ligne alors verrouillée) ou un
    recalcul déjà dérivé ; jamais de dérivation à l'annulation d'un lot (valeurs rétablies telles
    quelles).

    → {ecrits: [(id, colonne, ancien, nouveau)], verrouilles: [id], inchanges: n, absents: [id]}
      (+ relu: [lignes] si `relire`)
    """
    if source not in SOURCES:
        raise ValueError(f"Source de prix inconnue : {source}")
    meta = TABLES.get(table)
    if meta is None:
        raise ValueError(f"Table de prix inconnue : {table}")
    saisie = (source in SOURCES_SAISIE) if saisie is None else bool(saisie)
    passe_verrou = source in SOURCES_SAISIE and saisie
    voulu = {}
    for ligne_id, colonne, nouveau in changements:
        t = _type_colonne(table, colonne)
        voulu[(int(ligne_id), colonne)] = normaliser_valeur(t, nouveau)
    if deriver and voulu and source != "annulation" and table in ("tarifs", "tarifs_apple_devices"):
        from app.services import par_ecran
        derives = par_ecran.deriver_changements(cur, table, [(i, c, v) for (i, c), v in voulu.items()])
        voulu = {(int(i), c): normaliser_valeur(_type_colonne(table, c), v) for i, c, v in derives}
    res = {"ecrits": [], "verrouilles": [], "inchanges": 0, "absents": []}
    if not voulu and not sql_joint and relire is None:
        return res
    lignes = dict(lignes) if lignes else {}
    a_lire = sorted({i for i, _ in voulu} - set(lignes)) if voulu else []
    if a_lire:
        colonnes = sorted({c for _, c in voulu})
        extra = ", prix_maj_le" + (", prix_source" if meta["source"] else "") + (", verrou_manuel" if meta["verrou"] else "")
        # Noms issus de la liste blanche TABLES uniquement ; lignes déjà lues par l'appelant conservées
        cur.execute(
            f"SELECT id, {', '.join(colonnes)}{extra} FROM {table} WHERE id = ANY(%s) ORDER BY id FOR UPDATE",
            (a_lire,),
        )
        lignes.update({r["id"]: r for r in cur.fetchall() or []})
    cadenas = set()
    if voulu and table in TABLES_BOUTIQUE and not passe_verrou:
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
    # Un seul envoi : instructions de la route, UPDATE par colonne, historique, relecture
    envoi = [_composer(cur, sql, params) for sql, params in sql_joint]
    for colonne, valeurs in par_colonne.items():
        t = _type_colonne(table, colonne)
        maj_source = ", prix_source = CASE WHEN v.fraiche THEN v.src ELSE t.prix_source END" if meta["source"] else ""
        envoi.append(
            f"""UPDATE {table} AS t SET {colonne} = v.val::{t}, updated_at = NOW(),
                    prix_maj_le = CASE WHEN v.fraiche THEN NOW() ELSE t.prix_maj_le END{maj_source}
                FROM (VALUES """.encode()
            + _valeurs(cur, "(%s::integer, %s, %s::boolean, %s::text)", valeurs)
            + b") AS v(id, val, fraiche, src) WHERE t.id = v.id")
    if historique:
        envoi.append(
            b"""INSERT INTO tarifs_historique
                   (table_nom, ligne_id, colonne, ancien, nouveau, source, lot_id, par, ancien_maj_le, ancien_source)
               VALUES """
            + _valeurs(cur, "(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)", historique))
    if relire is not None:
        envoi.append(_composer(cur, *relire))
    if envoi:
        # Texte déjà composé (mogrify) : aucun paramètre, donc aucune interprétation des %
        cur.execute(b";\n".join(envoi))
    if relire is not None:
        res["relu"] = [dict(r) for r in (cur.fetchall() or [])]
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
                   verrou_manuel, obsolete, prix_maj_le, prix_source, fournisseur, fournisseur_choisi
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
                    "fournisseur": row.get("fournisseur"), "fournisseur_choisi": row.get("fournisseur_choisi"),
                }
    if voulues.get("tarifs_apple_devices"):
        cur.execute("""
            SELECT id, categorie, modele, ecran_prix_ht, batterie_prix_ht, ecran_prix_vente, batterie_prix_vente,
                   verrou_manuel, obsolete, prix_maj_le, prix_source, fournisseur, fournisseur_choisi
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
                    "fournisseur": row.get("fournisseur"), "fournisseur_choisi": row.get("fournisseur_choisi"),
                }
    return out


# ─── Prix par fournisseur (grille comparative Mobilax / Utopya) ──
# tarifs_fournisseurs_prix garde, pour chaque pièce et chaque fournisseur, le dernier prix HT relevé
# (synchro Mobilax, collecte Utopya, saisie admin), qu'il soit retenu ou non comme coût de la pièce.
# Le coût retenu reste prix_fournisseur_ht / *_prix_ht (colonne `fournisseur` = d'où il vient) : celui du
# fournisseur retenu par le gérant (fournisseur_choisi à la pièce, sinon la préférence de la grille, Mobilax
# par défaut), ou de l'autre quand le retenu n'a pas la pièce (cible_fournisseur). Jamais « le moins cher ».

FOURNISSEURS_CONNUS = ("Mobilax", "Utopya")

# ─── Écran avec ou sans châssis : l'écran complet d'abord ────────
# Mobilax (catégorie « Ecran Tactile Original sans Châssis ») et Utopya (« Ecran Complet Galaxy S25 (S931B) (Sans
# Châssis) ») vendent l'écran officiel de bien des Samsung en deux variantes : l'écran complet avec châssis — celui
# que le magasin pose, un peu moins de 100 € HT sur un Galaxy S25 — et la dalle seule « sans châssis », un peu moins
# de 70 €. Prendre « la variante la moins chère » mettait le prix sans châssis sur la ligne (gérant, 07/11/2026 :
# « il faut prioriser avec châssis… nous réparons avec châssis ») : un écran dit « sans châssis » passe toujours
# après les autres (rang_chassis), et le prix retenu dit laquelle des deux variantes il désigne (chassis_designation).
_ECRAN_NOMME = re.compile(r"(?<![a-z0-9])(?:ecran|lcd|oled|amoled|dalle|display)(?![a-z0-9])")
_SANS_CHASSIS = re.compile(r"(?<![a-z0-9])sans\s+chassis(?![a-z0-9])")
_AVEC_CHASSIS = re.compile(r"(?<![a-z0-9])avec\s+chassis(?![a-z0-9])")


def chassis_designation(designation) -> Optional[bool]:
    """Pour un écran : False s'il est vendu « sans châssis », True s'il est dit « avec châssis », None quand le nom
    ne le précise pas (l'écran ordinaire, vendu avec son châssis chez Samsung) ou que ce n'est pas un écran."""
    d = _norm(designation or "")
    if not d or not _ECRAN_NOMME.search(d):
        return None
    if _SANS_CHASSIS.search(d):
        return False
    if _AVEC_CHASSIS.search(d):
        return True
    return None


def rang_chassis(designation) -> int:
    """0 pour un écran avec châssis ou qui ne le dit pas, 1 pour un écran « sans châssis » : la variante sans
    châssis ne l'emporte que si elle est seule (fournisseurs.planifier, enregistrer_prix_fournisseur)."""
    return 1 if chassis_designation(designation) is False else 0


def fournisseur_propre(f) -> str:
    f = " ".join(str(f or "").split())
    for c in FOURNISSEURS_CONNUS:
        if f.lower() == c.lower():
            return c
    return f[:40]


def enregistrer_prix_fournisseur(cur, fournisseur: str, source: str, reconnues, infos: dict = None) -> int:
    """Prix de CE fournisseur pour chaque pièce reconnue d'un aperçu (import_prix.apercu : la variante la
    moins chère, un écran « sans châssis » seulement s'il est seul — rang_chassis) → tarifs_fournisseurs_prix ;
    prix_maj_le renouvelé seulement quand le prix change. infos : {référence: {url, en_stock}}.
    → nombre de pièces notées."""
    f = fournisseur_propre(fournisseur)
    meilleurs = {}
    for rec in reconnues or []:
        try:
            ht = Decimal(str(rec.get("nouveau_ht")))
        except (InvalidOperation, TypeError, ValueError):
            continue
        if ht <= 0 or not rec.get("cle"):
            continue
        rang = (rang_chassis(rec.get("designation")), ht)
        if rec["cle"] not in meilleurs or rang < meilleurs[rec["cle"]][0]:
            meilleurs[rec["cle"]] = (rang, rec)
    if not meilleurs or not f:
        return 0
    infos = infos or {}
    lignes = []
    for cle, ((_, ht), rec) in meilleurs.items():
        ref = (str(rec.get("ref") or "").strip()[:120]) or None
        info = infos.get(ref or "") or {}
        en_stock = info.get("en_stock")
        lignes.append((cle, f, ht, ref, (str(rec.get("designation") or "").strip()[:250]) or None,
                       info.get("url") or None, True if en_stock is None else bool(en_stock), source))
    execute_values(cur, """
        INSERT INTO tarifs_fournisseurs_prix
            (tarif_cle, fournisseur, prix_ht, ref_fournisseur, designation, url, en_stock, source, vu_le, prix_maj_le)
        VALUES %s
        ON CONFLICT (tarif_cle, fournisseur) DO UPDATE SET
            prix_maj_le = CASE WHEN tarifs_fournisseurs_prix.prix_ht IS DISTINCT FROM EXCLUDED.prix_ht
                               THEN NOW() ELSE tarifs_fournisseurs_prix.prix_maj_le END,
            prix_ht = EXCLUDED.prix_ht, ref_fournisseur = EXCLUDED.ref_fournisseur,
            designation = EXCLUDED.designation, url = COALESCE(EXCLUDED.url, tarifs_fournisseurs_prix.url),
            en_stock = EXCLUDED.en_stock, source = EXCLUDED.source, vu_le = NOW()
    """, lignes, template="(%s, %s, %s::numeric, %s, %s, %s, %s::boolean, %s, NOW(), NOW())", page_size=200)
    return len(lignes)


def noter_vus_sans_prix(cur, fournisseur: str, par_cle: dict) -> int:
    """Pièces désignées par un produit du fournisseur vu SANS prix (rupture, prix masqué) : ligne notée
    en_stock False, vue maintenant, prix connu gardé. par_cle : {cle: [lignes]}."""
    f = fournisseur_propre(fournisseur)
    lignes = []
    for cle, ls in (par_cle or {}).items():
        l = (ls or [{}])[0]
        lignes.append((cle, f, (str(l.get("reference") or "").strip()[:120]) or None,
                       (str(l.get("designation") or "").strip()[:250]) or None, l.get("url") or None))
    if not lignes or not f:
        return 0
    execute_values(cur, """
        INSERT INTO tarifs_fournisseurs_prix
            (tarif_cle, fournisseur, prix_ht, ref_fournisseur, designation, url, en_stock, source, vu_le, prix_maj_le)
        VALUES %s
        ON CONFLICT (tarif_cle, fournisseur) DO UPDATE SET
            ref_fournisseur = COALESCE(EXCLUDED.ref_fournisseur, tarifs_fournisseurs_prix.ref_fournisseur),
            designation = COALESCE(EXCLUDED.designation, tarifs_fournisseurs_prix.designation),
            url = COALESCE(EXCLUDED.url, tarifs_fournisseurs_prix.url), en_stock = FALSE, vu_le = NOW()
    """, lignes, template="(%s, %s, NULL, %s, %s, %s, FALSE, 'vu_sans_prix', NOW(), NULL)", page_size=200)
    return len(lignes)


def prix_fournisseurs(cur, cles) -> dict:
    """{cle: {fournisseur: {ht, ref, designation, chassis, url, en_stock, vu_le, prix_maj_le, source}}} —
    chassis : True / False / None d'après la désignation (chassis_designation)."""
    cles = [c for c in (cles or []) if c]
    if not cles:
        return {}
    cur.execute("""
        SELECT tarif_cle, fournisseur, prix_ht, ref_fournisseur, designation, url, en_stock, vu_le, prix_maj_le, source
        FROM tarifs_fournisseurs_prix WHERE tarif_cle = ANY(%s)
    """, (cles,))
    out = {}
    for r in cur.fetchall() or []:
        out.setdefault(r["tarif_cle"], {})[r["fournisseur"]] = {
            "ht": float(r["prix_ht"]) if r["prix_ht"] is not None else None, "ref": r["ref_fournisseur"],
            "designation": r["designation"], "chassis": chassis_designation(r["designation"]), "url": r["url"],
            "en_stock": r["en_stock"], "vu_le": r["vu_le"], "prix_maj_le": r["prix_maj_le"], "source": r["source"],
        }
    return out


def cible_fournisseur(dispo: dict, desc, prefere) -> Optional[dict]:
    """Le prix de fournisseur à retenir pour une pièce parmi `dispo` ({fournisseur: {ht | prix_ht, ref |
    ref_fournisseur, url, en_stock…}}, cf. prix_fournisseurs / tarifs_fournisseurs_prix) : celui du fournisseur
    choisi pour la pièce (fournisseur_choisi), sinon du préféré de la grille (`prefere`, jamais vide : Mobilax par
    défaut), sinon — s'il n'a pas la pièce — de l'autre fournisseur qui l'a (complément). Le prix lui-même ne
    décide jamais (le moins cher n'est pas un critère). → {fournisseur, ht (Decimal), ref, url, en_stock} | None"""
    choix = " ".join(str((desc or {}).get("fournisseur_choisi") or "").split()) if isinstance(desc, dict) else ""
    choix = fournisseur_propre(choix or prefere or FOURNISSEURS_CONNUS[0])
    for f in [choix] + [x for x in FOURNISSEURS_CONNUS if x != choix]:
        d = (dispo or {}).get(f)
        if not d:
            continue
        ht = d.get("ht", d.get("prix_ht"))
        try:
            ht = Decimal(str(ht)) if ht is not None else None
        except InvalidOperation:
            ht = None
        if ht is not None and ht > 0:
            return {"fournisseur": f, "ht": ht, "ref": d.get("ref", d.get("ref_fournisseur")), "url": d.get("url"),
                    "en_stock": d.get("en_stock")}
    return None


def noter_fournisseur_retenu(cur, cle: str, cible: dict) -> None:
    """Colonnes fournisseur / ref_fournisseur / url_fournisseur de la pièce d'après le prix retenu (cible_fournisseur)."""
    table, ligne_id, _ = parse_tarif_cle(cle)
    if table == "tarifs":
        cur.execute("UPDATE tarifs SET fournisseur = %s, ref_fournisseur = COALESCE(%s, ref_fournisseur), "
                    "url_fournisseur = COALESCE(%s, url_fournisseur) WHERE id = %s",
                    (cible["fournisseur"], cible.get("ref"), cible.get("url"), ligne_id))
    else:
        cur.execute("UPDATE tarifs_apple_devices SET fournisseur = %s, ref_fournisseur = COALESCE(%s, ref_fournisseur) "
                    "WHERE id = %s", (cible["fournisseur"], cible.get("ref"), ligne_id))


def vider_prix(cur, cle: str, par: str, lot_id: str = None) -> dict:
    """Ramène une pièce fournisseur (table tarifs) à « prix à renseigner » : coût 0, prix client 0, sans date, sans
    source datée ni fournisseur — l'état d'une pièce courante pré-créée, remplie par le passage suivant. Historique
    dans le lot (annulable). Les batteries « changées par l'écran » du modèle sont recalculées (sans cet écran).
    → résultat d'ecrire_prix_lot"""
    table, ligne_id, _ = parse_tarif_cle(cle)
    if table != "tarifs":
        raise ValueError("Seule une pièce de la grille des pièces peut être vidée")
    res = ecrire_prix_lot(cur, "tarifs", [(ligne_id, "prix_fournisseur_ht", 0), (ligne_id, "prix_client", 0)],
                          "import", par, lot_id)
    if not res["verrouilles"]:
        cur.execute("UPDATE tarifs SET prix_source = 'a_renseigner', prix_maj_le = NULL, fournisseur = NULL, "
                    "ref_fournisseur = NULL, url_fournisseur = NULL WHERE id = %s", (ligne_id,))
    return res


def choisir_fournisseur(cur, cle: str, fournisseur, par: str, r=None, prefere=None) -> dict:
    """Le gérant choisit le fournisseur d'une pièce (None = suivre la préférence de la grille) : colonne
    fournisseur_choisi, et le coût HT retenu devient le prix connu de ce fournisseur (cible_fournisseur : l'autre
    s'il n'a pas la pièce), sauf pièce verrouillée. La synchro et la collecte respectent ensuite ce choix
    (fournisseurs.planifier). → {cle, fournisseur_choisi, applique: {…appliquer_ht, fournisseur} | None,
    verrouille, disponibles}"""
    r = r or regles(cur)
    table, ligne_id, col = parse_tarif_cle(cle)
    if table not in ("tarifs", "tarifs_apple_devices"):
        raise ValueError("Clé de pièce invalide")
    f = fournisseur_propre(fournisseur) if fournisseur else None
    if f and f not in FOURNISSEURS_CONNUS:
        raise ValueError("Fournisseur inconnu")
    cur.execute(f"UPDATE {table} SET fournisseur_choisi = %s WHERE id = %s", (f, ligne_id))
    if not cur.rowcount:
        return {"cle": cle, "absent": True}
    cle = tarif_cle(table, ligne_id, col)
    desc = decrire_tarifs(cur, [cle], r).get(cle)
    dispo = prix_fournisseurs(cur, [cle]).get(cle, {})
    cible = cible_fournisseur(dispo, {"fournisseur_choisi": f}, prefere) if desc else None
    applique, verrouille = None, False
    if cible is not None:
        if desc["verrou"]:
            verrouille = True
        else:
            applique = appliquer_ht(cur, cle, cible["ht"], cible["fournisseur"].lower(), par, nouveau_lot(), r)
            applique["fournisseur"] = cible["fournisseur"]
            noter_fournisseur_retenu(cur, cle, cible)
    return {"cle": cle, "fournisseur_choisi": f, "applique": applique, "verrouille": verrouille,
            "disponibles": sorted(dispo)}


def appliquer_preference(cur, prefere, par: str, r=None) -> dict:
    """Aligne le coût retenu de chaque pièce sur le fournisseur retenu : prix connu du fournisseur préféré de la
    grille (`prefere`, Mobilax par défaut) — un fournisseur choisi à la pièce prime —, ou de l'autre quand le
    retenu n'a pas la pièce (cible_fournisseur : jamais le moins cher) ; pièce verrouillée laissée. Un seul lot
    (annulable). → {examinees, modifies, verrouillees, inchangees, sans_prix, lot_id}"""
    r = r or regles(cur)
    f = fournisseur_propre(prefere or FOURNISSEURS_CONNUS[0])
    cur.execute("SELECT tarif_cle, fournisseur, prix_ht, ref_fournisseur, url, en_stock "
                "FROM tarifs_fournisseurs_prix WHERE prix_ht IS NOT NULL")
    par_cle = {}
    for row in cur.fetchall() or []:
        par_cle.setdefault(row["tarif_cle"], {})[row["fournisseur"]] = dict(row)
    out = {"examinees": len(par_cle), "modifies": 0, "verrouillees": 0, "inchangees": 0, "sans_prix": 0, "lot_id": None}
    if not par_cle:
        return out
    descs = decrire_tarifs(cur, list(par_cle), r)
    lot = nouveau_lot()
    for cle, dispo in par_cle.items():
        desc = descs.get(cle)
        if desc is None or desc.get("obsolete"):
            continue
        cible = cible_fournisseur(dispo, desc, f)
        if cible is None:
            out["sans_prix"] += 1
            continue
        if desc.get("verrou"):
            out["verrouillees"] += 1
            continue
        meme = str(desc.get("fournisseur") or "").lower() == cible["fournisseur"].lower()
        if meme and desc.get("ht") is not None and Decimal(str(desc["ht"])) == cible["ht"]:
            out["inchangees"] += 1
            continue
        appliquer_ht(cur, cle, cible["ht"], cible["fournisseur"].lower(), par, lot, r)
        noter_fournisseur_retenu(cur, cle, cible)
        out["modifies"] += 1
        out["lot_id"] = lot
    return out


# ─── Catalogue fournisseur (recherche de tarifs pro) ─────────────
# fournisseurs_catalogue garde chaque produit vu chez un fournisseur (synchro Mobilax, collecte Utopya) tel
# que le fournisseur le nomme, avec son prix HT, son stock, sa fiche, et la lecture qu'en fait Klikphone
# (marque, modèle, pièce, qualité, ligne de la grille reçue) : la page « Recherche fournisseurs » cherche dedans,
# Mobilax et Utopya côte à côte, sans rien demander aux sites.

def _texte_recherche(*parties) -> str:
    return " ".join(_norm(" ".join(str(p or "") for p in parties)).split())[:400]


def enregistrer_catalogue(cur, fournisseur: str, source: str, lignes, reconnues=None) -> int:
    """Produits d'un passage → fournisseurs_catalogue (un par référence et fournisseur) : prix, stock, fiche, lecture
    (marque, modèle, pièce, qualité) et ligne de la grille reçue (reconnues : import_prix.apercu, par référence).
    prix_maj_le renouvelé quand le prix change ; un produit sans prix (rupture) garde son dernier prix connu."""
    f = fournisseur_propre(fournisseur)
    if not f:
        return 0
    cles = {}
    for rec in reconnues or []:
        ref = str(rec.get("ref") or "").strip()
        if ref and rec.get("cle"):
            cles.setdefault(ref, rec["cle"])
    vus, valeurs = set(), []
    for l in lignes or []:
        if not isinstance(l, dict):
            continue
        ref = str(l.get("reference") or "").strip()[:120]
        nom = " ".join(str(l.get("designation") or "").split())[:250]
        if not ref or not nom or ref in vus:
            continue
        vus.add(ref)
        ht = l.get("prix_ht")
        try:
            ht = Decimal(str(ht)).quantize(Decimal("0.01")) if ht not in (None, "") else None
        except InvalidOperation:
            ht = None
        en_stock = l.get("en_stock")
        marque = (str(l.get("marque") or "").strip()[:40]) or None
        modele = (str(l.get("modele") or "").strip()[:250]) or None
        piece = (str(l.get("type_piece") or "").strip()[:60]) or None
        qualite = (str(l.get("qualite") or "").strip()[:40]) or None
        valeurs.append((f, ref, nom, ht, None if en_stock is None else bool(en_stock), (l.get("url") or None),
                        marque, modele, piece, qualite, cles.get(ref), _texte_recherche(marque, modele, nom, piece, qualite),
                        source, ht))
    if not valeurs:
        return 0
    execute_values(cur, """
        INSERT INTO fournisseurs_catalogue
            (fournisseur, ref, nom, prix_ht, en_stock, url, marque, modele, type_piece, qualite, tarif_cle, recherche,
             source, vu_le, prix_maj_le)
        VALUES %s
        ON CONFLICT (fournisseur, ref) DO UPDATE SET
            prix_maj_le = CASE WHEN EXCLUDED.prix_ht IS NOT NULL
                                    AND fournisseurs_catalogue.prix_ht IS DISTINCT FROM EXCLUDED.prix_ht
                               THEN NOW() ELSE fournisseurs_catalogue.prix_maj_le END,
            prix_ht = COALESCE(EXCLUDED.prix_ht, fournisseurs_catalogue.prix_ht),
            nom = EXCLUDED.nom, en_stock = EXCLUDED.en_stock,
            url = COALESCE(EXCLUDED.url, fournisseurs_catalogue.url),
            marque = COALESCE(EXCLUDED.marque, fournisseurs_catalogue.marque),
            modele = COALESCE(EXCLUDED.modele, fournisseurs_catalogue.modele),
            type_piece = COALESCE(EXCLUDED.type_piece, fournisseurs_catalogue.type_piece),
            qualite = COALESCE(EXCLUDED.qualite, fournisseurs_catalogue.qualite),
            tarif_cle = COALESCE(EXCLUDED.tarif_cle, fournisseurs_catalogue.tarif_cle),
            recherche = EXCLUDED.recherche, source = EXCLUDED.source, vu_le = NOW()
    """, valeurs, template="(%s, %s, %s, %s::numeric, %s::boolean, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), "
                           "CASE WHEN %s::numeric IS NULL THEN NULL ELSE NOW() END)", page_size=300)
    return len(valeurs)


def purger_catalogue(cur, fournisseur: str, age_secondes: float) -> int:
    """Après un passage COMPLET : oublie les produits de ce fournisseur qu'il n'a pas montrés (vus il y a plus
    d'`age_secondes`, soit avant le début du passage). → nombre retiré"""
    f = fournisseur_propre(fournisseur)
    if not f:
        return 0
    cur.execute("DELETE FROM fournisseurs_catalogue WHERE fournisseur = %s AND vu_le < NOW() - make_interval(secs => %s)",
                (f, float(max(age_secondes, 0))))
    return max(int(cur.rowcount or 0), 0)


def rechercher_catalogue(cur, q: str, fournisseurs=None, type_piece: str = None, limite: int = 200) -> list:
    """Produits du catalogue dont le texte de recherche porte chaque mot de `q` (sans accents ni casse), par
    fournisseur puis prix. → [{fournisseur, ref, nom, prix_ht, en_stock, url, marque, modele, type_piece, qualite,
    chassis, tarif_cle, vu_le, prix_maj_le}]"""
    mots = [m for m in _norm(q or "").split() if len(m) >= 2 or m.isdigit()][:8]
    if not mots:
        return []
    cond, params = ["TRUE"], []
    for m in mots:
        cond.append("recherche LIKE %s")
        params.append("%" + m.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
    if fournisseurs:
        cond.append("fournisseur = ANY(%s)")
        params.append([fournisseur_propre(f) for f in fournisseurs])
    sql = f"""
        SELECT fournisseur, ref, nom, prix_ht, en_stock, url, marque, modele, type_piece, qualite, tarif_cle, vu_le, prix_maj_le
        FROM fournisseurs_catalogue WHERE {" AND ".join(cond)}
        ORDER BY fournisseur, prix_ht IS NULL, prix_ht, nom
        LIMIT %s
    """
    params.append(int(max(1, min(limite, 500))))
    cur.execute(sql, params)
    out = []
    tp = _norm(type_piece or "")
    for r in cur.fetchall() or []:
        if tp and tp not in _norm(r.get("type_piece") or ""):
            continue
        out.append({"fournisseur": r["fournisseur"], "ref": r["ref"], "nom": r["nom"],
                    "prix_ht": float(r["prix_ht"]) if r["prix_ht"] is not None else None, "en_stock": r["en_stock"],
                    "url": r["url"], "marque": r["marque"], "modele": r["modele"], "type_piece": r["type_piece"],
                    "qualite": r["qualite"], "chassis": chassis_designation(r["nom"]), "tarif_cle": r["tarif_cle"],
                    "vu_le": r["vu_le"], "prix_maj_le": r["prix_maj_le"]})
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
    # Prix client réellement écrit (batterie « par l'écran » : dérivé) et autres valeurs du lot
    for i, c, _, n in res["ecrits"]:
        if i == desc["id"] and c == col_client:
            client = n
    derives = [{"id": i, "colonne": c, "ancien": a, "nouveau": n} for i, c, a, n in res["ecrits"]
               if not (i == desc["id"] and c in (col_ht, col_client))]
    return {
        "ok": bool(res["ecrits"]), "absent": False, "verrouille": bool(res["verrouilles"]),
        "ancien_ht": desc["ht"], "nouveau_ht": ht, "ancien_client": desc["client"], "nouveau_client": client,
        "derives": derives,
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
    from app.services import par_ecran
    out = []
    tp = _norm(f.get("type_piece"))
    cur.execute("""
        SELECT id, marque, modele, type_piece, qualite, categorie, prix_fournisseur_ht, prix_client, verrou_manuel
        FROM tarifs WHERE obsolete IS NOT TRUE ORDER BY id
    """)
    rows = [dict(r) for r in cur.fetchall() or []]
    retenues = []          # (row, ht, nouveau_ht) des lignes du plan
    for row in rows:
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
        retenues.append((row, ht, nouveau_ht))
    # Batteries « par l'écran » : prix dérivé des HT après ajustement (écran du modèle compris)
    derives = par_ecran.derives_plan(cur, rows, {row["id"]: nh for row, _, nh in retenues}, r_nouv)
    for row, ht, nouveau_ht in retenues:
        client = derives.get(row["id"])
        if client is None:
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
               verrou_manuel, batterie_par_ecran
        FROM tarifs_apple_devices WHERE actif IS NOT FALSE AND obsolete IS NOT TRUE ORDER BY id
    """)
    from app.services import par_ecran
    for row in cur.fetchall() or []:
        if not _garde(row, f, marque="Apple"):
            continue
        if "categorie" in f and _norm(row["categorie"]) != _norm(f["categorie"]):
            continue
        # HT de chaque pièce après le plan (ajustée si elle en fait partie) : l'écran compte pour la batterie
        apres = {}
        for piece in PIECES_APPLE:
            h = row[f"{piece}_prix_ht"]
            dans_plan = not (tp and not piece.startswith(tp) and not tp.startswith(piece)) and (not pieces or piece in pieces)
            if h is not None and h > 0 and ajustement and dans_plan:
                apres[piece] = Decimal(str(ajuster(h, ajustement, False)))
            else:
                apres[piece] = Decimal(h) if h is not None and h > 0 else None
        par_ecran_actif = par_ecran.effectif(row.get("batterie_par_ecran"), categorie=row["categorie"])
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
            if piece == "batterie" and par_ecran_actif and apres.get("ecran"):
                client = par_ecran.prix_batterie(nouveau_ht, apres["ecran"], r_nouv)
            else:
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


def appliquer_prix_commande(cur, tarif_cle_brute: str, nouveau_ht, par: str, commande_id: int = None, r=None):
    """Le prix HT payé sur une commande devient le coût de la pièce, tout de suite (plus rien à valider :
    décision du gérant du 06/11/2026). None si la clé est invalide ou inconnue, le HT invalide, ou l'écart avec
    le coût actuel d'au plus 1 €. Sinon écrit coût HT et prix client (source 'commande', lot annulable) et
    garde une trace dans tarifs_propositions (statut 'acceptee', ou 'refusee' pour une pièce verrouillée :
    son prix n'est jamais touché). → {id, applique, verrouille, lot_id, ancien_ht, nouveau_ht, ancien_client,
    nouveau_client}"""
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
    lot = nouveau_lot()
    res = appliquer_ht(cur, cle, ht, "commande", par, lot, r)
    if res.get("absent"):
        return None
    verrouille = bool(res.get("verrouille"))
    cur.execute("""
        INSERT INTO tarifs_propositions (tarif_cle, ancien_ht, nouveau_ht, source, commande_id, statut, par, le,
                                         traite_le, traite_par, lot_id)
        VALUES (%s, %s, %s, 'commande', %s, %s, %s, NOW(), NOW(), %s, %s)
        RETURNING id
    """, (cle, ancien, ht, commande_id, "refusee" if verrouille else "acceptee", par, par, None if verrouille else lot))
    pid = cur.fetchone()["id"]
    return {"id": pid, "applique": not verrouille, "verrouille": verrouille, "lot_id": None if verrouille else lot,
            "ancien_ht": res.get("ancien_ht"), "nouveau_ht": res.get("nouveau_ht"),
            "ancien_client": res.get("ancien_client"), "nouveau_client": res.get("nouveau_client")}


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
    """Indicateurs agrégés (aucune donnée nominative) des prix fournisseur.

    Une ligne sans prix client positif (pièce courante pré-créée à 0 € HT, « prix à renseigner »,
    api/tarifs) n'est ni estimée, ni à revoir, ni périmée, ni une marge faible : elle est comptée
    à part dans `a_renseigner` (et dans `total`). iPad / MacBook : une ligne par appareil, jugée
    sur son écran (même convention que les autres compteurs)."""
    r = r or regles(cur)
    tva = Decimal(str(r["tva"]))
    cur.execute("""
        SELECT count(*) AS total,
               count(*) FILTER (WHERE sans_prix) AS a_renseigner,
               count(*) FILTER (WHERE NOT sans_prix AND prix_source = %(estim)s) AS estimes,
               count(*) FILTER (WHERE NOT sans_prix
                                  AND prix_maj_le < NOW() - make_interval(days => %(revoir)s)
                                  AND prix_maj_le >= NOW() - make_interval(days => %(perime)s)) AS a_revoir,
               count(*) FILTER (WHERE NOT sans_prix
                                  AND (prix_maj_le IS NULL
                                       OR prix_maj_le < NOW() - make_interval(days => %(perime)s))) AS perimes,
               count(*) FILTER (WHERE NOT sans_prix AND ecran AND ht IS NOT NULL AND prix IS NOT NULL
                                  AND prix - ht * %(tva)s < %(seuil)s) AS marges_faibles,
               count(*) FILTER (WHERE verrou) AS verrouilles
        FROM (
            SELECT prix_source, prix_maj_le, type_piece ~* '[eé]cran' AS ecran,
                   prix_fournisseur_ht AS ht, prix_client AS prix, verrou_manuel AS verrou,
                   COALESCE(prix_client, 0) <= 0 AS sans_prix
            FROM tarifs WHERE obsolete IS NOT TRUE
            UNION ALL
            SELECT prix_source, prix_maj_le, TRUE, ecran_prix_ht, ecran_prix_vente, verrou_manuel,
                   COALESCE(ecran_prix_vente, 0) <= 0
            FROM tarifs_apple_devices WHERE actif IS NOT FALSE AND obsolete IS NOT TRUE
        ) s
    """, {"estim": SOURCE_ESTIMATION, "revoir": r["jours_a_revoir"], "perime": r["jours_perime"],
          "tva": tva, "seuil": Decimal(str(r["seuil_marge_alerte"]))})
    out = {k: int(v or 0) for k, v in dict(cur.fetchone()).items()}
    cur.execute("SELECT count(*) AS n FROM tarifs_propositions WHERE statut = 'en_attente'")
    out["propositions_en_attente"] = int(cur.fetchone()["n"] or 0)
    # Prix appliqués sans validation (synchro Mobilax, collecte Utopya, prix payé sur une commande) : 7 derniers jours
    cur.execute("""
        SELECT count(DISTINCT (table_nom, ligne_id, lot_id, split_part(colonne, '_', 1))) AS n
        FROM tarifs_historique
        WHERE le >= NOW() - make_interval(days => 7) AND source IN ('import', 'mobilax', 'utopya', 'commande')
          AND colonne IN ('prix_fournisseur_ht', 'ecran_prix_ht', 'batterie_prix_ht')
    """)
    out["appliques_7j"] = int(cur.fetchone()["n"] or 0)
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
    # Synchro automatique des tarifs fournisseurs (import différé : fournisseurs importe ce module)
    from app.services import fournisseurs
    out["fournisseurs"] = fournisseurs.sante(cur)
    out["seuils"] = {"jours_a_revoir": r["jours_a_revoir"], "jours_perime": r["jours_perime"],
                     "seuil_marge_alerte": r["seuil_marge_alerte"]}
    return out
