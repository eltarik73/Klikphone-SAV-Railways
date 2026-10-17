/**
 * Prix au comptoir et suivi : fraîcheur des prix et groupes dans le TarifPicker, prix HT payé des
 * commandes de pièces (propositions au gérant), propositions de prix, modèles sans prix et alias,
 * santé des prix (tableau de bord admin), synchro LCD-Phone (test de connexion puis synchro).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { auth, apiMock } = vi.hoisted(() => {
  const base = { background: (fn) => fn() };
  // Toute méthode non préparée par un test répond une liste vide
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
import TarifPicker, { fraicheurPrix, grouperSuggestions, moisAnnee, cleCommandeDepuisLigne } from '../components/TarifPicker';
import CommandesPage, {
  montantSaisi, piecesCommandables, piecePressentie, propositionSignalee, MESSAGE_PROPOSITION,
} from '../pages/CommandesPage';
import PropositionsPrix, { ecartProposition, selectionParDefaut, cheminPrixARevoir } from '../components/PropositionsPrix';
import SantePrixWidget, { SynchroLcdPhone, lireStatutSynchro, analyserProbe, tuilesSante } from '../components/SantePrixWidget';
import ModelesSansPrixPage, { trierSansPrix, lienSaisiePrix } from '../pages/ModelesSansPrixPage';
import DashboardPage from '../pages/DashboardPage';
import TicketDetailPage from '../pages/TicketDetailPage';

const MAINTENANT = new Date('2026-10-16T12:00:00').getTime();
const IL_Y_A = (jours) => new Date(MAINTENANT - jours * 86_400_000).toISOString();

// Extrait de GET /api/grille/suggestions (contrat BE-B : prix_maj_le, prix_source, age_jours, fraicheur, estime, groupe)
const SUGG_IPHONE = {
  modele_trouve: true,
  suggestions: [
    { source: 'tarifs_reparation', id: 'tarifs_reparation:3:ecran_generique', label: 'Forfait remplacement écran (Générique)', type_piece: 'Écran', qualite: 'Générique', prix: 99, modele: 'iPhone 13', groupe: 'boutique', prix_maj_le: IL_Y_A(30), age_jours: 30, fraicheur: 'ok', prix_source: 'manuel', estime: false },
    { source: 'tarifs_reparation', id: 'tarifs_reparation:3:batterie', label: 'Forfait remplacement batterie', type_piece: 'Batterie', prix: 99, modele: 'iPhone 13', groupe: 'boutique', prix_maj_le: IL_Y_A(100), age_jours: 100, fraicheur: 'a_revoir' },
    { source: 'tarifs', id: 'tarifs:12', label: 'Remplacement écran (OLED)', type_piece: 'Écran', qualite: 'OLED', prix: 129, stock: 'En stock', cout_ht: 48.5, modele: 'iPhone 13', groupe: 'fournisseur', prix_maj_le: '2026-02-15T10:00:00', age_jours: 243, fraicheur: 'perime', prix_source: 'estimation_2026_02', estime: true },
    { source: 'tarifs', id: 'tarifs:13', label: 'Remplacement écran (Incell)', type_piece: 'Écran', qualite: 'Incell', prix: 109, stock: 'Rupture', cout_ht: 31, modele: 'iPhone 13', groupe: 'fournisseur', prix_maj_le: '2026-02-15T10:00:00', age_jours: 243, fraicheur: 'perime', estime: true },
    { source: 'tarifs', id: 'tarifs:14', label: 'Remplacement nappe (ancienne)', type_piece: 'Nappe', prix: 59, modele: 'iPhone 13', groupe: 'fournisseur', obsolete: true },
  ],
};

function resetApi() {
  for (const [k, fn] of Object.entries(apiMock)) {
    if (k !== 'background' && typeof fn?.mockReset === 'function') fn.mockReset().mockResolvedValue([]);
  }
}

beforeEach(() => {
  clearCache();
  resetApi();
  try { localStorage.clear(); } catch { /* stockage indisponible */ }
  auth.user = { target: 'accueil', utilisateur: 'Sophie', role: '' };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── Fraîcheur des prix ──────────────────────────────────────────
describe('fraîcheur des prix', () => {
  it('gris avant 90 j, orange de 90 à 180 j, rouge au-delà ; « estimé » ; date au format « févr. 2026 »', () => {
    expect(moisAnnee('2026-02-15T10:00:00')).toBe('févr. 2026');
    expect(fraicheurPrix({ prix_maj_le: '2026-04-13T14:16:40' }, MAINTENANT).libelle).toBe('prix d’avr. 2026');
    expect(fraicheurPrix({ prix_maj_le: '2026-10-02T09:00:00' }, MAINTENANT).libelle).toBe('prix d’oct. 2026');
    expect(fraicheurPrix({ prix_maj_le: IL_Y_A(30) }, MAINTENANT)).toMatchObject({ niveau: 'ok', estime: false, jours: 30 });
    expect(fraicheurPrix({ prix_maj_le: IL_Y_A(100) }, MAINTENANT).niveau).toBe('a_revoir');
    expect(fraicheurPrix({ prix_maj_le: IL_Y_A(90) }, MAINTENANT).niveau).toBe('a_revoir');
    expect(fraicheurPrix({ prix_maj_le: IL_Y_A(200) }, MAINTENANT).niveau).toBe('perime');
    const f = fraicheurPrix({ prix_maj_le: '2026-02-15T10:00:00', prix_source: 'estimation_2026_02' }, MAINTENANT);
    expect(f).toMatchObject({ niveau: 'perime', estime: true, libelle: 'prix de févr. 2026' });
    expect(f.description).toBe('prix de févr. 2026, estimé, périmé');
    // Le niveau calculé par le serveur l'emporte ; âge seul sans date
    expect(fraicheurPrix({ age_jours: 10, fraicheur: 'a_revoir' }, MAINTENANT)).toMatchObject({ niveau: 'a_revoir', libelle: 'prix d’il y a 10 j' });
    // Ni date ni estimation (ancien serveur) : pas de badge
    expect(fraicheurPrix({ label: 'x' })).toBeNull();
  });

  it('prix fixé par la boutique : mêmes couleurs, texte « grille revue », jamais « périmé »', () => {
    const forfait = fraicheurPrix({ source: 'tarifs_reparation', prix_maj_le: '2026-04-13T14:16:40', age_jours: 186, fraicheur: 'perime' }, MAINTENANT);
    expect(forfait).toMatchObject({ niveau: 'perime', boutique: true, estime: false, libelle: 'grille revue en avr. 2026', mot: 'non revue depuis 186 j' });
    expect(forfait.description).toBe('grille revue en avr. 2026, non revue depuis 186 j');
    expect(fraicheurPrix({ source: 'smartphones_tarifs', prix_maj_le: IL_Y_A(10) }, MAINTENANT)).toMatchObject({ niveau: 'ok', mot: '', description: expect.stringMatching(/^grille revue en/) });
    expect(fraicheurPrix({ source: 'iphone_tarifs', age_jours: 120, fraicheur: 'a_revoir' }, MAINTENANT).libelle).toBe('grille revue il y a 120 j');
    // Pièce fournisseur : inchangé
    expect(fraicheurPrix({ source: 'tarifs', prix_maj_le: '2026-02-15T10:00:00', fraicheur: 'perime' }, MAINTENANT)).toMatchObject({ boutique: false, mot: 'périmé' });
  });

  it('clé de la pièce commandée depuis une ligne du ticket : pièces fournisseur et iPad / MacBook seulement', () => {
    expect(cleCommandeDepuisLigne({ label: 'Batterie', source: 'tarifs', tarif_id: 'tarifs:56' })).toBe('tarifs:56');
    expect(cleCommandeDepuisLigne({ source: 'tarifs_apple_devices', tarif_id: 'tarifs_apple_devices:12:ecran' })).toBe('tarifs_apple_devices:12:ecran');
    expect(cleCommandeDepuisLigne({ source: 'tarifs_reparation', tarif_id: 'tarifs_reparation:3:batterie' })).toBeNull();
    expect(cleCommandeDepuisLigne({ source: 'tarifs', tarif_id: 'tarifs_apple_devices:12:ecran' })).toBeNull();
    expect(cleCommandeDepuisLigne({ source: 'tarifs', tarif_id: 'tarifs:abc' })).toBeNull();
    expect(cleCommandeDepuisLigne({ label: 'Saisie libre', prix: 50 })).toBeNull();
  });

  it('groupes : boutique, fournisseur replié seulement si la grille boutique couvre, ventes à part, obsolètes retirés', () => {
    const g = grouperSuggestions(SUGG_IPHONE.suggestions);
    expect(g.replie).toBe(true);
    expect(g.boutique.map(s => s.id)).toEqual(['tarifs_reparation:3:ecran_generique', 'tarifs_reparation:3:batterie']);
    expect(g.fournisseur.map(s => s.id)).toEqual(['tarifs:12', 'tarifs:13']);
    // Modèle non couvert par la grille boutique : rien de replié
    expect(grouperSuggestions(SUGG_IPHONE.suggestions.slice(2)).replie).toBe(false);
    // Ancien serveur sans groupe : une seule liste
    expect(grouperSuggestions([{ id: 'a' }, { id: 'b' }])).toMatchObject({ replie: false, fournisseur: [], vente: [] });
  });
});

