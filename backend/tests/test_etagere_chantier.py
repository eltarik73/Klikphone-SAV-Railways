"""Chantier étagère : emplacement physique, relances graduées (compteur, palier dû, message),
délai légal d'abandon (loi du 31/12/1903 : un an, vente sur autorisation du juge),
courrier de mise en demeure.

Les tests purs tournent toujours. Ceux sur base réelle exigent la même base PostgreSQL
JETABLE que tests/test_fiche.py (KP_FICHE_DATABASE_URL).
"""

import inspect
from datetime import date, datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from app.api import tickets as tickets_api
from app.api.etagere import EmplacementIn, RelanceIn, html_mise_en_demeure
from app.services import etagere
from app.services import params as params_cache
from app.services.notifications import generer_message
from app.services.search import SqlParams
from tests.test_fiche import H, LIGNES_120, _sql, _ticket, reel  # noqa: F401 (fixture)

FIN = datetime(2026, 9, 1, 10, 0)            # naïf UTC, comme la base


def _a(jours, base=FIN):
    return base + timedelta(days=jours)


# ─── Emplacement ───────────────────────────────────────────────

@pytest.mark.parametrize("saisie, stocke", [
    (" b3 ", "B3"), ("étagère   2", "ÉTAGÈRE 2"), ("A" * 20, "A" * 20),
    ("", None), ("   ", None), (None, None),
])
def test_emplacement_normalise(saisie, stocke):
    assert etagere.normaliser_emplacement(saisie) == stocke
    assert EmplacementIn(emplacement=saisie).emplacement == stocke


@pytest.mark.parametrize("saisie", ["A" * 21, "B\x003", "B\n3x" + "y" * 30])
def test_emplacement_refuse(saisie):
    with pytest.raises(ValidationError):
        EmplacementIn(emplacement=saisie)


@pytest.mark.parametrize("statut, emplacement, set_, ligne", [
    ("Rendu au client", "B3", {"emplacement": None}, "Emplacement B3 libéré"),
    ("Clôturé", "B3", {"emplacement": None}, "Emplacement B3 libéré"),
    ("Rendu au client", None, {}, None),                  # pas rangé : rien à écrire
    ("Clôturé", "", {}, None),
    ("En cours de réparation", "B3", {}, None),           # reste rangé hors restitution
    ("Réparation terminée", "B3", {}, None),
])
def test_liberer_emplacement_a_la_restitution(statut, emplacement, set_, ligne):
    textes = ["Statut: Réparation terminée → Rendu au client"]
    assert etagere.liberer_emplacement({"emplacement": emplacement}, statut, textes) == set_
    assert textes[1:] == ([ligne] if ligne else [])


def test_liberer_emplacement_colonne_absente():
    # SELECT * d'une base où la migration a échoué : pas de clé, pas de SET
    textes = []
    assert etagere.liberer_emplacement({"statut": "Réparation terminée"}, "Clôturé", textes) == {} and textes == []


def test_emplacements_proposes_depuis_le_parametre():
    assert etagere.lire_emplacements(" b1, A2 ,b1,, " + "X" * 25 + ", étagère 3") == ["B1", "A2", "ÉTAGÈRE 3"]
    assert etagere.lire_emplacements("") == [] and etagere.lire_emplacements(None) == []


# ─── Paramètres : paliers et délai d'abandon ───────────────────

@pytest.mark.parametrize("valeur, paliers", [
    (None, [3, 10, 30, 90, 180, 330]),          # absent : défaut
    ("", []),                                    # liste vidée exprès : aucune relance due
    ("30, 3,10;3", [3, 10, 30]),
    ("5, abc", [5]),
    ("abc", [3, 10, 30, 90, 180, 330]),          # illisible : défaut
    ("0,-4,99999", [3, 10, 30, 90, 180, 330]),
])
def test_paliers(valeur, paliers):
    assert etagere.lire_paliers(valeur) == paliers


