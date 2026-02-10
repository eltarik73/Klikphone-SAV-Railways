"""
API CRUD Tickets — compatible schéma PostgreSQL existant.
Reprend exactement la logique de l'app Streamlit.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.database import get_cursor
from app.models import (
    TicketCreate, TicketUpdate, TicketOut, TicketFull,
    StatusChange, KPIResponse,
)
from app.api.auth import get_current_user, get_optional_user
from app.services.notifications import (
    notif_nouveau_ticket, notif_changement_statut, notif_reparation_terminee,
)

router = APIRouter(prefix="/api/tickets", tags=["tickets"])

STATUTS = [
    "En attente de diagnostic", "En attente de pièce", "Pièce reçue",
    "En attente d'accord client", "En cours de réparation",
    "Réparation terminée", "Rendu au client", "Clôturé",
]


# ─── LISTE / RECHERCHE ─────────────────────────────────────────
@router.get("", response_model=list[TicketFull])
async def list_tickets(
    statut: Optional[str] = None,
    tel: Optional[str] = None,
    code: Optional[str] = None,
    nom: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(100, le=500),
    offset: int = 0,
    user: dict = Depends(get_current_user),
):
    """Liste les tickets avec filtres optionnels."""
    conditions = []
    params = []

    if statut:
        conditions.append("t.statut = %s")
        params.append(statut)
    if tel:
        conditions.append("c.telephone LIKE %s")
        params.append(f"%{tel}%")
    if code:
        conditions.append("t.ticket_code ILIKE %s")
        params.append(f"%{code}%")
    if nom:
        conditions.append("(c.nom ILIKE %s OR c.prenom ILIKE %s)")
        params.extend([f"%{nom}%", f"%{nom}%"])
    if search:
        conditions.append(
            "(t.ticket_code ILIKE %s OR c.nom ILIKE %s OR c.prenom ILIKE %s "
            "OR c.telephone LIKE %s OR t.marque ILIKE %s OR t.modele ILIKE %s)"
        )
        s = f"%{search}%"
        params.extend([s, s, s, s, s, s])

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    query = f"""
        SELECT t.*, 
               c.nom as client_nom, c.prenom as client_prenom,
               c.telephone as client_tel, c.email as client_email,
               c.societe as client_societe, c.carte_camby as client_carte_camby
        FROM tickets t 
        JOIN clients c ON t.client_id = c.id
        {where}
        ORDER BY t.date_depot DESC
        LIMIT %s OFFSET %s
    """
    params.extend([limit, offset])

    with get_cursor() as cur:
        cur.execute(query, params)
        return cur.fetchall()


# ─── TICKET UNIQUE ─────────────────────────────────────────────
@router.get("/{ticket_id}", response_model=TicketFull)
async def get_ticket(ticket_id: int, user: Optional[dict] = Depends(get_optional_user)):
    """Récupère un ticket par ID avec les infos client."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT t.*, 
                   c.nom as client_nom, c.prenom as client_prenom,
                   c.telephone as client_tel, c.email as client_email,
                   c.societe as client_societe, c.carte_camby as client_carte_camby
            FROM tickets t 
            JOIN clients c ON t.client_id = c.id
            WHERE t.id = %s
        """, (ticket_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Ticket non trouvé")
    return row


@router.get("/code/{ticket_code}", response_model=TicketFull)
async def get_ticket_by_code(ticket_code: str):
    """Récupère un ticket par code (public — pour suivi client)."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT t.*, 
                   c.nom as client_nom, c.prenom as client_prenom,
                   c.telephone as client_tel, c.email as client_email,
                   c.societe as client_societe, c.carte_camby as client_carte_camby
            FROM tickets t 
            JOIN clients c ON t.client_id = c.id
            WHERE t.ticket_code = %s
        """, (ticket_code,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Ticket non trouvé")
    return row


# ─── CRÉATION ───────────────────────────────────────────────────
@router.post("", response_model=dict)
async def create_ticket(data: TicketCreate):
    """Crée un nouveau ticket (accessible sans auth — formulaire client)."""
    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO tickets 
            (client_id, categorie, marque, modele, modele_autre, imei,
             panne, panne_detail, pin, pattern, notes_client, 
             commande_piece, statut)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'En attente de diagnostic')
            RETURNING id
        """, (
            data.client_id, data.categorie, data.marque, data.modele,
            data.modele_autre, data.imei, data.panne, data.panne_detail,
            data.pin, data.pattern, data.notes_client, data.commande_piece,
        ))
        row = cur.fetchone()
        tid = row["id"]

        code = f"KP-{tid:06d}"
        cur.execute("UPDATE tickets SET ticket_code = %s WHERE id = %s", (code, tid))

    # Notification Discord (non bloquant)
    appareil = data.modele_autre if data.modele_autre else f"{data.marque} {data.modele}"
    notif_nouveau_ticket(code, appareil, data.panne or data.panne_detail or "Réparation")

    return {"id": tid, "ticket_code": code}


