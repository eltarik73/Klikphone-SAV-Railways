"""Tombola des clients (services/tombola, api/tombola) : gratuite, une chance par numéro, tirage daté.

Tests unitaires (règles, SQL paramétré, routes, curseurs simulés), puis tests réels sur PostgreSQL
quand KP_TEST_DATABASE_URL désigne une base migrée ; sans elle, ces derniers sont ignorés. Les
données sont fictives et écrites dans une transaction annulée à la fin de chaque test.
"""

import os
import random
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from app.api.auth import create_admin_token, create_token, decode_token
from app.services import tombola as T


def _h(admin=False, user="Sophie"):
    tok = create_token("accueil", user)
    h = {"Authorization": f"Bearer {tok}"}
    if admin:
        h["X-Admin-Token"] = create_admin_token(decode_token(tok))
    return h


@pytest.fixture(autouse=True)
def _cache_vide():
    T.oublier_cache()
    yield
    T.oublier_cache()


class Curseur:
    """Curseur simulé : chaque requête reçoit la réponse du premier motif qu'elle contient."""

    def __init__(self, reponses=None):
        self.reponses = list(reponses or [])
        self.requetes = []
        self.rowcount = 0
        self._courant = None

    def execute(self, sql, params=None):
        texte = " ".join(str(sql).split())
        self.requetes.append((texte, params))
        self._courant = None
        for motif, valeur in self.reponses:
            if motif in texte:
                self._courant = valeur(params) if callable(valeur) else valeur
                break

    def fetchone(self):
        v = self._courant
        if isinstance(v, list):
            return v[0] if v else None
        return v

    def fetchall(self):
        v = self._courant
        if v is None:
            return []
        return v if isinstance(v, list) else [v]

    def sql(self, motif):
        return [(s, p) for s, p in self.requetes if motif in s]


def _sur(cur):
    @contextmanager
    def cm():
        yield cur
    return cm


DATE = datetime(2026, 12, 20, 17, 0, tzinfo=timezone.utc)   # 18 h à Paris
OUVERTE = {"id": 7, "titre": "Tombola de Noël", "lots": "iPhone 13 reconditionné\nÉcouteurs sans fil",
           "tirage_le": DATE, "statut": "ouverte", "reglement": None}


# ─── RÈGLES ──────────────────────────────────────────────────────
def test_aucune_notion_de_mise_dans_le_modele():
    """Gratuite par construction : ni prix, ni ticket payant, ni montant d'achat dans le schéma."""
    from app import main
    ddl = " ".join(s for s in main._DDL_TABLES + main._DDL_ALTERS if "tombola" in s).lower()
    assert "create table if not exists tombolas" in ddl and "tombola_participations" in ddl
    for interdit in ("prix", "montant", "mise", "tarif", "paiement", "achat"):
        assert interdit not in ddl
    assert "unique (tombola_id, cle_personne)" in ddl


def test_lots_un_par_ligne():
    assert T.lots_liste(" iPhone 13 \n\n  Écouteurs   sans fil \n") == ["iPhone 13", "Écouteurs sans fil"]
    assert T.lots_liste(["A", "", " B "]) == ["A", "B"]
    assert T.lots_texte(["A", "B"]) == "A\nB"
    assert T.lots_liste(None) == []


def test_date_saisie_a_l_heure_de_paris():
    hiver = T.date_paris("2026-12-20T18:00")
    assert hiver.utcoffset() == timedelta(hours=1) and hiver.astimezone(timezone.utc).hour == 17
    ete = T.date_paris("2026-07-04T18:00")
    assert ete.utcoffset() == timedelta(hours=2)
    assert T.date_paris("2026-12-20T17:00:00Z").utcoffset() == timedelta(0)
    with pytest.raises(ValueError):
        T.date_paris("le 20 décembre")


def test_date_lisible():
    assert T.date_lisible(DATE) == "dimanche 20 décembre 2026 à 18 h"
    assert T.date_lisible(datetime(2027, 1, 1, 9, 30, tzinfo=timezone.utc)) == "vendredi 1er janvier 2027 à 10 h 30"
    assert T.date_lisible(None) == ""


