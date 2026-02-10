"""
API Print Tickets — génération HTML pour impression.
Tickets client, staff, combiné, devis, reçu.
"""

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse

from app.database import get_cursor
from app.api.auth import get_current_user, get_optional_user

router = APIRouter(prefix="/api/tickets", tags=["print"])


def _get_ticket_full(ticket_id: int) -> dict:
    """Récupère un ticket avec toutes les infos client."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT t.*, c.nom as client_nom, c.prenom as client_prenom,
                   c.telephone as client_tel, c.email as client_email,
                   c.societe as client_societe
            FROM tickets t JOIN clients c ON t.client_id = c.id
            WHERE t.id = %s
        """, (ticket_id,))
        return cur.fetchone()


def _format_date(d):
    if not d:
        return "—"
    if isinstance(d, datetime):
        return d.strftime("%d/%m/%Y %H:%M")
    return str(d)


def _format_prix(p):
    if p is None:
        return "—"
    return f"{float(p):.2f} €"


_BASE_STYLE = """
<style>
  @page { margin: 8mm; size: 80mm auto; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Courier New', monospace; font-size: 11px; line-height: 1.4; color: #000; width: 72mm; margin: 0 auto; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .divider { border-top: 1px dashed #000; margin: 6px 0; }
  .row { display: flex; justify-content: space-between; }
  .section { margin: 6px 0; }
  h1 { font-size: 16px; font-weight: bold; }
  h2 { font-size: 12px; font-weight: bold; margin: 4px 0; }
  .small { font-size: 9px; }
  .qr { text-align: center; margin: 8px 0; }
  .qr img { width: 100px; height: 100px; }
  @media print { body { width: 72mm; } }
</style>
"""

_A4_STYLE = """
<style>
  @page { margin: 20mm; size: A4; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; line-height: 1.5; color: #333; max-width: 700px; margin: 0 auto; padding: 20px; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .divider { border-top: 2px solid #7C3AED; margin: 16px 0; }
  .divider-light { border-top: 1px solid #E2E8F0; margin: 12px 0; }
  .row { display: flex; justify-content: space-between; }
  .section { margin: 16px 0; }
  h1 { font-size: 22px; font-weight: bold; color: #7C3AED; }
  h2 { font-size: 15px; font-weight: bold; color: #1E293B; margin: 8px 0; }
  .label { color: #64748B; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
  .value { font-weight: 600; color: #1E293B; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 4px 8px; vertical-align: top; }
  .header { background: #7C3AED; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
  .header h1 { color: white; }
  .card { border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin: 12px 0; }
  .price-box { background: #F5F3FF; border: 2px solid #7C3AED; border-radius: 8px; padding: 16px; text-align: center; }
  .price-box .amount { font-size: 28px; font-weight: bold; color: #7C3AED; }
  .small { font-size: 10px; color: #94A3B8; }
  .qr { text-align: center; margin: 16px 0; }
  .qr img { width: 120px; height: 120px; }
  @media print { body { max-width: none; padding: 0; } }
</style>
"""


def _ticket_client_html(t: dict) -> str:
    appareil = t.get("modele_autre") or f"{t.get('marque', '')} {t.get('modele', '')}".strip()
    code = t.get("ticket_code", "")
    qr = f"https://api.qrserver.com/v1/create-qr-code/?size=150x150&data={code}"

    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ticket Client - {code}</title>{_BASE_STYLE}</head><body>
<div class="center">
  <h1>KLIKPHONE</h1>
  <div class="small">Spécialiste Apple & Multimarque</div>
  <div class="small">79 Place Saint Léger, Chambéry</div>
  <div class="small">04 79 60 89 22</div>
</div>
<div class="divider"></div>
<div class="center"><h2>TICKET CLIENT</h2></div>
<div class="divider"></div>
<div class="section">
  <div class="row"><span>Ticket :</span><span class="bold">{code}</span></div>
  <div class="row"><span>Date :</span><span>{_format_date(t.get('date_depot'))}</span></div>
  <div class="row"><span>Client :</span><span>{t.get('client_prenom', '')} {t.get('client_nom', '')}</span></div>
  <div class="row"><span>Tél :</span><span>{t.get('client_tel', '')}</span></div>
