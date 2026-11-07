"""Grille comparative des fournisseurs : prix mémorisé par fournisseur (services/prix), choix du gérant,
pièces courantes sur tous les modèles (api/tarifs). Aucune base : curseurs simulés, execute_values capturé."""

from decimal import Decimal
from unittest.mock import patch

import pytest

from app.api import tarifs as T
from app.services import prix as P
from tests.test_securite_c1 import _ADMIN_PROUVE, _headers, fake_db


class _Cur:
    def __init__(self, rowcount=1):
        self.sql, self.rowcount = [], rowcount

    def execute(self, sql, p=None):
        self.sql.append((" ".join(str(sql).split()), p))

    def fetchall(self):
        return []

    def fetchone(self):
        return None


def test_enregistrer_prix_fournisseur_garde_la_variante_la_moins_chere_avec_chassis(monkeypatch):
    appels = []
    monkeypatch.setattr(P, "execute_values", lambda cur, sql, lignes, **kw: appels.append((" ".join(sql.split()), lignes)))
    recs = [{"cle": "tarifs:1", "nouveau_ht": 12.0, "ref": "A", "designation": "Ecran x"},
            {"cle": "tarifs:1", "nouveau_ht": 9.5, "ref": "B", "designation": "Ecran y"},
            # Moins cher mais « sans châssis » : jamais devant un écran complet (le magasin répare avec châssis)
            {"cle": "tarifs:1", "nouveau_ht": 7.0, "ref": "S", "designation": "Ecran Tactile Original sans Châssis y"},
            {"cle": "tarifs:2", "nouveau_ht": 0, "ref": "C", "designation": "z"},
            {"cle": "tarifs_apple_devices:3:ecran", "nouveau_ht": "80", "ref": "", "designation": "w"},
            # Seule variante connue : gardée, la grille la signale « Sans châssis »
            {"cle": "tarifs:4", "nouveau_ht": 67.09, "ref": "U4", "designation": "Ecran Complet Galaxy S25 (S931B) (Sans Châssis)"}]
    n = P.enregistrer_prix_fournisseur(None, "mobilax", "mobilax", recs, {"B": {"url": "https://www.mobilax.fr/b", "en_stock": False}})
    assert n == 3
    sql, lignes = appels[0]
    assert "ON CONFLICT (tarif_cle, fournisseur) DO UPDATE" in sql and "IS DISTINCT FROM EXCLUDED.prix_ht" in sql
    assert lignes == [("tarifs:1", "Mobilax", Decimal("9.5"), "B", "Ecran y", "https://www.mobilax.fr/b", False, "mobilax"),
                      ("tarifs_apple_devices:3:ecran", "Mobilax", Decimal("80"), None, "w", None, True, "mobilax"),
                      ("tarifs:4", "Mobilax", Decimal("67.09"), "U4", "Ecran Complet Galaxy S25 (S931B) (Sans Châssis)", None, True, "mobilax")]
    assert P.enregistrer_prix_fournisseur(None, "", "x", recs) == 0 and P.enregistrer_prix_fournisseur(None, "Utopya", "x", []) == 0
    appels.clear()
    assert P.noter_vus_sans_prix(None, "Utopya", {"tarifs:9": [{"reference": "U9", "designation": "Nappe", "url": None}]}) == 1
    assert appels[0][1] == [("tarifs:9", "Utopya", "U9", "Nappe", None)] and "en_stock = FALSE" in appels[0][0]


