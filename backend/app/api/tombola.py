"""API Tombola : une tombola gratuite ouverte aux clients, tirée au sort à une date fixée.

Public (borne, dépôt en ligne, affiche) : GET /api/tombola/en-cours — titre, lots, date, règlement.
Personnel : liste, détail, inscription au comptoir, retrait, suivi des gagnants (prévenu, lot remis).
Admin (élévation) : créer, modifier, tirer maintenant, annuler, tirer un remplaçant.
Règles et tirage : services/tombola.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

import psycopg2
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from app.api.auth import get_current_user, require_admin
from app.api.clients import (
    NOM_MAX, TELEPHONE_FICTIF, fiche_de_la_personne, fiches_du_numero, telephone_fictif,
)
from app.database import get_cursor
from app.services import tombola as T
from app.services.search import phone_canonical

router = APIRouter(prefix="/api/tombola", tags=["tombola"])

TITRE_MAX = 80
REGLEMENT_MAX = 6000
PARTICIPANTS_MAX = 5000   # lignes renvoyées à l'écran (le compte, lui, est exact)


# ─── Modèles ─────────────────────────────────────────────────────
def _lots_valides(v):
    lots = T.lots_liste(v)
    if not lots:
        raise ValueError("Indiquez au moins un lot à gagner.")
    if len(lots) > T.LOTS_MAX:
        raise ValueError(f"{T.LOTS_MAX} lots au maximum.")
    if any(len(lot) > T.LOT_LONGUEUR_MAX for lot in lots):
        raise ValueError(f"Un lot tient en {T.LOT_LONGUEUR_MAX} caractères au plus.")
    return lots


def _date_valide(v):
    try:
        return T.date_paris(v)
    except (TypeError, ValueError):
        raise ValueError("Date du tirage illisible (attendu : 2026-12-20T18:00).")


class TombolaCreation(BaseModel):
    titre: str = Field(..., min_length=1, max_length=TITRE_MAX)
    lots: list[str]
    tirage_le: datetime
    reglement: Optional[str] = Field("", max_length=REGLEMENT_MAX)

    _lots = field_validator("lots", mode="before")(_lots_valides)
    _date = field_validator("tirage_le", mode="before")(_date_valide)

    @field_validator("titre")
    @classmethod
    def _titre(cls, v):
        v = " ".join(str(v or "").split())
        if not v:
            raise ValueError("Donnez un titre à la tombola.")
        return v


class TombolaModification(BaseModel):
    titre: Optional[str] = Field(None, max_length=TITRE_MAX)
    lots: Optional[list[str]] = None
    tirage_le: Optional[datetime] = None
    reglement: Optional[str] = Field(None, max_length=REGLEMENT_MAX)

    @field_validator("lots", mode="before")
    @classmethod
    def _lots(cls, v):
        return None if v is None else _lots_valides(v)

    @field_validator("tirage_le", mode="before")
    @classmethod
    def _date(cls, v):
        return None if v in (None, "") else _date_valide(v)

    @field_validator("titre")
    @classmethod
    def _titre(cls, v):
        if v is None:
            return None
        v = " ".join(v.split())
        if not v:
            raise ValueError("Le titre ne peut pas être vide.")
        return v


class ParticipantComptoir(BaseModel):
    """Inscription au comptoir, sans dépôt ni achat : un nom et un numéro suffisent."""
    nom: str = Field(..., max_length=NOM_MAX)
    prenom: Optional[str] = Field("", max_length=NOM_MAX)
    telephone: str = Field(..., max_length=30)

    @field_validator("nom", "prenom")
    @classmethod
    def _propre(cls, v):
        return " ".join(str(v or "").split())

    @field_validator("telephone")
    @classmethod
    def _tel(cls, v):
        return phone_canonical(v)


class SuiviGagnant(BaseModel):
    prevenu: Optional[bool] = None
    lot_remis: Optional[bool] = None


# ─── Lecture ─────────────────────────────────────────────────────
def _refus(e: T.Refus):
    raise HTTPException(e.statut, {"code": e.code, "message": e.message})


def _futur(d: datetime):
    if d <= datetime.now(timezone.utc) + timedelta(minutes=1):
        raise HTTPException(422, {"code": "date_passee",
                                  "message": "La date du tirage doit être dans le futur."})


_SQL_GAGNANTS = """
    SELECT p.id, p.tombola_id, p.client_id, p.rang, p.tire_le, p.prevenu_le, p.lot_remis_le, p.remplace_le,
           c.nom, c.prenom, c.telephone
    FROM tombola_participations p LEFT JOIN clients c ON c.id = p.client_id
    WHERE p.tombola_id = ANY(%s) AND p.rang IS NOT NULL
    ORDER BY p.tombola_id, p.rang, p.tire_le, p.id
