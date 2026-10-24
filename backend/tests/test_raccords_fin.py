"""Raccords de fin de chantier : emplacement imprimé en gros sur la fiche atelier, clause de
retrait conforme à la loi du 31 décembre 1903 sur toutes les impressions (plus aucune
mention « 3 mois »), migration de CGV_DEPOT, rétention RGPD automatique DÉSACTIVÉE par
défaut (activation par un admin, premier passage à J+7), paramètres ETAGERE_* écrits par
l'API de configuration, index de la recherche par emplacement. La libération de
l'emplacement au rendu est testée dans tests/test_etagere_chantier.py.

Les tests purs tournent toujours. Ceux sur base réelle exigent la base PostgreSQL JETABLE
de tests/test_lot5_conformite.py (KP_CONFORMITE_DATABASE_URL) : migrations du lifespan
rejouées, rétention appliquée, paramètres réécrits.
"""

import inspect
import re
import zlib
from datetime import date, datetime, timedelta

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import main
from app.api import config as config_api
from app.api import print_tickets, rgpd
from app.services import etagere, mentions
from app.services import params as params_cache
from tests.test_lot5_conformite import (  # noqa: F401 (fixture reel)
    _client, _h, _params, _sql, _textes_pdf, _ticket, _ticket_reel, _valeurs, reel,
)

LONGUE = (
    "Tout appareil réparé, ou dont le devis a été refusé, doit être retiré dès notre avis de mise à "
    "disposition. Conformément à la loi du 31 décembre 1903 relative à la vente de certains objets "
    "abandonnés, un appareil non retiré dans le délai d'un an pourra être vendu aux enchères publiques, "
    "uniquement sur autorisation du juge, le produit de la vente servant à régler les sommes restant dues."
)
COURTE = "Appareil non retiré sous 1 an : vente possible sur autorisation du juge (loi du 31/12/1903)."
# Ancien texte des impressions A4 et PDF (avant le lot 5)
ANCIEN_A4 = ("Garantie pièces et main d'oeuvre : 6 mois. Tout matériel non récupéré sous 3 mois sera "
             "considéré comme abandonné. Klikphone ne peut être tenu responsable de la perte de données.")
ANCIEN_A4_CORRIGE = ("Garantie pièces et main d'oeuvre : 6 mois. Klikphone ne peut être tenu responsable "
                     "de la perte de données.")


def _texte_pdf(pdf: bytes) -> str:
    """Lignes de texte du PDF (multi_cell coupe en lignes), jointes par une espace."""
    lignes = re.findall(rb"\((.*?)\) Tj", _textes_pdf(pdf))
    return " ".join(x.decode("latin-1").replace("\\(", "(").replace("\\)", ")") for x in lignes)


def _avec_delai(monkeypatch, valeur):
    """ETAGERE_DELAI_ABANDON_JOURS lu par les impressions (cache des paramètres simulé)."""
    vrai = params_cache.get_params

    def faux(cles, defauts=None, cur=None):
        out = vrai(cles, defauts, cur=cur)
        if etagere.PARAM_DELAI_ABANDON in cles:
            out[etagere.PARAM_DELAI_ABANDON] = valeur
        return out
    monkeypatch.setattr(params_cache, "get_params", faux)


# ═══ Clause de retrait (loi du 31/12/1903) ═════════════════════════

def test_clause_de_retrait_textes_exacts():
    assert mentions.mention_abandon() == LONGUE
    assert mentions.mention_abandon(365) == LONGUE
    assert mentions.mention_abandon(365, courte=True) == COURTE


@pytest.mark.parametrize("jours, long_, court", [
    (None, "dans le délai d'un an", "sous 1 an"),
    ("abc", "dans le délai d'un an", "sous 1 an"),
    (90, "dans le délai d'un an", "sous 1 an"),       # jamais moins que le minimum légal
    (30, "dans le délai d'un an", "sous 1 an"),
    (400, "dans le délai de 400 jours", "sous 400 jours"),
    (730, "dans le délai de 2 ans", "sous 2 ans"),
    ("1095", "dans le délai de 3 ans", "sous 3 ans"),
])
def test_clause_de_retrait_suit_le_delai(jours, long_, court):
    assert long_ in mentions.mention_abandon(jours)
    assert f"Appareil non retiré {court} :" in mentions.mention_abandon(jours, courte=True)
    assert "3 mois" not in mentions.mention_abandon(jours) + mentions.mention_abandon(jours, courte=True)


def test_plus_aucune_clause_3_mois_dans_les_impressions_ni_les_defauts():
    for source in (inspect.getsource(print_tickets), mentions.CGV_DEPOT_DEFAUT, mentions.SQL_MIGRATION,
                   " ".join(mentions.DEFAUTS.values())):
        assert "sous 3 mois" not in source and "considéré comme abandonné" not in source


@pytest.mark.parametrize("kind", ("client", "combined", "devis", "recu"))
def test_clause_courte_sur_le_papier_thermique(kind):
    html = print_tickets.render_html(_ticket(), kind)
    assert print_tickets._e(COURTE) in html
    assert "1903" not in html.replace(print_tickets._e(COURTE), "")      # une seule fois, pas la longue
    assert "sous 3 mois" not in html


