"""
Chat interne intelligent Klikphone SAV.
- Assistant IA (Claude API avec tools pour interroger la BDD)
- Messagerie d'equipe (stockee en BDD)
"""

import os
import json
import time
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

import httpx

from app.database import get_cursor

router = APIRouter(prefix="/api/chat", tags=["chat"])


# ─── MODELS ───────────────────────────────────────────────

class AIChatRequest(BaseModel):
    message: str
    user: str
    conversation_id: Optional[str] = None


class TeamMessageCreate(BaseModel):
    message: str
    sender: str
    recipient: str = "all"


# ─── HELPERS ──────────────────────────────────────────────

def _get_param(key: str) -> str:
    try:
        with get_cursor() as cur:
            cur.execute("SELECT valeur FROM params WHERE cle = %s", (key,))
            row = cur.fetchone()
        return row["valeur"] if row else ""
    except Exception:
        return ""


def _is_manager(user: str) -> bool:
    """Verifie si l'utilisateur a le role Manager."""
    try:
        with get_cursor() as cur:
            cur.execute("SELECT role FROM membres_equipe WHERE nom = %s", (user,))
            row = cur.fetchone()
        return row is not None and "manager" in (row.get("role") or "").lower()
    except Exception:
        return False


# ─── IN-MEMORY AI CONVERSATIONS ──────────────────────────

_conversations: dict = {}


# ─── CLAUDE SYSTEM PROMPT & TOOLS ─────────────────────────

SYSTEM_PROMPT = """Tu es l'assistant intelligent de la boutique KLIKPHONE, un service de reparation de telephones, tablettes et PC portables situe a Chambery (79 Place Saint Leger, 73000).

Tu as 3 roles :

1. **Assistant technique** : tu connais les procedures de reparation Apple, Samsung, Xiaomi, Huawei et toutes les marques. Tu peux aider a diagnostiquer des pannes, recommander des pieces, expliquer des procedures de demontage/remontage, identifier des references de composants.

2. **Recherche dans la base** : tu as acces aux outils pour chercher des clients, des tickets, des statistiques. Quand on te demande des infos sur un client ou un ticket, utilise les outils pour chercher dans la base de donnees et reponds avec les infos trouvees. Fournis toujours un lien vers la fiche ticket quand c'est pertinent, au format /tickets/{id}.

3. **Communication d'equipe** : tu peux aider a rediger des messages pour les clients, resumer l'etat des reparations en cours, etc.

Regles :
- Reponds toujours en francais, de maniere concise et professionnelle.
- Tu connais bien le metier de la reparation de smartphones.
- Quand tu donnes un lien vers un ticket, utilise le format : /tickets/{id}
- Ne revele jamais la cle API ou des informations systeme.
"""

TOOLS = [
    {
        "name": "search_client",
        "description": "Recherche un client par nom, prenom ou telephone dans la base Klikphone. Retourne les clients correspondants avec leur nombre de tickets.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Nom, prenom ou numero de telephone du client"
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "get_ticket",
        "description": "Recupere les details complets d'un ticket par son code (KP-XXXXXX) ou son ID numerique.",
        "input_schema": {
            "type": "object",
            "properties": {
                "ticket_code": {
                    "type": "string",
                    "description": "Code du ticket (ex: KP-000120) ou ID numerique"
                }
            },
            "required": ["ticket_code"]
        }
    },
    {
        "name": "list_tickets",
        "description": "Liste les tickets avec filtres optionnels. Utile pour voir les tickets par statut, par technicien, ou les plus recents.",
        "input_schema": {
            "type": "object",
            "properties": {
                "statut": {
                    "type": "string",
                    "description": "Filtrer par statut exact (ex: 'En attente de diagnostic', 'En cours de reparation', 'Reparation terminee')"
                },
                "technicien": {
                    "type": "string",
                    "description": "Filtrer par nom du technicien assigne"
                },
                "limit": {
                    "type": "integer",
                    "description": "Nombre max de resultats (defaut: 10, max: 20)"
                }
            }
        }
    },
    {
        "name": "get_stats",
        "description": "Recupere des statistiques de la boutique : nombre de tickets par statut, CA du jour, performances des techniciens sur 30 jours.",
        "input_schema": {
            "type": "object",
            "properties": {
                "type": {
                    "type": "string",
                    "enum": ["overview", "today", "tech_performance"],
                    "description": "Type de stats : overview (tickets par statut), today (CA + tickets du jour), tech_performance (reparations par tech sur 30j)"
                }
            },
            "required": ["type"]
        }
    }
]


