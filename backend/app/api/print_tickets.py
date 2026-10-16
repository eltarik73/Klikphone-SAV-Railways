"""
API Print Tickets — génération HTML pour impression thermique 80mm et A4.
Tickets client, staff, combiné, devis, reçu.
+ PDF A4 professionnel pour devis et reçu.

Toutes les routes exigent une session staff. Le client reçoit ses documents par
les liens publics à jeton (app/api/public_documents.py), jamais la fiche atelier.
Toute valeur issue des données passe par _e() : les champs arrivent aussi des
formulaires publics (/client, /depot, dépôt à distance).
"""

import base64
import json
import os
import re
import urllib.parse
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from html import escape
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, Response

try:
    import qrcode
    HAS_QRCODE = True
except ImportError:
    HAS_QRCODE = False

try:
    from zoneinfo import ZoneInfo
    _PARIS = ZoneInfo("Europe/Paris")
except Exception:  # image sans base tz : repli sur la règle d'heure d'été UE
    _PARIS = None

from app.database import get_cursor
from app.api.auth import get_current_user
from app.services import etagere
from app.services import mentions
from app.services import params as params_cache
from app.api.reception import TESTS as TESTS_RECEPTION, resume_reception
from app.services.montants import calculer_montants, lignes_dues
from app.services.pdf_text import _pdf_safe
from app.services.prestations import detail_public, index_ligne_ecran, lignes_reparation

router = APIRouter(prefix="/api/tickets", tags=["print"])

# URL frontend pour les QR codes de suivi
_FRONTEND_URL_DEFAULT = "https://klikphone-sav-v2-production.up.railway.app"
_FRONTEND_URL_ENV = os.getenv("FRONTEND_URL", "")

# Identité et mentions légales : services/mentions (jamais écrites ici)
_DEFAUTS = {
    "horaires": "Lundi-Samedi 10h-19h",
    "message_ticket": "Merci de votre confiance !",
    "tva": "20",
    "URL_SUIVI": "",
    "fidelite_active": "1",
    "fidelite_palier_film": "1000",
    "fidelite_palier_reduction": "5000",
    "fidelite_montant_reduction": "10",
    # Délai de retrait imprimé dans les conditions (services/mentions.mention_abandon)
    etagere.PARAM_DELAI_ABANDON: "",
}

# En-tête HTTP des documents ouverts directement (onglet, lien de partage) ;
# la balise meta couvre aussi l'aperçu srcdoc et l'ancienne impression document.write.
CSP_DOCUMENTS = (
    "default-src 'none'; img-src 'self' data: https:; "
    "style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; "
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
)
_META_CSP = "script-src 'none'; object-src 'none'; base-uri 'none'"


def _get_configs(keys=None) -> dict:
    """Paramètres boutique (cache services/params), complétés par les valeurs par défaut.

    Sans `keys` : aussi l'identité et les mentions légales (services/mentions.lire).
    """
    complet = keys is None
    keys = list(keys or _DEFAUTS)
    try:
        cfg = params_cache.get_params(keys, _DEFAUTS)
    except Exception:
        cfg = {k: _DEFAUTS.get(k, "") for k in keys}
    if complet:
        cfg.update(mentions.lire())
    return cfg


def _avec_mentions(cfg: dict) -> dict:
    """cfg complété par l'identité et les mentions légales s'il ne les porte pas déjà."""
    return cfg if "BOUTIQUE_NOM" in cfg else {**cfg, **mentions.lire()}


def _get_config(key: str, default: str = "") -> str:
    try:
        return params_cache.get_param(key, default)
    except Exception:
        return default


def _frontend_url_from(url_suivi) -> str:
    if url_suivi and str(url_suivi).startswith("http"):
        return str(url_suivi).rstrip("/")
    if _FRONTEND_URL_ENV:
        return _FRONTEND_URL_ENV.rstrip("/")
    return _FRONTEND_URL_DEFAULT


def _get_frontend_url() -> str:
    """Résout l'URL frontend : params DB > env FRONTEND_URL > défaut hardcodé."""
    return _frontend_url_from(_get_configs(["URL_SUIVI"]).get("URL_SUIVI"))


_COLONNES_TICKET = """
    SELECT t.*, c.nom as client_nom, c.prenom as client_prenom,
           c.telephone as client_tel, c.email as client_email,
           c.societe as client_societe, c.points_fidelite as client_points_fidelite,
           o.ticket_code as ticket_original_code"""
_FROM_TICKET = """
    FROM tickets t
    JOIN clients c ON t.client_id = c.id
    LEFT JOIN tickets o ON o.id = t.ticket_original_id
"""
_SELECT_TICKET = _COLONNES_TICKET + _FROM_TICKET
# Fiche atelier : les 3 dernières notes viennent avec le ticket (une seule requête par impression)
_SELECT_TICKET_STAFF = _COLONNES_TICKET + """,
           (SELECT COALESCE(json_agg(n ORDER BY n.date_creation DESC), '[]'::json) FROM (
               SELECT contenu, auteur, important, date_creation FROM notes_tickets
               WHERE ticket_id = t.id ORDER BY date_creation DESC LIMIT 3) n) AS notes_impression,
           (SELECT json_build_object('items', tc.items, 'complete', tc.complete) FROM ticket_controles tc
             WHERE tc.ticket_id = t.id AND tc.phase = 'entree') AS reception_impression""" + _FROM_TICKET


def _get_ticket_full(ticket_id: int) -> dict:
    """Récupère un ticket avec toutes les infos client."""
    with get_cursor() as cur:
        cur.execute(_SELECT_TICKET_STAFF + " WHERE t.id = %s", (ticket_id,))
        return cur.fetchone()


def _get_ticket_by_token(token: str):
    with get_cursor() as cur:
        cur.execute(_SELECT_TICKET + " WHERE t.suivi_token = %s", (token,))
        return cur.fetchone()


# ═══════════════════════════════════════════════════════════════
# FORMATAGE
# ═══════════════════════════════════════════════════════════════

def _e(v) -> str:
    """Échappement HTML (texte et attributs)."""
    return "" if v is None else escape(str(v), quote=True)


def _e_br(v) -> str:
    return _e(v).replace("\r\n", "\n").replace("\n", "<br>")


def _dernier_dimanche(annee: int, mois: int) -> date:
    d = date(annee, mois + 1, 1) - timedelta(days=1)
    return d - timedelta(days=(d.weekday() + 1) % 7)


def _heure_paris(d: datetime) -> datetime:
    """Les TIMESTAMP naïfs de la base sont en UTC (CURRENT_TIMESTAMP, serveur en UTC)."""
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    if _PARIS is not None:
        return d.astimezone(_PARIS)
    u = d.astimezone(timezone.utc).replace(tzinfo=None)
    debut = datetime.combine(_dernier_dimanche(u.year, 3), datetime.min.time()).replace(hour=1)
    fin = datetime.combine(_dernier_dimanche(u.year, 10), datetime.min.time()).replace(hour=1)
    return u + timedelta(hours=2 if debut <= u < fin else 1)


def _maintenant_paris() -> datetime:
    return _heure_paris(datetime.now(timezone.utc))


def _fd(d):
    """Format date (heure de Paris)."""
    if not d:
        return "—"
    if isinstance(d, datetime):
        return _heure_paris(d).strftime("%d/%m/%Y %H:%M")
    if isinstance(d, date):
        return d.strftime("%d/%m/%Y")
    return str(d)


_DATE_ISO = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")


def _date_recu(t: dict) -> str:
    """Date du reçu, la même à chaque réimpression : remise de l'appareil (date_rendu), sinon
    clôture (date_cloture), toutes deux TEXTE lues si elles commencent par AAAA-MM-JJ ;
    à défaut seulement, le jour de l'impression."""
    for col in ("date_rendu", "date_cloture"):
        m = _DATE_ISO.match(str(t.get(col) or "").strip())
        if m:
            return f"{m.group(3)}/{m.group(2)}/{m.group(1)}"
    return _maintenant_paris().strftime("%d/%m/%Y")


def _fd_court(d) -> str:
    if isinstance(d, datetime):
        return _heure_paris(d).strftime("%d/%m %H:%M")
    return str(d)[:10] if d else ""


def _num(v, default: float = 0.0) -> float:
    try:
        return float(v) if v not in (None, "") else default
    except (TypeError, ValueError):
        return default


def _fp(p):
    """Format prix."""
    return f"{_num(p):,.2f}".replace(",", " ").replace(".", ",")


def _appareil(t: dict) -> str:
    autre = str(t.get("modele_autre") or "").strip()
    if autre:
        return autre
    return " ".join(str(p).strip() for p in (t.get("marque"), t.get("modele")) if p and str(p).strip())


