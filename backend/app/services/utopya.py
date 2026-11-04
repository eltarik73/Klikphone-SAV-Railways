"""Collecte des prix Utopya depuis le navigateur du gérant (utopya.fr refuse les serveurs).

Utopya (Magento) ne montre ses prix qu'à un compte connecté et répond 403 (challenge Cloudflare)
à tout programme : aucune synchro serveur possible. La voie automatique passe donc par le
navigateur du gérant, déjà connecté : un **collecteur** (favori « Collecte Utopya », script
généré par `script_collecteur`) lit depuis utopya.fr les pages des modèles de la grille
(même origine, session du gérant) et envoie les noms, références et prix à l'API, qui les passe
au moteur d'import comme la synchro Mobilax (`fournisseurs._importer`, fournisseur « Utopya »).

Déroulé (une seule action du gérant : cliquer le favori sur utopya.fr) :
1. le collecteur lit le menu Utopya (une page par modèle : /samsung/galaxy-a/a54-5g-a546b.html…)
   et l'envoie à `POST …/utopya/plan` → `plan` apparie les modèles de la grille aux pages
   (clés de modèle de services/import_prix) et ajoute les pages de série des marques sans page
   par modèle (Pixel, OnePlus, Oppo…) ;
2. il lit chaque page (200 produits par page, pagination), en extrait les tuiles
   (nom, référence, prix) et envoie le tout à `POST …/utopya/collecte` ;
3. `collecter` (fil de fond) : `lignes_collecte` traduit chaque nom Utopya en ligne d'import
   (marque de la page, modèle, pièce, qualité, prix HT) puis `fournisseurs._importer` écrit les
   prix (prix absent / estimé / périmé remplacés, grosses variations proposées, pièce restée
   chez Mobilax quand il est moins cher — `fournisseurs.planifier`), et le diagnostic des pièces
   sans prix Utopya est gardé (`UTOPYA_DIAGNOSTIC`).

Authentification du collecteur : clé `UTOPYA_COLLECTE_TOKEN` (params, masquée par api/config),
créée à la première demande du script par l'admin, envoyée dans l'en-tête X-Collecte-Cle ;
« Régénérer » invalide l'ancien favori. Aucune requête réseau depuis ce module.
"""

import json
import logging
import os
import re
import secrets
import threading
import time
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Optional

from app.database import get_cursor
from app.services import fournisseurs, import_prix
from app.services import params as params_cache
from app.services import prix
from app.services.prestations import normaliser

logger = logging.getLogger(__name__)

FOURNISSEUR = "Utopya"
AUTEUR = "Collecte Utopya"
SOURCE = "utopya"
VERSION = "2"
SITE = "https://www.utopya.fr/"

P_CLE = "UTOPYA_COLLECTE_TOKEN"           # clé du collecteur (masquée par api/config : *_TOKEN)
P_DERNIERE = "UTOPYA_COLLECTE_DERNIERE"   # fin de la dernière collecte (ISO UTC)
P_OK = "UTOPYA_COLLECTE_OK"               # '1' / '0'
P_RESUME = "UTOPYA_COLLECTE_RESUME"       # JSON (compteurs, erreur)
P_DIAG = "UTOPYA_DIAGNOSTIC"              # pièces de la grille sans prix Utopya

MAX_LIENS = 4000
MAX_PRODUITS = 40000
MAX_PAGES = 600
EN_TETE_CLE = "X-Collecte-Cle"

# Marques qui ont leur rubrique propre sur utopya.fr (/samsung/galaxy-a/…) ; les autres sont
# sous /autres-marques/<marque>/… ou /autres/<marque>/…
_RUBRIQUES_MARQUES = {"samsung", "xiaomi", "apple", "motorola", "honor", "oppo", "huawei"}
_RUBRIQUES_HORS = {"protection", "accessoires", "accessori", "outillage", "informatique"}
_ALIAS_RUBRIQUE = {"nothing-phone": "nothing"}
_LIEN_RE = re.compile(r"^https://www\.utopya\.fr/([a-z0-9-]+)/([a-z0-9-]+)/([a-z0-9-]+)\.html$")
# Préfixe rendu au texte du menu, qui ne répète pas la gamme (« A54 5G (A546B) » sous galaxy-a)
_PREFIXES_SERIE = {
    ("samsung", "galaxy"): "Galaxy", ("samsung", "note"): "Galaxy Note", ("motorola", "moto-g"): "Moto",
    ("motorola", "moto-e"): "Moto", ("motorola", "edge"): "Edge", ("motorola", "razr"): "Razr",
    ("apple", "macbook"): "MacBook", ("honor", "*"): "Honor",
}
SERIES_MAX_LIENS = 20        # marque avec moins de liens : ses pages sans numéro sont des pages de série

