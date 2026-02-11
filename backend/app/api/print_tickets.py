"""
API Print Tickets — génération HTML pour impression thermique 80mm et A4.
Tickets client, staff, combiné, devis, reçu.
Tout en monochrome pour imprimante thermique.
"""

import urllib.parse
from datetime import datetime
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

from app.database import get_cursor

router = APIRouter(prefix="/api/tickets", tags=["print"])

# URL frontend pour les QR codes de suivi
_FRONTEND_URL = "https://klikphone-sav-railways-production.up.railway.app"


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


def _get_config(key: str, default: str = "") -> str:
    try:
        with get_cursor() as cur:
            cur.execute("SELECT valeur FROM params WHERE cle = %s", (key,))
            row = cur.fetchone()
        return row["valeur"] if row else default
    except Exception:
        return default


def _fd(d):
    """Format date."""
    if not d:
        return "—"
    if isinstance(d, datetime):
        return d.strftime("%d/%m/%Y %H:%M")
    return str(d)


def _fp(p):
    """Format prix."""
    if p is None:
        return "0,00"
    return f"{float(p):,.2f}".replace(",", " ").replace(".", ",")


def _suivi_url(code: str) -> str:
    """URL de suivi pour le QR code."""
    return f"{_FRONTEND_URL}/suivi?ticket={urllib.parse.quote(code)}"


def _qr_url(code: str) -> str:
    """URL QR code API pointant vers le suivi."""
    target = _suivi_url(code)
    return f"https://api.qrserver.com/v1/create-qr-code/?size=200x200&data={urllib.parse.quote(target)}"


def _pattern_grid(pattern_str: str) -> str:
    """Dessine le schéma de déverrouillage en ASCII art."""
    if not pattern_str:
        return ""

    points = [int(p) for p in pattern_str.split("-") if p.isdigit()]
    if not points:
        return ""

    # Grille 3x3 : 1=haut-gauche, 9=bas-droite
    grid_pos = {1: (0, 0), 2: (0, 1), 3: (0, 2),
                4: (1, 0), 5: (1, 1), 6: (1, 2),
                7: (2, 0), 8: (2, 1), 9: (2, 2)}

    active = set(points)
    order = {p: i + 1 for i, p in enumerate(points)}

    lines = []
    lines.append('<div style="font-family:monospace;font-size:11px;line-height:1.6">')
    lines.append('<table style="border-collapse:collapse;margin:4px auto">')
    for row in range(3):
        lines.append("<tr>")
        for col in range(3):
            num = row * 3 + col + 1
            if num in active:
                idx = order[num]
                lines.append(
                    f'<td style="width:24px;height:24px;text-align:center;'
                    f'border:2px solid #000;font-weight:bold;font-size:13px">'
                    f'{idx}</td>'
                )
            else:
                lines.append(
                    '<td style="width:24px;height:24px;text-align:center;'
                    'border:1px solid #999;color:#999">·</td>'
                )
        lines.append("</tr>")
    lines.append("</table>")

    sequence = " → ".join(str(p) for p in points)
    lines.append(f'<div style="text-align:center;font-size:10px;margin-top:2px">Séquence: {sequence}</div>')
    lines.append("</div>")

    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════
# STYLE THERMIQUE 80mm — MONOCHROME
# ═══════════════════════════════════════════════════════════════

