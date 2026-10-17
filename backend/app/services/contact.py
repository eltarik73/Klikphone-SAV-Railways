"""
« Client contacté » : une seule vérité pour la fiche, le scan, le dashboard, l'étagère
et la file atelier.

Un contact est une note tracée dans notes_tickets DEPUIS LE DERNIER CHANGEMENT DE STATUT
(dernière ligne d'historique « Statut: X → Y — par … », sinon le dépôt) :
  sms      → SMS parti (POST /api/notifications/sms, message-log) ; 'sms_echec' jamais compté ;
  email, whatsapp → idem à l'envoi ;
  appel    → POST /api/tickets/{id}/contact ou relance d'étagère par téléphone ;
  relance  → anciennes notes de l'étagère : appel si le texte commence par « Appel téléphonique »,
             sinon ignorée.

La borne est la ligne « Statut: … » de la table historique : change_status l'écrit, et les
autres chemins qui changent le statut passent par historiser_statut() — commande de pièce
(api/parts), réception de pièce (api/parts), devis accepté en ligne (api/suivi), validation
ou refus d'un pré-enregistrement (api/depot_distance). Sans cette ligne, un SMS envoyé AVANT
le changement resterait affiché comme « contacté » après.

Calculé en SQL dans la requête de liste elle-même (sous-requête corrélée, aucun paramètre,
aucun ORDER BY : index idx_notes_tickets_type (ticket_id, type_note) et
idx_historique_ticket_id) : pas de N+1.
Forme renvoyée par lire() :
  {"depuis_statut": bool,
   "dernier": {"canal": "sms"|"email"|"whatsapp"|"appel", "date": ISO, "auteur": str|None} | None,
   "canaux": {"sms": ISO|None, "email": ISO|None, "whatsapp": ISO|None, "appel": ISO|None}}
"""

import json
from datetime import datetime

CANAUX = ("sms", "email", "whatsapp", "appel")
# Note écrite par POST /api/tickets/{id}/contact (type_note 'appel')
CONTENU_APPEL = "Appel téléphonique — client contacté"
# Anciennes relances d'étagère notées « relance » : seul l'appel est un contact
PREFIXE_APPEL = "Appel téléphonique"
_TYPES_SQL = "('sms', 'email', 'whatsapp', 'appel', 'relance')"
# En cas d'égalité d'horodatage entre deux canaux (même transaction) : l'appel d'abord.
# Le canal « dernier » ET son auteur suivent cet ordre (cf. lire()).
_ORDRE_DERNIER = ("appel", "sms", "whatsapp", "email")


def depuis_sql(t: str = "t") -> str:
    """Horodatage du dernier changement de statut (table historique), sinon le dépôt.
    Texte fixe sans placeholder : utilisable avec des paramètres positionnels ou nommés."""
    return (f"COALESCE((SELECT MAX(h.date_creation) FROM historique h"
            f" WHERE h.ticket_id = {t}.id AND starts_with(h.contenu, 'Statut:')), {t}.date_depot)")


def colonne_sql(t: str = "t") -> str:
    """`, (…) AS contact_brut` à ajouter au SELECT d'une liste de tickets (alias de la table : t).

    JSON {sms, email, whatsapp, appel, derniers} : dernière date de chaque canal depuis le
    dernier changement de statut, et `derniers` = les notes comptées portant cette toute
    dernière date ([{canal, auteur, id}], plusieurs en cas d'égalité d'horodatage) ; lire()
    y choisit l'auteur du canal retenu. Une seule lecture des notes par ticket (agrégats
    FILTER), plus un accès par l'index pour les auteurs — sans ORDER BY (la file atelier
    découpe son SQL dessus).
    """
    types = _TYPES_SQL
    comptee = f"(a.type_note <> 'relance' OR starts_with(a.contenu, '{PREFIXE_APPEL}'))"
    return (
        f", (SELECT json_build_object("
        f"'sms', MAX(n.date_creation) FILTER (WHERE n.type_note = 'sms'),"
        f" 'email', MAX(n.date_creation) FILTER (WHERE n.type_note = 'email'),"
        f" 'whatsapp', MAX(n.date_creation) FILTER (WHERE n.type_note = 'whatsapp'),"
        f" 'appel', MAX(n.date_creation) FILTER (WHERE n.type_note IN ('appel', 'relance')),"
        f" 'derniers', (SELECT json_agg(json_build_object('canal', a.type_note, 'auteur', a.auteur, 'id', a.id))"
        f" FROM notes_tickets a WHERE a.ticket_id = {t}.id"
        f" AND a.date_creation = MAX(n.date_creation) AND a.type_note IN {types} AND {comptee}))"
        f" FROM notes_tickets n WHERE n.ticket_id = {t}.id AND n.type_note IN {types}"
        f" AND (n.type_note <> 'relance' OR starts_with(n.contenu, '{PREFIXE_APPEL}'))"
        f" AND n.date_creation >= {depuis_sql(t)}) AS contact_brut"
    )


