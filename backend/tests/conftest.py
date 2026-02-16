"""Shared fixtures for backend tests."""

import pytest
from unittest.mock import MagicMock, patch
from contextlib import contextmanager

from fastapi.testclient import TestClient

from app.api.auth import create_token, JWT_SECRET, JWT_ALGORITHM


# ── Mock DB before importing app ────────────────────────────

@contextmanager
def _mock_cursor():
    """Context manager that yields a mock cursor."""
    cur = MagicMock()
    cur.fetchone.return_value = None
    cur.fetchall.return_value = []
    yield cur


@contextmanager
def _mock_db():
    """Context manager that yields a mock connection."""
    conn = MagicMock()
    cur = MagicMock()
    cur.fetchone.return_value = None
    cur.fetchall.return_value = []
    conn.cursor.return_value = cur
    yield conn


# Patch DB at module level so app can import without a real database
_patcher_cursor = patch("app.database.get_cursor", _mock_cursor)
_patcher_db = patch("app.database.get_db", _mock_db)
_patcher_pool = patch("app.database.close_pool", lambda: None)
_patcher_cursor.start()
_patcher_db.start()
_patcher_pool.start()

from app.main import app  # noqa: E402


# ── Fixtures ────────────────────────────────────────────────

@pytest.fixture
def client():
    """TestClient for the FastAPI app."""
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def auth_token():
    """Valid JWT token for a regular accueil user."""
    return create_token("accueil", "TestUser")


@pytest.fixture
def admin_token():
    """Valid JWT token for an admin user."""
    return create_token("accueil", "Admin")


@pytest.fixture
def auth_headers(auth_token):
    """Authorization headers for a regular user."""
    return {"Authorization": f"Bearer {auth_token}"}


@pytest.fixture
def admin_headers(admin_token):
    """Authorization headers for an admin user."""
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture
def mock_cursor():
    """Provides a fresh mock cursor for DB-dependent tests."""
    with patch("app.database.get_cursor") as mock_gc:
        cur = MagicMock()
        cur.fetchone.return_value = None
        cur.fetchall.return_value = []

        @contextmanager
        def ctx():
            yield cur

        mock_gc.side_effect = ctx
        yield cur
