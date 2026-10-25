"""
API Suivi client — endpoints publics (sans auth), sauf les interactions du dashboard.
Message client, validation devis, avis.

Les codes KP-000123 sont séquentiels, donc devinables : AUCUNE donnée d'un ticket n'est
rendue au seul code. Toute route publique par code (fiche, commandes, avis, fidélité,
grattage, actions) passe par `preuve_suivi`, qui exige l'une de ces preuves :
  - `t`   : le jeton du lien de suivi (QR imprimé, liens envoyés) ;
  - `tel` : le numéro de téléphone COMPLET donné au dépôt (fiche client ou second
            numéro de contact du ticket), quel que soit son format ;
  - une session du personnel (le staff n'a pas besoin de preuve).
Refus : 403 {"code": "preuve_requise" | "verification_echouee" | "lien_invalide"}.
Un code inexistant reçoit, sans session du personnel, EXACTEMENT la même réponse qu'un code
existant sans preuve (pas d'oracle 404/403 sur la suite séquentielle) ; 404 réservé au staff.
"""

import logging
import re
import secrets
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from typing import Optional
from app.database import get_cursor
from app.api.auth import (
    client_ip, decode_token, get_current_user, jeton_revoque, noter_echec, noter_succes, verifier_essais,
)
from app.api.notifications_center import push_notification
from app.api.public_documents import LimiteurDebit, jeton_perime
from app.services import contact
from app.services import search as search_engine
from app.services.poll_cache import PollCache, cached_json

try:
    from zoneinfo import ZoneInfo
    _PARIS = ZoneInfo("Europe/Paris")
except Exception:  # image sans base tz : heure du serveur
    _PARIS = None

router = APIRouter(prefix="/api/suivi", tags=["suivi"])

_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
# Une seule limite par IP pour toutes les routes publiques par code (fiche, commandes,
# fidélité, grattage, actions) : une page de suivi en ouvre 5 puis polle toutes les 30 s.
# Plafond global 600/min toutes IP confondues (énumération répartie des codes).
_LIMITEUR = LimiteurDebit(
    limite=60, fenetre=60, limite_globale=600, fenetre_globale=60,
    message="Trop de requêtes sur le suivi depuis cet appareil — attendez 1 minute avant de réessayer.",
    message_global="Le suivi en ligne est momentanément saturé : réessayez dans quelques minutes.",
)
# Interactions du dashboard (pollées toutes les 30 s par poste) : lecture partagée 5 s
_CACHE_INTERACTIONS = PollCache(ttl=5, max_entries=4)

TEL_MIN_CHIFFRES = 9

# La preuve est aussi lue dans un en-tête : le numéro complet (ou le jeton) ne passe alors
# ni dans l'URL ni dans les journaux d'accès (les GET du suivi sont pollés toutes les 30 s).
EN_TETE_JETON = "x-suivi-token"
EN_TETE_TEL = "x-suivi-tel"

# Journal d'accès uvicorn : une preuve passée en query (?t=…, ?tel=…) y serait écrite en
# clair à chaque rafraîchissement ; elle est masquée avant l'écriture de la ligne.
_PREUVE_QUERY_RE = re.compile(r"(?<=[?&])(t|tel|tel4)=[^&#\s]*")


def masquer_preuve(chemin: str) -> str:
    """`/api/tickets/code/KP-1?tel=0612345679&x=1` → `/api/tickets/code/KP-1?tel=***&x=1`."""
    return _PREUVE_QUERY_RE.sub(r"\1=***", chemin or "")


