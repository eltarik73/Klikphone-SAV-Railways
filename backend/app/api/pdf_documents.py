"""
PDF Documents A4 — Devis et Recu professionnels au format A4.
Génération HTML → PDF via xhtml2pdf, envoi par email via Resend.
"""

import base64
import os
from io import BytesIO
from datetime import datetime

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.api.print_tickets import (
    _get_ticket_full, _parse_repair_lines, _calc_reduction,
    _get_config, _fp, _fd, _qr_url,
)

router = APIRouter(prefix="/api/tickets", tags=["pdf"])

# ─── Logo en base64 (embarqué pour fiabilité dans le PDF) ───────
_LOGO_B64 = ""
_logo_path = os.path.join(os.path.dirname(__file__), "logo_k.png")
if os.path.exists(_logo_path):
    with open(_logo_path, "rb") as f:
        _LOGO_B64 = base64.b64encode(f.read()).decode()


def _logo_img(height: int = 60) -> str:
    if _LOGO_B64:
        return f'<img src="data:image/png;base64,{_LOGO_B64}" style="height:{height}px" />'
    return ""


# ─── CSS A4 commun ──────────────────────────────────────────────
_CSS_A4 = """
@page {
    size: A4;
    margin: 1.2cm 1.5cm;
}
body {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 10pt;
    color: #1e293b;
    line-height: 1.4;
    margin: 0;
    padding: 0;
}
.header-bar {
    background: #E53E2E;
    height: 6px;
    margin-bottom: 20px;
}
.header-table {
    width: 100%;
    margin-bottom: 15px;
}
.header-table td {
    vertical-align: top;
    padding: 0;
}
.company-name {
    font-size: 22pt;
    font-weight: bold;
    color: #E53E2E;
    margin: 0;
    letter-spacing: 1px;
}
.company-sub {
    font-size: 9pt;
    color: #64748b;
    margin-top: 2px;
}
.company-info {
    font-size: 8pt;
    color: #64748b;
    line-height: 1.6;
}
.doc-title {
    font-size: 24pt;
    font-weight: bold;
    color: #E53E2E;
    text-align: center;
    margin: 20px 0 5px 0;
    letter-spacing: 6px;
}
.doc-meta {
    text-align: center;
    font-size: 10pt;
    color: #475569;
    margin-bottom: 20px;
}
.doc-meta b {
    color: #1e293b;
}
.sep-line {
    border: none;
    border-top: 2px solid #E53E2E;
    margin: 15px 0;
}
.sep-light {
    border: none;
    border-top: 1px solid #e2e8f0;
    margin: 12px 0;
}
.info-grid {
    width: 100%;
    margin-bottom: 18px;
    border-collapse: collapse;
}
.info-grid td {
    vertical-align: top;
    padding: 0;
    width: 50%;
}
.info-box {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    padding: 12px 14px;
}
.info-box-left {
    margin-right: 8px;
}
.info-box-right {
    margin-left: 8px;
}
.info-label {
    font-size: 7pt;
    font-weight: bold;
    color: #E53E2E;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    margin-bottom: 6px;
}
.info-row {
    font-size: 9pt;
    color: #334155;
    margin-bottom: 3px;
}
.info-row b {
    color: #1e293b;
}
.section-title {
    font-size: 8pt;
    font-weight: bold;
    color: #E53E2E;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    margin-bottom: 8px;
}

/* ── Table lignes de réparation ── */
.repair-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 0;
}
.repair-table th {
    background: #1e293b;
    color: white;
    font-size: 8pt;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 1px;
    padding: 8px 12px;
    text-align: left;
}
.repair-table th.right {
    text-align: right;
}
.repair-table td {
    padding: 9px 12px;
    font-size: 9.5pt;
    border-bottom: 1px solid #e2e8f0;
}
.repair-table tr.alt td {
    background: #f8fafc;
}
.repair-table td.right {
    text-align: right;
    font-variant-numeric: tabular-nums;
}

/* ── Bloc totaux ── */
.totals-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 0;
}
.totals-table td {
    padding: 6px 12px;
    font-size: 9.5pt;
}
.totals-table td.label {
    text-align: right;
    color: #64748b;
    width: 70%;
}
.totals-table td.value {
    text-align: right;
    font-weight: bold;
    color: #1e293b;
    width: 30%;
    font-variant-numeric: tabular-nums;
}
.totals-table tr.sep td {
    border-top: 1px solid #cbd5e1;
}
.totals-table tr.total td {
    background: #E53E2E;
    color: white;
    font-size: 12pt;
    font-weight: bold;
    padding: 10px 12px;
}
.totals-table tr.total td.label {
    color: rgba(255,255,255,0.85);
}
.totals-table tr.reste td {
    background: #1e293b;
    color: white;
    font-size: 11pt;
    font-weight: bold;
    padding: 9px 12px;
}
.totals-table tr.reste td.label {
    color: rgba(255,255,255,0.8);
}
.totals-table tr.acompte td {
    color: #16a34a;
    font-style: italic;
}

/* ── Footer ── */
.conditions {
    font-size: 8pt;
    color: #94a3b8;
    line-height: 1.5;
    margin-top: 25px;
}
.footer-bar {
    background: #f1f5f9;
    padding: 10px 14px;
    margin-top: 25px;
    font-size: 7.5pt;
    color: #64748b;
    text-align: center;
    line-height: 1.6;
    border-top: 2px solid #E53E2E;
}
.signature-area {
    margin-top: 30px;
    width: 100%;
}
.signature-area td {
    vertical-align: top;
    padding: 0;
}
.sig-box {
    border: 1px dashed #cbd5e1;
    height: 70px;
    padding: 8px;
    font-size: 8pt;
    color: #94a3b8;
}
.qr-cell {
    text-align: right;
    width: 100px;
}
.paye-stamp {
    color: #16a34a;
    font-size: 28pt;
    font-weight: bold;
    text-align: center;
    border: 4px solid #16a34a;
    padding: 6px 18px;
    display: inline-block;
    transform: rotate(-12deg);
    opacity: 0.7;
    letter-spacing: 4px;
    margin: 10px auto;
}
"""


