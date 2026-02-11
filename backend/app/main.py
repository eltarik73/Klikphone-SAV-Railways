"""
KLIKPHONE SAV — API REST FastAPI
Point d'entrée principal.
"""

import os
from pathlib import Path
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from app.database import close_pool
from app.api import auth, tickets, clients, config, team, parts, catalog, notifications, print_tickets, caisse_api, attestation, admin

# Frontend dist directory (built by Vite)
FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle: fermer proprement le pool DB a l'arret."""
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


@app.get("/api")
async def api_root():
    return {
        "service": "Klikphone SAV API",
        "version": "2.0.0",
        "docs": "/docs",
    }


# --- FRONTEND STATIC FILES ---
if FRONTEND_DIST.exists():
    # Serve static assets (JS, CSS, images)
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="static-assets")

    # Serve files from root (favicon, logo, etc.)
    @app.get("/favicon.svg")
    @app.get("/favicon.ico")
    @app.get("/logo_k.png")
    async def static_root_file(request: Request):
        filename = request.url.path.lstrip("/")
        filepath = FRONTEND_DIST / filename
        if filepath.exists():
            return FileResponse(str(filepath))
        return JSONResponse({"detail": "Not found"}, status_code=404)

    # SPA fallback — serve index.html for all non-API routes
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Don't catch API routes or docs
        if full_path.startswith("api/") or full_path in ("docs", "redoc", "openapi.json"):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        # Try to serve static file first
        file_path = FRONTEND_DIST / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        # SPA fallback
        index = FRONTEND_DIST / "index.html"
        if index.exists():
            return FileResponse(str(index))
        return JSONResponse({"detail": "Frontend not built"}, status_code=404)
else:
    @app.get("/")
    async def root():
        return {
            "service": "Klikphone SAV API",
            "version": "2.0.0",
            "docs": "/docs",
            "note": "Frontend not found. Run 'npm run build' in frontend/",
        }
