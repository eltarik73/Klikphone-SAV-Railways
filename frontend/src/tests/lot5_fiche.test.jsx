/**
 * Fiche ticket : priorité atelier, lignes depuis la grille tarifaire, fiche de réception.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
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
import TicketDetailPage, { completerLayout, indexRemplaceGrille } from '../pages/TicketDetailPage';
import { construireCatalogue, definirCatalogue } from '../lib/prestations';
import {
  PrioriteBadge, PrioriteSelecteur, normaliserPriorite, comparerPriorite, libellePriorite, VALEURS_PRIORITE,
} from '../components/PrioriteBadge';
import TarifPicker, { ligneDepuisSuggestion, tonStock } from '../components/TarifPicker';
import ReceptionCard, {
  imeiValide, normaliserItems, resumeReception, itemsVides, receptionAttendue,
} from '../components/ReceptionCard';

const IMEI_OK = '490154203237518';
const IMEI_KO = '490154203237519';

// Extrait de GET /api/catalog/prestations (backend/app/services/prestations.py)
const CATALOGUE = {
  pannes: ['Écran cassé', 'Batterie', 'Diagnostic', 'Autre'],
  prestations: [
    { cle: 'ecran', symptome: 'Écran cassé', prestation: 'Forfait remplacement écran', court: 'Écran', alias: ['Écran HS'] },
    { cle: 'batterie', symptome: 'Batterie', prestation: 'Forfait remplacement batterie', court: 'Batterie', alias: ['Batterie HS'] },
    { cle: 'diagnostic', symptome: 'Diagnostic', prestation: 'Diagnostic', court: 'Diagnostic', alias: [] },
  ],
};

const SUGGESTIONS = {
  modele_trouve: true,
  suggestions: [
    { source: 'tarifs', id: 'tarifs:12', label: 'Forfait remplacement écran (OLED)', type_piece: 'Écran', qualite: 'OLED', prix: 129, stock: 'En stock', cout_ht: 48.5, modele: 'iPhone 13' },
    { source: 'tarifs', id: 'tarifs:13', label: 'Forfait remplacement écran (Incell)', type_piece: 'Écran', qualite: 'Incell', prix: 89, stock: 'Rupture', cout_ht: null, modele: 'iPhone 13' },
    { source: 'tarifs_reparation', id: 'tarifs_reparation:3:batterie', label: 'Forfait remplacement batterie', type_piece: 'Batterie', qualite: null, prix: 69, stock: null, cout_ht: null, modele: 'iPhone 13' },
  ],
};

function ticket(overrides = {}) {
  return {
    id: 42, ticket_code: 'KP-000042', statut: 'En cours de réparation', client_id: 5,
    client_nom: 'Martin', client_prenom: 'Léa', client_tel: '0612345678', client_email: '',
    categorie: 'Smartphone', marque: 'Apple', modele: 'iPhone 13', panne: 'Écran cassé', imei: '',
    date_depot: '2026-10-10T09:00:00', paye: 0, acompte: 0, devis_estime: 0, priorite: 'normal',
    reparation_supp: '[]', tarif_final: 0, historique: '',
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
let reception;

beforeEach(() => {
  clearCache();
  definirCatalogue(null);
  try { localStorage.clear(); } catch { /* stockage indisponible */ }
  auth.user = { target: 'accueil', utilisateur: 'Sophie', role: '' };
  for (const fn of Object.values(apiMock)) fn.mockReset().mockResolvedValue([]);
  courant = ticket();
  reception = { items: null, complete: false, auteur: null, date_maj: null };
  apiMock.getTicket.mockImplementation(async () => ({ ...courant }));
  apiMock.markTicketRead.mockResolvedValue({ ok: true });
  apiMock.addHistory.mockResolvedValue({ ok: true });
  apiMock.updateTicket.mockImplementation(async (id, patch) => {
    courant = { ...courant, ...patch };
    return { ok: true, ticket: { ...courant } };
  });
  apiMock.getGrilleSuggestions.mockResolvedValue(SUGGESTIONS);
  apiMock.getReception.mockImplementation(async () => ({ ...reception }));
  apiMock.saveReception.mockImplementation(async (id, data) => {
    reception = { ...data, auteur: 'Sophie', date_maj: '2026-10-16T10:00:00' };
    return { ...reception };
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── Priorité atelier ───────────────────────────────────────────
describe('PrioriteBadge / PrioriteSelecteur', () => {
  it('valeurs du contrat, libellés, valeur inconnue ramenée à « normal », ordre de la file', () => {
    expect(VALEURS_PRIORITE).toEqual(['normal', 'express', 'attente', 'pro']);
    expect(libellePriorite('attente')).toBe('Client attend sur place');
    expect(libellePriorite('pro')).toBe('Pro');
    expect(normaliserPriorite(null)).toBe('normal');
    expect(normaliserPriorite(' EXPRESS ')).toBe('express');
    expect(normaliserPriorite('urgent')).toBe('normal');
    const tries = ['normal', 'pro', 'express', 'attente'].sort(comparerPriorite);
    expect(tries).toEqual(['attente', 'express', 'pro', 'normal']);
  });

  it('badge : rien pour « normal » (sauf demandé), libellé complet ou court', () => {
    const { container, rerender } = render(<PrioriteBadge priorite="normal" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<PrioriteBadge priorite="normal" afficherNormal />);
    expect(screen.getByText('Normal')).toBeInTheDocument();
    rerender(<PrioriteBadge priorite="attente" />);
    expect(screen.getByText('Client attend sur place')).toBeInTheDocument();
    rerender(<PrioriteBadge priorite="attente" court />);
    expect(screen.getByText('Attend sur place')).toBeInTheDocument();
  });

  it('sélecteur : 4 boutons radio dans un groupe nommé, choix transmis', () => {
    const onChange = vi.fn();
    render(<PrioriteSelecteur value="express" onChange={onChange} />);
    const groupe = screen.getByRole('group', { name: 'Priorité atelier' });
    const radios = within(groupe).getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(screen.getByRole('radio', { name: 'Express' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Client attend sur place' }));
    expect(onChange).toHaveBeenCalledWith('attente');
  });
});

describe('Fiche : priorité atelier', () => {
  it('choix enregistré en PATCH partiel { priorite } après un court délai, badge visible dans l’en-tête', async () => {
    renderFiche();
    const attente = await screen.findByRole('radio', { name: 'Client attend sur place' });
    expect(screen.getByRole('radio', { name: 'Normal' })).toBeChecked();
    fireEvent.click(attente);
    await waitFor(() => expect(apiMock.updateTicket).toHaveBeenCalledWith('42', { priorite: 'attente' }));
    expect(attente).toBeChecked();
    expect(screen.getByText('Client attend sur place', { selector: 'span.rounded-full' })).toBeInTheDocument();
  });

  it('valeur déjà enregistrée : aucun envoi', async () => {
    courant = ticket({ priorite: 'pro' });
    renderFiche();
    const pro = await screen.findByRole('radio', { name: 'Pro' });
    expect(pro).toBeChecked();
    fireEvent.click(pro);
    await new Promise((r) => setTimeout(r, 600));
    expect(apiMock.updateTicket.mock.calls.filter(([, p]) => 'priorite' in p)).toEqual([]);
  });

  it('navigation au clavier (Normal → Express → Client attend → Pro) : un seul PATCH, avec la dernière valeur', async () => {
    renderFiche();
    await screen.findByRole('radio', { name: 'Express' });
    for (const nom of ['Express', 'Client attend sur place', 'Pro']) fireEvent.click(screen.getByRole('radio', { name: nom }));
    expect(screen.getByRole('radio', { name: 'Pro' })).toBeChecked();
    await waitFor(() => expect(apiMock.updateTicket.mock.calls.filter(([, p]) => 'priorite' in p)).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 500));
    expect(apiMock.updateTicket.mock.calls.filter(([, p]) => 'priorite' in p)).toEqual([['42', { priorite: 'pro' }]]);
  });
});

// ─── Grille tarifaire ───────────────────────────────────────────
describe('TarifPicker', () => {
  it('suggestion → ligne { label, prix, source, tarif_id, qualite } ; couleur du stock', () => {
    expect(ligneDepuisSuggestion(SUGGESTIONS.suggestions[0])).toEqual({
      label: 'Forfait remplacement écran (OLED)', prix: 129, source: 'tarifs', tarif_id: 'tarifs:12', qualite: 'OLED',
    });
    expect(ligneDepuisSuggestion(SUGGESTIONS.suggestions[2])).toEqual({
      label: 'Forfait remplacement batterie', prix: 69, source: 'tarifs_reparation', tarif_id: 'tarifs_reparation:3:batterie',
    });
    expect(tonStock('En stock')).toMatch(/emerald/);
    expect(tonStock('3 en stock')).toMatch(/emerald/);
    expect(tonStock('Rupture')).toMatch(/red/);
    expect(tonStock('Sur commande')).toMatch(/amber/);
    expect(tonStock(null)).toBeNull();
  });

  it('filtré sur l’appareil, prix client ; prix d’achat réservé à l’admin ; filtre qualité', async () => {
    const onChoisir = vi.fn();
    const { rerender } = render(<TarifPicker open onClose={() => {}} onChoisir={onChoisir} marque="Apple" modele="iPhone 13" categorie="Smartphone" />);
    const dialogue = await screen.findByRole('dialog', { name: 'Ajouter depuis la grille' });
    await within(dialogue).findByText('Forfait remplacement écran (OLED)');
    expect(apiMock.getGrilleSuggestions).toHaveBeenCalledWith({ q: '', limit: 20, marque: 'Apple', modele: 'iPhone 13', categorie: 'Smartphone' });
    expect(within(dialogue).getByText('129.00 €')).toBeInTheDocument();
    expect(within(dialogue).getByText('Rupture')).toBeInTheDocument();
    expect(within(dialogue).queryByText(/Achat HT/)).not.toBeInTheDocument();

    rerender(<TarifPicker open onClose={() => {}} onChoisir={onChoisir} marque="Apple" modele="iPhone 13" categorie="Smartphone" isAdmin />);
    expect(await within(dialogue).findByText('Achat HT 48.50 €')).toBeInTheDocument();

    fireEvent.click(within(dialogue).getByRole('button', { name: 'Incell' }));
    expect(within(dialogue).queryByText('Forfait remplacement écran (OLED)')).not.toBeInTheDocument();
    expect(within(dialogue).getByText('Forfait remplacement écran (Incell)')).toBeInTheDocument();
  });

  it('recherche et filtre appareil décoché : requête libre ; modèle inconnu signalé', async () => {
    apiMock.getGrilleSuggestions.mockResolvedValue({ modele_trouve: false, suggestions: [] });
    render(<TarifPicker open onClose={() => {}} onChoisir={() => {}} marque="Apple" modele="iPhone 99" categorie="Smartphone" />);
    expect(await screen.findByText(/n’est pas reconnu dans les grilles/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Apple iPhone 99 uniquement' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Rechercher dans la grille' }), { target: { value: 'batt' } });
    await waitFor(() => expect(apiMock.getGrilleSuggestions).toHaveBeenLastCalledWith({ q: 'batt', limit: 20 }));
    expect(await screen.findByText(/Aucun tarif trouvé pour « batt »/)).toBeInTheDocument();
  });

  it('Échap ferme ; une erreur propose « Réessayer »', async () => {
    const onClose = vi.fn();
    apiMock.getGrilleSuggestions.mockRejectedValueOnce(new Error('Erreur 500'));
    render(<TarifPicker open onClose={onClose} onChoisir={() => {}} marque="Apple" modele="iPhone 13" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Grille indisponible : Erreur 500');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Forfait remplacement batterie')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Fiche : ajout depuis la grille', () => {
  const ouvrirTarifs = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier la réparation et les tarifs' }));
  };
  const envoisLignes = () => apiMock.updateTicket.mock.calls.filter(([, p]) => 'reparation_supp' in p).map(([, p]) => p);

  it('la suggestion remplace la ligne vide et part avec son origine ; montants recalculés', async () => {
    renderFiche();
    await ouvrirTarifs();
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter depuis la grille' }));
    const dialogue = await screen.findByRole('dialog', { name: 'Ajouter depuis la grille' });
    fireEvent.click(await within(dialogue).findByRole('button', { name: /^Ajouter Forfait remplacement écran \(OLED\)/ }));
    expect(screen.queryByRole('dialog', { name: 'Ajouter depuis la grille' })).not.toBeInTheDocument();
    await waitFor(() => expect(envoisLignes()).toHaveLength(1));
    const [patch] = envoisLignes();
    expect(JSON.parse(patch.reparation_supp)).toEqual([
      { label: 'Forfait remplacement écran (OLED)', prix: 129, source: 'tarifs', tarif_id: 'tarifs:12', qualite: 'OLED' },
    ]);
    expect(patch).toMatchObject({ prix_supp: 129, tarif_final: 129, reste_a_payer: 129 });
    expect(screen.getByLabelText('Description de la ligne 1')).toHaveValue('Forfait remplacement écran (OLED)');
    expect(screen.getByText('Grille · OLED')).toBeInTheDocument();
  });

  it('origine conservée au rechargement puis après une modification du prix ; saisie libre intacte', async () => {
    courant = ticket({
      reparation_supp: JSON.stringify([
        { label: 'Forfait remplacement écran (OLED)', prix: 129, source: 'tarifs', tarif_id: 'tarifs:12', qualite: 'OLED' },
        { label: 'Protection verre trempé', prix: 15 },
      ]),
      tarif_final: 144,
    });
    renderFiche();
    await ouvrirTarifs();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Prix de la ligne 1 en euros' }), { target: { value: '119' } });
    await waitFor(() => expect(envoisLignes()).toHaveLength(1), { timeout: 3000 });
    expect(JSON.parse(envoisLignes()[0].reparation_supp)).toEqual([
      { label: 'Forfait remplacement écran (OLED)', prix: 119, source: 'tarifs', tarif_id: 'tarifs:12', qualite: 'OLED' },
      { label: 'Protection verre trempé', prix: 15 },
    ]);
    expect(envoisLignes()[0]).toMatchObject({ tarif_final: 134 });
  });

  it('ligne déjà remplie : la suggestion s’ajoute à la fin', async () => {
    courant = ticket({ reparation_supp: JSON.stringify([{ label: 'Diagnostic', prix: 20 }]), tarif_final: 20 });
    renderFiche();
    await ouvrirTarifs();
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter depuis la grille' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Ajouter Forfait remplacement batterie/ }));
    await waitFor(() => expect(envoisLignes()).toHaveLength(1));
    expect(JSON.parse(envoisLignes()[0].reparation_supp)).toEqual([
      { label: 'Diagnostic', prix: 20 },
      { label: 'Forfait remplacement batterie', prix: 69, source: 'tarifs_reparation', tarif_id: 'tarifs_reparation:3:batterie' },
    ]);
  });

  it('ticket « Écran cassé » au devis estimé : la ligne par défaut est remplacée, pas doublée', async () => {
    definirCatalogue(CATALOGUE);
    courant = ticket({ panne: 'Écran cassé', devis_estime: 99, reparation_supp: null, tarif_final: 0 });
    renderFiche();
    await ouvrirTarifs();
    expect(screen.getByLabelText('Description de la ligne 1')).toHaveValue('Forfait remplacement écran');
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter depuis la grille' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Ajouter Forfait remplacement écran \(OLED\)/ }));
    await waitFor(() => expect(envoisLignes()).toHaveLength(1));
    expect(JSON.parse(envoisLignes()[0].reparation_supp)).toEqual([
      { label: 'Forfait remplacement écran (OLED)', prix: 129, source: 'tarifs', tarif_id: 'tarifs:12', qualite: 'OLED' },
    ]);
    expect(envoisLignes()[0]).toMatchObject({ prix_supp: 129, tarif_final: 129 });
    expect(screen.getByLabelText('Description de la ligne 1')).toHaveValue('Forfait remplacement écran (OLED)');
    expect(screen.queryByLabelText('Description de la ligne 2')).not.toBeInTheDocument();
  });

  it('ticket « Écran cassé » au devis estimé : une autre prestation de la grille s’ajoute', async () => {
    definirCatalogue(CATALOGUE);
    courant = ticket({ panne: 'Écran cassé', devis_estime: 99, reparation_supp: null, tarif_final: 0 });
    renderFiche();
    await ouvrirTarifs();
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter depuis la grille' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Ajouter Forfait remplacement batterie/ }));
    await waitFor(() => expect(envoisLignes()).toHaveLength(1));
    expect(JSON.parse(envoisLignes()[0].reparation_supp).map(l => [l.label, l.prix])).toEqual([
      ['Forfait remplacement écran', 99], ['Forfait remplacement batterie', 69],
    ]);
    expect(envoisLignes()[0]).toMatchObject({ tarif_final: 168 });
  });

  it('lignes enregistrées : la ligne de la même prestation est remplacée à sa place', async () => {
    definirCatalogue(CATALOGUE);
    courant = ticket({
      reparation_supp: JSON.stringify([{ label: 'Protection verre trempé', prix: 15 }, { label: 'Forfait remplacement écran', prix: 99 }]),
      tarif_final: 114,
    });
    renderFiche();
    await ouvrirTarifs();
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter depuis la grille' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Ajouter Forfait remplacement écran \(Incell\)/ }));
    await waitFor(() => expect(envoisLignes()).toHaveLength(1));
    expect(JSON.parse(envoisLignes()[0].reparation_supp).map(l => [l.label, l.prix])).toEqual([
      ['Protection verre trempé', 15], ['Forfait remplacement écran (Incell)', 89],
    ]);
    expect(envoisLignes()[0]).toMatchObject({ tarif_final: 104 });
  });
});

describe('indexRemplaceGrille', () => {
  const cat = construireCatalogue(CATALOGUE);
  const [oled, incell, batterie] = SUGGESTIONS.suggestions;
  const choix = (s) => ligneDepuisSuggestion(s);
  const defaut = [{ label: 'Forfait remplacement écran', prix: 99 }];

  it('ligne par défaut jamais enregistrée', () => {
    expect(indexRemplaceGrille(defaut, choix(oled), oled, { enregistrees: false, cat })).toBe(0);
    expect(indexRemplaceGrille(defaut, choix(batterie), batterie, { enregistrees: false, cat })).toBe(-1);
    expect(indexRemplaceGrille([{ label: 'Forfait remplacement écran', prix: 0 }], choix(batterie), batterie, { enregistrees: false, cat })).toBe(0);
    expect(indexRemplaceGrille([{ label: 'Réparation - ne s’allume plus', prix: 49 }], choix(batterie), batterie, { enregistrees: false, cat })).toBe(0);
  });

  it('lignes enregistrées : même prestation (qualité changée comprise), sinon ligne vide, sinon ajout', () => {
    expect(indexRemplaceGrille(defaut, choix(batterie), batterie, { enregistrees: true, cat })).toBe(-1);
    expect(indexRemplaceGrille([{ label: 'Batterie', prix: 50 }, ...defaut], choix(oled), oled, { cat })).toBe(1);
    expect(indexRemplaceGrille([choix(oled)], choix(incell), incell, { cat })).toBe(0);
    expect(indexRemplaceGrille([{ label: 'Diagnostic', prix: 20 }, { label: '', prix: 0 }], choix(batterie), batterie, { cat })).toBe(1);
    expect(indexRemplaceGrille([{ label: 'Diagnostic', prix: 20 }], choix(batterie), batterie, { cat })).toBe(-1);
    // Sans table des prestations : libellé identique seulement
    expect(indexRemplaceGrille([{ label: 'Forfait remplacement batterie', prix: 59 }], choix(batterie), batterie, { cat: null })).toBe(0);
  });
});

// ─── Fiche de réception ─────────────────────────────────────────
describe('Réception : modèle', () => {
  it('IMEI (Luhn) ou n° de série ; chiffres seuls = IMEI obligatoire', () => {
    expect(imeiValide(IMEI_OK)).toBe(true);
    expect(imeiValide('49-015420-323751-8')).toBe(true);
    expect(imeiValide(IMEI_KO)).toBe(false);
    expect(imeiValide('12345678')).toBe(false);
    expect(imeiValide('F2LXK0Q1HG7J')).toBe(true);
    expect(imeiValide('abc')).toBe(false);
    expect(imeiValide('')).toBe(false);
  });

  it('items normalisés : valeurs par défaut, valeurs inconnues écartées, clés futures gardées', () => {
    const vide = itemsVides();
    expect(vide.etat).toEqual({ ecran: 'ok', dos: 'ok', chassis: 'ok', notes: '' });
    expect(Object.values(vide.tests).every(v => v === null)).toBe(true);
    expect(Object.keys(vide.tests)).toHaveLength(12);
    const n = normaliserItems({
      accessoires: ['coque', 'coque', 'parapluie'], etat: { ecran: 'raye', chassis: 'fissure' },
      tests: { micro: false, wifi: 'oui' }, imei_verifie: '  ', futur: 1,
    });
    expect(n.accessoires).toEqual(['coque']);
    expect(n.etat).toMatchObject({ ecran: 'raye', dos: null, chassis: null, notes: '' });
    expect(n.tests.micro).toBe(false);
    expect(n.tests.wifi).toBeNull();
    expect(n.imei_verifie).toBeNull();
    expect(n.futur).toBe(1);
  });

  it('résumé : accessoires (« autre » précisé), état, tests KO et non testés', () => {
    const r = resumeReception({
      accessoires: ['chargeur', 'autre'], accessoires_autre: 'Pochette',
      etat: { ecran: 'fissure', dos: 'ok', chassis: 'ok', notes: ' Oxydation ' },
      tests: { allume: true, micro: false, camera_avant: false },
    });
    expect(r.accessoires).toEqual(['Chargeur', 'Pochette']);
    expect(r.etat.map(e => [e.nom, e.valeur, e.ok])).toEqual([['Écran', 'Fissuré', false], ['Dos', 'OK', true], ['Châssis', 'OK', true]]);
    expect(r.ko).toEqual(['Caméra avant', 'Micro']);
    expect(r.nonTestes).toBe(9);
    expect(r.notes).toBe('Oxydation');
  });

  it('réception attendue : en attente de diagnostic ou déposé depuis moins de 24 h, jamais pré-enregistré', () => {
    const maintenant = Date.parse('2026-10-16T12:00:00');
    expect(receptionAttendue('En attente de diagnostic', '2026-09-01T09:00:00', maintenant)).toBe(true);
    expect(receptionAttendue('En cours de réparation', '2026-10-16T08:00:00', maintenant)).toBe(true);
    expect(receptionAttendue('En cours de réparation', '2026-10-15 13:00:00', maintenant)).toBe(true);
    expect(receptionAttendue('En cours de réparation', '2026-10-10T09:00:00', maintenant)).toBe(false);
    expect(receptionAttendue('Pré-enregistré', '2026-10-16T11:00:00', maintenant)).toBe(false);
    expect(receptionAttendue('En attente de pièce', null, maintenant)).toBe(false);
    expect(receptionAttendue('En attente de pièce', 'hier', maintenant)).toBe(false);
  });
});

describe('ReceptionCard', () => {
  const renderCarte = (props = {}) => render(<ReceptionCard ticketId="42" statut="En attente de diagnostic" {...props} />);

  it('fiche vide : formulaire ouvert, rien n’est envoyé sans modification', async () => {
    const onEtat = vi.fn();
    renderCarte({ onEtat });
    expect(await screen.findByRole('button', { name: 'Valider la réception' })).toBeInTheDocument();
    expect(screen.getByText('Réception à compléter')).toBeInTheDocument();
    await waitFor(() => expect(onEtat).toHaveBeenLastCalledWith({ charge: 'ok', complete: false }));
    await new Promise((r) => setTimeout(r, 700));
    expect(apiMock.saveReception).not.toHaveBeenCalled();
  });

  it('réponse inattendue du serveur (liste) : fiche vide, pas de plantage', async () => {
    apiMock.getReception.mockResolvedValue([]);
    renderCarte();
    expect(await screen.findByRole('button', { name: 'Valider la réception' })).toBeInTheDocument();
  });

  it('accessoires, état et tests regroupés en un PUT complet après un court délai', async () => {
    renderCarte();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Chargeur' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Écran' })).getByRole('radio', { name: 'Rayé' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Micro' })).getByRole('radio', { name: 'Non' }));
    await waitFor(() => expect(apiMock.saveReception).toHaveBeenCalledTimes(1), { timeout: 3000 });
    const [id, corps] = apiMock.saveReception.mock.calls[0];
    expect(id).toBe('42');
    expect(corps.complete).toBe(false);
    expect(corps.items).toMatchObject({
      accessoires: ['chargeur'],
      etat: { ecran: 'raye', dos: 'ok', chassis: 'ok', notes: '' },
      tests: expect.objectContaining({ micro: false, allume: null }),
      imei_verifie: null, appareil_eteint: false, sauvegarde_conseillee: false,
    });
  });

  it('« Tests restants OK » garde les KO ; « Valider la réception » pose complete et replie la fiche', async () => {
    const onEtat = vi.fn();
    renderCarte({ onEtat });
    fireEvent.click(within(await screen.findByRole('group', { name: 'Charge' })).getByRole('radio', { name: 'Non' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tests restants OK' }));
    fireEvent.click(screen.getByRole('button', { name: 'Valider la réception' }));
    await waitFor(() => expect(apiMock.saveReception.mock.calls.some(([, c]) => c.complete === true)).toBe(true));
    const dernier = apiMock.saveReception.mock.calls.at(-1)[1];
    expect(dernier.complete).toBe(true);
    expect(dernier.items.tests.charge).toBe(false);
    expect(dernier.items.tests.allume).toBe(true);
    expect(await screen.findByText('KO : Charge')).toBeInTheDocument();
    expect(screen.getByText('Validée')).toBeInTheDocument();
    expect(screen.getByText(/Validée par Sophie/)).toBeInTheDocument();
    await waitFor(() => expect(onEtat).toHaveBeenLastCalledWith({ charge: 'ok', complete: true }));
  });

  it('IMEI invalide signalé et non envoyé ; valide envoyé ; différence avec la fiche signalée', async () => {
    renderCarte({ imeiTicket: '356938035643809' });
    const champ = await screen.findByLabelText('IMEI / n° de série vérifié');
    fireEvent.change(champ, { target: { value: IMEI_KO } });
    expect(await screen.findByText(/IMEI invalide/)).toBeInTheDocument();
    expect(champ).toHaveAttribute('aria-invalid', 'true');
    await new Promise((r) => setTimeout(r, 700));
    expect(apiMock.saveReception).not.toHaveBeenCalled();
    fireEvent.change(champ, { target: { value: IMEI_OK } });
    await waitFor(() => expect(apiMock.saveReception).toHaveBeenCalledTimes(1));
    expect(apiMock.saveReception.mock.calls[0][1].items.imei_verifie).toBe(IMEI_OK);
    expect(screen.getByText('Différent de l’IMEI de la fiche (356938035643809)')).toBeInTheDocument();
  });

  it('fiche validée : résumé replié, « Modifier » rouvre le formulaire', async () => {
    reception = {
      items: { accessoires: ['coque'], etat: { ecran: 'ok', dos: 'raye', chassis: 'ok', notes: '' }, tests: { micro: false }, imei_verifie: IMEI_OK },
      complete: true, auteur: 'Karim', date_maj: '2026-10-15T08:30:00',
    };
    renderCarte();
    expect(await screen.findByText('Coque')).toBeInTheDocument();
    expect(screen.getByText('KO : Micro')).toBeInTheDocument();
    expect(screen.getByText(/Validée par Karim/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Valider la réception' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));
    expect(screen.getByRole('checkbox', { name: 'Coque' })).toBeChecked();
  });

  it('appareil en réparation déposé il y a plusieurs jours : repliée, « Remplir » ouvre le formulaire', async () => {
    renderCarte({ statut: 'En cours de réparation', dateDepot: '2026-10-01T09:00:00' });
    expect(await screen.findByText(/Aucune fiche de réception remplie/)).toBeInTheDocument();
    expect(screen.getByText('Réception à compléter')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Valider la réception' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remplir' }));
    expect(screen.getByRole('button', { name: 'Valider la réception' })).toBeInTheDocument();
  });

  it('controleRef : flush() envoie tout de suite la modification en attente, ouvrir() déplie', async () => {
    const ref = { current: null };
    renderCarte({ controleRef: ref, statut: 'En attente de pièce' });
    await screen.findByText(/Aucune fiche de réception remplie/);
    act(() => ref.current.ouvrir());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Coque' }));
    expect(apiMock.saveReception).not.toHaveBeenCalled();
    await act(() => ref.current.flush());
    expect(apiMock.saveReception).toHaveBeenCalledTimes(1);
    expect(apiMock.saveReception.mock.calls[0][1].items.accessoires).toEqual(['coque']);
  });

  it('champ IMEI / n° de série : clavier texte (lettres d’un n° de série), majuscules', async () => {
    renderCarte();
    const champ = await screen.findByLabelText('IMEI / n° de série vérifié');
    expect(champ).not.toHaveAttribute('inputmode');
    expect(champ).toHaveAttribute('autocapitalize', 'characters');
    fireEvent.change(champ, { target: { value: 'f2lxk0q1hg7j' } });
    await waitFor(() => expect(apiMock.saveReception).toHaveBeenCalledTimes(1));
    expect(apiMock.saveReception.mock.calls[0][1].items.imei_verifie).toBe('F2LXK0Q1HG7J');
  });

  it('ticket remis sans fiche : repliée, « non remplie »', async () => {
    renderCarte({ remis: true });
    expect(await screen.findByText(/Aucune fiche de réception remplie/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remplir' })).toBeInTheDocument();
  });

  it('serveur indisponible : message et « Réessayer »', async () => {
    apiMock.getReception.mockRejectedValueOnce(new Error('Erreur 500'));
    renderCarte();
    expect(await screen.findByText('Fiche de réception indisponible.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByRole('button', { name: 'Valider la réception' })).toBeInTheDocument();
  });
});

describe('Fiche : réception', () => {
  it('badge « Réception à compléter » en haut tant qu’elle n’est pas validée', async () => {
    renderFiche();
    expect(await screen.findByRole('button', { name: 'Réception à compléter' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Réception' })).toBeInTheDocument();
  });

  it('réception validée : pas de badge en haut', async () => {
    reception = { items: { accessoires: [] }, complete: true, auteur: 'Karim', date_maj: null };
    renderFiche();
    await screen.findByRole('heading', { name: 'Réception' });
    await screen.findByText('Validée');
    expect(screen.queryByRole('button', { name: 'Réception à compléter' })).not.toBeInTheDocument();
  });

  it('ticket déjà rendu : pas de badge en haut, fiche repliée', async () => {
    courant = ticket({ statut: 'Rendu au client', paye: 1 });
    renderFiche();
    expect(await screen.findByText(/Aucune fiche de réception remplie/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Réception à compléter' })).not.toBeInTheDocument();
  });

  it('appareil en réparation depuis plusieurs jours : fiche repliée ; le bouton du haut l’ouvre', async () => {
    renderFiche();
    expect(await screen.findByText(/Aucune fiche de réception remplie/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Valider la réception' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Réception à compléter' }));
    expect(await screen.findByRole('button', { name: 'Valider la réception' })).toBeInTheDocument();
  });

  it('appareil en attente de diagnostic : formulaire ouvert', async () => {
    courant = ticket({ statut: 'En attente de diagnostic' });
    renderFiche();
    expect(await screen.findByRole('button', { name: 'Valider la réception' })).toBeInTheDocument();
  });

  it('Imprimer juste après une modification : la réception part avant le chargement du document', async () => {
    courant = ticket({ statut: 'En attente de diagnostic' });
    apiMock.getPrintHtml.mockResolvedValue('<p>Ticket</p>');
    renderFiche();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Chargeur' }));
    fireEvent.click(screen.getByRole('button', { name: 'Imprimer' }));
    await waitFor(() => expect(apiMock.getPrintHtml).toHaveBeenCalled());
    expect(apiMock.saveReception).toHaveBeenCalledTimes(1);
    expect(apiMock.saveReception.mock.calls[0][1].items.accessoires).toEqual(['chargeur']);
    expect(apiMock.saveReception.mock.invocationCallOrder[0]).toBeLessThan(apiMock.getPrintHtml.mock.invocationCallOrder[0]);
  });

  it('réception non enregistrée (réseau) : le changement de statut n’est pas bloqué', async () => {
    courant = ticket({ statut: 'En attente de diagnostic' });
    apiMock.saveReception.mockRejectedValue(new Error('Réseau'));
    apiMock.changeStatus.mockResolvedValue({ ok: true });
    renderFiche();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Chargeur' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Changer le statut' }), { target: { value: 'Pièce reçue' } });
    await waitFor(() => expect(apiMock.changeStatus).toHaveBeenCalledWith('42', 'Pièce reçue'));
    expect(apiMock.saveReception).toHaveBeenCalled();
    expect(apiMock.saveReception.mock.invocationCallOrder[0]).toBeLessThan(apiMock.changeStatus.mock.invocationCallOrder[0]);
  });

  it('IMEI vérifié copié dans la fiche appareil quand elle n’en a pas', async () => {
    courant = ticket({ statut: 'En attente de diagnostic' });
    renderFiche();
    fireEvent.change(await screen.findByLabelText('IMEI / n° de série vérifié'), { target: { value: IMEI_OK } });
    fireEvent.click(await screen.findByRole('button', { name: 'Copier dans la fiche appareil' }));
    await waitFor(() => expect(apiMock.updateTicket).toHaveBeenCalledWith('42', { imei: IMEI_OK }, { learn: false }));
  });
});

describe('Disposition des widgets', () => {
  it('un widget nouveau (réception) se place après son voisin par défaut, la disposition enregistrée est gardée', () => {
    expect(completerLayout(['device', 'client', 'dates', 'messages', 'notes'], ['status', 'reparation', 'queue', 'fidelite']))
      .toEqual({ left: ['device', 'reception', 'client', 'dates', 'messages', 'notes'], right: ['status', 'reparation', 'queue', 'fidelite'] });
    expect(completerLayout(['client', 'dates'], ['device', 'reparation', 'status', 'queue', 'fidelite', 'messages', 'notes']).right)
      .toEqual(['device', 'reception', 'reparation', 'status', 'queue', 'fidelite', 'messages', 'notes']);
    expect(completerLayout([], []).left[0]).toBe('client');
  });
});