# ═══════════════════════════════════════════════════════════════
# DEVIS A4
# ═══════════════════════════════════════════════════════════════

def _devis_a4_html(t: dict) -> str:
    """Génère un devis A4 professionnel en HTML."""
    code = t.get("ticket_code", "")
    appareil = t.get("modele_autre") or f"{t.get('marque', '')} {t.get('modele', '')}".strip()
    categorie = t.get("categorie", "")
    panne = t.get("panne_detail") or t.get("panne", "")

    adresse = _get_config("adresse", "79 Place Saint Léger, 73000 Chambéry")
    tel_boutique = _get_config("tel_boutique", "04 79 60 89 22")
    tva_rate = float(_get_config("tva", "20"))

    # Client
    client_nom = f"{t.get('client_prenom', '')} {t.get('client_nom', '')}".strip()
    client_tel = t.get("client_tel", "")
    client_email = t.get("client_email", "")
    client_societe = t.get("client_societe", "")

    # Lignes de réparation
    repair_lines = _parse_repair_lines(t)
    subtotal = sum(r["prix"] for r in repair_lines)
    reduction = _calc_reduction(t, subtotal)
    total_ttc = max(0, subtotal - reduction)
    tva_amount = round(total_ttc * tva_rate / (100 + tva_rate), 2)
    total_ht = round(total_ttc - tva_amount, 2)
    acompte = float(t.get("acompte") or 0)
    reste = total_ttc - acompte

    # Date
    date_depot = _fd(t.get("date_depot"))
    date_recup = t.get("date_recuperation") or ""
    qr = _qr_url(code)

    # Lignes tableau
    rows_html = ""
    for i, r in enumerate(repair_lines):
        alt = ' class="alt"' if i % 2 == 1 else ""
        rows_html += f'<tr{alt}><td>{r["label"]}</td><td class="right">{_fp(r["prix"])} &euro;</td></tr>\n'

    if not repair_lines:
        rows_html = '<tr><td colspan="2" style="text-align:center;color:#94a3b8;padding:20px">Aucune ligne de réparation</td></tr>'

    # Lignes totaux
    totals_html = f"""
    <tr><td class="label">Sous-total TTC</td><td class="value">{_fp(subtotal)} &euro;</td></tr>"""

    if reduction > 0:
        totals_html += f"""
    <tr><td class="label">Réduction</td><td class="value" style="color:#E53E2E">-{_fp(reduction)} &euro;</td></tr>"""

    totals_html += f"""
    <tr class="sep"><td class="label">Total HT</td><td class="value">{_fp(total_ht)} &euro;</td></tr>
    <tr><td class="label">TVA ({_fp(tva_rate).replace(',00', '')}%)</td><td class="value">{_fp(tva_amount)} &euro;</td></tr>
    <tr class="total"><td class="label">TOTAL TTC</td><td class="value">{_fp(total_ttc)} &euro;</td></tr>"""

    if acompte > 0:
        totals_html += f"""
    <tr class="acompte"><td class="label">Acompte versé</td><td class="value">-{_fp(acompte)} &euro;</td></tr>
    <tr class="reste"><td class="label">RESTE À PAYER</td><td class="value">{_fp(reste)} &euro;</td></tr>"""

    # Société client
    societe_html = f'<div class="info-row"><b>{client_societe}</b></div>' if client_societe else ""

    # Date récupération
    recup_html = f'<div class="info-row">Récupération prévue : <b>{date_recup}</b></div>' if date_recup else ""

    return f"""<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>{_CSS_A4}</style>
</head><body>

<div class="header-bar"></div>

<table class="header-table">
<tr>
<td style="width:80px">{_logo_img(55)}</td>
<td style="padding-left:12px">
    <div class="company-name">KLIKPHONE</div>
    <div class="company-sub">Spécialiste réparation téléphonie</div>
</td>
<td style="text-align:right">
    <div class="company-info">
        {adresse}<br>
        Tél : {tel_boutique}<br>
        www.klikphone.com<br>
        <b>SIRET : 81396114100013</b><br>
        <b>TVA : FR03813961141</b>
    </div>
</td>
</tr>
</table>

<hr class="sep-line">

<div class="doc-title">D E V I S</div>
<div class="doc-meta">
    N° <b>{code}</b> &nbsp;&mdash;&nbsp; Date : <b>{date_depot}</b>
</div>

<hr class="sep-light">

<table class="info-grid">
<tr>
<td>
    <div class="info-box info-box-left">
        <div class="info-label">Client</div>
        {societe_html}
        <div class="info-row"><b>{client_nom}</b></div>
        <div class="info-row">Tél : {client_tel}</div>
        {"<div class='info-row'>Email : " + client_email + "</div>" if client_email else ""}
    </div>
</td>
<td>
    <div class="info-box info-box-right">
        <div class="info-label">Appareil</div>
        <div class="info-row"><b>{appareil}</b></div>
        {"<div class='info-row'>Catégorie : " + categorie + "</div>" if categorie else ""}
        <div class="info-row">Panne : {panne}</div>
        {recup_html}
    </div>
</td>
</tr>
</table>

<div class="section-title">Détail des réparations</div>

<table class="repair-table">
<tr>
    <th>Description</th>
    <th class="right" style="width:120px">Prix TTC</th>
</tr>
{rows_html}
</table>

<table class="totals-table">
{totals_html}
</table>

<table class="signature-area">
<tr>
<td style="width:65%">
    <div class="conditions">
        <b>Conditions :</b><br>
        Ce devis est valable 30 jours à compter de sa date d'émission.<br>
        Toute réparation acceptée engage le client au paiement du montant indiqué.<br>
        Les pièces remplacées restent la propriété de Klikphone sauf demande contraire.
    </div>
    <div style="margin-top:20px">
        <div style="font-size:8pt;color:#64748b;margin-bottom:4px">Signature du client (bon pour accord) :</div>
        <div class="sig-box"></div>
    </div>
</td>
<td class="qr-cell">
    <div style="text-align:right">
        <img src="{qr}" style="width:90px;height:90px" />
        <div style="font-size:7pt;color:#94a3b8;margin-top:3px">Suivi en ligne</div>
    </div>
</td>
</tr>
</table>

<div class="footer-bar">
    <b>Klikphone</b> &mdash; {adresse}<br>
    SIRET : 81396114100013 &nbsp;|&nbsp; TVA Intra. : FR03813961141 &nbsp;|&nbsp; Tél : {tel_boutique} &nbsp;|&nbsp; www.klikphone.com
</div>

</body></html>"""


