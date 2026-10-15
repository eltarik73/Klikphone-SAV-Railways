"""Tests du moteur de recherche staff (app/services/search.py) et des routes associées."""

import re
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest

from app.services import search as S

PLACEHOLDER = re.compile(r"%\((\w+)\)s")
HOSTILE = "x'); DROP TABLE clients;--"


def _assert_sql_safe(sql, params):
    """Placeholders tous fournis, aucun % nu (psycopg2) et aucune valeur saisie dans le texte."""
    names = set(PLACEHOLDER.findall(sql))
    assert names <= set(params), names - set(params)
    assert "%" not in PLACEHOLDER.sub("", sql).replace("%%", "")
    assert "DROP TABLE" not in sql


# ─── ANALYSE DE LA SAISIE ────────────────────────────────────────
@pytest.mark.parametrize("q", ["06 12 34 56 78", "0612345678", "06.12.34.56.78", "+33612345678",
                               "+33 6 12 34 56 78", "0033 6 12 34 56 78", "612345678", "06-12-34-56-78"])
def test_parse_phone_formats_same_key(q):
    pq = S.parse_query(q)
    assert pq.phone_key == "612345678"
    assert pq.ticket_id is None and pq.imei is None
    assert "0612345678" in pq.phone_full


@pytest.mark.parametrize("q", ["56 78", "5678"])
def test_parse_last_four_digits(q):
    pq = S.parse_query(q)
    assert pq.phone_key is None
    assert pq.words[0].phone == ["%5678"]
    # nombre nu : candidat ticket, jamais désignation explicite
    assert pq.ticket_id == 5678 and not pq.ticket_explicit


@pytest.mark.parametrize("q, tid", [
    ("KP-000123", 123), ("KP-123", 123), ("kp123", 123), ("kp 000123", 123), ("#123", 123),
    ("000123", 123), ("https://klikphone.fr/suivi?ticket=KP-002301", 2301),
    ("https://klikphone.fr/suivi?ticket=KP-002301&x=1", 2301),
])
def test_parse_explicit_ticket_codes(q, tid):
    pq = S.parse_query(q)
    assert pq.ticket_id == tid and pq.ticket_explicit
    assert pq.ticket_code == f"KP-{tid:06d}"


@pytest.mark.parametrize("q", ["123", "2301"])
def test_parse_bare_number_not_explicit(q):
    pq = S.parse_query(q)
    assert pq.ticket_id == int(q) and not pq.ticket_explicit


def test_parse_partial_code_prefix():
    pq = S.parse_query("kp0012")
    assert pq.code_prefix == "KP-0012%" and not pq.ticket_explicit


def test_parse_phone_start_is_not_ticket():
    assert S.parse_ticket_ref("061234") is not None
    assert not S.parse_ticket_ref("061234").explicit
    assert S.parse_ticket_ref("0612345678") is None


@pytest.mark.parametrize("q", ["356789104512346", "35 678910 451234 6", "35-678910-451234-6"])
def test_parse_imei(q):
    pq = S.parse_query(q)
    assert pq.imei == "356789104512346"
    assert pq.phone_key is None and pq.ticket_id is None


def test_parse_serial_number():
    assert S.parse_query("F2LZ8XYZN72J").imei == "f2lz8xyzn72j"
    assert S.serial_number("iPhone13") is None
    assert S.serial_number("dupont iphone") is None


@pytest.mark.parametrize("q, tid, explicit, prefix, words", [
    ("KP-000123 dupont", 123, True, None, ["dupont"]),
    ("dupont kp123", 123, True, None, ["dupont"]),
    ("#12 iphone", 12, True, None, ["iphone"]),
    ("KP-0001 dupont", 1, False, "KP-0001%", ["dupont"]),
])
def test_parse_code_with_other_words(q, tid, explicit, prefix, words):
    pq = S.parse_query(q)
    assert pq.code_and and pq.ticket_id == tid and pq.ticket_explicit == explicit
    assert pq.code_prefix == prefix and [w.text for w in pq.words] == words


def test_parse_code_alone_or_ambiguous_is_not_code_and():
    assert not S.parse_query("KP-000123").code_and
    pq = S.parse_query("KP-1 KP-2 dupont")
    assert not pq.code_and and pq.ticket_id is None


def test_parse_accents_and_words():
    assert [w.text for w in S.parse_query("Hélène").words] == ["helene"]
    assert [w.text for w in S.parse_query("dupont iphone 13").words] == ["dupont", "iphone", "13"]
    assert [w.text for w in S.parse_query("Mairie de Chambéry").words] == ["mairie", "chambery"]
    assert [w.text for w in S.parse_query("l'écran").words] == ["ecran"]
    assert [w.text for w in S.parse_query("Œuvre Mœller").words] == ["oeuvre", "moeller"]


