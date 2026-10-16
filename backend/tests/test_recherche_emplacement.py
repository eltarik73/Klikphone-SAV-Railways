"""Recherche par emplacement d'étagère (« B3 », « b3 », « Étagère 2 ») — app/services/search.py.

Tests unitaires sur l'analyse de la saisie et la construction SQL, puis tests réels
sur PostgreSQL quand KP_TEST_DATABASE_URL désigne une base migrée (schéma créé par
le démarrage de l'API) ; sans elle, ces derniers sont ignorés. Les données de test
sont fictives et écrites dans une transaction annulée à la fin de chaque test.
"""

import os
import re
from contextlib import contextmanager
from pathlib import Path
from datetime import datetime, timedelta
from unittest.mock import patch

import pytest

from app.services import etagere
from app.services import search as S

PLACEHOLDER = re.compile(r"%\((\w+)\)s")
BUILDERS = (S.ticket_where_sql, S.ticket_score_sql, S.ticket_order_sql, S.ticket_exact_sql)

# Requêtes dont le SQL ne doit pas bouger : code KP / # / préfixe / QR, IMEI, téléphones,
# code + mots.
SANS_EMPLACEMENT = (
    "KP-000123", "kp-123", "#123", "kp0012", "KP 000123",
    "https://klikphone.example/suivi?ticket=KP-000123",
    "356789104512346", "35 678910 451234 6",
    "0612345678", "06 12 34 56 78", "+33 6 12 34 56 78", "+41 79 123 45 67",
    "KP-000123 dupont", "_", "",
)


def _assert_sql_safe(sql, params):
    names = set(PLACEHOLDER.findall(sql))
    assert names <= set(params), names - set(params)
    assert "%" not in PLACEHOLDER.sub("", sql).replace("%%", "")


def _param_of(P, value):
    return next(k for k, v in P.values.items() if v == value)


FOLD = f"'{S._EMPL_ACCENTS}', '{S._EMPL_ASCII}'"


def _cond(alias, ph, replie=True):
    """Condition attendue : upper() = upper() (servie par idx_tickets_emplacement), plus le
    repli des accents quand des mots imposent déjà un parcours de tickets."""
    base = f"upper({alias}.emplacement) = upper(%({ph})s)"
    if not replie:
        return base
    return (f"({base} OR upper(translate({alias}.emplacement, {FOLD}))"
            f" = upper(translate(%({ph})s, {FOLD})))")


# ─── NORMALISATION DU TERME ──────────────────────────────────────
@pytest.mark.parametrize("raw, terme", [
    ("B3", "B3"), ("b3", "B3"), (" b3 ", "B3"), ("Étagère 2", "ÉTAGÈRE 2"),
    ("  étagère \t  2 ", "ÉTAGÈRE 2"), ("a", "A"), ("12", "12"), ("tiroir-1", "TIROIR-1"),
    ("x" * 20, "X" * 20),
])
def test_emplacement_terme(raw, terme):
    assert S.emplacement_terme(raw) == terme


@pytest.mark.parametrize("raw", ["", "   ", None, "_", "-", "...", "x" * 21, "b3\x00", "b\x073"])
def test_emplacement_terme_refuse(raw):
    assert S.emplacement_terme(raw) is None


def test_emplacement_terme_miroir_de_etagere():
    """Même forme que la valeur enregistrée par PUT /api/etagere/{id}/emplacement."""
    assert S.EMPLACEMENT_MAX == etagere.EMPLACEMENT_MAX
    for raw in ("b3", "Étagère  2", "  tiroir  bas ", "Straße 1", "c-12", "x" * 20):
        assert S.emplacement_terme(raw) == etagere.normaliser_emplacement(raw)


# ─── ANALYSE DE LA SAISIE ────────────────────────────────────────
@pytest.mark.parametrize("q, terme", [
    ("B3", "B3"), ("b3", "B3"), ("Étagère 2", "ÉTAGÈRE 2"), ("tiroir", "TIROIR"),
    ("12", "12"), ("jean dupont", "JEAN DUPONT"), ("F2LZ8XYZN72J", "F2LZ8XYZN72J"), ("a b", "A B"),
])
def test_parse_query_emplacement(q, terme):
    pq = S.parse_query(q)
    assert pq.emplacement == terme
    assert not pq.empty


