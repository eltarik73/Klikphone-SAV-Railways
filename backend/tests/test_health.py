"""Tests for health check endpoints."""


def test_root(client):
    """GET / returns service info."""
    r = client.get("/")
    assert r.status_code == 200
    data = r.json()
    assert data["service"] == "Klikphone SAV API"
    assert "version" in data


def test_health(client):
    """GET /health returns ok."""
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_health_db(client):
    """GET /health/db returns db status."""
    r = client.get("/health/db")
    assert r.status_code == 200
    # With mocked DB it may be ok or error, just verify shape
    data = r.json()
    assert "status" in data
    assert "db" in data
