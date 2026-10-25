"""Preuve unique du suivi client (suivi.preuve_suivi).

Les codes KP-000123 sont séquentiels : aucune route publique ne rend une donnée d'un
ticket au seul code. Preuve acceptée : jeton « t » du QR / lien envoyé, OU numéro de
téléphone COMPLET donné au dépôt (fiche client ou tickets.tel_contact), OU session du
personnel. Refus 403 {"code": preuve_requise | verification_echouee | lien_invalide}.

Partie « base réelle » (PostgreSQL JETABLE, données fictives, migrations du lifespan rejouées) :
    KP_SUIVI_DATABASE_URL="postgresql://postgres:<mdp>@127.0.0.1:55432/kp_suivi?sslmode=disable" \\
        pytest tests/test_suivi_preuve.py
Sans la variable, cette partie est ignorée (skip).
"""

import os
import sys
from contextlib import contextmanager
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.api import auth, fidelite as fidelite_api, suivi as suivi_api, tickets as tickets_api
from app.api.auth import create_token

CODE = "KP-000042"
JETON = "JetonValide_0123456789"
TEL_CLIENT = "0612345679"            # téléphone de la fiche client (forme stockée)
TEL_CONTACT = "+41 79 123 45 67"      # second numéro de contact du dépôt (tickets.tel_contact)
STAFF = {"Authorization": f"Bearer {create_token('accueil', 'Sophie')}"}

# Toutes les routes publiques qui désignent un ticket par son code
ROUTES_GET = [
    "/api/tickets/code/{}",
    "/api/parts/public/{}",
    "/api/suivi/{}/has-avis",
    "/api/fidelite/ticket/{}",
    "/api/fidelite/grattage/{}",
]
ROUTES_POST = [
    ("/api/suivi/{}/message", {"message": "Bonjour"}),
    ("/api/suivi/{}/valider-devis", {"accepte": False}),
    ("/api/suivi/{}/avis", {"note": 5}),
    ("/api/fidelite/grattage/{}/etat", {}),
    ("/api/fidelite/grattage/{}", {}),
]
# Jamais dans une réponse publique
CONFIDENTIEL = ("telephone", "client_tel", "tel_contact", "suivi_token", "email", "pin", "pattern",
                "imei", "notes_internes", "client_id", "client_nom", "client_prenom", TEL_CLIENT, "0612345679",
                "791234567", JETON)


# ── Base simulée ────────────────────────────────────────────────────

class FakeCursor:
    def __init__(self, handler):
        self.handler = handler
        self.executed = []
        self._last = None
        self.rowcount = 0

    def execute(self, sql, params=None):
        sql = " ".join(str(sql).split())
        self.executed.append((sql, params))
        self._last = self.handler(sql, params)

    def fetchone(self):
        r = self._last
        if isinstance(r, list):
            return r[0] if r else None
        return r

    def fetchall(self):
        r = self._last
        if r is None:
            return []
        return r if isinstance(r, list) else [r]


TICKET = {"id": 42, "ticket_code": CODE, "statut": "Clôturé", "marque": "Marque", "modele": "Fictif",
          "modele_autre": None, "panne": "Écran", "panne_detail": None, "date_depot": None, "date_maj": None,
          "date_recuperation": None, "source": None, "devis_estime": 89, "acompte": 0, "reduction_montant": None,
          "reduction_pourcentage": None, "reparation_supp": None, "commande_piece": None, "commentaire_client": None,
          "prix_supp": None, "tarif_final": 89, "paye": 1, "issue": None}


def _handler(sql, params):
    if "t.tel_contact, c.telephone AS client_tel" in sql:            # preuve_suivi
        if params[0] != CODE:
            return None
        return {"id": 42, "statut": "Clôturé", "ticket_code": CODE, "suivi_token": JETON,
                "tel_contact": TEL_CONTACT, "client_tel": TEL_CLIENT}
    if sql.startswith("SELECT t.id, t.ticket_code, t.statut") and "WHERE t.id = %s" in sql:
        return dict(TICKET)
    if "FROM commandes_pieces c WHERE c.ticket_id" in sql:
        return [{"id": 1, "piece": "Écran", "statut": "Reçu", "date_commande": None, "date_reception": None}]
    if "type_note = 'avis_client'" in sql:
        return None
    if sql.startswith("SELECT client_id FROM tickets WHERE id"):
        return {"client_id": 7}
    if "grattage_fait, grattage_gain FROM tickets WHERE id" in sql:
        return {"id": 42, "client_id": 7, "ticket_code": CODE, "statut": "Clôturé", "paye": 1,
                "grattage_fait": False, "grattage_gain": None}
    if "FROM tickets t LEFT JOIN clients c" in sql:                   # détails pour la notif
        return {"statut": "En attente d'accord client", "technicien_assigne": None, "panne": "Écran",
                "client_prenom": "Jean", "client_nom": "Fictif"}
    return None


