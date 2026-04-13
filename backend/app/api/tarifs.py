"""
API Tarifs - Gestion des prix de reparation.
Calcul automatique des prix clients a partir des prix fournisseur HT.
Grille tarifs reparation iPhone (table tarifs_reparation).
"""

import math
import re
import time
import logging
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.database import get_cursor
from app.api.auth import get_current_user

router = APIRouter(prefix="/api/tarifs", tags=["tarifs"])


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
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(modele)
            )
        """)
        # Add _barre columns if table already existed without them
        for col in [
            "ecran_generique_barre", "ecran_confort_barre", "ecran_apple_barre",
            "batterie_barre", "desoxydation_barre", "connecteur_charge_barre",
            "reparation_divers_barre", "ecouteur_apn_barre", "vitre_arriere_barre",
            "chassis_barre",
        ]:
            try:
                cur.execute(f"ALTER TABLE tarifs_reparation ADD COLUMN IF NOT EXISTS {col} INTEGER")
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
# Pricing logic
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
    marque: str
    modele: str
    type_piece: str
    qualite: Optional[str] = None
    nom_fournisseur: Optional[str] = None
    prix_fournisseur_ht: float
    categorie: Optional[str] = "standard"
    source: Optional[str] = "mobilax"
    en_stock: Optional[bool] = True


class TarifImportRequest(BaseModel):
    items: List[TarifImportItem]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
async def list_tarifs(
    q: Optional[str] = Query(None, description="Recherche sur marque ou modele"),
    marque: Optional[str] = Query(None, description="Filtre exact sur marque"),
    user: dict = Depends(get_current_user),
):
    """Liste les tarifs avec filtres optionnels. HT masque si non-admin."""
    conditions = []
    params = []

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
        prix_fournisseur_ht, prix_client, categorie, source, en_stock, updated_at
        FROM tarifs {where} ORDER BY marque, modele, type_piece, qualite"""

    with get_cursor() as cur:
        cur.execute(query, params)
        rows = cur.fetchall()

    results = [dict(r) for r in rows]

    is_admin = user.get("role") == "admin"
    if not is_admin:
        for r in results:
            r.pop("prix_fournisseur_ht", None)

    return results


@router.get("/stats")
async def get_stats():
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
        """)
        row = cur.fetchone()
    result = dict(row)
    _cache.set("tarifs_stats", result)
    return result


@router.post("/import")
async def import_tarifs(
    body: TarifImportRequest,
    user: dict = Depends(get_current_user),
):
    """Importe une liste de tarifs. Calcule automatiquement le prix client."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin requis")
    inserted = 0

    with get_cursor() as cur:
        for item in body.items:
            prix_client = calcul_prix_client(
                item.prix_fournisseur_ht,
                item.type_piece,
                item.categorie or "standard",
            )
            cur.execute(
                """
                INSERT INTO tarifs
                    (marque, modele, type_piece, qualite, nom_fournisseur,
                     prix_fournisseur_ht, prix_client, categorie, source, en_stock, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                """,
                (
                    item.marque,
                    item.modele,
                    item.type_piece,
                    item.qualite,
                    item.nom_fournisseur,
                    item.prix_fournisseur_ht,
                    prix_client,
                    item.categorie or "standard",
                    item.source or "mobilax",
                    item.en_stock if item.en_stock is not None else True,
                ),
            )
            inserted += 1

    _cache.clear()
    return {"inserted": inserted}


