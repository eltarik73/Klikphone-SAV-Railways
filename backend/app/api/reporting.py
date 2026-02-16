"""
API Reporting — Endpoint unique pour le tableau de bord analytique Klikphone SAV.
GET /api/reporting?debut=YYYY-MM-DD&fin=YYYY-MM-DD&granularite=heure|jour|mois
Retourne toutes les donnees de reporting en un seul appel.
"""

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query

from ..database import get_cursor
from .auth import get_current_user

router = APIRouter(prefix="/api/reporting", tags=["reporting"])


def _sf(val):
    """Safe float."""
    try:
        return round(float(val), 2) if val else 0.0
    except (TypeError, ValueError):
        return 0.0


def _si(val):
    """Safe int."""
    try:
        return int(val) if val else 0
    except (TypeError, ValueError):
        return 0


def _pct_change(current, previous):
    """Calculate percentage change between current and previous period."""
    if previous == 0:
        return 100.0 if current > 0 else 0.0
    return round((current - previous) / previous * 100, 1)


def _compute_previous_period(debut, fin):
    """Compute the previous period of equal length for trend comparison."""
    d1 = datetime.strptime(debut, "%Y-%m-%d")
    d2 = datetime.strptime(fin, "%Y-%m-%d")
    delta = (d2 - d1).days + 1
    prev_fin = d1 - timedelta(days=1)
    prev_debut = prev_fin - timedelta(days=delta - 1)
    return prev_debut.strftime("%Y-%m-%d"), prev_fin.strftime("%Y-%m-%d")


# ============================================================
# MAIN ENDPOINT
# ============================================================
@router.get("")
async def get_reporting(
    debut: Optional[str] = Query(None),
    fin: Optional[str] = Query(None),
    granularite: Optional[str] = Query("jour"),
    user: dict = Depends(get_current_user),
):
    """
    Endpoint unique de reporting.
    Retourne: kpis, affluence, performance_accueil, performance_techniciens,
              top_pannes, top_modeles.
    """
    today = datetime.now().strftime("%Y-%m-%d")
    if not debut:
        debut = datetime.now().strftime("%Y-%m-01")
    if not fin:
        fin = today

    prev_debut, prev_fin = _compute_previous_period(debut, fin)

    with get_cursor() as cur:
        # ═══ 1. KPIs ═══
        kpis = _compute_kpis(cur, debut, fin, prev_debut, prev_fin)

        # ═══ 2. Affluence chart ═══
        affluence = _compute_affluence(cur, debut, fin, granularite)

        # ═══ 3. Performance Accueil ═══
        perf_accueil = _compute_perf_accueil(cur, debut, fin)

        # ═══ 4. Performance Techniciens ═══
        perf_tech = _compute_perf_techniciens(cur, debut, fin)

        # ═══ 5. Top Pannes ═══
        top_pannes = _compute_top_pannes(cur, debut, fin)

        # ═══ 6. Top Modeles ═══
        top_modeles = _compute_top_modeles(cur, debut, fin)

    # ═══ 7. Retours SAV ═══
    retours_sav = _compute_retours_sav(cur, debut, fin)

    return {
        "kpis": kpis,
        "affluence": affluence,
        "performance_accueil": perf_accueil,
        "performance_techniciens": perf_tech,
        "top_pannes": top_pannes,
        "top_modeles": top_modeles,
        "retours_sav": retours_sav,
        "periode": {"debut": debut, "fin": fin, "granularite": granularite},
    }


