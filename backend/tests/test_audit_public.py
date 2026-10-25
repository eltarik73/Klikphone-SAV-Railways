"""Audit adverse d'octobre 2026, voie anonyme (borne du magasin, formulaires publics) :
un test par constat du périmètre BACKEND 1.

  A. Référence client signée : POST /api/clients sans session rend {"client_ref"} (jamais l'id,
     même forme fiche neuve ou existante, nom non vide exigé) ; POST /api/tickets sans session
     exige cette référence (même IP, 20 min) et refuse un client_id nu ; échecs comptés par
     (IP, numéro) quand le nom ne correspond à aucune fiche du numéro. La charge de la
     référence est opaque sans le secret (identifiant masqué : ni l'id, ni l'ordre des fiches,
     ni « même fiche qu'avant » ne se lisent). Un numéro partagé par deux personnes rattache
     chacune à SA fiche (pas de doublon, pas d'échec compté).
  B. Plus d'oracle 404/403 : sans session, un code inexistant répond comme un code existant
     sans preuve ; 404 réservé au personnel.
  C. Retour SAV réservé au personnel (422) ; avec session, un seul 404 pour « ticket original
     introuvable » et « ticket d'un autre client ».
  D. POST /api/parts/auto sans session exige la preuve du suivi du ticket visé (403 sinon) ; un
     ticket inexistant répond EXACTEMENT comme un ticket existant sans preuve valable, pour
     chaque preuve présentée (paramètres ou en-têtes), verrou des échecs compris.
  E. GET /api/team/active : id, nom, couleur — jamais le rôle.
  H. Plafonds globaux (toutes IP confondues) sur chaque point d'entrée anonyme, en plus du
     quota par IP ; les IP « connues » ne sont plus exemptées ; 429 avec un message clair. Le
     plafond global n'est consommé qu'après validation (422/403/400 n'y comptent pas : des
     refus en rafale ne bloquent pas la borne) ; une IP du magasin (KP_IP_MAGASIN, liste
     statique) est exemptée du seul plafond global, jamais du quota par IP.
  K. Le numéro de téléphone est lu dans l'en-tête X-Suivi-Tel sur chaque route GET du suivi.

Base simulée (réponses choisies selon le texte SQL) : ces tests tournent toujours.
"""

import json
from contextlib import contextmanager
from time import time
from unittest.mock import MagicMock, patch

import pytest

from app.api import auth, clients as clients_api, depot_distance as depot_api, parts as parts_api
from app.api import suivi as suivi_api, team as team_api, tickets as tickets_api
from app.api.auth import create_token
from app.api.public_documents import CLE_GLOBALE, LimiteurDebit, ip_magasin
from app.services import client_ref
from tests.conftest import corps_borne, ref_anonyme
from tests.test_suivi_preuve import CODE, JETON, ROUTES_GET, TEL_CLIENT, FakeCursor, _handler, faux  # noqa: F401

STAFF = {"Authorization": f"Bearer {create_token('accueil', 'Sophie')}"}
CORPS = {"categorie": "Smartphone", "marque": "Apple", "panne": "Batterie"}
EXISTANT = {"id": 5, "nom": "Fictif", "prenom": "Jean", "telephone": "0611223344",
            "email": "jean@example.test", "societe": "", "carte_camby": 1, "date_creation": None}


def _ip(n=1):
    return {"X-Forwarded-For": f"6.6.6.6, 10.8.8.{n}"}


def _fake(handler):
    cur = FakeCursor(handler)

    @contextmanager
    def gc(*a, **k):
        yield cur

    return cur, gc


def _client_handler(existant):
    def handler(sql, params):
        if "kp_phone_key(telephone) = %s" in sql:
            return [existant] if existant else []
        if sql.startswith("UPDATE clients SET"):
            return {**existant, "prenom": "Modifié"} if "RETURNING" in sql else None
        if sql.startswith("INSERT INTO clients"):
            return {"id": 9, "nom": "N", "prenom": "", "telephone": "0611223344", "email": "", "societe": "",
                    "carte_camby": 0, "date_creation": None}
        return None
    return handler


def _cursor_tickets(fetchone=None):
    cur = MagicMock()
    cur.fetchone.return_value = fetchone
    cur.fetchall.return_value = []

    @contextmanager
    def cm():
        yield cur

    return cur, cm


@pytest.fixture(autouse=True)
def _propre():
    auth.reset_essais()
    for lim in (clients_api._LIMITEUR_CREATION, tickets_api._LIMITEUR_CREATION, parts_api._LIMITEUR_AUTO,
                depot_api._LIMITEUR_DEPOT, suivi_api._LIMITEUR):
        lim._buckets.clear()
    yield
    auth.reset_essais()
    for lim in (clients_api._LIMITEUR_CREATION, tickets_api._LIMITEUR_CREATION, parts_api._LIMITEUR_AUTO,
                depot_api._LIMITEUR_DEPOT, suivi_api._LIMITEUR):
        lim._buckets.clear()


@contextmanager
def _creation_ticket(fetchone={"id": 41}):
    cur, cm = _cursor_tickets(fetchone)
    with patch("app.api.tickets.get_cursor", cm), patch("app.api.public_documents.jeton_suivi", lambda tid: JETON), \
            patch.object(tickets_api, "notif_nouveau_ticket", lambda *_: None), \
            patch.object(tickets_api, "learn_terms", lambda *_: None):
        yield cur


# ═══ A. Référence client signée ═══════════════════════════════════════════

