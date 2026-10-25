"""
Journal des connexions de l'équipe et pointage de présence (routes : app/api/equipe.py).

Cadre (Code du travail L1121-1, L1222-4 ; RGPD art. 5, 6, 13, 15 ; doctrine CNIL) :
- finalité limitée : sécurité des accès et vérification de la présence en boutique AU MOMENT
  de la connexion ; aucun suivi continu (une seule lecture de position par session, demandée
  par l'application aux heures d'ouverture seulement) ;
- minimisation : JAMAIS de latitude / longitude stockées, journalisées ni renvoyées ; seuls le
  statut, la distance à la boutique arrondie à 50 m et la précision annoncée sont gardés ;
  l'adresse IP n'est gardée que sous forme d'empreinte salée non réversible ;
- conservation : données de position effacées après 60 jours, journal supprimé après 183 jours,
  traces des consultations admin après 12 mois (retention_connexions, tâche de fond horaire,
  coupée par KP_RETENTION_AUTO=0) ;
- le pointage est DÉSACTIVÉ par défaut ; il ne s'active qu'une fois la position de la boutique
  enregistrée et la note d'information écrite remise, et il ne vise que les membres à qui la
  version en vigueur de la note a été remise (equipe_notes_remises, app/api/equipe.py).

Détection de l'appareil : le client envoie un indice facultatif (lib/pointage.js, Client Hints
quand le navigateur les donne) ; le serveur ne lui fait pas confiance aveuglément : il lit aussi
le User-Agent, ne garde que des valeurs de listes connues et retombe sur sa propre déduction si
l'indice est incohérent ou absent. Aucun service externe.

Activité : derniere_activite et actions (écritures 2xx) sont cumulées en mémoire et écrites au
plus une fois par minute (une requête pour toutes les sessions), hors du chemin des requêtes.
"""

import hashlib
import hmac
import logging
import math
import os
import re
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from app.database import get_cursor

logger = logging.getLogger(__name__)

try:
    from zoneinfo import ZoneInfo
    _PARIS = ZoneInfo("Europe/Paris")
except Exception:  # image sans base tz : repli sur la règle d'heure d'été de l'UE
    _PARIS = None


# ─── Réglages et constantes ──────────────────────────────────────

PARAM_ACTIF = "GEO_POINTAGE_ACTIF"
PARAM_RAYON = "GEO_RAYON_M"
PARAM_LAT = "BOUTIQUE_LAT"
PARAM_LNG = "BOUTIQUE_LNG"
PARAMS = (PARAM_ACTIF, PARAM_RAYON, PARAM_LAT, PARAM_LNG)

# 79 Place Saint-Léger, 73000 Chambéry, d'après la Base Adresse Nationale (point du numéro) :
# référence validée d'office ; « Enregistrer la position de la boutique » peut l'affiner
BOUTIQUE_LAT_DEFAUT = 45.564435
BOUTIQUE_LNG_DEFAUT = 5.921091
RAYON_DEFAUT_M = 150
RAYON_MIN_M, RAYON_MAX_M = 50, 1000
# Au-delà de PRECISION_MAX_M, aucune conclusion (« imprecise ») : un ordinateur localisé par son
# adresse réseau annonce souvent ± 1 km ou plus, et se tromperait de ville
PRECISION_MAX_M = 200
PRECISION_EN_BOUTIQUE_MIN_M = 150   # « en_boutique » : précision ≤ max(rayon, 150 m)
PRECISION_BOUTIQUE_MAX_M = 300   # position de la boutique refusée au-delà (PC localisé par IP)
ARRONDI_DISTANCE_M = 50

HORAIRE_DEBUT_H, HORAIRE_FIN_H = 10, 19   # heure de Paris, du lundi au samedi

CONSERVATION_POSITION_JOURS = 60
CONSERVATION_JOURNAL_JOURS = 183
CONSERVATION_TRACES_JOURS = 365   # admin_audit_log (target_type 'equipe') : 12 mois
EXPIRATION_INACTIVITE_H = 12
EN_LIGNE_MINUTES = 15            # « En ligne maintenant » / « en cours »
ACTIVITE_PERIODE_S = 60          # écriture de l'activité : au plus une fois par minute

STATUTS_GEO = ("en_boutique", "hors_boutique", "imprecise", "refusee", "indisponible", "hors_horaires")
# Statut le plus « parlant » d'une journée (le plus petit rang l'emporte)
RANG_PRESENCE = {"hors_boutique": 1, "imprecise": 2, "en_boutique": 3, "refusee": 4,
                 "indisponible": 5, "hors_horaires": 6}
MOTIFS_FIN = ("deconnexion", "changement", "expiree")
CIBLES = ("accueil", "tech")
POSTE_MAX = 60


# ─── Heure de Paris ──────────────────────────────────────────────

def maintenant_utc() -> datetime:
    """Instant présent, naïf en UTC (convention des TIMESTAMP de la base)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _dernier_dimanche(annee: int, mois: int) -> date:
    d = date(annee + mois // 12, mois % 12 + 1, 1) - timedelta(days=1)
    return d - timedelta(days=(d.weekday() + 1) % 7)


def vers_paris(u: datetime) -> datetime:
    """Heure de Paris (naïve) d'un instant UTC naïf (ou conscient)."""
    if u.tzinfo is None:
        u = u.replace(tzinfo=timezone.utc)
    if _PARIS is not None:
        return u.astimezone(_PARIS).replace(tzinfo=None)
    n = u.astimezone(timezone.utc).replace(tzinfo=None)
    debut = datetime.combine(_dernier_dimanche(n.year, 3), datetime.min.time()).replace(hour=1)
    fin = datetime.combine(_dernier_dimanche(n.year, 10), datetime.min.time()).replace(hour=1)
    return n + timedelta(hours=2 if debut <= n < fin else 1)


