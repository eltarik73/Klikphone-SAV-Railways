"""Moteur de prix — finitions : cadenas des grilles boutique appliqués par le serveur, associations
manuelles d'un import (pré-évaluation, alertes, confirmation), pièces « absentes » limitées à ce
que le fichier couvre, annulation du lot d'une proposition acceptée.

Règle des cadenas (PRIX_LIGNES_VERROUILLEES = {table: [ids]} pour tarifs_reparation,
iphone_tarifs, smartphones_tarifs), la même que verrou_manuel des pièces fournisseur : une saisie
manuelle explicite d'un admin sur la ligne reste permise (PUT /reparation/{id}, PATCH
/iphone-tarifs/{id}, POST/PATCH /smartphones-tarifs) et le cadenas reste posé ; jamais
d'ajustement global (/simuler et /appliquer l'excluent et le listent), de mise à jour en masse
(/reparation/bulk) ni d'annulation de lot (conflit listé) sur une ligne cadenassée.

Les tests purs tournent toujours. Ceux sur base réelle exigent une base PostgreSQL JETABLE,
chargée avec la copie des grilles de la prod (mêmes fixtures que tests/test_prix_moteur.py) :
    KP_PRIX_DATABASE_URL="postgresql://postgres:<mdp>@127.0.0.1:5432/kp_prix?sslmode=disable" \\
    KP_PRIX_CSV_DIR=<dossier des CSV de la prod> pytest tests/test_prix_finitions.py
"""

import json
from decimal import Decimal

import pytest

from app.services import import_prix
from app.services import params as params_cache
from app.services import prix
from tests.test_prix_moteur import (  # noqa: F401  (fixtures reel et base)
    ADMIN, CSV_DIR, _apercu, _appliquer, _empreinte, _h_admin, _h_staff, _id, _n_historique, _post, _sql,
    _tarif, base, reel,
)


# ═══ Purs ══════════════════════════════════════════════════════

class _Cur:
    def __init__(self, valeur):
        self.valeur, self.sql = valeur, []

    def execute(self, sql, params=None):
        self.sql.append((sql, params))

    def fetchone(self):
        return None if self.valeur is None else {"valeur": self.valeur}


@pytest.mark.parametrize("valeur, attendu", [
    (None, {}),
    ("", {}),
    ("pas du json", {}),
    ("[1, 2]", {}),
    ('{"tarifs_reparation": [9, 10], "iphone_tarifs": [], "tarifs": [1]}',
     {"tarifs_reparation": {9, 10}, "iphone_tarifs": set()}),
    ('{"smartphones_tarifs": [3, "4", true, 5.5]}', {"smartphones_tarifs": {3}}),
    ('{"tarifs_reparation": 9}', {}),
])
def test_lignes_verrouillees_tolerantes(valeur, attendu):
    cur = _Cur(valeur)
    assert prix.lignes_verrouillees(cur) == attendu
    assert cur.sql == [("SELECT valeur FROM params WHERE cle = %s", (prix.PARAM_VERROUS_BOUTIQUE,))]


def test_lignes_verrouillees_curseur_simule():
    from unittest.mock import MagicMock
    assert prix.lignes_verrouillees(MagicMock()) == {}


def _piece(**kw):
    e = {"table": "tarifs", "colonne": None, "type_piece": "Ecran", "categorie": "standard", "ht": Decimal("40.00"),
         "client": 109, "verrou": False}
    e.update(kw)
    return e


def test_evaluer_piece_memes_alertes_que_l_apercu():
    r = prix.valider_regles({})
    ev = import_prix.evaluer_piece(_piece(), Decimal("40.00"), r)
    assert ev == {"nouveau_client": 109, "change": False, "alertes": []}
    ev = import_prix.evaluer_piece(_piece(), Decimal("75.00"), r)          # +35 € et +87 % : variation
    assert ev["alertes"] == ["variation"] and ev["nouveau_client"] == prix.prix_client(75, "Ecran", "standard", r)
    ev = import_prix.evaluer_piece(_piece(verrou=True), Decimal("75.00"), r)
    assert ev["alertes"] == ["verrou", "variation"]
    # Marge d'un écran sous le seuil : 40,75 HT → 109 € (marge 60,10), seuil relevé à 65
    r65 = prix.valider_regles({"seuil_marge_alerte": 65})
    ev = import_prix.evaluer_piece(_piece(), Decimal("40.75"), r65)
    assert (ev["nouveau_client"], ev["alertes"]) == (109, ["marge"])
    # Une batterie n'a jamais d'alerte de marge
    assert import_prix.evaluer_piece(_piece(type_piece="Batterie"), Decimal("40.75"), r65)["alertes"] == []
    # iPad : écran selon la colonne
    ipad = {"table": "tarifs_apple_devices", "colonne": "ecran", "type_piece": "Écran", "categorie": "ipad",
            "ht": Decimal("45.50"), "client": 169, "verrou": False}
    assert import_prix.evaluer_piece(ipad, Decimal("45.50"), prix.valider_regles({"seuil_marge_alerte": 120})
                                     )["alertes"] == ["marge"]


J = 86400


@pytest.mark.parametrize("ligne, attendu", [
    ({"age_jours": 90, "age_secondes": 90 * J + 43200}, "a_revoir"),   # 90 j 12 h : comme prix.sante
    ({"age_jours": 90, "age_secondes": 90 * J}, "ok"),                 # pile 90 j : pas encore
    ({"age_jours": 180, "age_secondes": 180 * J}, "a_revoir"),
    ({"age_jours": 180, "age_secondes": 180 * J + 1}, "perime"),
    ({"age_jours": None, "age_secondes": None}, "perime"),             # jamais daté
    ({"age_jours": -1, "age_secondes": -3600.0}, "ok"),
    ({"age_jours": 91}, "a_revoir"),                                   # sans âge exact : jours entiers
    ({"age_jours": 90}, "ok"),
])
def test_fraicheur_meme_critere_que_la_sante(ligne, attendu):
    from app.api import tarifs as api_tarifs
    out = api_tarifs._fraicheur(dict(ligne), prix.valider_regles({}))
    assert out["fraicheur"] == attendu and "age_secondes" not in out
    assert out["age_jours"] == ligne["age_jours"]


