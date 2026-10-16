"""Atelier (lot 5) : priorité atelier et file triée, grille tarifaire branchée sur les
lignes du ticket (/api/grille/suggestions), conversion devis → ticket complète.

Les tests purs et sur base simulée tournent toujours. Ceux sur base réelle exigent la
même base PostgreSQL JETABLE que tests/test_fiche.py (KP_FICHE_DATABASE_URL).
"""

import json
from contextlib import contextmanager
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from app.api import grille, tickets as tickets_api
from app.api.auth import create_admin_token, create_token
from app.api.devis import _calc_totals, _lignes_ticket
from app.models import TicketCreate, TicketUpdate
from tests.test_fiche import H, _sql, _ticket, reel  # noqa: F401 (fixture)

TECH = "TechLot5"
MARQUEUR = "pytest-lot5"


def _cursor(fetchone=None, fetchall=None):
    cur = MagicMock()
    cur.fetchone.return_value = fetchone
    cur.fetchall.return_value = fetchall or []

    @contextmanager
    def cm():
        yield cur
    return cur, cm


# ─── Priorité : validation ─────────────────────────────────────

@pytest.mark.parametrize("entree, attendu", [
    ("express", "express"), (" Attente ", "attente"), ("PRO", "pro"), (None, "normal"), ("normal", "normal"),
])
def test_priorite_valeurs(entree, attendu):
    assert TicketUpdate(priorite=entree).priorite == attendu
    assert TicketCreate(client_id=1, categorie="Smartphone", marque="Apple", panne="Batterie",
                        priorite=entree).priorite == attendu


def test_priorite_absente_du_patch_non_ecrite():
    assert "priorite" not in TicketUpdate(notes_internes="x").model_dump(exclude_unset=True)
    assert TicketCreate(client_id=1, categorie="Smartphone", marque="Apple", panne="Batterie").priorite == "normal"


@pytest.mark.parametrize("valeur", ["urgent", "attente_sur_place", "", 3])
def test_priorite_invalide(valeur):
    with pytest.raises(ValidationError):
        TicketUpdate(priorite=valeur)


def test_patch_priorite_invalide_422(client, auth_headers):
    cur, cm = _cursor()
    with patch("app.api.tickets.get_cursor", cm):
        r = client.patch("/api/tickets/1", json={"priorite": "vip"}, headers=auth_headers)
    assert r.status_code == 422 and cur.execute.call_count == 0


@pytest.mark.parametrize("staff, priorite, source, attendu", [
    (False, "express", None, "normal"),
    (False, "pro", "boutique", "normal"),
    # Borne du magasin : « Je patiente en boutique » est retenu sans session staff
    (False, "attente", None, "attente"),
    (False, "attente", "boutique", "attente"),
    (False, "attente", "distance", "normal"),
    (True, "express", None, "express"),
    (True, "pro", "distance", "pro"),
])
def test_priorite_a_la_creation(client, auth_headers, staff, priorite, source, attendu):
    corps = {"client_id": 1, "categorie": "Smartphone", "marque": "Apple", "panne": "Batterie", "priorite": priorite}
    if source:
        corps["source"] = source
    cur, cm = _cursor(fetchone={"id": 41})
    with patch("app.api.tickets.get_cursor", cm), patch("app.api.public_documents.jeton_suivi"):
        r = client.post("/api/tickets", json=corps, headers=auth_headers if staff else {})
    assert r.status_code == 200
    insert_sql, insert_params = cur.execute.call_args_list[0].args
    assert "priorite" in insert_sql and insert_params[-1] == attendu


def test_file_atelier_sql(client, auth_headers):
    cur, cm = _cursor(fetchall=[])
    with patch("app.api.tickets.get_cursor", cm):
        assert client.get("/api/tickets/queue/repair", headers=auth_headers).status_code == 200
    sql = cur.execute.call_args.args[0]
    ordre = sql.split("ORDER BY", 1)[1]
    assert ordre.index("t.priorite") < ordre.index("date_recuperation") < ordre.index("t.statut") < ordre.index("t.date_depot")
    assert "t.priorite," in sql.split("FROM", 1)[0]
    # Texte libre : jamais casté
    assert "date_recuperation::" not in sql and "%" not in sql.replace("%s", "")


def test_dashboard_porte_le_drapeau_reception(client, auth_headers):
    tickets_api._reception_absente_le = 0.0
    cur, cm = _cursor(fetchall=[])
    with patch("app.api.tickets.get_cursor", cm):
        assert client.get("/api/tickets/stats/dashboard", headers=auth_headers).status_code == 200
    assert "AS reception_complete" in cur.execute.call_args_list[1].args[0]
    assert "ticket_controles" in cur.execute.call_args_list[1].args[0]


