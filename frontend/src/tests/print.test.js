/**
 * Aperçu d'impression : fonctions pures (papier, @page, HTML préparé, partage) et dialogue PrintDrawer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import api from '../lib/api';
import {
  PAPERS, mmToPx, pxToMm, computeFitZoom, stepZoom, formatCm, resolveFormat,
  toPrintMedia, injectAtHeadStart, injectAtHeadEnd, parsePageMarginsMm, prepareFrameHtml,
  buildStandaloneHtml, STANDALONE_CSP, segmentHeights, rollPageHeightsMm, buildRollPageCss,
  layoutFrame, waitForAssets, isIOSDevice, isSafariDesktop, errorMessage, convertMediaList,
} from '../components/PrintPreview';
import PrintPreview from '../components/PrintPreview';
import PrintDrawer, {
  TICKET_DOCUMENTS, buildTicketDocuments, pickShareUrl, isAbsoluteHttpUrl, buildShareMessage, canEmailDocument,
} from '../components/PrintDrawer';

describe('papier et zoom', () => {
  it('convertit mm ↔ px à 96 dpi CSS', () => {
    expect(Math.round(mmToPx(80))).toBe(302);
    expect(Math.round(mmToPx(210))).toBe(794);
    expect(pxToMm(mmToPx(72))).toBeCloseTo(72, 6);
  });

  it('calcule le zoom « Ajuster » borné', () => {
    expect(computeFitZoom(600, 302, 1.5)).toBe(1.5);
    expect(computeFitZoom(300, 794)).toBe(0.37);
    expect(computeFitZoom(0, 302)).toBe(1);
    expect(computeFitZoom(50, 794)).toBe(0.25);
  });

  it('avance par paliers de zoom', () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(2, 1)).toBe(2);
    expect(stepZoom(0.5, -1)).toBe(0.5);
    expect(stepZoom(0.87, 1)).toBe(1);
  });

  it('formate les longueurs en cm à la française', () => {
    expect(formatCm(419)).toBe('41,9');
    expect(formatCm(20)).toBe('2,0');
  });

  it('choisit le format disponible', () => {
    const doc = { formats: { thermal: {}, a4: {} } };
    expect(resolveFormat(doc, 'a4')).toBe('a4');
    expect(resolveFormat(doc, 'inconnu')).toBe('thermal');
    expect(resolveFormat({ formats: { a4: {} } }, 'thermal')).toBe('a4');
    expect(resolveFormat(null, 'a4')).toBeNull();
  });
});

describe('préparation du HTML', () => {
  it("applique les règles d'impression à l'écran", () => {
    const out = toPrintMedia('<style>@media print{body{padding:0}} @media screen{.x{color:red}}</style>');
    expect(out).toContain('@media all{body{padding:0}}');
    expect(out).toContain('@media tty{.x{color:red}}');
    expect(out).not.toMatch(/@media\s+print/);
  });

  it('garde les requêtes composées inactives au lieu de les inverser', () => {
    // `not all and (…)` nierait toute la requête et activerait la règle dans l'iframe de 302 px
    const out = toPrintMedia('<style>@media screen and (min-width:768px){.w{width:50%}} @media only screen and (max-width:600px){.m{}}</style>');
    expect(out).toContain('@media tty and (min-width:768px){.w{width:50%}}');
    expect(out).toContain('@media only tty and (max-width:600px){.m{}}');
    expect(out).not.toMatch(/not all/);
  });

  it('convertit chaque requête d’une liste et les attributs media', () => {
    expect(convertMediaList(' screen, print')).toBe(' tty, all');
    expect(convertMediaList(' not print')).toBe(' not all');
    expect(convertMediaList(' not screen and (color)')).toBe(' not tty and (color)');
    expect(convertMediaList(' print and (orientation: landscape)')).toBe(' all and (orientation: landscape)');
    expect(convertMediaList(' (display-mode: fullscreen)')).toBe(' (display-mode: fullscreen)');
    const html = toPrintMedia('<link rel="stylesheet" href="p.css" media="print"><style media=\'screen\'>a{}</style><p>print screen</p>');
    expect(html).toContain('media="all"');
    expect(html).toContain("media='tty'");
    expect(html).toContain('<p>print screen</p>');
  });

  it('injecte en tête et en fin de <head> sans confondre <header>', () => {
    const html = '<html><head><title>T</title></head><body><header>H</header></body></html>';
    expect(injectAtHeadStart(html, '<meta x>')).toBe('<html><head><meta x><title>T</title></head><body><header>H</header></body></html>');
    expect(injectAtHeadEnd(html, '<style>y</style>')).toBe('<html><head><title>T</title><style>y</style></head><body><header>H</header></body></html>');
    expect(injectAtHeadStart('<p>nu</p>', '<b>')).toBe('<b><p>nu</p>');
    expect(injectAtHeadStart('<header>x</header>', '<b>')).toBe('<b><header>x</header>');
  });

  it('lit les marges @page (une à quatre valeurs, unités)', () => {
    expect(parsePageMarginsMm('@page { size: A4; margin: 15mm; }')).toEqual({ top: 15, right: 15, bottom: 15, left: 15 });
    expect(parsePageMarginsMm('@page{margin:10mm 5mm}')).toEqual({ top: 10, right: 5, bottom: 10, left: 5 });
    expect(parsePageMarginsMm('@page{margin:1cm 0 2cm}').bottom).toBe(20);
    expect(parsePageMarginsMm('@page kp0{margin:9mm}')).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(parsePageMarginsMm('@page{margin-top:9mm}').top).toBe(0);
  });

  it('prépare un ticket thermique : base, impression à l’écran, pas de marge simulée', () => {
    const raw = '<!DOCTYPE html><html><head><style>@media print{body{width:80mm}}</style></head><body>x</body></html>';
    const out = prepareFrameHtml(raw, PAPERS.thermal80, 'http://localhost:3000');
    expect(out).toContain('<base href="http://localhost:3000/">');
    expect(out).toContain('@media all{body{width:80mm}}');
    expect(out).toContain('id="kp-preview-screen"');
    expect(out).not.toContain('padding:');
  });

  it('prépare un A4 en simulant les marges @page à l’écran', () => {
    const raw = '<html><head><style>@page { size: A4; margin: 15mm; }</style></head><body>x</body></html>';
    const out = prepareFrameHtml(raw, PAPERS.a4, '');
    expect(out).toContain('@media screen{html{background:#fff;overflow:hidden;box-sizing:border-box;padding:15mm 15mm 15mm 15mm}}');
    expect(out).not.toContain('<base');
  });

  it("protège la copie autonome par une CSP placée avant tout script", () => {
    const out = buildStandaloneHtml('<html><head><script>alert(1)</script></head><body></body></html>', 'https://kp.test');
    const csp = out.indexOf('Content-Security-Policy');
    expect(csp).toBeGreaterThan(-1);
    expect(csp).toBeLessThan(out.indexOf('<script>'));
    expect(STANDALONE_CSP).toContain("default-src 'none'");
    expect(STANDALONE_CSP).not.toContain('script-src');
    expect(out).toContain('<base href="https://kp.test/">');
  });

  it('donne un message lisible pour une erreur', () => {
    expect(errorMessage(new Error('Erreur 404'))).toBe('Document introuvable.');
    expect(errorMessage(new Error('Ticket non trouvé'))).toBe('Ticket non trouvé');
    expect(errorMessage(null)).toBe('Erreur de chargement du document.');
    expect(errorMessage(new DOMException('signal is aborted without reason', 'AbortError'))).toBe('Chargement interrompu : réessayez.');
  });
});

describe('longueur du rouleau thermique', () => {
  it('découpe la hauteur aux sauts de page', () => {
    expect(segmentHeights(1000, [400])).toEqual([400, 600]);
    expect(segmentHeights(1000, [])).toEqual([1000]);
    expect(segmentHeights(1000, [0, 1000, 400, 400.2, 1200])).toEqual([400, 600]);
  });

  it('convertit en mm avec marge de sécurité et minimum', () => {
    expect(rollPageHeightsMm([mmToPx(100)], 2)).toEqual([102]);
    expect(rollPageHeightsMm([10], 2)).toEqual([20]);
  });

  it('génère les règles @page (pages nommées pour le « Double »)', () => {
    const css = buildRollPageCss([120, 210], 80, true);
    expect(css).toContain('@page{size:80mm 210mm;margin:0}');
    expect(css).toContain('@page kp0{size:80mm 120mm;margin:0}');
    expect(css).toContain('@page kp1{size:80mm 210mm;margin:0}');
    expect(buildRollPageCss([120, 210], 80, false)).toBe('@page{size:80mm 210mm;margin:0}');
    expect(buildRollPageCss([], 80)).toBe('');
    expect(buildRollPageCss([150], 80)).not.toMatch(/auto/);
  });

  it('injecte @page à partir de la hauteur mesurée de chaque section', () => {
    const doc = document.implementation.createHTMLDocument('t');
    doc.body.innerHTML = '<section data-print-page="client">A</section><section data-print-page="staff">B</section>';
    const [a, b] = doc.querySelectorAll('section');
    a.getBoundingClientRect = () => ({ height: mmToPx(100), top: 0, bottom: mmToPx(100) });
    b.getBoundingClientRect = () => ({ height: mmToPx(150), top: 0, bottom: mmToPx(150) });
    const res = layoutFrame(doc, PAPERS.thermal80);
    expect(res.heightsMm).toEqual([108, 158]);
    const css = doc.getElementById('kp-page-size').textContent;
    expect(css).toContain('@page kp0{size:80mm 108mm;margin:0}');
    expect(css).toContain('@page kp1{size:80mm 158mm;margin:0}');
    layoutFrame(doc, PAPERS.thermal80);
    expect(doc.querySelectorAll('#kp-page-size')).toHaveLength(1);
  });

  it('ne calcule pas de rouleau pour un A4', () => {
    const doc = document.implementation.createHTMLDocument('t');
    expect(layoutFrame(doc, PAPERS.a4).heightsMm).toBeNull();
    expect(doc.getElementById('kp-page-size')).toBeNull();
  });
});

describe('attente des images', () => {
  const fakeImg = (src, { settle } = {}) => ({
    complete: false,
    naturalWidth: 0,
    getAttribute: (n) => (n === 'src' ? src : ''),
    addEventListener: (type, fn) => { if (settle === type) setTimeout(fn, 0); },
  });

  it('signale une image en erreur (logo)', async () => {
    const doc = { images: [fakeImg('https://kp.test/logo_k.png', { settle: 'error' })], fonts: { ready: Promise.resolve() } };
    await expect(waitForAssets(doc, 1000)).resolves.toEqual(['logo']);
  });

  it("n'attend pas indéfiniment une image bloquée", async () => {
    const doc = { images: [fakeImg('data:image/png;base64,AAAA')] };
    await expect(waitForAssets(doc, 20)).resolves.toEqual(['image intégrée']);
  });

  it('ne signale rien quand tout est chargé', async () => {
    const ok = { complete: true, naturalWidth: 120, getAttribute: () => '', decode: () => Promise.resolve() };
    await expect(waitForAssets({ images: [ok] }, 50)).resolves.toEqual([]);
  });
});

describe('détection iOS / iPadOS', () => {
  it('reconnaît iPhone, iPad et iPadOS « bureau »', () => {
    expect(isIOSDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })).toBe(true);
    expect(isIOSDevice({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isIOSDevice({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(isIOSDevice({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)', platform: 'Win32', maxTouchPoints: 0 })).toBe(false);
    expect(isIOSDevice(null)).toBe(false);
  });

  it('repère Safari macOS (impression PDF via onglet) sans viser Chrome, Edge ni Firefox', () => {
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
    expect(isSafariDesktop({ userAgent: `${mac} Version/18.0 Safari/605.1.15`, platform: 'MacIntel', maxTouchPoints: 0 })).toBe(true);
    expect(isSafariDesktop({ userAgent: `${mac} Chrome/129.0.0.0 Safari/537.36`, platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(isSafariDesktop({ userAgent: `${mac} Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0`, platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(isSafariDesktop({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0', platform: 'MacIntel' })).toBe(false);
    // iPadOS se présente en Mac : il suit déjà le chemin iOS
    expect(isSafariDesktop({ userAgent: `${mac} Version/18.0 Safari/605.1.15`, platform: 'MacIntel', maxTouchPoints: 5 })).toBe(false);
    expect(isSafariDesktop(null)).toBe(false);
  });
});

describe('documents du ticket et partage', () => {
  const links = {
    client: 'https://kp.test/api/public/documents/Zx9aQ/client',
    devis: 'https://kp.test/api/public/documents/Zx9aQ/devis',
    recu: 'https://kp.test/api/public/documents/Zx9aQ/recu',
    devis_pdf: 'https://kp.test/api/public/documents/Zx9aQ/devis.pdf',
    recu_pdf: 'https://kp.test/api/public/documents/Zx9aQ/recu.pdf',
    staff: 'https://kp.test/fuite',
  };

  it('ne rend jamais la fiche atelier ni le double partageables', () => {
    const byId = Object.fromEntries(TICKET_DOCUMENTS.map((d) => [d.id, d]));
    expect(byId.staff.shareable).toBe(false);
    expect(byId.combined.shareable).toBe(false);
    expect(['client', 'devis', 'recu'].every((id) => byId[id].shareable)).toBe(true);
    expect(canEmailDocument('staff')).toBe(false);
    expect(canEmailDocument('combined')).toBe(false);
    expect(canEmailDocument('devis')).toBe(true);
  });

  it('propose le thermique partout et le PDF A4 pour devis et reçu', () => {
    const docs = buildTicketDocuments(7, 'KP-000007');
    const byId = Object.fromEntries(docs.map((d) => [d.id, d]));
    expect(Object.keys(byId.client.formats)).toEqual(['thermal']);
    expect(Object.keys(byId.devis.formats)).toEqual(['thermal', 'a4']);
    expect(byId.recu.formats.a4.kind).toBe('pdf');
    expect(byId.staff.formats.thermal.paper).toBe('thermal80');
  });

  it('charge le HTML via le client API authentifié', async () => {
    const spy = vi.spyOn(api, 'getPrintHtml').mockResolvedValue('<html></html>');
    const docs = buildTicketDocuments(7, 'KP-000007');
    const signal = new AbortController().signal;
    await expect(docs.find((d) => d.id === 'staff').formats.thermal.load(signal)).resolves.toEqual({ kind: 'html', html: '<html></html>' });
    expect(spy).toHaveBeenCalledWith(7, 'staff', { signal });
    spy.mockRestore();
  });

  it('nomme le PDF téléchargé avec le code ticket', async () => {
    const blob = new Blob(['%PDF'], { type: 'application/pdf' });
    const spy = vi.spyOn(api, 'getPdfBlob').mockResolvedValue(blob);
    const docs = buildTicketDocuments(7, 'KP-000007');
    const src = await docs.find((d) => d.id === 'recu').formats.a4.load(new AbortController().signal);
    expect(src).toEqual({ kind: 'pdf', blob, filename: 'recu_KP-000007.pdf' });
    spy.mockRestore();
  });

  it('choisit le lien absolu correspondant au document et au format', () => {
    expect(pickShareUrl(links, 'client', 'thermal')).toBe(links.client);
    expect(pickShareUrl(links, 'devis', 'thermal')).toBe(links.devis);
    expect(pickShareUrl(links, 'devis', 'a4')).toBe(links.devis_pdf);
    expect(pickShareUrl(links, 'recu', 'a4')).toBe(links.recu_pdf);
    expect(pickShareUrl(links, 'staff', 'thermal')).toBeNull();
    expect(pickShareUrl(links, 'combined', 'thermal')).toBeNull();
    expect(pickShareUrl(null, 'client', 'thermal')).toBeNull();
    expect(pickShareUrl({ client: '/api/tickets/12/print/client' }, 'client', 'thermal')).toBeNull();
  });

  it("n'accepte que des URL http(s) absolues", () => {
    expect(isAbsoluteHttpUrl('https://kp.test/x')).toBe(true);
    expect(isAbsoluteHttpUrl('http://localhost:8000/x')).toBe(true);
    expect(isAbsoluteHttpUrl('/api/tickets/1/print/client')).toBe(false);
    expect(isAbsoluteHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isAbsoluteHttpUrl('')).toBe(false);
    expect(isAbsoluteHttpUrl(undefined)).toBe(false);
  });

  it('rédige les messages WhatsApp et SMS avec le lien', () => {
    const wa = buildShareMessage('whatsapp', { label: 'devis', ticketCode: 'KP-000007', url: links.devis });
    expect(wa).toBe(`Bonjour, voici votre devis Klikphone pour le ticket KP-000007 :\n${links.devis}`);
    expect(buildShareMessage('sms', { label: 'reçu de dépôt', ticketCode: 'KP-000007', url: links.client }))
      .toBe(`Klikphone - reçu de dépôt KP-000007 : ${links.client}`);
    expect(buildShareMessage('sms', { label: 'devis', url: links.devis })).toBe(`Klikphone - devis : ${links.devis}`);
  });
});

describe('dialogue PrintDrawer', () => {
  beforeEach(() => {
    vi.spyOn(api, 'getPrintHtml').mockResolvedValue('<html><head></head><body>ticket</body></html>');
    vi.spyOn(api, 'getShareLinks').mockResolvedValue({});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const renderDrawer = (props = {}) => {
    const onClose = vi.fn();
    render(createElement(PrintDrawer, {
      open: true, onClose, ticketId: 12, ticketCode: 'KP-000012', clientTel: '0600000000', clientEmail: 'client@exemple.test', ...props,
    }));
    return { onClose };
  };

  it('expose un dialogue modal étiqueté', () => {
    renderDrawer();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Impression');
    expect(screen.getByRole('button', { name: "Fermer l'aperçu" })).toBeInTheDocument();
  });

  it('ouvre sur le ticket client et charge son HTML avec le jeton', async () => {
    renderDrawer();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Client', 'Atelier', 'Double', 'Devis', 'Reçu']);
    expect(screen.getByRole('tab', { name: /Client/ })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(api.getPrintHtml).toHaveBeenCalledWith(12, 'client', expect.objectContaining({ signal: expect.anything() })));
  });

  it("attend beforeOpen (enregistrement en attente) avant de charger", async () => {
    let release;
    const beforeOpen = vi.fn(() => new Promise((r) => { release = r; }));
    renderDrawer({ beforeOpen });
    await waitFor(() => expect(beforeOpen).toHaveBeenCalledTimes(1));
    expect(api.getPrintHtml).not.toHaveBeenCalled();
    await act(async () => { release(); });
    await waitFor(() => expect(api.getPrintHtml).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('tab', { name: /Atelier/ }));
    await waitFor(() => expect(api.getPrintHtml).toHaveBeenCalledWith(12, 'staff', expect.anything()));
    expect(beforeOpen).toHaveBeenCalledTimes(1);
  });

  it("affiche l'erreur et permet de réessayer", async () => {
    api.getPrintHtml.mockRejectedValueOnce(new Error('Erreur 404'));
    renderDrawer();
    expect(await screen.findByRole('alert')).toHaveTextContent('Document introuvable.');
    fireEvent.click(screen.getByRole('button', { name: /Réessayer/ }));
    await waitFor(() => expect(api.getPrintHtml).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it("ne réutilise pas un chargement annulé (aller-retour rapide entre onglets)", async () => {
    const pending = [];
    api.getPrintHtml.mockImplementation((id, type, { signal }) => new Promise((resolve, reject) => {
      pending.push({ type, resolve: () => resolve(`<html><head></head><body>doc-${type}</body></html>`) });
      signal.addEventListener('abort', () => reject(new DOMException('signal is aborted without reason', 'AbortError')));
    }));
    const clientCalls = () => api.getPrintHtml.mock.calls.filter(([, type]) => type === 'client');
    renderDrawer();
    await waitFor(() => expect(clientCalls()).toHaveLength(1));
    // Le ticket client est encore en cours de chargement quand on part puis revient
    fireEvent.click(screen.getByRole('tab', { name: /Atelier/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Client/ }));
    await waitFor(() => expect(clientCalls()).toHaveLength(2));
    await act(async () => { pending.filter((p) => p.type === 'client').at(-1).resolve(); });
    await waitFor(() => expect(screen.getByTitle(/Aperçu : Client/).getAttribute('srcdoc')).toContain('doc-client'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('recharge le document quand reloadKey change (ticket modifié)', async () => {
    const props = { open: true, onClose: vi.fn(), ticketId: 12, ticketCode: 'KP-000012', reloadKey: 0 };
    const { rerender } = render(createElement(PrintDrawer, props));
    await waitFor(() => expect(api.getPrintHtml).toHaveBeenCalledTimes(1));
    rerender(createElement(PrintDrawer, props));
    await act(async () => {});
    expect(api.getPrintHtml).toHaveBeenCalledTimes(1);
    rerender(createElement(PrintDrawer, { ...props, reloadKey: 1 }));
    await waitFor(() => expect(api.getPrintHtml).toHaveBeenCalledTimes(2));
  });

  it('accepte onBeforePrint comme alias de beforeOpen', async () => {
    const onBeforePrint = vi.fn(() => Promise.resolve());
    renderDrawer({ onBeforePrint });
    await waitFor(() => expect(api.getPrintHtml).toHaveBeenCalledTimes(1));
    expect(onBeforePrint).toHaveBeenCalledTimes(1);
  });

  it('respecte initialDocId (ex. « Double » après création)', () => {
    renderDrawer({ initialDocId: 'combined' });
    expect(screen.getByRole('tab', { name: /Double/ })).toHaveAttribute('aria-selected', 'true');
  });

  it("masque l'envoi pour la fiche atelier et le double", () => {
    renderDrawer();
    expect(screen.getByRole('button', { name: /Envoyer/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Atelier/ }));
    expect(screen.queryByRole('button', { name: /Envoyer/ })).toBeNull();
    expect(screen.getByText(/Document interne/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Double/ }));
    expect(screen.queryByRole('button', { name: /Envoyer/ })).toBeNull();
  });

  it('propose le choix thermique / A4 pour le devis', () => {
    renderDrawer();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Devis/ }));
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(['Ticket 80 mm', 'A4 (PDF)']);
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
  });

  it('navigue entre les onglets au clavier', () => {
    renderDrawer();
    fireEvent.keyDown(screen.getByRole('tab', { name: /Client/ }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /Atelier/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByRole('tab', { name: /Atelier/ }), { key: 'End' });
    expect(screen.getByRole('tab', { name: /Reçu/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('ferme avec Échap, le menu Envoyer en premier', async () => {
    const { onClose } = renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: /Envoyer/ }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("intercepte Ctrl+P sans imprimer tant que l'aperçu n'est pas prêt", () => {
    renderDrawer();
    const ev = new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    expect(screen.getByRole('button', { name: /Imprimer/ })).toBeDisabled();
  });

  it("n'affiche rien quand il est fermé", () => {
    renderDrawer({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.getPrintHtml).not.toHaveBeenCalled();
  });
});

describe("impression depuis l'aperçu", () => {
  const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
  const { createObjectURL, revokeObjectURL } = URL;
  let onClose;

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:kp-test');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  });

  // jsdom ne charge pas srcdoc : on branche un document et une fenêtre d'iframe factices puis on simule « load »
  const mountFrame = (frame, win) => {
    const fdoc = document.implementation.createHTMLDocument('t');
    Object.defineProperty(fdoc, 'URL', { value: 'about:srcdoc' });
    Object.defineProperty(frame, 'contentDocument', { configurable: true, get: () => fdoc });
    Object.defineProperty(frame, 'contentWindow', { configurable: true, get: () => win });
    fireEvent.load(frame);
  };

  const renderPreview = (formats) => {
    onClose = vi.fn();
    render(createElement(PrintPreview, { open: true, onClose, documents: [{ id: 'doc', label: 'Ticket', formats }] }));
  };

  it('rend le focus au dialogue après print() : Échap et Ctrl+P restent interceptés', async () => {
    renderPreview({ thermal: { paper: 'thermal80', source: { kind: 'html', html: '<html><head></head><body>x</body></html>' } } });
    const frame = screen.getByTitle(/Aperçu : Ticket/);
    // Comme un navigateur : win.focus() fait passer le focus dans l'iframe
    const win = { focus: vi.fn(() => frame.focus()), print: vi.fn(() => expect(document.activeElement).toBe(frame)) };
    mountFrame(frame, win);
    const btn = screen.getByRole('button', { name: /^Imprimer/ });
    await waitFor(() => expect(btn).toBeEnabled());

    btn.focus();
    fireEvent.click(btn);
    expect(win.print).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(btn);

    const ev = new KeyboardEvent('keydown', { key: 'p', metaKey: true, bubbles: true, cancelable: true });
    act(() => { document.activeElement.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    expect(win.print).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('se replie sur le bouton Imprimer quand rien n’était focalisé avant print()', async () => {
    renderPreview({ thermal: { paper: 'thermal80', source: { kind: 'html', html: '<html><head></head><body>x</body></html>' } } });
    const frame = screen.getByTitle(/Aperçu : Ticket/);
    mountFrame(frame, { focus: () => frame.focus(), print: () => {} });
    const btn = screen.getByRole('button', { name: /^Imprimer/ });
    await waitFor(() => expect(btn).toBeEnabled());
    frame.focus();
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true });
    expect(document.activeElement).toBe(btn);
  });

  const pdfFormats = () => ({ a4: { paper: 'a4', kind: 'pdf', source: { kind: 'pdf', blob: new Blob(['%PDF'], { type: 'application/pdf' }), filename: 'devis_KP-1.pdf' } } });

  it('ouvre le PDF dans un onglet sous Safari macOS au lieu d’imprimer l’iframe (page blanche)', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(SAFARI);
    const open = vi.spyOn(window, 'open').mockReturnValue({});
    renderPreview(pdfFormats());
    const frame = screen.getByTitle(/Aperçu : Ticket/);
    const win = { focus: vi.fn(), print: vi.fn() };
    mountFrame(frame, win);
    const btn = screen.getByRole('button', { name: /^Imprimer/ });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    expect(open).toHaveBeenCalledWith('blob:kp-test', '_blank');
    expect(win.print).not.toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent(/Fichier › Imprimer/);
  });

  it('imprime le PDF depuis l’iframe sous Chrome', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(CHROME);
    const open = vi.spyOn(window, 'open').mockReturnValue({});
    renderPreview(pdfFormats());
    const frame = screen.getByTitle(/Aperçu : Ticket/);
    const win = { focus: vi.fn(), print: vi.fn() };
    mountFrame(frame, win);
    const btn = screen.getByRole('button', { name: /^Imprimer/ });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    expect(win.print).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });
});
