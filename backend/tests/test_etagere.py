"""Gains rapides : étagère « À récupérer », message proposé après un changement de statut,
téléphone de prêt saisi sur la fiche (IMEI Luhn) qui arme le garde-fou de la restitution.

Les tests purs et sur base simulée tournent toujours. Ceux sur base réelle exigent la
même base PostgreSQL JETABLE que tests/test_fiche.py (KP_FICHE_DATABASE_URL).
"""

import json
import re
from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from app.api.tickets import _proposer_message
from app.models import TicketUpdate
from app.services import etagere
from app.services import params as params_cache
from tests.test_fiche import H, LIGNES_120, _sql, _ticket, reel  # noqa: F401 (fixture)

IMEI_OK = "490154203237518"
PLACEHOLDER = re.compile(r"%\((\w+)\)s")


def _cursor(fetchone=None, fetchall=None):
    cur = MagicMock()
    cur.fetchone.return_value = fetchone
    cur.fetchall.return_value = fetchall or []

    @contextmanager
    def cm():
        yield cur
    return cur, cm


def _assert_sql_safe(sql, params):
    """Placeholders tous fournis, aucun % nu (psycopg2) : le motif LIKE passe en paramètre."""
    assert set(PLACEHOLDER.findall(sql)) <= set(params)
    assert "%" not in PLACEHOLDER.sub("", sql).replace("%%", "")


# ─── Étagère : règles pures ────────────────────────────────────

def test_jours_comptes_en_jours_de_chambery():
    if etagere._PARIS is None:
        pytest.skip("base des fuseaux horaires absente")
    maintenant = datetime(2026, 10, 16, 10, 0, tzinfo=timezone.utc)
    # 15/10 22:30 UTC = 16/10 00:30 à Chambéry : même jour que maintenant
    assert etagere.jours_depuis(datetime(2026, 10, 15, 22, 30), maintenant) == 0
    assert etagere.jours_depuis(datetime(2026, 10, 15, 21, 30), maintenant) == 1
    assert etagere.jours_depuis("2026-10-06T09:00:00", maintenant) == 10
    assert etagere.jours_depuis(datetime(2026, 10, 20), maintenant) == 0     # horloges décalées : jamais négatif
    assert etagere.jours_depuis(None, maintenant) is None
    assert etagere.jours_depuis("pas une date", maintenant) is None


def test_enrichir_reste_du_par_services_montants():
    rows = etagere.enrichir([
        {"id": 1, "statut": "Rendu au client", "reparation_supp": LIGNES_120, "acompte": 20,
         "fin_reparation": datetime(2026, 10, 1, 12)},
        {"id": 2, "statut": "Réparation terminée", "issue": "refus_devis", "devis_estime": 180,
         "fin_reparation": None},
    ], datetime(2026, 10, 16, 12, tzinfo=timezone.utc))
    assert [(r["reste_du"], r["jours_attente"]) for r in rows] == [(100, 15), (0, None)]


def test_condition_a_recuperer():
    sql = etagere.a_recuperer_sql("t")
    assert "t.statut = 'Réparation terminée'" in sql
    assert "t.statut = 'Rendu au client'" in sql and "COALESCE(t.paye, 0) = 0" in sql
    assert "%" not in sql


# ─── Étagère : endpoint (base simulée) ─────────────────────────