# ============================================================
# KPIs avec tendance
# ============================================================
def _compute_kpis(cur, debut, fin, prev_debut, prev_fin):
    """8 KPI cards with trend comparison vs previous period."""

    # Current period stats
    cur.execute("""
        SELECT
            COUNT(*) FILTER (
                WHERE statut NOT IN ('Clôturé', 'Rendu au client')
            ) AS tickets_ouverts,

            COUNT(*) FILTER (
                WHERE date_depot::date >= %(debut)s::date
                  AND date_depot::date <= %(fin)s::date
            ) AS tickets_periode,

            COUNT(*) FILTER (
                WHERE date_cloture IS NOT NULL
                  AND date_cloture::date >= %(debut)s::date
                  AND date_cloture::date <= %(fin)s::date
            ) AS clotures_periode,

            COALESCE(SUM(tarif_final) FILTER (
                WHERE paye = 1
                  AND date_cloture IS NOT NULL
                  AND date_cloture::date >= %(debut)s::date
                  AND date_cloture::date <= %(fin)s::date
            ), 0) AS ca_encaisse,

            COUNT(*) FILTER (
                WHERE paye = 1
                  AND date_cloture IS NOT NULL
                  AND date_cloture::date >= %(debut)s::date
                  AND date_cloture::date <= %(fin)s::date
                  AND tarif_final > 0
            ) AS nb_payes
        FROM tickets
    """, {"debut": debut, "fin": fin})
    row = cur.fetchone()

    tickets_ouverts = _si(row["tickets_ouverts"])
    tickets_periode = _si(row["tickets_periode"])
    clotures_periode = _si(row["clotures_periode"])
    ca_encaisse = _sf(row["ca_encaisse"])
    nb_payes = _si(row["nb_payes"])
    ca_moyen = round(ca_encaisse / nb_payes, 2) if nb_payes > 0 else 0.0

    # Temps moyen de reparation (current period)
    cur.execute("""
        SELECT COALESCE(
            ROUND(AVG(
                EXTRACT(EPOCH FROM (date_cloture::timestamp - date_depot::timestamp)) / 3600
            )::numeric, 1),
            0
        ) AS temps_moyen_h
        FROM tickets
        WHERE date_cloture IS NOT NULL
          AND date_depot IS NOT NULL
          AND date_cloture::date >= %(debut)s::date
          AND date_cloture::date <= %(fin)s::date
          AND EXTRACT(EPOCH FROM (date_cloture::timestamp - date_depot::timestamp)) > 0
    """, {"debut": debut, "fin": fin})
    temps_moyen_h = _sf(cur.fetchone()["temps_moyen_h"])

    # Taux de conversion devis (current period)
    cur.execute("""
        SELECT
            COUNT(*) FILTER (
                WHERE statut IN ('En attente d''accord client', 'En cours de réparation',
                    'Réparation terminée', 'Rendu au client', 'Clôturé')
                AND devis_estime IS NOT NULL AND devis_estime > 0
                AND date_depot::date >= %(debut)s::date
                AND date_depot::date <= %(fin)s::date
            ) AS devis_envoyes,
            COUNT(*) FILTER (
                WHERE statut IN ('En cours de réparation', 'Réparation terminée',
                    'Rendu au client', 'Clôturé')
                AND devis_estime IS NOT NULL AND devis_estime > 0
                AND date_depot::date >= %(debut)s::date
                AND date_depot::date <= %(fin)s::date
            ) AS devis_acceptes
        FROM tickets
    """, {"debut": debut, "fin": fin})
    conv_row = cur.fetchone()
    devis_envoyes = _si(conv_row["devis_envoyes"])
    devis_acceptes = _si(conv_row["devis_acceptes"])
    taux_conversion = round(devis_acceptes / devis_envoyes * 100, 1) if devis_envoyes > 0 else 0.0

    # Nouveaux clients (current period)
    cur.execute("""
        SELECT COUNT(*) AS nb
        FROM clients
        WHERE date_creation::date >= %(debut)s::date
          AND date_creation::date <= %(fin)s::date
    """, {"debut": debut, "fin": fin})
    nouveaux_clients = _si(cur.fetchone()["nb"])

    # ──── Previous period stats for trends ────
    cur.execute("""
        SELECT
            COUNT(*) FILTER (
                WHERE date_depot::date >= %(debut)s::date
                  AND date_depot::date <= %(fin)s::date
            ) AS tickets_periode,

            COUNT(*) FILTER (
                WHERE date_cloture IS NOT NULL
                  AND date_cloture::date >= %(debut)s::date
                  AND date_cloture::date <= %(fin)s::date
            ) AS clotures_periode,

            COALESCE(SUM(tarif_final) FILTER (
                WHERE paye = 1
                  AND date_cloture IS NOT NULL
                  AND date_cloture::date >= %(debut)s::date
                  AND date_cloture::date <= %(fin)s::date
            ), 0) AS ca_encaisse,

            COUNT(*) FILTER (
                WHERE paye = 1
                  AND date_cloture IS NOT NULL
                  AND date_cloture::date >= %(debut)s::date
                  AND date_cloture::date <= %(fin)s::date
                  AND tarif_final > 0
            ) AS nb_payes
        FROM tickets
    """, {"debut": prev_debut, "fin": prev_fin})
    prev = cur.fetchone()

    prev_tickets = _si(prev["tickets_periode"])
    prev_clotures = _si(prev["clotures_periode"])
    prev_ca = _sf(prev["ca_encaisse"])
    prev_nb_payes = _si(prev["nb_payes"])
    prev_ca_moyen = round(prev_ca / prev_nb_payes, 2) if prev_nb_payes > 0 else 0.0

    cur.execute("""
        SELECT COALESCE(
            ROUND(AVG(
                EXTRACT(EPOCH FROM (date_cloture::timestamp - date_depot::timestamp)) / 3600
            )::numeric, 1),
            0
        ) AS temps_moyen_h
        FROM tickets
        WHERE date_cloture IS NOT NULL AND date_depot IS NOT NULL
          AND date_cloture::date >= %(debut)s::date AND date_cloture::date <= %(fin)s::date
          AND EXTRACT(EPOCH FROM (date_cloture::timestamp - date_depot::timestamp)) > 0
    """, {"debut": prev_debut, "fin": prev_fin})
    prev_temps = _sf(cur.fetchone()["temps_moyen_h"])

    cur.execute("""
        SELECT
            COUNT(*) FILTER (
                WHERE statut IN ('En attente d''accord client', 'En cours de réparation',
                    'Réparation terminée', 'Rendu au client', 'Clôturé')
                AND devis_estime IS NOT NULL AND devis_estime > 0
                AND date_depot::date >= %(debut)s::date AND date_depot::date <= %(fin)s::date
            ) AS de,
            COUNT(*) FILTER (
                WHERE statut IN ('En cours de réparation', 'Réparation terminée',
                    'Rendu au client', 'Clôturé')
                AND devis_estime IS NOT NULL AND devis_estime > 0
                AND date_depot::date >= %(debut)s::date AND date_depot::date <= %(fin)s::date
            ) AS da
        FROM tickets
    """, {"debut": prev_debut, "fin": prev_fin})
    pc = cur.fetchone()
    prev_taux = round(_si(pc["da"]) / _si(pc["de"]) * 100, 1) if _si(pc["de"]) > 0 else 0.0

    cur.execute("""
        SELECT COUNT(*) AS nb FROM clients
        WHERE date_creation::date >= %(debut)s::date AND date_creation::date <= %(fin)s::date
    """, {"debut": prev_debut, "fin": prev_fin})
    prev_clients = _si(cur.fetchone()["nb"])

    return [
        {
            "id": "tickets_ouverts",
            "label": "Tickets ouverts",
            "value": tickets_ouverts,
            "format": "number",
            "trend": None,  # No trend for absolute count
            "color": "violet",
        },
        {
            "id": "tickets_periode",
            "label": "Tickets reçus",
            "value": tickets_periode,
            "format": "number",
            "trend": _pct_change(tickets_periode, prev_tickets),
            "color": "blue",
        },
        {
            "id": "clotures",
            "label": "Clôturés",
            "value": clotures_periode,
            "format": "number",
            "trend": _pct_change(clotures_periode, prev_clotures),
            "color": "emerald",
        },
        {
            "id": "ca_encaisse",
            "label": "CA encaissé",
            "value": ca_encaisse,
            "format": "euro",
            "trend": _pct_change(ca_encaisse, prev_ca),
            "color": "emerald",
        },
        {
            "id": "ca_moyen",
            "label": "Ticket moyen",
            "value": ca_moyen,
            "format": "euro",
            "trend": _pct_change(ca_moyen, prev_ca_moyen),
            "color": "amber",
        },
        {
            "id": "temps_moyen",
            "label": "Temps moyen répar.",
            "value": temps_moyen_h,
            "format": "heures",
            "trend": _pct_change(temps_moyen_h, prev_temps) * -1 if prev_temps else None,
            "color": "cyan",
        },
        {
            "id": "taux_conversion",
            "label": "Taux conversion",
            "value": taux_conversion,
            "format": "pct",
            "trend": _pct_change(taux_conversion, prev_taux),
            "color": "pink",
        },
        {
            "id": "nouveaux_clients",
            "label": "Nouveaux clients",
            "value": nouveaux_clients,
            "format": "number",
            "trend": _pct_change(nouveaux_clients, prev_clients),
            "color": "indigo",
        },
    ]


