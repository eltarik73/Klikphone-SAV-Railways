"""« Client contacté » : une seule vérité (services/contact) sur chaque ligne de ticket — fiche
(GET /api/tickets/{id}), dashboard (dont la vue a_recuperer), liste et file atelier — plus la note
d'appel POST /api/tickets/{id}/contact et l'étagère qui compte les appels.

Partie « base réelle » (PostgreSQL JETABLE, données fictives, migrations du lifespan rejouées) :
    KP_CONTACT_DATABASE_URL="postgresql://postgres:<mdp>@127.0.0.1:55432/kp_contact_be?sslmode=disable" \
        pytest tests/test_contact_client.py
Sans la variable, ces tests sont ignorés (skip). Aucun SMS ni e-mail ne part.

La base peut être partagée avec d'autres fichiers : toute lecture de liste (dashboard, file
atelier) filtre par technicien (TECH / MASSE) et la liste par le téléphone du client de test,
et la fixture `propre` efface les tickets de test avant et après chaque test (yield : même
quand le test échoue).
"""

import json
import os
import sys
from contextlib import contextmanager
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.api import tickets as tickets_api
from app.api.auth import create_token
from app.models import ContactRequest, TicketFull
from app.services import contact
from app.services import etagere
from app.services import params as params_cache

H = {"Authorization": f"Bearer {create_token('accueil', 'Sophie')}"}
VIDE = {"depuis_statut": False, "dernier": None,
        "canaux": {"sms": None, "email": None, "whatsapp": None, "appel": None}}


# ═══ Forme de l'objet contact (sans base) ═══════════════════════════

def test_lire_vide():
    assert contact.lire(None) == VIDE
    assert contact.lire({}) == VIDE
    assert contact.lire("pas du json") == VIDE
    assert contact.lire({"sms": None, "email": None, "whatsapp": None, "appel": None, "derniers": None}) == VIDE


def test_lire_dernier_canal_et_auteur():
    brut = {"sms": "2026-10-17T10:00:00", "email": None, "whatsapp": "2026-10-17T14:32:00", "appel": "2026-10-16T09:00:00",
            "derniers": [{"canal": "whatsapp", "auteur": "Léa", "id": 7}]}
    c = contact.lire(brut)
    assert c["depuis_statut"] is True
    assert c["canaux"] == {"sms": "2026-10-17T10:00:00", "email": None, "whatsapp": "2026-10-17T14:32:00",
                           "appel": "2026-10-16T09:00:00"}
    assert c["dernier"] == {"canal": "whatsapp", "date": "2026-10-17T14:32:00", "auteur": "Léa"}
    # Auteur vide → None ; JSON texte accepté
    c = contact.lire(json.dumps({"sms": "2026-10-17T10:00:00", "derniers": [{"canal": "sms", "auteur": "", "id": 1}]}))
    assert c["dernier"] == {"canal": "sms", "date": "2026-10-17T10:00:00", "auteur": None}
    # Datetime Python (curseur simulé) → ISO
    c = contact.lire({"email": datetime(2026, 10, 17, 14, 32)})
    assert c["dernier"] == {"canal": "email", "date": "2026-10-17T14:32:00", "auteur": None}


def test_dates_de_la_meme_forme_que_le_reste_de_l_api():
    """json_build_object renvoie le texte PostgreSQL, qui tronque les zéros finaux des
    microsecondes (« …14.16517 ») ; les autres dates de l'API (derniere_relance, date_depot)
    passent par isoformat() Python (6 chiffres) : le contact doit s'y comparer à l'identique."""
    c = contact.lire({"appel": "2026-10-17T19:33:14.16517", "sms": "2026-10-17T19:33:14",
                      "whatsapp": "2026-10-17T19:33:14.5", "email": "2026-10-17 08:00:00"})
    assert c["canaux"] == {"appel": "2026-10-17T19:33:14.165170", "sms": "2026-10-17T19:33:14",
                           "whatsapp": "2026-10-17T19:33:14.500000", "email": "2026-10-17T08:00:00"}
    assert c["dernier"] == {"canal": "whatsapp", "date": "2026-10-17T19:33:14.500000", "auteur": None}
    assert c["canaux"]["appel"] == datetime(2026, 10, 17, 19, 33, 14, 165170).isoformat()
    # Texte non datable (base incohérente) : rendu tel quel plutôt qu'une erreur 500
    assert contact.lire({"sms": "hier"})["canaux"]["sms"] == "hier"


