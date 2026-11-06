"""
Synchro des tarifs fournisseurs (admin) : état, lancement manuel, connexion Mobilax.

GET  /api/tarifs/fournisseurs/etat               tout le personnel connecté (aucun jeton renvoyé)
POST /api/tarifs/fournisseurs/mobilax/sync       lance un passage en tâche de fond (quelques minutes)
POST /api/tarifs/fournisseurs/mobilax/connexion  {texte} collé depuis mobilax.fr → jetons vérifiés puis enregistrés
DELETE /api/tarifs/fournisseurs/mobilax/connexion oublie les jetons
POST /api/tarifs/fournisseurs/mobilax/active     {active} : synchro quotidienne en marche ou coupée
GET  /api/tarifs/fournisseurs/mobilax/diagnostic pièces de la grille sans prix Mobilax après le dernier passage
                                                  (prix des candidats pour l'admin seulement)

Collecte Utopya (services/utopya : le navigateur du gérant lit utopya.fr, le serveur importe) :
GET  /api/tarifs/fournisseurs/utopya/collecteur   (admin) adresse du favori « Collecte Utopya » (clé créée au besoin)
POST /api/tarifs/fournisseurs/utopya/collecteur/regenerer  (admin) nouvelle clé : l'ancien favori ne marche plus
POST /api/tarifs/fournisseurs/utopya/plan         (clé X-Collecte-Cle) {liens} → pages à lire
POST /api/tarifs/fournisseurs/utopya/collecte     (clé) {produits, pages…} → import en tâche de fond
GET  /api/tarifs/fournisseurs/utopya/suivi        (clé) état court pour le collecteur
GET  /api/tarifs/fournisseurs/utopya/diagnostic   pièces de la grille sans prix Utopya

Écritures : rôle admin ET code admin prouvé sur le poste (auth.exiger_role_admin), comme les
autres écritures de prix. Monté AVANT le routeur /api/tarifs (main.py) : « fournisseurs »
n'est pas un id de tarif.
"""

import logging

from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.api.auth import exiger_role_admin, get_current_user
from app.api.public_documents import _base_publique
from app.database import get_cursor
from app.services import fournisseurs, prix, utopya
from app.services.prestations import normaliser

router = APIRouter(prefix="/api/tarifs/fournisseurs", tags=["tarifs"])
logger = logging.getLogger(__name__)


def _admin(request: Request, user: dict = Depends(get_current_user)) -> dict:
    return exiger_role_admin(request, user)


class ConnexionIn(BaseModel):
    texte: str = Field(..., min_length=1, max_length=40000)


class ActiveIn(BaseModel):
    active: bool


class PreferenceIn(BaseModel):
    # Le fournisseur retenu pour toute la grille — jamais « le moins cher »
    fournisseur: str = Field(..., pattern="^(Mobilax|Utopya)$")


@router.put("/preference")
def regler_preference_fournisseur(body: PreferenceIn, user: dict = Depends(_admin)):
    """Fournisseur retenu pour TOUTE la grille (Mobilax ou Utopya ; Mobilax tant que rien n'est réglé) : enregistré,
    puis les coûts retenus de toutes les pièces sont alignés en tâche de fond (prix.appliquer_preference, un lot
    annulable) — une pièce que le fournisseur retenu n'a pas garde l'autre. → {preference, lance, etat}"""
    try:
        f = fournisseurs.regler_preference(body.fournisseur)
    except ValueError as e:
        raise HTTPException(400, str(e))
    lance = fournisseurs.lancer_preference(auteur=str(user.get("sub") or user.get("utilisateur") or "admin"))
    return {"preference": f, "lance": lance, "etat": fournisseurs.etat()}


@router.get("/etat")
def etat_fournisseurs(user: dict = Depends(get_current_user)):
    """État des synchros (Mobilax : connexion, dernier passage, compteurs ; Utopya : indisponible)."""
    return fournisseurs.etat()


_TYPES_RECHERCHE = ("ecran", "batterie", "connecteur", "vitre arriere", "bouton power", "camera")
_COLONNES_HT = ("prix_fournisseur_ht", "ecran_prix_ht", "batterie_prix_ht")
_COLONNES_CLIENT = ("prix_client", "ecran_prix_vente", "batterie_prix_vente")
_SOURCES_AUTO = ("import", "mobilax", "utopya", "commande")


