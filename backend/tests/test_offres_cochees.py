"""Offres de la boutique cochées d'office (gérant, 11/11/2026) : case des formulaires, clients existants cochés une
fois au démarrage — jamais un client qui avait retiré son accord, jamais une fiche anonymisée."""
from contextlib import contextmanager
from unittest.mock import patch

from app.api import clients as C
from app.api import rgpd as R
from app.services import mentions


def test_une_case_cochee_ne_remet_pas_un_client_qui_a_retire_son_accord():
    # Les trois colonnes de l'accord dépendent de la même condition, qui exclut un retrait daté
    assert "consentement_marketing_retire_le IS NULL" in C._ACCORD_NOUVEAU
    for col in ("consentement_marketing_le", "consentement_marketing_source", "consentement_marketing ="):
        ligne = next(l for l in C._SET_CONSENTEMENTS.splitlines() if l.strip().startswith(col))
        assert "consentement_marketing_retire_le IS NULL" in ligne, ligne
    # La case décochée ne retire toujours rien (seul le PATCH de la fiche retire)
    assert "ELSE consentement_marketing END" in C._SET_CONSENTEMENTS


def test_politique_decrit_la_case_cochee_et_l_opposition():
    p = R.politique(mentions.lire({"BOUTIQUE_NOM": "KLIKTEST"}))
    texte = " ".join(s["texte"] for s in p["sections"])
    assert "cochée d'office" in texte and "L34-5" in texte and "STOP" in texte
    assert mentions.POLITIQUE_VERSION == "2026-11-11"


class _Cur:
    def __init__(self, marqueur_libre=True, rowcount=42, retraits=3):
        self.sql, self.params, self.marqueur_libre = [], [], marqueur_libre
        self.rowcount, self.retraits = rowcount, retraits
        self._dernier = ""

    def execute(self, sql, params=None):
        self.sql.append(" ".join(sql.split()))
        self.params.append(params)
        self._dernier = self.sql[-1]

    def fetchone(self):
        if self._dernier.startswith("INSERT INTO params"):
            return {"cle": R.MARQUEUR_OFFRES_EXISTANTS} if self.marqueur_libre else None
        if "COUNT(*)" in self._dernier:
            return {"n": self.retraits}
        return None


def test_clients_existants_coches_sauf_retrait_et_anonymisation():
    cur = _Cur()
    assert R.cocher_offres_clients_existants(cur) == {"coches": 42, "retraits_respectes": 3}
    maj = cur.sql[0]
    assert maj.startswith("UPDATE clients SET consentement_marketing = TRUE")
    assert "NOT COALESCE(consentement_marketing, FALSE)" in maj           # un accord déjà daté garde sa date
    assert "consentement_marketing_retire_le IS NULL" in maj and "anonymise_le IS NULL" in maj
    assert cur.params[0] == (R.SOURCE_CLIENTS_EXISTANTS,)


def _avec(cur):
    @contextmanager
    def fake():
        yield cur
    return patch.object(R, "get_cursor", fake)


def test_cochage_au_demarrage_une_seule_fois():
    cur = _Cur()
    with _avec(cur):
        assert R.cocher_offres_au_demarrage() == {"coches": 42, "retraits_respectes": 3}
    assert cur.sql[0].startswith("INSERT INTO params") and cur.params[0] == (R.MARQUEUR_OFFRES_EXISTANTS,)
    assert cur.sql[-1].startswith("UPDATE params SET valeur") and "coches=42 retraits_respectes=3" in cur.params[-1][0]
    deja = _Cur(marqueur_libre=False)
    with _avec(deja):
        assert R.cocher_offres_au_demarrage() is None
    assert not any(s.startswith("UPDATE clients") for s in deja.sql)


def test_cochage_au_demarrage_jamais_bloquant():
    @contextmanager
    def panne():
        raise RuntimeError("base indisponible")
        yield
    with patch.object(R, "get_cursor", panne):
        assert R.cocher_offres_au_demarrage() is None
