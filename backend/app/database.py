"""
Database connection pool pour PostgreSQL/Supabase.
Utilise psycopg2 avec un pool de connexions pour des performances optimales.
Compatible avec la base existante Klikphone SAV.
"""

import os
import threading
import psycopg2
import psycopg2.pool
import psycopg2.extras
from contextlib import contextmanager

# Pool de connexions global
_pool = None
_MINCONN = 10
_MAXCONN = 10
# Les routes `def` tournent dans le threadpool (40 threads) : sans file d'attente,
# ThreadedConnectionPool lève « connection pool exhausted » dès 11 requêtes simultanées.
_slots = threading.BoundedSemaphore(_MAXCONN)
_SLOT_TIMEOUT = 30
# Visible dans pg_stat_activity : le démarrage ne coupe que les sessions bloquées
# de cette application, jamais celles d'un autre client de la base.
APPLICATION_NAME = os.getenv("DB_APPLICATION_NAME", "klikphone-sav-api")


def get_pool():
    """Initialise et retourne le pool de connexions PostgreSQL."""
    global _pool
    if _pool is None:
        database_url = os.getenv("DATABASE_URL")
        if not database_url:
            raise RuntimeError("DATABASE_URL non définie")

        # Ajouter sslmode si absent (requis pour Supabase)
        if "sslmode=" not in database_url:
            sep = "&" if "?" in database_url else "?"
            database_url = f"{database_url}{sep}sslmode=require"

        # maxconn=10 : sous la limite Supabase (free=60, paid=200 par projet).
        # minconn : psycopg2 ferme toute connexion rendue au-delà de minconn
        # connexions inactives ; trop bas, chaque rafale rouvre des connexions TLS.
        # Une seule connexion ouverte à la création (le démarrage n'attend pas
        # 10 ouvertures TLS) : les autres à la demande ou par prechauffer_pool(),
        # puis gardées jusqu'à _MINCONN inactives.
        extra = {} if "application_name=" in database_url else {"application_name": APPLICATION_NAME}
        _pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=1,
            maxconn=_MAXCONN,
            dsn=database_url,
            connect_timeout=10,
            **extra,
            keepalives=1,
            keepalives_idle=30,
            keepalives_interval=10,
            keepalives_count=5,
        )
        _pool.minconn = _MINCONN
    return _pool


def prechauffer_pool():
    """Ouvre les connexions manquantes jusqu'à _MINCONN (thread de fond, après le démarrage).

    Chaque connexion passe par le sémaphore : jamais plus de _MAXCONN en tout,
    une requête n'est jamais privée d'une place. S'arrête dès que le pool est occupé.
    Seulement un pool déjà ouvert par le démarrage (jamais de connexion nouvelle
    vers DATABASE_URL quand get_cursor est simulé, en test).
    """
    pool = _pool
    if pool is None:
        return
    pris = []
    try:
        for _ in range(_MINCONN):
            if not _slots.acquire(blocking=False):
                break
            try:
                pris.append(pool.getconn())
            except Exception:
                _slots.release()
                break
    finally:
        for conn in pris:
            try:
                pool.putconn(conn, close=bool(conn.closed))
            finally:
                _slots.release()


def _checked_conn(pool):
    """Connexion du pool, validée par le SET statement_timeout (1 seul aller-retour).

    Une connexion coupée côté Supabase (idle timeout) est rendue au pool avec
    close=True : sans ce putconn elle resterait comptée comme utilisée et le
    pool finirait en « connection pool exhausted ». Les connexions inactives
    meurent souvent ensemble : on peut en jeter jusqu'à minconn avant d'en
    ouvrir une neuve.
    """
    attempts = pool.minconn + 1
    for attempt in range(attempts):
        conn = pool.getconn()
        try:
            with conn.cursor() as cur:
                cur.execute("SET statement_timeout = '30s'")
            return conn
        except Exception:
            pool.putconn(conn, close=True)
            if attempt == attempts - 1:
                raise


@contextmanager
def get_db():
    """Context manager pour obtenir une connexion du pool.
    
    Usage:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT ...")
    """
    pool = get_pool()
    if not _slots.acquire(timeout=_SLOT_TIMEOUT):
        raise RuntimeError("Base de données saturée : aucune connexion libre depuis 30 s")
    try:
        conn = _checked_conn(pool)
        try:
            yield conn
            conn.commit()
        except Exception:
            if not conn.closed:
                conn.rollback()
            raise
        finally:
            pool.putconn(conn, close=bool(conn.closed))
    finally:
        _slots.release()


@contextmanager
def get_cursor(dict_cursor=True):
    """Context manager pour obtenir directement un curseur.
    
    Usage:
        with get_cursor() as cur:
            cur.execute("SELECT * FROM tickets")
            rows = cur.fetchall()
    """
    with get_db() as conn:
        cursor_factory = psycopg2.extras.RealDictCursor if dict_cursor else None
        with conn.cursor(cursor_factory=cursor_factory) as cur:
            yield cur


def close_pool():
    """Ferme proprement le pool de connexions."""
    global _pool
    if _pool:
        _pool.closeall()
        _pool = None
