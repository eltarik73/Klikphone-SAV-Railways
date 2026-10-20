"""
API Suivi client — endpoints publics (sans auth), sauf les interactions du dashboard.
Message client, validation devis, avis.

La consultation reste possible avec le seul code (champs publics restreints, cf.
GET /api/tickets/code/{code}). Agir sur le ticket (devis, message, avis) exige
en plus le jeton du lien de suivi (`t`, QR et liens envoyés) ou, à défaut, les
4 derniers chiffres du téléphone du client (`tel4`) : les codes KP-000123 sont
séquentiels, donc devinables.
"""

import re
import secrets
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from typing import Optional
from app.database import get_cursor
from app.api.auth import client_ip, get_current_user, noter_echec, noter_succes, verifier_essais
from app.api.notifications_center import push_notification
from app.api.public_documents import LimiteurDebit
from app.services import contact
from app.services.poll_cache import PollCache, cached_json

try:
    from zoneinfo import ZoneInfo
    _PARIS = ZoneInfo("Europe/Paris")
except Exception:  # image sans base tz : heure du serveur
    _PARIS = None

router = APIRouter(prefix="/api/suivi", tags=["suivi"])

_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
_TEL4_RE = re.compile(r"^\d{4}$")
_LIMITEUR = LimiteurDebit(limite=20, fenetre=60)
# Interactions du dashboard (pollées toutes les 30 s par poste) : lecture partagée 5 s
_CACHE_INTERACTIONS = PollCache(ttl=5, max_entries=4)


class AccesSuivi(BaseModel):
    t: Optional[str] = None      # jeton du lien de suivi
    tel4: Optional[str] = None   # 4 derniers chiffres du téléphone du client


class MessageBody(AccesSuivi):
    message: str


class DevisValidation(AccesSuivi):
    accepte: bool


class AvisBody(AccesSuivi):
    note: int
    commentaire: Optional[str] = ""


def _get_ticket_by_code(cur, code: str):
    cur.execute("SELECT id, statut, ticket_code FROM tickets WHERE ticket_code = %s", (code.strip().upper(),))
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Ticket non trouvé")
    return row


def _refus(code: str, message: str):
    # 403 et non 401 : le front renvoie vers l'accueil sur tout 401
    raise HTTPException(403, {"code": code, "message": message})


def _ticket_autorise(cur, request: Request, ticket_code: str, acces: AccesSuivi, t_query, tel4_query) -> dict:
    """Ticket désigné par le code, si le visiteur prouve qu'il en est le client."""
    _LIMITEUR.verifier(client_ip(request))
    code = (ticket_code or "").strip().upper()
    jeton = (acces.t or t_query or "").strip()
    tel4 = re.sub(r"\D", "", acces.tel4 or tel4_query or "")
    cible = f"suivi:{code}"

    cur.execute("""
        SELECT t.id, t.statut, t.ticket_code, t.suivi_token, c.telephone AS client_tel
        FROM tickets t LEFT JOIN clients c ON c.id = t.client_id
        WHERE t.ticket_code = %s
    """, (code,))
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Ticket non trouvé")

    if jeton and _TOKEN_RE.match(jeton) and row.get("suivi_token") and secrets.compare_digest(
            jeton.encode(), str(row["suivi_token"]).encode()):
        return row

    if tel4:
        verifier_essais(request, cible)
        chiffres = re.sub(r"\D", "", row.get("client_tel") or "")
        if _TEL4_RE.match(tel4) and len(chiffres) >= 4 and secrets.compare_digest(tel4, chiffres[-4:]):
            noter_succes(request, cible)
            return row
        noter_echec(request, cible)
        _refus("verification_echouee", "Les 4 derniers chiffres ne correspondent pas au téléphone de ce ticket.")

    if jeton:
        _refus("lien_invalide", "Ce lien de suivi n'est plus valide. Saisissez les 4 derniers chiffres de votre téléphone.")
    _refus(
        "verification_requise",
        "Pour agir sur ce ticket, ouvrez le lien de suivi reçu ou saisissez les 4 derniers chiffres de votre téléphone.",
    )


# ─── MESSAGE CLIENT ──────────────────────────────────────
@router.post("/{ticket_code}/message")
def send_client_message(
    ticket_code: str,
    body: MessageBody,
    request: Request,
    t: Optional[str] = Query(None),
    tel4: Optional[str] = Query(None),
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
        tk = _ticket_autorise(cur, request, ticket_code, body, t, tel4)
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
    tel4: Optional[str] = Query(None),
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
        tk = _ticket_autorise(cur, request, ticket_code, body, t, tel4)
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
    tel4: Optional[str] = Query(None),
):
    """Le client laisse un avis (étoiles + commentaire)."""
    if body.note < 1 or body.note > 5:
        raise HTTPException(400, "Note entre 1 et 5")
    commentaire_saisi = (body.commentaire or "").strip()
    if len(commentaire_saisi) > 2000:
        raise HTTPException(400, "Commentaire trop long (2000 caractères maximum)")
    with get_cursor() as cur:
        tk = _ticket_autorise(cur, request, ticket_code, body, t, tel4)
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
def has_avis(ticket_code: str, request: Request):
    """Vérifie si un avis a déjà été laissé."""
    _LIMITEUR.verifier(client_ip(request))
    with get_cursor() as cur:
        t = _get_ticket_by_code(cur, ticket_code)
        cur.execute(
            "SELECT id FROM notes_tickets WHERE ticket_id = %s AND type_note = 'avis_client' LIMIT 1",
            (t["id"],),
        )
        return {"has_avis": cur.fetchone() is not None}