# ═══ Base réelle : outils ══════════════════════════════════════

def _cadenasser(base, **tables):
    """Pose les cadenas par la vraie route de configuration (rôle admin et code)."""
    r = base["c"].put("/api/config", headers=_h_admin(),
                      json={"cle": prix.PARAM_VERROUS_BOUTIQUE, "valeur": json.dumps(tables)})
    assert r.status_code == 200, r.text
    params_cache.invalidate()


def _ligne(base, table, ident):
    return _sql(base, f"SELECT * FROM {table} WHERE id = %s", ident)[0]


def _grille(base, table, where, *params):
    return _sql(base, f"SELECT * FROM {table} WHERE {where} ORDER BY id", *params)


def _prod(base):
    if not CSV_DIR or _sql(base, "SELECT count(*) AS n FROM tarifs_reparation WHERE id = 397")[0]["n"] == 0:
        pytest.skip("Base sans la copie des grilles de la prod (KP_PRIX_CSV_DIR)")


# ═══ 1) Cadenas des grilles boutique, côté serveur ═════════════

def test_reel_cadenas_reparation_simuler_appliquer_exclut_et_liste(base):
    _prod(base)
    i13 = _grille(base, "tarifs_reparation", "modele = 'iPhone 13'")[0]
    i14 = _grille(base, "tarifs_reparation", "modele = 'iPhone 14'")[0]
    _cadenasser(base, tarifs_reparation=[i13["id"]])
    cle = f"tarifs_reparation:{i13['id']}:batterie"
    n = _n_historique(base)
    # Toute la colonne, puis la ligne cadenassée demandée explicitement dans filtre.ids
    for filtre in ({"colonne": "batterie"}, {"colonne": "batterie", "ids": [i13["id"], i14["id"]]}):
        charge = {"cible": "tarifs_reparation", "filtre": filtre, "ajustement": {"type": "pct", "valeur": 10}}
        sim = _post(base, "/api/tarifs/simuler", json=charge).json()
        assert sim["verrouilles"] == 1 and sim["verrouilles_liste"] == [{"cle": cle, "label": "iPhone 13 — batterie"}]
        assert cle not in {e["cle"] for e in sim["ecarts"]} and sim["modifies"] >= 1
    assert _n_historique(base) == n                                           # simuler n'écrit rien
    r = _post(base, "/api/tarifs/appliquer", json={**charge, "confirmer": True})
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["modifies"] == 1 and res["verrouilles"] == 1 and res["verrouilles_liste"][0]["cle"] == cle
    assert _ligne(base, "tarifs_reparation", i13["id"]) == i13                # rien n'a bougé, ni la date
    assert _ligne(base, "tarifs_reparation", i14["id"])["batterie"] == prix.ajuster(i14["batterie"], charge["ajustement"], True)
    assert _sql(base, "SELECT DISTINCT ligne_id FROM tarifs_historique WHERE lot_id = %s", res["lot_id"]) == [
        {"ligne_id": i14["id"]}]


def test_reel_cadenas_pose_entre_apercu_et_application(base):
    _prod(base)
    lignes = _grille(base, "iphone_tarifs", "prix_1 > 0")
    cadenas, libre = lignes[0], lignes[1]
    charge = {"cible": "iphone_tarifs", "filtre": {"colonne": "prix_1", "ids": [cadenas["id"], libre["id"]]},
              "ajustement": {"type": "eur", "valeur": 20}}
    assert _post(base, "/api/tarifs/simuler", json=charge).json()["verrouilles"] == 0
    _cadenasser(base, iphone_tarifs=[cadenas["id"]])                         # autre poste, entre-temps
    res = _post(base, "/api/tarifs/appliquer", json={**charge, "confirmer": True}).json()
    assert (res["modifies"], res["verrouilles"]) == (1, 1)
    assert _ligne(base, "iphone_tarifs", cadenas["id"])["prix_1"] == cadenas["prix_1"]
    assert _ligne(base, "iphone_tarifs", libre["id"])["prix_1"] == prix.ajuster(libre["prix_1"], charge["ajustement"], True)


def test_reel_cadenas_smartphones_ajustement_global(base):
    _prod(base)
    actifs = _grille(base, "smartphones_tarifs", "actif AND prix_1 > 0")
    cadenas = actifs[0]
    _cadenasser(base, smartphones_tarifs=[cadenas["id"]])
    charge = {"cible": "smartphones_tarifs", "filtre": {"colonne": "prix_1"}, "ajustement": {"type": "pct", "valeur": -5}}
    res = _post(base, "/api/tarifs/appliquer", json={**charge, "confirmer": True}).json()
    assert res["verrouilles"] == 1 and res["modifies"] == len(actifs) - 1
    assert _ligne(base, "smartphones_tarifs", cadenas["id"])["prix_1"] == cadenas["prix_1"]


