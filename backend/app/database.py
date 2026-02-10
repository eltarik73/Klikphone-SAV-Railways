"""
Database connection pool pour PostgreSQL/Supabase.
Utilise psycopg2 avec un pool de connexions pour des performances optimales.
Compatible avec la base existante Klikphone SAV.
"""

import os
import psycopg2
import psycopg2.pool
import psycopg2.extras
from contextlib import contextmanager

# Pool de connexions global
_pool = None


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

        _pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=2,
            maxconn=10,
            dsn=database_url,
            connect_timeout=10,
        )
    return _pool


@contextmanager
def get_db():
    """Context manager pour obtenir une connexion du pool.
    
    Usage:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT ...")
    """
    pool = get_pool()
    conn = pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)


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
