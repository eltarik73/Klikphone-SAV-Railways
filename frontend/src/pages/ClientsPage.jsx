import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import { formatDateShort } from '../lib/utils';
import {
  Search, Users, Phone, Mail, ChevronRight, Plus,
  Smartphone, Trash2, Edit3, X, Save, ChevronLeft,
  ArrowUpDown, ArrowUp, ArrowDown,
} from 'lucide-react';

export default function ClientsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const basePath = user?.target === 'tech' ? '/tech' : '/accueil';

  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientTickets, setClientTickets] = useState([]);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(() => parseInt(localStorage.getItem('kp_clients_page_size') || '50'));
  const [hasMore, setHasMore] = useState(true);
  const [sortField, setSortField] = useState('date_creation');
  const [sortDir, setSortDir] = useState('desc');
  const searchTimer = useRef(null);

  // Debounced search (300ms)
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setDebouncedSearch(search); setPage(0); }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  const loadClients = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: pageSize, offset: page * pageSize };
      if (debouncedSearch) params.search = debouncedSearch;
      const data = await api.getClients(params);
      setClients(data);
      setHasMore(data.length === pageSize);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page, pageSize]);

  useEffect(() => { loadClients(); }, [loadClients]);

  const sorted = [...clients].sort((a, b) => {
    let va = a[sortField], vb = b[sortField];
    if (sortField === 'nom') {
      va = `${a.nom || ''} ${a.prenom || ''}`.toLowerCase();
      vb = `${b.nom || ''} ${b.prenom || ''}`.toLowerCase();
    }
    if (va == null) va = '';
    if (vb == null) vb = '';
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-slate-300" />;
    return sortDir === 'asc'
      ? <ArrowUp className="w-3 h-3 text-brand-500" />
      : <ArrowDown className="w-3 h-3 text-brand-500" />;
  };

  const handleSelectClient = async (client) => {
    setSelectedClient(client);
    setEditMode(false);
    setEditForm({
      nom: client.nom || '',
      prenom: client.prenom || '',
      telephone: client.telephone || '',
      email: client.email || '',
      societe: client.societe || '',
    });
    try {
      const tickets = await api.getClientTickets(client.id);
      setClientTickets(tickets);
    } catch {
      setClientTickets([]);
    }
  };

  const handleSaveClient = async () => {
    try {
      await api.updateClient(selectedClient.id, editForm);
      setEditMode(false);
      await loadClients();
      setSelectedClient(prev => ({ ...prev, ...editForm }));
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteClient = async (id) => {
    if (!confirm('Supprimer ce client ?')) return;
    try {
      await api.deleteClient(id);
      setSelectedClient(null);
      await loadClients();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900 tracking-tight">Clients</h1>
          <p className="text-sm text-slate-500 mt-0.5">{clients.length} client(s) — page {page + 1}</p>
        </div>
      </div>

      {/* Search */}
      <div className="card overflow-hidden mb-6">
        <div className="p-3 sm:p-4">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" placeholder="Rechercher par nom, téléphone, email..."
              value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 bg-slate-50/50 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 focus:bg-white transition-all"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Client list */}
        <div className="lg:col-span-2">
          <div className="card overflow-hidden">
            <div className="hidden lg:grid grid-cols-[1fr_150px_180px_32px] gap-3 items-center px-5 py-3 bg-slate-50/80 border-b border-slate-100">
              <button onClick={() => toggleSort('nom')} className="table-header flex items-center gap-1 hover:text-brand-600 transition-colors">
                Client <SortIcon field="nom" />
              </button>
              <button onClick={() => toggleSort('telephone')} className="table-header flex items-center gap-1 hover:text-brand-600 transition-colors">
                Téléphone <SortIcon field="telephone" />
              </button>
              <button onClick={() => toggleSort('email')} className="table-header flex items-center gap-1 hover:text-brand-600 transition-colors">
                Email <SortIcon field="email" />
              </button>
              <span></span>
            </div>

            {loading ? (
              <div className="py-16 text-center">
                <div className="w-8 h-8 border-2 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm text-slate-400">Chargement...</p>
              </div>
            ) : sorted.length === 0 ? (
              <div className="py-16 text-center">
                <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
                  <Users className="w-7 h-7 text-slate-300" />
                </div>
                <p className="text-slate-500 font-medium">Aucun client trouvé</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100/80">
                {sorted.map((c) => (
                  <div key={c.id}
                    onClick={() => handleSelectClient(c)}
                    className={`lg:grid lg:grid-cols-[1fr_150px_180px_32px] gap-3 items-center px-4 sm:px-5 py-3.5 cursor-pointer transition-colors group
                      ${selectedClient?.id === c.id ? 'bg-brand-50/60' : 'hover:bg-slate-50'}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
                        <span className="text-brand-700 font-bold text-xs">
                          {(c.prenom?.[0] || '').toUpperCase()}{(c.nom?.[0] || '').toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">
                          {c.prenom || ''} {c.nom || ''}
                        </p>
                        {c.societe && <p className="text-xs text-slate-400 truncate">{c.societe}</p>}
                      </div>
                    </div>
                    <div className="hidden lg:block">
                      <p className="text-slate-600 font-mono text-xs">{c.telephone || '—'}</p>
                    </div>
                    <div className="hidden lg:block">
                      <p className="text-slate-500 truncate text-xs">{c.email || '—'}</p>
                    </div>
                    <div className="hidden lg:flex justify-end">
                      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-brand-500 transition-colors" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Pagination */}
            {!loading && (page > 0 || hasMore) && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50/50">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="btn-ghost text-xs disabled:opacity-30"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" /> Précédent
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Page {page + 1}</span>
                  <select value={pageSize}
                    onChange={e => { const s = Number(e.target.value); setPageSize(s); setPage(0); localStorage.setItem('kp_clients_page_size', s.toString()); }}
                    className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white text-slate-600">
                    {[10, 20, 50, 100].map(n => (
                      <option key={n} value={n}>{n} / page</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={!hasMore}
                  className="btn-ghost text-xs disabled:opacity-30"
                >
                  Suivant <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Client detail panel */}
        <div className="space-y-5">
          {selectedClient ? (
            <>
              <div className="card p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center">
                      <span className="text-brand-700 font-bold text-sm">
                        {(selectedClient.prenom?.[0] || '').toUpperCase()}{(selectedClient.nom?.[0] || '').toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="font-bold text-slate-900">{selectedClient.prenom} {selectedClient.nom}</p>
                      {selectedClient.societe && <p className="text-xs text-slate-400">{selectedClient.societe}</p>}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => setEditMode(!editMode)}
                      className="btn-ghost p-2" title="Modifier">
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button onClick={() => setSelectedClient(null)}
                      className="btn-ghost p-2" title="Fermer">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {editMode ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="input-label">Nom</label>
                        <input value={editForm.nom} onChange={e => setEditForm(f => ({ ...f, nom: e.target.value }))} className="input" />
                      </div>
                      <div>
                        <label className="input-label">Prénom</label>
                        <input value={editForm.prenom} onChange={e => setEditForm(f => ({ ...f, prenom: e.target.value }))} className="input" />
                      </div>
                    </div>
                    <div>
                      <label className="input-label">Téléphone</label>
                      <input value={editForm.telephone} onChange={e => setEditForm(f => ({ ...f, telephone: e.target.value }))} className="input" />
                    </div>
                    <div>
                      <label className="input-label">Email</label>
                      <input value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} className="input" />
                    </div>
                    <div>
                      <label className="input-label">Société</label>
                      <input value={editForm.societe} onChange={e => setEditForm(f => ({ ...f, societe: e.target.value }))} className="input" />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button onClick={() => setEditMode(false)} className="btn-secondary text-xs">Annuler</button>
                      <button onClick={handleSaveClient} className="btn-primary text-xs">
                        <Save className="w-3.5 h-3.5" /> Enregistrer
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {selectedClient.telephone && (
                      <a href={`tel:${selectedClient.telephone}`} className="flex items-center gap-2.5 text-sm text-slate-600 hover:text-brand-600 transition-colors">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                          <Phone className="w-4 h-4 text-slate-500" />
                        </div>
                        <span className="font-mono text-xs">{selectedClient.telephone}</span>
                      </a>
                    )}
                    {selectedClient.email && (
                      <a href={`mailto:${selectedClient.email}`} className="flex items-center gap-2.5 text-sm text-slate-600 hover:text-brand-600 transition-colors">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                          <Mail className="w-4 h-4 text-slate-500" />
                        </div>
                        <span className="text-xs truncate">{selectedClient.email}</span>
                      </a>
                    )}
                  </div>
                )}
              </div>

              {/* New repair for this client */}
              <button
                onClick={() => navigate(`/client?client_id=${selectedClient.id}&tel=${encodeURIComponent(selectedClient.telephone || '')}`)}
                className="btn-primary w-full justify-center text-xs mb-5"
              >
                <Plus className="w-3.5 h-3.5" /> Nouvelle réparation pour ce client
              </button>

              {/* Client tickets */}
              <div className="card p-5">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  Tickets ({clientTickets.length})
                </h3>
                {clientTickets.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-4">Aucun ticket</p>
                ) : (
                  <div className="space-y-2">
                    {clientTickets.map(t => (
                      <button key={t.id}
                        onClick={() => navigate(`${basePath}/ticket/${t.id}`)}
                        className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 transition-colors text-left"
                      >
                        <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
                          <Smartphone className="w-4 h-4 text-brand-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-brand-600 font-mono">{t.ticket_code}</p>
                          <p className="text-xs text-slate-500 truncate">{t.marque} {t.modele || t.modele_autre} — {t.panne}</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Delete */}
              <button
                onClick={() => handleDeleteClient(selectedClient.id)}
                className="btn-danger w-full text-xs"
              >
                <Trash2 className="w-3.5 h-3.5" /> Supprimer le client
              </button>
            </>
          ) : (
            <div className="card p-8 text-center">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
                <Users className="w-7 h-7 text-slate-300" />
              </div>
              <p className="text-slate-500 font-medium">Sélectionnez un client</p>
              <p className="text-sm text-slate-400 mt-1">Cliquez sur un client pour voir ses détails</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
