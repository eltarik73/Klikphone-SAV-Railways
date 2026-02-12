"""
KLIKPHONE SAV — API REST FastAPI
Point d'entrée principal.
"""

import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.database import close_pool
from app.api import auth, tickets, clients, config, team, parts, catalog, notifications, print_tickets, caisse_api, attestation, admin, chat, fidelite


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle: init DB tables + fermer proprement le pool DB a l'arret."""
    from app.database import get_cursor
    # Kill any idle-in-transaction sessions that could block ALTER TABLE
    try:
        with get_cursor() as cur:
            cur.execute("""
                SELECT pg_terminate_backend(pid)
                FROM pg_stat_activity
                WHERE state = 'idle in transaction'
                AND pid != pg_backend_pid()
            """)
            killed = cur.rowcount
            if killed:
                print(f"Killed {killed} idle-in-transaction sessions")
    except Exception as e:
        print(f"Warning: could not kill idle sessions: {e}")

    try:
        with get_cursor() as cur:
            cur.execute("SET lock_timeout = '10s'")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS historique (
                    id SERIAL PRIMARY KEY,
                    ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
                    type TEXT DEFAULT 'statut',
                    contenu TEXT,
                    date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cur.execute("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS attention TEXT")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS chat_messages (
                    id SERIAL PRIMARY KEY,
                    sender TEXT NOT NULL,
                    recipient TEXT DEFAULT 'all',
                    message TEXT NOT NULL,
                    is_private BOOLEAN DEFAULT FALSE,
                    read_by TEXT DEFAULT '',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cur.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS points_fidelite INTEGER DEFAULT 0")
            cur.execute("ALTER TABLE clients ADD COLUMN IF NOT EXISTS total_depense DECIMAL(10,2) DEFAULT 0")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS fidelite_historique (
                    id SERIAL PRIMARY KEY,
                    client_id INTEGER REFERENCES clients(id),
                    ticket_id INTEGER REFERENCES tickets(id),
                    type TEXT NOT NULL,
                    points INTEGER NOT NULL,
                    description TEXT,
                    date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cur.execute("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS grattage_fait BOOLEAN DEFAULT FALSE")
            cur.execute("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS grattage_gain TEXT")
    except Exception as e:
        print(f"Warning: migrations: {e}")
    yield
    close_pool()


app = FastAPI(
    title="Klikphone SAV API",
    version="2.0.0",
    description="API de gestion de tickets SAV pour Klikphone",
    lifespan=lifespan,
)

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- ERROR HANDLER ---
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    import traceback
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
        headers={"Access-Control-Allow-Origin": "*"},
    )

# --- ROUTERS ---
app.include_router(auth.router)
app.include_router(tickets.router)
app.include_router(clients.router)
app.include_router(config.router)
app.include_router(team.router)
app.include_router(parts.router)
app.include_router(catalog.router)
app.include_router(notifications.router)
app.include_router(print_tickets.router)
app.include_router(caisse_api.router)
app.include_router(attestation.router)
app.include_router(admin.router)
app.include_router(chat.router)
app.include_router(fidelite.router)


# --- HEALTH CHECK ---
@app.get("/health")
async def health():
    return {"status": "ok", "service": "klikphone-sav-api"}


@app.get("/health/test-notif")
async def test_notif():
    """Temporary: test notification endpoints without auth."""
    from app.database import get_cursor
    from app.services.notifications import wa_link, sms_link, envoyer_email
    results = {}
    ticket_id = 1
    message = "Test Klikphone: votre réparation est prête."

    # 1. WhatsApp
    try:
        with get_cursor() as cur:
            cur.execute("SELECT t.ticket_code, c.telephone FROM tickets t JOIN clients c ON t.client_id = c.id WHERE t.id = %s", (ticket_id,))
            row = cur.fetchone()
        if row and row["telephone"]:
            link = wa_link(row["telephone"], message)
            results["whatsapp"] = {"status": "OK", "link": link}
        else:
            results["whatsapp"] = {"status": "ERROR", "detail": "no phone"}
    except Exception as e:
        results["whatsapp"] = {"status": "ERROR", "detail": str(e)}

    # 2. SMS
    try:
        from app.services.notifications import sms_link
        if row and row["telephone"]:
            link = sms_link(row["telephone"], message)
            results["sms"] = {"status": "OK", "link": link}
    except Exception as e:
        results["sms"] = {"status": "ERROR", "detail": str(e)}

    # 3. Email
    try:
        with get_cursor() as cur:
            cur.execute("SELECT c.email FROM tickets t JOIN clients c ON t.client_id = c.id WHERE t.id = %s", (ticket_id,))
            row2 = cur.fetchone()
        if row2 and row2["email"]:
            success, msg = envoyer_email(row2["email"], "Test Klikphone", message)
            results["email"] = {"status": "OK" if success else "FAIL", "message": msg, "to": row2["email"]}
        else:
            results["email"] = {"status": "ERROR", "detail": "no email"}
    except Exception as e:
        results["email"] = {"status": "ERROR", "detail": str(e)}

    # 4. Templates
    try:
        from app.services.notifications import MESSAGES_PREDEFINIES, generer_message
        keys = list(MESSAGES_PREDEFINIES.keys())[:3]
        with get_cursor() as cur:
            cur.execute("SELECT t.*, c.nom as client_nom, c.prenom as client_prenom, c.telephone as client_tel FROM tickets t JOIN clients c ON t.client_id = c.id WHERE t.id = %s", (ticket_id,))
            tdata = cur.fetchone()
        templates_test = {}
        for k in keys:
            try:
                templates_test[k] = generer_message(k, tdata, tdata)[:80] + "..."
            except Exception as e:
                templates_test[k] = f"ERROR: {e}"
        results["templates"] = templates_test
    except Exception as e:
        results["templates"] = {"error": str(e)}

    return results


@app.get("/health/db")
async def health_db():
    try:
        from app.database import get_cursor
        with get_cursor() as cur:
            cur.execute("SELECT 1")
        return {"status": "ok", "db": "connected"}
    except Exception as e:
        return {"status": "error", "db": str(e)}



@app.get("/")
async def root():
    return {
        "service": "Klikphone SAV API",
        "version": "2.0.0",
        "docs": "/docs",
    }
