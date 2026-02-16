/**
 * Client API centralisé pour communiquer avec le backend FastAPI.
 * Gère automatiquement : JWT token, JSON, erreurs.
 */

const API_URL = import.meta.env.VITE_API_URL || '';
const BACKEND_URL = (API_URL || 'https://klikphone-sav-v2-production.up.railway.app').trim();

class ApiClient {
  constructor() {
    this.token = localStorage.getItem('kp_token') || null;
  }

  setToken(token) {
    this.token = token;
    if (token) localStorage.setItem('kp_token', token);
    else localStorage.removeItem('kp_token');
  }

  async request(path, options = {}, timeoutMs = 10000) {
    const url = `${API_URL}${path}`;
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, { ...options, headers, signal: controller.signal });
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') throw new Error('Connexion au serveur expirée (timeout)');
      throw err;
    }
    clearTimeout(timeout);

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
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      throw new Error('Serveur indisponible (réponse non-JSON)');
    }
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
  getHistorique(id) { return this.get(`/api/tickets/${id}/historique`); }
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
    return this.request(`/api/notifications/email?ticket_id=${ticketId}&message=${encodeURIComponent(message)}&sujet=${encodeURIComponent(sujet)}`, { method: 'POST' }, 45000);
  }

  // ─── PRINT ─────────────────────────────────
  getPrintUrl(ticketId, type) {
    return `${API_URL}/api/tickets/${ticketId}/print/${type}`;
  }
  getPdfUrl(ticketId, type) {
    return `${API_URL}/api/tickets/${ticketId}/pdf/${type}`;
  }
  getSharePrintUrl(ticketId, type) {
    return `${BACKEND_URL}/api/tickets/${ticketId}/print/${type}`;
  }
  getSharePdfUrl(ticketId, type) {
    return `${BACKEND_URL}/api/tickets/${ticketId}/pdf/${type}`;
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
  emailAttestation(data, email) {
    return this.post(`/api/attestation/email?destinataire=${encodeURIComponent(email)}`, data);
  }

  // ─── FIDELITE ─────────────────────────────────
  getFidelite(clientId) { return this.get(`/api/fidelite/${clientId}`); }
  getFideliteByTicket(ticketCode) { return this.get(`/api/fidelite/ticket/${ticketCode}`); }
  crediterPoints(data) { return this.post('/api/fidelite/crediter', data); }
  utiliserPoints(data) { return this.post('/api/fidelite/utiliser', data); }
  getGrattage(ticketCode) { return this.get(`/api/fidelite/grattage/${ticketCode}`); }
  gratter(ticketCode) { return this.post(`/api/fidelite/grattage/${ticketCode}`); }

  // ─── ADMIN ──────────────────────────────────
  adminLogin(identifiant, password) {
    return this.post('/api/admin/login', { identifiant, password });
  }
  verifyAdmin(login, password) {
    return this.post('/api/admin/verify', { login, password });
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

  // ─── TARIFS ────────────────────────────────
  getTarifs(params = {}) {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.marque) qs.set('marque', params.marque);
    const s = qs.toString();
    return this.get(`/api/tarifs${s ? '?' + s : ''}`);
  }
  getTarifsStats() {
    return this.get('/api/tarifs/stats');
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
}

export const api = new ApiClient();
export default api;