@pytest.mark.parametrize("q", SANS_EMPLACEMENT)
def test_parse_query_sans_emplacement(q):
    assert S.parse_query(q).emplacement is None


def test_parse_query_logique_existante_intacte():
    """L'emplacement s'ajoute sans modifier code ticket, IMEI, téléphone ni mots."""
    pq = S.parse_query("12")
    assert (pq.ticket_id, pq.ticket_explicit, pq.numeric) == (12, False, True)
    assert [w.text for w in pq.words] == ["12"]
    pq = S.parse_query("Étagère 2")
    assert [w.text for w in pq.words] == ["etagere", "2"] and pq.ticket_id is None
    pq = S.parse_query("KP-000123 dupont")
    assert pq.code_and and pq.ticket_id == 123 and [w.text for w in pq.words] == ["dupont"]
    assert S.parse_query("0612345678").phone_key == "612345678"
    assert S.parse_query("356789104512346").imei == "356789104512346"


def test_parse_query_longueur_apres_reduction_des_espaces():
    # 21 caractères bruts, 20 une fois les espaces réduits
    assert S.parse_query("abcdefghij  klmnopqrs").emplacement == "ABCDEFGHIJ KLMNOPQRS"
    assert S.parse_query("abcdefghij klmnopqrst").emplacement is None


# ─── CONSTRUCTION SQL ────────────────────────────────────────────
def test_where_ajoute_emplacement_en_ou():
    pq = S.parse_query("b3")
    P = S.SqlParams()
    sql = S.ticket_where_sql(pq, P)
    ph = _param_of(P, "B3")
    assert _cond("t", ph) in sql
    # en OU avec les mots, jamais en ET
    assert _cond("t", ph) + " OR ((t.id IN (SELECT x.id FROM tickets x" in sql
    _assert_sql_safe(sql, P.values)


def test_where_alias_et_valeur_hostile_parametree():
    pq = S.parse_query("b3'); DROP--")
    assert pq.emplacement == "B3'); DROP--"
    P = S.SqlParams()
    sql = S.ticket_where_sql(pq, P, "tk", "ck")
    assert _cond("tk", _param_of(P, "B3'); DROP--")) in sql and "t.emplacement" not in sql.replace("tk.", "")
    assert "DROP" not in sql
    _assert_sql_safe(sql, P.values)


@pytest.mark.parametrize("q", ["B3", "Étagère 2", "12", "a b", "jean dupont", "F2LZ8XYZN72J"])
def test_builders_parametres_uniques(q):
    pq = S.parse_query(q)
    for builder in BUILDERS + (S.client_where_sql, S.devis_where_sql, S.commande_where_sql):
        P = S.SqlParams()
        sql = builder(pq, P)
        _assert_sql_safe(sql, P.values)
        assert len(set(PLACEHOLDER.findall(sql))) == len(P.values)


@pytest.mark.parametrize("q", SANS_EMPLACEMENT)
def test_sql_inchange_sans_emplacement(q):
    pq = S.parse_query(q)
    for builder in BUILDERS:
        assert "emplacement" not in builder(pq, S.SqlParams())
    assert "emplacement" not in S.matching_tickets_sql(pq, S.SqlParams())


def test_emplacement_hors_clients_devis_commandes():
    pq = S.parse_query("B3")
    for builder in (S.client_where_sql, S.client_score_sql, S.devis_where_sql, S.commande_where_sql):
        assert "emplacement" not in builder(pq, S.SqlParams())


def test_score_emplacement_apres_code_et_imei():
    assert 700 < S.EMPLACEMENT_SCORE < 800
    P = S.SqlParams()
    score = S.ticket_score_sql(S.parse_query("b3"), P)
    ph = _param_of(P, "B3")
    assert f"CASE WHEN {_cond('t', ph)} THEN {S.EMPLACEMENT_SCORE} ELSE 0 END" in score
    # pas une désignation exacte : le code ticket et l'IMEI gardent la tête
    assert "emplacement" not in S.ticket_exact_sql(S.parse_query("b3"), S.SqlParams())


