"""Tri des réparations oubliées (services/nettoyage, /api/admin/anciens) et ordre de la recherche
(du plus récent au plus ancien, tous statuts confondus).

Tests unitaires (routes, SQL paramétré), puis tests réels sur PostgreSQL quand
KP_TEST_DATABASE_URL désigne une base migrée ; sans elle, ces derniers sont ignorés. Les données
sont fictives et écrites dans une transaction annulée à la fin de chaque test.
"""

import os
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from app.api.auth import create_admin_token, create_token, decode_token
from app.services import nettoyage as N
from app.services import search as S


def _h(admin=False, user="Sophie"):
    tok = create_token("accueil", user)
    h = {"Authorization": f"Bearer {tok}"}
    if admin:
        h["X-Admin-Token"] = create_admin_token(decode_token(tok))
    return h


def _cursor(fetchall=None):
    cur = MagicMock()
    cur.fetchone.return_value = None
    cur.fetchall.return_value = fetchall or []

    @contextmanager
    def cm():
        yield cur
    return cur, cm


# ─── RÈGLE ───────────────────────────────────────────────────────
def test_seuil_en_utc():
    paris = timezone(timedelta(hours=1))
    assert N.seuil(60, datetime(2026, 11, 1, 10, 0, tzinfo=paris)) == "2026-09-02 09:00:00"
    assert N.seuil(60, datetime(2026, 11, 1, 9, 0)) == "2026-09-02 09:00:00"
    assert N.note(60) == "Clôturé car plus de 60 jours"


def test_fragments_sans_saisie():
    sql = N.ouvert_ancien_sql("t", "%(seuil)s")
    assert "'Rendu au client', 'Clôturé'" in sql and "t.date_depot < %(seuil)s" in sql
    assert "telephone_pret_rendu::text" in N.pret_dehors_sql("t")


def test_kpi_compte_les_anciens(client, auth_headers):
    cur, cm = _cursor()
    with patch("app.api.tickets.get_cursor", cm):
        r = client.get("/api/tickets/stats/kpi", headers=auth_headers)
    assert r.status_code == 200 and r.json()["anciens"] == 0
    sql, params = cur.execute.call_args.args
    assert "as anciens" in sql and len(params) == 5
    # Seuil à 60 jours, texte UTC comparé au TIMESTAMP naïf date_depot
    attendu = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=60)
    assert abs(datetime.strptime(params[4], "%Y-%m-%d %H:%M:%S") - attendu) < timedelta(minutes=1)


# ─── ROUTES ──────────────────────────────────────────────────────
def test_routes_reservees_admin(client):
    assert client.get("/api/admin/anciens").status_code == 401
    assert client.get("/api/admin/anciens", headers=_h()).status_code == 403
    r = client.post("/api/admin/anciens/cloturer", headers=_h(), json={"jours": 60, "ids": [1]})
    assert r.status_code == 403


@pytest.mark.parametrize("corps", [{"jours": 60, "ids": []}, {"jours": 10, "ids": [1]}, {"jours": 60},
                                   {"jours": 60, "ids": list(range(N.IDS_MAX + 1))}])
def test_cloture_valide_la_demande(client, corps):
    assert client.post("/api/admin/anciens/cloturer", headers=_h(admin=True), json=corps).status_code == 422


def test_apercu_forme(client):
    cur, cm = _cursor(fetchall=[{"statut": "En cours de réparation", "n": 3, "bloques": 1}])
    with patch("app.api.admin.get_cursor", cm):
        r = client.get("/api/admin/anciens", params={"jours": 90}, headers=_h(admin=True))
    assert r.status_code == 200
    body = r.json()
    assert body["jours"] == 90 and body["total"] == 3 and body["bloques"] == 1
    for call in cur.execute.call_args_list:
        sql, params = call.args
        assert set(params) == {"seuil", "limite"} and "%(seuil)s" in sql


