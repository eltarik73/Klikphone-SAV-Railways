"""
Scraper LCD-Phone.com — récupère les téléphones en stock avec prix B2B.
Utilise Selenium (Chrome headless) pour gérer le rendu JavaScript.
"""

import os
import re
import time
import shutil
import logging
from typing import Optional, List, Dict

from app.database import get_cursor

logger = logging.getLogger(__name__)

# ─── CONFIG ─────────────────────────────────────────
LCDPHONE_BASE = "https://lcd-phone.com"
LCDPHONE_LOGIN_URL = f"{LCDPHONE_BASE}/fr/connexion"

CATEGORIES = [
    {"url": f"{LCDPHONE_BASE}/fr/3171-iphone-occasion", "type_produit": "occasion", "marque_forcee": "Apple"},
    {"url": f"{LCDPHONE_BASE}/fr/3172-android-occasion", "type_produit": "occasion", "marque_forcee": None},
    {"url": f"{LCDPHONE_BASE}/fr/860-telephone-neuf", "type_produit": "neuf", "marque_forcee": None},
    {"url": f"{LCDPHONE_BASE}/fr/859-telephone-occasion", "type_produit": "occasion", "marque_forcee": None},
]

# Lazy import check
_HAS_SELENIUM = False
try:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.chrome.service import Service
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    _HAS_SELENIUM = True
except ImportError:
    pass


# ─── HELPERS ────────────────────────────────────────

def calculer_prix_vente(prix_fournisseur: float, marque: str, type_produit: str) -> tuple:
    """Calcule le prix de vente avec marge selon le type."""
    if type_produit == "occasion":
        marge = 80.0
    elif marque and marque.lower() in ("apple", "iphone"):
        marge = 50.0
    else:
        marge = 60.0
    return round(prix_fournisseur + marge, 2), marge


def detecter_marque(nom: str) -> str:
    """Détecte la marque depuis le nom du produit."""
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
        "Gris Sidéral", "Gris Titane", "Bleu Marine",
        "Black", "White", "Blue", "Red", "Green", "Pink", "Purple",
        "Gold", "Silver", "Grey", "Starlight", "Midnight",
    ]
    for c in couleurs:
        if c.lower() in nom.lower():
            return c
    return None


def extraire_modele(nom: str, marque: str) -> str:
    """Nettoie le nom pour extraire juste le modèle."""
    modele = nom
    patterns = [
        r'\d+\s*(Go|GB|To|TB)',
        r'Grade\s*[A-D]+\+?',
        r'avec\s+[Bb]oîte.*',
        r'sans\s+accessoires?',
        r'ASIS\+?',
        r'\s{2,}',
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


# ─── SELENIUM DRIVER ────────────────────────────────

def _find_chrome_binary() -> Optional[str]:
    """Trouve le binaire Chrome/Chromium sur le système."""
    candidates = [
        "chromium-browser", "chromium", "google-chrome-stable",
        "google-chrome", "chrome",
    ]
    for name in candidates:
        path = shutil.which(name)
        if path:
            return path
    # Chercher dans les chemins Nix courants
    nix_paths = [
        "/nix/store/*/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        "/usr/bin/google-chrome",
    ]
    import glob
    for pattern in nix_paths:
        matches = glob.glob(pattern)
        if matches:
            return matches[0]
    return None


def _find_chromedriver() -> Optional[str]:
    """Trouve chromedriver sur le système."""
    path = shutil.which("chromedriver")
    if path:
        return path
    import glob
    for pattern in ["/nix/store/*/bin/chromedriver"]:
        matches = glob.glob(pattern)
        if matches:
            return matches[0]
    return None


def create_driver():
    """Crée un driver Chrome headless."""
    if not _HAS_SELENIUM:
        raise RuntimeError("selenium non installé: pip install selenium")

    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--disable-extensions")
    options.add_argument("--disable-software-rasterizer")
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

    # Trouver Chrome/Chromium
    chrome_bin = _find_chrome_binary()
    if chrome_bin:
        options.binary_location = chrome_bin
        logger.info(f"Chrome trouvé: {chrome_bin}")

    # Trouver chromedriver
    chromedriver_path = _find_chromedriver()

    try:
        if chromedriver_path:
            service = Service(executable_path=chromedriver_path)
            logger.info(f"Chromedriver trouvé: {chromedriver_path}")
            driver = webdriver.Chrome(service=service, options=options)
        else:
            driver = webdriver.Chrome(options=options)
    except Exception as e:
        logger.error(f"Erreur création driver Chrome: {e}")
        raise RuntimeError(f"Impossible de lancer Chrome: {e}")

    driver.implicitly_wait(10)
    driver.set_page_load_timeout(30)
    return driver


# ─── LOGIN ──────────────────────────────────────────

def login_selenium(driver) -> tuple:
    """Se connecte à LCD-Phone. Retourne (success, error_msg)."""
    email = os.getenv("LCDPHONE_EMAIL")
    password = os.getenv("LCDPHONE_PASSWORD")

    if not email or not password:
        return False, "LCDPHONE_EMAIL ou LCDPHONE_PASSWORD non configuré"

    try:
        driver.get(LCDPHONE_LOGIN_URL)
        time.sleep(2)

        # Accepter les cookies si popup
        try:
            cookie_btn = driver.find_element(By.CSS_SELECTOR,
                "[class*='cookie'] button, .accept-cookie, #accept-cookie, .cc-btn")
            cookie_btn.click()
            time.sleep(1)
        except Exception:
            pass

        # Remplir le formulaire
        email_input = WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "input[name='email'], input[type='email']"))
        )
        email_input.clear()
        email_input.send_keys(email)

        password_input = driver.find_element(By.CSS_SELECTOR, "input[name='password'], input[type='password']")
        password_input.clear()
        password_input.send_keys(password)

        # Cliquer sur le bouton submit
        submit_btn = driver.find_element(By.CSS_SELECTOR,
            "button[type='submit'], #submit-login, input[name='submitLogin']")
        submit_btn.click()
        time.sleep(3)

        # Vérifier la connexion
        current_url = driver.current_url
        page_src = driver.page_source

        if any(w in current_url for w in ['mon-compte', 'my-account']):
            logger.info("Connexion LCD-Phone réussie (redirect mon-compte)")
            return True, None

        if any(w in page_src for w in ['Déconnexion', 'logout', 'sign out', 'Mon compte']):
            logger.info("Connexion LCD-Phone réussie (Déconnexion trouvé)")
            return True, None

        # Vérifier erreurs
        if any(w in page_src for w in ["Erreur d'authentification", "Authentication failed", "Identifiants invalides"]):
            return False, "Identifiants LCD-Phone invalides"

        # Test en accédant à mon-compte
        driver.get(f"{LCDPHONE_BASE}/fr/mon-compte")
        time.sleep(2)
        if 'connexion' in driver.current_url.lower() and 'mon-compte' not in driver.current_url:
            return False, "Login semble OK mais redirigé vers connexion"

        logger.info(f"Connexion LCD-Phone (URL: {driver.current_url})")
        return True, None

    except Exception as e:
        return False, f"Erreur connexion: {str(e)}"


