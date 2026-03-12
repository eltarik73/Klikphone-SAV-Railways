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


# ─── DISCORD (EMBEDS) ──────────────────────────────────────────

# Couleurs Discord (valeurs int pour les embeds)
DISCORD_COLORS = {
    "green": 0x22C55E,
    "blue": 0x3B82F6,
    "orange": 0xF97316,
    "red": 0xEF4444,
    "purple": 0x8B5CF6,
    "yellow": 0xEAB308,
    "gray": 0x64748B,
}


def _is_notif_enabled(notif_type: str) -> bool:
    """Vérifie si un type de notification Discord est activé."""
    val = _get_param(f"discord_notif_{notif_type}")
    # Par défaut activé si le param n'existe pas
    return val != "0"


def envoyer_discord_embed(title: str, description: str, color: int = 0x3B82F6, fields: list = None, notif_type: str = ""):
    """Envoie une notification Discord avec un embed riche."""
    try:
        webhook_url = _get_param("DISCORD_WEBHOOK")
        if not webhook_url:
            return False

        # Vérifier si ce type de notification est activé
        if notif_type and not _is_notif_enabled(notif_type):
            return False

        embed = {
            "title": title,
            "description": description,
            "color": color,
            "timestamp": __import__("datetime").datetime.utcnow().isoformat() + "Z",
            "footer": {"text": "Klikphone SAV"},
        }
        if fields:
            embed["fields"] = fields

        with httpx.Client(timeout=5) as client:
            resp = client.post(webhook_url, json={"embeds": [embed]})
            return resp.status_code == 204
    except Exception:
        return False


def test_discord_webhook(webhook_url: str) -> tuple:
    """Teste un webhook Discord en envoyant un embed de test."""
    try:
        embed = {
            "title": "Test Klikphone SAV",
            "description": "Le webhook Discord est correctement configuré !",
            "color": DISCORD_COLORS["green"],
            "footer": {"text": "Klikphone SAV - Test"},
        }
        with httpx.Client(timeout=5) as client:
            resp = client.post(webhook_url, json={"embeds": [embed]})
            if resp.status_code == 204:
                return True, "Webhook fonctionnel"
            return False, f"Erreur HTTP {resp.status_code}"
    except Exception as e:
        return False, f"Erreur: {str(e)}"


def notif_nouveau_ticket(ticket_code: str, appareil: str, panne: str):
    envoyer_discord_embed(
        title="Nouveau ticket",
        description=f"Un nouveau ticket a été créé",
        color=DISCORD_COLORS["blue"],
        fields=[
            {"name": "Ticket", "value": ticket_code, "inline": True},
            {"name": "Appareil", "value": appareil or "-", "inline": True},
            {"name": "Panne", "value": panne or "-", "inline": False},
        ],
        notif_type="nouveau_ticket",
    )


def notif_changement_statut(ticket_code: str, ancien_statut: str, nouveau_statut: str):
    envoyer_discord_embed(
        title="Changement de statut",
        description=f"Le ticket **{ticket_code}** a changé de statut",
        color=DISCORD_COLORS["orange"],
        fields=[
            {"name": "Ancien statut", "value": ancien_statut, "inline": True},
            {"name": "Nouveau statut", "value": nouveau_statut, "inline": True},
        ],
        notif_type="changement_statut",
    )


def notif_accord_client(ticket_code: str, accepte: bool = True):
    if accepte:
        envoyer_discord_embed(
            title="Devis accepté",
            description=f"Le client a **accepté** le devis pour **{ticket_code}**",
            color=DISCORD_COLORS["green"],
            notif_type="accord_client",
        )
    else:
        envoyer_discord_embed(
            title="Devis refusé",
            description=f"Le client a **refusé** le devis pour **{ticket_code}**",
            color=DISCORD_COLORS["red"],
            notif_type="accord_client",
        )


def notif_reparation_terminee(ticket_code: str):
    envoyer_discord_embed(
        title="Réparation terminée",
        description=f"Le ticket **{ticket_code}** est prêt pour récupération !",
        color=DISCORD_COLORS["green"],
        fields=[
            {"name": "Statut", "value": "Prêt à rendre", "inline": True},
        ],
        notif_type="reparation_terminee",
    )


def notif_connexion(utilisateur: str, interface: str):
    envoyer_discord_embed(
        title="Connexion",
        description=f"**{utilisateur}** s'est connecté à **{interface}**",
        color=DISCORD_COLORS["gray"],
        notif_type="connexion",
    )


