"""
API Admin — Tableau de bord analytique pour l'administration Klikphone SAV.
Endpoints d'analytics : stats globales, reparations, flux clients,
performance techniciens et courbes d'evolution.
"""

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..database import get_cursor

router = APIRouter(prefix="/api/admin", tags=["admin"])


# ============================================================
# SCHEMAS
# ============================================================
class AdminLoginRequest(BaseModel):
    identifiant: str
    password: str


class AdminLoginResponse(BaseModel):
    success: bool
    token: str


# ============================================================
# HELPERS
# ============================================================
def _period_to_days(period: Optional[str]) -> int:
    """Convertit un parametre period en nombre de jours."""
    mapping = {
        "7d": 7,
        "30d": 30,
        "90d": 90,
        "12m": 365,
    }
    return mapping.get(period, 30)


def _period_to_months(period: Optional[str]) -> int:
    """Convertit un parametre period en nombre de mois."""
    mapping = {
        "6m": 6,
        "12m": 12,
    }
    return mapping.get(period, 12)


# ============================================================
# 1. LOGIN ADMIN
# ============================================================
@router.post("/login", response_model=AdminLoginResponse)
async def admin_login(data: AdminLoginRequest):
    """Connexion administrateur avec identifiants hardcodes."""
    if data.identifiant == "admin" and data.password == "caramail":
        return AdminLoginResponse(success=True, token="admin-session")
    raise HTTPException(status_code=401, detail="Identifiants incorrects")


# ============================================================
# 2. STATS GLOBALES
# ============================================================
@router.get("/stats")
async def get_stats(period: Optional[str] = Query(None, regex="^(7d|30d|90d|12m)$")):
    """
    Statistiques globales du SAV.
    - ca_jour / ca_mois : chiffre d'affaires du jour / du mois (tickets payes clotures)
    - reparations_jour / reparations_mois : nombre de reparations cloturees
    - ticket_moyen : CA mois / reparations mois
    - total_actifs : tickets ni Cloture ni Rendu
    - nouveaux_jour : tickets deposes aujourd'hui
    """
    today = datetime.now().strftime("%Y-%m-%d")
    first_of_month = datetime.now().strftime("%Y-%m-01")

    with get_cursor() as cur:
        cur.execute("""
            SELECT
                -- CA du jour : somme tarif_final des tickets clotures aujourd'hui et payes
                COALESCE(SUM(tarif_final) FILTER (
                    WHERE date_cloture::date = %(today)s::date AND paye = 1
                ), 0) AS ca_jour,

                -- CA du mois : somme tarif_final des tickets clotures ce mois et payes
                COALESCE(SUM(tarif_final) FILTER (
                    WHERE date_cloture::date >= %(first_of_month)s::date AND paye = 1
                ), 0) AS ca_mois,

                -- Reparations du jour
                COUNT(*) FILTER (
                    WHERE date_cloture::date = %(today)s::date
                ) AS reparations_jour,

                -- Reparations du mois
                COUNT(*) FILTER (
                    WHERE date_cloture::date >= %(first_of_month)s::date
                ) AS reparations_mois,

                -- Total tickets actifs (ni Cloture ni Rendu au client)
                COUNT(*) FILTER (
                    WHERE statut NOT IN ('Clôturé', 'Rendu au client')
                ) AS total_actifs,

                -- Nouveaux tickets du jour
                COUNT(*) FILTER (
                    WHERE date_depot::date = %(today)s::date
                ) AS nouveaux_jour

            FROM tickets
        """, {"today": today, "first_of_month": first_of_month})

        row = cur.fetchone()

    ca_mois = float(row["ca_mois"]) if row["ca_mois"] else 0.0
    reparations_mois = int(row["reparations_mois"]) if row["reparations_mois"] else 0
    ticket_moyen = round(ca_mois / reparations_mois, 2) if reparations_mois > 0 else 0.0

    return {
        "ca_jour": float(row["ca_jour"]) if row["ca_jour"] else 0.0,
        "ca_mois": ca_mois,
        "reparations_jour": int(row["reparations_jour"]) if row["reparations_jour"] else 0,
        "reparations_mois": reparations_mois,
        "ticket_moyen": ticket_moyen,
        "total_actifs": int(row["total_actifs"]) if row["total_actifs"] else 0,
        "nouveaux_jour": int(row["nouveaux_jour"]) if row["nouveaux_jour"] else 0,
    }


