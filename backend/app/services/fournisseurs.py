"""
Synchronisation automatique des tarifs Mobilax : prix d'achat HT des pièces de la grille.

Le gérant se connecte UNE fois : sur mobilax.fr (connecté), il copie les jetons de son
navigateur (console : copy(JSON.stringify(localStorage))) et les colle dans Klikphone
(Réparation smartphones → Mobilax → Connecter) ; ou pose MOBILAX_REFRESH_TOKEN (et
MOBILAX_ID_CLIENT) dans les variables Railway. Ensuite, chaque jour :
1. le jeton d'accès est renouvelé avec le jeton de rafraîchissement (POST user/refresh-token) ;
   le nouveau jeton de rafraîchissement, s'il en revient un, remplace l'ancien (table params) ;
2. chaque modèle de la grille (tarifs, iPad / MacBook) est cherché dans le catalogue Mobilax
   (GET catalogs/web/products?search=…, prix du compte : id_customer) ;
3. les produits lus (référence EAN, désignation, prix HT) passent par le moteur d'import de
   fichier fournisseur (services/import_prix) : pièce reconnue sans alerte → prix d'achat et
   prix client recalculé écrits (lot annulable, historique, source 'import', par « Synchro
   Mobilax ») ; prix inchangé → confirmé du jour ; grosse variation (règles de prix) →
   proposition à valider (tarifs_propositions, tuile « Propositions ») ; pièce verrouillée ou
   obsolète → jamais touchée ; produit inconnu → ignoré (aucune pièce créée) ; pièce vendue en
   plusieurs variantes (coloris…) → la moins chère ; prix de vente des grilles boutique jamais écrits ;
4. l'état (date, réussite, compteurs, erreur) est écrit dans params et affiché dans « Santé des
   prix » ; un jeton refusé par Mobilax passe la connexion à « expirée » (à refaire), sans plantage.

Un passage par jour (réservation du jour par compare-and-set dans params, 3 essais au plus en
cas d'échec), un seul passage à la fois même à plusieurs workers (verrou horodaté dans params,
40 min), vérification toutes les heures en tâche de fond (demarrer_synchro_quotidienne) ;
bouton « Synchroniser maintenant » (api/fournisseurs) à tout moment. KP_SYNC_FOURNISSEURS=0
empêche la tâche (tests, maintenance). Politesse : une requête par seconde, 4 pages de 50
produits au plus par modèle, 25 minutes au plus par passage.

Utopya : aucune requête (challenge Cloudflare, prix non publics) ; import de fichier seulement.
Les jetons ne sortent jamais par l'API (clés *_TOKEN masquées par api/config).
SQL : fragments fixes de ce module, valeurs en paramètres %s.
"""

import csv
import io
import json
import logging
import os
import re
import threading
import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Optional

import httpx

from app.database import get_cursor
from app.services import import_prix
from app.services import params as params_cache
from app.services import prix
from app.services.prestations import normaliser

logger = logging.getLogger("klikphone.fournisseurs")

MOBILAX_API = "https://apiv2.mobilax.fr/v1.0/"
ID_LANG = 1
FOURNISSEUR = "Mobilax"
AUTEUR = "Synchro Mobilax"
USER_AGENT = "KlikphoneSAV/1.0 (synchro tarifs)"
UTOPYA_RAISON = ("Utopya n'offre ni export ni API : ses prix ne sont visibles que connecté et le site refuse "
                 "les programmes (protection Cloudflare). Utilisez « Importer une liste de prix ».")

# Table params. Les clés contenant TOKEN sont masquées par api/config (est_secret).
P_TOKEN = "MOBILAX_TOKEN"                    # jeton d'accès (renouvelé à chaque passage)
P_REFRESH = "MOBILAX_REFRESH_TOKEN"          # jeton de rafraîchissement (la connexion du gérant)
P_ID_CLIENT = "MOBILAX_ID_CLIENT"            # id_customer (prix du compte)
P_PALIER = "MOBILAX_PALIER"                  # palier tarifaire du compte, JSON {id, nom} (Bronze, Silver, Gold…)
P_ACTIVE = "MOBILAX_SYNCHRO_ACTIVE"          # '0' : synchro quotidienne coupée (bouton manuel possible)
P_DERNIERE = "MOBILAX_SYNCHRO_DERNIERE"      # fin du dernier passage (ISO UTC)
P_OK = "MOBILAX_SYNCHRO_OK"                  # '1' / '0'
P_RESUME = "MOBILAX_SYNCHRO_RESUME"          # JSON (compteurs, erreur)
P_JOUR = "MOBILAX_SYNCHRO_JOUR"              # AAAA-MM-JJ (fait) ou AAAA-MM-JJ#n (n-ième essai en cours ou raté)
P_VERROU = "MOBILAX_SYNCHRO_VERROU"          # ISO UTC du début du passage en cours ('' : libre)
P_CONNEXION = "MOBILAX_CONNEXION"            # 'ok' | 'expiree' | ''
P_DIAG = "MOBILAX_DIAGNOSTIC"                # JSON : pièces de la grille sans prix Mobilax au dernier passage
ENV_REFRESH = "MOBILAX_REFRESH_TOKEN"        # amorçage par l'environnement (Railway)
ENV_ID_CLIENT = "MOBILAX_ID_CLIENT"

PAUSE = 1.0              # secondes entre deux requêtes
TIMEOUT = 20.0
LIMITE_PAGE = 50
PAGES_MAX = 4            # par modèle
BUDGET_SECONDES = 25 * 60
ERREURS_MAX = 5          # erreurs réseau consécutives → arrêt du passage
VERROU_MINUTES = 40
ESSAIS_PAR_JOUR = 3
RESUME_MAX = 20000       # octets du JSON gardé dans params
DIAG_MAX_PIECES = 500    # pièces détaillées dans le diagnostic (les autres sont seulement comptées)
_FMT = "%Y-%m-%dT%H:%M:%S"


class ErreurJeton(Exception):
    """Jeton absent, refusé ou expiré : le gérant doit refaire la connexion."""

    def __init__(self, message, code="jeton_expire"):
        super().__init__(message)
        self.code = code


class ErreurMobilax(Exception):
    """Mobilax injoignable, en erreur ou réponse inattendue : nouvel essai plus tard."""

    def __init__(self, message, code="mobilax"):
        super().__init__(message)
        self.code = code


def _utc() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).strftime(_FMT)


# ─── Jetons collés par le gérant ────────────────────────────────

_CLES_REFRESH = ("web_mobi_refresh_token", "refreshToken", "refresh_token", "refresh")
_CLES_TOKEN = ("web_mobi_token", "token", "access_token")
_CLES_ID = ("web_mobi_user_id", "id_customer", "id_client", "user_id")
_CLES_FICHE = ("userId", "user", "web_mobi_user")   # fiche client rangée par le site : {"state":{"user":{…}}}
_JETON_RE = re.compile(r"[A-Za-z0-9._~+/=-]{20,}")


def _deballer(v) -> str:
    """Valeur de localStorage : parfois une chaîne JSON entre guillemets."""
    if v is None:
        return ""
    s = str(v).strip()
    if len(s) >= 2 and s[0] == s[-1] == '"':
        try:
            s = json.loads(s)
        except ValueError:
            s = s[1:-1]
    return str(s).strip()


def _premier(d: dict, cles) -> str:
    for cle in cles:
        if d.get(cle) not in (None, ""):
            return _deballer(d[cle])
    return ""


def _fiche_collee(d: dict) -> dict:
    """Fiche client que le site range dans localStorage (userId : {"state":{"user":{id, category…}}})."""
    for cle in _CLES_FICHE:
        v = d.get(cle)
        if isinstance(v, str) and v.lstrip().startswith("{"):
            try:
                v = json.loads(v)
            except ValueError:
                continue
        if not isinstance(v, dict):
            continue
        u = v.get("state", v)
        u = u.get("user", u) if isinstance(u, dict) else {}
        if isinstance(u, dict) and (u.get("id") or u.get("category")):
            return u
    return {}


def palier_compte(fiche) -> dict:
    """{id, nom} du palier tarifaire (Bronze, Silver, Gold, Platinum, Diamond) d'une fiche client
    Mobilax (clé category), {} s'il n'en montre aucun. Chaque produit porte un prix par palier."""
    c = fiche.get("category") if isinstance(fiche, dict) else None
    if not isinstance(c, dict):
        return {}
    nom = str(c.get("name") or "").strip()[:30]
    ident = _nombre(c.get("id"))
    if not nom and ident is None:
        return {}
    return {"id": int(ident) if ident is not None else None, "nom": nom}


def lire_jetons(texte) -> dict:
    """{refresh, token, id_client} depuis le texte collé : JSON de localStorage
    (copy(JSON.stringify(localStorage)) sur mobilax.fr connecté) ou le seul jeton de
    rafraîchissement. ValueError (message pour l'utilisateur) si rien d'utilisable."""
    s = str(texte or "").strip()
    if len(s) > 40000:
        raise ValueError("Texte trop long : collez seulement le résultat de la commande copy(JSON.stringify(localStorage)).")
    if not s:
        raise ValueError("Collez le texte copié depuis mobilax.fr.")
    out = {"refresh": "", "token": "", "id_client": "", "palier": {}}
    if s.startswith("{"):
        try:
            d = json.loads(s)
        except ValueError:
            raise ValueError("Texte illisible : attendu le résultat de copy(JSON.stringify(localStorage)).")
        if not isinstance(d, dict):
            raise ValueError("Texte illisible : attendu le résultat de copy(JSON.stringify(localStorage)).")
        out["refresh"] = _premier(d, _CLES_REFRESH)
        out["token"] = _premier(d, _CLES_TOKEN)
        fiche = _fiche_collee(d)
        out["id_client"] = _premier(d, _CLES_ID) or str(fiche.get("id") or "")
        out["palier"] = palier_compte(fiche)
    elif _JETON_RE.fullmatch(s):
        out["refresh"] = s
    if not _JETON_RE.fullmatch(out["refresh"] or ""):
        raise ValueError("Jeton de rafraîchissement introuvable (clé web_mobi_refresh_token) : connectez-vous "
                         "d'abord sur mobilax.fr, puis recopiez.")
    if not _JETON_RE.fullmatch(out["token"] or ""):
        out["token"] = ""
    out["id_client"] = re.sub(r"\D", "", out["id_client"])[:12]
    return out