def test_reel_cadenas_saisie_manuelle_explicite_permise(base):
    _prod(base)
    i13 = _grille(base, "tarifs_reparation", "modele = 'iPhone 13'")[0]
    ip = _grille(base, "iphone_tarifs", "slug = 'iphone-13'")[0]
    sp = _grille(base, "smartphones_tarifs", "slug = 'samsung-galaxy-s24'")[0]
    _cadenasser(base, tarifs_reparation=[i13["id"]], iphone_tarifs=[ip["id"]], smartphones_tarifs=[sp["id"]])
    h = _h_admin()
    r = base["c"].put(f"/api/tarifs/reparation/{i13['id']}", headers=h, json={"batterie": 105})
    assert r.status_code == 200 and r.json()["batterie"] == 105, r.text
    r = base["c"].patch(f"/api/iphone-tarifs/{ip['id']}", headers=h, json={"prix_1": 379})
    assert r.status_code == 200, r.text
    r = base["c"].patch(f"/api/smartphones-tarifs/{sp['id']}", headers=h, json={"prix_1": 459})
    assert r.status_code == 200 and r.json()["prix_1"] == 459, r.text
    assert _ligne(base, "iphone_tarifs", ip["id"])["prix_1"] == 379
    h_src = _sql(base, "SELECT table_nom, source, nouveau FROM tarifs_historique ORDER BY id DESC LIMIT 3")
    assert sorted((x["table_nom"], x["source"], x["nouveau"]) for x in h_src) == [
        ("iphone_tarifs", "manuel", 379), ("smartphones_tarifs", "manuel", 459), ("tarifs_reparation", "manuel", 105)]
    # Le cadenas reste posé : un ajustement global ne touche toujours pas la ligne
    assert json.loads(_sql(base, "SELECT valeur FROM params WHERE cle = %s", prix.PARAM_VERROUS_BOUTIQUE)[0]["valeur"]
                      )["tarifs_reparation"] == [i13["id"]]
    res = _post(base, "/api/tarifs/appliquer", json={
        "cible": "tarifs_reparation", "filtre": {"ids": [i13["id"]], "colonne": "batterie"},
        "ajustement": {"type": "pct", "valeur": 10}, "confirmer": True}).json()
    assert (res["modifies"], res["verrouilles"]) == (0, 1) and _ligne(base, "tarifs_reparation", i13["id"])["batterie"] == 105


def test_reel_cadenas_bulk_laisse_la_ligne_et_la_liste(base):
    _prod(base)
    i13 = _grille(base, "tarifs_reparation", "modele = 'iPhone 13'")[0]
    i14 = _grille(base, "tarifs_reparation", "modele = 'iPhone 14'")[0]
    _cadenasser(base, tarifs_reparation=[i13["id"]])
    r = _post(base, "/api/tarifs/reparation/bulk", json=[{"modele": "iPhone 13", "batterie": 1},
                                                         {"modele": "iPhone 14", "batterie": 111}])
    assert r.status_code == 200, r.text
    assert r.json()["verrouilles"] == [{"id": i13["id"], "modele": "iPhone 13"}] and r.json()["modifies"] == 1
    assert _ligne(base, "tarifs_reparation", i13["id"]) == i13
    assert _ligne(base, "tarifs_reparation", i14["id"])["batterie"] == 111


def test_reel_cadenas_annuler_lot_ne_restaure_pas_une_ligne_cadenassee_depuis(base):
    _prod(base)
    lignes = _grille(base, "tarifs_reparation", "modele IN ('iPhone 13', 'iPhone 14')")
    charge = {"cible": "tarifs_reparation", "filtre": {"ids": [x["id"] for x in lignes], "colonne": "batterie"},
              "ajustement": {"type": "eur", "valeur": 10}}
    res = _post(base, "/api/tarifs/appliquer", json={**charge, "confirmer": True}).json()
    assert res["modifies"] == 2
    cadenas, libre = lignes
    apres_lot = _ligne(base, "tarifs_reparation", cadenas["id"])
    _cadenasser(base, tarifs_reparation=[cadenas["id"]])
    r = _post(base, f"/api/tarifs/historique/annuler-lot/{res['lot_id']}")
    assert r.status_code == 200, r.text
    a = r.json()
    assert a["conflits"] == [f"tarifs_reparation:{cadenas['id']}:batterie"]
    assert a["verrouilles"] == [f"tarifs_reparation:{cadenas['id']}"] and a["restaures"] == 1
    assert _ligne(base, "tarifs_reparation", cadenas["id"]) == apres_lot      # gardée telle quelle
    retablie = _ligne(base, "tarifs_reparation", libre["id"])
    assert (retablie["batterie"], retablie["prix_maj_le"]) == (libre["batterie"], libre["prix_maj_le"])


def test_reel_cadenas_ecrire_prix_lot_regle_des_sources(base):
    _prod(base)
    i13 = _grille(base, "tarifs_reparation", "modele = 'iPhone 13'")[0]
    _cadenasser(base, tarifs_reparation=[i13["id"]])
    with base["cur"]() as cur:
        for source, saisie in (("manuel", False), ("annulation", None), ("formule", None), ("annulation", True)):
            res = prix.ecrire_prix_lot(cur, "tarifs_reparation", [(i13["id"], "batterie", 1)], source, "pytest",
                                       saisie=saisie)
            assert res["verrouilles"] == [i13["id"]] and res["ecrits"] == [], (source, saisie)
        assert prix.ecrire_prix(cur, "tarifs_reparation", i13["id"], "batterie", 101, "manuel", "pytest") is True
    assert _ligne(base, "tarifs_reparation", i13["id"])["batterie"] == 101
    # Le verrou_manuel des pièces fournisseur suit la même règle
    tid = _id(base, "Oppo", "Reno 10", "Batterie")
    _sql(base, "UPDATE tarifs SET verrou_manuel = TRUE WHERE id = %s", tid)
    with base["cur"]() as cur:
        assert prix.ecrire_prix(cur, "tarifs", tid, "prix_client", 75, "manuel", "pytest", saisie=False) is False
        assert prix.ecrire_prix(cur, "tarifs", tid, "prix_client", 75, "manuel", "pytest") is True


# ═══ 2) Import : lignes non reconnues, pré-évaluation, associations ═══

CSV_ASSOCIATIONS = (
    "Désignation;Prix HT\n"
    "Ecran Original Samsung Galaxy A25;42,00\n"          # 2 : reconnue, inchangée
    "Ecran Samsung Galaxy A54;30,00\n"                   # 3 : qualité d'écran à préciser
    "Pièce mystère 3000;7,00\n"                          # 4 : type de pièce non reconnu
    "Batterie Apple iPhone 13 grade A;11,40\n"           # 5 : reconnue (batterie iPhone 13)
    "Ecran Soft OLED Apple iPhone 13;140,00\n"           # 6 : reconnue, grosse variation
).encode()


