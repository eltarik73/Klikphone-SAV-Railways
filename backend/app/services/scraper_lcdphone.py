"""
Scraper LCD-Phone.com — récupère les téléphones en stock avec prix B2B.
Utilise httpx + BeautifulSoup. Appels AJAX PrestaShop pour le rendu JS.
"""

import os
import re
import time
import logging
from typing import Optional, List, Dict

from app.database import get_cursor

logger = logging.getLogger(__name__)

# ─── CONFIG ─────────────────────────────────────────
LCDPHONE_BASE = "https://lcd-phone.com"
LCDPHONE_LOGIN_URL = f"{LCDPHONE_BASE}/fr/connexion"

# IDs des catégories PrestaShop
CATEGORIES = [
    {"id": 3171, "slug": "iphone-occasion", "type_produit": "occasion", "marque_forcee": "Apple"},
    {"id": 3172, "slug": "android-occasion", "type_produit": "occasion", "marque_forcee": None},
    {"id": 860, "slug": "telephone-neuf", "type_produit": "neuf", "marque_forcee": None},
    {"id": 859, "slug": "telephone-occasion", "type_produit": "occasion", "marque_forcee": None},
]

# Lazy imports
_HAS_DEPS = False
try:
    import httpx
    from bs4 import BeautifulSoup
    _HAS_DEPS = True
except ImportError:
    pass


# ─── HELPERS ────────────────────────────────────────

def calculer_prix_vente(prix_fournisseur: float, marque: str, type_produit: str) -> tuple:
    if type_produit == "occasion":
        marge = 80.0
    elif marque and marque.lower() in ("apple", "iphone"):
        marge = 50.0
    else:
        marge = 60.0
    return round(prix_fournisseur + marge, 2), marge


def detecter_marque(nom: str) -> str:
    nom_lower = nom.lower()
    mapping = {
        "iphone": "Apple", "apple": "Apple",
        "samsung": "Samsung", "galaxy": "Samsung",
        "xiaomi": "Xiaomi", "redmi": "Xiaomi", "poco": "Xiaomi",
        "google": "Google", "pixel": "Google",
        "huawei": "Huawei", "honor": "Honor",
        "oppo": "Oppo", "oneplus": "OnePlus",
        "motorola": "Motorola", "nothing": "Nothing",
        "realme": "Realme", "alcatel": "Alcatel",
        "sony": "Sony", "nokia": "Nokia",
        "blackview": "Blackview", "wiko": "Wiko",
    }
    for keyword, marque in mapping.items():
        if keyword in nom_lower:
            return marque
    return "Autre"


def extraire_stockage(nom: str) -> Optional[str]:
    m = re.search(r'(\d+)\s*(Go|GB|To|TB)', nom, re.IGNORECASE)
    if m:
        return f"{m.group(1)} {m.group(2).upper().replace('GB','Go').replace('TB','To')}"
    return None


def extraire_grade(nom: str) -> Optional[str]:
    m = re.search(r'Grade\s*(A\+?B?|AB|B|C|D)', nom, re.IGNORECASE)
    if m:
        return f"Grade {m.group(1).upper()}"
    if re.search(r'\bneuf\b|\bblister\b|\bASIS\+?\b', nom, re.IGNORECASE):
        return "Neuf"
    return None


def extraire_couleur(nom: str) -> Optional[str]:
    couleurs = [
        "Titane Noir", "Titane Naturel", "Titane Bleu", "Titane Blanc", "Titane Désert",
        "Lumière Stellaire", "Noir", "Blanc", "Bleu", "Rouge", "Vert", "Rose",
        "Violet", "Or", "Argent", "Gris", "Crème", "Sable", "Lavande", "Minuit",
        "Corail", "Jaune", "Marine", "Phantom Black", "Phantom Green",
        "Black", "White", "Blue", "Red", "Green", "Pink", "Purple",
        "Gold", "Silver", "Grey", "Starlight", "Midnight",
    ]
    for c in couleurs:
        if c.lower() in nom.lower():
            return c
    return None