def test_requete_sans_mot_mais_avec_emplacement():
    """« a b » : aucun mot gardé, l'emplacement seul fait la recherche (et le tri)."""
    pq = S.parse_query("a b")
    assert pq.words == []
    P = S.SqlParams()
    # sans mot : comparaison upper() seule, servie par l'index partiel
    assert S.ticket_where_sql(pq, P) == f"({_cond('t', _param_of(P, 'A B'), replie=False)})"
    assert S.ticket_where_sql(S.parse_query("_"), S.SqlParams()) == "FALSE"


def test_expression_de_l_index_main_py():
    """idx_tickets_emplacement (main.py) doit couvrir l'expression comparée, sinon « 7 » ou
    « a b » repassent en parcours séquentiel."""
    main_py = (Path(__file__).resolve().parents[1] / "app" / "main.py").read_text(encoding="utf-8")
    assert S.EMPLACEMENT_INDEX_EXPR == "upper(emplacement)"
    assert (f"ON tickets ({S.EMPLACEMENT_INDEX_EXPR}) WHERE emplacement IS NOT NULL") in main_py
    sql = S.ticket_where_sql(S.parse_query("a b"), S.SqlParams())
    assert S.EMPLACEMENT_INDEX_EXPR.replace("(emplacement)", "(t.emplacement)") + " = upper(%(" in sql


@pytest.mark.parametrize("q, replie", [
    ("b3", True), ("Étagère 2", True), ("tiroir", True), ("jean dupont", True), ("é", True),
    # sans lettre ou sans mot : pas de repli (rien à replier, ou index à garder)
    ("12", False), ("7", False), ("a b", False), ("à b", False),
])
def test_repli_des_accents_seulement_si_scan_deja_impose(q, replie):
    pq = S.parse_query(q)
    P = S.SqlParams()
    sql = S.ticket_where_sql(pq, P)
    assert ("translate(" in sql) is replie
    assert _cond("t", _param_of(P, pq.emplacement), replie=replie) in sql


def test_table_de_repli():
    assert len(S._EMPL_ACCENTS) == len(S._EMPL_ASCII) == len(set(S._EMPL_ACCENTS))
    # littéraux SQL figés : ni quote, ni %, ni accolade, ASCII seul à l'arrivée
    assert not set("%'{}\\") & set(S._EMPL_ACCENTS + S._EMPL_ASCII)
    assert S._EMPL_ASCII.isascii() and S._EMPL_ASCII.isalpha()
    for ch in "ÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸàâäçéèêëîïôöùûüÿ":
        assert ch in S._EMPL_ACCENTS


@pytest.mark.parametrize("a, b", [
    ("étagère 2", "ÉTAGÈRE 2"), ("ETAGERE 2", "Étagère 2"), ("b3", "B3"), ("réserve", "RESERVE"),
    ("Çà", "CA"),
])
def test_emplacement_cle_ignore_casse_et_accents(a, b):
    assert S.emplacement_cle(a) == S.emplacement_cle(b)


def test_emplacement_cle_distingue_les_emplacements():
    assert S.emplacement_cle("B3") != S.emplacement_cle("B 3")
    assert S.emplacement_cle("A1") != S.emplacement_cle("A11")


def test_fuzzy_garde_emplacement():
    fq = S.fuzzy_query(S.parse_query("tiroir"), S.build_vocab([]), True)
    assert fq is not None and fq.emplacement == "TIROIR"


# ─── EXPLICATION DE LA CORRESPONDANCE ────────────────────────────
ROW = {"id": 7, "ticket_code": "KP-000007", "client_nom": "Dupont", "client_prenom": "Jean",
       "client_tel": "06 12 34 56 78", "marque": "Apple", "modele": "iPhone 13", "imei": "356789104512346",
       "panne": "Écran cassé", "emplacement": "B3"}


