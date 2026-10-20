"""Lot 5 (check-up) : devis, Devis Flash, impressions, attestations, RGPD, notifications.

Les tests purs tournent toujours. Ceux sur base réelle exigent une base PostgreSQL JETABLE
(données fictives, migrations du lifespan rejouées) :
    KP_LOT5_DEVIS_DATABASE_URL="postgresql://postgres:<mot_de_passe>@127.0.0.1:5432/kp_lot5?sslmode=disable" \
        pytest tests/test_lot5_devis_impressions.py
"""

import os
import re
import sys
import zlib
from contextlib import contextmanager
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api import attestation, devis as devis_api, print_tickets
from app.api.auth import create_token
from app.api.notifications_center import texte_chat
from app.services import params as params_cache


# ═══ Délai promis et téléphone à l'impression ══════════════════════

@pytest.mark.parametrize("brut, attendu", [
    ("2026-10-19T17:50", "lun. 19/10/2026 à 17h50"),
    ("2026-10-20T17:30", "mar. 20/10/2026 à 17h30"),
    ("2026-10-20 17:30:00", "mar. 20/10/2026 à 17h30"),
    ("2026-10-20", "mar. 20/10/2026"),
    ("Jeudi 17h", "Jeudi 17h"),
    ("15/10/2026", "15/10/2026"),
    ("2026-02-31T10:00", "2026-02-31T10:00"),     # date impossible : texte tel quel
    ("2026-10-20T25:00", "2026-10-20T25:00"),
    ("  Demain   matin ", "Demain matin"),
    (None, ""),
    ("", ""),
])
def test_fmt_recup(brut, attendu):
    assert print_tickets._fmt_recup(brut) == attendu


@pytest.mark.parametrize("brut, attendu", [
    ("0600000101", "06 00 00 01 01"),
    ("06.00.00.01.01", "06 00 00 01 01"),
    ("06 00 00 01 01", "06 00 00 01 01"),
    ("+33600000101", "+33 6 00 00 01 01"),
    ("+41 79 000 00 00", "+41 79 000 00 00"),   # étranger : tel quel
    ("12345", "12345"),
    (None, ""),
])
def test_fmt_tel(brut, attendu):
    assert print_tickets._fmt_tel(brut) == attendu


def _ticket(**extra):
    t = {
        "id": 42, "ticket_code": "KP-000042", "client_id": 7,
        "client_prenom": "Pytest", "client_nom": "Fictif",
        "client_tel": "0600000101", "client_email": "fictif@example.invalid",
        "marque": "Apple", "modele": "iPhone 13", "modele_autre": None, "categorie": "Smartphone",
        "panne": "Batterie", "panne_detail": None, "imei": None, "pin": None, "pattern": None,
        "notes_client": None, "technicien_assigne": "Tech",
        "date_depot": datetime(2026, 10, 19, 8, 12), "date_recuperation": "2026-10-20T17:30",
        "type_ecran": None, "devis_estime": 79, "acompte": 0, "paye": 0,
        "statut": "En cours de réparation", "reparation_supp": None, "suivi_token": None,
    }
    t.update(extra)
    return t


@pytest.mark.parametrize("kind", ["client", "staff", "combined"])
def test_impressions_delai_lisible_et_telephone_par_paires(kind):
    html = print_tickets.render_html(_ticket(), kind)
    assert "2026-10-20T17:30" not in html
    assert "mar. 20/10/2026 à 17h30" in html
    assert "0600000101" not in html and "06 00 00 01 01" in html


@pytest.mark.parametrize("kind", ["devis", "recu"])
def test_impressions_devis_recu_telephone_par_paires(kind):
    html = print_tickets.render_html(_ticket(), kind)
    assert "0600000101" not in html and "06 00 00 01 01" in html


def test_impression_texte_libre_garde_tel_quel():
    html = print_tickets.render_html(_ticket(date_recuperation="Jeudi 17h"), "staff")
    assert "Récup :</strong> Jeudi 17h" in html


def test_a4_delai_lisible():
    html = print_tickets._devis_a4_html(_ticket())
    assert "2026-10-20T17:30" not in html and "mar. 20/10/2026 à 17h30" in html
    assert "06 00 00 01 01" in html


