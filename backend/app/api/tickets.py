"""
API CRUD Tickets — compatible schéma PostgreSQL existant.
CRUD et gestion des statuts.
"""

import math
from collections import defaultdict, deque
from datetime import date, datetime, timedelta, timezone
from time import time
from typing import Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Query, Request
from psycopg2 import errors as pg_errors, sql as psql
from pydantic import BaseModel, Field

from app.database import get_cursor
from app.api.autocomplete import learn_terms
from app.api.auth import client_ip, get_current_user, get_optional_user, require_admin
from app.api.public_documents import LimiteurDebit
from app.api.fidelite import crediter_ticket
from app.services.montants import calculer_montants, format_euros, statut_paiement
from app.models import (
    PRIORITES, TicketCreate, TicketUpdate, TicketOut, TicketFull,
    StatusChange, KPIResponse, ContactRequest,
)
from app.services.notifications import (
    notif_nouveau_ticket, notif_changement_statut, notif_reparation_terminee,
    notif_accord_client,
)
from app.api.notifications_center import push_notification
from app.services import contact
from app.services import etagere
from app.services import params as params_cache
from app.services import search as search_engine

router = APIRouter(prefix="/api/tickets", tags=["tickets"])

try:
    from zoneinfo import ZoneInfo
    _PARIS = ZoneInfo("Europe/Paris")
except Exception:  # image sans base tz : repli sur la règle d'heure d'été de l'UE
    _PARIS = None

_FMT_TS = "%Y-%m-%d %H:%M:%S"


# ─── Heure de la boutique ─────────────────────────────────────────
# Les TIMESTAMP naïfs (date_depot…) et le texte date_cloture sont en UTC (serveur et base
# en UTC) ; « aujourd'hui » et les horodatages lus par l'équipe sont ceux de Paris.
def _maintenant_utc() -> datetime:
    return datetime.now(timezone.utc)


