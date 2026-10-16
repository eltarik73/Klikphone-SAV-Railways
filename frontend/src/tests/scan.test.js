/**
 * Douchette : décodage des codes scannés (lib/scan.js), écoute clavier (ScanListener)
 * et panneau d'action rapide (QuickScanPanel).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, useState } from 'react';
import { render, screen, fireEvent, cleanup, act, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import {
  SCAN_EVENT, parseScan, descrambleAzerty, luhnOk, gtinOk, normalizeTicketCode, scanQuery,
  scanLabel, createScanBuffer, median, cleanScan, typeaheadIndex,
} from '../lib/scan';

const { auth, apiMock } = vi.hoisted(() => ({
  auth: { user: { target: 'accueil', utilisateur: 'Sophie' } },
  apiMock: {
    resolveCode: vi.fn(),
    getTicket: vi.fn(),
    getNotes: vi.fn(),
    restitution: vi.fn(),
    changeStatus: vi.fn(),
    updateTicket: vi.fn(),
    setPaye: vi.fn(),
    addHistory: vi.fn(),
    patchKeepalive: vi.fn(),
    getCached: vi.fn(),
  },
}));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../lib/api', () => ({ default: apiMock }));

import { ToastProvider } from '../components/Toast';
import ScanListener, { isScanField, takePendingScan } from '../components/ScanListener';
import QuickScanPanel, {
  montantsTicket, lignesTicket, actionsTicket, alertesTicket, verifierRestitution, corpsRestitution,
  etatRestitutionInitial, pretEnCours, imeiCourt, modeleTicket, formatDateTexte, scanErrorMessage,
  devisRefuse, montantAVerifier, joursDepuis,
} from '../components/QuickScanPanel';

// IMEI d'exemple valide (Luhn) et la même série avec un mauvais chiffre de contrôle
const IMEI_OK = '490154203237518';
const IMEI_KO = '490154203237519';
const QR_URL = 'https://klikphone-sav-v2-production.up.railway.app/suivi?ticket=KP-000123';

// Même URL tapée par une douchette QWERTY sur un poste AZERTY (Windows puis Mac)
const QR_AZERTY_WIN = 'httpsM!!klikphone)sqv)vé)production:up:rqilzqy:qpp!suivi§ticket=KP)ààà&é"';
const QR_AZERTY_MAC = 'httpsM==klikphone)sqv)vé)production:up:rqilzqy:qpp=suivi+ticket-KP)ààà&é"';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── Décodage ────────────────────────────────────────────────────────────────

describe('parseScan : codes ticket', () => {
  it('lit l’URL du QR de suivi', () => {
    expect(parseScan(QR_URL)).toMatchObject({ kind: 'ticket', code: 'KP-000123', source: 'url' });
  });

  it('tolère Verr. Maj (URL en majuscules, code en minuscules)', () => {
    const r = parseScan('HTTPS://KLIKPHONE-SAV-V2-PRODUCTION.UP.RAILWAY.APP/SUIVI?TICKET=kp-000123');
    expect(r).toMatchObject({ kind: 'ticket', code: 'KP-000123' });
  });

  it('normalise les formes courtes du code', () => {
    for (const raw of ['KP-000123', 'kp123', 'KP 000123', 'Kp.123', '#123', '  KP-000123\r\n', '000123']) {
      expect(parseScan(raw)).toMatchObject({ kind: 'ticket', code: 'KP-000123' });
    }
  });

  it('corrige une douchette QWERTY sur poste AZERTY', () => {
    expect(parseScan('KP)000123')).toMatchObject({ kind: 'ticket', code: 'KP-000123', azerty: true });
    expect(parseScan('KP)ààà&é"')).toMatchObject({ kind: 'ticket', code: 'KP-000123', azerty: true });
    expect(parseScan('kp)--ààà-')).toMatchObject({ kind: 'ticket', code: 'KP-660006' });
  });

  it('corrige Verr. Maj sur poste AZERTY Windows (le tiret sort en « ° »)', () => {
    expect(parseScan('kp°000123')).toMatchObject({ kind: 'ticket', code: 'KP-000123', azerty: true });
  });

  it('retrouve le code dans une URL de QR tapée en AZERTY (Windows et Mac)', () => {
    expect(parseScan(QR_AZERTY_WIN)).toMatchObject({ kind: 'ticket', code: 'KP-000123', azerty: true });
    expect(parseScan(QR_AZERTY_MAC)).toMatchObject({ kind: 'ticket', code: 'KP-000123', azerty: true });
  });

  it('refuse les codes nuls ou trop longs', () => {
    expect(parseScan('KP-000000').kind).toBe('unknown');
    expect(parseScan('KP-12345678').kind).toBe('unknown');
    expect(parseScan('https://exemple.fr/page').kind).toBe('unknown');
  });

  it('accepte un nombre nu seulement dans l’URL du QR', () => {
    expect(normalizeTicketCode('123')).toBeNull();
    expect(normalizeTicketCode('123', { bare: true })).toBe('KP-000123');
    expect(parseScan('https://x.fr/suivi?ticket=42')).toMatchObject({ kind: 'ticket', code: 'KP-000042' });
  });
});

describe('parseScan : IMEI, EAN, numéro de série', () => {
  it('reconnaît un IMEI valide (Luhn)', () => {
    expect(parseScan(IMEI_OK)).toMatchObject({ kind: 'imei', imei: IMEI_OK });
    expect(parseScan('49-015420-323751-8')).toMatchObject({ kind: 'imei', imei: IMEI_OK });
  });

  it('signale un IMEI à la clé de contrôle fausse', () => {
    expect(parseScan(IMEI_KO)).toMatchObject({ kind: 'unknown', reason: 'imei_invalide' });
  });

  it('corrige un IMEI tapé en AZERTY', () => {
    expect(descrambleAzerty('\'çà&(\'éà"é"è(&_')).toBe(IMEI_OK);
    expect(parseScan('\'çà&(\'éà"é"è(&_')).toMatchObject({ kind: 'imei', imei: IMEI_OK, azerty: true });
  });

  it('distingue un code-barres produit (EAN)', () => {
    expect(parseScan('4006381333931').kind).toBe('ean');
    expect(gtinOk('4006381333931')).toBe(true);
    expect(gtinOk('4006381333932')).toBe(false);
  });

  it('reconnaît un numéro de série constructeur', () => {
    expect(parseScan('f2lxk0abhg7f')).toMatchObject({ kind: 'serial', serial: 'F2LXK0ABHG7F' });
  });

  it('laisse le texte ordinaire inconnu', () => {
    expect(parseScan('Hélène').kind).toBe('unknown');
    expect(parseScan('bonjour').kind).toBe('unknown');
    expect(parseScan('   ').kind).toBe('empty');
  });

  it('valide Luhn', () => {
    expect(luhnOk(IMEI_OK)).toBe(true);
    expect(luhnOk(IMEI_KO)).toBe(false);
    expect(luhnOk('000000000000000')).toBe(false);
  });

  it('nettoie les caractères de contrôle', () => {
    expect(cleanScan('\u0002KP-000123\u0003\r')).toBe('KP-000123');
  });

  it('prépare la requête et le libellé', () => {
    expect(scanQuery(parseScan(QR_URL))).toBe('KP-000123');
    expect(scanQuery(parseScan(IMEI_OK))).toBe(IMEI_OK);
    expect(scanQuery(parseScan('4006381333931'))).toBeNull();
    expect(scanLabel(parseScan(IMEI_OK))).toBe(`IMEI ${IMEI_OK}`);
    expect(scanLabel(parseScan('x'.repeat(40)))).toHaveLength(31);
  });
});

describe('typeaheadIndex : recherche par lettre d’un select', () => {
  const labels = ['— Non assigné —', 'Hakim', 'Karim', 'Hugo', null];
  it('suit le navigateur : préfixe, lettre répétée, options désactivées', () => {
    expect(typeaheadIndex(labels, 0, 'h')).toBe(1);
    expect(typeaheadIndex(labels, 1, 'h')).toBe(3);
    expect(typeaheadIndex(labels, 0, 'hh')).toBe(3);
    expect(typeaheadIndex(labels, 2, 'h')).toBe(3);
    expect(typeaheadIndex(labels, 0, 'hug')).toBe(3);
    expect(typeaheadIndex(labels, 0, 'KA')).toBe(2);
    expect(typeaheadIndex(labels, 0, 'zz')).toBe(-1);
    expect(typeaheadIndex(labels, 0, ' ')).toBe(-1);
  });
});

describe('createScanBuffer : cadence', () => {
  const feed = (buf, text, step, start = 1000) => {
    let r;
    [...text].forEach((ch, i) => { r = buf.push(ch, start + i * step); });
    return r;
  };

  it('qualifie une rafale de douchette', () => {
    const buf = createScanBuffer();
    expect(feed(buf, 'KP-', 8).qualified).toBe(false);
    expect(buf.push('0', 1024).qualified).toBe(true);
    expect(buf.text).toBe('KP-0');
  });

  it('ignore la frappe humaine', () => {
    const buf = createScanBuffer();
    feed(buf, 'bonjour', 110);
    expect(buf.qualified).toBe(false);
  });

  it('tolère une touche lente (Bluetooth) une fois le scan reconnu', () => {
    const buf = createScanBuffer();
    feed(buf, 'KP-0001', 5);
    expect(buf.continues(1030 + 250)).toBe(true);
    buf.push('2', 1030 + 250);
    expect(buf.qualified).toBe(true);
    expect(buf.text).toBe('KP-00012');
  });

  it('coupe la rafale après un silence', () => {
    const buf = createScanBuffer();
    feed(buf, 'ab', 5);
    expect(buf.push('c', 1500).fresh).toBe(true);
    expect(buf.text).toBe('c');
  });

  it('déqualifie quand la cadence devient humaine', () => {
    const buf = createScanBuffer();
    feed(buf, 'abcd', 10);
    let r;
    for (let i = 0; i < 6; i++) r = buf.push('x', 1030 + (i + 1) * 110);
    expect(r.disqualified || !buf.qualified).toBe(true);
    expect(buf.qualified).toBe(false);
  });

  it('reconnaît une douchette Bluetooth en vitesse lente (55 ms)', () => {
    const buf = createScanBuffer();
    feed(buf, 'KP-0001', 55);
    expect(buf.qualified).toBe(true);
    expect(buf.scanLike()).toBe(true);
  });

  it('cadence sur toute la rafale : une frappe qui démarre vite puis ralentit n’est pas un scan', () => {
    const buf = createScanBuffer();
    [0, 30, 60, 90, 180, 270].forEach((dt, i) => buf.push(' des x'[i], 1000 + dt));
    expect(buf.qualified).toBe(true);
    expect(buf.scanLike()).toBe(false);
    const scan = createScanBuffer();
    feed(scan, 'KP-000123', 8);
    scan.push('4', 1064 + 280);
    expect(scan.scanLike()).toBe(true);
  });

  it('calcule la médiane', () => {
    expect(median([5, 1, 300])).toBe(5);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

// ─── ScanListener ────────────────────────────────────────────────────────────

function LocationProbe() {
  const loc = useLocation();
  return createElement('output', { 'data-testid': 'loc' }, `${loc.pathname}${loc.search}`);
}

function Field({ label = 'Panne', initial = 'Écran cassé' }) {
  const [v, setV] = useState(initial);
  return createElement('div', null,
    createElement('label', null, label),
    createElement('input', { 'data-testid': 'field', value: v, onChange: (e) => setV(e.target.value) }),
    createElement('output', { 'data-testid': 'state' }, v));
}

function Picker({ onPick }) {
  const [v, setV] = useState('');
  return createElement('select', {
    'data-testid': 'picker',
    'aria-label': 'Technicien assigné',
    value: v,
    onChange: (e) => { setV(e.target.value); onPick(e.target.value); },
  }, ['', 'Hakim', 'Karim', 'Hugo'].map((n) => createElement('option', { key: n, value: n }, n || '— Non assigné —')));
}

function renderListener({ path = '/accueil', label, initial, extra = null } = {}) {
  return render(createElement(MemoryRouter, { initialEntries: [path] },
    createElement(ToastProvider, null,
      createElement(ScanListener),
      createElement(Field, { label, initial }),
      extra,
      createElement('button', { type: 'button', 'data-testid': 'btn' }, 'Supprimer'))));
}

// Simule le navigateur : la touche non bloquée s'insère dans le champ focalisé
// (et sur un select fermé, la recherche par lettre choisit l'option suivante qui commence par elle)
function press(key) {
  const el = document.activeElement || document.body;
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => { el.dispatchEvent(ev); });
  if (!ev.defaultPrevented && key.length === 1 && el.tagName === 'INPUT') {
    act(() => {
      el.setRangeText(key, el.selectionStart, el.selectionEnd, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  if (!ev.defaultPrevented && key.length === 1 && el.tagName === 'SELECT') {
    const opts = [...el.options];
    const next = opts.find((o) => o.index > el.selectedIndex && o.text.toLowerCase().startsWith(key.toLowerCase()))
      || opts.find((o) => o.text.toLowerCase().startsWith(key.toLowerCase()));
    if (next && next.index !== el.selectedIndex) {
      act(() => {
        el.selectedIndex = next.index;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
  }
  return ev;
}

// Horloge des frappes maîtrisée (performance.now) ; les délais d'inactivité restent réels
function useClock(start = 1000) {
  const clock = { t: start };
  vi.spyOn(performance, 'now').mockImplementation(() => clock.t);
  return clock;
}

function typeTimed(clock, text, gaps) {
  [...text].forEach((ch, i) => {
    if (i > 0) clock.t += Array.isArray(gaps) ? gaps[i - 1] : gaps;
    press(ch);
  });
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

function typeScan(text, suffix = 'Enter') {
  for (const ch of text) press(ch);
  return suffix ? press(suffix) : null;
}

function collectScans() {
  const scans = [];
  const onScan = (e) => {
    e.detail.accepted = true;
    scans.push(e.detail);
  };
  window.addEventListener(SCAN_EVENT, onScan);
  return { scans, stop: () => window.removeEventListener(SCAN_EVENT, onScan) };
}

describe('ScanListener', () => {
  let sink;
  beforeEach(() => {
    auth.user = { target: 'accueil', utilisateur: 'Sophie' };
    sink = collectScans();
  });
  afterEach(() => {
    sink.stop();
    takePendingScan();
  });

  it('retire le scan du champ focalisé, bloque l’Entrée et émet le code', () => {
    renderListener();
    const input = screen.getByTestId('field');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    const enter = typeScan(QR_URL);
    expect(enter.defaultPrevented).toBe(true);
    expect(input.value).toBe('Écran cassé');
    expect(screen.getByTestId('state')).toHaveTextContent(/^Écran cassé$/);
    expect(sink.scans).toHaveLength(1);
    expect(sink.scans[0]).toMatchObject({ kind: 'ticket', code: 'KP-000123', query: 'KP-000123' });
  });

  it('décode une douchette AZERTY sans champ focalisé', () => {
    renderListener();
    screen.getByTestId('btn').focus();
    const enter = typeScan('KP)000123');
    expect(enter.defaultPrevented).toBe(true);
    expect(sink.scans[0]).toMatchObject({ code: 'KP-000123' });
  });

  it('accepte le suffixe Tab', () => {
    renderListener();
    const tab = typeScan('KP-000077', 'Tab');
    expect(tab.defaultPrevented).toBe(true);
    expect(sink.scans[0]).toMatchObject({ code: 'KP-000077' });
  });

  it('termine un scan sans suffixe après un court silence', async () => {
    renderListener();
    typeScan('KP-000088', null);
    expect(sink.scans).toHaveLength(0);
    await waitFor(() => expect(sink.scans).toHaveLength(1), { timeout: 1000 });
    expect(sink.scans[0].code).toBe('KP-000088');
  });

  it('laisse passer la frappe humaine', () => {
    let t = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => { t += 150; return t; });
    renderListener({ initial: '' });
    const input = screen.getByTestId('field');
    input.focus();
    const enter = typeScan('KP-000123');
    expect(enter.defaultPrevented).toBe(false);
    expect(input.value).toBe('KP-000123');
    expect(sink.scans).toHaveLength(0);
  });

  it('laisse un IMEI scanné dans le champ IMEI', () => {
    renderListener({ label: 'IMEI', initial: '' });
    const input = screen.getByTestId('field');
    input.focus();
    expect(isScanField(input)).toBe(true);
    typeScan(IMEI_OK);
    expect(input.value).toBe(IMEI_OK);
    expect(sink.scans).toHaveLength(0);
  });

  it('mais ouvre le ticket si c’est un QR scanné dans le champ IMEI', () => {
    renderListener({ label: 'IMEI', initial: '' });
    const input = screen.getByTestId('field');
    input.focus();
    typeScan(QR_URL);
    expect(input.value).toBe('');
    expect(sink.scans[0]).toMatchObject({ code: 'KP-000123' });
  });

  it('ignore les doublons rapprochés (douchette en mode continu)', () => {
    renderListener();
    typeScan('KP-000123');
    typeScan('KP-000123');
    expect(sink.scans).toHaveLength(1);
  });

  it('signale un code non reconnu', async () => {
    renderListener();
    screen.getByTestId('btn').focus();
    const enter = typeScan('ABC-DEF-GHI');
    expect(enter.defaultPrevented).toBe(true);
    expect(sink.scans).toHaveLength(0);
    expect(await screen.findByText(/Code non reconnu : ABC-DEF-GHI/)).toBeInTheDocument();
  });

  it('bloque le scan sur la page de connexion sans remplir le champ', async () => {
    auth.user = null;
    renderListener({ path: '/login/accueil', initial: '' });
    const input = screen.getByTestId('field');
    input.focus();
    typeScan(QR_URL);
    expect(input.value).toBe('');
    expect(sink.scans).toHaveLength(0);
    expect(await screen.findByText(/Connectez-vous pour utiliser la douchette/)).toBeInTheDocument();
  });

  it('reste inactif sur les pages publiques', () => {
    renderListener({ path: '/suivi', initial: '' });
    const input = screen.getByTestId('field');
    input.focus();
    const enter = typeScan('KP-000123');
    expect(enter.defaultPrevented).toBe(false);
    expect(input.value).toBe('KP-000123');
    expect(sink.scans).toHaveLength(0);
  });

  it('laisse la palette de recherche gérer le scan', () => {
    renderListener({ initial: '' });
    const palette = document.createElement('div');
    palette.setAttribute('data-search-palette', '');
    document.body.appendChild(palette);
    try {
      const input = screen.getByTestId('field');
      input.focus();
      typeScan('KP-000123');
      expect(input.value).toBe('KP-000123');
      expect(sink.scans).toHaveLength(0);
    } finally {
      palette.remove();
    }
  });

  it('rend au champ une frappe humaine qui démarre vite puis ralentit, sans message', async () => {
    const clock = useClock();
    renderListener({ initial: 'Ecran' });
    const input = screen.getByTestId('field');
    input.focus();
    input.setSelectionRange(5, 5);
    typeTimed(clock, ' des x', [30, 30, 30, 150, 150]);
    await act(() => sleep(350));
    expect(input.value).toBe('Ecran des x');
    typeTimed(clock, ' ab', 400);
    clock.t += 400;
    typeTimed(clock, 'cdef', [30, 30, 30]);
    clock.t += 90;
    press('g');
    clock.t += 90;
    press('h');
    await act(() => sleep(350));
    expect(input.value).toBe('Ecran des x abcdefgh');
    expect(screen.queryByText(/Code non reconnu/)).not.toBeInTheDocument();
    expect(sink.scans).toHaveLength(0);
  });

  it('reconnaît une douchette Bluetooth lente (55 ms par caractère) dans un champ', () => {
    const clock = useClock();
    renderListener();
    const input = screen.getByTestId('field');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    typeTimed(clock, 'KP-000123', 55);
    clock.t += 55;
    expect(press('Enter').defaultPrevented).toBe(true);
    expect(input.value).toBe('Écran cassé');
    expect(sink.scans[0]).toMatchObject({ code: 'KP-000123' });
  });

  it('touche lente après le 1er caractère : le code reste lisible et le champ est rétabli', () => {
    const clock = useClock();
    renderListener();
    const input = screen.getByTestId('field');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    typeTimed(clock, 'KP-000123', [130, 8, 8, 8, 8, 8, 8, 8]);
    clock.t += 8;
    expect(press('Enter').defaultPrevented).toBe(true);
    expect(input.value).toBe('Écran cassé');
    expect(sink.scans[0]).toMatchObject({ code: 'KP-000123' });
  });

  it('bloque aussi la 2e touche d’un suffixe double (CR+LF, Tab+Entrée)', () => {
    const clock = useClock();
    renderListener();
    screen.getByTestId('btn').focus();
    typeTimed(clock, 'KP-000123', 5);
    clock.t += 5;
    expect(press('Enter').defaultPrevented).toBe(true);
    clock.t += 5;
    expect(press('Enter').defaultPrevented).toBe(true);
    typeTimed(clock, 'KP-000124', 5);
    clock.t += 5;
    expect(press('Tab').defaultPrevented).toBe(true);
    clock.t += 5;
    expect(press('Enter').defaultPrevented).toBe(true);
    clock.t += 500;
    expect(press('Enter').defaultPrevented).toBe(false);
    expect(sink.scans.map((x) => x.code)).toEqual(['KP-000123', 'KP-000124']);
  });

  it('select focalisé : le scan ne change pas l’option (pas d’enregistrement parasite)', () => {
    const onPick = vi.fn();
    renderListener({ extra: createElement(Picker, { onPick }) });
    const picker = screen.getByTestId('picker');
    picker.focus();
    const first = press('h');
    expect(first.defaultPrevented).toBe(true);
    typeScan(QR_URL.slice(1));
    expect(picker.value).toBe('');
    expect(onPick).not.toHaveBeenCalled();
    expect(sink.scans[0]).toMatchObject({ code: 'KP-000123' });
  });

  it('select focalisé : la recherche par lettre humaine est rejouée une seule fois', async () => {
    const clock = useClock();
    const onPick = vi.fn();
    renderListener({ extra: createElement(Picker, { onPick }) });
    const picker = screen.getByTestId('picker');
    picker.focus();
    press('h');
    await act(() => sleep(350));
    expect(picker.value).toBe('Hakim');
    clock.t += 1000;
    press('h');
    await act(() => sleep(350));
    expect(picker.value).toBe('Hugo');
    clock.t += 1000;
    typeTimed(clock, 'ka', 150);
    await act(() => sleep(350));
    expect(picker.value).toBe('Karim');
    expect(onPick.mock.calls.map((c) => c[0])).toEqual(['Hakim', 'Hugo', 'Karim']);
  });

  it('refuse le scan quand une autre fenêtre est ouverte', async () => {
    renderListener();
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    try {
      typeScan('KP-000123');
      expect(sink.scans).toHaveLength(0);
      expect(await screen.findByText(/Terminez ou fermez la fenêtre ouverte/)).toBeInTheDocument();
    } finally {
      modal.remove();
    }
  });
});

// ─── Panneau : fonctions pures ───────────────────────────────────────────────

const SERVER_MONTANTS = { total: 89, acompte: 10, reste: 79, paye: false, lignes: [{ label: 'Remplacement écran', prix: 89 }] };

function ticketFixture(overrides = {}) {
  return {
    id: 42,
    ticket_code: 'KP-000042',
    statut: 'Réparation terminée',
    client_id: 5,
    client_nom: 'Martin',
    client_prenom: 'Léa',
    client_tel: '0612345678',
    client_email: 'lea@example.test',
    marque: 'Apple',
    modele: 'iPhone 13',
    panne: 'Écran cassé',
    panne_detail: 'tactile HS',
    imei: IMEI_OK,
    technicien_assigne: 'Karim',
    date_recuperation: 'Jeudi 17h',
    date_depot: '2026-10-12T09:00:00',
    paye: 0,
    acompte: 10,
    telephone_pret: '',
    telephone_pret_rendu: false,
    commande_piece: 0,
    montants: SERVER_MONTANTS,
    ...overrides,
  };
}

describe('montants et garde-fous du panneau', () => {
  it('reprend les montants calculés par le serveur', () => {
    const m = montantsTicket(ticketFixture(), 20);
    expect(m).toMatchObject({ total: 89, acompte: 10, reste: 79, paye: false, serveur: true });
    expect(m.lignes).toEqual([{ label: 'Remplacement écran', prix: 89 }]);
  });

  it('recalcule comme la fiche sans montants serveur (lignes, réduction %, TVA, acompte)', () => {
    const t = ticketFixture({
      montants: undefined,
      reparation_supp: JSON.stringify([{ label: 'Écran', prix: 100 }, { label: 'Vitre arrière', prix: 50 }]),
      reduction_pourcentage: 10,
      acompte: 20,
    });
    const m = montantsTicket(t, 20);
    expect(m.total).toBe(162);
    expect(m.reste).toBe(142);
    expect(montantsTicket({ ...t, paye: 1 }, 20).reste).toBe(0);
  });

  it('se replie sur le devis estimé et l’ancien format', () => {
    const t = { panne: 'Batterie', devis_estime: 59, reparation_supp: '', acompte: 0 };
    expect(lignesTicket(t)).toEqual([{ label: 'Batterie', prix: 59 }]);
    expect(montantsTicket(t).total).toBe(59);
    expect(montantsTicket({ reparation_supp: '[]', devis_estime: 40 })).toMatchObject({ total: 40, estime: true });
  });

  it('détecte le téléphone de prêt en cours', () => {
    expect(pretEnCours(ticketFixture({ telephone_pret: 'iPhone 8 de prêt' }))).toBe(true);
    expect(pretEnCours(ticketFixture({ telephone_pret: 'iPhone 8', telephone_pret_rendu: true }))).toBe(false);
    expect(pretEnCours(ticketFixture())).toBe(false);
  });

  it('formate sans conversion les dates texte', () => {
    expect(formatDateTexte('2026-10-15 14:32:00')).toBe('15/10/2026 14:32');
    expect(formatDateTexte('2026-10-15')).toBe('15/10/2026');
    expect(formatDateTexte('demain matin')).toBe('demain matin');
  });

  it('masque l’IMEI et compose le modèle', () => {
    expect(imeiCourt(IMEI_OK)).toBe('…7518');
    expect(modeleTicket({ marque: 'Samsung', modele: 'Autre', modele_autre: 'Galaxy A54' })).toBe('Samsung Galaxy A54');
  });

  it('propose les actions selon le rôle et le statut', () => {
    const ids = (t, role) => actionsTicket(t, role).map((a) => `${a.id}${a.primary ? '*' : ''}`);
    expect(ids(ticketFixture(), 'accueil')).toEqual(['rendre*']);
    expect(ids(ticketFixture(), 'tech')).toEqual(['rendre*']);
    expect(ids(ticketFixture({ statut: 'En cours de réparation' }), 'tech')).toEqual(['terminer*', 'terminer_seul', 'rendre']);
    // Celui qui scanne l'appareil réparé prévient le client, accueil compris
    expect(ids(ticketFixture({ statut: 'En cours de réparation' }), 'accueil')).toEqual(['terminer*', 'terminer_seul', 'rendre']);
    // Réparation express sans « Démarrer » : terminer directement (technicien)
    expect(ids(ticketFixture({ statut: 'Pièce reçue' }), 'tech')).toEqual(['demarrer*', 'terminer', 'rendre']);
    expect(ids(ticketFixture({ statut: 'Pièce reçue' }), 'accueil')).toEqual(['rendre']);
    expect(actionsTicket(ticketFixture({ statut: 'En attente de pièce' }), 'tech')[1]).toMatchObject({ id: 'terminer', warn: { ok: 'Oui, terminer' } });
    // Accord client → terminé = devis refusé pour le serveur : jamais proposé
    expect(ids(ticketFixture({ statut: "En attente d'accord client" }), 'tech')).toEqual(['demarrer*', 'rendre']);
    expect(actionsTicket(ticketFixture({ statut: "En attente d'accord client" }), 'tech')[0].warn).toBeTruthy();
    expect(ids(ticketFixture({ statut: 'Clôturé', paye: 1 }), 'accueil')).toEqual([]);
    expect(ids(ticketFixture({ statut: 'Rendu au client' }), 'accueil')).toEqual(['encaisser*']);
  });

  it('liste les points d’attention', () => {
    const t = ticketFixture({ attention: 'Client pressé', telephone_pret: 'Galaxy S9', telephone_pret_imei: IMEI_OK });
    const ids = alertesTicket(t, montantsTicket(t)).map((a) => a.id);
    expect(ids).toEqual(['attention', 'pret', 'reste']);
    const rendu = ticketFixture({ statut: 'Clôturé', paye: 1, montants: { ...SERVER_MONTANTS, reste: 0, paye: true }, date_rendu: '2026-10-15 14:32:00', rendu_par: 'Sophie' });
    expect(alertesTicket(rendu, montantsTicket(rendu))[0].text).toBe('Appareil déjà rendu le 15/10/2026 14:32 par Sophie.');
  });

  it('applique les garde-fous de la remise', () => {
    const t = ticketFixture({ telephone_pret: 'iPhone 8' });
    const m = montantsTicket(t);
    const s = etatRestitutionInitial(m);
    expect(s.paiement).toBe('encaisser');
    expect(verifierRestitution(t, m, s).field).toBe('pret');
    expect(verifierRestitution(t, m, { ...s, pretOk: true }).field).toBe('mode');
    expect(verifierRestitution(t, m, { ...s, pretOk: true, paiement: 'non_paye' }).field).toBe('motif');
    expect(verifierRestitution(t, m, { ...s, pretOk: true, mode: 'CB' })).toBeNull();
    const enCours = ticketFixture({ statut: 'En cours de réparation' });
    expect(verifierRestitution(enCours, m, s).field).toBe('force');
  });

  it('construit le corps de la restitution', () => {
    const t = ticketFixture({ telephone_pret: 'iPhone 8' });
    const m = montantsTicket(t);
    const s = { ...etatRestitutionInitial(m), pretOk: true, mode: 'Espèces' };
    expect(corpsRestitution(t, m, s)).toEqual({
      paiement: 'encaisser', mode_paiement: 'Espèces', montant: 79, motif_non_paye: null,
      pret_restitue: true, confirmer_non_termine: false,
    });
    expect(corpsRestitution(t, m, { ...s, paiement: 'non_paye', motif: '  règlera samedi ' })).toMatchObject({
      paiement: 'non_paye', mode_paiement: null, montant: null, motif_non_paye: 'règlera samedi',
    });
    const paye = ticketFixture({ paye: 1, montants: { ...SERVER_MONTANTS, reste: 0, paye: true } });
    expect(corpsRestitution(paye, montantsTicket(paye), etatRestitutionInitial(montantsTicket(paye))))
      .toMatchObject({ paiement: 'deja_paye', montant: null, pret_restitue: null });
  });

  it('devis refusé : montant à vérifier sur la fiche, sauf si le serveur ne compte que les frais', () => {
    const refus = ticketFixture({ issue: 'refus_devis', montants: { ...SERVER_MONTANTS, source: 'devis_estime', lignes: [] } });
    expect(devisRefuse(refus)).toBe(true);
    expect(montantAVerifier(refus, montantsTicket(refus))).toBe('refus');
    const ids = (t, role, notes) => actionsTicket(t, role, notes).map((a) => `${a.id}${a.primary ? '*' : ''}`);
    expect(ids(refus, 'accueil')).toEqual(['facturer*', 'rendre']);
    expect(alertesTicket(refus, montantsTicket(refus)).map((a) => a.id)).toContain('facturation');

    const frais = ticketFixture({
      issue: 'refus_devis',
      montants: { total: 25, acompte: 0, reste: 25, paye: false, refus_devis: true, source: 'lignes', lignes: [{ label: 'Diagnostic', prix: 25 }] },
    });
    const mf = montantsTicket(frais);
    expect(mf.refusServeur).toBe(true);
    expect(montantAVerifier(frais, mf)).toBeNull();
    expect(ids(frais, 'accueil')).toEqual(['rendre*']);
    expect(alertesTicket(frais, mf).find((a) => a.id === 'facturation').text).toMatch(/seuls les frais/);

    const parNote = ticketFixture();
    const notes = [{ id: 3, contenu: '❌ Devis refusé par le client (au comptoir)' }, { id: 2, contenu: '✅ Devis accepté' }];
    expect(devisRefuse(parNote, notes)).toBe(true);
    expect(devisRefuse(parNote, [...notes].reverse())).toBe(false);
    expect(devisRefuse(ticketFixture({ statut: 'Clôturé', issue: 'refus_devis' }))).toBe(false);

    const enCours = ticketFixture({ statut: 'En cours de réparation', montants: { ...SERVER_MONTANTS, source: 'devis_estime' } });
    expect(montantAVerifier(enCours, montantsTicket(enCours))).toBe('estime');
    expect(montantAVerifier(ticketFixture({ montants: { ...SERVER_MONTANTS, source: 'devis_estime' } }), montantsTicket(ticketFixture({ montants: { ...SERVER_MONTANTS, source: 'devis_estime' } })))).toBeNull();
  });

  it('compte les jours du calendrier local depuis le dépôt (horodatage UTC sans fuseau)', () => {
    const utc = (d) => d.toISOString().slice(0, 19);
    const now = new Date(2026, 9, 16, 10, 0);
    expect(joursDepuis(utc(new Date(2026, 9, 15, 18, 0)), now)).toBe(1);
    expect(joursDepuis(utc(new Date(2026, 9, 16, 0, 30)), now)).toBe(0);
    expect(joursDepuis(utc(new Date(2026, 8, 30, 23, 0)), now)).toBe(16);
    expect(joursDepuis('2026-10-14', now)).toBe(2);
    expect(joursDepuis('n’importe quoi', now)).toBeNull();
    expect(joursDepuis(null, now)).toBeNull();
  });

  it('traduit les erreurs de résolution', () => {
    expect(scanErrorMessage({ status: 404 }, { kind: 'ticket', label: 'KP-000999' })).toBe('Code inconnu : KP-000999');
    expect(scanErrorMessage({ status: 404 }, { kind: 'imei', label: 'IMEI 1' })).toBe('Aucun ticket avec IMEI 1');
    expect(scanErrorMessage({ status: 429, message: 'x' }, {})).toMatch(/Trop de requêtes/);
    expect(scanErrorMessage(new TypeError('Failed to fetch'), {})).toMatch(/injoignable/);
  });
});

// ─── Panneau : composant ─────────────────────────────────────────────────────

function panelTree() {
  return createElement(MemoryRouter, { initialEntries: ['/accueil'] },
    createElement(ToastProvider, null, createElement(QuickScanPanel), createElement(LocationProbe)));
}

function renderPanel() {
  return render(panelTree());
}

function emit(code = 'KP-000042') {
  act(() => {
    window.dispatchEvent(new CustomEvent(SCAN_EVENT, {
      detail: { kind: 'ticket', code, query: code, label: code },
    }));
  });
}

describe('QuickScanPanel', () => {
  beforeEach(() => {
    takePendingScan();
    auth.user = { target: 'accueil', utilisateur: 'Sophie' };
    Object.values(apiMock).forEach((fn) => fn.mockReset());
    apiMock.resolveCode.mockResolvedValue({ type: 'ticket', id: 42, ticket_code: 'KP-000042' });
    apiMock.getTicket.mockResolvedValue(ticketFixture());
    apiMock.getNotes.mockResolvedValue([
      { id: 1, auteur: 'Karim', contenu: 'Rayure au dos signalée au client', important: true },
      { id: 2, auteur: 'Karim', contenu: 'note banale', important: false },
    ]);
    apiMock.getCached.mockResolvedValue([]);
    apiMock.updateTicket.mockResolvedValue({ ok: true });
    apiMock.addHistory.mockResolvedValue({ ok: true });
    apiMock.patchKeepalive.mockResolvedValue(true);
  });

  it('ouvre un panneau accessible avec le résumé du ticket', async () => {
    renderPanel();
    emit();
    const dialog = await screen.findByRole('dialog');
    expect(apiMock.resolveCode).toHaveBeenCalledWith('KP-000042');
    expect(apiMock.getTicket).toHaveBeenCalledWith(42);
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const title = within(dialog).getByRole('heading', { name: 'KP-000042' });
    expect(document.activeElement).toBe(title);
    expect(within(dialog).getByText('Léa MARTIN')).toBeInTheDocument();
    expect(within(dialog).getByText('06 12 34 56 78').closest('a')).toHaveAttribute('href', 'tel:0612345678');
    expect(within(dialog).getByText('Reste à payer : 79.00 €')).toBeInTheDocument();
    expect(within(dialog).getByText('Rayure au dos signalée au client')).toBeInTheDocument();
    expect(within(dialog).queryByText('note banale')).not.toBeInTheDocument();
    expect(within(dialog).getByText('…7518')).toBeInTheDocument();
  });

  it('se ferme avec Échap', async () => {
    renderPanel();
    emit();
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('rend au client avec encaissement après les garde-fous', async () => {
    apiMock.getTicket.mockResolvedValue(ticketFixture({ telephone_pret: 'iPhone 8 de prêt' }));
    apiMock.restitution.mockResolvedValue({
      ok: true,
      deja_rendu: false,
      points_fidelite: 790,
      ticket: ticketFixture({
        statut: 'Clôturé', paye: 1, telephone_pret: 'iPhone 8 de prêt', telephone_pret_rendu: true,
        montants: { ...SERVER_MONTANTS, reste: 0, paye: true }, date_rendu: '2026-10-15 14:32:00', rendu_par: 'Sophie',
      }),
    });
    renderPanel();
    emit();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Rendre au client/ }));
    expect(within(dialog).getByRole('heading', { name: /Remise au client/ })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /Confirmer la remise/ }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Récupérez d’abord le téléphone de prêt.');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Téléphone de prêt récupéré/ }));

    fireEvent.click(within(dialog).getByRole('button', { name: /Confirmer la remise/ }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choisissez le mode de paiement.');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'CB' }));

    fireEvent.click(within(dialog).getByRole('button', { name: /Confirmer la remise/ }));
    await waitFor(() => expect(apiMock.restitution).toHaveBeenCalledTimes(1));
    expect(apiMock.restitution).toHaveBeenCalledWith(42, {
      paiement: 'encaisser', mode_paiement: 'CB', montant: 79, motif_non_paye: null,
      pret_restitue: true, confirmer_non_termine: false,
    });
    expect(await within(dialog).findByText(/^Rendu au client$/)).toBeInTheDocument();
    expect(within(dialog).getByText(/\+790 points fidélité/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Rendre au client/ })).not.toBeInTheDocument();
  });

  it('affiche le refus 409 du serveur', async () => {
    apiMock.getTicket.mockResolvedValue(ticketFixture({ paye: 1, montants: { ...SERVER_MONTANTS, reste: 0, paye: true } }));
    apiMock.restitution.mockRejectedValue(Object.assign(new Error('Récupérez d’abord le prêt (Galaxy S9).'), {
      status: 409, data: { code: 'pret_non_restitue', message: 'Récupérez d’abord le prêt (Galaxy S9).', reste: null },
    }));
    renderPanel();
    emit();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Rendre au client/ }));
    expect(within(dialog).getByText('Déjà payé : rien à encaisser.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /Confirmer la remise/ }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Récupérez d’abord le prêt (Galaxy S9).');
    expect(apiMock.restitution.mock.calls[0][1]).toMatchObject({ paiement: 'deja_paye', pret_restitue: null });
    await waitFor(() => expect(apiMock.getTicket).toHaveBeenCalledTimes(2));
  });

  it('signale un code inconnu sans ouvrir le panneau', async () => {
    apiMock.resolveCode.mockRejectedValue(Object.assign(new Error('Aucun ticket ne correspond'), { status: 404 }));
    renderPanel();
    emit('KP-000999');
    expect(await screen.findByText('Code inconnu : KP-000999')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('prévient hors connexion', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderPanel();
    emit();
    expect(await screen.findByText(/Hors connexion/)).toBeInTheDocument();
    expect(apiMock.resolveCode).not.toHaveBeenCalled();
  });

  it('ouvre la fiche client d’un client scanné', async () => {
    apiMock.resolveCode.mockResolvedValue({ type: 'client', id: 7 });
    renderPanel();
    emit('0612345678');
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/accueil/clients?client=7'));
  });

  it('navigue vers la fiche ticket et la fiche client', async () => {
    renderPanel();
    emit();
    let dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Fiche client/ }));
    expect(screen.getByTestId('loc')).toHaveTextContent('/accueil/clients?client=5');
    emit('KP-000043');
    dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Ouvrir la fiche/ }));
    expect(screen.getByTestId('loc')).toHaveTextContent('/accueil/ticket/42');
  });

  it('technicien : démarrage annulable, puis validé', async () => {
    auth.user = { target: 'tech', utilisateur: 'Karim' };
    apiMock.getTicket.mockResolvedValue(ticketFixture({ statut: 'Pièce reçue', technicien_assigne: '' }));
    apiMock.changeStatus.mockResolvedValue({ ok: true });
    renderPanel();
    emit();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Démarrer la réparation/ }));
    const cancel = within(dialog).getByRole('button', { name: 'Annuler' });
    expect(document.activeElement).toBe(cancel);
    fireEvent.click(cancel);
    expect(apiMock.changeStatus).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: /Démarrer la réparation/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Valider maintenant' }));
    await waitFor(() => expect(apiMock.changeStatus).toHaveBeenCalledWith(42, 'En cours de réparation'));
    await waitFor(() => expect(apiMock.updateTicket).toHaveBeenCalledWith(42, { technicien_assigne: 'Karim' }));
  });

  it('technicien : Échap pendant l’action annulable l’annule sans fermer le panneau', async () => {
    auth.user = { target: 'tech', utilisateur: 'Karim' };
    apiMock.getTicket.mockResolvedValue(ticketFixture({ statut: 'En cours de réparation' }));
    renderPanel();
    emit();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Terminé \+ prévenir le client/ }));
    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Annuler' }), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Annuler' })).not.toBeInTheDocument();
    expect(await screen.findByText(/action annulée/)).toBeInTheDocument();
    await sleep(20);
    expect(apiMock.changeStatus).not.toHaveBeenCalled();
  });

  it('technicien : page quittée pendant l’action annulable → envoi keepalive', async () => {
    auth.user = { target: 'tech', utilisateur: 'Karim' };
    apiMock.getTicket.mockResolvedValue(ticketFixture({ statut: 'Pièce reçue', technicien_assigne: '' }));
    renderPanel();
    emit();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Démarrer la réparation/ }));
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(apiMock.patchKeepalive).toHaveBeenCalledWith('/api/tickets/42/statut', { statut: 'En cours de réparation' });
    expect(apiMock.updateTicket).toHaveBeenCalledWith(42, { technicien_assigne: 'Karim' }, { keepalive: true });
    expect(apiMock.changeStatus).not.toHaveBeenCalled();
  });

  it('technicien : changement d’utilisateur pendant l’action annulable → rien n’est envoyé, message', async () => {
    auth.user = { target: 'tech', utilisateur: 'Karim' };
    apiMock.getTicket.mockResolvedValue(ticketFixture({ statut: 'En cours de réparation' }));
    const { rerender } = renderPanel();
    emit();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Terminé sans prévenir/ }));
    auth.user = { target: 'tech', utilisateur: 'Hugo' };
    rerender(panelTree());
    expect(await screen.findByText(/« Réparation terminée » non enregistré \(session fermée\)/)).toBeInTheDocument();
    await sleep(20);
    expect(apiMock.changeStatus).not.toHaveBeenCalled();
    expect(apiMock.patchKeepalive).not.toHaveBeenCalled();
  });

  it('devis refusé : la remise conseille de facturer depuis la fiche', async () => {
    apiMock.getTicket.mockResolvedValue(ticketFixture({
      issue: 'refus_devis', montants: { ...SERVER_MONTANTS, source: 'devis_estime', lignes: [] },
    }));
    renderPanel();
    emit();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText(/Devis refusé : le reste à payer vient du devis/)).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole('button', { name: /Rendre au client/ }));
    expect(within(dialog).getAllByText(/Devis refusé : le reste à payer vient du devis/)).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retour' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Ouvrir la fiche pour facturer/ }));
    expect(screen.getByTestId('loc')).toHaveTextContent('/accueil/ticket/42');
    expect(apiMock.restitution).not.toHaveBeenCalled();
  });

  it('encaisser le solde : mode de paiement obligatoire et noté dans l’historique', async () => {
    apiMock.getTicket.mockResolvedValue(ticketFixture({ statut: 'Rendu au client', date_rendu: '2026-10-15 14:32:00', rendu_par: 'Sophie' }));
    apiMock.setPaye.mockResolvedValue({ ok: true, paye: true, points_fidelite: 89 });
    renderPanel();
    emit();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Encaisser le solde/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Confirmer l’encaissement/ }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choisissez le mode de paiement.');
    expect(apiMock.setPaye).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Espèces' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Confirmer l’encaissement/ }));
    await waitFor(() => expect(apiMock.addHistory).toHaveBeenCalledWith(42, 'Encaissé 79,00 € (Espèces) — par Sophie'));
    expect(apiMock.setPaye).toHaveBeenCalledWith(42, true);
    expect(await screen.findByText(/solde encaissé \(Espèces\) · \+89 points fidélité/)).toBeInTheDocument();
  });

  it('technicien : devis non validé → confirmation explicite', async () => {
    auth.user = { target: 'tech', utilisateur: 'Karim' };
    apiMock.getTicket.mockResolvedValue(ticketFixture({ statut: "En attente d'accord client" }));
    renderPanel();
    emit();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Démarrer la réparation/ }));
    expect(within(dialog).getByText(/Le client a-t-il accepté le devis/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Oui, devis accepté' }));
    expect(within(dialog).getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
  });

  it('second scan identique : appareil vérifié', async () => {
    renderPanel();
    emit();
    const dialog = await screen.findByRole('dialog');
    await new Promise((r) => setTimeout(r, 0));
    emit();
    expect(await within(dialog).findByText('2e scan identique')).toBeInTheDocument();
  });

  it('IMEI du téléphone de prêt scanné pendant la remise : prêt coché', async () => {
    const PRET_IMEI = '356938035643809';
    apiMock.getTicket.mockResolvedValue(ticketFixture({ telephone_pret: 'iPhone 8 de prêt', telephone_pret_imei: PRET_IMEI }));
    renderPanel();
    emit();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Rendre au client/ }));
    const pret = within(dialog).getByRole('checkbox', { name: /Téléphone de prêt récupéré/ });
    expect(pret).not.toBeChecked();
    act(() => {
      window.dispatchEvent(new CustomEvent(SCAN_EVENT, {
        detail: { kind: 'imei', imei: PRET_IMEI, query: PRET_IMEI, label: `IMEI ${PRET_IMEI}` },
      }));
    });
    expect(await within(dialog).findByText('Téléphone de prêt scanné')).toBeInTheDocument();
    expect(pret).toBeChecked();
  });

  it('autre ticket scanné pendant une remise : alerte de correspondance', async () => {
    renderPanel();
    emit();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Rendre au client/ }));
    apiMock.resolveCode.mockResolvedValue({ type: 'ticket', id: 43, ticket_code: 'KP-000043' });
    emit('KP-000043');
    expect(await within(dialog).findByText(/KP-000043 scanné pendant la remise de KP-000042/)).toBeInTheDocument();
    expect(apiMock.getTicket).toHaveBeenCalledTimes(1);
  });
});
