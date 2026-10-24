"""Emprunt du pool sans aller-retour et contrôle du rôle admin en cache.

- database._checked_conn : statement_timeout fixé à l'ouverture (options libpq) ; une
  connexion n'est sondée que si elle est restée inactive plus de SONDE_APRES_S, a eu une
  erreur, ou a été rendue avant qu'une connexion morte soit trouvée. Les connexions
  mortes restent détectées et jetées (fuite du pool du 15/10).
- auth.exiger_role_admin : succès gardé 30 s par (sid, membre, jeton d'élévation), vidé
  par toute révocation (verrouillage du mode admin, changement de membre, équipe modifiée).

Tests « reel » sur base PostgreSQL JETABLE (migrations du lifespan rejouées) :
    KP_FICHE_DATABASE_URL="postgresql://postgres:<mot_de_passe>@127.0.0.1:5432/kp_fiche?sslmode=disable" \
        pytest tests/test_connexion_role_admin.py
"""

import importlib.util
import os
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

import psycopg2
import psycopg2.extensions
import pytest
from fastapi.testclient import TestClient

from app.api import auth
from app.api.auth import create_admin_token, create_token, decode_token

DB_URL = os.getenv("KP_FICHE_DATABASE_URL")
DB_SOURCE = Path(__file__).resolve().parents[1] / "app" / "database.py"
IDLE = psycopg2.extensions.TRANSACTION_STATUS_IDLE
INTRANS = psycopg2.extensions.TRANSACTION_STATUS_INTRANS


# ═══ Pool : options de connexion (sans base) ═══════════════════════

def test_pool_pose_le_timeout_dans_les_options(monkeypatch):
    import app.database as db
    vus = {}

    class Pool:
        def __init__(self, **kw):
            vus.update(kw)

    monkeypatch.setattr(db, "_pool", None)
    monkeypatch.setattr(db.psycopg2.pool, "ThreadedConnectionPool", Pool)
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@h/base")
    db.get_pool()
    assert vus["options"] == f"-c statement_timeout={db.STATEMENT_TIMEOUT_MS}"
    assert db.STATEMENT_TIMEOUT_MS == 30000 and vus["connection_factory"] is db._Connexion
    monkeypatch.setattr(db, "_pool", None)


def test_pool_options_refusees_repli_sur_le_set(monkeypatch):
    """Pooler qui refuse le paramètre de démarrage « options » : repli sur le SET à chaque emprunt."""
    import app.database as db
    appels = []

    class Pool:
        def __init__(self, **kw):
            appels.append(kw)
            if "options" in kw:
                raise psycopg2.OperationalError("unsupported startup parameter: options")

    monkeypatch.setattr(db, "_pool", None)
    monkeypatch.setattr(db, "_timeout_par_options", None)
    monkeypatch.setattr(db.psycopg2.pool, "ThreadedConnectionPool", Pool)
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@h/base")
    db.get_pool()
    assert len(appels) == 2 and "options" not in appels[1] and db._timeout_par_options is False
    monkeypatch.setattr(db, "_pool", None)


def test_pool_autre_erreur_de_connexion_remontee(monkeypatch):
    import app.database as db

    class Pool:
        def __init__(self, **kw):
            raise psycopg2.OperationalError("password authentication failed")

    monkeypatch.setattr(db, "_pool", None)
    monkeypatch.setattr(db.psycopg2.pool, "ThreadedConnectionPool", Pool)
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@h/base")
    with pytest.raises(psycopg2.OperationalError):
        db.get_pool()
    monkeypatch.setattr(db, "_pool", None)


def test_connexion_sans_horodatage_toujours_sondee():
    import app.database as db

    class Nue:
        pass

    assert db._a_sonder(Nue())


# ═══ Pool : base réelle ════════════════════════════════════════════

@pytest.fixture
def module_db(monkeypatch):
    """Copie neuve de app/database.py (son propre pool, ses propres réglages) sur la base de test."""
    if not DB_URL:
        pytest.skip("KP_FICHE_DATABASE_URL non définie (base PostgreSQL de test jetable)")
    copies = []

    def charger(**env):
        for k, v in env.items():
            monkeypatch.setenv(k, str(v))
        monkeypatch.setenv("DATABASE_URL", DB_URL)
        spec = importlib.util.spec_from_file_location(f"kp_db_essai_{len(copies)}", DB_SOURCE)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        copies.append(mod)
        return mod

    yield charger
    for mod in copies:
        mod.close_pool()


