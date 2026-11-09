import { useState, useEffect, useRef, useMemo, useCallback, useTransition, useId, Fragment, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import { useApi, invalidateCache, prefetch } from '../hooks/useApi';
import { usePolling } from '../hooks/usePolling';
import { formatPrix, infoReception, waLink, smsLink, STATUTS, getStatusConfig } from '../lib/utils';
import {
  telJoignable, estAutreNumero, normaliserContact, appliquerContact, titreCanal, libelleContact,
} from '../lib/contact';
import { ARCHIVE_STATUTS, detectQueryKind, openSearchPalette } from '../components/SearchPalette';
import { openQuickScan } from '../components/ScanListener';
import { useToast } from '../components/Toast';
import EtagereARecuperer from '../components/EtagereARecuperer';
import { PrioriteBadge, PRIORITES, comparerPriorite, normaliserPriorite } from '../components/PrioriteBadge';
import { PastilleDelai, useMaintenant } from '../components/DelaiReparation';
import { delaiTicket, instantDelai } from '../lib/delai';
import {
  Search, Plus, RefreshCw, AlertTriangle, ChevronRight, ChevronDown, ChevronLeft,
  MessageCircle, MessageSquare, Send, Mail, Phone, PhoneCall, Lock, Shield,
  SquareCheck, Square, X, ArrowUpDown, SlidersHorizontal, Inbox, ClipboardList, Info,
  Maximize2, Minimize2, PackageCheck, MessageSquareMore, Users, Truck, Globe, FileCheck, Star,
} from 'lucide-react';

// Grille du tableau (≥ lg). Deux paliers pour que tout tienne sans défilement horizontal (mesuré : carte de
// 670 px utiles à 1024, 926 à 1280, 1 086 à 1440, 1 182 dès 1536 — barre latérale 256 px, marges, page ≤ 1 280 px) :
// - iPad 1024–1279 : 6 colonnes sur DEUX lignes de grille — ligne 1 = case, code, client, statut, prix, chevron ;
//   ligne 2 = technicien · contact · date sous le client. Rien n'est masqué au comptoir, 44 px sous le doigt.
// - ≥ 1280 : 9 colonnes sur une ligne de 48 px (40 en mode compact) ; la sous-ligne « tél · appareil · panne »
//   est tronquée avec son texte complet en info-bulle. Contact : un seul bouton (menu WhatsApp / SMS / e-mail / appel).
const GRID_COLS = 'lg:grid-cols-[28px_80px_minmax(170px,1fr)_minmax(180px,1fr)_84px_20px]'
  + ' xl:grid-cols-[28px_80px_minmax(170px,1.4fr)_124px_minmax(170px,1fr)_132px_44px_84px_20px]';

// Nombres à l'écran : séparateur de milliers français (« 2 172 »)
const NOMBRE = new Intl.NumberFormat('fr-FR');
const fmt = (n) => NOMBRE.format(Number(n) || 0);

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

// « À faire » : masque les réparations terminées (et rendues / clôturées), pour n'avoir sous les
// yeux que ce qui reste à faire — réglage gardé sur le poste (la technicienne le laisse coché)
const A_FAIRE_KEY = 'kp_dash_a_faire';
export const STATUTS_FAITS = new Set(['Réparation terminée', ...ARCHIVE_STATUTS]);
// Pastilles « accords / messages / avis » : ce qu'un ticket listé porte (GET …/dashboard?interaction=)
export const INTERACTION_LIBELLES = {
  accord_client: 'une réponse au devis non lue',
  messages: 'un message client non lu',
  avis: 'un avis client non lu',
};
function lireAFaire() {
  try { return localStorage.getItem(A_FAIRE_KEY) === '1'; } catch { return false; }
}

// Onglets de vue : par groupe de statuts (le sens d'abord, les terminés à la fin). Un groupe d'un
// seul statut filtre par ce statut (le serveur pagine les archives) ; un groupe de plusieurs statuts
// est filtré ici, sur la liste complète des actifs.
export const GROUPES_STATUT = [
  { cle: '', label: 'Tous', statuts: null },
  { cle: 'diagnostic', label: 'À diagnostiquer', statuts: ['Pré-enregistré', 'En attente de diagnostic'] },
  { cle: 'attente', label: 'En attente', statuts: ['En attente de pièce', "En attente d'accord client"] },
  { cle: 'cours', label: 'En cours', statuts: ['Pièce reçue', 'En cours de réparation'] },
  { cle: 'prets', label: 'Prêts', statuts: ['Réparation terminée'] },
  { cle: 'rendus', label: 'Rendus', statuts: ['Rendu au client'], archives: true },
  { cle: 'clotures', label: 'Clôturés', statuts: ['Clôturé'], archives: true },
];
const GROUPE_PAR_CLE = Object.fromEntries(GROUPES_STATUT.map(g => [g.cle, g]));
const groupeDuStatut = (statut) => GROUPES_STATUT.find(g => g.statuts?.includes(statut))?.cle ?? null;

// Tri : champ + sens par défaut (Récupération : le délai le plus proche ou dépassé d'abord)
const TRIS = [
  { value: 'date_depot', label: 'Date de dépôt', defaut: 'desc' },
  { value: 'nom', label: 'Nom du client', defaut: 'asc' },
  { value: 'date_recuperation', label: 'Récupération', defaut: 'asc' },
  { value: 'statut', label: 'Statut', defaut: 'desc' },
  { value: 'priorite', label: 'Priorité', defaut: 'asc' },
];

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

const pluriel = (n, mot) => `${fmt(n)} ${mot}${n > 1 ? 's' : ''}`;

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

/**
 * Repères secondaires d'une ligne, regroupés en deux indicateurs neutres au plus : ce que le client a
 * laissé (réponse au devis, message, avis) et les particularités du dossier (attention, retour SAV,
 * dépôt à distance, carte Camby, réception à compléter). Le détail est dans l'info-bulle et lu par le
 * lecteur d'écran, élément par élément. Un délai absent n'est pas signalé ici (il l'est sur la fiche,
 * au panneau de scan et par le tri « Récupération ») : il concernerait la plupart des lignes.
 */
export function reperesLigne(t, inter) {
  const client = [];
  if (inter?.accord_client_valide) client.push('Devis validé par le client');
  if (inter?.messages) client.push('Message client non lu');
  if (inter?.avis) client.push('Avis client non lu');
  const dossier = [];
  if (t.attention) dossier.push('Attention');
  if (t.est_retour_sav) dossier.push('Retour SAV');
  if (t.source === 'distance') dossier.push('Dépôt à distance');
  if (t.client_carte_camby) dossier.push('Carte Camby');
  if (receptionACompleter(t)) dossier.push('Réception à compléter');
  return { client, dossier };
}

function Repere({ items, icone: Icone }) {
  if (!items.length) return null;
  return (
    <span className="inline-flex items-center gap-0.5 shrink-0 text-slate-500" title={items.join(' · ')}>
      <Icone className="w-4 h-4" aria-hidden="true" />
      {items.length > 1 && <span className="text-xs tabular-nums" aria-hidden="true">{items.length}</span>}
      <span className="sr-only">
        {items.map((item, i) => <Fragment key={item}>{i > 0 && ', '}<span>{item}</span></Fragment>)}
      </span>
    </span>
  );
}

const MENU_ITEM = 'flex w-full min-h-11 items-center gap-2.5 px-3 text-left text-sm font-medium text-slate-800'
  + ' hover:bg-slate-50 focus-visible:bg-slate-100 focus-visible:outline-none aria-disabled:text-slate-500';
const MENU_HAUTEUR = 192; // 4 lignes de 44 px + marges

/**
 * Un seul bouton de contact par ligne, qui ouvre un menu (WhatsApp, SMS, e-mail, appel) vers le second
 * numéro du ticket s'il existe (lib/contact.js). Icône allumée (emerald) quand un contact est parti
 * depuis le dernier changement de statut (t.contact, calculé par le serveur) ; dans le menu, chaque
 * canal porte sa date, son heure et son auteur. Le menu est rendu hors de la carte (qui défile), en
 * position fixe sous le bouton — au-dessus si la place manque en bas.
 */
function MenuContact({ t, clientName, contact, appelOuvert, onAppel }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();
  const nom = clientName || 'ce client';
  const tel = telJoignable(t);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    const raf = requestAnimationFrame(() => menuRef.current?.querySelector('[role="menuitem"]')?.focus());
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [open]);

  const ouvrir = () => {
    if (open) { setOpen(false); return; }
    const r = btnRef.current?.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - (r?.right ?? window.innerWidth));
    const enBas = (r?.bottom ?? 0) + MENU_HAUTEUR <= window.innerHeight;
    setPos(enBas ? { top: (r?.bottom ?? 0) + 4, right } : { bottom: window.innerHeight - (r?.top ?? 0) + 4, right });
    setOpen(true);
  };
  const fermer = (rendreFocus = true) => {
    setOpen(false);
    if (rendreFocus) btnRef.current?.focus();
  };
  const onKeyDown = (e) => {
    if (!open) return;
    if (e.key === 'Escape') { e.stopPropagation(); fermer(); return; }
    if (e.key === 'Tab') { e.preventDefault(); fermer(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]') || [])];
    if (!items.length) return;
    e.preventDefault();
    const idx = items.indexOf(document.activeElement);
    let next = 0;
    if (e.key === 'ArrowDown') next = (idx + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (idx - 1 + items.length) % items.length;
    else if (e.key === 'End') next = items.length - 1;
    items[next].focus();
  };

  const lien = (canal, href, Icone, texte) => {
    const fait = contact.canaux[canal];
    return (
      <a role="menuitem" href={href || '#'} target="_blank" rel="noopener noreferrer"
        aria-disabled={href ? undefined : true}
        onClick={(e) => { if (!href) e.preventDefault(); fermer(false); }}
        aria-label={`${texte} à ${nom}${fait ? ` (${titreCanal(contact, canal)})` : ''}`}
        title={fait ? titreCanal(contact, canal) : texte}
        className={MENU_ITEM}>
        <Icone className={`w-4 h-4 shrink-0 ${fait ? 'text-emerald-600' : 'text-slate-500'}`} aria-hidden="true" />
        {texte}
        {!href && <span className="ml-auto text-xs text-slate-500">{canal === 'email' ? 'sans e-mail' : 'sans numéro'}</span>}
      </a>
    );
  };

  return (
    <div className="relative" onKeyDown={onKeyDown}>
      <button ref={btnRef} type="button" data-contact-btn={t.id} onClick={ouvrir}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        aria-label={`Contacter ${nom}${contact.depuis_statut ? ` (${libelleContact(contact)})` : ''}`}
        title={contact.depuis_statut ? libelleContact(contact) : 'Contacter le client'}
        className="btn-ghost btn-icon btn-sm">
        <MessageSquare className={contact.depuis_statut ? 'text-emerald-600' : 'text-slate-500'} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div ref={menuRef} id={menuId} role="menu" aria-label={`Contacter ${nom}`}
          style={pos || undefined}
          className="fixed z-50 w-60 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-md">
          {lien('whatsapp', tel ? waLink(tel, `Bonjour, concernant votre ticket ${t.ticket_code}...`) : null, MessageCircle, 'WhatsApp')}
          {lien('sms', tel ? smsLink(tel, `Klikphone: Votre ticket ${t.ticket_code}...`) : null, Send, 'SMS')}
          {lien('email', t.client_email ? `mailto:${t.client_email}` : null, Mail, 'Email')}
          <button type="button" role="menuitem" data-appel-btn={t.id}
            onClick={() => { fermer(false); onAppel(); }}
            aria-expanded={appelOuvert}
            aria-label={`Contacté par téléphone : ${nom}${contact.canaux.appel ? ` (${titreCanal(contact, 'appel')})` : ''}`}
            title={contact.canaux.appel ? titreCanal(contact, 'appel') : 'Contacté par tél.'}
            className={MENU_ITEM}>
            <Phone className={`w-4 h-4 shrink-0 ${contact.canaux.appel ? 'text-emerald-600' : 'text-slate-500'}`} aria-hidden="true" />
            Contacté par téléphone
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}

// Pastilles de la ligne d'alertes : une teinte par sujet (classes complètes pour Tailwind)
const TONS_ALERTE = {
  vert: 'bg-emerald-50 text-emerald-800 ring-emerald-200 group-hover/alerte:bg-emerald-100',
  ambre: 'bg-amber-50 text-amber-900 ring-amber-200 group-hover/alerte:bg-amber-100',
  rouge: 'bg-red-50 text-red-700 ring-red-200 group-hover/alerte:bg-red-100',
  cyan: 'bg-cyan-50 text-cyan-900 ring-cyan-200 group-hover/alerte:bg-cyan-100',
  bleu: 'bg-blue-50 text-blue-800 ring-blue-200 group-hover/alerte:bg-blue-100',
  neutre: 'bg-white text-slate-700 ring-slate-300 group-hover/alerte:bg-slate-50',
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const basePath = user?.target === 'tech' ? '/tech' : '/accueil';
  const [searchParams, setSearchParams] = useSearchParams();
  const now = useMaintenant();

  // L'URL (?q=, ?statut=, ?vue=archives) prime ; sinon on reprend les filtres de la session.
  // Dates, technicien et groupe de statuts ne sont pas dans l'URL : toujours repris de la session.
  const [initial] = useState(() => {
    const fromUrl = searchParams.has('q') || searchParams.has('statut') || searchParams.has('vue');
    const saved = readDashState();
    const q = fromUrl ? (searchParams.get('q') || '') : str(saved.q);
    const statut = fromUrl ? (searchParams.get('statut') || '') : str(saved.statut);
    const archives = fromUrl ? searchParams.get('vue') === 'archives' : Boolean(saved.archives);
    const groupe = fromUrl || statut ? '' : (GROUPE_PAR_CLE[str(saved.groupe)] ? str(saved.groupe) : '');
    return {
      q, statut, groupe, archives: archives || ARCHIVE_STATUTS.includes(statut),
      dateFrom: str(saved.dateFrom), dateTo: str(saved.dateTo), tech: str(saved.tech),
    };
  });

  const [search, setSearch] = useState(initial.q);
  const [debouncedSearch, setDebouncedSearch] = useState(initial.q.trim());
  const [filterStatut, setFilterStatut] = useState(initial.statut);
  const [filterGroupe, setFilterGroupe] = useState(initial.groupe);
  // Étagère « À récupérer » (colonne de la carte d'action) : liste filtrée et triée par le serveur
  const [showEtagere, setShowEtagere] = useState(false);
  const [aFaire, setAFaire] = useState(lireAFaire);
  // Ticket dont l'appel téléphonique attend une confirmation (ligne sous la rangée)
  const [appelAConfirmer, setAppelAConfirmer] = useState(null);
  const etagereId = useId();
  const filtresId = useId();
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
  // Plage de dates derrière un bouton « Dates » : ouverte d'office quand une date est posée
  // Panneau « Filtres » (priorité, technicien, dates) replié par défaut (décision du gérant, 8 nov. 2026) ;
  // ouvert d'emblée si un filtre est déjà posé dans l'adresse ou la session.
  const [filtresOuverts, setFiltresOuverts] = useState(() => Boolean(initial.dateFrom || initial.dateTo || initial.tech));
  const [isPending, startTransition] = useTransition();
  const searchTimer = useRef(null);
  const pendingEnterRef = useRef(false);

  // La page revient à 0 dès qu'un filtre, un onglet, une colonne ou le tri change (sans requête intermédiaire)
  const filterSig = JSON.stringify([
    debouncedSearch, filterStatut, filterGroupe, showArchived, interactionFilter,
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
    writeDashState({
      q: debouncedSearch, statut: filterStatut, groupe: filterGroupe, archives: showArchived, dateFrom, dateTo, tech: filterTech,
    });
  }, [debouncedSearch, filterStatut, filterGroupe, showArchived, dateFrom, dateTo, filterTech]);

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
    setFilterGroupe('');
    setShowArchived(arch === '1' || ARCHIVE_STATUTS.includes(statut));
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
  const toggleAFaire = () => {
    setAFaire((v) => {
      const next = !v;
      try { localStorage.setItem(A_FAIRE_KEY, next ? '1' : '0'); } catch { /* stockage indisponible */ }
      return next;
    });
  };

  // Filtres envoyés au serveur. Vue actifs : liste complète (≤ 500) paginée et filtrée par statut ici
  // (les compteurs des onglets restent connus, une colonne ne relance aucune requête) ;
  // vue archives : pagination et statut côté serveur ; recherche : tous statuts, actifs d'abord.
  const searchMode = Boolean(debouncedSearch);
  // Pastille « accords / messages / avis » : liste servie par le serveur, tous statuts confondus
  // (un avis arrive après restitution, un message non lu peut viser un dossier clôturé)
  const interactionMode = Boolean(interactionFilter);
  const listeMelangee = searchMode || interactionMode;
  const vue = listeMelangee ? 'tous' : (showArchived ? 'archives' : 'actifs');
  const serverPaged = vue === 'archives';
  const mineOnly = filterTech === '__mine__';
  // Le serveur compare le technicien à l'identique : en actifs et en recherche (listes complètes)
  // on garde le filtre local, qui accepte l'ancien format « Nom (rôle) » et, pour « Mes tickets »,
  // les non assignés. Seules les archives paginées filtrent côté serveur (signalé à l'écran).
  const techOnServer = Boolean(filterTech) && serverPaged;
  const serverTech = techOnServer ? (mineOnly ? (techName || '') : filterTech) : '';
  const queryParams = useMemo(() => {
    const p = { vue, limit: serverPaged ? pageSize : (listeMelangee ? 200 : 500) };
    if (serverPaged) p.offset = page * pageSize;
    if (debouncedSearch) p.search = debouncedSearch;
    if (interactionFilter) p.interaction = interactionFilter;
    if (filterStatut && serverPaged) p.statut = filterStatut;
    if (dateFrom) p.date_from = dateFrom;
    if (dateTo) p.date_to = dateTo;
    if (serverTech) p.tech = serverTech;
    return p;
  }, [vue, serverPaged, listeMelangee, pageSize, page, debouncedSearch, interactionFilter, filterStatut, dateFrom, dateTo, serverTech]);
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

  // Nombre d'archivés correspondant aux mêmes filtres (« Voir N archivés », état vide)
  const archCountParams = useMemo(() => {
    if (listeMelangee || showArchived || filterStatut) return null;
    const p = { vue: 'archives', limit: 1 };
    if (dateFrom) p.date_from = dateFrom;
    if (dateTo) p.date_to = dateTo;
    const t = mineOnly ? (techName || '') : filterTech;
    if (t) p.tech = t;
    return p;
  }, [listeMelangee, showArchived, filterStatut, dateFrom, dateTo, mineOnly, techName, filterTech]);
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

  // Pastille active : la liste vient du serveur (paramètre `interaction`) ; les identifiants des
  // pastilles, relus dès qu'un ticket est ouvert, retirent tout de suite ce qu'on vient de lire
  const interactionTicketIds = useMemo(() => {
    if (!interactionFilter || !interactions) return null;
    const ids = interactions[interactionFilter]?.ticket_ids;
    return Array.isArray(ids) && ids.length > 0 ? new Set(ids) : null;
  }, [interactionFilter, interactions]);
  // Plus rien à lire dans cette catégorie (tout ouvert) : le filtre se retire tout seul
  useEffect(() => {
    if (interactionFilter && interactions && !(interactions[interactionFilter]?.count > 0)) setInteractionFilter(null);
  }, [interactions, interactionFilter]);

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
      // Invalide aussi 'interactions' pour que les repères se mettent à jour immédiatement
      // (sinon ils restent figés ~30s le temps du polling).
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
      // Force le refetch tickets+dashboard+interactions → les compteurs de la carte d'action,
      // les vues filtrées et les repères se resynchronisent avec le nouveau statut (le mutate
      // optimiste ne corrige que la liste, pas les compteurs KPI du payload dashboard).
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

  // Ferme la confirmation et rend le focus au bouton de contact de la ligne (le menu est refermé,
  // l'entrée « téléphone » n'existe plus dans le DOM)
  const fermerAppel = (ticketId) => {
    setAppelAConfirmer(null);
    requestAnimationFrame(() => {
      (document.querySelector(`[data-appel-btn="${ticketId}"]`) || document.querySelector(`[data-contact-btn="${ticketId}"]`))?.focus();
    });
  };

  // « Contacté par tél. » depuis le menu de contact : note 'appel' sur le ticket, icône allumée sans recharger
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

  // Colonne de la carte d'action ou lien « dépôts à distance » : un statut précis (second clic : retiré)
  const choisirStatut = (statut) => {
    setShowEtagere(false);
    startTransition(() => {
      if (filterStatut === statut && !filterGroupe) { setFilterStatut(''); return; }
      setFilterStatut(statut);
      setFilterGroupe('');
      setShowArchived(ARCHIVE_STATUTS.includes(statut));
    });
  };

  // Onglet de vue : groupe de statuts (filtré ici) ou statut seul (filtré par le serveur pour les archives)
  const choisirGroupe = (g) => startTransition(() => {
    if (!g.cle) { setFilterGroupe(''); setFilterStatut(''); setShowArchived(false); return; }
    if (g.statuts.length === 1) {
      setFilterGroupe('');
      setFilterStatut(g.statuts[0]);
      setShowArchived(Boolean(g.archives));
      return;
    }
    setFilterGroupe(g.cle);
    setFilterStatut('');
    setShowArchived(false);
  });

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
  // envoyé (voir techOnServer), les interactions, « À faire » (hors recherche et archives : on
  // cherche aussi un ticket terminé), la priorité, puis l'onglet ou la colonne de statut.
  const aFaireActif = aFaire && !listeMelangee && !showArchived;
  const baseTickets = useMemo(() => {
    let list = tickets;
    if (filterTech && !techOnServer) {
      if (mineOnly) {
        if (techName) list = list.filter(t => matchTech(t.technicien_assigne, techName) || !t.technicien_assigne);
      } else {
        list = list.filter(t => matchTech(t.technicien_assigne, filterTech));
      }
    }
    if (aFaireActif) {
      list = list.filter(t => !STATUTS_FAITS.has(t.statut));
    }
    if (interactionTicketIds) {
      list = list.filter(t => interactionTicketIds.has(t.id));
    }
    if (filterPriorite) {
      list = list.filter(t => normaliserPriorite(t.priorite) === filterPriorite);
    }
    return list;
  }, [tickets, filterTech, techOnServer, mineOnly, techName, aFaireActif, interactionTicketIds, filterPriorite]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clients qui attendent en boutique (vue des actifs : liste complète)
  const nbAttenteSurPlace = useMemo(() => {
    if (vue !== 'actifs') return 0;
    return tickets.filter(t => normaliserPriorite(t.priorite) === 'attente' && !ARCHIVE_STATUTS.includes(t.statut)).length;
  }, [tickets, vue]);

  // Statuts retenus par l'onglet (groupe) ou la colonne (statut seul) ; null = tous. Les archives
  // paginées sont déjà filtrées par le serveur.
  const statutsFiltre = useMemo(() => {
    if (filterGroupe) return new Set(GROUPE_PAR_CLE[filterGroupe]?.statuts || []);
    if (filterStatut && !serverPaged) return new Set([filterStatut]);
    return null;
  }, [filterGroupe, filterStatut, serverPaged]);
  const filteredTickets = useMemo(
    () => (statutsFiltre ? baseTickets.filter(t => statutsFiltre.has(t.statut)) : baseTickets),
    [baseTickets, statutsFiltre]
  );

  const statutCounts = useMemo(() => {
    const counts = {};
    for (const t of baseTickets) counts[t.statut] = (counts[t.statut] || 0) + 1;
    return counts;
  }, [baseTickets]);
  // Compteur d'un onglet : connu quand la liste reçue est complète (actifs, recherche) ; les archives
  // n'apparaissent dans la liste qu'en recherche
  const compteGroupe = (g) => {
    if (serverPaged) return null;
    if (g.archives && !listeMelangee) return null;
    if (!g.statuts) return baseTickets.length;
    return g.statuts.reduce((n, s) => n + (statutCounts[s] || 0), 0);
  };
  const groupeActif = filterGroupe || (filterStatut ? groupeDuStatut(filterStatut) : (showArchived ? null : ''));

  const activeTickets = useMemo(() => filteredTickets.filter(t => !ARCHIVE_STATUTS.includes(t.statut)), [filteredTickets]);
  const archivedTickets = useMemo(() => filteredTickets.filter(t => ARCHIVE_STATUTS.includes(t.statut)), [filteredTickets]);
  // Actifs de la liste avant le filtre de statut (« 336 actifs », indépendant de l'onglet choisi)
  const nbActifs = useMemo(() => baseTickets.filter(t => !ARCHIVE_STATUTS.includes(t.statut)).length, [baseTickets]);

  // Compteurs du bandeau : KPI serveur (toute la base), indépendants de la recherche
  const hasListFilters = Boolean(listeMelangee || filterStatut || filterGroupe || dateFrom || dateTo || filterTech || filterPriorite || aFaireActif);
  const enAttente = kpi
    ? (kpi.en_attente_diagnostic || 0) + (kpi.en_attente_accord || 0) + (kpi.en_attente_piece || 0)
    : 0;
  const nouveauxAujourdhui = kpi?.nouveaux_aujourdhui ?? 0;

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
          // Texte libre : seules les valeurs datables sont ordonnées, les autres (et les vides) en
          // dernier dans les deux sens (renvoyé avant l'inversion du sens)
          const da = instantDelai(a.date_recuperation);
          const db = instantDelai(b.date_recuperation);
          const finA = da === Number.POSITIVE_INFINITY;
          const finB = db === Number.POSITIVE_INFINITY;
          if (finA !== finB) return finA ? 1 : -1;
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
  // Recherche : une seule liste, du plus récent au plus ancien (ordre du serveur), actifs et
  // archivés mêlés — un ticket clôturé hier passe avant un ticket ouvert il y a un an.
  const sortedTickets = useMemo(() => {
    if (listeMelangee) return sortList(filteredTickets);
    return sortList(showArchived ? archivedTickets : activeTickets);
  }, [listeMelangee, showArchived, filteredTickets, archivedTickets, activeTickets, sortList]);
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
  // La ligne entière ouvre le ticket ; un clic sur une commande de la ligne (lien, bouton, sélecteur,
  // menu) ne compte pas
  const clicLigne = (e, id) => {
    if (e.defaultPrevented) return;
    if (e.target.closest('a, button, select, input, label, textarea, [role="menu"]')) return;
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
    setFilterGroupe('');
    if (filterStatut && !ARCHIVE_STATUTS.includes(filterStatut)) setFilterStatut('');
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
    const libelleStatut = filterStatut || GROUPE_PAR_CLE[filterGroupe]?.label || '';
    const retirerStatut = () => { setFilterStatut(''); setFilterGroupe(''); setShowArchived(false); };
    const resetFilters = () => { retirerStatut(); setInteractionFilter(null); setFilterTech(''); setFilterPriorite(''); if (aFaire) toggleAFaire(); };
    if (searchMode) {
      if (libelleStatut && baseTickets.length > 0) {
        return {
          title: `Aucun ticket « ${libelleStatut} » pour « ${debouncedSearch} »`,
          text: `${pluriel(baseTickets.length, 'ticket')} correspondent avec un autre statut.`,
          action: { label: 'Afficher tous les statuts', onClick: retirerStatut },
        };
      }
      if (tickets.length > 0) {
        return {
          title: 'Résultats masqués par un filtre',
          text: `${pluriel(tickets.length, 'ticket')} correspondent à « ${debouncedSearch} » mais sont masqués par le filtre technicien ou priorité.`,
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
    if (interactionMode) {
      const libelle = INTERACTION_LIBELLES[interactionFilter];
      if (tickets.length > 0) {
        return {
          title: 'Tickets masqués par un filtre',
          text: `${pluriel(tickets.length, 'ticket')} ont ${libelle} mais sont masqués par le filtre technicien, priorité ou statut.`,
          action: { label: 'Retirer ces filtres', onClick: () => { retirerStatut(); setFilterTech(''); setFilterPriorite(''); } },
        };
      }
      return {
        title: 'Rien de nouveau',
        text: `Aucun ticket avec ${libelle}. Les compteurs se mettent à jour dans la minute.`,
        action: { label: 'Retirer le filtre', onClick: () => setInteractionFilter(null) },
      };
    }
    if (!showArchived && archivedTotal > 0 && (dateFrom || dateTo || filterTech)) {
      return {
        title: 'Aucun ticket actif avec ces filtres',
        text: `${pluriel(archivedTotal, 'ticket')} rendus ou clôturés correspondent à ces filtres.`,
        action: { label: `Voir les ${fmt(archivedTotal)} archivés`, onClick: showArchives },
      };
    }
    if (aFaireActif && tickets.length > 0 && baseTickets.length === 0) {
      return {
        title: 'Rien à faire',
        text: filterTech
          ? 'Toutes les réparations de ce technicien sont terminées, rendues ou clôturées.'
          : 'Toutes les réparations sont terminées, rendues ou clôturées.',
        action: { label: 'Voir aussi les terminées', onClick: toggleAFaire },
      };
    }
    if (showArchived) {
      return {
        title: 'Aucun ticket archivé',
        text: hasListFilters ? 'Aucun ticket rendu ou clôturé ne correspond à ces filtres.' : 'Les tickets rendus ou clôturés apparaîtront ici.',
        action: { label: 'Voir les actifs', onClick: showActives },
      };
    }
    if (hasListFilters) {
      return {
        title: 'Aucun ticket trouvé',
        text: 'Aucun ticket ne correspond à ces filtres.',
        action: { label: 'Retirer les filtres', onClick: resetFilters },
      };
    }
    return {
      title: 'Aucun ticket en attente',
      text: 'Les prochains dépôts apparaîtront ici.',
      action: null,
    };
  })();

  // Ce qui réclame une action : une seule ligne de texte sous l'en-tête (décision du gérant, 8 nov. 2026 :
  // plus de carte de compteurs, redondante avec les onglets). « À récupérer » déplie l'étagère (appareils
  // réparés, rendus non payés) ; « accords client » filtre la liste ; seule « N clients sur place » est en rouge.
  const alertes = [];
  if (kpi) {
    const nRecup = kpi.a_recuperer ?? 0;
    alertes.push({
      cle: 'etagere', expanded: showEtagere, ton: 'vert', icone: PackageCheck,
      texte: <><span className="font-semibold">{fmt(nRecup)}</span> à récupérer</>,
      label: `À récupérer : ${pluriel(nRecup, 'appareil')} — ${showEtagere ? "masquer l'étagère" : "afficher l'étagère"}`,
      onClick: () => setShowEtagere(v => !v),
    });
    if (kpi.en_attente_accord > 0) {
      const actif = filterStatut === "En attente d'accord client" && !filterGroupe;
      alertes.push({
        cle: 'accord', actif, ton: 'ambre', icone: MessageSquareMore,
        texte: <><span className="font-semibold">{fmt(kpi.en_attente_accord)}</span> {kpi.en_attente_accord > 1 ? 'accords client en attente' : 'accord client en attente'}</>,
        label: `${fmt(kpi.en_attente_accord)} accord${kpi.en_attente_accord > 1 ? 's' : ''} client en attente${actif ? ' — filtre actif' : ' — afficher ces tickets'}`,
        onClick: () => choisirStatut("En attente d'accord client"),
      });
    }
  }
  if (nbAttenteSurPlace > 0) {
    alertes.push({
      cle: 'surplace', ton: 'rouge', icone: Users, actif: filterPriorite === 'attente',
      texte: `${pluriel(nbAttenteSurPlace, 'client')} sur place`,
      onClick: () => setFilterPriorite(f => (f === 'attente' ? '' : 'attente')),
    });
  }
  if (commandesEnCours > 0) {
    alertes.push({
      cle: 'commandes', ton: 'cyan', icone: Truck, texte: `${pluriel(commandesEnCours, 'commande')} de pièces`,
      onClick: () => navigate(`${basePath}/commandes`),
    });
  }
  if (kpi?.pre_enregistres > 0) {
    alertes.push({
      cle: 'distance', ton: 'neutre', icone: Globe, actif: filterStatut === 'Pré-enregistré' && !filterGroupe,
      texte: `${pluriel(kpi.pre_enregistres, 'dépôt')} à distance`,
      onClick: () => choisirStatut('Pré-enregistré'),
    });
  }
  // Ce que le client a laissé depuis sa page de suivi : réponse au devis, message, avis. Le libellé
  // complet est dans le nom accessible (« 2 messages client non lus — afficher ces tickets »).
  for (const { cle, mot, ton, icone } of [
    { cle: 'accord_client', mot: ['réponse au devis non lue', 'réponses au devis non lues'], ton: 'bleu', icone: FileCheck },
    { cle: 'messages', mot: ['message client non lu', 'messages client non lus'], ton: 'bleu', icone: MessageCircle },
    { cle: 'avis', mot: ['avis non lu', 'avis non lus'], ton: 'ambre', icone: Star },
  ]) {
    const n = interactions?.[cle]?.count || 0;
    if (!(n > 0)) continue;
    const actif = interactionFilter === cle;
    const complet = n > 1 ? mot[1] : mot[0];
    alertes.push({
      cle, actif, ton, icone,
      texte: `${fmt(n)} ${complet.replace(/ non lue?s?$/, '')}`,
      label: `${fmt(n)} ${complet}${actif ? ' — filtre actif' : ' — afficher ces tickets'}`,
      onClick: () => setInteractionFilter(actif ? null : cle),
    });
  }

  // Filtres du panneau « Filtres » : compteur sur le bouton et puces supprimables quand il est replié
  const libellePriorite = PRIORITES.find(p => p.valeur === filterPriorite)?.libelle || filterPriorite;
  const jourMois = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const pucesFiltres = [
    filterPriorite && { cle: 'priorite', texte: `Priorité : ${libellePriorite}`, retirer: () => setFilterPriorite('') },
    filterTech && { cle: 'tech', texte: filterTech === '__mine__' ? 'Mes tickets' : `Tech : ${filterTech}`, retirer: () => setFilterTech('') },
    (dateFrom || dateTo) && { cle: 'dates', texte: `Déposé ${dateFrom ? jourMois(dateFrom) : '…'} → ${dateTo ? jourMois(dateTo) : '…'}`, retirer: () => { setDateFrom(''); setDateTo(''); } },
  ].filter(Boolean);
  const nbFiltresPanneau = pucesFiltres.length;

  const triCourant = TRIS.find(x => x.value === sortField) || TRIS[0];
  const selectCompact = 'select w-auto min-h-9 py-1 text-sm';
  const inputCompact = 'input w-auto min-h-9 py-1 text-sm';

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
          <p className="page-header-subtitle tabular-nums">
            <span className="first-letter:uppercase">
              {now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </span>
            {' · '}
            <span className="font-medium text-slate-700">{fmt(enAttente)}</span> ticket{enAttente > 1 ? 's' : ''} en attente
            {' · '}
            <span className="font-medium text-slate-700">{fmt(nouveauxAujourdhui)}</span> nouveau{nouveauxAujourdhui > 1 ? 'x' : ''} aujourd'hui
          </p>
        </div>
        <div className="page-header-actions">
          <button type="button" onClick={toggleCompact}
            className="btn-ghost btn-icon"
            title={compactMode ? 'Mode confortable' : 'Mode compact'}
            aria-label={compactMode ? 'Mode confortable' : 'Mode compact'}
            aria-pressed={compactMode}>
            {compactMode ? <Maximize2 aria-hidden="true" /> : <Minimize2 aria-hidden="true" />}
          </button>
          <button type="button" onClick={() => mutate()}
            className="btn-ghost btn-icon"
            title="Rafraîchir"
            aria-label="Rafraîchir">
            <RefreshCw className={loading ? 'motion-safe:animate-spin' : ''} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => navigate('/client?staff=1')} className="btn-primary">
            <Plus aria-hidden="true" /> Nouveau ticket
          </button>
        </div>
      </div>

      {alertes.length > 0 || interactionFilter ? (
        // Téléphone : une seule rangée qui défile (les pastilles empilées repoussaient la liste) ; ≥ sm : sur plusieurs lignes
        <p className="mb-4 -mx-4 px-4 flex items-center gap-x-2 overflow-x-auto scrollbar-none text-sm
          sm:mx-0 sm:px-0 sm:flex-wrap sm:overflow-visible">
          {alertes.map((a) => {
            const Icone = a.icone;
            const actif = a.actif || a.expanded;
            return (
              <button key={a.cle} type="button" onClick={a.onClick}
                aria-pressed={a.onClick && 'actif' in a ? a.actif : undefined}
                {...('expanded' in a ? { 'aria-expanded': a.expanded, 'aria-controls': a.expanded ? etagereId : undefined } : {})}
                aria-label={a.label}
                className="group/alerte shrink-0 inline-flex items-center min-h-11 rounded-full whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500">
                {/* Pastille colorée (gérant, 09/11/2026) : la teinte dit de quoi il s'agit, l'icône aussi.
                    Un seul nœud texte : sinon l'espace « 744 à récupérer » est avalé dans l'inline-flex */}
                <span className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full font-medium tabular-nums
                  transition-colors duration-150 ${TONS_ALERTE[a.ton] || TONS_ALERTE.neutre}
                  ${actif ? 'ring-2 ring-current' : 'ring-1 ring-inset'}`}>
                  {Icone && <Icone className="w-4 h-4 shrink-0" aria-hidden="true" />}
                  <span>{a.texte}</span>
                </span>
              </button>
            );
          })}
          {interactionFilter && (
            <button type="button" onClick={() => setInteractionFilter(null)} className="btn-ghost btn-sm ml-auto">
              <X aria-hidden="true" /> Réinitialiser
            </button>
          )}
        </p>
      ) : <div className="mb-4" />}

      {showEtagere && (
        <EtagereARecuperer id={etagereId} basePath={basePath} onOpenTicket={openTicket}
          onRemettre={ouvrirRemise} onClose={() => setShowEtagere(false)} />
      )}

      {/* ─── Carte tableau : zone de commande (recherche, filtres, vues, tri) puis les lignes ─── */}
      <div aria-busy={loading || isPending}
        className={`card overflow-x-auto motion-safe:transition-opacity duration-150 ${isPending || showingPrevious ? 'opacity-60' : ''}`}>
        <div className="px-4 pt-3 border-b border-slate-200">
          {/* Ligne 1 : recherche, priorité, technicien, « À faire », dates */}
          <div className="flex flex-wrap items-center gap-2 pb-3">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" aria-hidden="true" />
              <label htmlFor="dashboard-search" className="sr-only">Rechercher un ticket</label>
              <input id="dashboard-search" type="text" placeholder="Nom, téléphone, IMEI, code, modèle, panne… (fautes tolérées)"
                value={search} onChange={(e) => setSearch(e.target.value)}
                onKeyDown={onSearchKeyDown}
                enterKeyHint="search"
                autoComplete="off"
                aria-describedby="dashboard-search-hint"
                className="input min-h-9 py-1 pl-9 pr-10"
              />
              <span id="dashboard-search-hint" className="sr-only">Entrée ouvre le premier résultat, flèche bas pour parcourir la liste.</span>
              {search && (
                <button type="button" onClick={() => setSearch('')} aria-label="Effacer la recherche"
                  className="btn-ghost btn-icon btn-sm absolute right-0 top-1/2 -translate-y-1/2">
                  <X aria-hidden="true" />
                </button>
              )}
            </div>
            <button type="button" onClick={toggleAFaire} aria-pressed={aFaire}
              disabled={listeMelangee || showArchived}
              title={listeMelangee || showArchived ? 'Sans effet en recherche, dans les archives et sur une alerte' : 'Masquer les réparations terminées, rendues et clôturées'}
              className={`btn-secondary btn-sm ${aFaire ? 'bg-slate-100 border-slate-300 font-semibold hover:bg-slate-100' : ''}`}>
              <ClipboardList aria-hidden="true" />
              À faire{aFaire ? ' seulement' : ''}
            </button>
            {/* Priorité, technicien et dates sont repliés derrière « Filtres » ; les filtres posés restent visibles en puces */}
            <button type="button" onClick={() => setFiltresOuverts(v => !v)}
              aria-expanded={filtresOuverts} aria-controls={filtresOuverts ? filtresId : undefined}
              className={`btn-secondary btn-sm ${nbFiltresPanneau > 0 ? 'bg-slate-100 border-slate-300 font-semibold hover:bg-slate-100' : ''}`}>
              <SlidersHorizontal aria-hidden="true" />
              Filtres{nbFiltresPanneau > 0 ? ` · ${nbFiltresPanneau}` : ''}
            </button>
            {!filtresOuverts && pucesFiltres.map(f => (
              <button key={f.cle} type="button" onClick={f.retirer} aria-label={`Retirer le filtre ${f.texte}`}
                className="btn-secondary btn-sm tabular-nums">
                {f.texte} <X aria-hidden="true" />
              </button>
            ))}
          </div>
          {filtresOuverts && (
            <div id={filtresId} className="flex flex-wrap items-center gap-2 pb-3">
              <select value={filterPriorite} onChange={e => setFilterPriorite(e.target.value)} aria-label="Filtrer par priorité atelier"
                className={selectCompact}>
                <option value="">Toutes priorités</option>
                {PRIORITES.map(p => <option key={p.valeur} value={p.valeur}>{p.libelle}</option>)}
              </select>
              {teamList.length > 0 && (
                <select value={filterTech} onChange={e => setFilterTech(e.target.value)} aria-label="Filtrer par technicien"
                  className={selectCompact}>
                  <option value="">Tous les techs</option>
                  {isTech && techName && (
                    <option value="__mine__">Mes tickets</option>
                  )}
                  {teamList.map(m => (
                    <option key={m.id} value={m.nom}>{m.nom}</option>
                  ))}
                </select>
              )}
              <label htmlFor="dashboard-date-from" className="t-small">Déposé du</label>
              <input id="dashboard-date-from" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} max={dateTo || undefined}
                className={inputCompact} aria-label="Déposé à partir du" />
              <label htmlFor="dashboard-date-to" className="t-small">au</label>
              <input id="dashboard-date-to" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} min={dateFrom || undefined}
                className={inputCompact} aria-label="Déposé jusqu'au" />
              {nbFiltresPanneau > 0 && (
                <button type="button" onClick={() => { setFilterPriorite(''); setFilterTech(''); setDateFrom(''); setDateTo(''); }}
                  className="btn-ghost btn-sm" aria-label="Effacer les filtres priorité, technicien et dates">
                  <X aria-hidden="true" /> Effacer
                </button>
              )}
            </div>
          )}

          {/* Ligne 2 : vues par groupe de statuts, compteur actifs / archivés, tri */}
          <div className="flex flex-wrap items-end justify-between gap-x-4">
            {/* Sous xl, les onglets prennent toute la largeur (fondu à droite s'ils débordent) ; compteur et tri passent dessous */}
            <nav aria-label="Vues des tickets"
              className="page-tabs border-b-0 w-full xl:w-auto xl:flex-1 min-w-0 scroll-fade-x xl:[mask-image:none] xl:[-webkit-mask-image:none]">
              {GROUPES_STATUT.map(g => {
                const count = compteGroupe(g);
                const actif = groupeActif === g.cle;
                return (
                  <button key={g.cle || 'tous'} type="button" aria-pressed={actif}
                    onClick={() => choisirGroupe(g)}
                    className={`page-tab shrink-0 ${actif ? 'page-tab-active' : ''}`}>
                    {g.label}
                    {count !== null && <span className="text-xs tabular-nums text-slate-500">{fmt(count)}</span>}
                  </button>
                );
              })}
            </nav>
            <div className="flex flex-wrap items-center gap-2 pb-1.5 ml-auto">
              {!listeMelangee && (
                <p className="t-small tabular-nums whitespace-nowrap">
                  {showArchived ? (
                    <>
                      {serverTotal !== null ? pluriel(serverTotal, 'archivé') : (loading ? 'Archivés…' : pluriel(archivedTickets.length, 'archivé'))}
                      {' · '}
                      <button type="button" onClick={showActives}
                        className="inline-flex items-center min-h-11 -my-3 rounded text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                        Voir les actifs
                      </button>
                    </>
                  ) : (
                    <>
                      {truncatedBy ? `${fmt(nbActifs)} actifs affichés sur ${fmt(truncatedBy)}` : pluriel(nbActifs, 'actif')}
                      {' · '}
                      <button type="button" onClick={showArchives}
                        className="inline-flex items-center min-h-11 -my-3 rounded text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                        {archivedTotal !== null ? `Voir ${fmt(archivedTotal)} archivés` : 'Voir les archivés'}
                      </button>
                    </>
                  )}
                </p>
              )}
              <label htmlFor="dashboard-sort" className="sr-only">Trier par</label>
              <select id="dashboard-sort" value={sortField} disabled={serverPaged}
                title={serverPaged ? 'Archives : date de dépôt, plus récents d’abord' : undefined}
                onChange={e => {
                  const tri = TRIS.find(x => x.value === e.target.value) || TRIS[0];
                  setSortField(tri.value);
                  setSortDir(tri.defaut);
                }}
                className={selectCompact}>
                {TRIS.map(tri => <option key={tri.value} value={tri.value}>Trier : {tri.label}</option>)}
              </select>
              {!serverPaged && (
                <button type="button" onClick={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
                  aria-label={`Ordre ${sortDir === 'asc' ? 'croissant' : 'décroissant'} (${triCourant.label}), inverser`}
                  title={sortDir === 'asc' ? 'Croissant — inverser' : 'Décroissant — inverser'}
                  className="btn-ghost btn-icon btn-sm">
                  <ArrowUpDown aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Résumé d'une recherche ou d'une alerte */}
        {searchMode && !dashData ? (
          <p className="px-4 py-2 border-b border-slate-100 text-sm text-slate-600" role="status">
            {dashError ? 'Recherche indisponible' : `Recherche de « ${debouncedSearch} »…`}
          </p>
        ) : searchMode ? (
          <p className="px-4 py-2 border-b border-slate-100 text-sm text-slate-600 tabular-nums" role="status">
            <strong className="font-semibold text-slate-900">{fmt(filteredTickets.length)}</strong> résultat{filteredTickets.length > 1 ? 's' : ''} pour « {debouncedSearch} »
            {' '}— {fmt(activeTickets.length)} en cours, {fmt(archivedTickets.length)} rendu{archivedTickets.length > 1 ? 's' : ''} ou clôturé{archivedTickets.length > 1 ? 's' : ''}
            {truncatedBy ? ` (${fmt(tickets.length)} premiers sur ${fmt(truncatedBy)})` : ''}
          </p>
        ) : interactionMode ? (
          <p className="px-4 py-2 border-b border-slate-100 text-sm text-slate-600 tabular-nums" role="status">
            <strong className="font-semibold text-slate-900">{fmt(filteredTickets.length)}</strong> ticket{filteredTickets.length > 1 ? 's' : ''} avec {INTERACTION_LIBELLES[interactionFilter]}
            {' '}— {fmt(activeTickets.length)} en cours, {fmt(archivedTickets.length)} rendu{archivedTickets.length > 1 ? 's' : ''} ou clôturé{archivedTickets.length > 1 ? 's' : ''}
          </p>
        ) : null}
        {showArchived && !searchMode && filterTech && (
          <p className="px-4 py-2 border-b border-slate-100 t-caption">
            Archives : technicien comparé au nom exact{mineOnly ? ', sans les tickets non assignés' : ''}. Les anciens tickets notés « Nom (rôle) » n’y figurent pas.
          </p>
        )}

        {/* Sélection groupée */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 px-4 py-2 bg-slate-50 border-b border-slate-200">
            <span className="text-sm font-medium text-slate-900 tabular-nums">{fmt(selectedIds.size)} sélectionné{selectedIds.size > 1 ? 's' : ''}</span>
            <div className="relative ml-auto"
              onKeyDown={e => {
                if (e.key !== 'Escape' || !showBulkMenu) return;
                e.stopPropagation();
                setShowBulkMenu(false);
                bulkBtnRef.current?.focus();
              }}>
              <button type="button" ref={bulkBtnRef} onClick={() => setShowBulkMenu(!showBulkMenu)} disabled={bulkBusy}
                aria-expanded={showBulkMenu} aria-controls={showBulkMenu ? bulkMenuId : undefined}
                className="btn-secondary btn-sm">
                {bulkBusy
                  ? <><RefreshCw className="motion-safe:animate-spin" aria-hidden="true" /> Changement en cours…</>
                  : <>Changer statut <ChevronDown aria-hidden="true" /></>}
              </button>
              {showBulkMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowBulkMenu(false)} />
                  <div role="group" id={bulkMenuId} ref={bulkMenuRef} aria-label="Nouveau statut des tickets sélectionnés"
                    className="absolute right-0 top-full mt-1 w-72 rounded-lg border border-slate-200 bg-white p-1.5 shadow-md z-50">
                    {STATUTS.map(s => (
                      <button type="button" key={s} onClick={() => handleBulkStatus(s)}
                        className="w-full min-h-11 text-left px-3 py-2 rounded-md text-sm text-slate-700 hover:bg-slate-50 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-inset">
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
            <button type="button" onClick={() => setSelectedIds(new Set())} className="btn-ghost btn-icon btn-sm"
              aria-label="Annuler la sélection">
              <X aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Compte rendu du changement groupé : tickets à rendre un par un, échecs */}
        {bulkReport && (() => {
          const enAttenteRemise = bulkReport.aTraiter.filter(r => {
            const cur = tickets.find(t => t.id === r.id);
            return !cur || cur.statut === r.statut;
          });
          return (
            <div role="status" className="callout callout-warning items-start m-4">
              <AlertTriangle aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold">{resumeStatutGroupe(bulkReport)}</p>
                {enAttenteRemise.length > 0 && (
                  <>
                    <p className="mt-1 text-xs">
                      Remise au client par le panneau (paiement, téléphone de prêt) — cliquez sur un ticket :
                    </p>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {enAttenteRemise.map(r => (
                        <li key={r.id}>
                          <button type="button" onClick={() => ouvrirRemise(r)} title={r.raison}
                            className="btn-secondary btn-sm t-mono">
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
                className="btn-ghost btn-icon btn-sm -my-1.5 -mr-2 text-amber-900 hover:bg-amber-100 hover:text-amber-950">
                <X aria-hidden="true" />
              </button>
            </div>
          );
        })()}

        {/* En-tête du tableau */}
        <div className={`hidden lg:grid ${GRID_COLS} gap-x-1.5 items-center px-4 min-h-10 bg-slate-50 border-b border-slate-200`}>
          <button type="button" onClick={toggleSelectAll} className="flex items-center justify-center w-11 h-11 -m-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
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
          <span className="table-header hidden xl:block">Reçu · Prêt le</span>
          <span className="hidden xl:block"><span className="sr-only">Contact</span></span>
          <span className="table-header text-right">Prix</span>
          <span></span>
        </div>

        {loading && tickets.length === 0 ? (
          <div className="divide-y divide-slate-100" aria-hidden="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="px-4 min-h-12 flex items-center gap-3">
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
          <div className="empty-state max-h-none" role="status">
            <Inbox className="w-6 h-6 text-slate-400" aria-hidden="true" />
            <p className="t-h2">{emptyState.title}</p>
            <p className="t-body text-slate-500 max-w-md">{emptyState.text}</p>
            {emptyState.action && (
              <button type="button" onClick={emptyState.action.onClick} className="btn-secondary">
                {emptyState.action.label}
              </button>
            )}
          </div>
        ) : (
          <div>
            {displayedTickets.map((t, rowIdx) => {
              const archivedRow = ARCHIVE_STATUTS.includes(t.statut);
              const showArchiveSeparator = listeMelangee && archivedRow
                && (rowIdx === 0 || !ARCHIVE_STATUTS.includes(displayedTickets[rowIdx - 1].statut));
              const clientName = `${t.client_prenom || ''} ${t.client_nom || ''}`.trim();
              const contact = normaliserContact(t.contact);
              const appareil = `${t.marque || ''} ${t.modele || t.modele_autre || ''}`.trim();
              const panne = panneAffichee(t);
              const recu = infoReception(t.date_depot);
              const statusCfg = getStatusConfig(t.statut);
              const techColor = getTechColor(t.technicien_assigne);
              const selected = selectedIds.has(t.id);
              // Délai de réparation toujours visible sur la ligne (décision du gérant, 8 nov. 2026) : pastille « mar. 10/11 17:55 »,
              // « 15:30 · dans 1 h 20 », « En retard de 25 min », « Délai à fixer » — dans la colonne « Reçu · Prêt le »
              // à partir de lg, sous le nom du client en dessous ; rien une fois la réparation terminée ou rendue.
              const delai = delaiTicket(t, now);
              const reperes = reperesLigne(t, ticketInteractions[t.id]);
              const titreDate = recu ? `Reçu le ${recu.complet}` : '';
              const prix = (t.devis_estime || t.tarif_final) ? (
                <>
                  <p className="text-sm font-semibold tabular-nums text-slate-900 leading-5">
                    {formatPrix(t.tarif_final || t.devis_estime)}
                  </p>
                  {t.paye ? (
                    <span className="badge badge-sm badge-neutral">Payé</span>
                  ) : t.acompte > 0 ? (
                    <span className="badge badge-sm badge-warning tabular-nums">Acompte {formatPrix(t.acompte)}</span>
                  ) : (
                    <span className="block text-xs font-medium text-red-700 leading-5">Non payé</span>
                  )}
                </>
              ) : t.est_retour_sav ? (
                /* Retour SAV : prise en charge sous garantie, rien à payer */
                <>
                  <p className="text-sm font-semibold tabular-nums text-slate-900 leading-5">{formatPrix(0)}</p>
                  <span className="badge badge-sm badge-neutral">Garantie</span>
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
                  Rendus ou clôturés — {pluriel(archivedTickets.length, 'résultat')} dans les archives (retour garantie, historique)
                </div>
              )}
              {/* Ligne : la ligne entière ouvre le ticket (le lien du code garde l'ouverture dans un nouvel onglet et la
                  navigation au clavier). Carte 3 lignes sous lg ; grille à partir de lg — deux lignes de grille sur iPad
                  (données / technicien · contact · date), une seule de 48 px à partir de xl. */}
              <div
                onClick={(e) => clicLigne(e, t.id)}
                className={`group relative flex flex-col gap-2 px-4 py-3 border-b border-slate-100 last:border-b-0 cursor-pointer
                  lg:grid ${GRID_COLS} lg:gap-x-1.5 lg:gap-y-1 lg:items-center xl:gap-y-0 xl:py-0
                  ${compactMode ? 'lg:py-1 xl:min-h-10' : 'lg:py-1.5 xl:min-h-12'}
                  transition-colors duration-150 hover:bg-slate-50
                  ${selected ? 'bg-brand-50/60 hover:bg-brand-50/60' : listeMelangee && archivedRow ? 'bg-slate-50/60' : ''}`}
              >
                {/* Case à cocher (sur iPad : centrée sur les deux lignes de la grille) */}
                <div className="hidden lg:flex items-center justify-center lg:row-span-2 xl:row-span-1">
                  <button type="button" onClick={() => toggleSelect(t.id)}
                    className="w-11 h-11 -m-2 flex items-center justify-center rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    aria-label={`Sélectionner ${t.ticket_code}`} aria-pressed={selected}>
                    {selected
                      ? <SquareCheck className="w-4 h-4 text-brand-600" aria-hidden="true" />
                      : <Square className="w-4 h-4 text-slate-400 group-hover:text-slate-500" aria-hidden="true" />}
                  </button>
                </div>

                {/* Ligne 1 (mobile) : code · client · prix — cellules de la grille à partir de lg */}
                <div className="flex items-start gap-3 min-w-0 lg:contents">
                  {/* Code du ticket : le lien (nouvel onglet, flèches haut / bas) */}
                  <div className="shrink-0 lg:min-w-0 lg:row-span-2 xl:row-span-1">
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
                      className="inline-flex items-center min-h-11 -my-1.5 font-mono text-xs tabular-nums text-slate-900 rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1">
                      {t.ticket_code}
                    </a>
                  </div>

                  {/* Client : nom + priorité + délai urgent + repères sur une ligne, téléphone · appareil · panne dessous */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-x-1.5 min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900" title={clientName}>
                        {t.client_prenom || ''} {t.client_nom || ''}
                      </p>
                      <PrioriteBadge priorite={t.priorite} court className="shrink-0" />
                      <Repere items={reperes.client} icone={MessageCircle} />
                      <Repere items={reperes.dossier} icone={Info} />
                    </div>
                    <p className="table-cell-muted truncate tabular-nums"
                      title={[t.client_tel, estAutreNumero(t) ? `joignable ${telJoignable(t)}` : '', appareil, panne.texte].filter(Boolean).join(' · ')}>
                      {formatTel(t.client_tel)}
                      {/* Second numéro du ticket : c'est lui que vise le menu de contact, la réceptionniste doit le voir */}
                      {estAutreNumero(t) && (
                        <span className="whitespace-nowrap text-slate-700">{' · '}joignable {formatTel(telJoignable(t))}</span>
                      )}
                      {appareil ? ` · ${appareil}` : ''}
                      {panne.aCommander ? ' · Pièce à commander' : panne.texte !== '—' ? ` · ${panne.texte}` : ''}
                      {/* Côté tech : code et schéma de déverrouillage */}
                      {isTech && t.pin && (
                        <span className="t-mono text-slate-700 whitespace-nowrap">
                          {' · '}<Lock className="inline w-3.5 h-3.5 -mt-0.5" aria-hidden="true" /> {t.pin}
                        </span>
                      )}
                      {isTech && t.pattern && (
                        <span className="t-mono text-slate-700 whitespace-nowrap">
                          {' · '}<Shield className="inline w-3.5 h-3.5 -mt-0.5" aria-hidden="true" /> {t.pattern}
                        </span>
                      )}
                    </p>
                    {/* Mobile / tablette portrait : la colonne « Reçu le » n'existe pas, la date passe sous le client */}
                    {(recu || delai) && (
                      <p className="lg:hidden table-cell-muted tabular-nums flex flex-wrap items-center gap-x-2 gap-y-1" title={titreDate}>
                        {recu && <span>Reçu le {recu.jour} · {recu.relatif}</span>}
                        {delai && <PastilleDelai ticket={t} maintenant={now} taille="sm" jauge />}
                      </p>
                    )}
                  </div>

                  {/* Prix (mobile, à droite du titre) */}
                  <div className="lg:hidden shrink-0 text-right">
                    {prix}
                  </div>
                </div>

                {/* Ligne 3 (mobile) : statut + contact — cellules de la grille à partir de lg.
                    Placement explicite (colonne + ligne) du statut et du tech à partir de xl : les autres cellules
                    se placent automatiquement autour, dans l'ordre du DOM. */}
                <div className="flex items-center gap-2 lg:contents">
                  {/* Statut — sélecteur teinté de la couleur du statut + pastille (44 px sous le doigt) */}
                  <div className="relative flex-1 min-w-0 xl:col-start-5 xl:row-start-1">
                    <span className={`pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full ${statusCfg.dot}`} aria-hidden="true" />
                    <select
                      value={t.statut}
                      aria-label={`Statut du ticket ${t.ticket_code}`}
                      onChange={e => handleInlineStatus(t, e.target.value)}
                      className={`select min-h-11 lg:min-h-9 lg:py-1 pl-6 pr-7 text-base lg:text-sm font-medium truncate ${statusCfg.champ}`}
                    >
                      {STATUTS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>

                  {/* Technicien · contact · date. Mobile : contact à droite du statut ; iPad (lg) : 2ᵉ ligne de la
                      grille sous le client ; ≥ xl : chaque bloc retrouve sa colonne. */}
                  <div className="flex items-center gap-1 shrink-0 lg:col-start-3 lg:col-span-3 lg:row-start-2 lg:gap-2 lg:min-w-0 xl:contents">
                    {/* Technicien — sélecteur neutre ; la couleur libre du technicien en pastille de 8 px devant son nom */}
                    <div className="relative hidden lg:block lg:w-40 xl:w-auto xl:col-start-4 xl:row-start-1">
                      {techColor && (
                        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full"
                          style={{ backgroundColor: techColor }} aria-hidden="true" />
                      )}
                      <select
                        value={t.technicien_assigne || ''}
                        aria-label={`Technicien du ticket ${t.ticket_code}`}
                        onChange={e => { const val = e.target.value; handleInlineTech(t.id, val); }}
                        className={`select min-h-11 lg:min-h-9 lg:py-1 ${techColor ? 'pl-6' : 'pl-2.5'} pr-7 text-sm truncate ${
                          t.technicien_assigne ? 'text-slate-800 font-medium' : 'text-slate-500'}`}
                      >
                        <option value="">— Aucun</option>
                        {teamList.map(m => (
                          <option key={m.id} value={m.nom}>{m.nom}</option>
                        ))}
                      </select>
                    </div>

                    {/* Contact : un bouton, un menu (WhatsApp · SMS · e-mail · appel) */}
                    <div className="flex items-center justify-center shrink-0 xl:col-start-7 xl:row-start-1">
                      <MenuContact t={t} clientName={clientName} contact={contact}
                        appelOuvert={appelAConfirmer === t.id}
                        onAppel={() => setAppelAConfirmer(v => (v === t.id ? null : t.id))} />
                    </div>

                    {/* Date de réception + délai promis (≥ lg ; à droite du bandeau sur iPad) */}
                    <div className="hidden lg:flex lg:flex-col lg:items-start lg:gap-1 lg:ml-auto xl:ml-0 min-w-0 xl:col-start-6 xl:row-start-1">
                      {recu ? (
                        <p className="table-cell-muted tabular-nums truncate max-w-full" title={titreDate}>
                          <span className="sr-only">Reçu le </span>
                          <span className="text-slate-900">{recu.jour}</span>
                          {' '}{recu.relatif}
                        </p>
                      ) : <p className="table-cell-muted">—</p>}
                      {delai && <PastilleDelai ticket={t} maintenant={now} taille="sm" jauge className="max-w-full" />}
                    </div>
                  </div>
                </div>

                {/* Prix (≥ lg) */}
                <div className="hidden lg:block text-right">
                  {prix}
                </div>

                {/* Chevron : rappel discret que la ligne s'ouvre */}
                <div className="hidden lg:flex items-center justify-end self-stretch lg:row-span-2 xl:row-span-1">
                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600 transition-colors duration-150" aria-hidden="true" />
                </div>
              </div>
              {/* Confirmation légère de l'appel, dans le flux sous la rangée */}
              {appelAConfirmer === t.id && (
                <div role="group" aria-label={`Noter un appel téléphonique à ${clientName || 'ce client'}`}
                  onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); fermerAppel(t.id); } }}
                  className="flex flex-wrap items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-100 text-sm">
                  <PhoneCall className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
                  <span className="text-slate-800">
                    {clientName || 'Ce client'} ({t.ticket_code}) a été appelé ? L'appel sera noté sur le ticket.
                  </span>
                  <span className="flex items-center gap-1.5">
                    <button type="button" autoFocus onClick={() => noterAppel(t)} className="btn-secondary btn-sm">
                      Oui, noter l'appel
                    </button>
                    <button type="button" onClick={() => fermerAppel(t.id)} className="btn-ghost btn-sm">
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
                {fmt(safePage * pageSize + 1)}–{fmt(Math.min((safePage + 1) * pageSize, totalCount))} sur {fmt(totalCount)}
              </span>
              <label htmlFor="dashboard-page-size" className="sr-only">Tickets par page</label>
              <select id="dashboard-page-size" value={pageSize} onChange={e => handlePageSizeChange(Number(e.target.value))}
                className={selectCompact}>
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
                        i === safePage ? 'bg-slate-100 text-slate-900 font-semibold hover:bg-slate-100' : ''
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

      {/* ─── Santé des prix (admin) : prix estimés ou périmés, propositions, modèles sans prix ── */}
      {user?.role === 'admin' && (
        <Suspense fallback={null}>
          <SantePrixWidget basePath={basePath} />
        </Suspense>
      )}
    </div>
  );
}
