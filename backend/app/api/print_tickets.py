"""
API Print Tickets — génération HTML pour impression thermique 80mm et A4.
Tickets client, staff, combiné, devis, reçu.
+ PDF A4 professionnel pour devis et reçu.
"""

import base64
import json
import os
import urllib.parse
from datetime import datetime
from io import BytesIO
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse, Response

from app.database import get_cursor

router = APIRouter(prefix="/api/tickets", tags=["print"])

# URL frontend pour les QR codes de suivi
_FRONTEND_URL = "https://klikphone-sav-railways-production.up.railway.app"
_LOGO_URL = f"{_FRONTEND_URL}/logo_k.png"


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


def _fidelite_section(t: dict) -> str:
    """Section fidélité pour le reçu."""
    try:
        active = _get_config("fidelite_active", "1")
        if active != "1":
            return ""
        client_id = t.get("client_id")
        if not client_id:
            return ""
        with get_cursor() as cur:
            cur.execute("SELECT points_fidelite, total_depense FROM clients WHERE id = %s", (client_id,))
            row = cur.fetchone()
        if not row:
            return ""
        pts = int(row.get("points_fidelite") or 0)
        palier_film = int(_get_config("fidelite_palier_film", "1000"))
        palier_reduction = int(_get_config("fidelite_palier_reduction", "5000"))
        montant_reduction = _get_config("fidelite_montant_reduction", "10")
        prochain = min(palier_film, palier_reduction)
        restant = max(0, prochain - pts)
        return f"""
<hr class="sep">
<div class="section center">
  <div class="bold">PROGRAMME FIDÉLITÉ</div>
  <div>Vos points : <b>{pts}</b> pts</div>
  <div class="tiny" style="margin-top:2px">
    {palier_film} pts = Film verre trempé offert |
    {palier_reduction} pts = {montant_reduction}€ de réduction
  </div>
  {f'<div class="tiny">Plus que {restant} pts pour votre prochaine récompense !</div>' if restant > 0 else '<div class="tiny bold">Récompense disponible !</div>'}
</div>"""
    except Exception:
        return ""


def _suivi_url(code: str) -> str:
    """URL de suivi pour le QR code."""
    return f"{_FRONTEND_URL}/suivi?ticket={urllib.parse.quote(code)}"


def _qr_url(code: str) -> str:
    """URL QR code API pointant vers le suivi."""
    target = _suivi_url(code)
    return f"https://api.qrserver.com/v1/create-qr-code/?size=200x200&data={urllib.parse.quote(target)}"


def _pattern_grid(pattern_str: str) -> str:
    """Dessine le schéma de déverrouillage en grille HTML pour impression thermique."""
    if not pattern_str:
        return ""

    points = [int(p) for p in pattern_str.split("-") if p.isdigit()]
    if not points:
        return ""

    order = {p: i + 1 for i, p in enumerate(points)}
    active = set(points)

    sequence = " → ".join(str(p) for p in points)

    lines = []
    lines.append(f'<div style="font-size:12px;font-weight:700;text-align:center;margin-top:2px">')
    lines.append(f'Séquence : {sequence}</div>')
    lines.append('<table style="border-collapse:collapse;margin:4px auto">')
    for row in range(3):
        lines.append("<tr>")
        for col in range(3):
            num = row * 3 + col + 1
            if num in active:
                idx = order[num]
                lines.append(
                    f'<td style="width:28px;height:28px;text-align:center;'
                    f'border:2px solid #000;font-weight:900;font-size:14px;'
                    f'font-family:Courier New,monospace">{idx}</td>'
                )
            else:
                lines.append(
                    '<td style="width:28px;height:28px;text-align:center;'
                    'border:1px solid #999;color:#999;font-size:14px;'
                    'font-family:Courier New,monospace">&middot;</td>'
                )
        lines.append("</tr>")
    lines.append("</table>")

    return "\n".join(lines)


def _calc_reduction(t: dict, total: float) -> float:
    """Calcule la réduction effective."""
    red_pct = float(t.get("reduction_pourcentage") or 0)
    red_mnt = float(t.get("reduction_montant") or 0)
    if red_pct > 0:
        return round(total * red_pct / 100, 2)
    return red_mnt


def _parse_repair_lines(t: dict) -> list:
    """Parse repair lines from ticket (JSON array or legacy fields)."""
    lines = []
    reparation_supp = t.get("reparation_supp") or ""
    if reparation_supp.startswith("["):
        try:
            parsed = json.loads(reparation_supp)
            lines = [{"label": r.get("label", ""), "prix": float(r.get("prix", 0))} for r in parsed if r.get("label")]
            return lines
        except Exception:
            pass
    # Legacy format
    if t.get("panne"):
        lines.append({"label": t["panne"], "prix": float(t.get("devis_estime") or 0)})
    if reparation_supp and not reparation_supp.startswith("["):
        lines.append({"label": reparation_supp, "prix": float(t.get("prix_supp") or 0)})
    return lines


