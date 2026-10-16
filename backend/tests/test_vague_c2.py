"""Vague C2 : démarrage (empreinte du schéma, sessions bloquées, healthcheck), cache des
paramètres, création de ticket non bloquante, téléphone normalisé, montants imprimés,
rôle admin prouvé par poste."""

import json
import re
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import BackgroundTasks

from app import main
from app.api import auth, print_tickets, tickets
from app.api.auth import create_admin_token, create_token, decode_token
from app.services import params as params_cache
from app.services.montants import calculer_montants


class FakeCursor:
    def __init__(self, handler):
        self.handler = handler
        self.executed = []
        self._last = None

    def execute(self, sql, params=None):
        texte = " ".join(str(sql).split())
        self.executed.append((texte, params))
        self._last = self.handler(texte, params)
        if isinstance(self._last, Exception):
            raise self._last

    def mogrify(self, sql, params=None):
        return sql.replace("%s", "'x'").encode()

    def fetchone(self):
        r = self._last
        if isinstance(r, list):
            return r[0] if r else None
        return r

    def fetchall(self):
        r = self._last
        if r is None:
            return []
        return r if isinstance(r, list) else [r]

    def sql(self):
        return [s for s, _ in self.executed]


def fake_db(handler):
    cur = FakeCursor(handler)

    @contextmanager
    def gc(*a, **k):
        yield cur

    return cur, gc


@pytest.fixture(autouse=True)
def _reset():
    auth.reset_essais()
    yield
    auth.reset_essais()


def _headers(user="TestUser", admin=False, sid=None, ip="10.0.0.1"):
    tok = create_token("accueil", user, sid=sid)
    h = {"Authorization": f"Bearer {tok}", "X-Forwarded-For": ip}
    if admin:
        h["X-Admin-Token"] = create_admin_token(decode_token(tok))
    return h


# ═══ Démarrage ═════════════════════════════════════════════════════

def test_empreinte_stable_et_sensible_au_ddl(monkeypatch):
    e1 = main.schema_empreinte()
    assert e1 == main.schema_empreinte() and re.fullmatch(r"[0-9a-f]{40}", e1)
    monkeypatch.setattr(main, "_DDL_ALTERS", main._DDL_ALTERS + ["ALTER TABLE tickets ADD COLUMN IF NOT EXISTS x TEXT"])
    assert main.schema_empreinte() != e1


def test_empreinte_couvre_les_fonctions_des_modules():
    sources = dict((nom, main._source(fn)) for nom, fn in main._ddl_modules())
    assert "CREATE TABLE IF NOT EXISTS tarifs" in sources["tarifs"]
    assert "CREATE TABLE IF NOT EXISTS iphone_tarifs" in sources["iphone_tarifs"]


def test_ddl_deja_present_ecarte():
    existant = {"c:tickets.attention", "i:idx_tickets_statut"}
    assert main._deja_present("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS attention TEXT", existant)
    assert not main._deja_present("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS issue TEXT", existant)
    assert main._deja_present("CREATE INDEX IF NOT EXISTS idx_tickets_statut ON tickets(statut)", existant)
    assert not main._deja_present("CREATE UNIQUE INDEX IF NOT EXISTS idx_x ON t(a)", existant)
    # Jamais écartés : tables (no-op sans verrou), fonctions, blocs DO
    assert not main._deja_present("CREATE TABLE IF NOT EXISTS params (cle TEXT)", existant)
    assert not main._deja_present("DO $$ BEGIN NULL; END $$", existant)


def test_lot_ddl_un_aller_retour_si_tout_passe():
    cur, _ = fake_db(lambda sql, p: None)
    assert main._executer_lot(cur, "t", ["CREATE TABLE a (x int);", "CREATE TABLE b (x int)"]) is True
    assert len(cur.executed) == 1
    assert cur.executed[0][0].startswith("SAVEPOINT kp_lot;") and "RELEASE SAVEPOINT kp_lot" in cur.executed[0][0]


def test_lot_ddl_un_echec_n_annule_pas_les_autres():
    def handler(sql, p):
        if "FAUX" in sql:
            return Exception("syntax error")
        return None

    cur, _ = fake_db(handler)
    ok = main._executer_lot(cur, "t", ["CREATE TABLE a (x int)", "FAUX", "CREATE TABLE b (x int)"])
    assert ok is False
    s = cur.sql()
    assert "ROLLBACK TO SAVEPOINT kp_lot; RELEASE SAVEPOINT kp_lot" in s
    seules = [x for x in s if x.startswith("SAVEPOINT kp_ddl;")]
    assert len(seules) == 3 and "CREATE TABLE b (x int)" in seules[2]
    assert s.count("ROLLBACK TO SAVEPOINT kp_ddl; RELEASE SAVEPOINT kp_ddl") == 1


