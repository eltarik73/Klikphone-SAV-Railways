"""Routes publiques annexes : commande de pièce automatique (borne), jeu de grattage,
fidélité et commandes par code ticket, dépôt à distance, réception d'une pièce parmi
plusieurs, heure de Paris dans les journaux texte, téléphone « +41 (0)79 … » et noms à
apostrophe dans la recherche.

Partie « base réelle » (PostgreSQL JETABLE, données fictives, migrations du lifespan rejouées) :
    KP_LOT2_DATABASE_URL="postgresql://postgres:<mdp>@127.0.0.1:55432/kp_lot2?sslmode=disable" \\
        pytest tests/test_lot2_routes_publiques.py
Sans la variable, ces tests sont ignorés (skip). Aucun SMS ni e-mail ne part (envois simulés).
"""

import os
import sys
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.api import auth as auth_api
from app.api import depot_distance as depot_api
from app.api import etagere as etagere_api
from app.api import fidelite as fidelite_api
from app.api import parts as parts_api
from app.api import suivi as suivi_api
from app.api import tickets as tickets_api
from app.api.auth import create_token
from app.services import params as params_cache
from app.services import search as S
from app.services import sms

try:
    from zoneinfo import ZoneInfo
    PARIS = ZoneInfo("Europe/Paris")
except Exception:  # pragma: no cover
    PARIS = None

H = {"Authorization": f"Bearer {create_token('accueil', 'Sophie')}"}


@pytest.fixture
def heure_utc():
    """Processus en UTC (comme le conteneur Railway) le temps du test."""
    ancien = os.environ.get("TZ")
    os.environ["TZ"] = "UTC"
    time.tzset()
    try:
        yield
    finally:
        if ancien is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = ancien
        time.tzset()


def _heures_paris_possibles():
    """« JJ/MM HH:MM » de Paris, minute courante et suivante (test à cheval sur une minute)."""
    if PARIS is None:
        pytest.skip("base tz absente")
    n = datetime.now(PARIS)
    return {n.strftime("%d/%m %H:%M"), datetime.fromtimestamp(n.timestamp() + 60, PARIS).strftime("%d/%m %H:%M")}


def _heure_utc():
    return datetime.now(timezone.utc).strftime("%d/%m %H:%M")


# ═══ Sans base ════════════════════════════════════════════════════════

@pytest.mark.parametrize("saisie", ["+41 (0)79 123 45 67", "0041 (0)79 123 45 67", "+41 ( 0 ) 79 123 45 67",
                                    "+41 79 123 45 67", "0041791234567"])
def test_numero_suisse_avec_zero_national(saisie):
    assert S.phone_canonical(saisie) == "+41791234567"
    assert S.same_phone(saisie, "+41 79 123 45 67")
    assert sms.numero_international(saisie) == "41791234567"


def test_zero_national_francais_inchange():
    assert S.phone_canonical("+33 (0)6 12 34 56 78") == "0612345678"
    assert S.phone_canonical("0033 (0)6 12 34 56 78") == "0612345678"
    # Sans indicatif, une parenthèse reste un simple séparateur
    assert S.phone_canonical("(04) 79 12 34 56") == "0479123456"
    assert sms.numero_international("+33 (0)6 12 34 56 78") == "33612345678"


def test_recherche_compare_aussi_le_nom_compact():
    """« dartagnan » / « oneil » : la forme compacte du nom et du prénom est comparée."""
    pq = S.parse_query("dartagnan")
    P = S.SqlParams()
    sql = S.client_where_sql(pq, P)
    assert "replace(public.kp_doc(coalesce(c.nom, '') || ' ' || coalesce(c.prenom, '')), ' ', '')" in sql
    assert "%dartagnan%" in [v for vals in P.values.values() if isinstance(vals, list) for v in vals]
    P = S.SqlParams()
    sql = S.ticket_where_sql(S.parse_query("oneil"), P)
    assert "replace(public.kp_doc(coalesce(y.nom, '') || ' ' || coalesce(y.prenom, '')), ' ', '')" in sql
    # Libellé de correspondance
    assert S.ticket_match_label(S.parse_query("dartagnan"), {"client_nom": "D'Artagnan"}) == "nom"
    assert S.ticket_match_label(S.parse_query("oneil"), {"client_prenom": "O’Neil"}) == "prénom"


