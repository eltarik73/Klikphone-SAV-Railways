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


STATUTS_TERMINAUX = ["Reçue", "Annulée", "Récupérée par client", "Utilisée en réparation"]


@router.get("")
async def list_parts(
    ticket_id: Optional[int] = None,
    statut: Optional[str] = None,
    search: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Liste les commandes de pièces avec filtres.
    statut=en_cours → only active, statut=cloturees → only terminal.
    """
    conditions = []
    params = []

    if ticket_id:
        conditions.append("cp.ticket_id = %s")
        params.append(ticket_id)
    if statut == "en_cours":
        conditions.append("cp.statut NOT IN ('Reçue','Annulée','Récupérée par client','Utilisée en réparation')")
    elif statut == "cloturees":
        conditions.append("cp.statut IN ('Reçue','Annulée','Récupérée par client','Utilisée en réparation')")
    elif statut:
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
            f"""SELECT cp.*, t.ticket_code as linked_ticket_code,
                       t.marque, t.modele, t.modele_autre,
                       c.nom as client_nom, c.prenom as client_prenom, c.telephone as client_tel
                FROM commandes_pieces cp
                LEFT JOIN tickets t ON t.id = cp.ticket_id
                LEFT JOIN clients c ON c.id = t.client_id
                {where}
                ORDER BY cp.date_creation DESC""",
            params,
        )
        rows = cur.fetchall()
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


@router.post("/auto", response_model=dict)
async def create_part_auto(data: dict):
    """Crée une commande de pièce automatiquement lors du dépôt (sans auth)."""
    ticket_id = data.get("ticket_id")
    if not ticket_id:
        raise HTTPException(400, "ticket_id requis")

    with get_cursor() as cur:
        # Get ticket_code
        cur.execute("SELECT ticket_code FROM tickets WHERE id = %s", (ticket_id,))
        t = cur.fetchone()
        ticket_code = t["ticket_code"] if t else ""

        cur.execute("""
            INSERT INTO commandes_pieces (ticket_id, description, fournisseur, prix, notes, ticket_code, statut)
            VALUES (%s, %s, %s, %s, %s, %s, 'En attente') RETURNING id
        """, (
            ticket_id,
            data.get("description", ""),
            data.get("fournisseur", ""),
            data.get("prix") or None,
            data.get("notes", ""),
            ticket_code,
        ))
        row = cur.fetchone()

        # Set ticket status to "En attente de pièce"
        cur.execute(
            "UPDATE tickets SET statut = 'En attente de pièce', commande_piece = 1, date_maj = %s WHERE id = %s",
            (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), ticket_id),
        )

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

    # If changing to 'Reçue' or terminal statut, set date_reception
    if updates.get("statut") in ("Reçue", "Récupérée par client", "Utilisée en réparation") and "date_reception" not in updates:
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

        # Auto-sync: if commande becomes "Reçue", update ticket status to "Pièce reçue"
        if updates.get("statut") == "Reçue":
            cur.execute("SELECT ticket_id FROM commandes_pieces WHERE id = %s", (commande_id,))
            row = cur.fetchone()
            if row and row["ticket_id"]:
                cur.execute(
                    "UPDATE tickets SET statut = 'Pièce reçue', date_maj = %s WHERE id = %s AND statut IN ('En attente de pièce')",
                    (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), row["ticket_id"]),
                )

    return {"ok": True}


@router.delete("/{commande_id}", response_model=dict)
async def delete_part(commande_id: int, user: dict = Depends(get_current_user)):
    """Supprime une commande de pièce."""
    with get_cursor() as cur:
        cur.execute("DELETE FROM commandes_pieces WHERE id = %s", (commande_id,))
    return {"ok": True}


# ─── PUBLIC ENDPOINT (for suivi page) ──────────────────────────
@router.get("/public/{ticket_code}")
async def get_commandes_public(ticket_code: str):
    """Retourne les commandes liées à un ticket (public, infos limitées)."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT c.id, c.description as piece, c.statut,
                   c.date_commande, c.date_reception
            FROM commandes_pieces c
            JOIN tickets t ON t.id = c.ticket_id
            WHERE t.ticket_code = %s
            ORDER BY c.date_creation DESC
        """, (ticket_code,))
        rows = cur.fetchall()
        results = []
        for r in rows:
            d = dict(r)
            for key in ("date_commande", "date_reception"):
                if d.get(key) and hasattr(d[key], "isoformat"):
                    d[key] = d[key].isoformat()
            results.append(d)
        return results