class _Verrou(Exception):
    pgcode = "55P03"


def test_lot_ddl_lock_timeout_pas_de_second_essai():
    cur, _ = fake_db(lambda sql, p: _Verrou("lock timeout") if "ALTER" in sql else None)
    ok = main._executer_lot(cur, "t", ["ALTER TABLE tickets ADD COLUMN a INT", "ALTER TABLE tickets ADD COLUMN b INT"])
    assert ok is False
    assert not [x for x in cur.sql() if x.startswith("SAVEPOINT kp_ddl;")]


def test_lot_ddl_lock_timeout_arrete_le_rejeu():
    def handler(sql, p):
        if sql.startswith("SAVEPOINT kp_lot;"):
            return Exception("syntax error")
        if "FAUX" in sql:
            return Exception("syntax error")
        if "ADD COLUMN b" in sql:
            return _Verrou("lock timeout")
        return None

    cur, _ = fake_db(handler)
    ok = main._executer_lot(cur, "t", ["FAUX", "ALTER TABLE tickets ADD COLUMN b INT", "ALTER TABLE tickets ADD COLUMN c INT"])
    assert ok is False
    rejoues = [x for x in cur.sql() if x.startswith("SAVEPOINT kp_ddl;")]
    assert len(rejoues) == 2 and not any("ADD COLUMN c" in x for x in rejoues)


class _Delai(Exception):
    pgcode = "57014"


def test_lot_ddl_statement_timeout_pas_de_second_essai():
    # CREATE INDEX bloqué jusqu'au statement_timeout : la même attente recommencerait
    cur, _ = fake_db(lambda sql, p: _Delai("canceling statement due to statement timeout") if "INDEX" in sql else None)
    ok = main._executer_lot(cur, "t", ["CREATE INDEX IF NOT EXISTS i1 ON tickets(a)", "CREATE INDEX IF NOT EXISTS i2 ON tickets(b)"])
    assert ok is False
    assert not [x for x in cur.sql() if x.startswith("SAVEPOINT kp_ddl;")]


def test_lot_ddl_statement_timeout_arrete_le_rejeu():
    def handler(sql, p):
        if sql.startswith("SAVEPOINT kp_lot;") or "FAUX" in sql:
            return Exception("syntax error")
        if "i1" in sql:
            return _Delai("canceling statement due to statement timeout")
        return None

    cur, _ = fake_db(handler)
    ok = main._executer_lot(cur, "t", ["FAUX", "CREATE INDEX IF NOT EXISTS i1 ON tickets(a)",
                                       "CREATE INDEX IF NOT EXISTS i2 ON tickets(b)"])
    assert ok is False
    rejoues = [x for x in cur.sql() if x.startswith("SAVEPOINT kp_ddl;")]
    assert len(rejoues) == 2 and not any("i2" in x for x in rejoues)


@pytest.mark.parametrize("label, attr", [("CREATE TABLE", "_DDL_TABLES"), ("ALTER TABLE", "_DDL_ALTERS"),
                                         ("CREATE INDEX", "_DDL_INDEXES")])
def test_chaque_groupe_ddl_pose_un_lock_timeout(label, attr):
    cur, gc = fake_db(lambda sql, p: None)
    with patch("app.database.get_cursor", gc):
        assert main._groupe_ddl(label, getattr(main, attr), set()) is True
    premier = cur.sql()[0]
    assert premier == "SELECT pg_advisory_xact_lock(727001); SET LOCAL lock_timeout = '3s'"
    assert cur.sql()[1].startswith("SAVEPOINT kp_lot;")


def test_lock_timeout_jamais_en_session():
    source = Path(main.__file__).read_text()
    assert not re.search(r"SET lock_timeout", source)
    assert "SET LOCAL lock_timeout = '3s'" in source


def test_sessions_coupees_seulement_de_cette_application():
    cur, gc = fake_db(lambda sql, p: {"n": 0} if "pg_terminate_backend" in sql else {"valeur": "abc"})
    with patch("app.database.get_cursor", gc):
        assert main._etat_initial() == "abc"
    terminate = next((s, p) for s, p in cur.executed if "pg_terminate_backend" in s)
    assert "application_name = %s" in terminate[0] and "INTERVAL '10 minutes'" in terminate[0]
    assert "'idle in transaction'" in terminate[0] and terminate[1] == (main.APPLICATION_NAME,)


def test_base_neuve_sans_params():
    cur, gc = fake_db(lambda sql, p: Exception("relation params does not exist") if "FROM params" in sql else {"n": 0})
    with patch("app.database.get_cursor", gc):
        assert main._etat_initial() is None
    assert "ROLLBACK TO SAVEPOINT kp_version" in cur.sql()


