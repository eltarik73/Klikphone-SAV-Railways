import { useState, useEffect, useRef, useMemo, useCallback, useTransition, useId, Fragment, lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import { useApi, invalidateCache, prefetch } from '../hooks/useApi';
import { usePolling } from '../hooks/usePolling';
import { formatDateShort, formatPrix, waLink, smsLink, STATUTS, getStatusConfig } from '../lib/utils';
import { telJoignable, estAutreNumero, normaliserContact, appliquerContact, titreCanal } from '../lib/contact';
import { ARCHIVE_STATUTS, detectQueryKind, openSearchPalette } from '../components/SearchPalette';
import { openQuickScan } from '../components/ScanListener';
import { useToast } from '../components/Toast';
import EtagereARecuperer from '../components/EtagereARecuperer';
import { PrioriteBadge, PRIORITES, comparerPriorite, normaliserPriorite } from '../components/PrioriteBadge';
import { PastilleDelai } from '../components/DelaiReparation';
import { delaiTicket, infoDelai, instantDelai, dateHeureCourte } from '../lib/delai';
import {
  Search, Plus, RefreshCw, AlertTriangle,
  Wrench, CheckCircle2, Package, ChevronRight, ChevronDown, ChevronLeft,
  Smartphone, MessageCircle, Send, Mail, Phone, PhoneCall, Lock, Shield,
  SquareCheck, Square, X, ArrowUpDown, Calendar, RotateCcw, Globe, Star,
  Clock, Euro, Sparkles, Maximize2, Minimize2, Inbox, PackageCheck, ClipboardList, Hourglass, FileCheck,
} from 'lucide-react';

// Grille du tableau (≥ lg). Deux paliers pour que tout tienne sans défilement horizontal (mesuré : carte de
// 670 px utiles à 1024, 926 à 1280, 1 086 à 1440, 1 182 dès 1536 — barre latérale 256 px, marges, page ≤ 1 280 px) :
// - iPad 1024–1279 : 6 colonnes sur DEUX lignes de grille — ligne 1 = case, code, client, statut (≥ 190 px, ≈ 222 px
//   réels), prix, chevron ; ligne 2 = bandeau d'actions (tech · contact · date) sous le client. Rien n'est masqué au
//   comptoir et les commandes gardent 44 px sous le doigt.
// - ≥ 1280 : 9 colonnes sur une ligne (≈ 920 px) ; la sous-ligne « tél · appareil · panne » peut passer sur 2 lignes
//   (3 lignes de texte tiennent dans les 56 px). Pas de colonnes Appareil/Panne séparées : avec la page plafonnée à
//   1 280 px, 11 colonnes laisseraient ≤ 120 px à l'appareil, à la panne et ≤ 206 px au statut (tout coupé), alors
//   que la sous-ligne affiche la panne en entier dès 1440. Contact : 4 icônes de 36 px (WhatsApp, SMS, e-mail, appel).
const GRID_COLS = 'lg:grid-cols-[28px_72px_minmax(170px,1fr)_minmax(190px,1fr)_76px_20px]'
  + ' xl:grid-cols-[28px_72px_minmax(170px,1.4fr)_116px_minmax(170px,1fr)_76px_144px_76px_20px]';
// Icône de contact : 44 px au doigt, 40 à la souris, 36 dans la colonne de 144 px (≥ xl)
const CONTACT_ICON = 'btn-ghost btn-icon w-11 h-11 lg:w-10 lg:h-10 xl:w-9 xl:h-9'
  + ' [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:h-11';

// « 06 00 00 01 23 » (même mise en forme que le panneau de scan), sinon la valeur telle quelle
const formatTel = (tel) => {
  const d = String(tel ?? '').replace(/\D/g, '');
  return d.length === 10 ? d.replace(/(\d{2})(?=\d)/g, '$1 ') : String(tel ?? '');
};

// Panne affichée dans la liste : lignes de la fiche (JSON), sinon la panne saisie
const panneAffichee = (t) => {
  let reps = [];
  try {
    const parsed = JSON.parse(t.reparation_supp || '[]');
    if (Array.isArray(parsed)) reps = parsed.filter(r => r.label).map(r => r.label);
  } catch { /* ancien format */ }
  const aCommander = t.commande_piece === 1 && !t.panne && reps.length === 0;
  if (reps.length === 0 && t.panne) reps = [t.panne];
  return { aCommander, texte: reps.join(' + ') || '—', commande: t.commande_piece === 1 };
};

// Santé des prix : réservée à l'admin, chargée seulement pour lui
const SantePrixWidget = lazy(() => import('../components/SantePrixWidget'));

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

// date_recuperation est du texte libre : seule une valeur AAAA-MM-JJ… est ordonnée (comme texte)
const heurePromise = (t) => {
  const v = typeof t?.date_recuperation === 'string' ? t.date_recuperation.trim() : '';
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 19).replace('T', ' ') : null;
};

/** Ordre atelier : priorité (sur place, express, pro, normal), heure promise, puis dépôt le plus ancien. */
export function comparerUrgence(a, b) {
  const p = comparerPriorite(a?.priorite, b?.priorite);
  if (p) return p;
  const ha = heurePromise(a);
  const hb = heurePromise(b);
  if (ha !== hb) {
    if (ha === null) return 1;
    if (hb === null) return -1;
    return ha < hb ? -1 : 1;
  }
  return String(a?.date_depot || '').localeCompare(String(b?.date_depot || ''));
}

