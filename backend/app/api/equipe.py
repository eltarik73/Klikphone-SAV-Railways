"""
Activité de l'équipe : journal des connexions et pointage de présence (services/presence.py).

Personnel (jeton de session) :
- GET  /api/equipe/position/config → {actif} seulement : pointage activé, position de la boutique
  confirmée, note d'information (version en vigueur) remise à CE membre ; à toute heure ;
- POST /api/equipe/position        → une fois par session : {lat, lng, precision_m} | {refus} |
  {indisponible}. Gardés : statut, distance arrondie à 50 m, précision et, hors de la boutique ou
  position imprécise, la position arrondie à ≈ 100 m (geo_lat, geo_lng : carte de l'admin, 60 jours).
  Jamais journalisées ni renvoyées au salarié. Corps lu à la main : aucune erreur de validation ne
  peut renvoyer l'entrée.

Admin (rôle admin ET code admin saisi depuis moins de 10 min : exiger_elevation puis
exiger_role_admin ; 403 sinon) — un poste partagé resté au nom du gérant ne suffit pas :
- GET  /api/equipe/activite?semaine=AAAA-MM-JJ → semaine (lundi → dimanche, heure de Paris),
  connectés, une ligne par salarié avec arrivée / départ / durée (union des intervalles) ;
- GET  /api/equipe/sessions?utilisateur=&jour= → sessions d'un salarié pour un jour ;
- GET/PUT /api/equipe/reglages, POST /reglages/information-remise (par membre),
  POST /reglages/position-boutique ;
- GET  /api/equipe/export.csv?utilisateur=&depuis=&jusqua= (répond aussi à une demande d'accès).
Consultation de l'activité et du détail d'un jour, export, activation, note remise et position
boutique : tracés dans admin_audit_log (qui, quand, filtre), sans autre donnée.
"""

import csv
import io
import re
import threading
from datetime import date, datetime, timedelta
from time import monotonic
from typing import List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.database import get_cursor
from app.api.auth import deconnecter_tout_le_monde, exiger_elevation, exiger_role_admin, get_current_user
from app.services import mentions
from app.services import params as params_cache
from app.services import presence

router = APIRouter(prefix="/api/equipe", tags=["equipe"])

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
EXPORT_MAX_JOURS = 400
ERREUR_POSITION = "Données de position invalides"


def admin_equipe(request: Request, user: dict = Depends(get_current_user)) -> dict:
    """Code admin saisi depuis moins de 10 min (X-Admin-Token, ou X-Admin-Password) PUIS rôle
    admin du membre (403 sinon). La preuve de 30 jours du poste ne suffit pas : données de
    présence des salariés (art. 32 RGPD)."""
    eleve = exiger_elevation(request, user)
    return exiger_role_admin(request, eleve)


def _jour(valeur: Optional[str], nom: str) -> Optional[date]:
    v = (valeur or "").strip()
    if not v:
        return None
    if not _DATE_RE.match(v):
        raise HTTPException(400, f"{nom} : date AAAA-MM-JJ attendue")
    try:
        return date.fromisoformat(v)
    except ValueError:
        raise HTTPException(400, f"{nom} : date invalide")


def _iso_utc(d: Optional[datetime]) -> Optional[str]:
    return d.replace(microsecond=0).isoformat() + "Z" if d else None


def _hm(d: Optional[datetime]) -> Optional[str]:
    return presence.vers_paris(d).strftime("%H:%M") if d else None


def _hm_local(d: Optional[datetime], jour: date) -> Optional[str]:
    """Heure de Paris déjà locale ; minuit du lendemain (session coupée au jour) → « 24:00 »."""
    if d is None:
        return None
    if d.date() > jour:
        return "24:00"
    return d.strftime("%H:%M")


def _bornes(debut: date, fin_exclue: date):
    """Bornes UTC naïves de jours de Paris [debut, fin_exclue[."""
    return (presence.paris_vers_utc(datetime.combine(debut, datetime.min.time())),
            presence.paris_vers_utc(datetime.combine(fin_exclue, datetime.min.time())))


# Consultations tracées, mais une seule trace par admin et par filtre toutes les 5 min
# (la page se rafraîchit) ; mémoire bornée
_TRACES_RECENTES: dict = {}
_TRACES_VERROU = threading.Lock()
TRACE_ECART_S = 300


def _tracer(request: Request, user: dict, action: str, details: str, regrouper: bool = False):
    if regrouper:
        cle = (user.get("sub"), user.get("sid"), action, details)
        now = monotonic()
        with _TRACES_VERROU:
            vu = _TRACES_RECENTES.get(cle)
            if vu is not None and now - vu < TRACE_ECART_S:
                return
            if len(_TRACES_RECENTES) > 500:
                _TRACES_RECENTES.clear()
            _TRACES_RECENTES[cle] = now
    try:
        with get_cursor() as cur:
            presence.journaliser(cur, request, user, action, details)
    except Exception:
        pass


# ─── État du dispositif : réglages, note en vigueur, remises par membre ─

MSG_NOTE_A_REMETTRE = ("Remettez d'abord la note d'information aux salariés, puis cochez la remise "
                       "pour chacun dans la liste ci-dessus : aucune donnée ne peut être collectée par un "
                       "dispositif dont ils n'ont pas été informés au préalable (article L1222-4 du Code du "
                       "travail).")