def test_etagere_journal_a_l_heure_de_paris(heure_utc):
    cur = MagicMock()
    etagere_api._historiser(cur, 5, "", "Emplacement : B3", "Sophie")
    ligne = cur.execute.call_args_list[-1].args[1][0]
    possibles = _heures_paris_possibles()
    assert ligne[1:12] in possibles, (ligne, possibles)
    assert _heure_utc() not in possibles  # le test a un sens : UTC ≠ Paris


def test_borne_auto_valide_le_corps(client):
    """Corps typé : prix négatif ou description trop longue refusés avant toute écriture."""
    with patch("app.api.parts.get_cursor") as gc:
        assert client.post("/api/parts/auto", json={"ticket_id": 1, "description": "x", "prix": -999}).status_code == 422
        assert client.post("/api/parts/auto", json={"ticket_id": 1, "description": "x" * 201}).status_code == 422
        assert client.post("/api/parts/auto", json={"ticket_id": 1, "prix": 10001}).status_code == 422
        assert client.post("/api/parts/auto", json={"description": "x"}).status_code == 422
    gc.assert_not_called()


# ═══ Base réelle ══════════════════════════════════════════════════════

DB_URL = os.getenv("KP_LOT2_DATABASE_URL")
TEL = "0600000772"
TEL_TIERS = "0600000773"
TECH = "Lot2-Pytest"
JETON = "JetonLot2_0123456789abcdef"   # préfixe du suivi_token des tickets insérés (unique par ticket, cf. _jeton)


def _jeton(tid):
    """suivi_token du ticket inséré par _ticket : preuve de la borne pour /auto (index unique)."""
    return f"{JETON[:10]}{tid:016d}"


@pytest.fixture(scope="module")
def reel():
    if not DB_URL:
        pytest.skip("KP_LOT2_DATABASE_URL non définie (base PostgreSQL de test jetable)")
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
    # Aucun envoi réel : e-mails et Discord simulés
    envois = []
    mp.setattr(depot_api, "_envoyer_email_confirmation", lambda *a: envois.append(a))
    mp.setattr(depot_api, "envoyer_discord_embed", lambda *a, **k: None)
    from app.main import app as fastapi_app
    try:
        with TestClient(fastapi_app) as c:   # lifespan : schéma + migrations
            yield {"c": c, "cur": vrai_cursor, "envois": envois}
    finally:
        mp.undo()
        pool.closeall()
        params_cache.invalidate()


def _sql(reel, sql, *params):
    with reel["cur"]() as cur:
        cur.execute(sql, params)
        return cur.fetchall() if cur.description else None


def _effacer(reel):
    for tel in (TEL, TEL_TIERS):
        ids = "SELECT id FROM tickets WHERE client_id IN (SELECT id FROM clients WHERE telephone = %s)"
        _sql(reel, f"DELETE FROM commandes_pieces WHERE ticket_id IN ({ids})", tel)
        _sql(reel, f"DELETE FROM fidelite_historique WHERE client_id IN (SELECT id FROM clients WHERE telephone = %s)", tel)
        _sql(reel, f"DELETE FROM historique WHERE ticket_id IN ({ids})", tel)
        _sql(reel, f"DELETE FROM notes_tickets WHERE ticket_id IN ({ids})", tel)
        _sql(reel, "DELETE FROM tickets WHERE client_id IN (SELECT id FROM clients WHERE telephone = %s)", tel)
        _sql(reel, "DELETE FROM clients WHERE telephone = %s", tel)


@pytest.fixture
def propre(reel):
    _effacer(reel)
    reel["envois"].clear()
    tickets_api._RATE_BUCKETS.clear()
    suivi_api._LIMITEUR._buckets.clear()
    parts_api._LIMITEUR_AUTO._buckets.clear()
    depot_api._LIMITEUR_DEPOT._buckets.clear()
    auth_api.reset_essais()
    cid = _sql(reel, "INSERT INTO clients (nom, prenom, telephone, email) VALUES ('Fictif', 'Lot2', %s, 'connu@exemple.test')"
                     " RETURNING id", TEL)[0]["id"]
    yield cid
    _effacer(reel)
    tickets_api._RATE_BUCKETS.clear()
    suivi_api._LIMITEUR._buckets.clear()
    auth_api.reset_essais()


