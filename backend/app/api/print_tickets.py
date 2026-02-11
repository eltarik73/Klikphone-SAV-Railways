"""
API Print Tickets — génération HTML pour impression.
Tickets client, staff, combiné, devis, reçu.
"""

from datetime import datetime
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

from app.database import get_cursor

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


_LOGO_SVG = """<svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="40" height="40" rx="8" fill="#000"/>
<text x="20" y="28" text-anchor="middle" fill="#FFF" font-family="Arial Black, sans-serif" font-size="22" font-weight="900">K</text>
</svg>"""

_BASE_STYLE = """
<style>
  @page { margin: 4mm; size: 80mm auto; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Courier New', monospace; font-size: 11px; line-height: 1.4; color: #000; width: 72mm; margin: 0 auto; padding: 2mm; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .divider { border-top: 1px dashed #000; margin: 6px 0; }
  .divider-double { border-top: 3px double #000; margin: 8px 0; }
  .row { display: flex; justify-content: space-between; gap: 4px; }
  .row span:last-child { text-align: right; flex-shrink: 0; }
  .section { margin: 6px 0; }
  .logo { display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 4px; }
  .logo svg { width: 32px; height: 32px; }
  h1 { font-size: 18px; font-weight: 900; letter-spacing: 2px; }
  h2 { font-size: 12px; font-weight: bold; margin: 4px 0; text-transform: uppercase; letter-spacing: 1px; }
  .small { font-size: 9px; color: #333; }
  .qr { text-align: center; margin: 8px 0; }
  .qr img { width: 100px; height: 100px; }
  .highlight { background: #000; color: #fff; padding: 2px 6px; display: inline-block; font-weight: bold; }
  .price-row { font-size: 14px; font-weight: bold; text-align: center; padding: 4px 0; border: 1px solid #000; margin: 4px 0; }
  @media print { body { width: 72mm; } @page { margin: 4mm; } }
</style>
"""

