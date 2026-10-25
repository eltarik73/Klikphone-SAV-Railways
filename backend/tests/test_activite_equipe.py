"""Activité de l'équipe : journal des connexions, appareil, pointage de présence, rétention.

Unitaires : détection de l'appareil (User-Agent réels + indices client), position, horaires,
empreinte IP, suivi d'activité en mémoire.

Base réelle JETABLE (migrations du lifespan rejouées) :
    KP_EQUIPE_DATABASE_URL="postgresql://postgres:<mot_de_passe>@127.0.0.1:5432/kp_equipe?sslmode=disable" \
        pytest tests/test_activite_equipe.py
"""

import hashlib
import os
import sys
import time
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.api import auth
from app.api.auth import create_admin_token, create_token, decode_token
from app.services import presence
from app.services.presence import detecter_appareil, libelle_appareil, marque_depuis_modele

DB_URL = os.getenv("KP_EQUIPE_DATABASE_URL")

UA = {
    "iphone_safari": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 "
                     "(KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
    "iphone_ios26": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 "
                    "(KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    "iphone_chrome": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 "
                     "(KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
    "ipad_ancien": "Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 "
                   "(KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1",
    "mac_safari": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
                  "(KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    "mac_chrome": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "android_reduit": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) "
                      "Chrome/125.0.0.0 Mobile Safari/537.36",
    "samsung_complet": "Mozilla/5.0 (Linux; Android 13; SM-S918B Build/TP1A.220624.014) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36",
    "samsung_internet": "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S911B) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
    "samsung_internet_reduit": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) "
                               "SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
    "samsung_tab": "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/120.0.0.0 Safari/537.36",
    "xiaomi": "Mozilla/5.0 (Linux; Android 13; 2201117TY Build/TKQ1.221114.001) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/120.0.6099.43 Mobile Safari/537.36",
    "pixel_webview": "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UD1A.230803.041; wv) AppleWebKit/537.36 "
                     "(KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.163 Mobile Safari/537.36",
    "windows_chrome": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                      "Chrome/126.0.0.0 Safari/537.36",
    "windows_edge": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.68",
    "windows_firefox": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
    "firefox_android": "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0",
    "firefox_tablette": "Mozilla/5.0 (Android 13; Tablet; rv:127.0) Gecko/127.0 Firefox/127.0",
    "chromebook": "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/126.0.0.0 Safari/537.36",
}


def _a(ua, indices=None):
    return detecter_appareil(UA.get(ua, ua), indices)


# ═══ Détection de l'appareil ══════════════════════════════════════

def test_iphone_safari():
    assert _a("iphone_safari") == {"type": "iphone", "marque": "Apple", "modele": None,
                                   "systeme": "iOS 18", "navigateur": "Safari"}


def test_iphone_ios26_version_figee_dans_os():
    assert _a("iphone_ios26")["systeme"] == "iOS 26"


def test_iphone_chrome_modele_jamais_invente():
    a = _a("iphone_chrome", {"type": "iphone", "modele": "iPhone 15 Pro"})
    assert a == {"type": "iphone", "marque": "Apple", "modele": None, "systeme": "iOS 17", "navigateur": "Chrome"}


def test_ipad_ipados_se_presente_comme_un_mac():
    sans_indice = _a("mac_safari")
    assert sans_indice["type"] == "ordinateur" and sans_indice["marque"] == "Apple"
    a = _a("mac_safari", {"type": "ipad", "marque": "Apple", "systeme": "iOS 17"})
    assert a == {"type": "ipad", "marque": "Apple", "modele": None, "systeme": "iPadOS 17", "navigateur": "Safari"}
    # Indice sans système : version de Safari
    assert _a("mac_safari", {"type": "ipad"})["systeme"] == "iPadOS 17"
    assert _a("ipad_ancien")["type"] == "ipad" and _a("ipad_ancien")["systeme"] == "iPadOS 12"


def test_mac_safari_et_chrome():
    assert _a("mac_safari") == {"type": "ordinateur", "marque": "Apple", "modele": None,
                                "systeme": "macOS", "navigateur": "Safari"}
    assert _a("mac_chrome", {"systeme": "macOS 15"})["systeme"] == "macOS 15"
    assert _a("mac_chrome")["navigateur"] == "Chrome"


def test_samsung_chrome_sans_client_hints():
    # UA réduit de Chrome : « Android 10; K » figé, ni version ni modèle
    assert _a("android_reduit") == {"type": "smartphone", "marque": None, "modele": None,
                                    "systeme": "Android", "navigateur": "Chrome"}


def test_samsung_chrome_avec_client_hints():
    a = _a("android_reduit", {"type": "smartphone", "modele": "SM-S918B", "systeme": "Android 14",
                              "navigateur": "Chrome"})
    assert a == {"type": "smartphone", "marque": "Samsung", "modele": "SM-S918B",
                 "systeme": "Android 14", "navigateur": "Chrome"}
    assert presence.nom_commercial(a["modele"]) == "Galaxy S23 Ultra"
    assert libelle_appareil(a) == "Smartphone · Samsung SM-S918B · Android 14"


def test_samsung_ua_complet():
    a = _a("samsung_complet")
    assert (a["marque"], a["modele"], a["systeme"]) == ("Samsung", "SM-S918B", "Android 13")


def test_samsung_internet():
    a = _a("samsung_internet")
    assert a == {"type": "smartphone", "marque": "Samsung", "modele": "SM-S911B", "systeme": "Android 14",
                 "navigateur": "Samsung Internet"}
    r = _a("samsung_internet_reduit")
    assert r["marque"] == "Samsung" and r["modele"] is None and r["navigateur"] == "Samsung Internet"


def test_samsung_tablette():
    a = _a("samsung_tab")
    assert a["type"] == "tablette" and a["marque"] == "Samsung" and a["modele"] == "SM-X700"


def test_pixel_et_xiaomi():
    p = _a("pixel_webview")
    assert (p["type"], p["marque"], p["modele"], p["systeme"]) == ("smartphone", "Google", "Pixel 8", "Android 14")
    p2 = _a("android_reduit", {"modele": "Pixel 8", "systeme": "Android 15", "type": "smartphone"})
    assert (p2["marque"], p2["modele"], p2["systeme"]) == ("Google", "Pixel 8", "Android 15")
    x = _a("xiaomi")
    assert (x["marque"], x["modele"]) == ("Xiaomi", "2201117TY")
    r = _a("android_reduit", {"modele": "Redmi Note 12", "type": "smartphone"})
    assert r["marque"] == "Xiaomi"


def test_windows_chrome_edge_firefox():
    w = _a("windows_chrome")
    assert w == {"type": "ordinateur", "marque": None, "modele": None, "systeme": "Windows", "navigateur": "Chrome"}
    assert libelle_appareil(w) == "Ordinateur · PC Windows · Chrome"
    assert _a("windows_edge")["navigateur"] == "Edge"
    assert _a("windows_firefox")["navigateur"] == "Firefox"
    # Windows 11 par les Client Hints ; une marque de PC annoncée par le client n'est pas crue
    w11 = _a("windows_chrome", {"systeme": "Windows 11", "marque": "Dell", "modele": "XPS 13"})
    assert (w11["systeme"], w11["marque"], w11["modele"]) == ("Windows 11", None, None)


def test_firefox_android():
    a = _a("firefox_android")
    assert a == {"type": "smartphone", "marque": None, "modele": None, "systeme": "Android 14", "navigateur": "Firefox"}
    t = _a("firefox_tablette")
    assert t["type"] == "tablette" and t["modele"] is None


def test_chromebook():
    a = _a("chromebook")
    assert (a["type"], a["systeme"], a["marque"]) == ("ordinateur", "ChromeOS", None)


def test_indice_client_incoherent_ignore():
    a = _a("windows_chrome", {"type": "iphone", "marque": "Apple", "systeme": "iOS 18", "navigateur": "Safari"})
    assert a == {"type": "ordinateur", "marque": None, "modele": None, "systeme": "Windows", "navigateur": "Chrome"}
    i = _a("iphone_safari", {"type": "smartphone", "systeme": "Android 14", "marque": "Samsung", "modele": "SM-S918B"})
    assert i == {"type": "iphone", "marque": "Apple", "modele": None, "systeme": "iOS 18", "navigateur": "Safari"}


