"""
Étagère « À récupérer » du dashboard : appareils réparés qui attendent leur client
et appareils rendus sans paiement (reste dû). Une seule règle pour le compteur KPI
et la liste (GET /api/tickets/stats/dashboard?vue=a_recuperer).

Horodatages : naïfs en UTC (datetime.now() du serveur, CURRENT_TIMESTAMP de la base),
comptés en jours calendaires de Chambéry comme à l'écran.
"""

from datetime import date, datetime, timezone
from typing import Optional

from app.services.montants import calculer_montants

try:
    from zoneinfo import ZoneInfo
    _PARIS = ZoneInfo("Europe/Paris")
except Exception:  # image sans base tz : jour UTC
    _PARIS = None

# Conditions imprimées sur le ticket de dépôt : « Tout matériel non récupéré sous
# 3 mois sera considéré comme abandonné » (print_tickets)
DELAI_ABANDON_JOURS = 90

# Ligne d'historique écrite par change_status (« Statut: X → Réparation terminée — par … »)
_MOTIF_TERMINE = "%→ Réparation terminée%"


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


# Terminés d'abord (l'étagère physique), puis les rendus non payés ; les plus anciens en tête
ORDRE_SQL = "(t.statut = 'Rendu au client'), fin_reparation ASC NULLS LAST, t.id ASC"


def _jour_local(dt: datetime) -> date:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(_PARIS).date() if _PARIS else dt.astimezone(timezone.utc).date()


def jours_depuis(fin, maintenant: Optional[datetime] = None) -> Optional[int]:
    """Jours calendaires écoulés depuis `fin` (0 le jour même), None si inconnu."""
    if isinstance(fin, str):
        try:
            fin = datetime.fromisoformat(fin.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    if not isinstance(fin, datetime):
        return None
    maintenant = maintenant or datetime.now(timezone.utc)
    return max(0, (_jour_local(maintenant) - _jour_local(fin)).days)


def enrichir(rows, maintenant: Optional[datetime] = None) -> list:
    """Ajoute jours_attente et reste_du (services/montants) à chaque ticket de l'étagère."""
    out = []
    for r in rows:
        r["jours_attente"] = jours_depuis(r.get("fin_reparation"), maintenant)
        r["reste_du"] = calculer_montants(r)["reste"]
        out.append(r)
    return out
