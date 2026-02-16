import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import {
  FileText, Plus, Search, Filter, Eye, Edit3, Trash2, Copy,
  Send, CheckCircle, XCircle, ArrowRightCircle, Printer,
  Loader2, X, ChevronDown, Package, Euro, AlertTriangle,
  BarChart3, Clock, TrendingUp,
} from 'lucide-react';

const STATUTS = ['Brouillon', 'Envoyé', 'Accepté', 'Refusé', 'Converti'];
const STATUT_COLORS = {
  Brouillon: { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },
  Envoyé:    { bg: '#eff6ff', text: '#1d4ed8', border: '#93c5fd' },
  Accepté:   { bg: '#ecfdf5', text: '#047857', border: '#6ee7b7' },
  Refusé:    { bg: '#fef2f2', text: '#dc2626', border: '#fca5a5' },
  Converti:  { bg: '#f5f3ff', text: '#7c3aed', border: '#c4b5fd' },
};

const fp = (v) => {
  if (v == null) return '0,00';
  return Number(v).toFixed(2).replace('.', ',');
};

export default function DevisPage() {
  const { user } = useAuth();
  const [devisList, setDevisList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatut, setFilterStatut] = useState('');
  const [stats, setStats] = useState(null);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(getEmptyForm());
  const [lignes, setLignes] = useState([{ description: '', quantite: 1, prix_unitaire: 0 }]);

  // Detail view
  const [viewDevis, setViewDevis] = useState(null);
  const [showDetail, setShowDetail] = useState(false);

  function getEmptyForm() {
    return {
      client_nom: '', client_prenom: '', client_tel: '', client_email: '',
      appareil: '', description: '', tva: 20, remise: 0, notes: '', validite_jours: 30,
    };
  }

  const loadData = async () => {
    setLoading(true);
    try {
      const params = {};
      if (search) params.search = search;
      if (filterStatut) params.statut = filterStatut;
      const [list, st] = await Promise.all([api.getDevis(params), api.getDevisStats()]);
      setDevisList(list || []);
      setStats(st);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [search, filterStatut]);

  const openCreate = () => {
    setEditId(null);
    setForm(getEmptyForm());
    setLignes([{ description: '', quantite: 1, prix_unitaire: 0 }]);
    setShowModal(true);
  };

  const openEdit = async (id) => {
    try {
      const d = await api.getDevisById(id);
      setEditId(id);
      setForm({
        client_nom: d.client_nom || '', client_prenom: d.client_prenom || '',
        client_tel: d.client_tel || '', client_email: d.client_email || '',
        appareil: d.appareil || '', description: d.description || '',
        tva: d.tva || 20, remise: d.remise || 0, notes: d.notes || '',
        validite_jours: d.validite_jours || 30,
      });
      setLignes(d.lignes?.length > 0 ? d.lignes.map(l => ({
        description: l.description, quantite: l.quantite, prix_unitaire: Number(l.prix_unitaire),
      })) : [{ description: '', quantite: 1, prix_unitaire: 0 }]);
      setShowModal(true);
    } catch { /* ignore */ }
  };

  const openView = async (id) => {
    try {
      const d = await api.getDevisById(id);
      setViewDevis(d);
      setShowDetail(true);
    } catch { /* ignore */ }
  };

  const totalHT = useMemo(() => {
    const sum = lignes.reduce((a, l) => a + (l.quantite || 0) * (l.prix_unitaire || 0), 0);
    return Math.max(0, sum - (form.remise || 0));
  }, [lignes, form.remise]);

  const totalTTC = useMemo(() => totalHT * (1 + (form.tva || 0) / 100), [totalHT, form.tva]);

  const handleSave = async () => {
    if (!form.client_nom && !form.client_tel) return;
    setSaving(true);
    try {
      const validLignes = lignes.filter(l => l.description.trim());
      const payload = { ...form, lignes: validLignes };
      if (editId) {
        await api.updateDevis(editId, payload);
      } else {
        await api.createDevis(payload);
      }
      setShowModal(false);
      loadData();
    } catch (e) {
      console.error(e);
    }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    if (!confirm('Supprimer ce devis ?')) return;
    try {
      await api.deleteDevis(id);
      loadData();
    } catch { /* ignore */ }
  };

  const handleStatusChange = async (id, statut) => {
    try {
      await api.updateDevis(id, { statut });
      loadData();
      if (showDetail && viewDevis?.id === id) {
        setViewDevis(v => ({ ...v, statut }));
      }
    } catch { /* ignore */ }
  };

  const handleConvert = async (id) => {
    if (!confirm('Convertir ce devis en ticket SAV ?')) return;
    try {
      const res = await api.convertDevisToTicket(id);
      alert(`Ticket créé: ${res.ticket_code}`);
      loadData();
      setShowDetail(false);
    } catch (e) {
      alert('Erreur: ' + e.message);
    }
  };

  const handleDuplicate = async (id) => {
    try {
      await api.duplicateDevis(id);
      loadData();
    } catch { /* ignore */ }
  };

  const addLigne = () => setLignes(l => [...l, { description: '', quantite: 1, prix_unitaire: 0 }]);
  const removeLigne = (i) => setLignes(l => l.filter((_, idx) => idx !== i));
  const updateLigne = (i, field, val) => setLignes(l => l.map((item, idx) => idx === i ? { ...item, [field]: val } : item));

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <FileText className="w-6 h-6 text-brand-600" /> Devis
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Gestion des devis clients</p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="w-4 h-4" /> Nouveau devis
        </button>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="card p-3">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="w-4 h-4 text-slate-400" />
              <span className="text-xs text-slate-500">Total</span>
            </div>
            <p className="text-xl font-bold text-slate-900">{stats.total || 0}</p>
          </div>
          <div className="card p-3">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              <span className="text-xs text-slate-500">Acceptés</span>
            </div>
            <p className="text-xl font-bold text-emerald-600">{stats.acceptes || 0}</p>
          </div>
          <div className="card p-3">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-blue-500" />
              <span className="text-xs text-slate-500">En attente</span>
            </div>
            <p className="text-xl font-bold text-blue-600">{stats.envoyes || 0}</p>
          </div>
          <div className="card p-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-brand-500" />
              <span className="text-xs text-slate-500">CA Accepté</span>
            </div>
            <p className="text-xl font-bold text-brand-600">{fp(stats.ca_accepte)} €</p>
          </div>
        </div>
      )}

      {/* Search + Filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher par nom, téléphone, numéro..."
            className="input pl-9" />
        </div>
        <select value={filterStatut} onChange={e => setFilterStatut(e.target.value)}
          className="input w-auto min-w-[140px]">
          <option value="">Tous statuts</option>
          {STATUTS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
        </div>
      ) : devisList.length === 0 ? (
        <div className="text-center py-16">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">Aucun devis</p>
          <p className="text-sm text-slate-400 mt-1">Créez votre premier devis</p>
        </div>
      ) : (
        <div className="space-y-2">
          {devisList.map(d => {
            const sc = STATUT_COLORS[d.statut] || STATUT_COLORS.Brouillon;
            return (
              <div key={d.id} className="card p-4 hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => openView(d.id)}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: sc.bg }}>
                      <FileText className="w-5 h-5" style={{ color: sc.text }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-slate-900">{d.numero}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ background: sc.bg, color: sc.text, border: `1px solid ${sc.border}` }}>
                          {d.statut}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">
                        {d.client_prenom} {d.client_nom}
                        {d.appareil ? ` — ${d.appareil}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="font-bold text-sm text-slate-900">{fp(d.total_ttc)} €</p>
                    <p className="text-[11px] text-slate-400">
                      {d.date_creation ? new Date(d.date_creation).toLocaleDateString('fr-FR') : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 ml-3" onClick={e => e.stopPropagation()}>
                    <button onClick={() => openEdit(d.id)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600" title="Modifier">
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDuplicate(d.id)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600" title="Dupliquer">
                      <Copy className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(d.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500" title="Supprimer">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ CREATE/EDIT MODAL ═══ */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-start justify-center overflow-y-auto p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="text-lg font-display font-bold text-slate-900">
                {editId ? 'Modifier le devis' : 'Nouveau devis'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-2 rounded-lg hover:bg-slate-100">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
              {/* Client */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Client</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="input-label">Nom *</label>
                    <input value={form.client_nom} onChange={e => setForm(f => ({ ...f, client_nom: e.target.value }))}
                      className="input" placeholder="Dupont" />
                  </div>
                  <div>
                    <label className="input-label">Prénom</label>
                    <input value={form.client_prenom} onChange={e => setForm(f => ({ ...f, client_prenom: e.target.value }))}
                      className="input" placeholder="Jean" />
                  </div>
                  <div>
                    <label className="input-label">Téléphone</label>
                    <input value={form.client_tel} onChange={e => setForm(f => ({ ...f, client_tel: e.target.value }))}
                      className="input" placeholder="06 XX XX XX XX" />
                  </div>
                  <div>
                    <label className="input-label">Email</label>
                    <input value={form.client_email} onChange={e => setForm(f => ({ ...f, client_email: e.target.value }))}
                      className="input" placeholder="email@exemple.com" />
                  </div>
                </div>
              </div>

              {/* Appareil */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Appareil & Description</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="input-label">Appareil</label>
                    <input value={form.appareil} onChange={e => setForm(f => ({ ...f, appareil: e.target.value }))}
                      className="input" placeholder="iPhone 15 Pro Max" />
                  </div>
                  <div>
                    <label className="input-label">Description</label>
                    <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                      className="input" placeholder="Remplacement écran OLED" />
                  </div>
                </div>
              </div>

              {/* Lignes */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Lignes du devis</h3>
                  <button onClick={addLigne} className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1">
                    <Plus className="w-3.5 h-3.5" /> Ajouter
                  </button>
                </div>
                <div className="space-y-2">
                  {lignes.map((l, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={l.description} onChange={e => updateLigne(i, 'description', e.target.value)}
                        placeholder="Description" className="input flex-1" />
                      <input type="number" value={l.quantite} onChange={e => updateLigne(i, 'quantite', parseInt(e.target.value) || 1)}
                        className="input w-16 text-center" min="1" />
                      <div className="relative">
                        <input type="number" value={l.prix_unitaire} onChange={e => updateLigne(i, 'prix_unitaire', parseFloat(e.target.value) || 0)}
                          className="input w-24 pr-6 text-right" step="0.01" min="0" />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">€</span>
                      </div>
                      <span className="text-sm font-semibold text-slate-700 w-20 text-right">{fp((l.quantite || 0) * (l.prix_unitaire || 0))} €</span>
                      {lignes.length > 1 && (
                        <button onClick={() => removeLigne(i)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500">
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals */}
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div>
                    <label className="input-label">TVA (%)</label>
                    <input type="number" value={form.tva} onChange={e => setForm(f => ({ ...f, tva: parseFloat(e.target.value) || 0 }))}
                      className="input" step="0.1" />
                  </div>
                  <div>
                    <label className="input-label">Remise (€)</label>
                    <input type="number" value={form.remise} onChange={e => setForm(f => ({ ...f, remise: parseFloat(e.target.value) || 0 }))}
                      className="input" step="0.01" />
                  </div>
                  <div>
                    <label className="input-label">Validité (jours)</label>
                    <input type="number" value={form.validite_jours} onChange={e => setForm(f => ({ ...f, validite_jours: parseInt(e.target.value) || 30 }))}
                      className="input" />
                  </div>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Total HT</span>
                  <span className="font-semibold">{fp(totalHT)} €</span>
                </div>
                <div className="flex items-center justify-between text-lg font-bold mt-2 pt-2 border-t border-slate-200">
                  <span className="text-slate-900">Total TTC</span>
                  <span className="text-brand-600">{fp(totalTTC)} €</span>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="input-label">Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="input min-h-[60px]" placeholder="Notes internes ou conditions..." />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100">
              <button onClick={() => setShowModal(false)} className="btn-secondary">Annuler</button>
              <button onClick={handleSave} disabled={saving || (!form.client_nom && !form.client_tel)}
                className="btn-primary">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                {editId ? 'Enregistrer' : 'Créer le devis'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ DETAIL MODAL ═══ */}
      {showDetail && viewDevis && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-start justify-center overflow-y-auto p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-display font-bold text-slate-900">{viewDevis.numero}</h2>
                {(() => {
                  const sc = STATUT_COLORS[viewDevis.statut] || STATUT_COLORS.Brouillon;
                  return (
                    <span className="text-xs px-2.5 py-1 rounded-full font-semibold"
                      style={{ background: sc.bg, color: sc.text, border: `1px solid ${sc.border}` }}>
                      {viewDevis.statut}
                    </span>
                  );
                })()}
              </div>
              <button onClick={() => setShowDetail(false)} className="p-2 rounded-lg hover:bg-slate-100">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
              {/* Client info */}
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Client</p>
                <p className="font-semibold text-slate-900">{viewDevis.client_prenom} {viewDevis.client_nom}</p>
                <p className="text-sm text-slate-500">{viewDevis.client_tel} {viewDevis.client_email ? `— ${viewDevis.client_email}` : ''}</p>
                {viewDevis.appareil && <p className="text-sm text-slate-600 mt-1"><b>Appareil:</b> {viewDevis.appareil}</p>}
                {viewDevis.description && <p className="text-sm text-slate-500 mt-1">{viewDevis.description}</p>}
              </div>

              {/* Lines */}
              {viewDevis.lignes?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Détail</p>
                  <div className="divide-y divide-slate-100">
                    {viewDevis.lignes.map((l, i) => (
                      <div key={i} className="flex items-center justify-between py-2">
                        <div>
                          <p className="text-sm font-medium text-slate-800">{l.description}</p>
                          <p className="text-xs text-slate-400">{l.quantite} x {fp(l.prix_unitaire)} €</p>
                        </div>
                        <span className="font-semibold text-sm">{fp(l.total)} €</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Totals */}
              <div className="bg-brand-50/50 rounded-xl p-4">
                <div className="flex justify-between text-sm"><span>Total HT</span><span>{fp(viewDevis.total_ht)} €</span></div>
                {Number(viewDevis.remise) > 0 && <div className="flex justify-between text-sm text-red-600"><span>Remise</span><span>-{fp(viewDevis.remise)} €</span></div>}
                <div className="flex justify-between text-sm"><span>TVA ({fp(viewDevis.tva)}%)</span><span>{fp(Number(viewDevis.total_ttc) - Number(viewDevis.total_ht))} €</span></div>
                <div className="flex justify-between text-lg font-bold mt-2 pt-2 border-t border-brand-200">
                  <span>Total TTC</span><span className="text-brand-600">{fp(viewDevis.total_ttc)} €</span>
                </div>
              </div>

              {viewDevis.notes && (
                <div className="bg-amber-50 rounded-xl p-4 text-sm text-amber-800">
                  <b>Notes:</b> {viewDevis.notes}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2 px-6 py-4 border-t border-slate-100">
              {viewDevis.statut === 'Brouillon' && (
                <button onClick={() => handleStatusChange(viewDevis.id, 'Envoyé')}
                  className="btn-primary text-xs">
                  <Send className="w-3.5 h-3.5" /> Marquer envoyé
                </button>
              )}
              {viewDevis.statut === 'Envoyé' && (
                <>
                  <button onClick={() => handleStatusChange(viewDevis.id, 'Accepté')}
                    className="btn-primary text-xs" style={{ background: '#059669' }}>
                    <CheckCircle className="w-3.5 h-3.5" /> Accepter
                  </button>
                  <button onClick={() => handleStatusChange(viewDevis.id, 'Refusé')}
                    className="btn-secondary text-xs text-red-600 border-red-200 hover:bg-red-50">
                    <XCircle className="w-3.5 h-3.5" /> Refuser
                  </button>
                </>
              )}
              {viewDevis.statut === 'Accepté' && (
                <button onClick={() => handleConvert(viewDevis.id)}
                  className="btn-primary text-xs">
                  <ArrowRightCircle className="w-3.5 h-3.5" /> Convertir en ticket
                </button>
              )}
              <a href={api.getDevisPrintUrl(viewDevis.id)} target="_blank" rel="noopener noreferrer"
                className="btn-secondary text-xs">
                <Printer className="w-3.5 h-3.5" /> Imprimer
              </a>
              <button onClick={() => { openEdit(viewDevis.id); setShowDetail(false); }}
                className="btn-secondary text-xs">
                <Edit3 className="w-3.5 h-3.5" /> Modifier
              </button>
              <button onClick={() => { handleDuplicate(viewDevis.id); setShowDetail(false); }}
                className="btn-secondary text-xs">
                <Copy className="w-3.5 h-3.5" /> Dupliquer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
