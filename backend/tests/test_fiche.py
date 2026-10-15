"""Fiche ticket (vague B) : montants, restitution, garde-fous de statut, paiement idempotent,
PATCH partiel, caisse dédoublonnée, apprentissage, dépôt à distance, migrations.

Les tests purs tournent toujours. Les tests sur base réelle exigent une base
PostgreSQL JETABLE (données fictives, migrations du lifespan rejouées) :
    KP_FICHE_DATABASE_URL="postgresql://postgres:<mot_de_passe>@127.0.0.1:5432/kp_fiche?sslmode=disable" pytest tests/test_fiche.py
"""

import json
import os
import sys
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from app.api.auth import create_token
from app.api.autocomplete import est_terme_partiel
from app.api.depot_distance import html_confirmation, panne_catalogue
from app.services.caisse import vente_ticket
from app.services.montants import calculer_montants, statut_paiement

LIGNES_120 = json.dumps([{"label": "Forfait remplacement écran", "prix": 120}])


# ─── Montants : une seule règle ────────────────────────────────

def test_lignes_json_pas_de_double_comptage():
    # La fiche enregistre prix_supp = somme des lignes ET tarif_final : jamais additionnés
    m = calculer_montants({"reparation_supp": LIGNES_120, "prix_supp": 120, "tarif_final": 120})
    assert m["total"] == 120 and m["reste"] == 120


@pytest.mark.parametrize("extra, total, reste", [
    ({"reduction_pourcentage": 10}, 108, 108),
    ({"reduction_montant": 20}, 100, 100),
    ({"reduction_pourcentage": 10, "reduction_montant": 50}, 108, 108),   # % prioritaire
    ({"acompte": 30}, 120, 90),
    ({"acompte": 500}, 120, 0),
    ({"reduction_montant": 999}, 0, 0),
    ({"paye": 1, "acompte": 30}, 120, 0),
])
def test_reduction_acompte_paye(extra, total, reste):
    m = calculer_montants({"reparation_supp": LIGNES_120, **extra})
    assert (m["total"], m["reste"]) == (total, reste)


def test_repli_devis_estime_sans_ligne_chiffree():
    m = calculer_montants({"reparation_supp": json.dumps([{"label": "Diagnostic", "prix": 0}]), "devis_estime": 80})
    assert m["total"] == 80


def test_ancien_format_supplement_texte():
    m = calculer_montants({"panne": "Batterie", "devis_estime": 50, "reparation_supp": "Coque", "prix_supp": "10,5"})
    assert m["sous_total"] == 60.5 and [r["label"] for r in m["lignes"]] == ["Forfait remplacement batterie", "Coque"]


def test_ancien_format_tarif_final_seul_reduction_comprise():
    m = calculer_montants({"tarif_final": 70, "reduction_montant": 10})
    assert m["total"] == 70


@pytest.mark.parametrize("t, total, source", [
    # Prix négocié sans champ de réduction : tarif_final fait foi (règle de l'ancienne caisse)
    ({"panne": "Batterie", "devis_estime": 80, "tarif_final": 70}, 70, "tarif_final"),
    ({"panne": "Batterie", "devis_estime": 80, "tarif_final": 70, "reduction_montant": 10}, 70, "tarif_final"),
    ({"panne": "Batterie", "devis_estime": 80, "reduction_montant": 10}, 70, "lignes"),
    # Nouveau format : les lignes priment toujours sur un tarif_final périmé
    ({"reparation_supp": LIGNES_120, "tarif_final": 100}, 120, "lignes"),
])
def test_ancien_format_tarif_final_prioritaire(t, total, source):
    m = calculer_montants(t)
    assert (m["total"], m["source"]) == (total, source)


ECRAN_180 = {"label": "Forfait remplacement écran", "prix": 180}


