"""
API Membres équipe.
"""

import os
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from app.database import get_cursor
from app.models import MembreEquipeCreate, MembreEquipeUpdate, MembreEquipeOut
from app.api.auth import exiger_elevation, get_current_user, noter_echec, noter_succes, verifier_essais

router = APIRouter(prefix="/api/team", tags=["team"])

# Code admin manager : lu UNIQUEMENT depuis l'env var ADMIN_CODE_MANAGER.
# Fail-closed : si la variable n'est pas définie, la création/modification de
# membres au rôle Manager est refusée (plus de fallback hardcodé).
# ⚠️ Poser ADMIN_CODE_MANAGER sur Railway AVANT de déployer.
import secrets as _secrets
ADMIN_CODE_MANAGER = os.getenv("ADMIN_CODE_MANAGER")


def _check_manager_code(request: Request, admin_code: str):
    """Refuse si le code manager n'est pas configuré (503), incorrect (403) ou verrouillé (429)."""
    if not ADMIN_CODE_MANAGER:
        raise HTTPException(503, "Code Manager non configuré (ADMIN_CODE_MANAGER)")
    verifier_essais(request, "manager")
    if not _secrets.compare_digest(str(admin_code).encode("utf-8"), str(ADMIN_CODE_MANAGER).encode("utf-8")):
        noter_echec(request, "manager")
        raise HTTPException(403, "Code administrateur incorrect pour le rôle Manager")
    noter_succes(request, "manager")


def _controler_role(request: Request, user: dict, role, admin_code: str):
    """Rôle Manager : code manager. Rôle admin (droits sur les stats et le marketing) :
    élévation administrateur."""
    r = (role or "").lower()
    if "manager" in r:
        _check_manager_code(request, admin_code)
    if "admin" in r:
        exiger_elevation(request, user)


@router.get("", response_model=list[MembreEquipeOut])
def list_members(user: dict = Depends(get_current_user)):
    """Liste les membres de l'équipe."""
    with get_cursor() as cur:
        cur.execute("SELECT * FROM membres_equipe ORDER BY nom")
        return cur.fetchall()


@router.get("/active", response_model=list[MembreEquipeOut])
def list_active_members():
    """Liste les membres actifs uniquement (public — utilisé par la page login)."""
    with get_cursor() as cur:
        cur.execute("SELECT * FROM membres_equipe WHERE actif = 1 ORDER BY nom")
        return cur.fetchall()


@router.post("", response_model=dict)
def create_member(
    data: MembreEquipeCreate,
    request: Request,
    admin_code: str = Query(default="", description="Code admin requis pour le rôle Manager"),
    user: dict = Depends(get_current_user),
):
    """Ajoute un membre à l'équipe."""
    _controler_role(request, user, data.role, admin_code)
    with get_cursor() as cur:
        cur.execute(
            "INSERT INTO membres_equipe (nom, role, couleur) VALUES (%s, %s, %s) RETURNING id",
            (data.nom, data.role, data.couleur),
        )
        row = cur.fetchone()
    return {"id": row["id"]}


@router.patch("/{membre_id}", response_model=dict)
def update_member(
    membre_id: int,
    data: MembreEquipeUpdate,
    request: Request,
    admin_code: str = Query(default="", description="Code admin requis pour le rôle Manager"),
    user: dict = Depends(get_current_user),
):
    """Met à jour un membre."""
    _controler_role(request, user, data.role, admin_code)
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if not updates:
        return {"ok": True}
    if data.role is None and (data.nom is not None or data.actif is not None):
        # Renommer ou réactiver un membre admin revient à donner ses droits
        with get_cursor() as cur:
            cur.execute("SELECT role FROM membres_equipe WHERE id = %s", (membre_id,))
            actuel = cur.fetchone()
        if actuel and "admin" in (actuel.get("role") or "").lower():
            exiger_elevation(request, user)

    set_clause = ", ".join(f"{k} = %s" for k in updates.keys())
    values = list(updates.values()) + [membre_id]

    with get_cursor() as cur:
        cur.execute(f"UPDATE membres_equipe SET {set_clause} WHERE id = %s", values)

    return {"ok": True}


@router.delete("/{membre_id}", response_model=dict)
def delete_member(membre_id: int, user: dict = Depends(get_current_user)):
    """Supprime un membre de l'équipe."""
    with get_cursor() as cur:
        cur.execute("DELETE FROM membres_equipe WHERE id = %s", (membre_id,))
    return {"ok": True}