MSG_BOUTIQUE_A_CONFIRMER = ("Enregistrez d'abord la position de la boutique depuis un téléphone ou une tablette "
                            "dans la boutique (« Enregistrer la position de la boutique ») : avec la position "
                            "par défaut, approximative, le résultat du pointage serait inexact.")


def _etat(cur, reglages: Optional[dict] = None, membres: Optional[list] = None) -> dict:
    """Réglages + note en vigueur (texte, version) + remise de cette version à chaque salarié
    actif (hors robots). Le pointage ne tourne que si l'interrupteur est mis, la position de la
    boutique confirmée et la note remise à au moins un salarié ; il ne vise que ceux-là."""
    reglages = reglages or presence.lire_reglages(cur)
    note = _note(reglages)
    texte = _texte_note(note)
    version = presence.version_note(texte)
    salaries = presence.salaries_actifs(membres if membres is not None else presence.lire_membres(cur))
    remises = presence.lire_remises(cur)
    liste = []
    for m in salaries:
        r = remises.get(m["nom"])
        liste.append({
            "utilisateur": m["nom"],
            "remise_le": _iso_utc(r["remise_le"]) if r else None,
            "remise_par": (r.get("remise_par") or None) if r else None,
            "a_jour": bool(r and r.get("version") == version),
        })
    a_jour = [x for x in liste if x["a_jour"]]
    derniere = max(a_jour, key=lambda x: x["remise_le"] or "") if a_jour else None
    blocage = None
    if not a_jour:
        blocage = MSG_NOTE_A_REMETTRE
    elif not reglages["boutique_position_confirmee"]:
        blocage = MSG_BOUTIQUE_A_CONFIRMER
    return {
        "reglages": reglages, "note": note, "texte": texte, "version": version,
        "remises": liste,
        "a_jour": {x["utilisateur"] for x in a_jour},
        "sans_note": [x["utilisateur"] for x in liste if not x["a_jour"]],
        "derniere": derniere,
        "blocage": blocage,
        "pointage_actif": bool(reglages["interrupteur"] and blocage is None),
    }


def _pointage_pour(cur, user: dict) -> bool:
    """Le pointage vise-t-il ce membre (interrupteur, boutique confirmée, note remise à lui) ?"""
    etat = _etat(cur)
    return etat["pointage_actif"] and (user.get("sub") or "").strip() in etat["a_jour"]


# ─── Personnel : pointage de sa propre session ───────────────────

@router.get("/position/config")
def position_config(user: dict = Depends(get_current_user)):
    """Le poste doit-il lire la position une fois maintenant ? Aucun autre réglage n'est exposé.
    À chaque connexion, quelle que soit l'heure (le gérant l'a demandé, la note l'annonce)."""
    try:
        with get_cursor() as cur:
            return {"actif": _pointage_pour(cur, user)}
    except Exception:
        return {"actif": False}


def _enregistrer_position(corps, user: dict) -> dict:
    if not isinstance(corps, dict):
        raise HTTPException(422, ERREUR_POSITION)
    refus, indisponible = corps.get("refus") is True, corps.get("indisponible") is True
    precision = presence.precision_valide(corps.get("precision_m"))
    if not (refus or indisponible) and (
            precision is None or not presence.coordonnees_valides(corps.get("lat"), corps.get("lng"))):
        raise HTTPException(422, ERREUR_POSITION)
    with get_cursor() as cur:
        etat = _etat(cur)
    if not (etat["pointage_actif"] and (user.get("sub") or "").strip() in etat["a_jour"]):
        raise HTTPException(409, "Pointage de présence inactif pour cette session")
    reglages = etat["reglages"]
    session = presence.session_courante(user)
    if not session:
        raise HTTPException(409, "Aucune session ouverte pour ce poste")
    if session.get("geo_le") is not None:
        raise HTTPException(409, "Présence déjà vérifiée pour cette session")
    distance = lat = lng = None
    if refus:
        statut, precision = "refusee", None
    elif indisponible:
        statut, precision = "indisponible", None
    else:
        brute = presence.haversine_m(float(corps["lat"]), float(corps["lng"]),
                                     reglages["boutique_lat"], reglages["boutique_lng"])
        statut = presence.statut_position(brute, precision, reglages["rayon_m"])
        # Distance gardée seulement pour un résultat net : celle d'une position imprécise
        # (± plusieurs centaines de mètres) serait une donnée inexacte sur le salarié
        if statut != "imprecise":
            distance = min(presence.arrondi_distance(brute), 20_000_000)
        # Hors de la boutique ou position imprécise : position approximative (≈ 100 m) pour la carte
        if statut != "en_boutique":
            lat, lng = float(corps["lat"]), float(corps["lng"])
        precision = min(precision, 1_000_000)
    if not presence.enregistrer_position(session["id"], statut, distance, precision, lat, lng):
        raise HTTPException(409, "Présence déjà vérifiée pour cette session")
    if lat is not None:
        presence.completer_lieu(session["id"], presence.arrondi_position(lat), presence.arrondi_position(lng))
    return {"ok": True}


@router.post("/position")
async def envoyer_position(request: Request, user: dict = Depends(get_current_user)):
    """Une seule fois par session. Corps lu sans validation automatique : une erreur ne renvoie
    jamais l'entrée (les coordonnées), et rien n'est écrit dans les journaux."""
    try:
        corps = await request.json()
    except Exception:
        corps = None
    return await run_in_threadpool(_enregistrer_position, corps, user)


