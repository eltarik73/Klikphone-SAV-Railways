"""
API Étagère : emplacement physique des appareils terminés, relances graduées,
courrier de mise en demeure (loi du 31 décembre 1903). Liste : vue a_recuperer de
GET /api/tickets/stats/dashboard ; règles : services/etagere.py.
"""

import re
from datetime import date, datetime, timedelta, timezone
from html import escape
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field, field_validator

from app.database import get_cursor
from app.api.auth import get_current_user
from app.services import etagere
from app.services.montants import calculer_montants, format_euros
from app.services.notifications import generer_message
from app.services.search import SqlParams

router = APIRouter(prefix="/api/etagere", tags=["Étagère"])

_EN_BOUTIQUE = "Réparation terminée"
_TRACE_MISE_EN_DEMEURE = "Mise en demeure imprimée"
# Aperçu puis impression, ou double clic : une seule ligne d'historique par quart d'heure
_TRACE_ANTI_DOUBLON = timedelta(minutes=15)

# Mêmes en-têtes que les impressions (print_tickets) : aperçu en srcdoc, aucun script
_CSP_DOCUMENT = (
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; "
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
)
_META_CSP = "script-src 'none'; object-src 'none'; base-uri 'none'"

_MOIS = ("janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
         "septembre", "octobre", "novembre", "décembre")


class EmplacementIn(BaseModel):
    emplacement: Optional[str] = Field(None, max_length=200)

    @field_validator("emplacement")
    @classmethod
    def _normaliser(cls, v):
        return etagere.normaliser_emplacement(v)


class RelanceIn(BaseModel):
    canal: Literal["sms", "whatsapp", "email", "appel"]
    contenu: str = Field("", max_length=5000)


def _auteur(user) -> str:
    return (user or {}).get("sub") or "Staff"


def _historiser(cur, ticket_id: int, journal: Optional[str], texte: str, auteur: str):
    """Ligne signée dans la table historique et dans le journal texte du ticket (comme la fiche)."""
    contenu = f"{texte} — par {auteur}"
    cur.execute("INSERT INTO historique (ticket_id, type, contenu) VALUES (%s, 'etagere', %s)",
                (ticket_id, contenu))
    ligne = f"[{datetime.now().strftime('%d/%m %H:%M')}] {contenu}"
    h = (journal or "").rstrip()
    cur.execute("UPDATE tickets SET historique = %s WHERE id = %s",
                (f"{h}\n{ligne}" if h else ligne, ticket_id))


def _compteurs(cur, ticket_id: int) -> dict:
    sp = SqlParams()
    rel = etagere.relances_sql(etagere.fin_reparation_sql(sp, "t"), "t")
    cur.execute(f"""
        SELECT (SELECT COUNT(*) {rel}) AS nb_relances, (SELECT MAX(n.date_creation) {rel}) AS derniere_relance
        FROM tickets t WHERE t.id = {sp.add(ticket_id)}
    """, sp.values)
    row = cur.fetchone() or {}
    derniere = row.get("derniere_relance")
    return {"nb_relances": int(row.get("nb_relances") or 0),
            "derniere_relance": derniere.isoformat() if derniere else None}


def _ticket_etagere(cur, ticket_id: int, verrou: bool = False) -> dict:
    """Ticket + client (ligne complète en JSON : adresse si la colonne existe) + colonnes d'étagère."""
    sp = SqlParams()
    cur.execute(f"""
        SELECT t.*, c.nom AS client_nom, c.prenom AS client_prenom, c.telephone AS client_tel,
               c.email AS client_email, c.societe AS client_societe, row_to_json(c) AS client
               {etagere.colonnes_sql(sp, "t")}
        FROM tickets t JOIN clients c ON c.id = t.client_id
        WHERE t.id = {sp.add(ticket_id)}
        {"FOR UPDATE OF t" if verrou else ""}
    """, sp.values)
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Ticket non trouvé")
    return dict(row)


def _exiger_en_boutique(t: dict, jours_min: int = 0) -> int:
    jours = etagere.jours_depuis(t.get("fin_reparation")) or 0
    if t.get("statut") != _EN_BOUTIQUE:
        raise HTTPException(409, detail={"code": "pas_en_boutique",
                                         "message": "L'appareil n'attend pas son client en boutique."})
    if jours < jours_min:
        raise HTTPException(409, detail={"code": "trop_tot", "jours": jours,
                                         "message": f"Courrier proposé à partir de J+{jours_min} (J+{jours})."})
    return jours


@router.get("/config")
def get_config(user: dict = Depends(get_current_user)):
    """Emplacements proposés, délai d'abandon et paliers de relance (paramètres ETAGERE_*)."""
    return etagere.config()