def extraire_modele(nom: str, marque: str) -> str:
    modele = nom
    patterns = [
        r'\d+\s*(Go|GB|To|TB)', r'Grade\s*[A-D]+\+?',
        r'avec\s+[Bb]oîte.*', r'sans\s+accessoires?',
        r'ASIS\+?', r'\s{2,}',
    ]
    for p in patterns:
        modele = re.sub(p, ' ', modele, flags=re.IGNORECASE)
    couleurs_rm = [
        "Titane Noir", "Titane Naturel", "Titane Bleu", "Titane Blanc",
        "Titane Désert", "Noir", "Blanc", "Bleu", "Rouge", "Vert",
        "Rose", "Violet", "Or", "Argent", "Gris", "Crème", "Sable",
        "Phantom", "Lavande", "Minuit", "Lumière Stellaire", "Corail",
        "Jaune", "Marine",
    ]
    for c in couleurs_rm:
        modele = re.sub(re.escape(c), '', modele, flags=re.IGNORECASE)
    return re.sub(r'\s+', ' ', modele).strip(' -–')


# ─── HTTP CLIENT ────────────────────────────────────

def _create_client():
    return httpx.Client(
        timeout=30,
        follow_redirects=True,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        },
    )


def login_lcdphone():
    """Se connecte. Retourne (client, error_msg)."""
    email = os.getenv("LCDPHONE_EMAIL")
    password = os.getenv("LCDPHONE_PASSWORD")
    if not email or not password:
        return None, "LCDPHONE_EMAIL ou LCDPHONE_PASSWORD non configuré"

    client = _create_client()
    try:
        login_page = client.get(LCDPHONE_LOGIN_URL)
        soup = BeautifulSoup(login_page.text, 'html.parser')

        token_input = soup.find('input', {'name': 'token'})
        token = token_input['value'] if token_input else ''

        login_data = {
            'email': email,
            'password': password,
            'back': 'my-account',
            'submitLogin': '1',
        }
        if token:
            login_data['token'] = token

        resp = client.post(LCDPHONE_LOGIN_URL, data=login_data)
        resp_text = resp.text
        url_str = str(resp.url)

        login_failed = any(w in resp_text for w in [
            "Erreur d'authentification", "Authentication failed", "Identifiants invalides"
        ])
        if login_failed:
            client.close()
            return None, "Identifiants LCD-Phone invalides"

        is_logged = (
            'mon-compte' in url_str or 'my-account' in url_str
            or 'Déconnexion' in resp_text or 'logout' in resp_text.lower()
        )

        if is_logged:
            logger.info("Connexion LCD-Phone réussie")
            return client, None

        # Vérification supplémentaire
        test = client.get(f"{LCDPHONE_BASE}/fr/mon-compte")
        if 'connexion' in str(test.url).lower() and 'mon-compte' not in str(test.url):
            client.close()
            return None, "Login redirect vers connexion"

        return client, None
    except Exception as e:
        client.close()
        return None, f"Erreur connexion: {str(e)}"


# ─── AJAX SCRAPING (PrestaShop faceted search) ──────

