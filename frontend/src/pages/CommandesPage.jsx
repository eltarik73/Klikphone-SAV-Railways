import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useApi, invalidateCache } from '../hooks/useApi';
import api from '../lib/api';
import { formatDateShort, formatPrix } from '../lib/utils';
import {
  Search, Package, Plus, Edit3, Trash2, Save, X,
  Check, Clock, AlertTriangle, ChevronDown, ExternalLink, Calendar,
  Truck, RotateCcw, Wrench, Archive,
} from 'lucide-react';

const PART_STATUTS = ['En attente', 'Commandée', 'Expédiée', 'Reçue', 'Annulée', 'Récupérée par client', 'Utilisée en réparation'];
const STATUTS_TERMINAUX = ['Reçue', 'Annulée', 'Récupérée par client', 'Utilisée en réparation'];

export default function CommandesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const basePath = user?.target === 'tech' ? '/tech' : '/accueil';
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterTab, setFilterTab] = useState('en_cours');
  const searchTimer = useRef(null);
  const [showForm, setShowForm] = useState(false);
  const [editingPart, setEditingPart] = useState(null);
  const [toast, setToast] = useState(null);
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

  // Toast auto-hide
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const partsKey = useMemo(() => {
    const p = ['commandes'];
    if (debouncedSearch) p.push(`s:${debouncedSearch}`);
    p.push(`tab:${filterTab}`);
    return p.join(':');
  }, [debouncedSearch, filterTab]);

  const { data: partsData, loading, isRevalidating, mutate: mutateParts } = useApi(
    partsKey,
    async () => {
      const params = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (filterTab === 'en_cours') params.statut = 'en_cours';
      else if (filterTab === 'cloturees') params.statut = 'cloturees';
      return api.getParts(params);
    },
    { tags: ['commandes'], ttl: 60_000 }
  );
  const parts = partsData ?? [];

  // Count for tabs (load all to get counts)
  const { data: allPartsData } = useApi(
    'commandes:all:counts',
    () => api.getParts({}),
    { tags: ['commandes'], ttl: 60_000 }
  );
  const allParts = allPartsData ?? [];
  const countEnCours = allParts.filter(p => !STATUTS_TERMINAUX.includes(p.statut)).length;
  const countCloturees = allParts.filter(p => STATUTS_TERMINAUX.includes(p.statut)).length;

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
        setToast({ type: 'success', msg: 'Commande mise à jour' });
      } else {
        await api.createPart(data);
        setToast({ type: 'success', msg: 'Commande créée' });
      }
      resetForm();
      invalidateCache('commandes');
    } catch (err) {
      console.error(err);
      setToast({ type: 'error', msg: 'Erreur lors de la sauvegarde' });
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
      invalidateCache('commandes');
      setToast({ type: 'success', msg: 'Commande supprimée' });
    } catch (err) {
      console.error(err);
    }
  };

  const handleStatusChange = async (part, newStatut) => {
    try {
      await api.updatePart(part.id, { statut: newStatut });
      invalidateCache('commandes');
      setToast({ type: 'success', msg: `Statut → ${newStatut}` });
    } catch (err) {
      console.error(err);
      setToast({ type: 'error', msg: 'Erreur changement statut' });
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
      case 'Récupérée par client': return 'bg-cyan-50 text-cyan-700 ring-cyan-200/80';
      case 'Utilisée en réparation': return 'bg-indigo-50 text-indigo-700 ring-indigo-200/80';
      default: return 'bg-slate-100 text-slate-600 ring-slate-200/80';
    }
  };

  const getStatutIcon = (statut) => {
    switch (statut) {
      case 'En attente': return <Clock className="w-3 h-3" />;
      case 'Commandée': return <Package className="w-3 h-3" />;
      case 'Expédiée': return <Truck className="w-3 h-3" />;
      case 'Reçue': return <Check className="w-3 h-3" />;
      case 'Annulée': return <X className="w-3 h-3" />;
      case 'Récupérée par client': return <RotateCcw className="w-3 h-3" />;
      case 'Utilisée en réparation': return <Wrench className="w-3 h-3" />;
      default: return null;
    }
  };

  const getStatutColor = (statut) => {
    switch (statut) {
      case 'En attente': return '#d97706';
      case 'Commandée': return '#2563eb';
      case 'Expédiée': return '#7c3aed';
      case 'Reçue': return '#059669';
      case 'Annulée': return '#dc2626';
      case 'Récupérée par client': return '#0891b2';
      case 'Utilisée en réparation': return '#4f46e5';
      default: return '#64748b';
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[100] px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium animate-in
          ${toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Package className="w-6 h-6 text-brand-600" /> Commandes de pièces
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {countEnCours} en cours — {countCloturees} clôturée(s)
          </p>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary">
          <Plus className="w-4 h-4" /> Nouvelle commande
        </button>
      </div>

      {/* Search & Filter Tabs */}
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
          <button onClick={() => setFilterTab('en_cours')}
            className={`px-4 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all flex items-center gap-1.5
              ${filterTab === 'en_cours' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:bg-white hover:shadow-sm'}`}>
            <Clock className="w-3.5 h-3.5" /> En cours ({countEnCours})
          </button>
          <button onClick={() => setFilterTab('cloturees')}
            className={`px-4 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all flex items-center gap-1.5
              ${filterTab === 'cloturees' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:bg-white hover:shadow-sm'}`}>
            <Archive className="w-3.5 h-3.5" /> Clôturées ({countCloturees})
          </button>
          <button onClick={() => setFilterTab('toutes')}
            className={`px-4 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all flex items-center gap-1.5
              ${filterTab === 'toutes' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:bg-white hover:shadow-sm'}`}>
            Toutes ({allParts.length})
          </button>
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
        <div className="hidden lg:grid grid-cols-[1fr_130px_140px_120px_90px_120px_160px_80px] gap-3 items-center px-5 py-3 bg-slate-50/80 border-b border-slate-100">
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
            <p className="text-sm text-slate-400 mt-1">
              {filterTab === 'en_cours' ? 'Aucune commande en cours' : filterTab === 'cloturees' ? 'Aucune commande clôturée' : 'Créez votre première commande de pièce'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100/80">
            {parts.map((p) => (
              <div key={p.id}
                className="lg:grid lg:grid-cols-[1fr_130px_140px_120px_90px_120px_160px_80px] gap-3 items-center px-4 sm:px-5 py-3.5 hover:bg-slate-50 transition-colors"
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
                {/* Status dropdown */}
                <div className="mt-2 lg:mt-0" onClick={e => e.stopPropagation()}>
                  <select
                    value={p.statut}
                    onChange={e => handleStatusChange(p, e.target.value)}
                    className="w-full py-1.5 px-2 text-[11px] font-semibold rounded-lg border-2 cursor-pointer appearance-none bg-no-repeat truncate"
                    style={{
                      borderColor: getStatutColor(p.statut),
                      color: getStatutColor(p.statut),
                      backgroundColor: getStatutColor(p.statut) + '10',
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='${encodeURIComponent(getStatutColor(p.statut))}' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                      backgroundPosition: 'right 4px center',
                      backgroundSize: '14px',
                      paddingRight: '22px',
                    }}
                  >
                    {PART_STATUTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="hidden lg:flex justify-end gap-1">
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
