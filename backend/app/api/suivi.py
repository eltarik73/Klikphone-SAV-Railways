"""
API Suivi client — endpoints publics (sans auth).
Message client, validation devis, avis, interactions dashboard.
"""

from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.database import get_cursor

router = APIRouter(prefix="/api/suivi", tags=["suivi"])


class MessageBody(BaseModel):
    message: str


class DevisValidation(BaseModel):
    accepte: bool


class AvisBody(BaseModel):
    note: int
    commentaire: Optional[str] = ""


def _get_ticket_by_code(cur, code: str):
    cur.execute("SELECT id, statut, ticket_code FROM tickets WHERE ticket_code = %s", (code.strip().upper(),))
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Ticket non trouvé")
    return row


# ─── MESSAGE CLIENT ──────────────────────────────────────
@router.post("/{ticket_code}/message")
async def send_client_message(ticket_code: str, body: MessageBody):
    """Le client envoie un message depuis la page de suivi."""
    if not body.message.strip():
        raise HTTPException(400, "Message vide")
    with get_cursor() as cur:
        t = _get_ticket_by_code(cur, ticket_code)
        cur.execute("""
            INSERT INTO notes_tickets (ticket_id, auteur, contenu, type_note)
            VALUES (%s, 'Client', %s, 'message_client')
        """, (t["id"], body.message.strip()))
    return {"ok": True}


# ─── VALIDATION DEVIS ────────────────────────────────────
@router.post("/{ticket_code}/valider-devis")
async def valider_devis(ticket_code: str, body: DevisValidation):
    """Le client accepte ou refuse le devis depuis la page de suivi."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ts = datetime.now().strftime("%d/%m %H:%M")
    with get_cursor() as cur:
        t = _get_ticket_by_code(cur, ticket_code)
        if body.accepte:
            contenu = "✅ Devis accepté par le client"
            # Passer en "En cours de réparation"
            cur.execute(
                "UPDATE tickets SET statut = 'En cours de réparation', date_maj = %s, "
                "historique = COALESCE(historique, '') || %s || E'\\n' WHERE id = %s",
                (now, f"[{ts}] Devis accepté par le client", t["id"]),
            )
        else:
            contenu = "❌ Devis refusé par le client"
            cur.execute(
                "UPDATE tickets SET date_maj = %s, "
                "historique = COALESCE(historique, '') || %s || E'\\n' WHERE id = %s",
                (now, f"[{ts}] Devis refusé par le client", t["id"]),
            )
        cur.execute("""
            INSERT INTO notes_tickets (ticket_id, auteur, contenu, type_note)
            VALUES (%s, 'Client', %s, 'validation_devis')
        """, (t["id"], contenu))
    return {"ok": True, "accepte": body.accepte}


# ─── AVIS CLIENT ─────────────────────────────────────────
@router.post("/{ticket_code}/avis")
async def laisser_avis(ticket_code: str, body: AvisBody):
    """Le client laisse un avis (étoiles + commentaire)."""
    if body.note < 1 or body.note > 5:
        raise HTTPException(400, "Note entre 1 et 5")
    with get_cursor() as cur:
        t = _get_ticket_by_code(cur, ticket_code)
        # Vérifier qu'il n'a pas déjà laissé un avis
        cur.execute(
            "SELECT id FROM notes_tickets WHERE ticket_id = %s AND type_note = 'avis_client' LIMIT 1",
            (t["id"],),
        )
        if cur.fetchone():
            raise HTTPException(400, "Avis déjà soumis pour ce ticket")
        stars = "⭐" * body.note
        commentaire = f" — {body.commentaire}" if body.commentaire and body.commentaire.strip() else ""
        contenu = f"{stars} ({body.note}/5){commentaire}"
        cur.execute("""
            INSERT INTO notes_tickets (ticket_id, auteur, contenu, type_note)
            VALUES (%s, 'Client', %s, 'avis_client')
        """, (t["id"], contenu))
    return {"ok": True}


# ─── DASHBOARD INTERACTIONS ──────────────────────────────
@router.get("/dashboard/interactions")
async def get_interactions():
    """3 catégories d'interactions non lues : accord_client, messages, avis."""
    with get_cursor() as cur:
        # Accord client (validation_devis non lues)
        cur.execute("""
            SELECT DISTINCT ticket_id FROM notes_tickets
            WHERE type_note = 'validation_devis' AND (is_read = FALSE OR is_read IS NULL)
        """)
        accord_ids = [r["ticket_id"] for r in cur.fetchall()]

        # Messages clients non lus
        cur.execute("""
            SELECT DISTINCT ticket_id FROM notes_tickets
            WHERE type_note = 'message_client' AND (is_read = FALSE OR is_read IS NULL)
        """)
        message_ids = [r["ticket_id"] for r in cur.fetchall()]

        # Avis clients non lus
        cur.execute("""
            SELECT DISTINCT ticket_id FROM notes_tickets
            WHERE type_note = 'avis_client' AND (is_read = FALSE OR is_read IS NULL)
        """)
        avis_ids = [r["ticket_id"] for r in cur.fetchall()]

    total = len(accord_ids) + len(message_ids) + len(avis_ids)
    return {
        "accord_client": {"count": len(accord_ids), "ticket_ids": accord_ids},
        "messages": {"count": len(message_ids), "ticket_ids": message_ids},
        "avis": {"count": len(avis_ids), "ticket_ids": avis_ids},
        "total_actions": total,
    }


# ─── CHECK AVIS EXISTS ──────────────────────────────────
@router.get("/{ticket_code}/has-avis")
async def has_avis(ticket_code: str):
    """Vérifie si un avis a déjà été laissé."""
    with get_cursor() as cur:
        t = _get_ticket_by_code(cur, ticket_code)
        cur.execute(
            "SELECT id FROM notes_tickets WHERE ticket_id = %s AND type_note = 'avis_client' LIMIT 1",
            (t["id"],),
        )
        return {"has_avis": cur.fetchone() is not None}