@pytest.mark.parametrize("t, total, labels", [
    ({"reparation_supp": json.dumps([ECRAN_180]), "devis_estime": 180}, 0, []),
    ({"reparation_supp": json.dumps([{"label": "Écran", "prix": 0}]), "devis_estime": 180, "tarif_final": 180}, 0, []),
    ({"reparation_supp": json.dumps([ECRAN_180, {"label": "Diagnostic", "prix": 25}])}, 25, ["Diagnostic"]),
    ({"reparation_supp": json.dumps([ECRAN_180, {"label": "Frais de dossier", "prix": 10}])}, 10, ["Frais de dossier"]),
    ({"panne": "Écran cassé", "devis_estime": 180, "tarif_final": 180}, 0, []),
    ({"panne": "Diagnostic", "devis_estime": 30}, 30, ["Diagnostic"]),
])
def test_devis_refuse_seuls_les_frais_sont_dus(t, total, labels):
    m = calculer_montants({**t, "issue": "refus_devis"})
    assert m["refus_devis"] is True and m["total"] == m["reste"] == total
    assert [r["label"] for r in m["lignes"]] == labels


def test_devis_refuse_acompte_trop_percu():
    m = calculer_montants({"reparation_supp": json.dumps([ECRAN_180]), "acompte": 50, "issue": "refus_devis"})
    assert (m["total"], m["reste"], m["trop_percu"]) == (0, 0, 50)


def test_statut_paiement_suit_le_drapeau_paye():
    assert statut_paiement({"paye": True, "acompte": 0}) == "Payé"
    assert statut_paiement({"paye": False, "acompte": 20}) == "Acompte versé"
    assert statut_paiement({"paye": False, "acompte": 0}) == "Non payé"


def test_libelle_caisse_depuis_les_lignes():
    montant, libelle = vente_ticket({
        "reparation_supp": json.dumps([{"label": "Forfait remplacement écran", "prix": 129},
                                       {"label": "Verre_trempé", "prix": 10}]),
        "marque": "Apple", "modele": "iPhone 12", "type_ecran": "OLED",
    })
    assert montant == 139
    assert libelle == "Forfait remplacement écran + Verre trempé - Apple iPhone 12 [OLED]"


# ─── Autocomplétion, dépôt public ──────────────────────────────

@pytest.mark.parametrize("terme, connus, partiel", [
    ("batt", ["Batterie HS"], True),
    ("Ecran cass", ["Écran cassé"], True),
    ("Batterie", ["Batterie HS"], False),
    ("Lecteur SIM HS", ["Batterie HS"], False),
])
def test_terme_partiel(terme, connus, partiel):
    assert est_terme_partiel(terme, connus) is partiel


@pytest.mark.parametrize("panne, detail, attendu", [
    ("Écran casse", "", ("Écran cassé", "")),
    ("camera arriere", "flou", ("Caméra arrière", "flou")),
    ("Batterie HS", "", ("Batterie", "")),
    ("autre", "x", ("Autre", "x")),
    ("Clavier bloqué", "touche A", ("Autre", "Clavier bloqué — touche A")),
    ("", "d", ("", "d")),
])
def test_panne_normalisee_jamais_rejetee(panne, detail, attendu):
    assert panne_catalogue(panne, detail) == attendu


def test_email_confirmation_echappe():
    html = html_confirmation("Klikphone", "Adresse", "04", "<script>x</script>", "KP-000001",
                             '<a href="http://x">', "Écran & co")
    assert "<script>" not in html and "&lt;script&gt;" in html
    assert '<a href="http://x">' not in html and "&amp; co" in html


# ─── Contrat HTTP sans base (curseur simulé) ───────────────────

def test_restitution_exige_une_session(client):
    assert client.post("/api/tickets/1/restitution", json={"paiement": "encaisser"}).status_code == 401


def test_restitution_paiement_invalide(client, auth_headers):
    r = client.post("/api/tickets/1/restitution", json={"paiement": "gratuit"}, headers=auth_headers)
    assert r.status_code == 422


@pytest.mark.parametrize("montant", ["-1", "NaN", "Infinity"])
def test_restitution_montant_invalide(client, auth_headers, montant):
    r = client.post("/api/tickets/1/restitution", content=f'{{"paiement": "encaisser", "montant": {montant}}}',
                    headers={**auth_headers, "Content-Type": "application/json"})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "montant_invalide"


