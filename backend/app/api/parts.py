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
from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field, field_validator
from app.database import get_cursor
from app.api.auth import get_current_user
from app.models import CommandePieceCreate, CommandePieceUpdate
from app.services import prix as prix_srv

router = APIRouter(prefix="/api/parts", tags=["parts"])
logger = logging.getLogger(__name__)


STATUTS_TERMINAUX = ["Donné au client", "Clôturé"]
STATUTS_RECUS = ("Reçu", "Donné au client", "Clôturé")


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

        # Auto-set ticket status to "En attente de pièce" if linked
        if ticket_id:
            cur.execute(
                "UPDATE tickets SET commande_piece = 1, date_maj = %s WHERE id = %s",
                (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), ticket_id),
            )
        proposition = _proposer(cur, row["id"], data.prix_ht, data.tarif_cle, user.get("sub") or "")

    return {"id": row["id"], "proposition_id": proposition}


@router.post("/auto", response_model=dict)
def create_part_auto(data: dict):
    """Crée une commande de pièce automatiquement lors du dépôt (sans auth)."""
    ticket_id = data.get("ticket_id")
    if not ticket_id:
        raise HTTPException(400, "ticket_id requis")

    with get_cursor() as cur:
        # Get ticket_code
        cur.execute("SELECT ticket_code FROM tickets WHERE id = %s", (ticket_id,))
        t = cur.fetchone()
        ticket_code = t["ticket_code"] if t else ""

        cur.execute("""
            INSERT INTO commandes_pieces (ticket_id, description, fournisseur, prix, notes, ticket_code, statut)
            VALUES (%s, %s, %s, %s, %s, %s, 'En attente') RETURNING id
        """, (
            ticket_id,
            data.get("description", ""),
            data.get("fournisseur", ""),
            data.get("prix") or None,
            data.get("notes", ""),
            ticket_code,
        ))
        row = cur.fetchone()

        # Set ticket status to "En attente de pièce"
        cur.execute(
            "UPDATE tickets SET statut = 'En attente de pièce', commande_piece = 1, date_maj = %s WHERE id = %s",
            (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), ticket_id),
        )

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

        # Auto-sync: if commande becomes "Reçu", update ticket status to "Pièce reçue"
        if updates.get("statut") == "Reçu":
            cur.execute("SELECT ticket_id, description FROM commandes_pieces WHERE id = %s", (commande_id,))
            row = cur.fetchone()
            if row and row["ticket_id"]:
                now = datetime.now()
                cur.execute(
                    "UPDATE tickets SET statut = 'Pièce reçue', date_maj = %s WHERE id = %s AND statut IN ('En attente de pièce')",
                    (now.strftime("%Y-%m-%d %H:%M:%S"), row["ticket_id"]),
                )
                # Append history entry on ticket
                history_entry = f"[{now.strftime('%d/%m %H:%M')}] Pièce \"{row['description']}\" reçue"
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
def get_commandes_public(ticket_code: str):
    """Retourne les commandes liées à un ticket (public, infos limitées)."""
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