def test_lire_egalite_d_horodatage_canal_et_auteur_coherents():
    """Deux canaux à la même seconde (message-log + appel dans la même transaction) : le canal
    retenu est l'appel ET l'auteur est celui de l'appel — jamais celui de l'autre canal."""
    meme = "2026-10-17T10:00:00"
    brut = {"sms": meme, "appel": meme, "derniers": [{"canal": "sms", "auteur": "Léa", "id": 10},
                                                    {"canal": "appel", "auteur": "Nour", "id": 9}]}
    assert contact.lire(brut)["dernier"] == {"canal": "appel", "date": meme, "auteur": "Nour"}
    # Ancienne relance « Appel téléphonique » = appel ; whatsapp avant email
    brut = {"whatsapp": meme, "email": meme, "appel": meme,
            "derniers": [{"canal": "email", "auteur": "Sam", "id": 3}, {"canal": "relance", "auteur": "Sophie", "id": 2},
                         {"canal": "whatsapp", "auteur": "Léa", "id": 1}]}
    assert contact.lire(brut)["dernier"] == {"canal": "appel", "date": meme, "auteur": "Sophie"}
    brut["appel"] = None
    assert contact.lire(brut)["dernier"] == {"canal": "whatsapp", "date": meme, "auteur": "Léa"}
    # Même canal, même seconde : la note la plus récente (id le plus grand)
    brut = {"sms": meme, "derniers": [{"canal": "sms", "auteur": "Léa", "id": 10}, {"canal": "sms", "auteur": "Sam", "id": 11}]}
    assert contact.lire(brut)["dernier"]["auteur"] == "Sam"
    # Candidats d'un autre canal seulement (incohérence de base) : auteur inconnu, pas emprunté
    brut = {"sms": meme, "derniers": [{"canal": "email", "auteur": "Sam", "id": 1}]}
    assert contact.lire(brut)["dernier"] == {"canal": "sms", "date": meme, "auteur": None}


def test_poser_remplace_la_colonne_brute():
    row = {"id": 1, "statut": "En attente de pièce",
           "contact_brut": {"sms": "2026-10-17T10:00:00", "derniers": [{"canal": "sms", "auteur": "Léa", "id": 1}]}}
    d = contact.poser(row)
    assert "contact_brut" not in d and d["id"] == 1
    assert d["contact"]["dernier"] == {"canal": "sms", "date": "2026-10-17T10:00:00", "auteur": "Léa"}
    assert contact.poser({"id": 2})["contact"] == VIDE


def test_ligne_statut_au_format_de_change_status():
    """La ligne qui borne le contact : même texte que change_status (« Statut: X → Y — par Z »),
    précision facultative entre parenthèses avant « — par » ; historiser_statut l'écrit en type 'statut'."""
    assert contact.ligne_statut("En attente de pièce", "Pièce reçue", "Sophie") == \
        "Statut: En attente de pièce → Pièce reçue — par Sophie"
    ligne = contact.ligne_statut("Pré-enregistré", "En attente de diagnostic", "Léa", " (pré-enregistrement validé)")
    assert ligne == "Statut: Pré-enregistré → En attente de diagnostic (pré-enregistrement validé) — par Léa"
    assert ligne.startswith("Statut:")
    cur = MagicMock()
    assert contact.historiser_statut(cur, 7, "A", "B", "Auto", " (x)") == "Statut: A → B (x) — par Auto"
    sql, params = cur.execute.call_args.args
    assert sql.startswith("INSERT INTO historique") and "'statut'" in sql
    assert params == (7, "Statut: A → B (x) — par Auto")


def test_sql_fixe_sans_placeholder():
    """Texte SQL constant : utilisable avec des paramètres positionnels (%s) comme nommés, aucun
    « % » nu, index (ticket_id, type_note) utilisable, sms_echec jamais compté, anciennes relances
    comptées seulement si « Appel téléphonique »."""
    sql = contact.colonne_sql("t")
    assert "%" not in sql and sql.endswith("AS contact_brut") and sql.startswith(", (SELECT")
    assert "starts_with(h.contenu, 'Statut:')" in sql and "t.date_depot" in sql
    assert "n.ticket_id = t.id AND n.type_note IN ('sms', 'email', 'whatsapp', 'appel', 'relance')" in sql
    assert "(n.type_note <> 'relance' OR starts_with(n.contenu, 'Appel téléphonique'))" in sql
    assert "sms_echec" not in sql
    assert "ORDER BY" not in sql            # la file atelier découpe son SQL sur le premier ORDER BY
    for canal in ("sms", "email", "whatsapp"):
        assert f"FILTER (WHERE n.type_note = '{canal}')" in sql
    assert "FILTER (WHERE n.type_note IN ('appel', 'relance'))" in sql
    # Auteurs : les notes comptées à la toute dernière date, choisies en Python par canal
    assert "'derniers', (SELECT json_agg(json_build_object('canal', a.type_note, 'auteur', a.auteur, 'id', a.id))" in sql
    assert "a.date_creation = MAX(n.date_creation)" in sql
    assert contact.colonne_sql("x").count("x.id") == 3 and "t.id" not in contact.colonne_sql("x")


def test_modele_contact_request_et_ticket_full():
    assert ContactRequest(canal="appel").note is None
    assert ContactRequest(canal="appel", note="x").note == "x"
    with pytest.raises(Exception):
        ContactRequest(canal="appel", note="x" * 1001)
    assert TicketFull(id=1, contact=VIDE).contact == VIDE
    assert TicketFull(id=1).contact is None


def test_etagere_compte_le_canal_appel():
    assert "appel" in etagere.TYPES_RELANCE and "relance" in etagere.TYPES_RELANCE
    assert "'appel'" in etagere.relances_sql("fin", "t")
    assert etagere.canal_relance("appel", "Appel téléphonique — client contacté") == "Appel téléphonique"
    assert etagere.canal_relance("relance", "Appel téléphonique : pas de réponse") == "Appel téléphonique"
    assert etagere.canal_relance("relance", "Courrier") == "Relance"
    assert etagere.canal_relance("sms", "x") == "SMS"


