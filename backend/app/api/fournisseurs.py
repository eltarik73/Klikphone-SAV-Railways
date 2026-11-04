"""
Synchro des tarifs fournisseurs (admin) : état, lancement manuel, connexion Mobilax.

GET  /api/tarifs/fournisseurs/etat               tout le personnel connecté (aucun jeton renvoyé)
POST /api/tarifs/fournisseurs/mobilax/sync       lance un passage en tâche de fond (quelques minutes)
POST /api/tarifs/fournisseurs/mobilax/connexion  {texte} collé depuis mobilax.fr → jetons vérifiés puis enregistrés
DELETE /api/tarifs/fournisseurs/mobilax/connexion oublie les jetons
POST /api/tarifs/fournisseurs/mobilax/active     {active} : synchro quotidienne en marche ou coupée

Écritures : rôle admin ET code admin prouvé sur le poste (auth.exiger_role_admin), comme les
autres écritures de prix. Monté AVANT le routeur /api/tarifs (main.py) : « fournisseurs »
n'est pas un id de tarif.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.api.auth import exiger_role_admin, get_current_user
from app.services import fournisseurs

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