def test_parse_short_tokens():
    words = S.parse_query("iphone 8").words
    assert [w.text for w in words] == ["iphone", "8"]
    assert words[1].patterns == ["% 8 %"]
    assert S.parse_query("j").words[0].patterns == ["% j%"]
    assert S.parse_query("_").empty
    assert S.parse_query("").empty


def test_parse_numeric_word_whole_match():
    w = S.parse_query("dupont 13").words[1]
    assert w.patterns == ["% 13 %"] and w.phone == [] and w.imei == []


def test_parse_merges_phone_inside_text():
    words = S.parse_query("dupont 06 12 34 56 78").words
    assert [w.text for w in words] == ["dupont", "0612345678"]
    assert words[1].phone == ["%612345678%"]


def test_parse_max_words_and_length():
    pq = S.parse_query(" ".join(f"mot{i}" for i in range(20)))
    assert len(pq.words) == S.MAX_WORDS
    assert len(S.parse_query("a" * 400).q) <= S.MAX_QUERY_LEN


def test_synonyms():
    pats = S.parse_query("ecran").words[0].patterns
    assert "%lcd%" in pats and "%oled%" in pats


def test_descramble_azerty_scan():
    assert S.descramble_scan("KP)àààé&") == "KP-00021"
    assert S.descramble_scan("Hélène") == "Hélène"
    assert S.parse_query("KP)àààé&").ticket_id == 21


# ─── NORMALISATION ───────────────────────────────────────────────
def test_esc_like_and_like_match():
    assert S.esc_like("50%_x\\") == "50\\%\\_x\\\\"
    assert S.like_match("%" + S.esc_like("50%") + "%", "promo 50% ok")
    assert not S.like_match("%" + S.esc_like("50%") + "%", "promo 500 ok")
    assert S.like_match("% 13 %", " iphone 13 pro ")
    assert not S.like_match("% 13 %", " kp 000130 ")


def test_normalize_text_mirrors_kp_doc():
    assert S.normalize_text("Écran — iPhone 13, «Pro»") == "ecran iphone 13 pro"
    assert S.doc_text("Dupont", "Jean") == " dupont jean "


@pytest.mark.parametrize("raw, stored", [
    ("06 12 34 56 78", "0612345678"), ("06.12.34.56.78", "0612345678"),
    ("+33 6 12 34 56 78", "0612345678"), ("0033612345678", "0612345678"),
    ("+33 (0)6 12 34 56 78", "0612345678"), ("612345678", "0612345678"),
    ("+41 79 123 45 67", "+41791234567"), ("0041 79 123 45 67", "+41791234567"),
    ("06", "06"), ("abc 12", "abc 12"), (None, None),
])
def test_phone_canonical(raw, stored):
    assert S.phone_canonical(raw) == stored


def test_same_phone_excludes_foreign_collision():
    assert S.same_phone("06 12 34 56 78", "+33612345678")
    assert S.phone_key("+41 6 12 34 56 78") == S.phone_key("0612345678")
    assert not S.same_phone("+41 6 12 34 56 78", "0612345678")
    assert not S.same_phone("06", "06")


def test_same_phone_international_prefixes():
    assert S.same_phone("0041 79 123 45 67", "+41 79 123 45 67")
    assert S.same_phone("0033 6 12 34 56 78", "+33 (0)6 12 34 56 78")
    # Choix assumé : le format national suisse se lit comme un 07 français
    assert not S.same_phone("079 123 45 67", "+41 79 123 45 67")


@pytest.mark.parametrize("q, stored", [
    ("0612345678", ["0612345678", "33612345678", "0033612345678", "330612345678", "612345678"]),
    ("+41 79 123 45 67", ["41791234567", "0041791234567"]),
    ("0041 79 123 45 67", ["41791234567", "0041791234567"]),
])
def test_phone_full_variants(q, stored):
    assert set(stored) <= set(S.phone_full_variants(q))
    assert "41612345678" not in S.phone_full_variants("0612345678")


def test_luhn_and_imei():
    assert S.luhn_ok("490154203237518")
    assert not S.luhn_ok("490154203237519")
    assert S.is_imei("49 015420 323751 8")
    assert not S.is_imei("4901542032375")
    assert not S.is_imei("490154203237519")


