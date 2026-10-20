"""
API Commandes de pièces.

Prix réellement payé : une commande peut porter le HT payé (prix_ht) et la pièce de la
grille concernée (tarif_cle, « tarifs:123 » : identifiant des suggestions de /api/grille).
Avec les deux, à la création, quand l'un change ou à la réception, une proposition de
mise à jour du prix est créée (services/prix.creer_proposition, écart de plus de 1 €),
à valider par l'admin (/api/tarifs/propositions) : jamais d'écriture directe du prix.
"""

import logging
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from app.database import get_cursor
from app.api.auth import client_ip, get_current_user, get_optional_user
from app.api.public_documents import LimiteurDebit
from app.models import CommandePieceCreate, CommandePieceUpdate
from app.services import contact
from app.services import prix as prix_srv

try:
    from zoneinfo import ZoneInfo
    _PARIS = ZoneInfo("Europe/Paris")
except Exception:  # image sans base tz : heure du serveur
    _PARIS = None

router = APIRouter(prefix="/api/parts", tags=["parts"])
logger = logging.getLogger(__name__)


STATUTS_TERMINAUX = ["Donné au client", "Clôturé"]
STATUTS_RECUS = ("Reçu", "Donné au client", "Clôturé")
# Commande pas encore arrivée : le ticket attend toujours sa pièce
STATUTS_EN_COURS = ("Panier", "En attente", "Commandée")

# /auto sans session (borne) : juste après POST /api/tickets, une seule fois, ticket neuf
AUTO_DELAI_MINUTES = 10
_LIMITEUR_AUTO = LimiteurDebit(limite=10, fenetre=60)
# Statuts que la commande automatique ne fait jamais reculer
STATUTS_SANS_RECUL = ("Réparation terminée", "Rendu au client", "Clôturé")


def _heure_paris() -> str:
    """« JJ/MM HH:MM » à l'heure de Chambéry pour les lignes du journal texte (serveur en UTC)."""
    return datetime.now(_PARIS).strftime("%d/%m %H:%M") if _PARIS else datetime.now().strftime("%d/%m %H:%M")


def _valider_tarif_cle(v):
    if v is None or not str(v).strip():
        return None
    try:
        prix_srv.parse_tarif_cle(str(v).strip())
    except ValueError:
        raise ValueError("tarif_cle invalide (attendu : « tarifs:123 »)")
    return str(v).strip()


class CommandePieceCreatePrix(CommandePieceCreate):
    prix_ht: Optional[float] = Field(None, ge=0, le=100000)
    tarif_cle: Optional[str] = Field(None, max_length=80)

    @field_validator("tarif_cle", mode="before")
    @classmethod
    def _cle(cls, v):
        return _valider_tarif_cle(v)


class CommandePieceUpdatePrix(CommandePieceUpdate):
    prix_ht: Optional[float] = Field(None, ge=0, le=100000)
    tarif_cle: Optional[str] = Field(None, max_length=80)

    @field_validator("tarif_cle", mode="before")
    @classmethod
    def _cle(cls, v):
        return _valider_tarif_cle(v)


def _proposer(cur, commande_id: int, prix_ht, tarif_cle, par: str):
    """Proposition de prix (dans un SAVEPOINT : un échec n'annule jamais la commande)."""
    if prix_ht is None or not tarif_cle or float(prix_ht) <= 0:
        return None
    cur.execute("SAVEPOINT kp_proposition")
    try:
        pid = prix_srv.creer_proposition(cur, tarif_cle, prix_ht, "commande", par, commande_id)
        cur.execute("RELEASE SAVEPOINT kp_proposition")
        return pid
    except Exception as e:
        cur.execute("ROLLBACK TO SAVEPOINT kp_proposition")
        logger.warning("Proposition de prix non créée (commande %s) : %s", commande_id, type(e).__name__)
        return None


