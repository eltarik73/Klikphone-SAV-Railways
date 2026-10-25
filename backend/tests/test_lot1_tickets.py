"""Lot 1 — tickets : réouverture, montants publics, création publique bornée, schéma,
reporting tolérant, heure de Paris, cree_par, erreurs 4xx, top clients, HEAD.

Les tests purs tournent toujours. Les tests sur base réelle exigent une base PostgreSQL
JETABLE (données fictives, migrations du lifespan rejouées), la même que tests/test_fiche.py :
    KP_FICHE_DATABASE_URL="postgresql://postgres:<mot_de_passe>@127.0.0.1:5432/kp_fiche?sslmode=disable" pytest tests/test_lot1_tickets.py
"""

import json
import os
import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from psycopg2 import errors as pg_errors
from pydantic import ValidationError

from app.api import tickets
from app.api.auth import create_token
from tests.conftest import corps_borne
from app.models import MembreEquipeUpdate, TicketCreate, TicketUpdate, normaliser_pattern

H = {"Authorization": f"Bearer {create_token('accueil', 'Sophie')}"}
CORPS = {"client_id": 1, "categorie": "Smartphone", "marque": "Apple", "panne": "Batterie"}


def BORNE(ip="testclient", cid=1):
    """Même corps, voie anonyme : la référence client signée remplace client_id (audit A)."""
    return corps_borne(CORPS, cid, ip)


def _cursor(fetchone=None):
    cur = MagicMock()
    cur.fetchone.return_value = fetchone
    cur.fetchall.return_value = []

    @contextmanager
    def cm(*a, **k):
        yield cur
    return cur, cm


def _horloge(monkeypatch, *args):
    monkeypatch.setattr(tickets, "_maintenant_utc", lambda: datetime(*args, tzinfo=timezone.utc))


# ═══ Heure de Paris ═════════════════════════════════════════════

@pytest.mark.parametrize("sans_base_tz", [False, True])
def test_jour_et_bornes_de_paris(monkeypatch, sans_base_tz):
    if sans_base_tz:   # image sans tzdata : règle d'heure d'été de l'UE
        monkeypatch.setattr(tickets, "_PARIS", None)
    # Dépôt à 00:30 heure de Paris le 20/10 = 22:30 UTC le 19/10
    assert tickets.jour_paris(datetime(2026, 10, 19, 22, 30, tzinfo=timezone.utc)) == "2026-10-20"
    assert tickets.jour_paris(datetime(2026, 10, 19, 21, 59, tzinfo=timezone.utc)) == "2026-10-19"
    assert tickets.bornes_utc("2026-10-20") == ("2026-10-19 22:00:00", "2026-10-20 22:00:00")
    # Passage à l'heure d'hiver (25/10/2026) et d'été (29/03/2026)
    assert tickets.bornes_utc("2026-10-25") == ("2026-10-24 22:00:00", "2026-10-25 23:00:00")
    assert tickets.bornes_utc("2026-03-29") == ("2026-03-28 23:00:00", "2026-03-29 22:00:00")
    assert tickets.bornes_utc("2026-12-01", "2026-12-31") == ("2026-11-30 23:00:00", "2026-12-31 23:00:00")
    with pytest.raises(ValueError):
        tickets.bornes_utc("2026-13-45")


def test_horodatage_texte_en_heure_de_paris(monkeypatch):
    # Serveur en UTC (Railway) : 14:53 UTC = 16:53 à Paris en octobre
    _horloge(monkeypatch, 2026, 10, 20, 14, 53)
    assert tickets._horodatage() == ("2026-10-20 14:53:00", "20/10 16:53")
    _horloge(monkeypatch, 2026, 12, 1, 10, 0)
    assert tickets._horodatage()[1] == "01/12 11:00"