def test_indice_client_nettoye_et_borne():
    a = _a("android_reduit", {"type": "<script>", "modele": "<b>SM-A556B</b>" + "x" * 300,
                              "marque": "Evil'); DROP", "systeme": "Android 14; rm -rf", "navigateur": "Netscape"})
    assert a["type"] == "smartphone"
    assert a["modele"] and len(a["modele"]) <= 40 and "<" not in a["modele"]
    assert a["marque"] is None or a["marque"] in presence.MARQUES
    assert a["systeme"] == "Android" and a["navigateur"] == "Chrome"
    assert detecter_appareil(None, "pas un objet")["type"] == "inconnu"
    assert detecter_appareil("", {"type": "tablette"})["type"] == "tablette"
    assert detecter_appareil("x" * 10000, None)["type"] == "inconnu"


@pytest.mark.parametrize("modele,marque", [
    ("SM-A556B", "Samsung"), ("Pixel 7a", "Google"), ("M2101K6G", "Xiaomi"), ("23049PCD8G", "Xiaomi"),
    ("CPH2581", "Oppo"), ("RMX3710", "Realme"), ("XT2303-2", "Motorola"), ("XQ-DQ54", "Sony"),
    ("TB-X606F", "Lenovo"), ("ABC123", None), ("K", None), (None, None), ("", None),
])
def test_marque_depuis_modele(modele, marque):
    assert marque_depuis_modele(modele) == marque


def test_libelles():
    assert libelle_appareil(_a("iphone_safari")) == "iPhone · Apple · iOS 18"
    assert libelle_appareil(_a("mac_safari")) == "Ordinateur · Apple Mac · Safari"
    assert libelle_appareil({}) == "Appareil inconnu"


# ═══ Position, horaires, empreinte ════════════════════════════════

def test_haversine_et_arrondi():
    d = presence.haversine_m(45.5656, 5.9215, 45.5656 + 0.001, 5.9215)
    assert 110 < d < 112
    assert 450_000 < presence.haversine_m(45.5656, 5.9215, 48.8566, 2.3522) < 500_000
    assert presence.arrondi_distance(124) == 100 and presence.arrondi_distance(126) == 150
    assert presence.arrondi_distance(2330) == 2350


def test_statut_position():
    assert presence.statut_position(100, 30, 150) == "en_boutique"
    assert presence.statut_position(10, 150, 150) == "en_boutique"
    # « hors_boutique » seulement si tout le cercle de précision est hors du rayon
    assert presence.statut_position(181, 30, 150) == "hors_boutique"
    assert presence.statut_position(151, 30, 150) == "imprecise"
    assert presence.statut_position(200, 100, 150) == "imprecise"
    assert presence.statut_position(200, 300, 150) == "imprecise"      # poste à 200 m, ± 300 m
    assert presence.statut_position(5000, 200, 150) == "hors_boutique"
    # Précision au-delà de 200 m : aucune conclusion, même loin (PC localisé par son adresse réseau)
    assert presence.statut_position(10, 201, 1000) == "imprecise"
    assert presence.statut_position(100_000, 5000, 150) == "imprecise"
    # « en_boutique » : précision ≤ max(rayon, 150 m)
    assert presence.statut_position(10, 151, 150) == "imprecise"
    assert presence.statut_position(250, 200, 300) == "en_boutique"


def test_coordonnees_et_precision():
    assert presence.coordonnees_valides(45.5, 5.9)
    for lat, lng in ((91, 0), (0, 181), ("x", 0), (None, 0), (float("nan"), 0), (True, 0), (0, float("inf"))):
        assert not presence.coordonnees_valides(lat, lng)
    assert presence.precision_valide(12.6) == 13
    assert presence.precision_valide(-1) is None and presence.precision_valide("abc") is None
    assert presence.precision_valide(True) is None and presence.precision_valide(float("nan")) is None


@pytest.mark.parametrize("utc,attendu", [
    (datetime(2026, 10, 19, 7, 59), False),   # lundi 09:59 Paris (UTC+2)
    (datetime(2026, 10, 19, 8, 0), True),     # lundi 10:00
    (datetime(2026, 10, 19, 16, 59), True),   # lundi 18:59
    (datetime(2026, 10, 19, 17, 0), False),   # lundi 19:00
    (datetime(2026, 10, 24, 12, 0), True),    # samedi 14:00
    (datetime(2026, 10, 25, 12, 0), False),   # dimanche
    (datetime(2026, 11, 2, 9, 0), True),      # lundi 10:00 Paris (UTC+1, heure d'hiver)
    (datetime(2026, 11, 2, 8, 59), False),    # lundi 09:59 Paris
])
def test_horaires_paris(utc, attendu):
    assert presence.dans_horaires(utc) is attendu


def test_paris_vers_utc_changement_d_heure():
    assert presence.paris_vers_utc(datetime(2026, 10, 19)) == datetime(2026, 10, 18, 22, 0)
    assert presence.paris_vers_utc(datetime(2026, 10, 26)) == datetime(2026, 10, 25, 23, 0)
    assert presence.lundi(date(2026, 10, 25)) == date(2026, 10, 19)


def test_empreinte_ip():
    e = presence.empreinte_ip("203.0.113.7")
    assert len(e) == 16 and int(e, 16) >= 0 and "203" not in e
    assert e == presence.empreinte_ip("203.0.113.7") != presence.empreinte_ip("203.0.113.8")
    assert presence.empreinte_ip("") == ""


def test_nettoyer_poste():
    assert presence.nettoyer_poste("  Comptoir   1 ") == "Comptoir 1"
    assert len(presence.nettoyer_poste("A" * 200)) == 60
    assert presence.nettoyer_poste({"x": 1}) is None and presence.nettoyer_poste("") is None
    assert presence.nettoyer_poste("Atelier\x00\n") == "Atelier"


# ═══ Suivi d'activité (mémoire) ═══════════════════════════════════

class _Req:
    def __init__(self, user, path="/api/tickets", method="GET", headers=None):
        self.scope = {"state": {"kp_user": user}} if user else {}
        self.method = method
        self.headers = headers or {}
        self.client = None

        class U:
            pass
        self.url = U()
        self.url.path = path


def test_noter_requete_compte_ecritures_et_ignore_le_fond(monkeypatch):
    suivi = presence.SuiviActivite()
    monkeypatch.setattr(presence, "SUIVI", suivi)
    monkeypatch.setenv("KP_ACTIVITE_AUTO", "0")
    u = {"sub": "Alice", "sid": "s1", "cx": 7, "target": "accueil"}
    presence.noter_requete(_Req(u), 200)
    presence.noter_requete(_Req(u, method="POST"), 201)
    presence.noter_requete(_Req(u, method="PATCH"), 200)
    presence.noter_requete(_Req(u, method="POST"), 400)           # écriture refusée : pas une action
    presence.noter_requete(_Req(u, headers={"x-kp-fond": "1"}), 200)
    presence.noter_requete(_Req(u, path="/api/auth/logout", method="POST"), 200)
    presence.noter_requete(_Req(u, path="/api/equipe/position", method="POST"), 200)
    presence.noter_requete(_Req(None), 200)
    lot = suivi.prendre()
    assert list(lot) == [("cx", 7)] and lot[("cx", 7)]["n"] == 2


def test_suivi_remet_l_activite_si_l_ecriture_echoue(monkeypatch):
    suivi = presence.SuiviActivite()
    suivi.noter({"sub": "A", "sid": "s", "target": "tech"}, True)

    def panne(lot, s):
        raise RuntimeError("base indisponible")

    monkeypatch.setattr(presence, "_ecrire_activite", panne)
    with pytest.raises(RuntimeError):
        suivi.vider()
    assert suivi.prendre()[("sid", "s", "A")]["n"] == 1


# ═══ Base réelle ══════════════════════════════════════════════════

ADMIN, ALICE, BRUNO = "Gérant Équipe", "Alice Équipe", "Bruno Équipe"
ROBOT, CHLOE = "Robot Équipe", "Chloé Équipe"
SID_ADMIN = "sid-gerant-equipe"


