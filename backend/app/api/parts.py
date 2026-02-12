"""
API Commandes de pièces.
"""

from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from app.database import get_cursor
from app.models import CommandePieceCreate, CommandePieceUpdate, CommandePieceOut
from app.api.auth import get_current_user

router = APIRouter(prefix="/api/parts", tags=["parts"])


@router.get("")
async def list_parts(
    ticket_id: Optional[int] = None,
    statut: Optional[str] = None,
    search: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Liste les commandes de pièces avec filtres."""
    conditions = []
    params = []

    if ticket_id:
        conditions.append("cp.ticket_id = %s")
        params.append(ticket_id)
    if statut:
        conditions.append("cp.statut = %s")
        params.append(statut)
    if search:
        conditions.append(
            "(cp.description ILIKE %s OR cp.fournisseur ILIKE %s "
            "OR cp.reference ILIKE %s OR cp.ticket_code ILIKE %s)"
        )
        s = f"%{search}%"
        params.extend([s, s, s, s])

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    with get_cursor() as cur:
        cur.execute(
            f"""SELECT cp.*, t.ticket_code as linked_ticket_code
                FROM commandes_pieces cp
                LEFT JOIN tickets t ON t.id = cp.ticket_id
                {where}
                ORDER BY cp.date_creation DESC""",
            params,
        )
        rows = cur.fetchall()
        # Use linked_ticket_code if ticket_code not stored directly
        results = []
        for r in rows:
            d = dict(r)
            if not d.get("ticket_code") and d.get("linked_ticket_code"):
                d["ticket_code"] = d["linked_ticket_code"]
            d.pop("linked_ticket_code", None)
            # Serialize datetimes
            for key in ("date_creation", "date_commande", "date_reception"):
                if d.get(key) and hasattr(d[key], "isoformat"):
                    d[key] = d[key].isoformat()
            results.append(d)
        return results


@router.post("", response_model=dict)
async def create_part(data: CommandePieceCreate, user: dict = Depends(get_current_user)):
    """Crée une commande de pièce."""
    ticket_id = data.ticket_id

    # If ticket_code provided but no ticket_id, resolve it
    if not ticket_id and data.ticket_code:
        with get_cursor() as cur:
            cur.execute("SELECT id FROM tickets WHERE ticket_code = %s", (data.ticket_code.strip(),))
            row = cur.fetchone()
            if row:
                ticket_id = row["id"]

    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO commandes_pieces (ticket_id, description, fournisseur, reference, prix, notes, ticket_code)
            VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id
        """, (
            ticket_id, data.description, data.fournisseur,
            data.reference, data.prix, data.notes, data.ticket_code or '',
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
    updates = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        return {"ok": True}

    # If changing to 'Commandée', set date_commande
    if updates.get("statut") == "Commandée" and "date_commande" not in updates:
        updates["date_commande"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # If changing to 'Reçue', set date_reception
    if updates.get("statut") == "Reçue" and "date_reception" not in updates:
        updates["date_reception"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Resolve ticket_code to ticket_id if needed
    if "ticket_code" in updates and updates["ticket_code"]:
        with get_cursor() as cur:
            cur.execute("SELECT id FROM tickets WHERE ticket_code = %s", (updates["ticket_code"].strip(),))
            row = cur.fetchone()
            if row:
                updates["ticket_id"] = row["id"]

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
