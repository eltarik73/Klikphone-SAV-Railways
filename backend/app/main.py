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


@app.get("/health/db")
async def health_db():
    try:
        from app.database import get_cursor
        with get_cursor() as cur:
            cur.execute("SELECT 1")
        return {"status": "ok", "db": "connected"}
    except Exception as e:
        return {"status": "error", "db": str(e)}


@app.get("/health/cleanup-fidelite-test")
async def cleanup_fidelite_test():
    """Temporary: clean up test fidelite data for client 1."""
    from app.database import get_cursor
    try:
        with get_cursor() as cur:
            cur.execute("DELETE FROM fidelite_historique WHERE client_id = 1")
            deleted_hist = cur.rowcount
            cur.execute("UPDATE clients SET points_fidelite = 0, total_depense = 0 WHERE id = 1")
            cur.execute("UPDATE tickets SET grattage_fait = FALSE, grattage_gain = NULL WHERE client_id = 1")
            reset_tickets = cur.rowcount
        return {"deleted_historique": deleted_hist, "reset_tickets": reset_tickets, "client_1": "reset to 0 pts"}
    except Exception as e:
        return {"error": str(e)}


@app.get("/health/migrate")
async def health_migrate():
    """Diagnostic: check column existence and run migrations with lock_timeout."""
    from app.database import get_cursor
    results = {}
    # Check existing columns
    try:
        with get_cursor() as cur:
            cur.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'clients'
            """)
            results["clients_columns"] = [r["column_name"] for r in cur.fetchall()]
            cur.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'tickets' AND column_name IN ('grattage_fait', 'grattage_gain', 'attention')
            """)
            results["tickets_fidelite_cols"] = [r["column_name"] for r in cur.fetchall()]
            cur.execute("""
                SELECT table_name FROM information_schema.tables
                WHERE table_name IN ('fidelite_historique', 'historique', 'chat_messages')
            """)
            results["tables"] = [r["table_name"] for r in cur.fetchall()]
    except Exception as e:
        results["check_error"] = str(e)

    # Check locks
    try:
        with get_cursor() as cur:
            cur.execute("""
                SELECT l.relation::regclass, l.mode, l.granted, a.state, a.query, a.pid
                FROM pg_locks l
                JOIN pg_stat_activity a ON l.pid = a.pid
                WHERE l.relation IN ('clients'::regclass, 'tickets'::regclass)
                ORDER BY l.relation, l.mode
            """)
            results["locks"] = [dict(r) for r in cur.fetchall()]
    except Exception as e:
        results["locks_error"] = str(e)

    # Try migrations with short lock timeout
    stmts = [
        ("points_fidelite", "ALTER TABLE clients ADD COLUMN IF NOT EXISTS points_fidelite INTEGER DEFAULT 0"),
        ("total_depense", "ALTER TABLE clients ADD COLUMN IF NOT EXISTS total_depense DECIMAL(10,2) DEFAULT 0"),
        ("fidelite_historique", """CREATE TABLE IF NOT EXISTS fidelite_historique (
            id SERIAL PRIMARY KEY,
            client_id INTEGER REFERENCES clients(id),
            ticket_id INTEGER REFERENCES tickets(id),
            type TEXT NOT NULL,
            points INTEGER NOT NULL,
            description TEXT,
            date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )"""),
        ("grattage_fait", "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS grattage_fait BOOLEAN DEFAULT FALSE"),
        ("grattage_gain", "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS grattage_gain TEXT"),
    ]
    for name, sql in stmts:
        try:
            with get_cursor() as cur:
                cur.execute("SET lock_timeout = '5s'")
                cur.execute(sql)
            results[name] = "OK"
        except Exception as e:
            results[name] = f"ERROR: {e}"
    return results


@app.get("/health/kill-idle")
async def kill_idle():
    """Kill idle-in-transaction sessions that block migrations."""
    from app.database import get_cursor
    try:
        with get_cursor() as cur:
            cur.execute("""
                SELECT pg_terminate_backend(pid)
                FROM pg_stat_activity
                WHERE state = 'idle in transaction'
                AND pid != pg_backend_pid()
                AND query_start < now() - interval '30 seconds'
            """)
            killed = cur.rowcount
        return {"killed": killed}
    except Exception as e:
        return {"error": str(e)}


@app.get("/")
async def root():
    return {
        "service": "Klikphone SAV API",
        "version": "2.0.0",
        "docs": "/docs",
    }
