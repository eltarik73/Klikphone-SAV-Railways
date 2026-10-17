"""Second numéro du ticket (tickets.tel_contact) : numéro pour joindre le client PENDANT la
réparation quand l'appareil déposé est son téléphone. clients.telephone reste l'identifiant.

Partie « base réelle » (PostgreSQL JETABLE, données fictives, migrations du lifespan rejouées) :
    KP_TEL_CONTACT_DATABASE_URL="postgresql://postgres:<mdp>@127.0.0.1:55432/kp_tel_contact?sslmode=disable" \
        pytest tests/test_tel_contact.py
Sans la variable, ces tests sont ignorés (skip). Brevo est simulé : aucun SMS ne part.
"""

import inspect
import os
import re
import sys
import types
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import main
from app.api import notifications as notifications_api
from app.api import print_tickets
from app.api import rgpd
from app.api import tickets as tickets_api
from app.api.auth import create_token
from app.api.depot_distance import DepotDistanceRequest
from app.models import TicketCreate, TicketUpdate, telephone_contact_canonique
from app.services import params as params_cache
from app.services import search as S
from app.services import sms

H = {"Authorization": f"Bearer {create_token('accueil', 'Sophie')}"}
DDL_TEL_CONTACT = "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tel_contact TEXT"
PLACEHOLDER = re.compile(r"%\((\w+)\)s")


# ═══ Canonisation (même forme que clients.telephone) ═══════════════

@pytest.mark.parametrize("saisie,attendu", [
    (None, None), ("", None), ("   ", None),
    ("06 11 22 33 44", "0611223344"),
    ("06.11.22.33.44", "0611223344"),
    ("+33 6 11 22 33 44", "0611223344"),
    ("0033611223344", "0611223344"),
    ("+41 79 123 45 67", "+41791234567"),
])
def test_tel_contact_canonique(saisie, attendu):
    assert telephone_contact_canonique(saisie) == attendu
    assert TicketCreate(client_id=1, categorie="Smartphone", marque="Apple", panne="Batterie",
                        tel_contact=saisie).tel_contact == attendu
    assert TicketUpdate(tel_contact=saisie).tel_contact == attendu


@pytest.mark.parametrize("saisie", ["abc", "12345", "06 11 22 33 4a", "06-11-22-33-44-55-66-77-88"])
def test_tel_contact_non_plausible_refuse(saisie):
    with pytest.raises(ValueError):
        telephone_contact_canonique(saisie)
    with pytest.raises(ValidationError):
        TicketCreate(client_id=1, categorie="Smartphone", marque="Apple", panne="Batterie", tel_contact=saisie)
    with pytest.raises(ValidationError):
        TicketUpdate(tel_contact=saisie)
    with pytest.raises(ValidationError):
        DepotDistanceRequest(nom="Fictif", telephone="0611223344", tel_contact=saisie)


def test_tel_contact_absent_du_patch_n_est_pas_ecrit():
    # exclude_unset : un PATCH sans la clé ne touche pas la colonne ; "" l'efface (NULL)
    assert "tel_contact" not in TicketUpdate(notes_internes="x").model_dump(exclude_unset=True)
    assert TicketUpdate(tel_contact="").model_dump(exclude_unset=True) == {"tel_contact": None}


def test_depot_distance_modele_tel_contact_et_code():
    d = DepotDistanceRequest(nom="Fictif", telephone="06 11 22 33 44", tel_contact=" +33 6 99 88 77 66 ",
                             pin=" 1234 ", pattern="1-5-9")
    assert (d.telephone, d.tel_contact, d.pin, d.pattern) == ("0611223344", "0699887766", "1234", "1-5-9")
    assert DepotDistanceRequest(nom="Fictif", telephone="0611223344", tel_contact="").tel_contact is None


# ═══ Route POST /api/tickets (base simulée) ════════════════════════

def _cursor(fetchone=None):
    cur = MagicMock()
    cur.fetchone.return_value = fetchone
    cur.fetchall.return_value = []

    @contextmanager
    def cm():
        yield cur
    return cur, cm


def test_post_ticket_tel_contact_422(client):
    r = client.post("/api/tickets", json={"client_id": 1, "categorie": "Smartphone", "marque": "Apple",
                                          "panne": "Batterie", "tel_contact": "abc"})
    assert r.status_code == 422
    assert "tel_contact" in r.text


