"""Batterie changée « par l'écran » (services/par_ecran, prix, api/tarifs).

Prix client de la batterie = arrondi((HT écran + HT batterie) × TVA + marge « batterie par
l'écran », 70 € par défaut) sur les modèles cochés (iPad et Google Pixel par défaut). Tout passe par
des curseurs simulés : aucune base, aucun réseau.
"""

import json
from decimal import Decimal
from unittest.mock import patch

import pytest

from app.services import par_ecran as PE
from app.services import prix
from tests.test_securite_c1 import _ADMIN_PROUVE, _headers, fake_db

R = dict(prix.REGLES_DEFAUT)


# ─── Règle, écran retenu, formule ────────────────────────────────

def test_defaut_et_effectif():
    assert PE.defaut(marque="Google") and PE.defaut(marque="google ") and PE.defaut(categorie="ipad")
    assert not PE.defaut(marque="Samsung") and not PE.defaut(categorie="macbook") and not PE.defaut()
    assert PE.effectif(None, marque="Google") is True and PE.effectif(False, marque="Google") is False
    assert PE.effectif(True, marque="Samsung") is True and PE.effectif(None, marque="Samsung") is False
    assert PE.est_batterie("Batterie") and PE.est_batterie("batterie originale") and not PE.est_batterie("Ecran")


def test_choisir_ecran_origine_puis_moins_cher():
    pieces = [
        {"id": 1, "cle": "tarifs:1", "type_piece": "Ecran", "qualite": "Compatible", "ht": 40},
        {"id": 2, "cle": "tarifs:2", "type_piece": "Ecran", "qualite": "Original", "ht": 60},
        {"id": 3, "cle": "tarifs:3", "type_piece": "Ecran", "qualite": "Reconditionnee", "ht": 55},
        {"id": 4, "cle": "tarifs:4", "type_piece": "Écran", "qualite": "Original", "ht": 0},          # sans prix
        {"id": 5, "cle": "tarifs:5", "type_piece": "Batterie", "qualite": None, "ht": 12},
        {"id": 6, "cle": "tarifs:6", "type_piece": "Ecran", "qualite": "Original", "ht": 50, "obsolete": True},
    ]
    e = PE.choisir_ecran(pieces)
    assert e["id"] == 3 and e["ht"] == Decimal("55") and e["origine"] is True and e["cle"] == "tarifs:3"
    # Sans écran d'origine : le moins cher
    e2 = PE.choisir_ecran([p for p in pieces if p["id"] in (1, 5)] + [{"id": 7, "type_piece": "Ecran OLED", "qualite": "OLED", "ht": 70}])
    assert e2["id"] == 1 and e2["origine"] is False
    assert PE.choisir_ecran([pieces[4]]) is None and PE.choisir_ecran([]) is None
    assert PE.rang_qualite("Original Pulled") == 0 and PE.rang_qualite("Service Pack") == 0 and PE.rang_qualite("OLED") == 1


def test_prix_batterie_et_detail():
    # Exemple du gérant : écran 15 € HT, batterie 13 € HT → (15 + 13) × 1,2 + 70 = 103,60 → 109 €
    assert PE.prix_batterie(13, 15, R) == 109
    d = PE.calcul_detail(13, 15, R, {"cle": "tarifs:2", "qualite": "Original"})
    assert d == {"ht": 13.0, "ht_ecran": 15.0, "tva": 1.2, "marge": 70, "brut": 103.6, "arrondi": 109, "par_ecran": True,
                 "ecran_qualite": "Original", "ecran_cle": "tarifs:2"}
    assert PE.prix_batterie(Decimal("12.50"), Decimal("60"), {**R, "batterie_par_ecran": 80}) == 169   # 87 + 80 = 167 → 169
    assert PE.prix_batterie(13, 15, {**R, "arrondi": "entier"}) == 104


def test_regles_marge_batterie_par_ecran():
    assert prix.REGLES_DEFAUT["batterie_par_ecran"] == 70
    r = prix.valider_regles({"batterie_par_ecran": "85"})
    assert r["batterie_par_ecran"] == 85 and prix.regles_publiques(r)["batterie_par_ecran"] == 85
    with pytest.raises(ValueError, match="batterie par l'écran"):
        prix.valider_regles({"batterie_par_ecran": -1})
    texte = prix.methode_calcul(r, admin=True)["texte"]
    assert "batterie changée par l'écran (iPad, Pixel…) : (HT écran + HT batterie) × 1,2 + 85 €" in texte
    assert "batterie" not in prix.methode_calcul(r, admin=False)["texte"]


