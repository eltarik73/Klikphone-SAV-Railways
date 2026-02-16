"""
Schemas Pydantic pour validation des données.
Compatible avec le schéma PostgreSQL existant de Klikphone SAV.
"""

from pydantic import BaseModel, ConfigDict
from typing import Any
from typing import Optional, List
from datetime import datetime


# ============================================================
# AUTH
# ============================================================
class LoginRequest(BaseModel):
    pin: str
    target: str  # "accueil" ou "tech"
    utilisateur: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    target: str
    utilisateur: str


# ============================================================
# CLIENTS
# ============================================================
class ClientCreate(BaseModel):
    nom: str
    prenom: Optional[str] = ""
    telephone: str
    email: Optional[str] = ""
    societe: Optional[str] = ""
    carte_camby: Optional[int] = 0


class ClientUpdate(BaseModel):
    nom: Optional[str] = None
    prenom: Optional[str] = None
    telephone: Optional[str] = None
    email: Optional[str] = None
    societe: Optional[str] = None
    carte_camby: Optional[int] = None


class ClientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nom: Optional[str] = None
    prenom: Optional[str] = None
    telephone: Optional[str] = None
    email: Optional[str] = None
    societe: Optional[str] = None
    carte_camby: Optional[int] = 0
    date_creation: Optional[datetime] = None


# ============================================================
# TICKETS
# ============================================================
class TicketCreate(BaseModel):
    client_id: int
    categorie: str
    marque: str
    modele: Optional[str] = ""
    modele_autre: Optional[str] = ""
    imei: Optional[str] = ""
    panne: str
    panne_detail: Optional[str] = ""
    pin: Optional[str] = ""
    pattern: Optional[str] = ""
    notes_client: Optional[str] = ""
    commande_piece: Optional[int] = 0
    est_retour_sav: Optional[bool] = False
    ticket_original_id: Optional[int] = None
    source: Optional[str] = "boutique"


class TicketUpdate(BaseModel):
    # Device / repair fields (now editable)
    categorie: Optional[str] = None
    marque: Optional[str] = None
    modele: Optional[str] = None
    modele_autre: Optional[str] = None
    imei: Optional[str] = None
    panne: Optional[str] = None
    panne_detail: Optional[str] = None
    pin: Optional[str] = None
    pattern: Optional[str] = None
    notes_client: Optional[str] = None
    # Pricing / assignment
    notes_internes: Optional[str] = None
    commentaire_client: Optional[str] = None
    devis_estime: Optional[float] = None
    acompte: Optional[float] = None
    tarif_final: Optional[float] = None
    personne_charge: Optional[str] = None
    technicien_assigne: Optional[str] = None
    commande_piece: Optional[int] = None
    client_contacte: Optional[int] = None
    client_accord: Optional[int] = None
    paye: Optional[int] = None
    msg_whatsapp: Optional[int] = None
    msg_sms: Optional[int] = None
    msg_email: Optional[int] = None
    reparation_supp: Optional[str] = None
    prix_supp: Optional[float] = None
    type_ecran: Optional[str] = None
    date_recuperation: Optional[Any] = None
    attention: Optional[str] = None
    reduction_montant: Optional[float] = None
    reduction_pourcentage: Optional[float] = None
    telephone_pret: Optional[str] = None
    telephone_pret_imei: Optional[str] = None
    telephone_pret_rendu: Optional[int] = None


class StatusChange(BaseModel):
    statut: str


class TicketOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ticket_code: Optional[str] = None
    client_id: Optional[int] = None
    categorie: Optional[str] = None
    marque: Optional[str] = None
    modele: Optional[str] = None
    modele_autre: Optional[str] = None
    imei: Optional[str] = None
    panne: Optional[str] = None
    panne_detail: Optional[str] = None
    pin: Optional[str] = None
    pattern: Optional[str] = None
    notes_client: Optional[str] = None
    notes_internes: Optional[str] = None
    commentaire_client: Optional[str] = None
    reparation_supp: Optional[str] = None
    prix_supp: Optional[float] = None
    devis_estime: Optional[float] = None
    acompte: Optional[float] = None
    tarif_final: Optional[float] = None
    personne_charge: Optional[str] = None
    technicien_assigne: Optional[str] = None
    commande_piece: Optional[int] = 0
    date_recuperation: Optional[str] = None
    client_contacte: Optional[int] = 0
    client_accord: Optional[int] = 0
    paye: Optional[int] = 0
    msg_whatsapp: Optional[int] = 0
    msg_sms: Optional[int] = 0
    msg_email: Optional[int] = 0
    statut: Optional[str] = None
    date_depot: Optional[datetime] = None
    date_maj: Optional[datetime] = None
    date_cloture: Optional[datetime] = None
    type_ecran: Optional[str] = None
    historique: Optional[str] = None
    attention: Optional[str] = None
    reduction_montant: Optional[float] = 0
    reduction_pourcentage: Optional[float] = 0
    telephone_pret: Optional[str] = None
    telephone_pret_imei: Optional[str] = None
    telephone_pret_rendu: Optional[int] = 0
    reparation_debut: Optional[datetime] = None
    reparation_fin: Optional[datetime] = None
    reparation_duree: Optional[int] = 0
    est_retour_sav: Optional[bool] = False
    ticket_original_id: Optional[int] = None
    source: Optional[str] = "boutique"


class TicketFull(TicketOut):
    """Ticket avec les infos client jointes."""
    client_nom: Optional[str] = None
    client_prenom: Optional[str] = None
    client_tel: Optional[str] = None
    client_email: Optional[str] = None
    client_societe: Optional[str] = None
    client_carte_camby: Optional[int] = 0


# ============================================================
# COMMANDES PIECES
# ============================================================
class CommandePieceCreate(BaseModel):
    ticket_id: Optional[int] = None
    description: str
    fournisseur: Optional[str] = ""
    reference: Optional[str] = ""
    prix: Optional[float] = 0
    notes: Optional[str] = ""
    ticket_code: Optional[str] = ""


class CommandePieceUpdate(BaseModel):
    description: Optional[str] = None
    fournisseur: Optional[str] = None
    reference: Optional[str] = None
    prix: Optional[float] = None
    statut: Optional[str] = None
    date_commande: Optional[str] = None
    date_reception: Optional[str] = None
    notes: Optional[str] = None
    ticket_code: Optional[str] = None
    ticket_id: Optional[int] = None


class CommandePieceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ticket_id: Optional[int] = None
    ticket_code: Optional[str] = None
    description: Optional[str] = None
    fournisseur: Optional[str] = None
    reference: Optional[str] = None
    prix: Optional[float] = 0
    statut: Optional[str] = None
    date_commande: Optional[datetime] = None
    date_reception: Optional[datetime] = None
    notes: Optional[str] = None
    date_creation: Optional[datetime] = None


# ============================================================
# EQUIPE
# ============================================================
class MembreEquipeCreate(BaseModel):
    nom: str
    role: str
    couleur: Optional[str] = "#3B82F6"


class MembreEquipeUpdate(BaseModel):
    nom: Optional[str] = None
    role: Optional[str] = None
    couleur: Optional[str] = None
    actif: Optional[int] = None


class MembreEquipeOut(BaseModel):
    id: int
    nom: Optional[str] = None
    role: Optional[str] = None
    couleur: Optional[str] = None
    actif: Optional[int] = 1


# ============================================================
# PARAMS / CONFIG
# ============================================================
class ParamUpdate(BaseModel):
    cle: str
    valeur: str


class ParamOut(BaseModel):
    cle: str
    valeur: Optional[str] = None


# ============================================================
# KPI / DASHBOARD
# ============================================================
class KPIResponse(BaseModel):
    en_attente_diagnostic: int = 0
    en_cours: int = 0
    en_attente_piece: int = 0
    en_attente_accord: int = 0
    reparation_terminee: int = 0
    total_actifs: int = 0
    clotures_aujourdhui: int = 0
    nouveaux_aujourdhui: int = 0


# ============================================================
# CATALOG
# ============================================================
class MarqueOut(BaseModel):
    id: int
    categorie: str
    marque: str


class ModeleOut(BaseModel):
    id: int
    categorie: str
    marque: str
    modele: str


# ============================================================
# MESSAGES
# ============================================================
class SendMessageRequest(BaseModel):
    ticket_id: int
    template_key: Optional[str] = None
    message: Optional[str] = None
    channel: str  # "whatsapp", "sms", "email"


class NotificationRequest(BaseModel):
    message: str
    emoji: Optional[str] = "📢"