def test_post_ticket_insere_le_numero_canonique(client):
    cur, cm = _cursor(fetchone={"id": 41})
    with patch("app.api.tickets.get_cursor", cm), patch("app.api.public_documents.jeton_suivi"):
        r = client.post("/api/tickets", json={"client_id": 1, "categorie": "Smartphone", "marque": "Apple",
                                              "panne": "Batterie", "tel_contact": "+33 6 11 22 33 44",
                                              "priorite": "attente"})
    assert r.status_code == 200, r.text
    sql, params = cur.execute.call_args_list[0].args
    assert "tel_contact" in sql and "0611223344" in params
    assert params[-1] == "attente"          # la priorité reste le dernier paramètre (tests atelier)


# ═══ Destinataire des messages ═════════════════════════════════════

def test_numero_joignable_prefere_le_second_numero():
    assert notifications_api.numero_joignable({"telephone": "0600000001", "tel_contact": "0699887766"}) == ("0699887766", True)
    assert notifications_api.numero_joignable({"telephone": "0600000001", "tel_contact": "  "}) == ("0600000001", False)
    assert notifications_api.numero_joignable({"telephone": "0600000001"}) == ("0600000001", False)
    assert notifications_api.numero_joignable({"telephone": None, "tel_contact": None}) == (None, False)
    assert notifications_api.numero_joignable(None) == (None, False)


def test_numero_client_sms_seulement_s_il_peut_recevoir_un_sms():
    assert notifications_api.numero_client_sms({"telephone": "06 00 00 07 71"}) == "06 00 00 07 71"
    assert notifications_api.numero_client_sms({"telephone": "+41 79 123 45 67"}) == "+41791234567"
    assert notifications_api.numero_client_sms({"telephone": "04 79 60 89 22"}) is None     # fixe
    assert notifications_api.numero_client_sms({"telephone": "abc"}) is None
    assert notifications_api.numero_client_sms({"telephone": None}) is None
    assert notifications_api.numero_client_sms(None) is None


def test_refus_sms_explique_quand_c_est_le_second_numero():
    """Un tel_contact fixe bloque le SMS : le refus dit que c'est le numéro pour vous joindre
    et donne le téléphone du client, pour que l'écran propose l'autre envoi ou l'effacement."""
    message = "Le 04 79 00 00 00 n'est pas un portable (06 ou 07) : SMS impossible"
    with pytest.raises(HTTPException) as e:
        notifications_api._refus_numero("numero_fixe", message, {"telephone": "0600000771", "tel_contact": "0479000000"}, True)
    d = e.value.detail
    assert e.value.status_code == 400 and d["code"] == "numero_fixe"
    assert d["autre_numero"] is True and d["numero_client"] == "06 00 00 07 71"
    assert d["message"].startswith(message + " — c'est le numéro pour vous joindre donné au dépôt.")
    assert "Envoyez au 06 00 00 07 71 (téléphone du client) ou effacez-le dans la fiche" in d["message"]
    # Client lui-même sur un fixe : rien à proposer d'autre que corriger la fiche
    with pytest.raises(HTTPException) as e:
        notifications_api._refus_numero("numero_fixe", message, {"telephone": "0479608922", "tel_contact": "0479000000"}, True)
    assert e.value.detail["numero_client"] is None
    assert e.value.detail["message"].endswith("Corrigez-le ou effacez-le dans la fiche du ticket.")
    # Numéro principal en cause : message inchangé, simplement autre_numero = False
    with pytest.raises(HTTPException) as e:
        notifications_api._refus_numero("numero_fixe", message, {"telephone": "0479000000"}, False)
    assert e.value.detail == {"code": "numero_fixe", "message": message, "autre_numero": False}


# ═══ Historique : le changement du second numéro se lit après coup ═══

@pytest.mark.parametrize("ancien,nouveau,attendu", [
    (None, "0699887766", "Numéro pour joindre : 0699887766 (ajouté)"),
    ("", "0699887766", "Numéro pour joindre : 0699887766 (ajouté)"),
    ("0699887766", "0699887755", "Numéro pour joindre : 0699887766 → 0699887755"),
    ("0699887766", None, "Numéro pour joindre : 0699887766 → effacé"),
    ("0699887766", "", "Numéro pour joindre : 0699887766 → effacé"),
    ("0699887766", "0699887766", None),
    (None, None, None),
    ("", None, None),
])
def test_texte_historique_second_numero(ancien, nouveau, attendu):
    assert tickets_api._texte_tel_contact(ancien, nouveau) == attendu