# Qualité d'écran d'après le nom Utopya (étiquettes entre parenthèses ou mots du nom)
_QUALITES_NOM = (
    ("service pack", "Original"), ("soft oled", "Soft OLED"), ("hard oled", "OLED"), ("amoled", "OLED"),
    ("oled", "OLED"), ("incell", "Incell"), ("in cell", "Incell"), ("ltps", "Incell"), ("tft", "LCD"),
    ("lcd", "LCD"), ("pulled", "Reconditionnee"), ("refurb", "Reconditionnee"), ("reconditionne", "Reconditionnee"),
    ("grade", "Reconditionnee"), ("relife", "Compatible"), ("prime", "Compatible"), ("bolt", "Compatible"),
    ("spark", "Compatible"), ("alcalian", "Compatible"), ("compatible", "Compatible"), ("oem", "Compatible"),
    ("original", "Original"), ("origine", "Original"),
)
_MOTS_QUALITE = {m for m, _ in _QUALITES_NOM} | {"soft", "hard", "cell", "in"}
# Mots de la pièce qui peuvent suivre son motif (« Caméra Grand Angle », « Ecran Complet Intérieur »)
_MOTS_PIECE = {"grand", "angle", "interieur", "principal", "principale", "complet", "complete", "assemble", "assemblee",
               "module", "flex", "nappe"}
# Caméras secondaires et variantes qui ne sont pas la pièce suivie
IGNORES = ("ultra grand angle", "teleobjectif", "macro", "profondeur", "periscope", "externe", "exterieur",
           "haute capacite", "modeles multiples", "sans bms", "a souder", "lot de", "boite de", "set de")
_PAREN = re.compile(r"\(([^()]*)\)")
_MEGAPIXELS = re.compile(r"\b\d{1,3}\s?MP\b", re.IGNORECASE)
_NUMERIQUE = re.compile(r"^\d{4,}$")
_COULEURS = fournisseurs._COULEURS_FIN | {
    "verte", "blanche", "violette", "noire", "bleue", "grise", "doree", "rosee", "jaune", "alpin", "alpine",
    "sierra", "minuit", "stellaire", "lumiere", "starlight", "midnight", "graphite", "argente", "argentee",
    "titane", "naturel", "desert", "glacier", "anthracite", "phantom", "awesome", "mystic", "prism", "cloud",
}
_PRIX_HT = re.compile(r"(\d[\d\s  .,]*)\s*€?\s*HT\b", re.IGNORECASE)
_PRIX_TTC = re.compile(r"(\d[\d\s  .,]*)\s*€?\s*TTC\b", re.IGNORECASE)
_NOMBRE = re.compile(r"\d[\d\s  .,]*")


# ─── Clé du collecteur ──────────────────────────────────────────

def cle_collecteur(cur=None, creer: bool = False) -> str:
    """Clé du collecteur (params) ; créée si absente et `creer` (admin qui demande le script)."""
    cle = (params_cache.get_param(P_CLE, "", cur) or "").strip()
    if cle or not creer:
        return cle
    cle = secrets.token_hex(24)
    with get_cursor() as c:
        fournisseurs._ecrire(c, P_CLE, cle)
    params_cache.invalidate()
    return cle


def regenerer_cle() -> str:
    cle = secrets.token_hex(24)
    with get_cursor() as c:
        fournisseurs._ecrire(c, P_CLE, cle)
    params_cache.invalidate()
    return cle


def cle_valide(presentee) -> bool:
    attendue = cle_collecteur()
    return bool(attendue) and bool(presentee) and secrets.compare_digest(str(presentee).strip(), attendue)