def _nom_client(t: dict) -> str:
    return " ".join(str(p).strip() for p in (t.get("client_prenom"), t.get("client_nom")) if p and str(p).strip())


def _calc_reduction(t: dict, total: float) -> float:
    """Calcule la réduction effective."""
    red_pct = _num(t.get("reduction_pourcentage"))
    red_mnt = _num(t.get("reduction_montant"))
    if red_pct > 0:
        return round(total * red_pct / 100, 2)
    return red_mnt


def _parse_repair_lines(t: dict) -> list:
    """Lignes de réparation imprimées (source unique : services/prestations.py)."""
    return lignes_reparation(t)


def _label_reduction(t: dict) -> str:
    pct = _num(t.get("reduction_pourcentage"))
    return f"Réduction ({pct:g}%)" if pct > 0 else "Réduction"


def _get_ticket_notes(ticket_id: int, limit: int = None) -> list:
    """Fetch private notes for a ticket."""
    try:
        with get_cursor() as cur:
            cur.execute("""
                SELECT contenu, auteur, important, date_creation
                FROM notes_tickets
                WHERE ticket_id = %s
                ORDER BY date_creation DESC
                LIMIT %s
            """, (ticket_id, limit))
            return [dict(r) for r in cur.fetchall()]
    except Exception:
        return []


def _notes_staff(t: dict) -> list:
    """3 dernières notes : lues avec le ticket (_get_ticket_full), sinon une requête."""
    notes = t.get("notes_impression")
    if notes is None:
        return _get_ticket_notes(t["id"], 3) if t.get("id") else []
    if isinstance(notes, str):
        try:
            notes = json.loads(notes)
        except ValueError:
            return []
    out = []
    for n in notes if isinstance(notes, list) else []:
        n = dict(n)
        d = n.get("date_creation")
        if isinstance(d, str):
            try:
                n["date_creation"] = datetime.fromisoformat(d)
            except ValueError:
                pass
        out.append(n)
    return out


def _points_fidelite(client_id, t: dict = None):
    if t is not None and "client_points_fidelite" in t:
        return int(t.get("client_points_fidelite") or 0) if t.get("client_id") else None
    if not client_id:
        return None
    try:
        with get_cursor() as cur:
            cur.execute("SELECT points_fidelite FROM clients WHERE id = %s", (client_id,))
            row = cur.fetchone()
        return int(row.get("points_fidelite") or 0) if row else None
    except Exception:
        return None


def _suivi_url(code: str, base: str = None, token: str = None) -> str:
    """URL de suivi pour le QR code.

    Avec le jeton (t), le client peut agir sur son ticket (devis, message, avis).
    Le code reste en fin d'URL : la douchette réglée en QWERTY sur un poste AZERTY
    n'est reconnue que par la fin du texte scanné (…ticket=KP-000123).
    """
    jeton = f"t={urllib.parse.quote(token)}&" if token else ""
    return f"{base or _get_frontend_url()}/suivi?{jeton}ticket={urllib.parse.quote(code)}"


def _qr_data_uri(code: str, base: str = None, token: str = None) -> str:
    """Génère un QR code en base64 data URI (local, pas de dépendance externe)."""
    # Le service QR externe (repli sans la lib qrcode) ne doit jamais recevoir le jeton
    target = _suivi_url(code, base, token if HAS_QRCODE else None)
    if HAS_QRCODE:
        qr = qrcode.QRCode(version=1, error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=6, border=2)
        qr.add_data(target)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        buf = BytesIO()
        img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()
        return f"data:image/png;base64,{b64}"
    return f"https://api.qrserver.com/v1/create-qr-code/?size=200x200&data={urllib.parse.quote(target, safe='')}"


def _qr_url(code: str, base: str = None) -> str:
    """Alias pour compatibilité — retourne data URI ou URL externe."""
    return _qr_data_uri(code, base)


def _pattern_grid(pattern_str: str) -> str:
    """Dessine le schéma de déverrouillage en grille HTML pour impression thermique."""
    if not pattern_str:
        return ""

    points = [int(p) for p in str(pattern_str).split("-") if p.isdigit() and 1 <= int(p) <= 9]
    if not points:
        return ""

    order = {p: i + 1 for i, p in enumerate(points)}
    sequence = " → ".join(str(p) for p in points)

    lines = [
        f'<div style="font-size:12px;font-weight:700;text-align:center;margin-top:2px">Séquence : {sequence}</div>',
        '<table style="border-collapse:collapse;margin:4px auto">',
    ]
    for row in range(3):
        lines.append("<tr>")
        for col in range(3):
            num = row * 3 + col + 1
            if num in order:
                lines.append(
                    '<td class="mono" style="width:28px;height:28px;text-align:center;'
                    f'border:2px solid #000;font-weight:900;font-size:14px">{order[num]}</td>'
                )
            else:
                lines.append(
                    '<td class="mono" style="width:28px;height:28px;text-align:center;'
                    'border:1px dotted #000;font-size:14px">&middot;</td>'
                )
        lines.append("</tr>")
    lines.append("</table>")
    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════
# STYLE THERMIQUE 80mm — MONOCHROME
# ═══════════════════════════════════════════════════════════════

# Pas de « size » dans @page : « 80mm auto » est invalide (ignoré) et une hauteur
# fixe couperait les tickets longs. Le pilote décide, ou l'aperçu injecte la
# hauteur mesurée de chaque [data-print-page]. Contenu 72 mm = zone imprimable.
_THERMAL_CSS = """
@page { margin: 0; }
* { margin:0; padding:0; box-sizing:border-box; }
html, body { background:#fff; color:#000; }
body {
  font-family: Arial, Helvetica, sans-serif; font-size:14px; line-height:1.5;
  -webkit-print-color-adjust:exact; print-color-adjust:exact;
}
.ticket { width:80mm; margin:0 auto; padding:3mm 4mm; overflow-wrap:anywhere; }
.ticket + .ticket { break-before:page; page-break-before:always; }
.center { text-align:center; }
.bold { font-weight:900; }
h1 { font-size:26px; font-weight:900; letter-spacing:4px; }
.sep { border:none; border-top:1px dashed #000; margin:8px 0; }
.sep-bold { border:none; border-top:3px solid #000; margin:10px 0; }
.banner {
  background:#000; color:#fff; text-align:center; padding:8px; font-size:17px;
  font-weight:900; letter-spacing:3px; margin-bottom:8px;
}
.row { display:flex; justify-content:space-between; align-items:baseline; gap:8px; padding:3px 0; font-size:14px; font-weight:700; }
.row > span:first-child { flex:0 0 auto; white-space:nowrap; }
.row .val { flex:1 1 auto; min-width:0; text-align:right; font-weight:900; }
.row.line > span:first-child { flex:1 1 auto; min-width:0; white-space:normal; }
.row.line .val { flex:0 0 auto; white-space:nowrap; }
.section { margin:8px 0; }
.box { border:2px solid #000; border-radius:4px; padding:10px; margin:8px 0; }
.box-title {
  background:#000; color:#fff; font-size:11px; font-weight:700; padding:3px 8px;
  margin:-10px -10px 8px; letter-spacing:1px; text-transform:uppercase;
}
.small { font-size:11px; line-height:1.4; font-weight:600; }
.tiny { font-size:10px; line-height:1.3; }
.logo-img { width:112px; height:auto; display:block; margin:0 auto 6px; filter:grayscale(1); }
.qr { text-align:center; margin:10px 0; }
.qr img { width:200px; height:200px; }
.highlight { font-size:22px; font-weight:900; letter-spacing:3px; }
.total-box { border:3px solid #000; padding:8px 10px; margin:8px 0; font-weight:900; font-size:17px; }
.info-box { border:2px solid #000; border-radius:4px; padding:6px 10px; margin:6px 0; }
.stamp { border:3px solid #000; padding:8px; margin-top:6px; text-align:center; font-size:17px; font-weight:900; }
.stamp.paid { background:#000; color:#fff; letter-spacing:3px; }
.mono { font-family:"Courier New", Courier, monospace; }
.pre { white-space:pre-wrap; }
.badge {
  display:inline-block; border:2px solid #000; padding:0 6px; margin-left:4px;
  font-size:12px; font-weight:700; white-space:nowrap;
}
.emplacement { border:4px solid #000; text-align:center; padding:4px 6px 6px; margin:8px 0; }
.emplacement-titre { font-size:12px; font-weight:900; letter-spacing:3px; }
.emplacement-valeur { font-size:44px; font-weight:900; line-height:1.1; letter-spacing:2px; }
"""