def test_note_et_historique_horodates_a_paris(client, monkeypatch):
    _horloge(monkeypatch, 2026, 10, 20, 14, 53)
    for route, param in (("note", {"note": "Rappeler"}), ("historique", {"texte": "Essai"})):
        cur, cm = _cursor(fetchone={"notes_internes": "", "historique": ""})
        with patch("app.api.tickets.get_cursor", cm):
            r = client.post(f"/api/tickets/5/{route}", params=param, headers=H)
        assert r.status_code == 200
        ecrit = cur.execute.call_args_list[1].args[1][0]
        assert ("[20/10/2026 16:53]" if route == "note" else "[20/10 16:53]") in ecrit


def test_kpi_jour_de_paris_en_bornes_utc(client, monkeypatch):
    _horloge(monkeypatch, 2026, 10, 19, 22, 30)    # 00:30 le 20/10 à Paris
    cur, cm = _cursor()
    with patch("app.api.tickets.get_cursor", cm):
        assert client.get("/api/tickets/stats/kpi", headers=H).status_code == 200
    sql, params = cur.execute.call_args.args
    assert params == ("2026-10-19 22:00:00", "2026-10-20 22:00:00") * 2
    assert "date_cloture::" not in sql and "date_depot::date" not in sql


def test_filtre_dashboard_par_jour_de_paris(client):
    cur, cm = _cursor()
    with patch("app.api.tickets.get_cursor", cm):
        r = client.get("/api/tickets/stats/dashboard", headers=H,
                       params={"date_from": "2026-10-20", "date_to": "2026-10-20"})
    assert r.status_code == 200
    sql, params = cur.execute.call_args_list[1].args
    assert "t.date_depot >= %(kp0)s" in sql and "t.date_depot < %(kp1)s" in sql
    assert params["kp0"] == "2026-10-19 22:00:00" and params["kp1"] == "2026-10-20 22:00:00"


# ═══ Validation des entrées ══════════════════════════════════════

@pytest.mark.parametrize("champ, valeur", [
    ("tarif_final", -30), ("devis_estime", -100), ("acompte", -30), ("prix_supp", -5),
    ("reduction_montant", -10), ("reduction_pourcentage", 250), ("reduction_pourcentage", -1),
    ("tarif_final", 1e9),
])
def test_montants_hors_bornes_422(client, champ, valeur):
    cur, cm = _cursor()
    with patch("app.api.tickets.get_cursor", cm):
        r = client.patch("/api/tickets/1", json={champ: valeur}, headers=H)
    assert r.status_code == 422 and champ in r.text
    assert cur.execute.call_count == 0


@pytest.mark.parametrize("litteral", ["NaN", "Infinity", "-Infinity"])
def test_montant_non_fini_422_et_non_500(client, litteral):
    cur, cm = _cursor()
    with patch("app.api.tickets.get_cursor", cm):
        r = client.patch("/api/tickets/1", content='{"acompte": %s}' % litteral,
                         headers={**H, "Content-Type": "application/json"})
    assert r.status_code == 422 and "acompte" in r.text and cur.execute.call_count == 0


def test_montants_valides_acceptes():
    m = TicketUpdate(tarif_final=0, devis_estime=89.9, acompte=20, prix_supp=0,
                     reduction_montant=5, reduction_pourcentage=100)
    assert m.reduction_pourcentage == 100 and m.tarif_final == 0


@pytest.mark.parametrize("extra", [
    {"marque": "A" * 100_000}, {"panne": "P" * 201}, {"panne_detail": "D" * 2001},
    {"notes_client": "N" * 2001}, {"modele": "M" * 101}, {"source": "S" * 60}, {"source": "kiosque"},
])
def test_creation_longueurs_et_source_422(client, extra):
    cur, cm = _cursor(fetchone={"id": 41})
    with patch("app.api.tickets.get_cursor", cm):
        r = client.post("/api/tickets", json={**CORPS, **extra})
    assert r.status_code == 422 and cur.execute.call_count == 0