def _lifespan(monkeypatch, version, appliquer=True):
    appels = []
    monkeypatch.setattr(main, "_etat_initial", lambda: version)
    monkeypatch.setattr(main, "appliquer_schema", lambda: appels.append("ddl") or appliquer)
    monkeypatch.setattr(main, "_ecrire_version", lambda e: appels.append(("version", e)))
    for nom in ("_donnees_de_demarrage", "_migrations_recherche", "_migrations_fiche", "seed_catalog"):
        monkeypatch.setattr(main, nom, lambda nom=nom: appels.append(nom))
    monkeypatch.setattr(main.iphones_stock, "lancer_init_differee", lambda: appels.append("iphones"))
    monkeypatch.setattr(main, "_prechauffer_pool", lambda: None)
    for mod, drapeau in main._DRAPEAUX_SCHEMA:   # restaurés après le test
        monkeypatch.setattr(mod, drapeau, getattr(mod, drapeau))
    import asyncio

    async def run():
        async with main.app.router.lifespan_context(main.app):
            pass

    asyncio.run(run())
    return appels


def test_schema_a_jour_ddl_saute(monkeypatch):
    appels = _lifespan(monkeypatch, main.schema_empreinte())
    assert "ddl" not in appels and not any(isinstance(a, tuple) for a in appels)
    # Les migrations de données gardent leurs propres gardes : toujours appelées
    assert {"_donnees_de_demarrage", "_migrations_recherche", "_migrations_fiche", "seed_catalog"} <= set(appels)
    assert main.marketing._tables_checked and main.notifications_center._TABLE_CHECKED


def test_schema_change_ddl_puis_empreinte(monkeypatch):
    appels = _lifespan(monkeypatch, "ancienne")
    assert appels[0] == "ddl" and appels[1] == ("version", main.schema_empreinte())


def test_schema_en_echec_empreinte_non_ecrite(monkeypatch):
    appels = _lifespan(monkeypatch, None, appliquer=False)
    assert "ddl" in appels and not any(isinstance(a, tuple) for a in appels)


def test_force_schema(monkeypatch):
    monkeypatch.setenv("KP_FORCE_SCHEMA", "1")
    assert "ddl" in _lifespan(monkeypatch, main.schema_empreinte())


def test_gzip_niveau_6():
    gz = [m for m in main.app.user_middleware if m.cls.__name__ == "GZipMiddleware"]
    assert gz and gz[0].kwargs.get("compresslevel") == 6


def test_railway_healthcheck():
    cfg = json.loads((Path(main.__file__).resolve().parent.parent / "railway.json").read_text())
    assert cfg["deploy"]["healthcheckPath"] == "/health" and cfg["deploy"]["healthcheckTimeout"] == 300


def test_health_sans_base(client):
    @contextmanager
    def panne(*a, **k):
        raise RuntimeError("base indisponible")
        yield

    with patch("app.database.get_cursor", panne), patch("app.database.get_db", panne):
        r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_pool_ouvert_avec_une_connexion(monkeypatch):
    import app.database as db
    vus = {}

    class Pool:
        def __init__(self, minconn, maxconn, **kw):
            vus.update(minconn=minconn, kw=kw)
            self.minconn = minconn

    monkeypatch.setattr(db, "_pool", None)
    monkeypatch.setattr(db.psycopg2.pool, "ThreadedConnectionPool", Pool)
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@h/base")
    pool = db.get_pool()
    assert vus["minconn"] == 1 and pool.minconn == db._MINCONN
    assert vus["kw"]["application_name"] == db.APPLICATION_NAME
    monkeypatch.setattr(db, "_pool", None)


# ═══ Cache des paramètres ══════════════════════════════════════════

def _params_db(valeurs, compteur):
    def handler(sql, p):
        if sql == "SELECT cle, valeur FROM params":
            compteur.append(1)
            return [{"cle": k, "valeur": v} for k, v in valeurs.items()]
        return None
    return fake_db(handler)


def test_cache_params_une_requete_par_ttl():
    lectures = []
    _, gc = _params_db({"tva": "20", "adresse": "Rue fictive"}, lectures)
    with patch.object(params_cache, "get_cursor", gc):
        assert params_cache.get_param("tva") == "20"
        assert params_cache.get_params(["adresse", "absent"], {"absent": "d"}) == {"adresse": "Rue fictive", "absent": "d"}
        assert params_cache.get_param("absent", "x") == "x"
        assert len(lectures) == 1
        params_cache.invalidate()
        params_cache.get_param("tva")
        assert len(lectures) == 2


def test_cache_params_curseur_de_l_appelant():
    lectures = []
    cur, _ = _params_db({"fidelite_palier_film": "800"}, lectures)
    assert params_cache.get_param("fidelite_palier_film", "1000", cur=cur) == "800"
    assert len(lectures) == 1


