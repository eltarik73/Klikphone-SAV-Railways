"""
API Dépôt à Distance — pré-enregistrement public + validation/refus par accueil.
"""

from datetime import datetime
from html import escape
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from app.database import get_cursor
from app.api.auth import get_current_user
from app.services.notifications import (
    envoyer_discord_embed, DISCORD_COLORS, envoyer_email, _get_param,
)
from app.services.prestations import PRESTATIONS, cle_panne, normaliser

router = APIRouter(prefix="/api/depot-distance", tags=["depot-distance"])


# ─── MODELS ──────────────────────────────────────────────────

_SYMPTOME_PAR_CLE = {cle: sympt for cle, sympt, *_ in PRESTATIONS if sympt}


def panne_catalogue(panne: str, panne_detail: str = "") -> tuple:
    """(panne, panne_detail) ramenés à la liste du kiosque, sans jamais rejeter.

    Une ancienne valeur (« Écran casse », page chargée avant une mise à jour)
    devient le symptôme du catalogue ; une valeur hors liste devient « Autre »
    et le texte du client est gardé en tête du détail.
    """
    brut = " ".join(str(panne or "").split())
    detail = str(panne_detail or "").strip()
    if not brut:
        return "", detail
    sympt = _SYMPTOME_PAR_CLE.get(cle_panne(brut))
    if sympt:
        return sympt, detail
    if normaliser(brut) == "autre":
        return "Autre", detail
    return "Autre", f"{brut} — {detail}" if detail else brut


class DepotDistanceRequest(BaseModel):
    nom: str = Field(..., max_length=100)
    prenom: Optional[str] = Field("", max_length=100)
    telephone: str = Field(..., max_length=30)
    email: Optional[str] = Field("", max_length=254)
    categorie: str = Field("", max_length=50)
    marque: str = Field("", max_length=80)
    modele: Optional[str] = Field("", max_length=120)
    modele_autre: Optional[str] = Field("", max_length=120)
    panne: str = Field("", max_length=120)
    panne_detail: Optional[str] = Field("", max_length=1000)
    notes_client: Optional[str] = Field("", max_length=2000)
    carte_camby: Optional[int] = 0

    @field_validator("nom", "prenom", "telephone", "email", "categorie", "marque",
                     "modele", "modele_autre", "panne", "panne_detail", "notes_client")
    @classmethod
    def _sans_espaces_superflus(cls, v):
        return v.strip() if isinstance(v, str) else v


class RefusMotif(BaseModel):
    motif: Optional[str] = Field("", max_length=500)


# ─── PUBLIC: Créer un pré-enregistrement ─────────────────────

@router.post("")
def creer_depot_distance(data: DepotDistanceRequest, bg: BackgroundTasks):
    """Pré-enregistre un appareil à distance (public, pas d'auth)."""
    # Validation basique
    if not data.nom or not data.nom.strip():
        raise HTTPException(400, "Le nom est requis")
    if not data.telephone or not data.telephone.strip():
        raise HTTPException(400, "Le téléphone est requis")
    panne, panne_detail = panne_catalogue(data.panne, data.panne_detail)

    # Vérifier si le module est actif
    actif = _get_param("DEPOT_DISTANCE_ACTIF")
    if actif == "false":
        raise HTTPException(400, "Le dépôt à distance n'est pas disponible actuellement.")

    # Littéral non typé : accepté que carte_camby soit INTEGER (prod) ou BOOLEAN (schéma neuf)
    camby = "1" if data.carte_camby else "0"

    with get_cursor() as cur:
        # Créer ou récupérer le client
        cur.execute(
            "SELECT id FROM clients WHERE telephone = %s",
            (data.telephone,),
        )
        existing = cur.fetchone()
        if existing:
            client_id = existing["id"]
            cur.execute("""
                UPDATE clients SET
                    nom = COALESCE(NULLIF(%s, ''), nom),
                    prenom = COALESCE(NULLIF(%s, ''), prenom),
                    email = COALESCE(NULLIF(%s, ''), email),
                    carte_camby = %s
                WHERE id = %s
            """, (data.nom, data.prenom, data.email, camby, client_id))
        else:
            cur.execute("""
                INSERT INTO clients (nom, prenom, telephone, email, carte_camby)
                VALUES (%s, %s, %s, %s, %s) RETURNING id
            """, (data.nom, data.prenom, data.telephone, data.email, camby))
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
            data.modele_autre, panne, panne_detail,
            data.notes_client,
        ))
        row = cur.fetchone()
        tid = row["id"]

        code = f"KP-{tid:06d}"
        from app.api.public_documents import nouveau_jeton
        cur.execute(
            "UPDATE tickets SET ticket_code = %s, suivi_token = %s WHERE id = %s",
            (code, nouveau_jeton(), tid),
        )

    # Notifications en arrière-plan (ne bloque pas la réponse)
    appareil = data.modele_autre if data.modele_autre else f"{data.marque} {data.modele}"
    bg.add_task(
        envoyer_discord_embed,
        title="Nouveau dépôt à distance",
        description="Un client a pré-enregistré un appareil à distance",
        color=DISCORD_COLORS["purple"],
        fields=[
            {"name": "Ticket", "value": code, "inline": True},
            {"name": "Client", "value": f"{data.prenom} {data.nom}", "inline": True},
            {"name": "Appareil", "value": appareil or "-", "inline": True},
            {"name": "Panne", "value": panne or "-", "inline": False},
            {"name": "Téléphone", "value": data.telephone, "inline": True},
        ],
        notif_type="depot_distance",
    )
    if data.email:
        bg.add_task(
            _envoyer_email_confirmation,
            data.email, data.prenom or data.nom, code, appareil, panne,
        )

    return {"id": tid, "ticket_code": code, "statut": "Pré-enregistré"}


