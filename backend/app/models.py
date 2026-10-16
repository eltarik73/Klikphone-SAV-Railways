"""
Schemas Pydantic pour validation des données.
Compatible avec le schéma PostgreSQL existant de Klikphone SAV.
"""

import re

from pydantic import BaseModel, ConfigDict, ValidationError, field_validator
from typing import Any
from typing import Optional, List
from datetime import datetime

from app.services.search import luhn_ok, phone_canonical


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
def _telephone_canonique(v):
    # Un seul format en base (0612345678 / +41…) : sinon « 06 12 34 56 78 » et
    # « 0612345678 » cohabitent et créent des doublons de fiches client.
    return phone_canonical(v)


class ClientCreate(BaseModel):
    nom: str
    prenom: Optional[str] = ""
    telephone: str
    email: Optional[str] = ""
    societe: Optional[str] = ""
    carte_camby: Optional[int] = 0

    _tel = field_validator("telephone")(_telephone_canonique)


class ClientUpdate(BaseModel):
    nom: Optional[str] = None
    prenom: Optional[str] = None
    telephone: Optional[str] = None
    email: Optional[str] = None
    societe: Optional[str] = None
    carte_camby: Optional[int] = None

    _tel = field_validator("telephone")(_telephone_canonique)


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
    reste_a_payer: Optional[float] = None
    statut_paiement: Optional[str] = None
    telephone_pret: Optional[str] = None
    telephone_pret_imei: Optional[str] = None
    telephone_pret_rendu: Optional[int] = None
    type_document: Optional[str] = None

    @field_validator("telephone_pret_imei")
    @classmethod
    def _imei_pret(cls, v):
        # IMEI du téléphone de prêt : vide, ou 15 chiffres avec clé de Luhn (séparateurs
        # retirés). C'est lui que la scanette compare à la remise.
        if v is None:
            return None
        if not v.strip():
            return ""
        chiffres = re.sub(r"\D", "", v)
        if len(chiffres) != 15 or set(chiffres) == {"0"} or not luhn_ok(chiffres):
            raise ValueError("IMEI du téléphone de prêt invalide : 15 chiffres avec clé de contrôle")
        return chiffres


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
    reste_a_payer: Optional[float] = 0
    statut_paiement: Optional[str] = "Non payé"
    telephone_pret: Optional[str] = None
    telephone_pret_imei: Optional[str] = None
    telephone_pret_rendu: Optional[int] = 0
    reparation_debut: Optional[datetime] = None
    reparation_fin: Optional[datetime] = None
    reparation_duree: Optional[int] = 0
    est_retour_sav: Optional[bool] = False
    ticket_original_id: Optional[int] = None
    source: Optional[str] = "boutique"
    type_document: Optional[str] = "devis"

    @field_validator("date_cloture", mode="wrap")
    @classmethod
    def _date_cloture_texte(cls, v, handler):
        # Colonne TEXT libre : une valeur non datable ne doit pas faire échouer toute la liste
        try:
            return handler(v)
        except ValidationError:
            return None


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
    a_recuperer: int = 0


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


class SmsSendRequest(BaseModel):
    """SMS envoyé par le serveur (Brevo) au client du ticket."""
    ticket_id: int
    message: str
    # Libellé du modèle (« Appareil prêt », « Demande accord »…) repris dans la note du ticket
    libelle: Optional[str] = None

    @field_validator("message")
    @classmethod
    def _message(cls, v):
        if not v.strip():
            raise ValueError("Message vide")
        if len(v) > 1000:
            raise ValueError("Message trop long (1000 caractères maximum)")
        return v

    @field_validator("libelle")
    @classmethod
    def _libelle(cls, v):
        return (v or "").strip()[:60] or None


class NotificationRequest(BaseModel):
    message: str
    emoji: Optional[str] = "📢"
