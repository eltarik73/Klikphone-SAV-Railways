"""Impressions : authentification, échappement, gabarits thermiques, PDF, liens publics par jeton."""

import json
import re
import threading
import zlib
from contextlib import contextmanager
from datetime import datetime
from unittest.mock import MagicMock

import pytest

from app.api import attestation, print_tickets, public_documents, tickets

TOKEN = "AbCdEfGhIjKlMnOpQrStUv"
TYPES = ("client", "staff", "combined", "devis", "recu")


def _ticket(**extra):
    t = {
        "id": 42, "ticket_code": "KP-000042", "client_id": 7,
        "client_prenom": "<script>alert('x')</script>", "client_nom": "O’Neil",
        "client_tel": "06 00 00 00 00", "client_email": "test@example.invalid",
        "marque": None, "modele": None, "modele_autre": None, "categorie": "Smartphone",
        "panne": "Écran casse", "panne_detail": "l’écran — <img src=x onerror=alert(1)> tactile HS",
        "imei": "356789012345678", "pin": "<b>1234</b>", "pattern": "1-5-9",
        "notes_client": "Note <i>client</i>", "technicien_assigne": "Tech",
        "date_depot": datetime(2026, 7, 1, 8, 12), "date_recuperation": "Demain <u>18h</u>",
        "type_ecran": "OLED", "devis_estime": 129, "acompte": 0, "paye": 0,
        "statut": "En cours de réparation", "reparation_supp": None,
        "suivi_token": TOKEN,
    }
    t.update(extra)
    return t


@pytest.fixture
def fake_ticket(monkeypatch):
    t = _ticket()
    monkeypatch.setattr(print_tickets, "_get_ticket_full", lambda tid: t if tid == 42 else None)
    monkeypatch.setattr(public_documents, "_get_ticket_by_token", lambda tok: t if tok == TOKEN else None)
    monkeypatch.setattr(public_documents, "_LIMITEUR", public_documents.LimiteurDebit(30, 60))
    return t


# ─── Authentification ──────────────────────────────────────────

@pytest.mark.parametrize("path", [f"/api/tickets/42/print/{k}" for k in TYPES] + [
    "/api/tickets/42/pdf/devis", "/api/tickets/42/pdf/recu", "/api/devis/1/print", "/api/tickets/42/share-links",
])
def test_impressions_exigent_une_session(client, fake_ticket, path):
    assert client.get(path).status_code == 401


@pytest.mark.parametrize("kind", TYPES)
def test_impression_authentifiee(client, auth_headers, fake_ticket, kind):
    r = client.get(f"/api/tickets/42/print/{kind}", headers=auth_headers)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    csp = r.headers["content-security-policy"]
    assert "default-src 'none'" in csp and "script-src" not in csp and "frame-ancestors 'none'" in csp
    assert r.headers["cache-control"] == "no-store"


def test_ticket_inconnu_404(client, auth_headers, fake_ticket):
    assert client.get("/api/tickets/999/print/client", headers=auth_headers).status_code == 404
    assert client.get("/api/tickets/999/pdf/devis", headers=auth_headers).status_code == 404
    assert client.get("/api/tickets/42/pdf/staff", headers=auth_headers).status_code == 400


# ─── Échappement et gabarits ───────────────────────────────────

@pytest.mark.parametrize("kind", TYPES)
def test_toutes_les_valeurs_sont_echappees(kind):
    html = print_tickets.render_html(_ticket(), kind)
    assert "<script>alert" not in html
    assert "<img src=x" not in html
    assert "onerror" not in html.replace("onerror=alert(1)&gt;", "")
    assert "&lt;script&gt;" in html
    assert "<meta http-equiv=\"Content-Security-Policy\" content=\"script-src 'none'" in html


def test_echappement_staff_et_retour_ligne():
    html = print_tickets.render_html(_ticket(notes_client="a\nb"), "client")
    assert "a<br>b" in html
    staff = print_tickets.render_html(_ticket(), "staff")
    assert "&lt;b&gt;1234&lt;/b&gt;" in staff and "<b>1234</b>" not in staff