# ─── Plan : pages Utopya à lire pour la grille ──────────────────

def _entree_menu(texte, href) -> Optional[dict]:
    m = _LIEN_RE.match(str(href or "").strip())
    if not m:
        return None
    rub, serie, page = m.groups()
    if rub in _RUBRIQUES_HORS:
        return None
    if rub in _RUBRIQUES_MARQUES:
        marque = rub
    elif rub in ("autres-marques", "autres"):
        marque = _ALIAS_RUBRIQUE.get(serie, serie)
        serie = page
    else:
        return None
    t = " ".join(str(texte or "").split())[:80]
    bas = normaliser(t)
    prefixe = _PREFIXES_SERIE.get((marque, serie)) or _PREFIXES_SERIE.get((marque, serie.split("-")[0])) \
        or _PREFIXES_SERIE.get((marque, "*"))
    nom = t
    if prefixe and bas and not bas.startswith(normaliser(prefixe).split()[0]):
        nom = f"{prefixe} {t}"
    return {"texte": t, "nom": nom, "href": m.group(0), "marque": marque, "serie": serie,
            "chiffre": any(ch.isdigit() for ch in t)}


def lire_menu(liens) -> list:
    """Entrées de menu reconnues : [{texte, nom, href, marque, serie, chiffre}], sans doublon d'adresse."""
    out, vus = [], set()
    for l in (liens or [])[:MAX_LIENS]:
        if not isinstance(l, dict):
            continue
        e = _entree_menu(l.get("texte"), l.get("href"))
        if e and e["href"] not in vus:
            vus.add(e["href"])
            out.append(e)
    return out


def plan(liens, modeles) -> dict:
    """Pages à lire pour les modèles (marque, modèle) de la grille.

    Page par modèle quand le menu en a une (clés de modèle, niveaux du plus strict au plus
    tolérant, marque égale) ; pour une marque qui n'a que des pages de série (Pixel, OnePlus,
    Série Reno…), ces pages (sans numéro dans leur titre, marque de moins de SERIES_MAX_LIENS
    liens). → {pages: [{url, marque, modele, libelle}], sans_page: [[marque, modele]], modeles,
    liens_reconnus}
    """
    from app.api import grille
    entrees = lire_menu(liens)
    for e in entrees:
        e["cles"] = import_prix.cles_modele(e["nom"], e["marque"])
    par_marque = {}
    for e in entrees:
        par_marque.setdefault(grille.marque_canonique(e["marque"]), []).append(e)
    pages, vus, sans_page = [], {}, []

    def ajouter(e, marque, modele):
        if e["href"] in vus:
            return
        vus[e["href"]] = True
        pages.append({"url": e["href"], "marque": marque, "modele": modele, "libelle": e["nom"]})

    for marque, modele in modeles or ():
        mc = grille.marque_canonique(marque)
        if not mc or not modele:
            continue
        cles = import_prix.cles_modele(modele, marque)
        trouve = None
        for niveau in import_prix.NIVEAUX:
            if not cles[niveau]:
                continue
            cands = [e for e in par_marque.get(mc, []) if e["chiffre"] and cles[niveau] & e["cles"][niveau]]
            if cands:
                trouve = cands[:3]
                break
        if trouve:
            for e in trouve:
                ajouter(e, marque, modele)
            continue
        series = [e for e in par_marque.get(mc, []) if not e["chiffre"]] if len(par_marque.get(mc, [])) < SERIES_MAX_LIENS else []
        if series:
            for e in series:
                ajouter(e, marque, None)
        else:
            sans_page.append([marque, modele])
    return {"pages": pages[:MAX_PAGES], "sans_page": sans_page, "modeles": len(modeles or ()),
            "liens_reconnus": len(entrees)}


def plan_grille(cur, liens) -> dict:
    return plan(liens, fournisseurs.modeles_grille(cur))


# ─── Produits collectés → lignes d'import ───────────────────────

