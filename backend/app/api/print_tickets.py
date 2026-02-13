"""
API Print Tickets — génération HTML pour impression thermique 80mm et A4.
Tickets client, staff, combiné, devis, reçu.
Tout en monochrome pour imprimante thermique.
"""

import json
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
  font-family: 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.5;
  color: #000;
  background: #fff;
}}
.center {{ text-align:center; }}
.bold {{ font-weight:bold; }}
.right {{ text-align:right; }}
h1 {{
  font-family: Arial, sans-serif;
  font-size: 24px;
  font-weight: 900;
  letter-spacing: 4px;
  margin: 0;
}}
h2 {{
  font-family: Arial, sans-serif;
  font-size: 15px;
  font-weight: bold;
  letter-spacing: 2px;
  text-transform: uppercase;
  margin: 3px 0;
}}
.sep {{ border:none; border-top:1px dashed #000; margin:8px 0; }}
.sep-bold {{ border:none; border-top:3px solid #000; margin:10px 0; }}
.row {{ display:flex; justify-content:space-between; padding:2px 0; font-size:13px; }}
.row .val {{ text-align:right; flex-shrink:0; font-weight:bold; }}
.section {{ margin:6px 0; }}
.section-title {{ font-weight:bold; font-size:12px; letter-spacing:1px; text-transform:uppercase; margin-bottom:3px; border-bottom:1px solid #000; padding-bottom:2px; }}
.small {{ font-size:10px; line-height:1.3; }}
.tiny {{ font-size:9px; line-height:1.3; color:#333; }}
.logo-img {{ width:160px; height:auto; display:block; margin:0 auto 6px; }}
.qr {{ text-align:center; margin:10px 0; }}
.qr img {{ width:200px; height:200px; }}
.highlight {{
  font-size:20px;
  font-weight:900;
  letter-spacing:3px;
}}
.total-box {{
  border:3px solid #000;
  padding:6px 10px;
  margin:6px 0;
  font-weight:bold;
  font-size:16px;
}}
.info-box {{
  border:1px solid #000;
  padding:4px 8px;
  margin:4px 0;
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
    adresse = _get_config("adresse", "79 Place Saint Léger, 73000 Chambéry")
    tel_boutique = _get_config("tel_boutique", "04 79 60 89 22")
    horaires = _get_config("horaires", "Lundi-Samedi 10h-19h")

    devis = float(t.get("devis_estime") or 0)
    prix_supp = float(t.get("prix_supp") or 0)
    acompte = float(t.get("acompte") or 0)
    subtotal = devis + prix_supp
    reduction = _calc_reduction(t, subtotal)
    total = max(0, subtotal - reduction)
    reste = total - acompte

    # Date de récupération
    recup_html = ""
    if t.get("date_recuperation"):
        recup_html = f'<div class="info-box center" style="margin-top:6px"><div class="bold small">Date de récupération prévue</div><div style="font-size:15px;font-weight:bold">{t["date_recuperation"]}</div></div>'

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
        if reduction > 0:
            red_pct = float(t.get("reduction_pourcentage") or 0)
            label = f'Réduction ({red_pct:g}%)' if red_pct > 0 else 'Réduction'
            tarif_html += f'<div class="row"><span>{label}</span><span class="val">- {_fp(reduction)}€</span></div>'
        tarif_html += '<hr class="sep">'
        tarif_html += f'<div class="total-box"><div class="row"><span>TOTAL</span><span>{_fp(total)}€</span></div></div>'
        if acompte > 0:
            tarif_html += f'<div class="row"><span>Acompte versé</span><span class="val">- {_fp(acompte)}€</span></div>'
        tarif_html += f'<div class="total-box center">RESTE À PAYER  {_fp(reste)}€</div>'
        tarif_html += '</div>'

    # Note publique
    note_html = ""
    if t.get("notes_client"):
        note_html = f'<hr class="sep"><div class="section"><div class="small"><b>Note:</b> {t["notes_client"]}</div></div>'

    return _THERMAL.format(title=f"Ticket Client - {code}") + f"""
<div class="center">
  <img src="/logo_k.png" class="logo-img" alt="K" onerror="this.style.display='none'">
  <h1>KLIKPHONE</h1>
  <div class="small" style="font-weight:bold">Spécialiste Apple & Multimarque</div>
  <div class="small">{adresse}</div>
  <div class="small">Tél: {tel_boutique}</div>
</div>
<hr class="sep-bold">
<div class="center"><h2>TICKET DE DÉPÔT</h2></div>
<hr class="sep-bold">
<div class="info-box center">
  <div class="highlight">{code}</div>
  <div class="small">{_fd(t.get('date_depot'))}</div>
</div>
{recup_html}
<hr class="sep">
<div class="section">
  <div class="section-title">CLIENT</div>
  <div class="row"><span>Nom:</span><span class="val">{t.get('client_prenom', '')} {t.get('client_nom', '')}</span></div>
  <div class="row"><span>Tél:</span><span class="val">{t.get('client_tel', '')}</span></div>
</div>
<hr class="sep">
<div class="section">
  <div class="section-title">APPAREIL</div>
  <div class="row"><span>Modèle:</span><span class="val">{appareil}</span></div>
  <div class="row"><span>Catégorie:</span><span>{t.get('categorie', '')}</span></div>
  <div class="row"><span>Motif:</span><span class="val">{t.get('panne', '')}</span></div>
  {f'<div class="row"><span>Détail:</span><span>{t.get("panne_detail","")}</span></div>' if t.get('panne_detail') else ''}
  {f'<div class="row"><span>IMEI:</span><span class="small" style="font-family:monospace">{t.get("imei","")}</span></div>' if t.get('imei') else ''}
</div>
{tarif_html}
{note_html}
<hr class="sep">
<div class="qr"><img src="{qr}" alt="QR"></div>
<div class="center" style="font-weight:bold;font-size:11px">
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
<div class="center" style="margin-top:6px;font-size:12px">
  <b>Merci de votre confiance !</b><br>
  <span style="font-size:14px;font-weight:900;letter-spacing:2px">KLIKPHONE</span>
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
    <img src="/logo_k.png" width="140" style="display:inline-block;" onerror="this.style.display='none'" />
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

    devis = float(t.get("devis_estime") or 0)
    prix_supp = float(t.get("prix_supp") or 0)
    acompte = float(t.get("acompte") or 0)
    subtotal_ttc = devis + prix_supp
    reduction = _calc_reduction(t, subtotal_ttc)
    total_ttc = max(0, subtotal_ttc - reduction)
    tva = round(total_ttc * tva_rate / (100 + tva_rate), 2)
    total_ht = round(total_ttc - tva, 2)
    reste = total_ttc - acompte
    tva_label = f"TVA ({tva_rate:g}%)"

    lignes = ""
    if devis > 0:
        ht = round(devis * 100 / (100 + tva_rate), 2)
        lignes += f'<div class="row"><span>{t.get("panne", "Réparation")}</span><span class="val">{_fp(ht)}€ HT</span></div>'
    if t.get("reparation_supp") and prix_supp > 0:
        ht_s = round(prix_supp * 100 / (100 + tva_rate), 2)
        lignes += f'<div class="row"><span>{t.get("reparation_supp", "")}</span><span class="val">{_fp(ht_s)}€ HT</span></div>'
    if reduction > 0:
        red_pct = float(t.get("reduction_pourcentage") or 0)
        label = f'Réduction ({red_pct:g}%)' if red_pct > 0 else 'Réduction'
        red_ht = round(reduction * 100 / (100 + tva_rate), 2)
        lignes += f'<div class="row"><span>{label}</span><span class="val">- {_fp(red_ht)}€ HT</span></div>'

    siret = _get_config("SIRET", "")
    siret_line = f'<div class="small">SIRET: {siret}</div>' if siret else ''

    return _THERMAL.format(title=f"Devis - {code}") + f"""
<div class="center">
  <img src="/logo_k.png" class="logo-img" alt="K" onerror="this.style.display='none'">
  <h1>KLIKPHONE</h1>
  <div class="small">{adresse}</div>
</div>
<hr class="sep-bold">
<div class="center"><h2>D E V I S</h2></div>
<hr class="sep">
<div class="section">
  <div class="row"><span>N°:</span><span class="val">{code}</span></div>
  <div class="row"><span>Date:</span><span>{_fd(t.get('date_depot'))}</span></div>
  <div class="row"><span>Appareil:</span><span class="val">{appareil}</span></div>
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
  <div class="row"><span>{tva_label}:</span><span class="val">{_fp(tva)}€</span></div>
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
    adresse = _get_config("adresse", "79 Place Saint Léger, 73000 Chambéry")
    tva_rate = float(_get_config("tva", "20"))

    tarif = float(t.get("tarif_final") or t.get("devis_estime") or 0)
    prix_supp = float(t.get("prix_supp") or 0)
    acompte = float(t.get("acompte") or 0)
    subtotal_ttc = tarif + prix_supp
    reduction = _calc_reduction(t, subtotal_ttc)
    total_ttc = max(0, subtotal_ttc - reduction)
    tva = round(total_ttc * tva_rate / (100 + tva_rate), 2)
    total_ht = round(total_ttc - tva, 2)
    reste = total_ttc - acompte
    tva_label = f"TVA ({tva_rate:g}%)"

    lignes = ""
    if tarif > 0:
        ht = round(tarif * 100 / (100 + tva_rate), 2)
        lignes += f'<div class="row"><span>{t.get("panne", "Réparation")}</span><span class="val">{_fp(ht)}€ HT</span></div>'
    if t.get("reparation_supp") and prix_supp > 0:
        ht_s = round(prix_supp * 100 / (100 + tva_rate), 2)
        lignes += f'<div class="row"><span>{t.get("reparation_supp", "")}</span><span class="val">{_fp(ht_s)}€ HT</span></div>'
    if reduction > 0:
        red_pct = float(t.get("reduction_pourcentage") or 0)
        label = f'Réduction ({red_pct:g}%)' if red_pct > 0 else 'Réduction'
        red_ht = round(reduction * 100 / (100 + tva_rate), 2)
        lignes += f'<div class="row"><span>{label}</span><span class="val">- {_fp(red_ht)}€ HT</span></div>'

    siret = _get_config("SIRET", "")
    siret_line = f'<div class="small">SIRET: {siret}</div>' if siret else ''

    return _THERMAL.format(title=f"Reçu - {code}") + f"""
<div class="center">
  <img src="/logo_k.png" class="logo-img" alt="K" onerror="this.style.display='none'">
  <h1>KLIKPHONE</h1>
  <div class="small">{adresse}</div>
</div>
<hr class="sep-bold">
<div class="center"><h2>R E Ç U</h2></div>
<hr class="sep">
<div class="section">
  <div class="row"><span>N°:</span><span class="val">{code}</span></div>
  <div class="row"><span>Date:</span><span>{datetime.now().strftime("%d/%m/%Y")}</span></div>
  <div class="row"><span>Appareil:</span><span class="val">{appareil}</span></div>
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
  <div class="row"><span>{tva_label}:</span><span class="val">{_fp(tva)}€</span></div>
</div>
<hr class="sep-bold">
<div class="total-box"><div class="row"><span>TOTAL TTC:</span><span>{_fp(total_ttc)}€</span></div></div>
{f'<div class="row"><span>Acompte:</span><span class="val">- {_fp(acompte)}€</span></div>' if acompte > 0 else ''}
{f'<div class="total-box center">RESTE À PAYER: {_fp(reste)}€</div>' if acompte > 0 else ''}
<hr class="sep">
<div class="tiny">
  Ce ticket de garantie ne fait pas office de facture.
</div>
{_fidelite_section(t)}
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