def test_choisir_fournisseur_applique_le_prix_connu(monkeypatch):
    cur = _Cur()
    monkeypatch.setattr(P, "regles", lambda c=None: {"tva": 1.2})
    desc = {"tarifs:5": {"cle": "tarifs:5", "table": "tarifs", "id": 5, "colonne": None, "verrou": False, "ht": 20}}
    monkeypatch.setattr(P, "decrire_tarifs", lambda c, cles, r=None: desc)
    monkeypatch.setattr(P, "prix_fournisseurs", lambda c, cles: {"tarifs:5": {
        "Mobilax": {"ht": 25.0, "ref": "M1", "url": None, "en_stock": True},
        "Utopya": {"ht": 21.0, "ref": "U1", "url": "https://www.utopya.fr/u", "en_stock": False}}})
    appliques = []
    monkeypatch.setattr(P, "appliquer_ht", lambda c, cle, ht, source, par, lot=None, r=None: appliques.append((cle, ht, source)) or {"ok": True})
    out = P.choisir_fournisseur(cur, "tarifs:5", "Mobilax", "admin")
    assert out["fournisseur_choisi"] == "Mobilax" and appliques == [("tarifs:5", 25.0, "mobilax")]
    assert out["applique"]["fournisseur"] == "Mobilax" and out["disponibles"] == ["Mobilax", "Utopya"]
    assert cur.sql[0] == ("UPDATE tarifs SET fournisseur_choisi = %s WHERE id = %s", ("Mobilax", 5))
    assert cur.sql[1][1] == ("Mobilax", "M1", None, 5)
    # Automatique : le moins cher DISPONIBLE (Utopya en rupture → Mobilax)
    appliques.clear()
    out = P.choisir_fournisseur(cur, "tarifs:5", None, "admin")
    assert out["fournisseur_choisi"] is None and appliques == [("tarifs:5", 25.0, "mobilax")]
    # Pièce verrouillée : le choix est noté, le prix n'est pas touché
    desc["tarifs:5"]["verrou"] = True
    appliques.clear()
    out = P.choisir_fournisseur(cur, "tarifs:5", "Utopya", "admin")
    assert out["verrouille"] is True and out["applique"] is None and appliques == []
    with pytest.raises(ValueError):
        P.choisir_fournisseur(cur, "tarifs:5", "Autre", "admin")
    # Fiche iPad / Mac : colonnes de la fiche
    desc["tarifs:5"]["verrou"] = False
    monkeypatch.setattr(P, "decrire_tarifs", lambda c, cles, r=None: {
        "tarifs_apple_devices:3:ecran": {"cle": "tarifs_apple_devices:3:ecran", "table": "tarifs_apple_devices", "id": 3,
                                         "colonne": "ecran", "verrou": False, "ht": 50}})
    monkeypatch.setattr(P, "prix_fournisseurs", lambda c, cles: {"tarifs_apple_devices:3:ecran": {"Utopya": {"ht": 45.0, "ref": "U3", "url": None, "en_stock": True}}})
    appliques.clear()
    out = P.choisir_fournisseur(cur, "tarifs_apple_devices:3:ecran", "Utopya", "admin")
    assert appliques == [("tarifs_apple_devices:3:ecran", 45.0, "utopya")] and cur.sql[-1][0].startswith("UPDATE tarifs_apple_devices SET fournisseur = %s")
    assert P.choisir_fournisseur(_Cur(rowcount=0), "tarifs:404", "Mobilax", "admin")["absent"] is True


def test_routes_choix_fournisseur_et_pieces_courantes_tous(client, monkeypatch):
    _, gc_staff = fake_db(lambda sql, params: None)
    with patch("app.api.auth.get_cursor", gc_staff):
        assert client.patch("/api/tarifs/5/fournisseur", json={"fournisseur": "Mobilax"}, headers=_headers()).status_code == 403
        assert client.post("/api/tarifs/reparation-smartphones/pieces-courantes/tous", json={}, headers=_headers()).status_code == 403
    _, gc_admin = fake_db(lambda sql, params: _ADMIN_PROUVE if "membres_equipe" in sql else None)
    choix = []
    monkeypatch.setattr(T.prix, "choisir_fournisseur", lambda cur, cle, f, par, r=None: choix.append((cle, f)) or {"cle": cle, "fournisseur_choisi": f, "applique": None, "verrouille": False, "disponibles": []})
    _, gc = fake_db(lambda sql, params: None)
    with patch("app.api.auth.get_cursor", gc_admin), patch("app.api.tarifs.get_cursor", gc):
        r = client.patch("/api/tarifs/5/fournisseur", json={"fournisseur": "Utopya"}, headers=_headers())
        assert r.status_code == 200 and r.json()["fournisseur_choisi"] == "Utopya"
        assert client.patch("/api/tarifs/5/fournisseur", json={"fournisseur": "Autre"}, headers=_headers()).status_code == 422
        r = client.patch("/api/tarifs/apple-devices/3/fournisseur", json={"piece": "ecran", "fournisseur": None}, headers=_headers())
        assert r.status_code == 200 and r.json()["fournisseur_choisi"] is None
        assert choix == [("tarifs:5", "Utopya"), ("tarifs_apple_devices:3:ecran", None)]
        # Pièces courantes sur tous les modèles : seules les familles manquantes, iPad / Mac et iPhone exclus
        groupes = [{"marque": "Samsung", "marque_c": "samsung", "modele": "Galaxy A54 5G", "categorie": None,
                    "pieces": [{"table": "tarifs", "type_piece": "Ecran", "categorie": "standard"},
                               {"table": "tarifs", "type_piece": "Vitre arrière", "categorie": "standard"}]},
                   {"marque": "Apple", "marque_c": "apple", "modele": 'iPad 7 (2019) 10.2"', "categorie": "Tablette",
                    "pieces": [{"table": "tarifs_apple_devices", "type_piece": "Écran", "categorie": "ipad"}]}]
        monkeypatch.setattr(T, "_groupes_pieces", lambda cur, marque_c: groupes)
        inserts = []
        monkeypatch.setattr(T, "execute_values", lambda cur, sql, valeurs, **kw: inserts.append(valeurs) or [{"id": i} for i, _ in enumerate(valeurs)])
        monkeypatch.setattr(T, "_audit_pieces_courantes", lambda *a, **k: None)
        r = client.post("/api/tarifs/reparation-smartphones/pieces-courantes/tous",
                        json={"types": ["Vitre arriere", "Bouton power", "Ecran"]}, headers=_headers())
        assert r.status_code == 200, r.text
        assert r.json() == {"modeles": 1, "crees": 1, "par_type": {"Ecran": 0, "Vitre arriere": 0, "Bouton power": 1}}
        assert [v[:3] for v in inserts[0]] == [("Samsung", "Galaxy A54 5G", "Bouton power")]
        assert client.post("/api/tarifs/reparation-smartphones/pieces-courantes/tous", json={"types": ["Camera"]}, headers=_headers()).status_code == 400