@pytest.mark.parametrize("valeur, delai", [(None, 365), ("", 365), ("abc", 365), ("0", 365),
                                           ("-3", 365), ("730", 730), (" 400 ", 400), ("3650", 3650),
                                           ("3651", 365),
                                           # Jamais moins d'un an (loi du 31/12/1903), même posé en SQL
                                           ("30", 365), ("90", 365), ("364", 365), ("365", 365)])
def test_delai_abandon(valeur, delai):
    assert etagere.lire_delai_abandon(valeur) == delai


def test_delai_par_defaut_un_an():
    assert etagere.DELAI_ABANDON_JOURS == 365
    assert etagere.delai_abandon_jours() == 365      # base simulée : aucun paramètre


# ─── Relance due ───────────────────────────────────────────────

@pytest.mark.parametrize("jours, derniere, due", [
    (2, None, False),            # palier J+3 pas atteint
    (3, None, True),
    (45, None, True),            # paliers sautés : une seule relance suffit
    (3, 0, True),                # message « prêt » à J+0 : ne couvre pas J+3
    (4, 2, False),               # relance à J+2 il y a 2 jours
    (5, 2, True),
    (9, 4, False),               # J+4 couvre J+3, prochain palier J+10
    (10, 4, True),
    (10, 9, False),              # palier atteint mais relancé il y a 1 jour
    (12, 9, True),
    (45, 31, False),             # J+31 couvre J+30, prochain J+90
    (90, 31, True),
    (400, 330, False),           # plus aucun palier : place au courrier
])
def test_relance_due_selon_les_paliers(jours, derniere, due):
    paliers = etagere.lire_paliers(None)
    maintenant = _a(jours).replace(tzinfo=timezone.utc)
    d = None if derniere is None else _a(derniere)
    assert etagere.relance_due(jours, FIN, d, paliers, maintenant) is due


def test_relance_jamais_due_sans_palier_ni_fin():
    assert etagere.relance_due(45, FIN, None, [], _a(45)) is False
    assert etagere.relance_due(None, None, None, [3], _a(45)) is False


def test_enrichir_relances():
    maintenant = _a(45).replace(tzinfo=timezone.utc)
    rows = etagere.enrichir([
        {"id": 1, "statut": "Réparation terminée", "fin_reparation": FIN, "nb_relances": 2,
         "derniere_relance": _a(4), "emplacement": "B3"},
        {"id": 2, "statut": "Rendu au client", "fin_reparation": FIN, "reparation_supp": LIGNES_120,
         "emplacement": "C1"},                   # rendu impayé : plus sur l'étagère
    ], maintenant, paliers=[3, 10, 30])
    assert [(r["emplacement"], r["nb_relances"], r["relance_due"]) for r in rows] == [("B3", 2, True), (None, 0, False)]
    assert rows[1]["derniere_relance"] is None and rows[1]["reste_du"] == 120


def test_colonnes_sql_sans_n_plus_1():
    sp = SqlParams()
    sql = etagere.colonnes_sql(sp, "t")
    assert "AS fin_reparation" in sql and "AS nb_relances" in sql and "AS derniere_relance" in sql
    assert sql.count("n.ticket_id = t.id") == 2 and "'relance'" in sql
    assert list(sp.values.values()) == ["%→ Réparation terminée%"]     # motif LIKE en paramètre


# ─── Message de relance par palier ─────────────────────────────

TICKET = {"ticket_code": "KP-000321", "marque": "Apple", "modele": "iPhone 12"}
CLIENT = {"prenom": "Léa"}


@pytest.mark.parametrize("jours, attendu, absent", [
    (3, "Petit rappel : votre Apple iPhone 12 est prêt et vous attend chez Klikphone depuis 3 jours.", "1903"),
    (10, "depuis 10 jours", "1903"),
    (30, "est prêt depuis 30 jours et n'a toujours pas été récupéré", "Petit rappel"),
    (89, "KP-000321", "1903"),
    (90, "loi du 31 décembre 1903", "Petit rappel"),
    (200, "uniquement sur autorisation du juge", "Petit rappel"),
])
def test_message_relance_par_palier(jours, attendu, absent):
    msg = generer_message("relance", TICKET, CLIENT, jours=jours)
    assert attendu in msg and absent not in msg
    assert msg.startswith("Bonjour Léa,") and "{" not in msg and "Lundi-Samedi 10h-19h" in msg
    assert "📍 79 Place Saint Léger, 73000 Chambéry\n" in msg and msg.count("Chambéry") == 1


