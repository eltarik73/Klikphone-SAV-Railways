import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import StatusBadge from '../components/StatusBadge';
import { formatDateShort, formatPrix, waLink, smsLink, STATUTS } from '../lib/utils';
import {
  Search, Plus, RefreshCw, AlertTriangle,
  Wrench, CheckCircle2, Package, ChevronRight, ChevronDown, ChevronLeft,
  Smartphone, MessageCircle, Send, Mail, Lock, Shield,
  SquareCheck, Square, X, Filter,
} from 'lucide-react';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const basePath = user?.target === 'tech' ? '/tech' : '/accueil';

  const [kpi, setKpi] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterStatut, setFilterStatut] = useState('');
  const [activeKpi, setActiveKpi] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [techColors, setTechColors] = useState({});
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkStatus, setBulkStatus] = useState('');
  const [showBulkMenu, setShowBulkMenu] = useState(false);
  const [filterTech, setFilterTech] = useState('');
  const [teamList, setTeamList] = useState([]);
  const [pageSize, setPageSize] = useState(() => parseInt(localStorage.getItem('kp_page_size') || '50'));
  const [page, setPage] = useState(0);
  const searchTimer = useRef(null);

  // Debounced search (300ms)
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 200 };
      if (debouncedSearch) params.search = debouncedSearch;
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
  }, [debouncedSearch, filterStatut, refreshKey]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    api.getActiveTeam()
      .then(members => {
        const map = {};
        members.forEach(m => { if (m.couleur) map[m.nom] = m.couleur; });
        setTechColors(map);
        setTeamList(members);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setRefreshKey(k => k + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === displayedTickets.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayedTickets.map(t => t.id)));
    }
  };

  const handleBulkStatus = async (statut) => {
    if (selectedIds.size === 0) return;
    try {
      await Promise.all([...selectedIds].map(id => api.changeStatus(id, statut)));
      setSelectedIds(new Set());
      setShowBulkMenu(false);
      setRefreshKey(k => k + 1);
    } catch (err) {
      console.error(err);
    }
  };

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

  // For tech view: filter by assigned tech
  const isTech = user?.target === 'tech';
  const techName = user?.utilisateur;

  let filteredTickets = tickets;

  // If a specific tech is selected in the dropdown, use that filter
  if (filterTech) {
    console.log('[TechFilter] filterTech =', JSON.stringify(filterTech));
    filteredTickets = tickets.filter(t => {
      const assigned = (t.technicien_assigne || '').trim();
      const match = assigned === filterTech.trim();
      if (!match && assigned) {
        console.log('[TechFilter] NO MATCH:', JSON.stringify(assigned), '!==', JSON.stringify(filterTech));
      }
      return match;
    });
  } else if (isTech && techName && !debouncedSearch) {
    // Default tech view: show own tickets + unassigned
    filteredTickets = tickets.filter(t => {
      const assigned = (t.technicien_assigne || '').trim();
      return assigned === techName.trim() || !assigned;
    });
  }

  const activeTickets = filteredTickets.filter(t => !['Clôturé', 'Rendu au client'].includes(t.statut));
  const archivedTickets = filteredTickets.filter(t => ['Clôturé', 'Rendu au client'].includes(t.statut));
  const allDisplayed = showArchived ? archivedTickets : activeTickets;
  const totalPages = Math.ceil(allDisplayed.length / pageSize);
  const displayedTickets = allDisplayed.slice(page * pageSize, (page + 1) * pageSize);

  const handlePageSizeChange = (size) => {
    setPageSize(size);
    setPage(0);
    localStorage.setItem('kp_page_size', size.toString());
  };

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
          <h1 className="text-2xl font-display font-bold text-slate-900 tracking-tight">
            {user?.target === 'tech' ? 'Espace Technicien' : 'Tableau de bord'}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {user?.target === 'tech'
              ? `Bienvenue ${user?.utilisateur || ''} — vos réparations`
              : 'Vue d\'ensemble des réparations'}
          </p>
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
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="text" placeholder="Rechercher par nom, téléphone, code ticket..."
                value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 bg-slate-50/50 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 focus:bg-white transition-all"
              />
            </div>
            {teamList.length > 0 && (
              <select value={filterTech} onChange={e => { setFilterTech(e.target.value); setPage(0); }}
                className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50/50 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 min-w-[140px]">
                <option value="">{isTech ? 'Mes tickets' : 'Tous les techs'}</option>
                {teamList.map(m => (
                  <option key={m.id} value={m.nom}>{m.nom}</option>
                ))}
              </select>
            )}
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

      {/* Bulk actions bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2.5 bg-brand-50 border border-brand-200 rounded-xl animate-in">
          <span className="text-sm font-semibold text-brand-700">{selectedIds.size} sélectionné(s)</span>
          <div className="relative ml-auto">
            <button onClick={() => setShowBulkMenu(!showBulkMenu)}
              className="btn-primary text-xs px-3 py-1.5">
              Changer statut <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {showBulkMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowBulkMenu(false)} />
                <div className="absolute right-0 top-full mt-1 w-64 card p-1.5 shadow-xl z-50 animate-in">
                  {STATUTS.map(s => (
                    <button key={s} onClick={() => handleBulkStatus(s)}
                      className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-slate-50 text-slate-700 transition-colors">
                      {s}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button onClick={() => setSelectedIds(new Set())} className="btn-ghost p-1.5">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="hidden lg:grid grid-cols-[28px_80px_1fr_140px_100px_160px_80px_90px_80px_28px] gap-2 items-center px-5 py-3 bg-slate-50/80 border-b border-slate-100">
          <button onClick={toggleSelectAll} className="flex items-center justify-center">
            {selectedIds.size === displayedTickets.length && displayedTickets.length > 0
              ? <SquareCheck className="w-4 h-4 text-brand-600" />
              : <Square className="w-4 h-4 text-slate-300" />}
          </button>
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
                className="lg:grid lg:grid-cols-[28px_80px_1fr_140px_100px_160px_80px_90px_80px_28px] gap-2 items-center px-4 sm:px-5 py-3 hover:bg-brand-50/40 transition-colors group"
              >
                {/* Checkbox */}
                <div className="hidden lg:flex items-center justify-center">
                  <button onClick={() => toggleSelect(t.id)}>
                    {selectedIds.has(t.id)
                      ? <SquareCheck className="w-4 h-4 text-brand-600" />
                      : <Square className="w-4 h-4 text-slate-300 group-hover:text-slate-400" />}
                  </button>
                </div>

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
                  {isTech && (t.pin || t.pattern) && (
                    <div className="flex items-center gap-2 mt-0.5">
                      {t.pin && (
                        <span className="text-[10px] font-mono text-amber-600 flex items-center gap-0.5">
                          <Lock className="w-2.5 h-2.5" /> {t.pin}
                        </span>
                      )}
                      {t.pattern && (
                        <span className="text-[10px] font-mono text-violet-600 flex items-center gap-0.5">
                          <Shield className="w-2.5 h-2.5" /> {t.pattern}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Tech */}
                <div className="hidden lg:block cursor-pointer" onClick={() => navigate(`${basePath}/ticket/${t.id}`)}>
                  <div className="flex items-center gap-1.5">
                    {t.technicien_assigne && techColors[t.technicien_assigne] && (
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: techColors[t.technicien_assigne] }} />
                    )}
                    <p className="text-xs text-slate-600 truncate">{t.technicien_assigne || '—'}</p>
                  </div>
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
                <div className="flex items-center gap-1 mt-2 lg:mt-0">
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

        {/* Pagination */}
        {allDisplayed.length > pageSize && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">
                {page * pageSize + 1}–{Math.min((page + 1) * pageSize, allDisplayed.length)} sur {allDisplayed.length}
              </span>
              <select value={pageSize} onChange={e => handlePageSizeChange(Number(e.target.value))}
                className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white text-slate-600">
                {[10, 25, 50, 100].map(n => (
                  <option key={n} value={n}>{n} / page</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                <ChevronLeft className="w-4 h-4 text-slate-600" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => (
                <button key={i} onClick={() => setPage(i)}
                  className={`w-7 h-7 rounded-md text-xs font-medium transition-colors ${
                    i === page ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-100'
                  }`}>
                  {i + 1}
                </button>
              )).slice(Math.max(0, page - 2), page + 3)}
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                <ChevronRight className="w-4 h-4 text-slate-600" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
