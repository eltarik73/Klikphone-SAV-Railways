"""
API Email — envoi SMTP réel.
"""

import asyncio
import ssl
import smtplib
from functools import partial
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.header import Header
from email.utils import formataddr

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.database import get_cursor
from app.api.auth import get_current_user

router = APIRouter(prefix="/api/email", tags=["email"])


def _get_param(key: str) -> str:
    with get_cursor() as cur:
        cur.execute("SELECT valeur FROM params WHERE cle = %s", (key,))
        row = cur.fetchone()
    return row["valeur"] if row else ""


def _send_smtp(to: str, subject: str, body: str) -> tuple:
    """Envoie un email via SMTP. Essaie SSL 465 d'abord, puis STARTTLS 587 en fallback."""
    smtp_host = _get_param("SMTP_HOST") or "ex4.mail.ovh.net"
    smtp_user = _get_param("SMTP_USER") or "contact@klikphone.com"
    smtp_pass = _get_param("SMTP_PASSWORD") or "73000Kliks"
    smtp_name = _get_param("SMTP_NAME") or "Klikphone"

    if not smtp_user or not smtp_pass:
        return False, "SMTP non configuré (email ou mot de passe manquant)"

    msg = MIMEMultipart()
    msg["From"] = f"{smtp_name} <{smtp_user}>"
    msg["To"] = to
    msg["Subject"] = Header(subject, "utf-8")
    msg.attach(MIMEText(body, "plain", "utf-8"))

    # Try SSL on port 465 first (works on Railway)
    try:
        context = ssl.create_default_context()
        server = smtplib.SMTP_SSL(smtp_host, 465, context=context, timeout=15)
        server.login(smtp_user, smtp_pass)
        server.send_message(msg)
        server.quit()
        return True, "Email envoyé avec succès"
    except Exception as e465:
        # Fallback: STARTTLS on port 587
        try:
            server = smtplib.SMTP(smtp_host, 587, timeout=15)
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(smtp_user, smtp_pass)
            server.send_message(msg)
            server.quit()
            return True, "Email envoyé avec succès (587)"
        except Exception as e587:
            return False, f"465: {str(e465)} | 587: {str(e587)}"


class EmailRequest(BaseModel):
    to: str
    subject: str = "Klikphone SAV"
    body: str


class EmailTestRequest(BaseModel):
    to: str


@router.post("/envoyer")
async def envoyer_email(data: EmailRequest, user: dict = Depends(get_current_user)):
    """Envoie un email via SMTP."""
    loop = asyncio.get_event_loop()
    success, message = await loop.run_in_executor(
        None, partial(_send_smtp, data.to, data.subject, data.body)
    )
    return {"status": "ok" if success else "error", "message": message}


@router.post("/test")
async def test_email(data: EmailTestRequest, user: dict = Depends(get_current_user)):
    """Envoie un email de test."""
    loop = asyncio.get_event_loop()
    success, message = await loop.run_in_executor(
        None, partial(
            _send_smtp,
            data.to,
            "Klikphone SAV - Test SMTP",
            "Ceci est un email de test depuis Klikphone SAV.\n\nSi vous recevez ce message, la configuration SMTP est fonctionnelle !"
        )
    )
    return {"status": "ok" if success else "error", "message": message}