def _thermal_doc(title: str, sections: list) -> str:
    return (
        '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">'
        f'<meta http-equiv="Content-Security-Policy" content="{_META_CSP}">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>{_e(title)}</title><style>{_THERMAL_CSS}</style></head><body>"
        + "".join(sections)
        + "</body></html>"
    )


def _section(page: str, inner: str) -> str:
    return f'<section class="ticket" data-print-page="{page}">{inner}</section>'


def _box(title: str, content: str) -> str:
    return f'<div class="box"><div class="box-title">{_e(title)}</div>{content}</div>'


def _staff_box(title: str, content: str) -> str:
    """Helper: crée une section encadrée avec titre inversé pour le ticket staff."""
    return _box(title, content)


def _row(label: str, valeur: str, cls: str = "row") -> str:
    """valeur est déjà du HTML (échappé par l'appelant)."""
    return f'<div class="{cls}"><span>{_e(label)}</span><span class="val">{valeur}</span></div>'


@lru_cache(maxsize=1)
def _logo_thermique_uri() -> str:
    """Logo noir et blanc 1 bit (~1 Ko) : net sur papier thermique, sans requête réseau."""
    try:
        from PIL import Image, ImageOps
        with Image.open(os.path.join(os.path.dirname(__file__), "logo_k.png")) as im:
            g = ImageOps.grayscale(im.convert("RGB"))
            g = g.resize((224, max(1, round(g.height * 224 / g.width))), Image.LANCZOS)
            bw = g.point(lambda v: 0 if v < 190 else 255).convert("1")
            buf = BytesIO()
            bw.save(buf, format="PNG", optimize=True)
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return ""


def _logo_html(base: str, cls: str = "logo-img", alt: str = "") -> str:
    src = _logo_thermique_uri() or f"{base}/logo_k.png"
    return f'<img src="{_e(src)}" class="{cls}" alt="{_e(alt or "Logo")}">'


# ═══════════════════════════════════════════════════════════════
# MENTIONS LÉGALES ET RÉCEPTION (blocs communs)
# ═══════════════════════════════════════════════════════════════

def _pied_legal_html(cfg: dict) -> str:
    """Raison sociale (gras), SIRET et RCS, TVA : l'adresse est déjà en tête du document."""
    lignes = mentions.lignes_legales(cfg)
    return f"<b>{_e(mentions.raison_sociale(cfg))}</b>" + "".join(f"<br>{_e(x)}" for x in lignes)


def _mention_abandon(cfg: dict, courte: bool) -> str:
    """Clause de retrait (loi du 31/12/1903) au délai ETAGERE_DELAI_ABANDON_JOURS, texte brut :
    courte sur papier thermique, longue en A4 et PDF."""
    jours = etagere.lire_delai_abandon(cfg.get(etagere.PARAM_DELAI_ABANDON))
    return mentions.mention_abandon(jours, courte=courte)


def _emplacement_staff(t: dict) -> str:
    """Fiche atelier : emplacement d'étagère (« B3 ») en très gros, s'il est renseigné."""
    emplacement = " ".join(str(t.get("emplacement") or "").split())
    if not emplacement:
        return ""
    return ('<div class="emplacement"><div class="emplacement-titre">EMPLACEMENT</div>'
            f'<div class="emplacement-valeur">{_e(emplacement)}</div></div>')


def _ligne_info(label: str, valeur: str, size: int = 13) -> str:
    return f'<div style="font-size:{size}px"><strong>{_e(label)} :</strong> {_e(valeur)}</div>'


def _depot_constate(t: dict) -> str:
    """Ticket client : accessoires déposés et état constaté, si la réception est saisie."""
    r = resume_reception(t.get("reception_impression"))
    if not r or not (r["accessoires"] or r["etat"]):
        return ""
    inner = _ligne_info("Accessoires déposés", ", ".join(r["accessoires"]) or "aucun", 12)
    if r["etat"]:
        inner += _ligne_info("État constaté", " · ".join(r["etat"]), 12)
    return _box("Dépôt constaté", inner)


def _reception_staff(t: dict) -> str:
    """Fiche atelier : encadré Réception (accessoires, état, tests KO). Rien si la donnée
    n'a pas été lue avec le ticket (_get_ticket_full la lit toujours)."""
    if "reception_impression" not in t:
        return ""
    r = resume_reception(t.get("reception_impression"))
    if r is None:
        return _box("Réception", '<div style="font-size:13px;font-weight:700">Fiche de réception non remplie</div>')
    inner = ""
    if not r["complete"]:
        inner += ('<div class="center" style="font-size:12px;font-weight:900;border:1px solid #000;'
                  'padding:2px;margin-bottom:4px">À COMPLÉTER</div>')
    inner += _ligne_info("Accessoires", ", ".join(r["accessoires"]) or "aucun")
    if r["etat"]:
        inner += _ligne_info("État", " · ".join(r["etat"]))
    if r["notes"]:
        inner += f'<div class="pre" style="font-size:12px">{_e(r["notes"])}</div>'
    if r["tests_ko"]:
        inner += ('<div style="font-size:13px;font-weight:900;padding:2px 6px;margin:4px 0;background:#000;color:#fff">'
                  f'Tests KO : {_e(", ".join(r["tests_ko"]))}</div>')
    elif len(r["non_testes"]) < len(TESTS_RECEPTION):
        inner += _ligne_info("Tests KO", "aucun")
    if len(r["non_testes"]) == len(TESTS_RECEPTION):
        inner += _ligne_info("Tests", "non réalisés", 12)
    elif r["non_testes"]:
        inner += _ligne_info("Non testés", ", ".join(r["non_testes"]), 12)
    if r["eteint"]:
        inner += '<div style="font-size:12px;font-weight:700">Appareil éteint à la réception</div>'
    if r["sauvegarde"]:
        inner += '<div style="font-size:12px;font-weight:700">Sauvegarde conseillée au client</div>'
    if r["imei"]:
        inner += f'<div style="font-size:12px"><strong>IMEI vérifié :</strong> <span class="mono">{_e(r["imei"])}</span></div>'
    return _box("Réception", inner)


def _retour_sav_banner(t: dict) -> str:
    """Encadré RETOUR SAV si applicable."""
    if not t.get("est_retour_sav"):
        return ""
    orig_code = t.get("ticket_original_code")
    if orig_code is None and t.get("ticket_original_id"):
        try:
            with get_cursor() as cur:
                cur.execute("SELECT ticket_code FROM tickets WHERE id = %s", (t["ticket_original_id"],))
                row = cur.fetchone()
                if row:
                    orig_code = row["ticket_code"]
        except Exception:
            pass
    orig = f'<div style="font-size:12px;font-weight:700;margin-top:2px">Ticket original : {_e(orig_code)}</div>' if orig_code else ""
    return (
        '<div style="border:3px solid #000;padding:8px 10px;margin:8px 0;text-align:center">'
        '<div style="font-size:16px;font-weight:900;letter-spacing:2px">RETOUR SAV</div>'
        f'{orig}<div class="tiny" style="margin-top:2px">Prise en charge garantie — 0,00 €</div></div>'
    )


def _totaux(t: dict) -> tuple:
    """(lignes, totaux) imprimés : services/montants.calculer_montants, comme l'écran,
    /restitution, la fidélité et la caisse.

    Devis refusé : seules les lignes de frais sont imprimées. Sans ligne chiffrée
    (repli devis estimé) ou quand tarif_final fait foi (ancien format, réduction
    déjà déduite), la première ligne porte la base, comme la fiche (lignesFiche) :
    lignes, réduction et total restent cohérents à l'impression.
    """
    m = calculer_montants(t)
    # Mêmes lignes, dans le même ordre, que m["lignes"] (prix arrondis au centime) ; + la clé
    lignes = [{**r, "prix": c["prix"]} for r, c in zip(lignes_dues(t), m["lignes"])]
    total = m["total"]
    base, reduction = m["sous_total"], m["reduction"]
    if m["source"] == "tarif_final":
        pct = _num(t.get("reduction_pourcentage"))
        eur = _num(t.get("reduction_montant"))
        if 0 < pct < 100:
            base = total / (1 - pct / 100)
        elif pct <= 0 and eur > 0:
            base = total + eur
        else:
            base = total
        base = round(base, 2)
        reduction = round(max(0.0, base - total), 2)
    if m["source"] != "lignes":
        autres = sum(r["prix"] for r in lignes[1:])
        prix = round(max(0.0, base - autres), 2)
        if lignes:
            lignes[0] = {**lignes[0], "prix": prix}
        else:
            lignes = [{"label": "Réparation", "prix": prix, "cle": None}]
    return lignes, {
        "subtotal": base, "reduction": reduction, "total": total,
        "acompte": m["acompte"], "reste": m["reste"], "paye": m["paye"],
    }