def test_a_service_client_ref_signe_et_verifie():
    ref = client_ref.signer(5, "10.0.0.1")
    assert client_ref.verifier(ref, "10.0.0.1") == 5
    assert client_ref.verifier(ref, "10.0.0.2") is None                 # autre IP
    assert client_ref.verifier(ref, "10.0.0.1", maintenant=time() + 21 * 60) is None   # expirée
    assert client_ref.verifier(client_ref.signer(5, "10.0.0.1", maintenant=time() - 3600), "10.0.0.1") is None
    corps, sig = ref.split(".")
    assert client_ref.verifier(corps + ".AAAA" + sig[4:], "10.0.0.1") is None      # signature altérée
    autre = client_ref.signer(6, "10.0.0.1").split(".")[0]
    assert client_ref.verifier(autre + "." + sig, "10.0.0.1") is None            # charge d'une autre fiche
    for mauvais in (None, "", "x", "a.b", 12, "." * 600, ref + "x"):
        assert client_ref.verifier(mauvais, "10.0.0.1") is None
    assert "10.0.0.1" not in ref                                            # jamais l'IP en clair


def test_a_reference_opaque_sans_le_secret():
    """Ce qu'un tiers lit en décodant la référence (base64) : ni l'identifiant de la fiche, ni
    « même fiche qu'à l'appel précédent », ni l'ordre des identifiants — l'oracle « ce numéro est
    celui d'un client » ne se rouvre pas en décodant la charge."""
    ip = "10.0.0.1"
    r1, r2 = client_ref.signer(5, ip), client_ref.signer(5, ip)
    c1, c2 = client_ref.charge_decodee(r1), client_ref.charge_decodee(r2)
    assert set(c1) == {"n", "c", "exp", "ipf"} and "cid" not in c1
    assert 5 not in c1.values() and 5 not in c2.values() and isinstance(c1["c"], int)
    assert c1["c"] != c2["c"] and c1["n"] != c2["n"]            # même fiche : références différentes
    assert client_ref.verifier(r1, ip) == client_ref.verifier(r2, ip) == 5
    # Fiche existante (petit id) et fiche neuve (grand id) : rien ne trahit l'ordre des identifiants
    petits = [client_ref.charge_decodee(client_ref.signer(5, ip))["c"] for _ in range(20)]
    grands = [client_ref.charge_decodee(client_ref.signer(9000, ip))["c"] for _ in range(20)]
    assert len(set(petits)) == 20 and len(set(grands)) == 20
    assert any(p > g for p in petits for g in grands) and any(p < g for p in petits for g in grands)
    assert client_ref.verifier(client_ref.signer(9000, ip), ip) == 9000
    # Charge altérée (identifiant masqué modifié, nonce changé) : la signature ne tient plus
    corps, sig = r1.split(".")
    charge = dict(c1)
    for cle, valeur in (("c", (c1["c"] + 1) % (1 << 64)), ("n", client_ref._b64(b"\x00" * 8))):
        mod = client_ref._b64(json.dumps({**charge, cle: valeur}, separators=(",", ":"), sort_keys=True).encode())
        assert client_ref.verifier(mod + "." + sig, ip) is None


def test_a_client_anonyme_rend_une_reference_jamais_l_identifiant(client):
    # Fiche neuve
    _, gc = _fake(_client_handler(None))
    with patch("app.api.clients.get_cursor", gc):
        r = client.post("/api/clients", json={"nom": "N", "telephone": "0611223344"}, headers=_ip())
    assert r.status_code == 200 and set(r.json()) == {"client_ref"}, r.text
    assert client_ref.verifier(r.json()["client_ref"], "10.8.8.1") == 9
    # Fiche existante, même personne : même forme de réponse (aucun champ « existant »)
    _, gc = _fake(_client_handler(EXISTANT))
    with patch("app.api.clients.get_cursor", gc):
        r = client.post("/api/clients", json={"nom": "Fictif", "prenom": "Jean", "telephone": "0611223344"}, headers=_ip())
    assert r.status_code == 200 and set(r.json()) == {"client_ref"}, r.text
    assert client_ref.verifier(r.json()["client_ref"], "10.8.8.1") == 5
    assert "jean@example.test" not in r.text and "Fictif" not in r.text


def test_a_client_anonyme_nom_vide_422(client):
    cur, gc = _fake(_client_handler(None))
    with patch("app.api.clients.get_cursor", gc):
        for nom in ("", "   "):
            r = client.post("/api/clients", json={"nom": nom, "telephone": "0611223344"}, headers=_ip())
            assert r.status_code == 422 and r.json()["detail"]["code"] == "nom_requis", r.text
    assert not cur.executed
    # Le personnel garde la fiche complète (inchangé)
    with patch("app.api.clients.get_cursor", gc):
        r = client.post("/api/clients", json={"nom": "Dupont", "telephone": "0611223344"}, headers=STAFF)
    assert r.status_code == 200 and r.json()["id"] == 9 and "client_ref" not in r.json()


def test_a_ticket_anonyme_client_id_nu_refuse(client):
    with _creation_ticket() as cur:
        r = client.post("/api/tickets", json={**CORPS, "client_id": 1}, headers=_ip())
        assert r.status_code == 422 and r.json()["detail"]["code"] == "reference_client_requise", r.text
        r = client.post("/api/tickets", json=CORPS, headers=_ip())          # ni id ni référence
        assert r.status_code == 422 and r.json()["detail"]["code"] == "reference_client_requise"
        assert cur.execute.call_count == 0
        # Avec session : client_id, inchangé
        r = client.post("/api/tickets", json={**CORPS, "client_id": 7}, headers={**STAFF, **_ip()})
        assert r.status_code == 200 and cur.execute.call_args_list[0].args[1][0] == 7
        r = client.post("/api/tickets", json=CORPS, headers={**STAFF, **_ip()})
        assert r.status_code == 422


