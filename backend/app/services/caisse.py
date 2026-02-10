"""
Service d'intégration avec caisse.enregistreuse.fr
Reprend exactement la logique de l'app Streamlit.
"""

import httpx
from app.database import get_cursor


def _get_param(key: str) -> str:
    with get_cursor() as cur:
        cur.execute("SELECT valeur FROM params WHERE cle = %s", (key,))
        row = cur.fetchone()
    return row["valeur"] if row else ""


def envoyer_vers_caisse(ticket: dict, payment_override: int = None):
    """Envoie un ticket de réparation vers caisse.enregistreuse.fr"""
    try:
        apikey = _get_param("CAISSE_APIKEY")
        shopid = _get_param("CAISSE_SHOPID")
        if not apikey or not shopid:
            return False, "Configuration API manquante (APIKEY ou SHOPID)"

        caisse_id = (_get_param("CAISSE_ID") or "49343").strip()
        user_id = (_get_param("CAISSE_USER_ID") or "42867").strip()

        if not caisse_id.isdigit():
            return False, f"CAISSE_ID invalide: '{caisse_id}'"
        if not user_id.isdigit():
            return False, f"CAISSE_USER_ID invalide: '{user_id}'"

        delivery_method = (_get_param("CAISSE_DELIVERY_METHOD") or "4").strip()
        if not delivery_method.isdigit():
            delivery_method = "4"

        payment_mode = str(payment_override) if payment_override is not None else "-1"

        devis = float(ticket.get("devis_estime") or 0)
        prix_supp = float(ticket.get("prix_supp") or 0)
        total = devis + prix_supp
        if total <= 0:
            return False, "Montant total à 0 : rien à envoyer"

        modele_txt = f"{ticket.get('marque', '')} {ticket.get('modele', '')}".strip()
        panne_txt = (ticket.get("panne") or "").strip()
        if ticket.get("panne_detail"):
            panne_txt += f" ({ticket['panne_detail']})"

        description = f"Reparation {modele_txt} - {panne_txt}".strip()
        if ticket.get("type_ecran"):
            description += f" [{ticket['type_ecran']}]"
        description = description.replace("_", " ")

        api_url = (
            f"https://caisse.enregistreuse.fr/workers/webapp.php?"
            f"idboutique={shopid}&key={apikey}&idUser={user_id}"
            f"&idcaisse={caisse_id}&payment={payment_mode}&deliveryMethod={delivery_method}"
        )

        payload = [("publicComment", f"Ticket: {ticket.get('ticket_code', '')}")]

        if ticket.get("client_nom") or ticket.get("client_prenom"):
            payload += [
                ("client[nom]", ticket.get("client_nom", "")),
                ("client[prenom]", ticket.get("client_prenom", "")),
                ("client[telephone]", ticket.get("client_tel", "")),
            ]
            if ticket.get("client_email"):
                payload.append(("client[email]", ticket.get("client_email")))

        if ticket.get("reparation_supp") and prix_supp > 0:
            payload.append(("itemsList[]", f"Free_{devis:.2f}_{description}"))
            rep_supp = (ticket.get("reparation_supp") or "Reparation supplementaire").replace("_", " ")
            payload.append(("itemsList[]", f"Free_{prix_supp:.2f}_{rep_supp}"))
        else:
            payload.append(("itemsList[]", f"Free_{total:.2f}_{description}"))

        with httpx.Client(timeout=15) as client:
            res = client.post(api_url, data=payload)

        if res.status_code != 200:
            return False, f"HTTP {res.status_code}: {res.text[:300]}"

        try:
            data = res.json()
            result = str(data.get("result", "")).upper()
            if result == "OK":
                order_id = data.get("orderID", "")
                return True, f"✅ Vente créée ! Commande #{order_id}"
            return False, f"Erreur API: {data.get('errorMessage', data)}"
        except Exception:
            txt = (res.text or "").strip()
            if txt.isdigit() or "OK" in txt.upper():
                return True, f"✅ Vente créée ! ID: {txt}"
            return False, f"Réponse: {txt[:300]}"

    except Exception as e:
        return False, f"Erreur: {e}"