@pytest.mark.parametrize("jours, attendu", [(None, "depuis plusieurs jours"), (1, "depuis 1 jour."),
                                            (0, "depuis quelques heures")])
def test_message_relance_jours_inconnus_ou_courts(jours, attendu):
    assert attendu in generer_message("relance", TICKET, CLIENT, jours=jours)


def test_message_relance_jours_de_la_vue_etagere():
    assert "depuis 12 jours" in generer_message("relance", {**TICKET, "jours_attente": 12}, CLIENT)


def test_autres_modeles_inchanges():
    msg = generer_message("appareil_pret", {**TICKET, "devis_estime": 80}, CLIENT)
    assert "Votre Apple iPhone 12 est réparé" in msg and "80,00€" in msg
    # Adresse remplacée en une passe : jamais « 73000 Chambéry, 73000 Chambéry »
    assert "📍 Klikphone - 79 Place Saint Léger, 73000 Chambéry\n" in msg and msg.count("Chambéry") == 1


# ─── Relance tracée : validation ───────────────────────────────

def test_relance_canal_valide():
    assert RelanceIn(canal="appel").contenu == ""
    with pytest.raises(ValidationError):
        RelanceIn(canal="pigeon", contenu="x")


def test_routes_exigent_une_session(client):
    for methode, url in [("get", "/api/etagere/config"), ("put", "/api/etagere/1/emplacement"),
                         ("post", "/api/etagere/1/relance"), ("get", "/api/etagere/1/message-relance"),
                         ("get", "/api/etagere/1/mise-en-demeure")]:
        assert getattr(client, methode)(url).status_code == 401, url


# ─── Mise en demeure : gabarit ─────────────────────────────────

BOUTIQUE = {"nom": "Klik <b>phone</b>", "adresse": "79 Place Saint-Léger, 73000 Chambéry",
            "tel": "04 79 60 89 22", "email": "contact@exemple.invalid", "siret": "123 456 789 00010",
            "horaires": "Lundi-Samedi 10h-19h"}


def _ticket_mise_en_demeure(**extra):
    t = {"id": 9, "ticket_code": "KP-000009", "marque": "Samsung", "modele": "Galaxy <S21>",
         "imei": "356789012345678", "statut": "Réparation terminée", "reparation_supp": LIGNES_120,
         "acompte": 20, "date_depot": datetime(2026, 5, 2, 9), "fin_reparation": datetime(2026, 6, 1, 15),
         "client": {"nom": "<script>alert(1)</script>", "prenom": "Jean & Co",
                    "adresse": "12 rue <i>des Lilas</i>", "code_postal": "73000", "ville": "Chambéry"}}
    t.update(extra)
    return t


def test_mise_en_demeure_echappe_et_complete():
    relances = [{"date_creation": datetime(2026, 6, 4, 9), "type_note": "sms", "contenu": "x"},
                {"date_creation": datetime(2026, 7, 1, 9), "type_note": "relance",
                 "contenu": "Appel téléphonique : pas de réponse"},
                {"date_creation": datetime(2026, 9, 1, 9), "type_note": "email", "contenu": "<b>y</b>"}]
    html = html_mise_en_demeure(_ticket_mise_en_demeure(), relances, BOUTIQUE, 137,
                                aujourdhui=datetime(2026, 10, 16, 10, tzinfo=timezone.utc))
    assert "<script>" not in html and "&lt;script&gt;alert(1)&lt;/script&gt;" in html
    assert "Jean &amp; Co" in html and "12 rue &lt;i&gt;des Lilas&lt;/i&gt;" in html and "73000 Chambéry" in html
    assert "Klik &lt;b&gt;phone&lt;/b&gt;" in html and "SIRET : 123 456 789 00010" in html
    assert "contact@exemple.invalid" in html and "04 79 60 89 22" in html
    assert "Galaxy &lt;S21&gt;" in html and "KP-000009" in html and "356789012345678" in html
    assert "2 mai 2026" in html and "1er juin 2026" in html and "Fait à Chambéry, le 16 octobre 2026" in html
    assert "100,00 €" in html and "<strong>15 jours</strong>" in html
    assert "4 juin 2026" in html and "Appel téléphonique" in html and "E-mail" in html and "SMS" in html
    assert "Malgré nos 3 messages et relances (voir ci-dessous)" in html
    assert "loi du 31 décembre 1903" in html and "uniquement sur autorisation du juge" in html
    assert "Signature et cachet" in html and "@media print" in html and "script-src 'none'" in html
    assert "&lt;b&gt;y&lt;/b&gt;" not in html          # contenu des messages jamais recopié


