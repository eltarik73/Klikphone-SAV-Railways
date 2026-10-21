/**
 * Lot 5 — accueil, configuration, RGPD : information RGPD au dépôt, consentement facultatif,
 * « Je patiente en boutique », page /confidentialite, mentions légales (ConfigPage), export et
 * anonymisation d'un client, priorité atelier au dashboard et dans la file.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { auth, apiMock } = vi.hoisted(() => ({
  auth: { user: { target: 'accueil', utilisateur: 'Sophie' } },
  apiMock: {
    getPublicConfig: vi.fn(),
    getConfidentialite: vi.fn(),
    getCategories: vi.fn(),
    getPannes: vi.fn(),
    createOrGetClient: vi.fn(),
    createTicket: vi.fn(),
    createPartAuto: vi.fn(),
    learnTerm: vi.fn(),
    getClients: vi.fn(),
    getClient: vi.fn(),
    updateClient: vi.fn(),
    getClientTickets: vi.fn(),
    rgpdExport: vi.fn(),
    rgpdAnonymiser: vi.fn(),
    rgpdRetentionApercu: vi.fn(),
    rgpdRetentionAppliquer: vi.fn(),
    getConfig: vi.fn(),
    getTeam: vi.fn(),
    setParams: vi.fn(),
    getRepairQueue: vi.fn(),
    getDashboard: vi.fn(),
    getActiveTeam: vi.fn(),
    getInteractions: vi.fn(),
    getParts: vi.fn(),
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
import ClientFormPage from '../pages/ClientFormPage';
import ClientsPage, { MOT_CONFIRMATION_ANONYMISER } from '../pages/ClientsPage';
import ConfigPage, {
  siretValide, controlesMentions, valeurMention, avecMention, lignesPiedDocument,
} from '../pages/ConfigPage';
import ConfidentialitePage, {
  dureeMois, infosRgpd, _oublierConfigPublique, PolitiqueDialog,
} from '../pages/ConfidentialitePage';
import DashboardPage, { comparerUrgence, receptionACompleter } from '../pages/DashboardPage';
import RepairQueue, { trierFile } from '../components/RepairQueue';

const POLITIQUE = {
  titre: 'Politique de confidentialité',
  maj: '16/10/2026',
  sections: [
    { titre: 'Responsable du traitement', texte: 'Klikphone, 79 Place Saint-Léger, 73000 Chambéry.' },
    { titre: 'Vos droits', texte: 'Accès, rectification, effacement.\n\nRéclamation auprès de la CNIL.' },
  ],
};

function resetApi() {
  clearCache();
  _oublierConfigPublique();
  sessionStorage.clear();
  localStorage.clear();
  Object.values(apiMock).forEach((fn) => fn.mockReset?.());
  apiMock.getPublicConfig.mockResolvedValue({
    BOUTIQUE_NOM: 'Klikphone Chambéry', RGPD_CONTACT_EMAIL: 'rgpd@klikphone.test',
    RGPD_RETENTION_MOIS: '24', PURGE_CODES_JOURS: '15',
  });
  apiMock.getConfidentialite.mockResolvedValue(POLITIQUE);
  apiMock.getCategories.mockResolvedValue(['Smartphone']);
  apiMock.getPannes.mockResolvedValue(['Écran cassé']);
  apiMock.createOrGetClient.mockResolvedValue({ id: 7 });
  apiMock.createTicket.mockResolvedValue({ id: 70, ticket_code: 'KP-000070' });
  apiMock.learnTerm.mockResolvedValue({});
}

beforeEach(resetApi);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const wrap = (ui, entries = ['/']) => (
  <MemoryRouter initialEntries={entries}>
    <SettingsProvider>
      <ToastProvider>{ui}</ToastProvider>
    </SettingsProvider>
  </MemoryRouter>
);

// ─── Helpers purs ────────────────────────────────────────────────
describe('RGPD : information courte', () => {
  it('formate les durées de conservation', () => {
    expect(dureeMois(36)).toBe('3 ans');
    expect(dureeMois('12')).toBe('1 an');
    expect(dureeMois(18)).toBe('18 mois');
    expect(dureeMois('')).toBe('3 ans');
  });

  it('lit la configuration publique avec des valeurs de repli', () => {
    expect(infosRgpd({})).toEqual({ nom: 'Klikphone', contact: '', retention: '3 ans', purgeJours: 30 });
    expect(infosRgpd({ BOUTIQUE_NOM: ' KP ', BOUTIQUE_EMAIL: 'a@b.fr', PURGE_CODES_JOURS: '7' }))
      .toMatchObject({ nom: 'KP', contact: 'a@b.fr', purgeJours: 7 });
  });
});

describe('Mentions légales : contrôles', () => {
  it('vérifie le SIRET (14 chiffres, clé de Luhn)', () => {
    expect(siretValide('732 829 320 00074')).toBe(true);
    expect(siretValide('73282932000075')).toBe(false);
    expect(siretValide('1234')).toBe(false);
  });

  it('bloque les durées hors bornes et signale les mentions manquantes', () => {
    const { erreurs, alertes } = controlesMentions({ GARANTIE_MOIS: '6,5', RGPD_RETENTION_MOIS: '0', PURGE_CODES_JOURS: '30' });
    expect(Object.keys(erreurs).sort()).toEqual(['GARANTIE_MOIS', 'RGPD_RETENTION_MOIS']);
    expect(alertes.join(' ')).toMatch(/SIRET manquant/);
    expect(alertes.join(' ')).toMatch(/TVA intracommunautaire/);
    expect(alertes.join(' ')).toMatch(/Contact RGPD manquant/);
    expect(alertes.join(' ')).toMatch(/RCS \(ou RM\) manquant/);
    const ok = controlesMentions({
      BOUTIQUE_SIRET: '73282932000074', TVA_MENTION: 'TVA non applicable, art. 293 B du CGI', tva: '0',
      BOUTIQUE_FORME: 'SAS au capital de 1 000 €', BOUTIQUE_RCS: 'RCS Chambéry 732 829 320',
      BOUTIQUE_ADRESSE: 'Chambéry', RGPD_CONTACT_EMAIL: 'rgpd@kp.fr',
    });
    expect(ok).toEqual({ erreurs: {}, alertes: [] });
  });

  it('forme sans capital, franchise de TVA incohérente avec le taux', () => {
    const base = {
      BOUTIQUE_SIRET: '73282932000074', BOUTIQUE_RCS: 'RCS Chambéry 732 829 320',
      BOUTIQUE_ADRESSE: 'Chambéry', RGPD_CONTACT_EMAIL: 'rgpd@kp.fr',
    };
    const alertes = (cfg) => controlesMentions({ ...base, ...cfg }).alertes.join(' ');
    expect(alertes({ BOUTIQUE_FORME: 'SARL', BOUTIQUE_TVA_INTRA: 'FR03813961141' })).toMatch(/indiquez aussi le capital/);
    expect(alertes({ BOUTIQUE_FORME: 'EI', BOUTIQUE_TVA_INTRA: 'FR03813961141' })).toBe('');
    // 293 B avec un taux facturé (absent = 20 %, comme le serveur)
    expect(alertes({ BOUTIQUE_FORME: 'SAS au capital de 1 €', TVA_MENTION: 'TVA non applicable, art. 293 B du CGI' }))
      .toMatch(/taux de TVA n’est pas 0 %/);
    expect(alertes({ BOUTIQUE_FORME: 'SAS au capital de 1 €', TVA_MENTION: 'art. 293 B', tva: '20' }))
      .toMatch(/taux de TVA n’est pas 0 %/);
    expect(alertes({ BOUTIQUE_FORME: 'SAS au capital de 1 €', BOUTIQUE_TVA_INTRA: 'FR03813961141', tva: '0' }))
      .toMatch(/Taux de TVA à 0 %/);
  });

  it('clé canonique prioritaire, ancienne clé en repli et tenue à jour si elle existe', () => {
    expect(valeurMention({ siret: '111' }, 'BOUTIQUE_SIRET')).toBe('111');
    expect(valeurMention({ siret: '111', BOUTIQUE_SIRET: '' }, 'BOUTIQUE_SIRET')).toBe('');
    expect(avecMention({ telephone: '04', autre: 'x' }, 'BOUTIQUE_TEL', '05'))
      .toEqual({ telephone: '05', autre: 'x', BOUTIQUE_TEL: '05' });
    expect(avecMention({}, 'BOUTIQUE_TEL', '05')).toEqual({ BOUTIQUE_TEL: '05' });
  });

  it('aperçu du pied : mêmes lignes que les documents (n° intracom. et mention TVA ensemble)', () => {
    const lignes = lignesPiedDocument({
      BOUTIQUE_NOM: 'Klikphone', BOUTIQUE_FORME: 'SARL au capital de 1 000 €', BOUTIQUE_SIRET: '73282932000074',
      BOUTIQUE_RCS: 'Chambéry 732 829 320', BOUTIQUE_TEL: '04 79 60 89 22',
      BOUTIQUE_TVA_INTRA: 'FR03813961141', TVA_MENTION: 'TVA non applicable, art. 293 B du CGI',
    }, 'https://www.kp.test');
    expect(lignes[0]).toBe('Klikphone, SARL au capital de 1 000 €');
    expect(lignes).toContain('Tél : 04 79 60 89 22');
    expect(lignes).toContain('SIRET : 73282932000074 · RCS Chambéry 732 829 320');
    expect(lignes).toContain('TVA intracom. : FR03813961141 · TVA non applicable, art. 293 B du CGI');
    expect(lignes.join(' ')).toMatch(/Garantie 6 mois pièces et main-d'œuvre/);
    expect(lignes).toContain('Politique de confidentialité : kp.test/confidentialite');
    expect(lignesPiedDocument({ GARANTIE_MOIS: '0' }).join(' ')).not.toMatch(/Garantie/);
  });
});

describe('Priorité atelier : ordre', () => {
  it('trie sur place, express, pro, normal puis heure promise (texte) puis dépôt', () => {
    const t = (id, priorite, date_recuperation, date_depot = '2026-10-01T09:00:00') => ({ id, priorite, date_recuperation, date_depot });
    const liste = [
      t(1, 'normal', '2026-10-16 10:00'),
      t(2, 'pro', ''),
      t(3, 'attente', 'demain matin'),
      t(4, 'express', '2026-10-17T09:00'),
      t(5, 'express', '2026-10-16T18:00'),
      t(6, undefined, '', '2026-09-01T09:00:00'),
      t(7, 'normal', '', '2026-08-01T09:00:00'),
    ];
    expect([...liste].sort(comparerUrgence).map(x => x.id)).toEqual([3, 5, 4, 2, 1, 7, 6]);
  });

  it('la file garde l’ordre du serveur à priorité égale', () => {
    const file = trierFile([{ id: 1, priorite: 'normal' }, { id: 2, priorite: 'attente' }, { id: 3 }, { id: 4, priorite: 'attente' }]);
    expect(file.map(x => x.id)).toEqual([2, 4, 1, 3]);
  });

  it('badge « Réception à compléter » : appareil en boutique, non réparé, drapeau serveur à false', () => {
    const base = { statut: 'En attente de diagnostic', categorie: 'Smartphone', reception_complete: false };
    expect(receptionACompleter(base)).toBe(true);
    expect(receptionACompleter({ ...base, reception_complete: true })).toBe(false);
    expect(receptionACompleter({ ...base, reception_complete: undefined })).toBe(false);
    expect(receptionACompleter({ ...base, statut: 'Réparation terminée' })).toBe(false);
    expect(receptionACompleter({ ...base, statut: 'Pré-enregistré' })).toBe(false);
    expect(receptionACompleter({ ...base, categorie: 'Commande' })).toBe(false);
  });
});

// ─── ApiClient réel ──────────────────────────────────────────────
describe('ApiClient : méthodes RGPD', () => {
  let client;
  let appels;
  beforeEach(async () => {
    const reel = await vi.importActual('../lib/api');
    client = reel.api;
    client.setToken('jeton-staff');
    client.setAdminToken('jeton-admin', 60_000);
    appels = [];
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      appels.push({ url, opts });
      return Promise.resolve({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ ok: true }),
      });
    });
  });
  afterEach(() => {
    client.setToken(null);
  });

  it('politique publique : ni session ni élévation', async () => {
    await client.getConfidentialite();
    expect(appels[0].url).toBe('/api/public/confidentialite');
    expect(appels[0].opts.headers.Authorization).toBeUndefined();
    expect(appels[0].opts.headers['X-Admin-Token']).toBeUndefined();
  });

  it('export, anonymisation et rétention portent le jeton d’élévation', async () => {
    await client.rgpdExport(5);
    await client.rgpdAnonymiser(5);
    await client.rgpdRetentionApercu();
    await client.rgpdRetentionAppliquer();
    expect(appels.map(a => [a.url, a.opts.method || 'GET'])).toEqual([
      ['/api/rgpd/clients/5/export', 'GET'],
      ['/api/rgpd/clients/5/anonymiser', 'POST'],
      ['/api/rgpd/retention/apercu', 'GET'],
      ['/api/rgpd/retention/appliquer', 'POST'],
    ]);
    for (const a of appels) {
      expect(a.opts.headers['X-Admin-Token']).toBe('jeton-admin');
      expect(a.opts.headers.Authorization).toBe('Bearer jeton-staff');
    }
    expect(appels[0].opts.cache).toBe('no-store');
  });
});

// ─── Page publique ───────────────────────────────────────────────
describe('Page /confidentialite', () => {
  it('affiche les sections de la politique', async () => {
    render(wrap(<ConfidentialitePage />));
    expect(await screen.findByRole('heading', { level: 1, name: 'Politique de confidentialité' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Responsable du traitement' })).toBeInTheDocument();
    expect(screen.getByText('Réclamation auprès de la CNIL.')).toBeInTheDocument();
    expect(screen.getByText(/Mise à jour : 16\/10\/2026/)).toBeInTheDocument();
  });

  it('erreur de chargement : message et bouton Réessayer', async () => {
    apiMock.getConfidentialite.mockRejectedValueOnce(new Error('panne'));
    render(wrap(<ConfidentialitePage />));
    expect(await screen.findByRole('alert')).toHaveTextContent(/n'a pas pu être chargée/);
    fireEvent.click(screen.getByRole('button', { name: /Réessayer/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Vos droits' })).toBeInTheDocument();
  });
});

// ─── Borne de dépôt ──────────────────────────────────────────────
// Parcours en 4 étapes (Vous → Votre appareil → Le problème et l'accès → Vérification) :
// l'information RGPD, la case des offres et « Je patiente en boutique » sont à la dernière
// étape, et le code d'accès (ici « Pas de code ») doit être choisi à la troisième.
async function allerALaVerification() {
  render(wrap(<ClientFormPage />, ['/client']));
  fireEvent.change(screen.getByPlaceholderText('Dupont'), { target: { value: 'Martin' } });
  fireEvent.change(screen.getByPlaceholderText('06 XX XX XX XX'), { target: { value: '0612345679' } });
  fireEvent.click(screen.getByRole('button', { name: /Suivant/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Smartphone' }));
  fireEvent.change(screen.getByLabelText('Marque *'), { target: { value: 'Autre' } });
  fireEvent.change(screen.getByLabelText(/Préciser marque/), { target: { value: 'Fairphone 5' } });
  fireEvent.click(screen.getByRole('button', { name: /Suivant/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Écran cassé' }));
  fireEvent.click(screen.getByRole('radio', { name: /Pas de code/ }));
  fireEvent.click(screen.getByRole('button', { name: /Suivant/ }));
  await screen.findByRole('heading', { name: 'Vérification' });
}

async function remplirJusquAuDepot({ consentir = false, attendre = false } = {}) {
  await allerALaVerification();
  const consentement = screen.getByRole('checkbox', { name: /J'accepte de recevoir par SMS ou e-mail des offres de/ });
  expect(consentement).not.toBeChecked();
  if (consentir) fireEvent.click(consentement);
  const attente = screen.getByRole('checkbox', { name: /Je patiente en boutique/ });
  expect(attente).not.toBeChecked();
  if (attendre) fireEvent.click(attente);
  fireEvent.click(screen.getByRole('button', { name: /Déposer l'appareil/ }));
  await screen.findByText('KP-000070');
}

describe('Borne /client : RGPD et priorité', () => {
  it('information RGPD visible avec les valeurs de la boutique, politique en fenêtre', async () => {
    await allerALaVerification();
    const info = screen.getByRole('region', { name: 'Vos données personnelles' });
    await waitFor(() => expect(info).toHaveTextContent('Klikphone Chambéry'));
    expect(info).toHaveTextContent('2 ans après votre dernière visite');
    expect(info).toHaveTextContent('effacés 15 jours après la remise');
    expect(info).toHaveTextContent('rgpd@klikphone.test');
    expect(info).toHaveTextContent('CNIL');
    fireEvent.click(within(info).getByRole('button', { name: 'Politique de confidentialité' }));
    const dialog = await screen.findByRole('dialog', { name: 'Politique de confidentialité' });
    expect(await within(dialog).findByText('Responsable du traitement')).toBeInTheDocument();
    // Borne : pas de nouvel onglet qui ferait quitter un dépôt à moitié saisi
    expect(within(dialog).queryByRole('link', { name: /Ouvrir dans une page/ })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: "J'ai compris" }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Le formulaire n'a pas quitté l'étape de vérification
    expect(screen.getByRole('button', { name: /Déposer l'appareil/ })).toBeInTheDocument();
    expect(apiMock.createTicket).not.toHaveBeenCalled();
  });

  it('hors borne (/deposer) : la fenêtre propose d’ouvrir la page', async () => {
    render(wrap(<PolitiqueDialog open onClose={() => {}} />));
    const dialog = await screen.findByRole('dialog', { name: 'Politique de confidentialité' });
    expect(within(dialog).getByRole('link', { name: /Ouvrir dans une page/ })).toHaveAttribute('href', '/confidentialite');
  });

  it('libellé du consentement : canal et objet, au nom de la boutique', async () => {
    await allerALaVerification();
    expect(await screen.findByRole('checkbox', { name: "J'accepte de recevoir par SMS ou e-mail des offres de Klikphone Chambéry" }))
      .not.toBeChecked();
    expect(screen.queryByText(/demandes d'avis/)).not.toBeInTheDocument();
  });

  it('refus des offres : dépôt possible, rgpd_informe envoyé, priorité normale', async () => {
    await remplirJusquAuDepot();
    expect(apiMock.createOrGetClient).toHaveBeenCalledWith(expect.objectContaining({
      nom: 'Martin', rgpd_informe: true, consentement_marketing: false,
    }));
    expect(apiMock.createTicket.mock.calls[0][0]).not.toHaveProperty('priorite');
  });

  it('accord aux offres et client qui patiente : consentement et priorité « attente »', async () => {
    await remplirJusquAuDepot({ consentir: true, attendre: true });
    expect(apiMock.createOrGetClient).toHaveBeenCalledWith(expect.objectContaining({
      rgpd_informe: true, consentement_marketing: true,
    }));
    expect(apiMock.createTicket).toHaveBeenCalledWith(expect.objectContaining({ priorite: 'attente', modele_autre: 'Fairphone 5' }));
  });
});

// ─── Fiche client : export et anonymisation ──────────────────────
describe('Fiche client : droits RGPD', () => {
  const CLIENT = {
    id: 12, nom: 'Durand', prenom: 'Léa', telephone: '0611223344', email: 'lea@exemple.fr',
    consentement_marketing: true, consentement_marketing_le: '2026-10-01T10:00:00',
  };
  beforeEach(() => {
    apiMock.getClients.mockResolvedValue([CLIENT]);
    apiMock.getClient.mockResolvedValue(CLIENT);
    apiMock.getClientTickets.mockResolvedValue([]);
  });

  it('badge de consentement et export JSON téléchargé', async () => {
    const createUrl = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revoke });
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    apiMock.rgpdExport.mockResolvedValue({ client: CLIENT, tickets: [] });
    render(wrap(<ClientsPage />, ['/accueil/clients?client=12']));
    expect(await screen.findByText('Offres acceptées le 01/10/2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Exporter ses données/ }));
    await waitFor(() => expect(apiMock.rgpdExport).toHaveBeenCalledWith(12));
    await waitFor(() => expect(clic).toHaveBeenCalled());
    expect(createUrl).toHaveBeenCalled();
  });

  it('anonymisation : mot de confirmation exigé, puis fiche rechargée', async () => {
    apiMock.rgpdAnonymiser.mockResolvedValue({ ok: true });
    render(wrap(<ClientsPage />, ['/accueil/clients?client=12']));
    fireEvent.click(await screen.findByRole('button', { name: 'Anonymiser' }));
    const dialog = await screen.findByRole('alertdialog', { name: /Anonymiser Léa Durand/ });
    const valider = within(dialog).getByRole('button', { name: /Anonymiser définitivement/ });
    expect(valider).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Tapez ANONYMISER/), { target: { value: 'anonymis' } });
    expect(valider).toBeDisabled();
    apiMock.getClient.mockResolvedValue({ id: 12, nom: 'Anonyme', prenom: '', anonymise_le: '2026-10-16T12:00:00' });
    fireEvent.change(within(dialog).getByLabelText(/Tapez ANONYMISER/), { target: { value: MOT_CONFIRMATION_ANONYMISER.toLowerCase() } });
    fireEvent.click(valider);
    await waitFor(() => expect(apiMock.rgpdAnonymiser).toHaveBeenCalledWith(12));
    expect(await screen.findByText('Anonymisé le 16/10/2026')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Déjà anonymisé/ })).toBeDisabled();
  });

  it('accord aux offres : retrait puis nouvel accord depuis la fiche, date rechargée', async () => {
    apiMock.updateClient.mockResolvedValue({ ok: true });
    render(wrap(<ClientsPage />, ['/accueil/clients?client=12']));
    const bouton = await screen.findByRole('button', { name: /Accepte les offres/ });
    expect(bouton).toHaveAttribute('aria-pressed', 'true');
    expect(bouton).toHaveAccessibleDescription(/accord exprès/);
    apiMock.getClient.mockResolvedValue({ ...CLIENT, consentement_marketing: false, consentement_marketing_le: null });
    fireEvent.click(bouton);
    await waitFor(() => expect(apiMock.updateClient).toHaveBeenCalledWith(12, { consentement_marketing: false }));
    expect(await screen.findByText('Pas d’offres commerciales')).toBeInTheDocument();
    expect(bouton).toHaveAttribute('aria-pressed', 'false');
    apiMock.getClient.mockResolvedValue({ ...CLIENT, consentement_marketing_le: '2026-10-16T09:30:00' });
    fireEvent.click(bouton);
    await waitFor(() => expect(apiMock.updateClient).toHaveBeenLastCalledWith(12, { consentement_marketing: true }));
    expect(await screen.findByText('Offres acceptées le 16/10/2026')).toBeInTheDocument();
    expect(bouton).toHaveAttribute('aria-pressed', 'true');
  });

  it('client anonymisé : interrupteur des offres désactivé', async () => {
    const anonyme = { id: 12, nom: 'Anonyme', prenom: '', anonymise_le: '2026-10-16T12:00:00', consentement_marketing: false };
    apiMock.getClients.mockResolvedValue([anonyme]);
    apiMock.getClient.mockResolvedValue(anonyme);
    render(wrap(<ClientsPage />, ['/accueil/clients?client=12']));
    expect(await screen.findByRole('button', { name: /Accepte les offres/ })).toBeDisabled();
  });

  it('annuler la fenêtre ne lance rien', async () => {
    render(wrap(<ClientsPage />, ['/accueil/clients?client=12']));
    fireEvent.click(await screen.findByRole('button', { name: 'Anonymiser' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(apiMock.rgpdAnonymiser).not.toHaveBeenCalled();
  });
});

// ─── Configuration : mentions légales & RGPD ─────────────────────
describe('Configuration : onglet Mentions & RGPD', () => {
  beforeEach(() => {
    localStorage.setItem('klikphone_admin', 'true');
    apiMock.getConfig.mockResolvedValue([
      { cle: 'BOUTIQUE_NOM', valeur: 'Klikphone' },
      { cle: 'telephone', valeur: '04 79 60 89 22' },
      { cle: 'GARANTIE_MOIS', valeur: '6' },
      { cle: 'RGPD_RETENTION_MOIS', valeur: '36' },
      { cle: 'PURGE_CODES_JOURS', valeur: '30' },
    ]);
    apiMock.getTeam.mockResolvedValue([]);
    apiMock.setParams.mockResolvedValue({ ok: true });
  });

  async function ouvrirOnglet() {
    render(wrap(<ConfigPage />, ['/accueil/config']));
    fireEvent.click((await screen.findAllByRole('button', { name: /Mentions & RGPD/ }))[0]);
    await screen.findByRole('heading', { name: 'Identité de la boutique' });
  }

  it('édite les clés canoniques ; le téléphone met aussi à jour l’ancienne clé', async () => {
    await ouvrirOnglet();
    expect(screen.getByLabelText('Téléphone')).toHaveValue('04 79 60 89 22');
    fireEvent.change(screen.getByLabelText('Téléphone'), { target: { value: '04 00 00 00 00' } });
    fireEvent.change(screen.getByLabelText('SIRET (14 chiffres)'), { target: { value: '73282932000074' } });
    expect(screen.getByText(/^SIRET : 73282932000074/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /^Enregistrer$/ }).at(-1));
    await waitFor(() => expect(apiMock.setParams).toHaveBeenCalled());
    const envoyes = Object.fromEntries(apiMock.setParams.mock.calls[0][0].map(p => [p.cle, p.valeur]));
    expect(envoyes).toEqual({ BOUTIQUE_TEL: '04 00 00 00 00', telephone: '04 00 00 00 00', BOUTIQUE_SIRET: '73282932000074' });
  });

  it('une durée invalide bloque l’enregistrement', async () => {
    await ouvrirOnglet();
    fireEvent.change(screen.getByLabelText('Garantie des réparations (mois)'), { target: { value: '500' } });
    expect(screen.getByText(/La garantie doit être un nombre entier entre 0 et 120/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /^Enregistrer$/ }).at(-1));
    await new Promise(r => setTimeout(r, 0));
    expect(apiMock.setParams).not.toHaveBeenCalled();
  });

  it('rétention : aperçu des comptes puis application après confirmation', async () => {
    apiMock.rgpdRetentionApercu.mockResolvedValue({ clients_a_anonymiser: 3, codes_a_purger: 5 });
    apiMock.rgpdRetentionAppliquer.mockResolvedValue({ clients_anonymises: 3, codes_purges: 5 });
    await ouvrirOnglet();
    expect(screen.getByRole('link', { name: /Voir la politique de confidentialité/ })).toHaveAttribute('href', '/confidentialite');
    fireEvent.click(screen.getByRole('button', { name: /Calculer l'aperçu/ }));
    expect(await screen.findByText(/client.* à anonymiser/)).toHaveTextContent('3 clients à anonymiser, 5 codes de déverrouillage à effacer');
    expect(apiMock.rgpdRetentionAppliquer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Appliquer…/ }));
    expect(screen.getByText('Anonymiser 3 clients et effacer 5 codes ?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Confirmer l'anonymisation/ }));
    await waitFor(() => expect(apiMock.rgpdRetentionAppliquer).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Fait : 3 clients anonymisés/)).toBeInTheDocument();
  });

  it('rien à faire : pas de bouton Appliquer', async () => {
    apiMock.rgpdRetentionApercu.mockResolvedValue({ clients_a_anonymiser: 0, codes_a_purger: 0 });
    await ouvrirOnglet();
    fireEvent.click(screen.getByRole('button', { name: /Calculer l'aperçu/ }));
    expect(await screen.findByText(/Rien à faire/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Appliquer…/ })).not.toBeInTheDocument();
  });
});

// ─── File atelier ────────────────────────────────────────────────
describe('File atelier : badges de priorité', () => {
  it('affiche la priorité et place le client sur place en tête', async () => {
    apiMock.getRepairQueue.mockResolvedValue([
      { id: 1, ticket_code: 'KP-1', statut: 'En attente de diagnostic', client_nom: 'Normal', priorite: 'normal' },
      { id: 2, ticket_code: 'KP-2', statut: 'En attente de diagnostic', client_nom: 'Surplace', priorite: 'attente' },
    ]);
    render(wrap(<RepairQueue open inline basePath="/accueil" user={auth.user} onClose={() => {}} />));
    const items = await screen.findAllByRole('button', { name: /KP-/ });
    expect(items[0]).toHaveTextContent('KP-2');
    expect(items[0]).toHaveTextContent('Attend sur place');
    expect(items[1]).not.toHaveTextContent('Priorité');
  });
});

// ─── Dashboard ───────────────────────────────────────────────────
describe('Dashboard : priorité et réception', () => {
  const ligne = (id, extra) => ({
    id, ticket_code: `KP-00000${id}`, statut: 'En attente de diagnostic', categorie: 'Smartphone',
    client_nom: `Client${id}`, client_prenom: '', client_tel: '0612345679', marque: 'Apple', modele: 'iPhone 13',
    panne: 'Écran', date_depot: `2026-10-1${id} 09:00:00`, priorite: 'normal', reception_complete: true, ...extra,
  });
  beforeEach(() => {
    apiMock.getDashboard.mockResolvedValue({
      kpi: {}, total: 3,
      tickets: [
        ligne(1, { reception_complete: false }),
        ligne(2, { priorite: 'attente' }),
        ligne(3, { priorite: 'express' }),
      ],
    });
    apiMock.getActiveTeam.mockResolvedValue([]);
    apiMock.getInteractions.mockResolvedValue({});
    apiMock.getClients.mockResolvedValue([]);
    apiMock.getParts.mockResolvedValue([]);
  });

  const codesAffiches = () => [...document.querySelectorAll('[data-ticket-link]')].map(a => a.textContent);

  it('badges, compteur « sur place », filtre et tri par priorité', async () => {
    render(wrap(<DashboardPage />, ['/accueil']));
    await screen.findByText('KP-000001');
    expect(screen.getByText('Réception à compléter')).toBeInTheDocument();
    expect(screen.getAllByText('Réception à compléter')).toHaveLength(1);
    expect(screen.getByTitle('Priorité : Client attend sur place')).toHaveTextContent('Attend sur place');
    expect(screen.getByTitle('Priorité : Express')).toBeInTheDocument();
    expect(screen.queryByTitle('Priorité : Normal')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Priorité' }));
    expect(codesAffiches()).toEqual(['KP-000002', 'KP-000003', 'KP-000001']);

    const chip = screen.getByRole('button', { name: /1 client sur place/ });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(codesAffiches()).toEqual(['KP-000002']);

    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrer par priorité atelier' }), { target: { value: 'express' } });
    expect(codesAffiches()).toEqual(['KP-000003']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrer par priorité atelier' }), { target: { value: '' } });
    expect(codesAffiches()).toHaveLength(3);
  });
});
