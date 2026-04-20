"""
KLIKPHONE SAV — API REST FastAPI
Point d'entrée principal.
"""

import logging
import os
import traceback
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from app.database import close_pool
from app.api import auth, tickets, clients, config, team, parts, catalog, notifications, print_tickets, caisse_api, attestation, admin, chat, fidelite, email_api, tarifs, marketing, telephones, autocomplete, devis, reporting, depot_distance, suivi, iphone_tarifs, iphones_stock, smartphones_tarifs

logger = logging.getLogger("klikphone.startup")


def _seed_catalog_models():
    """Seed Samsung & Xiaomi models into catalog (ON CONFLICT DO NOTHING)."""
    from app.database import get_cursor
    samsung_smartphones = [
        "Galaxy S24", "Galaxy S24+", "Galaxy S24 Ultra",
        "Galaxy S23", "Galaxy S23+", "Galaxy S23 Ultra", "Galaxy S23 FE",
        "Galaxy S22", "Galaxy S22+", "Galaxy S22 Ultra",
        "Galaxy S21", "Galaxy S21+", "Galaxy S21 Ultra", "Galaxy S21 FE",
        "Galaxy Z Fold 5", "Galaxy Z Fold 4", "Galaxy Z Fold 3",
        "Galaxy Z Flip 5", "Galaxy Z Flip 4", "Galaxy Z Flip 3",
        "Galaxy A55", "Galaxy A54", "Galaxy A53", "Galaxy A52", "Galaxy A52s",
        "Galaxy A35", "Galaxy A34", "Galaxy A33",
        "Galaxy A25", "Galaxy A24", "Galaxy A23",
        "Galaxy A15", "Galaxy A14", "Galaxy A13",
        "Galaxy A05", "Galaxy A05s",
        "Galaxy M55", "Galaxy M54", "Galaxy M34", "Galaxy M14",
    ]
    samsung_tablets = [
        "Galaxy Tab S9", "Galaxy Tab S9+", "Galaxy Tab S9 Ultra",
        "Galaxy Tab S9 FE", "Galaxy Tab S9 FE+",
        "Galaxy Tab A9", "Galaxy Tab A9+",
    ]
    xiaomi_smartphones = [
        "Xiaomi 14", "Xiaomi 14 Pro", "Xiaomi 14 Ultra",
        "Xiaomi 13", "Xiaomi 13 Pro", "Xiaomi 13 Ultra", "Xiaomi 13T", "Xiaomi 13T Pro",
        "Xiaomi 12", "Xiaomi 12 Pro", "Xiaomi 12T", "Xiaomi 12T Pro",
        "Redmi Note 13", "Redmi Note 13 Pro", "Redmi Note 13 Pro+",
        "Redmi Note 12", "Redmi Note 12 Pro", "Redmi Note 12 Pro+",
        "Redmi Note 11", "Redmi Note 11 Pro", "Redmi Note 11 Pro+",
        "Redmi 13", "Redmi 13C",
        "Redmi 12", "Redmi 12C",
        "Redmi A3", "Redmi A2", "Redmi A2+",
        "POCO X6", "POCO X6 Pro",
        "POCO X5", "POCO X5 Pro",
        "POCO M6", "POCO M6 Pro",
        "POCO F5", "POCO F5 Pro",
    ]
    xiaomi_tablets = ["Xiaomi Pad 6", "Xiaomi Pad 6 Pro"]

    with get_cursor() as cur:
        # Ensure marques exist
        for cat, marque in [("Smartphone", "Samsung"), ("Tablette", "Samsung"),
                            ("Smartphone", "Xiaomi"), ("Tablette", "Xiaomi")]:
            cur.execute(
                "INSERT INTO catalog_marques (categorie, marque) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (cat, marque),
            )
        # Insert models
        rows = []
        for m in samsung_smartphones:
            rows.append(("Smartphone", "Samsung", m))
        for m in samsung_tablets:
            rows.append(("Tablette", "Samsung", m))
        for m in xiaomi_smartphones:
            rows.append(("Smartphone", "Xiaomi", m))
        for m in xiaomi_tablets:
            rows.append(("Tablette", "Xiaomi", m))
        for cat, marque, modele in rows:
            cur.execute(
                "INSERT INTO catalog_modeles (categorie, marque, modele) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                (cat, marque, modele),
            )


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
        print(f"Warning kill idle sessions:\n{traceback.format_exc()}")

    # Enable unaccent extension for accent-insensitive search
    try:
        with get_cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS unaccent")
    except Exception as e:
        print(f"Warning unaccent extension: {e}\n{traceback.format_exc()}")

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
        """CREATE TABLE IF NOT EXISTS devis (
            id SERIAL PRIMARY KEY,
            numero TEXT UNIQUE,
            client_id INTEGER REFERENCES clients(id),
            client_nom TEXT,
            client_prenom TEXT,
            client_tel TEXT,
            client_email TEXT,
            appareil TEXT,
            description TEXT,
            statut TEXT DEFAULT 'Brouillon',
            total_ht DECIMAL(10,2) DEFAULT 0,
            tva DECIMAL(5,2) DEFAULT 20,
            total_ttc DECIMAL(10,2) DEFAULT 0,
            remise DECIMAL(10,2) DEFAULT 0,
            notes TEXT,
            validite_jours INTEGER DEFAULT 30,
            date_creation TIMESTAMP DEFAULT NOW(),
            date_maj TIMESTAMP DEFAULT NOW(),
            date_acceptation TIMESTAMP,
            date_refus TIMESTAMP,
            ticket_id INTEGER
        )""",
        """CREATE TABLE IF NOT EXISTS devis_lignes (
            id SERIAL PRIMARY KEY,
            devis_id INTEGER REFERENCES devis(id) ON DELETE CASCADE,
            description TEXT NOT NULL,
            quantite INTEGER DEFAULT 1,
            prix_unitaire DECIMAL(10,2) DEFAULT 0,
            total DECIMAL(10,2) DEFAULT 0,
            ordre INTEGER DEFAULT 0
        )""",
        """CREATE TABLE IF NOT EXISTS telephones_vente (
            id SERIAL PRIMARY KEY,
            marque TEXT NOT NULL,
            modele TEXT NOT NULL,
            capacite TEXT,
            couleur TEXT,
            etat TEXT DEFAULT 'Occasion',
            prix_achat DECIMAL(10,2) DEFAULT 0,
            prix_vente DECIMAL(10,2) DEFAULT 0,
            imei TEXT,
            en_stock BOOLEAN DEFAULT TRUE,
            notes TEXT,
            date_ajout TIMESTAMP DEFAULT NOW()
        )""",
    ]:
        try:
            with get_cursor() as cur:
                cur.execute(sql)
        except Exception as e:
            print(f"Warning CREATE TABLE: {e}\n{traceback.format_exc()}")

    # Tarifs table
    try:
        tarifs._ensure_table()
    except Exception as e:
        print(f"Warning tarifs table: {e}\n{traceback.format_exc()}")

    # iPhone tarifs (affiches boutique) : table + seed
    try:
        iphone_tarifs.init_iphone_tarifs()
    except Exception as e:
        print(f"Warning iphone_tarifs init: {e}\n{traceback.format_exc()}")

    # iPhones stock (ventes + générateur vidéo Story) : table + seed
    try:
        iphones_stock.init_iphones_stock()
    except Exception as e:
        print(f"Warning iphones_stock init: {e}\n{traceback.format_exc()}")

    # Smartphones non-Apple (Samsung, Xiaomi, Google, etc.)
    try:
        smartphones_tarifs.init_smartphones_tarifs()
    except Exception as e:
        print(f"Warning smartphones_tarifs init: {e}\n{traceback.format_exc()}")

    # Attestations table
    try:
        attestation._ensure_attestation_table()
    except Exception as e:
        print(f"Warning attestations table: {e}\n{traceback.format_exc()}")

    # Marketing tables
    try:
        marketing._ensure_tables()
    except Exception as e:
        print(f"Warning marketing tables: {e}\n{traceback.format_exc()}")

    # Telephones table
    try:
        telephones._ensure_table()
    except Exception as e:
        print(f"Warning telephones table: {e}\n{traceback.format_exc()}")

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
        "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS cree_par TEXT DEFAULT ''",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS cree_par TEXT DEFAULT ''",
        "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS est_retour_sav BOOLEAN DEFAULT FALSE",
        "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ticket_original_id INTEGER",
        "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'boutique'",
        "ALTER TABLE notes_tickets ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE",
        "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS type_document TEXT DEFAULT 'devis'",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS carte_camby BOOLEAN DEFAULT FALSE",
    ]:
        try:
            with get_cursor() as cur:
                cur.execute("SET lock_timeout = '3s'")
                cur.execute(sql)
        except Exception as e:
            print(f"Warning ALTER TABLE: {e}\n{traceback.format_exc()}")
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
        "CREATE INDEX IF NOT EXISTS idx_devis_client_id ON devis(client_id)",
        "CREATE INDEX IF NOT EXISTS idx_devis_statut ON devis(statut)",
        "CREATE INDEX IF NOT EXISTS idx_devis_date ON devis(date_creation DESC)",
        "CREATE INDEX IF NOT EXISTS idx_devis_lignes_devis_id ON devis_lignes(devis_id)",
        "CREATE INDEX IF NOT EXISTS idx_telephones_vente_marque ON telephones_vente(marque)",
        "CREATE INDEX IF NOT EXISTS idx_telephones_vente_stock ON telephones_vente(en_stock)",
        "CREATE INDEX IF NOT EXISTS idx_tickets_cree_par ON tickets(cree_par)",
        "CREATE INDEX IF NOT EXISTS idx_tickets_date_cloture ON tickets(date_cloture DESC)",
        "CREATE INDEX IF NOT EXISTS idx_tickets_retour_sav ON tickets(est_retour_sav) WHERE est_retour_sav = true",
        "CREATE INDEX IF NOT EXISTS idx_tickets_original_id ON tickets(ticket_original_id) WHERE ticket_original_id IS NOT NULL",
        "CREATE INDEX IF NOT EXISTS idx_tickets_source ON tickets(source)",
        # Performance indexes — ticket_code lookups, commandes, clients
        "CREATE INDEX IF NOT EXISTS idx_tickets_ticket_code ON tickets(ticket_code)",
        "CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email)",
        "CREATE INDEX IF NOT EXISTS idx_commandes_pieces_ticket_code ON commandes_pieces(ticket_code)",
        "CREATE INDEX IF NOT EXISTS idx_commandes_pieces_statut ON commandes_pieces(statut)",
        "CREATE INDEX IF NOT EXISTS idx_notes_tickets_type ON notes_tickets(ticket_id, type_note)",
    ]:
        try:
            with get_cursor() as cur:
                cur.execute(sql)
        except Exception as e:
            print(f"Warning CREATE INDEX: {e}\n{traceback.format_exc()}")

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
            cur.execute("""
                INSERT INTO params (cle, valeur) VALUES
                    ('MODULE_DEVIS_VISIBLE', 'false'),
                    ('MODULE_DEVIS_FLASH_VISIBLE', 'false'),
                    ('DEPOT_DISTANCE_ACTIF', 'true'),
                    ('NOTIFICATIONS_EMAIL_ACTIF', 'true'),
                    ('NOTIFICATIONS_STATUTS', 'Réparation terminée,En attente de pièce,En cours de réparation')
                ON CONFLICT (cle) DO NOTHING
            """)
    except Exception as e:
        print(f"Warning autocompletion seed: {e}\n{traceback.format_exc()}")

    # Default admin password — lu depuis env var DEFAULT_ADMIN_PASSWORD.
    # Si absent, on ne seed PAS de mot de passe en clair (security).
    # Le password existant en DB est preserve (ON CONFLICT DO NOTHING).
    try:
        default_admin_pwd = os.environ.get("DEFAULT_ADMIN_PASSWORD")
        with get_cursor() as cur:
            if default_admin_pwd:
                cur.execute(
                    """INSERT INTO params (cle, valeur) VALUES ('ADMIN_PASSWORD', %s)
                       ON CONFLICT (cle) DO NOTHING""",
                    (default_admin_pwd,),
                )
            cur.execute("""
                INSERT INTO params (cle, valeur) VALUES ('GOOGLE_REVIEW_LINK', 'https://g.page/r/Cf6adrBONrj3EAE/review')
                ON CONFLICT (cle) DO NOTHING
            """)
            cur.execute("""
                INSERT INTO params (cle, valeur) VALUES ('URL_SUIVI', 'https://klikphone-sav-v2-production.up.railway.app')
                ON CONFLICT (cle) DO UPDATE SET valeur = 'https://klikphone-sav-v2-production.up.railway.app'
                WHERE params.valeur != 'https://klikphone-sav-v2-production.up.railway.app'
            """)
    except Exception as e:
        print(f"Warning ADMIN_PASSWORD default: {e}\n{traceback.format_exc()}")

    # Seed Samsung & Xiaomi models
    try:
        _seed_catalog_models()
    except Exception as e:
        print(f"Warning catalog seed: {e}\n{traceback.format_exc()}")

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


