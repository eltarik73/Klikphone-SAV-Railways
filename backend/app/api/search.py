"""
API recherche staff unifiée (tickets, clients, devis, commandes de pièces).

GET /api/search          → résultats groupés et classés
GET /api/search/resolve  → ticket désigné par un scan (QR, code, IMEI)
"""

import logging
import re
import threading
import time
from datetime import datetime
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Query

from app.database import get_cursor
from app.api.auth import get_current_user
from app.services import search as S

router = APIRouter(prefix="/api/search", tags=["search"])
logger = logging.getLogger("klikphone.search")

TICKET_FIELDS = (
    "id", "ticket_code", "statut", "client_id", "client_nom", "client_prenom", "client_tel",
    "marque", "modele", "modele_autre", "panne", "imei", "date_depot", "technicien_assigne", "paye",
    "emplacement", "tel_contact",
)
CLIENT_FIELDS = (
    "id", "nom", "prenom", "telephone", "email", "societe",
    "nb_tickets", "dernier_ticket_id", "dernier_statut",
)

# Colonnes lues pour expliquer la correspondance ; seules TICKET_FIELDS sont renvoyées
# (jamais pin / pattern, ni le texte des notes internes).
_TICKET_SELECT = """
    t.id, t.ticket_code, t.statut, t.client_id,
    c.nom AS client_nom, c.prenom AS client_prenom, c.telephone AS client_tel,
    c.societe AS client_societe, c.email AS client_email,
    t.marque, t.modele, t.modele_autre, t.categorie, t.imei, t.date_depot,
    t.technicien_assigne, t.paye, t.telephone_pret, t.telephone_pret_imei, t.emplacement,
    t.tel_contact,
    t.panne, t.panne_detail, t.reparation_supp, t.type_ecran, t.notes_internes,
    t.notes_client, t.commentaire_client, t.attention
"""

_FUZZY_TTL = 600
_fuzzy_cache = {"at": 0.0, "vocab": None, "trgm": False}
_fuzzy_lock = threading.Lock()


def _savepoint(cur, label, fn, default):
    """Exécute fn() sans compromettre la transaction en cas d'échec."""
    cur.execute("SAVEPOINT kp_search")
    try:
        result = fn()
        cur.execute("RELEASE SAVEPOINT kp_search")
        return result
    except Exception:
        cur.execute("ROLLBACK TO SAVEPOINT kp_search")
        logger.exception("Recherche %s indisponible", label)
        return default


def _fuzzy_context(cur):
    """Vocabulaire marques / modèles / pannes et présence de pg_trgm (cache 10 min)."""
    with _fuzzy_lock:
        if _fuzzy_cache["vocab"] is not None and time.monotonic() - _fuzzy_cache["at"] < _FUZZY_TTL:
            return _fuzzy_cache["vocab"], _fuzzy_cache["trgm"]

    def load():
        cur.execute("""
            SELECT marque AS v FROM catalog_marques
            UNION SELECT modele FROM catalog_modeles
            UNION SELECT terme FROM autocompletion WHERE length(terme) <= 60
        """)
        return [r["v"] for r in (cur.fetchall() or [])]

    def has_trgm():
        # kp_word_match survit à un DROP EXTENSION pg_trgm (corps SQL non suivi) : vérifier les deux
        cur.execute(
            "SELECT to_regprocedure('public.kp_word_match(text,text)') IS NOT NULL"
            " AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS ok"
        )
        row = cur.fetchone()
        return bool(row and row["ok"])

    vocab = S.build_vocab(_savepoint(cur, "vocabulaire", load, []))
    trgm = _savepoint(cur, "pg_trgm", has_trgm, False)
    with _fuzzy_lock:
        _fuzzy_cache.update(at=time.monotonic(), vocab=vocab, trgm=trgm)
    return vocab, trgm


def _search_tickets(cur, pq, limit):
    P = S.SqlParams()
    where = S.ticket_where_sql(pq, P)
    score = S.ticket_score_sql(pq, P)
    exact = S.ticket_exact_sql(pq, P)
    P.values["limit"] = limit
    cur.execute(
        "SELECT " + _TICKET_SELECT + ", " + score + " AS _score, " + exact + " AS _exact, "
        + S.actif_sql("t") + " AS _actif, COUNT(*) OVER () AS _total"
        " FROM tickets t JOIN clients c ON c.id = t.client_id"
        " WHERE " + where +
        " ORDER BY _exact DESC, _actif DESC, _score DESC, t.date_depot DESC NULLS LAST, t.id DESC"
        " LIMIT %(limit)s",
        P.values,
    )
    rows = [dict(r) for r in (cur.fetchall() or [])]
    return rows, (rows[0]["_total"] if rows else 0)