# ─── Client de l'API Mobilax ────────────────────────────────────

class ClientMobilax:
    """Appels à apiv2.mobilax.fr pour le compte du gérant (jeton Bearer, renouvelé au besoin).
    `transport` (httpx.MockTransport) sert aux tests : aucune requête réseau."""

    def __init__(self, refresh: str, token: str = "", id_client: str = "", transport=None,
                 pause: float = PAUSE, dormir=time.sleep, palier: dict = None):
        self.refresh, self.token, self.id_client = refresh, token or "", str(id_client or "")
        self.palier = dict(palier or {})          # {id, nom} : palier tarifaire du compte
        self.pause, self._dormir = pause, dormir
        self.requetes = 0
        self.http = httpx.Client(base_url=MOBILAX_API, timeout=TIMEOUT, transport=transport,
                                 headers={"Accept": "application/json", "User-Agent": USER_AGENT})

    def close(self):
        self.http.close()

    @staticmethod
    def _corps(r):
        try:
            return r.json()
        except ValueError:
            return None

    @staticmethod
    def _donnees(corps):
        if isinstance(corps, dict) and isinstance(corps.get("data"), dict):
            return corps["data"]
        return corps if isinstance(corps, dict) else {}

    def rafraichir(self) -> str:
        """Nouveau jeton d'accès (et de rafraîchissement s'il en revient un)."""
        self.requetes += 1
        try:
            r = self.http.post("user/refresh-token", json={"refreshToken": self.refresh})
        except httpx.HTTPError as e:
            raise ErreurMobilax(f"Mobilax injoignable ({type(e).__name__})", "reseau")
        if r.status_code in (400, 401, 403, 404, 422):
            raise ErreurJeton("Jeton Mobilax refusé ou expiré : reconnectez-vous (Réparation smartphones → Mobilax).")
        if r.status_code >= 500:
            raise ErreurMobilax(f"Mobilax indisponible (HTTP {r.status_code})")
        d = self._donnees(self._corps(r) or {})
        token = str(d.get("token") or d.get("access_token") or d.get("accessToken") or "").strip()
        if not token:
            raise ErreurJeton("Réponse Mobilax sans jeton : reconnectez-vous (Réparation smartphones → Mobilax).")
        self.token = token
        nouveau = str(d.get("refreshToken") or d.get("refresh_token") or "").strip()
        if nouveau:
            self.refresh = nouveau
        return token

    def _get(self, chemin: str, params: dict = None, _retente: bool = True):
        if not self.token:
            self.rafraichir()
        self.requetes += 1
        try:
            r = self.http.get(chemin, params=params, headers={"Authorization": f"Bearer {self.token}"})
        except httpx.HTTPError as e:
            raise ErreurMobilax(f"Mobilax injoignable ({type(e).__name__})", "reseau")
        if r.status_code == 401 and _retente:
            self.rafraichir()
            return self._get(chemin, params, _retente=False)
        if r.status_code in (401, 403):
            raise ErreurJeton("Accès Mobilax refusé : reconnectez-vous (Réparation smartphones → Mobilax).")
        if r.status_code == 404:
            return None
        if r.status_code == 429:
            raise ErreurMobilax("Mobilax limite les requêtes (HTTP 429) : nouvel essai plus tard", "limite")
        if r.status_code >= 400:
            raise ErreurMobilax(f"Mobilax a répondu HTTP {r.status_code}")
        corps = self._corps(r)
        if corps is None:
            raise ErreurMobilax("Réponse Mobilax illisible (pas du JSON)")
        return corps

    def details_client(self) -> dict:
        """Fiche du compte (id, show_prices, category = palier tarifaire…) ; {} si l'API ne la donne pas."""
        d = self._donnees(self._get("user/customers/details") or {})
        if d.get("id") and not self.id_client:
            self.id_client = str(d["id"])
        pal = palier_compte(d)
        if pal:
            self.palier = pal
        return d

    def page_produits(self, recherche: str, page: int = 1) -> tuple:
        params = {"search": recherche, "id_lang": ID_LANG, "no_log": "true", "page": page, "limit": LIMITE_PAGE}
        if self.id_client:
            params["id_customer"] = self.id_client
        return lire_page(self._get("catalogs/web/products", params))

    def produits(self, recherche: str, pages_max: int = PAGES_MAX) -> list:
        """Produits trouvés pour une recherche (toutes les pages, pages_max au plus)."""
        return self.produits_et_deborde(recherche, pages_max)[0]

    def produits_et_deborde(self, recherche: str, pages_max: int = PAGES_MAX) -> tuple:
        """(produits, déborde) : déborde quand Mobilax a plus de pages que pages_max."""
        out, page = [], 1
        while True:
            lus, total_pages = self.page_produits(recherche, page)
            out += lus
            if not lus or page >= min(total_pages, pages_max):
                return out, bool(lus) and total_pages > pages_max
            page += 1
            self._dormir(self.pause)


def lire_page(corps) -> tuple:
    """(produits, nombre de pages) d'une réponse de catalogs/web/products, quelle que soit
    l'enveloppe ({data: {products, totalPage…}}, {products}, ou liste)."""
    d = corps
    for _ in range(3):
        if isinstance(d, dict) and isinstance(d.get("data"), (dict, list)):
            d = d["data"]
        else:
            break
    if isinstance(d, list):
        return [p for p in d if isinstance(p, dict)], 1
    if not isinstance(d, dict):
        return [], 1
    produits = d.get("products") or d.get("items") or d.get("rows") or []
    if not isinstance(produits, list):
        produits = []
    try:
        total_pages = max(1, int(d.get("totalPage") or d.get("total_pages") or d.get("totalPages") or 1))
    except (TypeError, ValueError):
        total_pages = 1
    return [p for p in produits if isinstance(p, dict)], total_pages


# ─── Produit Mobilax → ligne de prix ────────────────────────────

_CLES_PRIX = ("price_ht", "priceHt", "prix_ht", "price", "unit_price", "price_without_tax", "prix", "prices")
_CLES_PRIX_INTERNES = ("price_ht", "ht", "unit_price", "unit", "price", "value", "amount", "prix")
# Produits qui ne sont pas des pièces (début du nom ou de la catégorie, texte normalisé)
EXCLUS = ("verre trempe", "film ", "protection", "coque", "etui", "housse", "chargeur", "cable", "support",
          "outil", "adhesif", "sticker", "stylet", "batterie externe", "ecouteurs", "casque", "kit ", "tiroir",
          "pochette", "bumper", "antichoc", "boite", "sachet", "pince", "ventouse", "spatule", "tournevis")


def _nombre(v) -> Optional[Decimal]:
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float, Decimal)):
        try:
            return Decimal(str(v))
        except InvalidOperation:
            return None
    s = str(v).strip().replace(" ", "").replace("\xa0", "").replace(" ", "").replace("€", "").replace(",", ".")
    if not s:
        return None
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


def _quantite(x) -> Decimal:
    if isinstance(x, dict):
        q = x.get("quantity")
        if q is None:
            q = x.get("qty", x.get("from"))
        n = _nombre(q)
        return n if n is not None else Decimal(1)
    return Decimal(1)


def _prix_dans(v, profondeur: int = 0) -> Optional[Decimal]:
    if profondeur > 3:
        return None
    n = _nombre(v)
    if n is not None:
        return n
    if isinstance(v, dict):
        for cle in _CLES_PRIX_INTERNES:
            if cle in v:
                n = _prix_dans(v[cle], profondeur + 1)
                if n is not None:
                    return n
        return None
    if isinstance(v, list) and v:
        # Paliers dégressifs : le prix de la plus petite quantité
        for x in sorted(v, key=_quantite):
            n = _prix_dans(x, profondeur + 1)
            if n is not None:
                return n
    return None


def _prix_palier(paliers, palier: dict) -> Optional[Decimal]:
    """Prix du palier du compte dans la liste `prices` de Mobilax
    ([{id, name: Bronze|Silver|Gold|Platinum|Diamond, rate, price, ca_min, ca_max}, …])."""
    if not palier or not isinstance(paliers, list):
        return None
    ident, nom = palier.get("id"), normaliser(palier.get("nom") or "")
    for x in paliers:
        if not isinstance(x, dict) or "quantity" in x:        # paliers de quantité : autre logique
            continue
        meme_id = ident is not None and _nombre(x.get("id")) == Decimal(ident)
        meme_nom = bool(nom) and normaliser(str(x.get("name") or "")) == nom
        if meme_id or meme_nom:
            return _prix_dans(x, 1)
    return None


def prix_produit(p: dict, palier: dict = None) -> Optional[Decimal]:
    """Prix HT d'un produit : celui du palier du compte (liste prices) quand il est connu — le champ
    price est le prix de base (Bronze) —, sinon price / price_ht… ; None s'il n'en montre aucun."""
    n = _prix_palier(p.get("prices"), palier)
    if n is not None and 0 < n <= import_prix._MAX_HT:
        return n.quantize(Decimal("0.01"))
    for cle in _CLES_PRIX:
        if cle in p and p[cle] not in (None, "", [], {}):
            n = _prix_dans(p[cle])
            if n is not None and 0 < n <= import_prix._MAX_HT:
                return n.quantize(Decimal("0.01"))
    return None


def produit_pertinent(p: dict) -> bool:
    """Pièce détachée active (ni protection, ni accessoire, ni outil)."""
    if not isinstance(p, dict) or p.get("active") is False:
        return False
    nom = normaliser(p.get("title_name") or p.get("name") or "")
    if not nom:
        return False
    cat = normaliser(p.get("category_name") or "")
    if any(m in nom for m in IGNORES):
        return False
    return not any(nom.startswith(m) or (cat and cat.startswith(m)) for m in EXCLUS)


