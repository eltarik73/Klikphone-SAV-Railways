/**
 * Délai de réparation obligatoire à la création par le personnel et visible partout.
 * - calculerHeurePromise : puces 1h…3h30 en heures d'ouverture (lun.–sam. 10:00–19:00), 24h / 48h en jours ouvrés ;
 * - infoDelai / delaiTicket (lib/delai.js) : « 15:30 · dans 1 h 20 », « En retard de 25 min », « Délai à fixer »… ;
 * - /client?staff=1 (bouton « Nouveau ticket » du tableau de bord) : « Suivant » refusé sans délai, ticket
 *   créé avec date_recuperation, retour au tableau de bord ; /client public : aucun délai demandé ;
 * - pastilles au tableau de bord (accueil et tech), file atelier, fiche (carte Dates) et panneau de scan ;
 * - borne /client : rechargement si une nouvelle version a été déployée (lib/miseAJour.js).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const { auth, apiMock } = vi.hoisted(() => ({
  auth: { user: { target: 'accueil', utilisateur: 'Sophie' } },
  apiMock: {
    getPublicConfig: vi.fn(), getConfidentialite: vi.fn(), getCategories: vi.fn(), getPannes: vi.fn(),
    createOrGetClient: vi.fn(), createTicket: vi.fn(), createPartAuto: vi.fn(), learnTerm: vi.fn(),
    updateTicket: vi.fn(), getClient: vi.fn(), changeStatus: vi.fn(),
    getDashboard: vi.fn(), getActiveTeam: vi.fn(), getInteractions: vi.fn(), getClients: vi.fn(), getParts: vi.fn(),
    getMessageTemplates: vi.fn(), getCached: vi.fn(), getSmsEtat: vi.fn(), getRepairQueue: vi.fn(),
    getTicket: vi.fn(), getNotes: vi.fn(), getEtagereConfig: vi.fn(), resolveCode: vi.fn(),
    getClientTickets: vi.fn(),
    background: (fn) => fn(),
  },
}));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));
vi.mock('../hooks/useCatalog', () => ({
  useCatalog: () => ({ marques: [], modelesDe: () => [], loading: false }),
}));

import { ToastProvider } from '../components/Toast';
import { SettingsProvider } from '../hooks/useSettings';
import { clearCache } from '../hooks/useApi';
import { _oublierConfigPublique } from '../pages/ConfidentialitePage';
import ClientFormPage from '../pages/ClientFormPage';
import ClientsPage from '../pages/ClientsPage';
import DashboardPage from '../pages/DashboardPage';
import RepairQueue from '../components/RepairQueue';
import QuickScanPanel from '../components/QuickScanPanel';
import { openQuickScan, takePendingScan } from '../components/ScanListener';
import DelaiReparation, {
  calculerHeurePromise, cleDeValeur, PastilleDelai, HEURE_OUVERTURE, HEURE_FERMETURE, JOURS_FERMES,
  TOLERANCE_FERMETURE_MIN,
} from '../components/DelaiReparation';
import {
  infoDelai, delaiTicket, dateDelai, dureeCourte, phrasePret, libelleEcheance, instantDelai,
} from '../lib/delai';

// Lundi 19 octobre 2026, heure locale
const LUNDI = (h, m = 0) => new Date(2026, 9, 19, h, m, 0, 0);
const MAINTENANT = LUNDI(14, 10);

function resetApi() {
  clearCache();
  _oublierConfigPublique();
  sessionStorage.clear();
  localStorage.clear();
  auth.user = { target: 'accueil', utilisateur: 'Sophie' };
  Object.values(apiMock).forEach((fn) => fn.mockReset?.());
  apiMock.getPublicConfig.mockResolvedValue({ BOUTIQUE_NOM: 'Klikphone Chambéry', PURGE_CODES_JOURS: '15' });
  apiMock.getConfidentialite.mockResolvedValue({ titre: 'Politique de confidentialité', sections: [] });
  apiMock.getCategories.mockResolvedValue(['Smartphone', 'Commande']);
  apiMock.getPannes.mockResolvedValue(['Écran cassé', 'Batterie']);
  apiMock.createOrGetClient.mockResolvedValue({ id: 7 });
  apiMock.createTicket.mockResolvedValue({ id: 70, ticket_code: 'KP-000070' });
  apiMock.updateTicket.mockImplementation((id, data) => Promise.resolve({ ok: true, ticket: { id, ...data } }));
  apiMock.learnTerm.mockResolvedValue({});
  apiMock.getSmsEtat.mockResolvedValue({ disponible: false });
  apiMock.getActiveTeam.mockResolvedValue([]);
  apiMock.getInteractions.mockResolvedValue({});
  apiMock.getClients.mockResolvedValue([]);
  apiMock.getParts.mockResolvedValue([]);
  apiMock.getCached.mockResolvedValue([]);
  apiMock.getNotes.mockResolvedValue([]);
  apiMock.getEtagereConfig.mockResolvedValue({});
}

beforeEach(() => {
  resetApi();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MAINTENANT);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.querySelectorAll('script[data-test-bundle]').forEach((s) => s.remove());
  delete window.location.reload;
});

function Ou() {
  const loc = useLocation();
  return <div data-testid="ou">{loc.pathname}{loc.search}</div>;
}

const wrap = (ui, entries) => (
  <MemoryRouter initialEntries={entries}>
    <SettingsProvider>
      <ToastProvider>
        <Routes>
          <Route path="/client" element={ui} />
          <Route path="/accueil" element={<><h1>Tableau de bord accueil</h1><Ou /></>} />
          <Route path="/accueil/ticket/:id" element={<Ou />} />
          <Route path="/tech" element={<><h1>Espace tech</h1><Ou /></>} />
          <Route path="*" element={<Ou />} />
        </Routes>
      </ToastProvider>
    </SettingsProvider>
  </MemoryRouter>
);

const suivant = () => fireEvent.click(screen.getByRole('button', { name: /Suivant/ }));

// ─── Heure promise ───────────────────────────────────────────────
describe('calculerHeurePromise : heures d’ouverture et jours ouvrés', () => {
  const calc = (d, cle) => calculerHeurePromise(d, cle);

  it('horaires de la boutique en tête du composant : lundi–samedi 10:00–19:00, fermé le dimanche', () => {
    expect([HEURE_OUVERTURE, HEURE_FERMETURE, JOURS_FERMES]).toEqual([10, 19, [0]]);
  });

  it('10:00 + 1h → 11:00 aujourd’hui ; arrondi aux 5 minutes supérieures', () => {
    expect(calc(LUNDI(10), '1h')).toMatchObject({ valeur: '2026-10-19T11:00', libelle: '11:00 aujourd\'hui' });
    expect(calc(LUNDI(10, 2), '1h').valeur).toBe('2026-10-19T11:05');
    expect(calc(new Date(2026, 9, 19, 10, 0, 30), '1h').valeur).toBe('2026-10-19T11:05');
    expect(calc(LUNDI(14, 10), '1h30').valeur).toBe('2026-10-19T15:40');
    expect(calc(LUNDI(14, 10), '3h30').valeur).toBe('2026-10-19T17:40');
    expect(calc(LUNDI(18), '1h').valeur).toBe('2026-10-19T19:00');
  });

  it('18:30 + 1h → lendemain 10:30 ; avant l’ouverture, le délai part de 10:00', () => {
    expect(calc(LUNDI(18, 30), '1h')).toMatchObject({ valeur: '2026-10-20T10:30', libelle: 'demain à 10:30' });
    expect(calc(LUNDI(17), '3h').valeur).toBe('2026-10-20T11:00');
    expect(calc(LUNDI(8), '1h').valeur).toBe('2026-10-19T11:00');
    expect(calc(LUNDI(20), '2h').valeur).toBe('2026-10-20T12:00');
  });

  it('samedi 18:00 + 2h → lundi 11:00 (dimanche fermé) ; un dimanche, on part du lundi 10:00', () => {
    const samedi = new Date(2026, 9, 24, 18, 0);
    expect(calc(samedi, '2h')).toMatchObject({ valeur: '2026-10-26T11:00', libelle: 'lundi 26/10 à 11:00' });
    expect(calc(new Date(2026, 9, 25, 12, 0), '1h').valeur).toBe('2026-10-26T11:00');
  });

  it('quelques minutes après 19:00 (5 min au plus) : promis à 19:00 le jour même, pas le lendemain', () => {
    expect(TOLERANCE_FERMETURE_MIN).toBe(5);
    expect(calc(LUNDI(16, 2), '3h')).toMatchObject({ valeur: '2026-10-19T19:00', libelle: '19:00 aujourd\'hui' });
    expect(calc(new Date(2026, 9, 19, 16, 0, 30), '3h').valeur).toBe('2026-10-19T19:00');
    expect(calc(LUNDI(16, 5), '3h').valeur).toBe('2026-10-19T19:00');
    expect(calc(LUNDI(17, 33), '1h30').valeur).toBe('2026-10-19T19:00');
    // Vendredi 16:01:30 + 3h → vendredi 19:00 (et non samedi 10:05)
    expect(calc(new Date(2026, 9, 23, 16, 1, 30), '3h').valeur).toBe('2026-10-23T19:00');
    // Au-delà de la tolérance : le reste repart le jour ouvré suivant à 10:00
    expect(calc(LUNDI(16, 6), '3h')).toMatchObject({ valeur: '2026-10-20T10:10', libelle: 'demain à 10:10' });
    expect(calc(new Date(2026, 9, 24, 16, 30), '3h').valeur).toBe('2026-10-26T10:30');
  });

  it('24h / 48h : même heure 1 / 2 jours ouvrés plus tard, dimanche sauté, ramenée dans 10:00–19:00', () => {
    expect(calc(LUNDI(14, 12), '24h')).toMatchObject({ valeur: '2026-10-20T14:15', libelle: 'demain à 14:15' });
    expect(calc(LUNDI(14), '48h').valeur).toBe('2026-10-21T14:00');
    // Samedi 15:00 + 24h → lundi ; vendredi 15:00 + 48h → samedi puis lundi
    expect(calc(new Date(2026, 9, 24, 15, 0), '24h').valeur).toBe('2026-10-26T15:00');
    expect(calc(new Date(2026, 9, 23, 15, 0), '48h').valeur).toBe('2026-10-26T15:00');
    // Dépôt tardif ou matinal : ramené à la fermeture / à l'ouverture
    expect(calc(LUNDI(19, 30), '24h').valeur).toBe('2026-10-20T19:00');
    expect(calc(LUNDI(8, 45), '24h').valeur).toBe('2026-10-20T10:00');
  });

  it('clé inconnue ou date invalide : null ; la puce d’une valeur se retrouve', () => {
    expect(calc(LUNDI(10), '5h')).toBeNull();
    expect(calc(new Date('x'), '1h')).toBeNull();
    expect(cleDeValeur('2026-10-19T16:10', MAINTENANT)).toBe('2h');
    expect(cleDeValeur('2026-10-19T16:12', MAINTENANT)).toBe('autre');
    expect(cleDeValeur('', MAINTENANT)).toBeNull();
  });
});

// ─── État du délai ───────────────────────────────────────────────
describe('infoDelai / delaiTicket : une seule lecture du délai pour tous les écrans', () => {
  it('aucun, ok (même jour, demain, plus tard), bientôt, en retard', () => {
    expect(infoDelai('', MAINTENANT)).toMatchObject({ etat: 'aucun', libelle: 'Délai à fixer' });
    expect(infoDelai(null, MAINTENANT).etat).toBe('aucun');
    expect(infoDelai('2026-10-19T15:30', MAINTENANT)).toMatchObject({ etat: 'ok', libelle: '15:30 · dans 1 h 20' });
    expect(infoDelai('2026-10-19T15:30', MAINTENANT).titre).toBe("Prêt vers 15:30 aujourd'hui (dans 1 h 20)");
    expect(infoDelai('2026-10-19T16:10', MAINTENANT).libelle).toBe('16:10 · dans 2 h');
    expect(infoDelai('2026-10-20T11:00', MAINTENANT)).toMatchObject({ etat: 'ok', libelle: 'demain 11:00' });
    expect(infoDelai('2026-10-27T14:00', MAINTENANT).libelle).toBe('mar. 27/10 14:00');
    expect(infoDelai('2026-10-19T14:30', MAINTENANT)).toMatchObject({ etat: 'bientot', libelle: '14:30 · dans 20 min' });
    expect(infoDelai('2026-10-19T13:45', MAINTENANT)).toMatchObject({ etat: 'retard', libelle: 'En retard de 25 min' });
    expect(infoDelai('2026-10-19T12:00', MAINTENANT).libelle).toBe('En retard de 2 h 10');
    expect(infoDelai('2026-10-17T14:10', MAINTENANT).libelle).toBe('En retard de 2 j');
  });

  it('anciens formats datables ; texte libre non datable rendu tel quel (état « texte »)', () => {
    expect(infoDelai('2026-10-19 15:30:00', MAINTENANT).libelle).toBe('15:30 · dans 1 h 20');
    expect(dateDelai('19/10/2026')).toEqual(LUNDI(19));
    expect(dateDelai('2026-10-19')).toEqual(LUNDI(19));
    expect(dateDelai('2026-02-31T10:00')).toBeNull();
    expect(infoDelai('Jeudi 17h', MAINTENANT)).toMatchObject({ etat: 'texte', libelle: 'Jeudi 17h' });
    expect(infoDelai('demain matin', MAINTENANT).etat).toBe('texte');
    expect(instantDelai('Jeudi 17h')).toBe(Number.POSITIVE_INFINITY);
    expect(instantDelai('2026-10-19T15:30')).toBe(LUNDI(15, 30).getTime());
  });

  it('libellés : durées, échéances et phrase « Prêt … »', () => {
    expect(dureeCourte(25 * 60_000)).toBe('25 min');
    expect(dureeCourte(65 * 60_000)).toBe('1 h 05');
    expect(dureeCourte(26 * 3_600_000)).toBe('1 j 2 h');
    expect(libelleEcheance(new Date(2026, 9, 21, 14, 0), MAINTENANT)).toBe('mercredi 21/10 à 14:00');
    expect(phrasePret(LUNDI(15, 30), MAINTENANT)).toBe("Prêt vers 15:30 aujourd'hui");
    expect(phrasePret(new Date(2026, 9, 20, 11, 0), MAINTENANT)).toBe('Prêt demain à 11:00');
  });

  it('delaiTicket : rien une fois réparé ; « à fixer » seulement pour une réparation en boutique', () => {
    const t = (extra) => ({ statut: 'En attente de diagnostic', categorie: 'Smartphone', marque: 'Apple', ...extra });
    expect(delaiTicket(t({}), MAINTENANT).etat).toBe('aucun');
    expect(delaiTicket(t({ statut: 'Réparation terminée', date_recuperation: '2026-10-19T12:00' }), MAINTENANT)).toBeNull();
    expect(delaiTicket(t({ statut: 'Rendu au client' }), MAINTENANT)).toBeNull();
    expect(delaiTicket(t({ categorie: 'Commande', statut: 'En attente de pièce' }), MAINTENANT)).toBeNull();
    expect(delaiTicket(t({ statut: 'Pré-enregistré' }), MAINTENANT)).toBeNull();
    // File atelier (sans catégorie) : commande de pièce reconnue à son motif, sans marque
    expect(delaiTicket({ statut: 'En attente de pièce', marque: '', panne: 'Pièce à commander' }, MAINTENANT)).toBeNull();
    expect(delaiTicket(t({ categorie: 'Commande', date_recuperation: '2026-10-20T11:00' }), MAINTENANT).libelle).toBe('demain 11:00');
  });
});

// ─── Composant de choix ──────────────────────────────────────────
describe('DelaiReparation : puces exclusives, heure en clair, « Autre… »', () => {
  it('9 puces (44 px au doigt), choix → valeur « AAAA-MM-JJTHH:MM » et « Prêt vers … » ; flèches = focus seul', () => {
    const onChange = vi.fn();
    const { rerender } = render(<DelaiReparation onChange={onChange} maintenant={MAINTENANT} required taille="compact" value="" />);
    const groupe = screen.getByRole('radiogroup', { name: /Délai de réparation/ });
    const puces = within(groupe).getAllByRole('radio');
    expect(puces.map((p) => p.textContent.split(',')[0])).toEqual(['1h', '1h30', '2h', '2h30', '3h', '3h30', '24h', '48h', 'Autre…']);
    puces.forEach((p) => expect(p).toHaveClass('min-h-11'));
    expect(puces[0].querySelector('svg.lucide-clock')).toBeInTheDocument();
    expect(puces[6].querySelector('svg.lucide-calendar-clock')).toBeInTheDocument();
    // Nom accessible : le libellé visible d'abord, puis l'heure calculée
    expect(screen.getByRole('radio', { name: /^2h, prêt vers 16:10 aujourd'hui/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^24h, prêt demain à 14:10/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /^2h,/ }));
    expect(onChange).toHaveBeenCalledWith('2026-10-19T16:10', { libelle: "16:10 aujourd'hui", cle: '2h' });
    rerender(<DelaiReparation onChange={onChange} maintenant={MAINTENANT} required taille="compact" value="2026-10-19T16:10" />);
    expect(screen.getByRole('radio', { name: /^2h,/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText("Prêt vers 16:10 aujourd'hui")).toBeInTheDocument();

    // Flèches : le focus avance, rien n'est choisi (aucun enregistrement involontaire)
    onChange.mockClear();
    const deuxH = screen.getByRole('radio', { name: /^2h,/ });
    act(() => deuxH.focus());
    fireEvent.keyDown(deuxH, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: /^2h30,/ })).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('« Autre… » ouvre la date et l’heure libres ; erreur annoncée', () => {
    const onChange = vi.fn();
    const { rerender } = render(<DelaiReparation value="" onChange={onChange} maintenant={MAINTENANT} error="Choisissez un délai de réparation" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Choisissez un délai de réparation');
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(screen.getByRole('radio', { name: /^Autre…/ }));
    const champ = screen.getByLabelText('Date et heure de récupération');
    expect(champ).toHaveAttribute('type', 'datetime-local');
    expect(champ).toHaveAttribute('min', '2026-10-19T14:10');
    fireEvent.change(champ, { target: { value: '2026-10-21T14:00' } });
    expect(onChange).toHaveBeenLastCalledWith('2026-10-21T14:00', { libelle: 'mercredi 21/10 à 14:00', cle: 'autre' });
    rerender(<DelaiReparation value="2026-10-21T14:00" onChange={onChange} maintenant={MAINTENANT} />);
    expect(screen.getByText('Prêt mercredi 21/10 à 14:00')).toBeInTheDocument();
  });
});

// ─── Création par le personnel ───────────────────────────────────
describe('/client?staff=1 : délai obligatoire pour une réparation créée par le personnel', () => {
  async function jusquAuProbleme(entree = '/client?staff=1') {
    render(wrap(<ClientFormPage />, [entree]));
    fireEvent.change(screen.getByLabelText('Nom *'), { target: { value: 'Martin' } });
    fireEvent.change(screen.getByLabelText('Votre numéro de téléphone (obligatoire)'), { target: { value: '06 12 34 56 78' } });
    suivant();
    fireEvent.click(await screen.findByRole('button', { name: 'Smartphone' }));
    fireEvent.change(screen.getByLabelText('Marque *'), { target: { value: 'Autre' } });
    fireEvent.change(screen.getByLabelText(/Préciser marque/), { target: { value: 'Fairphone 5' } });
    suivant();
    expect(await screen.findByText("Étape 3 sur 4 — Le problème et l'accès")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Écran cassé' }));
    fireEvent.click(screen.getByRole('radio', { name: /^Pas de code/ }));
  }

  it('« Suivant » refusé sans délai, récapitulatif « Prêt vers … », ticket créé avec date_recuperation, retour au tableau de bord', async () => {
    localStorage.setItem('kp_token', 'jeton-staff');
    localStorage.setItem('kp_target', 'accueil');
    await jusquAuProbleme();
    expect(screen.getByRole('heading', { level: 1, name: 'Nouveau ticket' })).toBeInTheDocument();
    const groupe = screen.getByRole('radiogroup', { name: /Délai de réparation/ });
    expect(groupe).toHaveAttribute('aria-required', 'true');
    within(groupe).getAllByRole('radio').forEach((p) => expect(p).toHaveClass('min-h-14'));

    suivant();
    expect(screen.getByRole('alert')).toHaveTextContent('Choisissez un délai de réparation');
    expect(screen.getByText("Étape 3 sur 4 — Le problème et l'accès")).toBeInTheDocument();

    fireEvent.click(within(groupe).getByRole('radio', { name: /^2h,/ }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText("Prêt vers 16:10 aujourd'hui")).toBeInTheDocument();
    suivant();

    const recap = await screen.findByRole('region', { name: 'Délai de réparation' });
    expect(recap).toHaveTextContent("Prêt vers 16:10 aujourd'hui");
    // « Modifier » ramène à l'étape 3, la puce choisie toujours cochée
    fireEvent.click(within(recap).getByRole('button', { name: 'Modifier : Délai de réparation' }));
    expect(await screen.findByRole('radio', { name: /^2h,/ })).toHaveAttribute('aria-checked', 'true');
    suivant();
    await screen.findByRole('heading', { name: 'Vérification' });

    fireEvent.click(screen.getByRole('button', { name: "Déposer l'appareil" }));
    expect(await screen.findByRole('heading', { name: 'Tableau de bord accueil' })).toBeInTheDocument();
    expect(apiMock.createTicket).toHaveBeenCalledWith(expect.objectContaining({
      panne: 'Écran cassé', modele_autre: 'Fairphone 5', date_recuperation: '2026-10-19T16:10',
    }));
    expect(apiMock.updateTicket).toHaveBeenCalledWith(70, { date_recuperation: '2026-10-19T16:10' });
    expect(await screen.findByText("Ticket KP-000070 créé · Prêt vers 16:10 aujourd'hui")).toBeInTheDocument();
    // Pas d'écran de borne (ni code en grand, ni compte à rebours)
    expect(screen.queryByText(/Retour automatique/)).not.toBeInTheDocument();
  });

  it('technicien : retour sur /tech ; commande de pièce : pas de délai demandé', async () => {
    localStorage.setItem('kp_token', 'jeton-staff');
    localStorage.setItem('kp_target', 'tech');
    render(wrap(<ClientFormPage />, ['/client?staff=1']));
    fireEvent.change(screen.getByLabelText('Nom *'), { target: { value: 'Martin' } });
    fireEvent.change(screen.getByLabelText('Votre numéro de téléphone (obligatoire)'), { target: { value: '0612345678' } });
    suivant();
    fireEvent.click(await screen.findByRole('button', { name: 'Commande' }));
    suivant();
    expect(await screen.findByText('Étape 3 sur 4 — Votre commande')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: /Délai promis/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Pièce à commander *'), { target: { value: 'Écran OLED' } });
    suivant();
    expect(screen.queryByRole('region', { name: 'Délai de réparation' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Valider la commande' }));
    expect(await screen.findByRole('heading', { name: 'Espace tech' })).toBeInTheDocument();
    expect(apiMock.createTicket.mock.calls[0][0]).not.toHaveProperty('date_recuperation');
    expect(apiMock.updateTicket).not.toHaveBeenCalled();
  });

  it('borne publique /client : aucun bloc délai, payload inchangé, écran du code ; staff=1 sans session : borne aussi', async () => {
    await jusquAuProbleme('/client');
    expect(screen.getByRole('heading', { level: 1, name: 'Déposer un appareil' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: /Délai promis/ })).not.toBeInTheDocument();
    suivant();
    await screen.findByRole('heading', { name: 'Vérification' });
    expect(screen.queryByRole('region', { name: 'Délai de réparation' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: "Déposer l'appareil" }));
    expect(await screen.findByText('KP-000070')).toBeInTheDocument();
    expect(apiMock.createTicket.mock.calls[0][0]).not.toHaveProperty('date_recuperation');
    expect(apiMock.updateTicket).not.toHaveBeenCalled();
    cleanup();

    await jusquAuProbleme('/client?staff=1');
    expect(screen.queryByRole('radiogroup', { name: /Délai promis/ })).not.toBeInTheDocument();
  });

  it('fiche client « Nouvelle réparation pour ce client » : /client?…&staff=1, client pré-rempli, délai exigé', async () => {
    localStorage.setItem('kp_token', 'jeton-staff');
    localStorage.setItem('kp_target', 'accueil');
    const CLIENT = { id: 12, nom: 'Durand', prenom: 'Léa', telephone: '0611223344', email: '' };
    apiMock.getClients.mockResolvedValue([CLIENT]);
    apiMock.getClient.mockResolvedValue(CLIENT);
    apiMock.getClientTickets.mockResolvedValue([]);
    function Borne() {
      return <><Ou /><ClientFormPage /></>;
    }
    render(
      <MemoryRouter initialEntries={['/accueil/clients?client=12']}>
        <SettingsProvider><ToastProvider>
          <Routes>
            <Route path="/accueil/clients" element={<ClientsPage />} />
            <Route path="/client" element={<Borne />} />
          </Routes>
        </ToastProvider></SettingsProvider>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Nouvelle réparation pour ce client/ }));
    expect(await screen.findByTestId('ou')).toHaveTextContent('/client?client_id=12&tel=0611223344&staff=1');
    expect(screen.getByRole('heading', { level: 1, name: 'Nouveau ticket' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Nom *')).toHaveValue('Durand'));
    suivant();
    fireEvent.click(await screen.findByRole('button', { name: 'Smartphone' }));
    fireEvent.change(screen.getByLabelText('Marque *'), { target: { value: 'Autre' } });
    fireEvent.change(screen.getByLabelText(/Préciser marque/), { target: { value: 'Fairphone 5' } });
    suivant();
    fireEvent.click(await screen.findByRole('button', { name: 'Écran cassé' }));
    fireEvent.click(screen.getByRole('radio', { name: /^Pas de code/ }));
    expect(screen.getByRole('radiogroup', { name: /Délai de réparation/ })).toHaveAttribute('aria-required', 'true');
    suivant();
    expect(screen.getByRole('alert')).toHaveTextContent('Choisissez un délai de réparation');
  });

  it('PATCH du délai refusé : ticket créé quand même, avertissement pour le fixer depuis la fiche', async () => {
    localStorage.setItem('kp_token', 'jeton-staff');
    apiMock.updateTicket.mockRejectedValue(new Error('réseau'));
    await jusquAuProbleme();
    fireEvent.click(screen.getByRole('radio', { name: /^1h,/ }));
    suivant();
    fireEvent.click(await screen.findByRole('button', { name: "Déposer l'appareil" }));
    expect(await screen.findByText(/délai non enregistré, fixez-le depuis la fiche/)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Tableau de bord accueil' })).toBeInTheDocument();
  });
});

// ─── Borne /client : mise à jour automatique ─────────────────────
describe('Borne /client : rechargement après un dépôt si une nouvelle version est en ligne', () => {
  const html = (nom) => `<html><head><script type="module" crossorigin src="/assets/index-${nom}.js"></script></head></html>`;
  function pageChargeeAvec(nom) {
    const s = document.createElement('script');
    s.type = 'module';
    s.setAttribute('src', `/assets/index-${nom}.js`);
    s.dataset.testBundle = '1';
    document.head.appendChild(s);
  }
  const serveurAnnonce = (nom) => vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(html(nom)) })));

  async function deposer() {
    render(wrap(<ClientFormPage />, ['/client']));
    fireEvent.change(screen.getByLabelText('Nom *'), { target: { value: 'Martin' } });
    fireEvent.change(screen.getByLabelText('Votre numéro de téléphone (obligatoire)'), { target: { value: '0612345678' } });
    suivant();
    fireEvent.click(await screen.findByRole('button', { name: 'Smartphone' }));
    fireEvent.change(screen.getByLabelText('Marque *'), { target: { value: 'Autre' } });
    fireEvent.change(screen.getByLabelText(/Préciser marque/), { target: { value: 'Fairphone 5' } });
    suivant();
    fireEvent.click(await screen.findByRole('button', { name: 'Écran cassé' }));
    fireEvent.click(screen.getByRole('radio', { name: /^Pas de code/ }));
    suivant();
    fireEvent.click(await screen.findByRole('button', { name: "Déposer l'appareil" }));
    expect(await screen.findByText('KP-000070')).toBeInTheDocument();
  }

  beforeEach(() => {
    window.location.reload = vi.fn();
    pageChargeeAvec('ANCIEN1');
  });

  it('« Nouveau dépôt » + nouvelle version : rechargement, pas de remise à zéro visible', async () => {
    await deposer();
    serveurAnnonce('NOUVEAU2');
    fireEvent.click(screen.getByRole('button', { name: /Nouveau dépôt/ }));
    await waitFor(() => expect(window.location.reload).toHaveBeenCalledTimes(1));
    expect(screen.getByText('KP-000070')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nouveau dépôt/ })).toBeDisabled();
  });

  it('« Nouveau dépôt », même version : retour à l’étape 1 vide', async () => {
    await deposer();
    serveurAnnonce('ANCIEN1');
    fireEvent.click(screen.getByRole('button', { name: /Nouveau dépôt/ }));
    expect(await screen.findByText('Étape 1 sur 4 — Vous')).toBeInTheDocument();
    expect(screen.getByLabelText('Nom *')).toHaveValue('');
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it('fin du compte à rebours de 10 s : vérification puis rechargement', async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await deposer();
    serveurAnnonce('NOUVEAU2');
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(window.location.reload).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  it('au repos (étape 1 vide, 2 min sans toucher) : vérifie toutes les 10 min et recharge ; jamais en mode personnel', async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serveurAnnonce('NOUVEAU2');
    render(wrap(<ClientFormPage />, ['/client']));
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000 + 31_000); });
    expect(window.location.reload).toHaveBeenCalledTimes(1);
    cleanup();

    window.location.reload = vi.fn();
    sessionStorage.clear();
    localStorage.setItem('kp_token', 'jeton-staff');
    render(wrap(<ClientFormPage />, ['/client?staff=1']));
    await act(async () => { await vi.advanceTimersByTimeAsync(25 * 60_000); });
    expect(window.location.reload).not.toHaveBeenCalled();
  });
});

// ─── Tableau de bord ─────────────────────────────────────────────
describe('Tableau de bord : délai visible d’un coup d’œil (accueil et tech)', () => {
  const ligne = (id, extra) => ({
    id, ticket_code: `KP-00000${id}`, statut: 'En attente de diagnostic', categorie: 'Smartphone',
    client_nom: `Client${id}`, client_prenom: '', client_tel: '0612345678', marque: 'Apple', modele: 'iPhone 13',
    panne: 'Écran', date_depot: `2026-10-1${id} 09:00:00`, priorite: 'normal', reception_complete: true, ...extra,
  });
  beforeEach(() => {
    apiMock.getDashboard.mockResolvedValue({
      kpi: {}, total: 7,
      tickets: [
        ligne(1, { statut: 'En cours de réparation', date_recuperation: '2026-10-19T15:30' }),
        ligne(2, { date_recuperation: '2026-10-19T13:45' }),
        ligne(3, {}),
        ligne(4, { statut: 'Réparation terminée' }),
        ligne(5, { categorie: 'Commande', statut: 'En attente de pièce', marque: '' }),
        ligne(6, { date_recuperation: '2026-10-20T11:00' }),
        ligne(7, { date_recuperation: '2026-10-19T14:30' }),
      ],
    });
  });

  const pastille = (texte) => screen.getByText(texte).closest('[data-delai]');

  it.each([
    ['accueil', '/accueil'],
    ['tech', '/tech'],
  ])('vue %s : « dans … », « En retard », « Délai à fixer », orange sous 30 min', async (target, chemin) => {
    auth.user = { target, utilisateur: target === 'tech' ? 'Karim' : 'Sophie' };
    render(
      <MemoryRouter initialEntries={[chemin]}>
        <SettingsProvider><ToastProvider><DashboardPage /></ToastProvider></SettingsProvider>
      </MemoryRouter>,
    );
    await screen.findByText('KP-000001');
    expect(pastille('15:30 · dans 1 h 20')).toHaveAttribute('data-delai', 'ok');
    expect(pastille('15:30 · dans 1 h 20')).toHaveClass('bg-slate-100');
    expect(pastille('En retard de 25 min')).toHaveAttribute('data-delai', 'retard');
    expect(pastille('En retard de 25 min')).toHaveClass('text-red-700');
    expect(pastille('demain 11:00')).toHaveAttribute('data-delai', 'ok');
    expect(pastille('14:30 · dans 20 min')).toHaveClass('bg-orange-100');
    // Un seul « Délai à fixer » : ni le ticket terminé, ni la commande de pièce
    expect(screen.getAllByText('Délai à fixer')).toHaveLength(1);
    expect(pastille('Délai à fixer')).toHaveClass('border-dashed');
    expect(pastille('Délai à fixer')).toHaveTextContent('Délai de réparation : Délai à fixer');
    expect(pastille('Délai à fixer').closest('[class*="cursor-pointer"]')).toHaveTextContent('Client3');
  });

  it('« Nouveau ticket » ouvre /client?staff=1 ; tri « Récupération » robuste au texte libre', async () => {
    render(
      <MemoryRouter initialEntries={['/accueil']}>
        <SettingsProvider><ToastProvider>
          <Routes>
            <Route path="/accueil" element={<DashboardPage />} />
            <Route path="/client" element={<Ou />} />
          </Routes>
        </ToastProvider></SettingsProvider>
      </MemoryRouter>,
    );
    await screen.findByText('KP-000001');
    fireEvent.click(screen.getByRole('button', { name: 'Récupération' }));
    fireEvent.click(screen.getByRole('button', { name: /Récupération/ }));
    const codes = [...document.querySelectorAll('[data-ticket-link]')].map((a) => a.textContent);
    expect(codes.slice(0, 4)).toEqual(['KP-000002', 'KP-000007', 'KP-000001', 'KP-000006']);
    fireEvent.click(screen.getAllByRole('button', { name: /Nouveau ticket/ })[0]);
    expect(await screen.findByTestId('ou')).toHaveTextContent('/client?staff=1');
  });
});

// ─── File atelier ────────────────────────────────────────────────
describe('File atelier : la pastille en tête de ligne', () => {
  it('délai promis avant le code ; « Délai à fixer » pour une réparation sans délai', async () => {
    apiMock.getRepairQueue.mockResolvedValue([
      { id: 1, ticket_code: 'KP-1', statut: 'En cours de réparation', client_nom: 'Martin', priorite: 'normal', marque: 'Apple', date_recuperation: '2026-10-19T13:45' },
      { id: 2, ticket_code: 'KP-2', statut: 'En attente de diagnostic', client_nom: 'Bernard', priorite: 'normal', marque: 'Apple' },
      { id: 3, ticket_code: 'KP-3', statut: 'En attente de pièce', client_nom: 'Durand', priorite: 'normal', marque: '', panne: 'Pièce à commander' },
    ]);
    render(
      <MemoryRouter><RepairQueue open inline basePath="/tech" user={{ target: 'tech', utilisateur: 'Karim' }} onClose={() => {}} /></MemoryRouter>,
    );
    const items = await screen.findAllByRole('button', { name: /KP-/ });
    const premiere = items[0].querySelector('[data-delai]');
    expect(premiere).toHaveTextContent('En retard de 25 min');
    // En tête de ligne : avant le code du ticket
    expect(premiere.compareDocumentPosition(within(items[0]).getByText('KP-1')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(items[1]).toHaveTextContent('Délai à fixer');
    expect(items[2].querySelector('[data-delai]')).toBeNull();
  });
});

// ─── Pastille seule ──────────────────────────────────────────────
describe('PastilleDelai', () => {
  it('variante sombre (en-tête de la fiche) et texte libre tronqué avec info-bulle', () => {
    const { container } = render(<>
      <PastilleDelai valeur="2026-10-19T15:30" maintenant={MAINTENANT} sombre taille="md" />
      <PastilleDelai valeur="Jeudi 17h" maintenant={MAINTENANT} />
      <PastilleDelai ticket={{ statut: 'Clôturé' }} maintenant={MAINTENANT} />
    </>);
    const [sombre, texte] = container.querySelectorAll('[data-delai]');
    expect(container.querySelectorAll('[data-delai]')).toHaveLength(2);
    expect(sombre).toHaveClass('bg-white/10', 'text-white');
    expect(texte).toHaveAttribute('title', 'Récupération prévue : Jeudi 17h');
  });
});

// ─── Panneau de scan ─────────────────────────────────────────────
describe('Panneau de scan : délai près du statut, fixé en un tap s’il manque', () => {
  it('« Délai à fixer » → puce « 1h » → PATCH date_recuperation, la pastille passe à l’heure promise', async () => {
    takePendingScan();
    const ticket = {
      id: 42, ticket_code: 'KP-000042', statut: 'En attente de diagnostic', categorie: 'Smartphone',
      client_id: 5, client_nom: 'Martin', client_prenom: 'Léa', client_tel: '0612345678',
      marque: 'Apple', modele: 'iPhone 13', panne: 'Écran cassé', date_depot: '2026-10-19T09:00:00',
      paye: 0, acompte: 0, montants: { total: 89, acompte: 0, reste: 89, paye: false, lignes: [] },
    };
    apiMock.getTicket.mockResolvedValue(ticket);
    render(
      <MemoryRouter initialEntries={['/accueil']}>
        <ToastProvider><QuickScanPanel /></ToastProvider>
      </MemoryRouter>,
    );
    act(() => openQuickScan({ id: 42, code: 'KP-000042' }));
    const dialog = await screen.findByRole('dialog');
    const section = await within(dialog).findByRole('region', { name: 'Délai à fixer' });
    expect(within(dialog).getAllByText('Délai à fixer').length).toBeGreaterThanOrEqual(2); // pastille + titre
    within(section).getAllByRole('radio').forEach((p) => expect(p).toHaveClass('min-h-11'));
    fireEvent.click(within(section).getByRole('radio', { name: /^1h,/ }));
    await waitFor(() => expect(apiMock.updateTicket).toHaveBeenCalledWith(42, { date_recuperation: '2026-10-19T15:10' }));
    expect(await within(dialog).findByText('15:10 · dans 1 h')).toBeInTheDocument();
    expect(within(dialog).queryByRole('region', { name: 'Délai à fixer' })).not.toBeInTheDocument();
    expect(await screen.findByText("KP-000042 : délai fixé, prêt vers 15:10 aujourd'hui")).toBeInTheDocument();
  });
});