def test_mise_en_demeure_sans_relance_ni_reste_du():
    t = _ticket_mise_en_demeure(paye=1, client={"nom": "Durand"})
    html = html_mise_en_demeure(t, [], {**BOUTIQUE, "email": "", "siret": ""}, 95)
    assert "Aucune relance enregistrée" in html and "il n'a toujours pas été retiré" in html
    assert "régler à cette occasion" not in html and "SIRET" not in html and "0,00 €" in html
    une = [{"date_creation": datetime(2026, 6, 4, 9), "type_note": "whatsapp", "contenu": "x"}]
    assert "Malgré notre message du 4 juin 2026, il n'a toujours" in html_mise_en_demeure(t, une, BOUTIQUE, 95)


# ═══ Base réelle ═══════════════════════════════════════════════

TECH = "Etagere-Chantier"


def _aujourdhui_paris(reel) -> date:
    return _sql(reel, "SELECT (NOW() AT TIME ZONE 'Europe/Paris')::date AS d")[0]["d"]


def _il_y_a(reel, jours) -> datetime:
    """10:00 UTC du jour de Chambéry d'il y a `jours` jours (aucun passage de minuit)."""
    d = _aujourdhui_paris(reel) - timedelta(days=jours)
    return datetime(d.year, d.month, d.day, 10, 0)


def _termine_il_y_a(reel, jours, **kw) -> int:
    tid = _ticket(reel, technicien_assigne=TECH, **kw)
    _sql(reel, "INSERT INTO historique (ticket_id, type, contenu, date_creation) VALUES (%s, 'statut', %s, %s)",
         tid, "Statut: En cours de réparation → Réparation terminée — par Sophie", _il_y_a(reel, jours))
    return tid


def _note(reel, tid, type_note, quand, contenu="message"):
    _sql(reel, "INSERT INTO notes_tickets (ticket_id, auteur, contenu, type_note, date_creation)"
               " VALUES (%s, 'Sophie', %s, %s, %s)", tid, contenu, type_note, quand)


def _vue(c):
    r = c.get("/api/tickets/stats/dashboard", params={"vue": "a_recuperer", "tech": TECH}, headers=H)
    assert r.status_code == 200, r.text
    return r.json()


def _param(reel, cle, valeur):
    if valeur is None:
        _sql(reel, "DELETE FROM params WHERE cle = %s", cle)
    else:
        _sql(reel, "INSERT INTO params (cle, valeur) VALUES (%s, %s)"
                   " ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur", cle, valeur)
    params_cache.invalidate()


@pytest.fixture
def params_reels(reel):
    """Écrit des paramètres pour un test et remet les valeurs d'avant ensuite."""
    avant = {}

    def ecrire(cle, valeur):
        if cle not in avant:
            rows = _sql(reel, "SELECT valeur FROM params WHERE cle = %s", cle)
            avant[cle] = rows[0]["valeur"] if rows else None
        _param(reel, cle, valeur)
    yield ecrire
    for cle, valeur in avant.items():
        _param(reel, cle, valeur)


def _effacer(reel):
    # Points crédités par une restitution réglée : la ligne de fidélité référence le ticket
    _sql(reel, "DELETE FROM fidelite_historique WHERE ticket_id IN"
               " (SELECT id FROM tickets WHERE technicien_assigne = %s)", TECH)
    _sql(reel, "DELETE FROM tickets WHERE technicien_assigne = %s", TECH)