def test_appliquer_preference_aligne_toute_la_grille(monkeypatch):
    class _CurPref(_Cur):
        def fetchall(self):
            if self.sql and "FROM tarifs_fournisseurs_prix" in self.sql[-1][0]:
                return [
                    {"tarif_cle": "tarifs:1", "fournisseur": "Mobilax", "prix_ht": Decimal("25"), "ref_fournisseur": "M1", "url": None, "en_stock": True},
                    {"tarif_cle": "tarifs:1", "fournisseur": "Utopya", "prix_ht": Decimal("21"), "ref_fournisseur": "U1", "url": "https://www.utopya.fr/u", "en_stock": True},
                    {"tarif_cle": "tarifs:2", "fournisseur": "Utopya", "prix_ht": Decimal("30"), "ref_fournisseur": "U2", "url": None, "en_stock": True},
                    {"tarif_cle": "tarifs:3", "fournisseur": "Mobilax", "prix_ht": Decimal("9"), "ref_fournisseur": "M3", "url": None, "en_stock": True},
                    {"tarif_cle": "tarifs_apple_devices:4:ecran", "fournisseur": "Mobilax", "prix_ht": Decimal("80"), "ref_fournisseur": None, "url": None, "en_stock": True},
                ]
            return []
    cur = _CurPref()
    monkeypatch.setattr(P, "regles", lambda c=None: {"tva": 1.2})
    descs = {
        "tarifs:1": {"cle": "tarifs:1", "table": "tarifs", "id": 1, "verrou": False, "obsolete": False, "ht": Decimal("21"), "fournisseur": "Utopya", "fournisseur_choisi": None},
        "tarifs:2": {"cle": "tarifs:2", "table": "tarifs", "id": 2, "verrou": True, "obsolete": False, "ht": Decimal("40"), "fournisseur": "Mobilax", "fournisseur_choisi": None},
        "tarifs:3": {"cle": "tarifs:3", "table": "tarifs", "id": 3, "verrou": False, "obsolete": False, "ht": Decimal("9"), "fournisseur": "Mobilax", "fournisseur_choisi": "Mobilax"},
        "tarifs_apple_devices:4:ecran": {"cle": "tarifs_apple_devices:4:ecran", "table": "tarifs_apple_devices", "id": 4, "verrou": False, "obsolete": False, "ht": Decimal("70"), "fournisseur": "Utopya", "fournisseur_choisi": None},
    }
    monkeypatch.setattr(P, "decrire_tarifs", lambda c, cles, r=None: {k: v for k, v in descs.items() if k in cles})
    appliques = []
    monkeypatch.setattr(P, "appliquer_ht", lambda c, cle, ht, source, par, lot=None, r=None: appliques.append((cle, ht, source, lot)) or {"ok": True})
    # Préférence Mobilax : tarifs:1 passe de Utopya 21 à Mobilax 25 (plus cher : le prix ne décide pas) ; tarifs:2 n'a pas
    # de prix Mobilax → Utopya le complète, mais la pièce est verrouillée ; tarifs:3 déjà à Mobilax 9 ; la fiche iPad passe à 80
    res = P.appliquer_preference(cur, "Mobilax", "admin")
    assert res["examinees"] == 4 and res["modifies"] == 2 and res["inchangees"] == 1 and res["verrouillees"] == 1 and res["sans_prix"] == 0
    assert [a[:3] for a in appliques] == [("tarifs:1", Decimal("25"), "mobilax"), ("tarifs_apple_devices:4:ecran", Decimal("80"), "mobilax")]
    assert len({a[3] for a in appliques}) == 1 and res["lot_id"] == appliques[0][3]
    assert any(sql.startswith("UPDATE tarifs SET fournisseur = %s") and p[0] == "Mobilax" and p[-1] == 1 for sql, p in cur.sql)
    assert any(sql.startswith("UPDATE tarifs_apple_devices SET fournisseur = %s") for sql, _ in cur.sql)
    # Sans préférence réglée : Mobilax par défaut, jamais le moins cher (Utopya à 21 < 25 n'est pas repris) ; un choix à
    # la pièce prime ; Utopya retenu → tarifs:1 passe à Utopya 21, tarifs:3 (choix Mobilax) et la fiche iPad (Utopya ne l'a pas) restent
    appliques.clear()
    descs["tarifs:1"].update(ht=Decimal("25"), fournisseur="Mobilax")
    descs["tarifs_apple_devices:4:ecran"].update(ht=Decimal("80"), fournisseur="Mobilax")
    res = P.appliquer_preference(cur, None, "admin")
    assert appliques == [] and res["modifies"] == 0 and res["inchangees"] == 3 and res["verrouillees"] == 1
    res = P.appliquer_preference(cur, "Utopya", "admin")
    assert [a[:3] for a in appliques] == [("tarifs:1", Decimal("21"), "utopya")] and res["modifies"] == 1 and res["inchangees"] == 2
    # cible_fournisseur : choix de la pièce, puis préférence, puis l'autre (complément) ; jamais le moins cher
    dispo = {"Mobilax": {"ht": 25.0, "ref": "M1", "url": None, "en_stock": False}, "Utopya": {"ht": 21.0, "ref": "U1", "url": None, "en_stock": True}}
    assert P.cible_fournisseur(dispo, {}, "Mobilax")["fournisseur"] == "Mobilax"
    assert P.cible_fournisseur(dispo, {"fournisseur_choisi": "Utopya"}, "Mobilax")["fournisseur"] == "Utopya"
    assert P.cible_fournisseur({"Utopya": dispo["Utopya"]}, {}, "Mobilax") == {"fournisseur": "Utopya", "ht": Decimal("21.0"), "ref": "U1", "url": None, "en_stock": True}
    assert P.cible_fournisseur({"Utopya": {"ht": None}}, {}, "Mobilax") is None and P.cible_fournisseur({}, None, None) is None


