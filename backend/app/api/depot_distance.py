"""
API Dépôt à Distance — pré-enregistrement public + validation/refus par accueil.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.database import get_cursor
from app.api.auth import get_current_user
from app.services.notifications import (
    envoyer_discord_embed, DISCORD_COLORS, envoyer_email, _get_param,
)

router = APIRouter(prefix="/api/depot-distance", tags=["depot-distance"])


# ─── MODELS ──────────────────────────────────────────────────

class DepotDistanceRequest(BaseModel):
    nom: str
    prenom: Optional[str] = ""
    telephone: str
    email: Optional[str] = ""
    categorie: str
    marque: str
    modele: Optional[str] = ""
    modele_autre: Optional[str] = ""
    panne: str
    panne_detail: Optional[str] = ""
    notes_client: Optional[str] = ""


class RefusMotif(BaseModel):
    motif: Optional[str] = ""


# ─── PUBLIC: Créer un pré-enregistrement ─────────────────────

@router.post("")
async def creer_depot_distance(data: DepotDistanceRequest):
    """Pré-enregistre un appareil à distance (public, pas d'auth)."""
    # Vérifier si le module est actif
    actif = _get_param("DEPOT_DISTANCE_ACTIF")
    if actif == "false":
        raise HTTPException(400, "Le dépôt à distance n'est pas disponible actuellement.")

    with get_cursor() as cur:
        # Créer ou récupérer le client
        cur.execute(
            "SELECT id FROM clients WHERE telephone = %s",
            (data.telephone,),
        )
        existing = cur.fetchone()
        if existing:
            client_id = existing["id"]
            # Mettre à jour les infos si fournies
            cur.execute("""
                UPDATE clients SET
                    nom = COALESCE(NULLIF(%s, ''), nom),
                    prenom = COALESCE(NULLIF(%s, ''), prenom),
                    email = COALESCE(NULLIF(%s, ''), email)
                WHERE id = %s
            """, (data.nom, data.prenom, data.email, client_id))
        else:
            cur.execute("""
                INSERT INTO clients (nom, prenom, telephone, email)
                VALUES (%s, %s, %s, %s) RETURNING id
            """, (data.nom, data.prenom, data.telephone, data.email))
            client_id = cur.fetchone()["id"]

        # Créer le ticket en statut "Pré-enregistré"
        cur.execute("""
            INSERT INTO tickets
            (client_id, categorie, marque, modele, modele_autre,
             panne, panne_detail, notes_client,
             statut, source)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'Pré-enregistré', 'distance')
            RETURNING id
        """, (
            client_id, data.categorie, data.marque, data.modele,
            data.modele_autre, data.panne, data.panne_detail,
            data.notes_client,
        ))
        row = cur.fetchone()
        tid = row["id"]

        code = f"KP-{tid:06d}"
        cur.execute("UPDATE tickets SET ticket_code = %s WHERE id = %s", (code, tid))

    # Notification Discord
    appareil = data.modele_autre if data.modele_autre else f"{data.marque} {data.modele}"
    envoyer_discord_embed(
        title="Nouveau dépôt à distance",
        description=f"Un client a pré-enregistré un appareil à distance",
        color=DISCORD_COLORS["purple"],
        fields=[
            {"name": "Ticket", "value": code, "inline": True},
            {"name": "Client", "value": f"{data.prenom} {data.nom}", "inline": True},
            {"name": "Appareil", "value": appareil or "-", "inline": True},
            {"name": "Panne", "value": data.panne or "-", "inline": False},
            {"name": "Téléphone", "value": data.telephone, "inline": True},
        ],
        notif_type="depot_distance",
    )

    # Email de confirmation au client
    if data.email:
        _envoyer_email_confirmation(data.email, data.prenom or data.nom, code, appareil, data.panne)

    return {"id": tid, "ticket_code": code, "statut": "Pré-enregistré"}


# ─── AUTH: Valider un pré-enregistrement ─────────────────────

@router.put("/{ticket_id}/valider")
async def valider_depot(ticket_id: int, user: dict = Depends(get_current_user)):
    """Valide un pré-enregistrement → passe en 'En attente de diagnostic'."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ts = datetime.now().strftime("%d/%m %H:%M")

    with get_cursor() as cur:
        cur.execute(
            "SELECT statut, ticket_code, client_id FROM tickets WHERE id = %s",
            (ticket_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Ticket non trouvé")
        if row["statut"] != "Pré-enregistré":
            raise HTTPException(400, "Ce ticket n'est pas en pré-enregistrement")

        historique_entry = f"[{ts}] Statut: Pré-enregistré → En attente de diagnostic (Validé)"
        cur.execute("""
            UPDATE tickets SET
                statut = 'En attente de diagnostic',
                date_maj = %s,
                historique = COALESCE(historique, '') || %s
            WHERE id = %s
        """, (now, '\n' + historique_entry, ticket_id))

        # Historique structuré
        try:
            cur.execute(
                "INSERT INTO historique (ticket_id, type, contenu) VALUES (%s, 'statut', %s)",
                (ticket_id, "Pré-enregistrement validé → En attente de diagnostic"),
            )
        except Exception:
            pass

        # Récupérer info client pour notification
        cur.execute("SELECT email, nom, prenom FROM clients WHERE id = %s", (row["client_id"],))
        client = cur.fetchone()

    # Notification email au client
    if client and client.get("email"):
        _envoyer_email_validation(
            client["email"],
            client.get("prenom") or client.get("nom", ""),
            row["ticket_code"],
        )

    return {"ok": True, "nouveau_statut": "En attente de diagnostic"}


# ─── AUTH: Refuser un pré-enregistrement ─────────────────────

@router.put("/{ticket_id}/refuser")
async def refuser_depot(
    ticket_id: int,
    data: RefusMotif,
    user: dict = Depends(get_current_user),
):
    """Refuse un pré-enregistrement → passe en 'Clôturé'."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ts = datetime.now().strftime("%d/%m %H:%M")
    motif = data.motif or "Non précisé"

    with get_cursor() as cur:
        cur.execute(
            "SELECT statut, ticket_code, client_id FROM tickets WHERE id = %s",
            (ticket_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Ticket non trouvé")
        if row["statut"] != "Pré-enregistré":
            raise HTTPException(400, "Ce ticket n'est pas en pré-enregistrement")

        historique_entry = f"[{ts}] Pré-enregistrement refusé — Motif: {motif}"
        cur.execute("""
            UPDATE tickets SET
                statut = 'Clôturé',
                date_maj = %s,
                date_cloture = %s,
                historique = COALESCE(historique, '') || %s,
                notes_internes = COALESCE(notes_internes, '') || %s
            WHERE id = %s
        """, (now, now, '\n' + historique_entry,
              f"\n[{ts}] Dépôt à distance refusé — {motif}", ticket_id))

        try:
            cur.execute(
                "INSERT INTO historique (ticket_id, type, contenu) VALUES (%s, 'statut', %s)",
                (ticket_id, f"Pré-enregistrement refusé: {motif}"),
            )
        except Exception:
            pass

        cur.execute("SELECT email, nom, prenom FROM clients WHERE id = %s", (row["client_id"],))
        client = cur.fetchone()

    # Notification email
    if client and client.get("email"):
        _envoyer_email_refus(
            client["email"],
            client.get("prenom") or client.get("nom", ""),
            row["ticket_code"],
            motif,
        )

    return {"ok": True, "nouveau_statut": "Clôturé"}


# ─── PUBLIC: Liste pré-enregistrements (pour dashboard) ──────

@router.get("/pending")
async def get_pending_depots(user: dict = Depends(get_current_user)):
    """Retourne les pré-enregistrements en attente de validation."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT t.id, t.ticket_code, t.marque, t.modele, t.modele_autre,
                   t.panne, t.panne_detail, t.date_depot, t.notes_client,
                   c.nom AS client_nom, c.prenom AS client_prenom,
                   c.telephone AS client_tel, c.email AS client_email
            FROM tickets t
            JOIN clients c ON t.client_id = c.id
            WHERE t.statut = 'Pré-enregistré' AND t.source = 'distance'
            ORDER BY t.date_depot ASC
        """)
        rows = cur.fetchall()
    return [dict(r) for r in rows]


# ─── PUBLIC: Suivi enrichi ───────────────────────────────────

@router.get("/suivi/{ticket_code}")
async def suivi_public(ticket_code: str):
    """Retourne les infos publiques d'un ticket pour le suivi client."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT t.ticket_code, t.statut, t.marque, t.modele, t.modele_autre,
                   t.panne, t.panne_detail, t.date_depot, t.date_maj,
                   t.date_recuperation, t.commande_piece, t.commentaire_client,
                   t.devis_estime, t.tarif_final, t.acompte,
                   t.reduction_montant, t.reduction_pourcentage,
                   t.reparation_supp, t.prix_supp, t.source,
                   c.prenom AS client_prenom
            FROM tickets t
            JOIN clients c ON t.client_id = c.id
            WHERE t.ticket_code = %s
        """, (ticket_code,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Ticket non trouvé")
    return dict(row)


# ─── HELPERS EMAIL ────────────────────────────────────────────

def _envoyer_email_confirmation(email: str, prenom: str, code: str, appareil: str, panne: str):
    """Email de confirmation du pré-enregistrement avec HTML stylé."""
    try:
        nom_boutique = _get_param("nom_boutique") or "Klikphone"
        adresse = _get_param("adresse") or "79 Place Saint Léger, 73000 Chambéry"
        tel = _get_param("tel_boutique") or "04 79 60 89 22"

        sujet = f"{nom_boutique} — Votre numéro de suivi {code}"
        message = f"""Bonjour {prenom},

Votre demande de réparation a bien été pré-enregistrée.

VOTRE NUMERO DE SUIVI : {code}

Appareil : {appareil}
Panne : {panne}

Conservez ce numéro ! Il vous permettra de suivre votre réparation.

Prochaine étape : Présentez-vous en boutique avec votre appareil.
Votre dossier est déjà créé, l'accueil sera plus rapide.

{nom_boutique}
{adresse}
{tel}"""

        html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:'Helvetica Neue',Arial,sans-serif;background:#f1f5f9;">
<div style="max-width:500px;margin:20px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#6366F1,#7C3AED);padding:32px 24px;text-align:center;">
    <h1 style="color:#fff;font-size:22px;margin:0;">{nom_boutique}</h1>
    <p style="color:rgba(255,255,255,0.8);font-size:13px;margin:8px 0 0;">Confirmation de pré-enregistrement</p>
  </div>
  <div style="padding:32px 24px;">
    <p style="color:#334155;font-size:15px;margin:0 0 20px;">Bonjour <strong>{prenom}</strong>,</p>
    <p style="color:#64748B;font-size:14px;margin:0 0 24px;">Votre demande de réparation a bien été enregistrée.</p>

    <div style="background:#F5F3FF;border:2px solid #C4B5FD;border-radius:12px;padding:20px;text-align:center;margin:0 0 24px;">
      <p style="color:#7C3AED;font-size:12px;font-weight:600;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px;">Votre numéro de suivi</p>
      <p style="color:#7C3AED;font-size:32px;font-weight:800;font-family:monospace;margin:0;letter-spacing:3px;">{code}</p>
    </div>

    <div style="background:#F8FAFC;border-radius:10px;padding:16px;margin:0 0 24px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="color:#94A3B8;font-size:12px;padding:4px 0;">Appareil</td><td style="color:#334155;font-size:14px;font-weight:600;text-align:right;">{appareil}</td></tr>
        <tr><td style="color:#94A3B8;font-size:12px;padding:4px 0;">Panne</td><td style="color:#334155;font-size:14px;font-weight:600;text-align:right;">{panne}</td></tr>
      </table>
    </div>

    <div style="background:#EEF2FF;border:1px solid #C7D2FE;border-radius:10px;padding:16px;margin:0 0 24px;">
      <p style="color:#4338CA;font-size:13px;font-weight:700;margin:0 0 10px;">Prochaines étapes :</p>
      <ol style="color:#4F46E5;font-size:13px;margin:0;padding-left:20px;">
        <li style="margin-bottom:6px;">Notre équipe va valider votre demande</li>
        <li style="margin-bottom:6px;">Présentez-vous en boutique avec votre appareil</li>
        <li>Votre dossier est déjà créé — accueil rapide !</li>
      </ol>
    </div>

    <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:12px 16px;margin:0 0 20px;">
      <p style="color:#92400E;font-size:12px;font-weight:600;margin:0;">Conservez bien ce numéro de suivi. Vous pouvez aussi retrouver votre ticket avec votre numéro de téléphone.</p>
    </div>
  </div>
  <div style="background:#F8FAFC;padding:20px 24px;text-align:center;border-top:1px solid #E2E8F0;">
    <p style="color:#64748B;font-size:12px;margin:0;">{nom_boutique} — {adresse}</p>
    <p style="color:#64748B;font-size:12px;margin:4px 0 0;">Tel : {tel}</p>
  </div>
</div>
</body></html>"""

        envoyer_email(email, sujet, message, html_content=html)
    except Exception:
        pass


def _envoyer_email_validation(email: str, prenom: str, code: str):
    """Email quand le pré-enregistrement est validé."""
    try:
        nom_boutique = _get_param("nom_boutique") or "Klikphone"

        sujet = f"{nom_boutique} — Votre appareil est pris en charge ({code})"
        message = f"""Bonjour {prenom},

Votre appareil a été pris en charge par notre équipe.
Ticket : {code}

Vous pouvez suivre l'avancement de votre réparation en ligne.

Cordialement,
L'équipe {nom_boutique}"""

        envoyer_email(email, sujet, message)
    except Exception:
        pass


def _envoyer_email_refus(email: str, prenom: str, code: str, motif: str):
    """Email quand le pré-enregistrement est refusé."""
    try:
        nom_boutique = _get_param("nom_boutique") or "Klikphone"
        tel = _get_param("tel_boutique") or "04 79 60 89 22"

        sujet = f"{nom_boutique} — Votre pré-enregistrement {code}"
        message = f"""Bonjour {prenom},

Nous ne sommes malheureusement pas en mesure de donner suite à votre pré-enregistrement ({code}).

Motif : {motif}

N'hésitez pas à nous contacter pour plus d'informations.

{nom_boutique}
{tel}"""

        envoyer_email(email, sujet, message)
    except Exception:
        pass