def prix_recents(cur, q: str = "", jours: int = 7, limite: int = 100, admin: bool = False) -> dict:
    """Prix appliqués sans validation (synchro Mobilax, collecte Utopya, prix payé sur une commande, purge) ces
    `jours` derniers jours, du plus récent au plus ancien, un par pièce et par lot : ancien → nouveau prix client,
    coût HT pour l'admin, source, auteur. `q` : chaque mot doit être dans « marque modèle pièce qualité ».
    → {jours, admin, n, tronque, changements: [{le, table, id, cle, marque, modele, type_piece, qualite, source, par,
    fournisseur, client: {ancien, nouveau}, ht: {ancien, nouveau} | None, vide}]}"""
    mots = [m for m in normaliser(q or "").split() if len(m) >= 2 or m.isdigit()][:8]
    brut = 2500 if mots else int(limite)
    cur.execute("""
        SELECT h.table_nom, h.ligne_id, h.lot_id,
               CASE WHEN h.table_nom = 'tarifs_apple_devices' THEN split_part(h.colonne, '_', 1) ELSE 'piece' END AS piece,
               min(h.le) AS le, min(h.source) AS source, min(h.par) AS par,
               max(CASE WHEN h.colonne IN %(ht)s THEN h.ancien END) AS ht_ancien,
               max(CASE WHEN h.colonne IN %(ht)s THEN h.nouveau END) AS ht_nouveau,
               max(CASE WHEN h.colonne IN %(client)s THEN h.ancien END) AS client_ancien,
               max(CASE WHEN h.colonne IN %(client)s THEN h.nouveau END) AS client_nouveau
        FROM tarifs_historique h
        WHERE h.le >= NOW() - make_interval(days => %(jours)s) AND h.source IN %(sources)s
          AND h.table_nom IN ('tarifs', 'tarifs_apple_devices')
        GROUP BY h.table_nom, h.ligne_id, h.lot_id,
                 CASE WHEN h.table_nom = 'tarifs_apple_devices' THEN split_part(h.colonne, '_', 1) ELSE 'piece' END
        ORDER BY min(h.le) DESC, h.lot_id DESC, h.ligne_id DESC
        LIMIT %(limite)s
    """, {"ht": _COLONNES_HT, "client": _COLONNES_CLIENT, "jours": int(jours), "sources": _SOURCES_AUTO, "limite": brut})
    rows = [dict(x) for x in cur.fetchall() or []]
    ids_t = sorted({x["ligne_id"] for x in rows if x["table_nom"] == "tarifs"})
    ids_a = sorted({x["ligne_id"] for x in rows if x["table_nom"] == "tarifs_apple_devices"})
    noms = {}
    if ids_t:
        cur.execute("SELECT id, marque, modele, type_piece, qualite, fournisseur FROM tarifs WHERE id = ANY(%s)", (ids_t,))
        for x in cur.fetchall() or []:
            noms[("tarifs", x["id"])] = dict(x)
    if ids_a:
        cur.execute("SELECT id, modele, fournisseur FROM tarifs_apple_devices WHERE id = ANY(%s)", (ids_a,))
        for x in cur.fetchall() or []:
            noms[("tarifs_apple_devices", x["id"])] = dict(x)
    out, tronque = [], len(rows) >= brut
    for x in rows:
        n = noms.get((x["table_nom"], x["ligne_id"]))
        if n is None:
            continue
        if x["table_nom"] == "tarifs":
            cle = prix.tarif_cle("tarifs", x["ligne_id"])
            marque, type_piece, qualite = n.get("marque") or "", n.get("type_piece") or "", n.get("qualite")
        else:
            cle = prix.tarif_cle("tarifs_apple_devices", x["ligne_id"], x["piece"])
            marque, type_piece, qualite = "Apple", ("Écran" if x["piece"] == "ecran" else "Batterie"), None
        texte = normaliser(f"{marque} {n.get('modele') or ''} {type_piece} {qualite or ''}")
        if mots and not all(m in texte for m in mots):
            continue
        num = lambda v: float(v) if v is not None else None
        out.append({
            "le": x["le"], "table": x["table_nom"], "id": x["ligne_id"], "cle": cle, "lot_id": x["lot_id"],
            "marque": marque, "modele": n.get("modele"), "type_piece": type_piece, "qualite": qualite,
            "source": x["source"], "par": x["par"], "fournisseur": n.get("fournisseur"),
            "client": {"ancien": num(x["client_ancien"]), "nouveau": num(x["client_nouveau"])},
            "ht": {"ancien": num(x["ht_ancien"]), "nouveau": num(x["ht_nouveau"])} if admin else None,
            "vide": x["client_nouveau"] is not None and float(x["client_nouveau"]) <= 0,
        })
        if len(out) >= int(limite):
            tronque = True
            break
    return {"jours": int(jours), "admin": admin, "n": len(out), "tronque": tronque, "changements": out}


@router.get("/recents")
def prix_recents_route(
    request: Request,
    q: Optional[str] = Query(None, max_length=80),
    jours: int = Query(7, ge=1, le=90),
    limite: int = Query(100, ge=1, le=500),
    user: dict = Depends(get_current_user),
):
    """Derniers prix appliqués automatiquement (information : rien à valider) — cf. prix_recents. Coût HT pour l'admin."""
    admin = _est_admin(request, user)
    with get_cursor() as cur:
        return prix_recents(cur, q or "", jours, limite, admin)