_THERMAL = """<!DOCTYPE html><html><head><meta charset="utf-8"><title>{title}</title>
<style>
@page {{ size: 80mm auto; margin: 2mm; }}
* {{ margin:0; padding:0; box-sizing:border-box; }}
body {{
  width: 80mm;
  max-width: 302px;
  margin: 0 auto;
  padding: 3mm;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.4;
  color: #000;
  background: #fff;
}}
.center {{ text-align:center; }}
.bold {{ font-weight:bold; }}
.right {{ text-align:right; }}
h1 {{
  font-family: Arial, sans-serif;
  font-size: 20px;
  font-weight: 900;
  letter-spacing: 3px;
  margin: 0;
}}
h2 {{
  font-family: Arial, sans-serif;
  font-size: 13px;
  font-weight: bold;
  letter-spacing: 2px;
  text-transform: uppercase;
  margin: 2px 0;
}}
.sep {{ border:none; border-top:1px dashed #000; margin:6px 0; }}
.sep-bold {{ border:none; border-top:2px solid #000; margin:8px 0; }}
.row {{ display:flex; justify-content:space-between; padding:1px 0; }}
.row .val {{ text-align:right; flex-shrink:0; font-weight:bold; }}
.section {{ margin:4px 0; }}
.small {{ font-size:9px; line-height:1.3; }}
.tiny {{ font-size:8px; line-height:1.2; color:#333; }}
.logo-img {{ width:150px; height:auto; display:block; margin:0 auto 4px; }}
.qr {{ text-align:center; margin:8px 0; }}
.qr img {{ width:180px; height:180px; }}
.highlight {{
  font-size:16px;
  font-weight:900;
  letter-spacing:2px;
}}
.total-box {{
  border:2px solid #000;
  padding:4px 8px;
  margin:4px 0;
  font-weight:bold;
  font-size:14px;
}}
@media print {{
  body {{ width:80mm; max-width:302px; }}
  @page {{ size:80mm auto; margin:2mm; }}
}}
</style>
</head><body>
"""


# ═══════════════════════════════════════════════════════════════
# TICKET CLIENT
# ═══════════════════════════════════════════════════════════════

def _ticket_client_html(t: dict) -> str:
    appareil = t.get("modele_autre") or f"{t.get('marque', '')} {t.get('modele', '')}".strip()
    code = t.get("ticket_code", "")
    qr = _qr_url(code)

    devis = float(t.get("devis_estime") or 0)
    prix_supp = float(t.get("prix_supp") or 0)
    acompte = float(t.get("acompte") or 0)
    total = devis + prix_supp
    reste = total - acompte

    # Tarification section
    tarif_html = ""
    if devis > 0 or prix_supp > 0:
        tarif_html = '<hr class="sep">'
        tarif_html += '<div class="section"><div class="bold">TARIFICATION</div>'
        if devis > 0:
            tarif_html += f'<div class="row"><span>{t.get("panne", "Réparation")}</span><span class="val">{_fp(devis)}€</span></div>'
        if t.get("reparation_supp") and prix_supp > 0:
            tarif_html += f'<div class="row"><span>{t.get("reparation_supp", "")}</span><span class="val">{_fp(prix_supp)}€</span></div>'
            tarif_html += '<div class="small">(répar. supplémentaire)</div>'
        tarif_html += '<hr class="sep">'
        tarif_html += f'<div class="total-box"><div class="row"><span>TOTAL</span><span>{_fp(total)}€</span></div></div>'
        if acompte > 0:
            tarif_html += f'<div class="row"><span>Acompte versé</span><span class="val">- {_fp(acompte)}€</span></div>'
        tarif_html += f'<div class="total-box center">★ RESTE À PAYER  {_fp(reste)}€ ★</div>'
        tarif_html += '</div>'

    # Note publique
    note_html = ""
    if t.get("notes_client"):
        note_html = f'<hr class="sep"><div class="section"><div class="small"><b>Note:</b> {t["notes_client"]}</div></div>'

    return _THERMAL.format(title=f"Ticket Client - {code}") + f"""
<div class="center">
  <img src="/logo_k.png" class="logo-img" alt="K" onerror="this.style.display='none'">
  <h1>KLIKPHONE</h1>
  <div class="small">Spécialiste Apple & Multimarque</div>
  <div class="small">79 Place Saint Léger</div>
  <div class="small">73000 Chambéry</div>
  <div class="small">Tél: 04 79 60 89 22</div>
</div>
<hr class="sep-bold">
<div class="center"><h2>Ticket de dépôt</h2></div>
<hr class="sep">
<div class="section">
  <div class="row"><span>N°:</span><span class="highlight">{code}</span></div>
  <div class="row"><span>Date:</span><span>{_fd(t.get('date_depot'))}</span></div>
</div>
<hr class="sep">
<div class="section">
  <div class="row"><span>Client:</span><span class="val">{t.get('client_prenom', '')} {t.get('client_nom', '')}</span></div>
  <div class="row"><span>Tél:</span><span>{t.get('client_tel', '')}</span></div>
</div>
<hr class="sep">
<div class="section">
  <div class="row"><span>Appareil:</span><span class="val">{appareil}</span></div>
  <div class="row"><span>Catégorie:</span><span>{t.get('categorie', '')}</span></div>
  <div class="row"><span>Motif:</span><span>{t.get('panne', '')}</span></div>
  {f'<div class="row"><span>Détail:</span><span>{t.get("panne_detail","")}</span></div>' if t.get('panne_detail') else ''}
  {f'<div class="row"><span>IMEI:</span><span class="small">{t.get("imei","")}</span></div>' if t.get('imei') else ''}
</div>
{tarif_html}
{note_html}
<hr class="sep">
<div class="qr"><img src="{qr}" alt="QR"></div>
<div class="center small">
  Scannez pour suivre votre<br>réparation en ligne
</div>
<hr class="sep">
<div class="section tiny">
  <b>CONDITIONS GÉNÉRALES</b><br><br>
  Klikphone ne consulte ni n'accède aux données
  de votre appareil. Sauvegardez vos données
  avant le dépôt. Nous ne pouvons être tenus
  responsables d'une perte de données ou
  dysfonctionnement post-réparation. Garantie
  6 mois sur les réparations.
</div>
<hr class="sep-bold">
<div class="center small" style="margin-top:4px">
  Merci de votre confiance !<br>
  <b>KLIKPHONE</b>
</div>
</body></html>"""