# ============================================================
# Affluence chart
# ============================================================
def _compute_affluence(cur, debut, fin, granularite):
    """Affluence chart data: tickets + clients created over time."""

    if granularite == "heure":
        # Group by hour (for today/yesterday)
        cur.execute("""
            SELECT EXTRACT(HOUR FROM date_depot)::int AS label,
                   COUNT(*) AS tickets
            FROM tickets
            WHERE date_depot IS NOT NULL
              AND date_depot::date >= %(debut)s::date
              AND date_depot::date <= %(fin)s::date
              AND EXTRACT(HOUR FROM date_depot) BETWEEN 8 AND 19
            GROUP BY EXTRACT(HOUR FROM date_depot)
            ORDER BY label
        """, {"debut": debut, "fin": fin})
        tickets_raw = {r["label"]: r["tickets"] for r in cur.fetchall()}

        cur.execute("""
            SELECT EXTRACT(HOUR FROM date_creation)::int AS label,
                   COUNT(*) AS clients
            FROM clients
            WHERE date_creation IS NOT NULL
              AND date_creation::date >= %(debut)s::date
              AND date_creation::date <= %(fin)s::date
              AND EXTRACT(HOUR FROM date_creation) BETWEEN 8 AND 19
            GROUP BY EXTRACT(HOUR FROM date_creation)
            ORDER BY label
        """, {"debut": debut, "fin": fin})
        clients_raw = {r["label"]: r["clients"] for r in cur.fetchall()}

        data = []
        for h in range(8, 20):
            data.append({
                "label": f"{h}h",
                "tickets": tickets_raw.get(h, 0),
                "clients": clients_raw.get(h, 0),
            })
        return data

    elif granularite == "mois":
        # Group by month (for 12 months view)
        MOIS_NOMS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin",
                     "Juil", "Août", "Sep", "Oct", "Nov", "Déc"]

        cur.execute("""
            SELECT TO_CHAR(DATE_TRUNC('month', date_depot::timestamp), 'YYYY-MM') AS mois,
                   COUNT(*) AS tickets
            FROM tickets
            WHERE date_depot IS NOT NULL
              AND date_depot::date >= %(debut)s::date
              AND date_depot::date <= %(fin)s::date
            GROUP BY DATE_TRUNC('month', date_depot::timestamp)
            ORDER BY DATE_TRUNC('month', date_depot::timestamp)
        """, {"debut": debut, "fin": fin})
        tickets_raw = {r["mois"]: r["tickets"] for r in cur.fetchall()}

        cur.execute("""
            SELECT TO_CHAR(DATE_TRUNC('month', date_creation::timestamp), 'YYYY-MM') AS mois,
                   COUNT(*) AS clients
            FROM clients
            WHERE date_creation IS NOT NULL
              AND date_creation::date >= %(debut)s::date
              AND date_creation::date <= %(fin)s::date
            GROUP BY DATE_TRUNC('month', date_creation::timestamp)
            ORDER BY DATE_TRUNC('month', date_creation::timestamp)
        """, {"debut": debut, "fin": fin})
        clients_raw = {r["mois"]: r["clients"] for r in cur.fetchall()}

        # Build all months in range
        data = []
        d = datetime.strptime(debut, "%Y-%m-%d")
        end = datetime.strptime(fin, "%Y-%m-%d")
        seen = set()
        while d <= end:
            key = d.strftime("%Y-%m")
            if key not in seen:
                seen.add(key)
                data.append({
                    "label": MOIS_NOMS[d.month - 1],
                    "tickets": tickets_raw.get(key, 0),
                    "clients": clients_raw.get(key, 0),
                })
            d += timedelta(days=28)
        # Ensure last month is included
        key = end.strftime("%Y-%m")
        if key not in seen:
            data.append({
                "label": MOIS_NOMS[end.month - 1],
                "tickets": tickets_raw.get(key, 0),
                "clients": clients_raw.get(key, 0),
            })
        return data

    else:
        # Group by day (default)
        cur.execute("""
            SELECT date_depot::date AS jour, COUNT(*) AS tickets
            FROM tickets
            WHERE date_depot IS NOT NULL
              AND date_depot::date >= %(debut)s::date
              AND date_depot::date <= %(fin)s::date
            GROUP BY date_depot::date
            ORDER BY jour
        """, {"debut": debut, "fin": fin})
        tickets_raw = {str(r["jour"]): r["tickets"] for r in cur.fetchall()}

        cur.execute("""
            SELECT date_creation::date AS jour, COUNT(*) AS clients
            FROM clients
            WHERE date_creation IS NOT NULL
              AND date_creation::date >= %(debut)s::date
              AND date_creation::date <= %(fin)s::date
            GROUP BY date_creation::date
            ORDER BY jour
        """, {"debut": debut, "fin": fin})
        clients_raw = {str(r["jour"]): r["clients"] for r in cur.fetchall()}

        # Build all days in range
        data = []
        d = datetime.strptime(debut, "%Y-%m-%d")
        end = datetime.strptime(fin, "%Y-%m-%d")
        while d <= end:
            key = d.strftime("%Y-%m-%d")
            data.append({
                "label": d.strftime("%d/%m"),
                "tickets": tickets_raw.get(key, 0),
                "clients": clients_raw.get(key, 0),
            })
            d += timedelta(days=1)
        return data


