/**
 * Lot 6 — fiche ticket : TVA par défaut (20 % comme les documents), ligne « Client contacté » relue
 * après un message, schéma saisi sans tirets, en-tête d'un retour SAV (garantie, pas « Sur devis »).
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
import { formatPrix } from '../lib/utils';
import PatternGrid, { parsePattern, normaliserPattern } from '../components/PatternGrid';

function ticket(overrides = {}) {
  return {
    id: 42, ticket_code: 'KP-000042', statut: 'Réparation terminée', client_id: 5,
    client_nom: 'Martin', client_prenom: 'Léa', client_tel: '0612345678', client_email: '',
    tel_contact: null, contact: null,
    categorie: 'Smartphone', marque: 'Apple', modele: 'iPhone 13', panne: 'Écran cassé', imei: '',
    date_depot: '2026-10-10T09:00:00', paye: 0, acompte: 0, devis_estime: 0, priorite: 'normal',
    reparation_supp: JSON.stringify([{ label: 'Forfait remplacement écran', prix: 120 }]),
    tarif_final: 0, historique: '',
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

const carteReparation = () => screen.getByRole('heading', { name: 'Réparation & Tarifs' }).closest('section');
const rubriqueContact = async () => (await screen.findByRole('button', { name: 'Contacté par tél.' })).parentElement;

let courant;
let config;

beforeEach(() => {
  clearCache();
  definirCatalogue(null);
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* stockage indisponible */ }
  auth.user = { target: 'accueil', utilisateur: 'Sophie', role: '' };
  for (const fn of Object.values(apiMock)) fn.mockReset().mockResolvedValue([]);
  courant = ticket();
  config = [];
  apiMock.getTicket.mockImplementation(async () => ({ ...courant }));
  apiMock.getCached.mockImplementation(async (url) => (url === '/api/config' ? config.map((p) => ({ ...p })) : []));
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

describe('Fiche ticket — TVA du récapitulatif', () => {
  it('paramètre « tva » absent : 20 % comme les devis imprimés (HT = TTC / 1,2)', async () => {
    renderFiche();
    await screen.findByRole('heading', { name: 'Réparation & Tarifs' });
    const carte = carteReparation();
    expect(await within(carte).findByText('TVA (20%)')).toBeInTheDocument();
    expect(within(carte).getByText(formatPrix(100))).toBeInTheDocument();
    expect(within(carte).getByText(formatPrix(20))).toBeInTheDocument();
    expect(within(carte).queryByText('TVA (0%)')).toBeNull();
  });

  it('paramètre présent : sa valeur, 0 compris ; valeur non numérique ignorée (20 %)', async () => {
    config = [{ cle: 'tva', valeur: '0' }];
    renderFiche();
    await screen.findByRole('heading', { name: 'Réparation & Tarifs' });
    expect(await within(carteReparation()).findByText('TVA (0%)')).toBeInTheDocument();
    cleanup();

    clearCache();
    config = [{ cle: 'tva', valeur: '5.5' }];
    renderFiche();
    await screen.findByRole('heading', { name: 'Réparation & Tarifs' });
    expect(await within(carteReparation()).findByText('TVA (5.5%)')).toBeInTheDocument();
    cleanup();

    clearCache();
    config = [{ cle: 'tva', valeur: 'abc' }];
    renderFiche();
    await screen.findByRole('heading', { name: 'Réparation & Tarifs' });
    expect(await within(carteReparation()).findByText('TVA (20%)')).toBeInTheDocument();
  });
});

describe('Fiche ticket — « Client contacté » après un message', () => {
  it('WhatsApp depuis la carte Messages : la ligne passe à « Contacté par WhatsApp », sans recharger la page', async () => {
    const quand = '2026-10-20T12:30:00';
    const ouvrir = vi.spyOn(window, 'open').mockImplementation(() => null);
    apiMock.logMessage.mockImplementation(async () => {
      courant = {
        ...courant,
        contact: {
          depuis_statut: true,
          dernier: { canal: 'whatsapp', date: quand, auteur: 'Sophie' },
          canaux: { sms: null, email: null, whatsapp: quand, appel: null },
        },
      };
      return { ok: true };
    });
    renderFiche();
    const r = await rubriqueContact();
    expect(within(r).getByText('Pas encore contacté')).toBeInTheDocument();

    const messages = screen.getByRole('heading', { name: 'Messages' }).closest('section');
    fireEvent.click(within(messages).getByRole('button', { name: 'Appareil recu' }));
    fireEvent.click(within(messages).getByRole('button', { name: 'WhatsApp' }));
    await waitFor(() => expect(apiMock.logMessage).toHaveBeenCalledTimes(1));
    expect(ouvrir).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(r).queryByText('Pas encore contacté')).toBeNull());
    expect(within(r).getByText(/^Contacté par WhatsApp le /)).toBeInTheDocument();
  });
});

