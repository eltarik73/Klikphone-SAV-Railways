"""Tests for endpoint security (auth + role checks)."""

import pytest


# ── 401 without token ──────────────────────────────────

PROTECTED_ENDPOINTS = [
    ("GET", "/api/clients"),
    ("GET", "/api/config"),
    ("GET", "/api/team"),
]


@pytest.mark.parametrize("method,path", PROTECTED_ENDPOINTS)
def test_protected_endpoints_require_auth(client, method, path):
    """Protected endpoints return 401 without auth token."""
    r = client.request(method, path)
    assert r.status_code == 401, f"{method} {path} returned {r.status_code}"


# ── Admin-only endpoints ───────────────────────────────

ADMIN_ENDPOINTS = [
    ("GET", "/api/admin/stats/overview"),
    ("GET", "/api/admin/stats"),
    ("GET", "/api/admin/reparations"),
]


@pytest.mark.parametrize("method,path", ADMIN_ENDPOINTS)
def test_admin_endpoints_require_auth(client, method, path):
    """Admin endpoints return 401 without auth token."""
    r = client.request(method, path)
    assert r.status_code == 401, f"{method} {path} returned {r.status_code}"


# ── Marketing endpoints ───────────────────────────────

MARKETING_ENDPOINTS = [
    ("GET", "/api/marketing/posts"),
    ("GET", "/api/marketing/avis"),
    ("GET", "/api/marketing/calendrier"),
]


@pytest.mark.parametrize("method,path", MARKETING_ENDPOINTS)
def test_marketing_endpoints_require_auth(client, method, path):
    """Marketing endpoints return 401 without auth token."""
    r = client.request(method, path)
    assert r.status_code == 401, f"{method} {path} returned {r.status_code}"


# ── Fidelite ──────────────────────────────────────────

def test_fidelite_get_requires_auth(client):
    """GET /api/fidelite/{id} requires auth."""
    r = client.get("/api/fidelite/1")
    assert r.status_code == 401


def test_fidelite_crediter_requires_auth(client):
    """POST /api/fidelite/crediter requires auth."""
    r = client.post("/api/fidelite/crediter", json={
        "client_id": 1, "ticket_id": 1, "montant": 100.0
    })
    assert r.status_code == 401


# ── Fallback SPA : pas de lecture hors de backend/static ─────

TRAVERSAL_PATHS = [
    "/..%2Fapp%2Fmain.py",
    "/%2e%2e/app/main.py",
    "/%2e%2e%2fapp%2fdatabase.py",
    "/assets%2F..%2F..%2Fapp%2Fmain.py",
]


@pytest.mark.parametrize("path", TRAVERSAL_PATHS)
def test_spa_fallback_refuse_path_traversal(client, path):
    r = client.get(path)
    assert "get_cursor" not in r.text and "FastAPI" not in r.text, f"{path} a servi un fichier hors de static/"