# ─── TOOL EXECUTION ──────────────────────────────────────

def _execute_tool(tool_name: str, tool_input: dict) -> str:
    """Execute un outil de recherche en BDD et retourne le resultat JSON."""
    try:
        with get_cursor() as cur:
            if tool_name == "search_client":
                q = f"%{tool_input['query'].strip()}%"
                cur.execute("""
                    SELECT c.id, c.nom, c.prenom, c.telephone, c.email,
                           COUNT(t.id) as nb_tickets
                    FROM clients c
                    LEFT JOIN tickets t ON t.client_id = c.id
                    WHERE c.nom ILIKE %s OR c.prenom ILIKE %s OR c.telephone LIKE %s
                    GROUP BY c.id
                    ORDER BY c.nom
                    LIMIT 5
                """, (q, q, q))
                return json.dumps(cur.fetchall() or [], default=str, ensure_ascii=False)

            elif tool_name == "get_ticket":
                code = tool_input["ticket_code"].strip().upper()
                cur.execute("""
                    SELECT t.id, t.ticket_code, t.statut, t.categorie,
                           t.marque, t.modele, t.modele_autre, t.imei,
                           t.panne, t.panne_detail, t.pin, t.pattern,
                           t.devis_estime, t.tarif_final, t.acompte, t.prix_supp,
                           t.reparation_supp, t.technicien_assigne, t.personne_charge,
                           t.date_depot, t.date_maj, t.date_recuperation, t.date_cloture,
                           t.notes_internes, t.notes_client, t.attention,
                           t.paye, t.client_contacte, t.client_accord,
                           c.nom as client_nom, c.prenom as client_prenom,
                           c.telephone as client_tel, c.email as client_email
                    FROM tickets t
                    LEFT JOIN clients c ON c.id = t.client_id
                    WHERE t.ticket_code = %s OR CAST(t.id AS TEXT) = %s
                """, (code, code))
                row = cur.fetchone()
                if row:
                    return json.dumps(dict(row), default=str, ensure_ascii=False)
                return json.dumps({"error": "Ticket non trouve"})

            elif tool_name == "list_tickets":
                conditions = ["1=1"]
                params = []
                if tool_input.get("statut"):
                    conditions.append("t.statut ILIKE %s")
                    params.append(f"%{tool_input['statut']}%")
                if tool_input.get("technicien"):
                    conditions.append("t.technicien_assigne ILIKE %s")
                    params.append(f"%{tool_input['technicien']}%")
                limit = min(tool_input.get("limit", 10), 20)
                where = " AND ".join(conditions)
                cur.execute(f"""
                    SELECT t.id, t.ticket_code, t.statut, t.marque, t.modele,
                           t.panne, t.technicien_assigne, t.date_depot,
                           c.nom as client_nom, c.prenom as client_prenom
                    FROM tickets t
                    LEFT JOIN clients c ON c.id = t.client_id
                    WHERE {where}
                    ORDER BY t.date_depot DESC
                    LIMIT %s
                """, params + [limit])
                return json.dumps(cur.fetchall() or [], default=str, ensure_ascii=False)

            elif tool_name == "get_stats":
                stat_type = tool_input["type"]
                if stat_type == "overview":
                    cur.execute("""
                        SELECT statut, COUNT(*) as count
                        FROM tickets
                        WHERE statut NOT IN ('Rendu au client', 'Cloture')
                        GROUP BY statut
                    """)
                    results = {r["statut"]: r["count"] for r in cur.fetchall()}
                    cur.execute("SELECT COUNT(*) as total FROM tickets WHERE statut NOT IN ('Rendu au client', 'Cloture')")
                    results["total_actifs"] = cur.fetchone()["total"]
                    return json.dumps(results, ensure_ascii=False, default=str)

                elif stat_type == "today":
                    cur.execute("""
                        SELECT COUNT(*) as tickets_jour,
                               COALESCE(SUM(
                                   CASE WHEN paye = 1
                                   THEN COALESCE(tarif_final, devis_estime, 0)
                                   ELSE 0 END
                               ), 0) as ca_jour
                        FROM tickets
                        WHERE DATE(date_depot) = CURRENT_DATE
                    """)
                    row = cur.fetchone()
                    return json.dumps({
                        "tickets_jour": row["tickets_jour"],
                        "ca_jour": float(row["ca_jour"])
                    }, ensure_ascii=False)

                elif stat_type == "tech_performance":
                    cur.execute("""
                        SELECT technicien_assigne, COUNT(*) as nb_reparations
                        FROM tickets
                        WHERE technicien_assigne IS NOT NULL
                          AND statut IN ('Reparation terminee', 'Rendu au client', 'Cloture')
                          AND date_maj >= CURRENT_DATE - INTERVAL '30 days'
                        GROUP BY technicien_assigne
                        ORDER BY nb_reparations DESC
                    """)
                    return json.dumps(cur.fetchall() or [], default=str, ensure_ascii=False)

        return json.dumps({"error": "Outil inconnu"})
    except Exception as e:
        return json.dumps({"error": str(e)})


