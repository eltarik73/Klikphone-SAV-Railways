"""
OBSOLÈTE — ne fait plus rien (voir main). Données conservées : référence des tests de
non-régression du moteur de prix (estimations du 2026-02-15).

Script d'import des tarifs iPad et MacBook pour KLIKPHONE.
Prix fournisseur HT basés sur les tarifs Mobilax/marché français 2024-2025.
Le calcul prix client est fait automatiquement par le backend :
  - iPad  : (HT × 1.2) + 110€, arrondi au 9 supérieur
  - MacBook: (HT × 1.2) + 120€, arrondi au 9 supérieur

"""

import sys


# ─── DONNÉES iPad ──────────────────────────────────────────────
# Structure: (categorie, modele, ecran_prix_ht, batterie_prix_ht)

APPLE_DEVICES = [

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  iPAD — Modèles standard                                   ║
    # ╚══════════════════════════════════════════════════════════════╝

    ("ipad", "iPad 5 (2017)", 35.00, 11.90),
    ("ipad", "iPad 6 (2018)", 35.00, 11.90),
    ("ipad", "iPad 7 (2019) 10.2\"", 33.00, 12.50),
    ("ipad", "iPad 8 (2020) 10.2\"", 33.00, 12.50),
    ("ipad", "iPad 9 (2021) 10.2\"", 42.00, 13.90),
    ("ipad", "iPad 10 (2022) 10.9\"", 78.00, 15.90),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  iPAD AIR                                                   ║
    # ╚══════════════════════════════════════════════════════════════╝

    ("ipad", "iPad Air 2", 52.00, 9.90),
    ("ipad", "iPad Air 3 (2019)", 86.00, 11.90),
    ("ipad", "iPad Air 4 (2020)", 116.00, 12.50),
    ("ipad", "iPad Air 5 M1 (2022)", 116.00, 13.90),
    ("ipad", "iPad Air 6 M2 11\" (2024)", 135.00, 15.90),
    ("ipad", "iPad Air 6 M2 13\" (2024)", 165.00, 17.90),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  iPAD MINI                                                  ║
    # ╚══════════════════════════════════════════════════════════════╝

    ("ipad", "iPad Mini 4", 48.00, 8.90),
    ("ipad", "iPad Mini 5 (2019)", 64.00, 10.90),
    ("ipad", "iPad Mini 6 (2021)", 98.00, 12.90),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  iPAD PRO                                                   ║
    # ╚══════════════════════════════════════════════════════════════╝

    ("ipad", "iPad Pro 9.7\" (2016)", 88.00, 12.90),
    ("ipad", "iPad Pro 10.5\" (2017)", 90.00, 12.90),
    ("ipad", "iPad Pro 11\" 1re gen (2018)", 115.00, 14.90),
    ("ipad", "iPad Pro 11\" 2e gen (2020)", 118.00, 14.90),
    ("ipad", "iPad Pro 11\" 3e gen M1 (2021)", 128.00, 15.90),
    ("ipad", "iPad Pro 11\" 4e gen M2 (2022)", 128.00, 15.90),
    ("ipad", "iPad Pro 12.9\" 3e gen (2018)", 135.00, 17.90),
    ("ipad", "iPad Pro 12.9\" 4e gen (2020)", 138.00, 17.90),
    ("ipad", "iPad Pro 12.9\" 5e gen M1 (2021)", 149.00, 17.90),
    ("ipad", "iPad Pro 12.9\" 6e gen M2 (2022)", 149.00, 17.90),
    ("ipad", "iPad Pro 13\" M4 (2024)", 195.00, 19.90),
    ("ipad", "iPad Pro 11\" M4 (2024)", 165.00, 17.90),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  MacBook AIR                                                ║
    # ╚══════════════════════════════════════════════════════════════╝

    ("macbook", "MacBook Air 13\" A1466 (2013-2017)", 170.00, 22.90),
    ("macbook", "MacBook Air 13\" A1932 (2018-2019)", 215.00, 28.90),
    ("macbook", "MacBook Air 13\" A2179 (2020 Intel)", 211.00, 28.90),
    ("macbook", "MacBook Air 13\" M1 A2337 (2020)", 225.00, 32.90),
    ("macbook", "MacBook Air 13\" M2 A2681 (2022)", 255.00, 44.90),
    ("macbook", "MacBook Air 13\" M3 A3113 (2024)", 275.00, 48.90),
    ("macbook", "MacBook Air 15\" M2 A2941 (2023)", 295.00, 48.90),
    ("macbook", "MacBook Air 15\" M3 A3114 (2024)", 315.00, 50.90),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  MacBook PRO 13\"                                           ║
    # ╚══════════════════════════════════════════════════════════════╝

    ("macbook", "MacBook Pro 13\" A1706/A1989 Touch Bar (2016-2019)", 205.00, 31.90),
    ("macbook", "MacBook Pro 13\" A2159 (2019)", 210.00, 28.90),
    ("macbook", "MacBook Pro 13\" A2289/A2251 (2020 Intel)", 210.00, 28.90),
    ("macbook", "MacBook Pro 13\" M1 A2338 (2020)", 215.00, 27.90),
    ("macbook", "MacBook Pro 13\" M2 A2681 (2022)", 245.00, 38.90),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  MacBook PRO 14\"                                           ║
    # ╚══════════════════════════════════════════════════════════════╝

    ("macbook", "MacBook Pro 14\" M1 Pro/Max A2442 (2021)", 355.00, 42.90),
    ("macbook", "MacBook Pro 14\" M2 Pro/Max A2779 (2023)", 450.00, 42.90),
    ("macbook", "MacBook Pro 14\" M3 A2918 (2023)", 420.00, 42.90),
    ("macbook", "MacBook Pro 14\" M3 Pro/Max A2918 (2023)", 470.00, 44.90),
    ("macbook", "MacBook Pro 14\" M4 Pro/Max (2024)", 495.00, 46.90),

    # ╔══════════════════════════════════════════════════════════════╗
    # ║  MacBook PRO 16\"                                           ║
    # ╚══════════════════════════════════════════════════════════════╝

    ("macbook", "MacBook Pro 16\" M1 Pro/Max A2485 (2021)", 405.00, 44.90),
    ("macbook", "MacBook Pro 16\" M2 Pro/Max A2780 (2023)", 485.00, 44.90),
    ("macbook", "MacBook Pro 16\" M3 Pro/Max A2991 (2023)", 510.00, 46.90),
    ("macbook", "MacBook Pro 16\" M4 Pro/Max (2024)", 530.00, 48.90),
]


MESSAGE_OBSOLETE = (
    "import_apple_devices.py est obsolète : il vidait la grille (ids des pièces perdus) puis la réimportait. "
    "Utiliser l'import de fichier fournisseur (Tarifs → Importer une liste de prix : aperçu, "
    "puis application, annulable) ou les règles de prix."
)


def main():
    """Neutralisé : aucune requête n'est envoyée."""
    print(MESSAGE_OBSOLETE.format(nom="import_apple_devices.py"), file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
