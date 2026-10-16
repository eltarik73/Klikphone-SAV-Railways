"""
Integration avec caisse.enregistreuse.fr.

Montant et libellé de la vente sont calculés côté serveur à partir du ticket
(services/montants.py et services/prestations.py), comme sur les documents.
"""

import httpx

from app.services import params as params_cache
from app.services.montants import calculer_montants

API_URL = "https://caisse.enregistreuse.fr/workers/webapp.php"
_LIBELLE_MAX = 150


def config_caisse() -> dict:
    """Paramètres caisse (cache services/params) ; la base prime, sinon les variables Railway."""
    from app.api.config import CAISSE_DEFAULTS
    cles = list(CAISSE_DEFAULTS) + ["CAISSE_DELIVERY_METHOD", "CAISSE_RAYON_ID"]
    lus = params_cache.get_params(cles)
    cfg = {k: str(lus.get(k) or CAISSE_DEFAULTS.get(k, "") or "").strip() for k in cles}
    if not cfg["CAISSE_ID"].isdigit():
        cfg["CAISSE_ID"] = "49343"
    if not cfg["CAISSE_USER_ID"].isdigit():
        cfg["CAISSE_USER_ID"] = "42867"
    if not cfg["CAISSE_DELIVERY_METHOD"].isdigit():
        cfg["CAISSE_DELIVERY_METHOD"] = "4"
    return cfg


def _appareil(ticket: dict) -> str:
    autre = str(ticket.get("modele_autre") or "").strip()
    if autre:
        return autre
    return " ".join(str(p).strip() for p in (ticket.get("marque"), ticket.get("modele")) if p and str(p).strip())


def vente_ticket(ticket: dict) -> tuple:
    """(montant TTC, libellé) de la vente : « lignes - appareil [type écran] ».

    Le montant est le TOTAL du ticket, acompte compris (comme avant) : si l'acompte
    a déjà été saisi au POS au dépôt, il y est compté deux fois. À trancher avec la
    gérance avant de passer au reste dû.
    """
    m = calculer_montants(ticket)
    lignes = [r for r in m["lignes"] if r["label"]]
    libelle = " + ".join(r["label"] for r in lignes) or str(ticket.get("panne") or "Réparation").strip()
    appareil = _appareil(ticket)
    if appareil:
        libelle = f"{libelle} - {appareil}"
    if ticket.get("type_ecran"):
        libelle += f" [{ticket['type_ecran']}]"
    # « _ » sépare les champs de l'article côté caisse
    libelle = " ".join(libelle.replace("_", " ").split())
    if len(libelle) > _LIBELLE_MAX:
        libelle = libelle[: _LIBELLE_MAX - 3].rstrip() + "..."
    return m["total"], libelle


def poster_vente(cfg: dict, montant: float, libelle: str, ticket_code: str = "",
                 client: dict = None, payment: str = "-1") -> tuple:
    """POST de la vente (jusqu'à 15 s) → (ok, message, order_id)."""
    rayon_id = cfg.get("CAISSE_RAYON_ID", "")
    titre = (libelle or "Réparation").replace("_", " ")
    if rayon_id.isdigit():
        item = f"-{rayon_id}_{montant:.2f}_{titre}"   # TVA du rayon configuré dans le POS
    else:
        item = f"Free_{montant:.2f}_{titre}"
    shopid = cfg["CAISSE_SHOPID"]
    payload = [
        ("shopID", shopid),
        ("idboutique", shopid),
        ("key", cfg["CAISSE_APIKEY"]),
        ("idUser", cfg["CAISSE_USER_ID"]),
        ("idcaisse", cfg["CAISSE_ID"]),
        ("payment", str(payment)),
        ("deliveryMethod", cfg["CAISSE_DELIVERY_METHOD"]),
        ("publicComment", f"Ticket: {ticket_code}"),
        ("itemsList[]", item),
    ]
    client = client or {}
    if client.get("nom") or client.get("prenom"):
        payload += [
            ("client[nom]", client.get("nom") or ""),
            ("client[prenom]", client.get("prenom") or ""),
            ("client[telephone]", client.get("telephone") or ""),
        ]
        if client.get("email"):
            payload.append(("client[email]", client["email"]))

    try:
        with httpx.Client(timeout=15) as http:
            res = http.post(API_URL, data=payload)
    except Exception as e:
        return False, f"Caisse injoignable : {e}", None
    try:
        data = res.json()
    except Exception:
        txt = (res.text or "").strip()
        if res.status_code == 200 and (txt.isdigit() or "OK" in txt.upper()):
            return True, f"Vente créée ! Commande #{txt}", txt
        return False, f"Réponse caisse : {txt[:200] or res.status_code}", None
    if isinstance(data, dict) and str(data.get("result", "")).upper() == "OK":
        order_id = str(data.get("orderID", "") or "")
        return True, f"Vente créée ! Commande #{order_id}", order_id
    detail = data.get("errorMessage", data) if isinstance(data, dict) else data
    return False, f"Erreur caisse : {str(detail)[:200]}", None


def envoyer_vers_caisse(ticket: dict, payment_override: int = None):
    """Envoie un ticket de réparation vers caisse.enregistreuse.fr → (ok, message)."""
    cfg = config_caisse()
    if not cfg["CAISSE_APIKEY"] or not cfg["CAISSE_SHOPID"]:
        return False, "Configuration API manquante (APIKEY ou SHOPID)"
    montant, libelle = vente_ticket(ticket)
    if montant <= 0:
        return False, "Montant total à 0 : rien à envoyer"
    client = {
        "nom": ticket.get("client_nom"), "prenom": ticket.get("client_prenom"),
        "telephone": ticket.get("client_tel"), "email": ticket.get("client_email"),
    }
    payment = str(payment_override) if payment_override is not None else "-1"
    ok, message, _ = poster_vente(cfg, montant, libelle, ticket.get("ticket_code", ""), client, payment)
    return ok, message