def _textes_pdf(pdf: bytes) -> bytes:
    out = b""
    for m in re.finditer(rb"/Length (\d+)[^>]*>>\s*stream\r?\n", pdf):
        f = pdf[m.end():m.end() + int(m.group(1))]
        try:
            out += zlib.decompress(f)
        except zlib.error:
            out += f
    return out


@pytest.mark.parametrize("doc", ["devis", "recu"])
def test_pdf_delai_lisible_et_telephone(doc):
    texte = _textes_pdf(print_tickets._build_pdf(_ticket(), doc))
    assert b"2026-10-20T17:30" not in texte
    assert "20/10/2026 à 17h30".encode("latin-1") in texte
    assert b"06 00 00 01 01" in texte and b"0600000101" not in texte


# ═══ Devis : bornes de l'API ═══════════════════════════════════════

@pytest.mark.parametrize("payload", [
    {"client_nom": "F", "tva": -20},
    {"client_nom": "F", "remise": -50},
    {"client_nom": "F", "validite_jours": -3},
    {"client_nom": "F", "lignes": [{"description": "x", "quantite": -3, "prix_unitaire": 10}]},
    {"client_nom": "F", "lignes": [{"description": "x", "quantite": 1, "prix_unitaire": -100}]},
    {"client_id": -2147483649},
    {"client_id": 2147483648},
    {"client_nom": "F", "validite_jours": 10 ** 12},
    {"client_nom": "F", "tva": 1e300},
    {"client_nom": "F", "tva": 31},
    {"client_nom": "F", "lignes": [{"description": "x", "quantite": 1, "prix_unitaire": 1e300}]},
])
def test_devis_valeurs_absurdes_refusees_422(client, auth_headers, payload):
    assert client.post("/api/devis", json=payload, headers=auth_headers).status_code == 422
    assert client.patch("/api/devis/1", json=payload, headers=auth_headers).status_code == 422


@pytest.mark.parametrize("qs", ["limit=-1", "offset=-1", "limit=201", "offset=99999999999"])
def test_devis_listes_limit_offset_negatifs_422(client, auth_headers, qs):
    assert client.get(f"/api/devis?{qs}", headers=auth_headers).status_code == 422
    assert client.get(f"/api/devis/telephones-vente?{qs}", headers=auth_headers).status_code == 422


def test_devis_tva_zero_et_bornes_valides():
    d = devis_api.DevisCreate(client_nom="F", tva=0, remise=0, validite_jours=365,
                              lignes=[{"description": "x", "quantite": 1, "prix_unitaire": 0}])
    assert d.tva == 0 and d.validite_jours == 365
    assert devis_api._calc_totals([{"quantite": 1, "prix_unitaire": 108.42}], 0, 0) == (108.42, 108.42)


# ═══ Téléphones en vente : modèle Pydantic ═════════════════════════

def test_telephone_vente_prix_a_la_francaise():
    t = devis_api.TelephoneVenteIn(marque="Apple", modele="iPhone 12", prix_vente="299,90", prix_achat="")
    assert t.prix_vente == 299.9 and t.prix_achat is None
    assert devis_api.TelephoneVenteIn(prix_vente=" 1 299,00 € ").prix_vente == 1299.0


@pytest.mark.parametrize("champs", [
    {"prix_vente": "abc"}, {"prix_vente": -1}, {"prix_achat": "-5"}, {"etat": "Cassé"},
    {"imei": "1" * 21}, {"marque": "A" * 101},
])
def test_telephone_vente_valeurs_refusees(champs):
    with pytest.raises(ValidationError):
        devis_api.TelephoneVenteIn(**{"marque": "Apple", "modele": "iPhone 12", **champs})


def test_telephone_vente_api_422_lisible(client, auth_headers):
    r = client.post("/api/devis/telephones-vente", json={"marque": "Apple", "modele": "X", "etat": "Cassé"},
                    headers=auth_headers)
    assert r.status_code == 422
    r = client.patch("/api/devis/telephones-vente/1", json={"prix_vente": "abc"}, headers=auth_headers)
    assert r.status_code == 422


# ═══ Attestation ═══════════════════════════════════════════════════