def test_cache_params_invalide_pendant_la_lecture():
    valeurs = {"tva": "20"}

    def handler(sql, p):
        params_cache.invalidate()   # une écriture arrive pendant la lecture
        return [{"cle": k, "valeur": v} for k, v in valeurs.items()]

    _, gc = fake_db(handler)
    with patch.object(params_cache, "get_cursor", gc):
        assert params_cache.get_param("tva") == "20"
        assert params_cache._etat["valeurs"] is None   # résultat servi, pas mis en cache


@pytest.mark.parametrize("appel", [
    lambda c, h: c.put("/api/config", headers=h, json={"cle": "adresse", "valeur": "Rue"}),
    lambda c, h: c.put("/api/config/batch", headers=h, json=[{"cle": "tva", "valeur": "20"}]),
    lambda c, h: c.put("/api/config/message-templates", headers=h, json={"templates": []}),
    lambda c, h: c.put("/api/config/caisse", headers=h, json={"CAISSE_SHOPID": "1"}),
])
def test_ecriture_de_config_invalide_le_cache(client, appel):
    _, gc = fake_db(lambda sql, p: None)
    params_cache._etat.update(valeurs={"tva": "5.5"}, expire=float("inf"))
    with patch("app.api.config.get_cursor", gc):
        r = appel(client, _headers(admin=True))
    assert r.status_code == 200
    assert params_cache._etat["valeurs"] is None


def test_impression_une_requete_cache_chaud(client):
    t = {"id": 42, "ticket_code": "KP-000042", "client_id": 7, "client_nom": "Fictif", "client_prenom": "Jean",
         "client_tel": "0600000000", "client_points_fidelite": 120, "panne": "Batterie", "devis_estime": 59,
         "acompte": 0, "paye": 0, "statut": "En cours de réparation", "date_depot": None,
         "notes_impression": [{"contenu": "Note fictive", "auteur": "T", "important": False,
                               "date_creation": "2026-10-16T10:00:00"}]}
    cur, gc = fake_db(lambda sql, p: t if "FROM tickets t" in sql else [])
    params_cache._etat.update(valeurs={"fidelite_active": "1"}, expire=float("inf"))
    with patch("app.api.print_tickets.get_cursor", gc), patch.object(params_cache, "get_cursor", gc):
        for kind in ("client", "staff", "combined", "devis", "recu"):
            cur.executed.clear()
            r = client.get(f"/api/tickets/42/print/{kind}", headers=_headers())
            assert r.status_code == 200
            assert len(cur.executed) == 1, (kind, cur.sql())   # ticket + notes + points en une requête
    assert "notes_impression" in cur.executed[0][0] and "client_points_fidelite" in cur.executed[0][0]


# ═══ Création de ticket ═════════════════════════════════════════════

def test_creation_ticket_discord_et_apprentissage_apres_la_reponse(monkeypatch):
    from app.models import TicketCreate
    directs = []
    monkeypatch.setattr(tickets, "notif_nouveau_ticket", lambda *a: directs.append("discord"))
    monkeypatch.setattr(tickets, "learn_terms", lambda *a: directs.append("termes"))
    _, gc = fake_db(lambda sql, p: {"id": 5} if "RETURNING id" in sql else None)
    monkeypatch.setattr(tickets, "get_cursor", gc)
    import app.api.public_documents as pdoc
    monkeypatch.setattr(pdoc, "jeton_suivi", lambda tid: "j")
    bg = BackgroundTasks()
    out = tickets.create_ticket(TicketCreate(client_id=1, categorie="Smartphone", marque="Apple", modele="iPhone 12", panne="Batterie HS"), bg)
    assert out == {"id": 5, "ticket_code": "KP-000005"}
    assert directs == []   # rien d'externe dans le chemin de la réponse
    assert [t.func for t in bg.tasks] == [tickets.learn_terms, tickets.notif_nouveau_ticket]
    assert bg.tasks[1].args == ("KP-000005", "Apple iPhone 12", "Batterie HS")


# ═══ Téléphone normalisé ═══════════════════════════════════════════

def test_depot_distance_retrouve_le_client_tout_format(client):
    def handler(sql, p):
        if "kp_phone_key(telephone) = %s" in sql:
            return [{"id": 3, "telephone": "0612345678", "nom": "Fictif"}]
        if "RETURNING id" in sql:
            return {"id": 77}
        return None

    cur, gc = fake_db(handler)
    with patch("app.api.depot_distance.get_cursor", gc), patch("app.api.clients.get_cursor", gc):
        r = client.post("/api/depot-distance", json={"nom": "Autre", "telephone": "+33 6 12 34 56 78",
                                                     "email": "pirate@exemple.test", "panne": "Batterie HS"})
    assert r.status_code == 200, r.text
    s = cur.sql()
    cle = next(p for q, p in cur.executed if "kp_phone_key(telephone)" in q)
    assert cle == ("612345678",)
    assert not any(q.startswith("INSERT INTO clients") for q in s)
    maj = next(q for q in s if q.startswith("UPDATE clients"))
    # Public : nom/prénom complétés seulement, jamais l'email
    assert "email" not in maj and "CASE WHEN COALESCE(nom, '') = ''" in maj
    ticket = next(p for q, p in cur.executed if q.startswith("INSERT INTO tickets"))
    assert ticket[0] == 3