# ═══════════════════════════════════════════════════════════════
# REÇU DE PAIEMENT A4
# ═══════════════════════════════════════════════════════════════

def _recu_a4_html(t: dict) -> str:
    """Génère un reçu de paiement A4 professionnel en HTML."""
    code = t.get("ticket_code", "")
    appareil = t.get("modele_autre") or f"{t.get('marque', '')} {t.get('modele', '')}".strip()
    categorie = t.get("categorie", "")
    panne = t.get("panne_detail") or t.get("panne", "")

    adresse = _get_config("adresse", "79 Place Saint Léger, 73000 Chambéry")
    tel_boutique = _get_config("tel_boutique", "04 79 60 89 22")
    tva_rate = float(_get_config("tva", "20"))

    # Client
    client_nom = f"{t.get('client_prenom', '')} {t.get('client_nom', '')}".strip()
    client_tel = t.get("client_tel", "")
    client_email = t.get("client_email", "")
    client_societe = t.get("client_societe", "")

    # Lignes de réparation
    repair_lines = _parse_repair_lines(t)
    subtotal = sum(r["prix"] for r in repair_lines)
    reduction = _calc_reduction(t, subtotal)
    total_ttc = max(0, subtotal - reduction)
    tva_amount = round(total_ttc * tva_rate / (100 + tva_rate), 2)
    total_ht = round(total_ttc - tva_amount, 2)
    acompte = float(t.get("acompte") or 0)
    reste = total_ttc - acompte
    is_paid = reste <= 0

    # Dates
    date_depot = _fd(t.get("date_depot"))
    date_now = datetime.now().strftime("%d/%m/%Y")
    qr = _qr_url(code)

    # Lignes tableau
    rows_html = ""
    for i, r in enumerate(repair_lines):
        alt = ' class="alt"' if i % 2 == 1 else ""
        rows_html += f'<tr{alt}><td>{r["label"]}</td><td class="right">{_fp(r["prix"])} &euro;</td></tr>\n'

    if not repair_lines:
        rows_html = '<tr><td colspan="2" style="text-align:center;color:#94a3b8;padding:20px">Aucune ligne</td></tr>'

    # Totaux
    totals_html = f"""
    <tr><td class="label">Sous-total TTC</td><td class="value">{_fp(subtotal)} &euro;</td></tr>"""

    if reduction > 0:
        totals_html += f"""
    <tr><td class="label">Réduction</td><td class="value" style="color:#E53E2E">-{_fp(reduction)} &euro;</td></tr>"""

    totals_html += f"""
    <tr class="sep"><td class="label">Total HT</td><td class="value">{_fp(total_ht)} &euro;</td></tr>
    <tr><td class="label">TVA ({_fp(tva_rate).replace(',00', '')}%)</td><td class="value">{_fp(tva_amount)} &euro;</td></tr>
    <tr class="total"><td class="label">TOTAL TTC</td><td class="value">{_fp(total_ttc)} &euro;</td></tr>"""

    if acompte > 0:
        totals_html += f"""
    <tr class="acompte"><td class="label">Acompte versé</td><td class="value">-{_fp(acompte)} &euro;</td></tr>"""

    if reste > 0:
        totals_html += f"""
    <tr class="reste"><td class="label">RESTE À PAYER</td><td class="value">{_fp(reste)} &euro;</td></tr>"""

    # Stamp PAYÉ
    paye_html = ""
    if is_paid:
        paye_html = '<div style="text-align:center;margin:15px 0"><div class="paye-stamp">PAYÉ</div></div>'

    societe_html = f'<div class="info-row"><b>{client_societe}</b></div>' if client_societe else ""

    # Fidélité
    fidelite_html = ""
    try:
        active = _get_config("fidelite_active", "1")
        if active == "1" and t.get("client_id"):
            from app.database import get_cursor
            with get_cursor() as cur:
                cur.execute("SELECT points_fidelite FROM clients WHERE id = %s", (t["client_id"],))
                row = cur.fetchone()
            if row:
                pts = int(row.get("points_fidelite") or 0)
                fidelite_html = f"""
    <div style="background:#fefce8;border:1px solid #fde68a;border-radius:4px;padding:10px 14px;margin-top:15px">
        <div style="font-size:8pt;font-weight:bold;color:#a16207;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px">Programme Fidélité</div>
        <div style="font-size:9pt;color:#78350f">Vos points : <b>{pts} pts</b></div>
    </div>"""
    except Exception:
        pass

    return f"""<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>{_CSS_A4}</style>
</head><body>

<div class="header-bar"></div>

<table class="header-table">
<tr>
<td style="width:80px">{_logo_img(55)}</td>
<td style="padding-left:12px">
    <div class="company-name">KLIKPHONE</div>
    <div class="company-sub">Spécialiste réparation téléphonie</div>
</td>
<td style="text-align:right">
    <div class="company-info">
        {adresse}<br>
        Tél : {tel_boutique}<br>
        www.klikphone.com<br>
        <b>SIRET : 81396114100013</b><br>
        <b>TVA : FR03813961141</b>
    </div>
</td>
</tr>
</table>

<hr class="sep-line">

<div class="doc-title">REÇU DE PAIEMENT</div>
<div class="doc-meta">
    N° <b>{code}</b> &nbsp;&mdash;&nbsp; Date : <b>{date_now}</b> &nbsp;&mdash;&nbsp; Dépôt : {date_depot}
</div>

{paye_html}

<hr class="sep-light">

<table class="info-grid">
<tr>
<td>
    <div class="info-box info-box-left">
        <div class="info-label">Client</div>
        {societe_html}
        <div class="info-row"><b>{client_nom}</b></div>
        <div class="info-row">Tél : {client_tel}</div>
        {"<div class='info-row'>Email : " + client_email + "</div>" if client_email else ""}
    </div>
</td>
<td>
    <div class="info-box info-box-right">
        <div class="info-label">Appareil</div>
        <div class="info-row"><b>{appareil}</b></div>
        {"<div class='info-row'>Catégorie : " + categorie + "</div>" if categorie else ""}
        <div class="info-row">Panne : {panne}</div>
    </div>
</td>
</tr>
</table>

<div class="section-title">Détail des prestations</div>

<table class="repair-table">
<tr>
    <th>Description</th>
    <th class="right" style="width:120px">Prix TTC</th>
</tr>
{rows_html}
</table>

<table class="totals-table">
{totals_html}
</table>

{fidelite_html}

<table class="signature-area">
<tr>
<td style="width:65%">
    <div class="conditions">
        <b>Conditions :</b><br>
        Garantie pièces et main d'oeuvre : 6 mois à compter de la date de réparation.<br>
        La garantie ne couvre pas les dommages causés par l'usure, les chocs ou l'oxydation.<br>
        Les pièces remplacées restent la propriété de Klikphone sauf demande contraire.
    </div>
</td>
<td class="qr-cell">
    <div style="text-align:right">
        <img src="{qr}" style="width:90px;height:90px" />
        <div style="font-size:7pt;color:#94a3b8;margin-top:3px">Suivi en ligne</div>
    </div>
</td>
</tr>
</table>

<div class="footer-bar">
    <b>Klikphone</b> &mdash; {adresse}<br>
    SIRET : 81396114100013 &nbsp;|&nbsp; TVA Intra. : FR03813961141 &nbsp;|&nbsp; Tél : {tel_boutique} &nbsp;|&nbsp; www.klikphone.com
</div>

</body></html>"""


