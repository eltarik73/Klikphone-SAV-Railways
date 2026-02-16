import { useState, useEffect, useRef, useMemo, memo } from 'react';
import {
  Smartphone, Search, RefreshCw, Filter, ChevronDown, Shield,
  Package, Loader2, SlidersHorizontal, Sparkles, Tag,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useApi, invalidateCache } from '../hooks/useApi';

// ─── Constantes ──────────────────────────────────

const BRAND_COLORS = {
  'Apple': '#333333',
  'Samsung': '#1428A0',
  'Xiaomi': '#FF6900',
  'Google': '#4285F4',
  'Huawei': '#CF0A2C',
  'Honor': '#00AAEE',
  'Oppo': '#1A8A36',
  'OnePlus': '#EB0028',
  'Motorola': '#5C2D91',
  'Nothing': '#FFFFFF',
  'Realme': '#F5C518',
};

const GRADE_COLORS = {
  'Grade A': { bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  'Grade A+': { bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  'Grade B': { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  'Grade B+': { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  'Grade C': { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30' },
  'Neuf': { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
};

const SORT_OPTIONS = [
  { value: 'prix_asc', label: 'Prix croissant' },
  { value: 'prix_desc', label: 'Prix decroissant' },
  { value: 'marque', label: 'Marque A-Z' },
  { value: 'nouveautes', label: 'Nouveautes' },
];

// ─── Helpers ─────────────────────────────────────

function formatDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month} a ${hours}:${minutes}`;
}

function formatPrice(price) {
  if (price == null) return '';
  return Number(price).toFixed(2).replace('.', ',') + ' €';
}

function getGradeStyle(grade) {
  if (!grade) return null;
  return GRADE_COLORS[grade] || GRADE_COLORS['Neuf'];
}

// ─── Skeleton Components ─────────────────────────

function KPICardSkeleton() {
  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 animate-pulse">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-slate-700/50" />
        <div className="flex-1 space-y-2">
          <div className="h-7 w-16 bg-slate-700/50 rounded" />
          <div className="h-4 w-24 bg-slate-700/50 rounded" />
        </div>
      </div>
    </div>
  );
}

function PhoneCardSkeleton() {
  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden animate-pulse">
      <div className="h-48 bg-slate-900/80" />
      <div className="p-4 space-y-3">
        <div className="h-3 w-16 bg-slate-700/50 rounded" />
        <div className="h-5 w-3/4 bg-slate-700/50 rounded" />
        <div className="h-3 w-1/2 bg-slate-700/50 rounded" />
        <div className="h-7 w-24 bg-slate-700/50 rounded mt-2" />
        <div className="h-3 w-32 bg-slate-700/50 rounded" />
      </div>
    </div>
  );
}

// ─── KPI Card ────────────────────────────────────

function KPICard({ icon: Icon, value, label, color }) {
  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 transition-all hover:border-slate-600/50">
      <div className="flex items-center gap-4">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: color + '20' }}
        >
          <Icon className="w-6 h-6" style={{ color }} />
        </div>
        <div>
          <p className="text-2xl font-bold text-white">{value ?? '-'}</p>
          <p className="text-sm text-slate-400">{label}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Phone Card ──────────────────────────────────

const PhoneCard = memo(function PhoneCard({ phone }) {
  const grade = phone.grade || (phone.type_produit === 'Neuf' ? 'Neuf' : null);
  const gradeStyle = getGradeStyle(grade);
  const inStock = phone.en_stock !== false && phone.en_stock !== 0;

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden transition-shadow duration-200 hover:border-amber-500/30 hover:shadow-lg hover:shadow-amber-500/5 group">
      {/* Image area */}
      <div className="relative h-48 bg-slate-900 flex items-center justify-center overflow-hidden">
        {phone.image_url ? (
          <img
            src={phone.image_url}
            alt={phone.modele || 'Telephone'}
            className="h-full w-full object-contain p-4 group-hover:scale-105 transition-transform duration-200"
            loading="lazy"
            onError={(e) => {
              e.target.style.display = 'none';
              e.target.nextElementSibling?.classList.remove('hidden');
            }}
          />
        ) : null}
        <div className={`flex flex-col items-center justify-center text-slate-600 ${phone.image_url ? 'hidden' : ''}`}>
          <Smartphone className="w-16 h-16 mb-2" />
          <span className="text-xs text-slate-600">Pas d'image</span>
        </div>

        {/* Badge top-left: Grade or Neuf */}
        {gradeStyle && (
          <span className={`absolute top-3 left-3 text-[10px] font-bold px-2.5 py-1 rounded-lg ${gradeStyle.bg} ${gradeStyle.text} ${gradeStyle.border} border backdrop-blur-sm`}>
            {grade === 'Neuf' ? 'NEUF' : grade.toUpperCase()}
          </span>
        )}

        {/* Badge top-right: Stock */}
        <div className="absolute top-3 right-3">
          {inStock ? (
            <span className="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 backdrop-blur-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              En stock
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 backdrop-blur-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              Rupture
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Brand */}
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
          {phone.marque || 'Marque inconnue'}
        </p>

        {/* Model name */}
        <h3 className="text-sm font-bold text-white leading-tight mb-1.5 line-clamp-2">
          {phone.modele || 'Modele inconnu'}
        </h3>

        {/* Storage + Color */}
        <p className="text-xs text-slate-400 mb-3">
          {[phone.stockage, phone.couleur].filter(Boolean).join(' · ') || ''}
        </p>

        {/* Price */}
        <p className="text-xl font-extrabold text-amber-500 mb-2">
          {phone.prix_vente != null ? formatPrice(phone.prix_vente) : 'Prix sur demande'}
        </p>

        {/* Supplier price crossed out */}
        {phone.prix_fournisseur != null && (
          <p className="text-xs text-slate-600 line-through mb-2">
            Fournisseur : {formatPrice(phone.prix_fournisseur)}
          </p>
        )}

        {/* Guarantee */}
        <div className="flex items-center gap-1.5 text-slate-500">
          <Shield className="w-3.5 h-3.5" />
          <span className="text-[11px]">Garantie 12 mois</span>
        </div>
      </div>
    </div>
  );
});

// ─── Toggle Switch ───────────────────────────────

function ToggleSwitch({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer select-none">
      <div
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-[22px] rounded-full transition-colors duration-200 ${
          checked ? 'bg-amber-500' : 'bg-slate-600'
        }`}
      >
        <div
          className={`absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white shadow-sm transition-transform duration-200 ${
            checked ? 'translate-x-[20px]' : 'translate-x-[2px]'
          }`}
        />
      </div>
      <span className="text-sm text-slate-400">{label}</span>
    </label>
  );
}

// ─── Main Component ──────────────────────────────

export default function TarifsTelephonesPage() {
  const { user } = useAuth();
  const isAdmin = localStorage.getItem('klikphone_admin') === 'true';

  // Loading / UI state
  const [syncing, setSyncing] = useState(false);

  // Filter state
  const [typeProduit, setTypeProduit] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [enStockOnly, setEnStockOnly] = useState(true);
  const [sortBy, setSortBy] = useState('prix_asc');
  const [showSortDropdown, setShowSortDropdown] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);

  // ─── Data fetching via useApi ─────────────────

  const { data: statsData, loading: loadingStats, isRevalidating: statsRevalidating } = useApi(
    'telephones:stats',
    async () => {
      const [s, m] = await Promise.all([api.getTelephoneStats(), api.getTelephoneMarques()]);
      return { stats: s, marques: m || [] };
    },
    { tags: ['telephones'], ttl: 300_000 }
  );
  const stats = statsData?.stats ?? null;
  const marques = statsData?.marques ?? [];

  const phonesKey = useMemo(() => {
    const p = ['telephones:list', `p:${currentPage}`];
    if (selectedBrand) p.push(`b:${selectedBrand}`);
    if (typeProduit) p.push(`t:${typeProduit}`);
    if (enStockOnly) p.push('stock');
    if (searchQuery.trim()) p.push(`q:${searchQuery.trim()}`);
    if (sortBy) p.push(`sort:${sortBy}`);
    return p.join(':');
  }, [currentPage, selectedBrand, typeProduit, enStockOnly, searchQuery, sortBy]);

  const { data: phonesData, loading: loadingPhones } = useApi(
    phonesKey,
    async () => {
      const params = { page: currentPage, limit: 24 };
      if (selectedBrand) params.marque = selectedBrand;
      if (typeProduit) params.type_produit = typeProduit;
      if (enStockOnly) params.en_stock = true;
      if (searchQuery.trim()) params.search = searchQuery.trim();
      if (sortBy) params.tri = sortBy;
      const data = await api.getTelephonesCatalogue(params);
      if (data && data.items) {
        return { phones: data.items, totalPages: data.total_pages || 1, totalItems: data.total || 0 };
      }
      const arr = Array.isArray(data) ? data : [];
      return { phones: arr, totalPages: 1, totalItems: arr.length };
    },
    { tags: ['telephones'], ttl: 300_000 }
  );
  const phones = phonesData?.phones ?? [];
  const totalPages = phonesData?.totalPages ?? 1;
  const totalItems = phonesData?.totalItems ?? 0;

  // Reset page when filters change
  const prevFilters = useRef({ selectedBrand, typeProduit, enStockOnly, searchQuery, sortBy });
  useEffect(() => {
    const pf = prevFilters.current;
    if (pf.selectedBrand !== selectedBrand || pf.typeProduit !== typeProduit ||
        pf.enStockOnly !== enStockOnly || pf.searchQuery !== searchQuery || pf.sortBy !== sortBy) {
      setCurrentPage(1);
    }
    prevFilters.current = { selectedBrand, typeProduit, enStockOnly, searchQuery, sortBy };
  }, [selectedBrand, typeProduit, enStockOnly, searchQuery, sortBy]);

  // ─── Sync handler ──────────────────────────────

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      await api.syncTelephones();
      // Poll sync-status until done
      let attempts = 0;
      while (attempts < 120) { // max ~10 min
        await new Promise(r => setTimeout(r, 5000));
        attempts++;
        try {
          const status = await api.getSyncStatus();
          if (!status.running) {
            break;
          }
        } catch { break; }
      }
      setCurrentPage(1);
      invalidateCache('telephones');
    } catch (err) {
      console.error('Erreur sync telephones:', err);
    } finally {
      setSyncing(false);
    }
  }

  // ─── Close sort dropdown on outside click ──────

  useEffect(() => {
    if (!showSortDropdown) return;
    function handleClick() {
      setShowSortDropdown(false);
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [showSortDropdown]);

  // ─── Debounce search ──────────────────────────

  const [searchInput, setSearchInput] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchInput);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // ─── Brand filter helpers ─────────────────────

  const typePills = [
    { value: '', label: 'Tous' },
    { value: 'neuf', label: 'Neufs' },
    { value: 'occasion', label: 'Occasion' },
  ];

  const currentSort = SORT_OPTIONS.find(o => o.value === sortBy) || SORT_OPTIONS[0];

  // ─── Render ────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-900 pb-12">
      {/* ───────── HEADER ───────── */}
      <div className="bg-slate-900 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex items-start justify-between gap-4">
            {/* Title */}
            <div>
              <h1 className="text-2xl font-bold text-white">Tarifs Telephones</h1>
              <p className="text-sm text-slate-400 mt-1">
                Telephones neufs et reconditionnes &mdash; Garantie 12 mois
              </p>
            </div>

            {/* Sync button — admin only */}
            <div className="flex flex-col items-end shrink-0">
              {isAdmin && (
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60 shadow-lg"
                  style={{
                    background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                  }}
                >
                  {syncing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  {syncing ? 'Synchronisation...' : 'Synchroniser'}
                </button>
              )}
              {stats?.derniere_sync && (
                <p className="text-[11px] text-slate-500 mt-1.5">
                  Derniere sync : {formatDate(stats.derniere_sync)}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {/* ───────── KPI CARDS ───────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          {loadingStats ? (
            <>
              <KPICardSkeleton />
              <KPICardSkeleton />
              <KPICardSkeleton />
              <KPICardSkeleton />
            </>
          ) : (
            <>
              <KPICard
                icon={Package}
                value={stats?.total ?? 0}
                label="Total modeles"
                color="#8B5CF6"
              />
              <KPICard
                icon={Sparkles}
                value={stats?.en_stock ?? 0}
                label="En stock"
                color="#10B981"
              />
              <KPICard
                icon={Tag}
                value={stats?.neufs ?? 0}
                label="Neufs"
                color="#3B82F6"
              />
              <KPICard
                icon={RefreshCw}
                value={stats?.reconditionnes ?? 0}
                label="Reconditionnes"
                color="#F97316"
              />
            </>
          )}
        </div>

        {/* ───────── FILTER BAR ───────── */}
        <div className="mt-8 space-y-4">
          {/* Row 1: Type pills + Brand pills */}
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Type pills */}
            <div className="flex items-center gap-2 shrink-0">
              {typePills.map((pill) => (
                <button
                  key={pill.value}
                  onClick={() => setTypeProduit(pill.value)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                    typeProduit === pill.value
                      ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20'
                      : 'border border-slate-600 text-slate-400 hover:border-slate-500 hover:text-slate-300'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            {/* Brand pills */}
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-1">
              <button
                onClick={() => setSelectedBrand('')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                  selectedBrand === ''
                    ? 'bg-amber-500 text-white'
                    : 'border border-slate-600 text-slate-400 hover:border-slate-500 hover:text-slate-300'
                }`}
              >
                Toutes marques
              </button>
              {marques.map((m) => {
                const brandColor = BRAND_COLORS[m.marque] || '#8B5CF6';
                const isActive = selectedBrand === m.marque;
                return (
                  <button
                    key={m.marque}
                    onClick={() => setSelectedBrand(isActive ? '' : m.marque)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all border ${
                      isActive
                        ? 'text-white shadow-lg'
                        : 'border-slate-600 text-slate-400 hover:border-slate-500 hover:text-slate-300'
                    }`}
                    style={
                      isActive
                        ? { backgroundColor: brandColor, borderColor: brandColor }
                        : undefined
                    }
                  >
                    {m.marque}
                    {m.nb_en_stock != null && (
                      <span className={`ml-1.5 text-[10px] ${isActive ? 'opacity-75' : 'text-slate-500'}`}>
                        ({m.nb_en_stock})
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Row 2: Search + En stock toggle + Sort */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {/* Search input */}
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="Rechercher un telephone..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-800/70 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/50 transition-all"
              />
            </div>

            {/* En stock toggle */}
            <ToggleSwitch
              checked={enStockOnly}
              onChange={setEnStockOnly}
              label="En stock"
            />

            {/* Sort dropdown */}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSortDropdown(!showSortDropdown);
                }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800/70 border border-slate-700/50 text-sm text-slate-300 hover:border-slate-600 transition-all whitespace-nowrap"
              >
                <SlidersHorizontal className="w-4 h-4 text-slate-500" />
                {currentSort.label}
                <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${showSortDropdown ? 'rotate-180' : ''}`} />
              </button>

              {showSortDropdown && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl shadow-black/40 z-30 overflow-hidden">
                  {SORT_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSortBy(option.value);
                        setShowSortDropdown(false);
                      }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                        sortBy === option.value
                          ? 'bg-amber-500/10 text-amber-400 font-medium'
                          : 'text-slate-300 hover:bg-slate-700/50'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ───────── PHONE GRID ───────── */}
        <div className="mt-8">
          {loadingPhones ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <PhoneCardSkeleton key={i} />
              ))}
            </div>
          ) : phones.length === 0 ? (
            /* ───────── EMPTY STATE ───────── */
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-20 h-20 rounded-2xl bg-slate-800/50 border border-slate-700/50 flex items-center justify-center mb-6">
                <Smartphone className="w-10 h-10 text-slate-600" />
              </div>
              <h3 className="text-lg font-semibold text-slate-300 mb-2">
                Aucun telephone trouve
              </h3>
              <p className="text-sm text-slate-500 max-w-md">
                Essayez de modifier vos filtres ou lancez une synchronisation pour importer les derniers telephones disponibles.
              </p>
              <button
                onClick={() => {
                  setTypeProduit('');
                  setSelectedBrand('');
                  setSearchInput('');
                  setSearchQuery('');
                  setEnStockOnly(true);
                  setSortBy('prix_asc');
                  setCurrentPage(1);
                }}
                className="mt-6 px-5 py-2.5 rounded-xl border border-slate-600 text-sm text-slate-400 hover:border-slate-500 hover:text-slate-300 transition-all"
              >
                Reinitialiser les filtres
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {phones.filter(p => p.modele && p.modele.trim() && p.prix_vente && p.prix_vente > 0 && p.marque && p.marque.trim()).map((phone, idx) => (
                <PhoneCard key={phone.id || idx} phone={phone} />
              ))}
            </div>
          )}
        </div>

        {/* ───────── PAGINATION + RESULTS COUNT ───────── */}
        {!loadingPhones && phones.length > 0 && (
          <div className="mt-8 flex flex-col items-center gap-4">
            {/* Pagination controls */}
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-2 rounded-lg bg-slate-800/70 border border-slate-700/50 text-slate-400 hover:text-white hover:border-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                {/* Page numbers */}
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  let pageNum;
                  if (totalPages <= 7) {
                    pageNum = i + 1;
                  } else if (currentPage <= 4) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 3) {
                    pageNum = totalPages - 6 + i;
                  } else {
                    pageNum = currentPage - 3 + i;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${
                        currentPage === pageNum
                          ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20'
                          : 'bg-slate-800/70 border border-slate-700/50 text-slate-400 hover:text-white hover:border-slate-600'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}

                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-2 rounded-lg bg-slate-800/70 border border-slate-700/50 text-slate-400 hover:text-white hover:border-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Count */}
            <p className="text-xs text-slate-500">
              {totalItems} telephone{totalItems > 1 ? 's' : ''}
              {totalPages > 1 ? ` · Page ${currentPage}/${totalPages}` : ''}
              {stats?.nb_marques ? ` · ${stats.nb_marques} marques` : ''}
              {stats?.prix_min != null && stats?.prix_max != null
                ? ` · ${formatPrice(stats.prix_min)} → ${formatPrice(stats.prix_max)}`
                : ''}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