# ═══ Recherche : le second numéro est un critère (SQL paramétré, index) ═══

def test_recherche_sql_couvre_le_second_numero():
    pq = S.parse_query("06 99 88 77 66")
    P = S.SqlParams()
    sql = S.ticket_where_sql(pq, P)
    # Numéro complet : sous-requête hachée sur la clé à 9 chiffres (idx_tickets_tel_contact_key)
    assert "t.id IN (SELECT x.id FROM tickets x WHERE (x.tel_contact IS NOT NULL AND public.kp_phone_key(x.tel_contact) = %(" in sql
    assert "kp_phone_key(y.telephone)" in sql                      # le téléphone du client reste cherché
    assert "kp_phone_key(t.tel_contact)" not in sql                # jamais évalué ticket par ticket
    assert len(set(PLACEHOLDER.findall(sql))) == len(P.values)   # paramétré, aucune valeur dans le texte
    assert "699887766" not in sql
    # Fragment : LIKE sur les chiffres du second numéro, dans la sous-requête servie par les index GIN
    P = S.SqlParams()
    sql = S.ticket_where_sql(S.parse_query("887766"), P)
    assert "(x.tel_contact IS NOT NULL AND public.kp_phone_digits(x.tel_contact) LIKE ANY(%(" in sql
    assert len(set(PLACEHOLDER.findall(sql))) == len(P.values)
    # Score : téléphone du client 700, ticket joignable à ce numéro 650 ; fragment 300 / 250
    P = S.SqlParams()
    sql = S.ticket_score_sql(pq, P)
    assert "THEN 700 WHEN (t.tel_contact IS NOT NULL AND public.kp_phone_key(t.tel_contact) = %(" in sql
    assert "THEN 650" in sql and "THEN 300 WHEN (t.tel_contact IS NOT NULL AND public.kp_phone_digits(t.tel_contact) LIKE ANY(" in sql
    assert len(set(PLACEHOLDER.findall(sql))) == len(P.values)
    # Sans chiffres : rien du second numéro
    assert "tel_contact" not in S.ticket_where_sql(S.parse_query("dupont"), S.SqlParams())
    assert "tel_contact" not in S.ticket_score_sql(S.parse_query("dupont"), S.SqlParams())


def test_recherche_etiquette_autre_numero():
    pq = S.parse_query("0699887766")
    ligne = {"client_tel": "0600000771", "tel_contact": "0699887766"}
    assert S.ticket_match_label(pq, ligne) == "autre numéro"
    assert S.ticket_match_label(pq, {"client_tel": "06 99 88 77 66", "tel_contact": "0699887766"}) == "téléphone"
    assert S.ticket_match_label(S.parse_query("887766"), ligne) == "autre numéro"
    assert S.ticket_match_label(S.parse_query("887766"), {"client_tel": "0600887766", "tel_contact": None}) == "téléphone"


def test_index_du_second_numero_declares():
    src = inspect.getsource(main._migrations_recherche)
    assert '("idx_tickets_tel_contact_key", "tickets", "public.kp_phone_key(tel_contact)", "tel_contact IS NOT NULL")' in src
    assert '("idx_tickets_tel_contact_digits_trgm", "tickets", "public.kp_phone_digits(tel_contact)",' in src


# ═══ Impression : « Joignable » sur la fiche atelier seulement ═════

def _ticket(**extra):
    t = {"id": 42, "ticket_code": "KP-000042", "client_id": 7, "client_nom": "Fictif", "client_prenom": "Pytest",
         "client_tel": "06 00 00 00 00", "categorie": "Smartphone", "marque": "Apple", "modele": "iPhone 12",
         "panne": "Batterie", "statut": "En cours de réparation", "tel_contact": "0699887766"}
    t.update(extra)
    return t


