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

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  APPLE iPHONE — ECRANS                                     ║
    # ╚══════════════════════════════════════════════════════════════╝

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
    ("Apple", "iPhone 15 Pro Max", "Ecran", "Reconditionnee", "Ecran Reconditionne iPhone 15 Pro Max", 220.00, "haut_de_gamme"),
    ("Apple", "iPhone 15 Pro Max", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone 15 Pro Max", 170.00, "haut_de_gamme"),
    ("Apple", "iPhone 15 Pro Max", "Ecran", "OLED", "Ecran Hard OLED iPhone 15 Pro Max", 135.00, "haut_de_gamme"),
    ("Apple", "iPhone 15 Pro Max", "Ecran", "Incell", "Ecran Incell iPhone 15 Pro Max", 95.00, "haut_de_gamme"),

    # iPhone 15 Pro
    ("Apple", "iPhone 15 Pro", "Ecran", "Original", "Ecran Original iPhone 15 Pro", 250.00, "haut_de_gamme"),
    ("Apple", "iPhone 15 Pro", "Ecran", "Reconditionnee", "Ecran Reconditionne iPhone 15 Pro", 195.00, "haut_de_gamme"),
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
    ("Apple", "iPhone 14 Pro Max", "Ecran", "Reconditionnee", "Ecran Reconditionne iPhone 14 Pro Max", 185.00, "haut_de_gamme"),
    ("Apple", "iPhone 14 Pro Max", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone 14 Pro Max", 135.00, "haut_de_gamme"),
    ("Apple", "iPhone 14 Pro Max", "Ecran", "OLED", "Ecran Hard OLED iPhone 14 Pro Max", 105.00, "haut_de_gamme"),
    ("Apple", "iPhone 14 Pro Max", "Ecran", "Incell", "Ecran Incell iPhone 14 Pro Max", 75.00, "haut_de_gamme"),

    # iPhone 14 Pro
    ("Apple", "iPhone 14 Pro", "Ecran", "Original", "Ecran Original iPhone 14 Pro", 210.00, "haut_de_gamme"),
    ("Apple", "iPhone 14 Pro", "Ecran", "Reconditionnee", "Ecran Reconditionne iPhone 14 Pro", 165.00, "haut_de_gamme"),
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
    ("Apple", "iPhone 13 Pro Max", "Ecran", "Reconditionnee", "Ecran Reconditionne iPhone 13 Pro Max", 150.00, "haut_de_gamme"),
    ("Apple", "iPhone 13 Pro Max", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone 13 Pro Max", 110.00, "haut_de_gamme"),
    ("Apple", "iPhone 13 Pro Max", "Ecran", "OLED", "Ecran Hard OLED iPhone 13 Pro Max", 85.00, "haut_de_gamme"),
    ("Apple", "iPhone 13 Pro Max", "Ecran", "Incell", "Ecran Incell iPhone 13 Pro Max", 60.00, "haut_de_gamme"),

    # iPhone 13 Pro
    ("Apple", "iPhone 13 Pro", "Ecran", "Original", "Ecran Original iPhone 13 Pro", 175.00, "haut_de_gamme"),
    ("Apple", "iPhone 13 Pro", "Ecran", "Reconditionnee", "Ecran Reconditionne iPhone 13 Pro", 135.00, "haut_de_gamme"),
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
    ("Apple", "iPhone 12 Pro Max", "Ecran", "Reconditionnee", "Ecran Reconditionne iPhone 12 Pro Max", 115.00, "haut_de_gamme"),
    ("Apple", "iPhone 12 Pro Max", "Ecran", "Soft OLED", "Ecran Soft OLED iPhone 12 Pro Max", 80.00, "standard"),
    ("Apple", "iPhone 12 Pro Max", "Ecran", "OLED", "Ecran Hard OLED iPhone 12 Pro Max", 62.00, "standard"),
    ("Apple", "iPhone 12 Pro Max", "Ecran", "Incell", "Ecran Incell iPhone 12 Pro Max", 42.00, "standard"),

    # iPhone 12 / 12 Pro (meme ecran)
    ("Apple", "iPhone 12 / 12 Pro", "Ecran", "Original", "Ecran Original iPhone 12/12 Pro", 125.00, "standard"),
    ("Apple", "iPhone 12 / 12 Pro", "Ecran", "Reconditionnee", "Ecran Reconditionne iPhone 12/12 Pro", 95.00, "standard"),
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

    # iPhone SE 2020/2022/2025
    ("Apple", "iPhone SE 2020/2022", "Ecran", "Original", "Ecran Original iPhone SE 2020/2022", 30.00, "standard"),
    ("Apple", "iPhone SE 2020/2022", "Ecran", "Compatible", "Ecran Compatible iPhone SE 2020/2022", 15.00, "standard"),

    # iPhone 8 / 8 Plus
    ("Apple", "iPhone 8", "Ecran", "Original", "Ecran Original iPhone 8", 25.00, "standard"),
    ("Apple", "iPhone 8", "Ecran", "Compatible", "Ecran Compatible iPhone 8", 12.00, "standard"),
    ("Apple", "iPhone 8 Plus", "Ecran", "Original", "Ecran Original iPhone 8 Plus", 28.00, "standard"),
    ("Apple", "iPhone 8 Plus", "Ecran", "Compatible", "Ecran Compatible iPhone 8 Plus", 14.00, "standard"),

    # iPhone 7 / 7 Plus
    ("Apple", "iPhone 7", "Ecran", "Original", "Ecran Original iPhone 7", 22.00, "standard"),
    ("Apple", "iPhone 7", "Ecran", "Compatible", "Ecran Compatible iPhone 7", 10.00, "standard"),
    ("Apple", "iPhone 7 Plus", "Ecran", "Original", "Ecran Original iPhone 7 Plus", 25.00, "standard"),
    ("Apple", "iPhone 7 Plus", "Ecran", "Compatible", "Ecran Compatible iPhone 7 Plus", 12.00, "standard"),

    # iPhone 6S / 6S Plus
    ("Apple", "iPhone 6S", "Ecran", "Original", "Ecran Original iPhone 6S", 18.00, "standard"),
    ("Apple", "iPhone 6S", "Ecran", "Compatible", "Ecran Compatible iPhone 6S", 8.00, "standard"),
    ("Apple", "iPhone 6S Plus", "Ecran", "Original", "Ecran Original iPhone 6S Plus", 20.00, "standard"),
    ("Apple", "iPhone 6S Plus", "Ecran", "Compatible", "Ecran Compatible iPhone 6S Plus", 10.00, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  APPLE iPHONE — BATTERIES                                  ║
    # ╚══════════════════════════════════════════════════════════════╝
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
    ("Apple", "iPhone 8 Plus", "Batterie", None, "Batterie iPhone 8 Plus", 7.00, "standard"),
    ("Apple", "iPhone 7", "Batterie", None, "Batterie iPhone 7", 6.00, "standard"),
    ("Apple", "iPhone 7 Plus", "Batterie", None, "Batterie iPhone 7 Plus", 6.50, "standard"),
    ("Apple", "iPhone 6S", "Batterie", None, "Batterie iPhone 6S", 5.50, "standard"),
    ("Apple", "iPhone 6S Plus", "Batterie", None, "Batterie iPhone 6S Plus", 6.00, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  APPLE iPHONE — CONNECTEURS DE CHARGE                     ║
    # ╚══════════════════════════════════════════════════════════════╝
    ("Apple", "iPhone 15 Pro Max", "Connecteur de charge", None, "Nappe connecteur charge iPhone 15 Pro Max", 22.00, "standard"),
    ("Apple", "iPhone 15 Pro", "Connecteur de charge", None, "Nappe connecteur charge iPhone 15 Pro", 20.00, "standard"),
    ("Apple", "iPhone 15 Plus", "Connecteur de charge", None, "Nappe connecteur charge iPhone 15 Plus", 19.00, "standard"),
    ("Apple", "iPhone 15", "Connecteur de charge", None, "Nappe connecteur charge iPhone 15", 18.00, "standard"),
    ("Apple", "iPhone 14 Pro Max", "Connecteur de charge", None, "Nappe connecteur charge iPhone 14 Pro Max", 18.00, "standard"),
    ("Apple", "iPhone 14 Pro", "Connecteur de charge", None, "Nappe connecteur charge iPhone 14 Pro", 16.00, "standard"),
    ("Apple", "iPhone 14 Plus", "Connecteur de charge", None, "Nappe connecteur charge iPhone 14 Plus", 15.00, "standard"),
    ("Apple", "iPhone 14", "Connecteur de charge", None, "Nappe connecteur charge iPhone 14", 14.00, "standard"),
    ("Apple", "iPhone 13 Pro Max", "Connecteur de charge", None, "Nappe connecteur charge iPhone 13 Pro Max", 14.00, "standard"),
    ("Apple", "iPhone 13 Pro", "Connecteur de charge", None, "Nappe connecteur charge iPhone 13 Pro", 13.00, "standard"),
    ("Apple", "iPhone 13", "Connecteur de charge", None, "Nappe connecteur charge iPhone 13", 12.00, "standard"),
    ("Apple", "iPhone 13 Mini", "Connecteur de charge", None, "Nappe connecteur charge iPhone 13 Mini", 12.00, "standard"),
    ("Apple", "iPhone 12 Pro Max", "Connecteur de charge", None, "Nappe connecteur charge iPhone 12 Pro Max", 12.00, "standard"),
    ("Apple", "iPhone 12 / 12 Pro", "Connecteur de charge", None, "Nappe connecteur charge iPhone 12/12 Pro", 10.00, "standard"),
    ("Apple", "iPhone 12 Mini", "Connecteur de charge", None, "Nappe connecteur charge iPhone 12 Mini", 10.00, "standard"),
    ("Apple", "iPhone 11 Pro Max", "Connecteur de charge", None, "Nappe connecteur charge iPhone 11 Pro Max", 10.00, "standard"),
    ("Apple", "iPhone 11 Pro", "Connecteur de charge", None, "Nappe connecteur charge iPhone 11 Pro", 9.50, "standard"),
    ("Apple", "iPhone 11", "Connecteur de charge", None, "Nappe connecteur charge iPhone 11", 9.00, "standard"),
    ("Apple", "iPhone XS Max", "Connecteur de charge", None, "Nappe connecteur charge iPhone XS Max", 8.50, "standard"),
    ("Apple", "iPhone XS", "Connecteur de charge", None, "Nappe connecteur charge iPhone XS", 8.00, "standard"),
    ("Apple", "iPhone XR", "Connecteur de charge", None, "Nappe connecteur charge iPhone XR", 8.00, "standard"),
    ("Apple", "iPhone X", "Connecteur de charge", None, "Nappe connecteur charge iPhone X", 8.00, "standard"),
    ("Apple", "iPhone 8", "Connecteur de charge", None, "Nappe connecteur charge iPhone 8", 6.50, "standard"),
    ("Apple", "iPhone 8 Plus", "Connecteur de charge", None, "Nappe connecteur charge iPhone 8 Plus", 7.00, "standard"),
    ("Apple", "iPhone 7", "Connecteur de charge", None, "Nappe connecteur charge iPhone 7", 6.00, "standard"),
    ("Apple", "iPhone 7 Plus", "Connecteur de charge", None, "Nappe connecteur charge iPhone 7 Plus", 6.50, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  APPLE iPHONE — CAMERAS ARRIERE                            ║
    # ╚══════════════════════════════════════════════════════════════╝
    ("Apple", "iPhone 15 Pro Max", "Camera arriere", None, "Camera arriere iPhone 15 Pro Max", 65.00, "standard"),
    ("Apple", "iPhone 15 Pro", "Camera arriere", None, "Camera arriere iPhone 15 Pro", 58.00, "standard"),
    ("Apple", "iPhone 15 Plus", "Camera arriere", None, "Camera arriere iPhone 15 Plus", 38.00, "standard"),
    ("Apple", "iPhone 15", "Camera arriere", None, "Camera arriere iPhone 15", 35.00, "standard"),
    ("Apple", "iPhone 14 Pro Max", "Camera arriere", None, "Camera arriere iPhone 14 Pro Max", 55.00, "standard"),
    ("Apple", "iPhone 14 Pro", "Camera arriere", None, "Camera arriere iPhone 14 Pro", 48.00, "standard"),
    ("Apple", "iPhone 14 Plus", "Camera arriere", None, "Camera arriere iPhone 14 Plus", 30.00, "standard"),
    ("Apple", "iPhone 14", "Camera arriere", None, "Camera arriere iPhone 14", 28.00, "standard"),
    ("Apple", "iPhone 13 Pro Max", "Camera arriere", None, "Camera arriere iPhone 13 Pro Max", 42.00, "standard"),
    ("Apple", "iPhone 13 Pro", "Camera arriere", None, "Camera arriere iPhone 13 Pro", 38.00, "standard"),
    ("Apple", "iPhone 13", "Camera arriere", None, "Camera arriere iPhone 13", 22.00, "standard"),
    ("Apple", "iPhone 12 Pro Max", "Camera arriere", None, "Camera arriere iPhone 12 Pro Max", 32.00, "standard"),
    ("Apple", "iPhone 12 / 12 Pro", "Camera arriere", None, "Camera arriere iPhone 12/12 Pro", 25.00, "standard"),
    ("Apple", "iPhone 11 Pro Max", "Camera arriere", None, "Camera arriere iPhone 11 Pro Max", 25.00, "standard"),
    ("Apple", "iPhone 11 Pro", "Camera arriere", None, "Camera arriere iPhone 11 Pro", 22.00, "standard"),
    ("Apple", "iPhone 11", "Camera arriere", None, "Camera arriere iPhone 11", 18.00, "standard"),
    ("Apple", "iPhone XS Max", "Camera arriere", None, "Camera arriere iPhone XS Max", 18.00, "standard"),
    ("Apple", "iPhone XS", "Camera arriere", None, "Camera arriere iPhone XS", 16.00, "standard"),
    ("Apple", "iPhone XR", "Camera arriere", None, "Camera arriere iPhone XR", 14.00, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  APPLE iPHONE — VITRES ARRIERE                             ║
    # ╚══════════════════════════════════════════════════════════════╝
    ("Apple", "iPhone 15 Pro Max", "Vitre arriere", None, "Vitre arriere iPhone 15 Pro Max", 28.00, "standard"),
    ("Apple", "iPhone 15 Pro", "Vitre arriere", None, "Vitre arriere iPhone 15 Pro", 26.00, "standard"),
    ("Apple", "iPhone 15 Plus", "Vitre arriere", None, "Vitre arriere iPhone 15 Plus", 22.00, "standard"),
    ("Apple", "iPhone 15", "Vitre arriere", None, "Vitre arriere iPhone 15", 20.00, "standard"),
    ("Apple", "iPhone 14 Pro Max", "Vitre arriere", None, "Vitre arriere iPhone 14 Pro Max", 25.00, "standard"),
    ("Apple", "iPhone 14 Pro", "Vitre arriere", None, "Vitre arriere iPhone 14 Pro", 22.00, "standard"),
    ("Apple", "iPhone 14 Plus", "Vitre arriere", None, "Vitre arriere iPhone 14 Plus", 18.00, "standard"),
    ("Apple", "iPhone 14", "Vitre arriere", None, "Vitre arriere iPhone 14", 16.00, "standard"),
    ("Apple", "iPhone 13 Pro Max", "Vitre arriere", None, "Vitre arriere iPhone 13 Pro Max", 20.00, "standard"),
    ("Apple", "iPhone 13 Pro", "Vitre arriere", None, "Vitre arriere iPhone 13 Pro", 18.00, "standard"),
    ("Apple", "iPhone 13", "Vitre arriere", None, "Vitre arriere iPhone 13", 14.00, "standard"),
    ("Apple", "iPhone 12 Pro Max", "Vitre arriere", None, "Vitre arriere iPhone 12 Pro Max", 16.00, "standard"),
    ("Apple", "iPhone 12 / 12 Pro", "Vitre arriere", None, "Vitre arriere iPhone 12/12 Pro", 14.00, "standard"),
    ("Apple", "iPhone 11 Pro Max", "Vitre arriere", None, "Vitre arriere iPhone 11 Pro Max", 14.00, "standard"),
    ("Apple", "iPhone 11 Pro", "Vitre arriere", None, "Vitre arriere iPhone 11 Pro", 12.00, "standard"),
    ("Apple", "iPhone 11", "Vitre arriere", None, "Vitre arriere iPhone 11", 10.00, "standard"),
    ("Apple", "iPhone XS Max", "Vitre arriere", None, "Vitre arriere iPhone XS Max", 10.00, "standard"),
    ("Apple", "iPhone XS", "Vitre arriere", None, "Vitre arriere iPhone XS", 9.00, "standard"),
    ("Apple", "iPhone XR", "Vitre arriere", None, "Vitre arriere iPhone XR", 8.00, "standard"),
    ("Apple", "iPhone 8", "Vitre arriere", None, "Vitre arriere iPhone 8", 6.00, "standard"),
    ("Apple", "iPhone 8 Plus", "Vitre arriere", None, "Vitre arriere iPhone 8 Plus", 7.00, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  APPLE iPHONE — HAUT-PARLEURS                              ║
    # ╚══════════════════════════════════════════════════════════════╝
    ("Apple", "iPhone 15 Pro Max", "Haut-parleur", None, "Haut-parleur iPhone 15 Pro Max", 8.00, "standard"),
    ("Apple", "iPhone 15 Pro", "Haut-parleur", None, "Haut-parleur iPhone 15 Pro", 7.50, "standard"),
    ("Apple", "iPhone 15", "Haut-parleur", None, "Haut-parleur iPhone 15", 7.00, "standard"),
    ("Apple", "iPhone 14 Pro Max", "Haut-parleur", None, "Haut-parleur iPhone 14 Pro Max", 7.00, "standard"),
    ("Apple", "iPhone 14 Pro", "Haut-parleur", None, "Haut-parleur iPhone 14 Pro", 6.50, "standard"),
    ("Apple", "iPhone 14", "Haut-parleur", None, "Haut-parleur iPhone 14", 6.00, "standard"),
    ("Apple", "iPhone 13 Pro Max", "Haut-parleur", None, "Haut-parleur iPhone 13 Pro Max", 6.00, "standard"),
    ("Apple", "iPhone 13 Pro", "Haut-parleur", None, "Haut-parleur iPhone 13 Pro", 5.50, "standard"),
    ("Apple", "iPhone 13", "Haut-parleur", None, "Haut-parleur iPhone 13", 5.00, "standard"),
    ("Apple", "iPhone 12 / 12 Pro", "Haut-parleur", None, "Haut-parleur iPhone 12/12 Pro", 5.00, "standard"),
    ("Apple", "iPhone 11", "Haut-parleur", None, "Haut-parleur iPhone 11", 4.50, "standard"),
    ("Apple", "iPhone XR", "Haut-parleur", None, "Haut-parleur iPhone XR", 4.00, "standard"),
    ("Apple", "iPhone X", "Haut-parleur", None, "Haut-parleur iPhone X", 4.00, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  APPLE iPHONE — ECOUTEURS (earpiece)                       ║
    # ╚══════════════════════════════════════════════════════════════╝
    ("Apple", "iPhone 15 Pro Max", "Ecouteur interne", None, "Ecouteur interne iPhone 15 Pro Max", 6.00, "standard"),
    ("Apple", "iPhone 15 Pro", "Ecouteur interne", None, "Ecouteur interne iPhone 15 Pro", 5.50, "standard"),
    ("Apple", "iPhone 14 Pro Max", "Ecouteur interne", None, "Ecouteur interne iPhone 14 Pro Max", 5.50, "standard"),
    ("Apple", "iPhone 14 Pro", "Ecouteur interne", None, "Ecouteur interne iPhone 14 Pro", 5.00, "standard"),
    ("Apple", "iPhone 13 Pro Max", "Ecouteur interne", None, "Ecouteur interne iPhone 13 Pro Max", 5.00, "standard"),
    ("Apple", "iPhone 13", "Ecouteur interne", None, "Ecouteur interne iPhone 13", 4.50, "standard"),
    ("Apple", "iPhone 12 / 12 Pro", "Ecouteur interne", None, "Ecouteur interne iPhone 12/12 Pro", 4.00, "standard"),
    ("Apple", "iPhone 11", "Ecouteur interne", None, "Ecouteur interne iPhone 11", 3.50, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  APPLE iPHONE — VITRE CAMERA ARRIERE                      ║
    # ╚══════════════════════════════════════════════════════════════╝
    ("Apple", "iPhone 15 Pro Max", "Vitre camera arriere", None, "Vitre camera arriere iPhone 15 Pro Max", 5.00, "standard"),
    ("Apple", "iPhone 15 Pro", "Vitre camera arriere", None, "Vitre camera arriere iPhone 15 Pro", 4.50, "standard"),
    ("Apple", "iPhone 15", "Vitre camera arriere", None, "Vitre camera arriere iPhone 15", 4.00, "standard"),
    ("Apple", "iPhone 14 Pro Max", "Vitre camera arriere", None, "Vitre camera arriere iPhone 14 Pro Max", 4.50, "standard"),
    ("Apple", "iPhone 14 Pro", "Vitre camera arriere", None, "Vitre camera arriere iPhone 14 Pro", 4.00, "standard"),
    ("Apple", "iPhone 14", "Vitre camera arriere", None, "Vitre camera arriere iPhone 14", 3.50, "standard"),
    ("Apple", "iPhone 13 Pro Max", "Vitre camera arriere", None, "Vitre camera arriere iPhone 13 Pro Max", 4.00, "standard"),
    ("Apple", "iPhone 13 Pro", "Vitre camera arriere", None, "Vitre camera arriere iPhone 13 Pro", 3.50, "standard"),
    ("Apple", "iPhone 13", "Vitre camera arriere", None, "Vitre camera arriere iPhone 13", 3.00, "standard"),
    ("Apple", "iPhone 12 Pro Max", "Vitre camera arriere", None, "Vitre camera arriere iPhone 12 Pro Max", 3.50, "standard"),
    ("Apple", "iPhone 12 / 12 Pro", "Vitre camera arriere", None, "Vitre camera arriere iPhone 12/12 Pro", 3.00, "standard"),
    ("Apple", "iPhone 11 Pro Max", "Vitre camera arriere", None, "Vitre camera arriere iPhone 11 Pro Max", 3.00, "standard"),
    ("Apple", "iPhone 11", "Vitre camera arriere", None, "Vitre camera arriere iPhone 11", 2.50, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  APPLE iPad — ECRANS                                       ║
    # ╚══════════════════════════════════════════════════════════════╝
    ("Apple", "iPad Pro 12.9 (2021/2022)", "Ecran", "Original", "Ecran Original iPad Pro 12.9 M1/M2", 320.00, "haut_de_gamme"),
    ("Apple", "iPad Pro 11 (2021/2022)", "Ecran", "Original", "Ecran Original iPad Pro 11 M1/M2", 240.00, "haut_de_gamme"),
    ("Apple", "iPad Air 5 (2022)", "Ecran", "Original", "Ecran Original iPad Air 5", 135.00, "standard"),
    ("Apple", "iPad Air 4 (2020)", "Ecran", "Original", "Ecran Original iPad Air 4", 110.00, "standard"),
    ("Apple", "iPad 10 (2022)", "Ecran", "Original", "Ecran Original iPad 10", 85.00, "standard"),
    ("Apple", "iPad 9 (2021)", "Ecran", "Original", "Ecran Original iPad 9", 48.00, "standard"),
    ("Apple", "iPad 9 (2021)", "Ecran", "Compatible", "Ecran Compatible iPad 9", 28.00, "standard"),
    ("Apple", "iPad 8 (2020)", "Ecran", "Original", "Ecran Original iPad 8", 42.00, "standard"),
    ("Apple", "iPad 8 (2020)", "Ecran", "Compatible", "Ecran Compatible iPad 8", 25.00, "standard"),
    ("Apple", "iPad 7 (2019)", "Ecran", "Original", "Ecran Original iPad 7", 38.00, "standard"),
    ("Apple", "iPad 7 (2019)", "Ecran", "Compatible", "Ecran Compatible iPad 7", 22.00, "standard"),
    ("Apple", "iPad Mini 6 (2021)", "Ecran", "Original", "Ecran Original iPad Mini 6", 95.00, "standard"),
    ("Apple", "iPad Mini 5 (2019)", "Ecran", "Original", "Ecran Original iPad Mini 5", 52.00, "standard"),

    # iPad Batteries
    ("Apple", "iPad 9 (2021)", "Batterie", None, "Batterie iPad 9", 18.00, "standard"),
    ("Apple", "iPad 8 (2020)", "Batterie", None, "Batterie iPad 8", 16.00, "standard"),
    ("Apple", "iPad Air 4 (2020)", "Batterie", None, "Batterie iPad Air 4", 22.00, "standard"),
    ("Apple", "iPad Mini 6 (2021)", "Batterie", None, "Batterie iPad Mini 6", 20.00, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  SAMSUNG — ECRANS                                          ║
    # ╚══════════════════════════════════════════════════════════════╝

    # Galaxy S25 Ultra
    ("Samsung", "Galaxy S25 Ultra", "Ecran", "Original", "Ecran Original Samsung S25 Ultra", 350.00, "haut_de_gamme"),
    ("Samsung", "Galaxy S25 Ultra", "Ecran", "Soft OLED", "Ecran Soft OLED Samsung S25 Ultra", 195.00, "haut_de_gamme"),

    # Galaxy S25+
    ("Samsung", "Galaxy S25+", "Ecran", "Original", "Ecran Original Samsung S25+", 265.00, "haut_de_gamme"),
    ("Samsung", "Galaxy S25+", "Ecran", "Soft OLED", "Ecran Soft OLED Samsung S25+", 150.00, "haut_de_gamme"),

    # Galaxy S25
    ("Samsung", "Galaxy S25", "Ecran", "Original", "Ecran Original Samsung S25", 210.00, "haut_de_gamme"),
    ("Samsung", "Galaxy S25", "Ecran", "Soft OLED", "Ecran Soft OLED Samsung S25", 120.00, "haut_de_gamme"),

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

    # Galaxy S24 FE
    ("Samsung", "Galaxy S24 FE", "Ecran", "Original", "Ecran Original Samsung S24 FE", 115.00, "standard"),
    ("Samsung", "Galaxy S24 FE", "Ecran", "Soft OLED", "Ecran Soft OLED Samsung S24 FE", 68.00, "standard"),

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

    # Galaxy S23 FE
    ("Samsung", "Galaxy S23 FE", "Ecran", "Original", "Ecran Original Samsung S23 FE", 95.00, "standard"),
    ("Samsung", "Galaxy S23 FE", "Ecran", "Soft OLED", "Ecran Soft OLED Samsung S23 FE", 55.00, "standard"),

    # Galaxy S22 Ultra
    ("Samsung", "Galaxy S22 Ultra", "Ecran", "Original", "Ecran Original Samsung S22 Ultra", 220.00, "haut_de_gamme"),
    ("Samsung", "Galaxy S22 Ultra", "Ecran", "Soft OLED", "Ecran Soft OLED Samsung S22 Ultra", 125.00, "haut_de_gamme"),

    # Galaxy S22+
    ("Samsung", "Galaxy S22+", "Ecran", "Original", "Ecran Original Samsung S22+", 165.00, "haut_de_gamme"),
    ("Samsung", "Galaxy S22+", "Ecran", "Soft OLED", "Ecran Soft OLED Samsung S22+", 90.00, "haut_de_gamme"),

    # Galaxy S22
    ("Samsung", "Galaxy S22", "Ecran", "Original", "Ecran Original Samsung S22", 135.00, "standard"),
    ("Samsung", "Galaxy S22", "Ecran", "Soft OLED", "Ecran Soft OLED Samsung S22", 78.00, "standard"),

    # Galaxy S21 Ultra
    ("Samsung", "Galaxy S21 Ultra", "Ecran", "Original", "Ecran Original Samsung S21 Ultra", 185.00, "haut_de_gamme"),
    ("Samsung", "Galaxy S21 Ultra", "Ecran", "Soft OLED", "Ecran Soft OLED Samsung S21 Ultra", 110.00, "haut_de_gamme"),

    # Galaxy S21+
    ("Samsung", "Galaxy S21+", "Ecran", "Original", "Ecran Original Samsung S21+", 145.00, "standard"),
    ("Samsung", "Galaxy S21+", "Ecran", "Soft OLED", "Ecran Soft OLED Samsung S21+", 82.00, "standard"),

    # Galaxy S21
    ("Samsung", "Galaxy S21", "Ecran", "Original", "Ecran Original Samsung S21", 120.00, "standard"),
    ("Samsung", "Galaxy S21", "Ecran", "Soft OLED", "Ecran Soft OLED Samsung S21", 68.00, "standard"),

    # Galaxy S21 FE
    ("Samsung", "Galaxy S21 FE", "Ecran", "Original", "Ecran Original Samsung S21 FE", 95.00, "standard"),
    ("Samsung", "Galaxy S21 FE", "Ecran", "Soft OLED", "Ecran Soft OLED Samsung S21 FE", 55.00, "standard"),

    # Galaxy S20 Ultra
    ("Samsung", "Galaxy S20 Ultra", "Ecran", "Original", "Ecran Original Samsung S20 Ultra", 165.00, "haut_de_gamme"),
    # Galaxy S20+
    ("Samsung", "Galaxy S20+", "Ecran", "Original", "Ecran Original Samsung S20+", 120.00, "standard"),
    # Galaxy S20
    ("Samsung", "Galaxy S20", "Ecran", "Original", "Ecran Original Samsung S20", 105.00, "standard"),
    # Galaxy S20 FE
    ("Samsung", "Galaxy S20 FE", "Ecran", "Original", "Ecran Original Samsung S20 FE", 72.00, "standard"),
    ("Samsung", "Galaxy S20 FE", "Ecran", "Soft OLED", "Ecran Soft OLED Samsung S20 FE", 42.00, "standard"),

    # Galaxy Note 20 Ultra
    ("Samsung", "Galaxy Note 20 Ultra", "Ecran", "Original", "Ecran Original Samsung Note 20 Ultra", 175.00, "haut_de_gamme"),
    # Galaxy Note 20
    ("Samsung", "Galaxy Note 20", "Ecran", "Original", "Ecran Original Samsung Note 20", 110.00, "standard"),
    # Galaxy Note 10+
    ("Samsung", "Galaxy Note 10+", "Ecran", "Original", "Ecran Original Samsung Note 10+", 120.00, "standard"),
    # Galaxy Note 10
    ("Samsung", "Galaxy Note 10", "Ecran", "Original", "Ecran Original Samsung Note 10", 95.00, "standard"),

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

    # Galaxy A52 / A52s
    ("Samsung", "Galaxy A52 / A52s", "Ecran", "Original", "Ecran Original Samsung A52/A52s", 52.00, "standard"),
    ("Samsung", "Galaxy A52 / A52s", "Ecran", "Incell", "Ecran Incell Samsung A52/A52s", 24.00, "standard"),

    # Galaxy A51
    ("Samsung", "Galaxy A51", "Ecran", "Original", "Ecran Original Samsung A51", 45.00, "standard"),
    ("Samsung", "Galaxy A51", "Ecran", "Incell", "Ecran Incell Samsung A51", 22.00, "standard"),

    # Galaxy A35
    ("Samsung", "Galaxy A35", "Ecran", "Original", "Ecran Original Samsung A35", 58.00, "standard"),
    ("Samsung", "Galaxy A35", "Ecran", "Incell", "Ecran Incell Samsung A35", 28.00, "standard"),

    # Galaxy A34
    ("Samsung", "Galaxy A34", "Ecran", "Original", "Ecran Original Samsung A34", 52.00, "standard"),
    ("Samsung", "Galaxy A34", "Ecran", "Incell", "Ecran Incell Samsung A34", 25.00, "standard"),

    # Galaxy A33
    ("Samsung", "Galaxy A33", "Ecran", "Original", "Ecran Original Samsung A33", 48.00, "standard"),
    ("Samsung", "Galaxy A33", "Ecran", "Incell", "Ecran Incell Samsung A33", 24.00, "standard"),

    # Galaxy A25
    ("Samsung", "Galaxy A25", "Ecran", "Original", "Ecran Original Samsung A25", 42.00, "standard"),
    ("Samsung", "Galaxy A25", "Ecran", "Incell", "Ecran Incell Samsung A25", 22.00, "standard"),

    # Galaxy A24
    ("Samsung", "Galaxy A24", "Ecran", "Original", "Ecran Original Samsung A24", 38.00, "standard"),
    ("Samsung", "Galaxy A24", "Ecran", "Incell", "Ecran Incell Samsung A24", 20.00, "standard"),

    # Galaxy A15
    ("Samsung", "Galaxy A15", "Ecran", "Original", "Ecran Original Samsung A15", 32.00, "standard"),
    ("Samsung", "Galaxy A15", "Ecran", "Compatible", "Ecran Compatible Samsung A15", 18.00, "standard"),
    ("Samsung", "Galaxy A15", "Ecran", "LCD", "Ecran LCD Samsung A15", 14.00, "standard"),

    # Galaxy A14
    ("Samsung", "Galaxy A14", "Ecran", "Original", "Ecran Original Samsung A14", 28.00, "standard"),
    ("Samsung", "Galaxy A14", "Ecran", "Compatible", "Ecran Compatible Samsung A14", 16.00, "standard"),
    ("Samsung", "Galaxy A14", "Ecran", "LCD", "Ecran LCD Samsung A14", 12.00, "standard"),

    # Galaxy A13
    ("Samsung", "Galaxy A13", "Ecran", "Original", "Ecran Original Samsung A13", 26.00, "standard"),
    ("Samsung", "Galaxy A13", "Ecran", "Compatible", "Ecran Compatible Samsung A13", 15.00, "standard"),
    ("Samsung", "Galaxy A13", "Ecran", "LCD", "Ecran LCD Samsung A13", 11.00, "standard"),

    # Galaxy A12
    ("Samsung", "Galaxy A12", "Ecran", "Original", "Ecran Original Samsung A12", 25.00, "standard"),
    ("Samsung", "Galaxy A12", "Ecran", "Compatible", "Ecran Compatible Samsung A12", 14.00, "standard"),
    ("Samsung", "Galaxy A12", "Ecran", "LCD", "Ecran LCD Samsung A12", 10.00, "standard"),

    # Galaxy A05s
    ("Samsung", "Galaxy A05s", "Ecran", "Original", "Ecran Original Samsung A05s", 22.00, "standard"),
    ("Samsung", "Galaxy A05s", "Ecran", "Compatible", "Ecran Compatible Samsung A05s", 13.00, "standard"),
    ("Samsung", "Galaxy A05s", "Ecran", "LCD", "Ecran LCD Samsung A05s", 10.00, "standard"),

    # Galaxy A06
    ("Samsung", "Galaxy A06", "Ecran", "Original", "Ecran Original Samsung A06", 22.00, "standard"),
    ("Samsung", "Galaxy A06", "Ecran", "Compatible", "Ecran Compatible Samsung A06", 13.00, "standard"),
    ("Samsung", "Galaxy A06", "Ecran", "LCD", "Ecran LCD Samsung A06", 10.00, "standard"),

    # Galaxy A05
    ("Samsung", "Galaxy A05", "Ecran", "Original", "Ecran Original Samsung A05", 20.00, "standard"),
    ("Samsung", "Galaxy A05", "Ecran", "Compatible", "Ecran Compatible Samsung A05", 12.00, "standard"),
    ("Samsung", "Galaxy A05", "Ecran", "LCD", "Ecran LCD Samsung A05", 9.00, "standard"),

    # Galaxy M54
    ("Samsung", "Galaxy M54", "Ecran", "Original", "Ecran Original Samsung M54", 52.00, "standard"),
    ("Samsung", "Galaxy M54", "Ecran", "Incell", "Ecran Incell Samsung M54", 28.00, "standard"),

    # Galaxy M34
    ("Samsung", "Galaxy M34", "Ecran", "Original", "Ecran Original Samsung M34", 42.00, "standard"),
    ("Samsung", "Galaxy M34", "Ecran", "Incell", "Ecran Incell Samsung M34", 22.00, "standard"),

    # Galaxy M14
    ("Samsung", "Galaxy M14", "Ecran", "Original", "Ecran Original Samsung M14", 28.00, "standard"),
    ("Samsung", "Galaxy M14", "Ecran", "Compatible", "Ecran Compatible Samsung M14", 16.00, "standard"),
    ("Samsung", "Galaxy M14", "Ecran", "LCD", "Ecran LCD Samsung M14", 12.00, "standard"),

    # Galaxy Z Flip 5
    ("Samsung", "Galaxy Z Flip 5", "Ecran", "Original", "Ecran int. Original Samsung Z Flip 5", 280.00, "pliant"),
    # Galaxy Z Flip 4
    ("Samsung", "Galaxy Z Flip 4", "Ecran", "Original", "Ecran int. Original Samsung Z Flip 4", 240.00, "pliant"),
    # Galaxy Z Fold 5
    ("Samsung", "Galaxy Z Fold 5", "Ecran", "Original", "Ecran int. Original Samsung Z Fold 5", 380.00, "pliant"),
    # Galaxy Z Fold 4
    ("Samsung", "Galaxy Z Fold 4", "Ecran", "Original", "Ecran int. Original Samsung Z Fold 4", 340.00, "pliant"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  SAMSUNG — BATTERIES                                       ║
    # ╚══════════════════════════════════════════════════════════════╝
    ("Samsung", "Galaxy S25 Ultra", "Batterie", None, "Batterie Samsung S25 Ultra", 19.00, "standard"),
    ("Samsung", "Galaxy S25+", "Batterie", None, "Batterie Samsung S25+", 17.00, "standard"),
    ("Samsung", "Galaxy S25", "Batterie", None, "Batterie Samsung S25", 15.00, "standard"),
    ("Samsung", "Galaxy S24 Ultra", "Batterie", None, "Batterie Samsung S24 Ultra", 18.00, "standard"),
    ("Samsung", "Galaxy S24+", "Batterie", None, "Batterie Samsung S24+", 16.00, "standard"),
    ("Samsung", "Galaxy S24", "Batterie", None, "Batterie Samsung S24", 14.00, "standard"),
    ("Samsung", "Galaxy S23 Ultra", "Batterie", None, "Batterie Samsung S23 Ultra", 16.00, "standard"),
    ("Samsung", "Galaxy S23+", "Batterie", None, "Batterie Samsung S23+", 14.00, "standard"),
    ("Samsung", "Galaxy S23", "Batterie", None, "Batterie Samsung S23", 13.00, "standard"),
    ("Samsung", "Galaxy S22 Ultra", "Batterie", None, "Batterie Samsung S22 Ultra", 14.00, "standard"),
    ("Samsung", "Galaxy S22+", "Batterie", None, "Batterie Samsung S22+", 13.00, "standard"),
    ("Samsung", "Galaxy S22", "Batterie", None, "Batterie Samsung S22", 12.00, "standard"),
    ("Samsung", "Galaxy S21 Ultra", "Batterie", None, "Batterie Samsung S21 Ultra", 13.00, "standard"),
    ("Samsung", "Galaxy S21", "Batterie", None, "Batterie Samsung S21", 11.00, "standard"),
    ("Samsung", "Galaxy S20 FE", "Batterie", None, "Batterie Samsung S20 FE", 11.00, "standard"),
    ("Samsung", "Galaxy A55", "Batterie", None, "Batterie Samsung A55", 12.00, "standard"),
    ("Samsung", "Galaxy A54", "Batterie", None, "Batterie Samsung A54", 11.00, "standard"),
    ("Samsung", "Galaxy A53", "Batterie", None, "Batterie Samsung A53", 10.00, "standard"),
    ("Samsung", "Galaxy A52 / A52s", "Batterie", None, "Batterie Samsung A52/A52s", 10.00, "standard"),
    ("Samsung", "Galaxy A51", "Batterie", None, "Batterie Samsung A51", 9.50, "standard"),
    ("Samsung", "Galaxy A35", "Batterie", None, "Batterie Samsung A35", 10.50, "standard"),
    ("Samsung", "Galaxy A34", "Batterie", None, "Batterie Samsung A34", 10.00, "standard"),
    ("Samsung", "Galaxy A25", "Batterie", None, "Batterie Samsung A25", 9.00, "standard"),
    ("Samsung", "Galaxy A15", "Batterie", None, "Batterie Samsung A15", 8.50, "standard"),
    ("Samsung", "Galaxy A14", "Batterie", None, "Batterie Samsung A14", 8.00, "standard"),
    ("Samsung", "Galaxy A13", "Batterie", None, "Batterie Samsung A13", 8.00, "standard"),
    ("Samsung", "Galaxy A12", "Batterie", None, "Batterie Samsung A12", 7.50, "standard"),
    ("Samsung", "Galaxy A06", "Batterie", None, "Batterie Samsung A06", 7.50, "standard"),
    ("Samsung", "Galaxy A05", "Batterie", None, "Batterie Samsung A05", 7.00, "standard"),
    ("Samsung", "Galaxy M54", "Batterie", None, "Batterie Samsung M54", 10.00, "standard"),
    ("Samsung", "Galaxy M34", "Batterie", None, "Batterie Samsung M34", 9.00, "standard"),
    ("Samsung", "Galaxy M14", "Batterie", None, "Batterie Samsung M14", 8.00, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  SAMSUNG — CONNECTEURS                                     ║
    # ╚══════════════════════════════════════════════════════════════╝
    ("Samsung", "Galaxy S25 Ultra", "Connecteur de charge", None, "Nappe connecteur Samsung S25 Ultra", 19.00, "standard"),
    ("Samsung", "Galaxy S24 Ultra", "Connecteur de charge", None, "Nappe connecteur Samsung S24 Ultra", 18.00, "standard"),
    ("Samsung", "Galaxy S24", "Connecteur de charge", None, "Nappe connecteur Samsung S24", 15.00, "standard"),
    ("Samsung", "Galaxy S23 Ultra", "Connecteur de charge", None, "Nappe connecteur Samsung S23 Ultra", 16.00, "standard"),
    ("Samsung", "Galaxy S23", "Connecteur de charge", None, "Nappe connecteur Samsung S23", 13.00, "standard"),
    ("Samsung", "Galaxy S22 Ultra", "Connecteur de charge", None, "Nappe connecteur Samsung S22 Ultra", 14.00, "standard"),
    ("Samsung", "Galaxy S22", "Connecteur de charge", None, "Nappe connecteur Samsung S22", 12.00, "standard"),
    ("Samsung", "Galaxy S21", "Connecteur de charge", None, "Nappe connecteur Samsung S21", 10.00, "standard"),
    ("Samsung", "Galaxy A55", "Connecteur de charge", None, "Nappe connecteur Samsung A55", 10.00, "standard"),
    ("Samsung", "Galaxy A54", "Connecteur de charge", None, "Nappe connecteur Samsung A54", 9.00, "standard"),
    ("Samsung", "Galaxy A53", "Connecteur de charge", None, "Nappe connecteur Samsung A53", 8.50, "standard"),
    ("Samsung", "Galaxy A52 / A52s", "Connecteur de charge", None, "Nappe connecteur Samsung A52/A52s", 8.00, "standard"),
    ("Samsung", "Galaxy A51", "Connecteur de charge", None, "Nappe connecteur Samsung A51", 7.50, "standard"),
    ("Samsung", "Galaxy A34", "Connecteur de charge", None, "Nappe connecteur Samsung A34", 8.00, "standard"),
    ("Samsung", "Galaxy A25", "Connecteur de charge", None, "Nappe connecteur Samsung A25", 7.00, "standard"),
    ("Samsung", "Galaxy A15", "Connecteur de charge", None, "Nappe connecteur Samsung A15", 6.50, "standard"),
    ("Samsung", "Galaxy A14", "Connecteur de charge", None, "Nappe connecteur Samsung A14", 6.00, "standard"),
    ("Samsung", "Galaxy A13", "Connecteur de charge", None, "Nappe connecteur Samsung A13", 6.00, "standard"),
    ("Samsung", "Galaxy A12", "Connecteur de charge", None, "Nappe connecteur Samsung A12", 5.50, "standard"),
    ("Samsung", "Galaxy A06", "Connecteur de charge", None, "Nappe connecteur Samsung A06", 5.50, "standard"),
    ("Samsung", "Galaxy A05", "Connecteur de charge", None, "Nappe connecteur Samsung A05", 5.00, "standard"),
    ("Samsung", "Galaxy M54", "Connecteur de charge", None, "Nappe connecteur Samsung M54", 8.00, "standard"),
    ("Samsung", "Galaxy M34", "Connecteur de charge", None, "Nappe connecteur Samsung M34", 7.00, "standard"),
    ("Samsung", "Galaxy M14", "Connecteur de charge", None, "Nappe connecteur Samsung M14", 6.00, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  SAMSUNG — CAMERAS ARRIERE                                 ║
    # ╚══════════════════════════════════════════════════════════════╝
    ("Samsung", "Galaxy S24 Ultra", "Camera arriere", None, "Camera arriere Samsung S24 Ultra", 62.00, "standard"),
    ("Samsung", "Galaxy S24", "Camera arriere", None, "Camera arriere Samsung S24", 42.00, "standard"),
    ("Samsung", "Galaxy S23 Ultra", "Camera arriere", None, "Camera arriere Samsung S23 Ultra", 55.00, "standard"),
    ("Samsung", "Galaxy S23", "Camera arriere", None, "Camera arriere Samsung S23", 38.00, "standard"),
    ("Samsung", "Galaxy A54", "Camera arriere", None, "Camera arriere Samsung A54", 18.00, "standard"),
    ("Samsung", "Galaxy A53", "Camera arriere", None, "Camera arriere Samsung A53", 16.00, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  SAMSUNG — VITRES ARRIERE                                  ║
    # ╚══════════════════════════════════════════════════════════════╝
    ("Samsung", "Galaxy S24 Ultra", "Vitre arriere", None, "Vitre arriere Samsung S24 Ultra", 18.00, "standard"),
    ("Samsung", "Galaxy S24", "Vitre arriere", None, "Vitre arriere Samsung S24", 14.00, "standard"),
    ("Samsung", "Galaxy S23 Ultra", "Vitre arriere", None, "Vitre arriere Samsung S23 Ultra", 16.00, "standard"),
    ("Samsung", "Galaxy S23", "Vitre arriere", None, "Vitre arriere Samsung S23", 12.00, "standard"),
    ("Samsung", "Galaxy S22 Ultra", "Vitre arriere", None, "Vitre arriere Samsung S22 Ultra", 14.00, "standard"),
    ("Samsung", "Galaxy S22", "Vitre arriere", None, "Vitre arriere Samsung S22", 10.00, "standard"),
    ("Samsung", "Galaxy S21", "Vitre arriere", None, "Vitre arriere Samsung S21", 9.00, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  XIAOMI — ECRANS (Gamme principale)                        ║
    # ╚══════════════════════════════════════════════════════════════╝

    # Xiaomi 14 Ultra
    ("Xiaomi", "14 Ultra", "Ecran", "Original", "Ecran Original Xiaomi 14 Ultra", 180.00, "haut_de_gamme"),
    # Xiaomi 14 Pro
    ("Xiaomi", "14 Pro", "Ecran", "Original", "Ecran Original Xiaomi 14 Pro", 155.00, "haut_de_gamme"),
    # Xiaomi 14
    ("Xiaomi", "14", "Ecran", "Original", "Ecran Original Xiaomi 14", 95.00, "haut_de_gamme"),
    # Xiaomi 13T Pro
    ("Xiaomi", "13T Pro", "Ecran", "Original", "Ecran Original Xiaomi 13T Pro", 85.00, "standard"),
    # Xiaomi 13T
    ("Xiaomi", "13T", "Ecran", "Original", "Ecran Original Xiaomi 13T", 68.00, "standard"),
    ("Xiaomi", "13T", "Ecran", "Incell", "Ecran Incell Xiaomi 13T", 35.00, "standard"),
    # Xiaomi 13 Pro
    ("Xiaomi", "13 Pro", "Ecran", "Original", "Ecran Original Xiaomi 13 Pro", 125.00, "haut_de_gamme"),
    # Xiaomi 13
    ("Xiaomi", "13", "Ecran", "Original", "Ecran Original Xiaomi 13", 80.00, "standard"),
    ("Xiaomi", "13", "Ecran", "OLED", "Ecran OLED Xiaomi 13", 48.00, "standard"),
    # Xiaomi 13 Lite
    ("Xiaomi", "13 Lite", "Ecran", "Original", "Ecran Original Xiaomi 13 Lite", 45.00, "standard"),
    ("Xiaomi", "13 Lite", "Ecran", "Incell", "Ecran Incell Xiaomi 13 Lite", 25.00, "standard"),
    # Xiaomi 12T Pro
    ("Xiaomi", "12T Pro", "Ecran", "Original", "Ecran Original Xiaomi 12T Pro", 72.00, "standard"),
    ("Xiaomi", "12T Pro", "Ecran", "OLED", "Ecran OLED Xiaomi 12T Pro", 42.00, "standard"),
    # Xiaomi 12T
    ("Xiaomi", "12T", "Ecran", "Original", "Ecran Original Xiaomi 12T", 55.00, "standard"),
    ("Xiaomi", "12T", "Ecran", "Incell", "Ecran Incell Xiaomi 12T", 30.00, "standard"),
    # Xiaomi 12 Pro
    ("Xiaomi", "12 Pro", "Ecran", "Original", "Ecran Original Xiaomi 12 Pro", 95.00, "haut_de_gamme"),
    # Xiaomi 12
    ("Xiaomi", "12", "Ecran", "Original", "Ecran Original Xiaomi 12", 58.00, "standard"),
    ("Xiaomi", "12", "Ecran", "OLED", "Ecran OLED Xiaomi 12", 35.00, "standard"),
    # Xiaomi 12 Lite
    ("Xiaomi", "12 Lite", "Ecran", "Original", "Ecran Original Xiaomi 12 Lite", 42.00, "standard"),
    ("Xiaomi", "12 Lite", "Ecran", "Incell", "Ecran Incell Xiaomi 12 Lite", 24.00, "standard"),
    # Xiaomi 11T Pro
    ("Xiaomi", "11T Pro", "Ecran", "Original", "Ecran Original Xiaomi 11T Pro", 62.00, "standard"),
    ("Xiaomi", "11T Pro", "Ecran", "OLED", "Ecran OLED Xiaomi 11T Pro", 38.00, "standard"),
    # Xiaomi 11T
    ("Xiaomi", "11T", "Ecran", "Original", "Ecran Original Xiaomi 11T", 48.00, "standard"),
    ("Xiaomi", "11T", "Ecran", "Incell", "Ecran Incell Xiaomi 11T", 28.00, "standard"),
    # Xiaomi 11 Lite 5G NE
    ("Xiaomi", "11 Lite 5G NE", "Ecran", "Original", "Ecran Original Xiaomi 11 Lite 5G NE", 42.00, "standard"),
    ("Xiaomi", "11 Lite 5G NE", "Ecran", "OLED", "Ecran OLED Xiaomi 11 Lite 5G NE", 28.00, "standard"),
    # Mi 11
    ("Xiaomi", "Mi 11", "Ecran", "Original", "Ecran Original Xiaomi Mi 11", 85.00, "haut_de_gamme"),
    # Mi 11 Lite 5G
    ("Xiaomi", "Mi 11 Lite 5G", "Ecran", "Original", "Ecran Original Xiaomi Mi 11 Lite 5G", 42.00, "standard"),
    ("Xiaomi", "Mi 11 Lite 5G", "Ecran", "OLED", "Ecran OLED Xiaomi Mi 11 Lite 5G", 28.00, "standard"),
    # Mi 11 Lite 4G
    ("Xiaomi", "Mi 11 Lite 4G", "Ecran", "Original", "Ecran Original Xiaomi Mi 11 Lite 4G", 38.00, "standard"),
    ("Xiaomi", "Mi 11 Lite 4G", "Ecran", "Incell", "Ecran Incell Xiaomi Mi 11 Lite 4G", 22.00, "standard"),
    # Mi 10T Pro
    ("Xiaomi", "Mi 10T Pro", "Ecran", "Original", "Ecran Original Xiaomi Mi 10T Pro", 48.00, "standard"),
    ("Xiaomi", "Mi 10T Pro", "Ecran", "Incell", "Ecran Incell Xiaomi Mi 10T Pro", 28.00, "standard"),
    # Mi 10T Lite
    ("Xiaomi", "Mi 10T Lite", "Ecran", "Original", "Ecran Original Xiaomi Mi 10T Lite", 28.00, "standard"),
    ("Xiaomi", "Mi 10T Lite", "Ecran", "Compatible", "Ecran Compatible Xiaomi Mi 10T Lite", 16.00, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  XIAOMI — ECRANS Redmi Note 13 (4G / 5G)                   ║
    # ╚══════════════════════════════════════════════════════════════╝
    # Redmi Note 13 Pro+ 5G (OLED)
    ("Xiaomi", "Redmi Note 13 Pro+ 5G", "Ecran", "Original", "Ecran Original Redmi Note 13 Pro+ 5G", 72.00, "standard"),
    ("Xiaomi", "Redmi Note 13 Pro+ 5G", "Ecran", "OLED", "Ecran OLED Redmi Note 13 Pro+ 5G", 42.00, "standard"),
    # Redmi Note 13 Pro 5G (OLED)
    ("Xiaomi", "Redmi Note 13 Pro 5G", "Ecran", "Original", "Ecran Original Redmi Note 13 Pro 5G", 62.00, "standard"),
    ("Xiaomi", "Redmi Note 13 Pro 5G", "Ecran", "Incell", "Ecran Incell Redmi Note 13 Pro 5G", 30.00, "standard"),
    # Redmi Note 13 Pro 4G (AMOLED, nappe differente)
    ("Xiaomi", "Redmi Note 13 Pro 4G", "Ecran", "Original", "Ecran Original Redmi Note 13 Pro 4G", 55.00, "standard"),
    ("Xiaomi", "Redmi Note 13 Pro 4G", "Ecran", "Incell", "Ecran Incell Redmi Note 13 Pro 4G", 28.00, "standard"),
    # Redmi Note 13 5G (AMOLED)
    ("Xiaomi", "Redmi Note 13 5G", "Ecran", "Original", "Ecran Original Redmi Note 13 5G", 45.00, "standard"),
    ("Xiaomi", "Redmi Note 13 5G", "Ecran", "Incell", "Ecran Incell Redmi Note 13 5G", 22.00, "standard"),
    # Redmi Note 13 4G (IPS LCD)
    ("Xiaomi", "Redmi Note 13 4G", "Ecran", "Original", "Ecran Original Redmi Note 13 4G", 25.00, "standard"),
    ("Xiaomi", "Redmi Note 13 4G", "Ecran", "Compatible", "Ecran Compatible Redmi Note 13 4G", 15.00, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  XIAOMI — ECRANS Redmi Note 12 (4G / 5G)                   ║
    # ╚══════════════════════════════════════════════════════════════╝
    # Redmi Note 12 Pro+ 5G (OLED)
    ("Xiaomi", "Redmi Note 12 Pro+ 5G", "Ecran", "Original", "Ecran Original Redmi Note 12 Pro+ 5G", 62.00, "standard"),
    # Redmi Note 12 Pro 5G (OLED)
    ("Xiaomi", "Redmi Note 12 Pro 5G", "Ecran", "Original", "Ecran Original Redmi Note 12 Pro 5G", 55.00, "standard"),
    ("Xiaomi", "Redmi Note 12 Pro 5G", "Ecran", "OLED", "Ecran OLED Redmi Note 12 Pro 5G", 38.00, "standard"),
    # Redmi Note 12 Pro 4G (OLED, nappe differente)
    ("Xiaomi", "Redmi Note 12 Pro 4G", "Ecran", "Original", "Ecran Original Redmi Note 12 Pro 4G", 48.00, "standard"),
    ("Xiaomi", "Redmi Note 12 Pro 4G", "Ecran", "OLED", "Ecran OLED Redmi Note 12 Pro 4G", 32.00, "standard"),
    # Redmi Note 12 5G (OLED)
    ("Xiaomi", "Redmi Note 12 5G", "Ecran", "Original", "Ecran Original Redmi Note 12 5G", 38.00, "standard"),
    ("Xiaomi", "Redmi Note 12 5G", "Ecran", "Incell", "Ecran Incell Redmi Note 12 5G", 20.00, "standard"),
    # Redmi Note 12 4G (IPS LCD)
    ("Xiaomi", "Redmi Note 12 4G", "Ecran", "Original", "Ecran Original Redmi Note 12 4G", 22.00, "standard"),
    ("Xiaomi", "Redmi Note 12 4G", "Ecran", "Compatible", "Ecran Compatible Redmi Note 12 4G", 14.00, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  XIAOMI — ECRANS Redmi Note 11 (4G / 5G)                   ║
    # ╚══════════════════════════════════════════════════════════════╝
    # Redmi Note 11 Pro 5G (LCD !)
    ("Xiaomi", "Redmi Note 11 Pro 5G", "Ecran", "Original", "Ecran Original Redmi Note 11 Pro 5G", 35.00, "standard"),
    ("Xiaomi", "Redmi Note 11 Pro 5G", "Ecran", "Compatible", "Ecran Compatible Redmi Note 11 Pro 5G", 20.00, "standard"),
    # Redmi Note 11 Pro 4G (AMOLED)
    ("Xiaomi", "Redmi Note 11 Pro 4G", "Ecran", "Original", "Ecran Original Redmi Note 11 Pro 4G", 48.00, "standard"),
    ("Xiaomi", "Redmi Note 11 Pro 4G", "Ecran", "OLED", "Ecran OLED Redmi Note 11 Pro 4G", 32.00, "standard"),
    # Redmi Note 11S (AMOLED)
    ("Xiaomi", "Redmi Note 11S", "Ecran", "Original", "Ecran Original Redmi Note 11S", 42.00, "standard"),
    ("Xiaomi", "Redmi Note 11S", "Ecran", "OLED", "Ecran OLED Redmi Note 11S", 28.00, "standard"),
    # Redmi Note 11S 5G (LCD)
    ("Xiaomi", "Redmi Note 11S 5G", "Ecran", "Original", "Ecran Original Redmi Note 11S 5G", 28.00, "standard"),
    ("Xiaomi", "Redmi Note 11S 5G", "Ecran", "Compatible", "Ecran Compatible Redmi Note 11S 5G", 16.00, "standard"),
    # Redmi Note 11 4G (AMOLED)
    ("Xiaomi", "Redmi Note 11 4G", "Ecran", "Original", "Ecran Original Redmi Note 11 4G", 32.00, "standard"),
    ("Xiaomi", "Redmi Note 11 4G", "Ecran", "Incell", "Ecran Incell Redmi Note 11 4G", 18.00, "standard"),
    # Redmi Note 11 5G (IPS LCD)
    ("Xiaomi", "Redmi Note 11 5G", "Ecran", "Original", "Ecran Original Redmi Note 11 5G", 25.00, "standard"),
    ("Xiaomi", "Redmi Note 11 5G", "Ecran", "Compatible", "Ecran Compatible Redmi Note 11 5G", 15.00, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  XIAOMI — ECRANS Redmi Note 10 (4G / 5G)                   ║
    # ╚══════════════════════════════════════════════════════════════╝
    # Redmi Note 10 Pro (AMOLED, 4G uniquement)
    ("Xiaomi", "Redmi Note 10 Pro", "Ecran", "Original", "Ecran Original Redmi Note 10 Pro", 42.00, "standard"),
    ("Xiaomi", "Redmi Note 10 Pro", "Ecran", "OLED", "Ecran OLED Redmi Note 10 Pro", 28.00, "standard"),
    # Redmi Note 10S (AMOLED, 4G uniquement)
    ("Xiaomi", "Redmi Note 10S", "Ecran", "Original", "Ecran Original Redmi Note 10S", 38.00, "standard"),
    ("Xiaomi", "Redmi Note 10S", "Ecran", "OLED", "Ecran OLED Redmi Note 10S", 26.00, "standard"),
    # Redmi Note 10 4G (AMOLED)
    ("Xiaomi", "Redmi Note 10 4G", "Ecran", "Original", "Ecran Original Redmi Note 10 4G", 28.00, "standard"),
    ("Xiaomi", "Redmi Note 10 4G", "Ecran", "Incell", "Ecran Incell Redmi Note 10 4G", 16.00, "standard"),
    # Redmi Note 10 5G (IPS LCD)
    ("Xiaomi", "Redmi Note 10 5G", "Ecran", "Original", "Ecran Original Redmi Note 10 5G", 22.00, "standard"),
    ("Xiaomi", "Redmi Note 10 5G", "Ecran", "Compatible", "Ecran Compatible Redmi Note 10 5G", 14.00, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  XIAOMI — ECRANS Redmi Note 9 / 8                          ║
    # ╚══════════════════════════════════════════════════════════════╝
    # Redmi Note 9 Pro
    ("Xiaomi", "Redmi Note 9 Pro", "Ecran", "Original", "Ecran Original Redmi Note 9 Pro", 32.00, "standard"),
    ("Xiaomi", "Redmi Note 9 Pro", "Ecran", "Compatible", "Ecran Compatible Redmi Note 9 Pro", 18.00, "standard"),
    # Redmi Note 9S
    ("Xiaomi", "Redmi Note 9S", "Ecran", "Original", "Ecran Original Redmi Note 9S", 30.00, "standard"),
    ("Xiaomi", "Redmi Note 9S", "Ecran", "Compatible", "Ecran Compatible Redmi Note 9S", 17.00, "standard"),
    # Redmi Note 9 4G
    ("Xiaomi", "Redmi Note 9", "Ecran", "Original", "Ecran Original Redmi Note 9", 25.00, "standard"),
    ("Xiaomi", "Redmi Note 9", "Ecran", "Compatible", "Ecran Compatible Redmi Note 9", 15.00, "standard"),
    # Redmi Note 9T 5G
    ("Xiaomi", "Redmi Note 9T 5G", "Ecran", "Original", "Ecran Original Redmi Note 9T 5G", 28.00, "standard"),
    ("Xiaomi", "Redmi Note 9T 5G", "Ecran", "Compatible", "Ecran Compatible Redmi Note 9T 5G", 16.00, "standard"),
    # Redmi Note 8 Pro
    ("Xiaomi", "Redmi Note 8 Pro", "Ecran", "Original", "Ecran Original Redmi Note 8 Pro", 25.00, "standard"),
    ("Xiaomi", "Redmi Note 8 Pro", "Ecran", "Compatible", "Ecran Compatible Redmi Note 8 Pro", 15.00, "standard"),
    # Redmi Note 8
    ("Xiaomi", "Redmi Note 8", "Ecran", "Original", "Ecran Original Redmi Note 8", 22.00, "standard"),
    ("Xiaomi", "Redmi Note 8", "Ecran", "Compatible", "Ecran Compatible Redmi Note 8", 13.00, "standard"),
    # Redmi Note 8T
    ("Xiaomi", "Redmi Note 8T", "Ecran", "Original", "Ecran Original Redmi Note 8T", 22.00, "standard"),
    ("Xiaomi", "Redmi Note 8T", "Ecran", "Compatible", "Ecran Compatible Redmi Note 8T", 13.00, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  XIAOMI — ECRANS Redmi (hors Note)                         ║
    # ╚══════════════════════════════════════════════════════════════╝
    # Redmi 13
    ("Xiaomi", "Redmi 13", "Ecran", "Original", "Ecran Original Redmi 13", 28.00, "standard"),
    ("Xiaomi", "Redmi 13", "Ecran", "Compatible", "Ecran Compatible Redmi 13", 16.00, "standard"),
    # Redmi 13C
    ("Xiaomi", "Redmi 13C", "Ecran", "Original", "Ecran Original Redmi 13C", 25.00, "standard"),
    ("Xiaomi", "Redmi 13C", "Ecran", "Compatible", "Ecran Compatible Redmi 13C", 14.00, "standard"),
    ("Xiaomi", "Redmi 13C", "Ecran", "LCD", "Ecran LCD Redmi 13C", 10.00, "standard"),
    # Redmi 12
    ("Xiaomi", "Redmi 12", "Ecran", "Original", "Ecran Original Redmi 12", 28.00, "standard"),
    ("Xiaomi", "Redmi 12", "Ecran", "Compatible", "Ecran Compatible Redmi 12", 16.00, "standard"),
    ("Xiaomi", "Redmi 12", "Ecran", "LCD", "Ecran LCD Redmi 12", 12.00, "standard"),
    # Redmi 12C
    ("Xiaomi", "Redmi 12C", "Ecran", "Original", "Ecran Original Redmi 12C", 22.00, "standard"),
    ("Xiaomi", "Redmi 12C", "Ecran", "Compatible", "Ecran Compatible Redmi 12C", 13.00, "standard"),
    # Redmi 10
    ("Xiaomi", "Redmi 10", "Ecran", "Original", "Ecran Original Redmi 10", 25.00, "standard"),
    ("Xiaomi", "Redmi 10", "Ecran", "Compatible", "Ecran Compatible Redmi 10", 14.00, "standard"),
    # Redmi 10C
    ("Xiaomi", "Redmi 10C", "Ecran", "Original", "Ecran Original Redmi 10C", 22.00, "standard"),
    ("Xiaomi", "Redmi 10C", "Ecran", "Compatible", "Ecran Compatible Redmi 10C", 13.00, "standard"),
    # Redmi 9
    ("Xiaomi", "Redmi 9", "Ecran", "Original", "Ecran Original Redmi 9", 22.00, "standard"),
    ("Xiaomi", "Redmi 9", "Ecran", "Compatible", "Ecran Compatible Redmi 9", 12.00, "standard"),
    # Redmi 9A
    ("Xiaomi", "Redmi 9A", "Ecran", "Original", "Ecran Original Redmi 9A", 18.00, "standard"),
    ("Xiaomi", "Redmi 9A", "Ecran", "Compatible", "Ecran Compatible Redmi 9A", 10.00, "standard"),
    # Redmi 9C
    ("Xiaomi", "Redmi 9C", "Ecran", "Original", "Ecran Original Redmi 9C", 18.00, "standard"),
    ("Xiaomi", "Redmi 9C", "Ecran", "Compatible", "Ecran Compatible Redmi 9C", 10.00, "standard"),
    # Redmi 9T
    ("Xiaomi", "Redmi 9T", "Ecran", "Original", "Ecran Original Redmi 9T", 22.00, "standard"),
    ("Xiaomi", "Redmi 9T", "Ecran", "Compatible", "Ecran Compatible Redmi 9T", 13.00, "standard"),
    # Redmi A1
    ("Xiaomi", "Redmi A1", "Ecran", "Original", "Ecran Original Redmi A1", 15.00, "standard"),
    ("Xiaomi", "Redmi A1", "Ecran", "Compatible", "Ecran Compatible Redmi A1", 9.00, "standard"),
    # Redmi A2
    ("Xiaomi", "Redmi A2", "Ecran", "Original", "Ecran Original Redmi A2", 16.00, "standard"),
    ("Xiaomi", "Redmi A2", "Ecran", "Compatible", "Ecran Compatible Redmi A2", 9.00, "standard"),
    # Redmi A3
    ("Xiaomi", "Redmi A3", "Ecran", "Original", "Ecran Original Redmi A3", 18.00, "standard"),
    ("Xiaomi", "Redmi A3", "Ecran", "Compatible", "Ecran Compatible Redmi A3", 10.00, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  XIAOMI — ECRANS Poco                                      ║
    # ╚══════════════════════════════════════════════════════════════╝
    # Poco F6 Pro
    ("Xiaomi", "Poco F6 Pro", "Ecran", "Original", "Ecran Original Poco F6 Pro", 85.00, "haut_de_gamme"),
    ("Xiaomi", "Poco F6 Pro", "Ecran", "OLED", "Ecran OLED Poco F6 Pro", 52.00, "haut_de_gamme"),
    # Poco F6
    ("Xiaomi", "Poco F6", "Ecran", "Original", "Ecran Original Poco F6", 68.00, "standard"),
    ("Xiaomi", "Poco F6", "Ecran", "OLED", "Ecran OLED Poco F6", 40.00, "standard"),
    # Poco F5
    ("Xiaomi", "Poco F5", "Ecran", "Original", "Ecran Original Poco F5", 55.00, "standard"),
    ("Xiaomi", "Poco F5", "Ecran", "OLED", "Ecran OLED Poco F5", 35.00, "standard"),
    # Poco F4
    ("Xiaomi", "Poco F4", "Ecran", "Original", "Ecran Original Poco F4", 48.00, "standard"),
    ("Xiaomi", "Poco F4", "Ecran", "OLED", "Ecran OLED Poco F4", 30.00, "standard"),
    # Poco F3
    ("Xiaomi", "Poco F3", "Ecran", "Original", "Ecran Original Poco F3", 42.00, "standard"),
    ("Xiaomi", "Poco F3", "Ecran", "OLED", "Ecran OLED Poco F3", 28.00, "standard"),
    # Poco X6 Pro 5G
    ("Xiaomi", "Poco X6 Pro 5G", "Ecran", "Original", "Ecran Original Poco X6 Pro 5G", 58.00, "standard"),
    ("Xiaomi", "Poco X6 Pro 5G", "Ecran", "OLED", "Ecran OLED Poco X6 Pro 5G", 35.00, "standard"),
    # Poco X5 Pro 5G
    ("Xiaomi", "Poco X5 Pro 5G", "Ecran", "Original", "Ecran Original Poco X5 Pro 5G", 48.00, "standard"),
    ("Xiaomi", "Poco X5 Pro 5G", "Ecran", "OLED", "Ecran OLED Poco X5 Pro 5G", 30.00, "standard"),
    # Poco X4 Pro 5G
    ("Xiaomi", "Poco X4 Pro 5G", "Ecran", "Original", "Ecran Original Poco X4 Pro 5G", 38.00, "standard"),
    ("Xiaomi", "Poco X4 Pro 5G", "Ecran", "OLED", "Ecran OLED Poco X4 Pro 5G", 25.00, "standard"),
    # Poco X3 Pro
    ("Xiaomi", "Poco X3 Pro", "Ecran", "Original", "Ecran Original Poco X3 Pro", 35.00, "standard"),
    ("Xiaomi", "Poco X3 Pro", "Ecran", "Compatible", "Ecran Compatible Poco X3 Pro", 20.00, "standard"),
    # Poco X3 NFC
    ("Xiaomi", "Poco X3 NFC", "Ecran", "Original", "Ecran Original Poco X3 NFC", 32.00, "standard"),
    ("Xiaomi", "Poco X3 NFC", "Ecran", "Compatible", "Ecran Compatible Poco X3 NFC", 18.00, "standard"),
    # Poco M5
    ("Xiaomi", "Poco M5", "Ecran", "Original", "Ecran Original Poco M5", 25.00, "standard"),
    ("Xiaomi", "Poco M5", "Ecran", "Compatible", "Ecran Compatible Poco M5", 15.00, "standard"),
    # Poco M4 Pro 5G
    ("Xiaomi", "Poco M4 Pro 5G", "Ecran", "Original", "Ecran Original Poco M4 Pro 5G", 28.00, "standard"),
    ("Xiaomi", "Poco M4 Pro 5G", "Ecran", "Compatible", "Ecran Compatible Poco M4 Pro 5G", 16.00, "standard"),
    # Poco M3 Pro 5G
    ("Xiaomi", "Poco M3 Pro 5G", "Ecran", "Original", "Ecran Original Poco M3 Pro 5G", 25.00, "standard"),
    ("Xiaomi", "Poco M3 Pro 5G", "Ecran", "Compatible", "Ecran Compatible Poco M3 Pro 5G", 14.00, "standard"),
    # Poco M3
    ("Xiaomi", "Poco M3", "Ecran", "Original", "Ecran Original Poco M3", 22.00, "standard"),
    ("Xiaomi", "Poco M3", "Ecran", "Compatible", "Ecran Compatible Poco M3", 13.00, "standard"),
    # Poco C65
    ("Xiaomi", "Poco C65", "Ecran", "Original", "Ecran Original Poco C65", 18.00, "standard"),
    ("Xiaomi", "Poco C65", "Ecran", "Compatible", "Ecran Compatible Poco C65", 11.00, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  XIAOMI — BATTERIES                                        ║
    # ╚══════════════════════════════════════════════════════════════╝
    # Gamme principale
    ("Xiaomi", "14 Ultra", "Batterie", None, "Batterie Xiaomi 14 Ultra", 14.00, "standard"),
    ("Xiaomi", "14 Pro", "Batterie", None, "Batterie Xiaomi 14 Pro", 13.00, "standard"),
    ("Xiaomi", "14", "Batterie", None, "Batterie Xiaomi 14", 12.00, "standard"),
    ("Xiaomi", "13T Pro", "Batterie", None, "Batterie Xiaomi 13T Pro", 11.00, "standard"),
    ("Xiaomi", "13T", "Batterie", None, "Batterie Xiaomi 13T", 10.50, "standard"),
    ("Xiaomi", "13 Pro", "Batterie", None, "Batterie Xiaomi 13 Pro", 12.00, "standard"),
    ("Xiaomi", "13", "Batterie", None, "Batterie Xiaomi 13", 11.00, "standard"),
    ("Xiaomi", "13 Lite", "Batterie", None, "Batterie Xiaomi 13 Lite", 9.50, "standard"),
    ("Xiaomi", "12T Pro", "Batterie", None, "Batterie Xiaomi 12T Pro", 10.50, "standard"),
    ("Xiaomi", "12T", "Batterie", None, "Batterie Xiaomi 12T", 9.50, "standard"),
    ("Xiaomi", "12", "Batterie", None, "Batterie Xiaomi 12", 10.00, "standard"),
    ("Xiaomi", "12 Lite", "Batterie", None, "Batterie Xiaomi 12 Lite", 9.00, "standard"),
    ("Xiaomi", "11T Pro", "Batterie", None, "Batterie Xiaomi 11T Pro", 10.00, "standard"),
    ("Xiaomi", "11T", "Batterie", None, "Batterie Xiaomi 11T", 9.00, "standard"),
    ("Xiaomi", "11 Lite 5G NE", "Batterie", None, "Batterie Xiaomi 11 Lite 5G NE", 8.50, "standard"),
    ("Xiaomi", "Mi 11", "Batterie", None, "Batterie Xiaomi Mi 11", 10.00, "standard"),
    ("Xiaomi", "Mi 11 Lite 5G", "Batterie", None, "Batterie Xiaomi Mi 11 Lite 5G", 8.50, "standard"),
    ("Xiaomi", "Mi 11 Lite 4G", "Batterie", None, "Batterie Xiaomi Mi 11 Lite 4G", 8.00, "standard"),
    ("Xiaomi", "Mi 10T Pro", "Batterie", None, "Batterie Xiaomi Mi 10T Pro", 9.00, "standard"),
    ("Xiaomi", "Mi 10T Lite", "Batterie", None, "Batterie Xiaomi Mi 10T Lite", 8.00, "standard"),
    # Redmi Note
    ("Xiaomi", "Redmi Note 13 Pro+ 5G", "Batterie", None, "Batterie Redmi Note 13 Pro+ 5G", 10.50, "standard"),
    ("Xiaomi", "Redmi Note 13 Pro 5G", "Batterie", None, "Batterie Redmi Note 13 Pro 5G", 10.00, "standard"),
    ("Xiaomi", "Redmi Note 13 Pro 4G", "Batterie", None, "Batterie Redmi Note 13 Pro 4G", 10.00, "standard"),
    ("Xiaomi", "Redmi Note 13 5G", "Batterie", None, "Batterie Redmi Note 13 5G", 9.00, "standard"),
    ("Xiaomi", "Redmi Note 13 4G", "Batterie", None, "Batterie Redmi Note 13 4G", 9.00, "standard"),
    ("Xiaomi", "Redmi Note 12 Pro 5G", "Batterie", None, "Batterie Redmi Note 12 Pro 5G", 9.50, "standard"),
    ("Xiaomi", "Redmi Note 12 Pro 4G", "Batterie", None, "Batterie Redmi Note 12 Pro 4G", 9.50, "standard"),
    ("Xiaomi", "Redmi Note 12 5G", "Batterie", None, "Batterie Redmi Note 12 5G", 8.50, "standard"),
    ("Xiaomi", "Redmi Note 12 4G", "Batterie", None, "Batterie Redmi Note 12 4G", 8.50, "standard"),
    ("Xiaomi", "Redmi Note 11 Pro 5G", "Batterie", None, "Batterie Redmi Note 11 Pro 5G", 9.00, "standard"),
    ("Xiaomi", "Redmi Note 11 Pro 4G", "Batterie", None, "Batterie Redmi Note 11 Pro 4G", 9.00, "standard"),
    ("Xiaomi", "Redmi Note 11S", "Batterie", None, "Batterie Redmi Note 11S", 8.50, "standard"),
    ("Xiaomi", "Redmi Note 11 4G", "Batterie", None, "Batterie Redmi Note 11 4G", 8.00, "standard"),
    ("Xiaomi", "Redmi Note 11 5G", "Batterie", None, "Batterie Redmi Note 11 5G", 8.00, "standard"),
    ("Xiaomi", "Redmi Note 10 Pro", "Batterie", None, "Batterie Redmi Note 10 Pro", 8.50, "standard"),
    ("Xiaomi", "Redmi Note 10S", "Batterie", None, "Batterie Redmi Note 10S", 8.00, "standard"),
    ("Xiaomi", "Redmi Note 10 4G", "Batterie", None, "Batterie Redmi Note 10 4G", 7.50, "standard"),
    ("Xiaomi", "Redmi Note 10 5G", "Batterie", None, "Batterie Redmi Note 10 5G", 7.50, "standard"),
    ("Xiaomi", "Redmi Note 9 Pro", "Batterie", None, "Batterie Redmi Note 9 Pro", 8.00, "standard"),
    ("Xiaomi", "Redmi Note 9S", "Batterie", None, "Batterie Redmi Note 9S", 8.00, "standard"),
    ("Xiaomi", "Redmi Note 9", "Batterie", None, "Batterie Redmi Note 9", 7.50, "standard"),
    ("Xiaomi", "Redmi Note 9T 5G", "Batterie", None, "Batterie Redmi Note 9T 5G", 7.50, "standard"),
    ("Xiaomi", "Redmi Note 8 Pro", "Batterie", None, "Batterie Redmi Note 8 Pro", 7.00, "standard"),
    ("Xiaomi", "Redmi Note 8", "Batterie", None, "Batterie Redmi Note 8", 7.00, "standard"),
    ("Xiaomi", "Redmi Note 8T", "Batterie", None, "Batterie Redmi Note 8T", 7.00, "standard"),
    # Redmi
    ("Xiaomi", "Redmi 13", "Batterie", None, "Batterie Redmi 13", 7.50, "standard"),
    ("Xiaomi", "Redmi 13C", "Batterie", None, "Batterie Redmi 13C", 7.50, "standard"),
    ("Xiaomi", "Redmi 12", "Batterie", None, "Batterie Redmi 12", 7.50, "standard"),
    ("Xiaomi", "Redmi 12C", "Batterie", None, "Batterie Redmi 12C", 7.00, "standard"),
    ("Xiaomi", "Redmi 10", "Batterie", None, "Batterie Redmi 10", 7.50, "standard"),
    ("Xiaomi", "Redmi 10C", "Batterie", None, "Batterie Redmi 10C", 7.00, "standard"),
    ("Xiaomi", "Redmi 9", "Batterie", None, "Batterie Redmi 9", 7.00, "standard"),
    ("Xiaomi", "Redmi 9A", "Batterie", None, "Batterie Redmi 9A", 6.50, "standard"),
    ("Xiaomi", "Redmi 9C", "Batterie", None, "Batterie Redmi 9C", 6.50, "standard"),
    ("Xiaomi", "Redmi 9T", "Batterie", None, "Batterie Redmi 9T", 7.00, "standard"),
    ("Xiaomi", "Redmi A1", "Batterie", None, "Batterie Redmi A1", 6.50, "standard"),
    ("Xiaomi", "Redmi A2", "Batterie", None, "Batterie Redmi A2", 7.00, "standard"),
    ("Xiaomi", "Redmi A3", "Batterie", None, "Batterie Redmi A3", 7.00, "standard"),
    # Poco
    ("Xiaomi", "Poco F6 Pro", "Batterie", None, "Batterie Poco F6 Pro", 11.00, "standard"),
    ("Xiaomi", "Poco F6", "Batterie", None, "Batterie Poco F6", 10.00, "standard"),
    ("Xiaomi", "Poco F5", "Batterie", None, "Batterie Poco F5", 9.50, "standard"),
    ("Xiaomi", "Poco F4", "Batterie", None, "Batterie Poco F4", 9.00, "standard"),
    ("Xiaomi", "Poco F3", "Batterie", None, "Batterie Poco F3", 8.50, "standard"),
    ("Xiaomi", "Poco X6 Pro 5G", "Batterie", None, "Batterie Poco X6 Pro 5G", 10.00, "standard"),
    ("Xiaomi", "Poco X5 Pro 5G", "Batterie", None, "Batterie Poco X5 Pro 5G", 9.00, "standard"),
    ("Xiaomi", "Poco X4 Pro 5G", "Batterie", None, "Batterie Poco X4 Pro 5G", 8.50, "standard"),
    ("Xiaomi", "Poco X3 Pro", "Batterie", None, "Batterie Poco X3 Pro", 8.50, "standard"),
    ("Xiaomi", "Poco X3 NFC", "Batterie", None, "Batterie Poco X3 NFC", 8.00, "standard"),
    ("Xiaomi", "Poco M5", "Batterie", None, "Batterie Poco M5", 7.50, "standard"),
    ("Xiaomi", "Poco M4 Pro 5G", "Batterie", None, "Batterie Poco M4 Pro 5G", 7.50, "standard"),
    ("Xiaomi", "Poco M3", "Batterie", None, "Batterie Poco M3", 7.00, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  XIAOMI — CONNECTEURS DE CHARGE                            ║
    # ╚══════════════════════════════════════════════════════════════╝
    # Gamme principale
    ("Xiaomi", "13T Pro", "Connecteur de charge", None, "Nappe connecteur Xiaomi 13T Pro", 8.50, "standard"),
    ("Xiaomi", "13T", "Connecteur de charge", None, "Nappe connecteur Xiaomi 13T", 8.00, "standard"),
    ("Xiaomi", "12T Pro", "Connecteur de charge", None, "Nappe connecteur Xiaomi 12T Pro", 8.00, "standard"),
    ("Xiaomi", "12T", "Connecteur de charge", None, "Nappe connecteur Xiaomi 12T", 7.50, "standard"),
    ("Xiaomi", "11T Pro", "Connecteur de charge", None, "Nappe connecteur Xiaomi 11T Pro", 7.50, "standard"),
    ("Xiaomi", "11T", "Connecteur de charge", None, "Nappe connecteur Xiaomi 11T", 7.00, "standard"),
    ("Xiaomi", "Mi 11 Lite 5G", "Connecteur de charge", None, "Nappe connecteur Xiaomi Mi 11 Lite 5G", 6.50, "standard"),
    ("Xiaomi", "Mi 11 Lite 4G", "Connecteur de charge", None, "Nappe connecteur Xiaomi Mi 11 Lite 4G", 6.50, "standard"),
    ("Xiaomi", "Mi 10T Lite", "Connecteur de charge", None, "Nappe connecteur Xiaomi Mi 10T Lite", 6.00, "standard"),
    # Redmi Note
    ("Xiaomi", "Redmi Note 13 Pro 5G", "Connecteur de charge", None, "Nappe connecteur Redmi Note 13 Pro 5G", 8.00, "standard"),
    ("Xiaomi", "Redmi Note 13 Pro 4G", "Connecteur de charge", None, "Nappe connecteur Redmi Note 13 Pro 4G", 8.00, "standard"),
    ("Xiaomi", "Redmi Note 13 5G", "Connecteur de charge", None, "Nappe connecteur Redmi Note 13 5G", 7.00, "standard"),
    ("Xiaomi", "Redmi Note 13 4G", "Connecteur de charge", None, "Nappe connecteur Redmi Note 13 4G", 7.00, "standard"),
    ("Xiaomi", "Redmi Note 12 Pro 5G", "Connecteur de charge", None, "Nappe connecteur Redmi Note 12 Pro 5G", 7.50, "standard"),
    ("Xiaomi", "Redmi Note 12 Pro 4G", "Connecteur de charge", None, "Nappe connecteur Redmi Note 12 Pro 4G", 7.50, "standard"),
    ("Xiaomi", "Redmi Note 12 5G", "Connecteur de charge", None, "Nappe connecteur Redmi Note 12 5G", 6.50, "standard"),
    ("Xiaomi", "Redmi Note 12 4G", "Connecteur de charge", None, "Nappe connecteur Redmi Note 12 4G", 6.50, "standard"),
    ("Xiaomi", "Redmi Note 11 Pro 5G", "Connecteur de charge", None, "Nappe connecteur Redmi Note 11 Pro 5G", 7.00, "standard"),
    ("Xiaomi", "Redmi Note 11 Pro 4G", "Connecteur de charge", None, "Nappe connecteur Redmi Note 11 Pro 4G", 7.00, "standard"),
    ("Xiaomi", "Redmi Note 11S", "Connecteur de charge", None, "Nappe connecteur Redmi Note 11S", 6.50, "standard"),
    ("Xiaomi", "Redmi Note 11 4G", "Connecteur de charge", None, "Nappe connecteur Redmi Note 11 4G", 6.50, "standard"),
    ("Xiaomi", "Redmi Note 10 Pro", "Connecteur de charge", None, "Nappe connecteur Redmi Note 10 Pro", 6.50, "standard"),
    ("Xiaomi", "Redmi Note 10S", "Connecteur de charge", None, "Nappe connecteur Redmi Note 10S", 6.00, "standard"),
    ("Xiaomi", "Redmi Note 10 4G", "Connecteur de charge", None, "Nappe connecteur Redmi Note 10 4G", 6.00, "standard"),
    ("Xiaomi", "Redmi Note 9 Pro", "Connecteur de charge", None, "Nappe connecteur Redmi Note 9 Pro", 6.00, "standard"),
    ("Xiaomi", "Redmi Note 9S", "Connecteur de charge", None, "Nappe connecteur Redmi Note 9S", 6.00, "standard"),
    ("Xiaomi", "Redmi Note 9", "Connecteur de charge", None, "Nappe connecteur Redmi Note 9", 5.50, "standard"),
    ("Xiaomi", "Redmi Note 8 Pro", "Connecteur de charge", None, "Nappe connecteur Redmi Note 8 Pro", 5.50, "standard"),
    ("Xiaomi", "Redmi Note 8", "Connecteur de charge", None, "Nappe connecteur Redmi Note 8", 5.00, "standard"),
    ("Xiaomi", "Redmi Note 8T", "Connecteur de charge", None, "Nappe connecteur Redmi Note 8T", 5.00, "standard"),
    # Redmi
    ("Xiaomi", "Redmi 13C", "Connecteur de charge", None, "Nappe connecteur Redmi 13C", 5.50, "standard"),
    ("Xiaomi", "Redmi 12", "Connecteur de charge", None, "Nappe connecteur Redmi 12", 5.50, "standard"),
    ("Xiaomi", "Redmi 12C", "Connecteur de charge", None, "Nappe connecteur Redmi 12C", 5.00, "standard"),
    ("Xiaomi", "Redmi 10", "Connecteur de charge", None, "Nappe connecteur Redmi 10", 5.50, "standard"),
    ("Xiaomi", "Redmi 10C", "Connecteur de charge", None, "Nappe connecteur Redmi 10C", 5.00, "standard"),
    ("Xiaomi", "Redmi 9", "Connecteur de charge", None, "Nappe connecteur Redmi 9", 5.00, "standard"),
    ("Xiaomi", "Redmi 9A", "Connecteur de charge", None, "Nappe connecteur Redmi 9A", 4.50, "standard"),
    ("Xiaomi", "Redmi 9C", "Connecteur de charge", None, "Nappe connecteur Redmi 9C", 4.50, "standard"),
    ("Xiaomi", "Redmi A1", "Connecteur de charge", None, "Nappe connecteur Redmi A1", 4.50, "standard"),
    ("Xiaomi", "Redmi A2", "Connecteur de charge", None, "Nappe connecteur Redmi A2", 5.00, "standard"),
    ("Xiaomi", "Redmi A3", "Connecteur de charge", None, "Nappe connecteur Redmi A3", 5.00, "standard"),
    # Poco
    ("Xiaomi", "Poco F6 Pro", "Connecteur de charge", None, "Nappe connecteur Poco F6 Pro", 8.00, "standard"),
    ("Xiaomi", "Poco F6", "Connecteur de charge", None, "Nappe connecteur Poco F6", 7.50, "standard"),
    ("Xiaomi", "Poco F5", "Connecteur de charge", None, "Nappe connecteur Poco F5", 7.00, "standard"),
    ("Xiaomi", "Poco F4", "Connecteur de charge", None, "Nappe connecteur Poco F4", 6.50, "standard"),
    ("Xiaomi", "Poco F3", "Connecteur de charge", None, "Nappe connecteur Poco F3", 6.00, "standard"),
    ("Xiaomi", "Poco X6 Pro 5G", "Connecteur de charge", None, "Nappe connecteur Poco X6 Pro 5G", 8.00, "standard"),
    ("Xiaomi", "Poco X5 Pro 5G", "Connecteur de charge", None, "Nappe connecteur Poco X5 Pro 5G", 7.00, "standard"),
    ("Xiaomi", "Poco X4 Pro 5G", "Connecteur de charge", None, "Nappe connecteur Poco X4 Pro 5G", 6.50, "standard"),
    ("Xiaomi", "Poco X3 Pro", "Connecteur de charge", None, "Nappe connecteur Poco X3 Pro", 6.00, "standard"),
    ("Xiaomi", "Poco X3 NFC", "Connecteur de charge", None, "Nappe connecteur Poco X3 NFC", 5.50, "standard"),
    ("Xiaomi", "Poco M5", "Connecteur de charge", None, "Nappe connecteur Poco M5", 5.50, "standard"),
    ("Xiaomi", "Poco M4 Pro 5G", "Connecteur de charge", None, "Nappe connecteur Poco M4 Pro 5G", 5.50, "standard"),
    ("Xiaomi", "Poco M3", "Connecteur de charge", None, "Nappe connecteur Poco M3", 5.00, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  HUAWEI — ECRANS                                           ║
    # ╚══════════════════════════════════════════════════════════════╝
    ("Huawei", "P40 Pro", "Ecran", "Original", "Ecran Original Huawei P40 Pro", 110.00, "haut_de_gamme"),
    ("Huawei", "P40 Lite", "Ecran", "Original", "Ecran Original Huawei P40 Lite", 35.00, "standard"),
    ("Huawei", "P40 Lite", "Ecran", "Compatible", "Ecran Compatible Huawei P40 Lite", 20.00, "standard"),
    ("Huawei", "P30 Pro", "Ecran", "Original", "Ecran Original Huawei P30 Pro", 85.00, "standard"),
    ("Huawei", "P30 Pro", "Ecran", "OLED", "Ecran OLED Huawei P30 Pro", 52.00, "standard"),
    ("Huawei", "P30 Lite", "Ecran", "Original", "Ecran Original Huawei P30 Lite", 32.00, "standard"),
    ("Huawei", "P30 Lite", "Ecran", "Compatible", "Ecran Compatible Huawei P30 Lite", 18.00, "standard"),
    ("Huawei", "P30", "Ecran", "Original", "Ecran Original Huawei P30", 55.00, "standard"),
    ("Huawei", "P30", "Ecran", "OLED", "Ecran OLED Huawei P30", 35.00, "standard"),
    ("Huawei", "P20 Pro", "Ecran", "Original", "Ecran Original Huawei P20 Pro", 65.00, "standard"),
    ("Huawei", "P20 Lite", "Ecran", "Original", "Ecran Original Huawei P20 Lite", 22.00, "standard"),
    ("Huawei", "P20 Lite", "Ecran", "Compatible", "Ecran Compatible Huawei P20 Lite", 14.00, "standard"),
    ("Huawei", "Nova 10", "Ecran", "Original", "Ecran Original Huawei Nova 10", 52.00, "standard"),
    ("Huawei", "Nova 10", "Ecran", "Incell", "Ecran Incell Huawei Nova 10", 28.00, "standard"),
    ("Huawei", "Nova 9", "Ecran", "Original", "Ecran Original Huawei Nova 9", 48.00, "standard"),
    ("Huawei", "Mate 20 Lite", "Ecran", "Original", "Ecran Original Huawei Mate 20 Lite", 25.00, "standard"),
    ("Huawei", "Mate 20 Lite", "Ecran", "Compatible", "Ecran Compatible Huawei Mate 20 Lite", 15.00, "standard"),
    ("Huawei", "Y6 2019", "Ecran", "Original", "Ecran Original Huawei Y6 2019", 18.00, "standard"),
    ("Huawei", "Y6 2019", "Ecran", "Compatible", "Ecran Compatible Huawei Y6 2019", 10.00, "standard"),
    ("Huawei", "Y7 2019", "Ecran", "Original", "Ecran Original Huawei Y7 2019", 20.00, "standard"),
    ("Huawei", "Y9 2019", "Ecran", "Original", "Ecran Original Huawei Y9 2019", 22.00, "standard"),

    # Huawei batteries
    ("Huawei", "P40 Pro", "Batterie", None, "Batterie Huawei P40 Pro", 12.00, "standard"),
    ("Huawei", "P40 Lite", "Batterie", None, "Batterie Huawei P40 Lite", 8.50, "standard"),
    ("Huawei", "P30 Pro", "Batterie", None, "Batterie Huawei P30 Pro", 10.00, "standard"),
    ("Huawei", "P30 Lite", "Batterie", None, "Batterie Huawei P30 Lite", 8.00, "standard"),
    ("Huawei", "P30", "Batterie", None, "Batterie Huawei P30", 9.00, "standard"),
    ("Huawei", "P20 Lite", "Batterie", None, "Batterie Huawei P20 Lite", 7.00, "standard"),
    ("Huawei", "Nova 10", "Batterie", None, "Batterie Huawei Nova 10", 9.00, "standard"),
    ("Huawei", "Mate 20 Lite", "Batterie", None, "Batterie Huawei Mate 20 Lite", 7.50, "standard"),

    # Huawei connecteurs
    ("Huawei", "P40 Lite", "Connecteur de charge", None, "Nappe connecteur Huawei P40 Lite", 6.50, "standard"),
    ("Huawei", "P30 Pro", "Connecteur de charge", None, "Nappe connecteur Huawei P30 Pro", 8.00, "standard"),
    ("Huawei", "P30 Lite", "Connecteur de charge", None, "Nappe connecteur Huawei P30 Lite", 6.00, "standard"),
    ("Huawei", "P20 Lite", "Connecteur de charge", None, "Nappe connecteur Huawei P20 Lite", 5.50, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  HONOR                                                     ║
    # ╚══════════════════════════════════════════════════════════════╝
    ("Honor", "Magic 6 Pro", "Ecran", "Original", "Ecran Original Honor Magic 6 Pro", 110.00, "haut_de_gamme"),
    ("Honor", "Magic 5 Pro", "Ecran", "Original", "Ecran Original Honor Magic 5 Pro", 95.00, "haut_de_gamme"),
    ("Honor", "90", "Ecran", "Original", "Ecran Original Honor 90", 58.00, "standard"),
    ("Honor", "90", "Ecran", "Incell", "Ecran Incell Honor 90", 30.00, "standard"),
    ("Honor", "90 Lite", "Ecran", "Original", "Ecran Original Honor 90 Lite", 35.00, "standard"),
    ("Honor", "90 Lite", "Ecran", "Compatible", "Ecran Compatible Honor 90 Lite", 20.00, "standard"),
    ("Honor", "70", "Ecran", "Original", "Ecran Original Honor 70", 52.00, "standard"),
    ("Honor", "70", "Ecran", "OLED", "Ecran OLED Honor 70", 32.00, "standard"),
    ("Honor", "X8", "Ecran", "Original", "Ecran Original Honor X8", 28.00, "standard"),
    ("Honor", "X8", "Ecran", "Compatible", "Ecran Compatible Honor X8", 16.00, "standard"),
    ("Honor", "X7a", "Ecran", "Original", "Ecran Original Honor X7a", 22.00, "standard"),
    ("Honor", "X6", "Ecran", "Original", "Ecran Original Honor X6", 20.00, "standard"),
    ("Honor", "200", "Ecran", "Original", "Ecran Original Honor 200", 62.00, "standard"),
    ("Honor", "200 Lite", "Ecran", "Original", "Ecran Original Honor 200 Lite", 38.00, "standard"),

    # Honor batteries
    ("Honor", "90", "Batterie", None, "Batterie Honor 90", 10.00, "standard"),
    ("Honor", "90 Lite", "Batterie", None, "Batterie Honor 90 Lite", 8.50, "standard"),
    ("Honor", "70", "Batterie", None, "Batterie Honor 70", 9.50, "standard"),
    ("Honor", "X8", "Batterie", None, "Batterie Honor X8", 8.00, "standard"),
    ("Honor", "200", "Batterie", None, "Batterie Honor 200", 10.00, "standard"),

    # Honor connecteurs
    ("Honor", "90", "Connecteur de charge", None, "Nappe connecteur Honor 90", 7.00, "standard"),
    ("Honor", "70", "Connecteur de charge", None, "Nappe connecteur Honor 70", 6.50, "standard"),
    ("Honor", "X8", "Connecteur de charge", None, "Nappe connecteur Honor X8", 5.50, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  GOOGLE PIXEL                                              ║
    # ╚══════════════════════════════════════════════════════════════╝
    ("Google", "Pixel 9 Pro XL", "Ecran", "Original", "Ecran Original Pixel 9 Pro XL", 185.00, "haut_de_gamme"),
    ("Google", "Pixel 9 Pro", "Ecran", "Original", "Ecran Original Pixel 9 Pro", 165.00, "haut_de_gamme"),
    ("Google", "Pixel 9", "Ecran", "Original", "Ecran Original Pixel 9", 125.00, "haut_de_gamme"),
    ("Google", "Pixel 8 Pro", "Ecran", "Original", "Ecran Original Pixel 8 Pro", 145.00, "haut_de_gamme"),
    ("Google", "Pixel 8 Pro", "Ecran", "Soft OLED", "Ecran Soft OLED Pixel 8 Pro", 85.00, "haut_de_gamme"),
    ("Google", "Pixel 8", "Ecran", "Original", "Ecran Original Pixel 8", 115.00, "haut_de_gamme"),
    ("Google", "Pixel 8", "Ecran", "Soft OLED", "Ecran Soft OLED Pixel 8", 68.00, "haut_de_gamme"),
    ("Google", "Pixel 8a", "Ecran", "Original", "Ecran Original Pixel 8a", 75.00, "standard"),
    ("Google", "Pixel 7 Pro", "Ecran", "Original", "Ecran Original Pixel 7 Pro", 120.00, "haut_de_gamme"),
    ("Google", "Pixel 7 Pro", "Ecran", "Soft OLED", "Ecran Soft OLED Pixel 7 Pro", 72.00, "standard"),
    ("Google", "Pixel 7", "Ecran", "Original", "Ecran Original Pixel 7", 95.00, "standard"),
    ("Google", "Pixel 7", "Ecran", "Soft OLED", "Ecran Soft OLED Pixel 7", 58.00, "standard"),
    ("Google", "Pixel 7a", "Ecran", "Original", "Ecran Original Pixel 7a", 73.40, "haut_de_gamme"),
    ("Google", "Pixel 6 Pro", "Ecran", "Original", "Ecran Original Pixel 6 Pro", 95.00, "standard"),
    ("Google", "Pixel 6", "Ecran", "Original", "Ecran Original Pixel 6", 72.00, "standard"),
    ("Google", "Pixel 6a", "Ecran", "Original", "Ecran Original Pixel 6a", 52.00, "standard"),

    # Pixel 9a
    ("Google", "Pixel 9a", "Ecran", "Original", "Ecran Original Pixel 9a", 85.00, "standard"),

    # Pixel Fold
    ("Google", "Pixel Fold", "Ecran", "Original", "Ecran int. Original Pixel Fold", 350.00, "pliant"),

    # Google batteries
    ("Google", "Pixel 9 Pro", "Batterie", None, "Batterie Pixel 9 Pro", 16.00, "standard"),
    ("Google", "Pixel 9", "Batterie", None, "Batterie Pixel 9", 14.00, "standard"),
    ("Google", "Pixel 8 Pro", "Batterie", None, "Batterie Pixel 8 Pro", 14.00, "standard"),
    ("Google", "Pixel 8", "Batterie", None, "Batterie Pixel 8", 12.00, "standard"),
    ("Google", "Pixel 7 Pro", "Batterie", None, "Batterie Pixel 7 Pro", 12.00, "standard"),
    ("Google", "Pixel 7", "Batterie", None, "Batterie Pixel 7", 11.00, "standard"),
    ("Google", "Pixel 6 Pro", "Batterie", None, "Batterie Pixel 6 Pro", 11.00, "standard"),
    ("Google", "Pixel 6", "Batterie", None, "Batterie Pixel 6", 10.00, "standard"),
    ("Google", "Pixel 9a", "Batterie", None, "Batterie Pixel 9a", 12.00, "standard"),

    # Google connecteurs
    ("Google", "Pixel 8 Pro", "Connecteur de charge", None, "Nappe connecteur Pixel 8 Pro", 12.00, "standard"),
    ("Google", "Pixel 8", "Connecteur de charge", None, "Nappe connecteur Pixel 8", 10.00, "standard"),
    ("Google", "Pixel 7 Pro", "Connecteur de charge", None, "Nappe connecteur Pixel 7 Pro", 10.00, "standard"),
    ("Google", "Pixel 7", "Connecteur de charge", None, "Nappe connecteur Pixel 7", 9.00, "standard"),
    ("Google", "Pixel 9a", "Connecteur de charge", None, "Nappe connecteur Pixel 9a", 9.00, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  OPPO                                                      ║
    # ╚══════════════════════════════════════════════════════════════╝
    ("Oppo", "Find X5 Pro", "Ecran", "Original", "Ecran Original Oppo Find X5 Pro", 135.00, "haut_de_gamme"),
    ("Oppo", "Find X3 Pro", "Ecran", "Original", "Ecran Original Oppo Find X3 Pro", 110.00, "haut_de_gamme"),
    ("Oppo", "Reno 10 Pro", "Ecran", "Original", "Ecran Original Oppo Reno 10 Pro", 72.00, "standard"),
    ("Oppo", "Reno 10 Pro", "Ecran", "OLED", "Ecran OLED Oppo Reno 10 Pro", 42.00, "standard"),
    ("Oppo", "Reno 10", "Ecran", "Original", "Ecran Original Oppo Reno 10", 52.00, "standard"),
    ("Oppo", "Reno 10", "Ecran", "Incell", "Ecran Incell Oppo Reno 10", 28.00, "standard"),
    ("Oppo", "Reno 8", "Ecran", "Original", "Ecran Original Oppo Reno 8", 55.00, "standard"),
    ("Oppo", "Reno 8 Lite", "Ecran", "Original", "Ecran Original Oppo Reno 8 Lite", 32.00, "standard"),
    ("Oppo", "A78", "Ecran", "Original", "Ecran Original Oppo A78", 32.00, "standard"),
    ("Oppo", "A78", "Ecran", "Compatible", "Ecran Compatible Oppo A78", 18.00, "standard"),
    ("Oppo", "A57", "Ecran", "Original", "Ecran Original Oppo A57", 25.00, "standard"),
    ("Oppo", "A57", "Ecran", "Compatible", "Ecran Compatible Oppo A57", 15.00, "standard"),
    ("Oppo", "A17", "Ecran", "Original", "Ecran Original Oppo A17", 22.00, "standard"),
    ("Oppo", "A16", "Ecran", "Original", "Ecran Original Oppo A16", 20.00, "standard"),
    ("Oppo", "A16", "Ecran", "Compatible", "Ecran Compatible Oppo A16", 12.00, "standard"),

    # Oppo batteries
    ("Oppo", "Reno 10 Pro", "Batterie", None, "Batterie Oppo Reno 10 Pro", 10.00, "standard"),
    ("Oppo", "Reno 10", "Batterie", None, "Batterie Oppo Reno 10", 9.00, "standard"),
    ("Oppo", "A78", "Batterie", None, "Batterie Oppo A78", 8.50, "standard"),
    ("Oppo", "A57", "Batterie", None, "Batterie Oppo A57", 7.50, "standard"),

    # Oppo connecteurs
    ("Oppo", "Reno 10 Pro", "Connecteur de charge", None, "Nappe connecteur Oppo Reno 10 Pro", 7.50, "standard"),
    ("Oppo", "Reno 10", "Connecteur de charge", None, "Nappe connecteur Oppo Reno 10", 6.50, "standard"),
    ("Oppo", "A78", "Connecteur de charge", None, "Nappe connecteur Oppo A78", 6.00, "standard"),
    ("Oppo", "A57", "Connecteur de charge", None, "Nappe connecteur Oppo A57", 5.50, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  ONEPLUS                                                   ║
    # ╚══════════════════════════════════════════════════════════════╝
    ("OnePlus", "12", "Ecran", "Original", "Ecran Original OnePlus 12", 145.00, "haut_de_gamme"),
    ("OnePlus", "11", "Ecran", "Original", "Ecran Original OnePlus 11", 115.00, "haut_de_gamme"),
    ("OnePlus", "Nord 3", "Ecran", "Original", "Ecran Original OnePlus Nord 3", 58.00, "standard"),
    ("OnePlus", "Nord 3", "Ecran", "OLED", "Ecran OLED OnePlus Nord 3", 35.00, "standard"),
    ("OnePlus", "Nord CE 3 Lite", "Ecran", "Original", "Ecran Original OnePlus Nord CE 3 Lite", 30.00, "standard"),
    ("OnePlus", "Nord CE 3 Lite", "Ecran", "Compatible", "Ecran Compatible OnePlus Nord CE 3 Lite", 18.00, "standard"),
    ("OnePlus", "Nord CE 2 Lite", "Ecran", "Original", "Ecran Original OnePlus Nord CE 2 Lite", 25.00, "standard"),
    ("OnePlus", "Nord N20 SE", "Ecran", "Original", "Ecran Original OnePlus Nord N20 SE", 22.00, "standard"),

    # OnePlus 13
    ("OnePlus", "13", "Ecran", "Original", "Ecran Original OnePlus 13", 165.00, "haut_de_gamme"),

    # OnePlus Nord 4
    ("OnePlus", "Nord 4", "Ecran", "Original", "Ecran Original OnePlus Nord 4", 62.00, "standard"),
    ("OnePlus", "Nord 4", "Ecran", "OLED", "Ecran OLED OnePlus Nord 4", 38.00, "standard"),

    # OnePlus Nord CE 4 Lite
    ("OnePlus", "Nord CE 4 Lite", "Ecran", "Original", "Ecran Original OnePlus Nord CE 4 Lite", 28.00, "standard"),
    ("OnePlus", "Nord CE 4 Lite", "Ecran", "Compatible", "Ecran Compatible OnePlus Nord CE 4 Lite", 16.00, "standard"),

    # OnePlus batteries
    ("OnePlus", "12", "Batterie", None, "Batterie OnePlus 12", 14.00, "standard"),
    ("OnePlus", "11", "Batterie", None, "Batterie OnePlus 11", 12.00, "standard"),
    ("OnePlus", "Nord 3", "Batterie", None, "Batterie OnePlus Nord 3", 10.00, "standard"),
    ("OnePlus", "Nord CE 3 Lite", "Batterie", None, "Batterie OnePlus Nord CE 3 Lite", 8.50, "standard"),
    ("OnePlus", "13", "Batterie", None, "Batterie OnePlus 13", 15.00, "standard"),
    ("OnePlus", "Nord 4", "Batterie", None, "Batterie OnePlus Nord 4", 10.00, "standard"),
    ("OnePlus", "Nord CE 4 Lite", "Batterie", None, "Batterie OnePlus Nord CE 4 Lite", 8.00, "standard"),

    # OnePlus connecteurs
    ("OnePlus", "Nord 3", "Connecteur de charge", None, "Nappe connecteur OnePlus Nord 3", 7.00, "standard"),
    ("OnePlus", "Nord CE 3 Lite", "Connecteur de charge", None, "Nappe connecteur OnePlus Nord CE 3 Lite", 6.00, "standard"),
    ("OnePlus", "13", "Connecteur de charge", None, "Nappe connecteur OnePlus 13", 10.00, "standard"),
    ("OnePlus", "Nord 4", "Connecteur de charge", None, "Nappe connecteur OnePlus Nord 4", 7.00, "standard"),
    ("OnePlus", "Nord CE 4 Lite", "Connecteur de charge", None, "Nappe connecteur OnePlus Nord CE 4 Lite", 5.50, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  MOTOROLA                                                  ║
    # ╚══════════════════════════════════════════════════════════════╝
    ("Motorola", "Edge 40 Pro", "Ecran", "Original", "Ecran Original Motorola Edge 40 Pro", 95.00, "haut_de_gamme"),
    ("Motorola", "Edge 40", "Ecran", "Original", "Ecran Original Motorola Edge 40", 72.00, "standard"),
    ("Motorola", "Edge 40", "Ecran", "OLED", "Ecran OLED Motorola Edge 40", 48.00, "standard"),
    ("Motorola", "Edge 30 Neo", "Ecran", "Original", "Ecran Original Motorola Edge 30 Neo", 52.00, "standard"),
    ("Motorola", "Moto G84", "Ecran", "Original", "Ecran Original Motorola Moto G84", 45.00, "standard"),
    ("Motorola", "Moto G84", "Ecran", "Incell", "Ecran Incell Motorola Moto G84", 25.00, "standard"),
    ("Motorola", "Moto G73", "Ecran", "Original", "Ecran Original Motorola Moto G73", 38.00, "standard"),
    ("Motorola", "Moto G73", "Ecran", "Incell", "Ecran Incell Motorola Moto G73", 22.00, "standard"),
    ("Motorola", "Moto G54", "Ecran", "Original", "Ecran Original Motorola Moto G54", 35.00, "standard"),
    ("Motorola", "Moto G54", "Ecran", "Compatible", "Ecran Compatible Motorola Moto G54", 20.00, "standard"),
    ("Motorola", "Moto G34", "Ecran", "Original", "Ecran Original Motorola Moto G34", 28.00, "standard"),
    ("Motorola", "Moto G34", "Ecran", "Compatible", "Ecran Compatible Motorola Moto G34", 16.00, "standard"),
    ("Motorola", "Moto G23", "Ecran", "Original", "Ecran Original Motorola Moto G23", 25.00, "standard"),
    ("Motorola", "Moto G13", "Ecran", "Original", "Ecran Original Motorola Moto G13", 22.00, "standard"),
    ("Motorola", "Moto E22", "Ecran", "Original", "Ecran Original Motorola Moto E22", 18.00, "standard"),

    # Moto G15
    ("Motorola", "Moto G15", "Ecran", "Original", "Ecran Original Motorola Moto G15", 22.00, "standard"),
    ("Motorola", "Moto G15", "Ecran", "Compatible", "Ecran Compatible Motorola Moto G15", 14.00, "standard"),

    # Edge 50 Pro
    ("Motorola", "Edge 50 Pro", "Ecran", "Original", "Ecran Original Motorola Edge 50 Pro", 105.00, "haut_de_gamme"),
    ("Motorola", "Edge 50 Pro", "Ecran", "OLED", "Ecran OLED Motorola Edge 50 Pro", 62.00, "haut_de_gamme"),

    # Edge 50
    ("Motorola", "Edge 50", "Ecran", "Original", "Ecran Original Motorola Edge 50", 78.00, "standard"),
    ("Motorola", "Edge 50", "Ecran", "OLED", "Ecran OLED Motorola Edge 50", 48.00, "standard"),

    # Motorola batteries
    ("Motorola", "Edge 40", "Batterie", None, "Batterie Motorola Edge 40", 10.00, "standard"),
    ("Motorola", "Moto G84", "Batterie", None, "Batterie Motorola Moto G84", 9.00, "standard"),
    ("Motorola", "Moto G73", "Batterie", None, "Batterie Motorola Moto G73", 8.50, "standard"),
    ("Motorola", "Moto G54", "Batterie", None, "Batterie Motorola Moto G54", 8.00, "standard"),
    ("Motorola", "Moto G34", "Batterie", None, "Batterie Motorola Moto G34", 7.50, "standard"),
    ("Motorola", "Moto G23", "Batterie", None, "Batterie Motorola Moto G23", 7.50, "standard"),
    ("Motorola", "Moto G13", "Batterie", None, "Batterie Motorola Moto G13", 7.00, "standard"),
    ("Motorola", "Moto G15", "Batterie", None, "Batterie Motorola Moto G15", 7.00, "standard"),
    ("Motorola", "Edge 50 Pro", "Batterie", None, "Batterie Motorola Edge 50 Pro", 11.00, "standard"),
    ("Motorola", "Edge 50", "Batterie", None, "Batterie Motorola Edge 50", 10.00, "standard"),

    # Motorola connecteurs
    ("Motorola", "Edge 40", "Connecteur de charge", None, "Nappe connecteur Motorola Edge 40", 7.50, "standard"),
    ("Motorola", "Moto G84", "Connecteur de charge", None, "Nappe connecteur Motorola Moto G84", 6.50, "standard"),
    ("Motorola", "Moto G73", "Connecteur de charge", None, "Nappe connecteur Motorola Moto G73", 6.00, "standard"),
    ("Motorola", "Moto G54", "Connecteur de charge", None, "Nappe connecteur Motorola Moto G54", 5.50, "standard"),
    ("Motorola", "Moto G15", "Connecteur de charge", None, "Nappe connecteur Motorola Moto G15", 5.00, "standard"),
    ("Motorola", "Edge 50 Pro", "Connecteur de charge", None, "Nappe connecteur Motorola Edge 50 Pro", 8.00, "standard"),
    ("Motorola", "Edge 50", "Connecteur de charge", None, "Nappe connecteur Motorola Edge 50", 7.00, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  NOTHING                                                   ║
    # ╚══════════════════════════════════════════════════════════════╝
    ("Nothing", "Phone (2)", "Ecran", "Original", "Ecran Original Nothing Phone 2", 82.00, "standard"),
    ("Nothing", "Phone (2)", "Ecran", "OLED", "Ecran OLED Nothing Phone 2", 48.00, "standard"),
    ("Nothing", "Phone (1)", "Ecran", "Original", "Ecran Original Nothing Phone 1", 58.00, "standard"),
    ("Nothing", "Phone (1)", "Ecran", "OLED", "Ecran OLED Nothing Phone 1", 35.00, "standard"),
    ("Nothing", "Phone (2a)", "Ecran", "Original", "Ecran Original Nothing Phone 2a", 52.00, "standard"),

    # Nothing Phone (2a) Plus
    ("Nothing", "Phone (2a) Plus", "Ecran", "Original", "Ecran Original Nothing Phone 2a Plus", 58.00, "standard"),
    ("Nothing", "Phone (2a) Plus", "Ecran", "OLED", "Ecran OLED Nothing Phone 2a Plus", 35.00, "standard"),

    # Nothing batteries
    ("Nothing", "Phone (2)", "Batterie", None, "Batterie Nothing Phone 2", 10.00, "standard"),
    ("Nothing", "Phone (1)", "Batterie", None, "Batterie Nothing Phone 1", 9.00, "standard"),
    ("Nothing", "Phone (2a)", "Batterie", None, "Batterie Nothing Phone 2a", 9.00, "standard"),
    ("Nothing", "Phone (2a) Plus", "Batterie", None, "Batterie Nothing Phone 2a Plus", 9.50, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  REALME                                                    ║
    # ╚══════════════════════════════════════════════════════════════╝
    ("Realme", "GT 5", "Ecran", "Original", "Ecran Original Realme GT 5", 82.00, "haut_de_gamme"),
    ("Realme", "GT 5", "Ecran", "OLED", "Ecran OLED Realme GT 5", 48.00, "haut_de_gamme"),
    ("Realme", "12 Pro+", "Ecran", "Original", "Ecran Original Realme 12 Pro+", 65.00, "standard"),
    ("Realme", "12 Pro+", "Ecran", "OLED", "Ecran OLED Realme 12 Pro+", 38.00, "standard"),
    ("Realme", "11", "Ecran", "Original", "Ecran Original Realme 11", 42.00, "standard"),
    ("Realme", "11", "Ecran", "Incell", "Ecran Incell Realme 11", 24.00, "standard"),
    ("Realme", "C55", "Ecran", "Original", "Ecran Original Realme C55", 25.00, "standard"),
    ("Realme", "C55", "Ecran", "Compatible", "Ecran Compatible Realme C55", 14.00, "standard"),
    ("Realme", "C53", "Ecran", "Original", "Ecran Original Realme C53", 22.00, "standard"),
    ("Realme", "C53", "Ecran", "Compatible", "Ecran Compatible Realme C53", 13.00, "standard"),

    # Realme batteries
    ("Realme", "GT 5", "Batterie", None, "Batterie Realme GT 5", 11.00, "standard"),
    ("Realme", "12 Pro+", "Batterie", None, "Batterie Realme 12 Pro+", 10.00, "standard"),
    ("Realme", "11", "Batterie", None, "Batterie Realme 11", 9.00, "standard"),
    ("Realme", "C55", "Batterie", None, "Batterie Realme C55", 7.50, "standard"),
    ("Realme", "C53", "Batterie", None, "Batterie Realme C53", 7.50, "standard"),

    # Realme connecteurs
    ("Realme", "GT 5", "Connecteur de charge", None, "Nappe connecteur Realme GT 5", 8.00, "standard"),
    ("Realme", "12 Pro+", "Connecteur de charge", None, "Nappe connecteur Realme 12 Pro+", 7.00, "standard"),
    ("Realme", "11", "Connecteur de charge", None, "Nappe connecteur Realme 11", 6.00, "standard"),
    ("Realme", "C55", "Connecteur de charge", None, "Nappe connecteur Realme C55", 5.50, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  VIVO                                                      ║
    # ╚══════════════════════════════════════════════════════════════╝
    ("Vivo", "X100", "Ecran", "Original", "Ecran Original Vivo X100", 105.00, "haut_de_gamme"),
    ("Vivo", "X100", "Ecran", "OLED", "Ecran OLED Vivo X100", 62.00, "haut_de_gamme"),
    ("Vivo", "V30", "Ecran", "Original", "Ecran Original Vivo V30", 68.00, "standard"),
    ("Vivo", "V30", "Ecran", "OLED", "Ecran OLED Vivo V30", 40.00, "standard"),
    ("Vivo", "Y36", "Ecran", "Original", "Ecran Original Vivo Y36", 28.00, "standard"),
    ("Vivo", "Y36", "Ecran", "Compatible", "Ecran Compatible Vivo Y36", 16.00, "standard"),
    ("Vivo", "Y17s", "Ecran", "Original", "Ecran Original Vivo Y17s", 22.00, "standard"),
    ("Vivo", "Y17s", "Ecran", "Compatible", "Ecran Compatible Vivo Y17s", 13.00, "standard"),

    # Vivo batteries
    ("Vivo", "X100", "Batterie", None, "Batterie Vivo X100", 12.00, "standard"),
    ("Vivo", "V30", "Batterie", None, "Batterie Vivo V30", 10.00, "standard"),
    ("Vivo", "Y36", "Batterie", None, "Batterie Vivo Y36", 8.00, "standard"),
    ("Vivo", "Y17s", "Batterie", None, "Batterie Vivo Y17s", 7.50, "standard"),

    # Vivo connecteurs
    ("Vivo", "X100", "Connecteur de charge", None, "Nappe connecteur Vivo X100", 8.50, "standard"),
    ("Vivo", "V30", "Connecteur de charge", None, "Nappe connecteur Vivo V30", 7.00, "standard"),
    ("Vivo", "Y36", "Connecteur de charge", None, "Nappe connecteur Vivo Y36", 5.50, "standard"),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  SAMSUNG TABLETTES                                         ║
    # ╚══════════════════════════════════════════════════════════════╝
    ("Samsung", "Galaxy Tab A8 10.5 (2022)", "Ecran", "Original", "Ecran Original Samsung Tab A8 10.5", 62.00, "standard"),
    ("Samsung", "Galaxy Tab A8 10.5 (2022)", "Ecran", "Compatible", "Ecran Compatible Samsung Tab A8 10.5", 35.00, "standard"),
    ("Samsung", "Galaxy Tab A7 10.4 (2020)", "Ecran", "Original", "Ecran Original Samsung Tab A7 10.4", 52.00, "standard"),
    ("Samsung", "Galaxy Tab S6 Lite", "Ecran", "Original", "Ecran Original Samsung Tab S6 Lite", 58.00, "standard"),
    ("Samsung", "Galaxy Tab S7", "Ecran", "Original", "Ecran Original Samsung Tab S7", 110.00, "standard"),
    ("Samsung", "Galaxy Tab S8", "Ecran", "Original", "Ecran Original Samsung Tab S8", 135.00, "haut_de_gamme"),

    # Samsung tablettes batteries
    ("Samsung", "Galaxy Tab A8 10.5 (2022)", "Batterie", None, "Batterie Samsung Tab A8 10.5", 16.00, "standard"),
    ("Samsung", "Galaxy Tab A7 10.4 (2020)", "Batterie", None, "Batterie Samsung Tab A7 10.4", 14.00, "standard"),
    ("Samsung", "Galaxy Tab S6 Lite", "Batterie", None, "Batterie Samsung Tab S6 Lite", 15.00, "standard"),
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
    for b, c in sorted(brands.items(), key=lambda x: -x[1]):
        print(f"  {b}: {c} tarifs")

    # Type pieces
    types = {}
    for i in items:
        types[i["type_piece"]] = types.get(i["type_piece"], 0) + 1
    print("\nPar type:")
    for t, c in sorted(types.items(), key=lambda x: -x[1]):
        print(f"  {t}: {c}")

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