def test_dashboard_vue_a_recuperer(client, auth_headers):
    rows = [{"id": 7, "ticket_code": "KP-000007", "statut": "Réparation terminée",
             "reparation_supp": LIGNES_120, "fin_reparation": datetime(2026, 9, 1, 12)}]
    cur, cm = _cursor(fetchone={"a_recuperer": 3, "reparation_terminee": 2}, fetchall=rows)
    with patch("app.api.tickets.get_cursor", cm):
        r = client.get("/api/tickets/stats/dashboard", headers=auth_headers,
                       params={"vue": "a_recuperer", "limit": 50})
    assert r.status_code == 200
    body = r.json()
    assert body["delai_abandon_jours"] == 365 and body["kpi"]["a_recuperer"] == 3
    t = body["tickets"][0]
    assert t["reste_du"] == 120 and t["jours_attente"] >= 45 and t["fin_reparation"].startswith("2026-09-01")

    kpi_sql = cur.execute.call_args_list[0].args[0]
    assert "as a_recuperer" in kpi_sql
    list_sql, list_params = cur.execute.call_args_list[1].args
    _assert_sql_safe(list_sql, list_params)
    assert "AS fin_reparation" in list_sql and "ORDER BY (t.statut = 'Rendu au client'), fin_reparation" in list_sql
    assert "%→ Réparation terminée%" in list_params.values()


def test_autres_vues_sans_colonnes_d_etagere(client, auth_headers):
    cur, cm = _cursor(fetchone=None, fetchall=[{"id": 1, "ticket_code": "KP-000001"}])
    with patch("app.api.tickets.get_cursor", cm):
        body = client.get("/api/tickets/stats/dashboard", headers=auth_headers, params={"vue": "actifs"}).json()
    assert set(body) == {"kpi", "tickets", "total"} and body["kpi"]["a_recuperer"] == 0
    assert "fin_reparation" not in cur.execute.call_args_list[1].args[0]
    assert "jours_attente" not in body["tickets"][0]


def test_kpi_seul_compte_aussi_l_etagere(client, auth_headers):
    cur, cm = _cursor(fetchone={"a_recuperer": 4, "pre_enregistres": 1})
    with patch("app.api.tickets.get_cursor", cm):
        body = client.get("/api/tickets/stats/kpi", headers=auth_headers).json()
    assert body["a_recuperer"] == 4 and body["pre_enregistres"] == 1


# ─── Message proposé : NOTIFICATIONS_STATUTS ───────────────────

def _cur_params(valeur):
    cur = MagicMock()
    cur.fetchall.return_value = [] if valeur is None else [{"cle": "NOTIFICATIONS_STATUTS", "valeur": valeur}]
    return cur


@pytest.mark.parametrize("valeur, statut, attendu", [
    ("Réparation terminée,En attente de pièce,En cours de réparation", "En cours de réparation", True),
    ("Réparation terminée, En attente de pièce", "En attente de pièce", True),
    ("Réparation terminée, En attente de pièce", "Pièce reçue", False),
    (None, "Réparation terminée", True),            # paramètre absent : « prêt » seulement
    (None, "En attente de pièce", False),
    ("", "Réparation terminée", False),             # liste vidée : jamais
])
def test_proposer_message_selon_le_parametre(valeur, statut, attendu):
    assert _proposer_message(_cur_params(valeur), statut, refus_devis=False) is attendu


def test_jamais_d_annonce_pret_apres_un_refus_de_devis():
    assert _proposer_message(_cur_params("Réparation terminée"), "Réparation terminée", refus_devis=True) is False


# ─── Téléphone de prêt : IMEI ──────────────────────────────────

@pytest.mark.parametrize("saisie, stocke", [
    (IMEI_OK, IMEI_OK), ("49 015420 323751 8", IMEI_OK), ("49-015420-323751-8", IMEI_OK),
    ("", ""), ("   ", ""), (None, None),
])
def test_imei_pret_accepte(saisie, stocke):
    assert TicketUpdate(telephone_pret_imei=saisie).telephone_pret_imei == stocke


@pytest.mark.parametrize("saisie", ["490154203237519", "49015420323751", "4901542032375180", "000000000000000", "abc"])
def test_imei_pret_refuse(saisie):
    with pytest.raises(ValidationError, match="IMEI du téléphone de prêt invalide"):
        TicketUpdate(telephone_pret_imei=saisie)


def test_imei_de_l_appareil_reste_libre():
    # Champ « IMEI / N° série » de l'appareil : numéros de série acceptés tels quels
    assert TicketUpdate(imei="F2LXK0ABCD").imei == "F2LXK0ABCD"