// Appareil présent en boutique et pas encore réparé : la fiche de réception est attendue
const STATUTS_RECEPTION = new Set([
  'En attente de diagnostic', 'En attente de pièce', 'Pièce reçue',
  "En attente d'accord client", 'En cours de réparation',
]);
/** Badge « Réception à compléter » : seulement si le serveur renvoie reception_complete === false. */
export function receptionACompleter(t) {
  return t?.reception_complete === false && STATUTS_RECEPTION.has(t.statut)
    && !['Achat', 'Commande'].includes(t.categorie);
}

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
  // Étagère « À récupérer » (carte KPI) : liste filtrée et triée par le serveur, au-dessus du tableau
  const [showEtagere, setShowEtagere] = useState(false);
  // Ticket dont l'appel téléphonique attend une confirmation (ligne sous la rangée)
  const [appelAConfirmer, setAppelAConfirmer] = useState(null);
  const etagereId = useId();
  const [showArchived, setShowArchived] = useState(initial.archives);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkReport, setBulkReport] = useState(null);
  const [showBulkMenu, setShowBulkMenu] = useState(false);
  const bulkBtnRef = useRef(null);
  const bulkMenuRef = useRef(null);
  const bulkMenuId = useId();
  const [filterTech, setFilterTech] = useState(initial.tech);
  const [filterPriorite, setFilterPriorite] = useState('');
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
    sortField, sortDir, dateFrom, dateTo, filterTech, filterPriorite, pageSize,
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

  // Ferme la confirmation et rend le focus à l'icône téléphone de la ligne (la ligne de confirmation disparaît)
  const fermerAppel = (ticketId) => {
    setAppelAConfirmer(null);
    requestAnimationFrame(() => document.querySelector(`[data-appel-btn="${ticketId}"]`)?.focus());
  };

  // « Contacté par tél. » depuis la colonne contact : note 'appel' sur le ticket, icône allumée sans recharger
  const noterAppel = async (ticket) => {
    const ticketId = ticket.id;
    fermerAppel(ticketId);
    try {
      const res = await api.contacterClient(ticketId);
      mutate(prev => prev ? {
        ...prev,
        tickets: prev.tickets.map(t => (t.id === ticketId
          ? { ...t, contact: res?.contact ? normaliserContact(res.contact) : appliquerContact(t.contact, 'appel', undefined, techName) }
          : t)),
      } : prev);
      toast.success('Appel noté');
    } catch (err) {
      toast.error(`${ticket.ticket_code || `#${ticketId}`} : ${err?.message || 'appel non noté'}`);
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

  const handleKpiClick = (filter, idx, etagere) => {
    if (etagere) {
      setShowEtagere(v => !v);
      return;
    }
    setShowEtagere(false);
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
    if (filterPriorite) {
      list = list.filter(t => normaliserPriorite(t.priorite) === filterPriorite);
    }
    return list;
  }, [tickets, filterTech, techOnServer, mineOnly, techName, interactionTicketIds, filterPriorite]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clients qui attendent en boutique (vue des actifs : liste complète)
  const nbAttenteSurPlace = useMemo(() => {
    if (vue !== 'actifs') return 0;
    return tickets.filter(t => normaliserPriorite(t.priorite) === 'attente' && !ARCHIVE_STATUTS.includes(t.statut)).length;
  }, [tickets, vue]);

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
  const hasListFilters = Boolean(searchMode || filterStatut || dateFrom || dateTo || filterTech || interactionTicketIds || filterPriorite);
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
          // Texte libre : seules les valeurs datables sont ordonnées, les autres (et les vides) en dernier
          const da = instantDelai(a.date_recuperation);
          const db = instantDelai(b.date_recuperation);
          cmp = da === db ? 0 : da < db ? -1 : 1;
          break;
        }
        case 'statut':
          cmp = (a.statut || '').localeCompare(b.statut || '');
          break;
        case 'priorite':
          cmp = comparerUrgence(a, b);
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
    const resetFilters = () => { setFilterStatut(''); setActiveKpi(null); setInteractionFilter(null); setFilterTech(''); setFilterPriorite(''); };
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
          text: `${tickets.length} ticket(s) correspondent à « ${debouncedSearch} » mais sont masqués par le filtre technicien, priorité ou interactions.`,
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

  // Une seule couleur de valeur (slate-900), icône brand ; seule « À récupérer » (étagère) est verte
  const kpiCards = kpi ? [
    { label: 'Total actifs', value: kpi.total_actifs, icon: Smartphone },
    { label: 'Diagnostic', value: kpi.en_attente_diagnostic, icon: Search, filter: 'En attente de diagnostic' },
    { label: 'Réparation', value: kpi.en_cours, icon: Wrench, filter: 'En cours de réparation' },
    { label: 'Accord client', value: kpi.en_attente_accord, icon: AlertTriangle, filter: "En attente d'accord client" },
    { label: 'Pièces', value: kpi.en_attente_piece, icon: Package, filter: 'En attente de pièce' },
    { label: 'À récupérer', value: kpi.a_recuperer ?? 0, icon: PackageCheck, tone: 'bg-emerald-50 text-emerald-700', etagere: true },
  ] : [];

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
    <div className="page max-w-[1280px] relative">
      {/* Revalidation indicator */}
      {isRevalidating && (
        <div className="absolute top-0 left-0 right-0 h-0.5 overflow-hidden z-10" aria-hidden="true">
          <div className="h-full bg-brand-400/60 motion-safe:animate-progress-bar motion-reduce:w-full" />
        </div>
      )}

      {/* ─── En-tête de page (patron commun du back-office) ─── */}
      <div className="page-header">
        <div className="min-w-0">
          <h1 className="page-header-title">
            {user?.target === 'tech' ? 'Espace Technicien' : 'Tableau de bord'}
          </h1>
          <p className="page-header-subtitle">
            <span className="first-letter:uppercase">
              {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </span>
            {' · '}
            {user?.target === 'tech'
              ? <>Bienvenue <span className="font-semibold text-slate-700">{user?.utilisateur || ''}</span> — vos réparations en cours</>
              : <><span className="font-semibold text-slate-700">{extraKpis.enAttente}</span> ticket{extraKpis.enAttente > 1 ? 's' : ''} en attente · <span className="font-semibold text-slate-700">{extraKpis.todayCount}</span> nouveau{extraKpis.todayCount > 1 ? 'x' : ''} aujourd'hui</>}
          </p>
        </div>
        <div className="page-header-actions">
          <button type="button" onClick={toggleCompact}
            className="btn-secondary btn-icon"
            title={compactMode ? 'Mode confortable' : 'Mode compact'}
            aria-label={compactMode ? 'Mode confortable' : 'Mode compact'}
            aria-pressed={compactMode}>
            {compactMode ? <Maximize2 aria-hidden="true" /> : <Minimize2 aria-hidden="true" />}
          </button>
          <button type="button" onClick={() => mutate()}
            className="btn-secondary btn-icon"
            title="Rafraîchir"
            aria-label="Rafraîchir">
            <RefreshCw className={loading ? 'motion-safe:animate-spin' : ''} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => navigate('/client?staff=1')} className="btn-primary">
            <Plus aria-hidden="true" /> Nouveau ticket
          </button>
        </div>
      </div>

      {/* KPI — 6 tuiles cliquables : bande défilable sous lg (le 1er ticket reste visible sur iPad
          portrait), grille de 6 à partir de lg (icône au-dessus à 1024, à gauche dès 1280) */}
      <div className="scroll-fade-x lg:[mask-image:none] lg:[-webkit-mask-image:none] -mx-4 sm:-mx-6 lg:mx-0 mb-6">
        <div className="flex gap-3 overflow-x-auto scrollbar-none snap-x px-4 sm:px-6 lg:px-0 lg:grid lg:grid-cols-6 lg:overflow-visible">
          {!kpi && loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton shrink-0 lg:shrink min-w-[150px] lg:min-w-0 min-h-[72px] lg:min-h-[96px]" aria-hidden="true" />
            ))
          ) : kpiCards.map(({ label, value, icon: Icon, tone, filter, etagere }, i) => {
            const actif = etagere ? showEtagere : activeKpi === i;
            return (
            <button key={label} type="button"
              onClick={() => handleKpiClick(filter, i, etagere)}
              {...(etagere
                ? { 'aria-expanded': showEtagere, 'aria-controls': showEtagere ? etagereId : undefined }
                : { 'aria-pressed': actif })}
              className={`card snap-start shrink-0 lg:shrink min-w-[150px] lg:min-w-0 min-h-[72px] lg:min-h-[96px] p-3 lg:p-4
                flex items-center gap-3 lg:flex-col lg:items-start lg:gap-2 xl:flex-row xl:gap-3 text-left
                transition-colors duration-150 hover:border-slate-300
                focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2
                ${actif ? 'border-brand-300 bg-brand-50/40 hover:border-brand-300' : ''}`}
            >
              <span className={`kpi-icon ${tone || ''}`} aria-hidden="true">
                <Icon />
              </span>
              <span className="min-w-0">
                <span className="block kpi-value text-xl lg:text-2xl">{value}</span>
                <span className="block kpi-label truncate">{label}</span>
              </span>
            </button>
            );
          })}
        </div>
      </div>

      {showEtagere && (
        <EtagereARecuperer id={etagereId} basePath={basePath} onOpenTicket={openTicket}
          onRemettre={ouvrirRemise} onClose={() => setShowEtagere(false)} />
      )}

      {/* ★ Chips d'alerte — commandes, dépôts distants, interactions (une seule teinte, sauf « sur place ») */}
      {(commandesEnCours > 0 || (kpi?.pre_enregistres > 0) || (interactions && interactions.total_actions > 0) || nbAttenteSurPlace > 0) && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {nbAttenteSurPlace > 0 && (
            <button type="button" onClick={() => setFilterPriorite(f => (f === 'attente' ? '' : 'attente'))}
              aria-pressed={filterPriorite === 'attente'}
              className={`btn btn-sm rounded-full text-sm font-medium ${
                filterPriorite === 'attente' ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-red-50 text-red-700 hover:bg-red-100'
              }`}>
              <Hourglass aria-hidden="true" />
              <span><span className="font-bold">{nbAttenteSurPlace}</span> client{nbAttenteSurPlace > 1 ? 's' : ''} sur place</span>
            </button>
          )}
          {commandesEnCours > 0 && (
            <button type="button" onClick={() => navigate(`${basePath}/commandes`)}
              className="btn btn-sm rounded-full text-sm font-medium bg-slate-100 text-slate-700 hover:bg-slate-200">
              <Package className="text-slate-500" aria-hidden="true" />
              <span className="font-bold text-brand-700">{commandesEnCours}</span>
              <span>commande{commandesEnCours > 1 ? 's' : ''} pièces</span>
              <ChevronRight className="text-slate-400" aria-hidden="true" />
            </button>
          )}
          {kpi?.pre_enregistres > 0 && (
            <button type="button" onClick={() => { setFilterStatut('Pré-enregistré'); setActiveKpi(null); setShowArchived(false); }}
              className="btn btn-sm rounded-full text-sm font-medium bg-slate-100 text-slate-700 hover:bg-slate-200">
              <Globe className="text-slate-500" aria-hidden="true" />
              <span className="font-bold text-brand-700">{kpi.pre_enregistres}</span>
              <span>dépôt{kpi.pre_enregistres > 1 ? 's' : ''} à distance</span>
              <ChevronRight className="text-slate-400" aria-hidden="true" />
            </button>
          )}
          {interactions?.accord_client?.count > 0 && (
            <button type="button" onClick={() => setInteractionFilter(interactionFilter === 'accord_client' ? null : 'accord_client')}
              aria-pressed={interactionFilter === 'accord_client'}
              className={`btn btn-sm rounded-full text-sm font-medium ${
                interactionFilter === 'accord_client' ? 'bg-brand-100 text-brand-800 hover:bg-brand-100' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}>
              <FileCheck className={interactionFilter === 'accord_client' ? '' : 'text-slate-500'} aria-hidden="true" />
              <span className="font-bold text-brand-700">{interactions.accord_client.count}</span>
              <span>accord{interactions.accord_client.count > 1 ? 's' : ''}</span>
            </button>
          )}
          {interactions?.messages?.count > 0 && (
            <button type="button" onClick={() => setInteractionFilter(interactionFilter === 'messages' ? null : 'messages')}
              aria-pressed={interactionFilter === 'messages'}
              className={`btn btn-sm rounded-full text-sm font-medium ${
                interactionFilter === 'messages' ? 'bg-brand-100 text-brand-800 hover:bg-brand-100' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}>
              <MessageCircle className={interactionFilter === 'messages' ? '' : 'text-slate-500'} aria-hidden="true" />
              <span className="font-bold text-brand-700">{interactions.messages.count}</span>
              <span>message{interactions.messages.count > 1 ? 's' : ''} client</span>
            </button>
          )}
          {interactions?.avis?.count > 0 && (
            <button type="button" onClick={() => setInteractionFilter(interactionFilter === 'avis' ? null : 'avis')}
              aria-pressed={interactionFilter === 'avis'}
              className={`btn btn-sm rounded-full text-sm font-medium ${
                interactionFilter === 'avis' ? 'bg-brand-100 text-brand-800 hover:bg-brand-100' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}>
              <Star className={interactionFilter === 'avis' ? '' : 'text-slate-500'} aria-hidden="true" />
              <span className="font-bold text-brand-700">{interactions.avis.count}</span>
              <span>avis</span>
            </button>
          )}
          {interactionFilter && (
            <button type="button" onClick={() => setInteractionFilter(null)} className="btn-ghost btn-sm ml-auto">
              <X aria-hidden="true" /> Réinitialiser
            </button>
          )}
        </div>
      )}

      {/* Search & Filters */}
      <div className="card mb-6">
        <div className="p-3 sm:p-4 border-b border-slate-100">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" aria-hidden="true" />
              <label htmlFor="dashboard-search" className="sr-only">Rechercher un ticket</label>
              <input id="dashboard-search" type="text" placeholder="Nom, téléphone, IMEI, code, modèle, panne..."
                value={search} onChange={(e) => setSearch(e.target.value)}
                onKeyDown={onSearchKeyDown}
                enterKeyHint="search"
                autoComplete="off"
                aria-describedby="dashboard-search-hint"
                className="input min-h-11 pl-10 pr-11"
              />
              <span id="dashboard-search-hint" className="sr-only">Entrée ouvre le premier résultat, flèche bas pour parcourir la liste.</span>
              {search && (
                <button type="button" onClick={() => setSearch('')} aria-label="Effacer la recherche"
                  className="btn-ghost btn-icon absolute right-0.5 top-1/2 -translate-y-1/2">
                  <X aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="inline-flex items-center gap-1.5 min-h-11 px-2.5 rounded-lg border border-slate-200 bg-white transition-colors hover:border-slate-300 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/40">
              <Calendar className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
              {/* Champs 44 px (cible tactile) dans un cadre de 44 px : ils chevauchent d'1 px la bordure du cadre (fond transparent). */}
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} max={dateTo || undefined}
                className="bg-transparent text-base lg:text-sm text-slate-700 outline-none w-[128px] min-h-11 -my-px" title="Déposé à partir du" aria-label="Déposé à partir du" />
              <span className="text-slate-500" aria-hidden="true">→</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} min={dateFrom || undefined}
                className="bg-transparent text-base lg:text-sm text-slate-700 outline-none w-[128px] min-h-11 -my-px" title="Déposé jusqu'au" aria-label="Déposé jusqu'au" />
              {(dateFrom || dateTo) && (
                <button type="button" onClick={() => { setDateFrom(''); setDateTo(''); }}
                  className="btn-ghost btn-icon btn-sm -mr-1" title="Réinitialiser dates" aria-label="Effacer les dates">
                  <X aria-hidden="true" />
                </button>
              )}
            </div>
            <select value={filterPriorite} onChange={e => setFilterPriorite(e.target.value)} aria-label="Filtrer par priorité atelier"
              className="select min-h-11 w-auto min-w-[150px]">
              <option value="">Toutes priorités</option>
              {PRIORITES.map(p => <option key={p.valeur} value={p.valeur}>{p.libelle}</option>)}
            </select>
            {teamList.length > 0 && (
              <select value={filterTech} onChange={e => setFilterTech(e.target.value)} aria-label="Filtrer par technicien"
                className="select min-h-11 w-auto min-w-[150px]">
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
        <div className="px-3 sm:px-4 py-2 bg-slate-50/60 rounded-b-xl">
          <div className="scroll-fade-x xl:[mask-image:none] xl:[-webkit-mask-image:none]">
            <div className="segmented flex w-full">
              {filterTabs.map(({ label, value }) => {
                const count = searchMode ? (value ? (statutCounts[value] || 0) : baseTickets.length) : null;
                return (
                  <button key={value} type="button" aria-pressed={filterStatut === value}
                    onClick={() => startTransition(() => { setFilterStatut(value); setActiveKpi(null); setShowArchived(ARCHIVE_STATUTS.includes(value)); })}
                    className={`segmented-item shrink-0 ${filterStatut === value ? 'segmented-item-active' : ''}`}
                  >
                    {label}
                    {count !== null && <span className="text-slate-500 font-normal">({count})</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Counters */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 mb-2">
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
              className={`btn-ghost btn-sm px-2 ${!showArchived ? 'text-brand-700 hover:text-brand-700' : ''}`}>
              {!showArchived && truncatedBy
                ? `${activeTickets.length} actif(s) affichés sur ${truncatedBy}`
                : `${showArchived ? 'Voir les actifs' : `${activeTickets.length} actif(s)`}`}
            </button>
            <button type="button" onClick={showArchives} aria-pressed={showArchived}
              className={`btn-ghost btn-sm px-2 ${showArchived ? 'text-brand-700 hover:text-brand-700' : ''}`}>
              {showArchived
                ? (serverTotal !== null ? `${serverTotal} archivé(s)` : (loading ? 'Archivés…' : `${archivedTickets.length} archivé(s)`))
                : archivedTotal !== null ? `Voir ${archivedTotal} archivé(s)` : 'Voir les archivés'}
            </button>
          </>
        )}
        {showArchived && !searchMode && filterTech && (
          <p className="w-full t-caption">
            Archives : technicien comparé au nom exact{mineOnly ? ', sans les tickets non assignés' : ''}. Les anciens tickets notés « Nom (rôle) » n’y figurent pas.
          </p>
        )}
      </div>

      {/* Sort controls */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-3">
        <span className="t-caption inline-flex items-center gap-1"><ArrowUpDown className="w-3.5 h-3.5" aria-hidden="true" />Trier par :</span>
        {serverPaged ? (
          <span className="min-h-8 inline-flex items-center t-caption">
            date de dépôt, plus récents d’abord (tri fixe des archives paginées)
          </span>
        ) : (
          <div className="segmented max-w-full scroll-fade-x sm:[mask-image:none] sm:[-webkit-mask-image:none]">
            {[
              { label: 'Date dépôt', value: 'date_depot' },
              { label: 'Nom client', value: 'nom' },
              { label: 'Récupération', value: 'date_recuperation' },
              { label: 'Statut', value: 'statut' },
              { label: 'Priorité', value: 'priorite' },
            ].map(({ label, value }) => (
              <button key={value} type="button"
                aria-pressed={sortField === value}
                onClick={() => {
                  if (sortField === value) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                  else { setSortField(value); setSortDir(value === 'nom' || value === 'priorite' ? 'asc' : 'desc'); }
                }}
                className={`segmented-item shrink-0 ${sortField === value ? 'segmented-item-active' : ''}`}
              >
                {label} {sortField === value && (sortDir === 'asc' ? '↑' : '↓')}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bulk actions bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2 rounded-xl border border-brand-200 bg-brand-50 motion-safe:animate-in">
          <span className="text-sm font-semibold text-brand-800">{selectedIds.size} sélectionné(s)</span>
          <div className="relative ml-auto"
            onKeyDown={e => {
              if (e.key !== 'Escape' || !showBulkMenu) return;
              e.stopPropagation();
              setShowBulkMenu(false);
              bulkBtnRef.current?.focus();
            }}>
            <button type="button" ref={bulkBtnRef} onClick={() => setShowBulkMenu(!showBulkMenu)} disabled={bulkBusy}
              aria-expanded={showBulkMenu} aria-controls={showBulkMenu ? bulkMenuId : undefined}
              className="btn-primary btn-sm">
              {bulkBusy
                ? <><RefreshCw className="motion-safe:animate-spin" aria-hidden="true" /> Changement en cours…</>
                : <>Changer statut <ChevronDown aria-hidden="true" /></>}
            </button>
            {showBulkMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowBulkMenu(false)} />
                <div role="group" id={bulkMenuId} ref={bulkMenuRef} aria-label="Nouveau statut des tickets sélectionnés"
                  className="absolute right-0 top-full mt-1 w-72 card p-1.5 shadow-lg z-50 motion-safe:animate-scale-in">
                  {STATUTS.map(s => (
                    <button type="button" key={s} onClick={() => handleBulkStatus(s)}
                      className="w-full min-h-11 text-left px-3 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-50 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-inset">
                      {s}
                      {STATUTS_REMISE.includes(s) && (
                        <span className="block t-caption">Tickets déjà rendus et réglés ; remise un par un</span>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button type="button" onClick={() => setSelectedIds(new Set())} className="btn-ghost btn-icon"
            aria-label="Annuler la sélection">
            <X aria-hidden="true" />
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
          <div role="status" className="callout callout-warning items-start mb-3">
            <AlertTriangle aria-hidden="true" />
            <div className="flex-1 min-w-0">
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
                          className="btn-secondary btn-sm t-mono font-semibold text-amber-900 border-amber-300 hover:bg-amber-100">
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
                    <li key={r.id}><span className="t-mono font-semibold">{r.ticket_code}</span> : {r.message}</li>
                  ))}
                </ul>
              )}
            </div>
            <button type="button" onClick={() => setBulkReport(null)} aria-label="Fermer le compte rendu"
              className="btn-ghost btn-icon -my-1.5 -mr-2 text-amber-900 hover:bg-amber-100 hover:text-amber-950">
              <X aria-hidden="true" />
            </button>
          </div>
        );
      })()}

      {/* Table */}
      <div aria-busy={loading || isPending}
        className={`card overflow-x-auto motion-safe:transition-opacity duration-150 ${isPending || showingPrevious ? 'opacity-60' : ''}`}>
        <div className={`hidden lg:grid ${GRID_COLS} gap-x-1.5 items-center px-4 min-h-10 bg-slate-50 border-b border-slate-200`}>
          <button type="button" onClick={toggleSelectAll} className="flex items-center justify-center w-7 h-7 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            aria-label="Sélectionner tous les tickets de la page"
            aria-pressed={selectedIds.size === displayedTickets.length && displayedTickets.length > 0}>
            {selectedIds.size === displayedTickets.length && displayedTickets.length > 0
              ? <SquareCheck className="w-4 h-4 text-brand-600" aria-hidden="true" />
              : <Square className="w-4 h-4 text-slate-400" aria-hidden="true" />}
          </button>
          <span className="table-header">Ticket</span>
          <span className="table-header">Client</span>
          <span className="table-header hidden xl:block">Tech</span>
          <span className="table-header">Statut</span>
          <span className="table-header hidden xl:block">Date</span>
          <span className="table-header hidden xl:block">Contact</span>
          <span className="table-header text-right">Prix</span>
          <span></span>
        </div>

        {loading && tickets.length === 0 ? (
          <div className="divide-y divide-slate-100" aria-hidden="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="px-4 min-h-14 flex items-center gap-3">
                <div className="skeleton h-4 w-16 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton-line w-40" />
                  <div className="skeleton h-3 w-56" />
                </div>
                <div className="hidden lg:block skeleton h-9 w-40" />
                <div className="hidden lg:block skeleton h-4 w-14" />
              </div>
            ))}
          </div>
        ) : dashError && !dashData ? (
          <div className="p-4" role="alert">
            <div className="callout callout-danger items-start">
              <AlertTriangle aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold">Impossible de charger les tickets</p>
                <p className="mt-0.5">{dashError.message || 'Erreur réseau'}</p>
                <button type="button" onClick={() => mutate()} className="btn-secondary btn-sm mt-3">
                  <RefreshCw aria-hidden="true" /> Réessayer
                </button>
              </div>
            </div>
          </div>
        ) : displayedTickets.length === 0 ? (
          <div className="empty-state max-h-none motion-safe:animate-in" role="status">
            <div className="empty-state-icon" aria-hidden="true">
              <Inbox />
            </div>
            <p className="t-h2">{emptyState.title}</p>
            <p className="t-body text-slate-500 max-w-md">{emptyState.text}</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {emptyState.action && (
                <button type="button" onClick={emptyState.action.onClick} className="btn-secondary">
                  {emptyState.action.label}
                </button>
              )}
              <button type="button" onClick={() => navigate('/client?staff=1')} className="btn-primary">
                <Plus aria-hidden="true" /> Nouveau ticket
              </button>
            </div>
          </div>
        ) : (
          <div>
            {displayedTickets.map((t, rowIdx) => {
              const archivedRow = ARCHIVE_STATUTS.includes(t.statut);
              const showArchiveSeparator = searchMode && archivedRow
                && (rowIdx === 0 || !ARCHIVE_STATUTS.includes(displayedTickets[rowIdx - 1].statut));
              const clientName = `${t.client_prenom || ''} ${t.client_nom || ''}`.trim();
              const contact = normaliserContact(t.contact);
              const appareil = `${t.marque || ''} ${t.modele || t.modele_autre || ''}`.trim();
              const panne = panneAffichee(t);
              const statusCfg = getStatusConfig(t.statut);
              const techColor = getTechColor(t.technicien_assigne);
              const selected = selectedIds.has(t.id);
              const prix = (t.devis_estime || t.tarif_final) ? (
                <>
                  <p className="text-sm font-semibold tabular-nums text-slate-900">
                    {formatPrix(t.tarif_final || t.devis_estime)}
                  </p>
                  {t.paye ? (
                    <span className="badge badge-sm badge-success mt-0.5">PAYÉ</span>
                  ) : t.acompte > 0 ? (
                    <span className="badge badge-sm badge-neutral mt-0.5">Ac. {formatPrix(t.acompte)}</span>
                  ) : (
                    <span className="badge badge-sm badge-warning mt-0.5">Non payé</span>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-500">
                  <span aria-hidden="true">—</span>
                  <span className="sr-only">Pas de prix</span>
                </p>
              );
              return (
              <Fragment key={t.id}>
              {showArchiveSeparator && (
                <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-700">
                  Rendus ou clôturés — {archivedTickets.length} résultat{archivedTickets.length > 1 ? 's' : ''} dans les archives (retour garantie, historique)
                </div>
              )}
              {/* Ligne : carte 3 lignes sous lg (titre / méta / statut + contact) ; grille à partir de lg —
                  deux lignes de grille sur iPad (données / bandeau d'actions), une seule à partir de xl */}
              <div
                className={`group relative flex flex-col gap-2 px-4 py-3 border-b border-slate-100 last:border-b-0
                  lg:grid ${GRID_COLS} lg:gap-x-1.5 lg:gap-y-1 lg:items-center xl:gap-y-0 xl:py-0
                  ${compactMode ? 'lg:py-1 xl:min-h-12' : 'lg:py-1.5 xl:min-h-14'}
                  transition-colors duration-150 hover:bg-slate-50
                  ${selected ? 'bg-brand-50/60 hover:bg-brand-50/60' : searchMode && archivedRow ? 'bg-slate-50/60' : ''}`}
              >
                {/* Checkbox (sur iPad : centrée sur les deux lignes de la grille) */}
                <div className="hidden lg:flex items-center justify-center lg:row-span-2 xl:row-span-1">
                  <button type="button" onClick={() => toggleSelect(t.id)}
                    className="w-7 h-7 flex items-center justify-center rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    aria-label={`Sélectionner ${t.ticket_code}`} aria-pressed={selected}>
                    {selected
                      ? <SquareCheck className="w-4 h-4 text-brand-600" aria-hidden="true" />
                      : <Square className="w-4 h-4 text-slate-400 group-hover:text-slate-500" aria-hidden="true" />}
                  </button>
                </div>

                {/* Ligne 1 (mobile) : code · client · prix — cellules de la grille à partir de lg */}
                <div className="flex items-start gap-3 min-w-0 lg:contents">
                  {/* Ticket code */}
                  <div className="shrink-0 cursor-pointer lg:min-w-0 lg:row-span-2 xl:row-span-1" onClick={() => openTicket(t.id)}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {t.attention && (
                        <span className="inline-flex shrink-0" title="Attention">
                          <AlertTriangle className="w-4 h-4 text-red-700" aria-hidden="true" />
                          <span className="sr-only">Attention</span>
                        </span>
                      )}
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
                        className="inline-flex items-center min-h-8 t-mono font-bold text-brand-700 rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1">
                        {t.ticket_code}
                      </a>
                      {t.est_retour_sav && (
                        <span className="badge badge-sm badge-danger" title="Retour SAV">
                          <RotateCcw className="w-3 h-3" aria-hidden="true" /> SAV
                        </span>
                      )}
                      {t.source === 'distance' && (
                        <span className="badge badge-sm badge-info" title="Dépôt à distance">
                          <Globe className="w-3 h-3" aria-hidden="true" /> Dist.
                        </span>
                      )}
                      {/* État de la validation devis : validé, en attente, rien sinon */}
                      {ticketInteractions[t.id]?.accord_client_valide ? (
                        <span className="inline-flex shrink-0" role="img"
                          title="Client a validé le devis — tu peux démarrer la réparation"
                          aria-label="Devis validé par le client">
                          <CheckCircle2 className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                        </span>
                      ) : t.statut === "En attente d'accord client" ? (
                        <span className="inline-flex shrink-0" role="img"
                          title="En attente de l'accord client — à relancer"
                          aria-label="En attente d'accord client">
                          <Clock className="w-4 h-4 text-amber-700" aria-hidden="true" />
                        </span>
                      ) : null}
                      {ticketInteractions[t.id]?.messages && (
                        <span className="inline-flex shrink-0" title="Message client non lu">
                          <MessageCircle className="w-4 h-4 text-blue-700" aria-hidden="true" />
                          <span className="sr-only">Message client non lu</span>
                        </span>
                      )}
                      {ticketInteractions[t.id]?.avis && (
                        <span className="inline-flex shrink-0" title="Avis client">
                          <Star className="w-4 h-4 text-amber-700" aria-hidden="true" />
                          <span className="sr-only">Avis client</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Client : nom + priorité + réception sur une ligne, téléphone (· appareil · panne) dessous */}
                  <div className="min-w-0 flex-1 cursor-pointer" onClick={() => navigate(`${basePath}/ticket/${t.id}`)}>
                    {/* Les badges passent sous le nom quand la place manque : le nom reste lisible */}
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
                      <p className="truncate max-w-full text-sm font-semibold text-slate-900" title={clientName}>
                        {t.client_prenom || ''} {t.client_nom || ''}
                      </p>
                      {t.client_carte_camby ? <span className="badge badge-sm badge-brand shrink-0">Camby</span> : null}
                      <PrioriteBadge priorite={t.priorite} court className="shrink-0" />
                      {/* Délai promis : « 15:30 · dans 1 h 20 », « En retard de 25 min », « Délai à fixer » */}
                      <PastilleDelai ticket={t} />
                      {receptionACompleter(t) && (
                        /* Pastille ambre (le libellé complet ne tient sur aucune ligne de 56 px sans la faire déborder) */
                        <span className="badge badge-sm badge-warning shrink-0 px-1.5"
                          title="Fiche de réception (accessoires, état, tests) à compléter">
                          <ClipboardList className="w-3.5 h-3.5" aria-hidden="true" />
                          <span className="sr-only">Réception à compléter</span>
                        </span>
                      )}
                    </div>
                    {/* ≥ xl : la panne peut passer sur une 2ᵉ ligne (3 lignes de texte tiennent dans les 56 px) */}
                    <p className="t-small truncate xl:whitespace-normal xl:line-clamp-2 tabular-nums"
                      title={[t.client_tel, estAutreNumero(t) ? `joignable ${telJoignable(t)}` : '', appareil, panne.texte].filter(Boolean).join(' · ')}>
                      {formatTel(t.client_tel)}
                      {/* Second numéro du ticket : c'est lui que visent les icônes SMS/WhatsApp, la réceptionniste doit le voir */}
                      {estAutreNumero(t) && (
                        <span className="whitespace-nowrap font-medium text-slate-700">{' · '}joignable {formatTel(telJoignable(t))}</span>
                      )}
                      {appareil ? ` · ${appareil}` : ''}
                      {panne.aCommander ? ' · Pièce à commander' : panne.texte !== '—' ? ` · ${panne.texte}` : ''}
                      {/* Côté tech : code et schéma de déverrouillage, comme avant dans la colonne Appareil */}
                      {isTech && t.pin && (
                        <span className="t-mono text-amber-800 whitespace-nowrap">
                          {' · '}<Lock className="inline w-3.5 h-3.5 -mt-0.5" aria-hidden="true" /> {t.pin}
                        </span>
                      )}
                      {isTech && t.pattern && (
                        <span className="t-mono text-violet-800 whitespace-nowrap">
                          {' · '}<Shield className="inline w-3.5 h-3.5 -mt-0.5" aria-hidden="true" /> {t.pattern}
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Prix (mobile, à droite du titre) */}
                  <div className="lg:hidden shrink-0 text-right cursor-pointer" onClick={() => navigate(`${basePath}/ticket/${t.id}`)}>
                    {prix}
                  </div>
                </div>

                {/* Ligne 3 (mobile) : statut + contact — cellules de la grille à partir de lg.
                    Placement explicite (colonne + ligne) du statut et du tech à partir de xl : les autres cellules
                    se placent automatiquement autour, dans l'ordre du DOM. */}
                <div className="flex items-center gap-2 lg:contents">
                  {/* Statut — inline dropdown neutre + pastille de la couleur du statut (44 px sous le doigt) */}
                  <div className="relative flex-1 min-w-0 xl:col-start-5 xl:row-start-1" onClick={e => e.stopPropagation()}>
                    <span className={`pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full ${statusCfg.dot}`} aria-hidden="true" />
                    <select
                      value={t.statut}
                      aria-label={`Statut du ticket ${t.ticket_code}`}
                      onChange={e => handleInlineStatus(t, e.target.value)}
                      className="select min-h-11 lg:min-h-9 lg:py-1 [@media(pointer:coarse)]:min-h-11 pl-6 pr-7 text-base lg:text-sm font-medium text-slate-800 truncate"
                    >
                      {STATUTS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>

                  {/* Bandeau d'actions : tech · contact · date. Mobile : icônes de contact à droite du statut ;
                      iPad (lg) : 2ᵉ ligne de la grille sous le client ; ≥ xl : chaque bloc retrouve sa colonne. */}
                  <div className="flex items-center gap-1 shrink-0 lg:col-start-3 lg:col-span-3 lg:row-start-2 lg:gap-2 lg:min-w-0 xl:contents">
                    {/* Tech — inline dropdown : neutre, teinté seulement si assigné */}
                    <div className="hidden lg:block lg:w-40 xl:w-auto xl:col-start-4 xl:row-start-1"
                      onClick={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()}>
                      {/* Couleur du technicien (équipe) sur le filet gauche : zéro place prise au nom */}
                      <select
                        value={t.technicien_assigne || ''}
                        aria-label={`Technicien du ticket ${t.ticket_code}`}
                        onChange={e => { const val = e.target.value; handleInlineTech(t.id, val); }}
                        style={techColor ? { borderLeftColor: techColor, borderLeftWidth: '3px' } : undefined}
                        className={`select min-h-11 lg:min-h-9 lg:py-1 [@media(pointer:coarse)]:min-h-11 pl-2 pr-7 text-sm font-medium truncate ${
                          t.technicien_assigne ? 'text-brand-700 bg-brand-50 border-brand-200' : 'text-slate-500'}`}
                      >
                        <option value="">— Aucun</option>
                        {teamList.map(m => (
                          <option key={m.id} value={m.nom}>{m.nom}</option>
                        ))}
                      </select>
                    </div>

                    {/* Contact — vers le second numéro du ticket s'il existe (lib/contact.js). Icône allumée (emerald)
                        quand un contact est parti par ce canal DEPUIS LE DERNIER CHANGEMENT DE STATUT (t.contact,
                        calculé par le serveur) ; l'info-bulle donne la date, l'heure et l'auteur. Le téléphone note
                        un appel (« Contacté par tél. ») après une confirmation légère sous la rangée. */}
                    <div className="flex items-center shrink-0 xl:col-start-7 xl:row-start-1">
                      <a href={telJoignable(t) ? waLink(telJoignable(t), `Bonjour, concernant votre ticket ${t.ticket_code}...`) : '#'}
                        target="_blank" rel="noopener noreferrer"
                        onClick={e => { if (!telJoignable(t)) e.preventDefault(); e.stopPropagation(); }}
                        aria-label={`WhatsApp à ${clientName || 'ce client'}${contact.canaux.whatsapp ? ` (${titreCanal(contact, 'whatsapp')})` : ''}`}
                        className={CONTACT_ICON} title={contact.canaux.whatsapp ? titreCanal(contact, 'whatsapp') : 'WhatsApp'}>
                        <MessageCircle className={contact.canaux.whatsapp ? 'text-emerald-600' : 'text-slate-500'} aria-hidden="true" />
                      </a>
                      <a href={telJoignable(t) ? smsLink(telJoignable(t), `Klikphone: Votre ticket ${t.ticket_code}...`) : '#'}
                        onClick={e => { if (!telJoignable(t)) e.preventDefault(); e.stopPropagation(); }}
                        aria-label={`SMS à ${clientName || 'ce client'}${contact.canaux.sms ? ` (${titreCanal(contact, 'sms')})` : ''}`}
                        className={CONTACT_ICON} title={contact.canaux.sms ? titreCanal(contact, 'sms') : 'SMS'}>
                        <Send className={contact.canaux.sms ? 'text-emerald-600' : 'text-slate-500'} aria-hidden="true" />
                      </a>
                      <a href={t.client_email ? `mailto:${t.client_email}` : '#'}
                        onClick={e => { if (!t.client_email) e.preventDefault(); e.stopPropagation(); }}
                        aria-label={`Email à ${clientName || 'ce client'}${contact.canaux.email ? ` (${titreCanal(contact, 'email')})` : ''}`}
                        className={CONTACT_ICON} title={contact.canaux.email ? titreCanal(contact, 'email') : 'E-mail'}>
                        <Mail className={contact.canaux.email ? 'text-emerald-600' : 'text-slate-500'} aria-hidden="true" />
                      </a>
                      <button type="button" data-appel-btn={t.id}
                        onClick={e => { e.stopPropagation(); setAppelAConfirmer(v => (v === t.id ? null : t.id)); }}
                        aria-label={`Contacté par téléphone : ${clientName || 'ce client'}${contact.canaux.appel ? ` (${titreCanal(contact, 'appel')})` : ''}`}
                        aria-expanded={appelAConfirmer === t.id}
                        className={`${CONTACT_ICON} ${appelAConfirmer === t.id ? 'bg-brand-50 text-brand-700' : ''}`}
                        title={contact.canaux.appel ? titreCanal(contact, 'appel') : 'Contacté par tél.'}>
                        <Phone className={contact.canaux.appel ? 'text-emerald-600' : 'text-slate-500'} aria-hidden="true" />
                      </button>
                    </div>

                    {/* Date de dépôt + heure promise (≥ lg ; à droite du bandeau sur iPad) */}
                    <div className="hidden lg:block lg:ml-auto xl:ml-0 min-w-0 cursor-pointer xl:col-start-6 xl:row-start-1"
                      onClick={() => navigate(`${basePath}/ticket/${t.id}`)}>
                      <p className="t-caption tabular-nums text-slate-600 whitespace-nowrap">{formatDateShort(t.date_depot)}</p>
                      {/* Heure promise d'un ticket sans pastille (réparation terminée…) : rappel neutre */}
                      {t.date_recuperation && !delaiTicket(t) && (() => {
                        const info = infoDelai(t.date_recuperation);
                        const texte = info.date ? `Promis ${dateHeureCourte(info.date)}` : info.libelle;
                        return (
                          <p className="t-caption flex items-center gap-1 mt-0.5 whitespace-nowrap" title={info.titre}>
                            <Calendar className="w-3 h-3 shrink-0" aria-hidden="true" /> <span className="truncate">{texte}</span>
                          </p>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                {/* Prix (≥ lg) */}
                <div className="hidden lg:block text-right cursor-pointer" onClick={() => navigate(`${basePath}/ticket/${t.id}`)}>
                  {prix}
                </div>

                {/* Chevron décoratif : l'ouverture passe par le lien « Ouvrir le ticket » et la cellule cliquable */}
                <div className="hidden lg:flex items-center justify-end self-stretch cursor-pointer lg:row-span-2 xl:row-span-1" onClick={() => openTicket(t.id)}>
                  <span aria-hidden="true" className="p-0.5">
                    <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-brand-600 transition-colors duration-150" />
                  </span>
                </div>
              </div>
              {/* Confirmation légère de l'appel, dans le flux (la carte défile horizontalement : pas de popover) */}
              {appelAConfirmer === t.id && (
                <div role="group" aria-label={`Noter un appel téléphonique à ${clientName || 'ce client'}`}
                  onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); fermerAppel(t.id); } }}
                  className="flex flex-wrap items-center gap-2 px-4 py-2 bg-brand-50/70 border-b border-slate-100 text-sm motion-safe:animate-in">
                  <PhoneCall className="w-4 h-4 text-brand-700 shrink-0" aria-hidden="true" />
                  <span className="font-medium text-slate-800">
                    {clientName || 'Ce client'} ({t.ticket_code}) a été appelé ? L'appel sera noté sur le ticket.
                  </span>
                  <span className="flex items-center gap-1.5">
                    <button type="button" autoFocus onClick={() => noterAppel(t)}
                      className="btn-primary btn-sm [@media(pointer:coarse)]:min-h-11">
                      Oui, noter l'appel
                    </button>
                    <button type="button" onClick={() => fermerAppel(t.id)}
                      className="btn-ghost btn-sm [@media(pointer:coarse)]:min-h-11">
                      Non
                    </button>
                  </span>
                </div>
              )}
              </Fragment>
              );
            })}
          </div>
        )}

        {/* Pagination (compteur basé sur le total serveur pour les archives) */}
        {totalCount > 10 && (displayedTickets.length > 0 || loading) && (
          <nav aria-label="Pagination des tickets"
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-t border-slate-100 bg-slate-50/60">
            <div className="flex items-center gap-2">
              <span className="t-caption tabular-nums">
                {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, totalCount)} sur {totalCount}
              </span>
              <label htmlFor="dashboard-page-size" className="sr-only">Tickets par page</label>
              <select id="dashboard-page-size" value={pageSize} onChange={e => handlePageSizeChange(Number(e.target.value))}
                className="select w-auto min-h-11 lg:min-h-9 lg:py-1 [@media(pointer:coarse)]:min-h-11 text-base lg:text-sm">
                {[10, 25, 50, 100].map(n => (
                  <option key={n} value={n}>{n} / page</option>
                ))}
              </select>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setPage(safePage - 1)} disabled={safePage === 0}
                  aria-label="Page précédente"
                  className="btn-ghost btn-icon btn-sm">
                  <ChevronLeft aria-hidden="true" />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i)
                  .slice(Math.max(0, safePage - 2), safePage + 3)
                  .map((i) => (
                    <button key={i} type="button" onClick={() => setPage(i)}
                      aria-label={`Page ${i + 1}`}
                      aria-current={i === safePage ? 'page' : undefined}
                      className={`btn-ghost btn-icon btn-sm tabular-nums ${
                        i === safePage ? 'bg-brand-50 text-brand-700 font-bold hover:bg-brand-50 hover:text-brand-700' : ''
                      }`}>
                      {i + 1}
                    </button>
                  ))}
                <button type="button" onClick={() => setPage(safePage + 1)} disabled={safePage >= totalPages - 1}
                  aria-label="Page suivante"
                  className="btn-ghost btn-icon btn-sm">
                  <ChevronRight aria-hidden="true" />
                </button>
              </div>
            )}
          </nav>
        )}
      </div>

      {/* ─── Statistiques du jour (pied de page) ──────── */}
      <section className="mt-8 pt-6 border-t border-slate-200" aria-label="Statistiques du jour">
        <h2 className="t-overline mb-3">Statistiques du jour</h2>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            { label: "Tickets aujourd'hui", value: extraKpis.todayCount, icon: Sparkles },
            { label: 'En attente', value: extraKpis.enAttente, icon: Clock },
            { label: 'CA estimé (en cours)', value: extraKpis.ca === null ? '—' : formatPrix(extraKpis.ca), icon: Euro },
            { label: 'Prêts à rendre', value: extraKpis.prets, icon: CheckCircle2 },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="kpi-card-sm items-center">
              <div className="kpi-icon" aria-hidden="true">
                <Icon />
              </div>
              <div className="min-w-0">
                <p className="kpi-value text-xl">{value}</p>
                <p className="kpi-label">{label}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Santé des prix (admin) : prix estimés ou périmés, propositions, modèles sans prix ── */}
      {user?.role === 'admin' && (
        <Suspense fallback={null}>
          <SantePrixWidget basePath={basePath} />
        </Suspense>
      )}
    </div>
  );
}