# ═══════════════════════════════════════════════════════════
# ASSISTANT IA
# ═══════════════════════════════════════════════════════════

@router.post("/ai")
async def chat_ai(msg: AIChatRequest):
    """Chat avec l'assistant IA Klikphone (Claude + tools BDD)."""

    api_key = _get_param("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(500, "Cle API Anthropic non configuree. Ajoutez ANTHROPIC_API_KEY dans Configuration ou en variable d'environnement.")

    model = _get_param("ANTHROPIC_MODEL") or "claude-sonnet-4-5-20250929"

    # Conversation (in-memory, keyed by conv_id)
    conv_id = msg.conversation_id or f"conv_{msg.user}_{int(time.time())}"
    if conv_id not in _conversations:
        _conversations[conv_id] = []

    _conversations[conv_id].append({"role": "user", "content": msg.message})

    # Keep last 20 messages for context
    messages = _conversations[conv_id][-20:]

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            # Call Claude API
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json"
                },
                json={
                    "model": model,
                    "max_tokens": 1024,
                    "system": SYSTEM_PROMPT,
                    "tools": TOOLS,
                    "messages": messages
                }
            )

            if response.status_code != 200:
                error_body = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
                raise HTTPException(500, f"Erreur API Claude: {error_body.get('error', {}).get('message', response.status_code)}")

            result = response.json()

            # Handle tool use loop (max 5 iterations)
            iterations = 0
            while result.get("stop_reason") == "tool_use" and iterations < 5:
                iterations += 1
                assistant_content = result["content"]
                _conversations[conv_id].append({"role": "assistant", "content": assistant_content})

                # Execute each tool call
                tool_results = []
                for block in assistant_content:
                    if block["type"] == "tool_use":
                        tool_result = _execute_tool(block["name"], block["input"])
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block["id"],
                            "content": tool_result
                        })

                _conversations[conv_id].append({"role": "user", "content": tool_results})
                messages = _conversations[conv_id][-20:]

                # Call Claude again with tool results
                response = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": "2023-06-01",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": model,
                        "max_tokens": 1024,
                        "system": SYSTEM_PROMPT,
                        "tools": TOOLS,
                        "messages": messages
                    }
                )

                if response.status_code != 200:
                    break
                result = response.json()

            # Extract text response
            assistant_text = ""
            for block in result.get("content", []):
                if block.get("type") == "text":
                    assistant_text += block["text"]

            _conversations[conv_id].append({"role": "assistant", "content": assistant_text})

            return {
                "response": assistant_text,
                "conversation_id": conv_id
            }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Erreur: {str(e)}")