def test_depot_distance_nouveau_client_numero_canonique(client):
    def handler(sql, p):
        if "kp_phone_key" in sql:
            return []
        if "RETURNING id" in sql:
            return {"id": 12}
        return None

    cur, gc = fake_db(handler)
    with patch("app.api.depot_distance.get_cursor", gc), patch("app.api.clients.get_cursor", gc):
        r = client.post("/api/depot-distance", json={"nom": "Fictif", "telephone": "06 12 34 56 78"})
    assert r.status_code == 200
    ins = next(p for q, p in cur.executed if q.startswith("INSERT INTO clients"))
    assert ins[2] == "0612345678"


@pytest.mark.parametrize("q,attendu", [
    ("+33 6 12 34 56 78", ("public.kp_phone_key(telephone) = %s", "612345678")),
    ("06 12 34", ("public.kp_phone_digits(telephone) LIKE ANY(%s::text[])", "0711223344")),
    ("+33 7 11", ("public.kp_phone_digits(telephone) LIKE ANY(%s::text[])", "0711223344")),
    ("Dupont", ("telephone LIKE %s", "%Dupont%")),
])
def test_autocomplete_client_telephone_tout_format(client, q, attendu):
    from app.services.search import like_match
    cur, gc = fake_db(lambda sql, p: [])
    with patch("app.api.autocomplete.get_cursor", gc):
        r = client.get("/api/autocomplete/search", params={"categorie": "client", "q": q}, headers=_headers())
    assert r.status_code == 200
    sql, params = cur.executed[0]
    assert attendu[0] in sql
    if "LIKE ANY" in attendu[0]:
        motifs = next(x for x in params if isinstance(x, list))
        numero = "0612345678" if q.startswith("06") else attendu[1]
        assert any(like_match(m, numero) for m in motifs)
    else:
        assert attendu[1] in params


@pytest.mark.parametrize("saisie,numero_stocke,trouve", [
    ("+33 7 11", "0711223344", True),
    ("0033 7 11", "0711223344", True),
    ("+33 (0)7 11", "07 11 22 33 44", True),
    ("+ 33 7 11 22", "+33711223344", True),
    ("+33 6 12 34 56 7", "0612345678", True),        # 7 chiffres nationaux : encore partiel
    ("33 7 11", "0711223344", True),                 # sans + : les deux lectures
    ("33 7 11", "0633711000", True),
    ("06 12 34 56 7", "0612345678", True),           # 0 + 8 chiffres : partiel
    ("06 12 34", "0612345678", True),
    ("+33 7 11", "0611223344", False),
    ("+41 79 123", "+41791234567", True),
    ("+41 79 123", "0791234567", False),
])
def test_phone_lookup_numero_partiel(saisie, numero_stocke, trouve):
    from app.services.search import like_match, phone_digits, phone_lookup
    genre, val = phone_lookup(saisie)
    assert genre == "like"
    assert any(like_match(m, phone_digits(numero_stocke)) for m in val) is trouve


@pytest.mark.parametrize("saisie,cle", [
    ("+33 6 12 34 56 78", "612345678"), ("+33 (0)6 12 34 56 78", "612345678"),
    ("0033 6 12 34 56 78", "612345678"), ("06 12 34 56 78", "612345678"), ("612345678", "612345678"),
])
def test_phone_lookup_numero_complet(saisie, cle):
    from app.services.search import phone_lookup
    assert phone_lookup(saisie) == ("key", cle)


@pytest.mark.parametrize("saisie", ["", "12", "+33 7", "+33 71", "06"])
def test_phone_lookup_trop_court(saisie):
    from app.services.search import phone_lookup
    assert phone_lookup(saisie) is None


@pytest.mark.parametrize("telephone", ["06 12 34 56 78", "+33 6 12 34 56 78", "0033612345678", "06.12.34.56.78"])
def test_dedoublonnage_commande_vitrine_meme_numero(client, telephone):
    cur, gc = fake_db(lambda sql, p: {"id": 99} if "FROM demandes_commandes" in sql else None)
    with patch("app.api.iphone_tarifs.get_cursor", gc):
        r = client.post("/api/iphone-tarifs/passer-commande",
                        json={"nom": "Jean", "telephone": telephone, "modele": "iPhone 15", "prix": 729})
    assert r.status_code == 200 and r.json()["id"] == 99 and r.json()["deduped"] is True
    sql, params = cur.executed[0]
    assert "right(regexp_replace(telephone, '[^0-9]', '', 'g'), 9) = %s" in sql and params[0] == "612345678"


