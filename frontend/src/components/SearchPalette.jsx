import { useState, useEffect, useRef, useCallback, useMemo, useId } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Search, X, Loader2, Smartphone, User, FileText, Package, History,
  AlertCircle, ScanLine, CornerDownLeft, RotateCcw,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import StatusBadge from './StatusBadge';
import { formatDateShort, getStatusConfig } from '../lib/utils';
import { SCAN_TIMING, createScanBuffer, parseScan, scanQuery } from '../lib/scan';
import { digitsOnly, extractTicketFromUrl, normalizeTicketCode, normalizePhoneInput } from '../lib/ticketCode';

// Codes ticket et téléphones : module léger partagé avec le suivi public (hors chunk d'entrée)
export { digitsOnly, extractTicketFromUrl, normalizeTicketCode, normalizePhoneInput };

// ─── Fonctions pures (testées dans tests/search.test.js) ─────────────────────

export const OPEN_SEARCH_EVENT = 'kp:open-search';
const SEARCH_LIMIT = 8;
const DEBOUNCE_MS = 200;
const MIN_QUERY = 2;
const CACHE_TTL_MS = 30_000;
const RECENT_MAX = 6;
const RECENT_PREFIX = 'kp_search_recent:';
// Même seuil que ScanListener : deux touches à moins de 50 ms = rafale de douchette.
const SCAN_KEY_GAP_MS = 50;
const SCAN_NEUTRAL_KEYS = new Set(['Shift', 'CapsLock', 'Dead', 'Unidentified', 'AltGraph', 'NumLock']);
export const ARCHIVE_STATUTS = ['Rendu au client', 'Clôturé'];

const DIACRITICS = /[\u0300-\u036f]/g;

