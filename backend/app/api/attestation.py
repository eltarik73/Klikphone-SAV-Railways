"""
API Attestation de non-réparabilité.
Historique sauvegardé en BDD lié aux clients.
Envoi PDF par email via Resend (avec logo).
"""

import base64
import io
import os
from datetime import datetime
from html import escape
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional, List
from fpdf import FPDF
import httpx

from app.database import get_cursor
from app.services import mentions
from app.services import params as params_cache
from app.api.auth import get_current_user
from app.services.notifications import envoyer_email, envoyer_email_avec_pdf
from app.api.email_api import _send_resend_html
from app.services.pdf_text import _pdf_safe

STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "static"

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


def _get_param(key: str) -> str:
    return params_cache.get_param(key, "")


def _identite() -> dict:
    """Identité et mentions légales de la boutique (services/mentions, jamais écrites ici)."""
    ident = mentions.lire()
    contact = " - ".join(x for x in (ident.get("BOUTIQUE_TEL"), ident.get("BOUTIQUE_EMAIL")) if x)
    return {
        **ident,
        "raison": mentions.raison_sociale(ident),
        "contact": contact,
        "legal": " - ".join(mentions.lignes_legales(ident)),
        "ville": mentions.ville(ident),
    }


def _date_lieu(ident: dict, date_fr: str) -> str:
    return f"{ident['ville']}, le {date_fr}" if ident["ville"] else f"Le {date_fr}"


def _fait_a(ident: dict, date_fr: str) -> str:
    return f"Fait à {ident['ville']}, le {date_fr}" if ident["ville"] else f"Fait le {date_fr}"


