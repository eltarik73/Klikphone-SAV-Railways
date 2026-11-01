/**
 * Client API centralisé pour communiquer avec le backend FastAPI.
 * Gère automatiquement : JWT token, JSON, erreurs.
 */

const API_URL = import.meta.env.VITE_API_URL || '';

// Default TTL for the in-memory GET cache (ms)
const DEFAULT_CACHE_TTL = 30_000;

// Relances : seulement pour un GET (idempotent) sur coupure réseau ou passerelle indisponible.
// Jamais sur 500 (relancer triple la charge d'un serveur déjà en difficulté) ni sur timeout
// (le serveur continue de traiter la requête abandonnée : export relancé 3 fois, etc.).
const RETRY_STATUSES = new Set([502, 503, 504]);
const DEFAULT_GET_RETRIES = 2;

// Un 401 sur ces routes signifie « code ou PIN incorrect », pas « session expirée » :
// il ne doit jamais déconnecter l'employé.
const CREDENTIAL_PATHS = [
  '/api/auth/login', '/api/auth/switch-user', '/api/admin/verify',
  '/api/admin/change-password', '/api/config/change-pin',
];
// Refus d'élévation (auth._refus_admin) : detail = { code, message }. « Admin requis » en simple
// texte est un refus lié au RÔLE (marketing, reporting) : la saisie du code admin n'y change rien.
const ADMIN_REFUSAL_CODES = new Set(['admin_requis', 'admin_expire', 'admin_invalide']);
// Repli pour un detail texte (ancien serveur) : vocabulaire propre au jeton, jamais « Admin requis »
const ADMIN_REFUSAL_RE = /élévation|elevation|(jeton|token)\s+(d['’]\s*)?(admin|élévation)|x-admin-token/i;
const ADMIN_TOKEN_KEY = 'kp_admin_token';
const ADMIN_TOKEN_TTL = 10 * 60_000;
// Mode admin de l'interface (menu admin, AdminGuard) : drapeau du poste + événement à chaque changement,
// pour que les écrans déjà affichés (garde « Accès restreint », barre latérale) suivent sans rechargement.
// Même nom que dans components/AdminLoginModal.jsx (annoncerModeAdmin, utilisé par les composants).
const ADMIN_MODE_KEY = 'klikphone_admin';
export const ADMIN_MODE_EVENT = 'kp-admin-mode';
// Routes publiques (suivi, code ticket, connexion) : le jeton d'élévation n'y part jamais
const NO_ADMIN_TOKEN_PATHS = ['/api/suivi/', '/api/tickets/code/', '/api/auth/', '/api/config/public'];

const pathOnly = (path) => String(path || '').split('?')[0];

export function isCredentialCheck(path) {
  const p = pathOnly(path);
  return CREDENTIAL_PATHS.some((c) => p === c || p.startsWith(`${c}/`));
}

// Actions publiques du suivi client : un 401/403 y signale un jeton ou des chiffres incorrects
function isPublicSuiviAction(path) {
  const p = pathOnly(path);
  return p.startsWith('/api/suivi/') && !p.startsWith('/api/suivi/dashboard');
}

export function sendsAdminToken(path) {
  const p = pathOnly(path);
  if (p.startsWith('/api/suivi/dashboard')) return true;
  return !NO_ADMIN_TOKEN_PATHS.some((x) => p.startsWith(x));
}

// Code d'un refus d'élévation (admin_requis / admin_expire / admin_invalide), sinon null
function adminRefusalCode(detail) {
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    return ADMIN_REFUSAL_CODES.has(detail.code) ? detail.code : null;
  }
  if (typeof detail === 'string' && ADMIN_REFUSAL_RE.test(detail) && !/\bcode\b/i.test(detail)) return 'admin_requis';
  return null;
}

const PYDANTIC_FR = [
  [/^Field required$/i, 'champ obligatoire'],
  [/^String should have at least (\d+) characters?$/i, (_, n) => `au moins ${n} caractère${n > 1 ? 's' : ''}`],
  [/^String should have at most (\d+) characters?$/i, (_, n) => `${n} caractère${n > 1 ? 's' : ''} maximum`],
  [/^Input should be a valid (integer|number)/i, 'nombre attendu'],
  [/^Input should be a valid string/i, 'texte attendu'],
  [/^Input should be a valid boolean/i, 'oui/non attendu'],
  [/^Input should be greater than or equal to (.+)$/i, (_, n) => `doit être ≥ ${n}`],
  [/^Input should be less than or equal to (.+)$/i, (_, n) => `doit être ≤ ${n}`],
  [/^value is not a valid email address/i, 'adresse e-mail invalide'],
  [/^Extra inputs are not permitted$/i, 'champ non autorisé'],
  [/^Value error, (.+)$/i, (_, m) => m],
];

function traduireMessage(msg) {
  const s = typeof msg === 'string' ? msg.trim() : '';
  for (const [re, fr] of PYDANTIC_FR) {
    const m = s.match(re);
    if (m) return typeof fr === 'function' ? fr(...m) : fr;
  }
  return s || 'valeur invalide';
}

// Message lisible pour `detail` (texte, objet métier {code, message}, ou tableau 422 de Pydantic)
export function formatErrorDetail(detail, status) {
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length) {
    const parts = detail.slice(0, 3).map((d) => {
      if (typeof d === 'string') return d;
      const loc = Array.isArray(d?.loc)
        ? d.loc.filter((x) => typeof x === 'string' && !['body', 'query', 'path', 'header'].includes(x))
        : [];
      const msg = traduireMessage(d?.msg);
      return loc.length ? `${loc.join('.')} : ${msg}` : msg;
    });
    const reste = detail.length > 3 ? ` (+${detail.length - 3})` : '';
    return `Données invalides — ${parts.join(' ; ')}${reste}`;
  }
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    for (const k of ['message', 'msg', 'detail']) {
      if (typeof detail[k] === 'string' && detail[k].trim()) return detail[k];
    }
    if (typeof detail.code === 'string' && detail.code) return `${status ? `Erreur ${status}` : 'Erreur'} (${detail.code})`;
  }
  return status ? `Erreur ${status}` : 'Erreur';
}

// Erreur HTTP : message lisible, status, code métier (detail.code), detail brut (data : ancien nom)
export function httpError(status, detail, headers) {
  const err = new Error(formatErrorDetail(detail, status));
  err.status = status;
  err.detail = detail ?? null;
  err.data = err.detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail) && typeof detail.code === 'string' && detail.code) {
    err.code = detail.code;
  }
  const retry = parseInt(headers?.get?.('retry-after') ?? '', 10);
  if (Number.isFinite(retry) && retry >= 0) err.retryAfter = retry;
  return err;
}