def test_fiche_atelier_affiche_joignable_pas_le_ticket_client():
    staff = print_tickets.render_html(_ticket(), "staff")
    assert "Joignable : 0699887766" in staff
    assert "Joignable" not in print_tickets.render_html(_ticket(), "client")
    assert print_tickets.render_html(_ticket(), "combined").count("Joignable") == 1
    assert "Joignable" not in print_tickets.render_html(_ticket(tel_contact=None), "staff")
    assert "Joignable" not in print_tickets.render_html(_ticket(tel_contact="  "), "staff")
    # Valeur échappée comme les autres
    assert "<b>" not in print_tickets.render_html(_ticket(tel_contact="<b>06</b>"), "staff").split("Joignable")[1][:40]


# ═══ Migration ═════════════════════════════════════════════════════

def test_migration_declaree_et_reconnue():
    assert DDL_TEL_CONTACT in main._DDL_ALTERS       # garde de version : la colonne est dans le schéma
    assert main._deja_present(DDL_TEL_CONTACT, {"c:tickets.tel_contact"})
    assert not main._deja_present(DDL_TEL_CONTACT, {"c:tickets.priorite"})


# ═══ Base réelle ═══════════════════════════════════════════════════

DB_URL = os.getenv("KP_TEL_CONTACT_DATABASE_URL")
TEL = "0600000771"            # téléphone de l'appareil déposé (fiche client)
TEL2 = "0600000772"           # client anonymisé en fin de module
CONTACT = "06 99 88 77 66"    # saisie borne ; stocké 0699887766, Brevo 33699887766
CLE = "xkeysib-cle-de-test-0123456789"


@pytest.fixture(scope="module")
def reel():
    if not DB_URL:
        pytest.skip("KP_TEL_CONTACT_DATABASE_URL non définie (base PostgreSQL de test jetable)")
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
    from app.main import app as fastapi_app
    try:
        with TestClient(fastapi_app) as c:   # lifespan : schéma + migrations
            with vrai_cursor() as cur:
                for tel in (TEL, TEL2):
                    cur.execute("DELETE FROM notes_tickets WHERE ticket_id IN (SELECT id FROM tickets WHERE client_id IN (SELECT id FROM clients WHERE telephone = %s))", (tel,))
                    cur.execute("DELETE FROM tickets WHERE client_id IN (SELECT id FROM clients WHERE telephone = %s)", (tel,))
                    cur.execute("DELETE FROM clients WHERE telephone = %s", (tel,))
                cur.execute("INSERT INTO clients (nom, prenom, telephone) VALUES ('Fictif', 'Pytest', %s) RETURNING id", (TEL,))
                cid = cur.fetchone()["id"]
            yield {"c": c, "cur": vrai_cursor, "cid": cid}
    finally:
        mp.undo()
        pool.closeall()
        params_cache.invalidate()


def _sql(reel, sql, *params):
    with reel["cur"]() as cur:
        cur.execute(sql, params)
        return cur.fetchall() if cur.description else None


def _param(reel, cle, valeur):
    _sql(reel, "INSERT INTO params (cle, valeur) VALUES (%s, %s) ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur",
         cle, valeur)
    params_cache.invalidate()


def _colonne(reel, tid):
    return _sql(reel, "SELECT tel_contact FROM tickets WHERE id = %s", tid)[0]["tel_contact"]


def _borne(reel, **extra):
    """Création depuis la borne : sans jeton, comme /client."""
    corps = {"client_id": reel["cid"], "categorie": "Smartphone", "marque": "Apple", "modele": "iPhone 12",
             "panne": "Batterie", "pin": "1234", "source": "boutique"}
    corps.update(extra)
    return reel["c"].post("/api/tickets", json=corps)


class FakeBrevo:
    """Remplace httpx.Client : enregistre les appels, répond « accepté »."""

    def __init__(self):
        self.appels = []

    def __call__(self, *a, **k):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def post(self, url, json=None, headers=None):
        self.appels.append(json)
        return types.SimpleNamespace(status_code=201, json=lambda: {"messageId": len(self.appels)})


@pytest.fixture
def brevo(reel, monkeypatch):
    fake = FakeBrevo()
    monkeypatch.setenv("BREVO_API_KEY", CLE)
    monkeypatch.setattr(sms, "httpx", types.SimpleNamespace(
        Client=fake, Timeout=httpx.Timeout, TimeoutException=httpx.TimeoutException, HTTPError=httpx.HTTPError))
    _param(reel, "SMS_BREVO_ACTIF", "1")
    sms.ANTI_DOUBLON.vider()
    yield fake
    sms.ANTI_DOUBLON.vider()
    _param(reel, "SMS_BREVO_ACTIF", "0")


