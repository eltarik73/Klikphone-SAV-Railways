"""
Scraper LCD-Phone.com — récupère les téléphones en stock avec prix B2B.
Site PrestaShop, nécessite login pro.
"""

import os
import re
import time
import logging
from datetime import datetime
from typing import Optional

from app.database import get_cursor

# Lazy imports pour éviter crash si beautifulsoup4 pas installé
try:
    import httpx
    from bs4 import BeautifulSoup
    _HAS_DEPS = True
except ImportError:
    _HAS_DEPS = False

logger = logging.getLogger(__name__)

LCDPHONE_BASE_URL = "https://lcd-phone.com"
LCDPHONE_LOGIN_URL = f"{LCDPHONE_BASE_URL}/fr/connexion"

CATEGORIES = {
    "iphone_occasion": {
        "url": f"{LCDPHONE_BASE_URL}/fr/3171-iphone-occasion",
        "type_produit": "reconditionné",
        "marque_forcee": "Apple",
    },
    "android_occasion": {
        "url": f"{LCDPHONE_BASE_URL}/fr/3172-android-occasion",
        "type_produit": "reconditionné",
        "marque_forcee": None,
    },
    "telephone_neuf": {
        "url": f"{LCDPHONE_BASE_URL}/fr/860-telephone-neuf",
        "type_produit": "neuf",
        "marque_forcee": None,
    },
}


def calculer_prix_vente(prix_fournisseur: float, marque: str, type_produit: str) -> tuple:
    if type_produit == "reconditionné":
        marge = 80.0
    elif marque.lower() in ("apple", "iphone"):
        marge = 50.0
    else:
        marge = 60.0
    return prix_fournisseur + marge, marge


def detecter_marque(nom_produit: str) -> str:
    nom_lower = nom_produit.lower()
    marques = {
        "iphone": "Apple", "apple": "Apple",
        "samsung": "Samsung", "galaxy": "Samsung",
        "xiaomi": "Xiaomi", "redmi": "Xiaomi", "poco": "Xiaomi",
        "google": "Google", "pixel": "Google",
        "huawei": "Huawei", "honor": "Honor",
        "oppo": "Oppo", "oneplus": "OnePlus",
        "motorola": "Motorola", "nothing": "Nothing", "realme": "Realme",
    }
    for keyword, marque in marques.items():
        if keyword in nom_lower:
            return marque
    return "Autre"


def extraire_stockage(nom: str) -> Optional[str]:
    m = re.search(r'(\d+)\s*(Go|GB|To|TB)', nom, re.IGNORECASE)
    if m:
        return f"{m.group(1)} {m.group(2).upper().replace('GB','Go').replace('TB','To')}"
    return None


def extraire_couleur(nom: str) -> Optional[str]:
    couleurs = [
        "Titane Noir", "Titane Naturel", "Titane Bleu", "Titane Blanc", "Titane Désert",
        "Lumière Stellaire", "Noir", "Blanc", "Bleu", "Rouge", "Vert", "Rose",
        "Violet", "Or", "Argent", "Gris", "Crème", "Sable", "Lavande", "Minuit",
        "Black", "White", "Blue", "Red", "Green", "Pink", "Purple",
        "Gold", "Silver", "Grey", "Phantom", "Starlight", "Midnight",
    ]
    for c in couleurs:
        if c.lower() in nom.lower():
            return c
    return None


def extraire_grade(nom: str) -> Optional[str]:
    m = re.search(r'Grade\s*([A-C]\+?)', nom, re.IGNORECASE)
    if m:
        return f"Grade {m.group(1).upper()}"
    if "neuf" in nom.lower() or "blister" in nom.lower():
        return "Neuf"
    return None


def extraire_modele(nom: str, marque: str) -> str:
    modele = nom
    patterns = [
        r'\d+\s*(Go|GB|To|TB)',
        r'Grade\s*[A-C]\+?',
        r'avec\s+[Bb]oîte.*',
        r'sans\s+accessoires?',
        r'\s{2,}',
    ]
    for p in patterns:
        modele = re.sub(p, ' ', modele, flags=re.IGNORECASE)
    couleurs_rm = [
        "Titane Noir", "Titane Naturel", "Titane Bleu", "Titane Blanc",
        "Titane Désert", "Noir", "Blanc", "Bleu", "Rouge", "Vert",
        "Rose", "Violet", "Or", "Argent", "Gris", "Crème", "Sable",
        "Phantom", "Lavande", "Minuit", "Lumière Stellaire",
    ]
    for c in couleurs_rm:
        modele = re.sub(re.escape(c), '', modele, flags=re.IGNORECASE)
    return modele.strip().strip('-').strip()


