/**
 * Vague C2 : erreurs HTTP lisibles (detail objet {code, message}, texte, tableau 422) avec
 * status, code et detail exposés ; verrouillage admin de la Navbar (jeton d'élévation effacé).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api, formatErrorDetail, httpError } from '../lib/api';

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
    expect(api.hasAdminToken()).toBe(false);
    expect(sessionStorage.getItem('kp_admin_token')).toBeNull();
    expect(localStorage.getItem('klikphone_admin')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Verrouiller' })).not.toBeInTheDocument();
  });
});