# ============================================================
# Performance Accueil
# ============================================================
def _compute_perf_accueil(cur, debut, fin):
    """Performance accueil: tickets registered per accueil user."""
    try:
        cur.execute("""
            SELECT
                COALESCE(NULLIF(TRIM(cree_par), ''), 'Inconnu') AS utilisateur,
                COUNT(*) AS tickets_enregistres,
                COUNT(DISTINCT client_id) FILTER (WHERE client_id IS NOT NULL) AS clients_uniques
            FROM tickets
            WHERE date_depot IS NOT NULL
              AND date_depot::date >= %(debut)s::date
              AND date_depot::date <= %(fin)s::date
              AND cree_par IS NOT NULL AND TRIM(cree_par) != ''
            GROUP BY COALESCE(NULLIF(TRIM(cree_par), ''), 'Inconnu')
            ORDER BY tickets_enregistres DESC
        """, {"debut": debut, "fin": fin})
        rows = cur.fetchall()
    except Exception:
        return []

    return [
        {
            "utilisateur": r["utilisateur"],
            "tickets_enregistres": _si(r["tickets_enregistres"]),
            "clients_uniques": _si(r["clients_uniques"]),
        }
        for r in rows
    ]


# ============================================================
# Performance Techniciens
# ============================================================
def _compute_perf_techniciens(cur, debut, fin):
    """Performance techniciens with ranking."""
    cur.execute("""
        SELECT
            COALESCE(technicien_assigne, 'Non assigné') AS technicien,
            COUNT(*) AS reparations,
            COALESCE(ROUND(AVG(
                EXTRACT(EPOCH FROM (date_cloture::timestamp - date_depot::timestamp)) / 3600
            )::numeric, 1), 0) AS temps_moyen_h,
            COALESCE(SUM(tarif_final) FILTER (WHERE paye = 1), 0) AS ca_genere,
            COUNT(*) FILTER (
                WHERE statut IN ('Réparation terminée', 'Rendu au client', 'Clôturé')
            ) AS terminees
        FROM tickets
        WHERE date_cloture IS NOT NULL
          AND date_cloture::date >= %(debut)s::date
          AND date_cloture::date <= %(fin)s::date
          AND technicien_assigne IS NOT NULL
          AND technicien_assigne != ''
        GROUP BY technicien_assigne
        ORDER BY reparations DESC
    """, {"debut": debut, "fin": fin})
    rows = cur.fetchall()

    # Get team colors
    try:
        cur.execute("SELECT nom, couleur FROM membres_equipe WHERE actif = 1")
        colors = {r["nom"]: r["couleur"] for r in cur.fetchall()}
    except Exception:
        colors = {}

    result = []
    for i, r in enumerate(rows):
        result.append({
            "rang": i + 1,
            "technicien": r["technicien"],
            "reparations": _si(r["reparations"]),
            "terminees": _si(r["terminees"]),
            "temps_moyen_h": _sf(r["temps_moyen_h"]),
            "ca_genere": _sf(r["ca_genere"]),
            "couleur": colors.get(r["technicien"], "#94A3B8"),
        })
    return result


