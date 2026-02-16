import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useApi, invalidateCache } from '../hooks/useApi';
import api from '../lib/api';
import {
  Smartphone, Search, Plus, Edit3, Trash2, Save, X,
  Package, Euro, Tag, Filter, ToggleLeft, ToggleRight,
  Loader2, Hash, Palette,
} from 'lucide-react';

const ETATS = ['Occasion', 'Neuf', 'Reconditionné'];

const MARQUES_COURANTES = [
  'Apple', 'Samsung', 'Xiaomi', 'Huawei', 'Google', 'Honor',
  'Oppo', 'OnePlus', 'Motorola', 'Nothing', 'Realme', 'Sony',
];

const ETAT_COLORS = {
  Occasion: { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
  Neuf: { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },
  Reconditionné: { bg: '#ede9fe', text: '#6d28d9', border: '#c4b5fd' },
};

const fp = (v) => {
  if (v == null || v === 0) return '—';
  return Number(v).toFixed(2).replace('.', ',') + ' €';
};

export default function TelephonesVentePage() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterMarque, setFilterMarque] = useState('');
  const [filterEtat, setFilterEtat] = useState('');
  const [filterStock, setFilterStock] = useState('');
  const searchTimer = useRef(null);

  // Form
  const [showForm, setShowForm] = useState(false);
  const [editingPhone, setEditingPhone] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState(getEmptyForm());

  function getEmptyForm() {
    return {
      marque: '', modele: '', capacite: '', couleur: '',
      etat: 'Occasion', prix_achat: '', prix_vente: '',
      imei: '', notes: '',
    };
  }

  // Debounced search
  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  // Toast auto-hide
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Data fetching
  const phonesKey = useMemo(() => {
    const p = ['telVente'];
    if (debouncedSearch) p.push(`s:${debouncedSearch}`);
    if (filterMarque) p.push(`m:${filterMarque}`);
    if (filterEtat) p.push(`e:${filterEtat}`);
    if (filterStock) p.push(`st:${filterStock}`);
    return p.join(':');
  }, [debouncedSearch, filterMarque, filterEtat, filterStock]);

  const { data: phonesData, loading } = useApi(
    phonesKey,
    async () => {
      const params = { limit: 200 };
      if (debouncedSearch) params.search = debouncedSearch;
      if (filterMarque) params.marque = filterMarque;
      if (filterEtat) params.etat = filterEtat;
      if (filterStock === 'oui') params.en_stock = true;
      else if (filterStock === 'non') params.en_stock = false;
      return api.getTelephonesVente(params);
    },
    { tags: ['telVente'], ttl: 60_000 }
  );
  const phones = phonesData ?? [];

  const { data: statsData } = useApi(
    'telVente:stats',
    () => api.getTelephonesVenteStats(),
    { tags: ['telVente'], ttl: 60_000 }
  );
  const stats = statsData ?? {};

  const { data: marquesData } = useApi(
    'telVente:marques',
    () => api.getTelephonesVenteMarques(),
    { tags: ['telVente'], ttl: 60_000 }
  );
  const marques = marquesData ?? [];

  // Handlers
  const resetForm = () => {
    setForm(getEmptyForm());
    setEditingPhone(null);
    setShowForm(false);
  };

  const handleSubmit = async () => {
    if (!form.marque.trim() || !form.modele.trim()) return;
    setSaving(true);
    try {
      const data = {
        ...form,
        prix_achat: form.prix_achat ? parseFloat(form.prix_achat) : null,
        prix_vente: form.prix_vente ? parseFloat(form.prix_vente) : null,
      };
      if (editingPhone) {
        await api.updateTelephoneVente(editingPhone.id, data);
        setToast({ type: 'success', msg: 'Téléphone mis à jour' });
      } else {
        await api.createTelephoneVente(data);
        setToast({ type: 'success', msg: 'Téléphone ajouté au stock' });
      }
      resetForm();
      invalidateCache('telVente');
    } catch (err) {
      console.error(err);
      setToast({ type: 'error', msg: 'Erreur sauvegarde' });
    }
    setSaving(false);
  };

  const handleEdit = (phone) => {
    setEditingPhone(phone);
    setForm({
      marque: phone.marque || '',
      modele: phone.modele || '',
      capacite: phone.capacite || '',
      couleur: phone.couleur || '',
      etat: phone.etat || 'Occasion',
      prix_achat: phone.prix_achat || '',
      prix_vente: phone.prix_vente || '',
      imei: phone.imei || '',
      notes: phone.notes || '',
    });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!confirm('Supprimer ce téléphone du stock ?')) return;
    try {
      await api.deleteTelephoneVente(id);
      invalidateCache('telVente');
      setToast({ type: 'success', msg: 'Téléphone supprimé' });
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleStock = async (phone) => {
    try {
      await api.updateTelephoneVente(phone.id, { en_stock: !phone.en_stock });
      invalidateCache('telVente');
      setToast({ type: 'success', msg: phone.en_stock ? 'Retiré du stock' : 'Remis en stock' });
    } catch (err) {
      console.error(err);
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
            <Smartphone className="w-6 h-6 text-brand-600" /> Téléphones en vente
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Votre stock de téléphones à vendre en boutique</p>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary">
          <Plus className="w-4 h-4" /> Ajouter un téléphone
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <div className="card p-3">
          <div className="flex items-center gap-2 mb-1">
            <Smartphone className="w-4 h-4 text-slate-400" />
            <span className="text-xs text-slate-500">Total</span>
          </div>
          <p className="text-xl font-bold text-slate-900">{stats.total || 0}</p>
        </div>
        <div className="card p-3">
          <div className="flex items-center gap-2 mb-1">
            <Package className="w-4 h-4 text-emerald-500" />
            <span className="text-xs text-slate-500">En stock</span>
          </div>
          <p className="text-xl font-bold text-emerald-600">{stats.en_stock || 0}</p>
        </div>
        <div className="card p-3">
          <div className="flex items-center gap-2 mb-1">
            <Tag className="w-4 h-4 text-blue-500" />
            <span className="text-xs text-slate-500">Neufs</span>
          </div>
          <p className="text-xl font-bold text-blue-600">{stats.neufs || 0}</p>
        </div>
        <div className="card p-3">
          <div className="flex items-center gap-2 mb-1">
            <Tag className="w-4 h-4 text-amber-500" />
            <span className="text-xs text-slate-500">Occasions</span>
          </div>
          <p className="text-xl font-bold text-amber-600">{stats.occasions || 0}</p>
        </div>
        <div className="card p-3">
          <div className="flex items-center gap-2 mb-1">
            <Euro className="w-4 h-4 text-brand-500" />
            <span className="text-xs text-slate-500">Valeur stock</span>
          </div>
          <p className="text-xl font-bold text-brand-600">{fp(stats.valeur_stock)}</p>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="card overflow-hidden mb-6">
        <div className="p-3 sm:p-4 border-b border-slate-100">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" placeholder="Rechercher par marque, modèle, IMEI..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 bg-slate-50/50 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 focus:bg-white transition-all" />
          </div>
        </div>
        <div className="px-3 sm:px-4 py-2 flex items-center gap-2 overflow-x-auto scrollbar-none bg-slate-50/50">
          <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <select value={filterMarque} onChange={e => setFilterMarque(e.target.value)}
            className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-600 min-w-[100px]">
            <option value="">Toutes marques</option>
            {(marques.length > 0 ? marques : MARQUES_COURANTES).map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <select value={filterEtat} onChange={e => setFilterEtat(e.target.value)}
            className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-600">
            <option value="">Tous états</option>
            {ETATS.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          <select value={filterStock} onChange={e => setFilterStock(e.target.value)}
            className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-600">
            <option value="">Stock: tous</option>
            <option value="oui">En stock</option>
            <option value="non">Hors stock</option>
          </select>
        </div>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div className="card p-5 mb-6 border-brand-200 animate-in">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-800">
              {editingPhone ? 'Modifier le téléphone' : 'Ajouter un téléphone'}
            </h2>
            <button onClick={resetForm} className="btn-ghost p-1.5">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="input-label">Marque *</label>
              <select value={form.marque} onChange={e => setForm(f => ({ ...f, marque: e.target.value }))} className="input">
                <option value="">Choisir...</option>
                {MARQUES_COURANTES.map(m => <option key={m} value={m}>{m}</option>)}
                <option value="__other">Autre</option>
              </select>
              {form.marque === '__other' && (
                <input value="" onChange={e => setForm(f => ({ ...f, marque: e.target.value }))}
                  className="input mt-1" placeholder="Marque personnalisée" autoFocus />
              )}
            </div>
            <div>
              <label className="input-label">Modèle *</label>
              <input value={form.modele} onChange={e => setForm(f => ({ ...f, modele: e.target.value }))}
                className="input" placeholder="iPhone 15 Pro Max" />
            </div>
            <div>
              <label className="input-label">Capacité</label>
              <input value={form.capacite} onChange={e => setForm(f => ({ ...f, capacite: e.target.value }))}
                className="input" placeholder="256 Go" />
            </div>
            <div>
              <label className="input-label">Couleur</label>
              <input value={form.couleur} onChange={e => setForm(f => ({ ...f, couleur: e.target.value }))}
                className="input" placeholder="Noir" />
            </div>
            <div>
              <label className="input-label">État</label>
              <select value={form.etat} onChange={e => setForm(f => ({ ...f, etat: e.target.value }))} className="input">
                {ETATS.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div>
              <label className="input-label">Prix d'achat (€)</label>
              <input type="number" step="0.01" value={form.prix_achat}
                onChange={e => setForm(f => ({ ...f, prix_achat: e.target.value }))} className="input" placeholder="0,00" />
            </div>
            <div>
              <label className="input-label">Prix de vente (€)</label>
              <input type="number" step="0.01" value={form.prix_vente}
                onChange={e => setForm(f => ({ ...f, prix_vente: e.target.value }))} className="input" placeholder="0,00" />
            </div>
            <div>
              <label className="input-label">IMEI</label>
              <input value={form.imei} onChange={e => setForm(f => ({ ...f, imei: e.target.value }))}
                className="input font-mono" placeholder="35XXXXXXXXXXXXXXX" />
            </div>
            <div className="col-span-2 sm:col-span-4">
              <label className="input-label">Notes</label>
              <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className="input" placeholder="Rayure coin droit, accessoires inclus..." />
            </div>
          </div>
          <div className="flex justify-end mt-4 pt-3 border-t border-slate-100">
            <button onClick={handleSubmit} disabled={saving || !form.marque.trim() || !form.modele.trim()} className="btn-primary">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {editingPhone ? 'Mettre à jour' : 'Ajouter au stock'}
            </button>
          </div>
        </div>
      )}

      {/* Phone list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
        </div>
      ) : phones.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
            <Smartphone className="w-7 h-7 text-slate-300" />
          </div>
          <p className="text-slate-500 font-medium">Aucun téléphone en stock</p>
          <p className="text-sm text-slate-400 mt-1">Ajoutez votre premier téléphone à vendre</p>
          <button onClick={() => { resetForm(); setShowForm(true); }}
            className="btn-primary mt-4 mx-auto">
            <Plus className="w-4 h-4" /> Ajouter un téléphone
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {phones.map(phone => {
            const ec = ETAT_COLORS[phone.etat] || ETAT_COLORS.Occasion;
            return (
              <div key={phone.id}
                className={`card overflow-hidden transition-all hover:shadow-md ${!phone.en_stock ? 'opacity-60' : ''}`}>
                {/* Header with brand + model */}
                <div className="p-4 pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">{phone.marque}</p>
                      <h3 className="text-sm font-bold text-slate-900 leading-tight truncate">{phone.modele}</h3>
                    </div>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                      style={{ background: ec.bg, color: ec.text, border: `1px solid ${ec.border}` }}>
                      {phone.etat}
                    </span>
                  </div>

                  {/* Specs */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    {phone.capacite && (
                      <span className="text-[11px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                        {phone.capacite}
                      </span>
                    )}
                    {phone.couleur && (
                      <span className="text-[11px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1">
                        <Palette className="w-2.5 h-2.5" /> {phone.couleur}
                      </span>
                    )}
                    {phone.imei && (
                      <span className="text-[11px] text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded font-mono flex items-center gap-1">
                        <Hash className="w-2.5 h-2.5" /> {phone.imei.slice(-6)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Price section */}
                <div className="px-4 py-3 bg-slate-50 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-lg font-bold text-brand-600">{fp(phone.prix_vente)}</p>
                      {phone.prix_achat > 0 && (
                        <p className="text-[10px] text-slate-400">Achat: {fp(phone.prix_achat)}
                          {phone.prix_vente > 0 && phone.prix_achat > 0 && (
                            <span className="text-emerald-600 font-semibold ml-1">
                              +{((phone.prix_vente - phone.prix_achat) / phone.prix_achat * 100).toFixed(0)}%
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                    {/* Stock toggle */}
                    <button onClick={() => handleToggleStock(phone)}
                      className="flex items-center gap-1.5 text-xs font-medium" title={phone.en_stock ? 'Retirer du stock' : 'Remettre en stock'}>
                      {phone.en_stock ? (
                        <>
                          <ToggleRight className="w-5 h-5 text-emerald-500" />
                          <span className="text-emerald-600">En stock</span>
                        </>
                      ) : (
                        <>
                          <ToggleLeft className="w-5 h-5 text-slate-400" />
                          <span className="text-slate-400">Vendu</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Notes + Actions */}
                <div className="px-4 py-2.5 flex items-center justify-between border-t border-slate-100">
                  <p className="text-[11px] text-slate-400 truncate flex-1 mr-2">{phone.notes || ''}</p>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => handleEdit(phone)} className="btn-ghost p-1.5" title="Modifier">
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleDelete(phone.id)} className="btn-ghost p-1.5" title="Supprimer">
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