# Noms Mobilax → désignation lisible par le moteur d'import (services/import_prix) : codes de
# pièce constructeur (0235AKJJ, HB496590EIW, EB-BA166ASE, GH82-28077A, SM-A525F), mégapixels,
# « (PIEC) », « Premium » (gamme compatible), coloris en fin de nom.
_CODE_PIECE = re.compile(r"\b(?=[A-Z0-9-]*[0-9])(?=[A-Z0-9-]*[A-Z])[A-Z0-9][A-Z0-9-]{6,}\b")
_MEGAPIXELS = re.compile(r"\b\d{1,3}\s?MP\b", re.IGNORECASE)
_PAREN_BRUIT = re.compile(r"\((?:PIEC|OEM\s*PULLED|PULLED|BULK|PA|SP)\)", re.IGNORECASE)
_PREMIUM = re.compile(r"\bPremium\b", re.IGNORECASE)
_ET_BATTERIE = re.compile(r"\bet\s+batterie\b", re.IGNORECASE)
_COULEURS_FIN = {
    "noir", "noire", "blanc", "blanche", "bleu", "bleue", "rouge", "vert", "verte", "violet", "violette", "rose", "gris",
    "grise", "jaune", "argent", "argente", "dore", "doree", "or", "black", "white", "blue", "red", "green", "purple",
    "pink", "grey", "gray", "yellow", "silver", "gold", "graphite", "minuit", "midnight", "moonlight", "emeraude",
    "emerald", "cyan", "ocean", "lavande", "lavender", "titane", "titanium", "sable", "corail", "coral", "ambre",
    "mauve", "indigo", "turquoise", "menthe", "mint", "lilas", "lilac", "pourpre", "bordeaux", "beige", "marine",
    "navy", "creme", "cream", "starlight", "lumiere", "stellaire", "sierra", "alpine", "desert", "natural", "naturel",
    "spatial", "space", "orange", "bronze", "platine", "obsidienne", "obsidian", "porcelaine", "porcelain", "jade",
    "perle", "pearl", "clair", "claire", "fonce", "foncee", "dark", "light", "mat", "brillant", "nuit", "night",
    "neige", "snow", "glacier", "aurora", "phantom", "mystic", "prism", "cloud", "cosmic", "sunset", "sky", "ice",
    "aqua", "iris", "peony", "hazel", "lemongrass", "wintergreen", "nebula", "lune", "moon", "awesome", "metal",
    "metallique", "ciel", "sombre", "profond", "deep", "pastel", "givre", "givree", "frost", "titanium", "sand",
}


# Vocabulaire Mobilax → celui de la grille (import_prix._PIECES) : « Cache Arrière » = vitre arrière,
# « Lentille » seule = vitre de caméra arrière, « Caméra Visio » = caméra avant
_VOCABULAIRE = (
    (re.compile(r"\bCache Arri[èe]re\b", re.IGNORECASE), "Vitre Arrière"),
    (re.compile(r"\bCam[ée]ra Visio\b", re.IGNORECASE), "Caméra avant"),
    (re.compile(r"\bLentille\b(?![^|]*\bcam[ée]ra\b)", re.IGNORECASE), "Lentille caméra arrière"),
)
# Caméras secondaires et autres pièces que la grille ne suit pas : jamais prises pour la caméra
# arrière (elles sont moins chères, la variante la moins chère l'emporterait)
IGNORES = ("ultra grand angle", "grand angle", "teleobjectif", "macro", "profondeur", "periscope")


def designation_import(nom: str) -> str:
    """Nom Mobilax épuré pour la correspondance avec la grille (le nom d'origine n'est pas gardé)."""
    s = " ".join(str(nom or "").split())
    s = _PAREN_BRUIT.sub(" ", s)
    s = _CODE_PIECE.sub(" ", s)
    s = _MEGAPIXELS.sub(" ", s)
    s = _ET_BATTERIE.sub(" ", s)
    s = _PREMIUM.sub("Compatible", s)
    for motif, remplacement in _VOCABULAIRE:
        s = motif.sub(remplacement, s)
    mots = s.split()
    while len(mots) > 2 and normaliser(mots[-1]) in _COULEURS_FIN:
        mots.pop()
    return " ".join(mots)


# ─── Catégorie Mobilax → pièce et qualité de la grille ──────────
# Chaque nom Mobilax commence par sa catégorie (« Ecran Tactile Soft Oled Apple iPhone 13 (IC
# Removable) Noir », category_name = « Ecran Tactile Soft Oled ») : la catégorie dit la pièce et la
# qualité, le reste du nom le modèle (marque comprise) suivi d'un suffixe technique, de codes
# constructeur et du coloris. Lire la catégorie est bien plus sûr que deviner dans le nom.

# (début de la catégorie normalisée, type de pièce de la grille) — le premier motif qui convient
CATEGORIES_PIECES = (
    ("ecran", "Ecran"), ("bloc ecran", "Ecran"), ("batterie", "Batterie"),
    ("connecteur de charge", "Connecteur de charge"), ("cache arriere", "Vitre arriere"),
    ("vitre arriere", "Vitre arriere"), ("appareil photo", "Camera arriere"), ("camera arriere", "Camera arriere"),
    ("camera principale", "Camera arriere"), ("camera visio", "Camera avant"), ("camera avant", "Camera avant"),
    ("haut parleur", "Haut-parleur"), ("ecouteur interne", "Ecouteur interne"),
    ("lentille", "Vitre camera arriere"), ("vitre camera", "Vitre camera arriere"),
    ("nappe power", "Bouton power"), ("nappe bouton power", "Bouton power"), ("nappe boutons power", "Bouton power"),
)
# Catégories de ces familles qui ne sont pas la pièce suivie : écran externe d'un pliant, batterie
# secondaire ou sans BMS, port à souder, nappes, protections…
# Catégories gardées bien qu'elles citent un mot exclu : la nappe du bouton power est une pièce suivie
CATEGORIES_GARDEES = ("nappe power", "nappe bouton power", "nappe boutons power")
CATEGORIES_EXCLUES = ("externe", "secondaire", "sans bms", "a souder", "magsafe", "nappe", "protection", "adhesif",
                      "film", "support", "outil", "moule")
# Qualité d'après la catégorie, du plus précis au plus général (« Original Refurb » = reconditionné)
QUALITES_CATEGORIE = (
    ("soft oled", "Soft OLED"), ("hard oled", "OLED"), ("amoled", "OLED"), ("oled", "OLED"),
    ("incell", "Incell"), ("in cell", "Incell"), ("ltps", "Incell"),
    ("refurb", "Reconditionnee"), ("pulled", "Reconditionnee"), ("reconditionne", "Reconditionnee"),
    ("tft", "LCD"), ("lcd", "LCD"),
    ("service pack", "Original"), ("original", "Original"),
    ("oem", "Compatible"), ("premium", "Compatible"), ("aftermarket", "Compatible"), ("compatible", "Compatible"),
)


def piece_categorie(category_name) -> Optional[tuple]:
    """(type de pièce de la grille, qualité ou None) d'après la catégorie Mobilax ; None si la
    catégorie n'est pas une pièce suivie par la grille."""
    c = normaliser(category_name or "")
    if not c:
        return None
    if not c.startswith(CATEGORIES_GARDEES) and any(m in c for m in CATEGORIES_EXCLUES):
        return None
    for motif, piece in CATEGORIES_PIECES:
        if c.startswith(motif):
            q = next((v for m, v in QUALITES_CATEGORIE if m in c), None)
            # « Ecran Tactile » sans autre mention : l'écran de rechange ordinaire de Mobilax
            return piece, (q or "Compatible") if piece == "Ecran" else q
    return None


_PAREN = re.compile(r"\(([^()]*)\)")
_ETOILES = re.compile(r"\*[^*]*\*")                       # « *1 An de Garantie Toute Casse* »
_GRADE = re.compile(r"\bGrade\s*[A-D]\+*", re.IGNORECASE)   # « Grade A++ »
_CODE_NUM = re.compile(r"(?<![\w-])\d{2,}-\d{2,}(?:-\d+)*(?![\w-])")   # 661-10851 (avec lettres : _CODE_PIECE)
_COUPURES = {"avec", "sans", "pour"}                        # « P20 Lite Avec Jack et Micro » : fin du modèle
_CODE_COURT = re.compile(r"^(?=.*\d)(?=.*[A-Z])(?:[A-Z]+\d+[A-Z]+\d+|[A-Z]\d{2}[A-Z]{2}|[A-Z]{2}\d[A-Z]\d|[A-Z]{3,}\d{2,})[A-Z0-9]*$")
_CODE_LONG = re.compile(r"\b\d{7,}\b")                     # 2011100371, 621035000148 (OnePlus, Oppo…)
_CODE_SAMSUNG = re.compile(r"\b[A-Z]\d{3}[A-Z]{0,2}\b")      # A057, A145F, M127 après « Galaxy A05s » (jamais un modèle)
# Mots de fin de nom qui ne font pas partie du modèle (puce de batterie, diagnostic, côté…)
_BRUIT_FIN = {"ti", "genuine", "diagnostic", "universal", "wifi", "wi-fi", "cellular", "gauche", "droit", "droite",
              "inferieur", "superieur", "keyboard", "backlight", "usb", "lvds", "partner-pack", "neuf", "sans",
              "avec", "nappe", "without", "part", "parts", "version", "us", "eu", "qwerty", "azerty", "a", "b", "c"}
# Mots qui peuvent précéder la marque dans le reste du nom (« Diagnostic Apple iPhone 12 Mini »)
_BRUIT_DEBUT = {"diagnostic", "premium", "plus", "original", "originale", "oem", "pulled", "refurb", "refurbished",
                "aftermarket", "sans", "avec", "chassis", "complet", "complete", "et", "batterie", "lcd", "tactile",
                "oled", "soft", "hard", "incell", "fhd", "hd", "hd+", "ltps", "partner-pack", "magsafe", "piec", "pour"}
