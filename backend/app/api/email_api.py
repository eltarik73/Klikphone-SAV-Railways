"""
API Email — envoi via Resend (HTTP) ou SMTP fallback.
"""

import asyncio
import base64
import ssl
import smtplib
from functools import partial
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.header import Header

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.database import get_cursor
from app.api.auth import get_current_user

router = APIRouter(prefix="/api/email", tags=["email"])


def _get_param(key: str) -> str:
    with get_cursor() as cur:
        cur.execute("SELECT valeur FROM params WHERE cle = %s", (key,))
        row = cur.fetchone()
    return row["valeur"] if row else ""


def _send_resend(to: str, subject: str, body: str) -> tuple:
    """Envoie un email via l'API HTTP Resend."""
    api_key = _get_param("RESEND_API_KEY")
    if not api_key:
        return False, "Clé API Resend non configurée"

    from_name = _get_param("SMTP_NAME") or "Klikphone"
    from_email = _get_param("SMTP_USER") or "onboarding@resend.dev"

    try:
        with httpx.Client(timeout=15) as client:
            resp = client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": f"{from_name} <{from_email}>",
                    "to": [to],
                    "subject": subject,
                    "text": body,
                },
            )
        if resp.status_code in (200, 201):
            return True, "Email envoyé avec succès"
        else:
            error = resp.json().get("message", resp.text) if resp.headers.get("content-type", "").startswith("application/json") else resp.text
            return False, f"Resend erreur {resp.status_code}: {error}"
    except Exception as e:
        return False, f"Erreur Resend: {str(e)}"


def _send_smtp(to: str, subject: str, body: str) -> tuple:
    """Envoie un email via SMTP. Essaie SSL 465 puis STARTTLS 587."""
    smtp_host = _get_param("SMTP_HOST") or "ex4.mail.ovh.net"
    smtp_user = _get_param("SMTP_USER") or "contact@klikphone.com"
    smtp_pass = _get_param("SMTP_PASSWORD") or "73000Kliks"
    smtp_name = _get_param("SMTP_NAME") or "Klikphone"

    if not smtp_user or not smtp_pass:
        return False, "SMTP non configuré"

    msg = MIMEMultipart()
    msg["From"] = f"{smtp_name} <{smtp_user}>"
    msg["To"] = to
    msg["Subject"] = Header(subject, "utf-8")
    msg.attach(MIMEText(body, "plain", "utf-8"))

    try:
        context = ssl.create_default_context()
        server = smtplib.SMTP_SSL(smtp_host, 465, context=context, timeout=15)
        server.login(smtp_user, smtp_pass)
        server.send_message(msg)
        server.quit()
        return True, "Email envoyé (SMTP)"
    except Exception as e465:
        try:
            server = smtplib.SMTP(smtp_host, 587, timeout=15)
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(smtp_user, smtp_pass)
            server.send_message(msg)
            server.quit()
            return True, "Email envoyé (SMTP 587)"
        except Exception as e587:
            return False, f"SMTP 465: {e465} | 587: {e587}"


def _send_email(to: str, subject: str, body: str) -> tuple:
    """Essaie Resend d'abord, puis SMTP en fallback."""
    resend_key = _get_param("RESEND_API_KEY")
    if resend_key:
        ok, msg = _send_resend(to, subject, body)
        if ok:
            return ok, msg
        # Si Resend échoue, tenter SMTP
    return _send_smtp(to, subject, body)


def _send_resend_html(to: str, subject: str, html: str) -> tuple:
    """Envoie un email HTML via Resend."""
    api_key = _get_param("RESEND_API_KEY")
    if not api_key:
        return False, "Clé API Resend non configurée"

    from_name = _get_param("SMTP_NAME") or "Klikphone"
    from_email = _get_param("SMTP_USER") or "onboarding@resend.dev"

    try:
        with httpx.Client(timeout=15) as client:
            resp = client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": f"{from_name} <{from_email}>",
                    "to": [to],
                    "subject": subject,
                    "html": html,
                },
            )
        if resp.status_code in (200, 201):
            return True, "Email envoyé avec succès"
        else:
            error = resp.json().get("message", resp.text) if resp.headers.get("content-type", "").startswith("application/json") else resp.text
            return False, f"Resend erreur {resp.status_code}: {error}"
    except Exception as e:
        return False, f"Erreur Resend: {str(e)}"


class EmailRequest(BaseModel):
    to: str
    subject: str = "Klikphone SAV"
    body: str


class EmailTestRequest(BaseModel):
    to: str


class SendDocumentRequest(BaseModel):
    ticket_id: int
    doc_type: str
    to: str


