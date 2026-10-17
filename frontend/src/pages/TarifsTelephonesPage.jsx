import { useState, useEffect, useRef, useMemo, memo } from 'react';
import {
  Smartphone, Search, RefreshCw, ChevronDown, Shield,
  Package, SlidersHorizontal, Sparkles, Tag,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useApi, invalidateCache } from '../hooks/useApi';
import { SynchroLcdPhone } from '../components/SantePrixWidget';

// ─── Constantes ──────────────────────────────────

// Grade = information neutre (badge gris) ; « Neuf » = information (bleu)
const GRADE_COLORS = {
  'Grade A': 'badge-neutral',
  'Grade A+': 'badge-neutral',
  'Grade B': 'badge-neutral',
  'Grade B+': 'badge-neutral',
  'Grade C': 'badge-neutral',
  'Neuf': 'badge-info',
};

const SORT_OPTIONS = [
  { value: 'prix_asc', label: 'Prix croissant' },
  { value: 'prix_desc', label: 'Prix decroissant' },
  { value: 'marque', label: 'Marque A-Z' },
  { value: 'nouveautes', label: 'Nouveautes' },
];

// ─── Helpers ─────────────────────────────────────

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
  return <div className="skeleton-card" />;
}

function PhoneCardSkeleton() {
  return (
    <div className="card overflow-hidden">
      <div className="skeleton h-44 rounded-none" />
      <div className="p-4 space-y-3">
        <div className="skeleton-line h-3 w-16" />
        <div className="skeleton-line h-5 w-3/4" />
        <div className="skeleton-line h-3 w-1/2" />
        <div className="skeleton-line h-7 w-24" />
        <div className="skeleton-line h-3 w-32" />
      </div>
    </div>
  );
}

// ─── KPI Card ────────────────────────────────────

function KPICard({ icon: Icon, value, label }) {
  return (
    <div className="kpi-card">
      <div className="kpi-icon">
        <Icon aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="kpi-value">{value ?? '-'}</p>
        <p className="kpi-label">{label}</p>
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
    <div className="card overflow-hidden transition-colors duration-150 hover:border-slate-300 group">
      {/* Image area */}
      <div className="relative h-44 bg-slate-50 flex items-center justify-center overflow-hidden">
        {phone.image_url ? (
          <img
            src={phone.image_url}
            alt={phone.modele || 'Telephone'}
            className="h-full w-full object-contain p-4"
            loading="lazy"
            onError={(e) => {
              e.target.style.display = 'none';
              e.target.nextElementSibling?.classList.remove('hidden');
            }}
          />
        ) : null}
        <div className={`flex flex-col items-center justify-center text-slate-400 ${phone.image_url ? 'hidden' : ''}`}>
          <Smartphone className="w-12 h-12 mb-2" aria-hidden="true" />
          <span className="t-caption">Pas d'image</span>
        </div>

        {/* Badge top-left: Grade or Neuf */}
        {gradeStyle && (
          <span className={`absolute top-3 left-3 badge ${gradeStyle}`}>
            {grade === 'Neuf' ? 'NEUF' : grade.toUpperCase()}
          </span>
        )}

        {/* Badge top-right: Stock */}
        <div className="absolute top-3 right-3">
          {inStock ? (
            <span className="badge badge-success">
              <span className="badge-dot" aria-hidden="true" />
              En stock
            </span>
          ) : (
            <span className="badge badge-danger">
              <span className="badge-dot" aria-hidden="true" />
              Rupture
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Brand */}
        <p className="t-caption mb-1">
          {phone.marque || 'Marque inconnue'}
        </p>

        {/* Model name */}
        <h3 className="text-sm font-semibold text-slate-900 leading-tight mb-1 line-clamp-2">
          {phone.modele || 'Modele inconnu'}
        </h3>

        {/* Storage + Color */}
        <p className="t-small mb-3">
          {[phone.stockage, phone.couleur].filter(Boolean).join(' · ') || ''}
        </p>

        {/* Price */}
        <p className="text-lg font-semibold text-slate-900 tabular-nums mb-2">
          {phone.prix_vente != null ? formatPrice(phone.prix_vente) : 'Prix sur demande'}
        </p>

        {/* Supplier price crossed out */}
        {phone.prix_fournisseur != null && (
          <p className="t-caption line-through mb-2">
            Fournisseur : {formatPrice(phone.prix_fournisseur)}
          </p>
        )}

        {/* Guarantee */}
        <div className="flex items-center gap-1.5 t-caption">
          <Shield className="w-4 h-4 text-slate-400" aria-hidden="true" />
          <span>Garantie 12 mois</span>
        </div>
      </div>
    </div>
  );
});

// ─── Toggle Switch ───────────────────────────────

function ToggleSwitch({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-3 min-h-11 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="inline-flex min-h-[44px] min-w-[56px] shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      >
        <span aria-hidden="true" className={`relative block h-6 w-11 rounded-full transition-colors duration-150 ${checked ? 'bg-brand-600' : 'bg-slate-300'}`}>
          <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-xs transition-transform duration-150 ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
        </span>
      </button>
      <span className="text-sm text-slate-700">{label}</span>
    </label>
  );
}

// ─── Main Component ──────────────────────────────