# ─── SCRAPER UNE CATÉGORIE ──────────────────────────

def scraper_categorie_selenium(driver, cat: dict) -> tuple:
    """Scrape une catégorie. Retourne (produits, debug_info)."""
    produits = []
    debug = {
        "pages": 0, "cards_found": 0, "cards_parsed": 0,
        "cards_skipped_stock": 0, "cards_no_name": 0,
        "cards_no_price": 0, "errors": [],
    }
    page = 1
    max_pages = 20

    while page <= max_pages:
        url = f"{cat['url']}?page={page}"
        logger.info(f"Scraping page {page}: {url}")
        debug["pages"] = page

        try:
            driver.get(url)
            time.sleep(3)

            # Scroll pour déclencher le lazy loading
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(1)
            driver.execute_script("window.scrollTo(0, 0);")
            time.sleep(1)

            # Chercher les cartes produit
            cards = driver.find_elements(By.CSS_SELECTOR,
                ".product-miniature, article.product-miniature, "
                ".products .product, [data-id-product]"
            )

            if not cards:
                if page == 1:
                    debug["errors"].append("Aucun produit trouvé page 1")
                    # Sauvegarder un extrait du titre pour debug
                    debug["page_title"] = driver.title
                break

            debug["cards_found"] += len(cards)

            for card in cards:
                try:
                    # ── Nom et lien ──
                    try:
                        name_el = card.find_element(By.CSS_SELECTOR,
                            ".product-title a, .product-name a, h2 a, h3 a, h5 a")
                    except Exception:
                        debug["cards_no_name"] += 1
                        continue

                    nom = name_el.text.strip()
                    if not nom:
                        nom = name_el.get_attribute("title") or ""
                    product_url = name_el.get_attribute("href") or ""

                    if not nom:
                        debug["cards_no_name"] += 1
                        continue

                    # ── Prix ──
                    try:
                        price_el = card.find_element(By.CSS_SELECTOR,
                            ".product-price-and-shipping .price, .product-price .price, "
                            ".price, [itemprop='price']")
                        prix_text = price_el.text.strip()
                    except Exception:
                        debug["cards_no_price"] += 1
                        continue

                    # Parser le prix (format: "199,90 €" ou "1 299,00 €")
                    prix_clean = prix_text.replace('\xa0', '').replace(' ', '').replace('€', '')
                    prix_match = re.search(r'([\d]+[,.][\d]+)', prix_clean)
                    if not prix_match:
                        debug["cards_no_price"] += 1
                        continue
                    prix_fournisseur = float(prix_match.group(1).replace(',', '.'))

                    # ── Stock ──
                    stock_qty = 0
                    try:
                        stock_el = card.find_element(By.CSS_SELECTOR,
                            ".product-availability, .availability, .stock-quantity, .stock")
                        stock_text = stock_el.text.strip()

                        # Rupture de stock → skip
                        if any(w in stock_text.lower() for w in ['rupture', 'indisponible', 'épuisé', 'out of stock']):
                            debug["cards_skipped_stock"] += 1
                            continue

                        stock_match = re.search(r'(\d+)', stock_text)
                        if stock_match:
                            stock_qty = int(stock_match.group(1))
                        elif 'en stock' in stock_text.lower():
                            stock_qty = 1
                    except Exception:
                        # Pas d'élément stock visible → on considère en stock si sur la page
                        stock_qty = 1

                    # Si stock explicitement 0, skip
                    if stock_qty == 0:
                        debug["cards_skipped_stock"] += 1
                        continue

                    # ── Image ──
                    image_url = ""
                    try:
                        img_el = card.find_element(By.CSS_SELECTOR, "img")
                        image_url = (img_el.get_attribute("data-full-size-image-url")
                                     or img_el.get_attribute("src")
                                     or img_el.get_attribute("data-src") or "")
                    except Exception:
                        pass

                    # ── Référence ──
                    ref = ""
                    try:
                        ref = card.get_attribute("data-id-product") or ""
                    except Exception:
                        pass

                    # ── Parser les infos depuis le nom ──
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
                    logger.info(f"  + {marque} {modele} {stockage} {grade} — {prix_vente}€")

                except Exception as e:
                    debug["errors"].append(f"Erreur parsing carte: {str(e)[:100]}")
                    continue

            # Page suivante ?
            try:
                next_btn = driver.find_element(By.CSS_SELECTOR,
                    "a.next, .pagination .next a, li.next a, a[rel='next']")
                if next_btn and next_btn.is_displayed():
                    page += 1
                else:
                    break
            except Exception:
                break

        except Exception as e:
            debug["errors"].append(f"Erreur page {page}: {str(e)[:200]}")
            break

    return produits, debug


