"""
API Attestation de non-réparabilité.
"""

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.api.auth import get_current_user
from app.services.notifications import envoyer_email

router = APIRouter(prefix="/api/attestation", tags=["attestation"])


class AttestationRequest(BaseModel):
    nom: str
    prenom: Optional[str] = ""
    adresse: Optional[str] = ""
    marque: str
    modele: str
    imei: Optional[str] = ""
    etat: Optional[str] = ""
    motif: str
    compte_rendu: Optional[str] = ""


def _generate_attestation_html(data: AttestationRequest) -> str:
    now = datetime.now()
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>Attestation de non-réparabilité</title>
<style>
  @page {{ margin: 25mm; size: A4; }}
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{ font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; line-height: 1.6; color: #333; max-width: 700px; margin: 0 auto; padding: 30px; }}
  .header {{ text-align: center; margin-bottom: 30px; border-bottom: 3px solid #7C3AED; padding-bottom: 20px; }}
  h1 {{ font-size: 22px; color: #7C3AED; }}
  h2 {{ font-size: 15px; color: #1E293B; margin: 20px 0 10px; border-bottom: 1px solid #E2E8F0; padding-bottom: 6px; }}
  .field {{ margin: 6px 0; }}
  .label {{ color: #64748B; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }}
  .value {{ font-weight: 600; }}
  .card {{ border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin: 12px 0; }}
  .signature {{ margin-top: 40px; display: flex; justify-content: space-between; }}
  .signature div {{ width: 45%; text-align: center; border-top: 1px solid #333; padding-top: 8px; }}
  .footer {{ margin-top: 30px; text-align: center; font-size: 10px; color: #94A3B8; }}
</style></head><body>
<div class="header">
  <h1>KLIKPHONE</h1>
  <div style="color:#64748B">Spécialiste Apple & Multimarque</div>
  <div style="color:#64748B;font-size:11px">79 Place Saint Léger, 73000 Chambéry — 04 79 60 89 22</div>
</div>

<h1 style="text-align:center;font-size:18px;color:#1E293B;margin:20px 0">ATTESTATION DE NON-RÉPARABILITÉ</h1>

<p style="margin:16px 0">Je soussigné(e), représentant de la société KLIKPHONE, atteste que l'appareil décrit ci-dessous
a été examiné dans nos ateliers et que celui-ci <strong>ne peut pas être réparé</strong> pour le motif indiqué.</p>

<h2>Propriétaire</h2>
<div class="card">
  <div class="field"><span class="label">Nom Prénom :</span> <span class="value">{data.prenom} {data.nom}</span></div>
  <div class="field"><span class="label">Adresse :</span> <span class="value">{data.adresse or '—'}</span></div>
</div>

<h2>Appareil</h2>
<div class="card">
  <div class="field"><span class="label">Marque :</span> <span class="value">{data.marque}</span></div>
  <div class="field"><span class="label">Modèle :</span> <span class="value">{data.modele}</span></div>
  <div class="field"><span class="label">IMEI / N° série :</span> <span class="value">{data.imei or '—'}</span></div>
  <div class="field"><span class="label">État :</span> <span class="value">{data.etat or '—'}</span></div>
</div>

<h2>Diagnostic</h2>
<div class="card">
  <div class="field"><span class="label">Motif de non-réparabilité :</span></div>
  <div class="value" style="margin-top:4px">{data.motif}</div>
  {f'<div class="field" style="margin-top:12px"><span class="label">Compte-rendu :</span></div><div>{data.compte_rendu}</div>' if data.compte_rendu else ''}
</div>

<p style="margin:20px 0">Cette attestation est délivrée pour servir et valoir ce que de droit.</p>
<p>Fait à Chambéry, le {now.strftime("%d/%m/%Y")}</p>

<div class="signature">
  <div>Le réparateur<br><br><br>KLIKPHONE</div>
  <div>Le client<br><br><br>{data.prenom} {data.nom}</div>
</div>

<div class="footer">
  KLIKPHONE — 79 Place Saint Léger, 73000 Chambéry — 04 79 60 89 22
</div>
</body></html>"""


@router.post("/generate")
async def generate_attestation(
    data: AttestationRequest,
    user: dict = Depends(get_current_user),
):
    """Génère l'attestation HTML."""
    return {"html": _generate_attestation_html(data)}


@router.post("/email")
async def email_attestation(
    data: AttestationRequest,
    destinataire: str,
    user: dict = Depends(get_current_user),
):
    """Envoie l'attestation par email."""
    html = _generate_attestation_html(data)
    sujet = f"Attestation de non-réparabilité — {data.marque} {data.modele}"
    message = f"Bonjour {data.prenom} {data.nom},\n\nVeuillez trouver ci-joint l'attestation de non-réparabilité de votre appareil.\n\nCordialement,\nKlikphone"

    success, msg = envoyer_email(destinataire, sujet, message, html)
    return {"success": success, "message": msg}