def test_a_ticket_anonyme_reference_autre_ip_ou_expiree_422(client):
    with _creation_ticket() as cur:
        autre_ip = {**CORPS, "client_ref": ref_anonyme(7, "10.8.8.99")}
        r = client.post("/api/tickets", json=autre_ip, headers=_ip(1))
        assert r.status_code == 422 and r.json()["detail"]["code"] == "reference_client_requise"
        expiree = {**CORPS, "client_ref": client_ref.signer(7, "10.8.8.1", maintenant=time() - 3600)}
        r = client.post("/api/tickets", json=expiree, headers=_ip(1))
        assert r.status_code == 422 and "expirée" in r.json()["detail"]["message"]
        falsifiee = {**CORPS, "client_ref": ref_anonyme(7, "10.8.8.1")[:-3] + "xyz"}
        assert client.post("/api/tickets", json=falsifiee, headers=_ip(1)).status_code == 422
        assert cur.execute.call_count == 0
        # La référence obtenue par la borne, depuis la même IP : rattache la fiche signée (et elle seule)
        r = client.post("/api/tickets", json={**CORPS, "client_ref": ref_anonyme(7, "10.8.8.1"), "client_id": 1}, headers=_ip(1))
        assert r.status_code == 200, r.text
        assert cur.execute.call_args_list[0].args[1][0] == 7
        assert r.json()["suivi_token"] == JETON


def test_a_echecs_comptes_par_ip_et_numero(client):
    """Numéro d'une fiche existante saisi avec un autre nom : nouvelle fiche, mais compté comme un
    échec par (IP, numéro) ; au 5e, verrou — y compris pour le bon nom — sans toucher aux autres numéros."""
    cur, gc = _fake(_client_handler(EXISTANT))
    # Quota par IP relevé : c'est le verrou par (IP, numéro) qui est observé ici
    with patch("app.api.clients.get_cursor", gc), \
            patch.object(clients_api, "_LIMITEUR_CREATION", LimiteurDebit(limite=50, fenetre=600)):
        codes = [client.post("/api/clients", json={"nom": f"Pirate{i}", "telephone": "0611223344"}, headers=_ip(5)).status_code
                 for i in range(5)]
        assert codes == [200, 200, 200, 200, 429], codes
        r = client.post("/api/clients", json={"nom": "Fictif", "prenom": "Jean", "telephone": "0611223344"}, headers=_ip(5))
        assert r.status_code == 429 and "Réessayez" in r.json()["detail"]
        # Autre numéro depuis la même IP, ou autre IP sur ce numéro : pas concernés
        assert client.post("/api/clients", json={"nom": "Pirate", "telephone": "0611223355"}, headers=_ip(5)).status_code == 200
        assert client.post("/api/clients", json={"nom": "Pirate", "telephone": "0611223344"}, headers=_ip(6)).status_code == 200
        # Le personnel n'est jamais compté
        assert client.post("/api/clients", json={"nom": "Pirate", "telephone": "0611223344"}, headers={**STAFF, **_ip(5)}).status_code == 200


BERNARD = {"id": 5, "nom": "Bernard", "prenom": "Paul", "telephone": "0645678901", "email": "", "societe": "",
           "carte_camby": 0, "date_creation": None}
DUPONT = {**BERNARD, "id": 6, "nom": "Dupont", "prenom": "Marie"}


def _client_handler_multi(fiches):
    def handler(sql, params):
        if "kp_phone_key(telephone) = %s" in sql:
            return list(fiches)
        if sql.startswith("INSERT INTO clients"):
            return {**BERNARD, "id": 9, "nom": "Martin", "prenom": ""}
        return None
    return handler


def test_a_numero_partage_rattache_la_fiche_de_la_personne(client):
    """Deux personnes sur une même ligne (parent/enfant, couple) : la seconde retrouve SA fiche à
    chaque passage — ni doublon, ni échec compté ; un troisième nom crée une fiche et compte l'échec."""
    cur, gc = _fake(_client_handler_multi([BERNARD, DUPONT]))
    with patch("app.api.clients.get_cursor", gc), \
            patch.object(clients_api, "_LIMITEUR_CREATION", LimiteurDebit(limite=50, fenetre=600)):
        for _ in range(3):
            r = client.post("/api/clients", json={"nom": "DUPONT", "prenom": "marie", "telephone": "06 45 67 89 01"}, headers=_ip(7))
            assert r.status_code == 200 and client_ref.verifier(r.json()["client_ref"], "10.8.8.7") == 6, r.text
        r = client.post("/api/clients", json={"nom": "Bernard", "prenom": "Paul", "telephone": "0645678901"}, headers=_ip(7))
        assert client_ref.verifier(r.json()["client_ref"], "10.8.8.7") == 5
        assert not [s for s, _ in cur.executed if s.startswith("INSERT INTO clients")]
        # Aucun échec compté : le verrou (IP, numéro) n'est pas entamé, 5 passages de plus passent
        codes = [client.post("/api/clients", json={"nom": "Dupont", "prenom": "Marie", "telephone": "0645678901"},
                             headers=_ip(7)).status_code for _ in range(5)]
        assert codes == [200] * 5, codes
        # Un troisième nom : nouvelle fiche, et l'échec est compté (verrou au 5e)
        for i in range(4):
            r = client.post("/api/clients", json={"nom": f"Martin{i}", "telephone": "0645678901"}, headers=_ip(7))
            assert r.status_code == 200 and client_ref.verifier(r.json()["client_ref"], "10.8.8.7") == 9
        assert len([s for s, _ in cur.executed if s.startswith("INSERT INTO clients")]) == 4
        assert client.post("/api/clients", json={"nom": "Martin", "telephone": "0645678901"}, headers=_ip(7)).status_code == 429
    # La règle est partagée avec le dépôt à distance
    assert depot_api.fiche_de_la_personne is clients_api.fiche_de_la_personne
    assert clients_api.fiche_de_la_personne([BERNARD, DUPONT], "DUPONT", "marie") is DUPONT
    assert clients_api.fiche_de_la_personne([BERNARD, DUPONT], "Martin", "") is None
    sans_nom = {**BERNARD, "id": 8, "nom": "", "prenom": ""}
    assert clients_api.fiche_de_la_personne([BERNARD, sans_nom], "Martin", "") is sans_nom
    assert clients_api.fiche_de_la_personne([], "Martin", "") is None


# ═══ B. Oracle 404 / 403 ═══════════════════════════════════════════════════

