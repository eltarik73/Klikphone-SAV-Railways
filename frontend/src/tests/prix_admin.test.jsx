/**
 * Écrans de prix (admin) : bandeau « Prix du fournisseur », badges de fraîcheur, verrou, Recalculer avec
 * élévation admin, Règles de prix (Appliquer seulement après Simuler), ajustement global et par colonne,
 * import d'un fichier (alertes en haut, grosses variations décochées, annulation de l'import), historique
 * (annulation d'un lot) et erreurs d'enregistrement en toast lisible.
 * Correctifs : Recalculer avec aperçu, effet réel d'un ajustement (prix client / prix d'achat), prix signalés
 * à accepter explicitement, aperçu des lignes associées à la main, pièce verrouillée d'une ligne multiple,
 * bulle du chat masquée, âge recalculé après saisie, ?q= et « Ajouter une pièce », smartphones inactifs exclus,
 * modifications non enregistrées avant un ajustement.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { toast, apiMock } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), important: vi.fn() },
  apiMock: {
    getTarifs: vi.fn(),
    getTarifsStats: vi.fn(),
    getAppleDevices: vi.fn(),
    getSantePrix: vi.fn(),
    getReglesPrix: vi.fn(),
    simulerPrix: vi.fn(),
    appliquerPrix: vi.fn(),
    recalculerTarifs: vi.fn(),
    apercuImportPrix: vi.fn(),
    appliquerImportPrix: vi.fn(),
    getHistoriquePrix: vi.fn(),
    getLotsPrix: vi.fn(),
    annulerLotPrix: vi.fn(),
    setVerrouPrix: vi.fn(),
    toggleTarifStock: vi.fn(),
    checkTarifStock: vi.fn(),
    verifyAdmin: vi.fn(),
    getConfig: vi.fn(),
    setParam: vi.fn(),
    getTarifsReparation: vi.fn(),
    updateTarifReparation: vi.fn(),
    addTarifReparation: vi.fn(),
    deleteTarifReparation: vi.fn(),
    reorderTarifsReparation: vi.fn(),
    clearAdminToken: vi.fn(),
    creerLignePrix: vi.fn(),
    getPrixAchat: vi.fn(),
    getSmartphonesTarifs: vi.fn(),
    updateSmartphoneTarif: vi.fn(),
  },
}));

vi.mock('../components/Toast', () => ({ useToast: () => toast }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));

import { clearCache } from '../hooks/useApi';
import TarifsPage from '../pages/TarifsPage';
import TarifsReparationPage from '../pages/TarifsReparationPage';
import AdminTarifsSmartphonesPage from '../pages/AdminTarifsSmartphonesPage';
import ReglesPrixPanel, {
  AjustementColonne, FenetreRecalcul, REGLES_DEFAUT, ajusterHt, arrondi9, compterPrixClientLocal, prixClientQuiChangent,
} from '../components/ReglesPrixPanel';
import ImportPrixModal, { apercuAssociation } from '../components/ImportPrixModal';
import HistoriquePrix, {
  BadgeDatePrix, CSS_SANS_BULLE_CHAT, FenetrePrix, fraicheurPrix, messageErreurPrix, prixClientPiece,
} from '../components/HistoriquePrix';

const ESTIME = { prix_source: 'estimation_2026_02', prix_maj_le: '2026-02-15T19:27:49.972983', fraicheur: 'perime', age_jours: 243, estime: true };
const TARIFS = [
  { id: 1, marque: 'Samsung', modele: 'Galaxy S21', type_piece: 'Ecran', qualite: 'OLED', prix_client: 189, prix_fournisseur_ht: 105, categorie: 'standard', en_stock: true, verrou_manuel: false, ...ESTIME },
  { id: 2, marque: 'Samsung', modele: 'Galaxy S21', type_piece: 'Batterie', qualite: null, prix_client: 89, prix_fournisseur_ht: 20, categorie: 'standard', en_stock: true, verrou_manuel: true, ...ESTIME },
  { id: 3, marque: 'Apple', modele: 'iPhone 13', type_piece: 'Ecran', qualite: 'Incell', prix_client: 109, prix_fournisseur_ht: 40, categorie: 'standard', en_stock: true, verrou_manuel: false, ...ESTIME },
];
const STATS = { modeles: 2, marques: 2, prix_min: 89, prix_max: 189 };

const pageTarifs = () => render(<MemoryRouter initialEntries={['/accueil/tarifs']}><TarifsPage /></MemoryRouter>);
const echecAdmin = () => Object.assign(new Error('Élévation administrateur requise'), { status: 403, code: 'admin_required' });

beforeEach(() => {
  vi.clearAllMocks();
  clearCache();
  localStorage.clear();
  apiMock.getTarifs.mockResolvedValue(TARIFS);
  apiMock.getTarifsStats.mockResolvedValue(STATS);
  apiMock.getAppleDevices.mockResolvedValue([]);
  apiMock.getSantePrix.mockResolvedValue({ total: 3, estimes: 3, a_revoir: 0, perimes: 3, propositions_en_attente: 0, marges_faibles: 0 });
  apiMock.getReglesPrix.mockResolvedValue({ ...REGLES_DEFAUT });
  apiMock.getConfig.mockResolvedValue([]);
});

afterEach(() => cleanup());

// ─── Fraîcheur ─────────────────────────────────────
describe('fraîcheur des prix', () => {
  const maintenant = new Date('2026-10-16T12:00:00').getTime();
  const ilYa = (jours) => new Date(maintenant - jours * 86_400_000).toISOString();

  it('gris sous 90 jours, orange au-delà, rouge après 180, « estimé » selon la source', () => {
    expect(fraicheurPrix({ prix_maj_le: ilYa(10) }, undefined, maintenant).niveau).toBe('ok');
    expect(fraicheurPrix({ prix_maj_le: ilYa(100) }, undefined, maintenant).niveau).toBe('a_revoir');
    expect(fraicheurPrix({ prix_maj_le: ilYa(200) }, undefined, maintenant).niveau).toBe('perime');
    expect(fraicheurPrix({ prix_maj_le: ilYa(5), prix_source: 'estimation_2026_02' }, undefined, maintenant).estime).toBe(true);
    // Repli sur updated_at (grilles boutique avant migration) ; seuils réglables
    expect(fraicheurPrix({ updated_at: ilYa(40) }, { jours_a_revoir: 30, jours_perime: 60 }, maintenant).niveau).toBe('a_revoir');
    expect(fraicheurPrix({}, undefined, maintenant).niveau).toBe('inconnu');
  });

  it('badge : date lisible, mention « estimé » et phrase pour les lecteurs d’écran', () => {
    render(<BadgeDatePrix row={TARIFS[0]} />);
    expect(screen.getByText('Prix du 15/02/2026')).toBeInTheDocument();
    expect(screen.getByText('estimé')).toBeInTheDocument();
    expect(screen.getByText(/Prix du 15\/02\/2026, estimé, jamais vérifié, plus de 6 mois : périmé/)).toBeInTheDocument();
  });

  it('arrondi au 9 supérieur identique au serveur', () => {
    expect([61, 72, 90, 91, 101, 109, 114].map(arrondi9)).toEqual([69, 79, 99, 99, 109, 109, 119]);
  });

  it('message d’erreur lisible ; rien quand l’identification est annulée', () => {
    expect(messageErreurPrix({ code: 'admin_cancelled' })).toBeNull();
    expect(messageErreurPrix({ status: 403, message: 'Admin requis' }, 'Prix non enregistré')).toBe('Prix non enregistré : réservé à l’administrateur.');
    expect(messageErreurPrix({ status: 500, message: 'Base indisponible' }, 'Prix non enregistré')).toBe('Prix non enregistré : Base indisponible');
  });
});

// ─── TarifsPage ────────────────────────────────────
describe('TarifsPage', () => {
  it('bandeau « Prix du fournisseur : estimés le 15/02/2026 » et les 4 actions pour l’admin', async () => {
    localStorage.setItem('klikphone_admin', 'true');
    pageTarifs();
    expect(await screen.findByText('Prix du fournisseur : estimés le 15/02/2026')).toBeInTheDocument();
    expect(screen.getByText(/3 prix de plus de 6 mois/)).toBeInTheDocument();
    for (const nom of ['Importer une liste de prix', 'Règles de prix', 'Recalculer', 'Historique']) {
      expect(screen.getByRole('button', { name: new RegExp(nom) })).toBeInTheDocument();
    }
    // Filtre « plus de 3 mois » avec le nombre de prix concernés
    expect(screen.getByRole('button', { name: /Plus de 3 mois/ })).toHaveTextContent('3');
  });

  it('sans le mode admin : bandeau en lecture, bouton pour s’identifier, pas d’actions', async () => {
    pageTarifs();
    expect(await screen.findByText('Prix du fournisseur : estimés le 15/02/2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mettre à jour les prix \(admin\)/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Importer une liste de prix/ })).not.toBeInTheDocument();
  });

  it('carte d’une pièce : date du prix et cadenas ; le verrou passe par l’API', async () => {
    localStorage.setItem('klikphone_admin', 'true');
    apiMock.setVerrouPrix.mockResolvedValue({ id: 1, verrou_manuel: true });
    pageTarifs();
    fireEvent.click(await screen.findByRole('button', { name: /^Samsung\s*1 modele$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Galaxy S21/ }));
    expect(screen.getAllByText('15/02/26').length).toBeGreaterThan(0);
    // La batterie est déjà verrouillée
    expect(screen.getByRole('button', { name: 'Déverrouiller le prix de Samsung Galaxy S21 · Batterie' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Verrouiller le prix de Samsung Galaxy S21 · Ecran OLED' }));
    await waitFor(() => expect(apiMock.setVerrouPrix).toHaveBeenCalledWith(1, true));
    expect(await screen.findByRole('button', { name: 'Déverrouiller le prix de Samsung Galaxy S21 · Ecran OLED' })).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Samsung Galaxy S21 · Ecran OLED : prix verrouillé.');
  });

  it('stock non modifié : toast lisible, plus de console.error silencieux', async () => {
    localStorage.setItem('klikphone_admin', 'true');
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    apiMock.toggleTarifStock.mockRejectedValue(Object.assign(new Error('Base indisponible'), { status: 500 }));
    pageTarifs();
    fireEvent.click(await screen.findByRole('button', { name: /^Samsung\s*1 modele$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Galaxy S21/ }));
    fireEvent.click(screen.getByRole('button', { name: /Samsung Galaxy S21 · Ecran OLED : en stock/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Stock non modifié : Base indisponible'));
    expect(consoleErr).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('Recalculer : aperçu d’abord (élévation admin demandée puis rejouée), puis « Recalculer (N prix) »', async () => {
    localStorage.setItem('klikphone_admin', 'true');
    apiMock.simulerPrix
      .mockRejectedValueOnce(echecAdmin())
      .mockResolvedValueOnce({
        modifies: 3, inchanges: 1199, verrouilles: 1, ignores: 0, alertes: 0, variation_moy: 10, variation_min: 10,
        variation_max: 10, variation_moy_pct: 5.2,
        ecarts: [{ cle: 'tarifs:1', label: 'Samsung Galaxy S21 — Ecran OLED', ancien: 189, nouveau: 199, ancien_ht: 105, nouveau_ht: 105, alertes: [] }],
      });
    apiMock.recalculerTarifs.mockResolvedValueOnce({ modifies: 3, inchanges: 1199, ignores: 1, sans_prix_achat: 0, verrouilles: 1, lot_id: 'lot-r' });
    apiMock.verifyAdmin.mockResolvedValue({ success: true, admin_token: 'jeton' });
    pageTarifs();
    fireEvent.click(await screen.findByRole('button', { name: /Recalculer/ }));
    // L'aperçu (simulation {}) est demandé à l'ouverture : élévation admin, puis rejeu
    expect(await screen.findByText('Accès Administrateur')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Identifiant'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByText('Ce que le recalcul changerait')).toBeInTheDocument();
    expect(apiMock.simulerPrix).toHaveBeenCalledTimes(2);
    expect(apiMock.simulerPrix).toHaveBeenLastCalledWith({});
    expect(apiMock.recalculerTarifs).not.toHaveBeenCalled();
    expect(screen.getByText('Samsung Galaxy S21 — Ecran OLED')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recalculer (3 prix)' }));
    expect(await screen.findByText('Recalcul terminé.')).toBeInTheDocument();
    expect(apiMock.recalculerTarifs).toHaveBeenCalledTimes(1);
    expect(screen.getByText('1199')).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('3 prix client recalculés.');
    expect(screen.getByRole('button', { name: /Annuler ce recalcul/ })).toBeInTheDocument();
  });

  it('Recalculer : désactivé quand rien ne change, prix signalés à accepter avant de recalculer', async () => {
    apiMock.simulerPrix.mockResolvedValueOnce({ modifies: 0, inchanges: 1202, verrouilles: 0, ignores: 0, alertes: 0, ecarts: [] });
    const { unmount } = render(<FenetreRecalcul open onClose={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Rien à recalculer' })).toBeDisabled();
    expect(screen.getByText(/rien à recalculer/)).toBeInTheDocument();
    unmount();

    apiMock.simulerPrix.mockResolvedValueOnce({
      modifies: 2, inchanges: 1200, verrouilles: 0, ignores: 0, alertes: 1, variation_moy: 25, variation_min: 10, variation_max: 40,
      ecarts: [{ cle: 'tarifs:3', label: 'Apple iPhone 13 — Ecran Incell', ancien: 109, nouveau: 149, alerte: 'variation', alertes: ['variation'] }],
    });
    render(<FenetreRecalcul open onClose={vi.fn()} />);
    const bouton = await screen.findByRole('button', { name: 'Recalculer (2 prix)' });
    expect(bouton).toBeDisabled();
    expect(screen.getByText('Grosse variation')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /1 prix signalé/ }));
    expect(bouton).toBeEnabled();
  });

  it('?q= (modèles sans prix) : recherche préremplie, « Ajouter une pièce » enregistre la pièce sous élévation', async () => {
    localStorage.setItem('klikphone_admin', 'true');
    apiMock.creerLignePrix.mockResolvedValue({ id: 99, marque: 'Samsung', modele: 'Galaxy A12', type_piece: 'Batterie', prix_client: 69, prix_fournisseur_ht: 7.5 });
    render(<MemoryRouter initialEntries={['/accueil/tarifs?q=Samsung%20Galaxy%20A12']}><TarifsPage /></MemoryRouter>);
    expect(await screen.findByText('Aucune pièce pour « Samsung Galaxy A12 ».')).toBeInTheDocument();
    expect(screen.getByLabelText('Rechercher un modèle')).toHaveValue('Samsung Galaxy A12');
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une pièce pour ce modèle' }));
    const fenetre = await screen.findByRole('dialog', { name: 'Ajouter une pièce' });
    expect(within(fenetre).getByLabelText('Marque')).toHaveValue('Samsung');
    expect(within(fenetre).getByLabelText('Modèle')).toHaveValue('Galaxy A12');
    fireEvent.change(within(fenetre).getByLabelText('Pièce'), { target: { value: 'Batterie' } });
    fireEvent.change(within(fenetre).getByLabelText('Prix d’achat HT (€)'), { target: { value: '7,5' } });
    // 7,5 × 1,2 + 60 = 69 → 69 €
    expect(within(fenetre).getByText('69 €')).toBeInTheDocument();
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Ajouter la pièce' }));
    await waitFor(() => expect(apiMock.creerLignePrix).toHaveBeenCalledWith({
      marque: 'Samsung', modele: 'Galaxy A12', type_piece: 'Batterie', qualite: null, categorie: 'standard', prix_fournisseur_ht: 7.5,
    }));
    expect(toast.success).toHaveBeenCalledWith('Pièce ajoutée : Samsung Galaxy A12 · Batterie à 69 €.');
    await waitFor(() => expect(apiMock.getTarifs).toHaveBeenCalledTimes(2));
  });

  it('recherche par mots (« Samsung Galaxy S21 ») et pièce déjà existante signalée', async () => {
    localStorage.setItem('klikphone_admin', 'true');
    apiMock.creerLignePrix.mockRejectedValue(Object.assign(new Error('Cette pièce existe déjà : modifiez son prix.'), { status: 409, code: 'piece_existante' }));
    render(<MemoryRouter initialEntries={['/accueil/tarifs?q=Samsung%20Galaxy%20S21']}><TarifsPage /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: /^Samsung\s*1 modele$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Apple/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ajouter une pièce/ }));
    const fenetre = await screen.findByRole('dialog', { name: 'Ajouter une pièce' });
    fireEvent.change(within(fenetre).getByLabelText('Pièce'), { target: { value: 'Batterie' } });
    fireEvent.click(within(fenetre).getByLabelText('Prix client fixé à la main'));
    expect(within(fenetre).getByText(/la pièce sera verrouillée/)).toBeInTheDocument();
    fireEvent.change(within(fenetre).getByLabelText('Prix client (€)'), { target: { value: '89' } });
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Ajouter la pièce' }));
    expect(await within(fenetre).findByText('Cette pièce existe déjà dans la grille.')).toBeInTheDocument();
    expect(apiMock.creerLignePrix.mock.calls[0][0]).toMatchObject({ marque: 'Samsung', modele: 'Galaxy S21', prix_client: 89 });
    expect(within(fenetre).getByRole('button', { name: 'Voir la pièce' })).toBeInTheDocument();
  });

  it('prix d’achat masqués sans le code admin : « Prix HT » les relit après l’identification', async () => {
    localStorage.setItem('klikphone_admin', 'true');
    const sansHt = TARIFS.map(({ prix_fournisseur_ht: _ht, ...t }) => t);
    apiMock.getTarifs.mockResolvedValue(sansHt);
    apiMock.getPrixAchat.mockResolvedValue({ tarifs: TARIFS, appleDevices: [] });
    pageTarifs();
    const bouton = await screen.findByRole('button', { name: /Prix HT masques/ });
    fireEvent.click(bouton);
    await waitFor(() => expect(apiMock.getPrixAchat).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /Prix HT visibles/ })).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(screen.getByRole('button', { name: /^Samsung\s*1 modele$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Galaxy S21/ }));
    expect(screen.getByText('Achat : 105.00 € HT')).toBeInTheDocument();
  });

  it('les fenêtres Règles de prix et Importer s’ouvrent depuis le bandeau', async () => {
    localStorage.setItem('klikphone_admin', 'true');
    pageTarifs();
    fireEvent.click(await screen.findByRole('button', { name: /Règles de prix/ }));
    expect(await screen.findByRole('dialog', { name: 'Règles de prix' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    fireEvent.click(screen.getByRole('button', { name: /Importer une liste de prix/ }));
    expect(await screen.findByRole('dialog', { name: 'Importer une liste de prix' })).toBeInTheDocument();
  });
});

// ─── Règles de prix ────────────────────────────────
describe('ReglesPrixPanel', () => {
  const SIMULATION = {
    modifies: 12, inchanges: 1190, verrouilles: 1, ignores: 0, variation_moy: 8.33, variation_min: 0, variation_max: 10,
    variation_moy_pct: 4.2, alertes: 0, verrouilles_liste: [{ cle: 'tarifs:2', label: 'Samsung Galaxy S21 · Batterie' }],
    ecarts: [{ cle: 'tarifs:1', label: 'Samsung Galaxy S21 · Ecran OLED', ancien: 189, nouveau: 199, alerte: null, alertes: [] }],
  };
  const panneau = (props = {}) => render(
    <ReglesPrixPanel open onClose={vi.fn()} tarifs={TARIFS} appleDevices={[]} onApplique={vi.fn()} {...props} />,
  );

  it('Appliquer reste désactivé tant qu’on n’a pas simulé ; l’aperçu chiffré s’affiche', async () => {
    apiMock.simulerPrix.mockResolvedValue(SIMULATION);
    apiMock.appliquerPrix.mockResolvedValue({ lot_id: 'lot-1', modifies: 12, verrouilles: 1 });
    const onApplique = vi.fn();
    panneau({ onApplique });
    const ecran = await screen.findByLabelText('Écran standard');
    expect(ecran).toHaveValue('60');
    const appliquer = () => screen.getByRole('button', { name: /^Appliquer/ });
    expect(appliquer()).toBeDisabled();

    fireEvent.change(ecran, { target: { value: '70' } });
    expect(screen.getByText(/45 × 1,2 \+ 70 = 124 € → 129 €/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Simuler' }));
    await waitFor(() => expect(apiMock.simulerPrix).toHaveBeenCalledTimes(1));
    const charge = apiMock.simulerPrix.mock.calls[0][0];
    expect(charge.regles.ecran.standard).toBe(70);
    expect(charge.regles.ecran.haut_de_gamme).toBe(70);
    expect(await screen.findByText('Prix qui changeraient')).toBeInTheDocument();
    expect(screen.getByText('+8,33 €')).toBeInTheDocument();
    expect(screen.getByText(/\+4,2 %/)).toBeInTheDocument();
    expect(screen.getByText('Samsung Galaxy S21 · Ecran OLED')).toBeInTheDocument();
    expect(appliquer()).toBeEnabled();
    expect(appliquer()).toHaveTextContent('Appliquer (12 prix)');

    // Un réglage changé après la simulation : il faut simuler à nouveau
    fireEvent.change(ecran, { target: { value: '65' } });
    expect(appliquer()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Simuler' }));
    await waitFor(() => expect(appliquer()).toBeEnabled());
    fireEvent.click(appliquer());
    await waitFor(() => expect(apiMock.appliquerPrix).toHaveBeenCalledTimes(1));
    expect(apiMock.appliquerPrix.mock.calls[0][0].regles.ecran.standard).toBe(65);
    expect(await screen.findByText(/12 prix mis à jour\./)).toBeInTheDocument();
    expect(onApplique).toHaveBeenCalled();

    apiMock.annulerLotPrix.mockResolvedValue({ restaures: 12, conflits: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Annuler ce changement' }));
    await waitFor(() => expect(apiMock.annulerLotPrix).toHaveBeenCalledWith('lot-1'));
  });

  it('saisie invalide : message et aucune simulation possible', async () => {
    panneau();
    fireEvent.change(await screen.findByLabelText('Écran pliant'), { target: { value: 'abc' } });
    expect(screen.getByRole('alert')).toHaveTextContent('« Écran pliant » : nombre positif attendu.');
    expect(screen.getByRole('button', { name: 'Simuler' })).toBeDisabled();
  });

  it('ajustement global : sélection exacte envoyée par identifiants', async () => {
    apiMock.simulerPrix.mockResolvedValue({ ...SIMULATION, modifies: 2 });
    panneau();
    fireEvent.click(await screen.findByRole('tab', { name: 'Ajustement global' }));
    fireEvent.change(screen.getByLabelText('Marque'), { target: { value: 'Samsung' } });
    expect(screen.getByText(/Environ/).textContent).toMatch(/2 prix sélectionnés, dont 1 verrouillé/);
    fireEvent.change(screen.getByLabelText(/Valeur/), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simuler' }));
    await waitFor(() => expect(apiMock.simulerPrix).toHaveBeenCalledWith({
      cible: 'tarifs', filtre: { ids: [1, 2] }, ajustement: { type: 'pct', valeur: 10 },
    }));
  });

  it('ajustement global : prix client qui changent séparés des prix d’achat, effet réel face à la demande', async () => {
    // « +5 % sur les batteries » : 267 prix d'achat, 28 prix client seulement (arrondi au 9)
    apiMock.simulerPrix.mockResolvedValue({
      modifies: 267, modifies_client: 28, inchanges: 3, verrouilles: 0, ignores: 0, alertes: 0,
      variation_moy: 1.05, variation_min: 0, variation_max: 10, variation_moy_pct: 1.5,
      ecarts: [{ cle: 'tarifs:2', label: 'Samsung Galaxy S21 — Batterie', ancien: 89, nouveau: 99, ancien_ht: 20, nouveau_ht: 21, alertes: [] }],
    });
    panneau();
    fireEvent.click(await screen.findByRole('tab', { name: 'Ajustement global' }));
    fireEvent.change(screen.getByLabelText(/Valeur/), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simuler' }));
    expect(await screen.findByText('Prix client qui changent')).toBeInTheDocument();
    expect(screen.getByText('28')).toBeInTheDocument();
    expect(screen.getByText('sur 267 prix d’achat mis à jour')).toBeInTheDocument();
    expect(screen.getByText(/Vous demandez \+5 % sur le prix d’achat HT\. Effet réel sur le prix client : \+1,5 % en moyenne \(\+1,05 €\), de 0 € à \+10 €\./)).toBeInTheDocument();
    expect(screen.getByText(/Beaucoup de prix client ne changent pas, d’autres prennent 10 € d’un coup/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Appliquer/ })).toHaveTextContent('Appliquer (28 prix client, 267 prix d’achat)');
  });

  it('ajustement global sans comptage du serveur : prix client comptés avec les règles, comme le serveur', async () => {
    // +2 % : écran OLED 105 → 107,10 € HT, prix client 188,52 → 189 (inchangé) ; batterie verrouillée exclue
    apiMock.simulerPrix.mockResolvedValue({
      modifies: 1, inchanges: 0, verrouilles: 1, ignores: 0, alertes: 0, variation_moy: 0, variation_min: 0, variation_max: 0, variation_moy_pct: 0,
      ecarts: [{ cle: 'tarifs:1', label: 'Samsung Galaxy S21 — Ecran OLED', ancien: 189, nouveau: 189, ancien_ht: 105, nouveau_ht: 107.1, alertes: [] }],
    });
    panneau();
    fireEvent.click(await screen.findByRole('tab', { name: 'Ajustement global' }));
    fireEvent.change(screen.getByLabelText('Marque'), { target: { value: 'Samsung' } });
    fireEvent.change(screen.getByLabelText(/Valeur/), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simuler' }));
    expect(await screen.findByText('sur 1 prix d’achat mis à jour')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Appliquer/ })).toHaveTextContent('Appliquer (0 prix client, 1 prix d’achat)');
    expect(screen.getByText('inchangé')).toBeInTheDocument();
  });

  it('calculs miroirs du serveur : HT ajusté au centime, prix client et comptage des prix client', () => {
    expect(ajusterHt(105, { type: 'pct', valeur: 5 })).toBe(110.25);
    expect(ajusterHt(10.05, { type: 'pct', valeur: 10 })).toBe(11.06);
    expect(ajusterHt(7.5, { type: 'eur', valeur: 2.4 })).toBe(9.9);
    expect(prixClientPiece(45, 'Ecran', 'standard')).toBe(119);
    expect(prixClientPiece(9.9, 'Batterie', 'standard')).toBe(79);
    expect(compterPrixClientLocal({ cible: 'tarifs', lignes: TARIFS, ajustement: { type: 'pct', valeur: 10 }, regles: REGLES_DEFAUT })).toBe(2);
    // Déduction depuis l'aperçu : hausse partout (min > 0) → tous ; écarts complets → exact ; sinon « au moins »
    expect(prixClientQuiChangent({ modifies: 30, variation_min: 10, variation_max: 10, ecarts: [] })).toEqual({ n: 30, exact: true });
    const vingt = Array.from({ length: 20 }, (_, i) => ({ cle: `tarifs:${i}`, ancien: 89, nouveau: 99 }));
    expect(prixClientQuiChangent({ modifies: 267, variation_min: 0, variation_max: 10, ecarts: vingt })).toEqual({ n: 20, exact: false });
    expect(prixClientQuiChangent({ modifies: 267, variation_min: 0, variation_max: 10, ecarts: vingt }, 28)).toEqual({ n: 28, exact: true });
    expect(prixClientQuiChangent({ modifies: 267, variation_min: 0, variation_max: 10, ecarts: [...vingt.slice(0, 19), { ancien: 89, nouveau: 89 }] })).toEqual({ n: 19, exact: true });
  });
});

// ─── Ajustement d'une colonne (grilles boutique) ───
describe('AjustementColonne', () => {
  it('exclut les lignes verrouillées et les cases vides ; la colonne part dans le filtre', async () => {
    apiMock.simulerPrix.mockResolvedValue({ modifies: 1, inchanges: 0, verrouilles: 0, ecarts: [] });
    render(
      <AjustementColonne
        open onClose={vi.fn()} cible="tarifs_reparation"
        colonnes={[{ key: 'batterie', label: 'Batterie' }, { key: 'chassis', label: 'Châssis' }]}
        lignes={[
          { id: 1, label: 'iPhone 13', valeurs: { batterie: 99, chassis: 159 } },
          { id: 2, label: 'iPhone 14', valeurs: { batterie: null, chassis: 179 } },
          { id: 3, label: 'iPhone 15', valeurs: { batterie: 109, chassis: 199 } },
        ]}
        verrouilles={new Set([3])}
      />,
    );
    expect(screen.getByText(/ligne concernée/).textContent).toMatch(/1 ligne concernée.*1 verrouillée exclue.*1 sans prix/);
    fireEvent.change(screen.getByLabelText(/Valeur/), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simuler' }));
    await waitFor(() => expect(apiMock.simulerPrix).toHaveBeenCalledWith({
      cible: 'tarifs_reparation', filtre: { ids: [1], colonne: 'batterie' }, ajustement: { type: 'pct', valeur: 10 },
    }));
    expect(await screen.findByRole('button', { name: /^Appliquer/ })).toBeEnabled();
  });

  const colonne = (props = {}) => render(
    <AjustementColonne
      open onClose={vi.fn()} cible="tarifs_reparation"
      colonnes={[{ key: 'batterie', label: 'Batterie' }]}
      lignes={[{ id: 1, label: 'iPhone 13', valeurs: { batterie: 99 } }, { id: 2, label: 'iPhone 14', valeurs: { batterie: 109 } }]}
      {...props}
    />,
  );

  it('effet réel affiché à côté de la demande (arrondi au 9 : +5 % donne +10 %)', async () => {
    apiMock.simulerPrix.mockResolvedValue({
      modifies: 2, inchanges: 0, verrouilles: 0, alertes: 0, variation_moy: 10, variation_min: 10, variation_max: 10, variation_moy_pct: 9.6, ecarts: [],
    });
    colonne();
    fireEvent.change(screen.getByLabelText(/Valeur/), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simuler' }));
    expect(await screen.findByText(/Vous demandez \+5 %\. Effet réel sur le prix client : \+9,6 % en moyenne \(\+10 €\), de \+10 € à \+10 €\./)).toBeInTheDocument();
    expect(screen.getByText('Arrondi au 9 : l’effet réel (+9,6 % en moyenne) est plus fort que la demande (+5 %).')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Appliquer/ })).toHaveTextContent('Appliquer (2 prix)');
  });

  it('prix signalés : Appliquer bloqué tant que la vérification n’est pas cochée', async () => {
    apiMock.simulerPrix.mockResolvedValue({
      modifies: 2, inchanges: 0, verrouilles: 0, alertes: 1, variation_moy: 25, variation_min: 10, variation_max: 40, variation_moy_pct: 22,
      ecarts: [{ cle: 'tarifs_reparation:2:batterie', label: 'iPhone 14 — batterie', ancien: 109, nouveau: 149, alerte: 'variation', alertes: ['variation'] }],
    });
    apiMock.appliquerPrix.mockResolvedValue({ lot_id: 'lot-c', modifies: 2, verrouilles: 0 });
    colonne();
    fireEvent.change(screen.getByLabelText(/Valeur/), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simuler' }));
    const appliquer = await screen.findByRole('button', { name: /^Appliquer/ });
    expect(appliquer).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /1 prix signalé/ }));
    expect(appliquer).toBeEnabled();
    fireEvent.click(appliquer);
    await waitFor(() => expect(apiMock.appliquerPrix).toHaveBeenCalledWith({
      cible: 'tarifs_reparation', filtre: { ids: [1, 2], colonne: 'batterie' }, ajustement: { type: 'pct', valeur: 30 },
    }));
  });

  it('modifications non enregistrées : ajustement bloqué, « Enregistrer » proposé', async () => {
    const enregistrer = vi.fn().mockResolvedValue(true);
    colonne({ aEnregistrer: { nombre: 2, enregistrer } });
    expect(screen.getByText('2 lignes modifiées pas encore enregistrées.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Valeur/), { target: { value: '5' } });
    expect(screen.getByRole('button', { name: 'Simuler' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les 2 modifications' }));
    await waitFor(() => expect(enregistrer).toHaveBeenCalledTimes(1));
    expect(apiMock.simulerPrix).not.toHaveBeenCalled();
  });
});

// ─── Fenêtres de prix ──────────────────────────────
describe('FenetrePrix', () => {
  it('masque la bulle du chat (qui couvrirait « Appliquer ») tant qu’elle est ouverte', () => {
    const { container, rerender } = render(<FenetrePrix open onClose={vi.fn()} titre="Essai" pied={<button type="button">Appliquer</button>}>x</FenetrePrix>);
    expect(container.querySelector('style')?.textContent).toBe(CSS_SANS_BULLE_CHAT);
    expect(CSS_SANS_BULLE_CHAT).toContain('aria-label^="Ouvrir le chat"');
    rerender(<FenetrePrix open={false} onClose={vi.fn()} titre="Essai">x</FenetrePrix>);
    expect(container.querySelector('style')).toBeNull();
  });
});

// ─── Import d'un fichier ───────────────────────────
describe('ImportPrixModal', () => {
  const APERCU = {
    import_id: 7,
    colonnes: ['Référence', 'Désignation', 'Prix HT'],
    mapping: { reference: 'Référence', designation: 'Désignation', prix_ht: 'Prix HT' },
    reconnues: [
      { n: 2, cle: 'tarifs:1', label: 'Samsung Galaxy S21 · Ecran OLED', designation: 'Ecran OLED S21', ancien_ht: 105, nouveau_ht: 110, ancien_client: 189, nouveau_client: 199, change: true, verrou: false, alertes: [], alerte: null, coche: true },
      { n: 3, cle: 'tarifs:3', label: 'Apple iPhone 13 · Ecran Incell', designation: 'Ecran Incell iPhone 13', ancien_ht: 40, nouveau_ht: 80, ancien_client: 109, nouveau_client: 159, change: true, verrou: false, alertes: ['variation'], alerte: 'variation', coche: false },
      { n: 4, cle: 'tarifs:2', label: 'Samsung Galaxy S21 · Batterie', designation: 'Batterie S21', ancien_ht: 20, nouveau_ht: 22, ancien_client: 89, nouveau_client: 89, change: true, verrou: true, alertes: ['verrou'], alerte: 'verrou', coche: false },
      { n: 8, cle: 'tarifs:4', label: 'Samsung Galaxy S21 · Vitre arriere', designation: 'Vitre arrière S21', ancien_ht: 9, nouveau_ht: 9, ancien_client: 79, nouveau_client: 79, change: false, verrou: false, alertes: [], alerte: null, coche: true },
    ],
    nouvelles: [{ n: 5, designation: 'Batterie Galaxy S24', marque: 'Samsung', modele: 'Galaxy S24', type_piece: 'Batterie', qualite: null, nouveau_ht: 25, nouveau_client: 99, coche: false }],
    non_reconnues: [{ n: 6, brut: 'Ecran iPhone13 incell compatible', raison: 'aucune pièce correspondante', nouveau_ht: 41 }],
    invalides: [],
    absentes: [{ cle: 'tarifs:9', label: 'Huawei P30 · Ecran', verrou: false }],
    resume: { lignes: 5, alertes: 2 },
  };

  const ouvrir = async (catalogue = { tarifs: TARIFS, appleDevices: [] }) => {
    const onApplique = vi.fn();
    render(<ImportPrixModal open onClose={vi.fn()} catalogue={catalogue} onApplique={onApplique} />);
    const fichier = new File(['Référence;Désignation;Prix HT'], 'mobilax.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('Choisir un fichier'), { target: { files: [fichier] } });
    expect(screen.getByText('mobilax.csv')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Lire le fichier' }));
    await screen.findByText(/prix à vérifier/);
    return { onApplique, fichier };
  };

  it('format refusé avant tout envoi', () => {
    render(<ImportPrixModal open onClose={vi.fn()} catalogue={{ tarifs: TARIFS }} />);
    fireEvent.change(screen.getByLabelText('Choisir un fichier'), { target: { files: [new File(['x'], 'prix.pdf')] } });
    expect(screen.getByRole('alert')).toHaveTextContent('Format non pris en charge');
    expect(screen.getByRole('button', { name: 'Lire le fichier' })).toBeDisabled();
  });

  it('aperçu : alertes en haut, grosses variations décochées, application puis « Annuler cet import »', async () => {
    apiMock.apercuImportPrix.mockResolvedValue(APERCU);
    apiMock.appliquerImportPrix.mockResolvedValue({ lot_id: 'lot-imp', modifies: 1, ajoutes: 1, obsoletes: 0, verrouilles: 0, confirmes: 0 });
    apiMock.annulerLotPrix.mockResolvedValue({ restaures: 2, conflits: [] });
    const { onApplique, fichier } = await ouvrir();
    expect(apiMock.apercuImportPrix).toHaveBeenCalledWith({ fichier, fournisseur: 'Mobilax', cible: 'tarifs', mapping: undefined });

    // Filtre « À vérifier » actif par défaut : les lignes en alerte d'abord
    expect(screen.getByRole('button', { name: 'À vérifier' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Toutes' }));
    const lignes = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(lignes[0]).toHaveTextContent('Apple iPhone 13 · Ecran Incell');
    expect(lignes[0]).toHaveTextContent('Grosse variation');

    const variation = screen.getByRole('checkbox', { name: /Appliquer le nouveau prix de Apple iPhone 13/ });
    const normale = screen.getByRole('checkbox', { name: /Appliquer le nouveau prix de Samsung Galaxy S21 · Ecran OLED/ });
    const verrou = screen.getByRole('checkbox', { name: /Appliquer le nouveau prix de Samsung Galaxy S21 · Batterie/ });
    expect(variation).not.toBeChecked();
    expect(normale).toBeChecked();
    expect(verrou).not.toBeChecked();
    expect(verrou).toBeDisabled();
    // Prix inchangé : reste coché, l'appliquer le confirme (daté du jour, il n'est plus « estimé »)
    expect(screen.getByRole('checkbox', { name: /Appliquer le nouveau prix de Samsung Galaxy S21 · Vitre arriere/ })).toBeChecked();
    expect(screen.getByText(/dont 1 inchangé, daté du jour/)).toBeInTheDocument();

    // Nouvelle pièce cochée, ligne non reconnue associée à la main
    fireEvent.click(screen.getByRole('tab', { name: /Nouvelles pièces/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Ajouter Samsung Galaxy S24 · Batterie/ }));
    fireEvent.click(screen.getByRole('tab', { name: /À associer/ }));
    expect(screen.getByText(/aucune pièce correspondante/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Associer la ligne 6 à une pièce'), { target: { value: 'iphone 13' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apple iPhone 13 · Ecran Incell' }));
    // Aperçu de la ligne associée : 40 → 41 € HT, 109 → 119 €, sans alerte → cochée d'office
    expect(screen.getByText('Prix du fichier :')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Appliquer le prix de la ligne 6 à Apple iPhone 13/ })).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
    await waitFor(() => expect(apiMock.appliquerImportPrix).toHaveBeenCalledWith(7, {
      lignes: [2, 8], associations: [{ n: 6, cle: 'tarifs:3' }], nouvelles: [5], marquer_obsoletes: false, ignorer_invalides: false,
    }));
    expect(await screen.findByText('Import appliqué.')).toBeInTheDocument();
    expect(onApplique).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Annuler cet import/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Oui, annuler l’import' }));
    await waitFor(() => expect(apiMock.annulerLotPrix).toHaveBeenCalledWith('lot-imp'));
    expect(await screen.findByText(/Import annulé/)).toBeInTheDocument();
  });

  it('ligne associée à la main : aperçu avant → après, grosse variation décochée jusqu’à confirmation', async () => {
    // « Machin truc bidule 9,90 » associée à Galaxy A12 Batterie : 7,50 → 9,90 € HT (+32 %), 69 → 79 €
    const A12 = { id: 5, marque: 'Samsung', modele: 'Galaxy A12', type_piece: 'Batterie', qualite: null, prix_client: 69, prix_fournisseur_ht: 7.5, categorie: 'standard', verrou_manuel: false };
    apiMock.apercuImportPrix.mockResolvedValue({
      ...APERCU, reconnues: APERCU.reconnues.slice(0, 1), nouvelles: [],
      non_reconnues: [{ n: 6, brut: 'Machin truc bidule', raison: 'aucune pièce correspondante', nouveau_ht: 9.9 }],
    });
    apiMock.appliquerImportPrix.mockResolvedValue({ lot_id: 'lot-a', modifies: 2, ajoutes: 0, obsoletes: 0, verrouilles: 0, confirmes: 0 });
    render(<ImportPrixModal open onClose={vi.fn()} catalogue={{ tarifs: [...TARIFS, A12], appleDevices: [] }} />);
    fireEvent.change(screen.getByLabelText('Choisir un fichier'), { target: { files: [new File(['x'], 'mobilax.csv')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Lire le fichier' }));
    fireEvent.click(await screen.findByRole('tab', { name: /À associer/ }));
    fireEvent.change(screen.getByLabelText('Associer la ligne 6 à une pièce'), { target: { value: 'a12 batterie' } });
    fireEvent.click(screen.getByRole('button', { name: 'Samsung Galaxy A12 · Batterie' }));
    const panneau = screen.getByRole('tabpanel');
    expect(within(panneau).getByText('7,50 €')).toBeInTheDocument();
    expect(within(panneau).getByText('9,90 €')).toBeInTheDocument();
    expect(within(panneau).getByText('(+2,40 € (+32 %))')).toBeInTheDocument();
    expect(within(panneau).getByText('69 €')).toBeInTheDocument();
    expect(within(panneau).getByText('79 €')).toBeInTheDocument();
    expect(within(panneau).getByText('Grosse variation')).toBeInTheDocument();
    const coche = screen.getByRole('checkbox', { name: /Appliquer le prix de la ligne 6 à Samsung Galaxy A12 · Batterie/ });
    expect(coche).not.toBeChecked();
    expect(screen.getByText(/1 à vérifier, non cochée/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
    await waitFor(() => expect(apiMock.appliquerImportPrix).toHaveBeenCalledTimes(1));
    expect(apiMock.appliquerImportPrix.mock.calls[0][1].associations).toEqual([]);
  });

  it('association : alerte acceptée en cochant, puis envoyée ; calcul identique au serveur', () => {
    const piece = { table: 'tarifs', type_piece: 'Batterie', categorie: 'standard', ecran: false, ht: 7.5, client: 69, verrou: false };
    expect(apercuAssociation({ n: 6, nouveau_ht: 9.9 }, piece, REGLES_DEFAUT)).toEqual({ nouveauHt: 9.9, nouveauClient: 79, alertes: ['variation'] });
    expect(apercuAssociation({ n: 6, nouveau_ht: 7.4 }, piece, REGLES_DEFAUT)).toEqual({ nouveauHt: 7.4, nouveauClient: 69, alertes: [] });
    expect(apercuAssociation({ n: 6, nouveau_ht: 8 }, piece, REGLES_DEFAUT)).toEqual({ nouveauHt: 8, nouveauClient: 79, alertes: [] });
    // Prix du fichier non transmis : jamais appliqué sans le cocher soi-même
    expect(apercuAssociation({ n: 6 }, piece, REGLES_DEFAUT).alertes).toEqual(['prix_inconnu']);
    // Écran avec une marge trop faible (règles modifiées : marge écran 20 €)
    const ecran = { ...piece, type_piece: 'Ecran', ecran: true, ht: 40, client: 109 };
    expect(apercuAssociation({ nouveau_ht: 41 }, ecran, { ...REGLES_DEFAUT, ecran: { standard: 20 } }).alertes).toEqual(['marge']);
  });

  it('ligne du fichier sur deux pièces dont une verrouillée : la ligne reste cochée, la pièce verrouillée non', async () => {
    apiMock.apercuImportPrix.mockResolvedValue({
      ...APERCU,
      reconnues: [
        { n: 10, cle: 'tarifs:1', label: 'Samsung Galaxy S21 · Ecran OLED', designation: 'Ecran S21/S21+', ancien_ht: 105, nouveau_ht: 108, ancien_client: 189, nouveau_client: 189, change: true, verrou: false, alertes: [], alerte: null, coche: true },
        { n: 10, cle: 'tarifs:2', label: 'Samsung Galaxy S21 · Batterie', designation: 'Ecran S21/S21+', ancien_ht: 20, nouveau_ht: 108, ancien_client: 89, nouveau_client: 89, change: true, verrou: true, alertes: ['verrou'], alerte: 'verrou', coche: false },
      ],
    });
    apiMock.appliquerImportPrix.mockResolvedValue({ lot_id: 'lot-m', modifies: 1, ajoutes: 0, obsoletes: 0, verrouilles: 1, confirmes: 0 });
    await ouvrir();
    fireEvent.click(screen.getByRole('button', { name: 'Toutes' }));
    expect(screen.getByRole('checkbox', { name: /Appliquer le nouveau prix de Samsung Galaxy S21 · Ecran OLED/ })).toBeChecked();
    const verrouillee = screen.getByRole('checkbox', { name: /Appliquer le nouveau prix de Samsung Galaxy S21 · Batterie/ });
    expect(verrouillee).not.toBeChecked();
    expect(verrouillee).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
    await waitFor(() => expect(apiMock.appliquerImportPrix.mock.calls[0][1].lignes).toEqual([10]));
  });

  it('lignes illisibles : Appliquer bloqué tant que l’admin ne confirme pas de les ignorer', async () => {
    apiMock.apercuImportPrix.mockResolvedValue({ ...APERCU, invalides: [{ n: 9, brut: 'Ecran X · abc', raison: 'prix illisible : abc' }] });
    await ouvrir();
    expect(screen.getByText(/1 ligne illisible/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Appliquer' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Appliquer quand même, sans ces lignes/ }));
    expect(screen.getByRole('button', { name: 'Appliquer' })).toBeEnabled();
  });

  it('erreur serveur à l’application : message lisible, rien n’est marqué appliqué', async () => {
    apiMock.apercuImportPrix.mockResolvedValue(APERCU);
    apiMock.appliquerImportPrix.mockRejectedValue(Object.assign(new Error('Pièce introuvable : tarifs:1'), { status: 400 }));
    await ouvrir();
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Import non appliqué (aucun prix modifié) : Pièce introuvable : tarifs:1'));
    expect(screen.queryByText('Import appliqué.')).not.toBeInTheDocument();
  });
});

// ─── Historique ────────────────────────────────────
// Dates naïves du serveur = UTC : l'heure attendue se calcule dans le fuseau de la machine de test
const heureLocale = (iso) => {
  const d = new Date(`${iso}Z`);
  const deux = (n) => String(n).padStart(2, '0');
  return `${deux(d.getDate())}/${deux(d.getMonth() + 1)}/${d.getFullYear()} à ${deux(d.getHours())}h${deux(d.getMinutes())}`;
};

describe('HistoriquePrix', () => {
  it('sans filtre : résumé des lots, détail chargé à l’ouverture, lot annulé non annulable, annulation confirmée', async () => {
    apiMock.getLotsPrix.mockResolvedValue([
      { lot_id: 'A', source: 'import', par: 'Gérant', le: '2026-10-16T10:00:00', valeurs: 2, lignes: 1, annule: false },
      { lot_id: 'annulation:B', source: 'annulation', par: 'Gérant', le: '2026-10-15T09:30:00', valeurs: 521, lignes: 521, annule: false },
      { lot_id: 'B', source: 'formule', par: 'Gérant', le: '2026-10-15T09:00:00', valeurs: 521, lignes: 521, annule: true },
    ]);
    apiMock.getHistoriquePrix.mockResolvedValue([
      { id: 1, table_nom: 'tarifs', ligne_id: 1, colonne: 'prix_client', ancien: 189, nouveau: 199, source: 'import', lot_id: 'A', par: 'Gérant', le: '2026-10-16T10:00:00' },
      { id: 2, table_nom: 'tarifs', ligne_id: 1, colonne: 'prix_fournisseur_ht', ancien: 105, nouveau: 110, source: 'import', lot_id: 'A', par: 'Gérant', le: '2026-10-16T10:00:00' },
    ]);
    apiMock.annulerLotPrix.mockResolvedValue({ restaures: 2, conflits: [] });
    const onAnnule = vi.fn();
    render(<HistoriquePrix open onClose={vi.fn()} nommer={(l) => (l.ligne_id === 1 ? 'Samsung Galaxy S21 · Ecran OLED' : null)} onAnnule={onAnnule} />);
    expect(await screen.findByText('Import d’un fichier — 1 prix modifié')).toBeInTheDocument();
    expect(apiMock.getLotsPrix).toHaveBeenCalledWith(50);
    expect(screen.getByText('Règles de prix — 521 prix modifiés')).toBeInTheDocument();
    expect(screen.getByText(`· annulé le ${heureLocale('2026-10-15T09:30:00')}`)).toBeInTheDocument();
    // Seul le lot d'import reste annulable (le lot B est annulé, son annulation ne s'annule pas)
    expect(screen.getAllByRole('button', { name: /Annuler ce lot/ })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /Import d’un fichier/ }));
    await waitFor(() => expect(apiMock.getHistoriquePrix).toHaveBeenCalledWith({ lot_id: 'A', limit: 1000 }));
    expect(await screen.findByText('Prix d’achat HT')).toBeInTheDocument();
    expect(screen.getAllByText('Samsung Galaxy S21 · Ecran OLED')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: /Annuler ce lot/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Oui, annuler le lot' }));
    await waitFor(() => expect(apiMock.annulerLotPrix).toHaveBeenCalledWith('A'));
    expect(toast.success).toHaveBeenCalledWith('Lot annulé : 2 prix remis à leur valeur d’avant.');
    expect(onAnnule).toHaveBeenCalled();
  });

  it('avec un filtre de table : changements de cette grille, groupés par lot', async () => {
    apiMock.getHistoriquePrix.mockResolvedValue([
      { id: 5, table_nom: 'tarifs_reparation', ligne_id: 9, colonne: 'batterie', ancien: 89, nouveau: 99, source: 'manuel', lot_id: 'C', par: 'Gérant', le: '2026-10-16T08:00:00' },
    ]);
    render(<HistoriquePrix open onClose={vi.fn()} filtre={{ table: 'tarifs_reparation' }} nommer={() => 'iPhone 11 Pro Max'} />);
    expect(await screen.findByText('Saisie à la main — 1 prix modifié')).toBeInTheDocument();
    expect(apiMock.getHistoriquePrix).toHaveBeenCalledWith({ table: 'tarifs_reparation', ligne_id: undefined, limit: 500 });
    expect(apiMock.getLotsPrix).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Saisie à la main/ }));
    expect(screen.getByText('iPhone 11 Pro Max')).toBeInTheDocument();
    expect(screen.getByText('Batterie')).toBeInTheDocument();
  });
});

// ─── Grille iPhone boutique ────────────────────────
describe('TarifsReparationPage', () => {
  const GRILLE = [
    { id: 9, modele: 'iPhone 11 Pro Max', ordre: 8, ecran_generique: 99, batterie: 89, prix_maj_le: '2026-04-13T14:14:19', updated_at: '2026-04-13T14:14:19' },
    { id: 10, modele: 'iPhone 12/12 Pro', ordre: 9, ecran_generique: 89, batterie: 99, prix_maj_le: '2026-10-01T10:00:00', updated_at: '2026-10-01T10:00:00' },
  ];

  beforeEach(() => {
    localStorage.setItem('klikphone_admin', 'true');
    apiMock.getTarifsReparation.mockResolvedValue(GRILLE);
    apiMock.getConfig.mockResolvedValue([{ cle: 'PRIX_LIGNES_VERROUILLEES', valeur: JSON.stringify({ tarifs_reparation: [10] }) }]);
  });

  it('colonne « Prix du », filtre, cadenas ; une ligne verrouillée ne se modifie pas', async () => {
    render(<TarifsReparationPage />);
    expect(await screen.findByRole('columnheader', { name: 'Prix du' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Plus de 3 mois/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Déverrouiller les prix de iPhone 12/12 Pro' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Batterie de iPhone 12\/12 Pro : 99 euros/ }));
    expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/iPhone 12\/12 Pro est verrouillé/));
    expect(screen.queryByRole('textbox', { name: /Batterie de iPhone 12\/12 Pro/ })).not.toBeInTheDocument();
  });

  it('enregistrement en échec : toast lisible, la valeur affichée ne change pas', async () => {
    apiMock.updateTarifReparation.mockRejectedValue(Object.assign(new Error('Base indisponible'), { status: 500 }));
    render(<TarifsReparationPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Batterie de iPhone 11 Pro Max : 89 euros/ }));
    const champ = screen.getByRole('textbox', { name: /Batterie de iPhone 11 Pro Max/ });
    fireEvent.change(champ, { target: { value: '95' } });
    fireEvent.keyDown(champ, { key: 'Enter' });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Prix non enregistré : Base indisponible'));
    expect(apiMock.updateTarifReparation).toHaveBeenCalledWith(9, { batterie: 95 });
    expect(screen.getByRole('button', { name: /Batterie de iPhone 11 Pro Max : 89 euros/ })).toBeInTheDocument();
  });

  it('saisie enregistrée : l’âge du prix est recalculé (plus de « périmé » sur un prix du jour)', async () => {
    const ancien = { ...GRILLE[0], prix_maj_le: '2026-04-13T14:14:19', age_jours: 186, fraicheur: 'perime' };
    apiMock.getTarifsReparation.mockResolvedValue([ancien, GRILLE[1]]);
    // PUT /reparation/{id} : SELECT *, sans age_jours
    apiMock.updateTarifReparation.mockImplementation(async (id, data) => ({ ...GRILLE[0], ...data, prix_maj_le: new Date().toISOString().replace('Z', '') }));
    render(<TarifsReparationPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Batterie de iPhone 11 Pro Max : 89 euros/ }));
    expect(screen.getAllByText(/plus de 6 mois : périmé/).length).toBe(1);
    const champ = screen.getByRole('textbox', { name: /Batterie de iPhone 11 Pro Max/ });
    fireEvent.change(champ, { target: { value: '95' } });
    fireEvent.keyDown(champ, { key: 'Enter' });
    expect(await screen.findByRole('button', { name: /Batterie de iPhone 11 Pro Max : 95 euros/ })).toBeInTheDocument();
    expect(screen.queryByText(/plus de 6 mois : périmé/)).not.toBeInTheDocument();
  });

  it('cadenas : relit le paramètre partagé puis l’enregistre', async () => {
    apiMock.setParam.mockResolvedValue({ ok: true });
    render(<TarifsReparationPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Verrouiller les prix de iPhone 11 Pro Max' }));
    await waitFor(() => expect(apiMock.setParam).toHaveBeenCalledWith('PRIX_LIGNES_VERROUILLEES', JSON.stringify({ tarifs_reparation: [9, 10] })));
    expect(await screen.findByRole('button', { name: 'Déverrouiller les prix de iPhone 11 Pro Max' })).toBeInTheDocument();
  });
});

// ─── Smartphones à vendre ──────────────────────────
describe('AdminTarifsSmartphonesPage', () => {
  const TELEPHONES = [
    { id: 1, marque: 'Samsung', modele: 'Galaxy A16', slug: 'samsung-galaxy-a16', stockage_1: '128 Go', prix_1: 189, actif: true, prix_maj_le: '2026-10-01T10:00:00' },
    { id: 2, marque: 'Xiaomi', modele: 'Redmi 13', slug: 'xiaomi-redmi-13', stockage_1: '128 Go', prix_1: 149, actif: false, prix_maj_le: '2026-10-01T10:00:00' },
  ];
  const page = () => render(<MemoryRouter initialEntries={['/accueil/admin/tarifs-smartphones']}><AdminTarifsSmartphonesPage /></MemoryRouter>);

  beforeEach(() => {
    apiMock.getSmartphonesTarifs.mockResolvedValue(TELEPHONES);
    apiMock.updateSmartphoneTarif.mockResolvedValue({ ok: true });
  });

  it('ajuster en % : un smartphone désactivé n’est pas compté (le serveur ne l’ajuste pas)', async () => {
    apiMock.simulerPrix.mockResolvedValue({ modifies: 1, inchanges: 0, verrouilles: 0, alertes: 0, variation_moy: 10, variation_min: 10, variation_max: 10, variation_moy_pct: 5.3, ecarts: [] });
    page();
    fireEvent.click(await screen.findByRole('button', { name: /Ajuster en %/ }));
    const fenetre = await screen.findByRole('dialog', { name: 'Ajuster les prix des smartphones' });
    expect(within(fenetre).getByText(/ligne concernée/).textContent).toMatch(/^1 ligne concernée/);
    fireEvent.change(within(fenetre).getByLabelText(/Valeur/), { target: { value: '5' } });
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Simuler' }));
    await waitFor(() => expect(apiMock.simulerPrix).toHaveBeenCalledWith({
      cible: 'smartphones_tarifs', filtre: { ids: [1], colonne: 'prix_1' }, ajustement: { type: 'pct', valeur: 5 },
    }));
  });

  it('modification en cours : l’ajustement demande de l’enregistrer d’abord (rien n’est perdu)', async () => {
    page();
    const prix = await screen.findByRole('spinbutton', { name: 'Prix 1 de Galaxy A16, en euros' });
    fireEvent.change(prix, { target: { value: '199' } });
    fireEvent.click(screen.getByRole('button', { name: /Ajuster en %/ }));
    const fenetre = await screen.findByRole('dialog', { name: 'Ajuster les prix des smartphones' });
    expect(within(fenetre).getByText('1 ligne modifiée pas encore enregistrée.')).toBeInTheDocument();
    expect(within(fenetre).getByRole('button', { name: 'Simuler' })).toBeDisabled();
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Enregistrer la modification' }));
    await waitFor(() => expect(apiMock.updateSmartphoneTarif).toHaveBeenCalledWith(1, expect.objectContaining({ prix_1: 199 })));
    await waitFor(() => expect(within(fenetre).queryByText(/pas encore enregistrée/)).not.toBeInTheDocument());
  });
});
