"""
Étagère « À récupérer » du dashboard : appareils réparés qui attendent leur client
et appareils rendus sans paiement (reste dû). Une seule règle pour le compteur KPI
et la liste (GET /api/tickets/stats/dashboard?vue=a_recuperer), plus l'emplacement
physique, le compteur de relances et le délai légal d'abandon (api/etagere.py).

Horodatages : naïfs en UTC (datetime.now() du serveur, CURRENT_TIMESTAMP de la base),
comptés en jours calendaires de Chambéry comme à l'écran.
"""

import re
from datetime import date, datetime, timezone
from typing import Optional

from app.services import params as params_cache
from app.services.montants import calculer_montants

try:
    from zoneinfo import ZoneInfo
    _PARIS = ZoneInfo("Europe/Paris")
except Exception:  # image sans base tz : jour UTC
    _PARIS = None

# Loi du 31 décembre 1903, art. 1er : un objet confié pour réparation et non retiré
# dans le délai d'un an peut être vendu, seulement sur autorisation du juge (art. 2).
# Défaut et minimum : le paramètre peut allonger le délai, jamais le raccourcir.
PARAM_DELAI_ABANDON = "ETAGERE_DELAI_ABANDON_JOURS"
DELAI_ABANDON_JOURS = 365

PARAM_PALIERS = "ETAGERE_RELANCE_PALIERS"
PALIERS_DEFAUT = (3, 10, 30, 90, 180, 330)
# Aucune relance proposée moins de 3 jours après le dernier message
DELAI_ENTRE_RELANCES_JOURS = 3

PARAM_EMPLACEMENTS = "ETAGERE_EMPLACEMENTS"
EMPLACEMENT_MAX = 20
_EMPLACEMENTS_MAX_PROPOSES = 40

# Courrier de mise en demeure : proposé à partir de J+90, délai de retrait accordé
MISE_EN_DEMEURE_JOURS = 90
MISE_EN_DEMEURE_DELAI_RETRAIT = 15

# Messages comptés comme relances (message-log de la fiche, POST /api/etagere/{id}/relance)
TYPES_RELANCE = ("whatsapp", "sms", "email", "relance")
_TYPES_RELANCE_SQL = "('whatsapp', 'sms', 'email', 'relance')"

# Ligne d'historique écrite par change_status (« Statut: X → Réparation terminée — par … »)
_MOTIF_TERMINE = "%→ Réparation terminée%"
_JOURS_MAX = 3650


def a_recuperer_sql(t: str = "t") -> str:
    """Condition SQL (texte fixe, aucune saisie) : terminé, ou rendu non payé qui porte un montant.

    Une réparation gratuite (garantie) rendue sans paiement n'a rien à réclamer :
    sans aucun montant elle n'est pas comptée.
    """
    return (
        f"({t}.statut = 'Réparation terminée' OR ({t}.statut = 'Rendu au client'"
        f" AND COALESCE({t}.paye, 0) = 0 AND (COALESCE({t}.tarif_final, 0) > 0"
        f" OR COALESCE({t}.devis_estime, 0) > 0 OR COALESCE({t}.prix_supp, 0) > 0"
        f" OR COALESCE({t}.reste_a_payer, 0) > 0)))"
    )


def fin_reparation_sql(sp, t: str = "t") -> str:
    """Dernier passage en « Réparation terminée » (historique), sinon fin du chrono,
    dernière modification puis dépôt (anciens tickets sans historique structuré)."""
    motif = sp.add(_MOTIF_TERMINE)
    return (
        f"COALESCE((SELECT MAX(h.date_creation) FROM historique h"
        f" WHERE h.ticket_id = {t}.id AND h.contenu LIKE {motif}),"
        f" {t}.reparation_fin, {t}.date_maj, {t}.date_depot)"
    )


def relances_sql(fin: str, t: str = "t") -> str:
    """FROM … WHERE des messages envoyés depuis la fin de réparation (index ticket_id, type_note)."""
    return (f"FROM notes_tickets n WHERE n.ticket_id = {t}.id"
            f" AND n.type_note IN {_TYPES_RELANCE_SQL} AND n.date_creation >= {fin}")


def colonnes_sql(sp, t: str = "t") -> str:
    """Colonnes ajoutées à la liste de l'étagère : fin_reparation, nb_relances, derniere_relance.

    Sous-requêtes corrélées dans la même requête (pas de N+1) ; l'emplacement vient de t.*.
    """
    fin = fin_reparation_sql(sp, t)
    rel = relances_sql(fin, t)
    return (f", {fin} AS fin_reparation"
            f", (SELECT COUNT(*) {rel}) AS nb_relances"
            f", (SELECT MAX(n.date_creation) {rel}) AS derniere_relance")


