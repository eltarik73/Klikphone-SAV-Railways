"""
Centre de notifications in-app pour le staff Klikphone.

Architecture :
- Table `notifications_center` : journal persistant des événements importants
- Fonction `push_notification(...)` : helper importable depuis tout module
  → écrit dans `notifications_center` ET dans `chat_messages` (côté équipe)
- Endpoints REST : list / mark-read / unread-count

Pas d'auth obligatoire — le scoping se fait par paramètre `user` (cohérent avec chat.py).
"""

from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.database import get_cursor

router = APIRouter(prefix="/api/notifications-center", tags=["notifications-center"])


# ─── Init / Migration ─────────────────────────────────────

_TABLE_CHECKED = False


def _ensure_table():
    """Crée la table notifications_center si absente. Idempotent.
    Crée aussi le membre 'Système' dans membres_equipe pour que les messages
    auto soient visibles dans le ChatWidget (tab Privé)."""
    global _TABLE_CHECKED
    if _TABLE_CHECKED:
        return
    try:
        with get_cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS notifications_center (
                    id SERIAL PRIMARY KEY,
                    type TEXT NOT NULL,
                    title TEXT NOT NULL,
                    message TEXT NOT NULL,
                    important BOOLEAN DEFAULT FALSE,
                    target_user TEXT,
                    related_ticket_id INTEGER,
                    related_devis_id INTEGER,
                    action_url TEXT,
                    icon TEXT,
                    read_by TEXT DEFAULT '',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_notifc_created ON notifications_center(created_at DESC)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_notifc_target ON notifications_center(target_user)"
            )
            # S'assurer que le membre "Système" existe pour que les messages auto
            # apparaissent dans le ChatWidget (sinon le JOIN dans get_team_contacts
            # ne renvoie pas Système comme contact privé).
            try:
                cur.execute("SELECT 1 FROM membres_equipe WHERE nom = %s", ("Système",))
                if not cur.fetchone():
                    cur.execute(
                        "INSERT INTO membres_equipe (nom, role, couleur, actif) VALUES (%s, %s, %s, %s)",
                        ("Système", "Bot SAV", "#7C3AED", 1),
                    )
            except Exception as e:
                # Si la table membres_equipe n'existe pas encore ou autre, on continue
                print(f"[notifications_center] Système member create skipped: {e}")
        _TABLE_CHECKED = True
    except Exception as e:
        print(f"[notifications_center] _ensure_table warning: {e}")


# ─── Helper exporté (utilisable depuis devis.py, suivi.py, etc.) ──