"""


def _decrire(t: dict, participants: int, gagnants: list) -> dict:
    lots = T.lots_liste(t.get("lots"))
    return {
        "id": t["id"], "titre": t.get("titre") or "", "lots": lots,
        "tirage_le": T._iso(t.get("tirage_le")), "statut": t.get("statut") or "ouverte",
        "reglement": T.reglement_effectif(t),
        "reglement_personnalise": bool(str(t.get("reglement") or "").strip()),
        "participants": int(participants or 0),
        "participants_au_tirage": t.get("participants_au_tirage"),
        "tiree_le": T._iso(t.get("tiree_le")), "tiree_par": t.get("tiree_par"),
        "cree_le": T._iso(t.get("cree_le")), "cree_par": t.get("cree_par"),
        "gagnants": [{
            "id": g["id"], "rang": g["rang"],
            "lot": lots[g["rang"] - 1] if 0 < g["rang"] <= len(lots) else "",
            "client_id": g.get("client_id"), "nom": g.get("nom") or "", "prenom": g.get("prenom") or "",
            "telephone": g.get("telephone") or "", "tire_le": T._iso(g.get("tire_le")),
            "prevenu_le": T._iso(g.get("prevenu_le")), "lot_remis_le": T._iso(g.get("lot_remis_le")),
            "remplace_le": T._iso(g.get("remplace_le")),
        } for g in gagnants],
    }


def _tombolas(cur, tombola_id: Optional[int] = None) -> list:
    if tombola_id is None:
        cur.execute("SELECT * FROM tombolas ORDER BY id DESC LIMIT 50")
    else:
        cur.execute("SELECT * FROM tombolas WHERE id = %s", (tombola_id,))
    rows = cur.fetchall() or []
    if not rows:
        return []
    ids = [r["id"] for r in rows]
    cur.execute("""SELECT tombola_id, COUNT(*) AS n FROM tombola_participations
                   WHERE tombola_id = ANY(%s) GROUP BY tombola_id""", (ids,))
    comptes = {r["tombola_id"]: r["n"] for r in (cur.fetchall() or [])}
    cur.execute(_SQL_GAGNANTS, (ids,))
    par_tombola = {}
    for g in (cur.fetchall() or []):
        par_tombola.setdefault(g["tombola_id"], []).append(g)
    return [_decrire(r, comptes.get(r["id"], 0), par_tombola.get(r["id"], [])) for r in rows]


@router.get("/en-cours")
def tombola_en_cours():
    """Tombola ouverte aux inscriptions (public) : {"tombola": null} s'il n'y en a pas."""
    return {"tombola": T.en_cours_publique()}


@router.get("")
def lister(user: dict = Depends(get_current_user)):
    """Toutes les tombolas, la plus récente d'abord, avec leurs gagnants."""
    with get_cursor() as cur:
        return {"tombolas": _tombolas(cur)}


@router.get("/{tombola_id}")
def detail(tombola_id: int, user: dict = Depends(get_current_user)):
    """Une tombola et la liste de ses participants."""
    with get_cursor() as cur:
        trouvees = _tombolas(cur, tombola_id)
        if not trouvees:
            raise HTTPException(404, "Tombola introuvable")
        cur.execute("""
            SELECT p.id, p.client_id, p.source, p.inscrit_le, p.inscrit_par, p.rang,
                   c.nom, c.prenom, c.telephone
            FROM tombola_participations p LEFT JOIN clients c ON c.id = p.client_id
            WHERE p.tombola_id = %s ORDER BY p.inscrit_le DESC, p.id DESC LIMIT %s
        """, (tombola_id, PARTICIPANTS_MAX))
        liste = [{
            "id": r["id"], "client_id": r.get("client_id"), "nom": r.get("nom") or "",
            "prenom": r.get("prenom") or "", "telephone": r.get("telephone") or "",
            "source": r.get("source") or "", "inscrit_le": T._iso(r.get("inscrit_le")),
            "inscrit_par": r.get("inscrit_par"), "gagnant": bool(r.get("rang")),
        } for r in (cur.fetchall() or [])]
    return {**trouvees[0], "liste": liste}