def test_migration_idempotente(reel):
    cols = _sql(reel, """SELECT data_type, is_nullable FROM information_schema.columns
                         WHERE table_name = 'tickets' AND column_name = 'tel_contact'""")
    assert cols == [{"data_type": "text", "is_nullable": "YES"}]
    _sql(reel, DDL_TEL_CONTACT)       # rejouée : sans erreur, sans doublon
    _sql(reel, DDL_TEL_CONTACT)
    assert main._deja_present(DDL_TEL_CONTACT, main._objets_existants())


def test_creation_borne_avec_second_numero(reel):
    c = reel["c"]
    r = _borne(reel, tel_contact=CONTACT, priorite="attente")
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    assert _colonne(reel, tid) == "0699887766"
    t = c.get(f"/api/tickets/{tid}", headers=H).json()
    assert t["tel_contact"] == "0699887766" and t["client_tel"] == TEL
    assert t["priorite"] == "attente" and t["pin"] == "1234"     # rien d'autre n'a bougé

    # Sans second numéro ou vide : NULL
    assert _colonne(reel, _borne(reel).json()["id"]) is None
    assert _colonne(reel, _borne(reel, tel_contact="   ").json()["id"]) is None
    # International → forme nationale, étranger gardé en +
    assert _colonne(reel, _borne(reel, tel_contact="+33 6 99 88 77 66").json()["id"]) == "0699887766"
    assert _colonne(reel, _borne(reel, tel_contact="+41 79 123 45 67").json()["id"]) == "+41791234567"


def test_creation_borne_numero_invalide_422(reel):
    avant = _sql(reel, "SELECT count(*) AS n FROM tickets WHERE client_id = %s", reel["cid"])[0]["n"]
    for saisie in ("abc", "12345"):
        r = _borne(reel, tel_contact=saisie)
        assert r.status_code == 422, r.text
        assert "tel_contact" in r.text
    assert _sql(reel, "SELECT count(*) AS n FROM tickets WHERE client_id = %s", reel["cid"])[0]["n"] == avant


def test_patch_tel_contact(reel):
    c = reel["c"]
    tid = _borne(reel).json()["id"]
    r = c.patch(f"/api/tickets/{tid}", headers=H, json={"tel_contact": "+33 6 99 88 77 66"})
    assert r.status_code == 200, r.text
    assert r.json()["ticket"]["tel_contact"] == "0699887766" and _colonne(reel, tid) == "0699887766"
    # Un PATCH d'un autre champ ne touche pas le numéro
    c.patch(f"/api/tickets/{tid}", headers=H, json={"notes_internes": "x"})
    assert _colonne(reel, tid) == "0699887766"
    # Numéro faux : refusé, valeur inchangée
    assert c.patch(f"/api/tickets/{tid}", headers=H, json={"tel_contact": "abc"}).status_code == 422
    assert _colonne(reel, tid) == "0699887766"
    # Vide : effacé
    r = c.patch(f"/api/tickets/{tid}", headers=H, json={"tel_contact": ""})
    assert r.status_code == 200 and r.json()["ticket"]["tel_contact"] is None and _colonne(reel, tid) is None


def test_dashboard_file_et_liste_exposent_le_numero(reel):
    c = reel["c"]
    tid = _borne(reel, tel_contact=CONTACT, modele="Dashboard").json()["id"]
    d = c.get("/api/tickets/stats/dashboard", headers=H, params={"vue": "actifs", "limit": 200}).json()
    ligne = next(t for t in d["tickets"] if t["id"] == tid)
    assert ligne["tel_contact"] == "0699887766" and ligne["client_tel"] == TEL
    file_ = c.get("/api/tickets/queue/repair", headers=H, params={"limit": 50}).json()
    ligne = next(t for t in file_ if t["id"] == tid)
    assert ligne["tel_contact"] == "0699887766" and ligne["client_tel"] == TEL
    liste = c.get("/api/tickets", headers=H, params={"tel": TEL, "limit": 100}).json()
    ligne = next(t for t in liste if t["id"] == tid)
    assert ligne["tel_contact"] == "0699887766"


