"""
API Email — envoi SMTP réel.
"""

import asyncio
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
    """Envoie un email via SMTP. Retourne (success, message)."""
    smtp_host = _get_param("SMTP_HOST") or "smtp.gmail.com"
    smtp_port = int(_get_param("SMTP_PORT") or 587)
    smtp_user = _get_param("SMTP_USER")
    smtp_pass = _get_param("SMTP_PASSWORD")
    smtp_name = _get_param("SMTP_NAME") or "Klikphone SAV"

    if not smtp_user or not smtp_pass:
        return False, "SMTP non configuré (email ou mot de passe manquant)"

    try:
        msg = MIMEMultipart()
        msg["From"] = formataddr((str(Header(smtp_name, "utf-8")), smtp_user))
        msg["To"] = to
        msg["Subject"] = Header(subject, "utf-8")
        msg.attach(MIMEText(body, "plain", "utf-8"))

        server = smtplib.SMTP(smtp_host, smtp_port, timeout=10)
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.send_message(msg)
        server.quit()

        return True, "Email envoyé avec succès"
    except smtplib.SMTPAuthenticationError:
        return False, "Erreur d'authentification SMTP (vérifiez email/mot de passe)"
    except smtplib.SMTPException as e:
        return False, f"Erreur SMTP: {e}"
    except TimeoutError:
        return False, "Timeout connexion SMTP"
    except Exception as e:
        return False, f"Erreur d'envoi: {e}"


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