@pytest.fixture(scope="module")
def reel():
    if not DB_URL:
        pytest.skip("KP_EQUIPE_DATABASE_URL non définie (base PostgreSQL de test jetable)")
    import psycopg2.extras
    import psycopg2.pool
    import app.database

    pool = psycopg2.pool.ThreadedConnectionPool(1, 8, DB_URL)

    @contextmanager
    def vrai_cursor(dict_cursor=True):
        conn = pool.getconn()
        try:
            factory = psycopg2.extras.RealDictCursor if dict_cursor else None
            with conn.cursor(cursor_factory=factory) as cur:
                yield cur
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            pool.putconn(conn)

    mp = pytest.MonkeyPatch()
    mp.setenv("KP_ACTIVITE_AUTO", "0")
    mp.setenv("KP_RETENTION_AUTO", "0")
    mp.setattr(app.database, "get_cursor", vrai_cursor)
    for nom, mod in list(sys.modules.items()):
        if nom.startswith("app.") and mod is not app.database and getattr(mod, "get_cursor", None) is not None:
            mp.setattr(mod, "get_cursor", vrai_cursor)
    mp.setattr(presence, "SUIVI", presence.SuiviActivite())
    from app.main import app as fastapi_app
    try:
        with TestClient(fastapi_app) as c:   # lifespan : schéma + migrations
            _sql_cur(vrai_cursor, "DELETE FROM membres_equipe WHERE nom = ANY(%s)", [ADMIN, ALICE, BRUNO, ROBOT, CHLOE])
            _sql_cur(vrai_cursor, "INSERT INTO membres_equipe (nom, role, couleur, actif) VALUES "
                                  "(%s, 'admin', '#7C3AED', 1), (%s, 'Accueil', '#0EA5E9', 1), "
                                  "(%s, 'Technicien', '#F59E0B', 1), (%s, 'Bot SAV', '#7C3AED', 1)",
                     ADMIN, ALICE, BRUNO, ROBOT)
            _sql_cur(vrai_cursor, "INSERT INTO params (cle, valeur) VALUES ('PIN_ACCUEIL', '2468') "
                                  "ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur")
            _sql_cur(vrai_cursor, "INSERT INTO sessions_admin (sid, origine, expire) VALUES "
                                  "(%s, 'code', NOW() + INTERVAL '30 days') ON CONFLICT (sid) DO UPDATE "
                                  "SET expire = EXCLUDED.expire", SID_ADMIN)
            yield {"c": c, "cur": vrai_cursor}
    finally:
        mp.undo()
        auth.oublier_roles_admin()
        pool.closeall()


def _sql_cur(cur_fn, sql, *params):
    with cur_fn() as cur:
        cur.execute(sql, params or None)
        return cur.fetchall() if cur.description else None


def _sql(reel, sql, *params):
    return _sql_cur(reel["cur"], sql, *params)


@pytest.fixture
def propre(reel):
    """Journal, réglages et traces remis à zéro avant chaque test."""
    _sql(reel, "DELETE FROM connexions_equipe")
    _sql(reel, "DELETE FROM admin_audit_log WHERE target_type = 'equipe'")
    _sql(reel, "DELETE FROM params WHERE cle = ANY(%s) OR cle LIKE 'GEO\\_%%'", list(presence.PARAMS))
    _sql(reel, "DELETE FROM equipe_notes_remises")
    _sql(reel, "DELETE FROM membres_equipe WHERE nom = %s", CHLOE)
    _sql(reel, "DELETE FROM tickets WHERE cree_par = ANY(%s)", [ALICE, BRUNO])
    from app.services import params as params_cache
    params_cache.invalidate()
    presence.SUIVI.reset()
    auth.reset_essais()
    from app.api import equipe
    equipe._TRACES_RECENTES.clear()
    yield reel
    presence.SUIVI.reset()


def _h(user, sid="poste-x", cx=None, ua=None, **extra):
    h = {"Authorization": f"Bearer {create_token('accueil', user, sid=sid, cx=cx)}"}
    if ua:
        h["User-Agent"] = UA.get(ua, ua)
    h.update(extra)
    return h


def _admin_sans_code():
    """Gérant (rôle admin, preuve de 30 jours sur ce poste) sans code saisi récemment."""
    return _h(ADMIN, sid=SID_ADMIN)


def _admin():
    """Gérant avec le code admin saisi il y a moins de 10 min (jeton d'élévation)."""
    return {**_admin_sans_code(), "X-Admin-Token": create_admin_token({"sub": ADMIN, "target": "accueil", "sid": SID_ADMIN})}


def _login(c, user, ua="iphone_safari", appareil=None, poste="Comptoir", headers=None):
    h = {"User-Agent": UA[ua], **(headers or {})}
    r = c.post("/api/auth/login", json={"pin": "2468", "target": "accueil", "utilisateur": user,
                                        "poste": poste, "appareil": appareil}, headers=h)
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    return tok, decode_token(tok)


def _lignes(reel, user=None):
    if user:
        return _sql(reel, "SELECT * FROM connexions_equipe WHERE utilisateur = %s ORDER BY id", user)
    return _sql(reel, "SELECT * FROM connexions_equipe ORDER BY id")


def test_reel_login_switch_logout(propre):
    c = propre["c"]
    tok, p = _login(c, ALICE, "android_reduit", {"type": "smartphone", "modele": "SM-S918B",
                                                 "systeme": "Android 14"}, poste="  Comptoir  ")
    assert isinstance(p.get("cx"), int)
    (l,) = _lignes(propre)
    assert (l["id"], l["sid"], l["utilisateur"], l["cible"], l["poste"]) == (p["cx"], p["sid"], ALICE, "accueil", "Comptoir")
    assert (l["appareil_type"], l["appareil_marque"], l["appareil_modele"], l["systeme"], l["navigateur"]) == \
        ("smartphone", "Samsung", "SM-S918B", "Android 14", "Chrome")
    assert len(l["ip_empreinte"]) == 16 and l["fin"] is None
    # Changement d'utilisateur : même lignée, ancienne session close « changement »
    r = c.post("/api/auth/switch-user", json={"utilisateur": BRUNO}, headers={"Authorization": f"Bearer {tok}",
                                                                              "User-Agent": UA["android_reduit"]})
    assert r.status_code == 200
    p2 = decode_token(r.json()["access_token"])
    a, b = _lignes(propre)
    assert a["fin_motif"] == "changement" and a["fin"] is not None
    assert b["utilisateur"] == BRUNO and b["sid"] == p["sid"] and b["id"] == p2["cx"] and b["fin"] is None
    # Vers soi-même : pas de nouvelle ligne
    r = c.post("/api/auth/switch-user", json={"utilisateur": BRUNO},
               headers={"Authorization": f"Bearer {r.json()['access_token']}"})
    assert r.status_code == 200 and len(_lignes(propre)) == 2
    # Déconnexion
    r = c.post("/api/auth/logout", headers={"Authorization": f"Bearer {r.json()['access_token']}"})
    assert r.status_code == 200 and r.json()["session_close"] is True
    assert _lignes(propre)[1]["fin_motif"] == "deconnexion"


def test_reel_login_ferme_la_session_precedente_du_navigateur(propre):
    c = propre["c"]
    tok, p = _login(c, ALICE, "windows_chrome")
    _login(c, BRUNO, "windows_chrome", headers={"Authorization": f"Bearer {tok}"})
    a, b = _lignes(propre)
    assert a["fin_motif"] == "changement" and b["fin"] is None and b["sid"] != a["sid"]
    assert (b["appareil_type"], b["appareil_marque"], b["systeme"]) == ("ordinateur", None, "Windows")


def test_reel_activite_une_ecriture_par_periode(propre):
    c = propre["c"]
    tok, p = _login(c, ALICE, "mac_safari")
    h = {"Authorization": f"Bearer {tok}"}
    suivi = presence.SUIVI
    avant = suivi.ecritures
    for _ in range(25):
        c.get("/api/auth/me", headers=h)              # /api/auth/ : ignoré
        c.get("/api/team", headers=h)
    for _ in range(3):
        assert c.put("/api/config", json={"cle": "kp_test_equipe", "valeur": "1"}, headers=h).status_code == 200
    c.post("/api/config/inexistant", headers=h)      # écriture refusée : pas une action
    c.get("/api/team", headers={**h, "X-KP-Fond": "1"})
    assert suivi.ecritures == avant                  # rien en base pendant la rafale
    assert presence.vider_activite() == 1
    assert suivi.ecritures == avant + 1              # une seule requête UPDATE
    (l,) = _lignes(propre)
    assert l["actions"] == 3 and l["derniere_activite"] >= l["debut"]
    assert presence.vider_activite() == 0 and suivi.ecritures == avant + 1


def test_reel_reprise_jeton_ancien_et_session_expiree(propre):
    c = propre["c"]
    # Jeton antérieur au journal (pas de cx, aucune ligne) : une ligne est ouverte à l'usage
    h = _h(BRUNO, sid="ancien-poste", ua="windows_edge")
    c.get("/api/team", headers=h)
    presence.vider_activite()
    (l,) = _lignes(propre)
    assert (l["utilisateur"], l["sid"], l["navigateur"], l["fin"]) == (BRUNO, "ancien-poste", "Edge", None)
    # Inactive depuis 13 h : close « expiree » (fin = dernière activité), nouvelle ligne à l'usage
    _sql(propre, "UPDATE connexions_equipe SET debut = debut - INTERVAL '14 hours', "
                 "derniere_activite = derniere_activite - INTERVAL '13 hours' WHERE id = %s", l["id"])
    c.get("/api/team", headers=h)
    presence.vider_activite()
    a, b = _lignes(propre)
    assert a["fin_motif"] == "expiree" and a["fin"] == a["derniere_activite"]
    assert b["fin"] is None and b["navigateur"] == "Edge"
    # Session close par une déconnexion : jamais reprise
    c.post("/api/auth/logout", headers=h)
    c.get("/api/team", headers=h)
    presence.vider_activite()
    assert len(_lignes(propre)) == 2


