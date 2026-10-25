/**
 * Révocation des jetons (audit F) et onglets multiples sur un même poste.
 *
 * Après « Changer d'utilisateur » (Sophie → Léa) dans l'onglet A, l'onglet B resté ouvert garde en
 * mémoire l'ancien jeton : à sa prochaine requête le serveur répond 401 (session close). Ce 401 ne
 * doit jamais effacer la nouvelle session du poste (kp_token partagé par localStorage) : l'ApiClient
 * de B adopte le jeton du stockage et rejoue la requête une fois. Seul un 401 sur le jeton courant
 * du poste ferme la session (jeton oublié, retour à l'accueil). L'événement « storage » synchronise
 * en plus les onglets dès le changement.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fetchInitial = global.fetch;

const reponse = (data, status = 200) => ({
  ok: status < 300,
  status,
  headers: new Headers(status < 300 ? { 'content-type': 'application/json' } : {}),
  json: () => Promise.resolve(data),
  text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data)),
});

// Serveur simulé : une seule session valide à la fois (le jeton que le poste vient d'obtenir).
// Les en-têtes sont relevés à la réception (`vus`), jamais relus après coup dans mock.calls.
function serveur(jetonValide) {
  const vus = [];
  const fn = vi.fn().mockImplementation((_url, init) => {
    const auth = init?.headers?.Authorization || '';
    vus.push({ auth, admin: init?.headers?.['X-Admin-Token'], corps: init?.body });
    if (auth !== `Bearer ${jetonValide}`) {
      return Promise.resolve(reponse({ detail: 'Session terminée : reconnectez-vous.' }, 401));
    }
    return Promise.resolve(reponse({ ok: true, jeton: jetonValide }));
  });
  fn.vus = vus;
  return fn;
}

// Deux onglets = deux instances de l'ApiClient (module rechargé), un seul localStorage
async function deuxOnglets() {
  vi.resetModules();
  const A = (await import('../lib/api')).default;
  vi.resetModules();
  const B = (await import('../lib/api')).default;
  return { A, B };
}

const autorisations = () => global.fetch.vus.map((v) => v.auth);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.location.href = '';
  localStorage.setItem('kp_token', 'sophie');
});
afterEach(() => {
  global.fetch = fetchInitial;
  vi.restoreAllMocks();
});

describe('ApiClient — 401 sur un ancien jeton après un changement d’utilisateur ailleurs', () => {
  it('request : adopte le jeton du poste et rejoue une fois ; la nouvelle session n’est pas effacée', async () => {
    const { A, B } = await deuxOnglets();
    expect(A.token).toBe('sophie');
    expect(B.token).toBe('sophie');
    A.setToken('lea'); // switch-user dans l'onglet A
    global.fetch = serveur('lea');

    const data = await B.get('/api/parts');
    expect(data).toEqual({ ok: true, jeton: 'lea' });
    expect(autorisations()).toEqual(['Bearer sophie', 'Bearer lea']);
    expect(B.token).toBe('lea');
    expect(localStorage.getItem('kp_token')).toBe('lea');
    expect(A.token).toBe('lea');
    expect(window.location.href).toBe('');
  });

  it('écriture (POST) : même rejeu, corps renvoyé à l’identique', async () => {
    const { A, B } = await deuxOnglets();
    A.setToken('lea');
    global.fetch = serveur('lea');
    await B.post('/api/tickets/42/notes', { contenu: 'Vitre reçue' });
    expect(autorisations()).toEqual(['Bearer sophie', 'Bearer lea']);
    const corps = global.fetch.vus.map((v) => v.corps);
    expect(corps).toEqual([JSON.stringify({ contenu: 'Vitre reçue' }), JSON.stringify({ contenu: 'Vitre reçue' })]);
  });

  it('l’élévation admin de l’ancienne session ne suit pas le rejeu', async () => {
    const { A, B } = await deuxOnglets();
    B.setAdminToken('elevation-sophie');
    A.setToken('lea');
    global.fetch = serveur('lea');
    await B.get('/api/parts');
    const enTetes = global.fetch.vus.map((v) => v.admin);
    expect(enTetes).toEqual(['elevation-sophie', undefined]);
    expect(B.hasAdminToken()).toBe(false);
  });

  it('401 sur le jeton courant du poste : session oubliée et retour à l’accueil (comportement inchangé)', async () => {
    const { B } = await deuxOnglets();
    global.fetch = serveur('quelqu-un-d-autre');
    await expect(B.get('/api/parts')).rejects.toThrow('Non authentifié');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(B.token).toBeNull();
    expect(localStorage.getItem('kp_token')).toBeNull();
    expect(window.location.href).toBe('/');
  });

  it('jeton rejoué lui aussi refusé : la session du poste est close pour de bon', async () => {
    const { A, B } = await deuxOnglets();
    A.setToken('lea');
    global.fetch = serveur('personne');
    await expect(B.get('/api/parts')).rejects.toThrow('Non authentifié');
    expect(autorisations()).toEqual(['Bearer sophie', 'Bearer lea']);
    expect(localStorage.getItem('kp_token')).toBeNull();
    expect(window.location.href).toBe('/');
  });

  it('appel sans session (borne, auth:false) : un 401 remonte tel quel, rien n’est rejoué ni effacé', async () => {
    const { B } = await deuxOnglets();
    global.fetch = serveur('lea');
    await expect(B.request('/api/tickets', { method: 'POST', body: '{}', auth: false })).rejects.toMatchObject({ status: 401 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('kp_token')).toBe('sophie');
    expect(window.location.href).toBe('');
  });

  it('requestRaw (impressions) : même rejeu, même garde', async () => {
    const { A, B } = await deuxOnglets();
    A.setToken('lea');
    global.fetch = serveur('lea');
    const texte = await B.requestRaw('/api/tickets/42/print/client');
    expect(JSON.parse(texte)).toEqual({ ok: true, jeton: 'lea' });
    expect(autorisations()).toEqual(['Bearer sophie', 'Bearer lea']);
    expect(localStorage.getItem('kp_token')).toBe('lea');
    expect(window.location.href).toBe('');

    global.fetch = serveur('personne');
    await expect(B.requestRaw('/api/tickets/42/print/client')).rejects.toThrow('Non authentifié');
    expect(localStorage.getItem('kp_token')).toBeNull();
    expect(window.location.href).toBe('/');
  });
});

describe('ApiClient — événement storage entre onglets', () => {
  const evenement = (newValue) => window.dispatchEvent(new StorageEvent('storage', { key: 'kp_token', newValue }));

  it('nouveau jeton posé par un autre onglet : adopté aussitôt, caches oubliés', async () => {
    const { B } = await deuxOnglets();
    global.fetch = serveur('sophie');
    await B.getCached('/api/config', 60_000);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    localStorage.setItem('kp_token', 'lea');
    evenement('lea');
    expect(B.token).toBe('lea');

    global.fetch = serveur('lea');
    const data = await B.getCached('/api/config', 60_000); // plus de cache : relu avec la nouvelle session
    expect(data).toEqual({ ok: true, jeton: 'lea' });
    expect(autorisations()).toEqual(['Bearer lea']);
  });

  it('déconnexion dans un autre onglet : le jeton n’est pas abandonné ici, c’est le prochain 401 qui ferme', async () => {
    const { B } = await deuxOnglets();
    localStorage.removeItem('kp_token');
    evenement(null);
    expect(B.token).toBe('sophie');

    global.fetch = serveur('personne');
    await expect(B.get('/api/parts')).rejects.toThrow('Non authentifié');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe('/');
  });

  it('une autre clé du stockage ne change rien', async () => {
    const { B } = await deuxOnglets();
    localStorage.setItem('kp_token', 'lea');
    window.dispatchEvent(new StorageEvent('storage', { key: 'kp_poste', newValue: 'Comptoir' }));
    expect(B.token).toBe('sophie');
  });
});