def test_fiche_atelier_sans_clause_client():
    assert "1903" not in print_tickets.render_html(_ticket(), "staff")


@pytest.mark.parametrize("kind", ("devis", "recu"))
def test_clause_longue_en_a4_et_pdf(kind):
    a4 = print_tickets._a4_document(_ticket(), kind)
    assert print_tickets._e(LONGUE) in a4 and "sous 3 mois" not in a4
    texte = _texte_pdf(print_tickets._build_pdf(_ticket(), kind))
    assert LONGUE in texte and "sous 3 mois" not in texte


def test_impressions_suivent_le_parametre_de_delai(monkeypatch):
    _avec_delai(monkeypatch, "730")
    assert "Appareil non retiré sous 2 ans :" in print_tickets.render_html(_ticket(), "client")
    assert "dans le délai de 2 ans" in print_tickets._a4_document(_ticket(), "devis")
    assert "dans le délai de 2 ans" in _texte_pdf(print_tickets._build_pdf(_ticket(), "recu"))
    _avec_delai(monkeypatch, "90")       # inférieur au minimum légal : un an imprimé
    assert print_tickets._e(COURTE) in print_tickets.render_html(_ticket(), "client")


def _flux_texte(pdf: bytes) -> list:
    """Flux de contenu des pages (un par page, dans l'ordre), décompressés."""
    out = []
    for f in re.findall(rb"stream\r?\n(.*?)\r?\nendstream", pdf, re.S):
        try:
            f = zlib.decompress(f)
        except zlib.error:
            pass
        if b") Tj" in f:
            out.append(f)
    return out


@pytest.mark.parametrize("nb_lignes", range(4, 15))
def test_conditions_pdf_d_un_seul_tenant(nb_lignes):
    # Lignes de réparation nombreuses : l'encadré passe en entier à la page suivante
    lignes = "[" + ",".join(f'{{"label": "Prestation {i}", "prix": {40 + i}}}' for i in range(nb_lignes)) + "]"
    for kind in ("devis", "recu"):
        pdf = print_tickets._build_pdf(_ticket(reparation_supp=lignes, acompte=20, reduction_pourcentage=10), kind)
        assert LONGUE in _texte_pdf(pdf)
        pages = [f for f in _flux_texte(pdf) if b"(CONDITIONS) Tj" in f]
        assert len(pages) == 1 and b"restant dues.) Tj" in pages[0], (kind, nb_lignes)


# ═══ Emplacement sur la fiche atelier ══════════════════════════════

def test_emplacement_en_gros_sur_la_fiche_atelier():
    t = _ticket(emplacement="B<3>")
    staff = print_tickets.render_html(t, "staff")
    bloc = '<div class="emplacement-valeur">B&lt;3&gt;</div>'
    assert bloc in staff and "EMPLACEMENT" in staff and "B<3>" not in staff
    assert re.search(r"\.emplacement-valeur \{[^}]*font-size:44px", staff)
    # En tête de fiche : avant le client, la panne et les codes
    assert staff.index(bloc) < staff.index('box-title">Client') < staff.index('box-title">Panne')
    combine = print_tickets.render_html(t, "combined")
    assert combine.count(bloc) == 1 and combine.index(bloc) > combine.index('data-print-page="staff"')
    assert bloc not in print_tickets.render_html(t, "client")


@pytest.mark.parametrize("emplacement", (None, "", "   "))
def test_pas_d_emplacement_pas_de_bloc(emplacement):
    staff = print_tickets.render_html(_ticket(emplacement=emplacement), "staff")
    assert 'class="emplacement"' not in staff
    assert 'class="emplacement"' not in print_tickets.render_html(_ticket(), "staff")   # colonne absente


# ═══ Migrations ════════════════════════════════════════════════════

def test_migration_cgv_ancienne_clause_declaree():
    i = main._DONNEES_FIXES.index(mentions.SQL_MIGRATION_FLAG)
    assert main._DONNEES_FIXES[i + 1] == mentions.SQL_MIGRATION_ABANDON
    assert main._DONNEES_FIXES[i + 2] == mentions.SQL_MIGRATION_ABANDON_FLAG
    sql = mentions.SQL_MIGRATION_ABANDON
    assert "%" not in sql and "%" not in mentions.SQL_MIGRATION_ABANDON_FLAG     # exécutés sans paramètres
    assert mentions.FLAG_MIGRATION_ABANDON in sql and mentions.FLAG_MIGRATION_ABANDON in mentions.SQL_MIGRATION_ABANDON_FLAG
    for clause in mentions.ANCIENNES_CLAUSES_ABANDON:
        assert f"strpos(c.valeur, $kp${clause}$kp$) > 0" in sql
        for motif in (clause + " ", " " + clause, clause):          # phrase et une espace voisine
            assert f"$kp${motif}$kp$, '')" in sql
    assert sql.count("replace(") == 3 * len(mentions.ANCIENNES_CLAUSES_ABANDON)
    assert f"$kp${mentions.CGV_DEPOT_DEFAUT}$kp$) AS valeur" in sql                  # valeur vidée → défaut
    assert f"WHERE cle = '{mentions.FLAG_MIGRATION_ABANDON}')" in sql
    assert mentions.SQL_MIGRATION_ABANDON_FLAG.startswith(
        f"INSERT INTO params (cle, valeur) VALUES ('{mentions.FLAG_MIGRATION_ABANDON}', '1')")
    # Seulement si la valeur est restée celle semée (égale à sa source mentions_legales)
    assert "m.cle = 'mentions_legales'" in sql and "WHERE p.cle IN ('CGV_DEPOT', 'mentions_legales')" in sql


