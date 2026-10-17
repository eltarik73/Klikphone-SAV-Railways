"""
API Notifications — messages prédéfinis, WhatsApp, SMS, Email.
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from app.database import get_cursor
from app.models import SendMessageRequest, SmsSendRequest
from app.api.auth import get_current_user
from app.services.notifications import (
    MESSAGES_PREDEFINIES, generer_message,
    wa_link, sms_link,
)
from app.api.email_api import _send_email
from app.services import sms

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def numero_joignable(row: dict) -> tuple:
    """(numéro, autre) : tout message au client part vers tickets.tel_contact s'il est
    renseigné (numéro pour le joindre pendant la réparation), sinon vers le téléphone
    de la fiche client. `autre` vaut True quand c'est le second numéro.
    Même règle que telJoignable() côté écrans (frontend/src/lib/contact.js)."""
    tel_contact = str((row or {}).get("tel_contact") or "").strip()
    if tel_contact:
        return tel_contact, True
    return (row or {}).get("telephone"), False


def _libelle_numero(affiche: str, autre: bool) -> str:
    return f"{affiche} (autre numéro)" if autre else affiche


@router.get("/templates")
def list_templates():
    """Liste les templates de messages prédéfinis."""
    return [
        {"key": k, "titre": v["titre"]}
        for k, v in MESSAGES_PREDEFINIES.items()
    ]


@router.post("/generate-message")
def generate_message(
    ticket_id: int,
    template_key: str,
    user: dict = Depends(get_current_user),
):
    """Génère un message à partir d'un template et des données du ticket."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT t.*, c.nom as client_nom, c.prenom as client_prenom,
                   c.telephone as client_tel, c.email as client_email
            FROM tickets t JOIN clients c ON t.client_id = c.id
            WHERE t.id = %s
        """, (ticket_id,))
        row = cur.fetchone()

    if not row:
        raise HTTPException(404, "Ticket non trouvé")

    template = MESSAGES_PREDEFINIES.get(template_key)
    if not template:
        raise HTTPException(400, f"Template '{template_key}' non trouvé")

    message = generer_message(template_key, row, row)
    return {"message": message, "titre": template["titre"]}


@router.post("/whatsapp")
def send_whatsapp(
    ticket_id: int,
    message: str,
    user: dict = Depends(get_current_user),
):
    """Génère un lien WhatsApp et marque le ticket."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT t.ticket_code, c.telephone, t.tel_contact
            FROM tickets t JOIN clients c ON t.client_id = c.id
            WHERE t.id = %s
        """, (ticket_id,))
        row = cur.fetchone()

    numero, autre = numero_joignable(row)
    if not row or not numero:
        raise HTTPException(400, "Pas de numéro de téléphone")

    link = wa_link(numero, message)

    with get_cursor() as cur:
        cur.execute("UPDATE tickets SET msg_whatsapp = 1 WHERE id = %s", (ticket_id,))

    return {"link": link, "destinataire": numero, "autre_numero": autre}


@router.get("/sms/etat")
def sms_etat(user: dict = Depends(get_current_user)):
    """Envoi des SMS par le serveur (Brevo) activé et clé présente ? Jamais la clé."""
    return sms.etat()


@router.get("/sms/credits")
def sms_credits(user: dict = Depends(get_current_user)):
    """Solde de crédits SMS du compte Brevo."""
    res = sms.credits()
    if not res["ok"]:
        statut = 409 if res["code"] == "sms_non_configure" else 424
        raise HTTPException(statut, {"code": res["code"], "message": res["erreur"]})
    return {"credits": res["credits"]}


def _refus(statut: int, code: str, message: str, **extra):
    raise HTTPException(statut, {"code": code, "message": message, **extra})


def numero_client_sms(row: dict):
    """Téléphone de la fiche client, affiché (06 12 34 56 78 / +41…), s'il peut recevoir
    un SMS ; None sinon (fixe, vide, inutilisable)."""
    numero = sms.numero_international((row or {}).get("telephone"))
    if not numero or (numero.startswith("33") and not sms.est_mobile_fr(numero)):
        return None
    return sms.numero_affiche(numero)


def _refus_numero(code: str, message: str, row: dict, autre: bool):
    """Numéro inutilisable pour un SMS. Quand c'est le second numéro du ticket (tel_contact),
    le dire et donner le téléphone du client (`numero_client`), pour que l'écran puisse
    proposer d'envoyer au numéro principal ou d'effacer tel_contact dans la fiche."""
    if not autre:
        _refus(400, code, message, autre_numero=False)
    repli = numero_client_sms(row)
    conseil = (f" Envoyez au {repli} (téléphone du client) ou effacez-le dans la fiche."
               if repli else " Corrigez-le ou effacez-le dans la fiche du ticket.")
    _refus(400, code, f"{message} — c'est le numéro pour vous joindre donné au dépôt.{conseil}",
           autre_numero=True, numero_client=repli)


@router.post("/sms")
def send_sms(data: SmsSendRequest, user: dict = Depends(get_current_user)):
    """Envoie un vrai SMS au client du ticket via Brevo (route def : appel réseau en threadpool).

    Envoi serveur désactivé ou clé absente : 409 « sms_non_configure » avec le lien sms:
    de repli (l'app Messages du poste). Refus ou panne de Brevo : 424 avec un message
    lisible (jamais de 5xx, que le proxy Railway pourrait réécrire). Chaque tentative
    réelle laisse une note 'sms' sur le ticket (envoyé ou échec) ; msg_sms passe à 1
    seulement si Brevo a accepté le SMS. Même texte au même numéro : un envoi par minute.
    Destinataire : tickets.tel_contact s'il est renseigné, sinon le téléphone du client
    (numero_joignable) ; la note dit lequel a été utilisé.
    """
    texte = sms.normaliser_texte(data.message)
    if not texte:
        _refus(400, "message_vide", "Message vide")

    with get_cursor() as cur:
        cur.execute("""
            SELECT t.ticket_code, c.telephone, t.tel_contact
            FROM tickets t JOIN clients c ON t.client_id = c.id
            WHERE t.id = %s
        """, (data.ticket_id,))
        row = cur.fetchone()
        etat = sms.etat(cur)

    if not row:
        raise HTTPException(404, "Ticket non trouvé")
    # Second numéro du ticket d'abord (le téléphone du client est peut-être sur l'établi)
    brut, autre = numero_joignable(row)
    if not brut:
        _refus(400, "pas_de_telephone", "Pas de numéro de téléphone pour ce client")

    if not etat["disponible"]:
        message = ("Envoi des SMS par le serveur désactivé" if etat["cle_configuree"]
                   else "Clé API Brevo absente du serveur (variable BREVO_API_KEY)")
        _refus(409, "sms_non_configure", message, link=sms_link(brut, texte), autre_numero=autre)

    numero = sms.numero_international(brut)
    if not numero:
        _refus_numero("numero_invalide", f"Numéro « {brut} » inutilisable pour un SMS", row, autre)
    if numero.startswith("33") and not sms.est_mobile_fr(numero):
        _refus_numero("numero_fixe",
                      f"Le {sms.numero_affiche(numero)} n'est pas un portable (06 ou 07) : SMS impossible",
                      row, autre)

    cle = sms.AntiDoublon.cle(numero, texte)
    depuis = sms.ANTI_DOUBLON.reserver(cle)
    if depuis is not None:
        _refus(409, "sms_doublon",
               f"Ce SMS vient déjà d'être envoyé à ce numéro (il y a {max(1, int(depuis))} s)")

    nb = sms.segments(texte)
    try:
        res = sms.envoyer(numero, texte, tags=[row["ticket_code"]])
    except Exception:
        sms.ANTI_DOUBLON.liberer(cle)
        raise
    if not res.ok and not res.incertain:
        sms.ANTI_DOUBLON.liberer(cle)

    libelle = f"[{data.libelle.strip()}] " if data.libelle and data.libelle.strip() else ""
    dest = sms.numero_affiche(numero)
    # La note dit à quel numéro le SMS est parti : « (autre numéro) » quand c'est tel_contact
    vers = _libelle_numero(dest, autre)
    if res.ok:
        entete = f"✅ SMS envoyé au {vers} ({nb} SMS, Brevo)"
    else:
        entete = f"⚠️ SMS NON envoyé au {vers} — {res.erreur}"
    # 'sms_echec' : l'icône « déjà contacté » du dashboard se base sur type_note = 'sms'
    type_note = "sms" if res.ok else "sms_echec"
    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO notes_tickets (ticket_id, auteur, contenu, important, type_note)
            VALUES (%s, %s, %s, FALSE, %s)
        """, (data.ticket_id, user.get("sub") or "Staff", f"{entete}\n{libelle}{texte}", type_note))
        if res.ok:
            cur.execute("UPDATE tickets SET msg_sms = 1 WHERE id = %s", (data.ticket_id,))

    if not res.ok:
        _refus(424, res.code, res.erreur)
    return {"ok": True, "message_id": res.message_id, "segments": nb, "destinataire": dest,
            "autre_numero": autre}


@router.post("/email")
def send_email_notification(
    ticket_id: int,
    message: str,
    sujet: str = "Klikphone - Mise à jour de votre réparation",
    user: dict = Depends(get_current_user),
):
    """Envoie un email au client (route synchrone : SQL et SMTP dans le threadpool)."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT t.ticket_code, c.email
            FROM tickets t JOIN clients c ON t.client_id = c.id
            WHERE t.id = %s
        """, (ticket_id,))
        row = cur.fetchone()

    if not row or not row["email"]:
        raise HTTPException(400, "Pas d'adresse email")

    success, msg = _send_email(row["email"], sujet, message)

    if success:
        with get_cursor() as cur:
            cur.execute("UPDATE tickets SET msg_email = 1 WHERE id = %s", (ticket_id,))

    return {"success": success, "message": msg}
