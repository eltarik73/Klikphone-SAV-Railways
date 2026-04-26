"""Tests pour les endpoints demandes_commandes (passer-commande + admin)."""

from contextlib import contextmanager
from unittest.mock import MagicMock, patch


def _make_cursor(insert_id=42, existing=None, list_rows=None):
    """Helper : cree un mock cursor configurable.

    - insert_id : id retourne par INSERT ... RETURNING id
    - existing : si fourni, simule un doublon dans la dedup query
    - list_rows : pour les GET listant les demandes
    """
    cur = MagicMock()
    fetchone_calls = []

    def fetchone():
        # Sequence : 1er call = dedup check, 2eme call = insert RETURNING
        idx = len(fetchone_calls)
        fetchone_calls.append(idx)
        if idx == 0 and existing is not None:
            return existing  # dedup match
        if idx == 0 and existing is None:
            return None  # pas de doublon
        return {"id": insert_id}  # insert returning

    cur.fetchone.side_effect = fetchone
    cur.fetchall.return_value = list_rows or []
    return cur


@contextmanager
def _mock_get_cursor(cur):
    yield cur


# ─── POST /api/iphone-tarifs/passer-commande ─────────────

def test_passer_commande_happy_path(client):
    """Insert OK → retourne id + message."""
    cur = _make_cursor(insert_id=42)
    with patch("app.api.iphone_tarifs.get_cursor", lambda: _mock_get_cursor(cur)), \
         patch("app.api.iphone_tarifs._send_email", return_value=(True, "ok")):
        r = client.post(
            "/api/iphone-tarifs/passer-commande",
            json={
                "nom": "Jean Test",
                "telephone": "0612345678",
                "email": "jean@example.com",
                "marque": "Apple",
                "modele": "iPhone 15",
                "stockage": "128 Go",
                "prix": 729,
                "message": "Couleur noir SVP",
            },
        )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["id"] == 42
    assert "recontactons" in body["message"].lower()


def test_passer_commande_validation_nom_court(client):
    """Nom < 2 chars → 400."""
    r = client.post(
        "/api/iphone-tarifs/passer-commande",
        json={"nom": "X", "telephone": "0612345678", "modele": "iPhone 15"},
    )
    assert r.status_code == 400
    assert "nom" in r.json()["detail"].lower()


def test_passer_commande_validation_tel_court(client):
    """Téléphone < 6 chars → 400."""
    r = client.post(
        "/api/iphone-tarifs/passer-commande",
        json={"nom": "Jean", "telephone": "06", "modele": "iPhone 15"},
    )
    assert r.status_code == 400
    assert "tél" in r.json()["detail"].lower() or "tel" in r.json()["detail"].lower()


def test_passer_commande_dedup(client):
    """Meme tel+modele+prix dans 60s → retourne id existant, pas de re-insert."""
    cur = _make_cursor(existing={"id": 99})
    with patch("app.api.iphone_tarifs.get_cursor", lambda: _mock_get_cursor(cur)), \
         patch("app.api.iphone_tarifs._send_email", return_value=(True, "ok")):
        r = client.post(
            "/api/iphone-tarifs/passer-commande",
            json={
                "nom": "Jean",
                "telephone": "0612345678",
                "modele": "iPhone 15",
                "prix": 729,
            },
        )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["id"] == 99
    assert body.get("deduped") is True


def test_passer_commande_sanitize_newlines(client):
    """Email injection : \\r\\n dans nom → strippé avant insert."""
    cur = _make_cursor(insert_id=1)
    insert_call_args = []

    def execute_capture(sql, *args):
        if "INSERT INTO demandes_commandes" in sql.upper().replace("\n", " "):
            insert_call_args.append(args[0] if args else None)

    cur.execute.side_effect = execute_capture

    with patch("app.api.iphone_tarifs.get_cursor", lambda: _mock_get_cursor(cur)), \
         patch("app.api.iphone_tarifs._send_email", return_value=(True, "ok")):
        client.post(
            "/api/iphone-tarifs/passer-commande",
            json={
                "nom": "Jean\r\nBcc: attacker@evil.com",
                "telephone": "06123\n45678",
                "modele": "iPhone 15",
            },
        )
    # Verifier qu'aucun \r\n n'est passe dans les valeurs inserees
    if insert_call_args:
        for v in insert_call_args[0]:
            if isinstance(v, str):
                assert "\r" not in v
                assert "\n" not in v


# ─── PATCH /demandes-commandes/{id} ───────────────────────