def test_reel_non_reconnues_portent_le_prix_et_les_champs_devines(base):
    _prod(base)
    ap = _apercu(base, "assoc.csv", contenu=CSV_ASSOCIATIONS)
    nr = {x["n"]: x for x in ap["non_reconnues"]}
    assert set(nr) == {3, 4}
    assert nr[3] == {"n": 3, "brut": "Ecran Samsung Galaxy A54", "raison": "qualité d'écran à préciser",
                     "designation": "Ecran Samsung Galaxy A54", "nouveau_ht": 30.0, "ref": None,
                     "marque": "Samsung", "modele": "Galaxy A54", "type_piece": "Ecran", "qualite": None}
    assert {k: nr[4][k] for k in ("nouveau_ht", "designation", "type_piece", "qualite")} == {
        "nouveau_ht": 7.0, "designation": "Pièce mystère 3000", "type_piece": None, "qualite": None}
    assert ap["evaluer_url"] == f"/api/tarifs/import-fichier/{ap['import_id']}/evaluer"


def test_reel_evaluer_une_association_sans_ecriture(base):
    _prod(base)
    ap = _apercu(base, "assoc.csv", contenu=CSV_ASSOCIATIONS)
    a54_orig, a54_soft = _id(base, "Samsung", "Galaxy A54", "Ecran", "Original"), _id(base, "Samsung", "Galaxy A54", "Ecran", "Soft OLED")
    avant, n = _empreinte(base), _n_historique(base)
    r = _post(base, ap["evaluer_url"], json={"associations": [
        {"n": 3, "cle": f"tarifs:{a54_soft}"},        # 42 → 30 € : −28,6 % → variation
        {"n": 3, "cle": f"tarifs:{a54_orig}"},        # 65 → 30 € : variation
        {"n": 4, "cle": f"tarifs:{_id(base, 'Oppo', 'Reno 10', 'Connecteur de charge')}"},
        {"n": 99, "cle": f"tarifs:{a54_orig}"},
        {"n": 3, "cle": "tarifs_apple_devices:1:ecran"},
        {"n": 3, "cle": "tarifs:99999999"},
    ]})
    assert r.status_code == 200, r.text
    ev = r.json()
    assert (_empreinte(base), _n_historique(base)) == (avant, n)
    soft = _tarif(base, a54_soft)
    assert ev[0] == {
        "n": 3, "cle": f"tarifs:{a54_soft}", "label": "Samsung Galaxy A54 — Ecran Soft OLED",
        "ancien_ht": float(soft["prix_fournisseur_ht"]), "nouveau_ht": 30.0, "ancien_client": soft["prix_client"],
        "nouveau_client": prix.prix_client(30, "Ecran", soft["categorie"], prix.REGLES_DEFAUT), "change": True,
        "verrou": False, "obsolete": False, "alerte": "variation", "alertes": ["variation"],
        "confirmation_requise": True}
    assert ev[1]["alertes"] == ["variation"] and ev[1]["confirmation_requise"] is True
    connecteur = _tarif(base, _id(base, "Oppo", "Reno 10", "Connecteur de charge"))
    attendu = prix.alertes_variation(connecteur["prix_fournisseur_ht"], Decimal("7.00"), prix.REGLES_DEFAUT)
    assert ev[2]["alertes"] == attendu and ev[2]["confirmation_requise"] is bool(attendu)
    assert [x.get("erreur", "")[:20] for x in ev[3:]] == [
        "Ligne 99 : absente d", "Association tarifs_a", "Pièce introuvable : "]
    # Mêmes calculs et mêmes alertes qu'une ligne reconnue : la ligne 6 réévaluée vers sa propre pièce
    rec6 = next(x for x in ap["reconnues"] if x["n"] == 6)
    ev6 = _post(base, ap["evaluer_url"], json={"associations": [{"n": 6, "cle": rec6["cle"]}]}).json()[0]
    assert {k: ev6[k] for k in ("ancien_ht", "nouveau_ht", "ancien_client", "nouveau_client", "change", "alertes")} == {
        k: rec6[k] for k in ("ancien_ht", "nouveau_ht", "ancien_client", "nouveau_client", "change", "alertes")}
    # Admin prouvé seulement ; aperçu appliqué : 409
    assert base["c"].post(ap["evaluer_url"], headers=_h_staff(), json={"associations": []}).status_code == 403
    _appliquer(base, ap["import_id"], lignes=[2])
    assert _post(base, ap["evaluer_url"], json={"associations": [{"n": 3, "cle": f"tarifs:{a54_orig}"}]}).status_code == 409
    assert _post(base, "/api/tarifs/import-fichier/999999/evaluer", json={"associations": []}).status_code == 404


def test_reel_association_avec_alerte_exige_la_confirmation(base):
    _prod(base)
    a54_soft = _id(base, "Samsung", "Galaxy A54", "Ecran", "Soft OLED")
    connecteur = _id(base, "Oppo", "Reno 10", "Connecteur de charge")
    avant_soft = _tarif(base, a54_soft)
    _sql(base, "UPDATE tarifs SET prix_fournisseur_ht = 6.80 WHERE id = %s", connecteur)   # 6,80 → 7,00 : sans alerte
    ap = _apercu(base, "assoc.csv", contenu=CSV_ASSOCIATIONS)
    assoc = [{"n": 3, "cle": f"tarifs:{a54_soft}"}, {"n": 4, "cle": f"tarifs:{connecteur}"}]
    # Non confirmée : l'association en alerte est ignorée et listée, l'autre appliquée
    r = _appliquer(base, ap["import_id"], lignes=[2], associations=assoc)
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["associees"] == 1 and [(x["n"], x["cle"], x["alertes"]) for x in res["associations_ignorees"]] == [
        (3, f"tarifs:{a54_soft}", ["variation"])]
    assert _tarif(base, a54_soft) == avant_soft
    c = _tarif(base, connecteur)
    assert (c["prix_fournisseur_ht"], c["prix_source"]) == (Decimal("7.00"), "import")
    assert c["prix_client"] == prix.prix_client(Decimal("7.00"), c["type_piece"], c["categorie"], prix.REGLES_DEFAUT)
    # Confirmée (n dans lignes, ou dans confirmees) : appliquée, prix client recalculé, historique 'import'
    for confirmation in ({"lignes": [3]}, {"confirmees": [3]}):
        ap = _apercu(base, "assoc.csv", contenu=CSV_ASSOCIATIONS)
        res = _appliquer(base, ap["import_id"], associations=assoc[:1], **confirmation).json()
        assert res["associees"] == 1 and res["associations_ignorees"] == [] and res["modifies"] == 1, res
        t = _tarif(base, a54_soft)
        assert (t["prix_fournisseur_ht"], t["prix_client"]) == (
            Decimal("30.00"), prix.prix_client(30, "Ecran", t["categorie"], prix.REGLES_DEFAUT))
        assert _post(base, f"/api/tarifs/historique/annuler-lot/{res['lot_id']}").json()["restaures"] == 2
        assert _tarif(base, a54_soft)["prix_fournisseur_ht"] == avant_soft["prix_fournisseur_ht"]
    # Une ligne cochée qui n'est ni reconnue ni associée : refus total
    ap = _apercu(base, "assoc.csv", contenu=CSV_ASSOCIATIONS)
    assert _appliquer(base, ap["import_id"], lignes=[3]).status_code == 422