# ─── Grille : correspondance de modèle ─────────────────────────

@pytest.mark.parametrize("ticket, ligne, score", [
    (("iPhone 13", "Apple"), ("iPhone 13", "Apple"), 2),
    (("iPhone 13", "Apple"), ("iPhone 13 Pro", "Apple"), 0),          # jamais par sous-chaîne
    (("iPhone 13 Pro", "Apple"), ("iPhone 13", "Apple"), 0),
    (("13 Pro", "iPhone"), ("iPhone 13 Pro", "Apple"), 2),             # marque saisie = gamme
    (("iPhone 8 Plus", "Apple"), ("iPhone 7/8/7+/8+", "Apple"), 2),    # nom groupé déplié, + = Plus
    (("iPhone 11", "Apple"), ("iPhone XR/11", "Apple"), 2),
    (("iPhone 12 Pro", "Apple"), ("iPhone 12/12 Pro", "Apple"), 2),
    (("iPhone 12 Pro Max", "Apple"), ("iPhone 12/12 Pro", "Apple"), 0),
    (("iPhone SE 2022", "Apple"), ("iPhone SE 20/22", "Apple"), 2),
    (("iPhone SE (2e génération)", "Apple"), ("iPhone SE 20/22", "Apple"), 2),
    (("iPhone SE 2022", "Apple"), ("iPhone 5/5S/5C/SE", "Apple"), 0),   # le SE de 2016 n'a pas le même prix
    (("iPhone SE", "Apple"), ("iPhone 5/5S/5C/SE", "Apple"), 2),
    (("Galaxy S21", "Samsung"), ("Galaxy S21 (G991B)", "Samsung"), 2),  # référence entre parenthèses
    (("Samsung Galaxy S21", "Samsung"), ("Galaxy S21", "Samsung"), 2),
    (("S21", "Samsung"), ("Galaxy S21", "Samsung"), 2),                 # « Galaxy » facultatif
    (("Galaxy S21+", "Samsung"), ("Galaxy S21 Plus", "Samsung"), 2),
    (("Galaxy S21", "Samsung"), ("Galaxy S21+", "Samsung"), 0),
    (("Galaxy S21+", "Samsung"), ("Galaxy S21+ 5G", "Samsung"), 1),     # second niveau : réseau ignoré
    (("iPad 9", "Apple"), ("iPad 9 (2021)", "Apple"), 1),               # second niveau : année ignorée
    (("Note 12", "Redmi"), ("Redmi Note 12", "Xiaomi"), 2),
    (("Redmi Note 12", "Xiaomi"), ("Redmi Note 12 Pro", "Xiaomi"), 0),
])
def test_correspondance_modele(ticket, ligne, score):
    cle = grille.cle_modele(*ticket)
    assert grille._score(cle, grille.cle_souple(cle), *ligne) == score


def test_marque_devinee_et_alias():
    assert grille.marque_canonique("Autre") == "" and grille.marque_canonique("iPhone") == "apple"
    assert grille.deviner_marque("Samsung Galaxy S24") == "samsung"
    assert grille.deviner_marque("Galaxy S24") == "galaxy" and grille.marque_canonique("galaxy") == "samsung"
    assert grille.deviner_marque("Téléphone inconnu") == ""


def test_prefiltre_sans_mots_transformes():
    assert grille._motifs_prefiltre(grille.cle_modele("iPhone SE 2022", "Apple")) == ["%se%"]
    assert grille._motifs_prefiltre(grille.cle_modele("Galaxy S21+ 5G", "Samsung")) == ["%s21%"]


def test_suggestions_auth_requise(client):
    assert client.get("/api/grille/suggestions", params={"modele": "iPhone 13"}).status_code == 401


# ─── Conversion devis → ticket : lignes TTC ────────────────────

def test_lignes_devis_en_ttc():
    devis = {"tva": Decimal("20"), "remise": Decimal("0"), "total_ttc": Decimal("144.00")}
    lignes, reduction = _lignes_ticket([
        {"description": "Écran  OLED", "quantite": 1, "prix_unitaire": Decimal("100"), "total": Decimal("100")},
        {"description": "Protection", "quantite": 2, "prix_unitaire": Decimal("10"), "total": None},
        {"description": "  ", "quantite": 1, "prix_unitaire": 5, "total": 5},
    ], devis)
    assert lignes == [{"label": "Écran OLED", "prix": 120.0, "source": "devis"},
                      {"label": "Protection (x2)", "prix": 24.0, "source": "devis"}]
    assert reduction == 0