# ═══ Routes (base simulée) ═════════════════════════════════════════

def _cursor(fetchone=None, fetchall=None):
    cur = MagicMock()
    cur.fetchone.return_value = fetchone
    cur.fetchall.return_value = fetchall or []

    @contextmanager
    def cm():
        yield cur
    return cur, cm


def test_post_contact_exige_un_jeton(client):
    assert client.post("/api/tickets/1/contact", json={"canal": "appel"}).status_code == 401


@pytest.mark.parametrize("canal", ["sms", "email", "whatsapp", "fax", ""])
def test_post_contact_refuse_les_autres_canaux(client, canal):
    cur, cm = _cursor(fetchone={"id": 1})
    with patch("app.api.tickets.get_cursor", cm):
        r = client.post("/api/tickets/1/contact", json={"canal": canal, "note": "x"}, headers=H)
    assert r.status_code == 422, r.text
    assert r.json()["detail"]["code"] == "canal_invalide"
    assert cur.execute.call_count == 0                       # rien n'est écrit


def test_post_contact_404_sans_ticket(client):
    cur, cm = _cursor(fetchone=None)
    with patch("app.api.tickets.get_cursor", cm):
        assert client.post("/api/tickets/999999/contact", json={"canal": "appel"}, headers=H).status_code == 404
    assert cur.execute.call_count == 1


def test_les_quatre_lectures_calculent_le_contact(client):
    """Fiche, dashboard, liste et file atelier : la colonne contact_brut dans la requête, l'objet
    contact dans la réponse (une seule requête de liste, sous-requête corrélée)."""
    rows = [{"id": 1, "ticket_code": "KP-000001", "statut": "En attente de pièce",
             "contact_brut": {"sms": "2026-10-17T10:00:00", "derniers": [{"canal": "sms", "auteur": "Léa", "id": 1}]}},
            {"id": 2, "ticket_code": "KP-000002", "statut": "En attente de pièce"}]
    cur, cm = _cursor(fetchone={"id": 1, "statut": "En attente de pièce",
                                "contact_brut": {"appel": "2026-10-17T11:00:00",
                                                 "derniers": [{"canal": "appel", "auteur": "Sophie", "id": 2}]}},
                      fetchall=rows)
    with patch("app.api.tickets.get_cursor", cm):
        fiche = client.get("/api/tickets/1", headers=H).json()
        assert "AS contact_brut" in cur.execute.call_args_list[0].args[0]
        assert fiche["contact"]["dernier"] == {"canal": "appel", "date": "2026-10-17T11:00:00", "auteur": "Sophie"}
        assert "contact_brut" not in fiche

        cur.execute.reset_mock()
        tickets_api._reception_absente_le = 0.0
        d = client.get("/api/tickets/stats/dashboard", headers=H).json()
        sql = cur.execute.call_args_list[1].args[0]
        assert sql.count("AS contact_brut") == 1 and "FROM tickets t" in sql
        # Une seule vérité : plus de EXISTS msg_* (toutes notes, sans borne de statut) dans la liste
        assert "msg_whatsapp" not in sql and "msg_sms" not in sql and "msg_email" not in sql
        assert d["tickets"][0]["contact"]["canaux"]["sms"] == "2026-10-17T10:00:00"
        assert d["tickets"][1]["contact"] == VIDE

        cur.execute.reset_mock()
        liste = client.get("/api/tickets", headers=H).json()
        sql = cur.execute.call_args.args[0]
        assert "AS contact_brut" in sql and "msg_sms" not in sql and "msg_whatsapp" not in sql
        assert liste[0]["contact"]["dernier"]["canal"] == "sms" and liste[1]["contact"] == VIDE

        cur.execute.reset_mock()
        file_ = client.get("/api/tickets/queue/repair", headers=H).json()
        sql = cur.execute.call_args.args[0]
        assert "AS contact_brut" in sql and "%" not in sql.replace("%s", "")
        assert file_[0]["contact"]["depuis_statut"] is True and file_[1]["contact"] == VIDE


# ═══ Base réelle ═══════════════════════════════════════════════════

DB_URL = os.getenv("KP_CONTACT_DATABASE_URL")
TEL = "0600000881"
TECH = "Contact-Pytest"
MASSE = "Contact-Pytest-Masse"


@pytest.fixture(scope="module")
def reel():
    if not DB_URL:
        pytest.skip("KP_CONTACT_DATABASE_URL non définie (base PostgreSQL de test jetable)")
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
                cur.execute("DELETE FROM fidelite_historique WHERE ticket_id IN"
                            " (SELECT id FROM tickets WHERE client_id IN (SELECT id FROM clients WHERE telephone = %s))", (TEL,))
                cur.execute("DELETE FROM tickets WHERE client_id IN (SELECT id FROM clients WHERE telephone = %s)", (TEL,))
                cur.execute("DELETE FROM clients WHERE telephone = %s", (TEL,))
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