export function normalizeText(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function isValidImei(value) {
  const d = digitsOnly(value);
  if (d.length !== 15 || /^0+$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let n = d.charCodeAt(i) - 48;
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/**
 * Nature de la saisie. `explicit` = la saisie désigne sans ambiguïté un objet
 * (QR, code KP, IMEI valide, téléphone complet) : Entrée peut ouvrir directement.
 * Un nombre nu (« 2301 ») reste ambigu : fin de téléphone, d'IMEI ou numéro de ticket.
 */
export function detectQueryKind(raw) {
  const q = String(raw ?? '').trim();
  if (!q) return { kind: 'empty', explicit: false };
  const code = normalizeTicketCode(q);
  if (code) return { kind: 'ticket', explicit: true, code };
  const compact = q.replace(/[\s.\-()/]/g, '');
  if (/^\+?\d+$/.test(compact)) {
    const digits = digitsOnly(compact);
    if (digits.length === 15 && isValidImei(digits)) return { kind: 'imei', explicit: true, digits };
    if (digits.length >= 9 && digits.length <= 13) return { kind: 'phone', explicit: true, digits };
    return { kind: 'number', explicit: false, digits };
  }
  return { kind: 'text', explicit: false };
}

export function formatPhone(tel) {
  const s = String(tel ?? '').trim();
  const d = digitsOnly(s);
  if (!s.startsWith('+') && /^0\d{9}$/.test(d)) return d.replace(/(\d{2})(?=\d)/g, '$1 ');
  if (s.startsWith('+33') && d.length === 11) {
    return `+33 ${d[2]} ${d.slice(3).replace(/(\d{2})(?=\d)/g, '$1 ')}`;
  }
  return s;
}

/** Découpe `text` en segments surlignés pour chaque mot de `query` (insensible aux accents). */
export function highlightParts(text, query) {
  const src = String(text ?? '');
  const tokens = [...new Set(normalizeText(query).split(' ').filter((t) => t.length >= 2))];
  if (!src || tokens.length === 0) return [{ text: src, hit: false }];
  let norm = '';
  const map = [];
  for (let i = 0; i < src.length; i++) {
    const n = src[i].normalize('NFD').replace(DIACRITICS, '').toLowerCase();
    for (let k = 0; k < n.length; k++) {
      norm += n[k];
      map.push(i);
    }
  }
  const hits = new Array(src.length).fill(false);
  for (const tok of tokens) {
    let from = 0;
    let idx = norm.indexOf(tok, from);
    while (idx !== -1) {
      for (let j = idx; j < idx + tok.length; j++) hits[map[j]] = true;
      from = idx + tok.length;
      idx = norm.indexOf(tok, from);
    }
  }
  const out = [];
  for (let i = 0; i < src.length; i++) {
    const last = out[out.length - 1];
    if (last && last.hit === hits[i]) last.text += src[i];
    else out.push({ text: src[i], hit: hits[i] });
  }
  return out;
}

/** Filtre local : chaque mot doit apparaître dans au moins un champ (téléphones comparés en chiffres). */
export function matchesQuery(fields, query) {
  const tokens = normalizeText(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  const list = (Array.isArray(fields) ? fields : [fields])
    .filter((v) => v !== null && v !== undefined && v !== '')
    .map(String);
  const hay = normalizeText(list.join(' '));
  const hayDigits = [];
  for (const f of list) {
    const d = digitsOnly(f);
    if (!d) continue;
    hayDigits.push(d);
    if (d.length === 11 && d.startsWith('33')) hayDigits.push(`0${d.slice(2)}`);
  }
  const trimmed = String(query ?? '').trim();
  if (/^[\d\s.+\-()/]+$/.test(trimmed)) {
    const qd = normalizePhoneInput(trimmed);
    if (qd.length >= 3 && hayDigits.some((d) => d.includes(qd))) return true;
  }
  return tokens.every((tok) => {
    if (hay.includes(tok)) return true;
    if (!/^[\d.+-]+$/.test(tok)) return false;
    const d = digitsOnly(tok);
    return d.length >= 3 && hayDigits.some((fd) => fd.includes(d));
  });
}

// ─── Historique local (poste partagé : ni téléphone ni IMEI) ─────────────────

function recentStorageKey(userKey) {
  return `${RECENT_PREFIX}${userKey || 'staff'}`;
}

function shouldRememberQuery(q) {
  const kind = detectQueryKind(q).kind;
  if (kind === 'ticket') return true;
  return kind === 'text' && !/\d{6,}/.test(q.replace(/[\s.-]/g, ''));
}

export function loadRecents(userKey) {
  try {
    const raw = localStorage.getItem(recentStorageKey(userKey));
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      queries: Array.isArray(parsed?.queries)
        ? parsed.queries.filter((x) => typeof x === 'string' && x.trim()).slice(0, RECENT_MAX)
        : [],
      items: Array.isArray(parsed?.items)
        ? parsed.items.filter((x) => x && x.type && x.id != null).slice(0, RECENT_MAX)
        : [],
    };
  } catch {
    return { queries: [], items: [] };
  }
}

export function rememberRecent(userKey, { query, item } = {}) {
  const cur = loadRecents(userKey);
  let { queries, items } = cur;
  const qn = String(query ?? '').trim();
  if (qn && shouldRememberQuery(qn)) {
    const key = normalizeText(qn);
    queries = [qn, ...queries.filter((x) => normalizeText(x) !== key)].slice(0, RECENT_MAX);
  }
  if (item && item.type && item.id != null) {
    items = [item, ...items.filter((x) => !(x.type === item.type && x.id === item.id))].slice(0, RECENT_MAX);
  }
  const next = { queries, items };
  try {
    localStorage.setItem(recentStorageKey(userKey), JSON.stringify(next));
  } catch { /* stockage indisponible : l'historique reste en mémoire */ }
  return next;
}

export function clearRecents(userKey) {
  try {
    localStorage.removeItem(recentStorageKey(userKey));
  } catch { /* ignore */ }
}

// ─── Résultats → options navigables ──────────────────────────────────────────

function personName(prenom, nom) {
  return [prenom, nom].filter(Boolean).join(' ').trim();
}

function deviceLabel(t) {
  return [t?.marque, t?.modele || t?.modele_autre].filter(Boolean).join(' ');
}

export function hrefFor(type, id, basePath, extra = {}) {
  switch (type) {
    case 'ticket': return `${basePath}/ticket/${id}`;
    case 'client': return `${basePath}/clients?client=${id}`;
    // ?q= en plus de ?id= : la page Devis peut ouvrir le devis ou, à défaut, filtrer sur son numéro
    case 'devis': return `${basePath}/devis?id=${id}${extra.q ? `&q=${encodeURIComponent(extra.q)}` : ''}`;
    case 'commande':
      return extra.ticketId
        ? `${basePath}/ticket/${extra.ticketId}`
        : `${basePath}/commandes?q=${encodeURIComponent(extra.q || '')}`;
    default: return basePath;
  }
}

export function buildResultGroups(res, basePath) {
  const g = res?.groups || {};
  const groups = [];
  const tickets = (g.tickets || []).filter((t) => t && t.id != null);
  if (tickets.length) {
    groups.push({
      key: 'tickets', label: 'Tickets', icon: Smartphone,
      items: tickets.map((t) => ({ type: 'ticket', key: `ticket-${t.id}`, id: t.id, href: hrefFor('ticket', t.id, basePath), data: t })),
    });
  }
  const clients = (g.clients || []).filter((c) => c && c.id != null);
  if (clients.length) {
    groups.push({
      key: 'clients', label: 'Clients', icon: User,
      items: clients.map((c) => ({ type: 'client', key: `client-${c.id}`, id: c.id, href: hrefFor('client', c.id, basePath), data: c })),
    });
  }
  const devis = (g.devis || []).filter((d) => d && d.id != null);
  if (devis.length) {
    groups.push({
      key: 'devis', label: 'Devis', icon: FileText,
      items: devis.map((d) => ({
        type: 'devis', key: `devis-${d.id}`, id: d.id, href: hrefFor('devis', d.id, basePath, { q: d.numero }), data: d,
      })),
    });
  }
  const commandes = (g.commandes || []).filter((c) => c && c.id != null);
  if (commandes.length) {
    groups.push({
      key: 'commandes', label: 'Commandes de pièces', icon: Package,
      items: commandes.map((c) => ({
        type: 'commande', key: `commande-${c.id}`, id: c.id,
        href: hrefFor('commande', c.id, basePath, { ticketId: c.ticket_id, q: c.reference || c.description }),
        data: c,
      })),
    });
  }
  return groups;
}

function recentFromOption(opt) {
  const d = opt?.data || {};
  switch (opt?.type) {
    case 'ticket':
      return {
        type: 'ticket', id: opt.id,
        label: [d.ticket_code, personName(d.client_prenom, d.client_nom)].filter(Boolean).join(' · ') || `Ticket ${opt.id}`,
        sub: [deviceLabel(d), d.panne].filter(Boolean).join(' · '),
        statut: d.statut || '',
      };
    case 'client':
      return { type: 'client', id: opt.id, label: personName(d.prenom, d.nom) || 'Client', sub: d.societe || '' };
    case 'devis':
      return {
        type: 'devis', id: opt.id, q: d.numero || '',
        label: [d.numero, personName(d.client_prenom, d.client_nom)].filter(Boolean).join(' · ') || 'Devis',
        sub: d.appareil || '',
      };
    case 'commande':
      return {
        type: 'commande', id: opt.id, ticketId: d.ticket_id || null, q: d.reference || d.description || '',
        label: d.description || 'Commande de pièce', sub: [d.reference, d.ticket_code].filter(Boolean).join(' · '),
      };
    case 'recent':
      return d;
    default:
      return null;
  }
}

export function shortcutLabel() {
  if (typeof navigator === 'undefined') return 'Ctrl K';
  return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '') ? '⌘K' : 'Ctrl K';
}

export function openSearchPalette(q = '') {
  window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT, { detail: { q } }));
}