# Terminés d'abord (l'étagère physique), puis les rendus non payés ; les plus anciens en tête
ORDRE_SQL = "(t.statut = 'Rendu au client'), fin_reparation ASC NULLS LAST, t.id ASC"


def _jour_local(dt: datetime) -> date:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(_PARIS).date() if _PARIS else dt.astimezone(timezone.utc).date()


def _datetime(v) -> Optional[datetime]:
    if isinstance(v, str):
        try:
            v = datetime.fromisoformat(v.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    return v if isinstance(v, datetime) else None


def jour_local(v) -> Optional[date]:
    """Jour calendaire de Chambéry d'un horodatage (datetime ou ISO), None si inconnu."""
    dt = _datetime(v)
    return _jour_local(dt) if dt else None


def jours_depuis(fin, maintenant: Optional[datetime] = None) -> Optional[int]:
    """Jours calendaires écoulés depuis `fin` (0 le jour même), None si inconnu."""
    fin = _datetime(fin)
    if fin is None:
        return None
    maintenant = maintenant or datetime.now(timezone.utc)
    return max(0, (_jour_local(maintenant) - _jour_local(fin)).days)


# ─── Paramètres (table params, cache 30 s) ─────────────────────

def _entier(v) -> Optional[int]:
    try:
        n = int(str(v).strip())
    except (TypeError, ValueError):
        return None
    return n if 0 < n <= _JOURS_MAX else None


def lire_delai_abandon(valeur) -> int:
    """Jamais moins d'un an : une valeur plus courte (écrite en SQL, ancienne version) donne 365,
    comme les impressions (mentions.jours_abandon) ; absente ou illisible : 365."""
    return max(_entier(valeur) or DELAI_ABANDON_JOURS, DELAI_ABANDON_JOURS)


def delai_abandon_jours(cur=None) -> int:
    """ETAGERE_DELAI_ABANDON_JOURS, 365 si absent, invalide ou plus court qu'un an."""
    return lire_delai_abandon(params_cache.get_param(PARAM_DELAI_ABANDON, "", cur=cur))


def lire_paliers(valeur) -> list:
    """« 3,10,30 » → [3, 10, 30] triés sans doublon. Paramètre absent ou illisible : paliers
    par défaut ; liste vidée exprès (« ») : aucune relance proposée."""
    if valeur is None:
        return list(PALIERS_DEFAUT)
    jetons = [j for j in re.split(r"[,;\s]+", str(valeur)) if j]
    if not jetons:
        return []
    paliers = sorted({n for n in (_entier(j) for j in jetons) if n})
    return paliers or list(PALIERS_DEFAUT)


def relance_paliers(cur=None) -> list:
    return lire_paliers(params_cache.get_param(PARAM_PALIERS, None, cur=cur))


def normaliser_emplacement(valeur) -> Optional[str]:
    """« b3 » → « B3 » : espaces rognés et réduits, majuscules ; vide → None (retiré)."""
    if valeur is None:
        return None
    v = " ".join(str(valeur).split()).upper()
    if not v:
        return None
    if len(v) > EMPLACEMENT_MAX:
        raise ValueError(f"Emplacement : {EMPLACEMENT_MAX} caractères maximum")
    if not v.isprintable():
        raise ValueError("Emplacement : caractères invalides")
    return v


STATUTS_RENDUS = ("Rendu au client", "Clôturé")


def liberer_emplacement(t: dict, statut: str, textes: list) -> dict:
    """Passage en « Rendu au client » / « Clôturé » (restitution, changement de statut) : l'appareil
    quitte l'étagère. Ajoute « Emplacement B3 libéré » aux lignes d'historique à écrire et renvoie
    {"emplacement": None} à fusionner dans le SET ; {} s'il n'était pas rangé."""
    emplacement = (t or {}).get("emplacement")
    if statut not in STATUTS_RENDUS or not emplacement:
        return {}
    textes.append(f"Emplacement {emplacement} libéré")
    return {"emplacement": None}


def lire_emplacements(valeur) -> list:
    out = []
    for brut in str(valeur or "").split(","):
        try:
            v = normaliser_emplacement(brut)
        except ValueError:
            continue
        if v and v not in out:
            out.append(v)
    return out[:_EMPLACEMENTS_MAX_PROPOSES]


def emplacements_proposes(cur=None) -> list:
    """ETAGERE_EMPLACEMENTS (« A1, A2, B1 ») : boutons rapides, vide par défaut."""
    return lire_emplacements(params_cache.get_param(PARAM_EMPLACEMENTS, "", cur=cur))


def config(cur=None) -> dict:
    return {
        "emplacements": emplacements_proposes(cur),
        "delai_abandon_jours": delai_abandon_jours(cur),
        "relance_paliers": relance_paliers(cur),
        "mise_en_demeure_jours": MISE_EN_DEMEURE_JOURS,
    }


# Clés canoniques BOUTIQUE_*, puis anciennes clés (page Config, devis, impressions) dans le
# même ordre que services/mentions, puis défaut
_IDENTITE = {
    "nom": (("BOUTIQUE_NOM", "nom_boutique", "NOM_BOUTIQUE"), "Klikphone"),
    "adresse": (("BOUTIQUE_ADRESSE", "adresse", "ADRESSE_BOUTIQUE"), "79 Place Saint-Léger, 73000 Chambéry"),
    "tel": (("BOUTIQUE_TEL", "telephone", "tel_boutique", "TEL_BOUTIQUE"), "04 79 60 89 22"),
    "email": (("BOUTIQUE_EMAIL", "email", "EMAIL_BOUTIQUE"), ""),
    "siret": (("BOUTIQUE_SIRET", "siret", "SIRET", "SIRET_BOUTIQUE"), ""),
    "horaires": (("horaires", "HORAIRES_BOUTIQUE"), "Lundi-Samedi 10h-19h"),
}


def identite_boutique(cur=None) -> dict:
    cles = [c for cles, _ in _IDENTITE.values() for c in cles]
    valeurs = params_cache.get_params(cles, cur=cur)
    out = {}
    for champ, (cles, defaut) in _IDENTITE.items():
        out[champ] = next((v.strip() for v in (valeurs.get(c) for c in cles) if v and v.strip()), defaut)
    return out


# ─── Relances ──────────────────────────────────────────────────

def prochain_palier(paliers, jours_derniere: Optional[int]) -> Optional[int]:
    """Premier palier qu'aucune relance ne couvre : une relance envoyée à J+d couvre les paliers ≤ d."""
    for p in sorted(paliers or ()):
        if jours_derniere is None or p > jours_derniere:
            return p
    return None


def relance_due(jours_attente, fin, derniere, paliers, maintenant: Optional[datetime] = None) -> bool:
    """Palier atteint et pas encore couvert, et rien envoyé depuis 3 jours."""
    if jours_attente is None:
        return False
    jours_derniere = jours_depuis(fin, _datetime(derniere)) if _datetime(derniere) else None
    palier = prochain_palier(paliers, jours_derniere)
    if palier is None or jours_attente < palier:
        return False
    if jours_derniere is None:
        return True
    return (jours_depuis(derniere, maintenant) or 0) >= DELAI_ENTRE_RELANCES_JOURS


def enrichir(rows, maintenant: Optional[datetime] = None, paliers=None) -> list:
    """Ajoute jours_attente, reste_du (services/montants), emplacement, nb_relances,
    derniere_relance et relance_due (appareils en boutique seulement) à chaque ticket."""
    if paliers is None:
        paliers = relance_paliers()
    out = []
    for r in rows:
        en_boutique = r.get("statut") == "Réparation terminée"
        r["jours_attente"] = jours_depuis(r.get("fin_reparation"), maintenant)
        r["reste_du"] = calculer_montants(r)["reste"]
        # Rendu, même impayé : l'appareil n'est plus sur l'étagère
        r["emplacement"] = r.get("emplacement") if en_boutique else None
        r["nb_relances"] = int(r.get("nb_relances") or 0)
        r.setdefault("derniere_relance", None)
        r["relance_due"] = en_boutique and relance_due(
            r["jours_attente"], r.get("fin_reparation"), r["derniere_relance"], paliers, maintenant)
        out.append(r)
    return out


def canal_relance(type_note: str, contenu: str = "") -> str:
    """Libellé du canal d'une relance tracée (courrier de mise en demeure)."""
    if type_note == "relance" and (contenu or "").startswith("Appel téléphonique"):
        return "Appel téléphonique"
    return {"whatsapp": "WhatsApp", "sms": "SMS", "email": "E-mail"}.get(type_note, "Relance")
