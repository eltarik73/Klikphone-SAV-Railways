/**
 * Mise à jour automatique (lib/miseAJour.js) : la borne en boucle ne recharge jamais d'elle-même, elle
 * gardait l'ancien code des jours. On compare le bundle chargé (/assets/index-XXXX.js) avec celui
 * qu'annonce le serveur ; la borne recharge à chaque retour après un dépôt et au repos (jamais pendant
 * une saisie), les écrans du personnel affichent un bandeau « Nouvelle version disponible ».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { auth, apiMock } = vi.hoisted(() => ({
  auth: { user: null },
  apiMock: {
    getPublicConfig: vi.fn(), getConfidentialite: vi.fn(), getCategories: vi.fn(), getPannes: vi.fn(),
    createOrGetClient: vi.fn(), createTicket: vi.fn(), getCached: vi.fn(),
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
import DepotPage from '../pages/DepotPage';
import HomePage from '../pages/HomePage';
import NouvelleVersion, { BandeauNouvelleVersion } from '../components/NouvelleVersion';
import {
  extraireBundle, versionActuelle, nouvelleVersionDisponible, rechargerSiNouvelleVersion,
  useVerificationVersion, formulaireIntact, oublierTentativeReussie,
} from '../lib/miseAJour';

// ─── Outils ───────────────────────────────────────────────────────
const MINUTE = 60 * 1000;

/** index.html tel que Vite le produit (bundle principal, préchargements, feuille de style). */
const htmlServeur = (nom) => `<!DOCTYPE html><html lang="fr"><head>
  <script type="module" crossorigin src="/assets/index-${nom}.js"></script>
  <link rel="modulepreload" crossorigin href="/assets/vendor-react-DHslCZ4Z.js">
  <link rel="stylesheet" crossorigin href="/assets/index-BLhosd32.css">
</head><body><div id="root"></div></body></html>`;

const reponse = (texte, ok = true) => ({ ok, status: ok ? 200 : 503, text: () => Promise.resolve(texte) });

/** Simule la page chargée avec le bundle `nom` (null : mode dev, /src/main.jsx). */
function pageChargeeAvec(nom) {
  document.querySelectorAll('script[data-test-bundle]').forEach((s) => s.remove());
  const s = document.createElement('script');
  s.type = 'module';
  s.setAttribute('src', nom ? `/assets/index-${nom}.js` : '/src/main.jsx');
  s.dataset.testBundle = '1';
  document.head.appendChild(s);
}

/** Le serveur annonce le bundle `nom`. */
function serveurAnnonce(nom) {
  const f = vi.fn(() => Promise.resolve(reponse(htmlServeur(nom))));
  vi.stubGlobal('fetch', f);
  return f;
}

let reload;
beforeEach(() => {
  clearCache();
  _oublierConfigPublique();
  sessionStorage.clear();
  localStorage.clear();
  auth.user = null;
  Object.values(apiMock).forEach((fn) => fn.mockReset?.());
  apiMock.getPublicConfig.mockResolvedValue({ BOUTIQUE_NOM: 'Klikphone Chambéry', PURGE_CODES_JOURS: '15' });
  apiMock.getConfidentialite.mockResolvedValue({ titre: 'Politique de confidentialité', sections: [] });
  apiMock.getCategories.mockResolvedValue(['Smartphone']);
  apiMock.getPannes.mockResolvedValue(['Écran cassé']);
  apiMock.createOrGetClient.mockResolvedValue({ id: 7 });
  apiMock.createTicket.mockResolvedValue({ id: 70, ticket_code: 'KP-000070' });
  reload = vi.fn();
  window.location.reload = reload;
  pageChargeeAvec('ANCIEN1');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.querySelectorAll('script[data-test-bundle]').forEach((s) => s.remove());
  delete window.location.reload;
});