def test_patch_imei_pret_invalide_refuse(client, auth_headers):
    r = client.patch("/api/tickets/1", json={"telephone_pret_imei": "490154203237519"}, headers=auth_headers)
    assert r.status_code == 422


# ═══ Base réelle ═══════════════════════════════════════════════

def _statut(c, tid, statut):
    r = c.patch(f"/api/tickets/{tid}/statut", json={"statut": statut}, headers=H)
    assert r.status_code == 200, r.text
    return r.json()


def _histo_termine(reel, tid, quand):
    _sql(reel, "INSERT INTO historique (ticket_id, type, contenu, date_creation) VALUES (%s, 'statut', %s, %s)",
         tid, "Statut: En cours de réparation → Réparation terminée — par Sophie", quand)


def _jours_chambery(reel, fin_iso):
    """Oracle indépendant : jours calendaires de Chambéry calculés par PostgreSQL."""
    return _sql(reel, "SELECT ((NOW() AT TIME ZONE 'Europe/Paris')::date"
                      " - ((%s::timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris')::date) AS j",
                fin_iso)[0]["j"]


def test_etagere_sur_base_reelle(reel):
    c = reel["c"]
    tech = "Etagere-Pytest"
    _sql(reel, "DELETE FROM tickets WHERE technicien_assigne = %s", tech)
    tk = lambda **kw: _ticket(reel, technicien_assigne=tech, **kw)

    recent = tk(statut="En cours de réparation", reparation_supp=LIGNES_120, prix_supp=120, tarif_final=120)
    _statut(c, recent, "Réparation terminée")
    ancien = tk(reparation_supp=LIGNES_120, prix_supp=120)
    _histo_termine(reel, ancien, "2026-09-20 10:00:00")
    sans_historique = tk(devis_estime=60)
    _sql(reel, "UPDATE tickets SET reparation_fin = '2026-08-01 10:00:00' WHERE id = %s", sans_historique)
    rendu_du = tk(statut="Rendu au client", reparation_supp=LIGNES_120, prix_supp=120, tarif_final=120, acompte=20)
    _histo_termine(reel, rendu_du, "2026-10-01 10:00:00")
    tk(statut="Rendu au client")                                 # réparation gratuite : rien à réclamer
    tk(statut="Rendu au client", paye=1, tarif_final=50)          # payé
    tk(statut="Clôturé", tarif_final=50)
    tk(statut="En cours de réparation", devis_estime=80)

    body = c.get("/api/tickets/stats/dashboard", params={"vue": "a_recuperer", "tech": tech}, headers=H).json()
    par_id = {t["id"]: t for t in body["tickets"]}
    # Terminés d'abord, du plus ancien au plus récent ; puis les rendus non payés
    assert [t["id"] for t in body["tickets"]] == [sans_historique, ancien, recent, rendu_du]
    assert body["total"] == 4 and body["delai_abandon_jours"] == 365
    assert par_id[sans_historique]["fin_reparation"].startswith("2026-08-01T10:00")
    assert par_id[ancien]["fin_reparation"].startswith("2026-09-20T10:00")
    assert par_id[rendu_du]["fin_reparation"].startswith("2026-10-01T10:00")
    for t in body["tickets"]:
        assert t["jours_attente"] == _jours_chambery(reel, t["fin_reparation"])
    assert par_id[recent]["jours_attente"] == 0
    assert par_id[rendu_du]["reste_du"] == 100 and par_id[ancien]["reste_du"] == 120

    # Le compteur du dashboard suit la même règle (toute la base) : carte = liste
    tout = c.get("/api/tickets/stats/dashboard", params={"vue": "a_recuperer", "limit": 1}, headers=H).json()
    assert tout["kpi"]["a_recuperer"] == tout["total"] >= 4
    assert c.get("/api/tickets/stats/kpi", headers=H).json()["a_recuperer"] == tout["total"]
    actifs = c.get("/api/tickets/stats/dashboard", params={"vue": "actifs", "tech": tech}, headers=H).json()
    assert "delai_abandon_jours" not in actifs and "fin_reparation" not in actifs["tickets"][0]


