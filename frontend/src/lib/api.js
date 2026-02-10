/**
 * Client API centralisé pour communiquer avec le backend FastAPI.
 * Gère automatiquement : JWT token, JSON, erreurs.
 */

const API_URL = import.meta.env.VITE_API_URL || '';

class ApiClient {
  constructor() {
    this.token = localStorage.getItem('kp_token') || null;
  }

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem('kp_token', token);
    } else {
      localStorage.removeItem('kp_token');
    }
  }

  getToken() {
    return this.token;
  }

  isAuthenticated() {
    return !!this.token;
  }

  async request(path, options = {}) {
    const url = `${API_URL}${path}`;
    const headers = { 'Content-Type': 'application/json', ...options.headers };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(url, { ...options, headers });

    if (res.status === 401) {
      this.setToken(null);
      window.location.href = '/';
      throw new Error('Non authentifié');
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Erreur ${res.status}`);
    }

    if (res.status === 204) return null;
    return res.json();
  }

  get(path) {
    return this.request(path);
  }

  post(path, data) {
    return this.request(path, { method: 'POST', body: JSON.stringify(data) });
  }

  patch(path, data) {
    return this.request(path, { method: 'PATCH', body: JSON.stringify(data) });
  }

  put(path, data) {
    return this.request(path, { method: 'PUT', body: JSON.stringify(data) });
  }

  delete(path) {
    return this.request(path, { method: 'DELETE' });
  }

  // ─── AUTH ──────────────────────────────────
  async login(pin, target, utilisateur) {
    const data = await this.post('/api/auth/login', { pin, target, utilisateur });
    this.setToken(data.access_token);
    localStorage.setItem('kp_target', data.target);
    localStorage.setItem('kp_user', data.utilisateur);
    return data;
  }

  logout() {
    this.setToken(null);
    localStorage.removeItem('kp_target');
    localStorage.removeItem('kp_user');
  }

  // ─── TICKETS ───────────────────────────────
  getTickets(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/api/tickets${qs ? '?' + qs : ''}`);
  }

  getTicket(id) {
    return this.get(`/api/tickets/${id}`);
  }

  getTicketByCode(code) {
    return this.get(`/api/tickets/code/${code}`);
  }

  createTicket(data) {
    return this.post('/api/tickets', data);
  }

  updateTicket(id, data) {
    return this.patch(`/api/tickets/${id}`, data);
  }

  changeStatus(id, statut) {
    return this.patch(`/api/tickets/${id}/statut`, { statut });
  }

  deleteTicket(id) {
    return this.delete(`/api/tickets/${id}`);
  }

  getKPI() {
    return this.get('/api/tickets/stats/kpi');
  }

  addNote(id, note) {
    return this.post(`/api/tickets/${id}/note?note=${encodeURIComponent(note)}`);
  }

  addHistory(id, texte) {
    return this.post(`/api/tickets/${id}/historique?texte=${encodeURIComponent(texte)}`);
  }

  // ─── CLIENTS ───────────────────────────────
  getClients(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/api/clients${qs ? '?' + qs : ''}`);
  }

  getClient(id) {
    return this.get(`/api/clients/${id}`);
  }

  getClientByTel(tel) {
    return this.get(`/api/clients/tel/${encodeURIComponent(tel)}`);
  }

  createOrGetClient(data) {
    return this.post('/api/clients', data);
  }

  updateClient(id, data) {
    return this.patch(`/api/clients/${id}`, data);
  }

  deleteClient(id) {
    return this.delete(`/api/clients/${id}`);
  }

  getClientTickets(id) {
    return this.get(`/api/clients/${id}/tickets`);
  }

  // ─── CATALOG ───────────────────────────────
  getCategories() {
    return this.get('/api/catalog/categories');
  }

  getPannes() {
    return this.get('/api/catalog/pannes');
  }

  getMarques(categorie) {
    return this.get(`/api/catalog/marques?categorie=${encodeURIComponent(categorie)}`);
  }

  getModeles(categorie, marque) {
    return this.get(`/api/catalog/modeles?categorie=${encodeURIComponent(categorie)}&marque=${encodeURIComponent(marque)}`);
  }

  // ─── TEAM ──────────────────────────────────
  getTeam() {
    return this.get('/api/team');
  }

  getActiveTeam() {
    return this.get('/api/team/active');
  }

  // ─── PARTS ─────────────────────────────────
  getParts(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/api/parts${qs ? '?' + qs : ''}`);
  }

  createPart(data) {
    return this.post('/api/parts', data);
  }

  updatePart(id, data) {
    return this.patch(`/api/parts/${id}`, data);
  }

  deletePart(id) {
    return this.delete(`/api/parts/${id}`);
  }

  // ─── CONFIG ────────────────────────────────
  getConfig() {
    return this.get('/api/config');
  }

  getPublicConfig() {
    return this.get('/api/config/public');
  }

  getParam(cle) {
    return this.get(`/api/config/${cle}`);
  }

  setParam(cle, valeur) {
    return this.put('/api/config', { cle, valeur });
  }
}

export const api = new ApiClient();
export default api;
