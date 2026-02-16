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

def _retour_sav_banner(t: dict) -> str:
    """Génère un encadré rouge RETOUR SAV si applicable."""
    if not t.get("est_retour_sav"):
        return ""
    orig_code = ""
    if t.get("ticket_original_id"):
        try:
            with get_cursor() as cur:
                cur.execute("SELECT ticket_code FROM tickets WHERE id = %s", (t["ticket_original_id"],))
                row = cur.fetchone()
                if row:
                    orig_code = row["ticket_code"]
        except Exception:
            pass
    return f"""<div style="border:3px solid #DC2626;background:#FEF2F2;padding:8px 10px;margin:8px 0;text-align:center;">
  <div style="font-size:16px;font-weight:900;color:#DC2626;letter-spacing:2px;">RETOUR SAV</div>
  {f'<div style="font-size:12px;font-weight:700;color:#991B1B;margin-top:2px;">Ticket original : {orig_code}</div>' if orig_code else ''}
  <div style="font-size:10px;color:#991B1B;margin-top:2px;">Prise en charge garantie — 0,00 €</div>
</div>"""


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
{_retour_sav_banner(t)}

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
  {_retour_sav_banner(t)}

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



# ═══════════════════════════════════════════════════════════════
# A4 DOCUMENT — HTML/CSS professionnel (Devis & Reçu)
# ═══════════════════════════════════════════════════════════════