def test_restitution_ticket_inconnu(client, auth_headers):
    r = client.post("/api/tickets/1/restitution", json={"paiement": "encaisser"}, headers=auth_headers)
    assert r.status_code == 404


def test_learn_anonyme_ne_deconnecte_pas(client):
    r = client.post("/api/autocomplete/learn", json={"categorie": "panne", "terme": "Écran"})
    assert r.status_code == 200 and r.json() == {"success": False}


# ═══ Base réelle ═══════════════════════════════════════════════

DB_URL = os.getenv("KP_FICHE_DATABASE_URL")
TEL = "0600000777"
H = {"Authorization": f"Bearer {create_token('accueil', 'Sophie')}"}


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
                cur.execute("DELETE FROM fidelite_historique WHERE client_id IN (SELECT id FROM clients WHERE telephone = %s)", (TEL,))
                cur.execute("DELETE FROM tickets WHERE client_id IN (SELECT id FROM clients WHERE telephone = %s)", (TEL,))
                cur.execute("DELETE FROM clients WHERE telephone = %s", (TEL,))
                cur.execute("INSERT INTO clients (nom, prenom, telephone) VALUES ('Fictif', 'Pytest', %s) RETURNING id", (TEL,))
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
         "panne": "Écran cassé", "statut": "Réparation terminée", "paye": 0}
    t.update(kw)
    cols = list(t)
    with reel["cur"]() as cur:
        cur.execute(
            "INSERT INTO tickets ({}) VALUES ({}) RETURNING id".format(", ".join(cols), ", ".join(["%s"] * len(cols))),
            [t[k] for k in cols],
        )
        tid = cur.fetchone()["id"]
        cur.execute("UPDATE tickets SET ticket_code = %s WHERE id = %s", (f"KP-{tid:06d}", tid))
    return tid


def _points(reel):
    return _sql(reel, "SELECT points_fidelite FROM clients WHERE id = %s", reel["cid"])[0]["points_fidelite"] or 0


def _gains(reel, tid):
    return _sql(reel, "SELECT count(*) AS n FROM fidelite_historique WHERE ticket_id = %s AND type = 'gain'", tid)[0]["n"]


def _code(r):
    return r.json()["detail"]["code"]


def test_restitution_toutes_les_branches(reel):
    c = reel["c"]
    t1 = _ticket(reel, reparation_supp=LIGNES_120, prix_supp=120, tarif_final=120, acompte=20)
    en_cours = _ticket(reel, statut="En cours de réparation", devis_estime=50)
    pret = _ticket(reel, reparation_supp=LIGNES_120, paye=1, telephone_pret="Prêt n°3", telephone_pret_rendu=False)

    r = c.post(f"/api/tickets/{en_cours}/restitution", json={"paiement": "encaisser"}, headers=H)
    assert r.status_code == 409 and _code(r) == "non_termine"
    r = c.post(f"/api/tickets/{pret}/restitution", json={"paiement": "deja_paye"}, headers=H)
    assert r.status_code == 409 and _code(r) == "pret_non_restitue"
    r = c.post(f"/api/tickets/{t1}/restitution", json={"paiement": "deja_paye"}, headers=H)
    assert r.status_code == 409 and _code(r) == "reste_a_payer" and r.json()["detail"]["reste"] == 100
    r = c.post(f"/api/tickets/{t1}/restitution", json={"paiement": "non_paye"}, headers=H)
    assert r.status_code == 409 and _code(r) == "motif_requis"
    r = c.post(f"/api/tickets/{t1}/restitution", json={"paiement": "encaisser", "montant": 120}, headers=H)
    assert r.status_code == 409 and _code(r) == "reste_a_payer"

    avant = _points(reel)
    r = c.post(f"/api/tickets/{t1}/restitution", json={"paiement": "encaisser", "montant": 100, "mode_paiement": "CB"}, headers=H)
    assert r.status_code == 200
    body = r.json()
    t = body["ticket"]
    assert body["deja_rendu"] is False and body["points_fidelite"] == 1200
    assert t["statut"] == "Clôturé" and t["paye"] == 1 and float(t["reste_a_payer"]) == 0
    assert t["rendu_par"] == "Sophie" and t["date_rendu"] and t["date_cloture"]
    assert "Encaissé 100,00 € (CB) — par Sophie" in t["historique"]
    assert _points(reel) == avant + 1200

    hist = _sql(reel, "SELECT count(*) AS n FROM historique WHERE ticket_id = %s", t1)[0]["n"]
    r2 = c.post(f"/api/tickets/{t1}/restitution", json={"paiement": "encaisser", "montant": 100}, headers=H)
    assert r2.status_code == 200 and r2.json()["deja_rendu"] is True and r2.json()["points_fidelite"] is None
    assert _gains(reel, t1) == 1 and _points(reel) == avant + 1200
    assert _sql(reel, "SELECT count(*) AS n FROM historique WHERE ticket_id = %s", t1)[0]["n"] == hist

    r = c.post(f"/api/tickets/{pret}/restitution", json={"paiement": "deja_paye", "pret_restitue": True}, headers=H)
    assert r.status_code == 200 and r.json()["ticket"]["telephone_pret_rendu"] is True


