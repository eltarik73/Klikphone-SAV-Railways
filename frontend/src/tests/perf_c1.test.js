/**
 * Vague C1 (performance / sécurité front) : déduplication des GET, politique de relance,
 * gestion des 401/403, messages 422, jeton d'élévation admin, preuve du suivi public,
 * polling en pause quand l'onglet est masqué, session conservée sur erreur réseau.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, useRef } from 'react';
import { renderHook, act, waitFor, render, fireEvent } from '@testing-library/react';
import { api, formatErrorDetail, isCredentialCheck, sendsAdminToken } from '../lib/api';
import { createPoller, usePolling } from '../hooks/usePolling';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useAdminElevation } from '../hooks/useAdminElevation';

const jsonRes = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: () => Promise.resolve(data),
});
const errRes = (status, detail) => ({
  ok: false,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: () => Promise.resolve(detail === undefined ? {} : { detail }),
});
// Refus d'élévation tel que renvoyé par auth._refus_admin
const refusAdmin = (code, message = 'Élévation administrateur requise pour cette action.') => errRes(403, { code, message });
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
// JWT factice (signature non vérifiée côté client)
const fakeJwt = (expSec) => `x.${btoa(JSON.stringify({ exp: expSec })).replace(/=+$/, '')}.y`;

let hidden = false;
const setHidden = (v) => {
  hidden = v;
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  api.setToken(null);
  api.clearAdminToken();
  api._cache.clear();
  window.location.href = '';
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('api.get : déduplication des requêtes en vol', () => {
  it('deux GET identiques simultanés ne font qu’une requête', async () => {
    const d = deferred();
    global.fetch = vi.fn().mockReturnValue(d.promise);
    const a = api.get('/api/tickets/stats/kpi');
    const b = api.get('/api/tickets/stats/kpi');
    expect(a).toBe(b);
    d.resolve(jsonRes({ total_actifs: 3 }));
    await expect(a).resolves.toEqual({ total_actifs: 3 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('une fois la réponse reçue, le GET suivant repart au serveur', async () => {
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve(jsonRes({ n: 1 })));
    await api.get('/api/suivi/dashboard/interactions');
    await api.get('/api/suivi/dashboard/interactions');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('une écriture entre deux lectures empêche le partage (la 2e voit son effet)', async () => {
    const d = deferred();
    global.fetch = vi.fn()
      .mockReturnValueOnce(d.promise)
      .mockImplementation(() => Promise.resolve(jsonRes({ ok: true })));
    const avant = api.get('/api/tickets/stats/dashboard');
    await api.patch('/api/tickets/5/statut', { statut: 'Pièce reçue' });
    const apres = api.get('/api/tickets/stats/dashboard');
    expect(apres).not.toBe(avant);
    d.resolve(jsonRes({ tickets: [] }));
    await Promise.all([avant, apres]);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('chemins différents : deux requêtes', async () => {
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve(jsonRes([])));
    await Promise.all([api.get('/api/a'), api.get('/api/b')]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('api.request : politique de relance', () => {
  beforeEach(() => vi.useFakeTimers());

  const run = async (promise) => {
    const settled = promise.then((v) => ({ v }), (e) => ({ e }));
    await vi.runAllTimersAsync();
    return settled;
  };

  it('GET relancé sur 503 puis réussi', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(errRes(503))
      .mockResolvedValueOnce(jsonRes({ ok: 1 }));
    const r = await run(api.request('/api/x'));
    expect(r.v).toEqual({ ok: 1 });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('GET relancé sur 502 et 504 (au plus 2 relances)', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(errRes(502))
      .mockResolvedValueOnce(errRes(504))
      .mockResolvedValueOnce(errRes(504, 'Passerelle indisponible'));
    const r = await run(api.request('/api/x'));
    expect(r.e.message).toBe('Passerelle indisponible');
    expect(r.e.status).toBe(504);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('GET jamais relancé sur 500', async () => {
    global.fetch = vi.fn().mockResolvedValue(errRes(500, 'Internal server error'));
    const r = await run(api.request('/api/x'));
    expect(r.e.status).toBe(500);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('GET relancé sur coupure réseau (TypeError)', async () => {
    global.fetch = vi.fn()
      .mockRejectedValueOnce(Object.assign(new TypeError('Failed to fetch')))
      .mockResolvedValueOnce(jsonRes({ ok: 1 }));
    const r = await run(api.request('/api/x'));
    expect(r.v).toEqual({ ok: 1 });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('GET jamais relancé sur timeout (le serveur continue de traiter)', async () => {
    global.fetch = vi.fn().mockImplementation((url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const r = await run(api.request('/api/config/backup', {}, 1000));
    expect(r.e.code).toBe('timeout');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('POST jamais relancé, même sur 503', async () => {
    global.fetch = vi.fn().mockResolvedValue(errRes(503));
    const r = await run(api.post('/api/tickets', { a: 1 }));
    expect(r.e.status).toBe(503);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries: 0 et appels de fond (background) : aucune relance', async () => {
    global.fetch = vi.fn().mockResolvedValue(errRes(503));
    const a = await run(api.request('/api/x', { retries: 0 }));
    expect(a.e.status).toBe(503);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const b = await run(api.background(() => api.get('/api/tickets/stats/kpi')));
    expect(b.e.status).toBe(503);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('l’option retries ne part pas dans fetch', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonRes({}));
    await run(api.request('/api/x', { retries: 0 }));
    expect(global.fetch.mock.calls[0][1]).not.toHaveProperty('retries');
  });

  it('export de sauvegarde : un seul appel, sans relance, délai long', async () => {
    global.fetch = vi.fn().mockResolvedValue(errRes(503));
    const r = await run(api.getBackup());
    expect(r.e.status).toBe(503);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('api : 401 / 403', () => {
  it('401 d’une vérification de code admin : pas de déconnexion', async () => {
    api.setToken('session');
    global.fetch = vi.fn().mockResolvedValue(errRes(401, 'Identifiants incorrects'));
    await expect(api.verifyAdmin('admin', 'faux')).rejects.toThrow('Identifiants incorrects');
    expect(api.token).toBe('session');
    expect(window.location.href).toBe('');
  });

  it('401 d’un PIN incorrect (connexion, changement de PIN) : pas de déconnexion', async () => {
    api.setToken('session');
    global.fetch = vi.fn().mockResolvedValue(errRes(401, 'Ancien PIN incorrect'));
    await expect(api.changePin('accueil', '0000', '1234')).rejects.toThrow('Ancien PIN incorrect');
    expect(api.token).toBe('session');
    expect(isCredentialCheck('/api/auth/login')).toBe(true);
    expect(isCredentialCheck('/api/tickets')).toBe(false);
  });

  it('401 d’une route ordinaire avec session : déconnexion', async () => {
    api.setToken('expire');
    global.fetch = vi.fn().mockResolvedValue(errRes(401, 'Token invalide ou expiré'));
    await expect(api.request('/api/tickets/1')).rejects.toThrow('Non authentifié');
    expect(api.token).toBeNull();
    expect(window.location.href).toBe('/');
  });

  it('401 sans session (page publique) : pas de redirection', async () => {
    global.fetch = vi.fn().mockResolvedValue(errRes(401, 'Non authentifié'));
    await expect(api.request('/api/x')).rejects.toMatchObject({ status: 401 });
    expect(window.location.href).toBe('');
  });

  it('401 d’une action publique du suivi (mauvais chiffres) : pas de déconnexion', async () => {
    api.setToken('session');
    global.fetch = vi.fn().mockResolvedValue(errRes(401, 'Vérification refusée'));
    await expect(api.suiviValiderDevis('KP-000001', true, { tel4: '1234' })).rejects.toMatchObject({ status: 401 });
    expect(api.token).toBe('session');
  });

  it('403 detail.code admin_requis : code admin_required, session conservée', async () => {
    api.setToken('session');
    global.fetch = vi.fn().mockResolvedValue(refusAdmin('admin_requis'));
    const err = await api.deleteClient(4).catch((e) => e);
    expect(err).toMatchObject({ code: 'admin_required', adminCode: 'admin_requis', status: 403 });
    expect(err.message).toBe('Élévation administrateur requise pour cette action.');
    expect(api.token).toBe('session');
  });

  it('403 « Admin requis » en texte (refus lié au rôle) : pas de redemande, jeton conservé', async () => {
    api.setToken('session');
    api.setAdminToken(fakeJwt(Math.floor(Date.now() / 1000) + 600));
    global.fetch = vi.fn().mockResolvedValue(errRes(403, 'Admin requis'));
    const err = await api.getAvisGoogleStats().catch((e) => e);
    expect(err.status).toBe(403);
    expect(err.code).toBeUndefined();
    expect(api.hasAdminToken()).toBe(true);
    expect(api.token).toBe('session');
  });

  it('detail texte d’un ancien serveur (« élévation ») : redemande sans effacer le jeton', async () => {
    api.setToken('session');
    api.setAdminToken(fakeJwt(Math.floor(Date.now() / 1000) + 600));
    global.fetch = vi.fn().mockResolvedValue(errRes(403, 'Élévation administrateur requise'));
    await expect(api.getBackup()).rejects.toMatchObject({ code: 'admin_required' });
    expect(api.hasAdminToken()).toBe(true);
  });

  it('403 « Code admin incorrect » : simple erreur (pas de redemande d’élévation)', async () => {
    api.setToken('session');
    global.fetch = vi.fn().mockResolvedValue(errRes(403, 'Code admin incorrect ou demande introuvable'));
    const err = await api.deleteDemandeCommande(3, 'x').catch((e) => e);
    expect(err.code).toBeUndefined();
    expect(err.message).toBe('Code admin incorrect ou demande introuvable');
  });
});

describe('api : jeton d’élévation admin', () => {
  it('verifyAdmin mémorise le jeton, envoyé ensuite en X-Admin-Token', async () => {
    api.setToken('session');
    const jwt = fakeJwt(Math.floor(Date.now() / 1000) + 600);
    global.fetch = vi.fn()
      .mockResolvedValueOnce(jsonRes({ ok: true, admin_token: jwt }))
      .mockResolvedValueOnce(jsonRes({ ok: true }));
    await api.verifyAdmin('admin', 'bon');
    expect(api.hasAdminToken()).toBe(true);
    await api.setParams([{ cle: 'NOM_BOUTIQUE', valeur: 'Test' }]);
    expect(global.fetch.mock.calls[1][1].headers['X-Admin-Token']).toBe(jwt);
    expect(JSON.parse(sessionStorage.getItem('kp_admin_token')).t).toBe(jwt);
  });

  it('jeton expiré : plus envoyé', async () => {
    api.setToken('session');
    api.setAdminToken(fakeJwt(Math.floor(Date.now() / 1000) - 5));
    expect(api.hasAdminToken()).toBe(false);
    global.fetch = vi.fn().mockResolvedValue(jsonRes({ ok: true }));
    await api.setParams([]);
    expect(global.fetch.mock.calls[0][1].headers['X-Admin-Token']).toBeUndefined();
  });

  it('403 admin_expire alors que le jeton était envoyé : jeton oublié, session conservée', async () => {
    api.setToken('session');
    api.setAdminToken(fakeJwt(Math.floor(Date.now() / 1000) + 600));
    global.fetch = vi.fn().mockResolvedValue(refusAdmin('admin_expire', 'Élévation administrateur expirée : identifiez-vous à nouveau.'));
    await expect(api.importBackup({ tables: {} })).rejects.toMatchObject({ code: 'admin_required', adminCode: 'admin_expire' });
    expect(api.hasAdminToken()).toBe(false);
    expect(api.token).toBe('session');
  });

  it('401 sans code d’élévation pendant l’élévation : session expirée → déconnexion', async () => {
    api.setToken('session');
    api.setAdminToken(fakeJwt(Math.floor(Date.now() / 1000) + 600));
    global.fetch = vi.fn().mockResolvedValue(errRes(401, 'Token invalide ou expiré'));
    await expect(api.importBackup({ tables: {} })).rejects.toThrow('Non authentifié');
    expect(api.token).toBeNull();
    expect(api.hasAdminToken()).toBe(false);
    expect(window.location.href).toBe('/');
  });

  it('jamais envoyé vers les routes publiques (suivi, code ticket, connexion)', async () => {
    api.setToken('session');
    const jwt = fakeJwt(Math.floor(Date.now() / 1000) + 600);
    api.setAdminToken(jwt);
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve(jsonRes({ ok: true })));
    await api.suiviValiderDevis('KP-000007', true, { tel4: '1234' });
    await api.getTicketByCode('KP-000007');
    await api.getInteractions();
    await api.deleteTicket(9);
    const sent = global.fetch.mock.calls.map((c) => c[1].headers['X-Admin-Token']);
    expect(sent).toEqual([undefined, undefined, jwt, jwt]);
    expect(sendsAdminToken('/api/auth/me')).toBe(false);
    expect(sendsAdminToken('/api/config/public')).toBe(false);
    expect(sendsAdminToken('/api/config/backup')).toBe(true);
  });

  it('changement de session : l’élévation ne suit pas', () => {
    api.setToken('a');
    api.setAdminToken(fakeJwt(Math.floor(Date.now() / 1000) + 600));
    api.setToken('a');
    expect(api.hasAdminToken()).toBe(true);
    api.setToken('b');
    expect(api.hasAdminToken()).toBe(false);
  });
});

describe('api : appels sans session (borne, dépôt)', () => {
  it('createOrGetClient n’envoie ni la session du poste ni l’élévation', async () => {
    api.setToken('session-du-comptoir');
    api.setAdminToken(fakeJwt(Math.floor(Date.now() / 1000) + 600));
    global.fetch = vi.fn().mockResolvedValue(jsonRes({ id: 12 }));
    await expect(api.createOrGetClient({ nom: 'Test', telephone: '0600000000' })).resolves.toEqual({ id: 12 });
    const headers = global.fetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBeUndefined();
    expect(headers['X-Admin-Token']).toBeUndefined();
    expect(global.fetch.mock.calls[0][1].auth).toBeUndefined();
  });

  it('un 401 d’un appel sans session ne déconnecte pas le poste', async () => {
    api.setToken('session-du-comptoir');
    global.fetch = vi.fn().mockResolvedValue(errRes(401, 'Non authentifié'));
    await expect(api.createOrGetClient({ nom: 'Test', telephone: '0600000000' })).rejects.toMatchObject({ status: 401 });
    expect(api.token).toBe('session-du-comptoir');
    expect(window.location.href).toBe('');
  });

  it('asStaff : la session part (fiche complète côté serveur)', async () => {
    api.setToken('session');
    global.fetch = vi.fn().mockResolvedValue(jsonRes({ id: 3, nom: 'Test' }));
    await api.createOrGetClient({ nom: 'Test', telephone: '0600000000' }, { asStaff: true });
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer session');
  });
});

describe('api.notifsFeed : liste + compteur en une requête', () => {
  it('lit X-Unread-Count, sinon compte les non lues de la liste', async () => {
    api.setToken('session');
    const list = [{ id: 3, is_read: false }, { id: 2, is_read: true }, { id: 1, is_read: false }];
    const withHeader = { ...jsonRes(list), headers: new Headers({ 'content-type': 'application/json', 'x-unread-count': '7' }) };
    global.fetch = vi.fn().mockResolvedValueOnce(withHeader).mockResolvedValueOnce(jsonRes(list));
    await expect(api.notifsFeed(30)).resolves.toEqual({ items: list, unread: 7 });
    await expect(api.notifsFeed(30)).resolves.toEqual({ items: list, unread: 2 });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][0]).toContain('/api/notifications-center?limit=30&unread_only=false');
  });
});

describe('api : messages d’erreur lisibles', () => {
  it('422 Pydantic (tableau) → texte lisible en français', async () => {
    global.fetch = vi.fn().mockResolvedValue(errRes(422, [
      { loc: ['body', 'telephone'], msg: 'Field required', type: 'missing' },
      { loc: ['body', 'nom'], msg: 'String should have at least 2 characters', type: 'string_too_short' },
    ]));
    const err = await api.post('/api/clients', {}).catch((e) => e);
    expect(err.status).toBe(422);
    expect(err.message).toBe('Données invalides — telephone : champ obligatoire ; nom : au moins 2 caractères');
    expect(Array.isArray(err.data)).toBe(true);
  });

  it('detail objet métier et detail absent', () => {
    expect(formatErrorDetail({ code: 'reste_a_payer', message: 'Reste 20 €' }, 409)).toBe('Reste 20 €');
    expect(formatErrorDetail(undefined, 500)).toBe('Erreur 500');
    expect(formatErrorDetail('Ticket introuvable', 404)).toBe('Ticket introuvable');
    expect(formatErrorDetail([{ loc: ['query', 'q'], msg: 'Value error, trop court' }], 422))
      .toBe('Données invalides — q : trop court');
  });
});

describe('api : preuve d’accès du suivi public', () => {
  it('jeton du lien (t) prioritaire, sinon numéro complet (tel) ; tel4 n’est plus envoyé', async () => {
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve(jsonRes({ ok: true })));
    await api.suiviValiderDevis('KP-000007', true, { t: 'jeton-aleatoire', tel: '0612345679' });
    await api.suiviSendMessage('KP-000007', 'Bonjour', { tel: '06 12 34 56 79' });
    await api.suiviLaisserAvis('KP-000007', 5, 'Top', { tel4: '5679' });
    await api.getTicketByCode('KP-000007', { tel: '+33 6 12 34 56 79' });
    await api.suiviHasAvis('KP-000007', { t: 'jeton-aleatoire' });
    const bodies = global.fetch.mock.calls.slice(0, 3).map((c) => JSON.parse(c[1].body));
    expect(bodies[0]).toEqual({ accepte: true, t: 'jeton-aleatoire' });
    expect(bodies[1]).toEqual({ message: 'Bonjour', tel: '0612345679' });
    expect(bodies[2]).toEqual({ note: 5, commentaire: 'Top' });
    expect(global.fetch.mock.calls[0][0]).not.toContain('jeton');
    // Lecture : le numéro (donnée personnelle) part en en-tête X-Suivi-Tel, jamais dans l'URL ; le jeton reste en query
    expect(global.fetch.mock.calls[3][0]).toBe('/api/tickets/code/KP-000007');
    expect(global.fetch.mock.calls[3][1].headers['X-Suivi-Tel']).toBe('+33612345679');
    expect(global.fetch.mock.calls[4][0]).toBe('/api/suivi/KP-000007/has-avis?t=jeton-aleatoire');
    expect(global.fetch.mock.calls[4][1].headers['X-Suivi-Tel']).toBeUndefined();
  });
});

describe('createPoller : pause quand l’onglet est masqué', () => {
  beforeEach(() => vi.useFakeTimers());

  it('appel immédiat, rythme régulier, aucune requête onglet masqué, reprise immédiate', async () => {
    const fn = vi.fn().mockResolvedValue();
    const p = createPoller(fn, 1000);
    p.start();
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fn).toHaveBeenCalledTimes(4);

    setHidden(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fn).toHaveBeenCalledTimes(4);

    setHidden(false);
    expect(fn).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(6);
    p.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).toHaveBeenCalledTimes(6);
  });

  it('retour sur l’onglet pendant qu’un tour est programmé : toujours une seule chaîne', async () => {
    const fn = vi.fn().mockResolvedValue();
    const p = createPoller(fn, 10_000);
    p.start();
    await vi.advanceTimersByTimeAsync(3000);
    // visibilitychange « visible » sans passage par « masqué » (ex. aperçu de l'onglet)
    setHidden(false);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fn).toHaveBeenCalledTimes(8);
    p.stop();
  });

  it('démarrage onglet masqué : rien tant qu’il reste masqué', async () => {
    hidden = true;
    const fn = vi.fn().mockResolvedValue();
    const p = createPoller(fn, 1000);
    p.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).not.toHaveBeenCalled();
    setHidden(false);
    expect(fn).toHaveBeenCalledTimes(1);
    p.stop();
  });

  it('pas de chevauchement : un appel lent retarde le suivant', async () => {
    let fin;
    const fn = vi.fn().mockImplementation(() => new Promise((r) => { fin = r; }));
    const p = createPoller(fn, 1000);
    p.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).toHaveBeenCalledTimes(1);
    fin();
    await vi.advanceTimersByTimeAsync(999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it('setDelay change le rythme (chat ouvert / fermé)', async () => {
    const fn = vi.fn().mockResolvedValue();
    const p = createPoller(fn, 30_000);
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    p.setDelay(10_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fn).toHaveBeenCalledTimes(2);
    p.setDelay(30_000);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fn).toHaveBeenCalledTimes(3);
    p.stop();
  });

  it('une erreur n’arrête pas le polling', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('down'));
    const p = createPoller(fn, 1000);
    p.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fn).toHaveBeenCalledTimes(3);
    p.stop();
  });
});

describe('usePolling (hook)', () => {
  beforeEach(() => vi.useFakeTimers());

  it('utilise la dernière fonction sans relancer la minuterie, s’arrête au démontage', async () => {
    const a = vi.fn().mockResolvedValue();
    const b = vi.fn().mockResolvedValue();
    const { rerender, unmount } = renderHook(({ fn }) => usePolling(fn, 1000), { initialProps: { fn: a } });
    expect(a).toHaveBeenCalledTimes(1);
    rerender({ fn: b });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    act(() => setHidden(true));
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(b).toHaveBeenCalledTimes(1);
    act(() => setHidden(false));
    expect(b).toHaveBeenCalledTimes(2);
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('enabled=false : aucun appel', async () => {
    const fn = vi.fn().mockResolvedValue();
    renderHook(() => usePolling(fn, 1000, { enabled: false }));
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('useAuth : session reprise sans attendre /api/auth/me', () => {
  const wrapper = ({ children }) => createElement(AuthProvider, null, children);
  const seed = () => {
    localStorage.setItem('kp_token', 'jeton-session');
    localStorage.setItem('kp_target', 'accueil');
    localStorage.setItem('kp_user', 'Test');
    localStorage.setItem('kp_role', 'manager');
    api.token = 'jeton-session';
  };

  it('utilisateur disponible dès le premier rendu', () => {
    seed();
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.loading).toBe(false);
    expect(result.current.user).toEqual({ target: 'accueil', utilisateur: 'Test', role: 'manager' });
  });

  it('erreur réseau ou 5xx sur /me : la session est conservée', async () => {
    seed();
    global.fetch = vi.fn().mockResolvedValue(errRes(500, 'Internal server error'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.user?.utilisateur).toBe('Test');
    expect(api.token).toBe('jeton-session');
    expect(window.location.href).toBe('');
  });

  it('401 sur /me : déconnexion', async () => {
    seed();
    global.fetch = vi.fn().mockResolvedValue(errRes(401, 'Token invalide ou expiré'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.user).toBeNull());
    expect(api.token).toBeNull();
  });

  it('rôle mis à jour en arrière-plan', async () => {
    seed();
    global.fetch = vi.fn().mockResolvedValue(jsonRes({ role: 'tech' }));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.user?.role).toBe('tech'));
  });
});

describe('useAdminElevation : action sensible rejouée après identification', () => {
  it('admin_required → fenêtre ouverte, action rejouée une fois après succès', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('Élévation requise'), { code: 'admin_required' }))
      .mockResolvedValueOnce('supprimé');
    const { result } = renderHook(() => useAdminElevation());
    expect(result.current.adminPrompt.props.open).toBe(false);
    let promise;
    act(() => { promise = result.current.sensible(fn); });
    await waitFor(() => expect(result.current.adminPrompt.props.open).toBe(true));
    act(() => result.current.adminPrompt.props.onSuccess());
    await expect(promise).resolves.toBe('supprimé');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(result.current.adminPrompt.props.open).toBe(false);
  });

  it('annulation : erreur admin_cancelled ; autre erreur : transmise telle quelle', async () => {
    const { result } = renderHook(() => useAdminElevation());
    let promise;
    act(() => { promise = result.current.sensible(() => Promise.reject(Object.assign(new Error('x'), { code: 'admin_required' }))); });
    await waitFor(() => expect(result.current.adminPrompt.props.open).toBe(true));
    act(() => result.current.adminPrompt.props.onClose());
    await expect(promise).rejects.toMatchObject({ code: 'admin_cancelled' });
    await expect(result.current.sensible(() => Promise.reject(new Error('Ce client a 2 ticket(s).'))))
      .rejects.toThrow('Ce client a 2 ticket(s).');
  });
});

describe('useFocusTrap : fenêtre modale au clavier', () => {
  function Modale({ open, onEscape }) {
    const ref = useRef(null);
    useFocusTrap(ref, open, { onEscape, initialFocus: '#second' });
    return createElement('div', null,
      createElement('button', { id: 'declencheur' }, 'Ouvrir'),
      open && createElement('div', { ref, role: 'dialog' },
        createElement('button', { id: 'premier' }, 'Premier'),
        createElement('input', { id: 'second' }),
        createElement('button', { id: 'dernier' }, 'Dernier')));
  }

  it('focus initial, Tab et Maj+Tab bouclent, Échap, retour du focus au déclencheur', () => {
    const onEscape = vi.fn();
    const { rerender } = render(createElement(Modale, { open: false, onEscape }));
    document.getElementById('declencheur').focus();
    rerender(createElement(Modale, { open: true, onEscape }));
    expect(document.activeElement.id).toBe('second');
    document.getElementById('dernier').focus();
    fireEvent.keyDown(document.activeElement, { key: 'Tab' });
    expect(document.activeElement.id).toBe('premier');
    fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey: true });
    expect(document.activeElement.id).toBe('dernier');
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
    rerender(createElement(Modale, { open: false, onEscape }));
    expect(document.activeElement.id).toBe('declencheur');
  });
});