def test_creation_anonyme_limitee_par_ip(client):
    cur, cm = _cursor(fetchone={"id": 41})
    ip = {"X-Forwarded-For": "203.0.113.77"}
    with patch("app.api.tickets.get_cursor", cm), patch("app.api.public_documents.jeton_suivi"), \
            patch.object(tickets, "notif_nouveau_ticket", lambda *_: None):
        codes = [client.post("/api/tickets", json=BORNE("203.0.113.77"), headers=ip).status_code for _ in range(16)]
        assert codes[:15] == [200] * 15 and codes[15] == 429
        # Une autre IP, ou le personnel connecté depuis la même : pas concernés
        assert client.post("/api/tickets", json=BORNE("203.0.113.78"), headers={"X-Forwarded-For": "203.0.113.78"}).status_code == 200
        assert client.post("/api/tickets", json=CORPS, headers={**ip, **H}).status_code == 200


def test_creation_anonyme_n_alimente_pas_l_autocompletion(client, monkeypatch):
    appris = []
    monkeypatch.setattr(tickets, "learn_terms", lambda termes, *a: appris.append(termes))
    monkeypatch.setattr(tickets, "notif_nouveau_ticket", lambda *_: None)
    cur, cm = _cursor(fetchone={"id": 41})
    with patch("app.api.tickets.get_cursor", cm), patch("app.api.public_documents.jeton_suivi"):
        assert client.post("/api/tickets", json={**BORNE(), "panne": "Arnaque visitez"}).status_code == 200
        assert appris == []
        assert client.post("/api/tickets", json=CORPS, headers=H).status_code == 200
    assert appris and appris[0]["panne"] == "Batterie"


@pytest.mark.parametrize("staff, source, attendu", [
    (False, None, "borne"), (False, "distance", "distance"), (True, None, "Sophie"), (True, "distance", "Sophie"),
])
def test_creation_renseigne_cree_par(client, staff, source, attendu):
    cur, cm = _cursor(fetchone={"id": 41})
    corps = {**(CORPS if staff else BORNE()), **({"source": source} if source else {})}
    with patch("app.api.tickets.get_cursor", cm), patch("app.api.public_documents.jeton_suivi"):
        r = client.post("/api/tickets", json=corps, headers=H if staff else {})
    assert r.status_code == 200
    sql, params = cur.execute.call_args_list[0].args
    assert "cree_par, priorite)" in sql and params[-2] == attendu


def test_creation_renvoie_le_jeton_de_suivi_au_createur(client):
    """Le jeton (= QR imprimé) part dans la réponse de création, et seulement là : la borne ouvre
    « Suivre ma réparation » sans redemander le téléphone. S'il n'a pas pu être posé, la création
    aboutit quand même (suivi_token null : la page de suivi demandera le numéro)."""
    cur, cm = _cursor(fetchone={"id": 41})
    ip = {"X-Forwarded-For": "203.0.113.90"}
    with patch("app.api.tickets.get_cursor", cm), \
            patch("app.api.public_documents.jeton_suivi", lambda tid: f"JetonFictif_{tid:016d}"), \
            patch.object(tickets, "notif_nouveau_ticket", lambda *_: None):
        r = client.post("/api/tickets", json=BORNE("203.0.113.90"), headers=ip)
    assert r.status_code == 200
    assert r.json() == {"id": 41, "ticket_code": "KP-000041", "suivi_token": "JetonFictif_0000000000000041"}

    def indisponible(tid):
        raise RuntimeError("colonne suivi_token absente")
    with patch("app.api.tickets.get_cursor", cm), patch("app.api.public_documents.jeton_suivi", indisponible), \
            patch.object(tickets, "notif_nouveau_ticket", lambda *_: None):
        r = client.post("/api/tickets", json=CORPS, headers=H)
    assert r.status_code == 200 and r.json()["suivi_token"] is None and r.json()["ticket_code"] == "KP-000041"


def test_creation_client_inconnu_404(client):
    cur, cm = _cursor()
    cur.execute.side_effect = pg_errors.ForeignKeyViolation("clients")
    with patch("app.api.tickets.get_cursor", cm):
        r = client.post("/api/tickets", json={**CORPS, "client_id": 999999}, headers=H)
    assert r.status_code == 404 and "Client" in r.json()["detail"]
    # Voie anonyme : référence signée d'une fiche disparue → même 404 (clé étrangère)
    with patch("app.api.tickets.get_cursor", cm):
        r = client.post("/api/tickets", json=BORNE(cid=999999))
    assert r.status_code == 404 and "Client" in r.json()["detail"]


