/**
 * « Réparation smartphones » (grille fournisseur par marque → modèle, méthode de calcul) :
 * - menu : entrée « Réparation smartphones » sous « Réparation iPhone », ventes renommées ;
 * - page : bandeau « Où sont les prix ? », encadré « Méthode de calcul » (règles lues), marques → modèles,
 *   tableau d'une ligne par pièce (HT, calcul « 42,00 × 1,2 + 60 = 110,40 → 119 € », prix client, fraîcheur),
 *   « Mettre à jour le HT » : aperçu AVANT validation puis PATCH /api/tarifs/{id}/prix (source, référence, URL) ;
 * - liens profonds Utopya / Mobilax construits côté client (nouvel onglet, rel=noopener), jamais de requête ;
 * - lecture seule hors admin (aucun HT), prix d'achat masqués sans le code admin, pièces courantes d'un
 *   modèle vide, ?q= qui ouvre le modèle unique, iPad / MacBook par la route dédiée ;
 * - bandeau d'aide de « Réparation iPhone ».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { configure } from '@testing-library/react';

vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 4_000 });

const { auth, toast, apiMock } = vi.hoisted(() => {
  const base = { background: (fn) => fn() };
  // Toute méthode non préparée par un test répond une liste vide
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

import { clearCache } from '../hooks/useApi';
import TarifsPage, { VUES_MODELES, chercherModeles, filtrerModeles, phraseMethode, trierModeles } from '../pages/TarifsPage';
import TarifsReparationPage from '../pages/TarifsReparationPage';
import Navbar from '../components/Navbar';
import {
  detailCalcul, lienMobilax, lienUtopya, liensFournisseur, prixARenseigner, slugModele, texteCalcul,
} from '../components/PieceFournisseurRow';
import { REGLES_DEFAUT, euros } from '../components/HistoriquePrix';

// Montants affichés par euros() : espace insécable avant le symbole (noms accessibles, textes exacts, toasts) ;
// getByText normalise les blancs, un espace ordinaire y suffit
const E = (n) => euros(n);

// ─── Données (contrat B1) ────────────────────────
const FRAIS = { prix_maj_le: '2026-10-01T10:00:00', prix_source: 'import', age_jours: 16, fraicheur: 'ok', estime: false };
const piece = (over = {}) => ({
  table: 'tarifs', id: 1, cle: 'tarifs:1', marque: 'Samsung', modele: 'Galaxy A54', type_piece: 'Ecran', qualite: 'Soft OLED',
  categorie: 'standard', nom_fournisseur: null, prix_fournisseur_ht: 42, prix_client: 119,
  calcul: { ht: 42, tva: 1.2, marge: 60, brut: 110.4, arrondi: 119 }, ...FRAIS, verrou: false, en_stock: true,
  ref_fournisseur: null, fournisseur: 'Mobilax', url_fournisseur: null, a_renseigner: false,
  liens: { utopya: 'https://www.utopya.fr/catalogsearch/result/?q=Samsung+Galaxy+A54+ecran', mobilax: 'https://www.mobilax.fr/pieces-detachees/telephonie/samsung/galaxy-a/galaxy-a54' },
  ...over,
});
const LIENS_A54 = {
  utopya: 'https://www.utopya.fr/catalogsearch/result/?q=Samsung+Galaxy+A54',
  mobilax: 'https://www.mobilax.fr/pieces-detachees/telephonie/samsung/galaxy-a/galaxy-a54',
};
const modele = (over = {}) => ({
  marque: 'Samsung', modele: 'Galaxy A54', categorie: 'Smartphone', au_catalogue: true, modele_trouve: true, admin: true,
  pieces: [
    piece(),
    piece({ id: 2, cle: 'tarifs:2', type_piece: 'Batterie', qualite: null, prix_fournisseur_ht: 11, prix_client: 79,
      calcul: { ht: 11, tva: 1.2, marge: 60, brut: 73.2, arrondi: 79 }, verrou: true, prix_source: 'manuel' }),
    piece({ id: 3, cle: 'tarifs:3', type_piece: 'Connecteur de charge', qualite: null, prix_fournisseur_ht: 0, prix_client: 0,
      calcul: null, prix_source: 'a_renseigner', prix_maj_le: null, age_jours: null, fraicheur: null, a_renseigner: true }),
  ],
  liens: LIENS_A54, noms: [],
  ...over,
});
const MARQUES = [
  { marque: 'Xiaomi', marque_c: 'xiaomi', nb_modeles: 1, modeles: [
    { modele: 'Redmi Note 12', categorie: 'Smartphone', annee: 2023, au_catalogue: true, nb_pieces: 2, nb_sans_prix: 1, plus_vieux_jours: 200, fraicheur: 'perime', noms: [] },
  ] },
  { marque: 'Samsung', marque_c: 'samsung', nb_modeles: 2, modeles: [
    { modele: 'Galaxy A54', categorie: 'Smartphone', annee: 2023, au_catalogue: true, nb_pieces: 3, nb_sans_prix: 1, plus_vieux_jours: 16, fraicheur: 'ok', noms: [] },
    { modele: 'Galaxy A16', categorie: 'Smartphone', annee: 2024, au_catalogue: true, nb_pieces: 0, nb_sans_prix: 0, plus_vieux_jours: null, fraicheur: null, noms: [] },
  ] },
  { marque: 'Apple', marque_c: 'apple', nb_modeles: 1, modeles: [
    { modele: 'iPad 9', categorie: 'Tablette', annee: 2021, au_catalogue: true, nb_pieces: 2, nb_sans_prix: 0, plus_vieux_jours: 30, fraicheur: 'ok', noms: [] },
  ] },
];
const IPAD = {
  marque: 'Apple', modele: 'iPad 9', categorie: 'Tablette', au_catalogue: true, modele_trouve: true, admin: true, noms: [],
  liens: { utopya: 'https://www.utopya.fr/catalogsearch/result/?q=Apple+iPad+9', mobilax: 'https://www.mobilax.fr/recherche?q=iPad+9' },
  pieces: [
    { table: 'tarifs_apple_devices', id: null, device_id: 11, piece: 'ecran', cle: 'tarifs_apple_devices:11:ecran', marque: 'Apple', modele: 'iPad 9',
      type_piece: 'Écran', qualite: null, categorie: 'ipad', prix_fournisseur_ht: 100, prix_client: 239,
      calcul: { ht: 100, tva: 1.2, marge: 110, brut: 230, arrondi: 239 }, ...FRAIS, verrou: false, en_stock: null,
      ref_fournisseur: null, fournisseur: 'Mobilax', url_fournisseur: null, a_renseigner: false, liens: {} },
    { table: 'tarifs_apple_devices', id: null, device_id: 11, piece: 'batterie', cle: 'tarifs_apple_devices:11:batterie', marque: 'Apple', modele: 'iPad 9',
      type_piece: 'Batterie', qualite: null, categorie: 'ipad', prix_fournisseur_ht: 30, prix_client: 149,
      calcul: { ht: 30, tva: 1.2, marge: 110, brut: 146, arrondi: 149 }, ...FRAIS, verrou: false, en_stock: null,
      ref_fournisseur: null, fournisseur: 'Mobilax', url_fournisseur: null, a_renseigner: false, liens: {} },
  ],
};
const SANTE = { total: 1200, estimes: 0, a_revoir: 12, perimes: 3, propositions_en_attente: 0, marges_faibles: 0, seuils: { jours_a_revoir: 90, jours_perime: 180, seuil_marge_alerte: 40 } };

const etat = { modeles: {} };
// GET /api/tarifs/methode-calcul pour le personnel (prix.methode_calcul(admin=False))
const METHODE_PERSONNEL = {
  admin: false, regles: null, exemple: null,
  texte: 'Prix client = arrondi au 9 supérieur de (prix fournisseur HT × 1,2 + marge selon la pièce) · le montant des marges est réservé au gérant (code admin)',
};

function resetApi() {
  for (const [k, fn] of Object.entries(apiMock)) {
    if (k !== 'background' && typeof fn?.mockReset === 'function') fn.mockReset().mockResolvedValue([]);
  }
}

function Adresse() {
  const l = useLocation();
  return <output data-testid="adresse">{`${l.pathname}${l.search}`}</output>;
}

const page = (url = '/accueil/tarifs') => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes><Route path="*" element={<><TarifsPage /><Adresse /></>} /></Routes>
  </MemoryRouter>,
);
const texteExact = (texte) => (_, el) => el.textContent === texte && !['SCRIPT', 'STYLE'].includes(el.tagName)
  && [...el.children].every((c) => c.textContent !== texte);

beforeEach(() => {
  clearCache();
  resetApi();
  vi.clearAllMocks();
  localStorage.clear();
  etat.modeles = { 'Samsung::Galaxy A54': modele(), 'Apple::iPad 9': IPAD };
  apiMock.getReparationSmartphonesMarques.mockResolvedValue(MARQUES);
  apiMock.getReparationSmartphonesModele.mockImplementation(async ({ marque, modele: m }) => (
    etat.modeles[`${marque}::${m}`] || { marque, modele: m, categorie: null, au_catalogue: true, modele_trouve: true, admin: true, pieces: [], liens: liensFournisseur({ marque, modele: m }), noms: [] }
  ));
  apiMock.getSantePrix.mockResolvedValue(SANTE);
  apiMock.getReglesPrix.mockResolvedValue({ ...REGLES_DEFAUT });
  apiMock.getConfig.mockResolvedValue({});
  apiMock.hasAdminToken.mockReturnValue(false);
});

afterEach(() => cleanup());

// ─── Calcul et liens ─────────────────────────────
describe('méthode de calcul et liens fournisseurs', () => {
  it('détail du calcul identique au serveur : « 42,00 × 1,2 + 60 = 110,40 → 119 € »', () => {
    expect(detailCalcul(42, 'Ecran', 'standard', null)).toEqual({ ht: 42, tva: 1.2, marge: 60, brut: 110.4, arrondi: 119 });
    expect(texteCalcul(detailCalcul(42, 'Ecran', 'standard', null))).toBe('42,00 × 1,2 + 60 = 110,40 → 119 €');
    expect(texteCalcul(detailCalcul(65, 'Ecran', 'haut_de_gamme', null))).toBe('65,00 × 1,2 + 70 = 148,00 → 149 €');
    expect(texteCalcul(detailCalcul(11, 'Batterie', 'standard', null))).toBe('11,00 × 1,2 + 60 = 73,20 → 79 €');
    expect(texteCalcul(detailCalcul(100, 'Écran', 'ipad', null))).toBe('100,00 × 1,2 + 110 = 230,00 → 239 €');
    expect(detailCalcul(0, 'Ecran', 'standard', null)).toBeNull();
    expect(detailCalcul(null, 'Ecran', 'standard', null)).toBeNull();
    // Règles du gérant : marge écran standard 65 €
    expect(texteCalcul(detailCalcul(42, 'Ecran', 'standard', { ...REGLES_DEFAUT, ecran: { ...REGLES_DEFAUT.ecran, standard: 65 } }))).toBe('42,00 × 1,2 + 65 = 115,40 → 119 €');
  });

  it('phrase de la méthode lisible en 5 secondes, valeurs des règles', () => {
    expect(phraseMethode(null)).toBe('Prix client = arrondi au 9 supérieur de (prix fournisseur HT × 1,2 + marge) · marge 60 € (écran standard, autres pièces), 70 € (écran haut de gamme), 100 € (pliant) · iPad +110 €, MacBook +120 €');
    expect(phraseMethode({ ...REGLES_DEFAUT, autre: 50, ipad: 115 })).toContain('50 € (autres pièces)');
    expect(phraseMethode({ ...REGLES_DEFAUT, autre: 50, ipad: 115 })).toContain('iPad +115 €');
  });

  it('prix à renseigner : HT à 0 ou prix client absent', () => {
    expect(prixARenseigner({ prix_fournisseur_ht: 0, prix_client: 0 })).toBe(true);
    expect(prixARenseigner({ prix_fournisseur_ht: null, prix_client: null })).toBe(true);
    expect(prixARenseigner({ prix_fournisseur_ht: null, prix_client: 119 })).toBe(false); // HT masqué hors admin
    expect(prixARenseigner({ a_renseigner: true, prix_client: 69 })).toBe(true);
    expect(prixARenseigner({ prix_fournisseur_ht: 42, prix_client: 119 })).toBe(false);
  });

  it('liens profonds : recherche Utopya (espaces → +), page catégorie Mobilax quand la marque est connue', () => {
    expect(slugModele('Galaxy A54')).toBe('galaxy-a54');
    expect(slugModele('Redmi Note 12 Pro+')).toBe('redmi-note-12-pro');
    expect(lienUtopya({ marque: 'Samsung', modele: 'Galaxy A54', typePiece: 'Écran' })).toBe('https://www.utopya.fr/catalogsearch/result/?q=Samsung+Galaxy+A54+ecran');
    expect(lienUtopya({ marque: 'Xiaomi', modele: 'Redmi Note 12', typePiece: 'Batterie' })).toBe('https://www.utopya.fr/catalogsearch/result/?q=Xiaomi+Redmi+Note+12+batterie');
    expect(lienMobilax({ marque: 'Samsung', modele: 'Galaxy A54' })).toBe('https://www.mobilax.fr/pieces-detachees/telephonie/samsung/galaxy-a/galaxy-a54');
    expect(lienMobilax({ marque: 'Samsung', modele: 'Galaxy S23 Ultra' })).toBe('https://www.mobilax.fr/pieces-detachees/telephonie/samsung/galaxy-s/galaxy-s23-ultra');
    expect(lienMobilax({ marque: 'Xiaomi', modele: 'Redmi Note 12' })).toBe('https://www.mobilax.fr/marques/xiaomi/telephonie/redmi-note-series/redmi-note-12');
    expect(lienMobilax({ marque: 'Xiaomi', modele: 'Poco X5' })).toBe('https://www.mobilax.fr/marques/xiaomi/telephonie/poco-series/poco-x5');
    expect(lienMobilax({ marque: 'Huawei', modele: 'P30 Lite' })).toBe('https://www.mobilax.fr/marques/huawei/telephonie/series-p/p30-lite');
    expect(lienMobilax({ marque: 'Honor', modele: 'X8' })).toBe('https://www.mobilax.fr/marques/honor/telephonie/series-x/x8');
    expect(lienMobilax({ marque: 'Apple', modele: 'iPhone 13' })).toBe('https://www.mobilax.fr/pieces-detachees/telephonie/apple/iphone/iphone-13');
    // Marque sans motif connu (ou iPad) : recherche du site, sans la marque
    expect(lienMobilax({ marque: 'Sony', modele: 'Xperia 10', typePiece: 'Écran' })).toBe('https://www.mobilax.fr/recherche?q=Xperia+10+ecran');
    expect(lienMobilax({ marque: 'Apple', modele: 'iPad 9', typePiece: 'Batterie' })).toBe('https://www.mobilax.fr/recherche?q=iPad+9+batterie');
    expect(liensFournisseur({ marque: 'Samsung', modele: 'Galaxy A54' })).toEqual({
      utopya: 'https://www.utopya.fr/catalogsearch/result/?q=Samsung+Galaxy+A54',
      mobilax: 'https://www.mobilax.fr/pieces-detachees/telephonie/samsung/galaxy-a/galaxy-a54',
    });
  });

  it('recherche de modèles : chaque mot dans « marque modèle », sans accents', () => {
    expect(chercherModeles(MARQUES, 'galaxy a54').map((m) => m.modele)).toEqual(['Galaxy A54']);
    expect(chercherModeles(MARQUES, 'Samsung').map((m) => m.modele)).toEqual(['Galaxy A54', 'Galaxy A16']);
    expect(chercherModeles(MARQUES, 'ipad')[0]).toMatchObject({ marque: 'Apple', modele: 'iPad 9' });
    expect(chercherModeles(MARQUES, 'galaxy z99')).toEqual([]);
    expect(chercherModeles(MARQUES, '')).toEqual([]);
  });

  it('liste des modèles : ceux qui ont des prix d’abord (ordre du catalogue conservé), vues « Avec prix / À créer / Tous »', () => {
    // Catalogue du plus récent au plus ancien : les nouveautés sans pièce ne passent plus devant
    const liste = [{ modele: 'Galaxy S26', nb_pieces: 0 }, { modele: 'Galaxy A54', nb_pieces: 3 }, { modele: 'Galaxy A16', nb_pieces: 0 }, { modele: 'Galaxy S21', nb_pieces: 1 }];
    expect(trierModeles(liste).map((m) => m.modele)).toEqual(['Galaxy A54', 'Galaxy S21', 'Galaxy S26', 'Galaxy A16']);
    expect(filtrerModeles(liste, 'prix').map((m) => m.modele)).toEqual(['Galaxy A54', 'Galaxy S21']);
    expect(filtrerModeles(liste, 'a_creer').map((m) => m.modele)).toEqual(['Galaxy S26', 'Galaxy A16']);
    expect(filtrerModeles(liste, 'tous').map((m) => m.modele)).toEqual(['Galaxy A54', 'Galaxy S21', 'Galaxy S26', 'Galaxy A16']);
    expect(liste.map((m) => m.modele)).toEqual(['Galaxy S26', 'Galaxy A54', 'Galaxy A16', 'Galaxy S21']); // l'entrée n'est pas modifiée
    expect(VUES_MODELES.map((v) => v.cle)).toEqual(['prix', 'a_creer', 'tous']);
  });
});

// ─── Menu ────────────────────────────────────────
describe('Navbar : rubrique Tarifs', () => {
  const naviguer = (url = '/accueil') => render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="*" element={<><Navbar /><Adresse /></>} /></Routes>
    </MemoryRouter>,
  );

  it('« Réparation smartphones » sous « Réparation iPhone », ventes renommées, plus d’entrée Beta « Réparations (Mobilax) »', async () => {
    apiMock.getKPI.mockResolvedValue({ total_actifs: 3 });
    apiMock.getConfig.mockResolvedValue({ MODULE_DEVIS_VISIBLE: 'true', MODULE_DEVIS_FLASH_VISIBLE: 'true' });
    naviguer('/accueil/clients');
    const rubrique = await screen.findByRole('button', { name: /^Tarifs$/ });
    expect(rubrique).toHaveAttribute('aria-expanded', 'true');
    const boutons = screen.getAllByRole('button').map((b) => b.textContent.trim());
    const iPhone = boutons.indexOf('Réparation iPhone');
    expect(iPhone).toBeGreaterThan(-1);
    expect(boutons[iPhone + 1]).toBe('Réparation smartphones');
    expect(boutons[iPhone + 2]).toBe('Vente iPhones');
    expect(boutons[iPhone + 3]).toBe('Vente smartphones');
    expect(screen.queryByRole('button', { name: /Réparations \(Mobilax\)/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Tarifs iPhones/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Réparation smartphones/ }));
    expect(screen.getByTestId('adresse')).toHaveTextContent('/accueil/tarifs');
    expect(screen.getByRole('button', { name: /^Réparation smartphones/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /^Réparation iPhone/ })).not.toHaveAttribute('aria-current');
  });
});

// ─── Page ────────────────────────────────────────
describe('Réparation smartphones : lecture', () => {
  it('en-tête, aide « Où sont les prix ? », méthode de calcul du serveur, marques → modèles → pièces (sans HT hors admin)', async () => {
    apiMock.getReglesPrix.mockResolvedValue({ ...REGLES_DEFAUT, ecran: { standard: 65, haut_de_gamme: 75, pliant: 100 } });
    apiMock.getMethodeCalcul.mockResolvedValue({ ...METHODE_PERSONNEL });
    etat.modeles['Samsung::Galaxy A54'] = modele({ admin: false, pieces: modele().pieces.map((p) => ({ ...p, prix_fournisseur_ht: null, calcul: null })) });
    page();
    expect(await screen.findByRole('heading', { level: 1, name: 'Réparation smartphones' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Réparation iPhone/ })).toHaveAttribute('href', '/accueil/tarifs-reparation');
    // Hors admin : phrase du serveur, sans montant de marge (le coût HT masqué s'en déduirait), ni règles lues
    expect(await screen.findByText(METHODE_PERSONNEL.texte)).toBeInTheDocument();
    expect(screen.queryByText(/marge \d+ €/)).not.toBeInTheDocument();
    expect(screen.queryByText(/valeurs par défaut/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Exemple, écran standard/)).not.toBeInTheDocument();
    expect(apiMock.getReglesPrix).not.toHaveBeenCalled();
    // Lecture seule : pas de « Modifier les règles », mais l'identification est proposée
    expect(screen.queryByRole('button', { name: 'Modifier les règles' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mettre à jour les prix \(admin\)/ })).toBeInTheDocument();

    // Marques dans l'ordre boutique, Samsung ouverte d'emblée, Apple = iPad / Mac
    const marques = await screen.findByRole('group', { name: 'Marques' });
    const puces = within(marques).getAllByRole('button');
    expect(puces.map((b) => b.textContent.replace(/\d+$/, '').trim())).toEqual(['Samsung', 'Xiaomi', 'Apple (iPad / Mac)']);
    expect(puces[0]).toHaveAttribute('aria-pressed', 'true');
    // « Avec prix » par défaut : le modèle sans pièce (Galaxy A16, « à créer ») n'encombre pas la liste
    expect(screen.getByRole('heading', { level: 2, name: 'Samsung · 2 modèles' })).toBeInTheDocument();
    const vues = screen.getByRole('group', { name: 'Modèles affichés' });
    expect(within(vues).getAllByRole('button').map((b) => `${b.textContent.trim()}${b.getAttribute('aria-pressed') === 'true' ? ' *' : ''}`))
      .toEqual(['Avec prix 1 *', 'À créer 1', 'Tous 2']);
    let modeles = screen.getByRole('list', { name: 'Modèles' });
    expect(within(modeles).getByRole('button', { name: /Galaxy A54/ })).toHaveTextContent('3 pièces');
    expect(within(modeles).getByRole('button', { name: /Galaxy A54/ })).toHaveTextContent('1 à renseigner');
    expect(within(modeles).queryByRole('button', { name: /Galaxy A16/ })).not.toBeInTheDocument();
    fireEvent.click(within(vues).getByRole('button', { name: /^À créer/ }));
    modeles = screen.getByRole('list', { name: 'Modèles' });
    expect(within(modeles).getByRole('button', { name: /Galaxy A16/ })).toHaveTextContent('Aucune pièce');
    expect(within(modeles).queryByRole('button', { name: /Galaxy A54/ })).not.toBeInTheDocument();
    fireEvent.click(within(vues).getByRole('button', { name: /^Tous/ }));
    modeles = screen.getByRole('list', { name: 'Modèles' });
    expect(within(modeles).getAllByRole('button').map((b) => b.textContent)).toEqual([expect.stringContaining('Galaxy A54'), expect.stringContaining('Galaxy A16')]);
    // La liste défile dans sa carte : positionnée pour que ses textes sr-only (position absolue) n'allongent pas la page
    expect(modeles).toHaveClass('relative', 'overflow-y-auto');

    fireEvent.click(within(modeles).getByRole('button', { name: /Galaxy A54/ }));
    expect(screen.getByTestId('adresse')).toHaveTextContent('/accueil/tarifs?marque=Samsung&modele=Galaxy+A54');
    await waitFor(() => expect(apiMock.getReparationSmartphonesModele).toHaveBeenCalledWith({ marque: 'Samsung', modele: 'Galaxy A54' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Samsung Galaxy A54' })).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Pièce', 'Prix client TTC', 'Prix du']);
    expect(within(table).getByText('Soft OLED')).toBeInTheDocument();
    expect(within(table).getByText('119 €')).toBeInTheDocument();
    expect(within(table).getByText('79 €')).toBeInTheDocument();
    expect(within(table).getByText('Prix à renseigner')).toBeInTheDocument();
    expect(within(table).queryByText(/Date inconnue/)).not.toBeInTheDocument(); // rien à dater sur une pièce sans prix
    expect(within(table).queryByText(/× 1,2/)).not.toBeInTheDocument();
    expect(within(table).queryByRole('button', { name: /Mettre à jour le HT/ })).not.toBeInTheDocument();
    // Liens fournisseurs du serveur, ouverts dans un nouvel onglet sans fuite d'origine
    const utopya = screen.getByRole('link', { name: /Chercher chez Utopya/ });
    expect(utopya).toHaveAttribute('href', LIENS_A54.utopya);
    expect(utopya).toHaveAttribute('target', '_blank');
    expect(utopya.getAttribute('rel')).toMatch(/noopener/);
    expect(screen.getByRole('link', { name: /Chercher chez Mobilax/ })).toHaveAttribute('href', LIENS_A54.mobilax);
    // Aucune requête vers un site fournisseur
    expect(apiMock.checkTarifStock).not.toHaveBeenCalled();
  });

  it('marque sans aucun prix : « Tous » d’emblée (jamais une liste vide) ; « À créer » sans modèle vide : message', async () => {
    apiMock.getReparationSmartphonesMarques.mockResolvedValue([...MARQUES, { marque: 'Oppo', marque_c: 'oppo', nb_modeles: 1, modeles: [
      { modele: 'Reno 12', categorie: 'Smartphone', annee: 2024, au_catalogue: true, nb_pieces: 0, nb_sans_prix: 0, plus_vieux_jours: null, fraicheur: null, noms: [] },
    ] }]);
    page('/accueil/tarifs?marque=Oppo');
    const modeles = await screen.findByRole('list', { name: 'Modèles' });
    expect(within(modeles).getByRole('button', { name: /Reno 12/ })).toHaveTextContent('à créer');
    const vues = screen.getByRole('group', { name: 'Modèles affichés' });
    expect(within(vues).getByRole('button', { name: /^Tous/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(vues).getByRole('button', { name: /^Avec prix/ })).toHaveTextContent('Avec prix 0');
    cleanup();

    page('/accueil/tarifs?marque=Xiaomi');
    await screen.findByRole('list', { name: 'Modèles' });
    fireEvent.click(within(screen.getByRole('group', { name: 'Modèles affichés' })).getByRole('button', { name: /^À créer/ }));
    expect(screen.getByText('Tous les modèles Xiaomi ont des prix.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Modèles' })).not.toBeInTheDocument();
  });

  it('?q= : un seul modèle correspond → ouvert d’emblée ; aucun → message et ajout (admin)', async () => {
    localStorage.setItem('klikphone_admin', 'true');
    page('/accueil/tarifs?q=Samsung%20Galaxy%20A54');
    expect(await screen.findByRole('heading', { level: 2, name: 'Samsung Galaxy A54' })).toBeInTheDocument();
    expect(screen.getByLabelText('Rechercher un modèle')).toHaveValue('Samsung Galaxy A54');
    cleanup();

    page('/accueil/tarifs?q=Samsung%20Galaxy%20Z99');
    expect(await screen.findByText('Aucun modèle pour « Samsung Galaxy Z99 ».')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une pièce pour ce modèle' }));
    const fenetre = await screen.findByRole('dialog', { name: 'Ajouter une pièce' });
    expect(within(fenetre).getByLabelText('Marque')).toHaveValue('Samsung');
    expect(within(fenetre).getByLabelText('Modèle')).toHaveValue('Galaxy Z99');
  });
});

// ─── Check-up lot 3 : règles et méthode selon l'élévation ───
describe('Réparation smartphones : méthode, règles et code admin (check-up)', () => {
  it('hors admin : aucune lecture des règles (pas de 403), pas de « marge X € » dans l’en-tête du modèle', async () => {
    apiMock.getMethodeCalcul.mockResolvedValue({ ...METHODE_PERSONNEL });
    etat.modeles['Samsung::Galaxy A54'] = modele({ admin: false, pieces: modele().pieces.map((p) => ({ ...p, prix_fournisseur_ht: null, calcul: null })) });
    page('/accueil/tarifs?marque=Samsung&modele=Galaxy%20A54');
    const titre = await screen.findByRole('heading', { level: 2, name: 'Samsung Galaxy A54' });
    await screen.findByText(METHODE_PERSONNEL.texte);
    expect(titre.parentElement).toHaveTextContent('Écran standard');
    expect(titre.parentElement.textContent).not.toMatch(/marge/);
    expect(apiMock.getReglesPrix).not.toHaveBeenCalled();
    expect(apiMock.getMethodeCalcul).toHaveBeenCalled();
  });

  it('élévation en cours sur le poste : règles lues, marge de la catégorie et phrase complète', async () => {
    apiMock.hasAdminToken.mockReturnValue(true);
    apiMock.getReglesPrix.mockResolvedValue({ ...REGLES_DEFAUT, ecran: { standard: 65, haut_de_gamme: 75, pliant: 100 } });
    page('/accueil/tarifs?marque=Samsung&modele=Galaxy%20A54');
    const titre = await screen.findByRole('heading', { level: 2, name: 'Samsung Galaxy A54' });
    expect(await screen.findByText(/marge 65 € \(écran standard\), 75 € \(écran haut de gamme\), 100 € \(pliant\), 60 € \(autres pièces\)/)).toBeInTheDocument();
    expect(screen.getByText(/Exemple, écran standard acheté 42,00 € HT : 42,00 × 1,2 \+ 65 = 115,40 → 119 €/)).toBeInTheDocument();
    await waitFor(() => expect(titre.parentElement).toHaveTextContent('Écran standard : marge 65 €'));
  });

  it('code saisi depuis « Mettre à jour les prix (admin) » : le modèle ouvert est relu, HT affichés', async () => {
    etat.modeles['Samsung::Galaxy A54'] = modele({ admin: false, pieces: modele().pieces.map((p) => ({ ...p, prix_fournisseur_ht: null, calcul: null })) });
    apiMock.verifyAdmin.mockImplementation(async () => {
      // Le serveur reconnaît désormais le code : prix d'achat HT servis
      etat.modeles['Samsung::Galaxy A54'] = modele();
      apiMock.hasAdminToken.mockReturnValue(true);
      return { success: true, admin_token: 'jeton' };
    });
    page('/accueil/tarifs?marque=Samsung&modele=Galaxy%20A54');
    await screen.findByRole('heading', { level: 2, name: 'Samsung Galaxy A54' });
    await waitFor(() => expect(apiMock.getReparationSmartphonesModele).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /Mettre à jour les prix \(admin\)/ }));
    fireEvent.change(await screen.findByLabelText('Identifiant'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    await waitFor(() => expect(apiMock.getReparationSmartphonesModele).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('42,00 × 1,2 + 60 = 110,40 → 119 €')).toBeInTheDocument();
    expect(screen.queryByText(/Prix d’achat HT masqués/)).not.toBeInTheDocument();
    expect(apiMock.getReglesPrix).toHaveBeenCalled();
    expect(localStorage.getItem('klikphone_admin')).toBe('true');
  });

  it('puces de marque : compteurs contrastés (AA), en-tête réservé pour les compteurs (pas de décalage)', async () => {
    page();
    const marques = await screen.findByRole('group', { name: 'Marques' });
    const [active, inactive] = within(marques).getAllByRole('button');
    expect(active.querySelector('span:last-child')).toHaveClass('text-white');
    expect(active.querySelector('span:last-child').className).not.toMatch(/white\/80/);
    expect(inactive.querySelector('span:last-child')).toHaveClass('text-slate-500');
    const sousTitre = screen.getByText('Prix fournisseur Mobilax / Utopya et méthode de calcul', { exact: false });
    expect(sousTitre.querySelector('span')).toHaveClass('block', 'min-h-5');
  });
});

describe('Réparation smartphones : administrateur', () => {
  beforeEach(() => localStorage.setItem('klikphone_admin', 'true'));

  it('tableau avec HT et calcul ; « Mettre à jour le HT » : aperçu avant validation, source Utopya, PATCH puis ligne mise à jour', async () => {
    apiMock.patchPrixPiece.mockImplementation(async (id, corps) => {
      const maj = {
        id, prix_fournisseur_ht: corps.prix_fournisseur_ht, prix_client: 129, prix_source: corps.source, prix_maj_le: '2026-10-17T09:00:00',
        age_jours: 0, fraicheur: 'ok', estime: false, verrou_manuel: false, ref_fournisseur: corps.ref_fournisseur || null,
        url_fournisseur: corps.url_fournisseur || null, fournisseur: 'Utopya', calcul: { ht: 50, tva: 1.2, marge: 60, brut: 120, arrondi: 129 },
      };
      etat.modeles['Samsung::Galaxy A54'] = modele({ pieces: modele().pieces.map((p) => (p.id === id ? { ...p, ...maj, verrou: false } : p)) });
      return maj;
    });
    page('/accueil/tarifs?marque=Samsung&modele=Galaxy%20A54');
    const table = await screen.findByRole('table');
    // Admin : la date du prix est sous le HT (source, référence), pas de colonne « Prix du »
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Pièce', 'Prix fournisseur HT', 'Calcul', 'Prix client TTC', 'Actions']);
    expect(within(table).getByText('42,00 € HT')).toBeInTheDocument();
    expect(within(table).getByText('42,00 × 1,2 + 60 = 110,40 → 119 €')).toBeInTheDocument();
    expect(within(table).getByText('11,00 × 1,2 + 60 = 73,20 → 79 €')).toBeInTheDocument();
    expect(within(table).getByText('Prix client fixé à la main')).toBeInTheDocument(); // batterie verrouillée
    expect(screen.getByRole('button', { name: 'Modifier les règles' })).toBeInTheDocument();
    expect(screen.getByText(/Écran standard : marge 60 €/)).toBeInTheDocument();

    fireEvent.click(within(table).getByRole('button', { name: /Mettre à jour le HT.*Ecran Soft OLED/ }));
    const form = screen.getByRole('form', { name: 'Mettre à jour le prix d’achat HT de Samsung Galaxy A54 · Ecran Soft OLED' });
    const champ = within(form).getByLabelText('Nouveau prix d’achat HT (€)');
    expect(champ).toHaveFocus();
    expect(champ).toHaveValue('42,00');
    expect(within(form).getByText('Calcul : 42,00 × 1,2 + 60 = 110,40 → 119 €')).toBeInTheDocument();
    fireEvent.change(champ, { target: { value: '50' } });
    // Aperçu du nouveau prix client AVANT validation
    expect(within(form).getByText('Calcul : 50,00 × 1,2 + 60 = 120,00 → 129 €')).toBeInTheDocument();
    expect(within(form).getByText(texteExact(`Prix client : ${E(119)} → ${E(129)}`))).toBeInTheDocument();
    expect(apiMock.patchPrixPiece).not.toHaveBeenCalled();
    // Liens pour aller relever le prix (nouvel onglet)
    expect(within(form).getByRole('link', { name: /Chercher chez Utopya/ })).toHaveAttribute('href', piece().liens.utopya);
    expect(within(form).getByRole('link', { name: /Chercher chez Mobilax/ })).toHaveAttribute('target', '_blank');
    // Source Utopya : référence et adresse facultatives
    fireEvent.click(within(form).getByRole('button', { name: 'Utopya' }));
    fireEvent.change(within(form).getByLabelText('Référence fournisseur (facultatif)'), { target: { value: 'UT-123' } });
    fireEvent.change(within(form).getByLabelText('Adresse de la fiche (facultatif)'), { target: { value: 'https://www.utopya.fr/ecran-galaxy-a54.html' } });
    fireEvent.click(within(form).getByRole('button', { name: `Valider : ${E(129)}` }));
    await waitFor(() => expect(apiMock.patchPrixPiece).toHaveBeenCalledWith(1, {
      prix_fournisseur_ht: 50, source: 'utopya', ref_fournisseur: 'UT-123', url_fournisseur: 'https://www.utopya.fr/ecran-galaxy-a54.html',
    }));
    expect(await within(table).findByText('50,00 € HT')).toBeInTheDocument();
    expect(within(table).getByText('129 €')).toBeInTheDocument();
    expect(within(table).getByText('50,00 × 1,2 + 60 = 120,00 → 129 €')).toBeInTheDocument();
    expect(within(table).getByText(/réf\. UT-123/)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: /Mettre à jour le prix/ })).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith(`Samsung Galaxy A54 · Ecran Soft OLED : achat ${E(50)} HT → prix client ${E(129)}.`);
    // La grille est relue (comptages des modèles)
    await waitFor(() => expect(apiMock.getReparationSmartphonesMarques).toHaveBeenCalledTimes(2));
  });

  it('ligne « prix à renseigner » : ni date ni source dans la cellule HT, un bouton « Saisir le HT » qui ouvre le volet', async () => {
    page('/accueil/tarifs?marque=Samsung&modele=Galaxy%20A54');
    const table = await screen.findByRole('table');
    // Le badge de la ligne suffit : la cellule HT ne répète ni « Prix à renseigner » ni une date inconnue
    expect(within(table).getAllByText('Prix à renseigner')).toHaveLength(1);
    expect(within(table).queryByText(/Date inconnue/)).not.toBeInTheDocument();
    expect(within(table).queryByText('Date du prix inconnue')).not.toBeInTheDocument();
    // Le tableau défile dans sa carte : positionné pour que ses textes sr-only n'élargissent pas la page
    expect(table.closest('.table-wrap')).toHaveClass('relative');
    fireEvent.click(within(table).getByRole('button', { name: 'Saisir le prix d’achat HT de Samsung Galaxy A54 · Connecteur de charge' }));
    const form = screen.getByRole('form', { name: /Connecteur de charge$/ });
    const champ = within(form).getByLabelText('Nouveau prix d’achat HT (€)');
    expect(champ).toHaveValue('');
    fireEvent.change(champ, { target: { value: '8' } });
    expect(within(form).getByText('Calcul : 8,00 × 1,2 + 60 = 69,60 → 79 €')).toBeInTheDocument();
    expect(within(form).getByText(texteExact(`Prix client : ${E(79)}`))).toBeInTheDocument();
  });

  it('pièce verrouillée : l’aperçu dit que le prix client ne bouge pas ; saisie refusée tant que le HT est vide', async () => {
    page('/accueil/tarifs?marque=Samsung&modele=Galaxy%20A54');
    const table = await screen.findByRole('table');
    fireEvent.click(within(table).getByRole('button', { name: /Mettre à jour le HT.*Batterie/ }));
    const form = screen.getByRole('form', { name: /Batterie$/ });
    const champ = within(form).getByLabelText('Nouveau prix d’achat HT (€)');
    fireEvent.change(champ, { target: { value: '' } });
    expect(within(form).getByRole('button', { name: 'Valider' })).toBeDisabled();
    fireEvent.change(champ, { target: { value: '14,5' } });
    expect(within(form).getByText('Calcul : 14,50 × 1,2 + 60 = 77,40 → 79 €')).toBeInTheDocument();
    expect(within(form).getByText(/Prix client verrouillé : reste à/)).toHaveTextContent('79 €');
    fireEvent.change(champ, { target: { value: '0' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Valider' }));
    expect(apiMock.patchPrixPiece).not.toHaveBeenCalled();
    fireEvent.click(within(form).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('form', { name: /Mettre à jour le prix/ })).not.toBeInTheDocument();
  });

  it('erreur du serveur à la validation : message dans le volet, prix inchangé', async () => {
    apiMock.patchPrixPiece.mockRejectedValue(Object.assign(new Error('Base indisponible'), { status: 500 }));
    page('/accueil/tarifs?marque=Samsung&modele=Galaxy%20A54');
    const table = await screen.findByRole('table');
    fireEvent.click(within(table).getByRole('button', { name: /Mettre à jour le HT.*Ecran Soft OLED/ }));
    const form = screen.getByRole('form', { name: /Ecran Soft OLED$/ });
    fireEvent.change(within(form).getByLabelText('Nouveau prix d’achat HT (€)'), { target: { value: '50' } });
    fireEvent.click(within(form).getByRole('button', { name: `Valider : ${E(129)}` }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Prix non enregistré : Base indisponible');
    expect(within(table).getByText('42,00 € HT')).toBeInTheDocument();
  });

  it('prix d’achat masqués sans le code admin : relus après l’identification', async () => {
    const masque = modele({ admin: false, pieces: modele().pieces.map((p) => ({ ...p, prix_fournisseur_ht: null, calcul: null })) });
    etat.modeles['Samsung::Galaxy A54'] = masque;
    page('/accueil/tarifs?marque=Samsung&modele=Galaxy%20A54');
    expect(await screen.findByText(/Prix d’achat HT masqués tant que le code administrateur/)).toBeInTheDocument();
    expect(screen.queryByText('42,00 € HT')).not.toBeInTheDocument();
    etat.modeles['Samsung::Galaxy A54'] = modele();
    fireEvent.click(screen.getByRole('button', { name: 'Afficher les prix d’achat (code admin)' }));
    expect(await screen.findByText('42,00 € HT')).toBeInTheDocument();
    expect(screen.queryByText(/Prix d’achat HT masqués/)).not.toBeInTheDocument();
  });

  it('modèle du catalogue sans pièce : « Ajouter les pièces courantes » les pré-crée à 0 € HT', async () => {
    apiMock.creerPiecesCourantes.mockResolvedValue({ marque: 'Samsung', modele: 'Galaxy A16', crees: [{ id: 50, type_piece: 'Ecran' }, { id: 51, type_piece: 'Batterie' }, { id: 52, type_piece: 'Connecteur de charge' }], existants: [] });
    page('/accueil/tarifs?marque=Samsung&modele=Galaxy%20A16');
    expect(await screen.findByText('Aucune pièce enregistrée pour Samsung Galaxy A16.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter les pièces courantes' }));
    await waitFor(() => expect(apiMock.creerPiecesCourantes).toHaveBeenCalledWith({ marque: 'Samsung', modele: 'Galaxy A16' }));
    expect(toast.success).toHaveBeenCalledWith('Samsung Galaxy A16 : 3 pièces courantes ajoutées, prix à renseigner.');
    await waitFor(() => expect(apiMock.getReparationSmartphonesModele).toHaveBeenCalledTimes(2));
  });

  it('cadenas et stock passent par l’API ; iPad / MacBook : route dédiée, pas de stock ni d’URL', async () => {
    apiMock.setVerrouPrix.mockResolvedValue({ id: 1, verrou_manuel: true });
    apiMock.toggleTarifStock.mockResolvedValue({ id: 1, en_stock: false });
    page('/accueil/tarifs?marque=Samsung&modele=Galaxy%20A54');
    const table = await screen.findByRole('table');
    fireEvent.click(within(table).getByRole('button', { name: 'Verrouiller le prix de Samsung Galaxy A54 · Ecran Soft OLED' }));
    await waitFor(() => expect(apiMock.setVerrouPrix).toHaveBeenCalledWith(1, true));
    expect(await within(table).findByRole('button', { name: 'Déverrouiller le prix de Samsung Galaxy A54 · Ecran Soft OLED' })).toBeInTheDocument();
    fireEvent.click(within(table).getByRole('button', { name: 'Samsung Galaxy A54 · Ecran Soft OLED : en stock. Changer' }));
    await waitFor(() => expect(apiMock.toggleTarifStock).toHaveBeenCalledWith(1));
    expect(await within(table).findByRole('button', { name: 'Samsung Galaxy A54 · Ecran Soft OLED : en rupture. Changer' })).toBeInTheDocument();
    cleanup();

    apiMock.patchPrixAppleDevice.mockImplementation(async () => {
      // Après l'écriture, le serveur sert le modèle à jour (relecture de la grille)
      etat.modeles['Apple::iPad 9'] = { ...IPAD, pieces: IPAD.pieces.map((p) => (p.piece === 'ecran'
        ? { ...p, prix_fournisseur_ht: 120, prix_client: 259, prix_source: 'mobilax', calcul: { ht: 120, tva: 1.2, marge: 110, brut: 254, arrondi: 259 } } : p)) };
      return { ok: true, ancien_ht: 100, nouveau_ht: 120, ancien_client: 239, nouveau_client: 259, piece: 'ecran', id: 11, cle: 'tarifs_apple_devices:11:ecran' };
    });
    page('/accueil/tarifs?marque=Apple&modele=iPad%209');
    const tableau = await screen.findByRole('table');
    expect(within(tableau).getByText('100,00 × 1,2 + 110 = 230,00 → 239 €')).toBeInTheDocument();
    expect(within(tableau).queryByText(/En stock|Rupture/)).not.toBeInTheDocument();
    fireEvent.click(within(tableau).getByRole('button', { name: /Mettre à jour le HT.*Écran/ }));
    const form = screen.getByRole('form', { name: /iPad 9 · Écran$/ });
    fireEvent.change(within(form).getByLabelText('Nouveau prix d’achat HT (€)'), { target: { value: '120' } });
    expect(within(form).getByText('Calcul : 120,00 × 1,2 + 110 = 254,00 → 259 €')).toBeInTheDocument();
    fireEvent.click(within(form).getByRole('button', { name: 'Mobilax' }));
    expect(within(form).queryByLabelText('Adresse de la fiche (facultatif)')).not.toBeInTheDocument();
    fireEvent.click(within(form).getByRole('button', { name: `Valider : ${E(259)}` }));
    await waitFor(() => expect(apiMock.patchPrixAppleDevice).toHaveBeenCalledWith(11, { piece: 'ecran', prix_fournisseur_ht: 120, source: 'mobilax' }));
    expect(apiMock.patchPrixPiece).not.toHaveBeenCalled();
    expect(await within(tableau).findByText('259 €')).toBeInTheDocument();
  });
});

// ─── Réparation iPhone : où sont les prix ? ─────
describe('Réparation iPhone : bandeau d’aide', () => {
  it('renvoie vers « Réparation smartphones » pour les autres marques et iPad / Mac', async () => {
    apiMock.getTarifsReparation.mockResolvedValue([]);
    render(<TarifsReparationPage />);
    expect(await screen.findByText('Où sont les prix ?')).toBeInTheDocument();
    const lien = screen.getByRole('link', { name: /Réparation smartphones/ });
    expect(lien).toHaveAttribute('href', '/accueil/tarifs');
    expect(lien).toHaveClass('min-h-[44px]'); // cible tactile dans la phrase
    expect(screen.getByText(/autres marques et iPad \/ Mac/)).toBeInTheDocument();
  });

  it('le lien « Réparation iPhone » du bandeau de « Réparation smartphones » est aussi une cible de 44 px', async () => {
    page();
    expect(await screen.findByRole('link', { name: /Réparation iPhone/ })).toHaveClass('min-h-[44px]');
  });
});
