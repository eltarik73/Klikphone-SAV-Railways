"""
API Membres équipe.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import get_cursor
from app.models import MembreEquipeCreate, MembreEquipeUpdate, MembreEquipeOut
from app.api.auth import get_current_user

router = APIRouter(prefix="/api/team", tags=["team"])

ADMIN_CODE_MANAGER = "caramail"


@router.get("", response_model=list[MembreEquipeOut])
async def list_members(user: dict = Depends(get_current_user)):
    """Liste les membres de l'équipe."""
    with get_cursor() as cur:
        cur.execute("SELECT * FROM membres_equipe ORDER BY nom")
        return cur.fetchall()


@router.get("/active", response_model=list[MembreEquipeOut])
async def list_active_members():
    """Liste les membres actifs uniquement (public — utilisé par la page login)."""
    with get_cursor() as cur:
        cur.execute("SELECT * FROM membres_equipe WHERE actif = 1 ORDER BY nom")
        return cur.fetchall()


@router.post("", response_model=dict)
async def create_member(
    data: MembreEquipeCreate,
    admin_code: str = Query(default="", description="Code admin requis pour le rôle Manager"),
    user: dict = Depends(get_current_user),
):
    """Ajoute un membre à l'équipe."""
    if data.role and "manager" in data.role.lower():
        if admin_code != ADMIN_CODE_MANAGER:
            raise HTTPException(403, "Code administrateur incorrect pour le rôle Manager")
    with get_cursor() as cur:
        cur.execute(
            "INSERT INTO membres_equipe (nom, role, couleur) VALUES (%s, %s, %s) RETURNING id",
            (data.nom, data.role, data.couleur),
        )
        row = cur.fetchone()
    return {"id": row["id"]}


@router.patch("/{membre_id}", response_model=dict)
async def update_member(
    membre_id: int,
    data: MembreEquipeUpdate,
    admin_code: str = Query(default="", description="Code admin requis pour le rôle Manager"),
    user: dict = Depends(get_current_user),
):
    """Met à jour un membre."""
    if data.role and "manager" in data.role.lower():
        if admin_code != ADMIN_CODE_MANAGER:
            raise HTTPException(403, "Code administrateur incorrect pour le rôle Manager")
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if not updates:
        return {"ok": True}

    set_clause = ", ".join(f"{k} = %s" for k in updates.keys())
    values = list(updates.values()) + [membre_id]

    with get_cursor() as cur:
        cur.execute(f"UPDATE membres_equipe SET {set_clause} WHERE id = %s", values)

    return {"ok": True}


@router.delete("/{membre_id}", response_model=dict)
async def delete_member(membre_id: int, user: dict = Depends(get_current_user)):
    """Supprime un membre de l'équipe."""
    with get_cursor() as cur:
        cur.execute("DELETE FROM membres_equipe WHERE id = %s", (membre_id,))
    return {"ok": True}
