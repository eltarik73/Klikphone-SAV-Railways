import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import { formatDateShort, formatPrix } from '../lib/utils';
import {
  Search, Package, Plus, Edit3, Trash2, Save, X,
  Check, Clock, AlertTriangle, ChevronDown, ExternalLink, Calendar,
} from 'lucide-react';

const PART_STATUTS = ['En attente', 'Commandée', 'Expédiée', 'Reçue', 'Annulée'];

export default function CommandesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const basePath = user?.target === 'tech' ? '/tech' : '/accueil';
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterStatut, setFilterStatut] = useState('');
  const searchTimer = useRef(null);
  const [showForm, setShowForm] = useState(false);
  const [editingPart, setEditingPart] = useState(null);
  const [form, setForm] = useState({
    description: '', fournisseur: '', reference: '',
    prix: '', ticket_code: '', statut: 'En attente', notes: '',
  });

  // Debounced search (300ms)
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  const loadParts = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (filterStatut) params.statut = filterStatut;
      const data = await api.getParts(params);
      setParts(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, filterStatut]);

  useEffect(() => { loadParts(); }, [loadParts]);

  const resetForm = () => {
    setForm({ description: '', fournisseur: '', reference: '', prix: '', ticket_code: '', statut: 'En attente', notes: '' });
    setEditingPart(null);
    setShowForm(false);
  };

  const handleSubmit = async () => {
    try {
      const data = {
        ...form,
        prix: form.prix ? parseFloat(form.prix) : null,
      };
      if (editingPart) {
        await api.updatePart(editingPart.id, data);
      } else {
        await api.createPart(data);
      }
      resetForm();
      await loadParts();
    } catch (err) {
      console.error(err);
    }
  };

  const handleEdit = (part) => {
    setEditingPart(part);
    setForm({
      description: part.description || '',
      fournisseur: part.fournisseur || '',
      reference: part.reference || '',
      prix: part.prix || '',
      ticket_code: part.ticket_code || '',
      statut: part.statut || 'En attente',
      notes: part.notes || '',
    });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!confirm('Supprimer cette commande ?')) return;
    try {
      await api.deletePart(id);
      await loadParts();
    } catch (err) {
      console.error(err);
    }
  };

  const handleQuickStatus = async (part, newStatut) => {
    try {
      await api.updatePart(part.id, { statut: newStatut });
      await loadParts();
    } catch (err) {
      console.error(err);
    }
  };

  const handleGoToTicket = async (ticketCode) => {
    try {
      const ticket = await api.getTicketByCode(ticketCode);
      if (ticket?.id) navigate(`${basePath}/ticket/${ticket.id}`);
    } catch {
      // ticket not found, ignore
    }
  };

  const getStatutStyle = (statut) => {
    switch (statut) {
      case 'En attente': return 'bg-amber-50 text-amber-700 ring-amber-200/80';
      case 'Commandée': return 'bg-blue-50 text-blue-700 ring-blue-200/80';
      case 'Expédiée': return 'bg-purple-50 text-purple-700 ring-purple-200/80';
      case 'Reçue': return 'bg-emerald-50 text-emerald-700 ring-emerald-200/80';
      case 'Annulée': return 'bg-red-50 text-red-600 ring-red-200/80';
      default: return 'bg-slate-100 text-slate-600 ring-slate-200/80';
    }
  };

  const getStatutIcon = (statut) => {
    switch (statut) {
      case 'En attente': return <Clock className="w-3 h-3" />;
      case 'Commandée': return <Package className="w-3 h-3" />;
      case 'Expédiée': return <ExternalLink className="w-3 h-3" />;
      case 'Reçue': return <Check className="w-3 h-3" />;
      case 'Annulée': return <X className="w-3 h-3" />;
      default: return null;
    }
  };

  // Summary counts
  const counts = {
    total: parts.length,
    attente: parts.filter(p => p.statut === 'En attente').length,
    commandee: parts.filter(p => p.statut === 'Commandée').length,
    recue: parts.filter(p => p.statut === 'Reçue').length,
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900 tracking-tight">Commandes de pièces</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {counts.total} commande(s) — {counts.attente} en attente, {counts.commandee} commandée(s), {counts.recue} reçue(s)
          </p>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary">
          <Plus className="w-4 h-4" /> Nouvelle commande
        </button>
      </div>

      {/* Search & Filters */}
      <div className="card overflow-hidden mb-6">
        <div className="p-3 sm:p-4 border-b border-slate-100">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" placeholder="Rechercher par désignation, fournisseur, référence, ticket..."
              value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 bg-slate-50/50 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 focus:bg-white transition-all"
            />
          </div>
        </div>
        <div className="px-3 sm:px-4 py-2 flex gap-1 overflow-x-auto scrollbar-none bg-slate-50/50">
          <button onClick={() => setFilterStatut('')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all
              ${!filterStatut ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:bg-white hover:shadow-sm'}`}>
            Toutes ({counts.total})
          </button>
          {PART_STATUTS.map(s => (
            <button key={s} onClick={() => setFilterStatut(s)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all flex items-center gap-1
                ${filterStatut === s ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:bg-white hover:shadow-sm'}`}>
              {getStatutIcon(s)} {s}
            </button>
          ))}
        </div>
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="card p-5 mb-6 border-brand-200 animate-in">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-800">
              {editingPart ? 'Modifier la commande' : 'Nouvelle commande'}
            </h2>
            <button onClick={resetForm} className="btn-ghost p-1.5">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="input-label">Désignation *</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="input" placeholder="Écran iPhone 15..." />
            </div>
            <div>
              <label className="input-label">Fournisseur</label>
              <input value={form.fournisseur} onChange={e => setForm(f => ({ ...f, fournisseur: e.target.value }))} className="input" placeholder="Nom fournisseur" />
            </div>
            <div>
              <label className="input-label">Référence</label>
              <input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} className="input font-mono" placeholder="REF-001" />
            </div>
            <div>
              <label className="input-label">Prix (€)</label>
              <input type="number" step="0.01" value={form.prix} onChange={e => setForm(f => ({ ...f, prix: e.target.value }))} className="input" />
            </div>
            <div>
              <label className="input-label">Ticket associé</label>
              <input value={form.ticket_code} onChange={e => setForm(f => ({ ...f, ticket_code: e.target.value }))} className="input font-mono" placeholder="KP-000001" />
            </div>
            <div>
              <label className="input-label">Statut</label>
              <select value={form.statut} onChange={e => setForm(f => ({ ...f, statut: e.target.value }))} className="input">
                {PART_STATUTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="col-span-2 sm:col-span-3">
              <label className="input-label">Notes</label>
              <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="input" placeholder="Notes..." />
            </div>
          </div>
          <div className="flex justify-end mt-4 pt-3 border-t border-slate-100">
            <button onClick={handleSubmit} disabled={!form.description} className="btn-primary">
              <Save className="w-4 h-4" /> {editingPart ? 'Mettre à jour' : 'Créer'}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="hidden lg:grid grid-cols-[1fr_130px_140px_120px_90px_120px_100px_80px] gap-3 items-center px-5 py-3 bg-slate-50/80 border-b border-slate-100">
          <span className="table-header">Désignation</span>
          <span className="table-header">Client</span>
          <span className="table-header">Fournisseur</span>
          <span className="table-header">Référence</span>
          <span className="table-header">Prix</span>
          <span className="table-header">Dates</span>
          <span className="table-header">Statut</span>
          <span className="table-header text-right">Actions</span>
        </div>

        {loading ? (
          <div className="py-16 text-center">
            <div className="w-8 h-8 border-2 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-400">Chargement...</p>
          </div>
        ) : parts.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
              <Package className="w-7 h-7 text-slate-300" />
            </div>
            <p className="text-slate-500 font-medium">Aucune commande</p>
            <p className="text-sm text-slate-400 mt-1">Créez votre première commande de pièce</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100/80">
            {parts.map((p) => (
              <div key={p.id}
                className="lg:grid lg:grid-cols-[1fr_130px_140px_120px_90px_120px_100px_80px] gap-3 items-center px-4 sm:px-5 py-3.5 hover:bg-slate-50 transition-colors"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-800">{p.description}</p>
                  {p.ticket_code && (
                    <button onClick={() => handleGoToTicket(p.ticket_code)}
                      className="text-xs text-brand-600 font-mono hover:text-brand-800 hover:underline flex items-center gap-1">
                      {p.ticket_code} <ExternalLink className="w-2.5 h-2.5" />
                    </button>
                  )}
                  {p.notes && <p className="text-xs text-slate-400 mt-0.5 truncate">{p.notes}</p>}
                </div>
                <div className="hidden lg:block">
                  <p className="text-sm text-slate-700 truncate">{p.client_prenom || ''} {p.client_nom || ''}</p>
                  {p.client_tel && <p className="text-[11px] text-slate-400 font-mono">{p.client_tel}</p>}
                </div>
                <div className="hidden lg:block">
                  <p className="text-sm text-slate-600">{p.fournisseur || '—'}</p>
                </div>
                <div className="hidden lg:block">
                  <p className="text-xs text-slate-500 font-mono">{p.reference || '—'}</p>
                </div>
                <div className="hidden lg:block">
                  <p className="text-sm font-medium text-slate-800">{p.prix ? formatPrix(p.prix) : '—'}</p>
                </div>
                <div className="hidden lg:block">
                  <p className="text-[11px] text-slate-500">
                    <Calendar className="w-3 h-3 inline mr-0.5" />
                    {p.date_creation ? formatDateShort(p.date_creation) : '—'}
                  </p>
                  {p.date_commande && (
                    <p className="text-[10px] text-blue-500">Cmd: {formatDateShort(p.date_commande)}</p>
                  )}
                  {p.date_reception && (
                    <p className="text-[10px] text-emerald-500">Reçue: {formatDateShort(p.date_reception)}</p>
                  )}
                </div>
                <div className="mt-2 lg:mt-0">
                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ring-1 ${getStatutStyle(p.statut)}`}>
                    {getStatutIcon(p.statut)} {p.statut}
                  </span>
                </div>
                <div className="hidden lg:flex justify-end gap-1">
                  {p.statut === 'En attente' && (
                    <button onClick={() => handleQuickStatus(p, 'Commandée')} className="btn-ghost p-1.5" title="Marquer commandée">
                      <Check className="w-3.5 h-3.5 text-blue-500" />
                    </button>
                  )}
                  {p.statut === 'Commandée' && (
                    <button onClick={() => handleQuickStatus(p, 'Expédiée')} className="btn-ghost p-1.5" title="Marquer expédiée">
                      <ExternalLink className="w-3.5 h-3.5 text-purple-500" />
                    </button>
                  )}
                  {(p.statut === 'Commandée' || p.statut === 'Expédiée') && (
                    <button onClick={() => handleQuickStatus(p, 'Reçue')} className="btn-ghost p-1.5" title="Marquer reçue">
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                    </button>
                  )}
                  <button onClick={() => handleEdit(p)} className="btn-ghost p-1.5" title="Modifier">
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(p.id)} className="btn-ghost p-1.5" title="Supprimer">
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
