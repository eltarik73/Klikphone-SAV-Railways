"""
API Caisse Enregistreuse — envoyer ticket vers le POS.

Un ticket n'est envoyé qu'une fois : la note « caisse » n'est écrite qu'après
une vente acceptée par le POS, et un nouvel envoi exige force=true.
"""

import threading
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.database import get_cursor
from app.api.auth import get_current_user
from app.services.caisse import config_caisse, poster_vente, vente_ticket

router = APIRouter(prefix="/api/caisse", tags=["caisse"])

# Envois en cours (un seul process uvicorn) : un double clic pendant les 15 s
# d'attente du POS ne doit pas créer une seconde vente.
_EN_COURS: set = set()
_EN_COURS_LOCK = threading.Lock()


try:
    from zoneinfo import ZoneInfo
    _PARIS = ZoneInfo("Europe/Paris")
except Exception:  # image sans base tz : heure UTC, comme avant
    _PARIS = None


def _heure_paris(d: datetime) -> datetime:
    """notes_tickets.date_creation est un TIMESTAMP naïf en UTC (CURRENT_TIMESTAMP, serveur en UTC)."""
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(_PARIS) if _PARIS else d


def _entier(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _ticket_et_dernier_envoi(ticket_id: int):
    with get_cursor() as cur:
        cur.execute("""
            SELECT t.*, c.nom AS client_nom, c.prenom AS client_prenom,
                   c.telephone AS client_tel, c.email AS client_email,
                   (SELECT MAX(n.date_creation) FROM notes_tickets n
                     WHERE n.ticket_id = t.id AND n.type_note = 'caisse') AS caisse_envoyee_le
            FROM tickets t JOIN clients c ON t.client_id = c.id
            WHERE t.id = %s
        """, (ticket_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Ticket non trouvé")
    return dict(row)


def _envoyer(ticket_id, user: dict, montant: float, libelle: str, ticket_code: str,
             client: dict, payment: str = "-1", force: bool = False, deja_le=None):
    cfg = config_caisse()
    if not cfg["CAISSE_SHOPID"] or not cfg["CAISSE_APIKEY"]:
        raise HTTPException(400, "Caisse non configurée")
    if montant <= 0:
        raise HTTPException(400, "Montant à 0 : rien à envoyer")
    if deja_le and not force:
        le = _heure_paris(deja_le)
        raise HTTPException(409, detail={
            "code": "deja_envoye",
            "message": f"Vente déjà envoyée en caisse le {le:%d/%m à %H:%M}. Renvoyer créera une seconde vente.",
            "date": le.isoformat(),
        })

    if ticket_id:
        with _EN_COURS_LOCK:
            if ticket_id in _EN_COURS:
                raise HTTPException(409, detail={
                    "code": "envoi_en_cours",
                    "message": "Envoi en caisse déjà en cours pour ce ticket.",
                })
            _EN_COURS.add(ticket_id)
    try:
        ok, message, order_id = poster_vente(cfg, montant, libelle, ticket_code, client, payment)
        if ok and ticket_id:
            commande = f" (commande #{order_id})" if order_id else ""
            with get_cursor() as cur:
                cur.execute("""
                    INSERT INTO notes_tickets (ticket_id, auteur, contenu, important, type_note)
                    VALUES (%s, %s, %s, FALSE, 'caisse')
                """, (
                    ticket_id,
                    (user or {}).get("sub") or "Staff",
                    f"Vente envoyée en caisse — {montant:.2f} € TTC{commande}",
                ))
    finally:
        if ticket_id:
            with _EN_COURS_LOCK:
                _EN_COURS.discard(ticket_id)
    return ok, message


@router.post("/send")
def send_to_caisse(
    ticket_id: int,
    payment_mode: int = -1,
    force: bool = False,
    user: dict = Depends(get_current_user),
):
    """Envoie un ticket vers caisse.enregistreuse.fr (legacy)"""
    t = _ticket_et_dernier_envoi(ticket_id)
    montant, libelle = vente_ticket(t)
    client = {"nom": t.get("client_nom"), "prenom": t.get("client_prenom"),
              "telephone": t.get("client_tel"), "email": t.get("client_email")}
    ok, message = _envoyer(
        ticket_id, user, montant, libelle, t.get("ticket_code") or "", client,
        payment=str(payment_mode), force=force, deja_le=t.get("caisse_envoyee_le"),
    )
    if not ok:
        raise HTTPException(400, message)
    return {"success": True, "message": message}


@router.post("/envoyer")
def envoyer_caisse(data: dict, user: dict = Depends(get_current_user)):
    """Envoie une vente vers caisse.enregistreuse.fr (sans mode de paiement).

    Avec ticket_id, montant et libellé sont recalculés depuis le ticket (le
    montant envoyé par le navigateur est ignoré) ; force=true pour renvoyer.
    """
    ticket_id = _entier(data.get("ticket_id"))
    force = bool(data.get("force"))
    if ticket_id:
        t = _ticket_et_dernier_envoi(ticket_id)
        montant, libelle = vente_ticket(t)
        ticket_code = t.get("ticket_code") or ""
        client = {"nom": t.get("client_nom"), "prenom": t.get("client_prenom"),
                  "telephone": t.get("client_tel"), "email": t.get("client_email")}
        deja_le = t.get("caisse_envoyee_le")
    else:
        try:
            montant = round(float(data.get("montant", 0) or 0), 2)
        except (TypeError, ValueError):
            raise HTTPException(400, "Montant invalide")
        libelle = str(data.get("description", "Réparation") or "Réparation")
        ticket_code = str(data.get("ticket_code", "") or "")
        client = {k: str(data.get(k, "") or "") for k in ("nom", "prenom", "telephone", "email")}
        deja_le = None

    ok, message = _envoyer(ticket_id, user, montant, libelle, ticket_code, client,
                           force=force, deja_le=deja_le)
    return {"result": "OK" if ok else "KO", "message": message, "montant": montant}


@router.get("/rayons")
def get_rayons(user: dict = Depends(get_current_user)):
    """Récupère la liste des rayons/départements depuis caisse.enregistreuse.fr."""
    cfg = config_caisse()
    shopid = cfg["CAISSE_SHOPID"]
    apikey = cfg["CAISSE_APIKEY"]

    if not shopid or not apikey:
        raise HTTPException(400, "Caisse non configurée (SHOPID ou APIKEY manquant)")

    try:
        with httpx.Client(timeout=15) as client:
            res = client.get(
                "https://caisse.enregistreuse.fr/workers/getDepartments.php",
                params={"shopID": shopid, "key": apikey, "format": "json"},
            )

        if res.status_code != 200:
            raise HTTPException(502, f"Erreur caisse: HTTP {res.status_code}")

        data = res.json()
        # data peut être une liste ou un dict avec les rayons
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and "departments" in data:
            return data["departments"]
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Erreur récupération rayons: {e}")