def test_rendu_non_paye_puis_encaissement(reel):
    c = reel["c"]
    tid = _ticket(reel, statut="En cours de réparation", panne="Batterie", devis_estime=50)
    r = c.post(f"/api/tickets/{tid}/restitution",
               json={"paiement": "non_paye", "motif_non_paye": "Reviendra payer", "confirmer_non_termine": True}, headers=H)
    t = r.json()["ticket"]
    assert t["statut"] == "Rendu au client" and t["paye"] == 0 and float(t["reste_a_payer"]) == 50
    assert _gains(reel, tid) == 0

    r = c.patch(f"/api/tickets/{tid}/statut", json={"statut": "Clôturé"}, headers=H)
    assert r.status_code == 409 and _code(r) == "utiliser_restitution" and r.json()["detail"]["reste"] == 50

    r = c.patch(f"/api/tickets/{tid}/paye", json={"paye": True}, headers=H)
    assert r.json()["paye"] is True and r.json()["statut"] == "Clôturé" and r.json()["points_fidelite"] == 500
    r = c.patch(f"/api/tickets/{tid}/paye", json={"paye": True}, headers=H)
    assert r.json()["paye"] is True and r.json()["points_fidelite"] is None and _gains(reel, tid) == 1


def test_statut_garde_fous_et_refus_de_devis(reel):
    c = reel["c"]
    impaye = _ticket(reel, reparation_supp=LIGNES_120)
    assert c.patch(f"/api/tickets/{impaye}/statut", json={"statut": "Rendu au client"}, headers=H).status_code == 409
    pret = _ticket(reel, paye=1, telephone_pret="Prêt n°1")
    assert c.patch(f"/api/tickets/{pret}/statut", json={"statut": "Clôturé"}, headers=H).status_code == 409

    paye = _ticket(reel, reparation_supp=LIGNES_120, paye=1)
    assert c.patch(f"/api/tickets/{paye}/statut", json={"statut": "Rendu au client"}, headers=H).status_code == 200
    row = _sql(reel, "SELECT date_rendu, rendu_par FROM tickets WHERE id = %s", paye)[0]
    assert row["date_rendu"] and row["rendu_par"] == "Sophie"

    accord = _ticket(reel, statut="En attente d'accord client", devis_estime=90)
    _sql(reel, "INSERT INTO commandes_pieces (ticket_id, description, statut) VALUES (%s, 'Écran OLED', 'En attente')", accord)
    assert c.patch(f"/api/tickets/{accord}/statut", json={"statut": "Réparation terminée"}, headers=H).status_code == 200
    assert _sql(reel, "SELECT issue FROM tickets WHERE id = %s", accord)[0]["issue"] == "refus_devis"
    assert _sql(reel, "SELECT statut FROM commandes_pieces WHERE ticket_id = %s", accord)[0]["statut"] == "En attente"