# ═══════════════════════════════════════════════════════════════
# TICKET CLIENT
# ═══════════════════════════════════════════════════════════════

def _client_body(t: dict, cfg: dict) -> str:
    cfg = _avec_mentions(cfg)
    base = _frontend_url_from(cfg.get("URL_SUIVI"))
    code = t.get("ticket_code") or ""
    lignes, tot = _totaux(t)

    recup_html = ""
    if t.get("date_recuperation"):
        recup_html = (
            '<div class="info-box center" style="margin-top:6px"><div class="bold small">Date de récupération prévue</div>'
            f'<div style="font-size:15px;font-weight:900">{_e(t["date_recuperation"])}</div></div>'
        )

    tarif_html = ""
    if lignes:
        inner = "".join(_row(r["label"], f'{_fp(r["prix"])} €', "row line") for r in lignes)
        if tot["reduction"] > 0:
            inner += _row(_label_reduction(t), f'- {_fp(tot["reduction"])} €', "row line")
        inner += (
            '<div style="border-top:2px solid #000;margin-top:6px;padding-top:6px">'
            f'<div class="row line" style="font-size:16px"><span>TOTAL</span><span class="val">{_fp(tot["total"])} €</span></div></div>'
        )
        if tot["acompte"] > 0:
            inner += _row("Acompte versé", f'- {_fp(tot["acompte"])} €', "row line")
        if tot["paye"]:
            inner += '<div class="stamp paid">PAYÉ</div>'
        else:
            inner += f'<div class="stamp">RESTE À PAYER : {_fp(tot["reste"])} €</div>'
        tarif_html = _box("Tarification", inner)

    note_html = ""
    if t.get("notes_client"):
        note_html = _box("Note", f'<div style="font-size:13px;font-weight:700">{_e_br(t["notes_client"])}</div>')

    detail_txt = detail_public(t)
    detail = _row("Détail :", _e(detail_txt)) if detail_txt else ""
    imei = _row("IMEI :", f'<span class="mono">{_e(t["imei"])}</span>') if t.get("imei") else ""

    nom = cfg["BOUTIQUE_NOM"]
    conditions = " ".join(x for x in (
        _e_br(cfg.get("CGV_DEPOT")), _e(_mention_abandon(cfg, courte=True)), _e(mentions.mention_garantie(cfg))) if x)
    conditions_html = (
        '<div class="section tiny" style="padding:4px 0">'
        f'<b style="font-size:11px">CONDITIONS GÉNÉRALES</b><br><br>{conditions}</div>'
    ) if conditions else ""

    return _section("client", f"""
<div class="center">
  {_logo_html(base, alt=nom)}
  <h1>{_e(nom)}</h1>
  <div class="small">Spécialiste Apple &amp; Multimarque</div>
  <div class="small">{_e(cfg.get("BOUTIQUE_ADRESSE"))}</div>
  <div class="small">Tél : {_e(cfg.get("BOUTIQUE_TEL"))}</div>
</div>
<hr class="sep-bold">
<div class="banner">TICKET DE DÉPÔT</div>
{_retour_sav_banner(t)}
<div class="info-box center">
  <div class="highlight">{_e(code)}</div>
  <div class="small" style="margin-top:2px">{_e(_fd(t.get("date_depot")))}</div>
</div>
{recup_html}
{_box("Client", _row("Nom :", _e(_nom_client(t))) + _row("Tél :", _e(t.get("client_tel"))))}
{_box("Appareil",
      _row("Modèle :", _e(_appareil(t) or "—"))
      + _row("Catégorie :", _e(t.get("categorie") or "—"))
      + _row("Motif :", _e(t.get("panne")))
      + detail + imei)}
{_depot_constate(t)}
{tarif_html}
{note_html}
<div class="qr"><img src="{_e(_qr_data_uri(code, base, t.get("suivi_token")))}" alt="QR code de suivi"></div>
<div class="center" style="font-weight:900;font-size:12px">Scannez pour suivre votre<br>réparation en ligne</div>
<hr class="sep">
{conditions_html}
<div class="tiny" style="padding:2px 0">{_e(mentions.mention_rgpd_courte(cfg, base))}</div>
<hr class="sep-bold">
<div class="center" style="margin-top:8px;font-size:13px">
  <b>{_e(cfg.get("message_ticket") or _DEFAUTS["message_ticket"])}</b><br>
  <div style="font-size:15px;font-weight:900;letter-spacing:3px;margin-top:4px">{_e(nom)}</div>
  <div class="small">{_e(cfg.get("horaires"))}</div>
  <div class="tiny" style="margin-top:6px">{_pied_legal_html(cfg)}</div>
</div>""")


def _ticket_client_html(t: dict, cfg: dict = None) -> str:
    cfg = cfg or _get_configs()
    return _thermal_doc(f"Ticket Client - {t.get('ticket_code') or ''}", [_client_body(t, cfg)])


# ═══════════════════════════════════════════════════════════════
# TICKET STAFF (FICHE TECHNICIEN)
# ═══════════════════════════════════════════════════════════════

def _staff_body(t: dict, cfg: dict) -> str:
    cfg = _avec_mentions(cfg)
    base = _frontend_url_from(cfg.get("URL_SUIVI"))
    code = t.get("ticket_code") or ""
    tech = t.get("technicien_assigne") or "Non assigné"
    date_recup = t.get("date_recuperation") or "Non définie"
    type_ecran = str(t.get("type_ecran") or "").strip()

    lignes, tot = _totaux(t)
    idx_ecran = index_ligne_ecran(lignes) if type_ecran else None

    repairs = ""
    for i, r in enumerate(lignes):
        badge = f'<span class="badge">{_e(type_ecran)}</span>' if i == idx_ecran else ""
        style = "font-size:15px;font-weight:900" if i == 0 else "font-size:14px"
        repairs += (
            f'<div class="row line" style="{style};padding:4px 0;border-bottom:1px dashed #000">'
            f'<span>{_e(r["label"])} {badge}</span><span class="val">{_fp(r["prix"])} €</span></div>'
        )
    if tot["reduction"] > 0:
        repairs += _row(_label_reduction(t), f'- {_fp(tot["reduction"])} €', "row line")
    repairs += (
        f'<div class="row line" style="font-size:16px;padding:6px 0;margin-top:4px">'
        f'<span>TOTAL :</span><span class="val">{_fp(tot["total"])} €</span></div>'
    )
    if tot["acompte"] > 0:
        repairs += _row("Acompte :", f'- {_fp(tot["acompte"])} €', "row line")
    if tot["paye"]:
        repairs += '<div class="stamp paid">PAYÉ</div>'
    else:
        repairs += f'<div class="stamp">RESTE À PAYER : {_fp(tot["reste"])} €</div>'

    sec_html = ""
    if t.get("pin") or t.get("pattern"):
        sec = ""
        if t.get("pin"):
            sec += (
                '<div style="margin-bottom:8px"><div style="font-size:12px;font-weight:700">Code PIN :</div>'
                '<div class="mono" style="font-size:24px;font-weight:900;letter-spacing:6px;text-align:center;'
                f'border:1px solid #000;padding:4px;margin-top:2px">{_e(t["pin"])}</div></div>'
            )
        if t.get("pattern"):
            sec += '<div style="font-size:12px;font-weight:700">Schéma :</div>' + _pattern_grid(t["pattern"])
        sec_html = _box("Codes de sécurité", sec)

    notes_html = ""
    notes = _notes_staff(t)
    if notes:
        inner = ""
        for n in notes:
            if n.get("important"):
                inner += (
                    '<div style="font-size:13px;font-weight:900;padding:4px 6px;margin:4px 0;background:#000;color:#fff">'
                    f'IMPORTANT : {_e_br(n.get("contenu"))}</div>'
                )
            else:
                inner += (
                    '<div class="row line" style="font-size:13px;border-bottom:1px dotted #000">'
                    f'<span>{_e_br(n.get("contenu"))}</span>'
                    f'<span class="val" style="font-size:10px;font-weight:400">{_e(_fd_court(n.get("date_creation")))}</span></div>'
                )
        notes_html = _box("Notes", inner)

    pret_html = ""
    if t.get("telephone_pret"):
        pret_html = _box(
            "Tél de prêt",
            f'<div style="font-size:15px;font-weight:900;text-align:center">{_e(t["telephone_pret"])}</div>',
        )

    qualite = ""
    if type_ecran and idx_ecran is None:
        qualite = f"<div><strong>Qualité écran :</strong> {_e(type_ecran)}</div>"
    imei = f'<div><strong>IMEI :</strong> <span class="mono">{_e(t["imei"])}</span></div>' if t.get("imei") else ""
    detail = f'<div class="pre" style="font-size:12px;margin-top:4px">{_e(t["panne_detail"])}</div>' if t.get("panne_detail") else ""

    nom = cfg["BOUTIQUE_NOM"]
    return _section("staff", f"""
<div class="center" style="margin-bottom:8px">{_logo_html(base, alt=nom)}</div>
<div class="center" style="font-size:11px;margin-bottom:10px;line-height:1.3">
  <div style="font-size:16px;font-weight:900;letter-spacing:2px">{_e(nom)}</div>
  <div>{_e(cfg.get("BOUTIQUE_ADRESSE"))}</div>
  <div>Tél : {_e(cfg.get("BOUTIQUE_TEL"))}</div>
</div>
<div class="banner" style="font-size:18px">TICKET STAFF</div>
{_retour_sav_banner(t)}
<div class="box" style="margin-top:0">
  <div style="font-size:20px;font-weight:900;letter-spacing:1px">{_e(code)}</div>
  <div style="font-size:12px;margin-top:4px">
    <div><strong>Dépôt :</strong> {_e(_fd(t.get("date_depot")))}</div>
    <div><strong>Récup :</strong> {_e(date_recup)}</div>
  </div>
</div>
{_emplacement_staff(t)}
{_box("Client",
      f'<div style="font-size:16px;font-weight:900">{_e(_nom_client(t))}</div>'
      f'<div style="font-size:14px;margin-top:2px">Tél : {_e(t.get("client_tel"))}</div>')}
{_box("Appareil",
      f'<div style="font-size:16px;font-weight:900">{_e(_appareil(t) or "Appareil non renseigné")}</div>'
      f'<div style="font-size:13px;margin-top:4px"><div><strong>Catégorie :</strong> {_e(t.get("categorie") or "—")}</div>'
      f'{imei}{qualite}</div>')}
{_reception_staff(t)}
{_box("Panne",
      f'<div style="font-size:14px;font-weight:700">{_e(t.get("panne") or "Non renseignée")}</div>{detail}')}
{_box("Réparations", repairs)}
{sec_html}
{_box("Technicien", f'<div style="font-size:16px;font-weight:900;text-align:center">{_e(tech)}</div>')}
{notes_html}
{pret_html}
<div class="center" style="margin-top:12px">
  <img src="{_e(_qr_data_uri(code, base))}" alt="QR fiche ticket" style="width:130px;height:130px">
  <div style="font-size:11px;font-weight:700">Scanner pour ouvrir la fiche</div>
</div>
<div class="center" style="font-size:10px;margin-top:12px;padding-top:8px;border-top:2px solid #000">
  {_e(nom)} — Document interne<br>Ne pas remettre au client
  <div class="tiny" style="margin-top:6px">{_pied_legal_html(cfg)}<br>{_e(mentions.mention_garantie(cfg))}</div>
</div>""")