def test_sms_part_vers_tel_contact_puis_repli_client(reel, brevo):
    c = reel["c"]
    avec = _borne(reel, tel_contact=CONTACT).json()["id"]
    sans = _borne(reel).json()["id"]

    r = c.post("/api/notifications/sms", headers=H, json={"ticket_id": avec, "message": "Votre iPhone est prêt",
                                                           "libelle": "Appareil prêt"})
    assert r.status_code == 200, r.text
    assert r.json()["destinataire"] == "06 99 88 77 66" and r.json()["autre_numero"] is True
    assert brevo.appels[-1]["recipient"] == "33699887766"
    note = _sql(reel, "SELECT contenu, type_note FROM notes_tickets WHERE ticket_id = %s ORDER BY id DESC LIMIT 1", avec)[0]
    assert note["type_note"] == "sms"
    assert note["contenu"].startswith("✅ SMS envoyé au 06 99 88 77 66 (autre numéro) (1 SMS, Brevo)")
    assert note["contenu"].endswith("[Appareil prêt] Votre iPhone est prêt")

    r = c.post("/api/notifications/sms", headers=H, json={"ticket_id": sans, "message": "Votre iPhone est prêt"})
    assert r.status_code == 200, r.text
    assert r.json()["destinataire"] == "06 00 00 07 71" and r.json()["autre_numero"] is False
    assert brevo.appels[-1]["recipient"] == "33600000771"
    note = _sql(reel, "SELECT contenu FROM notes_tickets WHERE ticket_id = %s ORDER BY id DESC LIMIT 1", sans)[0]
    assert note["contenu"].startswith("✅ SMS envoyé au 06 00 00 07 71 (1 SMS, Brevo)")
    assert len(brevo.appels) == 2
    assert _sql(reel, "SELECT msg_sms FROM tickets WHERE id = %s", avec)[0]["msg_sms"] == 1


def test_sms_non_configure_lien_vers_tel_contact(reel, monkeypatch):
    c = reel["c"]
    monkeypatch.setenv("BREVO_API_KEY", CLE)
    _param(reel, "SMS_BREVO_ACTIF", "0")
    tid = _borne(reel, tel_contact=CONTACT).json()["id"]
    r = c.post("/api/notifications/sms", headers=H, json={"ticket_id": tid, "message": "Bonjour"})
    assert r.status_code == 409
    d = r.json()["detail"]
    assert d["code"] == "sms_non_configure" and d["link"] == "sms:0699887766?body=Bonjour" and d["autre_numero"] is True


def test_whatsapp_vers_tel_contact(reel):
    c = reel["c"]
    avec = _borne(reel, tel_contact=CONTACT).json()["id"]
    sans = _borne(reel).json()["id"]
    r = c.post("/api/notifications/whatsapp", headers=H, params={"ticket_id": avec, "message": "Bonjour"})
    assert r.status_code == 200, r.text
    assert r.json()["link"].startswith("https://wa.me/33699887766?") and r.json()["autre_numero"] is True
    r = c.post("/api/notifications/whatsapp", headers=H, params={"ticket_id": sans, "message": "Bonjour"})
    assert r.json()["link"].startswith("https://wa.me/33600000771?") and r.json()["autre_numero"] is False


def test_fiche_atelier_imprimee_joignable(reel):
    c = reel["c"]
    avec = _borne(reel, tel_contact=CONTACT).json()["id"]
    sans = _borne(reel).json()["id"]
    staff = c.get(f"/api/tickets/{avec}/print/staff", headers=H).text
    assert "Joignable : 0699887766" in staff and f"Tél : {TEL}" in staff
    assert "Joignable" not in c.get(f"/api/tickets/{avec}/print/client", headers=H).text
    assert c.get(f"/api/tickets/{avec}/print/combined", headers=H).text.count("Joignable") == 1
    assert "Joignable" not in c.get(f"/api/tickets/{sans}/print/staff", headers=H).text


