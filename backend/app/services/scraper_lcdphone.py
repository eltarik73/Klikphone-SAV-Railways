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

import httpx
from bs4 import BeautifulSoup

from app.database import get_cursor

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


def login_lcdphone():
    """Se connecte à LCD-Phone et retourne un client httpx authentifié."""
    email = os.getenv("LCDPHONE_EMAIL")
    password = os.getenv("LCDPHONE_PASSWORD")
    if not email or not password:
        logger.error("LCDPHONE_EMAIL ou LCDPHONE_PASSWORD non configuré")
        return None

    client = httpx.Client(
        timeout=20,
        follow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"},
    )
    try:
        login_page = client.get(LCDPHONE_LOGIN_URL)
        soup = BeautifulSoup(login_page.text, 'html.parser')
        token_input = soup.find('input', {'name': 'token'})
        token = token_input['value'] if token_input else ''

        resp = client.post(LCDPHONE_LOGIN_URL, data={
            'email': email,
            'password': password,
            'back': 'my-account',
            'submitLogin': '1',
            'token': token,
        })

        if 'mon-compte' in str(resp.url) or 'my-account' in str(resp.url) or resp.status_code == 200:
            logger.info("Connexion LCD-Phone réussie")
            return client
        else:
            logger.error("Échec connexion LCD-Phone")
            client.close()
            return None
    except Exception as e:
        logger.error(f"Erreur connexion LCD-Phone: {e}")
        client.close()
        return None


def scraper_categorie(client, cat_config: dict) -> list:
    produits = []
    page = 1

    while True:
        url = f"{cat_config['url']}?page={page}"
        logger.info(f"Scraping page {page}: {url}")
        try:
            resp = client.get(url)
            soup = BeautifulSoup(resp.text, 'html.parser')

            cards = (
                soup.select('.product-miniature')
                or soup.select('article.product-miniature')
                or soup.select('.products .product')
                or soup.select('.product_list > li')
            )
            if not cards:
                break

            for card in cards:
                try:
                    # Stock check
                    stock_el = card.select_one('.product-availability, .availability, .stock')
                    stock_text = stock_el.get_text(strip=True) if stock_el else ""
                    stock_match = re.search(r'(\d+)\s*[Ee]n\s*stock', stock_text)
                    stock_qty = int(stock_match.group(1)) if stock_match else 0
                    if stock_qty == 0 and "en stock" not in stock_text.lower():
                        continue

                    # Name + URL
                    name_el = card.select_one('.product-title a, .product_name a, h2 a, .product-name a')
                    if not name_el:
                        continue
                    nom = name_el.get_text(strip=True)
                    product_url = name_el.get('href', '')

                    # Price
                    price_el = card.select_one('.product-price, .price, [itemprop="price"]')
                    if not price_el:
                        continue
                    prix_text = price_el.get_text(strip=True).replace('\xa0', '').replace(' ', '')
                    prix_match = re.search(r'([\d]+[,.][\d]+)', prix_text)
                    if not prix_match:
                        continue
                    prix_fournisseur = float(prix_match.group(1).replace(',', '.'))

                    # Product page details
                    fiche_marque = fiche_grade = fiche_stockage = fiche_couleur = fiche_das = fiche_image = None
                    fiche_ref = ""

                    if product_url:
                        time.sleep(0.5)
                        try:
                            fiche = client.get(product_url)
                            fs = BeautifulSoup(fiche.text, 'html.parser')
                            features = fs.select('.product-features li, .data-sheet tr, .product-information .feature-value')
                            for feat in features:
                                ft = feat.get_text(strip=True).lower()
                                val_el = feat.select_one('span:last-child, td:last-child, .value')
                                val = val_el.get_text(strip=True) if val_el else ""
                                if 'marque' in ft or 'fabricant' in ft:
                                    fiche_marque = val
                                if 'grade' in ft or 'état' in ft:
                                    fiche_grade = val
                                if 'stockage' in ft or 'capacité' in ft or 'mémoire' in ft:
                                    fiche_stockage = val
                                if 'couleur' in ft or 'color' in ft:
                                    fiche_couleur = val
                                if 'das' in ft:
                                    fiche_das = val
                            ref_el = fs.select_one('.product-reference span, [itemprop="sku"]')
                            if ref_el:
                                fiche_ref = ref_el.get_text(strip=True)
                            img_el = fs.select_one('.product-cover img, .product-image img, #content img.js-qv-product-cover')
                            if img_el:
                                fiche_image = img_el.get('src', '') or img_el.get('data-src', '')
                        except Exception as e:
                            logger.warning(f"Erreur fiche {product_url}: {e}")

                    marque = fiche_marque or cat_config.get('marque_forcee') or detecter_marque(nom)
                    stockage = fiche_stockage or extraire_stockage(nom)
                    couleur = fiche_couleur or extraire_couleur(nom)
                    grade = fiche_grade or extraire_grade(nom) or ("Neuf" if cat_config['type_produit'] == "neuf" else None)
                    modele = extraire_modele(nom, marque)
                    type_produit = cat_config['type_produit']
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
                        "reference_fournisseur": fiche_ref,
                        "das": fiche_das,
                        "image_url": fiche_image or "",
                        "source_url": product_url,
                    })
                    logger.info(f"  + {marque} {modele} {stockage} — {prix_vente}€")
                except Exception as e:
                    logger.warning(f"Erreur parsing produit: {e}")
                    continue

            next_page = soup.select_one('a.next, .pagination .next a, li.next a')
            if not next_page:
                break
            page += 1
        except Exception as e:
            logger.error(f"Erreur scraping page {page}: {e}")
            break

    return produits


def sync_telephones_lcdphone() -> dict:
    """Login + scrape toutes les catégories + upsert en BDD."""
    client = login_lcdphone()
    if not client:
        return {"success": False, "error": "Échec connexion LCD-Phone. Vérifiez LCDPHONE_EMAIL et LCDPHONE_PASSWORD."}

    all_produits = []
    try:
        for cat_name, cat_config in CATEGORIES.items():
            logger.info(f"Scraping catégorie: {cat_name}")
            produits = scraper_categorie(client, cat_config)
            logger.info(f"  -> {len(produits)} produits")
            all_produits.extend(produits)
    finally:
        client.close()

    if not all_produits:
        return {"success": True, "total": 0, "inserted": 0, "updated": 0, "message": "Aucun produit en stock trouvé"}

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

        return {"success": True, "total": len(all_produits), "inserted": inserted, "updated": updated}
    except Exception as e:
        logger.error(f"Erreur BDD: {e}")
        return {"success": False, "error": str(e)}