class _JournalSansPreuve(logging.Filter):
    """Filtre du journal d'accès uvicorn ('%s - "%s %s HTTP/%s" %d') : masque t= et tel=."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) >= 3 and isinstance(args[2], str) and "?" in args[2]:
            record.args = args[:2] + (masquer_preuve(args[2]),) + args[3:]
        return True


def _installer_journal_sans_preuve():
    journal = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, _JournalSansPreuve) for f in journal.filters):
        journal.addFilter(_JournalSansPreuve())


_installer_journal_sans_preuve()


class AccesSuivi(BaseModel):
    t: Optional[str] = None      # jeton du lien de suivi
    tel: Optional[str] = None    # numéro de téléphone complet donné au dépôt


class MessageBody(AccesSuivi):
    message: str


class DevisValidation(AccesSuivi):
    accepte: bool


class AvisBody(AccesSuivi):
    note: int
    commentaire: Optional[str] = ""


MESSAGES_REFUS = {
    "preuve_requise": "Pour consulter ce ticket, scannez le QR code du ticket ou saisissez le numéro "
                      "de téléphone donné au dépôt.",
    "lien_invalide": "Ce lien de suivi n'est plus valide. Saisissez le numéro de téléphone donné au dépôt.",
    "verification_echouee": "Ce numéro ne correspond pas à celui donné lors du dépôt.",
    "numero_incomplet": "Saisissez votre numéro de téléphone complet.",
}


def _refus(code: str, message: str = None):
    # 403 et non 401 : le front renvoie vers l'accueil sur tout 401
    raise HTTPException(403, {"code": code, "message": message or MESSAGES_REFUS[code]})


def refus_suivi(code: str = "preuve_requise"):
    """Même refus 403 {code, message} que preuve_suivi, pour les routes qui désignent le ticket
    autrement que par son code (POST /api/parts/auto sans session)."""
    _refus(code)


def _staff_connecte(request: Request) -> bool:
    """Session du personnel présentée en en-tête (routes en `def` : pas de Depends ici)."""
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return False
    try:
        payload = decode_token(auth[7:].strip())
    except HTTPException:
        return False
    # Jeton d'une session close (déconnexion, changement d'utilisateur) : visiteur anonyme
    return bool(payload) and not jeton_revoque(payload)


def _meme_numero(saisi: str, connu) -> bool:
    """Même numéro complet (≥ 9 chiffres), tout format (06…, +33 6…, 0033 6…)."""
    if not connu or len(search_engine.phone_digits(connu)) < TEL_MIN_CHIFFRES:
        return False
    return secrets.compare_digest(search_engine.phone_full(saisi), search_engine.phone_full(connu))


def _essais(fn, request: Request, cible: str):
    """verifier_essais / noter_echec avec le message du suivi : le verrou (IP, code) peut
    toucher un client qui n'a rien tenté lui-même ; le QR du ticket reste la porte sans attente."""
    try:
        fn(request, cible)
    except HTTPException as e:
        if e.status_code != 429:
            raise
        secondes = int((e.headers or {}).get("Retry-After") or 0)
        attente = f"{secondes} s" if secondes < 60 else f"{(secondes + 59) // 60} min"
        raise HTTPException(
            429,
            f"Trop de tentatives pour ce ticket. Réessayez dans {attente}, ou scannez le QR code "
            "de votre ticket de dépôt : il ouvre le suivi sans attendre.",
            headers=e.headers,
        )


def preuve_suivi(cur, request: Request, code: str, t: Optional[str] = None, tel: Optional[str] = None) -> dict:
    """Ticket désigné par le code, si le visiteur prouve qu'il en est le client.

    Acceptée : jeton `t` valide, OU `tel` = numéro complet du client (téléphone de la fiche
    ou tickets.tel_contact), OU session du personnel. `t` et `tel` viennent de la query ou
    du corps (paramètres) ou, à défaut, des en-têtes X-Suivi-Token / X-Suivi-Tel (jamais
    journalisés). Sans session du personnel, un code inexistant est refusé exactement comme un
    code existant sans preuve valable (403 preuve_requise / lien_invalide / verification_echouee,
    cette dernière comptée) : la réponse n'apprend pas si le numéro séquentiel existe. 404
    réservé au staff. Les échecs de numéro sont comptés par (IP, code) avec verrouillage
    progressif. Renvoie {id, statut, ticket_code} : jamais les coordonnées.
    """
    _LIMITEUR.verifier(client_ip(request))
    code = (code or "").strip().upper()
    jeton = (t or "").strip() or request.headers.get(EN_TETE_JETON, "").strip()
    tel = (tel or "").strip() or request.headers.get(EN_TETE_TEL, "").strip()
    cible = f"suivi:{code}"

    cur.execute("""
        SELECT t.id, t.statut, t.ticket_code, t.suivi_token, t.tel_contact,
               c.telephone AS client_tel, t.date_maj, t.date_cloture, t.date_rendu
        FROM tickets t LEFT JOIN clients c ON c.id = t.client_id
        WHERE t.ticket_code = %s
    """, (code,))
    row = cur.fetchone()
    staff = _staff_connecte(request)
    if not row and staff:
        raise HTTPException(404, "Ticket non trouvé")
    # Code inexistant, visiteur anonyme : même chemin qu'un ticket sans preuve (aucun jeton ni
    # numéro ne peut correspondre), même réponse, même comptage des échecs
    row = row or {}
    ticket = {"id": row.get("id"), "statut": row.get("statut"), "ticket_code": row.get("ticket_code") or code}

    jeton_expire = False
    if jeton and _TOKEN_RE.match(jeton) and row.get("suivi_token") and secrets.compare_digest(
            jeton.encode(), str(row["suivi_token"]).encode()):
        # Dossier rendu/clôturé depuis plus de SUIVI_JETON_JOURS jours : le jeton du QR / des
        # liens envoyés ne vaut plus ; le numéro complet reste accepté (ci-dessous)
        jeton_expire = jeton_perime(row.get("statut"), row.get("date_maj"), row.get("date_cloture"),
                                    row.get("date_rendu"))
        if not jeton_expire:
            return ticket

    if staff:
        return ticket

    if tel:
        _essais(verifier_essais, request, cible)
        if len(search_engine.phone_digits(tel)) < TEL_MIN_CHIFFRES:
            # Un fragment ne désigne personne : pas compté, mais refusé
            _refus("verification_echouee", MESSAGES_REFUS["numero_incomplet"])
        if _meme_numero(tel, row.get("client_tel")) or _meme_numero(tel, row.get("tel_contact")):
            noter_succes(request, cible)
            return ticket
        _essais(noter_echec, request, cible)
        _refus("verification_echouee")

    if jeton:
        if jeton_expire:
            _refus("lien_invalide", "Ce lien de suivi a expiré (dossier rendu ou clôturé). "
                                    "Saisissez le numéro de téléphone donné au dépôt.")
        _refus("lien_invalide")
    _refus("preuve_requise")