def test_reel_association_alerte_de_marge_et_piece_verrouillee(base):
    _prod(base)
    # Seuil de marge relevé à 65 € : un écran standard à 40,00 HT → 109 € (marge 61) passe sous le seuil
    _sql(base, "INSERT INTO params (cle, valeur) VALUES (%s, %s) ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur",
         prix.CLE_REGLES, json.dumps({"seuil_marge_alerte": 65}))
    params_cache.invalidate()
    a25_orig = _id(base, "Samsung", "Galaxy A25", "Ecran", "Original")      # 42,00 HT → 40,00 : pas de variation
    contenu = "Désignation;Prix HT\nEcran Samsung Galaxy A25;40,00\n".encode()
    ap = _apercu(base, "marge.csv", contenu=contenu)
    assert ap["non_reconnues"][0]["raison"] == "qualité d'écran à préciser"
    ev = _post(base, ap["evaluer_url"], json={"associations": [{"n": 2, "cle": f"tarifs:{a25_orig}"}]}).json()[0]
    assert ev["alertes"] == ["marge"] and ev["confirmation_requise"] is True and ev["nouveau_client"] == 109
    avant = _tarif(base, a25_orig)
    res = _appliquer(base, ap["import_id"], associations=[{"n": 2, "cle": f"tarifs:{a25_orig}"}]).json()
    assert res["associees"] == 0 and res["associations_ignorees"][0]["alertes"] == ["marge"]
    assert res["associations_verrouillees"] == []
    assert _tarif(base, a25_orig) == avant
    # Pièce verrouillée : jamais modifiée, même confirmée — et pas comptée « associée » (rien d'écrit)
    _sql(base, "UPDATE tarifs SET verrou_manuel = TRUE WHERE id = %s", a25_orig)
    ap = _apercu(base, "marge.csv", contenu=contenu)
    ev = _post(base, ap["evaluer_url"], json={"associations": [{"n": 2, "cle": f"tarifs:{a25_orig}"}]}).json()[0]
    assert ev["alertes"] == ["verrou", "marge"] and ev["verrou"] is True
    res = _appliquer(base, ap["import_id"], lignes=[2], associations=[{"n": 2, "cle": f"tarifs:{a25_orig}"}]).json()
    assert (res["associees"], res["verrouilles"], res["modifies"]) == (0, 1, 0)
    assert [(x["n"], x["cle"], x["verrou"]) for x in res["associations_verrouillees"]] == [(2, f"tarifs:{a25_orig}", True)]
    assert res["associations_ignorees"] == []
    assert _tarif(base, a25_orig)["prix_fournisseur_ht"] == avant["prix_fournisseur_ht"]


# ═══ 3) Absentes : seulement les mêmes marque ET type de pièce ═══

def _couples_mobilax(base, couples):
    """Clés des pièces Mobilax non obsolètes de ces (marque, type de pièce, qualité ou None)."""
    out = set()
    for marque, type_piece, qualite in couples:
        out |= {f"tarifs:{r['id']}" for r in _sql(
            base, "SELECT id FROM tarifs WHERE marque = %s AND type_piece = %s AND COALESCE(qualite, '') = %s "
                  "AND obsolete IS NOT TRUE AND COALESCE(fournisseur, 'Mobilax') = 'Mobilax'",
            marque, type_piece, qualite or "")}
    return out


def test_reel_absentes_memes_marque_et_type_que_le_fichier(base):
    _prod(base)
    contenu = ("Désignation;Prix HT\n"
               "Ecran Original Samsung Galaxy A25;42,00\n"
               "Ecran Original Samsung Galaxy A54;65,00\n"
               "Batterie Apple iPhone 13;11,00\n"
               "Batterie Apple iPhone 14;12,00\n").encode()
    ap = _apercu(base, "mixte.csv", contenu=contenu)
    vues = {x["cle"] for x in ap["reconnues"]}
    assert len(vues) == 4
    attendu = _couples_mobilax(base, [("Samsung", "Ecran", "Original"), ("Apple", "Batterie", None)]) - vues
    absentes = {a["cle"] for a in ap["absentes"]}
    assert absentes == attendu and len(absentes) > 50
    assert ap["resume"]["absentes_par_type"] == {
        "Ecran": len(_couples_mobilax(base, [("Samsung", "Ecran", "Original")])) - 2,
        "Batterie": len(_couples_mobilax(base, [("Apple", "Batterie", None)])) - 2}
    # Jamais : batteries Samsung, écrans Apple, autre qualité d'écran Samsung, autre marque
    for marque, tp, q in (("Samsung", "Batterie", None), ("Apple", "Ecran", "Original"), ("Samsung", "Ecran", "Incell"),
                          ("Xiaomi", "Ecran", "Original"), ("Apple", "Connecteur de charge", None)):
        assert not absentes & _couples_mobilax(base, [(marque, tp, q)]), (marque, tp, q)
    # Application : seules les absentes deviennent obsolètes, rien n'est supprimé
    n = _sql(base, "SELECT count(*) AS n FROM tarifs")[0]["n"]
    res = _appliquer(base, ap["import_id"], lignes=[x["n"] for x in ap["reconnues"]], marquer_obsoletes=True).json()
    assert res["obsoletes"] == len(attendu)
    obsoletes = {f"tarifs:{r['id']}" for r in _sql(base, "SELECT id FROM tarifs WHERE obsolete")}
    assert obsoletes == attendu and _sql(base, "SELECT count(*) AS n FROM tarifs")[0]["n"] == n


