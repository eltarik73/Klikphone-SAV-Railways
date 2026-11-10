"""Synchro Utopya du serveur par l'accès REST anonyme de Magento (services/utopya, api/fournisseurs).

Aucune requête réseau : les réponses `rest/V1/products-render-info` sont simulées (httpx.MockTransport)
d'après des produits réels relevés le 10/11/2026 ; la base par le curseur des tests Mobilax ;
`traiter` (import) est vérifié par ailleurs (tests/test_utopya_collecte.py) et simulé ici.
"""

from contextlib import contextmanager
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

import httpx
import pytest

from app.services import fournisseurs as F
from app.services import utopya as U
from tests.test_fournisseurs_mobilax import _Base, _sur
from tests.test_securite_c1 import _ADMIN_PROUVE, _headers, fake_db


def _produit(pid, nom, prix, vendable="1", url=None):
    return {"id": pid, "name": nom, "type": "simple", "is_salable": vendable,
            "url": url or f"https://www.utopya.fr/{nom.lower().replace(' ', '-')}.html",
            "price_info": {"final_price": prix, "regular_price": prix}}


# Relevés réels (10/11/2026) : écrans A54 d'origine (référence chiffrée), OLED et Incell compatibles, Pixel 6
A54_NOIR = _produit(79300, "Ecran Complet Noir Galaxy A54 5G (A546B)", 62.25,
                    url="https://www.utopya.fr/ecran-complet-noir-galaxy-a54-5g-a546b-134705.html")
A54_OLED = _produit(51792, "Ecran Complet Noir OLED Galaxy A54 5G (A546B) (Avec châssis)", 29.5)
A54_INCELL = _produit(81755, "Ecran Complet Incell Noir Galaxy A54 5G (A546B) (Avec Châssis)", 10.9)
PIXEL6 = _produit(36398, "Ecran Complet Google Pixel 6", 97, vendable="",
                  url="https://www.utopya.fr/ecran-complet-google-pixel-6.html")
PIXEL6_RELIFE = _produit(33447, "Ecran Complet Google Pixel 6 (ReLife)", 54.91)
OPPO_A54 = _produit(30576, "Ecran Complet Oppo A54/A74 5G", 8.65)
MOTO = _produit(90001, "Batterie Moto G54", 9.9)
COQUE = _produit(90002, "Coque Silicone Galaxy A54 5G", 2.5)
INCONNU = _produit(90003, "Ecran Complet Trucmuche X1", 5.0)
NUMERIQUES = [A54_NOIR, PIXEL6]


def _transport(pages, numeriques=(), journal=None, statut=None):
    """Réponses de l'accès : `pages` = listes de produits du catalogue (page 1, 2…), puis vide ;
    la recherche filtrée par référence renvoie `numeriques`. `statut` : (code, type, corps) forcé."""

    def repondre(req: httpx.Request):
        q = parse_qs(urlsplit(str(req.url)).query)
        if journal is not None:
            journal.append(q)
        if statut:
            code, ctype, corps = statut
            return httpx.Response(code, headers={"content-type": ctype}, content=corps.encode())
        numero = int(q["searchCriteria[currentPage]"][0])
        filtre = any("filter_groups" in k for k in q)
        source = [list(numeriques)] if filtre else pages
        items = source[numero - 1] if numero <= len(source) else []
        return httpx.Response(200, json={"items": items})

    return httpx.MockTransport(repondre)


def _client(transport):
    return U.ClientUtopya(transport=transport, dormir=lambda s: None)


# ─── Client : pagination, arrêt, erreurs ─────────────────────────