FIDELITE_PUBLIQUE = {"active": True, "points": 120, "pts_par_euro": 10, "palier_film": 1000,
                     "palier_reduction": 5000, "montant_reduction": "10", "prochaine_recompense": None,
                     "recompenses_disponibles": []}


@pytest.fixture
def faux():
    cur = FakeCursor(_handler)

    @contextmanager
    def gc(*a, **k):
        yield cur

    auth.reset_essais()
    suivi_api._LIMITEUR._buckets.clear()
    with patch("app.api.suivi.get_cursor", gc), patch("app.api.tickets.get_cursor", gc), \
            patch("app.api.parts.get_cursor", gc), patch("app.api.fidelite.get_cursor", gc), \
            patch("app.api.suivi.push_notification", lambda **k: None), \
            patch("app.api.fidelite.get_fidelite", lambda cid, user=None: dict(FIDELITE_PUBLIQUE)), \
            patch.object(fidelite_api.secrets, "randbelow", return_value=1):
        yield cur
    auth.reset_essais()
    suivi_api._LIMITEUR._buckets.clear()


def _ip(n=1):
    return {"X-Forwarded-For": f"6.6.6.6, 10.9.9.{n}"}


def _get(client, route, code=CODE, **kw):
    return client.get(route.format(code), **kw)


def _post(client, route, body, code=CODE, **kw):
    return client.post(route.format(code), json=body, **kw)


# ── Code seul : rien ──────────────────────────────────────────────

@pytest.mark.parametrize("route", ROUTES_GET)
def test_get_code_seul_refuse(client, faux, route):
    r = _get(client, route, headers=_ip())
    assert r.status_code == 403, r.text
    assert r.json()["detail"]["code"] == "preuve_requise"
    for mot in ("Écran", "Clôturé", "Marque", "points", "has_avis", "eligible"):
        assert mot not in r.text


@pytest.mark.parametrize("route,body", ROUTES_POST)
def test_post_code_seul_refuse(client, faux, route, body):
    r = _post(client, route, body, headers=_ip())
    assert r.status_code == 403, r.text
    assert r.json()["detail"]["code"] == "preuve_requise"
    assert not [s for s, _ in faux.executed if s.startswith(("UPDATE", "INSERT"))]


@pytest.mark.parametrize("route", ROUTES_GET)
def test_tel4_n_est_plus_une_preuve(client, faux, route):
    r = _get(client, route, params={"tel4": TEL_CLIENT[-4:]}, headers=_ip())
    assert r.status_code == 403 and r.json()["detail"]["code"] == "preuve_requise"


def test_tel4_dans_le_corps_ignore(client, faux):
    r = _post(client, "/api/suivi/{}/message", {"message": "x", "tel4": TEL_CLIENT[-4:]}, headers=_ip())
    assert r.status_code == 403 and r.json()["detail"]["code"] == "preuve_requise"


# ── Jeton du lien ─────────────────────────────────────────────────

@pytest.mark.parametrize("route", ROUTES_GET)
def test_get_jeton_valide(client, faux, route):
    r = _get(client, route, params={"t": JETON}, headers=_ip())
    assert r.status_code == 200, r.text
    for mot in CONFIDENTIEL:
        assert mot not in r.text, (route, mot)


@pytest.mark.parametrize("route,body", ROUTES_POST)
def test_post_jeton_valide_corps_ou_query(client, faux, route, body):
    # 409 : le devis d'un ticket Clôturé n'est plus à trancher (preuve acceptée, garde de statut)
    r = _post(client, route, {**body, "t": JETON}, headers=_ip())
    assert r.status_code in (200, 409), (route, r.text)
    r = _post(client, route, body, params={"t": JETON}, headers=_ip(2))
    assert r.status_code in (200, 409), (route, r.text)


def test_jeton_invalide_sans_numero(client, faux):
    r = _get(client, "/api/tickets/code/{}", params={"t": "MauvaisJeton_012345678"}, headers=_ip())
    assert r.status_code == 403 and r.json()["detail"]["code"] == "lien_invalide"


def test_jeton_invalide_mais_bon_numero(client, faux):
    """Vieux lien + numéro saisi : le numéro l'emporte."""
    r = _get(client, "/api/tickets/code/{}", params={"t": "MauvaisJeton_012345678", "tel": TEL_CLIENT}, headers=_ip())
    assert r.status_code == 200


def test_jeton_mal_forme_n_est_pas_compare(client, faux):
    r = _get(client, "/api/tickets/code/{}", params={"t": "court"}, headers=_ip())
    assert r.status_code == 403 and r.json()["detail"]["code"] == "lien_invalide"


# ── Numéro complet ────────────────────────────────────────────────

