"""Tombola des clients : inscription, tirage au sort daté, remplaçant (services/tombola).

Règles posées par le gérant le 11/11/2026 (« dans les règles malikites ») — ce que le code garantit :

- **Aucune mise** : il n'existe ni prix, ni ticket, ni montant d'achat dans le modèle. Participer ne
  coûte rien et ne dépend d'aucun achat (le personnel peut inscrire au comptoir quelqu'un qui ne
  dépose rien). Sans mise, personne ne peut perdre : ce n'est pas un jeu d'argent (maysir / qimâr),
  c'est un don de la boutique (hiba) attribué par tirage au sort (qur'a).
- **Une chance par personne**, la même pour tous : une participation par numéro de téléphone
  (index unique), jamais plus de chances pour qui dépense plus.
- **Lots offerts par la boutique**, connus d'avance (un lot par ligne, le premier tiré reçoit le premier).
- **Tirage loyal** : aléa du système (`secrets.SystemRandom`), à la date annoncée, parmi tous les
  inscrits ; nombre de participants, date et auteur du tirage gardés.
- **Le lot est remis** : un gagnant injoignable est remplacé par un nouveau tirage parmi les autres.

Côté loi française : loterie publicitaire gratuite et sans obligation d'achat (C. consom. L121-20),
case jamais pré-cochée, données utilisées pour le seul tirage, participations non gagnantes effacées
`PURGE_JOURS` jours après le tirage.
"""

import logging
import os
import secrets
import threading
import time
from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from app.database import get_cursor
from app.services import search as search_engine

logger = logging.getLogger("klikphone.tombola")

PARIS = ZoneInfo("Europe/Paris")
AUTEUR_AUTO = "Tirage automatique"
LOTS_MAX = 10
LOT_LONGUEUR_MAX = 120
PURGE_JOURS = 90          # participations non gagnantes effacées après le tirage
DELAI_GAGNANT_JOURS = 15  # annoncé au règlement : sans réponse, un remplaçant est tiré

_MOIS = ("janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre",
         "octobre", "novembre", "décembre")
_JOURS = ("lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche")


class Refus(Exception):
    """Demande impossible dans l'état de la tombola (l'API en fait un 4xx)."""

    def __init__(self, code: str, message: str, statut: int = 409):
        super().__init__(message)
        self.code, self.message, self.statut = code, message, statut


# ─── Lots, dates, règlement ──────────────────────────────────────
def lots_liste(texte) -> list:
    """Un lot par ligne, dans l'ordre du tirage ; lignes vides ignorées."""
    if isinstance(texte, (list, tuple)):
        lignes = [str(x or "") for x in texte]
    else:
        lignes = str(texte or "").splitlines()
    return [" ".join(ligne.split()) for ligne in lignes if ligne.strip()]


def lots_texte(lots) -> str:
    return "\n".join(lots_liste(lots))


def date_paris(valeur) -> datetime:
    """« 2026-12-20T18:00 » saisi au comptoir = heure de Paris ; une date déjà située est gardée."""
    if isinstance(valeur, datetime):
        d = valeur
    else:
        d = datetime.fromisoformat(str(valeur or "").strip().replace("Z", "+00:00"))
    return d.replace(tzinfo=PARIS) if d.tzinfo is None else d


def date_lisible(d: Optional[datetime]) -> str:
    """« samedi 20 décembre 2026 à 18 h » (heure de Paris), « 18 h 30 » avec des minutes."""
    if not d:
        return ""
    p = (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).astimezone(PARIS)
    heure = f"{p.hour} h" + (f" {p.minute:02d}" if p.minute else "")
    jour = "1er" if p.day == 1 else str(p.day)
    return f"{_JOURS[p.weekday()]} {jour} {_MOIS[p.month - 1]} {p.year} à {heure}"