_GAMMES_TETE = {"iphone", "ipad", "macbook", "galaxy", "redmi", "poco", "pixel", "moto", "nord", "mi"}
# Coloris supplémentaires rencontrés chez Mobilax (fin de nom)
_COULEURS_FIN.update({
    "sideral", "siderale", "volcanique", "porcelaine", "neige", "obsidienne", "vif", "vive", "cosmique", "cosmos",
    "aloe", "charbon", "citron", "lagon", "sauge", "sage", "chalk", "seafoam", "licorice", "quartz", "mojito",
    "amande", "oh", "so", "sorta", "kinda", "almost", "bay", "lemon", "lime", "olive", "ivory", "ivoire", "cuivre",
    "copper", "champagne", "rubis", "ruby", "saphir", "sapphire", "onyx", "crystal", "cristal", "nacre", "nacree",
    "peche", "peach", "zinc", "acier", "steel", "smoke", "fume", "fumee", "vert", "blush", "bronze", "mauve",
    "scarlet", "carmin", "pacific", "atlantic", "nordic", "prune", "plum", "violet", "cobalt", "azur", "azure",
    "aube", "dawn", "dusk", "crepuscule", "jet", "slate", "ardoise", "ebony", "ebene", "noir", "noire", "white",
    "stone", "pierre", "sand", "sable", "cream", "linen", "lin", "oat", "beige", "wintergreen",
})


def modele_produit(p: dict) -> str:
    """Modèle (marque comprise) lu dans le nom Mobilax privé de sa catégorie, du suffixe technique
    (« (IC Removable) », « (TI 3630mAh) »), des codes constructeur, des mégapixels, du coloris et des
    mots de bruit finaux. Les parenthèses utiles (année, génération, 5G, numéro) restent."""
    from app.api import grille   # import différé : grille importe services/prix
    nom = " ".join(str(p.get("title_name") or p.get("name") or "").split())
    cat = " ".join(str(p.get("category_name") or "").split())
    reste = nom[len(cat):] if cat and nom.lower().startswith(cat.lower()) else nom
    suffixe = " ".join(str(p.get("suffix") or "").split())
    if suffixe and suffixe in reste:
        reste = reste.replace(suffixe, " ", 1)
    reste = _ETOILES.sub(" ", reste)
    reste = _GRADE.sub(" ", reste)
    reste = _PAREN.sub(lambda m: f" ({m.group(1).strip()}) " if grille._garder_parenthese(m.group(1)) else " ", reste)
    reste = _CODE_PIECE.sub(" ", reste)
    reste = _CODE_NUM.sub(" ", reste)
    reste = _CODE_LONG.sub(" ", reste)
    if "galaxy" in reste.lower():
        reste = _CODE_SAMSUNG.sub(" ", reste)
    reste = _MEGAPIXELS.sub(" ", reste)
    mots = [m for m in reste.split() if any(ch.isalnum() for ch in m)]
    coupe = next((i for i, m in enumerate(mots) if i and normaliser(m) in _COUPURES), None)
    if coupe:
        mots = mots[:coupe]
    # Bruit avant la marque : coupé jusqu'à la marque ou la gamme si l'une des cinq premiers mots l'est
    bas = [normaliser(m) for m in mots[:5]]
    debut = next((i for i, b in enumerate(bas) if b in grille._MARQUES_CONNUES or b in grille._ALIAS_MARQUE
                  or b in _GAMMES_TETE), None)
    if debut:
        mots = mots[debut:]
    else:
        while len(mots) > 1 and normaliser(mots[0]) in _BRUIT_DEBUT:
            mots.pop(0)
    while len(mots) > 1:
        bas = normaliser(mots[-1])
        if bas in _COULEURS_FIN or bas in _BRUIT_FIN or (_CODE_COURT.match(mots[-1]) and not re.fullmatch(r"[A-Z]\d{4}", mots[-1])):
            mots.pop()
        else:
            break
    return " ".join(mots)


def segments_marques(modele: str) -> list:
    """Un nom qui cite plusieurs marques (« Honor 20/8X Huawei Mate 20 Lite/Nova 5T », « Huawei Y6p
    Honor 9A ») : un morceau par marque, chacun commençant par la sienne."""
    from app.api import grille
    mots = modele.split()
    debuts = [i for i, m in enumerate(mots) if i and normaliser(m) in grille._MARQUES_CONNUES
              and normaliser(m) not in grille._ALIAS_MARQUE]
    if not debuts or not mots or normaliser(mots[0]) not in grille._MARQUES_CONNUES:
        return [modele]
    bornes = [0] + debuts + [len(mots)]
    return [" ".join(mots[a:b]) for a, b in zip(bornes, bornes[1:]) if b > a]


def en_stock_produit(p: dict):
    """True / False d'après la quantité Mobilax (et l'alerte de disponibilité), None si inconnu."""
    q = _nombre(p.get("quantity")) if isinstance(p, dict) else None
    if q is None:
        return None if not (isinstance(p, dict) and p.get("is_availibility_alert") is True) else False
    return q > 0


def _url_produit(p: dict):
    """Page du produit chez Mobilax quand l'API donne une adresse complète (un simple slug ne suffit pas)."""
    u = str(p.get("url") or "").strip()
    return u[:300] if u.startswith("https://") and "mobilax" in u else None


def lignes_produit(p: dict, palier: dict = None, sans_prix: bool = False) -> list:
    """Lignes d'import d'un produit au prix du palier du compte : [{reference, designation, modele,
    type_piece, qualite, prix_ht, en_stock, url}] — une ligne par marque citée dans le nom (même
    référence et même prix), aucune pour une catégorie qui n'est pas une pièce suivie (nappe, protection…).
    Sans prix : rien, sauf sans_prix=True (ligne à prix_ht None : produit vu mais sans prix, rupture…).
    Pièce et qualité viennent de la catégorie Mobilax, le modèle du nom ; sans catégorie connue, les
    colonnes restent vides et le moteur d'import lit la désignation."""
    ht = prix_produit(p, palier)
    if ht is None and not sans_prix:
        return []
    nom = p.get("title_name") or p.get("name") or ""
    cat = p.get("category_name") or ""
    pq = piece_categorie(cat)
    if pq is None and cat and any(normaliser(cat).startswith(m) for m, _ in CATEGORIES_PIECES):
        return []            # famille suivie mais variante écartée (écran externe, batterie secondaire…)
    ref = str(p.get("ean13") or p.get("reference") or p.get("sku") or "").strip()
    if not ref and p.get("id"):
        ref = f"MX{p['id']}"
    base = {"reference": ref[:60], "designation": designation_import(nom)[:250],
            "type_piece": pq[0] if pq else "", "qualite": (pq[1] or "") if pq else "", "prix_ht": ht,
            "en_stock": en_stock_produit(p), "url": _url_produit(p)}
    modeles = segments_marques(modele_produit(p)) if pq else [""]
    return [{**base, "modele": m[:250]} for m in modeles]


def ligne_produit(p: dict, palier: dict = None) -> Optional[dict]:
    """Première ligne de lignes_produit (None sans prix ni pièce suivie)."""
    lignes = lignes_produit(p, palier)
    return lignes[0] if lignes else None


COLONNES_CSV = ("Référence", "Désignation", "Marque", "Modèle", "Type de pièce", "Qualité", "Prix HT")


def csv_lignes(lignes: list) -> bytes:
    """Fichier CSV (« ; », décimales à virgule) lu par import_prix comme un fichier fournisseur :
    colonnes Modèle / Type de pièce / Qualité remplies quand la catégorie est connue."""
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";", lineterminator="\n")
    w.writerow(COLONNES_CSV)
    for l in lignes:
        w.writerow([l["reference"], l["designation"], l.get("marque") or "", l.get("modele") or "",
                    l.get("type_piece") or "", l.get("qualite") or "", str(l["prix_ht"]).replace(".", ",")])
    return buf.getvalue().encode("utf-8-sig")


# ─── Modèles à chercher ─────────────────────────────────────────

def requete_modele(marque, modele) -> str:
    """Texte cherché chez Mobilax : le modèle seul s'il porte sa gamme (« iPhone 13 »,
    « Galaxy A52 »), sinon « marque modèle » (« Oppo Reno 10 »). Un iPad est cherché sous son nom
    canonique (« iPad 7 », « iPad Pro 11 ») : « iPad 7 (2019) 10.2" » tel quel ne renvoie rien."""
    from app.api import grille   # import différé : grille importe services/prix
    modele = " ".join(str(modele or "").split())
    marque = " ".join(str(marque or "").split())
    if not modele:
        return ""
    ipads = requetes_ipad(modele)
    if ipads:
        return ipads[0]
    if grille.deviner_marque(modele) or not marque or normaliser(marque) in ("", "autre"):
        return modele
    return f"{marque} {modele}"


def libelle_ipad(cle: str) -> str:
    """« ipad air 6 11 » → « iPad Air 6 », « ipad pro 11 2021 » → « iPad Pro 11 », « ipad 7 » → « iPad 7 »."""
    parts = cle.split()
    if len(parts) >= 3 and parts[1] in ("air", "mini", "pro"):
        return f"iPad {parts[1].title()} {parts[2]}"
    return f"iPad {parts[1]}" if len(parts) >= 2 else "iPad"


def requetes_ipad(modele: str) -> list:
    """Recherches Mobilax d'un iPad de la grille : son nom canonique, puis une référence Apple quand le
    nom ne suffit pas (Pro, Air 6 et plus, iPad 11 : Mobilax les nomme par taille, puce et référence)."""
    cles = import_prix.cles_ipad(modele)
    if not cles:
        return []
    out = []
    for cle in sorted(cles):
        lib = libelle_ipad(cle)
        if lib not in out:
            out.append(lib)
        ligne = next((x for x in import_prix.IPADS if x[0] == cle), None)
        if ligne and ligne[6] and (ligne[1] == "pro" or (ligne[1] == "air" and ligne[2] >= 6) or cle == "ipad 11"):
            if ligne[6][0] not in out:
                out.append(ligne[6][0])
    return out