def _a4_document(t: dict, doc_type: str) -> str:
    """Generate professional A4 HTML document for devis or reçu."""
    is_devis = doc_type == "devis"

    # Colors per doc type
    if is_devis:
        gradient = "linear-gradient(90deg, #E8461E, #F59E0B)"
        accent = "#E8461E"
        accent_bg = "#FFF7ED"
        accent_border = "#FED7AA"
    else:
        gradient = "linear-gradient(90deg, #10B981, #06B6D4)"
        accent = "#10B981"
        accent_bg = "#ECFDF5"
        accent_border = "#A7F3D0"

    # Data extraction
    code = t.get("ticket_code", "")
    appareil = t.get("modele_autre") or f"{t.get('marque', '')} {t.get('modele', '')}".strip()
    categorie = t.get("categorie", "")
    panne = t.get("panne_detail") or t.get("panne", "")
    imei = t.get("imei", "")
    adresse = _get_config("adresse", "79 Place Saint Léger, 73000 Chambéry")
    tel_boutique = _get_config("tel_boutique", "04 79 60 89 22")
    tva_rate = float(_get_config("tva", "20"))
    client_nom = f"{t.get('client_prenom', '')} {t.get('client_nom', '')}".strip()
    client_tel = t.get("client_tel", "")
    client_email = t.get("client_email", "")
    client_societe = t.get("client_societe", "")
    technicien = t.get("technicien_assigne") or "Non assign\u00e9"
    type_ecran = t.get("type_ecran", "")

    repair_lines = _parse_repair_lines(t)
    if not is_devis and t.get("tarif_final") and len(repair_lines) > 0:
        repair_lines[0]["prix"] = float(t["tarif_final"])
    subtotal_ttc = sum(r["prix"] for r in repair_lines)
    reduction = _calc_reduction(t, subtotal_ttc)
    total_ttc = max(0, subtotal_ttc - reduction)
    tva_amount = round(total_ttc * tva_rate / (100 + tva_rate), 2)
    total_ht = round(total_ttc - tva_amount, 2)
    acompte = float(t.get("acompte") or 0)
    reste = total_ttc - acompte
    is_paid = reste <= 0

    date_depot = _fd(t.get("date_depot"))
    date_recup = t.get("date_recuperation") or "\u2014"
    date_doc = date_depot if is_devis else datetime.now().strftime("%d/%m/%Y")
    doc_title = "DEVIS" if is_devis else "RE\u00c7U"

    # Repair table rows
    repair_rows = ""
    for i, r in enumerate(repair_lines):
        alt = ' class="alt"' if i % 2 == 1 else ""
        ht = round(r["prix"] * 100 / (100 + tva_rate), 2)
        qb = ""
        if i == 0 and type_ecran:
            qb = f'<span class="qb">{type_ecran}</span>'
        repair_rows += f'<tr{alt}><td>{r["label"]}</td><td class="c">{qb}</td><td class="c">1</td><td class="r">{_fp(ht)} &euro;</td></tr>'
    if not repair_lines:
        repair_rows = '<tr><td colspan="4" style="text-align:center;padding:20px;color:#A1A1AA">Aucune prestation</td></tr>'

    # Totals
    subtotal_ht = round(subtotal_ttc * 100 / (100 + tva_rate), 2) if subtotal_ttc > 0 else 0
    tots = f'<div class="tr"><span>Sous-total HT</span><span class="v">{_fp(subtotal_ht)} &euro;</span></div>'
    if reduction > 0:
        red_pct = float(t.get("reduction_pourcentage") or 0)
        rl = f"R\u00e9duction ({red_pct:g}%)" if red_pct > 0 else "R\u00e9duction"
        red_ht = round(reduction * 100 / (100 + tva_rate), 2)
        tots += f'<div class="tr grn"><span>{rl}</span><span class="v">-{_fp(red_ht)} &euro;</span></div>'
    tots += f'<div class="tr"><span>Total HT</span><span class="v">{_fp(total_ht)} &euro;</span></div>'
    tots += f'<div class="tr"><span>TVA ({tva_rate:g}%)</span><span class="v">{_fp(tva_amount)} &euro;</span></div>'
    tots += f'<div class="tttc" style="background:{accent}"><span>Total TTC</span><span>{_fp(total_ttc)} &euro;</span></div>'
    if acompte > 0:
        tots += f'<div class="tr grn"><span>Acompte vers\u00e9</span><span class="v">-{_fp(acompte)} &euro;</span></div>'
    if reste > 0 or acompte > 0:
        tots += f'<div class="trap"><span>Reste \u00e0 payer</span><span>{_fp(max(0, reste))} &euro;</span></div>'

    # PAYE stamp
    paye = ""
    if not is_devis and is_paid:
        paye = '<div style="text-align:center;margin:12px 0"><div class="paye">PAY\u00c9</div></div>'

    # Fidelite
    fidel = ""
    if not is_devis:
        try:
            active = _get_config("fidelite_active", "1")
            if active == "1" and t.get("client_id"):
                with get_cursor() as cur:
                    cur.execute("SELECT points_fidelite FROM clients WHERE id = %s", (t["client_id"],))
                    row = cur.fetchone()
                if row:
                    pts = int(row.get("points_fidelite") or 0)
                    fidel = f'<div class="fidel"><span class="fl">Programme Fid\u00e9lit\u00e9</span><span class="fp">{pts} points</span></div>'
        except Exception:
            pass

    # Conditions
    if is_devis:
        cond_text = "Devis valable 30 jours. Klikphone ne peut \u00eatre tenu responsable de la perte de donn\u00e9es. Un acompte de 30% est demand\u00e9 \u00e0 la validation du devis."
    else:
        cond_text = "Garantie pi\u00e8ces et main d'oeuvre : 6 mois. Tout mat\u00e9riel non r\u00e9cup\u00e9r\u00e9 sous 3 mois sera consid\u00e9r\u00e9 comme abandonn\u00e9. Klikphone ne peut \u00eatre tenu responsable de la perte de donn\u00e9es."

    societe_row = f'<div class="nm">{client_societe}</div>' if client_societe else ""
    email_row = f"<br>Email : {client_email}" if client_email else ""
    imei_html = f'<div class="ai">IMEI : {imei}</div>' if imei else ""
    cat_str = f" &mdash; {categorie}" if categorie else ""

    # Build CSS (use .replace for dynamic values to avoid brace escaping)
    css = """
@page{size:A4;margin:0}*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;color:#18181B;font-size:11px;line-height:1.5}
.pg{width:210mm;min-height:297mm;margin:0 auto;position:relative}
.tb{height:5px;background:__GRADIENT__}
.ct{padding:20px 28px 80px}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-top:16px}
.hl{display:flex;align-items:center;gap:12px}
.lk{width:56px;height:56px;background:#DC2626;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:28px;font-weight:700;flex-shrink:0}
.cn{font-size:22px;font-weight:700;color:#18181B}.cs{font-size:10px;color:#71717A;margin-top:2px}
.hr{text-align:right}.dt{font-size:24px;font-weight:700;color:__ACCENT__}
.dn{font-size:12px;color:#52525B;margin-top:4px}.dd{font-size:11px;color:#71717A}
.bl{font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#A1A1AA;margin-bottom:6px;font-weight:500}
.crd{background:#FAFAFA;border:1px solid #F4F4F5;border-radius:10px;padding:14px}
.crd .nm{font-size:13px;font-weight:700;color:#18181B;margin-bottom:3px}
.crd .dl{font-size:11px;color:#71717A;line-height:1.6}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
.g4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:16px}
.mc{background:#FAFAFA;border:1px solid #F4F4F5;border-radius:8px;padding:10px}
.mc .ml{font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#A1A1AA;margin-bottom:3px}
.mc .mv{font-size:11px;font-weight:700;color:#18181B}
.apc{background:__ACCENT_BG__;border:1px solid __ACCENT_BD__;border-radius:10px;padding:14px 16px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center}
.apc .am{font-size:14px;font-weight:700;color:#18181B}.apc .ap{font-size:11px;color:#52525B;margin-top:2px}
.apc .ai{font-family:'Courier New',monospace;font-size:11px;color:#71717A}
.tw{border-radius:10px;overflow:hidden;margin-bottom:0}
table.rt{width:100%;border-collapse:collapse}
.rt thead th{background:#18181B;color:#fff;font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:.5px;padding:10px 14px;text-align:left}
.rt thead th:last-child{text-align:right}.rt thead th.c{text-align:center}
.rt tbody td{padding:10px 14px;font-size:11px;border-bottom:1px solid #F4F4F5}
.rt tbody tr.alt td{background:#FAFAFA}.rt .c{text-align:center}.rt .r{text-align:right}
.qb{display:inline-block;background:#EDE9FE;color:#7C3AED;font-size:9px;font-weight:700;padding:2px 8px;border-radius:4px}
.tots{margin-bottom:20px}
.tr{display:flex;justify-content:space-between;padding:7px 14px;font-size:11px;color:#52525B;border-bottom:1px solid #F4F4F5}
.tr .v{font-weight:700;color:#18181B}.tr.grn,.tr.grn .v{color:#059669}
.tttc{display:flex;justify-content:space-between;padding:12px 14px;color:#fff;font-size:18px;font-weight:700}
.trap{display:flex;justify-content:space-between;padding:10px 14px;background:#18181B;color:#fff;font-size:16px;font-weight:700;border-radius:0 0 10px 10px}
.paye{display:inline-block;color:#059669;font-size:32px;font-weight:700;border:4px solid #059669;padding:4px 24px;letter-spacing:6px;opacity:.6;transform:rotate(-5deg)}
.fidel{background:#F5F3FF;border:1px solid #DDD6FE;border-radius:8px;padding:10px 14px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center}
.fl{font-size:10px;font-weight:700;color:#7C3AED;text-transform:uppercase;letter-spacing:1px}
.fp{font-size:13px;font-weight:700;color:#5B21B6}
.cond{background:#FAFAFA;border:1px solid #F4F4F5;border-radius:10px;padding:14px;margin-bottom:20px}
.cond .cdt{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#A1A1AA;margin-bottom:6px;font-weight:500}
.cond .cdx{font-size:9px;color:#71717A;line-height:1.6}
.ftr{background:#18181B;padding:12px 28px;display:flex;justify-content:space-between;align-items:center;position:absolute;bottom:0;left:0;right:0}
.ftr span{font-size:9px;color:#71717A}
@media print{body *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}}
""".replace("__GRADIENT__", gradient).replace("__ACCENT_BG__", accent_bg).replace("__ACCENT_BD__", accent_border).replace("__ACCENT__", accent)

    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<style>{css}</style></head><body>
