"""Audit adverse d'octobre 2026, sessions et jetons : un test par constat du périmètre BACKEND 2.

  F. Révocation : un jeton de session dont la ligne connexions_equipe (claim cx) — ou une ligne
     postérieure de la même lignée (sid, utilisateur), après une reprise sur « expiree » — est
     close par une déconnexion est refusé (401, lecture en cache 30 s ; un jeton sans cx reste
     accepté, une ligne « expiree » seule n'est pas une révocation) ; le jeton d'élévation
     X-Admin-Token porte sid et iat, n'est accepté que sur sa lignée et seulement s'il est
     postérieur à la dernière révocation (verrouillage du mode admin, déconnexion, changement
     de membre), révocation persistée (revocations_admin) : un redémarrage ne la perd pas.
  G. Jeton de suivi expirable : dossier rendu ou clôturé depuis plus de SUIVI_JETON_JOURS
     (défaut 180) → jeton refusé (lien_invalide / 404), le numéro complet reste accepté ;
     POST /api/tickets/{id}/suivi-token/regenerer (session) rend un nouveau jeton ; l'anonymisation
     RGPD efface le jeton et il n'est jamais recréé.
  H. Plafonds globaux de la vitrine (20/h toutes IP, 2/h par adresse e-mail) et plafond
     d'échecs de PIN toutes IP confondues (200/h) → 429 avec un message clair.
  I. Une seule fonction client_ip (auth), KP_TRUST_PROXY=0 ignore X-Forwarded-For ; garde au
     démarrage sur un réglage incohérent avec l'environnement.
  J. Liens de partage : X-Forwarded-Host / Proto acceptés seulement pour un hôte du projet, en
     correspondance exacte (pas de déclinaison *.up.railway.app, hôtes locaux hors production).

Base simulée (réponses choisies selon le texte SQL) : ces tests tournent toujours.
"""

import re
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import pytest
from jose import jwt
from starlette.requests import Request

from app.api import auth, iphone_tarifs, public_documents, rgpd, tickets as tickets_api, tracking
from app.api.auth import create_admin_token, create_token, decode_token
from app.services import params as params_cache
from tests.test_suivi_preuve import CODE, JETON, TEL_CLIENT, TEL_CONTACT, TICKET, FakeCursor, _handler

STAFF = {"Authorization": f"Bearer {create_token('accueil', 'Sophie')}"}
DOC_TOKEN = "AbCdEfGhIjKlMnOpQrStUv"


def _ip(n=1):
    return {"X-Forwarded-For": f"6.6.6.6, 10.42.0.{n}"}