def _ticket(reel, statut="En attente de diagnostic", depot_il_y_a="3 days", **kw):
    """Ticket inséré directement (date de dépôt antidatée en SQL : même horloge que les notes)."""
    t = {"client_id": reel["cid"], "categorie": "Smartphone", "marque": "Marque", "modele": "Contact",
         "panne": "Batterie", "statut": statut, "technicien_assigne": TECH, "paye": 0}
    t.update(kw)
    cols = list(t)
    with reel["cur"]() as cur:
        cur.execute(
            "INSERT INTO tickets ({}, date_depot) VALUES ({}, CURRENT_TIMESTAMP - %s::interval) RETURNING id".format(
                ", ".join(cols), ", ".join(["%s"] * len(cols))),
            [t[k] for k in cols] + [depot_il_y_a],
        )
        tid = cur.fetchone()["id"]
        cur.execute("UPDATE tickets SET ticket_code = %s WHERE id = %s", (f"KP-{tid:06d}", tid))
    return tid


def _note(reel, tid, type_note, il_y_a, contenu="x", auteur="Léa"):
    _sql(reel, "INSERT INTO notes_tickets (ticket_id, auteur, contenu, type_note, date_creation)"
               " VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP - %s::interval)", tid, auteur, contenu, type_note, il_y_a)


def _note_a(reel, tid, type_note, quand, contenu="x", auteur="Léa"):
    """Note à un horodatage explicite (plusieurs notes à la même seconde)."""
    _sql(reel, "INSERT INTO notes_tickets (ticket_id, auteur, contenu, type_note, date_creation)"
               " VALUES (%s, %s, %s, %s, %s)", tid, auteur, contenu, type_note, quand)


def _lignes_statut(reel, tid):
    return [r["contenu"] for r in _sql(reel, "SELECT contenu FROM historique WHERE ticket_id = %s"
                                            " AND starts_with(contenu, 'Statut:') ORDER BY id", tid)]


def _statut(reel, tid, il_y_a, ancien="En attente de diagnostic", nouveau="En attente de pièce"):
    _sql(reel, "INSERT INTO historique (ticket_id, type, contenu, date_creation)"
               " VALUES (%s, 'statut', %s, CURRENT_TIMESTAMP - %s::interval)",
         tid, f"Statut: {ancien} → {nouveau} — par Sophie", il_y_a)


def _date(reel, il_y_a):
    return _sql(reel, "SELECT CURRENT_TIMESTAMP - %s::interval AS d", il_y_a)[0]["d"].replace(tzinfo=None)


def _proche(iso, attendu, secondes=5):
    assert iso, iso
    return abs((datetime.fromisoformat(iso) - attendu).total_seconds()) < secondes


def _effacer(reel):
    for tech in (TECH, MASSE):
        _sql(reel, "DELETE FROM fidelite_historique WHERE ticket_id IN (SELECT id FROM tickets WHERE technicien_assigne = %s)", tech)
        _sql(reel, "DELETE FROM tickets WHERE technicien_assigne = %s", tech)


@pytest.fixture
def propre(reel):
    _effacer(reel)
    yield
    _effacer(reel)


def _lectures(reel, tid, vue="actifs"):
    """Le même objet contact sur les quatre lectures (fiche, dashboard, liste, file atelier)."""
    c = reel["c"]
    fiche = c.get(f"/api/tickets/{tid}", headers=H).json()["contact"]
    d = c.get("/api/tickets/stats/dashboard", headers=H, params={"vue": vue, "tech": TECH, "limit": 200}).json()
    dash = next(t for t in d["tickets"] if t["id"] == tid)["contact"]
    liste = next(t for t in c.get("/api/tickets", headers=H, params={"tel": TEL, "limit": 200}).json()
                 if t["id"] == tid)["contact"]
    assert fiche == dash == liste, (fiche, dash, liste)
    file_ = c.get("/api/tickets/queue/repair", headers=H, params={"tech": TECH, "limit": 50}).json()
    ligne = next((t for t in file_ if t["id"] == tid), None)
    if ligne is not None:
        assert ligne["contact"] == fiche
    return fiche


