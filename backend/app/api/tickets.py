"""
API CRUD Tickets — compatible schéma PostgreSQL existant.
Reprend exactement la logique de l'app Streamlit.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.database import get_cursor
from app.api.autocomplete import learn_terms
from app.models import (
    TicketCreate, TicketUpdate, TicketOut, TicketFull,
    StatusChange, KPIResponse,
)
from app.api.auth import get_current_user, get_optional_user
from app.services.notifications import (
    notif_nouveau_ticket, notif_changement_statut, notif_reparation_terminee,
)

router = APIRouter(prefix="/api/tickets", tags=["tickets"])


def _ajouter_historique(cur, ticket_id, type_event, contenu):
    """Insère une entrée dans la table historique (structured)."""
    try:
        cur.execute(
            "INSERT INTO historique (ticket_id, type, contenu) VALUES (%s, %s, %s)",
            (ticket_id, type_event, contenu),
        )
    except Exception:
        pass  # Table might not exist yet

STATUTS = [
    "En attente de diagnostic", "En attente de pièce", "Pièce reçue",
    "En attente d'accord client", "En cours de réparation",
    "Réparation terminée", "Rendu au client", "Clôturé",
]


# ─── KPI DASHBOARD ───────────────────────────────────────────────
@router.get("/stats/kpi", response_model=KPIResponse)
async def get_kpi(user: dict = Depends(get_current_user)):
    """Récupère les KPI du dashboard."""
    today = datetime.now().strftime("%Y-%m-%d")

    with get_cursor() as cur:
        cur.execute("""
            SELECT
                COUNT(*) FILTER (WHERE statut = 'En attente de diagnostic') as en_attente_diagnostic,
                COUNT(*) FILTER (WHERE statut = 'En cours de réparation') as en_cours,
                COUNT(*) FILTER (WHERE statut = 'En attente de pièce') as en_attente_piece,
                COUNT(*) FILTER (WHERE statut = 'En attente d''accord client') as en_attente_accord,
                COUNT(*) FILTER (WHERE statut = 'Réparation terminée') as reparation_terminee,
                COUNT(*) FILTER (WHERE statut NOT IN ('Clôturé', 'Rendu au client')) as total_actifs,
                COUNT(*) FILTER (WHERE date_cloture::date = %s::date) as clotures_aujourdhui,
                COUNT(*) FILTER (WHERE date_depot::date = %s::date) as nouveaux_aujourdhui
            FROM tickets
        """, (today, today))
        row = cur.fetchone()

    return KPIResponse(**row) if row else KPIResponse()


# ─── FILE D'ATTENTE RÉPARATION ────────────────────────────────────
@router.get("/queue/repair")
async def get_repair_queue(
    tech: Optional[str] = None,
    limit: int = Query(20, le=50),
    user: dict = Depends(get_current_user),
):
    """Retourne les tickets en attente de réparation, triés par priorité."""
    with get_cursor() as cur:
        conditions = [
            "t.statut IN ('En attente de diagnostic', 'En attente de pièce', "
            "'Pièce reçue', 'En attente d''accord client', 'En cours de réparation')"
        ]
        params = []

        if tech:
            conditions.append("t.technicien_assigne = %s")
            params.append(tech)

        where = "WHERE " + " AND ".join(conditions)
        params.append(limit)

        cur.execute(f"""
            SELECT t.id, t.ticket_code, t.statut, t.marque, t.modele, t.panne,
                   t.technicien_assigne, t.date_recuperation, t.date_depot,
                   t.reparation_debut, t.reparation_duree,
                   c.nom AS client_nom, c.prenom AS client_prenom
            FROM tickets t
            JOIN clients c ON t.client_id = c.id
            {where}
            ORDER BY
                CASE t.statut
                    WHEN 'En cours de réparation' THEN 1
                    WHEN 'Pièce reçue' THEN 2
                    WHEN 'En attente de diagnostic' THEN 3
                    WHEN 'En attente d''accord client' THEN 4
                    WHEN 'En attente de pièce' THEN 5
                    ELSE 6
                END,
                t.date_depot ASC
            LIMIT %s
        """, params)
        rows = cur.fetchall()

    # Serialize datetimes
    result = []
    for r in rows:
        d = dict(r)
        for key in ("date_recuperation", "date_depot", "reparation_debut"):
            if d.get(key) and hasattr(d[key], "isoformat"):
                d[key] = d[key].isoformat()
        result.append(d)
    return result


# ─── LISTE / RECHERCHE ─────────────────────────────────────────
@router.get("", response_model=list[TicketFull])
async def list_tickets(
    statut: Optional[str] = None,
    tel: Optional[str] = None,
    code: Optional[str] = None,
    nom: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(100, le=500),
    offset: int = 0,
    user: dict = Depends(get_current_user),
):
    """Liste les tickets avec filtres optionnels."""
    conditions = []
    params = []

    if statut:
        conditions.append("t.statut = %s")
        params.append(statut)
    if tel:
        conditions.append("c.telephone LIKE %s")
        params.append(f"%{tel}%")
    if code:
        conditions.append("t.ticket_code ILIKE %s")
        params.append(f"%{code}%")
    if nom:
        conditions.append("(c.nom ILIKE %s OR c.prenom ILIKE %s)")
        params.extend([f"%{nom}%", f"%{nom}%"])
    if search:
        conditions.append(
            "(t.ticket_code ILIKE %s OR c.nom ILIKE %s OR c.prenom ILIKE %s "
            "OR c.telephone LIKE %s OR t.marque ILIKE %s OR t.modele ILIKE %s "
            "OR t.modele_autre ILIKE %s)"
        )
        s = f"%{search}%"
        params.extend([s, s, s, s, s, s, s])

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    query = f"""
        SELECT t.*,
               c.nom as client_nom, c.prenom as client_prenom,
               c.telephone as client_tel, c.email as client_email,
               c.societe as client_societe, c.carte_camby as client_carte_camby,
               EXISTS(SELECT 1 FROM notes_tickets WHERE ticket_id = t.id AND type_note = 'whatsapp') as msg_whatsapp,
               EXISTS(SELECT 1 FROM notes_tickets WHERE ticket_id = t.id AND type_note = 'sms') as msg_sms,
               EXISTS(SELECT 1 FROM notes_tickets WHERE ticket_id = t.id AND type_note = 'email') as msg_email
        FROM tickets t
        JOIN clients c ON t.client_id = c.id
        {where}
        ORDER BY t.date_depot DESC
        LIMIT %s OFFSET %s
    """
    params.extend([limit, offset])

    with get_cursor() as cur:
        cur.execute(query, params)
        return cur.fetchall()


# ─── TICKET UNIQUE ─────────────────────────────────────────────
@router.get("/{ticket_id}")
async def get_ticket(ticket_id: int, user: Optional[dict] = Depends(get_optional_user)):
    """Récupère un ticket par ID avec les infos client + retour SAV enrichi."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT t.*,
                   c.nom as client_nom, c.prenom as client_prenom,
                   c.telephone as client_tel, c.email as client_email,
                   c.societe as client_societe, c.carte_camby as client_carte_camby
            FROM tickets t
            JOIN clients c ON t.client_id = c.id
            WHERE t.id = %s
        """, (ticket_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Ticket non trouvé")

    result = dict(row)

    # Enrichir avec info ticket original si retour SAV
    if result.get("est_retour_sav") and result.get("ticket_original_id"):
        try:
            with get_cursor() as cur:
                cur.execute("""
                    SELECT id, ticket_code, statut, panne, marque, modele, modele_autre,
                           date_depot, date_cloture, technicien_assigne
                    FROM tickets WHERE id = %s
                """, (result["ticket_original_id"],))
                orig = cur.fetchone()
                result["ticket_original"] = dict(orig) if orig else None
        except Exception:
            result["ticket_original"] = None
    else:
        result["ticket_original"] = None

    # Lister les retours SAV liés à ce ticket (si c'est un ticket original)
    try:
        with get_cursor() as cur:
            cur.execute("""
                SELECT id, ticket_code, statut, panne, date_depot
                FROM tickets
                WHERE ticket_original_id = %s AND est_retour_sav = true
                ORDER BY date_depot DESC
            """, (ticket_id,))
            retours = cur.fetchall()
            result["retours_sav"] = [dict(r) for r in retours] if retours else []
    except Exception:
        result["retours_sav"] = []

    return result


@router.get("/phone/{telephone}")
async def get_tickets_by_phone(telephone: str):
    """Récupère les tickets par téléphone client (public — pour suivi client)."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT t.ticket_code, t.statut, t.marque, t.modele, t.modele_autre,
                   t.panne, t.date_depot, t.date_maj
            FROM tickets t
            JOIN clients c ON t.client_id = c.id
            WHERE c.telephone LIKE %s
            ORDER BY t.date_depot DESC
            LIMIT 20
        """, (f"%{telephone}%",))
        rows = cur.fetchall()
    return rows


@router.get("/code/{ticket_code}")
async def get_ticket_by_code(ticket_code: str):
    """Récupère un ticket par code (public — pour suivi client)."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT t.*,
                   c.nom as client_nom, c.prenom as client_prenom,
                   c.telephone as client_tel, c.email as client_email,
                   c.societe as client_societe, c.carte_camby as client_carte_camby
            FROM tickets t
            JOIN clients c ON t.client_id = c.id
            WHERE t.ticket_code = %s
        """, (ticket_code,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Ticket non trouvé")
    return dict(row)


# ─── CRÉATION ───────────────────────────────────────────────────
@router.post("", response_model=dict)
async def create_ticket(data: TicketCreate):
    """Crée un nouveau ticket (accessible sans auth — formulaire client)."""
    # Si retour SAV, vérifier que le ticket original existe et appartient au même client
    if data.est_retour_sav and data.ticket_original_id:
        with get_cursor() as cur:
            cur.execute(
                "SELECT id, client_id FROM tickets WHERE id = %s",
                (data.ticket_original_id,),
            )
            orig = cur.fetchone()
            if not orig:
                raise HTTPException(404, "Ticket original non trouvé")
            if orig["client_id"] != data.client_id:
                raise HTTPException(400, "Le ticket original n'appartient pas à ce client")

    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO tickets
            (client_id, categorie, marque, modele, modele_autre, imei,
             panne, panne_detail, pin, pattern, notes_client,
             commande_piece, statut, est_retour_sav, ticket_original_id)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'En attente de diagnostic',%s,%s)
            RETURNING id
        """, (
            data.client_id, data.categorie, data.marque, data.modele,
            data.modele_autre, data.imei, data.panne, data.panne_detail,
            data.pin, data.pattern, data.notes_client, data.commande_piece,
            data.est_retour_sav or False, data.ticket_original_id,
        ))
        row = cur.fetchone()
        tid = row["id"]

        code = f"KP-{tid:06d}"
        cur.execute("UPDATE tickets SET ticket_code = %s WHERE id = %s", (code, tid))

    # Apprentissage autocomplétion (silencieux)
    learn_terms({"panne": data.panne, "panne_detail": data.panne_detail, "modele_autre": data.modele_autre})

    # Notification Discord (non bloquant)
    appareil = data.modele_autre if data.modele_autre else f"{data.marque} {data.modele}"
    notif_nouveau_ticket(code, appareil, data.panne or data.panne_detail or "Réparation")

    return {"id": tid, "ticket_code": code}