@pytest.mark.parametrize("route", ROUTES_GET)
def test_b_code_inexistant_indistinguable_sans_session(client, faux, route):
    for params, attendu in (({}, "preuve_requise"), ({"t": "MauvaisJeton_012345678"}, "lien_invalide"),
                            ({"tel": "06 12 34 56 78"}, "verification_echouee")):
        inconnu = client.get(route.format("KP-999999"), params=params, headers=_ip(30))
        connu = client.get(route.format(CODE), params=params, headers=_ip(31))
        assert inconnu.status_code == connu.status_code == 403, (route, params, inconnu.text, connu.text)
        assert inconnu.json() == connu.json() and inconnu.json()["detail"]["code"] == attendu
    # Jeton valide d'un autre ticket, bon numéro d'un autre ticket : refusés pareil
    assert client.get(route.format("KP-999999"), params={"t": JETON}, headers=_ip(32)).json()["detail"]["code"] == "lien_invalide"
    assert client.get(route.format("KP-999999"), headers={"X-Suivi-Tel": TEL_CLIENT, **_ip(32)}).json()["detail"]["code"] == "verification_echouee"


def test_b_404_reserve_au_personnel(client, faux):
    assert client.get("/api/tickets/code/KP-999999", headers={**STAFF, **_ip()}).status_code == 404
    assert client.post("/api/suivi/KP-999999/message", json={"message": "x"}, headers={**STAFF, **_ip()}).status_code == 404
    assert client.get("/api/tickets/code/KP-999999", headers=_ip()).status_code == 403


# ═══ C. Retour SAV ═════════════════════════════════════════════════════════

def test_c_retour_sav_sans_session_422(client):
    with _creation_ticket() as cur:
        for extra in ({"est_retour_sav": True}, {"ticket_original_id": 12}, {"est_retour_sav": True, "ticket_original_id": 12}):
            r = client.post("/api/tickets", json={**corps_borne({**CORPS, "client_id": 1}, 1, "10.8.8.1"), **extra}, headers=_ip(1))
            assert r.status_code == 422 and r.json()["detail"]["code"] == "reserve_au_personnel", (extra, r.text)
            assert "réservé au personnel" in r.json()["detail"]["message"]
        assert cur.execute.call_count == 0


def test_c_retour_sav_un_seul_404(client):
    # Ticket original inexistant
    with _creation_ticket(fetchone=None) as cur:
        r = client.post("/api/tickets", json={**CORPS, "client_id": 1, "est_retour_sav": True, "ticket_original_id": 12},
                        headers=STAFF)
        assert r.status_code == 404 and r.json()["detail"] == "Client ou ticket original introuvable"
    # Ticket original d'un autre client : même code, même message
    with _creation_ticket(fetchone={"id": 12, "client_id": 2}) as cur:
        r = client.post("/api/tickets", json={**CORPS, "client_id": 1, "est_retour_sav": True, "ticket_original_id": 12},
                        headers=STAFF)
        assert r.status_code == 404 and r.json()["detail"] == "Client ou ticket original introuvable"
        assert not any(str(a.args[0]).lstrip().startswith("INSERT") for a in cur.execute.call_args_list)


# ═══ D. POST /api/parts/auto ═══════════════════════════════════════════════

def _handler_auto(existe=True, statut="En attente de diagnostic"):
    def handler(sql, params):
        if "FROM tickets t WHERE id = %s FOR UPDATE" in sql:
            return {"ticket_code": CODE, "statut": statut, "recent": True, "a_commande": False} if existe else None
        if "INSERT INTO commandes_pieces" in sql:
            return {"id": 77}
        return _handler(sql, params)
    return handler


@contextmanager
def _auto(existe=True):
    cur, gc = _fake(_handler_auto(existe))
    with patch("app.api.parts.get_cursor", gc), patch("app.api.suivi.get_cursor", gc), \
            patch.object(parts_api.contact, "historiser_statut", lambda *a, **k: None):
        yield cur


def _ecritures(cur):
    return [s for s, _ in cur.executed if s.startswith(("INSERT", "UPDATE"))]


def test_d_parts_auto_sans_preuve_403(client):
    corps = {"ticket_id": 42, "description": "Écran"}
    with _auto() as cur:
        r = client.post("/api/parts/auto", json=corps, headers=_ip(40))
        assert r.status_code == 403 and r.json()["detail"]["code"] == "preuve_requise", r.text
        r = client.post("/api/parts/auto", json={**corps, "t": "MauvaisJeton_012345678"}, headers=_ip(40))
        assert r.status_code == 403 and r.json()["detail"]["code"] == "lien_invalide"
        r = client.post("/api/parts/auto", json={**corps, "tel": "06 12 34 56 78"}, headers=_ip(40))
        assert r.status_code == 403 and r.json()["detail"]["code"] == "verification_echouee"
        assert _ecritures(cur) == []
    # Ticket inexistant : même 403, pas de 404 (l'identifiant séquentiel n'apprend rien), quelle que
    # soit la preuve présentée — paramètres ou en-têtes X-Suivi-Token / X-Suivi-Tel
    with _auto(existe=False) as cur:
        inconnu = {"ticket_id": 999999, "description": "x"}
        r = client.post("/api/parts/auto", json=inconnu, headers=_ip(41))
        assert r.status_code == 403 and r.json()["detail"]["code"] == "preuve_requise"
        r = client.post("/api/parts/auto", json={**inconnu, "t": JETON}, headers=_ip(41))
        assert r.status_code == 403 and r.json()["detail"]["code"] == "lien_invalide"
        r = client.post("/api/parts/auto", json=inconnu, headers={"X-Suivi-Token": JETON, **_ip(41)})
        assert r.status_code == 403 and r.json()["detail"]["code"] == "lien_invalide"
        r = client.post("/api/parts/auto", json={**inconnu, "tel": "06 12 34 56 79"}, headers=_ip(41))
        assert r.status_code == 403 and r.json()["detail"]["code"] == "verification_echouee", r.text
        r = client.post("/api/parts/auto", json=inconnu, headers={"X-Suivi-Tel": TEL_CLIENT, **_ip(41)})
        assert r.status_code == 403 and r.json()["detail"]["code"] == "verification_echouee"
        assert _ecritures(cur) == []