def notif_deconnexion(utilisateur: str):
    envoyer_discord_embed(
        title="Déconnexion",
        description=f"**{utilisateur}** s'est déconnecté",
        color=DISCORD_COLORS["gray"],
        notif_type="connexion",
    )


def notif_sync_telephones(success: bool, nb_produits: int = 0, nb_marques: int = 0, error: str = None):
    """Notification Discord pour le résultat de la sync téléphones."""
    if success:
        envoyer_discord_embed(
            title="Sync téléphones terminée",
            description="Le catalogue LCD-Phone a été synchronisé avec succès.",
            color=DISCORD_COLORS["green"],
            fields=[
                {"name": "Produits", "value": str(nb_produits), "inline": True},
                {"name": "Marques", "value": str(nb_marques), "inline": True},
            ],
            notif_type="sync_telephones",
        )
    else:
        envoyer_discord_embed(
            title="Sync téléphones échouée",
            description=f"La synchronisation a échoué. **Données conservées** (rollback).\n\n`{error or 'Erreur inconnue'}`",
            color=DISCORD_COLORS["red"],
            notif_type="sync_telephones",
        )


# ─── EMAIL SMTP ─────────────────────────────────────────────────

def envoyer_email(destinataire: str, sujet: str, message: str, html_content: str = None):
    """Envoie un email via SMTP avec option HTML."""
    smtp_host = _get_param("smtp_host")
    smtp_port = _get_param("smtp_port") or "587"
    smtp_user = _get_param("smtp_user")
    smtp_pass = _get_param("smtp_password")
    smtp_from = _get_param("smtp_from") or smtp_user
    smtp_from_name = _get_param("smtp_from_name") or "Klikphone"

    if not smtp_host or not smtp_user or not smtp_pass:
        return False, "Configuration SMTP incomplète"

    try:
        msg = MIMEMultipart("alternative")
        msg["From"] = formataddr((str(Header(smtp_from_name, "utf-8")), smtp_from))
        msg["To"] = destinataire
        msg["Subject"] = Header(sujet, "utf-8")

        msg.attach(MIMEText(message, "plain", "utf-8"))
        if html_content:
            msg.attach(MIMEText(html_content, "html", "utf-8"))

        server = smtplib.SMTP(smtp_host, int(smtp_port), timeout=10)
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.sendmail(smtp_from, destinataire, msg.as_bytes())
        server.quit()

        return True, "Email envoyé avec succès"
    except smtplib.SMTPException as e:
        return False, f"Erreur SMTP: {e}"
    except TimeoutError:
        return False, "Timeout connexion SMTP"
    except Exception as e:
        return False, f"Erreur d'envoi: {e}"


def envoyer_email_avec_pdf(destinataire: str, sujet: str, message: str, pdf_bytes: bytes, filename: str = "document.pdf"):
    """Envoie un email avec une pièce jointe PDF."""
    smtp_host = _get_param("smtp_host")
    smtp_port = _get_param("smtp_port") or "587"
    smtp_user = _get_param("smtp_user")
    smtp_pass = _get_param("smtp_password")
    smtp_from = _get_param("smtp_from") or smtp_user
    smtp_from_name = _get_param("smtp_from_name") or "Klikphone"

    if not smtp_host or not smtp_user or not smtp_pass:
        return False, "Configuration SMTP incomplète"

    try:
        msg = MIMEMultipart()
        msg["From"] = formataddr((str(Header(smtp_from_name, "utf-8")), smtp_from))
        msg["To"] = destinataire
        msg["Subject"] = Header(sujet, "utf-8")
        msg.attach(MIMEText(message, "plain", "utf-8"))

        pdf_part = MIMEApplication(pdf_bytes, _subtype="pdf")
        pdf_part.add_header("Content-Disposition", "attachment", filename=filename)
        msg.attach(pdf_part)

        server = smtplib.SMTP(smtp_host, int(smtp_port), timeout=10)
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.sendmail(smtp_from, destinataire, msg.as_bytes())
        server.quit()

        return True, "Email avec PDF envoyé"
    except smtplib.SMTPException as e:
        return False, f"Erreur SMTP: {e}"
    except TimeoutError:
        return False, "Timeout connexion SMTP"
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
    return f"https://api.qrserver.com/v1/create-qr-code/?size=150x150&data={urllib.parse.quote(data, safe='')}"


