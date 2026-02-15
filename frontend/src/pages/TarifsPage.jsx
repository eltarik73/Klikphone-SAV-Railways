import { useState, useEffect, useMemo } from 'react';
import { Tag, Search, RefreshCw, ChevronDown, ChevronRight, Smartphone, Battery, Plug, Camera, Package, Volume2, Headphones, PackageX, Tablet, Laptop, Lock, Unlock } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';

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
  Realme:   { bg: '#d97706', text: '#fff', logo: 'realme' },
  Vivo:     { bg: '#1d4ed8', text: '#fff', logo: 'vivo' },
};
const DEFAULT_BRAND = { bg: '#6d28d9', text: '#fff', logo: null };

function BrandLogo({ slug, size = 18 }) {
  const [error, setError] = useState(false);
  if (!slug || error) return <Smartphone className="w-[18px] h-[18px] opacity-70" />;
  return (
    <img src={`https://cdn.simpleicons.org/${slug}/ffffff`} alt="" width={size} height={size}
      className="shrink-0" style={{ filter: 'brightness(1)', minWidth: size }} onError={() => setError(true)} />
  );
}

const QUALITY_COLORS = {
  'Original':       { color: '#047857', bg: '#ecfdf5', border: '#a7f3d0' },
  'Soft OLED':      { color: '#6d28d9', bg: '#f5f3ff', border: '#c4b5fd' },
  'OLED':           { color: '#1d4ed8', bg: '#eff6ff', border: '#93c5fd' },
  'Incell':         { color: '#b45309', bg: '#fffbeb', border: '#fcd34d' },
  'LCD':            { color: '#52525b', bg: '#f4f4f5', border: '#d4d4d8' },
  'Reconditionnee': { color: '#0e7490', bg: '#ecfeff', border: '#67e8f9' },
  'Compatible':     { color: '#be123c', bg: '#fff1f2', border: '#fda4af' },
};
const DEFAULT_QUALITY = { color: '#52525b', bg: '#f4f4f5', border: '#d4d4d8' };

const BRAND_ORDER = ['Apple', 'Samsung', 'Xiaomi', 'Huawei', 'Honor', 'Google', 'Oppo', 'OnePlus', 'Motorola', 'Nothing', 'Realme', 'Vivo'];
const BRAND_FILTERS = ['Toutes', ...BRAND_ORDER];

const PIECE_ICONS = { ecran: Smartphone, batterie: Battery, connecteur: Plug, camera: Camera, vitre: Package, 'haut-parleur': Volume2, ecouteur: Headphones };
const PIECE_TYPE_COLORS = {
  batterie:               { color: '#047857', bg: '#ecfdf5', border: '#a7f3d0' },
  'connecteur de charge': { color: '#1d4ed8', bg: '#eff6ff', border: '#93c5fd' },
  'camera arriere':       { color: '#b45309', bg: '#fffbeb', border: '#fcd34d' },
  'vitre arriere':        { color: '#7c3aed', bg: '#f5f3ff', border: '#c4b5fd' },
  'haut-parleur':         { color: '#0f766e', bg: '#f0fdfa', border: '#99f6e4' },
  'ecouteur interne':     { color: '#be185d', bg: '#fdf2f8', border: '#f9a8d4' },
  'vitre camera arriere': { color: '#4338ca', bg: '#eef2ff', border: '#a5b4fc' },
};
const DEFAULT_PIECE_TYPE = { color: '#52525b', bg: '#f4f4f5', border: '#d4d4d8' };

function getPieceIcon(type) {
  const t = (type || '').toLowerCase();
  for (const [key, Icon] of Object.entries(PIECE_ICONS)) { if (t.includes(key)) return Icon; }
  return Package;
}
function getPieceTypeColor(type) {
  const t = (type || '').toLowerCase();
  for (const [key, val] of Object.entries(PIECE_TYPE_COLORS)) { if (t.includes(key)) return val; }
  return DEFAULT_PIECE_TYPE;
}
function formatPrice(n) { if (n == null) return null; return `${n}\u00a0\u20ac`; }

// ─── iPhone series helpers ──────────────────────
const SERIES_ORDER = ['17', '16', '15', '14', '13', '12', '11', 'SE', 'X/XS/XR', '8', '7'];

function getIPhoneSerie(modele) {
  const m = modele.match(/iPhone\s*(\d+|SE|X[SR]?)/i);
  if (!m) return 'Autre';
  const num = m[1].toUpperCase();
  if (['X', 'XS', 'XR'].includes(num)) return 'X/XS/XR';
  return num;
}

