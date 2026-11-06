/**
 * « Recherche fournisseurs » (onglet Tarifs) : Mobilax et Utopya côte à côte pour chaque pièce d'un modèle
 * (HT du gérant, prix client, en stock / rupture, fiche, retenu), catalogue brut de chaque fournisseur (gérant),
 * filtre par type de pièce, adresse ?q=&type=, personnel sans HT ni catalogue, exemples quand rien n'est saisi.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { configure } from '@testing-library/react';

vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 4_000 });

const { auth, toast, apiMock } = vi.hoisted(() => {
  const base = { background: (fn) => fn() };
  const apiMock = new Proxy(base, {
    get(target, cle) {
      if (!(cle in target)) target[cle] = vi.fn().mockResolvedValue([]);
      return target[cle];
    },
  });
  return {
    auth: { user: { target: 'accueil', utilisateur: 'Nour', role: 'admin' }, logout: () => {} },
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), important: vi.fn() },
    apiMock,
  };
});

vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../components/Toast', () => ({ useToast: () => toast, ToastProvider: ({ children }) => children }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));

import RechercheFournisseursPage, { TYPES_RECHERCHE } from '../pages/RechercheFournisseursPage';

const PRIX = {
  Mobilax: { ht: 101, client: 249, calcul: { ht: 101, tva: 1.2, marge: 60, brut: 181.2, arrondi: 249 }, ref: 'MX1', url: null, designation: 'Ecran Tactile Original Google Pixel 6', en_stock: true, vu_le: '2026-11-06T01:26:30', prix_maj_le: '2026-11-06T01:26:30', connu: true },
  Utopya: { ht: 97, client: 239, calcul: { ht: 97, tva: 1.2, marge: 60, brut: 176.4, arrondi: 239 }, ref: '420921', url: 'https://www.utopya.fr/ecran-complet-google-pixel-6.html', designation: 'Ecran Complet Google Pixel 6', en_stock: false, vu_le: '2026-11-05T23:15:01', prix_maj_le: '2026-11-05T23:15:01', connu: true },
};
const piece = (over = {}) => ({
  table: 'tarifs', id: 1, cle: 'tarifs:1', marque: 'Google', modele: 'Pixel 6', type_piece: 'Ecran', qualite: 'Original', categorie: 'standard',
  prix_fournisseur_ht: 101, prix_client: 249, calcul: { ht: 101, tva: 1.2, marge: 60, brut: 181.2, arrondi: 249 },
  prix_maj_le: '2026-11-06T01:26:30', prix_source: 'import', age_jours: 0, fraicheur: 'ok', estime: false, verrou: false, en_stock: null,
  ref_fournisseur: 'MX1', fournisseur: 'Mobilax', url_fournisseur: null, a_renseigner: false, liens: {}, prix_fournisseurs: PRIX, ...over,
});
const REPONSE = (over = {}) => ({
  q: 'pixel 6', admin: true, preference: 'Mobilax',
  modeles: [{
    marque: 'Google', modele: 'Pixel 6', categorie_apple: null,
    pieces: [
      piece(),
      piece({ id: 2, cle: 'tarifs:2', type_piece: 'Batterie', qualite: null, prix_fournisseur_ht: 0, prix_client: 0, calcul: null, prix_source: 'a_renseigner',
        prix_maj_le: null, fraicheur: null, a_renseigner: true, fournisseur: null, prix_fournisseurs: {} }),
    ],
  }],
  produits: {
    Mobilax: [
      { fournisseur: 'Mobilax', ref: 'MX9', nom: 'Ecran Tactile Original Refurb Google Pixel 6 Noir', prix_ht: 55, client: 129, en_stock: true, url: null,
        marque: 'Google', modele: 'Google Pixel 6', type_piece: 'Ecran', qualite: 'Reconditionnee', tarif_cle: null, vu_le: '2026-11-06T01:26:30' },
      { fournisseur: 'Mobilax', ref: 'MX1', nom: 'Ecran Tactile Original Google Pixel 6 G949-00175-01 Noir', prix_ht: 101, client: 249, en_stock: true, url: null,
        marque: 'Google', modele: 'Google Pixel 6', type_piece: 'Ecran', qualite: 'Original', tarif_cle: 'tarifs:1', vu_le: '2026-11-06T01:26:30' },
    ],
    Utopya: [
      { fournisseur: 'Utopya', ref: 'GPIX6-EC', nom: 'Ecran Complet Google Pixel 6 (ReLife)', prix_ht: 54.91, client: 129, en_stock: true, url: 'https://www.utopya.fr/relife.html',
        marque: 'Google', modele: 'Pixel 6', type_piece: 'Ecran', qualite: 'Compatible', tarif_cle: null, vu_le: '2026-11-05T23:15:01' },
    ],
  },
  nb_produits: 3, tronque: false, ...over,
});

function Adresse() {
  const { pathname, search } = useLocation();
  return <span data-testid="adresse">{pathname}{search}</span>;
}
const page = (url = '/accueil/tarifs-fournisseurs') => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes><Route path="/accueil/tarifs-fournisseurs" element={<><RechercheFournisseursPage /><Adresse /></>} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  for (const [k, fn] of Object.entries(apiMock)) {
    if (k !== 'background' && typeof fn?.mockReset === 'function') fn.mockReset().mockResolvedValue([]);
  }
  toast.success.mockReset(); toast.error.mockReset();
});
afterEach(() => cleanup());

describe('Recherche fournisseurs', () => {
  it('six types de pièce, « Toutes les pièces » en tête', () => {
    expect(TYPES_RECHERCHE.map((t) => t.label)).toEqual(['Toutes les pièces', 'Écran', 'Batterie', 'Connecteur', 'Vitre arrière', 'Bouton power']);
  });

  it('gérant : ?q=pixel 6 → le modèle, Mobilax et Utopya côte à côte (HT, prix client, stock, fiche, retenu), le coût retenu, les catalogues', async () => {
    apiMock.rechercherFournisseurs.mockResolvedValue(REPONSE());
    page('/accueil/tarifs-fournisseurs?q=pixel%206');
    expect(screen.getByRole('searchbox', { name: 'Modèle, pièce ou référence' })).toHaveValue('pixel 6');
    await waitFor(() => expect(apiMock.rechercherFournisseurs).toHaveBeenCalledWith({ q: 'pixel 6', type: undefined }));
    expect(await screen.findByRole('heading', { name: 'Google Pixel 6' })).toBeInTheDocument();
    expect(screen.getByText(/1 modèle, 2 pièces — fournisseur retenu pour la grille :/)).toHaveTextContent('Mobilax');
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Pièce', 'Mobilax', 'Utopya', 'Retenu']);
    expect(within(table).getAllByText('101,00 € HT')).toHaveLength(2);                 // cellule Mobilax + coût retenu
    expect(within(table).getByText('97,00 € HT')).toBeInTheDocument();
    expect(within(table).getByText('En stock')).toBeInTheDocument();                      // Mobilax
    expect(within(table).getByText('Rupture')).toBeInTheDocument();                       // Utopya n'a plus l'écran officiel
    expect(within(table).getByText('retenu')).toBeInTheDocument();                        // coût en vigueur : Mobilax
    expect(within(table).getByText('Utopya (nouvel onglet)').closest('a')).toHaveAttribute('href', 'https://www.utopya.fr/ecran-complet-google-pixel-6.html');
    expect(within(table).getByText('réf. 420921')).toBeInTheDocument();
    expect(within(table).getByText('249 €')).toBeInTheDocument();                         // prix client retenu
    expect(within(table).getByText('Prix à renseigner')).toBeInTheDocument();             // batterie sans prix
    // Catalogues bruts : le Refurb Mobilax est un reconditionné hors grille, l'officiel est dans la grille
    expect(screen.getByRole('heading', { name: 'Catalogues fournisseurs' })).toBeInTheDocument();
    const mob = screen.getByRole('region', { name: 'Catalogue Mobilax' });
    expect(within(mob).getByText('Ecran Tactile Original Refurb Google Pixel 6 Noir')).toBeInTheDocument();
    expect(within(mob).getByText('Reconditionnee')).toBeInTheDocument();
    expect(within(mob).getByText('55,00 € HT')).toBeInTheDocument();
    expect(within(mob).getAllByText('hors grille')).toHaveLength(1);
    expect(within(mob).getAllByText('dans la grille')).toHaveLength(1);
    const uto = screen.getByRole('region', { name: 'Catalogue Utopya' });
    expect(within(uto).getByText('Ecran Complet Google Pixel 6 (ReLife)')).toBeInTheDocument();
    expect(within(uto).getByText('Compatible')).toBeInTheDocument();
    expect(within(uto).getByText('→ client 129 €')).toBeInTheDocument();
    // Un seul catalogue affiché
    fireEvent.click(screen.getByRole('button', { name: 'Utopya' }));
    expect(screen.queryByRole('region', { name: 'Catalogue Mobilax' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Catalogue Utopya' })).toBeInTheDocument();
  });

  it('filtre par type : ?type=ecran dans l’adresse, nouvelle requête', async () => {
    apiMock.rechercherFournisseurs.mockResolvedValue(REPONSE());
    page('/accueil/tarifs-fournisseurs?q=pixel%206');
    await screen.findByRole('heading', { name: 'Google Pixel 6' });
    const groupe = screen.getByRole('group', { name: 'Type de pièce' });
    expect(within(groupe).getByRole('button', { name: 'Toutes les pièces' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(groupe).getByRole('button', { name: 'Écran' }));
    await waitFor(() => expect(apiMock.rechercherFournisseurs).toHaveBeenLastCalledWith({ q: 'pixel 6', type: 'ecran' }));
    expect(screen.getByTestId('adresse')).toHaveTextContent('/accueil/tarifs-fournisseurs?q=pixel+6&type=ecran');
    expect(within(groupe).getByRole('button', { name: 'Écran' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('personnel : prix client de chaque fournisseur, jamais de HT ni de catalogue, invitation au code admin', async () => {
    const sansHt = REPONSE({ admin: false });
    sansHt.modeles[0].pieces[0].prix_fournisseur_ht = null;
    sansHt.modeles[0].pieces[0].prix_fournisseurs = {
      Mobilax: { ...PRIX.Mobilax, ht: null, calcul: null }, Utopya: { ...PRIX.Utopya, ht: null, calcul: null },
    };
    sansHt.produits = { Mobilax: [], Utopya: [] };
    sansHt.nb_produits = 0;
    apiMock.rechercherFournisseurs.mockResolvedValue(sansHt);
    page('/accueil/tarifs-fournisseurs?q=pixel%206');
    await screen.findByRole('heading', { name: 'Google Pixel 6' });
    expect(screen.queryByText(/€ HT/)).not.toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('239 €')).toBeInTheDocument();                         // prix client avec Utopya
    expect(within(table).getByText('Rupture')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Catalogues fournisseurs' })).not.toBeInTheDocument();
    expect(screen.getByText('Prix d’achat et catalogues fournisseurs : réservés au gérant')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saisir le code admin' })).toBeInTheDocument();
  });

  it('sans saisie : exemples cliquables ; saisie → adresse et requête après une courte pause ; rien trouvé', async () => {
    apiMock.rechercherFournisseurs.mockResolvedValue({ q: 'Pixel 6', admin: true, preference: 'Mobilax', modeles: [], produits: { Mobilax: [], Utopya: [] }, nb_produits: 0, tronque: false });
    page();
    expect(apiMock.rechercherFournisseurs).not.toHaveBeenCalled();
    expect(screen.getByText('Essayez :')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pixel 6' }));
    expect(screen.getByRole('searchbox', { name: 'Modèle, pièce ou référence' })).toHaveValue('Pixel 6');
    await waitFor(() => expect(apiMock.rechercherFournisseurs).toHaveBeenCalledWith({ q: 'Pixel 6', type: undefined }));
    expect(screen.getByTestId('adresse')).toHaveTextContent('/accueil/tarifs-fournisseurs?q=Pixel+6');
    expect(await screen.findByText('Rien dans la grille pour « Pixel 6 »')).toBeInTheDocument();
    expect(screen.queryByText('Essayez :')).not.toBeInTheDocument();
  });

  it('erreur de recherche affichée', async () => {
    apiMock.rechercherFournisseurs.mockRejectedValue(new Error('Serveur injoignable'));
    page('/accueil/tarifs-fournisseurs?q=pixel%206');
    expect(await screen.findByRole('alert')).toHaveTextContent('Serveur injoignable');
  });
});
