"""
API Catalogue marques et modèles.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import get_cursor
from app.api.auth import get_current_user, get_optional_user

router = APIRouter(prefix="/api/catalog", tags=["catalog"])


@router.get("/categories")
async def get_categories():
    """Liste les catégories disponibles."""
    return ["Smartphone", "Tablette", "PC Portable", "Console", "Commande", "Autre"]


@router.get("/pannes")
async def get_pannes():
    """Liste les pannes disponibles."""
    return [
        "Écran casse", "Batterie", "Connecteur de charge",
        "Camera avant", "Camera arriere",
        "Bouton volume", "Bouton power",
        "Haut-parleur (je n'entends pas les gens ou la musique)",
        "Microphone (les gens ne m'entendent pas)",
        "Vitre arriere", "Désoxydation", "Problème logiciel",
        "Diagnostic", "Autre",
    ]


@router.get("/marques")
async def get_marques(categorie: str = Query(...)):
    """Liste les marques pour une catégorie."""
    with get_cursor() as cur:
        cur.execute(
            "SELECT DISTINCT marque FROM catalog_marques WHERE categorie = %s ORDER BY marque",
            (categorie,),
        )
        rows = cur.fetchall()
    return [r["marque"] for r in rows]


@router.get("/modeles")
async def get_modeles(categorie: str = Query(...), marque: str = Query(...)):
    """Liste les modèles pour une catégorie et marque."""
    with get_cursor() as cur:
        cur.execute(
            "SELECT DISTINCT modele FROM catalog_modeles WHERE categorie = %s AND marque = %s ORDER BY modele",
            (categorie, marque),
        )
        rows = cur.fetchall()
    return [r["modele"] for r in rows]


@router.post("/marques")
async def add_marque(
    categorie: str = Query(...),
    marque: str = Query(...),
    user: dict = Depends(get_current_user),
):
    """Ajoute une marque au catalogue."""
    with get_cursor() as cur:
        cur.execute(
            "INSERT INTO catalog_marques (categorie, marque) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (categorie, marque),
        )
    return {"ok": True}


@router.post("/modeles")
async def add_modele(
    categorie: str = Query(...),
    marque: str = Query(...),
    modele: str = Query(...),
    user: dict = Depends(get_current_user),
):
    """Ajoute un modèle au catalogue."""
    with get_cursor() as cur:
        cur.execute(
            "INSERT INTO catalog_modeles (categorie, marque, modele) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
            (categorie, marque, modele),
        )
    return {"ok": True}


@router.delete("/marques")
async def delete_marque(
    categorie: str = Query(...),
    marque: str = Query(...),
    user: dict = Depends(get_current_user),
):
    """Supprime une marque du catalogue."""
    with get_cursor() as cur:
        cur.execute(
            "DELETE FROM catalog_marques WHERE categorie = %s AND marque = %s",
            (categorie, marque),
        )
        cur.execute(
            "DELETE FROM catalog_modeles WHERE categorie = %s AND marque = %s",
            (categorie, marque),
        )
    return {"ok": True}


@router.delete("/modeles")
async def delete_modele(
    categorie: str = Query(...),
    marque: str = Query(...),
    modele: str = Query(...),
    user: dict = Depends(get_current_user),
):
    """Supprime un modèle du catalogue."""
    with get_cursor() as cur:
        cur.execute(
            "DELETE FROM catalog_modeles WHERE categorie = %s AND marque = %s AND modele = %s",
            (categorie, marque, modele),
        )
    return {"ok": True}


@router.get("/all")
async def get_all_catalog(user: dict = Depends(get_current_user)):
    """Retourne tout le catalogue (marques + modèles) pour la page config."""
    with get_cursor() as cur:
        cur.execute("SELECT DISTINCT categorie, marque FROM catalog_marques ORDER BY categorie, marque")
        marques = cur.fetchall()
        cur.execute("SELECT DISTINCT categorie, marque, modele FROM catalog_modeles ORDER BY categorie, marque, modele")
        modeles = cur.fetchall()
    return {"marques": marques, "modeles": modeles}
