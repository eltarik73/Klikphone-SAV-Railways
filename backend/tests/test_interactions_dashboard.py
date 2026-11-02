"""
Pastilles « accords / messages client / avis » du tableau de bord : le filtre `interaction` de
GET /api/tickets/stats/dashboard renvoie les tickets porteurs d'une note client non lue, quel
que soit leur statut (un avis arrive après restitution, un message peut viser un dossier clôturé).

Les tests sur base réelle demandent KP_TEST_DATABASE_URL (base migrée) et sont ignorés sinon ;
tout est annulé (rollback) à la fin.
"""
import os
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from app.api.auth import create_token


def _h(user="Sophie"):
    return {"Authorization": f"Bearer {create_token('accueil', user)}"}


def _cursor():
    cur = MagicMock()
    cur.fetchone.return_value = None
    cur.fetchall.return_value = []

    @contextmanager
    def cm():
        yield cur
    return cur, cm


def _sql_liste(cur):
    return next(c.args[0] for c in cur.execute.call_args_list if "FROM tickets t" in c.args[0])


# ─── REQUÊTE ─────────────────────────────────────────────────────
@pytest.mark.parametrize("interaction, note", [
    ("accord_client", "validation_devis"), ("messages", "message_client"), ("avis", "avis_client"),
])
def test_filtre_interaction_tous_statuts(client, interaction, note):
    cur, cm = _cursor()
    with patch("app.api.tickets.get_cursor", cm), patch("app.api.search.fuzzy_context", return_value=(frozenset(), False)):
        r = client.get("/api/tickets/stats/dashboard", headers=_h(), params={"vue": "tous", "interaction": interaction})
    assert r.status_code == 200
    sql = _sql_liste(cur)
    params = next(c.args[1] for c in cur.execute.call_args_list if c.args[0] == sql)
    assert "SELECT n.ticket_id FROM notes_tickets n" in sql
    assert "(n.is_read = FALSE OR n.is_read IS NULL)" in sql
    assert note in params.values()
    # vue=tous : aucune restriction de statut, les rendus et clôturés sont inclus
    assert "t.statut IN ('Rendu au client', 'Clôturé')" not in sql and "t.statut NOT IN" not in sql


def test_filtre_interaction_inconnu_refuse(client):
    cur, cm = _cursor()
    with patch("app.api.tickets.get_cursor", cm):
        r = client.get("/api/tickets/stats/dashboard", headers=_h(), params={"interaction": "notes"})
    assert r.status_code == 422


# ─── BASE RÉELLE (KP_TEST_DATABASE_URL) ──────────────────────────
DSN = os.environ.get("KP_TEST_DATABASE_URL")


@pytest.fixture
def db():
    if not DSN:
        pytest.skip("KP_TEST_DATABASE_URL absent : tests sur base réelle ignorés")
    psycopg2 = pytest.importorskip("psycopg2")
    import psycopg2.extras
    try:
        conn = psycopg2.connect(DSN, connect_timeout=3)
    except psycopg2.OperationalError as e:
        pytest.skip(f"base de test injoignable : {e}")
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT to_regprocedure('public.kp_doc(text)') IS NOT NULL AS fn")
        if not cur.fetchone()["fn"]:
            pytest.skip("base non migrée (démarrer l'API une fois sur cette base)")
        # Base sans autre note client non lue : les tests comptent tout
        cur.execute("UPDATE notes_tickets SET is_read = TRUE WHERE is_read = FALSE OR is_read IS NULL")
        yield cur
    finally:
        conn.rollback()
        conn.close()


@contextmanager
def _sur(cur):
    @contextmanager
    def ctx(*_a, **_k):
        yield cur
    with patch("app.api.search.get_cursor", ctx), patch("app.api.tickets.get_cursor", ctx), \
            patch("app.api.suivi.get_cursor", ctx):
        yield


def _ticket(cur, statut, jours):
    cur.execute("INSERT INTO clients (nom, prenom, telephone) VALUES ('Interaction', 'Test', '06 00 00 00 00') RETURNING id")
    cid = cur.fetchone()["id"]
    cur.execute("""INSERT INTO tickets (client_id, marque, modele, panne, statut, date_depot)
                   VALUES (%s, 'Testmarque', 'Modèle', 'Écran', %s, %s) RETURNING id""",
                (cid, statut, datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=jours)))
    tid = cur.fetchone()["id"]
    cur.execute("UPDATE tickets SET ticket_code = 'KP-' || lpad(id::text, 6, '0') WHERE id = %s", (tid,))
    return tid


def _note(cur, tid, type_note, lu=False):
    cur.execute("INSERT INTO notes_tickets (ticket_id, auteur, contenu, type_note, is_read) VALUES (%s, 'Client', 'test', %s, %s)",
                (tid, type_note, lu))


def test_pastilles_et_liste_coherentes(client, db):
    cur = db
    rendu_avis = _ticket(cur, "Rendu au client", 10)
    cloture_msg = _ticket(cur, "Clôturé", 100)
    actif_msg = _ticket(cur, "En cours de réparation", 3)
    actif_lu = _ticket(cur, "En cours de réparation", 2)
    _note(cur, rendu_avis, "avis_client")
    _note(cur, cloture_msg, "message_client")
    _note(cur, actif_msg, "message_client")
    _note(cur, actif_lu, "message_client", lu=True)
    _note(cur, actif_lu, "avis_client", lu=True)

    from app.api import suivi
    suivi.invalider_interactions()
    with _sur(cur):
        pastilles = client.get("/api/suivi/dashboard/interactions", headers=_h()).json()
        avis = client.get("/api/tickets/stats/dashboard", headers=_h(), params={"vue": "tous", "interaction": "avis"}).json()
        messages = client.get("/api/tickets/stats/dashboard", headers=_h(), params={"vue": "tous", "interaction": "messages"}).json()
        actifs = client.get("/api/tickets/stats/dashboard", headers=_h(), params={"vue": "actifs", "interaction": "messages"}).json()
    suivi.invalider_interactions()

    assert pastilles["avis"]["count"] == 1 and pastilles["messages"]["count"] == 2
    # Le ticket rendu porte l'avis : il sort bien, alors que la vue des actifs ne l'aurait jamais listé
    assert [t["id"] for t in avis["tickets"]] == [rendu_avis]
    assert avis["tickets"][0]["statut"] == "Rendu au client"
    # Messages : du plus récent au plus ancien, le clôturé compris, le message déjà lu exclu
    assert [t["id"] for t in messages["tickets"]] == [actif_msg, cloture_msg]
    assert messages["total"] == 2
    # Combiné à vue=actifs, la restriction de statut s'applique encore
    assert [t["id"] for t in actifs["tickets"]] == [actif_msg]

    # La fiche sait quelles notes du client sont encore non lues (encart « Du client »)
    with _sur(cur):
        notes = client.get(f"/api/tickets/{actif_lu}/notes", headers=_h()).json()
        notes_msg = client.get(f"/api/tickets/{cloture_msg}/notes", headers=_h()).json()
    assert {n["type_note"]: n["is_read"] for n in notes} == {"message_client": True, "avis_client": True}
    assert [(n["type_note"], n["is_read"]) for n in notes_msg] == [("message_client", False)]
