/**
 * Suivi client sur un appareil où un membre du personnel est connecté (tablette de la boutique) :
 * - le numéro saisi ou le lien décide seul de l'accès : la session du poste n'est jamais jointe ;
 * - sans preuve (QR scanné au comptoir par le personnel), la session est jointe ;
 * - « Retour à l'accueil » seulement depuis une borne de dépôt de la boutique, avec retour
 *   automatique ; arrivé par le QR ou un lien (téléphone du client), aucun retour.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const fetchInitial = global.fetch;

const reponse = (data, status = 200) => ({
  ok: status < 300,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: () => Promise.resolve(data),
  text: () => Promise.resolve(JSON.stringify(data)),
});

const TICKET = {
  id: 5, ticket_code: 'KP-000005', statut: 'En cours de réparation', marque: 'Apple', modele: 'iPhone 12',
  panne: 'Batterie', date_depot: '2026-10-15T10:00:00', reparation_supp: '[]', devis_estime: 0,
};
const JETON = 'JetonFictif_0123456789';

describe('ApiClient.suiviGet : session du poste jamais jointe à une preuve', () => {
  let api;
  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('kp_token', 'jeton-du-poste');
    vi.resetModules();
    api = (await import('../lib/api')).default;
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve(reponse(TICKET)));
  });
  afterEach(() => { global.fetch = fetchInitial; vi.restoreAllMocks(); });

  const entetes = () => global.fetch.mock.calls.map(([, init]) => init?.headers || {});

  it('numéro saisi : en-tête X-Suivi-Tel, sans Authorization', async () => {
    await api.getTicketByCode('KP-000005', { tel: '06 12 34 56 79' });
    const [h] = entetes();
    expect(h['X-Suivi-Tel']).toBe('0612345679');
    expect(h.Authorization).toBeUndefined();
  });

  it('lien avec jeton : t en query, sans Authorization', async () => {
    await api.getPublicCommandes('KP-000005', { t: JETON });
    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain(`t=${JETON}`);
    expect(entetes()[0].Authorization).toBeUndefined();
  });

  it('sans preuve (personnel au comptoir) : session du poste jointe', async () => {
    await api.getTicketByCode('KP-000005', null);
    expect(entetes()[0].Authorization).toBe('Bearer jeton-du-poste');
  });
});

describe('SuiviPage : retour à l’accueil seulement sur la tablette de la boutique', () => {
  let SuiviPage;
  let RETOUR_AUTO_MS;
  let retourBoutique;

  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    vi.resetModules();
    vi.doMock('../hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
    vi.doMock('../components/FideliteCard', () => ({ default: () => null }));
    vi.doMock('../components/ScratchCard', () => ({ default: () => null }));
    global.fetch = vi.fn().mockImplementation((url) => Promise.resolve(
      reponse(String(url).includes('/api/parts/public/') ? [] : String(url).includes('has-avis') ? { has_avis: false } : TICKET),
    ));
    ({ default: SuiviPage, RETOUR_AUTO_MS, retourBoutique } = await import('../pages/SuiviPage'));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    global.fetch = fetchInitial;
    vi.doUnmock('../hooks/useAuth');
    vi.doUnmock('../components/FideliteCard');
    vi.doUnmock('../components/ScratchCard');
    vi.restoreAllMocks();
  });

  function Ou() {
    return <p data-testid="ou">{useLocation().pathname}</p>;
  }

  function monter(state) {
    return render(
      <MemoryRouter initialEntries={[{ pathname: '/suivi', search: `?t=${JETON}&ticket=KP-000005`, state }]}>
        <Routes>
          <Route path="/suivi" element={<SuiviPage />} />
          <Route path="*" element={<Ou />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  const vider = () => act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });

  it('retourBoutique : seules les bornes de dépôt sont acceptées', () => {
    expect(retourBoutique({ retour: '/client' })).toBe('/client');
    expect(retourBoutique({ retour: '/deposer' })).toBe('/deposer');
    expect(retourBoutique({ retour: '/client?staff=1' })).toBe('/client?staff=1');
    for (const r of ['/', '/accueil', '/accueil/config', '//exemple.com', 'https://exemple.com', '']) {
      expect(retourBoutique({ retour: r })).toBeNull();
    }
    expect(retourBoutique(null)).toBeNull();
  });

  it('QR ou lien sur le téléphone du client : aucun retour vers l’accueil', async () => {
    monter(undefined);
    expect(await screen.findByText('KP-000005')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retour à l'accueil/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Retour à l'accueil/ })).toBeNull();
    expect(document.querySelector('a[href="/"]')).toBeNull();
    // Le lien reste ouvrable sur le téléphone : la preuve est mémorisée dans l'onglet
    expect(sessionStorage.getItem('kp_suivi_preuve:KP-000005')).not.toBeNull();
  });

  it('borne de dépôt : bouton de retour vers la borne, preuve jamais mémorisée', async () => {
    monter({ retour: '/deposer' });
    expect(await screen.findByText('KP-000005')).toBeInTheDocument();
    expect(sessionStorage.getItem('kp_suivi_preuve:KP-000005')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Retour à l'accueil/ }));
    expect(screen.getByTestId('ou').textContent).toBe('/deposer');
  });

  it('borne de dépôt : retour automatique après une minute sans activité, repoussé par un toucher', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    monter({ retour: '/client' });
    await vider();
    expect(screen.getByRole('button', { name: /Retour à l'accueil/ })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(RETOUR_AUTO_MS - 5000); });
    fireEvent.pointerDown(window);
    act(() => { vi.advanceTimersByTime(RETOUR_AUTO_MS - 1000); });
    expect(screen.queryByTestId('ou')).toBeNull();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId('ou').textContent).toBe('/client');
  });
});