@router.get("")
def list_parts(
    ticket_id: Optional[int] = None,
    statut: Optional[str] = None,
    search: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Liste les commandes de pièces avec filtres.
    statut=en_cours → only active, statut=cloturees → only terminal.
    """
    conditions = []
    params = []

    if ticket_id:
        conditions.append("cp.ticket_id = %s")
        params.append(ticket_id)
    if statut == "en_cours":
        conditions.append("cp.statut NOT IN ('Donné au client','Clôturé')")
    elif statut == "cloturees":
        conditions.append("cp.statut IN ('Donné au client','Clôturé')")
    elif statut:
        conditions.append("cp.statut = %s")
        params.append(statut)
    if search:
        conditions.append(
            "(cp.description ILIKE %s OR cp.fournisseur ILIKE %s "
            "OR cp.reference ILIKE %s OR cp.ticket_code ILIKE %s)"
        )
        s = f"%{search}%"
        params.extend([s, s, s, s])

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    with get_cursor() as cur:
        cur.execute(
            f"""SELECT cp.*, t.ticket_code as linked_ticket_code,
                       t.marque, t.modele, t.modele_autre,
                       t.panne, t.panne_detail,
                       c.nom as client_nom, c.prenom as client_prenom, c.telephone as client_tel
                FROM commandes_pieces cp
                LEFT JOIN tickets t ON t.id = cp.ticket_id
                LEFT JOIN clients c ON c.id = t.client_id
                {where}
                ORDER BY cp.date_creation DESC""",
            params,
        )
        rows = cur.fetchall()
        results = []
        for r in rows:
            d = dict(r)
            if not d.get("ticket_code") and d.get("linked_ticket_code"):
                d["ticket_code"] = d["linked_ticket_code"]
            d.pop("linked_ticket_code", None)
            # Serialize datetimes
            for key in ("date_creation", "date_commande", "date_reception"):
                if d.get(key) and hasattr(d[key], "isoformat"):
                    d[key] = d[key].isoformat()
            results.append(d)
        return results


@router.post("", response_model=dict)
def create_part(data: CommandePieceCreatePrix, user: dict = Depends(get_current_user)):
    """Crée une commande de pièce (prix_ht + tarif_cle : proposition de prix, cf. docstring du module)."""
    ticket_id = data.ticket_id

    # If ticket_code provided but no ticket_id, resolve it
    if not ticket_id and data.ticket_code:
        with get_cursor() as cur:
            cur.execute("SELECT id FROM tickets WHERE ticket_code = %s", (data.ticket_code.strip(),))
            row = cur.fetchone()
            if row:
                ticket_id = row["id"]

    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO commandes_pieces (ticket_id, description, fournisseur, reference, prix, notes, ticket_code,
                                          statut, prix_ht, tarif_cle)
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'En attente', %s, %s) RETURNING id
        """, (
            ticket_id, data.description, data.fournisseur,
            data.reference, data.prix, data.notes, data.ticket_code or '',
            data.prix_ht, data.tarif_cle,
        ))
        row = cur.fetchone()

        # Marque la commande sur le ticket ; le statut ne change PAS ici (c'est change_status,
        # depuis la fiche, qui passe « En attente de pièce » et trace la ligne « Statut: … »)
        if ticket_id:
            cur.execute(
                "UPDATE tickets SET commande_piece = 1, date_maj = %s WHERE id = %s",
                (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), ticket_id),
            )
        proposition = _proposer(cur, row["id"], data.prix_ht, data.tarif_cle, user.get("sub") or "")

    return {"id": row["id"], "proposition_id": proposition}


class CommandeAutoIn(BaseModel):
    ticket_id: int
    description: str = Field("", max_length=200)
    fournisseur: Optional[str] = Field("", max_length=100)
    prix: Optional[float] = Field(None, ge=0, le=10000)
    notes: Optional[str] = Field("", max_length=2000)


