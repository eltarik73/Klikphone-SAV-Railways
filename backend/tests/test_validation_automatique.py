"""Plus rien à valider (gérant, 06/11/2026) : prix payé sur une commande appliqué tout de suite, propositions en attente
réglées au démarrage, « prix appliqués » dans la santé des prix, liste d'information des prix appliqués. Aucune base :
curseurs simulés."""

from contextlib import contextmanager
from decimal import Decimal
from unittest.mock import patch

import pytest

from app.api import fournisseurs as A
from app.api import parts as PARTS
from app.api import propositions_prix as PP
from app.services import fournisseurs as F
from app.services import prix as P
from tests.test_securite_c1 import _ADMIN_PROUVE, _headers, fake_db


class _Cur:
    """fetchone : réponses dans l'ordre ; fetchall : d'après un début de requête."""

    def __init__(self, uns=(), tous=None):
        self.sql, self._uns, self._tous, self.rowcount = [], list(uns), tous or {}, 1

    def execute(self, sql, p=None):
        self.sql.append((" ".join(str(sql).split()), p))

    def fetchone(self):
        return self._uns.pop(0) if self._uns else None

    def fetchall(self):
        s = self.sql[-1][0] if self.sql else ""
        for debut, rows in self._tous.items():
            if debut in s:
                return rows
        return []


# ─── Prix payé sur une commande ──────────────────────────────────

def test_appliquer_prix_commande_ecrit_et_trace(monkeypatch):
    appliques = []
    monkeypatch.setattr(P, "appliquer_ht", lambda c, cle, ht, source, par, lot=None, r=None: appliques.append((cle, ht, source, par, lot)) or {
        "ok": True, "absent": False, "verrouille": False, "ancien_ht": Decimal("100"), "nouveau_ht": Decimal("120"),
        "ancien_client": 189, "nouveau_client": 229})
    cur = _Cur(uns=[{"ht": Decimal("100")}, {"id": 7}])
    res = P.appliquer_prix_commande(cur, "tarifs:5", "120", "Nour", commande_id=42)
    assert res["id"] == 7 and res["applique"] is True and res["verrouille"] is False and res["lot_id"]
    assert (res["ancien_ht"], res["nouveau_ht"], res["ancien_client"], res["nouveau_client"]) == (Decimal("100"), Decimal("120"), 189, 229)
    assert appliques == [("tarifs:5", Decimal("120.00"), "commande", "Nour", res["lot_id"])]
    insert = next(p for s, p in cur.sql if s.startswith("INSERT INTO tarifs_propositions"))
    assert insert == ("tarifs:5", Decimal("100"), Decimal("120.00"), 42, "acceptee", "Nour", "Nour", res["lot_id"])
    # Écart d'au plus 1 € : rien
    assert P.appliquer_prix_commande(_Cur(uns=[{"ht": Decimal("100")}]), "tarifs:5", 100.9, "Nour") is None
    # Clé invalide, pièce inconnue, HT nul : rien
    assert P.appliquer_prix_commande(_Cur(), "nimporte", 10, "Nour") is None
    assert P.appliquer_prix_commande(_Cur(uns=[None]), "tarifs:5", 10, "Nour") is None
    assert P.appliquer_prix_commande(_Cur(uns=[{"ht": Decimal("1")}]), "tarifs:5", 0, "Nour") is None
    # Pièce verrouillée : jamais écrite, trace « refusee » sans lot
    monkeypatch.setattr(P, "appliquer_ht", lambda *a, **k: {"ok": False, "absent": False, "verrouille": True, "ancien_ht": Decimal("100"),
                                                           "nouveau_ht": Decimal("120"), "ancien_client": 189, "nouveau_client": 229})
    cur = _Cur(uns=[{"ht": Decimal("100")}, {"id": 8}])
    res = P.appliquer_prix_commande(cur, "tarifs:5", 120, "Nour", 43)
    assert res["applique"] is False and res["verrouille"] is True and res["lot_id"] is None
    insert = next(p for s, p in cur.sql if s.startswith("INSERT INTO tarifs_propositions"))
    assert insert[4] == "refusee" and insert[-1] is None