</div>
<div class="divider"></div>
<div class="section">
  <div class="row"><span>Appareil :</span><span class="bold">{appareil}</span></div>
  <div class="row"><span>Catégorie :</span><span>{t.get('categorie', '')}</span></div>
  <div class="row"><span>Panne :</span><span>{t.get('panne', '')}</span></div>
  {f'<div class="row"><span>Détail :</span><span>{t.get("panne_detail", "")}</span></div>' if t.get('panne_detail') else ''}
  {f'<div class="row"><span>IMEI :</span><span>{t.get("imei", "")}</span></div>' if t.get('imei') else ''}
</div>
<div class="divider"></div>
{f'<div class="section"><div class="row"><span>Devis :</span><span class="bold">{_format_prix(t.get("devis_estime"))}</span></div></div><div class="divider"></div>' if t.get('devis_estime') else ''}
{f'<div class="section"><div class="small">{t.get("commentaire_client", "")}</div></div>' if t.get('commentaire_client') else ''}
<div class="qr"><img src="{qr}" alt="QR"></div>
<div class="center small">
  Suivez votre réparation sur :<br>
  klikphone.fr/suivi → {code}<br><br>
  Merci de votre confiance !
</div>
</body></html>"""


def _ticket_staff_html(t: dict) -> str:
    appareil = t.get("modele_autre") or f"{t.get('marque', '')} {t.get('modele', '')}".strip()
    code = t.get("ticket_code", "")

    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ticket Staff - {code}</title>{_BASE_STYLE}</head><body>
<div class="center">
  <h1>KLIKPHONE</h1>
  <div class="small">FICHE ATELIER</div>
</div>
<div class="divider"></div>
<div class="section">
  <div class="row"><span>Ticket :</span><span class="bold">{code}</span></div>
  <div class="row"><span>Date dépôt :</span><span>{_format_date(t.get('date_depot'))}</span></div>
  <div class="row"><span>Statut :</span><span class="bold">{t.get('statut', '')}</span></div>
</div>
<div class="divider"></div>
<div class="section">
  <div class="row"><span>Client :</span><span class="bold">{t.get('client_prenom', '')} {t.get('client_nom', '')}</span></div>
  <div class="row"><span>Tél :</span><span>{t.get('client_tel', '')}</span></div>
  {f'<div class="row"><span>Email :</span><span>{t.get("client_email", "")}</span></div>' if t.get('client_email') else ''}
  {f'<div class="row"><span>Société :</span><span>{t.get("client_societe", "")}</span></div>' if t.get('client_societe') else ''}
</div>
<div class="divider"></div>
<div class="section">
  <div class="row"><span>Appareil :</span><span class="bold">{appareil}</span></div>
  <div class="row"><span>Catégorie :</span><span>{t.get('categorie', '')}</span></div>
  <div class="row"><span>Panne :</span><span>{t.get('panne', '')}</span></div>
  {f'<div class="row"><span>Détail :</span><span>{t.get("panne_detail", "")}</span></div>' if t.get('panne_detail') else ''}
  {f'<div class="row"><span>IMEI :</span><span>{t.get("imei", "")}</span></div>' if t.get('imei') else ''}
</div>
<div class="divider"></div>
<div class="section">
  {f'<div class="row"><span>PIN :</span><span class="bold">{t.get("pin", "")}</span></div>' if t.get('pin') else ''}
  {f'<div class="row"><span>Schéma :</span><span class="bold">{t.get("pattern", "")}</span></div>' if t.get('pattern') else ''}
</div>
{f'<div class="divider"></div><div class="section"><div class="row"><span>Devis :</span><span class="bold">{_format_prix(t.get("devis_estime"))}</span></div><div class="row"><span>Acompte :</span><span>{_format_prix(t.get("acompte"))}</span></div></div>' if t.get('devis_estime') else ''}
{f'<div class="divider"></div><div class="section"><div class="small">Note client : {t.get("notes_client", "")}</div></div>' if t.get('notes_client') else ''}
{f'<div class="section"><div class="small">Note interne : {t.get("notes_internes", "")}</div></div>' if t.get('notes_internes') else ''}
<div class="divider"></div>
<div class="center small">Imprimé le {datetime.now().strftime("%d/%m/%Y %H:%M")}</div>
</body></html>"""