def test_tout_lit_les_pages_jusqu_a_la_fin_et_trie_par_identifiant():
    journal = []
    c = _client(_transport([[A54_NOIR, A54_OLED], [A54_INCELL, PIXEL6], [OPPO_A54]], journal=journal))
    r = c.tout(taille=2)
    assert [p["id"] for p in r["produits"]] == [79300, 51792, 81755, 36398, 30576]
    assert r["complet"] is True and r["pages"] == 3 and c.requetes == 3      # page incomplète : pas de 4e requête
    q = journal[0]
    assert q["searchCriteria[pageSize]"] == ["2"] and q["searchCriteria[currentPage]"] == ["1"]
    assert q["searchCriteria[sortOrders][0][field]"] == ["entity_id"] and q["storeId"] == ["1"]


def test_tout_s_arrete_sur_une_page_deja_vue_ou_vide():
    c = _client(_transport([[A54_NOIR, A54_OLED], [A54_NOIR, A54_OLED], [OPPO_A54]]))
    r = c.tout(taille=2)
    assert [p["id"] for p in r["produits"]] == [79300, 51792] and r["complet"] is True and r["pages"] == 2
    c = _client(_transport([[A54_NOIR, A54_OLED]]))
    r = c.tout(taille=2)
    assert len(r["produits"]) == 2 and r["pages"] == 2 and r["complet"] is True


def test_filtre_des_references_chiffrees():
    journal = []
    c = _client(_transport([], numeriques=NUMERIQUES, journal=journal))
    r = c.tout(U.FILTRES_NUMERIQUES)
    assert {p["id"] for p in r["produits"]} == {79300, 36398}
    q = journal[0]
    assert q["searchCriteria[filter_groups][0][filters][0][field]"] == ["name"]
    assert q["searchCriteria[filter_groups][1][filters][0][condition_type]"] == ["from"]
    assert q["searchCriteria[filter_groups][3][filters][0][value]"] == ["%-%"]
    assert q["searchCriteria[filter_groups][4][filters][0][condition_type]"] == ["nlike"]


@pytest.mark.parametrize("statut, code", [
    ((403, "text/html; charset=UTF-8", "<title>Attention Required! | Cloudflare</title>"), "bloque"),
    ((200, "text/html", "<html>Just a moment...</html>"), "bloque"),
    ((401, "application/json", '{"message":"The consumer isn\'t authorized"}'), "ferme"),
    ((404, "application/json", '{"message":"Request does not match any route."}'), "ferme"),
    ((429, "application/json", "{}"), "limite"),
])
def test_acces_bloque_ferme_ou_limite_arrete_tout_sans_rejouer(statut, code):
    c = _client(_transport([], statut=statut))
    with pytest.raises(U.ErreurUtopya) as e:
        c.tout()
    assert e.value.code == code and c.requetes == 1
    if code == "bloque":
        assert "favori « Collecte Utopya »" in str(e.value)


def test_erreur_passagere_rejouee_puis_reussie():
    appels = {"n": 0}

    def repondre(req):
        appels["n"] += 1
        if appels["n"] == 1:
            return httpx.Response(500, headers={"content-type": "application/json"}, content=b"{}")
        if appels["n"] == 2:
            raise httpx.ConnectError("coupure")
        return httpx.Response(200, json={"items": [A54_NOIR]})

    pauses = []
    c = U.ClientUtopya(transport=httpx.MockTransport(repondre), dormir=pauses.append)
    r = c.tout()
    assert [p["id"] for p in r["produits"]] == [79300] and c.requetes == 3 and len(pauses) == 2


def test_reponse_inattendue():
    c = _client(httpx.MockTransport(lambda req: httpx.Response(200, json={"message": "?"})))
    with pytest.raises(U.ErreurUtopya) as e:
        c.tout()
    assert e.value.code == "reponse" and c.requetes == U.ESSAIS_PAGE


# ─── Produits de l'accès → tuiles du collecteur ──────────────────