# ═══ Montants imprimés = calculer_montants ══════════════════════════

def _t(**kw):
    t = {"id": 1, "ticket_code": "KP-000001", "client_id": 1, "client_nom": "Fictif", "client_prenom": "Jean",
         "client_tel": "0600000000", "client_points_fidelite": 0, "notes_impression": [], "categorie": "Smartphone",
         "marque": "Apple", "modele": "iPhone 13", "panne": "Écran cassé", "date_depot": None,
         "devis_estime": 0, "tarif_final": 0, "acompte": 0, "paye": 0, "reduction_pourcentage": 0,
         "reduction_montant": 0, "reparation_supp": None, "issue": None, "statut": "En cours de réparation"}
    t.update(kw)
    return t


CAS = {
    "reduction_pct_acompte": _t(
        reparation_supp=json.dumps([{"label": "Forfait remplacement écran", "prix": 129}, {"label": "Diagnostic", "prix": 20}]),
        reduction_pourcentage=10, acompte=30),
    "reduction_montant": _t(
        reparation_supp=json.dumps([{"label": "Batterie", "prix": 59.9}]), reduction_montant=9.9),
    "devis_estime_sans_prix": _t(
        reparation_supp=json.dumps([{"label": "Forfait remplacement écran", "prix": 0}]), devis_estime=89, acompte=20),
    "devis_estime_sans_ligne": _t(panne=None, devis_estime=75),
    "refus_devis": _t(
        issue="refus_devis", acompte=10,
        reparation_supp=json.dumps([{"label": "Forfait remplacement écran", "prix": 129}, {"label": "Diagnostic", "prix": 25}])),
    "ancien_format_tarif_final": _t(panne="Batterie", devis_estime=59, tarif_final=50, reduction_montant=9),
    "ancien_format_tarif_final_pct": _t(panne="Batterie", devis_estime=80, tarif_final=72, reduction_pourcentage=10),
    "paye": _t(reparation_supp=json.dumps([{"label": "Batterie", "prix": 59}]), acompte=20, paye=1),
    "trop_percu": _t(reparation_supp=json.dumps([{"label": "Batterie", "prix": 59}]), acompte=80),
}


@pytest.mark.parametrize("nom", list(CAS))
def test_totaux_imprimes_egaux_a_calculer_montants(nom):
    t = CAS[nom]
    m = calculer_montants(t)
    lignes, tot = print_tickets._totaux(t)
    assert tot["total"] == m["total"] and tot["reste"] == m["reste"] and tot["acompte"] == m["acompte"]
    assert tot["paye"] == m["paye"]
    # Lignes − réduction = total imprimé (le document reste cohérent)
    assert round(sum(r["prix"] for r in lignes) - tot["reduction"], 2) == m["total"]
    total_txt = print_tickets._fp(m["total"])
    reste_txt = print_tickets._fp(m["reste"])
    for kind in ("client", "staff", "devis", "recu"):
        html = print_tickets.render_html(t, kind)
        assert f"{total_txt} €" in html, (nom, kind)
        if not m["paye"] and kind != "devis":
            assert f"RESTE À PAYER : {reste_txt} €" in html, (nom, kind)
    a4 = print_tickets._a4_document(t, "recu")
    assert f"<span>Total TTC</span><span>{total_txt} &euro;</span>" in a4


def test_refus_devis_seuls_les_frais_imprimes():
    html = print_tickets.render_html(CAS["refus_devis"], "recu")
    assert "Diagnostic" in html and "Forfait remplacement écran" not in html
    assert "RESTE À PAYER : 15,00 €" in html


def test_ancien_format_tarif_final_ligne_et_reduction():
    lignes, tot = print_tickets._totaux(CAS["ancien_format_tarif_final"])
    assert lignes[0]["prix"] == 59 and tot["reduction"] == 9 and tot["total"] == 50
    lignes, tot = print_tickets._totaux(CAS["ancien_format_tarif_final_pct"])
    assert lignes[0]["prix"] == 80 and tot["reduction"] == 8 and tot["total"] == 72


def test_impression_et_caisse_meme_total():
    from app.services.caisse import vente_ticket
    for t in CAS.values():
        assert vente_ticket(t)[0] == print_tickets._totaux(t)[1]["total"]


def test_reste_paye_tampon():
    html = print_tickets.render_html(CAS["paye"], "recu")
    assert "PAYÉ" in html and "RESTE À PAYER" not in html


# ═══ Rôle admin : code admin saisi sur ce poste ═════════════════════

def _role_db(role="admin", prouve=False, a_prolonger=False):
    def handler(sql, p):
        if "FROM membres_equipe m LEFT JOIN sessions_admin" in sql:
            return {"role": role, "prouve": prouve, "a_prolonger": a_prolonger} if role else None
        if sql.startswith("SELECT role FROM membres_equipe"):
            return {"role": role} if role else None
        return []
    return fake_db(handler)


