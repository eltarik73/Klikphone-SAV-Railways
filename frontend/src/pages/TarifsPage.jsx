import { useState, useEffect, useMemo } from 'react';
import { Tag, Search, RefreshCw, ChevronDown, ChevronRight, Smartphone, Battery, Plug, Camera, Package } from 'lucide-react';
import api from '../lib/api';

// ─── Constantes ──────────────────────────────────
const BRAND_CONFIG = {
  Apple:    { bg: '#18181b', text: '#fff', logo: 'apple' },
  Samsung:  { bg: '#2563eb', text: '#fff', logo: 'samsung' },
  Xiaomi:   { bg: '#ea580c', text: '#fff', logo: 'xiaomi' },
  Huawei:   { bg: '#dc2626', text: '#fff', logo: 'huawei' },
  Honor:    { bg: '#6d28d9', text: '#fff', logo: 'honor' },
  Google:   { bg: '#16a34a', text: '#fff', logo: 'google' },
  Oppo:     { bg: '#059669', text: '#fff', logo: 'oppo' },
  OnePlus:  { bg: '#dc2626', text: '#fff', logo: 'oneplus' },
  Motorola: { bg: '#0891b2', text: '#fff', logo: 'motorola' },
  Nothing:  { bg: '#18181b', text: '#fff', logo: 'nothing' },
};
const DEFAULT_BRAND = { bg: '#6d28d9', text: '#fff', logo: null };

function BrandLogo({ slug, size = 18 }) {
  const [error, setError] = useState(false);
  if (!slug || error) {
    return <Smartphone className="w-[18px] h-[18px] opacity-70" />;
  }
  return (
    <img
      src={`https://cdn.simpleicons.org/${slug}/ffffff`}
      alt=""
      width={size}
      height={size}
      className="shrink-0"
      style={{ filter: 'brightness(1)', minWidth: size }}
      onError={() => setError(true)}
    />
  );
}

const QUALITY_COLORS = {
  'Original':       { color: '#047857', bg: '#ecfdf5', border: '#a7f3d0' },
  'Soft OLED':      { color: '#6d28d9', bg: '#f5f3ff', border: '#c4b5fd' },
  'OLED':           { color: '#1d4ed8', bg: '#eff6ff', border: '#93c5fd' },
  'Incell':         { color: '#b45309', bg: '#fffbeb', border: '#fcd34d' },
  'LCD':            { color: '#52525b', bg: '#f4f4f5', border: '#d4d4d8' },
  'Reconditionnée': { color: '#0e7490', bg: '#ecfeff', border: '#67e8f9' },
  'Compatible':     { color: '#be123c', bg: '#fff1f2', border: '#fda4af' },
};
const DEFAULT_QUALITY = { color: '#52525b', bg: '#f4f4f5', border: '#d4d4d8' };

const BRAND_ORDER = ['Apple', 'Samsung', 'Xiaomi', 'Huawei', 'Honor', 'Google', 'Oppo', 'OnePlus', 'Motorola', 'Nothing'];
const BRAND_FILTERS = ['Toutes', ...BRAND_ORDER];

const PIECE_ICONS = {
  ecran: Smartphone,
  batterie: Battery,
  connecteur: Plug,
  camera: Camera,
};

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

