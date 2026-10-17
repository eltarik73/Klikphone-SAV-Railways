"""Vague C1 : secrets de config, élévation admin, anti brute-force, suivi public,
documents envoyables, polling (cache + ETag), upsert client public, dates admin."""

import sys
import types
from contextlib import contextmanager
from unittest.mock import patch

import pytest

from app.api import auth
from app.api.auth import create_admin_token, create_token, decode_token


# ── Base simulée : réponses choisies selon le texte SQL ─────────────

class FakeCursor:
    def __init__(self, handler):
        self.handler = handler
        self.executed = []
        self._last = None
        self.rowcount = 0

    def execute(self, sql, params=None):
        self.executed.append((" ".join(str(sql).split()), params))
        self._last = self.handler(" ".join(str(sql).split()), params)

    def fetchone(self):
        r = self._last
        if isinstance(r, list):
            return r[0] if r else None
        return r

    def fetchall(self):
        r = self._last
        if r is None:
            return []
        return r if isinstance(r, list) else [r]

    def sql(self):
        return [s for s, _ in self.executed]


def fake_db(handler):
    cur = FakeCursor(handler)

    @contextmanager
    def gc(*a, **k):
        yield cur

    return cur, gc


@pytest.fixture(autouse=True)
def _reset_limiteurs():
    from app.api import chat, notifications_center, suivi
    auth.reset_essais()
    suivi._LIMITEUR._buckets.clear()
    suivi.invalider_interactions()
    chat.invalider_cache_chat()
    notifications_center.invalider_cache_notifications()
    yield
    auth.reset_essais()


def _headers(user="TestUser", ip="10.0.0.1", admin=False):
    tok = create_token("accueil", user)
    h = {"Authorization": f"Bearer {tok}", "X-Forwarded-For": f"6.6.6.6, {ip}"}
    if admin:
        h["X-Admin-Token"] = create_admin_token(decode_token(tok))
    return h


PARAMS = {
    "PIN_ACCUEIL": "1234", "PIN_TECH": "5678", "ADMIN_PASSWORD": "adm1n", "CAISSE_PASSWORD": "cp",
    "CAISSE_APIKEY": "ck", "DISCORD_WEBHOOK": "https://hook", "RESEND_API_KEY": "re_x",
    "smtp_password": "sp", "ANTHROPIC_API_KEY": "sk", "NOM_BOUTIQUE": "Klik", "tva": "20",
}


def _params_handler(sql, params):
    if sql.startswith("SELECT cle, valeur FROM params ORDER BY cle"):
        return [{"cle": k, "valeur": v} for k, v in sorted(PARAMS.items())]
    if sql.startswith("SELECT cle, valeur FROM params WHERE cle = ANY"):
        return [{"cle": k, "valeur": PARAMS[k]} for k in params[0] if k in PARAMS]
    if sql.startswith("SELECT valeur FROM params WHERE cle = 'ADMIN_PASSWORD'"):
        return {"valeur": PARAMS["ADMIN_PASSWORD"]}
    if sql.startswith("SELECT valeur FROM params WHERE cle = %s"):
        k = params[0]
        return {"valeur": PARAMS[k]} if k in PARAMS else None
    return None


# ── ING-06 : secrets ────────────────────────────────────────────────

@pytest.mark.parametrize("cle", [
    "PIN_ACCUEIL", "pin_tech", "ADMIN_PASSWORD", "ADMIN_CODE", "CAISSE_PASSWORD", "CAISSE_APIKEY",
    "DISCORD_WEBHOOK", "RESEND_API_KEY", "smtp_password", "ANTHROPIC_API_KEY", "STRIPE_SECRET",
    "LCD_TOKEN", "GOOGLE_KEY", "mot_de_passe_wifi",
])
def test_cles_secretes(cle):
    from app.api.config import est_secret
    assert est_secret(cle)


@pytest.mark.parametrize("cle", [
    "NOM_BOUTIQUE", "tva", "URL_SUIVI", "SMTP_USER", "ANTHROPIC_MODEL", "CAISSE_ENABLED",
    "CAISSE_SHOPID", "MODULE_DEVIS_VISIBLE", "GOOGLE_REVIEW_LINK", "discord_notif_statut", "message_templates",
])
def test_cles_non_secretes(cle):
    from app.api.config import est_secret
    assert not est_secret(cle)


def test_list_params_ne_renvoie_aucun_secret(client):
    _, gc = fake_db(_params_handler)
    with patch("app.api.config.get_cursor", gc):
        r = client.get("/api/config", headers=_headers())
    assert r.status_code == 200
    cfg = {x["cle"]: x["valeur"] for x in r.json()}
    for k in ("PIN_ACCUEIL", "PIN_TECH", "ADMIN_PASSWORD", "CAISSE_PASSWORD", "CAISSE_APIKEY",
              "DISCORD_WEBHOOK", "RESEND_API_KEY", "smtp_password", "ANTHROPIC_API_KEY"):
        assert cfg[k] == "••••"
        assert PARAMS[k] not in r.text
    assert cfg["NOM_BOUTIQUE"] == "Klik"


def test_get_param_secret_masque(client):
    _, gc = fake_db(_params_handler)
    with patch("app.api.config.get_cursor", gc):
        r = client.get("/api/config/PIN_TECH", headers=_headers())
        r2 = client.get("/api/config/tva", headers=_headers())
    assert r.json() == {"cle": "PIN_TECH", "valeur": "••••"}
    assert r2.json()["valeur"] == "20"


def test_caisse_config_masquee(client):
    _, gc = fake_db(_params_handler)
    with patch("app.api.config.get_cursor", gc):
        r = client.get("/api/config/caisse", headers=_headers())
    body = r.json()
    assert body["CAISSE_PASSWORD"] == "••••" and body["CAISSE_APIKEY"] == "••••"
    assert "CAISSE_ENABLED" in body