@router.put("/{ticket_id}/emplacement")
def set_emplacement(ticket_id: int, data: EmplacementIn, user: dict = Depends(get_current_user)):
    """Range l'appareil (« B3 », 20 caractères max, majuscules) ; null le retire.

    Appareil déjà rendu ou clôturé : 409, il n'est plus sur l'étagère (le retrait reste permis).
    """
    nouveau = data.emplacement
    with get_cursor() as cur:
        cur.execute("SELECT id, statut, emplacement, historique FROM tickets WHERE id = %s FOR UPDATE",
                    (ticket_id,))
        t = cur.fetchone()
        if not t:
            raise HTTPException(404, "Ticket non trouvé")
        if nouveau and t.get("statut") in etagere.STATUTS_RENDUS:
            raise HTTPException(409, detail={"code": "deja_rendu",
                                             "message": "Appareil déjà rendu : il n'est plus sur l'étagère."})
        ancien = t.get("emplacement")
        if ancien == nouveau:
            return {"emplacement": nouveau}
        cur.execute("UPDATE tickets SET emplacement = %s WHERE id = %s", (nouveau, ticket_id))
        if nouveau:
            texte = f"Rangé en {nouveau}" + (f" (avant : {ancien})" if ancien else "")
        else:
            texte = f"Emplacement {ancien} libéré"
        _historiser(cur, ticket_id, t.get("historique"), texte, _auteur(user))
    return {"emplacement": nouveau}


_LIBELLES_CANAL = {"sms": "SMS", "whatsapp": "WhatsApp", "email": "E-mail"}


@router.post("/{ticket_id}/relance")
def log_relance(ticket_id: int, data: RelanceIn, user: dict = Depends(get_current_user)):
    """Trace une relance (note du canal ; appel → note « relance ») et renvoie le compteur."""
    contenu = data.contenu.strip()
    if data.canal == "appel":
        type_note = "relance"
        contenu = f"Appel téléphonique : {contenu}" if contenu else "Appel téléphonique"
    else:
        type_note = data.canal
        contenu = contenu or f"Relance par {_LIBELLES_CANAL[data.canal]}"
    with get_cursor() as cur:
        cur.execute("SELECT id FROM tickets WHERE id = %s", (ticket_id,))
        if not cur.fetchone():
            raise HTTPException(404, "Ticket non trouvé")
        cur.execute("""
            INSERT INTO notes_tickets (ticket_id, auteur, contenu, important, type_note)
            VALUES (%s, %s, %s, FALSE, %s)
        """, (ticket_id, _auteur(user), contenu, type_note))
        return _compteurs(cur, ticket_id)


@router.get("/{ticket_id}/message-relance")
def message_relance(ticket_id: int, user: dict = Depends(get_current_user)):
    """Message de relance déjà rendu, au ton du palier atteint par les jours d'attente."""
    with get_cursor() as cur:
        t = _ticket_etagere(cur, ticket_id)
    jours = _exiger_en_boutique(t)
    return {"message": generer_message("relance", t, t, jours=jours), "jours": jours}


# ─── Courrier de mise en demeure (A4) ──────────────────────────

def _e(v) -> str:
    return "" if v is None else escape(str(v), quote=True)


def _date_longue(v) -> str:
    j = v if isinstance(v, date) and not isinstance(v, datetime) else etagere.jour_local(v)
    if not j:
        return "date inconnue"
    return f"{'1er' if j.day == 1 else j.day} {_MOIS[j.month - 1]} {j.year}"


def _appareil(t: dict) -> str:
    modele = t.get("modele") if t.get("modele") and t.get("modele") != "Autre" else t.get("modele_autre")
    return " ".join(str(v).strip() for v in (t.get("marque"), modele) if v and str(v).strip()) \
        or t.get("categorie") or "Appareil"


def _ville(adresse: str) -> str:
    m = re.search(r"\b\d{5}\s+([^,\n]+)\s*$", adresse or "")
    return m.group(1).strip() if m else ""


def _adresse_client(client: dict) -> list:
    client = client or {}
    lignes = [client.get("adresse")]
    lignes.append(" ".join(str(v).strip() for v in (client.get("code_postal"), client.get("ville")) if v))
    return [str(v).strip() for v in lignes if v and str(v).strip()]