def _scrape_category_ajax(client, cat: dict) -> tuple:
    """
    Scrape via l'endpoint AJAX PrestaShop: ?ajax=1&action=productList
    Retourne directement les produits en JSON.
    """
    produits = []
    debug = {
        "pages": 0, "total_items": 0, "cards_parsed": 0,
        "cards_skipped_stock": 0, "errors": [],
    }

    cat_id = cat["id"]
    slug = cat["slug"]
    page = 1
    results_per_page = 36

    while True:
        debug["pages"] = page
        url = (f"{LCDPHONE_BASE}/fr/{cat_id}-{slug}"
               f"?ajax=1&action=productList&resultsPerPage={results_per_page}"
               f"&page={page}&order=product.name.asc")

        try:
            resp = client.get(url, headers={
                "X-Requested-With": "XMLHttpRequest",
                "Accept": "application/json, */*",
            })

            if resp.status_code != 200:
                debug["errors"].append(f"Page {page}: status {resp.status_code}")
                break

            data = resp.json()
            products_json = data.get("products", [])
            pagination = data.get("pagination", {})

            if page == 1:
                debug["total_items"] = pagination.get("total_items", 0)

            if not products_json:
                break

            for p in products_json:
                try:
                    if not isinstance(p, dict):
                        continue

                    nom = p.get("name", "")
                    if not nom:
                        continue

                    # Prix — utiliser price_amount (numérique)
                    prix_fournisseur = p.get("price_amount")
                    if prix_fournisseur is None:
                        # Fallback: parser le prix formaté
                        prix_text = str(p.get("price", "")).replace('\xa0', '').replace(' ', '').replace('€', '')
                        m = re.search(r'([\d]+[,.][\d]+)', prix_text)
                        if m:
                            prix_fournisseur = float(m.group(1).replace(',', '.'))
                    if prix_fournisseur is None or prix_fournisseur <= 0:
                        continue

                    prix_fournisseur = float(prix_fournisseur)

                    # Stock — vérifier availability
                    availability = p.get("availability_message", "")
                    if any(w in availability.lower() for w in ['rupture', 'indisponible', 'épuisé', 'out of stock']):
                        debug["cards_skipped_stock"] += 1
                        continue

                    stock_qty = p.get("quantity", 1) or 1

                    # Image
                    image_url = ""
                    cover = p.get("cover", {})
                    if isinstance(cover, dict):
                        image_url = cover.get("large", {}).get("url", "") or cover.get("medium", {}).get("url", "") or cover.get("url", "")

                    # URL du produit
                    product_url = p.get("url", "")

                    # Référence
                    ref = str(p.get("id_product", ""))

                    # Parser les infos depuis le nom
                    marque = cat.get("marque_forcee") or detecter_marque(nom)
                    stockage = extraire_stockage(nom)
                    grade = extraire_grade(nom) or ("Neuf" if cat["type_produit"] == "neuf" else None)
                    couleur = extraire_couleur(nom)
                    modele = extraire_modele(nom, marque)
                    type_produit = cat["type_produit"]
                    prix_vente, marge = calculer_prix_vente(prix_fournisseur, marque, type_produit)

                    produits.append({
                        "marque": marque,
                        "modele": modele,
                        "stockage": stockage,
                        "couleur": couleur,
                        "grade": grade,
                        "type_produit": type_produit,
                        "prix_fournisseur": prix_fournisseur,
                        "prix_vente": prix_vente,
                        "marge_appliquee": marge,
                        "stock_fournisseur": stock_qty,
                        "en_stock": True,
                        "reference_fournisseur": ref,
                        "das": None,
                        "image_url": image_url,
                        "source_url": product_url,
                    })
                    debug["cards_parsed"] += 1

                except Exception as e:
                    debug["errors"].append(f"Parse error: {str(e)[:100]}")

            # Pagination
            total_pages = pagination.get("pages_count", 1)
            if page >= total_pages:
                break
            page += 1
            time.sleep(0.3)

        except Exception as e:
            debug["errors"].append(f"Page {page}: {str(e)[:200]}")
            break

    return produits, debug


# ─── PROBE ──────────────────────────────────────────

def probe_lcdphone() -> dict:
    """Diagnostic complet: login + test des différentes méthodes de scraping."""
    if not _HAS_DEPS:
        return {"success": False, "error": "beautifulsoup4 ou httpx non installé"}

    client, login_err = login_lcdphone()
    if not client:
        return {"success": False, "error": login_err or "Échec login"}

    results = {"login": "OK", "categories": {}}

    try:
        for cat in CATEGORIES:
            cat_id = cat["id"]
            slug = cat["slug"]
            cat_label = f"{cat_id}-{slug}"

            # Appel AJAX qui fonctionne: ?ajax=1&action=productList
            url = f"{LCDPHONE_BASE}/fr/{cat_id}-{slug}?ajax=1&action=productList&resultsPerPage=12&page=1"
            try:
                resp = client.get(url, headers={
                    "X-Requested-With": "XMLHttpRequest",
                    "Accept": "application/json, */*",
                })
                data = resp.json()

                # Extraire les produits depuis le JSON
                products_json = data.get("products", [])
                pagination = data.get("pagination", {})

                product_samples = []
                for p in products_json[:5]:
                    if isinstance(p, dict):
                        product_samples.append({
                            "name": p.get("name", ""),
                            "price": p.get("price", ""),
                            "price_amount": p.get("price_amount"),
                            "id_product": p.get("id_product"),
                            "url": p.get("url", "")[:80],
                        })

                # Aussi parser le HTML rendu
                html = data.get("rendered_products", "")
                soup = BeautifulSoup(html, 'html.parser')
                cards = soup.select('article.product-miniature, .product-miniature')
                html_names = []
                for c in cards[:5]:
                    ne = c.select_one('.product-title a, .product-name a')
                    if ne:
                        html_names.append(ne.get_text(strip=True))

                results["categories"][cat_label] = {
                    "nb_products_json": len(products_json),
                    "nb_products_html": len(cards),
                    "pagination": {
                        "total": pagination.get("total_items"),
                        "pages": pagination.get("pages_count"),
                        "current": pagination.get("current_page"),
                    },
                    "product_samples_json": product_samples,
                    "product_names_html": html_names,
                }
            except Exception as e:
                results["categories"][cat_label] = {"error": str(e)[:200]}

            time.sleep(0.3)

    finally:
        client.close()

    results["success"] = True
    return results


