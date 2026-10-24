/**
 * Envois optimistes (grilles de prix) :
 * - useEnvoisOptimistes : une file par ligne, échec → retour à la dernière valeur confirmée, deux envois
 *   rapprochés (la réponse ou l'échec du premier n'écrase pas la saisie suivante), démontage pendant un envoi ;
 * - Vente smartphones / iPhones : la garde de navigation (interne et fermeture de l'onglet) reste active
 *   tant qu'un envoi est en cours, un échec après le changement de page est signalé par une notification globale ;
 * - Réparation iPhone : avertissement à la fermeture de l'onglet pendant un envoi ;
 * - Fiche : la relecture des commandes et notes après un statut est séquencée (une réponse ancienne
 *   n'écrase pas une plus récente).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, renderHook, act, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { BrowserRouter, MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';

const { toast, apiMock } = vi.hoisted(() => {
  const base = {};
  // Toute méthode non préparée par un test répond une liste vide
  const apiMock = new Proxy(base, {
    get(target, cle) {
      if (!(cle in target)) target[cle] = vi.fn().mockResolvedValue([]);
      return target[cle];
    },
  });
  return {
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), important: vi.fn() },
    apiMock,
  };
});

// `toast` : les notifications globales de l'application (ToastProvider), qui survivent à un changement de page
vi.mock('../components/Toast', () => ({ useToast: () => toast, ToastProvider: ({ children }) => children }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { target: 'accueil', utilisateur: 'Test' } }) }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));

import { useEnvoisOptimistes, useAvertirAvantDepart } from '../hooks/useEnvoisOptimistes';
import { clearCache } from '../hooks/useApi';
import AdminTarifsSmartphonesPage from '../pages/AdminTarifsSmartphonesPage';
import AdminTarifsIphonePage from '../pages/AdminTarifsIphonePage';
import TarifsReparationPage from '../pages/TarifsReparationPage';
import TicketDetailPage from '../pages/TicketDetailPage';

function differe() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Laisse passer les microtâches (enchaînements internes de la file)
async function vider() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const beforeunloadBloque = () => {
  const evt = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(evt);
  return evt.defaultPrevented;
};

beforeEach(() => {
  clearCache();
  for (const fn of Object.values(apiMock)) fn.mockReset().mockResolvedValue([]);
  Object.values(toast).forEach((f) => f.mockReset());
  localStorage.clear();
  apiMock.getConfig.mockResolvedValue([]);
  apiMock.getReglesPrix.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

// ─── Le hook seul ────────────────────────────────────
describe('useEnvoisOptimistes', () => {
  it('une file par ligne : le 2e envoi d’une ligne attend le 1er, une autre ligne part tout de suite', async () => {
    const { result } = renderHook(() => useEnvoisOptimistes());
    const a1 = differe();
    const a2 = differe();
    const b1 = differe();
    const fa1 = vi.fn(() => a1.promise);
    const fa2 = vi.fn(() => a2.promise);
    const fb1 = vi.fn(() => b1.promise);
    let pa1; let pa2; let pb1;
    await act(async () => {
      pa1 = result.current.envoyer('A', fa1, { avant: { prix: 10 }, apres: { prix: 11 } });
      pa2 = result.current.envoyer('A', fa2, { avant: { prix: 11 }, apres: { prix: 12 } });
      pb1 = result.current.envoyer('B', fb1, { avant: { prix: 5 }, apres: { prix: 6 } });
      await vider();
    });
    expect(fa1).toHaveBeenCalledTimes(1);
    expect(fb1).toHaveBeenCalledTimes(1);
    expect(fa2).not.toHaveBeenCalled(); // la ligne A n'a qu'un envoi à la fois
    expect(result.current.nombre).toBe(2);
    expect(result.current.enCours('A')).toBe(true);
    expect(result.current.enCours('A', 'prix')).toBe(true);
    expect(result.current.enCours('A', 'stock')).toBe(false);

    await act(async () => { a1.resolve({ prix: 11 }); await vider(); });
    expect(fa2).toHaveBeenCalledTimes(1); // parti après la réponse du 1er, dans l'ordre des saisies
    const r1 = await pa1;
    expect(r1.ok).toBe(true);
    expect(r1.reponse).toEqual({ prix: 11 });
    expect(r1.proteges.has('prix')).toBe(true); // 12 encore en file : la réponse « 11 » ne doit pas l'écraser

    await act(async () => { a2.resolve({ prix: 12 }); b1.resolve({ prix: 6 }); await vider(); });
    expect((await pa2).proteges.size).toBe(0);
    expect((await pb1).ok).toBe(true);
    expect(result.current.nombre).toBe(0);
    expect(result.current.enCours('A')).toBe(false);
  });

  it('échec : « retablir » donne la dernière valeur confirmée, attendre() rend faux', async () => {
    const { result } = renderHook(() => useEnvoisOptimistes());
    const d = differe();
    let p;
    await act(async () => {
      p = result.current.envoyer('A', () => d.promise, { avant: { prix: 10, stock: 2 }, apres: { prix: 15 } });
      await vider();
    });
    const attente = result.current.attendre();
    const erreur = Object.assign(new Error('Base indisponible'), { status: 500 });
    await act(async () => { d.reject(erreur); await vider(); });
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.erreur).toBe(erreur);
    expect(r.retablir).toEqual({ prix: 10 }); // seulement les clés saisies
    expect(r.proteges.size).toBe(0);
    expect(await attente).toBe(false);
    expect(result.current.nombre).toBe(0);
  });

  it('deux envois rapprochés : l’échec du 1er ne rétablit rien sous la saisie suivante ; l’échec du 2e revient à la valeur confirmée', async () => {
    const { result } = renderHook(() => useEnvoisOptimistes());
    const d1 = differe();
    const d2 = differe();
    let p1; let p2;
    await act(async () => {
      // 10 (confirmé) → 15 → 20, deux validations coup sur coup
      p1 = result.current.envoyer('A', () => d1.promise, { avant: { prix: 10 }, apres: { prix: 15 } });
      p2 = result.current.envoyer('A', () => d2.promise, { avant: { prix: 15 }, apres: { prix: 20 } });
      await vider();
    });
    await act(async () => { d1.reject(new Error('coupure')); await vider(); });
    const r1 = await p1;
    expect(r1.ok).toBe(false);
    expect(r1.retablir).toEqual({}); // 20 est encore en file : l'écran garde 20
    expect(r1.proteges.has('prix')).toBe(true);
    await act(async () => { d2.reject(new Error('coupure')); await vider(); });
    const r2 = await p2;
    expect(r2.retablir).toEqual({ prix: 10 }); // ni 15 ni 20 n'ont été confirmés
  });

  it('un succès devient la valeur confirmée du retour arrière suivant', async () => {
    const { result } = renderHook(() => useEnvoisOptimistes());
    let p;
    await act(async () => {
      p = result.current.envoyer('A', async () => ({ ok: true }), { avant: { prix: 10 }, apres: { prix: 15 } });
      await vider();
    });
    expect((await p).ok).toBe(true);
    await act(async () => {
      p = result.current.envoyer('A', async () => { throw new Error('refus'); }, { avant: { prix: 15 }, apres: { prix: 30 } });
      await vider();
    });
    expect((await p).retablir).toEqual({ prix: 15 });
  });

  it('démontage pendant un envoi : l’envoi va au bout, la promesse se résout, monte() devient faux, pas d’erreur React', async () => {
    const consoleErr = vi.spyOn(console, 'error');
    const { result, unmount } = renderHook(() => useEnvoisOptimistes());
    const d = differe();
    const fn = vi.fn(() => d.promise);
    let p;
    await act(async () => {
      p = result.current.envoyer('A', fn, { avant: { prix: 10 }, apres: { prix: 11 } });
      await vider();
    });
    const { monte } = result.current;
    expect(monte()).toBe(true);
    unmount();
    expect(monte()).toBe(false);
    d.reject(new Error('Base indisponible'));
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.retablir).toEqual({ prix: 10 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(consoleErr).not.toHaveBeenCalled();
  });

  it('useAvertirAvantDepart : fermeture de l’onglet retenue seulement pendant un envoi', () => {
    const { rerender, unmount } = renderHook(({ actif }) => useAvertirAvantDepart(actif), { initialProps: { actif: false } });
    expect(beforeunloadBloque()).toBe(false);
    rerender({ actif: true });
    expect(beforeunloadBloque()).toBe(true);
    rerender({ actif: false });
    expect(beforeunloadBloque()).toBe(false);
    rerender({ actif: true });
    unmount();
    expect(beforeunloadBloque()).toBe(false);
  });
});

// ─── Ventes iPhones / smartphones : garde pendant l'envoi ───
// setup.js remplace window.location par un objet figé : ici, une location qui suit l'URL du document
let locationSetup;
beforeAll(() => {
  locationSetup = Object.getOwnPropertyDescriptor(window, 'location');
  Object.defineProperty(window, 'location', {
    configurable: true,
    get: () => {
      const u = new URL(document.URL);
      return { href: u.href, origin: u.origin, protocol: u.protocol, host: u.host, pathname: u.pathname,
        search: u.search, hash: u.hash, assign: () => {}, replace: () => {}, reload: () => {} };
    },
  });
});
afterAll(() => { if (locationSetup) Object.defineProperty(window, 'location', locationSetup); });

function AllerClients() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/accueil/clients')}>Aller aux clients</button>;
}

function appli(chemin, page) {
  window.history.replaceState(null, '', chemin);
  return render(
    <BrowserRouter>
      <AllerClients />
      <Routes>
        <Route path={chemin} element={page} />
        <Route path="/accueil/clients" element={<h1>Page clients</h1>} />
      </Routes>
    </BrowserRouter>,
  );
}

describe('Vente smartphones : envoi en cours', () => {
  const TELEPHONES = [
    { id: 1, marque: 'Samsung', modele: 'Galaxy A16', slug: 'samsung-galaxy-a16', stockage_1: '128 Go', prix_1: 189, actif: true, prix_maj_le: '2026-10-01T10:00:00' },
  ];
  const CHEMIN = '/accueil/admin/tarifs-smartphones';
  let envoi;

  beforeEach(() => {
    apiMock.getSmartphonesTarifs.mockResolvedValue(TELEPHONES);
    envoi = differe();
    apiMock.updateSmartphoneTarif.mockImplementation(() => envoi.promise);
  });

  const enregistrer = async () => {
    appli(CHEMIN, <AdminTarifsSmartphonesPage />);
    const prix = await screen.findByRole('spinbutton', { name: 'Prix 1 de Galaxy A16, en euros' });
    fireEvent.change(prix, { target: { value: '199' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer Samsung Galaxy A16' }));
    // Optimiste : plus « modifiée », l'envoi est en cours
    expect(await screen.findByText('Enregistrement de Samsung Galaxy A16…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enregistrer Samsung Galaxy A16' })).not.toBeInTheDocument();
    await waitFor(() => expect(apiMock.updateSmartphoneTarif).toHaveBeenCalledWith(1, expect.objectContaining({ prix_1: 199 })));
  };

  it('navigation interne retenue pendant l’envoi ; « Attendre et quitter » part une fois le prix enregistré', async () => {
    await enregistrer();
    expect(beforeunloadBloque()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Aller aux clients' }));
    const fenetre = await screen.findByRole('dialog', { name: 'Enregistrement en cours' });
    expect(window.location.pathname).toBe(CHEMIN);
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Attendre et quitter' }));
    expect(screen.queryByRole('heading', { name: 'Page clients' })).not.toBeInTheDocument();
    await act(async () => { envoi.resolve({ ok: true }); });
    expect(await screen.findByRole('heading', { name: 'Page clients' })).toBeInTheDocument();
    expect(apiMock.updateSmartphoneTarif).toHaveBeenCalledTimes(1);
    expect(beforeunloadBloque()).toBe(false);
  });

  it('« Quitter sans attendre » puis échec : notification globale (la page n’est plus là)', async () => {
    await enregistrer();
    fireEvent.click(screen.getByRole('button', { name: 'Aller aux clients' }));
    const fenetre = await screen.findByRole('dialog', { name: 'Enregistrement en cours' });
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Quitter sans attendre' }));
    expect(await screen.findByRole('heading', { name: 'Page clients' })).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
    await act(async () => { envoi.reject(Object.assign(new Error('Base indisponible'), { status: 500 })); });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Samsung Galaxy A16 non enregistré')));
  });

  it('échec sur la page : la ligne redevient modifiée, message sur la page (pas de notification globale)', async () => {
    await enregistrer();
    await act(async () => { envoi.reject(Object.assign(new Error('Base indisponible'), { status: 500 })); });
    expect(await screen.findByRole('button', { name: 'Enregistrer Samsung Galaxy A16' })).toBeInTheDocument();
    expect(await screen.findByText(/Samsung Galaxy A16 non enregistré/)).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('Vente iPhones : envoi en cours', () => {
  const IPHONES = [
    { id: 7, slug: 'iphone-13', modele: 'iPhone 13', ordre: 1, stockage_1: '128 Go', prix_1: 399, stock_1: 3, actif: true, condition: 'Reconditionné Premium', prix_maj_le: '2026-10-01T10:00:00' },
  ];
  const CHEMIN = '/accueil/admin/tarifs-iphone';

  it('la garde reste active pendant l’envoi, un échec après le départ est signalé globalement', async () => {
    apiMock.get.mockResolvedValue(IPHONES);
    const envoi = differe();
    apiMock.patch.mockImplementation(() => envoi.promise);
    appli(CHEMIN, <AdminTarifsIphonePage />);
    const prix = await screen.findByRole('spinbutton', { name: 'Prix 1 de iPhone 13, en euros' });
    fireEvent.change(prix, { target: { value: '419' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer iPhone 13' }));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith('/api/iphone-tarifs/7', expect.objectContaining({ prix_1: 419 })));
    expect(beforeunloadBloque()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Aller aux clients' }));
    const fenetre = await screen.findByRole('dialog', { name: 'Enregistrement en cours' });
    expect(window.location.pathname).toBe(CHEMIN);
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Quitter sans attendre' }));
    expect(await screen.findByRole('heading', { name: 'Page clients' })).toBeInTheDocument();
    await act(async () => { envoi.reject(Object.assign(new Error('Base indisponible'), { status: 500 })); });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('iPhone 13 non enregistré')));
  });
});

// ─── Grille « Réparation iPhone » ────────────────────
describe('TarifsReparationPage : envoi en cours', () => {
  it('fermeture de l’onglet retenue tant que le prix n’est pas confirmé', async () => {
    localStorage.setItem('klikphone_admin', 'true');
    const ligne = { id: 4, modele: 'iPhone X/XS', ordre: 3, batterie: 69, ecran_generique: 89, prix_maj_le: '2026-10-01T10:00:00' };
    apiMock.getTarifsReparation.mockResolvedValue([ligne]);
    const envoi = differe();
    apiMock.updateTarifReparation.mockImplementation(() => envoi.promise);
    render(<MemoryRouter><TarifsReparationPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Batterie de iPhone X\/XS : 69 euros/ }));
    const champ = screen.getByRole('textbox', { name: /Batterie de iPhone X\/XS/ });
    fireEvent.change(champ, { target: { value: '74' } });
    fireEvent.keyDown(champ, { key: 'Enter' });
    expect(await screen.findByRole('button', { name: /Batterie de iPhone X\/XS : 74 euros/ })).toBeInTheDocument();
    expect(beforeunloadBloque()).toBe(true);
    await act(async () => { envoi.resolve({ ...ligne, batterie: 74 }); });
    await waitFor(() => expect(beforeunloadBloque()).toBe(false));
  });
});

// ─── Fiche : relecture après un changement de statut ───
describe('Fiche : commandes et notes relues après un statut', () => {
  const TICKET = {
    id: 42, ticket_code: 'KP-000042', statut: 'En attente de diagnostic', client_id: 5,
    client_nom: 'Martin', client_prenom: 'Léa', client_tel: '0612345678', client_email: '',
    categorie: 'Smartphone', marque: 'Apple', modele: 'iPhone 13', panne: 'Écran cassé',
    date_depot: '2026-10-10T09:00:00', paye: 0, acompte: 0, devis_estime: 89, historique: '',
    montants: { total: 89, acompte: 0, reste: 89, paye: false, lignes: [{ label: 'Écran', prix: 89 }], source: 'devis_estime' },
  };
  const note = (id, contenu) => ({ id, contenu, auteur: 'Test', type_note: 'note', date: '2026-10-20T10:00:00' });

  it('deux statuts coup sur coup : la réponse tardive de la 1re relecture n’écrase pas la 2e', async () => {
    let courant = { ...TICKET };
    apiMock.getTicket.mockImplementation(async () => ({ ...courant }));
    apiMock.getMessageTemplates.mockResolvedValue([]);
    apiMock.markTicketRead.mockResolvedValue({ ok: true });
    apiMock.changeStatus.mockImplementation(async (id, statut) => {
      courant = { ...courant, statut };
      return { ok: true, proposer_message: false, ticket: { ...courant } };
    });
    render(
      <MemoryRouter initialEntries={['/accueil/ticket/42']}>
        <Routes><Route path="/accueil/ticket/:id" element={<TicketDetailPage />} /></Routes>
      </MemoryRouter>,
    );
    const select = await screen.findByRole('combobox', { name: 'Changer le statut' });
    await waitFor(() => expect(apiMock.getNotes).toHaveBeenCalledTimes(1)); // chargement de la fiche

    const lente = differe();
    const rapide = differe();
    apiMock.getNotes.mockImplementationOnce(() => lente.promise).mockImplementationOnce(() => rapide.promise);
    fireEvent.change(select, { target: { value: 'Pièce reçue' } });
    await waitFor(() => expect(apiMock.getNotes).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(select).not.toBeDisabled());
    fireEvent.change(screen.getByRole('combobox', { name: 'Changer le statut' }), { target: { value: 'En cours de réparation' } });
    await waitFor(() => expect(apiMock.getNotes).toHaveBeenCalledTimes(3));
    expect(apiMock.getTicket).toHaveBeenCalledTimes(1); // le ticket renvoyé suffit, pas de relecture complète

    await act(async () => { rapide.resolve([note(2, 'Note de la seconde relecture')]); });
    expect(await screen.findByText('Note de la seconde relecture')).toBeInTheDocument();
    await act(async () => { lente.resolve([note(1, 'Note périmée de la première relecture')]); });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Note périmée de la première relecture')).not.toBeInTheDocument();
    expect(screen.getByText('Note de la seconde relecture')).toBeInTheDocument();
  });
});