# ─── Admin : semaine de l'équipe ─────────────────────────────────

# Durées calculées sur les instants UTC (a, b) : une nuit de changement d'heure compte sa vraie
# durée ; les jours sont ceux de Paris (bornes de chaque jour converties en UTC), l'heure de Paris
# ne sert qu'à l'affichage (arrivée, départ).
_SQL_SEMAINE = """
WITH s AS (
    SELECT c.id, c.utilisateur, c.appareil_type, c.appareil_marque, c.actions,
           c.geo_statut, c.geo_distance_m,
           c.fin IS NULL AND c.derniere_activite >= %(en_ligne)s AS ouverte,
           c.debut AS du,
           GREATEST(COALESCE(c.fin, c.derniere_activite), c.derniere_activite, c.debut) AS fu
    FROM connexions_equipe c
    WHERE c.debut < %(fin_utc)s
      AND c.debut >= %(deb_utc)s - INTERVAL '7 days'
      AND GREATEST(COALESCE(c.fin, c.derniere_activite), c.derniere_activite, c.debut) >= %(deb_utc)s
),
sl AS (
    SELECT s.*, (s.du AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris' AS d,
           (s.fu AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris' AS f
    FROM s
),
morceaux AS (
    SELECT sl.*, g.jour::date AS jour,
           g.jour = date_trunc('day', sl.d) AS premier,
           sl.ouverte AND g.jour = date_trunc('day', sl.f) AS en_cours,
           GREATEST(sl.du, (g.jour AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC') AS a,
           LEAST(sl.fu, ((g.jour + INTERVAL '1 day') AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC') AS b,
           CASE sl.geo_statut WHEN 'hors_boutique' THEN 1 WHEN 'imprecise' THEN 2 WHEN 'en_boutique' THEN 3
                WHEN 'refusee' THEN 4 WHEN 'indisponible' THEN 5 WHEN 'hors_horaires' THEN 6 END AS rang
    FROM sl
    CROSS JOIN LATERAL generate_series(date_trunc('day', sl.d), date_trunc('day', sl.f), INTERVAL '1 day') AS g(jour)
    WHERE g.jour >= %(deb_local)s AND g.jour < %(fin_local)s
      AND (g.jour = date_trunc('day', sl.d) OR sl.f > g.jour)
),
precedents AS (
    SELECT m.*, MAX(m.b) OVER (PARTITION BY m.utilisateur, m.jour ORDER BY m.a, m.b, m.id
                               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS fin_avant
    FROM morceaux m
),
ilots AS (
    SELECT p.utilisateur, p.jour, p.a, p.b,
           SUM(CASE WHEN p.fin_avant IS NOT NULL AND p.a <= p.fin_avant THEN 0 ELSE 1 END)
               OVER (PARTITION BY p.utilisateur, p.jour ORDER BY p.a, p.b, p.id) AS ilot
    FROM precedents p
),
durees AS (
    SELECT utilisateur, jour, SUM(EXTRACT(EPOCH FROM (fin_ilot - debut_ilot))) AS secondes
    FROM (SELECT utilisateur, jour, ilot, MIN(a) AS debut_ilot, MAX(b) AS fin_ilot
          FROM ilots GROUP BY utilisateur, jour, ilot) x
    GROUP BY utilisateur, jour
),
jours AS (
    SELECT utilisateur, jour, MIN(a) AS arrivee_u, MAX(b) AS depart_u, COUNT(DISTINCT id) AS sessions,
           SUM(CASE WHEN premier THEN actions ELSE 0 END) AS actions,
           BOOL_OR(en_cours) AS en_cours,
           ARRAY_AGG(DISTINCT appareil_type || '|' || COALESCE(appareil_marque, '')) AS appareils,
           (ARRAY_AGG(geo_statut ORDER BY rang, geo_distance_m DESC NULLS LAST)
               FILTER (WHERE geo_statut IS NOT NULL))[1] AS presence,
           (ARRAY_AGG(geo_distance_m ORDER BY rang, geo_distance_m DESC NULLS LAST)
               FILTER (WHERE geo_statut IS NOT NULL))[1] AS distance
    FROM morceaux
    GROUP BY utilisateur, jour
),
tickets_jour AS (
    SELECT cree_par AS utilisateur,
           ((date_depot AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris')::date AS jour,
           COUNT(*) AS n
    FROM tickets
    WHERE date_depot >= %(deb_utc)s AND date_depot < %(fin_utc)s AND COALESCE(cree_par, '') <> ''
    GROUP BY 1, 2
)
SELECT j.utilisateur, j.jour, j.sessions, j.actions, j.en_cours, j.appareils, j.presence, j.distance,
       (j.arrivee_u AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris' AS arrivee,
       (j.depart_u AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris' AS depart,
       d.secondes, COALESCE(t.n, 0) AS tickets_crees
FROM jours j
JOIN durees d USING (utilisateur, jour)
LEFT JOIN tickets_jour t USING (utilisateur, jour)
ORDER BY j.utilisateur, j.jour
"""


def _semaine(semaine: Optional[str]):
    jour = _jour(semaine, "semaine") or presence.aujourdhui_paris()
    deb = presence.lundi(jour)
    return deb, deb + timedelta(days=7)