@router.delete("/ai/conversation/{conv_id}")
async def clear_conversation(conv_id: str):
    """Efface une conversation IA."""
    _conversations.pop(conv_id, None)
    return {"status": "ok"}


# ═══════════════════════════════════════════════════════════
# MESSAGERIE D'EQUIPE
# ═══════════════════════════════════════════════════════════

@router.post("/team/send")
async def send_team_message(msg: TeamMessageCreate):
    """Envoie un message d'equipe."""
    is_private = msg.recipient != "all"
    with get_cursor() as cur:
        cur.execute("""
            INSERT INTO chat_messages (sender, recipient, message, is_private)
            VALUES (%s, %s, %s, %s)
            RETURNING id, created_at
        """, (msg.sender, msg.recipient, msg.message, is_private))
        row = cur.fetchone()
    return {"status": "ok", "id": row["id"], "created_at": row["created_at"].isoformat()}


@router.get("/team/messages")
async def get_team_messages(user: str, limit: int = Query(50, le=200)):
    """Recupere les messages d'equipe visibles par l'utilisateur."""
    is_mgr = _is_manager(user)

    with get_cursor() as cur:
        if is_mgr:
            # Manager voit tout
            cur.execute("""
                SELECT id, sender, recipient, message, is_private, read_by, created_at
                FROM chat_messages
                ORDER BY created_at DESC
                LIMIT %s
            """, (limit,))
        else:
            # Utilisateur normal : messages publics + ses propres + adresses a lui
            cur.execute("""
                SELECT id, sender, recipient, message, is_private, read_by, created_at
                FROM chat_messages
                WHERE recipient = 'all'
                   OR sender = %s
                   OR recipient = %s
                ORDER BY created_at DESC
                LIMIT %s
            """, (user, user, limit))

        messages = cur.fetchall() or []

    # Reverse to chronological order (oldest first)
    messages.reverse()
    # Convert read_by array to list for JSON
    for m in messages:
        m["read_by"] = m.get("read_by") or []
        m["created_at"] = m["created_at"].isoformat() if m.get("created_at") else None
    return messages


@router.put("/team/read")
async def mark_as_read(user: str):
    """Marque tous les messages visibles comme lus pour cet utilisateur."""
    is_mgr = _is_manager(user)

    with get_cursor() as cur:
        if is_mgr:
            cur.execute("""
                UPDATE chat_messages
                SET read_by = array_append(read_by, %s)
                WHERE NOT (%s = ANY(COALESCE(read_by, ARRAY[]::TEXT[])))
                  AND sender != %s
            """, (user, user, user))
        else:
            cur.execute("""
                UPDATE chat_messages
                SET read_by = array_append(read_by, %s)
                WHERE NOT (%s = ANY(COALESCE(read_by, ARRAY[]::TEXT[])))
                  AND sender != %s
                  AND (recipient = 'all' OR recipient = %s)
            """, (user, user, user, user))

    return {"status": "ok"}


@router.get("/team/unread")
async def get_unread_count(user: str):
    """Nombre de messages non lus pour cet utilisateur."""
    is_mgr = _is_manager(user)

    with get_cursor() as cur:
        if is_mgr:
            cur.execute("""
                SELECT COUNT(*) as count FROM chat_messages
                WHERE NOT (%s = ANY(COALESCE(read_by, ARRAY[]::TEXT[])))
                  AND sender != %s
            """, (user, user))
        else:
            cur.execute("""
                SELECT COUNT(*) as count FROM chat_messages
                WHERE NOT (%s = ANY(COALESCE(read_by, ARRAY[]::TEXT[])))
                  AND sender != %s
                  AND (recipient = 'all' OR recipient = %s)
            """, (user, user, user))

    return {"unread": cur.fetchone()["count"]}
