/**
 * Filtre « À faire » du dashboard (technicienne : masquer les réparations terminées) et ordre des
 * résultats de recherche (du plus récent au plus ancien, actifs et archivés mêlés) ; totaux de la
 * palette au-delà des résultats affichés.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { auth, apiMock } = vi.hoisted(() => ({
  auth: { user: { target: 'tech', utilisateur: 'Marina' } },
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
import DashboardPage, { STATUTS_FAITS } from '../pages/DashboardPage';
import { buildResultGroups } from '../components/SearchPalette';

function ligne(id, statut, extra = {}) {
  return {
    id, statut, ticket_code: `KP-${String(id).padStart(6, '0')}`,
    client_nom: 'Martin', client_prenom: 'Léa', client_tel: '0612345678',
    marque: 'Google', modele: 'Pixel 7', panne: 'Écran cassé', date_depot: `2026-10-${String(10 + id).padStart(2, '0')} 09:00:00`,
    technicien_assigne: 'Marina',
    ...extra,
  };
}

const LIGNES = [
  ligne(1, 'Réparation terminée'),
  ligne(2, 'En cours de réparation'),
  ligne(3, 'En attente de pièce', { technicien_assigne: 'Tarik' }),
  ligne(4, 'Réparation terminée', { technicien_assigne: null }),
];

function renderDashboard(url = '/tech') {
  return render(
    <MemoryRouter initialEntries={[url]}>
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
  auth.user = { target: 'tech', utilisateur: 'Marina' };
  Object.values(apiMock).forEach((fn) => fn.mockReset?.());
  apiMock.getDashboard.mockResolvedValue({ tickets: LIGNES, total: LIGNES.length, kpi: {} });
  apiMock.getActiveTeam.mockResolvedValue([{ id: 1, nom: 'Marina', couleur: '#f00' }, { id: 2, nom: 'Tarik' }]);
  apiMock.getInteractions.mockResolvedValue(null);
  apiMock.getClients.mockResolvedValue([]);
  apiMock.getParts.mockResolvedValue([]);
  apiMock.getCached.mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('palette : totaux au-delà des résultats affichés', () => {
  it('garde le nombre total trouvé par le serveur sur le groupe', () => {
    const res = { groups: { tickets: [{ id: 1 }, { id: 2 }], clients: [{ id: 3 }] }, totaux: { tickets: 45, clients: 1 } };
    const groups = buildResultGroups(res, '/accueil');
    expect(groups[0].total).toBe(45);
    expect(groups[1].total).toBeNull();
    expect(buildResultGroups({ groups: { tickets: [{ id: 1 }] } }, '/accueil')[0].total).toBeNull();
  });
});

describe('DashboardPage : « À faire » pour la technicienne', () => {
  it('« À faire » masque terminées, rendues et clôturées', () => {
    expect([...STATUTS_FAITS]).toEqual(['Réparation terminée', 'Rendu au client', 'Clôturé']);
  });

  it('Marina + À faire : plus que ses réparations non terminées (et les non assignées)', async () => {
    renderDashboard();
    await screen.findByText('KP-000001');
    expect(codesAffiches()).toEqual(['KP-000004', 'KP-000003', 'KP-000002', 'KP-000001']);

    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrer par technicien' }), { target: { value: 'Marina' } });
    await waitFor(() => expect(codesAffiches()).toEqual(['KP-000002', 'KP-000001']));

    const bouton = screen.getByRole('button', { name: /À faire/ });
    expect(bouton).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(bouton);
    await waitFor(() => expect(codesAffiches()).toEqual(['KP-000002']));
    expect(screen.getByRole('button', { name: /À faire seulement/ })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('kp_dash_a_faire')).toBe('1');

    // « Mes tickets » : les non assignés restent, les terminés non
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrer par technicien' }), { target: { value: '__mine__' } });
    await waitFor(() => expect(codesAffiches()).toEqual(['KP-000002']));
  });

  it('le réglage est repris au chargement suivant et proposé quand il ne reste rien', async () => {
    localStorage.setItem('kp_dash_a_faire', '1');
    apiMock.getDashboard.mockResolvedValue({ tickets: [ligne(1, 'Réparation terminée')], total: 1, kpi: {} });
    renderDashboard();
    await screen.findByText('Rien à faire');
    expect(screen.getByRole('button', { name: /À faire seulement/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Voir aussi les terminées' }));
    await screen.findByText('KP-000001');
    expect(localStorage.getItem('kp_dash_a_faire')).toBe('0');
  });

  it('en recherche, « À faire » est sans effet : un ticket terminé reste trouvable', async () => {
    localStorage.setItem('kp_dash_a_faire', '1');
    renderDashboard('/tech?q=google');
    await screen.findByText('KP-000001');
    // ordre du serveur conservé tel quel (pertinence puis date), terminés compris
    expect(codesAffiches()).toEqual(['KP-000001', 'KP-000002', 'KP-000003', 'KP-000004']);
    expect(screen.getByRole('button', { name: /À faire seulement/ })).toBeDisabled();
    expect(screen.getByPlaceholderText(/fautes tolérées/)).toBeInTheDocument();
  });
});

describe('DashboardPage : recherche du plus récent au plus ancien', () => {
  it('ne remonte plus les actifs devant les archivés : ordre du serveur conservé', async () => {
    apiMock.getDashboard.mockResolvedValue({
      tickets: [ligne(9, 'Clôturé'), ligne(8, 'En cours de réparation'), ligne(7, 'Rendu au client'), ligne(6, 'Réparation terminée')],
      total: 4, kpi: {},
    });
    auth.user = { target: 'accueil', utilisateur: 'Sophie' };
    renderDashboard('/accueil?q=google');
    await screen.findByText('KP-000009');
    expect(codesAffiches()).toEqual(['KP-000009', 'KP-000008', 'KP-000007', 'KP-000006']);
    expect(screen.getByRole('status')).toHaveTextContent('4 résultats pour « google » — 2 en cours, 2 rendus ou clôturés');
  });
});