def prix_collecte(p: dict, tva=None) -> Optional[Decimal]:
    """Prix HT d'une tuile : « 12,50 € HT » du texte, sinon le montant Magento (data-price-amount,
    ramené en HT s'il est annoncé TTC), sinon le premier nombre du texte. None sans prix lisible."""
    texte = str(p.get("prix_texte") or "")
    m = _PRIX_HT.search(texte)
    if m:
        try:
            return import_prix.lire_prix(m.group(1).strip())
        except ValueError:
            pass
    ttc_seul = "TTC" in texte.upper() and "HT" not in texte.upper().replace("TTC", "")
    montant = p.get("prix_montant")
    valeur = None
    if montant not in (None, ""):
        try:
            valeur = Decimal(str(montant).replace(",", ".").replace(" ", ""))
        except InvalidOperation:
            valeur = None
    if valeur is None:
        m = _PRIX_TTC.search(texte) or _NOMBRE.search(texte)
        if m:
            try:
                valeur = import_prix.lire_prix(m.group(1 if m.re is _PRIX_TTC else 0).strip())
            except ValueError:
                valeur = None
    if valeur is None:
        return None
    if ttc_seul:
        coef = Decimal(str(tva or prix.REGLES_DEFAUT.get("tva", 1.2)))
        valeur = (valeur / coef) if coef > 0 else valeur
    if valeur <= 0 or valeur > import_prix._MAX_HT:
        return None
    return valeur.quantize(Decimal("0.01"))


def qualite_nom(nom: str, sku: str = "") -> Optional[str]:
    """Qualité d'un écran Utopya : étiquette du nom (Service Pack, Soft OLED, Incell, ReLife,
    Pulled A…) ; sans étiquette, une référence toute numérique est un écran d'origine du catalogue
    Utopya (Samsung, Google…), sinon une pièce compatible."""
    bas = normaliser(nom)
    for motif, q in _QUALITES_NOM:
        if re.search(rf"\b{re.escape(motif)}\b", bas):
            return q
    return "Original" if _NUMERIQUE.match(str(sku or "").strip()) else "Compatible"


def modele_nom(nom: str, motif_piece: str) -> str:
    """Modèle lu dans un nom Utopya : ce qui suit la pièce, sans coloris, qualité, mégapixels ni
    parenthèses inutiles (année, génération, 5G, numéro gardés)."""
    from app.api import grille
    s = _PAREN.sub(lambda m: f" ({m.group(1).strip()}) " if grille._garder_parenthese(m.group(1)) else " ", nom)
    s = _MEGAPIXELS.sub(" ", s)
    mots = s.split()
    # « Haut-Parleur » = deux sous-mots : le motif se cherche dans la liste aplatie
    plat, origine = [], []
    for i, m in enumerate(mots):
        for sm in normaliser(m).split():
            plat.append(sm)
            origine.append(i)
    motif = motif_piece.split()
    debut = 0
    for i in range(len(plat) - len(motif) + 1):
        if plat[i:i + len(motif)] == motif:
            debut = origine[i + len(motif) - 1] + 1
            break
    garde = []
    for m in mots[debut:]:
        b = normaliser(m)
        if not b or all(x in _COULEURS or x in _MOTS_QUALITE or x in import_prix._MOTS_VIDES or x in _MOTS_PIECE
                        for x in b.split()):
            continue
        garde.append(m)
    return " ".join(garde)


def ligne_collecte(p: dict, marque_page: str, tva=None) -> Optional[dict]:
    """Ligne d'import d'une tuile Utopya {nom, sku, prix_texte, prix_montant} :
    {reference, designation, marque, modele, type_piece, qualite, prix_ht} ; None si ce n'est pas
    une pièce suivie, une pièce secondaire ou un produit sans prix."""
    nom = " ".join(str(p.get("nom") or "").split())
    if not nom:
        return None
    bas = normaliser(nom)
    if any(m in bas for m in IGNORES) or (bas.split() and bas.split()[0] in import_prix._ACCESSOIRES):
        return None
    cle, motif = import_prix.piece_de(nom)
    if not cle or motif is None:
        return None
    ht = prix_collecte(p, tva)
    if ht is None:
        return None
    type_piece = import_prix._TYPE_PIECE[cle]
    qualite = qualite_nom(nom, p.get("sku")) if cle == "ecran" else (
        "Original" if re.search(r"\b(service pack|original|origine)\b", bas) else None)
    modele = modele_nom(nom, motif)
    if not modele:
        return None
    ref = str(p.get("sku") or "").strip()[:60]
    return {"reference": ref, "designation": nom[:250], "marque": str(marque_page or "")[:40], "modele": modele[:250],
            "type_piece": type_piece, "qualite": qualite or "", "prix_ht": ht}