def _ticket(reel, cid, statut="En attente de diagnostic", depot_il_y_a="0 minutes", **kw):
    t = {"client_id": cid, "categorie": "Smartphone", "marque": "Marque", "modele": "Lot2",
         "panne": "Batterie", "statut": statut, "technicien_assigne": TECH, "paye": 0}
    t.update(kw)
    cols = list(t)
    tid = _sql(reel, "INSERT INTO tickets ({}, date_depot) VALUES ({}, LOCALTIMESTAMP - %s::interval) RETURNING id".format(
        ", ".join(cols), ", ".join(["%s"] * len(cols))), *([t[k] for k in cols] + [depot_il_y_a]))[0]["id"]
    # suivi_token unique par ticket (index unique idx_tickets_suivi_token), sauf s'il est fourni :
    # la preuve de la borne pour /auto
    _sql(reel, "UPDATE tickets SET ticket_code = %s, suivi_token = %s WHERE id = %s",
         f"KP-{tid:06d}", t.get("suivi_token") or _jeton(tid), tid)
    return tid


def _statut(reel, tid):
    return _sql(reel, "SELECT statut FROM tickets WHERE id = %s", tid)[0]["statut"]


def _commandes(reel, tid):
    return _sql(reel, "SELECT id, statut, prix FROM commandes_pieces WHERE ticket_id = %s ORDER BY id", tid)


# ─── POST /api/parts/auto ─────────────────────────────────────────────