def test_d_parts_auto_ticket_inexistant_indistinguable(client):
    """Ticket existant sans preuve valable et ticket inexistant : même réponse pour chaque preuve
    présentée, et le même verrou progressif sur les échecs de numéro (rang et attente)."""
    variantes = [({}, {}, "preuve_requise"),
                 ({"t": "MauvaisJeton_012345678"}, {}, "lien_invalide"),
                 ({}, {"X-Suivi-Token": "MauvaisJeton_012345678"}, "lien_invalide"),
                 ({"tel": "06 12 34 56 78"}, {}, "verification_echouee"),
                 ({}, {"X-Suivi-Tel": "06 12 34 56 78"}, "verification_echouee")]
    reponses = {}
    for existe, n in ((True, 45), (False, 46)):
        with _auto(existe=existe):
            reponses[existe] = [client.post("/api/parts/auto", json={"ticket_id": 42 if existe else 999999, "description": "x", **corps},
                                            headers={**entetes, **_ip(n)}) for corps, entetes, _ in variantes]
    for (corps, entetes, attendu), a, b in zip(variantes, reponses[True], reponses[False]):
        assert a.status_code == b.status_code == 403, (corps, entetes, a.text, b.text)
        assert a.json() == b.json() and a.json()["detail"]["code"] == attendu, (corps, entetes, a.text, b.text)

    def serie(existe, n):
        with _auto(existe=existe):
            return [(r.status_code, (r.headers.get("Retry-After") or "")) for r in (
                client.post("/api/parts/auto", json={"ticket_id": 42 if existe else 999999, "description": "x",
                                                     "tel": f"06 12 34 56 {i:02d}"}, headers=_ip(n)) for i in range(5))]
    existant, inexistant = serie(True, 47), serie(False, 48)
    assert existant == inexistant and existant[-1][0] == 429 and existant[0][0] == 403, (existant, inexistant)


def test_d_parts_auto_avec_preuve_ou_session(client):
    corps = {"ticket_id": 42, "description": "Écran"}
    with _auto() as cur:    # jeton rendu par POST /api/tickets
        r = client.post("/api/parts/auto", json={**corps, "t": JETON}, headers=_ip(42))
        assert r.status_code == 200 and r.json() == {"id": 77}, r.text
        assert any(s.startswith("INSERT INTO commandes_pieces") for s in _ecritures(cur))
    with _auto() as cur:    # numéro complet, en en-tête
        r = client.post("/api/parts/auto", json=corps, headers={"X-Suivi-Tel": TEL_CLIENT, **_ip(43)})
        assert r.status_code == 200, r.text
    with _auto() as cur:    # personnel : inchangé, aucune preuve
        r = client.post("/api/parts/auto", json=corps, headers={**STAFF, **_ip(44)})
        assert r.status_code == 200, r.text
        assert not any("c.telephone AS client_tel" in s for s, _ in cur.executed)
    with _auto(existe=False) as cur:
        assert client.post("/api/parts/auto", json=corps, headers={**STAFF, **_ip(44)}).status_code == 404


# ═══ E. GET /api/team/active ═══════════════════════════════════════════════

def test_e_team_active_sans_role(client):
    lignes = [{"id": 1, "nom": "Sophie", "role": "accueil admin", "couleur": "#7C3AED", "actif": 1, "pin": "1234"},
              {"id": 2, "nom": "Léa", "role": "Manager", "couleur": None, "actif": 1}]
    cur, gc = _fake(lambda sql, p: lignes)
    with patch("app.api.team.get_cursor", gc):
        r = client.get("/api/team/active")
    assert r.status_code == 200
    assert r.json() == [{"id": 1, "nom": "Sophie", "couleur": "#7C3AED"}, {"id": 2, "nom": "Léa", "couleur": None}]
    for mot in ("role", "admin", "Manager", "actif", "pin", "1234"):
        assert mot not in r.text, mot
    sql = cur.executed[0][0]
    assert "SELECT id, nom, couleur FROM membres_equipe" in sql and "*" not in sql
    assert set(team_api.COLONNES_PUBLIQUES) == {"id", "nom", "couleur"}


# ═══ H. Plafonds globaux ═══════════════════════════════════════════════════

def test_h_limiteur_plafond_global_independant_de_l_ip():
    lim = LimiteurDebit(limite=10, fenetre=60, limite_globale=3, fenetre_globale=3600,
                        message="par ip", message_global="plafond")
    for ip in ("a", "b", "c"):
        lim.verifier(ip)
    with pytest.raises(Exception) as e:
        lim.verifier("d")
    assert e.value.status_code == 429 and e.value.detail == "plafond" and e.value.headers["Retry-After"]
    assert len(lim) == 4 and CLE_GLOBALE in lim._buckets
    # Quota par IP : son propre message
    lim2 = LimiteurDebit(limite=1, fenetre=60, limite_globale=100, message="par ip", message_global="plafond")
    lim2.verifier("a")
    with pytest.raises(Exception) as e:
        lim2.verifier("a")
    assert e.value.detail == "par ip"
    # Le refus par IP ne consomme pas le plafond global
    assert len(lim2._buckets[CLE_GLOBALE]) == 1
    # _buckets.clear() (fixtures) remet aussi le plafond à zéro ; sans plafond, rien ne change
    lim._buckets.clear()
    lim.verifier("d")
    LimiteurDebit(limite=1, fenetre=60).verifier("x")


