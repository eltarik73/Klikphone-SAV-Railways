/**
 * Page publique /suivi : bloc « Tarification ». Le reste à payer vient des montants du
 * serveur (GET /api/tickets/code/{code} → montants) : un ticket payé n'affiche plus de
 * reste dû, un acompte supérieur au total n'affiche jamais de montant négatif.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getTicketByCode: vi.fn(), getTicketsByPhone: vi.fn(), getPublicCommandes: vi.fn(),
    suiviHasAvis: vi.fn(), trackEvent: vi.fn(),
  },
}));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));
vi.mock('../components/FideliteCard', () => ({ default: () => null }));
vi.mock('../components/ScratchCard', () => ({ default: () => null }));

import SuiviPage from '../pages/SuiviPage';

const LIGNES_89 = JSON.stringify([{ label: 'Remplacement batterie', prix: 89 }]);

function ticket(extra) {
  return {
    id: 5, ticket_code: 'KP-000005', statut: 'Clôturé', marque: 'Apple', modele: 'iPhone 12',
    panne: 'Batterie', date_depot: '2026-10-15T10:00:00', reparation_supp: LIGNES_89,
    devis_estime: 0, acompte: 20, reduction_montant: 0, reduction_pourcentage: 0, ...extra,
  };
}

async function ouvrir(data) {
  apiMock.getTicketByCode.mockResolvedValue(data);
  render(
    <MemoryRouter initialEntries={['/suivi?ticket=KP-000005']}>
      <SuiviPage />
    </MemoryRouter>,
  );
  const titre = await screen.findByText('Tarification');
  return titre.closest('.card-section');
}

beforeEach(() => {
  Object.values(apiMock).forEach((fn) => fn.mockReset());
  apiMock.getPublicCommandes.mockResolvedValue([]);
  apiMock.suiviHasAvis.mockResolvedValue({ has_avis: false });
  apiMock.trackEvent.mockResolvedValue({});
});
afterEach(cleanup);

describe('SuiviPage — reste à payer', () => {
  it('ticket soldé à la restitution : « Payé », aucun reste dû', async () => {
    const bloc = await ouvrir(ticket({
      paye: 1,
      montants: { sous_total: 89, reduction: 0, total: 89, acompte: 20, reste: 0, paye: true },
    }));
    expect(within(bloc).getByText('Payé')).toBeTruthy();
    expect(within(bloc).queryByText('Reste à payer')).toBeNull();
    expect(bloc.textContent).not.toMatch(/69[.,]00/);
  });

  it('acompte supérieur au total : jamais de reste négatif', async () => {
    const bloc = await ouvrir(ticket({
      statut: 'Réparation terminée', acompte: 120, paye: 0,
      montants: { sous_total: 89, reduction: 0, total: 89, acompte: 120, reste: 0, paye: false },
    }));
    expect(within(bloc).getByText('Reste à payer')).toBeTruthy();
    expect(bloc.textContent).not.toMatch(/-\s?31/);
  });

  it('ancienne réponse sans `montants` : repli plancher à 0 et « Payé » si paye', async () => {
    let bloc = await ouvrir(ticket({ statut: 'Réparation terminée', acompte: 120, paye: 0 }));
    expect(bloc.textContent).not.toMatch(/-\s?31/);
    cleanup();
    bloc = await ouvrir(ticket({ paye: 1 }));
    expect(within(bloc).getByText('Payé')).toBeTruthy();
    expect(within(bloc).queryByText('Reste à payer')).toBeNull();
  });

  it('reste réellement dû : montant du serveur affiché', async () => {
    const bloc = await ouvrir(ticket({
      statut: 'Réparation terminée', paye: 0,
      montants: { sous_total: 89, reduction: 0, total: 89, acompte: 20, reste: 69, paye: false },
    }));
    const ligne = within(bloc).getByText('Reste à payer').parentElement;
    expect(ligne.textContent).toMatch(/69[.,]00/);
    expect(within(bloc).queryByText('Payé')).toBeNull();
  });
});
