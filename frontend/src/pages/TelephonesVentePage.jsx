import { useState, useEffect, useMemo, useRef, memo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useApi, invalidateCache } from '../hooks/useApi';
import api from '../lib/api';
import {
  Smartphone, Search, Package, Euro, Tag, Filter,
  Loader2, Shield, ChevronLeft, ChevronRight, RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';

const GRADE_COLORS = {
  'Grade A': { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  'Grade A+': { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  'Grade AB': { bg: 'bg-lime-100', text: 'text-lime-700' },
  'Grade B': { bg: 'bg-yellow-100', text: 'text-yellow-700' },
  'Grade B+': { bg: 'bg-yellow-100', text: 'text-yellow-700' },
  'Grade C': { bg: 'bg-orange-100', text: 'text-orange-700' },
  'Neuf': { bg: 'bg-blue-100', text: 'text-blue-700' },
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
    <div className={`card overflow-hidden transition-all hover:shadow-md group ${!inStock ? 'opacity-50' : ''}`}>
      {/* Image */}
      <div className="relative h-44 bg-slate-50 flex items-center justify-center overflow-hidden">
        {phone.image_url ? (
          <img src={phone.image_url} alt={phone.modele || ''}
            className="h-full w-full object-contain p-3 group-hover:scale-105 transition-transform"
            loading="lazy"
            onError={e => { e.target.style.display = 'none'; e.target.nextElementSibling?.classList.remove('hidden'); }} />
        ) : null}
        <div className={`flex flex-col items-center justify-center text-slate-300 ${phone.image_url ? 'hidden' : ''}`}>
          <Smartphone className="w-12 h-12 mb-1" />
        </div>

        {/* Badge grade */}
        {gs && (
          <span className={`absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-md ${gs.bg} ${gs.text}`}>
            {grade === 'Neuf' ? 'NEUF' : grade.toUpperCase()}
          </span>
        )}

        {/* Badge stock */}
        <span className={`absolute top-2 right-2 text-[10px] font-semibold px-2 py-0.5 rounded-md flex items-center gap-1
          ${inStock ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${inStock ? 'bg-emerald-500' : 'bg-red-400'}`} />
          {inStock ? 'En stock' : 'Rupture'}
        </span>
      </div>

      {/* Content */}
      <div className="p-3.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">{phone.marque}</p>
        <h3 className="text-sm font-bold text-slate-900 leading-tight mb-1 line-clamp-2">{phone.modele}</h3>
        <p className="text-xs text-slate-500 mb-2">
          {[phone.stockage, phone.couleur].filter(Boolean).join(' · ')}
        </p>
        <p className="text-lg font-extrabold text-brand-600">{fp(phone.prix_vente)}</p>
        <div className="flex items-center gap-1.5 text-slate-400 mt-1.5">
          <Shield className="w-3 h-3" />
          <span className="text-[11px]">Garantie {phone.garantie_mois || 12} mois</span>
        </div>
      </div>
    </div>
  );
});

export default function TelephonesVentePage() {
  const { user } = useAuth();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterMarque, setFilterMarque] = useState('');
  const [filterType, setFilterType] = useState('');
  const [enStockOnly, setEnStockOnly] = useState(true);
  const [sortBy, setSortBy] = useState('prix_asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [syncing, setSyncing] = useState(false);
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

  // Sync
  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await api.syncTelephones();
      let attempts = 0;
      while (attempts < 60) {
        await new Promise(r => setTimeout(r, 5000));
        attempts++;
        try {
          const st = await api.getSyncStatus();
          if (!st.running) break;
        } catch { break; }
      }
      setCurrentPage(1);
      invalidateCache('telephones');
    } catch (err) {
      console.error(err);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Smartphone className="w-6 h-6 text-brand-600" /> Téléphones en vente
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {totalItems} téléphone{totalItems > 1 ? 's' : ''} disponibles — catalogue LCD-Phone
          </p>
        </div>
        <button onClick={handleSync} disabled={syncing}
          className="btn-secondary flex items-center gap-2">
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Synchronisation...' : 'Sync LCD-Phone'}
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
            <span className="text-xs text-slate-500">Reconditionnés</span>
          </div>
          <p className="text-xl font-bold text-amber-600">{stats.reconditionnes || 0}</p>
        </div>
        <div className="card p-3">
          <div className="flex items-center gap-2 mb-1">
            <Euro className="w-4 h-4 text-brand-500" />
            <span className="text-xs text-slate-500">Marques</span>
          </div>
          <p className="text-xl font-bold text-brand-600">{stats.nb_marques || 0}</p>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="card overflow-hidden mb-6">
        <div className="p-3 sm:p-4 border-b border-slate-100">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" placeholder="Rechercher par marque, modèle..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 bg-slate-50/50 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 focus:bg-white transition-all" />
          </div>
        </div>
        <div className="px-3 sm:px-4 py-2.5 flex items-center gap-2 flex-wrap bg-slate-50/50">
          <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <select value={filterMarque} onChange={e => setFilterMarque(e.target.value)}
            className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-600">
            <option value="">Toutes marques</option>
            {marques.map(m => {
              const name = typeof m === 'string' ? m : m.marque;
              return <option key={name} value={name}>{name}</option>;
            })}
          </select>
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-600">
            <option value="">Tous types</option>
            <option value="neuf">Neuf</option>
            <option value="occasion">Occasion</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
            <input type="checkbox" checked={enStockOnly} onChange={e => setEnStockOnly(e.target.checked)}
              className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
            En stock uniquement
          </label>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-600 ml-auto">
            <option value="prix_asc">Prix croissant</option>
            <option value="prix_desc">Prix décroissant</option>
            <option value="marque">Marque A-Z</option>
            <option value="nouveautes">Nouveautés</option>
          </select>
        </div>
      </div>

      {/* Dernière sync */}
      {stats.derniere_sync && (
        <p className="text-[11px] text-slate-400 mb-3 px-1">
          Dernière synchronisation : {new Date(stats.derniere_sync).toLocaleString('fr-FR')}
        </p>
      )}

      {/* Grid */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
        </div>
      ) : phones.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
            <Smartphone className="w-7 h-7 text-slate-300" />
          </div>
          <p className="text-slate-500 font-medium">Aucun téléphone trouvé</p>
          <p className="text-sm text-slate-400 mt-1">Modifiez vos filtres ou lancez une synchronisation</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {phones.map(phone => (
              <PhoneCard key={phone.id} phone={phone} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}
                className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">
                <ChevronLeft className="w-4 h-4 text-slate-600" />
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
                  .reduce((acc, p, i, arr) => {
                    if (i > 0 && p - arr[i - 1] > 1) acc.push('...');
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, i) =>
                    p === '...' ? (
                      <span key={`dots-${i}`} className="px-1 text-slate-400">...</span>
                    ) : (
                      <button key={p} onClick={() => setCurrentPage(p)}
                        className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                          p === currentPage ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-100'
                        }`}>
                        {p}
                      </button>
                    )
                  )}
              </div>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}
                className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">
                <ChevronRight className="w-4 h-4 text-slate-600" />
              </button>
              <span className="text-xs text-slate-400 ml-2">{totalItems} résultat{totalItems > 1 ? 's' : ''}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