def requetes_pour(marque, modele) -> list:
    """Recherches d'un modèle de la grille : ses variantes (« iPhone 12/12 Pro » déplié) et, pour un
    iPad, le nom canonique et la référence."""
    from app.api import grille
    out = []
    ipads = requetes_ipad(modele)
    for q in ipads or [requete_modele(marque, v) for v in (grille.variantes(modele) or [modele])]:
        if q and normaliser(q) not in {normaliser(x) for x in out}:
            out.append(q)
    return out


def requetes_modeles(modeles) -> list:
    """Recherches distinctes (noms groupés « iPhone 12/12 Pro » dépliés), dans l'ordre."""
    vues, out = set(), []
    for marque, modele in modeles:
        for q in requetes_pour(marque, modele):
            k = normaliser(q)
            if k and k not in vues:
                vues.add(k)
                out.append(q)
    return out


# Recherche qui déborde (plus de pages que PAGES_MAX : iPhone, Galaxy S…) : les pièces se noient dans les
# coques ; une recherche par famille de pièce les retrouve (« Batterie Apple iPhone 13 » : 34 produits)
FAMILLES_REQUETES = ("Ecran", "Batterie", "Cache Arrière", "Nappe Power")
PAGES_FAMILLE = 2


def modeles_grille(cur) -> list:
    """(marque, modèle) des pièces fournisseur en vigueur et des iPad / MacBook actifs."""
    cur.execute("""
        SELECT DISTINCT marque, modele FROM tarifs
        WHERE obsolete IS NOT TRUE AND COALESCE(btrim(modele), '') <> ''
        UNION
        SELECT 'Apple', modele FROM tarifs_apple_devices
        WHERE actif IS NOT FALSE AND obsolete IS NOT TRUE AND COALESCE(btrim(modele), '') <> ''
        ORDER BY 1, 2
    """)
    return [(r["marque"] or "", r["modele"]) for r in cur.fetchall() or []]


# ─── Choix automatique des lignes d'un aperçu ───────────────────

def _maintenant():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def remplacable(desc, regles=None, maintenant=None) -> bool:
    """Le prix actuel de la pièce n'est pas une référence — absent, estimé (prix_source
    estimation_…) ou périmé (plus vieux que la règle jours_perime) — : le prix réel du fournisseur
    le remplace sans validation. Un prix récent qui varie beaucoup reste proposé au gérant."""
    if not isinstance(desc, dict):
        return False
    ht = desc.get("ht")
    try:
        if ht is None or Decimal(str(ht)) <= 0:
            return True
    except InvalidOperation:
        return True
    if str(desc.get("prix_source") or "").lower().startswith("estimation"):
        return True
    maj = desc.get("prix_maj_le")
    if maj is None:
        return True
    if isinstance(maj, str):
        try:
            maj = datetime.fromisoformat(maj.replace("Z", ""))
        except ValueError:
            return True
    if getattr(maj, "tzinfo", None) is not None:
        maj = maj.astimezone(timezone.utc).replace(tzinfo=None)
    jours = int((regles or {}).get("jours_perime") or 180)
    return ((maintenant or _maintenant()) - maj).days > jours


def fournisseur_choisi(desc) -> Optional[str]:
    """Fournisseur imposé par le gérant pour la pièce (colonne fournisseur_choisi), None = moins-disant."""
    if not isinstance(desc, dict):
        return None
    f = " ".join(str(desc.get("fournisseur_choisi") or "").split())
    return f or None


def moins_cher_ailleurs(desc, ht, fournisseur, regles=None, maintenant=None) -> bool:
    """Le prix de référence de la pièce vient d'un AUTRE fournisseur et n'est pas plus cher que `ht` :
    la pièce reste chez le moins-disant (un prix remplaçable — estimé, périmé — ne protège rien).
    Jamais quand le gérant a choisi ce fournisseur pour la pièce."""
    if not fournisseur or not isinstance(desc, dict) or not desc.get("fournisseur"):
        return False
    choisi = fournisseur_choisi(desc)
    if choisi and normaliser(choisi) == normaliser(fournisseur):
        return False
    if normaliser(desc["fournisseur"]) == normaliser(fournisseur) or remplacable(desc, regles, maintenant):
        return False
    try:
        return Decimal(str(desc.get("ht"))) <= Decimal(str(ht))
    except (InvalidOperation, TypeError):
        return False


def planifier(ap: dict, descs: dict = None, regles: dict = None, maintenant=None, fournisseur: str = None) -> dict:
    """Parmi les lignes reconnues de l'aperçu (import_prix.apercu) : lignes à appliquer,
    propositions à créer (grosse variation d'un prix de référence), pièces laissées (verrou,
    obsolète, variante plus chère, autre fournisseur moins cher). descs : prix.decrire_tarifs des
    pièces reconnues — une pièce au prix absent, estimé ou périmé (`remplacable`) est appliquée
    même avec une grosse variation (comptée dans `remplaces`). fournisseur : celui des lignes
    (« Mobilax », « Utopya ») — une pièce dont le prix de référence vient d'un autre fournisseur
    moins cher ou égal est laissée (`plus_cher_ailleurs`) ; moins cher ici → appliqué (ou proposé).

    Une pièce dont le gérant a choisi l'autre fournisseur (fournisseur_choisi) n'est jamais touchée
    (`autre_fournisseur_choisi`) ; celle où il a choisi celui-ci est appliquée même plus chère.

    → {lignes: [n], propositions: [{cle, ht, label}], verrouillees, obsoletes, variantes, a_valider, remplaces,
       plus_cher_ailleurs, autre_fournisseur_choisi}
    """
    par_n = {}
    for rec in ap.get("reconnues") or []:
        par_n.setdefault(rec["n"], []).append(rec)
    vise = {}   # cle → HT retenu
    descs = descs or {}
    out = {"lignes": [], "propositions": [], "verrouillees": 0, "obsoletes": 0, "variantes": 0, "a_valider": 0,
           "remplaces": 0, "plus_cher_ailleurs": 0, "autre_fournisseur_choisi": 0}
    # Prix croissant : pour une pièce vendue en plusieurs variantes (coloris…), la moins chère
    for n, recs in sorted(par_n.items(), key=lambda kv: (Decimal(str(kv[1][0]["nouveau_ht"])), kv[0])):
        hts = {r["cle"]: Decimal(str(r["nouveau_ht"])) for r in recs}
        if all(c in vise for c in hts):
            if any(vise[c] != ht for c, ht in hts.items()):
                out["variantes"] += 1
            continue
        if any(c in vise and vise[c] != ht for c, ht in hts.items()):
            out["variantes"] += 1
            continue
        vise.update(hts)
        if any(r["verrou"] for r in recs):
            out["verrouillees"] += 1
            continue
        if any(r["obsolete"] for r in recs):
            out["obsoletes"] += 1
            continue
        if fournisseur and any(fournisseur_choisi(descs.get(r["cle"]))
                               and normaliser(fournisseur_choisi(descs.get(r["cle"]))) != normaliser(fournisseur)
                               for r in recs):
            out["autre_fournisseur_choisi"] += 1
            continue
        if any(moins_cher_ailleurs(descs.get(r["cle"]), hts[r["cle"]], fournisseur, regles, maintenant) for r in recs):
            out["plus_cher_ailleurs"] += 1
            continue
        alertes = set()
        for r in recs:
            alertes |= set(r.get("alertes") or [])
        if "variation" in alertes:
            if all(remplacable(descs.get(r["cle"]), regles, maintenant) for r in recs):
                out["remplaces"] += 1
                out["lignes"].append(n)
                continue
            out["a_valider"] += 1
            out["propositions"] += [{"cle": r["cle"], "ht": str(hts[r["cle"]]), "label": r["label"]} for r in recs]
        else:
            out["lignes"].append(n)
    out["lignes"].sort()
    return out


_COMPTES = ("lignes", "reconnues", "non_reconnues", "inconnues", "verrouillees", "obsoletes", "variantes",
            "a_valider", "remplaces", "plus_cher_ailleurs", "autre_fournisseur_choisi", "modifies", "confirmes",
            "propositions", "propositions_fermees")


def _fermer_propositions(cur, lot_id: str, auteur: str = AUTEUR) -> int:
    """Propositions en attente des pièces dont le coût HT vient d'être écrit par ce lot, au même prix
    (à 1 € près) : acceptées par le passage — plus rien à valider pour ces pièces. Une annulation du
    lot les rouvre (prix._rouvrir_propositions)."""
    cur.execute("""
        UPDATE tarifs_propositions AS p
           SET statut = 'acceptee', traite_le = NOW(), traite_par = %s, lot_id = %s
          FROM tarifs_historique AS h
         WHERE p.statut = 'en_attente' AND h.lot_id = %s
           AND h.colonne IN ('prix_fournisseur_ht', 'ecran_prix_ht', 'batterie_prix_ht')
           AND p.tarif_cle = CASE WHEN h.table_nom = 'tarifs' THEN 'tarifs:' || h.ligne_id
                                  ELSE h.table_nom || ':' || h.ligne_id || ':' || split_part(h.colonne, '_', 1) END
           AND h.nouveau IS NOT NULL AND abs(p.nouveau_ht - h.nouveau) <= 1
    """, (auteur, lot_id, lot_id))
    return max(int(cur.rowcount or 0), 0)


def infos_lignes(lignes) -> dict:
    """{référence: {url, en_stock}} des lignes d'un fournisseur, pour la grille comparative."""
    out = {}
    for l in lignes or ():
        ref = str(l.get("reference") or "").strip()
        if ref and ref not in out:
            out[ref] = {"url": l.get("url"), "en_stock": l.get("en_stock")}
    return out


