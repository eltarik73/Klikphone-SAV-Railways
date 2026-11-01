"""Tri automatique des réparations oubliées (services/nettoyage) et recherche tolérante aux fautes
(dashboard et palette : mots approchés d'emblée, lignes exactes devant, du plus récent au plus
ancien tous statuts confondus).

Tests unitaires (SQL paramétré, routes), puis tests réels sur PostgreSQL quand
KP_TEST_DATABASE_URL désigne une base migrée ; sans elle, ces derniers sont ignorés. Les données
sont fictives et écrites dans une transaction annulée à la fin de chaque test.
"""

import os
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
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


def _cursor(fetchall=None, fetchone=None):
    cur = MagicMock()
    cur.fetchone.return_value = fetchone
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


def test_note_dit_que_ce_n_est_pas_un_agent():
    n = N.note(60)
    assert n.startswith("Clôturé automatiquement") and "60 jours" in n and "pas un agent" in n
    assert N.AUTEUR == "Tri automatique"


def test_fragments_sans_saisie():
    sql = N.ouvert_ancien_sql("t", "%(seuil)s")
    assert "'Rendu au client', 'Clôturé'" in sql and "t.date_depot < %(seuil)s" in sql
    assert "telephone_pret_rendu::text" in N.pret_dehors_sql("t")


@pytest.mark.parametrize("brut, attendu", [
    (None, 60), ("", 60), ("60", 60), ("0", 0), ("-3", 0), ("10", 30), ("99999", 3650), ("abc", 60), ("90", 90),
])
def test_jours_configures(brut, attendu):
    cur, _ = _cursor(fetchone=None if brut is None else {"valeur": brut})
    assert N.jours_configures(cur) == attendu


# ─── PASSAGE QUOTIDIEN ───────────────────────────────────────────
def test_tri_automatique_une_fois_par_jour():
    cur, cm = _cursor(fetchall=[{"statut": "En attente de pièce", "n": 2}])
    # verrou pris, 60 jours, pas encore passé aujourd'hui
    cur.fetchone.side_effect = [{"ok": True}, {"valeur": "60"}, None]
    with patch("app.services.nettoyage.get_cursor", cm):
        r = N.tri_automatique(date(2026, 11, 1))
    assert r == {"jours": 60, "clotures": 2, "par_statut": [{"statut": "En attente de pièce", "n": 2}]}
    sqls = [c.args[0] for c in cur.execute.call_args_list]
    ecriture = next(c.args for c in cur.execute.call_args_list if "UPDATE tickets" in c.args[0])
    sql, params = ecriture
    assert params["ids"] is None and params["auteur"] == "Tri automatique"
    assert params["note"] == N.note(60) and "%(seuil)s" in sql
    # Clôture de tri : ni date_cloture (CA, réparations du jour) ni paiement
    assert "date_cloture" not in sql and "paye" not in sql
    assert any("admin_audit_log" in q for q in sqls)
    derniere = next(c.args[1] for c in cur.execute.call_args_list if "INSERT INTO params" in c.args[0])
    assert derniere == (N.PARAM_DERNIERE, "2026-11-01")

    # Déjà passé aujourd'hui : rien
    cur2, cm2 = _cursor()
    cur2.fetchone.side_effect = [{"ok": True}, {"valeur": "60"}, {"valeur": "2026-11-01"}]
    with patch("app.services.nettoyage.get_cursor", cm2):
        assert N.tri_automatique(date(2026, 11, 1)) is None
    assert not any("UPDATE tickets" in c.args[0] for c in cur2.execute.call_args_list)

    # Tri coupé (TRI_AUTO_JOURS = 0) ou verrou tenu ailleurs : rien
    for side in ([{"ok": True}, {"valeur": "0"}], [{"ok": False}]):
        cur3, cm3 = _cursor()
        cur3.fetchone.side_effect = side
        with patch("app.services.nettoyage.get_cursor", cm3):
            assert N.tri_automatique(date(2026, 11, 1)) is None
        assert not any("UPDATE tickets" in c.args[0] for c in cur3.execute.call_args_list)


def test_tache_de_fond_coupee_par_env(monkeypatch):
    monkeypatch.setenv("KP_TRI_AUTO", "0")
    N._tache["thread"] = None
    N.demarrer_tri_quotidien()
    assert N._tache["thread"] is None