@router.post("/envoyer")
async def envoyer_email(data: EmailRequest, user: dict = Depends(get_current_user)):
    """Envoie un email via Resend ou SMTP."""
    loop = asyncio.get_event_loop()
    success, message = await loop.run_in_executor(
        None, partial(_send_email, data.to, data.subject, data.body)
    )
    return {"status": "ok" if success else "error", "message": message}


def _send_resend_pdf(to: str, subject: str, body_html: str, pdf_bytes: bytes, filename: str) -> tuple:
    """Envoie un email avec un PDF en pièce jointe via Resend."""
    api_key = _get_param("RESEND_API_KEY")
    if not api_key:
        return False, "Clé API Resend non configurée"

    from_name = _get_param("SMTP_NAME") or "Klikphone"
    from_email = _get_param("SMTP_USER") or "onboarding@resend.dev"
    pdf_b64 = base64.b64encode(pdf_bytes).decode()

    try:
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": f"{from_name} <{from_email}>",
                    "to": [to],
                    "subject": subject,
                    "html": body_html,
                    "attachments": [
                        {"filename": filename, "content": pdf_b64}
                    ],
                },
            )
        if resp.status_code in (200, 201):
            return True, "Email envoyé avec PDF en pièce jointe"
        else:
            error = resp.json().get("message", resp.text) if resp.headers.get("content-type", "").startswith("application/json") else resp.text
            return False, f"Resend erreur {resp.status_code}: {error}"
    except Exception as e:
        return False, f"Erreur Resend: {str(e)}"


@router.post("/send-document")
async def send_document(data: SendDocumentRequest, user: dict = Depends(get_current_user)):
    """Génère le document PDF A4 et l'envoie par email en pièce jointe."""
    from app.api.print_tickets import _get_ticket_full

    t = _get_ticket_full(data.ticket_id)
    if not t:
        raise HTTPException(404, "Ticket non trouvé")

    ticket_code = t.get("ticket_code", "")
    type_labels = {
        "client": "Reçu de dépôt",
        "staff": "Fiche atelier",
        "devis": "Devis",
        "recu": "Reçu de paiement",
    }
    doc_label = type_labels.get(data.doc_type, "Document")
    subject = f"Klikphone SAV - {doc_label} {ticket_code}"

    # Pour devis et recu : PDF A4 en pièce jointe
    if data.doc_type in ("devis", "recu"):
        from app.api.print_tickets import generate_pdf
        pdf_bytes, filename = generate_pdf(data.ticket_id, data.doc_type)
        if not pdf_bytes:
            raise HTTPException(500, "Erreur lors de la génération du PDF")

        body_html = f"""<div style="font-family:Helvetica,Arial,sans-serif;color:#334155;max-width:480px">
<p>Bonjour,</p>
<p>Veuillez trouver ci-joint votre <b>{doc_label.lower()}</b> pour le ticket <b>{ticket_code}</b>.</p>
<p>N'hésitez pas à nous contacter pour toute question.</p>
<p style="margin-top:20px">Cordialement,<br><b>Klikphone</b><br>
<span style="font-size:12px;color:#94a3b8">79 Place Saint Léger, 73000 Chambéry — 04 79 60 89 22</span></p>
</div>"""

        loop = asyncio.get_event_loop()
        success, message = await loop.run_in_executor(
            None, partial(_send_resend_pdf, data.to, subject, body_html, pdf_bytes, filename)
        )
        return {"status": "ok" if success else "error", "message": message}

    # Pour client et staff : HTML inline (80mm thermique)
    from app.api.print_tickets import (
        _ticket_client_html, _ticket_staff_html,
    )
    generators = {
        "client": _ticket_client_html,
        "staff": _ticket_staff_html,
    }
    gen = generators.get(data.doc_type)
    if not gen:
        raise HTTPException(400, f"Type de document '{data.doc_type}' non supporté")

    html_content = gen(t)
    loop = asyncio.get_event_loop()
    success, message = await loop.run_in_executor(
        None, partial(_send_resend_html, data.to, subject, html_content)
    )
    return {"status": "ok" if success else "error", "message": message}


@router.post("/test")
async def test_email(data: EmailTestRequest, user: dict = Depends(get_current_user)):
    """Envoie un email de test."""
    loop = asyncio.get_event_loop()
    success, message = await loop.run_in_executor(
        None, partial(
            _send_email,
            data.to,
            "Klikphone SAV - Test email",
            "Ceci est un email de test depuis Klikphone SAV.\n\nSi vous recevez ce message, la configuration email est fonctionnelle !"
        )
    )
    return {"status": "ok" if success else "error", "message": message}