@pytest.mark.parametrize("nom, marque", [
    ("Ecran Complet Noir Galaxy A54 5G (A546B)", "samsung"),
    ("Batterie Galaxy A34 5G/A35 5G/A54 5G (A346B/A356B/A546B)", "samsung"),
    ("Ecran Complet Noir Oppo A74 5G/A54 5G", "oppo"),
    ("Ecran Complet Google Pixel 6 (ReLife)", "google"),
    ("Ecran Complet Noir Pixel 6 Pro (Soft OLED)", "google"),
    ("Ecran iPhone 13 (Soft OLED)", "apple"),
    ("Ecran Complet Redmi Note 12 Pro", "xiaomi"),
    ("Batterie Moto G54", "motorola"),
    ("Batterie A1376 iPad 2", "apple"),                              # code avant la gamme
    ("Ecran Complet Noir Carbone Galaxy S8 (G950F)", "samsung"),     # coloris inconnu avant la gamme
    ("Haut-Parleur Inférieur iPhone X", "apple"),
    ("Ecran Complet Trucmuche X1", ""),
    ("Ecran Complet Noir Surface Go (ReLife)", ""),
])
def test_marque_produit(nom, marque):
    assert U.marque_produit(nom) == marque


def test_produits_api_reference_stock_marque_et_ecarts():
    refs = {"/ecran-complet-google-pixel-6.html": "420921"}
    items = [A54_NOIR, A54_OLED, PIXEL6, PIXEL6_RELIFE, OPPO_A54, MOTO, COQUE, INCONNU]
    produits, pages, ecartes = U.produits_api(items, {79300, 36398}, refs, {"samsung", "google", "oppo"})
    par_nom = {p["nom"]: p for p in produits}
    assert ecartes == {"hors_pieces": 1, "sans_marque": 1, "hors_grille": 1}     # coque, Trucmuche, Motorola
    assert par_nom[A54_NOIR["name"]]["sku"] == "134705"                          # nombre en fin d'adresse
    assert par_nom[PIXEL6["name"]]["sku"] == "420921"                            # référence du catalogue
    assert par_nom[A54_OLED["name"]]["sku"] == "UT51792"                         # ni l'un ni l'autre
    assert par_nom[PIXEL6["name"]]["stock"] == "rupture" and par_nom[A54_NOIR["name"]]["stock"] == "ok"
    assert par_nom[A54_NOIR["name"]]["sku_numerique"] is True and par_nom[OPPO_A54["name"]]["sku_numerique"] is False
    assert par_nom[PIXEL6["name"]]["prix_montant"] == 97 and par_nom[PIXEL6["name"]]["page"] == "marque:google"
    assert {p["marque"] for p in pages} == {"samsung", "google", "oppo"}


def test_lignes_des_produits_api_qualites_prix_et_stock():
    produits, pages, _ = U.produits_api([A54_NOIR, A54_OLED, A54_INCELL, PIXEL6, PIXEL6_RELIFE, OPPO_A54],
                                        {79300, 36398}, {}, None)
    lignes, diag = U.lignes_collecte(produits, {p["url"]: p for p in pages}, 1.2)
    par = {l["designation"]: l for l in lignes}
    assert par[A54_NOIR["name"]]["qualite"] == "Original"            # sans étiquette, référence chiffrée
    assert par[A54_NOIR["name"]]["marque"] == "Samsung" and str(par[A54_NOIR["name"]]["prix_ht"]) == "62.25"
    assert par[A54_OLED["name"]]["qualite"] == "OLED"
    assert par[A54_INCELL["name"]]["qualite"] == "Incell"
    assert par[PIXEL6["name"]]["qualite"] == "Original" and par[PIXEL6["name"]]["en_stock"] is False
    assert par[PIXEL6_RELIFE["name"]]["qualite"] == "Compatible" and str(par[PIXEL6_RELIFE["name"]]["prix_ht"]) == "54.91"
    assert par[OPPO_A54["name"]]["qualite"] == "Compatible"          # sans étiquette, référence non chiffrée
    assert len(diag) == 6