def _connectes(cur, en_ligne: datetime, couleurs: dict) -> list:
    cur.execute("""SELECT * FROM connexions_equipe
                   WHERE fin IS NULL AND derniere_activite >= %s
                   ORDER BY utilisateur, debut""", (en_ligne,))
    return [{
        "id": r["id"],
        "utilisateur": r["utilisateur"],
        "couleur": couleurs.get(r["utilisateur"]),
        "cible": r["cible"],
        "poste": r["poste"],
        "appareil": presence.appareil_ligne(r),
        "debut": _iso_utc(r["debut"]),
        "depuis": _hm(r["debut"]),
        "derniere_activite": _iso_utc(r["derniere_activite"]),
        "actions": r["actions"] or 0,
        "geo_statut": r["geo_statut"],
        "geo_distance_m": r["geo_distance_m"],
        "geo_precision_m": r.get("geo_precision_m"),
        "geo_lat": r.get("geo_lat"),
        "geo_lng": r.get("geo_lng"),
        "geo_lieu": r.get("geo_lieu"),
    } for r in cur.fetchall() or []]


def _appareils(liste) -> list:
    out = []
    for v in sorted(set(liste or [])):
        t, _, m = (v or "").partition("|")
        out.append({"type": t or "inconnu", "marque": m or None})
    return out


@router.get("/activite")
def activite(request: Request, semaine: Optional[str] = None, user: dict = Depends(admin_equipe)):
    """Semaine de l'équipe en une requête agrégée (plus les membres et les connectés)."""
    deb, fin = _semaine(semaine)
    deb_utc, fin_utc = _bornes(deb, fin)
    presence.vider_activite()
    maintenant = presence.maintenant_utc()
    en_ligne = maintenant - timedelta(minutes=presence.EN_LIGNE_MINUTES)
    with get_cursor() as cur:
        tous = presence.lire_membres(cur)
        couleurs = {}
        for m in tous:
            couleurs.setdefault(m["nom"], m["couleur"])
        etat = _etat(cur, membres=tous)
        # Salariés actifs (robot « Système » exclu) ; un autre nom n'apparaît que s'il a des sessions
        membres = [x["utilisateur"] for x in etat["remises"]]
        cur.execute(_SQL_SEMAINE, {
            "deb_utc": deb_utc, "fin_utc": fin_utc, "en_ligne": en_ligne,
            "deb_local": datetime.combine(deb, datetime.min.time()),
            "fin_local": datetime.combine(fin, datetime.min.time()),
        })
        lignes = cur.fetchall() or []
        connectes = _connectes(cur, en_ligne, couleurs)
    par_salarie: dict = {}
    for r in lignes:
        jour = r["jour"]
        par_salarie.setdefault(r["utilisateur"], {})[jour.isoformat()] = {
            "arrivee": _hm_local(r["arrivee"], jour),
            "depart": _hm_local(r["depart"], jour),
            "duree_min": int(round(float(r["secondes"] or 0) / 60)),
            "sessions": int(r["sessions"] or 0),
            "actions": int(r["actions"] or 0),
            "tickets_crees": int(r["tickets_crees"] or 0),
            "appareils": _appareils(r["appareils"]),
            "presence": r["presence"],
            "distance_m": r["distance"],
            "en_cours": bool(r["en_cours"]),
        }
    noms = membres + sorted(n for n in par_salarie if n not in membres)
    salaries = []
    for nom in noms:
        jours = par_salarie.get(nom, {})
        salaries.append({
            "utilisateur": nom,
            "couleur": couleurs.get(nom),
            "membre": nom in membres,
            "jours": jours,
            "total": {
                "duree_min": sum(j["duree_min"] for j in jours.values()),
                "jours": len(jours),
                "actions": sum(j["actions"] for j in jours.values()),
                "tickets_crees": sum(j["tickets_crees"] for j in jours.values()),
            },
        })
    _tracer(request, user, "equipe_activite_consultee", f"semaine={deb.isoformat()}", regrouper=True)
    return {
        "semaine": {
            "debut": deb.isoformat(),
            "fin": (fin - timedelta(days=1)).isoformat(),
            "jours": [(deb + timedelta(days=i)).isoformat() for i in range(7)],
            "aujourdhui": presence.aujourdhui_paris(maintenant).isoformat(),
        },
        # Note remise (version en vigueur) à tous les salariés actifs ; sinon, à qui la remettre
        "information_remise": bool(etat["remises"]) and not etat["sans_note"],
        "membres_sans_note": etat["sans_note"],
        "pointage_actif": etat["pointage_actif"],
        # Pourquoi aucune position n'est relevée (affiché en haut de la page) : note, boutique, interrupteur
        "pointage_raison": None if etat["pointage_actif"] else (
            etat["blocage"] or "L'interrupteur « Pointage de présence » est désactivé dans les réglages."),
        "connectes": connectes,
        "salaries": salaries,
    }


def _session_api(r: dict, jour: Optional[date] = None, en_ligne: Optional[datetime] = None) -> dict:
    fin_eff = max(x for x in (r["fin"], r["derniere_activite"], r["debut"]) if x is not None)
    debut_p = presence.vers_paris(r["debut"])
    out = {
        "id": r["id"],
        "debut": debut_p.strftime("%H:%M"),
        "debut_jour": debut_p.date().isoformat(),
        "fin": _hm(r["fin"]),
        "derniere_activite": _hm(r["derniere_activite"]),
        "fin_motif": r["fin_motif"],
        "duree_min": int(round((fin_eff - r["debut"]).total_seconds() / 60)),
        "cible": r["cible"],
        "poste": r["poste"],
        "appareil": presence.appareil_ligne(r),
        "actions": r["actions"] or 0,
        "geo_statut": r["geo_statut"],
        "geo_distance_m": r["geo_distance_m"],
        "geo_precision_m": r["geo_precision_m"],
        "geo_lat": r.get("geo_lat"),
        "geo_lng": r.get("geo_lng"),
        "geo_lieu": r.get("geo_lieu"),
        "en_cours": bool(r["fin"] is None and en_ligne is not None and r["derniere_activite"] >= en_ligne),
    }
    return out