def paris_vers_utc(local: datetime) -> datetime:
    """Instant UTC naïf d'une heure de Paris naïve (minuit d'un jour, typiquement)."""
    if _PARIS is not None:
        return local.replace(tzinfo=_PARIS).astimezone(timezone.utc).replace(tzinfo=None)
    essai = local - timedelta(hours=1)
    return local - (vers_paris(essai) - essai)


def aujourdhui_paris(u: Optional[datetime] = None) -> date:
    return vers_paris(u or maintenant_utc()).date()


def dans_horaires(u: Optional[datetime] = None) -> bool:
    """Heures d'ouverture : 10 h – 19 h, du lundi au samedi, heure de Paris."""
    p = vers_paris(u or maintenant_utc())
    return p.weekday() < 6 and HORAIRE_DEBUT_H <= p.hour < HORAIRE_FIN_H


def lundi(jour: date) -> date:
    return jour - timedelta(days=jour.weekday())


# ─── Détection de l'appareil ─────────────────────────────────────

TYPES = ("ordinateur", "iphone", "ipad", "smartphone", "tablette", "inconnu")
NAVIGATEURS = ("Safari", "Chrome", "Edge", "Firefox", "Samsung Internet", "Opera")
_SYSTEME_RE = re.compile(r"^(?:(?:iOS|iPadOS|Android) \d{1,2}|Windows(?: 1[01])?|macOS(?: \d{2})?"
                         r"|iOS|iPadOS|Android|ChromeOS|Linux)$")
MARQUES = ("Apple", "Samsung", "Google", "Xiaomi", "Huawei", "Honor", "Oppo", "OnePlus", "Motorola",
           "Sony", "Nokia", "Realme", "Vivo", "Lenovo", "Asus", "HP", "Dell", "Acer", "Microsoft",
           "Fairphone", "Nothing", "TCL", "Alcatel", "Wiko", "Crosscall")
_MARQUES_MIN = {m.lower(): m for m in MARQUES}
_MARQUES_MIN.update({"redmi": "Xiaomi", "poco": "Xiaomi", "mi": "Xiaomi", "moto": "Motorola",
                     "hmd": "Nokia", "one plus": "OnePlus", "realme": "Realme", "vivo": "Vivo"})
MARQUES_ORDINATEUR = ("Apple", "HP", "Dell", "Lenovo", "Asus", "Acer", "Microsoft")
_TEXTE_PROPRE = re.compile(r"[^A-Za-z0-9 ._+\-]")
TEXTE_MAX = 40

# Marque déduite du code modèle (Android) : préfixes sûrs seulement, sinon None.
# CPH : codes Oppo, partagés depuis 2022 avec quelques OnePlus (le cas est rare en boutique).
_PREFIXES_MARQUE = (
    (re.compile(r"^(SM-|GT-|SC-\d|SCV\d|SAMSUNG)", re.I), "Samsung"),
    (re.compile(r"^Pixel\b", re.I), "Google"),
    (re.compile(r"^(Redmi|POCO|Mi \w|MI \w|Xiaomi|M\d{4}[A-Z0-9]{2,}|2\d{3}[0-9A-Z]{4,})", re.I), "Xiaomi"),
    (re.compile(r"^(ONEPLUS|IN20\d\d|KB20\d\d|LE21\d\d|LE22\d\d|NE22\d\d|HD19\d\d|GM19\d\d)", re.I), "OnePlus"),
    (re.compile(r"^(CPH\d{4}|OPPO)", re.I), "Oppo"),
    (re.compile(r"^RMX\d{4}", re.I), "Realme"),
    (re.compile(r"^(vivo\b|V2\d{3}[A-Z]?$)", re.I), "Vivo"),
    (re.compile(r"^(moto|motorola|XT\d{4})", re.I), "Motorola"),
    (re.compile(r"^HUAWEI", re.I), "Huawei"),
    (re.compile(r"^HONOR", re.I), "Honor"),
    (re.compile(r"^XQ-[A-Z]{2}\d{2}", re.I), "Sony"),
    (re.compile(r"^(Nokia|TA-\d{4})", re.I), "Nokia"),
    (re.compile(r"^(Lenovo|TB-[A-Z0-9]{4,})", re.I), "Lenovo"),
    (re.compile(r"^ASUS", re.I), "Asus"),
    (re.compile(r"^Surface", re.I), "Microsoft"),
    (re.compile(r"^FP\d\b", re.I), "Fairphone"),
)

# Nom commercial : petite table de codes Samsung certains (le code reste l'information stockée)
_NOMS_COMMERCIAUX = (
    ("SM-S938", "Galaxy S25 Ultra"), ("SM-S936", "Galaxy S25+"), ("SM-S931", "Galaxy S25"),
    ("SM-S928", "Galaxy S24 Ultra"), ("SM-S926", "Galaxy S24+"), ("SM-S921", "Galaxy S24"),
    ("SM-S918", "Galaxy S23 Ultra"), ("SM-S916", "Galaxy S23+"), ("SM-S911", "Galaxy S23"),
    ("SM-S908", "Galaxy S22 Ultra"), ("SM-S906", "Galaxy S22+"), ("SM-S901", "Galaxy S22"),
    ("SM-G998", "Galaxy S21 Ultra"), ("SM-G996", "Galaxy S21+"), ("SM-G991", "Galaxy S21"),
    ("SM-A556", "Galaxy A55"), ("SM-A546", "Galaxy A54"), ("SM-A356", "Galaxy A35"),
    ("SM-A346", "Galaxy A34"), ("SM-A256", "Galaxy A25"), ("SM-A156", "Galaxy A15 5G"),
    ("SM-A155", "Galaxy A15"),
)


def nettoyer_texte(valeur, maxi: int = TEXTE_MAX) -> Optional[str]:
    """[A-Za-z0-9 ._+-], espaces réduits, `maxi` caractères ; None si vide."""
    if valeur is None or isinstance(valeur, (dict, list, tuple, set, bool)):
        return None
    s = _TEXTE_PROPRE.sub("", str(valeur)[:200])
    s = " ".join(s.split())[:maxi].strip()
    return s or None


