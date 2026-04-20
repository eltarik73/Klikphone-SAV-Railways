import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import { useApi, invalidateCache, prefetch } from '../hooks/useApi';
import { formatDateShort, formatPrix, waLink, smsLink, STATUTS, getStatusConfig } from '../lib/utils';
import {
  Search, Plus, RefreshCw, AlertTriangle,
  Wrench, CheckCircle2, Package, ChevronRight, ChevronDown, ChevronLeft,
  Smartphone, MessageCircle, Send, Mail, Lock, Shield,
  SquareCheck, Square, X, Filter, Calendar, RotateCcw, Globe, Star,
  TrendingUp, Clock, Euro, Percent, Sparkles, Maximize2, Minimize2, Inbox,
} from 'lucide-react';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const basePath = user?.target === 'tech' ? '/tech' : '/accueil';

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterStatut, setFilterStatut] = useState('');
  const [activeKpi, setActiveKpi] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkStatus, setBulkStatus] = useState('');
  const [showBulkMenu, setShowBulkMenu] = useState(false);
  const [filterTech, setFilterTech] = useState('');
  const [interactionFilter, setInteractionFilter] = useState(null); // 'accord_client' | 'messages' | 'avis' | null
  const [pageSize, setPageSize] = useState(() => parseInt(localStorage.getItem('kp_page_size') || '50'));
  const [sortField, setSortField] = useState('date_depot');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(0);
  const [compactMode, setCompactMode] = useState(() => localStorage.getItem('kp_compact_mode') === '1');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const searchTimer = useRef(null);

  const toggleCompact = () => {
    setCompactMode(prev => {
      const next = !prev;
      localStorage.setItem('kp_compact_mode', next ? '1' : '0');
      return next;
    });
  };

  // Debounced search (300ms)
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  // SWR: Dashboard data (KPI + tickets)
  const dashKey = useMemo(() => {
    const parts = ['dashboard'];
    if (debouncedSearch) parts.push(`s:${debouncedSearch}`);
    if (filterStatut) parts.push(`f:${filterStatut}`);
    return parts.join(':');
  }, [debouncedSearch, filterStatut]);

  const { data: dashData, loading, isRevalidating, mutate } = useApi(
    dashKey,
    () => {
      const params = { limit: 200 };
      if (debouncedSearch) params.search = debouncedSearch;
      if (filterStatut) params.statut = filterStatut;
      return api.getDashboard(params);
    },
    { tags: ['dashboard', 'tickets'], ttl: 45_000 }
  );
  const kpi = dashData?.kpi ?? null;
  const tickets = dashData?.tickets ?? [];

  // SWR: Team members
  const { data: teamData } = useApi('team:active', () => api.getActiveTeam(), { tags: ['team'], ttl: 300_000 });
  const teamList = teamData ?? [];
  const techColors = useMemo(() => {
    const map = {};
    teamList.forEach(m => { if (m.couleur) map[m.nom] = m.couleur; });
    return map;
  }, [teamList]);

  // Prefetch frequent pages on mount
  useEffect(() => {
    prefetch('clients:p:0:20', () => api.getClients({ limit: 20, offset: 0 }), { tags: ['clients'], ttl: 60_000 });
    prefetch('tarifs', () => Promise.all([api.getTarifs(), api.getTarifsStats(), api.getAppleDevices()]).then(([t, s, a]) => ({ tarifs: t, stats: s, appleDevices: a })), { tags: ['tarifs'], ttl: 300_000 });
    prefetch('config:main', () => api.getConfig(), { tags: ['config'], ttl: 300_000 });
  }, []);

  // Auto-refresh every 60s, only when tab is visible
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;
  useEffect(() => {
    let id;
    const start = () => { clearInterval(id); id = setInterval(() => mutateRef.current(), 60_000); };
    const stop = () => clearInterval(id);
    const onVisibility = () => document.hidden ? stop() : start();
    document.addEventListener('visibilitychange', onVisibility);
    start();
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);

  // SWR: Interactions clients
  const { data: interactions } = useApi('dashboard:interactions', () => api.getInteractions(), { tags: ['interactions'], ttl: 30_000 });

  // Build lookup: ticket_id → { accord_client, messages, avis } booleans
  const ticketInteractions = useMemo(() => {
    if (!interactions) return {};
    const map = {};
    for (const key of ['accord_client', 'messages', 'avis']) {
      const ids = interactions[key]?.ticket_ids;
      if (!Array.isArray(ids)) continue;
      for (const tid of ids) {
        if (!map[tid]) map[tid] = {};
        map[tid][key] = true;
      }
    }
    return map;
  }, [interactions]);

  // Build set of ticket IDs for active interaction filter
  const interactionTicketIds = useMemo(() => {
    if (!interactionFilter || !interactions) return null;
    const ids = interactions[interactionFilter]?.ticket_ids;
    return Array.isArray(ids) && ids.length > 0 ? new Set(ids) : null;
  }, [interactionFilter, interactions]);

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
      invalidateCache('tickets', 'dashboard');
    } catch (err) {
      console.error(err);
    }
  };

  const handleInlineStatus = async (ticketId, newStatut) => {
    try {
      await api.changeStatus(ticketId, newStatut);
      mutate(prev => prev ? {
        ...prev, tickets: prev.tickets.map(t => t.id === ticketId ? { ...t, statut: newStatut } : t),
      } : prev);
    } catch (err) {
      console.error(err);
    }
  };

  const handleInlineTech = (ticketId, newTech) => {
    // Optimistic update first
    mutate(prev => prev ? {
      ...prev, tickets: prev.tickets.map(t => t.id === ticketId ? { ...t, technicien_assigne: newTech || null } : t),
    } : prev, { revalidate: false });
    api.updateTicket(ticketId, { technicien_assigne: newTech || null })
      .catch(err => {
        console.error(err);
        mutate(); // Rollback: refetch from server
      });
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

  // Match tech name: handles both "Marina" and "Marina (Technicien Apple)" formats
  const matchTech = (assigned, name) => {
    if (!assigned || !name) return false;
    const a = assigned.trim();
    const n = name.trim();
    return a === n || a.startsWith(n + ' ');
  };

  // Find tech color for an assignment (handles "Name (Role)" format)
  const getTechColor = (assigned) => {
    if (!assigned) return null;
    const direct = techColors[assigned];
    if (direct) return direct;
    for (const [name, color] of Object.entries(techColors)) {
      if (matchTech(assigned, name)) return color;
    }
    return null;
  };

  const filteredTickets = useMemo(() => {
    let list = tickets;
    if (filterTech === '__mine__' && techName) {
      list = list.filter(t =>
        matchTech(t.technicien_assigne, techName) || !t.technicien_assigne
      );
    } else if (filterTech) {
      list = list.filter(t => matchTech(t.technicien_assigne, filterTech));
    }
    if (interactionTicketIds) {
      list = list.filter(t => interactionTicketIds.has(t.id));
    }
    if (dateFrom) {
      const from = new Date(dateFrom);
      list = list.filter(t => t.date_depot && new Date(t.date_depot) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      list = list.filter(t => t.date_depot && new Date(t.date_depot) <= to);
    }
    return list;
  }, [tickets, filterTech, techName, interactionTicketIds, dateFrom, dateTo]);

  // Extra KPIs derived client-side for the enhanced header
  const extraKpis = useMemo(() => {
    const today = new Date();
    const startDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    let todayCount = 0;
    let enAttente = 0;
    let ca = 0;
    let totalClos = 0;
    let reparesOk = 0;
    for (const t of tickets) {
      const dep = t.date_depot ? new Date(t.date_depot).getTime() : 0;
      if (dep >= startDay) todayCount++;
      if (['En attente de diagnostic', "En attente d'accord client", 'En attente de pièce'].includes(t.statut)) enAttente++;
      if (!['Clôturé'].includes(t.statut)) {
        const prix = Number(t.tarif_final || t.devis_estime || 0);
        if (prix > 0) ca += prix;
      }
      if (['Rendu au client', 'Clôturé', 'Réparation terminée'].includes(t.statut)) {
        totalClos++;
        if (t.statut !== 'Irréparable') reparesOk++;
      }
    }
    const taux = totalClos > 0 ? Math.round((reparesOk / totalClos) * 100) : 0;
    return { todayCount, enAttente, ca, taux };
  }, [tickets]);

  const activeTickets = useMemo(() => filteredTickets.filter(t => !['Clôturé', 'Rendu au client'].includes(t.statut)), [filteredTickets]);
  const archivedTickets = useMemo(() => filteredTickets.filter(t => ['Clôturé', 'Rendu au client'].includes(t.statut)), [filteredTickets]);
  const sortedTickets = useMemo(() => {
    const list = showArchived ? archivedTickets : activeTickets;
    return [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'date_depot':
          cmp = new Date(a.date_depot || 0) - new Date(b.date_depot || 0);
          break;
        case 'nom':
          cmp = (`${a.client_nom || ''} ${a.client_prenom || ''}`).localeCompare(`${b.client_nom || ''} ${b.client_prenom || ''}`);
          break;
        case 'date_recuperation': {
          const da = a.date_recuperation ? new Date(a.date_recuperation) : new Date('2099-12-31');
          const db = b.date_recuperation ? new Date(b.date_recuperation) : new Date('2099-12-31');
          cmp = da - db;
          break;
        }
        case 'statut':
          cmp = (a.statut || '').localeCompare(b.statut || '');
          break;
        default:
          cmp = 0;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [showArchived, archivedTickets, activeTickets, sortField, sortDir]);
  const allDisplayed = sortedTickets;
  const totalPages = Math.ceil(allDisplayed.length / pageSize);
  const displayedTickets = allDisplayed.slice(page * pageSize, (page + 1) * pageSize);

  const handlePageSizeChange = (size) => {
    setPageSize(size);
    setPage(0);
    localStorage.setItem('kp_page_size', size.toString());
  };

  // SWR: Commandes en cours count
  const { data: commandesEnCours } = useApi('commandes:en_cours:count', async () => {
    const parts = await api.getParts({ statut: 'en_cours' });
    return parts?.length ?? 0;
  }, { tags: ['commandes'], ttl: 60_000 });

  const kpiCards = kpi ? [
    { label: 'Total actifs', value: kpi.total_actifs, icon: Smartphone, color: 'text-brand-600', iconBg: 'bg-brand-100' },
    { label: 'Diagnostic', value: kpi.en_attente_diagnostic, icon: Search, color: 'text-amber-600', iconBg: 'bg-amber-100', filter: 'En attente de diagnostic' },
    { label: 'Réparation', value: kpi.en_cours, icon: Wrench, color: 'text-blue-600', iconBg: 'bg-blue-100', filter: 'En cours de réparation' },
    { label: 'Accord client', value: kpi.en_attente_accord, icon: AlertTriangle, color: 'text-orange-600', iconBg: 'bg-orange-100', filter: "En attente d'accord client" },
    { label: 'Pièces', value: kpi.en_attente_piece, icon: Package, color: 'text-violet-600', iconBg: 'bg-violet-100', filter: 'En attente de pièce' },
  ] : [];

  // Recovery date countdown helper
  const getRecoveryInfo = (dateStr) => {
    if (!dateStr) return { text: 'Non définie', color: 'text-slate-400', urgent: false };
    // Try to parse various formats
    const now = new Date();
    let target;
    // ISO date
    if (dateStr.includes('-') && dateStr.length >= 10) {
      target = new Date(dateStr);
    } else {
      // Try French format DD/MM/YYYY or free text — skip for free text
      const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (match) {
        target = new Date(`${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`);
      } else {
        return { text: dateStr, color: 'text-slate-500', urgent: false };
      }
    }
    if (isNaN(target.getTime())) return { text: dateStr, color: 'text-slate-500', urgent: false };
    const diffMs = target - now;
    const diffH = Math.round(diffMs / 3600000);
    const diffD = Math.floor(Math.abs(diffH) / 24);
    const remH = Math.abs(diffH) % 24;
    if (diffMs > 0) {
      const label = diffD > 0 ? `dans ${diffD}j ${remH}h` : `dans ${Math.abs(diffH)}h`;
      return { text: label, color: 'text-emerald-600', urgent: false };
    } else {
      const label = diffD > 0 ? `DÉPASSÉ ${diffD}j ${remH}h` : `DÉPASSÉ ${Math.abs(diffH)}h`;
      return { text: label, color: 'text-red-600 font-bold', urgent: true };
    }
  };

  const filterTabs = [
    { label: 'Tous', value: '' },
    { label: 'Pré-enregistré', value: 'Pré-enregistré' },
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
      {/* Local styles: custom scrollbar, stagger, drag handle */}
      <style>{`
        .kp-scroll::-webkit-scrollbar { height: 8px; width: 8px; }
        .kp-scroll::-webkit-scrollbar-track { background: transparent; }
        .kp-scroll::-webkit-scrollbar-thumb { background: linear-gradient(180deg, #c7d2fe, #a5b4fc); border-radius: 9999px; }
        .kp-scroll::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, #a5b4fc, #818cf8); }
        .kp-scroll { scrollbar-width: thin; scrollbar-color: #a5b4fc transparent; }
        .kp-snap-x { scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; }
        .kp-snap-x > * { scroll-snap-align: start; }
        .kp-drag-handle { cursor: grab; }
        .kp-drag-handle:active { cursor: grabbing; }
      `}</style>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <img src="/logo_k.png" alt="" className="w-8 h-8 rounded-lg object-contain shadow-sm hidden sm:block" />
          <div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-slate-900 tracking-tight">
              {user?.target === 'tech'
                ? <>Espace <span className="font-editorial text-brand-600">Technicien</span></>
                : <>Tableau de <span className="font-editorial text-brand-600">bord</span></>}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {user?.target === 'tech'
                ? <>Bienvenue <span className="font-editorial text-brand-500">{user?.utilisateur || ''}</span> — vos réparations</>
                : <>Vue d'ensemble des <span className="font-editorial">réparations</span></>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleCompact} className="btn-ghost p-2.5" title={compactMode ? 'Mode confortable' : 'Mode compact'}>
            {compactMode ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
          </button>
          <button onClick={() => mutate()} className="btn-ghost p-2.5" title="Rafraîchir">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => navigate('/client')} className="btn-primary">
            <Plus className="w-4 h-4" /> Nouveau ticket
          </button>
        </div>
      </motion.div>

      {/* Business KPIs — hero header (snap-scroll on mobile) */}
      <div className="flex lg:grid lg:grid-cols-4 gap-3 mb-4 overflow-x-auto sm:overflow-visible kp-scroll kp-snap-x pb-2 lg:pb-0 -mx-4 px-4 sm:mx-0 sm:px-0">
        {[
          { label: "Tickets aujourd'hui", value: extraKpis.todayCount, icon: Sparkles, gradient: 'from-brand-500 to-indigo-600', accent: 'bg-brand-500/10 text-brand-600' },
          { label: 'En attente', value: extraKpis.enAttente, icon: Clock, gradient: 'from-amber-500 to-orange-600', accent: 'bg-amber-500/10 text-amber-600' },
          { label: 'CA estimé', value: formatPrix(extraKpis.ca), icon: Euro, gradient: 'from-emerald-500 to-teal-600', accent: 'bg-emerald-500/10 text-emerald-600' },
          { label: 'Taux de réparation', value: `${extraKpis.taux}%`, icon: Percent, gradient: 'from-violet-500 to-fuchsia-600', accent: 'bg-violet-500/10 text-violet-600' },
        ].map(({ label, value, icon: Icon, gradient, accent }, i) => (
          <div key={label}
            className="relative overflow-hidden rounded-2xl border border-white/80 bg-white/70 backdrop-blur-md ring-1 ring-slate-200/50 p-4 hover:shadow-xl hover:shadow-brand-500/5 hover:-translate-y-0.5 transition-all duration-300 animate-in shrink-0 w-[240px] lg:w-auto"
            style={{ animationDelay: `${i * 60}ms` }}>
            <div className={`absolute -right-6 -top-6 w-24 h-24 rounded-full bg-gradient-to-br ${gradient} opacity-10 blur-2xl`} />
            <div className="flex items-start justify-between relative">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{label}</p>
                <p className="text-2xl lg:text-3xl font-bold text-slate-900 tracking-tight mt-1 truncate">{value}</p>
              </div>
              <div className={`w-10 h-10 rounded-xl ${accent} flex items-center justify-center shrink-0`}>
                <Icon className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-3 h-1 w-full bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full bg-gradient-to-r ${gradient} rounded-full transition-all`}
                style={{ width: i === 3 ? `${Math.min(100, extraKpis.taux)}%` : '100%' }} />
            </div>
          </div>
        ))}
      </div>

      {/* KPI Grid — 5 cards cliquables */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {!kpi && loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="w-9 h-9 rounded-lg bg-slate-100 mb-3" />
              <div className="h-7 w-12 bg-slate-100 rounded mb-1" />
              <div className="h-3 w-20 bg-slate-100 rounded" />
            </div>
          ))
        ) : kpiCards.map(({ label, value, icon: Icon, color, iconBg, filter }, i) => (
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

      {/* Commandes en cours badge */}
      {commandesEnCours > 0 && (
        <button onClick={() => navigate(`${basePath}/commandes`)}
          className="card px-4 py-3 mb-6 flex items-center gap-3 hover:shadow-md transition-all group w-full text-left">
          <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
            <Package className="w-4 h-4 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800">
              {commandesEnCours} commande{commandesEnCours > 1 ? 's' : ''} de pièces en cours
            </p>
            <p className="text-xs text-slate-400">Cliquez pour voir le détail</p>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-brand-500 transition-colors" />
        </button>
      )}

      {/* Pre-registration banner */}
      {kpi?.pre_enregistres > 0 && (
        <button onClick={() => { setFilterStatut('Pré-enregistré'); setActiveKpi(null); setShowArchived(false); }}
          className="card px-4 py-3 mb-6 flex items-center gap-3 hover:shadow-md transition-all group w-full text-left bg-indigo-50 border border-indigo-200">
          <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
            <Globe className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-indigo-800">
              {kpi.pre_enregistres} dépôt{kpi.pre_enregistres > 1 ? 's' : ''} à distance en attente de validation
            </p>
            <p className="text-xs text-indigo-500">Cliquez pour voir et valider</p>
          </div>
          <ChevronRight className="w-4 h-4 text-indigo-300 group-hover:text-indigo-500 transition-colors" />
        </button>
      )}

      {/* Interactions clients — 3 clickable counters */}
      {interactions && interactions.total_actions > 0 && (
        <div className="card p-4 mb-6 border border-brand-200 bg-brand-50/30">
          <div className="flex items-center gap-2 mb-3">
            <MessageCircle className="w-4 h-4 text-brand-600" />
            <h3 className="text-sm font-semibold text-slate-800">Interactions clients</h3>
            {interactionFilter && (
              <button onClick={() => setInteractionFilter(null)} className="ml-auto text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
                <X className="w-3 h-3" /> Tout afficher
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {interactions.accord_client?.count > 0 && (
              <button onClick={() => setInteractionFilter(interactionFilter === 'accord_client' ? null : 'accord_client')}
                className={`flex items-center gap-2 p-2 rounded-lg border transition-all cursor-pointer ${
                  interactionFilter === 'accord_client' ? 'bg-orange-100 border-orange-400 ring-2 ring-orange-300' : 'bg-orange-50 border-orange-200 hover:border-orange-300'
                }`}>
                <span className="text-lg">📋</span>
                <div className="text-left"><p className="text-sm font-bold text-orange-800">{interactions.accord_client.count}</p><p className="text-[10px] text-orange-600">Accord client</p></div>
              </button>
            )}
            {interactions.messages?.count > 0 && (
              <button onClick={() => setInteractionFilter(interactionFilter === 'messages' ? null : 'messages')}
                className={`flex items-center gap-2 p-2 rounded-lg border transition-all cursor-pointer ${
                  interactionFilter === 'messages' ? 'bg-blue-100 border-blue-400 ring-2 ring-blue-300' : 'bg-blue-50 border-blue-200 hover:border-blue-300'
                }`}>
                <span className="text-lg">💬</span>
                <div className="text-left"><p className="text-sm font-bold text-blue-800">{interactions.messages.count}</p><p className="text-[10px] text-blue-600">Messages non lus</p></div>
              </button>
            )}
            {interactions.avis?.count > 0 && (
              <button onClick={() => setInteractionFilter(interactionFilter === 'avis' ? null : 'avis')}
                className={`flex items-center gap-2 p-2 rounded-lg border transition-all cursor-pointer ${
                  interactionFilter === 'avis' ? 'bg-yellow-100 border-yellow-400 ring-2 ring-yellow-300' : 'bg-yellow-50 border-yellow-200 hover:border-yellow-300'
                }`}>
                <span className="text-lg">⭐</span>
                <div className="text-left"><p className="text-sm font-bold text-yellow-800">{interactions.avis.count}</p><p className="text-[10px] text-yellow-600">Avis reçus</p></div>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Search & Filters */}
      <div className="card overflow-hidden mb-6">
        <div className="p-3 sm:p-4 border-b border-slate-100">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="text" placeholder="Rechercher nom, téléphone, IMEI, code, marque..."
                value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                className="w-full pl-10 pr-9 py-2.5 rounded-lg border border-slate-200 bg-slate-50/50 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 focus:bg-white transition-all"
              />
              {search && (
                <button onClick={() => { setSearch(''); setPage(0); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-slate-200 text-slate-400 hover:text-slate-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50/50 focus-within:ring-2 focus-within:ring-brand-500/20 focus-within:border-brand-500">
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0); }}
                className="bg-transparent text-xs text-slate-700 outline-none w-[120px]" title="Date depuis" />
              <span className="text-slate-300">→</span>
              <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0); }}
                className="bg-transparent text-xs text-slate-700 outline-none w-[120px]" title="Date jusque" />
              {(dateFrom || dateTo) && (
                <button onClick={() => { setDateFrom(''); setDateTo(''); }}
                  className="p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600" title="Réinitialiser dates">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            {teamList.length > 0 && (
              <select value={filterTech} onChange={e => { setFilterTech(e.target.value); setPage(0); }}
                className="px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50/50 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 min-w-[140px]">
                <option value="">Tous les techs</option>
                {isTech && techName && (
                  <option value="__mine__">Mes tickets</option>
                )}
                {teamList.map(m => (
                  <option key={m.id} value={m.nom}>{m.nom}</option>
                ))}
              </select>
            )}
          </div>
        </div>
        <div className="px-3 sm:px-4 py-2 flex gap-1 overflow-x-auto kp-scroll bg-slate-50/50">
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

      {/* Sort controls */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className="text-xs text-slate-400"><Filter className="w-3 h-3 inline mr-1" />Trier par :</span>
        {[
          { label: 'Date dépôt', value: 'date_depot' },
          { label: 'Nom client', value: 'nom' },
          { label: 'Récupération', value: 'date_recuperation' },
          { label: 'Statut', value: 'statut' },
        ].map(({ label, value }) => (
          <button key={value}
            onClick={() => {
              if (sortField === value) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
              else { setSortField(value); setSortDir(value === 'nom' ? 'asc' : 'desc'); }
            }}
            className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
              sortField === value ? 'bg-brand-100 text-brand-700' : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            {label} {sortField === value && (sortDir === 'asc' ? '↑' : '↓')}
          </button>
        ))}
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
        <div className="hidden lg:grid grid-cols-[28px_72px_minmax(120px,1fr)_120px_minmax(100px,1fr)_90px_150px_68px_72px_80px_28px] gap-2 items-center px-5 py-3 bg-slate-50/80 border-b border-slate-100">
          <button onClick={toggleSelectAll} className="flex items-center justify-center">
            {selectedIds.size === displayedTickets.length && displayedTickets.length > 0
              ? <SquareCheck className="w-4 h-4 text-brand-600" />
              : <Square className="w-4 h-4 text-slate-300" />}
          </button>
          <span className="table-header">Ticket</span>
          <span className="table-header">Client</span>
          <span className="table-header">Appareil</span>
          <span className="table-header">Panne</span>
          <span className="table-header">Tech</span>
          <span className="table-header">Statut</span>
          <span className="table-header">Date</span>
          <span className="table-header">Contact</span>
          <span className="table-header text-right">Prix</span>
          <span></span>
        </div>

        {loading && tickets.length === 0 ? (
          <div className="divide-y divide-slate-100/80">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="px-5 py-3.5 animate-pulse flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-slate-100 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 bg-slate-100 rounded" />
                  <div className="h-3 w-48 bg-slate-100 rounded" />
                </div>
                <div className="hidden lg:block h-6 w-20 bg-slate-100 rounded-lg" />
                <div className="hidden lg:block h-6 w-28 bg-slate-100 rounded-lg" />
              </div>
            ))}
          </div>
        ) : displayedTickets.length === 0 ? (
          <div className="py-20 text-center animate-in">
            <div className="relative w-20 h-20 mx-auto mb-5">
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-brand-100 to-indigo-100 blur-xl opacity-60" />
              <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-brand-50 to-indigo-50 border border-brand-100 flex items-center justify-center">
                <Inbox className="w-9 h-9 text-brand-400" />
              </div>
            </div>
            <p className="text-slate-700 font-semibold text-base">Aucun ticket trouvé</p>
            <p className="text-sm text-slate-400 mt-1.5 max-w-xs mx-auto">
              {search || dateFrom || dateTo || filterStatut || filterTech
                ? 'Essayez d\'ajuster vos filtres pour voir plus de résultats.'
                : 'C\'est le calme ! Créez un nouveau ticket pour démarrer.'}
            </p>
            <button onClick={() => navigate('/client')}
              className="btn-primary mt-5 inline-flex items-center gap-1.5 text-sm">
              <Plus className="w-4 h-4" /> Nouveau ticket
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100/80">
            {displayedTickets.map((t, rowIdx) => (
              <div key={t.id}
                className={`lg:grid lg:grid-cols-[28px_72px_minmax(120px,1fr)_120px_minmax(100px,1fr)_90px_150px_68px_72px_80px_28px] gap-2 items-center px-4 sm:px-5 ${compactMode ? 'py-2' : 'py-3'} hover:bg-brand-50/40 hover:shadow-[inset_3px_0_0_0] hover:shadow-brand-500 transition-all duration-200 group relative animate-in`}
                style={{ animationDelay: `${Math.min(rowIdx * 25, 400)}ms`, borderLeft: `3px solid transparent`, borderLeftColor: 'transparent' }}
                onMouseEnter={(e) => { e.currentTarget.style.borderLeftColor = getStatusConfig(t.statut).color; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderLeftColor = 'transparent'; }}
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
                  <div className="flex items-center gap-1">
                    {t.attention && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" title="Attention" />}
                    <p className="text-xs font-bold text-brand-600 font-mono">{t.ticket_code}</p>
                    {t.est_retour_sav && (
                      <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-600 text-[9px] font-bold flex items-center gap-0.5" title="Retour SAV">
                        <RotateCcw className="w-2.5 h-2.5" /> SAV
                      </span>
                    )}
                    {t.source === 'distance' && (
                      <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-600 text-[9px] font-bold flex items-center gap-0.5" title="Dépôt à distance">
                        <Globe className="w-2.5 h-2.5" /> Dist.
                      </span>
                    )}
                    {ticketInteractions[t.id]?.accord_client && (
                      <span className="w-4 h-4 rounded-full bg-orange-500 text-white text-[8px] font-bold flex items-center justify-center" title="Accord client en attente">📋</span>
                    )}
                    {ticketInteractions[t.id]?.messages && (
                      <span className="w-4 h-4 rounded-full bg-blue-500 text-white text-[8px] font-bold flex items-center justify-center" title="Message client non lu">💬</span>
                    )}
                    {ticketInteractions[t.id]?.avis && (
                      <span className="w-4 h-4 rounded-full bg-yellow-400 text-white text-[8px] font-bold flex items-center justify-center" title="Avis client">⭐</span>
                    )}
                  </div>
                </div>

                {/* Client */}
                <div className="min-w-0 mt-1 lg:mt-0 cursor-pointer" onClick={() => navigate(`${basePath}/ticket/${t.id}`)}>
                  <div className="flex items-center gap-2">
                    <div className={`${compactMode ? 'w-6 h-6' : 'w-7 h-7'} rounded-full bg-gradient-to-br from-brand-100 to-indigo-100 flex items-center justify-center shrink-0 ring-2 ring-white shadow-sm group-hover:scale-110 transition-transform duration-200`}>
                      <span className="text-brand-700 font-bold text-[10px]">
                        {(t.client_prenom?.[0] || '').toUpperCase()}{(t.client_nom?.[0] || '').toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 truncate tracking-tight" title={`${t.client_prenom || ''} ${t.client_nom || ''}`.trim()}>
                        {t.client_prenom || ''} {t.client_nom || ''}
                        {t.client_carte_camby ? <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[9px] font-bold align-middle">🎫 Camby</span> : null}
                      </p>
                      <p className="text-[11px] text-slate-400 font-mono truncate" title={t.client_tel || ''}>{t.client_tel || ''}</p>
                    </div>
                  </div>
                </div>

                {/* Appareil */}
                <div className="hidden lg:block cursor-pointer" onClick={() => navigate(`${basePath}/ticket/${t.id}`)}>
                  <p className="text-xs text-slate-700 font-medium truncate" title={`${t.marque || ''} ${t.modele || t.modele_autre || ''}`.trim()}>{t.marque} {t.modele || t.modele_autre}</p>
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

                {/* Panne */}
                <div className="hidden lg:block cursor-pointer" onClick={() => navigate(`${basePath}/ticket/${t.id}`)}>
                  {t.commande_piece === 1 && !t.panne && (() => {
                    let reps = [];
                    try {
                      const parsed = JSON.parse(t.reparation_supp || '[]');
                      if (Array.isArray(parsed)) reps = parsed.filter(r => r.label).map(r => r.label);
                    } catch { /* ignore */ }
                    return reps.length === 0;
                  })() ? (
                    <p className="text-xs text-amber-600 font-medium truncate flex items-center gap-1">
                      <Package className="w-3 h-3 shrink-0" /> Pièce à commander
                    </p>
                  ) : (() => {
                    let reps = [];
                    try {
                      const parsed = JSON.parse(t.reparation_supp || '[]');
                      if (Array.isArray(parsed)) reps = parsed.filter(r => r.label).map(r => r.label);
                    } catch { /* ignore */ }
                    if (reps.length === 0 && t.panne) reps = [t.panne];
                    return (
                      <p className="text-xs text-slate-600 truncate flex items-center gap-1" title={reps.join(' + ')}>
                        {t.commande_piece === 1 && <Package className="w-3 h-3 shrink-0 text-amber-500" />}
                        <span className="truncate">{reps.join(' + ') || '—'}</span>
                      </p>
                    );
                  })()}
                </div>

                {/* Tech — inline dropdown */}
                <div className="hidden lg:block" onClick={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()}>
                  <select
                    value={t.technicien_assigne || ''}
                    onChange={e => { const val = e.target.value; handleInlineTech(t.id, val); }}
                    className="w-full py-1.5 px-2 text-[11px] font-medium rounded-lg border cursor-pointer bg-no-repeat truncate transition-colors"
                    style={{
                      WebkitAppearance: 'none',
                      appearance: 'none',
                      borderColor: t.technicien_assigne ? (getTechColor(t.technicien_assigne) || '#94a3b8') : '#e2e8f0',
                      color: t.technicien_assigne ? '#334155' : '#94a3b8',
                      backgroundColor: t.technicien_assigne && getTechColor(t.technicien_assigne) ? getTechColor(t.technicien_assigne) + '15' : '#f8fafc',
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                      backgroundPosition: 'right 4px center',
                      backgroundSize: '12px',
                      paddingRight: '20px',
                    }}
                  >
                    <option value="">— Aucun</option>
                    {teamList.map(m => (
                      <option key={m.id} value={m.nom}>{m.nom}</option>
                    ))}
                  </select>
                </div>

                {/* Statut — inline dropdown */}
                <div className="mt-2 lg:mt-0" onClick={e => e.stopPropagation()}>
                  <select
                    value={t.statut}
                    onChange={e => handleInlineStatus(t.id, e.target.value)}
                    className="w-full py-1.5 px-2 text-[11px] font-semibold rounded-lg border-2 cursor-pointer appearance-none bg-no-repeat truncate"
                    style={{
                      borderColor: getStatusConfig(t.statut).color,
                      color: getStatusConfig(t.statut).color,
                      backgroundColor: getStatusConfig(t.statut).color + '10',
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='${encodeURIComponent(getStatusConfig(t.statut).color)}' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                      backgroundPosition: 'right 4px center',
                      backgroundSize: '14px',
                      paddingRight: '22px',
                    }}
                  >
                    {STATUTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                {/* Date */}
                <div className="hidden lg:block cursor-pointer" onClick={() => navigate(`${basePath}/ticket/${t.id}`)}>
                  <p className="text-[11px] text-slate-500">{formatDateShort(t.date_depot)}</p>
                  {t.date_recuperation && (() => {
                    const ri = getRecoveryInfo(t.date_recuperation);
                    return (
                      <p className={`text-[10px] flex items-center gap-0.5 mt-0.5 ${ri.color}`}>
                        <Calendar className="w-2.5 h-2.5" /> {ri.text}
                      </p>
                    );
                  })()}
                </div>

                {/* Contact icons — colored if message sent via that channel */}
                <div className="flex items-center gap-1 mt-2 lg:mt-0">
                  <a href={t.client_tel ? waLink(t.client_tel, `Bonjour, concernant votre ticket ${t.ticket_code}...`) : '#'}
                    target="_blank" rel="noopener noreferrer"
                    onClick={e => { if (!t.client_tel) e.preventDefault(); e.stopPropagation(); }}
                    className="p-1.5 rounded-md hover:bg-green-50 transition-colors" title="WhatsApp">
                    <MessageCircle className={`w-3.5 h-3.5 ${t.msg_whatsapp ? 'text-green-500' : 'text-slate-300'}`} />
                  </a>
                  <a href={t.client_tel ? smsLink(t.client_tel, `Klikphone: Votre ticket ${t.ticket_code}...`) : '#'}
                    onClick={e => { if (!t.client_tel) e.preventDefault(); e.stopPropagation(); }}
                    className="p-1.5 rounded-md hover:bg-blue-50 transition-colors" title="SMS">
                    <Send className={`w-3.5 h-3.5 ${t.msg_sms ? 'text-blue-500' : 'text-slate-300'}`} />
                  </a>
                  <a href={t.client_email ? `mailto:${t.client_email}` : '#'}
                    onClick={e => { if (!t.client_email) e.preventDefault(); e.stopPropagation(); }}
                    className="p-1.5 rounded-md hover:bg-amber-50 transition-colors" title="Email">
                    <Mail className={`w-3.5 h-3.5 ${t.msg_email ? 'text-amber-500' : 'text-slate-300'}`} />
                  </a>
                </div>

                {/* Prix */}
                <div className="hidden lg:block text-right cursor-pointer" onClick={() => navigate(`${basePath}/ticket/${t.id}`)}>
                  {(t.devis_estime || t.tarif_final) ? (
                    <>
                      <p className={`text-xs font-semibold ${t.paye ? 'text-emerald-600' : 'text-slate-800'}`}>
                        {formatPrix(t.tarif_final || t.devis_estime)}
                      </p>
                      {t.paye ? (
                        <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-700">PAYÉ</span>
                      ) : t.acompte > 0 ? (
                        <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-700">Ac. {formatPrix(t.acompte)}</span>
                      ) : (
                        <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-orange-100 text-orange-600">Non payé</span>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-slate-300">—</p>
                  )}
                </div>

                {/* Drag handle + arrow */}
                <div className="hidden lg:flex items-center justify-end gap-1">
                  <div className="kp-drag-handle opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-0.5 px-1 py-0.5 rounded hover:bg-slate-100" title="Glisser pour déplacer">
                    <span className="block w-0.5 h-0.5 bg-slate-400 rounded-full" />
                    <span className="block w-0.5 h-0.5 bg-slate-400 rounded-full" />
                    <span className="block w-0.5 h-0.5 bg-slate-400 rounded-full" />
                    <span className="block w-0.5 h-0.5 bg-slate-400 rounded-full" />
                    <span className="block w-0.5 h-0.5 bg-slate-400 rounded-full" />
                    <span className="block w-0.5 h-0.5 bg-slate-400 rounded-full" />
                  </div>
                  <button className="p-0.5 rounded cursor-pointer" onClick={() => navigate(`${basePath}/ticket/${t.id}`)}>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-brand-500 group-hover:translate-x-0.5 transition-all" />
                  </button>
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