def test_contact_calcule_depuis_le_dernier_changement_de_statut(reel, propre):
    t1 = _ticket(reel, depot_il_y_a="3 days")
    _note(reel, t1, "sms", "2 days", "✅ SMS envoyé au 06 00 00 08 81 (1 SMS, Brevo)")   # AVANT le changement : pas compté
    _note(reel, t1, "appel", "2 days 1 hour", "Appel téléphonique — client contacté")  # idem
    _statut(reel, t1, "1 day")
    _note(reel, t1, "email", "12 hours", auteur="Sam")
    _note(reel, t1, "sms_echec", "6 hours", "⚠️ SMS NON envoyé")                        # jamais compté
    _note(reel, t1, "relance", "5 hours", "Appel téléphonique : pas de réponse", auteur="Sophie")   # ancien appel
    _note(reel, t1, "relance", "4 hours", "Relance par courrier")                       # ignorée
    _note(reel, t1, "note", "3 hours", "Note interne")                                  # ignorée
    _note(reel, t1, "message_client", "2 hours 30 minutes", "Message du client")       # ignorée
    _note(reel, t1, "whatsapp", "2 hours", auteur="Léa")

    c = _lectures(reel, t1)
    assert c["depuis_statut"] is True
    assert c["canaux"]["sms"] is None
    assert _proche(c["canaux"]["email"], _date(reel, "12 hours"))
    assert _proche(c["canaux"]["appel"], _date(reel, "5 hours"))
    assert _proche(c["canaux"]["whatsapp"], _date(reel, "2 hours"))
    assert c["dernier"]["canal"] == "whatsapp" and c["dernier"]["auteur"] == "Léa"
    assert c["dernier"]["date"] == c["canaux"]["whatsapp"]
    assert set(c) == {"depuis_statut", "dernier", "canaux"} and set(c["canaux"]) == {"sms", "email", "whatsapp", "appel"}

    # Sans changement de statut : depuis le dépôt (un SMS avant le dépôt n'existe pas, mais une
    # note antidatée ne compte pas)
    t2 = _ticket(reel, depot_il_y_a="2 days")
    _note(reel, t2, "sms", "3 days")
    _note(reel, t2, "sms", "1 hour", auteur="Sam")
    c = _lectures(reel, t2)
    assert c["canaux"]["email"] is None and c["canaux"]["appel"] is None and c["canaux"]["whatsapp"] is None
    assert _proche(c["canaux"]["sms"], _date(reel, "1 hour"))
    assert c["dernier"] == {"canal": "sms", "date": c["canaux"]["sms"], "auteur": "Sam"}

    # Jamais contacté
    t3 = _ticket(reel)
    _note(reel, t3, "note", "1 hour")
    _note(reel, t3, "sms_echec", "30 minutes")
    assert _lectures(reel, t3) == VIDE

    # Deux changements : seul le dernier compte
    t4 = _ticket(reel, depot_il_y_a="5 days")
    _statut(reel, t4, "4 days")
    _note(reel, t4, "sms", "3 days")
    _statut(reel, t4, "2 days", "En attente de pièce", "Pièce reçue")
    assert _lectures(reel, t4) == VIDE
    _note(reel, t4, "email", "1 day")
    assert _lectures(reel, t4)["dernier"]["canal"] == "email"


def test_vue_a_recuperer_porte_le_contact(reel, propre):
    tid = _ticket(reel, statut="Réparation terminée", depot_il_y_a="10 days", devis_estime=89)
    _statut(reel, tid, "5 days", "En cours de réparation", "Réparation terminée")
    _note(reel, tid, "sms", "6 days")                     # pendant la réparation : ni contact ni relance
    _note(reel, tid, "whatsapp", "4 days", auteur="Léa")  # message « prêt »
    c = reel["c"]
    d = c.get("/api/tickets/stats/dashboard", headers=H, params={"vue": "a_recuperer", "tech": TECH}).json()
    t = next(x for x in d["tickets"] if x["id"] == tid)
    assert t["nb_relances"] == 1 and t["contact"]["dernier"]["canal"] == "whatsapp"
    assert t["contact"]["canaux"]["sms"] is None
    assert t["contact"] == _lectures(reel, tid, vue="a_recuperer")


def test_post_contact_note_l_appel(reel, propre):
    c = reel["c"]
    tid = _ticket(reel)
    avant = _date(reel, "0 seconds")
    r = c.post(f"/api/tickets/{tid}/contact", headers=H, json={"canal": "appel", "note": "  Pas de  réponse, rappelle demain "})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"contact", "note_id"} and isinstance(body["note_id"], int)
    assert body["contact"]["depuis_statut"] is True
    assert body["contact"]["dernier"]["canal"] == "appel" and body["contact"]["dernier"]["auteur"] == "Sophie"
    assert body["contact"]["dernier"]["date"] == body["contact"]["canaux"]["appel"]
    assert datetime.fromisoformat(body["contact"]["canaux"]["appel"]) >= avant.replace(microsecond=0)
    note = _sql(reel, "SELECT ticket_id, auteur, contenu, important, type_note FROM notes_tickets WHERE id = %s", body["note_id"])[0]
    assert note == {"ticket_id": tid, "auteur": "Sophie", "important": False, "type_note": "appel",
                    "contenu": "Appel téléphonique — client contacté : Pas de réponse, rappelle demain"}
    # Les quatre lectures voient l'appel ; la liste des notes de la fiche aussi
    assert _lectures(reel, tid) == body["contact"]
    notes = c.get(f"/api/tickets/{tid}/notes", headers=H).json()
    assert notes[0]["id"] == body["note_id"] and notes[0]["type_note"] == "appel"

    # Sans note : texte nu ; note vide ou blanche : idem
    for corps in ({"canal": "appel"}, {"canal": "appel", "note": ""}, {"canal": "appel", "note": "   "}):
        r = c.post(f"/api/tickets/{tid}/contact", headers=H, json=corps)
        assert r.status_code == 200, r.text
        contenu = _sql(reel, "SELECT contenu FROM notes_tickets WHERE id = %s", r.json()["note_id"])[0]["contenu"]
        assert contenu == "Appel téléphonique — client contacté"
    assert _sql(reel, "SELECT count(*) AS n FROM notes_tickets WHERE ticket_id = %s AND type_note = 'appel'", tid)[0]["n"] == 4

    # Autre canal : 422 et rien d'écrit ; sans jeton : 401 ; ticket inconnu : 404
    r = c.post(f"/api/tickets/{tid}/contact", headers=H, json={"canal": "sms", "note": "x"})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "canal_invalide"
    assert _sql(reel, "SELECT count(*) AS n FROM notes_tickets WHERE ticket_id = %s", tid)[0]["n"] == 4
    assert c.post(f"/api/tickets/{tid}/contact", json={"canal": "appel"}).status_code == 401
    assert c.post("/api/tickets/999999999/contact", headers=H, json={"canal": "appel"}).status_code == 404


