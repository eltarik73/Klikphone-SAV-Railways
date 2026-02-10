"""
Service de notifications : Discord, Email, WhatsApp, SMS.
Reprend la logique exacte de l'app Streamlit.
"""

import os
import smtplib
import urllib.parse
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
from email.header import Header
from email.utils import formataddr

import httpx

from app.database import get_cursor


# ─── HELPERS ────────────────────────────────────────────────────

def _get_param(key: str) -> str:
    """Récupère un paramètre de la table params."""
    with get_cursor() as cur:
        cur.execute("SELECT valeur FROM params WHERE cle = %s", (key,))
        row = cur.fetchone()
    return row["valeur"] if row else ""


# ─── DISCORD ────────────────────────────────────────────────────

def envoyer_notification_discord(message: str, emoji: str = "📢", utilisateur: str = ""):
    """Envoie une notification vers Discord via webhook (non bloquant)."""
    try:
        webhook_url = _get_param("DISCORD_WEBHOOK")
        if not webhook_url:
            return False

        contenu = f"{emoji} **{utilisateur}** : {message}" if utilisateur else f"{emoji} {message}"

        # Utiliser httpx en mode sync pour ne pas bloquer
        with httpx.Client(timeout=3) as client:
            resp = client.post(webhook_url, json={"content": contenu})
            return resp.status_code == 204
    except Exception:
        return False


def notif_nouveau_ticket(ticket_code: str, appareil: str, panne: str):
    envoyer_notification_discord(f"Nouveau ticket **{ticket_code}** - {appareil} - {panne}", "🆕")


def notif_changement_statut(ticket_code: str, ancien_statut: str, nouveau_statut: str):
    envoyer_notification_discord(f"**{ticket_code}** : {ancien_statut} → **{nouveau_statut}**", "🔄")


def notif_accord_client(ticket_code: str, accepte: bool = True):
    if accepte:
        envoyer_notification_discord(f"**{ticket_code}** : Client a ACCEPTÉ le devis ✅", "✅")
    else:
        envoyer_notification_discord(f"**{ticket_code}** : Client a REFUSÉ le devis", "❌")


def notif_reparation_terminee(ticket_code: str):
    envoyer_notification_discord(f"**{ticket_code}** : Réparation terminée ! Prêt pour récupération", "🎉")


def notif_connexion(utilisateur: str, interface: str):
    envoyer_notification_discord(f"s'est connecté à {interface}", "🟢", utilisateur)


def notif_deconnexion(utilisateur: str):
    envoyer_notification_discord("s'est déconnecté", "🔴", utilisateur)


# ─── EMAIL SMTP ─────────────────────────────────────────────────

def envoyer_email(destinataire: str, sujet: str, message: str, html_content: str = None):
    """Envoie un email via SMTP avec option HTML."""
    smtp_host = _get_param("SMTP_HOST")
    smtp_port = _get_param("SMTP_PORT") or "587"
    smtp_user = _get_param("SMTP_USER")
    smtp_pass = _get_param("SMTP_PASS")
    smtp_from = _get_param("SMTP_FROM")
    smtp_from_name = _get_param("SMTP_FROM_NAME") or "Klikphone"

    if not smtp_host or not smtp_user or not smtp_pass:
        return False, "Configuration SMTP incomplète"

    try:
        msg = MIMEMultipart("alternative")
        msg["From"] = formataddr((str(Header(smtp_from_name, "utf-8")), smtp_from or smtp_user))
        msg["To"] = destinataire
        msg["Subject"] = Header(sujet, "utf-8")

        msg.attach(MIMEText(message, "plain", "utf-8"))
        if html_content:
            msg.attach(MIMEText(html_content, "html", "utf-8"))

        server = smtplib.SMTP(smtp_host, int(smtp_port))
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.sendmail(smtp_from or smtp_user, destinataire, msg.as_bytes())
        server.quit()

        return True, "Email envoyé avec succès"
    except Exception as e:
        return False, f"Erreur d'envoi: {e}"


def envoyer_email_avec_pdf(destinataire: str, sujet: str, message: str, pdf_bytes: bytes, filename: str = "document.pdf"):
    """Envoie un email avec une pièce jointe PDF."""
    smtp_host = _get_param("SMTP_HOST")
    smtp_port = _get_param("SMTP_PORT") or "587"
    smtp_user = _get_param("SMTP_USER")
    smtp_pass = _get_param("SMTP_PASS")
    smtp_from = _get_param("SMTP_FROM")
    smtp_from_name = _get_param("SMTP_FROM_NAME") or "Klikphone"

    if not smtp_host or not smtp_user or not smtp_pass:
        return False, "Configuration SMTP incomplète"

    try:
        msg = MIMEMultipart()
        msg["From"] = formataddr((str(Header(smtp_from_name, "utf-8")), smtp_from or smtp_user))
        msg["To"] = destinataire
        msg["Subject"] = Header(sujet, "utf-8")
        msg.attach(MIMEText(message, "plain", "utf-8"))

        pdf_part = MIMEApplication(pdf_bytes, _subtype="pdf")
        pdf_part.add_header("Content-Disposition", "attachment", filename=filename)
        msg.attach(pdf_part)

        server = smtplib.SMTP(smtp_host, int(smtp_port))
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.sendmail(smtp_from or smtp_user, destinataire, msg.as_bytes())
        server.quit()

        return True, "Email avec PDF envoyé"
    except Exception as e:
        return False, f"Erreur: {e}"