@router.get("/recherche")
def rechercher_fournisseurs(
    request: Request,
    q: str = Query(..., min_length=2, max_length=80),
    type: Optional[str] = Query(None, max_length=30),
    user: dict = Depends(get_current_user),
):
    """Recherche de tarifs pro, Mobilax et Utopya côte à côte, d'après les derniers passages (aucune requête aux
    sites) : les modèles de la grille dont le nom porte chaque mot de `q`, leurs pièces (type optionnel : ecran,
    batterie, connecteur, vitre arriere, bouton power, camera) avec le coût retenu et le prix de CHAQUE fournisseur
    (HT pour l'admin, prix client qu'il donnerait, stock, référence, fiche, relevé le), puis les produits du
    catalogue de chaque fournisseur qui répondent à `q` (admin seulement : noms, prix HT, stock, fiches, ligne de
    la grille reçue). → {q, admin, preference, modeles: [{marque, modele, categorie_apple, pieces: [...]}],
    produits: {Mobilax: [...], Utopya: [...]}, nb_produits, tronque}"""
    from app.api import tarifs as api_tarifs     # import différé : api/tarifs est un gros module
    from app.api import grille
    admin = _est_admin(request, user)
    mots = [m for m in normaliser(q).split() if len(m) >= 2 or m.isdigit()][:8]
    if not mots:
        raise HTTPException(400, "Recherche trop courte")
    tp = normaliser(type or "")
    if tp and not any(tp.startswith(t.split()[0]) for t in _TYPES_RECHERCHE):
        raise HTTPException(400, f"Type attendu parmi : {', '.join(_TYPES_RECHERCHE)}")
    with get_cursor() as cur:
        r = prix.regles(cur)
        seuils = grille._seuils(cur)
        groupes = [g for g in api_tarifs._groupes_pieces(cur, None)
                   if all(m in normaliser(f"{g['marque']} {g['modele']}") for m in mots)]
        groupes = groupes[:40]
        pieces = [p for g in groupes for p in g["pieces"]
                  if not tp or tp.split()[0] in normaliser(p.get("type_piece") or "")]
        pf = prix.prix_fournisseurs(cur, [p["cle"] for p in pieces]) if pieces else {}
        produits = prix.rechercher_catalogue(cur, q, type_piece=tp or None, limite=300) if admin else []
        prefere = fournisseurs.preference(cur)
    maintenant = grille.maintenant_utc()
    modeles = []
    for g in groupes:
        ps = [p for p in g["pieces"] if not tp or tp.split()[0] in normaliser(p.get("type_piece") or "")]
        if not ps:
            continue
        ps.sort(key=lambda p: (api_tarifs._rang_type(p["type_piece"]), normaliser(p["type_piece"]),
                               normaliser(p["qualite"]), p["table"], p["id"] or 0))
        cat_apple = api_tarifs._categorie_apple(g["modele"], g.get("categorie")) if g["marque_c"] == "apple" else None
        modeles.append({
            "marque": g["marque"], "modele": g["modele"], "categorie_apple": cat_apple,
            "pieces": [api_tarifs._piece_out(p, admin, r, seuils, maintenant, cat_apple, None, pf.get(p["cle"]))
                       for p in ps],
        })
    par_f = {f: [] for f in prix.FOURNISSEURS_CONNUS}
    for p in produits:
        if p.get("type_piece") and p.get("prix_ht"):
            p["client"] = prix.prix_client(p["prix_ht"], p["type_piece"], "standard", r)
        else:
            p["client"] = None
        par_f.setdefault(p["fournisseur"], []).append(p)
    return {"q": " ".join(q.split()), "admin": admin, "preference": prefere, "modeles": modeles, "produits": par_f,
            "nb_produits": len(produits), "tronque": len(produits) >= 300}


@router.get("/mobilax/diagnostic")
def diagnostic_mobilax(request: Request, user: dict = Depends(get_current_user)):
    """Pièces de la grille restées sans prix Mobilax au dernier passage, avec la raison et jusqu'à
    trois produits Mobilax ressemblants : {le, n, par_raison, pieces: [{cle, marque, modele, type_piece,
    qualite, raison, candidats: [{nom, prix_ht}]}]}. Prix HT des candidats réservés à l'admin."""
    admin = True
    try:
        exiger_role_admin(request, dict(user))
    except HTTPException:
        admin = False
    return fournisseurs.diagnostic(admin=admin)