def lignes_collecte(produits, pages, tva=None) -> tuple:
    """(lignes d'import, produits « vus » pour le diagnostic) des tuiles collectées.
    pages : {url: {marque, modele}} du plan (marque de la page → marque de la ligne)."""
    from app.api import grille
    lignes, vus, diag = [], set(), []
    for p in produits or []:
        if not isinstance(p, dict):
            continue
        nom = " ".join(str(p.get("nom") or "").split())
        if not nom:
            continue
        page = pages.get(str(p.get("page") or ""), {}) if pages else {}
        marque = page.get("marque") or ""
        cle_vue = (str(p.get("sku") or ""), normaliser(nom))
        if cle_vue in vus:
            continue
        vus.add(cle_vue)
        marque_aff = grille.marque_canonique(marque).capitalize() if marque else ""
        l = ligne_collecte(p, marque_aff, tva)
        q = fournisseurs.requete_modele(marque_aff, page.get("modele") or "") if page.get("modele") else ""
        diag.append({"title_name": nom[:200], "price": float(l["prix_ht"]) if l else None, "active": True, "_q": q})
        if l:
            lignes.append(l)
    return lignes, diag


# ─── Collecte : traitement en fil de fond ───────────────────────

_etat = {"thread": None, "debut": None, "message": None}


def en_cours() -> bool:
    t = _etat["thread"]
    return bool(t is not None and t.is_alive())


def _utc() -> str:
    return fournisseurs._utc()


def _resume_vide() -> dict:
    return {"ok": False, "erreur": None, "debut": _utc(), "fin": None, "pages_lues": 0, "pages_total": 0,
            "erreurs_pages": 0, "interrompu": False, "produits": 0, "produits_prix": 0, "lignes_envoyees": 0,
            "lots": [], "imports": [], "sans_prix": None, **{k: 0 for k in fournisseurs._COMPTES}}


def _noter(cur, resume: dict):
    texte = json.dumps(resume, ensure_ascii=False, default=str)
    if len(texte) > fournisseurs.RESUME_MAX:
        resume = {**resume, "imports": [], "lots": resume.get("lots", [])[:4]}
        texte = json.dumps(resume, ensure_ascii=False, default=str)[:fournisseurs.RESUME_MAX]
    fournisseurs._ecrire(cur, P_RESUME, texte)
    fournisseurs._ecrire(cur, P_OK, "1" if resume.get("ok") else "0")
    fournisseurs._ecrire(cur, P_DERNIERE, resume.get("fin") or _utc())


