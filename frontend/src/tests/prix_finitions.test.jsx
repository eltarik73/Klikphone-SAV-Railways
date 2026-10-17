/**
 * Finitions du moteur de prix (gérant pressé) :
 * - TarifsPage applique les filtres envoyés par les tuiles « Santé des prix » (?source=estimation,
 *   ?fraicheur=a_revoir|perime, ?marge=faible), affichés en puces effaçables ;
 * - Navbar : entrée admin « Prix à revoir » avec le nombre de propositions en attente (une lecture par
 *   minute au plus, jamais pour un non-admin) ;
 * - import d'un fichier, onglet « À associer » : prix du fichier, aperçu avant → après chiffré par le
 *   serveur (POST /evaluer), case cochée par défaut seulement sans alerte ;
 * - cadenas des grilles boutique : refus 409 « verrouille » lisible, lignes verrouillées non modifiées.
 * Correctifs : pièce associée à la main retirée des « Absentes du fichier » (jamais marquée obsolète),
 * bilan d'annulation (lignes verrouillées ≠ prix modifiés depuis, propositions rouvertes ou annulées),
 * aide du cadenas boutique conforme au serveur, fenêtre « Ajouter une pièce » préremplie dès le premier rendu.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { configure } from '@testing-library/react';
import { renderToString } from 'react-dom/server';

// Pages entières (grille, menu, fenêtre d'import) : marge pour une machine chargée (suite complète en parallèle)
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
    auth: { user: { target: 'accueil', utilisateur: 'Karim', role: 'admin' }, logout: () => {} },
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), important: vi.fn() },
    apiMock,
  };
});

vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../components/Toast', () => ({ useToast: () => toast, ToastProvider: ({ children }) => children }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));

import { clearCache } from '../hooks/useApi';
import TarifsPage, { correspondFiltresUrl, lireFiltresUrl, margeEcran } from '../pages/TarifsPage';
import Navbar from '../components/Navbar';
import ImportPrixModal, { absentesApresAssociations, ligneDeCle, lireEvaluation } from '../components/ImportPrixModal';
import { REGLES_DEFAUT, bilanAnnulation, messageAnnulation, messageErreurPrix } from '../components/HistoriquePrix';
import { AIDE_VERROU_BOUTIQUE, AjoutPiecePrix, ApercuSimulation, ResultatApplication } from '../components/ReglesPrixPanel';

// ─── Données ───────────────────────────────────────
const OK = { prix_source: 'import', prix_maj_le: '2026-10-01T10:00:00', age_jours: 16, fraicheur: 'ok', estime: false };
const A_REVOIR = { prix_source: 'import', prix_maj_le: '2026-06-20T10:00:00', age_jours: 119, fraicheur: 'a_revoir', estime: false };
const ESTIME = { prix_source: 'estimation_2026_02', prix_maj_le: '2026-02-15T19:27:49', age_jours: 244, fraicheur: 'perime', estime: true };
// Marges des écrans (règles par défaut : TVA 1,2, seuil 40 €) : S21 189 − 105 × 1,2 = 63 € ; iPhone 13 109 − 60 × 1,2 = 37 € ;
// Redmi 79 − 40 × 1,2 = 31 € ; iPad 9 149 − 100 × 1,2 = 29 €
const TARIFS = [
  { id: 1, marque: 'Samsung', modele: 'Galaxy S21', type_piece: 'Ecran', qualite: 'OLED', prix_client: 189, prix_fournisseur_ht: 105, categorie: 'standard', en_stock: true, verrou_manuel: false, ...OK },
  { id: 2, marque: 'Samsung', modele: 'Galaxy S21', type_piece: 'Batterie', qualite: null, prix_client: 69, prix_fournisseur_ht: 5, categorie: 'standard', en_stock: true, verrou_manuel: false, ...A_REVOIR },
  { id: 3, marque: 'Apple', modele: 'iPhone 13', type_piece: 'Ecran', qualite: 'Incell', prix_client: 109, prix_fournisseur_ht: 60, categorie: 'standard', en_stock: true, verrou_manuel: false, ...ESTIME },
  { id: 4, marque: 'Xiaomi', modele: 'Redmi Note 10', type_piece: 'Ecran', qualite: 'OLED', prix_client: 79, prix_fournisseur_ht: 40, categorie: 'standard', en_stock: true, verrou_manuel: false, ...ESTIME, fraicheur: 'ok', age_jours: 20 },
];
const IPAD = { id: 11, categorie: 'ipad', modele: 'iPad 9', ecran_prix_ht: 100, batterie_prix_ht: 30, ecran_prix_vente: 149, batterie_prix_vente: 149, actif: true, verrou_manuel: false, ...A_REVOIR };
const SANTE = {
  total: 5, estimes: 2, a_revoir: 2, perimes: 1, marges_faibles: 3, propositions_en_attente: 4,
  seuils: { jours_a_revoir: 90, jours_perime: 180, seuil_marge_alerte: 40 },
};
const sansHt = (t) => { const { prix_fournisseur_ht: _h, ...r } = t; return r; };
const sansHtApple = (d) => { const { ecran_prix_ht: _e, batterie_prix_ht: _b, ...r } = d; return r; };

function resetApi() {
  for (const [k, fn] of Object.entries(apiMock)) {
    if (k !== 'background' && typeof fn?.mockReset === 'function') fn.mockReset().mockResolvedValue([]);
  }
}

function Adresse() {
  const l = useLocation();
  return <output data-testid="adresse">{`${l.pathname}${l.search}`}</output>;
}

// En-tête d'une marque dépliable de la vue filtrée (« Samsung 1 modele, 2 prix ») ; hors filtre, la page
// « Réparation smartphones » montre des puces de marque (« Samsung 1 », groupe « Marques »)
const groupe = (marque) => new RegExp(`^${marque}\\s*\\d+ modeles?, \\d+ prix$`);
const puceMarque = (marque) => within(screen.getByRole('group', { name: 'Marques' })).getByRole('button', { name: new RegExp(`^${marque}`) });
const MARQUES_RS = [
  { marque: 'Samsung', modeles: [{ modele: 'Galaxy S21', nb_pieces: 2, nb_sans_prix: 0, plus_vieux_jours: 119 }] },
  { marque: 'Xiaomi', modeles: [{ modele: 'Redmi Note 10', nb_pieces: 1, nb_sans_prix: 0, plus_vieux_jours: 20 }] },
];

const pageTarifs = (url) => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes><Route path="*" element={<><TarifsPage /><Adresse /></>} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  clearCache();
  resetApi();
  vi.clearAllMocks();
  localStorage.clear();
  auth.user = { target: 'accueil', utilisateur: 'Karim', role: 'admin' };
  apiMock.getTarifs.mockResolvedValue(TARIFS);
  apiMock.getTarifsStats.mockResolvedValue({ modeles: 3, marques: 3, prix_min: 69, prix_max: 189 });
  apiMock.getAppleDevices.mockResolvedValue([IPAD]);
  apiMock.getSantePrix.mockResolvedValue(SANTE);
  apiMock.getReglesPrix.mockResolvedValue({ ...REGLES_DEFAUT });
  apiMock.getReparationSmartphonesMarques.mockResolvedValue(MARQUES_RS);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ─── Filtres de l'URL : calcul ───────────────────────
describe('filtres de l’URL (tuiles « Santé des prix »)', () => {
  it('valeurs connues seulement ; marge d’un écran au centime, comme le serveur', () => {
    expect(lireFiltresUrl(new URLSearchParams('source=estimation&fraicheur=perime&marge=faible&q=s21')))
      .toEqual({ source: 'estimation', fraicheur: 'perime', marge: 'faible' });
    expect(lireFiltresUrl(new URLSearchParams('source=import&fraicheur=vieux&marge=forte')))
      .toEqual({ source: null, fraicheur: null, marge: null });
    expect(margeEcran(TARIFS[2], 1.2)).toBe(37);
    expect(margeEcran(TARIFS[1], 1.2)).toBeNull(); // batterie : pas de marge d'écran
    expect(margeEcran(sansHt(TARIFS[0]), 1.2)).toBeNull(); // HT masqué : inconnue, jamais « faible »
    expect(margeEcran(IPAD, 1.2, true)).toBe(29);
    // 40 € tout juste : pas sous le seuil (189 − 124,17 × 1,2 = 40,00…)
    expect(correspondFiltresUrl({ ...TARIFS[0], prix_fournisseur_ht: 124.17 }, { marge: 'faible' })).toBe(false);
    expect(correspondFiltresUrl(TARIFS[3], { source: 'estimation', marge: 'faible' })).toBe(true);
    expect(correspondFiltresUrl(TARIFS[3], { source: 'estimation', fraicheur: 'perime' })).toBe(false);
  });
});

// ─── Filtres de l'URL : grille ───────────────────────
describe('TarifsPage : filtres envoyés par le tableau de bord', () => {
  it('?source=estimation : seules les pièces estimées, puce effaçable qui rend toute la grille', async () => {
    localStorage.setItem('klikphone_admin', 'true');
    pageTarifs('/accueil/tarifs?source=estimation');
    const filtres = await screen.findByRole('group', { name: 'Filtres actifs' });
    expect(within(filtres).getByRole('button', { name: 'Retirer le filtre Prix estimés (jamais vérifiés)' })).toBeInTheDocument();
    await waitFor(() => expect(within(filtres).getByRole('status')).toHaveTextContent('2 prix correspondent'));
    expect(screen.getByRole('button', { name: groupe('Apple') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: groupe('Xiaomi') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: groupe('Samsung') })).not.toBeInTheDocument();
    // Peu de résultats : modèles dépliés d'emblée
    expect(await screen.findByText('Redmi Note 10')).toBeInTheDocument();

    fireEvent.click(within(filtres).getByRole('button', { name: /Retirer le filtre/ }));
    expect(screen.getByTestId('adresse')).toHaveTextContent(/^\/accueil\/tarifs$/);
    expect(screen.queryByRole('group', { name: 'Filtres actifs' })).not.toBeInTheDocument();
    // Retour à la page par marque → modèle (puces de marque, Samsung ouverte)
    await screen.findByRole('group', { name: 'Marques' });
    expect(puceMarque('Samsung')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Rechercher un modèle')).toHaveFocus();
  });

  it('?fraicheur=a_revoir : pièces et iPad à revoir ; ?q= conservé quand on efface le filtre', async () => {
    localStorage.setItem('klikphone_admin', 'true');
    pageTarifs('/accueil/tarifs?fraicheur=a_revoir&q=samsung');
    const filtres = await screen.findByRole('group', { name: 'Filtres actifs' });
    expect(within(filtres).getByText('À revoir (plus de 90 jours)')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: groupe('Samsung') })).toBeInTheDocument();
    // Batterie du S21 (à revoir) visible, écran du S21 (prix du mois) masqué
    expect((await screen.findAllByText(/^batterie$/i)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Galaxy S21 · Batterie : en stock/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Galaxy S21 · Ecran/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Ecrans disponibles')).not.toBeInTheDocument();
    fireEvent.click(within(filtres).getByRole('button', { name: /Retirer le filtre/ }));
    expect(screen.getByTestId('adresse')).toHaveTextContent('/accueil/tarifs?q=samsung');
  });

  it('?fraicheur=perime : périmés seulement ; aucune correspondance → message et « Voir toute la grille »', async () => {
    apiMock.getTarifs.mockResolvedValue(TARIFS.filter((t) => t.fraicheur !== 'perime'));
    apiMock.getAppleDevices.mockResolvedValue([]);
    pageTarifs('/tech/tarifs?fraicheur=perime');
    expect(await screen.findByText('Aucun prix pour ce filtre : Périmés (plus de 180 jours).')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Voir toute la grille' }));
    expect(screen.getByTestId('adresse')).toHaveTextContent(/^\/tech\/tarifs$/);
    await screen.findByRole('group', { name: 'Marques' });
    expect(puceMarque('Samsung')).toBeInTheDocument();
  });

  it('?marge=faible : écrans sous le seuil (pièces et iPad), marge affichée sur la carte', async () => {
    localStorage.setItem('klikphone_admin', 'true');
    pageTarifs('/accueil/tarifs?marge=faible');
    const filtres = await screen.findByRole('group', { name: 'Filtres actifs' });
    expect(within(filtres).getByText('Marges faibles (écrans, sous 40 €)')).toBeInTheDocument();
    await waitFor(() => expect(within(filtres).getByRole('status')).toHaveTextContent('3 prix correspondent'));
    expect(screen.queryByRole('button', { name: groupe('Samsung') })).not.toBeInTheDocument();
    expect(await screen.findByText('Marge : 37 € (seuil 40 €)')).toBeInTheDocument();
    expect(screen.getByText('Marge : 31 € (seuil 40 €)')).toBeInTheDocument();
    expect(screen.getByText('Marge : 29 € (seuil 40 €)')).toBeInTheDocument();
    expect(screen.getByText('iPad 9')).toBeInTheDocument();
  });

  it('?marge=faible sans le code admin : prix d’achat masqués, « Afficher les marges » les relit', async () => {
    apiMock.getTarifs.mockResolvedValue(TARIFS.map(sansHt));
    apiMock.getAppleDevices.mockResolvedValue([sansHtApple(IPAD)]);
    apiMock.getPrixAchat.mockResolvedValue({ tarifs: TARIFS, appleDevices: [IPAD] });
    pageTarifs('/accueil/tarifs?marge=faible');
    expect(await screen.findByText(/masqués tant que le code administrateur n’est pas saisi/)).toBeInTheDocument();
    expect(screen.getByText('Saisissez le code administrateur pour voir les marges faibles.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Afficher les marges (code admin)' }));
    await waitFor(() => expect(apiMock.getPrixAchat).toHaveBeenCalled());
    expect(await screen.findByText('Marge : 37 € (seuil 40 €)')).toBeInTheDocument();
    expect(screen.queryByText(/masqués tant que le code administrateur/)).not.toBeInTheDocument();
  });

  it('valeur inconnue ignorée : ni puce ni filtre', async () => {
    pageTarifs('/accueil/tarifs?fraicheur=vieux');
    await screen.findByRole('group', { name: 'Marques' });
    expect(puceMarque('Samsung')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Filtres actifs' })).not.toBeInTheDocument();
  });

  it('plusieurs filtres : « Effacer les filtres » les retire tous', async () => {
    localStorage.setItem('klikphone_admin', 'true');
    pageTarifs('/accueil/tarifs?source=estimation&marge=faible');
    const filtres = await screen.findByRole('group', { name: 'Filtres actifs' });
    await waitFor(() => expect(within(filtres).getByRole('status')).toHaveTextContent('2 prix correspondent'));
    fireEvent.click(within(filtres).getByRole('button', { name: 'Effacer les filtres' }));
    expect(screen.getByTestId('adresse')).toHaveTextContent(/^\/accueil\/tarifs$/);
  });
});

// ─── Navbar ────────────────────────────────────────
const naviguer = (url = '/accueil') => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes><Route path="*" element={<><Navbar /><Adresse /></>} /></Routes>
  </MemoryRouter>,
);

describe('Navbar : « Prix à revoir » et propositions en attente', () => {
  it('admin : badge du nombre de propositions, lien vers l’onglet propositions', async () => {
    localStorage.setItem('klikphone_admin', 'true');
    naviguer();
    const entree = await screen.findByRole('button', { name: 'Prix à revoir : 4 propositions de prix en attente' });
    expect(entree).toHaveTextContent('4');
    fireEvent.click(entree);
    expect(screen.getByTestId('adresse')).toHaveTextContent('/accueil/prix-a-revoir?onglet=propositions');
    expect(apiMock.getSantePrix).toHaveBeenCalledTimes(1);
  });

  it('rôle non admin : entrée sans badge, la santé des prix n’est jamais lue', async () => {
    auth.user = { target: 'tech', utilisateur: 'Sophie', role: 'tech' };
    naviguer('/tech');
    expect(await screen.findByRole('button', { name: 'Prix à revoir' })).toBeInTheDocument();
    await waitFor(() => expect(apiMock.getKPI).toHaveBeenCalled());
    expect(apiMock.getSantePrix).not.toHaveBeenCalled();
  });

  it('une lecture par minute au plus (retour sur l’onglet compris), autres compteurs intacts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    naviguer();
    await screen.findByRole('button', { name: /Prix à revoir : 4 propositions/ });
    expect(apiMock.getSantePrix).toHaveBeenCalledTimes(1);
    const kpi = apiMock.getKPI.mock.calls.length;
    // Retour sur l'onglet 5 s plus tard : badges relus, pas la santé des prix
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(apiMock.getKPI.mock.calls.length).toBeGreaterThan(kpi));
    expect(apiMock.getSantePrix).toHaveBeenCalledTimes(1);
    // Une minute plus tard : relue, le badge suit
    apiMock.getSantePrix.mockResolvedValue({ ...SANTE, propositions_en_attente: 1 });
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    await waitFor(() => expect(apiMock.getSantePrix).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: 'Prix à revoir : 1 proposition de prix en attente' })).toBeInTheDocument();
  });

  it('santé des prix en échec : pas de badge, le menu reste utilisable', async () => {
    apiMock.getSantePrix.mockRejectedValue(new Error('Erreur 500'));
    naviguer();
    await waitFor(() => expect(apiMock.getSantePrix).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Prix à revoir' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reporting/ })).toBeInTheDocument();
  });
});

// ─── Import : onglet « À associer » ───────────────────
const APERCU = {
  import_id: 7, colonnes: ['Référence', 'Désignation', 'Prix HT'],
  mapping: { reference: 'Référence', designation: 'Désignation', prix_ht: 'Prix HT' },
  reconnues: [], nouvelles: [], invalides: [], absentes: [],
  non_reconnues: [{ n: 6, brut: 'Ecran iPhone13 incell compatible', designation: 'Ecran iPhone13 incell compatible', raison: 'aucune pièce correspondante', nouveau_ht: 41 }],
  resume: { lignes: 1 },
};
const EVAL = {
  n: 6, cle: 'tarifs:3', label: 'Apple iPhone 13 · Ecran Incell', ancien_ht: 40, nouveau_ht: 41, ancien_client: 109, nouveau_client: 119,
  change: true, verrou: false, obsolete: false, alerte: null, alertes: [], confirmation_requise: false,
};
const differe = () => {
  let resoudre; let rejeter;
  const promesse = new Promise((ok, ko) => { resoudre = ok; rejeter = ko; });
  return { promesse, resoudre, rejeter };
};

async function associerLigne6(apercu = APERCU) {
  apiMock.apercuImportPrix.mockResolvedValue(apercu);
  const onApplique = vi.fn();
  render(<ImportPrixModal open onClose={vi.fn()} catalogue={{ tarifs: TARIFS, appleDevices: [] }} regles={REGLES_DEFAUT} onApplique={onApplique} />);
  fireEvent.change(screen.getByLabelText('Choisir un fichier'), { target: { files: [new File(['x'], 'mobilax.csv', { type: 'text/csv' })] } });
  fireEvent.click(screen.getByRole('button', { name: 'Lire le fichier' }));
  expect(await screen.findByRole('tab', { name: /À associer/ })).toHaveAttribute('aria-selected', 'true');
  fireEvent.change(screen.getByLabelText('Associer la ligne 6 à une pièce'), { target: { value: 'iphone 13' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apple iPhone 13 · Ecran Incell' }));
  return { onApplique };
}

describe('Import, onglet « À associer » : aperçu chiffré par le serveur', () => {
  it('prix du fichier affiché ; pendant le calcul case désactivée, puis avant → après du serveur et case cochée sans alerte', async () => {
    const reponse = differe();
    apiMock.evaluerAssociationsImport.mockReturnValue(reponse.promesse);
    apiMock.appliquerImportPrix.mockResolvedValue({ lot_id: 'lot-1', modifies: 1, ajoutes: 0, obsoletes: 0, verrouilles: 0, confirmes: 0, associees: 1, associations_ignorees: [] });
    await associerLigne6();
    expect(screen.getByText('Prix du fichier :')).toBeInTheDocument();
    expect(apiMock.evaluerAssociationsImport).toHaveBeenCalledWith(7, [{ n: 6, cle: 'tarifs:3' }]);
    // Clavier : le focus passe sur « Retirer » (le bouton de la pièce choisie a disparu)
    expect(screen.getByRole('button', { name: 'Retirer l’association de la ligne 6' })).toHaveFocus();
    const coche = screen.getByRole('checkbox', { name: /Appliquer le prix de la ligne 6 à Apple iPhone 13/ });
    expect(coche).toBeDisabled();
    expect(coche).not.toBeChecked();
    expect(screen.getByText('Calcul du prix par le serveur…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Appliquer' })).toBeDisabled();

    await act(async () => { reponse.resoudre([EVAL]); });
    const panneau = screen.getByRole('tabpanel');
    expect(within(panneau).getByText('Prix calculé par le serveur avec vos règles.')).toBeInTheDocument();
    // Prix actuels lus par le serveur (40 € HT, et non les 60 € de la grille affichée)
    expect(within(panneau).getByText('40 €')).toBeInTheDocument();
    expect(within(panneau).getByText('(+1 € (+3 %))')).toBeInTheDocument();
    expect(within(panneau).getByText('119 €')).toBeInTheDocument();
    expect(coche).toBeEnabled();
    expect(coche).toBeChecked();
    expect(screen.queryByText('Prix du fichier non lu')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
    await waitFor(() => expect(apiMock.appliquerImportPrix).toHaveBeenCalledWith(7, {
      lignes: [], associations: [{ n: 6, cle: 'tarifs:3' }], nouvelles: [], marquer_obsoletes: false, ignorer_invalides: false,
    }));
  });

  it('alerte du serveur : décochée par défaut ; cochée à la main, elle part dans « confirmees »', async () => {
    apiMock.evaluerAssociationsImport.mockResolvedValue([{
      ...EVAL, ancien_ht: 60, nouveau_ht: 41, alerte: 'variation', alertes: ['variation'], confirmation_requise: true,
    }]);
    apiMock.appliquerImportPrix.mockResolvedValue({ lot_id: 'lot-2', modifies: 1, ajoutes: 0, obsoletes: 0, verrouilles: 0, confirmes: 0, associees: 1, associations_ignorees: [] });
    await associerLigne6();
    const panneau = screen.getByRole('tabpanel');
    expect(await within(panneau).findByText('Grosse variation')).toBeInTheDocument();
    const coche = screen.getByRole('checkbox', { name: /Appliquer le prix de la ligne 6 à Apple iPhone 13/ });
    expect(coche).not.toBeChecked();
    expect(screen.getByText(/1 à vérifier, non cochée/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Appliquer' })).toBeDisabled(); // rien d'autre à appliquer
    fireEvent.click(coche);
    expect(coche).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
    await waitFor(() => expect(apiMock.appliquerImportPrix).toHaveBeenCalledWith(7, {
      lignes: [], associations: [{ n: 6, cle: 'tarifs:3' }], nouvelles: [], marquer_obsoletes: false, ignorer_invalides: false, confirmees: [6],
    }));
  });

  it('aperçu sans nouveau_ht : le prix vient de l’évaluation, plus de « Prix du fichier non lu »', async () => {
    apiMock.evaluerAssociationsImport.mockResolvedValue([EVAL]);
    const { nouveau_ht: _ht, ...sansPrix } = APERCU.non_reconnues[0];
    await associerLigne6({ ...APERCU, non_reconnues: [sansPrix] });
    expect(await screen.findByText('Prix calculé par le serveur avec vos règles.')).toBeInTheDocument();
    expect(screen.getByText('Prix du fichier :').closest('span')).toHaveTextContent('Prix du fichier : 41 € HT');
    expect(screen.queryByText(/Prix du fichier non lu/)).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Appliquer le prix de la ligne 6/ })).toBeChecked();
  });

  it('association refusée par le serveur : message clair, aucune case, rien n’est envoyé ; « Retirer » rend la recherche', async () => {
    apiMock.evaluerAssociationsImport.mockResolvedValue([{ n: 6, cle: 'tarifs:3', erreur: 'Pièce introuvable : tarifs:3' }]);
    await associerLigne6();
    expect(await screen.findByText('Association impossible : Pièce introuvable : tarifs:3')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Appliquer le prix de la ligne 6/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Appliquer' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retirer l’association de la ligne 6' }));
    expect(screen.getByLabelText('Associer la ligne 6 à une pièce')).toHaveFocus();
  });

  it('serveur sans la route /evaluer (404) : calcul local en repli, signalé', async () => {
    apiMock.evaluerAssociationsImport.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
    await associerLigne6();
    expect(await screen.findByText('Aperçu calculé sur ce poste.')).toBeInTheDocument();
    // Local : 60 → 41 € HT (−32 %) : grosse variation, décochée
    expect(screen.getByText('Grosse variation')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Appliquer le prix de la ligne 6/ })).not.toBeChecked();
  });

  it('bilan : associations écartées par le serveur listées', async () => {
    apiMock.evaluerAssociationsImport.mockResolvedValue([EVAL]);
    apiMock.appliquerImportPrix.mockResolvedValue({
      lot_id: 'lot-3', modifies: 0, ajoutes: 0, obsoletes: 0, verrouilles: 0, confirmes: 0, associees: 0,
      associations_ignorees: [{ ...EVAL, alertes: ['marge'], alerte: 'marge' }],
    });
    await associerLigne6();
    await screen.findByText('Prix calculé par le serveur avec vos règles.');
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
    expect(await screen.findByText(/association non appliquée \(à vérifier, non confirmée\)/)).toHaveTextContent('ligne 6 → Apple iPhone 13 · Ecran Incell (Marge trop faible)');
  });

  it('lireEvaluation : réponse du serveur → aperçu (ligne et pièce visées)', () => {
    expect(lireEvaluation([EVAL], 6, 'tarifs:3')).toMatchObject({ serveur: true, ancienHt: 40, nouveauHt: 41, nouveauClient: 119, alertes: [], confirmation: false });
    expect(lireEvaluation([EVAL], 6, 'tarifs:4')).toBeNull();
    expect(lireEvaluation({ associations: [{ ...EVAL, alertes: ['verrou'], verrou: true }] }, 6, 'tarifs:3')).toMatchObject({ verrou: true, alertes: ['verrou'] });
    expect(lireEvaluation([], 6, 'tarifs:3')).toBeNull();
    expect(lireEvaluation([{ n: 6, cle: 'tarifs:3', erreur: 'Ligne 6 : absente de l’aperçu ou invalide' }], 6, 'tarifs:3').erreur).toMatch(/absente/);
  });
});

// ─── Cadenas des grilles boutique ──────────────────────
describe('cadenas des grilles boutique : refus et lignes laissées telles quelles', () => {
  const refus = (message) => Object.assign(new Error(message), { status: 409, code: 'verrouille', detail: { code: 'verrouille' } });

  it('409 « verrouille » : consigne claire, ou le message du serveur s’il est parlant', () => {
    expect(messageErreurPrix(refus('Erreur 409 (verrouille)'), 'Prix non enregistré'))
      .toBe('Prix non enregistré : prix verrouillé (cadenas fermé). Ouvrez le cadenas de la ligne pour le modifier.');
    expect(messageErreurPrix(refus('Prix verrouillé : déverrouillez la pièce avant d’accepter la proposition.'), 'Proposition non acceptée'))
      .toBe('Proposition non acceptée : Prix verrouillé : déverrouillez la pièce avant d’accepter la proposition.');
    // Autre conflit : inchangé
    expect(messageErreurPrix({ status: 409, message: 'Ce modele existe deja dans la grille' }, 'Modèle non ajouté'))
      .toBe('Modèle non ajouté : Ce modele existe deja dans la grille');
  });

  it('simuler : lignes verrouillées listées ; appliquer : « Lignes verrouillées, non modifiées » listées', () => {
    const liste = [{ cle: 'tarifs_reparation:9:batterie', label: 'iPhone 13 — batterie' }];
    const { unmount } = render(<ApercuSimulation resultat={{ modifies: 2, inchanges: 5, verrouilles: 1, ecarts: [], verrouilles_liste: liste }} />);
    expect(screen.getByText('Voir les 1 prix verrouillés (non modifiés)')).toBeInTheDocument();
    expect(screen.getByText('iPhone 13 — batterie')).toBeInTheDocument();
    unmount();
    render(<ResultatApplication resultat={{ lot_id: 'lot-9', modifies: 1, verrouilles: 1, verrouilles_liste: liste }} sensible={(fn) => fn()} />);
    expect(screen.getByText(/1 prix mis à jour\. 1 prix verrouillés n’ont pas bougé\./)).toBeInTheDocument();
    expect(screen.getByText('Lignes verrouillées, non modifiées (1)')).toBeInTheDocument();
    expect(screen.getByText('iPhone 13 — batterie')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Annuler ce changement/ })).toBeInTheDocument();
  });
});

// ─── Import : absentes du fichier et associations ──────
const ABSENTES = [
  { cle: 'tarifs:3', label: 'Apple iPhone 13 · Ecran Incell', verrou: false, type_piece: 'Ecran' },
  { cle: 'tarifs:9', label: 'Huawei P30 · Ecran', verrou: false, type_piece: 'Ecran' },
  { cle: 'tarifs:10', label: 'Huawei P40 · Ecran', verrou: true, type_piece: 'Ecran' },
];
const resumeAppliquer = () => screen.getByText((_, el) => el?.tagName === 'P' && /^À appliquer/.test(el.textContent || ''));

describe('Import : une pièce associée à la main n’est plus « absente du fichier »', () => {
  it('ligneDeCle / absentesApresAssociations : par ligne de grille (iPad / MacBook en entier), verrouillées jamais marquées', () => {
    expect(ligneDeCle('tarifs:12')).toBe('tarifs:12');
    expect(ligneDeCle('tarifs_apple_devices:5:ecran')).toBe('tarifs_apple_devices:5');
    const r = absentesApresAssociations(ABSENTES, ['tarifs:3', 'tarifs:1']);
    expect(r.visibles.map((a) => a.cle)).toEqual(['tarifs:9', 'tarifs:10']);
    expect(r.aMarquer.map((a) => a.cle)).toEqual(['tarifs:9']);
    expect(r.retirees).toBe(1);
    // « tarifs:1 » ne retire pas « tarifs:10 » ; un iPad associé par sa batterie garde aussi son écran
    const apple = [
      { cle: 'tarifs_apple_devices:5:ecran' }, { cle: 'tarifs_apple_devices:5:batterie' }, { cle: 'tarifs_apple_devices:6:ecran', verrou: true },
    ];
    expect(absentesApresAssociations(apple, ['tarifs_apple_devices:5:batterie'])).toEqual({
      visibles: [apple[2]], aMarquer: [], retirees: 2,
    });
  });

  it('association appliquée : retirée de la liste, des compteurs et de « Marquer comme obsolètes »', async () => {
    apiMock.evaluerAssociationsImport.mockResolvedValue([EVAL]);
    apiMock.appliquerImportPrix.mockResolvedValue({ lot_id: 'lot-4', modifies: 1, ajoutes: 0, obsoletes: 1, verrouilles: 0, confirmes: 0, associees: 1, associations_ignorees: [] });
    await associerLigne6({ ...APERCU, absentes: ABSENTES });
    await screen.findByText('Prix calculé par le serveur avec vos règles.');
    expect(screen.getByRole('tab', { name: 'Absentes du fichier (2)' })).toBeInTheDocument();
    expect(screen.getByText('2 absentes du fichier')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Absentes du fichier/ }));
    const panneau = screen.getByRole('tabpanel');
    expect(within(panneau).getByRole('note')).toHaveTextContent('1 pièce associée à une ligne du fichier (onglet « À associer ») : retirée de cette liste, elle ne sera pas marquée obsolète.');
    expect(within(panneau).queryByText('Apple iPhone 13 · Ecran Incell')).not.toBeInTheDocument();
    expect(within(panneau).getByText('Huawei P30 · Ecran')).toBeInTheDocument();
    expect(within(panneau).getByText(/verrouillée : gardée/)).toBeInTheDocument();
    // Seule la pièce non verrouillée sera marquée
    const marquer = within(panneau).getByRole('checkbox', { name: /Marquer cette pièce comme obsolète/ });
    expect(within(panneau).getByText(/La pièce verrouillée reste dans la grille\./)).toBeInTheDocument();
    fireEvent.click(marquer);
    expect(resumeAppliquer()).toHaveTextContent(/1 association, 1 obsolète\.$/);

    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
    await waitFor(() => expect(apiMock.appliquerImportPrix).toHaveBeenCalledWith(7, {
      lignes: [], associations: [{ n: 6, cle: 'tarifs:3' }], nouvelles: [], marquer_obsoletes: true, ignorer_invalides: false,
    }));
  });

  it('association non cochée (alerte) : la pièce reste absente, et le dit ; cochée, elle sort de la liste', async () => {
    apiMock.evaluerAssociationsImport.mockResolvedValue([{
      ...EVAL, ancien_ht: 60, nouveau_ht: 41, alerte: 'variation', alertes: ['variation'], confirmation_requise: true,
    }]);
    await associerLigne6({ ...APERCU, absentes: ABSENTES });
    expect(await screen.findByText('Non appliquée : cette pièce reste dans l’onglet « Absentes du fichier ».')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Absentes du fichier (3)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Absentes du fichier/ }));
    fireEvent.click(within(screen.getByRole('tabpanel')).getByRole('checkbox', { name: /Marquer ces 2 pièces comme obsolètes/ }));
    expect(resumeAppliquer()).toHaveTextContent(/2 obsolètes\.$/);
    fireEvent.click(screen.getByRole('tab', { name: /À associer/ }));
    expect(screen.getByText('Non appliquée : cette pièce est absente du fichier et sera marquée obsolète (onglet « Absentes du fichier »).')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /Appliquer le prix de la ligne 6/ }));
    expect(screen.queryByText(/^Non appliquée/)).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Absentes du fichier (2)' })).toBeInTheDocument();
    expect(resumeAppliquer()).toHaveTextContent(/1 association, 1 obsolète\.$/);
  });
});

// ─── Annulation d'un lot : bilan lisible ───────────────
describe('annulation d’un lot : lignes verrouillées distinguées des prix modifiés depuis', () => {
  // Une ligne de grille boutique cadenassée : un conflit par colonne de prix, une seule ligne verrouillée
  const CADENAS = {
    restaures: 0, verrouilles: ['tarifs_reparation:3'],
    conflits: ['tarifs_reparation:3:ecran', 'tarifs_reparation:3:batterie', 'tarifs_reparation:3:connecteur'],
    propositions_rouvertes: 0, propositions_annulees: 0,
  };

  it('bilan : « modifié depuis » seulement pour les prix vraiment modifiés ; propositions rouvertes ou annulées dites', () => {
    expect(bilanAnnulation(CADENAS)).toMatchObject({ complet: false, modifies: 0, verrouillees: 1 });
    expect(messageAnnulation(CADENAS, { sujet: 'Lot annulé' })).toEqual(expect.objectContaining({
      ton: 'warning', texte: 'Aucun prix rétabli : 1 ligne verrouillée, non rétablie : ouvrez le cadenas pour la modifier.',
    }));
    const mixte = {
      restaures: 2, conflits: ['tarifs:1', 'tarifs:2', 'tarifs_apple_devices:5:ecran'], verrouilles: ['tarifs:2', 'tarifs_apple_devices:5'],
      propositions_rouvertes: 1, propositions_annulees: 2,
    };
    expect(messageAnnulation(mixte, { sujet: 'Lot annulé' }).texte).toBe(
      'Lot annulé en partie : 2 prix remis à leur valeur d’avant ; 1 prix modifié depuis, laissé tel quel ; '
      + '2 lignes verrouillées, non rétablies : ouvrez le cadenas pour les modifier. '
      + '1 proposition de prix remise en attente ; 2 propositions de prix annulées.',
    );
    // Tout rétabli : message habituel, propositions remises en attente signalées
    expect(messageAnnulation({ restaures: 2, conflits: [], verrouilles: [], propositions_rouvertes: 1 }, { sujet: 'Lot annulé', succes: 'Lot annulé : 2 prix remis à leur valeur d’avant.' }))
      .toEqual(expect.objectContaining({ ton: 'success', texte: 'Lot annulé : 2 prix remis à leur valeur d’avant. 1 proposition de prix remise en attente.' }));
    expect(messageAnnulation({ restaures: 3, conflits: [] }).texte).toBe('Changement annulé : les prix sont revenus à leur valeur d’avant.');
    expect(messageAnnulation({ restaures: 0, conflits: [], regles: 'conflit' }, { sujet: 'Règles annulées' }).texte)
      .toBe('Aucun prix rétabli : règles de marge modifiées depuis, gardées telles quelles.');
  });

  it('« Annuler ce changement » sur une ligne cadenassée : avertissement juste, bandeau qui le garde', async () => {
    apiMock.annulerLotPrix.mockResolvedValue(CADENAS);
    render(<ResultatApplication resultat={{ lot_id: 'lot-c', modifies: 3, verrouilles: 0 }} sensible={(fn) => fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Annuler ce changement/ }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith('Aucun prix rétabli : 1 ligne verrouillée, non rétablie : ouvrez le cadenas pour la modifier.'));
    expect(toast.warning.mock.calls[0][0]).not.toMatch(/modifiés? depuis/);
    expect(screen.getByRole('status')).toHaveTextContent('Aucun prix rétabli : 1 ligne verrouillée, non rétablie');
    expect(screen.queryByRole('button', { name: /Annuler ce changement/ })).not.toBeInTheDocument();
  });
});

// ─── Cadenas boutique : aide conforme au serveur ────────
describe('aide du cadenas des grilles boutique', () => {
  it('dit ce que le serveur protège, sans « repère d’écran »', () => {
    for (const texte of Object.values(AIDE_VERROU_BOUTIQUE)) {
      expect(texte).not.toMatch(/repère d’écran|pas un verrou du serveur|ne l’impose pas/);
      expect(texte).toMatch(/ajustements en %, des mises à jour en masse et des annulations/);
    }
  });
});

// ─── « Ajouter une pièce » : préremplie dès le premier rendu ───
describe('fenêtre « Ajouter une pièce »', () => {
  it('marque et modèle déjà dans le tout premier rendu (aucun effet nécessaire)', () => {
    // Rendu serveur : aucun effet n'est exécuté ; un préremplissage fait par un effet laisserait les champs vides
    const html = renderToString(
      <AjoutPiecePrix open onClose={() => {}} regles={REGLES_DEFAUT} catalogue={TARIFS} initial={{ marque: 'Samsung', modele: 'Galaxy A12' }} />,
    );
    expect(html).toMatch(/value="Samsung"/);
    expect(html).toMatch(/value="Galaxy A12"/);
  });

  it('fermée puis rouverte : repart de la nouvelle recherche', () => {
    const props = { onClose: () => {}, regles: REGLES_DEFAUT, catalogue: TARIFS };
    const { rerender } = render(<AjoutPiecePrix open {...props} initial={{ marque: 'Samsung', modele: 'Galaxy A12' }} />);
    expect(screen.getByLabelText('Marque')).toHaveValue('Samsung');
    fireEvent.change(screen.getByLabelText('Modèle'), { target: { value: 'Galaxy A13' } });
    rerender(<AjoutPiecePrix open={false} {...props} initial={{ marque: 'Apple', modele: 'iPhone 13' }} />);
    rerender(<AjoutPiecePrix open {...props} initial={{ marque: 'Apple', modele: 'iPhone 13' }} />);
    expect(screen.getByLabelText('Marque')).toHaveValue('Apple');
    expect(screen.getByLabelText('Modèle')).toHaveValue('iPhone 13');
  });
});
