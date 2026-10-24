"""
Fiche de réception atelier (ticket_controles, phase « entree ») : accessoires
déposés, état constaté, tests d'entrée, IMEI vérifié.

Saisie rapide : tout est facultatif (test non renseigné = non testé) et
« complete » se coche quand la fiche est faite. La phase « sortie » (contrôle
qualité) partagera la table.
"""

import json
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from psycopg2.extras import Json
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.database import get_cursor
from app.api.auth import get_current_user
from app.services.search import luhn_ok

router = APIRouter(prefix="/api/tickets", tags=["reception"])

PHASE_ENTREE = "entree"

ACCESSOIRES = {
    "chargeur": "Chargeur", "cable": "Câble", "coque": "Coque", "protection": "Protection d'écran",
    "carte_sim": "Carte SIM", "carte_sd": "Carte SD", "boite": "Boîte", "stylet": "Stylet",
    "autre": "Autre",
}
ETATS = {"ok": "OK", "raye": "rayé", "fissure": "fissuré", "casse": "cassé", "choc": "choc", "tordu": "tordu"}
PARTIES = {"ecran": "Écran", "dos": "Dos", "chassis": "Châssis"}
TESTS = {
    "allume": "S'allume", "tactile": "Tactile", "face_touch_id": "Face ID / Touch ID",
    "camera_avant": "Caméra avant", "camera_arriere": "Caméra arrière", "micro": "Micro",
    "haut_parleur": "Haut-parleur", "ecouteur": "Écouteur", "charge": "Charge",
    "wifi": "Wi-Fi", "reseau": "Réseau", "boutons": "Boutons",
}

Accessoire = Literal["chargeur", "cable", "coque", "protection", "carte_sim", "carte_sd", "boite", "stylet", "autre"]
EtatFace = Literal["ok", "raye", "fissure", "casse"]
EtatChassis = Literal["ok", "raye", "choc", "tordu"]


def _texte(v) -> str:
    return " ".join(str(v or "").split()) if v is not None else ""


class EtatAppareil(BaseModel):
    model_config = ConfigDict(extra="ignore")
    ecran: Optional[EtatFace] = None
    dos: Optional[EtatFace] = None
    chassis: Optional[EtatChassis] = None
    notes: Optional[str] = Field("", max_length=1000)

    @field_validator("notes", mode="after")
    @classmethod
    def _notes(cls, v):
        return (v or "").strip()


class TestsEntree(BaseModel):
    """True = OK, False = KO, None = non testé."""
    model_config = ConfigDict(extra="ignore")
    allume: Optional[bool] = None
    tactile: Optional[bool] = None
    face_touch_id: Optional[bool] = None
    camera_avant: Optional[bool] = None
    camera_arriere: Optional[bool] = None
    micro: Optional[bool] = None
    haut_parleur: Optional[bool] = None
    ecouteur: Optional[bool] = None
    charge: Optional[bool] = None
    wifi: Optional[bool] = None
    reseau: Optional[bool] = None
    boutons: Optional[bool] = None


class ItemsReception(BaseModel):
    model_config = ConfigDict(extra="ignore")
    accessoires: list[Accessoire] = Field(default_factory=list, max_length=20)
    accessoires_autre: Optional[str] = Field("", max_length=200)
    etat: EtatAppareil = Field(default_factory=EtatAppareil)
    tests: TestsEntree = Field(default_factory=TestsEntree)
    imei_verifie: Optional[str] = Field(None, max_length=40)
    appareil_eteint: bool = False
    sauvegarde_conseillee: bool = False

    @field_validator("accessoires", "etat", "tests", mode="before")
    @classmethod
    def _vide_si_null(cls, v, info):
        if v is None:
            return [] if info.field_name == "accessoires" else {}
        return v

    @field_validator("accessoires", mode="after")
    @classmethod
    def _sans_doublon(cls, v):
        return list(dict.fromkeys(v))

    @field_validator("accessoires_autre", mode="after")
    @classmethod
    def _autre(cls, v):
        return _texte(v)

    @field_validator("imei_verifie", mode="after")
    @classmethod
    def _imei(cls, v):
        # IMEI (15 chiffres, clé de Luhn) ou numéro de série (tablette, PC sans IMEI)
        s = "".join(ch for ch in str(v or "") if ch not in " -./").upper()
        if not s:
            return None
        if not s.isalnum() or len(s) > 20:
            raise ValueError("IMEI ou numéro de série invalide")
        if len(s) == 15 and s.isdigit() and not luhn_ok(s):
            raise ValueError("IMEI invalide (clé de contrôle)")
        return s


class ReceptionIn(BaseModel):
    items: ItemsReception
    complete: bool = False