def test_reel_deconnexion_apres_une_nuit_d_inactivite_revoque_le_jeton(propre):
    """Audit F(1) : la ligne du jeton (cx) est close « expiree » par la rétention horaire après 12 h
    sans activité, l'activité reprend sur une nouvelle ligne de la même lignée ; la déconnexion (ou
    le changement d'utilisateur) clôt cette nouvelle ligne et le jeton de 30 jours doit être refusé."""
    c = propre["c"]
    tok, p = _login(c, ALICE)
    h = {"Authorization": f"Bearer {tok}"}
    assert c.get("/api/team", headers=h).status_code == 200
    presence.vider_activite()                     # activité écrite avant de vieillir la ligne
    _sql(propre, "UPDATE connexions_equipe SET debut = debut - INTERVAL '14 hours', "
                 "derniere_activite = derniere_activite - INTERVAL '13 hours' WHERE id = %s", p["cx"])
    assert presence.retention_connexions()["sessions_expirees"] == 1
    auth.oublier_sessions()
    # « expiree » seule : le jeton reste valable, l'activité reprend sur une nouvelle ligne
    assert c.get("/api/team", headers=h).status_code == 200
    presence.vider_activite()
    a, b = _lignes(propre)
    assert a["id"] == p["cx"] and a["fin_motif"] == "expiree" and b["fin"] is None and b["sid"] == p["sid"]
    # Déconnexion : c'est la nouvelle ligne qui est close ; le jeton (cx = ancienne ligne) est refusé
    r = c.post("/api/auth/logout", headers=h)
    assert r.status_code == 200 and r.json()["session_close"] is True
    assert _lignes(propre)[1]["fin_motif"] == "deconnexion"
    r = c.get("/api/auth/me", headers=h)
    assert r.status_code == 401 and "reconnectez" in r.json()["detail"].lower()
    # Même chose avec un changement d'utilisateur
    tok2, p2 = _login(c, ALICE)
    h2 = {"Authorization": f"Bearer {tok2}"}
    c.get("/api/team", headers=h2)
    presence.vider_activite()
    _sql(propre, "UPDATE connexions_equipe SET debut = debut - INTERVAL '14 hours', "
                 "derniere_activite = derniere_activite - INTERVAL '13 hours' WHERE id = %s", p2["cx"])
    presence.retention_connexions()
    auth.oublier_sessions()
    assert c.get("/api/team", headers=h2).status_code == 200
    presence.vider_activite()
    r = c.post("/api/auth/switch-user", json={"utilisateur": BRUNO}, headers=h2)
    assert r.status_code == 200
    assert c.get("/api/auth/me", headers=h2).status_code == 401
    assert c.get("/api/auth/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"}).status_code == 200


def test_reel_verrouillage_admin_survit_a_un_redemarrage(propre):
    """Audit F(2) : la révocation du jeton d'élévation est écrite dans revocations_admin ; mémoire
    vidée (redémarrage), le jeton émis avant le verrouillage reste refusé."""
    c = propre["c"]
    sid = "sid-essai-revocation"
    _sql(propre, "DELETE FROM revocations_admin WHERE sid = %s", sid)
    auth.oublier_revocations()
    h = {**_h(ADMIN, sid=sid), "X-Admin-Token": create_admin_token({"sub": ADMIN, "target": "accueil", "sid": sid})}
    try:
        assert c.delete("/api/tickets/999999", headers=h).status_code == 200
        assert c.post("/api/admin/lock", headers=h).status_code == 200
        (l,) = _sql(propre, "SELECT revoque_epoch, revoque_le FROM revocations_admin WHERE sid = %s", sid)
        assert abs(l["revoque_epoch"] - time.time()) < 60 and l["revoque_le"] is not None
        r = c.delete("/api/tickets/999999", headers=h)
        assert r.status_code == 403 and r.json()["detail"]["code"] == "admin_expire"
        auth.oublier_revocations()                    # redémarrage : la base garde la révocation
        r = c.delete("/api/tickets/999999", headers=h)
        assert r.status_code == 403 and r.json()["detail"]["code"] == "admin_expire"
        # Nouvelle élévation : acceptée ; un second verrouillage ne recule jamais l'horodatage
        neuf = {**h, "X-Admin-Token": create_admin_token({"sub": ADMIN, "target": "accueil", "sid": sid})}
        assert c.delete("/api/tickets/999999", headers=neuf).status_code == 200
        assert c.post("/api/admin/lock", headers=neuf).status_code == 200
        (l2,) = _sql(propre, "SELECT revoque_epoch FROM revocations_admin WHERE sid = %s", sid)
        assert l2["revoque_epoch"] > l["revoque_epoch"]
    finally:
        _sql(propre, "DELETE FROM revocations_admin WHERE sid = %s", sid)
        auth.oublier_revocations()


def _activer(reel, monkeypatch, horaires=True):
    c = reel["c"]
    r = c.post("/api/equipe/reglages/position-boutique", json={"lat": 45.5656, "lng": 5.9215, "precision_m": 20},
               headers=_admin())
    assert r.status_code == 200, r.text
    assert c.post("/api/equipe/reglages/information-remise", headers=_admin()).status_code == 200
    r = c.put("/api/equipe/reglages", json={"pointage_actif": True}, headers=_admin())
    assert r.status_code == 200 and r.json()["pointage_actif"] is True, r.text
    monkeypatch.setattr(presence, "dans_horaires", lambda u=None: horaires)


LAT_TEST, LNG_TEST = 45.566071, 5.921893   # ~ 55 m de la position par défaut


def test_reel_pointage_inactif_par_defaut_et_activation_conditionnee(propre, monkeypatch):
    c = propre["c"]
    monkeypatch.setattr(presence, "dans_horaires", lambda u=None: True)
    tok, _ = _login(c, ALICE)
    h = {"Authorization": f"Bearer {tok}"}
    assert c.get("/api/equipe/position/config", headers=h).json() == {"actif": False}
    r = c.post("/api/equipe/position", json={"lat": LAT_TEST, "lng": LNG_TEST, "precision_m": 20}, headers=h)
    assert r.status_code == 409
    # Activation refusée tant que la note n'est remise à personne
    r = c.put("/api/equipe/reglages", json={"pointage_actif": True}, headers=_admin())
    assert r.status_code == 409 and "L1222-4" in r.json()["detail"]
    g = c.get("/api/equipe/reglages", headers=_admin()).json()
    assert g["pointage_actif"] is False and g["information_remise_le"] is None and g["information_remise"] is False
    assert "L1222-4" in g["pointage_blocage"]
    assert g["boutique_position_confirmee"] is False and g["rayon_m"] == 150
    assert g["conservation"] == {"position_jours": 60, "journal_jours": 183, "traces_jours": 365}
    noms = [x["utilisateur"] for x in g["remises"]]
    assert {ADMIN, ALICE, BRUNO} <= set(noms) and ROBOT not in noms
    assert {ADMIN, ALICE, BRUNO} <= set(g["membres_sans_note"]) and not any(x["a_jour"] for x in g["remises"])
    # Le rayon fait partie de la note : le changer change sa version
    r = c.put("/api/equipe/reglages", json={"rayon_m": 200}, headers=_admin())
    assert r.status_code == 200 and r.json()["rayon_m"] == 200 and r.json()["note_version"] != g["note_version"]
    assert "200 m" in r.json()["texte_note"]
    r = c.post("/api/equipe/reglages/information-remise", headers=_admin())
    assert r.status_code == 200
    g = r.json()
    assert all(x["a_jour"] for x in g["remises"]) and g["membres_sans_note"] == [] and g["information_remise"] is True
    assert g["information_remise_par"] == ADMIN and g["information_remise_le"].endswith("Z")
    # Activation refusée tant que la position de la boutique n'est pas confirmée (position par défaut)
    r = c.put("/api/equipe/reglages", json={"pointage_actif": True}, headers=_admin())
    assert r.status_code == 409 and "position de la boutique" in r.json()["detail"]
    assert c.get("/api/equipe/position/config", headers=h).json() == {"actif": False}
    r = c.post("/api/equipe/reglages/position-boutique", json={"lat": 45.5656, "lng": 5.9215, "precision_m": 15},
               headers=_admin())
    assert r.status_code == 200 and r.json()["pointage_blocage"] is None and r.json()["pointage_actif"] is False
    r = c.put("/api/equipe/reglages", json={"pointage_actif": True}, headers=_admin())
    assert r.status_code == 200 and r.json()["pointage_actif"] is True
    assert c.get("/api/equipe/position/config", headers=h).json() == {"actif": True}
    assert c.put("/api/equipe/reglages", json={"rayon_m": 20}, headers=_admin()).status_code == 422
    actions = {x["action"] for x in _sql(propre, "SELECT action FROM admin_audit_log WHERE target_type = 'equipe'")}
    assert {"equipe_note_remise", "equipe_pointage_active", "equipe_rayon_modifie", "equipe_position_boutique"} <= actions
    # Désactivation
    r = c.put("/api/equipe/reglages", json={"pointage_actif": False}, headers=_admin())
    assert r.status_code == 200 and r.json()["pointage_actif"] is False
    assert c.get("/api/equipe/position/config", headers=h).json() == {"actif": False}