# ─── MISE À JOUR ────────────────────────────────────────────────
@router.patch("/{ticket_id}", response_model=dict)
async def update_ticket(
    ticket_id: int,
    data: TicketUpdate,
    user: dict = Depends(get_current_user),
):
    """Met à jour un ticket (champs partiels)."""
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if not updates:
        return {"ok": True}

    updates["date_maj"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    set_clause = ", ".join(f"{k} = %s" for k in updates.keys())
    values = list(updates.values()) + [ticket_id]

    with get_cursor() as cur:
        cur.execute(
            f"UPDATE tickets SET {set_clause} WHERE id = %s",
            values,
        )

    return {"ok": True}


# ─── CHANGEMENT DE STATUT ───────────────────────────────────────
@router.patch("/{ticket_id}/statut", response_model=dict)
async def change_status(
    ticket_id: int,
    data: StatusChange,
    user: dict = Depends(get_current_user),
):
    """Change le statut d'un ticket avec historique et notifications."""
    if data.statut not in STATUTS:
        raise HTTPException(400, f"Statut invalide. Valides: {STATUTS}")

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ts = datetime.now().strftime("%d/%m %H:%M")

    with get_cursor() as cur:
        # Récupérer ancien statut et historique
        cur.execute("SELECT statut, historique, ticket_code FROM tickets WHERE id = %s", (ticket_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Ticket non trouvé")

        ancien_statut = row.get("statut", "")
        historique = row.get("historique") or ""
        ticket_code = row.get("ticket_code", f"#{ticket_id}")

        # Ajouter à l'historique
        log_entry = f"[{ts}] Statut: {ancien_statut} → {data.statut}"
        new_hist = f"{historique.rstrip()}\n{log_entry}" if historique.strip() else log_entry

        # Mise à jour
        if data.statut == "Clôturé":
            cur.execute(
                "UPDATE tickets SET statut=%s, date_maj=%s, date_cloture=%s, historique=%s WHERE id=%s",
                (data.statut, now, now, new_hist, ticket_id),
            )
        else:
            cur.execute(
                "UPDATE tickets SET statut=%s, date_maj=%s, historique=%s WHERE id=%s",
                (data.statut, now, new_hist, ticket_id),
            )

    # Notifications Discord
    if data.statut == "Réparation terminée":
        notif_reparation_terminee(ticket_code)
    elif ancien_statut and ancien_statut != data.statut:
        notif_changement_statut(ticket_code, ancien_statut, data.statut)

    return {"ok": True, "ancien_statut": ancien_statut, "nouveau_statut": data.statut}


# ─── HISTORIQUE ──────────────────────────────────────────────────
@router.post("/{ticket_id}/historique", response_model=dict)
async def add_history(
    ticket_id: int,
    texte: str = Query(...),
    user: dict = Depends(get_current_user),
):
    """Ajoute une entrée dans l'historique du ticket."""
    ts = datetime.now().strftime("%d/%m %H:%M")
    entry = f"[{ts}] {texte}"

    with get_cursor() as cur:
        cur.execute("SELECT historique FROM tickets WHERE id = %s", (ticket_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Ticket non trouvé")

        historique = row.get("historique") or ""
        new_hist = f"{historique.rstrip()}\n{entry}" if historique.strip() else entry
        cur.execute("UPDATE tickets SET historique = %s WHERE id = %s", (new_hist, ticket_id))

    return {"ok": True}


# ─── NOTE INTERNE ────────────────────────────────────────────────
@router.post("/{ticket_id}/note", response_model=dict)
async def add_note(
    ticket_id: int,
    note: str = Query(...),
    user: dict = Depends(get_current_user),
):
    """Ajoute une note interne au ticket."""
    ts = datetime.now().strftime("%d/%m/%Y %H:%M")

    with get_cursor() as cur:
        cur.execute("SELECT notes_internes FROM tickets WHERE id = %s", (ticket_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Ticket non trouvé")

        existing = row.get("notes_internes") or ""
        new_notes = f"{existing}\n[{ts}] {note}" if existing.strip() else f"[{ts}] {note}"
        cur.execute(
            "UPDATE tickets SET notes_internes = %s, date_maj = %s WHERE id = %s",
            (new_notes, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), ticket_id),
        )

    return {"ok": True}


# ─── SUPPRESSION ─────────────────────────────────────────────────
@router.delete("/{ticket_id}", response_model=dict)
async def delete_ticket(ticket_id: int, user: dict = Depends(get_current_user)):
    """Supprime un ticket et ses commandes de pièces."""
    with get_cursor() as cur:
        cur.execute("DELETE FROM commandes_pieces WHERE ticket_id = %s", (ticket_id,))
        cur.execute("DELETE FROM tickets WHERE id = %s", (ticket_id,))
    return {"ok": True}


# ─── KPI DASHBOARD ───────────────────────────────────────────────
@router.get("/stats/kpi", response_model=KPIResponse)
async def get_kpi(user: dict = Depends(get_current_user)):
    """Récupère les KPI du dashboard."""
    today = datetime.now().strftime("%Y-%m-%d")

    with get_cursor() as cur:
        cur.execute("""
            SELECT 
                COUNT(*) FILTER (WHERE statut = 'En attente de diagnostic') as en_attente_diagnostic,
                COUNT(*) FILTER (WHERE statut = 'En cours de réparation') as en_cours,
                COUNT(*) FILTER (WHERE statut = 'En attente de pièce') as en_attente_piece,
                COUNT(*) FILTER (WHERE statut = 'En attente d''accord client') as en_attente_accord,
                COUNT(*) FILTER (WHERE statut = 'Réparation terminée') as reparation_terminee,
                COUNT(*) FILTER (WHERE statut NOT IN ('Clôturé', 'Rendu au client')) as total_actifs,
                COUNT(*) FILTER (WHERE date_cloture::date = %s::date) as clotures_aujourdhui,
                COUNT(*) FILTER (WHERE date_depot::date = %s::date) as nouveaux_aujourdhui
            FROM tickets
        """, (today, today))
        row = cur.fetchone()

    return KPIResponse(**row) if row else KPIResponse()