def test_devis_refuse_puis_restitution_deja_paye(reel):
    c = reel["c"]
    tid = _ticket(reel, statut="En attente d'accord client", reparation_supp=json.dumps([ECRAN_180]),
                  prix_supp=180, tarif_final=180, devis_estime=180)
    _sql(reel, "INSERT INTO commandes_pieces (ticket_id, description, statut) VALUES (%s, 'Écran OLED', 'En attente')", tid)
    assert c.patch(f"/api/tickets/{tid}/statut", json={"statut": "Réparation terminée"}, headers=H).status_code == 200
    assert c.get(f"/api/tickets/{tid}", headers=H).json()["montants"]["reste"] == 0

    r = c.post(f"/api/tickets/{tid}/restitution", json={"paiement": "deja_paye"}, headers=H)
    assert r.status_code == 200
    t = r.json()["ticket"]
    assert t["statut"] == "Clôturé" and t["paye"] == 1 and float(t["tarif_final"]) == 0
    assert r.json()["points_fidelite"] is None and _gains(reel, tid) == 0
    assert _sql(reel, "SELECT statut FROM commandes_pieces WHERE ticket_id = %s", tid)[0]["statut"] == "En attente"


def test_tarif_final_suit_le_montant_encaisse(reel):
    c = reel["c"]
    tarif = lambda tid: float(_sql(reel, "SELECT tarif_final FROM tickets WHERE id = %s", tid)[0]["tarif_final"])
    t1 = _ticket(reel, reparation_supp=LIGNES_120, prix_supp=120, tarif_final=100)
    r = c.post(f"/api/tickets/{t1}/restitution",
               json={"paiement": "encaisser", "montant": 120, "mode_paiement": "CB"}, headers=H)
    assert r.status_code == 200 and r.json()["points_fidelite"] == 1200 and tarif(t1) == 120

    t2 = _ticket(reel, reparation_supp=json.dumps([{"label": "Forfait remplacement batterie", "prix": 60}]), tarif_final=50)
    c.patch(f"/api/tickets/{t2}/paye", json={"paye": True}, headers=H)
    assert tarif(t2) == 60

    t3 = _ticket(reel, reparation_supp=LIGNES_120, tarif_final=0)
    c.patch(f"/api/tickets/{t3}", json={"paye": 1}, headers=H)
    assert tarif(t3) == 120


def test_solde_par_acompte(reel):
    c = reel["c"]
    tid = _ticket(reel, reparation_supp=LIGNES_120, acompte=120, statut_paiement="Acompte versé")
    r = c.patch(f"/api/tickets/{tid}/statut", json={"statut": "Clôturé"}, headers=H)
    assert r.status_code == 409 and _code(r) == "utiliser_restitution" and r.json()["detail"]["reste"] == 0

    r = c.post(f"/api/tickets/{tid}/restitution", json={"paiement": "non_paye"}, headers=H)
    assert r.status_code == 200
    t = r.json()["ticket"]
    assert t["statut"] == "Clôturé" and t["paye"] == 1 and t["statut_paiement"] == "Payé"
    assert r.json()["points_fidelite"] == 1200 and float(t["tarif_final"]) == 120
    assert "soldé par l'acompte de 120,00 €" in t["historique"]


def test_restitution_encaisser_sans_mode(reel):
    c = reel["c"]
    tid = _ticket(reel, reparation_supp=LIGNES_120)
    r = c.post(f"/api/tickets/{tid}/restitution", json={"paiement": "encaisser", "montant": 120}, headers=H)
    assert r.status_code == 422 and _code(r) == "mode_requis"
    assert _sql(reel, "SELECT statut, paye FROM tickets WHERE id = %s", tid)[0] == {"statut": "Réparation terminée", "paye": 0}


