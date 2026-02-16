"""Tests for Pydantic model validation."""

import pytest
from pydantic import ValidationError

from app.models import LoginRequest, ClientCreate, TicketCreate


def test_login_request_valid():
    """LoginRequest accepts valid data."""
    req = LoginRequest(pin="1234", target="accueil")
    assert req.pin == "1234"
    assert req.target == "accueil"
    assert req.utilisateur is None


def test_client_create_valid():
    """ClientCreate validates required fields."""
    c = ClientCreate(nom="Dupont", telephone="0612345678")
    assert c.nom == "Dupont"
    assert c.telephone == "0612345678"
    assert c.prenom == ""
    assert c.email == ""


def test_client_create_missing_required():
    """ClientCreate rejects missing required fields."""
    with pytest.raises(ValidationError):
        ClientCreate(nom="Dupont")  # telephone missing