def test_cloture_forme_et_trace(client):
    cur, cm = _cursor(fetchall=[{"statut": "Réparation terminée", "n": 2}])
    with patch("app.api.admin.get_cursor", cm):
        r = client.post("/api/admin/anciens/cloturer", headers=_h(admin=True, user="Tarik"),
                        json={"jours": 60, "ids": [3, 1, 3]})
    assert r.status_code == 200
    assert r.json() == {"jours": 60, "clotures": 2, "ignores": 0,
                        "par_statut": [{"statut": "Réparation terminée", "n": 2}]}
    ecriture = next(c.args for c in cur.execute.call_args_list if "UPDATE tickets" in c.args[0])
    sql, params = ecriture
    assert params["ids"] == [1, 3] and params["auteur"] == "Tarik"
    assert params["note"] == "Clôturé car plus de 60 jours"
    # Clôture de tri : ni date_cloture (CA, réparations du jour) ni paiement
    assert "date_cloture" not in sql and "paye" not in sql
    assert any("admin_audit_log" in c.args[0] for c in cur.execute.call_args_list)


# ─── RECHERCHE : ORDRE ───────────────────────────────────────────
def test_ordre_des_mots_par_date_seule():
    # Mots : seule la saisie lue comme un emplacement d'étagère passe devant, puis la date,
    # sans statut ni « actifs d'abord »
    for q in ("google", "jean dupont"):
        order = S.ticket_order_sql(S.parse_query(q), S.SqlParams())
        assert order.endswith(") THEN 2 ELSE 0 END) DESC, t.date_depot DESC NULLS LAST, t.id DESC")
        assert "statut" not in order and "THEN 1" not in order and "kp_doc" not in order
    sans_emplacement = S.parse_query("google")
    sans_emplacement.emplacement = None
    assert S.ticket_order_sql(sans_emplacement, S.SqlParams()) == "t.date_depot DESC NULLS LAST, t.id DESC"


def test_ordre_designations_avant_la_date():
    P = S.SqlParams()
    order = S.ticket_order_sql(S.parse_query("0612345678"), P)
    assert order.startswith("(CASE WHEN ") and "THEN 2" in order and "THEN 1" in order
    assert order.endswith("t.date_depot DESC NULLS LAST, t.id DESC")
    sans_emplacement = S.parse_query("dupont")
    sans_emplacement.emplacement = None
    assert S.ticket_rang_sql(sans_emplacement, S.SqlParams()) == "0::int"


def test_marques_et_gammes():
    assert "%pixel%" in S.parse_query("google").words[0].patterns
    assert "%galaxy%" in S.parse_query("samsung").words[0].patterns
    assert "%google%" not in S.parse_query("pixel").words[0].patterns


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
        cur.execute("SELECT to_regprocedure('public.kp_doc(text)') IS NOT NULL AS fn,"
                    " to_regclass('public.historique') IS NOT NULL AS h")
        r = cur.fetchone()
        if not (r["fn"] and r["h"]):
            pytest.skip("base non migrée (démarrer l'API une fois sur cette base)")
        # Les tests comptent tout ce qui dépasse le seuil : base sans autre dossier ouvert
        cur.execute("UPDATE tickets SET statut = 'Clôturé' WHERE statut NOT IN ('Rendu au client', 'Clôturé')")
        yield cur
    finally:
        conn.rollback()
        conn.close()


def _client(cur, nom, tel="06 11 22 33 44"):
    cur.execute("INSERT INTO clients (nom, prenom, telephone) VALUES (%s, 'Fictif', %s) RETURNING id", (nom, tel))
    return cur.fetchone()["id"]


def _ticket(cur, client_id, statut, jours, marque="Testmarque", modele="Modèle", **extra):
    cols = {"client_id": client_id, "marque": marque, "modele": modele, "panne": "Écran", "statut": statut,
            "date_depot": datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=jours), **extra}
    cur.execute(f"INSERT INTO tickets ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))}) RETURNING id",
                list(cols.values()))
    tid = cur.fetchone()["id"]
    cur.execute("UPDATE tickets SET ticket_code = 'KP-' || lpad(id::text, 6, '0') WHERE id = %s", (tid,))
    return tid