def test_lignes_devis_remise_et_arrondi():
    # Remise HT de 10 € → réduction TTC du ticket : lignes - réduction = total du devis
    lignes, reduction = _lignes_ticket(
        [{"description": "Batterie", "quantite": 1, "prix_unitaire": 50, "total": 50}],
        {"tva": 20, "remise": 10, "total_ttc": Decimal("48.00")})
    assert lignes[0]["prix"] == 60.0 and reduction == 12.0
    # Sans remise : l'écart d'arrondi va sur la dernière ligne
    lignes, reduction = _lignes_ticket(
        [{"description": f"L{i}", "quantite": 1, "prix_unitaire": Decimal("0.04"), "total": Decimal("0.04")}
         for i in range(3)],
        {"tva": 20, "remise": 0, "total_ttc": Decimal("0.14")})
    assert sum(l["prix"] for l in lignes) == pytest.approx(0.14) and reduction == 0
    assert _lignes_ticket([], {"tva": 20, "total_ttc": 0}) == ([], 0)


def test_totaux_devis_tva_zero():
    lignes = [{"quantite": 2, "prix_unitaire": 50}]
    # Franchise de TVA : 0 % est un taux, pas une absence de taux
    assert _calc_totals(lignes, 0, 0) == (100, 100)
    assert _calc_totals(lignes, Decimal("0"), 10) == (90, 90)
    assert _calc_totals(lignes, None, 0) == (100, 120)
    assert _calc_totals(lignes, 5.5, 0) == (100, 105.5)
    ttc = _calc_totals(lignes, 0, 0)[1]
    lignes_ticket, reduction = _lignes_ticket(
        [{"description": "Écran", "quantite": 2, "prix_unitaire": 50, "total": 100}],
        {"tva": 0, "remise": 0, "total_ttc": ttc})
    assert lignes_ticket[0]["prix"] == 100.0 and reduction == 0


# ─── Schéma incomplet au démarrage : nouveaux essais en fond ───

def _relance(monkeypatch, resultats):
    from app import main
    appels = []
    suite = iter(resultats)
    monkeypatch.setattr(main, "appliquer_schema", lambda: appels.append("ddl") or next(suite))
    monkeypatch.setattr(main, "_ecrire_version", lambda e: appels.append(("version", e)))
    for nom in ("_donnees_de_demarrage", "_migrations_recherche", "_migrations_fiche"):
        monkeypatch.setattr(main, nom, lambda nom=nom: appels.append(nom))
    monkeypatch.setattr(tickets_api, "_reception_absente_le", 123.0)
    return main, appels


def test_relance_schema_apres_echec(monkeypatch):
    import threading
    main, appels = _relance(monkeypatch, [False, True])
    assert main._relancer_schema("abc", threading.Event(), delais=(0, 0, 0)) is True
    assert appels == ["ddl", "ddl", ("version", "abc"),
                      "_donnees_de_demarrage", "_migrations_recherche", "_migrations_fiche"]
    assert tickets_api._reception_absente_le == 0.0


def test_relance_schema_abandon_et_arret(monkeypatch):
    import threading
    main, appels = _relance(monkeypatch, [False, False, False])
    assert main._relancer_schema("abc", threading.Event(), delais=(0, 0, 0)) is False
    assert appels == ["ddl", "ddl", "ddl"]
    arret = threading.Event()
    arret.set()
    appels.clear()
    assert main._relancer_schema("abc", arret, delais=(0,)) is False and appels == []


def test_lifespan_schema_incomplet_lance_la_relance(monkeypatch):
    import asyncio
    import threading
    from app import main
    recu = {}
    lance = threading.Event()
    monkeypatch.setattr(main, "_etat_initial", lambda: None)
    monkeypatch.setattr(main, "appliquer_schema", lambda: False)
    monkeypatch.setattr(main, "_ecrire_version", lambda e: pytest.fail("empreinte écrite"))
    for nom in ("_donnees_de_demarrage", "_migrations_recherche", "_migrations_fiche", "seed_catalog",
                "_prechauffer_pool"):
        monkeypatch.setattr(main, nom, lambda: None)
    monkeypatch.setattr(main.iphones_stock, "lancer_init_differee", lambda: None)
    for mod, drapeau in main._DRAPEAUX_SCHEMA:
        monkeypatch.setattr(mod, drapeau, getattr(mod, drapeau))
    monkeypatch.setattr(main, "_relancer_schema",
                        lambda empreinte, arret: recu.update(empreinte=empreinte, arret=arret) or lance.set())

    async def run():
        async with main.app.router.lifespan_context(main.app):
            assert lance.wait(2) and not recu["arret"].is_set()

    asyncio.run(run())
    assert recu["empreinte"] == main.schema_empreinte()
    assert recu["arret"].is_set()   # arrêt de l'application : la relance s'arrête