def test_label_emplacement():
    assert S.ticket_match_label(S.parse_query("b3"), ROW) == "emplacement"
    assert S.ticket_match_label(S.parse_query(" B3 "), ROW) == "emplacement"
    assert S.ticket_match_label(S.parse_query("12"), {**ROW, "emplacement": "12"}) == "emplacement"
    # emplacement écrit hors API (minuscules) : même comparaison que upper() côté SQL
    assert S.ticket_match_label(S.parse_query("B3"), {**ROW, "emplacement": "b3"}) == "emplacement"
    # accents ignorés comme côté SQL
    assert S.ticket_match_label(S.parse_query("etagere 2"), {**ROW, "emplacement": "ÉTAGÈRE 2"}) == "emplacement"
    assert S.ticket_match_label(S.parse_query("RESERVE"), {**ROW, "emplacement": "réserve"}) == "emplacement"
    assert S.ticket_match_label(S.parse_query("e"), {**ROW, "emplacement": "É"}) == "emplacement, panne"
    # sans mot (« a b »), pas de repli : même règle que le SQL
    assert S.ticket_match_label(S.parse_query("a b"), {**ROW, "emplacement": "À B"}) == "recherche"
    assert S.ticket_match_label(S.parse_query("à b"), {**ROW, "emplacement": "À B"}) == "emplacement"
    # mot aussi trouvé dans un champ : les deux sont dits, jamais « note » par défaut
    assert S.ticket_match_label(S.parse_query("b3"), {**ROW, "modele": "Galaxy B3"}) == "emplacement, modèle"


def test_api_recherche_lit_et_renvoie_l_emplacement():
    """Sans t.emplacement dans le SELECT, un ticket trouvé par son emplacement serait dit « note »."""
    from app.api import search as api_search
    assert re.search(r"\bt\.emplacement\b", api_search._TICKET_SELECT)
    assert "emplacement" in api_search.TICKET_FIELDS
    # jamais les champs sensibles
    assert not {"pin", "pattern", "notes_internes"} & set(api_search.TICKET_FIELDS)


def test_label_inchange_hors_emplacement():
    row = {**ROW, "emplacement": None}
    assert S.ticket_match_label(S.parse_query("b3"), row) == "note"
    assert S.ticket_match_label(S.parse_query("dupont"), ROW) == "nom"
    assert S.ticket_match_label(S.parse_query("KP-000007"), ROW) == "code ticket"
    assert S.ticket_match_label(S.parse_query("356789104512346"), ROW) == "IMEI"
    assert S.ticket_match_label(S.parse_query("0612345678"), ROW) == "téléphone"


# ─── BASE RÉELLE (KP_TEST_DATABASE_URL) ──────────────────────────
DSN = os.environ.get("KP_TEST_DATABASE_URL")


def _imei(prefix14: str) -> str:
    """IMEI fictif valide (clé de Luhn calculée)."""
    for check in "0123456789":
        if S.luhn_ok(prefix14 + check):
            return prefix14 + check
    raise AssertionError("clé de Luhn introuvable")


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
        cur.execute(
            "SELECT EXISTS (SELECT 1 FROM information_schema.columns"
            " WHERE table_name = 'tickets' AND column_name = 'emplacement') AS col,"
            " to_regprocedure('public.kp_doc(text)') IS NOT NULL AS fn"
        )
        r = cur.fetchone()
        if not (r["col"] and r["fn"]):
            pytest.skip("base non migrée (démarrer l'API une fois sur cette base)")
        yield cur
    finally:
        conn.rollback()
        conn.close()


