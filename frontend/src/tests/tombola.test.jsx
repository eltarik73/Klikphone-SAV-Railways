/**
 * Tombola des clients : formats (lib/tombola), case « Je participe » des formulaires de dépôt
 * (jamais pré-cochée, gratuite), page du gérant (créer, inscrire au comptoir, tirer, gagnants,
 * remplaçant) et affiche (contenu, dessin, impression). API simulée.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { auth, apiMock } = vi.hoisted(() => ({
  auth: { user: { target: 'accueil', utilisateur: 'Sophie' } },
  apiMock: {
    getPublicConfig: vi.fn(), getConfidentialite: vi.fn(), getCategories: vi.fn(), getPannes: vi.fn(),
    createDepotDistance: vi.fn(),
    getTombolaEnCours: vi.fn(), getTombolas: vi.fn(), getTombola: vi.fn(), createTombola: vi.fn(),
    updateTombola: vi.fn(), tirerTombola: vi.fn(), annulerTombola: vi.fn(), remplacerGagnant: vi.fn(),
    inscrireTombola: vi.fn(), retirerParticipation: vi.fn(), suivreGagnant: vi.fn(),
    background: (fn) => fn(),
  },
}));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));
vi.mock('../hooks/useCatalog', () => ({
  useCatalog: () => ({ marques: [], modelesDe: () => [], loading: false }),
}));
// Police et logo : jsdom ne charge pas d'image ; le dessin lui-même est testé avec un contexte simulé
vi.mock('../lib/afficheTombola', async (original) => ({
  ...(await original()),
  preparerRessources: () => Promise.resolve({ k: null, mots: {} }),
}));

import { ToastProvider } from '../components/Toast';
import { SettingsProvider } from '../hooks/useSettings';
import { _oublierConfigPublique } from '../pages/ConfidentialitePage';
import CaseTombola from '../components/CaseTombola';
import DeposerPage from '../pages/DeposerPage';
import TombolaPage from '../pages/TombolaPage';
import TombolaAffichePage from '../pages/TombolaAffichePage';
import {
  _oublierTombola, dansCombien, dateCourte, dateTirage, heureFr, jourTirage, pourSaisie, rangLot, resumeLots,
} from '../lib/tombola';
import { FORMATS, contenuAffiche, dessinerAffiche, nomFichier, texteAlternatif } from '../lib/afficheTombola';

const TIRAGE = '2026-12-20T17:00:00+00:00';   // 18 h à Paris
const PUBLIQUE = {
  id: 7, titre: 'Tombola de Noël', lots: ['iPhone 13 reconditionné', 'Écouteurs sans fil'], tirage_le: TIRAGE,
  reglement: '1. Organisateur. KLIKPHONE.\n\n2. Participation gratuite. Participer ne coûte rien et n’exige aucun achat.',
};
const OUVERTE = {
  ...PUBLIQUE, statut: 'ouverte', reglement_personnalise: false, participants: 2, participants_au_tirage: null,
  tiree_le: null, tiree_par: null, gagnants: [],
};
const LISTE = [
  { id: 31, client_id: 1, nom: 'Durand', prenom: 'Léa', telephone: '0755443322', source: 'borne', inscrit_le: '2026-11-20T10:00:00+00:00', inscrit_par: null },
  { id: 32, client_id: 2, nom: 'Martin', prenom: 'Sam', telephone: '0611223344', source: 'comptoir', inscrit_le: '2026-11-21T10:00:00+00:00', inscrit_par: 'Marina' },
];
const TIREE = {
  ...OUVERTE, statut: 'tiree', participants: 40, participants_au_tirage: 40,
  tiree_le: '2026-12-20T17:00:30+00:00', tiree_par: 'Tirage automatique',
  gagnants: [
    { id: 31, rang: 1, lot: 'iPhone 13 reconditionné', nom: 'Durand', prenom: 'Léa', telephone: '0755443322', prevenu_le: null, lot_remis_le: null, remplace_le: null },
    { id: 40, rang: 2, lot: 'Écouteurs sans fil', nom: 'Petit', prenom: 'Zoé', telephone: '0622334455', prevenu_le: null, lot_remis_le: null, remplace_le: '2026-12-28T10:00:00+00:00' },
    { id: 41, rang: 2, lot: 'Écouteurs sans fil', nom: 'Martin', prenom: 'Sam', telephone: '0611223344', prevenu_le: '2026-12-28T11:00:00+00:00', lot_remis_le: null, remplace_le: null },
  ],
};

function resetApi() {
  _oublierConfigPublique();
  _oublierTombola();
  localStorage.clear();
  Object.values(apiMock).forEach((fn) => fn.mockReset?.());
  apiMock.getPublicConfig.mockResolvedValue({
    BOUTIQUE_NOM: 'KLIKPHONE', BOUTIQUE_ADRESSE: '79 Place Saint-Léger, 73000 Chambéry', BOUTIQUE_TEL: '04 79 60 89 22',
  });
  apiMock.getConfidentialite.mockResolvedValue({ titre: 'Politique de confidentialité', sections: [] });
  apiMock.getCategories.mockResolvedValue(['Smartphone']);
  apiMock.getPannes.mockResolvedValue(['Écran cassé']);
  apiMock.getTombolaEnCours.mockResolvedValue({ tombola: PUBLIQUE });
  apiMock.getTombolas.mockResolvedValue({ tombolas: [OUVERTE] });
  apiMock.getTombola.mockResolvedValue({ ...OUVERTE, liste: LISTE });
}

beforeEach(resetApi);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const wrap = (ui, entries = ['/']) => (
  <MemoryRouter initialEntries={entries}>
    <SettingsProvider>
      <ToastProvider>{ui}</ToastProvider>
    </SettingsProvider>
  </MemoryRouter>
);

// ─── Formats ─────────────────────────────────────────────────────
describe('lib/tombola : formats français à l’heure de Paris', () => {
  it('heure, date longue, date courte, « 1er »', () => {
    expect(heureFr(TIRAGE)).toBe('18 h');
    expect(heureFr('2026-12-20T17:30:00+00:00')).toBe('18 h 30');
    expect(dateTirage(TIRAGE)).toBe('dimanche 20 décembre 2026 à 18 h');
    expect(jourTirage(TIRAGE)).toBe('dimanche 20 décembre');
    expect(dateCourte(TIRAGE)).toBe('20 déc. 2026 à 18 h');
    expect(dateTirage('2027-01-01T09:30:00+00:00')).toBe('vendredi 1er janvier 2027 à 10 h 30');
    expect(dateTirage(null)).toBe('');
    expect(dateTirage('pas une date')).toBe('');
  });

  it('champs du formulaire à l’heure de Paris, été comme hiver', () => {
    expect(pourSaisie(TIRAGE)).toEqual({ jour: '2026-12-20', heure: '18:00' });
    expect(pourSaisie('2026-07-04T16:00:00+00:00')).toEqual({ jour: '2026-07-04', heure: '18:00' });
    expect(pourSaisie(null)).toEqual({ jour: '', heure: '' });
  });

  it('temps restant avant le tirage', () => {
    const tirage = new Date(TIRAGE);
    const avant = (ms) => new Date(tirage.getTime() - ms);
    expect(dansCombien(TIRAGE, avant(12 * 86400000))).toBe('dans 12 jours');
    expect(dansCombien(TIRAGE, avant(20 * 3600000))).toBe('demain');
    expect(dansCombien(TIRAGE, avant(3 * 3600000 + 60000))).toBe("aujourd'hui, dans 3 h");
    expect(dansCombien(TIRAGE, avant(10 * 60000))).toBe('dans quelques minutes');
    expect(dansCombien(TIRAGE, new Date(tirage.getTime() + 1000))).toBe('');
  });

  it('lots résumés et rang d’un lot', () => {
    expect(resumeLots(['Une coque'])).toBe('Une coque');
    expect(resumeLots(['iPhone 13', 'Écouteurs'])).toBe('iPhone 13 et 1 autre lot');
    expect(resumeLots(['iPhone 13', 'Écouteurs', 'Coque'])).toBe('iPhone 13 et 2 autres lots');
    expect(resumeLots([])).toBe('');
    expect(rangLot(1)).toBe('1er lot');
    expect(rangLot(3)).toBe('3e lot');
  });
});

// ─── Case des formulaires ────────────────────────────────────────
describe('CaseTombola : la case « Je participe »', () => {
  it('rien sans tombola ouverte', async () => {
    apiMock.getTombolaEnCours.mockResolvedValue({ tombola: null });
    const { container } = render(<CaseTombola id="t" checked={false} onChange={() => {}} />);
    await waitFor(() => expect(apiMock.getTombolaEnCours).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('rien non plus si le serveur ne répond pas (le dépôt continue)', async () => {
    apiMock.getTombolaEnCours.mockRejectedValue(new Error('réseau'));
    const { container } = render(<CaseTombola id="t" checked={false} onChange={() => {}} />);
    await waitFor(() => expect(apiMock.getTombolaEnCours).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('jamais pré-cochée, dit « gratuit, sans obligation d’achat », la date et ouvre le règlement', async () => {
    const onChange = vi.fn();
    render(<CaseTombola id="t" checked={false} onChange={onChange} />);
    const caseACocher = await screen.findByRole('checkbox', { name: /Je participe à la tombola/ });
    expect(caseACocher).not.toBeChecked();
    expect(caseACocher).toHaveAccessibleName(/iPhone 13 reconditionné et 1 autre lot à gagner/);
    expect(caseACocher).toHaveAccessibleDescription(/Gratuit, sans obligation d'achat et sans effet sur votre réparation/);
    expect(caseACocher).toHaveAccessibleDescription(/Tirage au sort le dimanche 20 décembre 2026 à 18 h/);
    fireEvent.click(caseACocher);
    expect(onChange).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole('button', { name: 'Règlement de la tombola' }));
    const dialogue = screen.getByRole('dialog', { name: 'Règlement de la tombola' });
    expect(dialogue).toHaveTextContent('Participer ne coûte rien et n’exige aucun achat');
    fireEvent.click(within(dialogue).getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('une seule lecture pour plusieurs cases affichées à la suite', async () => {
    const { unmount } = render(<CaseTombola id="a" checked={false} onChange={() => {}} />);
    await screen.findByRole('checkbox');
    unmount();
    render(<CaseTombola id="b" checked onChange={() => {}} />);
    expect(await screen.findByRole('checkbox')).toBeChecked();
    expect(apiMock.getTombolaEnCours).toHaveBeenCalledTimes(1);
  });
});

describe('Dépôt à distance : la case tombola part avec la demande', () => {
  const remplir = async () => {
    fireEvent.change(screen.getByLabelText('Nom *'), { target: { value: 'Martin' } });
    fireEvent.change(screen.getByLabelText('Votre numéro de téléphone (obligatoire)'), { target: { value: '06 12 34 56 79' } });
  };
  const terminer = async () => {
    fireEvent.click(screen.getByRole('button', { name: /Suivant/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Smartphone' }));
    fireEvent.change(screen.getByLabelText('Marque *'), { target: { value: 'Autre' } });
    fireEvent.change(screen.getByLabelText(/Préciser marque/), { target: { value: 'Fairphone 5' } });
    fireEvent.click(screen.getByRole('button', { name: /Suivant/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Écran cassé' }));
    fireEvent.click(screen.getByRole('button', { name: /Envoyer ma demande/ }));
  };

  it('cochée : tombola envoyé, participation confirmée à l’écran de fin', async () => {
    apiMock.createDepotDistance.mockResolvedValue({ ticket_code: 'KP-000071', tombola_inscrit: true });
    render(wrap(<DeposerPage />, ['/deposer']));
    await remplir();
    const caseACocher = await screen.findByRole('checkbox', { name: /Je participe à la tombola/ });
    expect(caseACocher).not.toBeChecked();
    fireEvent.click(caseACocher);
    await terminer();
    await screen.findByText('KP-000071');
    expect(apiMock.createDepotDistance).toHaveBeenCalledWith(expect.objectContaining({ tombola: true }));
    expect(screen.getByText('Votre participation à la tombola est enregistrée.')).toBeInTheDocument();
  });

  it('non cochée : rien n’est envoyé, rien n’est annoncé', async () => {
    apiMock.createDepotDistance.mockResolvedValue({ ticket_code: 'KP-000072' });
    render(wrap(<DeposerPage />, ['/deposer']));
    await remplir();
    await screen.findByRole('checkbox', { name: /Je participe à la tombola/ });
    await terminer();
    await screen.findByText('KP-000072');
    expect(apiMock.createDepotDistance.mock.calls[0][0]).not.toHaveProperty('tombola');
    expect(screen.queryByText(/participation à la tombola est enregistrée/)).toBeNull();
  });
});

// ─── Page du gérant ──────────────────────────────────────────────
describe('TombolaPage', () => {
  it('aucune tombola : une seule action primaire, « Créer une tombola », formulaire validé puis envoyé', async () => {
    apiMock.getTombolas.mockResolvedValue({ tombolas: [] });
    apiMock.createTombola.mockResolvedValue({ ...OUVERTE, id: 8 });
    render(wrap(<TombolaPage />, ['/accueil/tombola']));
    expect(await screen.findByRole('heading', { name: 'Aucune tombola pour l’instant' })).toBeInTheDocument();
    expect(document.querySelectorAll('.btn-primary')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Créer une tombola' }));
    const fenetre = screen.getByRole('dialog', { name: 'Créer une tombola' });
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Ouvrir la tombola' }));
    expect(within(fenetre).getAllByRole('alert').map((a) => a.textContent)).toEqual([
      'Donnez un titre à la tombola, par exemple « Tombola de fin d’année »',
      'Indiquez au moins un lot à gagner',
      'Choisissez le jour et l’heure du tirage',
    ]);
    expect(apiMock.createTombola).not.toHaveBeenCalled();

    fireEvent.change(within(fenetre).getByLabelText('Titre'), { target: { value: '  Tombola de Noël ' } });
    fireEvent.change(within(fenetre).getByLabelText('Lots à gagner'), { target: { value: 'iPhone 13 reconditionné\n\n Écouteurs sans fil ' } });
    expect(within(fenetre).getByText(/2 gagnants/)).toBeInTheDocument();
    fireEvent.change(within(fenetre).getByLabelText('Jour du tirage'), { target: { value: '2020-01-01' } });
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Ouvrir la tombola' }));
    expect(within(fenetre).getByRole('alert')).toHaveTextContent('La date du tirage doit être dans le futur');
    fireEvent.change(within(fenetre).getByLabelText('Jour du tirage'), { target: { value: '2099-12-20' } });
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Ouvrir la tombola' }));
    await waitFor(() => expect(apiMock.createTombola).toHaveBeenCalledWith({
      titre: 'Tombola de Noël', lots: ['iPhone 13 reconditionné', 'Écouteurs sans fil'],
      tirage_le: '2099-12-20T18:00', reglement: '',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('tombola ouverte : date, participants, lots, liste ; inscription au comptoir sans achat', async () => {
    apiMock.inscrireTombola.mockResolvedValue({ ok: true, deja_inscrit: false });
    render(wrap(<TombolaPage />, ['/accueil/tombola']));
    const carte = (await screen.findByRole('heading', { name: 'Tombola de Noël' })).closest('section');
    expect(carte).toHaveTextContent('Inscriptions ouvertes');
    expect(carte).toHaveTextContent('dimanche 20 décembre 2026 à 18 h');
    expect(carte).toHaveTextContent('iPhone 13 reconditionné');
    expect(within(carte).getByRole('link', { name: 'Affiche' })).toHaveAttribute('href', '/accueil/tombola/affiche');
    const lignes = await screen.findAllByRole('row');
    expect(lignes).toHaveLength(3);
    expect(lignes[1]).toHaveTextContent('Léa Durand');
    expect(lignes[1]).toHaveTextContent('07 55 44 33 22');
    expect(lignes[1]).toHaveTextContent('Borne');
    expect(lignes[2]).toHaveTextContent('Comptoir · Marina');
    expect(document.querySelectorAll('.btn-primary')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Inscrire un participant' }));
    const fenetre = screen.getByRole('dialog', { name: 'Inscrire un participant' });
    expect(fenetre).toHaveTextContent('aucun dépôt ni achat n’est demandé');
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Inscrire' }));
    expect(within(fenetre).getAllByRole('alert')).toHaveLength(2);
    fireEvent.change(within(fenetre).getByLabelText('Nom'), { target: { value: 'Petit' } });
    fireEvent.change(within(fenetre).getByLabelText('Téléphone'), { target: { value: '06 00 00 00 00' } });
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Inscrire' }));
    expect(apiMock.inscrireTombola).not.toHaveBeenCalled();   // numéro de remplissage refusé
    fireEvent.change(within(fenetre).getByLabelText('Téléphone'), { target: { value: '06 22 33 44 55' } });
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Inscrire' }));
    await waitFor(() => expect(apiMock.inscrireTombola).toHaveBeenCalledWith(7, { nom: 'Petit', prenom: '', telephone: '06 22 33 44 55' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(apiMock.getTombolas).toHaveBeenCalledTimes(2);
  });

  it('tirer maintenant et annuler passent par une confirmation qui dit la conséquence', async () => {
    apiMock.tirerTombola.mockResolvedValue(TIREE);
    render(wrap(<TombolaPage />, ['/accueil/tombola']));
    fireEvent.click(await screen.findByRole('button', { name: 'Tirer au sort maintenant' }));
    const confirmation = screen.getByRole('dialog', { name: 'Tirer au sort « Tombola de Noël » maintenant ?' });
    expect(confirmation).toHaveTextContent('2 gagnants parmi 2 participants');
    expect(confirmation).toHaveTextContent('ne se refait pas');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Tirer au sort' }));
    await waitFor(() => expect(apiMock.tirerTombola).toHaveBeenCalledWith(7));

    fireEvent.click(await screen.findByRole('button', { name: 'Annuler la tombola' }));
    const annulation = screen.getByRole('dialog', { name: 'Annuler la tombola « Tombola de Noël » ?' });
    expect(annulation).toHaveTextContent('les 2 participations sont effacées');
    fireEvent.click(within(annulation).getByRole('button', { name: 'Garder la tombola' }));
    expect(apiMock.annulerTombola).not.toHaveBeenCalled();
  });

  it('retirer un participant avant le tirage', async () => {
    apiMock.retirerParticipation.mockResolvedValue({ ok: true });
    render(wrap(<TombolaPage />, ['/accueil/tombola']));
    fireEvent.click(await screen.findByRole('button', { name: 'Retirer Léa Durand de la tombola' }));
    const confirmation = screen.getByRole('dialog', { name: 'Retirer Léa Durand de la tombola ?' });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Retirer de la tombola' }));
    await waitFor(() => expect(apiMock.retirerParticipation).toHaveBeenCalledWith(31));
  });

  it('après le tirage : gagnants et leur lot, prévenir, remettre le lot, tirer un remplaçant', async () => {
    apiMock.getTombolas.mockResolvedValue({ tombolas: [TIREE] });
    apiMock.suivreGagnant.mockResolvedValue(TIREE);
    apiMock.remplacerGagnant.mockResolvedValue(TIREE);
    render(wrap(<TombolaPage />, ['/tech/tombola']));
    const carte = (await screen.findByRole('heading', { name: 'Tombola de Noël' })).closest('section');
    expect(carte).toHaveTextContent('Tirage effectué');
    expect(carte).toHaveTextContent('Par Tirage automatique');
    expect(carte).toHaveTextContent('2 gagnants, 1 à prévenir');
    const [lea, zoe, sam] = within(within(carte).getByRole('list', { name: 'Gagnants' })).getAllByRole('listitem');
    expect(lea).toHaveTextContent('1er lot — iPhone 13 reconditionné');
    expect(lea).toHaveTextContent('Léa Durand');
    expect(lea).toHaveTextContent('07 55 44 33 22 · À prévenir');
    expect(zoe).toHaveTextContent('2e lot — Zoé Petit, remplacé le 28 déc. 2026');
    expect(sam).toHaveTextContent('Prévenu le 28 déc. 2026');
    // Contacts : téléphone, WhatsApp et SMS avec le message du lot gagné
    expect(within(lea).getByRole('link', { name: 'Appeler Léa Durand' })).toHaveAttribute('href', 'tel:0755443322');
    const whatsapp = within(lea).getByRole('link', { name: /Écrire à Léa Durand sur WhatsApp/ });
    expect(decodeURIComponent(whatsapp.getAttribute('href'))).toContain('Bonjour Léa, vous avez été tiré au sort à la tombola KLIKPHONE : vous gagnez « iPhone 13 reconditionné »');
    expect(whatsapp).toHaveAttribute('rel', 'noopener noreferrer');
    // Plus d'inscription ni d'affiche : l'action primaire devient « Créer une tombola »
    expect(screen.getByRole('button', { name: 'Créer une tombola' })).toHaveClass('btn-primary');
    expect(screen.queryByRole('button', { name: 'Inscrire un participant' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Affiche' })).toBeNull();

    fireEvent.click(within(lea).getByRole('button', { name: 'Noter « prévenu »' }));
    await waitFor(() => expect(apiMock.suivreGagnant).toHaveBeenCalledWith(31, { prevenu: true }));
    await waitFor(() => expect(within(sam).getByRole('button', { name: 'Lot remis' })).toBeEnabled());
    fireEvent.click(within(sam).getByRole('button', { name: 'Lot remis' }));
    await waitFor(() => expect(apiMock.suivreGagnant).toHaveBeenCalledWith(41, { lot_remis: true }));
    await waitFor(() => expect(within(sam).getByRole('button', { name: 'Tirer un remplaçant' })).toBeEnabled());
    fireEvent.click(within(sam).getByRole('button', { name: 'Tirer un remplaçant' }));
    const confirmation = screen.getByRole('dialog', { name: 'Tirer un remplaçant pour Sam Martin ?' });
    expect(confirmation).toHaveTextContent('Le 2e lot (Écouteurs sans fil) est attribué à un autre inscrit');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Tirer un remplaçant' }));
    await waitFor(() => expect(apiMock.remplacerGagnant).toHaveBeenCalledWith(41));
  });

  it('lot remis : seule « Annuler la remise » reste sur ce gagnant ; tombolas précédentes listées', async () => {
    const remise = { ...TIREE, gagnants: [{ ...TIREE.gagnants[0], prevenu_le: TIREE.tiree_le, lot_remis_le: '2026-12-22T10:00:00+00:00' }] };
    const ancienne = { ...TIREE, id: 3, titre: 'Tombola d’été', gagnants: [TIREE.gagnants[2]] };
    const annulee = { ...OUVERTE, id: 2, titre: 'Essai', statut: 'annulee' };
    apiMock.getTombolas.mockResolvedValue({ tombolas: [remise, ancienne, annulee] });
    render(wrap(<TombolaPage />, ['/accueil/tombola']));
    const carte = (await screen.findByRole('heading', { name: 'Tombola de Noël' })).closest('section');
    const [lea] = within(within(carte).getByRole('list', { name: 'Gagnants' })).getAllByRole('listitem');
    expect(lea).toHaveTextContent('Lot remis le 22 déc. 2026');
    expect(within(lea).queryByRole('link')).toBeNull();
    apiMock.suivreGagnant.mockResolvedValue(remise);
    fireEvent.click(within(lea).getByRole('button', { name: 'Annuler la remise' }));
    await waitFor(() => expect(apiMock.suivreGagnant).toHaveBeenCalledWith(31, { lot_remis: false }));
    const precedentes = screen.getByRole('heading', { name: 'Tombolas précédentes' }).closest('section');
    const lignes = within(precedentes).getAllByRole('row');
    expect(lignes[1]).toHaveTextContent('Tombola d’été');
    expect(lignes[1]).toHaveTextContent('Sam Martin');
    expect(lignes[2]).toHaveTextContent('Annulée');
  });

  it('erreur de chargement : message et « Réessayer »', async () => {
    apiMock.getTombolas.mockRejectedValueOnce(new Error('Serveur indisponible'));
    render(wrap(<TombolaPage />, ['/accueil/tombola']));
    expect(await screen.findByRole('alert')).toHaveTextContent('Serveur indisponible');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByRole('heading', { name: 'Tombola de Noël' })).toBeInTheDocument();
  });

  it('les règles affichées disent la gratuité et l’égalité des chances', async () => {
    render(wrap(<TombolaPage />, ['/accueil/tombola']));
    const regles = (await screen.findByRole('heading', { name: 'Les règles que le logiciel fait respecter' })).closest('section');
    expect(regles).toHaveTextContent('ni ticket, ni mise, aucun achat demandé');
    expect(regles).toHaveTextContent('tout le monde a la même chance');
  });
});

// ─── Affiche ─────────────────────────────────────────────────────
function contexteSimule() {
  const textes = [];
  const ctx = {
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textBaseline: '', letterSpacing: '0px',
    measureText(t) { return { width: String(t).length * (parseInt(/(\d+)px/.exec(this.font)?.[1] || '10', 10)) * 0.5 }; },
    fillText(t, x, y) { textes.push({ t, x, y, font: this.font }); },
    drawImage: vi.fn(),
  };
  ['fillRect', 'beginPath', 'moveTo', 'lineTo', 'arcTo', 'arc', 'closePath', 'fill', 'stroke', 'save', 'restore', 'setLineDash']
    .forEach((m) => { ctx[m] = vi.fn(); });
  return { ctx, textes };
}

describe('Affiche de la tombola', () => {
  const boutique = { nom: 'KLIKPHONE', adresse: '79 Place Saint-Léger, 73000 Chambéry', tel: '04 79 60 89 22' };

  it('contenu : lot principal, autres lots, date, les trois garanties, la boutique', () => {
    const c = contenuAffiche({ ...PUBLIQUE, lots: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] }, boutique);
    expect(c.titre).toBe('Tombola de Noël');
    expect(c.surtitre).toBe('Tombola gratuite');
    expect(c.lotPrincipal).toBe('A');
    expect(c.autresLots).toEqual(['2e lot — B', '3e lot — C', '4e lot — D', '5e lot — E', 'et 2 autres lots']);
    expect(c.jour).toBe('dimanche 20 décembre');
    expect(c.heure).toBe('à 18 h');
    expect(c.faits).toEqual(['Participation gratuite', 'Sans obligation d’achat', 'Une participation par personne']);
    expect(c.pied).toEqual(boutique);
    expect(c.mention).toBe('Lots offerts par KLIKPHONE. Règlement disponible en boutique.');
    expect(contenuAffiche(PUBLIQUE).pied.nom).toBe('Klikphone');
    expect(texteAlternatif(contenuAffiche(PUBLIQUE, boutique)))
      .toBe('Affiche : Tombola de Noël, tombola gratuite. À gagner : iPhone 13 reconditionné, 2e lot — Écouteurs sans fil. '
        + 'Tirage au sort dimanche 20 décembre à 18 h. Participation gratuite, Sans obligation d’achat, Une participation par personne. '
        + 'KLIKPHONE, 79 Place Saint-Léger, 73000 Chambéry, 04 79 60 89 22');
    expect(nomFichier('instagram', 'sombre')).toBe('affiche-tombola-instagram-sombre.png');
  });

  it.each(Object.keys(FORMATS))('dessin %s : tout tient dans la page, garanties toujours présentes', (format) => {
    const { ctx, textes } = contexteSimule();
    const canvas = { getContext: () => ctx };
    const contenu = contenuAffiche({
      ...PUBLIQUE, titre: 'Grande tombola de fin d’année des clients',
      lots: ['iPhone 13 reconditionné 128 Go', 'Écouteurs sans fil', 'Bon d’achat de 30 €', 'Coque et verre trempé', 'Chargeur rapide'],
    }, boutique);
    expect(dessinerAffiche(canvas, { format, theme: 'sombre', contenu, ressources: { k: null, mots: {} } })).toBe(true);
    const f = FORMATS[format];
    expect(canvas.width).toBe(f.largeur);
    expect(canvas.height).toBe(f.hauteur);
    const ecrits = textes.map((x) => x.t).join(' | ');
    expect(ecrits).toContain('TOMBOLA GRATUITE');
    expect(ecrits).toContain('Participation gratuite');
    expect(ecrits).toContain('Sans obligation d’achat');
    expect(ecrits).toContain('dimanche 20 décembre');
    expect(ecrits).toContain('KLIKPHONE');
    textes.forEach(({ x, y }) => {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(f.hauteur);
    });
    // Le pied (boutique) est sous tout le reste : aucun chevauchement
    const yNom = textes.find((x) => x.t === 'KLIKPHONE').y;
    const yGaranties = Math.max(...textes.filter((x) => /gratuite|obligation|par personne/.test(x.t)).map((x) => x.y));
    expect(yGaranties).toBeLessThan(yNom);
  });

  it('sans canvas (vieux navigateur, tests) : false, sans erreur', () => {
    expect(dessinerAffiche({ getContext: () => null }, { contenu: contenuAffiche(PUBLIQUE) })).toBe(false);
    expect(dessinerAffiche({}, { contenu: contenuAffiche(PUBLIQUE) })).toBe(false);
  });

  it('page : aperçu décrit, « Imprimer » en A4, « Télécharger l’image » pour Instagram', async () => {
    const { ctx } = contexteSimule();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
    const imprimer = vi.fn();
    window.print = imprimer;
    render(wrap(<TombolaAffichePage />, ['/accueil/tombola/affiche']));
    const image = await screen.findByRole('img', { name: /Affiche : Tombola de Noël, tombola gratuite/ });
    expect(image).toHaveAttribute('src', 'data:image/png;base64,AAAA');
    expect(image.closest('.affiche-impression')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Tombola' })).toHaveAttribute('href', '/accueil/tombola');
    expect(document.querySelectorAll('.btn-primary')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Imprimer' }));
    expect(imprimer).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Télécharger l’image' })).toHaveAttribute('download', 'affiche-tombola-a4-clair.png');

    fireEvent.click(screen.getByRole('button', { name: 'Instagram 4:5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fond sombre' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Télécharger l’image' }))
      .toHaveAttribute('download', 'affiche-tombola-instagram-sombre.png'));
    expect(screen.getByRole('link', { name: 'Télécharger l’image' })).toHaveClass('btn-primary');
    expect(screen.queryByRole('button', { name: 'Imprimer' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Instagram 4:5' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('page : pas de tombola ouverte, pas d’affiche', async () => {
    apiMock.getTombolaEnCours.mockResolvedValue({ tombola: null });
    render(wrap(<TombolaAffichePage />, ['/accueil/tombola/affiche']));
    expect(await screen.findByRole('heading', { name: 'Aucune tombola ouverte' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Retour à la tombola' })).toHaveAttribute('href', '/accueil/tombola');
  });

  it('page : appareil sans canvas, message clair', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(wrap(<TombolaAffichePage />, ['/accueil/tombola/affiche']));
    expect(await screen.findByText(/L’aperçu ne peut pas être dessiné sur cet appareil/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Imprimer' })).toBeNull();
  });
});
