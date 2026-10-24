"""Écritures en un aller-retour (vitesse d'enregistrement de la fiche et des réglages).

PATCH ticket (UPDATE … RETURNING + relecture complète dans la même instruction), PATCH /statut
qui renvoie le ticket, appel noté et fiche de réception sans SELECT d'existence, client et
réglages en une seule instruction : la réponse reste celle de GET /{id}, les règles d'avant
tiennent.

Base PostgreSQL JETABLE (données fictives, migrations du lifespan rejouées) :
    KP_FICHE_DATABASE_URL="postgresql://postgres:<mot_de_passe>@127.0.0.1:5432/kp_fiche?sslmode=disable" pytest tests/test_ecriture_rapide.py
"""

import json
import os
import sys
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from app.api.auth import create_token

DB_URL = os.getenv("KP_FICHE_DATABASE_URL")
TEL = "0600000858"
H = {"Authorization": f"Bearer {create_token('accueil', 'Sophie')}"}
LIGNES = json.dumps([{"label": "Forfait remplacement écran", "prix": 120}])


@pytest.fixture(scope="module")
def reel():
    if not DB_URL:
        pytest.skip("KP_FICHE_DATABASE_URL non définie (base PostgreSQL de test jetable)")
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
            with vrai_cursor() as cur:
                cur.execute("DELETE FROM tickets WHERE client_id IN (SELECT id FROM clients WHERE telephone = %s)", (TEL,))
                cur.execute("DELETE FROM clients WHERE telephone = ANY(%s)", ([TEL, "0600000859"],))
                cur.execute("INSERT INTO clients (nom, prenom, telephone) VALUES ('Fictif', 'Rapide', %s) RETURNING id", (TEL,))
                cid = cur.fetchone()["id"]
            yield {"c": c, "cur": vrai_cursor, "cid": cid}
    finally:
        mp.undo()
        pool.closeall()


def _sql(reel, sql, *params):
    with reel["cur"]() as cur:
        cur.execute(sql, params)
        return cur.fetchall() if cur.description else None


def _ticket(reel, **kw):
    t = {"client_id": reel["cid"], "categorie": "Smartphone", "marque": "Marque", "modele": "Test",
         "panne": "Écran cassé", "statut": "En attente de diagnostic", "paye": 0}
    t.update(kw)
    cols = list(t)
    with reel["cur"]() as cur:
        cur.execute(
            "INSERT INTO tickets ({}) VALUES ({}) RETURNING id".format(", ".join(cols), ", ".join(["%s"] * len(cols))),
            [t[k] for k in cols],
        )
        tid = cur.fetchone()["id"]
        cur.execute("UPDATE tickets SET ticket_code = %s WHERE id = %s", (f"KR-{tid:06d}", tid))
    return tid


def _meme(patch: dict, get: dict) -> bool:
    """Même ticket : PATCH (response_model=dict) sérialise les DECIMAL en texte (« 80.00 »),
    GET en nombre (80.0) — déjà le cas avant ; tout le reste doit être identique."""
    def norm(v):
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return float(v)
        if isinstance(v, str):
            try:
                return float(v) if v.replace(".", "", 1).lstrip("-").isdigit() else v
            except ValueError:
                return v
        if isinstance(v, dict):
            return {k: norm(x) for k, x in v.items()}
        if isinstance(v, list):
            return [norm(x) for x in v]
        return v
    return norm(patch) == norm(get)


def test_patch_renvoie_exactement_la_reponse_de_get(reel):
    c = reel["c"]
    tid = _ticket(reel)
    retour = _ticket(reel, est_retour_sav=True, ticket_original_id=tid, panne="Retour écran")
    r = c.patch(f"/api/tickets/{tid}", json={"reparation_supp": LIGNES, "prix_supp": 120, "imei": "000000000000001"},
                headers=H)
    assert r.status_code == 200
    ticket = r.json()["ticket"]
    assert _meme(ticket, c.get(f"/api/tickets/{tid}", headers=H).json())
    assert ticket["imei"] == "000000000000001" and ticket["montants"]["total"] == 120
    assert ticket["client_prenom"] == "Rapide" and "contact" in ticket and "contact_brut" not in ticket
    assert [x["id"] for x in ticket["retours_sav"]] == [retour]
    assert not [k for k in ticket if k.startswith("_")]

    # Retour SAV : le ticket d'origine est joint, aucun retour listé
    r = c.patch(f"/api/tickets/{retour}", json={"notes_internes": "Vu"}, headers=H)
    assert r.json()["ticket"]["ticket_original"]["id"] == tid and r.json()["ticket"]["retours_sav"] == []


