/**
 * Fiche ticket : second numéro (tickets.tel_contact) — pastille « Joignable au … » de l'en-tête
 * et ligne « Numéro pour vous joindre (si différent) » modifiable en place dans la carte Client.
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

const TEL_FICHE = '0612345678';
const TEL_CONTACT = '0698765432';
const MESSAGE_422 = 'Numéro pour vous joindre invalide (ex. 06 12 34 56 78)';

function ticket(overrides = {}) {
  return {
    id: 42, ticket_code: 'KP-000042', statut: 'En cours de réparation', client_id: 5,
    client_nom: 'Martin', client_prenom: 'Léa', client_tel: TEL_FICHE, client_email: '',
    tel_contact: null,
    categorie: 'Smartphone', marque: 'Apple', modele: 'iPhone 13', panne: 'Écran cassé', imei: '',
    date_depot: '2026-10-10T09:00:00', paye: 0, acompte: 0, devis_estime: 0, priorite: 'normal',
    reparation_supp: '[]', tarif_final: 0, historique: '',
    ...overrides,
  };
}

// Erreur telle que la construit l'ApiClient (httpError) pour un 422 Pydantic sur tel_contact
function erreur422TelContact() {
  const err = new Error(`Données invalides — tel_contact : ${MESSAGE_422}`);
  err.status = 422;
  err.detail = [{ loc: ['body', 'tel_contact'], msg: `Value error, ${MESSAGE_422}`, type: 'value_error' }];
  err.data = err.detail;
  return err;
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

const pastille = () => screen.queryByText(/^Joignable au /);
const ligne = () => screen.getByText('Numéro pour vous joindre (si différent)', { selector: 'p' }).parentElement;
const crayon = () => screen.getByRole('button', { name: 'Modifier le numéro pour vous joindre' });
const champ = () => screen.getByPlaceholderText('06 12 34 56 78');

async function ouvrirEdition() {
  fireEvent.click(await screen.findByRole('button', { name: 'Modifier le numéro pour vous joindre' }));
  return champ();
}

let courant;

beforeEach(() => {
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
  vi.restoreAllMocks();
});

describe('Fiche ticket — second numéro (tel_contact)', () => {
  it('pastille « Joignable au … » dans l’en-tête quand le second numéro diffère ; le numéro principal reste affiché', async () => {
    courant = ticket({ tel_contact: TEL_CONTACT });
    renderFiche();
    const badge = await screen.findByText('Joignable au 06 98 76 54 32');
    expect(badge.closest('span[title]')).toHaveAttribute('title', 'Numéro pour joindre le client pendant la réparation');
    // Numéro principal toujours là (en-tête + carte Client)
    expect(screen.getAllByText('06 12 34 56 78').length).toBeGreaterThanOrEqual(2);
    // Carte Client : la ligne montre le second numéro formaté
    expect(within(ligne()).getByText('06 98 76 54 32')).toBeInTheDocument();
    expect(crayon()).toBeInTheDocument();
  });

  it('pas de pastille sans second numéro : la ligne affiche « — »', async () => {
    renderFiche();
    await screen.findByRole('button', { name: 'Modifier le numéro pour vous joindre' });
    expect(pastille()).toBeNull();
    expect(within(ligne()).getByText('—')).toBeInTheDocument();
  });

  it('pas de pastille quand le second numéro est celui de la fiche client (même chiffres)', async () => {
    courant = ticket({ tel_contact: '06 12 34 56 78' });
    renderFiche();
    await screen.findByRole('button', { name: 'Modifier le numéro pour vous joindre' });
    expect(pastille()).toBeNull();
  });

  it('crayon → champ tel (16 px, placeholder), « Enregistrer » → updateTicket({ tel_contact }) puis pastille à jour', async () => {
    renderFiche();
    const input = await ouvrirEdition();
    expect(input).toHaveAttribute('type', 'tel');
    expect(input).toHaveFocus();
    expect(input.className).toContain('lg:text-base');
    fireEvent.change(input, { target: { value: '06 98 76 54 32' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(apiMock.updateTicket).toHaveBeenCalledWith('42', { tel_contact: '06 98 76 54 32' }));
    // Le champ se referme, la ligne et l’en-tête reflètent le ticket renvoyé
    await waitFor(() => expect(screen.queryByPlaceholderText('06 12 34 56 78')).toBeNull());
    expect(screen.getByText('Joignable au 06 98 76 54 32')).toBeInTheDocument();
    expect(within(ligne()).getByText('06 98 76 54 32')).toBeInTheDocument();
    expect(crayon()).toHaveFocus();
  });

  it('Entrée dans le champ enregistre aussi', async () => {
    renderFiche();
    const input = await ouvrirEdition();
    fireEvent.change(input, { target: { value: TEL_CONTACT } });
    fireEvent.submit(input.closest('form'));
    await waitFor(() => expect(apiMock.updateTicket).toHaveBeenCalledWith('42', { tel_contact: TEL_CONTACT }));
    expect(await screen.findByText('Joignable au 06 98 76 54 32')).toBeInTheDocument();
  });

  it('effacement : champ vidé → updateTicket({ tel_contact: "" }), pastille retirée, ligne « — »', async () => {
    courant = ticket({ tel_contact: TEL_CONTACT });
    renderFiche();
    expect(await screen.findByText('Joignable au 06 98 76 54 32')).toBeInTheDocument();
    const input = await ouvrirEdition();
    expect(input).toHaveValue(TEL_CONTACT);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(apiMock.updateTicket).toHaveBeenCalledWith('42', { tel_contact: '' }));
    await waitFor(() => expect(pastille()).toBeNull());
    expect(within(ligne()).getByText('—')).toBeInTheDocument();
  });

  it('422 du serveur : message affiché sous le champ, champ toujours ouvert et invalide, ticket inchangé', async () => {
    renderFiche();
    const input = await ouvrirEdition();
    apiMock.updateTicket.mockImplementation(async (id, patch) => {
      if ('tel_contact' in patch) throw erreur422TelContact();
      courant = { ...courant, ...patch };
      return { ok: true, ticket: { ...courant } };
    });
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    const alerte = await screen.findByRole('alert');
    expect(alerte).toHaveTextContent(MESSAGE_422);
    expect(alerte).not.toHaveTextContent('Données invalides');
    expect(champ()).toHaveAttribute('aria-invalid', 'true');
    expect(champ()).toHaveValue('12');
    expect(champ().getAttribute('aria-describedby')).toContain(alerte.id);
    expect(pastille()).toBeNull();
    // Corriger la saisie efface l’erreur
    fireEvent.change(champ(), { target: { value: '0698' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('valeur inchangée ou Échap : aucun envoi, le champ se referme et le focus revient au crayon', async () => {
    courant = ticket({ tel_contact: TEL_CONTACT });
    renderFiche();
    let input = await ouvrirEdition();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(screen.queryByPlaceholderText('06 12 34 56 78')).toBeNull());
    expect(apiMock.updateTicket).not.toHaveBeenCalled();

    input = await ouvrirEdition();
    fireEvent.change(input, { target: { value: '0700000000' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByPlaceholderText('06 12 34 56 78')).toBeNull());
    expect(apiMock.updateTicket).not.toHaveBeenCalled();
    expect(crayon()).toHaveFocus();
    // La valeur enregistrée est conservée
    expect(within(ligne()).getByText('06 98 76 54 32')).toBeInTheDocument();
    expect(screen.getByText('Joignable au 06 98 76 54 32')).toBeInTheDocument();
  });
});