# ─── MESSAGES PRÉDÉFINIS ────────────────────────────────────────

MESSAGES_PREDEFINIES = {
    "appareil_recu": {
        "titre": "📱 Appareil reçu",
        "message": """Bonjour {prenom},

Nous avons bien reçu votre {appareil} en atelier.

Ticket : {ticket_code}
Panne signalée : {panne}

Nous allons procéder au diagnostic et vous recontacterons rapidement.

Cordialement,
L'équipe Klikphone
📞 04 79 60 89 22""",
    },
    "diagnostic_en_cours": {
        "titre": "🔍 Diagnostic en cours",
        "message": """Bonjour {prenom},

Le diagnostic de votre {appareil} est en cours.

Problème identifié : {panne}
Réparation proposée : {reparation}
Montant estimé : {prix}€

Merci de nous confirmer votre accord pour procéder à la réparation.

Cordialement,
L'équipe Klikphone
📞 04 79 60 89 22""",
    },
    "devis_a_valider": {
        "titre": "📋 Devis à valider",
        "message": """Bonjour {prenom},

Suite au diagnostic de votre {appareil}, voici notre proposition :

Réparation : {reparation}
Montant : {prix}€

Merci de nous confirmer si vous souhaitez procéder à la réparation.

Cordialement,
L'équipe Klikphone
📞 04 79 60 89 22""",
    },
    "en_cours_reparation": {
        "titre": "🔧 En cours de réparation",
        "message": """Bonjour {prenom},

La réparation de votre {appareil} est en cours.

Nous vous tiendrons informé(e) de l'avancement.

Cordialement,
L'équipe Klikphone""",
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
    "appareil_pret": {
        "titre": "✅ Appareil prêt",
        "message": """Bonjour {prenom},

Votre {appareil} est réparé et prêt à être récupéré !

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
    "non_reparable": {
        "titre": "❌ Non réparable",
        "message": """Bonjour {prenom},

Après diagnostic, nous sommes au regret de vous informer que votre {appareil} n'est malheureusement pas réparable.

Vous pouvez venir le récupérer à notre boutique.

📍 Klikphone - 79 Place Saint Léger, Chambéry
🕐 Lundi-Samedi 10h-19h

Cordialement,
L'équipe Klikphone""",
    },
    "rappel_rdv": {
        "titre": "📅 Rappel de rendez-vous",
        "message": """Bonjour {prenom},

Ceci est un rappel pour votre rendez-vous chez Klikphone.

📍 79 Place Saint Léger, Chambéry
🕐 Lundi-Samedi 10h-19h

N'hésitez pas à nous contacter en cas d'empêchement.

Cordialement,
L'équipe Klikphone
📞 04 79 60 89 22""",
    },
    "personnalise": {
        "titre": "💬 Message personnalisé",
        "message": """Bonjour {prenom},

""",
    },
}


def generer_message(template_key: str, ticket: dict, client: dict) -> str:
    """Génère un message à partir d'un template et des données du ticket."""
    template = MESSAGES_PREDEFINIES.get(template_key)
    if not template:
        return ""

    appareil = ticket.get("modele_autre") or f"{ticket.get('marque', '')} {ticket.get('modele', '')}".strip()
    prix = ticket.get("tarif_final") or ticket.get("devis_estime") or 0

    # Config variables from params table
    adresse = _get_param("adresse") or "79 Place Saint Léger, 73000 Chambéry"
    horaires = _get_param("horaires") or "Lundi-Samedi 10h-19h"
    tel_boutique = _get_param("tel_boutique") or "04 79 60 89 22"
    nom_boutique = _get_param("nom_boutique") or "Klikphone"

    msg = template["message"]
    # Replace config placeholders in hardcoded template text
    msg = msg.replace("04 79 60 89 22", tel_boutique)
    msg = msg.replace("79 Place Saint Léger, Chambéry", adresse)
    msg = msg.replace("79 Place Saint Léger", adresse)
    msg = msg.replace("Lundi-Samedi 10h-19h", horaires)

    return msg.format(
        prenom=client.get("prenom") or client.get("nom", ""),
        appareil=appareil,
        panne=ticket.get("panne", ""),
        reparation=ticket.get("panne", ""),
        prix=prix,
        ticket_code=ticket.get("ticket_code", ""),
    )