describe('TarifPicker : badges et groupes', () => {
  it('badge de fraîcheur par suggestion, pièces fournisseur repliées sous « Autres pièces », obsolètes absentes', async () => {
    apiMock.getGrilleSuggestions.mockResolvedValue(SUGG_IPHONE);
    const onChoisir = vi.fn();
    render(<TarifPicker open onClose={() => {}} onChoisir={onChoisir} marque="Apple" modele="iPhone 13" categorie="Smartphone" />);
    const dialogue = await screen.findByRole('dialog', { name: 'Ajouter depuis la grille' });
    await within(dialogue).findByText('Forfait remplacement écran (Générique)');

    expect(within(dialogue).getByRole('heading', { name: 'Grille boutique' })).toBeInTheDocument();
    const replier = within(dialogue).getByRole('button', { name: /Autres pièces \(fournisseur\) · 2/ });
    expect(replier).toHaveAttribute('aria-expanded', 'false');
    expect(within(dialogue).queryByText('Remplacement écran (OLED)')).not.toBeInTheDocument();
    expect(within(dialogue).queryByText(/nappe/i)).not.toBeInTheDocument();

    // Badge orange sur la batterie de la grille boutique : prix de la boutique, « non revue », pas « à vérifier »
    const batterie = within(dialogue).getByRole('button', { name: /Forfait remplacement batterie/ });
    expect(batterie.getAttribute('aria-label')).toMatch(/grille revue en juil\. 2026, non revue depuis 100 j/);
    const badgeBoutique = within(batterie).getByText(/^grille revue en/);
    expect(badgeBoutique.className).toMatch(/amber/);
    expect(badgeBoutique.getAttribute('title')).toMatch(/^Prix fixé par la boutique/);
    expect(badgeBoutique.getAttribute('title')).not.toMatch(/à vérifier/);

    fireEvent.click(replier);
    expect(replier).toHaveAttribute('aria-expanded', 'true');
    const oled = within(dialogue).getByRole('button', { name: /Remplacement écran \(OLED\)/ });
    const badge = within(oled).getByText(/prix de févr\. 2026 · estimé/);
    expect(badge.className).toMatch(/red/);
    expect(badge.getAttribute('title')).toMatch(/à vérifier avant de l’annoncer/);
    expect(oled.getAttribute('aria-label')).toMatch(/prix de févr\. 2026, estimé, périmé/);
    fireEvent.click(oled);
    expect(onChoisir).toHaveBeenCalledWith(expect.objectContaining({ tarif_id: 'tarifs:12', prix: 129 }), expect.objectContaining({ id: 'tarifs:12' }));
  });

  it('admin : prix d’achat sur les pièces fournisseur seulement (forfait boutique : cout_ht null)', async () => {
    apiMock.getGrilleSuggestions.mockResolvedValue(SUGG_IPHONE);
    render(<TarifPicker open onClose={() => {}} onChoisir={() => {}} marque="Apple" modele="iPhone 13" categorie="Smartphone" isAdmin />);
    const dialogue = await screen.findByRole('dialog', { name: 'Ajouter depuis la grille' });
    const generique = await within(dialogue).findByRole('button', { name: /Forfait remplacement écran \(Générique\)/ });
    expect(within(generique).queryByText(/Achat HT/)).not.toBeInTheDocument();
    fireEvent.click(within(dialogue).getByRole('button', { name: /Autres pièces/ }));
    expect(within(within(dialogue).getByRole('button', { name: /Remplacement écran \(OLED\)/ })).getByText('Achat HT 48.50 €')).toBeInTheDocument();
  });

  it('filtre qualité sans ligne boutique : les pièces fournisseur s’affichent dépliées', async () => {
    apiMock.getGrilleSuggestions.mockResolvedValue(SUGG_IPHONE);
    render(<TarifPicker open onClose={() => {}} onChoisir={() => {}} marque="Apple" modele="iPhone 13" categorie="Smartphone" />);
    const dialogue = await screen.findByRole('dialog', { name: 'Ajouter depuis la grille' });
    await within(dialogue).findByText('Forfait remplacement écran (Générique)');
    fireEvent.click(within(dialogue).getByRole('button', { name: 'OLED' }));
    expect(within(dialogue).getByText('Remplacement écran (OLED)')).toBeInTheDocument();
    expect(within(dialogue).queryByRole('button', { name: /Autres pièces/ })).not.toBeInTheDocument();
  });
});