@router.post("/recalculate")
async def recalculate_tarifs(user: dict = Depends(get_current_user)):
    """Recalcule tous les prix_client a partir de prix_fournisseur_ht."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin requis")
    updated = 0
    with get_cursor() as cur:
        cur.execute("SELECT id, prix_fournisseur_ht, type_piece, categorie FROM tarifs")
        rows = cur.fetchall()
        for row in rows:
            old_prix = None
            cur2_query = "SELECT prix_client FROM tarifs WHERE id = %s"
            cur.execute(cur2_query, (row["id"],))
            old_row = cur.fetchone()
            if old_row:
                old_prix = old_row["prix_client"]

            new_prix = calcul_prix_client(
                float(row["prix_fournisseur_ht"]),
                row["type_piece"],
                row["categorie"] or "standard",
            )
            if old_prix != new_prix:
                cur.execute(
                    "UPDATE tarifs SET prix_client = %s, updated_at = NOW() WHERE id = %s",
                    (new_prix, row["id"]),
                )
                updated += 1

    return {"recalculated": updated, "total": len(rows)}


@router.patch("/{tarif_id}/stock")
async def toggle_stock(tarif_id: int, user: dict = Depends(get_current_user)):
    """Inverse le statut en_stock d'un tarif."""
    with get_cursor() as cur:
        cur.execute(
            "UPDATE tarifs SET en_stock = NOT COALESCE(en_stock, TRUE), updated_at = NOW() WHERE id = %s RETURNING id, en_stock",
            (tarif_id,),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Tarif non trouve")
    return {"id": row["id"], "en_stock": row["en_stock"]}


@router.delete("/clear")
async def clear_tarifs(user: dict = Depends(get_current_user)):
    """Vide la table tarifs."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin requis")
    with get_cursor() as cur:
        cur.execute("TRUNCATE TABLE tarifs RESTART IDENTITY")
    _cache.clear()
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Apple Devices (iPad / MacBook)
# ---------------------------------------------------------------------------

class AppleDeviceImportItem(BaseModel):
    categorie: str  # 'ipad' ou 'macbook'
    modele: str
    ecran_prix_ht: Optional[float] = None
    batterie_prix_ht: Optional[float] = None


class AppleDeviceImportRequest(BaseModel):
    items: List[AppleDeviceImportItem]


@router.get("/apple-devices")
async def list_apple_devices(user: dict = Depends(get_current_user)):
    """Liste iPad/MacBook. Prix HT masques si non-admin (target != accueil)."""
    with get_cursor() as cur:
        cur.execute(
            """SELECT id, categorie, modele, ecran_prix_ht, batterie_prix_ht,
               ecran_prix_vente, batterie_prix_vente, actif, updated_at
               FROM tarifs_apple_devices WHERE actif = TRUE ORDER BY categorie, modele"""
        )
        rows = [dict(r) for r in cur.fetchall()]

    is_admin = user.get("role") == "admin"
    if not is_admin:
        for r in rows:
            r.pop("ecran_prix_ht", None)
            r.pop("batterie_prix_ht", None)

    return rows


@router.post("/apple-devices/import")
async def import_apple_devices(
    body: AppleDeviceImportRequest,
    user: dict = Depends(get_current_user),
):
    """Importe iPad/MacBook avec calcul automatique des prix de vente."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin requis")
    inserted = 0
    with get_cursor() as cur:
        for item in body.items:
            calc = calc_prix_ipad if item.categorie == "ipad" else calc_prix_macbook
            ecran_vente = calc(item.ecran_prix_ht) if item.ecran_prix_ht else None
            batterie_vente = calc(item.batterie_prix_ht) if item.batterie_prix_ht else None

            # Upsert par categorie + modele
            cur.execute(
                "SELECT id FROM tarifs_apple_devices WHERE categorie = %s AND modele = %s",
                (item.categorie, item.modele),
            )
            existing = cur.fetchone()
            if existing:
                cur.execute("""
                    UPDATE tarifs_apple_devices SET
                        ecran_prix_ht = COALESCE(%s, ecran_prix_ht),
                        batterie_prix_ht = COALESCE(%s, batterie_prix_ht),
                        ecran_prix_vente = COALESCE(%s, ecran_prix_vente),
                        batterie_prix_vente = COALESCE(%s, batterie_prix_vente),
                        actif = TRUE, updated_at = NOW()
                    WHERE id = %s
                """, (item.ecran_prix_ht, item.batterie_prix_ht,
                      ecran_vente, batterie_vente, existing["id"]))
            else:
                cur.execute("""
                    INSERT INTO tarifs_apple_devices
                        (categorie, modele, ecran_prix_ht, batterie_prix_ht,
                         ecran_prix_vente, batterie_prix_vente)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (item.categorie, item.modele,
                      item.ecran_prix_ht, item.batterie_prix_ht,
                      ecran_vente, batterie_vente))
            inserted += 1

    return {"imported": inserted}


@router.delete("/apple-devices/clear")
async def clear_apple_devices(user: dict = Depends(get_current_user)):
    """Vide la table tarifs_apple_devices."""
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin requis")
    with get_cursor() as cur:
        cur.execute("TRUNCATE TABLE tarifs_apple_devices RESTART IDENTITY")
    return {"status": "ok"}


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


@router.post("/check-stock")
async def check_stock_mobilax(user: dict = Depends(get_current_user)):
    """Scrape Mobilax category pages to check stock for all tarifs."""
    import httpx
    import asyncio

    with get_cursor() as cur:
        cur.execute("SELECT id, marque, modele, type_piece, qualite, en_stock FROM tarifs")
        all_tarifs = [dict(r) for r in cur.fetchall()]

    # Group by model
    models = {}
    for t in all_tarifs:
        key = (t["marque"], t["modele"])
        models.setdefault(key, []).append(t)

    results = {
        "models_total": len(models),
        "models_checked": 0,
        "models_found": 0,
        "tarifs_checked": 0,
        "tarifs_updated": 0,
        "now_in_stock": 0,
        "now_rupture": 0,
    }

    async with httpx.AsyncClient(
        headers=_MOBILAX_HEADERS,
        timeout=10,
        follow_redirects=True,
    ) as client:
        for (marque, modele), model_tarifs in models.items():
            urls = _mobilax_urls(marque, modele)
            if not urls:
                continue

            html = None
            for url in urls:
                try:
                    resp = await client.get(url)
                    if resp.status_code == 200 and len(resp.text) > 1000:
                        html = resp.text
                        break
                except Exception:
                    continue

            results["models_checked"] += 1

            if not html:
                continue

            products = _extract_products(html)
            if not products:
                continue

            results["models_found"] += 1

            for tarif in model_tarifs:
                stock = _match_stock(tarif["type_piece"], tarif["qualite"], products)
                if stock is not None:
                    results["tarifs_checked"] += 1
                    old_stock = tarif["en_stock"] if tarif["en_stock"] is not None else True
                    if stock != old_stock:
                        with get_cursor() as cur:
                            cur.execute(
                                "UPDATE tarifs SET en_stock = %s, updated_at = NOW() WHERE id = %s",
                                (stock, tarif["id"]),
                            )
                        results["tarifs_updated"] += 1
                        if stock:
                            results["now_in_stock"] += 1
                        else:
                            results["now_rupture"] += 1

            await asyncio.sleep(0.3)

    return results


# ---------------------------------------------------------------------------
# Grille tarifs reparation iPhone (table tarifs_reparation)
# ---------------------------------------------------------------------------

TARIF_REP_COLS = [
    "ecran_generique", "ecran_confort", "ecran_apple", "batterie",
    "desoxydation", "connecteur_charge", "reparation_divers",
    "ecouteur_apn", "vitre_arriere", "chassis",
]
TARIF_REP_BARRE_COLS = [c + "_barre" for c in TARIF_REP_COLS]
TARIF_REP_ALL_COLS = TARIF_REP_COLS + TARIF_REP_BARRE_COLS


@router.get("/reparation")
async def list_tarifs_reparation():
    """Liste tous les tarifs reparation iPhone (public)."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT id, modele,
                   ecran_generique, ecran_confort, ecran_apple,
                   batterie, desoxydation, connecteur_charge, reparation_divers,
                   ecouteur_apn, vitre_arriere, chassis,
                   ecran_generique_barre, ecran_confort_barre, ecran_apple_barre,
                   batterie_barre, desoxydation_barre, connecteur_charge_barre,
                   reparation_divers_barre, ecouteur_apn_barre, vitre_arriere_barre,
                   chassis_barre, updated_at
            FROM tarifs_reparation
            ORDER BY id
        """)
        rows = cur.fetchall()
    return [dict(r) for r in rows]


@router.put("/reparation/{tarif_id}")
async def update_tarif_reparation(tarif_id: int, body: Dict[str, Any]):
    """Met a jour un tarif reparation. Seuls les champs envoyes sont modifies."""
    updates = []
    params = []
    for col in TARIF_REP_ALL_COLS + ["modele"]:
        if col in body:
            updates.append(f"{col} = %s")
            params.append(body[col])
    if not updates:
        raise HTTPException(400, "Aucun champ a mettre a jour")
    updates.append("updated_at = NOW()")
    params.append(tarif_id)

    with get_cursor() as cur:
        cur.execute(
            f"UPDATE tarifs_reparation SET {', '.join(updates)} WHERE id = %s RETURNING *",
            params,
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Tarif non trouve")
    return dict(row)


@router.post("/reparation/bulk")
async def bulk_tarifs_reparation(body: List[Dict[str, Any]]):
    """Remplace tous les tarifs reparation par le tableau fourni."""
    all_cols = TARIF_REP_COLS + TARIF_REP_BARRE_COLS
    col_names = ", ".join(all_cols)
    placeholders = ", ".join(["%s"] * len(all_cols))
    with get_cursor() as cur:
        cur.execute("DELETE FROM tarifs_reparation")
        for item in body:
            modele = item.get("modele")
            if not modele:
                continue
            vals = [item.get(c) for c in all_cols]
            cur.execute(
                f"""INSERT INTO tarifs_reparation
                   (modele, {col_names})
                   VALUES (%s, {placeholders})""",
                [modele] + vals,
            )
    return {"status": "ok", "count": len(body)}