# ─── SYNC PRINCIPALE ────────────────────────────────

def sync_telephones_lcdphone() -> dict:
    """Login + scrape toutes les catégories + upsert en BDD."""
    if not _HAS_DEPS:
        return {"success": False, "error": "beautifulsoup4 ou httpx non installé"}

    client, login_error = login_lcdphone()
    if not client:
        return {"success": False, "error": login_error or "Échec connexion LCD-Phone"}

    all_produits = []
    all_debug = {}

    try:
        for cat in CATEGORIES:
            cat_label = f"{cat['id']}-{cat['slug']}"
            logger.info(f"Catégorie: {cat_label}")
            produits, debug = _scrape_category_ajax(client, cat)
            logger.info(f"  -> {len(produits)} produits")
            all_produits.extend(produits)
            all_debug[cat_label] = {
                "count": len(produits),
                "pages": debug["pages"],
                "total_items": debug["total_items"],
                "cards_parsed": debug["cards_parsed"],
                "cards_skipped_stock": debug["cards_skipped_stock"],
                "errors": debug["errors"][:5],
            }
    finally:
        client.close()

    if not all_produits:
        return {
            "success": True,
            "total": 0, "inserted": 0, "updated": 0,
            "message": "Aucun produit trouvé",
            "debug": all_debug,
        }

    inserted = 0
    updated = 0

    try:
        with get_cursor() as cur:
            cur.execute("UPDATE telephones_catalogue SET actif = FALSE, updated_at = NOW()")

            for p in all_produits:
                if p["reference_fournisseur"]:
                    cur.execute(
                        "SELECT id FROM telephones_catalogue WHERE reference_fournisseur = %s",
                        (p["reference_fournisseur"],))
                else:
                    cur.execute(
                        "SELECT id FROM telephones_catalogue WHERE marque = %s AND modele = %s "
                        "AND COALESCE(stockage,'') = COALESCE(%s,'') AND COALESCE(grade,'') = COALESCE(%s,'')",
                        (p["marque"], p["modele"], p["stockage"], p["grade"]))
                existing = cur.fetchone()

                if existing:
                    cur.execute("""
                        UPDATE telephones_catalogue SET
                            prix_fournisseur=%s, prix_vente=%s, marge_appliquee=%s,
                            stock_fournisseur=%s, en_stock=TRUE,
                            image_url=%s, source_url=%s,
                            couleur=COALESCE(%s, couleur),
                            grade=COALESCE(%s, grade),
                            actif=TRUE, derniere_sync=NOW(), updated_at=NOW()
                        WHERE id=%s
                    """, (p["prix_fournisseur"], p["prix_vente"], p["marge_appliquee"],
                          p["stock_fournisseur"], p["image_url"], p["source_url"],
                          p["couleur"], p["grade"], existing["id"]))
                    updated += 1
                else:
                    cur.execute("""
                        INSERT INTO telephones_catalogue
                        (marque, modele, stockage, couleur, grade, type_produit,
                         prix_fournisseur, prix_vente, marge_appliquee,
                         stock_fournisseur, en_stock, reference_fournisseur,
                         das, garantie_mois, image_url, source_url, actif)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,TRUE,%s,%s,12,%s,%s,TRUE)
                    """, (p["marque"], p["modele"], p["stockage"], p["couleur"],
                          p["grade"], p["type_produit"],
                          p["prix_fournisseur"], p["prix_vente"], p["marge_appliquee"],
                          p["stock_fournisseur"], p["reference_fournisseur"],
                          p["das"], p["image_url"], p["source_url"]))
                    inserted += 1

        return {
            "success": True,
            "total": len(all_produits),
            "inserted": inserted,
            "updated": updated,
            "debug": all_debug,
        }
    except Exception as e:
        logger.error(f"Erreur BDD: {e}")
        return {"success": False, "error": str(e), "debug": all_debug}