def test_routes_admin_retirees(client):
    assert client.get("/api/admin/anciens", headers=_h(admin=True)).status_code == 404
    assert client.post("/api/admin/anciens/cloturer", headers=_h(admin=True), json={"ids": [1]}).status_code in (404, 405)


def test_kpi_sans_compteur_anciens(client):
    cur, cm = _cursor()
    with patch("app.api.tickets.get_cursor", cm):
        r = client.get("/api/tickets/stats/kpi", headers=_h())
    assert r.status_code == 200 and "anciens" not in r.json()
    sql, params = cur.execute.call_args.args
    assert "anciens" not in sql and len(params) == 4


# ─── RECHERCHE : ORDRE ET FAUTES ─────────────────────────────────
def test_ordre_des_mots_par_date_seule():
    # Mots exacts : seule la saisie lue comme un emplacement passe devant, puis la date,
    # sans statut ni « actifs d'abord »
    for q in ("google", "jean dupont"):
        order = S.ticket_order_sql(S.parse_query(q), S.SqlParams())
        assert order.endswith(") THEN 2 ELSE 0 END) DESC, t.date_depot DESC NULLS LAST, t.id DESC")
        assert "statut" not in order and "THEN 1" not in order and "kp_doc" not in order
    sans = S.parse_query("google")
    sans.emplacement = None
    assert S.ticket_order_sql(sans, S.SqlParams()) == "t.date_depot DESC NULLS LAST, t.id DESC"
    assert S.ticket_exact_words_sql(S.parse_query("google"), S.SqlParams()) is None


def test_ordre_designations_avant_la_date():
    P = S.SqlParams()
    order = S.ticket_order_sql(S.parse_query("0612345678"), P)
    assert order.startswith("(CASE WHEN ") and "THEN 2" in order and "THEN 1" in order
    assert order.endswith("t.date_depot DESC NULLS LAST, t.id DESC")


def test_mots_exacts_avant_les_approches():
    fq = S.fuzzy_query(S.parse_query("dupond"), S.build_vocab([]), True)
    order = S.ticket_order_sql(fq, S.SqlParams())
    mots = S.ticket_exact_words_sql(fq, S.SqlParams())
    assert mots and "kp_word_match" not in mots and "public.kp_doc(coalesce(c.nom" in mots
    # le départage « écrit tel quel » précède la date, après le rang
    assert order.index("public.kp_doc(coalesce(c.nom") < order.index("t.date_depot DESC")
    assert order.index("THEN 2 ELSE 0 END) DESC") < order.index("public.kp_doc(coalesce(c.nom")
    assert "kp_word_match" not in order
    # Correction par le vocabulaire sans pg_trgm : même départage
    fq2 = S.fuzzy_query(S.parse_query("ipone"), S.build_vocab(["iPhone 13"]), False)
    assert fq2 and S.ticket_exact_words_sql(fq2, S.SqlParams())


def test_marques_et_gammes():
    assert "%pixel%" in S.parse_query("google").words[0].patterns
    assert "%galaxy%" in S.parse_query("samsung").words[0].patterns
    assert "%google%" not in S.parse_query("pixel").words[0].patterns


def test_label_sans_suffixe_global():
    fq = S.fuzzy_query(S.parse_query("dupond"), S.build_vocab([]), True)
    exact = {"client_nom": "Dupond", "client_prenom": "Léa", "marque": "Apple", "modele": "iPhone 13"}
    assert S.ticket_match_label(fq, exact) == "nom"
    approx = {"client_nom": "Dupont", "client_prenom": "Léa", "marque": "Apple", "modele": "iPhone 13"}
    assert S.ticket_match_label(fq, approx) == "approché"
    # Corrigé par le vocabulaire (« ipone » → iphone) : le champ est nommé, marqué approché
    fq2 = S.fuzzy_query(S.parse_query("ipone"), S.build_vocab(["iPhone 13"]), False)
    assert S.ticket_match_label(fq2, approx) == "modèle (approché)"
    assert S.ticket_match_label(fq2, {"client_nom": "Ipone", "modele": "Galaxy"}) == "nom"