@pytest.fixture
def propre(reel):
    _effacer(reel)
    yield
    _effacer(reel)


def test_colonne_emplacement_migree(reel):
    rows = _sql(reel, "SELECT data_type FROM information_schema.columns"
                      " WHERE table_name = 'tickets' AND column_name = 'emplacement'")
    assert rows and rows[0]["data_type"] == "text"


def test_emplacement_sur_base_reelle(reel, propre):
    c = reel["c"]
    tid = _termine_il_y_a(reel, 2)
    put = lambda v: c.put(f"/api/etagere/{tid}/emplacement", json={"emplacement": v}, headers=H)

    r = put("  b3 ")
    assert r.status_code == 200 and r.json() == {"emplacement": "B3"}
    assert put("B3").json() == {"emplacement": "B3"}                  # inchangé : pas de 2e ligne
    assert put("a1").json() == {"emplacement": "A1"}
    assert put(None).json() == {"emplacement": None}
    assert put("X" * 21).status_code == 422
    assert c.put("/api/etagere/999999999/emplacement", json={"emplacement": "B3"}, headers=H).status_code == 404

    lignes = [r["contenu"] for r in _sql(reel, "SELECT contenu FROM historique WHERE ticket_id = %s"
                                               " AND type = 'etagere' ORDER BY id", tid)]
    assert lignes == ["Rangé en B3 — par Sophie", "Rangé en A1 (avant : B3) — par Sophie",
                      "Emplacement A1 libéré — par Sophie"]
    journal = _sql(reel, "SELECT historique FROM tickets WHERE id = %s", tid)[0]["historique"]
    assert "Rangé en B3 — par Sophie" in journal and journal.count("Rangé en B3") == 1

    put("B3")
    assert _vue(c)["tickets"][0]["emplacement"] == "B3"
    # La fiche (t.*) porte aussi l'emplacement
    assert c.get(f"/api/tickets/{tid}", headers=H).json()["emplacement"] == "B3"


def test_restitution_statut_et_paiement_liberent_l_emplacement():
    # Restitution, changement de statut et « payé » (Rendu → Clôturé) passent par la même règle
    for route in (tickets_api.restituer_ticket, tickets_api.change_status, tickets_api.toggle_paye):
        assert "etagere.liberer_emplacement(" in inspect.getsource(route), route.__name__


def test_rendu_libere_l_emplacement(reel, propre):
    c = reel["c"]
    libere = "Emplacement B3 libéré — par Sophie"

    def ranger(tid):
        assert c.put(f"/api/etagere/{tid}/emplacement", json={"emplacement": "B3"}, headers=H).status_code == 200

    def etat(tid):
        t = _sql(reel, "SELECT statut, emplacement, historique FROM tickets WHERE id = %s", tid)[0]
        lignes = [r["contenu"] for r in _sql(reel, "SELECT contenu FROM historique WHERE ticket_id = %s", tid)]
        return t, lignes

    for corps, statut in (({"paiement": "encaisser", "mode_paiement": "CB"}, "Clôturé"),
                          ({"paiement": "non_paye", "motif_non_paye": "Revient vendredi"}, "Rendu au client")):
        tid = _termine_il_y_a(reel, 5, tarif_final=50)
        ranger(tid)
        r = c.post(f"/api/tickets/{tid}/restitution", json=corps, headers=H)
        assert r.status_code == 200, r.text
        assert r.json()["ticket"]["emplacement"] is None
        t, lignes = etat(tid)
        assert (t["statut"], t["emplacement"]) == (statut, None)
        assert lignes.count(libere) == 1 and libere in t["historique"]
    # Le rendu impayé reste dans la vue (reste dû), sans emplacement
    assert [(x["statut"], x["emplacement"]) for x in _vue(c)["tickets"]] == [("Rendu au client", None)]

    # Ticket déjà réglé passé « Rendu au client » depuis la fiche ou le scan
    tid = _termine_il_y_a(reel, 5, tarif_final=50, paye=1)
    ranger(tid)
    r = c.patch(f"/api/tickets/{tid}/statut", json={"statut": "Rendu au client"}, headers=H)
    assert r.status_code == 200, r.text
    t, lignes = etat(tid)
    assert t["emplacement"] is None and lignes.count(libere) == 1

    # Clôture depuis la fiche (déjà réglé, Rendu → Clôturé) : libéré une seule fois
    r = c.patch(f"/api/tickets/{tid}/statut", json={"statut": "Clôturé"}, headers=H)
    assert r.status_code == 200, r.text
    t, lignes = etat(tid)
    assert t["statut"] == "Clôturé" and t["emplacement"] is None and lignes.count(libere) == 1

    # Rendu impayé d'avant le branchement (emplacement resté posé), réglé ensuite : « payé »
    # le clôture et vide l'étagère
    tid = _termine_il_y_a(reel, 5, tarif_final=50)
    ranger(tid)
    _sql(reel, "UPDATE tickets SET statut = 'Rendu au client' WHERE id = %s", tid)
    r = c.patch(f"/api/tickets/{tid}/paye", json={"paye": True}, headers=H)
    assert r.status_code == 200 and r.json()["statut"] == "Clôturé", r.text
    t, lignes = etat(tid)
    assert t["emplacement"] is None and lignes.count(libere) == 1 and libere in t["historique"]

    # Retour en atelier : l'appareil reste rangé
    tid = _termine_il_y_a(reel, 5)
    ranger(tid)
    r = c.patch(f"/api/tickets/{tid}/statut", json={"statut": "En cours de réparation"}, headers=H)
    assert r.status_code == 200, r.text
    assert etat(tid)[0]["emplacement"] == "B3"
    lignes = etat(tid)[1]
    assert not any("libéré" in x for x in lignes)