def test_depayer_un_cloture_le_rend_visible(reel):
    c = reel["c"]
    etat = lambda tid: _sql(reel, "SELECT statut, date_cloture, paye, reste_a_payer FROM tickets WHERE id = %s", tid)[0]
    tid = _ticket(reel, reparation_supp=LIGNES_120)
    c.post(f"/api/tickets/{tid}/restitution",
           json={"paiement": "encaisser", "montant": 120, "mode_paiement": "Espèces"}, headers=H)

    r = c.patch(f"/api/tickets/{tid}/paye", json={"paye": False}, headers=H)
    row = etat(tid)
    assert r.json()["statut"] == "Rendu au client"
    assert row["statut"] == "Rendu au client" and row["date_cloture"] is None and row["paye"] == 0
    assert float(row["reste_a_payer"]) == 120

    r = c.patch(f"/api/tickets/{tid}/paye", json={"paye": True}, headers=H)
    assert r.json()["statut"] == "Clôturé" and r.json()["points_fidelite"] is None and _gains(reel, tid) == 1
    assert etat(tid)["date_cloture"]

    c.patch(f"/api/tickets/{tid}", json={"paye": 0}, headers=H)
    row = etat(tid)
    assert row["statut"] == "Rendu au client" and row["date_cloture"] is None


def test_patch_pret_rendu_colonne_booleenne(reel):
    c = reel["c"]
    tid = _ticket(reel, telephone_pret="Prêt n°7")
    r = c.patch(f"/api/tickets/{tid}", json={"telephone_pret_rendu": 1}, headers=H)
    assert r.status_code == 200 and r.json()["ticket"]["telephone_pret_rendu"] is True
    r = c.patch(f"/api/tickets/{tid}", json={"telephone_pret_rendu": 0}, headers=H)
    assert r.status_code == 200 and r.json()["ticket"]["telephone_pret_rendu"] is False


def test_patch_partiel(reel):
    c = reel["c"]
    tid = _ticket(reel, statut="En attente de diagnostic", commande_piece=1)
    r = c.patch(f"/api/tickets/{tid}", json={"devis_estime": 99}, headers=H)
    assert r.status_code == 200 and r.json()["ok"] and r.json()["ticket"]["id"] == tid
    row = _sql(reel, "SELECT commande_piece, devis_estime FROM tickets WHERE id = %s", tid)[0]
    assert row["commande_piece"] == 1 and float(row["devis_estime"]) == 99
    assert c.patch("/api/tickets/987654321", json={"devis_estime": 1}, headers=H).status_code == 404

    paye = _ticket(reel, reparation_supp=LIGNES_120, paye=1, statut_paiement="Payé", reste_a_payer=0)
    c.patch(f"/api/tickets/{paye}", json={"statut_paiement": "Non payé", "reste_a_payer": 120}, headers=H)
    row = _sql(reel, "SELECT statut_paiement, reste_a_payer FROM tickets WHERE id = %s", paye)[0]
    assert row["statut_paiement"] == "Payé" and float(row["reste_a_payer"]) == 0


def test_paye_explicite_double_clic(reel):
    c = reel["c"]
    tid = _ticket(reel, reparation_supp=json.dumps([{"label": "Forfait remplacement batterie", "prix": 60}]),
                  prix_supp=60, tarif_final=60)
    r1 = c.patch(f"/api/tickets/{tid}/paye", json={"paye": True}, headers=H)
    r2 = c.patch(f"/api/tickets/{tid}/paye", json={"paye": True}, headers=H)
    assert r1.json()["paye"] is r2.json()["paye"] is True
    assert r1.json()["points_fidelite"] == 600 and r2.json()["points_fidelite"] is None and _gains(reel, tid) == 1

    c.patch(f"/api/tickets/{tid}/paye", json={"paye": False}, headers=H)
    row = _sql(reel, "SELECT paye, reste_a_payer FROM tickets WHERE id = %s", tid)[0]
    assert row["paye"] == 0 and float(row["reste_a_payer"]) == 60      # et non 120
    assert c.patch(f"/api/tickets/{tid}/paye", json={}, headers=H).json()["paye"] is True   # bascule
    assert _gains(reel, tid) == 1