// ─── Le module ────────────────────────────────────────────────────
describe('lib/miseAJour : nom du bundle et comparaison', () => {
  it('extrait le bundle principal du HTML de Vite (pas la feuille index-*.css ni les préchargements)', () => {
    expect(extraireBundle(htmlServeur('O9QZyeuJ'))).toBe('/assets/index-O9QZyeuJ.js');
    expect(extraireBundle('<script src="https://kp.example/assets/index-a_b-C9.js?v=2" type="module"></script>'))
      .toBe('/assets/index-a_b-C9.js');
    expect(extraireBundle('<script type="module" src="/src/main.jsx"></script>')).toBeNull();
    expect(extraireBundle('<link rel="stylesheet" href="/assets/index-BLhosd32.css">')).toBeNull();
    expect(extraireBundle('')).toBeNull();
    expect(extraireBundle(undefined)).toBeNull();
  });

  it('versionActuelle : le bundle chargé par la page, null en dev (/src/main.jsx)', () => {
    expect(versionActuelle()).toBe('/assets/index-ANCIEN1.js');
    pageChargeeAvec(null);
    expect(versionActuelle()).toBeNull();
  });

  it('nouvelle version = bundle annoncé différent, lu sans cache sur /', async () => {
    const f = serveurAnnonce('NOUVEAU2');
    await expect(nouvelleVersionDisponible()).resolves.toBe(true);
    expect(f).toHaveBeenCalledWith('/', expect.objectContaining({ cache: 'no-store' }));
    serveurAnnonce('ANCIEN1');
    await expect(nouvelleVersionDisponible()).resolves.toBe(false);
  });

  it('false en dev, sur erreur réseau, réponse en erreur ou HTML sans bundle (jamais d’exception)', async () => {
    pageChargeeAvec(null);
    const f = serveurAnnonce('NOUVEAU2');
    await expect(nouvelleVersionDisponible()).resolves.toBe(false);
    expect(f).not.toHaveBeenCalled(); // dev : aucune requête

    pageChargeeAvec('ANCIEN1');
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(nouvelleVersionDisponible()).resolves.toBe(false);
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('synchrone'); }));
    await expect(nouvelleVersionDisponible()).resolves.toBe(false);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(reponse(htmlServeur('NOUVEAU2'), false))));
    await expect(nouvelleVersionDisponible()).resolves.toBe(false);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(reponse('<html>Maintenance</html>'))));
    await expect(nouvelleVersionDisponible()).resolves.toBe(false);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.reject(new Error('coupé')) })));
    await expect(nouvelleVersionDisponible()).resolves.toBe(false);
    await expect(rechargerSiNouvelleVersion()).resolves.toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('rechargerSiNouvelleVersion recharge et renvoie true ; une seule tentative vers la même version', async () => {
    serveurAnnonce('ANCIEN1');
    await expect(rechargerSiNouvelleVersion()).resolves.toBe(false);
    expect(reload).not.toHaveBeenCalled();

    serveurAnnonce('NOUVEAU2');
    await expect(rechargerSiNouvelleVersion()).resolves.toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    // Rechargement resté sur l'ancien code (cache intermédiaire) : pas de boucle vers NOUVEAU2…
    await expect(rechargerSiNouvelleVersion()).resolves.toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    // … mais une version encore plus récente est tentée
    serveurAnnonce('NOUVEAU3');
    await expect(rechargerSiNouvelleVersion()).resolves.toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('rechargement réussi : la trace est oubliée au chargement, un retour arrière puis redéploiement recharge', async () => {
    serveurAnnonce('NOUVEAU2');
    await expect(rechargerSiNouvelleVersion()).resolves.toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    // La page repart sur NOUVEAU2 : le module, rechargé, efface la trace de la tentative
    pageChargeeAvec('NOUVEAU2');
    expect(oublierTentativeReussie()).toBe(true);
    expect(sessionStorage.getItem('kp_maj_recharge')).toBeNull();
    // Retour arrière du serveur sur ANCIEN1 (rechargement manuel), puis NOUVEAU2 redéployé dans l'heure
    pageChargeeAvec('ANCIEN1');
    expect(oublierTentativeReussie()).toBe(false);
    await expect(rechargerSiNouvelleVersion()).resolves.toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('rechargement resté sur l’ancien code : la trace est gardée au chargement (pause d’une heure)', async () => {
    serveurAnnonce('NOUVEAU2');
    await expect(rechargerSiNouvelleVersion()).resolves.toBe(true);
    // Toujours ANCIEN1 après le rechargement (cache intermédiaire) : rien n'est oublié
    expect(oublierTentativeReussie()).toBe(false);
    expect(sessionStorage.getItem('kp_maj_recharge')).not.toBeNull();
    await expect(rechargerSiNouvelleVersion()).resolves.toBe(false);
    // Passé l'heure, on retente
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61 * MINUTE);
    await expect(rechargerSiNouvelleVersion()).resolves.toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
    // Mode dev (aucun bundle) : rien n'est effacé
    pageChargeeAvec(null);
    expect(oublierTentativeReussie()).toBe(false);
  });

  it('formulaireIntact : valeurs de départ uniquement', () => {
    const initial = { nom: '', telephone: '', carte: false };
    expect(formulaireIntact({ ...initial }, initial)).toBe(true);
    expect(formulaireIntact({ ...initial, nom: 'D' }, initial)).toBe(false);
    expect(formulaireIntact({ ...initial, carte: true }, initial)).toBe(false);
    expect(formulaireIntact({ ...initial, extra: 'x' }, initial)).toBe(false);
    expect(formulaireIntact({ ...initial, extra: '' }, initial)).toBe(true);
  });
});

// ─── Borne /depot ─────────────────────────────────────────────────
const wrap = (ui, entries = ['/depot']) => (
  <MemoryRouter initialEntries={entries}>
    <SettingsProvider>
      <ToastProvider>{ui}</ToastProvider>
    </SettingsProvider>
  </MemoryRouter>
);
const suivant = () => fireEvent.click(screen.getByRole('button', { name: /Suivant/ }));

async function deposer() {
  render(wrap(<DepotPage />));
  fireEvent.change(screen.getByLabelText('Nom *'), { target: { value: 'Durand' } });
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
  expect(await screen.findByRole('heading', { name: 'Demande enregistrée !' })).toBeInTheDocument();
}

describe('Borne /depot : retour après un dépôt', () => {
  it('« Nouveau dépôt » avec une nouvelle version : la page se recharge au lieu de se remettre à zéro', async () => {
    await deposer();
    const f = serveurAnnonce('NOUVEAU2');
    fireEvent.click(screen.getByRole('button', { name: /Nouveau dépôt/ }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(f).toHaveBeenCalledWith('/', expect.objectContaining({ cache: 'no-store' }));
    // Pas de remise à zéro visible avant le rechargement (pas d'étape 1 qui clignote)
    expect(screen.getByRole('heading', { name: 'Demande enregistrée !' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nouveau dépôt/ })).toBeDisabled();
  });

  it('« Nouveau dépôt » sans nouvelle version (ou serveur injoignable) : remise à zéro habituelle', async () => {
    await deposer();
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    fireEvent.click(screen.getByRole('button', { name: /Nouveau dépôt/ }));
    expect(await screen.findByText('Étape 1 / 4')).toBeInTheDocument();
    expect(screen.getByLabelText('Nom *')).toHaveValue('');
    expect(reload).not.toHaveBeenCalled();
  });

  it('fin du compte à rebours de 10 s : vérification puis rechargement', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await deposer();
    serveurAnnonce('NOUVEAU2');
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText(/Retour automatique dans 5s/)).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('fin du compte à rebours, même version : retour à l’étape 1, pas de rechargement', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await deposer();
    serveurAnnonce('ANCIEN1');
    await act(async () => { await vi.advanceTimersByTimeAsync(11_000); });
    expect(await screen.findByText('Étape 1 / 4')).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('Borne /depot au repos : rechargement toutes les 10 min, jamais pendant une saisie', () => {
  it('étape 1 vide, personne depuis 2 min : vérifie au bout de 10 min et recharge', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = serveurAnnonce('NOUVEAU2');
    render(wrap(<DepotPage />));
    await act(async () => { await vi.advanceTimersByTimeAsync(9 * MINUTE); });
    expect(f).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1.5 * MINUTE); });
    expect(f).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('même version : une vérification par tranche de 10 min, pas de rechargement', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = serveurAnnonce('ANCIEN1');
    render(wrap(<DepotPage />));
    await act(async () => { await vi.advanceTimersByTimeAsync(31 * MINUTE); });
    expect(f).toHaveBeenCalledTimes(3);
    expect(reload).not.toHaveBeenCalled();
  });

  it('saisie en cours (nom tapé) : aucune vérification ; champ vidé puis 2 min de calme : rechargement', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = serveurAnnonce('NOUVEAU2');
    render(wrap(<DepotPage />));
    fireEvent.change(screen.getByLabelText('Nom *'), { target: { value: 'Dur' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * MINUTE); });
    expect(f).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Nom *')).toHaveValue('Dur');

    fireEvent.change(screen.getByLabelText('Nom *'), { target: { value: '' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1 * MINUTE); });
    expect(reload).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1.5 * MINUTE); });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('écran touché régulièrement (formulaire encore vide) : pas de rechargement tant qu’on s’en sert', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = serveurAnnonce('NOUVEAU2');
    render(wrap(<DepotPage />));
    for (let i = 0; i < 14; i += 1) {
      fireEvent.pointerDown(document.body);
      await act(async () => { await vi.advanceTimersByTimeAsync(MINUTE); });
    }
    expect(f).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2.5 * MINUTE); });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('autre étape que la première (client en cours) : jamais de rechargement', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = serveurAnnonce('NOUVEAU2');
    render(wrap(<DepotPage />));
    fireEvent.change(screen.getByLabelText('Nom *'), { target: { value: 'Durand' } });
    fireEvent.change(screen.getByLabelText('Votre numéro de téléphone (obligatoire)'), { target: { value: '0612345678' } });
    suivant();
    await screen.findByRole('button', { name: 'Smartphone' });
    await act(async () => { await vi.advanceTimersByTimeAsync(40 * MINUTE); });
    expect(f).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});