def reception_complete_sql(alias: str = "t") -> str:
    """Expression SQL booléenne « réception complète » d'un ticket (alias de la table tickets)."""
    if not alias.isidentifier():
        raise ValueError(alias)
    return (f"COALESCE((SELECT tc.complete FROM ticket_controles tc WHERE tc.ticket_id = {alias}.id"
            f" AND tc.phase = 'entree'), FALSE)")


def _items_normalises(items):
    """Lignes stockées relues avec le schéma courant (champs ajoutés depuis : valeurs par défaut)."""
    if items is None:
        return None
    if isinstance(items, str):
        try:
            items = json.loads(items)
        except ValueError:
            return None
    if not isinstance(items, dict):
        return None
    try:
        return ItemsReception.model_validate(items).model_dump()
    except ValidationError:
        return items


def _sortie(row) -> dict:
    row = row or {}
    d = row.get("date_maj")
    return {
        "items": _items_normalises(row.get("items")),
        "complete": bool(row.get("complete")),
        "auteur": row.get("auteur"),
        "date_maj": d.isoformat() if hasattr(d, "isoformat") else d,
    }


def resume_reception(brut) -> Optional[dict]:
    """Résumé imprimable (libellés) d'une fiche : {complete, accessoires, etat, notes,
    tests_ko, non_testes, imei, eteint, sauvegarde} ; None si aucune donnée."""
    if isinstance(brut, str):
        try:
            brut = json.loads(brut)
        except ValueError:
            return None
    if not isinstance(brut, dict):
        return None
    items = _items_normalises(brut.get("items"))
    if not isinstance(items, dict):
        return None
    accessoires = [ACCESSOIRES.get(a, str(a)) for a in items.get("accessoires") or [] if a != "autre"]
    autre = _texte(items.get("accessoires_autre"))
    if autre or "autre" in (items.get("accessoires") or []):
        accessoires.append(autre or ACCESSOIRES["autre"])
    etat = items.get("etat") or {}
    etats = [f"{PARTIES[p]} {ETATS.get(etat.get(p), etat.get(p))}" for p in PARTIES if etat.get(p)]
    tests = items.get("tests") or {}
    return {
        "complete": bool(brut.get("complete")),
        "accessoires": accessoires,
        "etat": etats,
        "notes": (etat.get("notes") or "").strip(),
        "tests_ko": [lib for cle, lib in TESTS.items() if tests.get(cle) is False],
        "non_testes": [lib for cle, lib in TESTS.items() if tests.get(cle) is None],
        "imei": items.get("imei_verifie") or "",
        "eteint": bool(items.get("appareil_eteint")),
        "sauvegarde": bool(items.get("sauvegarde_conseillee")),
    }


@router.get("/{ticket_id}/reception")
def get_reception(ticket_id: int, user: dict = Depends(get_current_user)):
    """Fiche de réception du ticket (items null tant qu'elle n'a jamais été enregistrée)."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT t.id, tc.items, tc.complete, tc.auteur, tc.date_maj
            FROM tickets t
            LEFT JOIN ticket_controles tc ON tc.ticket_id = t.id AND tc.phase = %s
            WHERE t.id = %s
        """, (PHASE_ENTREE, ticket_id))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Ticket non trouvé")
    return _sortie(row)


@router.put("/{ticket_id}/reception")
def put_reception(ticket_id: int, data: ReceptionIn, user: dict = Depends(get_current_user)):
    """Enregistre la fiche de réception (remplace la précédente) ; sa validation est historisée."""
    auteur = (user or {}).get("sub") or "Staff"
    # Une seule instruction : écriture (seulement si le ticket existe : aucune ligne sinon → 404),
    # et trace de la première validation. « avant » lit l'état d'avant l'écriture (même instantané).
    with get_cursor() as cur:
        cur.execute("""
            WITH avant AS (
                SELECT complete FROM ticket_controles WHERE ticket_id = %(t)s AND phase = %(p)s
            ), ecrit AS (
                INSERT INTO ticket_controles (ticket_id, phase, items, complete, auteur)
                SELECT id, %(p)s, %(items)s::jsonb, %(complete)s, %(auteur)s FROM tickets WHERE id = %(t)s
                ON CONFLICT (ticket_id, phase) DO UPDATE
                SET items = EXCLUDED.items, complete = EXCLUDED.complete,
                    auteur = EXCLUDED.auteur, date_maj = NOW()
                RETURNING items, complete, auteur, date_maj,
                          COALESCE((SELECT complete FROM avant), FALSE) AS deja_complete
            ), trace AS (
                INSERT INTO historique (ticket_id, type, contenu)
                SELECT %(t)s, 'reception', %(texte)s FROM ecrit WHERE ecrit.complete AND NOT ecrit.deja_complete
            )
            SELECT * FROM ecrit
        """, {"t": ticket_id, "p": PHASE_ENTREE, "items": Json(data.items.model_dump()),
              "complete": data.complete, "auteur": auteur,
              "texte": f"Fiche de réception validée — par {auteur}"})
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Ticket non trouvé")
    return _sortie(row)
