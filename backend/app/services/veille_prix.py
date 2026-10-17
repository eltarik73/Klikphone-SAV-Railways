"""
Veille hebdomadaire des prix : comptages seulement, AUCUNE écriture de prix.

Un fil démon par processus (demarrer_veille_hebdomadaire, lancé dans le lifespan de main.py),
coupé par KP_VEILLE_PRIX=0 : il vérifie toutes les heures si le passage de la semaine est dû.
Le passage (veille_prix) compte les prix à revoir (plus de 90 jours), périmés (plus de 180
jours ou jamais datés), estimés (saisis le 2026-02-15, jamais confirmés), les propositions
en attente, les marges faibles (services/prix.sante : mêmes chiffres que /api/tarifs/sante),
les modèles du catalogue sans prix (api/grille.modeles_sans_prix) et l'ancienneté de la
dernière synchro LCD-Phone ; il écrit le résumé dans params (VEILLE_PRIX_RESUME, JSON) et sa
date (VEILLE_PRIX_DERNIERE, qui empêche un second passage dans la semaine, même après un
redéploiement ou à plusieurs processus : verrou pg_advisory), puis publie une notification
dans le centre de notifications. Aucune donnée nominative : des comptes et des modèles.
"""

import json
import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone

from app.database import get_cursor
from app.services import params as params_cache
from app.services import prix as prix_srv

logger = logging.getLogger(__name__)

PARAM_RESUME = "VEILLE_PRIX_RESUME"
PARAM_DERNIERE = "VEILLE_PRIX_DERNIERE"
PERIODE = timedelta(days=7)
_VERROU = 731_002_027   # pg_advisory : un seul passage à la fois, même à plusieurs workers
_TOP_SANS_PRIX = 10