def _devis_html(t: dict) -> str:
    appareil = t.get("modele_autre") or f"{t.get('marque', '')} {t.get('modele', '')}".strip()
    code = t.get("ticket_code", "")
    devis = float(t.get("devis_estime") or 0)
    acompte = float(t.get("acompte") or 0)
    prix_supp = float(t.get("prix_supp") or 0)
    total = devis + prix_supp
    reste = total - acompte

    lignes = f"""<tr><td>{t.get('panne', 'Réparation')}</td><td>{appareil}</td><td style="text-align:right">{devis:.2f} €</td></tr>"""
    if t.get("reparation_supp") and prix_supp > 0:
        lignes += f"""<tr><td>{t.get('reparation_supp', '')}</td><td>Supplément</td><td style="text-align:right">{prix_supp:.2f} €</td></tr>"""

    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>Devis - {code}</title>{_A4_STYLE}</head><body>
<div class="header">
  <div class="row">
    <div><h1>KLIKPHONE</h1><div style="color:#DDD5F5">Spécialiste Apple & Multimarque</div></div>
    <div style="text-align:right"><div style="font-size:20px;font-weight:bold">DEVIS</div><div style="color:#DDD5F5">{code}</div></div>
  </div>
</div>
<table>
  <tr><td><span class="label">Client</span><br><span class="value">{t.get('client_prenom', '')} {t.get('client_nom', '')}</span></td>
      <td><span class="label">Téléphone</span><br><span class="value">{t.get('client_tel', '')}</span></td>
      <td><span class="label">Date</span><br><span class="value">{_format_date(t.get('date_depot'))}</span></td></tr>
</table>
<div class="divider-light"></div>
<h2>Appareil</h2>
<div class="card">
  <table><tr><td><span class="label">Appareil</span><br>{appareil}</td><td><span class="label">Catégorie</span><br>{t.get('categorie', '')}</td><td><span class="label">Panne</span><br>{t.get('panne', '')}</td></tr></table>
</div>
<h2>Détail du devis</h2>
<div class="card">
  <table>
    <tr style="border-bottom:1px solid #E2E8F0"><td class="label">Description</td><td class="label">Appareil</td><td class="label" style="text-align:right">Montant TTC</td></tr>
    {lignes}
    <tr style="border-top:2px solid #7C3AED"><td colspan="2" class="bold" style="text-align:right;padding-top:8px">Total TTC</td><td class="bold" style="text-align:right;padding-top:8px;font-size:16px;color:#7C3AED">{total:.2f} €</td></tr>
  </table>
</div>
{f'<div class="row"><span>Acompte versé :</span><span class="bold">{acompte:.2f} €</span></div><div class="row"><span>Reste à payer :</span><span class="bold" style="color:#7C3AED">{reste:.2f} €</span></div>' if acompte > 0 else ''}
<div class="divider"></div>
<div class="small center">
  KLIKPHONE — 79 Place Saint Léger, 73000 Chambéry — 04 79 60 89 22<br>
  Devis valable 30 jours — TVA non applicable (article 293B du CGI)