def test_compteurs_de_relances_et_palier_du(reel, propre):
    c = reel["c"]
    relance = _termine_il_y_a(reel, 45)
    _note(reel, relance, "sms", _il_y_a(reel, 50))              # avant la fin : pas une relance
    _note(reel, relance, "whatsapp", _il_y_a(reel, 45))         # message « prêt » le jour même
    _note(reel, relance, "email", _il_y_a(reel, 14))            # J+31
    _note(reel, relance, "note", _il_y_a(reel, 5))              # note interne : pas une relance
    _note(reel, relance, "message_client", _il_y_a(reel, 4))    # message reçu du client : non plus
    jamais = _termine_il_y_a(reel, 12)
    _note(reel, jamais, "sms", _il_y_a(reel, 14))               # pendant la réparation
    recent = _termine_il_y_a(reel, 1)
    rendu = _termine_il_y_a(reel, 60, statut="Rendu au client", reparation_supp=LIGNES_120, prix_supp=120)

    body = _vue(c)
    par_id = {t["id"]: t for t in body["tickets"]}
    assert set(par_id) == {relance, jamais, recent, rendu}
    t = par_id[relance]
    assert (t["jours_attente"], t["nb_relances"]) == (45, 2)
    assert t["derniere_relance"].startswith(_il_y_a(reel, 14).strftime("%Y-%m-%dT10:00"))
    assert t["relance_due"] is False                            # J+31 couvre J+30, prochain J+90
    assert (par_id[jamais]["nb_relances"], par_id[jamais]["derniere_relance"], par_id[jamais]["relance_due"]) \
        == (0, None, True)
    assert par_id[recent]["relance_due"] is False               # J+1 : premier palier J+3
    assert par_id[rendu]["relance_due"] is False and par_id[rendu]["reste_du"] == 120

    # Appel tracé : note « relance », compteur et date renvoyés, plus rien de dû
    r = c.post(f"/api/etagere/{jamais}/relance",
               json={"canal": "appel", "contenu": " Pas de réponse, message laissé "}, headers=H)
    assert r.status_code == 200, r.text
    assert r.json()["nb_relances"] == 1 and r.json()["derniere_relance"]
    note = _sql(reel, "SELECT type_note, contenu, auteur FROM notes_tickets WHERE ticket_id = %s"
                      " ORDER BY id DESC LIMIT 1", jamais)[0]
    assert note == {"type_note": "relance", "contenu": "Appel téléphonique : Pas de réponse, message laissé",
                    "auteur": "Sophie"}
    r = c.post(f"/api/etagere/{jamais}/relance", json={"canal": "sms", "contenu": "Bonjour…"}, headers=H)
    assert r.json()["nb_relances"] == 2
    assert _sql(reel, "SELECT type_note FROM notes_tickets WHERE ticket_id = %s ORDER BY id DESC LIMIT 1",
                jamais)[0]["type_note"] == "sms"
    par_id = {t["id"]: t for t in _vue(c)["tickets"]}
    assert par_id[jamais]["nb_relances"] == 2 and par_id[jamais]["relance_due"] is False

    assert c.post(f"/api/etagere/{jamais}/relance", json={"canal": "fax", "contenu": "x"}, headers=H).status_code == 422
    assert c.post("/api/etagere/999999999/relance", json={"canal": "sms"}, headers=H).status_code == 404