def _importer(cur, cible: str, contenu: bytes, nom_fichier: str, r: dict, fournisseur: str = FOURNISSEUR,
              auteur: str = AUTEUR, source: str = "mobilax", infos: dict = None) -> dict:
    """Aperçu puis application automatique sur une cible ; propositions pour les grosses variations.
    fournisseur / auteur / source : Mobilax par défaut, « Utopya » pour la collecte (services/utopya).
    Chaque pièce reconnue garde le prix de CE fournisseur dans tarifs_fournisseurs_prix (grille
    comparative), qu'il soit retenu ou non ; infos : {référence: {url, en_stock}} (infos_lignes)."""
    res = {"cible": cible, "import_id": None, "lot_id": None, "erreur": None, **{k: 0 for k in _COMPTES}}
    try:
        ap = import_prix.apercu(cur, nom_fichier, contenu, fournisseur, cible, r=r, par=auteur)
    except import_prix.ImportErreur as e:
        res["erreur"] = str(e)
        return res
    cles = sorted({rec["cle"] for rec in ap.get("reconnues") or []})
    descs = prix.decrire_tarifs(cur, cles, r) if cles else {}
    if cles:
        prix.enregistrer_prix_fournisseur(cur, fournisseur, source, ap.get("reconnues") or [], infos or {})
    plan = planifier(ap, descs, r, fournisseur=fournisseur)
    resume = ap["resume"]
    res.update(import_id=ap["import_id"], lignes=resume["lignes"], reconnues=resume["pieces_reconnues"],
               non_reconnues=resume["non_reconnues"], inconnues=resume["nouvelles"],
               **{k: plan[k] for k in ("verrouillees", "obsoletes", "variantes", "a_valider", "remplaces",
                                       "plus_cher_ailleurs", "autre_fournisseur_choisi")})
    res["_cles"] = cles   # pour le diagnostic du passage (retiré du résumé enregistré)
    if plan["lignes"]:
        app = import_prix.appliquer(cur, ap["import_id"], {"lignes": plan["lignes"], "ignorer_invalides": True},
                                    auteur, r=r)
        res.update(modifies=app["modifies"], confirmes=app["confirmes"], lot_id=app["lot_id"])
        if app.get("lot_id"):
            res["propositions_fermees"] = _fermer_propositions(cur, app["lot_id"], auteur)
    else:
        cur.execute("UPDATE tarifs_imports SET statut = 'synchro' WHERE id = %s", (ap["import_id"],))
    for p in plan["propositions"]:
        if prix.creer_proposition(cur, p["cle"], p["ht"], source, auteur) is not None:
            res["propositions"] += 1
    # Le détail des lignes (gros JSON) ne sert qu'à l'application : seuls le résumé et les données
    # d'annulation du lot restent
    cur.execute("UPDATE tarifs_imports SET resume = resume - 'donnees' WHERE id = %s", (ap["import_id"],))
    return res


# ─── Diagnostic : pièces de la grille sans prix Mobilax ─────────

_RAISONS_MODELES = {
    "aucun_produit": "{f} ne renvoie aucun produit pour ce modèle",
    "piece_absente": "{f} a des produits pour ce modèle, mais pas cette pièce",
    "sans_prix_fournisseur": "{f} a la pièce, mais sans prix pour votre compte (rupture ou produit retiré)",
    "non_reconnue": "Des produits {f} ressemblent, sans être rattachés à la pièce (nom à vérifier)",
    "non_cherchee": "Modèle non cherché (passage incomplet)",
}


def raisons_pour(fournisseur: str = FOURNISSEUR) -> dict:
    return {k: v.format(f=fournisseur) for k, v in _RAISONS_MODELES.items()}


RAISONS = raisons_pour(FOURNISSEUR)
_FAMILLES = {"vitre camera": ("vitre camera", "lentille", "verre camera"),
             "vitre arriere": ("vitre arriere", "cache arriere", "face arriere", "back cover", "coque arriere"),
             "bouton power": ("bouton power", "nappe power", "power on", "on/off", "on off", "allumage"),
             "ecran": ("ecran", "lcd", "oled", "dalle", "vitre tactile"), "batterie": ("batterie", "battery"),
             "connecteur": ("connecteur", "port de charge", "nappe de charge", "dock")}


def famille_piece(type_piece) -> str:
    t = normaliser(type_piece or "")
    for f, mots in _FAMILLES.items():       # familles à deux mots d'abord (« vitre arriere » avant « vitre »)
        if t.startswith(f) or any(t.startswith(m) for m in mots):
            return f
    return t.split(" ")[0] if t else ""


def _nom_produit(p) -> str:
    return " ".join(str(p.get("title_name") or p.get("name") or "").split())


def requetes_par_modele(modeles) -> dict:
    """{(marque, modèle): [requêtes]} — les mêmes requêtes que requetes_modeles, par modèle."""
    return {(marque, modele): requetes_pour(marque, modele) for marque, modele in modeles or ()}


def _pieces_grille(cur) -> list:
    """Pièces fournisseur en vigueur : {cle, marque, modele, type_piece, qualite}."""
    cur.execute("SELECT id, marque, modele, type_piece, qualite FROM tarifs WHERE obsolete IS NOT TRUE "
                "ORDER BY marque, modele, id")
    out = [{"cle": prix.tarif_cle("tarifs", r["id"]), "marque": r["marque"] or "", "modele": r["modele"] or "",
            "type_piece": r["type_piece"] or "", "qualite": r["qualite"]} for r in cur.fetchall() or []]
    cur.execute("SELECT id, modele FROM tarifs_apple_devices WHERE actif IS NOT FALSE AND obsolete IS NOT TRUE "
                "ORDER BY modele, id")
    for r in cur.fetchall() or []:
        for piece in ("ecran", "batterie"):
            out.append({"cle": prix.tarif_cle("tarifs_apple_devices", r["id"], piece), "marque": "Apple",
                        "modele": r["modele"] or "", "type_piece": "Écran" if piece == "ecran" else "Batterie",
                        "qualite": None})
    return out


def diagnostic_pieces(pieces, produits, reconnues, modeles=None, palier=None, cherchees=None, maintenant=None,
                      sans_prix=None) -> dict:
    """Pièces de la grille restées sans prix après un passage : raison (RAISONS) et jusqu'à trois
    produits Mobilax de la même recherche qui ressemblent (même famille de pièce).

    pieces : _pieces_grille ; produits : ceux du passage, chacun marqué de sa recherche (_q) ;
    reconnues : clés des pièces qui ont reçu une ligne ; modeles : (marque, modèle) cherchés ;
    cherchees : requêtes réellement envoyées (passage incomplet) ; sans_prix : {cle: [lignes]} des
    pièces qu'un produit vu SANS prix désigne (rattacher_sans_prix) → raison sans_prix_fournisseur.
    → {le, n, par_raison, pieces: [{cle, marque, modele, type_piece, qualite, raison, candidats}], tronque}
    """
    par_q = {}
    for p in produits or []:
        par_q.setdefault(normaliser(p.get("_q") or ""), []).append(p)
    requetes = requetes_par_modele(modeles) if modeles is not None else {}
    reconnues = set(reconnues or ())
    sans_prix = sans_prix or {}
    faites = {normaliser(q) for q in cherchees} if cherchees is not None else None
    out, par_raison = [], {k: 0 for k in RAISONS}
    for pc in pieces or []:
        if pc["cle"] in reconnues:
            continue
        qs = requetes.get((pc["marque"], pc["modele"]))
        if qs is None:
            qs = requetes_pour(pc["marque"], pc["modele"])
        if pc["cle"] in sans_prix:
            raison = "sans_prix_fournisseur"
            candidats = [{"nom": str(l.get("designation") or "")[:160], "prix_ht": None, "sans_prix": True,
                          "en_stock": l.get("en_stock")} for l in sans_prix[pc["cle"]][:3]]
        elif faites is not None and not any(normaliser(q) in faites for q in qs):
            raison, candidats = "non_cherchee", []
        else:
            prods = [p for q in qs for p in par_q.get(normaliser(q), [])]
            fam = famille_piece(pc["type_piece"])
            mots = _FAMILLES.get(fam, (fam,) if fam else ())
            candidats = [p for p in prods
                         if produit_pertinent(p) and (any(m in normaliser(_nom_produit(p)) for m in mots)
                                                      or any(m in normaliser(p.get("category_name") or "") for m in mots))]
            raison = "aucun_produit" if not prods else "non_reconnue" if candidats else "piece_absente"
            candidats = [{"nom": _nom_produit(p)[:160],
                          "prix_ht": float(prix_produit(p, palier)) if prix_produit(p, palier) is not None else None}
                         for p in candidats[:3]]
        par_raison[raison] += 1
        if len(out) < DIAG_MAX_PIECES:
            out.append({
                "cle": pc["cle"], "marque": pc["marque"], "modele": pc["modele"], "type_piece": pc["type_piece"],
                "qualite": pc.get("qualite"), "raison": raison, "candidats": candidats,
            })
    n = sum(par_raison.values())
    return {"le": maintenant or _utc(), "n": n, "par_raison": par_raison, "pieces": out, "tronque": n > len(out)}


def rattacher_sans_prix(cur, lignes, fournisseur: str = FOURNISSEUR, cles_reconnues=None,
                        cibles=("tarifs", "tarifs_apple_devices")) -> dict:
    """Pièces de la grille que désignent des lignes SANS prix (produit vu chez le fournisseur, prix
    masqué ou rupture) : {cle: [lignes]}, par le même moteur que l'import. Les pièces non reconnues
    avec un prix dans ce passage sont notées dans tarifs_fournisseurs_prix (prix gardé, en_stock False) :
    la grille comparative montre « rupture » plutôt qu'un prix fantôme."""
    out = {}
    if not lignes:
        return out
    for cible in cibles:
        index = import_prix.Index(cur, cible)
        for l in lignes:
            ligne = {k: l.get(k) for k in ("reference", "designation", "modele", "type_piece", "qualite")}
            ligne["prix_ht"] = None
            try:
                trouves, _, _ = index.associer(ligne, import_prix.interpreter(ligne))
            except Exception:
                continue
            for e in trouves:
                out.setdefault(e["cle"], []).append(l)
    reconnues = set(cles_reconnues or ())
    a_noter = {cle: ls for cle, ls in out.items() if cle not in reconnues}
    if a_noter:
        prix.noter_vus_sans_prix(cur, fournisseur, a_noter)
    return out