# ═══════════════════════════════════════════════════════════════
# TICKET STAFF (FICHE TECHNICIEN)
# ═══════════════════════════════════════════════════════════════

def _ticket_staff_html(t: dict) -> str:
    appareil = t.get("modele_autre") or f"{t.get('marque', '')} {t.get('modele', '')}".strip()
    code = t.get("ticket_code", "")
    tech = t.get("technicien_assigne") or "—"
    date_recup = t.get("date_recuperation") or "—"

    # Sécurité
    sec_html = ""
    if t.get("pin") or t.get("pattern"):
        sec_html = '<hr class="sep"><div class="section"><div class="bold">SÉCURITÉ</div>'
        if t.get("pin"):
            sec_html += f'<div class="row"><span>PIN:</span><span style="font-size:16px;letter-spacing:4px;font-weight:bold">{t["pin"]}</span></div>'
        if t.get("pattern"):
            sec_html += '<div style="margin-top:4px"><b>SCHÉMA:</b></div>'
            sec_html += _pattern_grid(t["pattern"])
        sec_html += "</div>"

    # Réparation supp
    supp_html = ""
    if t.get("reparation_supp"):
        prix_s = _fp(t.get("prix_supp"))
        supp_html = f"""<hr class="sep">
<div class="section">
  <div class="bold">RÉPARATIONS SUPPLÉMENTAIRES</div>
  <div class="row"><span>• {t['reparation_supp']}</span><span class="val">{prix_s}€</span></div>
</div>"""

    # Notes
    notes_html = ""
    if t.get("notes_internes"):
        notes_html += f'<hr class="sep"><div class="section"><div class="bold">NOTES INTERNES:</div><div class="small">{t["notes_internes"]}</div></div>'
    if t.get("notes_client"):
        notes_html += f'<hr class="sep"><div class="section"><div class="bold">NOTE CLIENT:</div><div class="small">{t["notes_client"]}</div></div>'

    # Tarif
    tarif = t.get("tarif_final") or t.get("devis_estime")
    paye = "Oui" if t.get("paye") else "Non"

    return _THERMAL.format(title=f"Fiche Technicien - {code}") + f"""
<div class="center">
  <img src="/logo_k.png" class="logo-img" alt="K" onerror="this.style.display='none'">
  <h2>Fiche Technicien</h2>
</div>
<hr class="sep-bold">
<div class="section">
  <div class="row"><span>N°:</span><span class="highlight">{code}</span></div>
  <div class="row"><span>Date dépôt:</span><span>{_fd(t.get('date_depot'))}</span></div>
  <div class="row"><span>Date récup:</span><span>{date_recup}</span></div>
</div>
<hr class="sep">
<div class="section">
  <div class="row"><span>Client:</span><span class="val">{t.get('client_prenom', '')} {t.get('client_nom', '')}</span></div>
  <div class="row"><span>Tél:</span><span>{t.get('client_tel', '')}</span></div>
</div>
<hr class="sep">
<div class="section">
  <div class="row"><span>Appareil:</span><span class="val">{appareil}</span></div>
  <div class="row"><span>Motif:</span><span>{t.get('panne', '')}</span></div>
  {f'<div class="row"><span>Détail:</span><span>{t.get("panne_detail","")}</span></div>' if t.get('panne_detail') else ''}
  {f'<div class="row"><span>IMEI:</span><span class="small">{t.get("imei","")}</span></div>' if t.get('imei') else ''}
  {f'<div class="row"><span>Type écran:</span><span>{t.get("type_ecran","")}</span></div>' if t.get('type_ecran') else ''}
</div>
{supp_html}
{sec_html}
{notes_html}
<hr class="sep-bold">
<div class="section">
  <div class="row"><span>Tech assigné:</span><span class="val">{tech}</span></div>
  {f'<div class="row"><span>Tarif:</span><span class="val">{_fp(tarif)}€</span></div>' if tarif else ''}
  <div class="row"><span>Payé:</span><span class="val">{paye}</span></div>
</div>
</body></html>"""