@router.get("/sessions")
def sessions_du_jour(request: Request, utilisateur: Optional[str] = None, jour: Optional[str] = None,
                     user: dict = Depends(admin_equipe)):
    """Sessions d'un salarié qui touchent ce jour (heure de Paris), dans l'ordre."""
    nom = (utilisateur or "").strip()
    if not nom:
        raise HTTPException(400, "utilisateur requis")
    j = _jour(jour, "jour") or presence.aujourdhui_paris()
    deb_utc, fin_utc = _bornes(j, j + timedelta(days=1))
    presence.vider_activite()
    en_ligne = presence.maintenant_utc() - timedelta(minutes=presence.EN_LIGNE_MINUTES)
    with get_cursor() as cur:
        cur.execute("""
            SELECT * FROM connexions_equipe
            WHERE utilisateur = %s AND debut < %s AND debut >= %s - INTERVAL '7 days'
              AND GREATEST(COALESCE(fin, derniere_activite), derniere_activite, debut) >= %s
            ORDER BY debut, id
        """, (nom, fin_utc, deb_utc, deb_utc))
        rows = cur.fetchall() or []
    _tracer(request, user, "equipe_sessions_consultees", f"utilisateur={nom[:80]} jour={j.isoformat()}",
            regrouper=True)
    return [_session_api(r, j, en_ligne) for r in rows]


# ─── Admin : réglages ────────────────────────────────────────────