def nettoyer_poste(valeur) -> Optional[str]:
    """Nom du poste donné par l'admin (« Comptoir », « Atelier ») : texte libre court."""
    if valeur is None or not isinstance(valeur, (str, int, float)) or isinstance(valeur, bool):
        return None
    s = "".join(ch for ch in str(valeur)[:200] if ch.isprintable())
    s = " ".join(s.split())[:POSTE_MAX].strip()
    return s or None


def normaliser_marque(valeur) -> Optional[str]:
    s = nettoyer_texte(valeur)
    return _MARQUES_MIN.get(s.lower()) if s else None


def marque_depuis_modele(modele: Optional[str]) -> Optional[str]:
    if not modele:
        return None
    for motif, marque in _PREFIXES_MARQUE:
        if motif.search(modele):
            return marque
    return None


def nom_commercial(modele: Optional[str]) -> Optional[str]:
    if not modele:
        return None
    m = modele.upper()
    for prefixe, nom in _NOMS_COMMERCIAUX:
        if m.startswith(prefixe):
            return nom
    if re.match(r"^Pixel\b", modele, re.I):
        return modele
    return None


def _famille(systeme: Optional[str]) -> Optional[str]:
    if not systeme:
        return None
    s = systeme.split(" ")[0]
    return "iOS" if s == "iPadOS" else s


def _version(motif: str, ua: str) -> Optional[int]:
    m = re.search(motif, ua)
    try:
        return int(m.group(1)) if m else None
    except (TypeError, ValueError):
        return None


def _lire_user_agent(ua: str) -> dict:
    """Déduction du serveur à partir du seul User-Agent."""
    out = {"type": "inconnu", "marque": None, "modele": None, "systeme": None, "navigateur": None,
           "_mac": False, "_ua_reduit": False}
    if not ua:
        return out
    # Navigateur (ordre : les dérivés de Chromium avant Chrome, Chrome avant Safari)
    if "SamsungBrowser/" in ua:
        out["navigateur"] = "Samsung Internet"
    elif re.search(r"\b(EdgA|EdgiOS|Edg|Edge)/", ua):
        out["navigateur"] = "Edge"
    elif re.search(r"\b(OPR|OPiOS|OPT)/", ua):
        out["navigateur"] = "Opera"
    elif re.search(r"\b(Firefox|FxiOS)/", ua):
        out["navigateur"] = "Firefox"
    elif re.search(r"\b(CriOS|Chrome|Chromium)/", ua):
        out["navigateur"] = "Chrome"
    elif "Safari/" in ua and ("Version/" in ua or "Mobile/" in ua):
        out["navigateur"] = "Safari"

    if re.search(r"\b(iPhone|iPod)\b", ua):
        out.update(type="iphone", marque="Apple")
        v = _version(r"(?:iPhone )?OS (\d{1,2})[_.]", ua)
        # iOS 26 : Safari fige « OS 18_6 » et donne la vraie version dans Version/26
        vs = _version(r"Version/(\d{2})\.", ua)
        if vs and vs >= 26:
            v = vs
        out["systeme"] = f"iOS {v}" if v else "iOS"
    elif "iPad" in ua:
        out.update(type="ipad", marque="Apple")
        v = _version(r"OS (\d{1,2})[_.]", ua)
        vs = _version(r"Version/(\d{2})\.", ua)
        if vs and vs >= 26:
            v = vs
        out["systeme"] = f"iPadOS {v}" if v else "iPadOS"
    elif "Android" in ua:
        mobile = " Mobile" in ua or "Mobile Safari" in ua
        out["type"] = "smartphone" if mobile else "tablette"
        v = _version(r"Android (\d{1,2})\b", ua)
        m = re.search(r"Android [\d.]+;\s*([^;)]+?)(?:\s+Build/[^;)]*)?\s*[;)]", ua)
        modele = m.group(1).strip() if m else None
        if modele and (modele in ("K", "wv", "U", "Mobile", "Tablet", "TV") or modele.lower().startswith(("linux", "en-", "fr-"))):
            modele = None
        if re.search(r"Android 10; K\)", ua):
            # User-Agent réduit de Chrome : « Android 10; K » est figé, ni version ni modèle réels
            out["_ua_reduit"] = True
            v = None
        if "SamsungBrowser/" in ua and modele and modele.upper() == "SAMSUNG":
            modele = None
        if modele:
            # « SAMSUNG SM-S918B » (Samsung Internet) → code seul
            modele = re.sub(r"^SAMSUNG\s+", "", modele, flags=re.I)
        out["modele"] = nettoyer_texte(modele)
        out["marque"] = marque_depuis_modele(out["modele"])
        if not out["marque"] and "SamsungBrowser/" in ua:
            out["marque"] = "Samsung"
        out["systeme"] = f"Android {v}" if v else "Android"
    elif "Windows" in ua:
        out.update(type="ordinateur", systeme="Windows")
    elif "CrOS" in ua:
        out.update(type="ordinateur", systeme="ChromeOS")
    elif "Macintosh" in ua or "Mac OS X" in ua:
        out.update(type="ordinateur", marque="Apple", systeme="macOS", _mac=True)
    elif "Linux" in ua or "X11" in ua:
        out.update(type="ordinateur", systeme="Linux")
    return out


def _systeme_client(s: Optional[str], famille_ua: Optional[str]) -> Optional[str]:
    """Système annoncé par le client, gardé s'il est connu et de la même famille que le User-Agent."""
    if not s or not isinstance(s, str):
        return None
    s = " ".join(s.split())[:20]
    if not _SYSTEME_RE.match(s):
        return None
    if famille_ua and _famille(s) != famille_ua:
        return None
    return s