_CSS = """
@page{size:A4;margin:16mm 18mm}
*{box-sizing:border-box;margin:0;padding:0}
body{background:#E5E7EB;color:#111827;font:11pt/1.5 Helvetica,Arial,sans-serif}
.page{width:210mm;min-height:297mm;margin:24px auto;padding:16mm 18mm;background:#fff;
  box-shadow:0 2px 12px rgba(15,23,42,.18);overflow-wrap:anywhere}
.entete{display:flex;justify-content:space-between;gap:24px;margin-bottom:22px}
.exp .nom{font-size:15pt;font-weight:700}
.exp,.dest{font-size:10pt;line-height:1.45}
.dest{min-width:72mm;padding-top:18mm}
.dest .nom{font-weight:700}
.envoi{font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}
.lieu{text-align:right;margin:4px 0 18px}
.objet{font-weight:700;margin-bottom:16px}
p{margin-bottom:10px;text-align:justify}
table{width:100%;border-collapse:collapse;margin:6px 0 14px;font-size:10pt}
th,td{border:1px solid #9CA3AF;padding:5px 8px;text-align:left;vertical-align:top}
th{background:#F3F4F6;font-weight:700}
.recap th{width:38%}
h2{font-size:10.5pt;margin:14px 0 4px}
.loi{border-left:3px solid #111827;padding:6px 10px;background:#F9FAFB;font-size:10pt}
.signature{margin-top:22px;margin-left:auto;width:72mm}
.cadre{height:28mm;border:1px dashed #6B7280;margin-top:6px;display:flex;align-items:flex-end;
  justify-content:center;padding-bottom:4px;font-size:8.5pt;color:#4B5563}
.pied{margin-top:26px;border-top:1px solid #D1D5DB;padding-top:6px;font-size:8.5pt;color:#4B5563;text-align:center}
@media screen and (max-width:820px){
  .page{width:auto;min-height:0;margin:0;padding:16px;box-shadow:none}
  .entete{flex-direction:column;gap:12px}.dest{padding-top:0;min-width:0}.signature{width:auto}
}
@media print{
  body{background:#fff}
  .page{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}
  body *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  table,.loi,.signature{break-inside:avoid}
}
"""