def test_index_recherche_par_emplacement():
    ddl = "CREATE INDEX IF NOT EXISTS idx_tickets_emplacement ON tickets (upper(emplacement)) WHERE emplacement IS NOT NULL"
    assert ddl in main._DDL_INDEXES
    assert main._deja_present(ddl, {"i:idx_tickets_emplacement"})
    assert not main._deja_present(ddl, set())


def test_debut_de_retention_efface_sans_activation_au_demarrage():
    sql = rgpd.SQL_DEBUT_SANS_ACTIVATION
    assert sql in main._DONNEES_FIXES and "%" not in sql
    # Texte fixe : les deux clés écrites en dur sont bien celles du module
    assert sql.startswith(f"DELETE FROM params WHERE cle = '{rgpd.PARAM_AUTO_DEBUT}'\n")
    assert sql.endswith(f"WHERE cle = '{rgpd.PARAM_AUTO}' AND btrim(valeur) = '1')")


def test_sql_de_migration_sans_f_string():
    """CLAUDE.md : aucune f-string dans une requête SQL, même sur des constantes du module."""
    for module, noms in ((mentions, ("SQL_MIGRATION_ABANDON", "SQL_MIGRATION_ABANDON_FLAG")),
                         (rgpd, ("SQL_DEBUT_SANS_ACTIVATION",))):
        source = inspect.getsource(module)
        for nom in noms:
            assert f'{nom} = """' in source and f"{nom} = f" not in source, nom


# ═══ Rétention RGPD : désactivée par défaut ════════════════════════

class _Cur:
    """Curseur simulé : params en mémoire, requêtes journalisées."""

    def __init__(self, params=None):
        self.params = dict(params or {})
        self.sql = []
        self._rows = []

    def execute(self, sql, args=None):
        self.sql.append((" ".join(sql.split()), args))
        s = " ".join(sql.split())
        if "pg_try_advisory_xact_lock" in s:
            self._rows = [{"ok": True}]
        elif s.startswith("SELECT cle, valeur FROM params WHERE cle = ANY"):
            self._rows = [{"cle": k, "valeur": v} for k, v in self.params.items() if k in args[0]]
        elif s.startswith("SELECT valeur FROM params WHERE cle = %s"):
            self._rows = [{"valeur": self.params[args[0]]}] if args[0] in self.params else []
        elif s.startswith("DELETE FROM params WHERE cle = %s"):
            self.params.pop(args[0], None)
        elif s.startswith("INSERT INTO params"):
            self.params[args[0]] = args[1]

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._rows[0] if self._rows else None


@pytest.mark.parametrize("valeur, auto", [
    (None, False), ("", False), ("0", False), ("oui", False), ("true", False), ("2", False),
    ("1", True), (" 1 ", True),
])
def test_retention_auto_seulement_si_activee_explicitement(valeur, auto):
    params = {rgpd.PARAM_AUTO_DEBUT: "2026-10-23", rgpd.PARAM_AUTO_DERNIERE: "2026-10-22"}
    if valeur is not None:
        params[rgpd.PARAM_AUTO] = valeur
    etat = rgpd._etat_auto(_Cur(params))
    assert etat["auto"] is auto
    assert etat["auto_debut"] == ("2026-10-23" if auto else None) and etat["derniere_execution"] == "2026-10-22"


def test_activation_date_le_debut_a_j_plus_7():
    j = date(2026, 10, 16)
    cur = _Cur()
    rgpd.noter_activation(cur, "1", aujourd_hui=j)                        # absent → activée
    assert cur.params == {rgpd.PARAM_AUTO_DEBUT: "2026-10-23"}
    cur = _Cur({rgpd.PARAM_AUTO: "0", rgpd.PARAM_AUTO_DEBUT: "2020-01-01"})
    rgpd.noter_activation(cur, "1", aujourd_hui=j)                        # réactivée : repart de J+7
    assert cur.params[rgpd.PARAM_AUTO_DEBUT] == "2026-10-23"
    cur = _Cur({rgpd.PARAM_AUTO: "1", rgpd.PARAM_AUTO_DEBUT: "2026-10-20"})
    rgpd.noter_activation(cur, "1", aujourd_hui=j)                        # déjà activée : inchangé
    assert cur.params[rgpd.PARAM_AUTO_DEBUT] == "2026-10-20"
    cur = _Cur({rgpd.PARAM_AUTO: "1", rgpd.PARAM_AUTO_DEBUT: "2026-10-20"})
    rgpd.noter_activation(cur, "0", aujourd_hui=j)                        # coupée : début effacé
    assert rgpd.PARAM_AUTO_DEBUT not in cur.params


def test_retention_desactivee_ne_fait_rien(monkeypatch):
    cur = _Cur({rgpd.PARAM_AUTO_DEBUT: "2020-01-01"})
    monkeypatch.setattr(rgpd, "get_cursor", lambda: _ctx(cur))
    monkeypatch.setattr(rgpd, "_appliquer", lambda *a: pytest.fail("anonymisation sans activation"))
    assert rgpd.retention_automatique(date(2026, 10, 30)) is None
    ecritures = [s for s, _ in cur.sql if not s.startswith("SELECT")]
    assert ecritures == []


class _ctx:
    def __init__(self, cur):
        self.cur = cur

    def __enter__(self):
        return self.cur

    def __exit__(self, *exc):
        return False


# ═══ Configuration : clés ETAGERE_* et rétention ═══════════════════

@pytest.mark.parametrize("cle, saisie, stocke", [
    (etagere.PARAM_DELAI_ABANDON, " 0365 ", "365"),
    (etagere.PARAM_DELAI_ABANDON, "400", "400"),
    (etagere.PARAM_DELAI_ABANDON, "3650", "3650"),
    (etagere.PARAM_PALIERS, "3,10;30", "3, 10, 30"),
    (etagere.PARAM_PALIERS, " ", ""),                                   # aucune relance proposée
    (etagere.PARAM_EMPLACEMENTS, " a1, b3 ,a1,, étagère  2", "A1, B3, ÉTAGÈRE 2"),
    (etagere.PARAM_EMPLACEMENTS, "", ""),
    (etagere.PARAM_EMPLACEMENTS, ",".join(f"E{i}" for i in range(40)), ", ".join(f"E{i}" for i in range(40))),
])
def test_cles_etagere_normalisees(cle, saisie, stocke):
    assert config_api._controler_etagere(cle, saisie) == stocke


@pytest.mark.parametrize("cle, saisie", [
    (etagere.PARAM_DELAI_ABANDON, "29"), (etagere.PARAM_DELAI_ABANDON, "3651"),
    # Moins d'un an : contraire à la loi du 31/12/1903 (minimum de la page Config et des impressions)
    (etagere.PARAM_DELAI_ABANDON, "30"), (etagere.PARAM_DELAI_ABANDON, "90"), (etagere.PARAM_DELAI_ABANDON, "364"),
    (etagere.PARAM_DELAI_ABANDON, ""), (etagere.PARAM_DELAI_ABANDON, "abc"),
    (etagere.PARAM_DELAI_ABANDON, "1e3"), (etagere.PARAM_DELAI_ABANDON, "-40"),
    (etagere.PARAM_PALIERS, "10,3"), (etagere.PARAM_PALIERS, "3,3,10"), (etagere.PARAM_PALIERS, "0,3"),
    (etagere.PARAM_PALIERS, "3,x"), (etagere.PARAM_PALIERS, "3,3651"), (etagere.PARAM_PALIERS, "2.5"),
    (etagere.PARAM_EMPLACEMENTS, "A1, " + "X" * 21), (etagere.PARAM_EMPLACEMENTS, "B\x003"),
    (etagere.PARAM_EMPLACEMENTS, ",".join(f"E{i}" for i in range(41))),
])
def test_cles_etagere_refusees(cle, saisie):
    with pytest.raises(HTTPException) as e:
        config_api._controler_etagere(cle, saisie)
    assert e.value.status_code == 400


def test_delai_d_abandon_jamais_sous_un_an():
    assert config_api.DELAI_ABANDON_BORNES == (365, 3650) == (mentions.ABANDON_JOURS_LEGAL, 3650)
    assert etagere.DELAI_ABANDON_JOURS == mentions.ABANDON_JOURS_LEGAL


def test_cles_etagere_et_retention_non_secretes():
    for cle in (*config_api.ETAGERE_KEYS, *rgpd.PARAMS_RETENTION):
        assert not config_api.est_secret(cle), cle


def test_dates_de_retention_gerees_par_le_serveur():
    for cle in (rgpd.PARAM_AUTO_DEBUT, rgpd.PARAM_AUTO_DERNIERE):
        with pytest.raises(HTTPException) as e:
            config_api._controler_retention(cle, "2026-10-23")
        assert e.value.status_code == 400 and "géré par le serveur" in str(e.value.detail)
    config_api._controler_retention(rgpd.PARAM_AUTO, "1")
    config_api._controler_retention(rgpd.PARAM_AUTO, "0")
    with pytest.raises(HTTPException):
        config_api._controler_retention(rgpd.PARAM_AUTO, "oui")


def test_api_config_elevation_et_cache(client, monkeypatch):
    invalidations = []
    monkeypatch.setattr(config_api.params_cache, "invalidate", lambda: invalidations.append(1))
    put = lambda cle, v, admin=False: client.put("/api/config", headers=_h(admin=admin),  # noqa: E731
                                                 json={"cle": cle, "valeur": v})
    # Délai d'abandon (imprimé) et rétention automatique : élévation admin
    for cle, v in ((etagere.PARAM_DELAI_ABANDON, "400"), (rgpd.PARAM_AUTO, "1"), (rgpd.PARAM_AUTO, "0")):
        assert put(cle, v).status_code == 403, cle
        assert put(cle, v, admin=True).status_code == 200, cle
    # Paliers et emplacements : session staff
    assert put(etagere.PARAM_PALIERS, "3,10,30").status_code == 200
    assert put(etagere.PARAM_EMPLACEMENTS, "A1, B3").status_code == 200
    assert put(etagere.PARAM_PALIERS, "10,3").status_code == 400
    assert put(etagere.PARAM_DELAI_ABANDON, "20", admin=True).status_code == 400
    r = put(etagere.PARAM_DELAI_ABANDON, "30", admin=True)
    assert r.status_code == 400 and "365" in r.json()["detail"]
    assert put(rgpd.PARAM_AUTO_DEBUT, "2020-01-01", admin=True).status_code == 400
    assert len(invalidations) == 5
    # Lot : un délai sans élévation bloque tout le lot
    r = client.put("/api/config/batch", headers=_h(), json=[
        {"cle": etagere.PARAM_PALIERS, "valeur": "3"}, {"cle": etagere.PARAM_DELAI_ABANDON, "valeur": "365"}])
    assert r.status_code == 403 and len(invalidations) == 5


# ═══ CGV_DEPOT personnalisé : ancienne clause « 3 mois » signalée ══

@pytest.mark.parametrize("texte", [
    *mentions.ANCIENNES_CLAUSES_ABANDON,
    "CGV maison. Les appareils non récupérés sous trois mois seront considérés comme abandonnés.",
    "Appareil non retiré sous 3 mois : vendu aux enchères.",
    "Passé 3 MOIS, l'appareil devient la propriété du magasin\nMerci.",
])
def test_clause_abandon_obsolete_signalee(texte):
    assert mentions.clause_abandon_obsolete(texte)


@pytest.mark.parametrize("texte", [
    None, "", mentions.CGV_DEPOT_DEFAUT, mentions.mention_abandon(), mentions.mention_abandon(courte=True),
    "Garantie 3 mois pièces et main-d'œuvre.",
    "Devis valable 3 mois. Tout appareil abandonné relève de la loi de 1903.",   # deux phrases distinctes
])
def test_clause_abandon_obsolete_non_signalee(texte):
    assert not mentions.clause_abandon_obsolete(texte)


def test_api_config_signale_une_ancienne_clause_sans_la_reecrire(client, monkeypatch):
    ecrits = []
    monkeypatch.setattr(config_api, "_ecrire_params", lambda cur, lot: ecrits.extend(lot))
    texte = "Conditions maison. " + mentions.ANCIENNES_CLAUSES_ABANDON[0]
    attendu = {"ok": True, "avertissements": [mentions.AVERTISSEMENT_CGV_ABANDON]}
    r = client.put("/api/config", headers=_h(admin=True), json={"cle": "CGV_DEPOT", "valeur": texte})
    assert r.status_code == 200 and r.json() == attendu
    assert ("CGV_DEPOT", texte) in ecrits and ("mentions_legales", texte) in ecrits       # enregistré tel quel
    r = client.put("/api/config/batch", headers=_h(admin=True), json=[
        {"cle": "BOUTIQUE_NOM", "valeur": "Klik"}, {"cle": "CGV_DEPOT", "valeur": texte}])
    assert r.status_code == 200 and r.json() == attendu
    r = client.put("/api/config", headers=_h(admin=True), json={"cle": "CGV_DEPOT", "valeur": mentions.CGV_DEPOT_DEFAUT})
    assert r.json() == {"ok": True}


# ═══ Base réelle ═══════════════════════════════════════════════════

TEL_VIEUX = "0600000931"


def _vieux_client(reel, tel=TEL_VIEUX):
    """Client inactif depuis 4 ans, appareil rendu avec un code : anonymisable et purgeable."""
    ancien = datetime.now() - timedelta(days=4 * 365)
    cid = _client(reel, tel=tel, date_creation=ancien)
    _ticket_reel(reel, cid, statut="Clôturé", pin="1111", date_depot=ancien, date_maj=ancien,
                 date_cloture=ancien.strftime("%Y-%m-%d %H:%M:%S"), tarif_final=59)
    return cid


def _intact(reel, cid) -> bool:
    c = _sql(reel, "SELECT nom, telephone, anonymise_le FROM clients WHERE id = %s", cid)[0]
    pins = [t["pin"] for t in _sql(reel, "SELECT pin FROM tickets WHERE client_id = %s", cid)]
    return c["nom"] == "Fictif" and c["telephone"] and c["anonymise_le"] is None and pins == ["1111"]


def _effacer(reel, *cids):
    for cid in cids:
        _sql(reel, "DELETE FROM tickets WHERE client_id = %s", cid)
        _sql(reel, "DELETE FROM clients WHERE id = %s", cid)