def test_h_verifier_ip_puis_compter_global_et_ip_magasin(monkeypatch):
    """`verifier_ip` (toute tentative) ne touche pas au plafond global ; `compter_global` (demande
    validée) le consomme ; une IP du magasin (KP_IP_MAGASIN) est exemptée du plafond, pas du quota."""
    monkeypatch.delenv("KP_IP_MAGASIN", raising=False)
    lim = LimiteurDebit(limite=2, fenetre=60, limite_globale=2, fenetre_globale=3600, message="par ip", message_global="plafond")
    for ip in ("a", "b", "c", "d"):
        lim.verifier_ip(ip)
    assert CLE_GLOBALE not in lim._buckets and len(lim) == 4
    lim.compter_global("a")
    lim.compter_global("b")
    with pytest.raises(Exception) as e:
        lim.compter_global("c")
    assert e.value.status_code == 429 and e.value.detail == "plafond" and e.value.headers["Retry-After"]
    assert len(lim._buckets[CLE_GLOBALE]) == 2                       # le refus n'est pas compté
    # Le quota par IP reste appliqué à l'entrée
    lim.verifier_ip("a")
    with pytest.raises(Exception) as e:
        lim.verifier_ip("a")
    assert e.value.detail == "par ip"
    # IP du magasin : jamais comptée ni refusée au plafond global, mais soumise au quota par IP
    monkeypatch.setenv("KP_IP_MAGASIN", " 10.0.0.50 ,10.0.0.51,")
    assert ip_magasin("10.0.0.50") and ip_magasin("10.0.0.51") and not ip_magasin("10.0.0.52") and not ip_magasin("")
    lim.compter_global("10.0.0.50")
    assert len(lim._buckets[CLE_GLOBALE]) == 2
    lim.verifier("10.0.0.51")
    lim.verifier("10.0.0.51")
    with pytest.raises(Exception) as e:
        lim.verifier("10.0.0.51")
    assert e.value.detail == "par ip"
    with pytest.raises(Exception) as e:
        lim.verifier("z")                                             # les autres : plafond atteint
    assert e.value.detail == "plafond"
    monkeypatch.delenv("KP_IP_MAGASIN")
    assert not ip_magasin("10.0.0.50")
    # Sans plafond global : compter_global ne fait rien, verifier_ip non plus au-delà du quota
    sans = LimiteurDebit(limite=1, fenetre=60)
    sans.compter_global("x")
    sans.verifier_ip("x")
    with pytest.raises(Exception):
        sans.verifier_ip("x")


def _plafond(attr_module, nom, **kw):
    """Même quota par IP, plafond global ramené à 3 par heure."""
    ancien = getattr(attr_module, nom)
    return patch.object(attr_module, nom, LimiteurDebit(
        limite=ancien.limite, fenetre=ancien.fenetre, limite_globale=3, fenetre_globale=3600,
        message=ancien.message, message_global=ancien.message_global))


def test_h_plafond_global_clients_anonymes(client):
    _, gc = _fake(_client_handler(None))
    with patch("app.api.clients.get_cursor", gc), _plafond(clients_api, "_LIMITEUR_CREATION"):
        codes = [client.post("/api/clients", json={"nom": "N", "telephone": f"06112233{i:02d}"}, headers=_ip(50 + i)).status_code
                 for i in range(4)]
        assert codes == [200, 200, 200, 429], codes
        r = client.post("/api/clients", json={"nom": "N", "telephone": "0611223399"}, headers=_ip(60))
        assert r.status_code == 429 and "comptoir" in r.json()["detail"].lower(), r.text
        # Le personnel n'est pas plafonné
        assert client.post("/api/clients", json={"nom": "N", "telephone": "0611223398"}, headers={**STAFF, **_ip(61)}).status_code == 200


def test_h_plafond_global_tickets_anonymes(client):
    with _creation_ticket(), _plafond(tickets_api, "_LIMITEUR_CREATION"):
        codes = [client.post("/api/tickets", json={**CORPS, "client_ref": ref_anonyme(1, f"10.8.8.{70 + i}")},
                             headers=_ip(70 + i)).status_code for i in range(4)]
        assert codes == [200, 200, 200, 429], codes
        assert client.post("/api/tickets", json={**CORPS, "client_id": 1}, headers={**STAFF, **_ip(80)}).status_code == 200


def test_h_plafond_global_parts_auto_anonyme(client):
    with _auto(), _plafond(parts_api, "_LIMITEUR_AUTO"):
        codes = [client.post("/api/parts/auto", json={"ticket_id": 42, "description": "x", "t": JETON},
                             headers=_ip(90 + i)).status_code for i in range(4)]
        assert codes == [200, 200, 200, 429], codes
        assert client.post("/api/parts/auto", json={"ticket_id": 42, "description": "x"}, headers={**STAFF, **_ip(99)}).status_code == 200


def test_h_plafond_global_depot_distance(client):
    def handler(sql, p):
        if "kp_phone_key(telephone)" in sql:
            return []
        if "RETURNING id" in sql:
            return {"id": 12}
        return None
    _, gc = _fake(handler)
    corps = {"nom": "Fictif", "telephone": "06 12 34 56 79", "marque": "Marque", "panne": "Batterie"}
    with patch("app.api.depot_distance.get_cursor", gc), patch("app.api.clients.get_cursor", gc), \
            patch.object(depot_api, "envoyer_discord_embed", lambda **k: None), _plafond(depot_api, "_LIMITEUR_DEPOT"):
        codes = [client.post("/api/depot-distance", json=corps, headers=_ip(100 + i)).status_code for i in range(4)]
        assert codes == [200, 200, 200, 429], codes
        r = client.post("/api/depot-distance", json=corps, headers=_ip(110))
        assert "appelez la boutique" in r.json()["detail"]
    assert depot_api._LIMITEUR_DEPOT.limite_globale == 30 and depot_api._LIMITEUR_DEPOT.fenetre_globale == 3600


def test_h_plafond_global_preuve_suivi(client, faux):
    with _plafond(suivi_api, "_LIMITEUR"):
        codes = [client.get(f"/api/tickets/code/{CODE}", params={"t": JETON}, headers=_ip(120 + i)).status_code for i in range(4)]
        assert codes == [200, 200, 200, 429], codes
    assert (suivi_api._LIMITEUR.limite, suivi_api._LIMITEUR.fenetre) == (60, 60)
    assert (suivi_api._LIMITEUR.limite_globale, suivi_api._LIMITEUR.fenetre_globale) == (600, 60)