def test_patch_historise_garde_le_journal_et_la_reponse(reel):
    c = reel["c"]
    tid = _ticket(reel)
    r = c.patch(f"/api/tickets/{tid}", json={"priorite": "express", "tarif_final": 80}, headers=H)
    assert r.status_code == 200
    t = r.json()["ticket"]
    assert t["priorite"] == "express" and float(t["tarif_final"]) == 80
    assert "Priorité : Normal → Express — par Sophie" in t["historique"]
    lignes = _sql(reel, "SELECT contenu FROM historique WHERE ticket_id = %s", tid)
    assert [x["contenu"] for x in lignes] == ["Priorité : Normal → Express — par Sophie"]
    assert _meme(t, c.get(f"/api/tickets/{tid}", headers=H).json())


def test_patch_learn_lit_l_etat_d_avant(reel, monkeypatch):
    from app.api import tickets as tickets_api
    appels = []
    monkeypatch.setattr(tickets_api, "learn_terms", lambda appris, avant: appels.append((appris, dict(avant))))
    c = reel["c"]
    tid = _ticket(reel, panne="Batterie", panne_detail="Ancien détail")
    r = c.patch(f"/api/tickets/{tid}?learn=1", json={"panne_detail": "Nouveau détail"}, headers=H)
    assert r.status_code == 200 and r.json()["ticket"]["panne_detail"] == "Nouveau détail"
    assert appels == [({"panne_detail": "Nouveau détail"},
                       {"panne": "Batterie", "panne_detail": "Ancien détail", "modele_autre": None})]
    assert not [k for k in r.json()["ticket"] if k.startswith("_")]


def test_statut_renvoie_le_ticket_relu(reel):
    c = reel["c"]
    tid = _ticket(reel, statut="Pièce reçue")
    _sql(reel, "INSERT INTO commandes_pieces (ticket_id, description, statut) VALUES (%s, 'Écran fictif', 'Reçu')", tid)
    r = c.patch(f"/api/tickets/{tid}/statut", json={"statut": "En cours de réparation"}, headers=H)
    assert r.status_code == 200
    b = r.json()
    assert b["ancien_statut"] == "Pièce reçue" and b["nouveau_statut"] == "En cours de réparation"
    t = b["ticket"]
    assert t["statut"] == "En cours de réparation" and t["reparation_debut"] and t["reparation_fin"] is None
    assert "Statut: Pièce reçue → En cours de réparation" in t["historique"]
    assert _meme(t, c.get(f"/api/tickets/{tid}", headers=H).json())
    assert _sql(reel, "SELECT statut FROM commandes_pieces WHERE ticket_id = %s", tid)[0]["statut"] == "En réparation"
    # Le contact repart du changement de statut (la ligne d'historique est vue par la relecture)
    assert t["contact"]["depuis_statut"] is False


def test_appel_note_et_contact_relu(reel):
    c = reel["c"]
    tid = _ticket(reel)
    r = c.post(f"/api/tickets/{tid}/contact", json={"canal": "appel", "note": "  rappeler   demain "}, headers=H)
    assert r.status_code == 200, r.text
    b = r.json()
    note = _sql(reel, "SELECT id, contenu, type_note FROM notes_tickets WHERE ticket_id = %s", tid)
    assert [n["id"] for n in note] == [b["note_id"]] and note[0]["type_note"] == "appel"
    assert note[0]["contenu"].endswith(": rappeler demain")
    assert b["contact"]["depuis_statut"] is True and b["contact"]["dernier"]["canal"] == "appel"
    assert b["contact"]["dernier"]["auteur"] == "Sophie"
    avant = _sql(reel, "SELECT count(*) AS n FROM notes_tickets")[0]["n"]
    assert c.post("/api/tickets/987654321/contact", json={"canal": "appel"}, headers=H).status_code == 404
    assert _sql(reel, "SELECT count(*) AS n FROM notes_tickets")[0]["n"] == avant


