"""Tests for clients API endpoints."""


def test_list_clients_requires_auth(client):
    """GET /api/clients requires authentication."""
    r = client.get("/api/clients")
    assert r.status_code == 401


def test_create_client_public(client):
    """POST /api/clients is public (get_or_create from form)."""
    r = client.post("/api/clients", json={
        "nom": "Test",
        "telephone": "0600000000",
    })
    # Should not be 401 (endpoint is public)
    assert r.status_code != 401


def test_create_client_invalid(client):
    """POST /api/clients with missing fields returns 422."""
    r = client.post("/api/clients", json={"nom": "Test"})
    assert r.status_code == 422


def test_update_client_requires_auth(client):
    """PATCH /api/clients/1 requires authentication."""
    r = client.patch("/api/clients/1", json={"nom": "Nouveau"})
    assert r.status_code == 401


def test_delete_client_requires_auth(client):
    """DELETE /api/clients/1 requires authentication."""
    r = client.delete("/api/clients/1")
    assert r.status_code == 401


def test_list_clients_with_auth(client, auth_headers):
    """GET /api/clients with valid auth returns list."""
    r = client.get("/api/clients", headers=auth_headers)
    assert r.status_code == 200
    assert isinstance(r.json(), list)
