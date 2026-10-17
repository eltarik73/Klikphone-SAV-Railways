import { useState, useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Smartphone, Save, Plus, ArrowLeft, Loader2, Check, X, Trash2,
  Sparkles, Image as ImageIcon, Search, Filter, AlertCircle,
  CheckCircle2, Star, RefreshCw, Package, TrendingUp, Tag, FileDown, SlidersHorizontal, History,
} from 'lucide-react';
import api from '../lib/api';
import { useAdminElevation } from '../hooks/useAdminElevation';
import HistoriquePrix, { BadgeDatePrix, BoutonVerrou, FiltreAnciens, messageErreurPrix, plusDeTroisMois } from '../components/HistoriquePrix';
import { AIDE_VERROU_BOUTIQUE, AjustementColonne, useVerrousBoutique } from '../components/ReglesPrixPanel';

const TABLE = 'smartphones_tarifs';
const COLONNES_PRIX = [
  { key: 'prix_1', label: 'Prix 1 (1er stockage)' },
  { key: 'prix_2', label: 'Prix 2 (2e stockage)' },
  { key: 'prix_3', label: 'Prix 3 (3e stockage)' },
];

async function openPdf({ ids = null, marque = null } = {}) {
  let qs = '';
  if (ids && ids.length) {
    qs = `?ids=${ids.join(',')}`;
  } else if (marque) {
    qs = `?marque=${encodeURIComponent(marque)}`;
  }
  // Via l'ApiClient : message d'erreur du serveur plutôt que « Erreur 404 »
  const blob = await api.requestRaw(`/api/smartphones-tarifs/pdf${qs}`, { as: 'blob', timeoutMs: 60_000 });
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


function slugify(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stockBadge(n) {
  const v = Number(n ?? 0);
  if (v < 2) return { cls: 'bg-red-50 text-red-700 border-red-200', label: v };
  if (v <= 5) return { cls: 'bg-amber-50 text-amber-800 border-amber-200', label: v };
  return { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: v };
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
  const { sensible, adminPrompt } = useAdminElevation();
  const { verrouilles, basculer: basculerVerrou, enCours: verrouEnCours } = useVerrousBoutique(TABLE, sensible);
  const [anciensSeuls, setAnciensSeuls] = useState(false);
  const [fenetre, setFenetre] = useState(null); // 'ajuster' | 'historique'

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
      showToast('error', messageErreurPrix(e, 'Chargement impossible') || 'Chargement impossible');
    } finally {
      setLoading(false);
    }
  }

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), type === 'error' ? 6000 : 3000);
  }

  // Message d'erreur lisible ; rien si l'identification admin a été annulée
  function toastErreur(e, action) {
    const msg = messageErreurPrix(e, action);
    if (msg) showToast('error', msg);
  }

  function updateRow(id, field, value) {
    setRows(rows.map(r => r.id === id ? { ...r, [field]: value } : r));
    setDirty(d => ({ ...d, [id]: true }));
  }

  async function saveRow(row) {
    setSavingId(row.id);
    try {
      await sensible(() => api.updateSmartphoneTarif(row.id, {
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
      }));
      setDirty(d => { const c = { ...d }; delete c[row.id]; return c; });
      showToast('success', `${row.marque} ${row.modele} enregistré`);
      return true;
    } catch (e) {
      toastErreur(e, `${row.marque} ${row.modele} non enregistré`);
      return false;
    } finally {
      setSavingId(null);
    }
  }

  async function saveAll() {
    const rowsToSave = rows.filter(r => dirty[r.id]);
    for (const r of rowsToSave) {
      // Un échec (ou l'identification annulée) arrête la série : le message reste lisible
      if (!(await saveRow(r))) return false;
    }
    return true;
  }

  async function createNew() {
    if (!newRow.marque || !newRow.modele) {
      showToast('error', 'Marque et modèle obligatoires');
      return;
    }
    const slug = newRow.slug || slugify(`${newRow.marque} ${newRow.modele}`);
    try {
      await sensible(() => api.createSmartphoneTarif({ ...newRow, slug }));
      showToast('success', `${newRow.marque} ${newRow.modele} ajouté`);
      setShowNewForm(false);
      setNewRow({ ...EMPTY_ROW });
      await load();
    } catch (e) {
      toastErreur(e, 'Smartphone non ajouté');
    }
  }

  async function removeRow(row) {
    if (verrouilles.has(row.id)) {
      showToast('error', `${row.marque} ${row.modele} est verrouillé : ouvrez le cadenas avant de le supprimer.`);
      return;
    }
    if (!confirm(`Supprimer ${row.marque} ${row.modele} ?`)) return;
    try {
      await sensible(() => api.deleteSmartphoneTarif(row.id));
      showToast('success', 'Smartphone supprimé');
      await load();
    } catch (e) {
      toastErreur(e, 'Suppression impossible');
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
      await sensible(() => api.updateSmartphoneTarif(row.id, { image_url: url }));
      await load();
      setImagePicker(null);
      showToast('success', 'Image enregistrée');
    } catch (e) {
      toastErreur(e, 'Image non enregistrée');
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

  const nombreAnciens = useMemo(() => rows.filter(r => plusDeTroisMois(r)).length, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (anciensSeuls && !plusDeTroisMois(r)) return false;
      if (brandFilter !== 'all' && r.marque !== brandFilter) return false;
      if (!q) return true;
      return (
        (r.marque || '').toLowerCase().includes(q) ||
        (r.modele || '').toLowerCase().includes(q) ||
        (r.slug || '').toLowerCase().includes(q)
      );
    });
  }, [rows, search, brandFilter, anciensSeuls]);

  return (
    <div className="page max-w-[1280px]">
      <div>
        {/* Header */}
        <div className="page-header">
          <div className="flex items-start gap-2 min-w-0">
            <Link
              to={basePath}
              aria-label="Retour"
              className="btn-ghost btn-icon shrink-0 -ml-2"
            >
              <ArrowLeft aria-hidden="true" />
            </Link>
            <div className="min-w-0">
              <h1 className="page-header-title">
                Tarifs Smartphones
              </h1>
              <p className="page-header-subtitle">
                Samsung, Xiaomi, Google Pixel, Honor — gérez tous vos smartphones non-Apple
              </p>
            </div>
          </div>

          <div className="page-header-actions max-w-full">
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
              className="btn-secondary"
            >
              <FileDown /> PDF
              {pdfSelection.size > 0 && (
                <span className="badge-count badge-count-brand">
                  {pdfSelection.size}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setFenetre('historique')}
              className="btn-secondary"
            >
              <History aria-hidden="true" /> Historique
            </button>
            <button
              type="button"
              onClick={() => setFenetre('ajuster')}
              className="btn-secondary"
            >
              <SlidersHorizontal aria-hidden="true" /> Ajuster en %
            </button>
            {/* Un seul bouton plein : « Ajouter », sauf quand des modifications attendent d'être enregistrées */}
            <button
              onClick={() => setShowNewForm(s => !s)}
              className={dirtyCount > 0 ? 'btn-secondary' : 'btn-primary'}
            >
              <Plus /> Ajouter
            </button>
            {dirtyCount > 0 && (
              <button
                onClick={saveAll}
                className="btn-primary"
              >
                <Save />
                Enregistrer ({dirtyCount})
              </button>
            )}
          </div>
        </div>

        {/* Brand filter */}
        {!loading && rows.length > 0 && (
          <div className="scroll-fade-x mb-4">
            <div className="segmented" role="group" aria-label="Marques">
              <button
                type="button"
                onClick={() => setBrandFilter('all')}
                aria-pressed={brandFilter === 'all'}
                className={`segmented-item ${brandFilter === 'all' ? 'segmented-item-active' : ''}`}
              >
                Tous <span className="text-slate-500">({rows.length})</span>
              </button>
              {Object.entries(brandCounts).sort((a, b) => b[1] - a[1]).map(([brand, n]) => (
                <button
                  key={brand}
                  type="button"
                  onClick={() => setBrandFilter(brandFilter === brand ? 'all' : brand)}
                  aria-pressed={brandFilter === brand}
                  className={`segmented-item ${brandFilter === brand ? 'segmented-item-active' : ''}`}
                >
                  {brand} <span className="text-slate-500">({n})</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Search + filter */}
        {!loading && rows.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-3 mb-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" aria-hidden="true" />
              <input
                type="search"
                value={search}
                aria-label="Rechercher une marque, un modèle"
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher une marque, un modèle…"
                className="input pl-10 pr-12"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  aria-label="Effacer la recherche"
                  className="btn-ghost btn-icon absolute right-0 top-1/2 -translate-y-1/2 text-slate-500"
                >
                  <X aria-hidden="true" />
                </button>
              )}
            </div>
            <FiltreAnciens actif={anciensSeuls} onChange={setAnciensSeuls} nombre={nombreAnciens} />
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" aria-hidden="true" />
              <select
                value={brandFilter}
                aria-label="Filtrer par marque"
                onChange={(e) => setBrandFilter(e.target.value)}
                className="select pl-9 min-w-[180px] font-medium"
              >
                <option value="all">Toutes marques</option>
                {Object.keys(brandCounts).sort().map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
          </div>
        )}
        {!loading && rows.length > 0 && <p className="t-caption mb-4">{AIDE_VERROU_BOUTIQUE.note}</p>}

        {/* Nouveau form inline */}
        {showNewForm && (
          <div className="card border-brand-300 mb-6">
            <div className="card-header">
              <h2 className="t-h2 flex items-center gap-2">
                <Plus className="w-4 h-4 text-slate-400" aria-hidden="true" />
                Nouveau smartphone
              </h2>
              <button
                onClick={() => setShowNewForm(false)}
                aria-label="Fermer le formulaire"
                className="btn-ghost btn-icon"
              >
                <X />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 px-4 sm:px-5 pb-4 sm:pb-5">
              {/* Col 1 : identité */}
              <div className="space-y-4">
                <h3 className="t-h3 flex items-center gap-1.5">
                  <Tag className="w-4 h-4 text-slate-400" aria-hidden="true" /> Identité
                </h3>
                <div className="grid grid-cols-2 gap-4">
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
                  <p className="input-label">
                    Aperçu
                  </p>
                  <div className="flex items-center gap-3">
                    <div className="w-24 h-24 rounded-lg bg-white flex items-center justify-center overflow-hidden border border-slate-200 shrink-0">
                      {newRow.image_url ? (
                        <img src={newRow.image_url} alt="" className="max-w-full max-h-full object-contain" />
                      ) : (
                        <ImageIcon className="w-8 h-8 text-slate-300" aria-hidden="true" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <input
                        type="text"
                        value={newRow.image_url}
                        onChange={(e) => setNewRow({ ...newRow, image_url: e.target.value })}
                        placeholder="URL de l'image (optionnel)"
                        aria-label="URL de l'image"
                        className="input"
                      />
                      <p className="input-help">
                        Laisser vide et utiliser <Sparkles className="w-3 h-3 inline text-brand-600" aria-hidden="true" /> après création
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Col 2 : variantes */}
              <div className="space-y-4">
                <h3 className="t-h3 flex items-center gap-1.5">
                  <Package className="w-4 h-4 text-slate-400" aria-hidden="true" /> Variantes stockage
                </h3>
                <div className="card-section space-y-2">
                  <div className="t-h3">Variante 1 (principale)</div>
                  <div className="grid grid-cols-3 gap-2">
                    <Field compact label="Stockage" value={newRow.stockage_1}
                      onChange={v => setNewRow({ ...newRow, stockage_1: v })} />
                    <Field compact label="Prix €" type="number" value={newRow.prix_1}
                      onChange={v => setNewRow({ ...newRow, prix_1: v })} />
                    <Field compact label="Stock" type="number" value={newRow.stock_1}
                      onChange={v => setNewRow({ ...newRow, stock_1: v })} />
                  </div>
                </div>
                <div className="card-section space-y-2">
                  <div className="t-h3">Variante 2 (optionnel)</div>
                  <div className="grid grid-cols-3 gap-2">
                    <Field compact label="Stockage" value={newRow.stockage_2}
                      onChange={v => setNewRow({ ...newRow, stockage_2: v })} />
                    <Field compact label="Prix €" type="number" value={newRow.prix_2 ?? ''}
                      onChange={v => setNewRow({ ...newRow, prix_2: v })} />
                    <Field compact label="Stock" type="number" value={newRow.stock_2}
                      onChange={v => setNewRow({ ...newRow, stock_2: v })} />
                  </div>
                </div>
                <div className="card-section space-y-2">
                  <div className="t-h3">Variante 3 (optionnel)</div>
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

            <div className="card-footer">
              <button
                onClick={() => setShowNewForm(false)}
                className="btn-ghost"
              >
                Annuler
              </button>
              <button
                onClick={createNew}
                className="btn-primary"
              >
                Créer le smartphone
              </button>
            </div>
          </div>
        )}

        {/* Tableau / loading / empty */}
        <div className="card overflow-hidden">
          {loading ? (
            <TableSkeleton />
          ) : rows.length === 0 ? (
            <EmptyState onAdd={() => setShowNewForm(true)} onQuickAdd={(brand) => {
              setNewRow({ ...EMPTY_ROW, marque: brand });
              setShowNewForm(true);
            }} />
          ) : filteredRows.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><Search aria-hidden="true" /></div>
              <p className="t-h2">Aucun résultat</p>
              <p className="t-body text-slate-500">
                Essayez une autre recherche ou changez le filtre de marque.
              </p>
              <button
                onClick={() => { setSearch(''); setBrandFilter('all'); setAnciensSeuls(false); }}
                className="btn-secondary"
              >
                Réinitialiser les filtres
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto scroll-fade-x">
              <table className="table table-dense min-w-[1280px] table-fixed">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="table-header !px-1 text-center w-14">
                      <label className="inline-flex items-center justify-center w-11 h-11 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={filteredRows.length > 0 && filteredRows.every(r => pdfSelection.has(r.id))}
                          onChange={(e) => {
                            if (e.target.checked) selectAllVisible(filteredRows);
                            else clearSelection();
                          }}
                          title="Tout sélectionner pour le PDF"
                          aria-label="Tout sélectionner pour le PDF"
                          className="checkbox"
                        />
                      </label>
                    </th>
                    <th className="table-header !px-2 w-[72px]">Photo</th>
                    <th className="table-header !px-2 w-28">Marque</th>
                    <th className="table-header !px-2 w-[200px]">Modèle</th>
                    <th className="table-header !px-2 w-28">Prix du</th>
                    <th className="table-header !px-2 w-48">Condition</th>
                    <th className="table-header !px-2 w-24">Stockage</th>
                    <th className="table-header !px-2 w-24">Prix €</th>
                    <th className="table-header !px-2 text-center w-20">Stock</th>
                    <th className="table-header !px-2 w-24 hidden xl:table-cell">Stockage 2</th>
                    <th className="table-header !px-2 w-24 hidden xl:table-cell">Prix 2 €</th>
                    <th className="table-header !px-2 text-center w-20 hidden xl:table-cell">Stock 2</th>
                    <th className="table-header !px-2 text-right w-44">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => {
                    const verrou = verrouilles.has(r.id);
                    const aideVerrou = verrou ? 'Prix protégés par le cadenas : ouvrez-le pour les modifier' : undefined;
                    return (
                    <tr
                      key={r.id}
                      className={`table-row ${dirty[r.id] ? 'bg-amber-50/70 hover:bg-amber-50' : ''}`}
                    >
                      <td className="!px-1 !py-1 text-center">
                        <label className="inline-flex items-center justify-center w-11 h-11 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={pdfSelection.has(r.id)}
                            onChange={() => toggleSelect(r.id)}
                            title="Inclure dans le PDF"
                            aria-label={`Inclure ${r.marque} ${r.modele} dans le PDF`}
                            className="checkbox"
                          />
                        </label>
                      </td>
                      <Cell>
                        <div className="flex items-center gap-1">
                          {r.image_url ? (
                            <div className="relative group/img">
                              <img src={r.image_url} alt=""
                                className="w-14 h-14 rounded-lg object-contain bg-white p-1 border border-slate-200" />
                              <button
                                onClick={() => generateImage(r)}
                                disabled={generatingId === r.id}
                                title="Remplacer l'image"
                                className="absolute -bottom-1 -right-1 w-7 h-7 inline-flex items-center justify-center rounded-full bg-brand-600 hover:bg-brand-700 text-white shadow-xs opacity-0 group-hover/img:opacity-100 focus-visible:opacity-100 transition-opacity duration-150 disabled:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                              >
                                {generatingId === r.id ? (
                                  <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin" aria-hidden="true" />
                                ) : (
                                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                                )}
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => generateImage(r)}
                              disabled={generatingId === r.id}
                              title="Chercher une image"
                              className="w-14 h-14 rounded-lg bg-slate-50 border-2 border-dashed border-slate-300 hover:border-brand-400 hover:bg-brand-50 flex items-center justify-center text-slate-500 hover:text-brand-600 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                            >
                              {generatingId === r.id ? (
                                <Loader2 className="w-5 h-5 motion-safe:animate-spin" aria-hidden="true" />
                              ) : (
                                <ImageIcon className="w-5 h-5" aria-hidden="true" />
                              )}
                            </button>
                          )}
                        </div>
                      </Cell>
                      <td className="!px-2">
                        <input type="text" value={r.marque || ''}
                          onChange={(e) => updateRow(r.id, 'marque', e.target.value)}
                          aria-label="Marque"
                          className="input px-2 font-semibold" />
                      </td>
                      <td className="!px-2">
                        <input type="text" value={r.modele || ''}
                          onChange={(e) => updateRow(r.id, 'modele', e.target.value)}
                          aria-label="Modèle"
                          className="input px-2 font-semibold"
                          placeholder="Ex: Galaxy A17 5G" />
                      </td>
                      <td className="!px-2">
                        <BadgeDatePrix row={r} court />
                      </td>
                      <td className="!px-2">
                        <div className="relative">
                          <select value={r.condition || 'Reconditionné Premium'}
                            aria-label={`Condition de ${r.marque} ${r.modele}`}
                            onChange={(e) => updateRow(r.id, 'condition', e.target.value)}
                            className="select pl-6 pr-8 font-medium">
                            <option value="Neuf">Neuf</option>
                            <option value="Reconditionné Premium">Recond. Premium</option>
                          </select>
                          <span className={`absolute left-2 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full pointer-events-none ${
                            r.condition === 'Neuf' ? 'bg-emerald-500' : 'bg-blue-500'
                          }`} aria-hidden="true" />
                        </div>
                      </td>
                      <td className="!px-2">
                        <input type="text" value={r.stockage_1 || ''}
                          aria-label={`Stockage 1 de ${r.modele}`}
                          onChange={(e) => updateRow(r.id, 'stockage_1', e.target.value)}
                          placeholder="128 Go"
                          className="input px-2" />
                      </td>
                      <td className="!px-2">
                        <input type="number" value={r.prix_1 || ''}
                          onChange={(e) => updateRow(r.id, 'prix_1', e.target.value)}
                          readOnly={verrou}
                          title={aideVerrou}
                          aria-label={`Prix 1 de ${r.modele}, en euros${verrou ? ' (verrouillé)' : ''}`}
                          className={`input px-2 font-semibold tabular-nums ${verrou ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : ''}`} />
                      </td>
                      <td className="!px-2 text-center">
                        <StockInput value={r.stock_1} onChange={(v) => updateRow(r.id, 'stock_1', v)} label={`Stock 1 de ${r.modele}`} />
                      </td>
                      <td className="!px-2 hidden xl:table-cell">
                        <input type="text" value={r.stockage_2 || ''}
                          aria-label={`Stockage 2 de ${r.modele}`}
                          onChange={(e) => updateRow(r.id, 'stockage_2', e.target.value)}
                          placeholder="256 Go"
                          className="input px-2" />
                      </td>
                      <td className="!px-2 hidden xl:table-cell">
                        <input type="number" value={r.prix_2 || ''}
                          onChange={(e) => updateRow(r.id, 'prix_2', e.target.value)}
                          readOnly={verrou}
                          title={aideVerrou}
                          aria-label={`Prix 2 de ${r.modele}, en euros${verrou ? ' (verrouillé)' : ''}`}
                          className={`input px-2 font-semibold tabular-nums ${verrou ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : ''}`} />
                      </td>
                      <td className="!px-2 text-center hidden xl:table-cell">
                        <StockInput value={r.stock_2} onChange={(v) => updateRow(r.id, 'stock_2', v)} label={`Stock 2 de ${r.modele}`} />
                      </td>
                      <td className="!px-2 text-right">
                        <div className="flex items-center gap-1 justify-end">
                          <BoutonVerrou
                            verrouille={verrou}
                            onClick={() => basculerVerrou(r.id, `${r.marque} ${r.modele}`)}
                            disabled={verrouEnCours === r.id}
                            nom={`les prix de ${r.marque} ${r.modele}`}
                            aide={verrou ? AIDE_VERROU_BOUTIQUE.oui : AIDE_VERROU_BOUTIQUE.non}
                          />
                          <button
                            onClick={() => generateImage(r)}
                            disabled={generatingId === r.id}
                            aria-label={`Rechercher une image pour ${r.marque} ${r.modele}`}
                            title="Rechercher image"
                            className="btn-ghost btn-icon text-brand-600 hover:text-brand-700 hover:bg-brand-50"
                          >
                            {generatingId === r.id ? (
                              <Loader2 className="motion-safe:animate-spin" />
                            ) : (
                              <Sparkles />
                            )}
                          </button>
                          {dirty[r.id] && (
                            <button
                              onClick={() => saveRow(r)}
                              disabled={savingId === r.id}
                              aria-label={`Enregistrer ${r.marque} ${r.modele}`}
                              title="Enregistrer"
                              className="btn-primary btn-icon"
                            >
                              {savingId === r.id ? (
                                <Loader2 className="motion-safe:animate-spin" />
                              ) : (
                                <Save />
                              )}
                            </button>
                          )}
                          <button
                            onClick={() => removeRow(r)}
                            aria-label={`Supprimer ${r.marque} ${r.modele}`}
                            title="Supprimer"
                            className="btn-danger-ghost btn-icon"
                          >
                            <Trash2 />
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal choix image */}
        {imagePicker && (
          <div
            className="modal-overlay"
            onClick={() => setImagePicker(null)}
          >
            <div
              className="modal sm:max-w-5xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
                    <ImageIcon className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="t-h2">
                      Choisir la photo
                    </h3>
                    <p className="text-sm text-slate-500 truncate">
                      {imagePicker.row.marque} {imagePicker.row.modele}
                    </p>
                  </div>
                </div>
                <button onClick={() => setImagePicker(null)}
                  aria-label="Fermer le choix de photo"
                  className="btn-ghost btn-icon shrink-0">
                  <X />
                </button>
              </div>

              <div className="modal-body space-y-3">
                <div className="flex items-center gap-2 t-caption">
                  <Search className="w-4 h-4 text-slate-400" aria-hidden="true" />
                  <span>
                    {imagePicker.candidates.length} photos trouvées via DuckDuckGo Images — cliquez sur la meilleure
                  </span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {imagePicker.candidates.map((url, i) => (
                    <button
                      key={i}
                      onClick={() => chooseImage(imagePicker.row, url)}
                      aria-label={`Choisir la photo ${i + 1}`}
                      className="group relative card overflow-hidden aspect-square flex items-center justify-center transition-colors duration-150 hover:border-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                    >
                      <img src={url} alt="" referrerPolicy="no-referrer"
                        className="max-w-full max-h-full object-contain p-4"
                        onError={(e) => { e.target.style.opacity = '0.25'; }}
                      />
                      {i === 0 && (
                        <div className="absolute top-2 left-2 badge badge-brand">
                          <Star className="w-3 h-3 fill-current" aria-hidden="true" />
                          RECOMMANDÉ
                        </div>
                      )}
                      <div className="absolute bottom-2 right-2 badge-count">
                        {i + 1}
                      </div>
                      <div className="absolute inset-x-0 bottom-0 bg-brand-600 text-white text-xs font-semibold py-2 px-3 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150 flex items-center justify-center gap-1.5">
                        <Check className="w-4 h-4" aria-hidden="true" /> Choisir cette photo
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div
            role={toast.type === 'error' ? 'alert' : 'status'}
            className={`toast fixed top-4 right-4 z-[60] items-center animate-in ${
              toast.type === 'error' ? 'border-l-red-600' : 'border-l-emerald-600'
            }`}
          >
            {toast.type === 'error' ? (
              <AlertCircle className="w-5 h-5 shrink-0 text-red-700" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-700" aria-hidden="true" />
            )}
            <span className="flex-1 font-medium">{toast.msg}</span>
            <button
              onClick={() => setToast(null)}
              aria-label="Fermer le message"
              className="btn-ghost btn-icon shrink-0"
            >
              <X />
            </button>
          </div>
        )}
      </div>

      {/* Un smartphone désactivé n'est pas ajusté par le serveur (actif IS NOT FALSE) : exclu ici aussi */}
      <AjustementColonne
        open={fenetre === 'ajuster'}
        onClose={() => setFenetre(null)}
        sensible={sensible}
        cible={TABLE}
        titre="Ajuster les prix des smartphones"
        colonnes={COLONNES_PRIX}
        lignes={filteredRows.filter((r) => r.actif !== false).map((r) => ({ id: r.id, label: `${r.marque} ${r.modele}`, valeurs: r }))}
        verrouilles={verrouilles}
        aEnregistrer={{ nombre: dirtyCount, enregistrer: saveAll }}
        onApplique={() => load()}
      />
      <HistoriquePrix
        open={fenetre === 'historique'}
        onClose={() => setFenetre(null)}
        sensible={sensible}
        filtre={{ table: TABLE }}
        titre="Historique des prix des smartphones"
        nommer={(l) => { const r = rows.find((x) => x.id === l.ligne_id); return r ? `${r.marque} ${r.modele}` : null; }}
        onAnnule={() => load()}
      />
      {adminPrompt}
    </div>
  );
}

function StockInput({ value, onChange, label = 'Stock' }) {
  const badge = stockBadge(value);
  return (
    <div className="relative inline-block">
      <input
        type="number"
        value={value ?? 0}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={`w-16 min-h-[40px] text-center font-semibold text-base lg:text-sm tabular-nums rounded-lg px-2 py-1.5 border ${badge.cls} focus:outline-none focus:ring-2 focus:ring-brand-500/40`}
      />
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="p-4 space-y-3" role="status" aria-label="Chargement des smartphones">
      <div className="flex gap-3 pb-3 border-b border-slate-100">
        {['w-20', 'w-24', 'flex-1', 'w-32', 'w-20', 'w-20', 'w-16'].map((w, i) => (
          <div key={i} className={`skeleton-line h-3 ${w}`} />
        ))}
      </div>
      {[...Array(6)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2">
          <div className="skeleton w-14 h-14" />
          <div className="skeleton-line w-20" />
          <div className="skeleton-line flex-1" />
          <div className="skeleton w-32 h-8" />
          <div className="skeleton-line w-16" />
          <div className="skeleton-line w-16" />
          <div className="skeleton w-10 h-7" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onAdd, onQuickAdd }) {
  return (
    <div className="empty-state max-h-none py-12">
      <div className="empty-state-icon">
        <Smartphone aria-hidden="true" />
      </div>
      <h3 className="t-h2">Aucun smartphone pour l'instant</h3>
      <p className="t-body text-slate-500 max-w-md">
        Commencez par ajouter vos modèles Samsung, Xiaomi, Google Pixel ou Honor.
        Les photos se récupèrent automatiquement via DuckDuckGo.
      </p>

      <div>
        <div className="t-caption mb-3 flex items-center justify-center gap-2">
          <TrendingUp className="w-4 h-4 text-slate-400" aria-hidden="true" /> Marques populaires
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {POPULAR_BRANDS.map(b => (
            <button
              key={b}
              onClick={() => onQuickAdd(b)}
              className="btn-secondary btn-sm"
            >
              + {b}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={onAdd}
        className="btn-primary"
      >
        <Plus />
        Ajouter un smartphone
      </button>
    </div>
  );
}

function Cell({ children }) {
  return <td className="!px-2">{children}</td>;
}

function Field({ label, value, onChange, type = 'text', placeholder, compact = false }) {
  return (
    <label className="block">
      <span className="input-label">
        {label}
      </span>
      <input
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`input ${compact ? 'px-2' : ''}`}
      />
    </label>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="input-label">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="select"
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