def test_paliers_parametrables(reel, propre, params_reels):
    c = reel["c"]
    tid = _termine_il_y_a(reel, 5)
    assert {t["id"]: t for t in _vue(c)["tickets"]}[tid]["relance_due"] is True     # palier J+3
    params_reels("ETAGERE_RELANCE_PALIERS", "7, 14")
    assert _vue(c)["tickets"][0]["relance_due"] is False
    assert c.get("/api/etagere/config", headers=H).json()["relance_paliers"] == [7, 14]
    params_reels("ETAGERE_RELANCE_PALIERS", "")
    assert _vue(c)["tickets"][0]["relance_due"] is False


def test_delai_abandon_par_defaut_et_parametrable(reel, propre, params_reels):
    c = reel["c"]
    _termine_il_y_a(reel, 3)
    params_reels("ETAGERE_DELAI_ABANDON_JOURS", None)
    params_reels("ETAGERE_EMPLACEMENTS", None)
    params_reels("ETAGERE_RELANCE_PALIERS", None)
    assert _vue(c)["delai_abandon_jours"] == 365
    assert c.get("/api/etagere/config", headers=H).json() == {
        "emplacements": [], "delai_abandon_jours": 365, "relance_paliers": [3, 10, 30, 90, 180, 330],
        "mise_en_demeure_jours": 90}
    params_reels("ETAGERE_DELAI_ABANDON_JOURS", "400")
    params_reels("ETAGERE_EMPLACEMENTS", "b1, A2 ,b1, étagère 3")
    assert _vue(c)["delai_abandon_jours"] == 400
    cfg = c.get("/api/etagere/config", headers=H).json()
    assert cfg["delai_abandon_jours"] == 400 and cfg["emplacements"] == ["B1", "A2", "ÉTAGÈRE 3"]
    params_reels("ETAGERE_DELAI_ABANDON_JOURS", "trois mois")
    assert _vue(c)["delai_abandon_jours"] == 365


def test_message_relance_endpoint(reel, propre, params_reels):
    c = reel["c"]
    params_reels("horaires", "Mardi-Samedi 9h30-18h")
    get = lambda tid: c.get(f"/api/etagere/{tid}/message-relance", headers=H)
    aimable, ferme, garde = _termine_il_y_a(reel, 5), _termine_il_y_a(reel, 45), _termine_il_y_a(reel, 120)

    r = get(aimable)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["jours"] == 5 and body["message"].startswith("Bonjour Pytest,")
    assert "Petit rappel" in body["message"] and "depuis 5 jours" in body["message"]
    assert "Mardi-Samedi 9h30-18h" in body["message"] and "{" not in body["message"]
    assert "n'a toujours pas été récupéré" in get(ferme).json()["message"]
    m = get(garde).json()
    assert m["jours"] == 120 and "loi du 31 décembre 1903" in m["message"] and "depuis 120 jours" in m["message"]

    rendu = _termine_il_y_a(reel, 10, statut="Rendu au client", tarif_final=50)
    assert get(rendu).status_code == 409 and get(rendu).json()["detail"]["code"] == "pas_en_boutique"
    assert get(999999999).status_code == 404