def _ticket_staff_html(t: dict, cfg: dict = None) -> str:
    """Ticket staff — format thermique 80mm, contraste max, encadrés."""
    cfg = cfg or _get_configs()
    return _thermal_doc(f"Ticket Staff - {t.get('ticket_code') or ''}", [_staff_body(t, cfg)])


def _ticket_combined_html(t: dict, cfg: dict = None) -> str:
    """Ticket client puis fiche atelier : un seul document, saut de page entre les deux."""
    cfg = cfg or _get_configs()
    return _thermal_doc(
        f"Ticket Client + Staff - {t.get('ticket_code') or ''}",
        [_client_body(t, cfg), _staff_body(t, cfg)],
    )


# ═══════════════════════════════════════════════════════════════
# DEVIS ET REÇU — FORMAT THERMIQUE 80mm
# ═══════════════════════════════════════════════════════════════

def _lignes_ht(t: dict, lignes: list, tot: dict, tva_rate: float) -> str:
    html = "".join(
        _row(r["label"], f'{_fp(round(r["prix"] * 100 / (100 + tva_rate), 2))} € HT', "row line")
        for r in lignes
    )
    if tot["reduction"] > 0:
        red_ht = round(tot["reduction"] * 100 / (100 + tva_rate), 2)
        html += _row(_label_reduction(t), f"- {_fp(red_ht)} € HT", "row line")
    return html


def _document_thermique(t: dict, cfg: dict, doc_type: str) -> str:
    cfg = _avec_mentions(cfg)
    is_devis = doc_type == "devis"
    base = _frontend_url_from(cfg.get("URL_SUIVI"))
    code = t.get("ticket_code") or ""
    tva_rate = _num(cfg.get("tva"), 20.0)
    lignes, tot = _totaux(t)
    tva = round(tot["total"] * tva_rate / (100 + tva_rate), 2)
    total_ht = round(tot["total"] - tva, 2)
    date_doc = _fd(t.get("date_depot")) if is_devis else _date_recu(t)
    nom = cfg["BOUTIQUE_NOM"]

    acompte_html = ""
    if tot["acompte"] > 0:
        acompte_html = (
            f'<div class="row line" style="padding:2px 10px"><span>Acompte :</span>'
            f'<span class="val">- {_fp(tot["acompte"])} €</span></div>'
        )
    if is_devis:
        statut_html = f'<div class="stamp" style="margin:6px 0">RESTE À PAYER : {_fp(tot["reste"])} €</div>' if tot["acompte"] > 0 else ""
        mention = " ".join(x for x in (
            "Devis valable 30 jours.", _mention_abandon(cfg, courte=True), mentions.mention_garantie(cfg)) if x)
        extra = ""
    else:
        statut_html = (
            '<div class="stamp paid" style="margin:6px 0">PAYÉ</div>' if tot["paye"]
            else f'<div class="stamp" style="margin:6px 0">RESTE À PAYER : {_fp(tot["reste"])} €</div>'
        )
        mention = " ".join(x for x in (
            "Ce ticket de garantie ne fait pas office de facture.", _mention_abandon(cfg, courte=True),
            mentions.mention_garantie(cfg)) if x)
        extra = _fidelite_section(t, cfg)

    return _section(doc_type, f"""
<div class="center">
  {_logo_html(base, alt=nom)}
  <h1>{_e(nom)}</h1>
  <div class="small">{_e(cfg.get("BOUTIQUE_ADRESSE"))}</div>
  <div class="small">Tél : {_e(cfg.get("BOUTIQUE_TEL"))}</div>
</div>
<hr class="sep-bold">
<div class="banner" style="letter-spacing:4px">{"D E V I S" if is_devis else "R E Ç U"}</div>
{_box("Informations",
      _row("N° :", _e(code)) + _row("Date :", _e(date_doc)) + _row("Appareil :", _e(_appareil(t) or "—")))}
{_box("Client", _row("Nom :", _e(_nom_client(t))) + _row("Tél :", _e(t.get("client_tel"))))}
{_box("Détail des réparations",
      _lignes_ht(t, lignes, tot, tva_rate)
      + '<div style="border-top:2px solid #000;margin-top:6px;padding-top:6px">'
      + _row("Total HT :", f'{_fp(total_ht)} €', "row line")
      + _row(f"TVA ({tva_rate:g}%) :", f'{_fp(tva)} €', "row line")
      + "</div>")}
<div class="total-box"><div class="row line"><span>TOTAL TTC :</span><span class="val">{_fp(tot["total"])} €</span></div></div>
{acompte_html}
{statut_html}
<hr class="sep">
<div class="tiny" style="padding:2px 0">{_e(mention)}</div>
{extra}
<hr class="sep">
<div class="center tiny">{_pied_legal_html(cfg)}</div>""")


def _fidelite_section(t: dict, cfg: dict = None) -> str:
    """Section fidélité pour le reçu."""
    cfg = cfg or _get_configs()
    if cfg.get("fidelite_active") != "1":
        return ""
    pts = _points_fidelite(t.get("client_id"), t)
    if pts is None:
        return ""
    palier_film = int(_num(cfg.get("fidelite_palier_film"), 1000))
    palier_reduction = int(_num(cfg.get("fidelite_palier_reduction"), 5000))
    restant = max(0, min(palier_film, palier_reduction) - pts)
    suite = (
        f'<div class="tiny">Plus que {restant} pts pour votre prochaine récompense !</div>' if restant > 0
        else '<div class="tiny bold">Récompense disponible !</div>'
    )
    return f"""
<hr class="sep">
<div class="section center">
  <div class="bold">PROGRAMME FIDÉLITÉ</div>
  <div>Vos points : <b>{pts}</b> pts</div>
  <div class="tiny" style="margin-top:2px">
    {palier_film} pts = Film verre trempé offert | {palier_reduction} pts = {_e(cfg.get("fidelite_montant_reduction"))} € de réduction
  </div>
  {suite}
</div>"""


