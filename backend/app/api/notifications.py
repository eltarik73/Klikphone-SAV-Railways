"""
API Notifications — messages prédéfinis, WhatsApp, SMS, Email.
"""

import asyncio
from functools import partial

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from app.database import get_cursor
from app.models import SendMessageRequest
from app.api.auth import get_current_user
from app.services.notifications import (
    MESSAGES_PREDEFINIES, generer_message,
    wa_link, sms_link, envoyer_email,
)

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("/templates")
async def list_templates():
    """Liste les templates de messages prédéfinis."""
    return [
        {"key": k, "titre": v["titre"]}
        for k, v in MESSAGES_PREDEFINIES.items()
    ]


@router.post("/generate-message")
async def generate_message(
    ticket_id: int,
    template_key: str,
    user: dict = Depends(get_current_user),
):
    """Génère un message à partir d'un template et des données du ticket."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT t.*, c.nom as client_nom, c.prenom as client_prenom,
                   c.telephone as client_tel, c.email as client_email
            FROM tickets t JOIN clients c ON t.client_id = c.id
            WHERE t.id = %s
        """, (ticket_id,))
        row = cur.fetchone()

    if not row:
        raise HTTPException(404, "Ticket non trouvé")

    template = MESSAGES_PREDEFINIES.get(template_key)
    if not template:
        raise HTTPException(400, f"Template '{template_key}' non trouvé")

    message = generer_message(template_key, row, row)
    return {"message": message, "titre": template["titre"]}


@router.post("/whatsapp")
async def send_whatsapp(
    ticket_id: int,
    message: str,
    user: dict = Depends(get_current_user),
):
    """Génère un lien WhatsApp et marque le ticket."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT t.ticket_code, c.telephone
            FROM tickets t JOIN clients c ON t.client_id = c.id
            WHERE t.id = %s
        """, (ticket_id,))
        row = cur.fetchone()

    if not row or not row["telephone"]:
        raise HTTPException(400, "Pas de numéro de téléphone")

    link = wa_link(row["telephone"], message)

    with get_cursor() as cur:
        cur.execute("UPDATE tickets SET msg_whatsapp = 1 WHERE id = %s", (ticket_id,))

    return {"link": link}


@router.post("/sms")
async def send_sms(
    ticket_id: int,
    message: str,
    user: dict = Depends(get_current_user),
):
    """Génère un lien SMS et marque le ticket."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT t.ticket_code, c.telephone
            FROM tickets t JOIN clients c ON t.client_id = c.id
            WHERE t.id = %s
        """, (ticket_id,))
        row = cur.fetchone()

    if not row or not row["telephone"]:
        raise HTTPException(400, "Pas de numéro de téléphone")

    link = sms_link(row["telephone"], message)

    with get_cursor() as cur:
        cur.execute("UPDATE tickets SET msg_sms = 1 WHERE id = %s", (ticket_id,))

    return {"link": link}


@router.post("/email")
async def send_email_notification(
    ticket_id: int,
    message: str,
    sujet: str = "Klikphone - Mise à jour de votre réparation",
    user: dict = Depends(get_current_user),
):
    """Envoie un email au client."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT t.ticket_code, c.email
            FROM tickets t JOIN clients c ON t.client_id = c.id
            WHERE t.id = %s
        """, (ticket_id,))
        row = cur.fetchone()

    if not row or not row["email"]:
        raise HTTPException(400, "Pas d'adresse email")

    loop = asyncio.get_event_loop()
    success, msg = await loop.run_in_executor(
        None, partial(envoyer_email, row["email"], sujet, message)
    )

    if success:
        with get_cursor() as cur:
            cur.execute("UPDATE tickets SET msg_email = 1 WHERE id = %s", (ticket_id,))

    return {"success": success, "message": msg}