def test_reel_demarrage_sans_aucune_anonymisation(reel):
    _params(reel, RGPD_RETENTION_MOIS="36", GARANTIE_MOIS="12", **dict.fromkeys(rgpd.PARAMS_RETENTION))
    cid = _vieux_client(reel)
    # Démarrage complet (schéma, données, tâche de fond) puis passages du jour : rien
    with TestClient(main.app):
        pass
    main._donnees_de_demarrage()
    aujourd_hui = date.today()
    for j in range(0, 40, 7):
        assert rgpd.retention_automatique(aujourd_hui + timedelta(days=j)) is None
    assert _intact(reel, cid)
    assert _valeurs(reel, *rgpd.PARAMS_RETENTION) == {}                 # aucune écriture
    ap = reel["c"].get("/api/rgpd/retention/apercu", headers=_h(admin=True)).json()
    assert (ap["auto"], ap["auto_debut"], ap["derniere_execution"]) == (False, None, None)
    assert ap["clients_a_anonymiser"] >= 1 and ap["codes_a_purger"] >= 1
    _effacer(reel, cid)


def test_reel_activation_par_l_api_puis_j_plus_7(reel):
    c = reel["c"]
    _params(reel, RGPD_RETENTION_MOIS="36", GARANTIE_MOIS="12", **dict.fromkeys(rgpd.PARAMS_RETENTION))
    c.post("/api/rgpd/retention/appliquer", headers=_h(admin=True))   # base propre
    cid = _vieux_client(reel)
    put = lambda v: c.put("/api/config", headers=_h(admin=True), json={"cle": rgpd.PARAM_AUTO, "valeur": v})  # noqa: E731
    assert c.put("/api/config", headers=_h(), json={"cle": rgpd.PARAM_AUTO, "valeur": "1"}).status_code == 403
    assert _valeurs(reel, *rgpd.PARAMS_RETENTION) == {}

    j0 = date.today()
    debut = (j0 + timedelta(days=rgpd.RETENTION_AUTO_DELAI_JOURS)).isoformat()
    assert put("1").status_code == 200
    assert _valeurs(reel, rgpd.PARAM_AUTO, rgpd.PARAM_AUTO_DEBUT) == {rgpd.PARAM_AUTO: "1", rgpd.PARAM_AUTO_DEBUT: debut}
    ap = c.get("/api/rgpd/retention/apercu", headers=_h(admin=True)).json()
    assert (ap["auto"], ap["auto_debut"], ap["derniere_execution"]) == (True, debut, None)
    assert ap["clients_a_anonymiser"] == 1
    # Grâce de 7 jours depuis l'activation : rien avant, réécrire « 1 » ne la décale pas
    for j in range(rgpd.RETENTION_AUTO_DELAI_JOURS):
        assert rgpd.retention_automatique(j0 + timedelta(days=j)) is None
    assert put("1").status_code == 200 and _valeurs(reel, rgpd.PARAM_AUTO_DEBUT)[rgpd.PARAM_AUTO_DEBUT] == debut
    # Le début n'est pas modifiable par l'API
    assert c.put("/api/config", headers=_h(admin=True),
                 json={"cle": rgpd.PARAM_AUTO_DEBUT, "valeur": j0.isoformat()}).status_code == 400
    assert _intact(reel, cid)
    r = rgpd.retention_automatique(j0 + timedelta(days=rgpd.RETENTION_AUTO_DELAI_JOURS))
    assert r["clients_anonymises"] == 1 and not _intact(reel, cid)

    # Coupée : début effacé, plus rien ; réactivée : nouvelle grâce de 7 jours
    cid2 = _vieux_client(reel, tel="0600000932")
    assert put("0").status_code == 200
    assert _valeurs(reel, rgpd.PARAM_AUTO_DEBUT) == {}
    assert rgpd.retention_automatique(j0 + timedelta(days=30)) is None and _intact(reel, cid2)
    ap = c.get("/api/rgpd/retention/apercu", headers=_h(admin=True)).json()
    assert (ap["auto"], ap["auto_debut"]) == (False, None)
    assert put("1").status_code == 200
    assert _valeurs(reel, rgpd.PARAM_AUTO_DEBUT) == {rgpd.PARAM_AUTO_DEBUT: debut}
    with reel["cur"]() as cur:                           # réactivation un autre jour : date de ce jour + 7
        rgpd.noter_activation(cur, "0")
        cur.execute("UPDATE params SET valeur = '0' WHERE cle = %s", (rgpd.PARAM_AUTO,))
        rgpd.noter_activation(cur, "1", aujourd_hui=date(2027, 1, 1))
        cur.execute("SELECT valeur FROM params WHERE cle = %s", (rgpd.PARAM_AUTO_DEBUT,))
        assert cur.fetchone()["valeur"] == "2027-01-08"
    _effacer(reel, cid, cid2)
    _params(reel, **dict.fromkeys(rgpd.PARAMS_RETENTION))


def test_reel_debut_orphelin_efface_au_demarrage(reel):
    _params(reel, **{rgpd.PARAM_AUTO: None, rgpd.PARAM_AUTO_DEBUT: "2020-01-01"})
    main._donnees_de_demarrage()
    assert _valeurs(reel, rgpd.PARAM_AUTO_DEBUT) == {}
    _params(reel, **{rgpd.PARAM_AUTO: "0", rgpd.PARAM_AUTO_DEBUT: "2020-01-01"})
    main._donnees_de_demarrage()
    assert _valeurs(reel, rgpd.PARAM_AUTO_DEBUT) == {}
    # Activée : son début est conservé
    _params(reel, **{rgpd.PARAM_AUTO: "1", rgpd.PARAM_AUTO_DEBUT: "2026-10-23"})
    main._donnees_de_demarrage()
    assert _valeurs(reel, rgpd.PARAM_AUTO_DEBUT) == {rgpd.PARAM_AUTO_DEBUT: "2026-10-23"}
    _params(reel, **dict.fromkeys(rgpd.PARAMS_RETENTION))