# ═══════════════════════════════════════════════════════════════
# GÉNÉRATION PDF
# ═══════════════════════════════════════════════════════════════

def generate_pdf(ticket_id: int, doc_type: str) -> tuple:
    """Génère un PDF A4 pour un ticket. Retourne (pdf_bytes, filename)."""
    from xhtml2pdf import pisa

    t = _get_ticket_full(ticket_id)
    if not t:
        return None, None

    generators = {
        "devis": _devis_a4_html,
        "recu": _recu_a4_html,
    }
    gen = generators.get(doc_type)
    if not gen:
        return None, None

    html = gen(t)
    buffer = BytesIO()
    pisa_status = pisa.CreatePDF(html, dest=buffer, encoding="utf-8")

    if pisa_status.err:
        return None, None

    code = t.get("ticket_code", "document")
    type_labels = {"devis": "Devis", "recu": "Recu"}
    filename = f"{type_labels.get(doc_type, 'Document')}-{code}.pdf"

    return buffer.getvalue(), filename


# ═══════════════════════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@router.get("/{ticket_id}/pdf/{doc_type}")
async def download_pdf(ticket_id: int, doc_type: str):
    """Télécharge le PDF A4 d'un devis ou reçu."""
    if doc_type not in ("devis", "recu"):
        raise HTTPException(400, "Type de document non supporté. Utilisez 'devis' ou 'recu'.")

    pdf_bytes, filename = generate_pdf(ticket_id, doc_type)
    if not pdf_bytes:
        raise HTTPException(404, "Ticket non trouvé ou erreur de génération PDF")

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
        },
    )