def _create_client():
    """Crée un client HTTP avec headers navigateur."""
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
    """Se connecte à LCD-Phone et retourne un client httpx authentifié."""
    email = os.getenv("LCDPHONE_EMAIL")
    password = os.getenv("LCDPHONE_PASSWORD")
    if not email or not password:
        logger.error("LCDPHONE_EMAIL ou LCDPHONE_PASSWORD non configuré")
        return None, "LCDPHONE_EMAIL ou LCDPHONE_PASSWORD non configuré"

    client = _create_client()
    try:
        # Charger la page de login
        login_page = client.get(LCDPHONE_LOGIN_URL)
        soup = BeautifulSoup(login_page.text, 'html.parser')

        # Chercher le formulaire de login
        form = soup.find('form', id='login-form') or soup.find('form', {'class': 'login-form'})
        if not form:
            # Chercher tout formulaire avec un champ email
            forms = soup.find_all('form')
            for f in forms:
                if f.find('input', {'name': 'email'}) or f.find('input', {'type': 'email'}):
                    form = f
                    break

        # Token CSRF
        token_input = soup.find('input', {'name': 'token'})
        token = token_input['value'] if token_input else ''

        # Envoyer le login
        login_data = {
            'email': email,
            'password': password,
            'back': 'my-account',
            'submitLogin': '1',
        }
        if token:
            login_data['token'] = token

        resp = client.post(LCDPHONE_LOGIN_URL, data=login_data)

        # Vérifier si on est connecté en cherchant des indices
        resp_text = resp.text
        url_str = str(resp.url)

        # Signes positifs de connexion
        is_logged = (
            'mon-compte' in url_str
            or 'my-account' in url_str
            or 'Déconnexion' in resp_text
            or 'logout' in resp_text.lower()
            or 'sign out' in resp_text.lower()
        )

        # Signes négatifs
        login_failed = (
            'Erreur d\'authentification' in resp_text
            or 'Authentication failed' in resp_text
            or 'Identifiants invalides' in resp_text
            or 'Invalid credentials' in resp_text
        )

        if login_failed:
            client.close()
            return None, "Identifiants LCD-Phone invalides"

        if is_logged or resp.status_code == 200:
            # Vérifier en accédant à une page protégée
            test = client.get(f"{LCDPHONE_BASE_URL}/fr/mon-compte")
            if 'connexion' in str(test.url).lower() and 'mon-compte' not in str(test.url):
                client.close()
                return None, "Login semble OK mais redirection vers connexion"
            logger.info("Connexion LCD-Phone réussie")
            return client, None
        else:
            client.close()
            return None, f"Échec connexion (status {resp.status_code})"

    except Exception as e:
        client.close()
        return None, f"Erreur connexion: {str(e)}"