function otherModalOpen() {
  return Boolean(document.querySelector('[aria-modal="true"]:not([data-search-palette])'));
}

function isEditableTarget(el) {
  if (!el || el === document.body) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

// ─── Rendu ───────────────────────────────────────────────────────────────────

function Highlight({ text, query }) {
  const parts = useMemo(() => highlightParts(text, query), [text, query]);
  return parts.map((p, i) => (p.hit
    ? <mark key={i} className="bg-amber-100 text-inherit rounded-sm">{p.text}</mark>
    : <span key={i}>{p.text}</span>));
}

const TYPE_ICONS = { ticket: Smartphone, client: User, devis: FileText, commande: Package };

function TicketRow({ t, query }) {
  const name = personName(t.client_prenom, t.client_nom);
  const device = [deviceLabel(t), t.panne].filter(Boolean).join(' · ');
  const archived = ARCHIVE_STATUTS.includes(t.statut);
  return (
    <div className="flex items-start gap-3">
      <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${getStatusConfig(t.statut).dot}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2 min-w-0">
          <span className="font-mono text-xs font-bold text-brand-700 shrink-0">
            <Highlight text={t.ticket_code || ''} query={query} />
          </span>
          <span className="text-sm font-semibold text-slate-900 truncate">
            <Highlight text={name || 'Client inconnu'} query={query} />
          </span>
        </p>
        {device && (
          <p className="text-xs text-slate-600 truncate"><Highlight text={device} query={query} /></p>
        )}
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          {t.client_tel && <span className="font-mono">{formatPhone(t.client_tel)}</span>}
          {t.date_depot && <span>Déposé le {formatDateShort(t.date_depot)}</span>}
          {t.technicien_assigne && <span className="truncate max-w-[10rem]">{t.technicien_assigne}</span>}
          {t.match && (
            <span className="rounded bg-amber-50 text-amber-800 ring-1 ring-amber-200 px-1.5 py-0.5 font-medium">
              Trouvé : {t.match}
            </span>
          )}
        </p>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1 max-w-[42%]">
        <StatusBadge statut={t.statut} />
        {t.statut === 'Réparation terminée' && (
          <span className={`badge badge-sm ${t.paye ? 'badge-success' : 'badge-warning'}`}>
            {t.paye ? 'Payé' : 'À encaisser'}
          </span>
        )}
        {archived && <span className="text-xs text-slate-500">Archivé</span>}
      </div>
    </div>
  );
}

function ClientRow({ c, query }) {
  const name = personName(c.prenom, c.nom) || 'Client sans nom';
  const initials = `${(c.prenom || '')[0] || ''}${(c.nom || '')[0] || ''}`.toUpperCase() || '?';
  const nb = Number(c.nb_tickets || 0);
  return (
    <div className="flex items-start gap-3">
      <span className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center shrink-0" aria-hidden="true">
        {initials}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900 truncate"><Highlight text={name} query={query} /></p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600">
          {c.telephone && <span className="font-mono">{formatPhone(c.telephone)}</span>}
          {c.societe && <span className="truncate"><Highlight text={c.societe} query={query} /></span>}
          {c.email && <span className="truncate max-w-[14rem]"><Highlight text={c.email} query={query} /></span>}
        </p>
        <p className="text-xs text-slate-500 mt-0.5">{nb === 0 ? 'Aucun ticket' : `${nb} ticket${nb > 1 ? 's' : ''}`}</p>
      </div>
      {c.dernier_statut && (
        <div className="shrink-0 max-w-[42%] flex flex-col items-end gap-0.5">
          <span className="text-xs text-slate-500">Dernier ticket</span>
          <StatusBadge statut={c.dernier_statut} />
        </div>
      )}
    </div>
  );
}

function PlainRow({ icon: Icon, title, sub, meta, badge, query }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0" aria-hidden="true">
        <Icon className="w-4 h-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900 truncate"><Highlight text={title} query={query} /></p>
        {sub && <p className="text-xs text-slate-600 truncate"><Highlight text={sub} query={query} /></p>}
        {meta && <p className="text-xs text-slate-500 truncate">{meta}</p>}
      </div>
      {badge && (
        <span className="shrink-0 max-w-[40%] truncate text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
          {badge}
        </span>
      )}
    </div>
  );
}

