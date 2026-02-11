import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import StatusBadge from '../components/StatusBadge';
import { formatDateShort, formatPrix, waLink, smsLink } from '../lib/utils';
import {
  Search, Plus, RefreshCw, AlertTriangle,
  Wrench, CheckCircle2, Package, ChevronRight,
  Smartphone, MessageCircle, Send, Mail,
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
  const [activeKpi, setActiveKpi] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 200 };
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

  const handleKpiClick = (filter, idx) => {
    if (activeKpi === idx) {
      setActiveKpi(null);
      setFilterStatut('');
      setShowArchived(false);
    } else {
      setActiveKpi(idx);
      if (filter) { setFilterStatut(filter); setShowArchived(false); }
    }
  };

  const activeTickets = tickets.filter(t => !['Clôturé', 'Rendu au client'].includes(t.statut));
  const archivedTickets = tickets.filter(t => ['Clôturé', 'Rendu au client'].includes(t.statut));
  const displayedTickets = showArchived ? archivedTickets : activeTickets;

  const kpiCards = kpi ? [
    { label: 'Total actifs', value: kpi.total_actifs, icon: Smartphone, color: 'text-brand-600', iconBg: 'bg-brand-100' },
    { label: 'Diagnostic', value: kpi.en_attente_diagnostic, icon: Search, color: 'text-amber-600', iconBg: 'bg-amber-100', filter: 'En attente de diagnostic' },
    { label: 'Réparation', value: kpi.en_cours, icon: Wrench, color: 'text-blue-600', iconBg: 'bg-blue-100', filter: 'En cours de réparation' },
    { label: 'Accord client', value: kpi.en_attente_accord, icon: AlertTriangle, color: 'text-orange-600', iconBg: 'bg-orange-100', filter: "En attente d'accord client" },
    { label: 'Pièces', value: kpi.en_attente_piece, icon: Package, color: 'text-violet-600', iconBg: 'bg-violet-100', filter: 'En attente de pièce' },
  ] : [];

  const filterTabs = [
    { label: 'Tous', value: '' },
    { label: 'Diagnostic', value: 'En attente de diagnostic' },
    { label: 'Réparation', value: 'En cours de réparation' },
    { label: 'Accord', value: "En attente d'accord client" },
    { label: 'Pièces', value: 'En attente de pièce' },
    { label: 'Pièce reçue', value: 'Pièce reçue' },
    { label: 'Terminés', value: 'Réparation terminée' },
    { label: 'Rendus', value: 'Rendu au client' },
    { label: 'Clôturés', value: 'Clôturé' },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-slate-900 tracking-tight">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">Vue d'ensemble des réparations</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setRefreshKey(k => k + 1)} className="btn-ghost p-2.5" title="Rafraîchir">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => navigate('/client')} className="btn-primary">
            <Plus className="w-4 h-4" /> Nouveau ticket
          </button>
        </div>
      </div>

      {/* KPI Grid — 5 cards cliquables */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {kpiCards.map(({ label, value, icon: Icon, color, iconBg, filter }, i) => (
          <button key={label}
            onClick={() => handleKpiClick(filter, i)}
            className={`card p-4 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 animate-in text-left
              ${activeKpi === i ? 'ring-2 ring-brand-500 shadow-lg shadow-brand-500/10' : ''}`}
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center mb-3`}>
              <Icon className={`w-4 h-4 ${color}`} />
            </div>
            <p className="text-2xl font-bold text-slate-900 tracking-tight">{value}</p>
            <p className="text-[11px] text-slate-500 font-medium mt-0.5 leading-tight">{label}</p>
          </button>
        ))}
      </div>

      {/* Search & Filters */}
      <div className="card overflow-hidden mb-6">
        <div className="p-3 sm:p-4 border-b border-slate-100">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" placeholder="Rechercher par nom, téléphone, code ticket, technicien..."
              value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 bg-slate-50/50 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 focus:bg-white transition-all"
            />
          </div>
        </div>
        <div className="px-3 sm:px-4 py-2 flex gap-1 overflow-x-auto scrollbar-none bg-slate-50/50">
          {filterTabs.map(({ label, value }) => (
            <button key={value} onClick={() => { setFilterStatut(value); setActiveKpi(null); setShowArchived(['Rendu au client', 'Clôturé'].includes(value)); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all
                ${filterStatut === value
                  ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/25'
                  : 'text-slate-500 hover:bg-white hover:text-slate-700 hover:shadow-sm'
                }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Counters */}
      <div className="flex items-center justify-between mb-3 px-1">
        <button onClick={() => setShowArchived(false)}
          className={`text-sm font-medium ${!showArchived ? 'text-brand-600' : 'text-slate-400 hover:text-slate-600'}`}>
          {activeTickets.length} actif(s)
        </button>
        <button onClick={() => setShowArchived(true)}
          className={`text-sm font-medium ${showArchived ? 'text-brand-600' : 'text-slate-400 hover:text-slate-600'}`}>
          Voir {archivedTickets.length} archivé(s)
        </button>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="hidden lg:grid grid-cols-[80px_1fr_140px_100px_160px_80px_90px_80px_28px] gap-2 items-center px-5 py-3 bg-slate-50/80 border-b border-slate-100">
          <span className="table-header">Ticket</span>
          <span className="table-header">Client</span>
          <span className="table-header">Appareil</span>
          <span className="table-header">Tech</span>
          <span className="table-header">Statut</span>
          <span className="table-header">Date</span>
          <span className="table-header">Contact</span>
          <span className="table-header text-right">Prix</span>
          <span></span>
        </div>

        {loading && tickets.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-8 h-8 border-2 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-400">Chargement...</p>
          </div>
        ) : displayedTickets.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
              <Smartphone className="w-7 h-7 text-slate-300" />
            </div>
            <p className="text-slate-500 font-medium">Aucun ticket trouvé</p>
            <p className="text-sm text-slate-400 mt-1">Modifiez vos filtres ou créez un nouveau ticket</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100/80">
            {displayedTickets.map((t) => (
              <div key={t.id}
                className="lg:grid lg:grid-cols-[80px_1fr_140px_100px_160px_80px_90px_80px_28px] gap-2 items-center px-4 sm:px-5 py-3 hover:bg-brand-50/40 transition-colors group"
              >
                {/* Ticket code */}
                <div className="cursor-pointer" onClick={() => navigate(`${basePath}/ticket/${t.id}`)}>
                  <p className="text-xs font-bold text-brand-600 font-mono">{t.ticket_code}</p>
                </div>

                {/* Client */}
                <div className="min-w-0 mt-1 lg:mt-0 cursor-pointer" onClick={() => navigate(`${basePath}/ticket/${t.id}`)}>
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
                      <span className="text-brand-700 font-bold text-[10px]">
                        {(t.client_prenom?.[0] || '').toUpperCase()}{(t.client_nom?.[0] || '').toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">
                        {t.client_prenom || ''} {t.client_nom || ''}
                      </p>
                      <p className="text-[11px] text-slate-400 font-mono truncate">{t.client_tel || ''}</p>
                    </div>
                  </div>
                </div>

                {/* Appareil */}
                <div className="hidden lg:block cursor-pointer" onClick={() => navigate(`${basePath}/ticket/${t.id}`)}>
                  <p className="text-xs text-slate-700 font-medium truncate">{t.marque} {t.modele || t.modele_autre}</p>
                  <p className="text-[11px] text-slate-400 truncate">{t.panne}</p>
                </div>

                {/* Tech */}
                <div className="hidden lg:block cursor-pointer" onClick={() => navigate(`${basePath}/ticket/${t.id}`)}>
                  <p className="text-xs text-slate-600 truncate">{t.technicien_assigne || '—'}</p>
                </div>

                {/* Statut */}
                <div className="mt-2 lg:mt-0 cursor-pointer" onClick={() => navigate(`${basePath}/ticket/${t.id}`)}>
                  <StatusBadge statut={t.statut} />
                </div>

                {/* Date */}
                <div className="hidden lg:block cursor-pointer" onClick={() => navigate(`${basePath}/ticket/${t.id}`)}>
                  <p className="text-[11px] text-slate-500">{formatDateShort(t.date_depot)}</p>
                </div>

                {/* Contact icons */}
                <div className="hidden lg:flex items-center gap-1">
                  {t.client_tel && (
                    <a href={waLink(t.client_tel, `Bonjour, concernant votre ticket ${t.ticket_code}...`)}
                      target="_blank" rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="p-1.5 rounded-md hover:bg-green-50 transition-colors" title="WhatsApp">
                      <MessageCircle className="w-3.5 h-3.5 text-green-500" />
                    </a>
                  )}
                  {t.client_tel && (
                    <a href={smsLink(t.client_tel, `Klikphone: Votre ticket ${t.ticket_code}...`)}
                      onClick={e => e.stopPropagation()}
                      className="p-1.5 rounded-md hover:bg-blue-50 transition-colors" title="SMS">
                      <Send className="w-3.5 h-3.5 text-blue-500" />
                    </a>
                  )}
                  {t.client_email && (
                    <a href={`mailto:${t.client_email}`}
                      onClick={e => e.stopPropagation()}
                      className="p-1.5 rounded-md hover:bg-violet-50 transition-colors" title="Email">
                      <Mail className="w-3.5 h-3.5 text-violet-500" />
                    </a>
                  )}
                </div>

                {/* Prix */}
                <div className="hidden lg:block text-right cursor-pointer" onClick={() => navigate(`${basePath}/ticket/${t.id}`)}>
                  {(t.devis_estime || t.tarif_final) ? (
                    <p className="text-xs font-semibold text-slate-800">{formatPrix(t.tarif_final || t.devis_estime)}</p>
                  ) : (
                    <p className="text-xs text-slate-300">—</p>
                  )}
                </div>

                {/* Arrow */}
                <div className="hidden lg:flex justify-end cursor-pointer" onClick={() => navigate(`${basePath}/ticket/${t.id}`)}>
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