def test_reel_note_information_exacte(propre):
    """La note annonce tout ce que la page admin montre (heures, durées, totaux, actions) et rien de faux."""
    g = propre["c"].get("/api/equipe/reglages", headers=_admin()).json()
    t = g["texte_note"]
    for mot in ("modèle", "jamais enregistrée", "refuser", "CNIL", "CSE", "intérêt légitime", "gérant",
                "suivi indicatif des jours et heures de connexion", "durée de connexion par jour et par semaine",
                "décompte légal du temps de travail", "aucune sanction", "changement d'utilisateur",
                "immédiatement oubliée", "jour de repos", "code administrateur", "Railway", "Supabase",
                "hors de l'Union européenne", "12 mois", "jamais « hors boutique »",
                "ne concerne que les salariés à qui cette note a été remise"):
        assert mot.lower() in t.lower(), mot
    for faux in ("productivité", "gérant uniquement", "moins de 11 salariés", "aucune autre fin",
                 "une seule vérification, au moment de la connexion"):
        assert faux.lower() not in t.lower(), faux
    assert g["note"]["sections"] and g["note"]["titre"].startswith("Note d'information")
    assert len(g["note_version"]) == 12


def test_reel_note_remise_par_salarie_et_par_version(propre, monkeypatch):
    c = propre["c"]
    _activer(propre, monkeypatch)
    _sql(propre, "INSERT INTO membres_equipe (nom, role, couleur, actif) VALUES (%s, 'Accueil', '#10B981', 1)", CHLOE)
    tok_a, _ = _login(c, ALICE)
    tok_c, _ = _login(c, CHLOE)
    ha, hc = {"Authorization": f"Bearer {tok_a}"}, {"Authorization": f"Bearer {tok_c}"}
    # Embauchée après la remise : jamais géolocalisée tant que la note ne lui est pas remise
    assert c.get("/api/equipe/position/config", headers=ha).json() == {"actif": True}
    assert c.get("/api/equipe/position/config", headers=hc).json() == {"actif": False}
    assert c.post("/api/equipe/position", json={"refus": True}, headers=hc).status_code == 409
    g = c.get("/api/equipe/reglages", headers=_admin()).json()
    assert g["membres_sans_note"] == [CHLOE] and g["information_remise"] is False and g["pointage_actif"] is True
    d = c.get("/api/equipe/activite", headers=_admin()).json()
    assert d["membres_sans_note"] == [CHLOE] and d["information_remise"] is False and d["pointage_actif"] is True
    # Remise à elle seule, puis retrait
    r = c.post("/api/equipe/reglages/information-remise", json={"membres": [CHLOE]}, headers=_admin())
    assert r.status_code == 200 and r.json()["membres_sans_note"] == []
    assert c.get("/api/equipe/position/config", headers=hc).json() == {"actif": True}
    r = c.post("/api/equipe/reglages/information-remise", json={"retirer": [CHLOE]}, headers=_admin())
    assert r.status_code == 200 and r.json()["membres_sans_note"] == [CHLOE]
    assert c.get("/api/equipe/position/config", headers=hc).json() == {"actif": False}
    for corps in ({"membres": ["Inconnu Équipe"]}, {"membres": [ROBOT]}, {"membres": [CHLOE], "retirer": [CHLOE]}):
        assert c.post("/api/equipe/reglages/information-remise", json=corps, headers=_admin()).status_code == 400
    # Note modifiée (rayon) : plus personne n'est à jour, le pointage s'arrête jusqu'à la nouvelle remise
    r = c.put("/api/equipe/reglages", json={"rayon_m": 300}, headers=_admin())
    assert r.status_code == 200 and r.json()["pointage_actif"] is False and "L1222-4" in r.json()["pointage_blocage"]
    assert r.json()["pointage_interrupteur"] is True          # suspendu, pas désactivé
    assert not any(x["a_jour"] for x in r.json()["remises"])
    assert c.get("/api/equipe/position/config", headers=ha).json() == {"actif": False}
    assert c.post("/api/equipe/position", json={"refus": True}, headers=ha).status_code == 409
    assert c.put("/api/equipe/reglages", json={"pointage_actif": True}, headers=_admin()).status_code == 409
    r = c.post("/api/equipe/reglages/information-remise", json={"membres": [ALICE]}, headers=_admin())
    assert r.status_code == 200 and r.json()["pointage_actif"] is True
    assert c.get("/api/equipe/position/config", headers=ha).json() == {"actif": True}
    assert c.post("/api/equipe/position", json={"refus": True}, headers=ha).status_code == 200
    details = [x["details"] for x in _sql(propre, "SELECT details FROM admin_audit_log WHERE action = "
                                                  "'equipe_note_remise' ORDER BY id")]
    assert details[-1].endswith(f"membres={ALICE}") and details[-1].startswith("version=")
    assert _sql(propre, "SELECT 1 FROM admin_audit_log WHERE action = 'equipe_note_remise_retiree'")


def _dump(reel) -> str:
    rows = _sql(reel, "SELECT * FROM connexions_equipe")
    rows += _sql(reel, "SELECT * FROM admin_audit_log")
    rows += _sql(reel, "SELECT cle, valeur FROM params")
    return repr(rows)


def test_reel_position_une_fois_sans_coordonnees(propre, monkeypatch, capsys):
    c = propre["c"]
    _activer(propre, monkeypatch)
    tok, p = _login(c, ALICE)
    h = {"Authorization": f"Bearer {tok}"}
    assert c.get("/api/equipe/position/config", headers=h).json() == {"actif": True}
    # Entrées invalides : 422 générique, rien de l'entrée renvoyé ni stocké
    for corps in ({"lat": LAT_TEST, "lng": 999, "precision_m": 20}, {"lat": "abc", "lng": LNG_TEST},
                  [LAT_TEST, LNG_TEST], {"lat": LAT_TEST, "lng": LNG_TEST, "precision_m": -3}):
        r = c.post("/api/equipe/position", json=corps, headers=h)
        assert r.status_code == 422 and "45.56" not in r.text and "5.92" not in r.text
    r = c.post("/api/equipe/position", content=b"{lat: 45.566071", headers={**h, "Content-Type": "application/json"})
    assert r.status_code == 422 and "45.56" not in r.text
    r = c.post("/api/equipe/position", json={"lat": LAT_TEST, "lng": LNG_TEST, "precision_m": 18.4}, headers=h)
    assert r.status_code == 200 and r.json() == {"ok": True}
    (l,) = _lignes(propre)
    assert l["geo_statut"] == "en_boutique" and l["geo_distance_m"] % 50 == 0 and l["geo_precision_m"] == 18
    assert l["geo_le"] is not None
    # Une seule fois par session
    r = c.post("/api/equipe/position", json={"refus": True}, headers=h)
    assert r.status_code == 409
    # Les coordonnées n'apparaissent nulle part (table, traces, réglages, journaux du serveur)
    dump = _dump(propre)
    assert "45.56607" not in dump and "5.92189" not in dump
    sortie = capsys.readouterr()
    assert "45.56607" not in sortie.out + sortie.err and "5.92189" not in sortie.out + sortie.err
    # Le personnel ne voit rien d'autre que {actif}
    assert c.get("/api/equipe/reglages", headers=h).status_code == 403