def test_auto_sans_session_refuse_un_ticket_cloture(reel, propre):
    c = reel["c"]
    tid = _ticket(reel, propre, statut="Clôturé", depot_il_y_a="3 days")
    r = c.post("/api/parts/auto", json={"ticket_id": tid, "description": "x", "prix": 5, "t": _jeton(tid)})
    assert r.status_code == 409, r.text
    assert _statut(reel, tid) == "Clôturé"
    assert _commandes(reel, tid) == []
    # Ticket inexistant : même 403 qu'un ticket sans preuve (audit D), jamais 404 sans session
    r = c.post("/api/parts/auto", json={"ticket_id": 999999999, "description": "x"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "preuve_requise"


def test_auto_sans_session_seulement_le_ticket_neuf_et_une_fois(reel, propre):
    c = reel["c"]
    vieux = _ticket(reel, propre, depot_il_y_a="1 hour")
    assert c.post("/api/parts/auto", json={"ticket_id": vieux, "description": "x", "t": _jeton(vieux)}).status_code == 409
    assert _statut(reel, vieux) == "En attente de diagnostic"

    neuf = _ticket(reel, propre)
    # Sans preuve : refusé avant toute écriture (audit D) ; mauvais jeton : lien_invalide
    r = c.post("/api/parts/auto", json={"ticket_id": neuf, "description": "Écran"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "preuve_requise"
    r = c.post("/api/parts/auto", json={"ticket_id": neuf, "description": "Écran", "t": "MauvaisJeton_0123456789"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "lien_invalide"
    assert _commandes(reel, neuf) == [] and _statut(reel, neuf) == "En attente de diagnostic"
    r = c.post("/api/parts/auto", json={"ticket_id": neuf, "description": "Écran", "fournisseur": "LCD", "prix": 48.5, "t": _jeton(neuf)})
    assert r.status_code == 200, r.text
    assert _statut(reel, neuf) == "En attente de pièce"
    assert [float(x["prix"]) for x in _commandes(reel, neuf)] == [48.5]
    # Rejoué : la commande existe déjà
    assert c.post("/api/parts/auto", json={"ticket_id": neuf, "description": "Autre", "t": _jeton(neuf)}).status_code == 409
    assert len(_commandes(reel, neuf)) == 1
    # Le numéro complet du client vaut aussi comme preuve (en-tête X-Suivi-Tel)
    autre = _ticket(reel, propre)
    r = c.post("/api/parts/auto", json={"ticket_id": autre, "description": "Nappe"}, headers={"X-Suivi-Tel": "06 00 00 07 72"})
    assert r.status_code == 200, r.text


def test_auto_avec_session_ne_fait_jamais_reculer_un_ticket_termine(reel, propre):
    c = reel["c"]
    for statut in ("Réparation terminée", "Rendu au client", "Clôturé"):
        tid = _ticket(reel, propre, statut=statut, depot_il_y_a="3 days")
        r = c.post("/api/parts/auto", headers=H, json={"ticket_id": tid, "description": "Batterie"})
        assert r.status_code == 200, r.text
        assert _statut(reel, tid) == statut
        assert len(_commandes(reel, tid)) == 1
    tid = _ticket(reel, propre, statut="Pièce reçue", depot_il_y_a="3 days")
    assert c.post("/api/parts/auto", headers=H, json={"ticket_id": tid, "description": "Nappe"}).status_code == 200
    assert _statut(reel, tid) == "En attente de pièce"
    lignes = [r["contenu"] for r in _sql(reel, "SELECT contenu FROM historique WHERE ticket_id = %s AND type = 'statut'", tid)]
    assert lignes == ["Statut: Pièce reçue → En attente de pièce (pièce commandée) — par Sophie"]


def test_auto_sans_session_limite_par_ip(reel, propre):
    c = reel["c"]
    codes = [c.post("/api/parts/auto", json={"ticket_id": 999999999, "description": "x"}).status_code for _ in range(11)]
    assert codes[:10] == [403] * 10 and codes[10] == 429


# ─── Réception d'une pièce parmi plusieurs ───────────────────────────

def test_reception_d_une_piece_sur_deux_ne_change_pas_le_statut(reel, propre, heure_utc):
    c = reel["c"]
    tid = _ticket(reel, propre, statut="En attente de pièce", depot_il_y_a="2 days")
    ids = [c.post("/api/parts", headers=H, json={"ticket_id": tid, "description": d}).json()["id"]
           for d in ("Écran", "Batterie")]
    assert c.patch(f"/api/parts/{ids[0]}", headers=H, json={"statut": "Commandée"}).status_code == 200
    assert c.patch(f"/api/parts/{ids[1]}", headers=H, json={"statut": "Reçu"}).status_code == 200
    assert _statut(reel, tid) == "En attente de pièce"
    journal = _sql(reel, "SELECT historique FROM tickets WHERE id = %s", tid)[0]["historique"]
    assert 'Pièce "Batterie" reçue (1/2)' in journal
    heure = journal.strip().splitlines()[-1][1:12]
    assert heure in _heures_paris_possibles()
    # La dernière arrive : Pièce reçue
    assert c.patch(f"/api/parts/{ids[0]}", headers=H, json={"statut": "Reçu"}).status_code == 200
    assert _statut(reel, tid) == "Pièce reçue"
    assert 'Pièce "Écran" reçue (2/2)' in _sql(reel, "SELECT historique FROM tickets WHERE id = %s", tid)[0]["historique"]


def test_reception_d_une_seule_piece_inchangee(reel, propre):
    c = reel["c"]
    tid = _ticket(reel, propre, statut="En attente de pièce", depot_il_y_a="2 days")
    pid = c.post("/api/parts", headers=H, json={"ticket_id": tid, "description": "Écran"}).json()["id"]
    assert c.patch(f"/api/parts/{pid}", headers=H, json={"statut": "Reçu"}).status_code == 200
    assert _statut(reel, tid) == "Pièce reçue"
    journal = _sql(reel, "SELECT historique FROM tickets WHERE id = %s", tid)[0]["historique"]
    assert journal.strip().endswith('Pièce "Écran" reçue')


# ─── Grattage ────────────────────────────────────────────────────────

def test_grattage_exige_la_preuve_du_suivi(reel, propre):
    c = reel["c"]
    tid = _ticket(reel, propre, statut="Clôturé", depot_il_y_a="3 days", suivi_token="jeton-du-suivi-1234567")
    code = f"KP-{tid:06d}"
    r = c.post(f"/api/fidelite/grattage/{code}")
    assert r.status_code == 403, r.text
    assert r.json()["detail"]["code"] == "preuve_requise"
    assert c.post(f"/api/fidelite/grattage/{code}", json={"tel4": TEL[-4:]}).status_code == 403   # plus accepté
    assert c.post(f"/api/fidelite/grattage/{code}", json={"tel": "06 00 00 00 00"}).status_code == 403
    assert c.post(f"/api/fidelite/grattage/{code}", json={"t": "mauvais-jeton-123456789"}).status_code == 403
    assert _sql(reel, "SELECT grattage_fait FROM tickets WHERE id = %s", tid)[0]["grattage_fait"] is False

    # Sans preuve, GET ne dit plus rien du ticket
    r = c.get(f"/api/fidelite/grattage/{code}")
    assert r.status_code == 403 and r.json()["detail"]["code"] == "preuve_requise"
    # Preuve par le numéro complet (corps) : état complet, puis grattage
    etat = c.post(f"/api/fidelite/grattage/{code}/etat", json={"tel": TEL}).json()
    assert etat["deja_gratte"] is False and etat["eligible"] is True
    with patch.object(fidelite_api.secrets, "randbelow", return_value=1):
        r = c.post(f"/api/fidelite/grattage/{code}", json={"tel": TEL})
    assert r.status_code == 200, r.text
    assert r.json()["gagnant"] is False
    assert c.post(f"/api/fidelite/grattage/{code}", json={"tel": TEL}).status_code == 400
    # Résultat relu avec le jeton du lien
    etat = c.get(f"/api/fidelite/grattage/{code}", params={"t": "jeton-du-suivi-1234567"}).json()
    assert etat["deja_gratte"] is True and etat["gain"] is None


def test_grattage_reserve_aux_tickets_rendus_clotures_ou_payes(reel, propre):
    c = reel["c"]
    preuve = {"tel": TEL}
    for statut in ("Pré-enregistré", "En attente de diagnostic", "Réparation terminée"):
        tid = _ticket(reel, propre, statut=statut)
        r = c.post(f"/api/fidelite/grattage/KP-{tid:06d}", json=preuve)
        assert r.status_code == 409, (statut, r.text)
        assert c.get(f"/api/fidelite/grattage/KP-{tid:06d}", params=preuve).json()["eligible"] is False
    tid = _ticket(reel, propre, statut="Réparation terminée", paye=1)
    with patch.object(fidelite_api.secrets, "randbelow", return_value=1):
        assert c.post(f"/api/fidelite/grattage/KP-{tid:06d}", json=preuve).status_code == 200


def test_grattage_tirage_au_hasard_et_non_au_compteur(reel, propre):
    """L'ancien compteur faisait gagner le N-ième grattage : prévisible. Désormais, un tirage
    1 chance sur N à chaque grattage (secrets.randbelow)."""
    c = reel["c"]
    preuve = {"tel": TEL}
    gagnants = []
    with patch.object(fidelite_api.secrets, "randbelow", return_value=3) as tirage:
        for _ in range(11):
            tid = _ticket(reel, propre, statut="Clôturé", depot_il_y_a="3 days")
            gagnants.append(c.post(f"/api/fidelite/grattage/KP-{tid:06d}", json=preuve).json()["gagnant"])
    assert gagnants == [False] * 11
    assert tirage.call_args.args == (10,)
    tid = _ticket(reel, propre, statut="Clôturé", depot_il_y_a="3 days")
    with patch.object(fidelite_api.secrets, "randbelow", return_value=0):
        r = c.post(f"/api/fidelite/grattage/KP-{tid:06d}", json=preuve).json()
    assert r["gagnant"] is True and r["gain"] in ("film", "reduction")
    assert _sql(reel, "SELECT bon_grattage FROM clients WHERE id = %s", propre)[0]["bon_grattage"] == r["gain"]


# ─── Limites de débit des routes publiques par code ─────────────────

@pytest.mark.parametrize("route", ["/api/fidelite/ticket/{}", "/api/parts/public/{}", "/api/fidelite/grattage/{}"])
def test_routes_publiques_par_code_limitees(reel, propre, route):
    c = reel["c"]
    tid = _ticket(reel, propre, statut="Clôturé", depot_il_y_a="3 days")
    n = suivi_api._LIMITEUR.limite
    codes = [c.get(route.format(f"KP-{tid:06d}"), params={"tel": TEL}).status_code for _ in range(n + 1)]
    assert codes[:n] == [200] * n and codes[n] == 429


def test_fidelite_par_code_sans_total_ni_historique(reel, propre):
    c = reel["c"]
    tid = _ticket(reel, propre, statut="Clôturé", depot_il_y_a="3 days")
    assert c.get(f"/api/fidelite/ticket/KP-{tid:06d}").status_code == 403   # code seul : rien
    d = c.get(f"/api/fidelite/ticket/KP-{tid:06d}", params={"tel": TEL}).json()
    assert "points" in d and "prochaine_recompense" in d and "recompenses_disponibles" in d
    for cle in ("total_depense", "historique", "bon_grattage", "bon_grattage_label"):
        assert cle not in d


# ─── Dépôt à distance ────────────────────────────────────────────────

def _depot(c, **kw):
    corps = {"nom": "Fictif", "prenom": "Lot2", "telephone": TEL, "marque": "Marque", "modele": "Lot2",
             "panne": "Batterie", "rgpd_informe": True}
    corps.update(kw)
    return c.post("/api/depot-distance", json=corps)


def test_depot_distance_limite_par_ip(reel, propre):
    c = reel["c"]
    codes = [_depot(c, telephone=TEL_TIERS, modele=f"M{i}").status_code for i in range(6)]
    # 3 pré-enregistrements ouverts au plus pour ce client, puis la limite par IP (5 / 10 min)
    assert codes == [200, 200, 200, 409, 409, 429], codes


def test_depot_distance_meme_appareil_dans_l_heure_reutilise(reel, propre):
    c = reel["c"]
    a = _depot(c).json()
    b = _depot(c).json()
    assert a["ticket_code"] == b["ticket_code"]
    assert len(_sql(reel, "SELECT id FROM tickets WHERE client_id = %s", propre)) == 1


def test_depot_distance_email_jamais_a_une_adresse_tierce(reel, propre):
    c = reel["c"]
    assert _depot(c, email="tiers@exemple.test", modele="A").status_code == 200
    assert reel["envois"] == []
    assert _depot(c, email="Connu@Exemple.test", modele="B").status_code == 200
    assert [e[0] for e in reel["envois"]] == ["connu@exemple.test"]
    # Nouveau client : sa propre adresse
    reel["envois"].clear()
    assert _depot(c, telephone=TEL_TIERS, email="nouveau@exemple.test").status_code == 200
    assert [e[0] for e in reel["envois"]] == ["nouveau@exemple.test"]


def test_depot_distance_suivi_public_retire(reel, propre):
    """L'ancien GET /api/depot-distance/suivi/{code} (sans limite, avec le prénom) n'existe plus."""
    tid = _ticket(reel, propre, statut="Pré-enregistré", source="distance")
    r = reel["c"].get(f"/api/depot-distance/suivi/KP-{tid:06d}")
    assert r.status_code == 404 and "client_prenom" not in r.text


def test_depot_distance_journal_a_l_heure_de_paris(reel, propre, heure_utc):
    c = reel["c"]
    tid = _ticket(reel, propre, statut="Pré-enregistré", source="distance")
    assert c.put(f"/api/depot-distance/{tid}/valider", headers=H).status_code == 200
    tid2 = _ticket(reel, propre, statut="Pré-enregistré", source="distance")
    assert c.put(f"/api/depot-distance/{tid2}/refuser", headers=H, json={"motif": "Test"}).status_code == 200
    possibles = _heures_paris_possibles()
    for t in (tid, tid2):
        ligne = _sql(reel, "SELECT historique FROM tickets WHERE id = %s", t)[0]["historique"].strip().splitlines()[-1]
        assert ligne[1:12] in possibles, (ligne, possibles)


def test_suivi_devis_journal_a_l_heure_de_paris(reel, propre, heure_utc):
    c = reel["c"]
    tid = _ticket(reel, propre, statut="En attente d'accord client", depot_il_y_a="1 day")
    r = c.post(f"/api/suivi/KP-{tid:06d}/valider-devis", json={"accepte": False, "tel": TEL})
    assert r.status_code == 200, r.text
    ligne = _sql(reel, "SELECT historique FROM tickets WHERE id = %s", tid)[0]["historique"].strip().splitlines()[-1]
    assert ligne[1:12] in _heures_paris_possibles(), ligne


# ─── Recherche : noms à apostrophe ───────────────────────────────────

def test_recherche_nom_a_apostrophe_sans_apostrophe(reel, propre):
    c = reel["c"]
    _sql(reel, "UPDATE clients SET nom = %s, prenom = %s WHERE id = %s", "D'Artagnan", "O’Neil", propre)
    tid = _ticket(reel, propre)
    for q in ("dartagnan", "d artagnan", "oneil"):
        ids = [x["id"] for x in c.get("/api/clients", headers=H, params={"search": q}).json()]
        assert propre in ids, q
        d = c.get("/api/tickets/stats/dashboard", headers=H, params={"search": q, "tech": TECH}).json()
        assert tid in [t["id"] for t in d["tickets"]], q
