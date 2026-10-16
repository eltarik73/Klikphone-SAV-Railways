"""SMS réels via Brevo : service (numéros, segments, expéditeur), route d'envoi
(traçabilité, anti double envoi, repli lien sms:), solde et configuration.
L'API Brevo est simulée : aucun appel réseau."""

import types
from contextlib import contextmanager
from unittest.mock import patch

import httpx
import pytest

from app.api.auth import create_admin_token, create_token, decode_token
from app.services import sms

CLE = "xkeysib-cle-de-test-0123456789"


# ── Base et Brevo simulés ───────────────────────────────────────────

class FakeCursor:
    def __init__(self, handler):
        self.handler = handler
        self.executed = []
        self._last = None

    def execute(self, sql, params=None):
        sql = " ".join(str(sql).split())
        self.executed.append((sql, params))
        self._last = self.handler(sql, params)

    def fetchone(self):
        r = self._last
        return (r[0] if r else None) if isinstance(r, list) else r

    def fetchall(self):
        r = self._last
        return [] if r is None else (r if isinstance(r, list) else [r])

    def ecrits(self, debut):
        return [(s, p) for s, p in self.executed if s.startswith(debut)]


def base(params=None, telephone="06 12 34 56 78", ticket=True):
    valeurs = {"SMS_BREVO_ACTIF": "1", **(params or {})}

    def handler(sql, p):
        if sql.startswith("SELECT cle, valeur FROM params"):
            return [{"cle": k, "valeur": v} for k, v in valeurs.items()]
        if sql.startswith("SELECT t.ticket_code, c.telephone"):
            return {"ticket_code": "KP-000042", "telephone": telephone} if ticket else None
        return None

    cur = FakeCursor(handler)

    @contextmanager
    def gc(*a, **k):
        yield cur

    return cur, gc


class FakeResp:
    def __init__(self, status, body=None):
        self.status_code = status
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("pas de JSON")
        return self._body


class FakeBrevo:
    """Remplace httpx.Client : enregistre les appels, rejoue les réponses prévues."""

    def __init__(self, *reponses):
        self.reponses = list(reponses)
        self.appels = []

    def __call__(self, *a, **k):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def _repondre(self):
        r = self.reponses.pop(0) if len(self.reponses) > 1 else self.reponses[0]
        if isinstance(r, Exception):
            raise r
        return r

    def post(self, url, json=None, headers=None):
        self.appels.append(("POST", url, json, headers))
        return self._repondre()

    def get(self, url, headers=None):
        self.appels.append(("GET", url, None, headers))
        return self._repondre()


@pytest.fixture
def brevo(monkeypatch):
    def installer(*reponses):
        fake = FakeBrevo(*reponses)
        monkeypatch.setattr(sms, "httpx", types.SimpleNamespace(
            Client=fake, Timeout=httpx.Timeout,
            TimeoutException=httpx.TimeoutException, HTTPError=httpx.HTTPError,
        ))
        return fake
    return installer


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("BREVO_API_KEY", CLE)
    sms.ANTI_DOUBLON.vider()
    yield
    sms.ANTI_DOUBLON.vider()


def _headers(admin=False):
    tok = create_token("accueil", "Marie")
    h = {"Authorization": f"Bearer {tok}"}
    if admin:
        h["X-Admin-Token"] = create_admin_token(decode_token(tok))
    return h


def envoyer(client, gc, message="Votre iPhone est prêt", **extra):
    with patch("app.api.notifications.get_cursor", gc), patch("app.services.params.get_cursor", gc):
        return client.post("/api/notifications/sms", headers=_headers(),
                           json={"ticket_id": 42, "message": message, **extra})


# ── Service ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("saisie,attendu", [
    ("06 12 34 56 78", "33612345678"),
    ("06.12.34.56.78", "33612345678"),
    ("+33 6 12 34 56 78", "33612345678"),
    ("0033612345678", "33612345678"),
    ("33612345678", "33612345678"),
    ("612345678", "33612345678"),
    ("+41 79 123 45 67", "41791234567"),
    ("04 79 60 89 22", "33479608922"),
    ("", None),
    ("pas de numéro", None),
    ("12345", None),
])
def test_numero_international(saisie, attendu):
    assert sms.numero_international(saisie) == attendu


def test_mobile_fr_et_affichage():
    assert sms.est_mobile_fr("33612345678") and sms.est_mobile_fr("33712345678")
    assert not sms.est_mobile_fr("33479608922") and not sms.est_mobile_fr("41791234567")
    assert sms.numero_affiche("33612345678") == "06 12 34 56 78"
    assert sms.numero_affiche("41791234567") == "+41791234567"


@pytest.mark.parametrize("valeur,ok", [
    ("KLIKPHONE", True), ("Klik73", True), ("12345678901", True), ("123456789012345", True),
    ("KLIK PHONE", False), ("KLIKPHONE123", False), ("Klikphoné", False), ("", False), ("KLIK-SAV", False),
])
def test_expediteur_valide(valeur, ok):
    assert sms.expediteur_valide(valeur) is ok


def test_segments_gsm_et_unicode():
    assert sms.segments("") == 0
    assert sms.segments("a" * 160) == 1
    assert sms.segments("a" * 161) == 2
    assert sms.segments("a" * 306) == 2 and sms.segments("a" * 307) == 3
    assert sms.segments("é" * 160) == 1                 # é fait partie de l'alphabet GSM
    assert sms.segments("€" * 80) == 1 and sms.segments("€" * 81) == 2   # extension = 2
    assert sms.segments("ê" * 70) == 1 and sms.segments("ê" * 71) == 2   # Unicode
    assert sms.segments("📱" * 35) == 1 and sms.segments("📱" * 36) == 2  # emoji = 2 unités


def test_normaliser_texte_reste_en_gsm():
    t = sms.normaliser_texte("  L’appareil «\u00a0prêt\u00a0» — merci…\r\n ")
    assert t == "L'appareil \" prêt \" - merci..."
    assert not sms.est_gsm("C’est réparé à 19h")
    assert sms.est_gsm(sms.normaliser_texte("C’est réparé à 19h"))


def test_etat_sans_cle(monkeypatch):
    monkeypatch.delenv("BREVO_API_KEY")
    _, gc = base()
    with patch("app.services.params.get_cursor", gc):
        e = sms.etat()
    assert e == {"cle_configuree": False, "active": True, "disponible": False, "expediteur": "KLIKPHONE"}


def test_expediteur_parametre_ou_defaut():
    _, gc = base({"SMS_SENDER": "Klik73"})
    with patch("app.services.params.get_cursor", gc):
        assert sms.expediteur() == "Klik73"
    from app.services import params as params_cache
    params_cache.invalidate()
    _, gc = base({"SMS_SENDER": "Nom trop long avec espaces"})
    with patch("app.services.params.get_cursor", gc):
        assert sms.expediteur() == "KLIKPHONE"


def test_anti_doublon_fenetre(monkeypatch):
    t = [1000.0]
    monkeypatch.setattr(sms.time, "monotonic", lambda: t[0])
    ad = sms.AntiDoublon(delai=60)
    k = ad.cle("33612345678", "Bonjour")
    assert ad.reserver(k) is None
    t[0] += 10
    assert ad.reserver(k) == 10
    assert ad.reserver(ad.cle("33612345678", "Autre texte")) is None
    assert ad.reserver(ad.cle("33698765432", "Bonjour")) is None
    t[0] += 51
    assert ad.reserver(k) is None
    ad.liberer(k)
    assert ad.reserver(k) is None
    assert "33612345678" not in "".join(ad._envois)  # empreintes seulement


# ── Route d'envoi ───────────────────────────────────────────────────

def test_envoi_reussi(client, brevo):
    fake = brevo(FakeResp(201, {"messageId": 1511882900176220}))
    cur, gc = base({"SMS_SENDER": "Klik73"})
    r = envoyer(client, gc, message="Votre iPhone 13 est prêt ! À bientôt", libelle="Appareil prêt")
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "message_id": "1511882900176220", "segments": 1,
                        "destinataire": "06 12 34 56 78"}
    assert len(fake.appels) == 1
    methode, url, corps, entetes = fake.appels[0]
    assert (methode, url) == ("POST", "https://api.brevo.com/v3/transactionalSMS/send")
    assert entetes["api-key"] == CLE
    assert corps == {
        "sender": "Klik73", "recipient": "33612345678", "content": "Votre iPhone 13 est prêt ! À bientôt",
        "type": "transactional", "tag": ["klikphone-sav", "KP-000042"], "unicodeEnabled": True,
    }
    notes = cur.ecrits("INSERT INTO notes_tickets")
    assert len(notes) == 1
    ticket_id, auteur, contenu = notes[0][1]
    assert (ticket_id, auteur) == (42, "Marie")
    assert contenu.startswith("✅ SMS envoyé au 06 12 34 56 78 (1 SMS, Brevo)")
    assert contenu.endswith("[Appareil prêt] Votre iPhone 13 est prêt ! À bientôt")
    assert "'sms'" in notes[0][0]
    assert cur.ecrits("UPDATE tickets SET msg_sms = 1") == [("UPDATE tickets SET msg_sms = 1 WHERE id = %s", (42,))]
    assert CLE not in r.text


def test_texte_gsm_sans_unicode(client, brevo):
    fake = brevo(FakeResp(201, {"messageId": 1}))
    _, gc = base()
    envoyer(client, gc, message="L’appareil est réparé")
    corps = fake.appels[0][2]
    assert corps["content"] == "L'appareil est réparé" and corps["unicodeEnabled"] is False
    assert corps["sender"] == "KLIKPHONE"


@pytest.mark.parametrize("params,env,message", [
    ({"SMS_BREVO_ACTIF": "0"}, True, "désactivé"),
    ({}, False, "BREVO_API_KEY"),
])
def test_non_configure_renvoie_le_lien(client, brevo, monkeypatch, params, env, message):
    if not env:
        monkeypatch.delenv("BREVO_API_KEY")
    fake = brevo(FakeResp(201, {"messageId": 1}))
    cur, gc = base(params)
    r = envoyer(client, gc, message="Bonjour Jean")
    assert r.status_code == 409
    d = r.json()["detail"]
    assert d["code"] == "sms_non_configure" and message in d["message"]
    assert d["link"] == "sms:0612345678?body=Bonjour%20Jean"
    assert fake.appels == [] and not cur.ecrits("INSERT") and not cur.ecrits("UPDATE")


def test_echec_brevo_trace_sans_marquer(client, brevo):
    fake = brevo(FakeResp(400, {"code": "not_enough_credits", "message": "Insufficient credits"}))
    cur, gc = base()
    r = envoyer(client, gc)
    assert r.status_code == 424
    assert r.json()["detail"]["code"] == "credits_epuises"
    assert "Crédits SMS Brevo épuisés" in r.json()["detail"]["message"]
    notes = cur.ecrits("INSERT INTO notes_tickets")
    assert len(notes) == 1 and notes[0][1][2].startswith("⚠️ SMS NON envoyé au 06 12 34 56 78 — Crédits")
    assert not cur.ecrits("UPDATE tickets SET msg_sms")
    # Échec certain : la place est rendue, un nouvel essai repart vers Brevo
    r2 = envoyer(client, gc)
    assert r2.status_code == 424 and len(fake.appels) == 2


@pytest.mark.parametrize("reponse,code", [
    (FakeResp(401, {"code": "unauthorized", "message": "Key not found"}), "cle_refusee"),
    (FakeResp(401, {"code": "unauthorized", "message": "We have detected you are using an unrecognised IP address 1.2.3.4"}),
     "ip_non_autorisee"),
    (FakeResp(400, {"code": "invalid_parameter", "message": "Invalid sender"}), "refus_brevo"),
    (FakeResp(429, {}), "trop_de_requetes"),
    (FakeResp(500, None), "brevo_indisponible"),
    (httpx.ConnectError("boom"), "brevo_injoignable"),
])
def test_erreurs_brevo_lisibles(client, brevo, reponse, code):
    brevo(reponse)
    _, gc = base()
    r = envoyer(client, gc)
    assert r.status_code == 424
    d = r.json()["detail"]
    assert d["code"] == code and d["message"]
    assert CLE not in r.text and "boom" not in r.text


def test_refus_brevo_repris_dans_le_message(client, brevo):
    brevo(FakeResp(400, {"code": "invalid_parameter", "message": "Invalid sender"}))
    _, gc = base()
    r = envoyer(client, gc)
    assert r.json()["detail"]["message"] == "Brevo a refusé le SMS : Invalid sender"


def test_doublon_bloque_dans_les_60_s(client, brevo):
    fake = brevo(FakeResp(201, {"messageId": 1}))
    cur, gc = base()
    assert envoyer(client, gc, message="Votre téléphone est prêt").status_code == 200
    r = envoyer(client, gc, message="Votre téléphone est prêt")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "sms_doublon"
    assert "déjà" in r.json()["detail"]["message"]
    assert len(fake.appels) == 1 and len(cur.ecrits("INSERT INTO notes_tickets")) == 1
    # Un autre texte part normalement
    assert envoyer(client, gc, message="Autre message").status_code == 200
    assert len(fake.appels) == 2


def test_delai_depasse_garde_la_place(client, brevo):
    fake = brevo(httpx.ReadTimeout("lent"))
    cur, gc = base()
    r = envoyer(client, gc)
    assert r.status_code == 424 and r.json()["detail"]["code"] == "delai_depasse"
    assert "a pu partir" in r.json()["detail"]["message"]
    assert len(cur.ecrits("INSERT INTO notes_tickets")) == 1
    # Issue inconnue : pas de renvoi immédiat du même SMS
    assert envoyer(client, gc).status_code == 409 and len(fake.appels) == 1


def test_numero_fixe_refuse(client, brevo):
    fake = brevo(FakeResp(201, {"messageId": 1}))
    cur, gc = base(telephone="04 79 60 89 22")
    r = envoyer(client, gc)
    assert r.status_code == 400 and r.json()["detail"]["code"] == "numero_fixe"
    assert "04 79 60 89 22" in r.json()["detail"]["message"]
    assert fake.appels == [] and not cur.ecrits("INSERT")


def test_numero_etranger_accepte(client, brevo):
    fake = brevo(FakeResp(201, {"messageId": 7}))
    _, gc = base(telephone="+41 79 123 45 67")
    r = envoyer(client, gc)
    assert r.status_code == 200 and fake.appels[0][2]["recipient"] == "41791234567"


@pytest.mark.parametrize("kwargs,statut,code", [
    ({"telephone": "abc"}, 400, "numero_invalide"),
    ({"telephone": None}, 400, "pas_de_telephone"),
    ({"ticket": False}, 404, None),
])
def test_ticket_ou_numero_inutilisable(client, brevo, kwargs, statut, code):
    fake = brevo(FakeResp(201, {"messageId": 1}))
    _, gc = base(**kwargs)
    r = envoyer(client, gc)
    assert r.status_code == statut
    if code:
        assert r.json()["detail"]["code"] == code
    assert fake.appels == []


@pytest.mark.parametrize("message", ["", "   ", "x" * 1001])
def test_message_vide_ou_trop_long(client, brevo, message):
    fake = brevo(FakeResp(201, {"messageId": 1}))
    _, gc = base()
    r = envoyer(client, gc, message=message)
    assert r.status_code in (400, 422)
    assert fake.appels == []