def _generate_attestation_pdf(data: AttestationRequest) -> bytes:
    """Genere un PDF A4 professionnel de l'attestation - tient sur 1 page."""
    now = datetime.now()
    date_fr = f"{now.day} {MOIS_FR[now.month - 1]} {now.year}"
    ident = _identite()
    LM = 18
    RM = 192
    # Champs utilisateur nettoyés pour la police Latin-1
    s_nom = _pdf_safe(data.nom)
    s_prenom = _pdf_safe(data.prenom)
    s_adresse = _pdf_safe(data.adresse)
    s_marque = _pdf_safe(data.marque)
    s_modele = _pdf_safe(data.modele)
    s_imei = _pdf_safe(data.imei)
    s_etat = _pdf_safe(data.etat)
    s_motif = _pdf_safe(data.motif)
    s_cr = _pdf_safe(data.compte_rendu)

    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=False)
    pdf.set_margins(LM, 10, LM)
    pdf.add_page()

    # ── Logo + en-tete cote a cote ──
    logo_path = STATIC_DIR / "logo_k.png"
    y_start = 10
    if logo_path.exists():
        pdf.image(str(logo_path), x=LM, y=y_start, w=35)
    pdf.set_y(y_start)
    pdf.set_x(LM + 40)
    pdf.set_font("Helvetica", "B", 14)
    pdf.set_text_color(30, 30, 30)
    pdf.cell(0, 7, _pdf_safe(ident["BOUTIQUE_NOM"]), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(100, 100, 100)
    for ligne in ("Specialiste Apple & Multimarque", ident["BOUTIQUE_ADRESSE"], ident["contact"], ident["legal"]):
        if ligne:
            pdf.set_x(LM + 40)
            pdf.multi_cell(RM - LM - 40, 4, _pdf_safe(ligne), new_x="LMARGIN", new_y="NEXT")
    pdf.set_y(max(pdf.get_y(), y_start + 30))
    pdf.ln(3)

    # ── Trait separateur ──
    pdf.set_draw_color(200, 200, 200)
    pdf.set_line_width(0.3)
    pdf.line(LM, pdf.get_y(), RM, pdf.get_y())
    pdf.ln(4)

    # ── Titre ──
    pdf.set_draw_color(30, 30, 30)
    pdf.set_line_width(0.6)
    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(0, 0, 0)
    pdf.cell(0, 12, "ATTESTATION DE NON-REPARABILITE", border=1, align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    # ── Date ──
    pdf.set_font("Helvetica", "I", 10)
    pdf.set_text_color(80, 80, 80)
    pdf.cell(0, 5, _pdf_safe(_date_lieu(ident, date_fr)), align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    # ── Intro ──
    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(0, 0, 0)
    pdf.multi_cell(0, 5.5, _pdf_safe(
        f"Je soussigne, {ident['raison']}, professionnel de la reparation d'appareils electroniques, "
        "atteste par la presente que l'appareil decrit ci-dessous a ete examine dans nos "
        "ateliers et declare non reparable pour les raisons indiquees."))
    pdf.ln(4)

    # ── Helpers ──
    def section(title):
        pdf.set_font("Helvetica", "B", 11)
        pdf.set_text_color(30, 30, 30)
        pdf.set_fill_color(240, 240, 245)
        pdf.cell(0, 7, f"  {title}", fill=True, new_x="LMARGIN", new_y="NEXT")
        pdf.ln(2)

    def field(label, value):
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(100, 100, 100)
        pdf.cell(48, 6, f"{label} :")
        pdf.set_font("Helvetica", "B", 11)
        pdf.set_text_color(0, 0, 0)
        pdf.cell(0, 6, value or "-", new_x="LMARGIN", new_y="NEXT")

    # ── 2 colonnes : Proprietaire | Appareil ──
    section("PROPRIETAIRE")
    field("Nom", s_nom)
    field("Prenom", s_prenom)
    if s_adresse:
        field("Adresse", s_adresse)
    pdf.ln(3)

    section("APPAREIL")
    field("Marque", s_marque)
    field("Modele", s_modele)
    if s_imei:
        field("IMEI / N. serie", s_imei)
    if s_etat:
        field("Etat", s_etat)
    pdf.ln(3)

    # ── Motif ──
    section("MOTIF DE NON-REPARABILITE")
    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(0, 0, 0)
    pdf.multi_cell(0, 5.5, s_motif or "-")
    pdf.ln(3)

    # ── Compte-rendu ──
    if s_cr:
        section("COMPTE-RENDU TECHNIQUE")
        pdf.set_font("Helvetica", "", 11)
        pdf.set_text_color(0, 0, 0)
        pdf.multi_cell(0, 5.5, s_cr)
        pdf.ln(3)

    # ── Mention legale ──
    pdf.set_font("Helvetica", "I", 9)
    pdf.set_text_color(80, 80, 80)
    pdf.multi_cell(0, 4.5,
        "Cette attestation est delivree pour servir et valoir ce que de droit, "
        "notamment aupres des compagnies d'assurance.")
    pdf.ln(5)

    # ── Signature + tampon ──
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(0, 0, 0)
    pdf.cell(0, 5, _pdf_safe(_fait_a(ident, date_fr)), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 5, "Signature et cachet :", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)
    tampon_path = STATIC_DIR / "tampon_klikphone.png"
    if tampon_path.exists():
        pdf.image(str(tampon_path), x=LM, w=50)

    # ── Footer ──
    pdf.set_y(-15)
    pdf.set_draw_color(180, 180, 180)
    pdf.set_line_width(0.2)
    pdf.line(LM, pdf.get_y(), RM, pdf.get_y())
    pdf.ln(2)
    pdf.set_font("Helvetica", "", 7)
    pdf.set_text_color(150, 150, 150)
    pied = " - ".join(x for x in (ident["raison"], ident["BOUTIQUE_ADRESSE"], ident["legal"], ident["BOUTIQUE_TEL"]) if x)
    pdf.multi_cell(0, 3, _pdf_safe(pied), align="C")

    # bytes() explicite : fpdf2 renvoie un bytearray que Starlette ne sait pas
    # toujours sérialiser tel quel dans une Response.
    return bytes(pdf.output())


def _send_resend_pdf(to: str, subject: str, message: str, pdf_bytes: bytes, filename: str) -> tuple:
    """Envoie un email avec PDF en pièce jointe via Resend."""
    api_key = _get_param("RESEND_API_KEY")
    if not api_key:
        return False, "Cle API Resend non configuree"

    from_name = _get_param("SMTP_NAME") or "Klikphone"
    from_email = _get_param("SMTP_USER") or "onboarding@resend.dev"

    pdf_b64 = base64.b64encode(pdf_bytes).decode("utf-8")

    try:
        with httpx.Client(timeout=20) as client:
            resp = client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": f"{from_name} <{from_email}>",
                    "to": [to],
                    "subject": subject,
                    "text": message,
                    "attachments": [{
                        "filename": filename,
                        "content": pdf_b64,
                    }],
                },
            )
        if resp.status_code in (200, 201):
            return True, "Email PDF envoye avec succes"
        else:
            error = resp.json().get("message", resp.text) if "json" in resp.headers.get("content-type", "") else resp.text
            return False, f"Resend erreur {resp.status_code}: {error}"
    except Exception as e:
        return False, f"Erreur Resend: {str(e)}"


def _e(v) -> str:
    return escape(str(v or ""), quote=True)


def _e_br(v) -> str:
    return _e(v).replace("\r\n", "\n").replace("\n", "<br>")


def _generate_attestation_html(data: AttestationRequest) -> str:
    now = datetime.now()
    date_fr = f"{now.day} {MOIS_FR[now.month - 1]} {now.year}"
    ident = _identite()
    nom = _e(ident["BOUTIQUE_NOM"])
    entete = "<br>".join(_e(x) for x in (
        f"{ident['BOUTIQUE_NOM']} — Spécialiste Apple & Multimarque", ident["BOUTIQUE_ADRESSE"],
        " — ".join(x for x in (ident["BOUTIQUE_TEL"] and f"Tél : {ident['BOUTIQUE_TEL']}",
                                ident["BOUTIQUE_EMAIL"]) if x),
        *mentions.lignes_legales(ident),
    ) if x)
    pied = " — ".join(_e(x) for x in (ident["raison"], ident["BOUTIQUE_ADRESSE"], *mentions.lignes_legales(ident)) if x)

    motif_html = _e_br(data.motif) if data.motif else '—'
    cr_html = _e_br(data.compte_rendu) if data.compte_rendu else ''

    cr_section = ''
    if data.compte_rendu:
        cr_section = f"""
  <h3>Compte-rendu technique</h3>
  <p class="encadre">{cr_html}</p>
"""

    return f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'">
<title>Attestation de non-réparabilité</title>
<style>
  @page {{ margin: 15mm; size: A4; }}
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{ font-family: Arial, sans-serif; font-size: 13px; line-height: 1.4; color: #000;
         max-width: 700px; margin: 0 auto; padding: 40px; }}
  .logo {{ text-align: center; margin-bottom: 6px; }}
  .entete {{ text-align: center; font-size: 11px; color: #555; margin-bottom: 10px; }}
  h1 {{ text-align: center; font-size: 20px; text-transform: uppercase; letter-spacing: 2px;
        border: 2px solid #000; padding: 8px; margin: 10px 0 12px; }}
  .date {{ text-align: right; margin-bottom: 8px; }}
  h3 {{ margin-top: 10px; font-size: 13px; text-transform: uppercase;
        border-bottom: 1px solid #000; padding-bottom: 3px; }}
  table {{ width: 100%; border-collapse: collapse; margin: 6px 0; }}
  td {{ padding: 2px 0; vertical-align: top; overflow-wrap: anywhere; }}
  td.lib {{ width: 180px; color: #555; }}
  td.fort {{ font-weight: bold; }}
  .encadre {{ margin: 6px 0; padding: 8px 10px; background: #f5f5f5; border-radius: 4px; overflow-wrap: anywhere; }}
  .mention {{ margin-top: 12px; }}
  .signature {{ margin-top: 18px; break-inside: avoid; }}
  .signature p {{ margin-bottom: 4px; }}
  .pied {{ margin-top: 14px; border-top: 1px solid #ccc; padding-top: 6px; font-size: 10px;
           color: #666; text-align: center; }}
  @media print {{ body {{ padding: 0; }} }}
</style></head><body>

<div class="logo"><img src="/logo_k.png" width="80" height="80" alt="{nom}"></div>

<div class="entete">{entete}</div>

<h1>Attestation de Non-Réparabilité</h1>

<p class="date">{_e(_date_lieu(ident, date_fr))}</p>

<div>
  <p>Je soussigné, <strong>{_e(ident["raison"])}</strong>, professionnel de la réparation d'appareils électroniques,
  atteste par la présente que l'appareil décrit ci-dessous a été examiné dans nos ateliers et
  <strong>déclaré non réparable</strong> pour les raisons indiquées.</p>

  <h3>Informations du propriétaire</h3>
  <table>
    <tr><td class="lib">Nom :</td><td class="fort">{_e(data.nom)}</td></tr>
    <tr><td class="lib">Prénom :</td><td class="fort">{_e(data.prenom)}</td></tr>
    <tr><td class="lib">Adresse :</td><td>{_e(data.adresse) or '—'}</td></tr>
  </table>

  <h3>Informations de l'appareil</h3>
  <table>
    <tr><td class="lib">Marque :</td><td class="fort">{_e(data.marque)}</td></tr>
    <tr><td class="lib">Modèle :</td><td class="fort">{_e(data.modele)}</td></tr>
    <tr><td class="lib">IMEI / N° série :</td><td>{_e(data.imei) or '—'}</td></tr>
    <tr><td class="lib">État général :</td><td>{_e(data.etat) or '—'}</td></tr>
  </table>

  <h3>Motif de non-réparabilité</h3>
  <p class="encadre">{motif_html}</p>
  {cr_section}
  <p class="mention">
    Cette attestation est délivrée pour servir et valoir ce que de droit, notamment auprès
    des compagnies d'assurance.
  </p>
</div>

<div class="signature">
  <p>{_e(_fait_a(ident, date_fr))}</p>
  <p><strong>Signature et cachet :</strong></p>
  <img src="/tampon_klikphone.png" width="170" height="96" alt="Cachet {nom}">
</div>

<div class="pied">{pied}</div>
</body></html>"""


def _generate_attestation_docx(data: AttestationRequest) -> bytes:
    """Génère l'attestation au format Word (.docx) — éditable côté client."""
    from docx import Document
    from docx.shared import Pt, RGBColor, Mm
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    now = datetime.now()
    date_fr = f"{now.day} {MOIS_FR[now.month - 1]} {now.year}"
    ident = _identite()

    doc = Document()
    # Marges A4 resserrées pour tenir sur une seule page
    section = doc.sections[0]
    section.top_margin = Mm(12)
    section.bottom_margin = Mm(10)
    section.left_margin = Mm(18)
    section.right_margin = Mm(18)

    # Style Normal compact (police 10, interligne serré, peu d'espace après)
    normal = doc.styles["Normal"]
    normal.font.size = Pt(10)
    normal.paragraph_format.space_after = Pt(2)
    normal.paragraph_format.space_before = Pt(0)
    normal.paragraph_format.line_spacing = 1.0

    def _tight(p, before=0, after=2):
        p.paragraph_format.space_before = Pt(before)
        p.paragraph_format.space_after = Pt(after)
        p.paragraph_format.line_spacing = 1.0
        return p

    # ─── Logo centré (compact) ───
    logo_path = STATIC_DIR / "logo_k.png"
    if logo_path.exists():
        p = _tight(doc.add_paragraph(), 0, 1)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        try:
            p.add_run().add_picture(str(logo_path), width=Mm(38))
        except Exception:
            pass

    # ─── En-tête boutique ───
    head = _tight(doc.add_paragraph(), 0, 4)
    head.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = head.add_run("\n".join(x for x in (
        f"{ident['BOUTIQUE_NOM']} — Spécialiste Apple & Multimarque", ident["BOUTIQUE_ADRESSE"],
        ident["contact"], ident["legal"],
    ) if x))
    r.font.size = Pt(8)
    r.font.color.rgb = RGBColor(0x55, 0x55, 0x55)

    # ─── Titre ───
    title = _tight(doc.add_paragraph(), 2, 4)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    tr = title.add_run("ATTESTATION DE NON-RÉPARABILITÉ")
    tr.bold = True
    tr.font.size = Pt(15)

    # ─── Date ───
    dp = _tight(doc.add_paragraph(), 0, 4)
    dp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    dr = dp.add_run(_date_lieu(ident, date_fr))
    dr.italic = True
    dr.font.size = Pt(9)

    # ─── Corps ───
    intro = _tight(doc.add_paragraph(), 0, 4)
    intro.add_run(
        f"Je soussigné, {ident['raison']}, professionnel de la réparation d'appareils "
        "électroniques, atteste par la présente que l'appareil décrit ci-dessous "
        "a été examiné dans nos ateliers et déclaré non réparable pour les raisons indiquées."
    ).font.size = Pt(10)

    def _section_title(text):
        sp = _tight(doc.add_paragraph(), 4, 1)
        sr = sp.add_run(text.upper())
        sr.bold = True
        sr.font.size = Pt(10)

    def _kv_table(rows):
        table = doc.add_table(rows=0, cols=2)
        for label, value in rows:
            cells = table.add_row().cells
            cells[0].width = Mm(45)
            p0 = cells[0].paragraphs[0]; _tight(p0, 0, 0)
            lr = p0.add_run(label)
            lr.font.color.rgb = RGBColor(0x55, 0x55, 0x55)
            lr.font.size = Pt(10)
            p1 = cells[1].paragraphs[0]; _tight(p1, 0, 0)
            vr = p1.add_run(str(value) if value else "—")
            vr.font.size = Pt(10)

    _section_title("Informations du propriétaire")
    _kv_table([
        ("Nom :", data.nom),
        ("Prénom :", data.prenom),
        ("Adresse :", data.adresse),
    ])

    _section_title("Informations de l'appareil")
    _kv_table([
        ("Marque :", data.marque),
        ("Modèle :", data.modele),
        ("IMEI / N° série :", data.imei),
        ("État général :", data.etat),
    ])

    _section_title("Motif de non-réparabilité")
    _tight(doc.add_paragraph(data.motif or "—"), 0, 3)

    if data.compte_rendu:
        _section_title("Compte-rendu technique")
        _tight(doc.add_paragraph(data.compte_rendu), 0, 3)

    _tight(doc.add_paragraph(
        "Cette attestation est délivrée pour servir et valoir ce que de droit, "
        "notamment auprès des compagnies d'assurance."
    ), 4, 4)

    # ─── Signature ───
    sig = _tight(doc.add_paragraph(), 2, 1)
    sig.add_run(f"{_fait_a(ident, date_fr)} — Signature et cachet :").font.size = Pt(9)
    tampon_path = STATIC_DIR / "tampon_klikphone.png"
    if tampon_path.exists():
        sp = _tight(doc.add_paragraph(), 0, 0)
        try:
            sp.add_run().add_picture(str(tampon_path), width=Mm(45))
        except Exception:
            pass

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


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
def generate_attestation(
    data: AttestationRequest,
    user: dict = Depends(get_current_user),
):
    """Génère l'attestation HTML et la sauvegarde en BDD."""
    html = _generate_attestation_html(data)
    att_id = _save_attestation(data, user, email_envoye=False)
    return {"html": html, "attestation_id": att_id}


_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_DOCX_SUBTYPE = "vnd.openxmlformats-officedocument.wordprocessingml.document"


def _safe_filename(data: AttestationRequest, ext: str) -> str:
    base = f"attestation_{data.marque}_{data.modele}".replace(" ", "_")
    # Garde seulement caractères sûrs pour un nom de fichier
    base = "".join(c for c in base if c.isalnum() or c in ("_", "-")) or "attestation"
    return f"{base}.{ext}"


@router.post("/email")
def email_attestation(
    data: AttestationRequest,
    destinataire: str,
    format: str = Query("pdf", description="pdf ou word"),
    user: dict = Depends(get_current_user),
):
    """Envoie l'attestation par email (PDF ou Word au choix) et la sauvegarde."""
    fmt = (format or "pdf").lower()
    is_word = fmt in ("word", "docx")

    if is_word:
        file_bytes = _generate_attestation_docx(data)
        filename = _safe_filename(data, "docx")
        subtype = _DOCX_SUBTYPE
    else:
        file_bytes = _generate_attestation_pdf(data)
        filename = _safe_filename(data, "pdf")
        subtype = "pdf"

    ident = _identite()
    sujet = f"Attestation de non-reparabilite - {data.marque} {data.modele}"
    message = (
        f"Bonjour {data.prenom} {data.nom},\n\n"
        f"Veuillez trouver ci-joint l'attestation de non-reparabilite "
        f"de votre appareil {data.marque} {data.modele}.\n\n"
        "Cordialement,\n" + " - ".join(x for x in (ident["BOUTIQUE_NOM"], ident["BOUTIQUE_TEL"]) if x)
    )

    # Essaie Resend (format-agnostique : base64 + nom de fichier) puis SMTP en fallback
    success, msg = _send_resend_pdf(destinataire, sujet, message, file_bytes, filename)
    if not success:
        success, msg = envoyer_email_avec_pdf(destinataire, sujet, message, file_bytes, filename, subtype=subtype)

    # Sauvegarde avec le statut email
    data.email = destinataire
    _save_attestation(data, user, email_envoye=success)

    return {"success": success, "message": msg}


@router.post("/pdf")
def download_attestation_pdf(
    data: AttestationRequest,
    user: dict = Depends(get_current_user),
):
    """Télécharge l'attestation en PDF."""
    pdf_bytes = _generate_attestation_pdf(data)
    filename = _safe_filename(data, "pdf")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/docx")
def download_attestation_docx(
    data: AttestationRequest,
    user: dict = Depends(get_current_user),
):
    """Télécharge l'attestation au format Word (.docx)."""
    docx_bytes = _generate_attestation_docx(data)
    filename = _safe_filename(data, "docx")
    return Response(
        content=docx_bytes,
        media_type=_DOCX_MIME,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/history")
def list_attestations(
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
def get_attestation(
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
