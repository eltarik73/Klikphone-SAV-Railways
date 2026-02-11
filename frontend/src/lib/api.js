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
    if (token) localStorage.setItem('kp_token', token);
    else localStorage.removeItem('kp_token');
  }

  async request(path, options = {}) {
    const url = `${API_URL}${path}`;
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

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

  get(path) { return this.request(path); }
  post(path, data) { return this.request(path, { method: 'POST', body: JSON.stringify(data) }); }
  patch(path, data) { return this.request(path, { method: 'PATCH', body: JSON.stringify(data) }); }
  put(path, data) { return this.request(path, { method: 'PUT', body: JSON.stringify(data) }); }
  delete(path) { return this.request(path, { method: 'DELETE' }); }

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
  getTicket(id) { return this.get(`/api/tickets/${id}`); }
  getTicketByCode(code) { return this.get(`/api/tickets/code/${code}`); }
  getTicketsByPhone(tel) { return this.get(`/api/tickets/phone/${encodeURIComponent(tel)}`); }
  createTicket(data) { return this.post('/api/tickets', data); }
  updateTicket(id, data) { return this.patch(`/api/tickets/${id}`, data); }
  changeStatus(id, statut) { return this.patch(`/api/tickets/${id}/statut`, { statut }); }
  deleteTicket(id) { return this.delete(`/api/tickets/${id}`); }
  getKPI() { return this.get('/api/tickets/stats/kpi'); }
  addNote(id, note) { return this.post(`/api/tickets/${id}/note?note=${encodeURIComponent(note)}`); }
  addHistory(id, texte) { return this.post(`/api/tickets/${id}/historique?texte=${encodeURIComponent(texte)}`); }
  togglePaye(id) { return this.patch(`/api/tickets/${id}/paye`, {}); }

  // ─── CLIENTS ───────────────────────────────
  getClients(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/api/clients${qs ? '?' + qs : ''}`);
  }
  getClient(id) { return this.get(`/api/clients/${id}`); }
  getClientByTel(tel) { return this.get(`/api/clients/tel/${encodeURIComponent(tel)}`); }
  createOrGetClient(data) { return this.post('/api/clients', data); }
  updateClient(id, data) { return this.patch(`/api/clients/${id}`, data); }
  deleteClient(id) { return this.delete(`/api/clients/${id}`); }
  getClientTickets(id) { return this.get(`/api/clients/${id}/tickets`); }

  // ─── CATALOG ───────────────────────────────
  getCategories() { return this.get('/api/catalog/categories'); }
  getPannes() { return this.get('/api/catalog/pannes'); }
  getMarques(categorie) { return this.get(`/api/catalog/marques?categorie=${encodeURIComponent(categorie)}`); }
  getModeles(categorie, marque) { return this.get(`/api/catalog/modeles?categorie=${encodeURIComponent(categorie)}&marque=${encodeURIComponent(marque)}`); }
  getAllCatalog() { return this.get('/api/catalog/all'); }
  addMarque(categorie, marque) { return this.post(`/api/catalog/marques?categorie=${encodeURIComponent(categorie)}&marque=${encodeURIComponent(marque)}`); }
  addModele(categorie, marque, modele) { return this.post(`/api/catalog/modeles?categorie=${encodeURIComponent(categorie)}&marque=${encodeURIComponent(marque)}&modele=${encodeURIComponent(modele)}`); }
  deleteMarque(categorie, marque) { return this.delete(`/api/catalog/marques?categorie=${encodeURIComponent(categorie)}&marque=${encodeURIComponent(marque)}`); }
  deleteModele(categorie, marque, modele) { return this.delete(`/api/catalog/modeles?categorie=${encodeURIComponent(categorie)}&marque=${encodeURIComponent(marque)}&modele=${encodeURIComponent(modele)}`); }

  // ─── TEAM ──────────────────────────────────
  getTeam() { return this.get('/api/team'); }
  getActiveTeam() { return this.get('/api/team/active'); }
  createTeamMember(data) { return this.post('/api/team', data); }
  updateTeamMember(id, data) { return this.patch(`/api/team/${id}`, data); }
  deleteTeamMember(id) { return this.delete(`/api/team/${id}`); }

  // ─── PARTS ─────────────────────────────────
  getParts(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/api/parts${qs ? '?' + qs : ''}`);
  }
  createPart(data) { return this.post('/api/parts', data); }
  updatePart(id, data) { return this.patch(`/api/parts/${id}`, data); }
  deletePart(id) { return this.delete(`/api/parts/${id}`); }

  // ─── CONFIG ────────────────────────────────
  getConfig() { return this.get('/api/config'); }
  getPublicConfig() { return this.get('/api/config/public'); }
  setParam(cle, valeur) { return this.put('/api/config', { cle, valeur }); }
  setParams(params) { return this.put('/api/config/batch', params); }
  changePin(target, old_pin, new_pin) { return this.post('/api/config/change-pin', { target, old_pin, new_pin }); }
  getBackup() { return this.get('/api/config/backup'); }
  importBackup(data) { return this.post('/api/config/backup/import', data); }
  async exportFile(path, filename) {
    const url = `${API_URL}${path}`;
    const headers = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Erreur ${res.status}`);
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
    return this.post(`/api/notifications/email?ticket_id=${ticketId}&message=${encodeURIComponent(message)}&sujet=${encodeURIComponent(sujet)}`);
  }

  // ─── PRINT ─────────────────────────────────
  getPrintUrl(ticketId, type) {
    return `${API_URL}/api/tickets/${ticketId}/print/${type}`;
  }

  // ─── CAISSE ────────────────────────────────
  sendToCaisse(ticketId) {
    return this.post(`/api/caisse/send?ticket_id=${ticketId}`);
  }

  // ─── ATTESTATION ───────────────────────────
  generateAttestation(data) {
    return this.post('/api/attestation/generate', data);
  }
  emailAttestation(data, email) {
    return this.post(`/api/attestation/email?destinataire=${encodeURIComponent(email)}`, data);
  }

  // ─── ADMIN ──────────────────────────────────
  adminLogin(identifiant, password) {
    return this.post('/api/admin/login', { identifiant, password });
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
}

export const api = new ApiClient();
export default api;