def test_batch_secret_masque_ou_vide_ignore_sans_elevation(client):
    cur, gc = fake_db(_params_handler)
    with patch("app.api.config.get_cursor", gc):
        r = client.put("/api/config/batch", headers=_headers(), json=[
            {"cle": "NOM_BOUTIQUE", "valeur": "Klik 2"},
            {"cle": "PIN_ACCUEIL", "valeur": "••••"},
            {"cle": "DISCORD_WEBHOOK", "valeur": ""},
        ])
    assert r.status_code == 200
    ecrits = [p[0] for s, p in cur.executed if s.startswith("INSERT INTO params")]
    assert ecrits == ["NOM_BOUTIQUE"]


def test_batch_nouveau_secret_exige_elevation(client):
    cur, gc = fake_db(_params_handler)
    with patch("app.api.config.get_cursor", gc):
        r = client.put("/api/config/batch", headers=_headers(), json=[
            {"cle": "NOM_BOUTIQUE", "valeur": "Klik 2"},
            {"cle": "DISCORD_WEBHOOK", "valeur": "https://autre"},
        ])
        assert r.status_code == 403
        assert r.json()["detail"]["code"] == "admin_requis"
        assert not [s for s in cur.sql() if s.startswith("INSERT")]
        r = client.put("/api/config/batch", headers=_headers(admin=True), json=[
            {"cle": "DISCORD_WEBHOOK", "valeur": "https://autre"},
        ])
    assert r.status_code == 200
    assert ("DISCORD_WEBHOOK", "https://autre") in [p for s, p in cur.executed if s.startswith("INSERT INTO params")]


def test_put_pin_invalide_refuse(client):
    _, gc = fake_db(_params_handler)
    with patch("app.api.config.get_cursor", gc):
        r = client.put("/api/config", headers=_headers(admin=True), json={"cle": "PIN_TECH", "valeur": "12"})
    assert r.status_code == 400


@pytest.mark.parametrize("method,path,body", [
    ("GET", "/api/config/backup", None),
    ("POST", "/api/config/backup/import", {"tables": {"params": []}}),
    ("POST", "/api/config/change-pin", {"target": "tech", "old_pin": "5678", "new_pin": "1111"}),
    ("PUT", "/api/config/caisse", {"CAISSE_ENABLED": "0"}),
    ("DELETE", "/api/tickets/1", None),
    ("DELETE", "/api/clients/1", None),
])
def test_actions_sensibles_exigent_elevation(client, method, path, body):
    r = client.request(method, path, headers=_headers(), json=body)
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "admin_requis"


def test_save_caisse_ne_remplace_pas_un_secret_masque(client):
    cur, gc = fake_db(_params_handler)
    with patch("app.api.config.get_cursor", gc):
        r = client.put("/api/config/caisse", headers=_headers(admin=True), json={
            "CAISSE_ENABLED": "1", "CAISSE_PASSWORD": "••••", "CAISSE_APIKEY": "", "AUTRE": "x",
        })
    assert r.status_code == 200
    assert [p[0] for s, p in cur.executed if s.startswith("INSERT INTO params")] == ["CAISSE_ENABLED"]


def test_change_pin_mauvais_ancien_pin_403(client):
    _, gc = fake_db(_params_handler)
    with patch("app.api.config.get_cursor", gc):
        r = client.post("/api/config/change-pin", headers=_headers(admin=True),
                        json={"target": "tech", "old_pin": "0000", "new_pin": "1111"})
    assert r.status_code == 403


# ── Élévation admin ─────────────────────────────────────────────────

def test_verify_admin_delivre_un_jeton_court(client):
    _, gc = fake_db(_params_handler)
    with patch("app.api.auth.get_cursor", gc):
        r = client.post("/api/admin/verify", headers=_headers(), json={"login": "admin", "password": "adm1n"})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True and body["expires_in"] == 600
    from jose import jwt
    payload = jwt.decode(body["admin_token"], auth.JWT_SECRET, algorithms=[auth.JWT_ALGORITHM])
    assert payload["admin"] is True and payload["sub"] == "TestUser"
    assert 590 <= payload["exp"] - __import__("time").time() <= 601


def test_verify_admin_mauvais_code_403_pas_401(client):
    _, gc = fake_db(_params_handler)
    with patch("app.api.auth.get_cursor", gc):
        r = client.post("/api/admin/verify", headers=_headers(), json={"login": "admin", "password": "non"})
        r2 = client.post("/api/admin/verify", headers=_headers(), json={"login": "root", "password": "adm1n"})
    assert r.status_code == 403 and r2.status_code == 403


