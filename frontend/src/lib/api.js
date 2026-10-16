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
  '/api/auth/login', '/api/auth/switch-user', '/api/admin/verify', '/api/admin/login',
  '/api/admin/change-password', '/api/config/change-pin',
];
// Refus d'élévation (auth._refus_admin) : detail = { code, message }. « Admin requis » en simple
// texte est un refus lié au RÔLE (marketing, reporting) : la saisie du code admin n'y change rien.
const ADMIN_REFUSAL_CODES = new Set(['admin_requis', 'admin_expire', 'admin_invalide']);
// Repli pour un detail texte (ancien serveur) : vocabulaire propre au jeton, jamais « Admin requis »
const ADMIN_REFUSAL_RE = /élévation|elevation|(jeton|token)\s+(d['’]\s*)?(admin|élévation)|x-admin-token/i;
const ADMIN_TOKEN_KEY = 'kp_admin_token';
const ADMIN_TOKEN_TTL = 10 * 60_000;
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

// Preuve d'accès d'une action publique du suivi : jeton du lien (t) sinon 4 derniers chiffres (tel4)
function suiviProof(preuve) {
  if (preuve?.t) return { t: String(preuve.t) };
  const tel4 = String(preuve?.tel4 || '').replace(/\D/g, '');
  return tel4.length === 4 ? { tel4 } : {};
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

class ApiClient {
  constructor() {
    this.token = localStorage.getItem('kp_token') || null;
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

  // Appels de fond (polling) : aucune relance, une erreur attend simplement le tour suivant.
  // Les requêtes sont lancées de façon synchrone dans `fn`, le drapeau est donc bien lu.
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
    if (fetchOptions.body) headers['Content-Type'] = 'application/json';
    const bearer = auth ? this.token : null;
    if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
    const adminToken = auth && sendsAdminToken(path) ? this.getAdminToken() : null;
    if (adminToken && !headers['X-Admin-Token']) headers['X-Admin-Token'] = adminToken;

    const method = String(fetchOptions.method || 'GET').toUpperCase();
    const isGet = method === 'GET' || method === 'HEAD';
    const defaultRetries = this._background > 0 ? 0 : DEFAULT_GET_RETRIES;
    const maxRetries = isGet ? (Number.isInteger(retries) ? Math.max(0, retries) : defaultRetries) : 0;
    if (!isGet) this._mutationSeq += 1;

    try {
      for (let attempt = 0; ; attempt++) {
        if (attempt > 0) await sleep(300 * attempt);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let res;
        try {
          res = await fetch(url, { ...fetchOptions, headers, signal: controller.signal });
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
        const data = await this._readResponse(res, { path, bearer, adminToken });
        return withHeaders ? { data, headers: res.headers } : data;
      }
    } finally {
      if (!isGet) this._mutationSeq += 1;
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

    // Session refusée par le serveur : seule cause de déconnexion
    this.setToken(null);
    window.location.href = '/';
    const e = new Error('Non authentifié');
    e.status = 401;
    throw e;
  }

  // GET partagé : deux appels identiques en vol ne font qu'une requête, sauf si une écriture
  // a eu lieu entre-temps (la seconde lecture doit voir son effet).
  get(path, options) {
    if (options?.signal) return this.request(path, options);
    const pending = this._sharedGets.get(path);
    if (pending && pending.seq === this._mutationSeq && pending.token === this.token) return pending.promise;
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
  async login(pin, target, utilisateur) {
    const data = await this.post('/api/auth/login', { pin, target, utilisateur });
    this.setToken(data.access_token);
    this.forgetAdminMode();
    localStorage.setItem('kp_target', data.target);
    localStorage.setItem('kp_user', data.utilisateur);
    return data;
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
      localStorage.removeItem('klikphone_admin');
      localStorage.removeItem('kp_admin_auth');
    } catch { /* stockage indisponible */ }
    this.clearAdminToken();
  }

  // ─── TICKETS ───────────────────────────────
  getTickets(params = {}) {
    return this.get(`/api/tickets${buildQuery(params)}`);
  }
  getTicket(id) { return this.get(`/api/tickets/${id}`); }
  getTicketByCode(code) { return this.get(`/api/tickets/code/${code}`); }
  getTicketsByPhone(tel) { return this.get(`/api/tickets/phone/${encodeURIComponent(tel)}`); }
  createTicket(data) { return this.post('/api/tickets', data); }
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
  getPublicCommandes(ticketCode) { return this.get(`/api/parts/public/${encodeURIComponent(ticketCode)}`); }
  createPart(data) { return this.post('/api/parts', data); }
  createPartAuto(data) { return this.post('/api/parts/auto', data); }
  updatePart(id, data) { return this.patch(`/api/parts/${id}`, data); }
  deletePart(id) { return this.delete(`/api/parts/${id}`); }

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
  async exportFile(path, filename) {
    const url = `${API_URL}${path}`;
    const headers = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw httpError(res.status, body?.detail, res.headers);
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
  sendSMS(ticketId, message) {
    return this.post(`/api/notifications/sms?ticket_id=${ticketId}&message=${encodeURIComponent(message)}`);
  }
  sendEmail(ticketId, message, sujet) {
    return this.request(`/api/notifications/email?ticket_id=${ticketId}&message=${encodeURIComponent(message)}&sujet=${encodeURIComponent(sujet)}`, { method: 'POST' }, 45000);
  }

  // ─── PRINT ─────────────────────────────────
  // Les documents d'impression exigent le jeton : on les récupère par fetch (texte ou blob)
  // puis l'aperçu les affiche en srcdoc / URL blob, jamais via une URL directe.
  async requestRaw(path, { as = 'text', signal, timeoutMs = 20000 } = {}) {
    const headers = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const controller = new AbortController();
    const relayAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', relayAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${API_URL}${path}`, { headers, signal: controller.signal, cache: 'no-store' });
      if (res.status === 401) {
        this.setToken(null);
        window.location.href = '/';
        throw new Error('Non authentifié');
      }
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
  getFideliteByTicket(ticketCode) { return this.get(`/api/fidelite/ticket/${ticketCode}`); }
  crediterPoints(data) { return this.post('/api/fidelite/crediter', data); }
  utiliserPoints(data) { return this.post('/api/fidelite/utiliser', data); }
  getGrattage(ticketCode) { return this.get(`/api/fidelite/grattage/${ticketCode}`); }
  gratter(ticketCode) { return this.post(`/api/fidelite/grattage/${ticketCode}`); }
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
  adminLogin(identifiant, password) {
    return this.post('/api/admin/login', { identifiant, password });
  }
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
  getSuiviPublic(code) { return this.get(`/api/depot-distance/suivi/${encodeURIComponent(code)}`); }

  // ─── SUIVI CLIENT (PUBLIC) ─────────────────────
  // preuve : { t } (jeton du lien de suivi) ou { tel4 } (4 derniers chiffres du téléphone)
  suiviSendMessage(ticketCode, message, preuve) { return this.post(`/api/suivi/${encodeURIComponent(ticketCode)}/message`, { message, ...suiviProof(preuve) }); }
  suiviValiderDevis(ticketCode, accepte, preuve) { return this.post(`/api/suivi/${encodeURIComponent(ticketCode)}/valider-devis`, { accepte, ...suiviProof(preuve) }); }
  suiviLaisserAvis(ticketCode, note, commentaire, preuve) { return this.post(`/api/suivi/${encodeURIComponent(ticketCode)}/avis`, { note, commentaire, ...suiviProof(preuve) }); }
  suiviHasAvis(ticketCode) { return this.get(`/api/suivi/${encodeURIComponent(ticketCode)}/has-avis`); }
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