function OptionContent({ opt, query }) {
  const d = opt.data || {};
  switch (opt.type) {
    case 'ticket': return <TicketRow t={d} query={query} />;
    case 'client': return <ClientRow c={d} query={query} />;
    case 'devis':
      return (
        <PlainRow icon={FileText} query={query}
          title={[d.numero, personName(d.client_prenom, d.client_nom)].filter(Boolean).join(' · ') || 'Devis'}
          sub={d.appareil || ''}
          meta={d.date ? `Créé le ${formatDateShort(d.date)}` : ''}
          badge={d.statut || ''} />
      );
    case 'commande':
      return (
        <PlainRow icon={Package} query={query}
          title={d.description || 'Commande de pièce'}
          sub={[d.reference, d.fournisseur].filter(Boolean).join(' · ')}
          meta={d.ticket_code ? `Ticket ${d.ticket_code}` : 'Sans ticket lié'}
          badge={d.statut || ''} />
      );
    case 'recent': {
      const Icon = TYPE_ICONS[d.type] || History;
      return (
        <div className="flex items-start gap-3">
          <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0" aria-hidden="true">
            <Icon className="w-4 h-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900 truncate">{d.label}</p>
            {d.sub && <p className="text-xs text-slate-600 truncate">{d.sub}</p>}
          </div>
          {d.statut && <span className="shrink-0 max-w-[42%]"><StatusBadge statut={d.statut} /></span>}
        </div>
      );
    }
    case 'query':
      return (
        <div className="flex items-center gap-3">
          <History className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
          <span className="text-sm text-slate-800 truncate">{d.q}</span>
        </div>
      );
    default:
      return null;
  }
}

const KIND_HINTS = {
  ticket: 'Ce code ne correspond à aucun ticket. Vérifiez le numéro imprimé sur le ticket.',
  imei: "Aucun ticket avec cet IMEI. Essayez le nom ou le téléphone du client.",
  phone: 'Aucun client avec ce numéro. Essayez le nom ou le code du ticket.',
  number: 'Essayez le code complet (KP-000123), le téléphone complet ou le nom.',
  text: 'Essayez le téléphone, le code du ticket (KP-000123 ou 123), l’IMEI ou un autre mot.',
};