def _devis_html(t: dict, cfg: dict = None) -> str:
    cfg = cfg or _get_configs()
    return _thermal_doc(f"Devis - {t.get('ticket_code') or ''}", [_document_thermique(t, cfg, "devis")])


def _recu_html(t: dict, cfg: dict = None) -> str:
    cfg = cfg or _get_configs()
    return _thermal_doc(f"Reçu - {t.get('ticket_code') or ''}", [_document_thermique(t, cfg, "recu")])


_GENERATEURS_HTML = {
    "client": _ticket_client_html,
    "staff": _ticket_staff_html,
    "combined": _ticket_combined_html,
    "devis": _devis_html,
    "recu": _recu_html,
}


def render_html(t: dict, doc_type: str) -> str:
    return _GENERATEURS_HTML[doc_type](t)


def html_document(html: str) -> HTMLResponse:
    return HTMLResponse(html, headers={
        "Content-Security-Policy": CSP_DOCUMENTS,
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
    })


# ═══════════════════════════════════════════════════════════════
# ROUTES
# ═══════════════════════════════════════════════════════════════

def _ticket_ou_404(ticket_id: int) -> dict:
    t = _get_ticket_full(ticket_id)
    if not t:
        raise HTTPException(404, "Ticket non trouvé")
    return t


@router.get("/{ticket_id}/print/client", response_class=HTMLResponse)
def print_client(ticket_id: int, user: dict = Depends(get_current_user)):
    return html_document(_ticket_client_html(_ticket_ou_404(ticket_id)))


@router.get("/{ticket_id}/print/staff", response_class=HTMLResponse)
def print_staff(ticket_id: int, user: dict = Depends(get_current_user)):
    return html_document(_ticket_staff_html(_ticket_ou_404(ticket_id)))


@router.get("/{ticket_id}/print/combined", response_class=HTMLResponse)
def print_combined(ticket_id: int, user: dict = Depends(get_current_user)):
    return html_document(_ticket_combined_html(_ticket_ou_404(ticket_id)))


@router.get("/{ticket_id}/print/devis", response_class=HTMLResponse)
def print_devis(ticket_id: int, user: dict = Depends(get_current_user)):
    return html_document(_devis_html(_ticket_ou_404(ticket_id)))


@router.get("/{ticket_id}/print/recu", response_class=HTMLResponse)
def print_recu(ticket_id: int, user: dict = Depends(get_current_user)):
    return html_document(_recu_html(_ticket_ou_404(ticket_id)))


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
        return f'<img src="data:image/png;base64,{_LOGO_B64}" style="height:{height}px" alt="">'
    return ""


# ═══════════════════════════════════════════════════════════════
# A4 DOCUMENT — HTML/CSS professionnel (Devis & Reçu)
# ═══════════════════════════════════════════════════════════════

def _a4_document(t: dict, doc_type: str) -> str:
    """Generate professional A4 HTML document for devis or reçu."""
    is_devis = doc_type == "devis"

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

    cfg = _get_configs()
    code = _e(t.get("ticket_code"))
    appareil = _e(_appareil(t))
    categorie = t.get("categorie")
    panne = _e(detail_public(t) or t.get("panne"))
    imei = t.get("imei")
    nom = cfg["BOUTIQUE_NOM"]
    emetteur = "<br>".join(_e(x) for x in mentions.lignes_identite(cfg)[1:])
    pied_legal = " &middot; ".join(_e(x) for x in mentions.lignes_legales(cfg))
    tva_rate = _num(cfg.get("tva"), 20.0)
    client_nom = _e(_nom_client(t))
    client_tel = _e(t.get("client_tel"))
    client_email = t.get("client_email")
    client_societe = t.get("client_societe")
    technicien = _e(t.get("technicien_assigne") or "Non assigné")
    type_ecran = str(t.get("type_ecran") or "").strip()

    repair_lines, tot = _totaux(t)
    total_ttc = tot["total"]
    tva_amount = round(total_ttc * tva_rate / (100 + tva_rate), 2)
    total_ht = round(total_ttc - tva_amount, 2)
    acompte = tot["acompte"]
    reste = tot["reste"]

    date_depot = _e(_fd(t.get("date_depot")))
    date_recup = _e(t.get("date_recuperation") or "—")
    date_doc = date_depot if is_devis else _date_recu(t)
    doc_title = "DEVIS" if is_devis else "REÇU"

    idx_ecran = index_ligne_ecran(repair_lines) if type_ecran else None
    repair_rows = ""
    for i, r in enumerate(repair_lines):
        alt = ' class="alt"' if i % 2 == 1 else ""
        ht = round(r["prix"] * 100 / (100 + tva_rate), 2)
        qb = f'<span class="qb">{_e(type_ecran)}</span>' if i == idx_ecran else ""
        repair_rows += f'<tr{alt}><td>{_e(r["label"])}</td><td class="c">{qb}</td><td class="c">1</td><td class="r">{_fp(ht)} &euro;</td></tr>'
    if not repair_lines:
        repair_rows = '<tr><td colspan="4" style="text-align:center;padding:20px;color:#A1A1AA">Aucune prestation</td></tr>'

    subtotal_ht = round(tot["subtotal"] * 100 / (100 + tva_rate), 2) if tot["subtotal"] > 0 else 0
    tots = f'<div class="tr"><span>Sous-total HT</span><span class="v">{_fp(subtotal_ht)} &euro;</span></div>'
    if tot["reduction"] > 0:
        red_ht = round(tot["reduction"] * 100 / (100 + tva_rate), 2)
        tots += f'<div class="tr grn"><span>{_e(_label_reduction(t))}</span><span class="v">-{_fp(red_ht)} &euro;</span></div>'
    tots += f'<div class="tr"><span>Total HT</span><span class="v">{_fp(total_ht)} &euro;</span></div>'
    tots += f'<div class="tr"><span>TVA ({tva_rate:g}%)</span><span class="v">{_fp(tva_amount)} &euro;</span></div>'
    tots += f'<div class="tttc" style="background:{accent}"><span>Total TTC</span><span>{_fp(total_ttc)} &euro;</span></div>'
    if acompte > 0:
        tots += f'<div class="tr grn"><span>Acompte versé</span><span class="v">-{_fp(acompte)} &euro;</span></div>'
    if reste > 0 or acompte > 0:
        tots += f'<div class="trap"><span>Reste à payer</span><span>{_fp(max(0, reste))} &euro;</span></div>'

    paye = ""
    if not is_devis and tot["paye"]:
        paye = '<div style="text-align:center;margin:12px 0"><div class="paye">PAYÉ</div></div>'

    fidel = ""
    if not is_devis and cfg.get("fidelite_active") == "1":
        pts = _points_fidelite(t.get("client_id"), t)
        if pts is not None:
            fidel = f'<div class="fidel"><span class="fl">Programme Fidélité</span><span class="fp">{pts} points</span></div>'

    cond_text = _e(_conditions_document(cfg, is_devis))
    societe_row = f'<div class="nm">{_e(client_societe)}</div>' if client_societe else ""
    email_row = f"<br>Email : {_e(client_email)}" if client_email else ""
    imei_html = f'<div class="ai">IMEI : {_e(imei)}</div>' if imei else ""
    cat_str = f" &mdash; {_e(categorie)}" if categorie and appareil else _e(categorie)

    # .replace pour les valeurs dynamiques (évite d'échapper toutes les accolades)
    css = """
@page{size:A4;margin:0}*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;color:#18181B;font-size:11px;line-height:1.5}
.pg{width:210mm;min-height:297mm;margin:0 auto;position:relative}
.tb{height:5px;background:__GRADIENT__}
.ct{padding:20px 28px 80px;overflow-wrap:anywhere}
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

    return f"""<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="{_META_CSP}">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<style>{css}</style></head><body>