_A4_LOGO_SVG = """<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="48" height="48" rx="10" fill="#7C3AED"/>
<text x="24" y="34" text-anchor="middle" fill="#FFF" font-family="Arial Black, sans-serif" font-size="28" font-weight="900">K</text>
</svg>"""

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
  td { padding: 6px 8px; vertical-align: top; }
  .header { background: linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%); color: white; padding: 24px; border-radius: 12px; margin-bottom: 24px; }
  .header h1 { color: white; font-size: 24px; }
  .header .logo-row { display: flex; align-items: center; gap: 12px; }
  .header .logo-row svg { width: 44px; height: 44px; }
  .header .logo-row svg rect { fill: rgba(255,255,255,0.2); }
  .header .logo-row svg text { fill: #FFF; }
  .card { border: 1px solid #E2E8F0; border-radius: 10px; padding: 16px; margin: 12px 0; }
  .price-box { background: linear-gradient(135deg, #F5F3FF 0%, #EDE9FE 100%); border: 2px solid #7C3AED; border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0; }
  .price-box .amount { font-size: 32px; font-weight: bold; color: #7C3AED; }
  .small { font-size: 10px; color: #94A3B8; }
  .qr { text-align: center; margin: 16px 0; }
  .qr img { width: 120px; height: 120px; }
  .footer { margin-top: 30px; padding-top: 16px; border-top: 1px solid #E2E8F0; text-align: center; }
  @media print { body { max-width: none; padding: 0; } }
</style>
"""


def _ticket_client_html(t: dict) -> str:
    appareil = t.get("modele_autre") or f"{t.get('marque', '')} {t.get('modele', '')}".strip()
    code = t.get("ticket_code", "")
    qr = f"https://api.qrserver.com/v1/create-qr-code/?size=150x150&data={code}"

    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ticket Client - {code}</title>{_BASE_STYLE}</head><body>
<div class="center">
  <div class="logo">{_LOGO_SVG}<h1>KLIKPHONE</h1></div>
  <div class="small">Spécialiste Apple & Multimarque</div>
  <div class="small">79 Place Saint Léger, 73000 Chambéry</div>
  <div class="small">04 79 60 89 22</div>
</div>
<div class="divider-double"></div>
<div class="center"><h2>Ticket Client</h2></div>
<div class="divider"></div>
<div class="section">
  <div class="row"><span>Ticket :</span><span class="highlight">{code}</span></div>
  <div class="row"><span>Date :</span><span>{_format_date(t.get('date_depot'))}</span></div>
  <div class="row"><span>Client :</span><span class="bold">{t.get('client_prenom', '')} {t.get('client_nom', '')}</span></div>
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
{f'<div class="price-row">Devis estimé : {_format_prix(t.get("devis_estime"))}</div><div class="divider"></div>' if t.get('devis_estime') else ''}
{f'<div class="section"><div class="small">{t.get("commentaire_client", "")}</div></div>' if t.get('commentaire_client') else ''}
<div class="qr"><img src="{qr}" alt="QR"></div>
<div class="center small">
  Suivez votre réparation sur :<br>
  <strong>klikphone.fr/suivi</strong> → {code}<br><br>
  ★ Merci de votre confiance ! ★
</div>
<div class="divider-double"></div>
</body></html>"""


def _ticket_staff_html(t: dict) -> str:
    appareil = t.get("modele_autre") or f"{t.get('marque', '')} {t.get('modele', '')}".strip()
    code = t.get("ticket_code", "")
    tech = t.get("technicien_assigne", "")

    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>Fiche Atelier - {code}</title>{_BASE_STYLE}</head><body>
<div class="center">
  <div class="logo">{_LOGO_SVG}<h1>KLIKPHONE</h1></div>
</div>
<div class="divider-double"></div>
<div class="center"><h2>Fiche Atelier</h2></div>
<div class="divider"></div>
<div class="section">
  <div class="row"><span>Ticket :</span><span class="highlight">{code}</span></div>
  <div class="row"><span>Date dépôt :</span><span>{_format_date(t.get('date_depot'))}</span></div>
  <div class="row"><span>Statut :</span><span class="bold">{t.get('statut', '')}</span></div>
  {f'<div class="row"><span>Tech :</span><span class="bold">{tech}</span></div>' if tech else ''}
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
  <div class="row"><span>Panne :</span><span class="bold">{t.get('panne', '')}</span></div>
  {f'<div class="row"><span>Détail :</span><span>{t.get("panne_detail", "")}</span></div>' if t.get('panne_detail') else ''}
  {f'<div class="row"><span>IMEI :</span><span>{t.get("imei", "")}</span></div>' if t.get('imei') else ''}
</div>
<div class="divider"></div>
<div class="section">
  {f'<div class="row"><span>🔒 PIN :</span><span class="bold" style="font-size:14px;letter-spacing:3px">{t.get("pin", "")}</span></div>' if t.get('pin') else ''}
  {f'<div class="row"><span>🔐 Schéma :</span><span class="bold">{t.get("pattern", "")}</span></div>' if t.get('pattern') else ''}
</div>
{f'<div class="divider"></div><div class="section"><div class="row"><span>Devis :</span><span class="bold">{_format_prix(t.get("devis_estime"))}</span></div><div class="row"><span>Acompte :</span><span>{_format_prix(t.get("acompte"))}</span></div>{f"""<div class="row"><span>Type écran :</span><span>{t.get("type_ecran", "")}</span></div>""" if t.get("type_ecran") else ""}</div>' if t.get('devis_estime') else ''}
{f'<div class="divider"></div><div class="section"><div class="small"><strong>Réparation supp :</strong> {t.get("reparation_supp", "")} — {_format_prix(t.get("prix_supp"))}</div></div>' if t.get('reparation_supp') else ''}
{f'<div class="divider"></div><div class="section"><div class="small">📝 Note client : {t.get("notes_client", "")}</div></div>' if t.get('notes_client') else ''}
{f'<div class="section"><div class="small">🔒 Note interne : {t.get("notes_internes", "")}</div></div>' if t.get('notes_internes') else ''}
<div class="divider-double"></div>
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
    <div class="logo-row">{_A4_LOGO_SVG}<div><h1>KLIKPHONE</h1><div style="color:#DDD5F5;font-size:12px">Spécialiste Apple & Multimarque</div></div></div>
    <div style="text-align:right"><div style="font-size:22px;font-weight:bold;letter-spacing:2px">DEVIS</div><div style="color:#DDD5F5;font-size:14px;margin-top:4px">{code}</div></div>
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
{f'<div class="card"><div class="row"><span>Acompte versé :</span><span class="bold">{acompte:.2f} €</span></div><div class="row"><span>Reste à payer :</span><span class="bold" style="color:#7C3AED;font-size:16px">{reste:.2f} €</span></div></div>' if acompte > 0 else ''}
<div class="footer">
  <div class="small">
    KLIKPHONE — 79 Place Saint Léger, 73000 Chambéry — 04 79 60 89 22<br>
    Devis valable 30 jours — TVA non applicable (article 293B du CGI)
  </div>
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
    <div class="logo-row">{_A4_LOGO_SVG}<div><h1>KLIKPHONE</h1><div style="color:#DDD5F5;font-size:12px">Spécialiste Apple & Multimarque</div></div></div>
    <div style="text-align:right"><div style="font-size:22px;font-weight:bold;letter-spacing:2px">REÇU</div><div style="color:#DDD5F5;font-size:14px;margin-top:4px">{code}</div></div>
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
<div class="footer">
  <div class="small">
    KLIKPHONE — 79 Place Saint Léger, 73000 Chambéry — 04 79 60 89 22<br>
    Merci de votre confiance ! — TVA non applicable (article 293B du CGI)
  </div>
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
async def print_staff(ticket_id: int):
    t = _get_ticket_full(ticket_id)
    if not t:
        raise HTTPException(404, "Ticket non trouvé")
    return _ticket_staff_html(t)


@router.get("/{ticket_id}/print/combined", response_class=HTMLResponse)
async def print_combined(ticket_id: int):
    t = _get_ticket_full(ticket_id)
    if not t:
        raise HTTPException(404, "Ticket non trouvé")
    client_html = _ticket_client_html(t)
    staff_html = _ticket_staff_html(t)
    # Merge: client page then page-break then staff page
    combined_body = client_html.replace("</body></html>", "")
    combined_body += '<div style="page-break-before: always;"></div>'
    if "<body>" in staff_html:
        combined_body += staff_html.split("<body>", 1)[1]
    else:
        combined_body += staff_html
    return HTMLResponse(combined_body)


@router.get("/{ticket_id}/print/devis", response_class=HTMLResponse)
async def print_devis(ticket_id: int):
    t = _get_ticket_full(ticket_id)
    if not t:
        raise HTTPException(404, "Ticket non trouvé")
    return _devis_html(t)


@router.get("/{ticket_id}/print/recu", response_class=HTMLResponse)
async def print_recu(ticket_id: int):
    t = _get_ticket_full(ticket_id)
    if not t:
        raise HTTPException(404, "Ticket non trouvé")
    return _recu_html(t)
