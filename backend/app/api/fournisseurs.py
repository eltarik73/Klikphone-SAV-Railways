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

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.api.auth import exiger_role_admin, get_current_user
from app.api.public_documents import _base_publique
from app.services import fournisseurs, utopya

router = APIRouter(prefix="/api/tarifs/fournisseurs", tags=["tarifs"])
logger = logging.getLogger(__name__)


def _admin(request: Request, user: dict = Depends(get_current_user)) -> dict:
    return exiger_role_admin(request, user)


class ConnexionIn(BaseModel):
    texte: str = Field(..., min_length=1, max_length=40000)


class ActiveIn(BaseModel):
    active: bool


@router.get("/etat")
def etat_fournisseurs(user: dict = Depends(get_current_user)):
    """État des synchros (Mobilax : connexion, dernier passage, compteurs ; Utopya : indisponible)."""
    return fournisseurs.etat()


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