# ============================================================
# 3. REPARATIONS (graphiques)
# ============================================================
@router.get("/reparations")
async def get_reparations(
    period: str = Query("30d", regex="^(7d|30d|90d|12m)$"),
    marque: Optional[str] = None,
    tech: Optional[str] = None,
):
    """
    Donnees de reparations pour les graphiques.
    Retourne les repartitions par jour, mois, marque, technicien et panne.
    Filtrable par periode, marque et technicien.
    """
    days = _period_to_days(period)
    date_start = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    # Construction des filtres optionnels
    extra_conditions = ""
    params: dict = {"date_start": date_start}

    if marque:
        extra_conditions += " AND marque = %(marque)s"
        params["marque"] = marque
    if tech:
        extra_conditions += " AND technicien_assigne = %(tech)s"
        params["tech"] = tech

    with get_cursor() as cur:
        # --- Par jour (derniers N jours) ---
        cur.execute(f"""
            SELECT date_cloture::date AS date, COUNT(*) AS count
            FROM tickets
            WHERE date_cloture IS NOT NULL
              AND date_cloture::date >= %(date_start)s::date
              {extra_conditions}
            GROUP BY date_cloture::date
            ORDER BY date_cloture::date
        """, params)
        par_jour = [
            {"date": row["date"].strftime("%Y-%m-%d"), "count": row["count"]}
            for row in cur.fetchall()
        ]

        # --- Par mois (12 derniers mois) ---
        cur.execute(f"""
            SELECT TO_CHAR(DATE_TRUNC('month', date_cloture::timestamp), 'YYYY-MM') AS mois,
                   COUNT(*) AS count
            FROM tickets
            WHERE date_cloture IS NOT NULL
              AND date_cloture::timestamp >= NOW() - INTERVAL '12 months'
              {extra_conditions}
            GROUP BY DATE_TRUNC('month', date_cloture::timestamp)
            ORDER BY DATE_TRUNC('month', date_cloture::timestamp)
        """, params)
        par_mois = [
            {"mois": row["mois"], "count": row["count"]}
            for row in cur.fetchall()
        ]

        # --- Par marque ---
        cur.execute(f"""
            SELECT COALESCE(marque, 'Inconnu') AS marque, COUNT(*) AS count
            FROM tickets
            WHERE date_cloture IS NOT NULL
              AND date_cloture::date >= %(date_start)s::date
              {extra_conditions}
            GROUP BY marque
            ORDER BY count DESC
        """, params)
        par_marque = [
            {"marque": row["marque"], "count": row["count"]}
            for row in cur.fetchall()
        ]

        # --- Par technicien ---
        cur.execute(f"""
            SELECT COALESCE(technicien_assigne, 'Non assigné') AS technicien,
                   COUNT(*) AS count
            FROM tickets
            WHERE date_cloture IS NOT NULL
              AND date_cloture::date >= %(date_start)s::date
              {extra_conditions}
            GROUP BY technicien_assigne
            ORDER BY count DESC
        """, params)
        par_technicien = [
            {"technicien": row["technicien"], "count": row["count"]}
            for row in cur.fetchall()
        ]

        # --- Par panne ---
        cur.execute(f"""
            SELECT COALESCE(panne, 'Non renseigné') AS panne, COUNT(*) AS count
            FROM tickets
            WHERE date_cloture IS NOT NULL
              AND date_cloture::date >= %(date_start)s::date
              {extra_conditions}
            GROUP BY panne
            ORDER BY count DESC
            LIMIT 20
        """, params)
        par_panne = [
            {"panne": row["panne"], "count": row["count"]}
            for row in cur.fetchall()
        ]

    return {
        "par_jour": par_jour,
        "par_mois": par_mois,
        "par_marque": par_marque,
        "par_technicien": par_technicien,
        "par_panne": par_panne,
    }


# ============================================================
# 4. FLUX CLIENTS
# ============================================================
JOURS_SEMAINE = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]


@router.get("/flux-clients")
async def get_flux_clients():
    """
    Flux de depots clients : repartition par heure, jour de semaine et heatmap.
    Base sur les timestamps date_depot.
    """
    with get_cursor() as cur:
        # --- Par heure (8h a 20h) ---
        cur.execute("""
            SELECT EXTRACT(HOUR FROM date_depot)::int AS heure, COUNT(*) AS count
            FROM tickets
            WHERE date_depot IS NOT NULL
              AND EXTRACT(HOUR FROM date_depot) BETWEEN 8 AND 20
            GROUP BY EXTRACT(HOUR FROM date_depot)
            ORDER BY heure
        """)
        par_heure_raw = {row["heure"]: row["count"] for row in cur.fetchall()}
        par_heure = [
            {"heure": h, "count": par_heure_raw.get(h, 0)}
            for h in range(8, 21)
        ]

        # --- Par jour de semaine ---
        # PostgreSQL EXTRACT(ISODOW ...) : 1=Lundi, 7=Dimanche
        cur.execute("""
            SELECT EXTRACT(ISODOW FROM date_depot)::int AS jour_num, COUNT(*) AS count
            FROM tickets
            WHERE date_depot IS NOT NULL
            GROUP BY EXTRACT(ISODOW FROM date_depot)
            ORDER BY jour_num
        """)
        par_jour_raw = {row["jour_num"]: row["count"] for row in cur.fetchall()}
        par_jour_semaine = [
            {"jour": JOURS_SEMAINE[i], "count": par_jour_raw.get(i + 1, 0)}
            for i in range(7)
        ]

        # --- Heatmap (jour x heure) ---
        # jour: 0=Lundi ... 6=Dimanche, heure: 8-20
        cur.execute("""
            SELECT
                (EXTRACT(ISODOW FROM date_depot)::int - 1) AS jour,
                EXTRACT(HOUR FROM date_depot)::int AS heure,
                COUNT(*) AS count
            FROM tickets
            WHERE date_depot IS NOT NULL
              AND EXTRACT(HOUR FROM date_depot) BETWEEN 8 AND 20
            GROUP BY EXTRACT(ISODOW FROM date_depot), EXTRACT(HOUR FROM date_depot)
            ORDER BY jour, heure
        """)
        heatmap_raw = {
            (row["jour"], row["heure"]): row["count"]
            for row in cur.fetchall()
        }
        heatmap = [
            {"jour": j, "heure": h, "count": heatmap_raw.get((j, h), 0)}
            for j in range(7)
            for h in range(8, 21)
        ]

    return {
        "par_heure": par_heure,
        "par_jour_semaine": par_jour_semaine,
        "heatmap": heatmap,
    }