@pytest.mark.parametrize("tel", ["06 12 34 56 79", "+33612345679", "0033612345679", "06.12.34.56.79", "0612345679"])
def test_numero_complet_tous_formats(client, faux, tel):
    r = _get(client, "/api/tickets/code/{}", params={"tel": tel}, headers=_ip())
    assert r.status_code == 200, r.text
    assert r.json()["ticket_code"] == CODE and "montants" in r.json()


@pytest.mark.parametrize("tel", ["+41 79 123 45 67", "0041791234567", "+41791234567"])
def test_second_numero_de_contact_accepte(client, faux, tel):
    r = _get(client, "/api/tickets/code/{}", params={"tel": tel}, headers=_ip())
    assert r.status_code == 200, r.text


@pytest.mark.parametrize("route", ROUTES_GET)
def test_get_numero_complet_toutes_routes(client, faux, route):
    r = _get(client, route, params={"tel": "06 12 34 56 79"}, headers=_ip())
    assert r.status_code == 200, r.text
    for mot in CONFIDENTIEL:
        assert mot not in r.text, (route, mot)


@pytest.mark.parametrize("route,body", ROUTES_POST)
def test_post_numero_complet_dans_le_corps(client, faux, route, body):
    r = _post(client, route, {**body, "tel": "06 12 34 56 79"}, headers=_ip())
    assert r.status_code in (200, 409), (route, r.text)


@pytest.mark.parametrize("tel", ["06 12 34 56 78", "+33612345678", "079 123 45 67"])
def test_mauvais_numero(client, faux, tel):
    r = _get(client, "/api/tickets/code/{}", params={"tel": tel}, headers=_ip())
    assert r.status_code == 403 and r.json()["detail"]["code"] == "verification_echouee"
    assert "Écran" not in r.text


@pytest.mark.parametrize("tel", ["5679", "06 12", "0612345", "abc"])
def test_numero_partiel_refuse_sans_etre_compte(client, faux, tel):
    for _ in range(8):   # plus que le seuil de verrouillage : pas de 429, pas compté
        r = _get(client, "/api/tickets/code/{}", params={"tel": tel}, headers=_ip(3))
        assert r.status_code == 403 and r.json()["detail"]["code"] == "verification_echouee"


def test_mauvais_numero_verrouille_progressivement(client, faux):
    codes = [_get(client, "/api/tickets/code/{}", params={"tel": f"06 00 00 {i:02d} 00"}, headers=_ip(7)).status_code
             for i in range(6)]
    assert codes == [403, 403, 403, 403, 429, 429]
    # Le verrou vaut pour (IP, code) : le bon numéro est bloqué aussi tant qu'il dure…
    assert _get(client, "/api/tickets/code/{}", params={"tel": TEL_CLIENT}, headers=_ip(7)).status_code == 429
    # …mais une autre IP n'est pas concernée, et le jeton non plus
    assert _get(client, "/api/tickets/code/{}", params={"tel": TEL_CLIENT}, headers=_ip(8)).status_code == 200
    assert _get(client, "/api/tickets/code/{}", params={"t": JETON}, headers=_ip(7)).status_code == 200


def test_bon_numero_remet_le_compteur_a_zero(client, faux):
    for i in range(3):
        _get(client, "/api/tickets/code/{}", params={"tel": f"06 00 00 {i:02d} 00"}, headers=_ip(9))
    assert _get(client, "/api/tickets/code/{}", params={"tel": TEL_CLIENT}, headers=_ip(9)).status_code == 200
    codes = [_get(client, "/api/tickets/code/{}", params={"tel": f"06 00 00 {i:02d} 00"}, headers=_ip(9)).status_code
             for i in range(4)]
    assert codes == [403, 403, 403, 403]


# ── Session du personnel ──────────────────────────────────────────

@pytest.mark.parametrize("route", ROUTES_GET)
def test_staff_sans_preuve(client, faux, route):
    r = _get(client, route, headers={**STAFF, **_ip()})
    assert r.status_code == 200, r.text


def test_staff_numero_saisi_toujours_verifie(client, faux):
    """Poste connecté (tablette de la boutique) : un numéro saisi qui ne correspond ni au téléphone
    de la fiche ni au second numéro du ticket n'ouvre pas le dossier ; le bon numéro, si."""
    r = _get(client, "/api/tickets/code/{}", params={"tel": "06 00 00 09 99"}, headers={**STAFF, **_ip(30)})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "verification_echouee"
    r = _get(client, "/api/tickets/code/{}", headers={**STAFF, "X-Suivi-Tel": "06 00 00 09 99", **_ip(30)})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "verification_echouee"
    assert _get(client, "/api/tickets/code/{}", params={"tel": TEL_CLIENT}, headers={**STAFF, **_ip(30)}).status_code == 200
    r = _get(client, "/api/tickets/code/{}", params={"t": "MauvaisJeton_012345678"}, headers={**STAFF, **_ip(30)})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "lien_invalide"
    # Code inexistant avec un numéro : même refus qu'un visiteur, pas de 404
    r = _get(client, "/api/tickets/code/{}", code="KP-999999", params={"tel": TEL_CLIENT}, headers={**STAFF, **_ip(31)})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "verification_echouee"