def test_changement_de_statut_remet_le_contact_a_zero(reel, propre):
    c = reel["c"]
    tid = _ticket(reel)
    assert c.post(f"/api/tickets/{tid}/contact", headers=H, json={"canal": "appel"}).status_code == 200
    assert _lectures(reel, tid)["dernier"]["canal"] == "appel"
    r = c.patch(f"/api/tickets/{tid}/statut", headers=H, json={"statut": "En attente de pièce"})
    assert r.status_code == 200, r.text
    assert _lectures(reel, tid) == VIDE
    # Message tracé après le changement (message-log de la fiche) : contacté de nouveau
    r = c.post(f"/api/tickets/{tid}/message-log", headers=H,
               params={"auteur": "Sam", "contenu": "Votre pièce est commandée", "canal": "sms"})
    assert r.status_code == 200, r.text
    ct = _lectures(reel, tid)
    assert ct["dernier"]["canal"] == "sms" and ct["dernier"]["auteur"] == "Sam"
    assert ct["canaux"]["appel"] is None
    # La fiche renvoyée par un PATCH porte le même objet
    assert c.patch(f"/api/tickets/{tid}", headers=H, json={"notes_internes": "x"}).json()["ticket"]["contact"] == ct


def test_egalite_d_horodatage_sur_base_reelle(reel, propre):
    """SMS de Léa et appel de Nour à la même seconde : dernier = appel par Nour (jamais « appel
    par Léa »), les deux canaux allumés à la même date."""
    tid = _ticket(reel)
    quand = _date(reel, "1 hour")
    _note_a(reel, tid, "sms", quand, "✅ SMS envoyé", auteur="Léa")
    _note_a(reel, tid, "appel", quand, "Appel téléphonique — client contacté", auteur="Nour")
    c = _lectures(reel, tid)
    assert c["dernier"]["canal"] == "appel" and c["dernier"]["auteur"] == "Nour"
    assert c["canaux"]["sms"] == c["canaux"]["appel"] == c["dernier"]["date"]
    # Même canal à la même seconde : la note la plus récente
    quand = _date(reel, "30 minutes")
    _note_a(reel, tid, "whatsapp", quand, auteur="Sam")
    _note_a(reel, tid, "whatsapp", quand, auteur="Léa")
    c = _lectures(reel, tid)
    assert c["dernier"]["canal"] == "whatsapp" and c["dernier"]["auteur"] == "Léa"


def test_les_changements_de_statut_automatiques_bornent_le_contact(reel, propre):
    """Les chemins qui changent le statut hors de change_status écrivent la même ligne
    « Statut: X → Y — par Z » : un SMS envoyé AVANT ne reste pas affiché « contacté » après."""
    c = reel["c"]

    # 1) Commande de pièce automatique (dépôt, sans jeton) → En attente de pièce
    # (sans session : seulement le ticket que la borne vient de créer)
    tid = _ticket(reel, depot_il_y_a="2 minutes", suivi_token="JetonContact_0123456789")
    _note(reel, tid, "sms", "1 minute", "✅ SMS envoyé (reçu du dépôt)")
    assert _lectures(reel, tid)["dernier"]["canal"] == "sms"
    r = c.post("/api/parts/auto", json={"ticket_id": tid, "description": "Écran", "fournisseur": "LCD",
                                         "t": "JetonContact_0123456789"})
    assert r.status_code == 200, r.text
    piece = r.json()["id"]
    assert _sql(reel, "SELECT statut FROM tickets WHERE id = %s", tid)[0]["statut"] == "En attente de pièce"
    assert _lignes_statut(reel, tid) == ["Statut: En attente de diagnostic → En attente de pièce (pièce commandée) — par Auto"]
    assert _lectures(reel, tid) == VIDE

    # SMS « pièce commandée » après : contacté
    r = c.post(f"/api/tickets/{tid}/message-log", headers=H,
               params={"auteur": "Léa", "contenu": "Votre pièce est commandée", "canal": "sms"})
    assert r.status_code == 200, r.text
    assert _lectures(reel, tid)["dernier"]["canal"] == "sms"

    # 2) Réception de la pièce (PATCH /api/parts) → Pièce reçue : le client n'a PAS été prévenu
    r = c.patch(f"/api/parts/{piece}", headers=H, json={"statut": "Reçu"})
    assert r.status_code == 200, r.text
    assert _sql(reel, "SELECT statut FROM tickets WHERE id = %s", tid)[0]["statut"] == "Pièce reçue"
    assert _lignes_statut(reel, tid)[-1] == "Statut: En attente de pièce → Pièce reçue (pièce reçue) — par Sophie"
    assert _lectures(reel, tid) == VIDE
    # Une seconde réception sur le même ticket (déjà « Pièce reçue ») ne réécrit pas de ligne.
    # Seconde commande : par le personnel (sans session, /auto n'accepte que le ticket neuf)
    r = c.post("/api/parts/auto", headers=H, json={"ticket_id": tid, "description": "Batterie"})
    piece2 = r.json()["id"]
    assert _lignes_statut(reel, tid)[-1] == "Statut: Pièce reçue → En attente de pièce (pièce commandée) — par Sophie"
    assert c.patch(f"/api/tickets/{tid}/statut", headers=H, json={"statut": "En cours de réparation"}).status_code == 200
    n = len(_lignes_statut(reel, tid))
    assert c.patch(f"/api/parts/{piece2}", headers=H, json={"statut": "Reçu"}).status_code == 200
    assert len(_lignes_statut(reel, tid)) == n                     # statut inchangé : pas de ligne
    assert _sql(reel, "SELECT statut FROM tickets WHERE id = %s", tid)[0]["statut"] == "En cours de réparation"

    # 3) Devis accepté par le client en ligne (lien de suivi) → En cours de réparation
    tid = _ticket(reel, statut="En attente d'accord client", suivi_token="JetonPytest_0123456789", devis_estime=89)
    _note(reel, tid, "sms", "1 hour", "✅ SMS envoyé (devis)")
    assert _lectures(reel, tid)["dernier"]["canal"] == "sms"
    with patch("app.api.suivi.push_notification", lambda **k: None):
        r = c.post(f"/api/suivi/KP-{tid:06d}/valider-devis", json={"accepte": True, "t": "JetonPytest_0123456789"})
    assert r.status_code == 200, r.text
    assert _sql(reel, "SELECT statut FROM tickets WHERE id = %s", tid)[0]["statut"] == "En cours de réparation"
    assert _lignes_statut(reel, tid) == \
        ["Statut: En attente d'accord client → En cours de réparation (devis accepté en ligne) — par Client"]
    assert _lectures(reel, tid) == VIDE

    # 4) Pré-enregistrement validé / refusé (borne à distance)
    tid = _ticket(reel, statut="Pré-enregistré", source="distance")
    _note(reel, tid, "email", "1 hour", "E-mail de confirmation")
    assert _lectures(reel, tid, vue="tous")["dernier"]["canal"] == "email"      # « tous » : aucun filtre de statut
    r = c.put(f"/api/depot-distance/{tid}/valider", headers=H)
    assert r.status_code == 200, r.text
    assert _lignes_statut(reel, tid) == \
        ["Statut: Pré-enregistré → En attente de diagnostic (pré-enregistrement validé) — par Sophie"]
    assert _lectures(reel, tid) == VIDE
    tid = _ticket(reel, statut="Pré-enregistré", source="distance")
    r = c.put(f"/api/depot-distance/{tid}/refuser", headers=H, json={"motif": "Hors zone"})
    assert r.status_code == 200, r.text
    assert _lignes_statut(reel, tid) == \
        ["Statut: Pré-enregistré → Clôturé (pré-enregistrement refusé : Hors zone) — par Sophie"]
    assert _sql(reel, "SELECT statut FROM tickets WHERE id = %s", tid)[0]["statut"] == "Clôturé"


