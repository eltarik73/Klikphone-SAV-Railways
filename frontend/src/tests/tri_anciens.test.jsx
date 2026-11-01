/**
 * Tri des réparations oubliées (+60 jours, admin), filtre « À faire » du dashboard et ordre des
 * résultats de recherche (du plus récent au plus ancien, actifs et archivés mêlés).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { auth, apiMock } = vi.hoisted(() => ({
  auth: { user: { target: 'tech', utilisateur: 'Marina' } },
  apiMock: {
    getDashboard: vi.fn(),
    getActiveTeam: vi.fn(),
    getInteractions: vi.fn(),
    getClients: vi.fn(),
    getParts: vi.fn(),
    getAnciens: vi.fn(),
    cloturerAnciens: vi.fn(),
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
import TriAnciens, { selectionParDefaut, resumeCloture, JOURS_CHOIX } from '../components/TriAnciens';
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
  apiMock.getDashboard.mockResolvedValue({ tickets: LIGNES, total: LIGNES.length, kpi: { anciens: 0 } });
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

// ─── Fonctions pures ─────────────────────────────────────────────────────────

describe('tri des réparations oubliées : helpers', () => {
  it('coche tout sauf les dossiers bloqués par un téléphone de prêt dehors', () => {
    const s = selectionParDefaut([{ id: 1 }, { id: 2, pret_dehors: true }, { id: 3, pret_dehors: false }]);
    expect([...s]).toEqual([1, 3]);
    expect(selectionParDefaut(null).size).toBe(0);
  });

  it('compte rendu lisible', () => {
    expect(resumeCloture({ clotures: 12, ignores: 0, par_statut: [{ statut: 'Réparation terminée', n: 7 }, { statut: 'En attente de pièce', n: 5 }] }))
      .toBe('12 dossiers clôturés (Réparation terminée : 7, En attente de pièce : 5)');
    expect(resumeCloture({ clotures: 1, ignores: 2, par_statut: [{ statut: 'En cours de réparation', n: 1 }] }))
      .toBe('1 dossier clôturé (En cours de réparation : 1) · 2 laissés tels quels');
    expect(resumeCloture({ clotures: 0, ignores: 0, par_statut: [] })).toBe('Aucun dossier clôturé');
  });

  it('60 jours est le premier choix ; « À faire » masque terminées, rendues et clôturées', () => {
    expect(JOURS_CHOIX[0]).toBe(60);
    expect([...STATUTS_FAITS]).toEqual(['Réparation terminée', 'Rendu au client', 'Clôturé']);
  });
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

// ─── Dashboard : filtre « À faire » ──────────────────────────────────────────

describe('DashboardPage : « À faire » pour la technicienne', () => {
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

// ─── Dashboard : pastille et panneau admin ───────────────────────────────────

describe('DashboardPage : dossiers de plus de 60 jours (admin)', () => {
  const APERCU = {
    jours: 60, seuil: '2026-09-02 09:00:00', total: 3, bloques: 1, tronque: false,
    par_statut: [{ statut: 'En cours de réparation', n: 2, bloques: 1 }, { statut: 'Réparation terminée', n: 1, bloques: 0 }],
    tickets: [
      { id: 11, ticket_code: 'KP-000011', statut: 'Réparation terminée', date_depot: '2026-03-01T10:00:00', client_nom: 'Durand', client_prenom: 'Paul', marque: 'Apple', modele: 'iPhone 11', pret_dehors: false },
      { id: 12, ticket_code: 'KP-000012', statut: 'En cours de réparation', date_depot: '2026-07-01T10:00:00', client_nom: 'Roux', marque: 'Samsung', modele: 'Galaxy S21', pret_dehors: true, technicien_assigne: 'Marina' },
      { id: 13, ticket_code: 'KP-000013', statut: 'En cours de réparation', date_depot: '2026-08-15T10:00:00', client_nom: 'Petit', marque: 'Autre', modele: 'Autre', modele_autre: 'Fairphone 4', pret_dehors: false, emplacement: 'B3' },
    ],
  };

  it('la pastille n’apparaît que pour le rôle admin', async () => {
    apiMock.getDashboard.mockResolvedValue({ tickets: LIGNES, total: 4, kpi: { anciens: 3 } });
    renderDashboard();
    await screen.findByText('KP-000001');
    expect(screen.queryByRole('button', { name: /à trier/ })).toBeNull();
    cleanup();

    auth.user = { target: 'accueil', utilisateur: 'Tarik', role: 'admin' };
    renderDashboard('/accueil');
    await screen.findByText('KP-000001');
    expect(screen.getByRole('button', { name: '3 dossiers de + de 60 j à trier' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('ouvre l’aperçu, coche tout sauf les prêts dehors, confirme puis clôture', async () => {
    auth.user = { target: 'accueil', utilisateur: 'Tarik', role: 'admin' };
    apiMock.getDashboard.mockResolvedValue({ tickets: LIGNES, total: 4, kpi: { anciens: 3 } });
    apiMock.getAnciens.mockResolvedValue(APERCU);
    apiMock.cloturerAnciens.mockResolvedValue({ jours: 60, clotures: 2, ignores: 0, par_statut: [{ statut: 'Réparation terminée', n: 1 }, { statut: 'En cours de réparation', n: 1 }] });
    renderDashboard('/accueil');
    await screen.findByText('KP-000001');
    fireEvent.click(screen.getByRole('button', { name: '3 dossiers de + de 60 j à trier' }));

    const panneau = within(await screen.findByRole('region', { name: 'Réparations oubliées' }));
    await panneau.findByText('KP-000011');
    expect(apiMock.getAnciens).toHaveBeenCalledWith(60);
    expect(panneau.getByText('2 sur 2 cochés')).toBeInTheDocument();
    expect(panneau.getByRole('button', { name: 'Décocher KP-000011' })).toHaveAttribute('aria-pressed', 'true');
    expect(panneau.getByRole('button', { name: 'Cocher KP-000012' })).toBeDisabled();
    expect(panneau.getByText(/téléphone de prêt chez le client/)).toBeInTheDocument();
    expect(panneau.getByText(/1 avec un téléphone de prêt dehors/)).toBeInTheDocument();
    expect(panneau.getByText(/Petit · Fairphone 4/)).toBeInTheDocument();

    fireEvent.click(panneau.getByRole('button', { name: 'Clôturer 2 dossiers' }));
    expect(apiMock.cloturerAnciens).not.toHaveBeenCalled();
    fireEvent.click(panneau.getByRole('button', { name: 'Oui, clôturer' }));
    await waitFor(() => expect(apiMock.cloturerAnciens).toHaveBeenCalledWith(60, [11, 13]));
    await panneau.findByText('2 dossiers clôturés (Réparation terminée : 1, En cours de réparation : 1)');
    // l'aperçu est relu après la clôture
    expect(apiMock.getAnciens).toHaveBeenCalledTimes(2);
  });

  it('change le seuil (90 j) et relit l’aperçu', async () => {
    apiMock.getAnciens.mockResolvedValue({ ...APERCU, tickets: [], total: 0, bloques: 0, par_statut: [] });
    render(
      <MemoryRouter>
        <ToastProvider>
          <TriAnciens id="tri" basePath="/accueil" onOpenTicket={() => {}} onClose={() => {}} />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findByText(/Aucun dossier ouvert de plus de 60 jours/);
    fireEvent.click(screen.getByRole('button', { name: '+ 90 j' }));
    await waitFor(() => expect(apiMock.getAnciens).toHaveBeenLastCalledWith(90));
    await screen.findByText(/Aucun dossier ouvert de plus de 90 jours/);
  });
});