def test_reel_position_statuts(propre, monkeypatch):
    c = propre["c"]
    _activer(propre, monkeypatch)
    cas = [
        ({"lat": 45.5856, "lng": 5.9215, "precision_m": 30}, "hors_boutique", 2200, 30),   # ~2,2 km au nord
        ({"lat": 45.5674, "lng": 5.9215, "precision_m": 30}, "hors_boutique", 200, 30),    # ~200 m, ± 30 m
        ({"lat": 45.5674, "lng": 5.9215, "precision_m": 300}, "imprecise", None, 300),     # ~200 m, ± 300 m
        ({"lat": 45.5656, "lng": 5.9215, "precision_m": 900}, "imprecise", None, 900),
        ({"lat": 45.5666, "lng": 5.9215, "precision_m": 40}, "en_boutique", 100, 40),
        ({"refus": True}, "refusee", None, None),
        ({"indisponible": True}, "indisponible", None, None),
    ]
    for corps, attendu, distance, precision in cas:
        tok, p = _login(c, ALICE)
        assert c.post("/api/equipe/position", json=corps, headers={"Authorization": f"Bearer {tok}"}).status_code == 200
        l = _sql(propre, "SELECT * FROM connexions_equipe WHERE id = %s", p["cx"])[0]
        assert (l["geo_statut"], l["geo_distance_m"], l["geo_precision_m"]) == (attendu, distance, precision), corps
    # Hors des heures d'ouverture : statut seul, aucune distance
    monkeypatch.setattr(presence, "dans_horaires", lambda u=None: False)
    tok, p = _login(c, BRUNO)
    h = {"Authorization": f"Bearer {tok}"}
    assert c.get("/api/equipe/position/config", headers=h).json() == {"actif": False}
    # Entrée invalide hors horaires : refusée aussi (422), rien d'enregistré
    assert c.post("/api/equipe/position", json={"lat": LAT_TEST, "lng": 999, "precision_m": 10},
                  headers=h).status_code == 422
    assert _sql(propre, "SELECT geo_le FROM connexions_equipe WHERE id = %s", p["cx"])[0]["geo_le"] is None
    assert c.post("/api/equipe/position", json={"lat": LAT_TEST, "lng": LNG_TEST, "precision_m": 10},
                  headers=h).status_code == 200
    l = _sql(propre, "SELECT * FROM connexions_equipe WHERE id = %s", p["cx"])[0]
    assert (l["geo_statut"], l["geo_distance_m"], l["geo_precision_m"]) == ("hors_horaires", None, None)


ROUTES_ADMIN = [
    ("get", "/api/equipe/activite", None), ("get", "/api/equipe/sessions?utilisateur=x", None),
    ("get", "/api/equipe/reglages", None), ("put", "/api/equipe/reglages", {"pointage_actif": False}),
    ("post", "/api/equipe/reglages/information-remise", None),
    ("post", "/api/equipe/reglages/position-boutique", {"lat": 45.5, "lng": 5.9}),
    ("get", "/api/equipe/export.csv", None),
]


def _jeton_elevation_expire(nom):
    from jose import jwt
    return jwt.encode({"sub": nom, "target": "accueil", "typ": "admin_elevation", "admin": True,
                       "exp": datetime.now(timezone.utc) - timedelta(minutes=1)}, auth.JWT_SECRET,
                      algorithm=auth.JWT_ALGORITHM)


def test_reel_routes_admin_refusees_hors_admin(propre):
    c = propre["c"]
    sans_preuve = _h(ADMIN, sid="poste-sans-code")
    alice_avec_code = {**_h(ALICE), "X-Admin-Token": create_admin_token({"sub": ALICE, "target": "accueil", "sid": "poste-x"})}
    expire = {**_admin_sans_code(), "X-Admin-Token": _jeton_elevation_expire(ADMIN)}
    for methode, url, corps in ROUTES_ADMIN:
        kw = {"json": corps} if corps is not None else {}
        for h in (_h(ALICE), sans_preuve, alice_avec_code):
            r = getattr(c, methode)(url, headers=h, **kw)
            assert r.status_code == 403, (methode, url, r.status_code)
        # Rôle admin seul : le code doit avoir été saisi depuis moins de 10 min sur ce poste
        r = getattr(c, methode)(url, headers=_admin_sans_code(), **kw)
        assert r.status_code == 403 and r.json()["detail"]["code"] == "admin_requis", (methode, url)
        r = getattr(c, methode)(url, headers=expire, **kw)
        assert r.status_code == 403 and r.json()["detail"]["code"] == "admin_expire", (methode, url)
        assert getattr(c, methode)(url, headers=alice_avec_code, **kw).json()["detail"] == "Admin requis"
        r = getattr(c, methode)(url, **kw)
        assert r.status_code == 401
    assert not _sql(propre, "SELECT 1 FROM params WHERE cle = ANY(%s)", list(presence.PARAMS))
    assert not _sql(propre, "SELECT 1 FROM equipe_notes_remises")
    assert not _sql(propre, "SELECT 1 FROM admin_audit_log WHERE target_type = 'equipe'")


def test_reel_code_admin_par_en_tete_accepte(propre):
    _sql(propre, "INSERT INTO params (cle, valeur) VALUES ('ADMIN_PASSWORD', %s) ON CONFLICT (cle) DO UPDATE "
                 "SET valeur = EXCLUDED.valeur", auth.hasher_secret("code-equipe-test") or "code-equipe-test")
    from app.services import params as params_cache
    params_cache.invalidate()
    c = propre["c"]
    h = _h(ADMIN, sid="poste-code-saisi")
    assert c.get("/api/equipe/reglages", headers={**h, "X-Admin-Password": "faux"}).status_code == 403
    assert c.get("/api/equipe/reglages", headers={**h, "X-Admin-Password": "code-equipe-test"}).status_code == 200
    assert c.get("/api/equipe/reglages", headers=h).status_code == 403   # pas de jeton : code redemandé
    _sql(propre, "DELETE FROM params WHERE cle = 'ADMIN_PASSWORD'")
    params_cache.invalidate()


def test_reel_cles_protegees_hors_config_generique(propre):
    c = propre["c"]
    for cle in ("GEO_POINTAGE_ACTIF", "GEO_RAYON_M", "BOUTIQUE_LAT", "geo_information_remise_le"):
        for h in (_h(ALICE), _admin()):
            r = c.put("/api/config", json={"cle": cle, "valeur": "1"}, headers=h)
            assert r.status_code == 403, cle
            r = c.put("/api/config/batch", json=[{"cle": "kp_x", "valeur": "1"}, {"cle": cle, "valeur": "1"}], headers=h)
            assert r.status_code == 403
    _sql(propre, "INSERT INTO params (cle, valeur) VALUES ('BOUTIQUE_LAT', '45.1'), ('GEO_RAYON_M', '300')")
    from app.services import params as params_cache
    params_cache.invalidate()
    cles = {p["cle"] for p in c.get("/api/config", headers=_h(ALICE)).json()}
    assert not cles & {"BOUTIQUE_LAT", "GEO_RAYON_M"}
    assert c.get("/api/config/BOUTIQUE_LAT", headers=_h(ALICE)).json()["valeur"] is None
    pub = c.get("/api/config/public").json()
    assert not any(k.startswith(("GEO_", "BOUTIQUE_LAT", "BOUTIQUE_LNG")) for k in pub)


def test_reel_import_de_sauvegarde_ne_touche_pas_au_pointage(propre):
    c = propre["c"]
    assert c.post("/api/equipe/reglages/position-boutique", json={"lat": 45.5656, "lng": 5.9215, "precision_m": 20},
                  headers=_admin()).status_code == 200
    avant = {r["cle"]: r["valeur"] for r in _sql(propre, "SELECT cle, valeur FROM params")}
    lignes = [{"cle": k, "valeur": v} for k, v in avant.items() if k not in presence.PARAMS]
    lignes += [{"cle": "GEO_POINTAGE_ACTIF", "valeur": "1"}, {"cle": "BOUTIQUE_LAT", "valeur": "1.0"},
               {"cle": "geo_rayon_m", "valeur": "1000"}, {"cle": "kp_import_equipe", "valeur": "ok"}]
    r = c.post("/api/config/backup/import", json={"tables": {"params": lignes}}, headers=_admin())
    assert r.status_code == 200, r.text
    apres = {r["cle"]: r["valeur"] for r in _sql(propre, "SELECT cle, valeur FROM params")}
    assert apres.get("kp_import_equipe") == "ok" and apres.get("PIN_ACCUEIL") == avant.get("PIN_ACCUEIL")
    assert "GEO_POINTAGE_ACTIF" not in apres and "geo_rayon_m" not in apres
    assert apres["BOUTIQUE_LAT"] == avant["BOUTIQUE_LAT"] and apres["BOUTIQUE_LNG"] == avant["BOUTIQUE_LNG"]
    _sql(propre, "DELETE FROM params WHERE cle = 'kp_import_equipe'")


