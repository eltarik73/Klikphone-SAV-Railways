"""
API Dépôt à Distance — pré-enregistrement public + validation/refus par accueil.

Formulaire public : 5 dépôts par IP sur 10 minutes ; le même appareil renvoyé dans l'heure
pour le même numéro réutilise le pré-enregistrement ; au plus 3 pré-enregistrements
ouverts par client ; l'e-mail de confirmation ne part qu'à l'adresse du client (nouveau
client, ou adresse déjà connue de sa fiche), jamais à une adresse tierce saisie ici.
"""

from datetime import datetime
from html import escape
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from app.database import get_cursor
from app.api.auth import client_ip, get_current_user
from app.api.public_documents import LimiteurDebit
from app.api.clients import (
    TELEPHONE_FICTIF, enregistrer_consentements, fiche_d_un_autre, find_client_by_phone, meme_personne,
    telephone_fictif,
)
from app.services.notifications import (
    envoyer_discord_embed, DISCORD_COLORS, envoyer_email, _get_param,
)
from app.models import telephone_contact_canonique
from app.services import contact
from app.services.prestations import PRESTATIONS, cle_panne, normaliser
from app.services.search import phone_canonical

try:
    from zoneinfo import ZoneInfo
    _PARIS = ZoneInfo("Europe/Paris")
except Exception:  # image sans base tz : heure du serveur
    _PARIS = None

router = APIRouter(prefix="/api/depot-distance", tags=["depot-distance"])

_LIMITEUR_DEPOT = LimiteurDebit(limite=5, fenetre=600)
MAX_PRE_ENREGISTREMENTS_OUVERTS = 3


def _heure_paris() -> str:
    """« JJ/MM HH:MM » à l'heure de Chambéry pour les lignes du journal texte (serveur en UTC)."""
    return datetime.now(_PARIS).strftime("%d/%m %H:%M") if _PARIS else datetime.now().strftime("%d/%m %H:%M")


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
    # Numéro pour joindre le client pendant la réparation, s'il diffère (tickets.tel_contact)
    tel_contact: Optional[str] = Field(None, max_length=30)
    email: Optional[str] = Field("", max_length=254)
    categorie: str = Field("", max_length=50)
    marque: str = Field("", max_length=80)
    modele: Optional[str] = Field("", max_length=120)
    modele_autre: Optional[str] = Field("", max_length=120)
    panne: str = Field("", max_length=120)
    panne_detail: Optional[str] = Field("", max_length=1000)
    notes_client: Optional[str] = Field("", max_length=2000)
    # Code d'accès de l'appareil (même composant ChoixCodeAcces que la borne) : facultatif
    pin: Optional[str] = Field("", max_length=50)
    pattern: Optional[str] = Field("", max_length=50)
    carte_camby: Optional[int] = 0
    rgpd_informe: Optional[bool] = None
    consentement_marketing: Optional[bool] = None

    @field_validator("nom", "prenom", "telephone", "email", "categorie", "marque",
                     "modele", "modele_autre", "panne", "panne_detail", "notes_client",
                     "pin", "pattern")
    @classmethod
    def _sans_espaces_superflus(cls, v):
        return v.strip() if isinstance(v, str) else v

    # Même forme stockée que /api/clients (0612345678, +41…) : pas de fiche en double
    @field_validator("telephone")
    @classmethod
    def _telephone_canonique(cls, v):
        return phone_canonical(v)

    # Même règle que POST /api/tickets : vide → NULL, numéro non plausible → 422
    _tel_contact = field_validator("tel_contact")(telephone_contact_canonique)


class RefusMotif(BaseModel):
    motif: Optional[str] = Field("", max_length=500)


# ─── PUBLIC: Créer un pré-enregistrement ─────────────────────