@pytest.mark.parametrize("kind", TYPES)
def test_css_thermique_valide_et_monochrome(kind):
    html = print_tickets.render_html(_ticket(est_retour_sav=True, ticket_original_code="KP-000001", paye=1), kind)
    assert "80mm auto" not in html
    assert not re.search(r"@page\s*\{[^}]*size", html)
    assert "overflow-wrap:anywhere" in html
    for couleur in ("#059669", "#DC2626", "#FEF2F2", "#991B1B", "#999"):
        assert couleur not in html
    assert not re.search("[\U0001F300-\U0001FAFF]", html)


def test_logo_thermique_embarque():
    uri = print_tickets._logo_thermique_uri()
    assert uri.startswith("data:image/png;base64,") and len(uri) < 8000
    html = print_tickets.render_html(_ticket(), "client")
    assert f'<img src="{uri}" class="logo-img"' in html and "/logo_k.png" not in html


def test_combined_un_document_deux_pages():
    html = print_tickets.render_html(_ticket(), "combined")
    assert html.count("<html") == 1 and html.count("<body>") == 1
    assert re.findall(r'data-print-page="(\w+)"', html) == ["client", "staff"]
    assert "break-before:page" in html


def test_appareil_manquant_sans_none():
    for kind in TYPES:
        assert "None" not in print_tickets.render_html(_ticket(), kind)
    t = _ticket(marque="Apple", modele="iPhone 15")
    assert "Apple iPhone 15" in print_tickets.render_html(t, "client")


def test_lignes_via_prestations_et_badge_ecran():
    t = _ticket(reparation_supp=json.dumps([
        {"label": "Forfait remplacement batterie", "prix": 59},
        {"label": "Forfait remplacement écran", "prix": ""},
    ]))
    staff = print_tickets.render_html(t, "staff")
    batterie, ecran = re.findall(r'<div class="row line"[^>]*><span>(.*?)</span>', staff)[:2]
    assert "badge" not in batterie and 'class="badge">OLED' in ecran
    client = print_tickets.render_html(_ticket(), "client")
    assert "Forfait remplacement écran" in client and "129,00 €" in client
    assert "Motif :</span><span class=\"val\">Écran casse" in client


def test_heure_de_paris():
    assert print_tickets._fd(datetime(2026, 7, 1, 8, 12)) == "01/07/2026 10:12"
    assert print_tickets._fd(datetime(2026, 1, 15, 8, 12)) == "15/01/2026 09:12"
    assert "01/07/2026 10:12" in print_tickets.render_html(_ticket(), "client")


def test_heure_de_paris_sans_base_tz(monkeypatch):
    monkeypatch.setattr(print_tickets, "_PARIS", None)
    assert print_tickets._fd(datetime(2026, 7, 1, 8, 12)) == "01/07/2026 10:12"
    assert print_tickets._fd(datetime(2026, 1, 15, 8, 12)) == "15/01/2026 09:12"
    assert print_tickets._fd(datetime(2026, 3, 29, 0, 59)) == "29/03/2026 01:59"
    assert print_tickets._fd(datetime(2026, 3, 29, 1, 0)) == "29/03/2026 03:00"
    assert print_tickets._fd(datetime(2026, 10, 25, 0, 59)) == "25/10/2026 02:59"
    assert print_tickets._fd(datetime(2026, 10, 25, 1, 0)) == "25/10/2026 02:00"


def test_devis_manuel_echappe(client, auth_headers, monkeypatch):
    from contextlib import contextmanager
    from app.api import devis as devis_api

    class Cur:
        def execute(self, sql, params=None):
            self.sql = sql

        def fetchone(self):
            if "FROM devis WHERE" in self.sql:
                return {
                    "id": 1, "numero": "DEV-<b>1</b>", "client_id": None, "statut": "brouillon",
                    "client_nom": "<script>alert(1)</script>", "client_prenom": "O’Neil",
                    "client_tel": "06", "client_email": None, "appareil": "<img src=x onerror=alert(2)>",
                    "description": "l’écran\n<i>x</i>", "notes": "<svg onload=alert(3)>", "remise": 0,
                    "total_ht": 100, "tva": 20, "total_ttc": 120, "validite_jours": None,
                    "date_creation": datetime(2026, 10, 15, 9, 0),
                }
            return None

        def fetchall(self):
            if "devis_lignes" in self.sql:
                return [{"description": "<b>Écran</b>", "quantite": 1, "prix_unitaire": "", "total": 100}]
            return []

    @contextmanager
    def fake_cursor():
        yield Cur()

    monkeypatch.setattr(devis_api, "get_cursor", fake_cursor)
    r = client.get("/api/devis/1/print", headers=auth_headers)
    assert r.status_code == 200
    for brut in ("<script>alert", "<img src=x", "<svg", "<b>1</b>", "<b>Écran", "<i>x"):
        assert brut not in r.text
    assert "&lt;script&gt;" in r.text and "&lt;b&gt;Écran&lt;/b&gt;" in r.text and "Validité : 30 jours" in r.text
    assert "default-src 'none'" in r.headers["content-security-policy"]