def test_reel_position_boutique(propre):
    c = propre["c"]
    r = c.post("/api/equipe/reglages/position-boutique", json={"lat": 45.56571, "lng": 5.92161, "precision_m": 900},
               headers=_admin())
    assert r.status_code == 409
    r = c.post("/api/equipe/reglages/position-boutique", json={"lat": 45.56571, "lng": 5.92161, "precision_m": 25},
               headers=_admin())
    assert r.status_code == 200
    g = r.json()
    assert g["boutique_position_confirmee"] is True and g["boutique_lat"] == pytest.approx(45.56571)
    assert c.post("/api/equipe/reglages/position-boutique", json={"lat": 400}, headers=_admin()).status_code == 422


def _session(reel, user, debut, fin=None, derniere=None, motif=None, actions=0, geo=None, dist=None,
             type_="ordinateur", marque=None, sid="s"):
    """Ligne fictive ; heures données en heure de Paris (naïves), stockées en UTC."""
    vers = presence.paris_vers_utc
    d = vers(debut)
    f = vers(fin) if fin else None
    da = vers(derniere) if derniere else (f or d)
    return _sql(reel, """INSERT INTO connexions_equipe (sid, utilisateur, cible, appareil_type, appareil_marque,
                         debut, derniere_activite, fin, fin_motif, actions, geo_statut, geo_distance_m)
                         VALUES (%s, %s, 'accueil', %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                sid, user, type_, marque, d, da, f, motif, actions, geo, dist)[0]["id"]


def test_reel_semaine_union_des_intervalles(propre):
    c = propre["c"]
    j = datetime(2026, 10, 13)   # mardi
    # Deux appareils ouverts en même temps : 10:02 → 12:30 et 11:00 → 13:00 = 10:02 → 13:00 (2 h 58)
    _session(propre, ALICE, j.replace(hour=10, minute=2), j.replace(hour=12, minute=30), motif="deconnexion",
             actions=23, geo="en_boutique", dist=0, type_="iphone", marque="Apple")
    _session(propre, ALICE, j.replace(hour=11), j.replace(hour=13), motif="changement", actions=4)
    # Puis 14:00 → dernière activité 18:47 (expirée)
    _session(propre, ALICE, j.replace(hour=14), j.replace(hour=18, minute=47), motif="expiree", actions=27,
             geo="hors_boutique", dist=2300, type_="smartphone", marque="Samsung")
    # Dimanche précédent (hors semaine) et lundi suivant : ignorés
    _session(propre, ALICE, datetime(2026, 10, 11, 10), datetime(2026, 10, 11, 11), motif="deconnexion")
    _session(propre, ALICE, datetime(2026, 10, 19, 10), datetime(2026, 10, 19, 11), motif="deconnexion")
    # Session à cheval sur minuit (vendredi 22:00 → samedi 01:00)
    _session(propre, BRUNO, datetime(2026, 10, 16, 22), datetime(2026, 10, 17, 1), motif="deconnexion", actions=5)
    _sql(propre, "INSERT INTO tickets (cree_par, date_depot, statut) VALUES (%s, %s, 'En attente de diagnostic'), "
                 "(%s, %s, 'En attente de diagnostic')",
         ALICE, presence.paris_vers_utc(j.replace(hour=10, minute=30)),
         ALICE, presence.paris_vers_utc(j.replace(hour=15)))
    r = c.get("/api/equipe/activite?semaine=2026-10-15", headers=_admin())
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["semaine"]["debut"] == "2026-10-12" and d["semaine"]["fin"] == "2026-10-18"
    assert len(d["semaine"]["jours"]) == 7 and d["information_remise"] is False
    noms = [s["utilisateur"] for s in d["salaries"]]
    assert ADMIN in noms and ALICE in noms and BRUNO in noms
    assert ROBOT not in noms and "Système" not in noms   # robots exclus de la grille
    alice = next(s for s in d["salaries"] if s["utilisateur"] == ALICE)
    assert list(alice["jours"]) == ["2026-10-13"]
    mardi = alice["jours"]["2026-10-13"]
    assert (mardi["arrivee"], mardi["depart"]) == ("10:02", "18:47")
    assert mardi["duree_min"] == 178 + 287
    assert (mardi["sessions"], mardi["actions"], mardi["tickets_crees"]) == (3, 54, 2)
    assert (mardi["presence"], mardi["distance_m"], mardi["en_cours"]) == ("hors_boutique", 2300, False)
    assert {(a["type"], a["marque"]) for a in mardi["appareils"]} == {
        ("iphone", "Apple"), ("ordinateur", None), ("smartphone", "Samsung")}
    assert alice["total"] == {"duree_min": 465, "jours": 1, "actions": 54, "tickets_crees": 2}
    bruno = next(s for s in d["salaries"] if s["utilisateur"] == BRUNO)
    assert bruno["jours"]["2026-10-16"]["depart"] == "24:00" and bruno["jours"]["2026-10-16"]["duree_min"] == 120
    assert bruno["jours"]["2026-10-17"]["arrivee"] == "00:00" and bruno["jours"]["2026-10-17"]["duree_min"] == 60
    assert bruno["jours"]["2026-10-17"]["actions"] == 0 and bruno["total"]["actions"] == 5
    gerant = next(s for s in d["salaries"] if s["utilisateur"] == ADMIN)
    assert gerant["jours"] == {} and gerant["total"]["jours"] == 0
    # Consultation tracée une fois (rafraîchissements regroupés), avec le filtre seul
    c.get("/api/equipe/activite?semaine=2026-10-15", headers=_admin())
    traces = _sql(propre, "SELECT * FROM admin_audit_log WHERE action = 'equipe_activite_consultee'")
    assert len(traces) == 1 and traces[0]["details"] == "semaine=2026-10-12" and traces[0]["user_login"] == ADMIN
    # Détail du jour
    r = c.get(f"/api/equipe/sessions?utilisateur={ALICE}&jour=2026-10-13", headers=_admin())
    assert r.status_code == 200
    s = r.json()
    assert [x["debut"] for x in s] == ["10:02", "11:00", "14:00"]
    assert s[0]["fin"] == "12:30" and s[0]["duree_min"] == 148 and s[0]["appareil"]["libelle"].startswith("iPhone")
    assert [x["fin_motif"] for x in s] == ["deconnexion", "changement", "expiree"]
    # Détail d'un salarié consulté : tracé (regroupé), filtre seul
    c.get(f"/api/equipe/sessions?utilisateur={ALICE}&jour=2026-10-13", headers=_admin())
    traces = _sql(propre, "SELECT * FROM admin_audit_log WHERE action = 'equipe_sessions_consultees'")
    assert len(traces) == 1 and traces[0]["details"] == f"utilisateur={ALICE} jour=2026-10-13"
    # Empreinte réseau salée (jamais un sha256 nu, retrouvable par force brute)
    ip = "testclient"
    assert traces[0]["ip_hash"] == presence.empreinte_ip(ip)
    assert traces[0]["ip_hash"] != hashlib.sha256(("kp:" + ip).encode()).hexdigest()[:16]
    assert c.get("/api/equipe/activite?semaine=demain", headers=_admin()).status_code == 400


def test_reel_nuit_du_changement_d_heure(propre):
    """Samedi 24/10/2026 23:30 → dimanche 25/10/2026 04:00 (heure de Paris) : 5 h 30 réelles."""
    c = propre["c"]
    _session(propre, ALICE, datetime(2026, 10, 24, 23, 30), datetime(2026, 10, 25, 4, 0), motif="deconnexion",
             actions=7)
    d = c.get("/api/equipe/activite?semaine=2026-10-21", headers=_admin()).json()
    alice = next(s for s in d["salaries"] if s["utilisateur"] == ALICE)
    sam, dim = alice["jours"]["2026-10-24"], alice["jours"]["2026-10-25"]
    assert (sam["arrivee"], sam["depart"], sam["duree_min"]) == ("23:30", "24:00", 30)
    assert (dim["arrivee"], dim["depart"], dim["duree_min"]) == ("00:00", "04:00", 300)
    assert alice["total"]["duree_min"] == 330 and alice["total"]["actions"] == 7
    (s,) = c.get(f"/api/equipe/sessions?utilisateur={ALICE}&jour=2026-10-25", headers=_admin()).json()
    assert (s["debut"], s["fin"], s["duree_min"]) == ("23:30", "04:00", 330)
    texte = c.get(f"/api/equipe/export.csv?utilisateur={ALICE}&depuis=2026-10-24&jusqua=2026-10-25",
                  headers=_admin()).content.decode("utf-8")
    assert ";23:30;04:00;04:00;330;" in texte
    # Passage à l'heure d'été (29/03/2026, 02:00 → 03:00) : 01:30 → 03:30 = 1 h réelle
    _session(propre, BRUNO, datetime(2026, 3, 29, 1, 30), datetime(2026, 3, 29, 3, 30), motif="deconnexion")
    d = c.get("/api/equipe/activite?semaine=2026-03-29", headers=_admin()).json()
    bruno = next(s for s in d["salaries"] if s["utilisateur"] == BRUNO)
    assert bruno["jours"]["2026-03-29"]["duree_min"] == 60


def test_reel_connectes_et_en_cours(propre):
    c = propre["c"]
    tok, p = _login(c, BRUNO, "samsung_internet", poste="Atelier")
    c.get("/api/team", headers={"Authorization": f"Bearer {tok}"})
    d = c.get("/api/equipe/activite", headers=_admin()).json()
    (x,) = [k for k in d["connectes"] if k["utilisateur"] == BRUNO]
    assert x["poste"] == "Atelier" and x["appareil"]["libelle"] == "Smartphone · Samsung SM-S911B · Android 14"
    assert x["appareil"]["nom"] == "Galaxy S23" and len(x["depuis"]) == 5 and x["debut"].endswith("Z")
    assert "ip_empreinte" not in x
    bruno = next(s for s in d["salaries"] if s["utilisateur"] == BRUNO)
    assert any(j["en_cours"] for j in bruno["jours"].values())


def test_reel_export_csv(propre):
    c = propre["c"]
    j = datetime(2026, 10, 13)
    _session(propre, ALICE, j.replace(hour=10), j.replace(hour=11), motif="deconnexion", actions=3,
             geo="en_boutique", dist=50)
    _session(propre, BRUNO, j.replace(hour=10), j.replace(hour=12), motif="expiree")
    _sql(propre, "UPDATE connexions_equipe SET poste = '=HYPERLINK(1)' WHERE utilisateur = %s", BRUNO)
    r = c.get("/api/equipe/export.csv?depuis=2026-10-12&jusqua=2026-10-18", headers=_admin())
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    texte = r.content.decode("utf-8")
    assert texte.startswith("﻿Salarié;") and ALICE in texte and BRUNO in texte
    assert "'=HYPERLINK(1)" in texte and ";En boutique;50;" in texte
    r = c.get(f"/api/equipe/export.csv?utilisateur={ALICE}&depuis=2026-10-12&jusqua=2026-10-18", headers=_admin())
    texte = r.content.decode("utf-8")
    assert ALICE in texte and BRUNO not in texte and "alice" in r.headers["content-disposition"]
    traces = _sql(propre, "SELECT details FROM admin_audit_log WHERE action = 'equipe_export' ORDER BY id")
    assert [t["details"] for t in traces] == [
        "utilisateur=* depuis=2026-10-12 jusqua=2026-10-18",
        f"utilisateur={ALICE} depuis=2026-10-12 jusqua=2026-10-18"]
    assert c.get("/api/equipe/export.csv?depuis=2026-10-18&jusqua=2026-10-12", headers=_admin()).status_code == 400


def test_reel_retention(propre):
    maintenant = presence.maintenant_utc()
    vieux_geo = _session(propre, ALICE, datetime(2026, 1, 1, 10), datetime(2026, 1, 1, 11), motif="deconnexion",
                         geo="hors_boutique", dist=900)
    _sql(propre, "UPDATE connexions_equipe SET debut = %s, derniere_activite = %s, fin = %s, geo_le = %s, "
                 "geo_precision_m = 20 WHERE id = %s", maintenant - timedelta(days=61), maintenant - timedelta(days=61),
         maintenant - timedelta(days=61), maintenant - timedelta(days=61), vieux_geo)
    recent_geo = _session(propre, ALICE, datetime(2026, 1, 1, 10), motif=None, geo="en_boutique", dist=0)
    _sql(propre, "UPDATE connexions_equipe SET debut = %s, derniere_activite = %s, geo_le = %s WHERE id = %s",
         maintenant - timedelta(days=59), maintenant - timedelta(days=59) + timedelta(hours=2),
         maintenant - timedelta(days=59), recent_geo)
    tres_vieux = _session(propre, BRUNO, datetime(2026, 1, 1, 10), datetime(2026, 1, 1, 11), motif="deconnexion")
    _sql(propre, "UPDATE connexions_equipe SET debut = %s WHERE id = %s", maintenant - timedelta(days=184), tres_vieux)
    ouverte = _session(propre, BRUNO, datetime(2026, 1, 1, 10))
    _sql(propre, "UPDATE connexions_equipe SET debut = %s, derniere_activite = %s, fin = NULL WHERE id = %s",
         maintenant - timedelta(hours=14), maintenant - timedelta(hours=13), ouverte)
    active = _session(propre, BRUNO, datetime(2026, 1, 1, 10))
    _sql(propre, "UPDATE connexions_equipe SET debut = %s, derniere_activite = %s, fin = NULL WHERE id = %s",
         maintenant - timedelta(hours=3), maintenant - timedelta(minutes=5), active)
    _sql(propre, "INSERT INTO admin_audit_log (user_login, action, target_type, details, created_at) VALUES "
                 "('g', 'equipe_export', 'equipe', 'vieux', %s), ('g', 'equipe_export', 'equipe', 'recent', %s), "
                 "('g', 'autre', 'client', 'vieux-autre', %s)",
         maintenant - timedelta(days=366), maintenant - timedelta(days=300), maintenant - timedelta(days=400))
    r = presence.retention_connexions()
    assert r["lignes_supprimees"] == 1 and r["positions_effacees"] == 1 and r["sessions_expirees"] >= 1
    assert r["traces_supprimees"] == 1
    restes = {x["details"] for x in _sql(propre, "SELECT details FROM admin_audit_log WHERE details LIKE '%%vieux%%' "
                                                 "OR details = 'recent'")}
    assert restes == {"recent", "vieux-autre"}
    _sql(propre, "DELETE FROM admin_audit_log WHERE details = 'vieux-autre'")
    lignes = {l["id"]: l for l in _lignes(propre)}
    assert tres_vieux not in lignes
    v = lignes[vieux_geo]
    assert (v["geo_statut"], v["geo_distance_m"], v["geo_precision_m"], v["geo_le"]) == (None, None, None, None)
    assert lignes[recent_geo]["geo_statut"] == "en_boutique"
    o = lignes[ouverte]
    assert o["fin_motif"] == "expiree" and o["fin"] == o["derniere_activite"]
    assert lignes[active]["fin"] is None
    assert presence.retention_connexions() == {"positions_effacees": 0, "lignes_supprimees": 0,
                                               "sessions_expirees": 0, "traces_supprimees": 0}


def test_reel_semaine_rapide_sur_20000_lignes(propre):
    """Requête agrégée de la semaine : rapide sur 6 mois de données (20 000 lignes fictives)."""
    from app.api import equipe
    _sql(propre, """
        INSERT INTO connexions_equipe (sid, utilisateur, cible, appareil_type, appareil_marque, debut,
                                       derniere_activite, fin, fin_motif, actions, geo_statut, geo_distance_m)
        SELECT 's' || (g % 40), (ARRAY['Alice Équipe','Bruno Équipe','Chloé','David','Emma','Farid'])[1 + g % 6],
               'accueil', (ARRAY['ordinateur','iphone','smartphone'])[1 + g % 3], NULL,
               t, t + (g % 300) * INTERVAL '1 minute', t + (g % 300) * INTERVAL '1 minute', 'deconnexion',
               g % 40, (ARRAY['en_boutique','hors_boutique',NULL])[1 + g % 3], (g % 10) * 50
        FROM generate_series(1, 20000) g,
             LATERAL (SELECT timezone('UTC', NOW()) - (g * INTERVAL '13 minutes') AS t) x
    """)
    _sql(propre, "ANALYZE connexions_equipe")
    deb = presence.lundi(presence.aujourdhui_paris()) - timedelta(days=28)
    deb_utc, fin_utc = equipe._bornes(deb, deb + timedelta(days=7))
    p = {"deb_utc": deb_utc, "fin_utc": fin_utc, "en_ligne": presence.maintenant_utc(),
         "deb_local": datetime.combine(deb, datetime.min.time()),
         "fin_local": datetime.combine(deb + timedelta(days=7), datetime.min.time())}
    with propre["cur"]() as cur:
        cur.execute("EXPLAIN (ANALYZE, FORMAT JSON) " + equipe._SQL_SEMAINE, p)
        plan = cur.fetchone()["QUERY PLAN"][0]
    assert plan["Execution Time"] < 250, plan["Execution Time"]
    debut = time.perf_counter()
    r = propre["c"].get(f"/api/equipe/activite?semaine={deb.isoformat()}", headers=_admin())
    assert r.status_code == 200 and (time.perf_counter() - debut) < 1.5
    assert sum(s["total"]["jours"] for s in r.json()["salaries"]) > 0