def test_mise_en_demeure_sur_base_reelle(reel, propre, params_reels):
    c = reel["c"]
    params_reels("BOUTIQUE_NOM", "Klikphone <Test>")
    params_reels("BOUTIQUE_SIRET", "813 961 141 00013")
    cid = _sql(reel, "INSERT INTO clients (nom, prenom, telephone) VALUES (%s, %s, '0600000778') RETURNING id",
               "<img src=x onerror=alert(1)>", "Jean & Co")[0]["id"]
    try:
        tid = _termine_il_y_a(reel, 100, client_id=cid, reparation_supp=LIGNES_120, prix_supp=120, acompte=20,
                              modele="Galaxy <S21>")
        _note(reel, tid, "sms", _il_y_a(reel, 104))                 # avant la fin : absent du courrier
        _note(reel, tid, "whatsapp", _il_y_a(reel, 97))
        _note(reel, tid, "relance", _il_y_a(reel, 60), "Appel téléphonique : répondeur")
        trop_tot = _termine_il_y_a(reel, 30)

        r = c.get(f"/api/etagere/{tid}/mise-en-demeure", headers=H)
        assert r.status_code == 200, r.text
        assert r.headers["content-type"].startswith("text/html")
        assert "default-src 'none'" in r.headers["content-security-policy"] and r.headers["cache-control"] == "no-store"
        html = r.text
        assert "<img src=x" not in html and "&lt;img src=x onerror=alert(1)&gt;" in html and "Jean &amp; Co" in html
        assert "Klikphone &lt;Test&gt;" in html and "SIRET : 813 961 141 00013" in html
        assert "Galaxy &lt;S21&gt;" in html and f"KP-{tid:06d}" in html and "100,00 €" in html
        assert "WhatsApp" in html and "Appel téléphonique" in html and "SMS" not in html
        assert "Malgré nos 2 messages et relances" in html and "(il y a 100 jours)" in html
        assert "loi du 31 décembre 1903" in html and "<strong>15 jours</strong>" in html

        assert c.get(f"/api/etagere/{tid}/mise-en-demeure", headers=H).status_code == 200   # aperçu puis impression
        traces = _sql(reel, "SELECT contenu FROM historique WHERE ticket_id = %s AND type = 'etagere'", tid)
        assert [t["contenu"] for t in traces] == ["Mise en demeure imprimée — par Sophie"]
        assert "Mise en demeure imprimée" in _sql(reel, "SELECT historique FROM tickets WHERE id = %s", tid)[0]["historique"]

        r = c.get(f"/api/etagere/{trop_tot}/mise-en-demeure", headers=H)
        assert r.status_code == 409 and r.json()["detail"] == {
            "code": "trop_tot", "jours": 30, "message": "Courrier proposé à partir de J+90 (J+30)."}
        assert c.get("/api/etagere/999999999/mise-en-demeure", headers=H).status_code == 404
    finally:
        _sql(reel, "DELETE FROM tickets WHERE client_id = %s", cid)
        _sql(reel, "DELETE FROM clients WHERE id = %s", cid)


def test_identite_boutique_replis(reel, params_reels):
    for cle in ("BOUTIQUE_NOM", "nom_boutique", "NOM_BOUTIQUE", "BOUTIQUE_TEL", "telephone", "tel_boutique",
                "TEL_BOUTIQUE", "BOUTIQUE_ADRESSE", "adresse", "ADRESSE_BOUTIQUE"):
        params_reels(cle, None)
    ident = etagere.identite_boutique()
    assert (ident["nom"], ident["adresse"], ident["tel"]) == (
        "Klikphone", "79 Place Saint-Léger, 73000 Chambéry", "04 79 60 89 22")
    params_reels("nom_boutique", "Ancienne clé")
    params_reels("tel_boutique", "04 00 00 00 01")
    assert etagere.identite_boutique()["nom"] == "Ancienne clé"
    assert etagere.identite_boutique()["tel"] == "04 00 00 00 01"
    params_reels("BOUTIQUE_NOM", "Clé canonique")
    assert etagere.identite_boutique()["nom"] == "Clé canonique"