def scraper_categorie(client, cat_config: dict) -> tuple:
    """Scrape une catégorie. Retourne (produits, debug_info)."""
    produits = []
    debug = {"pages": 0, "cards_found": 0, "cards_skipped_stock": 0, "cards_no_name": 0, "cards_no_price": 0, "errors": []}
    page = 1
    max_pages = 20  # sécurité

    while page <= max_pages:
        url = f"{cat_config['url']}?page={page}"
        logger.info(f"Scraping page {page}: {url}")
        debug["pages"] = page
        try:
            resp = client.get(url)
            soup = BeautifulSoup(resp.text, 'html.parser')

            # Essayer plusieurs sélecteurs pour trouver les produits
            cards = soup.select('.product-miniature')
            if not cards:
                cards = soup.select('article.product-miniature')
            if not cards:
                cards = soup.select('.products article')
            if not cards:
                cards = soup.select('.product_list .ajax_block_product')
            if not cards:
                cards = soup.select('[data-id-product]')
            if not cards:
                # Dernier recours: chercher tous les éléments avec un lien produit
                cards = soup.select('.products > div, .products > article, .products > li')

            if not cards:
                if page == 1:
                    # Sauver un extrait du HTML pour debug
                    body = soup.find('body')
                    if body:
                        debug["html_sample"] = str(body)[:2000]
                    debug["errors"].append(f"Aucune carte produit trouvée sur page 1. Classes trouvées: {[c.get('class') for c in soup.select('div[class]')[:10]]}")
                break

            debug["cards_found"] += len(cards)

            for card in cards:
                try:
                    # Nom du produit — essayer plusieurs sélecteurs
                    name_el = (
                        card.select_one('.product-title a')
                        or card.select_one('.product-name a')
                        or card.select_one('h5 a, h4 a, h3 a, h2 a')
                        or card.select_one('a.product-thumbnail')
                        or card.select_one('a[href*="/fr/"]')
                    )
                    if not name_el:
                        debug["cards_no_name"] += 1
                        continue
                    nom = name_el.get_text(strip=True) or name_el.get('title', '')
                    product_url = name_el.get('href', '')
                    if not nom and product_url:
                        # Essayer le titre du lien
                        nom = name_el.get('title', '') or product_url.split('/')[-1].replace('-', ' ')
                    if not nom:
                        debug["cards_no_name"] += 1
                        continue

                    # Prix — essayer plusieurs sélecteurs
                    price_el = (
                        card.select_one('.product-price-and-shipping .price')
                        or card.select_one('.product-price .price')
                        or card.select_one('.price')
                        or card.select_one('[itemprop="price"]')
                        or card.select_one('.product-price')
                    )
                    prix_fournisseur = None
                    if price_el:
                        # Essayer l'attribut content d'abord (plus fiable)
                        prix_content = price_el.get('content', '')
                        if prix_content:
                            try:
                                prix_fournisseur = float(prix_content)
                            except ValueError:
                                pass

                        if prix_fournisseur is None:
                            prix_text = price_el.get_text(strip=True).replace('\xa0', '').replace(' ', '').replace('€', '')
                            prix_match = re.search(r'([\d]+[,.][\d]+)', prix_text)
                            if prix_match:
                                prix_fournisseur = float(prix_match.group(1).replace(',', '.'))

                    if prix_fournisseur is None:
                        debug["cards_no_price"] += 1
                        continue

                    # Stock — ne PAS filtrer trop agressivement, on prend tout ce qu'on trouve
                    stock_qty = 1  # défaut: en stock si on le voit sur la page
                    stock_el = card.select_one('.product-availability, .availability, .stock-quantity')
                    if stock_el:
                        stock_text = stock_el.get_text(strip=True)
                        stock_match = re.search(r'(\d+)', stock_text)
                        if stock_match:
                            stock_qty = int(stock_match.group(1))
                        if any(w in stock_text.lower() for w in ['rupture', 'indisponible', 'épuisé', 'out of stock']):
                            debug["cards_skipped_stock"] += 1
                            continue

                    # Extraire les infos depuis le nom du produit
                    marque = cat_config.get('marque_forcee') or detecter_marque(nom)
                    stockage = extraire_stockage(nom)
                    couleur = extraire_couleur(nom)
                    grade = extraire_grade(nom) or ("Neuf" if cat_config['type_produit'] == "neuf" else None)
                    modele = extraire_modele(nom, marque)
                    type_produit = cat_config['type_produit']
                    prix_vente, marge = calculer_prix_vente(prix_fournisseur, marque, type_produit)

                    # Image depuis le listing
                    img_el = card.select_one('img.thumbnail, img[src*="phone"], img[data-src], img')
                    image_url = ""
                    if img_el:
                        image_url = img_el.get('data-full-size-image-url', '') or img_el.get('src', '') or img_el.get('data-src', '')

                    # Référence (data attribute)
                    ref = card.get('data-id-product', '') or ''

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
                    logger.info(f"  + {marque} {modele} {stockage} — {prix_vente}€")
                except Exception as e:
                    debug["errors"].append(f"Erreur parsing: {str(e)}")
                    continue

            # Pagination
            next_link = (
                soup.select_one('a[rel="next"]')
                or soup.select_one('.pagination .next a')
                or soup.select_one('li.next a')
                or soup.select_one('a.next')
            )
            if not next_link:
                break
            page += 1

        except Exception as e:
            debug["errors"].append(f"Erreur page {page}: {str(e)}")
            break

    return produits, debug