def test_cloture_reelle(db):
    cur = db
    cid = _client(cur, "Triancien")
    ids = {
        "en_cours": _ticket(cur, cid, "En cours de réparation", 70),
        "termine": _ticket(cur, cid, "Réparation terminée", 200, emplacement="B3", historique="ligne d'avant\n"),
        "piece": _ticket(cur, cid, "En attente de pièce", 61),
        "pret": _ticket(cur, cid, "En cours de réparation", 90, telephone_pret="iPhone 8 de prêt"),
        "recent": _ticket(cur, cid, "En cours de réparation", 59),
        "rendu": _ticket(cur, cid, "Rendu au client", 120),
    }
    ap = N.apercu(cur, 60)
    trouves = {t["id"] for t in ap["tickets"]}
    assert trouves == {ids["en_cours"], ids["termine"], ids["piece"], ids["pret"]}
    assert ap["total"] == 4 and ap["bloques"] == 1 and not ap["tronque"]
    # Du plus ancien au plus récent
    assert ap["tickets"][0]["id"] == ids["termine"]

    # Le dossier récent, le rendu et le prêt dehors sont refusés même s'ils sont demandés
    r = N.cloturer(cur, 60, list(ids.values()), "Tarik", "01/11 10:00")
    assert r["clotures"] == 3 and r["ignores"] == 3
    assert {s["statut"] for s in r["par_statut"]} == {"En cours de réparation", "Réparation terminée",
                                                       "En attente de pièce"}

    cur.execute("SELECT id, statut, emplacement, date_cloture, historique FROM tickets WHERE id = ANY(%s)",
                (list(ids.values()),))
    rows = {r["id"]: r for r in cur.fetchall()}
    for k in ("en_cours", "termine", "piece"):
        assert rows[ids[k]]["statut"] == "Clôturé" and rows[ids[k]]["date_cloture"] is None
    assert rows[ids["pret"]]["statut"] == "En cours de réparation"
    assert rows[ids["recent"]]["statut"] == "En cours de réparation"
    assert rows[ids["termine"]]["emplacement"] is None
    assert rows[ids["termine"]]["historique"] == (
        "ligne d'avant\n[01/11 10:00] Statut: Réparation terminée → Clôturé "
        "(clôturé car plus de 60 jours, emplacement B3 libéré) — par Tarik")

    cur.execute("SELECT ticket_id, contenu, auteur, type_note FROM notes_tickets WHERE ticket_id = ANY(%s)",
                (list(ids.values()),))
    notes = cur.fetchall()
    assert {n["ticket_id"] for n in notes} == {ids["en_cours"], ids["termine"], ids["piece"]}
    assert all(n["contenu"] == "Clôturé car plus de 60 jours" and n["type_note"] == "note" for n in notes)
    cur.execute("SELECT contenu FROM historique WHERE ticket_id = %s", (ids["en_cours"],))
    assert cur.fetchone()["contenu"].startswith("Statut: En cours de réparation → Clôturé")

    # Deuxième passage : plus rien à clôturer
    assert N.cloturer(cur, 60, list(ids.values()), "Tarik", "01/11 10:01")["clotures"] == 0
    assert N.apercu(cur, 60)["total"] == 1  # le prêt dehors


def test_recherche_du_plus_recent_au_plus_ancien(db):
    cur = db
    from app.api import search as api_search
    c1 = _client(cur, "Zygomatest")
    t = {
        "cloture_hier": _ticket(cur, c1, "Clôturé", 1, marque="Google", modele="Pixel 7"),
        "termine": _ticket(cur, c1, "Réparation terminée", 5, marque="Google", modele="Pixel 6"),
        "en_cours_vieux": _ticket(cur, c1, "En cours de réparation", 40, marque="Google", modele="Pixel 5"),
        # Marque « Autre » : trouvé par la gamme
        "autre": _ticket(cur, c1, "Rendu au client", 3, marque="Autre", modele="Pixel 8a"),
    }
    attendu = [t["cloture_hier"], t["autre"], t["termine"], t["en_cours_vieux"]]
    pq = S.parse_query("google")
    rows, total = api_search._search_tickets(cur, pq, 25)
    assert [r["id"] for r in rows if r["id"] in t.values()] == attendu

    P = S.SqlParams()
    cur.execute("SELECT t.id FROM tickets t JOIN clients c ON t.client_id = c.id WHERE "
                + S.ticket_where_sql(pq, P) + " ORDER BY " + S.ticket_order_sql(pq, P), P.values)
    assert [r["id"] for r in cur.fetchall() if r["id"] in t.values()] == attendu
