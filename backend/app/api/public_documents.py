"""
Documents client accessibles sans connexion, par le jeton aléatoire
tickets.suivi_token (liens envoyés par WhatsApp, SMS ou e-mail).

Seuls le ticket de dépôt, le devis et le reçu sont exposés : jamais la fiche
atelier (PIN, schéma, notes internes) ni le document combiné.
"""

import os
import re
import secrets
import threading
from collections import OrderedDict, deque
from time import time

from fastapi import APIRouter, HTTPException, Request

from app.database import get_cursor
from app.api.print_tickets import (
    _get_frontend_url, _get_ticket_by_token, html_document, pdf_response, pdf_ticket, render_html,
)

router = APIRouter(prefix="/api/public/documents", tags=["documents-publics"])

TYPES_HTML = ("client", "devis", "recu")
TYPES_PDF = ("devis", "recu")
_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")

_HOTE_RE = re.compile(r"^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9A-Fa-f:]+\])(?::\d{1,5})?$")


def ip_client(request: Request) -> str:
    # Le proxy Railway ajoute l'IP réelle en fin de X-Forwarded-For : les valeurs
    # précédentes sont fournies par le client et donc falsifiables.
    xff = request.headers.get("x-forwarded-for", "")
    dernier = xff.split(",")[-1].strip() if xff else ""
    if dernier:
        return dernier
    return request.client.host if request.client else "inconnu"


class LimiteurDebit:
    """Fenêtre glissante par IP, mémoire bornée, sûre en threadpool (routes en def)."""

    def __init__(self, limite: int, fenetre: float, max_ips: int = 5000):
        self.limite = limite
        self.fenetre = fenetre
        self.max_ips = max_ips
        self._buckets: "OrderedDict[str, deque]" = OrderedDict()
        self._verrou = threading.Lock()

    def verifier(self, cle: str):
        now = time()
        with self._verrou:
            bucket = self._buckets.pop(cle, None) or deque()
            while bucket and now - bucket[0] > self.fenetre:
                bucket.popleft()
            refuse = len(bucket) >= self.limite
            if not refuse:
                bucket.append(now)
            # Réinsérée en fin : l'ordre du dict suit le dernier accès, la purge part du début
            self._buckets[cle] = bucket
            while self._buckets:
                plus_ancienne = next(iter(self._buckets.values()))
                if (len(self._buckets) > self.max_ips or not plus_ancienne
                        or now - plus_ancienne[-1] > self.fenetre):
                    self._buckets.popitem(last=False)
                else:
                    break
        if refuse:
            raise HTTPException(429, "Trop de requêtes — attendez 1 minute avant de réessayer.")

    def __len__(self):
        return len(self._buckets)


_LIMITEUR = LimiteurDebit(limite=30, fenetre=60)


def _rate_limit(request: Request):
    _LIMITEUR.verifier(ip_client(request))


def _ticket_par_jeton(token: str) -> dict:
    # Même réponse pour un jeton mal formé ou inconnu : pas d'indice à l'énumération
    t = _get_ticket_by_token(token) if _TOKEN_RE.match(token or "") else None
    if not t:
        raise HTTPException(404, "Document introuvable")
    return t


def nouveau_jeton() -> str:
    return secrets.token_urlsafe(16)


def jeton_suivi(ticket_id: int):
    """Jeton du ticket, créé à la volée pour les tickets qui n'en ont pas encore."""
    with get_cursor() as cur:
        cur.execute("SELECT suivi_token FROM tickets WHERE id = %s", (ticket_id,))
        row = cur.fetchone()
        if not row:
            return None
        if row["suivi_token"]:
            return row["suivi_token"]
        cur.execute(
            "UPDATE tickets SET suivi_token = %s WHERE id = %s AND suivi_token IS NULL RETURNING suivi_token",
            (nouveau_jeton(), ticket_id),
        )
        row = cur.fetchone()
        if row:
            return row["suivi_token"]
        cur.execute("SELECT suivi_token FROM tickets WHERE id = %s", (ticket_id,))
        row = cur.fetchone()
        return row["suivi_token"] if row else None


def _origine_requete(request: Request):
    """Origine vue par l'équipe (même domaine que le front, qui sert /api)."""
    proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower() or request.url.scheme
    hote = request.headers.get("x-forwarded-host", "").split(",")[0].strip() or request.headers.get("host", "")
    if proto in ("http", "https") and _HOTE_RE.match(hote or ""):
        return f"{proto}://{hote}"
    return None


def _base_publique(request: Request = None) -> str:
    """Origine publique du backend : BACKEND_URL, sinon celle de la requête, sinon URL_SUIVI."""
    env = os.getenv("BACKEND_URL", "").strip()
    if env.startswith("http"):
        return env.rstrip("/")
    origine = _origine_requete(request) if request is not None else None
    return origine or _get_frontend_url()


def liens_partage(token: str, request: Request = None) -> dict:
    base = f"{_base_publique(request)}/api/public/documents/{token}"
    return {
        "client": f"{base}/client",
        "devis": f"{base}/devis",
        "recu": f"{base}/recu",
        "devis_pdf": f"{base}/devis.pdf",
        "recu_pdf": f"{base}/recu.pdf",
    }


# Déclarée avant la route HTML, qui capturerait sinon « devis.pdf »
@router.get("/{token}/{doc_type}.pdf")
def document_public_pdf(token: str, doc_type: str, request: Request):
    _rate_limit(request)
    if doc_type not in TYPES_PDF:
        raise HTTPException(404, "Document introuvable")
    t = _ticket_par_jeton(token)
    pdf_bytes, filename = pdf_ticket(t, doc_type)
    return pdf_response(pdf_bytes, filename)


@router.get("/{token}/{doc_type}")
def document_public(token: str, doc_type: str, request: Request):
    _rate_limit(request)
    if doc_type not in TYPES_HTML:
        raise HTTPException(404, "Document introuvable")
    t = _ticket_par_jeton(token)
    return html_document(render_html(t, doc_type))
