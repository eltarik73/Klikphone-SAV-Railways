"""
API Programme Fidélité + Jeu de Grattage.
- 10 points par euro dépensé
- Paliers : 1000 pts = film verre trempé, 5000 pts = réduction 10€
- Jeu de grattage : 1 gagnant tous les N tickets (configurable)
"""

import random
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.database import get_cursor

router = APIRouter(prefix="/api/fidelite", tags=["fidelite"])

_table_checked = False


def _ensure_tables():
    global _table_checked
    if _table_checked:
        return
    stmts = [
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS points_fidelite INTEGER DEFAULT 0",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS total_depense DECIMAL(10,2) DEFAULT 0",
        """CREATE TABLE IF NOT EXISTS fidelite_historique (
            id SERIAL PRIMARY KEY,
            client_id INTEGER REFERENCES clients(id),
            ticket_id INTEGER REFERENCES tickets(id),
            type TEXT NOT NULL,
            points INTEGER NOT NULL,
            description TEXT,
            date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS grattage_fait BOOLEAN DEFAULT FALSE",
        "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS grattage_gain TEXT",
    ]
    for stmt in stmts:
        try:
            with get_cursor() as cur:
                cur.execute(stmt)
        except Exception as e:
            print(f"Warning fidelite migration: {e}")
    _table_checked = True


def _get_param(cur, key: str, default: str = "") -> str:
    cur.execute("SELECT valeur FROM params WHERE cle = %s", (key,))
    row = cur.fetchone()
    return row["valeur"] if row else default


# ─── MODELS ─────────────────────────────────────────────

class CrediterRequest(BaseModel):
    client_id: int
    ticket_id: int
    montant: float


class UtiliserRequest(BaseModel):
    client_id: int
    type: str  # "film" ou "reduction"


# ─── CREDITER POINTS ────────────────────────────────────

@router.post("/crediter")
async def crediter_points(data: CrediterRequest):
    """Crédite les points quand un ticket est payé."""
    _ensure_tables()
    with get_cursor() as cur:
        pts_par_euro = int(_get_param(cur, "fidelite_points_par_euro", "10"))
        fidelite_active = _get_param(cur, "fidelite_active", "1")
        if fidelite_active == "0":
            return {"points_gagnes": 0, "total_points": 0, "palier_film": False, "palier_reduction": False}

        points_gagnes = int(data.montant * pts_par_euro)
        if points_gagnes <= 0:
            return {"points_gagnes": 0, "total_points": 0, "palier_film": False, "palier_reduction": False}

        # Vérifier que ce ticket n'a pas déjà crédité des points
        cur.execute(
            "SELECT id FROM fidelite_historique WHERE ticket_id = %s AND type = 'gain'",
            (data.ticket_id,),
        )
        if cur.fetchone():
            # Déjà crédité, retourner l'état actuel
            cur.execute("SELECT points_fidelite FROM clients WHERE id = %s", (data.client_id,))
            row = cur.fetchone()
            pts = row["points_fidelite"] if row else 0
            return {"points_gagnes": 0, "total_points": pts, "palier_film": pts >= 1000, "palier_reduction": pts >= 5000}

        cur.execute("""
            UPDATE clients
            SET points_fidelite = COALESCE(points_fidelite, 0) + %s,
                total_depense = COALESCE(total_depense, 0) + %s
            WHERE id = %s
            RETURNING points_fidelite
        """, (points_gagnes, data.montant, data.client_id))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Client non trouvé")
        nouveau_total = row["points_fidelite"]

        cur.execute("""
            INSERT INTO fidelite_historique (client_id, ticket_id, type, points, description)
            VALUES (%s, %s, 'gain', %s, %s)
        """, (data.client_id, data.ticket_id, points_gagnes,
              f"Réparation {data.montant:.2f}€ — +{points_gagnes} pts"))

        palier_film = int(_get_param(cur, "fidelite_palier_film", "1000"))
        palier_reduction = int(_get_param(cur, "fidelite_palier_reduction", "5000"))

    return {
        "points_gagnes": points_gagnes,
        "total_points": nouveau_total,
        "palier_film": nouveau_total >= palier_film,
        "palier_reduction": nouveau_total >= palier_reduction,
    }


# ─── UTILISER POINTS ────────────────────────────────────

@router.post("/utiliser")
async def utiliser_points(data: UtiliserRequest):
    """Utilise des points pour une récompense."""
    _ensure_tables()
    with get_cursor() as cur:
        palier_film = int(_get_param(cur, "fidelite_palier_film", "1000"))
        palier_reduction = int(_get_param(cur, "fidelite_palier_reduction", "5000"))

        cur.execute("SELECT points_fidelite FROM clients WHERE id = %s", (data.client_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Client non trouvé")
        points_actuels = row["points_fidelite"] or 0

        if data.type == "film" and points_actuels >= palier_film:
            points_deduits = palier_film
            description = f"Film verre trempé offert — -{palier_film} pts"
            hist_type = "utilisation_film"
        elif data.type == "reduction" and points_actuels >= palier_reduction:
            points_deduits = palier_reduction
            montant_red = _get_param(cur, "fidelite_montant_reduction", "10")
            description = f"Réduction {montant_red}€ utilisée — -{palier_reduction} pts"
            hist_type = "utilisation_reduction"
        else:
            raise HTTPException(400, "Points insuffisants")

        cur.execute(
            "UPDATE clients SET points_fidelite = points_fidelite - %s WHERE id = %s",
            (points_deduits, data.client_id),
        )
        cur.execute("""
            INSERT INTO fidelite_historique (client_id, type, points, description)
            VALUES (%s, %s, %s, %s)
        """, (data.client_id, hist_type, -points_deduits, description))

    return {"status": "ok", "points_restants": points_actuels - points_deduits}


# ─── GET FIDELITE ───────────────────────────────────────

@router.get("/{client_id}")
async def get_fidelite(client_id: int):
    """Récupère les infos fidélité d'un client."""
    _ensure_tables()
    with get_cursor() as cur:
        fidelite_active = _get_param(cur, "fidelite_active", "1")
        palier_film = int(_get_param(cur, "fidelite_palier_film", "1000"))
        palier_reduction = int(_get_param(cur, "fidelite_palier_reduction", "5000"))
        montant_reduction = _get_param(cur, "fidelite_montant_reduction", "10")
        pts_par_euro = int(_get_param(cur, "fidelite_points_par_euro", "10"))

        cur.execute("SELECT points_fidelite, total_depense FROM clients WHERE id = %s", (client_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Client non trouvé")

        points = row["points_fidelite"] or 0
        total = float(row["total_depense"] or 0)

        cur.execute("""
            SELECT type, points, description, date_creation
            FROM fidelite_historique
            WHERE client_id = %s
            ORDER BY date_creation DESC LIMIT 10
        """, (client_id,))
        historique = []
        for r in cur.fetchall():
            historique.append({
                **r,
                "date_creation": r["date_creation"].isoformat() if r.get("date_creation") else None,
            })

    # Prochaine récompense
    if points < palier_film:
        prochaine = {"type": "Film verre trempé", "points_restants": palier_film - points, "palier": palier_film}
    elif points < palier_reduction:
        prochaine = {"type": f"Réduction {montant_reduction}€", "points_restants": palier_reduction - points, "palier": palier_reduction}
    else:
        prochaine = {"type": f"Réduction {montant_reduction}€ disponible !", "points_restants": 0, "palier": palier_reduction}

    return {
        "active": fidelite_active != "0",
        "points": points,
        "total_depense": total,
        "pts_par_euro": pts_par_euro,
        "palier_film": palier_film,
        "palier_reduction": palier_reduction,
        "montant_reduction": montant_reduction,
        "prochaine_recompense": prochaine,
        "recompenses_disponibles": {
            "film": points >= palier_film,
            "reduction": points >= palier_reduction,
        },
        "historique": historique,
    }


# ─── GET FIDELITE BY TICKET CODE (public) ──────────────

@router.get("/ticket/{ticket_code}")
async def get_fidelite_by_ticket(ticket_code: str):
    """Récupère les infos fidélité à partir d'un code ticket (pour suivi public)."""
    _ensure_tables()
    with get_cursor() as cur:
        cur.execute("SELECT client_id FROM tickets WHERE ticket_code = %s", (ticket_code,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Ticket non trouvé")
        client_id = row["client_id"]

    return await get_fidelite(client_id)


# ═════════════════════════════════════════════════════════
# JEU DE GRATTAGE
# ═════════════════════════════════════════════════════════

@router.get("/grattage/{ticket_code}")
async def get_grattage(ticket_code: str):
    """Vérifie l'état du grattage pour un ticket."""
    _ensure_tables()
    with get_cursor() as cur:
        grattage_actif = _get_param(cur, "grattage_actif", "1")
        if grattage_actif == "0":
            return {"actif": False}

        cur.execute(
            "SELECT id, client_id, grattage_fait, grattage_gain FROM tickets WHERE ticket_code = %s",
            (ticket_code,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Ticket non trouvé")

        frequence = int(_get_param(cur, "grattage_frequence", "10"))

    if row["grattage_fait"]:
        return {
            "actif": True,
            "deja_gratte": True,
            "gain": row["grattage_gain"],
            "gain_label": _gain_label(row["grattage_gain"]),
            "frequence": frequence,
        }

    return {"actif": True, "deja_gratte": False, "ticket_code": ticket_code, "frequence": frequence}


@router.post("/grattage/{ticket_code}")
async def gratter(ticket_code: str):
    """Effectue le grattage d'un ticket."""
    _ensure_tables()
    with get_cursor() as cur:
        grattage_actif = _get_param(cur, "grattage_actif", "1")
        if grattage_actif == "0":
            raise HTTPException(400, "Jeu de grattage désactivé")

        cur.execute(
            "SELECT id, client_id, grattage_fait FROM tickets WHERE ticket_code = %s",
            (ticket_code,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Ticket non trouvé")
        if row["grattage_fait"]:
            raise HTTPException(400, "Déjà gratté")

        ticket_id = row["id"]
        client_id = row["client_id"]
        frequence = int(_get_param(cur, "grattage_frequence", "10"))

        # Compter les tickets grattés perdants depuis le dernier gagnant
        cur.execute("""
            SELECT COUNT(*) as c FROM tickets
            WHERE grattage_fait = TRUE AND grattage_gain IS NULL
            AND id > COALESCE(
                (SELECT MAX(id) FROM tickets WHERE grattage_gain IS NOT NULL), 0
            )
        """)
        tickets_depuis = cur.fetchone()["c"]

        gain = None
        if tickets_depuis >= frequence - 1:
            gain = random.choice(["film", "reduction"])
            description = f"Jeu de grattage — {_gain_label(gain)}"
            cur.execute("""
                INSERT INTO fidelite_historique (client_id, ticket_id, type, points, description)
                VALUES (%s, %s, 'grattage', 0, %s)
            """, (client_id, ticket_id, description))

        cur.execute(
            "UPDATE tickets SET grattage_fait = TRUE, grattage_gain = %s WHERE id = %s",
            (gain, ticket_id),
        )

    return {
        "gagnant": gain is not None,
        "gain": gain,
        "gain_label": _gain_label(gain) if gain else None,
    }


def _gain_label(gain: str) -> str:
    if gain == "film":
        return "Film verre trempé OFFERT"
    elif gain == "reduction":
        return "10€ de réduction"
    return ""
