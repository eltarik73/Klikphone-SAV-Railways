"""Shared fixtures for backend tests."""

import os

import pytest
from unittest.mock import MagicMock, patch
from contextlib import contextmanager

from fastapi.testclient import TestClient

# Pas de déconnexion générale au démarrage des tests (jetons de module créés avant le lifespan)
os.environ.setdefault("KP_DECONNEXION_DEMARRAGE", "0")
# Lieu des connexions (Base Adresse Nationale) : jamais d'appel réseau dans les tests
os.environ.setdefault("KP_GEO_LIEU", "0")

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

@pytest.fixture(autouse=True)
def _params_cache_vide():
    """Cache des paramètres (services/params) vidé entre deux tests."""
    from app.services import params as params_cache
    params_cache.invalidate()
    yield
    params_cache.invalidate()


@pytest.fixture(autouse=True)
def _roles_admin_vides():
    """Contrôle du rôle admin en cache (auth, 30 s) vidé entre deux tests : chaque test
    simule sa propre base (rôle, preuve du code)."""
    from app.api import auth
    auth.oublier_roles_admin()
    yield
    auth.oublier_roles_admin()


@pytest.fixture(autouse=True)
def _membre_admin_par_defaut(monkeypatch):
    """Partie admin réservée aux membres de ADMIN_MEMBRES (auth.membre_admin) : les tests qui
    simulent un admin fictif (Sophie…) passent ce contrôle ; test_admin_reserve.py teste la vraie
    fonction (importée avant ce remplacement)."""
    from app.api import admin, auth
    # Rôle seul, comme avant ADMIN_MEMBRES (semé à « Tarik » sur les bases de test réelles)
    monkeypatch.setattr(auth, "admin_autorise", lambda nom, role=None: role == "admin")
    monkeypatch.setattr(auth, "membre_admin", lambda nom: True)
    monkeypatch.setattr(admin, "membre_admin", lambda nom: True)
    yield


@pytest.fixture(autouse=True)
def _limiteur_creation_ticket_vide():
    """Débit des créations de ticket sans session (borne) remis à zéro entre deux tests :
    tous les tests anonymes partagent l'IP « testclient »."""
    from app.api import tickets
    tickets._LIMITEUR_CREATION._buckets.clear()
    yield


@pytest.fixture(autouse=True)
def _limiteurs_publics_vides():
    """Limites par IP des formulaires publics (dépôt à distance, commande auto de la borne)
    remises à zéro : toutes les requêtes de test partagent l'IP « testclient »."""
    from app.api import clients, depot_distance, iphone_tarifs, parts
    clients._LIMITEUR_CREATION._buckets.clear()     # 5 fiches / 10 min par IP : « testclient » partagée
    depot_distance._LIMITEUR_DEPOT._buckets.clear()
    parts._LIMITEUR_AUTO._buckets.clear()
    # Plafonds globaux de la vitrine (20/h toutes IP, 2/h par e-mail) : remis à zéro aussi
    iphone_tarifs._LIMITEUR_VITRINE_IP._buckets.clear()
    iphone_tarifs._LIMITEUR_VITRINE_GLOBAL._buckets.clear()
    iphone_tarifs._LIMITEUR_VITRINE_EMAIL._buckets.clear()
    yield


@pytest.fixture(autouse=True)
def _revocations_vides():
    """Révocations en mémoire (sessions closes par cx, jetons d'élévation par sid) vidées entre
    deux tests : chaque test simule son propre journal des connexions."""
    from app.api import auth
    auth.oublier_sessions()
    auth.oublier_revocations()
    yield
    auth.oublier_sessions()
    auth.oublier_revocations()


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


def ref_anonyme(cid: int = 1, ip: str = "testclient") -> str:
    """Référence client signée (POST /api/clients sans session) pour l'IP vue par le serveur :
    « testclient » sans X-Forwarded-For, sinon la DERNIÈRE valeur de l'en-tête."""
    from app.services import client_ref
    return client_ref.signer(cid, ip)


def corps_borne(corps: dict, cid: int = 1, ip: str = "testclient") -> dict:
    """Corps de POST /api/tickets pour la voie anonyme : client_ref à la place de client_id."""
    return {**{k: v for k, v in corps.items() if k != "client_id"}, "client_ref": ref_anonyme(cid, ip)}


@pytest.fixture
def ref_client():
    return ref_anonyme


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