# ─── Admin : créer, modifier, tirer, annuler ─────────────────────
def _auteur(user: dict) -> str:
    return (user or {}).get("sub") or "Admin"


@router.post("")
def creer(data: TombolaCreation, user: dict = Depends(require_admin)):
    """Ouvre une tombola. Une seule à la fois : la case des formulaires désigne « la » tombola."""
    _futur(data.tirage_le)
    deja = HTTPException(409, {"code": "deja_ouverte",
                               "message": "Une tombola est déjà ouverte : attendez son tirage ou annulez-la."})
    try:
        with get_cursor() as cur:
            cur.execute("SELECT id FROM tombolas WHERE statut = 'ouverte' LIMIT 1")
            if cur.fetchone():
                raise deja
            cur.execute("""
                INSERT INTO tombolas (titre, lots, tirage_le, reglement, cree_par)
                VALUES (%s, %s, %s, %s, %s) RETURNING id
            """, (data.titre, T.lots_texte(data.lots), data.tirage_le,
                  (data.reglement or "").strip() or None, _auteur(user)))
            nouveau = cur.fetchone()["id"]
            T._journaliser(cur, "tombola_creation", nouveau, _auteur(user), f"{len(data.lots)} lot(s)")
            decrite = _tombolas(cur, nouveau)
    except psycopg2.errors.UniqueViolation:
        # Deux créations au même instant : l'index idx_tombolas_une_ouverte n'en laisse passer qu'une
        raise deja
    T.oublier_cache()
    return decrite[0] if decrite else {"id": nouveau}