# ─── Schéma (pattern) ───────────────────────────────────────────

@pytest.mark.parametrize("saisie, attendu", [
    ("15963", "1-5-9-6-3"), ("1 5 9 6 3", "1-5-9-6-3"), ("1-5-9-6-3", "1-5-9-6-3"),
    (" 1-5-9- ", "1-5-9"), ("", None), ("   ", None), ("7", "7"),
])
def test_pattern_normalise(saisie, attendu):
    assert normaliser_pattern(saisie) == attendu
    assert TicketUpdate(pattern=saisie).pattern == attendu


@pytest.mark.parametrize("saisie", ["11", "1234a", "0123", "L à l'envers", "1-1-0", " Z inversé "])
def test_pattern_non_ramenable_garde_tel_quel(client, saisie):
    # Pas un schéma ramenable : gardé tel quel, jamais de 422 (bloquerait la fiche et le retour SAV)
    with pytest.raises(ValueError):
        normaliser_pattern(saisie)
    assert TicketCreate(**CORPS, pattern=saisie).pattern == saisie.strip()
    assert TicketUpdate(pattern=saisie).pattern == saisie.strip()
    cur, cm = _cursor()
    with patch("app.api.tickets.get_cursor", cm):
        r = client.patch("/api/tickets/1", json={"pattern": saisie, "modele": "iPhone 14"}, headers=H)
    assert r.status_code != 422


def test_pattern_normalise_a_la_creation(client):
    cur, cm = _cursor(fetchone={"id": 41})
    with patch("app.api.tickets.get_cursor", cm), patch("app.api.public_documents.jeton_suivi"):
        assert client.post("/api/tickets", json={**CORPS, "pattern": "15963"}, headers=H).status_code == 200
    assert "1-5-9-6-3" in cur.execute.call_args_list[0].args[1]


# ─── Erreurs 4xx au lieu de 500 ─────────────────────────────────

def test_team_actif_hors_bornes_422(client):
    with pytest.raises(ValidationError):
        MembreEquipeUpdate(actif=-2147483649)
    assert MembreEquipeUpdate(actif=True).actif == 1 and MembreEquipeUpdate(actif=False).actif == 0
    cur, cm = _cursor()
    with patch("app.api.team.get_cursor", cm):
        r = client.patch("/api/team/3", json={"actif": -2147483649}, headers=H)
    assert r.status_code == 422 and cur.execute.call_count == 0


@pytest.mark.parametrize("params", [{"debut": "2026-13-45"}, {"fin": "2026-02-30"}, {"debut": "hier"},
                                    {"debut": "2026-10-20", "fin": "2026-10-01"}])
def test_reporting_dates_impossibles_400(client, params):
    cur, cm = _cursor()
    with patch("app.api.reporting.get_cursor", cm):
        r = client.get("/api/reporting", params=params, headers=H)
    assert r.status_code == 400 and cur.execute.call_count == 0


def test_reporting_sans_cast_de_date_cloture(client):
    cur, cm = _cursor(fetchone={})
    cur.fetchone.return_value = MagicMock(__getitem__=lambda s, k: 0)
    with patch("app.api.reporting.get_cursor", cm):
        r = client.get("/api/reporting", params={"debut": "2026-10-01", "fin": "2026-10-20"}, headers=H)
    assert r.status_code == 200
    sqls = " ".join(c.args[0] for c in cur.execute.call_args_list)
    assert "date_cloture::" not in sqls and "::date >=" not in sqls
    assert "public.kp_try_ts(date_cloture)" in sqls