def test_parts_sortie_prix():
    assert PARTS._sortie_prix(None) == {"proposition_id": None, "prix_applique": None}
    res = {"id": 3, "applique": True, "verrouille": False, "lot_id": "l", "ancien_ht": 1, "nouveau_ht": 2, "ancien_client": 9,
           "nouveau_client": 19, "autre": "x"}
    out = PARTS._sortie_prix(res)
    assert out["proposition_id"] == 3 and "autre" not in out["prix_applique"] and out["prix_applique"]["nouveau_client"] == 19


# ─── Propositions en attente réglées au démarrage ────────────────

def test_valider_en_attente_applique_ferme_ou_refuse(monkeypatch):
    rows = [
        {"id": 1, "tarif_cle": "tarifs:1", "nouveau_ht": Decimal("120"), "source": "commande"},     # commande → appliquée
        {"id": 2, "tarif_cle": "tarifs:2", "nouveau_ht": Decimal("60"), "source": "utopya"},       # Utopya, pièce retenue Mobilax (coût réel) → fermée
        {"id": 3, "tarif_cle": "tarifs:3", "nouveau_ht": Decimal("55"), "source": "mobilax"},      # Mobilax retenu → appliquée (source mobilax)
        {"id": 4, "tarif_cle": "tarifs:4", "nouveau_ht": Decimal("30"), "source": "utopya"},       # Utopya, coût estimé → complément appliqué
        {"id": 5, "tarif_cle": "tarifs:5", "nouveau_ht": Decimal("30"), "source": "commande"},     # verrou → refusée
        {"id": 6, "tarif_cle": "tarifs:6", "nouveau_ht": Decimal("30"), "source": "commande"},     # pièce disparue → annulée
    ]
    cur = _Cur(tous={"FROM tarifs_propositions WHERE statut = 'en_attente'": rows})
    recent = {"prix_source": "import", "prix_maj_le": __import__("datetime").datetime.now()}
    descs = {
        "tarifs:1": {"cle": "tarifs:1", "verrou": False, "obsolete": False, "fournisseur": "Mobilax", "ht": Decimal("100"), **recent},
        "tarifs:2": {"cle": "tarifs:2", "verrou": False, "obsolete": False, "fournisseur": "Mobilax", "ht": Decimal("70"), **recent},
        "tarifs:3": {"cle": "tarifs:3", "verrou": False, "obsolete": False, "fournisseur": "Mobilax", "ht": Decimal("50"), **recent},
        "tarifs:4": {"cle": "tarifs:4", "verrou": False, "obsolete": False, "fournisseur": None, "ht": Decimal("20"),
                     "prix_source": "estimation_2026_02", "prix_maj_le": None},
        "tarifs:5": {"cle": "tarifs:5", "verrou": True, "obsolete": False, "fournisseur": "Mobilax", "ht": Decimal("20"), **recent},
    }
    monkeypatch.setattr(PP.prix_srv, "regles", lambda c=None: {"jours_perime": 180})
    monkeypatch.setattr(PP.prix_srv, "decrire_tarifs", lambda c, cles, r=None: {k: v for k, v in descs.items() if k in cles})
    monkeypatch.setattr(F, "preference", lambda cur=None: "Mobilax")
    appliques = []
    monkeypatch.setattr(PP.prix_srv, "appliquer_ht", lambda c, cle, ht, source, par, lot=None, r=None: appliques.append((cle, ht, source)) or {"ok": True})
    res = PP.valider_en_attente(cur, "Validation automatique")
    assert res == {"en_attente": 6, "acceptees": 3, "fermees": 1, "verrouillees": 1, "introuvables": 1, "lot_id": res["lot_id"]}
    assert res["lot_id"]
    assert appliques == [("tarifs:1", Decimal("120"), "commande"), ("tarifs:3", Decimal("55"), "mobilax"), ("tarifs:4", Decimal("30"), "utopya")]
    statuts = {p[-1]: p[0] for s, p in cur.sql if s.startswith("UPDATE tarifs_propositions SET statut")}
    assert statuts == {1: "acceptee", 2: "annulee", 3: "acceptee", 4: "acceptee", 5: "refusee", 6: "annulee"}
    assert PP.valider_en_attente(_Cur(), "x") == {"en_attente": 0, "acceptees": 0, "fermees": 0, "verrouillees": 0, "introuvables": 0, "lot_id": None}


