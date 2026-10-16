/**
 * Vague C2 (relecture) : le serveur exige le code admin pour chaque lignée de session
 * (auth.exiger_role_admin). Une connexion par PIN en ouvre une nouvelle : le mode admin de
 * l'interface est oublié, et les pages marketing redemandent le code sur un 403 admin_requis.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../lib/api';
import { clearCache } from '../hooks/useApi';
import { ToastProvider } from '../components/Toast';
import AvisGoogle from '../pages/AvisGoogle';
import CommunityManager from '../pages/CommunityManager';

const jsonRes = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: () => Promise.resolve(data),
});
const fakeJwt = (expSec) => `x.${btoa(JSON.stringify({ exp: expSec })).replace(/=+$/, '')}.y`;
const ADMIN_REQUIS = { code: 'admin_requis', message: 'Code admin requis sur ce poste : verrouillez le mode admin puis saisissez de nouveau le code admin.' };

// Routes marketing : 403 admin_requis tant que la requête ne porte pas de jeton d'élévation
function serveur(routes) {
  return vi.fn((url, opts = {}) => {
    const path = String(url).split('?')[0];
    const method = String(opts.method || 'GET').toUpperCase();
    if (path === '/api/admin/verify') {
      return Promise.resolve(jsonRes({ success: true, admin_token: fakeJwt(Math.floor(Date.now() / 1000) + 600), expires_in: 600 }));
    }
    if (path.startsWith('/api/marketing/') && !opts.headers?.['X-Admin-Token']) {
      return Promise.resolve(jsonRes({ detail: ADMIN_REQUIS }, 403));
    }
    const r = routes[`${method} ${path}`];
    return Promise.resolve(r ? r() : jsonRes([]));
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  api.setToken('session');
  api.clearAdminToken();
  api._cache.clear();
  clearCache();
  window.location.href = '';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('mode admin : propre à la lignée de session', () => {
  it('connexion par PIN : mode admin et élévation oubliés', async () => {
    localStorage.setItem('klikphone_admin', 'true');
    localStorage.setItem('kp_admin_auth', JSON.stringify({ ts: 1 }));
    api.setAdminToken(fakeJwt(Math.floor(Date.now() / 1000) + 600));
    global.fetch = vi.fn().mockResolvedValue(jsonRes({ access_token: 'nouvelle', target: 'accueil', utilisateur: 'Gérant' }));
    await api.login('1234', 'accueil', 'Gérant');
    expect(api.token).toBe('nouvelle');
    expect(localStorage.getItem('klikphone_admin')).toBeNull();
    expect(localStorage.getItem('kp_admin_auth')).toBeNull();
    expect(api.hasAdminToken()).toBe(false);
  });

  it('PIN refusé : la session et le mode admin en cours restent', async () => {
    localStorage.setItem('klikphone_admin', 'true');
    global.fetch = vi.fn().mockResolvedValue(jsonRes({ detail: 'PIN incorrect' }, 401));
    await expect(api.login('0000', 'accueil', 'Gérant')).rejects.toThrow('PIN incorrect');
    expect(api.token).toBe('session');
    expect(localStorage.getItem('klikphone_admin')).toBe('true');
  });

  it('déconnexion : mode admin oublié ; changement d’utilisateur (même lignée) : conservé', () => {
    localStorage.setItem('klikphone_admin', 'true');
    api.setToken('autre-utilisateur-meme-lignee');
    expect(localStorage.getItem('klikphone_admin')).toBe('true');
    api.logout();
    expect(localStorage.getItem('klikphone_admin')).toBeNull();
  });
});

function renderPage(Page) {
  return render(
    <MemoryRouter initialEntries={['/accueil']}>
      <ToastProvider><Page /></ToastProvider>
    </MemoryRouter>,
  );
}

async function saisirCodeAdmin() {
  const dialog = await screen.findByRole('dialog', { name: 'Accès Administrateur' });
  fireEvent.change(screen.getByLabelText('Identifiant'), { target: { value: 'admin' } });
  fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
  return dialog;
}

describe('pages marketing : 403 admin_requis → code admin demandé', () => {
  it('Avis Google : chargement refusé, code saisi, requêtes rejouées avec l’élévation', async () => {
    global.fetch = serveur({
      'GET /api/marketing/avis': () => jsonRes([{ id: 1, auteur: 'Léa M.', note: 5, texte: 'Top', repondu: false }]),
      'GET /api/marketing/avis/stats': () => jsonRes({ total: 1, note_moyenne: 5, non_repondus: 1, taux_reponse: 0 }),
    });
    renderPage(AvisGoogle);
    await saisirCodeAdmin();
    expect(await screen.findByText('1 avis · Note moyenne 5.0/5')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Accès Administrateur' })).not.toBeInTheDocument();
    const avis = global.fetch.mock.calls.filter(([u]) => String(u).startsWith('/api/marketing/avis'));
    expect(avis.at(-1)[1].headers['X-Admin-Token']).toBeTruthy();
  });

  it('Avis Google : code annulé → message et bouton Réessayer, jamais une page vide muette', async () => {
    global.fetch = serveur({});
    renderPage(AvisGoogle);
    fireEvent.click(await screen.findByRole('button', { name: 'Annuler' }));
    expect(await screen.findByText('Code admin requis pour afficher les avis.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it('Community Manager : action en échec → message du serveur affiché', async () => {
    api.setAdminToken(fakeJwt(Math.floor(Date.now() / 1000) + 600));
    global.fetch = serveur({
      'GET /api/marketing/posts': () => jsonRes([]),
      'POST /api/marketing/posts/generer': () => jsonRes({ detail: 'Clé ANTHROPIC_API_KEY absente' }, 500),
    });
    renderPage(CommunityManager);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText('Décrivez le contexte du post...'), { target: { value: 'Promo écran iPhone' } });
    fireEvent.click(screen.getByRole('button', { name: /Générer avec l'IA/ }));
    expect(await screen.findByText('Clé ANTHROPIC_API_KEY absente')).toBeInTheDocument();
  });
});