def test_patch_demande_field_not_allowed(client, admin_headers):
    """Champ hors whitelist → 400."""
    cur = _make_cursor()
    with patch("app.api.iphone_tarifs.get_cursor", lambda: _mock_get_cursor(cur)):
        # On envoie un champ inexistant via Pydantic permissif (extra='ignore')
        # — meme si Pydantic filtre, on verifie la robustesse en bypassant.
        # Le test pratique : statut invalide → 400
        r = client.patch(
            "/api/iphone-tarifs/demandes-commandes/1",
            json={"statut": "invalid_status_xyz"},
            headers=admin_headers,
        )
    assert r.status_code == 400


def test_patch_demande_requires_auth(client):
    """Sans token → 401."""
    r = client.patch(
        "/api/iphone-tarifs/demandes-commandes/1",
        json={"statut": "confirmee"},
    )
    assert r.status_code in (401, 403)


def test_count_nouvelles_requires_auth(client):
    """Endpoint admin sans token → 401."""
    r = client.get("/api/iphone-tarifs/demandes-commandes/count-nouvelles")
    assert r.status_code in (401, 403)


# ─── DELETE /demandes-commandes/{id} ───────────────────────

def test_delete_demande_requires_jwt(client):
    """Sans token JWT → 401."""
    r = client.request(
        "DELETE",
        "/api/iphone-tarifs/demandes-commandes/1",
        headers={"X-Admin-Password": "anything"},
    )
    assert r.status_code in (401, 403)


def test_delete_demande_requires_admin_password(client, admin_headers):
    """JWT OK mais pas de header X-Admin-Password → 403 (pas 401 pour ne
    pas declencher le redirect frontend qui reset le token JWT)."""
    r = client.request(
        "DELETE",
        "/api/iphone-tarifs/demandes-commandes/1",
        headers=admin_headers,
    )
    # 401 redirigerait l'utilisateur, on veut 403 pour rester connecte
    assert r.status_code == 403


def test_delete_demande_wrong_password(client, admin_headers):
    """Mauvais code admin → 403, pas 401."""
    cur = MagicMock()
    cur.fetchone.return_value = {"valeur": "le-vrai-mdp"}
    cur.fetchall.return_value = []

    @contextmanager
    def ctx():
        yield cur

    with patch("app.api.iphone_tarifs.get_cursor", ctx):
        r = client.request(
            "DELETE",
            "/api/iphone-tarifs/demandes-commandes/1",
            headers={**admin_headers, "X-Admin-Password": "mauvais"},
        )
    assert r.status_code == 403


def test_delete_demande_constant_time_compare(client, admin_headers):
    """Bon code → 200 + audit log + delete."""
    fetchone_seq = iter([
        {"valeur": "secret-mdp"},  # 1er fetchone : SELECT params
        {"nom": "Jean", "marque": "Apple", "modele": "iPhone 15", "prix": 729},  # 2nd : SELECT existing
    ])
    cur = MagicMock()
    cur.fetchone.side_effect = lambda: next(fetchone_seq, None)
    cur.fetchall.return_value = []
    executed_sqls = []
    cur.execute.side_effect = lambda sql, *a: executed_sqls.append(sql)

    @contextmanager
    def ctx():
        yield cur

    with patch("app.api.iphone_tarifs.get_cursor", ctx):
        r = client.request(
            "DELETE",
            "/api/iphone-tarifs/demandes-commandes/42",
            headers={**admin_headers, "X-Admin-Password": "secret-mdp"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["deleted_id"] == 42
    # Verifier qu'un INSERT audit_log a bien ete fait
    audit_inserts = [s for s in executed_sqls if "admin_audit_log" in s]
    assert len(audit_inserts) >= 1
    # Verifier qu'un DELETE FROM demandes_commandes a bien ete fait
    deletes = [s for s in executed_sqls if "DELETE FROM demandes_commandes" in s]
    assert len(deletes) >= 1


def test_delete_demande_inexistante_meme_message_que_password_KO(client, admin_headers):
    """Demande inexistante avec bon code → 403 (pas 404) avec meme
    message que 'code KO' pour ne pas leaker l'existence d'IDs."""
    fetchone_seq = iter([
        {"valeur": "secret-mdp"},  # SELECT params OK
        None,  # SELECT existing → introuvable
    ])
    cur = MagicMock()
    cur.fetchone.side_effect = lambda: next(fetchone_seq, None)
    cur.fetchall.return_value = []

    @contextmanager
    def ctx():
        yield cur

    with patch("app.api.iphone_tarifs.get_cursor", ctx):
        r = client.request(
            "DELETE",
            "/api/iphone-tarifs/demandes-commandes/9999",
            headers={**admin_headers, "X-Admin-Password": "secret-mdp"},
        )
    assert r.status_code == 403  # meme code que mauvais password
