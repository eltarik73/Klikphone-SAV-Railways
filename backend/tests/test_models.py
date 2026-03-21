"""Tests for Pydantic model validation."""

import pytest
from pydantic import ValidationError

from app.models import (
    LoginRequest, ClientCreate, ClientUpdate, ClientOut,
    TicketCreate, TicketUpdate, TicketOut, StatusChange,
    CommandePieceCreate, MembreEquipeCreate, ParamUpdate,
    KPIResponse, SendMessageRequest,
)


# ── LoginRequest ───────────────────────────────────────

def test_login_request_valid():
    """LoginRequest accepts valid data."""
    req = LoginRequest(pin="1234", target="accueil")
    assert req.pin == "1234"
    assert req.target == "accueil"
    assert req.utilisateur is None


def test_login_request_with_utilisateur():
    """LoginRequest accepts optional utilisateur."""
    req = LoginRequest(pin="5678", target="tech", utilisateur="Marina")
    assert req.utilisateur == "Marina"


def test_login_request_missing_pin():
    """LoginRequest rejects missing pin."""
    with pytest.raises(ValidationError):
        LoginRequest(target="accueil")


def test_login_request_missing_target():
    """LoginRequest rejects missing target."""
    with pytest.raises(ValidationError):
        LoginRequest(pin="1234")


# ── ClientCreate / ClientUpdate ────────────────────────

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


def test_client_create_all_fields():
    """ClientCreate with all optional fields."""
    c = ClientCreate(
        nom="Dupont", prenom="Jean", telephone="0612345678",
        email="jean@test.com", societe="ACME", carte_camby=1,
    )
    assert c.prenom == "Jean"
    assert c.societe == "ACME"
    assert c.carte_camby == 1


def test_client_update_partial():
    """ClientUpdate allows partial updates (all fields optional)."""
    u = ClientUpdate(nom="Nouveau Nom")
    assert u.nom == "Nouveau Nom"
    assert u.telephone is None
    assert u.email is None


# ── TicketCreate / TicketUpdate ────────────────────────

def test_ticket_create_minimal():
    """TicketCreate with required fields only."""
    t = TicketCreate(client_id=1, categorie="Smartphone", marque="Apple", panne="Écran cassé")
    assert t.client_id == 1
    assert t.marque == "Apple"
    assert t.modele == ""
    assert t.source == "boutique"
    assert t.est_retour_sav is False


def test_ticket_create_missing_required():
    """TicketCreate rejects missing panne."""
    with pytest.raises(ValidationError):
        TicketCreate(client_id=1, categorie="Smartphone", marque="Apple")


def test_ticket_create_retour_sav():
    """TicketCreate for SAV return ticket."""
    t = TicketCreate(
        client_id=1, categorie="Smartphone", marque="Samsung",
        panne="Même problème", est_retour_sav=True, ticket_original_id=42,
        source="distance",
    )
    assert t.est_retour_sav is True
    assert t.ticket_original_id == 42
    assert t.source == "distance"


def test_ticket_update_partial():
    """TicketUpdate allows partial updates."""
    u = TicketUpdate(tarif_final=89.90, paye=1)
    assert u.tarif_final == 89.90
    assert u.paye == 1
    assert u.marque is None


# ── StatusChange ───────────────────────────────────────

def test_status_change_valid():
    """StatusChange accepts a valid status."""
    sc = StatusChange(statut="En cours de réparation")
    assert sc.statut == "En cours de réparation"


def test_status_change_missing():
    """StatusChange rejects missing statut."""
    with pytest.raises(ValidationError):
        StatusChange()


# ── CommandePieceCreate ────────────────────────────────

def test_commande_piece_create():
    """CommandePieceCreate with description."""
    cp = CommandePieceCreate(description="Écran iPhone 14", prix=45.50)
    assert cp.description == "Écran iPhone 14"
    assert cp.prix == 45.50
    assert cp.ticket_id is None


def test_commande_piece_missing_description():
    """CommandePieceCreate rejects missing description."""
    with pytest.raises(ValidationError):
        CommandePieceCreate()


# ── MembreEquipeCreate ─────────────────────────────────

def test_membre_equipe_create():
    """MembreEquipeCreate with required fields."""
    m = MembreEquipeCreate(nom="Marina", role="accueil")
    assert m.nom == "Marina"
    assert m.couleur == "#3B82F6"  # default


# ── ParamUpdate ────────────────────────────────────────

def test_param_update():
    """ParamUpdate with cle and valeur."""
    p = ParamUpdate(cle="NOM_BOUTIQUE", valeur="Klikphone")
    assert p.cle == "NOM_BOUTIQUE"


# ── KPIResponse ────────────────────────────────────────

def test_kpi_response_defaults():
    """KPIResponse has zero defaults."""
    kpi = KPIResponse()
    assert kpi.en_attente_diagnostic == 0
    assert kpi.total_actifs == 0
    assert kpi.nouveaux_aujourdhui == 0


# ── SendMessageRequest ─────────────────────────────────

def test_send_message_request():
    """SendMessageRequest with required fields."""
    msg = SendMessageRequest(ticket_id=1, channel="whatsapp", message="Bonjour")
    assert msg.channel == "whatsapp"
    assert msg.template_key is None


def test_send_message_missing_channel():
    """SendMessageRequest rejects missing channel."""
    with pytest.raises(ValidationError):
        SendMessageRequest(ticket_id=1, message="Test")