def test_qualite_nom_drapeau_numerique():
    assert U.qualite_nom("Ecran Complet Noir Galaxy A54 5G", "UT1", numerique=True) == "Original"
    assert U.qualite_nom("Ecran Complet Noir Galaxy A54 5G", "420921", numerique=False) == "Compatible"
    assert U.qualite_nom("Ecran Complet Noir Galaxy A54 5G", "420921") == "Original"
    assert U.qualite_nom("Ecran Complet Galaxy A54 (ReLife)", "420921", numerique=True) == "Compatible"
    # Références notées par la synchro : UTN = toute chiffrée, UT = maison
    assert U.qualite_nom("Ecran Complet Vert OnePlus Nord 3 5G", "UTN62832") == "Original"
    assert U.qualite_nom("Ecran Complet Vert OnePlus Nord 3 5G", "UT62832") == "Compatible"


def test_reference_notee_utn_pour_un_ecran_a_reference_chiffree():
    """Production, 10/11/2026 : « Ecran Complet Vert OnePlus Nord 3 5G » (112 € HT, référence chiffrée, absente
    de l'adresse et du catalogue) était noté UT62832, lu comme une référence maison par la purge des qualités,
    qui vidait la ligne « Original » de 12 modèles. La référence notée doit rester cohérente avec la qualité."""
    produits, pages, _ = U.produits_api([PIXEL6, A54_OLED], {36398}, {}, None)
    par = {p["nom"]: p["sku"] for p in produits}
    assert par[PIXEL6["name"]] == "UTN36398" and par[A54_OLED["name"]] == "UT51792"
    lignes, _ = U.lignes_collecte(produits, {p["url"]: p for p in pages}, 1.2)
    for l in lignes:
        assert F.qualite_coherente(l["qualite"], l["designation"], l["reference"], "Utopya"), l
    assert {l["designation"]: l["qualite"] for l in lignes}[PIXEL6["name"]] == "Original"


def test_refs_catalogue_ignore_les_references_notees_par_la_synchro():
    class Cur:
        def execute(self, *a):
            pass

        def fetchall(self):
            return [{"ref": "420921", "url": "https://www.utopya.fr/ecran-complet-google-pixel-6.html"},
                    {"ref": "UT62832", "url": "https://www.utopya.fr/ecran-complet-vert-oneplus-nord-3-5g.html"},
                    {"ref": "UTN1", "url": "https://www.utopya.fr/x.html"},
                    {"ref": "A546-OLED@", "url": "https://www.utopya.fr/ecran-oled-a54.html?x=1"}]

    assert U.refs_catalogue(Cur()) == {"/ecran-complet-google-pixel-6.html": "420921",
                                       "/ecran-oled-a54.html": "A546-OLED@"}


# ─── Passage complet, jour, lancement manuel ─────────────────────

class _BaseCatalogue(_Base):
    """Curseur simulé + références du catalogue Utopya (fiche → référence)."""

    def __init__(self, params=None, modeles=(), catalogue=()):
        super().__init__(params, modeles)
        self.catalogue = list(catalogue)

    def execute(self, sql, p=None):
        s = " ".join(str(sql).split())
        if s.startswith("SELECT ref, url FROM fournisseurs_catalogue"):
            self.sql.append((s, p))
            self._res = [{"ref": r, "url": u} for r, u in self.catalogue] if p == (U.FOURNISSEUR,) else []
            return
        super().execute(sql, p)


@contextmanager
def _base_u(base, monkeypatch):
    @contextmanager
    def gc(*a, **k):
        yield base
    monkeypatch.setattr(U, "get_cursor", gc)
    with _sur(base):
        yield base