def _global_consomme(lim):
    return len(lim._buckets.get(CLE_GLOBALE) or ())


def test_h_refus_ne_consomment_pas_le_plafond_global(client):
    """Des requêtes refusées en rafale depuis des IP multiples (422 sans référence, 403 sans preuve,
    400/422 du dépôt) n'épuisent pas le plafond global : la borne du magasin n'est pas bloquée."""
    # Tickets : client_id nu, aucune référence, référence d'une autre IP → 422, rien de compté
    with _creation_ticket(), _plafond(tickets_api, "_LIMITEUR_CREATION"):
        for i in range(6):
            corps = [{**CORPS, "client_id": 1}, CORPS, {**CORPS, "client_ref": ref_anonyme(1, "10.8.8.250")}][i % 3]
            assert client.post("/api/tickets", json=corps, headers=_ip(160 + i)).status_code == 422
        assert _global_consomme(tickets_api._LIMITEUR_CREATION) == 0
        codes = [client.post("/api/tickets", json={**CORPS, "client_ref": ref_anonyme(1, f"10.8.8.{170 + i}")},
                             headers=_ip(170 + i)).status_code for i in range(4)]
        assert codes == [200, 200, 200, 429], codes
    # Commandes de la borne : sans preuve ou mauvais jeton → 403, rien de compté ; ticket inexistant idem
    with _auto(), _plafond(parts_api, "_LIMITEUR_AUTO"):
        for i in range(6):
            corps = [{"ticket_id": 42, "description": "x"}, {"ticket_id": 42, "description": "x", "t": "MauvaisJeton_012345678"}][i % 2]
            assert client.post("/api/parts/auto", json=corps, headers=_ip(180 + i)).status_code == 403
        assert _global_consomme(parts_api._LIMITEUR_AUTO) == 0
    with _auto(existe=False), _plafond(parts_api, "_LIMITEUR_AUTO"):
        assert client.post("/api/parts/auto", json={"ticket_id": 999999, "description": "x", "tel": "06 12 34 56 78"},
                           headers=_ip(186)).status_code == 403
        assert _global_consomme(parts_api._LIMITEUR_AUTO) == 0
    with _auto(), _plafond(parts_api, "_LIMITEUR_AUTO"):
        codes = [client.post("/api/parts/auto", json={"ticket_id": 42, "description": "x", "t": JETON},
                             headers=_ip(190 + i)).status_code for i in range(4)]
        assert codes == [200, 200, 200, 429], codes
    # Fiches : 422 (nom vide, numéro fictif) → rien de compté ; les créations plausibles, oui
    _, gc = _fake(_client_handler(None))
    with patch("app.api.clients.get_cursor", gc), _plafond(clients_api, "_LIMITEUR_CREATION"):
        for i in range(6):
            corps = [{"nom": "", "telephone": "0611223344"}, {"nom": "N", "telephone": "0600000000"}][i % 2]
            assert client.post("/api/clients", json=corps, headers=_ip(200 + i)).status_code == 422
        assert _global_consomme(clients_api._LIMITEUR_CREATION) == 0
        codes = [client.post("/api/clients", json={"nom": "N", "telephone": f"06112233{i:02d}"}, headers=_ip(210 + i)).status_code
                 for i in range(4)]
        assert codes == [200, 200, 200, 429], codes
    # Dépôt à distance : nom vide (400), numéro fictif (422) → rien de compté
    def handler(sql, p):
        if "kp_phone_key(telephone)" in sql:
            return []
        if "RETURNING id" in sql:
            return {"id": 12}
        return None
    _, gc = _fake(handler)
    corps = {"nom": "Fictif", "telephone": "06 12 34 56 79", "marque": "Marque", "panne": "Batterie"}
    with patch("app.api.depot_distance.get_cursor", gc), patch("app.api.clients.get_cursor", gc), \
            patch.object(depot_api, "envoyer_discord_embed", lambda **k: None), _plafond(depot_api, "_LIMITEUR_DEPOT"):
        for i in range(6):
            mauvais = [{**corps, "nom": " "}, {**corps, "telephone": "0600000000"}][i % 2]
            assert client.post("/api/depot-distance", json=mauvais, headers=_ip(220 + i)).status_code in (400, 422)
        assert _global_consomme(depot_api._LIMITEUR_DEPOT) == 0
        codes = [client.post("/api/depot-distance", json=corps, headers=_ip(230 + i)).status_code for i in range(4)]
        assert codes == [200, 200, 200, 429], codes