# ─── WHATSAPP / SMS LINKS ──────────────────────────────────────

def wa_link(tel: str, msg: str) -> str:
    """Génère un lien WhatsApp."""
    t = "".join(filter(str.isdigit, tel))
    if t.startswith("0"):
        t = "33" + t[1:]
    return f"https://wa.me/{t}?text={urllib.parse.quote(msg)}"


def sms_link(tel: str, msg: str) -> str:
    """Génère un lien SMS."""
    t = "".join(filter(str.isdigit, tel))
    return f"sms:{t}?body={urllib.parse.quote(msg)}"


def qr_url(data: str) -> str:
    """Génère une URL de QR code."""
    return f"https://api.qrserver.com/v1/create-qr-code/?size=150x150&data={urllib.parse.quote(data)}"


# ─── MESSAGES PRÉDÉFINIS ────────────────────────────────────────

MESSAGES_PREDEFINIES = {
    "diagnostic_termine": {
        "titre": "📋 Diagnostic terminé",
        "message": """Bonjour {prenom},

Le diagnostic de votre {appareil} est terminé.

Problème identifié : {panne}
Réparation proposée : {reparation}
Montant estimé : {prix}€

Merci de nous confirmer votre accord pour procéder à la réparation.

Cordialement,
L'équipe Klikphone
📞 04 79 60 89 22""",
    },
    "attente_piece": {
        "titre": "📦 En attente de pièce",
        "message": """Bonjour {prenom},

Nous avons commandé la pièce nécessaire pour la réparation de votre {appareil}.

Délai estimé : 2-5 jours ouvrés.

Nous vous recontacterons dès réception.

Cordialement,
L'équipe Klikphone""",
    },
    "reparation_terminee": {
        "titre": "✅ Réparation terminée",
        "message": """Bonjour {prenom},

Votre {appareil} est réparé et prêt à être récupéré ! 🎉

📍 Klikphone - 79 Place Saint Léger, Chambéry
🕐 Lundi-Samedi 10h-19h

Montant à régler : {prix}€

N'oubliez pas votre pièce d'identité.

À bientôt !
L'équipe Klikphone""",
    },
    "relance": {
        "titre": "🔔 Relance - Appareil à récupérer",
        "message": """Bonjour {prenom},

Votre {appareil} vous attend chez Klikphone depuis plusieurs jours.

Merci de passer le récupérer à votre convenance.

📍 79 Place Saint Léger, Chambéry
🕐 Lundi-Samedi 10h-19h

Cordialement,
L'équipe Klikphone""",
    },
    "demande_accord": {
        "titre": "⏳ Demande d'accord",
        "message": """Bonjour {prenom},

Suite au diagnostic de votre {appareil}, voici notre proposition :

Réparation : {reparation}
Montant : {prix}€

Merci de nous confirmer si vous souhaitez procéder à la réparation.

Cordialement,
L'équipe Klikphone
📞 04 79 60 89 22""",
    },
    "refus_reparation": {
        "titre": "❌ Appareil non réparé",
        "message": """Bonjour {prenom},

Suite à votre décision, nous n'avons pas procédé à la réparation de votre {appareil}.

Vous pouvez venir le récupérer à notre boutique.

📍 Klikphone - 79 Place Saint Léger, Chambéry
🕐 Lundi-Samedi 10h-19h

Cordialement,
L'équipe Klikphone""",
    },
}


def generer_message(template_key: str, ticket: dict, client: dict) -> str:
    """Génère un message à partir d'un template et des données du ticket."""
    template = MESSAGES_PREDEFINIES.get(template_key)
    if not template:
        return ""

    appareil = ticket.get("modele_autre") or f"{ticket.get('marque', '')} {ticket.get('modele', '')}".strip()
    prix = ticket.get("tarif_final") or ticket.get("devis_estime") or 0

    return template["message"].format(
        prenom=client.get("prenom") or client.get("nom", ""),
        appareil=appareil,
        panne=ticket.get("panne", ""),
        reparation=ticket.get("panne", ""),
        prix=prix,
    )
