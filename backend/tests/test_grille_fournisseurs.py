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


def test_enregistrer_prix_fournisseur_garde_la_variante_la_moins_chere(monkeypatch):
    appels = []
    monkeypatch.setattr(P, "execute_values", lambda cur, sql, lignes, **kw: appels.append((" ".join(sql.split()), lignes)))
    recs = [{"cle": "tarifs:1", "nouveau_ht": 12.0, "ref": "A", "designation": "x"},
            {"cle": "tarifs:1", "nouveau_ht": 9.5, "ref": "B", "designation": "y"},
            {"cle": "tarifs:2", "nouveau_ht": 0, "ref": "C", "designation": "z"},
            {"cle": "tarifs_apple_devices:3:ecran", "nouveau_ht": "80", "ref": "", "designation": "w"}]
    n = P.enregistrer_prix_fournisseur(None, "mobilax", "mobilax", recs, {"B": {"url": "https://www.mobilax.fr/b", "en_stock": False}})
    assert n == 2
    sql, lignes = appels[0]
    assert "ON CONFLICT (tarif_cle, fournisseur) DO UPDATE" in sql and "IS DISTINCT FROM EXCLUDED.prix_ht" in sql
    assert lignes == [("tarifs:1", "Mobilax", Decimal("9.5"), "B", "y", "https://www.mobilax.fr/b", False, "mobilax"),
                      ("tarifs_apple_devices:3:ecran", "Mobilax", Decimal("80"), None, "w", None, True, "mobilax")]
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