def test_staff_jeton_perime_ignore(client, faux):
    """Un jeton de session expiré ou bidon ne vaut rien : preuve requise comme pour tout le monde."""
    r = _get(client, "/api/tickets/code/{}", headers={"Authorization": "Bearer pas.un.jeton", **_ip()})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "preuve_requise"


# ── Divers ────────────────────────────────────────────────────────

def test_ticket_inconnu_meme_reponse_qu_un_ticket_sans_preuve(client, faux):
    """Audit B : sans session, le code inexistant répond exactement comme un code existant sans
    preuve valable (pas d'oracle 404/403 sur la suite séquentielle) ; 404 réservé au staff."""
    attendus = {(): "preuve_requise", ("t",): "lien_invalide", ("tel",): "verification_echouee"}
    for cles, code_attendu in attendus.items():
        params = {k: {"t": "MauvaisJeton_012345678", "tel": "06 12 34 56 78"}[k] for k in cles}
        inconnu = _get(client, "/api/tickets/code/{}", code="KP-999999", params=params, headers=_ip(20))
        connu = _get(client, "/api/tickets/code/{}", params=params, headers=_ip(21))
        assert inconnu.status_code == connu.status_code == 403, (cles, inconnu.text, connu.text)
        assert inconnu.json() == connu.json() and inconnu.json()["detail"]["code"] == code_attendu
    # Un jeton valide ou le bon numéro sur un code inexistant : même refus que ci-dessus
    assert _get(client, "/api/tickets/code/{}", code="KP-999999", params={"t": JETON}, headers=_ip(22)).json()["detail"]["code"] == "lien_invalide"
    assert _get(client, "/api/tickets/code/{}", code="KP-999999", params={"tel": TEL_CLIENT}, headers=_ip(22)).json()["detail"]["code"] == "verification_echouee"
    # Le staff, lui, apprend que le ticket n'existe pas
    assert _get(client, "/api/tickets/code/{}", code="KP-999999", headers={**STAFF, **_ip()}).status_code == 404


def test_ticket_inconnu_numero_compte_dans_le_verrou(client, faux):
    """Les tentatives de numéro sur un code inexistant sont comptées comme sur un code existant."""
    codes = [_get(client, "/api/tickets/code/{}", code="KP-999998", params={"tel": f"06 00 00 {i:02d} 00"},
                  headers=_ip(23)).status_code for i in range(6)]
    assert codes == [403, 403, 403, 403, 429, 429]


def test_code_tolerant(client, faux):
    r = _get(client, "/api/tickets/code/{}", code="kp-000042", params={"tel": TEL_CLIENT}, headers=_ip())
    assert r.status_code == 200


@pytest.mark.parametrize("tel", ["06 12 34 56 78", "0", "06 12 34 56 79"])
def test_recherche_publique_par_telephone_supprimee(client, faux, tel):
    assert client.get(f"/api/tickets/phone/{tel}").status_code in (401, 404, 405)
    assert client.get(f"/api/tickets/phone/{tel}", headers=STAFF).status_code in (404, 405)
    assert not hasattr(tickets_api, "get_tickets_by_phone")


def test_fiche_publique_sans_coordonnees(client, faux):
    corps = _get(client, "/api/tickets/code/{}", params={"tel": TEL_CLIENT}, headers=_ip()).json()
    assert not {"pin", "pattern", "imei", "notes_internes", "client_id", "suivi_token", "tel_contact",
                "telephone", "email"} & set(corps)


