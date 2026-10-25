/**
 * Activité de l'équipe (journal des connexions + pointage de présence) :
 * - détection de l'appareil (type, marque, modèle, système, navigateur) et libellés ;
 * - côté salarié : aucune interface, une seule lecture de position par session, aucune lecture
 *   si le pointage est inactif ou hors des heures d'ouverture ;
 * - page admin : grille de la semaine, détail d'un jour (clic, clavier, Échap), réglages
 *   (remise de la note salarié par salarié, interrupteur bloqué selon la raison du serveur).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { apiMock } = vi.hoisted(() => {
  const base = { background: (fn) => fn() };
  const apiMock = new Proxy(base, {
    get(target, cle) {
      if (!(cle in target)) target[cle] = vi.fn().mockResolvedValue(null);
      return target[cle];
    },
  });
  return { apiMock };
});

vi.mock('../lib/api', () => ({ default: apiMock, api: apiMock }));
vi.mock('../components/AdminLoginModal', () => ({ default: () => null, ADMIN_MODE_EVENT: 'kp-admin-mode' }));
vi.mock('../components/NotificationCenter', () => ({ default: () => null }));

import {
  analyserAppareil, detecterAppareil, lancerPointage, clePointage, marqueDepuisModele,
} from '../lib/pointage';
import {
  libelleAppareil, libellePresence, formatMinutes, libelleSemaine, lundiDe, noteInformationHtml, NOTE_INFORMATION,
} from '../lib/activiteEquipe';
import * as pointage from '../lib/pointage';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import { useApi, clearCache } from '../hooks/useApi';
import Navbar from '../components/Navbar';
import ActiviteEquipePage, { modePour } from '../pages/ActiviteEquipePage';

// ─── Jeux d'essai ───────────────────────────────────────────────────────
const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  samsungReduit: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  samsungInternet: 'Mozilla/5.0 (Linux; Android 14; SM-A556B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0',
  tabletteAndroid: 'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

function jeton(claims) {
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.signature${Math.random().toString(36).slice(2)}`;
}

function geoMock(reponse = { coords: { latitude: 45.5646, longitude: 5.9178, accuracy: 18 } }) {
  return {
    getCurrentPosition: vi.fn((ok, ko) => {
      if (reponse?.code) ko(reponse);
      else ok(reponse);
    }),
    watchPosition: vi.fn(),
  };
}

const MARDI_14H_PARIS = new Date('2026-10-20T12:00:00Z');
const DIMANCHE_PARIS = new Date('2026-10-25T12:00:00Z');

const JOURS = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
const IPHONE = { type: 'iphone', marque: 'Apple', modele: null, systeme: 'iOS 18', navigateur: 'Safari' };
const PC = { type: 'ordinateur', marque: null, modele: null, systeme: 'Windows', navigateur: 'Chrome' };
const SAMSUNG = { type: 'smartphone', marque: 'Samsung', modele: 'SM-S918B', systeme: 'Android 14', navigateur: 'Chrome' };

function activite({ information_remise = true } = {}) {
  return {
    semaine: { debut: JOURS[0], fin: JOURS[6], jours: JOURS },
    information_remise,
    connectes: [
      { utilisateur: 'Nour', cible: 'accueil', poste: 'Comptoir', appareil: IPHONE, debut: '2026-10-20T08:02:00', derniere_activite: '2026-10-20T11:58:00', actions: 12, geo_statut: 'en_boutique', geo_distance_m: 50 },
      { utilisateur: 'Karim', cible: 'tech', poste: 'Atelier', appareil: SAMSUNG, debut: '2026-10-20T09:15:00', derniere_activite: '2026-10-20T11:50:00', actions: 4, geo_statut: 'hors_boutique', geo_distance_m: 2300 },
    ],
    salaries: [
      {
        utilisateur: 'Nour',
        jours: {
          '2026-10-19': { arrivee: '10:02', depart: '18:47', duree_min: 525, sessions: 3, actions: 54, tickets_crees: 6, appareils: [{ type: 'iphone', marque: 'Apple' }, { type: 'ordinateur', marque: null }], presence: { statut: 'en_boutique', distance_m: 50 }, en_cours: false },
          '2026-10-20': { arrivee: '10:02', depart: '13:58', duree_min: 236, sessions: 1, actions: 12, appareils: [{ type: 'iphone', marque: 'Apple' }], presence: { statut: 'en_boutique', distance_m: 50 }, en_cours: true },
        },
        total: { duree_min: 1935, jours: 2, actions: 66 },
      },
      {
        utilisateur: 'Karim',
        jours: {
          '2026-10-20': { arrivee: '11:15', depart: '13:50', duree_min: 155, sessions: 1, actions: 4, appareils: [{ type: 'smartphone', marque: 'Samsung' }], presence: { statut: 'hors_boutique', distance_m: 2300 }, en_cours: true },
        },
        total: { duree_min: 155, jours: 1, actions: 4 },
      },
      { utilisateur: 'Léa', jours: {}, total: { duree_min: 0, jours: 0, actions: 0 } },
    ],
  };
}

const SESSIONS_NOUR_LUNDI = [
  { debut: '10:02', fin: '12:30', fin_motif: 'changement', duree_min: 148, poste: 'Comptoir', appareil: IPHONE, actions: 23, geo_statut: 'en_boutique', geo_distance_m: 50 },
  { debut: '13:30', fin: '18:47', fin_motif: 'deconnexion', duree_min: 317, poste: 'Atelier', appareil: PC, actions: 31, geo_statut: 'hors_horaires', geo_distance_m: null },
];

function resetApi() {
  for (const [k, fn] of Object.entries(apiMock)) {
    if (k !== 'background' && typeof fn?.mockReset === 'function') fn.mockReset().mockResolvedValue(null);
  }
}

beforeEach(() => {
  resetApi();
  localStorage.clear();
  sessionStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MARDI_14H_PARIS);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete apiMock.token;
  delete navigator.geolocation;
  delete navigator.userAgentData;
});

// ─── 1. Détection de l'appareil ─────────────────────────────────────────
describe('Détection de l’appareil', () => {
  it('iPhone : type iphone, marque Apple, modèle inconnu (Safari ne le donne pas), iOS 18', () => {
    const a = analyserAppareil(UA.iphone);
    expect(a).toEqual({ type: 'iphone', marque: 'Apple', modele: null, systeme: 'iOS 18', navigateur: 'Safari' });
    expect(libelleAppareil(a)).toBe('iPhone · Apple · iOS 18');
  });

  it('Android Samsung : le modèle et la version viennent des indices client (UA réduit « Android 10; K »)', () => {
    const a = analyserAppareil(UA.samsungReduit, { model: 'SM-S918B', platform: 'Android', platformVersion: '14.0.0', mobile: true });
    expect(a).toEqual({ type: 'smartphone', marque: 'Samsung', modele: 'SM-S918B', systeme: 'Android 14', navigateur: 'Chrome' });
    expect(libelleAppareil(a)).toBe('Smartphone · Samsung SM-S918B (Galaxy S23 Ultra) · Android 14');
    // Sans indice : aucun faux modèle « K »
    expect(analyserAppareil(UA.samsungReduit).modele).toBeNull();
    expect(analyserAppareil(UA.samsungReduit).marque).toBeNull();
  });

  it('Samsung Internet : modèle lu dans le User-Agent ; tablette Android sans « Mobile »', () => {
    const a = analyserAppareil(UA.samsungInternet);
    expect(a).toMatchObject({ type: 'smartphone', marque: 'Samsung', modele: 'SM-A556B', systeme: 'Android 14', navigateur: 'Samsung Internet' });
    expect(analyserAppareil(UA.tabletteAndroid)).toMatchObject({ type: 'tablette', marque: 'Samsung', modele: 'SM-X710' });
  });

  it('ordinateurs : PC Windows (Chrome, Edge), Mac (Safari, Firefox), iPad qui se présente comme un Mac', () => {
    expect(libelleAppareil(analyserAppareil(UA.windows))).toBe('Ordinateur · PC Windows · Chrome');
    expect(analyserAppareil(UA.edge).navigateur).toBe('Edge');
    expect(analyserAppareil(UA.windows).marque).toBeNull();
    expect(libelleAppareil(analyserAppareil(UA.mac))).toBe('Ordinateur · Apple Mac · Safari');
    expect(analyserAppareil(UA.firefoxMac)).toMatchObject({ type: 'ordinateur', marque: 'Apple', systeme: 'macOS', navigateur: 'Firefox' });
    expect(analyserAppareil(UA.mac, null, { maxTouchPoints: 5 })).toMatchObject({ type: 'ipad', marque: 'Apple', systeme: 'iOS 18' });
    // Système renvoyé par le serveur avec sa version (« Windows 11 ») : toujours « PC Windows »
    expect(libelleAppareil({ type: 'ordinateur', marque: null, modele: null, systeme: 'Windows 11', navigateur: 'Edge' }))
      .toBe('Ordinateur · PC Windows · Edge');
    expect(libelleAppareil({ type: 'ordinateur', marque: null, modele: null, systeme: 'Windows 10', navigateur: null }))
      .toBe('Ordinateur · PC Windows');
  });

  it('marque déduite prudemment du code modèle', () => {
    expect(marqueDepuisModele('Pixel 8')).toBe('Google');
    expect(marqueDepuisModele('2201117TG')).toBe('Xiaomi');
    expect(marqueDepuisModele('Redmi Note 13')).toBe('Xiaomi');
    expect(marqueDepuisModele('CPH2581')).toBe('Oppo');
    expect(marqueDepuisModele('RMX3851')).toBe('Realme');
    expect(marqueDepuisModele('XT2343-2')).toBe('Motorola');
    expect(marqueDepuisModele('ABC123')).toBeNull();
    expect(analyserAppareil(UA.samsungReduit, { model: 'Pixel 8', platformVersion: '15', mobile: true }))
      .toMatchObject({ marque: 'Google', modele: 'Pixel 8', systeme: 'Android 15' });
  });

  it('detecterAppareil interroge getHighEntropyValues quand le navigateur le propose', async () => {
    const getHighEntropyValues = vi.fn().mockResolvedValue({ model: 'SM-S918B', platform: 'Android', platformVersion: '14.0.0', mobile: true });
    const a = await detecterAppareil({ userAgent: UA.samsungReduit, userAgentData: { getHighEntropyValues }, maxTouchPoints: 5 });
    expect(getHighEntropyValues).toHaveBeenCalledWith(['model', 'platform', 'platformVersion', 'mobile']);
    expect(a.modele).toBe('SM-S918B');
  });

  it('libellés de présence et de durées', () => {
    expect(libellePresence('en_boutique')).toBe('En boutique');
    expect(libellePresence('hors_boutique', 2300)).toBe('Hors boutique, à 2,3 km');
    expect(libellePresence('hors_boutique', 350)).toBe('Hors boutique, à 350 m');
    expect(libellePresence(null)).toBe('Pointage non fait');
    expect(formatMinutes(1935)).toBe('32 h 15');
    expect(formatMinutes(45)).toBe('45 min');
    expect(lundiDe('2026-10-25')).toBe('2026-10-19');
    expect(libelleSemaine('2026-10-19', '2026-10-25')).toBe('Semaine du 19 au 25 oct.');
    expect(libelleSemaine('2026-10-26', '2026-11-01')).toBe('Semaine du 26 oct. au 1 nov.');
  });
});

// ─── 2. Pointage côté salarié ───────────────────────────────────────────
describe('Pointage de présence côté salarié', () => {
  it('inactif : aucune lecture de position, aucun envoi', async () => {
    const geo = geoMock();
    apiMock.getPositionConfig.mockResolvedValue({ actif: false });
    expect(await lancerPointage(apiMock, jeton({ sub: 'Nour', sid: 's1' }), { geolocation: geo })).toBe('inactif');
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(apiMock.envoyerPosition).not.toHaveBeenCalled();
  });

  it('actif : UNE lecture (getCurrentPosition, jamais watchPosition) par session, puis plus rien', async () => {
    const geo = geoMock();
    apiMock.getPositionConfig.mockResolvedValue({ actif: true });
    apiMock.envoyerPosition.mockResolvedValue({ statut: 'en_boutique' });
    const t = jeton({ sub: 'Nour', sid: 's2' });
    expect(await lancerPointage(apiMock, t, { geolocation: geo })).toBe('envoye');
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(geo.getCurrentPosition.mock.calls[0][2]).toEqual({ enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 });
    expect(geo.watchPosition).not.toHaveBeenCalled();
    // Envoi avec le jeton de CETTE session (jamais celui d'un salarié qui aurait pris le poste)
    expect(apiMock.getPositionConfig).toHaveBeenCalledWith(t);
    expect(apiMock.envoyerPosition).toHaveBeenCalledWith({ lat: 45.5646, lng: 5.9178, precision_m: 18 }, t);
    // Même session (rechargement, nouvel appel) : ni nouvelle lecture ni nouvel envoi
    expect(await lancerPointage(apiMock, t, { geolocation: geo })).toBe('deja');
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(apiMock.envoyerPosition).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(clePointage(t))).toBe('1');
  });

  it('refus du navigateur → { refus: true } ; erreur → { indisponible: true }', async () => {
    apiMock.getPositionConfig.mockResolvedValue({ actif: true });
    await lancerPointage(apiMock, jeton({ sub: 'Nour', sid: 's3' }), { geolocation: geoMock({ code: 1 }) });
    expect(apiMock.envoyerPosition).toHaveBeenLastCalledWith({ refus: true }, expect.any(String));
    await lancerPointage(apiMock, jeton({ sub: 'Nour', sid: 's4' }), { geolocation: geoMock({ code: 3 }) });
    expect(apiMock.envoyerPosition).toHaveBeenLastCalledWith({ indisponible: true }, expect.any(String));
  });

  it('hors des heures d’ouverture (dimanche) : la position n’est pas lue', async () => {
    const geo = geoMock();
    apiMock.getPositionConfig.mockResolvedValue({ actif: true });
    expect(await lancerPointage(apiMock, jeton({ sub: 'Nour', sid: 's5' }), { geolocation: geo, maintenant: DIMANCHE_PARIS }))
      .toBe('hors_horaires');
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(apiMock.envoyerPosition).toHaveBeenCalledWith({ indisponible: true }, expect.any(String));
  });

  it('connexion : appareil + poste envoyés, aucune fenêtre ni texte ajouté, une seule lecture en arrière-plan', async () => {
    const geo = geoMock();
    Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
    localStorage.setItem('kp_poste', 'Comptoir');
    const t = jeton({ sub: 'Nour', sid: 'login1' });
    apiMock.login.mockResolvedValue({ access_token: t, target: 'accueil', utilisateur: 'Nour' });
    apiMock.get.mockResolvedValue({ role: '' });
    apiMock.getPositionConfig.mockResolvedValue({ actif: true });
    apiMock.envoyerPosition.mockResolvedValue({ statut: 'en_boutique' });

    let ctx;
    function Sonde() { ctx = useAuth(); return <p>tableau de bord</p>; }
    const { container } = render(<AuthProvider><Sonde /></AuthProvider>);
    await act(async () => { await ctx.login('1234', 'accueil', 'Nour'); });

    expect(apiMock.login).toHaveBeenCalledTimes(1);
    const [, , , extra] = apiMock.login.mock.calls[0];
    expect(extra.poste).toBe('Comptoir');
    expect(extra.appareil).toMatchObject({ type: expect.any(String) });
    await waitFor(() => expect(apiMock.envoyerPosition).toHaveBeenCalledTimes(1));
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    // Rien d'affiché côté salarié : ni fenêtre, ni bandeau, ni mention
    expect(container.textContent).toBe('tableau de bord');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.textContent).not.toMatch(/position|pointage|connexions/i);
  });

  it('connexion avec pointage inactif : aucun appel à l’API de géolocalisation', async () => {
    const geo = geoMock();
    Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
    apiMock.login.mockResolvedValue({ access_token: jeton({ sub: 'Karim', sid: 'login2' }), target: 'tech', utilisateur: 'Karim' });
    apiMock.get.mockResolvedValue({ role: '' });
    apiMock.getPositionConfig.mockResolvedValue({ actif: false });
    let ctx;
    function Sonde() { ctx = useAuth(); return null; }
    render(<AuthProvider><Sonde /></AuthProvider>);
    await act(async () => { await ctx.login('1234', 'tech', 'Karim'); });
    await waitFor(() => expect(apiMock.getPositionConfig).toHaveBeenCalledTimes(1));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(apiMock.envoyerPosition).not.toHaveBeenCalled();
  });

  it('changement d’utilisateur pendant la lecture : rien n’est envoyé, ni pour l’un ni sur la session de l’autre', async () => {
    const tLea = jeton({ sub: 'Léa', sid: 'poste1', cx: 41 });
    const tNour = jeton({ sub: 'Nour', sid: 'poste1', cx: 42 });
    let repondre;
    const geo = {
      getCurrentPosition: vi.fn((ok) => { repondre = ok; }), // demande d'autorisation laissée ouverte
      watchPosition: vi.fn(),
    };
    apiMock.token = tLea;
    apiMock.getPositionConfig.mockResolvedValue({ actif: true });
    const enCours = lancerPointage(apiMock, tLea, { geolocation: geo });
    await waitFor(() => expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1));
    // Nour prend le poste (« Changer ») avant la réponse du navigateur
    apiMock.token = tNour;
    repondre({ coords: { latitude: 45.5646, longitude: 5.9178, accuracy: 15 } });
    expect(await enCours).toBe('change');
    expect(apiMock.envoyerPosition).not.toHaveBeenCalled();
    // La lecture de Nour, elle, part avec SON jeton
    const geoNour = geoMock();
    expect(await lancerPointage(apiMock, tNour, { geolocation: geoNour })).toBe('envoye');
    expect(apiMock.envoyerPosition).toHaveBeenCalledTimes(1);
    expect(apiMock.envoyerPosition).toHaveBeenCalledWith({ lat: 45.5646, lng: 5.9178, precision_m: 18 }, tNour);
  });

  it('déconnexion pendant la lecture : la position lue n’est envoyée à personne', async () => {
    const t = jeton({ sub: 'Léa', sid: 'poste2', cx: 43 });
    let repondre;
    const geo = { getCurrentPosition: vi.fn((ok) => { repondre = ok; }), watchPosition: vi.fn() };
    apiMock.token = t;
    apiMock.getPositionConfig.mockResolvedValue({ actif: true });
    const enCours = lancerPointage(apiMock, t, { geolocation: geo });
    await waitFor(() => expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1));
    apiMock.token = null;
    repondre({ coords: { latitude: 45.5646, longitude: 5.9178, accuracy: 15 } });
    expect(await enCours).toBe('change');
    expect(apiMock.envoyerPosition).not.toHaveBeenCalled();
  });

  it('ApiClient réel : config et envoi portent le jeton de la session du pointage, pas le jeton courant', async () => {
    const { default: vraiApi } = await vi.importActual('../lib/api');
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ actif: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    vraiApi.setToken('jeton-de-nour');
    await vraiApi.getPositionConfig('jeton-de-lea');
    await vraiApi.envoyerPosition({ refus: true }, 'jeton-de-lea');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer jeton-de-lea');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer jeton-de-lea');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ refus: true });
    vraiApi.setToken(null);
  });

  it('détection de l’appareil préparée seulement sur l’écran de connexion du personnel', async () => {
    const espion = vi.spyOn(pointage, 'appareilClient').mockResolvedValue(null);
    const { unmount } = render(
      <MemoryRouter initialEntries={['/suivi']}><AuthProvider><p>suivi</p></AuthProvider></MemoryRouter>,
    );
    await act(async () => {});
    expect(espion).not.toHaveBeenCalled();
    unmount();
    render(<MemoryRouter initialEntries={['/login/accueil']}><AuthProvider><p>connexion</p></AuthProvider></MemoryRouter>);
    await waitFor(() => expect(espion).toHaveBeenCalledWith({ delaiMs: 0 }));
  });

  it('déconnexion : la session serveur est close sans bloquer', async () => {
    apiMock.logoutSession.mockReturnValue(Promise.reject(new Error('réseau coupé')));
    let ctx;
    function Sonde() { ctx = useAuth(); return null; }
    render(<AuthProvider><Sonde /></AuthProvider>);
    act(() => { ctx.logout(); });
    expect(apiMock.logoutSession).toHaveBeenCalledTimes(1);
    expect(apiMock.logout).toHaveBeenCalledTimes(1);
  });

  it('aucune mention côté salarié : ni page de connexion, ni configuration, ni « Mes connexions »', () => {
    const sources = import.meta.glob(
      ['../pages/LoginPage.jsx', '../pages/ConfigPage.jsx', '../components/Navbar.jsx', '../lib/api.js', '../App.jsx'],
      { query: '?raw', import: 'default', eager: true },
    );
    expect(Object.keys(sources)).toHaveLength(5);
    for (const [fichier, src] of Object.entries(sources)) {
      expect(src, fichier).not.toMatch(/mes-connexions|getMesConnexions|Mes connexions/);
      if (/LoginPage|ConfigPage/.test(fichier)) expect(src, fichier).not.toMatch(/pointage|geolocation|NoteInformation/i);
    }
    // Une seule entrée, dans la section admin, page gardée par <AG>
    expect(sources['../components/Navbar.jsx'].match(/\/activite/g)).toHaveLength(2); // adminItems + adminPages
    expect(sources['../App.jsx']).toMatch(/<Route path="\/accueil\/activite" element={<AG targets=\{\['accueil'\]\}><ActiviteEquipePage \/><\/AG>} \/>/);
    expect(sources['../App.jsx']).toMatch(/<Route path="\/tech\/activite" element={<AG targets=\{\['tech'\]\}><ActiviteEquipePage \/><\/AG>} \/>/);
  });
});

// ─── 3. Page admin ──────────────────────────────────────────────────────
function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accueil/activite']}>
      <ActiviteEquipePage />
    </MemoryRouter>,
  );
}

describe('Page « Activité de l’équipe »', () => {
  // Écran de bureau 1440 px (jsdom : 1024 par défaut)
  const largeurInitiale = window.innerWidth;
  beforeEach(() => { window.innerWidth = 1440; });
  afterEach(() => { window.innerWidth = largeurInitiale; });

  it('grille de la semaine : salariés × jours (dimanche masqué), heures, durée, total, en ligne', async () => {
    apiMock.getActiviteEquipe.mockResolvedValue(activite());
    renderPage();
    const table = await screen.findByRole('table');
    expect(apiMock.getActiviteEquipe).toHaveBeenCalledTimes(1);
    expect(apiMock.getActiviteEquipe).toHaveBeenCalledWith(undefined);
    const entetes = within(table).getAllByRole('columnheader').map((th) => th.textContent);
    expect(entetes).toHaveLength(8); // salarié + lun→sam + semaine
    expect(entetes[1]).toMatch(/lun\.\s*19/);
    expect(entetes[7]).toBe('Semaine');
    expect(within(table).getAllByRole('rowheader').map((th) => th.textContent)).toEqual(['Nour', 'Karim', 'Léa']);

    const lundi = within(table).getByRole('button', { name: /^Nour, lundi 19 octobre/ });
    expect(lundi).toHaveTextContent('10:02 – 18:47');
    expect(lundi).toHaveTextContent('8 h 45');
    expect(lundi).toHaveTextContent('54 act.');
    expect(lundi.getAttribute('aria-label')).toMatch(/En boutique/);
    expect(lundi.getAttribute('aria-label')).toMatch(/6 tickets créés/);
    expect(within(table).getByRole('button', { name: /^Karim, mardi 20 octobre/ })).toHaveTextContent('en cours');
    expect(within(table).getByRole('button', { name: /^Karim, mardi 20 octobre/ }).getAttribute('aria-label')).toMatch(/Hors boutique, à 2,3 km/);
    expect(table).toHaveTextContent('32 h 15');
    expect(within(table).getAllByText('Aucune connexion').length).toBeGreaterThan(5);

    const enLigne = screen.getByRole('region', { name: 'En ligne maintenant' });
    expect(enLigne).toHaveTextContent('Nour');
    expect(enLigne).toHaveTextContent('iPhone · Apple · iOS 18');
    expect(enLigne).toHaveTextContent('Hors boutique, à 2,3 km');
    expect(screen.getByText('Semaine du 19 au 25 oct.')).toBeInTheDocument();
    // Note confirmée : pas de rappel
    expect(screen.queryByText(/note d’information aux salariés n’est pas confirmée/)).toBeNull();
  });

  it('écran étroit (390 px) : une liste par salarié, sans tableau', async () => {
    window.innerWidth = 390;
    apiMock.getActiviteEquipe.mockResolvedValue(activite());
    renderPage();
    const liste = await screen.findByRole('list', { name: /Heures de connexion/ });
    expect(screen.queryByRole('table')).toBeNull();
    expect(within(liste).getByRole('heading', { name: 'Nour' })).toBeInTheDocument();
    expect(within(liste).getByText('Aucune connexion cette semaine')).toBeInTheDocument();
    expect(within(liste).getByRole('button', { name: /^Nour, lundi 19 octobre/ })).toHaveTextContent('10:02 – 18:47');
  });

  it('en ligne : une pastille par salarié même avec plusieurs appareils ouverts', async () => {
    const d = activite();
    d.connectes.push({ utilisateur: 'Nour', cible: 'accueil', poste: 'Atelier', appareil: PC, debut: '2026-10-20T09:30:00', depuis: '11:30', actions: 2, geo_statut: 'hors_boutique', geo_distance_m: 350 });
    apiMock.getActiviteEquipe.mockResolvedValue(d);
    renderPage();
    const enLigne = await screen.findByRole('region', { name: 'En ligne maintenant' });
    const pastilles = within(enLigne).getAllByRole('listitem');
    expect(pastilles).toHaveLength(2);
    expect(pastilles[0]).toHaveTextContent('iPhone · Apple · iOS 18 / Ordinateur · PC Windows · Chrome');
    expect(pastilles[0]).toHaveTextContent('poste Comptoir, Atelier');
    // Présence la plus parlante : hors boutique
    expect(pastilles[0]).toHaveTextContent('Hors boutique, à 350 m');
  });

  it('dimanche affiché seulement s’il y a eu une connexion', async () => {
    const d = activite();
    d.salaries[2].jours['2026-10-25'] = { arrivee: '11:00', depart: '11:20', duree_min: 20, sessions: 1, actions: 1, appareils: [], presence: { statut: 'hors_horaires' }, en_cours: false };
    apiMock.getActiviteEquipe.mockResolvedValue(d);
    renderPage();
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(9);
  });

  it('détail d’un jour au clic : sessions, poste, appareil, motif ; Échap ferme et rend le focus', async () => {
    apiMock.getActiviteEquipe.mockResolvedValue(activite());
    apiMock.getSessionsEquipe.mockResolvedValue(SESSIONS_NOUR_LUNDI);
    renderPage();
    const cellule = await screen.findByRole('button', { name: /^Nour, lundi 19 octobre/ });
    cellule.focus();
    fireEvent.click(cellule);
    expect(apiMock.getSessionsEquipe).toHaveBeenCalledWith('Nour', '2026-10-19');
    const panneau = await screen.findByRole('region', { name: /Nour · lundi 19 octobre/ });
    const lignes = await within(panneau).findAllByRole('listitem');
    expect(lignes).toHaveLength(2);
    expect(lignes[0]).toHaveTextContent('10:02 → 12:30');
    expect(lignes[0]).toHaveTextContent('2 h 28');
    expect(lignes[0]).toHaveTextContent('Comptoir');
    expect(lignes[0]).toHaveTextContent('iPhone Apple iOS 18');
    expect(lignes[0]).toHaveTextContent('23 actions');
    expect(lignes[0]).toHaveTextContent('En boutique');
    expect(lignes[0]).toHaveTextContent('Changement d’utilisateur');
    expect(lignes[1]).toHaveTextContent('Ordinateur PC Windows Chrome');
    expect(lignes[1]).toHaveTextContent('Déconnexion');
    expect(cellule).toHaveAttribute('aria-expanded', 'true');
    // Le focus passe au titre du panneau
    expect(document.activeElement).toBe(within(panneau).getByRole('heading'));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: /Nour · lundi 19 octobre/ })).toBeNull();
    expect(document.activeElement).toBe(cellule);
  });

  it('cellules = vrais boutons (clavier) dans un vrai tableau avec en-têtes', async () => {
    apiMock.getActiviteEquipe.mockResolvedValue(activite());
    renderPage();
    const table = await screen.findByRole('table');
    within(table).getAllByRole('columnheader').forEach((th) => expect(th).toHaveAttribute('scope', 'col'));
    within(table).getAllByRole('rowheader').forEach((th) => expect(th).toHaveAttribute('scope', 'row'));
    const boutons = within(table).getAllByRole('button');
    expect(boutons).toHaveLength(3);
    boutons.forEach((b) => expect(b.tagName).toBe('BUTTON'));
  });

  it('navigation de semaine : précédente, puis « Cette semaine » ; suivante désactivée sur la semaine en cours', async () => {
    apiMock.getActiviteEquipe.mockResolvedValue(activite());
    renderPage();
    await screen.findByRole('table');
    expect(screen.getByRole('button', { name: 'Semaine suivante' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Semaine précédente' }));
    await waitFor(() => expect(apiMock.getActiviteEquipe).toHaveBeenLastCalledWith('2026-10-12'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cette semaine' }));
    await waitFor(() => expect(apiMock.getActiviteEquipe).toHaveBeenLastCalledWith(undefined));
  });

  it('export : semaine affichée ou un salarié (demande d’accès)', async () => {
    apiMock.getActiviteEquipe.mockResolvedValue(activite());
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Exporter' }));
    fireEvent.click(screen.getByRole('button', { name: /Semaine du 19 au 25 oct\..*Toute l’équipe/ }));
    await waitFor(() => expect(apiMock.exportActiviteEquipe).toHaveBeenCalledWith(
      { depuis: '2026-10-19', jusqua: '2026-10-25' }, 'activite_equipe_2026-10-19.csv',
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Exporter' }));
    fireEvent.click(screen.getByRole('button', { name: /^Léa/ }));
    await waitFor(() => expect(apiMock.exportActiviteEquipe).toHaveBeenLastCalledWith(
      { utilisateur: 'Léa' }, 'connexions_Lea_2026-10-20.csv',
    ));
  });

  // Réglages : une ligne par salarié actif (remise de la version en vigueur de la note)
  const REMISES = [
    { utilisateur: 'Nour', remise_le: '2026-10-20T12:00:00', remise_par: 'Tarik', a_jour: true },
    { utilisateur: 'Karim', remise_le: '2026-10-12T09:30:00', remise_par: 'Tarik', a_jour: false }, // rayon changé depuis
    { utilisateur: 'Léa', remise_le: null, remise_par: null, a_jour: false },                      // embauchée après
  ];
  const BLOCAGE_NOTE = 'Remettez d’abord la note d’information aux salariés, puis confirmez-le.';
  function reglages(extra = {}) {
    return {
      pointage_actif: false, pointage_interrupteur: false, pointage_blocage: null,
      information_remise_le: '2026-10-20T12:00:00', information_remise_par: 'Tarik', information_remise: false,
      remises: REMISES, membres_sans_note: ['Karim', 'Léa'], rayon_m: 150,
      boutique_lat: 45.5646, boutique_lng: 5.9178, boutique_position_confirmee: true, texte_note: '',
      conservation: { position_jours: 60, journal_jours: 183 },
      ...extra,
    };
  }
  async function ouvrirReglages() {
    fireEvent.click(screen.getByRole('button', { name: 'Réglages' }));
    const fenetre = await screen.findByRole('dialog', { name: /Réglages/ });
    await within(fenetre).findByRole('list', { name: 'Remise de la note par salarié' });
    return fenetre;
  }

  it('réglages : liste des salariés avec l’état de la remise (à jour, version périmée, à remettre)', async () => {
    apiMock.getActiviteEquipe.mockResolvedValue(activite({ information_remise: false }));
    apiMock.getReglagesEquipe.mockResolvedValue(reglages({ pointage_blocage: BLOCAGE_NOTE }));
    renderPage();
    await screen.findByRole('table');
    const fenetre = await ouvrirReglages();
    const liste = within(fenetre).getByRole('list', { name: 'Remise de la note par salarié' });
    const lignes = within(liste).getAllByRole('listitem');
    expect(lignes.map((li) => li.textContent)).toEqual([
      'NourRemise le 20/10/2026 par Tarik',
      'KarimVersion périmée : la note a changé depuis la remise du 12/10/2026',
      'LéaÀ remettre',
    ]);
    expect(within(liste).getByRole('checkbox', { name: 'Note remise à Nour' })).toBeChecked();
    expect(within(liste).getByRole('checkbox', { name: 'Note remise à Karim' })).not.toBeChecked();
    expect(within(liste).getByRole('checkbox', { name: 'Note remise à Léa' })).not.toBeChecked();
    expect(within(liste).getByRole('checkbox', { name: 'Note remise à Léa' })).toHaveAccessibleDescription('À remettre');
    // Explication d'une ligne pour la version périmée, bouton « Tout confirmer » tant qu'il manque quelqu'un
    expect(within(fenetre).getByText('La note a changé (rayon ou coordonnées de la boutique) : réimprimez-la et remettez-la à nouveau.')).toBeInTheDocument();
    expect(within(fenetre).getByRole('button', { name: 'Tout confirmer' })).toBeInTheDocument();
    expect(within(fenetre).queryByRole('button', { name: 'J’ai remis la note aux salariés' })).toBeNull();
    // Interrupteur piloté par la raison donnée par le serveur
    const inter = within(fenetre).getByRole('switch');
    expect(inter).toBeDisabled();
    expect(inter).toHaveAccessibleDescription(BLOCAGE_NOTE);
    expect(within(fenetre).getByText('Lire la note').closest('details')).not.toHaveAttribute('open');
  });

  it('réglages : cocher un salarié → { membres: [nom] }, optimiste puis état du serveur ; décocher → { retirer: [nom] }', async () => {
    apiMock.getActiviteEquipe.mockResolvedValue(activite({ information_remise: false }));
    apiMock.getReglagesEquipe.mockResolvedValue(reglages());
    let repondre;
    apiMock.confirmerInformationRemise.mockImplementationOnce(() => new Promise((res) => { repondre = res; }));
    renderPage();
    expect(await screen.findByText(/la remise de la note d’information aux salariés n’est pas confirmée/)).toBeInTheDocument();
    const fenetre = await ouvrirReglages();
    const liste = within(fenetre).getByRole('list', { name: 'Remise de la note par salarié' });

    const caseLea = within(liste).getByRole('checkbox', { name: 'Note remise à Léa' });
    caseLea.focus(); // au clavier : Tab jusqu'à la case, Espace
    fireEvent.click(caseLea);
    expect(apiMock.confirmerInformationRemise).toHaveBeenCalledWith({ membres: ['Léa'] });
    // Optimiste : cochée tout de suite, datée d'aujourd'hui, sans admin tant que le serveur n'a pas répondu
    expect(caseLea).toBeChecked();
    expect(within(liste).getAllByRole('listitem')[2]).toHaveTextContent('LéaRemise le 20/10/2026');
    // Jamais `disabled` (un élément désactivé perd le focus) : occupée, et un nouveau clic est ignoré
    expect(caseLea).toBeEnabled();
    expect(caseLea).toHaveAttribute('aria-busy', 'true');
    expect(caseLea).toHaveAttribute('aria-disabled', 'true');
    expect(document.activeElement).toBe(caseLea);
    fireEvent.click(caseLea);
    expect(apiMock.confirmerInformationRemise).toHaveBeenCalledTimes(1);
    // Les autres restent cliquables
    expect(within(liste).getByRole('checkbox', { name: 'Note remise à Karim' })).not.toBeDisabled();
    expect(within(liste).getByRole('checkbox', { name: 'Note remise à Karim' })).not.toHaveAttribute('aria-busy');

    const apres = reglages({
      remises: [REMISES[0], REMISES[1], { utilisateur: 'Léa', remise_le: '2026-10-20T12:05:00', remise_par: 'Tarik', a_jour: true }],
      membres_sans_note: ['Karim'],
    });
    await act(async () => { repondre(apres); });
    await waitFor(() => expect(within(liste).getAllByRole('listitem')[2]).toHaveTextContent('LéaRemise le 20/10/2026 par Tarik'));
    expect(caseLea).not.toHaveAttribute('aria-busy');
    expect(caseLea).not.toHaveAttribute('aria-disabled');
    // Le focus est resté sur la case : on enchaîne au clavier sur le salarié suivant sans retraverser la fenêtre
    expect(document.activeElement).toBe(caseLea);
    expect(within(fenetre).getByText('Remise de la note à Léa enregistrée.')).toBeInTheDocument();
    // Karim manque toujours : le rappel de la page reste
    expect(screen.getByText(/la remise de la note d’information aux salariés n’est pas confirmée/)).toBeInTheDocument();

    apiMock.confirmerInformationRemise.mockResolvedValueOnce(reglages({
      remises: [{ ...REMISES[0], remise_le: null, remise_par: null, a_jour: false }, REMISES[1], REMISES[2]],
      information_remise_le: null, information_remise_par: null, membres_sans_note: ['Nour', 'Karim', 'Léa'],
    }));
    const caseNour = within(liste).getByRole('checkbox', { name: 'Note remise à Nour' });
    caseNour.focus();
    fireEvent.click(caseNour);
    expect(apiMock.confirmerInformationRemise).toHaveBeenLastCalledWith({ retirer: ['Nour'] });
    expect(caseNour).not.toBeChecked();
    await waitFor(() => expect(within(liste).getAllByRole('listitem')[0]).toHaveTextContent('NourÀ remettre'));
    expect(within(fenetre).getByText('Remise de la note à Nour retirée.')).toBeInTheDocument();
    expect(document.activeElement).toBe(caseNour);
  });

  it('réglages : deux cases cochées coup sur coup → chaque ligne garde son état jusqu’à SA réponse', async () => {
    apiMock.getActiviteEquipe.mockResolvedValue(activite({ information_remise: false }));
    const SAM = { utilisateur: 'Sam', remise_le: null, remise_par: null, a_jour: false };
    apiMock.getReglagesEquipe.mockResolvedValue(reglages({ remises: [...REMISES, SAM], membres_sans_note: ['Karim', 'Léa', 'Sam'] }));
    const reponses = [];
    apiMock.confirmerInformationRemise.mockImplementation(() => new Promise((res) => { reponses.push(res); }));
    renderPage();
    await screen.findByRole('table');
    const fenetre = await ouvrirReglages();
    const liste = within(fenetre).getByRole('list', { name: 'Remise de la note par salarié' });
    const caseKarim = within(liste).getByRole('checkbox', { name: 'Note remise à Karim' });
    const caseLea = within(liste).getByRole('checkbox', { name: 'Note remise à Léa' });
    fireEvent.click(caseKarim);
    fireEvent.click(caseLea);
    expect(apiMock.confirmerInformationRemise.mock.calls).toEqual([[{ membres: ['Karim'] }], [{ membres: ['Léa'] }]]);
    expect(caseKarim).toBeChecked();
    expect(caseLea).toBeChecked();
    // « Tout confirmer » attend que les réponses arrivent (clic ignoré, bouton jamais désactivé)
    const tout = within(fenetre).getByRole('button', { name: 'Tout confirmer' });
    expect(tout).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(tout);
    expect(apiMock.confirmerInformationRemise).toHaveBeenCalledTimes(2);

    // Réponse de Karim : côté serveur, Léa n'est pas encore remise → sa ligne garde l'état optimiste
    await act(async () => {
      reponses[0](reglages({
        remises: [REMISES[0], { utilisateur: 'Karim', remise_le: '2026-10-20T12:05:00', remise_par: 'Tarik', a_jour: true }, REMISES[2], SAM],
        membres_sans_note: ['Léa', 'Sam'],
      }));
    });
    await waitFor(() => expect(within(liste).getAllByRole('listitem')[1]).toHaveTextContent('KarimRemise le 20/10/2026 par Tarik'));
    expect(caseLea).toBeChecked();
    expect(caseLea).toHaveAttribute('aria-busy', 'true');
    expect(within(liste).getAllByRole('listitem')[2]).toHaveTextContent('LéaRemise le 20/10/2026');
    expect(within(liste).getAllByRole('listitem')[2]).not.toHaveTextContent('À remettre');
    expect(caseKarim).not.toHaveAttribute('aria-busy');

    // Réponse de Léa : Karim et Léa à jour, Sam manque toujours → « Tout confirmer » redevient actif
    await act(async () => {
      reponses[1](reglages({
        remises: [...REMISES.map((x) => ({ ...x, remise_le: '2026-10-20T12:06:00', remise_par: 'Tarik', a_jour: true })), SAM],
        membres_sans_note: ['Sam'],
      }));
    });
    await waitFor(() => expect(within(liste).getAllByRole('listitem')[2]).toHaveTextContent('LéaRemise le 20/10/2026 par Tarik'));
    expect(caseLea).not.toHaveAttribute('aria-busy');
    expect(within(liste).getByRole('checkbox', { name: 'Note remise à Sam' })).not.toBeChecked();
    expect(within(fenetre).getByRole('button', { name: 'Tout confirmer' })).not.toHaveAttribute('aria-busy');
    expect(screen.getByText(/la remise de la note d’information aux salariés n’est pas confirmée/)).toBeInTheDocument();
  });

  it('réglages : dès l’ouverture, la page parente apprend qu’un salarié n’a pas la note (embauché depuis)', async () => {
    // La page croit la note remise à tous ; les réglages, plus frais, montrent un nouveau salarié sans remise
    apiMock.getActiviteEquipe.mockResolvedValue(activite({ information_remise: true }));
    apiMock.getReglagesEquipe.mockResolvedValue(reglages({
      remises: [REMISES[0], { ...REMISES[1], remise_le: '2026-10-20T12:00:00', a_jour: true }, { utilisateur: 'Yanis', remise_le: null, remise_par: null, a_jour: false }],
      membres_sans_note: ['Yanis'], information_remise: false, pointage_blocage: BLOCAGE_NOTE,
    }));
    renderPage();
    await screen.findByRole('table');
    expect(screen.queryByText(/la remise de la note d’information aux salariés n’est pas confirmée/)).toBeNull();
    const fenetre = await ouvrirReglages();
    expect(within(fenetre).getAllByRole('listitem')[2]).toHaveTextContent('YanisÀ remettre');
    expect(within(fenetre).getByRole('checkbox', { name: 'Note remise à Yanis' })).not.toBeChecked();
    // Rappel de la page sans attendre une action ni « Actualiser »
    expect(screen.getByText(/la remise de la note d’information aux salariés n’est pas confirmée/)).toBeInTheDocument();
    expect(apiMock.getActiviteEquipe).toHaveBeenCalledTimes(1);
  });

  it('réglages : « Tout confirmer » (corps vide) → tous à jour, interrupteur débloqué, rappel de la page retiré', async () => {
    apiMock.getActiviteEquipe.mockResolvedValue(activite({ information_remise: false }));
    apiMock.getReglagesEquipe.mockResolvedValue(reglages({ pointage_blocage: BLOCAGE_NOTE }));
    const tous = REMISES.map((x) => ({ ...x, remise_le: '2026-10-20T12:00:00', remise_par: 'Tarik', a_jour: true }));
    apiMock.confirmerInformationRemise.mockResolvedValue(reglages({
      remises: tous, membres_sans_note: [], information_remise: true, pointage_blocage: null,
    }));
    apiMock.updateReglagesEquipe.mockResolvedValue(reglages({
      remises: tous, membres_sans_note: [], information_remise: true, pointage_blocage: null, pointage_actif: true, pointage_interrupteur: true,
    }));
    renderPage();
    expect(await screen.findByText(/la remise de la note d’information aux salariés n’est pas confirmée/)).toBeInTheDocument();
    const fenetre = await ouvrirReglages();
    expect(within(fenetre).getByRole('switch')).toBeDisabled();

    const tout = within(fenetre).getByRole('button', { name: 'Tout confirmer' });
    tout.focus();
    fireEvent.click(tout);
    expect(apiMock.confirmerInformationRemise).toHaveBeenCalledTimes(1);
    expect(apiMock.confirmerInformationRemise).toHaveBeenCalledWith();
    expect(await within(fenetre).findByText('Remise à tous les salariés (3)')).toBeInTheDocument();
    expect(within(fenetre).queryByRole('button', { name: 'Tout confirmer' })).toBeNull();
    // Le bouton a disparu : le focus clavier passe sur la première case de la liste, pas sur <body>
    expect(document.activeElement).toBe(within(fenetre).getByRole('checkbox', { name: 'Note remise à Nour' }));
    expect(within(fenetre).queryByText(/La note a changé/)).toBeNull();
    for (const c of within(fenetre).getAllByRole('checkbox')) expect(c).toBeChecked();
    await waitFor(() => expect(within(fenetre).getByRole('switch')).not.toBeDisabled());
    expect(screen.queryByText(/la remise de la note d’information aux salariés n’est pas confirmée/)).toBeNull();

    fireEvent.click(within(fenetre).getByRole('switch'));
    await waitFor(() => expect(apiMock.updateReglagesEquipe).toHaveBeenCalledWith({ pointage_actif: true }));
    await waitFor(() => expect(within(fenetre).getByRole('switch')).toHaveAttribute('aria-checked', 'true'));

    // Changer le rayon périme toutes les confirmations : le serveur suspend le pointage, le rappel de la page revient
    apiMock.updateReglagesEquipe.mockResolvedValueOnce(reglages({
      remises: tous.map((x) => ({ ...x, a_jour: false })), membres_sans_note: tous.map((x) => x.utilisateur), rayon_m: 200,
      information_remise: false, pointage_blocage: BLOCAGE_NOTE, pointage_actif: false, pointage_interrupteur: true,
    }));
    fireEvent.change(within(fenetre).getByLabelText('Rayon autour de la boutique'), { target: { value: '200' } });
    fireEvent.click(within(fenetre).getAllByRole('button', { name: 'Enregistrer' })[0]);
    await waitFor(() => expect(apiMock.updateReglagesEquipe).toHaveBeenLastCalledWith({ rayon_m: 200 }));
    expect(await within(fenetre).findByText('La note a changé (rayon ou coordonnées de la boutique) : réimprimez-la et remettez-la à nouveau.')).toBeInTheDocument();
    expect(within(fenetre).getByRole('button', { name: 'Tout confirmer' })).toBeInTheDocument();
    expect(within(fenetre).getByRole('switch')).toBeDisabled();
    expect(within(fenetre).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/la remise de la note d’information aux salariés n’est pas confirmée/)).toBeInTheDocument();

    // Nom de ce poste
    fireEvent.change(within(fenetre).getByLabelText('Nom de ce poste'), { target: { value: 'Atelier' } });
    fireEvent.click(within(fenetre).getAllByRole('button', { name: 'Enregistrer' })[1]);
    expect(localStorage.getItem('kp_poste')).toBe('Atelier');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('réglages : erreur du serveur → case remise dans son état d’avant, message d’erreur affiché', async () => {
    apiMock.getActiviteEquipe.mockResolvedValue(activite({ information_remise: false }));
    apiMock.getReglagesEquipe.mockResolvedValue(reglages());
    apiMock.confirmerInformationRemise.mockRejectedValue(new Error('Salarié inconnu ou inactif : Léa'));
    renderPage();
    await screen.findByRole('table');
    const fenetre = await ouvrirReglages();
    const liste = within(fenetre).getByRole('list', { name: 'Remise de la note par salarié' });
    const caseLea = within(liste).getByRole('checkbox', { name: 'Note remise à Léa' });
    caseLea.focus();
    fireEvent.click(caseLea);
    const msg = await within(fenetre).findByText('Salarié inconnu ou inactif : Léa');
    expect(msg).toHaveAttribute('aria-live', 'polite');
    // Collé au bas du corps défilant : visible sans défiler, même avec dix salariés dans la liste
    expect(msg).toHaveClass('sticky', 'bottom-0');
    expect(caseLea).not.toBeChecked();
    expect(caseLea).not.toHaveAttribute('aria-busy');
    expect(document.activeElement).toBe(caseLea);
    expect(within(liste).getAllByRole('listitem')[2]).toHaveTextContent('LéaÀ remettre');
  });

  it('réglages : version périmée pour tous après changement du rayon → pointage suspendu (raison du serveur)', async () => {
    apiMock.getActiviteEquipe.mockResolvedValue(activite({ information_remise: false }));
    const perimes = REMISES.map((x) => ({ ...x, remise_le: '2026-10-12T09:30:00', remise_par: 'Tarik', a_jour: false }));
    apiMock.getReglagesEquipe.mockResolvedValue(reglages({
      remises: perimes, membres_sans_note: ['Nour', 'Karim', 'Léa'], pointage_interrupteur: true,
      pointage_actif: false, pointage_blocage: BLOCAGE_NOTE, information_remise_le: null, information_remise_par: null,
    }));
    renderPage();
    await screen.findByRole('table');
    const fenetre = await ouvrirReglages();
    expect(within(fenetre).getByText('La note a changé (rayon ou coordonnées de la boutique) : réimprimez-la et remettez-la à nouveau.')).toBeInTheDocument();
    const liste = within(fenetre).getByRole('list', { name: 'Remise de la note par salarié' });
    expect(within(liste).getAllByRole('listitem')).toHaveLength(3);
    for (const li of within(liste).getAllByRole('listitem')) expect(li).toHaveTextContent(/Version périmée : la note a changé depuis la remise du 12\/10\/2026/);
    for (const c of within(liste).getAllByRole('checkbox')) expect(c).not.toBeChecked();
    const inter = within(fenetre).getByRole('switch');
    expect(inter).toBeDisabled();
    expect(inter).toHaveAttribute('aria-checked', 'false');
    expect(inter).toHaveAccessibleDescription(BLOCAGE_NOTE);
    fireEvent.click(inter);
    expect(apiMock.updateReglagesEquipe).not.toHaveBeenCalled();
  });

  it('réglages : raison de blocage donnée par le serveur (position de la boutique à confirmer)', async () => {
    apiMock.getActiviteEquipe.mockResolvedValue(activite());
    apiMock.getReglagesEquipe.mockResolvedValue(reglages({
      remises: REMISES.map((x) => ({ ...x, remise_le: '2026-10-20T12:00:00', remise_par: 'Nour', a_jour: true })),
      membres_sans_note: [], information_remise: true,
      pointage_blocage: 'Enregistrez d’abord la position de la boutique.', boutique_position_confirmee: false,
    }));
    renderPage();
    await screen.findByRole('table');
    const fenetre = await ouvrirReglages();
    const inter = within(fenetre).getByRole('switch');
    expect(inter).toBeDisabled();
    expect(inter).toHaveAccessibleDescription('Enregistrez d’abord la position de la boutique.');
    expect(within(fenetre).getByText('Position par défaut, à confirmer')).toBeInTheDocument();
    expect(within(fenetre).queryByRole('button', { name: 'Tout confirmer' })).toBeNull();
    fireEvent.click(inter);
    expect(apiMock.updateReglagesEquipe).not.toHaveBeenCalled();
  });

  it('note d’information : texte complet et page d’impression autonome', () => {
    const titres = NOTE_INFORMATION.sections.map((s) => s.titre);
    expect(titres).toEqual(expect.arrayContaining(['Responsable du traitement', 'Finalités', 'Données enregistrées', 'Base légale', 'Destinataire', 'Durées de conservation', 'Vos droits', 'Représentants du personnel']));
    const html = noteInformationHtml();
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toMatch(/jamais enregistrée/);
    expect(html).toMatch(/type d’appareil/);
    expect(html).toMatch(/CNIL/);
    expect(html).toMatch(/CSE|comité social et économique/);
    expect(html).toMatch(/sans aucune conséquence/);
    expect(html).not.toMatch(/Mes connexions/);
    expect(noteInformationHtml('Titre\n\n- un\n- deux <b>')).toMatch(/<ul><li>un<\/li><li>deux &lt;b&gt;<\/li><\/ul>/);
  });
});

// ─── 4. Appels de fond et menu ──────────────────────────────────────────
describe('Appels de fond : en-tête X-KP-Fond (pas d’activité du salarié)', () => {
  const reponse = (data = {}) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => data });

  it('posé sous api.background (GET compris), absent pour une lecture voulue par le salarié', async () => {
    const { default: vraiApi } = await vi.importActual('../lib/api');
    const fetchMock = vi.fn(async () => reponse({ total_actifs: 3 }));
    vi.stubGlobal('fetch', fetchMock);
    vraiApi.setToken('jeton-fond');
    await vraiApi.background(() => Promise.all([vraiApi.getKPI(), vraiApi.notifsFeed(30)]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, opts] of fetchMock.mock.calls) expect(opts.headers['X-KP-Fond']).toBe('1');
    await vraiApi.getInteractions();
    expect(fetchMock.mock.calls[2][1].headers['X-KP-Fond']).toBeUndefined();
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer jeton-fond');
    vraiApi.setToken(null);
  });

  it('rafraîchissement du tableau de bord (useApi.mutate sous api.background) : en-tête bien posé', async () => {
    const { default: vraiApi } = await vi.importActual('../lib/api');
    const fetchMock = vi.fn(async () => reponse({ tickets: [], total: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    vraiApi.setToken('jeton-dashboard');
    clearCache();
    let mutate;
    function Tableau() {
      ({ mutate } = useApi('test:fond:dashboard', () => vraiApi.getDashboard({ limit: 5 }), { ttl: 60_000 }));
      return null;
    }
    render(<Tableau />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][1].headers['X-KP-Fond']).toBeUndefined(); // premier affichage
    await act(async () => { await vraiApi.background(() => mutate()); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers['X-KP-Fond']).toBe('1');
    vraiApi.setToken(null);
    clearCache();
  });
});

describe('Menu : « Activité de l’équipe » réservé au rôle admin', () => {
  function renderNavbar(role) {
    localStorage.setItem('kp_token', jeton({ sub: 'Léa', sid: 'nav' }));
    localStorage.setItem('kp_target', 'accueil');
    localStorage.setItem('kp_user', 'Léa');
    localStorage.setItem('kp_role', role);
    apiMock.get.mockResolvedValue({ role });
    apiMock.hasAdminToken.mockReturnValue(false);
    return render(
      <MemoryRouter initialEntries={['/accueil']}><AuthProvider><Navbar /></AuthProvider></MemoryRouter>,
    );
  }

  it('salarié (accueil, technicien) : aucune entrée, ni rien qui mentionne le dispositif', async () => {
    for (const role of ['accueil', 'tech', '']) {
      const { unmount } = renderNavbar(role);
      await screen.findByRole('button', { name: /^Reporting/ });
      expect(screen.queryByRole('button', { name: /Activité de l’équipe/ })).toBeNull();
      expect(document.body.textContent).not.toMatch(/Activité de l’équipe|pointage|connexions de l’équipe/i);
      unmount();
    }
  });

  it('rôle admin : une entrée dans la section Administration', async () => {
    renderNavbar('admin');
    expect(await screen.findByRole('button', { name: /Activité de l’équipe/ })).toBeInTheDocument();
  });
});

describe('Disposition de la grille', () => {
  it('dimanche affiché : il faut plus de largeur pour la grille complète (noms jamais rognés)', () => {
    expect(modePour(1118, 6)).toBe('complet');
    expect(modePour(1118, 7)).toBe('complet');
    expect(modePour(1046, 6)).toBe('complet');
    expect(modePour(1046, 7)).toBe('compact');
    expect(modePour(650, 6)).toBe('compact');
    expect(modePour(650, 7)).toBe('liste');
    expect(modePour(358, 6)).toBe('liste');
  });

  it('légende des points de présence visible à côté de « En ligne maintenant »', async () => {
    window.innerWidth = 1440;
    apiMock.getActiviteEquipe.mockResolvedValue(activite());
    renderPage();
    const legende = await screen.findByRole('list', { name: 'Légende des points de présence' });
    expect(within(legende).getAllByRole('listitem').map((li) => li.textContent))
      .toEqual(['En boutique', 'Hors boutique', 'Imprécise', 'Refusée / non vérifiée']);
    // La pastille de l'en-ligne n'en contient pas : une seule par salarié
    expect(within(screen.getByRole('region', { name: 'En ligne maintenant' })).getAllByRole('listitem')).toHaveLength(2);
  });
});