@router.post("/auto", response_model=dict)
def create_part_auto(data: CommandeAutoIn, request: Request, user: Optional[dict] = Depends(get_optional_user)):
    """Commande de pièce créée avec le ticket (borne /client, « Nouveau ticket » du personnel).

    Sans session, la borne ne peut viser que le ticket qu'elle vient de créer : moins de
    10 minutes, encore « En attente de diagnostic » et sans commande (sinon 409). Un ticket
    terminé, rendu ou clôturé ne recule jamais en « En attente de pièce ».
    """
    if not user:
        _LIMITEUR_AUTO.verifier(client_ip(request))

    with get_cursor() as cur:
        cur.execute(
            """SELECT ticket_code, statut,
                      (date_depot >= LOCALTIMESTAMP - make_interval(mins => %s)) AS recent,
                      EXISTS (SELECT 1 FROM commandes_pieces cp WHERE cp.ticket_id = t.id) AS a_commande
               FROM tickets t WHERE id = %s FOR UPDATE""",
            (AUTO_DELAI_MINUTES, data.ticket_id),
        )
        t = cur.fetchone()
        if not t:
            raise HTTPException(404, "Ticket non trouvé")
        ancien = t["statut"] or ""
        if not user and (ancien != "En attente de diagnostic" or not t["recent"] or t["a_commande"]):
            raise HTTPException(409, "Ce ticket n'accepte plus de commande automatique")

        cur.execute("""
            INSERT INTO commandes_pieces (ticket_id, description, fournisseur, prix, notes, ticket_code, statut)
            VALUES (%s, %s, %s, %s, %s, %s, 'En attente') RETURNING id
        """, (
            data.ticket_id,
            data.description or "",
            data.fournisseur or "",
            data.prix or None,
            data.notes or "",
            t["ticket_code"] or "",
        ))
        row = cur.fetchone()

        maintenant = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        if ancien in STATUTS_SANS_RECUL:
            cur.execute("UPDATE tickets SET commande_piece = 1, date_maj = %s WHERE id = %s",
                        (maintenant, data.ticket_id))
        else:
            cur.execute(
                "UPDATE tickets SET statut = 'En attente de pièce', commande_piece = 1, date_maj = %s WHERE id = %s",
                (maintenant, data.ticket_id),
            )
            # Ligne « Statut: … » : c'est elle qui remet « client contacté » à zéro (services/contact)
            if ancien != "En attente de pièce":
                auteur = (user or {}).get("sub") or "Auto"
                contact.historiser_statut(cur, data.ticket_id, ancien, "En attente de pièce", auteur,
                                          " (pièce commandée)")

    return {"id": row["id"]}