def traiter(collecte: dict) -> dict:
    """Une collecte reçue : lignes, import automatique (tarifs puis iPad / MacBook), diagnostic.
    Ne lève jamais : le résumé est renvoyé et enregistré dans params."""
    resume = _resume_vide()
    try:
        produits = [p for p in (collecte.get("produits") or [])[:MAX_PRODUITS] if isinstance(p, dict)]
        pages = {str(pg.get("url") or ""): pg for pg in (collecte.get("pages") or []) if isinstance(pg, dict)}
        resume.update(pages_lues=int(collecte.get("pages_lues") or 0), pages_total=int(collecte.get("pages_total") or 0),
                      erreurs_pages=len(collecte.get("erreurs") or []), interrompu=bool(collecte.get("interrompu")),
                      produits=len(produits))
        with get_cursor() as cur:
            r = prix.regles(cur)
            modeles = fournisseurs.modeles_grille(cur)
        lignes, diag = lignes_collecte(produits, pages, r.get("tva"))
        resume["lignes_envoyees"] = len(lignes)
        resume["produits_prix"] = sum(1 for d in diag if d["price"] is not None)
        if produits and not resume["produits_prix"]:
            raise ValueError("Aucun prix dans les pages lues : connectez-vous à votre compte sur utopya.fr "
                             "(les prix sont masqués aux visiteurs), puis relancez la collecte.")
        cles_reconnues = set()
        if lignes:
            jour = date.today().isoformat()
            apple = [l for l in lignes if any(m in normaliser(l["modele"]) for m in ("ipad", "macbook"))]
            with get_cursor() as cur:
                resultats = [fournisseurs._importer(cur, "tarifs", fournisseurs.csv_lignes(lignes), f"utopya-{jour}.csv",
                                                    r, fournisseur=FOURNISSEUR, auteur=AUTEUR, source=SOURCE)]
                if apple:
                    resultats.append(fournisseurs._importer(cur, "tarifs_apple_devices", fournisseurs.csv_lignes(apple),
                                                            f"utopya-{jour}-apple.csv", r, fournisseur=FOURNISSEUR,
                                                            auteur=AUTEUR, source=SOURCE))
            for res in resultats:
                cles_reconnues |= set(res.pop("_cles", None) or ())
                for k in fournisseurs._COMPTES:
                    resume[k] += int(res.get(k) or 0)
                if res["lot_id"]:
                    resume["lots"].append(res["lot_id"])
                resume["imports"].append({k: res[k] for k in ("cible", "import_id", "lot_id", "erreur")})
        with get_cursor() as cur:
            d = fournisseurs.diagnostic_pieces(fournisseurs._pieces_grille(cur), diag, cles_reconnues, modeles)
            fournisseurs._ecrire(cur, P_DIAG, json.dumps(d, ensure_ascii=False, default=str))
        resume["sans_prix"] = d["n"]
        resume["ok"] = True
        logger.info("Collecte Utopya : %s prix mis à jour, %s proposition(s), %s produits lus",
                    resume["modifies"], resume["propositions"], resume["produits"])
    except ValueError as e:
        resume["erreur"] = str(e)
    except Exception as e:
        logger.error("Collecte Utopya : échec (%s)", type(e).__name__)
        resume["erreur"] = f"Erreur interne ({type(e).__name__})"
    resume["fin"] = _utc()
    try:
        with get_cursor() as cur:
            _noter(cur, resume)
        params_cache.invalidate()
    except Exception as e:                       # pragma: no cover - base indisponible
        logger.error("Collecte Utopya : résumé non enregistré (%s)", type(e).__name__)
    return resume


def lancer(collecte: dict) -> bool:
    """Traite la collecte dans un fil (Railway coupe une requête à ~15 s). False si une collecte
    est déjà en cours."""
    if en_cours():
        return False
    _etat["debut"], _etat["message"] = _utc(), None

    def run():
        try:
            traiter(collecte)
        except Exception as e:                   # pragma: no cover - traiter ne lève pas
            logger.error("Collecte Utopya (fil) : échec (%s)", type(e).__name__)

    t = threading.Thread(target=run, daemon=True, name="collecte_utopya")
    _etat["thread"] = t
    t.start()
    return True


# ─── État ───────────────────────────────────────────────────────

def _vrai(v) -> Optional[bool]:
    return None if v in (None, "") else str(v) == "1"


def etat(cur=None) -> dict:
    """État de la collecte Utopya, sans la clé : {disponible, configure, en_cours, debut,
    derniere_collecte, ok, resume, erreur, message}."""
    p = params_cache.get_params([P_CLE, P_DERNIERE, P_OK, P_RESUME], cur=cur)
    resume = fournisseurs._resume_lu(p[P_RESUME])
    ok = _vrai(p[P_OK])
    return {
        "disponible": True, "configure": bool((p[P_CLE] or "").strip()), "en_cours": en_cours(),
        "debut": _etat["debut"] if en_cours() else None, "derniere_collecte": p[P_DERNIERE] or None,
        "ok": ok, "resume": resume, "erreur": (resume or {}).get("erreur") if ok is False else None,
        "message": _etat["message"],
    }