def maintenant_utc() -> datetime:
    """Heure UTC sans fuseau, comme NOW() en base et les dates de synchro LCD-Phone (utcnow)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _lire_date(v):
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v).strip().replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _vrai(v):
    if v is None or str(v).strip() == "":
        return None
    return str(v).strip().lower() in ("1", "true", "oui", "ok", "yes")


def calculer(cur, maintenant: datetime = None) -> dict:
    """Résumé de la veille (lecture seule)."""
    from app.api import grille   # import différé : grille importe services/prix
    maintenant = maintenant or maintenant_utc()
    r = prix_srv.regles(cur)
    sante = prix_srv.sante(cur, r)
    sans_prix = grille.modeles_sans_prix(cur)
    cur.execute("SELECT cle, valeur FROM params WHERE cle IN ('LCDPHONE_DERNIERE_SYNCHRO', 'LCDPHONE_SYNCHRO_OK')")
    lcd = {row["cle"]: row["valeur"] for row in cur.fetchall() or []}
    derniere_lcd = _lire_date(lcd.get("LCDPHONE_DERNIERE_SYNCHRO"))
    return {
        "le": maintenant.isoformat(timespec="seconds"),
        "total": sante.get("total", 0),
        "estimes": sante.get("estimes", 0),
        "a_revoir": sante.get("a_revoir", 0),
        "perimes": sante.get("perimes", 0),
        "marges_faibles": sante.get("marges_faibles", 0),
        "verrouilles": sante.get("verrouilles", 0),
        "propositions_en_attente": sante.get("propositions_en_attente", 0),
        "modeles_sans_prix": len(sans_prix),
        "modeles_sans_prix_demandes": [
            {k: m[k] for k in ("categorie", "marque", "modele", "tickets_12_mois")}
            for m in sans_prix if m["tickets_12_mois"] > 0
        ][:_TOP_SANS_PRIX],
        "lcdphone": {
            "derniere_synchro": derniere_lcd.isoformat(timespec="seconds") if derniere_lcd else None,
            "ok": _vrai(lcd.get("LCDPHONE_SYNCHRO_OK")),
            "age_jours": (maintenant - derniere_lcd).days if derniere_lcd else None,
        },
        "seuils": {"jours_a_revoir": r["jours_a_revoir"], "jours_perime": r["jours_perime"],
                   "seuil_marge_alerte": r["seuil_marge_alerte"]},
    }


def message(resume: dict) -> str:
    s = resume["seuils"]
    morceaux = [
        f"{resume['a_revoir']} prix à revoir (plus de {s['jours_a_revoir']} jours)",
        f"{resume['perimes']} périmés (plus de {s['jours_perime']} jours)",
    ]
    if resume["estimes"]:
        morceaux.append(f"{resume['estimes']} estimations jamais confirmées")
    morceaux += [
        f"{resume['propositions_en_attente']} proposition(s) en attente",
        f"{resume['marges_faibles']} marge(s) d'écran sous {s['seuil_marge_alerte']} €",
        f"{resume['modeles_sans_prix']} modèle(s) du catalogue sans prix",
    ]
    lcd = resume["lcdphone"]
    if lcd["age_jours"] is None:
        morceaux.append("LCD-Phone : aucune synchro enregistrée")
    else:
        etat = "" if lcd["ok"] is not False else " (en échec)"
        morceaux.append(f"LCD-Phone : dernière synchro il y a {lcd['age_jours']} j{etat}")
    return " · ".join(morceaux) + "."


def _ecrire(cur, cle: str, valeur: str):
    cur.execute("""INSERT INTO params (cle, valeur) VALUES (%s, %s)
                   ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur""", (cle, valeur))


def veille_prix(maintenant: datetime = None, notifier: bool = True, forcer: bool = False):
    """Passage de la semaine : None s'il a déjà eu lieu depuis moins de 7 jours (sauf forcer)
    ou si un autre processus le tient ; sinon le résumé, écrit dans params et notifié."""
    maintenant = maintenant or maintenant_utc()
    with get_cursor() as cur:
        cur.execute("SELECT pg_try_advisory_xact_lock(%s) AS ok", (_VERROU,))
        if not (cur.fetchone() or {}).get("ok"):
            return None
        cur.execute("SELECT valeur FROM params WHERE cle = %s", (PARAM_DERNIERE,))
        row = cur.fetchone()
        derniere = _lire_date(row["valeur"]) if row else None
        if not forcer and derniere is not None and maintenant - derniere < PERIODE:
            return None
        resume = calculer(cur, maintenant)
        _ecrire(cur, PARAM_RESUME, json.dumps(resume, ensure_ascii=False, default=str))
        _ecrire(cur, PARAM_DERNIERE, maintenant.isoformat(timespec="seconds"))
    params_cache.invalidate()
    if notifier:
        try:
            from app.api.notifications_center import push_notification
            push_notification(
                type="veille_prix", title="Veille des prix", message=message(resume),
                important=False, action_url="/accueil/tarifs",
                icon="🏷️", also_chat=False,
            )
        except Exception as e:
            logger.warning("Veille des prix : notification non envoyée (%s)", type(e).__name__)
    return resume


_tache = {"thread": None}


def _boucle(delai_initial: float, periode: float):
    time.sleep(delai_initial)
    while True:
        try:
            veille_prix()
        except Exception as e:
            # Type seul : un message d'erreur SQL peut citer des valeurs
            logger.warning("Veille des prix : échec (%s)", type(e).__name__)
        time.sleep(periode)


def demarrer_veille_hebdomadaire(delai_initial: float = 600, periode: float = 3600) -> bool:
    """Tâche de fond (une par processus) : vérifie chaque heure si le passage hebdomadaire est dû.
    KP_VEILLE_PRIX=0 dans l'environnement empêche même la tâche (tests, maintenance).
    True si un fil vient d'être démarré."""
    if os.getenv("KP_VEILLE_PRIX") == "0":
        return False
    t = _tache["thread"]
    if t is not None and t.is_alive():
        return False
    t = threading.Thread(target=_boucle, args=(delai_initial, periode), daemon=True, name="veille_prix")
    _tache["thread"] = t
    t.start()
    return True
