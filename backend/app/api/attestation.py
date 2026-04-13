"""
API Attestation de non-réparabilité.
Historique sauvegardé en BDD lié aux clients.
"""

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List

from app.database import get_cursor
from app.api.auth import get_current_user
from app.services.notifications import envoyer_email
from app.api.email_api import _send_resend_html

router = APIRouter(prefix="/api/attestation", tags=["attestation"])


def _ensure_attestation_table():
    """Crée la table attestations si elle n'existe pas."""
    with get_cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS attestations (
                id SERIAL PRIMARY KEY,
                client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
                nom VARCHAR(100) NOT NULL,
                prenom VARCHAR(100) DEFAULT '',
                adresse TEXT DEFAULT '',
                telephone VARCHAR(20) DEFAULT '',
                email VARCHAR(255) DEFAULT '',
                marque VARCHAR(100) NOT NULL,
                modele VARCHAR(100) NOT NULL,
                imei VARCHAR(50) DEFAULT '',
                etat VARCHAR(100) DEFAULT '',
                motif TEXT NOT NULL,
                compte_rendu TEXT DEFAULT '',
                email_envoye BOOLEAN DEFAULT FALSE,
                cree_par VARCHAR(100) DEFAULT '',
                date_creation TIMESTAMP DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_attestations_client ON attestations(client_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_attestations_date ON attestations(date_creation DESC)")

MOIS_FR = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]


class AttestationRequest(BaseModel):
    nom: str
    prenom: Optional[str] = ""
    adresse: Optional[str] = ""
    telephone: Optional[str] = ""
    email: Optional[str] = ""
    marque: str
    modele: str
    imei: Optional[str] = ""
    etat: Optional[str] = ""
    motif: str
    compte_rendu: Optional[str] = ""
    client_id: Optional[int] = None


def _generate_attestation_html(data: AttestationRequest) -> str:
    now = datetime.now()
    date_fr = f"{now.day} {MOIS_FR[now.month - 1]} {now.year}"

    motif_html = data.motif.replace('\n', '<br>') if data.motif else '—'
    cr_html = data.compte_rendu.replace('\n', '<br>') if data.compte_rendu else ''

    cr_section = ''
    if data.compte_rendu:
        cr_section = f"""
    <h3 style="margin-top:25px; font-size:14px; font-weight:bold; text-transform:uppercase;
               border-bottom:1px solid #000; padding-bottom:5px;">
      Compte-rendu technique
    </h3>
    <p style="margin:10px 0; padding:10px; background:#f5f5f5; border-radius:4px;">{cr_html}</p>
"""

    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>Attestation de non-réparabilité</title>
<style>
  @page {{ margin: 15mm; size: A4; }}
  @media print {{ @page {{ size: A4; margin: 15mm; }} body {{ padding: 0; }} }}
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{ font-family: Arial, sans-serif; font-size: 14px; line-height: 1.8; color: #000;
         max-width: 700px; margin: 0 auto; padding: 40px; }}
</style></head><body>

<!-- Logo centré -->
<div style="text-align:center; margin-bottom:20px;">
  <img src="/logo_k.png" width="200" onerror="this.style.display='none'" />
</div>

<!-- En-tête boutique -->
<div style="text-align:center; font-size:12px; color:#555; margin-bottom:30px;">
  KLIKPHONE — Spécialiste Apple &amp; Multimarque<br>
  79 Place Saint Léger, 73000 Chambéry<br>
  Tél: 04 79 60 89 22 — www.klikphone.com<br>
  SIREN: 813 901 191
</div>

<!-- Titre -->
<h1 style="text-align:center; font-size:22px; font-weight:bold; text-transform:uppercase;
           border:2px solid #000; padding:12px; margin:30px 0; letter-spacing:2px;">
  Attestation de Non-Réparabilité
</h1>

<!-- Date -->
<p style="text-align:right; font-size:13px; margin-bottom:20px;">
  Chambéry, le {date_fr}
</p>

<!-- Corps -->
<div style="font-size:14px; line-height:1.8;">
  <p>Je soussigné, <strong>KLIKPHONE</strong>, professionnel de la réparation d'appareils électroniques,
  atteste par la présente que l'appareil décrit ci-dessous a été examiné dans nos ateliers et
  <strong>déclaré non réparable</strong> pour les raisons indiquées.</p>

  <h3 style="margin-top:25px; font-size:14px; font-weight:bold; text-transform:uppercase;
             border-bottom:1px solid #000; padding-bottom:5px;">
    Informations du propriétaire
  </h3>
  <table style="width:100%; font-size:14px; margin:10px 0;">
    <tr><td style="padding:4px 0; width:180px; color:#555;">Nom :</td><td style="font-weight:bold;">{data.nom}</td></tr>
    <tr><td style="padding:4px 0; color:#555;">Prénom :</td><td style="font-weight:bold;">{data.prenom}</td></tr>
    <tr><td style="padding:4px 0; color:#555;">Adresse :</td><td>{data.adresse or '—'}</td></tr>
  </table>

  <h3 style="margin-top:25px; font-size:14px; font-weight:bold; text-transform:uppercase;
             border-bottom:1px solid #000; padding-bottom:5px;">
    Informations de l'appareil
  </h3>
  <table style="width:100%; font-size:14px; margin:10px 0;">
    <tr><td style="padding:4px 0; width:180px; color:#555;">Marque :</td><td style="font-weight:bold;">{data.marque}</td></tr>
    <tr><td style="padding:4px 0; color:#555;">Modèle :</td><td style="font-weight:bold;">{data.modele}</td></tr>
    <tr><td style="padding:4px 0; color:#555;">IMEI / N° série :</td><td>{data.imei or '—'}</td></tr>
    <tr><td style="padding:4px 0; color:#555;">État général :</td><td>{data.etat or '—'}</td></tr>
  </table>

  <h3 style="margin-top:25px; font-size:14px; font-weight:bold; text-transform:uppercase;
             border-bottom:1px solid #000; padding-bottom:5px;">
    Motif de non-réparabilité
  </h3>
  <p style="margin:10px 0; padding:10px; background:#f5f5f5; border-radius:4px;">{motif_html}</p>

  {cr_section}

  <p style="margin-top:25px;">
    Cette attestation est délivrée pour servir et valoir ce que de droit, notamment auprès
    des compagnies d'assurance.
  </p>