# ─── PROBE (DIAGNOSTIC) ────────────────────────────

def probe_lcdphone() -> dict:
    """Diagnostic : teste login + affiche les produits trouvés par catégorie."""
    if not _HAS_SELENIUM:
        return {"success": False, "error": "selenium non installé: pip install selenium"}

    driver = None
    try:
        driver = create_driver()
        ok, err = login_selenium(driver)
        if not ok:
            return {"success": False, "error": err or "Échec login"}

        results = {}
        for cat in CATEGORIES:
            driver.get(cat["url"])
            time.sleep(3)

            # Scroll pour lazy loading
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(1)

            cards = driver.find_elements(By.CSS_SELECTOR,
                ".product-miniature, article.product-miniature")

            samples = []
            for card in cards[:8]:
                try:
                    name_el = card.find_element(By.CSS_SELECTOR,
                        ".product-title a, .product-name a, h2 a")
                    name = name_el.text.strip() or name_el.get_attribute("title") or ""
                    price = ""
                    try:
                        price_el = card.find_element(By.CSS_SELECTOR, ".price")
                        price = price_el.text.strip()
                    except Exception:
                        pass
                    if name:
                        samples.append(f"{name} — {price}")
                except Exception:
                    pass

            results[cat["url"]] = {
                "type": cat["type_produit"],
                "total_cards": len(cards),
                "page_title": driver.title,
                "samples": samples,
            }

        return {"success": True, "login": "OK", "categories": results}

    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass


# ─── SYNC PRINCIPALE ────────────────────────────────

def sync_telephones_lcdphone() -> dict:
    """Login + scrape toutes les catégories + upsert en BDD."""
    if not _HAS_SELENIUM:
        return {"success": False, "error": "selenium non installé: pip install selenium"}

    driver = None
    try:
        logger.info("Démarrage sync LCD-Phone (Selenium)")
        driver = create_driver()

        ok, err = login_selenium(driver)
        if not ok:
            return {"success": False, "error": err or "Échec connexion LCD-Phone"}

        all_produits = []
        all_debug = {}

        for cat in CATEGORIES:
            cat_label = cat["url"].split("/")[-1]
            logger.info(f"Catégorie: {cat_label}")
            produits, debug = scraper_categorie_selenium(driver, cat)
            logger.info(f"  -> {len(produits)} produits en stock")
            all_produits.extend(produits)
            all_debug[cat_label] = {
                "count": len(produits),
                "pages": debug["pages"],
                "cards_found": debug["cards_found"],
                "cards_parsed": debug["cards_parsed"],
                "cards_skipped_stock": debug["cards_skipped_stock"],
                "cards_no_name": debug["cards_no_name"],
                "cards_no_price": debug["cards_no_price"],
                "errors": debug["errors"][:5],
            }

        logger.info(f"Total: {len(all_produits)} produits")

        if not all_produits:
            return {
                "success": True,
                "total": 0, "inserted": 0, "updated": 0,
                "message": "Aucun produit trouvé",
                "debug": all_debug,
            }

        # Upsert en BDD
        inserted = 0
        updated = 0

        try:
            with get_cursor() as cur:
                # Marquer tous inactifs
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

    except Exception as e:
        logger.error(f"Erreur sync: {e}")
        return {"success": False, "error": str(e)}
    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass
