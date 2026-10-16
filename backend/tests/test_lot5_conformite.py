"""Conformité (lot 5) : fiche de réception, mentions légales sur toutes les impressions,
politique de confidentialité, export / anonymisation / rétention RGPD.

Les tests purs tournent toujours. Ceux sur base réelle exigent une base PostgreSQL
JETABLE (données fictives, migrations du lifespan rejouées, rétention appliquée) :
    KP_CONFORMITE_DATABASE_URL="postgresql://postgres:<mot_de_passe>@127.0.0.1:5432/kp_conformite?sslmode=disable" pytest tests/test_lot5_conformite.py
"""

import inspect
import json
import os
import re
import sys
import zlib
from contextlib import contextmanager
from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import main
from app.api import attestation, chat, clients as clients_api, devis as devis_api, depot_distance
from app.api import config as config_api
from app.api import print_tickets, reception, rgpd
from app.api.auth import create_admin_token, create_token, decode_token
from app.services import mentions
from app.services import params as params_cache

IMEI_OK = "490154203237518"
TEL = "0600000901"


def _h(admin=False, user="Sophie"):
    tok = create_token("accueil", user)
    h = {"Authorization": f"Bearer {tok}"}
    if admin:
        h["X-Admin-Token"] = create_admin_token(decode_token(tok))
    return h


def _textes_pdf(pdf: bytes) -> bytes:
    out = b""
    for f in re.findall(rb"stream\r?\n(.*?)\r?\nendstream", pdf, re.S):
        try:
            out += zlib.decompress(f)
        except zlib.error:
            out += f
    return out


ITEMS = {
    "accessoires": ["chargeur", "coque", "autre", "coque"],
    "accessoires_autre": "Pochette <script>alert(1)</script>",
    "etat": {"ecran": "fissure", "dos": "ok", "chassis": "choc", "notes": "Rayure <b>coin</b>"},
    "tests": {"allume": True, "tactile": True, "face_touch_id": False, "camera_arriere": False},
    "imei_verifie": "49-015420-323751-8",
    "sauvegarde_conseillee": True,
}


def _ticket(**extra):
    t = {
        "id": 42, "ticket_code": "KP-000042", "client_id": 7, "client_prenom": "Jean", "client_nom": "Fictif",
        "client_tel": "0600000000", "marque": "Apple", "modele": "iPhone 13", "categorie": "Smartphone",
        "panne": "Écran cassé", "panne_detail": "", "imei": None, "pin": "1234", "pattern": None,
        "notes_client": None, "technicien_assigne": "Tech", "date_depot": datetime(2026, 10, 1, 8, 0),
        "date_recuperation": None, "type_ecran": None, "devis_estime": 129, "acompte": 0, "paye": 0,
        "statut": "En cours de réparation", "reparation_supp": None, "suivi_token": "AbCdEfGhIjKlMnOpQrStUv",
        "notes_impression": [],
    }
    t.update(extra)
    return t


# ═══ Mentions légales : règles pures ═══════════════════════════════

def test_mentions_defauts_et_anciennes_cles():
    ident = mentions.lire({"telephone": " 04 11 ", "tel_boutique": "04 22", "SIRET": "999", "tva": "0"})
    assert ident["BOUTIQUE_TEL"] == "04 11" and ident["BOUTIQUE_SIRET"] == "999"
    assert ident["TVA_MENTION"] == mentions.TVA_FRANCHISE
    assert ident["BOUTIQUE_NOM"] == "KLIKPHONE" and ident["GARANTIE_MOIS"] == "6"
    # Clé canonique posée (même vide) : elle fait foi, le nom n'est jamais vide
    ident = mentions.lire({"BOUTIQUE_TEL": "", "telephone": "04 11", "BOUTIQUE_NOM": " ",
                           "GARANTIE_MOIS": "abc", "PURGE_CODES_JOURS": "0", "TVA_MENTION": "", "tva": "0"})
    assert ident["BOUTIQUE_TEL"] == "" and ident["BOUTIQUE_NOM"] == "KLIKPHONE"
    assert ident["GARANTIE_MOIS"] == "6" and ident["PURGE_CODES_JOURS"] == "30" and ident["TVA_MENTION"] == ""
    assert set(ident) == set(mentions.CLES)


def test_mentions_jamais_secretes_et_validees():
    assert not [c for c in mentions.CLES if config_api.est_secret(c)]
    assert mentions.valider("GARANTIE_MOIS", " 012 ") == "12"
    for cle, v in (("GARANTIE_MOIS", "121"), ("RGPD_RETENTION_MOIS", "0"), ("PURGE_CODES_JOURS", "x"),
                   ("CGV_DEPOT", "x" * 4001), ("BOUTIQUE_NOM", "x" * 301)):
        with pytest.raises(ValueError):
            mentions.valider(cle, v)


def test_migration_sql_sur_les_defauts_et_dans_le_demarrage():
    for cle in mentions.CLES:
        if cle != "TVA_MENTION":
            assert f"('{cle}', " in mentions.SQL_MIGRATION
            assert f"$kp${mentions.DEFAUTS[cle]}$kp$" in mentions.SQL_MIGRATION, cle
    for cle, anciennes in mentions.ANCIENNES.items():
        assert f"('{cle}', ARRAY[{', '.join(repr(a) for a in anciennes)}]" in mentions.SQL_MIGRATION
    assert mentions.FLAG_MIGRATION in mentions.SQL_MIGRATION and mentions.FLAG_MIGRATION in mentions.SQL_MIGRATION_FLAG
    assert "%" not in mentions.SQL_MIGRATION   # exécuté sans paramètres
    i = main._DONNEES_FIXES.index(mentions.SQL_MIGRATION)
    assert main._DONNEES_FIXES[i + 1] == mentions.SQL_MIGRATION_FLAG
    ddl = " ".join(main._DDL_TABLES)
    assert "CREATE TABLE IF NOT EXISTS ticket_controles" in ddl and "UNIQUE (ticket_id, phase)" in ddl
    for col in ("rgpd_informe_le", "consentement_marketing", "consentement_marketing_le", "anonymise_le"):
        assert any(f"ALTER TABLE clients ADD COLUMN IF NOT EXISTS {col} " in a for a in main._DDL_ALTERS)


def test_aucune_identite_codee_en_dur_dans_les_impressions():
    source = inspect.getsource(print_tickets)
    for brut in ("81396114100013", "FR03813961141", "Place Saint", "04 79 60", "KLIKPHONE SARL", "293B",
                 "sous 3 mois"):
        assert brut not in source, brut


def test_ecriture_identite_tient_les_anciennes_cles():
    assert config_api._avec_anciennes_cles([("BOUTIQUE_TEL", "04"), ("tel_boutique", "05")]) == [
        ("BOUTIQUE_TEL", "04"), ("tel_boutique", "05"), ("telephone", "04"), ("TEL_BOUTIQUE", "04")]
    assert config_api._avec_anciennes_cles([("NOM_BOUTIQUE", "X")]) == [("NOM_BOUTIQUE", "X")]


def test_tva_intra_semee_seulement_pour_le_siren_d_origine():
    assert mentions.lire({})["BOUTIQUE_TVA_INTRA"] == "FR03813961141"
    assert mentions.lire({"siret": "813 961 141 00013"})["BOUTIQUE_TVA_INTRA"] == "FR03813961141"
    for autre in ({"siret": "11111111111111"}, {"BOUTIQUE_SIRET": ""}):
        assert mentions.lire(autre)["BOUTIQUE_TVA_INTRA"] == ""
    # Posée, elle fait foi quel que soit le SIRET
    assert mentions.lire({"siret": "111", "BOUTIQUE_TVA_INTRA": "FR00111"})["BOUTIQUE_TVA_INTRA"] == "FR00111"
    assert "left(regexp_replace(" in mentions.SQL_MIGRATION and "'813961141'" in mentions.SQL_MIGRATION


def test_garantie_rappelle_les_garanties_legales_et_les_exclusions():
    g = mentions.mention_garantie({"GARANTIE_MOIS": "6"})
    assert g.startswith("Garantie 6 mois") and "hors casse, oxydation ou intervention d'un tiers" in g
    assert "garanties légales de conformité" in g and "1641" in g
    assert mentions.mention_garantie({"GARANTIE_MOIS": "0"}) == mentions.GARANTIES_LEGALES


def test_siren_et_ville():
    ident = {"BOUTIQUE_SIRET": "813 961 141 00013", "BOUTIQUE_ADRESSE": "1 rue Fictive, 74000 Annecy"}
    assert mentions.siren(ident) == "813 961 141" and mentions.ville(ident) == "Annecy"
    assert mentions.siren({"BOUTIQUE_SIRET": "12"}) == "" and mentions.ville({"BOUTIQUE_ADRESSE": "Sans CP"}) == ""


IDENT_TEST = {
    "BOUTIQUE_NOM": "KLIK <b>TEST</b>", "BOUTIQUE_FORME": "SAS au capital de 1 000 €",
    "BOUTIQUE_ADRESSE": "1 rue Fictive, 74000 Annecy", "BOUTIQUE_TEL": "04 00 00 00 00",
    "BOUTIQUE_EMAIL": "boutique@exemple.test", "BOUTIQUE_SIRET": "11122233300044",
    "BOUTIQUE_RCS": "Annecy 111 222 333", "BOUTIQUE_TVA_INTRA": "FR00111222333", "TVA_MENTION": "",
    "GARANTIE_MOIS": "12",
}


def _ident_test(monkeypatch):
    ident = mentions.lire(dict(IDENT_TEST))
    monkeypatch.setattr(mentions, "lire", lambda valeurs=None, cur=None: dict(ident))
    return ident


def test_devis_imprime_identite_et_mentions_des_parametres(client, auth_headers, monkeypatch):
    _ident_test(monkeypatch)

    class Cur:
        sql = ""

        def execute(self, sql, params=None):
            self.sql = sql

        def fetchone(self):
            if "FROM devis WHERE" in self.sql:
                return {"id": 1, "numero": "DEV-202610-0001", "client_id": None, "statut": "Brouillon",
                        "client_nom": "Fictif", "client_prenom": "Jean", "client_tel": "0600000000",
                        "client_email": None, "appareil": None, "description": None, "notes": None,
                        "remise": 0, "total_ht": 100, "tva": 20, "total_ttc": 120, "validite_jours": 30,
                        "date_creation": datetime(2026, 10, 15, 9, 0)}
            return None

        def fetchall(self):
            return []

    @contextmanager
    def fake_cursor():
        yield Cur()

    monkeypatch.setattr(devis_api, "get_cursor", fake_cursor)
    r = client.get("/api/devis/1/print", headers=auth_headers)
    assert r.status_code == 200
    html = r.text
    for attendu in ("KLIK &lt;b&gt;TEST&lt;/b&gt;", "SAS au capital de 1 000 €", "1 rue Fictive, 74000 Annecy",
                    "SIRET : 11122233300044", "RCS Annecy 111 222 333", "TVA intracom. : FR00111222333",
                    "Garantie 12 mois", "DEV-202610-0001 du 15/10/2026"):
        assert attendu in html, attendu
    for brut in ("81396114", "79 Place", "04 79 60", "KLIKPHONE", "<b>TEST"):
        assert brut not in html, brut
    source = inspect.getsource(devis_api.print_devis)
    assert "Saint-Léger" not in source and "04 79" not in source and "KLIKPHONE" not in source


def test_attestation_identite_des_parametres(monkeypatch):
    _ident_test(monkeypatch)
    data = attestation.AttestationRequest(nom="Fictif", prenom="Jean", marque="Apple", modele="iPhone 13",
                                          motif="Carte mère HS")
    html = attestation._generate_attestation_html(data)
    for attendu in ("KLIK &lt;b&gt;TEST&lt;/b&gt;, SAS au capital de 1 000 €", "SIRET : 11122233300044",
                    "RCS Annecy 111 222 333", "Annecy, le ", "Fait à Annecy, le ", "boutique@exemple.test"):
        assert attendu in html, attendu
    for brut in ("813 901 191", "Chambéry", "Saint Léger", "KLIKPHONE", "<b>TEST"):
        assert brut not in html, brut
    texte = _textes_pdf(attestation._generate_attestation_pdf(data))
    assert b"SIRET : 11122233300044" in texte and b"Annecy" in texte and b"813 901 191" not in texte
    assert b"Chambery" not in texte
    source = inspect.getsource(attestation)
    for brut in ("813 901 191", "Saint Leger", "Saint Léger", "04 79 60"):
        assert brut not in source, brut


def test_assistant_ia_ne_recoit_ni_code_ni_coordonnees(monkeypatch):
    vus = []

    class Cur:
        def execute(self, sql, params=None):
            vus.append(sql)

        def fetchone(self):
            return None

        def fetchall(self):
            return []

    @contextmanager
    def fake_cursor():
        yield Cur()

    monkeypatch.setattr(chat, "get_cursor", fake_cursor)
    chat._execute_tool("get_ticket", {"ticket_code": "KP-000001"})
    chat._execute_tool("search_client", {"query": "Fictif"})
    sql_ticket, sql_client = vus
    # Les codes ne servent qu'au booléen : jamais une colonne renvoyée telle quelle
    assert not re.search(r"[\s,]t\.(pin|pattern)\s*,", sql_ticket)
    assert "c.telephone" not in sql_ticket and "c.email" not in sql_ticket
    assert "AS code_deverrouillage_fourni" in sql_ticket and "c.email" not in sql_client


def test_date_du_recu_fixe_a_la_reimpression():
    assert print_tickets._date_recu({"date_rendu": "2026-10-10 18:00:00", "date_cloture": "2026-10-12"}) == "10/10/2026"
    assert print_tickets._date_recu({"date_rendu": "hier", "date_cloture": "2026-10-12 09:00:00"}) == "12/10/2026"
    assert print_tickets._date_recu({}) == print_tickets._maintenant_paris().strftime("%d/%m/%Y")
    t = _ticket(date_rendu="2026-10-10 18:00:00")
    assert "10/10/2026" in print_tickets.render_html(t, "recu")
    assert "10/10/2026" in print_tickets._a4_document(t, "recu")
    assert b"10/10/2026" in _textes_pdf(print_tickets._build_pdf(t, "recu"))


def test_meme_personne():
    fiche = {"nom": "Dupont", "prenom": "Élodie"}
    assert clients_api.meme_personne(fiche, " DUPONT ", "elodie")
    assert not clients_api.meme_personne(fiche, "Dupont", "") and not clients_api.meme_personne(fiche, "Durand", "Élodie")
    assert clients_api.meme_personne({"nom": "Dupont", "prenom": ""}, "dupont", "Jean")
    assert not clients_api.meme_personne({"nom": "", "prenom": ""}, "", "")


def test_retention_automatique_desactivable_par_l_environnement(monkeypatch):
    monkeypatch.setenv("KP_RETENTION_AUTO", "0")
    monkeypatch.setitem(rgpd._tache, "thread", None)
    rgpd.demarrer_retention_quotidienne()
    assert rgpd._tache["thread"] is None
    lances = []

    class FauxThread:
        def __init__(self, target, args, daemon, name):
            lances.append((target, args, daemon, name))

        def start(self):
            pass

        def is_alive(self):
            return True

    monkeypatch.delenv("KP_RETENTION_AUTO")
    monkeypatch.setattr(rgpd.threading, "Thread", FauxThread)
    rgpd.demarrer_retention_quotidienne()
    rgpd.demarrer_retention_quotidienne()   # déjà lancée : pas de seconde tâche
    assert lances == [(rgpd._boucle_retention, (300, 3600), True, "rgpd_retention")]
    assert "rgpd_api.demarrer_retention_quotidienne()" in inspect.getsource(main.lifespan)


def test_cles_de_retention_protegees_et_colonnes_declarees():
    for cle in rgpd.PARAMS_RETENTION:
        assert not config_api.est_secret(cle)
    for col in ("consentement_marketing_retire_le", "consentement_marketing_source"):
        assert any(f"ALTER TABLE clients ADD COLUMN IF NOT EXISTS {col} " in a for a in main._DDL_ALTERS)


# ═══ Fiche de réception : modèle ═══════════════════════════════════

def test_reception_modele_normalise():
    it = reception.ItemsReception.model_validate(ITEMS)
    assert it.accessoires == ["chargeur", "coque", "autre"] and it.imei_verifie == IMEI_OK
    assert it.tests.micro is None and it.tests.face_touch_id is False
    vide = reception.ItemsReception.model_validate({"accessoires": None, "etat": None, "tests": None,
                                                    "imei_verifie": "  ", "inconnu": 1})
    assert vide.model_dump()["etat"] == {"ecran": None, "dos": None, "chassis": None, "notes": ""}
    assert vide.imei_verifie is None and "inconnu" not in vide.model_dump()
    assert reception.ItemsReception.model_validate({"imei_verifie": "DMPXK1ABCD"}).imei_verifie == "DMPXK1ABCD"


@pytest.mark.parametrize("items", [
    {"imei_verifie": "490154203237519"},          # clé de Luhn fausse
    {"imei_verifie": "<script>"},
    {"accessoires": ["chargeur", "bijou"]},
    {"etat": {"ecran": "explose"}},
    {"etat": {"chassis": "fissure"}},             # pas une valeur du châssis
    {"tests": {"micro": "peut-être"}},
])
def test_reception_modele_refuse(items):
    with pytest.raises(ValidationError):
        reception.ItemsReception.model_validate(items)


def test_resume_reception_et_sql_dashboard():
    r = reception.resume_reception({"items": ITEMS, "complete": False})
    assert r["accessoires"] == ["Chargeur", "Coque", "Pochette <script>alert(1)</script>"]
    assert r["etat"] == ["Écran fissuré", "Dos OK", "Châssis choc"]
    assert r["tests_ko"] == ["Face ID / Touch ID", "Caméra arrière"] and "Micro" in r["non_testes"]
    assert r["complete"] is False and r["sauvegarde"] is True and r["imei"] == IMEI_OK
    assert reception.resume_reception(None) is None and reception.resume_reception("pas du json") is None
    assert "tc.phase = 'entree'" in reception.reception_complete_sql("t")
    with pytest.raises(ValueError):
        reception.reception_complete_sql("t; DROP")


# ═══ Impressions (base simulée) ════════════════════════════════════

def test_fiche_atelier_encadre_reception_echappe():
    t = _ticket(reception_impression={"items": ITEMS, "complete": False})
    staff = print_tickets.render_html(t, "staff")
    assert '<div class="box-title">Réception</div>' in staff and "À COMPLÉTER" in staff
    assert "Tests KO : Face ID / Touch ID, Caméra arrière" in staff
    assert "Écran fissuré · Dos OK · Châssis choc" in staff and IMEI_OK in staff
    assert "<script>alert" not in staff and "&lt;script&gt;" in staff and "<b>coin</b>" not in staff
    # Encadré placé avant la panne, sans « row line » (les lignes de réparation restent les premières)
    assert staff.index("Réception</div>") < staff.index("Panne</div>")
    client = print_tickets.render_html(t, "client")
    assert "Dépôt constaté" in client and "Accessoires déposés" in client and "Tests KO" not in client
    assert "<script>alert" not in client


def test_fiche_atelier_reception_absente():
    assert "Fiche de réception non remplie" in print_tickets.render_html(_ticket(reception_impression=None), "staff")
    # Donnée non lue avec le ticket : pas d'encadré (et aucune requête de plus)
    assert "box-title\">Réception" not in print_tickets.render_html(_ticket(), "staff")
    assert "Dépôt constaté" not in print_tickets.render_html(_ticket(reception_impression=None), "client")


@pytest.mark.parametrize("kind", ("client", "staff", "combined", "devis", "recu"))
def test_mentions_sur_toutes_les_impressions(kind, monkeypatch):
    ident = mentions.lire({
        "BOUTIQUE_NOM": "<b>KLIK</b>", "BOUTIQUE_FORME": "SAS au capital de 1 000 €",
        "BOUTIQUE_SIRET": "11122233300044", "BOUTIQUE_RCS": "Chambéry 111 222 333",
        "BOUTIQUE_TVA_INTRA": "FR00111222333", "TVA_MENTION": "", "GARANTIE_MOIS": "12",
        "RGPD_CONTACT_EMAIL": "rgpd@exemple.test", "BOUTIQUE_ADRESSE": "1 rue Fictive, 73000 Chambéry",
    })
    monkeypatch.setattr(mentions, "lire", lambda valeurs=None: dict(ident))
    html = print_tickets.render_html(_ticket(), kind)
    assert "<b>KLIK</b>" not in html and "&lt;b&gt;KLIK&lt;/b&gt;" in html
    for attendu in ("SAS au capital de 1 000 €", "SIRET : 11122233300044", "RCS Chambéry 111 222 333",
                    "TVA intracom. : FR00111222333", "Garantie 12 mois", "KP-000042"):
        assert attendu in html, attendu
    if kind in ("client", "combined"):
        assert "rgpd@exemple.test" in html and "/confidentialite" in html


@pytest.mark.parametrize("kind", ("devis", "recu"))
def test_mentions_pdf_et_a4(kind, monkeypatch):
    ident = mentions.lire({"BOUTIQUE_NOM": "KLIKTEST", "BOUTIQUE_SIRET": "11122233300044",
                           "BOUTIQUE_TVA_INTRA": "", "TVA_MENTION": mentions.TVA_FRANCHISE, "GARANTIE_MOIS": "3"})
    monkeypatch.setattr(mentions, "lire", lambda valeurs=None: dict(ident))
    texte = _textes_pdf(print_tickets._build_pdf(_ticket(), kind))
    for attendu in (b"KLIKTEST", b"SIRET : 11122233300044", b"293 B du CGI", b"Garantie 3 mois", b"KP-000042"):
        assert attendu in texte, attendu
    a4 = print_tickets._a4_document(_ticket(), kind)
    assert "KLIKTEST" in a4 and "SIRET : 11122233300044" in a4 and "Garantie 3 mois" in a4


def test_politique_generee_depuis_l_identite():
    ident = mentions.lire({"BOUTIQUE_NOM": "KLIKTEST", "RGPD_CONTACT_EMAIL": "rgpd@exemple.test",
                           "RGPD_RETENTION_MOIS": "24", "PURGE_CODES_JOURS": "15"})
    p = rgpd.politique(ident)
    texte = json.dumps(p, ensure_ascii=False)
    assert p["titre"] and p["maj"] and all(set(s) == {"titre", "texte"} for s in p["sections"])
    for attendu in ("KLIKTEST", "SIRET : 81396114100013", "24 mois", "15 jours", "10 ans", "rgpd@exemple.test",
                    "Railway", "Supabase", "Brevo", "Google", "CNIL", "portabilité", "consentement",
                    "obligation légale", "exécution du contrat", "Nom et numéro de téléphone : indispensables",
                    "code ou schéma de déverrouillage : facultatif", "Aucune décision automatisée",
                    "article 85 de la loi Informatique et Libertés", "demandes de commande",
                    "puis anonymisation ;"):
        assert attendu in texte, attendu
    # Rétention automatique désactivée par défaut : la politique ne la promet pas
    assert "anonymisation automatique" not in texte
    assert "Caractère obligatoire des données" in [s["titre"] for s in p["sections"]]


# ═══ Base réelle ═══════════════════════════════════════════════════

DB_URL = os.getenv("KP_CONFORMITE_DATABASE_URL")


@pytest.fixture(scope="module")
def reel():
    if not DB_URL:
        pytest.skip("KP_CONFORMITE_DATABASE_URL non définie (base PostgreSQL de test jetable)")
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


def _client(reel, tel=TEL, **kw):
    _sql(reel, "DELETE FROM tickets WHERE client_id IN (SELECT id FROM clients WHERE telephone = %s)", tel)
    _sql(reel, "DELETE FROM devis WHERE client_tel = %s", tel)
    _sql(reel, "DELETE FROM clients WHERE telephone = %s", tel)
    c = {"nom": "Fictif", "prenom": "Pytest", "telephone": tel}
    c.update(kw)
    cols = list(c)
    return _sql(reel, "INSERT INTO clients ({}) VALUES ({}) RETURNING id".format(
        ", ".join(cols), ", ".join(["%s"] * len(cols))), *[c[k] for k in cols])[0]["id"]


def _ticket_reel(reel, cid, **kw):
    t = {"client_id": cid, "categorie": "Smartphone", "marque": "Apple", "modele": "iPhone 13",
         "panne": "Écran cassé", "statut": "En cours de réparation", "paye": 0, "devis_estime": 129}
    t.update(kw)
    cols = list(t)
    tid = _sql(reel, "INSERT INTO tickets ({}) VALUES ({}) RETURNING id".format(
        ", ".join(cols), ", ".join(["%s"] * len(cols))), *[t[k] for k in cols])[0]["id"]
    _sql(reel, "UPDATE tickets SET ticket_code = %s WHERE id = %s", f"KP-{tid:06d}", tid)
    return tid


def _params(reel, **valeurs):
    for cle, v in valeurs.items():
        if v is None:
            _sql(reel, "DELETE FROM params WHERE cle = %s", cle)
        else:
            _sql(reel, "INSERT INTO params (cle, valeur) VALUES (%s, %s) "
                       "ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur", cle, v)
    params_cache.invalidate()


def _valeurs(reel, *cles):
    return {r["cle"]: r["valeur"] for r in _sql(reel, "SELECT cle, valeur FROM params WHERE cle = ANY(%s)", list(cles))}


def test_reel_migration_des_cles_legales_idempotente(reel):
    assert set(_valeurs(reel, *mentions.CLES)) == set(mentions.CLES)
    # Base d'avant la migration : anciennes clés seules
    _params(reel, **dict.fromkeys(mentions.CLES), **{mentions.FLAG_MIGRATION: None},
            telephone="04 11 11 11 11", tel_boutique="04 22 22 22 22", siret="", SIRET="99988877700011",
            nom_boutique="Klik Test", adresse="2 rue Fictive", mentions_legales="CGV perso", tva="0",
            email="", EMAIL_BOUTIQUE="boutique@exemple.test")
    main._donnees_de_demarrage()
    v = _valeurs(reel, *mentions.CLES, mentions.FLAG_MIGRATION)
    assert v["BOUTIQUE_TEL"] == "04 11 11 11 11" and v["BOUTIQUE_SIRET"] == "99988877700011"
    assert v["BOUTIQUE_NOM"] == "Klik Test" and v["BOUTIQUE_ADRESSE"] == "2 rue Fictive"
    assert v["CGV_DEPOT"] == "CGV perso" and v["BOUTIQUE_EMAIL"] == "boutique@exemple.test"
    assert v["TVA_MENTION"] == mentions.TVA_FRANCHISE and v["GARANTIE_MOIS"] == "6"
    # Autre SIREN que celui d'origine : pas de n° de TVA semé (il serait faux)
    assert v["BOUTIQUE_TVA_INTRA"] == "" and v[mentions.FLAG_MIGRATION] == "1"
    # Relancée deux fois : rien n'est réécrit ni recréé
    _params(reel, BOUTIQUE_TEL="04 33 33 33 33", BOUTIQUE_RCS=None, telephone="04 44 44 44 44")
    main._donnees_de_demarrage()
    main._donnees_de_demarrage()
    v2 = _valeurs(reel, *mentions.CLES)
    assert v2["BOUTIQUE_TEL"] == "04 33 33 33 33" and "BOUTIQUE_RCS" not in v2
    assert {k: x for k, x in v2.items() if k != "BOUTIQUE_TEL"} == {
        k: x for k, x in v.items() if k not in ("BOUTIQUE_TEL", "BOUTIQUE_RCS", mentions.FLAG_MIGRATION)}
    # SIREN d'origine (écrit avec espaces) : son n° de TVA est semé
    _params(reel, **dict.fromkeys(mentions.CLES), **{mentions.FLAG_MIGRATION: None},
            siret="813 961 141 00013", SIRET=None, tva="20")
    main._donnees_de_demarrage()
    v3 = _valeurs(reel, "BOUTIQUE_SIRET", "BOUTIQUE_TVA_INTRA", "TVA_MENTION")
    assert v3 == {"BOUTIQUE_SIRET": "813 961 141 00013", "BOUTIQUE_TVA_INTRA": "FR03813961141", "TVA_MENTION": ""}


def test_reel_config_ecriture_validation_et_public(reel):
    c = reel["c"]
    lot = [
        {"cle": "BOUTIQUE_TEL", "valeur": " 04 55 55 55 55 "}, {"cle": "GARANTIE_MOIS", "valeur": "12"},
        {"cle": "BOUTIQUE_FORME", "valeur": "SAS au capital de 1 000 €"},
        {"cle": "BOUTIQUE_RCS", "valeur": "RCS Chambéry 111 222 333"},
        {"cle": "RGPD_CONTACT_EMAIL", "valeur": "rgpd@exemple.test"},
    ]
    _params(reel, BOUTIQUE_TEL="04 00 00 00 00", tva="20", TVA_MENTION="", RGPD_RETENTION_MOIS="36")
    # Identité légale et durées RGPD : élévation admin, rien n'est écrit sans elle
    r = c.put("/api/config/batch", headers=_h(), json=lot)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "admin_requis"
    assert _valeurs(reel, "BOUTIQUE_TEL") == {"BOUTIQUE_TEL": "04 00 00 00 00"}
    r = c.put("/api/config/batch", headers=_h(admin=True), json=lot)
    assert r.status_code == 200, r.text
    v = _valeurs(reel, "BOUTIQUE_TEL", "telephone", "tel_boutique", "TEL_BOUTIQUE", "GARANTIE_MOIS")
    assert v == {"BOUTIQUE_TEL": "04 55 55 55 55", "telephone": "04 55 55 55 55", "tel_boutique": "04 55 55 55 55",
                 "TEL_BOUTIQUE": "04 55 55 55 55", "GARANTIE_MOIS": "12"}
    r = c.put("/api/config", headers=_h(), json={"cle": "PURGE_CODES_JOURS", "valeur": "0"})
    assert r.status_code == 400 and "PURGE_CODES_JOURS" in r.json()["detail"]
    # Taux et mention de TVA cohérents (état final, base + lot)
    r = c.put("/api/config", headers=_h(admin=True), json={"cle": "TVA_MENTION", "valeur": mentions.TVA_FRANCHISE})
    assert r.status_code == 400 and "293 B" in r.json()["detail"]
    assert c.put("/api/config", headers=_h(), json={"cle": "tva", "valeur": "0"}).status_code == 400
    r = c.put("/api/config/batch", headers=_h(admin=True), json=[
        {"cle": "tva", "valeur": "0"}, {"cle": "TVA_MENTION", "valeur": mentions.TVA_FRANCHISE}])
    assert r.status_code == 200, r.text
    assert c.put("/api/config", headers=_h(admin=True), json={"cle": "TVA_MENTION", "valeur": ""}).status_code == 400
    assert c.put("/api/config/batch", headers=_h(admin=True), json=[
        {"cle": "tva", "valeur": "20"}, {"cle": "TVA_MENTION", "valeur": ""}]).status_code == 200
    # Une règle n'est contrôlée que si le lot la touche : l'ancienne incohérence ne bloque pas le reste
    _params(reel, TVA_MENTION=mentions.TVA_FRANCHISE)
    assert c.put("/api/config", headers=_h(admin=True), json={"cle": "BOUTIQUE_TEL", "valeur": "04 55 55 55 55"}).status_code == 200
    _params(reel, TVA_MENTION="")
    # Conservation jamais plus courte que la garantie
    r = c.put("/api/config", headers=_h(admin=True), json={"cle": "RGPD_RETENTION_MOIS", "valeur": "6"})
    assert r.status_code == 400 and "garantie" in r.json()["detail"]
    assert c.put("/api/config", headers=_h(admin=True), json={"cle": "GARANTIE_MOIS", "valeur": "48"}).status_code == 400
    assert c.put("/api/config", headers=_h(admin=True), json={"cle": "RGPD_RETENTION_MOIS", "valeur": "24"}).status_code == 200
    # Rétention automatique : 0/1, élévation admin
    assert c.put("/api/config", headers=_h(admin=True), json={"cle": rgpd.PARAM_AUTO, "valeur": "2"}).status_code == 400
    assert c.put("/api/config", headers=_h(admin=True),
                 json={"cle": rgpd.PARAM_AUTO_DEBUT, "valeur": "demain"}).status_code == 400
    assert c.put("/api/config", headers=_h(), json={"cle": rgpd.PARAM_AUTO, "valeur": "0"}).status_code == 403
    assert c.put("/api/config", headers=_h(admin=True), json={"cle": rgpd.PARAM_AUTO, "valeur": "0"}).status_code == 200
    assert _valeurs(reel, rgpd.PARAM_AUTO) == {rgpd.PARAM_AUTO: "0"}
    _params(reel, DISCORD_WEBHOOK="https://exemple.test/secret", RGPD_RETENTION_MOIS="36", **{rgpd.PARAM_AUTO: None})
    pub = c.get("/api/config/public")
    assert pub.status_code == 200
    body = pub.json()
    assert set(mentions.CLES) <= set(body) and body["BOUTIQUE_TEL"] == "04 55 55 55 55" and body["GARANTIE_MOIS"] == "12"
    assert "DISCORD_WEBHOOK" not in body and "secret" not in pub.text
    _params(reel, DISCORD_WEBHOOK=None)


def test_reel_reception_get_put(reel):
    c = reel["c"]
    cid = _client(reel)
    tid = _ticket_reel(reel, cid)
    assert c.get(f"/api/tickets/{tid}/reception").status_code == 401
    assert c.get(f"/api/tickets/{tid}/reception", headers=_h()).json() == {
        "items": None, "complete": False, "auteur": None, "date_maj": None}
    r = c.put(f"/api/tickets/{tid}/reception", headers=_h(), json={"items": ITEMS, "complete": False})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["complete"] is False and body["auteur"] == "Sophie" and body["date_maj"]
    assert body["items"]["accessoires"] == ["chargeur", "coque", "autre"] and body["items"]["imei_verifie"] == IMEI_OK
    assert body["items"]["tests"]["micro"] is None and body["items"]["tests"]["face_touch_id"] is False
    assert c.get(f"/api/tickets/{tid}/reception", headers=_h()).json() == body
    for _ in range(2):
        r = c.put(f"/api/tickets/{tid}/reception", headers=_h(user="Marc"),
                  json={"items": {**ITEMS, "appareil_eteint": True}, "complete": True})
        assert r.status_code == 200 and r.json()["complete"] is True and r.json()["auteur"] == "Marc"
    assert len(_sql(reel, "SELECT 1 FROM ticket_controles WHERE ticket_id = %s", tid)) == 1
    hist = _sql(reel, "SELECT contenu FROM historique WHERE ticket_id = %s AND type = 'reception'", tid)
    assert [h["contenu"] for h in hist] == ["Fiche de réception validée — par Marc"]
    assert c.put(f"/api/tickets/{tid}/reception", headers=_h(),
                 json={"items": {"imei_verifie": "490154203237519"}, "complete": True}).status_code == 422
    assert c.put("/api/tickets/999999999/reception", headers=_h(), json={"items": {}}).status_code == 404
    assert c.get("/api/tickets/999999999/reception", headers=_h()).status_code == 404
    # Le ticket supprimé emporte sa fiche
    _sql(reel, "DELETE FROM historique WHERE ticket_id = %s", tid)
    _sql(reel, "DELETE FROM tickets WHERE id = %s", tid)
    assert not _sql(reel, "SELECT 1 FROM ticket_controles WHERE ticket_id = %s", tid)


def test_reel_impressions_html_et_pdf(reel):
    c = reel["c"]
    _params(reel, BOUTIQUE_NOM="KLIKTEST", BOUTIQUE_SIRET="11122233300044", BOUTIQUE_TVA_INTRA="FR00111222333",
            TVA_MENTION="", GARANTIE_MOIS="12", RGPD_CONTACT_EMAIL="rgpd@exemple.test")
    cid = _client(reel)
    tid = _ticket_reel(reel, cid, pin="1234")
    c.put(f"/api/tickets/{tid}/reception", headers=_h(), json={"items": ITEMS, "complete": True})
    pages = {k: c.get(f"/api/tickets/{tid}/print/{k}", headers=_h()) for k in ("client", "staff", "combined", "devis", "recu")}
    for kind, r in pages.items():
        assert r.status_code == 200, kind
        for attendu in ("KLIKTEST", "SIRET : 11122233300044", "TVA intracom. : FR00111222333", "Garantie 12 mois",
                        f"KP-{tid:06d}"):
            assert attendu in r.text, (kind, attendu)
        assert "81396114100013" not in r.text and "<script>alert" not in r.text
    staff = pages["staff"].text
    assert "Réception</div>" in staff and "Tests KO : Face ID / Touch ID, Caméra arrière" in staff
    assert "À COMPLÉTER" not in staff and "Chargeur, Coque, Pochette &lt;script&gt;" in staff
    assert "Dépôt constaté" in pages["client"].text and "/confidentialite" in pages["client"].text
    assert "rgpd@exemple.test" in pages["client"].text
    assert pages["combined"].text.count("Réception</div>") == 1
    for kind in ("devis", "recu"):
        r = c.get(f"/api/tickets/{tid}/pdf/{kind}", headers=_h())
        assert r.status_code == 200 and r.content.startswith(b"%PDF")
        texte = _textes_pdf(r.content)
        assert b"KLIKTEST" in texte and b"SIRET : 11122233300044" in texte and b"Garantie 12 mois" in texte
        assert b"81396114100013" not in texte


def test_reel_confidentialite_publique(reel):
    _params(reel, RGPD_RETENTION_MOIS="24", PURGE_CODES_JOURS="15", RGPD_CONTACT_EMAIL="rgpd@exemple.test")
    r = reel["c"].get("/api/public/confidentialite")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"titre", "sections", "maj"}
    titres = [s["titre"] for s in body["sections"]]
    assert {"Responsable du traitement", "Finalités et bases légales", "Destinataires",
            "Durées de conservation", "Vos droits", "Réclamation"} <= set(titres)
    assert "24 mois" in r.text and "15 jours" in r.text and "rgpd@exemple.test" in r.text and "CNIL" in r.text


def test_reel_client_consentements(reel):
    c = reel["c"]
    src = lambda canal: f"{canal}:politique-{mentions.POLITIQUE_VERSION}"  # noqa: E731
    _sql(reel, "DELETE FROM clients WHERE telephone = %s", "0600000902")
    r = c.post("/api/clients", headers=_h(), json={"nom": "Fictif", "prenom": "Élodie", "telephone": "06 00 00 09 02",
                                                    "rgpd_informe": True, "consentement_marketing": True})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["rgpd_informe_le"] and b["consentement_marketing"] is True and b["consentement_marketing_le"]
    assert b["consentement_marketing_source"] == src("comptoir") and b["consentement_marketing_retire_le"] is None
    cid = b["id"]
    premier = b["consentement_marketing_le"]
    ligne = lambda: _sql(reel, "SELECT * FROM clients WHERE id = %s", cid)[0]  # noqa: E731
    # Borne : case décochée par défaut, l'accord donné avant reste
    r = c.post("/api/clients", json={"nom": "X", "telephone": "0600000902", "rgpd_informe": True,
                                     "consentement_marketing": False})
    assert r.json() == {"id": cid}
    row = ligne()
    assert row["consentement_marketing"] is True and row["consentement_marketing_le"].isoformat() == premier
    # Accord redonné au comptoir alors qu'il est acquis : la date d'origine reste
    assert c.patch(f"/api/clients/{cid}", headers=_h(), json={"consentement_marketing": True}).status_code == 200
    assert ligne()["consentement_marketing_le"].isoformat() == premier
    # Retrait explicite au comptoir : daté, l'accord passé reste daté (preuve)
    assert c.patch(f"/api/clients/{cid}", headers=_h(), json={"consentement_marketing": False}).status_code == 200
    row = ligne()
    assert row["consentement_marketing"] is False and row["consentement_marketing_le"].isoformat() == premier
    retrait = row["consentement_marketing_retire_le"]
    assert retrait and retrait.isoformat() >= premier
    g = c.get(f"/api/clients/{cid}", headers=_h()).json()
    assert g["consentement_marketing"] is False and g["rgpd_informe_le"] and g["consentement_marketing_retire_le"]
    # Borne, numéro connu, autre nom : l'accord n'engage pas la personne de la fiche
    r = c.post("/api/clients", json={"nom": "Autre", "prenom": "Élodie", "telephone": "0600000902",
                                     "rgpd_informe": True, "consentement_marketing": True})
    assert r.json() == {"id": cid} and ligne()["consentement_marketing"] is False
    # Même identité (casse et accents ignorés) : accord enregistré, avec son canal
    r = c.post("/api/clients", json={"nom": "FICTIF", "prenom": "elodie", "telephone": "06 00 00 09 02",
                                     "consentement_marketing": True})
    row = ligne()
    assert row["consentement_marketing"] is True and row["consentement_marketing_source"] == src("borne")
    assert row["consentement_marketing_le"] > retrait and row["consentement_marketing_retire_le"] == retrait
    # Sans information RGPD : aucune date posée
    _sql(reel, "DELETE FROM clients WHERE telephone = %s", "0600000903")
    r = c.post("/api/clients", headers=_h(), json={"nom": "Fictif", "telephone": "0600000903"})
    assert r.json()["rgpd_informe_le"] is None and r.json()["consentement_marketing"] is False
    # Nouvelle fiche depuis la borne : accord daté, canal borne
    _sql(reel, "DELETE FROM clients WHERE telephone = %s", "0600000904")
    r = c.post("/api/clients", json={"nom": "Fictif", "telephone": "0600000904", "rgpd_informe": True,
                                     "consentement_marketing": True})
    row = _sql(reel, "SELECT * FROM clients WHERE id = %s", r.json()["id"])[0]
    assert row["consentement_marketing"] is True and row["consentement_marketing_source"] == src("borne")
    assert row["rgpd_informe_le"]
    _sql(reel, "DELETE FROM clients WHERE telephone = ANY(%s)", ["0600000902", "0600000903", "0600000904"])


def test_reel_depot_distance_garde_la_preuve_rgpd(reel, monkeypatch):
    c = reel["c"]
    monkeypatch.setattr(depot_distance, "envoyer_discord_embed", lambda **kw: None)
    _params(reel, DEPOT_DISTANCE_ACTIF=None)
    tels = ["0600000905", "0600000906"]
    _sql(reel, "DELETE FROM tickets WHERE client_id IN (SELECT id FROM clients WHERE telephone = ANY(%s))", tels)
    _sql(reel, "DELETE FROM clients WHERE telephone = ANY(%s)", tels)
    r = c.post("/api/depot-distance", json={"nom": "Fictif", "telephone": "06 00 00 09 05", "panne": "Batterie",
                                             "rgpd_informe": True, "consentement_marketing": True})
    assert r.status_code == 200, r.text
    row = _sql(reel, "SELECT * FROM clients WHERE telephone = %s", tels[0])[0]
    assert row["rgpd_informe_le"] and row["consentement_marketing"] is True
    assert row["consentement_marketing_source"] == f"depot_distance:politique-{mentions.POLITIQUE_VERSION}"
    # Numéro connu, autre nom : seule l'information est datée
    cid = _client(reel, tel=tels[1], nom="Fiche", prenom="")
    r = c.post("/api/depot-distance", json={"nom": "Autre", "telephone": tels[1], "panne": "Batterie",
                                             "rgpd_informe": True, "consentement_marketing": True})
    assert r.status_code == 200
    row = _sql(reel, "SELECT * FROM clients WHERE id = %s", cid)[0]
    assert row["rgpd_informe_le"] and row["consentement_marketing"] is False and row["consentement_marketing_le"] is None
    _sql(reel, "DELETE FROM tickets WHERE client_id IN (SELECT id FROM clients WHERE telephone = ANY(%s))", tels)
    _sql(reel, "DELETE FROM clients WHERE telephone = ANY(%s)", tels)


def test_reel_export_et_anonymisation(reel):
    c = reel["c"]
    cid = _client(reel, email="fictif@exemple.test", societe="Société Fictive")
    tid = _ticket_reel(reel, cid, pin="1234", pattern="1-5-9", tarif_final=189, devis_estime=189,
                       notes_client="Coque à rendre", imei=IMEI_OK, commentaire_client="Merci Sophie",
                       panne_detail="Écran OLED — Pytest l'a fait tomber", notes_internes="Rappeler Pytest",
                       attention="Client pressé")
    _sql(reel, "INSERT INTO notes_tickets (ticket_id, auteur, contenu) VALUES (%s, 'Sophie', 'Note fictive')", tid)
    _sql(reel, "INSERT INTO notes_tickets (ticket_id, auteur, contenu, type_note) VALUES "
               "(%s, 'Sophie', 'Bonjour Pytest, votre iPhone est prêt', 'sms'), "
               "(%s, 'Client', 'Devis validé par le client', 'validation_devis')", tid, tid)
    _sql(reel, "INSERT INTO historique (ticket_id, type, contenu) VALUES (%s, 'note_privee', 'Pytest rappelle'), "
               "(%s, 'statut', 'Statut : Clôturé — par Sophie')", tid, tid)
    _sql(reel, "INSERT INTO fidelite_historique (client_id, ticket_id, type, points, description) "
               "VALUES (%s, %s, 'gain', 189, 'Fictif')", cid, tid)
    _sql(reel, "INSERT INTO devis (numero, client_id, client_nom, client_tel, client_email, total_ttc) "
               "VALUES (%s, %s, 'Fictif', %s, 'fictif@exemple.test', 189)", f"DV-T{cid}", cid, TEL)
    c.put(f"/api/tickets/{tid}/reception", headers=_h(), json={"items": ITEMS, "complete": True})
    _sql(reel, "INSERT INTO attestations (client_id, nom, prenom, adresse, telephone, email, marque, modele, motif) "
               "VALUES (%s, 'Fictif', 'Pytest', '2 rue Fictive', %s, 'fictif@exemple.test', 'Apple', 'iPhone', 'Oxydé')",
         cid, TEL)

    for url in (f"/api/rgpd/clients/{cid}/export", "/api/rgpd/retention/apercu"):
        assert c.get(url, headers=_h()).status_code == 403
    for url in (f"/api/rgpd/clients/{cid}/anonymiser", "/api/rgpd/retention/appliquer"):
        assert c.post(url, headers=_h()).status_code == 403
    assert c.get("/api/rgpd/clients/999999999/export", headers=_h(admin=True)).status_code == 404

    r = c.get(f"/api/rgpd/clients/{cid}/export", headers=_h(admin=True))
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    e = r.json()
    assert e["client"]["telephone"] == TEL and e["client"]["email"] == "fictif@exemple.test"
    t = e["tickets"][0]
    assert t["code_deverrouillage_conserve"] is True and not {"pin", "pattern", "suivi_token"} & set(t)
    assert "1-5-9" not in r.text and e["notes"][0]["contenu"] == "Note fictive"
    assert e["fidelite"][0]["points"] == 189 and e["devis"][0]["client_email"] == "fictif@exemple.test"
    assert e["receptions"][0]["items"]["imei_verifie"] == IMEI_OK
    assert e["attestations"][0]["adresse"] == "2 rue Fictive"

    # Appareil encore en atelier : refus
    r = c.post(f"/api/rgpd/clients/{cid}/anonymiser", headers=_h(admin=True))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "tickets_en_cours"
    _sql(reel, "UPDATE tickets SET statut = 'Clôturé', paye = 1 WHERE id = %s", tid)
    r = c.post(f"/api/rgpd/clients/{cid}/anonymiser", headers=_h(admin=True))
    assert r.status_code == 200 and r.json()["codes_effaces"] == 1 and r.json()["anonymise_le"]
    cl = _sql(reel, "SELECT * FROM clients WHERE id = %s", cid)[0]
    assert (cl["nom"], cl["prenom"], cl["telephone"], cl["email"], cl["societe"]) == (rgpd.NOM_ANONYME, "", "", "", "")
    assert cl["anonymise_le"] and cl["consentement_marketing"] is False
    tk = _sql(reel, "SELECT * FROM tickets WHERE id = %s", tid)[0]
    assert tk["pin"] == "" and tk["pattern"] == "" and float(tk["tarif_final"]) == 189 and float(tk["devis_estime"]) == 189
    assert (tk["imei"], tk["notes_client"], tk["commentaire_client"], tk["notes_internes"], tk["attention"]) == (
        None, None, None, None, None)
    assert tk["panne_detail"] == "Écran OLED" and tk["modele"] == "iPhone 13" and tk["statut"] == "Clôturé"
    notes = {n["type_note"]: n["contenu"] for n in _sql(reel, "SELECT type_note, contenu FROM notes_tickets "
                                                              "WHERE ticket_id = %s", tid)}
    assert notes == {"note": rgpd.MESSAGE_ANONYME, "sms": rgpd.MESSAGE_ANONYME,
                     "validation_devis": "Devis validé par le client"}
    hist = {h["type"]: h["contenu"] for h in _sql(reel, "SELECT type, contenu FROM historique WHERE ticket_id = %s "
                                                        "AND type IN ('note_privee', 'statut')", tid)}
    assert hist == {"note_privee": rgpd.MESSAGE_ANONYME, "statut": "Statut : Clôturé — par Sophie"}
    rc = _sql(reel, "SELECT items FROM ticket_controles WHERE ticket_id = %s", tid)[0]["items"]
    assert rc["imei_verifie"] is None and rc["accessoires_autre"] == "" and rc["etat"]["notes"] == ""
    assert rc["etat"]["ecran"] == "fissure" and rc["accessoires"] == ["chargeur", "coque", "autre"]
    dv = _sql(reel, "SELECT * FROM devis WHERE client_id = %s", cid)[0]
    assert dv["client_nom"] == rgpd.NOM_ANONYME and dv["client_tel"] == "" and float(dv["total_ttc"]) == 189
    at = _sql(reel, "SELECT * FROM attestations WHERE client_id = %s", cid)[0]
    assert (at["nom"], at["adresse"], at["telephone"], at["email"], at["imei"]) == (rgpd.NOM_ANONYME, "", "", "", "")
    assert c.post(f"/api/rgpd/clients/{cid}/anonymiser", headers=_h(admin=True)).json()["deja_anonymise"] is True
    # Journal admin : identifiants seulement
    logs = _sql(reel, "SELECT action, target_id, details FROM admin_audit_log WHERE target_id = %s "
                      "AND action LIKE 'rgpd_%%' ORDER BY id", cid)
    assert [l["action"] for l in logs] == ["rgpd_export", "rgpd_anonymisation"]
    assert not any(x in json.dumps(logs, default=str) for x in (TEL, "Fictif", "fictif@exemple.test"))
    # Le même numéro, revenu au comptoir, crée une nouvelle fiche
    r = c.post("/api/clients", headers=_h(), json={"nom": "Nouveau", "telephone": TEL})
    assert r.status_code == 200 and r.json()["id"] != cid
    r = c.post("/api/clients", headers=_h(), json={"nom": "Vide", "telephone": ""})
    assert r.status_code == 200 and r.json()["id"] != cid
    _sql(reel, "DELETE FROM clients WHERE telephone = %s OR (nom = 'Vide' AND telephone = '')", TEL)


def test_reel_retention_apercu_et_application(reel):
    c = reel["c"]
    _params(reel, RGPD_RETENTION_MOIS="36", PURGE_CODES_JOURS="30")
    assert c.post("/api/rgpd/retention/appliquer", headers=_h(admin=True)).status_code == 200   # base propre
    assert c.get("/api/rgpd/retention/apercu", headers=_h(admin=True)).json()["clients_a_anonymiser"] == 0
    ancien = datetime.now() - timedelta(days=4 * 365)
    texte = lambda jours: (datetime.now() - timedelta(days=jours)).strftime("%Y-%m-%d %H:%M:%S")  # noqa: E731

    vieux = _client(reel, tel="0600000911", date_creation=ancien)
    t_vieux = _ticket_reel(reel, vieux, statut="Clôturé", pin="1111", date_depot=ancien, date_maj=ancien,
                           date_cloture=ancien.strftime("%Y-%m-%d %H:%M:%S"), tarif_final=59)
    vieux_actif = _client(reel, tel="0600000912", date_creation=ancien)
    t_actif = _ticket_reel(reel, vieux_actif, statut="En attente de pièce", pin="2222", date_depot=ancien,
                           date_maj=ancien)
    recent = _client(reel, tel="0600000913")
    t_rendu_40 = _ticket_reel(reel, recent, statut="Rendu au client", pin="3333", date_rendu=texte(40))
    t_rendu_5 = _ticket_reel(reel, recent, statut="Rendu au client", pattern="1-2-3", date_rendu=texte(5))
    t_cloture_iso = _ticket_reel(reel, recent, statut="Clôturé", pin="4444", date_cloture=texte(60)[:10])
    t_cloture_libre = _ticket_reel(reel, recent, statut="Clôturé", pin="5555", date_cloture="hier",
                                   date_maj=datetime.now() - timedelta(days=90))
    t_en_cours = _ticket_reel(reel, recent, statut="Réparation terminée", pin="6666", date_maj=ancien)
    # Sans fiche client : devis libre, demande de la vitrine, attestation saisie à la main
    _sql(reel, "DELETE FROM devis WHERE numero LIKE 'DV-RET-%%'")
    _sql(reel, "DELETE FROM demandes_commandes WHERE modele = 'iPhone RET'")
    _sql(reel, "DELETE FROM attestations WHERE modele = 'iPhone RET'")
    for numero, quand in (("DV-RET-1", ancien), ("DV-RET-2", datetime.now())):
        _sql(reel, "INSERT INTO devis (numero, client_nom, client_tel, total_ttc, date_creation, date_maj) "
                   "VALUES (%s, 'Fictif', '0600000914', 79, %s, %s)", numero, quand, quand)
    for quand in (ancien, datetime.now()):
        _sql(reel, "INSERT INTO demandes_commandes (nom, telephone, email, modele, prix, message, date_creation, date_maj) "
                   "VALUES ('Fictif', '0600000915', 'fictif@exemple.test', 'iPhone RET', 499, 'Rappel', %s, %s)",
             quand, quand)
    _sql(reel, "INSERT INTO attestations (nom, telephone, marque, modele, motif, date_creation) "
               "VALUES ('Fictif', '0600000916', 'Apple', 'iPhone RET', 'Oxydé', %s)", ancien)

    ap = c.get("/api/rgpd/retention/apercu", headers=_h(admin=True)).json()
    assert ap["clients_a_anonymiser"] == 1 and ap["codes_a_purger"] == 4
    assert (ap["devis_a_anonymiser"], ap["demandes_a_anonymiser"], ap["attestations_a_anonymiser"]) == (1, 1, 1)
    assert ap["retention_mois"] == 36 and ap["purge_codes_jours"] == 30
    r = c.post("/api/rgpd/retention/appliquer", headers=_h(admin=True))
    assert r.status_code == 200 and r.json()["clients_anonymises"] == 1 and r.json()["codes_purges"] == 4
    assert (r.json()["devis_anonymises"], r.json()["demandes_anonymisees"], r.json()["attestations_anonymisees"]) == (
        1, 1, 1)
    dv = {d["numero"]: d for d in _sql(reel, "SELECT * FROM devis WHERE numero LIKE 'DV-RET-%%'")}
    assert (dv["DV-RET-1"]["client_nom"], dv["DV-RET-1"]["client_tel"]) == (rgpd.NOM_ANONYME, "")
    assert float(dv["DV-RET-1"]["total_ttc"]) == 79 and dv["DV-RET-2"]["client_tel"] == "0600000914"
    dem = sorted(_sql(reel, "SELECT nom, telephone, email, message, prix FROM demandes_commandes "
                            "WHERE modele = 'iPhone RET' ORDER BY date_creation"), key=lambda d: d["telephone"])
    assert [(d["nom"], d["telephone"], d["email"], d["message"], d["prix"]) for d in dem] == [
        (rgpd.NOM_ANONYME, "", "", "", 499), ("Fictif", "0600000915", "fictif@exemple.test", "Rappel", 499)]
    at = _sql(reel, "SELECT nom, telephone FROM attestations WHERE modele = 'iPhone RET'")[0]
    assert (at["nom"], at["telephone"]) == (rgpd.NOM_ANONYME, "")
    # Garantie plus longue que la conservation (base modifiée à la main) : la garantie l'emporte
    _params(reel, RGPD_RETENTION_MOIS="12", GARANTIE_MOIS="60")
    assert c.get("/api/rgpd/retention/apercu", headers=_h(admin=True)).json()["retention_mois"] == 60
    _params(reel, RGPD_RETENTION_MOIS="36", GARANTIE_MOIS="12")

    codes = {x["id"]: (x["pin"] or "") + (x["pattern"] or "") for x in _sql(
        reel, "SELECT id, pin, pattern FROM tickets WHERE id = ANY(%s)",
        [t_vieux, t_actif, t_rendu_40, t_rendu_5, t_cloture_iso, t_cloture_libre, t_en_cours])}
    assert codes == {t_vieux: "", t_actif: "2222", t_rendu_40: "", t_rendu_5: "1-2-3", t_cloture_iso: "",
                     t_cloture_libre: "", t_en_cours: "6666"}
    noms = {x["id"]: x["nom"] for x in _sql(reel, "SELECT id, nom FROM clients WHERE id = ANY(%s)",
                                             [vieux, vieux_actif, recent])}
    assert noms == {vieux: rgpd.NOM_ANONYME, vieux_actif: "Fictif", recent: "Fictif"}
    assert float(_sql(reel, "SELECT tarif_final FROM tickets WHERE id = %s", t_vieux)[0]["tarif_final"]) == 59
    assert c.get("/api/rgpd/retention/apercu", headers=_h(admin=True)).json()["clients_a_anonymiser"] == 0
    for cid in (vieux, vieux_actif, recent):
        _sql(reel, "DELETE FROM tickets WHERE client_id = %s", cid)
        _sql(reel, "DELETE FROM clients WHERE id = %s", cid)
    _sql(reel, "DELETE FROM devis WHERE numero LIKE 'DV-RET-%%'")
    _sql(reel, "DELETE FROM demandes_commandes WHERE modele = 'iPhone RET'")
    _sql(reel, "DELETE FROM attestations WHERE modele = 'iPhone RET'")


def test_reel_retention_automatique_quotidienne(reel):
    c = reel["c"]
    _params(reel, RGPD_RETENTION_MOIS="36", GARANTIE_MOIS="12", **dict.fromkeys(rgpd.PARAMS_RETENTION))
    c.post("/api/rgpd/retention/appliquer", headers=_h(admin=True))   # base propre
    ancien = datetime.now() - timedelta(days=4 * 365)
    vieux = _client(reel, tel="0600000921", date_creation=ancien)
    nom = lambda cid: _sql(reel, "SELECT nom FROM clients WHERE id = %s", cid)[0]["nom"]  # noqa: E731
    j0 = date(2026, 10, 16)
    # Paramètre absent : désactivée, aucune écriture, rien n'est anonymisé
    assert rgpd.retention_automatique(j0) is None and rgpd.retention_automatique(j0 + timedelta(days=30)) is None
    assert _valeurs(reel, *rgpd.PARAMS_RETENTION) == {} and nom(vieux) == "Fictif"
    # Activée hors API (sans date de début) : premier passage, début daté à J+7, rien n'est anonymisé
    _params(reel, **{rgpd.PARAM_AUTO: "1"})
    assert rgpd.retention_automatique(j0) is None
    debut = (j0 + timedelta(days=rgpd.RETENTION_AUTO_DELAI_JOURS)).isoformat()
    assert _valeurs(reel, rgpd.PARAM_AUTO_DEBUT) == {rgpd.PARAM_AUTO_DEBUT: debut} and nom(vieux) == "Fictif"
    assert rgpd.retention_automatique(j0 + timedelta(days=3)) is None and nom(vieux) == "Fictif"
    # Un autre worker tient le verrou : rien
    with reel["cur"]() as autre:
        autre.execute("SELECT pg_advisory_xact_lock(%s)", (rgpd._VERROU_RETENTION,))
        assert rgpd.retention_automatique(j0 + timedelta(days=7)) is None
    assert nom(vieux) == "Fictif"
    r = rgpd.retention_automatique(j0 + timedelta(days=7))
    assert r["clients_anonymises"] == 1 and nom(vieux) == rgpd.NOM_ANONYME
    assert _valeurs(reel, rgpd.PARAM_AUTO_DERNIERE) == {rgpd.PARAM_AUTO_DERNIERE: debut}
    log = _sql(reel, "SELECT user_login, details, ip_hash FROM admin_audit_log WHERE action = 'rgpd_retention_auto' "
                     "ORDER BY id DESC LIMIT 1")[0]
    assert log["user_login"] == "auto" and log["ip_hash"] == "" and "clients anonymisés : 1" in log["details"]
    # Une fois par jour
    vieux2 = _client(reel, tel="0600000922", date_creation=ancien)
    assert rgpd.retention_automatique(j0 + timedelta(days=7)) is None and nom(vieux2) == "Fictif"
    # Coupée par l'admin : rien
    _params(reel, **{rgpd.PARAM_AUTO: "0"})
    assert rgpd.retention_automatique(j0 + timedelta(days=8)) is None and nom(vieux2) == "Fictif"
    ap = c.get("/api/rgpd/retention/apercu", headers=_h(admin=True)).json()
    assert (ap["auto"], ap["auto_debut"], ap["derniere_execution"]) == (False, None, debut)
    assert ap["clients_a_anonymiser"] == 1
    # Paramètre retiré, ou valeur autre que '1' : toujours désactivée
    for valeur in (None, "", "oui", "true", " 2 "):
        _params(reel, **{rgpd.PARAM_AUTO: valeur})
        assert rgpd.retention_automatique(j0 + timedelta(days=8)) is None and nom(vieux2) == "Fictif"
    _params(reel, **{rgpd.PARAM_AUTO: "1"})
    assert rgpd.retention_automatique(j0 + timedelta(days=8))["clients_anonymises"] == 1
    for cid in (vieux, vieux2):
        _sql(reel, "DELETE FROM clients WHERE id = %s", cid)
    _params(reel, **dict.fromkeys(rgpd.PARAMS_RETENTION))
