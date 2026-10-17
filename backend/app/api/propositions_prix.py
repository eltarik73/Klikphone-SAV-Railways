"""
Propositions de prix issues des commandes de pièces (admin).

Une commande de pièce qui porte le HT réellement payé et la pièce de la grille (api/parts.py)
crée une proposition (services/prix.creer_proposition) : jamais d'écriture directe du prix.
L'admin (rôle admin + code saisi sur le poste) l'accepte — coût HT et prix client recalculé
écrits par services/prix.appliquer_ht (historique source 'commande', prix daté du jour, lot
annulable) — ou la refuse (rien ne change). Une pièce verrouillée (verrou_manuel) n'est
jamais modifiée : sa proposition est signalée et son acceptation refusée (409).

Annuler le lot d'une acceptation (POST /api/tarifs/historique/annuler-lot/{lot_id}) ne laisse
jamais la proposition 'acceptee' : prix rétabli → de nouveau 'en_attente' (à accepter ou
refuser de nouveau) ; autre proposition déjà en attente pour la pièce, ou (lot de plusieurs
propositions en partie rétabli) prix modifié ou verrouillé depuis → 'annulee' (statut listable :
?statut=annulee). Si AUCUN prix du lot n'est rétabli (tous modifiés ou verrouillés depuis),
l'annulation est refusée (409, rien ne change) : la proposition reste 'acceptee' et le lot reste
annulable une fois le verrou retiré.

Router monté AVANT celui de /api/tarifs (main.py) : « propositions » n'est pas un id de tarif.
"""

import logging
from decimal import Decimal
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.database import get_cursor
from app.api.auth import exiger_role_admin, get_current_user
from app.services import prix as prix_srv

router = APIRouter(prefix="/api/tarifs/propositions", tags=["tarifs"])
logger = logging.getLogger(__name__)

STATUTS = ("en_attente", "acceptee", "refusee", "annulee")
_MAX_LOT = 500


def _nombre(v):
    if v is None:
        return None
    return float(v) if isinstance(v, Decimal) else v


def _iso(v):
    return v.isoformat() if v is not None and hasattr(v, "isoformat") else v


def _invalider_caches():
    """Listes de tarifs en cache (api/tarifs) : relues après un changement de prix."""
    try:
        from app.api import tarifs as tarifs_api
        cache = getattr(tarifs_api, "_cache", None)
        if cache is not None:
            cache.clear()
    except Exception:
        pass


def _decrire(cur, rows, r) -> list:
    descs = prix_srv.decrire_tarifs(cur, [p["tarif_cle"] for p in rows], r)
    out = []
    for p in rows:
        d = descs.get(p["tarif_cle"])
        en_attente = p["statut"] == "en_attente"
        nouveau_ht = p["nouveau_ht"]
        ancien_ht = d["ht"] if (d and en_attente) else p["ancien_ht"]
        try:
            nouveau_client = prix_srv.client_pour(d, nouveau_ht, r) if d and nouveau_ht is not None else None
        except (TypeError, ValueError):
            nouveau_client = None
        out.append({
            "id": p["id"],
            "tarif_cle": p["tarif_cle"],
            "label": d["label"] if d else p["tarif_cle"],
            "ancien_ht": _nombre(ancien_ht),
            "nouveau_ht": _nombre(nouveau_ht),
            "ancien_client": _nombre(d["client"]) if (d and en_attente) else None,
            "nouveau_client": nouveau_client,
            "commande_id": p["commande_id"],
            "ticket_code": p.get("ticket_code") or None,
            "le": _iso(p["le"]),
            "verrou": bool(d["verrou"]) if d else False,
            "statut": p["statut"],
            "source": p["source"],
            "par": p["par"],
            "traite_le": _iso(p.get("traite_le")),
            "traite_par": p.get("traite_par"),
            "introuvable": d is None,
            "alertes": prix_srv.alertes_variation(ancien_ht, nouveau_ht, r) if d else [],
        })
    return out


@router.get("")
def lister_propositions(
    request: Request,
    statut: str = Query("en_attente", pattern="^(en_attente|acceptee|refusee|annulee|tous)$"),
    limit: int = Query(200, ge=1, le=1000),
    user: dict = Depends(get_current_user),
):
    """Propositions (les plus récentes d'abord), avec le prix actuel et le prix client qui en
    résulterait. ancien_* : valeurs actuelles pour une proposition en attente, valeur notée à la
    proposition sinon."""
    exiger_role_admin(request, user)
    with get_cursor() as cur:
        r = prix_srv.regles(cur)
        cur.execute("""
            SELECT p.id, p.tarif_cle, p.ancien_ht, p.nouveau_ht, p.source, p.commande_id, p.statut,
                   p.par, p.le, p.traite_le, p.traite_par,
                   COALESCE(NULLIF(cp.ticket_code, ''), t.ticket_code) AS ticket_code
            FROM tarifs_propositions p
            LEFT JOIN commandes_pieces cp ON cp.id = p.commande_id
            LEFT JOIN tickets t ON t.id = cp.ticket_id
            WHERE (%(statut)s = 'tous' OR p.statut = %(statut)s)
            ORDER BY p.le DESC, p.id DESC
            LIMIT %(limit)s
        """, {"statut": statut, "limit": limit})
        rows = [dict(x) for x in cur.fetchall() or []]
        return _decrire(cur, rows, r)


