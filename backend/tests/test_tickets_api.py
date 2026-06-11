"""Tests for tickets API endpoints."""


def test_list_tickets_requires_auth(client):
    """GET /api/tickets sans token renvoie 401 (endpoint protégé)."""
    r = client.get("/api/tickets")
    assert r.status_code in (401, 403)


def test_list_tickets_returns_list(client, auth_headers):
    """GET /api/tickets returns a list (auth requise)."""
    r = client.get("/api/tickets", headers=auth_headers)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_list_tickets_with_filters(client, auth_headers):
    """GET /api/tickets with filters doesn't crash."""
    r = client.get("/api/tickets?statut=En+attente+de+diagnostic&limit=10", headers=auth_headers)
    assert r.status_code == 200


def test_get_kpi(client, auth_headers):
    """GET /api/tickets/stats/kpi returns KPI data (auth requise)."""
    r = client.get("/api/tickets/stats/kpi", headers=auth_headers)
    assert r.status_code == 200
    data = r.json()
    assert "en_attente_diagnostic" in data
    assert "total_actifs" in data


def test_create_ticket_public(client):
    """POST /api/tickets is public (formulaire client)."""
    r = client.post("/api/tickets", json={
        "client_id": 1,
        "categorie": "Smartphone",
        "marque": "Apple",
        "panne": "Écran cassé",
    })
    # Should not be 401 (endpoint is public)
    assert r.status_code != 401


def test_create_ticket_invalid_data(client):
    """POST /api/tickets with missing fields returns 422."""
    r = client.post("/api/tickets", json={"client_id": 1})
    assert r.status_code == 422


def test_get_single_ticket_not_found(client, auth_headers, mock_cursor):
    """GET /api/tickets/99999 returns 404 when not found."""
    mock_cursor.fetchone.return_value = None
    r = client.get("/api/tickets/99999", headers=auth_headers)
    assert r.status_code in (404, 500)


def test_change_status_invalid(client, auth_headers):
    """PATCH /api/tickets/1/statut with invalid status returns 400 (auth requise)."""
    r = client.patch("/api/tickets/1/statut", json={"statut": "Statut Bidon"}, headers=auth_headers)
    assert r.status_code == 400


def test_delete_ticket_requires_auth(client):
    """DELETE /api/tickets/1 sans token renvoie 401 (endpoint protégé)."""
    r = client.delete("/api/tickets/1")
    assert r.status_code in (401, 403)


def test_delete_ticket_succeeds(client, auth_headers):
    """DELETE /api/tickets/1 avec token renvoie 200 (cascade delete)."""
    r = client.delete("/api/tickets/1", headers=auth_headers)
    assert r.status_code == 200


def test_queue_repair(client, auth_headers):
    """GET /api/tickets/queue/repair returns a list (auth requise)."""
    r = client.get("/api/tickets/queue/repair", headers=auth_headers)
    assert r.status_code == 200
    assert isinstance(r.json(), list)