# ─── PDF ───────────────────────────────────────────────────────

@pytest.mark.parametrize("kind", ("devis", "recu"))
def test_pdf_typographie_ios(client, auth_headers, fake_ticket, kind):
    fake_ticket["reparation_supp"] = json.dumps([
        {"label": "Réparation – l’écran “OLED” …", "prix": "189"}, {"label": "Diagnostic", "prix": ""},
    ])
    fake_ticket["client_societe"] = "Société — test ’ 😀"
    r = client.get(f"/api/tickets/42/pdf/{kind}", headers=auth_headers)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF")
    assert f'filename="{"Devis" if kind == "devis" else "Recu"}-KP-000042.pdf"' in r.headers["content-disposition"]


# ─── Liens publics par jeton ───────────────────────────────────

@pytest.mark.parametrize("kind", ("client", "devis", "recu"))
def test_document_public_html(client, fake_ticket, kind):
    r = client.get(f"/api/public/documents/{TOKEN}/{kind}")
    assert r.status_code == 200
    assert "KP-000042" in r.text and "&lt;script&gt;" in r.text
    assert "default-src 'none'" in r.headers["content-security-policy"]


@pytest.mark.parametrize("kind", ("staff", "combined", "autre", "pdf"))
def test_fiche_atelier_jamais_publique(client, fake_ticket, kind):
    assert client.get(f"/api/public/documents/{TOKEN}/{kind}").status_code == 404


@pytest.mark.parametrize("kind", ("devis", "recu"))
def test_document_public_pdf(client, fake_ticket, kind):
    r = client.get(f"/api/public/documents/{TOKEN}/{kind}.pdf")
    assert r.status_code == 200 and r.content.startswith(b"%PDF")


@pytest.mark.parametrize("path", [
    "/api/public/documents/{t}/client.pdf", "/api/public/documents/{t}/staff.pdf",
    "/api/public/documents/InconnuInconnuInconnu1/client", "/api/public/documents/42/client",
    "/api/public/documents/KP-000042/client", "/api/public/documents/court/recu.pdf",
])
def test_document_public_refuse(client, fake_ticket, path):
    assert client.get(path.format(t=TOKEN)).status_code == 404


def test_document_public_rate_limit(client, fake_ticket):
    codes = [client.get("/api/public/documents/InconnuInconnuInconnu1/client").status_code for _ in range(31)]
    assert codes[:30] == [404] * 30 and codes[30] == 429


def test_document_public_rate_limit_xff_falsifie(client, fake_ticket):
    url = "/api/public/documents/InconnuInconnuInconnu1/client"
    for i in range(30):
        assert client.get(url, headers={"X-Forwarded-For": f"10.0.0.{i}, 203.0.113.9"}).status_code == 404
    # Changer la partie fournie par le client ne contourne plus la limite
    assert client.get(url, headers={"X-Forwarded-For": "198.51.100.1, 203.0.113.9"}).status_code == 429
    assert client.get(url, headers={"X-Forwarded-For": "203.0.113.10"}).status_code == 404


def test_limiteur_memoire_bornee(monkeypatch):
    lim = public_documents.LimiteurDebit(limite=2, fenetre=60, max_ips=100)
    horloge = [1000.0]
    monkeypatch.setattr(public_documents, "time", lambda: horloge[0])
    for i in range(1000):
        lim.verifier(f"ip-{i}")
    assert len(lim) == 100
    # Les entrées périmées sont purgées dès l'accès suivant, quelle que soit l'IP
    horloge[0] += 61
    lim.verifier("autre")
    assert len(lim) == 1
    lim.verifier("autre")
    with pytest.raises(Exception) as exc:
        lim.verifier("autre")
    assert exc.value.status_code == 429