def test_reel_cgv_ancienne_clause_retiree_si_restee_semee(reel):
    avant = _valeurs(reel, "CGV_DEPOT", "mentions_legales", mentions.FLAG_MIGRATION, mentions.FLAG_MIGRATION_ABANDON)
    flag = mentions.FLAG_MIGRATION_ABANDON
    try:
        # Semée depuis l'ancienne clé, jamais modifiée : seule la phrase « 3 mois » part, dans les deux clés
        _params(reel, CGV_DEPOT=ANCIEN_A4, mentions_legales=ANCIEN_A4, **{flag: None})
        main._donnees_de_demarrage()
        assert _valeurs(reel, "CGV_DEPOT", "mentions_legales", flag) == {
            "CGV_DEPOT": ANCIEN_A4_CORRIGE, "mentions_legales": ANCIEN_A4_CORRIGE, flag: "1"}
        # Une seule fois (drapeau)
        _params(reel, CGV_DEPOT=ANCIEN_A4, mentions_legales=ANCIEN_A4)
        main._donnees_de_demarrage()
        assert _valeurs(reel, "CGV_DEPOT")["CGV_DEPOT"] == ANCIEN_A4
        # Texte personnalisé (différent de sa source) : jamais touché
        perso = "Mon texte à moi.\nTout matériel non récupéré sous 3 mois sera considéré comme abandonné."
        _params(reel, CGV_DEPOT=perso, mentions_legales=ANCIEN_A4, **{flag: None})
        main._donnees_de_demarrage()
        assert _valeurs(reel, "CGV_DEPOT", "mentions_legales") == {"CGV_DEPOT": perso, "mentions_legales": ANCIEN_A4}
        # Sans ancienne clause : rien ; vidée par le retrait : défaut du semis
        _params(reel, CGV_DEPOT="Texte sans clause", mentions_legales="Texte sans clause", **{flag: None})
        main._donnees_de_demarrage()
        assert _valeurs(reel, "CGV_DEPOT")["CGV_DEPOT"] == "Texte sans clause"
        seule = mentions.ANCIENNES_CLAUSES_ABANDON[1]
        _params(reel, CGV_DEPOT=seule, mentions_legales=f" {seule} ", **{flag: None})
        main._donnees_de_demarrage()
        assert _valeurs(reel, "CGV_DEPOT")["CGV_DEPOT"] == mentions.CGV_DEPOT_DEFAUT
        # Base d'avant le lot 5 : semis depuis mentions_legales puis retrait, au même démarrage
        _params(reel, CGV_DEPOT=None, mentions_legales=ANCIEN_A4, **{flag: None, mentions.FLAG_MIGRATION: None})
        main._donnees_de_demarrage()
        assert _valeurs(reel, "CGV_DEPOT")["CGV_DEPOT"] == ANCIEN_A4_CORRIGE
        params_cache.invalidate()
        assert "3 mois" not in reel["c"].get("/api/config/public").json()["CGV_DEPOT"]
    finally:
        _params(reel, **{k: avant.get(k) for k in ("CGV_DEPOT", "mentions_legales", mentions.FLAG_MIGRATION, flag)})


def test_reel_config_cles_etagere(reel):
    c = reel["c"]
    cles = (etagere.PARAM_DELAI_ABANDON, etagere.PARAM_PALIERS, etagere.PARAM_EMPLACEMENTS)
    avant = _valeurs(reel, *cles)
    try:
        assert c.put("/api/config", headers=_h(), json={"cle": etagere.PARAM_EMPLACEMENTS, "valeur": "b1, a2,b1"}).status_code == 200
        assert c.put("/api/config", headers=_h(), json={"cle": etagere.PARAM_PALIERS, "valeur": "5;12, 40"}).status_code == 200
        assert c.put("/api/config", headers=_h(), json={"cle": etagere.PARAM_DELAI_ABANDON, "valeur": "730"}).status_code == 403
        assert c.put("/api/config", headers=_h(admin=True), json={"cle": etagere.PARAM_DELAI_ABANDON, "valeur": "730"}).status_code == 200
        assert c.put("/api/config", headers=_h(), json={"cle": etagere.PARAM_PALIERS, "valeur": "40,5"}).status_code == 400
        assert _valeurs(reel, *cles) == {etagere.PARAM_EMPLACEMENTS: "B1, A2", etagere.PARAM_PALIERS: "5, 12, 40",
                                         etagere.PARAM_DELAI_ABANDON: "730"}
        # Cache invalidé : la configuration de l'étagère et les impressions suivent tout de suite
        conf = c.get("/api/etagere/config", headers=_h()).json()
        assert (conf["emplacements"], conf["relance_paliers"], conf["delai_abandon_jours"]) == (["B1", "A2"], [5, 12, 40], 730)
        assert all(r["valeur"] != "••••" for r in c.get("/api/config", headers=_h()).json() if r["cle"] in cles)
        # Moins d'un an : refusé à l'écriture, valeur d'avant gardée
        r = c.put("/api/config", headers=_h(admin=True), json={"cle": etagere.PARAM_DELAI_ABANDON, "valeur": "30"})
        assert r.status_code == 400
        assert _valeurs(reel, etagere.PARAM_DELAI_ABANDON) == {etagere.PARAM_DELAI_ABANDON: "730"}
        # Posé hors API (SQL, ancienne version) : lu comme un an partout, jamais « 3 mois » à l'écran
        _params(reel, **{etagere.PARAM_DELAI_ABANDON: "90"})
        assert c.get("/api/etagere/config", headers=_h()).json()["delai_abandon_jours"] == 365
        vue = c.get("/api/tickets/stats/dashboard", params={"vue": "a_recuperer"}, headers=_h())
        assert vue.status_code == 200 and vue.json()["delai_abandon_jours"] == 365
    finally:
        _params(reel, **{k: avant.get(k) for k in cles})