def html_mise_en_demeure(t: dict, relances: list, boutique: dict, jours: int,
                         aujourdhui=None) -> str:
    """Courrier A4 : toute valeur issue des données passe par _e()."""
    aujourdhui = aujourdhui or datetime.now(timezone.utc)
    client = t.get("client") or {}
    nom_client = " ".join(str(v).strip() for v in (client.get("prenom") or t.get("client_prenom"),
                                                   client.get("nom") or t.get("client_nom")) if v) or "Client"
    societe = client.get("societe") or t.get("client_societe")
    code = t.get("ticket_code") or f"#{t.get('id')}"
    reste = calculer_montants(t)["reste"]
    delai = etagere.MISE_EN_DEMEURE_DELAI_RETRAIT
    ville = _ville(boutique["adresse"])

    exp = [f'<div class="nom">{_e(boutique["nom"])}</div>', f"<div>{_e(boutique['adresse'])}</div>",
           f"<div>Tél. : {_e(boutique['tel'])}</div>"]
    if boutique["email"]:
        exp.append(f"<div>{_e(boutique['email'])}</div>")
    if boutique["siret"]:
        exp.append(f"<div>SIRET : {_e(boutique['siret'])}</div>")
    dest = [f'<div class="envoi">Lettre recommandée avec accusé de réception</div>']
    if societe:
        dest.append(f'<div class="nom">{_e(societe)}</div>')
    dest.append(f'<div class="nom">{_e(nom_client)}</div>')
    dest += [f"<div>{_e(l)}</div>" for l in _adresse_client(client)]

    imei = (t.get("imei") or "").strip()
    recap = [
        ("Appareil", _appareil(t) + (f" (IMEI / n° de série : {imei})" if imei else "")),
        ("N° de ticket", code),
        ("Date de dépôt", _date_longue(t.get("date_depot"))),
        ("Fin de réparation", f"{_date_longue(t.get('fin_reparation'))} (il y a {jours} jours)"),
        ("Montant restant dû", f"{format_euros(reste)} €"),
    ]
    lignes_recap = "".join(f"<tr><th scope=\"row\">{_e(k)}</th><td>{_e(v)}</td></tr>" for k, v in recap)
    if relances:
        corps = "".join(
            f"<tr><td>{_e(_date_longue(r['date_creation']))}</td>"
            f"<td>{_e(etagere.canal_relance(r.get('type_note'), r.get('contenu')))}</td></tr>"
            for r in relances)
        tableau_relances = ('<table><thead><tr><th scope="col">Date</th><th scope="col">Canal</th>'
                            f"</tr></thead><tbody>{corps}</tbody></table>")
        if len(relances) == 1:
            constat = (f"Malgré notre message du {_e(_date_longue(relances[0]['date_creation']))},"
                       " il n'a toujours pas été retiré.")
        else:
            constat = (f"Malgré nos {len(relances)} messages et relances (voir ci-dessous),"
                       " il n'a toujours pas été retiré.")
    else:
        tableau_relances = "<p>Aucune relance enregistrée à ce jour.</p>"
        constat = "À ce jour, il n'a toujours pas été retiré."
    paiement = (f" et de régler à cette occasion la somme restant due de {_e(format_euros(reste))} €"
                if reste > 0 else "")
    contact = _e(boutique["tel"]) + (f" ou par e-mail à {_e(boutique['email'])}" if boutique["email"] else "")
    lieu = f"Fait à {_e(ville)}, le {_date_longue(aujourdhui)}" if ville else f"Le {_date_longue(aujourdhui)}"
    pied = " · ".join(_e(v) for v in (boutique["nom"], boutique["adresse"],
                                       f"SIRET {boutique['siret']}" if boutique["siret"] else "") if v)

    return f"""<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="{_META_CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mise en demeure — {_e(code)}</title>
<style>{_CSS}</style></head>
<body><main class="page">
<div class="entete"><div class="exp">{"".join(exp)}</div><div class="dest">{"".join(dest)}</div></div>
<p class="lieu">{lieu}</p>
<p class="objet">Objet : mise en demeure de retirer votre appareil — ticket {_e(code)}</p>
<p>Madame, Monsieur,</p>
<p>Le {_e(_date_longue(t.get("date_depot")))}, vous nous avez confié votre appareil {_e(_appareil(t))}
(ticket {_e(code)}). Il est prêt et à votre disposition dans notre boutique depuis le
{_e(_date_longue(t.get("fin_reparation")))}, soit depuis {jours} jours. {constat}</p>
<table class="recap"><tbody>{lignes_recap}</tbody></table>
<h2>Messages et relances envoyés</h2>
{tableau_relances}
<p>Par la présente, nous vous mettons en demeure de venir retirer votre appareil dans un délai
de <strong>{delai} jours</strong> à compter de la réception de ce courrier{paiement}, aux heures
d'ouverture de la boutique ({_e(boutique["horaires"])}), muni(e) de ce courrier ou de votre ticket de
dépôt et d'une pièce d'identité.</p>
<p class="loi">Nous vous rappelons qu'en application de la loi du 31 décembre 1903 relative à la vente
de certains objets abandonnés, les objets confiés à un professionnel pour être réparés et non retirés
dans le délai d'un an peuvent être vendus aux enchères publiques, uniquement sur autorisation du juge ;
le produit de la vente sert alors à régler les sommes qui nous sont dues. Sans nouvelles de votre part,
nous nous réservons le droit d'engager cette procédure.</p>
<p>Pour toute question, vous pouvez nous joindre au {contact}.</p>
<p>Veuillez agréer, Madame, Monsieur, l'expression de nos salutations distinguées.</p>
<div class="signature"><div>Pour {_e(boutique["nom"])},</div><div class="cadre">Signature et cachet</div></div>
<div class="pied">{pied}</div>
</main></body></html>"""


@router.get("/{ticket_id}/mise-en-demeure", response_class=HTMLResponse)
def mise_en_demeure(ticket_id: int, user: dict = Depends(get_current_user)):
    """Courrier A4 imprimable (appareil en boutique depuis 90 jours ou plus), tracé dans l'historique."""
    with get_cursor() as cur:
        t = _ticket_etagere(cur, ticket_id, verrou=True)
        jours = _exiger_en_boutique(t, etagere.MISE_EN_DEMEURE_JOURS)
        # Mêmes messages que nb_relances de la vue (envoyés depuis la fin de réparation)
        cur.execute("""
            SELECT date_creation, type_note, contenu FROM notes_tickets
            WHERE ticket_id = %s AND type_note = ANY(%s) AND date_creation >= %s
            ORDER BY date_creation, id
        """, (ticket_id, list(etagere.TYPES_RELANCE), t.get("fin_reparation")))
        relances = cur.fetchall() or []
        cur.execute("""
            SELECT 1 FROM historique WHERE ticket_id = %s AND type = 'etagere'
              AND contenu LIKE %s AND date_creation > CURRENT_TIMESTAMP - %s::interval
        """, (ticket_id, _TRACE_MISE_EN_DEMEURE + "%",
              f"{int(_TRACE_ANTI_DOUBLON.total_seconds())} seconds"))
        if not cur.fetchone():
            _historiser(cur, ticket_id, t.get("historique"), _TRACE_MISE_EN_DEMEURE, _auteur(user))
        boutique = etagere.identite_boutique(cur)
    html = html_mise_en_demeure(t, relances, boutique, jours)
    return HTMLResponse(html, headers={
        "Content-Security-Policy": _CSP_DOCUMENT,
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
    })
