/**
 * Fiche ticket, encart « Du client » : les messages et avis laissés depuis la page de suivi sont
 * lisibles sous l'en-tête (avant, ils n'apparaissaient qu'en bas, dans « Notes internes »), les
 * non lus à l'ouverture portent « Nouveau », et la fiche ne les marque lus qu'après les avoir lus.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { auth, apiMock } = vi.hoisted(() => {
  const base = {};
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
import TicketDetailPage, { estNoteClient } from '../pages/TicketDetailPage';
import { definirCatalogue } from '../lib/prestations';

const TICKET = {
  id: 20, ticket_code: 'KP-000020', statut: 'Clôturé', client_id: 5,
  client_nom: 'Vincent', client_prenom: 'Manon', client_tel: '0633333333', client_email: '',
  categorie: 'Smartphone', marque: 'Apple', modele: 'iPhone 14', panne: 'Batterie', imei: '',
  date_depot: '2026-10-16T00:01:00', paye: 0, acompte: 0, devis_estime: 0, priorite: 'normal',
  reparation_supp: '[]', tarif_final: 0, historique: '', date_recuperation: '',
};

const NOTES = [
  { id: 3, auteur: 'Client', contenu: 'Bonjour, est-ce que mon téléphone est prêt ?', type_note: 'message_client', is_read: false, date_creation: '2026-11-02T12:00:00' },
  { id: 2, auteur: 'Client', contenu: '⭐⭐⭐⭐⭐ (5/5) — Super service', type_note: 'avis_client', is_read: true, date_creation: '2026-10-30T13:42:00' },
  { id: 1, auteur: 'Sophie', contenu: 'Batterie commandée', type_note: 'note', is_read: true, date_creation: '2026-10-16T10:00:00' },
];

function renderFiche() {
  return render(
    <MemoryRouter initialEntries={['/accueil/ticket/20']}>
      <ToastProvider>
        <Routes>
          <Route path="/accueil/ticket/:id" element={<TicketDetailPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  clearCache();
  definirCatalogue(null);
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* stockage indisponible */ }
  for (const fn of Object.values(apiMock)) fn.mockReset().mockResolvedValue([]);
  apiMock.getTicket.mockResolvedValue({ ...TICKET });
  apiMock.getNotes.mockResolvedValue(NOTES);
  apiMock.markTicketRead.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Fiche ticket — encart « Du client »', () => {
  it('ne retient que les messages et avis du client', () => {
    expect(NOTES.map(estNoteClient)).toEqual([true, true, false]);
    expect(estNoteClient({ auteur: 'Client', contenu: 'ancienne note' })).toBe(true);
    expect(estNoteClient({ auteur: 'Client', type_note: 'validation_devis' })).toBe(false);
  });

  it('montre le message et l’avis sous l’en-tête, « Nouveau » sur le non lu, avec de quoi répondre', async () => {
    renderFiche();
    const encart = (await screen.findByRole('heading', { name: 'Du client' })).closest('section');
    // Compteur de non-lus (badge-count) nommé pour les lecteurs d'écran
    expect(within(encart).getByLabelText('1 nouveau')).toHaveTextContent('1');
    expect(within(encart).getByText('Bonjour, est-ce que mon téléphone est prêt ?')).toBeInTheDocument();
    expect(within(encart).getByText('⭐⭐⭐⭐⭐ (5/5) — Super service')).toBeInTheDocument();
    expect(within(encart).queryByText('Batterie commandée')).not.toBeInTheDocument();
    expect(within(encart).getAllByText('Nouveau')).toHaveLength(1);
    expect(within(encart).getByRole('link', { name: /Répondre WhatsApp/ })).toHaveAttribute('href', expect.stringContaining('wa.me/33633333333'));
    expect(within(encart).getByRole('link', { name: /SMS/ })).toHaveAttribute('href', expect.stringMatching(/^sms:/));

    // Marqué lu seulement après la lecture des notes (sinon rien ne serait « nouveau »)
    await waitFor(() => expect(apiMock.markTicketRead).toHaveBeenCalledWith('20'));
    expect(apiMock.getNotes.mock.invocationCallOrder[0]).toBeLessThan(apiMock.markTicketRead.mock.invocationCallOrder[0]);
  });

  it('pas d’encart sans message ni avis du client', async () => {
    apiMock.getNotes.mockResolvedValue([NOTES[2]]);
    renderFiche();
    await screen.findByText('KP-000020');
    await waitFor(() => expect(apiMock.markTicketRead).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: 'Du client' })).not.toBeInTheDocument();
  });
});