def test_valider_au_demarrage_une_seule_fois(monkeypatch):
    appels = []
    monkeypatch.setattr(PP, "valider_en_attente", lambda cur, par: appels.append(par) or {"en_attente": 2, "acceptees": 2, "fermees": 0, "verrouillees": 0, "introuvables": 0, "lot_id": "l"})
    monkeypatch.setattr(PP, "_invalider_caches", lambda: None)

    def gc_pour(cur):
        @contextmanager
        def gc(*a, **k):
            yield cur
        return gc

    # Marqueur posé dans cette transaction : validation faite
    cur = _Cur(uns=[{"cle": PP.MARQUEUR_VALIDATION}])
    monkeypatch.setattr(PP, "get_cursor", gc_pour(cur))
    assert PP.valider_en_attente_au_demarrage()["acceptees"] == 2 and appels == ["Validation automatique"]
    assert cur.sql[0][0].startswith("INSERT INTO params (cle, valeur) VALUES (%s, NOW()::text) ON CONFLICT (cle) DO NOTHING RETURNING cle")
    # Marqueur déjà présent : plus rien
    monkeypatch.setattr(PP, "get_cursor", gc_pour(_Cur(uns=[None])))
    assert PP.valider_en_attente_au_demarrage() is None and appels == ["Validation automatique"]


# ─── Santé : prix appliqués ; liste d'information ────────────────