# ============================================================
# Top Pannes
# ============================================================
def _compute_top_pannes(cur, debut, fin):
    """Top 10 pannes les plus frequentes."""
    cur.execute("""
        SELECT
            COALESCE(NULLIF(TRIM(panne), ''), 'Non renseigné') AS panne,
            COUNT(*) AS count
        FROM tickets
        WHERE date_depot IS NOT NULL
          AND date_depot::date >= %(debut)s::date
          AND date_depot::date <= %(fin)s::date
          AND panne IS NOT NULL AND TRIM(panne) != ''
        GROUP BY COALESCE(NULLIF(TRIM(panne), ''), 'Non renseigné')
        ORDER BY count DESC
        LIMIT 10
    """, {"debut": debut, "fin": fin})
    rows = cur.fetchall()

    total = sum(r["count"] for r in rows) if rows else 1
    return [
        {
            "label": r["panne"],
            "count": r["count"],
            "pct": round(r["count"] / total * 100, 1),
        }
        for r in rows
    ]


# ============================================================
# Top Modeles
# ============================================================
def _compute_top_modeles(cur, debut, fin):
    """Top 10 modeles les plus repares."""
    cur.execute("""
        SELECT
            COALESCE(NULLIF(TRIM(marque), ''), 'Inconnu') AS marque,
            COALESCE(NULLIF(TRIM(modele), ''), 'Inconnu') AS modele,
            COUNT(*) AS count
        FROM tickets
        WHERE date_depot IS NOT NULL
          AND date_depot::date >= %(debut)s::date
          AND date_depot::date <= %(fin)s::date
          AND modele IS NOT NULL AND TRIM(modele) != ''
        GROUP BY COALESCE(NULLIF(TRIM(marque), ''), 'Inconnu'),
                 COALESCE(NULLIF(TRIM(modele), ''), 'Inconnu')
        ORDER BY count DESC
        LIMIT 10
    """, {"debut": debut, "fin": fin})
    rows = cur.fetchall()

    total = sum(r["count"] for r in rows) if rows else 1
    return [
        {
            "marque": r["marque"],
            "modele": r["modele"],
            "label": f"{r['marque']} {r['modele']}",
            "count": r["count"],
            "pct": round(r["count"] / total * 100, 1),
        }
        for r in rows
    ]