def test_reglement_par_defaut_dit_gratuit_et_sans_achat():
    r = T.reglement_defaut(OUVERTE, {"nom": "KLIKPHONE", "adresse": "79 Place Saint-Léger, 73000 Chambéry"})
    assert "ne coûte rien" in r and "aucun achat" in r and "ni mise" in r
    assert "KLIKPHONE, 79 Place Saint-Léger" in r
    assert "1er tiré : iPhone 13 reconditionné" in r and "2e tiré : Écouteurs sans fil" in r
    assert "dimanche 20 décembre 2026 à 18 h" in r
    assert "même chance" in r and f"{T.PURGE_JOURS} jours" in r
    seul = T.reglement_defaut({**OUVERTE, "lots": "Une coque"}, {})
    assert "Lot. Offert par Klikphone : Une coque." in seul


def test_reglement_du_gerant_remplace_le_defaut():
    assert T.reglement_effectif({**OUVERTE, "reglement": "  Mon règlement  "}) == "Mon règlement"
    with patch.object(T, "_boutique", return_value={"nom": "KLIKPHONE"}):
        assert "KLIKPHONE" in T.reglement_effectif(OUVERTE)


def test_vue_publique_sans_participants():
    with patch.object(T, "_boutique", return_value={}):
        p = T.publique(OUVERTE)
    assert set(p) == {"id", "titre", "lots", "tirage_le", "reglement"}
    assert p["lots"] == ["iPhone 13 reconditionné", "Écouteurs sans fil"]
    assert p["tirage_le"] == "2026-12-20T17:00:00+00:00"


# ─── INSCRIPTION ─────────────────────────────────────────────────
def test_une_participation_par_numero_quel_que_soit_le_format():
    assert T.cle_personne("06 12 34 56 78") == T.cle_personne("0612345678") == T.cle_personne("+33 6 12 34 56 78")
    assert T.cle_personne("") is None and T.cle_personne(None) is None


def test_inscrire_sans_tombola_ouverte():
    cur = Curseur()
    assert T.inscrire(cur, 3, "0612345678", "borne") is None
    assert not cur.sql("INSERT INTO tombola_participations")


def test_inscrire_insere_une_fois():
    cur = Curseur([("FROM tombolas", OUVERTE), ("INSERT INTO tombola_participations", {"id": 41})])
    r = T.inscrire(cur, 3, "06 12 34 56 78", "borne")
    assert r == {"tombola_id": 7, "nouvelle": True, "id": 41}
    sql, params = cur.sql("INSERT INTO tombola_participations")[0]
    assert "ON CONFLICT (tombola_id, cle_personne) DO NOTHING" in sql
    assert params == (7, 3, T.cle_personne("0612345678"), "borne", None)
    assert "statut = 'ouverte' AND tirage_le > NOW()" in cur.sql("FROM tombolas")[0][0]


def test_inscrire_deja_inscrit():
    cur = Curseur([("FROM tombolas", OUVERTE)])   # ON CONFLICT : aucune ligne rendue
    assert T.inscrire(cur, 3, "0612345678", "borne") == {"tombola_id": 7, "nouvelle": False, "id": None}


def test_inscrire_sans_numero():
    cur = Curseur([("FROM tombolas", OUVERTE)])
    assert T.inscrire(cur, 3, "", "borne") is None


def test_inscription_ne_bloque_jamais_le_depot():
    cur = MagicMock()
    with patch.object(T, "inscrire", side_effect=RuntimeError("table absente")):
        assert T.inscrire_sans_bloquer(cur, 3, "0612345678", "borne") is False
    ordres = [c.args[0] for c in cur.execute.call_args_list]
    assert ordres == ["SAVEPOINT kp_tombola", "ROLLBACK TO SAVEPOINT kp_tombola"]
    cur = MagicMock()
    with patch.object(T, "inscrire", return_value={"tombola_id": 7, "nouvelle": False}):
        assert T.inscrire_sans_bloquer(cur, 3, "0612345678", "borne") is True