def _search_clients(cur, pq, limit):
    P = S.SqlParams()
    where = S.client_where_sql(pq, P, with_tickets=True)
    score = S.client_score_sql(pq, P)
    P.values["limit"] = limit
    cur.execute(
        "SELECT c.id, c.nom, c.prenom, c.telephone, c.email, c.societe,"
        " COALESCE(st.nb, 0) AS nb_tickets, lt.id AS dernier_ticket_id, lt.statut AS dernier_statut,"
        " " + score + " AS _score, COUNT(*) OVER () AS _total"
        " FROM clients c"
        " LEFT JOIN LATERAL (SELECT count(*) AS nb FROM tickets x WHERE x.client_id = c.id) st ON TRUE"
        " LEFT JOIN LATERAL (SELECT x.id, x.statut, x.date_depot FROM tickets x WHERE x.client_id = c.id"
        "   ORDER BY x.date_depot DESC NULLS LAST, x.id DESC LIMIT 1) lt ON TRUE"
        " WHERE " + where +
        " ORDER BY _score DESC, lt.date_depot DESC NULLS LAST, c.id DESC"
        " LIMIT %(limit)s",
        P.values,
    )
    rows = [dict(r) for r in (cur.fetchall() or [])]
    return rows, (rows[0]["_total"] if rows else 0)


def _search_devis(cur, pq, limit):
    P = S.SqlParams()
    where = S.devis_where_sql(pq, P)
    P.values["limit"] = limit
    cur.execute(
        "SELECT d.id, d.numero, d.client_nom, d.client_prenom, d.appareil, d.statut, d.date_creation AS date"
        " FROM devis d"
        " WHERE " + where +
        " AND NOT EXISTS (SELECT 1 FROM params WHERE cle = 'MODULE_DEVIS_VISIBLE' AND valeur = 'false')"
        " ORDER BY d.date_creation DESC NULLS LAST, d.id DESC"
        " LIMIT %(limit)s",
        P.values,
    )
    return [dict(r) for r in (cur.fetchall() or [])]


def _search_commandes(cur, pq, limit):
    P = S.SqlParams()
    where = S.commande_where_sql(pq, P)
    P.values["limit"] = limit
    cur.execute(
        "SELECT cp.id, cp.description, cp.reference, cp.fournisseur, cp.statut, cp.ticket_id,"
        " COALESCE(NULLIF(cp.ticket_code, ''), t.ticket_code) AS ticket_code"
        " FROM commandes_pieces cp"
        " LEFT JOIN tickets t ON t.id = cp.ticket_id"
        " LEFT JOIN clients c ON c.id = t.client_id"
        " WHERE " + where +
        " ORDER BY (COALESCE(cp.statut, '') NOT IN ('Donné au client', 'Clôturé')) DESC,"
        " cp.date_creation DESC NULLS LAST, cp.id DESC"
        " LIMIT %(limit)s",
        P.values,
    )
    return [dict(r) for r in (cur.fetchall() or [])]


def _ticket_ref(row):
    return {"type": "ticket", "id": row["id"], "ticket_code": row["ticket_code"]}


def _most_recent(rows):
    return max(rows, key=lambda r: (r.get("date_depot") is not None, r.get("date_depot") or datetime.min, r["id"]))


def _resolved(pq, tickets, t_total, clients, c_total):
    """Ticket ou client désigné sans ambiguïté par la saisie, sinon None."""
    if pq.ticket_id and pq.ticket_explicit:
        for r in tickets:
            if r["id"] == pq.ticket_id or r["ticket_code"] == pq.ticket_code:
                return _ticket_ref(r)
    if pq.imei:
        device = [r for r in tickets if S.alnum(r.get("imei")) == pq.imei]
        loan = [r for r in tickets if S.alnum(r.get("telephone_pret_imei")) == pq.imei]
        if device or loan:
            return _ticket_ref(_most_recent(device or loan))
    if pq.phone_key:
        # Liste complète, ou tronquée après les correspondances exactes (triées en tête)
        complete = c_total <= len(clients)
        for same in (
            [c for c in clients if S.same_phone(c.get("telephone"), pq.q)],
            [c for c in clients if S.phone_key(c.get("telephone")) == pq.phone_key],
        ):
            if len(same) == 1 and (complete or len(same) < len(clients)):
                return {"type": "client", "id": same[0]["id"]}
            if same:
                break
    if pq.ticket_id and not pq.ticket_explicit and t_total == 1 and c_total == 0:
        if tickets[0]["id"] == pq.ticket_id:
            return _ticket_ref(tickets[0])
    return None


