/**
 * Fiche ticket : message « prêt » proposé après le changement de statut (jamais envoyé seul),
 * téléphone de prêt saisi dans le bloc appareil (modèle, IMEI contrôlé par Luhn, récupéré).
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
  return { auth: { user: { target: 'accueil', utilisateur: 'Sophie' } }, apiMock };
});

vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));

import { ToastProvider } from '../components/Toast';
import { clearCache } from '../hooks/useApi';
import TicketDetailPage, { imeiPretValide } from '../pages/TicketDetailPage';

const IMEI_OK = '490154203237518';
const IMEI_KO = '490154203237519';

function ticket(overrides = {}) {
  return {
    id: 42, ticket_code: 'KP-000042', statut: 'En cours de réparation', client_id: 5,
    client_nom: 'Martin', client_prenom: 'Léa', client_tel: '0612345678', client_email: '',
    categorie: 'Smartphone', marque: 'Apple', modele: 'iPhone 13', panne: 'Écran cassé',
    date_depot: '2026-10-10T09:00:00', paye: 0, acompte: 0, devis_estime: 89,
    telephone_pret: '', telephone_pret_imei: '', telephone_pret_rendu: false, historique: '',
    montants: { total: 89, acompte: 0, reste: 89, paye: false, lignes: [{ label: 'Écran', prix: 89 }], source: 'devis_estime' },
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

let courant;

beforeEach(() => {
  clearCache();
  for (const fn of Object.values(apiMock)) fn.mockReset().mockResolvedValue([]);
  courant = ticket();
  apiMock.getTicket.mockImplementation(async () => ({ ...courant }));
  apiMock.getMessageTemplates.mockResolvedValue([]);
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

describe('IMEI du téléphone de prêt', () => {
  it('vide ou 15 chiffres avec clé de Luhn (séparateurs tolérés), comme le serveur', () => {
    expect(imeiPretValide('')).toBe(true);
    expect(imeiPretValide(IMEI_OK)).toBe(true);
    expect(imeiPretValide('49 015420 323751 8')).toBe(true);
    expect(imeiPretValide(IMEI_KO)).toBe(false);
    expect(imeiPretValide('49015420323751')).toBe(false);
    expect(imeiPretValide('000000000000000')).toBe(false);
  });
});

describe('Fiche : message proposé après le changement de statut', () => {
  const changerStatut = async (statut) => {
    const select = await screen.findByRole('combobox', { name: 'Changer le statut' });
    fireEvent.change(select, { target: { value: statut } });
  };

  it('« Réparation terminée » : carte « Prévenir » pré-remplie « prêt », rien n’est envoyé, « Plus tard » la ferme', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    apiMock.changeStatus.mockImplementation(async (id, statut) => {
      courant = { ...courant, statut };
      return { ok: true, proposer_message: true };
    });
    renderFiche();
    await changerStatut('Réparation terminée');
    await waitFor(() => expect(apiMock.changeStatus).toHaveBeenCalledWith('42', 'Réparation terminée'));
    const modale = await screen.findByRole('dialog', { name: 'Prévenir Léa' });
    expect(within(modale).getByText(/KP-000042 est « Réparation terminée »/)).toBeInTheDocument();
    // Aperçu du SMS court (version GSM du modèle « Appareil pret »)
    expect(within(modale).getByText(/votre Apple iPhone 13 est pret ?!.*Montant : 89\.00 EUR/)).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    expect(apiMock.logMessage).not.toHaveBeenCalled();
    fireEvent.click(within(modale).getByRole('button', { name: 'Plus tard' }));
    expect(screen.queryByRole('dialog', { name: 'Prévenir Léa' })).not.toBeInTheDocument();
  });

  it('autre statut proposé : grille de messages pré-remplie (comportement inchangé)', async () => {
    apiMock.changeStatus.mockImplementation(async (id, statut) => {
      courant = { ...courant, statut };
      return { ok: true, proposer_message: true };
    });
    renderFiche();
    await changerStatut('Pièce reçue');
    const modale = await screen.findByRole('dialog', { name: 'Prévenir Léa ?' });
    expect(within(modale).getByText(/KP-000042 est « Pièce reçue »/)).toBeInTheDocument();
    expect(within(modale).queryByText('Choisir un autre message')).not.toBeInTheDocument();
    fireEvent.click(within(modale).getByRole('button', { name: 'Plus tard' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('statut sans proposition (réponse du serveur) : pas de modale', async () => {
    apiMock.changeStatus.mockImplementation(async (id, statut) => {
      courant = { ...courant, statut };
      return { ok: true, proposer_message: false };
    });
    renderFiche();
    await changerStatut('Pièce reçue');
    expect(await screen.findByText('Statut changé : Pièce reçue')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Fiche : téléphone de prêt dans le bloc appareil', () => {
  const ouvrirAppareil = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier Appareil' }));
  };
  const envois = (cle) => apiMock.updateTicket.mock.calls.filter(([, patch]) => cle in patch).map(([, patch]) => patch);

  it('modèle puis IMEI : un IMEI invalide n’est pas envoyé, un IMEI valide l’est', async () => {
    renderFiche();
    await ouvrirAppareil();
    const imei = screen.getByLabelText('IMEI du prêt');
    expect(imei).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Téléphone de prêt'), { target: { value: 'Galaxy S9 de prêt' } });
    await waitFor(() => expect(envois('telephone_pret')).toEqual([expect.objectContaining({ telephone_pret: 'Galaxy S9 de prêt' })]), { timeout: 3000 });
    expect(imei).toBeEnabled();

    fireEvent.change(imei, { target: { value: IMEI_KO } });
    fireEvent.blur(imei);
    expect(await screen.findByText('IMEI invalide (15 chiffres, clé de contrôle) : non enregistré')).toBeInTheDocument();
    expect(imei).toHaveAttribute('aria-invalid', 'true');
    await new Promise((r) => setTimeout(r, 900));
    expect(envois('telephone_pret_imei')).toEqual([]);

    fireEvent.change(imei, { target: { value: '49 015420 323751 8' } });
    await waitFor(() => expect(envois('telephone_pret_imei')).toEqual([{ telephone_pret_imei: '49 015420 323751 8' }]), { timeout: 3000 });
    expect(screen.queryByText(/IMEI invalide/)).not.toBeInTheDocument();
  });

  it('nouveau prêt sur un ticket dont l’ancien prêt était rendu : il repart « dehors »', async () => {
    courant = ticket({ telephone_pret_rendu: true });
    renderFiche();
    await ouvrirAppareil();
    fireEvent.change(screen.getByLabelText('Téléphone de prêt'), { target: { value: 'iPhone 8' } });
    await waitFor(() => expect(envois('telephone_pret')).toEqual([{ telephone_pret: 'iPhone 8', telephone_pret_rendu: 0 }]), { timeout: 3000 });
    expect(screen.getByRole('checkbox', { name: 'Prêt récupéré' })).not.toBeChecked();
  });

  it('prêt en cours affiché sur la fiche ; « Prêt récupéré » enregistré et tracé', async () => {
    courant = ticket({ telephone_pret: 'Galaxy S9', telephone_pret_imei: IMEI_OK });
    renderFiche();
    expect(await screen.findByText('À récupérer avant la remise')).toBeInTheDocument();
    expect(screen.getByText(`IMEI ${IMEI_OK}`)).toBeInTheDocument();
    await ouvrirAppareil();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Prêt récupéré' }));
    await waitFor(() => expect(envois('telephone_pret_rendu')).toEqual([{ telephone_pret_rendu: 1 }]));
    await waitFor(() => expect(apiMock.addHistory).toHaveBeenCalledWith('42', 'Téléphone de prêt restitué — par Sophie'));
  });
});