function iPhoneModelSort(a, b) {
  const order = m => {
    if (/Pro Max/i.test(m)) return 0;
    if (/Pro/i.test(m)) return 1;
    if (/Plus/i.test(m)) return 2;
    if (/Mini/i.test(m)) return 3;
    return 4;
  };
  return order(a) - order(b);
}

// ─── Composant principal ─────────────────────────
export default function TarifsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [tarifs, setTarifs] = useState([]);
  const [stats, setStats] = useState(null);
  const [appleDevices, setAppleDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [brandFilter, setBrandFilter] = useState('Toutes');
  const [expandedBrands, setExpandedBrands] = useState(new Set());
  const [expandedModels, setExpandedModels] = useState(new Set());
  const [expandedSeries, setExpandedSeries] = useState(new Set());
  const [updating, setUpdating] = useState(false);
  const [checkingStock, setCheckingStock] = useState(false);
  const [stockResult, setStockResult] = useState(null);
  const [showHT, setShowHT] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [t, s, ad] = await Promise.all([
        api.getTarifs(), api.getTarifsStats(), api.getAppleDevices().catch(() => []),
      ]);
      setTarifs(t);
      setStats(s);
      setAppleDevices(ad || []);
    } catch (e) {
      console.error('Erreur chargement tarifs:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleStock(id) {
    try {
      const res = await api.toggleTarifStock(id);
      setTarifs(prev => prev.map(t => t.id === id ? { ...t, en_stock: res.en_stock } : t));
    } catch (e) { console.error('Erreur toggle stock:', e); }
  }

  async function handleCheckStock() {
    setCheckingStock(true); setStockResult(null);
    try {
      const res = await api.checkTarifStock();
      setStockResult(res); await loadData();
    } catch (e) {
      console.error('Erreur check stock:', e); setStockResult({ error: true });
    } finally { setCheckingStock(false); }
  }

  const filtered = useMemo(() => {
    let result = tarifs;
    if (brandFilter !== 'Toutes') result = result.filter(t => t.marque === brandFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(t =>
        (t.marque || '').toLowerCase().includes(q) || (t.modele || '').toLowerCase().includes(q) ||
        (t.type_piece || '').toLowerCase().includes(q) || (t.qualite || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [tarifs, brandFilter, search]);

  const grouped = useMemo(() => {
    const byBrand = {};
    for (const t of filtered) {
      if (!byBrand[t.marque]) byBrand[t.marque] = {};
      if (!byBrand[t.marque][t.modele]) byBrand[t.marque][t.modele] = [];
      byBrand[t.marque][t.modele].push(t);
    }
    const brands = Object.keys(byBrand).sort((a, b) => {
      const ia = BRAND_ORDER.indexOf(a), ib = BRAND_ORDER.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1; if (ib >= 0) return 1;
      return a.localeCompare(b);
    });
    return brands.map(brand => ({
      brand,
      models: Object.entries(byBrand[brand]).sort(([a], [b]) => a.localeCompare(b)).map(([model, items]) => ({ model, items })),
    }));
  }, [filtered]);

  // Apple iPhone series grouping
  const appleIPhoneSeries = useMemo(() => {
    const appleGroup = grouped.find(g => g.brand === 'Apple');
    if (!appleGroup) return [];
    const bySerieMap = {};
    for (const { model, items } of appleGroup.models) {
      if (!model.toLowerCase().includes('iphone')) continue;
      const serie = getIPhoneSerie(model);
      if (!bySerieMap[serie]) bySerieMap[serie] = [];
      bySerieMap[serie].push({ model, items });
    }
    // Sort models within each series
    for (const serie of Object.keys(bySerieMap)) {
      bySerieMap[serie].sort((a, b) => iPhoneModelSort(a.model, b.model));
    }
    // Sort series by order
    return Object.entries(bySerieMap).sort(([a], [b]) => {
      const ia = SERIES_ORDER.indexOf(a), ib = SERIES_ORDER.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1; if (ib >= 0) return 1;
      return 0;
    }).map(([serie, models]) => ({ serie, models }));
  }, [grouped]);

  // Apple non-iPhone models
  const appleOtherModels = useMemo(() => {
    const appleGroup = grouped.find(g => g.brand === 'Apple');
    if (!appleGroup) return [];
    return appleGroup.models.filter(({ model }) => !model.toLowerCase().includes('iphone'));
  }, [grouped]);

  // iPad / MacBook from appleDevices
  const iPadDevices = useMemo(() => appleDevices.filter(d => d.categorie === 'ipad'), [appleDevices]);
  const macBookDevices = useMemo(() => appleDevices.filter(d => d.categorie === 'macbook'), [appleDevices]);

  useEffect(() => { if (search.trim()) setExpandedBrands(new Set(grouped.map(g => g.brand))); }, [search, grouped]);
  useEffect(() => { if (brandFilter !== 'Toutes') setExpandedBrands(new Set([brandFilter])); }, [brandFilter]);

  function toggleBrand(brand) {
    setExpandedBrands(prev => {
      const n = new Set(prev);
      if (n.has(brand)) {
        n.delete(brand);
      } else {
        n.add(brand);
        // Auto-expand first iPhone series when opening Apple
        if (brand === 'Apple' && appleIPhoneSeries.length > 0) {
          setExpandedSeries(sp => {
            const ns = new Set(sp);
            ns.add(`apple-serie-${appleIPhoneSeries[0].serie}`);
            return ns;
          });
        }
      }
      return n;
    });
  }
  function toggleModel(key) {
    setExpandedModels(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }
  function toggleSerie(key) {
    setExpandedSeries(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  function StockBadge({ tarif }) {
    const inStock = tarif.en_stock !== false;
    return (
      <button onClick={(e) => { e.stopPropagation(); handleToggleStock(tarif.id); }}
        className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-all cursor-pointer ${
          inStock ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                  : 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'}`}
        title={inStock ? 'En stock' : 'Rupture'}>
        {inStock ? 'En stock' : 'Rupture'}
      </button>
    );
  }

  function getModelSummary(items) {
    const screenItems = items.filter(t => (t.type_piece || '').toLowerCase().includes('ecran'));
    const qualityCount = new Set(screenItems.map(t => t.qualite).filter(Boolean)).size;
    const getPrice = (kw) => {
      const m = items.filter(t => (t.type_piece || '').toLowerCase().includes(kw));
      return m.length ? Math.min(...m.map(t => t.prix_client)) : null;
    };
    const otherItems = items.filter(t => !(t.type_piece || '').toLowerCase().includes('ecran'));
    const otherByType = {};
    for (const t of otherItems) { const k = t.type_piece; if (!otherByType[k]) otherByType[k] = []; otherByType[k].push(t); }
    return { qualityCount, screenItems, batterie: getPrice('batter'), connecteur: getPrice('connect'), camera: getPrice('cam'), otherByType, outOfStock: items.filter(t => t.en_stock === false).length };
  }

  const totalModels = grouped.reduce((sum, g) => sum + g.models.length, 0);
  const COLOR_BATT = PIECE_TYPE_COLORS['batterie'];
  const COLOR_CONN = PIECE_TYPE_COLORS['connecteur de charge'];
  const COLOR_CAM  = PIECE_TYPE_COLORS['camera arriere'];

  function PriceBadge({ value, icon: Icon, color }) {
    if (value == null) return null;
    return <span className="hidden sm:inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg font-semibold border"
      style={{ background: color.bg, color: color.color, borderColor: color.border }}>
      <Icon className="w-3 h-3" />{formatPrice(value)}</span>;
  }
  function PriceBadgeMobile({ value, icon: Icon, color }) {
    if (value == null) return null;
    return <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-md font-bold"
      style={{ background: color.bg, color: color.color }}>
      <Icon className="w-2.5 h-2.5" />{formatPrice(value)}</span>;
  }

  // ─── Render model row (reusable for all brands) ────
  function ModelRow({ brand, model, items, idx }) {
    const modelKey = `${brand}::${model}`;
    const isModelOpen = expandedModels.has(modelKey);
    const summary = getModelSummary(items);
    return (
      <div key={model}>
        <button onClick={() => toggleModel(modelKey)}
          className={`w-full flex items-center px-5 py-3 text-left transition-colors
            ${idx % 2 === 0 ? 'bg-white' : 'bg-zinc-50/50'} ${isModelOpen ? '!bg-violet-50/60' : 'hover:bg-violet-50/30'}`}>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {isModelOpen ? <ChevronDown className="w-3.5 h-3.5 text-violet-500 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />}
            <span className="font-semibold text-[13px] text-zinc-900 truncate">{model}</span>
            {summary.qualityCount > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-md whitespace-nowrap font-medium ${isModelOpen ? 'bg-violet-100 text-violet-700' : 'bg-zinc-100 text-zinc-500'}`}>
                {summary.qualityCount} qualit{summary.qualityCount > 1 ? 'es' : 'e'}
              </span>
            )}
            {summary.outOfStock > 0 && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-red-50 text-red-600 border border-red-200 font-bold whitespace-nowrap">
                {summary.outOfStock} rupture{summary.outOfStock > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="hidden sm:flex items-center gap-1.5 shrink-0">
            <PriceBadge value={summary.batterie} icon={Battery} color={COLOR_BATT} />
            <PriceBadge value={summary.connecteur} icon={Plug} color={COLOR_CONN} />
            <PriceBadge value={summary.camera} icon={Camera} color={COLOR_CAM} />
          </div>
          <div className="flex sm:hidden items-center gap-1 shrink-0 ml-2">
            <PriceBadgeMobile value={summary.batterie} icon={Battery} color={COLOR_BATT} />
            <PriceBadgeMobile value={summary.connecteur} icon={Plug} color={COLOR_CONN} />
            <PriceBadgeMobile value={summary.camera} icon={Camera} color={COLOR_CAM} />
          </div>
        </button>

        {isModelOpen && (
          <div className="px-5 py-4 bg-violet-50/30 border-t border-violet-100/50">
            {Object.keys(summary.otherByType).length > 0 && (
              <div className="sm:hidden flex flex-wrap gap-2 mb-4">
                {Object.entries(summary.otherByType).map(([type, pieces]) => {
                  const pc = getPieceTypeColor(type); const Icon = getPieceIcon(type);
                  return (
                    <div key={type} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs ${pieces[0].en_stock === false ? 'opacity-50' : ''}`}
                      style={{ background: pc.bg, borderColor: pieces[0].en_stock === false ? '#fca5a5' : pc.border }}>
                      <Icon className="w-3 h-3" style={{ color: pc.color }} />
                      <span className="font-medium" style={{ color: pc.color }}>{type}</span>
                      <span className="font-bold" style={{ color: pc.color }}>{formatPrice(pieces[0].prix_client)}</span>
                      {pieces[0].en_stock === false && <span className="text-[8px] text-red-500 font-bold">RUPTURE</span>}
                    </div>
                  );
                })}
              </div>
            )}
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
                      <div key={i} className={`rounded-xl border-2 p-3 transition-all hover:shadow-md hover:scale-[1.02] ${t.en_stock === false ? 'opacity-50' : ''}`}
                        style={{ background: qc.bg, borderColor: t.en_stock === false ? '#fca5a5' : qc.border }}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: qc.color }} />
                            <span className="text-[11px] font-bold" style={{ color: qc.color }}>{t.qualite || 'Standard'}</span>
                          </div>
                          <StockBadge tarif={t} />
                        </div>
                        <div className="text-2xl font-extrabold leading-none" style={{ color: qc.color }}>{formatPrice(t.prix_client)}</div>
                        {showHT && isAdmin && t.prix_fournisseur_ht != null && (
                          <div className="text-[10px] mt-1.5 opacity-50" style={{ color: qc.color }}>
                            Achat : {Number(t.prix_fournisseur_ht).toFixed(2)} {'\u20ac'} HT
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {Object.keys(summary.otherByType).length > 0 && (
              <div className="hidden sm:block mt-4">
                <div className="flex items-center gap-2 mb-3">
                  <Package className="w-4 h-4 text-indigo-400" />
                  <span className="text-[11px] font-semibold text-zinc-600 uppercase tracking-wide">Autres pieces</span>
                </div>
                <div className="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
                  {Object.entries(summary.otherByType).map(([type, pieces]) => {
                    const pc = getPieceTypeColor(type); const Icon = getPieceIcon(type);
                    return pieces.map((t, i) => (
                      <div key={`${type}-${i}`} className={`rounded-xl border-2 p-3 hover:shadow-md transition-all hover:scale-[1.02] ${t.en_stock === false ? 'opacity-50' : ''}`}
                        style={{ background: pc.bg, borderColor: t.en_stock === false ? '#fca5a5' : pc.border }}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5">
                            <Icon className="w-3.5 h-3.5" style={{ color: pc.color }} />
                            <span className="text-[10px] font-bold uppercase" style={{ color: pc.color }}>{type}</span>
                          </div>
                          <StockBadge tarif={t} />
                        </div>
                        <div className="text-lg font-extrabold" style={{ color: pc.color }}>{formatPrice(t.prix_client)}</div>
                        {showHT && isAdmin && t.prix_fournisseur_ht != null && (
                          <div className="text-[10px] mt-1 opacity-60" style={{ color: pc.color }}>
                            Achat : {Number(t.prix_fournisseur_ht).toFixed(2)} {'\u20ac'} HT
                          </div>
                        )}
                      </div>
                    ));
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ─── Device table for iPad/MacBook ────
  function DeviceSection({ devices, label, icon: SIcon, color, formulaText, sectionKey }) {
    if (!devices.length && !isAdmin) return null;
    const isOpen = expandedSeries.has(sectionKey);
    return (
      <div>
        {/* Collapsible section header */}
        <button onClick={() => toggleSerie(sectionKey)}
          className="w-full px-5 py-2.5 border-b flex items-center justify-between cursor-pointer transition-opacity hover:opacity-90"
          style={{ background: color.bg, borderColor: color.border }}>
          <div className="flex items-center gap-2">
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" style={{ color: color.text }} /> : <ChevronRight className="w-3.5 h-3.5" style={{ color: color.text }} />}
            <SIcon className="w-4 h-4" style={{ color: color.text }} />
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: color.text }}>{label}</span>
            <span className="text-[10px] font-medium opacity-60" style={{ color: color.text }}>({devices.length})</span>
          </div>
        </button>

        {isOpen && (
          <>
            {/* Formula banner — admin only */}
            {isAdmin && formulaText && (
              <div className="px-5 py-2 border-b" style={{ background: color.formulaBg, borderColor: color.border }}>
                <span className="text-[13px] font-semibold" style={{ color: color.formulaText }}>
                  {'\uD83E\uDDEE'} {formulaText}
                </span>
              </div>
            )}

            {devices.length === 0 ? (
              <div className="px-5 py-6 text-center text-xs text-zinc-400">Aucun tarif {label} pour le moment</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {/* Table header */}
                <div className="hidden sm:flex items-center px-5 py-2 bg-zinc-50 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                  <div className="flex-1 pl-2">Modele</div>
                  <div className="w-32 text-center">Ecran</div>
                  {showHT && isAdmin && <div className="w-28 text-center">Ecran HT</div>}
                  <div className="w-32 text-center">Batterie</div>
                  {showHT && isAdmin && <div className="w-28 text-center">Batterie HT</div>}
                </div>
                {devices.map((d, i) => (
                  <div key={d.id || i} className={`flex flex-col sm:flex-row items-start sm:items-center px-5 py-3 gap-2 sm:gap-0 ${i % 2 === 0 ? 'bg-white' : 'bg-zinc-50/50'}`}>
                    <div className="flex-1 pl-2 font-semibold text-[13px] text-zinc-900">{d.modele}</div>
                    <div className="w-32 text-center">
                      {d.ecran_prix_vente ? <span className="font-bold text-sm" style={{ color: color.text }}>{formatPrice(d.ecran_prix_vente)}</span> : <span className="text-zinc-300">-</span>}
                    </div>
                    {showHT && isAdmin && (
                      <div className="w-28 text-center text-[11px] text-red-400 font-medium">
                        {d.ecran_prix_ht != null ? `${Number(d.ecran_prix_ht).toFixed(2)} € HT` : '-'}
                      </div>
                    )}
                    <div className="w-32 text-center">
                      {d.batterie_prix_vente ? <span className="font-bold text-sm" style={{ color: color.text }}>{formatPrice(d.batterie_prix_vente)}</span> : <span className="text-zinc-300">-</span>}
                    </div>
                    {showHT && isAdmin && (
                      <div className="w-28 text-center text-[11px] text-red-400 font-medium">
                        {d.batterie_prix_ht != null ? `${Number(d.batterie_prix_ht).toFixed(2)} € HT` : '-'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  const IPAD_COLOR = { bg: 'rgba(59,130,246,0.08)', border: '#3B82F633', text: '#3B82F6', formulaBg: 'rgba(59,130,246,0.05)', formulaText: '#60A5FA' };
  const MACBOOK_COLOR = { bg: 'rgba(139,92,246,0.08)', border: '#8B5CF633', text: '#8B5CF6', formulaBg: 'rgba(139,92,246,0.05)', formulaText: '#A78BFA' };

  // ─── RENDER ────────────────────────────────────
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
                  {stats ? `${stats.modeles} modeles \u00b7 ${stats.marques} marques \u00b7 ${formatPrice(stats.prix_min)} \u2192 ${formatPrice(stats.prix_max)}` : 'Chargement...'}
                </p>
              </div>
            </div>
            <div className="flex gap-2 items-center">
              {/* HT toggle — admin only */}
              {isAdmin && (
                <button onClick={() => setShowHT(!showHT)}
                  className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-2 rounded-lg border transition-all"
                  style={{
                    background: showHT ? 'rgba(239,68,68,0.1)' : 'rgba(100,116,139,0.1)',
                    color: showHT ? '#EF4444' : '#64748B',
                    borderColor: showHT ? '#EF444433' : '#33415533',
                  }}>
                  {showHT ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">{showHT ? 'Prix HT visibles' : 'Prix HT masques'}</span>
                </button>
              )}
              {isAdmin && (
                <button onClick={handleCheckStock} disabled={checkingStock || updating}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors disabled:opacity-50">
                  <PackageX className={`w-4 h-4 ${checkingStock ? 'animate-pulse' : ''}`} />
                  <span className="hidden sm:inline">{checkingStock ? 'Verification...' : 'Verifier stock'}</span>
                </button>
              )}
              <button onClick={async () => { setUpdating(true); await loadData(); setUpdating(false); }}
                disabled={updating || checkingStock}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors disabled:opacity-50">
                <RefreshCw className={`w-4 h-4 ${updating ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">{updating ? 'Chargement...' : 'Actualiser'}</span>
              </button>
            </div>
          </div>

          {stockResult && !stockResult.error && (
            <div className="mt-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm">
              <div className="flex items-center justify-between">
                <div className="text-emerald-800">
                  <span className="font-semibold">{stockResult.models_found}</span> modeles trouves sur Mobilax
                  {' / '}<span className="font-semibold">{stockResult.models_checked}</span> verifies
                  {' \u2014 '}<span className="font-semibold">{stockResult.tarifs_updated}</span> mises a jour
                  {stockResult.now_rupture > 0 && <span className="text-red-600 font-semibold ml-2">({stockResult.now_rupture} ruptures)</span>}
                  {stockResult.now_in_stock > 0 && <span className="text-emerald-600 font-semibold ml-2">({stockResult.now_in_stock} retour en stock)</span>}
                </div>
                <button onClick={() => setStockResult(null)} className="text-emerald-400 hover:text-emerald-600 text-xs">&times;</button>
              </div>
            </div>
          )}
          {stockResult?.error && (
            <div className="mt-3 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
              Erreur lors de la verification du stock.
              <button onClick={() => setStockResult(null)} className="ml-2 text-red-400 hover:text-red-600 text-xs">&times;</button>
            </div>
          )}

          <div className="mt-4 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input type="text" placeholder="Rechercher un modele..." value={search} onChange={e => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-zinc-50 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 transition-all" />
            </div>
            <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
              {BRAND_FILTERS.filter(b => b === 'Toutes' || grouped.some(g => g.brand === b)).map(b => (
                <button key={b} onClick={() => { setBrandFilter(b); if (b === 'Toutes') { setExpandedBrands(new Set()); setExpandedModels(new Set()); setExpandedSeries(new Set()); } }}
                  className={`px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${brandFilter === b ? 'bg-zinc-900 text-white shadow-sm' : 'bg-white border border-slate-200 text-zinc-600 hover:bg-zinc-100'}`}>
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
          </div>
        ) : (
          grouped.map(({ brand, models }) => {
            const bc = BRAND_CONFIG[brand] || DEFAULT_BRAND;
            const isBrandOpen = expandedBrands.has(brand);
            const isApple = brand === 'Apple';

            return (
              <div key={brand} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                {/* NIVEAU 1 : Header marque */}
                <button onClick={() => toggleBrand(brand)}
                  className="w-full px-5 py-3.5 flex items-center justify-between cursor-pointer transition-opacity hover:opacity-90"
                  style={{ background: bc.bg, color: bc.text }}>
                  <div className="flex items-center gap-2.5">
                    {isBrandOpen ? <ChevronDown className="w-4 h-4 opacity-70" /> : <ChevronRight className="w-4 h-4 opacity-70" />}
                    <BrandLogo slug={bc.logo} />
                    <span className="font-bold text-sm tracking-wide">{brand}</span>
                  </div>
                  <span className="text-xs opacity-75 font-medium">
                    {models.length} modele{models.length > 1 ? 's' : ''}
                  </span>
                </button>

                {/* ═══════ APPLE: iPhone series + iPad + MacBook ═══════ */}
                {isBrandOpen && isApple && (
                  <div>
                    {/* ── iPhone section header ── */}
                    <div className="px-5 py-2.5 border-b flex items-center gap-2" style={{ background: 'rgba(245,158,11,0.08)', borderColor: '#F59E0B33' }}>
                      <Smartphone className="w-4 h-4 text-amber-600" />
                      <span className="text-xs font-bold text-amber-700 uppercase tracking-wider">iPhone</span>
                      <span className="text-[10px] font-medium text-amber-500">({appleIPhoneSeries.reduce((s, sr) => s + sr.models.length, 0)} modeles)</span>
                    </div>

                    {/* ── iPhone series sub-accordions ── */}
                    {appleIPhoneSeries.map(({ serie, models: serieModels }) => {
                      const serieKey = `apple-serie-${serie}`;
                      const isSerieOpen = expandedSeries.has(serieKey);
                      return (
                        <div key={serie}>
                          <button onClick={() => toggleSerie(serieKey)}
                            className={`w-full flex items-center px-5 py-2.5 text-left transition-colors border-b border-slate-100 ${isSerieOpen ? 'bg-amber-50/50' : 'hover:bg-amber-50/30 bg-white'}`}>
                            <div className="flex items-center gap-2 flex-1">
                              {isSerieOpen ? <ChevronDown className="w-3.5 h-3.5 text-amber-500 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />}
                              <span className="font-bold text-[13px] text-zinc-800">Serie {serie === 'X/XS/XR' ? serie : `iPhone ${serie}`}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700 font-medium">
                                {serieModels.length} modele{serieModels.length > 1 ? 's' : ''}
                              </span>
                            </div>
                          </button>
                          {isSerieOpen && (
                            <div>
                              <div className="hidden sm:flex items-center px-5 py-2 bg-zinc-100/80 border-b border-slate-200 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                                <div className="flex-1 pl-7">Modele</div>
                                <div className="text-right pr-1">Pieces disponibles</div>
                              </div>
                              {serieModels.map(({ model, items }, idx) => (
                                <ModelRow key={model} brand="Apple" model={model} items={items} idx={idx} />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* ── Non-iPhone Apple models (if any) ── */}
                    {appleOtherModels.length > 0 && appleOtherModels.map(({ model, items }, idx) => (
                      <ModelRow key={model} brand="Apple" model={model} items={items} idx={idx} />
                    ))}

                    {/* ── iPad section (collapsible, closed by default) ── */}
                    <DeviceSection devices={iPadDevices} label="iPad" icon={Tablet} color={IPAD_COLOR}
                      formulaText="Formule : (Prix pièce HT × 1.2) + 110€ de main d'œuvre" sectionKey="apple-ipad" />

                    {/* ── MacBook section (collapsible, closed by default) ── */}
                    <DeviceSection devices={macBookDevices} label="MacBook" icon={Laptop} color={MACBOOK_COLOR}
                      formulaText="Formule : (Prix pièce HT × 1.2) + 120€ de main d'œuvre" sectionKey="apple-macbook" />
                  </div>
                )}

                {/* ═══════ OTHER BRANDS: flat model list ═══════ */}
                {isBrandOpen && !isApple && (
                  <div>
                    <div className="hidden sm:flex items-center px-5 py-2 bg-zinc-100/80 border-b border-slate-200 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                      <div className="flex-1 pl-7">Modele</div>
                      <div className="text-right pr-1">Pieces disponibles</div>
                    </div>
                    {models.map(({ model, items }, idx) => (
                      <ModelRow key={model} brand={brand} model={model} items={items} idx={idx} />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {!loading && totalModels > 0 && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center text-xs text-zinc-400 space-y-1">
            <p>{totalModels} mod{'\u00e8'}le{totalModels > 1 ? 's' : ''} {'\u00b7'} {grouped.length} marque{grouped.length > 1 ? 's' : ''} {'\u00b7'} Source : Mobilax</p>
          </div>
        </div>
      )}
    </div>
  );
}
