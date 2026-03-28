"""
Service d'intégration avec caisse.enregistreuse.fr
Integration avec caisse.enregistreuse.fr.
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

        # Calculate total with reduction (tarif_final already includes reduction)
        tarif_final = float(ticket.get("tarif_final") or 0)
        if tarif_final > 0:
            total = tarif_final
        else:
            devis = float(ticket.get("devis_estime") or 0)
            prix_supp = float(ticket.get("prix_supp") or 0)
            subtotal = devis + prix_supp
            red_pct = float(ticket.get("reduction_pourcentage") or 0)
            red_mnt = float(ticket.get("reduction_montant") or 0)
            reduction = subtotal * (red_pct / 100) if red_pct > 0 else red_mnt
            total = max(0, subtotal - reduction)
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

        # Rayon ID pour rattacher la TVA (configuré dans le POS)
        rayon_id = (_get_param("CAISSE_RAYON_ID") or "").strip()

        api_url = "https://caisse.enregistreuse.fr/workers/webapp.php"

        # Format: -[idRayon]_[prix]_[titre] pour avoir la TVA du rayon
        #         Free_[prix]_[titre] si pas de rayon configuré
        def _item(prix, titre):
            if rayon_id and rayon_id.isdigit():
                return f"-{rayon_id}_{prix:.2f}_{titre}"
            return f"Free_{prix:.2f}_{titre}"

        # Tout dans le POST body (format tuples pour PHP)
        payload = [
            ("shopID", shopid),
            ("idboutique", shopid),
            ("key", apikey),
            ("idUser", user_id),
            ("idcaisse", caisse_id),
            ("payment", payment_mode),
            ("deliveryMethod", delivery_method),
            ("publicComment", f"Ticket: {ticket.get('ticket_code', '')}"),
        ]

        if ticket.get("client_nom") or ticket.get("client_prenom"):
            payload += [
                ("client[nom]", ticket.get("client_nom", "")),
                ("client[prenom]", ticket.get("client_prenom", "")),
                ("client[telephone]", ticket.get("client_tel", "")),
            ]
            if ticket.get("client_email"):
                payload.append(("client[email]", ticket.get("client_email")))

        payload.append(("itemsList[]", _item(total, description)))

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