# ─── Curseur simulé ──────────────────────────────────────────────

def _ligne(i, marque, modele, type_piece, qualite, ht, client, verrou=False, obsolete=False):
    return {"id": i, "marque": marque, "modele": modele, "type_piece": type_piece, "qualite": qualite,
            "categorie": "standard", "prix_fournisseur_ht": Decimal(str(ht)) if ht is not None else None,
            "prix_client": client, "verrou_manuel": verrou, "obsolete": obsolete}


PIXEL = [
    _ligne(1, "Google", "Pixel 7", "Ecran", "Compatible", 40, 109),
    _ligne(2, "Google", "Pixel 7", "Ecran", "Original", 60, 139),
    _ligne(3, "Google", "Pixel 7", "Batterie", None, 12, 79),
    _ligne(4, "Google", "Pixel 7", "Batterie", "Original", 20, 89, verrou=True),
    _ligne(5, "Google", "Pixel 7", "Connecteur de charge", None, 8, 69),
]
GALAXY = [
    _ligne(10, "Samsung", "Galaxy A54", "Ecran", "Original", 50, 129),
    _ligne(11, "Samsung", "Galaxy A54", "Batterie", None, 10, 79),
]
APPLE = [
    {"id": 20, "categorie": "ipad", "modele": "iPad 9", "ecran_prix_ht": Decimal("15"), "batterie_prix_ht": Decimal("13"),
     "batterie_prix_vente": 129, "batterie_par_ecran": None, "verrou_manuel": False, "obsolete": False},
    {"id": 21, "categorie": "macbook", "modele": "MacBook Air 13", "ecran_prix_ht": Decimal("200"), "batterie_prix_ht": Decimal("40"),
     "batterie_prix_vente": 169, "batterie_par_ecran": None, "verrou_manuel": False, "obsolete": False},
    {"id": 22, "categorie": "macbook", "modele": "MacBook Pro 14", "ecran_prix_ht": Decimal("300"), "batterie_prix_ht": Decimal("50"),
     "batterie_prix_vente": 179, "batterie_par_ecran": True, "verrou_manuel": False, "obsolete": False},
]


class _Cur:
    """Lignes tarifs / fiches Apple en mémoire, options par modèle ; aucune écriture."""

    def __init__(self, tarifs=(), apple=(), options=None):
        self.tarifs, self.apple = [dict(x) for x in tarifs], [dict(x) for x in apple]
        self.options = dict(options or {})      # (marque_cle, modele_cle) → bool
        self._res, self.sql, self.rowcount = [], [], 0

    def execute(self, sql, params=None):
        s = " ".join(str(sql).split())
        self.sql.append((s, params))
        if s.startswith("INSERT INTO tarifs_modeles_options"):
            self.options[(params[0], params[1])] = params[4]
        elif s.startswith("DELETE FROM tarifs_modeles_options"):
            self.options.pop((params[0], params[1]), None)
        elif "FROM tarifs_modeles_options" in s:
            voulues = set(params[0]) if params else None
            self._res = [{"marque_cle": m, "modele_cle": mo, "batterie_par_ecran": v}
                         for (m, mo), v in self.options.items() if voulues is None or (m, mo) in voulues]
        elif "FROM tarifs WHERE id = ANY" in s:
            self._res = [x for x in self.tarifs if x["id"] in params[0]]
        elif "FROM tarifs WHERE (lower(btrim(marque)), lower(btrim(modele))) IN" in s:
            self._res = [x for x in self.tarifs if (x["marque"].lower(), x["modele"].lower()) in set(params[0])
                         and not x["obsolete"]]
        elif "FROM tarifs_apple_devices WHERE id = ANY" in s:
            self._res = [x for x in self.apple if x["id"] in params[0]]
        else:
            self._res = []

    def fetchall(self):
        return list(self._res)

    def fetchone(self):
        return self._res[0] if self._res else None

    def mogrify(self, sql, params=None):
        texte = str(sql)
        if params:
            texte = texte % tuple(repr(p) if isinstance(p, str) else str(p) for p in params)
        return texte.encode()


