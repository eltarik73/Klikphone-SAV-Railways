import { useState, useEffect, useRef, useMemo, useCallback, useTransition, useId, Fragment } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import { useApi, invalidateCache, prefetch } from '../hooks/useApi';
import { usePolling } from '../hooks/usePolling';
import { formatDateShort, formatPrix, waLink, smsLink, STATUTS, getStatusConfig } from '../lib/utils';
import { ARCHIVE_STATUTS, detectQueryKind, openSearchPalette } from '../components/SearchPalette';
import { openQuickScan } from '../components/ScanListener';
import { useToast } from '../components/Toast';
import {
  Search, Plus, RefreshCw, AlertTriangle,
  Wrench, CheckCircle2, Package, ChevronRight, ChevronDown, ChevronLeft,
  Smartphone, MessageCircle, Send, Mail, Lock, Shield,
  SquareCheck, Square, X, Filter, Calendar, RotateCcw, Globe, Star,
  Clock, Euro, Sparkles, Maximize2, Minimize2, Inbox,
} from 'lucide-react';

// Filtres conservés le temps de l'onglet (retour depuis une fiche ticket)
const DASH_STATE_KEY = 'kp_dashboard_filters';

function readDashState() {
  try {
    const raw = sessionStorage.getItem(DASH_STATE_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function writeDashState(v) {
  try {
    sessionStorage.setItem(DASH_STATE_KEY, JSON.stringify(v));
  } catch { /* stockage indisponible : filtres non conservés */ }
}

const str = (v) => (typeof v === 'string' ? v : '');

// Remise au client : seule la restitution (panneau d'action rapide) contrôle le téléphone de prêt,
// le paiement et « rendu par ». La liste ne fait que passer de l'un à l'autre un ticket déjà rendu.
export const STATUTS_REMISE = ['Rendu au client', 'Clôturé'];
const BULK_CONCURRENCE = 4;

const codeErreur = (err) => err?.code || err?.detail?.code || err?.data?.code || null;
const ticketRef = (t) => ({ id: t.id, ticket_code: t.ticket_code || `#${t.id}`, statut: t.statut });

/** Changement de statut d'une ligne : 'panneau' (remise à faire), 'aucun' (même statut) ou 'serveur'. */
export function actionStatutLigne(ticket, statut) {
  if (!statut || statut === ticket?.statut) return 'aucun';
  if (STATUTS_REMISE.includes(statut) && !STATUTS_REMISE.includes(ticket?.statut)) return 'panneau';
  return 'serveur';
}

/**
 * Changement groupé : un ticket pas encore rendu ne passe jamais en « Rendu au client » / « Clôturé »
 * par la liste (à traiter un par un). Un ticket au statut inconnu (hors de la liste affichée) non plus.
 */
export function planStatutGroupe(tickets, statut) {
  const plan = { envoyer: [], aTraiter: [], inchanges: [] };
  for (const t of tickets) {
    if (!t) continue;
    const action = actionStatutLigne(t, statut);
    if (action === 'aucun') plan.inchanges.push(ticketRef(t));
    else if (action === 'panneau') plan.aTraiter.push({ ...ticketRef(t), raison: 'remise au client à faire' });
    else plan.envoyer.push(ticketRef(t));
  }
  return plan;
}

/** Envoie le plan, quelques requêtes à la fois. 409 utiliser_restitution → à traiter un par un. */
export async function executerStatutGroupe(plan, statut, changeStatus, concurrence = BULK_CONCURRENCE) {
  const res = { statut, faits: [], aTraiter: [...plan.aTraiter], erreurs: [], inchanges: plan.inchanges.length };
  const file = [...plan.envoyer];
  const worker = async () => {
    for (let t = file.shift(); t; t = file.shift()) {
      try {
        await changeStatus(t.id, statut);
        res.faits.push(t);
      } catch (err) {
        if (codeErreur(err) === 'utiliser_restitution') res.aTraiter.push({ ...t, raison: err.message || 'non réglé' });
        else res.erreurs.push({ ...t, message: err?.message || 'changement impossible' });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrence, file.length)) }, worker));
  return res;
}

const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

/** « 2 clôturés · 3 à traiter un par un · 1 en échec » */
export function resumeStatutGroupe(r) {
  const n = r.faits.length;
  const parts = [];
  if (r.statut === 'Rendu au client') parts.push(n ? pluriel(n, 'rendu') : 'Aucun ticket rendu');
  else if (r.statut === 'Clôturé') parts.push(n ? pluriel(n, 'clôturé') : 'Aucun ticket clôturé');
  else parts.push(n ? `${pluriel(n, 'ticket')} en « ${r.statut} »` : 'Aucun ticket modifié');
  if (r.aTraiter.length) parts.push(`${r.aTraiter.length} à traiter un par un`);
  if (r.erreurs.length) parts.push(`${r.erreurs.length} en échec`);
  if (r.inchanges) parts.push(`${r.inchanges} déjà « ${r.statut} »`);
  return parts.join(' · ');
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const basePath = user?.target === 'tech' ? '/tech' : '/accueil';
  const reduceMotion = useReducedMotion();
  const [searchParams, setSearchParams] = useSearchParams();

  // L'URL (?q=, ?statut=, ?vue=archives) prime ; sinon on reprend les filtres de la session.
  // Dates et technicien ne sont pas dans l'URL : toujours repris de la session.
  const [initial] = useState(() => {
    const fromUrl = searchParams.has('q') || searchParams.has('statut') || searchParams.has('vue');
    const saved = readDashState();
    const q = fromUrl ? (searchParams.get('q') || '') : str(saved.q);
    const statut = fromUrl ? (searchParams.get('statut') || '') : str(saved.statut);
    const archives = fromUrl ? searchParams.get('vue') === 'archives' : Boolean(saved.archives);
    return {
      q, statut, archives: archives || ARCHIVE_STATUTS.includes(statut),
      dateFrom: str(saved.dateFrom), dateTo: str(saved.dateTo), tech: str(saved.tech),
    };
  });

  const [search, setSearch] = useState(initial.q);
  const [debouncedSearch, setDebouncedSearch] = useState(initial.q.trim());
  const [filterStatut, setFilterStatut] = useState(initial.statut);
  const [activeKpi, setActiveKpi] = useState(null);
  const [showArchived, setShowArchived] = useState(initial.archives);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkReport, setBulkReport] = useState(null);
  const [showBulkMenu, setShowBulkMenu] = useState(false);
  const bulkBtnRef = useRef(null);
  const bulkMenuRef = useRef(null);
  const bulkMenuId = useId();
  const [filterTech, setFilterTech] = useState(initial.tech);
  const [interactionFilter, setInteractionFilter] = useState(null); // 'accord_client' | 'messages' | 'avis' | null
  const [pageSize, setPageSize] = useState(() => parseInt(localStorage.getItem('kp_page_size') || '50'));
  const [sortField, setSortField] = useState('date_depot');
  const [sortDir, setSortDir] = useState('desc');
  const [compactMode, setCompactMode] = useState(() => localStorage.getItem('kp_compact_mode') === '1');
  const [dateFrom, setDateFrom] = useState(initial.dateFrom);
  const [dateTo, setDateTo] = useState(initial.dateTo);
  const [isPending, startTransition] = useTransition();
  const searchTimer = useRef(null);
  const pendingEnterRef = useRef(false);

  // La page revient à 0 dès qu'un filtre, un onglet, un KPI ou le tri change (sans requête intermédiaire)
  const filterSig = JSON.stringify([
    debouncedSearch, filterStatut, showArchived, interactionFilter, activeKpi,
    sortField, sortDir, dateFrom, dateTo, filterTech, pageSize,
  ]);
  const [pageState, setPageState] = useState({ sig: filterSig, page: 0 });
  const page = pageState.sig === filterSig ? pageState.page : 0;
  const setPage = (next) => setPageState((prev) => {
    const cur = prev.sig === filterSig ? prev.page : 0;
    return { sig: filterSig, page: Math.max(0, typeof next === 'function' ? next(cur) : next) };
  });

  const toggleCompact = () => {
    setCompactMode(prev => {
      const next = !prev;
      localStorage.setItem('kp_compact_mode', next ? '1' : '0');
      return next;
    });
  };

  // Menu du changement groupé ouvert : le focus va sur le premier statut (Échap le rend au bouton)
  useEffect(() => {
    if (showBulkMenu) bulkMenuRef.current?.querySelector('button')?.focus();
  }, [showBulkMenu]);

  // Debounced search (300ms)
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  useEffect(() => {
    writeDashState({ q: debouncedSearch, statut: filterStatut, archives: showArchived, dateFrom, dateTo, tech: filterTech });
  }, [debouncedSearch, filterStatut, showArchived, dateFrom, dateTo, filterTech]);

  // Synchronisation avec l'URL. seenUrlSigRef : dernière URL observée (ne réagir qu'à un vrai
  // changement, y compris au double montage du StrictMode) ; writtenSigRef : dernière valeur écrite,
  // pour distinguer nos écritures d'un lien externe (palette « Tous les tickets », bouton Dashboard).
  // JSON et non join('|') : une recherche peut contenir « | »
  const urlSig = JSON.stringify([searchParams.get('q') || '', searchParams.get('statut') || '', searchParams.get('vue') === 'archives' ? '1' : '']);
  const stateSig = JSON.stringify([debouncedSearch, filterStatut, showArchived ? '1' : '']);
  const seenUrlSigRef = useRef(urlSig);
  const writtenSigRef = useRef(urlSig);
  const setSearchParamsRef = useRef(setSearchParams);
  setSearchParamsRef.current = setSearchParams;
  useEffect(() => {
    if (urlSig === seenUrlSigRef.current) return;
    seenUrlSigRef.current = urlSig;
    if (urlSig === writtenSigRef.current) return;
    writtenSigRef.current = urlSig;
    const [q, statut, arch] = JSON.parse(urlSig);
    setSearch(q);
    setDebouncedSearch(q.trim());
    setFilterStatut(statut);
    setShowArchived(arch === '1' || ARCHIVE_STATUTS.includes(statut));
    setActiveKpi(null);
  }, [urlSig]);
  useEffect(() => {
    if (stateSig === writtenSigRef.current) return;
    writtenSigRef.current = stateSig;
    const [q, statut, arch] = JSON.parse(stateSig);
    setSearchParamsRef.current((prev) => {
      const next = new URLSearchParams(prev);
      if (q) next.set('q', q); else next.delete('q');
      if (statut) next.set('statut', statut); else next.delete('statut');
      if (arch) next.set('vue', 'archives'); else next.delete('vue');
      return next;
    }, { replace: true });
  }, [stateSig]);

  // For tech view: filter by assigned tech
  const isTech = user?.target === 'tech';
  const techName = user?.utilisateur;

  // Filtres envoyés au serveur. Vue actifs : liste complète (≤ 500) paginée ici ;
  // vue archives : pagination serveur ; recherche : tous statuts, actifs d'abord.
  const searchMode = Boolean(debouncedSearch);
  const vue = searchMode ? 'tous' : (showArchived ? 'archives' : 'actifs');
  const serverPaged = vue === 'archives';
  const mineOnly = filterTech === '__mine__';
  // Le serveur compare le technicien à l'identique : en actifs et en recherche (listes complètes)
  // on garde le filtre local, qui accepte l'ancien format « Nom (rôle) » et, pour « Mes tickets »,
  // les non assignés. Seules les archives paginées filtrent côté serveur (signalé à l'écran).
  const techOnServer = Boolean(filterTech) && serverPaged;
  const serverTech = techOnServer ? (mineOnly ? (techName || '') : filterTech) : '';
  const queryParams = useMemo(() => {
    const p = { vue, limit: serverPaged ? pageSize : (searchMode ? 200 : 500) };
    if (serverPaged) p.offset = page * pageSize;
    if (debouncedSearch) p.search = debouncedSearch;
    if (filterStatut && !searchMode) p.statut = filterStatut;
    if (dateFrom) p.date_from = dateFrom;
    if (dateTo) p.date_to = dateTo;
    if (serverTech) p.tech = serverTech;
    return p;
  }, [vue, serverPaged, searchMode, pageSize, page, debouncedSearch, filterStatut, dateFrom, dateTo, serverTech]);
  const dashKey = useMemo(() => `dashboard:${JSON.stringify(queryParams)}`, [queryParams]);

  // SWR: Dashboard data (KPI + tickets)
  const { data: dashData, error: dashError, loading, isRevalidating, mutate } = useApi(
    dashKey,
    () => api.getDashboard(queryParams),
    { tags: ['dashboard', 'tickets'], ttl: 45_000 }
  );
  // Pendant le chargement d'une autre page ou d'une recherche affinée, on garde la réponse
  // précédente de la même vue (atténuée) : pas de squelette, pagination et focus conservés.
  // Mise à jour en effet : seules les paires (données, vue) réellement affichées sont retenues.
  const lastDashRef = useRef(null);
  useEffect(() => {
    if (dashData) lastDashRef.current = { data: dashData, vue };
  }, [dashData, vue]);
  const prevDash = !dashData && loading && lastDashRef.current?.vue === vue ? lastDashRef.current.data : null;
  const viewData = dashData ?? prevDash;
  const showingPrevious = Boolean(prevDash);
  // Les KPI portent sur toute la base : ceux de la réponse précédente restent valables quelle que soit la vue
  const kpi = dashData?.kpi ?? (loading ? lastDashRef.current?.data?.kpi : null) ?? null;
  const tickets = viewData?.tickets ?? [];
  const serverTotal = typeof viewData?.total === 'number' ? viewData.total : null;

  // Nombre d'archivés correspondant aux mêmes filtres (bouton « Voir N archivé(s) », état vide)
  const archCountParams = useMemo(() => {
    if (searchMode || showArchived || filterStatut) return null;
    const p = { vue: 'archives', limit: 1 };
    if (dateFrom) p.date_from = dateFrom;
    if (dateTo) p.date_to = dateTo;
    const t = mineOnly ? (techName || '') : filterTech;
    if (t) p.tech = t;
    return p;
  }, [searchMode, showArchived, filterStatut, dateFrom, dateTo, mineOnly, techName, filterTech]);
  const { data: archCountData } = useApi(
    archCountParams ? `dashboard:archcount:${JSON.stringify(archCountParams)}` : null,
    () => api.getDashboard(archCountParams),
    { tags: ['dashboard', 'tickets'], ttl: 60_000 }
  );
  const archivedTotal = typeof archCountData?.total === 'number' ? archCountData.total : null;

  // SWR: Team members
  const { data: teamData } = useApi('team:active', () => api.getActiveTeam(), { tags: ['team'], ttl: 300_000 });
  const teamList = teamData ?? [];
  const techColors = useMemo(() => {
    const map = {};
    teamList.forEach(m => { if (m.couleur) map[m.nom] = m.couleur; });
    return map;
  }, [teamList]);

  // Préchargement de la page Clients, avec la MÊME clé et la même taille de page que ClientsPage
  // (l'ancienne clé 'clients:p:0:20' n'était jamais relue). Plus de prefetch du catalogue tarifs
  // (page BETA, 3 requêtes) ni de la config (réservée aux admins, déjà lue par la Navbar).
  useEffect(() => {
    const size = parseInt(localStorage.getItem('kp_clients_page_size') || '50', 10) || 50;
    prefetch(`clients:p:0:${size}`, () => api.getClients({ limit: size, offset: 0 }), { tags: ['clients'], ttl: 60_000 });
  }, []);

  // Rafraîchissement toutes les 60 s onglet visible, immédiat au retour sur l'onglet, sans
  // chevauchement ni relance (le premier chargement est fait par useApi)
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;
  usePolling(() => api.background(() => mutateRef.current()), 60_000, { immediate: false });

  // SWR: Interactions clients
  const { data: interactions } = useApi('dashboard:interactions', () => api.getInteractions(), { tags: ['interactions'], ttl: 30_000 });

  // Build lookup: ticket_id → { accord_client, accord_client_valide, messages, avis } booleans
  const ticketInteractions = useMemo(() => {
    if (!interactions) return {};
    const map = {};
    for (const key of ['accord_client', 'accord_client_valide', 'messages', 'avis']) {
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

  const ouvrirRemise = (t) => openQuickScan({ id: t.id, code: t.ticket_code });

  const handleBulkStatus = async (statut) => {
    if (selectedIds.size === 0 || bulkBusy) return;
    setShowBulkMenu(false);
    setBulkReport(null);
    setBulkBusy(true);
    try {
      const byId = new Map(tickets.map(t => [t.id, t]));
      const choisis = [...selectedIds].map(id => byId.get(id) || { id });
      const res = await executerStatutGroupe(planStatutGroupe(choisis, statut), statut, (id, s) => api.changeStatus(id, s));
      setSelectedIds(new Set());
      // Invalide aussi 'interactions' pour que les points vert/orange se mettent
      // à jour immédiatement (sinon ils restent figés ~30s le temps du polling).
      if (res.faits.length) invalidateCache('tickets', 'dashboard', 'interactions');
      if (res.aTraiter.length || res.erreurs.length) setBulkReport(res);
      else toast.success(resumeStatutGroupe(res));
    } catch (err) {
      toast.error(err?.message || 'Changement groupé impossible');
    } finally {
      setBulkBusy(false);
    }
  };

  const handleInlineStatus = async (ticket, newStatut) => {
    const action = actionStatutLigne(ticket, newStatut);
    if (action === 'aucun') return;
    if (action === 'panneau') {
      ouvrirRemise(ticket);
      return;
    }
    const ticketId = ticket.id;
    try {
      await api.changeStatus(ticketId, newStatut);
      // Mise à jour optimiste du statut affiché
      mutate(prev => prev ? {
        ...prev, tickets: prev.tickets.map(t => t.id === ticketId ? { ...t, statut: newStatut } : t),
      } : prev);
      // Force le refetch tickets+dashboard+interactions → les KPI (cartes
      // Diagnostic/Pièces/etc.), les vues filtrées et les points vert/orange se
      // resynchronisent avec le nouveau statut (le mutate optimiste ne corrige
      // que la liste, pas les compteurs KPI du payload dashboard).
      invalidateCache('tickets', 'dashboard', 'interactions');
    } catch (err) {
      const code = ticket.ticket_code || `#${ticketId}`;
      if (codeErreur(err) === 'utiliser_restitution') {
        // Non réglé ou prêt sorti : le panneau propose l'encaissement ou la remise
        toast.info(`${code} : ${err.message}`);
        ouvrirRemise(ticket);
      } else {
        toast.error(`${code} : ${err?.message || 'changement de statut impossible'}`);
      }
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

  // Dates et vue sont filtrées par le serveur ; restent ici le technicien quand il n'est pas
  // envoyé (voir techOnServer), les interactions et, en recherche, l'onglet de statut.
  const baseTickets = useMemo(() => {
    let list = tickets;
    if (filterTech && !techOnServer) {
      if (mineOnly) {
        if (techName) list = list.filter(t => matchTech(t.technicien_assigne, techName) || !t.technicien_assigne);
      } else {
        list = list.filter(t => matchTech(t.technicien_assigne, filterTech));
      }
    }
    if (interactionTicketIds) {
      list = list.filter(t => interactionTicketIds.has(t.id));
    }
    return list;
  }, [tickets, filterTech, techOnServer, mineOnly, techName, interactionTicketIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredTickets = useMemo(
    () => (searchMode && filterStatut ? baseTickets.filter(t => t.statut === filterStatut) : baseTickets),
    [baseTickets, searchMode, filterStatut]
  );

  const statutCounts = useMemo(() => {
    const counts = {};
    for (const t of baseTickets) counts[t.statut] = (counts[t.statut] || 0) + 1;
    return counts;
  }, [baseTickets]);

  const activeTickets = useMemo(() => filteredTickets.filter(t => !ARCHIVE_STATUTS.includes(t.statut)), [filteredTickets]);
  const archivedTickets = useMemo(() => filteredTickets.filter(t => ARCHIVE_STATUTS.includes(t.statut)), [filteredTickets]);

  // Compteurs du bandeau : KPI serveur (toute la base), indépendants de la recherche
  const hasListFilters = Boolean(searchMode || filterStatut || dateFrom || dateTo || filterTech || interactionTicketIds);
  // CA estimé : calculé seulement sur la liste complète des actifs (sans recherche ni filtre serveur),
  // puis conservé tel quel pendant qu'on filtre.
  const caActifs = useMemo(() => {
    if (!dashData || vue !== 'actifs' || filterStatut || dateFrom || dateTo) return null;
    let ca = 0;
    for (const t of dashData.tickets || []) {
      const prix = Number(t.tarif_final || t.devis_estime || 0);
      if (prix > 0) ca += prix;
    }
    return ca;
  }, [dashData, vue, filterStatut, dateFrom, dateTo]);
  const [caKnown, setCaKnown] = useState(null);
  useEffect(() => { if (caActifs !== null) setCaKnown(caActifs); }, [caActifs]);
  const extraKpis = useMemo(() => {
    const enAttente = kpi
      ? (kpi.en_attente_diagnostic || 0) + (kpi.en_attente_accord || 0) + (kpi.en_attente_piece || 0)
      : 0;
    return {
      todayCount: kpi?.nouveaux_aujourdhui ?? 0,
      enAttente,
      ca: caActifs ?? caKnown,
      prets: kpi?.reparation_terminee ?? 0,
    };
  }, [kpi, caActifs, caKnown]);

  // En recherche sans tri choisi, on garde l'ordre de pertinence du serveur. Archives paginées :
  // l'API ne trie que par date de dépôt décroissante, un tri local ne porterait que sur la page reçue.
  const keepServerOrder = serverPaged || (searchMode && sortField === 'date_depot' && sortDir === 'desc');
  const sortList = useCallback((list) => {
    if (keepServerOrder) return list;
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
  }, [keepServerOrder, sortField, sortDir]);
  const sortedTickets = useMemo(() => {
    if (searchMode) return [...sortList(activeTickets), ...sortList(archivedTickets)];
    return sortList(showArchived ? archivedTickets : activeTickets);
  }, [searchMode, showArchived, archivedTickets, activeTickets, sortList]);
  const totalCount = serverPaged ? (serverTotal ?? sortedTickets.length) : sortedTickets.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const displayedTickets = serverPaged
    ? sortedTickets
    : sortedTickets.slice(safePage * pageSize, (safePage + 1) * pageSize);
  // Recherche tronquée par le serveur (limit 200) ou liste d'actifs > 500
  const truncatedBy = !serverPaged && serverTotal !== null && serverTotal > tickets.length ? serverTotal : null;

  // Archives : page devenue hors limites (tickets réactivés ou supprimés entre-temps).
  // Total de la réponse fraîche uniquement, pas de celle gardée pendant le chargement.
  const freshTotal = typeof dashData?.total === 'number' ? dashData.total : null;
  useEffect(() => {
    if (!serverPaged || freshTotal === null || page === 0 || page * pageSize < freshTotal) return;
    setPage(Math.max(0, Math.ceil(freshTotal / pageSize) - 1));
  }, [serverPaged, freshTotal, page, pageSize]); // eslint-disable-line react-hooks/exhaustive-deps

  const openTicket = useCallback((id) => navigate(`${basePath}/ticket/${id}`), [navigate, basePath]);
  const openTicketLink = (e, id) => {
    e.stopPropagation();
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openTicket(id);
  };

  const onSearchKeyDown = async (e) => {
    if (e.key === 'ArrowDown') {
      const first = document.querySelector('[data-ticket-link]');
      if (first) { e.preventDefault(); first.focus(); }
      return;
    }
    if (e.key !== 'Enter' || e.nativeEvent?.isComposing) return;
    e.preventDefault();
    const q = search.trim();
    if (!q) return;
    const kind = detectQueryKind(q);
    if (kind.explicit && (kind.kind === 'ticket' || kind.kind === 'imei')) {
      try {
        const r = await api.resolveCode(q);
        if (r?.type === 'ticket' && r.id) { openTicket(r.id); return; }
      } catch { /* code inconnu : on retombe sur la liste */ }
    }
    if (q !== debouncedSearch || (loading && !dashData)) {
      clearTimeout(searchTimer.current);
      pendingEnterRef.current = true;
      setDebouncedSearch(q);
      return;
    }
    if (displayedTickets[0]) openTicket(displayedTickets[0].id);
  };

  // Entrée tapée avant l'arrivée des résultats : on ouvre le premier dès qu'ils sont là
  useEffect(() => {
    if (!pendingEnterRef.current || loading || isRevalidating) return;
    pendingEnterRef.current = false;
    if (debouncedSearch && displayedTickets[0]) openTicket(displayedTickets[0].id);
  }, [dashData, loading, isRevalidating]); // eslint-disable-line react-hooks/exhaustive-deps

  const showActives = () => {
    setShowArchived(false);
    if (ARCHIVE_STATUTS.includes(filterStatut)) setFilterStatut('');
  };
  const showArchives = () => {
    setShowArchived(true);
    if (filterStatut && !ARCHIVE_STATUTS.includes(filterStatut)) { setFilterStatut(''); setActiveKpi(null); }
  };

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

  // État vide explicite : ne jamais afficher « Aucun ticket » quand des résultats existent ailleurs
  const emptyState = (() => {
    const resetFilters = () => { setFilterStatut(''); setActiveKpi(null); setInteractionFilter(null); setFilterTech(''); };
    if (searchMode) {
      if (filterStatut && baseTickets.length > 0) {
        return {
          title: `Aucun ticket « ${filterStatut} » pour « ${debouncedSearch} »`,
          text: `${baseTickets.length} ticket(s) correspondent avec un autre statut.`,
          action: { label: 'Afficher tous les statuts', onClick: () => { setFilterStatut(''); setActiveKpi(null); setShowArchived(false); } },
        };
      }
      if (tickets.length > 0) {
        return {
          title: 'Résultats masqués par un filtre',
          text: `${tickets.length} ticket(s) correspondent à « ${debouncedSearch} » mais sont masqués par le filtre technicien ou interactions.`,
          action: { label: 'Retirer ces filtres', onClick: resetFilters },
        };
      }
      if (dateFrom || dateTo) {
        return {
          title: `Aucun ticket ne correspond à « ${debouncedSearch} » sur cette période`,
          text: 'La recherche est limitée à la période de dépôt choisie.',
          action: { label: 'Retirer les filtres de date', onClick: () => { setDateFrom(''); setDateTo(''); } },
        };
      }
      return {
        title: `Aucun ticket ne correspond à « ${debouncedSearch} »`,
        text: 'Essayez le téléphone, le code (KP-000123 ou 123), l’IMEI, ou cherchez aussi dans les clients, devis et commandes.',
        action: { label: 'Recherche globale', onClick: () => openSearchPalette(debouncedSearch) },
      };
    }
    if (!showArchived && archivedTotal > 0 && (dateFrom || dateTo || filterTech)) {
      return {
        title: 'Aucun ticket actif avec ces filtres',
        text: `${archivedTotal} ticket(s) rendus ou clôturés correspondent à ces filtres.`,
        action: { label: `Voir les ${archivedTotal} archivé(s)`, onClick: showArchives },
      };
    }
    if (showArchived) {
      return {
        title: 'Aucun ticket archivé',
        text: hasListFilters ? 'Aucun ticket rendu ou clôturé ne correspond à ces filtres.' : 'Les tickets rendus ou clôturés apparaîtront ici.',
        action: { label: 'Voir les actifs', onClick: showActives },
      };
    }
    return {
      title: 'Aucun ticket trouvé',
      text: hasListFilters ? 'Essayez d’ajuster vos filtres pour voir plus de résultats.' : 'C’est le calme ! Créez un nouveau ticket pour démarrer.',
      action: null,
    };
  })();

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
    <div className="p-4 sm:p-6 lg:p-8 relative">
      {/* Revalidation indicator */}
      {isRevalidating && (
        <div className="absolute top-0 left-0 right-0 h-0.5 overflow-hidden z-10" aria-hidden="true">
          <div className="h-full bg-brand-400/60 motion-safe:animate-progress-bar motion-reduce:w-full" />
        </div>
      )}
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
      {/* ─── Header Hero ─── */}
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-5 sm:p-6 mb-5 -mx-1"
      >
        {/* Halo décoratif */}
        <div className="absolute -right-16 -top-16 w-64 h-64 rounded-full bg-gradient-to-br from-brand-500 to-fuchsia-500 opacity-20 blur-3xl pointer-events-none" />
        <div className="absolute -left-16 -bottom-16 w-48 h-48 rounded-full bg-gradient-to-br from-indigo-500 to-brand-500 opacity-10 blur-3xl pointer-events-none" />

        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/logo_k.png" alt="" className="w-10 h-10 rounded-xl object-contain bg-white/10 p-1.5 shadow-lg hidden sm:block" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-300 mb-1">
                {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
              <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight">
                {user?.target === 'tech'
                  ? <>Espace <span className="font-editorial bg-gradient-to-r from-brand-300 to-fuchsia-300 bg-clip-text text-transparent">Technicien</span></>
                  : <>Tableau de <span className="font-editorial bg-gradient-to-r from-brand-300 to-fuchsia-300 bg-clip-text text-transparent">bord</span></>}
              </h1>
              <p className="text-sm text-slate-300 mt-1">
                {user?.target === 'tech'
                  ? <>Bienvenue <span className="font-editorial text-brand-200">{user?.utilisateur || ''}</span> — vos réparations en cours</>
                  : <><span className="text-white font-semibold">{extraKpis.enAttente}</span> ticket{extraKpis.enAttente > 1 ? 's' : ''} en attente · <span className="text-white font-semibold">{extraKpis.todayCount}</span> nouveau{extraKpis.todayCount > 1 ? 'x' : ''} aujourd'hui</>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={toggleCompact}
              className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors backdrop-blur-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
              title={compactMode ? 'Mode confortable' : 'Mode compact'}
              aria-label={compactMode ? 'Mode confortable' : 'Mode compact'}>
              {compactMode ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
            </button>
            <button onClick={() => mutate()}
              className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors backdrop-blur-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
              title="Rafraîchir"
              aria-label="Rafraîchir">
              <RefreshCw className={`w-4 h-4 ${loading ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
            </button>
            <button onClick={() => navigate('/client')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-slate-900 font-semibold text-sm hover:bg-slate-100 transition-colors shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50">
              <Plus className="w-4 h-4" /> Nouveau ticket
            </button>
          </div>
        </div>
      </motion.div>

      {/* KPI Grid — 5 cards cliquables (filtres rapides au-dessus du tableau) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {!kpi && loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card p-4">
              <div className="w-9 h-9 rounded-lg animate-shimmer mb-3" />
              <div className="h-7 w-12 animate-shimmer rounded mb-1" />
              <div className="h-3 w-20 animate-shimmer rounded" />
            </div>
          ))
        ) : kpiCards.map(({ label, value, icon: Icon, color, iconBg, filter }, i) => (
          <button key={label} type="button"
            onClick={() => handleKpiClick(filter, i)}
            aria-pressed={activeKpi === i}
            className={`card p-4 hover:shadow-md motion-safe:hover:-translate-y-0.5 transition-all duration-200 motion-safe:animate-[fadeIn_0.3s_ease-out_both] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
              ${activeKpi === i ? 'ring-2 ring-brand-500 shadow-lg shadow-brand-500/10' : ''}`}
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center mb-3`} aria-hidden="true">
              <Icon className={`w-4 h-4 ${color}`} />
            </div>
            <p className="text-2xl font-bold text-slate-900 tracking-tight">{value}</p>
            <p className="text-[11px] text-slate-500 font-medium mt-0.5 leading-tight">{label}</p>
          </button>
        ))}
      </div>

      {/* ★ Barre actions compacte — regroupe commandes, dépôts distants, interactions */}
      {(commandesEnCours > 0 || (kpi?.pre_enregistres > 0) || (interactions && interactions.total_actions > 0)) && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {commandesEnCours > 0 && (
            <button onClick={() => navigate(`${basePath}/commandes`)}
              className="group inline-flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 hover:border-amber-400 hover:shadow-sm transition-all text-xs">
              <span className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center"><Package className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" /></span>
              <span className="font-bold text-amber-700">{commandesEnCours}</span>
              <span className="text-amber-700">commande{commandesEnCours > 1 ? 's' : ''} pièces</span>
              <ChevronRight className="w-3 h-3 text-amber-400 group-hover:text-amber-600 transition-colors" aria-hidden="true" />
            </button>
          )}
          {kpi?.pre_enregistres > 0 && (
            <button onClick={() => { setFilterStatut('Pré-enregistré'); setActiveKpi(null); setShowArchived(false); }}
              className="group inline-flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full bg-indigo-50 border border-indigo-200 hover:border-indigo-400 hover:shadow-sm transition-all text-xs">
              <span className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center"><Globe className="w-3.5 h-3.5 text-indigo-600" aria-hidden="true" /></span>
              <span className="font-bold text-indigo-700">{kpi.pre_enregistres}</span>
              <span className="text-indigo-700">dépôt{kpi.pre_enregistres > 1 ? 's' : ''} à distance</span>
              <ChevronRight className="w-3 h-3 text-indigo-400 group-hover:text-indigo-600 transition-colors" aria-hidden="true" />
            </button>
          )}
          {interactions?.accord_client?.count > 0 && (
            <button onClick={() => setInteractionFilter(interactionFilter === 'accord_client' ? null : 'accord_client')}
              aria-pressed={interactionFilter === 'accord_client'}
              className={`inline-flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full border transition-all text-xs ${
                interactionFilter === 'accord_client' ? 'bg-orange-100 border-orange-400 ring-2 ring-orange-200' : 'bg-orange-50 border-orange-200 hover:border-orange-400'
              }`}>
              <span className="text-base leading-none" aria-hidden="true">📋</span>
              <span className="font-bold text-orange-700">{interactions.accord_client.count}</span>
              <span className="text-orange-700">accord{interactions.accord_client.count > 1 ? 's' : ''}</span>
            </button>
          )}
          {interactions?.messages?.count > 0 && (
            <button onClick={() => setInteractionFilter(interactionFilter === 'messages' ? null : 'messages')}
              aria-pressed={interactionFilter === 'messages'}
              className={`inline-flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full border transition-all text-xs ${
                interactionFilter === 'messages' ? 'bg-blue-100 border-blue-400 ring-2 ring-blue-200' : 'bg-blue-50 border-blue-200 hover:border-blue-400'
              }`}>
              <span className="text-base leading-none" aria-hidden="true">💬</span>
              <span className="font-bold text-blue-700">{interactions.messages.count}</span>
              <span className="text-blue-700">message{interactions.messages.count > 1 ? 's' : ''} client</span>
            </button>
          )}
          {interactions?.avis?.count > 0 && (
            <button onClick={() => setInteractionFilter(interactionFilter === 'avis' ? null : 'avis')}
              aria-pressed={interactionFilter === 'avis'}
              className={`inline-flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full border transition-all text-xs ${
                interactionFilter === 'avis' ? 'bg-yellow-100 border-yellow-400 ring-2 ring-yellow-200' : 'bg-yellow-50 border-yellow-200 hover:border-yellow-400'
              }`}>
              <span className="text-base leading-none" aria-hidden="true">⭐</span>
              <span className="font-bold text-yellow-700">{interactions.avis.count}</span>
              <span className="text-yellow-700">avis</span>
            </button>
          )}
          {interactionFilter && (
            <button onClick={() => setInteractionFilter(null)}
              className="ml-auto inline-flex items-center gap-1 min-h-[44px] px-2 text-xs text-slate-500 hover:text-slate-700 transition-colors">
              <X className="w-3 h-3" aria-hidden="true" /> Réinitialiser
            </button>
          )}
        </div>
      )}

      {/* Search & Filters */}
      <div className="card overflow-hidden mb-6">
        <div className="p-3 sm:p-4 border-b border-slate-100">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" aria-hidden="true" />
              <label htmlFor="dashboard-search" className="sr-only">Rechercher un ticket</label>
              <input id="dashboard-search" type="text" placeholder="Nom, téléphone, IMEI, code, modèle, panne..."
                value={search} onChange={(e) => setSearch(e.target.value)}
                onKeyDown={onSearchKeyDown}
                enterKeyHint="search"
                autoComplete="off"
                aria-describedby="dashboard-search-hint"
                className="w-full min-h-[44px] pl-10 pr-11 py-2.5 rounded-lg border border-slate-200 bg-slate-50/50 text-base sm:text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 focus:bg-white transition-colors"
              />
              <span id="dashboard-search-hint" className="sr-only">Entrée ouvre le premier résultat, flèche bas pour parcourir la liste.</span>
              {search && (
                <button type="button" onClick={() => setSearch('')} aria-label="Effacer la recherche"
                  className="absolute right-0.5 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center rounded-md hover:bg-slate-200 text-slate-500 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 min-h-[44px] px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50/50 focus-within:ring-2 focus-within:ring-brand-500/20 focus-within:border-brand-500">
              <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} max={dateTo || undefined}
                className="bg-transparent text-xs text-slate-700 outline-none w-[120px] min-h-[36px]" title="Déposé à partir du" aria-label="Déposé à partir du" />
              <span className="text-slate-400" aria-hidden="true">→</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} min={dateFrom || undefined}
                className="bg-transparent text-xs text-slate-700 outline-none w-[120px] min-h-[36px]" title="Déposé jusqu'au" aria-label="Déposé jusqu'au" />
              {(dateFrom || dateTo) && (
                <button type="button" onClick={() => { setDateFrom(''); setDateTo(''); }}
                  className="w-9 h-9 flex items-center justify-center rounded hover:bg-slate-200 text-slate-500 hover:text-slate-700" title="Réinitialiser dates" aria-label="Effacer les dates">
                  <X className="w-3 h-3" aria-hidden="true" />
                </button>
              )}
            </div>
            {teamList.length > 0 && (
              <select value={filterTech} onChange={e => setFilterTech(e.target.value)} aria-label="Filtrer par technicien"
                className="min-h-[44px] px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50/50 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 min-w-[140px]">
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
          {filterTabs.map(({ label, value }) => {
            const count = searchMode ? (value ? (statutCounts[value] || 0) : baseTickets.length) : null;
            return (
              <button key={value} type="button" aria-pressed={filterStatut === value}
                onClick={() => startTransition(() => { setFilterStatut(value); setActiveKpi(null); setShowArchived(ARCHIVE_STATUTS.includes(value)); })}
                className={`flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] rounded-md text-xs font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
                  ${filterStatut === value
                    ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/25'
                    : 'text-slate-600 hover:bg-white hover:text-slate-800 hover:shadow-sm'
                  }`}
              >
                {label}
                {count !== null && <span className={filterStatut === value ? 'text-white/90' : 'text-slate-500'}>({count})</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Counters */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 mb-3 px-1">
        {searchMode && !dashData ? (
          <p className="min-h-[44px] flex items-center text-sm text-slate-600" role="status">
            {dashError ? 'Recherche indisponible' : `Recherche de « ${debouncedSearch} »…`}
          </p>
        ) : searchMode ? (
          <p className="min-h-[44px] flex items-center text-sm text-slate-600" role="status">
            <span>
              <strong className="text-slate-900">{filteredTickets.length}</strong> résultat{filteredTickets.length > 1 ? 's' : ''} pour « {debouncedSearch} »
              {' '}— {activeTickets.length} en cours, {archivedTickets.length} rendu{archivedTickets.length > 1 ? 's' : ''} ou clôturé{archivedTickets.length > 1 ? 's' : ''}
              {truncatedBy ? ` (${tickets.length} premiers sur ${truncatedBy})` : ''}
            </span>
          </p>
        ) : (
          <>
            <button type="button" onClick={showActives} aria-pressed={!showArchived}
              className={`min-h-[44px] text-sm font-medium rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${!showArchived ? 'text-brand-700' : 'text-slate-500 hover:text-slate-700'}`}>
              {!showArchived && truncatedBy
                ? `${activeTickets.length} actif(s) affichés sur ${truncatedBy}`
                : `${showArchived ? 'Voir les actifs' : `${activeTickets.length} actif(s)`}`}
            </button>
            <button type="button" onClick={showArchives} aria-pressed={showArchived}
              className={`min-h-[44px] text-sm font-medium rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${showArchived ? 'text-brand-700' : 'text-slate-500 hover:text-slate-700'}`}>
              {showArchived
                ? (serverTotal !== null ? `${serverTotal} archivé(s)` : (loading ? 'Archivés…' : `${archivedTickets.length} archivé(s)`))
                : archivedTotal !== null ? `Voir ${archivedTotal} archivé(s)` : 'Voir les archivés'}
            </button>
          </>
        )}
        {showArchived && !searchMode && filterTech && (
          <p className="w-full text-xs text-slate-600">
            Archives : technicien comparé au nom exact{mineOnly ? ', sans les tickets non assignés' : ''}. Les anciens tickets notés « Nom (rôle) » n’y figurent pas.
          </p>
        )}
      </div>

      {/* Sort controls */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-3 px-1">
        <span className="text-xs text-slate-500"><Filter className="w-3 h-3 inline mr-1" aria-hidden="true" />Trier par :</span>
        {serverPaged ? (
          <span className="min-h-[32px] flex items-center text-xs text-slate-600">
            date de dépôt, plus récents d’abord (tri fixe des archives paginées)
          </span>
        ) : [
          { label: 'Date dépôt', value: 'date_depot' },
          { label: 'Nom client', value: 'nom' },
          { label: 'Récupération', value: 'date_recuperation' },
          { label: 'Statut', value: 'statut' },
        ].map(({ label, value }) => (
          <button key={value} type="button"
            aria-pressed={sortField === value}
            onClick={() => {
              if (sortField === value) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
              else { setSortField(value); setSortDir(value === 'nom' ? 'asc' : 'desc'); }
            }}
            className={`px-2 py-1 min-h-[44px] sm:min-h-[32px] rounded-md text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
              sortField === value ? 'bg-brand-100 text-brand-700' : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            {label} {sortField === value && (sortDir === 'asc' ? '↑' : '↓')}
          </button>
        ))}
      </div>

      {/* Bulk actions bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2.5 bg-brand-50 border border-brand-200 rounded-xl motion-safe:animate-[fadeIn_0.3s_ease-out_both]">
          <span className="text-sm font-semibold text-brand-700">{selectedIds.size} sélectionné(s)</span>
          <div className="relative ml-auto"
            onKeyDown={e => {
              if (e.key !== 'Escape' || !showBulkMenu) return;
              e.stopPropagation();
              setShowBulkMenu(false);
              bulkBtnRef.current?.focus();
            }}>
            <button type="button" ref={bulkBtnRef} onClick={() => setShowBulkMenu(!showBulkMenu)} disabled={bulkBusy}
              aria-expanded={showBulkMenu} aria-controls={showBulkMenu ? bulkMenuId : undefined}
              className="btn-primary text-xs px-3 min-h-[44px] disabled:opacity-60">
              {bulkBusy
                ? <><RefreshCw className="w-3.5 h-3.5 motion-safe:animate-spin" aria-hidden="true" /> Changement en cours…</>
                : <>Changer statut <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /></>}
            </button>
            {showBulkMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowBulkMenu(false)} />
                <div role="group" id={bulkMenuId} ref={bulkMenuRef} aria-label="Nouveau statut des tickets sélectionnés"
                  className="absolute right-0 top-full mt-1 w-72 card p-1.5 shadow-xl z-50 motion-safe:animate-[fadeIn_0.3s_ease-out_both]">
                  {STATUTS.map(s => (
                    <button type="button" key={s} onClick={() => handleBulkStatus(s)}
                      className="w-full min-h-[44px] text-left px-3 py-2 rounded-lg text-sm hover:bg-slate-50 text-slate-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                      {s}
                      {STATUTS_REMISE.includes(s) && (
                        <span className="block text-xs text-slate-600">Tickets déjà rendus et réglés ; remise un par un</span>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button type="button" onClick={() => setSelectedIds(new Set())} className="btn-ghost p-1.5 min-w-[44px] min-h-[44px]"
            aria-label="Annuler la sélection">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Compte rendu du changement groupé : tickets à rendre un par un, échecs */}
      {bulkReport && (() => {
        const enAttente = bulkReport.aTraiter.filter(r => {
          const cur = tickets.find(t => t.id === r.id);
          return !cur || cur.statut === r.statut;
        });
        return (
          <div role="status" className="flex items-start gap-3 mb-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />
            <div className="flex-1 min-w-0 text-sm text-amber-900">
              <p className="font-semibold">{resumeStatutGroupe(bulkReport)}</p>
              {enAttente.length > 0 && (
                <>
                  <p className="mt-1 text-xs">
                    Remise au client par le panneau (paiement, téléphone de prêt) — cliquez sur un ticket :
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {enAttente.map(r => (
                      <li key={r.id}>
                        <button type="button" onClick={() => ouvrirRemise(r)} title={r.raison}
                          className="min-h-[44px] px-3 rounded-lg bg-white border border-amber-300 font-mono text-sm font-semibold text-amber-900 hover:bg-amber-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600">
                          {r.ticket_code}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {bulkReport.erreurs.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs">
                  {bulkReport.erreurs.map(r => (
                    <li key={r.id}><span className="font-mono font-semibold">{r.ticket_code}</span> : {r.message}</li>
                  ))}
                </ul>
              )}
            </div>
            <button type="button" onClick={() => setBulkReport(null)} aria-label="Fermer le compte rendu"
              className="btn-ghost p-1.5 min-w-[44px] min-h-[44px] -my-2 -mr-2 text-amber-900">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        );
      })()}

      {/* Table */}
      <div aria-busy={loading || isPending}
        className={`card overflow-hidden motion-safe:transition-opacity duration-150 ${isPending || showingPrevious ? 'opacity-60' : ''}`}>
        <div className="hidden lg:grid grid-cols-[28px_72px_minmax(120px,1fr)_120px_minmax(100px,1fr)_90px_150px_68px_72px_80px_28px] gap-2 items-center px-5 py-3 bg-slate-50/80 border-b border-slate-100">
          <button type="button" onClick={toggleSelectAll} className="flex items-center justify-center w-7 h-7 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            aria-label="Sélectionner tous les tickets de la page"
            aria-pressed={selectedIds.size === displayedTickets.length && displayedTickets.length > 0}>
            {selectedIds.size === displayedTickets.length && displayedTickets.length > 0
              ? <SquareCheck className="w-4 h-4 text-brand-600" aria-hidden="true" />
              : <Square className="w-4 h-4 text-slate-400" aria-hidden="true" />}
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
              <div key={i} className="px-5 py-3.5 flex items-center gap-3">
                <div className="w-7 h-7 rounded-full animate-shimmer shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 animate-shimmer rounded" />
                  <div className="h-3 w-48 animate-shimmer rounded" />
                </div>
                <div className="hidden lg:block h-6 w-20 animate-shimmer rounded-lg" />
                <div className="hidden lg:block h-6 w-28 animate-shimmer rounded-lg" />
              </div>
            ))}
          </div>
        ) : dashError && !dashData ? (
          <div className="py-12 px-6 text-center" role="alert">
            <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" aria-hidden="true" />
            <p className="text-slate-800 font-semibold">Impossible de charger les tickets</p>
            <p className="text-sm text-slate-600 mt-1">{dashError.message || 'Erreur réseau'}</p>
            <button type="button" onClick={() => mutate()}
              className="btn-secondary mt-4 min-h-[44px] inline-flex items-center gap-1.5 text-sm">
              <RefreshCw className="w-4 h-4" aria-hidden="true" /> Réessayer
            </button>
          </div>
        ) : displayedTickets.length === 0 ? (
          <div className="py-16 px-6 text-center motion-safe:animate-[fadeIn_0.3s_ease-out_both]" role="status">
            <div className="relative w-20 h-20 mx-auto mb-5" aria-hidden="true">
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-brand-100 to-indigo-100 blur-xl opacity-60" />
              <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-brand-50 to-indigo-50 border border-brand-100 flex items-center justify-center">
                <Inbox className="w-9 h-9 text-brand-400" />
              </div>
            </div>
            <p className="text-slate-800 font-semibold text-base">{emptyState.title}</p>
            <p className="text-sm text-slate-500 mt-1.5 max-w-md mx-auto">{emptyState.text}</p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {emptyState.action && (
                <button type="button" onClick={emptyState.action.onClick}
                  className="btn-secondary min-h-[44px] inline-flex items-center gap-1.5 text-sm">
                  {emptyState.action.label}
                </button>
              )}
              <button type="button" onClick={() => navigate('/client')}
                className="btn-primary min-h-[44px] inline-flex items-center gap-1.5 text-sm">
                <Plus className="w-4 h-4" aria-hidden="true" /> Nouveau ticket
              </button>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-100/80">
            {displayedTickets.map((t, rowIdx) => {
              const archivedRow = ARCHIVE_STATUTS.includes(t.statut);
              const showArchiveSeparator = searchMode && archivedRow
                && (rowIdx === 0 || !ARCHIVE_STATUTS.includes(displayedTickets[rowIdx - 1].statut));
              const clientName = `${t.client_prenom || ''} ${t.client_nom || ''}`.trim();
              return (
              <Fragment key={t.id}>
              {showArchiveSeparator && (
                <div className="px-4 sm:px-5 py-2 bg-slate-100/70 text-xs font-semibold text-slate-700">
                  Rendus ou clôturés — {archivedTickets.length} résultat{archivedTickets.length > 1 ? 's' : ''} dans les archives (retour garantie, historique)
                </div>
              )}
              <div
                className={`lg:grid lg:grid-cols-[28px_72px_minmax(120px,1fr)_120px_minmax(100px,1fr)_90px_150px_68px_72px_80px_28px] gap-2 items-center px-4 sm:px-5 ${compactMode ? 'py-2' : 'py-3'} ${searchMode && archivedRow ? 'bg-slate-50/60' : ''} hover:bg-brand-50/40 hover:shadow-[inset_3px_0_0_0] hover:shadow-brand-500 transition-colors duration-200 group relative`}
                style={{ borderLeft: `3px solid transparent`, borderLeftColor: 'transparent' }}
                onMouseEnter={(e) => { e.currentTarget.style.borderLeftColor = getStatusConfig(t.statut).color; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderLeftColor = 'transparent'; }}
              >
                {/* Checkbox */}
                <div className="hidden lg:flex items-center justify-center">
                  <button type="button" onClick={() => toggleSelect(t.id)}
                    className="w-7 h-7 flex items-center justify-center rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    aria-label={`Sélectionner ${t.ticket_code}`} aria-pressed={selectedIds.has(t.id)}>
                    {selectedIds.has(t.id)
                      ? <SquareCheck className="w-4 h-4 text-brand-600" aria-hidden="true" />
                      : <Square className="w-4 h-4 text-slate-400 group-hover:text-slate-500" aria-hidden="true" />}
                  </button>
                </div>

                {/* Ticket code */}
                <div className="cursor-pointer" onClick={() => openTicket(t.id)}>
                  <div className="flex items-center gap-1">
                    {t.attention && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" title="Attention" />}
                    <a href={`${basePath}/ticket/${t.id}`} data-ticket-link=""
                      onClick={(e) => openTicketLink(e, t.id)}
                      onKeyDown={(e) => {
                        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                        const links = [...document.querySelectorAll('[data-ticket-link]')];
                        const idx = links.indexOf(e.currentTarget);
                        const next = links[idx + (e.key === 'ArrowDown' ? 1 : -1)];
                        e.preventDefault();
                        if (next) next.focus();
                        else if (e.key === 'ArrowUp') document.getElementById('dashboard-search')?.focus();
                      }}
                      aria-label={`Ouvrir le ticket ${t.ticket_code}${clientName ? `, ${clientName}` : ''}, ${t.statut}`}
                      className="inline-flex items-center min-h-[32px] text-xs font-bold text-brand-700 font-mono rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1">
                      {t.ticket_code}
                    </a>
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
                    {/* État de la validation devis : vert si validé, orange si en attente, rien sinon */}
                    {ticketInteractions[t.id]?.accord_client_valide ? (
                      <span
                        className="w-3.5 h-3.5 rounded-full bg-emerald-500 ring-2 ring-emerald-200 motion-safe:animate-pulse"
                        title="Client a validé le devis — tu peux démarrer la réparation"
                        aria-label="Devis validé par le client"
                      />
                    ) : t.statut === "En attente d'accord client" ? (
                      <span
                        className="w-3.5 h-3.5 rounded-full bg-amber-500 ring-2 ring-amber-200 motion-safe:animate-pulse"
                        title="En attente de l'accord client — à relancer"
                        aria-label="En attente d'accord client"
                      />
                    ) : null}
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
                      <p className="text-[11px] text-slate-500 font-mono truncate" title={t.client_tel || ''}>{t.client_tel || ''}</p>
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
                    aria-label={`Technicien du ticket ${t.ticket_code}`}
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
                    aria-label={`Statut du ticket ${t.ticket_code}`}
                    onChange={e => handleInlineStatus(t, e.target.value)}
                    className="w-full min-h-[44px] lg:min-h-0 py-1.5 px-2 text-[11px] font-semibold rounded-lg border-2 cursor-pointer appearance-none bg-no-repeat truncate"
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
                        <Calendar className="w-2.5 h-2.5" aria-hidden="true" /> {ri.text}
                      </p>
                    );
                  })()}
                </div>

                {/* Contact icons — colored if message sent via that channel */}
                <div className="flex items-center gap-1 mt-2 lg:mt-0">
                  <a href={t.client_tel ? waLink(t.client_tel, `Bonjour, concernant votre ticket ${t.ticket_code}...`) : '#'}
                    target="_blank" rel="noopener noreferrer"
                    onClick={e => { if (!t.client_tel) e.preventDefault(); e.stopPropagation(); }}
                    aria-label={`WhatsApp à ${clientName || 'ce client'}${t.msg_whatsapp ? ' (déjà contacté)' : ''}`}
                    className="w-11 h-11 lg:w-auto lg:h-auto lg:p-1.5 inline-flex items-center justify-center rounded-md hover:bg-green-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" title="WhatsApp">
                    <MessageCircle className={`w-3.5 h-3.5 ${t.msg_whatsapp ? 'text-green-500' : 'text-slate-300'}`} aria-hidden="true" />
                  </a>
                  <a href={t.client_tel ? smsLink(t.client_tel, `Klikphone: Votre ticket ${t.ticket_code}...`) : '#'}
                    onClick={e => { if (!t.client_tel) e.preventDefault(); e.stopPropagation(); }}
                    aria-label={`SMS à ${clientName || 'ce client'}${t.msg_sms ? ' (déjà contacté)' : ''}`}
                    className="w-11 h-11 lg:w-auto lg:h-auto lg:p-1.5 inline-flex items-center justify-center rounded-md hover:bg-blue-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" title="SMS">
                    <Send className={`w-3.5 h-3.5 ${t.msg_sms ? 'text-blue-500' : 'text-slate-300'}`} aria-hidden="true" />
                  </a>
                  <a href={t.client_email ? `mailto:${t.client_email}` : '#'}
                    onClick={e => { if (!t.client_email) e.preventDefault(); e.stopPropagation(); }}
                    aria-label={`Email à ${clientName || 'ce client'}${t.msg_email ? ' (déjà contacté)' : ''}`}
                    className="w-11 h-11 lg:w-auto lg:h-auto lg:p-1.5 inline-flex items-center justify-center rounded-md hover:bg-amber-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" title="Email">
                    <Mail className={`w-3.5 h-3.5 ${t.msg_email ? 'text-amber-500' : 'text-slate-300'}`} aria-hidden="true" />
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
                  <div className="kp-drag-handle opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-0.5 px-1 py-0.5 rounded hover:bg-slate-100" title="Glisser pour déplacer" aria-hidden="true">
                    <span className="block w-0.5 h-0.5 bg-slate-400 rounded-full" />
                    <span className="block w-0.5 h-0.5 bg-slate-400 rounded-full" />
                    <span className="block w-0.5 h-0.5 bg-slate-400 rounded-full" />
                    <span className="block w-0.5 h-0.5 bg-slate-400 rounded-full" />
                    <span className="block w-0.5 h-0.5 bg-slate-400 rounded-full" />
                    <span className="block w-0.5 h-0.5 bg-slate-400 rounded-full" />
                  </div>
                  <button type="button" tabIndex={-1} aria-hidden="true" className="p-0.5 rounded cursor-pointer" onClick={() => openTicket(t.id)}>
                    <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-brand-500 motion-safe:group-hover:translate-x-0.5 transition-all" />
                  </button>
                </div>
              </div>
              </Fragment>
              );
            })}
          </div>
        )}

        {/* Pagination (compteur basé sur le total serveur pour les archives) */}
        {totalCount > 10 && (displayedTickets.length > 0 || loading) && (
          <nav aria-label="Pagination des tickets"
            className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-5 py-2 border-t border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600">
                {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, totalCount)} sur {totalCount}
              </span>
              <label htmlFor="dashboard-page-size" className="sr-only">Tickets par page</label>
              <select id="dashboard-page-size" value={pageSize} onChange={e => handlePageSizeChange(Number(e.target.value))}
                className="text-xs min-h-[36px] border border-slate-200 rounded-md px-2 py-1 bg-white text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                {[10, 25, 50, 100].map(n => (
                  <option key={n} value={n}>{n} / page</option>
                ))}
              </select>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setPage(safePage - 1)} disabled={safePage === 0}
                  aria-label="Page précédente"
                  className="w-11 h-11 sm:w-9 sm:h-9 flex items-center justify-center rounded-md hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                  <ChevronLeft className="w-4 h-4 text-slate-600" aria-hidden="true" />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i)
                  .slice(Math.max(0, safePage - 2), safePage + 3)
                  .map((i) => (
                    <button key={i} type="button" onClick={() => setPage(i)}
                      aria-label={`Page ${i + 1}`}
                      aria-current={i === safePage ? 'page' : undefined}
                      className={`w-11 h-11 sm:w-9 sm:h-9 rounded-md text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                        i === safePage ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                      }`}>
                      {i + 1}
                    </button>
                  ))}
                <button type="button" onClick={() => setPage(safePage + 1)} disabled={safePage >= totalPages - 1}
                  aria-label="Page suivante"
                  className="w-11 h-11 sm:w-9 sm:h-9 flex items-center justify-center rounded-md hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                  <ChevronRight className="w-4 h-4 text-slate-600" aria-hidden="true" />
                </button>
              </div>
            )}
          </nav>
        )}
      </div>

      {/* ─── Stats business compactes (en pied de dashboard) ──────── */}
      <div className="mt-8 pt-6 border-t border-slate-200/70">
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-3">Statistiques du jour</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Tickets aujourd'hui", value: extraKpis.todayCount, icon: Sparkles, color: 'text-brand-600', bg: 'bg-brand-500/10' },
            { label: 'En attente', value: extraKpis.enAttente, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-500/10' },
            { label: 'CA estimé (en cours)', value: extraKpis.ca === null ? '—' : formatPrix(extraKpis.ca), icon: Euro, color: 'text-emerald-600', bg: 'bg-emerald-500/10' },
            { label: 'Prêts à rendre', value: extraKpis.prets, icon: CheckCircle2, color: 'text-violet-600', bg: 'bg-violet-500/10' },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/60 border border-slate-100">
              <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center shrink-0`} aria-hidden="true">
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 truncate">{label}</p>
                <p className="text-base font-bold text-slate-800 tracking-tight truncate">{value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