<div class="pg"><div class="tb"></div><div class="ct">
<div class="hdr"><div class="hl"><div class="lk">K</div><div><div class="cn">KLIKPHONE</div>
<div class="cs">Sp\u00e9cialiste r\u00e9paration Apple &amp; Multimarque</div></div></div>
<div class="hr"><div class="dt">{doc_title}</div><div class="dn">N\u00b0 {code}</div><div class="dd">Date : {date_doc}</div></div></div>
{paye}
<div class="g2"><div><div class="bl">\u00c9METTEUR</div><div class="crd"><div class="nm">KLIKPHONE</div>
<div class="dl">{adresse}<br>T\u00e9l : {tel_boutique}<br>SIRET : 81396114100013</div></div></div>
<div><div class="bl">CLIENT</div><div class="crd">{societe_row}<div class="nm">{client_nom}</div>
<div class="dl">T\u00e9l : {client_tel}{email_row}</div></div></div></div>
<div class="apc"><div><div class="am">{appareil}{cat_str}</div><div class="ap">{panne}</div></div>{imei_html}</div>
<div class="tw"><table class="rt"><thead><tr><th>D\u00e9signation</th><th class="c" style="width:90px">Qualit\u00e9</th>
<th class="c" style="width:50px">Qt\u00e9</th><th class="r" style="width:100px">Prix HT</th></tr></thead>
<tbody>{repair_rows}</tbody></table></div>
<div class="tots">{tots}</div>
{fidel}
<div class="g4"><div class="mc"><div class="ml">Ticket</div><div class="mv">{code}</div></div>
<div class="mc"><div class="ml">Technicien</div><div class="mv">{technicien}</div></div>
<div class="mc"><div class="ml">Date d\u00e9p\u00f4t</div><div class="mv">{date_depot}</div></div>
<div class="mc"><div class="ml">Date r\u00e9cup.</div><div class="mv">{date_recup}</div></div></div>
<div class="cond"><div class="cdt">Conditions</div><div class="cdx">{cond_text}</div></div>
</div>
<div class="ftr"><span>SIRET : 81396114100013 &middot; TVA non applicable, art. 293B du CGI</span>
<span>Propuls\u00e9 par TkS&infin;26 &mdash; une solution Klik&amp;Dev</span></div>
</div></body></html>"""
    return html


def _devis_a4_html(t: dict) -> str:
    return _a4_document(t, "devis")


def _recu_a4_html(t: dict) -> str:
    return _a4_document(t, "recu")


def _build_pdf(t: dict, doc_type: str) -> bytes:
    """Construit un PDF A4 professionnel avec fpdf2 — design DM Sans."""
    from fpdf import FPDF
    import tempfile
    import urllib.request

    is_devis = doc_type == "devis"

    # Palette
    if is_devis:
        ACCENT = (232, 70, 30)       # #E8461E orange
        ACCENT2 = (245, 158, 11)     # #F59E0B
        ACCENT_BG = (255, 247, 237)  # #FFF7ED
        ACCENT_BD = (254, 215, 170)  # #FED7AA
    else:
        ACCENT = (16, 185, 129)      # #10B981 green
        ACCENT2 = (6, 182, 212)      # #06B6D4
        ACCENT_BG = (236, 253, 245)  # #ECFDF5
        ACCENT_BD = (167, 243, 208)  # #A7F3D0

    DARK = (24, 24, 27)
    TEXT = (24, 24, 27)
    TEXT_MID = (82, 82, 91)
    TEXT_GRAY = (113, 113, 122)
    TEXT_LIGHT = (161, 161, 170)
    CARD_BG = (250, 250, 250)
    CARD_BD = (244, 244, 245)
    WHITE = (255, 255, 255)
    GREEN = (5, 150, 105)
    VIOLET = (124, 58, 237)
    VIOLET_BG = (237, 233, 254)
    RED_LOGO = (220, 38, 38)

    euro = " EUR"

    # Data
    code = t.get("ticket_code", "")
    appareil = t.get("modele_autre") or f"{t.get('marque', '')} {t.get('modele', '')}".strip()
    categorie = t.get("categorie", "")
    panne = t.get("panne_detail") or t.get("panne", "")
    if len(panne) > 60:
        panne = panne[:57] + "..."
    imei = t.get("imei", "")
    adresse = _get_config("adresse", "79 Place Saint Leger, 73000 Chambery")
    tel_boutique = _get_config("tel_boutique", "04 79 60 89 22")
    tva_rate = float(_get_config("tva", "20"))
    client_nom = f"{t.get('client_prenom', '')} {t.get('client_nom', '')}".strip()
    client_tel = t.get("client_tel", "")
    client_email = t.get("client_email", "")
    client_societe = t.get("client_societe", "")
    technicien = t.get("technicien_assigne") or "Non assigne"
    type_ecran = t.get("type_ecran", "")

    repair_lines = _parse_repair_lines(t)
    if not is_devis and t.get("tarif_final") and len(repair_lines) > 0:
        repair_lines[0]["prix"] = float(t["tarif_final"])
    subtotal_ttc = sum(r["prix"] for r in repair_lines)
    reduction = _calc_reduction(t, subtotal_ttc)
    total_ttc = max(0, subtotal_ttc - reduction)
    tva_amount = round(total_ttc * tva_rate / (100 + tva_rate), 2)
    total_ht = round(total_ttc - tva_amount, 2)
    acompte = float(t.get("acompte") or 0)
    reste = total_ttc - acompte
    is_paid = reste <= 0

    date_depot = _fd(t.get("date_depot"))
    date_recup = t.get("date_recuperation") or "-"
    date_doc = date_depot if is_devis else datetime.now().strftime("%d/%m/%Y")

    pdf = FPDF()
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=20)
    LM = pdf.l_margin
    RM = pdf.r_margin
    pw = pdf.w - LM - RM

    # ── 1. TOP ACCENT BAR ──
    pdf.set_fill_color(*ACCENT)
    pdf.rect(0, 0, pdf.w, 2.5, "F")
    # Second half gradient sim
    pdf.set_fill_color(*ACCENT2)
    pdf.rect(pdf.w * 0.5, 0, pdf.w * 0.5, 2.5, "F")

    # ── 2. HEADER ──
    hdr_y = 6
    # Logo K (red rounded square)
    logo_x = LM
    logo_size = 18
    pdf.set_fill_color(*RED_LOGO)
    pdf.rect(logo_x, hdr_y, logo_size, logo_size, "F")
    pdf.set_xy(logo_x, hdr_y + 2)
    pdf.set_font("Helvetica", "B", 16)
    pdf.set_text_color(*WHITE)
    pdf.cell(logo_size, logo_size - 4, "K", align="C")
    # Try real logo overlay
    if os.path.exists(_logo_path):
        try:
            pdf.image(_logo_path, x=logo_x + 1, y=hdr_y + 1, h=logo_size - 2)
        except Exception:
            pass

    # Company name
    pdf.set_xy(logo_x + logo_size + 4, hdr_y + 1)
    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(*TEXT)
    pdf.cell(0, 7, "KLIKPHONE")
    pdf.set_xy(logo_x + logo_size + 4, hdr_y + 9)
    pdf.set_font("Helvetica", "", 7.5)
    pdf.set_text_color(*TEXT_GRAY)
    pdf.cell(0, 4, "Specialiste reparation Apple & Multimarque")

    # Doc type (right side)
    title = "DEVIS" if is_devis else "RECU"
    pdf.set_font("Helvetica", "B", 20)
    pdf.set_text_color(*ACCENT)
    pdf.set_xy(LM, hdr_y)
    pdf.cell(pw, 8, title, align="R")
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(*TEXT_MID)
    pdf.set_xy(LM, hdr_y + 9)
    pdf.cell(pw, 4, f"N. {code}", align="R")
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(*TEXT_GRAY)
    pdf.set_xy(LM, hdr_y + 14)
    pdf.cell(pw, 4, f"Date : {date_doc}", align="R")

    pdf.set_y(hdr_y + logo_size + 6)

    # ── PAYE STAMP (recu only) ──
    if not is_devis and is_paid:
        sy = pdf.get_y()
        sw, sh = 42, 11
        sx = (pdf.w - sw) / 2
        pdf.set_fill_color(236, 253, 245)
        pdf.set_draw_color(*GREEN)
        pdf.set_line_width(0.7)
        pdf.rect(sx, sy, sw, sh, "DF")
        pdf.set_xy(sx, sy + 1)
        pdf.set_font("Helvetica", "B", 16)
        pdf.set_text_color(*GREEN)
        pdf.cell(sw, sh - 2, "PAYE", align="C")
        pdf.set_line_width(0.2)
        pdf.set_y(sy + sh + 3)

    # ── 3. EMETTEUR / CLIENT CARDS ──
    cy = pdf.get_y()
    col_w = (pw - 6) / 2

    def _draw_card(x, y, w, label, lines_list):
        """Draw a card: bg + label + lines."""
        h = 7 + len(lines_list) * 4.5 + 4
        # Background
        pdf.set_fill_color(*CARD_BG)
        pdf.set_draw_color(*CARD_BD)
        pdf.rect(x, y, w, h, "DF")
        # Label
        pdf.set_xy(x + 4, y + 3)
        pdf.set_font("Helvetica", "B", 6)
        pdf.set_text_color(*TEXT_LIGHT)
        pdf.cell(w - 8, 3, label.upper())
        # Lines
        for i, (txt, bold) in enumerate(lines_list):
            pdf.set_xy(x + 4, y + 7 + i * 4.5)
            pdf.set_font("Helvetica", "B" if bold else "", 8.5 if bold else 8)
            pdf.set_text_color(*TEXT if bold else TEXT_GRAY)
            pdf.cell(w - 8, 4, txt)
        return h

    em_lines = [("KLIKPHONE", True)]
    # Clean address for latin-1
    addr_clean = adresse.replace("\u00e9", "e").replace("\u00e8", "e").replace("\u00e0", "a")
    em_lines.append((addr_clean, False))
    em_lines.append((f"Tel : {tel_boutique}", False))
    em_lines.append(("SIRET : 81396114100013", False))

    cl_lines = []
    if client_societe:
        cl_lines.append((client_societe, True))
    cl_lines.append((client_nom, True))
    cl_lines.append((f"Tel : {client_tel}", False))
    if client_email:
        cl_lines.append((f"Email : {client_email}", False))

    h1 = _draw_card(LM, cy, col_w, "Emetteur", em_lines)
    h2 = _draw_card(LM + col_w + 6, cy, col_w, "Client", cl_lines)
    pdf.set_y(cy + max(h1, h2) + 4)

    # ── 4. APPAREIL CARD ──
    ay = pdf.get_y()
    app_h = 14
    pdf.set_fill_color(*ACCENT_BG)
    pdf.set_draw_color(*ACCENT_BD)
    pdf.rect(LM, ay, pw, app_h, "DF")
    # Appareil name
    app_txt = appareil
    if categorie:
        app_txt += f" - {categorie}"
    pdf.set_xy(LM + 5, ay + 2)
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(*TEXT)
    pdf.cell(pw * 0.6, 5, app_txt)
    # Panne
    panne_clean = panne.replace("\u00e9", "e").replace("\u00e8", "e").replace("\u00e0", "a").replace("\u00ea", "e").replace("\u00f4", "o")
    pdf.set_xy(LM + 5, ay + 7.5)
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(*TEXT_MID)
    pdf.cell(pw * 0.6, 4, panne_clean)
    # IMEI right
    if imei:
        pdf.set_xy(LM + pw * 0.6, ay + 4)
        pdf.set_font("Courier", "", 8)
        pdf.set_text_color(*TEXT_GRAY)
        pdf.cell(pw * 0.4 - 5, 5, f"IMEI : {imei}", align="R")

    pdf.set_y(ay + app_h + 4)

    # ── 5. REPAIR TABLE ──
    col_desc = pw * 0.45
    col_qual = pw * 0.20
    col_qty = pw * 0.12
    col_prix = pw * 0.23

    # Table header
    thy = pdf.get_y()
    pdf.set_fill_color(*DARK)
    pdf.set_text_color(*WHITE)
    pdf.set_font("Helvetica", "B", 7)
    pdf.cell(col_desc, 8, "  DESIGNATION", fill=True)
    pdf.cell(col_qual, 8, "QUALITE", align="C", fill=True)
    pdf.cell(col_qty, 8, "QTE", align="C", fill=True)
    pdf.cell(col_prix, 8, "PRIX HT", align="R", fill=True, new_x="LMARGIN", new_y="NEXT")

    # Table rows
    for i, r in enumerate(repair_lines):
        bg = CARD_BG if i % 2 == 1 else WHITE
        pdf.set_fill_color(*bg)
        ht = round(r["prix"] * 100 / (100 + tva_rate), 2)
        label_clean = r["label"].replace("\u00e9", "e").replace("\u00e8", "e").replace("\u00e0", "a").replace("\u00ea", "e").replace("\u00f4", "o")
        # Designation
        pdf.set_text_color(*TEXT)
        pdf.set_font("Helvetica", "", 8.5)
        pdf.cell(col_desc, 8, f"  {label_clean}", fill=True)
        # Quality badge
        if i == 0 and type_ecran:
            # Violet badge
            bx = pdf.get_x()
            by = pdf.get_y()
            badge_w = pdf.get_string_width(type_ecran) + 6
            badge_x = bx + (col_qual - badge_w) / 2
            pdf.set_fill_color(*VIOLET_BG)
            pdf.rect(badge_x, by + 1.5, badge_w, 5, "F")
            pdf.set_xy(badge_x, by + 1.5)
            pdf.set_font("Helvetica", "B", 6.5)
            pdf.set_text_color(*VIOLET)
            pdf.cell(badge_w, 5, type_ecran, align="C")
            pdf.set_xy(bx, by)
            pdf.set_fill_color(*bg)
            pdf.cell(col_qual, 8, "", fill=False)
        else:
            pdf.cell(col_qual, 8, "", fill=True)
        # Qty
        pdf.set_text_color(*TEXT_MID)
        pdf.set_font("Helvetica", "", 8.5)
        pdf.cell(col_qty, 8, "1", align="C", fill=True)
        # Prix HT
        pdf.set_text_color(*TEXT)
        pdf.set_font("Helvetica", "B", 8.5)
        pdf.cell(col_prix, 8, f"{_fp(ht)}{euro}", align="R", fill=True, new_x="LMARGIN", new_y="NEXT")
        # Bottom line
        pdf.set_draw_color(*CARD_BD)
        pdf.line(LM, pdf.get_y(), LM + pw, pdf.get_y())

    if not repair_lines:
        pdf.set_fill_color(*CARD_BG)
        pdf.set_text_color(*TEXT_LIGHT)
        pdf.set_font("Helvetica", "I", 8.5)
        pdf.cell(pw, 10, "Aucune prestation", align="C", fill=True, new_x="LMARGIN", new_y="NEXT")

    # ── 6. TOTALS ──
    pdf.ln(3)
    tot_x = LM + pw * 0.45
    tot_w = pw * 0.55
    tl = tot_w * 0.55
    tv = tot_w * 0.45

    def _trow(label, value, style="normal"):
        y = pdf.get_y()
        if style == "ttc":
            h = 10
            pdf.set_fill_color(*ACCENT)
            pdf.rect(tot_x, y, tot_w, h, "F")
            pdf.set_xy(tot_x + 4, y + 0.5)
            pdf.set_font("Helvetica", "B", 12)
            pdf.set_text_color(*WHITE)
            pdf.cell(tl - 4, h - 1, label)
            pdf.cell(tv, h - 1, value, align="R", new_x="LMARGIN", new_y="NEXT")
        elif style == "reste":
            h = 9
            pdf.set_fill_color(*DARK)
            pdf.rect(tot_x, y, tot_w, h, "F")
            pdf.set_xy(tot_x + 4, y + 0.5)
            pdf.set_font("Helvetica", "B", 11)
            pdf.set_text_color(*WHITE)
            pdf.cell(tl - 4, h - 1, label)
            pdf.cell(tv, h - 1, value, align="R", new_x="LMARGIN", new_y="NEXT")
        elif style == "green":
            h = 6.5
            pdf.set_xy(tot_x + 4, y)
            pdf.set_font("Helvetica", "", 8.5)
            pdf.set_text_color(*GREEN)
            pdf.cell(tl - 4, h, label)
            pdf.set_font("Helvetica", "B", 8.5)
            pdf.cell(tv, h, value, align="R", new_x="LMARGIN", new_y="NEXT")
        else:
            h = 6.5
            pdf.set_xy(tot_x + 4, y)
            pdf.set_font("Helvetica", "", 8.5)
            pdf.set_text_color(*TEXT_MID)
            pdf.cell(tl - 4, h, label)
            pdf.set_font("Helvetica", "B", 8.5)
            pdf.set_text_color(*TEXT)
            pdf.cell(tv, h, value, align="R", new_x="LMARGIN", new_y="NEXT")
            pdf.set_draw_color(*CARD_BD)
            pdf.line(tot_x, pdf.get_y(), tot_x + tot_w, pdf.get_y())

    subtotal_ht = round(subtotal_ttc * 100 / (100 + tva_rate), 2) if subtotal_ttc > 0 else 0
    _trow("Sous-total HT", f"{_fp(subtotal_ht)}{euro}")
    if reduction > 0:
        red_pct = float(t.get("reduction_pourcentage") or 0)
        rl = f"Reduction ({red_pct:g}%)" if red_pct > 0 else "Reduction"
        red_ht = round(reduction * 100 / (100 + tva_rate), 2)
        _trow(rl, f"-{_fp(red_ht)}{euro}", "green")
    _trow("Total HT", f"{_fp(total_ht)}{euro}")
    tva_pct = f"{tva_rate:g}"
    _trow(f"TVA ({tva_pct}%)", f"{_fp(tva_amount)}{euro}")
    pdf.ln(1)
    _trow("Total TTC", f"{_fp(total_ttc)}{euro}", "ttc")
    if acompte > 0:
        _trow("Acompte verse", f"-{_fp(acompte)}{euro}", "green")
    if reste > 0 or acompte > 0:
        _trow("Reste a payer", f"{_fp(max(0, reste))}{euro}", "reste")

    # ── FIDELITE (recu only) ──
    if not is_devis:
        try:
            active = _get_config("fidelite_active", "1")
            if active == "1" and t.get("client_id"):
                with get_cursor() as cur:
                    cur.execute("SELECT points_fidelite FROM clients WHERE id = %s", (t["client_id"],))
                    row = cur.fetchone()
                if row:
                    pts = int(row.get("points_fidelite") or 0)
                    pdf.ln(5)
                    fy = pdf.get_y()
                    pdf.set_fill_color(245, 243, 255)
                    pdf.set_draw_color(221, 214, 254)
                    pdf.rect(LM, fy, pw, 12, "DF")
                    pdf.set_xy(LM + 5, fy + 2)
                    pdf.set_font("Helvetica", "B", 6.5)
                    pdf.set_text_color(*VIOLET)
                    pdf.cell(40, 3, "PROGRAMME FIDELITE")
                    pdf.set_xy(LM + 5, fy + 6)
                    pdf.set_font("Helvetica", "", 8.5)
                    pdf.set_text_color(91, 33, 182)
                    pdf.cell(pw - 10, 4, f"Vos points : {pts} pts")
                    pdf.set_y(fy + 14)
        except Exception:
            pass

    # ── 7. INFO COMPLEMENTAIRES — 4 mini cards ──
    pdf.ln(4)
    iy = pdf.get_y()
    mc_w = (pw - 9) / 4
    mc_h = 12
    infos = [
        ("Ticket", code),
        ("Technicien", technicien),
        ("Date depot", date_depot),
        ("Date recup.", date_recup),
    ]
    for idx, (lbl, val) in enumerate(infos):
        mx = LM + idx * (mc_w + 3)
        pdf.set_fill_color(*CARD_BG)
        pdf.set_draw_color(*CARD_BD)
        pdf.rect(mx, iy, mc_w, mc_h, "DF")
        pdf.set_xy(mx + 3, iy + 2)
        pdf.set_font("Helvetica", "B", 5.5)
        pdf.set_text_color(*TEXT_LIGHT)
        pdf.cell(mc_w - 6, 3, lbl.upper())
        pdf.set_xy(mx + 3, iy + 6)
        pdf.set_font("Helvetica", "B", 7.5)
        pdf.set_text_color(*TEXT)
        # Truncate if too wide
        if pdf.get_string_width(val) > mc_w - 6:
            while pdf.get_string_width(val + "..") > mc_w - 6 and len(val) > 3:
                val = val[:-1]
            val += ".."
        pdf.cell(mc_w - 6, 4, val)
    pdf.set_y(iy + mc_h + 4)

    # ── 8. CONDITIONS ──
    cy = pdf.get_y()
    if is_devis:
        cond = "Devis valable 30 jours. Klikphone ne peut etre tenu responsable de la perte de donnees. Un acompte de 30% est demande a la validation du devis."
    else:
        cond = "Garantie pieces et main d'oeuvre : 6 mois. Tout materiel non recupere sous 3 mois sera considere comme abandonne. Klikphone ne peut etre tenu responsable de la perte de donnees."

    # Estimate condition box height
    cond_w = pw - 8
    pdf.set_font("Helvetica", "", 7)
    nb_lines = max(1, len(cond) // 90 + 1)
    cond_h = 8 + nb_lines * 3.5

    pdf.set_fill_color(*CARD_BG)
    pdf.set_draw_color(*CARD_BD)
    pdf.rect(LM, cy, pw, cond_h, "DF")
    pdf.set_xy(LM + 4, cy + 2.5)
    pdf.set_font("Helvetica", "B", 6)
    pdf.set_text_color(*TEXT_LIGHT)
    pdf.cell(cond_w, 3, "CONDITIONS")
    pdf.set_xy(LM + 4, cy + 6.5)
    pdf.set_font("Helvetica", "", 7)
    pdf.set_text_color(*TEXT_GRAY)
    pdf.multi_cell(cond_w, 3.5, cond)

    # ── 9. FOOTER ──
    pdf.set_auto_page_break(auto=False)
    ft_h = 10
    footer_y = pdf.h - ft_h
    pdf.set_fill_color(*DARK)
    pdf.rect(0, footer_y, pdf.w, ft_h, "F")
    # Left: SIRET
    pdf.set_xy(LM, footer_y + 3)
    pdf.set_font("Helvetica", "", 6.5)
    pdf.set_text_color(*TEXT_GRAY)
    pdf.cell(pw * 0.6, 4, "SIRET : 81396114100013 . TVA non applicable, art. 293B du CGI")
    # Right: TkS26
    pdf.set_xy(LM + pw * 0.4, footer_y + 3)
    pdf.cell(pw * 0.6, 4, "Propulse par TkS26 - une solution Klik&Dev", align="R")

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