def _iso(v):
    """Date ISO de la même forme que les autres dates de l'API (isoformat Python : microsecondes
    sur 6 chiffres, ex. derniere_relance, date_depot). json_build_object renvoie le texte de
    PostgreSQL, qui tronque les zéros finaux (« …14.16517 ») : on le relit et on le réémet."""
    if v is None or v == "":
        return None
    if hasattr(v, "isoformat"):
        return v.isoformat()
    s = str(v)
    try:
        return datetime.fromisoformat(s).isoformat()
    except ValueError:
        return s


def _canal_note(type_note) -> str:
    """Canal d'une note comptée : les anciennes relances « Appel téléphonique » sont des appels."""
    return "appel" if type_note == "relance" else (type_note or "")


def _auteur_dernier(derniers, canal):
    """Auteur de la dernière note du canal retenu ; à horodatage égal dans ce canal, la plus
    récente (id le plus grand). Jamais l'auteur d'un autre canal."""
    candidats = [d for d in (derniers or []) if isinstance(d, dict) and _canal_note(d.get("canal")) == canal]
    if not candidats:
        return None
    return max(candidats, key=lambda d: d.get("id") or 0).get("auteur") or None


def lire(brut) -> dict:
    """Objet contact à partir de la colonne contact_brut (dict JSON, texte JSON ou None)."""
    if isinstance(brut, (str, bytes)):
        try:
            brut = json.loads(brut)
        except ValueError:
            brut = None
    b = brut if isinstance(brut, dict) else {}
    canaux = {c: _iso(b.get(c)) for c in CANAUX}
    dernier = None
    dates = [d for d in canaux.values() if d]
    if dates:
        plus_recente = max(dates)
        canal = next(c for c in _ORDRE_DERNIER if canaux[c] == plus_recente)
        dernier = {"canal": canal, "date": plus_recente, "auteur": _auteur_dernier(b.get("derniers"), canal)}
    return {"depuis_statut": bool(dates), "dernier": dernier, "canaux": canaux}


def poser(row) -> dict:
    """Ligne de ticket (dict ou RealDictRow) → dict avec `contact` à la place de contact_brut."""
    d = dict(row)
    d["contact"] = lire(d.pop("contact_brut", None))
    return d


def lire_ticket(cur, ticket_id: int) -> dict:
    """Objet contact d'un seul ticket (après l'écriture d'une note)."""
    cur.execute(f"SELECT t.id {colonne_sql('t')} FROM tickets t WHERE t.id = %s", (ticket_id,))
    row = cur.fetchone()
    return lire(row["contact_brut"] if row else None)


def inserer_appel(cur, ticket_id: int, auteur: str, contenu: str) -> int:
    """Note 'appel' (client joint ou tenté par téléphone) ; renvoie son id."""
    cur.execute("""
        INSERT INTO notes_tickets (ticket_id, auteur, contenu, important, type_note)
        VALUES (%s, %s, %s, FALSE, 'appel') RETURNING id
    """, (ticket_id, auteur, contenu))
    return cur.fetchone()["id"]


# ─── Ligne d'historique qui borne le contact ───────────────────────────

def ligne_statut(ancien: str, nouveau: str, auteur: str, precision: str = "") -> str:
    """« Statut: X → Y[ (précision)] — par Z », le format de change_status (api/tickets)."""
    return f"Statut: {ancien} → {nouveau}{precision} — par {auteur}"


def historiser_statut(cur, ticket_id: int, ancien: str, nouveau: str, auteur: str, precision: str = "") -> str:
    """Trace un changement de statut fait hors de change_status (table historique, type 'statut')
    pour que le contact reparte de zéro ; renvoie la ligne écrite. Jamais de try/except : une
    erreur SQL avalée laisserait la transaction avortée."""
    contenu = ligne_statut(ancien, nouveau, auteur, precision)
    cur.execute("INSERT INTO historique (ticket_id, type, contenu) VALUES (%s, 'statut', %s)",
                (ticket_id, contenu))
    return contenu