# ─── FAUTES DE FRAPPE ────────────────────────────────────────────
def test_correct_word():
    vocab = S.build_vocab(["Samsung", "iPhone 13", "Xiaomi", "Batterie"])
    assert S.correct_word("iphnoe", vocab) == "iphone"
    assert S.correct_word("samsumg", vocab) == "samsung"
    assert S.correct_word("xiomi", vocab) == "xiaomi"
    assert S.correct_word("iphone", vocab) is None
    assert S.correct_word("iph", vocab) is None
    assert S.correct_word("ipho", vocab) is None  # début d'un mot connu


def test_fuzzy_query_skips_numeric():
    vocab = S.build_vocab([])
    assert S.fuzzy_query(S.parse_query("0612345678"), vocab, True) is None
    fq = S.fuzzy_query(S.parse_query("dupont iphnoe"), vocab, False)
    assert fq.fuzzy and "%iphone%" in fq.words[1].patterns


def test_fuzzy_query_keeps_ticket_code():
    fq = S.fuzzy_query(S.parse_query("KP-000123 dupond"), S.build_vocab([]), True)
    assert fq.code_and and fq.ticket_id == 123 and fq.ticket_explicit


def test_fuzzy_trgm_uses_indexable_operator():
    fq = S.fuzzy_query(S.parse_query("dupond"), S.build_vocab([]), True)
    sql = S.ticket_where_sql(fq, S.SqlParams())
    assert "public.kp_word_match(" in sql and "kp_word_sim" not in sql
    # mêmes expressions que les index GIN (idx_tickets_panne_trgm_v1, idx_clients_doc_trgm_v1)
    assert "public.kp_doc(coalesce(x.panne, ''))" in sql
    assert "public.kp_word_match(" in S.client_where_sql(fq, S.SqlParams())


# ─── CONSTRUCTEURS SQL ───────────────────────────────────────────
@pytest.mark.parametrize("q", [
    "jean dupont", "0612345678", "5678", "KP-000123", "356789104512346", "F2LZ8XYZN72J",
    "50%_x", HOSTILE, "kp0012", "iphone 8", "ecran", "KP-000123 dupont", "KP-0001 " + HOSTILE,
    "+41 79 123 45 67",
])
def test_builders_are_parameterized(q):
    pq = S.parse_query(q)
    for builder in (S.ticket_where_sql, S.ticket_score_sql, S.ticket_order_sql,
                    S.client_where_sql, S.client_score_sql, S.devis_where_sql, S.commande_where_sql):
        P = S.SqlParams()
        sql = builder(pq, P)
        _assert_sql_safe(sql, P.values)
        assert len(set(PLACEHOLDER.findall(sql))) == len(P.values)
    fq = S.fuzzy_query(pq, S.build_vocab([]), True)
    if fq:
        P = S.SqlParams()
        _assert_sql_safe(S.ticket_where_sql(fq, P), P.values)


def test_one_block_per_word():
    pq = S.parse_query("dupont iphone 13")
    sql = S.ticket_where_sql(pq, S.SqlParams())
    assert sql.count("SELECT x.id FROM tickets x") == 3
    assert " AND " in sql


def test_code_and_requires_code_and_words():
    pq = S.parse_query("KP-000123 dupont")
    P = S.SqlParams()
    sql = S.ticket_where_sql(pq, P)
    assert sql.startswith("(((t.id = ") and ") AND ((t.id IN (SELECT x.id" in sql
    assert 123 in P.values.values() and "KP-000123" in P.values.values()
    sub = "(SELECT tk.{} FROM tickets tk JOIN clients ck ON ck.id = tk.client_id"
    assert S.client_where_sql(pq, S.SqlParams(), with_tickets=True).startswith("c.id IN " + sub.format("client_id"))
    assert S.devis_where_sql(pq, S.SqlParams()).startswith("d.ticket_id IN " + sub.format("id"))
    assert S.commande_where_sql(pq, S.SqlParams()).startswith("cp.ticket_id IN " + sub.format("id"))
    # fiche clients (clients.py) : code effacé, seuls les mots restent
    pq.ticket_id = pq.code_prefix = None
    assert "tk." not in S.client_where_sql(pq, S.SqlParams())


def test_phone_homonyms_excluded_when_exact_number_exists():
    P = S.SqlParams()
    sql = S.ticket_where_sql(S.parse_query("06 12 34 56 78"), P)
    assert "(t.client_id IS NULL OR t.client_id NOT IN (SELECT z.id FROM clients z" in sql
    # aucun kp_phone_key(c.telephone) évalué ligne à ligne sur la jointure
    assert "kp_phone_key(c.telephone)" not in sql
    assert {"0033612345678", "0612345678", "00330612345678", "330612345678", "33612345678",
            "612345678"} == set(next(v for v in P.values.values() if isinstance(v, list) and "612345678" in v))
    assert "c.id NOT IN (SELECT z.id" in S.client_where_sql(S.parse_query("0612345678"), S.SqlParams())
    for q in ("5678", "jean dupont", "KP-000123"):
        assert "clients z" not in S.ticket_where_sql(S.parse_query(q), S.SqlParams())