@pytest.fixture
def jeu(db):
    """Clients et tickets fictifs (annulés en fin de test)."""
    cur = db

    def client(nom, prenom, tel):
        cur.execute("INSERT INTO clients (nom, prenom, telephone) VALUES (%s, %s, %s) RETURNING id",
                    (nom, prenom, tel))
        return cur.fetchone()["id"]

    def ticket(client_id, modele, statut, depot, emplacement=None, imei=None):
        cur.execute(
            "INSERT INTO tickets (client_id, marque, modele, panne, statut, date_depot, emplacement, imei)"
            " VALUES (%s, 'Testmarque', %s, 'Écran', %s, %s, %s, %s) RETURNING id",
            (client_id, modele, statut, depot, emplacement, imei),
        )
        tid = cur.fetchone()["id"]
        cur.execute("UPDATE tickets SET ticket_code = 'KP-' || lpad(id::text, 6, '0') WHERE id = %s", (tid,))
        return tid

    now = datetime.now()
    c1 = client("Zorglubtest", "Ernestine", "06 99 88 77 66")
    c2 = client("Zorglubtest", "Hippolyte", "+41 79 555 44 33")
    ids = {
        # rangé en Q7, déposé il y a longtemps
        "range": ticket(c1, "iPhone 13", "Réparation terminée", now - timedelta(days=30), "Q7",
                        _imei("35678910451299")),
        # « q7 » seulement dans le modèle, plus récent : doit passer après l'emplacement
        "modele": ticket(c2, "Galaxy Q7", "Réparation terminée", now - timedelta(days=1)),
        # écrit hors API, en minuscules
        "minuscules": ticket(c2, "Pixel 7", "En cours de réparation", now - timedelta(days=20), "q7"),
        "etagere": ticket(c1, "Redmi Note 10", "Réparation terminée", now - timedelta(days=10), "ÉTAGÈRE ZQ"),
        # écrit hors API, minuscules accentuées
        "reserve": ticket(c2, "Moto G9", "Réparation terminée", now - timedelta(days=5), "réservezq"),
        "archive": ticket(c1, "P30 Pro", "Clôturé", now - timedelta(days=60)),
    }
    imei = _imei("35678910451299")
    return cur, ids, imei


def _ids_globaux(cur, q, limit=25):
    from app.api import search as api_search
    rows, _total = api_search._search_tickets(cur, S.parse_query(q), limit)
    return [r["id"] for r in rows]


def _ids_dashboard(cur, q, limit=200):
    """Même assemblage que GET /api/tickets/stats/dashboard?search=…"""
    pq = S.parse_query(q)
    P = S.SqlParams()
    where = S.ticket_where_sql(pq, P)
    order = S.ticket_order_sql(pq, P) if not pq.empty else "t.date_depot DESC, t.id DESC"
    cur.execute("SELECT t.id FROM tickets t JOIN clients c ON t.client_id = c.id WHERE " + where
                + " ORDER BY " + order + " LIMIT %(limit)s", {**P.values, "limit": limit})
    return [r["id"] for r in cur.fetchall()]


def _mine(found, ids):
    mine = set(ids.values())
    return [i for i in found if i in mine]


@pytest.mark.parametrize("q", ["Q7", "q7", " q7 "])
def test_reel_emplacement_trouve_en_tete(jeu, q):
    cur, ids, _ = jeu
    for found in (_ids_globaux(cur, q), _ids_dashboard(cur, q)):
        mine = _mine(found, ids)
        assert set(mine) == {ids["range"], ids["minuscules"], ids["modele"]}
        # l'emplacement passe avant le simple mot du modèle, pourtant plus récent
        assert mine.index(ids["modele"]) == 2


@pytest.mark.parametrize("q", ["Étagère ZQ", "étagère   zq", "ÉTAGÈRE ZQ", "etagere zq", "ETAGERE ZQ"])
def test_reel_emplacement_avec_espace_et_accent(jeu, q):
    cur, ids, _ = jeu
    assert ids["etagere"] in _ids_globaux(cur, q)
    assert ids["etagere"] in _ids_dashboard(cur, q)


@pytest.mark.parametrize("q", ["RESERVEZQ", "réservezq", "Reservezq"])
def test_reel_emplacement_accentue_ecrit_hors_api(jeu, q):
    cur, ids, _ = jeu
    for found in (_ids_globaux(cur, q), _ids_dashboard(cur, q)):
        assert _mine(found, ids) == [ids["reserve"]]