# ═══════════════════════════════════════════════════════════════
# DEVIS — FORMAT THERMIQUE 80mm
# ═══════════════════════════════════════════════════════════════

def _devis_html(t: dict) -> str:
    appareil = t.get("modele_autre") or f"{t.get('marque', '')} {t.get('modele', '')}".strip()
    code = t.get("ticket_code", "")
    devis = float(t.get("devis_estime") or 0)
    prix_supp = float(t.get("prix_supp") or 0)
    acompte = float(t.get("acompte") or 0)
    total_ttc = devis + prix_supp
    tva = round(total_ttc * 0.2 / 1.2, 2)
    total_ht = round(total_ttc - tva, 2)
    reste = total_ttc - acompte

    lignes = ""
    if devis > 0:
        ht = round(devis / 1.2, 2)
        lignes += f'<div class="row"><span>{t.get("panne", "Réparation")}</span><span class="val">{_fp(ht)}€ HT</span></div>'
    if t.get("reparation_supp") and prix_supp > 0:
        ht_s = round(prix_supp / 1.2, 2)
        lignes += f'<div class="row"><span>{t.get("reparation_supp", "")}</span><span class="val">{_fp(ht_s)}€ HT</span></div>'

    siret = _get_config("SIRET", "")
    siret_line = f'<div class="small">SIRET: {siret}</div>' if siret else ''

    return _THERMAL.format(title=f"Devis - {code}") + f"""
<div class="center">
  <img src="/logo_k.png" class="logo-img" alt="K" onerror="this.style.display='none'">
  <h1>KLIKPHONE</h1>
  <div class="small">79 Place Saint Léger</div>
  <div class="small">73000 Chambéry</div>
</div>
<hr class="sep-bold">
<div class="center"><h2>D E V I S</h2></div>
<hr class="sep">
<div class="section">
  <div class="row"><span>N°:</span><span class="val">{code}</span></div>
  <div class="row"><span>Date:</span><span>{_fd(t.get('date_depot'))}</span></div>
</div>
<hr class="sep">
<div class="section">
  <div class="row"><span>Client:</span><span class="val">{t.get('client_prenom', '')} {t.get('client_nom', '')}</span></div>
  <div class="row"><span>Tél:</span><span>{t.get('client_tel', '')}</span></div>
</div>
<hr class="sep">
<div class="section bold">DÉTAIL DES RÉPARATIONS</div>
<div class="section">
  {lignes}
</div>
<hr class="sep">
<div class="section">
  <div class="row"><span>Total HT:</span><span class="val">{_fp(total_ht)}€</span></div>
  <div class="row"><span>TVA (20%):</span><span class="val">{_fp(tva)}€</span></div>
</div>
<hr class="sep-bold">
<div class="total-box"><div class="row"><span>TOTAL TTC:</span><span>{_fp(total_ttc)}€</span></div></div>
{f'<div class="row"><span>Acompte:</span><span class="val">- {_fp(acompte)}€</span></div>' if acompte > 0 else ''}
{f'<div class="total-box center">RESTE À PAYER: {_fp(reste)}€</div>' if acompte > 0 else ''}
<hr class="sep">
<div class="tiny">
  Devis valable 30 jours.
</div>
<hr class="sep">
<div class="center small">
  KLIKPHONE SARL<br>
  {siret_line}
</div>
</body></html>"""