def reglement_defaut(t: dict, boutique: Optional[dict] = None) -> str:
    """Règlement proposé tant que le gérant n'a pas écrit le sien."""
    b = boutique or {}
    nom = (b.get("nom") or "Klikphone").strip()
    adresse = (b.get("adresse") or "").strip()
    lots = lots_liste(t.get("lots"))
    if len(lots) > 1:
        detail = " ; ".join(f"{i}{'er' if i == 1 else 'e'} tiré : {lot}" for i, lot in enumerate(lots, 1))
    else:
        detail = lots[0] if lots else "le lot annoncé en boutique"
    quand = date_lisible(t.get("tirage_le"))
    return "\n\n".join([
        f"1. Organisateur. {nom}{', ' + adresse if adresse else ''}.",
        "2. Participation gratuite. Participer ne coûte rien et n'exige aucun achat : il n'y a ni ticket "
        "payant ni mise, et aucun prix n'est modifié à cause de la tombola.",
        "3. Qui peut participer. Toute personne majeure, une seule fois : un numéro de téléphone donne "
        "une participation, et chaque participant a la même chance. Le personnel de la boutique ne participe pas.",
        "4. Comment participer. En cochant la case « Je participe à la tombola » lors de son inscription "
        f"(en boutique ou en ligne), ou en le demandant au comptoir, jusqu'au {quand}.",
        f"5. {'Lots' if len(lots) > 1 else 'Lot'}. Offert{'s' if len(lots) > 1 else ''} par {nom} : {detail}. "
        "Un lot n'est ni échangé ni remboursé en argent.",
        f"6. Tirage au sort. Le {quand}, par le logiciel de la boutique, au hasard parmi tous les inscrits.",
        "7. Gagnants. Chaque gagnant est prévenu par téléphone ou par SMS au numéro donné et retire son lot en "
        f"boutique. Sans réponse sous {DELAI_GAGNANT_JOURS} jours, un nouveau tirage désigne un remplaçant.",
        "8. Données personnelles. Le nom et le numéro servent au tirage et à prévenir les gagnants, rien "
        f"d'autre. Les participations non gagnantes sont effacées {PURGE_JOURS} jours après le tirage. "
        "Chacun peut retirer sa participation avant le tirage, sur simple demande en boutique.",
    ])


def _boutique() -> dict:
    """Nom et adresse de la boutique pour le règlement ; jamais bloquant."""
    try:
        from app.services import mentions
        m = mentions.lire() or {}
        return {"nom": m.get("BOUTIQUE_NOM") or m.get("NOM_BOUTIQUE") or "",
                "adresse": m.get("BOUTIQUE_ADRESSE") or m.get("ADRESSE_BOUTIQUE") or ""}
    except Exception:
        return {}


def reglement_effectif(t: dict) -> str:
    perso = str(t.get("reglement") or "").strip()
    return perso or reglement_defaut(t, _boutique())


def _iso(d) -> Optional[str]:
    return d.isoformat() if isinstance(d, datetime) else (d or None)


def publique(t: dict) -> dict:
    """Ce que voient la borne, le dépôt en ligne et l'affiche : rien sur les participants."""
    return {"id": t["id"], "titre": t.get("titre") or "", "lots": lots_liste(t.get("lots")),
            "tirage_le": _iso(t.get("tirage_le")), "reglement": reglement_effectif(t)}


# ─── Tombola ouverte ─────────────────────────────────────────────
def en_cours(cur) -> Optional[dict]:
    """La tombola qui accepte des inscriptions : ouverte et pas encore à l'heure du tirage."""
    cur.execute("""SELECT * FROM tombolas
                   WHERE statut = 'ouverte' AND tirage_le > NOW()
                   ORDER BY id DESC LIMIT 1""")
    return cur.fetchone() or None


# Lecture publique (borne, formulaires, affiche) : gardée quelques secondes par processus
_CACHE_S = 20.0
_cache = {"at": 0.0, "valeur": None, "vu": False}


def oublier_cache():
    _cache.update(at=0.0, valeur=None, vu=False)


def en_cours_publique(maintenant: Optional[float] = None) -> Optional[dict]:
    t = time.monotonic() if maintenant is None else maintenant
    if _cache["vu"] and t - _cache["at"] < _CACHE_S:
        return _cache["valeur"]
    with get_cursor() as cur:
        row = en_cours(cur)
    valeur = publique(row) if row else None
    _cache.update(at=t, valeur=valeur, vu=True)
    return valeur


# ─── Inscription ─────────────────────────────────────────────────
def cle_personne(telephone) -> Optional[str]:
    """Une participation par numéro, quel que soit son format (06 12…, 0612…, +33 6…)."""
    cle = search_engine.phone_key(telephone)
    if cle:
        return cle
    chiffres = "".join(ch for ch in str(telephone or "") if ch.isdigit())
    return chiffres or None


def inscrire(cur, client_id: int, telephone, source: str, auteur: Optional[str] = None,
             tombola: Optional[dict] = None) -> Optional[dict]:
    """Inscrit ce client à la tombola ouverte. None s'il n'y en a pas (ou pas de numéro) ;
    sinon {tombola_id, nouvelle} — `nouvelle` faux : ce numéro participait déjà."""
    t = tombola or en_cours(cur)
    cle = cle_personne(telephone)
    if not t or not cle or not client_id:
        return None
    cur.execute("""
        INSERT INTO tombola_participations (tombola_id, client_id, cle_personne, source, inscrit_par)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (tombola_id, cle_personne) DO NOTHING
        RETURNING id
    """, (t["id"], client_id, cle, source, auteur))
    row = cur.fetchone()
    return {"tombola_id": t["id"], "nouvelle": bool(row), "id": (row or {}).get("id")}


