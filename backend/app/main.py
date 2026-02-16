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
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from app.database import close_pool
from app.api import auth, tickets, clients, config, team, parts, catalog, notifications, print_tickets, caisse_api, attestation, admin, chat, fidelite, email_api, tarifs, marketing, telephones, autocomplete


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle: init DB tables + fermer proprement le pool DB a l'arret."""
    from app.database import get_cursor
    # Non-blocking migrations: kill idle sessions, short lock_timeout, skip on failure
    try:
        with get_cursor() as cur:
            cur.execute("""
                SELECT pg_terminate_backend(pid)
                FROM pg_stat_activity
                WHERE state = 'idle in transaction'
                AND pid != pg_backend_pid()
            """)
    except Exception:
        pass

    # CREATE TABLE statements (don't need exclusive locks)
    for sql in [
        """CREATE TABLE IF NOT EXISTS historique (
            id SERIAL PRIMARY KEY,
            ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
            type TEXT DEFAULT 'statut',
            contenu TEXT,
            date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS chat_messages (
            id SERIAL PRIMARY KEY,
            sender TEXT NOT NULL,
            recipient TEXT DEFAULT 'all',
            message TEXT NOT NULL,
            is_private BOOLEAN DEFAULT FALSE,
            read_by TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS fidelite_historique (
            id SERIAL PRIMARY KEY,
            client_id INTEGER REFERENCES clients(id),
            ticket_id INTEGER REFERENCES tickets(id),
            type TEXT NOT NULL,
            points INTEGER NOT NULL,
            description TEXT,
            date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS notes_tickets (
            id SERIAL PRIMARY KEY,
            ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
            auteur TEXT NOT NULL,
            contenu TEXT NOT NULL,
            important BOOLEAN DEFAULT FALSE,
            date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS autocompletion (
            id SERIAL PRIMARY KEY,
            categorie VARCHAR(50) NOT NULL,
            terme VARCHAR(255) NOT NULL,
            compteur INTEGER DEFAULT 1,
            derniere_utilisation TIMESTAMP DEFAULT NOW(),
            UNIQUE(categorie, terme)
        )""",
    ]:
        try:
            with get_cursor() as cur:
                cur.execute(sql)
        except Exception as e:
            print(f"Warning CREATE TABLE: {e}")

    # Tarifs table
    try:
        tarifs._ensure_table()
    except Exception as e:
        print(f"Warning tarifs table: {e}")

    # Marketing tables
    try:
        marketing._ensure_tables()
    except Exception as e:
        print(f"Warning marketing tables: {e}")

    # Telephones table
    try:
        telephones._ensure_table()
    except Exception as e:
        print(f"Warning telephones table: {e}")

    # ALTER TABLE statements (need exclusive lock — use very short timeout)
    for sql in [
        "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS attention TEXT",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS points_fidelite INTEGER DEFAULT 0",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS total_depense DECIMAL(10,2) DEFAULT 0",
        "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS grattage_fait BOOLEAN DEFAULT FALSE",
        "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS grattage_gain TEXT",
        "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS reduction_montant DECIMAL(10,2) DEFAULT 0",
        "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS reduction_pourcentage DECIMAL(5,2) DEFAULT 0",
        "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS telephone_pret TEXT",
        "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS telephone_pret_imei TEXT",
        "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS telephone_pret_rendu BOOLEAN DEFAULT FALSE",
        "ALTER TABLE commandes_pieces ADD COLUMN IF NOT EXISTS ticket_code TEXT DEFAULT ''",
        "ALTER TABLE notes_tickets ADD COLUMN IF NOT EXISTS type_note TEXT DEFAULT 'note'",
        "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS reparation_debut TIMESTAMP",
        "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS reparation_fin TIMESTAMP",
        "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS reparation_duree INTEGER DEFAULT 0",
    ]:
        try:
            with get_cursor() as cur:
                cur.execute("SET lock_timeout = '3s'")
                cur.execute(sql)
        except Exception as e:
            print(f"Warning ALTER TABLE: {e}")
    # Performance indexes (CREATE INDEX IF NOT EXISTS is safe to run every startup)
    for sql in [
        "CREATE INDEX IF NOT EXISTS idx_tickets_client_id ON tickets(client_id)",
        "CREATE INDEX IF NOT EXISTS idx_tickets_statut ON tickets(statut)",
        "CREATE INDEX IF NOT EXISTS idx_tickets_date_depot ON tickets(date_depot DESC)",
        "CREATE INDEX IF NOT EXISTS idx_clients_telephone ON clients(telephone)",
        "CREATE INDEX IF NOT EXISTS idx_notes_tickets_ticket_id ON notes_tickets(ticket_id)",
        "CREATE INDEX IF NOT EXISTS idx_commandes_pieces_ticket_id ON commandes_pieces(ticket_id)",
        "CREATE INDEX IF NOT EXISTS idx_historique_ticket_id ON historique(ticket_id)",
        "CREATE INDEX IF NOT EXISTS idx_fidelite_hist_client ON fidelite_historique(client_id)",
        "CREATE INDEX IF NOT EXISTS idx_fidelite_hist_ticket ON fidelite_historique(ticket_id)",
        "CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_tickets_technicien ON tickets(technicien_assigne)",
        "CREATE INDEX IF NOT EXISTS idx_autocompletion_categorie ON autocompletion(categorie)",
        "CREATE INDEX IF NOT EXISTS idx_autocompletion_compteur ON autocompletion(categorie, compteur DESC)",
    ]:
        try:
            with get_cursor() as cur:
                cur.execute(sql)
        except Exception as e:
            print(f"Warning CREATE INDEX: {e}")

    # Seed autocompletion — pannes courantes
    try:
        with get_cursor() as cur:
            cur.execute("""
                INSERT INTO autocompletion (categorie, terme, compteur) VALUES
                    ('panne', 'Écran cassé', 100),
                    ('panne', 'Batterie HS', 80),
                    ('panne', 'Ne charge plus', 60),
                    ('panne', 'Connecteur de charge', 45),
                    ('panne', 'Écran qui clignote', 40),
                    ('panne', 'Vitre arrière cassée', 35),
                    ('panne', 'Bouton power HS', 30),
                    ('panne', 'Caméra arrière HS', 25),
                    ('panne', 'Désoxydation', 25),
                    ('panne', 'Tactile ne répond plus', 22),
                    ('panne', 'Caméra avant HS', 20),
                    ('panne', 'Haut-parleur HS', 20),
                    ('panne', 'Face ID HS', 20),
                    ('panne', 'LCD tâche noire', 18),
                    ('panne', 'Micro HS', 15),
                    ('panne', 'Touch ID HS', 15),
                    ('panne', 'Écouteur interne HS', 12),
                    ('panne', 'Batterie qui gonfle', 10),
                    ('panne', 'Wifi / Bluetooth HS', 10),
                    ('panne', 'Nappe volume HS', 8)
                ON CONFLICT (categorie, terme) DO NOTHING
            """)
            cur.execute("""
                INSERT INTO params (cle, valeur) VALUES ('AFFICHER_AUTOCOMPLETION', 'true')
                ON CONFLICT (cle) DO NOTHING
            """)
    except Exception as e:
        print(f"Warning autocompletion seed: {e}")

    # Default admin password
    try:
        with get_cursor() as cur:
            cur.execute("""
                INSERT INTO params (cle, valeur) VALUES ('ADMIN_PASSWORD', 'caramail')
                ON CONFLICT (cle) DO NOTHING
            """)
    except Exception as e:
        print(f"Warning ADMIN_PASSWORD default: {e}")

    yield
    close_pool()


app = FastAPI(
    title="Klikphone SAV API",
    version="2.1.0",
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

# --- GZIP (compress responses > 500 bytes) ---
app.add_middleware(GZipMiddleware, minimum_size=500)

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
app.include_router(email_api.router)
app.include_router(tarifs.router)
app.include_router(marketing.router)
app.include_router(telephones.router)
app.include_router(autocomplete.router)


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



@app.get("/")
async def root():
    return {
        "service": "Klikphone SAV API",
        "version": "2.0.0",
        "docs": "/docs",
    }