@router.post("")
def creer_depot_distance(data: DepotDistanceRequest, bg: BackgroundTasks, request: Request):
    """Pré-enregistre un appareil à distance (public, pas d'auth)."""
    _LIMITEUR_DEPOT.verifier(client_ip(request))
    # Validation basique
    if not data.nom or not data.nom.strip():
        raise HTTPException(400, "Le nom est requis")
    if not data.telephone or not data.telephone.strip():
        raise HTTPException(400, "Le téléphone est requis")
    if telephone_fictif(data.telephone):
        raise HTTPException(422, {"code": "telephone_fictif", "message": TELEPHONE_FICTIF})
    panne, panne_detail = panne_catalogue(data.panne, data.panne_detail)

    # Vérifier si le module est actif
    actif = _get_param("DEPOT_DISTANCE_ACTIF")
    if actif == "false":
        raise HTTPException(400, "Le dépôt à distance n'est pas disponible actuellement.")

    # Littéral non typé : accepté que carte_camby soit INTEGER (prod) ou BOOLEAN (schéma neuf)
    camby = "1" if data.carte_camby else "0"

    with get_cursor() as cur:
        # Client existant quel que soit le format du numéro (06 12…, +33 6…)
        existing = find_client_by_phone(cur, data.telephone)
        # Numéro connu mais au nom de quelqu'un d'autre : nouvelle fiche (règle de /api/clients)
        if fiche_d_un_autre(existing, data.nom, data.prenom):
            existing = None
        email_client = None
        if existing:
            client_id = existing["id"]
            # Verrou du client : deux envois simultanés ne passent pas tous deux les contrôles
            cur.execute("SELECT id FROM clients WHERE id = %s FOR UPDATE", (client_id,))
            # Même appareil renvoyé dans l'heure (double envoi) : le pré-enregistrement existant
            cur.execute("""
                SELECT id, ticket_code FROM tickets
                WHERE client_id = %s AND statut = 'Pré-enregistré' AND source = 'distance'
                  AND date_depot >= LOCALTIMESTAMP - INTERVAL '1 hour'
                  AND COALESCE(marque, '') = %s AND COALESCE(modele, '') = %s
                  AND COALESCE(modele_autre, '') = %s
                ORDER BY id DESC LIMIT 1
            """, (client_id, data.marque or "", data.modele or "", data.modele_autre or ""))
            deja = cur.fetchone()
            if deja:
                return {"id": deja["id"], "ticket_code": deja["ticket_code"], "statut": "Pré-enregistré"}
            cur.execute(
                "SELECT COUNT(*) AS n FROM tickets WHERE client_id = %s AND statut = 'Pré-enregistré'",
                (client_id,),
            )
            if int((cur.fetchone() or {}).get("n") or 0) >= MAX_PRE_ENREGISTREMENTS_OUVERTS:
                raise HTTPException(
                    409,
                    "Vous avez déjà des appareils pré-enregistrés en attente : présentez-vous en boutique "
                    "ou appelez-nous pour en ajouter.",
                )
            # Formulaire public (règle de /api/clients sans jeton) : nom et prénom
            # seulement complétés, jamais l'email ; la carte se déclare, ne se retire pas
            cur.execute("""
                UPDATE clients SET
                    nom = CASE WHEN COALESCE(nom, '') = '' THEN NULLIF(%s, '') ELSE nom END,
                    prenom = CASE WHEN COALESCE(prenom, '') = '' THEN NULLIF(%s, '') ELSE prenom END,
                    carte_camby = CASE WHEN %s = '1' THEN 1 ELSE carte_camby END
                WHERE id = %s
            """, (data.nom, data.prenom, camby, client_id))
            # Numéro connu : l'accord marketing exige la même identité (règle de /api/clients)
            accord = data.consentement_marketing and meme_personne(existing, data.nom, data.prenom)
            # Confirmation seulement à l'adresse déjà connue de la fiche
            connu = (existing.get("email") or "").strip()
            if data.email and connu and connu.lower() == data.email.lower():
                email_client = connu
        else:
            cur.execute("""
                INSERT INTO clients (nom, prenom, telephone, email, carte_camby)
                VALUES (%s, %s, %s, %s, %s) RETURNING id
            """, (data.nom, data.prenom, data.telephone, data.email, camby))
            client_id = cur.fetchone()["id"]
            accord = data.consentement_marketing
            email_client = data.email or None
        enregistrer_consentements(cur, client_id, data.rgpd_informe, accord, canal="depot_distance")

        # Créer le ticket en statut "Pré-enregistré"
        cur.execute("""
            INSERT INTO tickets
            (client_id, categorie, marque, modele, modele_autre,
             panne, panne_detail, notes_client,
             statut, source, tel_contact, pin, pattern)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'Pré-enregistré', 'distance', %s, %s, %s)
            RETURNING id
        """, (
            client_id, data.categorie, data.marque, data.modele,
            data.modele_autre, panne, panne_detail,
            data.notes_client,
            data.tel_contact, data.pin or "", data.pattern or "",
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
            *([{"name": "Joignable", "value": data.tel_contact, "inline": True}] if data.tel_contact else []),
        ],
        notif_type="depot_distance",
    )
    if email_client:
        bg.add_task(
            _envoyer_email_confirmation,
            email_client, data.prenom or data.nom, code, appareil, panne,
        )

    return {"id": tid, "ticket_code": code, "statut": "Pré-enregistré"}


# ─── AUTH: Valider un pré-enregistrement ─────────────────────

@router.put("/{ticket_id}/valider")
def valider_depot(ticket_id: int, bg: BackgroundTasks, user: dict = Depends(get_current_user)):
    """Valide un pré-enregistrement → passe en 'En attente de diagnostic'."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ts = _heure_paris()

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

        # Ligne « Statut: … » (format de change_status) : remet « client contacté » à zéro
        contact.historiser_statut(cur, ticket_id, "Pré-enregistré", "En attente de diagnostic", auteur,
                                  " (pré-enregistrement validé)")

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
    ts = _heure_paris()
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

        contact.historiser_statut(cur, ticket_id, "Pré-enregistré", "Clôturé", auteur,
                                  f" (pré-enregistrement refusé : {motif})")

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
                   t.panne, t.panne_detail, t.date_depot, t.notes_client, t.tel_contact,
                   c.nom AS client_nom, c.prenom AS client_prenom,
                   c.telephone AS client_tel, c.email AS client_email
            FROM tickets t
            JOIN clients c ON t.client_id = c.id
            WHERE t.statut = 'Pré-enregistré' AND t.source = 'distance'
            ORDER BY t.date_depot ASC
        """)
        rows = cur.fetchall()
    return [dict(r) for r in rows]


# Ancien GET /suivi/{code} (public, sans limite, renvoyait le prénom) retiré : le suivi
# client passe par GET /api/tickets/code/{code} (champs restreints, limite de débit).


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