@pytest.mark.parametrize("erreur, code", [
    (pg_errors.NumericValueOutOfRange, 400), (pg_errors.StringDataRightTruncation, 400),
    (pg_errors.InvalidDatetimeFormat, 400), (pg_errors.ForeignKeyViolation, 409),
])
def test_erreurs_de_donnees_postgres_en_4xx(client, erreur, code):
    cur, cm = _cursor()
    cur.execute.side_effect = erreur("détail interne")
    with patch("app.api.tickets.get_cursor", cm):
        r = client.get("/api/tickets/1", headers=H)
    assert r.status_code == code and "détail interne" not in r.text


def test_head_sur_le_spa(client):
    from app.main import STATIC_DIR
    if not STATIC_DIR.exists():
        pytest.skip("backend/static absent (bundle non construit)")
    assert client.head("/").status_code == 200
    assert client.head("/accueil").status_code == 200
    if (STATIC_DIR / "sw.js").exists():
        assert client.head("/sw.js").status_code == 200
    assert client.head("/api/inexistant").status_code == 404
    assert client.get("/api/tickets", headers=H).status_code == 200   # routes API inchangées


# ═══ Base réelle ═══════════════════════════════════════════════

DB_URL = os.getenv("KP_FICHE_DATABASE_URL")
TEL = "0600000881"
LIGNES_89 = json.dumps([{"label": "Remplacement batterie", "prix": 89}])


@pytest.fixture(scope="module")
def reel():
    if not DB_URL:
        pytest.skip("KP_FICHE_DATABASE_URL non définie (base PostgreSQL de test jetable)")
    import psycopg2.extras
    import psycopg2.pool
    import app.database

    pool = psycopg2.pool.ThreadedConnectionPool(1, 8, DB_URL)

    @contextmanager
    def vrai_cursor(dict_cursor=True):
        conn = pool.getconn()
        try:
            factory = psycopg2.extras.RealDictCursor if dict_cursor else None
            with conn.cursor(cursor_factory=factory) as cur:
                yield cur
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            pool.putconn(conn)

    mp = pytest.MonkeyPatch()
    mp.setattr(app.database, "get_cursor", vrai_cursor)
    for nom, mod in list(sys.modules.items()):
        if nom.startswith("app.") and mod is not app.database and getattr(mod, "get_cursor", None) is not None:
            mp.setattr(mod, "get_cursor", vrai_cursor)
    mp.setattr(tickets, "notif_nouveau_ticket", lambda *_: None)
    mp.setattr(tickets, "notif_changement_statut", lambda *_: None)
    mp.setattr(tickets, "notif_reparation_terminee", lambda *_: None)
    from app.main import app as fastapi_app
    try:
        with TestClient(fastapi_app) as c:   # lifespan : schéma + migrations
            with vrai_cursor() as cur:
                # Restes d'un passage précédent (clients fictifs de ce fichier seulement)
                cur.execute("SELECT id FROM clients WHERE telephone = %s OR nom = 'Lot1Homonyme'", (TEL,))
                anciens = [r["id"] for r in cur.fetchall()]
                cur.execute("SELECT id FROM tickets WHERE client_id = ANY(%s)", (anciens,))
                vieux = [r["id"] for r in cur.fetchall()]
                cur.execute("DELETE FROM fidelite_historique WHERE client_id = ANY(%s)", (anciens,))
                for table in ("notes_tickets", "historique", "commandes_pieces"):
                    cur.execute(f"DELETE FROM {table} WHERE ticket_id = ANY(%s)", (vieux,))
                cur.execute("DELETE FROM tickets WHERE id = ANY(%s)", (vieux,))
                cur.execute("DELETE FROM clients WHERE id = ANY(%s)", (anciens,))
                cur.execute("INSERT INTO clients (nom, prenom, telephone) VALUES ('Fictif', 'Lot1', %s) RETURNING id", (TEL,))
                cid = cur.fetchone()["id"]
            yield {"c": c, "cur": vrai_cursor, "cid": cid}
    finally:
        mp.undo()
        pool.closeall()


def _sql(reel, sql, *params):
    with reel["cur"]() as cur:
        cur.execute(sql, params)
        return cur.fetchall() if cur.description else None