def test_limite_de_debit_partagee(client, faux):
    """Une seule fenêtre par IP pour toutes les routes publiques par code."""
    n = suivi_api._LIMITEUR.limite
    routes = ROUTES_GET * (n // len(ROUTES_GET) + 1)
    codes = [_get(client, routes[i], params={"t": JETON}, headers=_ip(11)).status_code for i in range(n + 1)]
    assert codes[:n] == [200] * n and codes[n] == 429


def test_preuve_suivi_ne_renvoie_pas_les_coordonnees(faux):
    from fastapi import Request
    req = Request({"type": "http", "headers": [], "client": ("10.9.9.50", 1), "query_string": b""})
    tk = suivi_api.preuve_suivi(faux, req, CODE, JETON, None)
    assert set(tk) == {"id", "statut", "ticket_code"}


def test_verrou_explique_le_qr(client, faux):
    """Le 429 du verrou (IP, code) peut toucher un client qui n'a rien tenté : il dit quoi faire."""
    for i in range(5):
        r = _get(client, "/api/tickets/code/{}", params={"tel": f"06 00 00 {i:02d} 00"}, headers=_ip(12))
    assert r.status_code == 429 and int(r.headers["Retry-After"]) >= 1
    assert "QR code" in r.json()["detail"] and "Réessayez dans" in r.json()["detail"]
    # Même message tant que le verrou dure, bon numéro compris
    r = _get(client, "/api/tickets/code/{}", params={"tel": TEL_CLIENT}, headers=_ip(12))
    assert r.status_code == 429 and "QR code" in r.json()["detail"]


# ── Preuve en en-tête : jamais dans l'URL ni dans les journaux ────

@pytest.mark.parametrize("route", ROUTES_GET)
def test_get_preuve_en_en_tete(client, faux, route):
    r = _get(client, route, headers={"X-Suivi-Tel": "06 12 34 56 79", **_ip()})
    assert r.status_code == 200, (route, r.text)
    r = _get(client, route, headers={"X-Suivi-Token": JETON, **_ip(2)})
    assert r.status_code == 200, (route, r.text)
    for mot in CONFIDENTIEL:
        assert mot not in r.text, (route, mot)


@pytest.mark.parametrize("route,body", ROUTES_POST)
def test_post_preuve_en_en_tete(client, faux, route, body):
    r = _post(client, route, body, headers={"X-Suivi-Tel": TEL_CLIENT, **_ip()})
    assert r.status_code in (200, 409), (route, r.text)
    r = _post(client, route, body, headers={"X-Suivi-Token": JETON, **_ip(2)})
    assert r.status_code in (200, 409), (route, r.text)


def test_en_tete_faux_refuse_comme_la_query(client, faux):
    r = _get(client, "/api/tickets/code/{}", headers={"X-Suivi-Tel": "06 12 34 56 78", **_ip()})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "verification_echouee"
    r = _get(client, "/api/tickets/code/{}", headers={"X-Suivi-Token": "MauvaisJeton_012345678", **_ip()})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "lien_invalide"
    r = _get(client, "/api/tickets/code/{}", headers={"X-Suivi-Tel": TEL_CLIENT[-4:], **_ip()})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "verification_echouee"


def test_en_tete_compte_dans_le_meme_verrou(client, faux):
    codes = [_get(client, "/api/tickets/code/{}", headers={"X-Suivi-Tel": f"06 00 00 {i:02d} 00", **_ip(13)}).status_code
             for i in range(3)]
    codes += [_get(client, "/api/tickets/code/{}", params={"tel": f"06 00 00 {i:02d} 00"}, headers=_ip(13)).status_code
              for i in range(3, 6)]
    assert codes == [403, 403, 403, 403, 429, 429]


@pytest.mark.parametrize("chemin, attendu", [
    ("/api/tickets/code/KP-000001?tel=0612345679", "/api/tickets/code/KP-000001?tel=***"),
    ("/api/tickets/code/KP-000001?tel=%2B33612345679&x=1", "/api/tickets/code/KP-000001?tel=***&x=1"),
    ("/api/parts/public/KP-000001?t=JetonValide_0123456789&tel=0612345679", "/api/parts/public/KP-000001?t=***&tel=***"),
    ("/suivi?t=Jeton_0123456789abcdef&ticket=KP-000001", "/suivi?t=***&ticket=KP-000001"),
    ("/api/tickets/code/KP-000001?tel4=5679", "/api/tickets/code/KP-000001?tel4=***"),
    ("/api/tickets/code/KP-000001", "/api/tickets/code/KP-000001"),
    ("/api/x?ticket=KP-000001&total=3&tele=1", "/api/x?ticket=KP-000001&total=3&tele=1"),
    ("", ""),
])
def test_masquer_preuve(chemin, attendu):
    assert suivi_api.masquer_preuve(chemin) == attendu


def test_journal_d_acces_sans_numero_ni_jeton():
    """Le filtre posé sur « uvicorn.access » masque la preuve dans la ligne de requête,
    et il n'est posé qu'une fois."""
    import logging
    journal = logging.getLogger("uvicorn.access")
    suivi_api._installer_journal_sans_preuve()
    assert sum(isinstance(f, suivi_api._JournalSansPreuve) for f in journal.filters) == 1
    record = logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d',
        ("10.0.0.1:1", "GET", f"/api/tickets/code/{CODE}?tel={TEL_CLIENT}&t={JETON}", "1.1", 200), None,
    )
    assert journal.filter(record)            # Python ≥ 3.12 : renvoie l'enregistrement (vrai), pas True
    texte = record.getMessage()
    assert TEL_CLIENT not in texte and JETON not in texte
    assert texte == f'10.0.0.1:1 - "GET /api/tickets/code/{CODE}?tel=***&t=*** HTTP/1.1" 200'
    # Une ligne sans query, ou d'une autre forme, passe telle quelle
    autre = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1, "%s", ("brut",), None)
    assert journal.filter(autre) and autre.getMessage() == "brut"


# ── Jeton rendu au créateur (borne, dépôt à distance) ─────────────