def push_notification(
    type: str,
    title: str,
    message: str,
    important: bool = False,
    target_user: Optional[str] = None,
    related_ticket_id: Optional[int] = None,
    related_devis_id: Optional[int] = None,
    action_url: Optional[str] = None,
    icon: Optional[str] = None,
    also_chat: bool = True,
) -> Optional[int]:
    """
    Publie une notification dans le centre + (optionnel) un message auto dans le chat équipe.

    Args:
        type: identifiant type d'évènement (ex: 'devis_accepte', 'devis_refuse')
        title: titre court (toast + cloche)
        message: corps du message
        important: si True → déclenche un toast côté frontend (+ son)
        target_user: nom du membre destinataire ; None = tout le monde
        related_ticket_id: lien vers un ticket
        related_devis_id: lien vers un devis
        action_url: chemin SPA pour naviguer (ex: '/accueil/ticket/42')
        icon: emoji (ex: '✅')
        also_chat: si True, insère aussi un message dans chat_messages

    Returns:
        l'id de la notif créée, ou None si erreur silencieuse
    """
    _ensure_table()
    try:
        with get_cursor() as cur:
            cur.execute(
                """
                INSERT INTO notifications_center
                (type, title, message, important, target_user, related_ticket_id,
                 related_devis_id, action_url, icon)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (type, title, message, important, target_user, related_ticket_id,
                 related_devis_id, action_url, icon),
            )
            notif_id = cur.fetchone()["id"]
            print(f"[notifications_center] PUSHED notif #{notif_id} type={type!r} target_user={target_user!r} important={important}")

            # Mirror dans chat_messages → s'affichera dans le ChatWidget existant
            if also_chat:
                chat_msg = f"{icon or '🔔'} {title}\n{message}"
                if action_url:
                    chat_msg += f"\n→ {action_url}"
                recipient = target_user or "all"
                is_private = target_user is not None
                try:
                    cur.execute(
                        """
                        INSERT INTO chat_messages (sender, recipient, message, is_private)
                        VALUES (%s, %s, %s, %s)
                        """,
                        ("Système", recipient, chat_msg, is_private),
                    )
                    print(f"[notifications_center] chat mirrored to recipient={recipient!r} is_private={is_private}")
                except Exception as e:
                    print(f"[notifications_center] chat mirror failed: {e}")
                    import traceback
                    traceback.print_exc()

            return notif_id
    except Exception as e:
        print(f"[notifications_center] push_notification FAILED: {e}")
        import traceback
        traceback.print_exc()
        return None


# ─── Models ───────────────────────────────────────────────

class NotificationOut(BaseModel):
    id: int
    type: str
    title: str
    message: str
    important: bool
    target_user: Optional[str]
    related_ticket_id: Optional[int]
    related_devis_id: Optional[int]
    action_url: Optional[str]
    icon: Optional[str]
    is_read: bool
    created_at: Optional[str]


# ─── Endpoints REST ───────────────────────────────────────

@router.get("")
async def list_notifications(
    user: str = Query(..., description="Nom du membre connecté"),
    unread_only: bool = False,
    limit: int = Query(30, le=100),
):
    """
    Liste les notifs visibles pour cet utilisateur.
    - target_user IS NULL → visible par tous
    - target_user = user → visible uniquement par lui
    """
    _ensure_table()
    with get_cursor() as cur:
        if unread_only:
            cur.execute(
                """
                SELECT * FROM notifications_center
                WHERE (target_user IS NULL OR target_user = %s)
                  AND (read_by NOT LIKE %s OR read_by = '' OR read_by IS NULL)
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (user, f"%,{user},%", limit),
            )
        else:
            cur.execute(
                """
                SELECT * FROM notifications_center
                WHERE target_user IS NULL OR target_user = %s
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (user, limit),
            )
        rows = cur.fetchall() or []

    result = []
    for r in rows:
        d = dict(r)
        read_by = (d.get("read_by") or "").split(",")
        d["is_read"] = user in read_by
        d.pop("read_by", None)
        if d.get("created_at") and hasattr(d["created_at"], "isoformat"):
            d["created_at"] = d["created_at"].isoformat()
        result.append(d)
    return result


@router.get("/unread-count")
async def unread_count(user: str = Query(...)):
    """Renvoie le nombre de notifs non lues pour cet utilisateur."""
    _ensure_table()
    with get_cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) AS count FROM notifications_center
            WHERE (target_user IS NULL OR target_user = %s)
              AND (read_by NOT LIKE %s OR read_by = '' OR read_by IS NULL)
            """,
            (user, f"%,{user},%"),
        )
        row = cur.fetchone() or {"count": 0}
    return {"count": row["count"]}


@router.post("/{notif_id}/read")
async def mark_read(notif_id: int, user: str = Query(...)):
    """Marque une notif comme lue par cet utilisateur."""
    _ensure_table()
    with get_cursor() as cur:
        cur.execute(
            "SELECT read_by FROM notifications_center WHERE id = %s",
            (notif_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Notification introuvable")
        read_by = (row.get("read_by") or "").strip(",")
        users = [u for u in read_by.split(",") if u]
        if user not in users:
            users.append(user)
        new_read_by = "," + ",".join(users) + "," if users else ""
        cur.execute(
            "UPDATE notifications_center SET read_by = %s WHERE id = %s",
            (new_read_by, notif_id),
        )
    return {"ok": True}


@router.post("/mark-all-read")
async def mark_all_read(user: str = Query(...)):
    """Marque toutes les notifs visibles comme lues par cet utilisateur."""
    _ensure_table()
    with get_cursor() as cur:
        cur.execute(
            """
            SELECT id, read_by FROM notifications_center
            WHERE (target_user IS NULL OR target_user = %s)
              AND (read_by NOT LIKE %s OR read_by = '' OR read_by IS NULL)
            """,
            (user, f"%,{user},%"),
        )
        rows = cur.fetchall() or []
        for r in rows:
            read_by = (r.get("read_by") or "").strip(",")
            users = [u for u in read_by.split(",") if u]
            if user not in users:
                users.append(user)
            new_read_by = "," + ",".join(users) + "," if users else ""
            cur.execute(
                "UPDATE notifications_center SET read_by = %s WHERE id = %s",
                (new_read_by, r["id"]),
            )
    return {"ok": True, "marked": len(rows)}


@router.delete("/{notif_id}")
async def delete_notification(notif_id: int):
    """Supprime une notification (admin)."""
    _ensure_table()
    with get_cursor() as cur:
        cur.execute("DELETE FROM notifications_center WHERE id = %s", (notif_id,))
    return {"ok": True}