def _note(reglages: dict) -> dict:
    """Note d'information écrite à remettre à chaque salarié (art. 13 RGPD, L1222-4 Code du travail).
    Son texte fixe la version (presence.version_note) : le modifier (rayon, identité de la
    boutique…) redemande la remise avant tout nouveau pointage."""
    ident = mentions.lire()
    nom = ident.get("BOUTIQUE_NOM") or "La boutique"
    forme = ident.get("BOUTIQUE_FORME") or ""
    adresse = ident.get("BOUTIQUE_ADRESSE") or ""
    contact = " · ".join(x for x in (ident.get("BOUTIQUE_TEL"), ident.get("BOUTIQUE_EMAIL")) if x)
    sections = [
        {"titre": "Responsable du traitement",
         "texte": f"{nom}{f' ({forme})' if forme else ''}{f', {adresse}' if adresse else ''}, "
                  f"représentée par son gérant{f'. Contact : {contact}' if contact else ''}."},
        {"titre": "Pourquoi ces données sont enregistrées",
         "texte": "L'application de gestion du service après-vente enregistre les connexions de l'équipe "
                  "pour trois finalités :",
         "liste": [
             "la sécurité des accès : savoir qui s'est connecté, quand et depuis quel appareil ;",
             "le suivi indicatif des jours et heures de connexion à l'application (arrivée, départ, "
             "durée) et du volume d'enregistrements effectués (actions, fiches créées) ;",
             "la vérification ponctuelle, à chaque connexion, de la présence en boutique ou du lieu "
             "approximatif de connexion, si le gérant l'active.",
         ]},
        {"titre": "Portée de ces relevés",
         "texte": "Ces relevés sont indicatifs : ils ne constituent pas le décompte légal du temps de travail "
                  "et ne fondent à eux seuls aucune sanction. Aucun suivi en continu n'est réalisé et "
                  "aucune décision n'est prise automatiquement."},
        {"titre": "Données enregistrées",
         "liste": [
             "Votre nom, l'espace utilisé (accueil ou atelier) et le nom du poste (ex. « Comptoir »).",
             "L'heure de connexion, de dernière activité et de déconnexion, le motif de fin de session, le "
             "nombre d'enregistrements effectués (créations, modifications) et de fiches créées.",
             "Les totaux calculés à partir de ces relevés : durée de connexion par jour et par semaine, "
             "nombre de jours de connexion, d'actions et de fiches créées.",
             "Le type d'appareil (ordinateur, iPhone, iPad, smartphone, tablette), sa marque et son modèle "
             "lorsque le navigateur les indique, le système et le navigateur utilisés.",
             "Une empreinte non réversible de l'adresse réseau (jamais l'adresse elle-même).",
             "Si la vérification de présence est activée : son résultat (en boutique, hors boutique, "
             "position imprécise, refusée, indisponible), la distance à la boutique arrondie à 50 m, la "
             "précision annoncée par l'appareil et, lorsque vous n'êtes pas en boutique ou que la position "
             "est imprécise, votre position approximative (à environ 100 m près) et le lieu correspondant "
             "(nom de la rue et de la commune), que le gérant peut afficher sur une carte. En boutique, "
             "seule la mention « en boutique » est gardée.",
         ]},
        {"titre": "Fonctionnement de la vérification de présence",
         "liste": [
             "Elle ne concerne que les salariés à qui cette note a été remise.",
             "Une seule vérification par session, à chaque connexion à l'application ou changement "
             "d'utilisateur, quels que soient le lieu et l'heure de la connexion. Aucun suivi en continu : "
             "rien entre deux connexions ni en dehors de l'application.",
             "Votre position est transmise une seule fois au serveur pour calculer la distance à la "
             "boutique : seuls le résultat, la distance arrondie, la précision et, hors de la boutique, la "
             "position approximative (à environ 100 m près) sont gardés. Le nom de la rue et de la commune "
             "est obtenu à partir de cette position arrondie auprès de la Base Adresse Nationale, service "
             "public de l'État.",
             "Votre navigateur vous demande l'autorisation : vous pouvez refuser, par exemple un jour de "
             "repos ou hors de la boutique. L'application fonctionne normalement, seul le refus est noté, "
             "et un refus n'entraîne aucune conséquence.",
             f"La présence est retenue dans un rayon de {reglages['rayon_m']} m autour de la boutique. Si la "
             f"position donnée par l'appareil est trop imprécise pour conclure, le résultat est « position "
             f"imprécise », jamais « hors boutique ».",
         ]},
        {"titre": "Base légale",
         "texte": "Intérêt légitime de l'employeur (article 6.1.f du RGPD) : sécuriser l'accès aux données des "
                  "clients, organiser le travail et la présence en boutique. Le dispositif est justifié par la "
                  "nature de la tâche et proportionné au but recherché (article L1121-1 du Code du travail) ; "
                  "vous en êtes informé(e) par écrit avant sa mise en place (article L1222-4)."},
        {"titre": "Qui peut consulter ces données",
         "texte": "Le gérant et les personnes qu'il habilite en leur confiant le code administrateur, depuis "
                  "l'espace administrateur ; chaque consultation et chaque export sont tracés. Les données ne "
                  "sont ni vendues ni communiquées à des tiers. Seuls les prestataires techniques qui "
                  "hébergent l'application y ont accès, pour son fonctionnement : Railway (hébergement de "
                  "l'application) et Supabase (hébergement de la base de données), sociétés établies hors de "
                  "l'Union européenne. Lorsque des données sont traitées hors de l'Union européenne, le "
                  "transfert repose sur les garanties prévues par le RGPD (décision d'adéquation ou clauses "
                  "contractuelles types). Pour retrouver la rue et la commune, seule la position arrondie (sans "
                  "votre nom ni aucune autre donnée) est transmise à la Base Adresse Nationale (service public "
                  "de l'État, en France)."},
        {"titre": "Durées de conservation",
         "liste": [
             f"Résultat de la vérification de présence, position et lieu approximatifs : "
             f"{presence.CONSERVATION_POSITION_JOURS} jours (2 mois), puis effacés.",
             f"Journal des connexions : {presence.CONSERVATION_JOURNAL_JOURS} jours (6 mois), puis supprimé.",
             f"Traces des consultations et des exports par l'administrateur : "
             f"{presence.CONSERVATION_TRACES_JOURS} jours (12 mois).",
             "Date de remise de cette note : conservée comme preuve de votre information.",
         ]},
        {"titre": "Vos droits",
         "texte": "Vous pouvez obtenir sur simple demande au gérant une copie de toutes les données vous "
                  "concernant, et exercer auprès de lui vos droits de rectification, d'effacement, de "
                  "limitation et d'opposition (articles 15 à 21 du RGPD). Vous pouvez aussi introduire une "
                  "réclamation auprès de la CNIL (www.cnil.fr)."},
        {"titre": "Représentants du personnel",
         "texte": "Lorsque l'entreprise est dotée d'un comité social et économique (CSE, obligatoire à partir "
                  "de 11 salariés), celui-ci est informé et, dans les cas prévus par le Code du travail "
                  "(article L2312-38 pour les entreprises d'au moins 50 salariés), consulté avant toute mise "
                  "en œuvre ou modification de ce dispositif."},
    ]
    return {
        "titre": "Note d'information des salariés — Journal des connexions et vérification de présence",
        "sections": sections,
        "remise": "Note remise en main propre le ____ / ____ / ________ à : ______________________________"
                  "\nSignature du salarié :",
    }


def _texte_note(note: dict) -> str:
    lignes = [note["titre"], ""]
    for s in note["sections"]:
        lignes.append(s["titre"])
        if s.get("texte"):
            lignes.append(s["texte"])
        for item in s.get("liste") or []:
            lignes.append(f"- {item}")
        lignes.append("")
    lignes.append(note["remise"])
    return "\n".join(lignes).strip()