# ─── Dérivation à l'écriture ─────────────────────────────────────

def test_deriver_tarifs_batterie_depuis_l_ecran_d_origine():
    cur = _Cur(PIXEL + GALAXY)
    # Nouveau HT de la batterie Pixel 7 : (60 écran Original + 12) × 1,2 + 70 = 156,4 → 159 ; la batterie verrouillée (4) jamais
    out = PE.deriver_changements(cur, "tarifs", [(3, "prix_fournisseur_ht", 12), (3, "prix_client", 79)], R)
    assert out == [(3, "prix_fournisseur_ht", 12), (3, "prix_client", 159)]
    # L'écran change : la batterie suit (ajoutée au lot), le connecteur et l'autre écran non
    out = PE.deriver_changements(cur, "tarifs", [(2, "prix_fournisseur_ht", Decimal("50")), (2, "prix_client", 129)], R)
    assert out == [(2, "prix_fournisseur_ht", Decimal("50")), (2, "prix_client", 129), (3, "prix_client", 149)]   # (50+12)×1,2+70=144,4
    # Samsung : règle inactive par défaut → rien n'est dérivé
    out = PE.deriver_changements(cur, "tarifs", [(10, "prix_fournisseur_ht", 55)], R)
    assert out == [(10, "prix_fournisseur_ht", 55)]
    # Réglages explicites : Google décoché, Samsung coché
    cur.options = {("google", "pixel 7"): False, ("samsung", "galaxy a54"): True}
    assert PE.deriver_changements(cur, "tarifs", [(3, "prix_client", 79)], R) == [(3, "prix_client", 79)]
    assert PE.deriver_changements(cur, "tarifs", [(10, "prix_fournisseur_ht", 55)], R) == \
        [(10, "prix_fournisseur_ht", 55), (11, "prix_client", 149)]                                           # (55+10)×1,2+70=148 → 149
    # Autres tables, lot vide : inchangé
    assert PE.deriver_changements(cur, "tarifs_reparation", [(1, "ecran", 99)], R) == [(1, "ecran", 99)]
    assert PE.deriver_changements(cur, "tarifs", [], R) == []


def test_deriver_tarifs_sans_ecran_au_prix_connu():
    cur = _Cur([_ligne(1, "Google", "Pixel 8", "Ecran", "Original", 0, 0), _ligne(2, "Google", "Pixel 8", "Batterie", None, 12, 79)])
    assert PE.deriver_changements(cur, "tarifs", [(2, "prix_client", 85)], R) == [(2, "prix_client", 85)]


def test_deriver_apple_ipad_par_defaut_macbook_sur_reglage():
    cur = _Cur(apple=APPLE)
    # iPad 9 : (15 + 13) × 1,2 + 70 = 103,6 → 109 ; MacBook Air : règle inactive ; MacBook Pro : cochée
    out = PE.deriver_changements(cur, "tarifs_apple_devices",
                                 [(20, "batterie_prix_ht", 13), (20, "batterie_prix_vente", 129), (21, "batterie_prix_ht", 40),
                                  (22, "ecran_prix_ht", Decimal("280"))], R)
    assert out == [(20, "batterie_prix_ht", 13), (21, "batterie_prix_ht", 40), (22, "ecran_prix_ht", Decimal("280")),
                   (20, "batterie_prix_vente", 109), (22, "batterie_prix_vente", 469)]                   # (280+50)×1,2+70=466
    # Verrou : jamais touchée
    cur.apple[0]["verrou_manuel"] = True
    assert PE.deriver_changements(cur, "tarifs_apple_devices", [(20, "batterie_prix_ht", 13)], R) == [(20, "batterie_prix_ht", 13)]