def test_empty_query_matches_nothing():
    P = S.SqlParams()
    assert S.ticket_where_sql(S.parse_query("_"), P) == "FALSE"
    assert S.client_where_sql(S.parse_query("_"), P) == "FALSE"


def test_order_never_starts_with_constant():
    for q in ("jean dupont", "5678", "KP-123"):
        order = S.ticket_order_sql(S.parse_query(q), S.SqlParams())
        assert not order.startswith("FALSE")
    assert S.client_score_sql(S.parse_query("_"), S.SqlParams()) == "(0::int)"


def test_match_label():
    row = {"id": 1, "ticket_code": "KP-000001", "client_nom": "Dupont", "client_prenom": "Jean",
           "client_tel": "06 12 34 56 78", "marque": "Apple", "modele": "iPhone 13", "imei": "356789104512346",
           "panne": "Écran cassé", "notes_internes": "nappe abîmée"}
    assert S.ticket_match_label(S.parse_query("jean dupont"), row) == "prénom, nom"
    assert S.ticket_match_label(S.parse_query("dupont iphone 13"), row) == "nom, modèle"
    assert S.ticket_match_label(S.parse_query("0612345678"), row) == "téléphone"
    assert S.ticket_match_label(S.parse_query("356789104512346"), row) == "IMEI"
    assert S.ticket_match_label(S.parse_query("KP-000001"), row) == "code ticket"
    assert S.ticket_match_label(S.parse_query("ecran"), row) == "panne"
    assert S.ticket_match_label(S.parse_query("nappe"), row) == "note interne"
    assert S.ticket_match_label(S.parse_query("iphone13"), row) == "modèle"
    assert S.ticket_match_label(S.parse_query("KP-000001 dupont"), row) == "code ticket, nom"


# ─── ROUTES ──────────────────────────────────────────────────────
def _cursor(fetchone=None, fetchall=None):
    cur = MagicMock()
    cur.fetchone.return_value = fetchone
    cur.fetchall.return_value = fetchall or []

    @contextmanager
    def cm():
        yield cur
    return cur, cm


def test_search_requires_auth(client):
    assert client.get("/api/search?q=dupont").status_code == 401
    assert client.get("/api/search/resolve?code=123").status_code == 401


