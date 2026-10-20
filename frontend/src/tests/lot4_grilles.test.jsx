/**
 * Lot 4 : grilles de prix, ventes iPhone / smartphones, catalogue téléphones.
 * - Grille « Réparation iPhone » : la cellule ouverte sélectionne le prix (la frappe le remplace),
 *   saisie non entière refusée (plus de troncature), grosse variation confirmée avant publication ;
 * - Vente iPhones / smartphones : modifications non enregistrées → avertissement avant de quitter
 *   (navigation interne et fermeture de l'onglet) ;
 * - Tarifs / vente téléphones : grade « Neuf » déduit de type_produit 'neuf', pagination lisible à 390 px.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { BrowserRouter, MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';

const { toast, apiMock } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), important: vi.fn() },
  apiMock: {
    get: vi.fn(),
    patch: vi.fn(),
    getConfig: vi.fn(),
    setParam: vi.fn(),
    getReglesPrix: vi.fn(),
    getTarifsReparation: vi.fn(),
    updateTarifReparation: vi.fn(),
    getSmartphonesTarifs: vi.fn(),
    updateSmartphoneTarif: vi.fn(),
    getTelephoneStats: vi.fn(),
    getTelephoneMarques: vi.fn(),
    getTelephonesCatalogue: vi.fn(),
    clearAdminToken: vi.fn(),
    verifyAdmin: vi.fn(),
  },
}));

vi.mock('../components/Toast', () => ({ useToast: () => toast }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { target: 'accueil', utilisateur: 'Test' } }) }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));

import { clearCache } from '../hooks/useApi';
import TarifsReparationPage from '../pages/TarifsReparationPage';
import AdminTarifsIphonePage from '../pages/AdminTarifsIphonePage';
import AdminTarifsSmartphonesPage from '../pages/AdminTarifsSmartphonesPage';
import TarifsTelephonesPage from '../pages/TarifsTelephonesPage';
import TelephonesVentePage from '../pages/TelephonesVentePage';

beforeEach(() => {
  vi.clearAllMocks();
  clearCache();
  localStorage.clear();
  apiMock.getConfig.mockResolvedValue([]);
  apiMock.getReglesPrix.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

// ─── Grille « Réparation iPhone » ────────────────────
describe('TarifsReparationPage : saisie d’un prix', () => {
  const GRILLE = [
    { id: 4, modele: 'iPhone X/XS', ordre: 3, batterie: 69, ecran_generique: 89, prix_maj_le: '2026-10-01T10:00:00' },
  ];

  beforeEach(() => {
    localStorage.setItem('klikphone_admin', 'true');
    apiMock.getTarifsReparation.mockResolvedValue(GRILLE);
    apiMock.updateTarifReparation.mockImplementation(async (id, data) => ({ ...GRILLE[0], ...data }));
  });

  const ouvrir = async () => {
    render(<TarifsReparationPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Batterie de iPhone X\/XS : 69 euros/ }));
    return screen.getByRole('textbox', { name: /Batterie de iPhone X\/XS/ });
  };

  it('la cellule ouverte sélectionne le prix : la frappe le remplace', async () => {
    const champ = await ouvrir();
    expect(champ).toHaveFocus();
    expect(champ.selectionStart).toBe(0);
    expect(champ.selectionEnd).toBe(2);
  });

  it('« 79,90 » est refusé (plus de troncature en 79)', async () => {
    const champ = await ouvrir();
    fireEvent.change(champ, { target: { value: '79,90' } });
    fireEvent.keyDown(champ, { key: 'Enter' });
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/nombre entier/));
    expect(apiMock.updateTarifReparation).not.toHaveBeenCalled();
  });

  it('grosse variation (69 → 6974) : confirmation, rien n’est publié si elle est refusée', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const champ = await ouvrir();
    fireEvent.change(champ, { target: { value: '6974' } });
    fireEvent.keyDown(champ, { key: 'Enter' });
    fireEvent.blur(champ);
    expect(confirmer).toHaveBeenCalledTimes(1);
    expect(confirmer.mock.calls[0][0]).toMatch(/69 € à 6974 €/);
    expect(apiMock.updateTarifReparation).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: /Batterie de iPhone X\/XS : 69 euros/ })).toBeInTheDocument();
  });

  it('grosse variation confirmée : enregistrée une seule fois', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const champ = await ouvrir();
    fireEvent.change(champ, { target: { value: '149' } });
    fireEvent.keyDown(champ, { key: 'Enter' });
    fireEvent.blur(champ);
    await waitFor(() => expect(apiMock.updateTarifReparation).toHaveBeenCalledWith(4, { batterie: 149 }));
    expect(apiMock.updateTarifReparation).toHaveBeenCalledTimes(1);
  });

  it('petite variation (69 → 74) : pas de confirmation', async () => {
    const confirmer = vi.spyOn(window, 'confirm');
    const champ = await ouvrir();
    fireEvent.change(champ, { target: { value: '74' } });
    fireEvent.keyDown(champ, { key: 'Enter' });
    await waitFor(() => expect(apiMock.updateTarifReparation).toHaveBeenCalledWith(4, { batterie: 74 }));
    expect(confirmer).not.toHaveBeenCalled();
  });
});

// ─── Avertissement avant de quitter ──────────────────
// setup.js remplace window.location par un objet figé : ici, une location qui suit l'URL du document
// (history.pushState de jsdom la met à jour), comme dans un navigateur sous <BrowserRouter>.
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

// Barre latérale simulée : un bouton qui appelle navigate(), comme Navbar.handleNav
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

describe('Vente smartphones : modifications non enregistrées', () => {
  const TELEPHONES = [
    { id: 1, marque: 'Samsung', modele: 'Galaxy A16', slug: 'samsung-galaxy-a16', stockage_1: '128 Go', prix_1: 189, actif: true, prix_maj_le: '2026-10-01T10:00:00' },
  ];
  const CHEMIN = '/accueil/admin/tarifs-smartphones';

  beforeEach(() => {
    apiMock.getSmartphonesTarifs.mockResolvedValue(TELEPHONES);
    apiMock.updateSmartphoneTarif.mockResolvedValue({ ok: true });
  });

  const modifier = async () => {
    appli(CHEMIN, <AdminTarifsSmartphonesPage />);
    const prix = await screen.findByRole('spinbutton', { name: 'Prix 1 de Galaxy A16, en euros' });
    fireEvent.change(prix, { target: { value: '199' } });
  };

  it('sans modification : la navigation passe', async () => {
    appli(CHEMIN, <AdminTarifsSmartphonesPage />);
    await screen.findByRole('spinbutton', { name: 'Prix 1 de Galaxy A16, en euros' });
    fireEvent.click(screen.getByRole('button', { name: 'Aller aux clients' }));
    expect(await screen.findByRole('heading', { name: 'Page clients' })).toBeInTheDocument();
  });

  it('navigation interne retenue, « Quitter sans enregistrer » part sans enregistrer', async () => {
    await modifier();
    fireEvent.click(screen.getByRole('button', { name: 'Aller aux clients' }));
    const fenetre = await screen.findByRole('dialog', { name: 'Modifications non enregistrées' });
    expect(window.location.pathname).toBe(CHEMIN);
    expect(screen.queryByRole('heading', { name: 'Page clients' })).not.toBeInTheDocument();
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Quitter sans enregistrer' }));
    expect(await screen.findByRole('heading', { name: 'Page clients' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/accueil/clients');
    expect(apiMock.updateSmartphoneTarif).not.toHaveBeenCalled();
  });

  it('« Enregistrer et quitter » enregistre puis part ; « Rester » garde la saisie', async () => {
    await modifier();
    fireEvent.click(screen.getByRole('button', { name: 'Aller aux clients' }));
    let fenetre = await screen.findByRole('dialog', { name: 'Modifications non enregistrées' });
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Rester sur la page' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Prix 1 de Galaxy A16, en euros' })).toHaveValue(199);
    fireEvent.click(screen.getByRole('button', { name: 'Aller aux clients' }));
    fenetre = await screen.findByRole('dialog', { name: 'Modifications non enregistrées' });
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Enregistrer et quitter' }));
    await waitFor(() => expect(apiMock.updateSmartphoneTarif).toHaveBeenCalledWith(1, expect.objectContaining({ prix_1: 199 })));
    expect(await screen.findByRole('heading', { name: 'Page clients' })).toBeInTheDocument();
  });

  it('fermeture ou rechargement de l’onglet : avertissement du navigateur', async () => {
    await modifier();
    const evt = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);
  });
});

describe('Vente iPhones : modifications non enregistrées', () => {
  const IPHONES = [
    { id: 7, slug: 'iphone-13', modele: 'iPhone 13', ordre: 1, stockage_1: '128 Go', prix_1: 399, stock_1: 3, actif: true, condition: 'Reconditionné Premium', prix_maj_le: '2026-10-01T10:00:00' },
  ];
  const CHEMIN = '/accueil/admin/tarifs-iphone';

  beforeEach(() => {
    apiMock.get.mockResolvedValue(IPHONES);
    apiMock.patch.mockResolvedValue({ ok: true });
  });

  it('changer un prix puis cliquer dans la barre latérale : la page demande quoi faire', async () => {
    appli(CHEMIN, <AdminTarifsIphonePage />);
    const prix = await screen.findByRole('spinbutton', { name: 'Prix 1 de iPhone 13, en euros' });
    fireEvent.change(prix, { target: { value: '419' } });
    expect(screen.getByText('1 modification non sauvegardée')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Aller aux clients' }));
    const fenetre = await screen.findByRole('dialog', { name: 'Modifications non enregistrées' });
    expect(window.location.pathname).toBe(CHEMIN);
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Enregistrer et quitter' }));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith('/api/iphone-tarifs/7', expect.objectContaining({ prix_1: 419 })));
    expect(await screen.findByRole('heading', { name: 'Page clients' })).toBeInTheDocument();
  });
});

// ─── Catalogue téléphones ───────────────────────────
const catalogue = (n = 120) => ({
  items: [{ id: 1, marque: 'Samsung', modele: 'Galaxy S23', stockage: '128 Go', grade: null, type_produit: 'neuf', prix_vente: 499, en_stock: true }],
  total: n, page: 1, limit: 24, total_pages: Math.ceil(n / 24),
});

describe('Tarifs téléphones', () => {
  beforeEach(() => {
    apiMock.getTelephoneStats.mockResolvedValue({ total: 120, neufs: 60, reconditionnes: 60, nb_marques: 3, prix_min: 99, prix_max: 999 });
    apiMock.getTelephoneMarques.mockResolvedValue([{ marque: 'Samsung', nb_modeles: 120, nb_en_stock: 120 }]);
    apiMock.getTelephonesCatalogue.mockResolvedValue(catalogue());
  });

  it('type_produit « neuf » sans grade : badge « NEUF »', async () => {
    render(<MemoryRouter><TarifsTelephonesPage /></MemoryRouter>);
    expect(await screen.findByText('NEUF')).toBeInTheDocument();
  });

  it.each([
    ['TarifsTelephonesPage', TarifsTelephonesPage],
    ['TelephonesVentePage', TelephonesVentePage],
  ])('%s : pagination « Page X / N » sur téléphone, flèches de 44 px, numéros à partir de sm', async (_nom, Page) => {
    render(<MemoryRouter><Page /></MemoryRouter>);
    const nav = await screen.findByRole('navigation', { name: 'Pagination' });
    expect(nav.className).toMatch(/flex-wrap/);
    expect(nav.className).toMatch(/max-w-full/);
    const compact = within(nav).getByText('Page 1 / 5');
    expect(compact.className).toMatch(/sm:hidden/);
    for (const nom of ['Page précédente', 'Page suivante']) {
      expect(within(nav).getByRole('button', { name: nom }).className).toMatch(/\bw-11\b.*\bh-11\b/);
    }
    const numero = within(nav).getByRole('button', { name: 'Page 2' });
    expect(`${numero.className} ${numero.parentElement.className}`).toMatch(/\bhidden\b/);
  });
});
