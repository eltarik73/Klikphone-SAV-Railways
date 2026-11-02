/**
 * Pastilles « messages client » et « avis » du tableau de bord : la liste est demandée au serveur
 * (vue=tous + interaction=…) et montre aussi les tickets rendus ou clôturés — un avis arrive après
 * restitution, un message non lu peut viser un dossier clôturé. Avant, le filtre ne regardait que
 * la liste des actifs : « 1 avis » affichait « Aucun ticket trouvé ».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { auth, apiMock } = vi.hoisted(() => ({
  auth: { user: { target: 'accueil', utilisateur: 'Sophie' } },
  apiMock: {
    getDashboard: vi.fn(),
    getActiveTeam: vi.fn(),
    getInteractions: vi.fn(),
    getClients: vi.fn(),
    getParts: vi.fn(),
    changeStatus: vi.fn(),
    updateTicket: vi.fn(),
    resolveCode: vi.fn(),
    getCached: vi.fn(),
    background: (fn) => fn(),
  },
}));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));

import { ToastProvider } from '../components/Toast';
import { clearCache } from '../hooks/useApi';
import DashboardPage, { INTERACTION_LIBELLES } from '../pages/DashboardPage';

function ligne(id, statut, extra = {}) {
  return {
    id, statut, ticket_code: `KP-${String(id).padStart(6, '0')}`,
    client_nom: 'Keller', client_prenom: 'Urs', client_tel: '0612345678',
    marque: 'Google', modele: 'Pixel 7', panne: 'Écran', date_depot: `2026-10-${String(10 + id).padStart(2, '0')} 09:00:00`,
    ...extra,
  };
}

// 8 : actif avec message · 20 : clôturé avec message · 4551 → 45 : rendu avec avis
const ACTIFS = [ligne(8, 'En cours de réparation'), ligne(9, 'En attente de pièce')];
const AVEC_MESSAGE = [ligne(8, 'En cours de réparation'), ligne(20, 'Clôturé')];
const AVEC_AVIS = [ligne(45, 'Rendu au client')];
const INTERACTIONS = {
  accord_client: { count: 0, ticket_ids: [] }, accord_client_valide: { count: 0, ticket_ids: [] },
  messages: { count: 2, ticket_ids: [8, 20] }, avis: { count: 1, ticket_ids: [45] }, total_actions: 3,
};

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/accueil']}>
      <ToastProvider>
        <DashboardPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

const codesAffiches = () => screen.queryAllByRole('link').map((a) => a.textContent).filter((t) => /^KP-\d{6}$/.test(t));

beforeEach(() => {
  clearCache();
  sessionStorage.clear();
  localStorage.clear();
  Object.values(apiMock).forEach((fn) => fn.mockReset?.());
  apiMock.getDashboard.mockImplementation(async (p = {}) => {
    const tickets = p.interaction === 'avis' ? AVEC_AVIS : p.interaction === 'messages' ? AVEC_MESSAGE : ACTIFS;
    return { tickets, total: tickets.length, kpi: {} };
  });
  apiMock.getActiveTeam.mockResolvedValue([{ id: 1, nom: 'Marina' }]);
  apiMock.getInteractions.mockResolvedValue(INTERACTIONS);
  apiMock.getClients.mockResolvedValue([]);
  apiMock.getParts.mockResolvedValue([]);
  apiMock.getCached.mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('pastilles messages / avis du tableau de bord', () => {
  it('« 1 avis » montre le ticket rendu qui porte l’avis', async () => {
    renderDashboard();
    await screen.findByText('KP-000008');
    expect(codesAffiches()).toEqual(['KP-000009', 'KP-000008']);

    fireEvent.click(screen.getByRole('button', { name: /1\s*avis/ }));
    await screen.findByText('KP-000045');
    expect(codesAffiches()).toEqual(['KP-000045']);
    expect(apiMock.getDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ vue: 'tous', interaction: 'avis', limit: 200 }));
    expect(screen.getByRole('status')).toHaveTextContent(`1 ticket avec ${INTERACTION_LIBELLES.avis} — 0 en cours, 1 rendu ou clôturé`);
    expect(screen.getByRole('button', { name: /À faire/ })).toBeDisabled();
    expect(screen.queryByText('Aucun ticket trouvé')).not.toBeInTheDocument();
  });

  it('« 2 messages client » montre aussi le dossier clôturé, puis « Réinitialiser » rend la liste des actifs', async () => {
    renderDashboard();
    await screen.findByText('KP-000008');

    fireEvent.click(screen.getByRole('button', { name: /2\s*messages client/ }));
    await screen.findByText('KP-000020');
    expect(codesAffiches()).toEqual(['KP-000020', 'KP-000008']);
    expect(screen.getByText(/Rendus ou clôturés — 1 résultat/)).toBeInTheDocument();
    expect(apiMock.getDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ vue: 'tous', interaction: 'messages' }));
    expect(apiMock.getDashboard.mock.calls.at(-1)[0]).not.toHaveProperty('statut');

    // Retour à la liste des actifs (réponse déjà en cache : pas de nouvel appel)
    fireEvent.click(screen.getByRole('button', { name: 'Réinitialiser' }));
    await waitFor(() => expect(codesAffiches()).toEqual(['KP-000009', 'KP-000008']));
  });

  it('un ticket que l’on vient de lire disparaît dès que les pastilles sont relues', async () => {
    // Pastille relue après l’ouverture du ticket 20 : il ne reste que le 8, même si la liste
    // du serveur (cache) le contient encore
    apiMock.getInteractions.mockResolvedValue({ ...INTERACTIONS, messages: { count: 1, ticket_ids: [8] }, total_actions: 2 });
    renderDashboard();
    await screen.findByText('KP-000008');
    fireEvent.click(screen.getByRole('button', { name: /1\s*message client/ }));
    await waitFor(() => expect(apiMock.getDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ interaction: 'messages' })));
    await waitFor(() => expect(codesAffiches()).toEqual(['KP-000008']));
    expect(screen.queryByText('KP-000020')).not.toBeInTheDocument();
  });
});