def test_reel_index_emplacement_utilisable(jeu):
    """Sans mot (« a b »), la condition doit pouvoir passer par idx_tickets_emplacement."""
    cur, _ids, _ = jeu
    cur.execute("SELECT 1 FROM pg_indexes WHERE indexname = 'idx_tickets_emplacement'")
    if not cur.fetchone():
        pytest.skip("idx_tickets_emplacement absent (démarrer l'API une fois sur cette base)")
    pq = S.parse_query("a b")
    P = S.SqlParams()
    where = S.ticket_where_sql(pq, P)
    cur.execute("SET LOCAL enable_seqscan = off")
    cur.execute("EXPLAIN (FORMAT JSON) SELECT t.id FROM tickets t JOIN clients c ON c.id = t.client_id"
                " WHERE " + where, P.values)
    plan = str(cur.fetchone()["QUERY PLAN"])
    cur.execute("SET LOCAL enable_seqscan = on")
    assert "idx_tickets_emplacement" in plan


def test_reel_label_emplacement(jeu):
    cur, ids, _ = jeu
    cur.execute("SELECT t.*, c.nom AS client_nom, c.prenom AS client_prenom, c.telephone AS client_tel"
                " FROM tickets t JOIN clients c ON c.id = t.client_id WHERE t.id = %s", (ids["range"],))
    assert S.ticket_match_label(S.parse_query("q7"), dict(cur.fetchone())) == "emplacement"


def test_reel_requetes_existantes_inchangees(jeu):
    cur, ids, imei = jeu
    code = f"KP-{ids['range']:06d}"
    for q in (code, f"#{ids['range']}"):
        assert _ids_globaux(cur, q) == [ids["range"]]
        assert _ids_dashboard(cur, q) == [ids["range"]]
    assert _ids_globaux(cur, imei)[0] == ids["range"]
    assert _ids_dashboard(cur, imei)[0] == ids["range"]
    c1_tickets = {ids["range"], ids["etagere"], ids["archive"]}
    for q in ("06 99 88 77 66", "0699887766", "+33 6 99 88 77 66"):
        assert set(_mine(_ids_globaux(cur, q), ids)) == c1_tickets
    assert set(_mine(_ids_globaux(cur, "+41 79 555 44 33"), ids)) == {ids["modele"], ids["minuscules"], ids["reserve"]}
    assert set(_mine(_ids_dashboard(cur, "zorglubtest ernestine"), ids)) == c1_tickets
    assert set(_mine(_ids_dashboard(cur, "zorglubtest"), ids)) == set(ids.values())


@contextmanager
def _routes_sur(cur):
    @contextmanager
    def ctx(*_a, **_k):
        yield cur
    with patch("app.api.search.get_cursor", ctx), patch("app.api.tickets.get_cursor", ctx):
        yield


def test_reel_routes_recherche_et_dashboard(jeu, client, auth_headers):
    cur, ids, _ = jeu
    with _routes_sur(cur):
        r = client.get("/api/search", params={"q": "q7", "limit": 25}, headers=auth_headers)
        assert r.status_code == 200, r.text
        rows = {t["id"]: t for t in r.json()["groups"]["tickets"]}
        found = list(rows)
        assert _mine(found, ids)[-1] == ids["modele"] and ids["range"] in found
        assert r.json()["resolved"] is None
        # le libellé dit pourquoi le ticket est trouvé, et l'emplacement est renvoyé
        assert rows[ids["range"]]["match"] == "emplacement"
        assert rows[ids["range"]]["emplacement"] == "Q7"
        assert rows[ids["minuscules"]]["match"] == "emplacement"
        assert rows[ids["modele"]]["match"] == "modèle"

        r = client.get("/api/search", params={"q": "etagere zq", "limit": 25}, headers=auth_headers)
        assert r.status_code == 200, r.text
        rows = {t["id"]: t for t in r.json()["groups"]["tickets"]}
        assert rows[ids["etagere"]]["match"] == "emplacement"

        r = client.get("/api/tickets/stats/dashboard", params={"search": "Q7"}, headers=auth_headers)
        assert r.status_code == 200, r.text
        found = [t["id"] for t in r.json()["tickets"]]
        assert set(_mine(found, ids)) == {ids["range"], ids["minuscules"], ids["modele"]}
        emplacements = {t["id"]: t.get("emplacement") for t in r.json()["tickets"]}
        assert emplacements[ids["range"]] == "Q7"