def test_caisse_un_seul_envoi(reel, monkeypatch):
    from app.api import caisse_api
    c = reel["c"]
    tid = _ticket(reel, reparation_supp=LIGNES_120)
    _sql(reel, "INSERT INTO params (cle, valeur) VALUES ('CAISSE_SHOPID', 'SHOP-TEST'), ('CAISSE_APIKEY', 'CLE-TEST-FICTIVE')"
               " ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur")
    envois = []
    try:
        monkeypatch.setattr(caisse_api, "poster_vente", lambda cfg, m, lib, *a, **k: (envois.append((m, lib)) or (False, "KO test", None)))
        r = c.post("/api/caisse/envoyer", json={"ticket_id": tid, "montant": 1}, headers=H)
        assert r.json()["result"] == "KO"
        assert not _sql(reel, "SELECT 1 FROM notes_tickets WHERE ticket_id = %s AND type_note = 'caisse'", tid)

        monkeypatch.setattr(caisse_api, "poster_vente", lambda cfg, m, lib, *a, **k: (envois.append((m, lib)) or (True, "Vente créée", "42")))
        r = c.post("/api/caisse/envoyer", json={"ticket_id": tid, "montant": 1}, headers=H)
        assert r.json()["result"] == "OK" and r.json()["montant"] == 120          # montant serveur, pas celui du navigateur
        assert envois[-1] == (120, "Forfait remplacement écran - Marque Test")
        note = _sql(reel, "SELECT auteur, contenu FROM notes_tickets WHERE ticket_id = %s AND type_note = 'caisse'", tid)
        assert len(note) == 1 and note[0]["auteur"] == "Sophie" and "#42" in note[0]["contenu"]

        r = c.post("/api/caisse/envoyer", json={"ticket_id": tid}, headers=H)
        assert r.status_code == 409 and _code(r) == "deja_envoye"
        r = c.post("/api/caisse/envoyer", json={"ticket_id": tid, "force": True}, headers=H)
        assert r.json()["result"] == "OK" and len(envois) == 3
    finally:
        _sql(reel, "DELETE FROM params WHERE cle IN ('CAISSE_SHOPID', 'CAISSE_APIKEY')")


def test_caisse_deja_envoye_heure_de_paris(reel):
    c = reel["c"]
    tid = _ticket(reel, reparation_supp=LIGNES_120)
    # date_creation : TIMESTAMP naïf en UTC (22:31 UTC = 00:31 à Paris, heure d'été)
    _sql(reel, "INSERT INTO notes_tickets (ticket_id, auteur, contenu, type_note, date_creation)"
               " VALUES (%s, 'Sophie', 'Vente envoyée en caisse', 'caisse', '2026-10-15 22:31:00')", tid)
    _sql(reel, "INSERT INTO params (cle, valeur) VALUES ('CAISSE_SHOPID', 'SHOP-TEST'), ('CAISSE_APIKEY', 'CLE-TEST-FICTIVE')"
               " ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur")
    try:
        r = c.post("/api/caisse/envoyer", json={"ticket_id": tid}, headers=H)
        assert r.status_code == 409 and _code(r) == "deja_envoye"
        assert "le 16/10 à 00:31" in r.json()["detail"]["message"]
        assert r.json()["detail"]["date"] == "2026-10-16T00:31:00+02:00"
    finally:
        _sql(reel, "DELETE FROM params WHERE cle IN ('CAISSE_SHOPID', 'CAISSE_APIKEY')")


def test_apprentissage_autocompletion(reel):
    c = reel["c"]
    _sql(reel, "DELETE FROM autocompletion WHERE categorie = 'panne' AND terme IN ('Lecteur SIM HS', 'Batt')")
    assert c.post("/api/autocomplete/learn", json={"categorie": "panne", "terme": "Batt"}, headers=H).json()["success"] is False
    for _ in range(2):
        c.post("/api/autocomplete/learn", json={"categorie": "panne", "terme": "Lecteur SIM HS"}, headers=H)
    assert _sql(reel, "SELECT compteur FROM autocompletion WHERE categorie = 'panne' AND terme = 'Lecteur SIM HS'")[0]["compteur"] == 1