def _ticket(reel, **kw):
    t = {"client_id": reel["cid"], "categorie": "Smartphone", "marque": "Marque", "modele": "Test",
         "panne": "Batterie", "statut": "Réparation terminée", "paye": 0}
    t.update(kw)
    cols = list(t)
    with reel["cur"]() as cur:
        cur.execute(
            "INSERT INTO tickets ({}) VALUES ({}) RETURNING id".format(", ".join(cols), ", ".join(["%s"] * len(cols))),
            [t[k] for k in cols],
        )
        tid = cur.fetchone()["id"]
        cur.execute("UPDATE tickets SET ticket_code = %s WHERE id = %s", (f"KP-{tid:06d}", tid))
    return tid


def _kpi(reel):
    return reel["c"].get("/api/tickets/stats/kpi", headers=H).json()


def _ca_du_jour(reel):
    jour = tickets.jour_paris()
    r = reel["c"].get("/api/reporting", params={"debut": jour, "fin": jour}, headers=H)
    assert r.status_code == 200, r.text
    kpis = {k["id"]: k["value"] for k in r.json()["kpis"]}
    return kpis["ca_encaisse"], kpis["clotures"]


def test_reouverture_efface_cloture_et_rendu(reel):
    c = reel["c"]
    k0, (ca0, cl0) = _kpi(reel), _ca_du_jour(reel)
    tid = c.post("/api/tickets", json={**CORPS, "client_id": reel["cid"]}, headers=H).json()["id"]
    assert c.patch(f"/api/tickets/{tid}", json={"devis_estime": 100}, headers=H).status_code == 200
    assert c.patch(f"/api/tickets/{tid}/statut", json={"statut": "Réparation terminée"}, headers=H).status_code == 200
    assert c.patch(f"/api/tickets/{tid}/paye", json={"paye": True}, headers=H).status_code == 200
    assert c.patch(f"/api/tickets/{tid}/statut", json={"statut": "Clôturé"}, headers=H).status_code == 200
    k1 = _kpi(reel)
    assert k1["clotures_aujourdhui"] == k0["clotures_aujourdhui"] + 1
    assert _ca_du_jour(reel) == (ca0 + 100, cl0 + 1)
    avant = _sql(reel, "SELECT date_cloture, date_rendu, rendu_par FROM tickets WHERE id = %s", tid)[0]
    assert avant["date_cloture"] and avant["date_rendu"] and avant["rendu_par"] == "Sophie"

    # Revenu à l'atelier : plus compté comme clôturé du jour ni dans le CA
    r = c.patch(f"/api/tickets/{tid}/statut", json={"statut": "Réparation terminée"}, headers=H)
    assert r.status_code == 200
    k2 = _kpi(reel)
    assert k2["clotures_aujourdhui"] == k0["clotures_aujourdhui"]
    assert k2["total_actifs"] == k0["total_actifs"] + 1
    assert _ca_du_jour(reel) == (ca0, cl0)
    row = _sql(reel, "SELECT date_cloture, date_rendu, rendu_par, paye, historique FROM tickets WHERE id = %s", tid)[0]
    assert row["date_cloture"] is None and row["date_rendu"] is None and row["rendu_par"] is None
    assert row["paye"] == 1   # l'argent a été encaissé : pas de dé-paiement implicite
    assert "Réouverture" in row["historique"]
    assert _sql(reel, "SELECT count(*) AS n FROM historique WHERE ticket_id = %s AND contenu LIKE 'Réouverture%%'", tid)[0]["n"] == 1

    # Nouveau rendu : nouvelle date, de nouveau compté
    assert c.patch(f"/api/tickets/{tid}/statut", json={"statut": "Clôturé"}, headers=H).status_code == 200
    row = _sql(reel, "SELECT date_cloture, date_rendu FROM tickets WHERE id = %s", tid)[0]
    assert row["date_cloture"] and row["date_rendu"]
    assert _kpi(reel)["clotures_aujourdhui"] == k0["clotures_aujourdhui"] + 1

    # Rendu → Clôturé (les deux « rendus ») : la date de clôture ne bouge pas
    _sql(reel, "UPDATE tickets SET date_cloture = '2026-01-05 10:00:00' WHERE id = %s", tid)
    assert c.patch(f"/api/tickets/{tid}/statut", json={"statut": "Rendu au client"}, headers=H).status_code == 200
    assert c.patch(f"/api/tickets/{tid}/statut", json={"statut": "Clôturé"}, headers=H).status_code == 200
    assert _sql(reel, "SELECT date_cloture FROM tickets WHERE id = %s", tid)[0]["date_cloture"] == "2026-01-05 10:00:00"


