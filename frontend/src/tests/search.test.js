/**
 * Recherche globale : fonctions pures (normalisation, détection de code, surlignage, historique)
 * et comportement de la palette (clavier, douchette, réponses obsolètes, erreurs).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import api from '../lib/api';
import SearchPalette, {
  normalizeText, digitsOnly, isValidImei, extractTicketFromUrl, normalizeTicketCode,
  detectQueryKind, normalizePhoneInput, formatPhone, highlightParts, matchesQuery,
  loadRecents, rememberRecent, clearRecents, buildResultGroups, hrefFor, OPEN_SEARCH_EVENT,
} from '../components/SearchPalette';

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { target: 'accueil', utilisateur: 'Testeur' } }),
}));

// IMEI d'exemple valide (Luhn) et la même série avec un mauvais chiffre de contrôle
const IMEI_OK = '490154203237518';
const IMEI_KO = '490154203237519';

describe('normalizeText', () => {
  it('retire accents, majuscules et espaces superflus', () => {
    expect(normalizeText('  Hélène   ÉCRAN  ')).toBe('helene ecran');
    expect(normalizeText('Çà et là')).toBe('ca et la');
  });
  it('tolère null / undefined', () => {
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
  });
});

describe('digitsOnly / normalizePhoneInput', () => {
  it('garde uniquement les chiffres', () => {
    expect(digitsOnly('06 12.34-56 78')).toBe('0612345678');
  });
  it('ramène +33 et 0033 au format national', () => {
    expect(normalizePhoneInput('+33 6 12 34 56 78')).toBe('0612345678');
    expect(normalizePhoneInput('0033612345678')).toBe('0612345678');
    expect(normalizePhoneInput('06.12.34.56.78')).toBe('0612345678');
  });
  it('laisse les numéros étrangers en chiffres', () => {
    expect(normalizePhoneInput('+41 79 123 45 67')).toBe('41791234567');
  });
});

describe('isValidImei', () => {
  it('valide un IMEI de 15 chiffres (Luhn)', () => {
    expect(isValidImei(IMEI_OK)).toBe(true);
    expect(isValidImei('49 015420 323751 8')).toBe(true);
  });
  it('refuse un mauvais chiffre de contrôle, une mauvaise longueur ou que des zéros', () => {
    expect(isValidImei(IMEI_KO)).toBe(false);
    expect(isValidImei('49015420323751')).toBe(false);
    expect(isValidImei('000000000000000')).toBe(false);
    // EAN-13 d'une boîte : pas un IMEI
    expect(isValidImei('3700123456789')).toBe(false);
  });
});

describe('extractTicketFromUrl', () => {
  it('extrait le code de l’URL du QR', () => {
    expect(extractTicketFromUrl('https://klikphone.example/suivi?ticket=KP-000123')).toBe('KP-000123');
    expect(extractTicketFromUrl('/suivi?lang=fr&ticket=KP-000042#x')).toBe('KP-000042');
    expect(extractTicketFromUrl('KP-000123')).toBeNull();
  });
});

describe('normalizeTicketCode', () => {
  it.each([
    ['KP-000123', 'KP-000123'],
    ['kp-000123', 'KP-000123'],
    ['KP-123', 'KP-000123'],
    ['kp123', 'KP-000123'],
    ['KP 000123', 'KP-000123'],
    ['KP.000123', 'KP-000123'],
    ['#123', 'KP-000123'],
    ['000123', 'KP-000123'],
    ['002301', 'KP-002301'],
    ['https://x.example/suivi?ticket=KP-000123', 'KP-000123'],
    ['https://x.example/suivi?ticket=kp-77', 'KP-000077'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeTicketCode(input)).toBe(expected);
  });

  it('ne prend pas un nombre nu pour un code (sauf option)', () => {
    expect(normalizeTicketCode('123')).toBeNull();
    expect(normalizeTicketCode('2301')).toBeNull();
    expect(normalizeTicketCode('123', { allowBareNumber: true })).toBe('KP-000123');
  });

  it('refuse téléphones, zéro et textes', () => {
    expect(normalizeTicketCode('0612345678')).toBeNull();
    expect(normalizeTicketCode('0612345678', { allowBareNumber: true })).toBeNull();
    expect(normalizeTicketCode('061234')).toBeNull();
    expect(normalizeTicketCode('KP-000000')).toBeNull();
    expect(normalizeTicketCode('dupont')).toBeNull();
    expect(normalizeTicketCode('')).toBeNull();
    expect(normalizeTicketCode('KP-12345678')).toBeNull();
  });
});

describe('detectQueryKind', () => {
  it('code ticket explicite', () => {
    expect(detectQueryKind('KP-000123')).toEqual({ kind: 'ticket', explicit: true, code: 'KP-000123' });
    expect(detectQueryKind('https://x/suivi?ticket=KP-000009').code).toBe('KP-000009');
  });
  it('IMEI valide explicite, sinon simple nombre', () => {
    expect(detectQueryKind(IMEI_OK)).toMatchObject({ kind: 'imei', explicit: true, digits: IMEI_OK });
    expect(detectQueryKind(IMEI_KO)).toMatchObject({ kind: 'number', explicit: false });
  });
  it('téléphone complet quel que soit le format', () => {
    expect(detectQueryKind('06 12 34 56 78')).toMatchObject({ kind: 'phone', explicit: true });
    expect(detectQueryKind('+33 6 12 34 56 78')).toMatchObject({ kind: 'phone', explicit: true });
    expect(detectQueryKind('06.12.34.56.78')).toMatchObject({ kind: 'phone', explicit: true });
  });
  it('nombre court ambigu (fin de téléphone ou numéro de ticket)', () => {
    expect(detectQueryKind('2301')).toMatchObject({ kind: 'number', explicit: false, digits: '2301' });
    expect(detectQueryKind('56 78')).toMatchObject({ kind: 'number', explicit: false, digits: '5678' });
  });
  it('texte libre et saisie vide', () => {
    expect(detectQueryKind('jean dupont')).toEqual({ kind: 'text', explicit: false });
    expect(detectQueryKind('iPhone 13 écran')).toEqual({ kind: 'text', explicit: false });
    expect(detectQueryKind('   ')).toEqual({ kind: 'empty', explicit: false });
  });
});

describe('formatPhone', () => {
  it('formate les numéros français', () => {
    expect(formatPhone('0612345678')).toBe('06 12 34 56 78');
    expect(formatPhone('+33612345678')).toBe('+33 6 12 34 56 78');
  });
  it('laisse les autres formats intacts', () => {
    expect(formatPhone('+41 79 123 45 67')).toBe('+41 79 123 45 67');
    expect(formatPhone('')).toBe('');
  });
});

describe('highlightParts', () => {
  const hits = (parts) => parts.filter((p) => p.hit).map((p) => p.text);

  it('surligne sans tenir compte des accents ni de la casse', () => {
    expect(hits(highlightParts('Hélène Dupont', 'helene'))).toEqual(['Hélène']);
    expect(hits(highlightParts('ÉCRAN cassé', 'ecran casse'))).toEqual(['ÉCRAN', 'cassé']);
  });
  it('reconstitue le texte d’origine', () => {
    const parts = highlightParts('Jean Dupont — iPhone 13', 'dupont 13');
    expect(parts.map((p) => p.text).join('')).toBe('Jean Dupont — iPhone 13');
    expect(hits(parts)).toEqual(['Dupont', '13']);
  });
  it('ignore les mots d’un caractère et les requêtes vides', () => {
    expect(highlightParts('abc', 'a')).toEqual([{ text: 'abc', hit: false }]);
    expect(highlightParts('abc', '')).toEqual([{ text: 'abc', hit: false }]);
  });
});

describe('matchesQuery', () => {
  const fields = ['Écran iPhone 13', 'Mobilax', 'REF-42', 'KP-000123', 'Jean', 'Dupont', '06 12 34 56 78', 'Apple', 'iPhone 13'];
  it('exige chaque mot dans au moins un champ', () => {
    expect(matchesQuery(fields, 'dupont iphone')).toBe(true);
    expect(matchesQuery(fields, 'ecran mobilax')).toBe(true);
    expect(matchesQuery(fields, 'dupont samsung')).toBe(false);
  });
  it('compare les téléphones en chiffres', () => {
    expect(matchesQuery(fields, '0612345678')).toBe(true);
    expect(matchesQuery(fields, '+33 6 12 34')).toBe(true);
    expect(matchesQuery(fields, '5678')).toBe(true);
    expect(matchesQuery(fields, '0699999999')).toBe(false);
  });
  it('accepte une requête vide', () => {
    expect(matchesQuery(fields, '  ')).toBe(true);
  });
});

describe('historique local', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearRecents('test');
  });

  it('mémorise requêtes et éléments, sans doublon et en tête de liste', () => {
    rememberRecent('test', { query: 'dupont', item: { type: 'ticket', id: 1, label: 'KP-000001' } });
    rememberRecent('test', { query: 'martin', item: { type: 'client', id: 7, label: 'Martin' } });
    const r = rememberRecent('test', { query: 'Dupont', item: { type: 'ticket', id: 1, label: 'KP-000001' } });
    expect(r.queries).toEqual(['Dupont', 'martin']);
    expect(r.items.map((i) => `${i.type}:${i.id}`)).toEqual(['ticket:1', 'client:7']);
    expect(loadRecents('test')).toEqual(r);
  });

  it('ne garde ni téléphone ni IMEI', () => {
    rememberRecent('test', { query: '06 12 34 56 78' });
    rememberRecent('test', { query: IMEI_OK });
    rememberRecent('test', { query: 'dupont 0612345678' });
    expect(loadRecents('test').queries).toEqual([]);
  });

  it('fonctionne quand le stockage est indisponible', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded'); });
    expect(loadRecents('test')).toEqual({ queries: [], items: [] });
    expect(() => rememberRecent('test', { query: 'dupont' })).not.toThrow();
    expect(rememberRecent('test', { query: 'dupont' }).queries).toEqual(['dupont']);
  });

  it('ignore un contenu corrompu', () => {
    localStorage.setItem('kp_search_recent:test', '{pas du json');
    expect(loadRecents('test')).toEqual({ queries: [], items: [] });
  });
});

describe('buildResultGroups / hrefFor', () => {
  it('groupe dans l’ordre tickets, clients, devis, commandes', () => {
    const res = {
      q: 'dupont',
      resolved: null,
      groups: {
        tickets: [{ id: 5, ticket_code: 'KP-000005', statut: 'Réparation terminée' }],
        clients: [{ id: 9, nom: 'Dupont' }],
        devis: [],
        commandes: [{ id: 3, description: 'Écran', ticket_id: 5 }, { id: 4, description: 'Batterie', reference: 'B-1', ticket_id: null }],
      },
    };
    const groups = buildResultGroups(res, '/accueil');
    expect(groups.map((g) => g.key)).toEqual(['tickets', 'clients', 'commandes']);
    expect(groups[0].items[0].href).toBe('/accueil/ticket/5');
    expect(groups[1].items[0].href).toBe('/accueil/clients?client=9');
    expect(groups[2].items[0].href).toBe('/accueil/ticket/5');
    expect(groups[2].items[1].href).toBe('/accueil/commandes?q=B-1');
  });

  it('tolère une réponse vide ou partielle', () => {
    expect(buildResultGroups(null, '/tech')).toEqual([]);
    expect(buildResultGroups({ groups: { tickets: [null, { id: 1 }] } }, '/tech')[0].items).toHaveLength(1);
    expect(hrefFor('devis', 2, '/tech')).toBe('/tech/devis?id=2');
  });

  it('ajoute le numéro du devis au lien (?q=) quand il est connu', () => {
    expect(hrefFor('devis', 2, '/tech', { q: 'DV 2026/001' })).toBe('/tech/devis?id=2&q=DV%202026%2F001');
    const groups = buildResultGroups({ groups: { devis: [{ id: 7, numero: 'DV-0007' }] } }, '/accueil');
    expect(groups[0].items[0].href).toBe('/accueil/devis?id=7&q=DV-0007');
  });
});

// ─── Palette (composant) ─────────────────────────────────────────────────────

function LocationProbe() {
  const loc = useLocation();
  return createElement('output', { 'data-testid': 'loc' }, `${loc.pathname}${loc.search}`);
}

function renderPalette(path = '/accueil') {
  return render(createElement(
    MemoryRouter, { initialEntries: [path] },
    createElement(SearchPalette), createElement(LocationProbe),
  ));
}

function openPalette(q = '') {
  act(() => { window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT, { detail: { q } })); });
  return screen.getByRole('combobox');
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const RESULTS = {
  q: 'dupont',
  resolved: null,
  groups: {
    tickets: [{
      id: 5, ticket_code: 'KP-000005', statut: 'Réparation terminée', client_id: 9,
      client_nom: 'Dupont', client_prenom: 'Jean', client_tel: '0612345678',
      marque: 'Apple', modele: 'iPhone 13', panne: 'Écran', paye: 0, match: 'nom',
    }],
    clients: [{ id: 9, nom: 'Dupont', prenom: 'Jean', telephone: '0612345678', nb_tickets: 1, dernier_statut: 'Réparation terminée' }],
    devis: [],
    commandes: [],
  },
};

describe('palette de recherche', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    clearRecents('Testeur');
  });

  it('Ctrl+K ouvre un dialogue modal centré sur le champ, Échap le ferme', async () => {
    renderPalette();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const input = screen.getByRole('combobox');
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-controls');
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('reste inactive hors des pages du staff (suivi public, kiosque)', () => {
    renderPalette('/suivi');
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    act(() => { window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT)); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('affiche les résultats groupés, navigue aux flèches (aria-activedescendant) et ouvre avec Entrée', async () => {
    const search = vi.spyOn(api, 'search').mockResolvedValue(RESULTS);
    renderPalette();
    const input = openPalette();
    fireEvent.change(input, { target: { value: 'dupont' } });
    const options = await screen.findAllByRole('option');
    expect(search).toHaveBeenCalledWith('dupont', 8);
    expect(options).toHaveLength(2);
    expect(screen.getByRole('group', { name: /Tickets/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Clients/ })).toBeInTheDocument();
    expect(options[0]).toHaveTextContent('KP-000005');
    expect(options[0]).toHaveTextContent('Trouvé : nom');
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', options[1].id);
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/accueil/clients?client=9'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(loadRecents('Testeur').queries).toEqual(['dupont']);
  });

  it('Entrée sur une réponse « resolved » ouvre directement la fiche', async () => {
    vi.spyOn(api, 'search').mockResolvedValue({ ...RESULTS, resolved: { type: 'ticket', id: 5, ticket_code: 'KP-000005' } });
    renderPalette();
    const input = openPalette();
    fireEvent.change(input, { target: { value: '06 12 34 56 78' } });
    await screen.findAllByRole('option');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/accueil/ticket/5'));
  });

  it('ouvre le ticket scanné à la douchette (QWERTY sur poste AZERTY), même après une saisie', async () => {
    vi.spyOn(api, 'search').mockResolvedValue({ q: '', resolved: null, groups: {} });
    const resolve = vi.spyOn(api, 'resolveCode').mockResolvedValue({ type: 'ticket', id: 641, ticket_code: 'KP-000641' });
    renderPalette('/accueil/clients');
    const input = openPalette('dup');
    for (const ch of "https://x.test/suivi?ticket=KP)ààà-'&") {
      fireEvent.keyDown(input, { key: ch });
      fireEvent.change(input, { target: { value: input.value + ch } });
    }
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/accueil/ticket/641'));
    expect(resolve).toHaveBeenCalledWith('KP-000641');
  });

  it('ouvre le ticket d’un numéro de série scanné', async () => {
    vi.spyOn(api, 'search').mockResolvedValue({ q: '', resolved: null, groups: {} });
    const resolve = vi.spyOn(api, 'resolveCode').mockResolvedValue({ type: 'ticket', id: 77, ticket_code: 'KP-000077' });
    renderPalette();
    const input = openPalette();
    for (const ch of 'C02XK1JHJG5H') {
      fireEvent.keyDown(input, { key: ch });
      fireEvent.change(input, { target: { value: input.value + ch } });
    }
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/accueil/ticket/77'));
    expect(resolve).toHaveBeenCalledWith('C02XK1JHJG5H');
  });

  it('ne prend pas une touche maintenue (auto-répétition) pour un scan', async () => {
    vi.spyOn(api, 'search').mockResolvedValue({ q: '', resolved: null, groups: {} });
    const resolve = vi.spyOn(api, 'resolveCode').mockResolvedValue({ type: 'ticket', id: 1, ticket_code: 'KP-000001' });
    renderPalette();
    const input = openPalette();
    const keys = [['k', false], ['p', false], ['1', false], ...Array.from({ length: 6 }, () => ['1', true])];
    for (const [ch, repeat] of keys) {
      fireEvent.keyDown(input, { key: ch, repeat });
      fireEvent.change(input, { target: { value: input.value + ch } });
    }
    // Au-delà du silence de fin de scan sans suffixe (SCAN_TIMING.scanGap)
    await act(async () => { await new Promise((r) => { setTimeout(r, 400); }); });
    expect(resolve).not.toHaveBeenCalled();
    expect(input).toHaveValue('kp1111111');
    expect(screen.getByTestId('loc')).toHaveTextContent('/accueil');
  });

  it('signale un code ticket inconnu sans quitter la palette', async () => {
    vi.spyOn(api, 'search').mockResolvedValue({ q: 'KP-099999', resolved: null, groups: {} });
    vi.spyOn(api, 'resolveCode').mockRejectedValue(new Error('Aucun ticket ne correspond'));
    renderPalette();
    const input = openPalette();
    fireEvent.change(input, { target: { value: 'KP-099999' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Aucun ticket ne correspond à « KP-099999 »');
    expect(screen.getByTestId('loc')).toHaveTextContent('/accueil');
  });

  it('ignore une réponse arrivée après une recherche plus récente', async () => {
    const first = deferred();
    const search = vi.spyOn(api, 'search')
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => Promise.resolve({
        q: 'martin', resolved: null,
        groups: { clients: [{ id: 3, nom: 'Martin', prenom: 'Léa', nb_tickets: 0 }] },
      }));
    renderPalette();
    const input = openPalette();
    fireEvent.change(input, { target: { value: 'dupont' } });
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: 'martin' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    await act(async () => { first.resolve(RESULTS); await first.promise; });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Léa Martin');
  });

  it('affiche l’erreur réseau avec un bouton Réessayer', async () => {
    const search = vi.spyOn(api, 'search')
      .mockRejectedValueOnce(new Error('Serveur injoignable'))
      .mockResolvedValueOnce(RESULTS);
    renderPalette();
    const input = openPalette();
    fireEvent.change(input, { target: { value: 'dupont' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Serveur injoignable');
    fireEvent.click(screen.getByRole('button', { name: /Réessayer/ }));
    expect(await screen.findAllByRole('option')).toHaveLength(2);
    expect(search).toHaveBeenCalledTimes(2);
  });
});
