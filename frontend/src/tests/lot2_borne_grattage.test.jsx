/**
 * Borne /client et carte à gratter du suivi :
 * - « Achat » réservé au personnel (sur la borne publique, aucun ticket orphelin) ;
 * - « Nouveau ticket » du personnel : retour au tableau de bord en haut de page ;
 * - carte à gratter : preuve du suivi (jeton du lien ou 4 derniers chiffres) et
 *   « Révéler sans gratter » au clavier, résultat annoncé (role=status).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getPublicConfig: vi.fn(), getConfidentialite: vi.fn(), getCategories: vi.fn(), getPannes: vi.fn(),
    createOrGetClient: vi.fn(), createTicket: vi.fn(), createPartAuto: vi.fn(), learnTerm: vi.fn(),
    updateTicket: vi.fn(), changeStatus: vi.fn(), getClient: vi.fn(),
    get: vi.fn(), post: vi.fn(),
  },
}));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));
vi.mock('../hooks/useCatalog', () => ({
  useCatalog: () => ({ marques: [], modelesDe: () => [], loading: false }),
}));

import { ToastProvider } from '../components/Toast';
import { SettingsProvider } from '../hooks/useSettings';
import { clearCache } from '../hooks/useApi';
import { _oublierConfigPublique } from '../pages/ConfidentialitePage';
import ClientFormPage from '../pages/ClientFormPage';
import ScratchCard from '../components/ScratchCard';

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
  apiMock.createOrGetClient.mockResolvedValue({ id: 7 });
  apiMock.createTicket.mockResolvedValue({ id: 70, ticket_code: 'KP-000070' });
  apiMock.updateTicket.mockResolvedValue({ ok: true });
  apiMock.changeStatus.mockResolvedValue({ ok: true });
  apiMock.learnTerm.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.location.search = '';
});

function Ou() {
  const loc = useLocation();
  return <p data-testid="ou">{loc.pathname}</p>;
}

const wrap = (entree) => (
  <MemoryRouter initialEntries={[entree]}>
    <SettingsProvider>
      <ToastProvider>
        <Routes>
          <Route path="/client" element={<ClientFormPage />} />
          <Route path="/accueil" element={<Ou />} />
        </Routes>
      </ToastProvider>
    </SettingsProvider>
  </MemoryRouter>
);

const suivant = () => fireEvent.click(screen.getByRole('button', { name: /Suivant/ }));

async function etapeAppareil(entree) {
  render(wrap(entree));
  fireEvent.change(screen.getByLabelText('Nom *'), { target: { value: 'Martin' } });
  fireEvent.change(screen.getByLabelText('Votre numéro de téléphone (obligatoire)'), { target: { value: '06 12 34 56 78' } });
  suivant();
  await screen.findByRole('button', { name: 'Smartphone' });
}

describe('Borne /client : « Achat » réservé au personnel', () => {
  it('borne publique : pas de tuile Achat ; personnel : tuile proposée', async () => {
    await etapeAppareil('/client');
    expect(screen.queryByRole('button', { name: 'Achat' })).not.toBeInTheDocument();
    cleanup();

    localStorage.setItem('kp_token', 'jeton-staff');
    localStorage.setItem('kp_target', 'accueil');
    await etapeAppareil('/client?staff=1');
    expect(screen.getByRole('button', { name: 'Achat' })).toBeInTheDocument();
  });

  it('borne publique : un « Achat » (catégorie venue d’ailleurs) ne crée jamais de ticket', async () => {
    apiMock.getCategories.mockResolvedValue(['Smartphone', 'Achat']);
    await etapeAppareil('/client');
    fireEvent.click(await screen.findByRole('button', { name: 'Achat' }));
    suivant();
    fireEvent.click(await screen.findByRole('button', { name: 'Téléphone' }));
    fireEvent.change(screen.getByLabelText("Description de l'achat *"), { target: { value: 'Coque' } });
    suivant();
    fireEvent.click(await screen.findByRole('button', { name: "Enregistrer l'achat" }));
    expect(await screen.findByText('Les achats sont enregistrés par le personnel en boutique.')).toBeInTheDocument();
    expect(apiMock.createOrGetClient).not.toHaveBeenCalled();
    expect(apiMock.createTicket).not.toHaveBeenCalled();
    expect(apiMock.changeStatus).not.toHaveBeenCalled();
  });
});

describe('« Nouveau ticket » du personnel : tableau de bord rouvert en haut', () => {
  it('window.scrollTo(0, 0) avant le retour au tableau de bord', async () => {
    localStorage.setItem('kp_token', 'jeton-staff');
    localStorage.setItem('kp_target', 'accueil');
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    await etapeAppareil('/client?staff=1');
    fireEvent.click(screen.getByRole('button', { name: 'Commande' }));
    suivant();
    fireEvent.change(await screen.findByLabelText('Pièce à commander *'), { target: { value: 'Écran OLED' } });
    suivant();
    fireEvent.click(await screen.findByRole('button', { name: 'Valider la commande' }));
    expect(await screen.findByTestId('ou')).toHaveTextContent('/accueil');
    expect(scroll).toHaveBeenCalledWith(0, 0);
  });
});

describe('ScratchCard : preuve du suivi et accès clavier', () => {
  it('sans jeton : 4 derniers chiffres demandés, puis « Révéler sans gratter » et résultat annoncé', async () => {
    apiMock.get.mockResolvedValue({ actif: true, eligible: true, preuve_requise: true, frequence: 10 });
    apiMock.post.mockImplementation((path) => Promise.resolve(path.endsWith('/etat')
      ? { actif: true, eligible: true, deja_gratte: false, frequence: 10 }
      : { gagnant: false, gain: null, gain_label: null }));
    render(<ScratchCard ticketCode="KP-000021" />);
    const champ = await screen.findByLabelText('4 derniers chiffres de votre téléphone');
    expect(apiMock.get).toHaveBeenCalledWith('/api/fidelite/grattage/KP-000021');
    fireEvent.change(champ, { target: { value: '4567' } });
    fireEvent.click(screen.getByRole('button', { name: /Valider/ }));
    const bouton = await screen.findByRole('button', { name: /Révéler sans gratter/ });
    expect(apiMock.post).toHaveBeenCalledWith('/api/fidelite/grattage/KP-000021/etat', { tel4: '4567' });
    expect(bouton).toHaveClass('min-h-11');
    bouton.focus();
    expect(document.activeElement).toBe(bouton);
    fireEvent.click(bouton);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Pas cette fois'));
    expect(apiMock.post).toHaveBeenLastCalledWith('/api/fidelite/grattage/KP-000021', { tel4: '4567' });
    expect(screen.queryByRole('button', { name: /Révéler sans gratter/ })).not.toBeInTheDocument();
  });

  it('jeton du lien : état lu avec ?t=, grattage avec { t }', async () => {
    window.location.search = '?ticket=KP-000021&t=JetonDuLien_0123456789'; // setup.js : location simulée
    apiMock.get.mockResolvedValue({ actif: true, eligible: true, deja_gratte: false, frequence: 10 });
    apiMock.post.mockResolvedValue({ gagnant: true, gain: 'film', gain_label: 'Film verre trempé OFFERT' });
    render(<ScratchCard ticketCode="KP-000021" />);
    fireEvent.click(await screen.findByRole('button', { name: /Révéler sans gratter/ }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('GAGNÉ'));
    expect(apiMock.get).toHaveBeenCalledWith('/api/fidelite/grattage/KP-000021?t=JetonDuLien_0123456789');
    expect(apiMock.post).toHaveBeenCalledWith('/api/fidelite/grattage/KP-000021', { t: 'JetonDuLien_0123456789' });
  });

  it('ticket pas encore rendu ni payé : pas de carte', async () => {
    apiMock.get.mockResolvedValue({ actif: true, eligible: false, preuve_requise: true, frequence: 10 });
    const { container } = render(<ScratchCard ticketCode="KP-000022" />);
    await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