def _pid(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT pg_backend_pid()")
        return cur.fetchone()[0]


def _tuer(*pids):
    with psycopg2.connect(DB_URL) as admin:
        with admin.cursor() as cur:
            cur.execute("SELECT pg_terminate_backend(pid) FROM unnest(%s::int[]) AS pid", (list(pids),))
    admin.close()
    time.sleep(0.2)


def _vieillir(mod, secondes=60):
    """Simule une inactivité : connexions libres rendues il y a `secondes`."""
    for conn in mod._pool._pool:
        conn.kp_rendue -= secondes


def test_reel_emprunt_sans_aller_retour(module_db):
    db = module_db()
    with db.get_db() as conn:          # premier emprunt : vérifie que le serveur applique les options
        pid = _pid(conn)
    assert db._timeout_par_options is True
    with db.get_db() as conn:          # connexion rendue à l'instant : rien n'est envoyé
        assert conn.info.transaction_status == IDLE
        assert _pid(conn) == pid
        with conn.cursor() as cur:
            cur.execute("SHOW statement_timeout")
            assert cur.fetchone()[0] == "30s"   # posé par les options, sans SET
    # Ancien fonctionnement (serveur qui ignore les options) : un aller-retour de plus par emprunt
    db._timeout_par_options = False
    with db.get_db() as conn:
        assert conn.info.transaction_status == INTRANS
        with conn.cursor() as cur:
            cur.execute("SHOW statement_timeout")
            assert cur.fetchone()[0] == "30s"


def test_reel_statement_timeout_effectif(module_db):
    db = module_db(KP_STATEMENT_TIMEOUT_MS=500)
    debut = time.monotonic()
    with pytest.raises(psycopg2.errors.QueryCanceled):
        with db.get_db() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT pg_sleep(3)")
    assert time.monotonic() - debut < 2.5
    # Erreur de la base : la connexion est sondée au prochain emprunt, puis resservie
    libre = db._pool._pool[-1]
    assert libre.kp_suspecte is True
    with db.get_db() as conn:
        assert conn is libre and conn.info.transaction_status == INTRANS   # sonde envoyée
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
    assert libre.kp_suspecte is False
    assert not db._pool._used


def test_reel_connexion_morte_detectee_apres_inactivite(module_db):
    db = module_db()
    with db.get_db() as conn:
        pid = _pid(conn)
    _tuer(pid)
    _vieillir(db)
    with db.get_db() as conn:
        assert _pid(conn) != pid          # connexion morte jetée, une neuve prêtée
    assert not db._pool._used and all(not c.closed for c in db._pool._pool)


def test_reel_connexions_mortes_ensemble(module_db):
    """Une connexion morte trouvée : celles rendues avant sont sondées même sans inactivité."""
    db = module_db()
    with db.get_db() as a:
        with db.get_db() as b:
            pids = {_pid(a), _pid(b)}
    _tuer(*pids)
    db._pool._pool[-1].kp_rendue -= 60   # seule la prochaine prêtée a « vieilli »
    with db.get_db() as conn:
        assert _pid(conn) not in pids
    with db.get_db() as a:
        with db.get_db() as b:
            assert not ({_pid(a), _pid(b)} & pids)
    assert not db._pool._used


def test_reel_connexion_morte_pendant_la_fenetre(module_db):
    """Coupée moins de SONDE_APRES_S après usage : la requête échoue, la connexion est jetée
    (jamais rendue comme utilisée) et la suivante fonctionne."""
    db = module_db()
    with db.get_db() as conn:
        pid = _pid(conn)
    _tuer(pid)
    with pytest.raises(psycopg2.OperationalError):
        with db.get_db() as conn:
            _pid(conn)
    assert not db._pool._used
    with db.get_db() as conn:
        assert _pid(conn) != pid


def test_reel_sonde_apres_le_delai(module_db):
    db = module_db(KP_DB_SONDE_APRES_S=0)
    with db.get_db() as conn:
        pass
    time.sleep(0.01)
    with db.get_db() as conn:
        assert conn.info.transaction_status == INTRANS


# ═══ Rôle admin en cache (base simulée) ════════════════════════════

class _Cur:
    def __init__(self, handler):
        self.handler, self.executed, self._res = handler, [], None
        self.description = None

    def execute(self, sql, params=None):
        sql = " ".join(sql.split())
        self.executed.append((sql, params))
        self._res = self.handler(sql, params)

    def fetchone(self):
        r = self._res
        return r[0] if isinstance(r, list) and r else (None if isinstance(r, list) else r)

    def fetchall(self):
        r = self._res
        return r if isinstance(r, list) else ([r] if r else [])

    def lectures_role(self):
        return sum("LEFT JOIN sessions_admin" in q for q, _ in self.executed)


class _Base:
    """Rôle et preuve modifiables en cours de test."""

    def __init__(self, role="admin", prouve=True, reste_s=86400.0):
        self.role, self.prouve, self.reste_s = role, prouve, reste_s
        self.cur = _Cur(self.handler)

    def handler(self, sql, p):
        if "LEFT JOIN sessions_admin" in sql:
            if not self.role:
                return None
            return {"role": self.role, "prouve": self.prouve, "a_prolonger": False,
                    "reste_s": self.reste_s if self.prouve else None}
        if sql.startswith("DELETE FROM sessions_admin WHERE sid"):
            self.prouve = False
        if "SELECT 1 AS ok FROM membres_equipe" in sql:
            return {"ok": 1}
        if sql.startswith("UPDATE membres_equipe"):
            self.role = p[0]
        return []

    @contextmanager
    def gc(self, *a, **k):
        yield self.cur


def _h(user="Patron", sid="poste-1", elevation=False):
    tok = create_token("accueil", user, sid=sid)
    h = {"Authorization": f"Bearer {tok}", "X-Forwarded-For": "10.0.0.9"}
    if elevation:
        h["X-Admin-Token"] = create_admin_token(decode_token(tok))
    return h


@contextmanager
def _base(base):
    with patch("app.api.auth.get_cursor", base.gc), patch("app.api.admin.get_cursor", base.gc), \
            patch("app.api.team.get_cursor", base.gc):
        yield


def _stats(client, h):
    return client.get("/api/admin/stats/top-clients?date_start=2026-01-01", headers=h)


def test_role_admin_lu_une_fois_puis_en_cache(client):
    base = _Base()
    with _base(base):
        h = _h()
        assert [_stats(client, h).status_code for _ in range(4)] == [200] * 4
    assert base.cur.lectures_role() == 1


def test_role_admin_cache_par_sid_membre_et_jeton(client):
    base = _Base()
    with _base(base):
        assert _stats(client, _h(sid="poste-1")).status_code == 200
        assert _stats(client, _h(sid="poste-2")).status_code == 200
        assert _stats(client, _h(sid="poste-1", elevation=True)).status_code == 200
        assert _stats(client, _h(user="Autre", sid="poste-1")).status_code == 200
    assert base.cur.lectures_role() == 4


def test_verrouillage_du_mode_admin_revoque_aussitot(client):
    base = _Base()
    h = _h()
    with _base(base):
        assert _stats(client, h).status_code == 200
        assert client.post("/api/admin/lock", headers=h).status_code == 200
        r = _stats(client, h)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "admin_requis"


def test_changement_de_membre_revoque_aussitot(client):
    base = _Base()
    h = _h()
    with _base(base):
        assert _stats(client, h).status_code == 200
        assert client.post("/api/auth/switch-user", headers=h, json={"utilisateur": "Marina"}).status_code == 200
        r = _stats(client, h)   # retour sur le jeton du gérant : le code est redemandé
    assert r.status_code == 403 and r.json()["detail"]["code"] == "admin_requis"


def test_equipe_modifiee_revoque_aussitot(client):
    base = _Base()
    h = _h()
    with _base(base):
        assert _stats(client, h).status_code == 200
        assert client.patch("/api/team/1", headers=h, json={"role": "Technicien"}).status_code == 200
        r = _stats(client, h)
    assert r.status_code == 403 and r.json()["detail"] == "Admin requis"


def test_equipe_membre_supprime_revoque_aussitot(client):
    base = _Base()
    h = _h()
    with _base(base):
        assert _stats(client, h).status_code == 200
        assert client.delete("/api/team/1", headers=h).status_code == 200
        base.role = None
        assert _stats(client, h).status_code == 403


def test_revocation_pendant_le_controle_rien_n_est_garde(client, monkeypatch):
    """Lecture faite avant la révocation, rendue après : le succès n'est pas mis en cache."""
    base = _Base()
    lire = auth._role_et_preuve

    def lecture_puis_revocation(nom, sid):
        row = lire(nom, sid)
        auth.revoquer_preuve_admin(sid)   # un autre onglet verrouille pendant ce temps
        return row

    monkeypatch.setattr(auth, "_role_et_preuve", lecture_puis_revocation)
    h = _h()
    with _base(base):
        assert _stats(client, h).status_code == 200
        monkeypatch.setattr(auth, "_role_et_preuve", lire)
        r = _stats(client, h)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "admin_requis"


def test_role_admin_cache_expire_apres_30_s(client, monkeypatch):
    base = _Base()
    t = [1000.0]
    monkeypatch.setattr(auth, "monotonic", lambda: t[0])
    h = _h()
    with _base(base):
        assert _stats(client, h).status_code == 200
        t[0] += 29
        assert _stats(client, h).status_code == 200
        assert base.cur.lectures_role() == 1
        t[0] += 2
        base.role = "Technicien"   # changé sans passer par l'API : vu à l'expiration
        assert _stats(client, h).status_code == 403
    assert base.cur.lectures_role() == 2


def test_role_admin_cache_borne_par_l_expiration_de_la_preuve(client, monkeypatch):
    base = _Base(reste_s=5.0)
    t = [1000.0]
    monkeypatch.setattr(auth, "monotonic", lambda: t[0])
    h = _h()
    with _base(base):
        assert _stats(client, h).status_code == 200
        t[0] += 6
        base.prouve = False
        assert _stats(client, h).status_code == 403


def test_refus_jamais_en_cache(client):
    base = _Base(prouve=False)
    h = _h()
    with _base(base):
        assert _stats(client, h).status_code == 403
        base.prouve = True          # code saisi sur un autre onglet
        assert _stats(client, h).status_code == 200
        base.role = "Technicien"
        assert _stats(client, _h(user="Marina")).status_code == 403
        assert _stats(client, _h(user="Marina")).status_code == 403
    assert base.cur.lectures_role() == 4


def test_cache_borne_en_taille(monkeypatch):
    monkeypatch.setattr(auth, "_ROLE_ADMIN_CACHE_MAX", 3)
    for i in range(10):
        auth._garder_role_admin((f"s{i}", "Patron", ""), auth._roles_admin_generation, 30)
    assert len(auth._roles_admin) <= 3 and auth._role_admin_en_cache(("s9", "Patron", ""))


# ═══ Rôle admin : base réelle ══════════════════════════════════════

@pytest.fixture(scope="module")
def reel():
    if not DB_URL:
        pytest.skip("KP_FICHE_DATABASE_URL non définie (base PostgreSQL de test jetable)")
    import psycopg2.extras
    import psycopg2.pool
    import app.database

    pool = psycopg2.pool.ThreadedConnectionPool(1, 8, DB_URL)
    lectures = []

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
    lire = auth._role_et_preuve

    def compte(nom, sid):
        lectures.append(sid)
        return lire(nom, sid)

    mp.setattr(auth, "_role_et_preuve", compte)
    from app.main import app as fastapi_app
    try:
        with TestClient(fastapi_app) as c:   # lifespan : schéma + migrations
            yield {"c": c, "cur": vrai_cursor, "lectures": lectures}
    finally:
        mp.undo()
        pool.closeall()


def _sql(reel, sql, *params):
    with reel["cur"]() as cur:
        cur.execute(sql, params)
        return cur.fetchall() if cur.description else None


def test_reel_role_admin_cache_et_revocations(reel):
    c, lectures = reel["c"], reel["lectures"]
    nom, sid = "Gérant Essai Cache", "poste-essai-cache"
    _sql(reel, "DELETE FROM membres_equipe WHERE nom = %s", nom)
    mid = _sql(reel, "INSERT INTO membres_equipe (nom, role, couleur, actif) VALUES (%s, 'admin', '#7C3AED', 1) "
                     "RETURNING id", nom)[0]["id"]
    preuve = ("INSERT INTO sessions_admin (sid, origine, expire) VALUES (%s, 'code', NOW() + INTERVAL '30 days') "
              "ON CONFLICT (sid) DO UPDATE SET expire = EXCLUDED.expire")
    try:
        _sql(reel, preuve, sid)
        h = _h(user=nom, sid=sid)
        lectures.clear()
        assert [_stats(c, h).status_code for _ in range(3)] == [200] * 3
        assert len(lectures) == 1
        # Verrouillage : la preuve est supprimée, la requête suivante est refusée aussitôt
        assert c.post("/api/admin/lock", headers=h).status_code == 200
        assert not _sql(reel, "SELECT 1 FROM sessions_admin WHERE sid = %s", sid)
        r = _stats(c, h)
        assert r.status_code == 403 and r.json()["detail"]["code"] == "admin_requis"
        # Code de nouveau prouvé, puis rôle retiré par l'équipe : refus aussitôt
        _sql(reel, preuve, sid)
        assert _stats(c, h).status_code == 200
        assert c.patch(f"/api/team/{mid}", headers=h, json={"role": "Technicien"}).status_code == 200
        r = _stats(c, h)
        assert r.status_code == 403 and r.json()["detail"] == "Admin requis"
    finally:
        _sql(reel, "DELETE FROM sessions_admin WHERE sid = %s", sid)
        _sql(reel, "DELETE FROM membres_equipe WHERE id = %s", mid)
        auth.oublier_roles_admin()
