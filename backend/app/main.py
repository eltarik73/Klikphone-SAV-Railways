"""
KLIKPHONE SAV — API REST FastAPI
Point d'entrée principal.
"""

import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import close_pool
from app.api import auth, tickets, clients, config, team, parts, catalog


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle: fermer proprement le pool DB à l'arrêt."""
    yield
    close_pool()


app = FastAPI(
    title="Klikphone SAV API",
    version="2.0.0",
    description="API de gestion de tickets SAV pour Klikphone",
    lifespan=lifespan,
)

# ─── CORS ───────────────────────────────────────────────────────
frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
allowed_origins = [
    frontend_url,
    "http://localhost:5173",
    "http://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── ROUTERS ────────────────────────────────────────────────────
app.include_router(auth.router)
app.include_router(tickets.router)
app.include_router(clients.router)
app.include_router(config.router)
app.include_router(team.router)
app.include_router(parts.router)
app.include_router(catalog.router)


# ─── HEALTH CHECK ───────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "service": "klikphone-sav-api"}


@app.get("/")
async def root():
    return {
        "service": "Klikphone SAV API",
        "version": "2.0.0",
        "docs": "/docs",
    }