def _refus(code: str, message: str, status: int = 409):
    raise HTTPException(status, {"code": code, "message": message})


def _accepter(cur, proposition_id: int, par: str, lot_id: str, r) -> dict:
    """Accepte une proposition en attente (dans la transaction de cur). LookupError : inconnue."""
    cur.execute("""SELECT id, tarif_cle, nouveau_ht, statut FROM tarifs_propositions
                   WHERE id = %s FOR UPDATE""", (proposition_id,))
    p = cur.fetchone()
    if p is None:
        raise LookupError("proposition")
    if p["statut"] != "en_attente":
        return {"id": p["id"], "resultat": "deja_traitee", "statut": p["statut"]}
    res = prix_srv.appliquer_ht(cur, p["tarif_cle"], p["nouveau_ht"], "commande", par, lot_id, r)
    if res.get("absent"):
        return {"id": p["id"], "resultat": "introuvable"}
    if res.get("verrouille"):
        return {"id": p["id"], "resultat": "verrouille"}
    cur.execute("""UPDATE tarifs_propositions SET statut = 'acceptee', traite_le = NOW(), traite_par = %s
                   WHERE id = %s""", (par, p["id"]))
    return {
        "id": p["id"], "resultat": "acceptee", "statut": "acceptee", "ecrit": bool(res.get("ok")),
        "ancien_ht": _nombre(res.get("ancien_ht")), "nouveau_ht": _nombre(res.get("nouveau_ht")),
        "ancien_client": _nombre(res.get("ancien_client")), "nouveau_client": _nombre(res.get("nouveau_client")),
    }


class IdsIn(BaseModel):
    ids: List[int] = Field(..., min_length=1, max_length=_MAX_LOT)


@router.post("/accepter")
def accepter_plusieurs(body: IdsIn, request: Request, user: dict = Depends(get_current_user)):
    """Accepte plusieurs propositions en un seul lot (annulable d'un coup) ; les pièces
    verrouillées, introuvables ou déjà traitées sont listées, jamais modifiées."""
    exiger_role_admin(request, user)
    par = user.get("sub") or ""
    lot_id = prix_srv.nouveau_lot()
    out = {"lot_id": lot_id, "acceptees": [], "verrouillees": [], "ignorees": [], "modifies": 0}
    with get_cursor() as cur:
        r = prix_srv.regles(cur)
        for pid in dict.fromkeys(body.ids):
            cur.execute("SAVEPOINT kp_prop")
            try:
                res = _accepter(cur, pid, par, lot_id, r)
                cur.execute("RELEASE SAVEPOINT kp_prop")
            except (LookupError, ValueError):
                cur.execute("ROLLBACK TO SAVEPOINT kp_prop")
                out["ignorees"].append(pid)
                continue
            if res["resultat"] == "acceptee":
                out["acceptees"].append(pid)
                out["modifies"] += 1 if res.get("ecrit") else 0
            elif res["resultat"] == "verrouille":
                out["verrouillees"].append(pid)
            else:
                out["ignorees"].append(pid)
    _invalider_caches()
    return out


@router.post("/{proposition_id}/accepter")
def accepter(proposition_id: int, request: Request, user: dict = Depends(get_current_user)):
    """Accepte une proposition : coût HT et prix client écrits (source 'commande', lot annulable)."""
    exiger_role_admin(request, user)
    par = user.get("sub") or ""
    lot_id = prix_srv.nouveau_lot()
    with get_cursor() as cur:
        r = prix_srv.regles(cur)
        try:
            res = _accepter(cur, proposition_id, par, lot_id, r)
        except LookupError:
            raise HTTPException(404, "Proposition introuvable")
        except ValueError as e:
            _refus("prix_invalide", str(e), 422)
    if res["resultat"] == "deja_traitee":
        _refus("deja_traitee", "Cette proposition a déjà été traitée.")
    if res["resultat"] == "introuvable":
        _refus("tarif_introuvable", "La pièce de cette proposition n'existe plus.", 404)
    if res["resultat"] == "verrouille":
        _refus("verrouille", "Prix verrouillé : déverrouillez la pièce avant d'accepter la proposition.")
    _invalider_caches()
    return {**res, "lot_id": lot_id}


@router.post("/{proposition_id}/refuser")
def refuser(proposition_id: int, request: Request, user: dict = Depends(get_current_user)):
    """Refuse une proposition en attente : aucun prix ne change."""
    exiger_role_admin(request, user)
    with get_cursor() as cur:
        cur.execute("""UPDATE tarifs_propositions SET statut = 'refusee', traite_le = NOW(), traite_par = %s
                       WHERE id = %s AND statut = 'en_attente' RETURNING id""",
                    (user.get("sub") or "", proposition_id))
        row = cur.fetchone()
        if row is None:
            cur.execute("SELECT statut FROM tarifs_propositions WHERE id = %s", (proposition_id,))
            existe = cur.fetchone()
    if row is None:
        if existe is None:
            raise HTTPException(404, "Proposition introuvable")
        _refus("deja_traitee", "Cette proposition a déjà été traitée.")
    return {"id": proposition_id, "statut": "refusee"}