def test_envoi_exige_une_session(client):
    r = client.post("/api/notifications/sms", json={"ticket_id": 42, "message": "x"})
    assert r.status_code == 401


# ── État et solde ───────────────────────────────────────────────────

def test_route_etat_sans_la_cle(client):
    _, gc = base({"SMS_SENDER": "Klik73"})
    with patch("app.services.params.get_cursor", gc):
        r = client.get("/api/notifications/sms/etat", headers=_headers())
    assert r.json() == {"cle_configuree": True, "active": True, "disponible": True, "expediteur": "Klik73"}
    assert CLE not in r.text


def test_solde_credits_sms(client, brevo):
    fake = brevo(FakeResp(200, {
        "email": "contact@exemple.fr",
        "plan": [{"type": "free", "credits": 300, "creditsType": "sendLimit"},
                 {"type": "sms", "credits": 42.5, "creditsType": "sendLimit"}],
    }))
    r = client.get("/api/notifications/sms/credits", headers=_headers())
    assert r.status_code == 200 and r.json() == {"credits": 42.5}
    assert fake.appels[0][:2] == ("GET", "https://api.brevo.com/v3/account")
    assert fake.appels[0][3]["api-key"] == CLE
    assert CLE not in r.text and "contact@exemple.fr" not in r.text


def test_solde_sans_plan_sms(client, brevo):
    brevo(FakeResp(200, {"plan": [{"type": "free", "credits": 300}]}))
    assert client.get("/api/notifications/sms/credits", headers=_headers()).json() == {"credits": 0.0}


def test_solde_sans_cle_ou_cle_refusee(client, brevo, monkeypatch):
    brevo(FakeResp(401, {"code": "unauthorized", "message": "Key not found"}))
    r = client.get("/api/notifications/sms/credits", headers=_headers())
    assert r.status_code == 424 and r.json()["detail"]["code"] == "cle_refusee"
    monkeypatch.delenv("BREVO_API_KEY")
    r = client.get("/api/notifications/sms/credits", headers=_headers())
    assert r.status_code == 409 and r.json()["detail"]["code"] == "sms_non_configure"


# ── Configuration ───────────────────────────────────────────────────

def _config_put(client, gc, corps, admin=False):
    with patch("app.api.config.get_cursor", gc):
        return client.put("/api/config/batch", headers=_headers(admin), json=corps)


def test_reglages_sms_exigent_elevation(client):
    cur, gc = base()
    r = _config_put(client, gc, [{"cle": "SMS_BREVO_ACTIF", "valeur": "1"}])
    assert r.status_code == 403 and r.json()["detail"]["code"] == "admin_requis"
    assert not cur.ecrits("INSERT")
    r = _config_put(client, gc, [{"cle": "SMS_BREVO_ACTIF", "valeur": "1"},
                                 {"cle": "SMS_SENDER", "valeur": " Klik73 "}], admin=True)
    assert r.status_code == 200
    assert [p for _, p in cur.ecrits("INSERT INTO params")] == [("SMS_BREVO_ACTIF", "1"), ("SMS_SENDER", "Klik73")]


@pytest.mark.parametrize("cle,valeur", [
    ("SMS_SENDER", "KLIK PHONE"), ("SMS_SENDER", "KLIKPHONE-SAV"), ("SMS_BREVO_ACTIF", "oui"),
])
def test_reglages_sms_invalides(client, cle, valeur):
    cur, gc = base()
    r = _config_put(client, gc, [{"cle": cle, "valeur": valeur}], admin=True)
    assert r.status_code == 400
    assert not cur.ecrits("INSERT")


def test_expediteur_vide_accepte(client):
    cur, gc = base()
    r = _config_put(client, gc, [{"cle": "SMS_SENDER", "valeur": ""}], admin=True)
    assert r.status_code == 200
    assert [p for _, p in cur.ecrits("INSERT INTO params")] == [("SMS_SENDER", "")]