def test_h_ip_magasin_exemptee_du_plafond_global_jamais_du_quota(client, monkeypatch):
    """KP_IP_MAGASIN (liste statique posée sur Railway) : la borne du magasin passe quand le plafond
    global est saturé par d'autres adresses ; son quota par IP, lui, s'applique toujours."""
    monkeypatch.setenv("KP_IP_MAGASIN", "10.8.8.240,10.8.8.241")
    _, gc = _fake(_client_handler(None))
    with patch("app.api.clients.get_cursor", gc), _plafond(clients_api, "_LIMITEUR_CREATION"):
        for i in range(3):
            assert client.post("/api/clients", json={"nom": "N", "telephone": f"06112255{i:02d}"}, headers=_ip(245 + i)).status_code == 200
        r = client.post("/api/clients", json={"nom": "N", "telephone": "0611225599"}, headers=_ip(249))
        assert r.status_code == 429 and "comptoir" in r.json()["detail"]       # plafond atteint pour les autres
        codes = [client.post("/api/clients", json={"nom": "N", "telephone": f"06112266{i:02d}"}, headers=_ip(240)).status_code
                 for i in range(6)]
        assert codes == [200] * 5 + [429], codes                               # quota par IP de la borne : 5 / 10 min
        r = client.post("/api/clients", json={"nom": "N", "telephone": "0611226699"}, headers=_ip(240))
        assert "depuis ce poste" in r.json()["detail"]
        assert client.post("/api/clients", json={"nom": "N", "telephone": "0611226698"}, headers=_ip(241)).status_code == 200
    with _creation_ticket(), _plafond(tickets_api, "_LIMITEUR_CREATION"):
        for i in range(3):
            assert client.post("/api/tickets", json={**CORPS, "client_ref": ref_anonyme(1, f"10.8.8.{245 + i}")},
                               headers=_ip(245 + i)).status_code == 200
        assert client.post("/api/tickets", json={**CORPS, "client_ref": ref_anonyme(1, "10.8.8.249")}, headers=_ip(249)).status_code == 429
        assert client.post("/api/tickets", json={**CORPS, "client_ref": ref_anonyme(1, "10.8.8.240")}, headers=_ip(240)).status_code == 200
    with _auto(), _plafond(parts_api, "_LIMITEUR_AUTO"):
        for i in range(3):
            assert client.post("/api/parts/auto", json={"ticket_id": 42, "description": "x", "t": JETON}, headers=_ip(245 + i)).status_code == 200
        assert client.post("/api/parts/auto", json={"ticket_id": 42, "description": "x", "t": JETON}, headers=_ip(249)).status_code == 429
        assert client.post("/api/parts/auto", json={"ticket_id": 42, "description": "x", "t": JETON}, headers=_ip(240)).status_code == 200
    # Sans la variable : aucune exemption
    monkeypatch.delenv("KP_IP_MAGASIN")
    with patch("app.api.clients.get_cursor", gc), _plafond(clients_api, "_LIMITEUR_CREATION"):
        for i in range(3):
            client.post("/api/clients", json={"nom": "N", "telephone": f"06112277{i:02d}"}, headers=_ip(245 + i))
        assert client.post("/api/clients", json={"nom": "N", "telephone": "0611227799"}, headers=_ip(240)).status_code == 429


def test_h_valeurs_des_plafonds():
    """Quota par IP resserré (une borne fait 2 à 3 dépôts par 10 min), plafonds globaux écartés :
    épuiser le global exige des dizaines d'adresses, et il n'est consommé qu'après validation."""
    assert (clients_api._LIMITEUR_CREATION.limite, clients_api._LIMITEUR_CREATION.fenetre) == (5, 600)
    assert (clients_api._LIMITEUR_CREATION.limite_globale, clients_api._LIMITEUR_CREATION.fenetre_globale) == (300, 3600)
    assert (tickets_api._LIMITEUR_CREATION.limite, tickets_api._LIMITEUR_CREATION.fenetre) == (5, 600)
    assert (tickets_api._LIMITEUR_CREATION.limite_globale, tickets_api._LIMITEUR_CREATION.fenetre_globale) == (300, 3600)
    assert (parts_api._LIMITEUR_AUTO.limite, parts_api._LIMITEUR_AUTO.fenetre) == (5, 600)
    assert (parts_api._LIMITEUR_AUTO.limite_globale, parts_api._LIMITEUR_AUTO.fenetre_globale) == (200, 3600)
    assert (depot_api._LIMITEUR_DEPOT.limite_globale, depot_api._LIMITEUR_DEPOT.fenetre_globale) == (30, 3600)
    assert depot_api._LIMITEUR_DEPOT.limite * (3600 // depot_api._LIMITEUR_DEPOT.fenetre) < 30   # une IP seule n'atteint pas le global
    for lim in (clients_api._LIMITEUR_CREATION, tickets_api._LIMITEUR_CREATION, parts_api._LIMITEUR_AUTO):
        assert "comptoir" in lim.message_global


def test_h_ip_connue_plafonnee_comme_les_autres(client):
    """Une IP où un jeton valide a été vu (poste de la boutique) reste soumise aux quotas anonymes."""
    auth._IP_CONNUES.noter("10.8.8.130")
    _, gc = _fake(_client_handler(None))
    with patch("app.api.clients.get_cursor", gc):
        codes = [client.post("/api/clients", json={"nom": "N", "telephone": f"06112244{i:02d}"}, headers=_ip(130)).status_code
                 for i in range(6)]
    assert codes[:5] == [200] * 5 and codes[5] == 429
    with _creation_ticket():
        codes = [client.post("/api/tickets", json={**CORPS, "client_ref": ref_anonyme(1, "10.8.8.130")}, headers=_ip(130)).status_code
                 for _ in range(6)]
    assert codes[:5] == [200] * 5 and codes[5] == 429
    assert not hasattr(clients_api, "_IP_CONNUES")


# ═══ K. Numéro en en-tête sur chaque route GET du suivi ════════════════════

@pytest.mark.parametrize("route", ROUTES_GET)
def test_k_en_tete_x_suivi_tel_lu_sur_chaque_route(client, faux, route):
    r = client.get(route.format(CODE), headers={"X-Suivi-Tel": "06 12 34 56 79", **_ip(140)})
    assert r.status_code == 200, (route, r.text)
    assert TEL_CLIENT not in r.text and "0612345679" not in r.text
    # Le jeton en query reste admis (c'est le lien du QR / SMS)
    assert client.get(route.format(CODE), params={"t": JETON}, headers=_ip(141)).status_code == 200
    # Mauvais numéro en en-tête : refusé comme en query, et compté
    r = client.get(route.format(CODE), headers={"X-Suivi-Tel": "06 12 34 56 78", **_ip(142)})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "verification_echouee"


def test_k_chaque_route_par_code_passe_par_preuve_suivi():
    """Les routes publiques par code lisent toutes la preuve via preuve_suivi (en-tête compris)."""
    import inspect
    from app.api import fidelite as fidelite_api
    for fn in (tickets_api.get_ticket_by_code, parts_api.get_commandes_public, suivi_api.has_avis,
               fidelite_api.get_fidelite_by_ticket, fidelite_api.get_grattage):
        assert "preuve_suivi(" in inspect.getsource(fn) or "_ticket_grattage(" in inspect.getsource(fn), fn.__name__
    assert suivi_api.EN_TETE_TEL == "x-suivi-tel" and 'request.headers.get(EN_TETE_TEL' in inspect.getsource(suivi_api.preuve_suivi)