def test_dashboard_tolere_les_fautes(client):
    cur, cm = _cursor()
    vocab = S.build_vocab(["iPhone 13", "Samsung"])
    with patch("app.api.tickets.get_cursor", cm), patch("app.api.search.fuzzy_context", return_value=(vocab, True)):
        r = client.get("/api/tickets/stats/dashboard", headers=_h(), params={"search": "ipone dupond"})
    assert r.status_code == 200
    sqls = [c.args for c in cur.execute.call_args_list]
    # seuil de similarité posé dans la transaction, avant la liste
    assert sqls[1][0].startswith("SELECT set_config('pg_trgm.word_similarity_threshold'")
    liste_sql, liste_params = sqls[2]
    assert "public.kp_word_match(" in liste_sql
    motifs = [v for v in liste_params.values() if isinstance(v, list)]
    assert any("%iphone%" in m for m in motifs)   # « ipone » corrigé par le vocabulaire
    # Sans pg_trgm ni correction possible : recherche stricte, pas de seuil
    cur, cm = _cursor()
    with patch("app.api.tickets.get_cursor", cm), patch("app.api.search.fuzzy_context", return_value=(frozenset(), False)):
        client.get("/api/tickets/stats/dashboard", headers=_h(), params={"search": "dupond"})
    assert not any("set_config" in c.args[0] for c in cur.execute.call_args_list)


def test_dashboard_colonnes_allegees(client):
    cur, cm = _cursor()
    with patch("app.api.tickets.get_cursor", cm), patch("app.api.search.fuzzy_context", return_value=(frozenset(), False)):
        client.get("/api/tickets/stats/dashboard", headers=_h(), params={"vue": "actifs"})
        sql_accueil = cur.execute.call_args_list[1].args[0]
        cur.execute.reset_mock()
        client.get("/api/tickets/stats/dashboard", headers={"Authorization": f"Bearer {create_token('tech', 'Marina')}"},
                   params={"vue": "actifs"})
        sql_tech = cur.execute.call_args_list[1].args[0]
        cur.execute.reset_mock()
        client.get("/api/tickets/stats/dashboard", headers=_h(), params={"vue": "a_recuperer"})
        sql_etagere = cur.execute.call_args_list[1].args[0]
    for sql in (sql_accueil, sql_tech):
        assert "t.*" not in sql and "t.historique" not in sql and "t.suivi_token" not in sql
        assert "t.notes_internes" not in sql and "t.msg_sms" not in sql
        assert "t.ticket_code" in sql and "t.emplacement" in sql and "t.tel_contact" in sql
    assert "t.pin" not in sql_accueil and "t.pin, t.pattern" in sql_tech
    assert "t.*" in sql_etagere


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
        cur.execute("DELETE FROM params WHERE cle IN (%s, %s)", (N.PARAM_JOURS, N.PARAM_DERNIERE))
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
            patch("app.services.nettoyage.get_cursor", ctx):
        yield


def _client(cur, nom, prenom="Fictif", tel="06 11 22 33 44"):
    cur.execute("INSERT INTO clients (nom, prenom, telephone) VALUES (%s, %s, %s) RETURNING id", (nom, prenom, tel))
    return cur.fetchone()["id"]


def _ticket(cur, client_id, statut, jours, marque="Testmarque", modele="Modèle", **extra):
    cols = {"client_id": client_id, "marque": marque, "modele": modele, "panne": "Écran", "statut": statut,
            "date_depot": datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=jours), **extra}
    cur.execute(f"INSERT INTO tickets ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))}) RETURNING id",
                list(cols.values()))
    tid = cur.fetchone()["id"]
    cur.execute("UPDATE tickets SET ticket_code = 'KP-' || lpad(id::text, 6, '0') WHERE id = %s", (tid,))
    return tid