_ATT = {"nom": "Fictif", "marque": "Apple", "modele": "iPhone 13", "motif": "Carte mère HS"}


@pytest.mark.parametrize("extra", [
    {"client_id": 10 ** 12}, {"client_id": 0}, {"nom": "x" * 100_000}, {"telephone": "0" * 21},
    {"motif": "x" * 5001},
])
def test_attestation_bornes_422(client, auth_headers, extra):
    assert client.post("/api/attestation/generate", json={**_ATT, **extra}, headers=auth_headers).status_code == 422


def test_attestation_historique_limit_negative_422(client, auth_headers):
    assert client.get("/api/attestation/history?limit=-1", headers=auth_headers).status_code == 422


def test_attestation_cree_par_est_le_membre_connecte(monkeypatch):
    vus = []

    class Cur:
        def execute(self, sql, params=None):
            vus.append(params)

        def fetchone(self):
            return {"id": 1}

    @contextmanager
    def faux_cursor():
        yield Cur()

    monkeypatch.setattr(attestation, "get_cursor", faux_cursor)
    attestation._save_attestation(attestation.AttestationRequest(**_ATT), {"sub": "Nour Démo", "target": "accueil"})
    assert vus[0][-1] == "Nour Démo"


# ═══ Notifications : une seule icône dans l'écho du chat ════════════

def test_texte_chat_une_seule_icone():
    assert texte_chat("✅ Devis X accepté", "msg", "✅") == "✅ Devis X accepté\nmsg"
    assert texte_chat("Devis X accepté", "msg", "✅", "/accueil/ticket/3") == "✅ Devis X accepté\nmsg\n→ /accueil/ticket/3"
    assert texte_chat("Veille", "m") == "🔔 Veille\nm"


# ═══ Base réelle ═══════════════════════════════════════════════════

DB_URL = os.getenv("KP_LOT5_DEVIS_DATABASE_URL")
TEL = "0600000881"
H = {"Authorization": f"Bearer {create_token('accueil', 'Nour Démo')}"}


@pytest.fixture(scope="module")
def reel():
    if not DB_URL:
        pytest.skip("KP_LOT5_DEVIS_DATABASE_URL non définie (base PostgreSQL de test jetable)")
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
    mp.setattr(app.database, "get_cursor", vrai_cursor)
    for nom, mod in list(sys.modules.items()):
        if nom.startswith("app.") and mod is not app.database and getattr(mod, "get_cursor", None) is not None:
            mp.setattr(mod, "get_cursor", vrai_cursor)
    from app.main import app as fastapi_app
    try:
        with TestClient(fastapi_app) as c:   # lifespan : schéma + migrations
            yield {"c": c, "cur": vrai_cursor}
    finally:
        mp.undo()
        pool.closeall()
        params_cache.invalidate()


def _sql(reel, sql, *params):
    with reel["cur"]() as cur:
        cur.execute(sql, params)
        return cur.fetchall() if cur.description else None


def _nettoyer_flash(reel):
    _sql(reel, "DELETE FROM tarifs WHERE modele IN ('Redmi Note 99 Pytest', 'iPhone 99 Pytest')")
    _sql(reel, "DELETE FROM tarifs_reparation WHERE modele = 'iPhone 99 Pytest'")


def test_reel_flash_sans_pieces_a_renseigner_ni_obsoletes(reel):
    _nettoyer_flash(reel)
    try:
        for tp, prix, src, obs in (("Ecran", 0, "a_renseigner", False), ("Batterie", 0, None, False),
                                   ("Connecteur de charge", 39, "a_renseigner", False),
                                   ("Haut-parleur", 49, None, True), ("Vitre arriere", 59, None, False)):
            _sql(reel, "INSERT INTO tarifs (marque, modele, type_piece, qualite, prix_client, prix_source, obsolete) "
                       "VALUES ('Xiaomi', 'Redmi Note 99 Pytest', %s, '', %s, %s, %s)", tp, prix, src, obs)
        r = reel["c"].get("/api/devis/flash/search", params={"q": "Redmi Note 99 Pytest"}, headers=H)
        assert r.status_code == 200
        (m,) = r.json()
        assert [(x["composant"], x["prix_vente"]) for x in m["reparations"]] == [("Vitre arriere", 59.0)]
    finally:
        _nettoyer_flash(reel)