def diagnostic(admin: bool = False, cur=None, cle: str = P_DIAG, fournisseur: str = FOURNISSEUR) -> dict:
    """Diagnostic du dernier passage (params MOBILAX_DIAGNOSTIC, ou la clé d'un autre fournisseur) ;
    prix HT des candidats pour l'admin."""
    d = _resume_lu(params_cache.get_params([cle], cur=cur)[cle]) or {}
    out = {"le": d.get("le"), "n": int(d.get("n") or 0), "par_raison": d.get("par_raison") or {},
           "pieces": list(d.get("pieces") or []), "tronque": bool(d.get("tronque")),
           "raisons": raisons_pour(fournisseur), "fournisseur": fournisseur}
    if not admin:
        out["pieces"] = [{**p, "candidats": [{"nom": c.get("nom")} for c in p.get("candidats") or []]}
                         for p in out["pieces"]]
    return out


# ─── Paramètres (jetons, état) ──────────────────────────────────

def _lire(cur, cles) -> dict:
    cur.execute("SELECT cle, valeur FROM params WHERE cle = ANY(%s)", (list(cles),))
    valeurs = {r["cle"]: r["valeur"] for r in cur.fetchall() or []}
    return {c: str(valeurs.get(c) or "").strip() for c in cles}


def _ecrire(cur, cle: str, valeur: str):
    cur.execute("""INSERT INTO params (cle, valeur) VALUES (%s, %s)
                   ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur""", (cle, valeur))


def _amorcer_depuis_env(cur, p: dict) -> dict:
    """Première connexion posée dans l'environnement (Railway) : copiée dans params."""
    env = os.getenv(ENV_REFRESH, "").strip()
    if not p.get(P_REFRESH) and _JETON_RE.fullmatch(env or ""):
        p[P_REFRESH] = env
        _ecrire(cur, P_REFRESH, env)
        idc = re.sub(r"\D", "", os.getenv(ENV_ID_CLIENT, ""))[:12]
        if idc:
            p[P_ID_CLIENT] = idc
            _ecrire(cur, P_ID_CLIENT, idc)
        params_cache.invalidate()
    return p


def _palier_lu(texte) -> dict:
    try:
        d = json.loads(texte or "")
    except ValueError:
        return {}
    return palier_compte({"category": {"id": d.get("id"), "name": d.get("nom")}}) if isinstance(d, dict) else {}


def _jetons(cur) -> dict:
    p = _amorcer_depuis_env(cur, _lire(cur, [P_REFRESH, P_TOKEN, P_ID_CLIENT, P_PALIER]))
    return {"refresh": p[P_REFRESH], "token": p[P_TOKEN], "id_client": p[P_ID_CLIENT], "palier": _palier_lu(p[P_PALIER])}


def _sauver_jetons(client: ClientMobilax):
    with get_cursor() as cur:
        _ecrire(cur, P_REFRESH, client.refresh)
        _ecrire(cur, P_TOKEN, client.token)
        if client.id_client:
            _ecrire(cur, P_ID_CLIENT, client.id_client)
        if client.palier:
            _ecrire(cur, P_PALIER, json.dumps(client.palier, ensure_ascii=False))
    params_cache.invalidate()


def _verrouiller(cur) -> bool:
    """Prend le verrou du passage (compare-and-set) : libre, ou tenu depuis plus de VERROU_MINUTES."""
    maintenant = _utc()
    limite = (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=VERROU_MINUTES)).strftime(_FMT)
    cur.execute("SELECT valeur FROM params WHERE cle = %s", (P_VERROU,))
    row = cur.fetchone()
    if row is None:
        cur.execute("INSERT INTO params (cle, valeur) VALUES (%s, %s) ON CONFLICT (cle) DO NOTHING", (P_VERROU, maintenant))
        return cur.rowcount == 1
    actuel = str(row["valeur"] or "").strip()
    if actuel and actuel > limite:
        return False
    cur.execute("UPDATE params SET valeur = %s WHERE cle = %s AND valeur IS NOT DISTINCT FROM %s",
                (maintenant, P_VERROU, row["valeur"]))
    return cur.rowcount == 1


def _liberer(cur):
    cur.execute("UPDATE params SET valeur = '' WHERE cle = %s", (P_VERROU,))


def _reserver_jour(cur, jour: str) -> bool:
    """Réserve l'essai du jour (compare-and-set) : False si déjà fait, en cours ailleurs ou
    ESSAIS_PAR_JOUR essais ratés."""
    cur.execute("SELECT valeur FROM params WHERE cle = %s", (P_JOUR,))
    row = cur.fetchone()
    actuel = str((row or {}).get("valeur") or "").strip()
    if actuel == jour:
        return False
    essais = 0
    if actuel.startswith(jour + "#"):
        try:
            essais = int(actuel.split("#", 1)[1])
        except ValueError:
            essais = ESSAIS_PAR_JOUR
    if essais >= ESSAIS_PAR_JOUR:
        return False
    nouveau = f"{jour}#{essais + 1}"
    if row is None:
        cur.execute("INSERT INTO params (cle, valeur) VALUES (%s, %s) ON CONFLICT (cle) DO NOTHING", (P_JOUR, nouveau))
    else:
        cur.execute("UPDATE params SET valeur = %s WHERE cle = %s AND valeur IS NOT DISTINCT FROM %s",
                    (nouveau, P_JOUR, row["valeur"]))
    return cur.rowcount == 1


def _vider_caches():
    params_cache.invalidate()
    try:
        from app.api import tarifs as tarifs_api
        tarifs_api._cache.clear()
    except Exception:
        pass


def _noter(resume: dict):
    """État durable du passage (relu par /etat et la santé des prix après un redéploiement)."""
    code = resume.get("code")
    connexion = "expiree" if code == "jeton_expire" else "" if code == "non_configure" else "ok"
    texte = json.dumps(resume, ensure_ascii=False, default=str)
    if len(texte) > RESUME_MAX:
        resume = {k: v for k, v in resume.items() if k not in ("champs", "imports")}
        texte = json.dumps(resume, ensure_ascii=False, default=str)[:RESUME_MAX]
    try:
        with get_cursor() as cur:
            _ecrire(cur, P_DERNIERE, resume.get("fin") or _utc())
            _ecrire(cur, P_OK, "1" if resume.get("ok") else "0")
            _ecrire(cur, P_RESUME, texte)
            _ecrire(cur, P_CONNEXION, connexion)
    except Exception as e:
        logger.error("Synchro Mobilax : état non enregistré (%s)", type(e).__name__)
    _vider_caches()


# ─── Passage complet ────────────────────────────────────────────

def _resume_vide() -> dict:
    return {"debut": _utc(), "fin": None, "ok": False, "erreur": None, "code": None, "requetes": 0, "modeles": 0,
            "recherches": 0, "erreurs_reseau": 0, "produits": 0, "produits_prix": 0, "produits_sans_prix": 0,
            "debordements": 0, "incomplet": False,
            "prix_masques": False, "lots": [], "imports": [], "champs": [], "sans_prix": None,
            **{k: 0 for k in _COMPTES}}


def synchroniser(transport=None, dormir=time.sleep) -> dict:
    """Un passage : jetons, recherche de chaque modèle, import automatique. Ne lève jamais :
    le résumé (ok, erreur, code, compteurs) est renvoyé et enregistré dans params."""
    resume, t0, client = _resume_vide(), time.monotonic(), None
    try:
        with get_cursor() as cur:
            jetons = _jetons(cur)
            modeles = modeles_grille(cur)
        if not jetons["refresh"]:
            raise ErreurJeton("Mobilax non connecté : collez vos jetons (Réparation smartphones → Mobilax).", "non_configure")
        requetes = requetes_modeles(modeles)
        resume["modeles"] = len(requetes)
        client = ClientMobilax(jetons["refresh"], jetons["token"], jetons["id_client"], transport=transport,
                               dormir=dormir, palier=jetons["palier"])
        client.rafraichir()
        try:                                   # id du compte et palier tarifaire (peut changer avec le CA)
            client.details_client()
        except ErreurMobilax:
            pass
        _sauver_jetons(client)
        resume["palier"] = client.palier.get("nom") or None
        produits, vus, erreurs_suite, cherchees = [], set(), 0, []
        for i, q in enumerate(requetes):
            if time.monotonic() - t0 > BUDGET_SECONDES:
                resume["incomplet"] = True
                break
            try:
                lus, deborde = client.produits_et_deborde(q)
                erreurs_suite = 0
                if deborde:
                    # iPhone, Galaxy S… : des centaines de coques noient les pièces ; une recherche par
                    # famille de pièce les retrouve, rattachée à la même requête de modèle (_q)
                    resume["debordements"] += 1
                    for fam in FAMILLES_REQUETES:
                        dormir(client.pause)
                        lus += client.produits(f"{fam} {q}", pages_max=PAGES_FAMILLE)
            except ErreurMobilax as e:
                erreurs_suite += 1
                resume["erreurs_reseau"] += 1
                if erreurs_suite >= ERREURS_MAX:
                    raise ErreurMobilax(f"{e} ({erreurs_suite} erreurs de suite)", e.code)
                continue
            resume["recherches"] += 1
            cherchees.append(q)
            for p in lus:
                cle = p.get("id") or p.get("ean13") or json.dumps(p, sort_keys=True, default=str)[:200]
                if cle not in vus:
                    vus.add(cle)
                    if isinstance(p, dict):
                        p["_q"] = q
                    produits.append(p)
            if i + 1 < len(requetes):
                dormir(client.pause)
        resume["requetes"] = client.requetes
        resume["produits"] = len(produits)
        resume["champs"] = sorted({k for p in produits[:50] for k in p if not str(k).startswith("_")})[:40]
        toutes = [l for p in produits if produit_pertinent(p) for l in lignes_produit(p, client.palier, sans_prix=True)]
        lignes = [l for l in toutes if l["prix_ht"] is not None]
        sans_prix = [l for l in toutes if l["prix_ht"] is None and l.get("type_piece")]
        resume["produits_prix"] = len(lignes)
        resume["produits_sans_prix"] = len(sans_prix)
        if produits and not lignes:
            resume["prix_masques"] = True
            raise ErreurMobilax("Mobilax ne renvoie aucun prix : activez l'affichage des prix sur votre compte "
                                "mobilax.fr (Mon compte), puis relancez la synchronisation.", "prix_masques")
        if lignes:
            jour = date.today().isoformat()
            apple = [l for l in lignes if any(m in normaliser(l["designation"]) for m in ("ipad", "macbook"))]
            infos = infos_lignes(lignes)
            with get_cursor() as cur:
                r = prix.regles(cur)
                resultats = [_importer(cur, "tarifs", csv_lignes(lignes), f"mobilax-{jour}.csv", r, infos=infos)]
                if apple:
                    resultats.append(_importer(cur, "tarifs_apple_devices", csv_lignes(apple), f"mobilax-{jour}-apple.csv", r,
                                               infos=infos))
            cles_reconnues = set()
            for res in resultats:
                cles_reconnues |= set(res.pop("_cles", None) or ())
                for k in _COMPTES:
                    resume[k] += int(res.get(k) or 0)
                if res["lot_id"]:
                    resume["lots"].append(res["lot_id"])
                resume["imports"].append({k: res[k] for k in ("cible", "import_id", "lot_id", "erreur")})
            # Pièces restées sans prix : pourquoi, et quels produits Mobilax ressemblent ; un produit vu sans
            # prix (rupture, prix masqué) est noté tel quel plutôt que « non reconnu »
            with get_cursor() as cur:
                vus_sans_prix = rattacher_sans_prix(cur, sans_prix, FOURNISSEUR, cles_reconnues) if sans_prix else {}
                diag = diagnostic_pieces(_pieces_grille(cur), produits, cles_reconnues, modeles, client.palier,
                                         cherchees, sans_prix=vus_sans_prix)
                _ecrire(cur, P_DIAG, json.dumps(diag, ensure_ascii=False, default=str))
            resume["sans_prix"] = diag["n"]
        resume["ok"] = True
        if resume["modifies"] or resume["propositions"]:
            logger.info("Synchro Mobilax : %s prix mis à jour, %s proposition(s), %s produits lus",
                        resume["modifies"], resume["propositions"], resume["produits"])
    except ErreurJeton as e:
        resume.update(erreur=str(e), code=e.code)
    except ErreurMobilax as e:
        resume.update(erreur=str(e), code=e.code)
    except Exception as e:
        # Type seul : un message d'erreur SQL peut citer des valeurs
        logger.error("Synchro Mobilax : échec (%s)", type(e).__name__)
        resume.update(erreur=f"Erreur interne ({type(e).__name__})", code="interne")
    finally:
        if client is not None:
            client.close()
    resume["fin"] = _utc()
    _noter(resume)
    return resume