def test_jeton_elevation_refuse_comme_session(client):
    tok = create_admin_token({"sub": "TestUser", "target": "accueil"})
    r = client.get("/api/config", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 401


def test_jeton_elevation_lie_a_l_utilisateur(client):
    autre = create_admin_token({"sub": "Autre", "target": "accueil"})
    r = client.delete("/api/tickets/1", headers={**_headers(), "X-Admin-Token": autre})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "admin_expire"


def test_jeton_session_refuse_comme_elevation(client):
    h = _headers()
    r = client.delete("/api/tickets/1", headers={**h, "X-Admin-Token": h["Authorization"][7:]})
    assert r.status_code == 403


def test_suppression_avec_elevation(client):
    r = client.delete("/api/tickets/1", headers=_headers(admin=True))
    assert r.status_code == 200


def test_x_admin_password_accepte(client):
    _, gc = fake_db(_params_handler)
    with patch("app.api.auth.get_cursor", gc):
        ok = client.delete("/api/tickets/1", headers={**_headers(), "X-Admin-Password": "adm1n"})
        ko = client.delete("/api/tickets/1", headers={**_headers(), "X-Admin-Password": "faux"})
    assert ok.status_code == 200
    assert ko.status_code == 403 and ko.json()["detail"]["code"] == "admin_invalide"


# ── Hash bcrypt (bibliothèque simulée : absente de l'environnement de test) ──

@pytest.fixture
def faux_bcrypt(monkeypatch):
    mod = types.ModuleType("bcrypt")
    mod.gensalt = lambda: b"$2b$12$sel"
    mod.hashpw = lambda pw, salt: b"$2b$12$sel" + pw[::-1]
    mod.checkpw = lambda pw, h: h == b"$2b$12$sel" + pw[::-1]
    monkeypatch.setitem(sys.modules, "bcrypt", mod)
    return mod


def test_hash_et_verification(faux_bcrypt):
    h = auth.hasher_secret("adm1n")
    assert auth.est_hash(h)
    assert auth.verifier_secret("adm1n", h) and not auth.verifier_secret("autre", h)
    assert auth.verifier_secret("adm1n", "adm1n") and not auth.verifier_secret("x", "adm1n")


def test_migration_transparente_du_mot_de_passe_admin(client, faux_bcrypt):
    cur, gc = fake_db(_params_handler)
    with patch("app.api.auth.get_cursor", gc):
        r = client.post("/api/admin/verify", headers=_headers(), json={"login": "admin", "password": "adm1n"})
    assert r.status_code == 200
    maj = [p for s, p in cur.executed if s.startswith("UPDATE params SET valeur = %s WHERE cle = 'ADMIN_PASSWORD'")]
    assert maj and auth.est_hash(maj[0][0]) and maj[0][1] == "adm1n"


def test_bcrypt_absent_hash_stocke_503(monkeypatch):
    monkeypatch.setitem(sys.modules, "bcrypt", None)
    monkeypatch.setattr(auth, "_passlib_bcrypt", lambda: None)
    with pytest.raises(Exception) as e:
        auth.verifier_secret("x", "$2b$12$abc")
    assert getattr(e.value, "status_code", None) == 503
    assert auth.hasher_secret("x") is None


# ── ING-17 : anti brute-force ───────────────────────────────────────

def _pin_handler(sql, params):
    if "FROM params WHERE cle = %s" in sql:
        return {"valeur": {"PIN_ACCUEIL": "1234", "PIN_TECH": "5678"}[params[0]]}
    return None


def test_login_verrouillage_progressif(client):
    _, gc = fake_db(_pin_handler)
    with patch("app.api.auth.get_cursor", gc):
        codes = [client.post("/api/auth/login", json={"pin": "0000", "target": "tech"},
                             headers={"X-Forwarded-For": "10.0.0.9"}).status_code for _ in range(6)]
        bloque = client.post("/api/auth/login", json={"pin": "5678", "target": "tech"},
                             headers={"X-Forwarded-For": "10.0.0.9"})
        # Seule la DERNIÈRE valeur de X-Forwarded-For (posée par le proxy) compte
        forge = client.post("/api/auth/login", json={"pin": "5678", "target": "tech"},
                            headers={"X-Forwarded-For": "1.1.1.1, 10.0.0.9"})
        autre_ip = client.post("/api/auth/login", json={"pin": "5678", "target": "tech"},
                               headers={"X-Forwarded-For": "10.0.0.10"})
        autre_cible = client.post("/api/auth/login", json={"pin": "1234", "target": "accueil"},
                                  headers={"X-Forwarded-For": "10.0.0.9"})
    assert codes == [401, 401, 401, 401, 429, 429]
    assert bloque.status_code == 429 and "Réessayez dans" in bloque.json()["detail"]
    assert int(bloque.headers["retry-after"]) > 0
    assert forge.status_code == 429
    assert autre_ip.status_code == 200 and autre_cible.status_code == 200


def test_anti_brute_force_doublement_et_plafond(monkeypatch):
    t = [1000.0]
    monkeypatch.setattr(auth, "monotonic", lambda: t[0])
    abf = auth.AntiBruteForce(seuil=3, base=10, plafond=35, fenetre=100)
    assert [abf.echec("k") for _ in range(2)] == [0.0, 0.0]
    assert abf.echec("k") == 10 and abf.attente("k") == 10
    assert abf.echec("k") == 20
    assert abf.echec("k") == 35
    t[0] += 36
    assert abf.attente("k") == 0
    abf.succes("k")
    assert abf.echec("k") == 0.0
    t[0] += 101
    assert abf.echec("k") == 0.0  # compteur oublié après la fenêtre


def test_client_ip_derniere_valeur_xff():
    from starlette.requests import Request
    req = Request({"type": "http", "headers": [(b"x-forwarded-for", b"1.1.1.1, 2.2.2.2")], "client": ("3.3.3.3", 1)})
    assert auth.client_ip(req) == "2.2.2.2"
    req = Request({"type": "http", "headers": [], "client": ("3.3.3.3", 1)})
    assert auth.client_ip(req) == "3.3.3.3"


# ── ING-04 : actions publiques du suivi ─────────────────────────────

def _suivi_handler(sql, params):
    if "t.suivi_token, c.telephone AS client_tel" in sql:
        if params[0] != "KP-000042":
            return None
        return {"id": 42, "statut": "En attente d'accord client", "ticket_code": "KP-000042",
                "suivi_token": "JetonFictif_0123456789", "client_tel": "06 12 34 56 78"}
    if "FROM tickets t LEFT JOIN clients c" in sql:
        return {"statut": "En attente d'accord client", "technicien_assigne": None, "panne": "Écran",
                "client_prenom": "Jean", "client_nom": "Fictif", "technicien_assigne_": None}
    return None


def _suivi(client, path, body, ip="10.1.1.1", params=None):
    cur, gc = fake_db(_suivi_handler)
    with patch("app.api.suivi.get_cursor", gc), patch("app.api.suivi.push_notification", lambda **k: None):
        r = client.post(path, json=body, params=params, headers={"X-Forwarded-For": ip})
    return r, cur


@pytest.mark.parametrize("path,body", [
    ("/api/suivi/KP-000042/valider-devis", {"accepte": True}),
    ("/api/suivi/KP-000042/message", {"message": "Bonjour"}),
    ("/api/suivi/KP-000042/avis", {"note": 5}),
])
def test_suivi_actions_refusees_sans_preuve(client, path, body):
    r, cur = _suivi(client, path, body)
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "verification_requise"
    assert not [s for s in cur.sql() if s.startswith(("UPDATE", "INSERT"))]


def test_suivi_jeton_invalide(client):
    r, _ = _suivi(client, "/api/suivi/KP-000042/valider-devis", {"accepte": True, "t": "MauvaisJeton_012345678"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "lien_invalide"


def test_suivi_jeton_valide_corps_ou_query(client):
    r, cur = _suivi(client, "/api/suivi/KP-000042/valider-devis", {"accepte": True, "t": "JetonFictif_0123456789"})
    assert r.status_code == 200 and r.json()["accepte"] is True
    assert any(s.startswith("UPDATE tickets SET statut = 'En cours de réparation'") for s in cur.sql())
    r, _ = _suivi(client, "/api/suivi/KP-000042/message", {"message": "Bonjour"},
                  params={"t": "JetonFictif_0123456789"})
    assert r.status_code == 200


def test_suivi_quatre_derniers_chiffres(client):
    r, _ = _suivi(client, "/api/suivi/KP-000042/message", {"message": "Bonjour", "tel4": "5678"})
    assert r.status_code == 200
    r, _ = _suivi(client, "/api/suivi/KP-000042/message", {"message": "Bonjour", "tel4": "1234"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "verification_echouee"


def test_suivi_quatre_chiffres_brute_force(client):
    codes = [_suivi(client, "/api/suivi/KP-000042/avis", {"note": 5, "tel4": f"{i:04d}"}, ip="10.1.1.7")[0].status_code
             for i in range(6)]
    assert codes == [403, 403, 403, 403, 429, 429]


def test_suivi_ticket_inconnu_404(client):
    r, _ = _suivi(client, "/api/suivi/KP-999999/message", {"message": "x", "tel4": "5678"})
    assert r.status_code == 404


def test_interactions_exige_authentification(client):
    assert client.get("/api/suivi/dashboard/interactions").status_code == 401


def test_interactions_une_requete_cache_et_etag(client):
    calls = []

    def handler(sql, params):
        calls.append(sql)
        return {"accord": [3, 4], "accord_valide": [3], "messages": [5], "avis": None}

    _, gc = fake_db(handler)
    with patch("app.api.suivi.get_cursor", gc):
        r = client.get("/api/suivi/dashboard/interactions", headers=_headers())
        r2 = client.get("/api/suivi/dashboard/interactions",
                        headers={**_headers(user="Autre"), "If-None-Match": r.headers["etag"]})
    assert r.status_code == 200
    assert r.json() == {
        "accord_client": {"count": 2, "ticket_ids": [3, 4]},
        "accord_client_valide": {"count": 1, "ticket_ids": [3]},
        "messages": {"count": 1, "ticket_ids": [5]},
        "avis": {"count": 0, "ticket_ids": []},
        "total_actions": 3,
    }
    assert r2.status_code == 304
    assert len(calls) == 1  # partagé entre postes


# ── email : documents internes ──────────────────────────────────────

@pytest.mark.parametrize("doc", ["staff", "combined"])
def test_send_document_refuse_fiche_atelier(client, doc):
    r = client.post("/api/email/send-document", headers=_headers(),
                    json={"ticket_id": 1, "doc_type": doc, "to": "x@example.test"})
    assert r.status_code == 400


# ── QR de suivi et résolution du scan ───────────────────────────────

def test_url_qr_avec_jeton_code_en_fin():
    from app.api.print_tickets import _suivi_url
    url = _suivi_url("KP-000042", "https://x.test", "JetonFictif_0123456789")
    assert url == "https://x.test/suivi?t=JetonFictif_0123456789&ticket=KP-000042"
    assert _suivi_url("KP-000042", "https://x.test") == "https://x.test/suivi?ticket=KP-000042"


@pytest.mark.parametrize("scan", [
    "https://x.test/suivi?t=JetonFictif_0123456789&ticket=KP-000042",
    "https://x.test/suivi?ticket=KP-000042&t=JetonFictif_0123456789",
    "https://x.test/suivi?t=JetonFictif_0123456789",
])
def test_resolve_url_avec_jeton(client, scan):
    def handler(sql, params):
        if "WHERE suivi_token = %s" in sql:
            return {"id": 42, "ticket_code": "KP-000042"} if params[0] == "JetonFictif_0123456789" else None
        if "ticket_code = %s OR id = %s" in sql:
            return {"id": 42, "ticket_code": "KP-000042"} if params[1] == 42 else None
        return None

    _, gc = fake_db(handler)
    with patch("app.api.search.get_cursor", gc):
        r = client.get("/api/search/resolve", params={"code": scan}, headers=_headers())
    assert r.status_code == 200 and r.json()["id"] == 42


# ── Cache de polling ────────────────────────────────────────────────

def test_poll_cache_invalidation_et_ttl(monkeypatch):
    from app.services import poll_cache
    t = [0.0]
    monkeypatch.setattr(poll_cache, "monotonic", lambda: t[0])
    c = poll_cache.PollCache(ttl=4)
    n = [0]

    def calc():
        n[0] += 1
        return {"v": n[0]}

    a = c.get("k", calc)
    assert c.get("k", calc) == a and n[0] == 1
    c.invalidate()
    assert c.get("k", calc)[0] == '{"v":2}'
    t[0] += 5
    assert c.get("k", calc)[0] == '{"v":3}'


def test_chat_unread_cache_invalide_par_un_envoi(client):
    etat = {"n": 0}

    def handler(sql, params):
        if sql.startswith("SELECT role FROM membres_equipe"):
            return None
        if "COUNT(*) FILTER (WHERE recipient = 'all') as general" in sql:
            return {"general": etat["n"], "private": 0}
        if sql.startswith("INSERT INTO chat_messages"):
            etat["n"] += 1
            from datetime import datetime
            return {"id": 1, "created_at": datetime(2026, 10, 16)}
        return None

    _, gc = fake_db(handler)
    h = _headers(user="Poste")
    with patch("app.api.chat.get_cursor", gc):
        r1 = client.get("/api/chat/team/unread/total", headers=h)
        etag = r1.headers["etag"]
        assert client.get("/api/chat/team/unread/total", headers={**h, "If-None-Match": etag}).status_code == 304
        client.post("/api/chat/team/send", headers=_headers(user="Autre"), json={"message": "x", "sender": "x"})
        r3 = client.get("/api/chat/team/unread/total", headers={**h, "If-None-Match": etag})
    assert r1.json()["total"] == 0
    assert r3.status_code == 200 and r3.json()["total"] == 1


def test_notifications_liste_avec_compteur(client):
    from datetime import datetime

    def handler(sql, params):
        if sql.startswith("SELECT id, type, title"):
            return [{"id": 1, "type": "x", "title": "T", "message": "M", "important": False, "target_user": None,
                     "related_ticket_id": None, "related_devis_id": None, "action_url": None, "icon": None,
                     "read_by": ",Poste,", "created_at": datetime(2026, 10, 16, 9, 0)}]
        if sql.startswith("SELECT COUNT(*) AS count FROM notifications_center"):
            return {"count": 7}
        return None

    _, gc = fake_db(handler)
    from app.api import notifications_center as nc
    nc.invalider_cache_notifications()
    with patch("app.api.notifications_center.get_cursor", gc), patch.object(nc, "_TABLE_CHECKED", True):
        r = client.get("/api/notifications-center", headers=_headers(user="Poste"))
    assert r.status_code == 200
    assert r.headers["x-unread-count"] == "7"
    assert r.json()[0]["is_read"] is True and "read_by" not in r.json()[0]


# ── Clients : upsert public non destructif ──────────────────────────

def _client_handler(existant):
    def handler(sql, params):
        if "kp_phone_key(telephone) = %s" in sql:
            return [existant] if existant else []
        if sql.startswith("UPDATE clients SET"):
            return {**existant, "prenom": "Modifié"} if "RETURNING" in sql else None
        if sql.startswith("INSERT INTO clients"):
            return {"id": 9, "nom": "N", "prenom": "", "telephone": "0611223344", "email": "", "societe": "",
                    "carte_camby": 0, "date_creation": None}
        return None
    return handler


EXISTANT = {"id": 5, "nom": "Fictif", "prenom": "Jean", "telephone": "0611223344",
            "email": "jean@example.test", "societe": "", "carte_camby": 1, "date_creation": None}


def test_client_public_existant_complete_sans_reecrire(client):
    cur, gc = fake_db(_client_handler(EXISTANT))
    with patch("app.api.clients.get_cursor", gc):
        r = client.post("/api/clients", json={"nom": "Pirate", "telephone": "06 11 22 33 44",
                                              "email": "pirate@example.test", "carte_camby": 0})
    assert r.status_code == 200
    assert r.json() == {"id": 5}
    sql, params = [(s, p) for s, p in cur.executed if s.startswith("UPDATE clients")][0]
    assert "CASE WHEN COALESCE(nom, '') = '' THEN" in sql and "RETURNING" not in sql
    assert "CASE WHEN %(camby)s = 1 THEN 1 ELSE carte_camby END" in sql and params["camby"] == 0
    # Jamais l'email : connaître un numéro suffirait à recevoir les documents du client
    assert "email" not in sql


def test_client_staff_mise_a_jour_sans_toucher_carte_non_fournie(client):
    cur, gc = fake_db(_client_handler(EXISTANT))
    with patch("app.api.clients.get_cursor", gc):
        r = client.post("/api/clients", headers=_headers(), json={"nom": "Fictif", "prenom": "Modifié",
                                                                   "telephone": "0611223344"})
    assert r.status_code == 200 and r.json()["email"] == "jean@example.test"
    sql, params = [(s, p) for s, p in cur.executed if s.startswith("UPDATE clients")][0]
    assert "carte_camby = COALESCE(%(camby)s, carte_camby)" in sql and params["camby"] is None


def test_client_public_nouveau_id_seul(client):
    _, gc = fake_db(_client_handler(None))
    with patch("app.api.clients.get_cursor", gc):
        r = client.post("/api/clients", json={"nom": "N", "telephone": "0611223344"})
    assert r.status_code == 200 and r.json() == {"id": 9}


# ── Admin : date_cloture comparée comme du texte ────────────────────

# Membre admin dont le poste a saisi le code admin (auth.exiger_role_admin)
_ADMIN_PROUVE = {"role": "admin", "prouve": True, "a_prolonger": False}


def test_admin_stats_sans_cast_date_cloture(client):
    cur, gc = fake_db(lambda sql, params: _ADMIN_PROUVE if "membres_equipe" in sql else None)
    with patch("app.api.admin.get_cursor", gc), patch("app.api.auth.get_cursor", gc):
        for path in ("/api/admin/stats/overview", "/api/admin/stats/reparations-par-tech",
                     "/api/admin/stats/evolution-ca", "/api/admin/reparations", "/api/admin/evolution"):
            client.get(path, headers=_headers())
    joined = " ".join(cur.sql())
    assert "date_cloture::date" not in joined and "date_cloture::timestamp >=" not in joined
    assert "date_cloture LIKE %(today_like)s" in joined


def test_admin_dates_helpers():
    from app.api.admin import _il_y_a_mois, _jour, _lendemain
    assert _lendemain("2026-02-28") == "2026-03-01"
    assert _jour("2026-10-16") == "2026-10-16"
    with pytest.raises(Exception):
        _jour("2026-13-01")
    assert len(_il_y_a_mois(12)) == 19 and _il_y_a_mois(12) < _il_y_a_mois(1)


def test_admin_date_invalide_400(client):
    _, gc = fake_db(lambda sql, params: _ADMIN_PROUVE if "membres_equipe" in sql else None)
    with patch("app.api.admin.get_cursor", gc), patch("app.api.auth.get_cursor", gc):
        r = client.get("/api/admin/stats/overview?date_start=16/10/2026", headers=_headers())
    assert r.status_code == 400


def test_ticket_client_qr_porte_le_jeton(monkeypatch):
    from app.api import print_tickets
    vus = []
    monkeypatch.setattr(print_tickets, "_qr_data_uri", lambda code, base=None, token=None: vus.append((code, token)) or "data:,")
    t = {"ticket_code": "KP-000042", "suivi_token": "JetonFictif_0123456789", "client_nom": "Fictif",
         "client_prenom": "Jean", "client_tel": "0612345678", "panne": "Écran", "date_depot": None}
    print_tickets._client_body(t, dict(print_tickets._DEFAUTS))
    assert vus == [("KP-000042", "JetonFictif_0123456789")]


# ── Routes async : SQL dans le threadpool ───────────────────────────

def test_chat_ia_recherche_client_par_cle_telephone():
    from app.api import chat
    cur, gc = fake_db(lambda sql, params: [])
    with patch("app.api.chat.get_cursor", gc):
        chat._execute_tool("search_client", {"query": "+33 6 12 34 56 78"})
        chat._execute_tool("search_client", {"query": "Du_pont"})
    (s1, p1), (s2, p2) = cur.executed
    assert "public.kp_phone_key(c.telephone) = %s" in s1 and p1 == ("612345678",)
    assert "c.nom ILIKE %s" in s2 and p2[0] == "%Du\\_pont%"


def test_upload_image_iphone(client, tmp_path, monkeypatch):
    from app.api import iphone_tarifs
    monkeypatch.setattr(iphone_tarifs, "UPLOADS_DIR", tmp_path)
    cur, gc = fake_db(lambda sql, params: {"id": 3, "slug": "iphone-12"} if sql.startswith("SELECT id, slug") else None)
    with patch("app.api.iphone_tarifs.get_cursor", gc):
        r = client.post("/api/iphone-tarifs/3/upload-image", headers=_headers(),
                        files={"file": ("photo.png", b"\x89PNG" + b"0" * 300, "image/png")})
    assert r.status_code == 200, r.text
    assert any(s.startswith("UPDATE iphone_tarifs SET image_url") for s in cur.sql())
    assert len(list(tmp_path.iterdir())) == 1


def test_check_stock_mobilax_sans_reseau(client, monkeypatch):
    from app.api import tarifs
    monkeypatch.setattr(tarifs, "_mobilax_urls", lambda marque, modele: [])
    cur, gc = fake_db(lambda sql, params: [{"id": 1, "marque": "Apple", "modele": "iPhone 12", "type_piece": "ecran",
                                            "qualite": "x", "en_stock": True}])
    with patch("app.api.tarifs.get_cursor", gc):
        # Tâche de fond (moteur de prix) : la vérification elle-même, sans réseau
        assert tarifs.verifier_stock_mobilax()["models_total"] == 1
    # La route est réservée à l'admin et lance la vérification en tâche de fond
    _, gc_role = fake_db(lambda sql, params: None)
    with patch("app.api.auth.get_cursor", gc_role):
        assert client.post("/api/tarifs/check-stock", headers=_headers()).status_code == 403
    lances = []
    monkeypatch.setattr(tarifs, "_tache_stock", lambda: lances.append(1))
    monkeypatch.setattr(tarifs, "_stock_etat", {"en_cours": False, "debut": None, "fin": None, "resultat": None})
    _, gc_admin = fake_db(lambda sql, params: _ADMIN_PROUVE if "membres_equipe" in sql else None)
    with patch("app.api.auth.get_cursor", gc_admin):
        r = client.post("/api/tarifs/check-stock", headers=_headers())
    assert r.status_code == 200 and r.json()["lance"] is True and "models_found" not in r.json() and lances == [1]


def test_marketing_enregistrer_avis():
    from app.api import marketing
    cur, gc = fake_db(lambda sql, params: None)
    with patch("app.api.marketing.get_cursor", gc):
        n = marketing._enregistrer_avis([{"author_name": "Client Fictif", "rating": 5, "text": "Top", "time": 1760000000}])
    assert n == 1 and any(s.startswith("INSERT INTO avis_google") for s in cur.sql())


def test_anti_brute_force_memoire_bornee_garde_les_verrous(monkeypatch):
    t = [0.0]
    monkeypatch.setattr(auth, "monotonic", lambda: t[0])
    abf = auth.AntiBruteForce(seuil=2, base=60, plafond=60, max_cles=3)
    abf.echec("cible")
    abf.echec("cible")  # verrouillée
    for i in range(10):
        abf.echec(f"bruit{i}")
    assert len(abf._etats) == 3 and abf.attente("cible") == 60


# ── Correctifs de la relecture ──────────────────────────────────────

def _demande_handler(sql, params):
    if sql.startswith("SELECT valeur FROM params WHERE cle = 'ADMIN_PASSWORD'"):
        return {"valeur": "adm1n"}
    if sql.startswith("SELECT nom, marque, modele, prix FROM demandes_commandes"):
        return {"nom": "Fictif", "marque": "Apple", "modele": "iPhone 12", "prix": 300}
    return None


def test_suppression_demande_partage_l_anti_brute_force(client):
    """Le code admin de la suppression de demande ne contourne plus le verrou (IP réelle)."""
    cur, gc = fake_db(_demande_handler)
    with patch("app.api.iphone_tarifs.get_cursor", gc), patch("app.api.auth.get_cursor", gc):
        codes = []
        for i in range(6):
            h = {**_headers(ip="10.2.2.2"), "X-Forwarded-For": f"9.9.9.{i}, 10.2.2.2", "X-Admin-Password": "faux"}
            codes.append(client.delete("/api/iphone-tarifs/demandes-commandes/1", headers=h).status_code)
        verify = client.post("/api/admin/verify", headers=_headers(ip="10.2.2.2"),
                             json={"login": "admin", "password": "adm1n"})
        autre = client.delete("/api/iphone-tarifs/demandes-commandes/1",
                              headers={**_headers(ip="10.2.2.3"), "X-Admin-Password": "adm1n"})
    assert codes == [403, 403, 403, 403, 429, 429]
    assert verify.status_code == 429  # verrou partagé avec /api/admin/verify
    assert autre.status_code == 200
    login = [p for s, p in cur.executed if s.startswith("INSERT INTO admin_audit_log")][0][0]
    assert login == "TestUser"


def test_suppression_demande_jeton_elevation_accepte(client):
    _, gc = fake_db(_demande_handler)
    with patch("app.api.iphone_tarifs.get_cursor", gc):
        ok = client.delete("/api/iphone-tarifs/demandes-commandes/1", headers=_headers(admin=True))
        ko = client.delete("/api/iphone-tarifs/demandes-commandes/1", headers=_headers())
    assert ok.status_code == 200
    assert ko.status_code == 403 and ko.json()["detail"]["code"] == "admin_requis"


def test_verrou_global_n_empeche_pas_la_boutique(client):
    """50 échecs répartis verrouillent le PIN pour les IP inconnues, pas pour un poste connu."""
    _, gc = fake_db(_pin_handler)
    with patch("app.api.auth.get_cursor", gc):
        # Le poste de la boutique a déjà présenté un jeton valide
        assert client.get("/api/auth/me", headers=_headers(ip="10.3.3.3")).status_code == 200
        for i in range(50):
            client.post("/api/auth/login", json={"pin": "0000", "target": "accueil"},
                        headers={"X-Forwarded-For": f"172.16.{i // 4}.{i % 4}"})
        inconnue = client.post("/api/auth/login", json={"pin": "1234", "target": "accueil"},
                               headers={"X-Forwarded-For": "172.31.0.1"})
        boutique = client.post("/api/auth/login", json={"pin": "1234", "target": "accueil"},
                               headers={"X-Forwarded-For": "6.6.6.6, 10.3.3.3"})
        # Un poste connu reste soumis à son propre compteur
        codes = [client.post("/api/auth/login", json={"pin": "0000", "target": "accueil"},
                             headers={"X-Forwarded-For": "10.3.3.3"}).status_code for _ in range(5)]
    assert inconnue.status_code == 429
    assert boutique.status_code == 200
    assert codes == [401, 401, 401, 401, 429]


def test_succes_de_connexion_rend_l_ip_connue(client):
    _, gc = fake_db(_pin_handler)
    with patch("app.api.auth.get_cursor", gc):
        assert client.post("/api/auth/login", json={"pin": "1234", "target": "accueil"},
                           headers={"X-Forwarded-For": "10.4.4.4"}).status_code == 200
    assert auth._IP_CONNUES.connue("10.4.4.4")
    assert not auth._IP_CONNUES.connue("10.4.4.5")


def _team_handler(membres):
    def handler(sql, params):
        if sql.startswith("SELECT 1 AS ok FROM membres_equipe"):
            return {"ok": 1} if params[0] in membres else None
        if sql.startswith("SELECT role FROM membres_equipe WHERE id"):
            return {"role": membres.get("__role_id_%s" % params[0])}
        if sql.startswith("INSERT INTO membres_equipe"):
            return {"id": 7}
        return None
    return handler


def test_switch_user_limite_aux_membres_actifs(client):
    _, gc = fake_db(_team_handler({"Marina": 1}))
    with patch("app.api.auth.get_cursor", gc):
        ok = client.post("/api/auth/switch-user", headers=_headers(), json={"utilisateur": " Marina "})
        generique = client.post("/api/auth/switch-user", headers=_headers(), json={"utilisateur": "Utilisateur"})
        ko = client.post("/api/auth/switch-user", headers=_headers(), json={"utilisateur": "Ancien Admin"})
    assert ok.status_code == 200 and ok.json()["utilisateur"] == "Marina"
    assert generique.status_code == 200
    assert ko.status_code == 400


def test_login_nom_inconnu_refuse(client):
    def handler(sql, params):
        if sql.startswith("SELECT 1 AS ok FROM membres_equipe"):
            return None
        return _pin_handler(sql, params)

    _, gc = fake_db(handler)
    with patch("app.api.auth.get_cursor", gc):
        ko = client.post("/api/auth/login", json={"pin": "1234", "target": "accueil", "utilisateur": "Inventé"})
        ok = client.post("/api/auth/login", json={"pin": "1234", "target": "accueil"})
    assert ko.status_code == 400
    assert ok.status_code == 200 and ok.json()["utilisateur"] == "Accueil"


def test_team_role_admin_exige_elevation(client):
    cur, gc = fake_db(_team_handler({"__role_id_3": "admin"}))
    with patch("app.api.team.get_cursor", gc):
        ko = client.post("/api/team", headers=_headers(), json={"nom": "Moi", "role": "admin"})
        ko_patch = client.patch("/api/team/4", headers=_headers(), json={"role": "Admin"})
        ko_renomme = client.patch("/api/team/3", headers=_headers(), json={"nom": "Moi"})
        ko_reactive = client.patch("/api/team/3", headers=_headers(), json={"actif": 1})
        tech = client.post("/api/team", headers=_headers(), json={"nom": "Tech", "role": "tech"})
        ok = client.post("/api/team", headers=_headers(admin=True), json={"nom": "Moi", "role": "admin"})
    for r in (ko, ko_patch, ko_renomme, ko_reactive):
        assert r.status_code == 403 and r.json()["detail"]["code"] == "admin_requis"
    assert tech.status_code == 200 and ok.status_code == 200
    assert len([s for s in cur.sql() if s.startswith(("INSERT", "UPDATE"))]) == 2


def test_code_manager_anti_brute_force(client, monkeypatch):
    from app.api import team
    monkeypatch.setattr(team, "ADMIN_CODE_MANAGER", "M4nager")
    _, gc = fake_db(_team_handler({}))
    with patch("app.api.team.get_cursor", gc):
        codes = [client.post("/api/team?admin_code=faux", headers=_headers(ip="10.5.5.5"),
                             json={"nom": "X", "role": "manager"}).status_code for _ in range(6)]
        ok = client.post("/api/team?admin_code=M4nager", headers=_headers(ip="10.5.5.6"),
                         json={"nom": "X", "role": "manager"})
    assert codes == [403, 403, 403, 403, 429, 429]
    assert ok.status_code == 200


def test_mark_read_invalide_les_interactions(client):
    etat = {"messages": [5]}

    def handler(sql, params):
        if "accord_valide" in sql:
            return {"accord": None, "accord_valide": None, "messages": etat["messages"], "avis": None}
        if sql.startswith("UPDATE notes_tickets SET is_read = TRUE"):
            etat["messages"] = None
        return None

    _, gc = fake_db(handler)
    with patch("app.api.suivi.get_cursor", gc), patch("app.api.tickets.get_cursor", gc):
        avant = client.get("/api/suivi/dashboard/interactions", headers=_headers()).json()
        assert client.put("/api/tickets/5/mark-read", headers=_headers()).status_code == 200
        apres = client.get("/api/suivi/dashboard/interactions", headers=_headers()).json()
    assert avant["messages"]["count"] == 1 and apres["messages"]["count"] == 0


def test_admin_durees_cast_tolerant_et_top_clients():
    from app.api import admin
    assert "kp_try_ts(date_cloture)" in admin._CLOTURE_TS and "::timestamp" not in admin._CLOTURE_TS


def test_top_clients_sans_colonnes_inexistantes(client):
    cur, gc = fake_db(lambda sql, params: _ADMIN_PROUVE if "membres_equipe" in sql else [])
    with patch("app.api.admin.get_cursor", gc), patch("app.api.auth.get_cursor", gc):
        r = client.get("/api/admin/stats/top-clients?date_start=2026-01-01", headers=_headers())
        bad = client.get("/api/admin/stats/top-clients?date_start=hier", headers=_headers())
    assert r.status_code == 200 and bad.status_code == 400
    joined = " ".join(cur.sql())
    assert "t.nom_client" not in joined and "t.telephone" not in joined


def test_email_notification_route_synchrone():
    import inspect
    from app.api import notifications
    assert not inspect.iscoroutinefunction(notifications.send_email_notification)


def test_jwt_secret_jamais_la_valeur_connue_en_prod(monkeypatch):
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.setenv("RAILWAY_ENVIRONMENT", "production")
    a, b = auth._jwt_secret(), auth._jwt_secret()
    assert a != auth._JWT_SECRET_DEV and a != b and len(a) >= 32
    monkeypatch.setenv("JWT_SECRET", auth._JWT_SECRET_DEV)
    assert auth._jwt_secret() != auth._JWT_SECRET_DEV
    monkeypatch.setenv("JWT_SECRET", "secret-de-test-local")
    assert auth._jwt_secret() == "secret-de-test-local"
    monkeypatch.delenv("RAILWAY_ENVIRONMENT")
    monkeypatch.delenv("JWT_SECRET")
    assert auth._jwt_secret() == auth._JWT_SECRET_DEV  # développement local uniquement


def test_limite_publique_ip_reelle(client):
    from app.api import tickets
    tickets._RATE_BUCKETS.clear()
    _, gc = fake_db(lambda sql, params: None)
    with patch("app.api.tickets.get_cursor", gc):
        codes = [client.get("/api/tickets/code/KP-000001",
                            headers={"X-Forwarded-For": f"8.8.{i}.{i}, 10.6.6.6"}).status_code for i in range(31)]
    tickets._RATE_BUCKETS.clear()
    assert codes[-1] == 429 and 429 not in codes[:30]


def test_compteur_survit_au_verrou_maximal(monkeypatch):
    """Après le verrou de 15 min, l'attaquant ne retrouve pas 5 essais neufs."""
    t = [0.0]
    monkeypatch.setattr(auth, "monotonic", lambda: t[0])
    abf = auth.AntiBruteForce(seuil=5, base=30, plafond=900, fenetre=3600)
    for _ in range(10):
        abf.echec("k")
        t[0] += abf.attente("k") + 1
    assert abf.echec("k") == 900  # toujours au plafond, pas de remise à zéro
    assert auth._ESSAIS_IP.fenetre > auth._ESSAIS_IP.plafond