def test_depot_distance(reel):
    c = reel["c"]
    r = c.post("/api/depot-distance", json={"nom": "Fictif", "telephone": TEL, "panne": "Camera avant", "marque": "M"})
    assert r.status_code == 200
    row = _sql(reel, "SELECT panne, statut, suivi_token FROM tickets WHERE id = %s", r.json()["id"])[0]
    assert row["panne"] == "Caméra avant" and row["statut"] == "Pré-enregistré" and row["suivi_token"]
    assert c.post("/api/depot-distance", json={"nom": "x" * 101, "telephone": TEL}).status_code == 422


def test_migrations_fiche_idempotentes(reel):
    from app import main
    tel_mig = "0600000666"
    _sql(reel, "DELETE FROM tickets WHERE client_id IN (SELECT id FROM clients WHERE telephone = %s)", tel_mig)
    _sql(reel, "DELETE FROM clients WHERE telephone = %s", tel_mig)
    cid = _sql(reel, "INSERT INTO clients (nom, telephone) VALUES ('Migration', %s) RETURNING id", tel_mig)[0]["id"]

    def t(statut, panne, lignes, **kw):
        return _sql(reel, "INSERT INTO tickets (client_id, statut, panne, panne_detail, reparation_supp, paye)"
                          " VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                    cid, statut, panne, kw.get("detail", ""), json.dumps(lignes), kw.get("paye", 0))[0]["id"]

    en_cours = t("En cours de réparation", "Écran casse", [{"label": "Batterie", "prix": 59}, {"label": "Coque", "prix": 5}])
    autre = t("En attente de diagnostic", "Autre", [{"label": "Autre", "prix": 30}], detail="Lecteur SIM\ncassé")
    cloture = t("Clôturé", "Camera arriere", [{"label": "Batterie", "prix": 59}])
    paye = t("En cours de réparation", "Batterie", [{"label": "Batterie", "prix": 59}], paye=1)
    commande = t("En attente de pièce", "Batterie", [{"label": "Batterie", "prix": 59}])
    _sql(reel, "INSERT INTO commandes_pieces (ticket_id, description, statut) VALUES (%s, 'Batterie', 'Commandée')", commande)
    _sql(reel, "INSERT INTO autocompletion (categorie, terme, compteur) VALUES ('panne', 'Écran casse', 7)"
               " ON CONFLICT (categorie, terme) DO UPDATE SET compteur = 7")
    neuf = _sql(reel, "SELECT compteur FROM autocompletion WHERE categorie = 'panne' AND terme = 'Écran cassé'")[0]["compteur"]
    _sql(reel, "DELETE FROM params WHERE cle = %s", main.MIGRATION_FORFAITS_LIGNES)

    main._migrations_fiche()
    labels = lambda tid: [l["label"] for l in json.loads(_sql(reel, "SELECT reparation_supp FROM tickets WHERE id = %s", tid)[0]["reparation_supp"])]
    assert labels(en_cours) == ["Forfait remplacement batterie", "Coque"]
    assert labels(autre) == ["Réparation - Lecteur SIM cassé"]
    assert labels(cloture) == labels(paye) == labels(commande) == ["Batterie"]
    assert _sql(reel, "SELECT panne FROM tickets WHERE id = %s", en_cours)[0]["panne"] == "Écran cassé"
    assert _sql(reel, "SELECT panne FROM tickets WHERE id = %s", cloture)[0]["panne"] == "Caméra arrière"
    assert not _sql(reel, "SELECT 1 FROM autocompletion WHERE categorie = 'panne' AND terme = 'Écran casse'")
    assert _sql(reel, "SELECT compteur FROM autocompletion WHERE categorie = 'panne' AND terme = 'Écran cassé'")[0]["compteur"] == neuf + 7

    # Rejouée (drapeau posé) : aucune nouvelle réécriture, même si un libellé redevient « Batterie »
    _sql(reel, "UPDATE tickets SET reparation_supp = %s WHERE id = %s", json.dumps([{"label": "Batterie", "prix": 59}]), en_cours)
    main._migrations_fiche()
    assert labels(en_cours) == ["Batterie"]