def test_depot_distance_accepte_le_second_numero(reel):
    c = reel["c"]
    corps = {"nom": "Fictif", "prenom": "Pytest", "telephone": TEL, "categorie": "Smartphone", "marque": "Apple",
             "modele": "iPhone 12", "panne": "Batterie HS", "tel_contact": "+33 6 99 88 77 66",
             "pin": "4321", "pattern": ""}
    r = c.post("/api/depot-distance", json=corps)
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    row = _sql(reel, "SELECT tel_contact, pin, pattern, statut, source, client_id FROM tickets WHERE id = %s", tid)[0]
    assert row["tel_contact"] == "0699887766" and row["pin"] == "4321" and row["pattern"] == ""
    assert row["statut"] == "Pré-enregistré" and row["source"] == "distance" and row["client_id"] == reel["cid"]
    pending = c.get("/api/depot-distance/pending", headers=H).json()
    assert next(p for p in pending if p["id"] == tid)["tel_contact"] == "0699887766"
    # Sans second numéro : NULL ; numéro faux : 422
    r = c.post("/api/depot-distance", json={**corps, "tel_contact": ""})
    assert r.status_code == 200 and _colonne(reel, r.json()["id"]) is None
    assert c.post("/api/depot-distance", json={**corps, "tel_contact": "abc"}).status_code == 422


def test_anonymisation_efface_le_second_numero(reel):
    cid2 = _sql(reel, "INSERT INTO clients (nom, prenom, telephone) VALUES ('Fictif', 'Anonyme', %s) RETURNING id", TEL2)[0]["id"]
    r = _borne(reel, client_id=cid2, tel_contact=CONTACT)
    tid = r.json()["id"]
    assert _colonne(reel, tid) == "0699887766"
    with reel["cur"]() as cur:
        faits, _codes = rgpd._anonymiser(cur, [cid2])
    assert faits == [cid2]
    assert _colonne(reel, tid) is None


AUTRE = "06 99 88 77 55"      # second numéro qui n'est le téléphone d'aucun client ; stocké 0699887755


def _recherche(reel, q, **params):
    r = reel["c"].get("/api/search", headers=H, params={"q": q, "limit": 25, **params})
    assert r.status_code == 200, r.text
    return r.json()


def test_recherche_trouve_le_dossier_par_le_second_numero(reel):
    """Le comptoir rappelé depuis « l'autre numéro » retrouve le ticket (tout format, fragment)."""
    c = reel["c"]
    tid = _borne(reel, tel_contact=AUTRE, modele="Recherche").json()["id"]
    for q in ("0699887755", AUTRE, "+33 6 99 88 77 55", "06.99.88.77.55", "0033699887755"):
        g = _recherche(reel, q)["groups"]
        ligne = next((t for t in g["tickets"] if t["id"] == tid), None)
        assert ligne is not None, q
        assert ligne["tel_contact"] == "0699887755" and ligne["match"] == "autre numéro"
        assert g["clients"] == []     # aucun client n'a ce numéro : pas de fiche client inventée
    # Fragment tapé au comptoir
    ligne = next(t for t in _recherche(reel, "887755")["groups"]["tickets"] if t["id"] == tid)
    assert ligne["match"] == "autre numéro"
    # Le téléphone du client reste un critère, avec son étiquette ; un numéro inconnu ne renvoie rien
    ligne = next(t for t in _recherche(reel, TEL)["groups"]["tickets"] if t["id"] == tid)
    assert ligne["match"] == "téléphone"
    assert _recherche(reel, "0699887700")["groups"]["tickets"] == []
    # Même critère dans la case de recherche du dashboard (paramètre « search »)
    d = c.get("/api/tickets/stats/dashboard", headers=H,
              params={"vue": "actifs", "search": "0699887755", "limit": 200}).json()
    assert [t["id"] for t in d["tickets"]] == [tid]


def test_index_du_second_numero_en_base(reel):
    rows = _sql(reel, "SELECT indexname, indexdef FROM pg_indexes WHERE indexname LIKE 'idx_tickets_tel_contact%%'")
    defs = {r["indexname"]: r["indexdef"] for r in rows}
    assert "kp_phone_key(tel_contact)" in defs["idx_tickets_tel_contact_key"]
    assert "WHERE (tel_contact IS NOT NULL)" in defs["idx_tickets_tel_contact_key"]
    if _sql(reel, "SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'"):
        assert "USING gin" in defs["idx_tickets_tel_contact_digits_trgm"]
        assert "WHERE (tel_contact IS NOT NULL)" in defs["idx_tickets_tel_contact_digits_trgm"]
    # La sous-requête du numéro complet passe par l'index partiel (prédicat IS NOT NULL prouvé)
    P = S.SqlParams()
    where = S.ticket_where_sql(S.parse_query("0699887755"), P)
    with reel["cur"]() as cur:
        cur.execute("SET LOCAL enable_seqscan = off")
        cur.execute("EXPLAIN (FORMAT JSON) SELECT t.id FROM tickets t JOIN clients c ON c.id = t.client_id"
                    " WHERE " + where, P.values)
        plan = str(cur.fetchone()["QUERY PLAN"])
    assert "idx_tickets_tel_contact_key" in plan