def test_route_preference_fournisseur(client, monkeypatch):
    from app.services import fournisseurs as F
    _, gc_staff = fake_db(lambda sql, params: None)
    with patch("app.api.auth.get_cursor", gc_staff):
        assert client.put("/api/tarifs/fournisseurs/preference", json={"fournisseur": "Utopya"}, headers=_headers()).status_code == 403
    _, gc_admin = fake_db(lambda sql, params: _ADMIN_PROUVE if "membres_equipe" in sql else None)
    regles, lances = [], []
    monkeypatch.setattr(F, "regler_preference", lambda f: regles.append(f) or f)
    monkeypatch.setattr(F, "lancer_preference", lambda auteur="admin": lances.append(auteur) or True)
    monkeypatch.setattr(F, "etat", lambda cur=None: {"preference": "Utopya", "preference_en_cours": True})
    with patch("app.api.auth.get_cursor", gc_admin):
        r = client.put("/api/tarifs/fournisseurs/preference", json={"fournisseur": "Utopya"}, headers=_headers())
        assert r.status_code == 200 and r.json()["preference"] == "Utopya" and r.json()["lance"] is True
        # Plus de « le moins cher » : un fournisseur est obligatoire
        assert client.put("/api/tarifs/fournisseurs/preference", json={"fournisseur": None}, headers=_headers()).status_code == 422
        assert client.put("/api/tarifs/fournisseurs/preference", json={"fournisseur": "Autre"}, headers=_headers()).status_code == 422
    assert regles == ["Utopya"] and len(lances) == 1