def inscrire_sans_bloquer(cur, client_id: int, telephone, source: str,
                          auteur: Optional[str] = None) -> bool:
    """Inscription depuis un dépôt (borne, comptoir, en ligne) : un échec de la tombola n'empêche
    jamais d'enregistrer l'appareil. Vrai si le client participe (nouvelle inscription ou déjà inscrit)."""
    cur.execute("SAVEPOINT kp_tombola")
    try:
        r = inscrire(cur, client_id, telephone, source, auteur)
        cur.execute("RELEASE SAVEPOINT kp_tombola")
        return bool(r)
    except Exception as e:
        cur.execute("ROLLBACK TO SAVEPOINT kp_tombola")
        logger.warning("Tombola : inscription impossible (%s)", type(e).__name__)
        return False


# ─── Tirage ──────────────────────────────────────────────────────
# Peut gagner : jamais tiré, fiche non anonymisée et toujours joignable
_SQL_CANDIDATS = """
    SELECT p.id FROM tombola_participations p
    JOIN clients c ON c.id = p.client_id
    WHERE p.tombola_id = %s AND p.rang IS NULL
      AND c.anonymise_le IS NULL AND COALESCE(btrim(c.telephone), '') <> ''
    ORDER BY p.id
"""


def _journaliser(cur, action: str, tombola_id: int, auteur: str, details: str):
    """Trace admin (comptes seulement, aucun nom) ; un échec n'annule jamais le tirage."""
    cur.execute("SAVEPOINT kp_audit")
    try:
        cur.execute(
            """INSERT INTO admin_audit_log (user_login, user_target, action, target_type, target_id, details, ip_hash)
               VALUES (%s, '', %s, 'tombola', %s, %s, '')""",
            ((auteur or "auto")[:100], action, tombola_id, details[:500]),
        )
        cur.execute("RELEASE SAVEPOINT kp_audit")
    except Exception:
        cur.execute("ROLLBACK TO SAVEPOINT kp_audit")


def tirer(cur, tombola_id: int, auteur: str, rng=None) -> Optional[dict]:
    """Tire les gagnants (autant que de lots) parmi tous les inscrits, chacun avec la même chance.
    None si la tombola n'est plus ouverte (déjà tirée par un autre poste, annulée)."""
    cur.execute("SELECT * FROM tombolas WHERE id = %s FOR UPDATE", (tombola_id,))
    t = cur.fetchone()
    if not t or t.get("statut") != "ouverte":
        return None
    cur.execute(_SQL_CANDIDATS, (tombola_id,))
    candidats = [r["id"] for r in (cur.fetchall() or [])]
    nb_lots = max(1, len(lots_liste(t.get("lots"))))
    hasard = rng or secrets.SystemRandom()
    gagnants = hasard.sample(candidats, min(nb_lots, len(candidats)))
    for rang, pid in enumerate(gagnants, 1):
        cur.execute("UPDATE tombola_participations SET rang = %s, tire_le = NOW() WHERE id = %s", (rang, pid))
    cur.execute("""UPDATE tombolas SET statut = 'tiree', tiree_le = NOW(), tiree_par = %s,
                          participants_au_tirage = %s
                   WHERE id = %s""", (auteur, len(candidats), tombola_id))
    _journaliser(cur, "tombola_tirage", tombola_id, auteur,
                 f"{len(candidats)} participant(s), {len(gagnants)} gagnant(s) sur {nb_lots} lot(s)")
    return {"id": tombola_id, "titre": t.get("titre") or "", "participants": len(candidats),
            "gagnants": gagnants, "lots": nb_lots}