# ─── AUTH: Valider un pré-enregistrement ─────────────────────

@router.put("/{ticket_id}/valider")
def valider_depot(ticket_id: int, bg: BackgroundTasks, user: dict = Depends(get_current_user)):
    """Valide un pré-enregistrement → passe en 'En attente de diagnostic'."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ts = datetime.now().strftime("%d/%m %H:%M")

    with get_cursor() as cur:
        cur.execute(
            "SELECT statut, ticket_code, client_id FROM tickets WHERE id = %s FOR UPDATE",
            (ticket_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Ticket non trouvé")
        if row["statut"] != "Pré-enregistré":
            raise HTTPException(400, "Ce ticket n'est pas en pré-enregistrement")

        auteur = (user or {}).get("sub") or "Staff"
        historique_entry = f"[{ts}] Statut: Pré-enregistré → En attente de diagnostic (Validé) — par {auteur}"
        cur.execute("""
            UPDATE tickets SET
                statut = 'En attente de diagnostic',
                date_maj = %s,
                historique = COALESCE(historique, '') || %s
            WHERE id = %s
        """, (now, '\n' + historique_entry, ticket_id))

        cur.execute(
            "INSERT INTO historique (ticket_id, type, contenu) VALUES (%s, 'statut', %s)",
            (ticket_id, f"Pré-enregistrement validé → En attente de diagnostic — par {auteur}"),
        )

        # Récupérer info client pour notification
        cur.execute("SELECT email, nom, prenom FROM clients WHERE id = %s", (row["client_id"],))
        client = cur.fetchone()

    # Notification email au client (SMTP hors du chemin de la réponse)
    if client and client.get("email"):
        bg.add_task(
            _envoyer_email_validation,
            client["email"],
            client.get("prenom") or client.get("nom", ""),
            row["ticket_code"],
        )

    return {"ok": True, "nouveau_statut": "En attente de diagnostic"}


# ─── AUTH: Refuser un pré-enregistrement ─────────────────────

@router.put("/{ticket_id}/refuser")
def refuser_depot(
    ticket_id: int,
    data: RefusMotif,
    bg: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    """Refuse un pré-enregistrement → passe en 'Clôturé'."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ts = datetime.now().strftime("%d/%m %H:%M")
    motif = (data.motif or "").strip() or "Non précisé"
    auteur = (user or {}).get("sub") or "Staff"

    with get_cursor() as cur:
        cur.execute(
            "SELECT statut, ticket_code, client_id FROM tickets WHERE id = %s FOR UPDATE",
            (ticket_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Ticket non trouvé")
        if row["statut"] != "Pré-enregistré":
            raise HTTPException(400, "Ce ticket n'est pas en pré-enregistrement")

        historique_entry = f"[{ts}] Pré-enregistrement refusé — Motif: {motif} — par {auteur}"
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

        cur.execute(
            "INSERT INTO historique (ticket_id, type, contenu) VALUES (%s, 'statut', %s)",
            (ticket_id, f"Pré-enregistrement refusé: {motif} — par {auteur}"),
        )

        cur.execute("SELECT email, nom, prenom FROM clients WHERE id = %s", (row["client_id"],))
        client = cur.fetchone()

    # Notification email (SMTP hors du chemin de la réponse)
    if client and client.get("email"):
        bg.add_task(
            _envoyer_email_refus,
            client["email"],
            client.get("prenom") or client.get("nom", ""),
            row["ticket_code"],
            motif,
        )

    return {"ok": True, "nouveau_statut": "Clôturé"}


# ─── PUBLIC: Liste pré-enregistrements (pour dashboard) ──────

@router.get("/pending")
def get_pending_depots(user: dict = Depends(get_current_user)):
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
def suivi_public(ticket_code: str):
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
        html = html_confirmation(nom_boutique, adresse, tel, prenom, code, appareil, panne)
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

        envoyer_email(email, sujet, message, html_content=html)
    except Exception:
        pass


def html_confirmation(nom_boutique, adresse, tel, prenom, code, appareil, panne) -> str:
    """Gabarit HTML de l'email : toutes les valeurs sont échappées (champs saisis par le public)."""
    nom_boutique, adresse, tel, prenom, code, appareil, panne = (
        escape(str(v or "")) for v in (nom_boutique, adresse, tel, prenom, code, appareil, panne)
    )
    return f"""<!DOCTYPE html>
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