</div>
</body></html>"""


def _recu_html(t: dict) -> str:
    appareil = t.get("modele_autre") or f"{t.get('marque', '')} {t.get('modele', '')}".strip()
    code = t.get("ticket_code", "")
    tarif = float(t.get("tarif_final") or t.get("devis_estime") or 0)
    acompte = float(t.get("acompte") or 0)
    prix_supp = float(t.get("prix_supp") or 0)
    total = tarif + prix_supp
    reste = total - acompte

    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reçu - {code}</title>{_A4_STYLE}</head><body>
<div class="header">
  <div class="row">
    <div><h1>KLIKPHONE</h1><div style="color:#DDD5F5">Spécialiste Apple & Multimarque</div></div>
    <div style="text-align:right"><div style="font-size:20px;font-weight:bold">REÇU</div><div style="color:#DDD5F5">{code}</div></div>
  </div>
</div>
<table>
  <tr><td><span class="label">Client</span><br><span class="value">{t.get('client_prenom', '')} {t.get('client_nom', '')}</span></td>
      <td><span class="label">Téléphone</span><br><span class="value">{t.get('client_tel', '')}</span></td>
      <td><span class="label">Date</span><br><span class="value">{datetime.now().strftime("%d/%m/%Y")}</span></td></tr>
</table>
<div class="divider-light"></div>
<div class="card">
  <table>
    <tr><td><span class="label">Appareil</span><br>{appareil}</td><td><span class="label">Réparation</span><br>{t.get('panne', '')}</td></tr>
    {f'<tr><td><span class="label">Supplément</span><br>{t.get("reparation_supp", "")}</td><td><span class="label">Montant</span><br>{prix_supp:.2f} €</td></tr>' if t.get("reparation_supp") and prix_supp > 0 else ''}
    {f'<tr><td><span class="label">Type écran</span><br>{t.get("type_ecran", "")}</td><td></td></tr>' if t.get("type_ecran") else ''}
  </table>
</div>
<div class="price-box">
  <div class="label">Montant total TTC</div>
  <div class="amount">{total:.2f} €</div>
  {f'<div style="margin-top:8px"><span class="label">Acompte :</span> {acompte:.2f} € — <span class="label">Reste :</span> <strong>{reste:.2f} €</strong></div>' if acompte > 0 else ''}
</div>
<div class="divider"></div>
<div class="small center">
  KLIKPHONE — 79 Place Saint Léger, 73000 Chambéry — 04 79 60 89 22<br>
  Merci de votre confiance ! — TVA non applicable (article 293B du CGI)
</div>
</body></html>"""


# ─── ROUTES ──────────────────────────────────────────────────────

@router.get("/{ticket_id}/print/client", response_class=HTMLResponse)
async def print_client(ticket_id: int):
    t = _get_ticket_full(ticket_id)
    if not t:
        raise HTTPException(404, "Ticket non trouvé")
    return _ticket_client_html(t)


@router.get("/{ticket_id}/print/staff", response_class=HTMLResponse)
async def print_staff(ticket_id: int, user: dict = Depends(get_current_user)):
    t = _get_ticket_full(ticket_id)
    if not t:
        raise HTTPException(404, "Ticket non trouvé")
    return _ticket_staff_html(t)


@router.get("/{ticket_id}/print/combined", response_class=HTMLResponse)
async def print_combined(ticket_id: int, user: dict = Depends(get_current_user)):
    t = _get_ticket_full(ticket_id)
    if not t:
        raise HTTPException(404, "Ticket non trouvé")
    client_html = _ticket_client_html(t)
    staff_html = _ticket_staff_html(t)
    combined = client_html.replace("</body></html>", "") + \
        '<div style="page-break-before: always;"></div>' + \
        staff_html.split("<body>")[1] if "<body>" in staff_html else staff_html
    return combined


@router.get("/{ticket_id}/print/devis", response_class=HTMLResponse)
async def print_devis(ticket_id: int, user: dict = Depends(get_current_user)):
    t = _get_ticket_full(ticket_id)
    if not t:
        raise HTTPException(404, "Ticket non trouvé")
    return _devis_html(t)


@router.get("/{ticket_id}/print/recu", response_class=HTMLResponse)
async def print_recu(ticket_id: int, user: dict = Depends(get_current_user)):
    t = _get_ticket_full(ticket_id)
    if not t:
        raise HTTPException(404, "Ticket non trouvé")
    return _recu_html(t)