def test_reel_impressions_emplacement_et_clause(reel):
    c = reel["c"]
    avant = _valeurs(reel, etagere.PARAM_DELAI_ABANDON)
    cid = _client(reel, tel="0600000933")
    tid = _ticket_reel(reel, cid, statut="Réparation terminée")
    try:
        # Délai par défaut (un an), quelle que soit la valeur laissée dans la base de test
        _params(reel, **{etagere.PARAM_DELAI_ABANDON: None})
        assert c.put(f"/api/etagere/{tid}/emplacement", headers=_h(), json={"emplacement": " b3 "}).status_code == 200
        bloc = '<div class="emplacement-valeur">B3</div>'
        pages = {k: c.get(f"/api/tickets/{tid}/print/{k}", headers=_h()).text for k in ("client", "staff", "combined", "devis", "recu")}
        assert bloc in pages["staff"] and pages["combined"].count(bloc) == 1 and bloc not in pages["client"]
        for kind in ("client", "combined", "devis", "recu"):
            assert print_tickets._e(COURTE) in pages[kind], kind
        for kind in ("devis", "recu"):
            assert LONGUE in _texte_pdf(c.get(f"/api/tickets/{tid}/pdf/{kind}", headers=_h()).content)
        _params(reel, **{etagere.PARAM_DELAI_ABANDON: "730"})
        assert "Appareil non retiré sous 2 ans :" in c.get(f"/api/tickets/{tid}/print/client", headers=_h()).text
        # Rendu : l'emplacement est libéré, la fiche ne l'imprime plus
        _sql(reel, "UPDATE tickets SET paye = 1 WHERE id = %s", tid)
        assert c.patch(f"/api/tickets/{tid}/statut", headers=_h(), json={"statut": "Rendu au client"}).status_code == 200
        assert 'class="emplacement"' not in c.get(f"/api/tickets/{tid}/print/staff", headers=_h()).text
    finally:
        _params(reel, **{etagere.PARAM_DELAI_ABANDON: avant.get(etagere.PARAM_DELAI_ABANDON)})
        _effacer(reel, cid)


def test_reel_emplacement_refuse_sur_un_appareil_rendu(reel):
    c = reel["c"]
    cid = _client(reel, tel="0600000934")
    put = lambda tid, v: c.put(f"/api/etagere/{tid}/emplacement", headers=_h(), json={"emplacement": v})  # noqa: E731
    try:
        for statut in etagere.STATUTS_RENDUS:
            tid = _ticket_reel(reel, cid, statut=statut, paye=1)
            r = put(tid, "C1")
            assert r.status_code == 409 and r.json()["detail"]["code"] == "deja_rendu", statut
            assert _sql(reel, "SELECT emplacement FROM tickets WHERE id = %s", tid)[0]["emplacement"] is None
            assert not _sql(reel, "SELECT 1 FROM historique WHERE ticket_id = %s AND type = 'etagere'", tid)
        # Emplacement resté posé (rendu d'avant le branchement) : le retirer reste permis
        _sql(reel, "UPDATE tickets SET emplacement = 'B3' WHERE id = %s", tid)
        assert put(tid, "A1").status_code == 409
        r = put(tid, None)
        assert r.status_code == 200 and r.json() == {"emplacement": None}
        lignes = [x["contenu"] for x in _sql(reel, "SELECT contenu FROM historique WHERE ticket_id = %s", tid)]
        assert lignes == ["Emplacement B3 libéré — par Sophie"]
        # Encore en boutique : rangé normalement
        tid = _ticket_reel(reel, cid, statut="Réparation terminée")
        assert put(tid, "c1").json() == {"emplacement": "C1"}
    finally:
        _effacer(reel, cid)


def test_reel_index_emplacement(reel):
    rows = _sql(reel, "SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_tickets_emplacement'")
    assert rows and "upper(emplacement)" in rows[0]["indexdef"] and "WHERE (emplacement IS NOT NULL)" in rows[0]["indexdef"]