def test_tri_automatique_reel(db):
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
    with _sur(cur):
        r = N.tri_automatique(date(2026, 11, 1))
    assert r["clotures"] == 3
    assert {s["statut"] for s in r["par_statut"]} == {"En cours de réparation", "Réparation terminée",
                                                       "En attente de pièce"}

    cur.execute("SELECT id, statut, emplacement, date_cloture, historique FROM tickets WHERE id = ANY(%s)",
                (list(ids.values()),))
    rows = {r["id"]: r for r in cur.fetchall()}
    for k in ("en_cours", "termine", "piece"):
        assert rows[ids[k]]["statut"] == "Clôturé" and rows[ids[k]]["date_cloture"] is None
    for k in ("pret", "recent"):
        assert rows[ids[k]]["statut"] == "En cours de réparation"
    assert rows[ids["termine"]]["emplacement"] is None
    assert rows[ids["termine"]]["historique"].startswith("ligne d'avant\n[")
    assert rows[ids["termine"]]["historique"].endswith(
        "] Statut: Réparation terminée → Clôturé (tri automatique : plus de 60 jours, emplacement B3 libéré)"
        " — par Tri automatique")

    cur.execute("SELECT ticket_id, contenu, auteur, type_note, is_read FROM notes_tickets WHERE ticket_id = ANY(%s)",
                (list(ids.values()),))
    notes = cur.fetchall()
    assert {n["ticket_id"] for n in notes} == {ids["en_cours"], ids["termine"], ids["piece"]}
    assert all(n["contenu"] == N.note(60) and n["auteur"] == "Tri automatique" and n["is_read"] for n in notes)
    cur.execute("SELECT valeur FROM params WHERE cle = %s", (N.PARAM_DERNIERE,))
    assert cur.fetchone()["valeur"] == "2026-11-01"
    cur.execute("SELECT details FROM admin_audit_log WHERE action = 'tickets_tri_auto' ORDER BY id DESC LIMIT 1")
    assert "3 dossier(s) de plus de 60 jours" in cur.fetchone()["details"]

    # Même jour : plus rien ; lendemain : le prêt dehors reste bloqué, rien à clôturer
    with _sur(cur):
        assert N.tri_automatique(date(2026, 11, 1)) is None
        assert N.tri_automatique(date(2026, 11, 2))["clotures"] == 0
    # Tri coupé par le paramètre
    cur.execute("INSERT INTO params (cle, valeur) VALUES (%s, '0')", (N.PARAM_JOURS,))
    _ticket(cur, cid, "En cours de réparation", 400)
    with _sur(cur):
        assert N.tri_automatique(date(2026, 11, 3)) is None


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


def test_recherche_fautes_reelle(db, client):
    cur = db
    c_exact = _client(cur, "Durant", "Ernestine")
    c_proche = _client(cur, "Durand", "Hippolyte")
    c_loin = _client(cur, "Tartempion", "Zoé")
    t = {
        # plus ancien mais écrit tel quel : doit passer devant l'approché plus récent
        "exact": _ticket(cur, c_exact, "En cours de réparation", 30, marque="Apple", modele="iPhone 13"),
        "proche": _ticket(cur, c_proche, "En cours de réparation", 2, marque="Samsung", modele="Galaxy S21"),
        "loin": _ticket(cur, c_loin, "Réparation terminée", 4, marque="Google", modele="Pixel 7"),
    }
    mine = lambda rows: [r["id"] for r in rows if r["id"] in t.values()]  # noqa: E731
    with _sur(cur):
        r = client.get("/api/tickets/stats/dashboard", params={"search": "durant"}, headers=_h())
        assert r.status_code == 200, r.text
        assert mine(r.json()["tickets"]) == [t["exact"], t["proche"]]
        r = client.get("/api/tickets/stats/dashboard", params={"search": "tartempoin"}, headers=_h())
        assert mine(r.json()["tickets"]) == [t["loin"]]
        r = client.get("/api/tickets/stats/dashboard", params={"search": "durand ipone"}, headers=_h())
        assert mine(r.json()["tickets"]) == [t["exact"]]
        r = client.get("/api/search", params={"q": "tartempoin", "limit": 8}, headers=_h())
        assert r.status_code == 200, r.text
        rows = {x["id"]: x for x in r.json()["groups"]["tickets"]}
        # « tartempoin » corrigé en Tartempion par le vocabulaire des noms de clients
        assert rows[t["loin"]]["match"] == "nom (approché)"
        r = client.get("/api/search", params={"q": "durant", "limit": 8}, headers=_h())
        rows = r.json()["groups"]["tickets"]
        assert mine(rows) == [t["exact"], t["proche"]]
        assert {x["id"]: x["match"] for x in rows if x["id"] in t.values()} == {t["exact"]: "nom", t["proche"]: "approché"}
