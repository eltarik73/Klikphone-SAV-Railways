import { useState, useEffect, useMemo } from 'react';
import { Tag, Search, RefreshCw, ChevronDown, ChevronRight, Smartphone, Battery, Plug, Camera, Package } from 'lucide-react';
import api from '../lib/api';

// ─── Constantes ──────────────────────────────────
const BRAND_COLORS = {
  Apple:    { bg: '#18181b', text: '#fff' },
  Samsung:  { bg: '#2563eb', text: '#fff' },
  Xiaomi:   { bg: '#ea580c', text: '#fff' },
  Huawei:   { bg: '#dc2626', text: '#fff' },
  Motorola: { bg: '#0891b2', text: '#fff' },
};
const DEFAULT_BRAND = { bg: '#6d28d9', text: '#fff' };

const QUALITY_COLORS = {
  'Original':       { color: '#047857', bg: '#ecfdf5' },
  'Soft OLED':      { color: '#6d28d9', bg: '#f5f3ff' },
  'OLED':           { color: '#1d4ed8', bg: '#eff6ff' },
  'Incell':         { color: '#b45309', bg: '#fffbeb' },
  'LCD':            { color: '#52525b', bg: '#f4f4f5' },
  'Reconditionnée': { color: '#0e7490', bg: '#ecfeff' },
  'Compatible':     { color: '#be123c', bg: '#fff1f2' },
};
const DEFAULT_QUALITY = { color: '#52525b', bg: '#f4f4f5' };

const PIECE_ICONS = {
  ecran: Smartphone,
  batterie: Battery,
  connecteur: Plug,
  camera: Camera,
};

const BRAND_FILTERS = ['Toutes', 'Apple', 'Samsung', 'Xiaomi', 'Huawei', 'Motorola'];

// ─── Helpers ─────────────────────────────────────
function getPieceIcon(type) {
  const t = (type || '').toLowerCase();
  for (const [key, Icon] of Object.entries(PIECE_ICONS)) {
    if (t.includes(key)) return Icon;
  }
  return Package;
}

function formatPrice(n) {
  if (n == null) return '—';
  return `${n}\u00a0€`;
}

function priceRange(prices) {
  if (!prices.length) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) return formatPrice(min);
  return `${min}→${max}\u00a0€`;
}