def _get_ticket_notes(ticket_id: int) -> list:
    """Fetch private notes for a ticket."""
    try:
        with get_cursor() as cur:
            cur.execute("""
                SELECT contenu, auteur, important, date_creation
                FROM notes_tickets
                WHERE ticket_id = %s
                ORDER BY date_creation DESC
            """, (ticket_id,))
            rows = cur.fetchall()
            return [dict(r) for r in rows]
    except Exception:
        return []


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
  padding: 4mm;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #000;
  background: #fff;
}}
.center {{ text-align:center; }}
.bold {{ font-weight:900; }}
.right {{ text-align:right; }}
h1 {{
  font-size: 26px;
  font-weight: 900;
  letter-spacing: 4px;
  margin: 0;
}}
h2 {{
  font-size: 16px;
  font-weight: 900;
  letter-spacing: 3px;
  text-transform: uppercase;
  margin: 3px 0;
}}
.sep {{ border:none; border-top:1px dashed #000; margin:8px 0; }}
.sep-bold {{ border:none; border-top:3px solid #000; margin:10px 0; }}
.row {{ display:flex; justify-content:space-between; padding:3px 0; font-size:14px; font-weight:700; }}
.row .val {{ text-align:right; flex-shrink:0; font-weight:900; }}
.section {{ margin:8px 0; }}
.section-title {{
  font-weight:900; font-size:12px; letter-spacing:1px; text-transform:uppercase;
  background:#000; color:#fff; padding:3px 8px; margin-bottom:6px;
}}
.box {{
  border:2px solid #000; border-radius:4px; padding:10px; margin:8px 0;
}}
.box-title {{
  background:#000; color:#fff; font-size:11px; font-weight:700;
  padding:3px 8px; margin:-10px -10px 8px -10px;
  letter-spacing:1px; text-transform:uppercase;
}}
.small {{ font-size:11px; line-height:1.4; font-weight:600; }}
.tiny {{ font-size:10px; line-height:1.3; color:#000; }}
.logo-img {{ width:160px; height:auto; display:block; margin:0 auto 6px; }}
.qr {{ text-align:center; margin:10px 0; }}
.qr img {{ width:200px; height:200px; }}
.highlight {{
  font-size:22px;
  font-weight:900;
  letter-spacing:3px;
}}
.total-box {{
  border:3px solid #000;
  padding:8px 10px;
  margin:8px 0;
  font-weight:900;
  font-size:17px;
}}
.info-box {{
  border:2px solid #000;
  border-radius:4px;
  padding:6px 10px;
  margin:6px 0;
}}
@media print {{
  body {{ width:80mm; max-width:302px; }}
  @page {{ size:80mm auto; margin:2mm; }}
  body * {{ -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }}
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
    adresse = _get_config("adresse", "79 Place Saint Léger, 73000 Chambéry")
    tel_boutique = _get_config("tel_boutique", "04 79 60 89 22")
    horaires = _get_config("horaires", "Lundi-Samedi 10h-19h")

    repair_lines = _parse_repair_lines(t)
    subtotal = sum(r["prix"] for r in repair_lines)
    reduction = _calc_reduction(t, subtotal)
    total = max(0, subtotal - reduction)
    acompte = float(t.get("acompte") or 0)
    reste = total - acompte

    # Date de récupération
    recup_html = ""
    if t.get("date_recuperation"):
        recup_html = f'<div class="info-box center" style="margin-top:6px"><div class="bold small">Date de récupération prévue</div><div style="font-size:15px;font-weight:900">{t["date_recuperation"]}</div></div>'

    # Tarification section
    tarif_html = ""
    if repair_lines:
        tarif_inner = ""
        for r in repair_lines:
            tarif_inner += f'<div class="row"><span>{r["label"]}</span><span class="val">{_fp(r["prix"])} €</span></div>'
        if reduction > 0:
            red_pct = float(t.get("reduction_pourcentage") or 0)
            label = f'Réduction ({red_pct:g}%)' if red_pct > 0 else 'Réduction'
            tarif_inner += f'<div class="row"><span>{label}</span><span class="val">- {_fp(reduction)} €</span></div>'
        tarif_inner += f'<div style="border-top:2px solid #000;margin-top:6px;padding-top:6px;">'
        tarif_inner += f'<div class="row" style="font-size:16px;"><span>TOTAL</span><span class="val">{_fp(total)} €</span></div></div>'
        if acompte > 0:
            tarif_inner += f'<div class="row"><span>Acompte versé</span><span class="val">- {_fp(acompte)} €</span></div>'
        tarif_inner += f'<div style="border:3px solid #000;padding:8px;margin-top:6px;text-align:center;font-size:17px;font-weight:900;">RESTE À PAYER : {_fp(reste)} €</div>'
        tarif_html = f'<div class="box"><div class="box-title">💰 TARIFICATION</div>{tarif_inner}</div>'

    # Note publique
    note_html = ""
    if t.get("notes_client"):
        note_html = f'<div class="box"><div class="box-title">📝 NOTE</div><div style="font-size:13px;font-weight:700;">{t["notes_client"]}</div></div>'

    return _THERMAL.format(title=f"Ticket Client - {code}") + f"""
<div class="center">
  <img src="{_LOGO_URL}" class="logo-img" alt="K" onerror="this.style.display='none'">
  <h1>KLIKPHONE</h1>
  <div class="small">Spécialiste Apple & Multimarque</div>
  <div class="small">{adresse}</div>
  <div class="small">Tél: {tel_boutique}</div>
</div>
<hr class="sep-bold">
<div style="background:#000;color:#fff;text-align:center;padding:8px;font-size:17px;font-weight:900;letter-spacing:3px;margin-bottom:8px;">
  TICKET DE DÉPÔT
</div>

<div class="info-box center">
  <div class="highlight">{code}</div>
  <div class="small" style="margin-top:2px">{_fd(t.get('date_depot'))}</div>
</div>
{recup_html}

<div class="box">
  <div class="box-title">👤 CLIENT</div>
  <div class="row"><span>Nom :</span><span class="val">{t.get('client_prenom', '')} {t.get('client_nom', '')}</span></div>
  <div class="row"><span>Tél :</span><span class="val">{t.get('client_tel', '')}</span></div>
</div>

<div class="box">
  <div class="box-title">📱 APPAREIL</div>
  <div class="row"><span>Modèle :</span><span class="val">{appareil}</span></div>
  <div class="row"><span>Catégorie :</span><span class="val">{t.get('categorie', '')}</span></div>
  <div class="row"><span>Motif :</span><span class="val">{t.get('panne', '')}</span></div>
  {f'<div class="row"><span>Détail :</span><span class="val">{t.get("panne_detail","")}</span></div>' if t.get('panne_detail') else ''}
  {f'<div class="row"><span>IMEI :</span><span class="val" style="font-family:Courier New,monospace">{t.get("imei","")}</span></div>' if t.get('imei') else ''}
</div>
{tarif_html}
{note_html}

<div class="qr"><img src="{qr}" alt="QR"></div>
<div class="center" style="font-weight:900;font-size:12px">
  Scannez pour suivre votre<br>réparation en ligne
</div>

<hr class="sep">
<div class="section tiny" style="padding:4px 0;">
  <b style="font-size:11px">CONDITIONS GÉNÉRALES</b><br><br>
  Klikphone ne consulte ni n'accède aux données
  de votre appareil. Sauvegardez vos données
  avant le dépôt. Nous ne pouvons être tenus
  responsables d'une perte de données ou
  dysfonctionnement post-réparation. Garantie
  6 mois sur les réparations.
</div>

<hr class="sep-bold">
<div class="center" style="margin-top:8px;font-size:13px">
  <b>Merci de votre confiance !</b><br>
  <div style="font-size:15px;font-weight:900;letter-spacing:3px;margin-top:4px">KLIKPHONE</div>
  <div class="small">{horaires}</div>
</div>
</body></html>"""


# ═══════════════════════════════════════════════════════════════
# TICKET STAFF (FICHE TECHNICIEN)
# ═══════════════════════════════════════════════════════════════

def _ticket_staff_html(t: dict) -> str:
    """Ticket staff — format thermique 80mm, contraste max, encadrés."""
    appareil = t.get("modele_autre") or f"{t.get('marque', '')} {t.get('modele', '')}".strip()
    code = t.get("ticket_code", "")
    tech = t.get("technicien_assigne") or "Non assigné"
    date_recup = t.get("date_recuperation") or "Non définie"

    # --- Repair lines ---
    repair_lines = _parse_repair_lines(t)
    subtotal = sum(r["prix"] for r in repair_lines)
    reduction = _calc_reduction(t, subtotal)
    total = max(0, subtotal - reduction)
    acompte = float(t.get("acompte") or 0)
    reste = total - acompte

    repairs_html = ""
    for i, r in enumerate(repair_lines):
        qualite = ""
        if i == 0 and t.get("type_ecran"):
            qualite = (
                f'<span style="font-size:12px;font-weight:700;border:2px solid #000;'
                f'padding:1px 6px;margin-left:4px;">{t["type_ecran"]}</span>'
            )
        repairs_html += (
            f'<div style="font-size:{15 if i == 0 else 14}px;font-weight:{900 if i == 0 else 700};'
            f'padding:4px 0;border-bottom:1px dashed #000;">'
            f'{r["label"]} {qualite}'
            f'<span style="float:right;">{_fp(r["prix"])} €</span></div>'
        )

    # --- Security section ---
    sec_html = ""
    if t.get("pin") or t.get("pattern"):
        sec_inner = ""
        if t.get("pin"):
            sec_inner += (
                '<div style="margin-bottom:8px;">'
                '<div style="font-size:12px;font-weight:700;color:#000;">Code PIN :</div>'
                '<div style="font-size:24px;font-weight:900;font-family:Courier New,monospace;'
                'letter-spacing:6px;text-align:center;border:1px solid #000;padding:4px;margin-top:2px;">'
                f'{t["pin"]}</div></div>'
            )
        if t.get("pattern"):
            sec_inner += '<div style="font-size:12px;font-weight:700;color:#000;">Schéma :</div>'
            sec_inner += _pattern_grid(t["pattern"])
        sec_html = _staff_box("🔒 CODES DE SÉCURITÉ", sec_inner)

    # --- Notes from notes_tickets table ---
    ticket_id = t.get("id")
    notes_list = _get_ticket_notes(ticket_id) if ticket_id else []
    notes_html = ""
    if notes_list:
        notes_inner = ""
        for n in notes_list:
            if n.get("important"):
                notes_inner += (
                    '<div style="font-size:13px;font-weight:900;padding:4px 6px;margin:4px 0;'
                    f'border:2px solid #000;background:#000;color:#fff;">'
                    f'⚠️ {n["contenu"]}</div>'
                )
            else:
                dt = ""
                if n.get("date_creation"):
                    d = n["date_creation"]
                    dt = d.strftime("%d/%m %H:%M") if hasattr(d, "strftime") else str(d)[:10]
                notes_inner += (
                    f'<div style="font-size:13px;font-weight:700;padding:3px 0;'
                    f'border-bottom:1px dotted #000;">{n["contenu"]}'
                    f'<span style="font-size:10px;float:right;font-weight:400;">{dt}</span></div>'
                )
        notes_html = _staff_box("📝 NOTES", notes_inner)

    # --- Téléphone de prêt ---
    pret_html = ""
    if t.get("telephone_pret"):
        pret_html = _staff_box(
            "📱 TÉL DE PRÊT",
            f'<div style="font-size:15px;font-weight:900;text-align:center;">{t["telephone_pret"]}</div>'
        )

    # --- Technicien ---
    tech_html = _staff_box(
        "👷 TECHNICIEN",
        f'<div style="font-size:16px;font-weight:900;text-align:center;">{tech}</div>'
    )

    # --- Full HTML ---
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ticket Staff - {code}</title>
<style>
@page {{ size: 80mm auto; margin: 2mm; }}
* {{ margin:0; padding:0; box-sizing:border-box; }}
body {{ margin:0; padding:0; background:#fff; }}
@media print {{
  body * {{ -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }}
}}
</style>
</head><body>
<div id="ticket-staff" style="
  width:302px; font-family:Arial,sans-serif; padding:10px;
  color:#000; background:#fff; line-height:1.4;
">

  <!-- LOGO -->
  <div style="text-align:center;margin-bottom:8px;">
    <img src="{_LOGO_URL}" width="140" style="display:inline-block;" onerror="this.style.display='none'" />
  </div>

  <!-- EN-TÊTE BOUTIQUE -->
  <div style="text-align:center;font-size:11px;color:#000;margin-bottom:10px;line-height:1.3;">
    <div style="font-size:16px;font-weight:900;letter-spacing:2px;">KLIKPHONE</div>
    <div>79 Place Saint Léger, 73000 Chambéry</div>
    <div>Tél: 04 79 60 89 22</div>
  </div>

  <!-- TITRE TICKET -->
  <div style="
    background:#000;color:#fff;text-align:center;
    padding:8px;font-size:18px;font-weight:900;
    letter-spacing:3px;margin-bottom:10px;
  ">TICKET STAFF</div>

  <!-- NUMÉRO + DATE -->
  <div style="border:2px solid #000;border-radius:4px;padding:10px;margin-bottom:8px;">
    <div style="font-size:20px;font-weight:900;letter-spacing:1px;">{code}</div>
    <div style="font-size:12px;margin-top:4px;">
      <div><strong>Dépôt :</strong> {_fd(t.get('date_depot'))}</div>
      <div><strong>Récup :</strong> {date_recup}</div>
    </div>
  </div>

  <!-- CLIENT -->
  {_staff_box("👤 CLIENT",
    f'<div style="font-size:16px;font-weight:900;">{t.get("client_prenom", "")} {t.get("client_nom", "")}</div>'
    f'<div style="font-size:14px;margin-top:2px;">📞 {t.get("client_tel", "")}</div>'
  )}

  <!-- APPAREIL -->
  {_staff_box("📱 APPAREIL",
    f'<div style="font-size:16px;font-weight:900;">{appareil}</div>'
    f'<div style="font-size:13px;margin-top:4px;">'
    f'<div><strong>Catégorie :</strong> {t.get("categorie", "")}</div>'
    + (f'<div><strong>IMEI :</strong> <span style="font-family:Courier New,monospace">{t.get("imei","")}</span></div>' if t.get("imei") else "")
    + '</div>'
  )}

  <!-- RÉPARATIONS -->
  {_staff_box("🔧 RÉPARATIONS",
    repairs_html
    + (f'<div style="font-size:13px;padding:2px 0;border-bottom:1px dashed #000;">'
       f'{"Réduction (" + str(float(t.get("reduction_pourcentage") or 0)) + "%)" if float(t.get("reduction_pourcentage") or 0) > 0 else "Réduction"}'
       f' <span style="float:right;">- {_fp(reduction)} €</span></div>' if reduction > 0 else "")
    + f'<div style="font-size:16px;font-weight:900;padding:6px 0;margin-top:4px;">'
    + f'TOTAL : <span style="float:right;">{_fp(total)} €</span></div>'
    + (f'<div style="font-size:13px;padding:2px 0;">'
       f'Acompte : <span style="float:right;">- {_fp(acompte)} €</span></div>' if acompte > 0 else "")
    + f'<div style="border:2px solid #000;padding:6px 8px;margin-top:6px;'
    + f'font-size:16px;font-weight:900;text-align:center;">'
    + f'★ RESTE À PAYER : {_fp(reste)} €</div>'
  )}

  <!-- CODES DE SÉCURITÉ -->
  {sec_html}

  <!-- TECHNICIEN -->
  {tech_html}

  <!-- NOTES -->
  {notes_html}

  <!-- TÉL DE PRÊT -->
  {pret_html}

  <!-- FOOTER -->
  <div style="
    text-align:center;font-size:10px;color:#000;
    margin-top:12px;padding-top:8px;
    border-top:2px solid #000;
  ">
    KLIKPHONE — Document interne<br>
    Ne pas remettre au client
  </div>

</div>
</body></html>"""


def _staff_box(title: str, content: str) -> str:
    """Helper: crée une section encadrée avec titre inversé pour le ticket staff."""
    return (
        f'<div style="border:2px solid #000;border-radius:4px;padding:10px;margin-bottom:8px;">'
        f'<div style="background:#000;color:#fff;font-size:11px;font-weight:700;'
        f'padding:3px 8px;margin:-10px -10px 8px -10px;'
        f'letter-spacing:1px;text-transform:uppercase;">{title}</div>'
        f'{content}</div>'
    )


# ═══════════════════════════════════════════════════════════════
# DEVIS — FORMAT THERMIQUE 80mm
# ═══════════════════════════════════════════════════════════════

def _devis_html(t: dict) -> str:
    appareil = t.get("modele_autre") or f"{t.get('marque', '')} {t.get('modele', '')}".strip()
    code = t.get("ticket_code", "")
    adresse = _get_config("adresse", "79 Place Saint Léger, 73000 Chambéry")
    tva_rate = float(_get_config("tva", "20"))

    repair_lines = _parse_repair_lines(t)
    subtotal_ttc = sum(r["prix"] for r in repair_lines)
    acompte = float(t.get("acompte") or 0)
    reduction = _calc_reduction(t, subtotal_ttc)
    total_ttc = max(0, subtotal_ttc - reduction)
    tva = round(total_ttc * tva_rate / (100 + tva_rate), 2)
    total_ht = round(total_ttc - tva, 2)
    reste = total_ttc - acompte
    tva_label = f"TVA ({tva_rate:g}%)"

    lignes = ""
    for r in repair_lines:
        ht = round(r["prix"] * 100 / (100 + tva_rate), 2)
        lignes += f'<div class="row"><span>{r["label"]}</span><span class="val">{_fp(ht)} € HT</span></div>'
    if reduction > 0:
        red_pct = float(t.get("reduction_pourcentage") or 0)
        label = f'Réduction ({red_pct:g}%)' if red_pct > 0 else 'Réduction'
        red_ht = round(reduction * 100 / (100 + tva_rate), 2)
        lignes += f'<div class="row"><span>{label}</span><span class="val">- {_fp(red_ht)} € HT</span></div>'

    siret = _get_config("SIRET", "")
    siret_line = f'<div class="small">SIRET: {siret}</div>' if siret else ''

    return _THERMAL.format(title=f"Devis - {code}") + f"""
<div class="center">
  <img src="{_LOGO_URL}" class="logo-img" alt="K" onerror="this.style.display='none'">
  <h1>KLIKPHONE</h1>
  <div class="small">{adresse}</div>
</div>
<hr class="sep-bold">
<div style="background:#000;color:#fff;text-align:center;padding:8px;font-size:17px;font-weight:900;letter-spacing:4px;margin-bottom:8px;">
  D E V I S
</div>

<div class="box">
  <div class="box-title">📋 INFORMATIONS</div>
  <div class="row"><span>N° :</span><span class="val">{code}</span></div>
  <div class="row"><span>Date :</span><span class="val">{_fd(t.get('date_depot'))}</span></div>
  <div class="row"><span>Appareil :</span><span class="val">{appareil}</span></div>
</div>

<div class="box">
  <div class="box-title">👤 CLIENT</div>
  <div class="row"><span>Nom :</span><span class="val">{t.get('client_prenom', '')} {t.get('client_nom', '')}</span></div>
  <div class="row"><span>Tél :</span><span class="val">{t.get('client_tel', '')}</span></div>
</div>

<div class="box">
  <div class="box-title">🔧 DÉTAIL DES RÉPARATIONS</div>
  {lignes}
  <div style="border-top:2px solid #000;margin-top:6px;padding-top:6px;">
    <div class="row"><span>Total HT :</span><span class="val">{_fp(total_ht)} €</span></div>
    <div class="row"><span>{tva_label} :</span><span class="val">{_fp(tva)} €</span></div>
  </div>
</div>

<div class="total-box"><div class="row"><span>TOTAL TTC :</span><span>{_fp(total_ttc)} €</span></div></div>
{f'<div class="row" style="padding:2px 10px;"><span>Acompte :</span><span class="val">- {_fp(acompte)} €</span></div>' if acompte > 0 else ''}
{f'<div style="border:3px solid #000;padding:8px;margin:6px 0;text-align:center;font-size:17px;font-weight:900;">RESTE À PAYER : {_fp(reste)} €</div>' if acompte > 0 else ''}

<hr class="sep">
<div class="tiny" style="padding:2px 0;">
  Devis valable 30 jours.
</div>
<hr class="sep">
<div class="center small">
  <b>KLIKPHONE SARL</b><br>
  {siret_line}
</div>
</body></html>"""


# ═══════════════════════════════════════════════════════════════
# REÇU — FORMAT THERMIQUE 80mm
# ═══════════════════════════════════════════════════════════════

def _recu_html(t: dict) -> str:
    appareil = t.get("modele_autre") or f"{t.get('marque', '')} {t.get('modele', '')}".strip()
    code = t.get("ticket_code", "")
    adresse = _get_config("adresse", "79 Place Saint Léger, 73000 Chambéry")
    tva_rate = float(_get_config("tva", "20"))

    repair_lines = _parse_repair_lines(t)
    # For reçu, use tarif_final if available (overrides devis)
    if t.get("tarif_final") and len(repair_lines) > 0:
        repair_lines[0]["prix"] = float(t["tarif_final"])
    subtotal_ttc = sum(r["prix"] for r in repair_lines)
    acompte = float(t.get("acompte") or 0)
    reduction = _calc_reduction(t, subtotal_ttc)
    total_ttc = max(0, subtotal_ttc - reduction)
    tva = round(total_ttc * tva_rate / (100 + tva_rate), 2)
    total_ht = round(total_ttc - tva, 2)
    reste = total_ttc - acompte
    tva_label = f"TVA ({tva_rate:g}%)"

    lignes = ""
    for r in repair_lines:
        ht = round(r["prix"] * 100 / (100 + tva_rate), 2)
        lignes += f'<div class="row"><span>{r["label"]}</span><span class="val">{_fp(ht)} € HT</span></div>'
    if reduction > 0:
        red_pct = float(t.get("reduction_pourcentage") or 0)
        label = f'Réduction ({red_pct:g}%)' if red_pct > 0 else 'Réduction'
        red_ht = round(reduction * 100 / (100 + tva_rate), 2)
        lignes += f'<div class="row"><span>{label}</span><span class="val">- {_fp(red_ht)} € HT</span></div>'

    siret = _get_config("SIRET", "")
    siret_line = f'<div class="small">SIRET: {siret}</div>' if siret else ''

    return _THERMAL.format(title=f"Reçu - {code}") + f"""
<div class="center">
  <img src="{_LOGO_URL}" class="logo-img" alt="K" onerror="this.style.display='none'">
  <h1>KLIKPHONE</h1>
  <div class="small">{adresse}</div>
</div>
<hr class="sep-bold">
<div style="background:#000;color:#fff;text-align:center;padding:8px;font-size:17px;font-weight:900;letter-spacing:4px;margin-bottom:8px;">
  R E Ç U
</div>

<div class="box">
  <div class="box-title">📋 INFORMATIONS</div>
  <div class="row"><span>N° :</span><span class="val">{code}</span></div>
  <div class="row"><span>Date :</span><span class="val">{datetime.now().strftime("%d/%m/%Y")}</span></div>
  <div class="row"><span>Appareil :</span><span class="val">{appareil}</span></div>
</div>

<div class="box">
  <div class="box-title">👤 CLIENT</div>
  <div class="row"><span>Nom :</span><span class="val">{t.get('client_prenom', '')} {t.get('client_nom', '')}</span></div>
  <div class="row"><span>Tél :</span><span class="val">{t.get('client_tel', '')}</span></div>
</div>

<div class="box">
  <div class="box-title">🔧 DÉTAIL DES RÉPARATIONS</div>
  {lignes}
  <div style="border-top:2px solid #000;margin-top:6px;padding-top:6px;">
    <div class="row"><span>Total HT :</span><span class="val">{_fp(total_ht)} €</span></div>
    <div class="row"><span>{tva_label} :</span><span class="val">{_fp(tva)} €</span></div>
  </div>
</div>

<div class="total-box"><div class="row"><span>TOTAL TTC :</span><span>{_fp(total_ttc)} €</span></div></div>
{f'<div class="row" style="padding:2px 10px;"><span>Acompte :</span><span class="val">- {_fp(acompte)} €</span></div>' if acompte > 0 else ''}
{f'<div style="border:3px solid #000;padding:8px;margin:6px 0;text-align:center;font-size:17px;font-weight:900;">RESTE À PAYER : {_fp(reste)} €</div>' if acompte > 0 else ''}

<hr class="sep">
<div class="tiny" style="padding:2px 0;">
  Ce ticket de garantie ne fait pas office de facture.
</div>
{_fidelite_section(t)}
<hr class="sep">
<div class="center small">
  <b>KLIKPHONE SARL</b><br>
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


# ═══════════════════════════════════════════════════════════════
# PDF A4 — Devis et Reçu professionnels
# ═══════════════════════════════════════════════════════════════

# ─── Logo en base64 ─────────────────────────────────────────────
_LOGO_B64 = ""
_logo_path = os.path.join(os.path.dirname(__file__), "logo_k.png")
if os.path.exists(_logo_path):
    with open(_logo_path, "rb") as f:
        _LOGO_B64 = base64.b64encode(f.read()).decode()


def _logo_img(height: int = 60) -> str:
    if _LOGO_B64:
        return f'<img src="data:image/png;base64,{_LOGO_B64}" style="height:{height}px" />'
    return ""


_CSS_A4 = """
@page { size: A4; margin: 1.2cm 1.5cm; }
body { font-family: Helvetica, Arial, sans-serif; font-size: 10pt; color: #1e293b; line-height: 1.4; margin: 0; padding: 0; }
.header-bar { background: #E53E2E; height: 6px; margin-bottom: 20px; }
.header-table { width: 100%; margin-bottom: 15px; }
.header-table td { vertical-align: top; padding: 0; }
.company-name { font-size: 22pt; font-weight: bold; color: #E53E2E; margin: 0; letter-spacing: 1px; }
.company-sub { font-size: 9pt; color: #64748b; margin-top: 2px; }
.company-info { font-size: 8pt; color: #64748b; line-height: 1.6; }
.doc-title { font-size: 24pt; font-weight: bold; color: #E53E2E; text-align: center; margin: 20px 0 5px 0; letter-spacing: 6px; }
.doc-meta { text-align: center; font-size: 10pt; color: #475569; margin-bottom: 20px; }
.doc-meta b { color: #1e293b; }
.sep-line { border: none; border-top: 2px solid #E53E2E; margin: 15px 0; }
.sep-light { border: none; border-top: 1px solid #e2e8f0; margin: 12px 0; }
.info-grid { width: 100%; margin-bottom: 18px; border-collapse: collapse; }
.info-grid td { vertical-align: top; padding: 0; width: 50%; }
.info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 12px 14px; }
.info-box-left { margin-right: 8px; }
.info-box-right { margin-left: 8px; }
.info-label { font-size: 7pt; font-weight: bold; color: #E53E2E; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 6px; }
.info-row { font-size: 9pt; color: #334155; margin-bottom: 3px; }
.info-row b { color: #1e293b; }
.section-title { font-size: 8pt; font-weight: bold; color: #E53E2E; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px; }
.repair-table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
.repair-table th { background: #1e293b; color: white; font-size: 8pt; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; padding: 8px 12px; text-align: left; }
.repair-table th.right { text-align: right; }
.repair-table td { padding: 9px 12px; font-size: 9.5pt; border-bottom: 1px solid #e2e8f0; }
.repair-table tr.alt td { background: #f8fafc; }
.repair-table td.right { text-align: right; }
.totals-table { width: 100%; border-collapse: collapse; margin-top: 0; }
.totals-table td { padding: 6px 12px; font-size: 9.5pt; }
.totals-table td.label { text-align: right; color: #64748b; width: 70%; }
.totals-table td.value { text-align: right; font-weight: bold; color: #1e293b; width: 30%; }
.totals-table tr.sep td { border-top: 1px solid #cbd5e1; }
.totals-table tr.total td { background: #E53E2E; color: white; font-size: 12pt; font-weight: bold; padding: 10px 12px; }
.totals-table tr.total td.label { color: rgba(255,255,255,0.85); }
.totals-table tr.reste td { background: #1e293b; color: white; font-size: 11pt; font-weight: bold; padding: 9px 12px; }
.totals-table tr.reste td.label { color: rgba(255,255,255,0.8); }
.totals-table tr.acompte td { color: #16a34a; font-style: italic; }
.conditions { font-size: 8pt; color: #94a3b8; line-height: 1.5; margin-top: 25px; }
.footer-bar { background: #f1f5f9; padding: 10px 14px; margin-top: 25px; font-size: 7.5pt; color: #64748b; text-align: center; line-height: 1.6; border-top: 2px solid #E53E2E; }
.signature-area { margin-top: 30px; width: 100%; }
.signature-area td { vertical-align: top; padding: 0; }
.sig-box { border: 1px dashed #cbd5e1; height: 70px; padding: 8px; font-size: 8pt; color: #94a3b8; }
.qr-cell { text-align: right; width: 100px; }
.paye-stamp { color: #16a34a; font-size: 28pt; font-weight: bold; text-align: center; border: 4px solid #16a34a; padding: 6px 18px; display: inline-block; opacity: 0.7; letter-spacing: 4px; margin: 10px auto; }
"""


def _devis_a4_html(t: dict) -> str:
    code = t.get("ticket_code", "")
    appareil = t.get("modele_autre") or f"{t.get('marque', '')} {t.get('modele', '')}".strip()
    categorie = t.get("categorie", "")
    panne = t.get("panne_detail") or t.get("panne", "")
    adresse = _get_config("adresse", "79 Place Saint Léger, 73000 Chambéry")
    tel_boutique = _get_config("tel_boutique", "04 79 60 89 22")
    tva_rate = float(_get_config("tva", "20"))
    client_nom = f"{t.get('client_prenom', '')} {t.get('client_nom', '')}".strip()
    client_tel = t.get("client_tel", "")
    client_email = t.get("client_email", "")
    client_societe = t.get("client_societe", "")
    repair_lines = _parse_repair_lines(t)
    subtotal = sum(r["prix"] for r in repair_lines)
    reduction = _calc_reduction(t, subtotal)
    total_ttc = max(0, subtotal - reduction)
    tva_amount = round(total_ttc * tva_rate / (100 + tva_rate), 2)
    total_ht = round(total_ttc - tva_amount, 2)
    acompte = float(t.get("acompte") or 0)
    reste = total_ttc - acompte
    date_depot = _fd(t.get("date_depot"))
    date_recup = t.get("date_recuperation") or ""
    qr = _qr_url(code)
    rows_html = ""
    for i, r in enumerate(repair_lines):
        alt = ' class="alt"' if i % 2 == 1 else ""
        rows_html += f'<tr{alt}><td>{r["label"]}</td><td class="right">{_fp(r["prix"])} &euro;</td></tr>\n'
    if not repair_lines:
        rows_html = '<tr><td colspan="2" style="text-align:center;color:#94a3b8;padding:20px">Aucune ligne de réparation</td></tr>'
    totals_html = f'<tr><td class="label">Sous-total TTC</td><td class="value">{_fp(subtotal)} &euro;</td></tr>'
    if reduction > 0:
        totals_html += f'<tr><td class="label">Réduction</td><td class="value" style="color:#E53E2E">-{_fp(reduction)} &euro;</td></tr>'
    totals_html += f'<tr class="sep"><td class="label">Total HT</td><td class="value">{_fp(total_ht)} &euro;</td></tr>'
    totals_html += f'<tr><td class="label">TVA ({_fp(tva_rate).replace(",00", "")}%)</td><td class="value">{_fp(tva_amount)} &euro;</td></tr>'
    totals_html += f'<tr class="total"><td class="label">TOTAL TTC</td><td class="value">{_fp(total_ttc)} &euro;</td></tr>'
    if acompte > 0:
        totals_html += f'<tr class="acompte"><td class="label">Acompte versé</td><td class="value">-{_fp(acompte)} &euro;</td></tr>'
        totals_html += f'<tr class="reste"><td class="label">RESTE À PAYER</td><td class="value">{_fp(reste)} &euro;</td></tr>'
    societe_html = f'<div class="info-row"><b>{client_societe}</b></div>' if client_societe else ""
    recup_html = f'<div class="info-row">Récupération prévue : <b>{date_recup}</b></div>' if date_recup else ""
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{_CSS_A4}</style></head><body>
<div class="header-bar"></div>
<table class="header-table"><tr>
<td style="width:80px">{_logo_img(55)}</td>
<td style="padding-left:12px"><div class="company-name">KLIKPHONE</div><div class="company-sub">Spécialiste réparation téléphonie</div></td>
<td style="text-align:right"><div class="company-info">{adresse}<br>Tél : {tel_boutique}<br>www.klikphone.com<br><b>SIRET : 81396114100013</b><br><b>TVA : FR03813961141</b></div></td>
</tr></table>
<hr class="sep-line">
<div class="doc-title">D E V I S</div>
<div class="doc-meta">N° <b>{code}</b> &nbsp;&mdash;&nbsp; Date : <b>{date_depot}</b></div>
<hr class="sep-light">
<table class="info-grid"><tr>
<td><div class="info-box info-box-left"><div class="info-label">Client</div>{societe_html}<div class="info-row"><b>{client_nom}</b></div><div class="info-row">Tél : {client_tel}</div>{"<div class='info-row'>Email : " + client_email + "</div>" if client_email else ""}</div></td>
<td><div class="info-box info-box-right"><div class="info-label">Appareil</div><div class="info-row"><b>{appareil}</b></div>{"<div class='info-row'>Catégorie : " + categorie + "</div>" if categorie else ""}<div class="info-row">Panne : {panne}</div>{recup_html}</div></td>
</tr></table>
<div class="section-title">Détail des réparations</div>
<table class="repair-table"><tr><th>Description</th><th class="right" style="width:120px">Prix TTC</th></tr>{rows_html}</table>
<table class="totals-table">{totals_html}</table>
<table class="signature-area"><tr>
<td style="width:65%"><div class="conditions"><b>Conditions :</b><br>Ce devis est valable 30 jours à compter de sa date d'émission.<br>Toute réparation acceptée engage le client au paiement du montant indiqué.<br>Les pièces remplacées restent la propriété de Klikphone sauf demande contraire.</div><div style="margin-top:20px"><div style="font-size:8pt;color:#64748b;margin-bottom:4px">Signature du client (bon pour accord) :</div><div class="sig-box"></div></div></td>
<td class="qr-cell"><div style="text-align:right"><img src="{qr}" style="width:90px;height:90px" /><div style="font-size:7pt;color:#94a3b8;margin-top:3px">Suivi en ligne</div></div></td>
</tr></table>
<div class="footer-bar"><b>Klikphone</b> &mdash; {adresse}<br>SIRET : 81396114100013 &nbsp;|&nbsp; TVA Intra. : FR03813961141 &nbsp;|&nbsp; Tél : {tel_boutique} &nbsp;|&nbsp; www.klikphone.com</div>
</body></html>"""


def _recu_a4_html(t: dict) -> str:
    code = t.get("ticket_code", "")
    appareil = t.get("modele_autre") or f"{t.get('marque', '')} {t.get('modele', '')}".strip()
    categorie = t.get("categorie", "")
    panne = t.get("panne_detail") or t.get("panne", "")
    adresse = _get_config("adresse", "79 Place Saint Léger, 73000 Chambéry")
    tel_boutique = _get_config("tel_boutique", "04 79 60 89 22")
    tva_rate = float(_get_config("tva", "20"))
    client_nom = f"{t.get('client_prenom', '')} {t.get('client_nom', '')}".strip()
    client_tel = t.get("client_tel", "")
    client_email = t.get("client_email", "")
    client_societe = t.get("client_societe", "")
    repair_lines = _parse_repair_lines(t)
    subtotal = sum(r["prix"] for r in repair_lines)
    reduction = _calc_reduction(t, subtotal)
    total_ttc = max(0, subtotal - reduction)
    tva_amount = round(total_ttc * tva_rate / (100 + tva_rate), 2)
    total_ht = round(total_ttc - tva_amount, 2)
    acompte = float(t.get("acompte") or 0)
    reste = total_ttc - acompte
    is_paid = reste <= 0
    date_depot = _fd(t.get("date_depot"))
    date_now = datetime.now().strftime("%d/%m/%Y")
    qr = _qr_url(code)
    rows_html = ""
    for i, r in enumerate(repair_lines):
        alt = ' class="alt"' if i % 2 == 1 else ""
        rows_html += f'<tr{alt}><td>{r["label"]}</td><td class="right">{_fp(r["prix"])} &euro;</td></tr>\n'
    if not repair_lines:
        rows_html = '<tr><td colspan="2" style="text-align:center;color:#94a3b8;padding:20px">Aucune ligne</td></tr>'
    totals_html = f'<tr><td class="label">Sous-total TTC</td><td class="value">{_fp(subtotal)} &euro;</td></tr>'
    if reduction > 0:
        totals_html += f'<tr><td class="label">Réduction</td><td class="value" style="color:#E53E2E">-{_fp(reduction)} &euro;</td></tr>'
    totals_html += f'<tr class="sep"><td class="label">Total HT</td><td class="value">{_fp(total_ht)} &euro;</td></tr>'
    totals_html += f'<tr><td class="label">TVA ({_fp(tva_rate).replace(",00", "")}%)</td><td class="value">{_fp(tva_amount)} &euro;</td></tr>'
    totals_html += f'<tr class="total"><td class="label">TOTAL TTC</td><td class="value">{_fp(total_ttc)} &euro;</td></tr>'
    if acompte > 0:
        totals_html += f'<tr class="acompte"><td class="label">Acompte versé</td><td class="value">-{_fp(acompte)} &euro;</td></tr>'
    if reste > 0:
        totals_html += f'<tr class="reste"><td class="label">RESTE À PAYER</td><td class="value">{_fp(reste)} &euro;</td></tr>'
    paye_html = '<div style="text-align:center;margin:15px 0"><div class="paye-stamp">PAYÉ</div></div>' if is_paid else ""
    societe_html = f'<div class="info-row"><b>{client_societe}</b></div>' if client_societe else ""
    fidelite_html = ""
    try:
        active = _get_config("fidelite_active", "1")
        if active == "1" and t.get("client_id"):
            with get_cursor() as cur:
                cur.execute("SELECT points_fidelite FROM clients WHERE id = %s", (t["client_id"],))
                row = cur.fetchone()
            if row:
                pts = int(row.get("points_fidelite") or 0)
                fidelite_html = f'<div style="background:#fefce8;border:1px solid #fde68a;border-radius:4px;padding:10px 14px;margin-top:15px"><div style="font-size:8pt;font-weight:bold;color:#a16207;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px">Programme Fidélité</div><div style="font-size:9pt;color:#78350f">Vos points : <b>{pts} pts</b></div></div>'
    except Exception:
        pass
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{_CSS_A4}</style></head><body>
<div class="header-bar"></div>
<table class="header-table"><tr>
<td style="width:80px">{_logo_img(55)}</td>
<td style="padding-left:12px"><div class="company-name">KLIKPHONE</div><div class="company-sub">Spécialiste réparation téléphonie</div></td>
<td style="text-align:right"><div class="company-info">{adresse}<br>Tél : {tel_boutique}<br>www.klikphone.com<br><b>SIRET : 81396114100013</b><br><b>TVA : FR03813961141</b></div></td>
</tr></table>
<hr class="sep-line">
<div class="doc-title">REÇU DE PAIEMENT</div>
<div class="doc-meta">N° <b>{code}</b> &nbsp;&mdash;&nbsp; Date : <b>{date_now}</b> &nbsp;&mdash;&nbsp; Dépôt : {date_depot}</div>
{paye_html}
<hr class="sep-light">
<table class="info-grid"><tr>
<td><div class="info-box info-box-left"><div class="info-label">Client</div>{societe_html}<div class="info-row"><b>{client_nom}</b></div><div class="info-row">Tél : {client_tel}</div>{"<div class='info-row'>Email : " + client_email + "</div>" if client_email else ""}</div></td>
<td><div class="info-box info-box-right"><div class="info-label">Appareil</div><div class="info-row"><b>{appareil}</b></div>{"<div class='info-row'>Catégorie : " + categorie + "</div>" if categorie else ""}<div class="info-row">Panne : {panne}</div></div></td>
</tr></table>
<div class="section-title">Détail des prestations</div>
<table class="repair-table"><tr><th>Description</th><th class="right" style="width:120px">Prix TTC</th></tr>{rows_html}</table>
<table class="totals-table">{totals_html}</table>
{fidelite_html}
<table class="signature-area"><tr>
<td style="width:65%"><div class="conditions"><b>Conditions :</b><br>Garantie pièces et main d'oeuvre : 6 mois à compter de la date de réparation.<br>La garantie ne couvre pas les dommages causés par l'usure, les chocs ou l'oxydation.<br>Les pièces remplacées restent la propriété de Klikphone sauf demande contraire.</div></td>
<td class="qr-cell"><div style="text-align:right"><img src="{qr}" style="width:90px;height:90px" /><div style="font-size:7pt;color:#94a3b8;margin-top:3px">Suivi en ligne</div></div></td>
</tr></table>
<div class="footer-bar"><b>Klikphone</b> &mdash; {adresse}<br>SIRET : 81396114100013 &nbsp;|&nbsp; TVA Intra. : FR03813961141 &nbsp;|&nbsp; Tél : {tel_boutique} &nbsp;|&nbsp; www.klikphone.com</div>
</body></html>"""


def _build_pdf(t: dict, doc_type: str) -> bytes:
    """Construit un PDF A4 professionnel avec fpdf2."""
    from fpdf import FPDF
    import tempfile
    import urllib.request

    # ── Palette ──
    BRAND = (124, 58, 237)       # Violet brand
    BRAND_DARK = (91, 33, 182)   # Violet dark
    DARK = (15, 23, 42)          # slate-900
    MID = (51, 65, 85)           # slate-700
    GRAY = (100, 116, 139)       # slate-500
    LGRAY = (148, 163, 184)      # slate-400
    BORDER = (226, 232, 240)     # slate-200
    LIGHT = (248, 250, 252)      # slate-50
    WHITE = (255, 255, 255)
    GREEN = (5, 150, 105)        # emerald-600
    RED_ACCENT = (239, 68, 68)   # red-500

    # ── Data ──
    code = t.get("ticket_code", "")
    appareil = t.get("modele_autre") or f"{t.get('marque', '')} {t.get('modele', '')}".strip()
    categorie = t.get("categorie", "")
    panne = t.get("panne_detail") or t.get("panne", "")
    adresse = _get_config("adresse", "79 Place Saint Léger, 73000 Chambéry")
    tel_boutique = _get_config("tel_boutique", "04 79 60 89 22")
    tva_rate = float(_get_config("tva", "20"))
    client_nom = f"{t.get('client_prenom', '')} {t.get('client_nom', '')}".strip()
    client_tel = t.get("client_tel", "")
    client_email = t.get("client_email", "")
    client_societe = t.get("client_societe", "")
    repair_lines = _parse_repair_lines(t)
    subtotal = sum(r["prix"] for r in repair_lines)
    reduction = _calc_reduction(t, subtotal)
    total_ttc = max(0, subtotal - reduction)
    tva_amount = round(total_ttc * tva_rate / (100 + tva_rate), 2)
    total_ht = round(total_ttc - tva_amount, 2)
    acompte = float(t.get("acompte") or 0)
    reste = total_ttc - acompte
    is_paid = reste <= 0
    date_depot = _fd(t.get("date_depot"))
    date_now = datetime.now().strftime("%d/%m/%Y")
    is_devis = doc_type == "devis"
    euro = " EUR"

    pdf = FPDF()
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=20)
    LM = pdf.l_margin
    RM = pdf.r_margin
    pw = pdf.w - LM - RM

    # ══════════════════════════════════════════════════════════════
    # HEADER — Left: violet band with logo+name | Right: company info
    # ══════════════════════════════════════════════════════════════

    # Full-width violet header band
    hdr_h = 32
    pdf.set_fill_color(*BRAND)
    pdf.rect(0, 0, pdf.w, hdr_h, "F")
    # Subtle darker accent at very top
    pdf.set_fill_color(*BRAND_DARK)
    pdf.rect(0, 0, pdf.w, 3, "F")

    # Logo (white area inset)
    logo_y = 6
    if os.path.exists(_logo_path):
        try:
            pdf.image(_logo_path, x=LM + 1, y=logo_y, h=20)
        except Exception:
            pass

    # Company name in header
    pdf.set_xy(LM + 26, logo_y + 2)
    pdf.set_font("Helvetica", "B", 22)
    pdf.set_text_color(*WHITE)
    pdf.cell(0, 9, "KLIKPHONE")
    pdf.set_xy(LM + 26, logo_y + 12)
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(0, 4, "Expert en réparation de smartphones et tablettes")

    # Company info right side (white text on violet)
    info_r = [adresse, f"Tél : {tel_boutique}", "www.klikphone.com"]
    pdf.set_font("Helvetica", "", 7.5)
    for i, line in enumerate(info_r):
        pdf.set_xy(pdf.w - RM - 75, logo_y + 2 + i * 3.8)
        pdf.set_text_color(230, 220, 255)
        pdf.cell(75, 3.5, line, align="R")
    # SIRET / TVA bold
    pdf.set_font("Helvetica", "B", 7.5)
    pdf.set_text_color(*WHITE)
    pdf.set_xy(pdf.w - RM - 75, logo_y + 2 + len(info_r) * 3.8)
    pdf.cell(75, 3.5, "SIRET 81396114100013 | TVA FR03813961141", align="R")

    pdf.set_y(hdr_h + 5)

    # ══════════════════════════════════════════════════════════════
    # DOCUMENT TITLE + META
    # ══════════════════════════════════════════════════════════════

    title = "DEVIS" if is_devis else "RECU DE PAIEMENT"
    pdf.set_font("Helvetica", "B", 22)
    pdf.set_text_color(*DARK)
    pdf.cell(pw, 10, title, align="C", new_x="LMARGIN", new_y="NEXT")

    # Meta line with light bg pill
    if is_devis:
        meta = f"N. {code}  |  Date : {date_depot}"
    else:
        meta = f"N. {code}  |  Date : {date_now}  |  Dépôt : {date_depot}"
    pdf.set_font("Helvetica", "", 9)
    meta_w = pdf.get_string_width(meta) + 16
    meta_x = (pdf.w - meta_w) / 2
    meta_y = pdf.get_y()
    pdf.set_fill_color(*LIGHT)
    pdf.set_draw_color(*BORDER)
    pdf.rect(meta_x, meta_y, meta_w, 7, "DF")
    pdf.set_xy(meta_x, meta_y)
    pdf.set_text_color(*MID)
    pdf.cell(meta_w, 7, meta, align="C")
    pdf.set_y(meta_y + 10)

    # PAYE stamp for recu
    if not is_devis and is_paid:
        stamp_w = 50
        stamp_h = 13
        stamp_x = (pdf.w - stamp_w) / 2
        stamp_y = pdf.get_y()
        pdf.set_fill_color(236, 253, 245)
        pdf.set_draw_color(*GREEN)
        pdf.set_line_width(0.8)
        pdf.rect(stamp_x, stamp_y, stamp_w, stamp_h, "DF")
        pdf.set_xy(stamp_x, stamp_y + 1)
        pdf.set_font("Helvetica", "B", 18)
        pdf.set_text_color(*GREEN)
        pdf.cell(stamp_w, 11, "PAYÉ", align="C")
        pdf.set_line_width(0.2)
        pdf.set_y(stamp_y + stamp_h + 3)

    # ══════════════════════════════════════════════════════════════
    # CLIENT / APPAREIL — two columns with left violet accent
    # ══════════════════════════════════════════════════════════════

    col_w = (pw - 8) / 2
    col_y = pdf.get_y()

    def _card(x, y, w, label, rows):
        """Draw an info card with violet left accent."""
        card_h = 8 + len(rows) * 5 + 3
        # White card bg + border
        pdf.set_fill_color(*WHITE)
        pdf.set_draw_color(*BORDER)
        pdf.rect(x, y, w, card_h, "DF")
        # Violet left accent bar
        pdf.set_fill_color(*BRAND)
        pdf.rect(x, y, 2.5, card_h, "F")
        # Label
        pdf.set_xy(x + 7, y + 3)
        pdf.set_font("Helvetica", "B", 6.5)
        pdf.set_text_color(*BRAND)
        pdf.cell(w - 12, 4, label.upper())
        # Rows
        for i, (txt, is_bold) in enumerate(rows):
            pdf.set_xy(x + 7, y + 8 + i * 5)
            pdf.set_font("Helvetica", "B" if is_bold else "", 9)
            pdf.set_text_color(*DARK if is_bold else MID)
            pdf.cell(w - 12, 4.5, txt)
        return card_h

    cl = []
    if client_societe:
        cl.append((client_societe, True))
    cl.append((client_nom, True))
    cl.append((f"Tél : {client_tel}", False))
    if client_email:
        cl.append((f"Email : {client_email}", False))

    dl = [(appareil, True)]
    if categorie:
        dl.append((f"Catégorie : {categorie}", False))
    panne_txt = panne if len(panne) <= 55 else panne[:52] + "..."
    dl.append((f"Panne : {panne_txt}", False))

    h1 = _card(LM, col_y, col_w, "Client", cl)
    h2 = _card(LM + col_w + 8, col_y, col_w, "Appareil", dl)
    pdf.set_y(col_y + max(h1, h2) + 5)

    # ══════════════════════════════════════════════════════════════
    # REPAIR TABLE
    # ══════════════════════════════════════════════════════════════

    # Section label
    section = "DÉTAIL DES RÉPARATIONS" if is_devis else "DÉTAIL DES PRESTATIONS"
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_text_color(*BRAND)
    pdf.cell(pw, 5, section, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    col_d = pw * 0.65
    col_p = pw * 0.35

    # Table header
    th_y = pdf.get_y()
    pdf.set_fill_color(*BRAND)
    pdf.set_text_color(*WHITE)
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(col_d, 9, "   Description", fill=True)
    pdf.cell(col_p, 9, "Montant TTC   ", align="R", fill=True, new_x="LMARGIN", new_y="NEXT")

    # Table rows
    if repair_lines:
        for i, r in enumerate(repair_lines):
            bg = LIGHT if i % 2 == 0 else WHITE
            pdf.set_fill_color(*bg)
            pdf.set_draw_color(*BORDER)
            row_y = pdf.get_y()
            pdf.set_text_color(*DARK)
            pdf.set_font("Helvetica", "", 9.5)
            pdf.cell(col_d, 9, f"   {r['label']}", fill=True)
            pdf.set_font("Helvetica", "B", 9.5)
            pdf.set_text_color(*MID)
            pdf.cell(col_p, 9, f"{_fp(r['prix'])}{euro}   ", align="R", fill=True, new_x="LMARGIN", new_y="NEXT")
            # Bottom border
            pdf.set_draw_color(*BORDER)
            pdf.line(LM, pdf.get_y(), LM + pw, pdf.get_y())
    else:
        pdf.set_fill_color(*LIGHT)
        pdf.set_text_color(*LGRAY)
        pdf.set_font("Helvetica", "I", 9)
        pdf.cell(pw, 12, "Aucune prestation", align="C", fill=True, new_x="LMARGIN", new_y="NEXT")

    # ══════════════════════════════════════════════════════════════
    # TOTALS — right-aligned block
    # ══════════════════════════════════════════════════════════════

    pdf.ln(4)
    # Totals area: shift to right side
    tot_x = LM + pw * 0.4
    tot_w = pw * 0.6
    tot_lbl = tot_w * 0.55
    tot_val = tot_w * 0.45

    def _trow(label, value, style="normal"):
        x = tot_x
        if style == "total":
            h = 11
            pdf.set_fill_color(*BRAND)
            pdf.rect(x, pdf.get_y(), tot_w, h, "F")
            pdf.set_xy(x + 4, pdf.get_y() + 0.5)
            pdf.set_font("Helvetica", "B", 11)
            pdf.set_text_color(*WHITE)
            pdf.cell(tot_lbl - 4, h - 1, label)
            pdf.set_font("Helvetica", "B", 12)
            pdf.cell(tot_val, h - 1, value, align="R", new_x="LMARGIN", new_y="NEXT")
        elif style == "reste":
            h = 10
            pdf.set_fill_color(*DARK)
            pdf.rect(x, pdf.get_y(), tot_w, h, "F")
            pdf.set_xy(x + 4, pdf.get_y() + 0.5)
            pdf.set_font("Helvetica", "B", 10)
            pdf.set_text_color(*WHITE)
            pdf.cell(tot_lbl - 4, h - 1, label)
            pdf.set_font("Helvetica", "B", 11)
            pdf.cell(tot_val, h - 1, value, align="R", new_x="LMARGIN", new_y="NEXT")
        elif style == "acompte":
            h = 7
            pdf.set_xy(x + 4, pdf.get_y())
            pdf.set_font("Helvetica", "I", 9)
            pdf.set_text_color(*GREEN)
            pdf.cell(tot_lbl - 4, h, label)
            pdf.set_font("Helvetica", "BI", 9)
            pdf.cell(tot_val, h, value, align="R", new_x="LMARGIN", new_y="NEXT")
        elif style == "reduction":
            h = 7
            pdf.set_xy(x + 4, pdf.get_y())
            pdf.set_font("Helvetica", "", 9)
            pdf.set_text_color(*RED_ACCENT)
            pdf.cell(tot_lbl - 4, h, label)
            pdf.set_font("Helvetica", "B", 9)
            pdf.cell(tot_val, h, value, align="R", new_x="LMARGIN", new_y="NEXT")
        else:
            h = 7
            pdf.set_xy(x + 4, pdf.get_y())
            pdf.set_font("Helvetica", "", 9)
            pdf.set_text_color(*GRAY)
            pdf.cell(tot_lbl - 4, h, label)
            pdf.set_font("Helvetica", "B", 9)
            pdf.set_text_color(*DARK)
            pdf.cell(tot_val, h, value, align="R", new_x="LMARGIN", new_y="NEXT")
            # Light bottom line
            pdf.set_draw_color(*BORDER)
            pdf.line(x, pdf.get_y(), x + tot_w, pdf.get_y())

    _trow("Sous-total TTC", f"{_fp(subtotal)}{euro}")
    if reduction > 0:
        _trow("Réduction", f"-{_fp(reduction)}{euro}", "reduction")
    _trow("Total HT", f"{_fp(total_ht)}{euro}")
    tva_pct = _fp(tva_rate).replace(",00", "")
    _trow(f"TVA ({tva_pct}%)", f"{_fp(tva_amount)}{euro}")
    pdf.ln(1)
    _trow("TOTAL TTC", f"{_fp(total_ttc)}{euro}", "total")
    if acompte > 0:
        _trow("Acompte versé", f"-{_fp(acompte)}{euro}", "acompte")
    if reste > 0:
        _trow("RESTE À PAYER", f"{_fp(reste)}{euro}", "reste")

    # ══════════════════════════════════════════════════════════════
    # FIDELITE (recu only)
    # ══════════════════════════════════════════════════════════════

    if not is_devis:
        try:
            active = _get_config("fidelite_active", "1")
            if active == "1" and t.get("client_id"):
                with get_cursor() as cur:
                    cur.execute("SELECT points_fidelite FROM clients WHERE id = %s", (t["client_id"],))
                    row = cur.fetchone()
                if row:
                    pts = int(row.get("points_fidelite") or 0)
                    pdf.ln(8)
                    fy = pdf.get_y()
                    pdf.set_fill_color(245, 243, 255)
                    pdf.set_draw_color(196, 181, 253)
                    pdf.rect(LM, fy, pw, 14, "DF")
                    pdf.set_fill_color(*BRAND)
                    pdf.rect(LM, fy, 2.5, 14, "F")
                    pdf.set_xy(LM + 7, fy + 2)
                    pdf.set_font("Helvetica", "B", 7)
                    pdf.set_text_color(*BRAND_DARK)
                    pdf.cell(40, 4, "PROGRAMME FIDÉLITÉ")
                    pdf.set_xy(LM + 7, fy + 7)
                    pdf.set_font("Helvetica", "", 9)
                    pdf.set_text_color(91, 33, 182)
                    pdf.cell(pw - 12, 4, f"Vos points : {pts} pts")
                    pdf.set_y(fy + 16)
        except Exception:
            pass

    # ══════════════════════════════════════════════════════════════
    # CONDITIONS + QR CODE + SIGNATURE
    # ══════════════════════════════════════════════════════════════

    pdf.ln(6)
    cond_y = pdf.get_y()

    # QR code (positioned first so conditions wrap around it)
    qr_ok = False
    try:
        qr_url = _qr_url(code)
        req = urllib.request.Request(qr_url)
        with urllib.request.urlopen(req, timeout=5) as resp:
            qr_data = resp.read()
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            tmp.write(qr_data)
            tmp_path = tmp.name
        qr_size = 28
        qr_x = pdf.w - RM - qr_size
        pdf.image(tmp_path, x=qr_x, y=cond_y, w=qr_size)
        os.unlink(tmp_path)
        pdf.set_xy(qr_x, cond_y + qr_size + 1)
        pdf.set_font("Helvetica", "", 6)
        pdf.set_text_color(*LGRAY)
        pdf.cell(qr_size, 3, "Suivi en ligne", align="C")
        qr_ok = True
    except Exception:
        pass

    cond_w = pw * 0.62 if qr_ok else pw * 0.8
    pdf.set_xy(LM, cond_y)
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_text_color(*DARK)
    pdf.cell(cond_w, 5, "Conditions", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 7.5)
    pdf.set_text_color(*GRAY)
    if is_devis:
        cond = "Ce devis est valable 30 jours à compter de sa date d'émission. Toute réparation acceptée engage le client au paiement du montant indiqué. Les pièces remplacées restent la propriété de Klikphone sauf demande contraire."
    else:
        cond = "Garantie pièces et main d'oeuvre : 6 mois à compter de la date de réparation. La garantie ne couvre pas les dommages causés par l'usure, les chocs ou l'oxydation. Les pièces remplacées restent la propriété de Klikphone sauf demande contraire."
    pdf.multi_cell(cond_w, 3.8, cond)

    # Signature box (devis only)
    if is_devis:
        pdf.ln(6)
        sig_y = pdf.get_y()
        pdf.set_font("Helvetica", "", 7.5)
        pdf.set_text_color(*GRAY)
        pdf.cell(cond_w, 4, "Signature du client (bon pour accord) :", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(1)
        box_y = pdf.get_y()
        pdf.set_draw_color(*BORDER)
        pdf.set_dash_pattern(dash=1.5, gap=1.5)
        pdf.rect(LM, box_y, pw * 0.42, 22, "D")
        pdf.set_dash_pattern()
        pdf.set_y(box_y + 24)

    # ══════════════════════════════════════════════════════════════
    # FOOTER — Violet band fixed at page bottom
    # ══════════════════════════════════════════════════════════════

    pdf.set_auto_page_break(auto=False)
    ft_h = 11
    footer_y = pdf.h - ft_h
    pdf.set_fill_color(*BRAND)
    pdf.rect(0, footer_y, pdf.w, ft_h, "F")
    pdf.set_fill_color(*BRAND_DARK)
    pdf.rect(0, footer_y + ft_h - 1.5, pdf.w, 1.5, "F")
    pdf.set_xy(LM, footer_y + 1)
    pdf.set_font("Helvetica", "B", 7)
    pdf.set_text_color(*WHITE)
    pdf.cell(pw, 4, f"Klikphone  -  {adresse}  -  {tel_boutique}", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 6.5)
    pdf.set_text_color(220, 210, 255)
    pdf.cell(pw, 3.5, "SIRET 81396114100013  |  TVA Intra. FR03813961141  |  www.klikphone.com", align="C")

    return bytes(pdf.output())


def generate_pdf(ticket_id: int, doc_type: str) -> tuple:
    """Génère un PDF A4 pour un ticket. Retourne (pdf_bytes, filename)."""
    t = _get_ticket_full(ticket_id)
    if not t:
        return None, None
    if doc_type not in ("devis", "recu"):
        return None, None
    pdf_bytes = _build_pdf(t, doc_type)
    code = t.get("ticket_code", "document")
    type_labels = {"devis": "Devis", "recu": "Recu"}
    filename = f"{type_labels.get(doc_type, 'Document')}-{code}.pdf"
    return pdf_bytes, filename


@router.get("/{ticket_id}/pdf/{doc_type}")
async def download_pdf(ticket_id: int, doc_type: str):
    """Télécharge le PDF A4 d'un devis ou reçu."""
    if doc_type not in ("devis", "recu"):
        raise HTTPException(400, "Type non supporté. Utilisez 'devis' ou 'recu'.")
    pdf_bytes, filename = generate_pdf(ticket_id, doc_type)
    if not pdf_bytes:
        raise HTTPException(404, "Ticket non trouvé ou erreur de génération PDF")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )
