/**
 * Lot 6 — tableau de bord : tri « Récupération » (plus urgent d'abord, délais vides en dernier dans
 * les deux sens), prix d'un retour SAV (garantie, pas « Pas de prix »), cibles de 44 px au doigt.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { auth, apiMock } = vi.hoisted(() => ({
  auth: { user: { target: 'accueil', utilisateur: 'Sophie' } },
  apiMock: {
    getDashboard: vi.fn(),
    getActiveTeam: vi.fn(),
    getInteractions: vi.fn(),
    getClients: vi.fn(),
    changeStatus: vi.fn(),
    getNotes: vi.fn(),
    getCached: vi.fn(),
    background: (fn) => fn(),
  },
}));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));

import { ToastProvider } from '../components/Toast';
import { clearCache } from '../hooks/useApi';
import { takePendingScan } from '../components/ScanListener';
import DashboardPage from '../pages/DashboardPage';
import { formatPrix } from '../lib/utils';

function ligne(id, extra = {}) {
  return {
    id, statut: 'En cours de réparation', ticket_code: `KP-${String(id).padStart(6, '0')}`,
    client_nom: 'Martin', client_prenom: 'Léa', client_tel: '0612345678', categorie: 'Smartphone',
    marque: 'Apple', modele: 'iPhone 13', panne: 'Écran cassé', date_depot: `2026-10-1${id % 10} 09:00:00`,
    ...extra,
  };
}

// Instants locaux AAAA-MM-JJ HH:MM relatifs à maintenant (date_recuperation : texte, heure locale)
const pad = (n) => String(n).padStart(2, '0');
function dans(heures) {
  const d = new Date(Date.now() + heures * 3600_000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/accueil']}>
      <ToastProvider>
        <DashboardPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

const ordre = () => screen.getAllByRole('link', { name: /^Ouvrir le ticket / })
  .map((a) => a.textContent.trim());

beforeEach(() => {
  clearCache();
  takePendingScan();
  sessionStorage.clear();
  try { localStorage.clear(); } catch { /* stockage indisponible */ }
  auth.user = { target: 'accueil', utilisateur: 'Sophie' };
  Object.values(apiMock).forEach((fn) => fn.mockReset?.());
  apiMock.getActiveTeam.mockResolvedValue([]);
  apiMock.getInteractions.mockResolvedValue({});
  apiMock.getClients.mockResolvedValue([]);
  apiMock.getNotes.mockResolvedValue([]);
  apiMock.getCached.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DashboardPage : tri « Récupération »', () => {
  it('premier clic : le plus en retard d’abord, « Délai à fixer » en dernier ; second clic : inverse, vides toujours en dernier', async () => {
    const tickets = [
      ligne(1, { date_recuperation: '' }),
      ligne(2, { date_recuperation: dans(48) }),
      ligne(3, { date_recuperation: dans(-1) }),
      ligne(4, { date_recuperation: 'quand il veut' }),
      ligne(5, { date_recuperation: dans(3) }),
    ];
    apiMock.getDashboard.mockResolvedValue({ tickets, total: tickets.length, kpi: {} });
    renderDashboard();
    await screen.findByRole('link', { name: /^Ouvrir le ticket KP-000001/ });

    const bouton = screen.getByRole('button', { name: /^Récupération/ });
    fireEvent.click(bouton);
    expect(bouton).toHaveAttribute('aria-pressed', 'true');
    expect(bouton).toHaveTextContent('↑');
    const premier = ordre();
    expect(premier.slice(0, 3)).toEqual(['KP-000003', 'KP-000005', 'KP-000002']);
    expect(premier.slice(3).sort()).toEqual(['KP-000001', 'KP-000004']);

    fireEvent.click(bouton);
    expect(bouton).toHaveTextContent('↓');
    const second = ordre();
    expect(second.slice(0, 3)).toEqual(['KP-000002', 'KP-000005', 'KP-000003']);
    expect(second.slice(3).sort()).toEqual(['KP-000001', 'KP-000004']);
  });
});

describe('DashboardPage : colonne prix', () => {
  it('retour SAV sans prix : « Garantie » à 0 €, pas « Pas de prix » ; ticket ordinaire sans prix inchangé', async () => {
    const tickets = [
      ligne(1, { est_retour_sav: true, devis_estime: 0, tarif_final: 0 }),
      ligne(2, { devis_estime: 0, tarif_final: 0 }),
    ];
    apiMock.getDashboard.mockResolvedValue({ tickets, total: tickets.length, kpi: {} });
    renderDashboard();
    const lien = await screen.findByRole('link', { name: /^Ouvrir le ticket KP-000001/ });
    const rangee = (a) => a.closest('.group');
    const sav = within(rangee(lien));
    expect(sav.getAllByText('Garantie').length).toBeGreaterThanOrEqual(1);
    expect(sav.getAllByText(formatPrix(0)).length).toBeGreaterThanOrEqual(1);
    expect(sav.queryByText('Pas de prix')).toBeNull();
    const autre = within(rangee(screen.getByRole('link', { name: /^Ouvrir le ticket KP-000002/ })));
    expect(autre.getAllByText('Pas de prix').length).toBeGreaterThanOrEqual(1);
    expect(autre.queryByText('Garantie')).toBeNull();
  });
});

describe('DashboardPage : cibles tactiles', () => {
  it('sélecteurs (global et par ligne) de 44 px, lien du code ticket de 44 px de haut', async () => {
    const tickets = [ligne(1), ligne(2)];
    apiMock.getDashboard.mockResolvedValue({ tickets, total: tickets.length, kpi: {} });
    renderDashboard();
    const lien = await screen.findByRole('link', { name: /^Ouvrir le ticket KP-000001/ });
    const tous = screen.getByRole('button', { name: 'Sélectionner tous les tickets de la page' });
    const un = screen.getByRole('button', { name: 'Sélectionner KP-000001' });
    for (const b of [tous, un]) {
      expect(b.className).toMatch(/\bw-11\b/);
      expect(b.className).toMatch(/\bh-11\b/);
      expect(b.className).not.toMatch(/\bw-7\b|\bh-7\b/);
    }
    expect(lien.className).toMatch(/\bmin-h-11\b/);
  });
});
