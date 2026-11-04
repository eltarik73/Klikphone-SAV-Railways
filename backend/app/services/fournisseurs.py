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
        out, page = [], 1
        while True:
            lus, total_pages = self.page_produits(recherche, page)
            out += lus
            if not lus or page >= min(total_pages, pages_max):
                return out
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


def ligne_produit(p: dict, palier: dict = None) -> Optional[dict]:
    """{reference, designation, prix_ht} d'un produit (prix du palier du compte), None sans prix."""
    ht = prix_produit(p, palier)
    if ht is None:
        return None
    nom = designation_import(p.get("title_name") or p.get("name") or "")[:250]
    ref = str(p.get("ean13") or p.get("reference") or p.get("sku") or "").strip()
    if not ref and p.get("id"):
        ref = f"MX{p['id']}"
    return {"reference": ref[:60], "designation": nom, "prix_ht": ht}


def csv_lignes(lignes: list) -> bytes:
    """Fichier CSV (« ; », décimales à virgule) lu par import_prix comme un fichier fournisseur."""
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";", lineterminator="\n")
    w.writerow(["Référence", "Désignation", "Prix HT"])
    for l in lignes:
        w.writerow([l["reference"], l["designation"], str(l["prix_ht"]).replace(".", ",")])
    return buf.getvalue().encode("utf-8-sig")


# ─── Modèles à chercher ─────────────────────────────────────────

def requete_modele(marque, modele) -> str:
    """Texte cherché chez Mobilax : le modèle seul s'il porte sa gamme (« iPhone 13 »,
    « Galaxy A52 »), sinon « marque modèle » (« Oppo Reno 10 »)."""
    from app.api import grille   # import différé : grille importe services/prix
    modele = " ".join(str(modele or "").split())
    marque = " ".join(str(marque or "").split())
    if not modele:
        return ""
    if grille.deviner_marque(modele) or not marque or normaliser(marque) in ("", "autre"):
        return modele
    return f"{marque} {modele}"


def requetes_modeles(modeles) -> list:
    """Recherches distinctes (noms groupés « iPhone 12/12 Pro » dépliés), dans l'ordre."""
    from app.api import grille
    vues, out = set(), []
    for marque, modele in modeles:
        for v in grille.variantes(modele) or [modele]:
            q = requete_modele(marque, v)
            k = normaliser(q)
            if k and k not in vues:
                vues.add(k)
                out.append(q)
    return out


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

def planifier(ap: dict) -> dict:
    """Parmi les lignes reconnues de l'aperçu (import_prix.apercu) : lignes à appliquer,
    propositions à créer (grosse variation), pièces laissées (verrou, obsolète, variante plus chère).

    → {lignes: [n], propositions: [{cle, ht, label}], verrouillees, obsoletes, variantes, a_valider}
    """
    par_n = {}
    for rec in ap.get("reconnues") or []:
        par_n.setdefault(rec["n"], []).append(rec)
    vise = {}   # cle → HT retenu
    out = {"lignes": [], "propositions": [], "verrouillees": 0, "obsoletes": 0, "variantes": 0, "a_valider": 0}
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
        alertes = set()
        for r in recs:
            alertes |= set(r.get("alertes") or [])
        if "variation" in alertes:
            out["a_valider"] += 1
            out["propositions"] += [{"cle": r["cle"], "ht": str(hts[r["cle"]]), "label": r["label"]} for r in recs]
        else:
            out["lignes"].append(n)
    out["lignes"].sort()
    return out


_COMPTES = ("lignes", "reconnues", "non_reconnues", "inconnues", "verrouillees", "obsoletes", "variantes",
            "a_valider", "modifies", "confirmes", "propositions")