def _reglages_api(etat: dict) -> dict:
    reglages = etat["reglages"]
    derniere = etat["derniere"]
    return {
        "pointage_actif": etat["pointage_actif"],
        # Choix de l'admin ; vrai avec pointage_actif faux : suspendu (voir pointage_blocage)
        "pointage_interrupteur": bool(reglages["interrupteur"]),
        # Pourquoi le pointage ne peut pas tourner maintenant (null : il peut être activé)
        "pointage_blocage": etat["blocage"],
        "rayon_m": reglages["rayon_m"],
        "boutique_lat": reglages["boutique_lat"],
        "boutique_lng": reglages["boutique_lng"],
        "boutique_position_confirmee": reglages["boutique_position_confirmee"],
        "boutique_position_par_defaut": reglages.get("boutique_position_par_defaut", False),
        # Dernière remise de la version en vigueur (null : remise à personne)
        "information_remise_le": derniere["remise_le"] if derniere else None,
        "information_remise_par": derniere["remise_par"] if derniere else None,
        "information_remise": bool(etat["remises"]) and not etat["sans_note"],
        "note_version": etat["version"],
        "remises": etat["remises"],
        "membres_sans_note": etat["sans_note"],
        "texte_note": etat["texte"],
        "note": etat["note"],
        "horaires": {"debut_h": presence.HORAIRE_DEBUT_H, "fin_h": presence.HORAIRE_FIN_H,
                     "jours": "du lundi au samedi"},
        "rayon": {"min": presence.RAYON_MIN_M, "max": presence.RAYON_MAX_M},
        "conservation": {"position_jours": presence.CONSERVATION_POSITION_JOURS,
                         "journal_jours": presence.CONSERVATION_JOURNAL_JOURS,
                         "traces_jours": presence.CONSERVATION_TRACES_JOURS},
    }


def _reglages_courants() -> dict:
    with get_cursor() as cur:
        return _reglages_api(_etat(cur))


def _ecrire_params(cur, valeurs: dict):
    for cle, valeur in valeurs.items():
        cur.execute("""INSERT INTO params (cle, valeur) VALUES (%s, %s)
                       ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur""", (cle, valeur))


@router.get("/reglages")
def get_reglages(user: dict = Depends(admin_equipe)):
    return _reglages_courants()


class ReglagesEquipe(BaseModel):
    pointage_actif: Optional[bool] = None
    rayon_m: Optional[int] = Field(None, ge=presence.RAYON_MIN_M, le=presence.RAYON_MAX_M)


@router.put("/reglages")
def put_reglages(data: ReglagesEquipe, request: Request, user: dict = Depends(admin_equipe)):
    """Rayon, puis activation du pointage : refusée (409) tant que la note (version en vigueur,
    rayon compris) n'est remise à personne ou que la position de la boutique n'est pas confirmée."""
    with get_cursor() as cur:
        avant = presence.lire_reglages(cur)
        apres = dict(avant)
        ecritures, traces = {}, []
        if data.rayon_m is not None and data.rayon_m != avant["rayon_m"]:
            apres["rayon_m"] = int(data.rayon_m)
            ecritures[presence.PARAM_RAYON] = str(int(data.rayon_m))
            traces.append(("equipe_rayon_modifie", f"rayon_m={int(data.rayon_m)}"))
        if data.pointage_actif is not None:
            if data.pointage_actif:
                blocage = _etat(cur, apres)["blocage"]
                if blocage:
                    raise HTTPException(409, blocage)
            if data.pointage_actif != avant["interrupteur"]:
                ecritures[presence.PARAM_ACTIF] = "1" if data.pointage_actif else "0"
                traces.append(("equipe_pointage_active" if data.pointage_actif else "equipe_pointage_desactive", ""))
        if ecritures:
            _ecrire_params(cur, ecritures)
            for action, details in traces:
                presence.journaliser(cur, request, user, action, details)
    params_cache.invalidate()
    return _reglages_courants()


class RemiseNote(BaseModel):
    """Sans corps (ou {}) : la note en vigueur est remise à tous les salariés actifs.
    `membres` : remise confirmée pour ces salariés ; `retirer` : confirmation retirée."""
    membres: Optional[List[str]] = Field(None, max_length=100)
    retirer: Optional[List[str]] = Field(None, max_length=100)


def _noms(liste) -> list:
    out = []
    for n in liste or []:
        v = " ".join(str(n or "").split())[:80]
        if v and v not in out:
            out.append(v)
    return out


@router.post("/deconnecter-tout")
def deconnecter_tout(request: Request, user: dict = Depends(admin_equipe)):
    """Déconnecte tous les postes, celui de l'admin compris : chacun devra ressaisir son PIN
    (sessions du journal closes « Déconnexion générale »)."""
    with get_cursor() as cur:
        presence.journaliser(cur, request, user, "equipe_deconnexion_generale", "")
    deconnecter_tout_le_monde()
    return {"ok": True}


@router.post("/reglages/information-remise")
def information_remise(request: Request, data: Optional[RemiseNote] = Body(None),
                       user: dict = Depends(admin_equipe)):
    """Le gérant confirme avoir remis la note d'information écrite (version en vigueur) à chaque
    salarié : date, admin et version enregistrés par membre."""
    with get_cursor() as cur:
        etat = _etat(cur)
        actifs = [x["utilisateur"] for x in etat["remises"]]
        if data is None or (data.membres is None and data.retirer is None):
            poser, retirer = list(actifs), []
            if not poser:
                raise HTTPException(400, "Aucun salarié actif dans l'équipe")
        else:
            poser, retirer = _noms(data.membres), _noms(data.retirer)
            inconnus = [n for n in poser if n not in actifs]
            if inconnus:
                raise HTTPException(400, "Salarié inconnu ou inactif : " + ", ".join(inconnus[:5]))
            if set(poser) & set(retirer):
                raise HTTPException(400, "Un même salarié ne peut pas être à la fois ajouté et retiré")
        par = str(user.get("sub") or "")[:80]
        presence.poser_remises(cur, poser, etat["version"], par)
        presence.retirer_remises(cur, retirer)
        if poser:
            presence.journaliser(cur, request, user, "equipe_note_remise",
                                 f"version={etat['version']} membres={','.join(poser)}")
        if retirer:
            presence.journaliser(cur, request, user, "equipe_note_remise_retiree",
                                 f"membres={','.join(retirer)}")
    return _reglages_courants()


