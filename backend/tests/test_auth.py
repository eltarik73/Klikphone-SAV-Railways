"""Tests for authentication endpoints."""

from unittest.mock import patch, MagicMock
from contextlib import contextmanager


def test_login_success(client):
    """POST /api/auth/login with correct PIN returns token."""
    mock_cur = MagicMock()
    mock_cur.fetchone.return_value = {"valeur": "1234"}

    @contextmanager
    def mock_gc():
        yield mock_cur

    with patch("app.api.auth.get_cursor", mock_gc):
        r = client.post("/api/auth/login", json={
            "pin": "1234",
            "target": "accueil",
            "utilisateur": "Marina",
        })

    assert r.status_code == 200
    data = r.json()
    assert "access_token" in data
    assert data["target"] == "accueil"
    assert data["utilisateur"] == "Marina"


def test_login_wrong_pin(client):
    """POST /api/auth/login with wrong PIN returns 401."""
    mock_cur = MagicMock()
    mock_cur.fetchone.return_value = {"valeur": "1234"}

    @contextmanager
    def mock_gc():
        yield mock_cur

    with patch("app.api.auth.get_cursor", mock_gc):
        r = client.post("/api/auth/login", json={
            "pin": "9999",
            "target": "accueil",
        })

    assert r.status_code == 401


def test_me_with_valid_token(client, auth_headers):
    """GET /api/auth/me with valid token returns user info."""
    mock_cur = MagicMock()
    mock_cur.fetchone.return_value = {"role": "admin"}

    @contextmanager
    def mock_gc():
        yield mock_cur

    with patch("app.api.auth.get_cursor", mock_gc):
        r = client.get("/api/auth/me", headers=auth_headers)

    assert r.status_code == 200
    data = r.json()
    assert data["utilisateur"] == "TestUser"
    assert data["target"] == "accueil"