def test_limiteur_concurrent_sans_erreur():
    lim = public_documents.LimiteurDebit(limite=5, fenetre=60, max_ips=50)
    erreurs = []

    def tir(n):
        for i in range(400):
            try:
                lim.verifier(f"{n}-{i % 120}")
            except Exception as e:
                if getattr(e, "status_code", None) != 429:
                    erreurs.append(e)

    fils = [threading.Thread(target=tir, args=(n,)) for n in range(8)]
    for f in fils:
        f.start()
    for f in fils:
        f.join()
    assert erreurs == [] and len(lim) <= 50


def _liens(base):
    b = f"{base}/api/public/documents/{TOKEN}"
    return {
        "client": f"{b}/client", "devis": f"{b}/devis", "recu": f"{b}/recu",
        "devis_pdf": f"{b}/devis.pdf", "recu_pdf": f"{b}/recu.pdf",
    }


@pytest.fixture
def share(monkeypatch, fake_ticket):
    monkeypatch.setattr(public_documents, "jeton_suivi", lambda tid: TOKEN if tid == 42 else None)
    monkeypatch.setattr(public_documents, "_get_frontend_url", lambda: "https://suivi.example.test")
    monkeypatch.delenv("BACKEND_URL", raising=False)


def test_share_links_origine_de_la_requete(client, auth_headers, share):
    h = {**auth_headers, "Host": "sav.example.test", "X-Forwarded-Proto": "https"}
    r = client.get("/api/tickets/42/share-links", headers=h)
    assert r.status_code == 200
    assert r.json() == _liens("https://sav.example.test")
    assert "staff" not in json.dumps(r.json())
    assert client.get("/api/tickets/7/share-links", headers=auth_headers).status_code == 404


def test_share_links_backend_url_prioritaire(client, auth_headers, share, monkeypatch):
    monkeypatch.setenv("BACKEND_URL", "https://api.example.test/")
    r = client.get("/api/tickets/42/share-links", headers={**auth_headers, "Host": "autre.example.test"})
    assert r.json() == _liens("https://api.example.test")


def test_share_links_hote_invalide_repli_url_suivi(client, auth_headers, share):
    h = {**auth_headers, "X-Forwarded-Host": "evil.example.test/x?y=", "X-Forwarded-Proto": "javascript"}
    assert client.get("/api/tickets/42/share-links", headers=h).json() == _liens("https://suivi.example.test")
    assert public_documents.liens_partage(TOKEN) == _liens("https://suivi.example.test")


def test_creation_ticket_sans_colonne_jeton(client, monkeypatch):
    executes = []

    @contextmanager
    def cursor():
        cur = MagicMock()
        cur.execute.side_effect = lambda q, p=None: executes.append(q)
        cur.fetchone.return_value = {"id": 5}
        yield cur

    def jeton_ko(tid):
        raise RuntimeError('column "suivi_token" does not exist')

    monkeypatch.setattr(tickets, "get_cursor", cursor)
    monkeypatch.setattr(tickets, "learn_terms", lambda *_: None)
    monkeypatch.setattr(tickets, "notif_nouveau_ticket", lambda *_: None)
    monkeypatch.setattr(public_documents, "jeton_suivi", jeton_ko)
    r = client.post("/api/tickets", json={"client_id": 1, "categorie": "Smartphone", "marque": "Apple", "panne": "Batterie"})
    assert r.status_code == 200 and r.json() == {"id": 5, "ticket_code": "KP-000005"}
    assert not any("suivi_token" in q for q in executes)


def test_creation_ticket_attribue_un_jeton(client, monkeypatch):
    vus = []

    @contextmanager
    def cursor():
        cur = MagicMock()
        cur.fetchone.return_value = {"id": 6}
        yield cur

    monkeypatch.setattr(tickets, "get_cursor", cursor)
    monkeypatch.setattr(tickets, "learn_terms", lambda *_: None)
    monkeypatch.setattr(tickets, "notif_nouveau_ticket", lambda *_: None)
    monkeypatch.setattr(public_documents, "jeton_suivi", lambda tid: vus.append(tid) or TOKEN)
    r = client.post("/api/tickets", json={"client_id": 1, "categorie": "Smartphone", "marque": "Apple", "panne": "Batterie"})
    assert r.status_code == 200 and vus == [6]


# ─── Pièce à commander : seul le nom de la pièce sort chez le client ─