// Expiration (ms) d'un JWT, sans vérifier sa signature (le serveur s'en charge)
function jwtExpiry(token) {
  try {
    const part = String(token).split('.')[1];
    if (!part) return null;
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Jeton de session du stockage partagé par les onglets du poste (null si absent ou stockage indisponible)
function lireJetonStocke() {
  try { return localStorage.getItem('kp_token') || null; } catch { return null; }
}

// Preuve d'accès au suivi public : jeton du lien (t) sinon numéro de téléphone complet (tel).
// Exportée pour les tests ; les 4 derniers chiffres (tel4) ne sont plus acceptés par le serveur.
export function suiviProof(preuve) {
  if (preuve?.t) return { t: String(preuve.t) };
  const tel = String(preuve?.tel || '').replace(/[^\d+]/g, '');
  return tel.replace(/\D/g, '').length >= 9 ? { tel } : {};
}
// Transport de la preuve pour une LECTURE (GET) du suivi : le jeton reste dans l'adresse (c'est le
// lien lui-même, déjà dans le QR / SMS) ; le numéro de téléphone — donnée personnelle — part dans
// l'en-tête X-Suivi-Tel, JAMAIS dans l'URL (journaux d'accès du serveur, historique, Referer) :
// il n'existe plus de repli « ?tel= », le serveur lit l'en-tête sur toutes les lectures du suivi.
export const SUIVI_TEL_HEADER = 'X-Suivi-Tel';
// Jeton de suivi en en-tête (POST /api/parts/auto de la borne) : lu par preuve_suivi comme `t`
export const SUIVI_TOKEN_HEADER = 'X-Suivi-Token';
export function suiviAcces(preuve) {
  const p = suiviProof(preuve);
  if (p.t) return { query: `?t=${encodeURIComponent(p.t)}`, headers: {} };
  if (p.tel) return { query: '', headers: { [SUIVI_TEL_HEADER]: p.tel } };
  return { query: '', headers: {} };
}

// Build stable querystrings — avoids re-allocating URLSearchParams for
// identical param objects (tarifs/iphones are called in tight loops).
const _qsCache = new Map();
function buildQuery(params) {
  if (!params) return '';
  const keys = Object.keys(params);
  if (keys.length === 0) return '';
  // Stable key: sort to make {a,b} === {b,a}
  keys.sort();
  let key = '';
  for (const k of keys) {
    const v = params[k];
    if (v === undefined || v === null || v === '') continue;
    key += `${k}=${v}&`;
  }
  if (!key) return '';
  const cached = _qsCache.get(key);
  if (cached !== undefined) return cached;
  const usp = new URLSearchParams();
  for (const k of keys) {
    const v = params[k];
    if (v === undefined || v === null || v === '') continue;
    usp.set(k, v);
  }
  const qs = '?' + usp.toString();
  // Cap cache growth
  if (_qsCache.size > 200) _qsCache.clear();
  _qsCache.set(key, qs);
  return qs;
}

// Commande de pièce : prix_ht en nombre (virgule acceptée, vide → null), tarif_cle en texte ou null.
// Les autres champs passent tels quels ; absents, ces deux-là ne sont pas ajoutés.
export function commandePayload(data) {
  if (!data || typeof data !== 'object') return data;
  const out = { ...data };
  if ('prix_ht' in out) {
    const brut = out.prix_ht;
    const n = typeof brut === 'string' ? parseFloat(brut.replace(',', '.')) : Number(brut);
    out.prix_ht = brut === '' || brut === null || brut === undefined || !Number.isFinite(n) ? null : Math.round(n * 100) / 100;
  }
  if ('tarif_cle' in out) out.tarif_cle = out.tarif_cle ? String(out.tarif_cle) : null;
  return out;
}

class ApiClient {
  constructor() {
    this.token = lireJetonStocke();
    // In-memory GET cache: Map<url, { ts, data }>
    this._cache = new Map();
    // GET en cours : Map<url, { promise, stale, fresh }> (stale → la réponse ne sera pas mise en cache)
    this._inflight = new Map();
    // GET identiques en vol partagés par get() : Map<url, { promise, seq, token }>
    this._sharedGets = new Map();
    // Incrémenté au début et à la fin de chaque écriture : un GET lancé avant ne sert plus après
    this._mutationSeq = 0;
    // > 0 pendant un appel de fond (polling) : pas de relance
    this._background = 0;
    // Compteur de modifications du catalogue et dernier compteur relu par chemin /tree
    this._catalogRev = 0;
    this._catalogRevLue = new Map();
    // Jeton d'élévation admin (10 min) renvoyé par POST /api/admin/verify
    this._adminToken = null;
    this._adminExp = 0;
    this._restoreAdminToken();
    // Un autre onglet du poste change d'utilisateur ou se connecte : cet onglet adopte aussitôt la
    // nouvelle session (kp_token est partagé). Une déconnexion ailleurs n'est pas reprise ici : c'est
    // la prochaine réponse 401 qui ferme la session de cet onglet (_sessionRefusee).
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('storage', (e) => {
        if (e && e.key !== null && e.key !== 'kp_token') return;
        this.adopterJetonDuPoste();
      });
    }
  }

  setToken(token) {
    const changed = token !== this.token;
    this.token = token;
    if (token) localStorage.setItem('kp_token', token);
    else localStorage.removeItem('kp_token');
    // Auth change → drop any cached data
    this._cache.clear();
    for (const entry of this._inflight.values()) entry.stale = true;
    this._inflight.clear();
    this._sharedGets.clear();
    // Autre session ou déconnexion : l'élévation admin ne suit pas
    if (changed || !token) this.clearAdminToken();
  }

  // Jeton du stockage partagé s'il diffère de `refuse` (un autre onglet a changé d'utilisateur ou
  // s'est reconnecté) : ce client l'adopte et le rend. Null si la session courante est bien celle du
  // poste, ou s'il n'y en a plus.
  _jetonRemplacant(refuse) {
    const stocke = lireJetonStocke();
    if (!stocke || stocke === refuse) return null;
    // Plusieurs réponses 401 en parallèle : la première adopte, les suivantes ne vident plus les caches
    if (stocke !== this.token) this.setToken(stocke);
    return stocke;
  }
  // Reprend la session ouverte par un autre onglet du poste s'il y en a une plus récente ; vrai si changée
  adopterJetonDuPoste() { return Boolean(this._jetonRemplacant(this.token)); }

  // Jeton refusé par le serveur (401, session close) : on l'oublie et on revient à l'accueil — sauf si
  // un autre onglet a rouvert une session entre-temps : on la garde (un ancien jeton ne doit jamais
  // effacer la session d'un collègue sur le même poste). Rend l'erreur à lever.
  _sessionRefusee(refuse) {
    if (!this._jetonRemplacant(refuse)) {
      this.setToken(null);
      window.location.href = '/';
    }
    const e = new Error('Non authentifié');
    e.status = 401;
    return e;
  }

  // ─── Élévation admin ───────────────────────
  setAdminToken(token, ttlMs = ADMIN_TOKEN_TTL) {
    if (!token) { this.clearAdminToken(); return; }
    this._adminToken = token;
    this._adminExp = jwtExpiry(token) ?? Date.now() + ttlMs;
    try { sessionStorage.setItem(ADMIN_TOKEN_KEY, JSON.stringify({ t: token, exp: this._adminExp })); } catch { /* stockage indisponible */ }
  }
  getAdminToken() {
    if (this._adminToken && Date.now() < this._adminExp - 5_000) return this._adminToken;
    if (this._adminToken) this.clearAdminToken();
    return null;
  }
  hasAdminToken() { return Boolean(this.getAdminToken()); }

  // ─── Mode admin de l'interface ─────────────
  setAdminMode(on) {
    try {
      if (on) localStorage.setItem(ADMIN_MODE_KEY, 'true');
      else localStorage.removeItem(ADMIN_MODE_KEY);
    } catch { /* stockage indisponible */ }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(ADMIN_MODE_EVENT, { detail: { admin: Boolean(on) } }));
    }
  }
  // « Verrouiller » : le serveur oublie la preuve du code de ce poste (rôle admin : stats, marketing,
  // prix d'achat HT), puis le navigateur oublie le jeton d'élévation et le mode admin.
  // Une erreur réseau n'empêche jamais le verrouillage local.
  lockAdmin() {
    const envoi = this.token
      ? this.request('/api/admin/lock', { method: 'POST', retries: 0 }).catch(() => null)
      : Promise.resolve(null);
    try { localStorage.removeItem('kp_admin_auth'); } catch { /* stockage indisponible */ }
    this.clearAdminToken();
    this.setAdminMode(false);
    return envoi;
  }
  clearAdminToken() {
    this._adminToken = null;
    this._adminExp = 0;
    try { sessionStorage.removeItem(ADMIN_TOKEN_KEY); } catch { /* stockage indisponible */ }
  }
  _restoreAdminToken() {
    try {
      const v = JSON.parse(sessionStorage.getItem(ADMIN_TOKEN_KEY) || 'null');
      if (v?.t && typeof v.exp === 'number' && v.exp > Date.now()) {
        this._adminToken = v.t;
        this._adminExp = v.exp;
      }
    } catch { /* stockage indisponible */ }
  }

  // Appels de fond (polling) : aucune relance, une erreur attend simplement le tour suivant, et
  // en-tête X-KP-Fond: 1 (pas d'activité du salarié). Les requêtes doivent être lancées de façon
  // synchrone dans `fn` (aucun await ni .then avant l'appel) : le drapeau n'est lu qu'à ce moment.
  background(fn) {
    this._background += 1;
    try {
      return fn();
    } finally {
      this._background -= 1;
    }
  }

  // Invalidate cache entries whose path starts with `prefix`.
  // Called automatically on non-GET requests.
  _invalidate(prefix) {
    this._mutationSeq += 1;
    if (!prefix) return;
    // Normalize: only keep the path up to '?' to match regardless of query
    const base = prefix.split('?')[0];
    for (const key of this._cache.keys()) {
      if (key.startsWith(base)) this._cache.delete(key);
    }
    // Un GET lancé avant la mutation ne doit pas remettre l'ancienne réponse en cache
    for (const [key, entry] of this._inflight) {
      if (key.startsWith(base)) {
        entry.stale = true;
        this._inflight.delete(key);
      }
    }
  }

  // Public wrapper: cached GET with configurable TTL.
  // `fresh` : ignore le cache mémoire et revalide auprès du serveur (cache HTTP du navigateur compris).
  getCached(path, ttl = DEFAULT_CACHE_TTL, { fresh = false } = {}) {
    if (!fresh) {
      const hit = this._cache.get(path);
      if (hit && (Date.now() - hit.ts) < ttl) {
        return Promise.resolve(hit.data);
      }
    }
    // Une requête en cours ne sert une lecture `fresh` que si elle revalide elle aussi
    const pending = this._inflight.get(path);
    if (pending && (pending.fresh || !fresh)) return pending.promise;
    if (pending) pending.stale = true;
    // Même adresse déjà demandée par get() (barre latérale…) et toujours valable : réponse partagée
    const shared = !fresh && !pending ? this._sharedGets.get(path) : null;
    if (shared && shared.seq === this._mutationSeq && shared.token === this.token) {
      return shared.promise.then((data) => {
        if (shared.seq === this._mutationSeq && shared.token === this.token) this._cache.set(path, { ts: Date.now(), data });
        return data;
      });
    }
    const entry = { stale: false, fresh, promise: null };
    entry.promise = this.request(path, fresh ? { cache: 'no-cache' } : {})
      .then((data) => {
        if (!entry.stale) this._cache.set(path, { ts: Date.now(), data });
        return data;
      })
      .finally(() => {
        if (this._inflight.get(path) === entry) this._inflight.delete(path);
      });
    this._inflight.set(path, entry);
    return entry.promise;
  }

  // options : celles de fetch, plus `retries` (GET uniquement, 2 par défaut, 0 en arrière-plan),
  // `auth: false` (ni session ni élévation : borne, dépôt) et `withHeaders` (→ { data, headers }).
  async request(path, options = {}, timeoutMs = 10000) {
    const { retries, auth = true, withHeaders = false, ...fetchOptions } = options;
    const url = `${API_URL}${path}`;
    const headers = { ...fetchOptions.headers };
    // FormData (envoi de fichier) : le navigateur pose lui-même le multipart et sa frontière
    const multipart = typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData;
    if (fetchOptions.body && !multipart) headers['Content-Type'] = 'application/json';
    let bearer = auth ? this.token : null;
    if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
    let adminToken = auth && sendsAdminToken(path) ? this.getAdminToken() : null;
    if (adminToken && !headers['X-Admin-Token']) headers['X-Admin-Token'] = adminToken;
    // Appel de fond (rafraîchissement périodique) : le serveur ne le compte pas comme activité du
    // salarié (journal des connexions) ; un onglet resté ouvert ne prolonge pas la session.
    if (this._background > 0) headers['X-KP-Fond'] = '1';

    const method = String(fetchOptions.method || 'GET').toUpperCase();
    const isGet = method === 'GET' || method === 'HEAD';
    const defaultRetries = this._background > 0 ? 0 : DEFAULT_GET_RETRIES;
    const maxRetries = isGet ? (Number.isInteger(retries) ? Math.max(0, retries) : defaultRetries) : 0;
    if (!isGet) this._mutationSeq += 1;

    try {
      let res = await this._fetchAvecRelances(url, { ...fetchOptions, headers }, timeoutMs, maxRetries);
      // Jeton refusé alors que le stockage du poste en porte un autre (changement d'utilisateur dans
      // un autre onglet) : on adopte cette session et on rejoue une fois, au lieu de l'effacer pour
      // tout le poste. L'élévation admin suivait l'ancienne session : elle ne part pas.
      if (res.status === 401 && bearer) {
        const remplacant = this._jetonRemplacant(bearer);
        if (remplacant) {
          bearer = remplacant;
          const rejeu = { ...headers, Authorization: `Bearer ${bearer}` };
          if (adminToken && rejeu['X-Admin-Token'] === adminToken) delete rejeu['X-Admin-Token'];
          adminToken = null;
          res = await this._fetchAvecRelances(url, { ...fetchOptions, headers: rejeu }, timeoutMs, 0);
        }
      }
      const data = await this._readResponse(res, { path, bearer, adminToken });
      return withHeaders ? { data, headers: res.headers } : data;
    } finally {
      if (!isGet) this._mutationSeq += 1;
    }
  }

  // Un fetch avec délai d'attente, relancé (GET) sur coupure réseau ou 502/503/504 ; rend la réponse
  async _fetchAvecRelances(url, init, timeoutMs, maxRetries) {
    for (let attempt = 0; ; attempt++) {
      if (attempt > 0) await sleep(300 * attempt);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res;
      try {
        res = await fetch(url, { ...init, signal: controller.signal });
      } catch (err) {
        if (err?.name === 'AbortError') {
          const e = new Error('Connexion au serveur expirée (timeout)');
          e.code = 'timeout';
          throw e;
        }
        // Coupure réseau (TypeError) : seul cas d'échec sans réponse que l'on relance
        if (attempt < maxRetries) continue;
        throw err;
      } finally {
        clearTimeout(timer);
      }
      if (RETRY_STATUSES.has(res.status) && attempt < maxRetries) continue;
      return res;
    }
  }

  async _readResponse(res, { path, bearer, adminToken }) {
    if (res.ok) {
      if (res.status === 204) return null;
      const ct = res.headers?.get?.('content-type') || '';
      if (!ct.includes('application/json')) {
        throw new Error('Serveur indisponible (réponse non-JSON)');
      }
      return res.json();
    }
    const body = typeof res.json === 'function' ? await res.json().catch(() => ({})) : {};
    // detail peut être un objet {code, message, …} (409 métier, 403 d'élévation) ou le tableau 422
    const detail = body?.detail;
    const err = httpError(res.status, detail, res.headers);
    if (res.status !== 401 && res.status !== 403) throw err;

    // Élévation admin absente ou expirée : on la redemande, la session reste ouverte.
    // Le jeton n'est oublié que sur un refus explicite du serveur (detail.code), pas sur du texte.
    const refusal = adminRefusalCode(detail);
    if (refusal) {
      if (adminToken && typeof detail === 'object' && refusal !== 'admin_invalide') this.clearAdminToken();
      err.code = 'admin_required';
      err.adminCode = refusal;
      throw err;
    }
    const credential = isCredentialCheck(path) || isPublicSuiviAction(path);
    if (credential || res.status === 403 || !bearer) throw err;

    // Session refusée par le serveur : seule cause de déconnexion (sauf session rouverte ailleurs)
    throw this._sessionRefusee(bearer);
  }

  // Lecture du suivi public avec la preuve (fiche, commandes, has-avis, fidélité, grattage) :
  // jeton `t` en query, numéro de téléphone en en-tête X-Suivi-Tel — jamais dans l'URL, sans
  // repli : un 403 (preuve_requise, verification_echouee, lien_invalide) remonte tel quel. Les
  // écritures (message, devis, avis, grattage) mettent déjà la preuve dans le corps.
  // Avec une preuve (jeton ou numéro), la session du poste n'est jamais jointe : sur un poste
  // connecté (tablette de la boutique), seul le numéro saisi ou le lien décide de l'accès.
  // Sans preuve : session du personnel (QR scanné au comptoir).
  suiviGet(path, preuve) {
    const { query, headers } = suiviAcces(preuve);
    if (headers[SUIVI_TEL_HEADER]) return this.request(path, { headers, auth: false });
    return query ? this.get(`${path}${query}`, { auth: false }) : this.get(path);
  }

  // GET partagé : deux appels identiques en vol ne font qu'une requête, sauf si une écriture
  // a eu lieu entre-temps (la seconde lecture doit voir son effet).
  get(path, options) {
    if (options?.signal) return this.request(path, options);
    const pending = this._sharedGets.get(path);
    if (pending && pending.seq === this._mutationSeq && pending.token === this.token) return pending.promise;
    // Lecture getCached() en vol pour la même adresse (oubliée à chaque écriture) : partagée aussi
    const cached = this._inflight.get(path);
    if (cached && !cached.stale) return cached.promise;
    const entry = { seq: this._mutationSeq, token: this.token, promise: null };
    entry.promise = (options ? this.request(path, options) : this.request(path)).finally(() => {
      if (this._sharedGets.get(path) === entry) this._sharedGets.delete(path);
    });
    this._sharedGets.set(path, entry);
    return entry.promise;
  }
  post(path, data, options) {
    this._invalidate(path);
    return this.request(path, { ...options, method: 'POST', body: JSON.stringify(data) });
  }
  patch(path, data) {
    this._invalidate(path);
    return this.request(path, { method: 'PATCH', body: JSON.stringify(data) });
  }
  put(path, data) {
    this._invalidate(path);
    return this.request(path, { method: 'PUT', body: JSON.stringify(data) });
  }
  delete(path) {
    this._invalidate(path);
    return this.request(path, { method: 'DELETE' });
  }

  // ─── AUTH ──────────────────────────────────
  // `poste` : nom donné à ce poste par l'admin (kp_poste) ; `appareil` : {type, marque, modele,
  // systeme, navigateur} détecté par lib/pointage (indice seulement : le serveur le recoupe)
  async login(pin, target, utilisateur, { poste, appareil } = {}) {
    const data = await this.post('/api/auth/login', {
      pin, target, utilisateur, poste: poste || undefined, appareil: appareil || undefined,
    });
    this.setToken(data.access_token);
    this.forgetAdminMode();
    localStorage.setItem('kp_target', data.target);
    localStorage.setItem('kp_user', data.utilisateur);
    return data;
  }

  // Fin de la session courante dans le journal des connexions (motif « deconnexion »).
  // Envoyée AVANT d'oublier le jeton, en keepalive (survit à la navigation) ; une erreur réseau
  // ou un refus ne bloque jamais la déconnexion locale, et un 401 ne déclenche aucune redirection.
  logoutSession() {
    if (!this.token || typeof fetch !== 'function') return Promise.resolve(false);
    try {
      return fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST', keepalive: true, headers: { Authorization: `Bearer ${this.token}` },
      }).then((r) => r.ok, () => false);
    } catch {
      return Promise.resolve(false);
    }
  }

  logout() {
    this.setToken(null);
    this.forgetAdminMode();
    localStorage.removeItem('kp_target');
    localStorage.removeItem('kp_user');
  }

  // Mode admin de l'interface (Navbar, AdminGuard, reporting) : propre à la lignée de session.
  // Une connexion par PIN en ouvre une nouvelle, que le serveur ne reconnaît qu'après le code
  // admin (auth.exiger_role_admin) ; switch-user la conserve et ne passe pas par ici.
  forgetAdminMode() {
    try {
      localStorage.removeItem('kp_admin_auth');
    } catch { /* stockage indisponible */ }
    this.clearAdminToken();
    this.setAdminMode(false);
  }

  // ─── TICKETS ───────────────────────────────
  getTickets(params = {}) {
    return this.get(`/api/tickets${buildQuery(params)}`);
  }
  getTicket(id) { return this.get(`/api/tickets/${id}`); }
  // Suivi public : fiche d'un ticket avec la preuve ({ t } jeton du lien ou { tel } numéro complet) ;
  // un membre du personnel connecté n'en a pas besoin (session). Plus de recherche par téléphone seul.
  getTicketByCode(code, preuve) { return this.suiviGet(`/api/tickets/code/${encodeURIComponent(code)}`, preuve); }
  // Borne (/client sans session, /depot) : asStaff false → ni session ni élévation, et le client est
  // désigné par la référence signée `client_ref` rendue par createOrGetClient (jamais un client_id nu).
  // Personnel (défaut) : session du poste et client_id.
  createTicket(data, { asStaff = true } = {}) {
    return this.post('/api/tickets', data, asStaff ? undefined : { auth: false });
  }
  createRetourSAV(ticketOriginalId, clientId, data) {
    return this.post('/api/tickets', {
      ...data,
      client_id: clientId,
      est_retour_sav: true,
      ticket_original_id: ticketOriginalId,
    });
  }
  // PATCH partiel → { ok, ticket } (ticket complet comme GET, null si le serveur ne le renvoie pas).
  // keepalive : envoi qui survit à la fermeture de l'onglet (pagehide), sans réponse exploitable.
  // learn : fin de saisie, le serveur apprend panne / détail / modèle pour l'autocomplétion.
  async updateTicket(id, data, { keepalive = false, learn = false } = {}) {
    const path = `/api/tickets/${id}${learn ? '?learn=1' : ''}`;
    if (keepalive) return this.patchKeepalive(path, data);
    const res = await this.patch(path, data);
    return { ...(res || {}), ok: res?.ok !== false, ticket: res?.ticket || null };
  }
  patchKeepalive(path, data) {
    this._invalidate(path);
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    return fetch(`${API_URL}${path}`, {
      method: 'PATCH', keepalive: true, headers, body: JSON.stringify(data),
    }).then((r) => r.ok, () => false);
  }
  // « Rendu au client » / « Clôturé » d'un ticket non réglé ou au prêt sorti : 409, err.code = 'utiliser_restitution'
  changeStatus(id, statut) { return this.patch(`/api/tickets/${id}/statut`, { statut }); }
  deleteTicket(id) { return this.delete(`/api/tickets/${id}`); }
  getKPI() { return this.get('/api/tickets/stats/kpi'); }
  // params : search, statut, limit, offset, vue ('actifs' | 'archives' | 'tous'), date_from, date_to (YYYY-MM-DD), tech
  getDashboard(params = {}) {
    return this.get(`/api/tickets/stats/dashboard${buildQuery(params)}`);
  }
  addNote(id, note) { return this.post(`/api/tickets/${id}/note?note=${encodeURIComponent(note)}`); }
  addHistory(id, texte) { return this.post(`/api/tickets/${id}/historique?texte=${encodeURIComponent(texte)}`); }
  getHistorique(id) { return this.get(`/api/tickets/${id}/historique`); }
  togglePaye(id) { return this.patch(`/api/tickets/${id}/paye`, {}); }
  // Valeur explicite (idempotent : un double clic ne bascule pas) → { ok, paye, points_fidelite }
  setPaye(id, paye) { return this.patch(`/api/tickets/${id}/paye`, { paye: !!paye }); }
  // Remise au client atomique. body : { paiement: 'deja_paye'|'encaisser'|'non_paye', mode_paiement,
  // montant, motif_non_paye, pret_restitue, confirmer_non_termine } → { ok, deja_rendu, ticket, points_fidelite }
  // 409 : err.code = 'reste_a_payer'|'pret_non_restitue'|'non_termine'|'motif_requis', err.detail = { code, message, reste }
  restitution(id, body) { return this.post(`/api/tickets/${id}/restitution`, body); }
  getRepairQueue(tech) {
    const qs = tech ? `?tech=${encodeURIComponent(tech)}` : '';
    return this.get(`/api/tickets/queue/repair${qs}`);
  }
  // Appel téléphonique noté sur le ticket (note 'appel', auteur = membre connecté) → { contact, note_id }.
  // Les autres canaux (SMS, e-mail, WhatsApp) sont tracés par leurs propres envois.
  contacterClient(ticketId, note) {
    return this.post(`/api/tickets/${ticketId}/contact`, note ? { canal: 'appel', note } : { canal: 'appel' });
  }

  // ─── GRILLE TARIFAIRE + FICHE DE RÉCEPTION (fiche ticket) ───
  // → { modele_trouve, suggestions: [{ source, id, label, type_piece, qualite, prix (TTC client), stock, cout_ht }] }
  // cout_ht n'est renseigné que pour le rôle admin (null sinon)
  getGrilleSuggestions({ marque, modele, categorie, q, limit = 20 } = {}) {
    return this.get(`/api/grille/suggestions${buildQuery({ marque, modele, categorie, q, limit })}`);
  }
  // → { items: object | null, complete, auteur, date_maj } (phase d'entrée)
  getReception(ticketId) { return this.get(`/api/tickets/${ticketId}/reception`); }
  // data : { items, complete } → même objet. keepalive : envoi à la fermeture de l'onglet, sans réponse.
  saveReception(ticketId, data, { keepalive = false } = {}) {
    const path = `/api/tickets/${ticketId}/reception`;
    if (!keepalive) return this.put(path, data);
    this._invalidate(path);
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    return fetch(`${API_URL}${path}`, {
      method: 'PUT', keepalive: true, headers, body: JSON.stringify(data),
    }).then((r) => r.ok, () => false);
  }

  // ─── RECHERCHE (staff) ─────────────────────
  // Recherche globale groupée : { q, resolved, groups: { tickets, clients, devis, commandes } }
  search(q, limit = 8) {
    return this.get(`/api/search${buildQuery({ q, limit })}`);
  }
  // Code scanné ou tapé (QR, KP-000123, 123, IMEI) → { type, id, ticket_code } ; 404 si inconnu
  resolveCode(code) {
    return this.get(`/api/search/resolve${buildQuery({ code })}`);
  }

  // ─── CLIENTS ───────────────────────────────
  getClients(params = {}) {
    return this.get(`/api/clients${buildQuery(params)}`);
  }
  getClient(id) { return this.get(`/api/clients/${id}`); }
  getClientByTel(tel) { return this.get(`/api/clients/tel/${encodeURIComponent(tel)}`); }
  // Borne (/client) et dépôt (/depot) : jamais le jeton du poste, même connecté (même SPA que le
  // staff). Le serveur ne fait alors que compléter les champs vides et ne renvoie que { id }.
  createOrGetClient(data, { asStaff = false } = {}) {
    return this.post('/api/clients', data, asStaff ? undefined : { auth: false });
  }
  updateClient(id, data) { return this.patch(`/api/clients/${id}`, data); }
  deleteClient(id) { return this.delete(`/api/clients/${id}`); }
  getClientTickets(id) { return this.get(`/api/clients/${id}/tickets`); }

  // ─── RGPD ──────────────────────────────────
  // Politique de confidentialité (publique) : ni session ni élévation
  getConfidentialite() { return this.get('/api/public/confidentialite', { auth: false }); }
  // Routes admin (élévation) : jamais servies depuis un cache, jamais relancées
  rgpdExport(clientId) {
    return this.request(`/api/rgpd/clients/${clientId}/export`, { retries: 0, cache: 'no-store' }, 30000);
  }
  rgpdAnonymiser(clientId) {
    this._invalidate('/api/clients');
    this._invalidate('/api/tickets');
    return this.post(`/api/rgpd/clients/${clientId}/anonymiser`, {});
  }
  rgpdRetentionApercu() { return this.request('/api/rgpd/retention/apercu', { retries: 0, cache: 'no-store' }); }
  rgpdRetentionAppliquer() {
    this._invalidate('/api/clients');
    this._invalidate('/api/tickets');
    return this.request('/api/rgpd/retention/appliquer', { method: 'POST', body: '{}' }, 60000);
  }

  // ─── CATALOG ───────────────────────────────
  getCategories() { return this.get('/api/catalog/categories'); }
  getPannes() { return this.get('/api/catalog/pannes'); }
  getMarques(categorie) { return this.get(`/api/catalog/marques?categorie=${encodeURIComponent(categorie)}`); }
  getModeles(categorie, marque) { return this.get(`/api/catalog/modeles?categorie=${encodeURIComponent(categorie)}&marque=${encodeURIComponent(marque)}`); }
  // Arbre marques → modèles d'une catégorie (public, mis en cache 10 min).
  // Après une modification du catalogue, la relecture suivante de chaque arbre contourne le cache HTTP.
  getCatalogTree(categorie, { fresh = false } = {}) {
    const path = `/api/catalog/tree?categorie=${encodeURIComponent(categorie)}`;
    const rev = this._catalogRev;
    const revalider = fresh || (this._catalogRevLue.get(path) ?? 0) < rev;
    return this.getCached(path, 10 * 60_000, { fresh: revalider }).then((data) => {
      if (revalider && (this._catalogRevLue.get(path) ?? 0) < rev) this._catalogRevLue.set(path, rev);
      return data;
    });
  }
  getAllCatalog() { return this.get('/api/catalog/all'); }
  addMarque(categorie, marque) { return this._mutateCatalog(this.post(`/api/catalog/marques?categorie=${encodeURIComponent(categorie)}&marque=${encodeURIComponent(marque)}`)); }
  addModele(categorie, marque, modele) { return this._mutateCatalog(this.post(`/api/catalog/modeles?categorie=${encodeURIComponent(categorie)}&marque=${encodeURIComponent(marque)}&modele=${encodeURIComponent(modele)}`)); }
  // payload : { categorie, marque, annee: number|null, modeles: string[] (≤ 500) } → { ok, ajoutes, reactives }
  bulkAddModeles(payload) { return this._mutateCatalog(this.post('/api/catalog/modeles/bulk', payload)); }
  deleteMarque(categorie, marque) { return this._mutateCatalog(this.delete(`/api/catalog/marques?categorie=${encodeURIComponent(categorie)}&marque=${encodeURIComponent(marque)}`)); }
  deleteModele(categorie, marque, modele) { return this._mutateCatalog(this.delete(`/api/catalog/modeles?categorie=${encodeURIComponent(categorie)}&marque=${encodeURIComponent(marque)}&modele=${encodeURIComponent(modele)}`)); }
  // post/delete n'invalident que leur propre chemin : on purge tout /api/catalog/ (dont /tree),
  // aussi après la réponse pour écarter un arbre relu pendant la mutation.
  async _mutateCatalog(request) {
    this._invalidate('/api/catalog/');
    try {
      return await request;
    } finally {
      this._catalogRev += 1;
      this._invalidate('/api/catalog/');
    }
  }

  // ─── AUTOCOMPLETE ───────────────────────────
  searchAutocomplete(categorie, q, limit = 8) {
    return this.get(`/api/autocomplete/search?categorie=${encodeURIComponent(categorie)}&q=${encodeURIComponent(q)}&limit=${limit}`);
  }
  learnTerm(categorie, terme) {
    return this.post('/api/autocomplete/learn', { categorie, terme });
  }

  // ─── TEAM ──────────────────────────────────
  getTeam() { return this.get('/api/team'); }
  getActiveTeam() { return this.get('/api/team/active'); }
  createTeamMember(data, adminCode) {
    const qs = adminCode ? `?admin_code=${encodeURIComponent(adminCode)}` : '';
    return this.post(`/api/team${qs}`, data);
  }
  updateTeamMember(id, data, adminCode) {
    const qs = adminCode ? `?admin_code=${encodeURIComponent(adminCode)}` : '';
    return this.patch(`/api/team/${id}${qs}`, data);
  }
  deleteTeamMember(id) { return this.delete(`/api/team/${id}`); }

  // ─── PARTS ─────────────────────────────────
  getParts(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/api/parts${qs ? '?' + qs : ''}`);
  }
  getPartsByTicket(ticketId) { return this.get(`/api/parts?ticket_id=${ticketId}`); }
  getPublicCommandes(ticketCode, preuve) { return this.suiviGet(`/api/parts/public/${encodeURIComponent(ticketCode)}`, preuve); }
  // prix_ht (HT réellement payé) et tarif_cle (« tarifs:123 ») : le serveur en tire une proposition
  // de mise à jour de la grille, jamais une écriture directe du prix
  createPart(data) { return this.post('/api/parts', commandePayload(data)); }
  // Borne (asStaff false) : sans session, la preuve de suivi du ticket visé est exigée — `t` = le
  // suivi_token rendu à la création du ticket, dans le corps et en en-tête X-Suivi-Token (preuve_suivi
  // lit l'un ou l'autre). Personnel (défaut) : session du poste, inchangé.
  createPartAuto(data, { asStaff = true } = {}) {
    if (asStaff) return this.post('/api/parts/auto', data);
    const headers = {};
    if (data?.t) headers[SUIVI_TOKEN_HEADER] = String(data.t);
    else if (data?.tel) headers[SUIVI_TEL_HEADER] = String(data.tel);
    return this.post('/api/parts/auto', data, { auth: false, headers });
  }
  updatePart(id, data) { return this.patch(`/api/parts/${id}`, commandePayload(data)); }
  deletePart(id) { return this.delete(`/api/parts/${id}`); }

  // ─── ÉQUIPE : journal des connexions et pointage de présence ───
  // `jeton` : celui de la session qui a lancé le pointage (lib/pointage) ; l'envoi ne peut jamais
  // tomber sur la session d'un autre salarié qui aurait pris le poste entre-temps.
  _jetonPointage(jeton) {
    return jeton ? { auth: false, headers: { Authorization: `Bearer ${jeton}` } } : {};
  }
  // Poste du salarié : { actif } seulement (pointage désactivé par défaut) ; jamais relancé
  getPositionConfig(jeton) {
    return this.request('/api/equipe/position/config', { retries: 0, cache: 'no-store', ...this._jetonPointage(jeton) });
  }
  // Une seule fois par session : { lat, lng, precision_m } | { refus: true } | { indisponible: true }.
  // Le serveur ne garde que le statut et la distance arrondie, jamais les coordonnées.
  envoyerPosition(payload, jeton) {
    return this.request('/api/equipe/position', {
      method: 'POST', body: JSON.stringify(payload), ...this._jetonPointage(jeton),
    });
  }
  // Admin (rôle + code) : chaque consultation est tracée côté serveur → jamais de relance automatique
  getActiviteEquipe(semaine) {
    return this.request(`/api/equipe/activite${buildQuery({ semaine })}`, { retries: 0, cache: 'no-store' });
  }
  getSessionsEquipe(utilisateur, jour) {
    return this.request(`/api/equipe/sessions${buildQuery({ utilisateur, jour })}`, { retries: 0, cache: 'no-store' });
  }
  getReglagesEquipe() { return this.request('/api/equipe/reglages', { retries: 0, cache: 'no-store' }); }
  updateReglagesEquipe(data) { return this.put('/api/equipe/reglages', data); }
  // Remise de la note (version en vigueur) : sans corps → tous les salariés actifs ;
  // { membres: [noms] } → ces salariés ; { retirer: [noms] } → confirmation retirée
  confirmerInformationRemise(corps = {}) { return this.post('/api/equipe/reglages/information-remise', corps); }
  // Tous les postes (celui de l'admin compris) devront ressaisir leur PIN
  deconnecterToutLeMonde() { return this.post('/api/equipe/deconnecter-tout', {}); }
  // Coordonnées de la BOUTIQUE lues sur un poste de la boutique (refusées si trop imprécises)
  enregistrerPositionBoutique(lat, lng, precision_m) {
    return this.post('/api/equipe/reglages/position-boutique', { lat, lng, precision_m });
  }
  // CSV de la semaine (depuis/jusqua) ou d'un salarié (réponse à une demande d'accès)
  exportActiviteEquipe({ utilisateur, depuis, jusqua } = {}, filename = 'activite_equipe.csv') {
    return this.exportFile(`/api/equipe/export.csv${buildQuery({ utilisateur, depuis, jusqua })}`, filename);
  }

  // ─── CONFIG ────────────────────────────────
  getConfig() { return this.get('/api/config'); }
  getPublicConfig() { return this.get('/api/config/public'); }
  setParam(cle, valeur) { return this.put('/api/config', { cle, valeur }); }
  setParams(params) { return this.put('/api/config/batch', params); }
  changePin(target, old_pin, new_pin) { return this.post('/api/config/change-pin', { target, old_pin, new_pin }); }
  testDiscord() { return this.post('/api/config/test-discord'); }
  // Export lourd : jamais relancé automatiquement (chaque relance refait l'export complet côté serveur)
  getBackup() { return this.request('/api/config/backup', { retries: 0, cache: 'no-store' }, 120_000); }
  importBackup(data) {
    this._invalidate('/api/');
    return this.request('/api/config/backup/import', { method: 'POST', body: JSON.stringify(data) }, 180_000);
  }
  // Fichier téléchargé (export clients : élévation admin exigée par le serveur, jeton envoyé comme
  // request()). Refus d'élévation : err.code = 'admin_required', comme request() (useAdminElevation).
  async exportFile(path, filename) {
    const url = `${API_URL}${path}`;
    const headers = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const adminToken = sendsAdminToken(path) ? this.getAdminToken() : null;
    if (adminToken) headers['X-Admin-Token'] = adminToken;
    const res = await fetch(url, { headers, cache: 'no-store' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = httpError(res.status, body?.detail, res.headers);
      const refusal = res.status === 401 || res.status === 403 ? adminRefusalCode(body?.detail) : null;
      if (refusal) {
        if (adminToken && typeof body?.detail === 'object' && refusal !== 'admin_invalide') this.clearAdminToken();
        err.code = 'admin_required';
        err.adminCode = refusal;
      }
      throw err;
    }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(blobUrl);
  }
  exportClientsCsv() { return this.exportFile('/api/clients/export/csv', 'clients_klikphone.csv'); }
  exportClientsExcel() { return this.exportFile('/api/clients/export/excel', 'clients_klikphone.xlsx'); }

  // ─── NOTIFICATIONS ─────────────────────────
  getTemplates() { return this.get('/api/notifications/templates'); }
  generateMessage(ticketId, templateKey) {
    return this.post(`/api/notifications/generate-message?ticket_id=${ticketId}&template_key=${templateKey}`);
  }
  sendWhatsApp(ticketId, message) {
    return this.post(`/api/notifications/whatsapp?ticket_id=${ticketId}&message=${encodeURIComponent(message)}`);
  }
  // Vrai SMS envoyé par le serveur (Brevo). 409 « sms_non_configure » (detail.link = lien sms:
  // de repli), 409 « sms_doublon », 424 refus/panne Brevo : err.message est toujours lisible.
  envoyerSms(ticketId, message, libelle) {
    this._invalidate('/api/notifications/sms');
    return this.request('/api/notifications/sms', {
      method: 'POST',
      body: JSON.stringify({ ticket_id: ticketId, message, libelle: libelle || null }),
    }, 20000);
  }
  // { cle_configuree, active, disponible, expediteur } — jamais la clé
  getSmsEtat({ fresh = false } = {}) { return this.getCached('/api/notifications/sms/etat', 60_000, { fresh }); }
  getSmsCredits() { return this.get('/api/notifications/sms/credits', { retries: 0 }); }
  sendEmail(ticketId, message, sujet) {
    return this.request(`/api/notifications/email?ticket_id=${ticketId}&message=${encodeURIComponent(message)}&sujet=${encodeURIComponent(sujet)}`, { method: 'POST' }, 45000);
  }

  // ─── PRINT ─────────────────────────────────
  // Les documents d'impression exigent le jeton : on les récupère par fetch (texte ou blob)
  // puis l'aperçu les affiche en srcdoc / URL blob, jamais via une URL directe.
  async requestRaw(path, { as = 'text', signal, timeoutMs = 20000 } = {}) {
    let bearer = this.token;
    const headers = {};
    if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
    const controller = new AbortController();
    const relayAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', relayAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let res = await fetch(`${API_URL}${path}`, { headers, signal: controller.signal, cache: 'no-store' });
      if (res.status === 401 && bearer) {
        // Session remplacée par un autre onglet du poste : rejouer une fois avec son jeton
        const remplacant = this._jetonRemplacant(bearer);
        if (remplacant) {
          bearer = remplacant;
          const rejeu = { ...headers, Authorization: `Bearer ${bearer}` };
          res = await fetch(`${API_URL}${path}`, { headers: rejeu, signal: controller.signal, cache: 'no-store' });
        }
      }
      if (res.status === 401) throw this._sessionRefusee(bearer);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw httpError(res.status, body?.detail, res.headers);
      }
      return as === 'blob' ? await res.blob() : await res.text();
    } catch (err) {
      if (err.name === 'AbortError') {
        if (signal?.aborted) throw err;
        throw new Error('Connexion au serveur expirée (timeout)');
      }
      if (err.name === 'TypeError') throw new Error('Serveur injoignable');
      throw err;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', relayAbort);
    }
  }
  getPrintHtml(ticketId, type, { signal } = {}) {
    return this.requestRaw(`/api/tickets/${ticketId}/print/${encodeURIComponent(type)}`, { signal });
  }
  getPdfBlob(ticketId, type, { signal } = {}) {
    return this.requestRaw(`/api/tickets/${ticketId}/pdf/${encodeURIComponent(type)}`, { as: 'blob', signal, timeoutMs: 30000 });
  }
  // URL publiques absolues (jeton aléatoire) à envoyer au client : client, devis, recu, devis_pdf, recu_pdf
  getShareLinks(ticketId) {
    return this.get(`/api/tickets/${ticketId}/share-links`);
  }
  getDevisPrintHtml(id, { signal } = {}) {
    return this.requestRaw(`/api/devis/${id}/print`, { signal });
  }

  // ─── CAISSE ────────────────────────────────
  sendToCaisse(ticketId) {
    return this.post(`/api/caisse/send?ticket_id=${ticketId}`);
  }
  envoyerCaisse(data) {
    return this.post('/api/caisse/envoyer', data);
  }
  getCaisseConfig() {
    return this.get('/api/config/caisse');
  }
  saveCaisseConfig(data) {
    return this.put('/api/config/caisse', data);
  }
  testCaisseConnexion() {
    return this.post('/api/config/caisse/test');
  }
  getCaisseRayons() {
    return this.get('/api/caisse/rayons');
  }

  // ─── EMAIL ──────────────────────────────
  envoyerEmail(to, subject, body) {
    return this.request('/api/email/envoyer', { method: 'POST', body: JSON.stringify({ to, subject, body }) }, 45000);
  }
  sendDocument(ticketId, docType, to) {
    return this.request('/api/email/send-document', { method: 'POST', body: JSON.stringify({ ticket_id: ticketId, doc_type: docType, to }) }, 45000);
  }
  testSmtpEmail(to) {
    return this.request('/api/email/test', { method: 'POST', body: JSON.stringify({ to }) }, 45000);
  }

  // ─── ATTESTATION ───────────────────────────
  generateAttestation(data) {
    return this.post('/api/attestation/generate', data);
  }
  emailAttestation(data, email, format = 'pdf') {
    return this.post(`/api/attestation/email?destinataire=${encodeURIComponent(email)}&format=${encodeURIComponent(format)}`, data);
  }
  async downloadAttestationPdf(data) {
    const url = `${API_URL}/api/attestation/pdf`;
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(data) });
    if (!res.ok) throw new Error('Erreur PDF');
    return res.blob();
  }
  async downloadAttestationDocx(data) {
    const url = `${API_URL}/api/attestation/docx`;
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(data) });
    if (!res.ok) throw new Error('Erreur Word');
    return res.blob();
  }
  getAttestationHistory(clientId) {
    const qs = clientId ? `?client_id=${clientId}` : '';
    return this.get(`/api/attestation/history${qs}`);
  }
  getAttestation(id) {
    return this.get(`/api/attestation/history/${id}`);
  }

  // ─── FIDELITE ─────────────────────────────────
  getFidelite(clientId) { return this.get(`/api/fidelite/${clientId}`); }
  getFideliteByTicket(ticketCode, preuve) { return this.suiviGet(`/api/fidelite/ticket/${encodeURIComponent(ticketCode)}`, preuve); }
  crediterPoints(data) { return this.post('/api/fidelite/crediter', data); }
  utiliserPoints(data) { return this.post('/api/fidelite/utiliser', data); }
  // Carte à gratter du suivi public : même preuve que la fiche (état : jeton en query / numéro en
  // en-tête, cf. suiviGet ; grattage : preuve dans le corps)
  getGrattage(ticketCode, preuve) { return this.suiviGet(`/api/fidelite/grattage/${encodeURIComponent(ticketCode)}`, preuve); }
  gratter(ticketCode, preuve) { return this.post(`/api/fidelite/grattage/${encodeURIComponent(ticketCode)}`, suiviProof(preuve)); }
  consommerBonGrattage(clientId, ticketId = null) {
    return this.post('/api/fidelite/consommer-bon', { client_id: clientId, ticket_id: ticketId });
  }

  // ─── TRACKING ─────────────────────────────────
  trackEvent(eventType, source, target) {
    // Fire-and-forget : ne bloque jamais la navigation
    return this.request('/api/tracking/event', {
      method: 'POST',
      body: JSON.stringify({ event_type: eventType, source, target }),
    }).catch(() => {});
  }
  getTrackingStats(eventType = 'tarifs_click', days = 30) {
    return this.get(`/api/tracking/stats?event_type=${eventType}&days=${days}`);
  }

  // ─── ADMIN ──────────────────────────────────
  // → { success, admin_token, expires_in } : le jeton (10 min) part ensuite en X-Admin-Token
  // (sauf vers les routes publiques)
  async verifyAdmin(login, password) {
    const res = await this.post('/api/admin/verify', { login, password });
    if (res?.admin_token) {
      const ttl = Number(res.expires_in) > 0 ? Number(res.expires_in) * 1000 : undefined;
      this.setAdminToken(res.admin_token, ttl);
    }
    return res;
  }
  changeAdminPassword(old_password, new_password) {
    return this.post('/api/admin/change-password', { old_password, new_password });
  }
  getAdminStats(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/api/admin/stats${qs ? '?' + qs : ''}`);
  }
  getAdminReparations(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/api/admin/reparations${qs ? '?' + qs : ''}`);
  }
  getAdminFluxClients(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/api/admin/flux-clients${qs ? '?' + qs : ''}`);
  }
  getAdminPerformanceTech(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/api/admin/performance-tech${qs ? '?' + qs : ''}`);
  }
  getAdminEvolution(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/api/admin/evolution${qs ? '?' + qs : ''}`);
  }
  // New admin stats endpoints (all accept optional date_start, date_end)
  _adminQs(params = {}) {
    const p = {};
    if (params.date_start) p.date_start = params.date_start;
    if (params.date_end) p.date_end = params.date_end;
    const qs = new URLSearchParams(p).toString();
    return qs ? '?' + qs : '';
  }
  getAdminOverview(p) { return this.get(`/api/admin/stats/overview${this._adminQs(p)}`); }
  getAdminReparationsParTech(days = 7, p = {}) {
    const extra = this._adminQs(p);
    const sep = extra ? '&' : '?';
    return this.get(`/api/admin/stats/reparations-par-tech?days=${days}${extra ? '&' + extra.slice(1) : ''}`);
  }
  getAdminAffluenceHeure(p) { return this.get(`/api/admin/stats/affluence-heure${this._adminQs(p)}`); }
  getAdminAffluenceJour(p) { return this.get(`/api/admin/stats/affluence-jour${this._adminQs(p)}`); }
  getAdminRepartitionMarques(p) { return this.get(`/api/admin/stats/repartition-marques${this._adminQs(p)}`); }
  getAdminRepartitionPannes(p) { return this.get(`/api/admin/stats/repartition-pannes${this._adminQs(p)}`); }
  getAdminEvolutionCA(p) { return this.get(`/api/admin/stats/evolution-ca${this._adminQs(p)}`); }
  getAdminTempsReparation(p) { return this.get(`/api/admin/stats/temps-reparation${this._adminQs(p)}`); }
  getAdminTauxConversion(p) { return this.get(`/api/admin/stats/taux-conversion${this._adminQs(p)}`); }
  getAdminTopClients(p) { return this.get(`/api/admin/stats/top-clients${this._adminQs(p)}`); }

  // ─── REPORTING ───────────────────────────────
  getReporting(params = {}) {
    const qs = new URLSearchParams();
    if (params.debut) qs.set('debut', params.debut);
    if (params.fin) qs.set('fin', params.fin);
    if (params.granularite) qs.set('granularite', params.granularite);
    const s = qs.toString();
    return this.get(`/api/reporting${s ? '?' + s : ''}`);
  }

  // ─── MESSAGE TEMPLATES ────────────────────────
  getMessageTemplates() { return this.get('/api/config/message-templates'); }
  saveMessageTemplates(templates) { return this.put('/api/config/message-templates', { templates }); }
  logMessage(ticketId, auteur, contenu, canal) {
    return this.post(`/api/tickets/${ticketId}/message-log?auteur=${encodeURIComponent(auteur)}&contenu=${encodeURIComponent(contenu)}&canal=${encodeURIComponent(canal)}`);
  }

  // ─── ÉTAGÈRE (emplacement, relances, mise en demeure) ─────────────
  // { emplacements: [str], delai_abandon_jours, relance_paliers: [int] } (paramètres ETAGERE_*)
  getEtagereConfig({ fresh = false } = {}) { return this.getCached('/api/etagere/config', 5 * 60_000, { fresh }); }
  // emplacement null = retiré → { emplacement }
  setEmplacement(ticketId, emplacement) {
    return this.put(`/api/etagere/${ticketId}/emplacement`, { emplacement: emplacement || null });
  }
  // canal : 'sms' | 'whatsapp' | 'email' | 'appel' → { nb_relances, derniere_relance }
  logRelance(ticketId, canal, contenu) { return this.post(`/api/etagere/${ticketId}/relance`, { canal, contenu }); }
  // Message déjà rendu (palier selon les jours d'attente) → { message, jours }
  getMessageRelance(ticketId) { return this.get(`/api/etagere/${ticketId}/message-relance`); }
  // Courrier A4 (impression comme getPrintHtml : jeton requis, affiché en srcdoc par PrintPreview)
  getMiseEnDemeureHtml(ticketId, { signal } = {}) {
    return this.requestRaw(`/api/etagere/${ticketId}/mise-en-demeure`, { signal });
  }

  // ─── NOTES PRIVÉES ────────────────────────────
  getNotes(ticketId) { return this.get(`/api/tickets/${ticketId}/notes`); }
  addPrivateNote(ticketId, auteur, contenu, important = false) {
    return this.post(`/api/tickets/${ticketId}/notes?auteur=${encodeURIComponent(auteur)}&contenu=${encodeURIComponent(contenu)}&important=${important}`);
  }
  deleteNote(ticketId, noteId) { return this.delete(`/api/tickets/${ticketId}/notes/${noteId}`); }
  toggleNoteImportant(ticketId, noteId, important) {
    return this.patch(`/api/tickets/${ticketId}/notes/${noteId}?important=${important}`, {});
  }

  // ─── CHAT ───────────────────────────────────
  chatAI(message, user, conversationId, role) {
    return this.post('/api/chat/ai', { message, user, conversation_id: conversationId, role: role || '' });
  }
  clearAIConversation(convId) {
    return this.delete(`/api/chat/ai/conversation/${convId}`);
  }
  chatTeamSend(message, sender, recipient = 'all') {
    return this.post('/api/chat/team/send', { message, sender, recipient });
  }
  chatTeamMessages(user, channel = 'all', limit = 50) {
    return this.get(`/api/chat/team/messages?user=${encodeURIComponent(user)}&channel=${channel}&limit=${limit}`);
  }
  chatTeamContacts(user) {
    return this.get(`/api/chat/team/contacts?user=${encodeURIComponent(user)}`);
  }
  chatTeamConversation(user, contact) {
    return this.get(`/api/chat/team/conversation?user=${encodeURIComponent(user)}&with=${encodeURIComponent(contact)}`);
  }
  chatTeamMarkRead(user, contact) {
    const qs = contact ? `&contact=${encodeURIComponent(contact)}` : '';
    return this.put(`/api/chat/team/read?user=${encodeURIComponent(user)}${qs}`);
  }
  chatTeamUnread(user) {
    return this.get(`/api/chat/team/unread?user=${encodeURIComponent(user)}`);
  }
  chatTeamUnreadTotal(user) {
    return this.get(`/api/chat/team/unread/total?user=${encodeURIComponent(user)}`);
  }

  // ─── NOTIFICATIONS CENTER ──────────────────
  notifsList(user, unreadOnly = false, limit = 30) {
    const qs = new URLSearchParams({ user, unread_only: String(unreadOnly), limit: String(limit) }).toString();
    return this.get(`/api/notifications-center?${qs}`);
  }
  // Liste + nombre de non lues (en-tête X-Unread-Count) en une seule requête → { items, unread }.
  // Réponse avec ETag : tant que rien ne change, le serveur répond 304 sans corps.
  async notifsFeed(limit = 30) {
    const { data, headers } = await this.request(
      `/api/notifications-center${buildQuery({ unread_only: 'false', limit })}`,
      { withHeaders: true },
    );
    const items = Array.isArray(data) ? data : [];
    const header = headers?.get?.('x-unread-count');
    const unread = header != null && header !== '' && Number.isFinite(Number(header))
      ? Number(header)
      : items.filter((n) => !n.is_read).length;
    return { items, unread };
  }
  notifsUnreadCount(user) {
    return this.get(`/api/notifications-center/unread-count?user=${encodeURIComponent(user)}`);
  }
  notifsMarkRead(id, user) {
    return this.post(`/api/notifications-center/${id}/read?user=${encodeURIComponent(user)}`, {});
  }
  notifsMarkAllRead(user) {
    return this.post(`/api/notifications-center/mark-all-read?user=${encodeURIComponent(user)}`, {});
  }
  notifsDelete(id) {
    return this.delete(`/api/notifications-center/${id}`);
  }

  // ─── TARIFS ────────────────────────────────
  getTarifs(params = {}) {
    // Cached 30s — large payload, safe to reuse across rapid nav
    return this.getCached(`/api/tarifs${buildQuery(params)}`);
  }
  getTarifsStats() {
    return this.getCached('/api/tarifs/stats');
  }
  importTarifs(items) {
    return this.request('/api/tarifs/import', { method: 'POST', body: JSON.stringify({ items }) });
  }
  clearTarifs() {
    return this.request('/api/tarifs/clear', { method: 'DELETE' });
  }
  toggleTarifStock(id) {
    return this.request(`/api/tarifs/${id}/stock`, { method: 'PATCH' });
  }
  checkTarifStock() {
    return this.request('/api/tarifs/check-stock', { method: 'POST' }, 300000);
  }
  // ─── TARIFS REPARATION (grille iPhone) ────
  getTarifsReparation() {
    return this.getCached('/api/tarifs/reparation');
  }
  updateTarifReparation(id, data) {
    return this.put(`/api/tarifs/reparation/${id}`, data);
  }
  bulkTarifsReparation(items) {
    return this.post('/api/tarifs/reparation/bulk', items);
  }
  addTarifReparation(modele) {
    return this.post('/api/tarifs/reparation/add', { modele });
  }
  deleteTarifReparation(id) {
    return this.delete(`/api/tarifs/reparation/${id}`);
  }
  reorderTarifsReparation(items) {
    return this.post('/api/tarifs/reparation/reorder', items);
  }

  getAppleDevices() {
    return this.get('/api/tarifs/apple-devices');
  }
  importAppleDevices(items) {
    return this.request('/api/tarifs/apple-devices/import', { method: 'POST', body: JSON.stringify({ items }) });
  }

  // ─── MOTEUR DE PRIX (écrans admin) ─────────
  // Toute écriture exige l'élévation admin côté serveur (403 admin_requis → useAdminElevation).
  // Après une écriture, les listes de prix en cache (pièces, grilles boutique, suggestions) sont oubliées.
  _apresEcriturePrix() {
    ['/api/tarifs', '/api/iphone-tarifs', '/api/smartphones-tarifs', '/api/grille'].forEach((p) => this._invalidate(p));
  }
  async _ecriturePrix(path, body, timeoutMs) {
    try {
      return await this.request(path, { method: 'POST', body: JSON.stringify(body ?? {}) }, timeoutMs);
    } finally {
      this._apresEcriturePrix();
    }
  }
  // → { modifies, inchanges, verrouilles, sans_prix_achat, ignores, lot_id } (lot annulable)
  recalculerTarifs() { return this._ecriturePrix('/api/tarifs/recalculate', {}, 60_000); }
  // → règles de marge (TARIFS_REGLES) : { tva, ecran: {standard, haut_de_gamme, pliant}, autre, ipad, macbook, arrondi, seuil_marge_alerte, … }
  getReglesPrix() { return this.request('/api/tarifs/regles', { cache: 'no-store' }); }
  // Encadré « Méthode de calcul » (tout le personnel) : { admin, texte, regles, exemple } ;
  // montants des marges, regles et exemple servis au seul rôle admin prouvé
  getMethodeCalcul() { return this.request('/api/tarifs/methode-calcul', { cache: 'no-store' }); }
  // payload : { regles } ou { cible, filtre: { marque, modele, type_piece, ids, colonne }, ajustement: { type: 'pct'|'eur', valeur } }
  // → { modifies, inchanges, verrouilles, ignores, variation_moy|min|max (€), variation_moy_pct (%), alertes,
  //     ecarts: [{ cle, label, ancien, nouveau, alerte, alertes, ancien_ht?, nouveau_ht? }], verrouilles_liste } (rien n'est écrit)
  simulerPrix(payload) {
    return this.request('/api/tarifs/simuler', { method: 'POST', body: JSON.stringify(payload ?? {}) }, 30_000);
  }
  // Même charge que simulerPrix ; les règles fournies sont enregistrées → { lot_id, modifies, verrouilles }
  appliquerPrix(payload) { return this._ecriturePrix('/api/tarifs/appliquer', { ...payload, confirmer: true }, 60_000); }
  // Fichier fournisseur (xlsx/csv, 5 Mo) lu sans rien écrire →
  // { import_id, colonnes, mapping, reconnues, nouvelles, non_reconnues, invalides, absentes, resume }
  apercuImportPrix({ fichier, fournisseur, cible = 'tarifs', mapping } = {}) {
    const form = new FormData();
    form.append('fichier', fichier);
    form.append('fournisseur', fournisseur || '');
    form.append('cible', cible);
    if (mapping && Object.keys(mapping).length) form.append('mapping', JSON.stringify(mapping));
    return this.request('/api/tarifs/import-fichier/apercu', { method: 'POST', body: form }, 60_000);
  }
  // body : { lignes: [n], associations: [{ n, cle }], nouvelles: [n], marquer_obsoletes, ignorer_invalides }
  // → { lot_id, modifies, ajoutes, obsoletes, verrouilles, confirmes, inchanges }
  appliquerImportPrix(importId, body) {
    return this._ecriturePrix(`/api/tarifs/import-fichier/${encodeURIComponent(importId)}/appliquer`, body, 90_000);
  }
  // Lignes « À associer » d'un aperçu : avant → après chiffré par le serveur, RIEN n'est écrit.
  // associations [{ n, cle }] → [{ n, cle, label, ancien_ht, nouveau_ht, ancien_client, nouveau_client, change,
  //   verrou, obsolete, alerte, alertes, confirmation_requise }] ; association inapplicable : { n, cle, erreur }.
  // Avec confirmation_requise, l'association n'est appliquée que si n est aussi envoyé dans `confirmees`.
  evaluerAssociationsImport(importId, associations) {
    const liste = (associations || [])
      .map((a) => ({ n: Number(a?.n), cle: String(a?.cle || '') }))
      .filter((a) => Number.isFinite(a.n) && a.cle);
    return this.request(`/api/tarifs/import-fichier/${encodeURIComponent(importId)}/evaluer`, {
      method: 'POST', body: JSON.stringify({ associations: liste }),
    }, 20_000);
  }
  // → [{ id, table_nom, ligne_id, colonne, ancien, nouveau, source, lot_id, par, le }]
  getHistoriquePrix({ table, ligne_id, lot_id, limit } = {}) {
    return this.request(`/api/tarifs/historique${buildQuery({ table, ligne_id, lot_id, limit })}`, { cache: 'no-store' });
  }
  // Derniers lots → [{ lot_id, source, par, le, valeurs, lignes, annule }]
  getLotsPrix(limit = 30) {
    return this.request(`/api/tarifs/historique/lots${buildQuery({ limit })}`, { cache: 'no-store' });
  }
  annulerLotPrix(lotId) {
    return this._ecriturePrix(`/api/tarifs/historique/annuler-lot/${encodeURIComponent(lotId)}`, {}, 60_000);
  }
  // Verrou d'une pièce fournisseur (tarifs) ou d'un iPad / MacBook (table 'tarifs_apple_devices') :
  // jamais modifiée automatiquement → { id, verrou_manuel }
  async setVerrouPrix(id, verrouManuel, table = 'tarifs') {
    const base = table === 'tarifs_apple_devices' ? '/api/tarifs/apple-devices' : '/api/tarifs';
    try {
      return await this.request(`${base}/${encodeURIComponent(id)}/verrou`, {
        method: 'PATCH', body: JSON.stringify({ verrou_manuel: !!verrouManuel }),
      });
    } finally {
      this._apresEcriturePrix();
    }
  }
  // Pièce absente de la grille, saisie à la main (source 'manuel') :
  // { marque, modele, type_piece, qualite?, categorie, prix_fournisseur_ht? | prix_client? } → ligne créée
  // (prix client saisi : pièce verrouillée). 409 err.code = 'piece_existante' (err.detail.id).
  creerLignePrix(body) { return this._ecriturePrix('/api/tarifs/ligne', body, 20_000); }
  // Prix d'achat HT : masqués par le serveur tant que le code admin n'est pas saisi sur ce poste.
  // Relecture sans cache après l'élévation → { tarifs, appleDevices } avec les HT (cache des listes oublié).
  async getPrixAchat() {
    this._invalidate('/api/tarifs');
    const [tarifs, appleDevices] = await Promise.all([
      this.request('/api/tarifs', { cache: 'no-store' }, 20_000),
      this.request('/api/tarifs/apple-devices', { cache: 'no-store' }, 20_000),
    ]);
    return { tarifs: tarifs || [], appleDevices: appleDevices || [] };
  }
  // ─── Réparation smartphones (grille fournisseur par marque → modèle) ───
  // → [{ marque, modeles: [{ modele, categorie, nb_pieces, nb_sans_prix, plus_vieux_jours }] }]
  // (catalogue ∪ pièces fournisseur, Apple iPhone exclu, iPad / Mac inclus). Jamais mis en cache ici :
  // la page relit après chaque écriture et les comptages doivent suivre.
  getReparationSmartphonesMarques() {
    return this.request('/api/tarifs/reparation-smartphones/marques', { cache: 'no-store' }, 20_000);
  }
  // → { pieces: [{ id, type_piece, qualite, prix_fournisseur_ht (null hors admin), prix_client,
  //   calcul: { ht, tva, marge, brut, arrondi } (null hors admin), prix_maj_le, prix_source, age_jours,
  //   fraicheur, verrou, en_stock, ref_fournisseur, fournisseur, url_fournisseur }], liens: { utopya, mobilax } }
  getReparationSmartphonesModele({ marque, modele } = {}) {
    return this.request(`/api/tarifs/reparation-smartphones/modele${buildQuery({ marque, modele })}`, { cache: 'no-store' }, 20_000);
  }
  // Modèle du catalogue sans pièce : écran / batterie / connecteur pré-créés à 0 € HT (prix à renseigner)
  creerPiecesCourantes({ marque, modele }) {
    return this._ecriturePrix('/api/tarifs/reparation-smartphones/pieces-courantes', { marque, modele }, 20_000);
  }
  // Nouveau prix d'achat HT d'une pièce fournisseur : { prix_fournisseur_ht, source: 'manuel' | 'utopya' | 'mobilax',
  // ref_fournisseur?, url_fournisseur? } (ou { prix_client } : pièce verrouillée) → ligne relue avec sa fraîcheur.
  // Le prix client est toujours recalculé par le serveur (règles de marge), jamais ici.
  async patchPrixPiece(id, body) {
    try {
      return await this.request(`/api/tarifs/${encodeURIComponent(id)}/prix`, { method: 'PATCH', body: JSON.stringify(body ?? {}) }, 20_000);
    } finally {
      this._apresEcriturePrix();
    }
  }
  // Écran ou batterie d'un iPad / MacBook : { piece: 'ecran' | 'batterie', prix_fournisseur_ht, source, ref_fournisseur? }
  // → { ok, ancien_ht, nouveau_ht, ancien_client, nouveau_client, piece, id, cle }
  async patchPrixAppleDevice(deviceId, body) {
    try {
      return await this.request(`/api/tarifs/apple-devices/${encodeURIComponent(deviceId)}/prix`, { method: 'PATCH', body: JSON.stringify(body ?? {}) }, 20_000);
    } finally {
      this._apresEcriturePrix();
    }
  }
  // getSantePrix() (staff) : défini plus bas avec les propositions de prix

  // ─── MARKETING ──────────────────────────────
  getAvisGoogle(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/api/marketing/avis${qs ? '?' + qs : ''}`);
  }
  getAvisGoogleStats() { return this.get('/api/marketing/avis/stats'); }
  syncAvisGoogle() { return this.post('/api/marketing/avis/sync', {}); }
  genererReponseAvis(id) { return this.post(`/api/marketing/avis/${id}/generer-reponse`, {}); }
  publierReponseAvis(id, data) { return this.post(`/api/marketing/avis/${id}/publier-reponse`, data); }
  updateReponseAvis(id, data) { return this.put(`/api/marketing/avis/${id}/reponse`, data); }

  getMarketingPosts(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/api/marketing/posts${qs ? '?' + qs : ''}`);
  }
  createMarketingPost(data) { return this.post('/api/marketing/posts', data); }
  updateMarketingPost(id, data) { return this.put(`/api/marketing/posts/${id}`, data); }
  deleteMarketingPost(id) { return this.delete(`/api/marketing/posts/${id}`); }
  publierPost(id) { return this.post(`/api/marketing/posts/${id}/publier`, {}); }
  programmerPost(id, data) { return this.post(`/api/marketing/posts/${id}/programmer`, data); }
  genererPost(data) { return this.request('/api/marketing/posts/generer', { method: 'POST', body: JSON.stringify(data) }, 60000); }
  genererImage(data) { return this.request('/api/marketing/posts/generer-image', { method: 'POST', body: JSON.stringify(data) }, 180000); }

  getCalendrierMarketing(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/api/marketing/calendrier${qs ? '?' + qs : ''}`);
  }
  createCalendrierEvent(data) { return this.post('/api/marketing/calendrier', data); }
  updateCalendrierEvent(id, data) { return this.put(`/api/marketing/calendrier/${id}`, data); }
  deleteCalendrierEvent(id) { return this.delete(`/api/marketing/calendrier/${id}`); }

  getMarketingTemplates() { return this.get('/api/marketing/templates'); }
  createMarketingTemplate(data) { return this.post('/api/marketing/templates', data); }

  getMarketingAnalytics() { return this.get('/api/marketing/analytics/overview'); }
  getMarketingAnalyticsPosts() { return this.get('/api/marketing/analytics/posts'); }

  // ─── DEVIS ──────────────────────────────────
  getDevis(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/api/devis${qs ? '?' + qs : ''}`);
  }
  getDevisById(id) { return this.get(`/api/devis/${id}`); }
  createDevis(data) { return this.post('/api/devis', data); }
  updateDevis(id, data) { return this.patch(`/api/devis/${id}`, data); }
  deleteDevis(id) { return this.delete(`/api/devis/${id}`); }
  convertDevisToTicket(id) { return this.post(`/api/devis/${id}/convert`); }
  duplicateDevis(id) { return this.post(`/api/devis/${id}/duplicate`); }
  getDevisStats() { return this.get('/api/devis/stats/overview'); }
  devisFlashSearch(q, limit = 20) {
    return this.get(`/api/devis/flash/search?q=${encodeURIComponent(q)}&limit=${limit}`);
  }

  // ─── TELEPHONES VENTE ───────────────────────
  getTelephonesVente(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/api/devis/telephones-vente${qs ? '?' + qs : ''}`);
  }
  getTelephonesVenteStats() { return this.get('/api/devis/telephones-vente/stats'); }
  getTelephonesVenteMarques() { return this.get('/api/devis/telephones-vente/marques'); }
  createTelephoneVente(data) { return this.post('/api/devis/telephones-vente', data); }
  updateTelephoneVente(id, data) { return this.patch(`/api/devis/telephones-vente/${id}`, data); }
  deleteTelephoneVente(id) { return this.delete(`/api/devis/telephones-vente/${id}`); }

  // ─── DEPOT DISTANCE ────────────────────────────
  createDepotDistance(data) { return this.request('/api/depot-distance', { method: 'POST', body: JSON.stringify(data) }, 20000); }
  validerDepot(ticketId) { return this.put(`/api/depot-distance/${ticketId}/valider`, {}); }
  refuserDepot(ticketId, motif) { return this.put(`/api/depot-distance/${ticketId}/refuser`, { motif }); }
  getPendingDepots() { return this.get('/api/depot-distance/pending'); }

  // ─── SUIVI CLIENT (PUBLIC) ─────────────────────
  // preuve : { t } (jeton du lien de suivi) ou { tel } (numéro complet), dans le corps (écritures)
  suiviSendMessage(ticketCode, message, preuve) { return this.post(`/api/suivi/${encodeURIComponent(ticketCode)}/message`, { message, ...suiviProof(preuve) }); }
  suiviValiderDevis(ticketCode, accepte, preuve) { return this.post(`/api/suivi/${encodeURIComponent(ticketCode)}/valider-devis`, { accepte, ...suiviProof(preuve) }); }
  suiviLaisserAvis(ticketCode, note, commentaire, preuve) { return this.post(`/api/suivi/${encodeURIComponent(ticketCode)}/avis`, { note, commentaire, ...suiviProof(preuve) }); }
  suiviHasAvis(ticketCode, preuve) { return this.suiviGet(`/api/suivi/${encodeURIComponent(ticketCode)}/has-avis`, preuve); }
  getInteractions() { return this.get('/api/suivi/dashboard/interactions'); }
  markTicketRead(ticketId) { return this.put(`/api/tickets/${ticketId}/mark-read`, {}); }

  // ─── TELEPHONES ─────────────────────────────
  getTelephonesCatalogue(params = {}) {
    const clean = Object.fromEntries(Object.entries(params).filter(([,v]) => v != null && v !== ''));
    if (!clean.page) clean.page = 1;
    if (!clean.limit) clean.limit = 24;
    const qs = new URLSearchParams(clean).toString();
    return this.get(`/api/telephones/catalogue${qs ? '?' + qs : ''}`);
  }
  getTelephoneStats() { return this.get('/api/telephones/stats'); }
  getTelephoneMarques() { return this.get('/api/telephones/marques'); }
  syncTelephones() { return this.request('/api/telephones/sync', { method: 'POST' }, 30000); }
  getSyncStatus() { return this.get('/api/telephones/sync-status'); }
  // Test de connexion LCD-Phone (admin) : jamais relancé (chaque essai ouvre une session fournisseur)
  probeTelephones() { return this.request('/api/telephones/probe', { retries: 0, cache: 'no-store' }, 60000); }

  // ─── PRIX : propositions issues des commandes, modèles sans prix, alias, santé ──
  getPropositionsPrix({ statut = 'en_attente' } = {}) {
    return this.request(`/api/tarifs/propositions${buildQuery({ statut })}`, { cache: 'no-store' });
  }
  // Une proposition acceptée change un prix : les grilles en cache sont relues
  accepterPropositionPrix(id) {
    this._invalidate('/api/tarifs');
    return this.post(`/api/tarifs/propositions/${encodeURIComponent(id)}/accepter`, {});
  }
  refuserPropositionPrix(id) { return this.post(`/api/tarifs/propositions/${encodeURIComponent(id)}/refuser`, {}); }
  accepterPropositionsPrix(ids) {
    this._invalidate('/api/tarifs');
    return this.post('/api/tarifs/propositions/accepter', { ids: (ids || []).map(Number).filter(Number.isFinite) });
  }
  getModelesSansPrix() { return this.request('/api/grille/sans-prix', { cache: 'no-store' }, 20000); }
  getAliasModeles() { return this.get('/api/grille/alias'); }
  ajouterAliasModele({ alias, modele_canonique, categorie } = {}) {
    return this.post('/api/grille/alias', {
      alias: String(alias || '').trim(), modele_canonique: String(modele_canonique || '').trim(), categorie: categorie || null,
    });
  }
  supprimerAliasModele(id) { return this.delete(`/api/grille/alias/${encodeURIComponent(id)}`); }
  getSantePrix() { return this.get('/api/tarifs/sante'); }

  // ─── VENTES iPHONE (stock + générateur vidéo Story) ──
  getIphones(params = {}) {
    // Cached 30s — frequent reads from TelephonesVente + Dashboard widgets
    return this.getCached(`/api/iphones${buildQuery(params)}`);
  }
  createIphone(data) { return this.post('/api/iphones', data); }
  updateIphone(id, data) { return this.put(`/api/iphones/${id}`, data); }
  deleteIphone(id) { return this.delete(`/api/iphones/${id}`); }
  generateIphoneStoryVideo(ids) {
    // Génération peut prendre 30–60s — timeout long
    return this.request('/api/iphones/generate-video', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }, 180000);
  }

  // ─── TARIFS iPHONE (affiches boutique + condition) ──
  getIphoneTarifs() { return this.getCached('/api/iphone-tarifs'); }
  updateIphoneTarif(id, data) {
    return this.request(`/api/iphone-tarifs/${id}`, {
      method: 'PATCH', body: JSON.stringify(data),
    });
  }

  // ─── TARIFS SMARTPHONES (Samsung, Xiaomi, Google, etc.) ──
  getSmartphonesTarifs(activeOnly = true) {
    return this.get(`/api/smartphones-tarifs?active_only=${activeOnly}`);
  }
  createSmartphoneTarif(data) { return this.post('/api/smartphones-tarifs', data); }
  updateSmartphoneTarif(id, data) {
    return this.request(`/api/smartphones-tarifs/${id}`, {
      method: 'PATCH', body: JSON.stringify(data),
    });
  }
  deleteSmartphoneTarif(id) { return this.delete(`/api/smartphones-tarifs/${id}`); }
  generateSmartphoneImage(marque, modele, storage) {
    // Retourne juste l'URL Pollinations (pas de download côté serveur) — rapide
    return this.request('/api/smartphones-tarifs/generate-image', {
      method: 'POST',
      body: JSON.stringify({ marque, modele, storage }),
    }, 15000);
  }
  generateIphoneImage(modele, storage, query) {
    // DuckDuckGo + validation fetch. `query` optionnel pour override manuel.
    return this.request('/api/iphone-tarifs/generate-image', {
      method: 'POST',
      body: JSON.stringify({ modele, storage, query }),
    }, 15000);
  }
  generateAiIphoneImage(modele, storage, prompt, count = 4) {
    // Pollinations.ai — genere des photos 'detourees' fond blanc
    return this.request('/api/iphone-tarifs/generate-ai-image', {
      method: 'POST',
      body: JSON.stringify({ modele, storage, prompt, count }),
    }, 30000);
  }
  // Formulaire public "Demande de tarif / Commander" (vitrine)
  demandeDevisIphone(data) {
    return this.request('/api/iphone-tarifs/demande-devis', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
  // Commande depuis la vitrine (enregistree en DB + email admin + email client)
  passerCommandeIphone(data) {
    return this.request('/api/iphone-tarifs/passer-commande', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
  listDemandesCommandes(statut) {
    const qs = statut ? `?statut=${encodeURIComponent(statut)}` : '';
    return this.get(`/api/iphone-tarifs/demandes-commandes${qs}`);
  }
  updateDemandeCommande(id, data) {
    return this.request(`/api/iphone-tarifs/demandes-commandes/${id}`, {
      method: 'PATCH', body: JSON.stringify(data),
    });
  }
  countDemandesCommandesNouvelles() {
    return this.get('/api/iphone-tarifs/demandes-commandes/count-nouvelles');
  }
  deleteDemandeCommande(id, adminPassword) {
    // Code admin via Header X-Admin-Password (RFC 7231 dit que les bodies
    // sur DELETE n'ont pas de semantique definie ; certains proxies les strip).
    return this.request(`/api/iphone-tarifs/demandes-commandes/${id}`, {
      method: 'DELETE',
      headers: { 'X-Admin-Password': adminPassword || '' },
    });
  }
}

export const api = new ApiClient();
export default api;
