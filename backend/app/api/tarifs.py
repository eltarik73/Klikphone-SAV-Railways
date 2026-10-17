"""
API Tarifs - Gestion des prix de reparation.
Calcul automatique des prix clients a partir des prix fournisseur HT.
Grille tarifs reparation iPhone (table tarifs_reparation).

Moteur de prix (services/prix, services/import_prix) : règles de marge réglables, recalcul,
ajustement global et import de fichier fournisseur, toujours avec aperçu ; date, source et
historique de chaque prix ; annulation d'un lot. Toute écriture de prix exige le rôle admin
ET le code admin prouvé sur le poste (auth.exiger_role_admin), contrôlés par le serveur.
"""

import re
import time
import logging
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Path, Query, Request, UploadFile
from psycopg2.extras import execute_values
from pydantic import BaseModel, Field

from app.database import get_cursor
from app.api.auth import exiger_role_admin, get_current_user
from app.services import import_prix
from app.services import params as params_cache
from app.services import prix

router = APIRouter(prefix="/api/tarifs", tags=["tarifs"])

# Initialisation unique de la date et de la source des prix (main._DONNEES_FIXES)
SQL_INIT_PRIX = prix.SQL_INITIALISATION


def _admin(request: Request, user: dict = Depends(get_current_user)) -> dict:
    """Écriture de prix : rôle admin du membre ET code admin saisi sur ce poste."""
    return exiger_role_admin(request, user)


def _est_admin(request: Request, user: dict) -> bool:
    try:
        exiger_role_admin(request, dict(user))
        return True
    except HTTPException:
        return False


def _par(user: dict) -> Optional[str]:
    return (str(user.get("sub") or "").strip() or None) if user else None


def _invalider_vente():
    """Cache des téléphones à la vente (iphones_stock) après une écriture de prix de vente."""
    try:
        from app.api.iphones_stock import _invalidate_tarifs_cache
        _invalidate_tarifs_cache()
    except Exception:
        pass


def _fraicheur(row: dict, r: dict) -> dict:
    """Âge du prix (age_jours calculé par la base), niveau de fraîcheur, prix estimé.

    Niveau sur l'âge exact (age_secondes, cf. _FRAICHEUR_SQL), le même critère que
    services/prix.sante (prix_maj_le < NOW() - N jours) et api/grille.fraicheur : un prix daté
    d'il y a 90 j 12 h est « à revoir » partout (age_jours 90), jamais « ok » ici et compté
    « à revoir » dans la santé. Sans age_secondes : repli sur age_jours entier."""
    secondes = row.pop("age_secondes", None)
    if secondes is None and row.get("age_jours") is not None:
        secondes = row["age_jours"] * 86400
    if secondes is None:
        niveau = "perime"
    elif secondes > r["jours_perime"] * 86400:
        niveau = "perime"
    elif secondes > r["jours_a_revoir"] * 86400:
        niveau = "a_revoir"
    else:
        niveau = "ok"
    row["fraicheur"] = niveau
    row["estime"] = row.get("prix_source") == prix.SOURCE_ESTIMATION
    return row


_AGE_SQL = "floor(extract(epoch FROM NOW() - prix_maj_le) / 86400)::int AS age_jours"
# Avec l'âge exact, pour _fraicheur (retiré de la réponse)
_FRAICHEUR_SQL = _AGE_SQL + ", extract(epoch FROM NOW() - prix_maj_le)::float8 AS age_secondes"


# ---------------------------------------------------------------------------
# Simple TTL cache
# ---------------------------------------------------------------------------

class _Cache:
    def __init__(self, ttl=300):
        self._data = {}
        self._ttl = ttl

    def get(self, key):
        entry = self._data.get(key)
        if entry and time.time() - entry[1] < self._ttl:
            return entry[0]
        self._data.pop(key, None)
        return None

    def set(self, key, value):
        self._data[key] = (value, time.time())

    def clear(self):
        self._data.clear()


_cache = _Cache(ttl=300)


# ---------------------------------------------------------------------------
# Table creation
# ---------------------------------------------------------------------------