export default function TarifsTelephonesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || localStorage.getItem('klikphone_admin') === 'true';

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

  // ─── Synchro LCD-Phone (bloc partagé : test de connexion, synchro, statut durable) ──

  const handleSyncTerminee = () => {
    setCurrentPage(1);
    invalidateCache('telephones');
  };

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
    <div className="page max-w-[1280px]">
      {/* ───────── HEADER ───────── */}
      <div className="page-header">
        {/* Title */}
        <div>
          <h1 className="page-header-title">Tarifs Telephones</h1>
          <p className="page-header-subtitle">
            Telephones neufs et reconditionnes &mdash; Garantie 12 mois
          </p>
        </div>

        {/* Synchro LCD-Phone : test puis synchro pour l'admin, dernière synchro pour tous */}
        <SynchroLcdPhone estAdmin={isAdmin} onTerminee={handleSyncTerminee} dateRepli={stats?.derniere_sync} className="shrink-0" />
      </div>

      <div>
        {/* ───────── KPI CARDS ───────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
              />
              <KPICard
                icon={Sparkles}
                value={stats?.en_stock ?? 0}
                label="En stock"
              />
              <KPICard
                icon={Tag}
                value={stats?.neufs ?? 0}
                label="Neufs"
              />
              <KPICard
                icon={RefreshCw}
                value={stats?.reconditionnes ?? 0}
                label="Reconditionnes"
              />
            </>
          )}
        </div>

        {/* ───────── FILTER BAR ───────── */}
        <div className="mt-6 space-y-4">
          {/* Row 1: Type pills + Brand pills */}
          <div className="flex flex-col lg:flex-row gap-3">
            {/* Type pills */}
            <div className="segmented shrink-0" role="group" aria-label="Type de téléphone">
              {typePills.map((pill) => (
                <button
                  key={pill.value}
                  type="button"
                  aria-pressed={typeProduit === pill.value}
                  onClick={() => setTypeProduit(pill.value)}
                  className={`segmented-item ${typeProduit === pill.value ? 'segmented-item-active' : ''}`}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            {/* Brand pills */}
            <div className="scroll-fade-x min-w-0">
              <div className="segmented" role="group" aria-label="Marque">
                <button
                  type="button"
                  aria-pressed={selectedBrand === ''}
                  onClick={() => setSelectedBrand('')}
                  className={`segmented-item ${selectedBrand === '' ? 'segmented-item-active' : ''}`}
                >
                  Toutes marques
                </button>
                {marques.map((m) => {
                  const isActive = selectedBrand === m.marque;
                  return (
                    <button
                      key={m.marque}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => setSelectedBrand(isActive ? '' : m.marque)}
                      className={`segmented-item ${isActive ? 'segmented-item-active' : ''}`}
                    >
                      {m.marque}
                      {m.nb_en_stock != null && (
                        <span className="text-xs text-slate-500 tabular-nums">
                          ({m.nb_en_stock})
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Row 2: Search + En stock toggle + Sort */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {/* Search input */}
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" aria-hidden="true" />
              <input
                type="search"
                placeholder="Rechercher un telephone..."
                aria-label="Rechercher un téléphone"
                autoComplete="off"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="input pl-10"
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
                type="button"
                aria-haspopup="listbox"
                aria-expanded={showSortDropdown}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSortDropdown(!showSortDropdown);
                }}
                className="btn-secondary"
              >
                <SlidersHorizontal className="text-slate-500" aria-hidden="true" />
                {currentSort.label}
                <ChevronDown className={`text-slate-500 transition-transform duration-150 ${showSortDropdown ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>

              {showSortDropdown && (
                <div role="listbox" aria-label="Trier" className="absolute right-0 top-full mt-2 w-52 card shadow-lg z-30 overflow-hidden animate-in">
                  {SORT_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={sortBy === option.value}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSortBy(option.value);
                        setShowSortDropdown(false);
                      }}
                      className={`w-full text-left min-h-11 px-4 py-2 text-sm transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 ${
                        sortBy === option.value
                          ? 'bg-brand-50 text-brand-700 font-semibold'
                          : 'text-slate-700 hover:bg-slate-50'
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
        <div className="mt-6">
          {loadingPhones ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" role="status" aria-label="Chargement des téléphones">
              {Array.from({ length: 8 }).map((_, i) => (
                <PhoneCardSkeleton key={i} />
              ))}
            </div>
          ) : phones.length === 0 ? (
            /* ───────── EMPTY STATE ───────── */
            <div className="empty-state card">
              <div className="empty-state-icon">
                <Smartphone aria-hidden="true" />
              </div>
              <h3 className="t-h2">
                Aucun telephone trouve
              </h3>
              <p className="t-body text-slate-500 max-w-md">
                Essayez de modifier vos filtres ou lancez une synchronisation pour importer les derniers telephones disponibles.
              </p>
              <button
                type="button"
                onClick={() => {
                  setTypeProduit('');
                  setSelectedBrand('');
                  setSearchInput('');
                  setSearchQuery('');
                  setEnStockOnly(true);
                  setSortBy('prix_asc');
                  setCurrentPage(1);
                }}
                className="btn-secondary"
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
              <nav className="flex items-center gap-2" aria-label="Pagination">
                <button
                  type="button"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  aria-label="Page précédente"
                  className="btn-secondary btn-icon"
                >
                  <ChevronLeft aria-hidden="true" />
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
                      type="button"
                      onClick={() => setCurrentPage(pageNum)}
                      aria-label={`Page ${pageNum}`}
                      aria-current={currentPage === pageNum ? 'page' : undefined}
                      className={`w-10 h-10 rounded-lg text-sm font-medium tabular-nums transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
                        currentPage === pageNum
                          ? 'bg-brand-600 text-white'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  aria-label="Page suivante"
                  className="btn-secondary btn-icon"
                >
                  <ChevronRight aria-hidden="true" />
                </button>
              </nav>
            )}

            {/* Count */}
            <p className="t-caption">
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