def test_derives_plan_et_recalculer(monkeypatch):
    cur = _Cur(PIXEL + GALAXY, APPLE)
    # Aperçu : HT après ajustement (+10 % sur l'écran Original seulement) → batterie Pixel 7 dérivée de 66
    d = PE.derives_plan(cur, PIXEL + GALAXY, {2: Decimal("66")}, R)
    assert d == {3: prix.arrondir((66 + 12) * 1.2 + 70, "9_sup")} and d[3] == 169
    # Recalcul explicite : écritures capturées ; Google (actif) dérivé, Samsung (inactif) formule ordinaire
    ecrits = []

    def faux(cur_, table, changements, source, par, lot_id=None, saisie=None, **kw):
        ecrits.append((table, list(changements), source, kw.get("deriver")))
        return {"ecrits": [(i, c, None, v) for i, c, v in changements], "verrouilles": [], "inchanges": 0, "absents": []}

    monkeypatch.setattr(prix, "ecrire_prix_lot", faux)
    cur.tarifs[6]["prix_client"] = 999      # batterie Galaxy A54 au mauvais prix → formule ordinaire 10×1,2+60=72 → 79
    res = PE.recalculer(cur, "formule", "admin", "lot-1", R, modeles=[("Google", "Pixel 7"), ("Samsung", "Galaxy A54")], devices=[20, 21])
    assert ecrits[0] == ("tarifs", [(3, "prix_client", 159), (11, "prix_client", 79)], "formule", False)
    assert ecrits[1] == ("tarifs_apple_devices", [(20, "batterie_prix_vente", 109)], "formule", False)      # MacBook Air : 40×1,2+120=168→169 inchangé
    assert res["ecrits"] == [("tarifs", 3, None, 159), ("tarifs", 11, None, 79), ("tarifs_apple_devices", 20, None, 109)]


def test_options_et_etat_modele():
    cur = _Cur(PIXEL)
    PE.regler_modele(cur, " Google", "Pixel 7 ", False, "admin")
    assert cur.options == {("google", "pixel 7"): False}
    assert PE.etat_modele(cur, [("Google", "Pixel 7")]) == {"actif": False, "explicite": False, "defaut": True}
    PE.regler_modele(cur, "Google", "Pixel 7", None)
    assert cur.options == {} and PE.etat_modele(cur, [("Google", "Pixel 7")]) == {"actif": True, "explicite": None, "defaut": True}
    assert PE.etat_modele(cur, [("Samsung", "Galaxy A54")]) == {"actif": False, "explicite": None, "defaut": False}
    assert PE.etat_modele(cur, [], categorie_apple="ipad") == {"actif": True, "explicite": None, "defaut": True}
    assert PE.etat_modele(cur, [], categorie_apple="macbook", explicite_apple=True) == {"actif": True, "explicite": True, "defaut": False}
    assert PE.etat_modele(cur, []) == {"actif": False, "explicite": None, "defaut": False}


# ─── ecrire_prix_lot : la dérivation est branchée (et débrayable) ─

class _CurEcriture(_Cur):
    """Lecture sous verrou des lignes demandées ; les écritures composées sont seulement notées."""

    def execute(self, sql, params=None):
        s = " ".join(str(sql if isinstance(sql, str) else sql.decode()).split())
        if "FOR UPDATE" in s:
            self.sql.append((s, params))
            self._res = [{**x, "prix_maj_le": None, "prix_source": None} for x in self.tarifs if x["id"] in params[0]]
            return
        if s.startswith("UPDATE tarifs AS t") or s.startswith("INSERT INTO tarifs_historique"):
            self.sql.append((s, params))
            self._res = []
            return
        super().execute(sql, params)


def test_ecrire_prix_lot_derive_les_batteries_du_modele(monkeypatch):
    cur = _CurEcriture(PIXEL)
    res = prix.ecrire_prix_lot(cur, "tarifs", [(2, "prix_fournisseur_ht", 50)], "import", "synchro", "lot-2")
    # L'écran Original baisse à 50 : l'écran est écrit, et la batterie 3 suit dans le même lot (149)
    assert [(i, c, n) for i, c, _, n in res["ecrits"]] == [(2, "prix_fournisseur_ht", Decimal("50")), (3, "prix_client", 149)]
    lus = [p[0] for s_, p in cur.sql if "FOR UPDATE" in s_]
    assert lus == [[2, 3]]
    # Lignes déjà lues par l'appelant : seule la batterie manquante est relue
    cur2 = _CurEcriture(PIXEL)
    ligne2 = {**PIXEL[1], "prix_maj_le": None, "prix_source": None}
    res2 = prix.ecrire_prix_lot(cur2, "tarifs", [(2, "prix_fournisseur_ht", 50)], "manuel", "admin", "lot-3", lignes={2: ligne2})
    assert [i for i, _, _, _ in res2["ecrits"]] == [2, 3] and [p[0] for s_, p in cur2.sql if "FOR UPDATE" in s_] == [[3]]
    # deriver=False (prix tapé par l'admin) et source 'annulation' : jamais de dérivation
    cur3 = _CurEcriture(PIXEL)
    res3 = prix.ecrire_prix_lot(cur3, "tarifs", [(2, "prix_fournisseur_ht", 50)], "manuel", "admin", "lot-4", deriver=False)
    assert [i for i, _, _, _ in res3["ecrits"]] == [2]
    cur4 = _CurEcriture(PIXEL)
    res4 = prix.ecrire_prix_lot(cur4, "tarifs", [(2, "prix_fournisseur_ht", 50)], "annulation", "admin", "lot-5")
    assert [i for i, _, _, _ in res4["ecrits"]] == [2]