def test_reel_flash_iphone_grille_boutique_prioritaire_et_tva(reel):
    _nettoyer_flash(reel)
    try:
        _sql(reel, "INSERT INTO tarifs_reparation (modele, batterie, ecran_generique, ordre) "
                   "VALUES ('iPhone 99 Pytest', 99, 129, 999)")
        for tp, prix in (("Batterie", 79), ("Haut-parleur", 69)):
            _sql(reel, "INSERT INTO tarifs (marque, modele, type_piece, qualite, prix_client) "
                       "VALUES ('Apple', 'iPhone 99 Pytest', %s, '', %s)", tp, prix)
        _sql(reel, "INSERT INTO params (cle, valeur) VALUES ('tva', '20') "
                   "ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur")
        r = reel["c"].get("/api/devis/flash/search", params={"q": "iPhone 99 Pytest"}, headers=H)
        assert r.status_code == 200
        (m,) = r.json()
        reps = {(x["composant"], x["qualite"]): x["prix_vente"] for x in m["reparations"]}
        assert reps[("Batterie", None)] == 99.0          # grille boutique, pas la pièce fournisseur à 79
        assert reps[("Écran", "Générique")] == 129.0
        assert reps[("Haut-parleur", None)] == 69.0      # type non couvert : pièce fournisseur gardée
        assert 79.0 not in reps.values()
        assert m["tva"] == 20.0
    finally:
        _nettoyer_flash(reel)


def _client(reel):
    _sql(reel, "DELETE FROM devis WHERE client_tel = %s OR client_id IN (SELECT id FROM clients WHERE telephone = %s)",
         TEL, TEL)
    _sql(reel, "DELETE FROM tickets WHERE client_id IN (SELECT id FROM clients WHERE telephone = %s)", TEL)
    _sql(reel, "DELETE FROM clients WHERE telephone = %s", TEL)
    return _sql(reel, "INSERT INTO clients (nom, prenom, telephone) VALUES ('Fictifnom', 'Pytestprenom', %s) "
                      "RETURNING id", TEL)[0]["id"]


def test_reel_devis_nom_seul_convertible(reel):
    c = reel["c"]
    r = c.post("/api/devis", json={"client_nom": "NomSeulPytest", "lignes": [
        {"description": "Batterie", "quantite": 1, "prix_unitaire": 65.83}]}, headers=H)
    assert r.status_code == 200
    did = r.json()["id"]
    try:
        assert c.patch(f"/api/devis/{did}", json={"statut": "Accepté"}, headers=H).status_code == 200
        r = c.post(f"/api/devis/{did}/convert", headers=H)
        assert r.status_code == 200, r.text
        tid = r.json()["ticket_id"]
        (d,) = _sql(reel, "SELECT d.client_id, c.nom, t.client_id AS tcid, t.devis_estime FROM devis d "
                          "JOIN clients c ON c.id = d.client_id JOIN tickets t ON t.id = d.ticket_id WHERE d.id = %s", did)
        assert d["nom"] == "NomSeulPytest" and d["tcid"] == d["client_id"]
        assert float(d["devis_estime"]) == 79.0
    finally:
        row = _sql(reel, "SELECT client_id, ticket_id FROM devis WHERE id = %s", did)
        _sql(reel, "DELETE FROM devis WHERE id = %s", did)
        if row and row[0]["ticket_id"]:
            _sql(reel, "DELETE FROM tickets WHERE id = %s", row[0]["ticket_id"])
        if row and row[0]["client_id"]:
            _sql(reel, "DELETE FROM clients WHERE id = %s", row[0]["client_id"])


def test_reel_telephone_vente_virgule_et_vide(reel):
    c = reel["c"]
    r = c.post("/api/devis/telephones-vente", json={"marque": "Apple", "modele": "iPhone 12 Pytest",
                                                    "prix_vente": "299,90", "prix_achat": ""}, headers=H)
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    try:
        (t,) = _sql(reel, "SELECT prix_vente, prix_achat FROM telephones_vente WHERE id = %s", tid)
        assert float(t["prix_vente"]) == 299.9 and float(t["prix_achat"]) == 0
        assert c.patch(f"/api/devis/telephones-vente/{tid}", json={"prix_vente": "249,50", "en_stock": False},
                       headers=H).status_code == 200
        (t,) = _sql(reel, "SELECT prix_vente, en_stock FROM telephones_vente WHERE id = %s", tid)
        assert float(t["prix_vente"]) == 249.5 and t["en_stock"] is False
    finally:
        _sql(reel, "DELETE FROM telephones_vente WHERE id = %s", tid)