def probe_lcdphone() -> dict:
    """Endpoint de diagnostic — teste le login et découvre la structure du site."""
    if not _HAS_DEPS:
        return {"success": False, "error": "beautifulsoup4 ou httpx non installé"}

    result = {"login": None, "navigation": [], "categories_test": {}}

    client, login_error = login_lcdphone()
    if not client:
        return {"success": False, "error": login_error or "Échec login"}

    result["login"] = "OK"

    try:
        # 1) Découvrir la navigation du site
        home = client.get(f"{LCDPHONE_BASE_URL}/fr/")
        soup_home = BeautifulSoup(home.text, 'html.parser')

        # Chercher les liens de navigation/menu
        nav_links = []
        for selector in [
            '#_desktop_top_menu a', '.top-menu a', '#top-menu a',
            '.menu a', 'nav a', '.category-top-menu a',
            '#header a[href*="/fr/"]', '.header a[href*="/fr/"]',
        ]:
            links = soup_home.select(selector)
            if links:
                for a in links:
                    href = a.get('href', '')
                    text = a.get_text(strip=True)
                    if href and '/fr/' in href and text and len(text) < 60:
                        nav_links.append({"text": text, "url": href})
                if nav_links:
                    break

        # Si rien trouvé, essayer tous les liens avec /fr/ et un numéro de catégorie
        if not nav_links:
            for a in soup_home.select('a[href*="/fr/"]'):
                href = a.get('href', '')
                text = a.get_text(strip=True)
                if re.search(r'/fr/\d+-', href) and text and len(text) < 60:
                    nav_links.append({"text": text, "url": href})

        # Deduplicate
        seen = set()
        unique_links = []
        for link in nav_links:
            if link["url"] not in seen:
                seen.add(link["url"])
                unique_links.append(link)
        result["navigation"] = unique_links[:50]

        # 2) Chercher des liens contenant "phone", "smartphone", "telephone", "iphone", "occasion"
        phone_links = [l for l in unique_links if any(
            w in l["text"].lower() or w in l["url"].lower()
            for w in ["phone", "smartphone", "téléphone", "telephone", "iphone", "occasion", "reconditionn", "neuf"]
        )]
        result["phone_links"] = phone_links

        # 3) Tester les catégories actuelles + les phone_links trouvés
        test_urls = {}
        for cat_name, cat_config in CATEGORIES.items():
            test_urls[cat_name] = cat_config['url']
        for i, pl in enumerate(phone_links[:5]):
            test_urls[f"discovered_{i}"] = pl["url"]

        for name, url in test_urls.items():
            resp = client.get(url)
            soup = BeautifulSoup(resp.text, 'html.parser')

            cards = soup.select('article.product-miniature')
            product_names = []
            for card in cards[:8]:
                name_el = card.select_one('.product-name a, .product-name')
                if name_el:
                    product_names.append(name_el.get_text(strip=True) or name_el.get('title', ''))

            result["categories_test"][name] = {
                "url": url,
                "final_url": str(resp.url),
                "status": resp.status_code,
                "title": soup.title.string.strip() if soup.title and soup.title.string else None,
                "nb_products": len(cards),
                "product_names": product_names,
            }
            time.sleep(0.3)
    finally:
        client.close()

    result["success"] = True
    return result


def sync_telephones_lcdphone() -> dict:
    """Login + scrape toutes les catégories + upsert en BDD."""
    if not _HAS_DEPS:
        return {"success": False, "error": "Dépendances manquantes: pip install beautifulsoup4 httpx"}

    client, login_error = login_lcdphone()
    if not client:
        return {"success": False, "error": login_error or "Échec connexion LCD-Phone"}

    all_produits = []
    all_debug = {}
    try:
        for cat_name, cat_config in CATEGORIES.items():
            logger.info(f"Scraping catégorie: {cat_name}")
            produits, debug = scraper_categorie(client, cat_config)
            logger.info(f"  -> {len(produits)} produits")
            all_produits.extend(produits)
            all_debug[cat_name] = {
                "count": len(produits),
                "pages": debug["pages"],
                "cards_found": debug["cards_found"],
                "cards_skipped_stock": debug["cards_skipped_stock"],
                "cards_no_name": debug["cards_no_name"],
                "cards_no_price": debug["cards_no_price"],
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
                    cur.execute("SELECT id FROM telephones_catalogue WHERE reference_fournisseur = %s", (p["reference_fournisseur"],))
                else:
                    cur.execute(
                        "SELECT id FROM telephones_catalogue WHERE marque = %s AND modele = %s AND COALESCE(stockage,'') = COALESCE(%s,'') AND COALESCE(grade,'') = COALESCE(%s,'')",
                        (p["marque"], p["modele"], p["stockage"], p["grade"]),
                    )
                existing = cur.fetchone()

                if existing:
                    cur.execute("""
                        UPDATE telephones_catalogue SET
                            prix_fournisseur=%s, prix_vente=%s, marge_appliquee=%s,
                            stock_fournisseur=%s, en_stock=%s, image_url=%s, source_url=%s,
                            actif=TRUE, derniere_sync=NOW(), updated_at=NOW()
                        WHERE id=%s
                    """, (p["prix_fournisseur"], p["prix_vente"], p["marge_appliquee"],
                          p["stock_fournisseur"], p["en_stock"], p["image_url"], p["source_url"],
                          existing["id"]))
                    updated += 1
                else:
                    cur.execute("""
                        INSERT INTO telephones_catalogue
                        (marque, modele, stockage, couleur, grade, type_produit,
                         prix_fournisseur, prix_vente, marge_appliquee,
                         stock_fournisseur, en_stock, reference_fournisseur,
                         das, garantie_mois, image_url, source_url, actif)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,12,%s,%s,TRUE)
                    """, (p["marque"], p["modele"], p["stockage"], p["couleur"],
                          p["grade"], p["type_produit"],
                          p["prix_fournisseur"], p["prix_vente"], p["marge_appliquee"],
                          p["stock_fournisseur"], p["en_stock"], p["reference_fournisseur"],
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
