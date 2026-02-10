"""
API Config — gestion des paramètres boutique (table params).
"""

from fastapi import APIRouter, Depends
from app.database import get_cursor
from app.models import ParamUpdate, ParamOut
from app.api.auth import get_current_user

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get("", response_model=list[ParamOut])
async def list_params(user: dict = Depends(get_current_user)):
    """Liste tous les paramètres."""
    with get_cursor() as cur:
        cur.execute("SELECT cle, valeur FROM params ORDER BY cle")
        return cur.fetchall()


@router.get("/public")
async def get_public_params():
    """Paramètres publics (pour le formulaire client et le suivi)."""
    public_keys = [
        "NOM_BOUTIQUE", "TEL_BOUTIQUE", "ADRESSE_BOUTIQUE",
        "HORAIRES_BOUTIQUE", "URL_SUIVI",
    ]
    with get_cursor() as cur:
        cur.execute(
            "SELECT cle, valeur FROM params WHERE cle = ANY(%s)",
            (public_keys,),
        )
        rows = cur.fetchall()
    return {row["cle"]: row["valeur"] for row in rows}


@router.get("/{cle}")
async def get_param(cle: str, user: dict = Depends(get_current_user)):
    """Récupère un paramètre par clé."""
    with get_cursor() as cur:
        cur.execute("SELECT valeur FROM params WHERE cle = %s", (cle,))
        row = cur.fetchone()
    return {"cle": cle, "valeur": row["valeur"] if row else None}


@router.put("")
async def set_param(data: ParamUpdate, user: dict = Depends(get_current_user)):
    """Crée ou met à jour un paramètre."""
    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO params (cle, valeur) VALUES (%s, %s)
            ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur
        """, (data.cle, data.valeur))
    return {"ok": True}


@router.put("/batch")
async def set_params_batch(
    params: list[ParamUpdate],
    user: dict = Depends(get_current_user),
):
    """Met à jour plusieurs paramètres en une fois."""
    with get_cursor() as cur:
        for p in params:
            cur.execute("""
                INSERT INTO params (cle, valeur) VALUES (%s, %s)
                ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur
            """, (p.cle, p.valeur))
    return {"ok": True}