def _historique_numero(reel, tid):
    return [r["contenu"] for r in _sql(
        reel, "SELECT contenu FROM historique WHERE ticket_id = %s AND contenu LIKE 'Numéro pour joindre%%' ORDER BY id", tid)]


def test_patch_tel_contact_historise(reel):
    """Qui a posé, changé ou effacé le numéro vers lequel partent les SMS se lit dans l'historique."""
    c = reel["c"]
    tid = _borne(reel).json()["id"]
    assert _historique_numero(reel, tid) == []
    c.patch(f"/api/tickets/{tid}", headers=H, json={"tel_contact": CONTACT})
    assert _historique_numero(reel, tid) == ["Numéro pour joindre : 0699887766 (ajouté) — par Sophie"]
    # Même valeur ou autre champ : pas de ligne
    c.patch(f"/api/tickets/{tid}", headers=H, json={"tel_contact": "06.99.88.77.66"})
    c.patch(f"/api/tickets/{tid}", headers=H, json={"notes_internes": "x"})
    assert len(_historique_numero(reel, tid)) == 1
    c.patch(f"/api/tickets/{tid}", headers=H, json={"tel_contact": AUTRE})
    r = c.patch(f"/api/tickets/{tid}", headers=H, json={"tel_contact": ""})
    assert r.status_code == 200 and r.json()["ticket"]["tel_contact"] is None
    assert _historique_numero(reel, tid) == [
        "Numéro pour joindre : 0699887766 (ajouté) — par Sophie",
        "Numéro pour joindre : 0699887766 → 0699887755 — par Sophie",
        "Numéro pour joindre : 0699887755 → effacé — par Sophie",
    ]
    # Le journal texte du ticket les porte aussi, et un numéro refusé n'y laisse rien
    assert c.patch(f"/api/tickets/{tid}", headers=H, json={"tel_contact": "abc"}).status_code == 422
    journal = _sql(reel, "SELECT historique FROM tickets WHERE id = %s", tid)[0]["historique"]
    assert journal.count("Numéro pour joindre") == 3 and "abc" not in journal


def test_sms_second_numero_fixe_refuse_et_propose_le_client(reel, brevo):
    c = reel["c"]
    tid = _borne(reel, tel_contact="04 79 00 00 00").json()["id"]
    assert _colonne(reel, tid) == "0479000000"
    r = c.post("/api/notifications/sms", headers=H, json={"ticket_id": tid, "message": "Votre iPhone est prêt"})
    assert r.status_code == 400, r.text
    d = r.json()["detail"]
    assert d["code"] == "numero_fixe" and d["autre_numero"] is True and d["numero_client"] == "06 00 00 07 71"
    assert d["message"].startswith("Le 04 79 00 00 00 n'est pas un portable (06 ou 07) : SMS impossible"
                                   " — c'est le numéro pour vous joindre donné au dépôt.")
    assert "Envoyez au 06 00 00 07 71 (téléphone du client) ou effacez-le dans la fiche" in d["message"]
    assert brevo.appels == []
    assert _sql(reel, "SELECT count(*) AS n FROM notes_tickets WHERE ticket_id = %s", tid)[0]["n"] == 0
    assert _sql(reel, "SELECT msg_sms FROM tickets WHERE id = %s", tid)[0]["msg_sms"] in (0, None)
    # Second numéro effacé dans la fiche : le SMS part au téléphone du client
    c.patch(f"/api/tickets/{tid}", headers=H, json={"tel_contact": ""})
    r = c.post("/api/notifications/sms", headers=H, json={"ticket_id": tid, "message": "Votre iPhone est prêt"})
    assert r.status_code == 200, r.text
    assert r.json()["destinataire"] == "06 00 00 07 71" and r.json()["autre_numero"] is False
    assert brevo.appels[-1]["recipient"] == "33600000771"