// ─── Composant principal ─────────────────────────
export default function TarifsPage() {
  const [tarifs, setTarifs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [brandFilter, setBrandFilter] = useState('Toutes');
  const [expandedModels, setExpandedModels] = useState(new Set());
  const [updating, setUpdating] = useState(false);

  // Fetch data
  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [t, s] = await Promise.all([api.getTarifs(), api.getTarifsStats()]);
      setTarifs(t);
      setStats(s);
    } catch (e) {
      console.error('Erreur chargement tarifs:', e);
    } finally {
      setLoading(false);
    }
  }

  // Filter tarifs
  const filtered = useMemo(() => {
    let result = tarifs;
    if (brandFilter !== 'Toutes') {
      result = result.filter(t => t.marque === brandFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(t =>
        (t.marque || '').toLowerCase().includes(q) ||
        (t.modele || '').toLowerCase().includes(q) ||
        (t.type_piece || '').toLowerCase().includes(q) ||
        (t.qualite || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [tarifs, brandFilter, search]);

  // Group by brand → model
  const grouped = useMemo(() => {
    const byBrand = {};
    for (const t of filtered) {
      if (!byBrand[t.marque]) byBrand[t.marque] = {};
      if (!byBrand[t.marque][t.modele]) byBrand[t.marque][t.modele] = [];
      byBrand[t.marque][t.modele].push(t);
    }
    // Sort brands
    const brands = Object.keys(byBrand).sort((a, b) => {
      const order = BRAND_FILTERS.slice(1);
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.localeCompare(b);
    });
    return brands.map(brand => ({
      brand,
      models: Object.entries(byBrand[brand])
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([model, items]) => ({ model, items })),
    }));
  }, [filtered]);

  function toggleModel(key) {
    setExpandedModels(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Model row helpers
  function getModelSummary(items) {
    const byType = {};
    for (const t of items) {
      const key = (t.type_piece || '').toLowerCase();
      if (!byType[key]) byType[key] = [];
      byType[key].push(t.prix_client);
    }
    const screens = Object.entries(byType).filter(([k]) => k.includes('ecran') || k.includes('écran'));
    const screenPrices = screens.flatMap(([, p]) => p);
    const batteries = Object.entries(byType).filter(([k]) => k.includes('batter'));
    const connectors = Object.entries(byType).filter(([k]) => k.includes('connect'));
    const cameras = Object.entries(byType).filter(([k]) => k.includes('cam'));
    const screenQualities = items.filter(t => {
      const tp = (t.type_piece || '').toLowerCase();
      return tp.includes('ecran') || tp.includes('écran');
    });
    return {
      ecran: priceRange(screenPrices),
      batterie: priceRange(batteries.flatMap(([, p]) => p)),
      connecteur: priceRange(connectors.flatMap(([, p]) => p)),
      camera: priceRange(cameras.flatMap(([, p]) => p)),
      qualityCount: new Set(screenQualities.map(t => t.qualite).filter(Boolean)).size,
    };
  }

  const totalResults = filtered.length;

  return (
    <div className="min-h-screen bg-zinc-50 pb-20">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
                <Tag className="w-5 h-5 text-violet-600" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-zinc-900">Tarifs réparation</h1>
                <p className="text-xs text-zinc-500">
                  {stats ? `${stats.modeles} modèles · ${stats.marques} marques · ${formatPrice(stats.prix_min)} → ${formatPrice(stats.prix_max)}` : 'Chargement...'}
                </p>
              </div>
            </div>
            <button
              onClick={async () => {
                setUpdating(true);
                try {
                  await api.request('/api/tarifs/update', { method: 'POST' }, 120000);
                  await loadData();
                } catch { /* ignore */ } finally { setUpdating(false); }
              }}
              disabled={updating}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${updating ? 'animate-spin' : ''}`} />
              {updating ? 'Mise à jour...' : 'Mettre à jour'}
            </button>
          </div>

          {/* Search + brand filters */}
          <div className="mt-4 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input
                type="text"
                placeholder="Rechercher un modèle, une marque..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-zinc-50 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 transition-all"
              />
            </div>
            <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
              {BRAND_FILTERS.map(b => (
                <button
                  key={b}
                  onClick={() => setBrandFilter(b)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                    brandFilter === b
                      ? 'bg-zinc-900 text-white shadow-sm'
                      : 'bg-white border border-slate-200 text-zinc-600 hover:bg-zinc-100'
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-10 h-10 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
            <p className="mt-4 text-sm text-zinc-500">Chargement des tarifs...</p>
          </div>
        ) : grouped.length === 0 ? (
          <div className="text-center py-20">
            <Tag className="w-12 h-12 text-zinc-300 mx-auto mb-4" />
            <p className="text-zinc-500 text-sm">Aucun tarif trouvé</p>
            <p className="text-zinc-400 text-xs mt-1">Importez des tarifs ou modifiez vos filtres</p>
          </div>
        ) : (
          grouped.map(({ brand, models }) => {
            const bc = BRAND_COLORS[brand] || DEFAULT_BRAND;
            return (
              <div key={brand} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                {/* Brand header */}
                <div
                  className="px-5 py-3 flex items-center justify-between"
                  style={{ background: bc.bg, color: bc.text }}
                >
                  <span className="font-bold text-sm tracking-wide">{brand}</span>
                  <span className="text-xs opacity-75">{models.length} modèle{models.length > 1 ? 's' : ''}</span>
                </div>

                {/* Model rows */}
                <div>
                  {models.map(({ model, items }, idx) => {
                    const key = `${brand}::${model}`;
                    const isOpen = expandedModels.has(key);
                    const summary = getModelSummary(items);
                    const screenItems = items.filter(t => {
                      const tp = (t.type_piece || '').toLowerCase();
                      return tp.includes('ecran') || tp.includes('écran');
                    });

                    return (
                      <div key={model}>
                        {/* Model row */}
                        <button
                          onClick={() => toggleModel(key)}
                          className={`w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-violet-50/50 transition-colors ${
                            idx % 2 === 1 ? 'bg-zinc-50/50' : 'bg-white'
                          } ${isOpen ? 'bg-violet-50/30' : ''}`}
                        >
                          {isOpen
                            ? <ChevronDown className="w-4 h-4 text-violet-600 shrink-0" />
                            : <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                          }

                          {/* Model name + badge */}
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="font-semibold text-sm text-zinc-900 truncate">{model}</span>
                            {summary.qualityCount > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 whitespace-nowrap">
                                {summary.qualityCount} qualité{summary.qualityCount > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>

                          {/* Price columns */}
                          <div className="hidden sm:flex items-center gap-4 shrink-0 text-xs">
                            {summary.ecran && (
                              <span className="font-bold text-violet-700 min-w-[80px] text-right">{summary.ecran}</span>
                            )}
                            {summary.batterie && (
                              <span className="text-zinc-600 min-w-[60px] text-right">{summary.batterie}</span>
                            )}
                            {summary.connecteur && (
                              <span className="text-zinc-600 min-w-[60px] text-right">{summary.connecteur}</span>
                            )}
                            {summary.camera && (
                              <span className="text-zinc-600 min-w-[60px] text-right">{summary.camera}</span>
                            )}
                          </div>
                        </button>

                        {/* Accordion: quality cards */}
                        {isOpen && (
                          <div className="px-5 py-4 bg-zinc-50/70 border-t border-slate-100">
                            {/* Screen qualities */}
                            {screenItems.length > 0 && (
                              <div className="mb-4">
                                <div className="flex items-center gap-2 mb-3">
                                  <Smartphone className="w-4 h-4 text-violet-600" />
                                  <span className="text-xs font-semibold text-zinc-700 uppercase tracking-wide">Écrans</span>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                                  {screenItems.map((t, i) => {
                                    const qc = QUALITY_COLORS[t.qualite] || DEFAULT_QUALITY;
                                    return (
                                      <div
                                        key={i}
                                        className="rounded-xl border p-3 transition-all hover:shadow-md"
                                        style={{ background: qc.bg, borderColor: qc.color + '30' }}
                                      >
                                        <span
                                          className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-md mb-2"
                                          style={{ background: qc.color + '18', color: qc.color }}
                                        >
                                          {t.qualite || 'Standard'}
                                        </span>
                                        <div className="text-xl font-bold" style={{ color: qc.color }}>
                                          {formatPrice(t.prix_client)}
                                        </div>
                                        {t.prix_fournisseur_ht != null && (
                                          <div className="text-[10px] mt-1 opacity-60" style={{ color: qc.color }}>
                                            Fournisseur : {Number(t.prix_fournisseur_ht).toFixed(2)}€ HT
                                          </div>
                                        )}
                                        {t.nom_fournisseur && (
                                          <div className="text-[9px] mt-0.5 truncate opacity-50" style={{ color: qc.color }}>
                                            {t.nom_fournisseur}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Other pieces */}
                            {(() => {
                              const others = items.filter(t => {
                                const tp = (t.type_piece || '').toLowerCase();
                                return !tp.includes('ecran') && !tp.includes('écran');
                              });
                              if (others.length === 0) return null;
                              return (
                                <div>
                                  <div className="flex items-center gap-2 mb-3">
                                    <Package className="w-4 h-4 text-zinc-500" />
                                    <span className="text-xs font-semibold text-zinc-700 uppercase tracking-wide">Autres pièces</span>
                                  </div>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                                    {others.map((t, i) => {
                                      const Icon = getPieceIcon(t.type_piece);
                                      return (
                                        <div key={i} className="rounded-xl border border-slate-200 bg-white p-3 hover:shadow-md transition-all">
                                          <div className="flex items-center gap-1.5 mb-2">
                                            <Icon className="w-3.5 h-3.5 text-zinc-500" />
                                            <span className="text-[10px] font-semibold text-zinc-600 uppercase">{t.type_piece}</span>
                                          </div>
                                          <div className="text-lg font-bold text-zinc-900">{formatPrice(t.prix_client)}</div>
                                          {t.prix_fournisseur_ht != null && (
                                            <div className="text-[10px] text-zinc-400 mt-1">
                                              Fournisseur : {Number(t.prix_fournisseur_ht).toFixed(2)}€ HT
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      {!loading && totalResults > 0 && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center text-xs text-zinc-400 space-y-1">
            <p>{totalResults} tarif{totalResults > 1 ? 's' : ''} affichés · Source : Mobilax</p>
            <p>Formule : Prix fournisseur HT × 1.2 + marge, arrondi au 9 supérieur</p>
          </div>
        </div>
      )}
    </div>
  );
}