def _importer(cur, cible: str, contenu: bytes, nom_fichier: str, r: dict) -> dict:
    """Aperçu puis application automatique sur une cible ; propositions pour les grosses variations."""
    res = {"cible": cible, "import_id": None, "lot_id": None, "erreur": None, **{k: 0 for k in _COMPTES}}
    try:
        ap = import_prix.apercu(cur, nom_fichier, contenu, FOURNISSEUR, cible, r=r, par=AUTEUR)
    except import_prix.ImportErreur as e:
        res["erreur"] = str(e)
        return res
    plan = planifier(ap)
    resume = ap["resume"]
    res.update(import_id=ap["import_id"], lignes=resume["lignes"], reconnues=resume["pieces_reconnues"],
               non_reconnues=resume["non_reconnues"], inconnues=resume["nouvelles"],
               **{k: plan[k] for k in ("verrouillees", "obsoletes", "variantes", "a_valider")})
    if plan["lignes"]:
        app = import_prix.appliquer(cur, ap["import_id"], {"lignes": plan["lignes"], "ignorer_invalides": True},
                                    AUTEUR, r=r)
        res.update(modifies=app["modifies"], confirmes=app["confirmes"], lot_id=app["lot_id"])
    else:
        cur.execute("UPDATE tarifs_imports SET statut = 'synchro' WHERE id = %s", (ap["import_id"],))
    for p in plan["propositions"]:
        if prix.creer_proposition(cur, p["cle"], p["ht"], "mobilax", AUTEUR) is not None:
            res["propositions"] += 1
    # Le détail des lignes (gros JSON) ne sert qu'à l'application : seuls le résumé et les données
    # d'annulation du lot restent
    cur.execute("UPDATE tarifs_imports SET resume = resume - 'donnees' WHERE id = %s", (ap["import_id"],))
    return res


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
            "recherches": 0, "erreurs_reseau": 0, "produits": 0, "produits_prix": 0, "incomplet": False,
            "prix_masques": False, "lots": [], "imports": [], "champs": [], **{k: 0 for k in _COMPTES}}


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
        produits, vus, erreurs_suite = [], set(), 0
        for i, q in enumerate(requetes):
            if time.monotonic() - t0 > BUDGET_SECONDES:
                resume["incomplet"] = True
                break
            try:
                lus = client.produits(q)
                erreurs_suite = 0
            except ErreurMobilax as e:
                erreurs_suite += 1
                resume["erreurs_reseau"] += 1
                if erreurs_suite >= ERREURS_MAX:
                    raise ErreurMobilax(f"{e} ({erreurs_suite} erreurs de suite)", e.code)
                continue
            resume["recherches"] += 1
            for p in lus:
                cle = p.get("id") or p.get("ean13") or json.dumps(p, sort_keys=True, default=str)[:200]
                if cle not in vus:
                    vus.add(cle)
                    produits.append(p)
            if i + 1 < len(requetes):
                dormir(client.pause)
        resume["requetes"] = client.requetes
        resume["produits"] = len(produits)
        resume["champs"] = sorted({k for p in produits[:50] for k in p})[:40]
        lignes = [l for l in (ligne_produit(p, client.palier) for p in produits if produit_pertinent(p)) if l]
        resume["produits_prix"] = len(lignes)
        if produits and not lignes:
            resume["prix_masques"] = True
            raise ErreurMobilax("Mobilax ne renvoie aucun prix : activez l'affichage des prix sur votre compte "
                                "mobilax.fr (Mon compte), puis relancez la synchronisation.", "prix_masques")
        if lignes:
            jour = date.today().isoformat()
            apple = [l for l in lignes if any(m in normaliser(l["designation"]) for m in ("ipad", "macbook"))]
            with get_cursor() as cur:
                r = prix.regles(cur)
                resultats = [_importer(cur, "tarifs", csv_lignes(lignes), f"mobilax-{jour}.csv", r)]
                if apple:
                    resultats.append(_importer(cur, "tarifs_apple_devices", csv_lignes(apple), f"mobilax-{jour}-apple.csv", r))
            for res in resultats:
                for k in _COMPTES:
                    resume[k] += res[k]
                if res["lot_id"]:
                    resume["lots"].append(res["lot_id"])
                resume["imports"].append({k: res[k] for k in ("cible", "import_id", "lot_id", "erreur")})
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
        "utopya": {"disponible": False, "raison": UTOPYA_RAISON},
    }


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