def _position_boutique(corps, request: Request, user: dict) -> dict:
    if not isinstance(corps, dict) or not presence.coordonnees_valides(corps.get("lat"), corps.get("lng")):
        raise HTTPException(422, "Position de la boutique invalide (lat, lng)")
    precision = presence.precision_valide(corps.get("precision_m"))
    if corps.get("precision_m") is not None and precision is None:
        raise HTTPException(422, "Précision invalide")
    if precision is not None and precision > presence.PRECISION_BOUTIQUE_MAX_M:
        raise HTTPException(409, f"Position trop imprécise (± {precision} m) : enregistrez-la depuis un "
                                 f"téléphone ou une tablette dans la boutique.")
    lat, lng = round(float(corps["lat"]), 6), round(float(corps["lng"]), 6)
    with get_cursor() as cur:
        _ecrire_params(cur, {presence.PARAM_LAT: f"{lat:.6f}", presence.PARAM_LNG: f"{lng:.6f}"})
        presence.journaliser(cur, request, user, "equipe_position_boutique",
                             f"precision_m={precision}" if precision is not None else "")
    params_cache.invalidate()
    return _reglages_courants()


@router.post("/reglages/position-boutique")
async def position_boutique(request: Request, user: dict = Depends(admin_equipe)):
    """Coordonnées de la BOUTIQUE (lues sur le poste de la boutique) : elles peuvent être gardées."""
    try:
        corps = await request.json()
    except Exception:
        corps = None
    return await run_in_threadpool(_position_boutique, corps, request, user)


# ─── Admin : export CSV (sert aussi à répondre à une demande d'accès) ─

_MOTIFS = {"deconnexion": "Déconnexion", "changement": "Changement d'utilisateur", "expiree": "Expirée",
           "forcee": "Déconnexion générale"}
_PRESENCES = {"en_boutique": "En boutique", "hors_boutique": "Hors boutique", "imprecise": "Position imprécise",
              "refusee": "Refusée", "indisponible": "Indisponible", "hors_horaires": "Hors horaires"}


def _cellule(v):
    if v is None:
        return ""
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + v
    return v


@router.get("/export.csv")
def export_csv(request: Request, utilisateur: Optional[str] = None, depuis: Optional[str] = None,
               jusqua: Optional[str] = None, user: dict = Depends(admin_equipe)):
    aujourd_hui = presence.aujourdhui_paris()
    fin = _jour(jusqua, "jusqua") or aujourd_hui
    deb = _jour(depuis, "depuis") or (aujourd_hui - timedelta(days=presence.CONSERVATION_JOURNAL_JOURS))
    if deb > fin:
        raise HTTPException(400, "depuis doit précéder jusqua")
    if (fin - deb).days > EXPORT_MAX_JOURS:
        raise HTTPException(400, f"Période limitée à {EXPORT_MAX_JOURS} jours")
    nom = (utilisateur or "").strip() or None
    deb_utc, fin_utc = _bornes(deb, fin + timedelta(days=1))
    presence.vider_activite()
    with get_cursor() as cur:
        cur.execute("""
            SELECT * FROM connexions_equipe
            WHERE debut >= %s AND debut < %s AND (%s::text IS NULL OR utilisateur = %s)
            ORDER BY debut, id
        """, (deb_utc, fin_utc, nom, nom))
        rows = cur.fetchall() or []
    sortie = io.StringIO()
    w = csv.writer(sortie, delimiter=";", lineterminator="\r\n")
    w.writerow(["Salarié", "Espace", "Poste", "Date", "Connexion", "Dernière activité", "Fin", "Durée (min)",
                "Motif de fin", "Type d'appareil", "Marque", "Modèle", "Système", "Navigateur", "Actions",
                "Présence", "Distance boutique (m)", "Précision (m)", "Lieu approximatif",
                "Position approximative", "Empreinte réseau"])
    for r in rows:
        s = _session_api(r)
        a = s["appareil"]
        w.writerow([_cellule(x) for x in (
            r["utilisateur"], r["cible"], r["poste"], s["debut_jour"], s["debut"], s["derniere_activite"],
            s["fin"] or "En cours", s["duree_min"], _MOTIFS.get(r["fin_motif"] or "", ""), a["type"],
            a["marque"], a["modele"], a["systeme"], a["navigateur"], s["actions"],
            _PRESENCES.get(r["geo_statut"] or "", ""), r["geo_distance_m"], r["geo_precision_m"],
            r.get("geo_lieu") or "",
            f"{r['geo_lat']:.3f}, {r['geo_lng']:.3f}" if r.get("geo_lat") is not None and r.get("geo_lng") is not None else "",
            r["ip_empreinte"],
        )])
    filtre = f"utilisateur={nom or '*'} depuis={deb.isoformat()} jusqua={fin.isoformat()}"
    _tracer(request, user, "equipe_export", filtre)
    slug = re.sub(r"[^A-Za-z0-9]+", "-", nom or "equipe").strip("-").lower() or "salarie"
    nom_fichier = f"connexions-{slug}-{deb.isoformat()}-{fin.isoformat()}.csv"
    return Response(content="﻿" + sortie.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{nom_fichier}"',
                             "Cache-Control": "no-store"})
