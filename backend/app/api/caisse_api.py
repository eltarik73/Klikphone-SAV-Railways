"""
API Caisse Enregistreuse — envoyer ticket vers le POS.
"""

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
    """Envoie un ticket vers caisse.enregistreuse.fr"""
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