def _textes_pdf(pdf: bytes) -> bytes:
    flux = re.findall(rb"stream\r?\n(.*?)\r?\nendstream", pdf, re.S)
    out = b""
    for f in flux:
        try:
            out += zlib.decompress(f)
        except zlib.error:
            out += f
    return out


def test_piece_a_commander_notes_internes_masquees(client, auth_headers, fake_ticket):
    fake_ticket.update(panne="Pièce à commander", panne_detail="Écran OLED iPhone 14 — MobileSentrix réf 123")
    for kind in ("client", "devis", "recu"):
        html = print_tickets.render_html(fake_ticket, kind)
        assert "MobileSentrix" not in html
    assert "Écran OLED iPhone 14" in print_tickets.render_html(fake_ticket, "client")
    # La fiche atelier garde le détail complet
    assert "MobileSentrix réf 123" in print_tickets.render_html(fake_ticket, "staff")
    r = client.get(f"/api/public/documents/{TOKEN}/client")
    assert r.status_code == 200 and "MobileSentrix" not in r.text
    for kind in ("devis", "recu"):
        pdf = client.get(f"/api/public/documents/{TOKEN}/{kind}.pdf").content
        texte = _textes_pdf(pdf)
        assert b"MobileSentrix" not in texte and b"OLED iPhone 14" in texte


# ─── Attestation de non-réparabilité ───────────────────────────

def _attestation(**extra):
    champs = {
        "nom": "<script>alert(1)</script>", "prenom": "<img src=x onerror=alert(2)>",
        "adresse": '<meta http-equiv="refresh" content="0;url=https://exemple.invalid">',
        "marque": "<b>Apple</b>", "modele": '<a href="https://exemple.invalid">iPhone</a>',
        "imei": "<svg onload=alert(3)>", "etat": '"><link rel=stylesheet href=//exemple.invalid/x.css>',
        "motif": "Ligne 1 <i>x</i>\nl’apostrophe — tiret", "compte_rendu": "<script>alert(4)</script>\r\nfin",
    }
    champs.update(extra)
    return attestation.AttestationRequest(**champs)


def test_attestation_html_echappe():
    html = attestation._generate_attestation_html(_attestation())
    for brut in ("<script>alert", "<img src=x", "<meta http-equiv=\"refresh", "<b>Apple", "<a href",
                 "<svg", "<link rel", "<i>x"):
        assert brut not in html, brut
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html and "&lt;b&gt;Apple&lt;/b&gt;" in html
    assert "Ligne 1 &lt;i&gt;x&lt;/i&gt;<br>l’apostrophe — tiret" in html
    assert "&lt;/script&gt;<br>fin" in html
    assert "onerror=" not in html.replace("onerror=alert(2)&gt;", "")
    assert "<meta http-equiv=\"Content-Security-Policy\" content=\"script-src 'none'" in html


def test_attestation_marges_impression():
    html = attestation._generate_attestation_html(_attestation(nom="Martin", compte_rendu=""))
    css = html[html.index("<style>"):html.index("</style>")]
    # La règle print doit venir après « body { … padding: 40px } » pour l'emporter
    assert css.index("@media print") > css.index("padding: 40px")
    assert "Compte-rendu technique" not in html
    assert "—" in html  # adresse / IMEI / état vides


def test_attestation_generate_echappe(client, auth_headers, monkeypatch):
    monkeypatch.setattr(attestation, "_save_attestation", lambda *a, **k: 1)
    r = client.post("/api/attestation/generate", json=_attestation().model_dump(), headers=auth_headers)
    assert r.status_code == 200
    assert "<script>alert" not in r.json()["html"]


def test_jeton_aleatoire():
    a, b = public_documents.nouveau_jeton(), public_documents.nouveau_jeton()
    assert a != b and len(a) >= 22 and public_documents._TOKEN_RE.match(a)


# ─── Catalogue ─────────────────────────────────────────────────

def test_catalogue_prestations_public(client):
    r = client.get("/api/catalog/prestations")
    assert r.status_code == 200
    data = r.json()
    assert data["pannes"][0] == "Écran cassé" and data["pannes"][-1] == "Autre"
    assert any(p["cle"] == "ecran" and p["prestation"] == "Forfait remplacement écran" for p in data["prestations"])
    assert "max-age" in r.headers["cache-control"]
    assert client.get("/api/catalog/pannes").json() == data["pannes"]
