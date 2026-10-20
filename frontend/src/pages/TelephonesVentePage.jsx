import { useState, useEffect, useMemo, useRef, memo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useApi, invalidateCache } from '../hooks/useApi';
import api from '../lib/api';
import { SynchroLcdPhone } from '../components/SantePrixWidget';
import {
  Smartphone, Search, Package, Euro, Tag, Filter,
  Loader2, Shield, ChevronLeft, ChevronRight,
  SlidersHorizontal,
} from 'lucide-react';

// Grade = information neutre (badge gris) ; « Neuf » = information (bleu)
const GRADE_COLORS = {
  'Grade A': 'badge-neutral',
  'Grade A+': 'badge-neutral',
  'Grade AB': 'badge-neutral',
  'Grade B': 'badge-neutral',
  'Grade B+': 'badge-neutral',
  'Grade C': 'badge-neutral',
  'Neuf': 'badge-info',
};

const fp = (v) => {
  if (v == null || v === 0) return '—';
  return Number(v).toFixed(2).replace('.', ',') + ' €';
};

const PhoneCard = memo(function PhoneCard({ phone }) {
  const grade = phone.grade || (phone.type_produit === 'neuf' ? 'Neuf' : null);
  const gs = grade && GRADE_COLORS[grade] ? GRADE_COLORS[grade] : null;
  const inStock = phone.en_stock !== false && phone.en_stock !== 0;

  return (
    <div className={`card overflow-hidden transition-colors duration-150 hover:border-slate-300 group ${!inStock ? 'opacity-60' : ''}`}>
      {/* Image */}
      <div className="relative h-44 bg-slate-50 flex items-center justify-center overflow-hidden">
        {phone.image_url ? (
          <img src={phone.image_url} alt={phone.modele || ''}
            className="h-full w-full object-contain p-3"
            loading="lazy"
            onError={e => { e.target.style.display = 'none'; e.target.nextElementSibling?.classList.remove('hidden'); }} />
        ) : null}
        <div className={`flex flex-col items-center justify-center text-slate-300 ${phone.image_url ? 'hidden' : ''}`}>
          <Smartphone className="w-12 h-12 mb-1" aria-hidden="true" />
        </div>

        {/* Badge grade */}
        {gs && (
          <span className={`absolute top-2 left-2 badge badge-sm ${gs}`}>
            {grade === 'Neuf' ? 'NEUF' : grade.toUpperCase()}
          </span>
        )}

        {/* Badge stock */}
        <span className={`absolute top-2 right-2 badge badge-sm ${inStock ? 'badge-success' : 'badge-danger'}`}>
          <span className="badge-dot" aria-hidden="true" />
          {inStock ? 'En stock' : 'Rupture'}
        </span>
      </div>

      {/* Content */}
      <div className="p-3.5">
        <p className="t-caption mb-0.5">{phone.marque}</p>
        <h3 className="text-sm font-semibold text-slate-900 leading-tight mb-1 line-clamp-2">{phone.modele}</h3>
        <p className="t-small mb-2">
          {[phone.stockage, phone.couleur].filter(Boolean).join(' · ')}
        </p>
        <p className="text-lg font-semibold text-slate-900 tabular-nums">{fp(phone.prix_vente)}</p>
        <div className="flex items-center gap-1.5 t-caption mt-1.5">
          <Shield className="w-4 h-4 text-slate-400" aria-hidden="true" />
          <span>Garantie {phone.garantie_mois || 12} mois</span>
        </div>
      </div>
    </div>
  );
});