describe('PatternGrid : valeur saisie sans tirets', () => {
  it('« 15963 » / « 1 5 9 » lus comme un tracé ; répétitions, 0 et texte libre non convertis', () => {
    expect(parsePattern('15963')).toEqual([1, 5, 9, 6, 3]);
    expect(parsePattern(' 1 5 9 ')).toEqual([1, 5, 9]);
    expect(parsePattern('1-5-9-6-3')).toEqual([1, 5, 9, 6, 3]);
    expect(parsePattern('0-12-x-3')).toEqual([3]);
    expect(parsePattern('Z inversé')).toEqual([]);
    expect(normaliserPattern('15963')).toBe('1-5-9-6-3');
    expect(normaliserPattern('1-5-9')).toBe('1-5-9');
    expect(normaliserPattern('1551')).toBe('1551');
    expect(normaliserPattern('1059')).toBe('1059');
    expect(normaliserPattern('')).toBe('');
  });

  it('lecture seule : texte brut affiché quand la valeur ne se lit pas comme un tracé, rien si vide', () => {
    const { rerender } = render(<PatternGrid value="L à l'envers" readOnly />);
    expect(screen.getByRole('img', { name: "Schéma de déverrouillage : L à l'envers" })).toBeInTheDocument();
    expect(screen.getByText("L à l'envers")).toBeInTheDocument();
    rerender(<PatternGrid value="" readOnly />);
    expect(screen.getByRole('img', { name: 'Schéma de déverrouillage : aucun' })).toBeInTheDocument();
  });
});

describe('Fiche ticket — schéma de déverrouillage', () => {
  it('saisi sans tirets (« 15963 ») : tracé affiché en lecture, pas une grille vide', async () => {
    courant = ticket({ pattern: '15963' });
    renderFiche();
    expect(await screen.findByRole('img', { name: 'Schéma de déverrouillage : 1 → 5 → 9 → 6 → 3' })).toBeInTheDocument();
  });

  it('valeur non lisible comme un tracé : le texte saisi reste visible', async () => {
    courant = ticket({ pattern: 'Z inversé' });
    renderFiche();
    expect(await screen.findByRole('img', { name: 'Schéma de déverrouillage : Z inversé' })).toBeInTheDocument();
    expect(screen.getByText('Z inversé')).toBeInTheDocument();
  });

  it('édition : « 15963 » saisi est enregistré « 1-5-9-6-3 » en quittant le champ', async () => {
    renderFiche();
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier Appareil' }));
    const champ = await screen.findByLabelText('Pattern');
    fireEvent.change(champ, { target: { value: '15963' } });
    fireEvent.blur(champ);
    await waitFor(() => expect(apiMock.updateTicket).toHaveBeenCalledWith('42', expect.objectContaining({ pattern: '1-5-9-6-3' }), expect.anything()));
    expect(champ).toHaveValue('1-5-9-6-3');
    const envoyes = apiMock.updateTicket.mock.calls.map(([, p]) => p.pattern).filter((p) => p !== undefined);
    expect(envoyes).not.toContain('15963');
  });
});

describe('Fiche ticket — retour SAV', () => {
  it('en-tête : « Garantie », jamais « Sur devis », et lignes à 0 € sans « Sur devis »', async () => {
    courant = ticket({
      statut: 'En attente de diagnostic', est_retour_sav: true,
      reparation_supp: JSON.stringify([{ label: 'Retour SAV', prix: 0 }]),
    });
    renderFiche();
    await screen.findByRole('heading', { level: 1, name: 'KP-000042' });
    expect(await screen.findByText(`Garantie · ${formatPrix(0)}`)).toBeInTheDocument();
    expect(screen.queryByText('Sur devis')).toBeNull();
  });

  it('ticket ordinaire sans prix : « Sur devis » conservé', async () => {
    courant = ticket({ statut: 'En attente de diagnostic', reparation_supp: '[]' });
    renderFiche();
    await screen.findByRole('heading', { level: 1, name: 'KP-000042' });
    expect((await screen.findAllByText('Sur devis')).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/^Garantie · /)).toBeNull();
  });
});
