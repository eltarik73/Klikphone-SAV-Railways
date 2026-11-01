"""
Tri automatique des réparations oubliées : chaque jour, les dossiers ouverts (ni rendus ni
clôturés) déposés depuis plus de N jours (paramètre TRI_AUTO_JOURS, 60 par défaut, '0' = tri
coupé) passent en « Clôturé », avec une note et une ligne d'historique signées « Tri
automatique » : l'équipe voit que ce n'est pas un agent qui a clôturé.

Ce n'est pas une restitution : ni paiement, ni date_cloture (le CA et les réparations du jour
lisent date_cloture), ni message au client. L'ancien statut reste dans l'historique (retour à
la main possible). Un téléphone de prêt encore chez le client bloque le dossier : clôturé, il
resterait introuvable.

Un passage par jour au plus, même à plusieurs workers (verrou pg_advisory) ; vérification toutes
les heures en tâche de fond (demarrer_tri_quotidien), 2 minutes après le démarrage.
KP_TRI_AUTO=0 dans l'environnement empêche la tâche (tests, maintenance).

SQL : fragments fixes de ce module, valeurs en paramètres nommés.
"""

import logging
import os
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from app.database import get_cursor
from app.services import params as params_cache

logger = logging.getLogger("klikphone.nettoyage")

JOURS_DEFAUT = 60
JOURS_MIN = 30
JOURS_MAX = 3650
PARAM_JOURS = "TRI_AUTO_JOURS"        # '0' : tri coupé
PARAM_DERNIERE = "TRI_AUTO_DERNIERE"  # AAAA-MM-JJ du dernier passage
AUTEUR = "Tri automatique"
_VERROU = 731_002_060   # pg_advisory : un seul passage par jour, même à plusieurs workers

_FMT_TS = "%Y-%m-%d %H:%M:%S"


def ouvert_ancien_sql(t: str, seuil_ph: str) -> str:
    """Dossier ni rendu ni clôturé, déposé avant le seuil (texte UTC « AAAA-MM-JJ HH:MM:SS »,
    comparable au TIMESTAMP naïf en UTC date_depot)."""
    return (f"(COALESCE({t}.statut, '') NOT IN ('Rendu au client', 'Clôturé')"
            f" AND {t}.date_depot < {seuil_ph})")


def pret_dehors_sql(t: str) -> str:
    """Téléphone de prêt sorti et pas rendu (telephone_pret_rendu BOOLEAN, ou entier sur une
    ancienne base : comparé en texte)."""
    return (f"(COALESCE(btrim({t}.telephone_pret), '') <> ''"
            f" AND COALESCE({t}.telephone_pret_rendu::text, 'false') IN ('false', '0'))")


def seuil(jours: int, maintenant: Optional[datetime] = None) -> str:
    n = maintenant or datetime.now(timezone.utc)
    if n.tzinfo is not None:
        n = n.astimezone(timezone.utc).replace(tzinfo=None)
    return (n - timedelta(days=jours)).strftime(_FMT_TS)


def note(jours: int) -> str:
    """Note posée sur le dossier : dit que c'est le tri automatique, pas un agent."""
    return (f"Clôturé automatiquement : dossier déposé depuis plus de {jours} jours sans suite"
            " (tri automatique, pas un agent)")


def _horodatage_paris() -> str:
    """« JJ/MM HH:MM » de Paris pour le journal texte du ticket (comme api/tickets._horodatage)."""
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("Europe/Paris")).strftime("%d/%m %H:%M")
    except Exception:  # image sans base tz
        return datetime.now(timezone.utc).strftime("%d/%m %H:%M")


def _param(cur, cle: str) -> str:
    cur.execute("SELECT valeur FROM params WHERE cle = %s", (cle,))
    row = cur.fetchone()
    return str((row or {}).get("valeur") or "").strip()


def _ecrire(cur, cle: str, valeur: str):
    cur.execute("""INSERT INTO params (cle, valeur) VALUES (%s, %s)
                   ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur""", (cle, valeur))


def jours_configures(cur) -> int:
    """TRI_AUTO_JOURS lu en base : 0 = tri coupé ; sinon borné à [JOURS_MIN, JOURS_MAX]
    (une valeur illisible vaut le défaut, jamais un tri plus agressif que prévu)."""
    brut = _param(cur, PARAM_JOURS)
    if brut == "":
        return JOURS_DEFAUT
    try:
        n = int(brut)
    except ValueError:
        return JOURS_DEFAUT
    if n <= 0:
        return 0
    return min(max(n, JOURS_MIN), JOURS_MAX)