# ─── TIRAGE ──────────────────────────────────────────────────────
def _curseur_tirage(candidats, tombola=OUVERTE):
    return Curseur([("FROM tombolas WHERE id = %s FOR UPDATE", tombola),
                    ("FROM tombola_participations p JOIN clients", [{"id": i} for i in candidats])])


def test_tirer_autant_de_gagnants_que_de_lots():
    cur = _curseur_tirage(range(1, 51))
    r = T.tirer(cur, 7, "Tarik", rng=random.Random(1))
    assert r["participants"] == 50 and r["lots"] == 2 and len(set(r["gagnants"])) == 2
    rangs = [p for s, p in cur.sql("SET rang = %s, tire_le = NOW()")]
    assert [p[0] for p in rangs] == [1, 2] and [p[1] for p in rangs] == r["gagnants"]
    sql, params = cur.sql("UPDATE tombolas SET statut = 'tiree'")[0]
    assert params == ("Tarik", 50, 7)


def test_tirer_moins_de_participants_que_de_lots():
    cur = _curseur_tirage([9])
    r = T.tirer(cur, 7, T.AUTEUR_AUTO, rng=random.Random(1))
    assert r["gagnants"] == [9] and r["participants"] == 1


def test_tirer_sans_participant():
    cur = _curseur_tirage([])
    r = T.tirer(cur, 7, T.AUTEUR_AUTO)
    assert r["gagnants"] == [] and r["participants"] == 0
    assert cur.sql("UPDATE tombolas SET statut = 'tiree'")


def test_tirer_une_seule_fois():
    for statut in ("tiree", "annulee"):
        cur = _curseur_tirage([1, 2, 3], {**OUVERTE, "statut": statut})
        assert T.tirer(cur, 7, "Tarik") is None
        assert not cur.sql("SET rang")
    assert T.tirer(_curseur_tirage([1], None), 7, "Tarik") is None


def test_candidats_joignables_et_jamais_tires():
    sql = " ".join(T._SQL_CANDIDATS.split())
    assert "p.rang IS NULL" in sql and "c.anonymise_le IS NULL" in sql and "btrim(c.telephone)" in sql


def test_tirage_equitable():
    """Chaque inscrit a la même chance : sur 6 000 tirages à 1 lot parmi 6, chacun gagne ≈ 1 000 fois."""
    rng = random.Random(2026)
    gains = {i: 0 for i in range(1, 7)}
    seul_lot = {**OUVERTE, "lots": "Un lot"}
    for _ in range(6000):
        r = T.tirer(_curseur_tirage(range(1, 7), seul_lot), 7, "Tarik", rng=rng)
        gains[r["gagnants"][0]] += 1
    assert all(880 <= n <= 1120 for n in gains.values()), gains


def test_tirage_par_defaut_avec_l_alea_du_systeme():
    with patch.object(T.secrets, "SystemRandom") as alea:
        alea.return_value.sample.return_value = [3, 1]
        r = T.tirer(_curseur_tirage([1, 2, 3]), 7, "Tarik")
    assert r["gagnants"] == [3, 1]
    alea.return_value.sample.assert_called_once_with([1, 2, 3], 2)


def _curseur_remplacement(gagnant, candidats):
    return Curseur([("FOR UPDATE OF p, t", gagnant),
                    ("FROM tombola_participations p JOIN clients", [{"id": i} for i in candidats])])


GAGNANT = {"id": 12, "tombola_id": 7, "rang": 2, "remplace_le": None, "lot_remis_le": None, "statut": "tiree"}


def test_remplacer_tire_un_autre_inscrit_pour_le_meme_lot():
    cur = _curseur_remplacement(GAGNANT, [30, 31, 32])
    r = T.remplacer(cur, 12, "Tarik", rng=random.Random(3))
    assert r["rang"] == 2 and r["id"] in (30, 31, 32) and r["tombola_id"] == 7
    assert cur.sql("SET remplace_le = NOW()")[0][1] == (12,)
    assert cur.sql("SET rang = %s, tire_le = NOW()")[0][1] == (2, r["id"])