def _dernier_dimanche(annee: int, mois: int) -> date:
    d = date(annee + mois // 12, mois % 12 + 1, 1) - timedelta(days=1)
    return d - timedelta(days=(d.weekday() + 1) % 7)


def _decalage_paris(u: datetime) -> timedelta:
    """Écart Paris − UTC à l'instant u (UTC)."""
    if _PARIS is not None:
        return u.astimezone(_PARIS).utcoffset()
    n = u.astimezone(timezone.utc).replace(tzinfo=None)
    debut = datetime.combine(_dernier_dimanche(n.year, 3), datetime.min.time()).replace(hour=1)
    fin = datetime.combine(_dernier_dimanche(n.year, 10), datetime.min.time()).replace(hour=1)
    return timedelta(hours=2 if debut <= n < fin else 1)


def heure_paris(u: Optional[datetime] = None) -> datetime:
    """Heure de Paris (naïve) de l'instant u, maintenant par défaut ; un u naïf est en UTC."""
    u = u or _maintenant_utc()
    if u.tzinfo is None:
        u = u.replace(tzinfo=timezone.utc)
    return (u + _decalage_paris(u)).replace(tzinfo=None)


def jour_paris(u: Optional[datetime] = None) -> str:
    """« Aujourd'hui » à la boutique (AAAA-MM-JJ), pas le jour UTC du serveur."""
    return heure_paris(u).strftime("%Y-%m-%d")


def _minuit_utc(jour: date) -> datetime:
    """Minuit à Paris le jour donné, en UTC naïf (22 h ou 23 h UTC la veille)."""
    minuit = datetime.combine(jour, datetime.min.time())
    for h in (2, 1):
        u = (minuit - timedelta(hours=h)).replace(tzinfo=timezone.utc)
        if _decalage_paris(u) == timedelta(hours=h):
            return u.replace(tzinfo=None)
    return minuit - timedelta(hours=1)


def bornes_utc(debut: str, fin: Optional[str] = None) -> tuple:
    """Jours de Paris debut..fin (AAAA-MM-JJ, inclus) → bornes UTC [début, fin[ en texte
    « AAAA-MM-JJ HH:MM:SS », comparables aux TIMESTAMP naïfs comme au texte date_cloture.
    ValueError si une date est impossible."""
    d1 = datetime.strptime(debut, "%Y-%m-%d").date()
    d2 = datetime.strptime(fin or debut, "%Y-%m-%d").date() + timedelta(days=1)
    return _minuit_utc(d1).strftime(_FMT_TS), _minuit_utc(d2).strftime(_FMT_TS)



# ─── Rate limiter in-memory (protection enumeration tickets publics) ─
# Simple token bucket par IP. Pas persistant (reset au redeploy), mais
# suffit largement contre les attaquants automatises qui font > 30 req/min.
_RATE_BUCKETS: dict[str, deque] = defaultdict(deque)
_RATE_LIMIT = 30        # max 30 requetes
_RATE_WINDOW = 60       # par 60 secondes


def _rate_limit_public_lookup(request: Request):
    """Raise 429 si l'IP depasse 30 req/min sur les endpoints publics."""
    # IP réelle : DERNIÈRE valeur de X-Forwarded-For (posée par le proxy Railway)
    ip = client_ip(request)
    now = time()
    bucket = _RATE_BUCKETS[ip]
    # Purge les hits plus vieux que la fenetre
    while bucket and (now - bucket[0]) > _RATE_WINDOW:
        bucket.popleft()
    if len(bucket) >= _RATE_LIMIT:
        raise HTTPException(
            429,
            "Trop de requetes — attendez 1 minute avant de reessayer.",
        )
    bucket.append(now)
    # GC sommaire pour eviter fuite memoire (max 5000 IPs tracked)
    if len(_RATE_BUCKETS) > 5000:
        for k in list(_RATE_BUCKETS.keys())[:2500]:
            if not _RATE_BUCKETS[k]:
                del _RATE_BUCKETS[k]


def _ajouter_historique(cur, ticket_id, type_event, contenu):
    """Insère une entrée dans la table historique (structured).

    Jamais de try/except ici : une erreur SQL avalée laisse la transaction
    avortée et le COMMIT final l'annule en silence (paiement compris).
    """
    cur.execute(
        "INSERT INTO historique (ticket_id, type, contenu) VALUES (%s, %s, %s)",
        (ticket_id, type_event, contenu),
    )

STATUTS = [
    "Pré-enregistré",
    "En attente de diagnostic", "En attente de pièce", "Pièce reçue",
    "En attente d'accord client", "En cours de réparation",
    "Réparation terminée", "Rendu au client", "Clôturé",
]
_STATUTS_RENDUS = ("Rendu au client", "Clôturé")


# ─── Helpers fiche : historique signé, garde-fous, lecture complète ──
def _horodatage():
    """(UTC « AAAA-MM-JJ HH:MM:SS » pour les colonnes, « JJ/MM HH:MM » de Paris pour le journal)."""
    n = _maintenant_utc()
    return n.strftime(_FMT_TS), heure_paris(n).strftime("%d/%m %H:%M")


def _auteur(user) -> str:
    return (user or {}).get("sub") or "Staff"


def _historiser(cur, ticket_id, ts, auteur, textes, type_event="statut") -> str:
    """Écrit chaque texte signé dans la table historique ; renvoie les lignes du journal texte."""
    lignes = []
    for texte in textes:
        contenu = f"{texte} — par {auteur}"
        _ajouter_historique(cur, ticket_id, type_event, contenu)
        lignes.append(f"[{ts}] {contenu}")
    return "\n".join(lignes)


def _journal(historique, lignes: str) -> str:
    h = (historique or "").rstrip()
    return f"{h}\n{lignes}" if h else lignes


def _texte_tel_contact(ancien, nouveau) -> Optional[str]:
    """Ligne d'historique du second numéro (tickets.tel_contact), None s'il ne change pas.
    Les SMS partent vers ce numéro : qui l'a posé, changé ou effacé doit se lire après coup,
    comme pour la priorité."""
    ancien = str(ancien or "").strip() or None
    nouveau = str(nouveau or "").strip() or None
    if ancien == nouveau:
        return None
    if not ancien:
        return f"Numéro pour joindre : {nouveau} (ajouté)"
    return f"Numéro pour joindre : {ancien} → {nouveau or 'effacé'}"


def _maj_ticket(cur, ticket_id: int, sets: dict):
    """UPDATE des seules colonnes données (noms issus du code ou du modèle Pydantic)."""
    cur.execute(
        psql.SQL("UPDATE tickets SET {} WHERE id = %s").format(psql.SQL(", ").join(
            psql.SQL("{} = %s").format(psql.Identifier(k)) for k in sets)),
        [*sets.values(), ticket_id],
    )


def _conflit(code: str, message: str, reste=None):
    raise HTTPException(409, detail={"code": code, "message": message, "reste": reste})


def _exiger_ticket(cur, ticket_id: int):
    cur.execute("SELECT 1 FROM tickets WHERE id = %s", (ticket_id,))
    if not cur.fetchone():
        raise HTTPException(404, "Ticket non trouvé")


def _pret_en_cours(t) -> bool:
    return bool(str(t.get("telephone_pret") or "").strip()) and not t.get("telephone_pret_rendu")


def _blocage_rendu(t) -> Optional[tuple]:
    """(message, reste) qui interdit « Rendu au client » / « Clôturé » hors restitution."""
    if _pret_en_cours(t):
        return (f"Téléphone de prêt non restitué ({t['telephone_pret']}) : passez par la restitution.", None)
    m = calculer_montants(t)
    if m["reste"] > 0:
        return (f"Ticket non payé (reste {format_euros(m['reste'])} €) : passez par la restitution.", m["reste"])
    if not t.get("paye") and m["total"] > 0:
        # Soldé par l'acompte : seule la restitution pose paye=1, tarif_final et les points
        return ("Ticket soldé par l'acompte mais pas encore marqué payé : passez par la restitution.", 0)
    return None


def _pret_vide(v) -> bool:
    return not str(v or "").strip()


# Statuts après lesquels la fiche et le scan proposent un message au client (jamais envoyé seul)
NOTIFICATIONS_STATUTS_DEFAUT = "Réparation terminée"


def _proposer_message(cur, nouveau: str, refus_devis: bool) -> bool:
    """Paramètre NOTIFICATIONS_STATUTS (liste séparée par des virgules ; vide = jamais).

    Devis refusé : l'appareil revient non réparé, pas d'annonce « prêt ».
    """
    if refus_devis:
        return False
    liste = params_cache.get_param("NOTIFICATIONS_STATUTS", NOTIFICATIONS_STATUTS_DEFAUT, cur=cur)
    return nouveau in {s.strip() for s in str(liste).split(",") if s.strip()}


def _rouvrir_si_cloture(t, sets: dict, textes: list):
    """Un « Clôturé » dé-payé redevient un impayé visible (« Rendu au client »), hors CA."""
    if t.get("statut") == "Clôturé":
        sets.update(statut="Rendu au client", date_cloture=None)
        textes.append("Statut: Clôturé → Rendu au client")


def _booleen(v):
    # Littéral non typé : valable que la colonne soit BOOLEAN (schéma neuf) ou INTEGER (ancienne base)
    return None if v is None else ("1" if v else "0")


def _chrono_sets(t, ancien, nouveau, now) -> dict:
    """Colonnes du chronomètre de réparation : démarre en entrant « En cours », s'arrête en sortant."""
    if nouveau == ancien:
        return {}
    if nouveau == "En cours de réparation":
        return {"reparation_debut": now, "reparation_fin": None}
    if ancien == "En cours de réparation" and t.get("reparation_debut"):
        debut = t["reparation_debut"]
        if isinstance(debut, str):
            debut = datetime.strptime(debut, "%Y-%m-%d %H:%M:%S")
        elapsed = max(0, int((_maintenant_utc().replace(tzinfo=None) - debut).total_seconds()))
        return {"reparation_fin": now, "reparation_duree": (t.get("reparation_duree") or 0) + elapsed}
    return {}


def _maj_chrono(cur, ticket_id, t, ancien, nouveau, now):
    """Chronomètre de réparation : démarre en entrant « En cours », s'arrête en sortant."""
    sets = _chrono_sets(t, ancien, nouveau, now)
    if sets:
        _maj_ticket(cur, ticket_id, sets)


def _sql_sync_pieces(ticket_id, nouveau, now) -> Optional[tuple]:
    """(SQL, paramètres) qui synchronise les commandes de pièces avec le statut, None sinon."""
    if nouveau in ("Réparation terminée", "Rendu au client", "Clôturé"):
        return ("UPDATE commandes_pieces SET statut = 'Reçu', date_reception = %s"
                " WHERE ticket_id = %s AND statut IN ('En attente', 'Commandée')", (now, ticket_id))
    if nouveau == "En cours de réparation":
        return ("UPDATE commandes_pieces SET statut = 'En réparation'"
                " WHERE ticket_id = %s AND statut = 'Reçu'", (ticket_id,))
    if nouveau == "En attente de pièce":
        return ("UPDATE commandes_pieces SET statut = 'Commandée', date_commande = %s"
                " WHERE ticket_id = %s AND statut = 'En attente'", (now, ticket_id))
    return None


def _sync_pieces(cur, ticket_id, nouveau, now):
    """Synchronise les commandes de pièces avec le statut du ticket."""
    requete = _sql_sync_pieces(ticket_id, nouveau, now)
    if requete:
        cur.execute(*requete)


def _select_complet(source: str = "tickets", jointure: str = "", extra: str = "") -> str:
    """SELECT de la réponse complète d'un ticket (GET /{id}, PATCH, statut) sur `source`
    (la table, ou la CTE d'un UPDATE … RETURNING * : écriture et relecture en un aller-retour).

    _a_retours_sav dit s'il existe des retours SAV : leur lecture (rare) n'est faite qu'alors.
    Fragments fixes du code, jamais une saisie.
    """
    return f"""
        SELECT t.*,
               c.nom as client_nom, c.prenom as client_prenom,
               c.telephone as client_tel, c.email as client_email,
               c.societe as client_societe, c.carte_camby as client_carte_camby,
               (SELECT MAX(n.date_creation) FROM notes_tickets n
                 WHERE n.ticket_id = t.id AND n.type_note = 'caisse') AS caisse_envoyee_le,
               EXISTS (SELECT 1 FROM tickets r
                        WHERE r.ticket_original_id = t.id AND r.est_retour_sav = true) AS _a_retours_sav
               {contact.colonne_sql('t')}{extra}
        FROM {source} t
        JOIN clients c ON t.client_id = c.id{jointure}
    """


def _completer(cur, row) -> dict:
    """Ligne de _select_complet → réponse de GET /{id} : contact, ticket d'origine, retours SAV, montants."""
    result = contact.poser(row)
    # Indicateur absent (ligne d'une autre requête) : les retours sont lus comme avant
    a_retours = result.pop("_a_retours_sav", True)
    result["ticket_original"] = None
    if result.get("est_retour_sav") and result.get("ticket_original_id"):
        cur.execute("""
            SELECT id, ticket_code, statut, panne, marque, modele, modele_autre,
                   date_depot, date_cloture, technicien_assigne
            FROM tickets WHERE id = %s
        """, (result["ticket_original_id"],))
        orig = cur.fetchone()
        result["ticket_original"] = dict(orig) if orig else None

    result["retours_sav"] = []
    if a_retours:
        cur.execute("""
            SELECT id, ticket_code, statut, panne, date_depot
            FROM tickets
            WHERE ticket_original_id = %s AND est_retour_sav = true
            ORDER BY date_depot DESC
        """, (result["id"],))
        result["retours_sav"] = [dict(r) for r in (cur.fetchall() or [])]
    result["montants"] = calculer_montants(result)
    return result


def _ticket_complet(cur, ticket_id: int) -> Optional[dict]:
    """Ticket + client + retours SAV + montants calculés + contact (réponse de GET /{id})."""
    cur.execute(_select_complet() + " WHERE t.id = %s", (ticket_id,))
    row = cur.fetchone()
    if not row:
        return None
    return _completer(cur, row)


# Colonnes reprises par une saisie de prix sur un ticket payé : elles ne bougent pas (garde-fou en SQL)
_CHAMPS_PAIEMENT = ("statut_paiement", "reste_a_payer")
# PATCH de ces champs : l'écriture dépend de l'état d'avant (historique, garde-fous), lu sous verrou
_CHAMPS_ETAT_AVANT = ("paye", "priorite", "tel_contact", "telephone_pret")
_SQL_HISTORIQUE = psql.SQL("INSERT INTO historique (ticket_id, type, contenu) VALUES (%s, 'statut', %s);\n")


def _ecrire_et_relire(cur, ticket_id: int, sets: dict, historique=(), garde_paye: bool = False,
                      avant: tuple = ()) -> Optional[dict]:
    """Lignes d'historique, UPDATE des colonnes `sets` et relecture complète en UN aller-retour.

    - historique : contenus insérés dans la table historique (instructions précédentes du même
      envoi : la relecture du contact les voit) ;
    - garde_paye : statut_paiement et reste_a_payer ne bougent pas si le ticket est payé
      (la règle de update_ticket, écrite en SQL faute d'avoir lu le ticket avant) ;
    - avant : colonnes renvoyées avec leur valeur d'AVANT l'écriture (_avant_<colonne>),
      lues dans le même instantané que l'UPDATE.
    Renvoie la réponse complète (_completer), None si le ticket n'existe pas.
    """
    params = []
    lot = []
    for contenu in historique:
        lot.append(_SQL_HISTORIQUE)
        params += [ticket_id, contenu]
    assignations = []
    for k, v in sets.items():
        if garde_paye and k in _CHAMPS_PAIEMENT:
            assignations.append(psql.SQL("{c} = CASE WHEN COALESCE(paye::int, 0) <> 0 THEN {c} ELSE %s END")
                                .format(c=psql.Identifier(k)))
        else:
            assignations.append(psql.SQL("{} = %s").format(psql.Identifier(k)))
        params.append(v)
    ctes = []
    extra = jointure = ""
    if avant:
        ctes.append(psql.SQL("avant AS (SELECT {} FROM tickets WHERE id = %s)").format(
            psql.SQL(", ").join(psql.SQL("{} AS {}").format(psql.Identifier(c), psql.Identifier(f"_avant_{c}"))
                                for c in avant)))
        params.insert(len(historique) * 2, ticket_id)
        extra = ", a.*"
        jointure = " CROSS JOIN avant a"
    ctes.append(psql.SQL("u AS (UPDATE tickets SET {} WHERE id = %s RETURNING *)").format(
        psql.SQL(", ").join(assignations)))
    params.append(ticket_id)
    lot.append(psql.SQL("WITH {} ").format(psql.SQL(", ").join(ctes)))
    lot.append(psql.SQL(_select_complet("u", jointure, extra)))
    cur.execute(psql.Composed(lot), params)
    row = cur.fetchone()
    return _completer(cur, row) if row else None


# ─── KPI (dashboard combiné et /stats/kpi : une seule requête) ────
# Fragments SQL fixes (aucune saisie) ; paramètres : _params_kpi() (bornes UTC du jour de Paris)
_KPI_SQL = f"""
    SELECT
        COUNT(*) FILTER (WHERE statut = 'En attente de diagnostic') as en_attente_diagnostic,
        COUNT(*) FILTER (WHERE statut = 'En cours de réparation') as en_cours,
        COUNT(*) FILTER (WHERE statut = 'En attente de pièce') as en_attente_piece,
        COUNT(*) FILTER (WHERE statut = 'En attente d''accord client') as en_attente_accord,
        COUNT(*) FILTER (WHERE statut = 'Réparation terminée') as reparation_terminee,
        COUNT(*) FILTER (WHERE statut NOT IN ('Clôturé', 'Rendu au client')) as total_actifs,
        COUNT(*) FILTER (WHERE date_cloture >= %s AND date_cloture < %s
                         AND statut IN ('Rendu au client', 'Clôturé')) as clotures_aujourdhui,
        COUNT(*) FILTER (WHERE date_depot >= %s AND date_depot < %s) as nouveaux_aujourdhui,
        COUNT(*) FILTER (WHERE statut = 'Pré-enregistré') as pre_enregistres,
        COUNT(*) FILTER (WHERE {etagere.a_recuperer_sql("tickets")}) as a_recuperer
    FROM tickets
"""


def _params_kpi() -> tuple:
    debut, fin = bornes_utc(jour_paris())
    return (debut, fin, debut, fin)


def _kpi(row) -> dict:
    data = dict(row) if row else {}
    pre = data.pop("pre_enregistres", 0)
    return {**KPIResponse(**data).model_dump(), "pre_enregistres": pre}


# Fiche de réception (table ticket_controles, déclarée dans le schéma du démarrage).
# Table absente (migration en échec) : le dashboard reste lisible, drapeau à FALSE,
# nouvel essai après _RECEPTION_REESSAI secondes.
_RECEPTION_SQL = ("EXISTS(SELECT 1 FROM ticket_controles tc WHERE tc.ticket_id = t.id "
                  "AND tc.phase = 'entree' AND tc.complete) AS reception_complete")
_RECEPTION_REESSAI = 300
_reception_absente_le = 0.0


def _colonne_reception() -> str:
    if _reception_absente_le and time() - _reception_absente_le < _RECEPTION_REESSAI:
        return "FALSE AS reception_complete"
    return _RECEPTION_SQL


# File atelier : client sur place, express, pro, puis normal
_ORDRE_PRIORITE_SQL = """CASE t.priorite
                    WHEN 'attente' THEN 0
                    WHEN 'express' THEN 1
                    WHEN 'pro' THEN 2
                    ELSE 3
                END"""
# Heure promise : date_recuperation est du TEXTE libre ; seule une valeur qui
# commence par AAAA-MM-JJ est ordonnée (comparaison de texte, « T » ramené à l'espace
# pour que les deux saisies d'un même jour se comparent), les autres passent après.
_HEURE_PROMISE_SQL = (r"CASE WHEN t.date_recuperation ~ '^\d{4}-\d{2}-\d{2}' "
                      r"THEN replace(left(t.date_recuperation, 19), 'T', ' ') END")


# ─── DASHBOARD COMBINÉ (KPI + tickets en 1 appel) ────────────────
def _lire_dashboard(colonne_reception, colonnes_etagere, where, order, params_tickets, limit, offset):
    with get_cursor() as cur:
        # KPI in one query
        cur.execute(_KPI_SQL, _params_kpi())
        kpi_row = cur.fetchone()

        # Tickets list
        cur.execute(f"""
            SELECT t.*,
                   c.nom as client_nom, c.prenom as client_prenom,
                   c.telephone as client_tel, c.email as client_email,
                   c.societe as client_societe, c.carte_camby as client_carte_camby,
                   {colonne_reception}
                   {contact.colonne_sql('t')}
                   {colonnes_etagere}
            FROM tickets t
            JOIN clients c ON t.client_id = c.id
            {where}
            ORDER BY {order}
            LIMIT %(limit)s OFFSET %(offset)s
        """, params_tickets)
        tickets = [contact.poser(r) for r in (cur.fetchall() or [])]
        # COUNT séparé et seulement si la page est pleine : un COUNT(*) OVER ()
        # empêcherait de lire les 200 premiers tickets par l'index date_depot.
        total = offset + len(tickets)
        if len(tickets) == limit or (offset and not tickets):
            cur.execute(f"SELECT COUNT(*) AS n FROM tickets t JOIN clients c ON t.client_id = c.id {where}", params_tickets)
            row = cur.fetchone()
            total = row["n"] if row else 0
    return kpi_row, tickets, total


@router.get("/stats/dashboard")
def get_dashboard(
    search: Optional[str] = None,
    statut: Optional[str] = None,
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    date_from: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    date_to: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    tech: Optional[str] = None,
    vue: Optional[str] = Query(None, pattern="^(actifs|archives|tous|a_recuperer)$"),
    user: dict = Depends(get_current_user),
):
    """Retourne KPI + tickets en une seule requête pour le dashboard.

    Filtres serveur optionnels : dates de dépôt (YYYY-MM-DD), technicien,
    vue actifs / archives / tous / a_recuperer, pagination (offset) ; `total` =
    nombre de tickets correspondant aux filtres, hors limit/offset.

    Vue a_recuperer (étagère, services/etagere) : « Réparation terminée » et
    « Rendu au client » non payés, terminés d'abord, du plus ancien au plus récent
    depuis la fin de réparation ; chaque ticket porte fin_reparation, jours_attente,
    reste_du, emplacement (appareils en boutique seulement : None une fois rendu),
    nb_relances et derniere_relance (messages tracés depuis la fin de réparation) et
    relance_due (palier ETAGERE_RELANCE_PALIERS atteint, rien envoyé depuis 3 jours) ;
    la réponse porte delai_abandon_jours (ETAGERE_DELAI_ABANDON_JOURS, 365 par défaut,
    jamais moins : minimum de la loi du 31/12/1903).

    Toutes vues : chaque ticket porte aussi les colonnes de t.* dont emplacement et
    priorite (normal / express / attente = client sur place / pro, models.PRIORITES),
    reception_complete (fiche de réception d'entrée complète, table ticket_controles ;
    FALSE pendant 5 min si la table manque) et contact (services/contact : derniers
    SMS / e-mail / WhatsApp / appel depuis le dernier changement de statut).
    """
    for value in (date_from, date_to):
        if value:
            try:
                datetime.strptime(value, "%Y-%m-%d")
            except ValueError:
                raise HTTPException(422, f"Date invalide : {value}")

    conditions = []
    sp = search_engine.SqlParams()
    if statut:
        conditions.append(f"t.statut = {sp.add(statut)}")
    if vue == "actifs":
        conditions.append(search_engine.actif_sql("t"))
    elif vue == "archives":
        conditions.append("t.statut IN ('Rendu au client', 'Clôturé')")
    elif vue == "a_recuperer":
        conditions.append(etagere.a_recuperer_sql("t"))
    if tech:
        conditions.append(f"t.technicien_assigne = {sp.add(tech)}")
    # Jours de Paris : bornes UTC (date_depot est un TIMESTAMP naïf en UTC)
    if date_from:
        conditions.append(f"t.date_depot >= {sp.add(bornes_utc(date_from)[0])}")
    if date_to:
        conditions.append(f"t.date_depot < {sp.add(bornes_utc(date_to)[1])}")
    # Même sens que idx_tickets_date_depot (DESC, nulls en tête) : sans recherche,
    # PostgreSQL lit les `limit` premiers tickets par l'index au lieu de tout trier.
    order = "t.date_depot DESC, t.id DESC"
    if search:
        pq = search_engine.parse_query(search)
        conditions.append(search_engine.ticket_where_sql(pq, sp))
        if not pq.empty:
            order = search_engine.ticket_order_sql(pq, sp)
    colonnes_etagere = ""
    if vue == "a_recuperer":
        colonnes_etagere = etagere.colonnes_sql(sp, "t")
        order = etagere.ORDRE_SQL

    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    params_tickets = {**sp.values, "limit": limit, "offset": offset}

    global _reception_absente_le
    colonne_reception = _colonne_reception()
    try:
        kpi_row, tickets, total = _lire_dashboard(colonne_reception, colonnes_etagere,
                                                  where, order, params_tickets, limit, offset)
    except pg_errors.UndefinedTable:
        if colonne_reception != _RECEPTION_SQL:
            raise
        _reception_absente_le = time()
        kpi_row, tickets, total = _lire_dashboard(_colonne_reception(), colonnes_etagere,
                                                  where, order, params_tickets, limit, offset)

    if vue == "a_recuperer":
        return {"kpi": _kpi(kpi_row), "tickets": etagere.enrichir(tickets), "total": total,
                "delai_abandon_jours": etagere.delai_abandon_jours()}
    return {"kpi": _kpi(kpi_row), "tickets": tickets, "total": total}


# ─── KPI DASHBOARD ───────────────────────────────────────────────
@router.get("/stats/kpi")
def get_kpi(user: dict = Depends(get_current_user)):
    """Récupère les KPI du dashboard (jour de Paris)."""
    with get_cursor() as cur:
        cur.execute(_KPI_SQL, _params_kpi())
        row = cur.fetchone()

    return _kpi(row)


# ─── FILE D'ATTENTE RÉPARATION ────────────────────────────────────
@router.get("/queue/repair")
def get_repair_queue(
    tech: Optional[str] = None,
    limit: int = Query(20, ge=1, le=50),
    user: dict = Depends(get_current_user),
):
    """Tickets à réparer, triés : priorité (client sur place, express, pro, normal),
    heure promise (date_recuperation au format AAAA-MM-JJ…, la plus proche d'abord),
    statut (en cours, pièce reçue, diagnostic, accord, pièce attendue), date de dépôt.
    Chaque ligne porte contact (services/contact)."""
    with get_cursor() as cur:
        conditions = [
            "t.statut IN ('En attente de diagnostic', 'En attente de pièce', "
            "'Pièce reçue', 'En attente d''accord client', 'En cours de réparation')"
        ]
        params = []

        if tech:
            conditions.append("t.technicien_assigne = %s")
            params.append(tech)

        where = "WHERE " + " AND ".join(conditions)
        params.append(limit)

        cur.execute(f"""
            SELECT t.id, t.ticket_code, t.statut, t.marque, t.modele, t.panne,
                   t.technicien_assigne, t.date_recuperation, t.date_depot,
                   t.reparation_debut, t.reparation_duree, t.priorite, t.tel_contact,
                   c.nom AS client_nom, c.prenom AS client_prenom, c.telephone AS client_tel
                   {contact.colonne_sql('t')}
            FROM tickets t
            JOIN clients c ON t.client_id = c.id
            {where}
            ORDER BY
                {_ORDRE_PRIORITE_SQL},
                {_HEURE_PROMISE_SQL} ASC NULLS LAST,
                CASE t.statut
                    WHEN 'En cours de réparation' THEN 1
                    WHEN 'Pièce reçue' THEN 2
                    WHEN 'En attente de diagnostic' THEN 3
                    WHEN 'En attente d''accord client' THEN 4
                    WHEN 'En attente de pièce' THEN 5
                    ELSE 6
                END,
                t.date_depot ASC
            LIMIT %s
        """, params)
        rows = cur.fetchall()

    # Serialize datetimes
    result = []
    for r in rows or []:
        d = contact.poser(r)
        for key in ("date_recuperation", "date_depot", "reparation_debut"):
            if d.get(key) and hasattr(d[key], "isoformat"):
                d[key] = d[key].isoformat()
        result.append(d)
    return result


# ─── LISTE / RECHERCHE ─────────────────────────────────────────
@router.get("", response_model=list[TicketFull])
def list_tickets(
    statut: Optional[str] = None,
    tel: Optional[str] = None,
    code: Optional[str] = None,
    nom: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: dict = Depends(get_current_user),
):
    """Liste les tickets avec filtres optionnels (téléphone normalisé, recherche multi-mots).
    Chaque ticket porte contact (services/contact)."""
    conditions = []
    sp = search_engine.SqlParams()
    order = "t.date_depot DESC, t.id DESC"

    if statut:
        conditions.append(f"t.statut = {sp.add(statut)}")
    if tel:
        digits = search_engine.phone_digits(tel)
        look = search_engine.phone_lookup(tel)
        if look and look[0] == "key":
            pq_tel = search_engine.ParsedQuery(q=tel, phone_key=look[1],
                                               phone_full=search_engine.phone_full_variants(digits))
            conditions.append(f"public.kp_phone_key(c.telephone) = {sp.add(pq_tel.phone_key)}")
            conditions.append(search_engine.phone_homonym_sql(pq_tel, sp, "t.client_id"))
        elif look:
            conditions.append(f"public.kp_phone_digits(c.telephone) LIKE ANY({sp.add(look[1])}::text[])")
        else:
            conditions.append(f"c.telephone LIKE {sp.add('%' + search_engine.esc_like(tel) + '%')}")
    if code:
        ref = search_engine.parse_ticket_ref(code)
        if ref and ref.explicit:
            conditions.append(f"(t.id = {sp.add(ref.ticket_id)} OR t.ticket_code = {sp.add(f'KP-{ref.ticket_id:06d}')})")
        else:
            conditions.append(f"t.ticket_code ILIKE {sp.add('%' + search_engine.esc_like(code) + '%')}")
    if nom:
        pq_nom = search_engine.parse_query(nom)
        pq_nom.ticket_id = pq_nom.code_prefix = pq_nom.imei = None
        conditions.append(search_engine.client_where_sql(pq_nom, sp, c="c"))
    if search:
        pq = search_engine.parse_query(search)
        conditions.append(search_engine.ticket_where_sql(pq, sp))
        if not pq.empty:
            order = search_engine.ticket_order_sql(pq, sp)

    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    params = {**sp.values, "limit": limit, "offset": offset}

    query = f"""
        SELECT t.*,
               c.nom as client_nom, c.prenom as client_prenom,
               c.telephone as client_tel, c.email as client_email,
               c.societe as client_societe, c.carte_camby as client_carte_camby
               {contact.colonne_sql('t')}
        FROM tickets t
        JOIN clients c ON t.client_id = c.id
        {where}
        ORDER BY {order}
        LIMIT %(limit)s OFFSET %(offset)s
    """

    with get_cursor() as cur:
        cur.execute(query, params)
        return [contact.poser(r) for r in (cur.fetchall() or [])]


# ─── TICKET UNIQUE ─────────────────────────────────────────────
@router.get("/{ticket_id}")
def get_ticket(ticket_id: int, user: dict = Depends(get_current_user)):
    """Récupère un ticket par ID avec les infos client, retours SAV et montants calculés."""
    with get_cursor() as cur:
        result = _ticket_complet(cur, ticket_id)
    if not result:
        raise HTTPException(404, "Ticket non trouvé")
    return result


@router.get("/phone/{telephone}")
def get_tickets_by_phone(telephone: str, request: Request):
    """Récupère les tickets par téléphone client (public — pour suivi client).

    Numéro complet exigé (≥ 9 chiffres, tout format : espaces, points, +33,
    0033) : un fragment ne doit pas permettre d'énumérer les tickets d'autrui.
    """
    _rate_limit_public_lookup(request)
    digits = search_engine.phone_digits(telephone)
    if not 9 <= len(digits) <= 15:
        raise HTTPException(400, "Numéro de téléphone complet requis")
    with get_cursor() as cur:
        cur.execute("""
            SELECT t.ticket_code, t.statut, t.marque, t.modele, t.modele_autre,
                   t.panne, t.date_depot, t.date_maj, c.telephone AS _tel
            FROM tickets t
            JOIN clients c ON t.client_id = c.id
            WHERE public.kp_phone_key(c.telephone) = %s
            ORDER BY t.date_depot DESC
            LIMIT 60
        """, (search_engine.phone_key(digits),))
        rows = cur.fetchall() or []
    # Clé = 9 derniers chiffres : on exige en plus le même numéro complet
    # (un numéro étranger peut partager ses 9 derniers chiffres).
    out = []
    for r in rows:
        r = dict(r)
        if search_engine.same_phone(r.pop("_tel", None), telephone):
            out.append(r)
    return out[:20]


@router.get("/code/{ticket_code}")
def get_ticket_by_code(ticket_code: str, request: Request):
    """Récupère un ticket par code (public — pour suivi client).

    ⚠️ Endpoint SANS auth, accessible à quiconque possède le code (imprimé sur
    le ticket client + encodé dans son QR). Ne renvoyer QUE les champs affichés
    par la page de suivi — jamais de code PIN, IMEI, notes internes ni
    coordonnées client.
    """
    _rate_limit_public_lookup(request)
    with get_cursor() as cur:
        cur.execute("""
            SELECT t.id, t.ticket_code, t.statut, t.marque, t.modele, t.modele_autre,
                   t.panne, t.panne_detail, t.date_depot, t.date_maj, t.date_recuperation,
                   t.source, t.devis_estime, t.acompte, t.reduction_montant,
                   t.reduction_pourcentage, t.reparation_supp, t.commande_piece,
                   t.commentaire_client, t.prix_supp, t.tarif_final, t.paye, t.issue
            FROM tickets t
            WHERE t.ticket_code = %s
        """, (ticket_code,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Ticket non trouvé")
    result = dict(row)
    # Mêmes montants que la fiche et la restitution (payé → reste 0, acompte excédentaire → 0)
    m = calculer_montants(result)
    result["montants"] = {k: m[k] for k in ("sous_total", "reduction", "total", "acompte", "reste", "paye")}
    return result


# ─── CRÉATION ───────────────────────────────────────────────────
# Sans session (borne du magasin, formulaire public) : 15 tickets par IP et par 10 minutes
_LIMITEUR_CREATION = LimiteurDebit(limite=15, fenetre=600)


@router.post("", response_model=dict)
def create_ticket(
    data: TicketCreate,
    background_tasks: BackgroundTasks,
    user: Optional[dict] = Depends(get_optional_user),
    request: Request = None,
):
    """Crée un nouveau ticket (accessible sans auth — formulaire client).

    Sans session staff, la borne du magasin (/client, /depot) peut seulement déclarer
    que le client attend sur place ; express et pro restent réservés au personnel,
    et un dépôt à distance ne passe jamais devant la file. Sans session : débit limité
    par IP (429) et aucun terme appris pour l'autocomplétion du personnel.
    cree_par = membre connecté, sinon 'distance' ou 'borne'. Client inconnu : 404.
    """
    if not user:
        try:
            _LIMITEUR_CREATION.verifier(client_ip(request))
        except HTTPException:
            raise HTTPException(429, "Trop de tickets créés depuis ce poste : réessayez dans quelques minutes.")
    if user:
        priorite = data.priorite
    elif data.priorite == "attente" and (data.source or "boutique") == "boutique":
        priorite = "attente"
    else:
        priorite = "normal"
    # Si retour SAV, vérifier que le ticket original existe et appartient au même client
    if data.est_retour_sav and data.ticket_original_id:
        with get_cursor() as cur:
            cur.execute(
                "SELECT id, client_id FROM tickets WHERE id = %s",
                (data.ticket_original_id,),
            )
            orig = cur.fetchone()
            if not orig:
                raise HTTPException(404, "Ticket original non trouvé")
            if orig["client_id"] != data.client_id:
                raise HTTPException(400, "Le ticket original n'appartient pas à ce client")

    statut_initial = "Pré-enregistré" if data.source == "distance" else "En attente de diagnostic"
    # Reporting « Performance accueil » : qui a enregistré le ticket
    cree_par = _auteur(user) if user else ("distance" if data.source == "distance" else "borne")

    with get_cursor() as cur:
        try:
            cur.execute("""
                INSERT INTO tickets
                (client_id, categorie, marque, modele, modele_autre, imei,
                 panne, panne_detail, pin, pattern, notes_client,
                 commande_piece, statut, est_retour_sav, ticket_original_id, source,
                 tel_contact, cree_par, priorite)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING id
            """, (
                data.client_id, data.categorie, data.marque, data.modele,
                data.modele_autre, data.imei, data.panne, data.panne_detail,
                data.pin, data.pattern or "", data.notes_client, data.commande_piece,
                statut_initial, data.est_retour_sav or False, data.ticket_original_id,
                data.source or "boutique", data.tel_contact, cree_par, priorite,
            ))
        except pg_errors.ForeignKeyViolation:
            # clients(id) : la transaction est annulée par get_cursor
            raise HTTPException(404, "Client non trouvé")
        row = cur.fetchone()
        tid = row["id"]

        code = f"KP-{tid:06d}"
        cur.execute("UPDATE tickets SET ticket_code = %s WHERE id = %s", (code, tid))

    # Transaction séparée : si la migration suivi_token a échoué, la création
    # du ticket ne doit pas tomber (rattrapage au démarrage / à la demande)
    from app.api.public_documents import jeton_suivi
    try:
        jeton_suivi(tid)
    except Exception as e:
        print(f"[tickets] jeton de suivi non créé pour le ticket {tid} : {e}")

    # Après la réponse : apprentissage (silencieux, personnel connecté seulement, comme
    # POST /api/autocomplete/learn) et Discord (jusqu'à 5 s)
    if user:
        background_tasks.add_task(
            learn_terms, {"panne": data.panne, "panne_detail": data.panne_detail, "modele_autre": data.modele_autre},
        )
    appareil = data.modele_autre if data.modele_autre else f"{data.marque} {data.modele}"
    background_tasks.add_task(notif_nouveau_ticket, code, appareil, data.panne or data.panne_detail or "Réparation")

    return {"id": tid, "ticket_code": code}


# ─── LIENS DE PARTAGE CLIENT (documents publics par jeton) ──────
@router.get("/{ticket_id}/share-links")
def get_share_links(ticket_id: int, request: Request, user: dict = Depends(get_current_user)):
    """URL absolues à envoyer au client (ticket de dépôt, devis, reçu). Jamais la fiche atelier."""
    from app.api.public_documents import jeton_suivi, liens_partage
    token = jeton_suivi(ticket_id)
    if not token:
        raise HTTPException(404, "Ticket non trouvé")
    return liens_partage(token, request)


# ─── MISE À JOUR ────────────────────────────────────────────────
@router.patch("/{ticket_id}", response_model=dict)
def update_ticket(
    ticket_id: int,
    data: TicketUpdate,
    background_tasks: BackgroundTasks,
    learn: bool = Query(False, description="Apprendre panne/détail/modèle : fin de saisie, jamais l'auto-save"),
    user: dict = Depends(get_current_user),
):
    """Mise à jour PARTIELLE : seuls les champs envoyés sont écrits. Renvoie le ticket complet.

    Cas courant (prix, lignes, appareil, délai, notes…) : l'écriture et la relecture complète
    partent en une seule instruction (UPDATE … RETURNING), sans lecture préalable. Seuls les
    champs dont l'écriture dépend de l'état d'avant (_CHAMPS_ETAT_AVANT : paiement, priorité
    et numéro historisés, prêt) lisent d'abord le ticket sous verrou.
    """
    updates = data.model_dump(exclude_unset=True)
    now, ts = _horodatage()
    auteur = _auteur(user)
    avant = None
    appris_avant = ("panne", "panne_detail", "modele_autre")

    with get_cursor() as cur:
        if not updates:
            ticket = _ticket_complet(cur, ticket_id)
            if not ticket:
                raise HTTPException(404, "Ticket non trouvé")
            return {"ok": True, "ticket": ticket}

        if "telephone_pret_rendu" in updates:
            updates["telephone_pret_rendu"] = _booleen(updates["telephone_pret_rendu"])
        hist = []

        def historiser(textes) -> str:
            # Même journal que _historiser ; les lignes partent avec l'UPDATE (un seul envoi)
            contenus = [f"{texte} — par {auteur}" for texte in textes]
            hist.extend(contenus)
            return "\n".join(f"[{ts}] {c}" for c in contenus)

        if any(k in updates for k in _CHAMPS_ETAT_AVANT):
            cur.execute("SELECT * FROM tickets WHERE id = %s FOR UPDATE", (ticket_id,))
            avant = cur.fetchone()
            if not avant:
                raise HTTPException(404, "Ticket non trouvé")
            avant = dict(avant)

            # Prêt confié sur un ticket qui n'en avait pas : il est dehors (garde-fou de la restitution)
            if ("telephone_pret" in updates and not _pret_vide(updates["telephone_pret"])
                    and _pret_vide(avant.get("telephone_pret"))):
                updates.setdefault("telephone_pret_rendu", _booleen(0))
            if "paye" in updates:
                paye = 1 if updates["paye"] else 0
                updates["paye"] = paye
                m = calculer_montants({**avant, **updates})
                if paye:
                    updates.setdefault("statut_paiement", "Payé")
                    updates.setdefault("reste_a_payer", 0)
                    # Le CA (SUM(tarif_final) WHERE paye=1) compte le montant encaissé
                    updates.setdefault("tarif_final", m["total"])
                else:
                    updates.setdefault("statut_paiement", statut_paiement(m))
                    updates.setdefault("reste_a_payer", m["reste"])
                if paye != (1 if avant.get("paye") else 0):
                    textes = ["Marqué payé" if paye else "Marqué non payé"]
                    if not paye:
                        _rouvrir_si_cloture(avant, updates, textes)
                    updates["historique"] = _journal(avant.get("historique"), historiser(textes))
            elif avant.get("paye"):
                # Ticket payé : un enregistrement des prix ne le fait pas repasser « à payer »
                updates.pop("statut_paiement", None)
                updates.pop("reste_a_payer", None)

            ancienne_priorite = avant.get("priorite") or "normal"
            if "priorite" in updates and updates["priorite"] != ancienne_priorite:
                texte = (f"Priorité : {PRIORITES.get(ancienne_priorite, ancienne_priorite)}"
                         f" → {PRIORITES[updates['priorite']]}")
                updates["historique"] = _journal(updates.get("historique", avant.get("historique")),
                                                 historiser([texte]))

            if "tel_contact" in updates:
                texte = _texte_tel_contact(avant.get("tel_contact"), updates["tel_contact"])
                if texte:
                    updates["historique"] = _journal(updates.get("historique", avant.get("historique")),
                                                     historiser([texte]))

        updates["date_maj"] = now
        # Sans lecture préalable : un ticket payé garde statut_paiement / reste_a_payer (CASE en SQL)
        ticket = _ecrire_et_relire(cur, ticket_id, updates, hist, garde_paye=avant is None,
                                   avant=appris_avant if (learn and avant is None) else ())
        if ticket is None:
            raise HTTPException(404, "Ticket non trouvé")

    if learn:
        appris = {k: updates[k] for k in appris_avant if k in updates}
        if appris:
            if avant is None:
                avant = {k: ticket.get(f"_avant_{k}") for k in appris_avant}
            background_tasks.add_task(learn_terms, appris, avant)
    for k in appris_avant:
        ticket.pop(f"_avant_{k}", None)

    return {"ok": True, "ticket": ticket}


# ─── PAYÉ (valeur explicite, ou bascule si le corps est vide) ─────
class PayeBody(BaseModel):
    paye: Optional[bool] = None


@router.patch("/{ticket_id}/paye", response_model=dict)
def toggle_paye(
    ticket_id: int,
    background_tasks: BackgroundTasks,
    body: Optional[PayeBody] = Body(None),
    user: dict = Depends(get_current_user),
):
    """Pose payé / non payé. {"paye": true|false} est idempotent (double clic sans effet) ;
    corps vide ou {} : ancienne bascule. Crédite la fidélité une seule fois, sur le
    total TTC du ticket. Un « Rendu au client » réglé passe en « Clôturé » (CA du jour) ;
    un « Clôturé » dé-payé revient en « Rendu au client » (impayé visible). Les points déjà
    gagnés ne sont pas repris et ne sont jamais recrédités pour ce ticket.
    """
    now, ts = _horodatage()
    auteur = _auteur(user)
    fidelite = None

    with get_cursor() as cur:
        cur.execute("SELECT * FROM tickets WHERE id = %s FOR UPDATE", (ticket_id,))
        t = cur.fetchone()
        if not t:
            raise HTTPException(404, "Ticket non trouvé")
        t = dict(t)
        actuel = bool(t.get("paye"))
        cible = (not actuel) if body is None or body.paye is None else bool(body.paye)
        statut = t.get("statut") or ""
        if cible == actuel:
            return {"ok": True, "paye": actuel, "points_fidelite": None, "statut": statut}

        m = calculer_montants({**t, "paye": 0})
        textes = ["Marqué payé" if cible else "Marqué non payé"]
        if cible:
            sets = {
                "paye": 1, "statut_paiement": "Payé", "reste_a_payer": 0, "date_maj": now,
                # Le CA (SUM(tarif_final) WHERE paye=1) compte ce qui est encaissé et crédité
                "tarif_final": m["total"],
            }
            if statut == "Rendu au client":
                sets.update(statut="Clôturé", date_cloture=t.get("date_cloture") or now)
                textes.append("Statut: Rendu au client → Clôturé")
                # Rendu avant le branchement de la libération : l'étagère se vide aussi ici
                sets.update(etagere.liberer_emplacement(t, "Clôturé", textes))
        else:
            sets = {"paye": 0, "statut_paiement": statut_paiement(m), "reste_a_payer": m["reste"], "date_maj": now}
            _rouvrir_si_cloture(t, sets, textes)
        sets["historique"] = _journal(t.get("historique"), _historiser(cur, ticket_id, ts, auteur, textes))
        _maj_ticket(cur, ticket_id, sets)
        if cible:
            fidelite = crediter_ticket(cur, ticket_id, t.get("client_id"), m["total"])

    statut_final = sets.get("statut", statut)
    if statut_final != statut:
        background_tasks.add_task(notif_changement_statut, t.get("ticket_code") or f"#{ticket_id}", statut, statut_final)

    result = {
        "ok": True,
        "paye": cible,
        "points_fidelite": fidelite["points_gagnes"] if fidelite else None,
        "statut": statut_final,
    }
    if fidelite:
        result["fidelite"] = fidelite
    return result


# ─── CHANGEMENT DE STATUT ───────────────────────────────────────
@router.patch("/{ticket_id}/statut", response_model=dict)
def change_status(
    ticket_id: int,
    data: StatusChange,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    """Change le statut d'un ticket avec historique et notifications.

    « Rendu au client » et « Clôturé » sont refusés (409 utiliser_restitution)
    tant que le ticket n'est pas réglé ou qu'un téléphone de prêt est dehors.
    « En attente d'accord client » → « Réparation terminée » = devis refusé :
    pièces non marquées reçues, issue='refus_devis', pas d'annonce « prêt ».
    proposer_message : le nouveau statut figure dans NOTIFICATIONS_STATUTS, la
    fiche et le scan proposent alors le message au client (jamais envoyé seul).
    """
    if data.statut not in STATUTS:
        raise HTTPException(400, f"Statut invalide. Valides: {STATUTS}")

    now, ts = _horodatage()
    auteur = _auteur(user)
    nouveau = data.statut

    with get_cursor() as cur:
        cur.execute("SELECT * FROM tickets WHERE id = %s FOR UPDATE", (ticket_id,))
        t = cur.fetchone()
        if not t:
            raise HTTPException(404, "Ticket non trouvé")
        t = dict(t)

        ancien = t.get("statut") or ""
        ticket_code = t.get("ticket_code") or f"#{ticket_id}"
        if ancien == nouveau:
            return {"ok": True, "ancien_statut": ancien, "nouveau_statut": nouveau, "proposer_message": False}

        if nouveau in _STATUTS_RENDUS:
            blocage = _blocage_rendu(t)
            if blocage:
                _conflit("utiliser_restitution", blocage[0], blocage[1])

        refus_devis = ancien == "En attente d'accord client" and nouveau == "Réparation terminée"
        textes = [f"Statut: {ancien} → {nouveau}" + (" (devis refusé par le client)" if refus_devis else "")]
        # Revenu à l'atelier : plus clôturé ni rendu (KPI, CA et purge RGPD des codes) ;
        # paye reste tel quel (l'argent a été encaissé), le CA suit date_cloture
        reouverture = ancien in _STATUTS_RENDUS and nouveau not in _STATUTS_RENDUS
        if reouverture:
            textes.append("Réouverture : dates de clôture et de rendu effacées")
        # Rendu / clôturé : l'appareil quitte l'étagère (« Emplacement B3 libéré »)
        liberation = etagere.liberer_emplacement(t, nouveau, textes)
        contenus = [f"{texte} — par {auteur}" for texte in textes]
        sets = {
            "statut": nouveau, "date_maj": now,
            "historique": _journal(t.get("historique"), "\n".join(f"[{ts}] {c}" for c in contenus)),
            **liberation,
        }
        if reouverture:
            sets["date_cloture"] = None
        if nouveau == "Clôturé":
            # Re-clôturer (Rendu → Clôturé) ne déplace pas le CA vers un autre jour
            sets["date_cloture"] = t.get("date_cloture") or now
        # Colonnes de _migrations_fiche : absentes si la migration a échoué au démarrage
        if "date_rendu" in t:
            if reouverture:
                sets.update(date_rendu=None, rendu_par=None)
            elif nouveau in _STATUTS_RENDUS and ancien not in _STATUTS_RENDUS:
                sets["date_rendu"] = t.get("date_rendu") or now
                sets["rendu_par"] = t.get("rendu_par") or auteur
        if "issue" in t:
            if refus_devis:
                sets["issue"] = "refus_devis"
            elif nouveau == "En cours de réparation" and t.get("issue"):
                sets["issue"] = None
        sets.update(_chrono_sets(t, ancien, nouveau, now))

        # Un seul envoi : historique, UPDATE du ticket (chronomètre compris), commandes de pièces,
        # note de validation au comptoir, puis relecture complète (renvoyée : la fiche n'a pas à
        # relire le ticket). Chaque instruction voit les précédentes.
        lot, params = [], []
        for contenu in contenus:
            lot.append(_SQL_HISTORIQUE)
            params += [ticket_id, contenu]
        lot.append(psql.SQL("UPDATE tickets SET {} WHERE id = %s;\n").format(psql.SQL(", ").join(
            psql.SQL("{} = %s").format(psql.Identifier(k)) for k in sets)))
        params += [*sets.values(), ticket_id]
        pieces = None if refus_devis else _sql_sync_pieces(ticket_id, nouveau, now)
        if pieces:
            lot.append(psql.SQL(pieces[0] + ";\n"))
            params += list(pieces[1])

        # Devis validé au comptoir (accord → en cours) : note 'validation_devis'
        # (bannière verte + point vert dashboard), dans la même transaction.
        validation_comptoir = ancien == "En attente d'accord client" and nouveau == "En cours de réparation"
        if validation_comptoir:
            lot.append(psql.SQL(
                "INSERT INTO notes_tickets (ticket_id, auteur, contenu, type_note, is_read)"
                " VALUES (%s, %s, %s, 'validation_devis', FALSE);\n"))
            params += [ticket_id, auteur, f"✅ Devis accepté par le client — validé au comptoir par {auteur}"]
        lot.append(psql.SQL(_select_complet() + " WHERE t.id = %s"))
        params.append(ticket_id)
        cur.execute(psql.Composed(lot), params)
        row = cur.fetchone()
        ticket = _completer(cur, row) if row else None
        proposer = _proposer_message(cur, nouveau, refus_devis)

    # Notifications hors du chemin de la réponse (Discord : jusqu'à 5 s)
    if refus_devis:
        background_tasks.add_task(notif_accord_client, ticket_code, False)
    elif nouveau == "Réparation terminée":
        background_tasks.add_task(notif_reparation_terminee, ticket_code)
    elif ancien:
        background_tasks.add_task(notif_changement_statut, ticket_code, ancien, nouveau)

    if validation_comptoir:
        panne = t.get("panne") or ""
        panne_excerpt = (panne[:50] + "…") if len(panne) > 50 else panne
        panne_str = f" Panne : {panne_excerpt}." if panne_excerpt else ""
        background_tasks.add_task(
            push_notification,
            type="devis_accepte_comptoir",
            title=f"✅ Devis accepté — {ticket_code}",
            message=f"{auteur} a validé la réparation pour le client.{panne_str} Tu peux démarrer.",
            important=True,
            icon="✅",
            target_user=t.get("technicien_assigne"),
            related_ticket_id=ticket_id,
            action_url=f"/accueil/ticket/{ticket_id}",
        )

    return {"ok": True, "ancien_statut": ancien, "nouveau_statut": nouveau, "proposer_message": proposer,
            "ticket": ticket}


# ─── RESTITUTION (remise au client en un appel, atomique et idempotente) ──
class RestitutionRequest(BaseModel):
    paiement: Literal["deja_paye", "encaisser", "non_paye"]
    mode_paiement: Optional[str] = Field(None, max_length=40)
    # Contrôlé dans la route : le 422 de Pydantic renverrait l'entrée NaN, que la réponse JSON ne sait pas encoder (500)
    montant: Optional[float] = None
    motif_non_paye: Optional[str] = Field(None, max_length=300)
    pret_restitue: Optional[bool] = None
    confirmer_non_termine: bool = False


@router.post("/{ticket_id}/restitution", response_model=dict)
def restituer_ticket(
    ticket_id: int,
    data: RestitutionRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    """Rend l'appareil au client : contrôles, paiement, fidélité et statut en une transaction.

    Réglé (encaisser / deja_paye, ou soldé par l'acompte) : Rendu au client
    puis Clôturé, paye=1, tarif_final = total, points crédités une fois. Non
    payé : reste « Rendu au client » avec le reste dû et le motif. Devis
    refusé : seuls les frais (diagnostic…) sont dus (services/montants). Un
    ticket déjà rendu renvoie deja_rendu=true sans rien réécrire (double
    clic, deux postes).
    """
    if data.montant is not None and not (math.isfinite(data.montant) and data.montant >= 0):
        raise HTTPException(422, detail={"code": "montant_invalide", "reste": None,
                                         "message": "Montant encaissé invalide."})
    now, ts = _horodatage()
    auteur = _auteur(user)
    fidelite = None

    with get_cursor() as cur:
        cur.execute("SELECT * FROM tickets WHERE id = %s FOR UPDATE", (ticket_id,))
        t = cur.fetchone()
        if not t:
            raise HTTPException(404, "Ticket non trouvé")
        t = dict(t)
        ancien = t.get("statut") or ""

        if ancien in _STATUTS_RENDUS:
            return {"ok": True, "deja_rendu": True, "ticket": _ticket_complet(cur, ticket_id),
                    "points_fidelite": None}

        if ancien != "Réparation terminée" and not data.confirmer_non_termine:
            _conflit("non_termine",
                     f"Le ticket est « {ancien} », pas « Réparation terminée » : confirmez la restitution en l'état.")
        if _pret_en_cours(t) and not data.pret_restitue:
            _conflit("pret_non_restitue",
                     f"Récupérez d'abord le téléphone de prêt ({t['telephone_pret']}).")

        m = calculer_montants(t)
        reste = m["reste"]
        motif = " ".join((data.motif_non_paye or "").split())
        if data.paiement == "deja_paye" and reste > 0:
            _conflit("reste_a_payer", f"Il reste {format_euros(reste)} € à payer.", reste)
        if (data.paiement == "encaisser" and data.montant is not None
                and abs(round(float(data.montant), 2) - reste) > 0.005):
            _conflit("reste_a_payer",
                     f"Montant encaissé ({format_euros(data.montant)} €) différent du reste à payer "
                     f"({format_euros(reste)} €).", reste)
        if data.paiement == "non_paye" and reste > 0 and not motif:
            _conflit("motif_requis", "Indiquez pourquoi l'appareil est rendu sans paiement.", reste)
        mode = " ".join((data.mode_paiement or "").split())
        if data.paiement == "encaisser" and reste > 0 and not mode:
            # Requête incomplète (la fiche envoie toujours le mode) : 422, même forme de detail que les 409
            raise HTTPException(422, detail={"code": "mode_requis", "reste": reste,
                                             "message": "Indiquez le mode de paiement (CB, espèces…)."})

        # Soldé par l'acompte (total > 0, reste 0) : réglé, quel que soit le choix de paiement
        regle = data.paiement != "non_paye" or bool(t.get("paye")) or (reste <= 0 and m["total"] > 0)
        final = "Clôturé" if regle else "Rendu au client"

        textes = []
        if _pret_en_cours(t):
            textes.append("Téléphone de prêt restitué")
        textes.append(f"Statut: {ancien} → Rendu au client")
        if data.paiement == "encaisser" and reste > 0:
            textes.append(f"Encaissé {format_euros(reste)} € ({mode})")
        if regle and not t.get("paye"):
            textes.append("Marqué payé" + (f" (soldé par l'acompte de {format_euros(m['acompte'])} €)"
                                           if reste <= 0 and m["acompte"] > 0 else ""))
        if not regle:
            textes.append(f"Rendu sans paiement (reste {format_euros(reste)} €)"
                          + (f" — motif : {motif}" if motif else ""))
        if final == "Clôturé":
            textes.append("Statut: Rendu au client → Clôturé")
        liberation = etagere.liberer_emplacement(t, final, textes)

        sets = {
            "statut": final, "date_maj": now,
            "historique": _journal(t.get("historique"), _historiser(cur, ticket_id, ts, auteur, textes)),
            **liberation,
        }
        if "date_rendu" in t:
            sets.update(date_rendu=now, rendu_par=auteur)
        if _pret_en_cours(t):
            sets["telephone_pret_rendu"] = _booleen(True)
        if regle:
            # tarif_final = montant encaissé et crédité : le CA (SUM(tarif_final) WHERE paye=1) le compte
            sets.update(paye=1, statut_paiement="Payé", reste_a_payer=0, tarif_final=m["total"],
                        date_cloture=t.get("date_cloture") or now)
        else:
            sets.update(statut_paiement=statut_paiement(m), reste_a_payer=reste)
        _maj_ticket(cur, ticket_id, sets)

        _maj_chrono(cur, ticket_id, t, ancien, final, now)
        # Rendu en l'état (devis refusé, non réparable) : les pièces jamais reçues ne passent pas « Reçu »
        if ancien == "Réparation terminée" and t.get("issue") != "refus_devis":
            _sync_pieces(cur, ticket_id, final, now)
        if regle:
            fidelite = crediter_ticket(cur, ticket_id, t.get("client_id"), m["total"])

        ticket = _ticket_complet(cur, ticket_id)

    background_tasks.add_task(notif_changement_statut, t.get("ticket_code") or f"#{ticket_id}", ancien, final)
    return {
        "ok": True,
        "deja_rendu": False,
        "ticket": ticket,
        "points_fidelite": fidelite["points_gagnes"] if fidelite else None,
    }


# ─── HISTORIQUE (structured table) ───────────────────────────────
@router.get("/{ticket_id}/historique")
def get_historique(ticket_id: int, user: dict = Depends(get_current_user)):
    """Retourne l'historique structuré d'un ticket."""
    with get_cursor() as cur:
        try:
            cur.execute("""
                SELECT id, type, contenu, date_creation
                FROM historique
                WHERE ticket_id = %s
                ORDER BY date_creation DESC
            """, (ticket_id,))
            rows = cur.fetchall()
            return [{**r, "date_creation": r["date_creation"].isoformat() if r.get("date_creation") else None} for r in rows]
        except Exception:
            return []


# ─── HISTORIQUE (legacy text field) ──────────────────────────────
@router.post("/{ticket_id}/historique", response_model=dict)
def add_history(
    ticket_id: int,
    texte: str = Query(...),
    user: dict = Depends(get_current_user),
):
    """Ajoute une entrée dans l'historique du ticket (horodatage de Paris)."""
    ts = heure_paris().strftime("%d/%m %H:%M")
    entry = f"[{ts}] {texte}"

    with get_cursor() as cur:
        cur.execute("SELECT historique FROM tickets WHERE id = %s", (ticket_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Ticket non trouvé")

        historique = row.get("historique") or ""
        new_hist = f"{historique.rstrip()}\n{entry}" if historique.strip() else entry
        cur.execute("UPDATE tickets SET historique = %s WHERE id = %s", (new_hist, ticket_id))
        _ajouter_historique(cur, ticket_id, 'statut', texte)

    return {"ok": True}


# ─── NOTE INTERNE ────────────────────────────────────────────────
@router.post("/{ticket_id}/note", response_model=dict)
def add_note(
    ticket_id: int,
    note: str = Query(...),
    user: dict = Depends(get_current_user),
):
    """Ajoute une note interne au ticket (horodatage de Paris)."""
    now, _ = _horodatage()
    ts = heure_paris().strftime("%d/%m/%Y %H:%M")

    with get_cursor() as cur:
        cur.execute("SELECT notes_internes FROM tickets WHERE id = %s", (ticket_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Ticket non trouvé")

        existing = row.get("notes_internes") or ""
        new_notes = f"{existing}\n[{ts}] {note}" if existing.strip() else f"[{ts}] {note}"
        cur.execute(
            "UPDATE tickets SET notes_internes = %s, date_maj = %s WHERE id = %s",
            (new_notes, now, ticket_id),
        )
        note_type = 'note_publique' if '[CLIENT]' in note else 'alerte' if '[ATTENTION]' in note else 'note_privee'
        _ajouter_historique(cur, ticket_id, note_type, note)

    return {"ok": True}


# ─── NOTES PRIVÉES ─────────────────────────────────────────────────
@router.get("/{ticket_id}/notes")
def get_notes(ticket_id: int, user: dict = Depends(get_current_user)):
    """Récupère les notes privées d'un ticket."""
    with get_cursor() as cur:
        try:
            cur.execute("""
                SELECT id, auteur, contenu, important, date_creation,
                       COALESCE(type_note, 'note') as type_note
                FROM notes_tickets
                WHERE ticket_id = %s
                ORDER BY date_creation DESC
            """, (ticket_id,))
            rows = cur.fetchall()
            return [{**r, "date_creation": r["date_creation"].isoformat() if r.get("date_creation") else None} for r in rows]
        except Exception:
            return []


@router.post("/{ticket_id}/notes")
def add_private_note(
    ticket_id: int,
    auteur: str = Query(...),
    contenu: str = Query(...),
    important: bool = Query(False),
    user: dict = Depends(get_current_user),
):
    """Ajoute une note privée à un ticket (404 si le ticket n'existe pas)."""
    with get_cursor() as cur:
        _exiger_ticket(cur, ticket_id)
        cur.execute("""
            INSERT INTO notes_tickets (ticket_id, auteur, contenu, important)
            VALUES (%s, %s, %s, %s) RETURNING id, date_creation
        """, (ticket_id, auteur, contenu, important))
        row = cur.fetchone()
        _ajouter_historique(cur, ticket_id, 'note_privee', f"Note ({auteur}): {contenu[:50]}...")
    return {"id": row["id"], "date_creation": row["date_creation"].isoformat()}


@router.delete("/{ticket_id}/notes/{note_id}")
def delete_private_note(
    ticket_id: int,
    note_id: int,
    user: dict = Depends(get_current_user),
):
    """Supprime une note privée. Idempotent."""
    with get_cursor() as cur:
        cur.execute("DELETE FROM notes_tickets WHERE id = %s AND ticket_id = %s", (note_id, ticket_id))
    return {"ok": True}


@router.patch("/{ticket_id}/notes/{note_id}")
def update_private_note(
    ticket_id: int,
    note_id: int,
    important: Optional[bool] = Query(None),
    user: dict = Depends(get_current_user),
):
    """Met à jour une note privée (toggle important)."""
    if important is not None:
        with get_cursor() as cur:
            cur.execute(
                "UPDATE notes_tickets SET important = %s WHERE id = %s AND ticket_id = %s",
                (important, note_id, ticket_id),
            )
    return {"ok": True}


# ─── MARK INTERACTIONS READ ───────────────────────────────────────
@router.put("/{ticket_id}/mark-read")
def mark_ticket_read(ticket_id: int, user: dict = Depends(get_current_user)):
    """Marque toutes les interactions client (message, devis, avis) comme lues."""
    with get_cursor() as cur:
        cur.execute("""
            UPDATE notes_tickets SET is_read = TRUE
            WHERE ticket_id = %s AND (is_read = FALSE OR is_read IS NULL)
            AND type_note IN ('message_client', 'validation_devis', 'avis_client')
        """, (ticket_id,))
    from app.api.suivi import invalider_interactions
    invalider_interactions()
    return {"ok": True}


# ─── CLIENT CONTACTÉ PAR TÉLÉPHONE ───────────────────────────────
@router.post("/{ticket_id}/contact", response_model=dict)
def noter_contact(ticket_id: int, data: ContactRequest, user: dict = Depends(get_current_user)):
    """Note un appel téléphonique au client et renvoie l'objet contact à jour.

    Seul le canal « appel » se note à la main : SMS, e-mail et WhatsApp sont tracés
    automatiquement à l'envoi (422 sinon). Note 'appel' « Appel téléphonique — client
    contacté[ : note] », signée du membre connecté ; `contact` = services/contact
    (depuis_statut, dernier, canaux), comme sur chaque ligne de ticket.
    """
    if data.canal != "appel":
        raise HTTPException(422, detail={
            "code": "canal_invalide",
            "message": "Seul l'appel téléphonique se note ici : SMS, e-mail et WhatsApp sont tracés à l'envoi.",
        })
    note = " ".join((data.note or "").split())
    contenu = contact.CONTENU_APPEL + (f" : {note}" if note else "")
    # Un seul envoi : la note (seulement si le ticket existe) puis l'objet contact relu par
    # une seconde instruction, qui voit la note. Ticket absent : aucune ligne, rien n'est écrit.
    # currval n'est évalué que pour la ligne du ticket, donc après l'INSERT de la note.
    with get_cursor() as cur:
        cur.execute(f"""
            INSERT INTO notes_tickets (ticket_id, auteur, contenu, important, type_note)
            SELECT id, %s, %s, FALSE, 'appel' FROM tickets WHERE id = %s;
            SELECT currval(pg_get_serial_sequence('notes_tickets', 'id')) AS note_id
                   {contact.colonne_sql('t')}
            FROM tickets t WHERE t.id = %s
        """, (_auteur(user), contenu, ticket_id, ticket_id))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Ticket non trouvé")
    return {"contact": contact.lire(row["contact_brut"]), "note_id": row["note_id"]}


# ─── LOG MESSAGE ENVOYÉ ──────────────────────────────────────────
@router.post("/{ticket_id}/message-log", response_model=dict)
def log_message(
    ticket_id: int,
    auteur: str = Query(...),
    contenu: str = Query(...),
    canal: str = Query("whatsapp"),
    user: dict = Depends(get_current_user),
):
    """Enregistre un message envoyé (whatsapp/sms/email) dans les notes (404 si le ticket n'existe pas)."""
    with get_cursor() as cur:
        _exiger_ticket(cur, ticket_id)
        cur.execute("""
            INSERT INTO notes_tickets (ticket_id, auteur, contenu, important, type_note)
            VALUES (%s, %s, %s, FALSE, %s) RETURNING id, date_creation
        """, (ticket_id, auteur, contenu, canal))
        row = cur.fetchone()
    return {"id": row["id"], "date_creation": row["date_creation"].isoformat()}


# ─── SUPPRESSION ─────────────────────────────────────────────────
@router.delete("/{ticket_id}", response_model=dict)
def delete_ticket(ticket_id: int, user: dict = Depends(require_admin)):
    """Supprime un ticket et toutes ses données liées (cascade).
    Idempotent : retourne toujours {"ok": true} même si le ticket n'existe pas.
    Élévation admin requise (X-Admin-Token, cf. POST /api/admin/verify).
    """
    with get_cursor() as cur:
        cur.execute("DELETE FROM notes_tickets WHERE ticket_id = %s", (ticket_id,))
        cur.execute("DELETE FROM commandes_pieces WHERE ticket_id = %s", (ticket_id,))
        cur.execute("DELETE FROM fidelite_historique WHERE ticket_id = %s", (ticket_id,))
        cur.execute("DELETE FROM historique WHERE ticket_id = %s", (ticket_id,))
        cur.execute("DELETE FROM tickets WHERE id = %s", (ticket_id,))
    from app.api.suivi import invalider_interactions
    invalider_interactions()
    return {"ok": True}