def phrase_suivi(e: dict) -> str:
    """Phrase courte pour le collecteur (affichée sur utopya.fr) d'après `etat`."""
    if e.get("en_cours"):
        return "Klikphone met les prix à jour…"
    r = e.get("resume") or {}
    if e.get("ok") is False:
        return f"Collecte échouée : {e.get('erreur') or 'erreur inconnue'}"
    if e.get("ok"):
        morceaux = [f"{int(r.get('modifies') or 0)} prix mis à jour"]
        if r.get("propositions"):
            morceaux.append(f"{int(r['propositions'])} à valider dans Klikphone")
        if r.get("plus_cher_ailleurs"):
            morceaux.append(f"{int(r['plus_cher_ailleurs'])} restés chez Mobilax (moins cher)")
        if r.get("sans_prix"):
            morceaux.append(f"{int(r['sans_prix'])} pièces de la grille sans prix Utopya")
        return "Terminé : " + ", ".join(morceaux) + f" ({int(r.get('produits') or 0)} produits lus)."
    return "Aucune collecte encore."


def sante(cur=None) -> dict:
    e = etat(cur)
    r = e.get("resume") or {}
    return {"configure": e["configure"], "derniere_collecte": e["derniere_collecte"], "ok": e["ok"],
            "en_cours": e["en_cours"], "modifies": int(r.get("modifies") or 0),
            "propositions": int(r.get("propositions") or 0), "sans_prix": r.get("sans_prix")}


def diagnostic(admin: bool = False, cur=None) -> dict:
    return fournisseurs.diagnostic(admin=admin, cur=cur, cle=P_DIAG, fournisseur=FOURNISSEUR)


# ─── Script du collecteur (favori) ──────────────────────────────