# ============================================================
# Retours SAV
# ============================================================
def _compute_retours_sav(cur, debut, fin):
    """Retours SAV stats for the period."""
    try:
        cur.execute("""
            SELECT COUNT(*) AS total_retours
            FROM tickets
            WHERE est_retour_sav = true
              AND date_depot IS NOT NULL
              AND date_depot::date >= %(debut)s::date
              AND date_depot::date <= %(fin)s::date
        """, {"debut": debut, "fin": fin})
        total = _si(cur.fetchone()["total_retours"])

        # Per technicien
        cur.execute("""
            SELECT
                COALESCE(orig.technicien_assigne, 'Non assigné') AS technicien,
                COUNT(*) AS retours
            FROM tickets t
            JOIN tickets orig ON t.ticket_original_id = orig.id
            WHERE t.est_retour_sav = true
              AND t.date_depot IS NOT NULL
              AND t.date_depot::date >= %(debut)s::date
              AND t.date_depot::date <= %(fin)s::date
              AND orig.technicien_assigne IS NOT NULL
              AND orig.technicien_assigne != ''
            GROUP BY orig.technicien_assigne
            ORDER BY retours DESC
        """, {"debut": debut, "fin": fin})
        par_tech = [
            {"technicien": r["technicien"], "retours": _si(r["retours"])}
            for r in cur.fetchall()
        ]

        return {"total": total, "par_technicien": par_tech}
    except Exception:
        return {"total": 0, "par_technicien": []}