def test_message_propose_selon_notifications_statuts(reel):
    c = reel["c"]
    ecrire = lambda v: (_sql(reel, "INSERT INTO params (cle, valeur) VALUES ('NOTIFICATIONS_STATUTS', %s)"
                                   " ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur", v),
                        params_cache.invalidate())
    avant = _sql(reel, "SELECT valeur FROM params WHERE cle = 'NOTIFICATIONS_STATUTS'")
    try:
        ecrire("Réparation terminée,En attente de pièce")
        tid = _ticket(reel, statut="En attente de diagnostic")
        assert _statut(c, tid, "En attente de pièce")["proposer_message"] is True
        assert _statut(c, tid, "Pièce reçue")["proposer_message"] is False
        assert _statut(c, tid, "En cours de réparation")["proposer_message"] is False
        assert _statut(c, tid, "Réparation terminée")["proposer_message"] is True
        assert _statut(c, tid, "Réparation terminée")["proposer_message"] is False   # déjà terminé : rien

        refus = _ticket(reel, statut="En attente d'accord client", devis_estime=90)
        assert _statut(c, refus, "Réparation terminée")["proposer_message"] is False

        ecrire("")
        vide = _ticket(reel, statut="En cours de réparation")
        assert _statut(c, vide, "Réparation terminée")["proposer_message"] is False
    finally:
        if avant:
            ecrire(avant[0]["valeur"])
        else:
            _sql(reel, "DELETE FROM params WHERE cle = 'NOTIFICATIONS_STATUTS'")
            params_cache.invalidate()


def test_pret_saisi_sur_la_fiche_arme_la_restitution(reel):
    c = reel["c"]
    patch_ = lambda tid, data: c.patch(f"/api/tickets/{tid}", json=data, headers=H)
    tid = _ticket(reel, reparation_supp=json.dumps([{"label": "Écran", "prix": 80}]), prix_supp=80, paye=1)
    # Reste d'un ancien prêt rendu puis effacé : le prêt confié repart « dehors »
    _sql(reel, "UPDATE tickets SET telephone_pret_rendu = TRUE WHERE id = %s", tid)

    t = patch_(tid, {"telephone_pret": "Galaxy S9 de prêt", "telephone_pret_imei": "49 015420 323751 8"}).json()["ticket"]
    assert t["telephone_pret_imei"] == IMEI_OK and t["telephone_pret_rendu"] is False
    assert patch_(tid, {"telephone_pret_imei": "490154203237519"}).status_code == 422
    # Correction du modèle d'un prêt récupéré : il n'est pas « ressorti »
    assert patch_(tid, {"telephone_pret_rendu": 1}).json()["ticket"]["telephone_pret_rendu"] is True
    assert patch_(tid, {"telephone_pret": "Galaxy S9+ de prêt"}).json()["ticket"]["telephone_pret_rendu"] is True
    assert patch_(tid, {"telephone_pret_rendu": 0}).json()["ticket"]["telephone_pret_rendu"] is False

    r = c.post(f"/api/tickets/{tid}/restitution", json={"paiement": "deja_paye"}, headers=H)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "pret_non_restitue"
    assert c.patch(f"/api/tickets/{tid}/statut", json={"statut": "Clôturé"}, headers=H).status_code == 409
    r = c.post(f"/api/tickets/{tid}/restitution", json={"paiement": "deja_paye", "pret_restitue": True}, headers=H)
    assert r.status_code == 200
    t = r.json()["ticket"]
    assert t["statut"] == "Clôturé" and t["telephone_pret_rendu"] is True
    assert "Téléphone de prêt restitué" in t["historique"]