def test_reception_sans_ticket_404_et_trace_une_fois(reel):
    c = reel["c"]
    items = {"accessoires": [], "etat": {}, "tests": {}}
    assert c.put("/api/tickets/987654321/reception", json={"items": items, "complete": True},
                 headers=H).status_code == 404
    assert not _sql(reel, "SELECT 1 FROM ticket_controles WHERE ticket_id = 987654321")
    tid = _ticket(reel)
    for complete in (False, True, True):
        r = c.put(f"/api/tickets/{tid}/reception", json={"items": items, "complete": complete}, headers=H)
        assert r.status_code == 200, r.text
    traces = _sql(reel, "SELECT contenu FROM historique WHERE ticket_id = %s AND type = 'reception'", tid)
    assert len(traces) == 1 and "par Sophie" in traces[0]["contenu"]


def test_client_consentement_en_une_instruction(reel):
    c = reel["c"]
    cid = _sql(reel, "INSERT INTO clients (nom, telephone) VALUES ('Fictif', '0600000859') RETURNING id")[0]["id"]
    try:
        ligne = lambda: _sql(reel, "SELECT * FROM clients WHERE id = %s", cid)[0]  # noqa: E731
        assert ligne()["consentement_marketing"] in (None, False)
        # Retrait sans accord préalable : rien ne bouge (ni date de retrait, ni valeur)
        avant = ligne()
        assert c.patch(f"/api/clients/{cid}", json={"consentement_marketing": False}, headers=H).status_code == 200
        apres = ligne()
        assert apres["consentement_marketing"] == avant["consentement_marketing"]
        assert apres["consentement_marketing_retire_le"] is None
        # Accord et nom dans la même requête : daté, avec son canal
        assert c.patch(f"/api/clients/{cid}", json={"nom": "Fictive", "consentement_marketing": True},
                       headers=H).status_code == 200
        row = ligne()
        assert row["nom"] == "Fictive" and row["consentement_marketing"] is True
        premier = row["consentement_marketing_le"]
        assert premier and row["consentement_marketing_source"].startswith("comptoir")
        # Accord redonné : la date d'origine reste
        c.patch(f"/api/clients/{cid}", json={"consentement_marketing": True}, headers=H)
        assert ligne()["consentement_marketing_le"] == premier
        # Retrait : daté, l'accord passé reste daté
        c.patch(f"/api/clients/{cid}", json={"consentement_marketing": False, "prenom": "Élo"}, headers=H)
        row = ligne()
        assert row["consentement_marketing"] is False and row["consentement_marketing_le"] == premier
        assert row["consentement_marketing_retire_le"] and row["prenom"] == "Élo"
    finally:
        _sql(reel, "DELETE FROM clients WHERE id = %s", cid)


def test_reglages_en_un_seul_insert(reel):
    from app.api import config as config_api
    cles = ("ZZ_TEST_RAPIDE_A", "ZZ_TEST_RAPIDE_B")
    try:
        with reel["cur"]() as cur:
            config_api._ecrire_params(cur, [(cles[0], "1"), (cles[1], "50 % ; l'apostrophe"), (cles[0], "2")])
        valeurs = {r["cle"]: r["valeur"] for r in _sql(reel, "SELECT cle, valeur FROM params WHERE cle = ANY(%s)", list(cles))}
        assert valeurs == {cles[0]: "2", cles[1]: "50 % ; l'apostrophe"}     # la dernière valeur l'emporte
    finally:
        _sql(reel, "DELETE FROM params WHERE cle = ANY(%s)", list(cles))