<div class="pg"><div class="tb"></div><div class="ct">
<div class="hdr"><div class="hl"><div class="lk">K</div><div><div class="cn">{_e(nom)}</div>
<div class="cs">Spécialiste réparation Apple &amp; Multimarque</div></div></div>
<div class="hr"><div class="dt">{doc_title}</div><div class="dn">N° {code}</div><div class="dd">Date : {date_doc}</div></div></div>
{paye}
<div class="g2"><div><div class="bl">ÉMETTEUR</div><div class="crd"><div class="nm">{_e(mentions.raison_sociale(cfg))}</div>
<div class="dl">{emetteur}</div></div></div>
<div><div class="bl">CLIENT</div><div class="crd">{societe_row}<div class="nm">{client_nom}</div>
<div class="dl">Tél : {client_tel}{email_row}</div></div></div></div>
<div class="apc"><div><div class="am">{appareil}{cat_str}</div><div class="ap">{panne}</div></div>{imei_html}</div>
<div class="tw"><table class="rt"><thead><tr><th>Désignation</th><th class="c" style="width:90px">Qualité</th>
<th class="c" style="width:50px">Qté</th><th class="r" style="width:100px">Prix HT</th></tr></thead>
<tbody>{repair_rows}</tbody></table></div>
<div class="tots">{tots}</div>
{fidel}
<div class="g4"><div class="mc"><div class="ml">Ticket</div><div class="mv">{code}</div></div>
<div class="mc"><div class="ml">Technicien</div><div class="mv">{technicien}</div></div>
<div class="mc"><div class="ml">Date dépôt</div><div class="mv">{date_depot}</div></div>
<div class="mc"><div class="ml">Date récup.</div><div class="mv">{date_recup}</div></div></div>
<div class="cond"><div class="cdt">Conditions</div><div class="cdx">{cond_text}</div></div>
</div>
<div class="ftr"><span>{pied_legal}</span>
<span>Propulsé par TkS&infin;26 &mdash; une solution Klik&amp;Dev</span></div>
</div></body></html>"""


def _conditions_document(cfg: dict, is_devis: bool) -> str:
    """Conditions du devis ou du reçu A4 et PDF (texte brut), clause de retrait en version longue."""
    donnees = f"{cfg['BOUTIQUE_NOM']} ne peut être tenu responsable de la perte de données."
    garantie = mentions.mention_garantie(cfg)
    abandon = _mention_abandon(cfg, courte=False)
    if is_devis:
        return " ".join(x for x in (
            "Devis valable 30 jours.", garantie, donnees,
            "Un acompte de 30% est demandé à la validation du devis.", abandon) if x)
    return " ".join(x for x in (garantie, donnees, abandon) if x)


def _devis_a4_html(t: dict) -> str:
    return _a4_document(t, "devis")


def _recu_a4_html(t: dict) -> str:
    return _a4_document(t, "recu")


def _build_pdf(t: dict, doc_type: str) -> bytes:
    """Construit un PDF A4 professionnel avec fpdf2. Toute chaîne passe par _pdf_safe (police Latin-1)."""
    from fpdf import FPDF

    is_devis = doc_type == "devis"

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

    cfg = _get_configs()
    code = _pdf_safe(t.get("ticket_code"))
    appareil = _pdf_safe(_appareil(t))
    categorie = _pdf_safe(t.get("categorie"))
    panne = _pdf_safe(" ".join(str(detail_public(t) or t.get("panne") or "").split()))
    if len(panne) > 60:
        panne = panne[:57] + "..."
    imei = _pdf_safe(t.get("imei"))
    nom_boutique = _pdf_safe(cfg["BOUTIQUE_NOM"])
    tva_rate = _num(cfg.get("tva"), 20.0)
    client_nom = _pdf_safe(_nom_client(t))
    client_tel = _pdf_safe(t.get("client_tel"))
    client_email = _pdf_safe(t.get("client_email"))
    client_societe = _pdf_safe(t.get("client_societe"))
    technicien = _pdf_safe(t.get("technicien_assigne") or "Non assigné")
    type_ecran = _pdf_safe(str(t.get("type_ecran") or "").strip())

    repair_lines, tot = _totaux(t)
    subtotal_ttc = tot["subtotal"]
    reduction = tot["reduction"]
    total_ttc = tot["total"]
    tva_amount = round(total_ttc * tva_rate / (100 + tva_rate), 2)
    total_ht = round(total_ttc - tva_amount, 2)
    acompte = tot["acompte"]
    reste = tot["reste"]
    idx_ecran = index_ligne_ecran(repair_lines) if type_ecran else None

    date_depot = _pdf_safe(_fd(t.get("date_depot")))
    date_recup = _pdf_safe(t.get("date_recuperation") or "-")
    date_doc = date_depot if is_devis else _date_recu(t)

    pdf = FPDF()
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=20)
    LM = pdf.l_margin
    RM = pdf.r_margin
    pw = pdf.w - LM - RM

    def _fit(txt, w):
        """Tronque au besoin pour tenir dans w mm avec la police courante."""
        txt = _pdf_safe(" ".join(str(txt or "").split()))[:200]
        if pdf.get_string_width(txt) <= w:
            return txt
        while txt and pdf.get_string_width(txt + "...") > w:
            txt = txt[:-1]
        return txt.rstrip() + "..."

    # ── 1. TOP ACCENT BAR ──
    pdf.set_fill_color(*ACCENT)
    pdf.rect(0, 0, pdf.w, 2.5, "F")
    pdf.set_fill_color(*ACCENT2)
    pdf.rect(pdf.w * 0.5, 0, pdf.w * 0.5, 2.5, "F")

    # ── 2. HEADER ──
    hdr_y = 6
    logo_x = LM
    logo_size = 18
    pdf.set_fill_color(*RED_LOGO)
    pdf.rect(logo_x, hdr_y, logo_size, logo_size, "F")
    pdf.set_xy(logo_x, hdr_y + 2)
    pdf.set_font("Helvetica", "B", 16)
    pdf.set_text_color(*WHITE)
    pdf.cell(logo_size, logo_size - 4, "K", align="C")
    if os.path.exists(_logo_path):
        try:
            pdf.image(_logo_path, x=logo_x + 1, y=hdr_y + 1, h=logo_size - 2)
        except Exception:
            pass

    pdf.set_xy(logo_x + logo_size + 4, hdr_y + 1)
    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(*TEXT)
    pdf.cell(0, 7, nom_boutique)
    pdf.set_xy(logo_x + logo_size + 4, hdr_y + 9)
    pdf.set_font("Helvetica", "", 7.5)
    pdf.set_text_color(*TEXT_GRAY)
    pdf.cell(0, 4, "Spécialiste réparation Apple & Multimarque")

    title = "DEVIS" if is_devis else "REÇU"
    pdf.set_font("Helvetica", "B", 20)
    pdf.set_text_color(*ACCENT)
    pdf.set_xy(LM, hdr_y)
    pdf.cell(pw, 8, title, align="R")
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(*TEXT_MID)
    pdf.set_xy(LM, hdr_y + 9)
    pdf.cell(pw, 4, f"N° {code}", align="R")
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(*TEXT_GRAY)
    pdf.set_xy(LM, hdr_y + 14)
    pdf.cell(pw, 4, f"Date : {date_doc}", align="R")

    pdf.set_y(hdr_y + logo_size + 6)

    # ── PAYÉ STAMP (reçu only) ──
    if not is_devis and tot["paye"]:
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
        pdf.cell(sw, sh - 2, "PAYÉ", align="C")
        pdf.set_line_width(0.2)
        pdf.set_y(sy + sh + 3)

    # ── 3. ÉMETTEUR / CLIENT CARDS ──
    cy = pdf.get_y()
    col_w = (pw - 6) / 2

    def _draw_card(x, y, w, label, lines_list):
        h = 7 + len(lines_list) * 4.5 + 4
        pdf.set_fill_color(*CARD_BG)
        pdf.set_draw_color(*CARD_BD)
        pdf.rect(x, y, w, h, "DF")
        pdf.set_xy(x + 4, y + 3)
        pdf.set_font("Helvetica", "B", 6)
        pdf.set_text_color(*TEXT_LIGHT)
        pdf.cell(w - 8, 3, label.upper())
        for i, (txt, bold) in enumerate(lines_list):
            pdf.set_xy(x + 4, y + 7 + i * 4.5)
            pdf.set_font("Helvetica", "B" if bold else "", 8.5 if bold else 8)
            pdf.set_text_color(*TEXT if bold else TEXT_GRAY)
            pdf.cell(w - 8, 4, _fit(txt, w - 8))
        return h

    identite = [_pdf_safe(x) for x in mentions.lignes_identite(cfg)]
    em_lines = [(identite[0], True)] + [(x, False) for x in identite[1:]]
    cl_lines = []
    if client_societe:
        cl_lines.append((client_societe, True))
    cl_lines.append((client_nom, True))
    cl_lines.append((f"Tél : {client_tel}", False))
    if client_email:
        cl_lines.append((f"Email : {client_email}", False))

    h1 = _draw_card(LM, cy, col_w, "Émetteur", em_lines)
    h2 = _draw_card(LM + col_w + 6, cy, col_w, "Client", cl_lines)
    pdf.set_y(cy + max(h1, h2) + 4)

    # ── 4. APPAREIL CARD ──
    ay = pdf.get_y()
    app_h = 14
    pdf.set_fill_color(*ACCENT_BG)
    pdf.set_draw_color(*ACCENT_BD)
    pdf.rect(LM, ay, pw, app_h, "DF")
    app_txt = " - ".join(p for p in (appareil, categorie) if p) or "Appareil non renseigné"
    pdf.set_xy(LM + 5, ay + 2)
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(*TEXT)
    pdf.cell(pw * 0.6, 5, _fit(app_txt, pw * 0.6))
    pdf.set_xy(LM + 5, ay + 7.5)
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(*TEXT_MID)
    pdf.cell(pw * 0.6, 4, _fit(panne, pw * 0.6))
    if imei:
        pdf.set_xy(LM + pw * 0.6, ay + 4)
        pdf.set_font("Courier", "", 8)
        pdf.set_text_color(*TEXT_GRAY)
        pdf.cell(pw * 0.4 - 5, 5, _fit(f"IMEI : {imei}", pw * 0.4 - 5), align="R")

    pdf.set_y(ay + app_h + 4)

    # ── 5. REPAIR TABLE ──
    col_desc = pw * 0.45
    col_qual = pw * 0.20
    col_qty = pw * 0.12
    col_prix = pw * 0.23

    pdf.set_fill_color(*DARK)
    pdf.set_text_color(*WHITE)
    pdf.set_font("Helvetica", "B", 7)
    pdf.cell(col_desc, 8, "  DÉSIGNATION", fill=True)
    pdf.cell(col_qual, 8, "QUALITÉ", align="C", fill=True)
    pdf.cell(col_qty, 8, "QTÉ", align="C", fill=True)
    pdf.cell(col_prix, 8, "PRIX HT", align="R", fill=True, new_x="LMARGIN", new_y="NEXT")

    for i, r in enumerate(repair_lines):
        bg = CARD_BG if i % 2 == 1 else WHITE
        pdf.set_fill_color(*bg)
        ht = round(r["prix"] * 100 / (100 + tva_rate), 2)
        pdf.set_text_color(*TEXT)
        pdf.set_font("Helvetica", "", 8.5)
        pdf.cell(col_desc, 8, "  " + _fit(r["label"], col_desc - 4), fill=True)
        if i == idx_ecran:
            bx = pdf.get_x()
            by = pdf.get_y()
            pdf.set_font("Helvetica", "B", 6.5)
            badge_txt = _fit(type_ecran, col_qual - 8)
            badge_w = pdf.get_string_width(badge_txt) + 6
            badge_x = bx + (col_qual - badge_w) / 2
            pdf.set_fill_color(*bg)
            pdf.rect(bx, by, col_qual, 8, "F")
            pdf.set_fill_color(*VIOLET_BG)
            pdf.rect(badge_x, by + 1.5, badge_w, 5, "F")
            pdf.set_xy(badge_x, by + 1.5)
            pdf.set_text_color(*VIOLET)
            pdf.cell(badge_w, 5, badge_txt, align="C")
            pdf.set_xy(bx + col_qual, by)
            pdf.set_fill_color(*bg)
        else:
            pdf.cell(col_qual, 8, "", fill=True)
        pdf.set_text_color(*TEXT_MID)
        pdf.set_font("Helvetica", "", 8.5)
        pdf.cell(col_qty, 8, "1", align="C", fill=True)
        pdf.set_text_color(*TEXT)
        pdf.set_font("Helvetica", "B", 8.5)
        pdf.cell(col_prix, 8, f"{_fp(ht)}{euro}", align="R", fill=True, new_x="LMARGIN", new_y="NEXT")
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
        red_ht = round(reduction * 100 / (100 + tva_rate), 2)
        _trow(_label_reduction(t), f"-{_fp(red_ht)}{euro}", "green")
    _trow("Total HT", f"{_fp(total_ht)}{euro}")
    _trow(f"TVA ({tva_rate:g}%)", f"{_fp(tva_amount)}{euro}")
    pdf.ln(1)
    _trow("Total TTC", f"{_fp(total_ttc)}{euro}", "ttc")
    if acompte > 0:
        _trow("Acompte versé", f"-{_fp(acompte)}{euro}", "green")
    if reste > 0 or acompte > 0:
        _trow("Reste à payer", f"{_fp(max(0, reste))}{euro}", "reste")

    # ── FIDÉLITÉ (reçu only) ──
    if not is_devis and cfg.get("fidelite_active") == "1":
        pts = _points_fidelite(t.get("client_id"), t)
        if pts is not None:
            pdf.ln(5)
            fy = pdf.get_y()
            pdf.set_fill_color(245, 243, 255)
            pdf.set_draw_color(221, 214, 254)
            pdf.rect(LM, fy, pw, 12, "DF")
            pdf.set_xy(LM + 5, fy + 2)
            pdf.set_font("Helvetica", "B", 6.5)
            pdf.set_text_color(*VIOLET)
            pdf.cell(40, 3, "PROGRAMME FIDÉLITÉ")
            pdf.set_xy(LM + 5, fy + 6)
            pdf.set_font("Helvetica", "", 8.5)
            pdf.set_text_color(91, 33, 182)
            pdf.cell(pw - 10, 4, f"Vos points : {pts} pts")
            pdf.set_y(fy + 14)

    # ── 7. INFOS COMPLÉMENTAIRES — 4 mini cards ──
    pdf.ln(4)
    iy = pdf.get_y()
    mc_w = (pw - 9) / 4
    mc_h = 12
    infos = [
        ("Ticket", code),
        ("Technicien", technicien),
        ("Date dépôt", date_depot),
        ("Date récup.", date_recup),
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
        pdf.cell(mc_w - 6, 4, _fit(val, mc_w - 6))
    pdf.set_y(iy + mc_h + 4)

    # ── 8. CONDITIONS ──
    cy = pdf.get_y()
    cond = _pdf_safe(_conditions_document(cfg, is_devis))

    cond_w = pw - 8
    pdf.set_font("Helvetica", "", 7)
    nb_lines = max(1, len(pdf.multi_cell(cond_w, 3.5, cond, dry_run=True, output="LINES")))
    cond_h = 8 + nb_lines * 3.5
    # Encadré d'un seul tenant : sinon le texte déborde sous le cadre, à la page suivante
    if cy + cond_h > pdf.h - pdf.b_margin:
        pdf.add_page()
        cy = pdf.get_y()

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
    ft_h = 12
    footer_y = pdf.h - ft_h
    pdf.set_fill_color(*DARK)
    pdf.rect(0, footer_y, pdf.w, ft_h, "F")
    pdf.set_font("Helvetica", "", 6.5)
    pdf.set_text_color(*TEXT_GRAY)
    pdf.set_xy(LM, footer_y + 2)
    legal = " · ".join([mentions.raison_sociale(cfg), *mentions.lignes_legales(cfg)])
    pdf.cell(pw, 4, _fit(legal, pw))
    pdf.set_xy(LM, footer_y + 6.5)
    pdf.cell(pw * 0.5, 4, _fit(f"{'Devis' if is_devis else 'Reçu'} n° {code} du {date_doc}", pw * 0.5))
    pdf.set_xy(LM + pw * 0.5, footer_y + 6.5)
    pdf.cell(pw * 0.5, 4, "Propulsé par TkS26 - une solution Klik&Dev", align="R")

    return bytes(pdf.output())


def pdf_ticket(t: dict, doc_type: str) -> tuple:
    """(pdf_bytes, filename) pour un ticket déjà chargé."""
    code = re.sub(r"[^A-Za-z0-9_-]", "", str(t.get("ticket_code") or "")) or "document"
    filename = f"{'Devis' if doc_type == 'devis' else 'Recu'}-{code}.pdf"
    return _build_pdf(t, doc_type), filename


def generate_pdf(ticket_id: int, doc_type: str) -> tuple:
    """Génère un PDF A4 pour un ticket. Retourne (pdf_bytes, filename)."""
    if doc_type not in ("devis", "recu"):
        return None, None
    t = _get_ticket_full(ticket_id)
    if not t:
        return None, None
    return pdf_ticket(t, doc_type)


def pdf_response(pdf_bytes: bytes, filename: str) -> Response:
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Cache-Control": "no-store",
            "X-Robots-Tag": "noindex, nofollow",
        },
    )


@router.get("/{ticket_id}/pdf/{doc_type}")
def download_pdf(ticket_id: int, doc_type: str, user: dict = Depends(get_current_user)):
    """Télécharge le PDF A4 d'un devis ou reçu."""
    if doc_type not in ("devis", "recu"):
        raise HTTPException(400, "Type non supporté. Utilisez 'devis' ou 'recu'.")
    pdf_bytes, filename = generate_pdf(ticket_id, doc_type)
    if not pdf_bytes:
        raise HTTPException(404, "Ticket non trouvé ou erreur de génération PDF")
    return pdf_response(pdf_bytes, filename)