def _stats(client, headers, gc):
    with patch("app.api.auth.get_cursor", gc), patch("app.api.admin.get_cursor", gc):
        return client.get("/api/admin/stats/top-clients?date_start=2026-01-01", headers=headers)


def test_role_admin_sans_code_refuse(client):
    cur, gc = _role_db(prouve=False)
    r = _stats(client, _headers("Patron"), gc)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "admin_requis"
    assert not any("INSERT INTO sessions_admin" in s for s in cur.sql())


def test_role_non_admin_refus_de_role(client):
    _, gc = _role_db(role="Technicien")
    r = _stats(client, _headers("Marina"), gc)
    assert r.status_code == 403 and r.json()["detail"] == "Admin requis"


def test_role_admin_poste_prouve(client):
    cur, gc = _role_db(prouve=True)
    r = _stats(client, _headers("Patron", sid="poste-1"), gc)
    assert r.status_code == 200
    q, p = next((q, p) for q, p in cur.executed if "LEFT JOIN sessions_admin" in q)
    assert p == ("poste-1", "Patron")
    assert not any("INSERT INTO sessions_admin" in s for s in cur.sql())


def test_role_admin_preuve_prolongee(client):
    cur, gc = _role_db(prouve=True, a_prolonger=True)
    assert _stats(client, _headers("Patron", sid="poste-1"), gc).status_code == 200
    ins = next(p for q, p in cur.executed if "INSERT INTO sessions_admin" in q)
    assert ins == ("poste-1", "code", auth.PREUVE_ADMIN_JOURS)


def test_role_admin_jeton_elevation_enregistre_la_preuve(client):
    cur, gc = _role_db(prouve=False)
    r = _stats(client, _headers("Patron", admin=True, sid="poste-2"), gc)
    assert r.status_code == 200
    ins = next(p for q, p in cur.executed if "INSERT INTO sessions_admin" in q)
    assert ins[:2] == ("poste-2", "code")


def test_marketing_meme_regle(client):
    _, gc = _role_db(prouve=False)
    with patch("app.api.auth.get_cursor", gc), patch("app.api.marketing.get_cursor", gc):
        r = client.get("/api/marketing/avis/stats", headers=_headers("Patron"))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "admin_requis"


def _jeton_ancien(nom):
    from jose import jwt
    from datetime import datetime, timedelta, timezone
    return jwt.encode({"sub": nom, "target": "accueil", "exp": datetime.now(timezone.utc) + timedelta(days=1)},
                      auth.JWT_SECRET, algorithm=auth.JWT_ALGORITHM)


def test_jeton_anterieur_repris_sans_couper_le_gerant(client):
    cur, gc = _role_db(prouve=False)
    tok = _jeton_ancien("Patron")
    r = _stats(client, {"Authorization": f"Bearer {tok}"}, gc)
    assert r.status_code == 200
    ins = next(p for q, p in cur.executed if "INSERT INTO sessions_admin" in q)
    assert ins[0] == auth._sid_ancien(tok) and ins[1] == "reprise"


def test_switch_user_garde_la_lignee(client):
    def handler(sql, p):
        if sql.startswith("SELECT 1 AS ok FROM membres_equipe"):
            return {"ok": 1}
        return None

    _, gc = fake_db(handler)
    with patch("app.api.auth.get_cursor", gc):
        r = client.post("/api/auth/switch-user", headers=_headers("Marina", sid="poste-9"), json={"utilisateur": "Patron"})
    assert r.status_code == 200
    assert decode_token(r.json()["access_token"])["sid"] == "poste-9"


def _switch_db():
    def handler(sql, p):
        if sql.startswith("SELECT 1 AS ok FROM membres_equipe"):
            return {"ok": 1}
        if sql.startswith("SELECT role FROM membres_equipe"):
            return {"role": "admin"} if p[0] == "Patron" else {"role": "Technicien"}
        return None
    return fake_db(handler)


def _switch(client, headers, vers):
    cur, gc = _switch_db()
    with patch("app.api.auth.get_cursor", gc):
        r = client.post("/api/auth/switch-user", headers=headers, json={"utilisateur": vers})
    return r, cur


_REVOQUE = "DELETE FROM sessions_admin WHERE sid = %s"


def test_switch_user_autre_membre_retire_la_preuve(client):
    # Patron a saisi le code ; Marina prend le poste : revenir sur Patron redemandera le code
    r, cur = _switch(client, _headers("Patron", sid="poste-9"), "Marina")
    assert r.status_code == 200
    assert (_REVOQUE, ("poste-9",)) in cur.executed
    assert not any("INSERT INTO sessions_admin" in s for s in cur.sql())


