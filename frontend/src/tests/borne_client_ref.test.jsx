/**
 * Audit public, correctifs A et D côté borne :
 * - borne SANS session (/client, /depot) : POST /api/clients part sans le jeton du poste et ne rend
 *   qu'une référence client signée (client_ref) ; POST /api/tickets est envoyé sans session avec
 *   cette référence — jamais un client_id nu ; POST /api/parts/auto porte la preuve de suivi du
 *   ticket tout juste créé (t = suivi_token rendu avec le ticket, sinon le numéro donné à l'instant) ;
 * - AVEC session (/client?staff=1, « Nouveau ticket » du personnel) : flux inchangé — fiche complète
 *   ({ id }), client_id, aucune preuve de suivi, session du poste sur chaque appel ;
 * - transport (client HTTP réel) : asStaff false → ni Authorization ni élévation ; la preuve de la
 *   pièce part dans le corps ET en en-tête (X-Suivi-Token / X-Suivi-Tel).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getPublicConfig: vi.fn(), getConfidentialite: vi.fn(), getCategories: vi.fn(), getPannes: vi.fn(),
    createOrGetClient: vi.fn(), createTicket: vi.fn(), createPartAuto: vi.fn(), learnTerm: vi.fn(),
    updateTicket: vi.fn(), changeStatus: vi.fn(), getClient: vi.fn(),
  },
}));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal(); // en-têtes exportés réels, client HTTP simulé pour les pages
  return { ...actual, default: apiMock, api: apiMock };
});
vi.mock('../hooks/useCatalog', () => ({
  useCatalog: () => ({ marques: [], modelesDe: () => [], loading: false }),
}));

import { ToastProvider } from '../components/Toast';
import { SettingsProvider } from '../hooks/useSettings';
import { clearCache } from '../hooks/useApi';
import { _oublierConfigPublique } from '../pages/ConfidentialitePage';
import { SUIVI_TEL_HEADER, SUIVI_TOKEN_HEADER } from '../lib/api';
import ClientFormPage from '../pages/ClientFormPage';
import DepotPage from '../pages/DepotPage';

const REF = 'RefClientSignee.eyJjaWQiOjd9';
const JETON = 'JetonSuivi70';
const TEL = '06 12 34 56 79';

beforeEach(() => {
  clearCache();
  _oublierConfigPublique();
  sessionStorage.clear();
  localStorage.clear();
  Object.values(apiMock).forEach((fn) => fn.mockReset?.());
  apiMock.getPublicConfig.mockResolvedValue({ BOUTIQUE_NOM: 'Klikphone Chambéry', PURGE_CODES_JOURS: '15' });
  apiMock.getConfidentialite.mockResolvedValue({ titre: 'Politique de confidentialité', sections: [] });
  apiMock.getCategories.mockResolvedValue(['Smartphone', 'Commande']);
  apiMock.getPannes.mockResolvedValue(['Écran cassé', 'Batterie']);
  // Sans session, le serveur ne rend que la référence signée ; avec session, la fiche complète
  apiMock.createOrGetClient.mockImplementation((_data, opts) => Promise.resolve(
    opts?.asStaff ? { id: 7, nom: 'Martin', telephone: '0612345679' } : { client_ref: REF },
  ));
  apiMock.createTicket.mockResolvedValue({ id: 70, ticket_code: 'KP-000070', suivi_token: JETON });
  apiMock.createPartAuto.mockResolvedValue({ id: 9 });
  apiMock.updateTicket.mockResolvedValue({ ok: true });
  apiMock.changeStatus.mockResolvedValue({ ok: true });
  apiMock.learnTerm.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Ou() {
  const loc = useLocation();
  return <p data-testid="ou">{loc.pathname}{loc.search}</p>;
}

const wrap = (entree) => (
  <MemoryRouter initialEntries={[entree]}>
    <SettingsProvider>
      <ToastProvider>
        <Routes>
          <Route path="/client" element={<ClientFormPage />} />
          <Route path="/depot" element={<DepotPage />} />
          <Route path="*" element={<Ou />} />
        </Routes>
      </ToastProvider>
    </SettingsProvider>
  </MemoryRouter>
);

const suivant = () => fireEvent.click(screen.getByRole('button', { name: /Suivant/ }));

// Borne /client : coordonnées, puis « Commande » (ticket + pièce commandée), jusqu'à l'envoi
async function commandeDepuisLaBorne(entree) {
  render(wrap(entree));
  fireEvent.change(screen.getByLabelText('Nom *'), { target: { value: 'Martin' } });
  fireEvent.change(screen.getByLabelText('Votre numéro de téléphone (obligatoire)'), { target: { value: TEL } });
  suivant();
  fireEvent.click(await screen.findByRole('button', { name: 'Commande' }));
  suivant();
  fireEvent.change(await screen.findByLabelText('Pièce à commander *'), { target: { value: 'Écran OLED' } });
  suivant();
  fireEvent.click(await screen.findByRole('button', { name: 'Valider la commande' }));
}

describe('Borne /client sans session : référence client signée et preuve de suivi (A, D)', () => {
  it('fiche → client_ref ; ticket créé sans session avec client_ref (pas de client_id) ; pièce avec t = suivi_token', async () => {
    await commandeDepuisLaBorne('/client');
    expect(await screen.findByText('KP-000070')).toBeInTheDocument();

    expect(apiMock.createOrGetClient).toHaveBeenCalledTimes(1);
    expect(apiMock.createOrGetClient).toHaveBeenCalledWith(
      expect.objectContaining({ nom: 'Martin', telephone: TEL, rgpd_informe: true }), { asStaff: false },
    );

    expect(apiMock.createTicket).toHaveBeenCalledTimes(1);
    const [ticket, optionsTicket] = apiMock.createTicket.mock.calls[0];
    expect(ticket.client_ref).toBe(REF);
    expect(ticket).not.toHaveProperty('client_id');
    expect(ticket).toMatchObject({ categorie: 'Commande', panne: 'Pièce à commander', panne_detail: 'Écran OLED', commande_piece: 1 });
    expect(optionsTicket).toEqual({ asStaff: false });

    expect(apiMock.createPartAuto).toHaveBeenCalledTimes(1);
    const [piece, optionsPiece] = apiMock.createPartAuto.mock.calls[0];
    expect(piece).toMatchObject({ ticket_id: 70, description: 'Écran OLED', t: JETON });
    expect(piece).not.toHaveProperty('tel');
    expect(optionsPiece).toEqual({ asStaff: false });

    // Écran final : code en grand et « Suivre ma commande » ouvre le suivi avec le jeton (sans redemander le numéro)
    fireEvent.click(screen.getByRole('button', { name: /Suivre ma commande/ }));
    expect(await screen.findByTestId('ou')).toHaveTextContent(`/suivi?t=${JETON}&ticket=KP-000070`);
  });

  it('ticket rendu sans suivi_token : la pièce porte le numéro donné à l’instant (tel), jamais rien', async () => {
    apiMock.createTicket.mockResolvedValue({ id: 70, ticket_code: 'KP-000070', suivi_token: null });
    await commandeDepuisLaBorne('/client');
    expect(await screen.findByText('KP-000070')).toBeInTheDocument();
    const [piece, options] = apiMock.createPartAuto.mock.calls[0];
    expect(piece).toMatchObject({ ticket_id: 70, tel: TEL });
    expect(piece).not.toHaveProperty('t');
    expect(options).toEqual({ asStaff: false });
    // Sans jeton, « Suivre » ouvre le formulaire du suivi avec le code seul
    fireEvent.click(screen.getByRole('button', { name: /Suivre ma commande/ }));
    expect(await screen.findByTestId('ou')).toHaveTextContent('/suivi?ticket=KP-000070');
  });

  it('un jeton de session présent sur le poste ne change rien à la borne publique (/client sans staff=1)', async () => {
    localStorage.setItem('kp_token', 'jeton-du-poste');
    localStorage.setItem('kp_target', 'accueil');
    await commandeDepuisLaBorne('/client');
    expect(await screen.findByText('KP-000070')).toBeInTheDocument();
    expect(apiMock.createOrGetClient.mock.calls[0][1]).toEqual({ asStaff: false });
    expect(apiMock.createTicket.mock.calls[0][0].client_ref).toBe(REF);
    expect(apiMock.createTicket.mock.calls[0][1]).toEqual({ asStaff: false });
    expect(apiMock.createPartAuto.mock.calls[0][1]).toEqual({ asStaff: false });
  });
});

describe('« Nouveau ticket » du personnel (/client?staff=1 + session) : flux inchangé', () => {
  it('fiche complète ({ id }) avec la session, ticket avec client_id, pièce sans preuve de suivi', async () => {
    localStorage.setItem('kp_token', 'jeton-staff');
    localStorage.setItem('kp_target', 'accueil');
    await commandeDepuisLaBorne('/client?staff=1');
    expect(await screen.findByTestId('ou')).toHaveTextContent('/accueil');

    expect(apiMock.createOrGetClient).toHaveBeenCalledWith(expect.objectContaining({ nom: 'Martin' }), { asStaff: true });

    const [ticket, optionsTicket] = apiMock.createTicket.mock.calls[0];
    expect(ticket.client_id).toBe(7);
    expect(ticket).not.toHaveProperty('client_ref');
    expect(optionsTicket).toEqual({ asStaff: true });

    const [piece, optionsPiece] = apiMock.createPartAuto.mock.calls[0];
    expect(piece).toMatchObject({ ticket_id: 70, description: 'Écran OLED' });
    expect(piece).not.toHaveProperty('t');
    expect(piece).not.toHaveProperty('tel');
    expect(optionsPiece).toEqual({ asStaff: true });
  });
});

describe('Dépôt comptoir /depot : même voie anonyme', () => {
  it('client_ref dans le ticket, créé sans la session du poste', async () => {
    localStorage.setItem('kp_token', 'jeton-du-poste');
    render(wrap('/depot'));
    fireEvent.change(screen.getByLabelText('Nom *'), { target: { value: 'Durand' } });
    fireEvent.change(screen.getByLabelText('Votre numéro de téléphone (obligatoire)'), { target: { value: '0612345679' } });
    suivant();
    fireEvent.click(await screen.findByRole('button', { name: 'Smartphone' }));
    fireEvent.change(screen.getByLabelText('Marque *'), { target: { value: 'Autre' } });
    fireEvent.change(screen.getByLabelText(/Préciser marque/), { target: { value: 'Fairphone 5' } });
    suivant();
    fireEvent.click(await screen.findByRole('button', { name: 'Écran cassé' }));
    fireEvent.click(screen.getByRole('radio', { name: /Pas de code/ }));
    suivant();
    fireEvent.click(await screen.findByRole('button', { name: "Déposer l'appareil" }));
    expect(await screen.findByRole('heading', { name: 'Demande enregistrée !' })).toBeInTheDocument();

    // createOrGetClient sans option : la voie anonyme par défaut (jamais la session du poste)
    expect(apiMock.createOrGetClient).toHaveBeenCalledTimes(1);
    expect(apiMock.createOrGetClient.mock.calls[0][1]).toBeUndefined();
    const [ticket, options] = apiMock.createTicket.mock.calls[0];
    expect(ticket.client_ref).toBe(REF);
    expect(ticket).not.toHaveProperty('client_id');
    expect(options).toEqual({ asStaff: false });
  });
});

describe('api : transport des appels de la borne (client HTTP réel, fetch simulé)', () => {
  let client;
  const fetchInitial = global.fetch;
  const reponse = (data) => ({
    ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: () => Promise.resolve(data),
  });
  beforeEach(async () => {
    client = (await vi.importActual('../lib/api')).default;
    client.setToken('session-du-comptoir');
    global.fetch = vi.fn().mockResolvedValue(reponse({ id: 1 }));
  });
  afterEach(() => {
    client.setToken(null);
    global.fetch = fetchInitial;
  });

  it('createTicket asStaff:false : client_ref dans le corps, ni Authorization ni option auth transmise à fetch', async () => {
    await client.createTicket({ client_ref: REF, categorie: 'Smartphone' }, { asStaff: false });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/tickets');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ client_ref: REF, categorie: 'Smartphone' });
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.auth).toBeUndefined();
  });

  it('createTicket par défaut (personnel) : la session part', async () => {
    await client.createTicket({ client_id: 7, categorie: 'Smartphone' });
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer session-du-comptoir');
  });

  it('createPartAuto asStaff:false : preuve t dans le corps et en en-tête X-Suivi-Token, sans session', async () => {
    await client.createPartAuto({ ticket_id: 70, description: 'Écran', t: JETON }, { asStaff: false });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/parts/auto');
    expect(JSON.parse(init.body)).toEqual({ ticket_id: 70, description: 'Écran', t: JETON });
    expect(init.headers[SUIVI_TOKEN_HEADER]).toBe(JETON);
    expect(init.headers[SUIVI_TEL_HEADER]).toBeUndefined();
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('createPartAuto asStaff:false avec le numéro : en-tête X-Suivi-Tel, le numéro jamais dans l’URL', async () => {
    await client.createPartAuto({ ticket_id: 70, description: 'Écran', tel: TEL }, { asStaff: false });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/parts/auto');
    expect(init.headers[SUIVI_TEL_HEADER]).toBe(TEL);
    expect(init.headers[SUIVI_TOKEN_HEADER]).toBeUndefined();
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('createPartAuto par défaut (personnel) : session, aucun en-tête de preuve', async () => {
    await client.createPartAuto({ ticket_id: 70, description: 'Écran' });
    const init = global.fetch.mock.calls[0][1];
    expect(init.headers.Authorization).toBe('Bearer session-du-comptoir');
    expect(init.headers[SUIVI_TOKEN_HEADER]).toBeUndefined();
    expect(init.headers[SUIVI_TEL_HEADER]).toBeUndefined();
  });
});