@router.get("")
def search(
    q: str = Query(..., min_length=1, max_length=500),
    limit: int = Query(8, ge=1, le=25),
    user: dict = Depends(get_current_user),
):
    """Recherche multi-critères : code, téléphone (tout format), IMEI, nom, appareil, panne, notes."""
    pq = S.parse_query(q)
    groups = {"tickets": [], "clients": [], "devis": [], "commandes": []}
    if pq.empty:
        return {"q": q, "resolved": None, "groups": groups}

    with get_cursor() as cur:
        cur.execute("SET LOCAL statement_timeout = '5s'")
        used = pq
        tickets, t_total = _search_tickets(cur, pq, limit)
        clients, c_total = _search_clients(cur, pq, limit)
        if not tickets and not clients:
            vocab, trgm = _fuzzy_context(cur)
            fq = S.fuzzy_query(pq, vocab, trgm)
            if fq:
                def approx():
                    if trgm:
                        # Seuil de l'opérateur <% (kp_word_match), servi par les index GIN trigram
                        cur.execute("SELECT set_config('pg_trgm.word_similarity_threshold', %s, true)",
                                    (str(S.TRGM_THRESHOLD),))
                    return _search_tickets(cur, fq, limit), _search_clients(cur, fq, limit)
                found = _savepoint(cur, "approchée", approx, None)
                if found:
                    used = fq
                    (tickets, t_total), (clients, c_total) = found
        groups["devis"] = _savepoint(cur, "devis", lambda: _search_devis(cur, used, limit), [])
        groups["commandes"] = _savepoint(cur, "commandes", lambda: _search_commandes(cur, used, limit), [])

    groups["tickets"] = [
        {**{k: r.get(k) for k in TICKET_FIELDS}, "match": S.ticket_match_label(used, r)} for r in tickets
    ]
    groups["clients"] = [{k: r.get(k) for k in CLIENT_FIELDS} for r in clients]
    return {"q": q, "resolved": _resolved(pq, tickets, t_total, clients, c_total), "groups": groups}


_RESOLVE_BY_IMEI = (
    "SELECT id, ticket_code FROM tickets WHERE imei <> '' AND public.kp_alnum(imei) = %s"
    " ORDER BY date_depot DESC NULLS LAST, id DESC LIMIT 1"
)
_RESOLVE_BY_LOAN_IMEI = (
    "SELECT id, ticket_code FROM tickets"
    " WHERE telephone_pret_imei <> '' AND public.kp_alnum(telephone_pret_imei) = %s"
    " ORDER BY date_depot DESC NULLS LAST, id DESC LIMIT 1"
)


# Jeton du lien de suivi (…/suivi?t=<jeton>&ticket=KP-000123)
_SUIVI_TOKEN_RE = re.compile(r"[?&]t=([A-Za-z0-9_%-]{16,96})(?:[&#\s]|$)")


def _ticket_par_jeton(cur, code: str):
    m = _SUIVI_TOKEN_RE.search(code or "")
    jeton = unquote(m.group(1)) if m else ""
    if not re.fullmatch(r"[A-Za-z0-9_-]{16,64}", jeton):
        return None
    cur.execute("SELECT id, ticket_code FROM tickets WHERE suivi_token = %s", (jeton,))
    row = cur.fetchone()
    return _ticket_ref(row) if row else None


def resolve_code(cur, code: str):
    """Ticket désigné par un texte scanné ou tapé (QR, KP-000123, kp123, 123, IMEI)."""
    found = _ticket_par_jeton(cur, code)
    if found:
        return found
    # URL intacte (douchette bien réglée) : lue avant toute correction AZERTY,
    # le « & » qui précède ticket= en fausserait la lecture
    url_code = S.suivi_code(code)
    raw = url_code or S.descramble_scan(code)
    url_code = url_code or S.suivi_code(raw)
    if url_code:
        raw = url_code
    ref = S.parse_ticket_ref(raw, from_url=bool(url_code))
    if ref:
        tcode = f"KP-{ref.ticket_id:06d}"
        cur.execute(
            "SELECT id, ticket_code FROM tickets WHERE ticket_code = %s OR id = %s"
            " ORDER BY (ticket_code = %s) DESC LIMIT 1",
            (tcode, ref.ticket_id, tcode),
        )
        row = cur.fetchone()
        if row:
            return _ticket_ref(row)

    if S.is_imei(raw):
        key, queries = S.phone_digits(raw), (_RESOLVE_BY_IMEI, _RESOLVE_BY_LOAN_IMEI)
    else:
        key, queries = S.serial_number(raw), (_RESOLVE_BY_IMEI,)
    if not key:
        return None
    for sql in queries:
        cur.execute(sql, (key,))
        row = cur.fetchone()
        if row:
            return _ticket_ref(row)
    return None


@router.get("/resolve")
def resolve(
    code: str = Query(..., min_length=1, max_length=500),
    user: dict = Depends(get_current_user),
):
    """Résolution d'un scan de douchette (route staff, sans rate-limit public)."""
    with get_cursor() as cur:
        found = resolve_code(cur, code)
    if not found:
        raise HTTPException(404, "Aucun ticket ne correspond")
    return found
