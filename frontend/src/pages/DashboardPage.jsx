import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import StatusBadge from '../components/StatusBadge';
import { formatDate, formatDateShort, formatPrix, STATUTS, getStatusIcon } from '../lib/utils';
import {
  Search, Plus, RefreshCw, Clock, AlertTriangle,
  Wrench as WrenchIcon, CheckCircle2, Package, ChevronRight,
  Phone, Smartphone, TrendingUp,
} from 'lucide-react';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const basePath = user?.target === 'tech' ? '/tech' : '/accueil';

  const [kpi, setKpi] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatut, setFilterStatut] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (search) params.search = search;
      if (filterStatut) params.statut = filterStatut;

      const [kpiData, ticketsData] = await Promise.all([
        api.getKPI(),
        api.getTickets(params),
      ]);
      setKpi(kpiData);
      setTickets(ticketsData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [search, filterStatut, refreshKey]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const interval = setInterval(() => setRefreshKey(k => k + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  const kpiCards = kpi ? [
    { label: 'Attente diagnostic', value: kpi.en_attente_diagnostic, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50', iconBg: 'bg-amber-100' },
    { label: 'En r\u00E9paration', value: kpi.en_cours, icon: WrenchIcon, color: 'text-sky-600', bg: 'bg-sky-50', iconBg: 'bg-sky-100' },
    { label: 'Attente pi\u00E8ce', value: kpi.en_attente_piece, icon: Package, color: 'text-violet-600', bg: 'bg-violet-50', iconBg: 'bg-violet-100' },
    { label: 'Termin\u00E9es', value: kpi.reparation_terminee, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50', iconBg: 'bg-emerald-100' },
    { label: 'Total actifs', value: kpi.total_actifs, icon: Smartphone, color: 'text-brand-600', bg: 'bg-brand-50', iconBg: 'bg-brand-100' },
    { label: "Aujourd'hui", value: kpi.nouveaux_aujourdhui, icon: TrendingUp, color: 'text-cyan-600', bg: 'bg-cyan-50', iconBg: 'bg-cyan-100' },
  ] : [];

  const filterTabs = [
    { label: 'Tous', value: '', count: kpi?.total_actifs },
    { label: 'Diagnostic', value: 'En attente de diagnostic', count: kpi?.en_attente_diagnostic },
    { label: 'En r\u00E9paration', value: 'En cours de r\u00E9paration', count: kpi?.en_cours },
    { label: 'Attente pi\u00E8ce', value: 'En attente de pi\u00E8ce', count: kpi?.en_attente_piece },
    { label: 'Termin\u00E9s', value: 'R\u00E9paration termin\u00E9e', count: kpi?.reparation_terminee },
    { label: 'Rendus', value: 'Rendu au client' },
    { label: 'Cl\u00F4tur\u00E9s', value: 'Cl\u00F4tur\u00E9' },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">Vue d'ensemble des r\u00E9parations</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            className="btn-ghost p-2.5"
            title="Rafra\u00EEchir"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => navigate('/client')} className="btn-primary">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Nouveau ticket</span>
          </button>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {kpiCards.map(({ label, value, icon: Icon, color, bg, iconBg }, i) => (
          <div
            key={label}
            className="card p-4 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 animate-in"
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center mb-3`}>
              <Icon className={`w-4.5 h-4.5 ${color}`} />
            </div>
            <p className="text-2xl font-bold text-slate-900 tracking-tight">{value}</p>
            <p className="text-[11px] text-slate-500 font-medium mt-0.5 leading-tight">{label}</p>
          </div>
        ))}
      </div>

      {/* Search & Filters card */}
      <div className="card overflow-hidden mb-6">
        <div className="p-3 sm:p-4 border-b border-slate-100">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Rechercher par nom, t\u00E9l\u00E9phone, code ticket, marque..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 bg-slate-50/50 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 focus:bg-white transition-all"
            />
          </div>
        </div>

        {/* Filter tabs */}
        <div className="px-3 sm:px-4 py-2 flex gap-1 overflow-x-auto scrollbar-none bg-slate-50/50">
          {filterTabs.map(({ label, value, count }) => (
            <button
              key={value}
              onClick={() => setFilterStatut(value)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all
                ${filterStatut === value
                  ? 'bg-brand-500 text-white shadow-sm shadow-brand-500/25'
                  : 'text-slate-500 hover:bg-white hover:text-slate-700 hover:shadow-sm'
                }`}
            >
              {label}
              {count !== undefined && count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                  filterStatut === value ? 'bg-white/20' : 'bg-slate-200/60 text-slate-500'
                }`}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tickets Table */}
      <div className="card overflow-hidden">
        {/* Table header */}
        <div className="hidden lg:grid grid-cols-[90px_1fr_180px_160px_90px_80px_32px] gap-3 items-center px-5 py-3 bg-slate-50/80 border-b border-slate-100">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Code</span>
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Client / Appareil</span>
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Panne</span>
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Statut</span>
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Date</span>
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider text-right">Prix</span>
          <span></span>
        </div>

        {loading && tickets.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-400">Chargement des tickets...</p>
          </div>
        ) : tickets.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
              <Smartphone className="w-7 h-7 text-slate-300" />
            </div>
            <p className="text-slate-500 font-medium">Aucun ticket trouv\u00E9</p>
            <p className="text-sm text-slate-400 mt-1">Modifiez vos filtres ou cr\u00E9ez un nouveau ticket</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100/80">
            {tickets.map((t, i) => (
              <div
                key={t.id}
                onClick={() => navigate(`${basePath}/ticket/${t.id}`)}
                className="lg:grid lg:grid-cols-[90px_1fr_180px_160px_90px_80px_32px] gap-3 items-center px-4 sm:px-5 py-3.5 hover:bg-brand-50/40 cursor-pointer transition-colors group"
              >
                {/* Code */}
                <div>
                  <p className="text-sm font-bold text-brand-600 font-mono">{t.ticket_code}</p>
                </div>

                {/* Client / Appareil */}
                <div className="min-w-0 mt-1 lg:mt-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">
                    {t.client_prenom || ''} {t.client_nom || ''}
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    {t.marque} {t.modele || t.modele_autre}
                  </p>
                </div>

                {/* Panne */}
                <div className="hidden lg:block">
                  <p className="text-sm text-slate-600 truncate">{t.panne}</p>
                </div>

                {/* Statut */}
                <div className="mt-2 lg:mt-0">
                  <StatusBadge statut={t.statut} />
                </div>

                {/* Date */}
                <div className="hidden lg:block">
                  <p className="text-xs text-slate-500">{formatDateShort(t.date_depot)}</p>
                </div>

                {/* Prix */}
                <div className="hidden lg:block text-right">
                  {(t.devis_estime || t.tarif_final) ? (
                    <p className="text-sm font-semibold text-slate-800">{formatPrix(t.tarif_final || t.devis_estime)}</p>
                  ) : (
                    <p className="text-xs text-slate-300">\u2014</p>
                  )}
                </div>

                {/* Arrow */}
                <div className="hidden lg:flex justify-end">
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-brand-500 transition-colors" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
