"""
API Caisse Enregistreuse — envoyer ticket vers le POS.
"""

import json
from fastapi import APIRouter, Depends, HTTPException

from app.database import get_cursor
from app.api.auth import get_current_user
from app.services.caisse import envoyer_vers_caisse

router = APIRouter(prefix="/api/caisse", tags=["caisse"])


@router.post("/send")
async def send_to_caisse(
    ticket_id: int,
    payment_mode: int = -1,
    user: dict = Depends(get_current_user),
):
    """Envoie un ticket vers caisse.enregistreuse.fr (legacy)"""
    with get_cursor() as cur:
        cur.execute("""
            SELECT t.*, c.nom as client_nom, c.prenom as client_prenom,
                   c.telephone as client_tel, c.email as client_email
            FROM tickets t JOIN clients c ON t.client_id = c.id
            WHERE t.id = %s
        """, (ticket_id,))
        row = cur.fetchone()

    if not row:
        raise HTTPException(404, "Ticket non trouvé")

    success, message = envoyer_vers_caisse(row, payment_mode if payment_mode != -1 else None)

    if not success:
        raise HTTPException(400, message)

    return {"success": True, "message": message}


@router.post("/envoyer")
async def envoyer_caisse(data: dict, user: dict = Depends(get_current_user)):
    """Envoie une vente vers caisse.enregistreuse.fr (sans mode de paiement)."""
    import httpx

    def _get_param(key, default=""):
        with get_cursor() as cur:
            cur.execute("SELECT valeur FROM params WHERE cle = %s", (key,))
            row = cur.fetchone()
        return row["valeur"] if row else default

    shopid = _get_param("CAISSE_SHOPID")
    apikey = _get_param("CAISSE_APIKEY")
    caisse_id = _get_param("CAISSE_ID", "49343")
    user_id = _get_param("CAISSE_USER_ID", "42867")
    delivery_method = _get_param("CAISSE_DELIVERY_METHOD", "4")

    if not shopid or not apikey:
        raise HTTPException(400, "Caisse non configurée")

    montant = float(data.get("montant", 0))
    if montant <= 0:
        raise HTTPException(400, "Montant à 0 : rien à envoyer")

    description = data.get("description", "Réparation")

    api_url = (
        f"https://caisse.enregistreuse.fr/workers/webapp.php?"
        f"idboutique={shopid}&key={apikey}&idUser={user_id}"
        f"&idcaisse={caisse_id}&payment=-1&deliveryMethod={delivery_method}"
    )

    payload = [
        ("publicComment", f"Ticket: {data.get('ticket_code', '')}"),
        ("itemsList[]", f"Free_{montant:.2f}_{description}"),
    ]

    nom = data.get("nom", "")
    prenom = data.get("prenom", "")
    if nom or prenom:
        payload += [
            ("client[nom]", nom),
            ("client[prenom]", prenom),
            ("client[telephone]", data.get("telephone", "")),
        ]
        if data.get("email"):
            payload.append(("client[email]", data["email"]))

    try:
        with httpx.Client(timeout=15) as client:
            res = client.post(api_url, data=payload)

        try:
            result = res.json()
        except Exception:
            txt = (res.text or "").strip()
            if txt.isdigit() or "OK" in txt.upper():
                result = {"result": "OK", "orderID": txt}
            else:
                result = {"result": "KO", "errorMessage": txt[:200]}

        # Log to notes
        ticket_id = data.get("ticket_id")
        if ticket_id:
            with get_cursor() as cur:
                cur.execute("""
                    INSERT INTO notes_tickets (ticket_id, auteur, contenu, is_important, type_note)
                    VALUES (%s, %s, %s, FALSE, 'caisse')
                """, (
                    ticket_id,
                    user.get("utilisateur", "Système"),
                    f"Vente envoyée en caisse — {montant:.2f} €",
                ))

        if str(result.get("result", "")).upper() == "OK":
            order_id = result.get("orderID", "")
            return {"result": "OK", "message": f"Vente créée ! Commande #{order_id}"}
        else:
            return {"result": "KO", "message": result.get("errorMessage", str(result))}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