# ============================================================
# 5. PERFORMANCE TECHNICIENS
# ============================================================
@router.get("/performance-tech")
async def get_performance_tech():
    """
    Performance par technicien :
    - reparations : nombre de tickets clotures
    - temps_moyen_minutes : duree moyenne (date_cloture - date_depot) en minutes
    - ca_genere : somme des tarif_final (tickets payes)
    """
    with get_cursor() as cur:
        cur.execute("""
            SELECT
                COALESCE(technicien_assigne, 'Non assigné') AS technicien,
                COUNT(*) AS reparations,
                COALESCE(
                    ROUND(
                        AVG(
                            EXTRACT(EPOCH FROM (date_cloture::timestamp - date_depot::timestamp)) / 60
                        )
                    ),
                    0
                )::int AS temps_moyen_minutes,
                COALESCE(SUM(tarif_final) FILTER (WHERE paye = 1), 0) AS ca_genere
            FROM tickets
            WHERE date_cloture IS NOT NULL
              AND technicien_assigne IS NOT NULL
              AND technicien_assigne != ''
            GROUP BY technicien_assigne
            ORDER BY reparations DESC
        """)
        rows = cur.fetchall()

    result = []
    for row in rows:
        result.append({
            "technicien": row["technicien"],
            "reparations": row["reparations"],
            "temps_moyen_minutes": int(row["temps_moyen_minutes"]) if row["temps_moyen_minutes"] else 0,
            "ca_genere": round(float(row["ca_genere"]), 2) if row["ca_genere"] else 0.0,
        })

    return result


# ============================================================
# 6. EVOLUTION (courbes)
# ============================================================
@router.get("/evolution")
async def get_evolution(
    metric: str = Query("ca", regex="^(ca|flux)$"),
    period: str = Query("12m", regex="^(6m|12m)$"),
):
    """
    Courbes d'evolution mensuelles.
    - metric=ca : chiffre d'affaires par mois (tarif_final des tickets payes)
    - metric=flux : nombre de tickets crees par mois (date_depot)
    """
    months = _period_to_months(period)

    with get_cursor() as cur:
        if metric == "ca":
            cur.execute("""
                SELECT
                    TO_CHAR(DATE_TRUNC('month', date_cloture::timestamp), 'YYYY-MM') AS date,
                    COALESCE(SUM(tarif_final), 0) AS value
                FROM tickets
                WHERE date_cloture IS NOT NULL
                  AND paye = 1
                  AND date_cloture::timestamp >= NOW() - (%(months)s || ' months')::INTERVAL
                GROUP BY DATE_TRUNC('month', date_cloture::timestamp)
                ORDER BY DATE_TRUNC('month', date_cloture::timestamp)
            """, {"months": months})
        else:
            # metric == "flux"
            cur.execute("""
                SELECT
                    TO_CHAR(DATE_TRUNC('month', date_depot::timestamp), 'YYYY-MM') AS date,
                    COUNT(*) AS value
                FROM tickets
                WHERE date_depot IS NOT NULL
                  AND date_depot::timestamp >= NOW() - (%(months)s || ' months')::INTERVAL
                GROUP BY DATE_TRUNC('month', date_depot::timestamp)
                ORDER BY DATE_TRUNC('month', date_depot::timestamp)
            """, {"months": months})

        rows = cur.fetchall()

    data = []
    for row in rows:
        val = row["value"]
        if metric == "ca":
            val = round(float(val), 2) if val else 0.0
        else:
            val = int(val) if val else 0
        data.append({"date": row["date"], "value": val})

    return {"data": data}