def _handler_depot(existant, deja=None):
    def handler(sql, p):
        if "kp_phone_key(telephone)" in sql:
            return [existant] if existant else []
        if "statut = 'Pré-enregistré' AND source = 'distance'" in sql:
            return deja
        if "COUNT(*) AS n" in sql:
            return {"n": 0}
        if "RETURNING id" in sql:
            return {"id": 12}
        return None
    return handler


def test_depot_a_distance_renvoie_le_jeton_au_demandeur(client):
    from app.api import depot_distance
    cur = FakeCursor(_handler_depot(None))

    @contextmanager
    def gc(*a, **k):
        yield cur

    with patch("app.api.depot_distance.get_cursor", gc), patch("app.api.clients.get_cursor", gc), \
            patch.object(depot_distance, "envoyer_discord_embed", lambda **k: None):
        r = client.post("/api/depot-distance", headers=_ip(14),
                        json={"nom": "Fictif", "telephone": "06 12 34 56 79", "marque": "Marque", "panne": "Batterie"})
    assert r.status_code == 200, r.text
    corps = r.json()
    assert corps["ticket_code"] == "KP-000012" and suivi_api._TOKEN_RE.match(corps["suivi_token"])
    maj = next(p for s, p in cur.executed if s.startswith("UPDATE tickets SET ticket_code"))
    assert maj[1] == corps["suivi_token"]


def test_depot_a_distance_renvoye_dans_l_heure_garde_son_jeton(client):
    from app.api import depot_distance
    fiche = {"id": 7, "nom": "Fictif", "prenom": "", "telephone": "0612345679", "email": None}
    cur = FakeCursor(_handler_depot(fiche, deja={"id": 5, "ticket_code": "KP-000005", "suivi_token": "JetonExistant_0123456789"}))

    @contextmanager
    def gc(*a, **k):
        yield cur

    with patch("app.api.depot_distance.get_cursor", gc), patch("app.api.clients.get_cursor", gc), \
            patch.object(depot_distance, "envoyer_discord_embed", lambda **k: None):
        r = client.post("/api/depot-distance", headers=_ip(15),
                        json={"nom": "Fictif", "telephone": "06 12 34 56 79", "marque": "Marque", "panne": "Batterie"})
    assert r.status_code == 200, r.text
    assert r.json() == {"id": 5, "ticket_code": "KP-000005", "statut": "Pré-enregistré",
                        "suivi_token": "JetonExistant_0123456789"}
    assert not [s for s, _ in cur.executed if s.startswith("INSERT INTO tickets")]


# ── Liens envoyés : toujours avec le jeton ────────────────────────

def test_lien_de_suivi_du_depot_a_distance_porte_le_jeton():
    from app.api.depot_distance import html_confirmation, lien_suivi
    with patch("app.api.print_tickets._get_frontend_url", lambda: "https://x.test"):
        lien = lien_suivi("KP-000001", "JetonFictif_0123456789")
    assert lien == "https://x.test/suivi?t=JetonFictif_0123456789&ticket=KP-000001"
    html = html_confirmation("Klik", "Adresse", "04", "Jean", "KP-000001", "iPhone", "Écran", lien)
    assert f'href="{lien.replace("&", "&amp;")}"' in html and "Suivre ma réparation" in html
    # Sans jeton (ancien ticket) : le lien reste valide, la page demandera le téléphone
    with patch("app.api.print_tickets._get_frontend_url", lambda: "https://x.test"):
        assert lien_suivi("KP-000001", None) == "https://x.test/suivi?ticket=KP-000001"


def test_email_de_validation_contient_le_lien(monkeypatch):
    from app.api import depot_distance
    envois = []
    monkeypatch.setattr(depot_distance, "envoyer_email", lambda *a, **k: envois.append(a))
    monkeypatch.setattr(depot_distance, "_get_param", lambda *a, **k: "")
    monkeypatch.setattr("app.api.print_tickets._get_frontend_url", lambda: "https://x.test")
    depot_distance._envoyer_email_validation("c@exemple.test", "Jean", "KP-000001", "JetonFictif_0123456789")
    depot_distance._envoyer_email_confirmation("c@exemple.test", "Jean", "KP-000001", "iPhone", "Écran",
                                               "JetonFictif_0123456789")
    assert len(envois) == 2
    for e in envois:
        assert "https://x.test/suivi?t=JetonFictif_0123456789&ticket=KP-000001" in e[2]


def test_qr_imprime_porte_le_jeton():
    from app.api.print_tickets import _suivi_url
    assert _suivi_url("KP-000042", "https://x.test", JETON) == f"https://x.test/suivi?t={JETON}&ticket=KP-000042"


# ═══════════════════════════════════════════════════════════════════
# Base réelle (jetable)
# ═══════════════════════════════════════════════════════════════════

DB_URL = os.getenv("KP_SUIVI_DATABASE_URL")
TEL_REEL = "0600000991"
TEL_CONTACT_REEL = "+41790000991"
H = STAFF