@router.patch("/{tombola_id}")
def modifier(tombola_id: int, data: TombolaModification, user: dict = Depends(require_admin)):
    """Titre, lots, date ou règlement, tant que le tirage n'a pas eu lieu."""
    champs = data.model_dump(exclude_unset=True)
    if data.tirage_le is not None:
        _futur(data.tirage_le)
    with get_cursor() as cur:
        cur.execute("SELECT statut FROM tombolas WHERE id = %s FOR UPDATE", (tombola_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Tombola introuvable")
        if row["statut"] != "ouverte":
            raise HTTPException(409, {"code": "plus_ouverte",
                                      "message": "Cette tombola n'est plus ouverte : elle ne se modifie plus."})
        sets, params = [], {"id": tombola_id}
        if champs.get("titre") is not None:
            sets.append("titre = %(titre)s")
            params["titre"] = data.titre
        if champs.get("lots") is not None:
            sets.append("lots = %(lots)s")
            params["lots"] = T.lots_texte(data.lots)
        if champs.get("tirage_le") is not None:
            sets.append("tirage_le = %(tirage_le)s")
            params["tirage_le"] = data.tirage_le
        if "reglement" in champs:
            sets.append("reglement = %(reglement)s")
            params["reglement"] = (data.reglement or "").strip() or None
        if sets:
            cur.execute("UPDATE tombolas SET " + ", ".join(sets) + " WHERE id = %(id)s", params)
        decrite = _tombolas(cur, tombola_id)
    T.oublier_cache()
    return decrite[0]


@router.post("/{tombola_id}/tirage")
def tirer(tombola_id: int, bg: BackgroundTasks, user: dict = Depends(require_admin)):
    """Tire au sort tout de suite, sans attendre la date (le tirage reste unique)."""
    with get_cursor() as cur:
        r = T.tirer(cur, tombola_id, _auteur(user))
        if not r:
            raise HTTPException(409, {"code": "plus_ouverte",
                                      "message": "Cette tombola a déjà été tirée ou annulée."})
        decrite = _tombolas(cur, tombola_id)
    T.oublier_cache()
    bg.add_task(T._prevenir_equipe, r)
    return decrite[0]


@router.post("/{tombola_id}/annuler")
def annuler(tombola_id: int, user: dict = Depends(require_admin)):
    """Annule une tombola ouverte : plus d'inscription, aucun tirage, participations effacées."""
    with get_cursor() as cur:
        cur.execute("SELECT statut FROM tombolas WHERE id = %s FOR UPDATE", (tombola_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Tombola introuvable")
        if row["statut"] != "ouverte":
            raise HTTPException(409, {"code": "plus_ouverte",
                                      "message": "Seule une tombola ouverte peut être annulée."})
        cur.execute("DELETE FROM tombola_participations WHERE tombola_id = %s", (tombola_id,))
        efface = cur.rowcount or 0
        cur.execute("UPDATE tombolas SET statut = 'annulee' WHERE id = %s", (tombola_id,))
        T._journaliser(cur, "tombola_annulation", tombola_id, _auteur(user), f"{efface} participation(s) effacée(s)")
    T.oublier_cache()
    return {"ok": True, "participations_effacees": efface}


@router.post("/participations/{participation_id}/remplacer")
def remplacer(participation_id: int, user: dict = Depends(require_admin)):
    """Gagnant injoignable ou qui renonce : un remplaçant est tiré parmi les autres inscrits."""
    with get_cursor() as cur:
        try:
            r = T.remplacer(cur, participation_id, _auteur(user))
        except T.Refus as e:
            _refus(e)
        decrite = _tombolas(cur, r["tombola_id"])
    return decrite[0]


# ─── Personnel : inscrire au comptoir, retirer, suivre les gagnants ─
@router.post("/{tombola_id}/participants")
def inscrire_au_comptoir(tombola_id: int, data: ParticipantComptoir, request: Request,
                         user: dict = Depends(get_current_user)):
    """Inscrit quelqu'un au comptoir, sans dépôt ni achat (participation gratuite)."""
    if not data.nom:
        raise HTTPException(422, {"code": "nom_requis", "message": "Le nom est requis."})
    if not T.cle_personne(data.telephone):
        raise HTTPException(422, {"code": "telephone_requis", "message": "Le numéro de téléphone est requis."})
    if telephone_fictif(data.telephone):
        raise HTTPException(422, {"code": "telephone_fictif", "message": TELEPHONE_FICTIF})
    with get_cursor() as cur:
        ouverte = T.en_cours(cur)
        if not ouverte or ouverte["id"] != tombola_id:
            raise HTTPException(409, {"code": "plus_ouverte",
                                      "message": "Les inscriptions à cette tombola sont closes."})
        fiche = fiche_de_la_personne(fiches_du_numero(cur, data.telephone), data.nom, data.prenom)
        if fiche:
            client_id = fiche["id"]
        else:
            cur.execute("""INSERT INTO clients (nom, prenom, telephone, rgpd_informe_le)
                           VALUES (%s, %s, %s, NOW()) RETURNING id""",
                        (data.nom, data.prenom, data.telephone))
            client_id = cur.fetchone()["id"]
        r = T.inscrire(cur, client_id, data.telephone, "comptoir", _auteur(user), tombola=ouverte)
    return {"ok": True, "deja_inscrit": not (r or {}).get("nouvelle"), "client_id": client_id}


@router.delete("/participations/{participation_id}")
def retirer(participation_id: int, user: dict = Depends(get_current_user)):
    """Retire une participation avant le tirage (demande du client, erreur de saisie)."""
    with get_cursor() as cur:
        cur.execute("""
            SELECT p.id, t.statut FROM tombola_participations p JOIN tombolas t ON t.id = p.tombola_id
            WHERE p.id = %s FOR UPDATE OF p
        """, (participation_id,))
        row = cur.fetchone()
        if not row:
            return {"ok": True}
        if row["statut"] != "ouverte":
            raise HTTPException(409, {"code": "plus_ouverte",
                                      "message": "Le tirage a eu lieu : la liste ne se modifie plus."})
        cur.execute("DELETE FROM tombola_participations WHERE id = %s", (participation_id,))
    return {"ok": True}


@router.patch("/participations/{participation_id}")
def suivre_gagnant(participation_id: int, data: SuiviGagnant, user: dict = Depends(get_current_user)):
    """Note qu'un gagnant a été prévenu, ou que son lot lui a été remis (et l'inverse)."""
    sets, params = [], {"id": participation_id}
    if data.prevenu is not None:
        sets.append("prevenu_le = CASE WHEN %(prevenu)s THEN COALESCE(prevenu_le, NOW()) END")
        params["prevenu"] = data.prevenu
    if data.lot_remis is not None:
        sets.append("lot_remis_le = CASE WHEN %(remis)s THEN COALESCE(lot_remis_le, NOW()) END")
        params["remis"] = data.lot_remis
    if not sets:
        return {"ok": True}
    with get_cursor() as cur:
        cur.execute("UPDATE tombola_participations SET " + ", ".join(sets)
                    + " WHERE id = %(id)s AND rang IS NOT NULL AND remplace_le IS NULL RETURNING tombola_id", params)
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Gagnant introuvable")
        decrite = _tombolas(cur, row["tombola_id"])
    return decrite[0]