# ═══ Base réelle ═══════════════════════════════════════════════

def _queue(c):
    r = c.get("/api/tickets/queue/repair", params={"tech": TECH, "limit": 50}, headers=H)
    assert r.status_code == 200
    return r.json()


def test_file_atelier_triee(reel):
    _sql(reel, "DELETE FROM tickets WHERE technicien_assigne = %s", TECH)
    t = lambda nom, **kw: (nom, _ticket(reel, technicien_assigne=TECH, panne=nom, **kw))  # noqa: E731
    ids = dict([
        t("normal_en_cours", statut="En cours de réparation", date_depot="2026-10-01 09:00"),
        t("normal_promis_17", statut="En attente de diagnostic", date_recuperation="2026-10-17T10:00"),
        t("express", statut="En attente de diagnostic", priorite="express"),
        t("sur_place", statut="En attente de pièce", priorite="attente", date_depot="2026-10-16 11:00"),
        t("pro", statut="En attente de diagnostic", priorite="pro", date_recuperation="2026-10-16 18:00"),
        t("normal_promis_16_9h", statut="Pièce reçue", date_recuperation="2026-10-16T09:00"),
        t("normal_promis_16_8h30", statut="En attente de diagnostic", date_recuperation="2026-10-16 08:30"),
        t("normal_texte_libre", statut="En attente de diagnostic", date_recuperation="demain matin",
          date_depot="2026-10-02 09:00"),
        t("normal_piece", statut="En attente de pièce", date_depot="2026-09-01 09:00"),
        t("termine", statut="Réparation terminée", priorite="attente"),
    ])
    file = _queue(reel["c"])
    assert [r["panne"] for r in file] == [
        "sur_place", "express", "pro",
        "normal_promis_16_8h30", "normal_promis_16_9h", "normal_promis_17",
        "normal_en_cours", "normal_texte_libre", "normal_piece",
    ]
    assert file[0]["priorite"] == "attente" and file[-1]["priorite"] == "normal"
    assert ids["termine"] not in {r["id"] for r in file}


def test_patch_priorite_et_dashboard(reel):
    c = reel["c"]
    tid = _ticket(reel, statut="En attente de diagnostic", technicien_assigne=TECH)
    assert _sql(reel, "SELECT priorite FROM tickets WHERE id = %s", tid)[0]["priorite"] == "normal"

    r = c.patch(f"/api/tickets/{tid}", json={"priorite": "express"}, headers=H)
    assert r.status_code == 200
    t = r.json()["ticket"]
    assert t["priorite"] == "express" and "Priorité : Normal → Express — par Sophie" in t["historique"]
    hist = _sql(reel, "SELECT count(*) AS n FROM historique WHERE ticket_id = %s", tid)[0]["n"]
    # Même valeur (auto-save) : rien n'est historisé
    assert c.patch(f"/api/tickets/{tid}", json={"priorite": "express", "notes_internes": "x"}, headers=H).status_code == 200
    assert _sql(reel, "SELECT count(*) AS n FROM historique WHERE ticket_id = %s", tid)[0]["n"] == hist
    assert c.patch(f"/api/tickets/{tid}", json={"priorite": "vip"}, headers=H).status_code == 422
    assert c.patch(f"/api/tickets/{tid}", json={"priorite": None}, headers=H).json()["ticket"]["priorite"] == "normal"

    assert c.get(f"/api/tickets/{tid}", headers=H).json()["priorite"] == "normal"
    assert "priorite" in c.get("/api/tickets", params={"limit": 5}, headers=H).json()[0]

    tickets_api._reception_absente_le = 0.0
    table = _sql(reel, "SELECT to_regclass('public.ticket_controles') IS NOT NULL AS ok")[0]["ok"]
    if table:
        _sql(reel, """INSERT INTO ticket_controles (ticket_id, phase, items, complete, auteur)
                      VALUES (%s, 'entree', '{}'::jsonb, TRUE, 'Sophie')
                      ON CONFLICT (ticket_id, phase) DO UPDATE SET complete = TRUE""", tid)
    rows = {r["id"]: r for r in c.get("/api/tickets/stats/dashboard", params={"tech": TECH}, headers=H).json()["tickets"]}
    assert rows[tid]["priorite"] == "normal" and rows[tid]["reception_complete"] is bool(table)
    assert all(r["reception_complete"] is False for i, r in rows.items() if i != tid)