def test_etagere_compte_les_appels(reel, propre):
    c = reel["c"]
    tid = _ticket(reel, statut="Réparation terminée", depot_il_y_a="100 days", devis_estime=89)
    _statut(reel, tid, "95 days", "En cours de réparation", "Réparation terminée")
    _note(reel, tid, "relance", "40 days", "Appel téléphonique : pas de réponse")   # ancien appel : toujours lu
    _note(reel, tid, "relance", "30 days", "Courrier simple")                       # ancienne relance : comptée
    vue = lambda: next(t for t in c.get("/api/tickets/stats/dashboard", headers=H,
                                        params={"vue": "a_recuperer", "tech": TECH}).json()["tickets"] if t["id"] == tid)
    assert vue()["nb_relances"] == 2

    r = c.post(f"/api/tickets/{tid}/contact", headers=H, json={"canal": "appel", "note": "Rappelé"})
    assert r.status_code == 200
    t = vue()
    assert t["nb_relances"] == 3 and t["derniere_relance"] == r.json()["contact"]["canaux"]["appel"]
    assert t["relance_due"] is False
    # Le contact ne retient que les appels (les anciennes relances non téléphoniques sont ignorées)
    assert t["contact"]["canaux"] == {"sms": None, "email": None, "whatsapp": None, "appel": t["derniere_relance"]}

    # Relance d'étagère par téléphone : note 'appel' (plus 'relance'), même compteur
    r = c.post(f"/api/etagere/{tid}/relance", headers=H, json={"canal": "appel", "contenu": "Message laissé"})
    assert r.status_code == 200 and r.json()["nb_relances"] == 4
    note = _sql(reel, "SELECT type_note, contenu FROM notes_tickets WHERE ticket_id = %s ORDER BY id DESC LIMIT 1", tid)[0]
    assert note == {"type_note": "appel", "contenu": "Appel téléphonique : Message laissé"}
    assert vue()["contact"]["dernier"]["canal"] == "appel"
    # Le courrier de mise en demeure liste les appels, anciens et nouveaux
    html = c.get(f"/api/etagere/{tid}/mise-en-demeure", headers=H).text
    assert html.count("<td>Appel téléphonique</td>") == 3 and "Malgré nos 4 messages et relances" in html
    # L'appel de l'étagère sans texte
    r = c.post(f"/api/etagere/{tid}/relance", headers=H, json={"canal": "appel"})
    assert r.json()["nb_relances"] == 5
    assert _sql(reel, "SELECT contenu FROM notes_tickets WHERE ticket_id = %s ORDER BY id DESC LIMIT 1", tid)[0]["contenu"] \
        == "Appel téléphonique"