@pytest.fixture(scope="module")
def reel():
    if not DB_URL:
        pytest.skip("KP_SUIVI_DATABASE_URL non définie (base PostgreSQL de test jetable)")
    import psycopg2.extras
    import psycopg2.pool
    import app.database

    pool = psycopg2.pool.ThreadedConnectionPool(1, 8, DB_URL)

    @contextmanager
    def vrai_cursor(dict_cursor=True):
        conn = pool.getconn()
        try:
            factory = psycopg2.extras.RealDictCursor if dict_cursor else None
            with conn.cursor(cursor_factory=factory) as cur:
                yield cur
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            pool.putconn(conn)

    mp = pytest.MonkeyPatch()
    mp.setenv("KP_RETENTION_AUTO", "0")
    mp.setenv("KP_VEILLE_PRIX", "0")
    mp.setattr(app.database, "get_cursor", vrai_cursor)
    for nom, mod in list(sys.modules.items()):
        if nom.startswith("app.") and mod is not app.database and getattr(mod, "get_cursor", None) is not None:
            mp.setattr(mod, "get_cursor", vrai_cursor)
    mp.setattr(suivi_api, "push_notification", lambda **k: None)
    from app.main import app as fastapi_app
    try:
        with TestClient(fastapi_app) as c:   # lifespan : schéma + migrations
            yield {"c": c, "cur": vrai_cursor}
    finally:
        mp.undo()
        pool.closeall()


def _sql(reel, sql, *params):
    with reel["cur"]() as cur:
        cur.execute(sql, params)
        return cur.fetchall() if cur.description else None


@pytest.fixture
def propre(reel):
    def effacer():
        ids = "SELECT id FROM tickets WHERE client_id IN (SELECT id FROM clients WHERE telephone = %s)"
        for table in ("commandes_pieces", "notes_tickets", "historique"):
            _sql(reel, f"DELETE FROM {table} WHERE ticket_id IN ({ids})", TEL_REEL)
        _sql(reel, "DELETE FROM fidelite_historique WHERE client_id IN (SELECT id FROM clients WHERE telephone = %s)", TEL_REEL)
        _sql(reel, "DELETE FROM tickets WHERE client_id IN (SELECT id FROM clients WHERE telephone = %s)", TEL_REEL)
        _sql(reel, "DELETE FROM clients WHERE telephone = %s", TEL_REEL)

    effacer()
    auth.reset_essais()
    suivi_api._LIMITEUR._buckets.clear()
    cid = _sql(reel, "INSERT INTO clients (nom, prenom, telephone, email) VALUES ('Fictif', 'Suivi', %s, 'c@exemple.test')"
                     " RETURNING id", TEL_REEL)[0]["id"]
    yield cid
    effacer()
    auth.reset_essais()
    suivi_api._LIMITEUR._buckets.clear()


def _ticket(reel, cid, **kw):
    t = {"client_id": cid, "categorie": "Smartphone", "marque": "Marque", "modele": "Suivi", "panne": "Écran",
         "statut": "Clôturé", "paye": 1, "tarif_final": 89, "suivi_token": JETON}
    t.update(kw)
    cols = list(t)
    tid = _sql(reel, "INSERT INTO tickets ({}) VALUES ({}) RETURNING id".format(
        ", ".join(cols), ", ".join(["%s"] * len(cols))), *[t[k] for k in cols])[0]["id"]
    _sql(reel, "UPDATE tickets SET ticket_code = %s WHERE id = %s", f"KP-{tid:06d}", tid)
    return f"KP-{tid:06d}"