def test_dashboard_sans_table_de_reception(reel):
    c = reel["c"]
    table = _sql(reel, "SELECT to_regclass('public.ticket_controles') IS NOT NULL AS ok")[0]["ok"]
    if table:
        _sql(reel, "ALTER TABLE ticket_controles RENAME TO ticket_controles_pytest")
    try:
        tickets_api._reception_absente_le = 0.0
        r = c.get("/api/tickets/stats/dashboard", params={"tech": TECH}, headers=H)
        assert r.status_code == 200 and r.json()["tickets"]
        assert all(t["reception_complete"] is False for t in r.json()["tickets"])
        assert tickets_api._reception_absente_le > 0
    finally:
        tickets_api._reception_absente_le = 0.0
        if table:
            _sql(reel, "ALTER TABLE ticket_controles_pytest RENAME TO ticket_controles")


# ─── Grille sur base réelle ────────────────────────────────────

@pytest.fixture(scope="module")
def grille_fictive(reel):
    _sql(reel, "DELETE FROM tarifs WHERE nom_fournisseur = %s", MARQUEUR)
    _sql(reel, "DELETE FROM tarifs_apple_devices WHERE modele LIKE %s", "% pytest")
    _sql(reel, "DELETE FROM smartphones_tarifs WHERE slug LIKE %s", MARQUEUR + "%")
    lignes = [
        ("Apple", "iPhone 13", "Ecran", "Original", 150, 289, True),
        ("Apple", "iPhone 13", "Ecran", "Soft OLED", 60, 159, False),
        ("Apple", "iPhone 13", "Batterie", None, 20, 89, True),
        ("Apple", "iPhone 13", "Camera arriere", None, 30, 99, None),
        ("Apple", "iPhone 13 Pro", "Ecran", "Original", 200, 349, True),
        ("Apple", "iPhone 13 Pro", "Batterie", None, 22, 89, True),
        ("Samsung", "Galaxy S21 (G991B)", "Ecran", "Original", 120, 249, True),
        ("Samsung", "Galaxy S21+ 5G", "Ecran", "Original", 140, 269, True),
        ("Samsung", "Galaxy S21+ 5G", "Batterie", None, 18, 79, True),
        ("Xiaomi", "Redmi Note 12", "Connecteur de charge", None, 8, 69, True),
    ]
    ids = {}
    for marque, modele, piece, qualite, ht, prix, stock in lignes:
        r = _sql(reel, """INSERT INTO tarifs (marque, modele, type_piece, qualite, nom_fournisseur,
                                             prix_fournisseur_ht, prix_client, en_stock)
                          VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                 marque, modele, piece, qualite, MARQUEUR, ht, prix, stock)
        ids[(modele, piece, qualite)] = f"tarifs:{r[0]['id']}"
    _sql(reel, """INSERT INTO tarifs_apple_devices (categorie, modele, ecran_prix_ht, batterie_prix_ht,
                                                    ecran_prix_vente, batterie_prix_vente)
                  VALUES ('ipad', 'iPad 9 (2021) pytest', 70, 25, 199, 129)""")
    _sql(reel, """INSERT INTO smartphones_tarifs (slug, marque, modele, ordre, stockage_1, prix_1, stock_1, condition)
                  VALUES (%s, 'Samsung', 'Galaxy S21', 999, '128 Go', 399, 2, 'Reconditionné Premium')""",
         MARQUEUR + "-s21")
    grille.cle_modele.cache_clear()
    grille._cles_ligne.cache_clear()
    yield ids
    _sql(reel, "DELETE FROM tarifs WHERE nom_fournisseur = %s", MARQUEUR)
    _sql(reel, "DELETE FROM tarifs_apple_devices WHERE modele LIKE %s", "% pytest")
    _sql(reel, "DELETE FROM smartphones_tarifs WHERE slug LIKE %s", MARQUEUR + "%")


def _suggest(reel, headers=H, **params):
    r = reel["c"].get("/api/grille/suggestions", params=params, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_suggestions_iphone_13(reel, grille_fictive):
    body = _suggest(reel, marque="Apple", modele="iPhone 13", categorie="Smartphone")
    s = body["suggestions"]
    assert body["modele_trouve"] is True
    assert {x["modele"] for x in s} == {"iPhone 13"}          # ni 13 Pro ni 13 mini
    assert grille_fictive[("iPhone 13 Pro", "Ecran", "Original")] not in {x["id"] for x in s}
    assert set(s[0]) == {"source", "id", "label", "type_piece", "qualite", "prix", "stock", "cout_ht", "modele"}
    assert all(x["cout_ht"] is None for x in s)                # pas admin

    grille_iphone = _sql(reel, "SELECT id, ecran_generique, batterie FROM tarifs_reparation WHERE modele = 'iPhone 13'")
    if grille_iphone:
        g = grille_iphone[0]
        assert {"id": f"tarifs_reparation:{g['id']}:ecran_generique", "prix": float(g["ecran_generique"]),
                "label": "Forfait remplacement écran (Générique)", "source": "tarifs_reparation"}.items() \
            <= next(x for x in s if x["id"].endswith(":ecran_generique")).items()
    original = next(x for x in s if x["id"] == grille_fictive[("iPhone 13", "Ecran", "Original")])
    assert original == {"source": "tarifs", "id": original["id"], "label": "Forfait remplacement écran (Original)",
                        "type_piece": "Ecran", "qualite": "Original", "prix": 289.0, "stock": "En stock",
                        "cout_ht": None, "modele": "iPhone 13"}
    assert next(x for x in s if x["id"] == grille_fictive[("iPhone 13", "Ecran", "Soft OLED")])["stock"] == "Rupture"
    # Écrans d'abord, puis batterie, caméra… ; par type : grille de la boutique puis
    # pièces fournisseur, chacune par prix croissant
    types = [grille.P.cle_panne(x["type_piece"]) for x in s]
    assert types == sorted(types, key=lambda k: grille._RANG_TYPE.get(k, 20))
    ecrans = [(grille._RANG_SOURCE[x["source"]], x["prix"]) for x, k in zip(s, types) if k == "ecran"]
    assert ecrans == sorted(ecrans) and ecrans[-1] == (1, 289.0)

    batterie = _suggest(reel, marque="Apple", modele="iPhone 13", q="batt")["suggestions"]
    assert batterie and all(x["type_piece"] == "Batterie" for x in batterie)
    assert len(_suggest(reel, marque="Apple", modele="iPhone 13", limit=2)["suggestions"]) == 2


def test_suggestions_cout_ht_admin(reel, grille_fictive):
    _sql(reel, "DELETE FROM membres_equipe WHERE nom = 'GrilleAdmin'")
    _sql(reel, "INSERT INTO membres_equipe (nom, role) VALUES ('GrilleAdmin', 'admin')")
    user = {"sub": "GrilleAdmin", "target": "accueil"}
    headers = {"Authorization": f"Bearer {create_token('accueil', 'GrilleAdmin')}",
               "X-Admin-Token": create_admin_token(user)}
    s = _suggest(reel, headers=headers, marque="Apple", modele="iPhone 13")["suggestions"]
    original = next(x for x in s if x["id"] == grille_fictive[("iPhone 13", "Ecran", "Original")])
    assert original["cout_ht"] == 150.0
    assert all(x["cout_ht"] is None for x in s if x["source"] == "tarifs_reparation")
    # Membre admin sans élévation ni preuve sur ce poste : coût masqué
    sans = {"Authorization": f"Bearer {create_token('accueil', 'GrilleAdmin')}"}
    assert all(x["cout_ht"] is None for x in _suggest(reel, headers=sans, marque="Apple", modele="iPhone 13")["suggestions"])


def test_suggestions_samsung_et_vente(reel, grille_fictive):
    s21 = _suggest(reel, marque="Samsung", modele="Galaxy S21")
    assert s21["modele_trouve"] is True
    reparations = [x for x in s21["suggestions"] if x["source"] != "smartphones_tarifs"]
    assert [x["id"] for x in reparations] == [grille_fictive[("Galaxy S21 (G991B)", "Ecran", "Original")]]
    vente = [x for x in s21["suggestions"] if x["source"] == "smartphones_tarifs"]
    assert vente and vente[0]["type_piece"] == "Téléphone (vente)" and vente[0]["stock"] == "2 en stock"
    assert vente[0]["label"] == "Galaxy S21 128 Go — Reconditionné Premium"
    assert s21["suggestions"].index(vente[0]) > s21["suggestions"].index(reparations[-1])

    # Marque « Autre », modèle libre : marque devinée, S21+ trouvé au second niveau (5G ignoré)
    plus = _suggest(reel, marque="Autre", modele="Samsung Galaxy S21+")
    assert plus["modele_trouve"] is True
    assert {x["modele"] for x in plus["suggestions"]} == {"Galaxy S21+ 5G"}

    redmi = _suggest(reel, marque="Redmi", modele="Note 12")["suggestions"]
    assert [x["label"] for x in redmi] == ["Forfait remplacement connecteur de charge"]


def test_suggestions_groupes_ipad_et_categorie(reel, grille_fictive):
    if _sql(reel, "SELECT 1 FROM tarifs_reparation WHERE modele = 'iPhone 7/8/7+/8+'"):
        s = _suggest(reel, marque="Apple", modele="iPhone 8 Plus")
        assert s["modele_trouve"] is True and {x["modele"] for x in s["suggestions"]} == {"iPhone 7/8/7+/8+"}

    ipad = _suggest(reel, marque="Apple", modele="iPad 9 pytest", categorie="Tablette")
    assert ipad["modele_trouve"] is True
    assert [(x["type_piece"], x["prix"]) for x in ipad["suggestions"]] == [("Écran", 199.0), ("Batterie", 129.0)]
    # Une tablette ne reçoit jamais la grille iPhone
    tab = _suggest(reel, marque="Apple", q="13", categorie="Tablette")["suggestions"]
    assert all(x["source"] != "tarifs_reparation" for x in tab)


def test_suggestions_modele_introuvable(reel, grille_fictive):
    vide = _suggest(reel, marque="Apple", modele="iPhone 99")
    assert vide == {"modele_trouve": False, "suggestions": []}
    libre = _suggest(reel, marque="Apple", modele="iPhone 99", q="13 pro ecran")
    assert libre["modele_trouve"] is False and libre["suggestions"]
    assert all("13 pro" in grille.normaliser(x["modele"]) for x in libre["suggestions"])
    assert grille_fictive[("iPhone 13 Pro", "Ecran", "Original")] in {x["id"] for x in libre["suggestions"]}
    sans_rien = _suggest(reel, q="note 12 connecteur")
    assert [x["id"] for x in sans_rien["suggestions"]] == [grille_fictive[("Redmi Note 12", "Connecteur de charge", None)]]


def test_ligne_de_grille_conservee_sur_le_ticket(reel, grille_fictive):
    c = reel["c"]
    tid = _ticket(reel, statut="En cours de réparation")
    s = _suggest(reel, marque="Apple", modele="iPhone 13", q="original")["suggestions"][0]
    lignes = [{"label": s["label"], "prix": s["prix"], "source": s["source"], "tarif_id": s["id"],
               "qualite": s["qualite"]}, {"label": "Diagnostic", "prix": 0}]
    brut = json.dumps(lignes, ensure_ascii=False, separators=(",", ":"))
    r = c.patch(f"/api/tickets/{tid}", json={"reparation_supp": brut}, headers=H)
    assert r.status_code == 200
    t = r.json()["ticket"]
    assert t["reparation_supp"] == brut and json.loads(t["reparation_supp"])[0]["tarif_id"] == s["id"]
    assert t["montants"]["total"] == 289.0
    assert [l["label"] for l in t["montants"]["lignes"]] == ["Forfait remplacement écran (Original)", "Diagnostic"]


# ─── Conversion devis → ticket sur base réelle ─────────────────

def _devis(c, **kw):
    corps = {"client_nom": "Fictif", "client_prenom": "Devis", "client_tel": "0600000778", "tva": 20,
             "lignes": [{"description": "Écran OLED", "quantite": 1, "prix_unitaire": 100},
                        {"description": "Verre trempé", "quantite": 2, "prix_unitaire": 10}]}
    corps.update(kw)
    r = c.post("/api/devis", json=corps, headers=H)
    assert r.status_code == 200
    did = r.json()["id"]
    assert c.patch(f"/api/devis/{did}", json={"statut": "Accepté"}, headers=H).status_code == 200
    return did


def test_conversion_devis_ticket(reel):
    c = reel["c"]
    _sql(reel, "DELETE FROM devis WHERE client_tel = '0600000778'")
    if not _sql(reel, "SELECT 1 FROM catalog_modeles WHERE marque = 'Apple' AND modele = 'iPhone 13'"):
        _sql(reel, "INSERT INTO catalog_modeles (categorie, marque, modele) VALUES ('Smartphone', 'Apple', 'iPhone 13')")

    did = _devis(c, appareil="  Apple   iPhone 13 ")
    r = c.post(f"/api/devis/{did}/convert", headers=H)
    assert r.status_code == 200
    tid = r.json()["ticket_id"]
    t = c.get(f"/api/tickets/{tid}", headers=H).json()
    assert (t["categorie"], t["marque"], t["modele"], t["modele_autre"]) == ("Smartphone", "Apple", "iPhone 13", "")
    assert json.loads(t["reparation_supp"]) == [
        {"label": "Écran OLED", "prix": 120.0, "source": "devis"},
        {"label": "Verre trempé (x2)", "prix": 24.0, "source": "devis"},
    ]
    assert float(t["devis_estime"]) == 144.0 and t["montants"]["total"] == 144.0
    assert t["statut"] == "En attente de diagnostic" and t["priorite"] == "normal"
    assert t["suivi_token"]
    again = c.post(f"/api/devis/{did}/convert", headers=H).json()
    assert again["already_converted"] is True and again["ticket_id"] == tid

    did2 = _devis(c, appareil="Téléphone inconnu XZ-9", remise=10,
                  lignes=[{"description": "Batterie", "quantite": 1, "prix_unitaire": 50}])
    tid2 = c.post(f"/api/devis/{did2}/convert", headers=H).json()["ticket_id"]
    t2 = c.get(f"/api/tickets/{tid2}", headers=H).json()
    assert (t2["marque"], t2["modele"], t2["modele_autre"]) == ("Autre", "", "Téléphone inconnu XZ-9")
    total_devis = float(_sql(reel, "SELECT total_ttc FROM devis WHERE id = %s", did2)[0]["total_ttc"])
    assert float(t2["reduction_montant"]) == 12.0 and t2["montants"]["total"] == total_devis == 48.0

    did3 = _devis(c, appareil=None, lignes=[])
    t3 = c.get(f"/api/tickets/{c.post(f'/api/devis/{did3}/convert', headers=H).json()['ticket_id']}", headers=H).json()
    assert t3["reparation_supp"] is None and t3["marque"] is None

    # Franchise de TVA : le devis, ses lignes recopiées et le total du ticket restent en HT
    did4 = _devis(c, appareil="Apple iPhone 13", tva=0)
    d4 = _sql(reel, "SELECT total_ht, total_ttc FROM devis WHERE id = %s", did4)[0]
    assert float(d4["total_ht"]) == float(d4["total_ttc"]) == 120.0
    t4 = c.get(f"/api/tickets/{c.post(f'/api/devis/{did4}/convert', headers=H).json()['ticket_id']}", headers=H).json()
    assert [l["prix"] for l in json.loads(t4["reparation_supp"])] == [100.0, 20.0]
    assert float(t4["devis_estime"]) == t4["montants"]["total"] == 120.0


# ─── Schéma : verrou tenu par l'instance sortante (base réelle) ─

def test_schema_rejoue_apres_lock_timeout(reel):
    import threading
    import psycopg2
    from app import main
    from tests.test_fiche import DB_URL

    colonne = "SELECT 1 FROM information_schema.columns WHERE table_name = 'tickets' AND column_name = 'priorite'"
    tid = _ticket(reel, statut="En attente de diagnostic", technicien_assigne=TECH)
    _sql(reel, "ALTER TABLE tickets DROP COLUMN IF EXISTS priorite")
    sortante = psycopg2.connect(DB_URL)
    try:
        with sortante.cursor() as cur:   # ROW SHARE sur tickets : l'ALTER dépasse son lock_timeout
            cur.execute("SELECT id FROM tickets WHERE id = %s FOR UPDATE", (tid,))
        assert main.appliquer_schema() is False
        assert not _sql(reel, colonne)
    finally:
        sortante.rollback()
        sortante.close()
    try:
        empreinte = main.schema_empreinte()
        assert main._relancer_schema(empreinte, threading.Event(), delais=(0,)) is True
        assert _sql(reel, colonne)
        assert _sql(reel, "SELECT valeur FROM params WHERE cle = %s", main.SCHEMA_DDL_PARAM)[0]["valeur"] == empreinte
        assert all(getattr(mod, drapeau) for mod, drapeau in main._DRAPEAUX_SCHEMA)
        assert tid in {r["id"] for r in _queue(reel["c"])}
    finally:
        _sql(reel, "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS priorite TEXT NOT NULL DEFAULT 'normal'")