# ─── Passage quotidien et lancement manuel ──────────────────────

def synchro_quotidienne(aujourd_hui: Optional[date] = None, transport=None) -> Optional[dict]:
    """Passage du jour : rien si coupé (MOBILAX_SYNCHRO_ACTIVE = 0), non connecté, déjà fait
    aujourd'hui, 3 essais ratés, ou tenu par un autre worker. Renvoie le résumé, sinon None."""
    jour = (aujourd_hui or date.today()).isoformat()
    with get_cursor() as cur:
        p = _amorcer_depuis_env(cur, _lire(cur, [P_ACTIVE, P_REFRESH, P_ID_CLIENT]))
        if p[P_ACTIVE] == "0" or not p[P_REFRESH]:
            return None
        if not _verrouiller(cur):
            return None
        if not _reserver_jour(cur, jour):
            _liberer(cur)
            return None
    resume = None
    try:
        resume = synchroniser(transport=transport)
    finally:
        with get_cursor() as cur:
            _liberer(cur)
            if resume and resume.get("ok"):
                _ecrire(cur, P_JOUR, jour)
        params_cache.invalidate()
    return resume


_etat = {"thread": None, "debut": None, "message": None}


def en_cours() -> bool:
    t = _etat["thread"]
    return bool(t is not None and t.is_alive())


def lancer_en_arriere_plan(transport=None) -> bool:
    """« Synchroniser maintenant » : un fil (ce processus), le verrou params contre un autre
    worker. False si un passage est déjà en cours ici."""
    if en_cours():
        return False

    def run():
        try:
            with get_cursor() as cur:
                pris = _verrouiller(cur)
            if not pris:
                _etat["message"] = ("Une synchronisation Mobilax est déjà en cours (autre serveur) : "
                                    "réessayez dans quelques minutes.")
                return
            try:
                synchroniser(transport=transport)
            finally:
                with get_cursor() as cur:
                    _liberer(cur)
                params_cache.invalidate()
        except Exception as e:
            logger.error("Synchro Mobilax (manuelle) : échec (%s)", type(e).__name__)

    t = threading.Thread(target=run, daemon=True, name="synchro_mobilax")
    _etat.update(thread=t, debut=_utc(), message=None)
    t.start()
    return True


_tache = {"thread": None}


def _boucle(delai_initial: float, periode: float):
    time.sleep(delai_initial)
    while True:
        try:
            synchro_quotidienne()
        except Exception as e:
            logger.warning("Synchro Mobilax quotidienne : échec (%s)", type(e).__name__)
        time.sleep(periode)


def demarrer_synchro_quotidienne(delai_initial: float = 300, periode: float = 3600) -> bool:
    """Tâche de fond (une par processus) : vérifie chaque heure si le passage du jour est dû.
    KP_SYNC_FOURNISSEURS=0 empêche la tâche. True si un fil vient d'être démarré."""
    if os.getenv("KP_SYNC_FOURNISSEURS") == "0":
        return False
    t = _tache["thread"]
    if t is not None and t.is_alive():
        return False
    t = threading.Thread(target=_boucle, args=(delai_initial, periode), daemon=True, name="synchro_fournisseurs")
    _tache["thread"] = t
    t.start()
    return True


# ─── État et connexion (API) ────────────────────────────────────

def _vrai(v):
    v = str(v or "").strip().lower()
    return None if not v else v in ("1", "true", "oui", "ok", "yes")


def _resume_lu(texte):
    try:
        r = json.loads(texte) if texte else None
    except (TypeError, ValueError):
        return None
    return r if isinstance(r, dict) else None


def etat(cur=None) -> dict:
    """État des synchros fournisseurs, sans aucun jeton : {mobilax: {...}, utopya: {...}}."""
    p = params_cache.get_params([P_REFRESH, P_ID_CLIENT, P_PALIER, P_ACTIVE, P_DERNIERE, P_OK, P_RESUME, P_CONNEXION],
                                cur=cur)
    configure = bool(p[P_REFRESH]) or bool(_JETON_RE.fullmatch(os.getenv(ENV_REFRESH, "").strip() or ""))
    resume = _resume_lu(p[P_RESUME])
    connexion = "absente" if not configure else (p[P_CONNEXION].strip() or "a_verifier")
    actif = en_cours()
    return {
        "mobilax": {
            "configure": configure, "connexion": connexion, "active": p[P_ACTIVE].strip() != "0",
            "en_cours": actif, "debut": _etat["debut"] if actif else None,
            "derniere_synchro": p[P_DERNIERE].strip() or None, "ok": _vrai(p[P_OK]),
            "resume": resume, "erreur": (resume or {}).get("erreur"), "message": _etat.get("message"),
            "compte": bool(p[P_ID_CLIENT]), "palier": _palier_lu(p[P_PALIER]).get("nom") or None,
        },
        "utopya": _etat_utopya(cur),
    }


def _etat_utopya(cur=None) -> dict:
    from app.services import utopya   # import différé : utopya importe ce module
    try:
        return utopya.etat(cur)
    except Exception as e:             # pragma: no cover - jamais bloquant pour l'état Mobilax
        logger.error("État Utopya illisible (%s)", type(e).__name__)
        return {"disponible": False, "raison": UTOPYA_RAISON}


def sante(cur=None) -> dict:
    """Pour services/prix.sante : l'essentiel de la synchro Mobilax (aucun jeton)."""
    m = etat(cur)["mobilax"]
    r = m["resume"] or {}
    return {"mobilax": {"derniere_synchro": m["derniere_synchro"], "ok": m["ok"], "configure": m["configure"],
                        "connexion": m["connexion"], "en_cours": m["en_cours"], "erreur": m["erreur"],
                        "modifies": r.get("modifies"), "propositions": r.get("propositions")}}


def enregistrer_connexion(texte, transport=None) -> dict:
    """La connexion du gérant : jetons lus dans le texte collé, vérifiés auprès de Mobilax
    (renouvellement), enregistrés dans params. ValueError (texte), ErreurJeton (refusé),
    ErreurMobilax (injoignable) : messages pour l'utilisateur. → etat()."""
    j = lire_jetons(texte)
    client = ClientMobilax(j["refresh"], j["token"], j["id_client"], transport=transport, palier=j["palier"])
    try:
        client.rafraichir()
        if not client.id_client or not client.palier:
            try:
                client.details_client()
            except (ErreurMobilax, ErreurJeton):
                pass
        with get_cursor() as cur:
            _ecrire(cur, P_REFRESH, client.refresh)
            _ecrire(cur, P_TOKEN, client.token)
            if client.id_client:
                _ecrire(cur, P_ID_CLIENT, client.id_client)
            if client.palier:
                _ecrire(cur, P_PALIER, json.dumps(client.palier, ensure_ascii=False))
            _ecrire(cur, P_CONNEXION, "ok")
            cur.execute("SELECT valeur FROM params WHERE cle = %s", (P_ACTIVE,))
            if cur.fetchone() is None:
                _ecrire(cur, P_ACTIVE, "1")
    finally:
        client.close()
    _vider_caches()
    return etat()


def oublier_connexion() -> dict:
    """Retire les jetons (la synchro quotidienne s'arrête)."""
    with get_cursor() as cur:
        cur.execute("DELETE FROM params WHERE cle = ANY(%s)", ([P_REFRESH, P_TOKEN, P_ID_CLIENT, P_PALIER],))
        _ecrire(cur, P_CONNEXION, "")
    _vider_caches()
    return etat()


def regler_active(active: bool) -> dict:
    with get_cursor() as cur:
        _ecrire(cur, P_ACTIVE, "1" if active else "0")
    _vider_caches()
    return etat()