def test_reel_absentes_jamais_une_piece_qu_une_ligne_non_reconnue_ou_invalide_peut_designer(base):
    _prod(base)
    contenu = ("Désignation;Prix HT\n"
               "Ecran Original Samsung Galaxy A25;42,00\n"   # reconnue : couvre les écrans Samsung « Original »
               "Ecran Samsung Galaxy A54;60,00\n"            # non reconnue (qualité à préciser)
               "Ecran Original Samsung Galaxy A12;abc\n"     # prix illisible
               "Ecran Original Samsung Galaxy S23;\n").encode()  # sans prix
    ap = _apercu(base, "protection.csv", contenu=contenu)
    assert [x["n"] for x in ap["non_reconnues"]] == [3] and [x["n"] for x in ap["invalides"]] == [4]
    absentes = {a["cle"] for a in ap["absentes"]}
    for modele in ("Galaxy A54", "Galaxy A12", "Galaxy S23"):
        assert f"tarifs:{_id(base, 'Samsung', modele, 'Ecran', 'Original')}" not in absentes, modele
    autres = _couples_mobilax(base, [("Samsung", "Ecran", "Original")]) - {
        f"tarifs:{_id(base, 'Samsung', m, 'Ecran', 'Original')}" for m in ("Galaxy A25", "Galaxy A54", "Galaxy A12", "Galaxy S23")}
    assert absentes == autres
    res = _appliquer(base, ap["import_id"], lignes=[2], marquer_obsoletes=True, ignorer_invalides=True).json()
    assert res["obsoletes"] == len(autres)
    assert _tarif(base, _id(base, "Samsung", "Galaxy A54", "Ecran", "Original"))["obsolete"] is False


def test_reel_absentes_jamais_une_piece_associee_meme_ignoree(base):
    _prod(base)
    # Copie de prod : écran Original du Galaxy S21 Ultra à 185,00 € HT ; la ligne 3 (désignation
    # opaque, rien à deviner) lui est associée à 250,00 € : +65 €, +35 % → alerte « variation »
    s21 = _id(base, "Samsung", "Galaxy S21 Ultra", "Ecran", "Original")
    assert _tarif(base, s21)["prix_fournisseur_ht"] == Decimal("185.00")
    contenu = ("Désignation;Prix HT\n"
               "Ecran Original Samsung Galaxy A25;42,00\n"
               "Piece XYZ ref speciale;250,00\n").encode()
    assoc = [{"n": 3, "cle": f"tarifs:{s21}"}]
    for choix in ({}, {"lignes": [3]}):                       # association ignorée, puis verrouillée
        if choix:
            _sql(base, "UPDATE tarifs SET verrou_manuel = TRUE WHERE id = %s", s21)
        ap = _apercu(base, "opaque.csv", contenu=contenu)
        assert [x["n"] for x in ap["non_reconnues"]] == [3]
        absentes = {a["cle"] for a in ap["absentes"]}
        assert f"tarifs:{s21}" in absentes                    # l'aperçu ne peut pas savoir qu'on l'associera
        res = _appliquer(base, ap["import_id"], lignes=[2] + choix.get("lignes", []), associations=assoc,
                         marquer_obsoletes=True)
        assert res.status_code == 200, res.text
        res = res.json()
        if choix:
            assert [x["cle"] for x in res["associations_verrouillees"]] == [f"tarifs:{s21}"] and res["associees"] == 0
        else:
            assert [(x["cle"], x["alertes"]) for x in res["associations_ignorees"]] == [(f"tarifs:{s21}", ["variation"])]
        t = _tarif(base, s21)
        assert t["obsolete"] is False and t["prix_fournisseur_ht"] == Decimal("185.00")
        assert res["obsoletes"] == len(absentes) - 1 > 50
        assert _sql(base, "SELECT count(*) AS n FROM tarifs WHERE obsolete")[0]["n"] == len(absentes) - 1
        assert _post(base, f"/api/tarifs/historique/annuler-lot/{res['lot_id']}").status_code == 200
        assert _sql(base, "SELECT count(*) AS n FROM tarifs WHERE obsolete")[0]["n"] == 0


def test_reel_absentes_ipad_par_categorie_et_piece(base):
    _prod(base)
    contenu = "Désignation;Prix HT\nEcran complet Original pour iPad 9 (2021);45,50\n".encode()
    ap = _apercu(base, "ipad.csv", cible="tarifs_apple_devices", contenu=contenu)
    pieces = {(prix.parse_tarif_cle(a["cle"])[2]) for a in ap["absentes"]}
    ids = {prix.parse_tarif_cle(a["cle"])[1] for a in ap["absentes"]}
    # Seuls les écrans d'iPad sont couverts : un iPad n'est absent que si toutes ses pièces à prix le
    # sont — avec une batterie à prix, jamais (les batteries ne sont pas dans le fichier)
    macbooks = {r["id"] for r in _sql(base, "SELECT id FROM tarifs_apple_devices WHERE categorie = 'macbook'")}
    assert not ids & macbooks and pieces <= {"ecran"}
    for i in ids:
        assert _sql(base, "SELECT batterie_prix_ht FROM tarifs_apple_devices WHERE id = %s", i)[0]["batterie_prix_ht"] is None


# ═══ 4) Annuler le lot d'une proposition acceptée ══════════════

def _proposer(base, tid, ht, commande_id=1):
    with base["cur"]() as cur:
        return prix.creer_proposition(cur, f"tarifs:{tid}", ht, "commande", "pytest", commande_id)


def _proposition(base, pid):
    return _sql(base, "SELECT statut, traite_le, traite_par, lot_id FROM tarifs_propositions WHERE id = %s", pid)[0]