# --- CACHE HEADERS for static assets ---
@app.middleware("http")
async def cache_headers(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    # Hashed JS/CSS assets: cache 1 year (immutable, filename changes on rebuild)
    if path.startswith("/assets/") and any(path.endswith(ext) for ext in (".js", ".css")):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    # Images/fonts: cache 1 week
    elif path.startswith("/assets/") or path.endswith((".png", ".jpg", ".svg", ".woff2")):
        response.headers["Cache-Control"] = "public, max-age=604800"
    # index.html: no cache (always fresh)
    elif path == "/" or (not path.startswith("/api/") and "." not in path.split("/")[-1]):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


# --- ERROR HANDLER ---
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    # Log full traceback server-side, but return a generic message client-side
    # pour éviter de fuiter des infos (stack traces, requêtes SQL, env vars).
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
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
app.include_router(devis.router)
app.include_router(reporting.router)
app.include_router(depot_distance.router)
app.include_router(suivi.router)
app.include_router(iphone_tarifs.router)
app.include_router(iphones_stock.router)
app.include_router(smartphones_tarifs.router)


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
    except Exception:
        # Ne pas exposer le message d'erreur DB (peut contenir DSN/secrets)
        traceback.print_exc()
        return {"status": "error", "db": "unreachable"}



# --- GENERATED VIDEOS (Story iPhone) ---
GENERATED_VIDEOS_DIR = Path(__file__).resolve().parent / "video" / "generated"
GENERATED_VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
app.mount(
    "/generated-videos",
    StaticFiles(directory=str(GENERATED_VIDEOS_DIR)),
    name="generated-videos",
)


# --- STATIC FRONTEND (SPA) ---
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

if STATIC_DIR.exists():
    # Serve /assets/* (JS, CSS, images)
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="static-assets")

    # Serve known static files at root (logo, manifest, sw.js, etc.)
    @app.get("/logo_k.png")
    @app.get("/tampon_klikphone.png")
    @app.get("/manifest.json")
    @app.get("/sw.js")
    async def static_root_files(request: Request):
        fname = request.url.path.lstrip("/")
        fpath = STATIC_DIR / fname
        if fpath.exists():
            return FileResponse(str(fpath))
        return JSONResponse({"detail": "Not found"}, 404)

    @app.get("/")
    async def serve_index():
        return FileResponse(str(STATIC_DIR / "index.html"))

    # SPA catch-all: any path not matched by API routers → serve index.html
    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        # Don't serve index.html for API paths or docs
        if full_path.startswith("api/") or full_path.startswith("generated-videos/") or full_path in ("docs", "redoc", "openapi.json", "health", "health/db"):
            return JSONResponse({"detail": "Not found"}, 404)
        # Check if it's a real static file
        file_path = STATIC_DIR / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(STATIC_DIR / "index.html"))
else:
    @app.get("/")
    async def root():
        return {
            "service": "Klikphone SAV API",
            "version": "2.1.0",
            "docs": "/docs",
        }