def test_synchroniser_lit_traduit_et_passe_a_traiter(monkeypatch):
    base = _BaseCatalogue({}, [("Samsung", "Galaxy A54 5G"), ("Google", "Pixel 6")],
                          [("420921", "https://www.utopya.fr/ecran-complet-google-pixel-6.html")])
    recus = []

    def faux_traiter(collecte, mode="favori"):
        recus.append((collecte, mode))
        return {"ok": True, "modifies": 4, "propositions": 0, "complements": 1, "lignes_envoyees": 5,
                "produits_prix": 5, "sans_prix": 12, "catalogue_retires": 3}

    monkeypatch.setattr(U, "traiter", faux_traiter)
    with _base_u(base, monkeypatch):
        r = U.synchroniser(transport=_transport([[A54_NOIR, A54_OLED, PIXEL6, OPPO_A54, COQUE]], numeriques=NUMERIQUES),
                           dormir=lambda s: None)
    assert r["ok"] is True and r["code"] is None and r["complet"] is True
    assert r["produits_lus"] == 5 and r["ecrans_numeriques"] == 2 and r["references_catalogue"] == 1
    assert r["gardes"] == 3 and r["ecartes"] == {"hors_pieces": 1, "sans_marque": 0, "hors_grille": 1}   # coque ; Oppo hors grille
    assert r["collecte"]["modifies"] == 4 and r["requetes"] == 2
    collecte, mode = recus[0]
    assert mode == "serveur" and collecte["interrompu"] is False
    assert collecte["pages_lues"] == collecte["pages_total"] == 1          # passage complet : purge du catalogue permise
    assert {p["sku"] for p in collecte["produits"]} == {"134705", "UT51792", "420921"}
    assert base.params[U.P_SYNC_OK] == "1" and '"gardes": 3' in base.params[U.P_SYNC_RESUME]


def test_synchroniser_bloque_par_cloudflare_rien_importe(monkeypatch):
    base = _BaseCatalogue({}, [("Samsung", "Galaxy A54 5G")])
    monkeypatch.setattr(U, "traiter", lambda *a, **k: pytest.fail("aucun import attendu"))
    with _base_u(base, monkeypatch):
        r = U.synchroniser(transport=_transport([], statut=(403, "text/html", "Attention Required! | Cloudflare")),
                           dormir=lambda s: None)
    assert r["ok"] is False and r["code"] == "bloque" and "favori" in r["erreur"]
    assert base.params[U.P_SYNC_OK] == "0" and U.P_RESUME not in base.params   # la dernière collecte reste intacte


def test_synchroniser_catalogue_vide_ou_import_refuse(monkeypatch):
    base = _BaseCatalogue({}, [("Samsung", "Galaxy A54 5G")])
    monkeypatch.setattr(U, "traiter", lambda *a, **k: pytest.fail("aucun import attendu"))
    with _base_u(base, monkeypatch):
        r = U.synchroniser(transport=_transport([]), dormir=lambda s: None)
    assert r["ok"] is False and r["code"] == "vide"
    monkeypatch.setattr(U, "traiter", lambda c, mode="favori": {"ok": False, "erreur": "L'accès automatique d'Utopya ne donne plus les prix"})
    with _base_u(base, monkeypatch):
        r = U.synchroniser(transport=_transport([[A54_NOIR]], numeriques=NUMERIQUES), dormir=lambda s: None)
    assert r["ok"] is False and r["code"] == "import" and "ne donne plus les prix" in r["erreur"]


def test_synchroniser_attend_une_collecte_du_favori(monkeypatch):
    base = _BaseCatalogue({}, [])
    monkeypatch.setattr(U, "en_cours", lambda: True)
    with _base_u(base, monkeypatch):
        r = U.synchroniser(transport=httpx.MockTransport(lambda req: pytest.fail("aucune requête attendue")))
    assert r["ok"] is False and r["code"] == "occupe"