def remplacer(cur, participation_id: int, auteur: str, rng=None) -> dict:
    """Le gagnant ne s'est pas manifesté (ou renonce) : un autre inscrit, jamais tiré, reçoit son lot."""
    cur.execute("""
        SELECT p.id, p.tombola_id, p.rang, p.remplace_le, p.lot_remis_le, t.statut
        FROM tombola_participations p JOIN tombolas t ON t.id = p.tombola_id
        WHERE p.id = %s FOR UPDATE OF p, t
    """, (participation_id,))
    p = cur.fetchone()
    if not p:
        raise Refus("introuvable", "Participation introuvable.", 404)
    if p.get("statut") != "tiree" or not p.get("rang") or p.get("remplace_le"):
        raise Refus("pas_gagnant", "Cette personne n'est pas (ou plus) parmi les gagnants.")
    if p.get("lot_remis_le"):
        raise Refus("lot_remis", "Le lot a déjà été remis à ce gagnant.")
    cur.execute(_SQL_CANDIDATS, (p["tombola_id"],))
    candidats = [r["id"] for r in (cur.fetchall() or [])]
    if not candidats:
        raise Refus("plus_personne", "Tous les inscrits ont déjà été tirés : aucun remplaçant possible.")
    nouveau = (rng or secrets.SystemRandom()).choice(candidats)
    cur.execute("UPDATE tombola_participations SET remplace_le = NOW() WHERE id = %s", (participation_id,))
    cur.execute("UPDATE tombola_participations SET rang = %s, tire_le = NOW() WHERE id = %s",
                (p["rang"], nouveau))
    _journaliser(cur, "tombola_remplacant", p["tombola_id"], auteur,
                 f"lot {p['rang']} : nouveau tirage parmi {len(candidats)} participant(s)")
    return {"tombola_id": p["tombola_id"], "rang": p["rang"], "id": nouveau}


def _prevenir_equipe(resultat: dict):
    """Cloche et chat de l'équipe : le tirage a eu lieu, des gagnants sont à prévenir. Aucun nom."""
    try:
        from app.api.notifications_center import push_notification
        n = len(resultat["gagnants"])
        if n:
            message = (f"{resultat['titre']} : {n} gagnant{'s' if n > 1 else ''} à prévenir, tiré{'s' if n > 1 else ''} "
                       f"au sort parmi {resultat['participants']} participant{'s' if resultat['participants'] > 1 else ''}.")
        else:
            message = f"{resultat['titre']} : aucun participant, pas de gagnant."
        push_notification(type="tombola_tirage", title="Tombola : tirage effectué", message=message,
                          important=True, action_url="/accueil/tombola")
    except Exception as e:
        logger.warning("Tombola : équipe non prévenue (%s)", type(e).__name__)


def tirer_maintenant(tombola_id: int, auteur: str) -> Optional[dict]:
    with get_cursor() as cur:
        r = tirer(cur, tombola_id, auteur)
    if r:
        oublier_cache()
        _prevenir_equipe(r)
    return r


def tirages_dus() -> list:
    """Tombolas ouvertes dont la date est arrivée : tirées une seule fois, même à plusieurs workers."""
    faits = []
    with get_cursor() as cur:
        cur.execute("""SELECT id FROM tombolas WHERE statut = 'ouverte' AND tirage_le <= NOW()
                       ORDER BY id FOR UPDATE SKIP LOCKED""")
        for row in (cur.fetchall() or []):
            r = tirer(cur, row["id"], AUTEUR_AUTO)
            if r:
                faits.append(r)
    if faits:
        oublier_cache()
    for r in faits:
        logger.info("Tombola %s tirée : %s participant(s), %s gagnant(s)",
                    r["id"], r["participants"], len(r["gagnants"]))
        _prevenir_equipe(r)
    return faits


def purger_anciennes() -> int:
    """Participations non gagnantes effacées PURGE_JOURS jours après le tirage (le nombre de
    participants reste dans tombolas.participants_au_tirage)."""
    with get_cursor() as cur:
        cur.execute("""
            DELETE FROM tombola_participations p USING tombolas t
            WHERE t.id = p.tombola_id AND p.rang IS NULL
              AND t.statut = 'tiree' AND t.tiree_le < NOW() - make_interval(days => %s)
        """, (PURGE_JOURS,))
        return cur.rowcount or 0


# ─── Tâche de fond ───────────────────────────────────────────────
_tache = {"thread": None}


def _boucle(delai_initial: float, periode: float):
    time.sleep(delai_initial)
    passage = 0
    while True:
        try:
            tirages_dus()
            if passage % 60 == 0:   # une fois par heure
                purger_anciennes()
        except Exception as e:
            # Type seul : un message d'erreur SQL peut citer des valeurs
            logger.warning("Tombola : passage en échec (%s)", type(e).__name__)
        passage += 1
        time.sleep(periode)


def demarrer_tirage_automatique(delai_initial: float = 45, periode: float = 60):
    """Tâche de fond (une par processus) : chaque minute, tire les tombolas arrivées à leur date.
    KP_TOMBOLA_AUTO=0 l'empêche (tests, maintenance)."""
    if os.getenv("KP_TOMBOLA_AUTO") == "0":
        return
    t = _tache["thread"]
    if t is not None and t.is_alive():
        return
    t = threading.Thread(target=_boucle, args=(delai_initial, periode), daemon=True, name="tombola_tirage")
    _tache["thread"] = t
    t.start()