def test_ca_ignore_un_ticket_actif_encore_date(reel):
    """Anciens tickets revenus à l'atelier avant le correctif : date_cloture restée remplie."""
    ca0, cl0 = _ca_du_jour(reel)
    now = tickets._horodatage()[0]
    _ticket(reel, statut="En cours de réparation", paye=1, tarif_final=70, date_cloture=now)
    assert _ca_du_jour(reel) == (ca0, cl0)


def test_suivi_public_montants_du_serveur(reel):
    c = reel["c"]
    solde = _ticket(reel, statut="Clôturé", reparation_supp=LIGNES_89, prix_supp=89, acompte=20, paye=1, tarif_final=89)
    trop = _ticket(reel, statut="Réparation terminée", reparation_supp=LIGNES_89, prix_supp=89, acompte=120)
    du = _ticket(reel, statut="Réparation terminée", reparation_supp=LIGNES_89, prix_supp=89, acompte=20)
    preuve = {"tel": TEL}   # le code seul ne suffit plus (codes séquentiels)
    assert c.get(f"/api/tickets/code/KP-{solde:06d}").status_code == 403
    m = c.get(f"/api/tickets/code/KP-{solde:06d}", params=preuve).json()["montants"]
    assert m == {"sous_total": 89.0, "reduction": 0.0, "total": 89.0, "acompte": 20.0, "reste": 0.0, "paye": True}
    assert c.get(f"/api/tickets/code/KP-{trop:06d}", params=preuve).json()["montants"]["reste"] == 0.0
    corps = c.get(f"/api/tickets/code/KP-{du:06d}", params=preuve).json()
    assert corps["montants"]["reste"] == 69.0 and corps["paye"] == 0
    # Toujours rien de confidentiel
    assert not {"pin", "pattern", "imei", "notes_internes", "client_id"} & set(corps)


@pytest.mark.parametrize("mal_formee", ["15/10/2025 14:00", "", "2026-02-30 10:00:00", "n'importe quoi"])
def test_reporting_tolere_une_date_cloture_mal_formee(reel, mal_formee):
    _ticket(reel, statut="Clôturé", paye=1, tarif_final=10, date_cloture=mal_formee)
    for gran in ("jour", "heure", "mois"):
        r = reel["c"].get("/api/reporting", params={"debut": "2026-01-01", "fin": "2026-12-31", "granularite": gran},
                          headers=H)
        assert r.status_code == 200, r.text


def test_depot_de_nuit_compte_dans_le_jour_de_paris(reel, monkeypatch):
    tid = _ticket(reel, statut="Pré-enregistré", source="distance", date_depot="2026-10-19 22:30:00")
    r = reel["c"].get("/api/tickets/stats/dashboard", headers=H,
                      params={"date_from": "2026-10-20", "date_to": "2026-10-20", "limit": 500})
    assert tid in [t["id"] for t in r.json()["tickets"]]
    r = reel["c"].get("/api/tickets/stats/dashboard", headers=H,
                      params={"date_from": "2026-10-19", "date_to": "2026-10-19", "limit": 500})
    assert tid not in [t["id"] for t in r.json()["tickets"]]
    _horloge(monkeypatch, 2026, 10, 20, 8, 0)
    n = _sql(reel, "SELECT count(*) AS n FROM tickets WHERE date_depot >= '2026-10-19 22:00' AND date_depot < '2026-10-20 22:00'")[0]["n"]
    assert _kpi(reel)["nouveaux_aujourdhui"] == n