def _ensure_table():
    """Cree la table tarifs si elle n'existe pas."""
    with get_cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS tarifs (
                id SERIAL PRIMARY KEY,
                marque VARCHAR(50) NOT NULL,
                modele VARCHAR(100) NOT NULL,
                type_piece VARCHAR(50) NOT NULL,
                qualite VARCHAR(50),
                nom_fournisseur TEXT,
                prix_fournisseur_ht DECIMAL(10,2),
                prix_client INTEGER NOT NULL,
                categorie VARCHAR(20) DEFAULT 'standard',
                source VARCHAR(50) DEFAULT 'mobilax',
                en_stock BOOLEAN DEFAULT TRUE,
                updated_at TIMESTAMP DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_tarifs_marque ON tarifs(marque);
            CREATE INDEX IF NOT EXISTS idx_tarifs_modele ON tarifs(modele);
            CREATE INDEX IF NOT EXISTS idx_tarifs_recherche ON tarifs(marque, modele, type_piece);
        """)
        # Add en_stock column if missing (existing tables)
        cur.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'tarifs' AND column_name = 'en_stock'
                ) THEN
                    ALTER TABLE tarifs ADD COLUMN en_stock BOOLEAN DEFAULT TRUE;
                END IF;
            END $$;
        """)
        # Table iPad / MacBook
        cur.execute("""
            CREATE TABLE IF NOT EXISTS tarifs_apple_devices (
                id SERIAL PRIMARY KEY,
                categorie VARCHAR(20) NOT NULL,
                modele VARCHAR(255) NOT NULL,
                ecran_prix_ht DECIMAL(10,2),
                batterie_prix_ht DECIMAL(10,2),
                ecran_prix_vente INTEGER,
                batterie_prix_vente INTEGER,
                actif BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_apple_devices_cat ON tarifs_apple_devices(categorie);
        """)


    # Table grille tarifs reparation iPhone
    with get_cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS tarifs_reparation (
                id SERIAL PRIMARY KEY,
                modele VARCHAR(100) NOT NULL,
                ecran_generique INTEGER,
                ecran_confort INTEGER,
                ecran_apple INTEGER,
                batterie INTEGER,
                desoxydation INTEGER,
                connecteur_charge INTEGER,
                reparation_divers INTEGER,
                ecouteur_apn INTEGER,
                vitre_arriere INTEGER,
                chassis INTEGER,
                ecran_generique_barre INTEGER,
                ecran_confort_barre INTEGER,
                ecran_apple_barre INTEGER,
                batterie_barre INTEGER,
                desoxydation_barre INTEGER,
                connecteur_charge_barre INTEGER,
                reparation_divers_barre INTEGER,
                ecouteur_apn_barre INTEGER,
                vitre_arriere_barre INTEGER,
                chassis_barre INTEGER,
                ordre INTEGER DEFAULT 0,
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(modele)
            )
        """)
        # Add columns if table already existed without them
        for col in [
            "ecran_generique_barre", "ecran_confort_barre", "ecran_apple_barre",
            "batterie_barre", "desoxydation_barre", "connecteur_charge_barre",
            "reparation_divers_barre", "ecouteur_apn_barre", "vitre_arriere_barre",
            "chassis_barre", "ordre",
        ]:
            col_type = "INTEGER DEFAULT 0" if col == "ordre" else "INTEGER"
            try:
                cur.execute(f"ALTER TABLE tarifs_reparation ADD COLUMN IF NOT EXISTS {col} {col_type}")
            except Exception:
                pass
        # Init ordre from id if all zeros
        try:
            cur.execute("UPDATE tarifs_reparation SET ordre = id WHERE ordre = 0 OR ordre IS NULL")
        except Exception:
            pass
        # Seed data
        cur.execute("""
            INSERT INTO tarifs_reparation (modele, ecran_generique, ecran_confort, ecran_apple, batterie, desoxydation, connecteur_charge, reparation_divers, ecouteur_apn, vitre_arriere, chassis) VALUES
            ('iPhone 5/5S/5C/SE', 45, NULL, 55, 39, 19, 39, 19, 29, NULL, NULL),
            ('iPhone 6/6S/6+/6s+', 49, NULL, 59, 59, 19, 49, 19, 29, NULL, 79),
            ('iPhone 7/8/7+/8+', 59, 69, 79, 49, 29, 79, 29, 39, 89, 129),
            ('iPhone SE 20/22', 69, 79, 89, 59, 29, 79, 39, 49, 109, 129),
            ('iPhone X/XS', 89, 109, 129, 69, 29, 79, 59, 59, 99, 129),
            ('iPhone XS Max', 89, 119, 149, NULL, 29, 79, NULL, NULL, 99, 129),
            ('iPhone XR/11', 89, NULL, 109, 69, 29, 79, 59, 69, 99, 139),
            ('iPhone 11 Pro', 89, 119, 149, 79, 39, 89, 59, 59, 99, 179),
            ('iPhone 11 Pro Max', 99, 129, 169, 89, 39, 89, 59, 69, 109, 189),
            ('iPhone 12/12 Pro', 99, 139, 169, 99, 49, 99, 69, 79, 119, 179),
            ('iPhone 12 mini', 99, 139, 169, 99, 49, 99, NULL, NULL, 109, 169),
            ('iPhone 12 Pro Max', 119, 159, 269, 99, 49, 109, 69, 79, 129, 179),
            ('iPhone 13', 109, 139, 169, 99, 49, 119, 69, 99, 139, 189),
            ('iPhone 13 mini', 99, 129, 169, 99, 49, 109, NULL, NULL, 119, 189),
            ('iPhone 13 Pro', 129, 169, 269, 119, 49, 129, 69, 99, 149, 199),
            ('iPhone 13 Pro Max', 139, 189, 339, 129, 49, 139, 79, 99, 159, 229),
            ('iPhone 14', 119, 149, 179, 99, 49, 129, 79, 99, 129, 199),
            ('iPhone 14 Pro', 139, 199, 299, 129, 49, 149, 79, 109, 169, 209),
            ('iPhone 14 Plus', 139, 159, 189, 99, 49, 159, 79, 109, 139, 199),
            ('iPhone 14 Pro Max', 149, 179, 429, 139, 49, 169, 79, 109, 169, 209),
            ('iPhone 15', 129, 159, 269, 129, 49, NULL, 79, 109, 139, 199),
            ('iPhone 15 Plus', 159, 169, 279, 129, 49, NULL, NULL, NULL, 149, 199),
            ('iPhone 15 Pro', 159, 219, 359, 139, 49, 159, 79, 129, 169, 239),
            ('iPhone 15 Pro Max', 169, 279, 429, 149, 49, 169, 79, 129, 169, 259),
            ('iPhone 16', 139, 189, 289, 169, 49, 189, 79, 109, 149, 199),
            ('iPhone 16 Plus', 159, 199, 339, 169, NULL, NULL, NULL, NULL, 159, 229),
            ('iPhone 16 Pro', 169, 229, 379, 169, 49, 199, 79, 129, 179, 289),
            ('iPhone 16 Pro Max', 179, NULL, 429, 179, 49, 199, 79, 129, 189, 299),
            ('iPhone 16e', 129, 159, 189, 159, NULL, NULL, NULL, NULL, 169, NULL),
            ('iPhone 17', NULL, NULL, NULL, NULL, 59, 189, 79, 109, NULL, NULL),
            ('iPhone 17 Air', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
            ('iPhone 17 Pro', NULL, NULL, NULL, NULL, 59, 199, 79, 129, NULL, NULL),
            ('iPhone 17 Pro Max', NULL, NULL, NULL, NULL, 59, 199, 79, 129, NULL, NULL)
            ON CONFLICT (modele) DO NOTHING
        """)


# NOTE: _ensure_table() is called from main.py lifespan, not here


# ---------------------------------------------------------------------------
# Pricing logic — formule historique FIGÉE (marges de février 2026).
# Le calcul en service passe par services/prix (règles réglables, params TARIFS_REGLES) ;
# ces fonctions restent la référence des tests de non-régression (règles par défaut = 0 écart).
# ---------------------------------------------------------------------------

def arrondi_9_superieur(prix: float) -> int:
    """Arrondit au 9 superieur (plus petit entier finissant par 9 >= prix).

    Exemples : 61->69, 72->79, 83->89, 90->99, 91->99, 101->109, 145->149.
    """
    dizaine = int(prix) // 10
    candidat = dizaine * 10 + 9
    if candidat >= prix:
        return candidat
    return candidat + 10


def calcul_prix_client(prix_ht: float, type_piece: str, categorie: str) -> int:
    """Calcule le prix client TTC a partir du prix fournisseur HT.

    Regles :
    - Ecrans standard  : prix_ht * 1.2 + 60, arrondi au 9 sup
    - Ecrans haut_de_gamme : prix_ht * 1.2 + 70, arrondi au 9 sup
    - Ecrans pliant    : prix_ht * 1.2 + 100, arrondi au 9 sup
    - Batteries / Connecteurs / Cameras : prix_ht * 1.2 + 60, arrondi au 9 sup
    """
    type_lower = (type_piece or "").lower()
    categorie_lower = (categorie or "standard").lower()

    is_ecran = "ecran" in type_lower or "écran" in type_lower

    if is_ecran:
        if categorie_lower == "haut_de_gamme":
            raw = prix_ht * 1.2 + 70
        elif categorie_lower == "pliant":
            raw = prix_ht * 1.2 + 100
        else:
            # standard or any other value
            raw = prix_ht * 1.2 + 60
    else:
        # Batteries, Connecteurs, Cameras, etc.
        raw = prix_ht * 1.2 + 60

    return arrondi_9_superieur(raw)


def calc_prix_ipad(prix_ht: float) -> int:
    """iPad : (HT x 1.2) + 110, arrondi en 9."""
    return arrondi_9_superieur(prix_ht * 1.2 + 110)


def calc_prix_macbook(prix_ht: float) -> int:
    """MacBook : (HT x 1.2) + 120, arrondi en 9."""
    return arrondi_9_superieur(prix_ht * 1.2 + 120)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class TarifImportItem(BaseModel):
    marque: str = Field(..., min_length=1, max_length=50)
    modele: str = Field(..., min_length=1, max_length=100)
    type_piece: str = Field(..., min_length=1, max_length=50)
    qualite: Optional[str] = Field(None, max_length=50)
    nom_fournisseur: Optional[str] = Field(None, max_length=250)
    prix_fournisseur_ht: float = Field(..., gt=0, le=5000)
    categorie: Optional[str] = Field("standard", pattern="^(standard|haut_de_gamme|pliant)$")
    source: Optional[str] = Field("mobilax", max_length=50)
    en_stock: Optional[bool] = True


class TarifImportRequest(BaseModel):
    items: List[TarifImportItem] = Field(..., max_length=5000)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
def list_tarifs(
    request: Request,
    q: Optional[str] = Query(None, max_length=100, description="Recherche sur marque ou modele"),
    marque: Optional[str] = Query(None, max_length=50, description="Filtre exact sur marque"),
    obsoletes: bool = Query(False, description="Inclure les pièces marquées obsolètes"),
    user: dict = Depends(get_current_user),
):
    """Liste les tarifs avec filtres optionnels. HT masque si non-admin.

    Chaque ligne porte la date et la source de son prix (prix_maj_le, prix_source),
    age_jours, fraicheur ('ok' | 'a_revoir' | 'perime'), estime et verrou_manuel.
    """
    conditions = []
    params = []

    if not obsoletes:
        conditions.append("obsolete IS NOT TRUE")

    if q:
        conditions.append("(marque ILIKE %s OR modele ILIKE %s)")
        like_val = f"%{q}%"
        params.extend([like_val, like_val])

    if marque:
        conditions.append("marque = %s")
        params.append(marque)

    where = ""
    if conditions:
        where = "WHERE " + " AND ".join(conditions)

    query = f"""SELECT id, marque, modele, type_piece, qualite, nom_fournisseur,
        prix_fournisseur_ht, prix_client, categorie, source, en_stock, updated_at,
        prix_maj_le, prix_source, verrou_manuel, ref_fournisseur, fournisseur, obsolete, {_FRAICHEUR_SQL}
        FROM tarifs {where} ORDER BY marque, modele, type_piece, qualite"""

    with get_cursor() as cur:
        cur.execute(query, params)
        rows = cur.fetchall()
        r = prix.regles(cur)

    results = [_fraicheur(dict(row), r) for row in rows]

    if not _est_admin(request, user):
        for row in results:
            row.pop("prix_fournisseur_ht", None)

    return results


@router.get("/stats")
def get_stats():
    """Retourne des statistiques sur les tarifs (cached 5 min)."""
    cached = _cache.get("tarifs_stats")
    if cached:
        return cached
    with get_cursor() as cur:
        cur.execute("""
            SELECT
                COUNT(*) AS total,
                COUNT(DISTINCT marque) AS marques,
                COUNT(DISTINCT modele) AS modeles,
                MIN(prix_client) AS prix_min,
                MAX(prix_client) AS prix_max
            FROM tarifs
            WHERE obsolete IS NOT TRUE
        """)
        row = cur.fetchone()
    result = dict(row)
    _cache.set("tarifs_stats", result)
    return result


def _cle_piece(marque, modele, type_piece, qualite) -> tuple:
    """Clé de l'index unique idx_tarifs_piece_unique (lower, qualité vide = NULL)."""
    return (str(marque).strip().lower(), str(modele).strip().lower(), str(type_piece).strip().lower(),
            str(qualite or "").strip().lower())


def _inserer_tarifs(cur, lignes: list, source_prix: str, par, lot_id) -> list:
    """Insère des pièces neuves (prix daté), historique « création » ; collision : rien n'est inséré.

    lignes : dicts {marque, modele, type_piece, qualite, nom_fournisseur, ht, client, categorie,
    source, en_stock, fournisseur, ref, verrou}.
    """
    if not lignes:
        return []
    rows = execute_values(cur, """
        INSERT INTO tarifs (marque, modele, type_piece, qualite, nom_fournisseur, prix_fournisseur_ht, prix_client,
                            categorie, source, en_stock, updated_at, prix_maj_le, prix_source, fournisseur,
                            ref_fournisseur, verrou_manuel, obsolete)
        SELECT v.marque, v.modele, v.type_piece, v.qualite, v.nom, v.ht, v.client, v.categorie, v.source,
               v.en_stock, NOW(), NOW(), v.prix_source, v.fournisseur, v.ref, v.verrou, FALSE
        FROM (VALUES %s) AS v(marque, modele, type_piece, qualite, nom, ht, client, categorie, source, en_stock,
                              prix_source, fournisseur, ref, verrou)
        ON CONFLICT DO NOTHING
        RETURNING id, prix_fournisseur_ht, prix_client
    """, [(l["marque"], l["modele"], l["type_piece"], l.get("qualite") or None, l.get("nom_fournisseur"),
           l.get("ht"), l["client"], l.get("categorie") or "standard", l.get("source") or "mobilax",
           l.get("en_stock", True), source_prix, l.get("fournisseur") or "Mobilax", l.get("ref"),
           bool(l.get("verrou"))) for l in lignes],
        template="(%s, %s, %s, %s, %s, %s::numeric, %s::integer, %s, %s, %s::boolean, %s, %s, %s, %s::boolean)",
        page_size=max(len(lignes), 1), fetch=True)
    historique = []
    for row in rows or []:
        for col in ("prix_fournisseur_ht", "prix_client"):
            if row[col] is not None:
                historique.append(("tarifs", row["id"], col, None, row[col], source_prix, lot_id, par))
    if historique:
        execute_values(cur, """
            INSERT INTO tarifs_historique (table_nom, ligne_id, colonne, ancien, nouveau, source, lot_id, par)
            VALUES %s
        """, historique, page_size=len(historique))
    return [row["id"] for row in rows or []]


@router.post("/import")
def import_tarifs(
    body: TarifImportRequest,
    user: dict = Depends(_admin),
):
    """Importe une liste de tarifs (JSON). Mise à jour sans doublon : une pièce existante
    (même marque, modèle, type, qualité) garde son id, son HT et son prix client sont
    réécrits par le moteur de prix (historique, pièce verrouillée intacte) ; les autres
    sont ajoutées. Pour un fichier fournisseur : /import-fichier (aperçu puis application)."""
    par = _par(user)
    lot = prix.nouveau_lot()
    with get_cursor() as cur:
        r = prix.regles(cur)
        cur.execute("SELECT id, marque, modele, type_piece, qualite FROM tarifs")
        existants = {_cle_piece(e["marque"], e["modele"], e["type_piece"], e["qualite"]): e["id"]
                     for e in cur.fetchall() or []}
        changements, nouvelles = [], {}
        for item in body.items:
            categorie = item.categorie or "standard"
            client = prix.prix_client(item.prix_fournisseur_ht, item.type_piece, categorie, r)
            cle = _cle_piece(item.marque, item.modele, item.type_piece, item.qualite)
            if cle in existants:
                changements += [(existants[cle], "prix_fournisseur_ht", item.prix_fournisseur_ht),
                                (existants[cle], "prix_client", client)]
            else:
                nouvelles[cle] = {
                    "marque": item.marque.strip(), "modele": item.modele.strip(), "type_piece": item.type_piece.strip(),
                    "qualite": (item.qualite or "").strip() or None, "nom_fournisseur": item.nom_fournisseur,
                    "ht": item.prix_fournisseur_ht, "client": client, "categorie": categorie,
                    "source": item.source or "mobilax",
                    "en_stock": item.en_stock if item.en_stock is not None else True,
                }
        res = prix.ecrire_prix_lot(cur, "tarifs", changements, "import", par, lot)
        ajoutes = _inserer_tarifs(cur, list(nouvelles.values()), "import", par, lot)

    _cache.clear()
    return {"inserted": len(ajoutes), "modifies": len({i for i, _, _, _ in res["ecrits"]}),
            "verrouilles": len(res["verrouilles"]), "lot_id": lot if (ajoutes or res["ecrits"]) else None}


@router.post("/recalculate")
def recalculate_tarifs(user: dict = Depends(_admin)):
    """Recalcule les prix client (pièces fournisseur et iPad / MacBook) depuis le HT avec les
    règles en vigueur : une lecture, calcul en mémoire, une écriture groupée par colonne.
    HT absent : ignoré ; prix verrouillé : jamais modifié. Lot annulable (historique)."""
    with get_cursor() as cur:
        plan = prix.planifier(cur, {})
        resume = prix.resumer_plan(plan, 0)
        applique = prix.appliquer_plan(cur, plan, _par(user))
    _cache.clear()
    return {
        "modifies": applique["modifies"], "inchanges": resume["inchanges"],
        "ignores": resume["ignores"] + resume["verrouilles"], "sans_prix_achat": resume["ignores"],
        "verrouilles": resume["verrouilles"], "lot_id": applique["lot_id"],
        # Anciennes clés (scripts, anciens écrans)
        "recalculated": applique["modifies"], "total": len(plan["entrees"]) + resume["ignores"],
    }


@router.patch("/{tarif_id}/stock")
def toggle_stock(tarif_id: int, user: dict = Depends(_admin)):
    """Inverse le statut en_stock d'un tarif (ne touche pas à la date du prix)."""
    with get_cursor() as cur:
        cur.execute(
            "UPDATE tarifs SET en_stock = NOT COALESCE(en_stock, TRUE), updated_at = NOW() WHERE id = %s RETURNING id, en_stock",
            (tarif_id,),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Tarif non trouve")
    return {"id": row["id"], "en_stock": row["en_stock"]}


_SUPPRESSION_DESACTIVEE = (
    "Suppression de la grille désactivée : les ids des pièces doivent rester stables (lignes de ticket). "
    "Mettez les prix à jour par l'import de fichier (aperçu puis application) ; une pièce absente du "
    "fichier peut être marquée obsolète, jamais supprimée."
)


@router.delete("/clear")
def clear_tarifs(user: dict = Depends(_admin)):
    """Désactivé (410) : plus jamais de TRUNCATE de la grille."""
    raise HTTPException(410, _SUPPRESSION_DESACTIVEE)


# ---------------------------------------------------------------------------
# Apple Devices (iPad / MacBook)
# ---------------------------------------------------------------------------

class AppleDeviceImportItem(BaseModel):
    categorie: str = Field(..., pattern="^(ipad|macbook)$")
    modele: str = Field(..., min_length=1, max_length=255)
    ecran_prix_ht: Optional[float] = Field(None, gt=0, le=5000)
    batterie_prix_ht: Optional[float] = Field(None, gt=0, le=5000)


class AppleDeviceImportRequest(BaseModel):
    items: List[AppleDeviceImportItem] = Field(..., max_length=2000)


@router.get("/apple-devices")
def list_apple_devices(
    request: Request,
    obsoletes: bool = Query(False, description="Inclure les appareils marqués obsolètes"),
    user: dict = Depends(get_current_user),
):
    """Liste iPad/MacBook. Prix HT masques si non-admin (rôle admin et code prouvé)."""
    obsolete = "" if obsoletes else " AND obsolete IS NOT TRUE"
    with get_cursor() as cur:
        cur.execute(
            f"""SELECT id, categorie, modele, ecran_prix_ht, batterie_prix_ht,
               ecran_prix_vente, batterie_prix_vente, actif, updated_at,
               prix_maj_le, prix_source, verrou_manuel, ref_fournisseur, fournisseur, obsolete, {_FRAICHEUR_SQL}
               FROM tarifs_apple_devices WHERE actif = TRUE{obsolete} ORDER BY categorie, modele"""
        )
        rows = cur.fetchall()
        r = prix.regles(cur)
    rows = [_fraicheur(dict(row), r) for row in rows]

    if not _est_admin(request, user):
        for row in rows:
            row.pop("ecran_prix_ht", None)
            row.pop("batterie_prix_ht", None)

    return rows


def _inserer_apple(cur, lignes: list, source_prix: str, par, lot_id) -> list:
    """Insère des iPad / MacBook neufs (prix daté) avec leur historique « création »."""
    ids, historique = [], []
    cols = ("ecran_prix_ht", "batterie_prix_ht", "ecran_prix_vente", "batterie_prix_vente")
    for l in lignes:
        cur.execute("""
            INSERT INTO tarifs_apple_devices (categorie, modele, ecran_prix_ht, batterie_prix_ht, ecran_prix_vente,
                batterie_prix_vente, actif, prix_maj_le, prix_source, fournisseur, verrou_manuel, obsolete)
            VALUES (%s, %s, %s, %s, %s, %s, TRUE, NOW(), %s, %s, FALSE, FALSE) RETURNING id
        """, (l["categorie"], l["modele"], *[l.get(c) for c in cols], source_prix, l.get("fournisseur") or "Mobilax"))
        i = cur.fetchone()["id"]
        ids.append(i)
        historique += [("tarifs_apple_devices", i, c, None, l[c], source_prix, lot_id, par)
                       for c in cols if l.get(c) is not None]
    if historique:
        execute_values(cur, """
            INSERT INTO tarifs_historique (table_nom, ligne_id, colonne, ancien, nouveau, source, lot_id, par)
            VALUES %s
        """, historique, page_size=len(historique))
    return ids


@router.post("/apple-devices/import")
def import_apple_devices(
    body: AppleDeviceImportRequest,
    user: dict = Depends(_admin),
):
    """Importe iPad/MacBook avec calcul des prix de vente (règles en vigueur). Mise à jour sans
    doublon par catégorie + modèle : id conservé, prix écrits par le moteur de prix."""
    par = _par(user)
    lot = prix.nouveau_lot()
    with get_cursor() as cur:
        r = prix.regles(cur)
        cur.execute("SELECT id, categorie, modele FROM tarifs_apple_devices")
        existants = {(e["categorie"], e["modele"].strip().lower()): e["id"] for e in cur.fetchall() or []}
        changements, nouvelles, reactiver = [], {}, set()
        for item in body.items:
            cle = (item.categorie, item.modele.strip().lower())
            pieces = {p: getattr(item, f"{p}_prix_ht") for p in prix.PIECES_APPLE}
            if cle in existants:
                i = existants[cle]
                reactiver.add(i)
                for p, ht in pieces.items():
                    if ht:
                        changements += [(i, f"{p}_prix_ht", ht), (i, f"{p}_prix_vente", prix.prix_apple(ht, item.categorie, r))]
            else:
                l = nouvelles.setdefault(cle, {"categorie": item.categorie, "modele": item.modele.strip()})
                for p, ht in pieces.items():
                    if ht:
                        l[f"{p}_prix_ht"] = ht
                        l[f"{p}_prix_vente"] = prix.prix_apple(ht, item.categorie, r)
        res = prix.ecrire_prix_lot(cur, "tarifs_apple_devices", changements, "import", par, lot)
        if reactiver:
            cur.execute("UPDATE tarifs_apple_devices SET actif = TRUE WHERE id = ANY(%s) AND actif IS NOT TRUE",
                        (sorted(reactiver),))
        ajoutes = _inserer_apple(cur, list(nouvelles.values()), "import", par, lot)

    _cache.clear()
    return {"imported": len(body.items), "modifies": len({i for i, _, _, _ in res["ecrits"]}),
            "ajoutes": len(ajoutes), "verrouilles": len(res["verrouilles"]),
            "lot_id": lot if (ajoutes or res["ecrits"]) else None}


@router.delete("/apple-devices/clear")
def clear_apple_devices(user: dict = Depends(_admin)):
    """Désactivé (410) : plus jamais de TRUNCATE."""
    raise HTTPException(410, _SUPPRESSION_DESACTIVEE)


class VerrouRequest(BaseModel):
    verrou_manuel: bool


def _verrou(table: str, ident: int, valeur: bool, user: dict) -> dict:
    """Pose ou retire le verrou manuel d'une pièce fournisseur (table en liste blanche)."""
    if table not in ("tarifs", "tarifs_apple_devices"):
        raise HTTPException(400, "Table sans verrou")
    with get_cursor() as cur:
        cur.execute(f"SELECT verrou_manuel FROM {table} WHERE id = %s FOR UPDATE", (ident,))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(404, "Tarif non trouve")
        if bool(row["verrou_manuel"]) != valeur:
            cur.execute(f"UPDATE {table} SET verrou_manuel = %s WHERE id = %s", (valeur, ident))
            cur.execute("""
                INSERT INTO admin_audit_log (user_login, user_target, action, target_type, target_id, details)
                VALUES (%s, %s, 'prix_verrou', %s, %s, %s)
            """, (_par(user) or "", user.get("target") or "", table, ident,
                  "verrouillé" if valeur else "déverrouillé"))
    _cache.clear()
    return {"id": ident, "verrou_manuel": valeur}


@router.patch("/apple-devices/{device_id}/verrou")
def set_verrou_apple(device_id: int, body: VerrouRequest, user: dict = Depends(_admin)):
    """Verrou d'un iPad / MacBook : ses prix ne bougent plus que par une saisie manuelle."""
    return _verrou("tarifs_apple_devices", device_id, body.verrou_manuel, user)


# ---------------------------------------------------------------------------
# Moteur de prix : règles, simulation, application, import de fichier, historique
# ---------------------------------------------------------------------------

class ChargePrix(BaseModel):
    """{} : recalcul ; {regles} : nouvelles marges ; {cible, filtre?, ajustement} : ajustement global."""
    regles: Optional[Dict[str, Any]] = None
    cible: Optional[str] = Field(None, max_length=40)
    filtre: Optional[Dict[str, Any]] = None
    ajustement: Optional[Dict[str, Any]] = None
    confirmer: Optional[bool] = None


def _charge(body: ChargePrix) -> dict:
    return {k: v for k, v in body.model_dump().items() if k != "confirmer" and v is not None}


@router.get("/regles")
def get_regles(user: dict = Depends(_admin)):
    """Règles de prix en vigueur (TARIFS_REGLES complétées par les valeurs par défaut)."""
    with get_cursor() as cur:
        return prix.regles(cur)


@router.post("/simuler")
def simuler_prix(body: ChargePrix, user: dict = Depends(_admin)):
    """Aperçu d'un recalcul, de nouvelles règles ou d'un ajustement global : AUCUNE écriture.

    → {modifies, inchanges, verrouilles, ignores, variation_moy, variation_min, variation_max,
    variation_moy_pct, alertes, ecarts:[{cle, label, ancien, nouveau, alerte}] (20 plus gros),
    verrouilles_liste:[{cle, label}] (50 au plus), …}
    Lignes verrouillées exclues et listées : verrou_manuel des pièces fournisseur, et cadenas des
    grilles boutique (PRIX_LIGNES_VERROUILLEES) même si leurs ids sont dans filtre.ids.
    """
    with get_cursor() as cur:
        try:
            plan = prix.planifier(cur, _charge(body))
        except ValueError as e:
            raise HTTPException(400, str(e))
    out = prix.resumer_plan(plan)
    out["mode"] = plan["mode"]
    if plan["mode"] != "ajustement":
        out["regles"] = plan["regles"]
    return out


@router.post("/appliquer")
def appliquer_prix(body: ChargePrix, user: dict = Depends(_admin)):
    """Applique la même charge que /simuler (confirmer: true), en une transaction et un lot
    annulable. Règles fournies : enregistrées. Lignes verrouillées (verrou_manuel, cadenas des
    grilles boutique relu au moment d'écrire) : exclues et listées (verrouilles, verrouilles_liste)."""
    if body.confirmer is not True:
        raise HTTPException(400, "Confirmation requise (confirmer: true) après l'aperçu")
    with get_cursor() as cur:
        try:
            plan = prix.planifier(cur, _charge(body))
        except ValueError as e:
            raise HTTPException(400, str(e))
        resume = prix.resumer_plan(plan, 0)
        lot = prix.nouveau_lot()
        if plan["mode"] == "regles":
            prix.enregistrer_regles_lot(cur, prix.regles(cur), plan["regles"], lot, _par(user))
        applique = prix.appliquer_plan(cur, plan, _par(user), lot)
        if plan["mode"] == "regles":
            applique["lot_id"] = lot
    params_cache.invalidate()
    _cache.clear()
    if plan.get("cible") in ("iphone_tarifs", "smartphones_tarifs"):
        _invalider_vente()
    return {**applique, "inchanges": resume["inchanges"], "ignores": resume["ignores"],
            "verrouilles": resume["verrouilles"], "verrouilles_liste": resume["verrouilles_liste"],
            "regles": plan["regles"] if plan["mode"] == "regles" else None}


@router.post("/import-fichier/apercu")
def import_fichier_apercu(
    fichier: UploadFile = File(...),
    fournisseur: str = Form("Mobilax", max_length=60),
    cible: str = Form("tarifs", max_length=40),
    mapping: Optional[str] = Form(None, max_length=4000),
    user: dict = Depends(_admin),
):
    """Lit un fichier fournisseur (xlsx, csv « ; » ou « , », décimales à virgule) SANS écrire de prix.

    → {import_id, colonnes, mapping, reconnues, nouvelles, non_reconnues, invalides, absentes, resume}
    """
    contenu = fichier.file.read(import_prix.MAX_OCTETS + 1)
    with get_cursor() as cur:
        try:
            return import_prix.apercu(cur, fichier.filename, contenu, fournisseur, cible, mapping, par=_par(user))
        except import_prix.ImportErreur as e:
            raise HTTPException(400, str(e))


class ImportAppliquerRequest(BaseModel):
    lignes: List[int] = Field(default_factory=list, max_length=20000)
    associations: List[Dict[str, Any]] = Field(default_factory=list, max_length=20000)
    nouvelles: List[int] = Field(default_factory=list, max_length=20000)
    marquer_obsoletes: bool = False
    ignorer_invalides: bool = False
    # Lignes confirmées malgré une alerte (en plus de `lignes`) : associations manuelles
    confirmees: List[int] = Field(default_factory=list, max_length=20000)


class ImportEvaluerRequest(BaseModel):
    associations: List[Dict[str, Any]] = Field(..., max_length=2000)


@router.post("/import-fichier/{import_id}/evaluer")
def import_fichier_evaluer(import_id: int, body: ImportEvaluerRequest, user: dict = Depends(_admin)):
    """Pré-évalue des associations manuelles {n, cle} d'un aperçu, SANS rien écrire.

    → [{n, cle, label, ancien_ht, nouveau_ht, ancien_client, nouveau_client, change, verrou,
    obsolete, alerte, alertes, confirmation_requise}] ; association inapplicable : {n, cle, erreur}.
    confirmation_requise (alerte 'variation' ou 'marge') : à l'application, l'association n'est
    appliquée que si n figure aussi dans `lignes` (ou `confirmees`).
    """
    with get_cursor() as cur:
        try:
            return import_prix.evaluer(cur, import_id, body.associations)
        except import_prix.ImportErreur as e:
            raise HTTPException(422, str(e))
        except LookupError as e:
            raise HTTPException(404, str(e))
        except RuntimeError as e:
            raise HTTPException(409, str(e))


@router.post("/import-fichier/{import_id}/appliquer")
def import_fichier_appliquer(import_id: int, body: ImportAppliquerRequest, user: dict = Depends(_admin)):
    """Applique les lignes choisies d'un aperçu, en une transaction : en cas d'erreur, rien n'est écrit.

    associations [{n, cle}] : recalculées à l'application avec les alertes des lignes reconnues ;
    avec une alerte 'variation' ou 'marge', appliquée seulement si n figure aussi dans `lignes`
    (ou `confirmees`), sinon listée dans associations_ignorees. Vers une pièce verrouillée : rien
    n'est écrit, listée dans associations_verrouillees (comptée dans verrouilles, pas dans associees).
    Une pièce associée, même ignorée ou verrouillée, n'est jamais marquée obsolète.
    → {lot_id, modifies, ajoutes, obsoletes, verrouilles, confirmes, inchanges, associees,
    associations_ignorees, associations_verrouillees}
    """
    with get_cursor() as cur:
        try:
            res = import_prix.appliquer(cur, import_id, body.model_dump(), _par(user))
        except import_prix.ImportErreur as e:
            raise HTTPException(422, str(e))
        except LookupError as e:
            raise HTTPException(404, str(e))
        except RuntimeError as e:
            raise HTTPException(409, str(e))
    params_cache.invalidate()
    _cache.clear()
    return res


@router.get("/historique")
def historique_prix(
    table: Optional[str] = Query(None, max_length=40),
    ligne_id: Optional[int] = Query(None, ge=1),
    lot_id: Optional[str] = Query(None, max_length=80),
    limit: int = Query(100, ge=1, le=1000),
    user: dict = Depends(_admin),
):
    """Historique des prix écrits, du plus récent au plus ancien."""
    conds, params = [], []
    if table:
        if table not in prix.TABLES:
            raise HTTPException(400, "Table de prix inconnue")
        conds.append("table_nom = %s")
        params.append(table)
    if ligne_id:
        conds.append("ligne_id = %s")
        params.append(ligne_id)
    if lot_id:
        conds.append("lot_id = %s")
        params.append(lot_id)
    where = "WHERE " + " AND ".join(conds) if conds else ""
    with get_cursor() as cur:
        cur.execute(f"""
            SELECT id, table_nom, ligne_id, colonne, ancien, nouveau, source, lot_id, par, le
            FROM tarifs_historique {where} ORDER BY id DESC LIMIT %s
        """, params + [limit])
        return [dict(row) for row in cur.fetchall() or []]


@router.get("/historique/lots")
def historique_lots(limit: int = Query(30, ge=1, le=200), user: dict = Depends(_admin)):
    """Derniers lots de prix (import, règles, ajustement, commande…) et s'ils ont été annulés.

    Avec les lots sans aucune valeur écrite (règles changées sans effet sur un prix, import qui n'a
    fait que confirmer des prix) : tarifs_imports les garde, annuler-lot les défait aussi."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT lot_id, source, par, le, valeurs, lignes, annule FROM (
                SELECT h.lot_id, min(h.source) AS source, min(h.par) AS par, min(h.le) AS le, count(*) AS valeurs,
                       count(DISTINCT (h.table_nom, h.ligne_id)) AS lignes,
                       EXISTS (SELECT 1 FROM tarifs_historique a WHERE a.lot_id = 'annulation:' || h.lot_id)
                       OR EXISTS (SELECT 1 FROM tarifs_imports i WHERE i.lot_id = h.lot_id AND i.statut = 'annule')
                       AS annule,
                       min(h.id) AS ordre
                FROM tarifs_historique h
                WHERE h.lot_id IS NOT NULL
                GROUP BY h.lot_id
                UNION ALL
                SELECT i.lot_id, CASE WHEN i.cible = 'regles' THEN 'formule' ELSE 'import' END, i.par,
                       COALESCE(i.applique_le, i.le), 0, 0, i.statut = 'annule', NULL
                FROM tarifs_imports i
                WHERE i.lot_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM tarifs_historique h WHERE h.lot_id = i.lot_id)
            ) lots
            ORDER BY le DESC, ordre DESC NULLS LAST
            LIMIT %s
        """, (limit,))
        return [dict(row) for row in cur.fetchall() or []]


@router.post("/historique/annuler-lot/{lot_id}")
def annuler_lot_prix(lot_id: str = Path(..., max_length=80), user: dict = Depends(_admin)):
    """Remet les prix d'un lot à leurs valeurs d'avant (date et source comprises).

    Une valeur modifiée depuis le lot, ou sur une ligne verrouillée, n'est pas touchée (listée dans
    conflits). 409 : lot déjà annulé, ou rien à rétablir (toutes ses valeurs verrouillées ou
    modifiées depuis : rien n'est changé, le lot reste annulable une fois le verrou retiré).
    """
    with get_cursor() as cur:
        try:
            res = prix.annuler_lot(cur, lot_id, _par(user))
        except LookupError as e:
            raise HTTPException(404, str(e))
        except RuntimeError as e:
            raise HTTPException(409, str(e))
    params_cache.invalidate()
    _cache.clear()
    _invalider_vente()
    return res


@router.get("/sante")
def sante_prix(user: dict = Depends(get_current_user)):
    """Santé des prix (comptages, aucune donnée nominative) : total, estimés, à revoir, périmés,
    propositions en attente, marges faibles, modèles sans prix, dernière veille, LCD-Phone."""
    with get_cursor() as cur:
        return prix.sante(cur)


class LigneManuelle(BaseModel):
    marque: str = Field(..., min_length=1, max_length=50)
    modele: str = Field(..., min_length=1, max_length=100)
    type_piece: str = Field(..., min_length=1, max_length=50)
    qualite: Optional[str] = Field(None, max_length=50)
    categorie: str = Field("standard", pattern="^(standard|haut_de_gamme|pliant)$")
    nom_fournisseur: Optional[str] = Field(None, max_length=250)
    fournisseur: Optional[str] = Field(None, max_length=60)
    prix_fournisseur_ht: Optional[float] = Field(None, gt=0, le=5000)
    prix_client: Optional[int] = Field(None, gt=0, le=100000)


@router.post("/ligne")
def ajouter_ligne(body: LigneManuelle, user: dict = Depends(_admin)):
    """Saisit une pièce à la main (source 'manuel'). Prix client saisi : la pièce est verrouillée
    (jamais modifiée automatiquement) ; HT seul : prix client calculé par les règles."""
    if body.prix_fournisseur_ht is None and body.prix_client is None:
        raise HTTPException(400, "Prix d'achat HT ou prix client requis")
    par = _par(user)
    lot = prix.nouveau_lot()
    with get_cursor() as cur:
        r = prix.regles(cur)
        client = body.prix_client or prix.prix_client(body.prix_fournisseur_ht, body.type_piece, body.categorie, r)
        ids = _inserer_tarifs(cur, [{
            "marque": body.marque.strip(), "modele": body.modele.strip(), "type_piece": body.type_piece.strip(),
            "qualite": (body.qualite or "").strip() or None, "categorie": body.categorie,
            "nom_fournisseur": body.nom_fournisseur, "ht": body.prix_fournisseur_ht, "client": client,
            "fournisseur": body.fournisseur, "verrou": body.prix_client is not None, "source": "manuel",
        }], "manuel", par, lot)
        if not ids:
            cur.execute("""
                SELECT id FROM tarifs WHERE lower(marque) = lower(%s) AND lower(modele) = lower(%s)
                  AND lower(type_piece) = lower(%s) AND COALESCE(lower(qualite), '') = COALESCE(lower(%s), '')
            """, (body.marque.strip(), body.modele.strip(), body.type_piece.strip(), (body.qualite or "").strip() or None))
            existant = cur.fetchone()
            raise HTTPException(409, {"code": "piece_existante", "id": existant["id"] if existant else None,
                                      "message": "Cette pièce existe déjà : modifiez son prix."})
        cur.execute("SELECT * FROM tarifs WHERE id = %s", (ids[0],))
        row = dict(cur.fetchone())
    _cache.clear()
    return row


class PrixManuel(BaseModel):
    prix_fournisseur_ht: Optional[float] = Field(None, gt=0, le=5000)
    prix_client: Optional[int] = Field(None, gt=0, le=100000)


@router.patch("/{tarif_id}/prix")
def modifier_prix(tarif_id: int, body: PrixManuel, user: dict = Depends(_admin)):
    """Modifie le prix d'une pièce à la main (source 'manuel', historique).

    HT seul : prix client recalculé par les règles (sauf pièce verrouillée, dont le prix
    client ne change pas). Prix client saisi : la pièce est verrouillée.
    """
    if body.prix_fournisseur_ht is None and body.prix_client is None:
        raise HTTPException(400, "Prix d'achat HT ou prix client requis")
    with get_cursor() as cur:
        r = prix.regles(cur)
        cur.execute("SELECT id, type_piece, categorie, verrou_manuel FROM tarifs WHERE id = %s FOR UPDATE", (tarif_id,))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(404, "Tarif non trouve")
        changements = []
        if body.prix_fournisseur_ht is not None:
            changements.append((tarif_id, "prix_fournisseur_ht", body.prix_fournisseur_ht))
        if body.prix_client is not None:
            changements.append((tarif_id, "prix_client", body.prix_client))
        elif not row["verrou_manuel"]:
            changements.append((tarif_id, "prix_client",
                                prix.prix_client(body.prix_fournisseur_ht, row["type_piece"], row["categorie"], r)))
        prix.ecrire_prix_lot(cur, "tarifs", changements, "manuel", _par(user), prix.nouveau_lot())
        if body.prix_client is not None and not row["verrou_manuel"]:
            cur.execute("UPDATE tarifs SET verrou_manuel = TRUE WHERE id = %s", (tarif_id,))
        cur.execute(f"SELECT *, {_FRAICHEUR_SQL} FROM tarifs WHERE id = %s", (tarif_id,))
        out = _fraicheur(dict(cur.fetchone()), r)
    _cache.clear()
    return out


@router.patch("/{tarif_id}/verrou")
def set_verrou(tarif_id: int, body: VerrouRequest, user: dict = Depends(_admin)):
    """Verrou d'une pièce : jamais modifiée par un import, les règles ou une commande."""
    return _verrou("tarifs", tarif_id, body.verrou_manuel, user)


# ---------------------------------------------------------------------------
# Stock checker — scrape Mobilax pages to verify en_stock
# ---------------------------------------------------------------------------

logger = logging.getLogger(__name__)

_MOBILAX_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "fr-FR,fr;q=0.9",
}