@router.post("/mobilax/sync")
def lancer_sync_mobilax(user: dict = Depends(_admin)):
    """Lance la synchro Mobilax en arrière-plan (Railway coupe une requête à ~15 s) ; /etat la suit."""
    e = fournisseurs.etat()["mobilax"]
    if not e["configure"]:
        raise HTTPException(409, "Mobilax n'est pas connecté : collez d'abord vos jetons (bouton « Connecter Mobilax »).")
    lance = fournisseurs.lancer_en_arriere_plan()
    return {"lance": lance, "message": "Synchronisation lancée : quelques minutes." if lance
            else "Synchronisation déjà en cours.", "etat": fournisseurs.etat()}


@router.post("/mobilax/connexion")
def connecter_mobilax(body: ConnexionIn, user: dict = Depends(_admin)):
    """Enregistre la connexion Mobilax du gérant après vérification auprès de Mobilax."""
    try:
        return fournisseurs.enregistrer_connexion(body.texte)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except fournisseurs.ErreurJeton as e:
        raise HTTPException(422, str(e))
    except fournisseurs.ErreurMobilax as e:
        raise HTTPException(502, str(e))


@router.delete("/mobilax/connexion")
def deconnecter_mobilax(user: dict = Depends(_admin)):
    return fournisseurs.oublier_connexion()


@router.post("/mobilax/active")
def regler_active_mobilax(body: ActiveIn, user: dict = Depends(_admin)):
    return fournisseurs.regler_active(body.active)


# ─── Collecte Utopya ────────────────────────────────────────────

def _est_admin(request: Request, user: dict) -> bool:
    try:
        exiger_role_admin(request, dict(user))
        return True
    except HTTPException:
        return False


def _cle(x_collecte_cle: Optional[str] = Header(default=None, alias=utopya.EN_TETE_CLE)) -> str:
    """Clé du collecteur (en-tête X-Collecte-Cle) : 401 sinon. Pas de session : le script tourne
    sur utopya.fr, dans le navigateur du gérant."""
    if not utopya.cle_valide(x_collecte_cle):
        raise HTTPException(401, "Clé du collecteur absente ou refusée : réinstallez le favori « Collecte Utopya » "
                                 "depuis Klikphone (Réparation smartphones).")
    return x_collecte_cle


class PlanIn(BaseModel):
    liens: list = Field(default_factory=list, max_length=utopya.MAX_LIENS)
    version: Optional[str] = Field(default=None, max_length=10)


class CollecteIn(BaseModel):
    produits: list = Field(default_factory=list, max_length=utopya.MAX_PRODUITS)
    pages: list = Field(default_factory=list, max_length=utopya.MAX_PAGES)
    pages_lues: int = Field(default=0, ge=0, le=10000)
    pages_total: int = Field(default=0, ge=0, le=10000)
    erreurs: list = Field(default_factory=list, max_length=utopya.MAX_PAGES)
    interrompu: bool = False
    version: Optional[str] = Field(default=None, max_length=10)


@router.get("/utopya/collecteur")
def collecteur_utopya(request: Request, user: dict = Depends(_admin)):
    """Adresse du favori « Collecte Utopya » (script + clé) pour l'origine publique du serveur."""
    return utopya.collecteur(_base_publique(request))


@router.post("/utopya/collecteur/regenerer")
def regenerer_collecteur_utopya(request: Request, user: dict = Depends(_admin)):
    utopya.regenerer_cle()
    return utopya.collecteur(_base_publique(request))


@router.get("/utopya/diagnostic")
def diagnostic_utopya(request: Request, user: dict = Depends(get_current_user)):
    return utopya.diagnostic(admin=_est_admin(request, user))


@router.post("/utopya/plan")
def plan_utopya(body: PlanIn, cle: str = Depends(_cle)):
    """Pages utopya.fr à lire pour les modèles de la grille, d'après le menu envoyé par le collecteur."""
    from app.database import get_cursor
    with get_cursor() as cur:
        return utopya.plan_grille(cur, body.liens)


@router.post("/utopya/collecte")
def recevoir_collecte_utopya(body: CollecteIn, cle: str = Depends(_cle)):
    """Reçoit les produits lus par le collecteur ; l'import se fait en tâche de fond (/utopya/suivi)."""
    if not body.produits:
        raise HTTPException(422, "Aucun produit dans la collecte.")
    lance = utopya.lancer(body.model_dump())
    if not lance:
        raise HTTPException(409, "Une collecte Utopya est déjà en cours de traitement : réessayez dans une minute.")
    return {"lance": True, "message": f"{len(body.produits)} produits reçus : Klikphone met les prix à jour…"}


@router.get("/utopya/suivi")
def suivi_collecte_utopya(cle: str = Depends(_cle)):
    e = utopya.etat()
    return {"en_cours": e["en_cours"], "ok": e["ok"], "message": utopya.phrase_suivi(e)}