</div>

<!-- Signature -->
<div style="margin-top:50px;">
  <p style="font-size:13px; margin-bottom:10px;">Fait à Chambéry, le {date_fr}</p>
  <p style="font-size:13px; font-weight:bold; margin-bottom:15px;">Signature et cachet :</p>
  <img src="/tampon_klikphone.png" width="250" style="margin-top:10px;"
       onerror="this.nextElementSibling.style.display='inline-block'; this.style.display='none';" />
  <div style="display:none; border:2px solid #000; border-radius:8px; padding:15px;
              transform:rotate(-3deg); font-family:Arial; text-align:center;">
    <div style="font-size:16px; font-weight:bold;">KLIKPHONE</div>
    <div style="font-size:11px;">Spécialiste Apple</div>
    <div style="font-size:10px;">79 Place St Léger — 73000 Chambéry</div>
    <div style="font-size:10px;">04 79 60 89 22</div>
    <div style="font-size:9px;">SIREN: 813 901 191</div>
  </div>
</div>

<!-- Footer -->
<div style="margin-top:40px; border-top:1px solid #ccc; padding-top:10px; font-size:10px; color:#888; text-align:center;">
  KLIKPHONE — 79 Place Saint Léger, 73000 Chambéry — SIREN: 813 901 191
</div>
</body></html>"""


def _save_attestation(data: AttestationRequest, user: dict, email_envoye: bool = False):
    """Sauvegarde l'attestation en base de données."""
    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO attestations
                (client_id, nom, prenom, adresse, telephone, email,
                 marque, modele, imei, etat, motif, compte_rendu,
                 email_envoye, cree_par)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (
            data.client_id, data.nom, data.prenom or '', data.adresse or '',
            data.telephone or '', data.email or '',
            data.marque, data.modele, data.imei or '', data.etat or '',
            data.motif, data.compte_rendu or '',
            email_envoye, user.get("utilisateur", ""),
        ))
        row = cur.fetchone()
    return row["id"] if row else None


@router.post("/generate")
async def generate_attestation(
    data: AttestationRequest,
    user: dict = Depends(get_current_user),
):
    """Génère l'attestation HTML et la sauvegarde en BDD."""
    html = _generate_attestation_html(data)
    att_id = _save_attestation(data, user, email_envoye=False)
    return {"html": html, "attestation_id": att_id}


@router.post("/email")
async def email_attestation(
    data: AttestationRequest,
    destinataire: str,
    user: dict = Depends(get_current_user),
):
    """Envoie l'attestation par email et la sauvegarde."""
    html = _generate_attestation_html(data)
    sujet = f"Attestation de non-réparabilité — {data.marque} {data.modele}"
    message = (
        f"Bonjour {data.prenom} {data.nom},\n\n"
        f"Veuillez trouver ci-joint l'attestation de non-réparabilité "
        f"de votre appareil {data.marque} {data.modele}.\n\n"
        f"Cordialement,\nKLIKPHONE - 04 79 60 89 22"
    )

    # Essaie Resend (HTTP, fiable depuis Railway) puis SMTP en fallback
    success, msg = _send_resend_html(destinataire, sujet, html)
    if not success:
        success, msg = envoyer_email(destinataire, sujet, message, html)

    # Sauvegarde avec le statut email
    data.email = destinataire
    _save_attestation(data, user, email_envoye=success)

    return {"success": success, "message": msg}


@router.get("/history")
async def list_attestations(
    client_id: Optional[int] = Query(None),
    limit: int = Query(50, le=200),
    user: dict = Depends(get_current_user),
):
    """Liste l'historique des attestations, optionnellement filtré par client."""
    conditions = []
    params = []
    if client_id is not None:
        conditions.append("a.client_id = %s")
        params.append(client_id)
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    params.append(limit)

    with get_cursor() as cur:
        cur.execute(f"""
            SELECT a.*, c.telephone AS client_telephone
            FROM attestations a
            LEFT JOIN clients c ON c.id = a.client_id
            {where}
            ORDER BY a.date_creation DESC
            LIMIT %s
        """, params)
        rows = cur.fetchall()
    return [dict(r) for r in rows]


@router.get("/history/{attestation_id}")
async def get_attestation(
    attestation_id: int,
    user: dict = Depends(get_current_user),
):
    """Récupère une attestation et regénère le HTML."""
    with get_cursor() as cur:
        cur.execute("SELECT * FROM attestations WHERE id = %s", (attestation_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Attestation non trouvée")
    att = dict(row)
    data = AttestationRequest(**{k: att[k] for k in AttestationRequest.model_fields if k in att})
    att["html"] = _generate_attestation_html(data)
    return att