def _lot_annule(base, lot):
    lots = base["c"].get("/api/tarifs/historique/lots", params={"limit": 200}, headers=_h_admin()).json()
    return next(x["annule"] for x in lots if x["lot_id"] == lot)


def test_reel_annulation_prix_modifie_depuis_refusee_proposition_reste_acceptee(base):
    _prod(base)
    tid = _id(base, "Oppo", "Reno 10", "Batterie")
    pid = _proposer(base, tid, "12,50")
    lot = _post(base, f"/api/tarifs/propositions/{pid}/accepter").json()["lot_id"]
    # Le gérant corrige ensuite le prix à la main : l'annulation ne l'écrase pas, et comme elle ne
    # rétablirait rien, elle est refusée sans rien changer (la proposition reste 'acceptee')
    r = base["c"].patch(f"/api/tarifs/{tid}/prix", headers=_h_admin(), json={"prix_fournisseur_ht": 14})
    assert r.status_code == 200, r.text
    avant, n = _empreinte(base), _n_historique(base)
    a = _post(base, f"/api/tarifs/historique/annuler-lot/{lot}")
    assert a.status_code == 409 and a.json()["detail"] == (
        "Rien à annuler : le prix de ce lot a été modifié depuis ; il reste tel quel."), a.text
    assert (_empreinte(base), _n_historique(base)) == (avant, n)
    p = _proposition(base, pid)
    assert (p["statut"], p["lot_id"]) == ("acceptee", lot) and p["traite_par"] == ADMIN
    assert _tarif(base, tid)["prix_fournisseur_ht"] == Decimal("14.00") and _lot_annule(base, lot) is False
    listees = base["c"].get("/api/tarifs/propositions", params={"statut": "acceptee"}, headers=_h_admin()).json()
    assert [x["id"] for x in listees] == [pid]


def test_reel_annulation_piece_verrouillee_depuis_refusee_puis_possible_sans_le_verrou(base):
    _prod(base)
    # Copie de prod : batterie du Galaxy S21 Ultra, 13,00 € HT → proposition à 30,00 € HT acceptée
    tid = _id(base, "Samsung", "Galaxy S21 Ultra", "Batterie")
    avant = _tarif(base, tid)
    assert avant["prix_fournisseur_ht"] == Decimal("13.00")
    pid = _proposer(base, tid, "30,00")
    lot = _post(base, f"/api/tarifs/propositions/{pid}/accepter").json()["lot_id"]
    assert _tarif(base, tid)["prix_fournisseur_ht"] == Decimal("30.00")
    assert base["c"].patch(f"/api/tarifs/{tid}/verrou", headers=_h_admin(), json={"verrou_manuel": True}).status_code == 200
    # Verrouillée depuis : rien à rétablir → 409, à chaque essai, et rien ne change
    for _ in range(2):
        a = _post(base, f"/api/tarifs/historique/annuler-lot/{lot}")
        assert a.status_code == 409 and "Retirez le verrou" in a.json()["detail"], a.text
        assert "1 ligne verrouillée" in a.json()["detail"]
        assert _proposition(base, pid)["statut"] == "acceptee"
        assert _tarif(base, tid)["prix_fournisseur_ht"] == Decimal("30.00") and _lot_annule(base, lot) is False
    # Verrou retiré : l'annulation rétablit 13,00 € HT et rouvre la proposition, une seule fois
    assert base["c"].patch(f"/api/tarifs/{tid}/verrou", headers=_h_admin(), json={"verrou_manuel": False}).status_code == 200
    a = _post(base, f"/api/tarifs/historique/annuler-lot/{lot}")
    assert a.status_code == 200, a.text
    assert (a.json()["restaures"], a.json()["conflits"], a.json()["propositions_rouvertes"]) == (2, [], 1)
    t = _tarif(base, tid)
    assert (t["prix_fournisseur_ht"], t["prix_client"]) == (avant["prix_fournisseur_ht"], avant["prix_client"])
    p = _proposition(base, pid)
    assert (p["statut"], p["traite_le"], p["traite_par"]) == ("en_attente", None, None)
    assert _lot_annule(base, lot) is True
    assert _post(base, f"/api/tarifs/historique/annuler-lot/{lot}").status_code == 409


def test_reel_cadenas_lot_entierement_cadenasse_annulation_refusee_puis_unique(base):
    _prod(base)
    i13 = _grille(base, "tarifs_reparation", "modele = 'iPhone 13'")[0]
    charge = {"cible": "tarifs_reparation", "filtre": {"ids": [i13["id"]], "colonne": "batterie"},
              "ajustement": {"type": "eur", "valeur": 10}}
    res = _post(base, "/api/tarifs/appliquer", json={**charge, "confirmer": True}).json()
    assert res["modifies"] == 1
    apres_lot = _ligne(base, "tarifs_reparation", i13["id"])
    _cadenasser(base, tarifs_reparation=[i13["id"]])
    n = _n_historique(base)
    for _ in range(2):
        a = _post(base, f"/api/tarifs/historique/annuler-lot/{res['lot_id']}")
        assert a.status_code == 409 and "Retirez le verrou" in a.json()["detail"], a.text
        assert _ligne(base, "tarifs_reparation", i13["id"]) == apres_lot
        assert _n_historique(base) == n and _lot_annule(base, res["lot_id"]) is False
    _cadenasser(base, tarifs_reparation=[])
    a = _post(base, f"/api/tarifs/historique/annuler-lot/{res['lot_id']}")
    assert a.status_code == 200 and a.json()["restaures"] == 1, a.text
    retablie = _ligne(base, "tarifs_reparation", i13["id"])
    assert (retablie["batterie"], retablie["prix_maj_le"]) == (i13["batterie"], i13["prix_maj_le"])
    assert _lot_annule(base, res["lot_id"]) is True
    a = _post(base, f"/api/tarifs/historique/annuler-lot/{res['lot_id']}")
    assert a.status_code == 409 and a.json()["detail"] == "Ce lot a déjà été annulé"