def detecter_appareil(user_agent: Optional[str], indices_client=None) -> dict:
    """{type, marque, modele, systeme, navigateur} : User-Agent du serveur, complété par l'indice
    client quand il est cohérent (valeurs de listes connues, même famille de système)."""
    ua = str(user_agent or "")[:512]
    base = _lire_user_agent(ua)
    ind = indices_client if isinstance(indices_client, dict) else {}
    t_client = ind.get("type") if ind.get("type") in TYPES else None
    famille = _famille(base["systeme"])
    out = {k: base[k] for k in ("type", "marque", "modele", "systeme", "navigateur")}

    # iPadOS se présente comme un Mac : seul le client (écran tactile) le sait
    if base["_mac"] and t_client == "ipad":
        out.update(type="ipad", marque="Apple", modele=None)
        sys_c = _systeme_client(ind.get("systeme"), "iOS")
        vs = _version(r"Version/(\d{2})\.", ua)
        out["systeme"] = (sys_c.replace("iOS", "iPadOS") if sys_c and sys_c.startswith("iOS")
                          else sys_c or (f"iPadOS {vs}" if vs else "iPadOS"))
        famille = None   # déjà traité
    elif base["type"] == "inconnu" and t_client and t_client != "inconnu":
        # User-Agent illisible : l'indice n'est gardé que pour le type (rien d'autre à recouper)
        out["type"] = t_client

    if famille == "Android":
        if t_client in ("smartphone", "tablette"):
            out["type"] = t_client          # « Mobile » des Client Hints (mobile: true/false)
        modele_c = nettoyer_texte(ind.get("modele"))
        if modele_c and not out["modele"]:
            out["modele"] = modele_c
        marque_c = normaliser_marque(ind.get("marque"))
        marque_m = marque_depuis_modele(out["modele"])
        if marque_m:
            out["marque"] = marque_m
        elif marque_c and marque_c != "Apple" and not out["marque"]:
            out["marque"] = marque_c
        sys_c = _systeme_client(ind.get("systeme"), "Android")
        if sys_c and (base["_ua_reduit"] or out["systeme"] == "Android"):
            out["systeme"] = sys_c
    elif famille == "Windows":
        sys_c = _systeme_client(ind.get("systeme"), "Windows")
        if sys_c:
            out["systeme"] = sys_c
        out["marque"] = None                # un navigateur ne donne pas la marque d'un PC
        out["modele"] = None
    elif famille == "macOS":
        sys_c = _systeme_client(ind.get("systeme"), "macOS")
        if sys_c:
            out["systeme"] = sys_c
        out["modele"] = None
    elif famille == "iOS":
        sys_c = _systeme_client(ind.get("systeme"), "iOS")
        if sys_c and out["systeme"] in ("iOS", "iPadOS"):
            out["systeme"] = sys_c.replace("iOS", "iPadOS") if out["type"] == "ipad" else sys_c
        out["modele"] = None                # Safari ne donne pas le modèle exact
    elif famille in ("ChromeOS", "Linux"):
        out["marque"] = None
        out["modele"] = None

    if not out["navigateur"]:
        nav_c = ind.get("navigateur")
        out["navigateur"] = nav_c if nav_c in NAVIGATEURS else None
    # Bornes finales : listes connues uniquement
    if out["type"] not in TYPES:
        out["type"] = "inconnu"
    if out["navigateur"] not in NAVIGATEURS:
        out["navigateur"] = None
    if out["systeme"] and not _SYSTEME_RE.match(out["systeme"]):
        out["systeme"] = None
    if out["marque"] and out["marque"] not in MARQUES:
        out["marque"] = None
    if out["type"] == "ordinateur" and out["marque"] not in (None, "Apple"):
        out["marque"] = None
    out["modele"] = nettoyer_texte(out["modele"])
    return out


_LIBELLES_TYPE = {"ordinateur": "Ordinateur", "iphone": "iPhone", "ipad": "iPad",
                  "smartphone": "Smartphone", "tablette": "Tablette", "inconnu": "Appareil inconnu"}


def libelle_appareil(a: dict) -> str:
    """« iPhone · Apple · iOS 18 », « Smartphone · Samsung SM-S918B · Android 14 »,
    « Ordinateur · PC Windows · Chrome », « Ordinateur · Apple Mac · Safari »."""
    a = a or {}
    t = a.get("type") or "inconnu"
    parties = [_LIBELLES_TYPE.get(t, "Appareil inconnu")]
    marque, modele = a.get("marque"), a.get("modele")
    if t == "ordinateur":
        if marque == "Apple":
            parties.append("Apple Mac")
        elif (a.get("systeme") or "").startswith("Windows"):
            parties.append("PC Windows")
        elif a.get("systeme"):
            parties.append(a["systeme"])
        if a.get("navigateur"):
            parties.append(a["navigateur"])
        return " · ".join(parties)
    ident = " ".join(x for x in (marque, modele) if x)
    if ident:
        parties.append(ident)
    if a.get("systeme"):
        parties.append(a["systeme"])
    return " · ".join(parties)


def appareil_ligne(row: dict) -> dict:
    """Objet appareil renvoyé par l'API à partir d'une ligne de connexions_equipe."""
    a = {
        "type": row.get("appareil_type") or "inconnu",
        "marque": row.get("appareil_marque"),
        "modele": row.get("appareil_modele"),
        "systeme": row.get("systeme"),
        "navigateur": row.get("navigateur"),
    }
    a["nom"] = nom_commercial(a["modele"])
    a["libelle"] = libelle_appareil(a)
    return a


# ─── Position ────────────────────────────────────────────────────

def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def arrondi_distance(d: float) -> int:
    return int(round(d / ARRONDI_DISTANCE_M) * ARRONDI_DISTANCE_M)


def coordonnees_valides(lat, lng) -> bool:
    try:
        la, lo = float(lat), float(lng)
    except (TypeError, ValueError):
        return False
    if isinstance(lat, bool) or isinstance(lng, bool):
        return False
    return math.isfinite(la) and math.isfinite(lo) and -90 <= la <= 90 and -180 <= lo <= 180