class _Espion:
    """Curseur réel qui journalise les requêtes exécutées."""

    def __init__(self, cur, journal):
        self._cur, self._journal = cur, journal

    def execute(self, sql, params=None):
        self._journal.append((sql, params))
        return self._cur.execute(sql, params)

    def __getattr__(self, nom):
        return getattr(self._cur, nom)


def _plan_noeuds(noeud, out):
    out.append(noeud)
    for sous in noeud.get("Plans", []):
        _plan_noeuds(sous, out)
    return out


def test_mille_tickets_une_seule_requete_par_les_index(reel, propre, monkeypatch):
    """1 000 tickets fictifs, chacun avec un changement de statut et des notes : le dashboard reste
    à 3 requêtes (KPI, liste, total) et les sous-requêtes du contact passent par les index
    idx_notes_tickets_type (ticket_id, type_note) et idx_historique_ticket_id."""
    _sql(reel, """INSERT INTO tickets (client_id, categorie, marque, modele, panne, statut, technicien_assigne,
                                       ticket_code, paye, date_depot)
                  SELECT %s, 'Smartphone', 'Marque', 'Masse ' || g, 'Batterie', 'En attente de diagnostic', %s,
                         'PYT-' || lpad(g::text, 6, '0'), 0, CURRENT_TIMESTAMP - (g || ' minutes')::interval
                  FROM generate_series(1, 1000) g""", reel["cid"], MASSE)
    _sql(reel, """INSERT INTO historique (ticket_id, type, contenu, date_creation)
                  SELECT id, 'statut', 'Statut: Pré-enregistré → En attente de diagnostic — par Sophie',
                         date_depot + interval '1 minute'
                  FROM tickets WHERE technicien_assigne = %s""", MASSE)
    _sql(reel, """INSERT INTO notes_tickets (ticket_id, auteur, contenu, type_note, date_creation)
                  SELECT id, 'Léa', 'x', (ARRAY['sms', 'note', 'whatsapp', 'sms_echec'])[1 + id %% 4],
                         date_depot + interval '2 minutes'
                  FROM tickets WHERE technicien_assigne = %s
                  UNION ALL
                  SELECT id, 'Sam', 'Appel téléphonique : x', (ARRAY['relance', 'email', 'appel'])[1 + id %% 3],
                         date_depot + interval '3 minutes'
                  FROM tickets WHERE technicien_assigne = %s""", MASSE, MASSE)
    _sql(reel, "ANALYZE tickets")
    _sql(reel, "ANALYZE notes_tickets")
    _sql(reel, "ANALYZE historique")

    journal = []

    @contextmanager
    def espion():
        with reel["cur"]() as cur:
            yield _Espion(cur, journal)
    monkeypatch.setattr(tickets_api, "get_cursor", espion)

    c = reel["c"]
    r = c.get("/api/tickets/stats/dashboard", headers=H, params={"tech": MASSE, "vue": "actifs", "limit": 200})
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["tickets"]) == 200 and body["total"] == 1000
    assert len(journal) == 3                                   # KPI, liste, COUNT : jamais une requête par ticket
    liste_sql, liste_params = next((s, p) for s, p in journal if "contact_brut" in s)
    assert all(t["contact"]["depuis_statut"] is True for t in body["tickets"])
    # Seconde note (+3 min) toujours la dernière : relance « Appel téléphonique » → appel, email, appel
    assert {t["contact"]["dernier"]["canal"] for t in body["tickets"]} == {"email", "appel"}
    assert {k for t in body["tickets"] for k, v in t["contact"]["canaux"].items() if v} == {"sms", "whatsapp", "email", "appel"}
    assert all("sms_echec" not in json.dumps(t["contact"]) for t in body["tickets"])

    with reel["cur"]() as cur:
        cur.execute("EXPLAIN (ANALYZE, FORMAT JSON) " + liste_sql, liste_params)
        plan = cur.fetchone()["QUERY PLAN"][0]
    noeuds = _plan_noeuds(plan["Plan"], [])
    sur_notes = [n for n in noeuds if n.get("Relation Name") == "notes_tickets"]
    sur_hist = [n for n in noeuds if n.get("Relation Name") == "historique"]
    assert sur_notes and sur_hist
    # Sous-plans corrélés (une seule instruction SQL), jamais un parcours complet des notes ni de
    # l'historique par ticket : accès (Bitmap) Index Scan par les index existants
    assert all(n["Node Type"] != "Seq Scan" for n in sur_notes + sur_hist), [n["Node Type"] for n in sur_notes + sur_hist]
    index = {n.get("Index Name") for n in noeuds if n.get("Index Name")}
    assert index & {"idx_notes_tickets_type", "idx_notes_tickets_ticket_id"}
    assert "idx_historique_ticket_id" in index
    assert plan["Execution Time"] < 2000

    # La file atelier et la liste restent à une requête chacune
    journal.clear()
    assert len(c.get("/api/tickets/queue/repair", headers=H, params={"tech": MASSE, "limit": 50}).json()) == 50
    assert len(journal) == 1
    journal.clear()
    assert len(c.get("/api/tickets", headers=H, params={"statut": "En attente de diagnostic", "limit": 500}).json()) >= 500
    assert len(journal) == 1