# ═══════════════════════════════════════════════════════════════
# REÇU — FORMAT THERMIQUE 80mm
# ═══════════════════════════════════════════════════════════════

def _recu_html(t: dict) -> str:
    appareil = t.get("modele_autre") or f"{t.get('marque', '')} {t.get('modele', '')}".strip()
    code = t.get("ticket_code", "")
    tarif = float(t.get("tarif_final") or t.get("devis_estime") or 0)
    prix_supp = float(t.get("prix_supp") or 0)
    acompte = float(t.get("acompte") or 0)
    total_ttc = tarif + prix_supp
    tva = round(total_ttc * 0.2 / 1.2, 2)
    total_ht = round(total_ttc - tva, 2)
    reste = total_ttc - acompte

    lignes = ""
    if tarif > 0:
        ht = round(tarif / 1.2, 2)
        lignes += f'<div class="row"><span>{t.get("panne", "Réparation")}</span><span class="val">{_fp(ht)}€ HT</span></div>'
    if t.get("reparation_supp") and prix_supp > 0:
        ht_s = round(prix_supp / 1.2, 2)
        lignes += f'<div class="row"><span>{t.get("reparation_supp", "")}</span><span class="val">{_fp(ht_s)}€ HT</span></div>'

    siret = _get_config("SIRET", "")
    siret_line = f'<div class="small">SIRET: {siret}</div>' if siret else ''

    return _THERMAL.format(title=f"Reçu - {code}") + f"""
<div class="center">
  <img src="/logo_k.png" class="logo-img" alt="K" onerror="this.style.display='none'">
  <h1>KLIKPHONE</h1>
  <div class="small">79 Place Saint Léger</div>
  <div class="small">73000 Chambéry</div>
</div>
<hr class="sep-bold">
<div class="center"><h2>R E Ç U</h2></div>
<hr class="sep">
<div class="section">
  <div class="row"><span>N°:</span><span class="val">{code}</span></div>
  <div class="row"><span>Date:</span><span>{datetime.now().strftime("%d/%m/%Y")}</span></div>
</div>
<hr class="sep">
<div class="section">
  <div class="row"><span>Client:</span><span class="val">{t.get('client_prenom', '')} {t.get('client_nom', '')}</span></div>
  <div class="row"><span>Tél:</span><span>{t.get('client_tel', '')}</span></div>
</div>
<hr class="sep">
<div class="section bold">DÉTAIL DES RÉPARATIONS</div>
<div class="section">
  {lignes}
</div>
<hr class="sep">
<div class="section">
  <div class="row"><span>Total HT:</span><span class="val">{_fp(total_ht)}€</span></div>
  <div class="row"><span>TVA (20%):</span><span class="val">{_fp(tva)}€</span></div>
</div>
<hr class="sep-bold">
<div class="total-box"><div class="row"><span>TOTAL TTC:</span><span>{_fp(total_ttc)}€</span></div></div>
{f'<div class="row"><span>Acompte:</span><span class="val">- {_fp(acompte)}€</span></div>' if acompte > 0 else ''}
{f'<div class="total-box center">RESTE À PAYER: {_fp(reste)}€</div>' if acompte > 0 else ''}
<hr class="sep">
<div class="tiny">
  Ce ticket de garantie ne fait pas office de facture.
</div>
<hr class="sep">
<div class="center small">
  KLIKPHONE SARL<br>
  {siret_line}
</div>
</body></html>"""


# ═══════════════════════════════════════════════════════════════
# ROUTES
# ═══════════════════════════════════════════════════════════════

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
    html_client = _ticket_client_html(t)
    html_staff = _ticket_staff_html(t)
    # Page 1: client, Page 2: staff avec saut de page
    page1 = html_client.replace("</body></html>", "")
    page1 += '<div style="page-break-after:always"></div>'
    if "<body>" in html_staff:
        page1 += html_staff.split("<body>", 1)[1]
    else:
        page1 += html_staff
    return HTMLResponse(page1)


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
