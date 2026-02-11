"""
API Admin — Tableau de bord analytique pour l'administration Klikphone SAV.
Endpoints d'analytics : stats globales, réparations par tech, affluence,
répartition marques/pannes, évolution CA, temps réparation, conversion, top clients.
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
def _safe_float(val):
    try:
        return round(float(val), 2) if val else 0.0
    except (TypeError, ValueError):
        return 0.0


def _safe_int(val):
    try:
        return int(val) if val else 0
    except (TypeError, ValueError):
        return 0


# ============================================================
# 1. LOGIN ADMIN
# ============================================================
@router.post("/login", response_model=AdminLoginResponse)
async def admin_login(data: AdminLoginRequest):
    """Connexion administrateur avec identifiants hardcodés."""
    if data.identifiant == "admin" and data.password == "caramail":
        return AdminLoginResponse(success=True, token="admin-session")
    raise HTTPException(status_code=401, detail="Identifiants incorrects")


# ============================================================
# 2. STATS OVERVIEW (6 KPI cards)
# ============================================================
@router.get("/stats/overview")
async def get_stats_overview():
    """
    Vue d'ensemble : CA jour/mois, CA potentiel, réparations jour/mois, ticket moyen.
    """
    today = datetime.now().strftime("%Y-%m-%d")
    first_of_month = datetime.now().strftime("%Y-%m-01")

    with get_cursor() as cur:
        cur.execute("""
            SELECT
                COALESCE(SUM(tarif_final) FILTER (
                    WHERE date_cloture::date = %(today)s::date AND paye = 1
                ), 0) AS ca_jour,

                COALESCE(SUM(tarif_final) FILTER (
                    WHERE date_cloture::date >= %(first)s::date AND paye = 1
                ), 0) AS ca_mois,

                COALESCE(SUM(devis_estime) FILTER (
                    WHERE statut NOT IN ('Clôturé', 'Rendu au client')
                      AND devis_estime IS NOT NULL AND devis_estime > 0
                ), 0) AS ca_potentiel,

                COUNT(*) FILTER (
                    WHERE statut = 'Réparation terminée'
                      AND date_cloture::date = %(today)s::date
                ) AS reparations_jour,

                COUNT(*) FILTER (
                    WHERE statut = 'Réparation terminée'
                      AND date_cloture::date >= %(first)s::date
                ) AS reparations_mois_termine,

                COUNT(*) FILTER (
                    WHERE date_cloture::date >= %(first)s::date
                ) AS reparations_mois

            FROM tickets
        """, {"today": today, "first": first_of_month})
        row = cur.fetchone()

    ca_mois = _safe_float(row["ca_mois"])
    rep_mois = _safe_int(row["reparations_mois"])
    ticket_moyen = round(ca_mois / rep_mois, 2) if rep_mois > 0 else 0.0

    return {
        "ca_jour": _safe_float(row["ca_jour"]),
        "ca_mois": ca_mois,
        "ca_potentiel": _safe_float(row["ca_potentiel"]),
        "reparations_jour": _safe_int(row["reparations_jour"]),
        "reparations_mois": rep_mois,
        "ticket_moyen": ticket_moyen,
    }


# Keep old /stats endpoint for backward compat
@router.get("/stats")
async def get_stats_legacy(period: Optional[str] = Query(None, regex="^(7d|30d|90d|12m)$")):
    return await get_stats_overview()


# ============================================================
# 3. RÉPARATIONS PAR TECHNICIEN PAR JOUR (stacked bar)
# ============================================================
@router.get("/stats/reparations-par-tech")
async def get_reparations_par_tech(
    days: int = Query(7, ge=7, le=90),
):
    """
    Réparations par technicien par jour pour barres empilées.
    Retourne [{ jour: "05/02", tech1: 3, tech2: 2 }, ...]
    + liste des techniciens avec couleurs.
    """
    date_start = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    with get_cursor() as cur:
        # Get repairs per tech per day
        cur.execute("""
            SELECT
                date_cloture::date AS jour,
                COALESCE(technicien_assigne, 'Non assigné') AS tech,
                COUNT(*) AS count
            FROM tickets
            WHERE date_cloture IS NOT NULL
              AND date_cloture::date >= %(start)s::date
              AND technicien_assigne IS NOT NULL
              AND technicien_assigne != ''
            GROUP BY date_cloture::date, technicien_assigne
            ORDER BY jour
        """, {"start": date_start})
        rows = cur.fetchall()

        # Get team colors
        cur.execute("SELECT nom, couleur FROM equipe WHERE actif = true")
        team_colors = {r["nom"]: r["couleur"] for r in cur.fetchall()}

    # Build pivot data
    techs = set()
    day_data = {}
    for r in rows:
        jour_str = r["jour"].strftime("%d/%m")
        tech = r["tech"]
        techs.add(tech)
        if jour_str not in day_data:
            day_data[jour_str] = {"jour": jour_str}
        day_data[jour_str][tech] = r["count"]

    # Fill all days in range (no gaps)
    result = []
    current = datetime.now() - timedelta(days=days)
    end = datetime.now()
    while current.date() <= end.date():
        jour_str = current.strftime("%d/%m")
        entry = day_data.get(jour_str, {"jour": jour_str})
        for t in techs:
            if t not in entry:
                entry[t] = 0
        result.append(entry)
        current += timedelta(days=1)

    tech_list = [
        {"nom": t, "couleur": team_colors.get(t, "#94A3B8")}
        for t in sorted(techs)
    ]

    return {"data": result, "techniciens": tech_list}


# ============================================================
# 4. AFFLUENCE PAR HEURE (moyenne)
# ============================================================
@router.get("/stats/affluence-heure")
async def get_affluence_heure():
    """
    Nombre moyen de dépôts par heure (sur les 30 derniers jours).
    """
    date_start = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")

    with get_cursor() as cur:
        # Count distinct days in period
        cur.execute("""
            SELECT COUNT(DISTINCT date_depot::date) AS nb_jours
            FROM tickets
            WHERE date_depot IS NOT NULL
              AND date_depot::date >= %(start)s::date
        """, {"start": date_start})
        nb_jours = max(cur.fetchone()["nb_jours"], 1)

        # Count per hour
        cur.execute("""
            SELECT EXTRACT(HOUR FROM date_depot)::int AS heure, COUNT(*) AS count
            FROM tickets
            WHERE date_depot IS NOT NULL
              AND date_depot::date >= %(start)s::date
              AND EXTRACT(HOUR FROM date_depot) BETWEEN 8 AND 19
            GROUP BY EXTRACT(HOUR FROM date_depot)
            ORDER BY heure
        """, {"start": date_start})
        raw = {r["heure"]: r["count"] for r in cur.fetchall()}

    result = []
    for h in range(8, 20):
        total = raw.get(h, 0)
        moyenne = round(total / nb_jours, 1)
        result.append({
            "heure": f"{h}h",
            "total": total,
            "moyenne": moyenne,
        })

    return result


# ============================================================
# 5. AFFLUENCE PAR JOUR DE LA SEMAINE (moyenne)
# ============================================================
JOURS_SEMAINE = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]


@router.get("/stats/affluence-jour")
async def get_affluence_jour():
    """
    Nombre moyen de dépôts par jour de la semaine (sur les 3 derniers mois).
    """
    date_start = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")

    with get_cursor() as cur:
        # Count weeks in period per day of week
        cur.execute("""
            SELECT
                EXTRACT(ISODOW FROM date_depot)::int AS dow,
                COUNT(*) AS total,
                COUNT(DISTINCT date_depot::date) AS nb_jours_distincts
            FROM tickets
            WHERE date_depot IS NOT NULL
              AND date_depot::date >= %(start)s::date
            GROUP BY EXTRACT(ISODOW FROM date_depot)
            ORDER BY dow
        """, {"start": date_start})
        raw = {}
        for r in cur.fetchall():
            # Calculate number of that weekday in the period
            nb_weeks = max(90 // 7, 1)
            raw[r["dow"]] = {
                "total": r["total"],
                "moyenne": round(r["total"] / nb_weeks, 1),
            }

    result = []
    for i in range(7):
        dow = i + 1  # 1=Lundi
        data = raw.get(dow, {"total": 0, "moyenne": 0})
        result.append({
            "jour": JOURS_SEMAINE[i],
            "total": data["total"],
            "moyenne": data["moyenne"],
        })

    return result


# ============================================================
# 6. RÉPARTITION PAR MARQUE (top 8 + Autres)
# ============================================================
@router.get("/stats/repartition-marques")
async def get_repartition_marques():
    """Top 8 marques + Autres avec pourcentages."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT COALESCE(NULLIF(TRIM(marque), ''), 'Inconnu') AS marque,
                   COUNT(*) AS count
            FROM tickets
            GROUP BY COALESCE(NULLIF(TRIM(marque), ''), 'Inconnu')
            ORDER BY count DESC
        """)
        rows = cur.fetchall()

    total = sum(r["count"] for r in rows)
    if total == 0:
        return []

    result = []
    autres_count = 0
    for i, r in enumerate(rows):
        if i < 8:
            result.append({
                "marque": r["marque"],
                "count": r["count"],
                "pct": round(r["count"] / total * 100, 1),
            })
        else:
            autres_count += r["count"]

    if autres_count > 0:
        result.append({
            "marque": "Autres",
            "count": autres_count,
            "pct": round(autres_count / total * 100, 1),
        })

    return result


# ============================================================
# 7. RÉPARTITION PAR TYPE DE PANNE (top 10)
# ============================================================
@router.get("/stats/repartition-pannes")
async def get_repartition_pannes():
    """Top 10 types de panne les plus fréquents."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT COALESCE(NULLIF(TRIM(panne), ''), 'Non renseigné') AS panne,
                   COUNT(*) AS count
            FROM tickets
            GROUP BY COALESCE(NULLIF(TRIM(panne), ''), 'Non renseigné')
            ORDER BY count DESC
            LIMIT 10
        """)
        rows = cur.fetchall()

    return [{"panne": r["panne"], "count": r["count"]} for r in rows]


# ============================================================
# 8. ÉVOLUTION CA (2 courbes : encaissé + potentiel)
# ============================================================
@router.get("/stats/evolution-ca")
async def get_evolution_ca():
    """
    Évolution mensuelle sur 12 mois :
    - ca_encaisse : tickets payés clôturés
    - ca_potentiel : devis estimés des tickets en cours
    """
    with get_cursor() as cur:
        # CA encaissé par mois
        cur.execute("""
            SELECT
                TO_CHAR(DATE_TRUNC('month', date_cloture::timestamp), 'YYYY-MM') AS mois,
                COALESCE(SUM(tarif_final), 0) AS ca_encaisse
            FROM tickets
            WHERE date_cloture IS NOT NULL
              AND paye = 1
              AND date_cloture::timestamp >= NOW() - INTERVAL '12 months'
            GROUP BY DATE_TRUNC('month', date_cloture::timestamp)
            ORDER BY DATE_TRUNC('month', date_cloture::timestamp)
        """)
        encaisse_raw = {r["mois"]: _safe_float(r["ca_encaisse"]) for r in cur.fetchall()}

        # CA potentiel par mois (devis des tickets créés ce mois, non clôturés)
        cur.execute("""
            SELECT
                TO_CHAR(DATE_TRUNC('month', date_depot::timestamp), 'YYYY-MM') AS mois,
                COALESCE(SUM(devis_estime), 0) AS ca_potentiel
            FROM tickets
            WHERE date_depot IS NOT NULL
              AND date_depot::timestamp >= NOW() - INTERVAL '12 months'
              AND devis_estime IS NOT NULL AND devis_estime > 0
            GROUP BY DATE_TRUNC('month', date_depot::timestamp)
            ORDER BY DATE_TRUNC('month', date_depot::timestamp)
        """)
        potentiel_raw = {r["mois"]: _safe_float(r["ca_potentiel"]) for r in cur.fetchall()}

    # Build 12 months
    MOIS_NOMS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin",
                 "Juil", "Août", "Sep", "Oct", "Nov", "Déc"]
    result = []
    now = datetime.now()
    for i in range(11, -1, -1):
        dt = now - timedelta(days=i * 30)
        key = dt.strftime("%Y-%m")
        label = MOIS_NOMS[dt.month - 1]
        result.append({
            "mois": label,
            "mois_key": key,
            "ca_encaisse": encaisse_raw.get(key, 0),
            "ca_potentiel": potentiel_raw.get(key, 0),
        })

    return result


# ============================================================
# 9. TEMPS MOYEN DE RÉPARATION PAR PANNE
# ============================================================
@router.get("/stats/temps-reparation")
async def get_temps_reparation():
    """
    Temps moyen entre dépôt et clôture par type de panne.
    Trié du plus rapide au plus lent.
    """
    with get_cursor() as cur:
        cur.execute("""
            SELECT
                COALESCE(NULLIF(TRIM(panne), ''), 'Non renseigné') AS panne,
                COUNT(*) AS nb,
                ROUND(AVG(
                    EXTRACT(EPOCH FROM (date_cloture::timestamp - date_depot::timestamp)) / 3600
                )::numeric, 1) AS temps_moyen_heures
            FROM tickets
            WHERE date_cloture IS NOT NULL
              AND date_depot IS NOT NULL
              AND panne IS NOT NULL AND TRIM(panne) != ''
            GROUP BY COALESCE(NULLIF(TRIM(panne), ''), 'Non renseigné')
            HAVING COUNT(*) >= 2
            ORDER BY temps_moyen_heures ASC
            LIMIT 15
        """)
        rows = cur.fetchall()

    return [
        {
            "panne": r["panne"],
            "nb": r["nb"],
            "temps_moyen_heures": _safe_float(r["temps_moyen_heures"]),
        }
        for r in rows
    ]


# ============================================================
# 10. TAUX DE CONVERSION DEVIS
# ============================================================
@router.get("/stats/taux-conversion")
async def get_taux_conversion():
    """
    Taux de conversion : devis envoyés vs acceptés.
    - Envoyés : tickets passés par le statut 'En attente d'accord client'
    - Acceptés : tickets passés ensuite en 'En cours de réparation' ou plus loin
    """
    with get_cursor() as cur:
        # Tickets who have been in "En attente d'accord client" status
        cur.execute("""
            SELECT COUNT(*) AS devis_envoyes
            FROM tickets
            WHERE statut IN (
                'En attente d''accord client',
                'En cours de réparation',
                'Réparation terminée',
                'Rendu au client',
                'Clôturé'
            )
            AND devis_estime IS NOT NULL AND devis_estime > 0
        """)
        devis_envoyes = cur.fetchone()["devis_envoyes"]

        # Tickets accepted (went past 'En attente d'accord client')
        cur.execute("""
            SELECT COUNT(*) AS devis_acceptes
            FROM tickets
            WHERE statut IN (
                'En cours de réparation',
                'Réparation terminée',
                'Rendu au client',
                'Clôturé'
            )
            AND devis_estime IS NOT NULL AND devis_estime > 0
        """)
        devis_acceptes = cur.fetchone()["devis_acceptes"]

    devis_envoyes = _safe_int(devis_envoyes)
    devis_acceptes = _safe_int(devis_acceptes)
    taux = round(devis_acceptes / devis_envoyes * 100, 1) if devis_envoyes > 0 else 0

    return {
        "devis_envoyes": devis_envoyes,
        "devis_acceptes": devis_acceptes,
        "taux": taux,
    }


# ============================================================
# 11. TOP CLIENTS
# ============================================================
@router.get("/stats/top-clients")
async def get_top_clients():
    """Top 10 clients par nombre de réparations + CA total."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT
                COALESCE(c.nom, t.nom_client, 'Inconnu') AS nom,
                COALESCE(c.telephone, t.telephone, '') AS tel,
                COUNT(*) AS nb_reparations,
                COALESCE(SUM(t.tarif_final) FILTER (WHERE t.paye = 1), 0) AS ca_total
            FROM tickets t
            LEFT JOIN clients c ON t.client_id = c.id
            GROUP BY COALESCE(c.nom, t.nom_client, 'Inconnu'),
                     COALESCE(c.telephone, t.telephone, '')
            HAVING COUNT(*) >= 2
            ORDER BY nb_reparations DESC, ca_total DESC
            LIMIT 10
        """)
        rows = cur.fetchall()

    return [
        {
            "nom": r["nom"],
            "tel": r["tel"],
            "nb_reparations": r["nb_reparations"],
            "ca_total": _safe_float(r["ca_total"]),
        }
        for r in rows
    ]


# ============================================================
# LEGACY ENDPOINTS (keep backward compat)
# ============================================================
@router.get("/reparations")
async def get_reparations_legacy(
    period: str = Query("30d", regex="^(7d|30d|90d|12m)$"),
    marque: Optional[str] = None,
    tech: Optional[str] = None,
):
    """Legacy: données de réparations pour les graphiques."""
    days = {"7d": 7, "30d": 30, "90d": 90, "12m": 365}.get(period, 30)
    date_start = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    extra_conditions = ""
    params: dict = {"date_start": date_start}
    if marque:
        extra_conditions += " AND marque = %(marque)s"
        params["marque"] = marque
    if tech:
        extra_conditions += " AND technicien_assigne = %(tech)s"
        params["tech"] = tech

    with get_cursor() as cur:
        cur.execute(f"""
            SELECT date_cloture::date AS date, COUNT(*) AS count
            FROM tickets
            WHERE date_cloture IS NOT NULL
              AND date_cloture::date >= %(date_start)s::date
              {extra_conditions}
            GROUP BY date_cloture::date
            ORDER BY date_cloture::date
        """, params)
        par_jour = [{"date": r["date"].strftime("%Y-%m-%d"), "count": r["count"]} for r in cur.fetchall()]

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
        par_mois = [{"mois": r["mois"], "count": r["count"]} for r in cur.fetchall()]

        cur.execute(f"""
            SELECT COALESCE(marque, 'Inconnu') AS marque, COUNT(*) AS count
            FROM tickets
            WHERE date_cloture IS NOT NULL AND date_cloture::date >= %(date_start)s::date
              {extra_conditions}
            GROUP BY marque ORDER BY count DESC
        """, params)
        par_marque = [{"marque": r["marque"], "count": r["count"]} for r in cur.fetchall()]

        cur.execute(f"""
            SELECT COALESCE(technicien_assigne, 'Non assigné') AS technicien, COUNT(*) AS count
            FROM tickets
            WHERE date_cloture IS NOT NULL AND date_cloture::date >= %(date_start)s::date
              {extra_conditions}
            GROUP BY technicien_assigne ORDER BY count DESC
        """, params)
        par_technicien = [{"technicien": r["technicien"], "count": r["count"]} for r in cur.fetchall()]

        cur.execute(f"""
            SELECT COALESCE(panne, 'Non renseigné') AS panne, COUNT(*) AS count
            FROM tickets
            WHERE date_cloture IS NOT NULL AND date_cloture::date >= %(date_start)s::date
              {extra_conditions}
            GROUP BY panne ORDER BY count DESC LIMIT 20
        """, params)
        par_panne = [{"panne": r["panne"], "count": r["count"]} for r in cur.fetchall()]

    return {
        "par_jour": par_jour,
        "par_mois": par_mois,
        "par_marque": par_marque,
        "par_technicien": par_technicien,
        "par_panne": par_panne,
    }


@router.get("/flux-clients")
async def get_flux_clients_legacy():
    """Legacy: flux de dépôts clients."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT EXTRACT(HOUR FROM date_depot)::int AS heure, COUNT(*) AS count
            FROM tickets WHERE date_depot IS NOT NULL AND EXTRACT(HOUR FROM date_depot) BETWEEN 8 AND 20
            GROUP BY EXTRACT(HOUR FROM date_depot) ORDER BY heure
        """)
        par_heure_raw = {r["heure"]: r["count"] for r in cur.fetchall()}
        par_heure = [{"heure": h, "count": par_heure_raw.get(h, 0)} for h in range(8, 21)]

        cur.execute("""
            SELECT EXTRACT(ISODOW FROM date_depot)::int AS jour_num, COUNT(*) AS count
            FROM tickets WHERE date_depot IS NOT NULL
            GROUP BY EXTRACT(ISODOW FROM date_depot) ORDER BY jour_num
        """)
        par_jour_raw = {r["jour_num"]: r["count"] for r in cur.fetchall()}
        jours = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]
        par_jour_semaine = [{"jour": jours[i], "count": par_jour_raw.get(i + 1, 0)} for i in range(7)]

        cur.execute("""
            SELECT (EXTRACT(ISODOW FROM date_depot)::int - 1) AS jour,
                   EXTRACT(HOUR FROM date_depot)::int AS heure, COUNT(*) AS count
            FROM tickets WHERE date_depot IS NOT NULL AND EXTRACT(HOUR FROM date_depot) BETWEEN 8 AND 20
            GROUP BY EXTRACT(ISODOW FROM date_depot), EXTRACT(HOUR FROM date_depot) ORDER BY jour, heure
        """)
        heatmap_raw = {(r["jour"], r["heure"]): r["count"] for r in cur.fetchall()}
        heatmap = [{"jour": j, "heure": h, "count": heatmap_raw.get((j, h), 0)} for j in range(7) for h in range(8, 21)]

    return {"par_heure": par_heure, "par_jour_semaine": par_jour_semaine, "heatmap": heatmap}


@router.get("/performance-tech")
async def get_performance_tech():
    """Legacy: performance par technicien."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT
                COALESCE(technicien_assigne, 'Non assigné') AS technicien,
                COUNT(*) AS reparations,
                COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (date_cloture::timestamp - date_depot::timestamp)) / 60)), 0)::int AS temps_moyen_minutes,
                COALESCE(SUM(tarif_final) FILTER (WHERE paye = 1), 0) AS ca_genere
            FROM tickets
            WHERE date_cloture IS NOT NULL AND technicien_assigne IS NOT NULL AND technicien_assigne != ''
            GROUP BY technicien_assigne ORDER BY reparations DESC
        """)
        rows = cur.fetchall()

    return [
        {
            "technicien": r["technicien"],
            "reparations": r["reparations"],
            "temps_moyen_minutes": _safe_int(r["temps_moyen_minutes"]),
            "ca_genere": _safe_float(r["ca_genere"]),
        }
        for r in rows
    ]


@router.get("/evolution")
async def get_evolution_legacy(
    metric: str = Query("ca", regex="^(ca|flux)$"),
    period: str = Query("12m", regex="^(6m|12m)$"),
):
    """Legacy: courbes d'évolution mensuelles."""
    months = {"6m": 6, "12m": 12}.get(period, 12)
    with get_cursor() as cur:
        if metric == "ca":
            cur.execute("""
                SELECT TO_CHAR(DATE_TRUNC('month', date_cloture::timestamp), 'YYYY-MM') AS date,
                       COALESCE(SUM(tarif_final), 0) AS value
                FROM tickets WHERE date_cloture IS NOT NULL AND paye = 1
                  AND date_cloture::timestamp >= NOW() - (%(months)s || ' months')::INTERVAL
                GROUP BY DATE_TRUNC('month', date_cloture::timestamp)
                ORDER BY DATE_TRUNC('month', date_cloture::timestamp)
            """, {"months": months})
        else:
            cur.execute("""
                SELECT TO_CHAR(DATE_TRUNC('month', date_depot::timestamp), 'YYYY-MM') AS date,
                       COUNT(*) AS value
                FROM tickets WHERE date_depot IS NOT NULL
                  AND date_depot::timestamp >= NOW() - (%(months)s || ' months')::INTERVAL
                GROUP BY DATE_TRUNC('month', date_depot::timestamp)
                ORDER BY DATE_TRUNC('month', date_depot::timestamp)
            """, {"months": months})
        rows = cur.fetchall()

    data = []
    for r in rows:
        val = r["value"]
        val = round(float(val), 2) if metric == "ca" and val else (int(val) if val else 0)
        data.append({"date": r["date"], "value": val})

    return {"data": data}