def _maintenant() -> datetime:
    """UTC naïf, comme tickets.date_maj."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _il_y_a(jours: int) -> datetime:
    return _maintenant() - timedelta(days=jours)


@contextmanager
def _curseur(handler):
    cur = FakeCursor(handler)

    @contextmanager
    def gc(*a, **k):
        yield cur

    yield cur, gc


# ─── F : révocation du jeton de session (claim cx) ────────────────────────

class _Journal:
    """connexions_equipe simulé : une ligne par id {sid, utilisateur, fin, fin_motif} ; compte les
    lectures. Même décision que la requête réelle : ligne cx, ou ligne postérieure de la même
    lignée (sid, utilisateur), close hors « expiree »."""

    def __init__(self):
        self.lignes = {}
        self.lectures = 0

    def handler(self, sql, params):
        if sql.startswith("SELECT 1 AS close FROM connexions_equipe"):
            self.lectures += 1
            cx, sid, sub, _cx2, motifs = params
            for i, l in self.lignes.items():
                if l.get("fin") is None or (l.get("fin_motif") or "") in motifs:
                    continue
                if i == cx or (i > cx and l.get("sid") == sid and l.get("utilisateur") == sub):
                    return {"close": 1}
            return None
        return None

    def ouvrir(self, cx, sid=None, utilisateur="Sophie"):
        self.lignes[cx] = {"sid": sid, "utilisateur": utilisateur, "fin": None, "fin_motif": None}

    def clore(self, cx, motif="deconnexion"):
        l = self.lignes.setdefault(cx, {"sid": None, "utilisateur": None})
        l.update({"fin": _maintenant(), "fin_motif": motif})


@pytest.fixture
def journal():
    j = _Journal()
    with _curseur(j.handler) as (cur, gc), patch("app.api.auth.get_cursor", gc):
        yield j


def _me(client, tok, **h):
    return client.get("/api/auth/me", headers={"Authorization": f"Bearer {tok}", **h})


def test_f_jeton_apres_logout_401(client, journal):
    tok = create_token("accueil", "Sophie", sid="poste-f1", cx=77)
    journal.lignes[77] = {"fin": None, "fin_motif": None}
    assert _me(client, tok).status_code == 200
    # presence.fermer_session clôt la ligne (base réelle) : simulé par le journal
    with patch("app.api.auth.presence.fermer_session", lambda user, motif="deconnexion": (journal.clore(77), True)[1]):
        r = client.post("/api/auth/logout", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200 and r.json()["session_close"] is True
    r = _me(client, tok)
    assert r.status_code == 401 and "reconnectez" in r.json()["detail"].lower()
    # Même refus comme session optionnelle : le visiteur redevient anonyme (preuve requise)
    r = client.get(f"/api/tickets/code/{CODE}", headers={"Authorization": f"Bearer {tok}", **_ip(3)})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "preuve_requise"


def test_f_revocation_lue_en_cache_30_s(client, journal, monkeypatch):
    tok = create_token("accueil", "Sophie", sid="poste-f2", cx=78)
    journal.lignes[78] = {"fin": None, "fin_motif": None}
    for _ in range(5):
        assert _me(client, tok).status_code == 200
    assert journal.lectures == 1                      # une lecture, puis le cache
    journal.clore(78)
    assert _me(client, tok).status_code == 200        # encore en cache (30 s)
    t = [auth.monotonic()]
    monkeypatch.setattr(auth, "monotonic", lambda: t[0] + auth.SESSION_CLOSE_CACHE_S + 1)
    assert _me(client, tok).status_code == 401        # cache expiré : relu, close
    assert journal.lectures == 2
    # Une ligne close ne se rouvre jamais : refus gardé sans relire la base
    assert _me(client, tok).status_code == 401 and journal.lectures == 2


def test_f_jeton_sans_cx_et_ligne_expiree_acceptes(client, journal):
    ancien = create_token("accueil", "Sophie", sid="poste-f3")          # jeton d'avant le journal
    assert "cx" not in decode_token(ancien) and _me(client, ancien).status_code == 200
    tok = create_token("accueil", "Sophie", sid="poste-f3", cx=79)
    journal.clore(79, "expiree")                      # 12 h d'inactivité : pas une révocation
    assert _me(client, tok).status_code == 200
    # Ligne inconnue (journal purgé) : accepté ; journal illisible : accepté aussi
    assert _me(client, create_token("accueil", "Sophie", sid="poste-f3", cx=80)).status_code == 200

    def panne(sql, params):
        raise RuntimeError("journal indisponible")
    with _curseur(panne) as (cur, gc), patch("app.api.auth.get_cursor", gc):
        auth.oublier_sessions()
        assert _me(client, create_token("accueil", "Sophie", sid="poste-f3", cx=81)).status_code == 200


def test_f_switch_user_revoque_l_ancien_jeton(client, journal):
    tok = create_token("accueil", "Sophie", sid="poste-f4", cx=90)
    journal.lignes[90] = {"fin": None, "fin_motif": None}
    assert _me(client, tok).status_code == 200

    def ouvrir(request, sid, utilisateur, cible, poste=None, appareil=None, precedent=None):
        journal.clore(90, "changement")
        journal.lignes[91] = {"fin": None, "fin_motif": None}
        return 91
    with patch("app.api.auth.presence.ouvrir_session", ouvrir), \
            patch("app.api.auth._membre_autorise", lambda nom, target: nom):
        r = client.post("/api/auth/switch-user", json={"utilisateur": "Bruno"},
                        headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    nouveau = r.json()["access_token"]
    p = decode_token(nouveau)
    assert p["cx"] == 91 and p["sid"] == "poste-f4" and p["sub"] == "Bruno"
    assert _me(client, tok).status_code == 401 and _me(client, nouveau).status_code == 200


@pytest.mark.parametrize("fin", ["logout", "switch"])
def test_f_deconnexion_apres_une_nuit_d_inactivite_revoque_le_jeton(client, journal, fin):
    """Ligne cx close « expiree » (12 h sans activité), activité reprise sur une NOUVELLE ligne de la
    même lignée (presence._reprendre), puis déconnexion ou changement d'utilisateur : la ligne close
    est la nouvelle, pas la ligne cx — le jeton doit être refusé quand même (décision sur la lignée)."""
    tok = create_token("accueil", "Sophie", sid="poste-nuit", cx=100)
    journal.ouvrir(100, "poste-nuit")
    assert _me(client, tok).status_code == 200
    journal.clore(100, "expiree")                       # nuit : rétention horaire ou _reprendre
    journal.ouvrir(101, "poste-nuit")                   # reprise le lendemain (sans lien avec cx)
    auth.oublier_sessions()
    assert _me(client, tok).status_code == 200          # « expiree » seule : pas une révocation
    if fin == "logout":
        def fermer(user, motif="deconnexion"):
            journal.clore(101, "deconnexion")           # fermer_session trouve la ligne ouverte par (sid, utilisateur)
            return True
        with patch("app.api.auth.presence.fermer_session", fermer):
            assert client.post("/api/auth/logout", headers={"Authorization": f"Bearer {tok}"}).status_code == 200
    else:
        def ouvrir(request, sid, utilisateur, cible, poste=None, appareil=None, precedent=None):
            journal.clore(101, "changement")
            journal.ouvrir(102, "poste-nuit", "Bruno")
            return 102
        with patch("app.api.auth.presence.ouvrir_session", ouvrir), \
                patch("app.api.auth._membre_autorise", lambda nom, target: nom):
            r = client.post("/api/auth/switch-user", json={"utilisateur": "Bruno"},
                            headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200 and _me(client, r.json()["access_token"]).status_code == 200
    r = _me(client, tok)
    assert r.status_code == 401 and "reconnectez" in r.json()["detail"].lower()
    # Une autre lignée (autre poste) ou un autre membre de la même lignée n'est pas touché
    journal.ouvrir(103, "autre-poste")
    assert _me(client, create_token("accueil", "Sophie", sid="autre-poste", cx=103)).status_code == 200


def test_f_lignee_a_b_a_seul_l_ancien_jeton_est_revoque(client, journal):
    """Sophie → Bruno → Sophie sur le même poste : la ligne de Sophie close « changement » (id > cx)
    révoque son ancien jeton ; le nouveau jeton (cx = ligne ouverte) reste valable."""
    ancien = create_token("accueil", "Sophie", sid="poste-aba", cx=110)
    journal.ouvrir(110, "poste-aba")
    journal.clore(110, "changement")
    journal.ouvrir(111, "poste-aba", "Bruno")
    journal.clore(111, "changement")
    journal.ouvrir(112, "poste-aba")
    nouveau = create_token("accueil", "Sophie", sid="poste-aba", cx=112)
    assert _me(client, ancien).status_code == 401
    assert _me(client, nouveau).status_code == 200
    assert _me(client, create_token("accueil", "Bruno", sid="poste-aba", cx=111)).status_code == 401


# ─── F : jeton d'élévation lié à la lignée et daté ─────────────────────────

def test_f_jeton_elevation_porte_sid_et_iat():
    tok = create_token("accueil", "Sophie", sid="poste-e1")
    payload = jwt.decode(create_admin_token(decode_token(tok)), auth.JWT_SECRET, algorithms=[auth.JWT_ALGORITHM])
    assert payload["sid"] == "poste-e1" and payload["typ"] == "admin_elevation" and payload["admin"] is True
    assert isinstance(payload["iat"], float) and abs(payload["iat"] - auth.horloge()) < 5


def test_f_elevation_d_un_autre_sid_403(client):
    a = create_token("accueil", "Sophie", sid="poste-a")
    b = create_token("accueil", "Sophie", sid="poste-b")           # même membre, autre poste
    eleve_a = create_admin_token(decode_token(a))
    assert client.delete("/api/tickets/1", headers={"Authorization": f"Bearer {a}", "X-Admin-Token": eleve_a}).status_code == 200
    r = client.delete("/api/tickets/1", headers={"Authorization": f"Bearer {b}", "X-Admin-Token": eleve_a})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "admin_expire"
    # Jeton d'élévation sans sid ni iat (forme antérieure) : refusé
    vieux = jwt.encode({"sub": "Sophie", "target": "accueil", "typ": "admin_elevation", "admin": True,
                        "exp": _maintenant() + timedelta(minutes=5)}, auth.JWT_SECRET, algorithm=auth.JWT_ALGORITHM)
    r = client.delete("/api/tickets/1", headers={"Authorization": f"Bearer {a}", "X-Admin-Token": vieux})
    assert r.status_code == 403


@pytest.mark.parametrize("revocation", ["lock", "logout", "switch"])
def test_f_elevation_apres_revocation_403(client, revocation, journal):
    tok = create_token("accueil", "Sophie", sid="poste-r", cx=95)
    journal.lignes[95] = {"fin": None, "fin_motif": None}
    h = {"Authorization": f"Bearer {tok}", "X-Admin-Token": create_admin_token(decode_token(tok))}
    assert client.delete("/api/tickets/1", headers=h).status_code == 200
    if revocation == "lock":
        assert client.post("/api/admin/lock", headers=h).status_code == 200
        suite = tok
    elif revocation == "logout":
        with patch("app.api.auth.presence.fermer_session", lambda user, motif="deconnexion": True):
            assert client.post("/api/auth/logout", headers=h).status_code == 200
        suite = create_token("accueil", "Sophie", sid="poste-r", cx=96)   # reconnexion, même lignée
        journal.lignes[96] = {"fin": None, "fin_motif": None}
    else:
        with patch("app.api.auth.presence.ouvrir_session", lambda *a, **k: 97), \
                patch("app.api.auth._membre_autorise", lambda nom, target: nom):
            r = client.post("/api/auth/switch-user", json={"utilisateur": "Bruno"}, headers=h)
        assert r.status_code == 200
        journal.lignes[97] = {"fin": None, "fin_motif": None}
        suite = create_token("accueil", "Sophie", sid="poste-r", cx=97)   # retour sur Sophie
    assert auth.derniere_revocation("poste-r") > 0
    r = client.delete("/api/tickets/1", headers={"Authorization": f"Bearer {suite}", "X-Admin-Token": h["X-Admin-Token"]})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "admin_expire"
    # Une nouvelle élévation (postérieure à la révocation) vaut de nouveau
    neuf = create_admin_token(decode_token(suite))
    assert client.delete("/api/tickets/1", headers={"Authorization": f"Bearer {suite}", "X-Admin-Token": neuf}).status_code == 200


class _Revocations:
    """revocations_admin simulée (sid → epoch) + journal des connexions ; compte lectures et écritures."""

    def __init__(self, journal, absente=False):
        self.journal, self.absente = journal, absente
        self.epochs, self.lectures, self.ecritures = {}, 0, 0

    def handler(self, sql, params):
        if "revocations_admin" in sql:
            if self.absente:
                import psycopg2

                class _Absente(psycopg2.Error):
                    pgcode = "42P01"
                raise _Absente("relation revocations_admin does not exist")
            if sql.startswith("SELECT revoque_epoch"):
                self.lectures += 1
                return {"revoque_epoch": self.epochs[params[0]]} if params[0] in self.epochs else None
            if sql.startswith("INSERT INTO revocations_admin"):
                self.ecritures += 1
                self.epochs[params[0]] = max(self.epochs.get(params[0], 0.0), params[1])
            return None
        return self.journal.handler(sql, params)


@pytest.fixture
def revocations(request):
    j = _Journal()
    base = _Revocations(j, absente=getattr(request, "param", False))
    with _curseur(base.handler) as (cur, gc), patch("app.api.auth.get_cursor", gc):
        yield base


def _delete(client, tok, eleve):
    return client.delete("/api/tickets/1", headers={"Authorization": f"Bearer {tok}", "X-Admin-Token": eleve})


def test_f_revocation_survit_a_un_redemarrage(client, revocations):
    tok = create_token("accueil", "Sophie", sid="poste-redem", cx=120)
    revocations.journal.ouvrir(120, "poste-redem")
    eleve = create_admin_token(decode_token(tok))
    assert _delete(client, tok, eleve).status_code == 200
    assert client.post("/api/admin/lock", headers={"Authorization": f"Bearer {tok}"}).status_code == 200
    assert revocations.ecritures == 1 and revocations.epochs["poste-redem"] >= auth.derniere_revocation("poste-redem") > 0
    r = _delete(client, tok, eleve)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "admin_expire"
    # Redémarrage du processus : mémoire vide, la base garde la révocation
    auth.oublier_revocations()
    r = _delete(client, tok, eleve)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "admin_expire"
    assert revocations.lectures >= 1
    # Lue une fois puis gardée 30 s ; une nouvelle élévation vaut
    lectures = revocations.lectures
    assert _delete(client, tok, create_admin_token(decode_token(tok))).status_code == 200
    for _ in range(3):
        assert _delete(client, tok, eleve).status_code == 403
    assert revocations.lectures == lectures


def test_f_revocation_jamais_anterieure_au_dernier_jeton_emis(client, revocations, monkeypatch):
    """Horloge murale ramenée en arrière (NTP) entre l'émission et le verrouillage : la révocation
    est datée après le dernier jeton émis sur la lignée, et le jeton suivant après la révocation."""
    tok = create_token("accueil", "Sophie", sid="poste-ntp", cx=130)
    revocations.journal.ouvrir(130, "poste-ntp")
    t0 = auth.horloge()
    eleve = create_admin_token(decode_token(tok))
    monkeypatch.setattr(auth, "horloge", lambda: t0 - 600)       # l'horloge recule de 10 min
    assert client.post("/api/admin/lock", headers={"Authorization": f"Bearer {tok}"}).status_code == 200
    assert auth.derniere_revocation("poste-ntp") > jwt.decode(eleve, auth.JWT_SECRET, algorithms=[auth.JWT_ALGORITHM])["iat"]
    assert _delete(client, tok, eleve).status_code == 403
    neuf = create_admin_token(decode_token(tok))                # émis « dans le passé » mais après la révocation
    assert _delete(client, tok, neuf).status_code == 200


@pytest.mark.parametrize("revocations", [True], indirect=True)
def test_f_table_des_revocations_absente_memoire_seule(client, revocations):
    tok = create_token("accueil", "Sophie", sid="poste-sans-table", cx=140)
    revocations.journal.ouvrir(140, "poste-sans-table")
    eleve = create_admin_token(decode_token(tok))
    assert _delete(client, tok, eleve).status_code == 200
    assert client.post("/api/admin/lock", headers={"Authorization": f"Bearer {tok}"}).status_code == 200
    assert _delete(client, tok, eleve).status_code == 403
    assert _delete(client, tok, create_admin_token(decode_token(tok))).status_code == 200


# ─── G : jeton de suivi expirable ──────────────────────────────────────────

def test_g_jeton_perime_regles():
    jp = public_documents.jeton_perime
    assert jp("Clôturé", _il_y_a(200), jours=180) is True
    assert jp("Rendu au client", _il_y_a(200), jours=180) is True
    assert jp("Clôturé", _il_y_a(10), jours=180) is False
    assert jp("En cours de réparation", _il_y_a(400), jours=180) is False     # dossier ouvert : jamais
    assert jp("Clôturé", None, jours=180) is False                            # aucune date : reste valable
    # date_cloture / date_rendu sont du TEXTE 'AAAA-MM-JJ HH:MM:SS' comparé comme chaîne
    assert jp("Clôturé", None, date_cloture=_il_y_a(200).strftime("%Y-%m-%d %H:%M:%S"), jours=180) is True
    assert jp("Clôturé", None, date_cloture="demain", jours=180) is False
    # La plus récente des dates fait foi : rendu il y a 200 j mais dossier retouché il y a 5 j
    assert jp("Rendu au client", _il_y_a(5), date_rendu=_il_y_a(200).strftime("%Y-%m-%d %H:%M:%S"), jours=180) is False
    assert jp("Clôturé", _il_y_a(200), jours=365) is False


def test_g_duree_parametrable(monkeypatch):
    assert public_documents.SUIVI_JETON_JOURS_DEFAUT == 180
    monkeypatch.setattr(params_cache, "get_param", lambda cle, defaut=None: "30" if cle == "SUIVI_JETON_JOURS" else defaut)
    assert public_documents.suivi_jeton_jours() == 30
    monkeypatch.setattr(params_cache, "get_param", lambda cle, defaut=None: "abc")
    assert public_documents.suivi_jeton_jours() == 180
    monkeypatch.setattr(params_cache, "get_param", lambda cle, defaut=None: "0")
    assert public_documents.suivi_jeton_jours() == 180
    # Semé au démarrage (main._DONNEES_FIXES) et rattrapage RGPD des jetons des clients anonymisés
    from app import main
    fixes = "\n".join(main._DONNEES_FIXES)
    assert "'SUIVI_JETON_JOURS', '180'" in fixes
    assert re.search(r"UPDATE tickets t SET suivi_token = NULL\s+FROM clients c WHERE .*anonymise_le IS NOT NULL", fixes)


def _handler_cloture(jours):
    def h(sql, params):
        if "t.tel_contact, c.telephone AS client_tel" in sql:
            if params[0] != CODE:
                return None
            return {"id": 42, "statut": "Clôturé", "ticket_code": CODE, "suivi_token": JETON,
                    "tel_contact": TEL_CONTACT, "client_tel": TEL_CLIENT, "date_maj": _il_y_a(jours),
                    "date_cloture": _il_y_a(jours).strftime("%Y-%m-%d %H:%M:%S"), "date_rendu": None}
        return _handler(sql, params)
    return h


@pytest.fixture
def cloture_ancienne():
    auth.reset_essais()
    from app.api import suivi as suivi_api
    suivi_api._LIMITEUR._buckets.clear()
    with _curseur(_handler_cloture(200)) as (cur, gc), patch("app.api.suivi.get_cursor", gc), \
            patch("app.api.tickets.get_cursor", gc):
        yield cur
    auth.reset_essais()


def test_g_jeton_d_un_ticket_cloture_depuis_200_j_refuse_numero_accepte(client, cloture_ancienne):
    r = client.get(f"/api/tickets/code/{CODE}", params={"t": JETON}, headers=_ip(10))
    assert r.status_code == 403, r.text
    assert r.json()["detail"]["code"] == "lien_invalide" and "expiré" in r.json()["detail"]["message"]
    assert "Écran" not in r.text
    # Le numéro complet donné au dépôt ouvre toujours le dossier (en-tête, jamais dans l'URL)
    r = client.get(f"/api/tickets/code/{CODE}", headers={**_ip(10), "X-Suivi-Tel": TEL_CLIENT})
    assert r.status_code == 200 and r.json()["statut"] == "Clôturé"
    r = client.get(f"/api/tickets/code/{CODE}", headers={**_ip(10), "X-Suivi-Tel": TEL_CONTACT})
    assert r.status_code == 200
    # Le personnel n'est pas concerné par l'expiration
    assert client.get(f"/api/tickets/code/{CODE}", params={"t": JETON}, headers={**STAFF, **_ip(10)}).status_code == 200


def test_g_jeton_d_un_ticket_cloture_recent_accepte(client):
    auth.reset_essais()
    with _curseur(_handler_cloture(20)) as (cur, gc), patch("app.api.suivi.get_cursor", gc), \
            patch("app.api.tickets.get_cursor", gc):
        r = client.get(f"/api/tickets/code/{CODE}", params={"t": JETON}, headers=_ip(11))
    assert r.status_code == 200, r.text


def test_g_document_public_jeton_perime_404(client, monkeypatch):
    t = {**TICKET, "statut": "Rendu au client", "date_maj": _il_y_a(200), "date_rendu": None, "suivi_token": DOC_TOKEN}
    monkeypatch.setattr(public_documents, "_get_ticket_by_token", lambda tok: t if tok == DOC_TOKEN else None)
    monkeypatch.setattr(public_documents, "_LIMITEUR", public_documents.LimiteurDebit(30, 60))
    assert client.get(f"/api/public/documents/{DOC_TOKEN}/client").status_code == 404
    assert client.get(f"/api/public/documents/{DOC_TOKEN}/recu.pdf").status_code == 404
    # Même réponse qu'un jeton inconnu : pas d'indice
    assert client.get(f"/api/public/documents/{DOC_TOKEN}/client").json() == \
        client.get("/api/public/documents/InconnuInconnuInconnu/client").json()
    t["date_maj"] = _il_y_a(20)
    assert client.get(f"/api/public/documents/{DOC_TOKEN}/client").status_code == 200


def test_g_regenerer_le_jeton(client, auth_headers):
    etat = {"anonymise_le": None, "jeton": JETON}

    def h(sql, params):
        if "SELECT t.id, c.anonymise_le FROM tickets t" in sql:
            return {"id": 42, "anonymise_le": etat["anonymise_le"]} if params[0] == 42 else None
        if sql.startswith("UPDATE tickets SET suivi_token = %s, date_maj = %s WHERE id = %s RETURNING"):
            # Le dossier est daté : le nouveau jeton vaut de nouveau SUIVI_JETON_JOURS jours
            assert params[2] == 42 and re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", params[1])
            etat["jeton"] = params[0]
            return {"suivi_token": params[0]}
        return None
    with _curseur(h) as (cur, gc), patch("app.api.tickets.get_cursor", gc), \
            patch.object(tickets_api, "_ajouter_historique_hors_transaction", lambda *a: None):
        assert client.post("/api/tickets/42/suivi-token/regenerer").status_code == 401
        r = client.post("/api/tickets/42/suivi-token/regenerer", headers=auth_headers)
        assert r.status_code == 200, r.text
        corps = r.json()
        assert corps["id"] == 42 and corps["suivi_token"] == etat["jeton"] != JETON
        assert public_documents._TOKEN_RE.match(corps["suivi_token"])
        assert corps["liens"]["client"].endswith(f"/api/public/documents/{corps['suivi_token']}/client")
        assert client.post("/api/tickets/999/suivi-token/regenerer", headers=auth_headers).status_code == 404
        etat["anonymise_le"] = _maintenant()
        assert client.post("/api/tickets/42/suivi-token/regenerer", headers=auth_headers).status_code == 409


def test_g_rgpd_anonymisation_efface_le_jeton_et_ne_le_recree_pas():
    def h(sql, params):
        if sql.startswith("UPDATE clients SET nom"):
            return [{"id": 7}]
        if sql.startswith("SELECT id FROM"):
            return []
        return None
    with _curseur(h) as (cur, gc), patch("app.api.rgpd.get_cursor", gc), \
            patch("app.api.notifications_center.anonymiser_notifications", lambda *a: None):
        faits, _ = rgpd._anonymiser(cur, [7])
    assert faits == [7]
    maj_tickets = [s for s, p in cur.executed if s.startswith("UPDATE tickets SET imei = NULL") and p == ([7],)]
    assert len(maj_tickets) == 1 and "suivi_token = NULL" in maj_tickets[0]
    # jeton_suivi (création à la volée pour les anciens tickets) : jamais pour un client anonymisé
    def h2(sql, params):
        if sql.startswith("SELECT suivi_token FROM tickets WHERE id"):
            return {"suivi_token": None}
        return None
    with _curseur(h2) as (cur2, gc2), patch("app.api.public_documents.get_cursor", gc2):
        assert public_documents.jeton_suivi(42) is None
    update = next(s for s, p in cur2.executed if s.startswith("UPDATE tickets t SET suivi_token"))
    assert "anonymise_le IS NOT NULL" in update and "t.suivi_token IS NULL" in update


# ─── H : plafonds globaux de la vitrine et des échecs de PIN ───────────────

def _vitrine_handler(sql, params):
    if sql.startswith("INSERT INTO demandes_commandes"):
        return {"id": 1}
    return None


@pytest.fixture
def vitrine(monkeypatch):
    envois = []
    monkeypatch.setattr(iphone_tarifs, "_send_email", lambda dest, sujet, corps: (envois.append(dest), (True, "ok"))[1])
    for lim in (iphone_tarifs._LIMITEUR_VITRINE_IP, iphone_tarifs._LIMITEUR_VITRINE_GLOBAL,
                iphone_tarifs._LIMITEUR_VITRINE_EMAIL):
        lim._buckets.clear()
    tickets_api._RATE_BUCKETS.clear()
    with _curseur(_vitrine_handler) as (cur, gc), patch("app.api.iphone_tarifs.get_cursor", gc):
        yield envois
    for lim in (iphone_tarifs._LIMITEUR_VITRINE_IP, iphone_tarifs._LIMITEUR_VITRINE_GLOBAL,
                iphone_tarifs._LIMITEUR_VITRINE_EMAIL):
        lim._buckets.clear()
    tickets_api._RATE_BUCKETS.clear()


DEVIS = {"nom": "Fictif", "telephone": "0600000000", "modele": "iPhone 12"}
COMMANDE = {**DEVIS, "prix": 500}


def test_h_valeurs_des_plafonds_vitrine_et_pin():
    assert iphone_tarifs.VITRINE_PLAFOND_GLOBAL_H == 20 and iphone_tarifs.VITRINE_PLAFOND_EMAIL_H == 2
    assert iphone_tarifs._LIMITEUR_VITRINE_GLOBAL.fenetre == iphone_tarifs._LIMITEUR_VITRINE_EMAIL.fenetre == 3600
    # Une IP seule n'atteint pas le plafond global : 6/h par IP (toute tentative)
    assert iphone_tarifs.VITRINE_PLAFOND_IP_H == 6 and iphone_tarifs._LIMITEUR_VITRINE_IP.fenetre == 3600
    assert iphone_tarifs.VITRINE_PLAFOND_IP_H < iphone_tarifs.VITRINE_PLAFOND_GLOBAL_H
    assert auth.PIN_ECHECS_GLOBAL_H == 200 and auth._ECHECS_PIN.limite == 200 and auth._ECHECS_PIN.fenetre == 3600


def test_h_depot_distance_une_ip_seule_n_atteint_pas_le_plafond_global():
    from app.api import depot_distance
    lim = depot_distance._LIMITEUR_DEPOT
    par_heure_et_par_ip = lim.limite * lim.fenetre_globale / lim.fenetre
    assert (lim.limite, lim.fenetre, lim.limite_globale) == (4, 600, 30) and par_heure_et_par_ip < lim.limite_globale


def test_h_vitrine_6_par_heure_par_ip_toute_tentative_comptee(client, vitrine):
    # 4 demandes valides + 2 corps invalides (400) depuis la même IP : 6 tentatives, la 7e est refusée
    codes = [client.post("/api/iphone-tarifs/demande-devis", json=DEVIS, headers=_ip(7)).status_code for _ in range(4)]
    codes += [client.post("/api/iphone-tarifs/demande-devis", json={**DEVIS, "nom": "X"}, headers=_ip(7)).status_code
              for _ in range(2)]
    assert codes == [200] * 4 + [400] * 2, codes
    r = client.post("/api/iphone-tarifs/demande-devis", json=DEVIS, headers=_ip(7))
    assert r.status_code == 429 and "cet appareil" in r.json()["detail"] and r.headers.get("retry-after")
    assert client.post("/api/iphone-tarifs/passer-commande", json=COMMANDE, headers=_ip(7)).status_code == 429
    # Une autre IP passe : le plafond global n'a compté que les 4 demandes envoyées
    assert client.post("/api/iphone-tarifs/demande-devis", json=DEVIS, headers=_ip(8)).status_code == 200
    assert len(vitrine) == 5


def test_h_vitrine_un_corps_invalide_ne_consomme_pas_le_plafond_global(client, vitrine):
    for i in range(20):
        route = "/api/iphone-tarifs/demande-devis" if i % 2 else "/api/iphone-tarifs/passer-commande"
        assert client.post(route, json={**COMMANDE, "nom": "X"}, headers=_ip(300 + i)).status_code == 400
    assert client.post("/api/iphone-tarifs/demande-devis", json=DEVIS, headers=_ip(330)).status_code == 200
    assert vitrine == ["contact@klikphone.com"] or len(vitrine) == 1


def test_h_vitrine_refus_par_adresse_ne_consomme_pas_le_plafond_global(client, vitrine):
    corps = {**DEVIS, "email": "spam@example.test"}
    assert [client.post("/api/iphone-tarifs/demande-devis", json=corps, headers=_ip(400 + i)).status_code
            for i in range(2)] == [200, 200]
    for i in range(18):   # 18 refus par adresse : 18 IP différentes, aucun créneau global consommé
        assert client.post("/api/iphone-tarifs/demande-devis", json=corps, headers=_ip(410 + i)).status_code == 429
    assert [client.post("/api/iphone-tarifs/demande-devis", json=DEVIS, headers=_ip(450 + i)).status_code
            for i in range(18)] == [200] * 18
    assert client.post("/api/iphone-tarifs/demande-devis", json=DEVIS, headers=_ip(480)).status_code == 429


def test_h_vitrine_doublon_ne_consomme_pas_le_plafond_global(client):
    def handler(sql, params):
        if "FROM demandes_commandes" in sql:
            return {"id": 7}                 # même tel + modèle + prix dans la minute
        return None
    for lim in (iphone_tarifs._LIMITEUR_VITRINE_IP, iphone_tarifs._LIMITEUR_VITRINE_GLOBAL):
        lim._buckets.clear()
    with _curseur(handler) as (cur, gc), patch("app.api.iphone_tarifs.get_cursor", gc), \
            patch.object(iphone_tarifs, "_send_email", lambda *a: (True, "ok")):
        r = client.post("/api/iphone-tarifs/passer-commande", json=COMMANDE, headers=_ip(44))
        assert r.status_code == 200 and r.json()["deduped"] is True
    assert len(iphone_tarifs._LIMITEUR_VITRINE_GLOBAL._buckets.get(iphone_tarifs._CLE_VITRINE, ())) == 0
    assert len(iphone_tarifs._LIMITEUR_VITRINE_IP._buckets.get("10.42.0.44", ())) == 1   # la tentative compte pour l'IP
    iphone_tarifs._LIMITEUR_VITRINE_IP._buckets.clear()


def test_h_vitrine_20_par_heure_toutes_ip_confondues(client, vitrine):
    codes = []
    for i in range(20):
        route = "/api/iphone-tarifs/demande-devis" if i % 2 else "/api/iphone-tarifs/passer-commande"
        corps = DEVIS if i % 2 else {**COMMANDE, "modele": f"iPhone {i}"}
        codes.append(client.post(route, json=corps, headers=_ip(100 + i)).status_code)
    assert codes == [200] * 20, codes
    # 21e demande, depuis une IP encore jamais vue : plafond global
    r = client.post("/api/iphone-tarifs/demande-devis", json=DEVIS, headers=_ip(200))
    assert r.status_code == 429 and "vitrine" in r.json()["detail"] and "appelez la boutique" in r.json()["detail"]
    assert r.headers.get("retry-after")
    r = client.post("/api/iphone-tarifs/passer-commande", json=COMMANDE, headers=_ip(201))
    assert r.status_code == 429
    assert len(vitrine) == 20                         # aucun e-mail envoyé au-delà du plafond


def test_h_vitrine_2_par_heure_par_adresse_email(client, vitrine):
    corps = {**DEVIS, "email": "Client@Example.test"}
    assert client.post("/api/iphone-tarifs/demande-devis", json=corps, headers=_ip(1)).status_code == 200
    # Casse et IP différentes : même adresse
    corps2 = {**COMMANDE, "email": "client@example.test"}
    assert client.post("/api/iphone-tarifs/passer-commande", json=corps2, headers=_ip(2)).status_code == 200
    r = client.post("/api/iphone-tarifs/demande-devis", json=corps, headers=_ip(3))
    assert r.status_code == 429 and "adresse e-mail" in r.json()["detail"]
    # Une autre adresse passe ; les e-mails de confirmation ont bien été envoyés pour les deux premières
    assert client.post("/api/iphone-tarifs/demande-devis", json={**DEVIS, "email": "autre@example.test"},
                       headers=_ip(4)).status_code == 200
    assert vitrine.count("client@example.test") + vitrine.count("Client@Example.test") == 2


def _pin_handler(sql, params):
    if "FROM params WHERE cle = %s" in sql:
        return {"valeur": {"PIN_ACCUEIL": "1234", "PIN_TECH": "5678"}[params[0]]}
    return None


def test_h_plafond_global_d_echecs_de_pin(client, monkeypatch):
    monkeypatch.setattr(auth, "_ECHECS_PIN", auth.FenetreEchecs(limite=6, fenetre=3600))
    auth.reset_essais()
    with _curseur(_pin_handler) as (cur, gc), patch("app.api.auth.get_cursor", gc):
        # Un échec par IP (aucune IP n'atteint son propre verrou de 5) : le plafond global compte
        codes = [client.post("/api/auth/login", json={"pin": "0000", "target": "tech"}, headers=_ip(50 + i)).status_code
                 for i in range(6)]
        assert codes == [401, 401, 401, 401, 401, 429], codes
        # Bon PIN depuis une IP neuve, et depuis un poste « connu » : suspendu pour tous
        r = client.post("/api/auth/login", json={"pin": "5678", "target": "tech"}, headers=_ip(60))
        assert r.status_code == 429 and "ensemble des postes" in r.json()["detail"]
        assert int(r.headers["retry-after"]) > 0
        auth._IP_CONNUES.noter("10.42.0.61")
        assert client.post("/api/auth/login", json={"pin": "5678", "target": "tech"}, headers=_ip(61)).status_code == 429
        # La fenêtre glisse : une heure plus tard, la connexion reprend
        t = auth.monotonic()
        monkeypatch.setattr(auth, "monotonic", lambda: t + 3601)
        assert client.post("/api/auth/login", json={"pin": "5678", "target": "tech"}, headers=_ip(60)).status_code == 200
    auth.reset_essais()


# ─── I : une seule fonction client_ip, KP_TRUST_PROXY ──────────────────────

def _requete(xff=None, hote="3.3.3.3"):
    headers = [(b"x-forwarded-for", xff.encode())] if xff else []
    return Request({"type": "http", "headers": headers, "client": (hote, 1)})


def test_i_client_ip_selon_kp_trust_proxy(monkeypatch):
    monkeypatch.delenv("KP_TRUST_PROXY", raising=False)
    assert auth.proxy_de_confiance() is True                       # défaut : Railway
    assert auth.client_ip(_requete("1.1.1.1, 2.2.2.2")) == "2.2.2.2"   # dernière valeur, jamais la première
    assert auth.client_ip(_requete()) == "3.3.3.3"
    monkeypatch.setenv("KP_TRUST_PROXY", "0")
    assert auth.proxy_de_confiance() is False
    assert auth.client_ip(_requete("1.1.1.1, 2.2.2.2")) == "3.3.3.3"   # en-tête ignoré
    monkeypatch.setenv("KP_TRUST_PROXY", "1")
    assert auth.client_ip(_requete("9.9.9.9")) == "9.9.9.9"


def test_i_xff_ignore_avec_kp_trust_proxy_0(client, monkeypatch):
    monkeypatch.setenv("KP_TRUST_PROXY", "0")
    auth.reset_essais()
    with _curseur(_pin_handler) as (cur, gc), patch("app.api.auth.get_cursor", gc):
        # Chaque essai « change » d'IP dans l'en-tête : sans proxy, tous viennent du même client
        codes = [client.post("/api/auth/login", json={"pin": "0000", "target": "tech"},
                             headers={"X-Forwarded-For": f"10.77.0.{i}"}).status_code for i in range(6)]
        assert codes == [401, 401, 401, 401, 429, 429]
        assert client.post("/api/auth/login", json={"pin": "5678", "target": "tech"},
                           headers={"X-Forwarded-For": "10.77.0.99"}).status_code == 429
    auth.reset_essais()


def test_i_garde_au_demarrage_reglage_proxy(monkeypatch, capsys):
    for v in auth._VARIABLES_RAILWAY + ("KP_TRUST_PROXY", "BACKEND_URL", "FORWARDED_ALLOW_IPS"):
        monkeypatch.delenv(v, raising=False)
    # Railway (RAILWAY_*) avec KP_TRUST_PROXY=0 : erreur explicite
    monkeypatch.setenv("RAILWAY_ENVIRONMENT", "production")
    monkeypatch.setenv("KP_TRUST_PROXY", "0")
    assert auth.en_production() is True
    m = auth.verifier_reglage_proxy()
    assert any(x.startswith("ERREUR") and "KP_TRUST_PROXY=0" in x for x in m)
    assert "ERREUR" in capsys.readouterr().out
    # Railway avec le défaut : rien à signaler
    monkeypatch.delenv("KP_TRUST_PROXY")
    assert auth.verifier_reglage_proxy() == []
    # Hors Railway, défaut (1) sans BACKEND_URL : avertissement ; BACKEND_URL posée : rien
    monkeypatch.delenv("RAILWAY_ENVIRONMENT")
    assert auth.en_production() is False
    assert any(x.startswith("AVERTISSEMENT") for x in auth.verifier_reglage_proxy())
    monkeypatch.setenv("BACKEND_URL", "https://sav.example.test")
    assert auth.verifier_reglage_proxy() == []
    # Hors Railway avec 0 : note sur proxy-headers d'uvicorn, levée par FORWARDED_ALLOW_IPS
    monkeypatch.setenv("KP_TRUST_PROXY", "0")
    assert any("--no-proxy-headers" in x for x in auth.verifier_reglage_proxy())
    monkeypatch.setenv("FORWARDED_ALLOW_IPS", "")
    assert auth.verifier_reglage_proxy() == []


def test_i_xff_absent_signale_une_seule_fois(monkeypatch, capsys):
    monkeypatch.delenv("KP_TRUST_PROXY", raising=False)
    monkeypatch.setattr(auth, "_XFF_ABSENT_SIGNALE", [False])
    assert auth.client_ip(_requete()) == "3.3.3.3" and auth.client_ip(_requete()) == "3.3.3.3"
    out = capsys.readouterr().out
    assert out.count("X-Forwarded-For absent") == 1 and "KP_TRUST_PROXY=0" in out
    assert auth.client_ip(_requete("1.1.1.1")) == "1.1.1.1" and capsys.readouterr().out == ""


def test_i_une_seule_fonction_client_ip():
    assert not hasattr(public_documents, "ip_client") and not hasattr(tracking, "_client_ip")
    assert public_documents.client_ip is auth.client_ip and tracking.client_ip is auth.client_ip
    assert tickets_api.client_ip is auth.client_ip
    racine = Path(auth.__file__).resolve().parents[1]
    lecteurs = [str(p.relative_to(racine)) for p in racine.rglob("*.py")
                if re.search(r"x-forwarded-for", p.read_text(encoding="utf-8"), re.I)
                and re.search(r"headers\.get\(\s*['\"]x-forwarded-for", p.read_text(encoding="utf-8"), re.I)]
    assert lecteurs == ["api/auth.py"], lecteurs
    # Plafond d'échecs de PIN compté toutes IP confondues (cible pin:* seulement)
    assert auth._cible_pin("pin:tech") and not auth._cible_pin("admin") and not auth._cible_pin("suivi:KP-1")


# ─── J : origine des liens de partage ──────────────────────────────────────

def _req_hote(**headers):
    h = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    return Request({"type": "http", "headers": h, "client": ("3.3.3.3", 1), "scheme": "http",
                    "server": ("api.interne", 8000), "path": "/", "query_string": b""})


@pytest.fixture
def projet(monkeypatch):
    monkeypatch.setattr(public_documents, "_get_frontend_url", lambda: "https://suivi.example.test")
    for v in ("BACKEND_URL", "RAILWAY_STATIC_URL", "KP_HOTES_SUPPLEMENTAIRES") + auth._VARIABLES_RAILWAY:
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setenv("FRONTEND_URL", "https://sav.example.test")
    monkeypatch.setenv("RAILWAY_PUBLIC_DOMAIN", "klikphone-sav-v2-production.up.railway.app")   # production


def test_j_hotes_autorises(projet, monkeypatch):
    ok = public_documents.hote_autorise
    assert ok("suivi.example.test") and ok("sav.example.test") and ok("SAV.example.test:443")
    assert ok("klikphone-sav-v2-production.up.railway.app")
    # Correspondance exacte seulement : les sous-domaines Railway vont au premier demandeur
    assert not ok("klikphone-sav-v2-staging.up.railway.app") and not ok("klikphone-sav-v2-evil.up.railway.app")
    assert not ok("klikphone-sav-v2-production.up.railway.app.evil.net")
    assert not ok("autre-production.up.railway.app") and not ok("klikphone-sav-v3-production.up.railway.app")
    assert not ok("evil.example.test") and not ok("sav.example.test.evil.net")
    assert not ok("sav.example.test/x?y=") and not ok("") and not ok("sav.example.test@evil.net")
    # Hôtes locaux : refusés en production (RAILWAY_*), acceptés hors production
    assert not ok("localhost:5173") and not ok("127.0.0.1:8000") and not ok("[::1]:8000")
    monkeypatch.delenv("RAILWAY_PUBLIC_DOMAIN")
    assert not public_documents.en_production()
    assert ok("localhost:5173") and ok("127.0.0.1:8000") and ok("[::1]:8000")
    assert not ok("klikphone-sav-v2-production.up.railway.app")      # plus dans la liste
    # Environnement de recette déclaré explicitement
    monkeypatch.setenv("KP_HOTES_SUPPLEMENTAIRES", " recette.example.test , https://klikphone-sav-v2-staging.up.railway.app ")
    assert ok("recette.example.test") and ok("klikphone-sav-v2-staging.up.railway.app:443")
    assert not ok("klikphone-sav-v2-staging2.up.railway.app")
    assert not hasattr(public_documents, "_prefixes_railway") and not hasattr(public_documents, "_RAILWAY_SUFFIXE")


def test_j_x_forwarded_host_forge_ignore(projet):
    liens = public_documents.liens_partage
    forge = liens(DOC_TOKEN, _req_hote(**{"X-Forwarded-Host": "evil.example.test", "X-Forwarded-Proto": "https",
                                           "Host": "sav.example.test"}))
    assert forge["client"] == f"https://suivi.example.test/api/public/documents/{DOC_TOKEN}/client"
    assert "evil" not in str(forge)
    assert public_documents._origine_requete(_req_hote(**{"X-Forwarded-Host": "evil.example.test"})) is None
    # Hôte du projet annoncé par le proxy : repris ; schéma exotique : refusé
    assert public_documents._origine_requete(_req_hote(**{"X-Forwarded-Host": "sav.example.test",
                                                         "X-Forwarded-Proto": "https"})) == "https://sav.example.test"
    assert public_documents._origine_requete(_req_hote(**{"Host": "klikphone-sav-v2-production.up.railway.app"})) \
        == "http://klikphone-sav-v2-production.up.railway.app"
    assert public_documents._origine_requete(_req_hote(**{"Host": "klikphone-sav-v2-pr-12.up.railway.app"})) is None
    assert public_documents._origine_requete(_req_hote(**{"X-Forwarded-Host": "localhost:8000"})) is None   # production
    assert public_documents._origine_requete(_req_hote(**{"X-Forwarded-Host": "sav.example.test",
                                                         "X-Forwarded-Proto": "javascript"})) is None


def test_j_share_links_hote_forge_repli(client, auth_headers, projet, monkeypatch):
    monkeypatch.setattr(public_documents, "jeton_suivi", lambda tid: DOC_TOKEN if tid == 42 else None)
    h = {**auth_headers, "X-Forwarded-Host": "evil.example.test", "X-Forwarded-Proto": "https"}
    r = client.get("/api/tickets/42/share-links", headers=h)
    assert r.status_code == 200
    assert all(v.startswith("https://suivi.example.test/api/public/documents/") for v in r.json().values())
    h = {**auth_headers, "X-Forwarded-Host": "sav.example.test", "X-Forwarded-Proto": "https"}
    assert client.get("/api/tickets/42/share-links", headers=h).json()["client"].startswith("https://sav.example.test/")