def _slugify(text: str) -> str:
    """Convert text to URL slug."""
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')


def _mobilax_urls(marque: str, modele: str) -> list:
    """Generate possible Mobilax category page URLs for a model."""
    brand = marque.lower()
    slug = _slugify(modele)
    urls = []

    if brand == "apple":
        urls.append(f"https://www.mobilax.fr/pieces-detachees/telephonie/apple/iphone/{slug}")
        urls.append(f"https://www.mobilax.fr/marques/apple/telephonie/iphone/{slug}")
    elif brand == "samsung":
        if "galaxy-a" in slug:
            urls.append(f"https://www.mobilax.fr/pieces-detachees/telephonie/samsung/galaxy-a/{slug}")
        elif "galaxy-s" in slug:
            urls.append(f"https://www.mobilax.fr/pieces-detachees/telephonie/samsung/galaxy-s/{slug}")
        elif "galaxy-z" in slug:
            urls.append(f"https://www.mobilax.fr/pieces-detachees/telephonie/samsung/galaxy-z/{slug}")
        elif "galaxy-m" in slug:
            urls.append(f"https://www.mobilax.fr/pieces-detachees/telephonie/samsung/galaxy-m/{slug}")
    elif brand == "xiaomi":
        if "redmi-note" in slug:
            urls.append(f"https://www.mobilax.fr/marques/xiaomi/telephonie/redmi-note-series/{slug}")
        elif "redmi" in slug:
            urls.append(f"https://www.mobilax.fr/marques/xiaomi/telephonie/redmi-series/{slug}")
        elif "poco" in slug:
            urls.append(f"https://www.mobilax.fr/marques/xiaomi/telephonie/poco-series/{slug}")
        else:
            urls.append(f"https://www.mobilax.fr/marques/xiaomi/telephonie/mi-series/{slug}")
    elif brand == "huawei":
        if any(slug.startswith(p) for p in ("p-smart", "p30", "p40", "p50", "p20")):
            urls.append(f"https://www.mobilax.fr/marques/huawei/telephonie/series-p/{slug}")
        elif slug.startswith("nova"):
            urls.append(f"https://www.mobilax.fr/marques/huawei/telephonie/series-nova/{slug}")
        else:
            urls.append(f"https://www.mobilax.fr/marques/huawei/telephonie/series-y/{slug}")
    elif brand == "honor":
        if slug.startswith("x"):
            urls.append(f"https://www.mobilax.fr/marques/honor/telephonie/series-x/{slug}")
        elif "magic" in slug:
            urls.append(f"https://www.mobilax.fr/marques/honor/telephonie/series-magic/{slug}")
        else:
            urls.append(f"https://www.mobilax.fr/marques/honor/telephonie/series-70-90-200/{slug}")
    elif brand == "oneplus":
        if "nord" in slug:
            urls.append(f"https://www.mobilax.fr/marques/oneplus/telephonie/series-nord/{slug}")
        else:
            urls.append(f"https://www.mobilax.fr/marques/oneplus/telephonie/series-9-10-11-12-13/{slug}")
    elif brand == "oppo":
        if slug.startswith("find"):
            urls.append(f"https://www.mobilax.fr/marques/oppo/telephonie/series-find/{slug}")
        elif slug.startswith("reno"):
            urls.append(f"https://www.mobilax.fr/marques/oppo/telephonie/series-reno/{slug}")
        else:
            urls.append(f"https://www.mobilax.fr/marques/oppo/telephonie/series-a/{slug}")
    elif brand == "google":
        urls.append(f"https://www.mobilax.fr/marques/google/telephonie/pixel/{slug}")
    elif brand == "motorola":
        if "edge" in slug:
            urls.append(f"https://www.mobilax.fr/marques/motorola/telephonie/edge/{slug}")
        elif "moto-e" in slug:
            urls.append(f"https://www.mobilax.fr/marques/motorola/telephonie/moto-e/{slug}")
        else:
            urls.append(f"https://www.mobilax.fr/marques/motorola/telephonie/moto-g/{slug}")

    return urls