def test_reel_annulation_acceptation_sans_ecriture_rouvre_la_proposition(base):
    _prod(base)
    tid = _id(base, "Oppo", "Reno 10", "Batterie")
    pid = _proposer(base, tid, "12,50")
    # Le prix a rejoint la proposition avant son acceptation : rien à écrire, lot vide
    _sql(base, "UPDATE tarifs SET prix_fournisseur_ht = 12.50, prix_client = %s WHERE id = %s",
         prix.prix_client(Decimal("12.50"), "Batterie", "standard", prix.REGLES_DEFAUT), tid)
    r = _post(base, f"/api/tarifs/propositions/{pid}/accepter").json()
    assert r["resultat"] == "acceptee" and r["ecrit"] is False
    a = _post(base, f"/api/tarifs/historique/annuler-lot/{r['lot_id']}")
    assert a.status_code == 200, a.text
    assert a.json()["propositions_rouvertes"] == 1 and a.json()["restaures"] == 0
    assert _proposition(base, pid)["statut"] == "en_attente"
    assert _post(base, f"/api/tarifs/historique/annuler-lot/{r['lot_id']}").status_code == 409
    assert _post(base, "/api/tarifs/historique/annuler-lot/lot-inconnu-pytest").status_code == 404


def test_reel_annulation_lot_de_plusieurs_propositions(base):
    _prod(base)
    t1, t2 = _id(base, "Oppo", "Reno 10", "Batterie"), _id(base, "Apple", "iPhone 13", "Batterie")
    avant = {t: _tarif(base, t) for t in (t1, t2)}
    p1, p2 = _proposer(base, t1, "12,50", 1), _proposer(base, t2, "15,00", 2)
    res = _post(base, "/api/tarifs/propositions/accepter", json={"ids": [p1, p2]}).json()
    assert sorted(res["acceptees"]) == sorted([p1, p2])
    # Le coût de la deuxième pièce est modifié depuis : sa proposition passe 'annulee', l'autre est rouverte
    _sql(base, "UPDATE tarifs SET prix_fournisseur_ht = 16 WHERE id = %s", t2)
    a = _post(base, f"/api/tarifs/historique/annuler-lot/{res['lot_id']}").json()
    assert (a["propositions_rouvertes"], a["propositions_annulees"]) == (1, 1) and a["conflits"] == [f"tarifs:{t2}"]
    assert (_proposition(base, p1)["statut"], _proposition(base, p2)["statut"]) == ("en_attente", "annulee")
    p = _proposition(base, p2)
    assert p["traite_par"] == ADMIN and p["traite_le"] is not None
    listees = base["c"].get("/api/tarifs/propositions", params={"statut": "annulee"}, headers=_h_admin()).json()
    assert [x["id"] for x in listees] == [p2] and listees[0]["statut"] == "annulee"
    assert _post(base, f"/api/tarifs/historique/annuler-lot/{res['lot_id']}").status_code == 409
    t = _tarif(base, t1)
    assert (t["prix_fournisseur_ht"], t["prix_client"], t["prix_maj_le"], t["prix_source"]) == tuple(
        avant[t1][k] for k in ("prix_fournisseur_ht", "prix_client", "prix_maj_le", "prix_source"))
    assert not _sql(base, "SELECT 1 FROM tarifs_propositions WHERE statut = 'acceptee'")


# ═══ Fraîcheur : la santé et la liste comptent pareil ═════════

def test_reel_fraicheur_liste_et_sante_coherentes_aux_seuils(base):
    _prod(base)
    a25, a54 = _id(base, "Samsung", "Galaxy A25", "Ecran", "Original"), _id(base, "Samsung", "Galaxy A54", "Ecran", "Original")
    s21 = _id(base, "Samsung", "Galaxy S21 Ultra", "Batterie")
    # Copie de prod : tous les prix datent du 15/02/2026 (périmés) ; trois prix datés aux seuils
    _sql(base, "UPDATE tarifs SET prix_maj_le = NOW() - interval '90 days 12 hours' WHERE id = %s", a25)
    _sql(base, "UPDATE tarifs SET prix_maj_le = NOW() - interval '89 days 23 hours' WHERE id = %s", a54)
    _sql(base, "UPDATE tarifs SET prix_maj_le = NOW() - interval '180 days 2 hours' WHERE id = %s", s21)
    lignes = {t["id"]: t for t in base["c"].get("/api/tarifs", headers=_h_admin()).json()}
    assert (lignes[a25]["age_jours"], lignes[a25]["fraicheur"]) == (90, "a_revoir")
    assert (lignes[a54]["age_jours"], lignes[a54]["fraicheur"]) == (89, "ok")
    assert (lignes[s21]["age_jours"], lignes[s21]["fraicheur"]) == (180, "perime")
    assert all("age_secondes" not in t for t in lignes.values())
    apple = base["c"].get("/api/tarifs/apple-devices", headers=_h_admin()).json()
    sante = base["c"].get("/api/tarifs/sante", headers=_h_admin()).json()
    for niveau, cle in (("a_revoir", "a_revoir"), ("perime", "perimes")):
        n = sum(1 for t in list(lignes.values()) + apple if t["fraicheur"] == niveau)
        assert sante[cle] == n, (niveau, sante[cle], n)
    assert sante["a_revoir"] == 1
    # Fiche d'une pièce (PATCH prix) : même calcul
    _sql(base, "UPDATE tarifs SET prix_maj_le = NOW() - interval '90 days 12 hours' WHERE id = %s", a54)
    r = base["c"].patch(f"/api/tarifs/{a54}/prix", headers=_h_admin(), json={"prix_fournisseur_ht": 65})
    assert r.status_code == 200 and "age_secondes" not in r.json(), r.text      # 65 € déjà : rien d'écrit
    assert (r.json()["age_jours"], r.json()["fraicheur"]) == (90, "a_revoir")
    r = base["c"].patch(f"/api/tarifs/{a54}/prix", headers=_h_admin(), json={"prix_fournisseur_ht": 66})
    assert (r.json()["age_jours"], r.json()["fraicheur"]) == (0, "ok"), r.text