@pytest.mark.parametrize("gagnant, candidats, code", [
    (None, [1], "introuvable"),
    ({**GAGNANT, "rang": None}, [1], "pas_gagnant"),
    ({**GAGNANT, "remplace_le": DATE}, [1], "pas_gagnant"),
    ({**GAGNANT, "statut": "ouverte"}, [1], "pas_gagnant"),
    ({**GAGNANT, "lot_remis_le": DATE}, [1], "lot_remis"),
    (GAGNANT, [], "plus_personne"),
])
def test_remplacer_refus(gagnant, candidats, code):
    cur = _curseur_remplacement(gagnant, candidats)
    with pytest.raises(T.Refus) as e:
        T.remplacer(cur, 12, "Tarik")
    assert e.value.code == code
    assert not cur.sql("SET remplace_le")


def test_tirages_dus_une_seule_fois_entre_workers():
    cur = Curseur([("tirage_le <= NOW()", [{"id": 7}]),
                   ("FROM tombolas WHERE id = %s FOR UPDATE", OUVERTE),
                   ("FROM tombola_participations p JOIN clients", [{"id": 1}, {"id": 2}, {"id": 3}])])
    with patch.object(T, "get_cursor", _sur(cur)), patch.object(T, "_prevenir_equipe") as prevenir:
        faits = T.tirages_dus()
    assert len(faits) == 1 and faits[0]["participants"] == 3 and len(faits[0]["gagnants"]) == 2
    assert "FOR UPDATE SKIP LOCKED" in cur.sql("tirage_le <= NOW()")[0][0]
    prevenir.assert_called_once()


def test_tirages_dus_rien_a_faire():
    cur = Curseur()
    with patch.object(T, "get_cursor", _sur(cur)), patch.object(T, "_prevenir_equipe") as prevenir:
        assert T.tirages_dus() == []
    prevenir.assert_not_called()


def test_equipe_prevenue_sans_nom_de_client():
    r = {"id": 7, "titre": "Tombola de Noël", "participants": 50, "gagnants": [4, 9], "lots": 2}
    with patch("app.api.notifications_center.push_notification") as push:
        T._prevenir_equipe(r)
    kw = push.call_args.kwargs
    assert kw["type"] == "tombola_tirage" and kw["action_url"] == "/accueil/tombola"
    assert "2 gagnants à prévenir" in kw["message"] and "50 participants" in kw["message"]
    with patch("app.api.notifications_center.push_notification", side_effect=RuntimeError):
        T._prevenir_equipe(r)   # jamais d'erreur vers l'appelant


def test_purge_des_non_gagnants():
    cur = Curseur()
    cur.rowcount = 12
    with patch.object(T, "get_cursor", _sur(cur)):
        assert T.purger_anciennes() == 12
    sql, params = cur.sql("DELETE FROM tombola_participations")[0]
    assert "p.rang IS NULL" in sql and "t.statut = 'tiree'" in sql and params == (T.PURGE_JOURS,)


def test_tache_de_fond_coupee_par_variable(monkeypatch):
    monkeypatch.setenv("KP_TOMBOLA_AUTO", "0")
    T._tache["thread"] = None
    T.demarrer_tirage_automatique()
    assert T._tache["thread"] is None


# ─── ROUTES ──────────────────────────────────────────────────────
def test_en_cours_public_sans_session(client):
    with patch.object(T, "get_cursor", _sur(Curseur([("FROM tombolas", OUVERTE)]))), \
         patch.object(T, "_boutique", return_value={}):
        r = client.get("/api/tombola/en-cours")
    assert r.status_code == 200
    t = r.json()["tombola"]
    assert t["titre"] == "Tombola de Noël" and len(t["lots"]) == 2 and "reglement" in t
    assert "participants" not in t and "gagnants" not in t


def test_en_cours_public_aucune(client):
    with patch.object(T, "get_cursor", _sur(Curseur())):
        assert client.get("/api/tombola/en-cours").json() == {"tombola": None}