@router.patch("/{commande_id}", response_model=dict)
def update_part(
    commande_id: int,
    data: CommandePieceUpdatePrix,
    user: dict = Depends(get_current_user),
):
    """Met à jour une commande de pièce. prix_ht et tarif_cle acceptent null (effacés) ; un
    changement de l'un d'eux, ou la réception, crée la proposition de prix (cf. docstring du module)."""
    envoye = data.model_dump(exclude_unset=True)
    updates = {k: v for k, v in envoye.items() if v is not None or k in ("prix_ht", "tarif_cle")}
    if not updates:
        return {"ok": True}

    # If changing to 'Commandée', set date_commande
    if updates.get("statut") == "Commandée" and "date_commande" not in updates:
        updates["date_commande"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # If changing to 'Reçu' or terminal statut, set date_reception
    if updates.get("statut") in ("Reçu", "Donné au client", "Clôturé") and "date_reception" not in updates:
        updates["date_reception"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Resolve ticket_code to ticket_id if needed
    if "ticket_code" in updates and updates["ticket_code"]:
        with get_cursor() as cur:
            cur.execute("SELECT id FROM tickets WHERE ticket_code = %s", (updates["ticket_code"].strip(),))
            row = cur.fetchone()
            if row:
                updates["ticket_id"] = row["id"]

    # Noms de colonnes : champs du modèle Pydantic uniquement
    set_clause = ", ".join(f"{k} = %s" for k in updates.keys())
    values = list(updates.values()) + [commande_id]
    proposition = None

    with get_cursor() as cur:
        avant = None
        if {"prix_ht", "tarif_cle", "statut"} & set(updates):
            cur.execute("SELECT prix_ht, tarif_cle, statut FROM commandes_pieces WHERE id = %s", (commande_id,))
            avant = cur.fetchone()
        cur.execute(f"UPDATE commandes_pieces SET {set_clause} WHERE id = %s", values)

        if avant is not None:
            prix_ht = updates.get("prix_ht", avant["prix_ht"])
            tarif_cle = updates.get("tarif_cle", avant["tarif_cle"])
            change = ("prix_ht" in updates and _differe(updates["prix_ht"], avant["prix_ht"])) or \
                     ("tarif_cle" in updates and (updates["tarif_cle"] or None) != (avant["tarif_cle"] or None))
            recue = updates.get("statut") in STATUTS_RECUS and avant["statut"] not in STATUTS_RECUS
            if change or (recue and not _deja_proposee(cur, commande_id)):
                proposition = _proposer(cur, commande_id, prix_ht, tarif_cle, user.get("sub") or "")

        # Auto-sync : commande « Reçu » → ticket « Pièce reçue », seulement quand plus
        # aucune autre commande du ticket n'est attendue (sinon une ligne « (1/2) »)
        if updates.get("statut") == "Reçu":
            cur.execute("SELECT ticket_id, description FROM commandes_pieces WHERE id = %s", (commande_id,))
            row = cur.fetchone()
            if row and row["ticket_id"]:
                cur.execute(
                    """SELECT COUNT(*) AS total,
                              COUNT(*) FILTER (WHERE statut IN %s) AS attendues
                       FROM commandes_pieces WHERE ticket_id = %s""",
                    (STATUTS_EN_COURS, row["ticket_id"]),
                )
                compte = cur.fetchone() or {}
                total = int(compte.get("total") or 0)
                attendues = int(compte.get("attendues") or 0)
                if attendues == 0:
                    cur.execute(
                        "UPDATE tickets SET statut = 'Pièce reçue', date_maj = %s WHERE id = %s AND statut IN ('En attente de pièce')",
                        (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), row["ticket_id"]),
                    )
                    # Statut réellement changé (rowcount) : ligne « Statut: … » qui remet le contact à zéro
                    if cur.rowcount == 1:
                        contact.historiser_statut(cur, row["ticket_id"], "En attente de pièce", "Pièce reçue",
                                                  user.get("sub") or "Staff", " (pièce reçue)")
                rang = f" ({total - attendues}/{total})" if total > 1 else ""
                history_entry = f"[{_heure_paris()}] Pièce \"{row['description']}\" reçue{rang}"
                cur.execute(
                    "UPDATE tickets SET historique = COALESCE(historique, '') || %s || E'\\n' WHERE id = %s",
                    (history_entry, row["ticket_id"]),
                )

    return {"ok": True, "proposition_id": proposition}


def _differe(a, b) -> bool:
    if a is None or b is None:
        return (a is None) != (b is None)
    return abs(float(a) - float(b)) >= 0.005


def _deja_proposee(cur, commande_id: int) -> bool:
    """Une proposition (quel que soit son sort) vient déjà de cette commande : la réception ne
    la relance pas (une proposition refusée ne revient pas d'elle-même)."""
    cur.execute("SAVEPOINT kp_deja")
    try:
        cur.execute("SELECT 1 AS x FROM tarifs_propositions WHERE commande_id = %s LIMIT 1", (commande_id,))
        deja = cur.fetchone() is not None
        cur.execute("RELEASE SAVEPOINT kp_deja")
        return deja
    except Exception:
        cur.execute("ROLLBACK TO SAVEPOINT kp_deja")
        return False


@router.delete("/{commande_id}", response_model=dict)
def delete_part(commande_id: int, user: dict = Depends(get_current_user)):
    """Supprime une commande de pièce."""
    with get_cursor() as cur:
        cur.execute("DELETE FROM commandes_pieces WHERE id = %s", (commande_id,))
    return {"ok": True}


# ─── PUBLIC ENDPOINT (for suivi page) ──────────────────────────
@router.get("/public/{ticket_code}")
def get_commandes_public(ticket_code: str, request: Request):
    """Retourne les commandes liées à un ticket (public, infos limitées)."""
    # Même limite que GET /api/tickets/code (codes séquentiels : énumérables)
    from app.api.tickets import _rate_limit_public_lookup
    _rate_limit_public_lookup(request)
    with get_cursor() as cur:
        cur.execute("""
            SELECT c.id, c.description as piece, c.statut,
                   c.date_commande, c.date_reception
            FROM commandes_pieces c
            JOIN tickets t ON t.id = c.ticket_id
            WHERE t.ticket_code = %s
            ORDER BY c.date_creation DESC
        """, (ticket_code,))
        rows = cur.fetchall()
        results = []
        for r in rows:
            d = dict(r)
            for key in ("date_commande", "date_reception"):
                if d.get(key) and hasattr(d[key], "isoformat"):
                    d[key] = d[key].isoformat()
            results.append(d)
        return results
