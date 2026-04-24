"""API Tracking : clics sur liens publics (stats reporting admin).

Endpoints :
- POST /api/tracking/event  (public, rate-limite) : enregistre un event
- GET  /api/tracking/stats   (admin) : retourne compteurs par type / source

Pas d'analytics complexe, juste compter les clics sur les CTA publics
('Voir nos tarifs téléphones') pour que l'admin sache si le lien est utilisé.
"""

import hashlib
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.database import get_cursor
from app.api.auth import get_current_user
from app.api.tickets import _rate_limit_public_lookup


router = APIRouter(prefix="/api/tracking", tags=["tracking"])


class TrackEventRequest(BaseModel):
    event_type: str      # ex: "tarifs_click"
    source: Optional[str] = None  # ex: "home", "suivi", "ticket_detail"
    target: Optional[str] = None  # ex: "/site-tarifs-iphone"


def _hash_ip(ip: str) -> str:
    return hashlib.sha256(("kp:" + (ip or "")).encode("utf-8")).hexdigest()[:16]


@router.post("/event")
async def track_event(data: TrackEventRequest, request: Request):
    """Enregistre un event public (clic, view). Rate-limite 30/min/IP."""
    _rate_limit_public_lookup(request)

    event_type = (data.event_type or "").strip()[:60]
    if not event_type:
        raise HTTPException(400, "event_type requis")
    source = (data.source or "").strip()[:60] or None
    target = (data.target or "").strip()[:120] or None

    # IP anonymisee (hash, pas stockee en clair)
    ip = "unknown"
    if request.client:
        ip = request.client.host
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        ip = xff.split(",")[0].strip()
    ip_hash = _hash_ip(ip)

    with get_cursor() as cur:
        cur.execute(
            """INSERT INTO tracking_events (event_type, source, target, ip_hash)
               VALUES (%s, %s, %s, %s)""",
            (event_type, source, target, ip_hash),
        )
    return {"ok": True}


@router.get("/stats")
async def tracking_stats(
    event_type: Optional[str] = None,
    days: int = 30,
    user: dict = Depends(get_current_user),
):
    """Stats agregees des events. Par defaut retourne les 30 derniers jours
    pour 'tarifs_click' (clics sur le lien vers la vitrine tarifs)."""
    since = datetime.now() - timedelta(days=max(1, min(365, days)))
    evt = (event_type or "tarifs_click").strip()[:60]

    with get_cursor() as cur:
        # Total + uniques
        cur.execute(
            """SELECT COUNT(*) AS total,
                      COUNT(DISTINCT ip_hash) AS uniques
               FROM tracking_events
               WHERE event_type = %s AND created_at >= %s""",
            (evt, since),
        )
        row = cur.fetchone()
        total = row["total"] if row else 0
        uniques = row["uniques"] if row else 0

        # Par source
        cur.execute(
            """SELECT COALESCE(source, 'autre') AS source, COUNT(*) AS n
               FROM tracking_events
               WHERE event_type = %s AND created_at >= %s
               GROUP BY source
               ORDER BY n DESC""",
            (evt, since),
        )
        by_source = [dict(r) for r in cur.fetchall()]

        # Par jour (timeline)
        cur.execute(
            """SELECT DATE(created_at) AS day, COUNT(*) AS n
               FROM tracking_events
               WHERE event_type = %s AND created_at >= %s
               GROUP BY DATE(created_at)
               ORDER BY day ASC""",
            (evt, since),
        )
        timeline = []
        for r in cur.fetchall():
            d = r["day"]
            timeline.append({
                "day": d.isoformat() if hasattr(d, "isoformat") else str(d),
                "n": r["n"],
            })

        # Aujourd'hui
        cur.execute(
            """SELECT COUNT(*) AS n FROM tracking_events
               WHERE event_type = %s AND DATE(created_at) = CURRENT_DATE""",
            (evt,),
        )
        today = cur.fetchone()["n"]

    return {
        "event_type": evt,
        "period_days": days,
        "total": total,
        "today": today,
        "unique_visitors": uniques,
        "by_source": by_source,
        "timeline": timeline,
    }
