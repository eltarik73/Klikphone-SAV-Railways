"""
API Commandes de pièces.
"""

from typing import Optional
from fastapi import APIRouter, Depends, Query
from app.database import get_cursor
from app.models import CommandePieceCreate, CommandePieceUpdate, CommandePieceOut
from app.api.auth import get_current_user

router = APIRouter(prefix="/api/parts", tags=["parts"])


@router.get("", response_model=list[CommandePieceOut])
async def list_parts(
    ticket_id: Optional[int] = None,
    statut: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Liste les commandes de pièces avec filtres."""
    conditions = []
    params = []

    if ticket_id:
        conditions.append("ticket_id = %s")
        params.append(ticket_id)
    if statut:
        conditions.append("statut = %s")
        params.append(statut)

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    with get_cursor() as cur:
        cur.execute(
            f"SELECT * FROM commandes_pieces {where} ORDER BY date_creation DESC",
            params,
        )
        return cur.fetchall()


@router.post("", response_model=dict)
async def create_part(data: CommandePieceCreate, user: dict = Depends(get_current_user)):
    """Crée une commande de pièce."""
    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO commandes_pieces (ticket_id, description, fournisseur, reference, prix, notes)
            VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
        """, (
            data.ticket_id, data.description, data.fournisseur,
            data.reference, data.prix, data.notes,
        ))
        row = cur.fetchone()
    return {"id": row["id"]}


@router.patch("/{commande_id}", response_model=dict)
async def update_part(
    commande_id: int,
    data: CommandePieceUpdate,
    user: dict = Depends(get_current_user),
):
    """Met à jour une commande de pièce."""
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if not updates:
        return {"ok": True}

    set_clause = ", ".join(f"{k} = %s" for k in updates.keys())
    values = list(updates.values()) + [commande_id]

    with get_cursor() as cur:
        cur.execute(f"UPDATE commandes_pieces SET {set_clause} WHERE id = %s", values)

    return {"ok": True}


@router.delete("/{commande_id}", response_model=dict)
async def delete_part(commande_id: int, user: dict = Depends(get_current_user)):
    """Supprime une commande de pièce."""
    with get_cursor() as cur:
        cur.execute("DELETE FROM commandes_pieces WHERE id = %s", (commande_id,))
    return {"ok": True}
