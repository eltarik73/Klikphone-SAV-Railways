"""
Script d'import des tarifs reparation KLIKPHONE.
Prix fournisseur HT bases sur les tarifs Mobilax/marche francais 2024-2025.
Le calcul prix client est fait automatiquement par le backend.

Usage: python import_tarifs.py
"""

import math
import os
import sys

import httpx

API_URL = os.environ.get("API_URL", "https://klikphone-sav-v2-production.up.railway.app")

# ─── TARIFS FOURNISSEUR HT ───────────────────────────────────
# Structure: (marque, modele, type_piece, qualite, nom_fournisseur, prix_ht, categorie)
TARIFS = [
    # ══════════════════════════════════════════════════════════
    #  APPLE iPHONE — ECRANS
    # ══════════════════════════════════════════════════════════

    # iPhone 16 Pro Max
    ("Apple", "iPhone 16 Pro Max", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone 16 Pro Max", 195.00, "haut_de_gamme"),
    ("Apple", "iPhone 16 Pro Max", "Ecran", "OLED", "Ecran Hard OLED iPhone 16 Pro Max", 165.00, "haut_de_gamme"),
    ("Apple", "iPhone 16 Pro Max", "Ecran", "Incell", "Ecran Incell iPhone 16 Pro Max", 120.00, "haut_de_gamme"),

    # iPhone 16 Pro
    ("Apple", "iPhone 16 Pro", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone 16 Pro", 175.00, "haut_de_gamme"),
    ("Apple", "iPhone 16 Pro", "Ecran", "OLED", "Ecran Hard OLED iPhone 16 Pro", 145.00, "haut_de_gamme"),
    ("Apple", "iPhone 16 Pro", "Ecran", "Incell", "Ecran Incell iPhone 16 Pro", 105.00, "haut_de_gamme"),

    # iPhone 16 Plus
    ("Apple", "iPhone 16 Plus", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone 16 Plus", 145.00, "haut_de_gamme"),
    ("Apple", "iPhone 16 Plus", "Ecran", "OLED", "Ecran Hard OLED iPhone 16 Plus", 115.00, "haut_de_gamme"),
    ("Apple", "iPhone 16 Plus", "Ecran", "Incell", "Ecran Incell iPhone 16 Plus", 85.00, "haut_de_gamme"),

    # iPhone 16
    ("Apple", "iPhone 16", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone 16", 125.00, "haut_de_gamme"),
    ("Apple", "iPhone 16", "Ecran", "OLED", "Ecran Hard OLED iPhone 16", 100.00, "haut_de_gamme"),
    ("Apple", "iPhone 16", "Ecran", "Incell", "Ecran Incell iPhone 16", 72.00, "haut_de_gamme"),

    # iPhone 15 Pro Max
    ("Apple", "iPhone 15 Pro Max", "Ecran", "Original", "Ecran Original iPhone 15 Pro Max", 280.00, "haut_de_gamme"),
    ("Apple", "iPhone 15 Pro Max", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone 15 Pro Max", 170.00, "haut_de_gamme"),
    ("Apple", "iPhone 15 Pro Max", "Ecran", "OLED", "Ecran Hard OLED iPhone 15 Pro Max", 135.00, "haut_de_gamme"),
    ("Apple", "iPhone 15 Pro Max", "Ecran", "Incell", "Ecran Incell iPhone 15 Pro Max", 95.00, "haut_de_gamme"),

    # iPhone 15 Pro
    ("Apple", "iPhone 15 Pro", "Ecran", "Original", "Ecran Original iPhone 15 Pro", 250.00, "haut_de_gamme"),
    ("Apple", "iPhone 15 Pro", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone 15 Pro", 145.00, "haut_de_gamme"),
    ("Apple", "iPhone 15 Pro", "Ecran", "OLED", "Ecran Hard OLED iPhone 15 Pro", 110.00, "haut_de_gamme"),
    ("Apple", "iPhone 15 Pro", "Ecran", "Incell", "Ecran Incell iPhone 15 Pro", 80.00, "haut_de_gamme"),

    # iPhone 15 Plus
    ("Apple", "iPhone 15 Plus", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone 15 Plus", 115.00, "haut_de_gamme"),
    ("Apple", "iPhone 15 Plus", "Ecran", "OLED", "Ecran Hard OLED iPhone 15 Plus", 90.00, "haut_de_gamme"),
    ("Apple", "iPhone 15 Plus", "Ecran", "Incell", "Ecran Incell iPhone 15 Plus", 65.00, "haut_de_gamme"),

    # iPhone 15
    ("Apple", "iPhone 15", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone 15", 100.00, "haut_de_gamme"),
    ("Apple", "iPhone 15", "Ecran", "OLED", "Ecran Hard OLED iPhone 15", 78.00, "haut_de_gamme"),
    ("Apple", "iPhone 15", "Ecran", "Incell", "Ecran Incell iPhone 15", 55.00, "haut_de_gamme"),

    # iPhone 14 Pro Max
    ("Apple", "iPhone 14 Pro Max", "Ecran", "Original", "Ecran Original iPhone 14 Pro Max", 240.00, "haut_de_gamme"),
    ("Apple", "iPhone 14 Pro Max", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone 14 Pro Max", 135.00, "haut_de_gamme"),
    ("Apple", "iPhone 14 Pro Max", "Ecran", "OLED", "Ecran Hard OLED iPhone 14 Pro Max", 105.00, "haut_de_gamme"),
    ("Apple", "iPhone 14 Pro Max", "Ecran", "Incell", "Ecran Incell iPhone 14 Pro Max", 75.00, "haut_de_gamme"),

    # iPhone 14 Pro
    ("Apple", "iPhone 14 Pro", "Ecran", "Original", "Ecran Original iPhone 14 Pro", 210.00, "haut_de_gamme"),
    ("Apple", "iPhone 14 Pro", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone 14 Pro", 115.00, "haut_de_gamme"),
    ("Apple", "iPhone 14 Pro", "Ecran", "OLED", "Ecran Hard OLED iPhone 14 Pro", 90.00, "haut_de_gamme"),
    ("Apple", "iPhone 14 Pro", "Ecran", "Incell", "Ecran Incell iPhone 14 Pro", 65.00, "haut_de_gamme"),

    # iPhone 14 Plus
    ("Apple", "iPhone 14 Plus", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone 14 Plus", 95.00, "standard"),
    ("Apple", "iPhone 14 Plus", "Ecran", "OLED", "Ecran Hard OLED iPhone 14 Plus", 75.00, "standard"),
    ("Apple", "iPhone 14 Plus", "Ecran", "Incell", "Ecran Incell iPhone 14 Plus", 55.00, "standard"),

    # iPhone 14
    ("Apple", "iPhone 14", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone 14", 80.00, "standard"),
    ("Apple", "iPhone 14", "Ecran", "OLED", "Ecran Hard OLED iPhone 14", 62.00, "standard"),
    ("Apple", "iPhone 14", "Ecran", "Incell", "Ecran Incell iPhone 14", 45.00, "standard"),

    # iPhone 13 Pro Max
    ("Apple", "iPhone 13 Pro Max", "Ecran", "Original", "Ecran Original iPhone 13 Pro Max", 195.00, "haut_de_gamme"),
    ("Apple", "iPhone 13 Pro Max", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone 13 Pro Max", 110.00, "haut_de_gamme"),
    ("Apple", "iPhone 13 Pro Max", "Ecran", "OLED", "Ecran Hard OLED iPhone 13 Pro Max", 85.00, "haut_de_gamme"),
    ("Apple", "iPhone 13 Pro Max", "Ecran", "Incell", "Ecran Incell iPhone 13 Pro Max", 60.00, "haut_de_gamme"),

    # iPhone 13 Pro
    ("Apple", "iPhone 13 Pro", "Ecran", "Original", "Ecran Original iPhone 13 Pro", 175.00, "haut_de_gamme"),
    ("Apple", "iPhone 13 Pro", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone 13 Pro", 95.00, "haut_de_gamme"),
    ("Apple", "iPhone 13 Pro", "Ecran", "OLED", "Ecran Hard OLED iPhone 13 Pro", 72.00, "haut_de_gamme"),
    ("Apple", "iPhone 13 Pro", "Ecran", "Incell", "Ecran Incell iPhone 13 Pro", 52.00, "haut_de_gamme"),

    # iPhone 13
    ("Apple", "iPhone 13", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone 13", 75.00, "standard"),
    ("Apple", "iPhone 13", "Ecran", "OLED", "Ecran Hard OLED iPhone 13", 58.00, "standard"),
    ("Apple", "iPhone 13", "Ecran", "Incell", "Ecran Incell iPhone 13", 40.00, "standard"),

    # iPhone 13 Mini
    ("Apple", "iPhone 13 Mini", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone 13 Mini", 72.00, "standard"),
    ("Apple", "iPhone 13 Mini", "Ecran", "OLED", "Ecran Hard OLED iPhone 13 Mini", 55.00, "standard"),
    ("Apple", "iPhone 13 Mini", "Ecran", "Incell", "Ecran Incell iPhone 13 Mini", 38.00, "standard"),

    # iPhone 12 Pro Max
    ("Apple", "iPhone 12 Pro Max", "Ecran", "Original", "Ecran Original iPhone 12 Pro Max", 150.00, "haut_de_gamme"),
    ("Apple", "iPhone 12 Pro Max", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone 12 Pro Max", 80.00, "standard"),
    ("Apple", "iPhone 12 Pro Max", "Ecran", "OLED", "Ecran Hard OLED iPhone 12 Pro Max", 62.00, "standard"),
    ("Apple", "iPhone 12 Pro Max", "Ecran", "Incell", "Ecran Incell iPhone 12 Pro Max", 42.00, "standard"),

    # iPhone 12 / 12 Pro (meme ecran)
    ("Apple", "iPhone 12 / 12 Pro", "Ecran", "Original", "Ecran Original iPhone 12/12 Pro", 125.00, "standard"),
    ("Apple", "iPhone 12 / 12 Pro", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone 12/12 Pro", 65.00, "standard"),
    ("Apple", "iPhone 12 / 12 Pro", "Ecran", "OLED", "Ecran Hard OLED iPhone 12/12 Pro", 50.00, "standard"),
    ("Apple", "iPhone 12 / 12 Pro", "Ecran", "Incell", "Ecran Incell iPhone 12/12 Pro", 35.00, "standard"),

    # iPhone 12 Mini
    ("Apple", "iPhone 12 Mini", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone 12 Mini", 62.00, "standard"),
    ("Apple", "iPhone 12 Mini", "Ecran", "OLED", "Ecran Hard OLED iPhone 12 Mini", 48.00, "standard"),
    ("Apple", "iPhone 12 Mini", "Ecran", "Incell", "Ecran Incell iPhone 12 Mini", 32.00, "standard"),

    # iPhone 11 Pro Max
    ("Apple", "iPhone 11 Pro Max", "Ecran", "Original", "Ecran Original iPhone 11 Pro Max", 135.00, "standard"),
    ("Apple", "iPhone 11 Pro Max", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone 11 Pro Max", 72.00, "standard"),
    ("Apple", "iPhone 11 Pro Max", "Ecran", "OLED", "Ecran Hard OLED iPhone 11 Pro Max", 55.00, "standard"),
    ("Apple", "iPhone 11 Pro Max", "Ecran", "Incell", "Ecran Incell iPhone 11 Pro Max", 40.00, "standard"),

    # iPhone 11 Pro
    ("Apple", "iPhone 11 Pro", "Ecran", "Original", "Ecran Original iPhone 11 Pro", 115.00, "standard"),
    ("Apple", "iPhone 11 Pro", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone 11 Pro", 60.00, "standard"),
    ("Apple", "iPhone 11 Pro", "Ecran", "OLED", "Ecran Hard OLED iPhone 11 Pro", 45.00, "standard"),
    ("Apple", "iPhone 11 Pro", "Ecran", "Incell", "Ecran Incell iPhone 11 Pro", 32.00, "standard"),

    # iPhone 11
    ("Apple", "iPhone 11", "Ecran", "Original", "Ecran Original iPhone 11", 55.00, "standard"),
    ("Apple", "iPhone 11", "Ecran", "Compatible", "Ecran Compatible iPhone 11", 25.00, "standard"),

    # iPhone XS Max
    ("Apple", "iPhone XS Max", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone XS Max", 62.00, "standard"),
    ("Apple", "iPhone XS Max", "Ecran", "OLED", "Ecran Hard OLED iPhone XS Max", 48.00, "standard"),
    ("Apple", "iPhone XS Max", "Ecran", "Incell", "Ecran Incell iPhone XS Max", 30.00, "standard"),

    # iPhone XS
    ("Apple", "iPhone XS", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone XS", 55.00, "standard"),
    ("Apple", "iPhone XS", "Ecran", "OLED", "Ecran Hard OLED iPhone XS", 42.00, "standard"),
    ("Apple", "iPhone XS", "Ecran", "Incell", "Ecran Incell iPhone XS", 28.00, "standard"),

    # iPhone XR
    ("Apple", "iPhone XR", "Ecran", "Original", "Ecran Original iPhone XR", 45.00, "standard"),
    ("Apple", "iPhone XR", "Ecran", "Compatible", "Ecran Compatible iPhone XR", 22.00, "standard"),

    # iPhone X
    ("Apple", "iPhone X", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone X", 50.00, "standard"),
    ("Apple", "iPhone X", "Ecran", "OLED", "Ecran Hard OLED iPhone X", 38.00, "standard"),
    ("Apple", "iPhone X", "Ecran", "Incell", "Ecran Incell iPhone X", 25.00, "standard"),

    # iPhone SE 2020/2022
    ("Apple", "iPhone SE 2020/2022", "Ecran", "Original", "Ecran Original iPhone SE 2020/2022", 30.00, "standard"),
    ("Apple", "iPhone SE 2020/2022", "Ecran", "Compatible", "Ecran Compatible iPhone SE 2020/2022", 15.00, "standard"),

    # iPhone 8 / SE3
    ("Apple", "iPhone 8", "Ecran", "Original", "Ecran Original iPhone 8", 25.00, "standard"),
    ("Apple", "iPhone 8", "Ecran", "Compatible", "Ecran Compatible iPhone 8", 12.00, "standard"),

    # ══════════════════════════════════════════════════════════
    #  APPLE iPHONE — BATTERIES
    # ══════════════════════════════════════════════════════════
    ("Apple", "iPhone 16 Pro Max", "Batterie", None, "Batterie iPhone 16 Pro Max", 18.00, "standard"),
    ("Apple", "iPhone 16 Pro", "Batterie", None, "Batterie iPhone 16 Pro", 17.00, "standard"),
    ("Apple", "iPhone 16 Plus", "Batterie", None, "Batterie iPhone 16 Plus", 16.50, "standard"),
    ("Apple", "iPhone 16", "Batterie", None, "Batterie iPhone 16", 15.50, "standard"),
    ("Apple", "iPhone 15 Pro Max", "Batterie", None, "Batterie iPhone 15 Pro Max", 16.00, "standard"),
    ("Apple", "iPhone 15 Pro", "Batterie", None, "Batterie iPhone 15 Pro", 15.00, "standard"),
    ("Apple", "iPhone 15 Plus", "Batterie", None, "Batterie iPhone 15 Plus", 14.50, "standard"),
    ("Apple", "iPhone 15", "Batterie", None, "Batterie iPhone 15", 13.50, "standard"),
    ("Apple", "iPhone 14 Pro Max", "Batterie", None, "Batterie iPhone 14 Pro Max", 14.00, "standard"),
    ("Apple", "iPhone 14 Pro", "Batterie", None, "Batterie iPhone 14 Pro", 13.00, "standard"),
    ("Apple", "iPhone 14 Plus", "Batterie", None, "Batterie iPhone 14 Plus", 13.00, "standard"),
    ("Apple", "iPhone 14", "Batterie", None, "Batterie iPhone 14", 12.00, "standard"),
    ("Apple", "iPhone 13 Pro Max", "Batterie", None, "Batterie iPhone 13 Pro Max", 13.00, "standard"),
    ("Apple", "iPhone 13 Pro", "Batterie", None, "Batterie iPhone 13 Pro", 12.00, "standard"),
    ("Apple", "iPhone 13", "Batterie", None, "Batterie iPhone 13", 11.00, "standard"),
    ("Apple", "iPhone 13 Mini", "Batterie", None, "Batterie iPhone 13 Mini", 10.50, "standard"),
    ("Apple", "iPhone 12 Pro Max", "Batterie", None, "Batterie iPhone 12 Pro Max", 12.00, "standard"),
    ("Apple", "iPhone 12 / 12 Pro", "Batterie", None, "Batterie iPhone 12/12 Pro", 10.50, "standard"),
    ("Apple", "iPhone 12 Mini", "Batterie", None, "Batterie iPhone 12 Mini", 10.00, "standard"),
    ("Apple", "iPhone 11 Pro Max", "Batterie", None, "Batterie iPhone 11 Pro Max", 11.00, "standard"),
    ("Apple", "iPhone 11 Pro", "Batterie", None, "Batterie iPhone 11 Pro", 10.00, "standard"),
    ("Apple", "iPhone 11", "Batterie", None, "Batterie iPhone 11", 9.50, "standard"),
    ("Apple", "iPhone XS Max", "Batterie", None, "Batterie iPhone XS Max", 9.50, "standard"),
    ("Apple", "iPhone XS", "Batterie", None, "Batterie iPhone XS", 8.50, "standard"),
    ("Apple", "iPhone XR", "Batterie", None, "Batterie iPhone XR", 8.50, "standard"),
    ("Apple", "iPhone X", "Batterie", None, "Batterie iPhone X", 8.00, "standard"),
    ("Apple", "iPhone SE 2020/2022", "Batterie", None, "Batterie iPhone SE 2020/2022", 7.50, "standard"),
    ("Apple", "iPhone 8", "Batterie", None, "Batterie iPhone 8", 6.50, "standard"),

    # ══════════════════════════════════════════════════════════
    #  APPLE iPHONE — CONNECTEURS DE CHARGE
    # ══════════════════════════════════════════════════════════
    ("Apple", "iPhone 15 Pro Max", "Connecteur de charge", None, "Nappe connecteur charge iPhone 15 Pro Max", 22.00, "standard"),
    ("Apple", "iPhone 15 Pro", "Connecteur de charge", None, "Nappe connecteur charge iPhone 15 Pro", 20.00, "standard"),
    ("Apple", "iPhone 15", "Connecteur de charge", None, "Nappe connecteur charge iPhone 15", 18.00, "standard"),
    ("Apple", "iPhone 14 Pro Max", "Connecteur de charge", None, "Nappe connecteur charge iPhone 14 Pro Max", 18.00, "standard"),
    ("Apple", "iPhone 14 Pro", "Connecteur de charge", None, "Nappe connecteur charge iPhone 14 Pro", 16.00, "standard"),
    ("Apple", "iPhone 14", "Connecteur de charge", None, "Nappe connecteur charge iPhone 14", 14.00, "standard"),
    ("Apple", "iPhone 13 Pro Max", "Connecteur de charge", None, "Nappe connecteur charge iPhone 13 Pro Max", 14.00, "standard"),
    ("Apple", "iPhone 13 Pro", "Connecteur de charge", None, "Nappe connecteur charge iPhone 13 Pro", 13.00, "standard"),
    ("Apple", "iPhone 13", "Connecteur de charge", None, "Nappe connecteur charge iPhone 13", 12.00, "standard"),
    ("Apple", "iPhone 12 Pro Max", "Connecteur de charge", None, "Nappe connecteur charge iPhone 12 Pro Max", 12.00, "standard"),
    ("Apple", "iPhone 12 / 12 Pro", "Connecteur de charge", None, "Nappe connecteur charge iPhone 12/12 Pro", 10.00, "standard"),
    ("Apple", "iPhone 11", "Connecteur de charge", None, "Nappe connecteur charge iPhone 11", 9.00, "standard"),
    ("Apple", "iPhone XR", "Connecteur de charge", None, "Nappe connecteur charge iPhone XR", 8.00, "standard"),
    ("Apple", "iPhone X", "Connecteur de charge", None, "Nappe connecteur charge iPhone X", 8.00, "standard"),

    # ══════════════════════════════════════════════════════════
    #  APPLE iPHONE — CAMERAS ARRIERE
    # ══════════════════════════════════════════════════════════
    ("Apple", "iPhone 15 Pro Max", "Camera arriere", None, "Camera arriere iPhone 15 Pro Max", 65.00, "standard"),
    ("Apple", "iPhone 15 Pro", "Camera arriere", None, "Camera arriere iPhone 15 Pro", 58.00, "standard"),
    ("Apple", "iPhone 15", "Camera arriere", None, "Camera arriere iPhone 15", 35.00, "standard"),
    ("Apple", "iPhone 14 Pro Max", "Camera arriere", None, "Camera arriere iPhone 14 Pro Max", 55.00, "standard"),
    ("Apple", "iPhone 14 Pro", "Camera arriere", None, "Camera arriere iPhone 14 Pro", 48.00, "standard"),
    ("Apple", "iPhone 14", "Camera arriere", None, "Camera arriere iPhone 14", 28.00, "standard"),
    ("Apple", "iPhone 13 Pro Max", "Camera arriere", None, "Camera arriere iPhone 13 Pro Max", 42.00, "standard"),
    ("Apple", "iPhone 13 Pro", "Camera arriere", None, "Camera arriere iPhone 13 Pro", 38.00, "standard"),
    ("Apple", "iPhone 13", "Camera arriere", None, "Camera arriere iPhone 13", 22.00, "standard"),
    ("Apple", "iPhone 12 Pro Max", "Camera arriere", None, "Camera arriere iPhone 12 Pro Max", 32.00, "standard"),
    ("Apple", "iPhone 12 / 12 Pro", "Camera arriere", None, "Camera arriere iPhone 12/12 Pro", 25.00, "standard"),
    ("Apple", "iPhone 11", "Camera arriere", None, "Camera arriere iPhone 11", 18.00, "standard"),

    # ══════════════════════════════════════════════════════════
    #  SAMSUNG — ECRANS
    # ══════════════════════════════════════════════════════════

    # Galaxy S24 Ultra
    ("Samsung", "Galaxy S24 Ultra", "Ecran", "Original", "Ecran Original Samsung S24 Ultra", 320.00, "haut_de_gamme"),
    ("Samsung", "Galaxy S24 Ultra", "Ecran", "Soft OLED", "Ecran Soft OLED Samsung S24 Ultra", 175.00, "haut_de_gamme"),
    ("Samsung", "Galaxy S24 Ultra", "Ecran", "OLED", "Ecran Hard OLED Samsung S24 Ultra", 140.00, "haut_de_gamme"),

    # Galaxy S24+
    ("Samsung", "Galaxy S24+", "Ecran", "Original", "Ecran Original Samsung S24+", 245.00, "haut_de_gamme"),
    ("Samsung", "Galaxy S24+", "Ecran", "Soft OLED", "Ecran Soft OLED Samsung S24+", 135.00, "haut_de_gamme"),
    ("Samsung", "Galaxy S24+", "Ecran", "OLED", "Ecran Hard OLED Samsung S24+", 105.00, "haut_de_gamme"),

    # Galaxy S24
    ("Samsung", "Galaxy S24", "Ecran", "Original", "Ecran Original Samsung S24", 195.00, "haut_de_gamme"),
    ("Samsung", "Galaxy S24", "Ecran", "Soft OLED", "Ecran Soft OLED Samsung S24", 110.00, "haut_de_gamme"),
    ("Samsung", "Galaxy S24", "Ecran", "OLED", "Ecran Hard OLED Samsung S24", 85.00, "haut_de_gamme"),

    # Galaxy S23 Ultra
    ("Samsung", "Galaxy S23 Ultra", "Ecran", "Original", "Ecran Original Samsung S23 Ultra", 280.00, "haut_de_gamme"),
    ("Samsung", "Galaxy S23 Ultra", "Ecran", "Soft OLED", "Ecran Soft OLED Samsung S23 Ultra", 155.00, "haut_de_gamme"),
    ("Samsung", "Galaxy S23 Ultra", "Ecran", "OLED", "Ecran Hard OLED Samsung S23 Ultra", 120.00, "haut_de_gamme"),

    # Galaxy S23+
    ("Samsung", "Galaxy S23+", "Ecran", "Original", "Ecran Original Samsung S23+", 210.00, "haut_de_gamme"),
    ("Samsung", "Galaxy S23+", "Ecran", "Soft OLED", "Ecran Soft OLED Samsung S23+", 115.00, "haut_de_gamme"),

    # Galaxy S23
    ("Samsung", "Galaxy S23", "Ecran", "Original", "Ecran Original Samsung S23", 170.00, "haut_de_gamme"),
    ("Samsung", "Galaxy S23", "Ecran", "Soft OLED", "Ecran Soft OLED Samsung S23", 95.00, "haut_de_gamme"),

    # Galaxy S22 Ultra
    ("Samsung", "Galaxy S22 Ultra", "Ecran", "Original", "Ecran Original Samsung S22 Ultra", 220.00, "haut_de_gamme"),
    ("Samsung", "Galaxy S22 Ultra", "Ecran", "Soft OLED", "Ecran Soft OLED Samsung S22 Ultra", 125.00, "haut_de_gamme"),

    # Galaxy S22+
    ("Samsung", "Galaxy S22+", "Ecran", "Original", "Ecran Original Samsung S22+", 165.00, "haut_de_gamme"),

    # Galaxy S22
    ("Samsung", "Galaxy S22", "Ecran", "Original", "Ecran Original Samsung S22", 135.00, "standard"),
    ("Samsung", "Galaxy S22", "Ecran", "Soft OLED", "Ecran Soft OLED Samsung S22", 78.00, "standard"),

    # Galaxy S21 Ultra
    ("Samsung", "Galaxy S21 Ultra", "Ecran", "Original", "Ecran Original Samsung S21 Ultra", 185.00, "haut_de_gamme"),
    ("Samsung", "Galaxy S21 Ultra", "Ecran", "Soft OLED", "Ecran Soft OLED Samsung S21 Ultra", 110.00, "haut_de_gamme"),

    # Galaxy S21
    ("Samsung", "Galaxy S21", "Ecran", "Original", "Ecran Original Samsung S21", 120.00, "standard"),
    ("Samsung", "Galaxy S21", "Ecran", "Soft OLED", "Ecran Soft OLED Samsung S21", 68.00, "standard"),

    # Galaxy A55
    ("Samsung", "Galaxy A55", "Ecran", "Original", "Ecran Original Samsung A55", 75.00, "standard"),
    ("Samsung", "Galaxy A55", "Ecran", "Soft OLED", "Ecran Soft OLED Samsung A55", 48.00, "standard"),
    ("Samsung", "Galaxy A55", "Ecran", "Incell", "Ecran Incell Samsung A55", 30.00, "standard"),

    # Galaxy A54
    ("Samsung", "Galaxy A54", "Ecran", "Original", "Ecran Original Samsung A54", 65.00, "standard"),
    ("Samsung", "Galaxy A54", "Ecran", "Soft OLED", "Ecran Soft OLED Samsung A54", 42.00, "standard"),
    ("Samsung", "Galaxy A54", "Ecran", "Incell", "Ecran Incell Samsung A54", 28.00, "standard"),

    # Galaxy A53
    ("Samsung", "Galaxy A53", "Ecran", "Original", "Ecran Original Samsung A53", 55.00, "standard"),
    ("Samsung", "Galaxy A53", "Ecran", "Incell", "Ecran Incell Samsung A53", 25.00, "standard"),

    # Galaxy A34
    ("Samsung", "Galaxy A34", "Ecran", "Original", "Ecran Original Samsung A34", 52.00, "standard"),
    ("Samsung", "Galaxy A34", "Ecran", "Incell", "Ecran Incell Samsung A34", 25.00, "standard"),

    # Galaxy A25
    ("Samsung", "Galaxy A25", "Ecran", "Original", "Ecran Original Samsung A25", 42.00, "standard"),
    ("Samsung", "Galaxy A25", "Ecran", "Incell", "Ecran Incell Samsung A25", 22.00, "standard"),

    # Galaxy A15
    ("Samsung", "Galaxy A15", "Ecran", "Original", "Ecran Original Samsung A15", 32.00, "standard"),
    ("Samsung", "Galaxy A15", "Ecran", "Compatible", "Ecran Compatible Samsung A15", 18.00, "standard"),

    # Galaxy Z Flip 5
    ("Samsung", "Galaxy Z Flip 5", "Ecran", "Original", "Ecran Original Samsung Z Flip 5", 280.00, "pliant"),

    # Galaxy Z Fold 5
    ("Samsung", "Galaxy Z Fold 5", "Ecran", "Original", "Ecran interieur Original Samsung Z Fold 5", 380.00, "pliant"),

    # ══════════════════════════════════════════════════════════
    #  SAMSUNG — BATTERIES
    # ══════════════════════════════════════════════════════════
    ("Samsung", "Galaxy S24 Ultra", "Batterie", None, "Batterie Samsung S24 Ultra", 18.00, "standard"),
    ("Samsung", "Galaxy S24+", "Batterie", None, "Batterie Samsung S24+", 16.00, "standard"),
    ("Samsung", "Galaxy S24", "Batterie", None, "Batterie Samsung S24", 14.00, "standard"),
    ("Samsung", "Galaxy S23 Ultra", "Batterie", None, "Batterie Samsung S23 Ultra", 16.00, "standard"),
    ("Samsung", "Galaxy S23", "Batterie", None, "Batterie Samsung S23", 13.00, "standard"),
    ("Samsung", "Galaxy S22 Ultra", "Batterie", None, "Batterie Samsung S22 Ultra", 14.00, "standard"),
    ("Samsung", "Galaxy S22", "Batterie", None, "Batterie Samsung S22", 12.00, "standard"),
    ("Samsung", "Galaxy S21", "Batterie", None, "Batterie Samsung S21", 11.00, "standard"),
    ("Samsung", "Galaxy A55", "Batterie", None, "Batterie Samsung A55", 12.00, "standard"),
    ("Samsung", "Galaxy A54", "Batterie", None, "Batterie Samsung A54", 11.00, "standard"),
    ("Samsung", "Galaxy A53", "Batterie", None, "Batterie Samsung A53", 10.00, "standard"),
    ("Samsung", "Galaxy A34", "Batterie", None, "Batterie Samsung A34", 10.00, "standard"),
    ("Samsung", "Galaxy A25", "Batterie", None, "Batterie Samsung A25", 9.00, "standard"),
    ("Samsung", "Galaxy A15", "Batterie", None, "Batterie Samsung A15", 8.50, "standard"),

    # ══════════════════════════════════════════════════════════
    #  SAMSUNG — CONNECTEURS
    # ══════════════════════════════════════════════════════════
    ("Samsung", "Galaxy S24 Ultra", "Connecteur de charge", None, "Nappe connecteur Samsung S24 Ultra", 18.00, "standard"),
    ("Samsung", "Galaxy S24", "Connecteur de charge", None, "Nappe connecteur Samsung S24", 15.00, "standard"),
    ("Samsung", "Galaxy S23 Ultra", "Connecteur de charge", None, "Nappe connecteur Samsung S23 Ultra", 16.00, "standard"),
    ("Samsung", "Galaxy S23", "Connecteur de charge", None, "Nappe connecteur Samsung S23", 13.00, "standard"),
    ("Samsung", "Galaxy A55", "Connecteur de charge", None, "Nappe connecteur Samsung A55", 10.00, "standard"),
    ("Samsung", "Galaxy A54", "Connecteur de charge", None, "Nappe connecteur Samsung A54", 9.00, "standard"),
    ("Samsung", "Galaxy A34", "Connecteur de charge", None, "Nappe connecteur Samsung A34", 8.00, "standard"),

    # ══════════════════════════════════════════════════════════
    #  XIAOMI — ECRANS
    # ══════════════════════════════════════════════════════════
    ("Xiaomi", "Redmi Note 13 Pro", "Ecran", "Original", "Ecran Original Xiaomi Redmi Note 13 Pro", 62.00, "standard"),
    ("Xiaomi", "Redmi Note 13 Pro", "Ecran", "Incell", "Ecran Incell Xiaomi Redmi Note 13 Pro", 30.00, "standard"),
    ("Xiaomi", "Redmi Note 13", "Ecran", "Original", "Ecran Original Xiaomi Redmi Note 13", 45.00, "standard"),
    ("Xiaomi", "Redmi Note 13", "Ecran", "Incell", "Ecran Incell Xiaomi Redmi Note 13", 22.00, "standard"),
    ("Xiaomi", "Redmi Note 12 Pro", "Ecran", "Original", "Ecran Original Xiaomi Redmi Note 12 Pro", 55.00, "standard"),
    ("Xiaomi", "Redmi Note 12 Pro", "Ecran", "OLED", "Ecran OLED Xiaomi Redmi Note 12 Pro", 38.00, "standard"),
    ("Xiaomi", "Redmi Note 12", "Ecran", "Original", "Ecran Original Xiaomi Redmi Note 12", 38.00, "standard"),
    ("Xiaomi", "Redmi Note 12", "Ecran", "Incell", "Ecran Incell Xiaomi Redmi Note 12", 20.00, "standard"),
    ("Xiaomi", "Redmi Note 11 Pro", "Ecran", "Original", "Ecran Original Xiaomi Redmi Note 11 Pro", 48.00, "standard"),
    ("Xiaomi", "Redmi Note 11 Pro", "Ecran", "OLED", "Ecran OLED Xiaomi Redmi Note 11 Pro", 32.00, "standard"),
    ("Xiaomi", "Redmi Note 11", "Ecran", "Original", "Ecran Original Xiaomi Redmi Note 11", 32.00, "standard"),
    ("Xiaomi", "Redmi Note 11", "Ecran", "Incell", "Ecran Incell Xiaomi Redmi Note 11", 18.00, "standard"),
    ("Xiaomi", "Poco X6 Pro", "Ecran", "Original", "Ecran Original Xiaomi Poco X6 Pro", 58.00, "standard"),
    ("Xiaomi", "Poco X6 Pro", "Ecran", "OLED", "Ecran OLED Xiaomi Poco X6 Pro", 35.00, "standard"),
    ("Xiaomi", "Poco X5 Pro", "Ecran", "Original", "Ecran Original Xiaomi Poco X5 Pro", 48.00, "standard"),
    ("Xiaomi", "14 Ultra", "Ecran", "Original", "Ecran Original Xiaomi 14 Ultra", 180.00, "haut_de_gamme"),
    ("Xiaomi", "14", "Ecran", "Original", "Ecran Original Xiaomi 14", 95.00, "haut_de_gamme"),

    # Xiaomi batteries
    ("Xiaomi", "Redmi Note 13 Pro", "Batterie", None, "Batterie Xiaomi Redmi Note 13 Pro", 10.00, "standard"),
    ("Xiaomi", "Redmi Note 13", "Batterie", None, "Batterie Xiaomi Redmi Note 13", 9.00, "standard"),
    ("Xiaomi", "Redmi Note 12 Pro", "Batterie", None, "Batterie Xiaomi Redmi Note 12 Pro", 9.50, "standard"),
    ("Xiaomi", "Redmi Note 12", "Batterie", None, "Batterie Xiaomi Redmi Note 12", 8.50, "standard"),
    ("Xiaomi", "Redmi Note 11", "Batterie", None, "Batterie Xiaomi Redmi Note 11", 8.00, "standard"),

    # Xiaomi connecteurs
    ("Xiaomi", "Redmi Note 13 Pro", "Connecteur de charge", None, "Nappe connecteur Xiaomi Redmi Note 13 Pro", 8.00, "standard"),
    ("Xiaomi", "Redmi Note 12 Pro", "Connecteur de charge", None, "Nappe connecteur Xiaomi Redmi Note 12 Pro", 7.50, "standard"),
    ("Xiaomi", "Redmi Note 11", "Connecteur de charge", None, "Nappe connecteur Xiaomi Redmi Note 11", 6.50, "standard"),

    # ══════════════════════════════════════════════════════════
    #  HUAWEI — ECRANS
    # ══════════════════════════════════════════════════════════
    ("Huawei", "P30 Pro", "Ecran", "Original", "Ecran Original Huawei P30 Pro", 85.00, "standard"),
    ("Huawei", "P30 Pro", "Ecran", "OLED", "Ecran OLED Huawei P30 Pro", 52.00, "standard"),
    ("Huawei", "P30 Lite", "Ecran", "Original", "Ecran Original Huawei P30 Lite", 32.00, "standard"),
    ("Huawei", "P30 Lite", "Ecran", "Compatible", "Ecran Compatible Huawei P30 Lite", 18.00, "standard"),
    ("Huawei", "P40 Pro", "Ecran", "Original", "Ecran Original Huawei P40 Pro", 110.00, "haut_de_gamme"),
    ("Huawei", "P40 Lite", "Ecran", "Original", "Ecran Original Huawei P40 Lite", 35.00, "standard"),
    ("Huawei", "P40 Lite", "Ecran", "Compatible", "Ecran Compatible Huawei P40 Lite", 20.00, "standard"),
    ("Huawei", "Nova 10", "Ecran", "Original", "Ecran Original Huawei Nova 10", 52.00, "standard"),
    ("Huawei", "Nova 10", "Ecran", "Incell", "Ecran Incell Huawei Nova 10", 28.00, "standard"),

    # Huawei batteries
    ("Huawei", "P30 Pro", "Batterie", None, "Batterie Huawei P30 Pro", 10.00, "standard"),
    ("Huawei", "P30 Lite", "Batterie", None, "Batterie Huawei P30 Lite", 8.00, "standard"),
    ("Huawei", "P40 Lite", "Batterie", None, "Batterie Huawei P40 Lite", 8.50, "standard"),

    # ══════════════════════════════════════════════════════════
    #  MOTOROLA — ECRANS
    # ══════════════════════════════════════════════════════════
    ("Motorola", "Moto G84", "Ecran", "Original", "Ecran Original Motorola Moto G84", 45.00, "standard"),
    ("Motorola", "Moto G84", "Ecran", "Incell", "Ecran Incell Motorola Moto G84", 25.00, "standard"),
    ("Motorola", "Moto G73", "Ecran", "Original", "Ecran Original Motorola Moto G73", 38.00, "standard"),
    ("Motorola", "Moto G73", "Ecran", "Incell", "Ecran Incell Motorola Moto G73", 22.00, "standard"),
    ("Motorola", "Moto G54", "Ecran", "Original", "Ecran Original Motorola Moto G54", 35.00, "standard"),
    ("Motorola", "Edge 40", "Ecran", "Original", "Ecran Original Motorola Edge 40", 72.00, "standard"),
    ("Motorola", "Edge 40", "Ecran", "OLED", "Ecran OLED Motorola Edge 40", 48.00, "standard"),

    # Motorola batteries
    ("Motorola", "Moto G84", "Batterie", None, "Batterie Motorola Moto G84", 9.00, "standard"),
    ("Motorola", "Moto G73", "Batterie", None, "Batterie Motorola Moto G73", 8.50, "standard"),
    ("Motorola", "Moto G54", "Batterie", None, "Batterie Motorola Moto G54", 8.00, "standard"),
]


def main():
    print(f"API: {API_URL}\n")

    # Build items
    items = []
    for row in TARIFS:
        marque, modele, type_piece, qualite, nom_fournisseur, prix_ht, categorie = row
        items.append({
            "marque": marque,
            "modele": modele,
            "type_piece": type_piece,
            "qualite": qualite,
            "nom_fournisseur": nom_fournisseur,
            "prix_fournisseur_ht": prix_ht,
            "categorie": categorie,
            "source": "mobilax",
        })

    print(f"{len(items)} tarifs a importer")
    brands = {}
    for i in items:
        brands[i["marque"]] = brands.get(i["marque"], 0) + 1
    for b, c in brands.items():
        print(f"  {b}: {c} tarifs")

    headers = {"Content-Type": "application/json"}

    # Clear existing tarifs
    print("\n--- Clear existing tarifs ---")
    clear_res = httpx.delete(f"{API_URL}/api/tarifs/clear", headers=headers, timeout=15)
    print(f"Clear: {clear_res.status_code} {clear_res.json()}")

    # Import
    print("\n--- Import tarifs ---")
    import_res = httpx.post(
        f"{API_URL}/api/tarifs/import",
        json={"items": items},
        headers=headers,
        timeout=60,
    )
    print(f"Import: {import_res.status_code} {import_res.json()}")

    # Stats (public endpoint)
    print("\n--- Stats ---")
    stats_res = httpx.get(f"{API_URL}/api/tarifs/stats", timeout=15)
    print(f"Stats: {stats_res.json()}")

    print("\nDone!")


if __name__ == "__main__":
    main()