# ─── MISE À JOUR ────────────────────────────────────────────────
@router.patch("/{ticket_id}", response_model=dict)
async def update_ticket(
    ticket_id: int,
    data: TicketUpdate,
    user: dict = Depends(get_current_user),
):
    """Met à jour un ticket (champs partiels)."""
    updates = {k: v for k, v in data.model_dump(exclude_unset=True).items()}
    if not updates:
        return {"ok": True}

    updates["date_maj"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    set_clause = ", ".join(f"{k} = %s" for k in updates.keys())
    values = list(updates.values()) + [ticket_id]

    with get_cursor() as cur:
        cur.execute(
            f"UPDATE tickets SET {set_clause} WHERE id = %s",
            values,
        )

    # Apprentissage autocomplétion (silencieux)
    learn_terms(updates)

    return {"ok": True}


# ─── TOGGLE PAYÉ ────────────────────────────────────────────────
@router.patch("/{ticket_id}/paye", response_model=dict)
async def toggle_paye(
    ticket_id: int,
    user: dict = Depends(get_current_user),
):
    """Bascule le statut payé du ticket. Crédite les points fidélité si marqué payé."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ts = datetime.now().strftime("%d/%m %H:%M")
    fidelite_result = None

    with get_cursor() as cur:
        cur.execute(
            "SELECT paye, historique, client_id, tarif_final, devis_estime, prix_supp FROM tickets WHERE id = %s",
            (ticket_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Ticket non trouvé")

        new_paye = 0 if row.get("paye") else 1
        historique = row.get("historique") or ""
        log_entry = f"[{ts}] {'Marqué payé' if new_paye else 'Marqué non payé'}"
        new_hist = f"{historique.rstrip()}\n{log_entry}" if historique.strip() else log_entry

        cur.execute(
            "UPDATE tickets SET paye = %s, date_maj = %s, historique = %s WHERE id = %s",
            (new_paye, now, new_hist, ticket_id),
        )
        _ajouter_historique(cur, ticket_id, 'statut', 'Marqué payé' if new_paye else 'Marqué non payé')

        # Auto-crédit fidélité quand marqué payé
        if new_paye == 1:
            try:
                fidelite_active = "1"
                cur.execute("SELECT valeur FROM params WHERE cle = 'fidelite_active'")
                r = cur.fetchone()
                if r:
                    fidelite_active = r["valeur"]

                if fidelite_active != "0":
                    client_id = row["client_id"]
                    montant = float(row.get("tarif_final") or row.get("devis_estime") or 0) + float(row.get("prix_supp") or 0)
                    if montant > 0:
                        cur.execute("SELECT valeur FROM params WHERE cle = 'fidelite_points_par_euro'")
                        r2 = cur.fetchone()
                        pts_par_euro = int(r2["valeur"]) if r2 else 10
                        points_gagnes = int(montant * pts_par_euro)

                        # Vérifier pas déjà crédité
                        cur.execute(
                            "SELECT id FROM fidelite_historique WHERE ticket_id = %s AND type = 'gain'",
                            (ticket_id,),
                        )
                        if not cur.fetchone() and points_gagnes > 0:
                            cur.execute("""
                                UPDATE clients
                                SET points_fidelite = COALESCE(points_fidelite, 0) + %s,
                                    total_depense = COALESCE(total_depense, 0) + %s
                                WHERE id = %s
                                RETURNING points_fidelite
                            """, (points_gagnes, montant, client_id))
                            pts_row = cur.fetchone()
                            total_pts = pts_row["points_fidelite"] if pts_row else 0

                            cur.execute("""
                                INSERT INTO fidelite_historique (client_id, ticket_id, type, points, description)
                                VALUES (%s, %s, 'gain', %s, %s)
                            """, (client_id, ticket_id, points_gagnes,
                                  f"Réparation {montant:.2f}€ — +{points_gagnes} pts"))

                            fidelite_result = {
                                "points_gagnes": points_gagnes,
                                "total_points": total_pts,
                            }
            except Exception:
                pass  # Ne pas bloquer le paiement si la fidélité échoue

    result = {"ok": True, "paye": new_paye}
    if fidelite_result:
        result["fidelite"] = fidelite_result
    return result


# ─── CHANGEMENT DE STATUT ───────────────────────────────────────
@router.patch("/{ticket_id}/statut", response_model=dict)
async def change_status(
    ticket_id: int,
    data: StatusChange,
    user: dict = Depends(get_current_user),
):
    """Change le statut d'un ticket avec historique et notifications."""
    if data.statut not in STATUTS:
        raise HTTPException(400, f"Statut invalide. Valides: {STATUTS}")

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ts = datetime.now().strftime("%d/%m %H:%M")

    with get_cursor() as cur:
        # Récupérer ancien statut et historique
        cur.execute("SELECT statut, historique, ticket_code FROM tickets WHERE id = %s", (ticket_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Ticket non trouvé")

        ancien_statut = row.get("statut", "")
        historique = row.get("historique") or ""
        ticket_code = row.get("ticket_code", f"#{ticket_id}")

        # Ajouter à l'historique
        log_entry = f"[{ts}] Statut: {ancien_statut} → {data.statut}"
        new_hist = f"{historique.rstrip()}\n{log_entry}" if historique.strip() else log_entry

        # Mise à jour
        if data.statut == "Clôturé":
            cur.execute(
                "UPDATE tickets SET statut=%s, date_maj=%s, date_cloture=%s, historique=%s WHERE id=%s",
                (data.statut, now, now, new_hist, ticket_id),
            )
        else:
            cur.execute(
                "UPDATE tickets SET statut=%s, date_maj=%s, historique=%s WHERE id=%s",
                (data.statut, now, new_hist, ticket_id),
            )

        # Timer auto — start/stop
        entering_repair = data.statut == "En cours de réparation" and ancien_statut != "En cours de réparation"
        leaving_repair = ancien_statut == "En cours de réparation" and data.statut != "En cours de réparation"

        if entering_repair:
            cur.execute(
                "UPDATE tickets SET reparation_debut = %s, reparation_fin = NULL WHERE id = %s",
                (now, ticket_id),
            )
        elif leaving_repair:
            cur.execute(
                "SELECT reparation_debut, reparation_duree FROM tickets WHERE id = %s",
                (ticket_id,),
            )
            tr = cur.fetchone()
            if tr and tr.get("reparation_debut"):
                debut = tr["reparation_debut"]
                if isinstance(debut, str):
                    debut = datetime.strptime(debut, "%Y-%m-%d %H:%M:%S")
                elapsed = int((datetime.now() - debut).total_seconds())
                prev = tr.get("reparation_duree") or 0
                cur.execute(
                    "UPDATE tickets SET reparation_fin = %s, reparation_duree = %s WHERE id = %s",
                    (now, prev + elapsed, ticket_id),
                )

        _ajouter_historique(cur, ticket_id, 'statut', f"Statut: {ancien_statut} → {data.statut}")

    # Notifications Discord
    if data.statut == "Réparation terminée":
        notif_reparation_terminee(ticket_code)
    elif ancien_statut and ancien_statut != data.statut:
        notif_changement_statut(ticket_code, ancien_statut, data.statut)

    return {"ok": True, "ancien_statut": ancien_statut, "nouveau_statut": data.statut}


# ─── HISTORIQUE (structured table) ───────────────────────────────
@router.get("/{ticket_id}/historique")
async def get_historique(ticket_id: int, user: dict = Depends(get_current_user)):
    """Retourne l'historique structuré d'un ticket."""
    with get_cursor() as cur:
        try:
            cur.execute("""
                SELECT id, type, contenu, date_creation
                FROM historique
                WHERE ticket_id = %s
                ORDER BY date_creation DESC
            """, (ticket_id,))
            rows = cur.fetchall()
            return [{**r, "date_creation": r["date_creation"].isoformat() if r.get("date_creation") else None} for r in rows]
        except Exception:
            return []


# ─── HISTORIQUE (legacy text field) ──────────────────────────────
@router.post("/{ticket_id}/historique", response_model=dict)
async def add_history(
    ticket_id: int,
    texte: str = Query(...),
    user: dict = Depends(get_current_user),
):
    """Ajoute une entrée dans l'historique du ticket."""
    ts = datetime.now().strftime("%d/%m %H:%M")
    entry = f"[{ts}] {texte}"

    with get_cursor() as cur:
        cur.execute("SELECT historique FROM tickets WHERE id = %s", (ticket_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Ticket non trouvé")

        historique = row.get("historique") or ""
        new_hist = f"{historique.rstrip()}\n{entry}" if historique.strip() else entry
        cur.execute("UPDATE tickets SET historique = %s WHERE id = %s", (new_hist, ticket_id))
        _ajouter_historique(cur, ticket_id, 'statut', texte)

    return {"ok": True}


# ─── NOTE INTERNE ────────────────────────────────────────────────
@router.post("/{ticket_id}/note", response_model=dict)
async def add_note(
    ticket_id: int,
    note: str = Query(...),
    user: dict = Depends(get_current_user),
):
    """Ajoute une note interne au ticket."""
    ts = datetime.now().strftime("%d/%m/%Y %H:%M")

    with get_cursor() as cur:
        cur.execute("SELECT notes_internes FROM tickets WHERE id = %s", (ticket_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Ticket non trouvé")

        existing = row.get("notes_internes") or ""
        new_notes = f"{existing}\n[{ts}] {note}" if existing.strip() else f"[{ts}] {note}"
        cur.execute(
            "UPDATE tickets SET notes_internes = %s, date_maj = %s WHERE id = %s",
            (new_notes, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), ticket_id),
        )
        note_type = 'note_publique' if '[CLIENT]' in note else 'alerte' if '[ATTENTION]' in note else 'note_privee'
        _ajouter_historique(cur, ticket_id, note_type, note)

    return {"ok": True}


# ─── NOTES PRIVÉES ─────────────────────────────────────────────────
@router.get("/{ticket_id}/notes")
async def get_notes(ticket_id: int, user: dict = Depends(get_current_user)):
    """Récupère les notes privées d'un ticket."""
    with get_cursor() as cur:
        try:
            cur.execute("""
                SELECT id, auteur, contenu, important, date_creation,
                       COALESCE(type_note, 'note') as type_note
                FROM notes_tickets
                WHERE ticket_id = %s
                ORDER BY date_creation DESC
            """, (ticket_id,))
            rows = cur.fetchall()
            return [{**r, "date_creation": r["date_creation"].isoformat() if r.get("date_creation") else None} for r in rows]
        except Exception:
            return []


@router.post("/{ticket_id}/notes")
async def add_private_note(
    ticket_id: int,
    auteur: str = Query(...),
    contenu: str = Query(...),
    important: bool = Query(False),
    user: dict = Depends(get_current_user),
):
    """Ajoute une note privée à un ticket."""
    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO notes_tickets (ticket_id, auteur, contenu, important)
            VALUES (%s, %s, %s, %s) RETURNING id, date_creation
        """, (ticket_id, auteur, contenu, important))
        row = cur.fetchone()
        _ajouter_historique(cur, ticket_id, 'note_privee', f"Note ({auteur}): {contenu[:50]}...")
    return {"id": row["id"], "date_creation": row["date_creation"].isoformat()}


@router.delete("/{ticket_id}/notes/{note_id}")
async def delete_private_note(
    ticket_id: int,
    note_id: int,
    user: dict = Depends(get_current_user),
):
    """Supprime une note privée."""
    with get_cursor() as cur:
        cur.execute("DELETE FROM notes_tickets WHERE id = %s AND ticket_id = %s", (note_id, ticket_id))
    return {"ok": True}


@router.patch("/{ticket_id}/notes/{note_id}")
async def update_private_note(
    ticket_id: int,
    note_id: int,
    important: Optional[bool] = Query(None),
    user: dict = Depends(get_current_user),
):
    """Met à jour une note privée (toggle important)."""
    if important is not None:
        with get_cursor() as cur:
            cur.execute(
                "UPDATE notes_tickets SET important = %s WHERE id = %s AND ticket_id = %s",
                (important, note_id, ticket_id),
            )
    return {"ok": True}


# ─── LOG MESSAGE ENVOYÉ ──────────────────────────────────────────
@router.post("/{ticket_id}/message-log", response_model=dict)
async def log_message(
    ticket_id: int,
    auteur: str = Query(...),
    contenu: str = Query(...),
    canal: str = Query("whatsapp"),
    user: dict = Depends(get_current_user),
):
    """Enregistre un message envoyé (whatsapp/sms/email) dans les notes."""
    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO notes_tickets (ticket_id, auteur, contenu, important, type_note)
            VALUES (%s, %s, %s, FALSE, %s) RETURNING id, date_creation
        """, (ticket_id, auteur, contenu, canal))
        row = cur.fetchone()
    return {"id": row["id"], "date_creation": row["date_creation"].isoformat()}


# ─── SUPPRESSION ─────────────────────────────────────────────────
@router.delete("/{ticket_id}", response_model=dict)
async def delete_ticket(ticket_id: int, user: dict = Depends(get_current_user)):
    """Supprime un ticket et toutes ses données liées (cascade)."""
    with get_cursor() as cur:
        cur.execute("DELETE FROM notes_tickets WHERE ticket_id = %s", (ticket_id,))
        cur.execute("DELETE FROM commandes_pieces WHERE ticket_id = %s", (ticket_id,))
        cur.execute("DELETE FROM fidelite_historique WHERE ticket_id = %s", (ticket_id,))
        cur.execute("DELETE FROM historique WHERE ticket_id = %s", (ticket_id,))
        cur.execute("DELETE FROM tickets WHERE id = %s", (ticket_id,))
    return {"ok": True}