def test_cree_par_en_base_et_dans_le_reporting(reel):
    c = reel["c"]
    borne = c.post("/api/tickets", json=BORNE(cid=reel["cid"])).json()["id"]
    staff = c.post("/api/tickets", json={**CORPS, "client_id": reel["cid"]}, headers=H).json()["id"]
    lignes = {r["id"]: r["cree_par"] for r in _sql(reel, "SELECT id, cree_par FROM tickets WHERE id IN (%s, %s)", borne, staff)}
    assert lignes == {borne: "borne", staff: "Sophie"}
    jour = tickets.jour_paris()
    perf = c.get("/api/reporting", params={"debut": jour, "fin": jour}, headers=H).json()["performance_accueil"]
    assert {"borne", "Sophie"} <= {p["utilisateur"] for p in perf}


def test_client_inexistant_404_et_notes_sur_ticket_absent(reel):
    c = reel["c"]
    assert c.post("/api/tickets", json={**CORPS, "client_id": 999999999}, headers=H).status_code == 404
    absent = _sql(reel, "SELECT COALESCE(MAX(id), 0) + 1000 AS id FROM tickets")[0]["id"]
    r = c.post(f"/api/tickets/{absent}/notes", params={"auteur": "Sophie", "contenu": "x"}, headers=H)
    assert r.status_code == 404
    r = c.post(f"/api/tickets/{absent}/message-log", params={"auteur": "Sophie", "contenu": "x"}, headers=H)
    assert r.status_code == 404
    tid = _ticket(reel)
    r = c.post(f"/api/tickets/{tid}/notes", params={"auteur": "Sophie", "contenu": "Note"}, headers=H)
    assert r.status_code == 200 and r.json()["id"]


def test_source_trop_longue_ne_fait_plus_500(reel):
    r = reel["c"].post("/api/tickets", json={**CORPS, "client_id": reel["cid"], "source": "S" * 60})
    assert r.status_code == 422


def test_migration_des_schemas_sans_tirets(reel):
    from app.main import _migrations_fiche
    a = _ticket(reel, pattern="15963")
    b = _ticket(reel, pattern="1 5 9 6 3")
    garde = {_ticket(reel, pattern=p): p for p in ("1-5-9", "11", "Z inversé", "")}
    _migrations_fiche()
    _migrations_fiche()   # idempotente
    vus = {r["id"]: r["pattern"] for r in _sql(reel, "SELECT id, pattern FROM tickets WHERE id = ANY(%s)", [a, b, *garde])}
    assert vus[a] == "1-5-9-6-3" and vus[b] == "1-5-9-6-3"
    assert all(vus[t] == p for t, p in garde.items())


def test_top_clients_par_fiche_sans_anonymises(reel):
    from app.api.admin import get_top_clients
    homonymes = []
    for tel in ("0600000882", "0600000883"):
        cid = _sql(reel, "INSERT INTO clients (nom, telephone) VALUES ('Lot1Homonyme', %s) RETURNING id", tel)[0]["id"]
        homonymes.append(cid)
        for jour in ("2001-01-05", "2001-01-06"):
            _ticket(reel, client_id=cid, paye=1, tarif_final=50, date_depot=jour)
    anonymes = []
    for i in range(3):
        cid = _sql(reel, "INSERT INTO clients (nom, telephone, anonymise_le) VALUES ('Lot1Homonyme', %s, NOW()) RETURNING id",
                   f"060000089{i}")[0]["id"]
        anonymes.append(cid)
        for jour in ("2001-01-05", "2001-01-06"):
            _ticket(reel, client_id=cid, paye=1, tarif_final=500, date_depot=jour)
    with patch("app.api.admin.get_cursor", reel["cur"]):
        top = get_top_clients(date_start="2001-01-01", date_end="2001-01-31", user={})
    ids = [t["client_id"] for t in top]
    assert not set(anonymes) & set(ids)
    lignes = [t for t in top if t["client_id"] in homonymes]
    assert len(lignes) == 2 and all(t["nb_reparations"] == 2 and t["ca_total"] == 100 for t in lignes)