def test_synchro_quotidienne_une_fois_par_jour_et_coupure(monkeypatch):
    from datetime import date
    base = _BaseCatalogue({}, [("Samsung", "Galaxy A54 5G")])
    appels = []
    monkeypatch.setattr(U, "synchroniser", lambda transport=None, dormir=None: appels.append(1) or {"ok": True})
    jour = date(2026, 11, 10)
    with _base_u(base, monkeypatch):
        assert U.synchro_quotidienne(jour) == {"ok": True}
        assert base.params[U.P_SYNC_JOUR] == "2026-11-10" and base.params[U.P_SYNC_VERROU] == ""
        assert U.synchro_quotidienne(jour) is None                   # déjà fait aujourd'hui
        base.params[U.P_SYNC_ACTIVE] = "0"
        assert U.synchro_quotidienne(date(2026, 11, 11)) is None     # coupée
        base.params[U.P_SYNC_ACTIVE] = ""
        monkeypatch.setenv("KP_SYNC_UTOPYA", "0")
        assert U.synchro_quotidienne(date(2026, 11, 11)) is None
    assert appels == [1]


def test_synchro_quotidienne_trois_essais_rates_au_plus(monkeypatch):
    from datetime import date
    base = _BaseCatalogue({}, [])
    appels = []
    monkeypatch.setattr(U, "synchroniser", lambda transport=None, dormir=None: appels.append(1) or {"ok": False})
    with _base_u(base, monkeypatch):
        for _ in range(5):
            U.synchro_quotidienne(date(2026, 11, 10))
    assert len(appels) == F.ESSAIS_PAR_JOUR and base.params[U.P_SYNC_JOUR] == f"2026-11-10#{F.ESSAIS_PAR_JOUR}"


def test_boucle_quotidienne_appelle_utopya_apres_mobilax(monkeypatch):
    ordre = []
    monkeypatch.setattr(F, "purger_qualites", lambda par=None: None)
    monkeypatch.setattr(F, "synchro_quotidienne", lambda: ordre.append("mobilax"))
    monkeypatch.setattr(U, "synchro_quotidienne", lambda: ordre.append("utopya"))

    class Fin(Exception):
        pass

    def dormir(s):
        if ordre:
            raise Fin
    monkeypatch.setattr(F.time, "sleep", dormir)
    with pytest.raises(Fin):
        F._boucle(0, 3600)
    assert ordre == ["mobilax", "utopya"]


def test_etat_expose_la_synchro_sans_secret(monkeypatch):
    from app.services import params as params_cache
    valeurs = {U.P_CLE: "c" * 48, U.P_SYNC_OK: "0", U.P_SYNC_DERNIERE: "2026-11-10T06:00:00",
               U.P_SYNC_RESUME: '{"ok": false, "erreur": "Utopya bloque", "code": "bloque"}'}
    monkeypatch.setattr(params_cache, "get_params", lambda cles, defauts=None, cur=None: {c: valeurs.get(c, "") for c in cles})
    e = U.etat()
    assert e["synchro"] == {"active": True, "en_cours": False, "debut": None, "derniere": "2026-11-10T06:00:00", "ok": False,
                            "erreur": "Utopya bloque", "code": "bloque",
                            "resume": {"ok": False, "erreur": "Utopya bloque", "code": "bloque"}, "message": None}
    assert "c" * 48 not in str(e)


def test_route_sync_utopya_admin_seulement(client, monkeypatch):
    lances = []
    monkeypatch.setattr(U, "lancer_synchro", lambda: lances.append(1) or len(lances) == 1)
    assert client.post("/api/tarifs/fournisseurs/utopya/sync").status_code == 401
    _, gc_staff = fake_db(lambda sql, params: None)
    with patch("app.api.auth.get_cursor", gc_staff):
        assert client.post("/api/tarifs/fournisseurs/utopya/sync", headers=_headers()).status_code == 403
    _, gc_admin = fake_db(lambda sql, params: _ADMIN_PROUVE if "membres_equipe" in sql else None)
    with patch("app.api.auth.get_cursor", gc_admin):
        r = client.post("/api/tarifs/fournisseurs/utopya/sync", headers=_headers())
        assert r.status_code == 200 and r.json() == {"lance": True}
        r = client.post("/api/tarifs/fournisseurs/utopya/sync", headers=_headers())
        assert r.status_code == 409 and "déjà en cours" in r.json()["detail"]
    assert lances == [1, 1]
