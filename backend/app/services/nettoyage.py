"""
Tri des réparations oubliées : dossiers ouverts (ni rendus ni clôturés) déposés depuis plus de
N jours (60 par défaut), passés en « Clôturé » en une fois par l'admin (dashboard).

Une clôture de tri n'est pas une restitution : ni paiement, ni date_cloture (le CA et les
réparations du jour, lus sur date_cloture, n'en sont pas faussés), ni message au client.
Chaque dossier reçoit une ligne d'historique qui garde son ancien statut (retour possible à la
main) et une note « Clôturé car plus de 60 jours ». Un téléphone de prêt encore chez le client
bloque la clôture du dossier : il resterait sinon introuvable.

SQL : fragments fixes de ce module, valeurs en paramètres nommés.
"""

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional

JOURS_DEFAUT = 60
JOURS_MIN = 30
JOURS_MAX = 3650
APERCU_MAX = 1000
IDS_MAX = 5000

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
    return f"Clôturé car plus de {jours} jours"


def apercu(cur, jours: int) -> dict:
    """Ce que la clôture ferait (rien n'est modifié) : nombre par statut, dossiers bloqués par un
    prêt, et la liste du plus ancien au plus récent (APERCU_MAX lignes au plus)."""
    p = {"seuil": seuil(jours), "limite": APERCU_MAX}
    cond, pret = ouvert_ancien_sql("t", "%(seuil)s"), pret_dehors_sql("t")
    cur.execute(f"""
        SELECT COALESCE(t.statut, '') AS statut, COUNT(*) AS n,
               COUNT(*) FILTER (WHERE {pret}) AS bloques
        FROM tickets t WHERE {cond}
        GROUP BY 1 ORDER BY 2 DESC, 1
    """, p)
    par_statut = [{"statut": r["statut"], "n": int(r["n"]), "bloques": int(r["bloques"])}
                  for r in (cur.fetchall() or [])]
    cur.execute(f"""
        SELECT t.id, t.ticket_code, t.statut, t.date_depot, t.date_maj, t.technicien_assigne,
               t.emplacement, t.marque, t.modele, t.modele_autre, t.panne,
               c.nom AS client_nom, c.prenom AS client_prenom, {pret} AS pret_dehors
        FROM tickets t LEFT JOIN clients c ON c.id = t.client_id
        WHERE {cond}
        ORDER BY t.date_depot ASC, t.id ASC
        LIMIT %(limite)s
    """, p)
    tickets = [dict(r) for r in (cur.fetchall() or [])]
    total = sum(s["n"] for s in par_statut)
    return {
        "jours": jours, "seuil": p["seuil"], "total": total,
        "bloques": sum(s["bloques"] for s in par_statut),
        "par_statut": par_statut, "tickets": tickets, "tronque": total > len(tickets),
    }


def cloturer(cur, jours: int, ids: list, auteur: str, horodatage: str) -> dict:
    """Clôture les dossiers `ids` (ceux de l'aperçu) qui remplissent encore la règle au moment
    de l'écriture : déjà rendus, rouverts depuis, plus récents que le seuil ou avec un prêt
    dehors, ils sont laissés tels quels (comptés dans « ignores »). Une seule instruction :
    historique, note, mise à jour du ticket. horodatage = « JJ/MM HH:MM » de Paris (journal)."""
    demandes = sorted({int(i) for i in ids})
    now = datetime.now(timezone.utc).replace(tzinfo=None).strftime(_FMT_TS)
    p = {"ids": demandes, "seuil": seuil(jours), "motif": note(jours).lower(), "note": note(jours),
         "auteur": auteur, "ts": horodatage, "maintenant": now}
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
            WHERE t.id = ANY(%(ids)s) AND {cond} AND NOT {pret}
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
    clotures = sum(s["n"] for s in par_statut)
    return {"jours": jours, "clotures": clotures, "ignores": len(demandes) - clotures,
            "par_statut": par_statut}


def journaliser(cur, user: dict, ip: str, resultat: dict):
    """Trace admin (comptes seulement) ; un échec n'annule jamais la clôture."""
    resume = ", ".join(f"{s['statut']} : {s['n']}" for s in resultat["par_statut"])
    details = (f"{resultat['clotures']} dossier(s) de plus de {resultat['jours']} jours clôturé(s)"
               f" ; {resume or 'aucun'} ; ignorés : {resultat['ignores']}")
    ip_hash = hashlib.sha256(("kp:" + (ip or "")).encode("utf-8")).hexdigest()[:16] if ip else ""
    cur.execute("SAVEPOINT kp_audit")
    try:
        cur.execute(
            """INSERT INTO admin_audit_log (user_login, user_target, action, target_type, target_id, details, ip_hash)
               VALUES (%s, %s, 'tickets_cloture_anciens', 'ticket', NULL, %s, %s)""",
            (str(user.get("sub") or "")[:60], str(user.get("target") or "")[:30], details[:500], ip_hash),
        )
        cur.execute("RELEASE SAVEPOINT kp_audit")
    except Exception:
        cur.execute("ROLLBACK TO SAVEPOINT kp_audit")