def test_en_cours_public_en_cache():
    cur = Curseur([("FROM tombolas", OUVERTE)])
    with patch.object(T, "get_cursor", _sur(cur)), patch.object(T, "_boutique", return_value={}):
        a = T.en_cours_publique(maintenant=100.0)
        b = T.en_cours_publique(maintenant=110.0)
        assert a == b and len(cur.requetes) == 1
        T.en_cours_publique(maintenant=100.0 + T._CACHE_S + 1)
        assert len(cur.requetes) == 2


def test_liste_reservee_au_personnel(client):
    assert client.get("/api/tombola").status_code in (401, 403)
    assert client.get("/api/tombola/7").status_code in (401, 403)


DANS_UN_MOIS = (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%dT%H:%M")
CREATION = {"titre": "Tombola de Noël", "lots": ["iPhone 13 reconditionné"], "tirage_le": DANS_UN_MOIS}


@pytest.mark.parametrize("methode, chemin, corps", [
    ("post", "/api/tombola", CREATION),
    ("patch", "/api/tombola/7", {"titre": "Autre"}),
    ("post", "/api/tombola/7/tirage", None),
    ("post", "/api/tombola/7/annuler", None),
    ("post", "/api/tombola/participations/12/remplacer", None),
])
def test_actions_du_gerant_exigent_l_elevation(client, methode, chemin, corps):
    r = getattr(client, methode)(chemin, json=corps, headers=_h())
    assert r.status_code == 403, r.text
    assert r.json()["detail"]["code"] == "admin_requis"


@pytest.mark.parametrize("corps, extrait", [
    ({**CREATION, "lots": []}, "au moins un lot"),
    ({**CREATION, "lots": ["", "  "]}, "au moins un lot"),
    ({**CREATION, "lots": [f"lot {i}" for i in range(11)]}, "10 lots au maximum"),
    ({**CREATION, "titre": "   "}, "titre"),
    ({**CREATION, "tirage_le": "bientôt"}, "Date du tirage illisible"),
])
def test_creation_refusee_si_donnees_invalides(client, corps, extrait):
    r = client.post("/api/tombola", json=corps, headers=_h(admin=True))
    assert r.status_code == 422, r.text
    assert extrait in r.text


def test_creation_refusee_si_date_passee(client):
    r = client.post("/api/tombola", json={**CREATION, "tirage_le": "2020-01-01T10:00"}, headers=_h(admin=True))
    assert r.status_code == 422 and r.json()["detail"]["code"] == "date_passee"


def test_creation_une_seule_tombola_ouverte(client):
    from app.api import tombola as api
    cur = Curseur([("WHERE statut = 'ouverte' LIMIT 1", {"id": 3})])
    with patch.object(api, "get_cursor", _sur(cur)):
        r = client.post("/api/tombola", json=CREATION, headers=_h(admin=True))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "deja_ouverte"
    assert not cur.sql("INSERT INTO tombolas")


def test_creation(client):
    from app.api import tombola as api
    cree = {**OUVERTE, "id": 8, "lots": "iPhone 13 reconditionné"}
    cur = Curseur([("INSERT INTO tombolas", {"id": 8}), ("SELECT * FROM tombolas WHERE id = %s", [cree])])
    with patch.object(api, "get_cursor", _sur(cur)), patch.object(T, "_boutique", return_value={}):
        r = client.post("/api/tombola", json=CREATION, headers=_h(admin=True, user="Tarik"))
    assert r.status_code == 200, r.text
    assert r.json()["id"] == 8 and r.json()["participants"] == 0 and r.json()["gagnants"] == []
    sql, params = cur.sql("INSERT INTO tombolas")[0]
    assert params[0] == "Tombola de Noël" and params[1] == "iPhone 13 reconditionné" and params[4] == "Tarik"
    assert params[2].utcoffset() is not None   # date située (heure de Paris)


def test_inscription_au_comptoir_sans_achat(client):
    from app.api import tombola as api
    cur = Curseur([("FROM tombolas", OUVERTE), ("INSERT INTO clients", {"id": 55}),
                   ("INSERT INTO tombola_participations", {"id": 90})])
    with patch.object(api, "get_cursor", _sur(cur)), patch.object(api, "fiches_du_numero", return_value=[]):
        r = client.post("/api/tombola/7/participants", headers=_h(user="Marina"),
                        json={"nom": "Durand", "prenom": "Léa", "telephone": "07 55 44 33 22"})
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "deja_inscrit": False, "client_id": 55}
    assert cur.sql("INSERT INTO tombola_participations")[0][1][3:] == ("comptoir", "Marina")