def test_search_shape(client, auth_headers):
    cur, cm = _cursor()
    with patch("app.api.search.get_cursor", cm):
        r = client.get("/api/search", params={"q": "jean dupont 06 12"}, headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["q"] == "jean dupont 06 12" and body["resolved"] is None
    assert set(body["groups"]) == {"tickets", "clients", "devis", "commandes"}
    for call in cur.execute.call_args_list:
        sql, params = (call.args + (None,))[:2]
        if params:
            _assert_sql_safe(sql, params)


def test_search_resolved_ticket(client, auth_headers):
    row = {"id": 123, "ticket_code": "KP-000123", "statut": "Clôturé", "client_id": 4, "client_nom": "Martin",
           "client_prenom": "Sophie", "client_tel": "0711223344", "imei": "", "telephone_pret_imei": "",
           "date_depot": None, "_total": 1, "pin": "0000"}
    cur, cm = _cursor(fetchall=[row])
    with patch("app.api.search.get_cursor", cm):
        r = client.get("/api/search", params={"q": "KP-123"}, headers=auth_headers)
    body = r.json()
    assert body["resolved"] == {"type": "ticket", "id": 123, "ticket_code": "KP-000123"}
    ticket = body["groups"]["tickets"][0]
    assert ticket["match"] == "code ticket"
    assert "pin" not in ticket and "_total" not in ticket


def test_search_limit_bounds(client, auth_headers):
    assert client.get("/api/search?q=a&limit=26", headers=auth_headers).status_code == 422
    assert client.get("/api/search?q=", headers=auth_headers).status_code == 422


def test_resolve_found(client, auth_headers):
    cur, cm = _cursor(fetchone={"id": 123, "ticket_code": "KP-000123"})
    with patch("app.api.search.get_cursor", cm):
        r = client.get("/api/search/resolve",
                       params={"code": "https://x.fr/suivi?ticket=KP-000123"}, headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == {"type": "ticket", "id": 123, "ticket_code": "KP-000123"}
    assert cur.execute.call_args.args[1] == ("KP-000123", 123, "KP-000123")


def test_resolve_imei_and_404(client, auth_headers):
    cur, cm = _cursor(fetchone=None)
    with patch("app.api.search.get_cursor", cm):
        r = client.get("/api/search/resolve", params={"code": "490154203237518"}, headers=auth_headers)
    assert r.status_code == 404
    assert r.json()["detail"] == "Aucun ticket ne correspond"
    # IMEI de l'appareil puis IMEI du téléphone de prêt
    assert [c.args[1] for c in cur.execute.call_args_list] == [("490154203237518",)] * 2
    cur, cm = _cursor(fetchone=None)
    with patch("app.api.search.get_cursor", cm):
        r = client.get("/api/search/resolve", params={"code": "0612345678"}, headers=auth_headers)
    assert r.status_code == 404 and cur.execute.call_count == 0


def test_dashboard_filters(client, auth_headers):
    cur, cm = _cursor(fetchone=None, fetchall=[])
    with patch("app.api.tickets.get_cursor", cm):
        r = client.get("/api/tickets/stats/dashboard", headers=auth_headers, params={
            "search": "dupont 06 12", "date_from": "2026-10-01", "date_to": "2026-10-15",
            "tech": "Marina", "vue": "actifs", "offset": 25, "limit": 25,
        })
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"kpi", "tickets", "total"} and body["total"] == 0
    list_sql, list_params = cur.execute.call_args_list[1].args
    _assert_sql_safe(list_sql, list_params)
    assert list_params["limit"] == 25 and list_params["offset"] == 25
    assert "Marina" in list_params.values() and "2026-10-01" in list_params.values()


def test_dashboard_total_without_extra_count(client, auth_headers):
    rows = [{"id": 1, "ticket_code": "KP-000001"}, {"id": 2, "ticket_code": "KP-000002"}]
    cur, cm = _cursor(fetchone=None, fetchall=rows)
    with patch("app.api.tickets.get_cursor", cm):
        r = client.get("/api/tickets/stats/dashboard", headers=auth_headers, params={"limit": 25})
    assert r.json()["total"] == 2 and cur.execute.call_count == 2
    assert all("OVER ()" not in c.args[0] for c in cur.execute.call_args_list)


def test_dashboard_total_counts_when_page_is_full(client, auth_headers):
    rows = [{"id": 1, "ticket_code": "KP-000001"}, {"id": 2, "ticket_code": "KP-000002"}]
    cur, cm = _cursor(fetchall=rows)
    cur.fetchone.side_effect = [None, {"n": 57}]
    with patch("app.api.tickets.get_cursor", cm):
        r = client.get("/api/tickets/stats/dashboard", headers=auth_headers,
                       params={"limit": 2, "search": "dupont"})
    assert r.json()["total"] == 57
    count_sql, count_params = cur.execute.call_args_list[2].args
    assert count_sql.lstrip().startswith("SELECT COUNT(*)")
    _assert_sql_safe(count_sql, count_params)


def test_kpi_compares_date_cloture_as_text(client, auth_headers):
    cur, cm = _cursor(fetchone=None)
    with patch("app.api.tickets.get_cursor", cm):
        r = client.get("/api/tickets/stats/kpi", headers=auth_headers)
    assert r.status_code == 200
    sql, params = cur.execute.call_args.args
    assert "date_cloture::" not in sql and "date_cloture LIKE %s" in sql
    assert params[0].endswith("%")


def test_ticket_list_tolerates_text_date_cloture():
    from app.models import TicketFull
    assert TicketFull(id=1, date_cloture="pas une date").date_cloture is None
    assert TicketFull(id=1, date_cloture="").date_cloture is None
    assert TicketFull(id=1, date_cloture="2026-10-15 10:30:00").date_cloture.day == 15


@pytest.mark.parametrize("params", [{"vue": "autre"}, {"date_from": "2026-13-01"}, {"date_to": "15/10/2026"},
                                    {"offset": -1}])
def test_dashboard_rejects_bad_filters(client, auth_headers, params):
    assert client.get("/api/tickets/stats/dashboard", params=params, headers=auth_headers).status_code == 422


def test_public_phone_requires_full_number(client):
    assert client.get("/api/tickets/phone/06").status_code == 400
    assert client.get("/api/tickets/phone/0").status_code == 400
    assert client.get("/api/tickets/phone/06 12 34 56 78").status_code == 200


def test_client_model_normalizes_phone():
    from app.models import ClientCreate, ClientUpdate
    assert ClientCreate(nom="Dupont", telephone="+33 6 12 34 56 78").telephone == "0612345678"
    assert ClientUpdate(telephone="06.12.34.56.78").telephone == "0612345678"
    assert ClientUpdate().telephone is None
