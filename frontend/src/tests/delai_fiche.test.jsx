/**
 * Fiche ticket, carte « Dates » : fixer / changer le délai promis (date_recuperation).
 * - une puce (1h … 48h) s'enregistre aussitôt ;
 * - « Autre… » reste un brouillon local : rien n'est envoyé avant « Valider », « Annuler » l'abandonne.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { auth, apiMock } = vi.hoisted(() => {
  const base = {};
  // Toute méthode non préparée par un test répond une liste vide (équipe, notes, pièces…)
  const apiMock = new Proxy(base, {
    get(target, cle) {
      if (!(cle in target)) target[cle] = vi.fn().mockResolvedValue([]);
      return target[cle];
    },
  });
  return { auth: { user: { target: 'accueil', utilisateur: 'Sophie', role: '' } }, apiMock };
});

vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));

import { ToastProvider } from '../components/Toast';
import { clearCache } from '../hooks/useApi';
import TicketDetailPage from '../pages/TicketDetailPage';
import { definirCatalogue } from '../lib/prestations';

// Lundi 19 octobre 2026, 14:10 (heure locale)
const MAINTENANT = new Date(2026, 9, 19, 14, 10, 0, 0);

function ticket(overrides = {}) {
  return {
    id: 42, ticket_code: 'KP-000042', statut: 'En cours de réparation', client_id: 5,
    client_nom: 'Martin', client_prenom: 'Léa', client_tel: '0612345678', client_email: '',
    categorie: 'Smartphone', marque: 'Apple', modele: 'iPhone 13', panne: 'Écran cassé', imei: '',
    date_depot: '2026-10-19T09:00:00', paye: 0, acompte: 0, devis_estime: 0, priorite: 'normal',
    reparation_supp: '[]', tarif_final: 0, historique: '', date_recuperation: '',
    ...overrides,
  };
}

function renderFiche() {
  return render(
    <MemoryRouter initialEntries={['/accueil/ticket/42']}>
      <ToastProvider>
        <Routes>
          <Route path="/accueil/ticket/:id" element={<TicketDetailPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const carteDates = () => screen.getByRole('heading', { name: 'Dates' }).closest('section');
const appelsDelai = () => apiMock.updateTicket.mock.calls.filter(([, patch]) => 'date_recuperation' in (patch || {}));
// Au-delà du délai de l'enregistrement automatique des prix (DELAI_FRAPPE, 250 ms depuis l'accélération ; 500 ms avant)
const attendreAutoSave = () => new Promise((r) => { setTimeout(r, 700); });

let courant;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MAINTENANT);
  clearCache();
  definirCatalogue(null);
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* stockage indisponible */ }
  auth.user = { target: 'accueil', utilisateur: 'Sophie', role: '' };
  for (const fn of Object.values(apiMock)) fn.mockReset().mockResolvedValue([]);
  courant = ticket();
  apiMock.getTicket.mockImplementation(async () => ({ ...courant }));
  apiMock.markTicketRead.mockResolvedValue({ ok: true });
  apiMock.addHistory.mockResolvedValue({ ok: true });
  apiMock.updateTicket.mockImplementation(async (id, patch) => {
    courant = { ...courant, ...patch };
    return { ok: true, ticket: { ...courant } };
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Fiche ticket — carte « Dates » : délai promis', () => {
  it('« Autre… » : brouillon local, rien d’enregistré avant « Valider » ; « Annuler » l’abandonne', async () => {
    renderFiche();
    fireEvent.click(await screen.findByRole('button', { name: 'Fixer le délai' }));
    fireEvent.click(within(carteDates()).getByRole('radio', { name: /^Autre…/ }));
    fireEvent.change(within(carteDates()).getByLabelText('Date et heure de récupération'), {
      target: { value: '2026-10-22T15:00' },
    });
    // L'heure saisie est annoncée dans le choix, mais le délai promis reste celui enregistré
    expect(within(carteDates()).getByText('Prêt jeudi 22/10 à 15:00')).toBeInTheDocument();
    expect(within(carteDates()).getByText('Non fixé')).toBeInTheDocument();
    await attendreAutoSave();
    expect(appelsDelai()).toHaveLength(0);

    fireEvent.click(within(carteDates()).getByRole('button', { name: 'Annuler' }));
    expect(within(carteDates()).queryByRole('radiogroup')).not.toBeInTheDocument();
    await attendreAutoSave();
    expect(appelsDelai()).toHaveLength(0);
    expect(within(carteDates()).getByText('Non fixé')).toBeInTheDocument();

    // Réouverture : le brouillon abandonné ne revient pas
    fireEvent.click(screen.getByRole('button', { name: 'Fixer le délai' }));
    expect(within(carteDates()).getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(0);
    fireEvent.click(within(carteDates()).getByRole('radio', { name: /^Autre…/ }));
    const valider = within(carteDates()).getByRole('button', { name: 'Valider' });
    expect(valider).toBeDisabled();
    // Heure passée : refusée
    fireEvent.change(within(carteDates()).getByLabelText('Date et heure de récupération'), {
      target: { value: '2026-10-19T09:00' },
    });
    expect(valider).toBeDisabled();
    fireEvent.change(within(carteDates()).getByLabelText('Date et heure de récupération'), {
      target: { value: '2026-10-22T15:00' },
    });
    expect(valider).toBeEnabled();
    fireEvent.click(valider);
    await waitFor(() => expect(appelsDelai()).toHaveLength(1));
    expect(appelsDelai()[0]).toEqual(['42', { date_recuperation: '2026-10-22T15:00' }]);
    expect(await screen.findByText('Délai enregistré : prêt jeudi 22/10 à 15:00')).toBeInTheDocument();
    await waitFor(() => expect(within(carteDates()).getByText('Prêt jeudi 22/10 à 15:00')).toBeInTheDocument());
    expect(within(carteDates()).queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Changer le délai' })).toBeInTheDocument();
  });

  it('carte « Réparation & Tarifs » (modification) : les mêmes puces remplacent le champ date brut', async () => {
    renderFiche();
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier la réparation et les tarifs' }));
    const carte = screen.getByRole('heading', { name: 'Réparation & Tarifs' }).closest('section');
    expect(within(carte).queryByLabelText('Date récupération')).not.toBeInTheDocument();
    const groupe = within(carte).getByRole('radiogroup', { name: /Délai de réparation/ });
    fireEvent.click(within(groupe).getByRole('radio', { name: /^2h,/ }));
    await waitFor(() => expect(appelsDelai()).toHaveLength(1));
    expect(appelsDelai()[0][1]).toMatchObject({ date_recuperation: '2026-10-19T16:10' });
  });

  it('puce « 1h » : enregistrée aussitôt, choix refermé', async () => {
    courant = ticket({ date_recuperation: '2026-10-22T15:00' });
    renderFiche();
    fireEvent.click(await screen.findByRole('button', { name: 'Changer le délai' }));
    fireEvent.click(within(carteDates()).getByRole('radio', { name: /^1h,/ }));
    await waitFor(() => expect(appelsDelai()).toHaveLength(1));
    expect(appelsDelai()[0]).toEqual(['42', { date_recuperation: '2026-10-19T15:10' }]);
    expect(await screen.findByText("Délai enregistré : prêt vers 15:10 aujourd'hui")).toBeInTheDocument();
    expect(within(carteDates()).queryByRole('radiogroup')).not.toBeInTheDocument();
  });
});