// ─── Page d'accueil « / » (la flèche retour de la borne y mène) ─────
describe('Page d’accueil « / » au repos : la borne laissée là se met à jour', () => {
  it('personne depuis 2 min : vérifie au bout de 10 min et recharge', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = serveurAnnonce('NOUVEAU2');
    render(<MemoryRouter initialEntries={['/']}><HomePage /></MemoryRouter>);
    expect(screen.getByRole('button', { name: /Déposer un appareil/ })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(9 * MINUTE); });
    expect(f).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1.5 * MINUTE); });
    expect(f).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('écran touché régulièrement : pas de rechargement tant qu’on s’en sert', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = serveurAnnonce('NOUVEAU2');
    render(<MemoryRouter initialEntries={['/']}><HomePage /></MemoryRouter>);
    for (let i = 0; i < 14; i += 1) {
      fireEvent.pointerDown(document.body);
      await act(async () => { await vi.advanceTimersByTimeAsync(MINUTE); });
    }
    expect(f).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});

// ─── Écrans du personnel ──────────────────────────────────────────
describe('Bandeau « Nouvelle version disponible » (écrans du personnel)', () => {
  const monter = (chemin) => render(
    <MemoryRouter initialEntries={[chemin]}><NouvelleVersion /></MemoryRouter>,
  );

  it('nouvelle version : bandeau role="status" + « Recharger », jamais de rechargement forcé', async () => {
    auth.user = { target: 'accueil', utilisateur: 'Sophie' };
    serveurAnnonce('NOUVEAU2');
    monter('/accueil');
    expect(await screen.findByText('Nouvelle version disponible')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Nouvelle version disponible');
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Recharger' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('fermable : le bandeau disparaît et ne revient pas', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    auth.user = { target: 'tech', utilisateur: 'Karim' };
    const f = serveurAnnonce('NOUVEAU2');
    monter('/tech/ticket/12');
    await screen.findByText('Nouvelle version disponible');
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByText('Nouvelle version disponible')).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(40 * MINUTE); document.dispatchEvent(new Event('visibilitychange')); });
    expect(screen.queryByText('Nouvelle version disponible')).not.toBeInTheDocument();
    expect(f).toHaveBeenCalledTimes(1); // signalée une fois : plus de requêtes
  });

  it('même version : rien ; vérifié à nouveau à 15 min et au retour sur l’onglet', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    auth.user = { target: 'accueil', utilisateur: 'Sophie' };
    let f = serveurAnnonce('ANCIEN1');
    monter('/accueil');
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Nouvelle version disponible')).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(15 * MINUTE); });
    expect(f).toHaveBeenCalledTimes(2);
    // Retour sur l'onglet : nouvelle lecture (30 s mini entre deux)
    f = serveurAnnonce('NOUVEAU2');
    await act(async () => { await vi.advanceTimersByTimeAsync(MINUTE); document.dispatchEvent(new Event('visibilitychange')); });
    expect(await screen.findByText('Nouvelle version disponible')).toBeInTheDocument();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('borne, pages publiques, personne non connectée : aucune vérification', async () => {
    const f = serveurAnnonce('NOUVEAU2');
    auth.user = { target: 'accueil', utilisateur: 'Sophie' };
    monter('/client');
    cleanup();
    monter('/depot');
    cleanup();
    auth.user = null;
    monter('/accueil');
    await act(async () => { await Promise.resolve(); });
    expect(f).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('useVerificationVersion : onNouvelle appelé une seule fois', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serveurAnnonce('NOUVEAU2');
    const onNouvelle = vi.fn();
    function Sonde() {
      useVerificationVersion({ intervalleMs: MINUTE, onNouvelle });
      return null;
    }
    render(<Sonde />);
    await waitFor(() => expect(onNouvelle).toHaveBeenCalledTimes(1));
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * MINUTE); document.dispatchEvent(new Event('visibilitychange')); });
    expect(onNouvelle).toHaveBeenCalledTimes(1);
  });

  it('BandeauNouvelleVersion inactif : rien affiché, rien demandé', async () => {
    const f = serveurAnnonce('NOUVEAU2');
    render(<BandeauNouvelleVersion actif={false} />);
    await act(async () => { await Promise.resolve(); });
    expect(f).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
