/**
 * Check-up lot 3 — mode admin et navigation :
 * - « Verrouiller » : POST /api/admin/lock (api.lockAdmin) en plus de l'oubli local ;
 * - avis Google : interrogés seulement en mode admin, plus après un refus 403 ;
 * - badge « Commandes » = commandes de pièces en cours (pas les tickets actifs) ;
 * - mode admin annoncé par événement : la barre latérale suit un code saisi ailleurs ;
 * - demande de code admin en portail au-dessus de la confirmation d'anonymisation, focus gardé.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { auth, apiMock } = vi.hoisted(() => {
  const base = { background: (fn) => fn() };
  // Toute méthode non préparée par un test répond une liste vide
  const apiMock = new Proxy(base, {
    get(target, cle) {
      if (!(cle in target)) target[cle] = vi.fn().mockResolvedValue([]);
      return target[cle];
    },
  });
  return { auth: { user: { target: 'accueil', utilisateur: 'Nour', role: 'admin' }, logout: vi.fn() }, apiMock };
});

vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));
vi.mock('../components/NotificationCenter', () => ({ default: () => null }));

import Navbar from '../components/Navbar';
import AdminLoginModal, { ADMIN_MODE_EVENT, annoncerModeAdmin } from '../components/AdminLoginModal';
import ClientsPage from '../pages/ClientsPage';
import { ToastProvider } from '../components/Toast';
import { clearCache } from '../hooks/useApi';

function resetApi() {
  for (const [k, fn] of Object.entries(apiMock)) {
    if (k !== 'background' && typeof fn?.mockReset === 'function') fn.mockReset().mockResolvedValue([]);
  }
}

const renderNavbar = () => render(
  <MemoryRouter initialEntries={['/accueil']}>
    <Navbar />
  </MemoryRouter>,
);

// Retour sur l'onglet : usePolling relance un tour immédiatement
async function retourOnglet() {
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
}

beforeEach(() => {
  clearCache();
  resetApi();
  localStorage.clear();
  sessionStorage.clear();
  auth.user = { target: 'accueil', utilisateur: 'Nour', role: 'admin' };
  apiMock.getKPI.mockResolvedValue({ total_actifs: 36 });
  apiMock.getInteractions.mockResolvedValue({ total_actions: 0 });
  apiMock.countDemandesCommandesNouvelles.mockResolvedValue({ count: 0 });
  apiMock.getSantePrix.mockResolvedValue({ propositions_en_attente: 0 });
  apiMock.getConfig.mockResolvedValue({});
  apiMock.getParts.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);
  apiMock.getAvisGoogleStats.mockResolvedValue({ non_repondus: 2 });
  apiMock.hasAdminToken.mockReturnValue(false);
  apiMock.lockAdmin.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Navbar : verrouillage, badges, avis Google', () => {
  it('« Verrouiller » révoque aussi la preuve côté serveur (api.lockAdmin)', async () => {
    localStorage.setItem('klikphone_admin', 'true');
    renderNavbar();
    fireEvent.click(await screen.findByRole('button', { name: 'Verrouiller' }));
    expect(apiMock.lockAdmin).toHaveBeenCalledTimes(1);
    expect(apiMock.clearAdminToken).toHaveBeenCalled();
    expect(localStorage.getItem('klikphone_admin')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Verrouiller' })).not.toBeInTheDocument();
  });

  it('badge « Commandes » : commandes de pièces en cours, pas le nombre de tickets actifs', async () => {
    renderNavbar();
    const commandes = await screen.findByRole('button', { name: /^Commandes/ });
    await waitFor(() => expect(within(commandes).getByText('3')).toBeInTheDocument());
    expect(apiMock.getParts).toHaveBeenCalledWith({ statut: 'en_cours' });
    expect(within(commandes).queryByText('36')).not.toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /^Dashboard/ })).getByText('36')).toBeInTheDocument();
  });

  it('membre admin sans le code sur ce poste : aucun appel aux avis Google (403 assuré)', async () => {
    renderNavbar();
    await waitFor(() => expect(apiMock.getKPI).toHaveBeenCalled());
    await waitFor(() => expect(apiMock.getParts).toHaveBeenCalled());
    expect(apiMock.getAvisGoogleStats).not.toHaveBeenCalled();
  });

  it('mode admin mais preuve refusée (403) : plus d’appel jusqu’à la prochaine saisie du code', async () => {
    localStorage.setItem('klikphone_admin', 'true');
    apiMock.getAvisGoogleStats.mockRejectedValue(Object.assign(new Error('Code admin requis'), { status: 403, code: 'admin_required' }));
    let maintenant = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => maintenant);
    renderNavbar();
    await waitFor(() => expect(apiMock.getAvisGoogleStats).toHaveBeenCalledTimes(1));
    // 6 minutes plus tard (les avis sont relus toutes les 5 min) : toujours rien
    maintenant += 6 * 60_000;
    await retourOnglet();
    await waitFor(() => expect(apiMock.getKPI).toHaveBeenCalledTimes(2));
    expect(apiMock.getAvisGoogleStats).toHaveBeenCalledTimes(1);
    // Code saisi ailleurs (événement) : les avis sont de nouveau interrogés
    apiMock.getAvisGoogleStats.mockResolvedValue({ non_repondus: 4 });
    act(() => { annoncerModeAdmin(true); });
    maintenant += 6 * 60_000;
    await retourOnglet();
    await waitFor(() => expect(apiMock.getAvisGoogleStats).toHaveBeenCalledTimes(2));
  });

  it('mode admin annoncé par un autre écran : « Mode Admin » apparaît puis disparaît sans rechargement', async () => {
    renderNavbar();
    await screen.findByRole('button', { name: /^Clients/ });
    expect(screen.queryByRole('button', { name: 'Verrouiller' })).not.toBeInTheDocument();
    act(() => { annoncerModeAdmin(true); });
    expect(await screen.findByRole('button', { name: 'Verrouiller' })).toBeInTheDocument();
    expect(localStorage.getItem('klikphone_admin')).toBe('true');
    act(() => { window.dispatchEvent(new CustomEvent(ADMIN_MODE_EVENT, { detail: { admin: false } })); });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Verrouiller' })).not.toBeInTheDocument());
  });
});

describe('Demande de code admin : au-dessus des autres fenêtres', () => {
  it('rendue en portail en fin de <body>, z-[80], et annonce le mode admin après succès', async () => {
    apiMock.verifyAdmin.mockResolvedValue({ success: true, admin_token: 'jeton' });
    const onSuccess = vi.fn();
    const ecoute = vi.fn();
    window.addEventListener(ADMIN_MODE_EVENT, ecoute);
    try {
      const { container } = render(<div className="relative z-10"><AdminLoginModal open onClose={vi.fn()} onSuccess={onSuccess} /></div>);
      const dialog = screen.getByRole('dialog', { name: 'Accès Administrateur' });
      expect(container.contains(dialog)).toBe(false);
      expect(dialog.parentElement.parentElement).toBe(document.body);
      expect(dialog.parentElement).toHaveClass('z-[80]');
      fireEvent.change(screen.getByLabelText('Identifiant'), { target: { value: 'admin' } });
      fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'secret' } });
      fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
      await waitFor(() => expect(onSuccess).toHaveBeenCalled());
      expect(localStorage.getItem('klikphone_admin')).toBe('true');
      expect(ecoute).toHaveBeenCalledWith(expect.objectContaining({ detail: { admin: true } }));
    } finally {
      window.removeEventListener(ADMIN_MODE_EVENT, ecoute);
    }
  });

  it('anonymisation avec élévation expirée : le code se saisit par-dessus la confirmation, Tab y reste', async () => {
    const CLIENT = { id: 12, nom: 'Fictif', prenom: 'Léa', telephone: '0600000112', email: '' };
    apiMock.getClients.mockResolvedValue([CLIENT]);
    apiMock.getClient.mockResolvedValue(CLIENT);
    apiMock.getClientTickets.mockResolvedValue([]);
    apiMock.rgpdAnonymiser
      .mockRejectedValueOnce(Object.assign(new Error('Élévation administrateur expirée'), { status: 403, code: 'admin_required' }))
      .mockResolvedValueOnce({ ok: true });
    apiMock.verifyAdmin.mockResolvedValue({ success: true, admin_token: 'jeton' });
    render(
      <MemoryRouter initialEntries={['/accueil/clients?client=12']}>
        <ToastProvider><ClientsPage /></ToastProvider>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Anonymiser' }));
    const confirmation = await screen.findByRole('alertdialog', { name: /Anonymiser Léa Fictif/ });
    fireEvent.change(within(confirmation).getByLabelText(/Tapez ANONYMISER/), { target: { value: 'ANONYMISER' } });
    fireEvent.click(within(confirmation).getByRole('button', { name: /Anonymiser définitivement/ }));

    const code = await screen.findByRole('dialog', { name: 'Accès Administrateur' });
    // Au-dessus de la confirmation (z-60) : portail en fin de body, z-80
    expect(code.parentElement.parentElement).toBe(document.body);
    expect(code.parentElement).toHaveClass('z-[80]');
    expect(document.body.lastElementChild.contains(code)).toBe(true);
    const identifiant = within(code).getByLabelText('Identifiant');
    await waitFor(() => expect(document.activeElement).toBe(identifiant));
    // Tab : le piège de la confirmation (suspendu pendant l'envoi) ne reprend pas le focus
    fireEvent.keyDown(document.activeElement, { key: 'Tab' });
    expect(code.contains(document.activeElement)).toBe(true);

    fireEvent.change(identifiant, { target: { value: 'admin' } });
    fireEvent.change(within(code).getByLabelText('Mot de passe'), { target: { value: 'secret' } });
    fireEvent.click(within(code).getByRole('button', { name: 'Se connecter' }));
    await waitFor(() => expect(apiMock.rgpdAnonymiser).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('code annulé (Échap) : la confirmation reprend le focus', async () => {
    const CLIENT = { id: 12, nom: 'Fictif', prenom: 'Léa', telephone: '0600000112', email: '' };
    apiMock.getClients.mockResolvedValue([CLIENT]);
    apiMock.getClient.mockResolvedValue(CLIENT);
    apiMock.getClientTickets.mockResolvedValue([]);
    apiMock.rgpdAnonymiser.mockRejectedValue(Object.assign(new Error('Élévation requise'), { status: 403, code: 'admin_required' }));
    render(
      <MemoryRouter initialEntries={['/accueil/clients?client=12']}>
        <ToastProvider><ClientsPage /></ToastProvider>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Anonymiser' }));
    const confirmation = await screen.findByRole('alertdialog', { name: /Anonymiser Léa Fictif/ });
    fireEvent.change(within(confirmation).getByLabelText(/Tapez ANONYMISER/), { target: { value: 'ANONYMISER' } });
    fireEvent.click(within(confirmation).getByRole('button', { name: /Anonymiser définitivement/ }));
    const code = await screen.findByRole('dialog', { name: 'Accès Administrateur' });
    await waitFor(() => expect(document.activeElement).toBe(within(code).getByLabelText('Identifiant')));
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Accès Administrateur' })).not.toBeInTheDocument());
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(within(screen.getByRole('alertdialog')).getByLabelText(/Tapez ANONYMISER/)));
  });
});