export default function TelephonesVentePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || localStorage.getItem('klikphone_admin') === 'true';

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterMarque, setFilterMarque] = useState('');
  const [filterType, setFilterType] = useState('');
  const [enStockOnly, setEnStockOnly] = useState(true);
  const [sortBy, setSortBy] = useState('prix_asc');
  const [currentPage, setCurrentPage] = useState(1);
  const searchTimer = useRef(null);

  // Debounced search
  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setDebouncedSearch(search); setCurrentPage(1); }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  // Reset page on filter change
  useEffect(() => { setCurrentPage(1); }, [filterMarque, filterType, enStockOnly, sortBy]);

  // Stats + marques
  const { data: statsData } = useApi(
    'telVente:stats',
    async () => {
      const [s, m] = await Promise.all([api.getTelephoneStats(), api.getTelephoneMarques()]);
      return { stats: s, marques: m || [] };
    },
    { tags: ['telephones'], ttl: 300_000 }
  );
  const stats = statsData?.stats ?? {};
  const marques = statsData?.marques ?? [];

  // Phones list
  const phonesKey = useMemo(() => {
    const p = ['telVente:list', `p:${currentPage}`];
    if (debouncedSearch) p.push(`q:${debouncedSearch}`);
    if (filterMarque) p.push(`m:${filterMarque}`);
    if (filterType) p.push(`t:${filterType}`);
    if (enStockOnly) p.push('stock');
    if (sortBy) p.push(`s:${sortBy}`);
    return p.join(':');
  }, [currentPage, debouncedSearch, filterMarque, filterType, enStockOnly, sortBy]);

  const { data: phonesData, loading } = useApi(
    phonesKey,
    async () => {
      const params = { page: currentPage, limit: 24 };
      if (debouncedSearch) params.search = debouncedSearch;
      if (filterMarque) params.marque = filterMarque;
      if (filterType) params.type_produit = filterType;
      if (enStockOnly) params.en_stock = true;
      if (sortBy) params.tri = sortBy;
      const data = await api.getTelephonesCatalogue(params);
      if (data?.items) return { phones: data.items, totalPages: data.total_pages || 1, total: data.total || 0 };
      return { phones: [], totalPages: 1, total: 0 };
    },
    { tags: ['telephones'], ttl: 300_000 }
  );
  const phones = phonesData?.phones ?? [];
  const totalPages = phonesData?.totalPages ?? 1;
  const totalItems = phonesData?.total ?? 0;

  // Synchro LCD-Phone (bloc partagé) : liste relue à la fin
  const handleSyncTerminee = () => {
    setCurrentPage(1);
    invalidateCache('telephones');
  };

  return (
    <div className="page max-w-[1280px]">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-header-title">Téléphones en vente</h1>
          <p className="page-header-subtitle">
            {totalItems} téléphone{totalItems > 1 ? 's' : ''} disponibles — catalogue LCD-Phone
          </p>
        </div>
        <SynchroLcdPhone estAdmin={isAdmin} onTerminee={handleSyncTerminee} dateRepli={stats.derniere_sync} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <div className="kpi-card-sm">
          <div className="kpi-icon"><Smartphone aria-hidden="true" /></div>
          <div className="min-w-0">
            <p className="kpi-value">{stats.total || 0}</p>
            <p className="kpi-label">Total</p>
          </div>
        </div>
        <div className="kpi-card-sm">
          <div className="kpi-icon bg-emerald-50 text-emerald-700"><Package aria-hidden="true" /></div>
          <div className="min-w-0">
            <p className="kpi-value">{stats.en_stock || 0}</p>
            <p className="kpi-label">En stock</p>
          </div>
        </div>
        <div className="kpi-card-sm">
          <div className="kpi-icon"><Tag aria-hidden="true" /></div>
          <div className="min-w-0">
            <p className="kpi-value">{stats.neufs || 0}</p>
            <p className="kpi-label">Neufs</p>
          </div>
        </div>
        <div className="kpi-card-sm">
          <div className="kpi-icon"><Tag aria-hidden="true" /></div>
          <div className="min-w-0">
            <p className="kpi-value">{stats.reconditionnes || 0}</p>
            <p className="kpi-label">Reconditionnés</p>
          </div>
        </div>
        <div className="kpi-card-sm">
          <div className="kpi-icon"><Euro aria-hidden="true" /></div>
          <div className="min-w-0">
            <p className="kpi-value">{stats.nb_marques || 0}</p>
            <p className="kpi-label">Marques</p>
          </div>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="card overflow-hidden mb-6">
        <div className="p-3 sm:p-4 border-b border-slate-100">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" aria-hidden="true" />
            <input type="search" placeholder="Rechercher par marque, modèle..." aria-label="Rechercher un téléphone par marque ou modèle"
              value={search} onChange={e => setSearch(e.target.value)} autoComplete="off"
              className="input pl-10" />
          </div>
        </div>
        <div className="px-3 sm:px-4 py-3 flex items-center gap-2 flex-wrap bg-slate-50">
          <SlidersHorizontal className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
          <select value={filterMarque} onChange={e => setFilterMarque(e.target.value)} aria-label="Filtrer par marque"
            className="select w-auto">
            <option value="">Toutes marques</option>
            {marques.map(m => {
              const name = typeof m === 'string' ? m : m.marque;
              return <option key={name} value={name}>{name}</option>;
            })}
          </select>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} aria-label="Filtrer par type"
            className="select w-auto">
            <option value="">Tous types</option>
            <option value="neuf">Neuf</option>
            <option value="occasion">Occasion</option>
          </select>
          <label className="flex items-center gap-3 min-h-11 px-1 text-sm text-slate-700 cursor-pointer select-none">
            <input type="checkbox" checked={enStockOnly} onChange={e => setEnStockOnly(e.target.checked)}
              className="checkbox" />
            En stock uniquement
          </label>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} aria-label="Trier les téléphones"
            className="select w-auto ml-auto">
            <option value="prix_asc">Prix croissant</option>
            <option value="prix_desc">Prix décroissant</option>
            <option value="marque">Marque A-Z</option>
            <option value="nouveautes">Nouveautés</option>
          </select>
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="loading-inline justify-center w-full py-16" role="status">
          <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
          <span className="sr-only">Chargement des téléphones…</span>
        </div>
      ) : phones.length === 0 ? (
        <div className="empty-state card">
          <div className="empty-state-icon">
            <Smartphone aria-hidden="true" />
          </div>
          <p className="t-h2">Aucun téléphone trouvé</p>
          <p className="t-body text-slate-500">Modifiez vos filtres ou lancez une synchronisation</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
            {phones.map(phone => (
              <PhoneCard key={phone.id} phone={phone} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <nav className="flex flex-wrap items-center justify-center gap-2 mt-6 max-w-full" aria-label="Pagination">
              <button type="button" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1} aria-label="Page précédente"
                className="btn-ghost btn-icon w-11 h-11 min-w-[44px]">
                <ChevronLeft aria-hidden="true" />
              </button>
              {/* Téléphone : « Page X / N » entre les flèches, les numéros à partir de sm */}
              <span className="sm:hidden px-2 text-sm font-medium tabular-nums text-slate-700" aria-current="page">
                Page {currentPage} / {totalPages}
              </span>
              <div className="hidden sm:flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
                  .reduce((acc, p, i, arr) => {
                    if (i > 0 && p - arr[i - 1] > 1) acc.push('...');
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, i) =>
                    p === '...' ? (
                      <span key={`dots-${i}`} className="px-1 text-slate-500" aria-hidden="true">...</span>
                    ) : (
                      <button key={p} type="button" onClick={() => setCurrentPage(p)} aria-label={`Page ${p}`}
                        aria-current={p === currentPage ? 'page' : undefined}
                        className={`w-11 h-11 rounded-lg text-sm font-medium tabular-nums transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
                          p === currentPage ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                        }`}>
                        {p}
                      </button>
                    )
                  )}
              </div>
              <button type="button" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} aria-label="Page suivante"
                className="btn-ghost btn-icon w-11 h-11 min-w-[44px]">
                <ChevronRight aria-hidden="true" />
              </button>
              <span className="t-caption basis-full text-center sm:basis-auto sm:ml-2">{totalItems} résultat{totalItems > 1 ? 's' : ''}</span>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