# ─── Routes ──────────────────────────────────────────────────────

def test_routes_reglage_reservees_a_l_admin(client):
    corps = {"marque": "Google", "modele": "Pixel 7", "actif": False}
    assert client.put("/api/tarifs/modeles/batterie-par-ecran", json=corps).status_code == 401
    _, gc_staff = fake_db(lambda sql, params: None)
    with patch("app.api.auth.get_cursor", gc_staff):
        assert client.put("/api/tarifs/modeles/batterie-par-ecran", json=corps, headers=_headers()).status_code == 403
        assert client.put("/api/tarifs/apple-devices/5/batterie-par-ecran", json={"actif": True}, headers=_headers()).status_code == 403
    _, gc_admin = fake_db(lambda sql, params: _ADMIN_PROUVE if "membres_equipe" in sql else None)
    with patch("app.api.auth.get_cursor", gc_admin):
        # Fiche introuvable : 404, sans écriture de prix
        with patch("app.api.tarifs.get_cursor", fake_db(lambda sql, params: None)[1]):
            r = client.put("/api/tarifs/apple-devices/5/batterie-par-ecran", json={"actif": True}, headers=_headers())
        assert r.status_code == 404
        assert client.put("/api/tarifs/modeles/batterie-par-ecran", json={"marque": "", "modele": "x"}, headers=_headers()).status_code == 422


def test_fiche_du_modele_batterie_par_ecran(client, monkeypatch):
    """GET /reparation-smartphones/modele : la batterie d'un Pixel porte par_ecran et son calcul dérivé."""
    from app.api import tarifs as T
    lignes = [{**x, "nom_fournisseur": None, "en_stock": True, "prix_maj_le": None, "prix_source": "import", "ref_fournisseur": None,
               "fournisseur": "Mobilax", "url_fournisseur": None} for x in PIXEL]

    def sql(s, params):
        s = " ".join(s.split())
        if "FROM catalog_modeles" in s:
            return [{"marque": "Google", "modele": "Pixel 7", "categorie": "smartphone", "annee": 2022, "ordre": 1}]
        if s.startswith("SELECT id, marque, modele, type_piece, qualite, categorie, nom_fournisseur"):
            return lignes
        if "membres_equipe" in s:
            return _ADMIN_PROUVE
        return None

    cur, gc = fake_db(sql)
    monkeypatch.setattr(T, "_est_admin", lambda request, user: True)
    with patch("app.api.tarifs.get_cursor", gc), patch("app.api.grille.get_cursor", gc), patch("app.api.auth.get_cursor", gc):
        r = client.get("/api/tarifs/reparation-smartphones/modele", params={"marque": "Google", "modele": "Pixel 7"}, headers=_headers())
    assert r.status_code == 200, r.text
    corps = r.json()
    assert corps["batterie_par_ecran"] == {"actif": True, "explicite": None, "defaut": True, "device_id": None,
                                           "ecran": {"cle": "tarifs:2", "qualite": "Original"}, "marge": 70}
    pieces = {p["cle"]: p for p in corps["pieces"]}
    assert pieces["tarifs:3"]["par_ecran"] is True
    assert pieces["tarifs:3"]["calcul"] == {"ht": 12.0, "ht_ecran": 60.0, "tva": 1.2, "marge": 70, "brut": 156.4, "arrondi": 159,
                                            "par_ecran": True, "ecran_qualite": "Original", "ecran_cle": "tarifs:2"}
    assert pieces["tarifs:2"]["par_ecran"] is False and pieces["tarifs:2"]["calcul"]["marge"] == 60
    assert pieces["tarifs:5"]["par_ecran"] is False
