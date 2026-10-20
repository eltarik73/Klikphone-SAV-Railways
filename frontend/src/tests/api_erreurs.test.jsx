/**
 * Vague C2 : erreurs HTTP lisibles (detail objet {code, message}, texte, tableau 422) avec
 * status, code et detail exposés ; verrouillage admin de la Navbar (jeton d'élévation effacé).
 * Check-up lot 3 : export clients avec X-Admin-Token, verrouillage côté serveur (POST /api/admin/lock),
 * mode admin suivi par AdminGuard, un seul GET /api/config, méthodes mortes retirées, boutons nommés.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api, formatErrorDetail, httpError } from '../lib/api';
import { AdminGuard } from '../App';
import AvisGoogle from '../pages/AvisGoogle';
import AdminPage from '../pages/AdminPage';
import { ToastProvider } from '../components/Toast';
import { clearCache } from '../hooks/useApi';

const { auth } = vi.hoisted(() => ({
  auth: { user: { target: 'accueil', utilisateur: 'Sophie', role: 'accueil' }, logout: () => {} },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));

import Navbar from '../components/Navbar';

const jsonRes = (data, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': 'application/json', ...headers }),
  json: () => Promise.resolve(data),
});
const errRes = (status, detail, headers) => jsonRes(detail === undefined ? {} : { detail }, status, headers);
const fakeJwt = (expSec) => `x.${btoa(JSON.stringify({ exp: expSec })).replace(/=+$/, '')}.y`;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  api.setToken('session');
  api.clearAdminToken();
  api._cache.clear();
  window.location.href = '';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const echec = (promise) => promise.then(() => { throw new Error('aurait dû échouer'); }, (e) => e);

describe('api : erreurs métier 409 (detail objet)', () => {
  it('restitution refusée : message du serveur, status, code et detail', async () => {
    global.fetch = vi.fn().mockResolvedValue(errRes(409, { code: 'reste_a_payer', message: 'Il reste 20,00 € à payer.', reste: 20 }));
    const err = await echec(api.restitution(7, { paiement: 'deja_paye' }));
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Il reste 20,00 € à payer.');
    expect(err).toMatchObject({ status: 409, code: 'reste_a_payer', detail: { reste: 20 } });
    expect(err.data).toBe(err.detail);
  });

  it('PATCH /statut vers « Clôturé » refusé : code utiliser_restitution', async () => {
    global.fetch = vi.fn().mockResolvedValue(errRes(409, {
      code: 'utiliser_restitution', message: 'Ticket non payé (reste 20,00 €) : passez par la restitution.', reste: 20,
    }));
    const err = await echec(api.changeStatus(7, 'Clôturé'));
    expect(err.code).toBe('utiliser_restitution');
    expect(err.message).toBe('Ticket non payé (reste 20,00 €) : passez par la restitution.');
    expect(String(err)).not.toContain('[object Object]');
  });

  it('caisse : vente déjà envoyée (409 deja_envoye) avec sa date', async () => {
    global.fetch = vi.fn().mockResolvedValue(errRes(409, {
      code: 'deja_envoye', message: 'Vente déjà envoyée en caisse le 15/10 à 14:32.', date: '2026-10-15T14:32:00+02:00',
    }));
    const err = await echec(api.envoyerCaisse({ ticket_id: 7 }));
    expect(err.message).toBe('Vente déjà envoyée en caisse le 15/10 à 14:32.');
    expect(err.code).toBe('deja_envoye');
    expect(err.detail.date).toBe('2026-10-15T14:32:00+02:00');
  });

  it('detail objet sans message : statut et code, jamais « [object Object] »', async () => {
    global.fetch = vi.fn().mockResolvedValue(errRes(409, { code: 'envoi_en_cours' }));
    const err = await echec(api.post('/api/caisse/envoyer', {}));
    expect(err.message).toBe('Erreur 409 (envoi_en_cours)');
  });
});

describe('api : 403, 422, 429', () => {
  it('403 d’élévation : message lisible, code admin_required, code serveur conservé', async () => {
    global.fetch = vi.fn().mockResolvedValue(errRes(403, { code: 'admin_requis', message: 'Élévation administrateur requise pour cette action.' }));
    const err = await echec(api.deleteTicket(3));
    expect(err.message).toBe('Élévation administrateur requise pour cette action.');
    expect(err).toMatchObject({ status: 403, code: 'admin_required', adminCode: 'admin_requis', detail: { code: 'admin_requis' } });
    expect(api.token).toBe('session');
  });

  it('403 du suivi public (detail.code) : code exposé, pas de déconnexion', async () => {
    global.fetch = vi.fn().mockResolvedValue(errRes(403, { code: 'verification_echouee', message: 'Les 4 chiffres ne correspondent pas.' }));
    const err = await echec(api.suiviValiderDevis('KP-000001', true, { tel4: '0000' }));
    expect(err).toMatchObject({ status: 403, code: 'verification_echouee', message: 'Les 4 chiffres ne correspondent pas.' });
    expect(api.token).toBe('session');
  });

  it('422 Pydantic : résumé du tableau, detail = tableau, pas de code', async () => {
    global.fetch = vi.fn().mockResolvedValue(errRes(422, [
      { loc: ['body', 'lignes', 0, 'prix'], msg: 'Input should be a valid number', type: 'float_parsing' },
      { loc: ['body', 'telephone'], msg: 'Field required', type: 'missing' },
    ]));
    const err = await echec(api.post('/api/tickets', {}));
    expect(err.message).toBe('Données invalides — lignes.prix : nombre attendu ; telephone : champ obligatoire');
    expect(Array.isArray(err.detail)).toBe(true);
    expect(err.code).toBeUndefined();
  });

  it('422 métier (detail objet) : message du serveur', async () => {
    global.fetch = vi.fn().mockResolvedValue(errRes(422, { code: 'mode_requis', message: 'Indiquez le mode de paiement (CB, espèces…).', reste: 20 }));
    const err = await echec(api.restitution(7, { paiement: 'encaisser' }));
    expect(err).toMatchObject({ status: 422, code: 'mode_requis', message: 'Indiquez le mode de paiement (CB, espèces…).' });
  });

  it('429 anti brute-force : message du serveur et délai Retry-After', async () => {
    global.fetch = vi.fn().mockResolvedValue(errRes(429, 'Trop d\'essais incorrects. Réessayez dans 30 s.', { 'Retry-After': '30' }));
    const err = await echec(api.verifyAdmin('admin', 'faux'));
    expect(err).toMatchObject({ status: 429, retryAfter: 30, message: 'Trop d\'essais incorrects. Réessayez dans 30 s.' });
    expect(err.code).toBeUndefined();
    expect(api.token).toBe('session');
  });
});

describe('api : documents (fetch brut)', () => {
  it('impression refusée : message lisible et status, texte inchangé', async () => {
    global.fetch = vi.fn().mockResolvedValue(errRes(403, { code: 'interdit', message: 'Document réservé au personnel.' }));
    const err = await echec(api.getPrintHtml(7, 'client'));
    expect(err).toMatchObject({ status: 403, code: 'interdit', message: 'Document réservé au personnel.' });

    global.fetch = vi.fn().mockResolvedValue(errRes(404, 'Ticket non trouvé'));
    expect((await echec(api.getPrintHtml(7, 'client'))).message).toBe('Ticket non trouvé');
    global.fetch = vi.fn().mockResolvedValue(errRes(404));
    expect((await echec(api.getPdfBlob(7, 'devis'))).message).toBe('Erreur 404');
  });

  it('export de fichier en échec : message du serveur', async () => {
    global.fetch = vi.fn().mockResolvedValue(errRes(500, 'Internal server error'));
    const err = await echec(api.exportClientsCsv());
    expect(err).toMatchObject({ status: 500, message: 'Internal server error' });
  });

  it('export clients : jeton d’élévation envoyé (X-Admin-Token), comme pour request()', async () => {
    const jeton = fakeJwt(Math.floor(Date.now() / 1000) + 600);
    api.setAdminToken(jeton);
    const createUrl = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), blob: () => Promise.resolve(new Blob(['x'])) });
    await api.exportClientsCsv();
    await api.exportClientsExcel();
    const [[url1, opts1], [url2, opts2]] = global.fetch.mock.calls;
    expect(url1).toBe('/api/clients/export/csv');
    expect(url2).toBe('/api/clients/export/excel');
    for (const o of [opts1, opts2]) {
      expect(o.headers).toMatchObject({ Authorization: 'Bearer session', 'X-Admin-Token': jeton });
    }
    expect(createUrl).toHaveBeenCalledTimes(2);
  });

  it('export clients refusé faute d’élévation : code admin_required (useAdminElevation peut redemander le code)', async () => {
    global.fetch = vi.fn().mockResolvedValue(errRes(403, { code: 'admin_requis', message: 'Élévation administrateur requise pour cette action.' }));
    const err = await echec(api.exportClientsCsv());
    expect(err).toMatchObject({ status: 403, code: 'admin_required', adminCode: 'admin_requis' });
    expect(global.fetch.mock.calls[0][1].headers['X-Admin-Token']).toBeUndefined();
    expect(api.token).toBe('session');
  });
});

describe('api : mode admin, lectures partagées, méthodes', () => {
  it('lockAdmin : POST /api/admin/lock avec la session, jeton et mode oubliés même hors réseau', async () => {
    localStorage.setItem('klikphone_admin', 'true');
    localStorage.setItem('kp_admin_auth', JSON.stringify({ ts: 1 }));
    api.setAdminToken(fakeJwt(Math.floor(Date.now() / 1000) + 600));
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const ecoute = vi.fn();
    window.addEventListener('kp-admin-mode', ecoute);
    await api.lockAdmin();
    window.removeEventListener('kp-admin-mode', ecoute);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/admin/lock');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer session');
    expect(global.fetch).toHaveBeenCalledTimes(1);   // jamais relancé
    expect(api.hasAdminToken()).toBe(false);
    expect(localStorage.getItem('klikphone_admin')).toBeNull();
    expect(localStorage.getItem('kp_admin_auth')).toBeNull();
    expect(ecoute).toHaveBeenCalledWith(expect.objectContaining({ detail: { admin: false } }));
  });

  it('GET /api/config : une seule requête quand getCached (page) et get (barre latérale) se croisent', async () => {
    let resoudre;
    global.fetch = vi.fn(() => new Promise((r) => { resoudre = () => r(jsonRes({ MODULE_DEVIS_VISIBLE: 'true' })); }));
    const a = api.getCached('/api/config', 5 * 60_000);
    const b = api.getConfig();
    resoudre();
    expect(await a).toEqual({ MODULE_DEVIS_VISIBLE: 'true' });
    expect(await b).toEqual({ MODULE_DEVIS_VISIBLE: 'true' });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    api._cache.clear();
    global.fetch = vi.fn(() => new Promise((r) => { resoudre = () => r(jsonRes({ ordre: 'inverse' })); }));
    const c = api.getConfig();
    const d = api.getCached('/api/config', 5 * 60_000);
    resoudre();
    expect(await c).toEqual({ ordre: 'inverse' });
    expect(await d).toEqual({ ordre: 'inverse' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    // La réponse partagée sert ensuite le cache mémoire
    expect(await api.getCached('/api/config', 5 * 60_000)).toEqual({ ordre: 'inverse' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('méthode de calcul lue sur la route du personnel ; adminLogin et getSuiviPublic retirés (routes mortes)', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonRes({ admin: false, texte: 'x', regles: null, exemple: null }));
    await api.getMethodeCalcul();
    expect(global.fetch.mock.calls[0][0]).toBe('/api/tarifs/methode-calcul');
    expect(api.adminLogin).toBeUndefined();
    expect(api.getSuiviPublic).toBeUndefined();
  });
});

describe('AdminGuard : suit le mode admin sans rechargement', () => {
  it('code saisi depuis « Accès restreint » : la page s’ouvre ; verrouillage : elle se referme', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonRes({ success: true }));
    render(
      <MemoryRouter initialEntries={['/accueil/config']}>
        <AdminGuard><p>Page protégée</p></AdminGuard>
      </MemoryRouter>,
    );
    expect(screen.getByText('Accès restreint')).toBeInTheDocument();
    act(() => { api.setAdminMode(true); });
    expect(await screen.findByText('Page protégée')).toBeInTheDocument();
    await act(async () => { await api.lockAdmin(); });
    expect(await screen.findByText('Accès restreint')).toBeInTheDocument();
  });
});

describe('Boutons icône nommés sur mobile', () => {
  it('Avis Google : « Synchroniser les avis », type button, icône masquée', async () => {
    clearCache();
    global.fetch = vi.fn().mockResolvedValue(jsonRes([]));
    render(<MemoryRouter><ToastProvider><AvisGoogle /></ToastProvider></MemoryRouter>);
    const bouton = await screen.findByRole('button', { name: 'Synchroniser les avis' });
    expect(bouton).toHaveAttribute('type', 'button');
    expect(bouton.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('Reporting : « Déconnexion » nommé, squelettes pendant la lecture, déconnexion = verrouillage serveur', async () => {
    clearCache();
    localStorage.setItem('klikphone_admin', 'true');
    let finir;
    global.fetch = vi.fn((url) => (String(url).startsWith('/api/admin/lock')
      ? Promise.resolve(jsonRes({ success: true }))
      : new Promise((r) => { finir = () => r(jsonRes({ kpis: [] })); })));
    const { container } = render(<MemoryRouter initialEntries={['/accueil/admin']}><AdminPage /></MemoryRouter>);
    const bouton = screen.getByRole('button', { name: 'Déconnexion' });
    expect(bouton).toHaveAttribute('type', 'button');
    // 8 cartes KPI + 3 cartes « vitrine » réservées : rien ne saute à l'arrivée des données
    expect(container.querySelectorAll('.skeleton-card')).toHaveLength(11);
    fireEvent.click(bouton);
    await waitFor(() => expect(global.fetch.mock.calls.some(([u, o]) => u === '/api/admin/lock' && o?.method === 'POST')).toBe(true));
    expect(localStorage.getItem('klikphone_admin')).toBeNull();
    finir?.();
  });
});

describe('formatErrorDetail / httpError : formes inattendues', () => {
  it('jamais « [object Object] »', () => {
    const formes = [
      { message: { fr: 'x' } }, { code: 'x', message: '' }, {}, [], [{}], [null], [42],
      [{ loc: ['body', { champ: 1 }], msg: { texte: 'non' } }], 42, true, null, undefined, '   ',
    ];
    for (const d of formes) {
      const msg = formatErrorDetail(d, 400);
      expect(typeof msg).toBe('string');
      expect(msg).not.toMatch(/object Object|undefined|null/);
      expect(msg.length).toBeGreaterThan(0);
    }
    expect(formatErrorDetail({ msg: 'Valeur hors limites' }, 400)).toBe('Valeur hors limites');
    expect(formatErrorDetail([{ loc: ['body', { x: 1 }], msg: 'Field required' }], 422)).toBe('Données invalides — champ obligatoire');
  });

  it('httpError expose status, code, detail ; Retry-After illisible ignoré', () => {
    const err = httpError(409, { code: 'non_termine', message: 'Pas terminé' }, new Headers({ 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' }));
    expect(err).toMatchObject({ status: 409, code: 'non_termine', message: 'Pas terminé' });
    expect(err.retryAfter).toBeUndefined();
    expect(httpError(500, undefined).detail).toBeNull();
  });
});

describe('Navbar : verrouiller le mode admin', () => {
  it('efface le jeton d’élévation et le mode admin', async () => {
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve(jsonRes([])));
    localStorage.setItem('klikphone_admin', 'true');
    api.setAdminToken(fakeJwt(Math.floor(Date.now() / 1000) + 600));
    expect(api.hasAdminToken()).toBe(true);
    render(
      <MemoryRouter initialEntries={['/accueil']}>
        <Navbar />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Verrouiller' }));
    // La preuve du code est aussi retirée côté serveur (sinon le poste garde les droits 30 jours)
    expect(global.fetch.mock.calls.some(([u, o]) => u === '/api/admin/lock' && o?.method === 'POST'
      && o.headers?.Authorization === 'Bearer session')).toBe(true);
    expect(api.hasAdminToken()).toBe(false);
    expect(sessionStorage.getItem('kp_admin_token')).toBeNull();
    expect(localStorage.getItem('klikphone_admin')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Verrouiller' })).not.toBeInTheDocument();
  });
});