// ─── Commandes de pièces : prix HT payé ──────────────────────────
describe('commandes : prix HT payé', () => {
  it('outils : montant saisi, pièces rattachables, pièce pressentie, signal de proposition', () => {
    expect(montantSaisi('45,50')).toBe(45.5);
    expect(montantSaisi(' 12 € ')).toBe(12);
    expect(montantSaisi('')).toBeNull();
    expect(montantSaisi('abc')).toBeNull();
    expect(montantSaisi('-3')).toBeNull();
    const pieces = piecesCommandables(SUGG_IPHONE.suggestions);
    expect(pieces.map(p => p.id)).toEqual(['tarifs:12', 'tarifs:13']);
    expect(piecePressentie('Écran iPhone 13 OLED', pieces)?.id).toBe('tarifs:12');
    expect(piecePressentie('Écran iPhone 13', pieces)).toBeNull(); // deux écrans : aucun choix imposé
    expect(piecePressentie('Batterie', pieces)).toBeNull();
    expect(propositionSignalee({ id: 3, proposition_id: 9 })).toBe(true);
    expect(propositionSignalee({ id: 3, proposition_id: null })).toBe(false);
    expect(propositionSignalee({ id: 3 })).toBeNull();
  });

  it('commandePayload : HT en nombre (virgule), clé en texte, champs absents non ajoutés', async () => {
    const { commandePayload } = await vi.importActual('../lib/api');
    expect(commandePayload({ description: 'Écran', prix_ht: '45,5', tarif_cle: 'tarifs:12' }))
      .toEqual({ description: 'Écran', prix_ht: 45.5, tarif_cle: 'tarifs:12' });
    expect(commandePayload({ prix_ht: '', tarif_cle: '' })).toEqual({ prix_ht: null, tarif_cle: null });
    expect(commandePayload({ statut: 'Reçu' })).toEqual({ statut: 'Reçu' });
  });

  function preparerTicket() {
    apiMock.resolveCode.mockResolvedValue({ type: 'ticket', id: 42, ticket_code: 'KP-000042' });
    apiMock.getTicket.mockResolvedValue({ id: 42, ticket_code: 'KP-000042', marque: 'Apple', modele: 'iPhone 13', categorie: 'Smartphone' });
    apiMock.getGrilleSuggestions.mockImplementation(async ({ cout } = {}) => SUGG_IPHONE);
  }

  function renderCommandes() {
    return render(
      <MemoryRouter initialEntries={['/accueil/commandes']}>
        <ToastProvider><CommandesPage /></ToastProvider>
      </MemoryRouter>,
    );
  }

  async function ouvrirFormulaire(description) {
    fireEvent.click(await screen.findByRole('button', { name: /Nouvelle commande/ }));
    fireEvent.change(screen.getByLabelText(/Désignation/), { target: { value: description } });
    fireEvent.change(screen.getByLabelText('Ticket associé'), { target: { value: 'KP-000042' } });
  }

  it('non-admin : pièces de la grille du ticket, HT jamais prérempli ; prix envoyé avec la pièce', async () => {
    preparerTicket();
    // Le serveur ne donne pas le coût HT à un non-admin
    apiMock.getGrilleSuggestions.mockResolvedValue({
      ...SUGG_IPHONE, suggestions: SUGG_IPHONE.suggestions.map(s => ({ ...s, cout_ht: null })),
    });
    apiMock.createPart.mockResolvedValue({ id: 7, proposition_id: 3 });
    renderCommandes();
    await ouvrirFormulaire('Écran iPhone 13 OLED');

    const select = screen.getByLabelText('Pièce de la grille');
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(3));
    expect(apiMock.getGrilleSuggestions).toHaveBeenCalledWith({ q: '', limit: 50, marque: 'Apple', modele: 'iPhone 13', categorie: 'Smartphone' });
    // Forfaits boutique (sans coût d'achat) et pièce obsolète exclus
    expect(within(select).queryByRole('option', { name: /Générique/ })).not.toBeInTheDocument();
    await waitFor(() => expect(select).toHaveValue('tarifs:12'));
    const ht = screen.getByLabelText('Prix HT payé (€)');
    expect(ht).toHaveValue('');
    expect(within(select).getByRole('option', { name: /OLED/ }).textContent).not.toMatch(/HT/);

    fireEvent.change(ht, { target: { value: '52,40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer' }));
    await waitFor(() => expect(apiMock.createPart).toHaveBeenCalled());
    expect(apiMock.createPart.mock.calls[0][0]).toMatchObject({ description: 'Écran iPhone 13 OLED', ticket_code: 'KP-000042', prix_ht: 52.4, tarif_cle: 'tarifs:12' });
    expect(await screen.findByText(/proposition de mise à jour envoyée au gérant/)).toBeInTheDocument();
  });

  it('admin : HT de la grille prérempli, écart affiché avant l’envoi', async () => {
    auth.user = { ...auth.user, role: 'admin' };
    preparerTicket();
    apiMock.createPart.mockResolvedValue({ id: 8 });
    renderCommandes();
    await ouvrirFormulaire('Écran iPhone 13 OLED');
    const ht = screen.getByLabelText('Prix HT payé (€)');
    await waitFor(() => expect(ht).toHaveValue('48.5'));
    expect(screen.getByText('Conforme à la grille.')).toBeInTheDocument();
    fireEvent.change(ht, { target: { value: '55' } });
    expect(screen.getByText(/Écart de \+6\.50 € avec la grille/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Créer' }));
    await waitFor(() => expect(apiMock.createPart).toHaveBeenCalled());
    // Le serveur ne dit rien : l'écart connu de l'admin suffit pour le message
    expect(await screen.findByText(/proposition de mise à jour envoyée au gérant/)).toBeInTheDocument();
  });

  it('écart d’au plus 1 € (admin) : pas de message de proposition', async () => {
    auth.user = { ...auth.user, role: 'admin' };
    preparerTicket();
    apiMock.createPart.mockResolvedValue({ id: 9 });
    renderCommandes();
    await ouvrirFormulaire('Écran iPhone 13 OLED');
    const ht = screen.getByLabelText('Prix HT payé (€)');
    await waitFor(() => expect(ht).toHaveValue('48.5'));
    fireEvent.change(ht, { target: { value: '49' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer' }));
    expect(await screen.findByText('Commande créée')).toBeInTheDocument();
    expect(screen.queryByText(/proposition de mise à jour/)).not.toBeInTheDocument();
  });

  it('ticket effacé après le choix d’une pièce : la pièce ne part pas avec la commande', async () => {
    preparerTicket();
    apiMock.createPart.mockResolvedValue({ id: 10, proposition_id: null });
    renderCommandes();
    await ouvrirFormulaire('Écran iPhone 13 OLED');
    const select = screen.getByLabelText('Pièce de la grille');
    await waitFor(() => expect(select).toHaveValue('tarifs:12'));
    fireEvent.change(screen.getByLabelText('Ticket associé'), { target: { value: '' } });
    await waitFor(() => expect(select).toHaveValue(''));
    fireEvent.change(screen.getByLabelText('Prix HT payé (€)'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer' }));
    await waitFor(() => expect(apiMock.createPart).toHaveBeenCalled());
    const envoye = apiMock.createPart.mock.calls[0][0];
    expect(envoye).toMatchObject({ prix_ht: 50 });
    expect(envoye).not.toHaveProperty('tarif_cle');
    expect(await screen.findByText('Commande créée')).toBeInTheDocument();
  });

  it('réception d’une commande qui porte déjà son prix : proposition signalée par le serveur', async () => {
    const part = { id: 12, description: 'Écran', statut: 'Commandée', prix_ht: 52, tarif_cle: 'tarifs:12', client_tel: '' };
    apiMock.getParts.mockResolvedValue([part]);
    apiMock.updatePart.mockResolvedValue({ ok: true, proposition_id: 4 });
    renderCommandes();
    fireEvent.change(await screen.findByRole('combobox', { name: 'Statut de la commande Écran' }), { target: { value: 'Reçu' } });
    expect(await screen.findByText(/Statut → Reçu — proposition de mise à jour envoyée au gérant/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('modification : prix payé effacé envoyé à null, rien n’est renvoyé sans changement', async () => {
    const part = { id: 13, ticket_id: 42, ticket_code: 'KP-000042', description: 'Écran OLED', statut: 'Commandée', marque: 'Apple', modele: 'iPhone 13', prix_ht: 52, tarif_cle: 'tarifs:12' };
    preparerTicket();
    apiMock.getParts.mockResolvedValue([part]);
    apiMock.updatePart.mockResolvedValue({ ok: true, proposition_id: null });
    renderCommandes();
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier la commande Écran OLED' }));
    const ht = screen.getByLabelText('Prix HT payé (€)');
    expect(ht).toHaveValue('52');
    await waitFor(() => expect(screen.getByLabelText('Pièce de la grille')).toHaveValue('tarifs:12'));
    fireEvent.click(screen.getByRole('button', { name: 'Mettre à jour' }));
    await waitFor(() => expect(apiMock.updatePart).toHaveBeenCalledTimes(1));
    expect(apiMock.updatePart.mock.calls[0][1]).not.toHaveProperty('prix_ht');
    expect(apiMock.updatePart.mock.calls[0][1]).not.toHaveProperty('tarif_cle');

    fireEvent.click(await screen.findByRole('button', { name: 'Modifier la commande Écran OLED' }));
    fireEvent.change(screen.getByLabelText('Prix HT payé (€)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mettre à jour' }));
    await waitFor(() => expect(apiMock.updatePart).toHaveBeenCalledTimes(2));
    expect(apiMock.updatePart.mock.calls[1][1]).toMatchObject({ prix_ht: null, tarif_cle: 'tarifs:12' });
  });

  it('modification : ticket changé pour un autre appareil, la pièce enregistrée ne part pas', async () => {
    const part = { id: 14, ticket_id: 42, ticket_code: 'KP-000042', description: 'Écran', statut: 'Commandée', marque: 'Apple', modele: 'iPhone 13', prix_ht: 52, tarif_cle: 'tarifs:12' };
    apiMock.getParts.mockResolvedValue([part]);
    apiMock.resolveCode.mockImplementation(async (code) => (code === 'KP-000050' ? { type: 'ticket', id: 50 } : null));
    apiMock.getTicket.mockResolvedValue({ id: 50, ticket_code: 'KP-000050', marque: 'Samsung', modele: 'Galaxy A52', categorie: 'Smartphone' });
    apiMock.getGrilleSuggestions.mockImplementation(async ({ modele }) => (modele === 'Galaxy A52'
      ? { suggestions: [
        { source: 'tarifs', id: 'tarifs:30', label: 'Remplacement écran (OLED)', type_piece: 'Écran', qualite: 'OLED', prix: 159 },
        { source: 'tarifs', id: 'tarifs:31', label: 'Remplacement écran (Incell)', type_piece: 'Écran', qualite: 'Incell', prix: 109 },
      ] }
      : SUGG_IPHONE));
    apiMock.updatePart.mockResolvedValue({ ok: true, proposition_id: null });
    renderCommandes();
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier la commande Écran' }));
    const select = screen.getByLabelText('Pièce de la grille');
    await waitFor(() => expect(select).toHaveValue('tarifs:12'));
    // La pièce de l'iPhone n'est plus gardée : deux écrans du Galaxy A52, aucun choix imposé
    fireEvent.change(screen.getByLabelText('Ticket associé'), { target: { value: 'KP-000050' } });
    await waitFor(() => expect(select.querySelector('option[value="tarifs:30"]')).not.toBeNull());
    await waitFor(() => expect(select).toHaveValue(''));
    expect(select.querySelector('option[value="tarifs:12"]')).toBeNull();
    expect(within(select).queryByRole('option', { name: /Pièce enregistrée/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mettre à jour' }));
    await waitFor(() => expect(apiMock.updatePart).toHaveBeenCalledTimes(1));
    expect(apiMock.updatePart.mock.calls[0][1]).toMatchObject({ ticket_code: 'KP-000050', prix_ht: 52, tarif_cle: null });
  });

  it('prix historique libellé « Prix client TTC », distinct du prix HT payé', async () => {
    renderCommandes();
    fireEvent.click(await screen.findByRole('button', { name: /Nouvelle commande/ }));
    const ttc = screen.getByLabelText('Prix client TTC (€)');
    expect(ttc).toHaveAccessibleDescription(/Prix annoncé au client.*Prix HT payé/);
    expect(screen.getByLabelText('Prix HT payé (€)')).not.toBe(ttc);
  });

  it('réception : prix HT payé demandé puis proposition de prévenir le client', async () => {
    preparerTicket();
    const part = {
      id: 5, ticket_id: 42, ticket_code: 'KP-000042', description: 'Écran OLED', statut: 'Commandée',
      marque: 'Apple', modele: 'iPhone 13', client_tel: '0612345678', client_prenom: 'Léa', prix_ht: null,
    };
    apiMock.getParts.mockResolvedValue([part]);
    apiMock.updatePart.mockResolvedValue({ ok: true, proposition_id: 11 });
    renderCommandes();
    const statut = await screen.findByRole('combobox', { name: 'Statut de la commande Écran OLED' });
    fireEvent.change(statut, { target: { value: 'Reçu' } });
    await waitFor(() => expect(apiMock.updatePart).toHaveBeenCalledWith(5, { statut: 'Reçu' }));

    const dialogue = await screen.findByRole('dialog', { name: 'Pièce reçue : prix payé' });
    const select = within(dialogue).getByLabelText('Pièce de la grille');
    await waitFor(() => expect(select).toHaveValue('tarifs:12'));
    // Modèle connu par la ligne : pas de résolution du code
    expect(apiMock.resolveCode).not.toHaveBeenCalled();
    const enregistrer = within(dialogue).getByRole('button', { name: /Enregistrer le prix/ });
    expect(enregistrer).toBeDisabled();
    fireEvent.change(within(dialogue).getByLabelText('Prix HT payé (€)'), { target: { value: '51' } });
    fireEvent.click(enregistrer);
    await waitFor(() => expect(apiMock.updatePart).toHaveBeenLastCalledWith(5, { prix_ht: 51, tarif_cle: 'tarifs:12' }));
    expect(await screen.findByText(MESSAGE_PROPOSITION)).toBeInTheDocument();
    expect(await screen.findByRole('dialog', { name: /Pièce reçue !/ })).toBeInTheDocument();
  });

  it('réception : « Passer » n’envoie aucun prix', async () => {
    const part = { id: 6, description: 'Batterie', statut: 'Commandée', prix_ht: null, client_tel: '' };
    apiMock.getParts.mockResolvedValue([part]);
    apiMock.updatePart.mockResolvedValue({ ok: true });
    renderCommandes();
    fireEvent.change(await screen.findByRole('combobox', { name: 'Statut de la commande Batterie' }), { target: { value: 'Reçu' } });
    const dialogue = await screen.findByRole('dialog', { name: 'Pièce reçue : prix payé' });
    expect(within(dialogue).getByText(/Renseignez le ticket associé/)).toBeInTheDocument();
    fireEvent.click(within(dialogue).getByRole('button', { name: 'Passer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(apiMock.updatePart).toHaveBeenCalledTimes(1);
  });
});

// ─── Fiche ticket : commande d'une pièce de la grille ────────────
describe('fiche ticket : commande de pièce', () => {
  it('« Pièce à commander » sur une ligne de la grille fournisseur : la pièce (tarif_cle) part avec la commande', async () => {
    const lignes = [
      { label: 'Forfait remplacement batterie', prix: 79, source: 'tarifs', tarif_id: 'tarifs:56' },
      { label: 'Protection écran', prix: 15 },
    ];
    apiMock.getTicket.mockResolvedValue({
      id: 42, ticket_code: 'KP-000042', statut: 'En attente de pièce', client_id: 5, client_nom: 'Martin', client_prenom: 'Léa',
      client_tel: '0612345678', categorie: 'Smartphone', marque: 'Apple', modele: 'iPhone 13', panne: 'Batterie',
      date_depot: '2026-10-10T09:00:00', paye: 0, acompte: 0, devis_estime: 94, historique: '',
      reparation_supp: JSON.stringify(lignes),
    });
    apiMock.getMessageTemplates.mockResolvedValue([]);
    apiMock.getPartsByTicket.mockResolvedValue([]);
    apiMock.createPart.mockResolvedValue({ id: 70, description: 'Batterie', statut: 'En attente', tarif_cle: 'tarifs:56' });
    render(
      <MemoryRouter initialEntries={['/accueil/ticket/42']}>
        <ToastProvider><Routes><Route path="/accueil/ticket/:id" element={<TicketDetailPage />} /></Routes></ToastProvider>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier la réparation et les tarifs' }));
    const cases = await screen.findAllByRole('checkbox', { name: /Pièce à commander/ });
    expect(cases).toHaveLength(2);
    fireEvent.click(cases[0]);
    await waitFor(() => expect(apiMock.createPart).toHaveBeenCalledTimes(1));
    expect(apiMock.createPart.mock.calls[0][0]).toMatchObject({ ticket_id: 42, ticket_code: 'KP-000042', tarif_cle: 'tarifs:56' });
    // Saisie libre : aucune pièce de grille rattachée
    fireEvent.click(cases[1]);
    await waitFor(() => expect(apiMock.createPart).toHaveBeenCalledTimes(2));
    expect(apiMock.createPart.mock.calls[1][0]).not.toHaveProperty('tarif_cle');
  });
});

// ─── Propositions de prix ────────────────────────────────────────
const PROPOSITIONS = [
  { id: 1, tarif_cle: 'tarifs:12', label: 'Apple iPhone 13 — Écran OLED', ancien_ht: 48.5, nouveau_ht: 52.4, ancien_client: 129, nouveau_client: 129, commande_id: 5, ticket_code: 'KP-000042', le: '2026-10-15T10:00:00', verrou: false },
  { id: 2, tarif_cle: 'tarifs:30', label: 'Samsung Galaxy A52 — Écran', ancien_ht: 40, nouveau_ht: 80, ancien_client: 109, nouveau_client: 159, commande_id: 6, ticket_code: 'KP-000050', le: '2026-10-14T10:00:00', verrou: false },
  { id: 3, tarif_cle: 'tarifs:31', label: 'Xiaomi Redmi Note 12 — Batterie', ancien_ht: 12, nouveau_ht: 14, ancien_client: 79, nouveau_client: 79, commande_id: 7, verrou: true },
];

describe('propositions de prix', () => {
  it('écart et alerte : plus de 25 % ou de 30 €, alerte du serveur prioritaire ; sélection par défaut', () => {
    expect(ecartProposition(PROPOSITIONS[0])).toEqual({ eur: 3.9, pct: 8, alerte: false });
    expect(ecartProposition(PROPOSITIONS[1])).toMatchObject({ eur: 40, pct: 100, alerte: true });
    expect(ecartProposition({ ancien_ht: 200, nouveau_ht: 235 }).alerte).toBe(true); // +35 €
    expect(ecartProposition({ ancien_ht: 10, nouveau_ht: 13, alerte: false }).alerte).toBe(false);
    expect([...selectionParDefaut(PROPOSITIONS)]).toEqual([1]);
    expect(cheminPrixARevoir('/tech', 'propositions')).toBe('/tech/prix-a-revoir?onglet=propositions');
  });

  function renderPropositions(props = {}) {
    return render(
      <MemoryRouter><ToastProvider><PropositionsPrix basePath="/accueil" {...props} /></ToastProvider></MemoryRouter>,
    );
  }

  it('avant/après HT et prix client, grosse variation non cochée, verrou signalé ; lot et une à une', async () => {
    apiMock.getPropositionsPrix.mockResolvedValue(PROPOSITIONS);
    apiMock.accepterPropositionsPrix.mockResolvedValue({ acceptees: [1] });
    apiMock.refuserPropositionPrix.mockResolvedValue({ ok: true });
    const onCompte = vi.fn();
    renderPropositions({ onCompte });
    const titre = await screen.findByRole('heading', { name: /Propositions de prix/ });
    expect(titre).toHaveTextContent('3');
    expect(apiMock.getPropositionsPrix).toHaveBeenCalledWith({ statut: 'en_attente' });
    expect(onCompte).toHaveBeenLastCalledWith(3);

    expect(screen.getByRole('checkbox', { name: /Apple iPhone 13/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Samsung Galaxy A52/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Redmi Note 12 — Batterie \(prix verrouillé\)/ })).toBeDisabled();
    expect(screen.getByText(/1 grosse variation/)).toBeInTheDocument();
    expect(screen.getAllByText('Prix verrouillé').length).toBeGreaterThan(0);
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === '+40.00 € (+100 %)')).toBeInTheDocument();
    expect(screen.getByText('159.00 €')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Accepter la sélection (1)' }));
    await waitFor(() => expect(apiMock.accepterPropositionsPrix).toHaveBeenCalledWith([1]));
    expect(await screen.findByText('1 prix mis à jour')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: /Apple iPhone 13/ })).not.toBeInTheDocument());
    expect(onCompte).toHaveBeenLastCalledWith(2);

    fireEvent.click(screen.getByRole('button', { name: 'Refuser la proposition pour Samsung Galaxy A52 — Écran' }));
    await waitFor(() => expect(apiMock.refuserPropositionPrix).toHaveBeenCalledWith(2));
    await waitFor(() => expect(onCompte).toHaveBeenLastCalledWith(1));
  });

  it('réponse du serveur : alertes, pièce introuvable, lot partiellement appliqué puis liste relue', async () => {
    const liste = [
      { ...PROPOSITIONS[0], alertes: [] },
      { ...PROPOSITIONS[1], alertes: ['variation'] },
      { id: 4, tarif_cle: 'tarifs:99', label: 'tarifs:99', ancien_ht: 20, nouveau_ht: 22, ancien_client: null, nouveau_client: null, introuvable: true, alertes: [], verrou: false },
      { id: 5, tarif_cle: 'tarifs:40', label: 'Google Pixel 7 — Batterie', ancien_ht: 15, nouveau_ht: 17, ancien_client: 79, nouveau_client: 79, alertes: [], verrou: false },
    ];
    // Seuils du gérant : une petite variation peut être signalée par le serveur
    expect(ecartProposition({ ancien_ht: 10, nouveau_ht: 11, alertes: ['variation'] }).alerte).toBe(true);
    expect([...selectionParDefaut(liste)]).toEqual([1, 5]);
    apiMock.getPropositionsPrix.mockResolvedValueOnce(liste).mockResolvedValue([liste[1], liste[2], liste[3]]);
    apiMock.accepterPropositionsPrix.mockResolvedValue({ lot_id: 'x', acceptees: [1], verrouillees: [5], ignorees: [], modifies: 1 });
    renderPropositions();
    expect(await screen.findByRole('checkbox', { name: /tarifs:99 \(pièce introuvable\)/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Accepter le nouveau prix pour tarifs:99' })).toBeDisabled();
    expect(screen.getByText('Pièce introuvable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accepter la sélection (2)' }));
    await waitFor(() => expect(apiMock.accepterPropositionsPrix).toHaveBeenCalledWith([1, 5]));
    expect(await screen.findByText('1 prix mis à jour · 1 non appliqué (dont 1 verrouillé)')).toBeInTheDocument();
    await waitFor(() => expect(apiMock.getPropositionsPrix).toHaveBeenCalledTimes(2));
  });

  it('proposition déjà traitée ailleurs : elle quitte la liste', async () => {
    apiMock.getPropositionsPrix.mockResolvedValue([PROPOSITIONS[0]]);
    apiMock.accepterPropositionPrix.mockRejectedValue(Object.assign(new Error('Cette proposition a déjà été traitée.'), { status: 409, code: 'deja_traitee' }));
    renderPropositions();
    fireEvent.click(await screen.findByRole('button', { name: /Accepter le nouveau prix pour Apple iPhone 13/ }));
    expect(await screen.findByText('Cette proposition a déjà été traitée.')).toBeInTheDocument();
    expect(await screen.findByText('Aucune proposition en attente')).toBeInTheDocument();
  });

  it('prix verrouillé : « Accepter » désactivé avec l’explication ; refus du serveur en toast, ligne gardée', async () => {
    apiMock.getPropositionsPrix.mockResolvedValue([PROPOSITIONS[2], { ...PROPOSITIONS[0], id: 9 }]);
    // Verrouillé depuis le chargement de la liste : le serveur refuse (409)
    apiMock.accepterPropositionPrix.mockRejectedValue(Object.assign(new Error('Prix verrouillé : déverrouillez la pièce'), { status: 409, code: 'verrouille' }));
    renderPropositions();
    const verrouille = await screen.findByRole('button', { name: /Accepter le nouveau prix pour Xiaomi/ });
    expect(verrouille).toBeDisabled();
    expect(verrouille).toHaveAccessibleDescription(/Prix fixé à la main/);
    fireEvent.click(verrouille);
    expect(apiMock.accepterPropositionPrix).not.toHaveBeenCalled();
    // Refuser reste possible
    expect(screen.getByRole('button', { name: /Refuser la proposition pour Xiaomi/ })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /Accepter le nouveau prix pour Apple iPhone 13/ }));
    expect(await screen.findByText('Prix verrouillé : déverrouillez la pièce', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Accepter le nouveau prix pour Apple iPhone 13/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Annuler ce changement' })).not.toBeInTheDocument();
  });

  it('acceptation annulable : « Annuler ce changement » rétablit le lot puis relit la liste', async () => {
    apiMock.getPropositionsPrix.mockResolvedValueOnce([PROPOSITIONS[0], PROPOSITIONS[1]]).mockResolvedValue([PROPOSITIONS[1]]);
    apiMock.accepterPropositionPrix.mockResolvedValue({ id: 1, resultat: 'acceptee', ecrit: true, lot_id: 'lot-prop-1' });
    apiMock.accepterPropositionsPrix.mockResolvedValue({ lot_id: 'lot-prop-2', acceptees: [2], verrouillees: [], ignorees: [], modifies: 1 });
    apiMock.annulerLotPrix.mockResolvedValue({ restaures: 2, conflits: [] });
    renderPropositions();
    fireEvent.click(await screen.findByRole('button', { name: /Accepter le nouveau prix pour Apple iPhone 13/ }));
    expect(await screen.findByText('1 prix mis à jour : Apple iPhone 13 — Écran OLED.')).toBeInTheDocument();

    // Un lot ensuite : le bandeau porte le dernier lot
    fireEvent.click(screen.getByRole('checkbox', { name: /Samsung Galaxy A52/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Accepter la sélection (1)' }));
    expect(await screen.findByText('1 prix mis à jour.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Annuler ce changement' }));
    await waitFor(() => expect(apiMock.annulerLotPrix).toHaveBeenCalledWith('lot-prop-2'));
    expect(apiMock.annulerLotPrix).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Changement annulé : les prix sont revenus à leur valeur d’avant.', { selector: 'p.font-semibold' })).toBeInTheDocument();
    await waitFor(() => expect(apiMock.getPropositionsPrix).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Masquer ce message' }));
    expect(screen.queryByText(/Changement annulé/, { selector: 'p.font-semibold' })).not.toBeInTheDocument();
  });

  it('liste vide et erreur de droits', async () => {
    apiMock.getPropositionsPrix.mockResolvedValueOnce([]);
    const { unmount } = renderPropositions();
    expect(await screen.findByText('Aucune proposition en attente')).toBeInTheDocument();
    unmount();
    apiMock.getPropositionsPrix.mockRejectedValueOnce(Object.assign(new Error('Admin requis'), { status: 403 }));
    renderPropositions();
    expect(await screen.findByRole('alert')).toHaveTextContent('Réservé au gérant');
  });
});

// ─── Modèles sans prix et alias ──────────────────────────────────
const SANS_PRIX = [
  { categorie: 'Smartphone', marque: 'Samsung', modele: 'Galaxy A16', annee: 2024, tickets_12_mois: 2 },
  { categorie: 'Smartphone', marque: 'Apple', modele: 'iPhone Air', annee: 2025, tickets_12_mois: 1 },
  { categorie: 'Tablette', marque: 'Apple', modele: 'iPad Air 13 M3', annee: 2025, tickets_12_mois: 4 },
];

describe('modèles sans prix', () => {
  it('tri par année puis tickets (ou l’inverse) ; lien de saisie du prix', () => {
    expect(trierSansPrix(SANS_PRIX).map(m => m.modele)).toEqual(['iPad Air 13 M3', 'Galaxy A16', 'iPhone Air']);
    expect(trierSansPrix(SANS_PRIX, 'annee').map(m => m.modele)).toEqual(['iPad Air 13 M3', 'iPhone Air', 'Galaxy A16']);
    expect(lienSaisiePrix(SANS_PRIX[1], '/accueil')).toBe('/accueil/tarifs-reparation');
    expect(lienSaisiePrix(SANS_PRIX[0], '/tech')).toBe('/tech/tarifs?q=Samsung%20Galaxy%20A16');
  });

  function renderPage(url) {
    return render(
      <MemoryRouter initialEntries={[url]}>
        <ToastProvider>
          <Routes><Route path="/accueil/prix-a-revoir" element={<ModelesSansPrixPage />} /></Routes>
        </ToastProvider>
      </MemoryRouter>,
    );
  }

  it('liste triée, filtre par catégorie, alias ajouté depuis une ligne puis liste relue', async () => {
    apiMock.getModelesSansPrix.mockResolvedValue(SANS_PRIX);
    apiMock.getPropositionsPrix.mockResolvedValue(PROPOSITIONS);
    apiMock.ajouterAliasModele.mockResolvedValue({ id: 4 });
    renderPage('/accueil/prix-a-revoir?onglet=sans-prix');
    expect(await screen.findByText('Apple iPad Air 13 M3')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Modèles sans prix/ })).toHaveAttribute('aria-selected', 'true');
    // Badge des propositions en attente, même onglet fermé
    await waitFor(() => expect(screen.getByRole('tab', { name: /Propositions de prix/ })).toHaveTextContent('3'));
    const lignes = screen.getAllByRole('listitem').map(li => li.textContent);
    expect(lignes[0]).toMatch(/iPad Air 13 M3/);
    expect(screen.getByText('4 tickets sur 12 mois')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Saisir le prix de Apple iPhone Air' })).toHaveAttribute('href', '/accueil/tarifs-reparation');

    fireEvent.click(screen.getByRole('button', { name: 'Tablette' }));
    expect(screen.queryByText('Apple iPhone Air')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Toutes' }));

    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un alias pour Apple iPhone Air' }));
    expect(screen.getByLabelText('Nom saisi sur les tickets')).toHaveValue('iPhone Air');
    const canonique = screen.getByLabelText('Nom dans la grille de prix');
    const ajouter = screen.getByRole('button', { name: 'Ajouter l’alias' });
    expect(ajouter).toBeDisabled();
    fireEvent.change(canonique, { target: { value: 'iPhone 17 Air' } });
    fireEvent.click(ajouter);
    await waitFor(() => expect(apiMock.ajouterAliasModele).toHaveBeenCalledWith({ alias: 'iPhone Air', modele_canonique: 'iPhone 17 Air', categorie: 'Smartphone' }));
    expect(await screen.findByText('Alias ajouté : iPhone Air → iPhone 17 Air')).toBeInTheDocument();
    await waitFor(() => expect(apiMock.getModelesSansPrix).toHaveBeenCalledTimes(2));
  });

  it('onglets au clavier ; alias listés et supprimés', async () => {
    apiMock.getModelesSansPrix.mockResolvedValue([]);
    apiMock.getAliasModeles.mockResolvedValue([{ id: 1, alias: 'iPhone Air', modele_canonique: 'iPhone 17 Air', categorie: 'Smartphone', le: '2026-10-16T08:00:00' }]);
    apiMock.supprimerAliasModele.mockResolvedValue({ ok: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage('/accueil/prix-a-revoir');
    expect(await screen.findByText('Tous les modèles du catalogue ont un prix.')).toBeInTheDocument();
    const onglet = screen.getByRole('tab', { name: /Modèles sans prix/ });
    // Seul l'onglet actif pointe vers un panneau, qui existe dans le DOM
    for (const tab of screen.getAllByRole('tab')) {
      const cible = tab.getAttribute('aria-controls');
      if (tab.getAttribute('aria-selected') === 'true') expect(document.getElementById(cible)).toHaveAttribute('role', 'tabpanel');
      else expect(cible).toBeNull();
    }
    fireEvent.keyDown(onglet, { key: 'ArrowRight' });
    expect(await screen.findByText('iPhone 17 Air')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Alias de modèles/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer l’alias iPhone Air' }));
    await waitFor(() => expect(apiMock.supprimerAliasModele).toHaveBeenCalledWith(1));
    expect(await screen.findByText('Aucun alias pour le moment.')).toBeInTheDocument();
  });

  it('onglet des propositions depuis le lien du widget', async () => {
    apiMock.getPropositionsPrix.mockResolvedValue([PROPOSITIONS[0]]);
    renderPage('/accueil/prix-a-revoir?onglet=propositions');
    expect(await screen.findByRole('checkbox', { name: /Apple iPhone 13/ })).toBeInTheDocument();
    expect(apiMock.getModelesSansPrix).not.toHaveBeenCalled();
  });
});

// ─── Santé des prix ──────────────────────────────────────────────
const SANTE = {
  total: 1251, estimes: 1251, a_revoir: 0, perimes: 1251, propositions_en_attente: 2, marges_faibles: 3,
  modeles_sans_prix: 41, derniere_veille: '2026-10-12T03:00:00',
  lcdphone: { derniere_synchro: '2026-10-10T09:00:00', ok: true },
};

describe('santé des prix', () => {
  it('tuiles : tons, liens vers les propositions, les modèles sans prix et les téléphones', () => {
    const t = Object.fromEntries(tuilesSante(SANTE, '/accueil', MAINTENANT).map(x => [x.cle, x]));
    expect(t.estimes).toMatchObject({ valeur: (1251).toLocaleString('fr-FR'), ton: 'orange' });
    expect(t.perimes.ton).toBe('rouge');
    expect(t.a_revoir.ton).toBe('neutre');
    expect(t.propositions).toMatchObject({ lien: '/accueil/prix-a-revoir?onglet=propositions', badge: true, ton: 'marque' });
    expect(t.sans_prix.lien).toBe('/accueil/prix-a-revoir?onglet=sans-prix');
    expect(t.lcdphone).toMatchObject({ lien: '/accueil/tarifs-telephones', valeur: '6 j', ton: 'neutre' });
    // Liens de la grille avec leur filtre dans l'URL (à appliquer par TarifsPage)
    expect(t.estimes.lien).toBe('/accueil/tarifs?source=estimation');
    expect(t.a_revoir.lien).toBe('/accueil/tarifs?fraicheur=a_revoir');
    expect(t.perimes.lien).toBe('/accueil/tarifs?fraicheur=perime');
    expect(t.marges.lien).toBe('/accueil/tarifs?marge=faible');
    const echec = Object.fromEntries(tuilesSante({ lcdphone: { derniere_synchro: '2026-10-10T09:00:00', ok: false } }, '/tech', MAINTENANT).map(x => [x.cle, x]));
    expect(echec.lcdphone.ton).toBe('rouge');
    const vide = Object.fromEntries(tuilesSante({ modeles_sans_prix: null, seuils: { jours_a_revoir: 60, jours_perime: 120 } }, '/accueil').map(x => [x.cle, x]));
    expect(vide.lcdphone).toMatchObject({ valeur: '—', ton: 'orange' });
    // Avant la première veille : nombre inconnu, jamais « 0 »
    expect(vide.sans_prix).toMatchObject({ valeur: '—', ton: 'neutre', detail: 'compté par la veille' });
    expect(vide.a_revoir.detail).toBe('plus de 60 jours');
  });

  it('widget : chiffres, liens accessibles ; erreur puis « Réessayer »', async () => {
    apiMock.getSantePrix.mockRejectedValueOnce(new Error('Erreur 500')).mockResolvedValueOnce(SANTE);
    render(<MemoryRouter><SantePrixWidget basePath="/accueil" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
    const lien = await screen.findByRole('link', { name: '2 propositions de prix en attente, à valider' });
    expect(lien).toHaveAttribute('href', '/accueil/prix-a-revoir?onglet=propositions');
    expect(screen.getByRole('link', { name: /41 modèles du catalogue sans prix/ })).toHaveAttribute('href', '/accueil/prix-a-revoir?onglet=sans-prix');
    expect(screen.getByText('Veille hebdomadaire du 12/10/2026')).toBeInTheDocument();
    // Synchro enregistrée : pas de repli sur le catalogue
    expect(apiMock.getTelephoneStats).not.toHaveBeenCalled();
  });

  it('widget juste après le déploiement : date du catalogue LCD-Phone en repli, jamais « jamais faite »', async () => {
    apiMock.getSantePrix.mockResolvedValue({ ...SANTE, lcdphone: { derniere_synchro: null, ok: null } });
    apiMock.getTelephoneStats.mockResolvedValue({ total: 577, derniere_sync: '2026-10-10T09:00:00' });
    render(<MemoryRouter><SantePrixWidget basePath="/accueil" /></MemoryRouter>);
    const lien = await screen.findByRole('link', { name: /Dernière synchro LCD-Phone le 10\/10\/2026, voir les téléphones/ });
    expect(lien).toHaveTextContent('10/10/2026');
    expect(lien).not.toHaveTextContent('jamais faite');
    expect(lien).not.toHaveTextContent('échouée');
  });

  function renderDashboard() {
    apiMock.getDashboard.mockResolvedValue({ tickets: [], total: 0, kpi: {} });
    apiMock.getSantePrix.mockResolvedValue(SANTE);
    return render(<MemoryRouter initialEntries={['/accueil']}><ToastProvider><DashboardPage /></ToastProvider></MemoryRouter>);
  }

  it('tableau de bord : widget réservé à l’admin', async () => {
    auth.user = { ...auth.user, role: 'admin' };
    const { unmount } = renderDashboard();
    expect(await screen.findByRole('heading', { name: 'Santé des prix' })).toBeInTheDocument();
    unmount();
    auth.user = { ...auth.user, role: '' };
    apiMock.getSantePrix.mockClear();
    renderDashboard();
    await screen.findByText(/Statistiques du jour/);
    expect(screen.queryByRole('heading', { name: 'Santé des prix' })).not.toBeInTheDocument();
    expect(apiMock.getSantePrix).not.toHaveBeenCalled();
  });
});

// ─── Synchro LCD-Phone ───────────────────────────────────────────
describe('synchro LCD-Phone', () => {
  it('statut durable (params) et ancien format en mémoire ; analyse du test de connexion', () => {
    expect(lireStatutSynchro({ running: false, derniere_synchro: '2026-10-10T09:00:00', ok: true, resume: { total: 412 } }))
      .toEqual({ enCours: false, date: '2026-10-10T09:00:00', ok: true, erreur: null, total: 412 });
    expect(lireStatutSynchro({ running: false, finished_at: '2026-10-10T09:00:00', last_result: { success: false, error: 'Login refusé' } }))
      .toMatchObject({ ok: false, erreur: 'Login refusé', date: '2026-10-10T09:00:00' });
    expect(lireStatutSynchro({ running: true })).toMatchObject({ enCours: true, date: null, ok: null });
    expect(analyserProbe({ success: false, error: 'Identifiants LCD-Phone absents' }))
      .toMatchObject({ ok: false, message: 'Connexion LCD-Phone refusée : Identifiants LCD-Phone absents' });
    expect(analyserProbe({ success: true, login: 'OK', categories: { a: { nb_products_json: 0 }, b: { error: 'x' } } }).ok).toBe(false);
    expect(analyserProbe({ success: true, categories: { a: { nb_products_json: 12 }, b: { nb_products_json: 0 } } }))
      .toMatchObject({ ok: true, avertissement: true, message: 'Connexion LCD-Phone OK : 1 catégorie sur 2 lue.' });
  });

  function renderSynchro(props) {
    return render(<ToastProvider><SynchroLcdPhone intervalle={5} {...props} /></ToastProvider>);
  }

  it('non-admin : date de la dernière synchro seulement', async () => {
    apiMock.getSyncStatus.mockResolvedValue({ running: false, derniere_synchro: '2026-10-10T09:00:00', ok: false, resume: { error: 'Login refusé' } });
    renderSynchro({ estAdmin: false });
    expect(await screen.findByText(/Dernière synchro LCD-Phone : .* · échouée/)).toBeInTheDocument();
    expect(screen.getByText('Login refusé')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('aucune synchro enregistrée : date du catalogue (stats) en repli', async () => {
    apiMock.getSyncStatus.mockResolvedValue({ running: false, derniere_synchro: null, synchro_ok: null, resume: null });
    renderSynchro({ estAdmin: false, dateRepli: '2026-10-10T09:00:00' });
    expect(await screen.findByText(/^Dernière synchro LCD-Phone : 10\/10\/2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Aucune synchro/)).not.toBeInTheDocument();
    expect(screen.queryByText(/réussie|échouée/)).not.toBeInTheDocument();
  });

  it('admin : « Synchroniser » bloqué tant que le test n’a pas réussi ; test refusé en toast', async () => {
    apiMock.getSyncStatus.mockResolvedValue({ running: false });
    apiMock.probeTelephones.mockResolvedValue({ success: false, error: 'Échec login' });
    renderSynchro({ estAdmin: true });
    expect(await screen.findByText('Aucune synchro LCD-Phone enregistrée')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Synchroniser' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Tester la connexion' }));
    const alerte = await screen.findByRole('alert');
    expect(alerte).toHaveTextContent('Connexion LCD-Phone refusée : Échec login');
    expect(screen.getByRole('button', { name: 'Synchroniser' })).toBeDisabled();
  });

  it('un toast s’affiche quand syncTelephones rejette', async () => {
    apiMock.getSyncStatus.mockResolvedValue({ running: false });
    apiMock.probeTelephones.mockResolvedValue({ success: true, categories: { a: { nb_products_json: 12 } } });
    apiMock.syncTelephones.mockRejectedValue(new Error('Admin requis'));
    renderSynchro({ estAdmin: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Tester la connexion' }));
    expect(await screen.findByText('Connexion LCD-Phone OK : 1 catégorie sur 1 lue.')).toBeInTheDocument();
    const bouton = screen.getByRole('button', { name: 'Synchroniser' });
    await waitFor(() => expect(bouton).toBeEnabled());
    fireEvent.click(bouton);
    expect(await screen.findByText('Synchronisation LCD-Phone impossible : Admin requis')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Synchroniser' })).toBeEnabled());
  });

  it('synchro suivie jusqu’au bout : toast de fin, liste relue', async () => {
    const onTerminee = vi.fn();
    apiMock.getSyncStatus
      .mockResolvedValueOnce({ running: false, derniere_synchro: '2026-10-01T09:00:00', ok: true })
      .mockResolvedValueOnce({ running: true })
      .mockResolvedValue({ running: false, derniere_synchro: '2026-10-16T12:00:00', ok: true, resume: { total: 412 } });
    apiMock.probeTelephones.mockResolvedValue({ success: true, categories: { a: { nb_products_json: 12 } } });
    apiMock.syncTelephones.mockResolvedValue({ message: 'Sync lancée en arrière-plan' });
    renderSynchro({ estAdmin: true, onTerminee });
    fireEvent.click(await screen.findByRole('button', { name: 'Tester la connexion' }));
    const bouton = await screen.findByRole('button', { name: 'Synchroniser' });
    await waitFor(() => expect(bouton).toBeEnabled());
    fireEvent.click(bouton);
    expect(await screen.findByText('Synchronisation lancée : quelques minutes.')).toBeInTheDocument();
    expect(await screen.findByText('Synchronisation LCD-Phone terminée : 412 téléphones')).toBeInTheDocument();
    expect(onTerminee).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Dernière synchro LCD-Phone : 16\/10\/2026/)).toBeInTheDocument();
  });
});