function PaletteDialog({ initialQuery, basePath, userKey, onClose, onNavigate }) {
  const [q, setQ] = useState(initialQuery || '');
  const [res, setRes] = useState(null);
  const [resQ, setResQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resolving, setResolving] = useState(false);
  const [active, setActive] = useState(0);
  const [userMoved, setUserMoved] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [recents, setRecents] = useState(() => loadRecents(userKey));

  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const timerRef = useRef(null);
  const reqIdRef = useRef(0);
  const pendingRef = useRef(null);
  const cacheRef = useRef(new Map());
  const mountedRef = useRef(false);
  const enterBusyRef = useRef(false);
  const scanBufRef = useRef(null);
  if (!scanBufRef.current) scanBufRef.current = createScanBuffer(SCAN_TIMING);
  const scanIdleRef = useRef(null);
  const qRef = useRef(q);
  qRef.current = q;

  const uid = useId();
  const titleId = `${uid}-title`;
  const listboxId = `${uid}-listbox`;
  const optionId = (opt) => `${uid}-opt-${opt.key}`;

  useEffect(() => {
    mountedRef.current = true;
    const root = document.documentElement;
    const prevOverflow = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      mountedRef.current = false;
      root.style.overflow = prevOverflow;
      clearTimeout(timerRef.current);
      clearTimeout(scanIdleRef.current);
      reqIdRef.current += 1;
    };
  }, []);

  const runSearch = useCallback((query) => {
    const id = ++reqIdRef.current;
    setLoading(true);
    const promise = api.search(query, SEARCH_LIMIT)
      .then((data) => {
        const cache = cacheRef.current;
        if (cache.size > 40) cache.clear();
        cache.set(query, { ts: Date.now(), data });
        if (mountedRef.current && id === reqIdRef.current) {
          setRes(data);
          setResQ(query);
          setError('');
          setActive(0);
          setUserMoved(false);
        }
        return data;
      })
      .catch((err) => {
        if (mountedRef.current && id === reqIdRef.current) setError(err?.message || 'Recherche indisponible');
        throw err;
      })
      .finally(() => {
        if (mountedRef.current && id === reqIdRef.current) setLoading(false);
      });
    promise.catch(() => {});
    pendingRef.current = { query, promise };
    return promise;
  }, []);

  useEffect(() => {
    const query = q.trim();
    clearTimeout(timerRef.current);
    setNotice('');
    if (query.length < MIN_QUERY) {
      reqIdRef.current += 1;
      pendingRef.current = null;
      setLoading(false);
      setError('');
      setRes(null);
      setResQ('');
      setActive(0);
      setUserMoved(false);
      return undefined;
    }
    const hit = cacheRef.current.get(query);
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
      reqIdRef.current += 1;
      pendingRef.current = null;
      setRes(hit.data);
      setResQ(query);
      setLoading(false);
      setError('');
      setActive(0);
      setUserMoved(false);
      return undefined;
    }
    setLoading(true);
    timerRef.current = setTimeout(() => { runSearch(query); }, DEBOUNCE_MS);
    return () => clearTimeout(timerRef.current);
  }, [q, retryTick, runSearch]);

  const query = q.trim();
  const showResults = query.length >= MIN_QUERY;

  const groups = useMemo(() => {
    if (showResults) return buildResultGroups(res, basePath);
    const out = [];
    if (recents.items.length) {
      out.push({
        key: 'recent-items', label: 'Récemment ouverts', icon: History,
        items: recents.items.map((it) => ({
          type: 'recent', key: `recent-${it.type}-${it.id}`, href: hrefFor(it.type, it.id, basePath, it), data: it,
        })),
      });
    }
    if (recents.queries.length) {
      out.push({
        key: 'recent-queries', label: 'Recherches récentes', icon: Search,
        items: recents.queries.map((rq, i) => ({ type: 'query', key: `query-${i}`, data: { q: rq } })),
      });
    }
    return out;
  }, [showResults, res, basePath, recents]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const activeIndex = flat.length ? Math.min(active, flat.length - 1) : -1;
  const activeOption = activeIndex >= 0 ? flat[activeIndex] : null;
  const activeOptionKey = activeOption?.key;

  useEffect(() => {
    if (!activeOptionKey) return;
    document.getElementById(`${uid}-opt-${activeOptionKey}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeOptionKey, uid]);

  const openHref = (href, newTab, recentItem) => {
    setRecents(rememberRecent(userKey, { query: qRef.current, item: recentItem }));
    if (newTab) {
      window.open(href, '_blank', 'noopener');
      return;
    }
    onNavigate(href);
  };

  const openOption = (opt, newTab = false) => {
    if (!opt) return;
    if (opt.type === 'query') {
      setQ(opt.data.q);
      inputRef.current?.focus();
      return;
    }
    openHref(opt.href, newTab, recentFromOption(opt));
  };

  const openResolved = (r, newTab, options) => {
    if (!r || r.id == null) return false;
    if (r.type === 'ticket') {
      const opt = options.find((o) => o.type === 'ticket' && o.id === r.id);
      openHref(hrefFor('ticket', r.id, basePath), newTab,
        opt ? recentFromOption(opt) : { type: 'ticket', id: r.id, label: r.ticket_code || `Ticket ${r.id}`, sub: '' });
      return true;
    }
    if (r.type === 'client') {
      const opt = options.find((o) => o.type === 'client' && o.id === r.id);
      openHref(hrefFor('client', r.id, basePath), newTab,
        opt ? recentFromOption(opt) : { type: 'client', id: r.id, label: 'Client', sub: '' });
      return true;
    }
    return false;
  };

  const handleEnter = async (newTab) => {
    if (enterBusyRef.current) return;
    enterBusyRef.current = true;
    try {
      await doEnter(newTab);
    } finally {
      enterBusyRef.current = false;
    }
  };

  // Code ticket, QR ou IMEI (saisi ou scanné) : résolution directe côté serveur
  const resolveAndOpen = async (value, newTab, kind) => {
    setResolving(true);
    setNotice('');
    try {
      const r = await api.resolveCode(value);
      if (!mountedRef.current) return;
      if (openResolved(r, newTab, flat)) return;
      setNotice(`Aucun ticket ne correspond à « ${kind.code || value} ».`);
    } catch (err) {
      if (!mountedRef.current) return;
      if (resQ === value && res?.resolved && openResolved(res.resolved, newTab, flat)) return;
      const byCode = kind.code && flat.find((o) => o.type === 'ticket' && o.data?.ticket_code === kind.code);
      if (byCode) {
        openOption(byCode, newTab);
        return;
      }
      const msg = String(err?.message || '');
      const notFound = kind.kind === 'imei'
        ? `Aucun ticket avec l’IMEI ${kind.digits}.`
        : kind.kind === 'serial'
          ? `Aucun ticket avec le numéro de série ${kind.serial}.`
          : `Aucun ticket ne correspond à « ${kind.code || value} ».`;
      setNotice(/aucun|introuvable|not found|404/i.test(msg) || !msg
        ? notFound
        : `Impossible de vérifier le code : ${msg}`);
    } finally {
      if (mountedRef.current) setResolving(false);
    }
  };

  // Rafale de douchette tapée dans le champ (ScanListener s'efface quand la palette est ouverte).
  // true : le scan est pris en charge, sinon le texte reste une saisie ordinaire.
  const takeScan = (fromIdle = false) => {
    clearTimeout(scanIdleRef.current);
    const buf = scanBufRef.current;
    const text = buf.qualified && (fromIdle || buf.continues(performance.now())) ? buf.text : '';
    buf.reset();
    if (!text || !mountedRef.current) return false;
    const parsed = parseScan(text);
    if (parsed.kind === 'ean') {
      setQ('');
      setNotice('Code-barres produit (EAN) : ce n’est ni un ticket ni un IMEI.');
      return true;
    }
    const code = scanQuery(parsed);
    if (!code) return false;
    setQ(code);
    if (parsed.kind === 'ticket') resolveAndOpen(code, false, { kind: 'ticket', code });
    else if (parsed.kind === 'imei') resolveAndOpen(code, false, { kind: 'imei', digits: code });
    else if (parsed.kind === 'serial') resolveAndOpen(code, false, { kind: 'serial', serial: code });
    return true;
  };

  const doEnter = async (newTab) => {
    const current = q.trim();
    if (!current) {
      if (activeOption) openOption(activeOption, newTab);
      return;
    }
    if (userMoved && activeOption && resQ === current) {
      openOption(activeOption, newTab);
      return;
    }
    const kind = detectQueryKind(current);
    if (kind.explicit && (kind.kind === 'ticket' || kind.kind === 'imei')) {
      await resolveAndOpen(current, newTab, kind);
      return;
    }
    if (current.length < MIN_QUERY) return;
    let data = resQ === current ? res : null;
    if (!data) {
      clearTimeout(timerRef.current);
      try {
        const pending = pendingRef.current;
        data = pending && pending.query === current ? await pending.promise : await runSearch(current);
      } catch {
        return;
      }
      if (!mountedRef.current || qRef.current.trim() !== current) return;
    }
    const options = buildResultGroups(data, basePath).flatMap((g) => g.items);
    if (data?.resolved && openResolved(data.resolved, newTab, options)) return;
    if (options[0]) openOption(options[0], newTab);
    else setNotice(`Aucun résultat pour « ${current} ».`);
  };

  const moveActive = (delta) => {
    if (!flat.length) return;
    setActive((i) => {
      const base = Math.min(Math.max(i, 0), flat.length - 1);
      return (base + delta + flat.length) % flat.length;
    });
    setUserMoved(true);
  };

  const jumpGroup = (dir) => {
    if (groups.length < 2 || activeIndex < 0) return;
    let start = 0;
    const starts = groups.map((g) => { const s = start; start += g.items.length; return s; });
    let gi = starts.findIndex((s, i) => activeIndex >= s && activeIndex < s + groups[i].items.length);
    gi = (gi + dir + groups.length) % groups.length;
    setActive(starts[gi]);
    setUserMoved(true);
  };

  const onInputKeyDown = (e) => {
    const buf = scanBufRef.current;
    // Touche maintenue : l'auto-répétition (~30 ms) a la cadence d'une douchette, ce n'en est pas une
    if (e.repeat) {
      clearTimeout(scanIdleRef.current);
      buf.reset();
    } else if ((e.key === 'Enter' || e.key === 'Tab') && buf.qualified && buf.continues(performance.now())) {
      e.preventDefault();
      e.stopPropagation();
      if (takeScan() || e.key === 'Tab') return;
      handleEnter(e.ctrlKey || e.metaKey);
      return;
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.nativeEvent?.isComposing) {
      buf.push(e.key, performance.now());
      clearTimeout(scanIdleRef.current);
      // Douchette sans suffixe Entrée : le scan est traité après un court silence
      if (buf.qualified && buf.text.length >= 6) {
        scanIdleRef.current = setTimeout(() => takeScan(true), SCAN_TIMING.scanGap);
      }
    } else if (!SCAN_NEUTRAL_KEYS.has(e.key)) {
      clearTimeout(scanIdleRef.current);
      buf.reset();
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
    else if (e.key === 'PageDown') { e.preventDefault(); jumpGroup(1); }
    else if (e.key === 'PageUp') { e.preventDefault(); jumpGroup(-1); }
    else if (e.key === 'Enter') {
      if (e.nativeEvent?.isComposing) return;
      e.preventDefault();
      handleEnter(e.ctrlKey || e.metaKey);
    }
  };

  const onDialogKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const nodes = [...dialogRef.current.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((n) => n.getClientRects().length > 0);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const clearHistory = () => {
    clearRecents(userKey);
    setRecents({ queries: [], items: [] });
    inputRef.current?.focus();
  };

  const kind = detectQueryKind(query);
  const busy = loading || resolving;
  const resultsReady = showResults && res && resQ;
  const noResults = resultsReady && !loading && flat.length === 0;
  const statusText = !showResults
    ? ''
    : error
      ? `Erreur : ${error}`
      : !res && loading
        ? 'Recherche en cours'
        : res
          ? (flat.length ? `${flat.length} résultat${flat.length > 1 ? 's' : ''}` : 'Aucun résultat')
          : '';

  const modKey = shortcutLabel().startsWith('⌘') ? '⌘' : 'Ctrl';
  let flatIndex = -1;

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center sm:px-4 sm:pt-[8vh]" onKeyDown={onDialogKeyDown}>
      <div className="absolute inset-0 bg-slate-900/50 motion-safe:backdrop-blur-sm" aria-hidden="true" onMouseDown={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-search-palette=""
        className="relative flex flex-col w-full h-full sm:h-auto sm:max-h-[80vh] sm:max-w-2xl bg-white sm:rounded-xl shadow-lg overflow-hidden pt-[env(safe-area-inset-top)] sm:pt-0 motion-safe:animate-[scaleIn_120ms_ease-out]"
      >
        <h2 id={titleId} className="sr-only">Recherche globale</h2>

        <div className="flex items-center gap-1 pl-3 pr-1.5 sm:pl-4 border-b border-slate-200">
          <Search className="w-5 h-5 text-slate-500 shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            autoFocus
            type="text"
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeOption ? optionId(activeOption) : undefined}
            aria-label="Rechercher un ticket, un client, un devis ou une commande"
            aria-describedby={`${uid}-hint`}
            placeholder="Nom, téléphone, KP-000123, IMEI, modèle…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKeyDown}
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="flex-1 min-w-0 h-14 px-2 bg-transparent text-base text-slate-900 placeholder:text-slate-500 focus:outline-none"
          />
          {busy && <Loader2 className="w-5 h-5 text-brand-600 shrink-0 motion-safe:animate-spin" aria-hidden="true" />}
          {q && (
            <button type="button" onClick={() => { setQ(''); inputRef.current?.focus(); }}
              className="w-11 h-11 shrink-0 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              aria-label="Effacer la recherche">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
          <button type="button" onClick={onClose}
            className="h-11 min-w-[44px] px-2.5 shrink-0 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            aria-label="Fermer la recherche">
            <span className="sm:hidden"><X className="w-5 h-5" aria-hidden="true" /></span>
            <kbd className="hidden sm:inline font-sans">Échap</kbd>
          </button>
        </div>

        <p id={`${uid}-hint`} className="sr-only">
          Flèches haut et bas pour parcourir les résultats, Entrée pour ouvrir, Ctrl Entrée pour un nouvel onglet, Échap pour fermer.
        </p>
        <div className="sr-only" aria-live="polite" role="status">{statusText}</div>

        {notice && (
          <div role="alert" className="mx-3 mt-3 flex items-start gap-2 rounded-xl bg-amber-50 ring-1 ring-amber-200 px-3 py-2.5 text-sm text-amber-900">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{notice}</span>
          </div>
        )}

        {error && showResults && (
          <div role="alert" className="mx-3 mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-red-50 ring-1 ring-red-200 px-3 py-2.5 text-sm text-red-800">
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="flex-1 min-w-0">La recherche n’a pas abouti : {error}</span>
            <button type="button" onClick={() => setRetryTick((n) => n + 1)}
              className="min-h-[44px] px-3 rounded-lg bg-white ring-1 ring-red-200 font-semibold text-red-800 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 inline-flex items-center gap-1.5">
              <RotateCcw className="w-4 h-4" aria-hidden="true" /> Réessayer
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain py-2">
          <div id={listboxId} role="listbox" aria-label="Résultats de recherche">
          {groups.map((g) => {
            const GroupIcon = g.icon;
            const headingId = `${uid}-g-${g.key}`;
            return (
              <div key={g.key} role="group" aria-labelledby={headingId} className="pb-1">
                <div id={headingId} role="presentation"
                  className="sticky top-0 z-[1] bg-white/95 px-4 pt-2 pb-1 t-overline flex items-center gap-1.5">
                  {GroupIcon && <GroupIcon className="w-3.5 h-3.5" aria-hidden="true" />}
                  {g.label}
                  {showResults && <span className="font-semibold">· {g.items.length}</span>}
                </div>
                {g.items.map((opt) => {
                  flatIndex += 1;
                  const idx = flatIndex;
                  const isActive = idx === activeIndex;
                  return (
                    <div key={opt.key} id={optionId(opt)} role="option" aria-selected={isActive}
                      onMouseMove={() => { if (idx !== activeIndex) { setActive(idx); setUserMoved(true); } }}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => openOption(opt, e.ctrlKey || e.metaKey)}
                      className={`mx-2 px-3 py-2.5 min-h-[48px] rounded-xl cursor-pointer transition-colors motion-reduce:transition-none
                        ${isActive ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-slate-50'}`}>
                      <OptionContent opt={opt} query={resQ || query} />
                    </div>
                  );
                })}
              </div>
            );
          })}
          </div>

          {showResults && !res && loading && (
            <p className="px-5 py-8 text-sm text-slate-500 text-center">Recherche en cours…</p>
          )}

          {noResults && (
            <div className="px-5 py-8 text-center">
              {!notice && <p className="text-sm font-semibold text-slate-800">Aucun résultat pour « {resQ} »</p>}
              <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">{KIND_HINTS[kind.kind] || KIND_HINTS.text}</p>
            </div>
          )}

          {!showResults && groups.length === 0 && (
            <div className="px-5 py-6 text-sm text-slate-600 space-y-3">
              <p>
                Tapez un <strong>nom</strong>, un <strong>téléphone</strong> (tous formats), un <strong>code ticket</strong>
                {' '}(KP-000123 ou 123), un <strong>IMEI</strong>, un modèle ou une panne.
              </p>
              <p className="flex items-start gap-2 text-slate-500">
                <ScanLine className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                Douchette : scannez le QR d’un ticket ou le code-barres IMEI, la fiche s’ouvre directement.
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 px-3 py-2 flex flex-wrap items-center gap-2 text-xs text-slate-600 bg-slate-50/80">
          {!showResults && recents.items.length + recents.queries.length > 0 && (
            <button type="button" onClick={clearHistory}
              className="min-h-[44px] px-3 rounded-lg font-medium text-slate-600 hover:text-slate-900 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
              Effacer l’historique
            </button>
          )}
          {resultsReady && (
            <>
              <button type="button" onClick={() => onNavigate(`${basePath}?q=${encodeURIComponent(resQ)}`)}
                className="min-h-[44px] px-3 rounded-lg font-medium text-brand-700 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                Tous les tickets « {resQ.length > 24 ? `${resQ.slice(0, 24)}…` : resQ} »
              </button>
              <button type="button" onClick={() => onNavigate(`${basePath}/clients?q=${encodeURIComponent(resQ)}`)}
                className="min-h-[44px] px-3 rounded-lg font-medium text-brand-700 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                Tous les clients
              </button>
            </>
          )}
          <p className="hidden sm:flex items-center gap-3 ml-auto text-slate-500" aria-hidden="true">
            <span><kbd className="font-sans font-semibold">↑↓</kbd> naviguer</span>
            <span className="inline-flex items-center gap-1"><CornerDownLeft className="w-3 h-3" /> ouvrir</span>
            <span><kbd className="font-sans font-semibold">{modKey} ↵</kbd> nouvel onglet</span>
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Palette de recherche globale du staff (Ctrl/Cmd+K, « / », bouton de la Navbar).
 * Montée une fois dans App.jsx ; inactive hors des routes /accueil et /tech
 * (jamais sur le kiosque /client ni sur le suivi public).
 */
export default function SearchPalette() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState({ open: false, q: '', n: 0 });

  const isStaff = user?.target === 'accueil' || user?.target === 'tech';
  const onStaffRoute = /^\/(accueil|tech)(\/|$)/.test(location.pathname);
  const enabled = isStaff && onStaffRoute;
  const basePath = user?.target === 'tech' ? '/tech' : '/accueil';
  const userKey = user?.utilisateur || user?.target || '';

  const openRef = useRef(false);
  openRef.current = state.open;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const lastFocusRef = useRef(null);
  const lastKeyRef = useRef(0);
  const slashTimerRef = useRef(null);
  const prevUserKeyRef = useRef(userKey);

  // Déconnexion : l'historique du poste partagé est effacé
  useEffect(() => {
    if (prevUserKeyRef.current && !user) clearRecents(prevUserKeyRef.current);
    prevUserKeyRef.current = user ? userKey : '';
  }, [user, userKey]);

  const openPalette = useCallback((initial = '') => {
    if (!enabledRef.current) return;
    if (!openRef.current) lastFocusRef.current = document.activeElement;
    setState((s) => ({ open: true, q: typeof initial === 'string' ? initial : '', n: s.n + 1 }));
  }, []);

  const closePalette = useCallback(({ restoreFocus = true } = {}) => {
    setState((s) => (s.open ? { ...s, open: false } : s));
    const el = lastFocusRef.current;
    lastFocusRef.current = null;
    if (restoreFocus && el && typeof el.focus === 'function' && document.contains(el)) {
      requestAnimationFrame(() => el.focus());
    }
  }, []);

  const handleNavigate = useCallback((href) => {
    closePalette({ restoreFocus: false });
    navigate(href);
  }, [closePalette, navigate]);

  // La palette se ferme à chaque changement de page (scan de douchette compris)
  useEffect(() => {
    setState((s) => (s.open ? { ...s, open: false } : s));
  }, [location.key]);

  useEffect(() => {
    if (!enabled) {
      setState((s) => (s.open ? { ...s, open: false } : s));
      return undefined;
    }
    const onKeyDown = (e) => {
      const now = performance.now();
      const gap = now - lastKeyRef.current;
      lastKeyRef.current = now;
      if (slashTimerRef.current) {
        clearTimeout(slashTimerRef.current);
        slashTimerRef.current = null;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        if (openRef.current) {
          e.preventDefault();
          closePalette();
        } else if (!otherModalOpen()) {
          e.preventDefault();
          openPalette();
        }
        return;
      }
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (openRef.current || isEditableTarget(e.target) || otherModalOpen()) return;
      // L'URL du QR contient des « / » : pendant une rafale de douchette on ne fait rien
      if (gap < SCAN_KEY_GAP_MS) return;
      e.preventDefault();
      slashTimerRef.current = setTimeout(() => {
        slashTimerRef.current = null;
        openPalette();
      }, 60);
    };
    const onOpenEvent = (e) => openPalette(e?.detail?.q || '');
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpenEvent);
      clearTimeout(slashTimerRef.current);
    };
  }, [enabled, openPalette, closePalette]);

  if (!state.open || !enabled || typeof document === 'undefined') return null;

  return createPortal(
    <PaletteDialog
      key={state.n}
      initialQuery={state.q}
      basePath={basePath}
      userKey={userKey}
      onClose={() => closePalette()}
      onNavigate={handleNavigate}
    />,
    document.body,
  );
}
