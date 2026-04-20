import { useState, useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Smartphone, Save, Plus, ArrowLeft, Loader2, Check, X, Trash2,
  Sparkles, Image as ImageIcon, Search, Filter, AlertCircle,
  CheckCircle2, Star, RefreshCw, Package, TrendingUp, Tag, FileDown,
} from 'lucide-react';
import api from '../lib/api';

const API_URL = import.meta.env.VITE_API_URL || '';

async function openPdf({ ids = null, marque = null } = {}) {
  const token = localStorage.getItem('kp_token');
  let qs = '';
  if (ids && ids.length) {
    qs = `?ids=${ids.join(',')}`;
  } else if (marque) {
    qs = `?marque=${encodeURIComponent(marque)}`;
  }
  const res = await fetch(`${API_URL}/api/smartphones-tarifs/pdf${qs}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Erreur ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function useBasePath() {
  const location = useLocation();
  return location.pathname.startsWith('/tech') ? '/tech' : '/accueil';
}

const EMPTY_ROW = {
  slug: '', marque: '', modele: '',
  stockage_1: '128 Go', prix_1: 0, stock_1: 0,
  stockage_2: '', prix_2: null, stock_2: 0,
  stockage_3: '', prix_3: null, stock_3: 0,
  condition: 'Reconditionné Premium',
  image_url: '',
};

const POPULAR_BRANDS = ['Samsung', 'Xiaomi', 'Google', 'Honor'];

const BRAND_COLORS = {
  Samsung: 'from-blue-500/20 to-blue-600/10 border-blue-500/30 text-blue-300',
  Xiaomi: 'from-orange-500/20 to-orange-600/10 border-orange-500/30 text-orange-300',
  Google: 'from-emerald-500/20 to-emerald-600/10 border-emerald-500/30 text-emerald-300',
  Honor: 'from-rose-500/20 to-rose-600/10 border-rose-500/30 text-rose-300',
};

function slugify(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function brandStyle(marque) {
  return BRAND_COLORS[marque] || 'from-slate-500/20 to-slate-600/10 border-slate-500/30 text-slate-300';
}

function stockBadge(n) {
  const v = Number(n ?? 0);
  if (v < 2) return { cls: 'bg-red-500/20 text-red-300 border-red-500/40', label: v };
  if (v <= 5) return { cls: 'bg-orange-500/20 text-orange-300 border-orange-500/40', label: v };
  return { cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', label: v };
}

export default function AdminTarifsSmartphonesPage() {
  const basePath = useBasePath();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [dirty, setDirty] = useState({});
  const [toast, setToast] = useState(null);
  const [generatingId, setGeneratingId] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newRow, setNewRow] = useState({ ...EMPTY_ROW });
  const [imagePicker, setImagePicker] = useState(null); // { row, candidates: [urls] }
  const [search, setSearch] = useState('');
  const [brandFilter, setBrandFilter] = useState('all');
  const [pdfSelection, setPdfSelection] = useState(() => new Set()); // Set<id>

  function toggleSelect(id) {
    setPdfSelection(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAllVisible(visibleRows) {
    setPdfSelection(new Set(visibleRows.map(r => r.id)));
  }
  function clearSelection() {
    setPdfSelection(new Set());
  }

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await api.getSmartphonesTarifs(false);
      setRows(data || []);
    } catch (e) {
      showToast('error', `Erreur chargement : ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  }

  function updateRow(id, field, value) {
    setRows(rows.map(r => r.id === id ? { ...r, [field]: value } : r));
    setDirty(d => ({ ...d, [id]: true }));
  }

  async function saveRow(row) {
    setSavingId(row.id);
    try {
      await api.updateSmartphoneTarif(row.id, {
        marque: row.marque,
        modele: row.modele,
        stockage_1: row.stockage_1,
        prix_1: row.prix_1 ? Number(row.prix_1) : null,
        stock_1: row.stock_1 != null ? Number(row.stock_1) : 0,
        stockage_2: row.stockage_2 || null,
        prix_2: row.prix_2 ? Number(row.prix_2) : null,
        stock_2: row.stock_2 != null ? Number(row.stock_2) : 0,
        stockage_3: row.stockage_3 || null,
        prix_3: row.prix_3 ? Number(row.prix_3) : null,
        stock_3: row.stock_3 != null ? Number(row.stock_3) : 0,
        condition: row.condition,
        image_url: row.image_url || null,
      });
      setDirty(d => { const c = { ...d }; delete c[row.id]; return c; });
      showToast('success', `${row.marque} ${row.modele} enregistré`);
    } catch (e) {
      showToast('error', `Erreur : ${e.message}`);
    } finally {
      setSavingId(null);
    }
  }

  async function saveAll() {
    const rowsToSave = rows.filter(r => dirty[r.id]);
    for (const r of rowsToSave) await saveRow(r);
  }

  async function createNew() {
    if (!newRow.marque || !newRow.modele) {
      showToast('error', 'Marque et modèle obligatoires');
      return;
    }
    const slug = newRow.slug || slugify(`${newRow.marque} ${newRow.modele}`);
    try {
      await api.createSmartphoneTarif({ ...newRow, slug });
      showToast('success', `${newRow.marque} ${newRow.modele} ajouté`);
      setShowNewForm(false);
      setNewRow({ ...EMPTY_ROW });
      await load();
    } catch (e) {
      showToast('error', `Erreur : ${e.message}`);
    }
  }

  async function removeRow(row) {
    if (!confirm(`Supprimer ${row.marque} ${row.modele} ?`)) return;
    try {
      await api.deleteSmartphoneTarif(row.id);
      showToast('success', 'Smartphone supprimé');
      await load();
    } catch (e) {
      showToast('error', `Erreur : ${e.message}`);
    }
  }

  async function generateImage(row) {
    setGeneratingId(row.id);
    try {
      const res = await api.generateSmartphoneImage(row.marque, row.modele, row.stockage_1);
      setImagePicker({ row, candidates: [res.image_url, ...(res.alternatives || [])] });
    } catch (e) {
      showToast('error', `Erreur recherche image : ${e.message}`);
    } finally {
      setGeneratingId(null);
    }
  }

  async function chooseImage(row, url) {
    try {
      await api.updateSmartphoneTarif(row.id, { image_url: url });
      await load();
      setImagePicker(null);
      showToast('success', 'Image enregistrée');
    } catch (e) {
      showToast('error', `Erreur : ${e.message}`);
    }
  }

  const dirtyCount = Object.keys(dirty).length;

  // Group counts by brand
  const brandCounts = useMemo(() => {
    const counts = {};
    rows.forEach(r => {
      const b = r.marque || 'Autre';
      counts[b] = (counts[b] || 0) + 1;
    });
    return counts;
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (brandFilter !== 'all' && r.marque !== brandFilter) return false;
      if (!q) return true;
      return (
        (r.marque || '').toLowerCase().includes(q) ||
        (r.modele || '').toLowerCase().includes(q) ||
        (r.slug || '').toLowerCase().includes(q)
      );
    });
  }, [rows, search, brandFilter]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-zinc-900 to-slate-900 text-white">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-6">
          <div className="flex items-start gap-4">
            <Link
              to={basePath}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-all"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-black flex items-center gap-2">
                <Smartphone className="w-6 h-6 text-brand-400" />
                Tarifs Smartphones
              </h1>
              <p className="text-sm text-slate-400 mt-1">
                Samsung, Xiaomi, Google Pixel, Honor — gérez tous vos smartphones non-Apple
              </p>

              {/* Brand badges */}
              {!loading && rows.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    onClick={() => setBrandFilter('all')}
                    className={`px-3 py-1 text-xs font-bold rounded-full border transition-all ${
                      brandFilter === 'all'
                        ? 'bg-white/15 border-white/30 text-white'
                        : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    Tous <span className="opacity-70">({rows.length})</span>
                  </button>
                  {Object.entries(brandCounts).sort((a, b) => b[1] - a[1]).map(([brand, n]) => (
                    <button
                      key={brand}
                      onClick={() => setBrandFilter(brandFilter === brand ? 'all' : brand)}
                      className={`px-3 py-1 text-xs font-bold rounded-full border bg-gradient-to-br transition-all ${brandStyle(brand)} ${
                        brandFilter === brand ? 'ring-2 ring-white/30 scale-105' : 'opacity-85 hover:opacity-100'
                      }`}
                    >
                      {brand} <span className="opacity-70">({n})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={async () => {
                try {
                  const sel = Array.from(pdfSelection);
                  if (sel.length === 0) {
                    showToast('error', 'Coche au moins un smartphone');
                    return;
                  }
                  await openPdf({ ids: sel });
                } catch (e) {
                  showToast('error', `PDF : ${e.message}`);
                }
              }}
              disabled={pdfSelection.size === 0}
              title={pdfSelection.size === 0 ? 'Sélectionne des smartphones via les cases' : `PDF A4 (${pdfSelection.size} modèles)`}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-br from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm shadow-lg shadow-rose-500/20 transition-all"
            >
              <FileDown className="w-4 h-4" /> PDF
              {pdfSelection.size > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-md bg-white/20 text-[11px] font-black">
                  {pdfSelection.size}
                </span>
              )}
            </button>
            <button
              onClick={() => setShowNewForm(s => !s)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm shadow-lg shadow-brand-500/20 transition-all"
            >
              <Plus className="w-4 h-4" /> Ajouter
            </button>
            {dirtyCount > 0 && (
              <button
                onClick={saveAll}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-sm shadow-lg shadow-emerald-500/20 transition-all animate-pulse"
              >
                <Save className="w-4 h-4" />
                Enregistrer ({dirtyCount})
              </button>
            )}
          </div>
        </div>

        {/* Search + filter */}
        {!loading && rows.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher une marque, un modèle…"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-white/10 text-slate-500"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700">
              <Filter className="w-4 h-4 text-slate-500" />
              <select
                value={brandFilter}
                onChange={(e) => setBrandFilter(e.target.value)}
                className="bg-transparent text-sm font-semibold text-white focus:outline-none min-w-[120px]"
              >
                <option value="all" className="bg-slate-900">Toutes marques</option>
                {Object.keys(brandCounts).sort().map(b => (
                  <option key={b} value={b} className="bg-slate-900">{b}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Nouveau form inline */}
        {showNewForm && (
          <div className="mb-6 bg-gradient-to-br from-slate-800/80 to-slate-900/80 border border-brand-500/30 rounded-2xl p-6 shadow-xl shadow-brand-500/5">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-black text-lg flex items-center gap-2">
                <div className="p-2 rounded-lg bg-brand-500/20">
                  <Plus className="w-5 h-5 text-brand-400" />
                </div>
                Nouveau smartphone
              </h2>
              <button
                onClick={() => setShowNewForm(false)}
                className="p-2 rounded-lg hover:bg-white/10 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Col 1 : identité */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-brand-400 flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5" /> Identité
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Marque *" value={newRow.marque}
                    onChange={v => setNewRow({ ...newRow, marque: v })}
                    placeholder="Samsung" />
                  <Field label="Modèle *" value={newRow.modele}
                    onChange={v => setNewRow({ ...newRow, modele: v })}
                    placeholder="Galaxy A17" />
                </div>
                <SelectField label="Condition" value={newRow.condition}
                  onChange={v => setNewRow({ ...newRow, condition: v })}
                  options={['Neuf', 'Reconditionné Premium']} />
                <Field label="Slug (auto si vide)" value={newRow.slug}
                  onChange={v => setNewRow({ ...newRow, slug: v })}
                  placeholder={slugify(`${newRow.marque} ${newRow.modele}`) || 'samsung-galaxy-a17'} />

                {/* Preview image */}
                <div className="pt-2">
                  <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider mb-2">
                    Aperçu
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-24 h-24 rounded-xl bg-white flex items-center justify-center overflow-hidden border border-slate-700">
                      {newRow.image_url ? (
                        <img src={newRow.image_url} alt="" className="max-w-full max-h-full object-contain" />
                      ) : (
                        <ImageIcon className="w-8 h-8 text-slate-300" />
                      )}
                    </div>
                    <div className="flex-1">
                      <input
                        type="text"
                        value={newRow.image_url}
                        onChange={(e) => setNewRow({ ...newRow, image_url: e.target.value })}
                        placeholder="URL de l'image (optionnel)"
                        className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"
                      />
                      <p className="text-[10px] text-slate-500 mt-1">
                        Laisser vide et utiliser <Sparkles className="w-3 h-3 inline text-purple-400" /> après création
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Col 2 : variantes */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-brand-400 flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5" /> Variantes stockage
                </h3>
                <div className="bg-slate-900/40 rounded-xl border border-slate-700/50 p-3 space-y-2">
                  <div className="text-[10px] font-bold text-slate-500 uppercase">Variante 1 (principale)</div>
                  <div className="grid grid-cols-3 gap-2">
                    <Field compact label="Stockage" value={newRow.stockage_1}
                      onChange={v => setNewRow({ ...newRow, stockage_1: v })} />
                    <Field compact label="Prix €" type="number" value={newRow.prix_1}
                      onChange={v => setNewRow({ ...newRow, prix_1: v })} />
                    <Field compact label="Stock" type="number" value={newRow.stock_1}
                      onChange={v => setNewRow({ ...newRow, stock_1: v })} />
                  </div>
                </div>
                <div className="bg-slate-900/40 rounded-xl border border-slate-700/50 p-3 space-y-2">
                  <div className="text-[10px] font-bold text-slate-500 uppercase">Variante 2 (optionnel)</div>
                  <div className="grid grid-cols-3 gap-2">
                    <Field compact label="Stockage" value={newRow.stockage_2}
                      onChange={v => setNewRow({ ...newRow, stockage_2: v })} />
                    <Field compact label="Prix €" type="number" value={newRow.prix_2 ?? ''}
                      onChange={v => setNewRow({ ...newRow, prix_2: v })} />
                    <Field compact label="Stock" type="number" value={newRow.stock_2}
                      onChange={v => setNewRow({ ...newRow, stock_2: v })} />
                  </div>
                </div>
                <div className="bg-slate-900/40 rounded-xl border border-slate-700/50 p-3 space-y-2">
                  <div className="text-[10px] font-bold text-slate-500 uppercase">Variante 3 (optionnel)</div>
                  <div className="grid grid-cols-3 gap-2">
                    <Field compact label="Stockage" value={newRow.stockage_3}
                      onChange={v => setNewRow({ ...newRow, stockage_3: v })} />
                    <Field compact label="Prix €" type="number" value={newRow.prix_3 ?? ''}
                      onChange={v => setNewRow({ ...newRow, prix_3: v })} />
                    <Field compact label="Stock" type="number" value={newRow.stock_3}
                      onChange={v => setNewRow({ ...newRow, stock_3: v })} />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-white/10">
              <button
                onClick={() => setShowNewForm(false)}
                className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/15 text-sm font-semibold transition-all"
              >
                Annuler
              </button>
              <button
                onClick={createNew}
                className="px-6 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-sm font-bold shadow-lg shadow-brand-500/20 transition-all"
              >
                Créer le smartphone
              </button>
            </div>
          </div>
        )}

        {/* Tableau / loading / empty */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
          {loading ? (
            <TableSkeleton />
          ) : rows.length === 0 ? (
            <EmptyState onAdd={() => setShowNewForm(true)} onQuickAdd={(brand) => {
              setNewRow({ ...EMPTY_ROW, marque: brand });
              setShowNewForm(true);
            }} />
          ) : filteredRows.length === 0 ? (
            <div className="text-center py-16 px-6">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-slate-800 mb-4">
                <Search className="w-8 h-8 text-slate-500" />
              </div>
              <p className="text-slate-300 font-semibold mb-1">Aucun résultat</p>
              <p className="text-sm text-slate-500">
                Essayez une autre recherche ou changez le filtre de marque.
              </p>
              <button
                onClick={() => { setSearch(''); setBrandFilter('all'); }}
                className="mt-4 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/15 text-sm font-semibold"
              >
                Réinitialiser les filtres
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: '1040px', tableLayout: 'fixed' }}>
                <thead className="bg-slate-800/60 text-slate-300 text-xs uppercase">
                  <tr>
                    <th className="px-2 py-3 text-center w-10">
                      <input
                        type="checkbox"
                        checked={filteredRows.length > 0 && filteredRows.every(r => pdfSelection.has(r.id))}
                        onChange={(e) => {
                          if (e.target.checked) selectAllVisible(filteredRows);
                          else clearSelection();
                        }}
                        title="Tout sélectionner pour le PDF"
                        className="w-4 h-4 accent-rose-500 cursor-pointer"
                      />
                    </th>
                    <th className="px-2 py-3 text-left w-[64px]">Photo</th>
                    <th className="px-2 py-3 text-left w-24">Marque</th>
                    <th className="px-2 py-3 text-left min-w-[180px]">Modèle</th>
                    <th className="px-2 py-3 text-left w-36">Condition</th>
                    <th className="px-2 py-3 text-left w-24">Stockage</th>
                    <th className="px-2 py-3 text-left w-24">Prix €</th>
                    <th className="px-2 py-3 text-center w-16">Stock</th>
                    <th className="px-2 py-3 text-left w-24 hidden xl:table-cell">Stockage 2</th>
                    <th className="px-2 py-3 text-left w-24 hidden xl:table-cell">Prix 2 €</th>
                    <th className="px-2 py-3 text-center w-16 hidden xl:table-cell">Stock 2</th>
                    <th className="px-2 py-3 text-right w-28">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r, idx) => (
                    <tr
                      key={r.id}
                      className={`border-t border-slate-800 transition-colors ${
                        dirty[r.id]
                          ? 'bg-brand-500/10 ring-1 ring-inset ring-brand-500/30'
                          : idx % 2 === 0 ? 'hover:bg-slate-800/30' : 'bg-slate-900/30 hover:bg-slate-800/30'
                      }`}
                    >
                      <td className="px-2 py-2 text-center align-middle">
                        <input
                          type="checkbox"
                          checked={pdfSelection.has(r.id)}
                          onChange={() => toggleSelect(r.id)}
                          title="Inclure dans le PDF"
                          className="w-4 h-4 accent-rose-500 cursor-pointer"
                        />
                      </td>
                      <Cell>
                        <div className="flex items-center gap-1">
                          {r.image_url ? (
                            <div className="relative group/img">
                              <img src={r.image_url} alt=""
                                className="w-14 h-14 rounded-lg object-contain bg-white p-1 border border-slate-700" />
                              <button
                                onClick={() => generateImage(r)}
                                disabled={generatingId === r.id}
                                title="Remplacer l'image"
                                className="absolute -bottom-1 -right-1 p-1 rounded-full bg-brand-500 hover:bg-brand-600 text-white shadow-lg opacity-0 group-hover/img:opacity-100 transition-opacity disabled:opacity-100"
                              >
                                {generatingId === r.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <RefreshCw className="w-3 h-3" />
                                )}
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => generateImage(r)}
                              disabled={generatingId === r.id}
                              title="Chercher une image"
                              className="w-14 h-14 rounded-lg bg-slate-800/50 border-2 border-dashed border-slate-700 hover:border-brand-500 hover:bg-brand-500/10 flex items-center justify-center text-slate-500 hover:text-brand-400 transition-all"
                            >
                              {generatingId === r.id ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                              ) : (
                                <ImageIcon className="w-5 h-5" />
                              )}
                            </button>
                          )}
                        </div>
                      </Cell>
                      <td className="px-2 py-2 align-middle">
                        <input type="text" value={r.marque || ''}
                          onChange={(e) => updateRow(r.id, 'marque', e.target.value)}
                          className="input-cell w-full font-bold" />
                      </td>
                      <td className="px-2 py-2 align-middle">
                        <input type="text" value={r.modele || ''}
                          onChange={(e) => updateRow(r.id, 'modele', e.target.value)}
                          className="input-cell w-full font-semibold text-white"
                          placeholder="Ex: Galaxy A17 5G" />
                      </td>
                      <td className="px-2 py-2 align-middle">
                        <div className="relative">
                          <select value={r.condition || 'Reconditionné Premium'}
                            onChange={(e) => updateRow(r.id, 'condition', e.target.value)}
                            className={`input-cell w-full pl-6 pr-1 font-bold appearance-none cursor-pointer ${
                              r.condition === 'Neuf'
                                ? 'text-emerald-200 border-emerald-600/50 bg-emerald-500/10'
                                : 'text-blue-200 border-blue-600/50 bg-blue-500/10'
                            }`}>
                            <option value="Neuf">Neuf</option>
                            <option value="Reconditionné Premium">Recond. Premium</option>
                          </select>
                          <span className={`absolute left-2 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full pointer-events-none ${
                            r.condition === 'Neuf' ? 'bg-emerald-400' : 'bg-blue-400'
                          }`} />
                        </div>
                      </td>
                      <td className="px-2 py-2 align-middle">
                        <input type="text" value={r.stockage_1 || ''}
                          onChange={(e) => updateRow(r.id, 'stockage_1', e.target.value)}
                          placeholder="128 Go"
                          className="input-cell w-full" />
                      </td>
                      <td className="px-2 py-2 align-middle">
                        <input type="number" value={r.prix_1 || ''}
                          onChange={(e) => updateRow(r.id, 'prix_1', e.target.value)}
                          className="input-cell w-full font-bold text-brand-300" />
                      </td>
                      <td className="px-2 py-2 text-center align-middle">
                        <StockInput value={r.stock_1} onChange={(v) => updateRow(r.id, 'stock_1', v)} />
                      </td>
                      <td className="px-2 py-2 align-middle hidden xl:table-cell">
                        <input type="text" value={r.stockage_2 || ''}
                          onChange={(e) => updateRow(r.id, 'stockage_2', e.target.value)}
                          placeholder="256 Go"
                          className="input-cell w-full" />
                      </td>
                      <td className="px-2 py-2 align-middle hidden xl:table-cell">
                        <input type="number" value={r.prix_2 || ''}
                          onChange={(e) => updateRow(r.id, 'prix_2', e.target.value)}
                          className="input-cell w-full font-bold text-brand-300" />
                      </td>
                      <td className="px-2 py-2 text-center align-middle hidden xl:table-cell">
                        <StockInput value={r.stock_2} onChange={(v) => updateRow(r.id, 'stock_2', v)} />
                      </td>
                      <td className="px-2 py-2 text-right align-middle">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => generateImage(r)}
                            disabled={generatingId === r.id}
                            title="Rechercher image"
                            className="p-2 rounded-lg bg-purple-500/15 hover:bg-purple-500/30 text-purple-300 transition-all disabled:opacity-50"
                          >
                            {generatingId === r.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Sparkles className="w-4 h-4" />
                            )}
                          </button>
                          {dirty[r.id] && (
                            <button
                              onClick={() => saveRow(r)}
                              disabled={savingId === r.id}
                              title="Enregistrer"
                              className="p-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 transition-all"
                            >
                              {savingId === r.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Save className="w-4 h-4" />
                              )}
                            </button>
                          )}
                          <button
                            onClick={() => removeRow(r)}
                            title="Supprimer"
                            className="p-2 rounded-lg bg-red-500/15 hover:bg-red-500/30 text-red-300 transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal choix image */}
        {imagePicker && (
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in"
            onClick={() => setImagePicker(null)}
          >
            <div
              className="bg-gradient-to-br from-slate-900 to-slate-950 rounded-3xl border border-white/10 max-w-5xl w-full max-h-[92vh] overflow-y-auto shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 z-10 flex items-center justify-between p-5 border-b border-white/10 bg-slate-900/95 backdrop-blur-md">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-brand-500/20">
                    <ImageIcon className="w-5 h-5 text-brand-400" />
                  </div>
                  <div>
                    <h3 className="font-black text-lg leading-tight">
                      Choisir la photo
                    </h3>
                    <p className="text-sm text-slate-400">
                      {imagePicker.row.marque} {imagePicker.row.modele}
                    </p>
                  </div>
                </div>
                <button onClick={() => setImagePicker(null)}
                  className="p-2.5 rounded-xl bg-white/5 hover:bg-white/15 transition-all">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="px-5 pt-4 pb-2">
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Search className="w-4 h-4" />
                  <span>
                    {imagePicker.candidates.length} photos trouvées via DuckDuckGo Images — cliquez sur la meilleure
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-5">
                {imagePicker.candidates.map((url, i) => (
                  <button
                    key={i}
                    onClick={() => chooseImage(imagePicker.row, url)}
                    className="group relative bg-white rounded-2xl overflow-hidden aspect-square flex items-center justify-center hover:ring-4 hover:ring-brand-500 transition-all shadow-lg hover:shadow-2xl hover:scale-[1.03]"
                  >
                    <img src={url} alt="" referrerPolicy="no-referrer"
                      className="max-w-full max-h-full object-contain p-4 group-hover:scale-110 transition-transform duration-300"
                      onError={(e) => { e.target.style.opacity = '0.25'; }}
                    />
                    {i === 0 && (
                      <div className="absolute top-2 left-2 flex items-center gap-1 bg-gradient-to-r from-amber-400 to-orange-500 text-white text-[10px] font-black px-2 py-1 rounded-full shadow-lg">
                        <Star className="w-3 h-3 fill-current" />
                        RECOMMANDÉ
                      </div>
                    )}
                    <div className="absolute bottom-2 right-2 w-6 h-6 flex items-center justify-center bg-slate-900 text-white text-[11px] font-bold rounded-full shadow-lg">
                      {i + 1}
                    </div>
                    <div className="absolute inset-0 bg-brand-500/0 group-hover:bg-brand-500/10 transition-colors" />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-brand-600 to-transparent text-white text-xs font-bold py-2 px-3 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                      <Check className="w-3.5 h-3.5" /> Choisir cette photo
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div
            className={`fixed top-6 right-6 z-[60] px-4 py-3 rounded-xl shadow-2xl text-sm font-bold flex items-center gap-3 animate-toast-in min-w-[280px] max-w-sm border ${
              toast.type === 'error'
                ? 'bg-gradient-to-r from-red-500 to-red-600 border-red-400 text-white'
                : 'bg-gradient-to-r from-emerald-500 to-emerald-600 border-emerald-400 text-white'
            }`}
          >
            <div className={`p-1.5 rounded-lg ${toast.type === 'error' ? 'bg-red-600/40' : 'bg-emerald-600/40'}`}>
              {toast.type === 'error' ? (
                <AlertCircle className="w-4 h-4" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
            </div>
            <span className="flex-1">{toast.msg}</span>
            <button
              onClick={() => setToast(null)}
              className="p-1 rounded-md hover:bg-white/20 transition-all"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <style>{`
        .input-cell {
          background: rgb(30 41 59 / 0.5);
          border: 1px solid rgb(51 65 85);
          border-radius: 0.5rem;
          padding: 0.45rem 0.55rem;
          color: white;
          transition: all 0.15s ease;
          font-size: 0.925rem;
          min-width: 0;
        }
        .input-cell[type="number"] {
          font-variant-numeric: tabular-nums;
        }
        .input-cell:focus {
          outline: none;
          border-color: rgb(124 58 237);
          box-shadow: 0 0 0 2px rgb(124 58 237 / 0.2);
        }
        .input-cell:hover {
          border-color: rgb(71 85 105);
        }
        @keyframes toast-in {
          from {
            opacity: 0;
            transform: translateX(24px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateX(0) scale(1);
          }
        }
        .animate-toast-in {
          animation: toast-in 0.22s cubic-bezier(0.21, 1.02, 0.73, 1);
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-fade-in {
          animation: fade-in 0.18s ease-out;
        }
        @keyframes skeleton-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.7; }
        }
        .skeleton {
          background: linear-gradient(90deg, rgb(51 65 85 / 0.3) 0%, rgb(71 85 105 / 0.5) 50%, rgb(51 65 85 / 0.3) 100%);
          background-size: 200% 100%;
          animation: skeleton-pulse 1.6s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

function StockInput({ value, onChange }) {
  const badge = stockBadge(value);
  return (
    <div className="relative inline-block">
      <input
        type="number"
        value={value ?? 0}
        onChange={(e) => onChange(e.target.value)}
        className={`w-14 text-center font-black rounded-lg px-2 py-1.5 border ${badge.cls} focus:outline-none focus:ring-2 focus:ring-brand-500/30`}
      />
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="p-4 space-y-3">
      <div className="flex gap-3 pb-3 border-b border-slate-800">
        {['w-20', 'w-24', 'flex-1', 'w-32', 'w-20', 'w-20', 'w-16'].map((w, i) => (
          <div key={i} className={`h-3 rounded-full skeleton ${w}`} />
        ))}
      </div>
      {[...Array(6)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2">
          <div className="w-14 h-14 rounded-lg skeleton" />
          <div className="w-20 h-4 rounded skeleton" />
          <div className="flex-1 h-4 rounded skeleton" />
          <div className="w-32 h-8 rounded-lg skeleton" />
          <div className="w-16 h-4 rounded skeleton" />
          <div className="w-16 h-4 rounded skeleton" />
          <div className="w-10 h-7 rounded-lg skeleton" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onAdd, onQuickAdd }) {
  return (
    <div className="text-center py-16 px-6">
      <div className="relative inline-flex items-center justify-center mb-6">
        <div className="absolute inset-0 bg-brand-500/20 rounded-full blur-2xl" />
        <div className="relative w-24 h-24 rounded-3xl bg-gradient-to-br from-brand-500/30 to-brand-700/20 border border-brand-500/30 flex items-center justify-center">
          <Smartphone className="w-12 h-12 text-brand-300" />
        </div>
      </div>
      <h3 className="text-xl font-black mb-2">Aucun smartphone pour l'instant</h3>
      <p className="text-slate-400 text-sm max-w-md mx-auto mb-6">
        Commencez par ajouter vos modèles Samsung, Xiaomi, Google Pixel ou Honor.
        Les photos se récupèrent automatiquement via DuckDuckGo.
      </p>

      <div className="mb-6">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center justify-center gap-2">
          <TrendingUp className="w-3.5 h-3.5" /> Marques populaires
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {POPULAR_BRANDS.map(b => (
            <button
              key={b}
              onClick={() => onQuickAdd(b)}
              className={`px-4 py-2 text-sm font-bold rounded-xl border bg-gradient-to-br transition-all hover:scale-105 ${brandStyle(b)}`}
            >
              + {b}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={onAdd}
        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm shadow-xl shadow-brand-500/30 transition-all"
      >
        <Plus className="w-4 h-4" />
        Ajouter un smartphone
      </button>
    </div>
  );
}

function Cell({ children }) {
  return <td className="px-3 py-2 align-middle">{children}</td>;
}

function Field({ label, value, onChange, type = 'text', placeholder, compact = false }) {
  return (
    <label className="block">
      <span className={`${compact ? 'text-[10px]' : 'text-[11px]'} text-slate-400 font-semibold uppercase tracking-wider`}>
        {label}
      </span>
      <input
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full mt-1 px-3 ${compact ? 'py-1.5' : 'py-2'} rounded-lg bg-slate-800 border border-slate-700 ${compact ? 'text-xs' : 'text-sm'} text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all`}
      />
    </label>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