# Script exécuté dans l'onglet utopya.fr du gérant. Pas de commentaires « // » (les retours à la
# ligne sont retirés pour l'adresse javascript:), pas de « % » (adresse). Fenêtre d'état en haut
# à droite, bouton Arrêter / Fermer, aucune donnée du gérant lue en dehors des tuiles produits.
SCRIPT = r"""
(async()=>{
const API='__API__',CLE='__CLE__',VER='__VER__';
if(!/(^|\.)utopya\.fr$/.test(location.hostname)){alert("Ouvrez d'abord utopya.fr, connecté à votre compte, puis cliquez sur ce favori.");return;}
if(window.__kpCollecte){alert('Collecte Klikphone déjà en cours sur cette page.');return;}
window.__kpCollecte=1;
const H={'Content-Type':'application/json','X-Collecte-Cle':CLE};
const box=document.createElement('div');box.setAttribute('role','status');box.setAttribute('aria-live','polite');
box.style.cssText='position:fixed;top:12px;right:12px;z-index:2147483647;background:#0F172A;color:#fff;padding:14px 16px;border-radius:12px;font:14px/1.45 system-ui,sans-serif;max-width:380px;box-shadow:0 8px 30px rgba(0,0,0,.35)';
const txt=document.createElement('div');const btn=document.createElement('button');btn.type='button';btn.textContent='Arrêter';
btn.style.cssText='margin-top:10px;min-height:44px;padding:8px 14px;border:0;border-radius:8px;background:#7C3AED;color:#fff;cursor:pointer;font:inherit';
box.append(txt,btn);document.body.append(box);
let stop=false;btn.onclick=()=>{stop=true;btn.disabled=true;};
const dire=m=>{txt.textContent='Klikphone — '+m;};
const dormir=ms=>new Promise(r=>setTimeout(r,ms));
const fin=()=>{btn.textContent='Fermer';btn.disabled=false;btn.onclick=()=>box.remove();};
const post=async(p,b)=>{const r=await fetch(API+'/api/tarifs/fournisseurs/utopya/'+p,{method:'POST',headers:H,body:JSON.stringify(b)});if(!r.ok){let d='';try{d=(await r.json()).detail||'';}catch(e){}throw new Error('Klikphone a répondu '+r.status+(d?' : '+d:'')+' ('+p+')');}return r.json();};
try{
dire('lecture du menu Utopya…');
const vus=new Set(),liens=[];
for(const a of document.querySelectorAll('a[href]')){const h=a.href||'';if(!/^https:\/\/www\.utopya\.fr\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\.html$/.test(h)||vus.has(h))continue;vus.add(h);liens.push({texte:(a.textContent||'').replace(/\s+/g,' ').trim().slice(0,80),href:h});}
if(liens.length<50)throw new Error("menu Utopya introuvable ici : ouvrez la page d'accueil de utopya.fr puis recliquez.");
const plan=await post('plan',{liens,version:VER});
const pages=plan.pages||[];if(!pages.length)throw new Error('aucune page à lire (grille vide ?).');
const produits=[],erreurs=[];let lues=0;
const lirePage=async(url,p)=>{const u=url+(url.includes('?')?'&':'?')+'product_list_limit=200'+(p>1?'&p='+p:'');const r=await fetch(u,{credentials:'include'});if(!r.ok)throw new Error('HTTP '+r.status);return new DOMParser().parseFromString(await r.text(),'text/html');};
const tuiles=(doc,pg)=>{let n=0;for(const li of doc.querySelectorAll('.product-item')){const lien=li.querySelector('.product-item-link');const nom=((lien&&lien.textContent)||'').replace(/\s+/g,' ').trim();if(!nom)continue;const pb=li.querySelector('.price-box')||li.querySelector('.price')||li.querySelector('.log-to-see-price');const am=li.querySelector('[data-price-amount]');produits.push({nom:nom.slice(0,200),sku:(li.dataset.sku||'').slice(0,60),href:((lien&&lien.getAttribute('href'))||'').slice(0,200),prix_montant:am?am.getAttribute('data-price-amount'):null,prix_type:am?am.getAttribute('data-price-type'):null,prix_texte:((pb&&pb.textContent)||'').replace(/\s+/g,' ').trim().slice(0,80),page:pg.url});n++;}return n;};
for(let i=0;i<pages.length&&!stop;i++){const pg=pages[i];dire('lecture '+(i+1)+'/'+pages.length+' : '+(pg.libelle||pg.url)+' — '+produits.length+' produits');
try{const doc=await lirePage(pg.url,1);if(i===0&&doc.querySelector('.log-to-see-price')&&!doc.querySelector('[data-price-amount]'))throw new Error('non_connecte');tuiles(doc,pg);const m=((doc.querySelector('.toolbar-amount')||{}).textContent||'').match(/(\d+)\s*produit/);const total=m?parseInt(m[1],10):0;const np=Math.min(Math.ceil(total/200),6);for(let p=2;p<=np&&!stop;p++){await dormir(400);tuiles(await lirePage(pg.url,p),pg);}lues++;}
catch(e){if(e.message==='non_connecte')throw new Error("connectez-vous à votre compte utopya.fr (les prix sont masqués aux visiteurs), puis recliquez.");erreurs.push({url:pg.url,erreur:String(e.message||e).slice(0,120)});}
await dormir(400);}
dire('envoi de '+produits.length+' produits à Klikphone…');
const res=await post('collecte',{produits,pages,pages_lues:lues,pages_total:pages.length,erreurs,interrompu:stop,version:VER});
dire(res.message||'collecte reçue, Klikphone met les prix à jour…');
for(let t=0;t<200;t++){await dormir(3000);let e=null;try{e=await (await fetch(API+'/api/tarifs/fournisseurs/utopya/suivi',{headers:H})).json();}catch(x){}if(!e)continue;if(e.en_cours){dire(e.message||'Klikphone met les prix à jour…');continue;}dire(e.message||'terminé.');break;}
fin();
}catch(e){dire('collecte arrêtée : '+(e.message||e));fin();}
finally{window.__kpCollecte=0;}
})();
"""


def script_collecteur(api: str, cle: str) -> str:
    """Adresse « javascript: » du favori, pour l'origine publique `api` et la clé du collecteur."""
    corps = SCRIPT.strip().replace("__API__", api.rstrip("/")).replace("__CLE__", cle).replace("__VER__", VERSION)
    corps = " ".join(l.strip() for l in corps.splitlines() if l.strip())
    # Le script se termine par « })(); » : le « ; » final est retiré, sinon « void(…;) » est une
    # SyntaxError et Chrome ne fait rien au clic (erreur seulement dans la console).
    return "javascript:void(" + corps.rstrip("; ") + ")"


def collecteur(api: str) -> dict:
    """Ce que l'admin reçoit : adresse du favori (clé créée au besoin), version, site."""
    cle = cle_collecteur(creer=True)
    return {"url": script_collecteur(api, cle), "version": VERSION, "site": SITE, "configure": True,
            "api": api.rstrip("/")}