def precision_valide(p):
    """Précision annoncée (m) en entier ; None si absente ou invalide."""
    if p is None or isinstance(p, bool):
        return None
    try:
        v = float(p)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v) or v < 0 or v > 10_000_000:
        return None
    return int(round(v))


def statut_position(distance_m: float, precision_m: int, rayon_m: int) -> str:
    """Prudent : « hors_boutique » seulement si tout le cercle de précision est hors du rayon,
    « en_boutique » seulement si la position est dans le rayon avec une précision suffisante ;
    tout le reste est « imprecise » (jamais de reproche sur une position douteuse)."""
    if precision_m > PRECISION_MAX_M:
        return "imprecise"
    if distance_m - precision_m > rayon_m:
        return "hors_boutique"
    if distance_m <= rayon_m and precision_m <= max(rayon_m, PRECISION_EN_BOUTIQUE_MIN_M):
        return "en_boutique"
    return "imprecise"


# ─── Empreinte de l'adresse IP ───────────────────────────────────

def _sel_ip() -> bytes:
    from app.api import auth   # import tardif : auth importe ce module
    return hmac.new(auth.JWT_SECRET.encode("utf-8"), b"kp-presence-ip", hashlib.sha256).digest()


def empreinte_ip(ip: Optional[str]) -> str:
    """sha256 tronqué de l'IP salée (sel dérivé de JWT_SECRET) : jamais l'IP en clair."""
    if not ip:
        return ""
    return hashlib.sha256(_sel_ip() + str(ip).encode("utf-8")).hexdigest()[:16]


def _ip(request) -> str:
    from app.api.auth import client_ip
    try:
        return client_ip(request)
    except Exception:
        return ""


# ─── Réglages ────────────────────────────────────────────────────

def lire_reglages(cur=None) -> dict:
    """Réglages stockés dans params. `interrupteur` : choix de l'admin ; le pointage ne tourne
    que si la position de la boutique est confirmée et la note remise (app/api/equipe.py)."""
    from app.services import params as params_cache
    v = params_cache.get_params(PARAMS, cur=cur)
    try:
        rayon = int(float(v.get(PARAM_RAYON) or RAYON_DEFAUT_M))
    except (TypeError, ValueError):
        rayon = RAYON_DEFAUT_M
    rayon = min(RAYON_MAX_M, max(RAYON_MIN_M, rayon))
    lat, lng, par_defaut = BOUTIQUE_LAT_DEFAUT, BOUTIQUE_LNG_DEFAUT, True
    if coordonnees_valides(v.get(PARAM_LAT), v.get(PARAM_LNG)):
        lat, lng, par_defaut = float(v[PARAM_LAT]), float(v[PARAM_LNG]), False
    return {
        "interrupteur": (v.get(PARAM_ACTIF) or "").strip() == "1",
        "rayon_m": rayon,
        "boutique_lat": lat,
        "boutique_lng": lng,
        # L'adresse officielle de la boutique vaut confirmation (plus d'étape à faire)
        "boutique_position_confirmee": True,
        "boutique_position_par_defaut": par_defaut,
    }


# ─── Équipe et remise de la note d'information (par membre) ──────

def est_robot(membre: dict) -> bool:
    """Membre technique (« Système », rôle « Bot SAV ») : ni salarié, ni ligne dans la grille."""
    return (membre.get("role") or "").strip().lower().startswith("bot")


def lire_membres(cur) -> list:
    """Tous les membres de l'équipe (nom nettoyé, couleur, rôle, actif)."""
    cur.execute("SELECT TRIM(nom) AS nom, couleur, role, actif FROM membres_equipe ORDER BY TRIM(nom), id")
    return [r for r in cur.fetchall() or [] if r.get("nom")]


def salaries_actifs(membres: list) -> list:
    """Membres actifs hors robots, sans doublon de nom, dans l'ordre alphabétique."""
    vus, out = set(), []
    for m in membres:
        if m.get("actif") == 1 and not est_robot(m) and m["nom"] not in vus:
            vus.add(m["nom"])
            out.append(m)
    return out


def version_note(texte: str) -> str:
    """Empreinte du texte de la note : un texte modifié (finalités, rayon…) redemande la remise."""
    return hashlib.sha256((texte or "").encode("utf-8")).hexdigest()[:12]


def lire_remises(cur) -> dict:
    """{membre: {remise_le, remise_par, version}} (table equipe_notes_remises)."""
    cur.execute("SELECT utilisateur, remise_le, remise_par, version FROM equipe_notes_remises")
    return {r["utilisateur"]: r for r in cur.fetchall() or []}


def poser_remises(cur, noms: list, version: str, par: str):
    for nom in noms:
        cur.execute("""INSERT INTO equipe_notes_remises (utilisateur, remise_le, remise_par, version)
                       VALUES (%s, timezone('UTC', NOW()), %s, %s)
                       ON CONFLICT (utilisateur) DO UPDATE
                       SET remise_le = EXCLUDED.remise_le, remise_par = EXCLUDED.remise_par,
                           version = EXCLUDED.version""", (str(nom)[:80], str(par or "")[:80], version))


def retirer_remises(cur, noms: list):
    if noms:
        cur.execute("DELETE FROM equipe_notes_remises WHERE utilisateur = ANY(%s)", (list(noms),))


# ─── Journal des connexions ──────────────────────────────────────

def _session_ouverte(cur, user: dict) -> Optional[dict]:
    """Ligne ouverte de la session du jeton : par son identifiant (cx), sinon la dernière ligne
    ouverte de la même lignée (sid) et du même membre."""
    cx, sid, sub = user.get("cx"), user.get("sid") or "", user.get("sub") or ""
    if not isinstance(cx, int) or isinstance(cx, bool):
        cx = None
    cur.execute("""SELECT * FROM connexions_equipe
                   WHERE sid = %s AND utilisateur = %s AND fin IS NULL
                   ORDER BY (id = %s) IS TRUE DESC, debut DESC, id DESC LIMIT 1""", (sid, sub, cx))
    return cur.fetchone()