// ─── Composant principal ─────────────────────────
export default function TarifsPage() {
  const [tarifs, setTarifs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [brandFilter, setBrandFilter] = useState('Toutes');
  const [expandedBrands, setExpandedBrands] = useState(new Set());
  const [expandedModels, setExpandedModels] = useState(new Set());
  const [updating, setUpdating] = useState(false);

  useEffect(() => { loadData(); }, []);

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

  // Filter
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

  // Group: brand → model → items
  const grouped = useMemo(() => {
    const byBrand = {};
    for (const t of filtered) {
      if (!byBrand[t.marque]) byBrand[t.marque] = {};
      if (!byBrand[t.marque][t.modele]) byBrand[t.marque][t.modele] = [];
      byBrand[t.marque][t.modele].push(t);
    }
    const brands = Object.keys(byBrand).sort((a, b) => {
      const ia = BRAND_ORDER.indexOf(a);
      const ib = BRAND_ORDER.indexOf(b);
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

  // When search is active, auto-expand matching brands
  useEffect(() => {
    if (search.trim()) {
      setExpandedBrands(new Set(grouped.map(g => g.brand)));
    }
  }, [search, grouped]);

  // When brand filter is set, auto-expand that brand
  useEffect(() => {
    if (brandFilter !== 'Toutes') {
      setExpandedBrands(new Set([brandFilter]));
    }
  }, [brandFilter]);

  function toggleBrand(brand) {
    setExpandedBrands(prev => {
      const next = new Set(prev);
      if (next.has(brand)) next.delete(brand);
      else next.add(brand);
      return next;
    });
  }

  function toggleModel(key) {
    setExpandedModels(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Get summary for a model row (batteries, connecteurs, cameras — no screens)
  function getModelSummary(items) {
    const screenItems = items.filter(t => {
      const tp = (t.type_piece || '').toLowerCase();
      return tp.includes('ecran') || tp.includes('écran');
    });
    const qualityCount = new Set(screenItems.map(t => t.qualite).filter(Boolean)).size;

    const getPrice = (keyword) => {
      const matching = items.filter(t => (t.type_piece || '').toLowerCase().includes(keyword));
      if (!matching.length) return null;
      const prices = matching.map(t => t.prix_client);
      const min = Math.min(...prices);
      return formatPrice(min);
    };

    // Also collect all non-screen piece types
    const otherItems = items.filter(t => {
      const tp = (t.type_piece || '').toLowerCase();
      return !tp.includes('ecran') && !tp.includes('écran');
    });
    // Group by type
    const otherByType = {};
    for (const t of otherItems) {
      const key = t.type_piece;
      if (!otherByType[key]) otherByType[key] = [];
      otherByType[key].push(t);
    }

    return {
      qualityCount,
      screenItems,
      batterie: getPrice('batter'),
      connecteur: getPrice('connect'),
      camera: getPrice('cam'),
      otherByType,
    };
  }

  const totalModels = grouped.reduce((sum, g) => sum + g.models.length, 0);

  return (
    <div className="min-h-screen bg-zinc-50 pb-20">
      {/* Header sticky */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
                <Tag className="w-5 h-5 text-violet-600" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-zinc-900">Grille Tarifaire</h1>
                <p className="text-xs text-zinc-500">
                  {stats
                    ? `${stats.modeles} modeles \u00b7 ${stats.marques} marques \u00b7 ${formatPrice(stats.prix_min)} \u2192 ${formatPrice(stats.prix_max)}`
                    : 'Chargement...'}
                </p>
              </div>
            </div>
            <button
              onClick={async () => {
                setUpdating(true);
                await loadData();
                setUpdating(false);
              }}
              disabled={updating}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${updating ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{updating ? 'Chargement...' : 'Actualiser'}</span>
            </button>
          </div>

          {/* Search + brand filters */}
          <div className="mt-4 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input
                type="text"
                placeholder="Rechercher un modele..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-zinc-50 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 transition-all"
              />
            </div>
            <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
              {BRAND_FILTERS.filter(b => b === 'Toutes' || grouped.some(g => g.brand === b)).map(b => (
                <button
                  key={b}
                  onClick={() => {
                    setBrandFilter(b);
                    if (b === 'Toutes') {
                      setExpandedBrands(new Set());
                      setExpandedModels(new Set());
                    }
                  }}
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-10 h-10 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
            <p className="mt-4 text-sm text-zinc-500">Chargement des tarifs...</p>
          </div>
        ) : grouped.length === 0 ? (
          <div className="text-center py-20">
            <Tag className="w-12 h-12 text-zinc-300 mx-auto mb-4" />
            <p className="text-zinc-500 text-sm">Aucun tarif trouve</p>
            <p className="text-zinc-400 text-xs mt-1">Importez des tarifs ou modifiez vos filtres</p>
          </div>
        ) : (
          grouped.map(({ brand, models }) => {
            const bc = BRAND_CONFIG[brand] || DEFAULT_BRAND;
            const isBrandOpen = expandedBrands.has(brand);

            return (
              <div key={brand} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                {/* ═══ NIVEAU 1 : Header marque (clic = ouvrir/fermer) ═══ */}
                <button
                  onClick={() => toggleBrand(brand)}
                  className="w-full px-5 py-3.5 flex items-center justify-between cursor-pointer transition-opacity hover:opacity-90"
                  style={{ background: bc.bg, color: bc.text }}
                >
                  <div className="flex items-center gap-2.5">
                    {isBrandOpen
                      ? <ChevronDown className="w-4 h-4 opacity-70" />
                      : <ChevronRight className="w-4 h-4 opacity-70" />}
                    <BrandLogo slug={bc.logo} />
                    <span className="font-bold text-sm tracking-wide">{brand}</span>
                  </div>
                  <span className="text-xs opacity-75 font-medium">
                    {models.length} modele{models.length > 1 ? 's' : ''}
                  </span>
                </button>

                {/* Liste modeles (visible si marque ouverte) */}
                {isBrandOpen && (
                  <div>
                    {/* Table header (desktop) */}
                    <div className="hidden sm:flex items-center px-5 py-2 bg-zinc-100/80 border-b border-slate-200 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                      <div className="flex-1 pl-7">Modele</div>
                      <div className="w-20 text-right">Batterie</div>
                      <div className="w-20 text-right">Connect.</div>
                      <div className="w-20 text-right">Camera</div>
                    </div>

                    {models.map(({ model, items }, idx) => {
                      const modelKey = `${brand}::${model}`;
                      const isModelOpen = expandedModels.has(modelKey);
                      const summary = getModelSummary(items);

                      return (
                        <div key={model}>
                          {/* ═══ NIVEAU 2 : Ligne modele (clic = ouvrir/fermer ecrans) ═══ */}
                          <button
                            onClick={() => toggleModel(modelKey)}
                            className={`w-full flex items-center px-5 py-3 text-left transition-colors
                              ${idx % 2 === 0 ? 'bg-white' : 'bg-zinc-50/50'}
                              ${isModelOpen ? '!bg-violet-50/60' : 'hover:bg-violet-50/30'}`}
                          >
                            {/* Chevron + model name + quality badge */}
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              {isModelOpen
                                ? <ChevronDown className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                                : <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />}
                              <span className="font-semibold text-[13px] text-zinc-900 truncate">{model}</span>
                              {summary.qualityCount > 0 && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-md whitespace-nowrap font-medium ${
                                  isModelOpen
                                    ? 'bg-violet-100 text-violet-700'
                                    : 'bg-zinc-100 text-zinc-500'
                                }`}>
                                  {summary.qualityCount} qualite{summary.qualityCount > 1 ? 's' : ''} {isModelOpen ? '\u25BC' : '\u25B6'}
                                </span>
                              )}
                            </div>

                            {/* Price columns (desktop) */}
                            <div className="hidden sm:flex items-center shrink-0">
                              <span className="w-20 text-right text-xs text-zinc-700 font-medium">
                                {summary.batterie || '—'}
                              </span>
                              <span className="w-20 text-right text-xs text-zinc-700 font-medium">
                                {summary.connecteur || '—'}
                              </span>
                              <span className="w-20 text-right text-xs text-zinc-700 font-medium">
                                {summary.camera || '—'}
                              </span>
                            </div>

                            {/* Mobile: price pills */}
                            <div className="flex sm:hidden items-center gap-1.5 shrink-0 ml-2">
                              {summary.batterie && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium">
                                  {summary.batterie}
                                </span>
                              )}
                            </div>
                          </button>

                          {/* ═══ Contenu deplie : cartes qualite ecran + autres pieces ═══ */}
                          {isModelOpen && (
                            <div className="px-5 py-4 bg-violet-50/30 border-t border-violet-100/50">
                              {/* Mobile: prix batterie/connecteur/camera */}
                              <div className="sm:hidden flex flex-wrap gap-2 mb-4">
                                {Object.entries(summary.otherByType).map(([type, pieces]) => (
                                  <div key={type} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-xs">
                                    {(() => { const I = getPieceIcon(type); return <I className="w-3 h-3 text-zinc-500" />; })()}
                                    <span className="text-zinc-500">{type}</span>
                                    <span className="font-bold text-zinc-900">{formatPrice(pieces[0].prix_client)}</span>
                                  </div>
                                ))}
                              </div>

                              {/* Cartes qualite ecran */}
                              {summary.screenItems.length > 0 && (
                                <div>
                                  <div className="flex items-center gap-2 mb-3">
                                    <Smartphone className="w-4 h-4 text-violet-500" />
                                    <span className="text-[11px] font-semibold text-zinc-600 uppercase tracking-wide">Ecrans disponibles</span>
                                  </div>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
                                    {summary.screenItems.map((t, i) => {
                                      const qc = QUALITY_COLORS[t.qualite] || DEFAULT_QUALITY;
                                      return (
                                        <div
                                          key={i}
                                          className="rounded-xl border-2 p-3 transition-all hover:shadow-md hover:scale-[1.02]"
                                          style={{ background: qc.bg, borderColor: qc.border }}
                                        >
                                          {/* Dot + quality name */}
                                          <div className="flex items-center gap-1.5 mb-2">
                                            <span
                                              className="w-2 h-2 rounded-full shrink-0"
                                              style={{ background: qc.color }}
                                            />
                                            <span
                                              className="text-[11px] font-bold"
                                              style={{ color: qc.color }}
                                            >
                                              {t.qualite || 'Standard'}
                                            </span>
                                          </div>
                                          {/* Price */}
                                          <div
                                            className="text-2xl font-extrabold leading-none"
                                            style={{ color: qc.color }}
                                          >
                                            {formatPrice(t.prix_client)}
                                          </div>
                                          {/* Supplier price */}
                                          {t.prix_fournisseur_ht != null && (
                                            <div className="text-[10px] mt-1.5 opacity-50" style={{ color: qc.color }}>
                                              Achat : {Number(t.prix_fournisseur_ht).toFixed(2)}\u00a0€ HT
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {/* Autres pieces (desktop detail) */}
                              {Object.keys(summary.otherByType).length > 0 && (
                                <div className="hidden sm:block mt-4">
                                  <div className="flex items-center gap-2 mb-3">
                                    <Package className="w-4 h-4 text-zinc-400" />
                                    <span className="text-[11px] font-semibold text-zinc-600 uppercase tracking-wide">Autres pieces</span>
                                  </div>
                                  <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
                                    {Object.entries(summary.otherByType).map(([type, pieces]) =>
                                      pieces.map((t, i) => {
                                        const Icon = getPieceIcon(type);
                                        return (
                                          <div key={`${type}-${i}`} className="rounded-xl border border-slate-200 bg-white p-3 hover:shadow-md transition-all">
                                            <div className="flex items-center gap-1.5 mb-2">
                                              <Icon className="w-3.5 h-3.5 text-zinc-400" />
                                              <span className="text-[10px] font-semibold text-zinc-500 uppercase">{type}</span>
                                            </div>
                                            <div className="text-lg font-bold text-zinc-900">{formatPrice(t.prix_client)}</div>
                                            {t.prix_fournisseur_ht != null && (
                                              <div className="text-[10px] text-zinc-400 mt-1">
                                                Achat : {Number(t.prix_fournisseur_ht).toFixed(2)}\u00a0€ HT
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      {!loading && totalModels > 0 && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center text-xs text-zinc-400 space-y-1">
            <p>{totalModels} modele{totalModels > 1 ? 's' : ''} \u00b7 {grouped.length} marque{grouped.length > 1 ? 's' : ''} \u00b7 Source : Mobilax</p>
          </div>
        </div>
      )}
    </div>
  );
}