def test_prix_recents_et_route(monkeypatch, client):
    groupes = [
        {"table_nom": "tarifs", "ligne_id": 1, "lot_id": "lot-a", "piece": "piece", "le": "2026-11-06T09:00:00", "source": "import",
         "par": "Synchro Mobilax", "ht_ancien": Decimal("55"), "ht_nouveau": Decimal("101"), "client_ancien": Decimal("129"), "client_nouveau": Decimal("249")},
        {"table_nom": "tarifs_apple_devices", "ligne_id": 4, "lot_id": "lot-b", "piece": "batterie", "le": "2026-11-06T08:00:00", "source": "utopya",
         "par": "Collecte Utopya", "ht_ancien": None, "ht_nouveau": Decimal("40"), "client_ancien": Decimal("0"), "client_nouveau": Decimal("149")},
        {"table_nom": "tarifs", "ligne_id": 2, "lot_id": "lot-c", "piece": "piece", "le": "2026-11-05T08:00:00", "source": "import",
         "par": "Synchro Mobilax", "ht_ancien": Decimal("60"), "ht_nouveau": Decimal("0"), "client_ancien": Decimal("139"), "client_nouveau": Decimal("0")},
    ]
    cur = _Cur(tous={
        "FROM tarifs_historique h": groupes,
        "FROM tarifs WHERE id = ANY": [{"id": 1, "marque": "Google", "modele": "Pixel 6", "type_piece": "Ecran", "qualite": "Original", "fournisseur": "Mobilax"},
                                       {"id": 2, "marque": "Google", "modele": "Pixel 7", "type_piece": "Ecran", "qualite": "Original", "fournisseur": None}],
        "FROM tarifs_apple_devices WHERE id = ANY": [{"id": 4, "modele": "iPad 9", "fournisseur": "Utopya"}],
    })
    d = A.prix_recents(cur, "", 7, 100, admin=True)
    assert d["n"] == 3 and d["tronque"] is False and d["jours"] == 7
    c0, c1, c2 = d["changements"]
    assert (c0["marque"], c0["modele"], c0["type_piece"], c0["qualite"], c0["fournisseur"]) == ("Google", "Pixel 6", "Ecran", "Original", "Mobilax")
    assert c0["client"] == {"ancien": 129.0, "nouveau": 249.0} and c0["ht"] == {"ancien": 55.0, "nouveau": 101.0} and c0["vide"] is False
    assert (c1["marque"], c1["modele"], c1["type_piece"], c1["cle"]) == ("Apple", "iPad 9", "Batterie", "tarifs_apple_devices:4:batterie")
    assert c2["vide"] is True and c2["client"]["nouveau"] == 0.0
    # Personnel : jamais de HT ; filtre par mots (chiffre seul gardé : « pixel 6 »)
    d = A.prix_recents(cur, "pixel 6", 7, 100, admin=False)
    assert [c["modele"] for c in d["changements"]] == ["Pixel 6"] and d["changements"][0]["ht"] is None
    assert cur.sql[-3][1]["limite"] == 2500      # une recherche lit large avant de filtrer
    assert A.prix_recents(cur, "ipad", 30, 1, admin=False)["changements"][0]["modele"] == "iPad 9"
    # Route : 401 sans session ; personnel sans HT ; admin avec HT
    _, gc = fake_db(lambda sql, params: None)
    monkeypatch.setattr(A, "prix_recents", lambda cur, q, jours, limite, admin: {"jours": jours, "admin": admin, "n": 0, "tronque": False, "changements": [], "q": q, "limite": limite})
    assert client.get("/api/tarifs/fournisseurs/recents").status_code == 401
    _, gc_staff = fake_db(lambda sql, params: None)
    with patch("app.api.auth.get_cursor", gc_staff), patch("app.api.fournisseurs.get_cursor", gc):
        r = client.get("/api/tarifs/fournisseurs/recents?q=pixel&jours=30&limite=20", headers=_headers())
        assert r.status_code == 200 and r.json() == {"jours": 30, "admin": False, "n": 0, "tronque": False, "changements": [], "q": "pixel", "limite": 20}
        assert client.get("/api/tarifs/fournisseurs/recents?jours=0", headers=_headers()).status_code == 422
    _, gc_admin = fake_db(lambda sql, params: _ADMIN_PROUVE if "membres_equipe" in sql else None)
    with patch("app.api.auth.get_cursor", gc_admin), patch("app.api.fournisseurs.get_cursor", gc):
        r = client.get("/api/tarifs/fournisseurs/recents", headers=_headers())
        assert r.status_code == 200 and r.json()["admin"] is True and r.json()["jours"] == 7


def test_sante_compte_les_prix_appliques(monkeypatch):
    monkeypatch.setattr(P, "regles", lambda c=None: dict(P.REGLES_DEFAUT, jours_a_revoir=90, jours_perime=180, seuil_marge_alerte=40))
    monkeypatch.setattr(P.params_cache, "get_params", lambda cles, defauts=None, cur=None: {c: "" for c in cles})
    from app.services import fournisseurs
    monkeypatch.setattr(fournisseurs, "sante", lambda cur=None: {})
    cur = _Cur(uns=[{"total": 10, "a_renseigner": 1, "estimes": 2, "a_revoir": 3, "perimes": 4, "marges_faibles": 0, "verrouilles": 1},
                    {"n": 0}, {"n": 12}])
    out = P.sante(cur)
    assert out["propositions_en_attente"] == 0 and out["appliques_7j"] == 12
    assert any("FROM tarifs_historique" in s and "make_interval(days => 7)" in s for s, _ in cur.sql)