def test_switch_user_meme_membre_garde_la_preuve(client):
    r, cur = _switch(client, _headers("Patron", sid="poste-9"), "Patron")
    assert r.status_code == 200 and decode_token(r.json()["access_token"])["sid"] == "poste-9"
    assert not any("sessions_admin" in s for s in cur.sql())


def test_switch_user_jeton_anterieur_admin_reprise(client):
    # Gérant non coupé au déploiement : reprise si la session reste la sienne
    tok = _jeton_ancien("Patron")
    r, cur = _switch(client, {"Authorization": f"Bearer {tok}"}, "Patron")
    assert r.status_code == 200
    assert decode_token(r.json()["access_token"])["sid"] == auth._sid_ancien(tok)
    assert next(p for q, p in cur.executed if "INSERT INTO sessions_admin" in q)[1] == "reprise"
    # … mais pas si un autre membre prend la session
    r, cur = _switch(client, {"Authorization": f"Bearer {tok}"}, "Marina")
    assert r.status_code == 200 and decode_token(r.json()["access_token"])["sid"] == auth._sid_ancien(tok)
    assert (_REVOQUE, (auth._sid_ancien(tok),)) in cur.executed
    assert not any("INSERT INTO sessions_admin" in s for s in cur.sql())
    # Jeton antérieur d'un non-admin : aucune reprise
    tok2 = _jeton_ancien("Marina")
    _, cur2 = _switch(client, {"Authorization": f"Bearer {tok2}"}, "Patron")
    assert not any("INSERT INTO sessions_admin" in s for s in cur2.sql())


def test_switch_user_table_des_preuves_absente(client):
    import psycopg2

    class _Absente(psycopg2.Error):
        pgcode = "42P01"

    def handler(sql, p):
        if sql.startswith("SELECT 1 AS ok FROM membres_equipe"):
            return {"ok": 1}
        if sql.startswith("DELETE FROM sessions_admin"):
            return _Absente("relation sessions_admin does not exist")
        return None

    _, gc = fake_db(handler)
    with patch("app.api.auth.get_cursor", gc):
        r = client.post("/api/auth/switch-user", headers=_headers("Patron", sid="p"), json={"utilisateur": "Marina"})
    assert r.status_code == 200


def test_lock_admin_retire_la_preuve(client):
    cur, gc = fake_db(lambda sql, p: None)
    with patch("app.api.auth.get_cursor", gc):
        r = client.post("/api/admin/lock", headers=_headers("Patron", sid="poste-3"))
        assert client.post("/api/admin/lock").status_code == 401
    assert r.status_code == 200 and r.json() == {"success": True}
    assert cur.executed == [(_REVOQUE, ("poste-3",))]


def test_login_nouvelle_lignee():
    a, b = decode_token(create_token("accueil", "Patron")), decode_token(create_token("accueil", "Patron"))
    assert a["sid"] and b["sid"] and a["sid"] != b["sid"]


def test_verify_admin_enregistre_la_preuve(client):
    def handler(sql, p):
        if "ADMIN_PASSWORD" in sql:
            return {"valeur": "adm1n"}
        return None

    cur, gc = fake_db(handler)
    with patch("app.api.auth.get_cursor", gc):
        r = client.post("/api/admin/verify", headers=_headers("Patron", sid="poste-5"),
                        json={"login": "admin", "password": "adm1n"})
    assert r.status_code == 200
    assert next(p for q, p in cur.executed if "INSERT INTO sessions_admin" in q)[:2] == ("poste-5", "code")


def test_prechauffage_jamais_sans_pool_ouvert(monkeypatch):
    import app.database as db
    monkeypatch.setattr(db, "_pool", None)
    monkeypatch.setattr(db, "get_pool", lambda: (_ for _ in ()).throw(AssertionError("connexion ouverte")))
    db.prechauffer_pool()


def test_prechauffage_respecte_le_semaphore(monkeypatch):
    import threading
    import app.database as db

    class Conn:
        closed = 0

    class Pool:
        def __init__(self):
            self.ouvertes, self.rendues = 0, 0

        def getconn(self):
            self.ouvertes += 1
            return Conn()

        def putconn(self, conn, close=False):
            self.rendues += 1

    pool = Pool()
    slots = threading.BoundedSemaphore(db._MAXCONN)
    for _ in range(3):   # 3 requêtes en cours
        slots.acquire()
    monkeypatch.setattr(db, "_pool", pool)
    monkeypatch.setattr(db, "_slots", slots)
    db.prechauffer_pool()
    assert pool.ouvertes == pool.rendues == db._MAXCONN - 3
    for _ in range(3):
        slots.release()
    # Toutes les places sont rendues
    assert all(slots.acquire(blocking=False) for _ in range(db._MAXCONN))
    monkeypatch.setattr(db, "_pool", None)