def cloturer(cur, jours: int, auteur: str = AUTEUR, horodatage: Optional[str] = None,
             ids: Optional[list] = None) -> dict:
    """Clôture tous les dossiers qui remplissent la règle (ou seulement `ids` parmi eux) :
    historique, note et mise à jour du ticket en une seule instruction. Les dossiers avec un
    prêt dehors sont laissés tels quels."""
    maintenant = datetime.now(timezone.utc).replace(tzinfo=None)
    p = {"ids": sorted({int(i) for i in ids}) if ids is not None else None,
         "seuil": seuil(jours, maintenant), "motif": f"tri automatique : plus de {jours} jours",
         "note": note(jours), "auteur": auteur, "ts": horodatage or _horodatage_paris(),
         "maintenant": maintenant.strftime(_FMT_TS)}
    cond, pret = ouvert_ancien_sql("t", "%(seuil)s"), pret_dehors_sql("t")
    cur.execute("SET LOCAL lock_timeout = '5s'")
    cur.execute(f"""
        WITH cibles AS (
            SELECT t.id, t.statut,
                   'Statut: ' || COALESCE(t.statut, '') || ' → Clôturé (' || %(motif)s
                   || CASE WHEN COALESCE(btrim(t.emplacement), '') <> ''
                           THEN ', emplacement ' || t.emplacement || ' libéré' ELSE '' END
                   || ') — par ' || %(auteur)s AS contenu
            FROM tickets t
            WHERE (%(ids)s::int[] IS NULL OR t.id = ANY(%(ids)s::int[])) AND {cond} AND NOT {pret}
            FOR UPDATE OF t SKIP LOCKED
        ),
        h AS (
            INSERT INTO historique (ticket_id, type, contenu)
            SELECT id, 'statut', contenu FROM cibles
        ),
        n AS (
            INSERT INTO notes_tickets (ticket_id, auteur, contenu, important, type_note, is_read)
            SELECT id, %(auteur)s, %(note)s, FALSE, 'note', TRUE FROM cibles
        ),
        u AS (
            UPDATE tickets t
               SET statut = 'Clôturé', emplacement = NULL, date_maj = %(maintenant)s,
                   historique = CASE WHEN COALESCE(btrim(t.historique), '') = ''
                                     THEN '[' || %(ts)s || '] ' || c.contenu
                                     ELSE rtrim(t.historique, E' \\t\\r\\n') || E'\\n[' || %(ts)s || '] ' || c.contenu
                                END
              FROM cibles c
             WHERE t.id = c.id
            RETURNING t.id, c.statut AS ancien
        )
        SELECT COALESCE(ancien, '') AS statut, COUNT(*) AS n FROM u GROUP BY 1 ORDER BY 2 DESC, 1
    """, p)
    par_statut = [{"statut": r["statut"], "n": int(r["n"])} for r in (cur.fetchall() or [])]
    return {"jours": jours, "clotures": sum(s["n"] for s in par_statut), "par_statut": par_statut}


def resume(r: dict) -> str:
    detail = ", ".join(f"{s['statut']} : {s['n']}" for s in r["par_statut"])
    return (f"{r['clotures']} dossier(s) de plus de {r['jours']} jours clôturé(s)"
            + (f" ({detail})" if detail else ""))


def _journaliser(cur, r: dict):
    """Trace admin (comptes seulement) ; un échec n'annule jamais la clôture."""
    cur.execute("SAVEPOINT kp_audit")
    try:
        cur.execute(
            """INSERT INTO admin_audit_log (user_login, user_target, action, target_type, target_id, details, ip_hash)
               VALUES ('auto', '', 'tickets_tri_auto', 'ticket', NULL, %s, '')""",
            (resume(r)[:500],),
        )
        cur.execute("RELEASE SAVEPOINT kp_audit")
    except Exception:
        cur.execute("ROLLBACK TO SAVEPOINT kp_audit")


def tri_automatique(aujourd_hui: Optional[date] = None) -> Optional[dict]:
    """Passage du jour : rien si le tri est coupé (TRI_AUTO_JOURS = 0), déjà fait aujourd'hui
    ou tenu par un autre worker. Renvoie les comptes, sinon None."""
    jour = aujourd_hui or date.today()
    with get_cursor() as cur:
        cur.execute("SELECT pg_try_advisory_xact_lock(%s) AS ok", (_VERROU,))
        if not (cur.fetchone() or {}).get("ok"):
            return None
        jours = jours_configures(cur)
        if not jours or _param(cur, PARAM_DERNIERE) == jour.isoformat():
            return None
        r = cloturer(cur, jours)
        _ecrire(cur, PARAM_DERNIERE, jour.isoformat())
        if r["clotures"]:
            _journaliser(cur, r)
    params_cache.invalidate()
    if r["clotures"]:
        logger.info("Tri automatique : %s", resume(r))
    return r


_tache = {"thread": None}


def _boucle(delai_initial: float, periode: float):
    time.sleep(delai_initial)
    while True:
        try:
            tri_automatique()
        except Exception as e:
            # Type seul : un message d'erreur SQL peut citer des valeurs
            logger.warning("Tri automatique : échec (%s)", type(e).__name__)
        time.sleep(periode)


def demarrer_tri_quotidien(delai_initial: float = 120, periode: float = 3600):
    """Tâche de fond (une par processus) : vérifie chaque heure si le passage du jour est dû."""
    if os.getenv("KP_TRI_AUTO") == "0":
        return
    t = _tache["thread"]
    if t is not None and t.is_alive():
        return
    t = threading.Thread(target=_boucle, args=(delai_initial, periode), daemon=True, name="tri_auto")
    _tache["thread"] = t
    t.start()