def _ticket_autorise(cur, request: Request, ticket_code: str, acces: AccesSuivi, t_query, tel_query) -> dict:
    """Preuve lue dans le corps (t / tel) ou dans la query."""
    acces = acces or AccesSuivi()
    return preuve_suivi(cur, request, ticket_code, acces.t or t_query, acces.tel or tel_query)


# ─── MESSAGE CLIENT ──────────────────────────────────────
@router.post("/{ticket_code}/message")
def send_client_message(
    ticket_code: str,
    body: MessageBody,
    request: Request,
    t: Optional[str] = Query(None),
    tel: Optional[str] = Query(None),
):
    """Le client envoie un message depuis la page de suivi.

    En plus de la note 'message_client', on déclenche une notification
    in-app (toast + cloche + chat tech) préfixée 'Client : ...' pour que
    le staff identifie immédiatement que le message vient du client (et
    pas d'un membre interne de l'équipe)."""
    msg = body.message.strip()
    if not msg:
        raise HTTPException(400, "Message vide")
    if len(msg) > 2000:
        raise HTTPException(400, "Message trop long (2000 caractères maximum)")

    ticket_id = None
    technicien = None
    client_label = "Client"

    with get_cursor() as cur:
        tk = _ticket_autorise(cur, request, ticket_code, body, t, tel)
        ticket_id = tk["id"]
        ticket_code = tk["ticket_code"]

        # Récupère détails ticket + client pour la notif
        cur.execute(
            """
            SELECT t.technicien_assigne, t.panne,
                   c.prenom AS client_prenom, c.nom AS client_nom
            FROM tickets t
            LEFT JOIN clients c ON c.id = t.client_id
            WHERE t.id = %s
            """,
            (ticket_id,),
        )
        det = cur.fetchone() or {}
        technicien = det.get("technicien_assigne")
        prenom = det.get("client_prenom") or ""
        nom = det.get("client_nom") or ""
        full_name = f"{prenom} {nom}".strip()
        client_label = f"Client {full_name}" if full_name else "Client"

        cur.execute("""
            INSERT INTO notes_tickets (ticket_id, auteur, contenu, type_note)
            VALUES (%s, 'Client', %s, 'message_client')
        """, (ticket_id, msg))
    _CACHE_INTERACTIONS.invalidate()

    # Notif in-app après commit — préfixée "Client : " pour distinction visuelle
    try:
        msg_excerpt = (msg[:150] + "…") if len(msg) > 150 else msg
        push_notification(
            type="message_client",
            title=f"💬 {client_label} — {ticket_code}",
            message=f"Client : {msg_excerpt}",
            important=True,
            icon="💬",
            target_user=technicien,
            related_ticket_id=ticket_id,
            action_url=f"/accueil/ticket/{ticket_id}",
        )
    except Exception as e:
        print(f"[suivi] notification message_client failed: {e}")

    return {"ok": True}