def _extract_products(html: str) -> list:
    """Extract products with quantity from Mobilax HTML."""
    products = []
    seen = set()
    text = html.replace('\\"', '"').replace('\\/', '/')

    for m in re.finditer(r'"id":(\d+),"name":"([^"]+)"', text):
        pid = m.group(1)
        name = m.group(2)
        if pid in seen or name in ('Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'):
            continue
        rest = text[m.start():m.start() + 2000]
        qty_match = re.search(r'"quantity":(\d+)', rest)
        if qty_match:
            seen.add(pid)
            products.append({"name": name, "quantity": int(qty_match.group(1))})

    return products


def _match_stock(type_piece: str, qualite: str, products: list):
    """Match our tarif to Mobilax products. Returns True/False/None."""
    tp = (type_piece or "").lower()
    qual = (qualite or "").lower()
    matched = []

    for p in products:
        n = p["name"].lower()

        if "ecran" in tp or "cran" in tp:
            if "ecran" not in n and "cran" not in n:
                continue
            if qual == "original" and "original" in n and "pulled" not in n:
                matched.append(p)
            elif qual == "reconditionnee" and ("pulled" in n or "refurb" in n):
                matched.append(p)
            elif qual == "soft oled" and "soft oled" in n:
                matched.append(p)
            elif qual == "oled" and "oled" in n and "original" not in n and "soft" not in n:
                matched.append(p)
            elif qual == "incell" and "incell" in n:
                matched.append(p)
            elif qual in ("compatible", "lcd") and "oem" in n:
                matched.append(p)
        elif "batterie" in tp:
            if "batterie" in n:
                matched.append(p)
        elif "connecteur" in tp:
            if "connecteur" in n:
                matched.append(p)
        elif "camera" in tp or "cam" in tp:
            if "cam" in n and "principale" in n:
                matched.append(p)
        elif "haut-parleur" in tp or "haut parleur" in tp:
            if "haut-parleur" in n or "haut parleur" in n:
                matched.append(p)
        elif "ecouteur" in tp or "couteur" in tp:
            if "couteur" in n:
                matched.append(p)
        elif "vitre" in tp:
            if "vitre" in n or "cache" in n:
                matched.append(p)

    if not matched:
        return None
    return any(p["quantity"] > 0 for p in matched)


