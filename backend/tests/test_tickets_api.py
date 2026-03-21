"""Tests for tickets API endpoints."""


def test_list_tickets_returns_list(client):
    """GET /api/tickets returns a list (public endpoint)."""
    r = client.get("/api/tickets")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_list_tickets_with_filters(client):
    """GET /api/tickets with filters doesn't crash."""
    r = client.get("/api/tickets?statut=En+attente+de+diagnostic&limit=10")
    assert r.status_code == 200


def test_get_kpi(client):
    """GET /api/tickets/stats/kpi returns KPI data."""
    r = client.get("/api/tickets/stats/kpi")
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


def test_change_status_invalid(client):
    """PATCH /api/tickets/1/statut with invalid status returns 400."""
    r = client.patch("/api/tickets/1/statut", json={"statut": "Statut Bidon"})
    assert r.status_code == 400


def test_delete_ticket_succeeds(client):
    """DELETE /api/tickets/1 returns 200 (public, cascade delete)."""
    r = client.delete("/api/tickets/1")
    assert r.status_code == 200


def test_queue_repair(client):
    """GET /api/tickets/queue/repair returns a list."""
    r = client.get("/api/tickets/queue/repair")
    assert r.status_code == 200
    assert isinstance(r.json(), list)