def _fermer(cur, ids: list, motif: str):
    if ids:
        cur.execute("""UPDATE connexions_equipe
                       SET fin = GREATEST(derniere_activite, timezone('UTC', NOW())), fin_motif = %s,
                           derniere_activite = GREATEST(derniere_activite, timezone('UTC', NOW()))
                       WHERE id = ANY(%s) AND fin IS NULL""", (motif, list(ids)))


def ouvrir_session(request, sid: str, utilisateur: str, cible: str, poste=None, appareil=None,
                   precedent: Optional[dict] = None) -> Optional[int]:
    """Nouvelle ligne du journal (connexion par PIN ou changement d'utilisateur) ; la session
    précédente du même navigateur (jeton `precedent`) est close « changement ». Même membre
    qu'avant sur une session encore ouverte (switch-user vers soi-même) : rien de nouveau.
    Renvoie l'identifiant de la ligne (claim « cx » du jeton) ; une panne n'empêche jamais
    de se connecter (None)."""
    try:
        ua = request.headers.get("user-agent", "") if request is not None else ""
        a = detecter_appareil(ua, appareil)
        poste = nettoyer_poste(poste)
        cible = cible if cible in CIBLES else "accueil"
        empreinte = empreinte_ip(_ip(request)) if request is not None else ""
        if precedent:
            vider_activite(cle_activite(precedent))
        with get_cursor() as cur:
            if precedent:
                row = _session_ouverte(cur, precedent)
                if row and row.get("utilisateur") == utilisateur and row.get("sid") == sid:
                    return row.get("id")
                if row:
                    _fermer(cur, [row["id"]], "changement")
            cur.execute("""
                INSERT INTO connexions_equipe
                    (sid, utilisateur, cible, poste, appareil_type, appareil_marque, appareil_modele,
                     systeme, navigateur, ip_empreinte)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (str(sid)[:64], str(utilisateur)[:80], cible, poste, a["type"], a["marque"], a["modele"],
                  a["systeme"], a["navigateur"], empreinte))
            row = cur.fetchone()
            return row.get("id") if row else None
    except Exception as e:
        logger.warning("Journal des connexions : ouverture non enregistrée (%s)", type(e).__name__)
        return None


def fermer_session(user: dict, motif: str = "deconnexion") -> bool:
    """Clôt la session du jeton (déconnexion). True si une ligne a été close."""
    try:
        vider_activite(cle_activite(user))
        with get_cursor() as cur:
            row = _session_ouverte(cur, user)
            if not row:
                return False
            _fermer(cur, [row["id"]], motif if motif in MOTIFS_FIN else "deconnexion")
            return True
    except Exception as e:
        logger.warning("Journal des connexions : fermeture non enregistrée (%s)", type(e).__name__)
        return False


def session_courante(user: dict) -> Optional[dict]:
    """Ligne ouverte de la session du jeton (activité en attente écrite d'abord)."""
    vider_activite(cle_activite(user))
    with get_cursor() as cur:
        return _session_ouverte(cur, user)


# Position gardée arrondie à 3 décimales (≈ 100 m) : où se trouve le salarié, pas son adresse exacte
DECIMALES_POSITION = 3


def arrondi_position(v) -> Optional[float]:
    return None if v is None else round(float(v), DECIMALES_POSITION)


def enregistrer_position(session_id: int, statut: str, distance_m: Optional[int],
                         precision_m: Optional[int], lat=None, lng=None) -> bool:
    """Une seule fois par session (geo_le encore vide) : False si déjà fait."""
    if statut not in STATUTS_GEO:
        raise ValueError("statut inconnu")
    with get_cursor() as cur:
        cur.execute("""UPDATE connexions_equipe
                       SET geo_statut = %s, geo_distance_m = %s, geo_precision_m = %s,
                           geo_lat = %s, geo_lng = %s, geo_le = timezone('UTC', NOW())
                       WHERE id = %s AND geo_le IS NULL AND fin IS NULL""",
                    (statut, distance_m, precision_m, arrondi_position(lat), arrondi_position(lng),
                     session_id))
        return (cur.rowcount or 0) > 0


# ─── Activité (mémoire, écrite au plus une fois par minute) ──────

class SuiviActivite:
    """Dernière activité et nombre d'écritures réussies par session, cumulés en mémoire.

    Une écriture en base par période pour TOUTES les sessions (deux requêtes) : jamais dans le
    chemin d'une requête. Une session sans ligne ouverte (jeton antérieur au journal, ou ligne
    close « expiree » après 12 h sans activité) reprend sur une nouvelle ligne ; une session
    close par une déconnexion ou un changement d'utilisateur ne reprend jamais.
    """

    MAX_CLES = 2000

    def __init__(self, periode: float = ACTIVITE_PERIODE_S):
        self.periode = periode
        self._attente: dict = {}
        self._verrou = threading.Lock()
        self._ecriture = threading.Lock()
        self._thread = None
        self.ecritures = 0      # requêtes UPDATE d'activité envoyées (mesure)

    def noter(self, user: dict, ecriture: bool, user_agent: str = "", ip: str = ""):
        cle = cle_activite(user)
        if not cle:
            return
        vu = maintenant_utc()
        with self._verrou:
            e = self._attente.get(cle)
            if e is None:
                e = self._attente[cle] = {
                    "cx": user.get("cx") if isinstance(user.get("cx"), int) else None,
                    "sid": str(user.get("sid") or "")[:64], "sub": str(user.get("sub") or "")[:80],
                    "cible": user.get("target"), "ua": (user_agent or "")[:512], "ip": ip,
                    "vu": vu, "n": 0,
                }
            e["vu"] = vu
            if ecriture:
                e["n"] += 1
            trop = len(self._attente) > self.MAX_CLES
        self._demarrer()
        if trop:
            threading.Thread(target=self.vider, daemon=True, name="activite_trop").start()

    def _demarrer(self):
        if self._thread is not None and self._thread.is_alive():
            return
        if os.getenv("KP_ACTIVITE_AUTO") == "0":
            return
        with self._verrou:
            if self._thread is not None and self._thread.is_alive():
                return
            self._thread = threading.Thread(target=self._boucle, daemon=True, name="activite_equipe")
            self._thread.start()

    def _boucle(self):
        while True:
            time.sleep(self.periode)
            try:
                self.vider()
            except Exception as e:
                logger.warning("Activité de l'équipe : écriture reportée (%s)", type(e).__name__)

    def prendre(self, cle=None) -> dict:
        with self._verrou:
            if cle is None:
                lot, self._attente = self._attente, {}
                return lot
            e = self._attente.pop(cle, None)
            return {cle: e} if e else {}

    def remettre(self, lot: dict):
        """Écriture en échec : l'activité est rendue (fusionnée avec la plus récente)."""
        with self._verrou:
            for cle, e in lot.items():
                cur = self._attente.get(cle)
                if cur is None:
                    self._attente[cle] = e
                else:
                    cur["n"] += e["n"]
                    cur["vu"] = max(cur["vu"], e["vu"])

    def vider(self, cle=None) -> int:
        """Écrit l'activité en attente (toutes les sessions, ou une seule). Lignes touchées."""
        lot = self.prendre(cle)
        if not lot:
            return 0
        with self._ecriture:
            try:
                return _ecrire_activite(lot, self)
            except Exception:
                self.remettre(lot)
                raise

    def reset(self):
        with self._verrou:
            self._attente.clear()


def cle_activite(user: dict):
    if not user:
        return None
    cx = user.get("cx")
    if isinstance(cx, int) and not isinstance(cx, bool):
        return ("cx", cx)
    sid, sub = user.get("sid"), user.get("sub")
    return ("sid", str(sid), str(sub)) if sid and sub else None


def _ecrire_activite(lot: dict, suivi: "SuiviActivite") -> int:
    cles = list(lot)
    valeurs = [(i, lot[k]["cx"], lot[k]["sid"], lot[k]["sub"], lot[k]["vu"]) for i, k in enumerate(cles)]
    with get_cursor() as cur:
        # 1. Ligne ouverte de chaque session, encore active depuis moins de 12 h
        cur.execute("""
            SELECT v.i, r.id, r.derniere_activite AS derniere
            FROM (VALUES """ + ",".join(["(%s, %s::int, %s, %s, %s::timestamp)"] * len(valeurs)) + """)
                 AS v(i, cx, sid, sub, vu)
            LEFT JOIN LATERAL (
                SELECT c.id, c.derniere_activite FROM connexions_equipe c
                WHERE c.sid = v.sid AND c.utilisateur = v.sub AND c.fin IS NULL
                ORDER BY (c.id = v.cx) IS TRUE DESC, c.debut DESC, c.id DESC
                LIMIT 1
            ) r ON TRUE
        """, [x for t in valeurs for x in t])
        trouves = {r["i"]: r for r in cur.fetchall() or []}
        maj, reprises = {}, []
        for i, cle in enumerate(cles):
            e, r = lot[cle], trouves.get(i)
            limite = e["vu"] - timedelta(hours=EXPIRATION_INACTIVITE_H)
            if r and r.get("id") and not (r.get("derniere") and r["derniere"] < limite):
                m = maj.setdefault(r["id"], [e["vu"], 0])
                m[0] = max(m[0], e["vu"])
                m[1] += e["n"]
            else:
                reprises.append(e)
        n = 0
        if maj:
            # 2. Une seule requête pour toutes les sessions
            cur.execute("""
                UPDATE connexions_equipe c
                SET derniere_activite = GREATEST(c.derniere_activite, v.vu), actions = c.actions + v.n
                FROM (VALUES """ + ",".join(["(%s::int, %s::timestamp, %s::int)"] * len(maj)) + """)
                     AS v(id, vu, n)
                WHERE c.id = v.id AND c.fin IS NULL
            """, [x for k, (vu, nb) in maj.items() for x in (k, vu, nb)])
            n = cur.rowcount or 0
            suivi.ecritures += 1
        for e in reprises:
            n += _reprendre(cur, e)
        return n


def _reprendre(cur, e: dict) -> int:
    """Session sans ligne ouverte : nouvelle ligne si le jeton est antérieur au journal ou si sa
    dernière ligne a expiré (ligne ouverte inactive depuis 12 h : close « expiree » d'abord)."""
    cur.execute("""SELECT * FROM connexions_equipe WHERE sid = %s AND utilisateur = %s
                   ORDER BY debut DESC, id DESC LIMIT 1""", (e["sid"], e["sub"]))
    ref = cur.fetchone()
    if ref and ref.get("fin") is None:
        limite = e["vu"] - timedelta(hours=EXPIRATION_INACTIVITE_H)
        if ref.get("derniere_activite") and ref["derniere_activite"] >= limite:
            return 0   # écrite entre-temps
        cur.execute("""UPDATE connexions_equipe SET fin = derniere_activite, fin_motif = 'expiree'
                       WHERE id = %s AND fin IS NULL""", (ref["id"],))
    elif ref and ref.get("fin_motif") != "expiree":
        return 0       # déconnexion ou changement d'utilisateur : la session est finie
    if ref:
        a = {"type": ref.get("appareil_type"), "marque": ref.get("appareil_marque"),
             "modele": ref.get("appareil_modele"), "systeme": ref.get("systeme"),
             "navigateur": ref.get("navigateur")}
        poste, cible, empreinte = ref.get("poste"), ref.get("cible"), ref.get("ip_empreinte") or ""
    else:
        a = detecter_appareil(e.get("ua"), None)
        poste, cible, empreinte = None, e.get("cible"), empreinte_ip(e.get("ip"))
    cur.execute("""
        INSERT INTO connexions_equipe
            (sid, utilisateur, cible, poste, appareil_type, appareil_marque, appareil_modele, systeme,
             navigateur, ip_empreinte, debut, derniere_activite, actions)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """, (e["sid"], e["sub"], cible if cible in CIBLES else "accueil", poste, a.get("type") or "inconnu",
          a.get("marque"), a.get("modele"), a.get("systeme"), a.get("navigateur"), empreinte,
          e["vu"], e["vu"], e["n"]))
    return 1


SUIVI = SuiviActivite()

# Écritures comptées comme « actions » (hors authentification et pointage)
_METHODES_ECRITURE = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_CHEMINS_IGNORES = ("/api/auth/", "/api/equipe/position")


def noter_requete(request, status_code: int):
    """Appelé par le middleware après chaque réponse : session authentifiée seulement
    (get_current_user a posé request.state.kp_user). Les appels de fond (rafraîchissement
    périodique, en-tête X-KP-Fond: 1) ne comptent pas comme activité."""
    try:
        user = request.scope.get("state", {}).get("kp_user")
        if not user:
            return
        chemin = request.url.path
        if chemin.startswith(_CHEMINS_IGNORES):
            return
        ecriture = request.method in _METHODES_ECRITURE and 200 <= status_code < 300
        if not ecriture and (request.headers.get("x-kp-fond") == "1" or status_code >= 400):
            return
        e_neuve = cle_activite(user) not in SUIVI._attente
        SUIVI.noter(user, ecriture,
                    request.headers.get("user-agent", "") if e_neuve else "",
                    _ip(request) if e_neuve else "")
    except Exception:
        pass


def vider_activite(cle=None) -> int:
    try:
        return SUIVI.vider(cle)
    except Exception as e:
        logger.warning("Activité de l'équipe : écriture reportée (%s)", type(e).__name__)
        return 0


# ─── Rétention ───────────────────────────────────────────────────

def retention_connexions(maintenant: Optional[datetime] = None) -> dict:
    """Position effacée après 60 jours, lignes supprimées après 183 jours, sessions inactives
    depuis 12 h closes « expiree » (fin = dernière activité : la durée n'est pas gonflée), traces
    admin de l'activité de l'équipe supprimées après 12 mois."""
    vider_activite()
    t = maintenant or maintenant_utc()
    with get_cursor() as cur:
        cur.execute("""UPDATE connexions_equipe
                       SET geo_statut = NULL, geo_distance_m = NULL, geo_precision_m = NULL, geo_le = NULL,
                           geo_lat = NULL, geo_lng = NULL
                       WHERE COALESCE(geo_le, debut) < %s
                         AND (geo_statut IS NOT NULL OR geo_distance_m IS NOT NULL
                              OR geo_precision_m IS NOT NULL OR geo_le IS NOT NULL
                              OR geo_lat IS NOT NULL OR geo_lng IS NOT NULL)""",
                    (t - timedelta(days=CONSERVATION_POSITION_JOURS),))
        positions = cur.rowcount or 0
        cur.execute("DELETE FROM connexions_equipe WHERE debut < %s",
                    (t - timedelta(days=CONSERVATION_JOURNAL_JOURS),))
        supprimees = cur.rowcount or 0
        cur.execute("""UPDATE connexions_equipe
                       SET fin = GREATEST(derniere_activite, debut), fin_motif = 'expiree'
                       WHERE fin IS NULL AND derniere_activite < %s""",
                    (t - timedelta(hours=EXPIRATION_INACTIVITE_H),))
        expirees = cur.rowcount or 0
        cur.execute("DELETE FROM admin_audit_log WHERE target_type = 'equipe' AND created_at < %s",
                    (t - timedelta(days=CONSERVATION_TRACES_JOURS),))
        traces = cur.rowcount or 0
    return {"positions_effacees": positions, "lignes_supprimees": supprimees, "sessions_expirees": expirees,
            "traces_supprimees": traces}


_tache = {"thread": None}


def _boucle_retention(delai_initial: float, periode: float):
    time.sleep(delai_initial)
    while True:
        try:
            retention_connexions()
        except Exception as e:
            logger.warning("Journal des connexions : rétention reportée (%s)", type(e).__name__)
        time.sleep(periode)


def demarrer_retention(delai_initial: float = 120, periode: float = 3600):
    """Tâche de fond (une par processus), chaque heure : passages idempotents (effacements
    datés, expiration à 12 h). KP_RETENTION_AUTO=0 l'empêche (tests, maintenance)."""
    if os.getenv("KP_RETENTION_AUTO") == "0":
        return
    t = _tache["thread"]
    if t is not None and t.is_alive():
        return
    t = threading.Thread(target=_boucle_retention, args=(delai_initial, periode), daemon=True,
                         name="equipe_retention")
    _tache["thread"] = t
    t.start()


# ─── Trace admin ─────────────────────────────────────────────────

def journaliser(cur, request, user: dict, action: str, details: str = ""):
    """admin_audit_log : qui, quand, quoi (filtre utilisé) ; jamais de donnée de position.
    Adresse réseau en empreinte salée (empreinte_ip). Un échec n'annule pas l'opération."""
    ip_hash = empreinte_ip(_ip(request)) if request is not None else ""
    cur.execute("SAVEPOINT kp_audit_equipe")
    try:
        cur.execute(
            """INSERT INTO admin_audit_log (user_login, user_target, action, target_type, target_id, details, ip_hash)
               VALUES (%s, %s, %s, 'equipe', NULL, %s, %s)""",
            (str(user.get("sub") or "")[:60], str(user.get("target") or "")[:30], action,
             (details or "")[:500], ip_hash),
        )
        cur.execute("RELEASE SAVEPOINT kp_audit_equipe")
    except Exception:
        cur.execute("ROLLBACK TO SAVEPOINT kp_audit_equipe")