def test_inscription_au_comptoir_fiche_existante_deja_inscrite(client):
    from app.api import tombola as api
    fiche = {"id": 21, "nom": "Durand", "prenom": "Léa", "telephone": "0755443322"}
    cur = Curseur([("FROM tombolas", OUVERTE)])
    with patch.object(api, "get_cursor", _sur(cur)), patch.object(api, "fiches_du_numero", return_value=[fiche]):
        r = client.post("/api/tombola/7/participants", headers=_h(),
                        json={"nom": "Durand", "prenom": "Léa", "telephone": "0755443322"})
    assert r.json() == {"ok": True, "deja_inscrit": True, "client_id": 21}
    assert not cur.sql("INSERT INTO clients")


@pytest.mark.parametrize("corps, code", [
    ({"nom": " ", "telephone": "0755443322"}, "nom_requis"),
    ({"nom": "Durand", "telephone": "06 00 00 00 00"}, "telephone_fictif"),
])
def test_inscription_au_comptoir_refus(client, corps, code):
    r = client.post("/api/tombola/7/participants", headers=_h(), json=corps)
    assert r.status_code == 422 and r.json()["detail"]["code"] == code


def test_inscription_au_comptoir_close(client):
    from app.api import tombola as api
    with patch.object(api, "get_cursor", _sur(Curseur())):
        r = client.post("/api/tombola/7/participants", headers=_h(),
                        json={"nom": "Durand", "telephone": "0755443322"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "plus_ouverte"


def test_retrait_refuse_apres_le_tirage(client):
    from app.api import tombola as api
    cur = Curseur([("FOR UPDATE OF p", {"id": 12, "statut": "tiree"})])
    with patch.object(api, "get_cursor", _sur(cur)):
        r = client.delete("/api/tombola/participations/12", headers=_h())
    assert r.status_code == 409 and not cur.sql("DELETE FROM")
    cur = Curseur([("FOR UPDATE OF p", {"id": 12, "statut": "ouverte"})])
    with patch.object(api, "get_cursor", _sur(cur)):
        assert client.delete("/api/tombola/participations/12", headers=_h()).json() == {"ok": True}
    assert cur.sql("DELETE FROM tombola_participations WHERE id = %s")[0][1] == (12,)


def test_annulation_efface_les_participations(client):
    from app.api import tombola as api
    cur = Curseur([("SELECT statut FROM tombolas", {"statut": "ouverte"})])
    cur.rowcount = 0
    with patch.object(api, "get_cursor", _sur(cur)):
        r = client.post("/api/tombola/7/annuler", headers=_h(admin=True))
    assert r.status_code == 200 and r.json()["ok"] is True
    assert cur.sql("DELETE FROM tombola_participations WHERE tombola_id = %s")
    assert cur.sql("UPDATE tombolas SET statut = 'annulee'")


def test_tirage_manuel_deja_fait(client):
    from app.api import tombola as api
    cur = Curseur([("FROM tombolas WHERE id = %s FOR UPDATE", {**OUVERTE, "statut": "tiree"})])
    with patch.object(api, "get_cursor", _sur(cur)):
        r = client.post("/api/tombola/7/tirage", headers=_h(admin=True))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "plus_ouverte"


def test_decrire_donne_le_lot_de_chaque_gagnant():
    from app.api import tombola as api
    gagnants = [{"id": 1, "rang": 1, "nom": "Durand", "prenom": "Léa", "telephone": "0755443322"},
                {"id": 2, "rang": 2, "nom": "Martin", "prenom": "", "telephone": "0611223344", "remplace_le": DATE},
                {"id": 3, "rang": 2, "nom": "Petit", "prenom": "Sam", "telephone": "0622334455"}]
    with patch.object(T, "_boutique", return_value={}):
        d = api._decrire({**OUVERTE, "statut": "tiree", "participants_au_tirage": 40}, 40, gagnants)
    assert [g["lot"] for g in d["gagnants"]] == ["iPhone 13 reconditionné", "Écouteurs sans fil", "Écouteurs sans fil"]
    assert d["gagnants"][1]["remplace_le"] and not d["gagnants"][2]["remplace_le"]
    assert d["reglement_personnalise"] is False and d["participants_au_tirage"] == 40


# ─── FORMULAIRES DE DÉPÔT : la case « Je participe » ─────────────
def test_borne_case_cochee_inscrit_le_client(client):
    from app.api import clients as api
    cur = MagicMock()
    cur.fetchone.return_value = {"id": 77}
    cur.fetchall.return_value = []
    with patch.object(api, "get_cursor", _sur(cur)), patch.object(api, "fiches_du_numero", return_value=[]), \
         patch.object(api.tombola_service, "inscrire_sans_bloquer", return_value=True) as inscrire, \
         patch.object(api._LIMITEUR_CREATION, "verifier_ip"), patch.object(api._LIMITEUR_CREATION, "compter_global"), \
         patch.object(api, "verifier_essais"):
        r = client.post("/api/clients", json={"nom": "Durand", "telephone": "0755443322", "tombola": True})
    assert r.status_code == 200, r.text
    assert r.json()["tombola_inscrit"] is True and "client_ref" in r.json() and "id" not in r.json()
    assert inscrire.call_args.args[1:] == (77, "0755443322", "borne", None)


def test_borne_case_non_cochee_n_inscrit_personne(client):
    from app.api import clients as api
    cur = MagicMock()
    cur.fetchone.return_value = {"id": 77}
    with patch.object(api, "get_cursor", _sur(cur)), patch.object(api, "fiches_du_numero", return_value=[]), \
         patch.object(api.tombola_service, "inscrire_sans_bloquer") as inscrire, \
         patch.object(api._LIMITEUR_CREATION, "verifier_ip"), patch.object(api._LIMITEUR_CREATION, "compter_global"), \
         patch.object(api, "verifier_essais"):
        r = client.post("/api/clients", json={"nom": "Durand", "telephone": "0755443322"})
    assert r.status_code == 200 and "tombola_inscrit" not in r.json()
    inscrire.assert_not_called()


# ─── BASE RÉELLE (KP_TEST_DATABASE_URL) ──────────────────────────
DSN = os.environ.get("KP_TEST_DATABASE_URL")


@pytest.fixture
def db():
    if not DSN:
        pytest.skip("KP_TEST_DATABASE_URL absent : tests sur base réelle ignorés")
    psycopg2 = pytest.importorskip("psycopg2")
    import psycopg2.extras
    try:
        conn = psycopg2.connect(DSN, connect_timeout=3)
    except psycopg2.OperationalError as e:
        pytest.skip(f"base de test injoignable : {e}")
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT to_regclass('public.tombola_participations') IS NOT NULL AS ok")
        if not cur.fetchone()["ok"]:
            pytest.skip("base non migrée (démarrer l'API une fois sur cette base)")
        cur.execute("UPDATE tombolas SET statut = 'annulee' WHERE statut = 'ouverte'")
        yield cur
    finally:
        conn.rollback()
        conn.close()


def _tombola(cur, lots="Lot A\nLot B", dans="1 day"):
    cur.execute("""INSERT INTO tombolas (titre, lots, tirage_le) VALUES ('Essai', %s, NOW() + %s::interval)
                   RETURNING *""", (lots, dans))
    return cur.fetchone()


def _clients(cur, n, depart=0):
    ids = []
    for i in range(depart, depart + n):
        cur.execute("INSERT INTO clients (nom, prenom, telephone) VALUES (%s, 'Test', %s) RETURNING id",
                    (f"Tombola{i}", f"07990{i:05d}"))
        ids.append((cur.fetchone()["id"], f"07990{i:05d}"))
    return ids


def test_reel_inscription_unique_par_numero(db):
    t = _tombola(db)
    (cid, tel), = _clients(db, 1)
    assert T.inscrire(db, cid, tel, "borne")["nouvelle"] is True
    assert tel == "0799000000"
    assert T.inscrire(db, cid, "+33 7 99 00 00 00", "comptoir")["nouvelle"] is False   # même numéro, autre format
    assert T.inscrire(db, cid, tel, "comptoir")["nouvelle"] is False
    db.execute("SELECT COUNT(*) AS n FROM tombola_participations WHERE tombola_id = %s", (t["id"],))
    assert db.fetchone()["n"] == 1


def test_reel_plus_d_inscription_a_l_heure_du_tirage(db):
    _tombola(db, dans="-1 minute")
    (cid, tel), = _clients(db, 1)
    assert T.en_cours(db) is None and T.inscrire(db, cid, tel, "borne") is None


def test_reel_tirage_complet_puis_remplacant(db):
    t = _tombola(db)
    inscrits = _clients(db, 8)
    for cid, tel in inscrits:
        assert T.inscrire(db, cid, tel, "borne")["nouvelle"] is True
    # Une fiche anonymisée ne peut pas gagner
    db.execute("UPDATE clients SET anonymise_le = NOW() WHERE id = %s", (inscrits[0][0],))
    r = T.tirer(db, t["id"], "Tarik", rng=random.Random(5))
    assert r["participants"] == 7 and len(r["gagnants"]) == 2
    assert T.tirer(db, t["id"], "Tarik") is None   # un seul tirage
    db.execute("SELECT statut, participants_au_tirage, tiree_par FROM tombolas WHERE id = %s", (t["id"],))
    assert dict(db.fetchone()) == {"statut": "tiree", "participants_au_tirage": 7, "tiree_par": "Tarik"}
    db.execute("""SELECT id, client_id, rang FROM tombola_participations
                  WHERE tombola_id = %s AND rang IS NOT NULL ORDER BY rang""", (t["id"],))
    gagnants = db.fetchall()
    assert [g["rang"] for g in gagnants] == [1, 2]
    assert inscrits[0][0] not in [g["client_id"] for g in gagnants]

    nouveau = T.remplacer(db, gagnants[1]["id"], "Tarik", rng=random.Random(6))
    assert nouveau["rang"] == 2 and nouveau["id"] not in [g["id"] for g in gagnants]
    with pytest.raises(T.Refus):
        T.remplacer(db, gagnants[1]["id"], "Tarik")   # déjà remplacé
    db.execute("UPDATE tombola_participations SET lot_remis_le = NOW() WHERE id = %s", (gagnants[0]["id"],))
    with pytest.raises(T.Refus) as e:
        T.remplacer(db, gagnants[0]["id"], "Tarik")
    assert e.value.code == "lot_remis"


def test_reel_tirages_dus_et_purge(db):
    t = _tombola(db, lots="Lot unique", dans="-5 minutes")
    for cid, tel in _clients(db, 3, depart=100):
        db.execute("""INSERT INTO tombola_participations (tombola_id, client_id, cle_personne, source)
                      VALUES (%s, %s, %s, 'borne')""", (t["id"], cid, T.cle_personne(tel)))
    with patch.object(T, "get_cursor", _sur(db)), patch.object(T, "_prevenir_equipe"):
        faits = T.tirages_dus()
        assert [f["id"] for f in faits] == [t["id"]] and len(faits[0]["gagnants"]) == 1
        assert T.tirages_dus() == []
        assert T.purger_anciennes() == 0   # tirage trop récent
        db.execute("UPDATE tombolas SET tiree_le = NOW() - INTERVAL '120 days' WHERE id = %s", (t["id"],))
        assert T.purger_anciennes() == 2   # les deux non gagnants
    db.execute("SELECT COUNT(*) AS n FROM tombola_participations WHERE tombola_id = %s", (t["id"],))
    assert db.fetchone()["n"] == 1


def test_reel_une_seule_tombola_ouverte(db):
    import psycopg2
    _tombola(db)
    db.execute("SAVEPOINT s")
    with pytest.raises(psycopg2.errors.UniqueViolation):
        _tombola(db)
    db.execute("ROLLBACK TO SAVEPOINT s")