def test_reel_notification_devis_sans_nom_et_anonymisation(reel):
    c = reel["c"]
    cid = _client(reel)
    _sql(reel, "DELETE FROM chat_messages WHERE message LIKE %s", "%Fictifnom%")
    tid = _sql(reel, "INSERT INTO tickets (client_id, categorie, marque, modele, panne, statut) "
                     "VALUES (%s, 'Smartphone', 'Apple', 'iPhone 13', 'Batterie', 'En attente d''accord client') "
                     "RETURNING id", cid)[0]["id"]
    did = c.post("/api/devis", json={"client_id": cid, "lignes": [
        {"description": "Batterie", "quantite": 1, "prix_unitaire": 108.42}], "tva": 20}, headers=H).json()["id"]
    _sql(reel, "UPDATE devis SET ticket_id = %s WHERE id = %s", tid, did)
    try:
        assert c.patch(f"/api/devis/{did}", json={"statut": "Accepté"}, headers=H).status_code == 200
        (n,) = _sql(reel, "SELECT title, message, icon FROM notifications_center WHERE related_devis_id = %s", did)
        assert "Fictifnom" not in n["message"] and "Pytestprenom" not in n["message"]
        assert not n["title"].startswith(n["icon"])
        echo = texte_chat(n["title"], n["message"], n["icon"], f"/accueil/ticket/{tid}")
        assert echo.count("✅") == 1
        assert _sql(reel, "SELECT 1 FROM chat_messages WHERE message = %s", echo)
        # Ancienne notification (avant correctif) : nom du client, icône doublée dans le chat
        _sql(reel, "INSERT INTO notifications_center (type, title, message, icon, related_ticket_id) "
                   "VALUES ('message_client', '💬 Client Pytestprenom Fictifnom — KP', 'Client : bonjour', '💬', %s)", tid)
        _sql(reel, "INSERT INTO chat_messages (sender, recipient, message) "
                   "VALUES ('Système', 'all', '💬 💬 Client Pytestprenom Fictifnom — KP\nClient : bonjour')")
        from app.api import rgpd
        with reel["cur"]() as cur:   # cœur commun de l'anonymisation (bouton du client, rétention)
            assert rgpd._anonymiser(cur, [cid])[0] == [cid]
        restes = _sql(reel, "SELECT title, message FROM notifications_center WHERE related_ticket_id = %s "
                            "OR related_devis_id = %s", tid, did)
        assert restes and all("Fictifnom" not in x["title"] + x["message"] for x in restes)
        assert not _sql(reel, "SELECT 1 FROM chat_messages WHERE message LIKE %s", "%Fictifnom%")
    finally:
        _sql(reel, "DELETE FROM notifications_center WHERE related_ticket_id = %s OR related_devis_id = %s", tid, did)
        _sql(reel, "DELETE FROM chat_messages WHERE message LIKE %s OR message LIKE %s",
             "%Fictifnom%", f"%/accueil/ticket/{tid}")
        _sql(reel, "DELETE FROM devis WHERE id = %s", did)
        _sql(reel, "DELETE FROM tickets WHERE id = %s", tid)
        _sql(reel, "DELETE FROM clients WHERE id = %s", cid)


def test_reel_attestation_cree_par(reel):
    r = reel["c"].post("/api/attestation/generate", json=_ATT, headers=H)
    assert r.status_code == 200
    aid = r.json()["attestation_id"]
    try:
        (a,) = _sql(reel, "SELECT cree_par FROM attestations WHERE id = %s", aid)
        assert a["cree_par"] == "Nour Démo"
        assert reel["c"].get(f"/api/attestation/history/{aid}", headers=H).status_code == 200
    finally:
        _sql(reel, "DELETE FROM attestations WHERE id = %s", aid)