# Vérification du stock Mobilax (BE-B) : en tâche de fond (timeout HTTP Railway ~15 s), admin.
# Stock seulement : jamais de prix lu ni écrit ; ni prix_maj_le ni prix_source ne bougent.
from fastapi import BackgroundTasks  # noqa: E402

_stock_etat = {"en_cours": False, "debut": None, "fin": None, "resultat": None}


def _maintenant_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")


def verifier_stock_mobilax() -> dict:
    """Pages catégorie Mobilax de chaque modèle : met à jour en_stock (rien d'autre)."""
    import httpx

    with get_cursor() as cur:
        cur.execute("SELECT id, marque, modele, type_piece, qualite, en_stock FROM tarifs WHERE obsolete IS NOT TRUE")
        all_tarifs = [dict(r) for r in cur.fetchall()]

    models = {}
    for t in all_tarifs:
        models.setdefault((t["marque"], t["modele"]), []).append(t)

    results = {
        "models_total": len(models), "models_checked": 0, "models_found": 0, "tarifs_checked": 0,
        "tarifs_updated": 0, "now_in_stock": 0, "now_rupture": 0,
    }
    changements = []
    with httpx.Client(headers=_MOBILAX_HEADERS, timeout=10, follow_redirects=True) as client:
        for (marque, modele), model_tarifs in models.items():
            urls = _mobilax_urls(marque, modele)
            if not urls:
                continue
            html = None
            for url in urls:
                try:
                    resp = client.get(url)
                    if resp.status_code == 200 and len(resp.text) > 1000:
                        html = resp.text
                        break
                except Exception:
                    continue
            results["models_checked"] += 1
            if html:
                products = _extract_products(html)
                if products:
                    results["models_found"] += 1
                    for tarif in model_tarifs:
                        stock = _match_stock(tarif["type_piece"], tarif["qualite"], products)
                        if stock is None:
                            continue
                        results["tarifs_checked"] += 1
                        old_stock = tarif["en_stock"] if tarif["en_stock"] is not None else True
                        if stock != old_stock:
                            changements.append((tarif["id"], stock))
                            results["tarifs_updated"] += 1
                            results["now_in_stock" if stock else "now_rupture"] += 1
            time.sleep(0.3)

    if changements:
        with get_cursor() as cur:
            execute_values(
                cur,
                "UPDATE tarifs AS t SET en_stock = v.stock, updated_at = NOW() "
                "FROM (VALUES %s) AS v(id, stock) WHERE t.id = v.id",
                changements, template="(%s::integer, %s::boolean)", page_size=max(len(changements), 1),
            )
    return results