# ─── VALIDATION DEVIS ────────────────────────────────────
@router.post("/{ticket_code}/valider-devis")
def valider_devis(
    ticket_code: str,
    body: DevisValidation,
    request: Request,
    t: Optional[str] = Query(None),
    tel: Optional[str] = Query(None),
):
    """Le client accepte ou refuse le devis depuis la page de suivi."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    # Journal texte affiché « [JJ/MM HH:MM] » : heure de Chambéry (serveur en UTC)
    ts = datetime.now(_PARIS).strftime("%d/%m %H:%M") if _PARIS else datetime.now().strftime("%d/%m %H:%M")
    ticket_id = None
    technicien = None
    client_label = "Le client"
    panne = ""

    with get_cursor() as cur:
        tk = _ticket_autorise(cur, request, ticket_code, body, t, tel)
        ticket_id = tk["id"]
        ticket_code = tk["ticket_code"]

        # Récupère détails ticket + client pour la notif (+ statut courant)
        cur.execute(
            """
            SELECT t.statut, t.technicien_assigne, t.panne,
                   c.prenom AS client_prenom, c.nom AS client_nom
            FROM tickets t
            LEFT JOIN clients c ON c.id = t.client_id
            WHERE t.id = %s
            FOR UPDATE OF t
            """,
            (ticket_id,),
        )
        det = cur.fetchone() or {}
        statut_courant = det.get("statut") or ""
        technicien = det.get("technicien_assigne")
        panne = det.get("panne") or ""
        prenom = det.get("client_prenom") or ""
        nom = det.get("client_nom") or ""
        client_label = (f"{prenom} {nom}".strip()) or "Le client"

        # ─── Garde de statut : on n'accepte la validation que si le ticket est
        # réellement en attente d'accord client. Bloque le rejeu (re-clic sur un
        # vieux lien) qui ressusciterait un ticket Clôturé/Rendu.
        if statut_courant != "En attente d'accord client":
            raise HTTPException(409, "Ce ticket n'est plus en attente d'accord client")

        if body.accepte:
            contenu = "✅ Devis accepté par le client"
            # Passer en "En cours de réparation" + démarrer le timer réparation
            # + synchroniser les pièces (reproduit change_status pour la cohérence).
            cur.execute(
                "UPDATE tickets SET statut = 'En cours de réparation', "
                "reparation_debut = %s, reparation_fin = NULL, date_maj = %s, "
                "historique = COALESCE(historique, '') || %s || E'\\n' WHERE id = %s",
                (now, now, f"[{ts}] Devis accepté par le client", ticket_id),
            )
            cur.execute(
                "UPDATE commandes_pieces SET statut = 'En réparation' "
                "WHERE ticket_id = %s AND statut = 'Reçu'",
                (ticket_id,),
            )
            # Ligne « Statut: … » de la table historique : remet « client contacté » à zéro
            contact.historiser_statut(cur, ticket_id, statut_courant, "En cours de réparation",
                                      "Client", " (devis accepté en ligne)")
        else:
            contenu = "❌ Devis refusé par le client"
            cur.execute(
                "UPDATE tickets SET date_maj = %s, "
                "historique = COALESCE(historique, '') || %s || E'\\n' WHERE id = %s",
                (now, f"[{ts}] Devis refusé par le client", ticket_id),
            )
        cur.execute("""
            INSERT INTO notes_tickets (ticket_id, auteur, contenu, type_note)
            VALUES (%s, 'Client', %s, 'validation_devis')
        """, (ticket_id, contenu))
    _CACHE_INTERACTIONS.invalidate()

    # ─── Push notif après commit : UNIQUEMENT validation positive ────
    if body.accepte:
        try:
            panne_excerpt = (panne[:50] + "…") if len(panne) > 50 else panne
            push_notification(
                type="devis_accepte_distance",
                title=f"✅ {client_label} a validé le devis",
                message=(
                    f"Ticket {ticket_code} — {panne_excerpt}. "
                    "Le ticket passe automatiquement en réparation."
                ),
                important=True,
                icon="✅",
                target_user=technicien,  # message privé au tech assigné si présent
                related_ticket_id=ticket_id,
                action_url=f"/accueil/ticket/{ticket_id}",
            )
        except Exception as e:
            print(f"[suivi] notification trigger failed: {e}")

    return {"ok": True, "accepte": body.accepte}


# ─── AVIS CLIENT ─────────────────────────────────────────
@router.post("/{ticket_code}/avis")
def laisser_avis(
    ticket_code: str,
    body: AvisBody,
    request: Request,
    t: Optional[str] = Query(None),
    tel: Optional[str] = Query(None),
):
    """Le client laisse un avis (étoiles + commentaire)."""
    if body.note < 1 or body.note > 5:
        raise HTTPException(400, "Note entre 1 et 5")
    commentaire_saisi = (body.commentaire or "").strip()
    if len(commentaire_saisi) > 2000:
        raise HTTPException(400, "Commentaire trop long (2000 caractères maximum)")
    with get_cursor() as cur:
        tk = _ticket_autorise(cur, request, ticket_code, body, t, tel)
        # Vérifier qu'il n'a pas déjà laissé un avis
        cur.execute(
            "SELECT id FROM notes_tickets WHERE ticket_id = %s AND type_note = 'avis_client' LIMIT 1",
            (tk["id"],),
        )
        if cur.fetchone():
            raise HTTPException(400, "Avis déjà soumis pour ce ticket")
        stars = "⭐" * body.note
        commentaire = f" — {commentaire_saisi}" if commentaire_saisi else ""
        contenu = f"{stars} ({body.note}/5){commentaire}"
        cur.execute("""
            INSERT INTO notes_tickets (ticket_id, auteur, contenu, type_note)
            VALUES (%s, 'Client', %s, 'avis_client')
        """, (tk["id"], contenu))
    _CACHE_INTERACTIONS.invalidate()
    return {"ok": True}


# ─── DASHBOARD INTERACTIONS ──────────────────────────────
def _interactions() -> dict:
    # Une seule requête (au lieu de 4). LEFT JOIN : mêmes résultats que les
    # requêtes séparées, y compris pour les notes d'un ticket supprimé.
    with get_cursor() as cur:
        cur.execute("""
            SELECT
                array_agg(DISTINCT n.ticket_id) FILTER (
                    WHERE n.type_note = 'validation_devis' AND (n.is_read = FALSE OR n.is_read IS NULL)
                ) AS accord,
                array_agg(DISTINCT n.ticket_id) FILTER (
                    WHERE n.type_note = 'validation_devis' AND n.contenu LIKE %(valide)s
                      AND t.statut NOT IN ('Rendu au client', 'Clôturé')
                ) AS accord_valide,
                array_agg(DISTINCT n.ticket_id) FILTER (
                    WHERE n.type_note = 'message_client' AND (n.is_read = FALSE OR n.is_read IS NULL)
                ) AS messages,
                array_agg(DISTINCT n.ticket_id) FILTER (
                    WHERE n.type_note = 'avis_client' AND (n.is_read = FALSE OR n.is_read IS NULL)
                ) AS avis
            FROM notes_tickets n
            LEFT JOIN tickets t ON t.id = n.ticket_id
            WHERE (n.type_note IN ('validation_devis', 'message_client', 'avis_client')
                   AND (n.is_read = FALSE OR n.is_read IS NULL))
               OR (n.type_note = 'validation_devis' AND n.contenu LIKE %(valide)s)
        """, {"valide": "✅%"})
        row = cur.fetchone() or {}

    accord_ids = list(row.get("accord") or [])
    accord_valide_ids = list(row.get("accord_valide") or [])
    message_ids = list(row.get("messages") or [])
    avis_ids = list(row.get("avis") or [])
    total = len(accord_ids) + len(message_ids) + len(avis_ids)
    return {
        "accord_client": {"count": len(accord_ids), "ticket_ids": accord_ids},
        "accord_client_valide": {"count": len(accord_valide_ids), "ticket_ids": accord_valide_ids},
        "messages": {"count": len(message_ids), "ticket_ids": message_ids},
        "avis": {"count": len(avis_ids), "ticket_ids": avis_ids},
        "total_actions": total,
    }


def invalider_interactions():
    _CACHE_INTERACTIONS.invalidate()


@router.get("/dashboard/interactions")
def get_interactions(request: Request, user: dict = Depends(get_current_user)):
    """4 catégories d'interactions non lues : accord_client (tout), accord_client_valide
    (validations positives uniquement, pour point vert dashboard), messages, avis.
    Réservé au staff (pollé par la Navbar)."""
    return cached_json(request, _CACHE_INTERACTIONS, "interactions", _interactions)


# ─── CHECK AVIS EXISTS ──────────────────────────────────
@router.get("/{ticket_code}/has-avis")
def has_avis(
    ticket_code: str,
    request: Request,
    t: Optional[str] = Query(None),
    tel: Optional[str] = Query(None),
):
    """Vérifie si un avis a déjà été laissé (preuve du suivi exigée)."""
    with get_cursor() as cur:
        tk = preuve_suivi(cur, request, ticket_code, t, tel)
        cur.execute(
            "SELECT id FROM notes_tickets WHERE ticket_id = %s AND type_note = 'avis_client' LIMIT 1",
            (tk["id"],),
        )
        return {"has_avis": cur.fetchone() is not None}