@pytest.mark.parametrize("route", ROUTES_GET)
def test_reel_code_seul_refuse_puis_preuves(reel, propre, route):
    c = reel["c"]
    code = _ticket(reel, propre, tel_contact=TEL_CONTACT_REEL)
    r = c.get(route.format(code))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "preuve_requise", r.text
    for preuve in ({"t": JETON}, {"tel": "06 00 00 09 91"}, {"tel": "+33600000991"}, {"tel": "0033 6 00 00 09 91"},
                   {"tel": "+41 79 000 09 91"}, {"tel": "0041790000991"}):
        r = c.get(route.format(code), params=preuve)
        assert r.status_code == 200, (route, preuve, r.text)
        for mot in ("0600000991", "790000991", JETON, "c@exemple.test", "telephone", "tel_contact", "suivi_token"):
            assert mot not in r.text, (route, mot)
    assert c.get(route.format(code), headers=H).status_code == 200
    r = c.get(route.format(code), params={"tel": "06 00 00 09 92"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "verification_echouee"
    assert c.get(route.format(code), params={"tel4": "0991"}).status_code == 403


def test_reel_actions_avec_le_numero(reel, propre):
    c = reel["c"]
    code = _ticket(reel, propre, statut="En attente d'accord client", paye=0, devis_estime=89)
    assert c.post(f"/api/suivi/{code}/message", json={"message": "Bonjour"}).status_code == 403
    assert c.post(f"/api/suivi/{code}/message", json={"message": "Bonjour", "tel": "06 00 00 09 91"}).status_code == 200
    assert c.post(f"/api/suivi/{code}/valider-devis", json={"accepte": True, "tel": "+33 6 00 00 09 91"}).status_code == 200
    assert _sql(reel, "SELECT statut FROM tickets WHERE ticket_code = %s", code)[0]["statut"] == "En cours de réparation"
    assert c.get(f"/api/suivi/{code}/has-avis", params={"tel": TEL_REEL}).json() == {"has_avis": False}
    assert c.post(f"/api/suivi/{code}/avis", json={"note": 5, "commentaire": "Top", "tel": TEL_REEL}).status_code == 200
    assert c.get(f"/api/suivi/{code}/has-avis", params={"t": JETON}).json() == {"has_avis": True}


def test_reel_grattage_avec_le_numero(reel, propre):
    c = reel["c"]
    code = _ticket(reel, propre)
    assert c.get(f"/api/fidelite/grattage/{code}").status_code == 403
    etat = c.post(f"/api/fidelite/grattage/{code}/etat", json={"tel": "06 00 00 09 91"}).json()
    assert etat["eligible"] is True and etat["deja_gratte"] is False
    with patch.object(fidelite_api.secrets, "randbelow", return_value=1):
        assert c.post(f"/api/fidelite/grattage/{code}", json={"tel": "06 00 00 09 91"}).status_code == 200
    assert c.get(f"/api/fidelite/grattage/{code}", params={"t": JETON}).json()["deja_gratte"] is True


def test_reel_verrou_par_ip_et_code(reel, propre):
    c = reel["c"]
    code = _ticket(reel, propre)
    h = {"X-Forwarded-For": "1.2.3.4, 10.20.30.40"}
    codes = [c.get(f"/api/tickets/code/{code}", params={"tel": f"06 00 00 00 {i:02d}"}, headers=h).status_code
             for i in range(6)]
    assert codes == [403, 403, 403, 403, 429, 429]
    assert c.get(f"/api/tickets/code/{code}", params={"tel": TEL_REEL}).status_code == 200   # autre IP


def test_reel_recherche_par_telephone_supprimee(reel, propre):
    c = reel["c"]
    _ticket(reel, propre)
    assert c.get(f"/api/tickets/phone/{TEL_REEL}").status_code in (401, 404, 405)
    assert c.get(f"/api/tickets/phone/{TEL_REEL}", headers=H).status_code in (404, 405)


def test_reel_preuve_en_en_tete(reel, propre):
    c = reel["c"]
    code = _ticket(reel, propre)
    assert c.get(f"/api/tickets/code/{code}", headers={"X-Suivi-Tel": "06 00 00 09 91"}).status_code == 200
    assert c.get(f"/api/parts/public/{code}", headers={"X-Suivi-Token": JETON}).status_code == 200
    r = c.get(f"/api/tickets/code/{code}", headers={"X-Suivi-Tel": "06 00 00 09 92"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "verification_echouee"


def test_reel_creation_renvoie_le_jeton_qui_ouvre_le_suivi(reel, propre):
    c = reel["c"]
    r = c.post("/api/tickets", headers=H,
               json={"client_id": propre, "categorie": "Smartphone", "marque": "Marque", "modele": "Suivi", "panne": "Écran"})
    assert r.status_code == 200, r.text
    jeton = r.json()["suivi_token"]
    assert jeton and suivi_api._TOKEN_RE.match(jeton)
    assert _sql(reel, "SELECT suivi_token FROM tickets WHERE id = %s", r.json()["id"])[0]["suivi_token"] == jeton
    assert c.get(f"/api/tickets/code/{r.json()['ticket_code']}", params={"t": jeton}).status_code == 200

    depot = {"nom": "Fictif", "prenom": "Suivi", "telephone": TEL_REEL, "marque": "Marque", "modele": "Distance",
             "panne": "Batterie", "rgpd_informe": True}
    h = {"X-Forwarded-For": "6.6.6.6, 10.9.9.60"}
    r = c.post("/api/depot-distance", json=depot, headers=h)
    assert r.status_code == 200, r.text
    jeton = r.json()["suivi_token"]
    assert jeton and _sql(reel, "SELECT suivi_token FROM tickets WHERE id = %s", r.json()["id"])[0]["suivi_token"] == jeton
    assert c.get(f"/api/tickets/code/{r.json()['ticket_code']}", params={"t": jeton}).status_code == 200
    # Même appareil renvoyé dans l'heure : le pré-enregistrement existant, avec le même jeton
    r2 = c.post("/api/depot-distance", json=depot, headers=h)
    assert r2.status_code == 200 and r2.json()["id"] == r.json()["id"] and r2.json()["suivi_token"] == jeton