def _tache_stock():
    try:
        _stock_etat["resultat"] = verifier_stock_mobilax()
    except Exception as e:
        logging.getLogger(__name__).warning("Vérification du stock Mobilax : échec (%s)", type(e).__name__)
        _stock_etat["resultat"] = {"error": "Vérification du stock impossible (Mobilax injoignable ?)"}
    finally:
        _stock_etat["fin"] = _maintenant_iso()
        _stock_etat["en_cours"] = False
        _cache.clear()


def _etat_stock() -> dict:
    return {"en_cours": _stock_etat["en_cours"], "debut": _stock_etat["debut"], "fin": _stock_etat["fin"],
            "dernier_resultat": _stock_etat["resultat"]}


@router.post("/check-stock")
def check_stock_mobilax(request: Request, background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    """Lance la vérification du stock Mobilax en tâche de fond (admin) ; avancement : GET /check-stock/status."""
    exiger_role_admin(request, user)
    if _stock_etat["en_cours"]:
        return {"lance": False, "message": "Vérification déjà en cours", **_etat_stock()}
    _stock_etat.update(en_cours=True, debut=_maintenant_iso(), fin=None)
    background_tasks.add_task(_tache_stock)
    return {"lance": True, "message": "Vérification du stock lancée en arrière-plan", **_etat_stock()}


@router.get("/check-stock/status")
def statut_check_stock(user: dict = Depends(get_current_user)):
    """État de la dernière vérification du stock (en cours, début, fin, résultat)."""
    return _etat_stock()


# ---------------------------------------------------------------------------
# Grille tarifs reparation iPhone (table tarifs_reparation)
# ---------------------------------------------------------------------------

TARIF_REP_COLS = list(prix.COLONNES_REPARATION)
TARIF_REP_BARRE_COLS = list(prix.COLONNES_REPARATION_BARRE)
TARIF_REP_ALL_COLS = TARIF_REP_COLS + TARIF_REP_BARRE_COLS


@router.get("/reparation")
def list_tarifs_reparation():
    """Liste tous les tarifs reparation iPhone (public)."""
    with get_cursor() as cur:
        cur.execute(f"""
            SELECT id, modele, ordre,
                   ecran_generique, ecran_confort, ecran_apple,
                   batterie, desoxydation, connecteur_charge, reparation_divers,
                   ecouteur_apn, vitre_arriere, chassis,
                   ecran_generique_barre, ecran_confort_barre, ecran_apple_barre,
                   batterie_barre, desoxydation_barre, connecteur_charge_barre,
                   reparation_divers_barre, ecouteur_apn_barre, vitre_arriere_barre,
                   chassis_barre, updated_at, prix_maj_le, {_AGE_SQL}
            FROM tarifs_reparation
            ORDER BY ordre, id
        """)
        rows = cur.fetchall()
    return [dict(r) for r in rows]


def _prix_grille(tarif_id: int, body: Dict[str, Any]) -> list:
    """Colonnes de prix envoyées → changements pour le moteur de prix (400 si valeur invalide)."""
    changements = []
    for col in TARIF_REP_ALL_COLS:
        if col in body:
            v = body[col]
            try:
                prix.normaliser_valeur("integer", v)
            except ValueError as e:
                raise HTTPException(400, f"{col} : {e}")
            changements.append((tarif_id, col, v))
    return changements


@router.put("/reparation/{tarif_id}")
def update_tarif_reparation(tarif_id: int, body: Dict[str, Any], user: dict = Depends(_admin)):
    """Met a jour un tarif reparation. Seuls les champs envoyes sont modifies (prix : moteur de
    prix, source 'manuel', historique et date du prix).

    Saisie manuelle explicite : permise même sur une ligne cadenassée (PRIX_LIGNES_VERROUILLEES),
    comme pour verrou_manuel des pièces fournisseur — c'est l'admin qui tape le prix, le cadenas
    reste posé. Le cadenas protège la ligne des écritures en masse (ajustement global, /bulk,
    annulation d'un lot)."""
    changements = _prix_grille(tarif_id, body)
    modele = body.get("modele")
    if not changements and modele is None:
        raise HTTPException(400, "Aucun champ a mettre a jour")
    with get_cursor() as cur:
        cur.execute("SELECT id, modele FROM tarifs_reparation WHERE id = %s FOR UPDATE", (tarif_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Tarif non trouve")
        if modele is not None:
            modele = str(modele).strip()
            if not modele or len(modele) > 100:
                raise HTTPException(400, "Nom du modele invalide")
            if modele != row["modele"]:
                cur.execute("SELECT 1 AS x FROM tarifs_reparation WHERE modele = %s AND id <> %s", (modele, tarif_id))
                if cur.fetchone():
                    raise HTTPException(409, "Ce modele existe deja dans la grille")
                cur.execute("UPDATE tarifs_reparation SET modele = %s, updated_at = NOW() WHERE id = %s",
                            (modele, tarif_id))
        prix.ecrire_prix_lot(cur, "tarifs_reparation", changements, "manuel", _par(user), prix.nouveau_lot())
        cur.execute("SELECT * FROM tarifs_reparation WHERE id = %s", (tarif_id,))
        row = cur.fetchone()
    return dict(row)


@router.post("/reparation/bulk")
def bulk_tarifs_reparation(body: List[Dict[str, Any]], user: dict = Depends(_admin)):
    """Met à jour la grille sans doublon : un modèle existant (par id, sinon par nom) garde son id
    et son ordre, seuls les prix envoyés changent (moteur de prix) ; un modèle nouveau est ajouté
    en fin de grille. Aucun modèle n'est supprimé.

    Mise à jour en masse (comme un import) : une ligne cadenassée (PRIX_LIGNES_VERROUILLEES)
    garde ses prix, listée dans « verrouilles » [{id, modele}] ; pour la modifier, saisir le prix
    sur la ligne (PUT /reparation/{id}) ou retirer le cadenas."""
    if len(body) > 500:
        raise HTTPException(400, "500 modeles au plus")
    par = _par(user)
    lot = prix.nouveau_lot()
    with get_cursor() as cur:
        cur.execute("SELECT id, modele FROM tarifs_reparation FOR UPDATE")
        existants = cur.fetchall() or []
        par_id = {e["id"] for e in existants}
        par_nom = {e["modele"].strip().lower(): e["id"] for e in existants}
        cur.execute("SELECT COALESCE(MAX(ordre), 0) AS o FROM tarifs_reparation")
        ordre = cur.fetchone()["o"] or 0
        changements, vus, ajoutes, noms = [], set(), 0, {e["id"]: e["modele"] for e in existants}
        for item in body:
            if not isinstance(item, dict):
                raise HTTPException(400, "Objets {modele, colonnes de prix} attendus")
            modele = str(item.get("modele") or "").strip()
            if not modele or len(modele) > 100:
                continue
            ident = item.get("id") if isinstance(item.get("id"), int) and item.get("id") in par_id else None
            ident = ident or par_nom.get(modele.lower())
            if ident is None:
                ordre += 1
                cur.execute("INSERT INTO tarifs_reparation (modele, ordre) VALUES (%s, %s) "
                            "ON CONFLICT (modele) DO NOTHING RETURNING id", (modele, ordre))
                nouveau = cur.fetchone()
                if nouveau is None:
                    raise HTTPException(409, f"Modele en double : {modele}")
                ident = nouveau["id"]
                par_nom[modele.lower()] = ident
                ajoutes += 1
            if ident in vus:
                raise HTTPException(400, f"Modele present deux fois : {modele}")
            vus.add(ident)
            noms.setdefault(ident, modele)
            changements += _prix_grille(ident, item)
        res = prix.ecrire_prix_lot(cur, "tarifs_reparation", changements, "manuel", par, lot, saisie=False)
    return {"status": "ok", "count": len(vus), "ajoutes": ajoutes,
            "modifies": len(res["ecrits"]), "lot_id": lot if res["ecrits"] else None,
            "verrouilles": [{"id": i, "modele": noms.get(i)} for i in res["verrouilles"]]}


@router.post("/reparation/add")
def add_tarif_reparation(body: Dict[str, Any], user: dict = Depends(_admin)):
    """Ajoute un nouveau modele dans la grille tarifs."""
    modele = str(body.get("modele") or "").strip()
    if not modele:
        raise HTTPException(400, "Le nom du modele est requis")
    if len(modele) > 100:
        raise HTTPException(400, "Nom du modele trop long")
    with get_cursor() as cur:
        # Prend l'ordre max + 1
        cur.execute("SELECT COALESCE(MAX(ordre), 0) + 1 AS next_ordre FROM tarifs_reparation")
        next_ordre = cur.fetchone()["next_ordre"]
        cur.execute(
            "INSERT INTO tarifs_reparation (modele, ordre) VALUES (%s, %s) "
            "ON CONFLICT (modele) DO NOTHING RETURNING *",
            (modele, next_ordre),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(409, "Ce modele existe deja dans la grille")
    return dict(row)


@router.delete("/reparation/{tarif_id}")
def delete_tarif_reparation(tarif_id: int, user: dict = Depends(_admin)):
    """Supprime un modele de la grille tarifs."""
    with get_cursor() as cur:
        cur.execute("DELETE FROM tarifs_reparation WHERE id = %s RETURNING id", (tarif_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Tarif non trouve")
    return {"status": "ok", "deleted": tarif_id}


@router.post("/reparation/reorder")
def reorder_tarifs_reparation(body: List[Dict[str, Any]], user: dict = Depends(_admin)):
    """Reordonne les tarifs. Body = [{id, ordre}, ...]"""
    try:
        paires = [(int(item["ordre"]), int(item["id"])) for item in body]
    except (KeyError, TypeError, ValueError):
        raise HTTPException(400, "Liste [{id, ordre}] attendue")
    with get_cursor() as cur:
        if paires:
            execute_values(cur, "UPDATE tarifs_reparation AS t SET ordre = v.o FROM (VALUES %s) AS v(o, id) "
                                "WHERE t.id = v.id", paires, page_size=max(len(paires), 1))
    return {"status": "ok"}
