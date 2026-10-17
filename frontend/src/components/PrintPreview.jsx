import {
  forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  X, Printer, ExternalLink, Download, AlertCircle, AlertTriangle, RefreshCw, CheckCircle, Loader2,
} from 'lucide-react';

// ─── Papiers et conversions ─────────────────────────────────────

export const PX_PER_MM = 96 / 25.4;
export const mmToPx = (mm) => mm * PX_PER_MM;
export const pxToMm = (px) => px / PX_PER_MM;

export const PAPERS = {
  thermal80: { id: 'thermal80', label: 'Thermique 80 mm', short: '80 mm', w: 80, printable: 72, roll: true },
  a4: { id: 'a4', label: 'A4 portrait', short: 'A4', w: 210, h: 297 },
  a4l: { id: 'a4l', label: 'A4 paysage', short: 'A4 paysage', w: 297, h: 210 },
};

export const ZOOM_PRESETS = [
  { value: 'fit', label: 'Ajuster' },
  { value: 1, label: '100 %' },
  { value: 1.5, label: '150 %' },
];
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function computeFitZoom(availPx, paperPx, max = 2) {
  if (!(availPx > 0) || !(paperPx > 0)) return 1;
  return Math.min(max, Math.max(0.25, Math.floor((availPx / paperPx) * 100) / 100));
}

export function stepZoom(current, dir) {
  if (dir > 0) return ZOOM_STEPS.find((z) => z > current + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return [...ZOOM_STEPS].reverse().find((z) => z < current - 0.001) ?? ZOOM_STEPS[0];
}

export function formatCm(mm) {
  return (Math.round(mm) / 10).toFixed(1).replace('.', ',');
}

export function resolveFormat(doc, preferred) {
  const keys = Object.keys(doc?.formats || {});
  if (preferred && keys.includes(preferred)) return preferred;
  if (keys.includes('thermal')) return 'thermal';
  return keys[0] || null;
}

// ─── Préparation du HTML imprimé ────────────────────────────────

// Seul le type de média change : `print` → `all`, `screen` → `tty` (type déprécié, jamais satisfait,
// donc `screen and (min-width:…)` reste inactif à l'écran comme à l'impression). Les parenthèses sont recopiées telles quelles.
export function convertMediaList(list) {
  return String(list ?? '').replace(/\([^()]*\)|\b(print|screen)\b/gi, (m, type) => {
    if (!type) return m;
    return type.toLowerCase() === 'print' ? 'all' : 'tty';
  });
}

// L'aperçu applique les règles @media print à l'écran : ce qui s'affiche est ce qui sort.
export function toPrintMedia(html) {
  return String(html ?? '')
    .replace(/@media\b([^{;]*)\{/gi, (m, list) => `@media${convertMediaList(list)}{`)
    .replace(/(<(?:style|link)\b[^>]*?\smedia\s*=\s*)(["'])([^"']*)\2/gi, (m, pre, q, list) => `${pre}${q}${convertMediaList(list)}${q}`);
}

export function injectAtHeadStart(html, snippet) {
  const s = String(html ?? '');
  if (!snippet) return s;
  const head = /<head(\s[^>]*)?>/i.exec(s);
  if (head) {
    const i = head.index + head[0].length;
    return s.slice(0, i) + snippet + s.slice(i);
  }
  const root = /<html(\s[^>]*)?>/i.exec(s);
  if (root) {
    const i = root.index + root[0].length;
    return `${s.slice(0, i)}<head>${snippet}</head>${s.slice(i)}`;
  }
  return snippet + s;
}

export function injectAtHeadEnd(html, snippet) {
  const s = String(html ?? '');
  if (!snippet) return s;
  const end = s.search(/<\/head\s*>/i);
  if (end >= 0) return s.slice(0, end) + snippet + s.slice(end);
  const body = s.search(/<body[\s>]/i);
  if (body >= 0) return s.slice(0, body) + snippet + s.slice(body);
  return injectAtHeadStart(s, snippet);
}

const UNIT_MM = { mm: 1, cm: 10, in: 25.4, px: 25.4 / 96, pt: 25.4 / 72 };
function lengthToMm(token) {
  const m = /^(-?\d*\.?\d+)(mm|cm|in|px|pt)?$/i.exec(String(token).trim());
  if (!m || !m[2]) return 0;
  return parseFloat(m[1]) * UNIT_MM[m[2].toLowerCase()];
}

export function parsePageMarginsMm(html) {
  const out = { top: 0, right: 0, bottom: 0, left: 0 };
  const re = /@page\s*\{([^{}]*)\}/gi;
  let block;
  while ((block = re.exec(String(html ?? '')))) {
    const decl = /(?:^|[;\s])margin\s*:\s*([^;}]+)/i.exec(block[1]);
    if (!decl) continue;
    const parts = decl[1].replace(/!important/i, '').trim().split(/\s+/).map(lengthToMm);
    const [top, right = top, bottom = top, left = right] = parts;
    Object.assign(out, { top, right, bottom, left });
  }
  return out;
}

const escapeAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function prepareFrameHtml(html, paper, origin = '') {
  let out = toPrintMedia(html);
  if (origin && !/<base\s/i.test(out)) out = injectAtHeadStart(out, `<base href="${escapeAttr(origin)}/">`);
  let screen = 'html{background:#fff;overflow:hidden}';
  if (!paper?.roll) {
    const m = parsePageMarginsMm(html);
    screen = `html{background:#fff;overflow:hidden;box-sizing:border-box;padding:${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm}`;
  }
  return injectAtHeadEnd(out, `<style id="kp-preview-screen">@media screen{${screen}}</style>`);
}

// Copie autonome (onglet / iPad) : même origine que l'app, donc scripts interdits par CSP.
export const STANDALONE_CSP = "default-src 'none'; img-src data: blob: http: https:; style-src 'unsafe-inline' http: https:; font-src data: http: https:";

export function buildStandaloneHtml(html, origin = '') {
  const s = String(html ?? '');
  const base = origin && !/<base\s/i.test(s) ? `<base href="${escapeAttr(origin)}/">` : '';
  return injectAtHeadStart(s, `<meta http-equiv="Content-Security-Policy" content="${STANDALONE_CSP}">${base}`);
}

// ─── Longueur de papier thermique (pages @page à la hauteur exacte) ──

export function segmentHeights(totalPx, breaksPx = []) {
  const points = [...new Set(breaksPx.filter((b) => b > 0 && b < totalPx).map(Math.round))].sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const b of points) {
    out.push(b - prev);
    prev = b;
  }
  out.push(totalPx - prev);
  return out.filter((h) => h > 1);
}

export function rollPageHeightsMm(heightsPx, extraMm = 2) {
  return heightsPx.map((px) => Math.max(20, Math.ceil(pxToMm(px)) + extraMm));
}

export function buildRollPageCss(heightsMm, widthMm, named = false) {
  if (!heightsMm?.length) return '';
  const base = `@page{size:${widthMm}mm ${Math.max(...heightsMm)}mm;margin:0}`;
  if (!named) return base;
  return base + heightsMm.map((h, i) => `@page kp${i}{size:${widthMm}mm ${h}mm;margin:0}`).join('');
}

function upsertStyle(doc, id, css) {
  let el = doc.getElementById(id);
  if (!el) {
    el = doc.createElement('style');
    el.id = id;
    (doc.body || doc.head || doc.documentElement).appendChild(el);
  }
  el.textContent = css;
}

function findBreakOffsets(doc) {
  const offsets = [];
  const view = doc.defaultView || window;
  for (const el of doc.body.querySelectorAll('*')) {
    const cs = view.getComputedStyle(el);
    const after = cs.breakAfter === 'page' || cs.breakAfter === 'always' || cs.pageBreakAfter === 'always';
    const before = cs.breakBefore === 'page' || cs.breakBefore === 'always' || cs.pageBreakBefore === 'always';
    if (!after && !before) continue;
    const r = el.getBoundingClientRect();
    if (before) offsets.push(r.top);
    if (after) offsets.push(r.bottom);
  }
  return offsets;
}

export function layoutFrame(doc, paper) {
  const root = doc.documentElement;
  const body = doc.body;
  const heightPx = Math.ceil(Math.max(root.getBoundingClientRect().height, body?.scrollHeight || 0, 1));
  const overflowX = root.scrollWidth > Math.round(mmToPx(paper.w)) + 2;
  let heightsMm = null;
  if (paper.roll && body) {
    const sections = [...doc.querySelectorAll('[data-print-page]')];
    const named = sections.length > 0;
    let heightsPx;
    if (named) {
      heightsPx = sections.map((s) => s.getBoundingClientRect().height);
      sections.forEach((s, i) => s.style.setProperty('page', `kp${i}`));
    } else {
      heightsPx = segmentHeights(heightPx, findBreakOffsets(doc));
    }
    heightsMm = rollPageHeightsMm(heightsPx, named ? 8 : 2);
    upsertStyle(doc, 'kp-page-size', buildRollPageCss(heightsMm, paper.w, named));
  }
  return { heightPx, overflowX, heightsMm };
}

function describeImage(img) {
  const src = img.getAttribute('src') || '';
  if (/logo/i.test(src)) return 'logo';
  if (/tampon/i.test(src)) return 'tampon';
  const alt = (img.getAttribute('alt') || '').trim();
  if (alt.length > 1) return alt;
  if (src.startsWith('data:')) return 'image intégrée';
  return src.split('?')[0].split('/').pop() || 'image';
}

export function waitForAssets(doc, timeoutMs = 5000) {
  const images = [...(doc?.images || [])];
  const waits = images.map((img) => {
    const settled = img.complete
      ? Promise.resolve()
      : new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    return settled.then(() => (img.naturalWidth > 0 && img.decode ? img.decode().catch(() => {}) : null));
  });
  const fonts = doc?.fonts?.ready ? Promise.resolve(doc.fonts.ready).catch(() => {}) : Promise.resolve();
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); });
  return Promise.race([Promise.all([...waits, fonts]), timeout])
    .finally(() => clearTimeout(timer))
    .then(() => [...new Set(images.filter((img) => !(img.complete && img.naturalWidth > 0)).map(describeImage))]);
}

export function isIOSDevice(nav = typeof navigator !== 'undefined' ? navigator : null) {
  if (!nav) return false;
  return /iPad|iPhone|iPod/.test(nav.userAgent || '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

// Safari (macOS) imprime souvent une page blanche via contentWindow.print() sur un PDF en iframe, sans lever d'erreur
export function isSafariDesktop(nav = typeof navigator !== 'undefined' ? navigator : null) {
  if (!nav || isIOSDevice(nav)) return false;
  const ua = nav.userAgent || '';
  return /AppleWebKit\//.test(ua) && /Version\/[\d.]+.*Safari\//.test(ua) && !/Chrome\/|Chromium\/|CriOS|FxiOS|EdgiOS|Android/.test(ua);
}

export const nextFrame = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16));
export const cancelFrame = (id) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id));
const isMacLike = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const currentOrigin = () => (typeof window !== 'undefined' && window.location?.origin) || '';

export function errorMessage(err) {
  const msg = err?.message || '';
  if (err?.name === 'AbortError') return 'Chargement interrompu : réessayez.';
  if (/404/.test(msg)) return 'Document introuvable.';
  return msg || 'Erreur de chargement du document.';
}

let entrySeq = 0;
function makeEntry(source, paper) {
  entrySeq += 1;
  if (source?.kind === 'pdf') {
    return { id: entrySeq, kind: 'pdf', url: URL.createObjectURL(source.blob), filename: source.filename || 'document.pdf' };
  }
  const raw = String(source?.html ?? '');
  return { id: entrySeq, kind: 'html', raw, html: prepareFrameHtml(raw, paper, currentOrigin()), margins: parsePageMarginsMm(raw) };
}

function revokeEntry(entry) {
  if (entry?.url) URL.revokeObjectURL(entry.url);
}

function focusableIn(node) {
  const sel = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),iframe,[tabindex]';
  return [...node.querySelectorAll(sel)].filter((el) => el.tabIndex >= 0 && !el.hasAttribute('hidden') && !el.closest('[inert]'));
}

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1';

// ─── Papier à l'échelle (réutilisable hors iframe) ──────────────

export function PaperFrame({ paper = PAPERS.a4, zoom = 1, marginMm = 0, className = '', style, onOverflowChange, children }) {
  const innerRef = useRef(null);
  const wPx = mmToPx(paper.w);
  const hPx = mmToPx(paper.h || paper.w);
  const overflowRef = useRef(null);

  useEffect(() => {
    const el = innerRef.current;
    if (!el || !onOverflowChange) return undefined;
    const check = () => {
      const over = el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
      if (over !== overflowRef.current) {
        overflowRef.current = over;
        onOverflowChange(over);
      }
    };
    check();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  });

  return (
    <div className={`kp-paper relative bg-white shadow-xl ring-1 ring-slate-900/10 ${className}`}
      style={{ width: wPx * zoom, height: hPx * zoom, ...style }}>
      <div ref={innerRef} className="kp-paper-inner"
        style={{
          width: wPx, height: hPx, padding: `${marginMm}mm`, boxSizing: 'border-box', overflow: 'hidden',
          transform: `scale(${zoom})`, transformOrigin: '0 0',
        }}>
        {children}
      </div>
    </div>
  );
}

// ─── Aperçu d'impression ────────────────────────────────────────

const IDLE_VIEW = { key: null, status: 'idle', entry: null, error: null };

const PrintPreview = forwardRef(function PrintPreview({
  open = true,
  onClose,
  variant = 'dialog',
  title = 'Impression',
  subtitle,
  documents = [],
  initialDocId,
  initialFormat,
  beforeLoad,
  reloadKey,
  prefetchIds = [],
  renderActions,
  onEscape,
  onPrinted,
  onReadyChange,
  showFooter = true,
  canvasClassName = 'h-[70vh] min-h-[420px]',
}, ref) {
  const isDialog = variant === 'dialog';
  const active = isDialog ? !!open : documents.length > 0;
  const uid = useId();
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;
  const panelId = `${uid}-panel`;
  const tabId = (id) => `${uid}-tab-${id}`;

  const [docId, setDocId] = useState(null);
  const [formatPref, setFormatPref] = useState(initialFormat || null);
  const [view, setView] = useState(IDLE_VIEW);
  const [layout, setLayout] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [zoomModes, setZoomModes] = useState({});
  const [avail, setAvail] = useState(0);
  const [announce, setAnnounce] = useState('');
  const [toast, setToast] = useState(null);
  const [beforeFailed, setBeforeFailed] = useState(false);

  // Réinitialisation à chaque ouverture (pendant le rendu pour éviter un chargement parasite)
  const [wasActive, setWasActive] = useState(false);
  if (active !== wasActive) {
    setWasActive(active);
    if (active) {
      setDocId(initialDocId && documents.some((d) => d.id === initialDocId) ? initialDocId : documents[0]?.id ?? null);
      setFormatPref(initialFormat || null);
      setView(IDLE_VIEW);
      setLayout(null);
      setToast(null);
      setBeforeFailed(false);
    }
  }

  const doc = documents.find((d) => d.id === docId) || documents[0] || null;
  const formatKeys = doc ? Object.keys(doc.formats || {}) : [];
  const formatKey = resolveFormat(doc, formatPref);
  const fmt = doc && formatKey ? doc.formats[formatKey] : null;
  const paper = PAPERS[fmt?.paper] || PAPERS.a4;
  const cacheKey = doc && formatKey ? `${doc.id}:${formatKey}` : null;
  const current = view.key === cacheKey ? view : { ...IDLE_VIEW, status: 'loading' };
  const entry = current.entry;
  const ready = current.status === 'ready';
  const lay = layout && entry && layout.entryId === entry.id ? layout : null;
  const isPdf = entry?.kind === 'pdf' || (!entry && fmt?.kind === 'pdf');

  const panelRef = useRef(null);
  const canvasRef = useRef(null);
  const frameRef = useRef(null);
  const cacheRef = useRef(new Map());
  const pendingRef = useRef(new Map());
  const staticRef = useRef(new WeakMap());
  const beforeRef = useRef(null);
  const keyRef = useRef(cacheKey);
  keyRef.current = cacheKey;
  const prefetchCtrlRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  const beforeLoadRef = useRef(beforeLoad);
  beforeLoadRef.current = beforeLoad;
  const ios = useMemo(() => isIOSDevice(), []);
  const safariDesktop = useMemo(() => isSafariDesktop(), []);

  const notify = useCallback((type, message) => setToast({ type, message, at: Date.now() }), []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  // Cache des documents : vit le temps d'une ouverture
  useEffect(() => {
    if (!active) return undefined;
    const cache = cacheRef.current;
    const pending = pendingRef.current;
    const prefetchCtrl = new AbortController();
    prefetchCtrlRef.current = prefetchCtrl;
    return () => {
      prefetchCtrl.abort();
      cache.forEach(revokeEntry);
      cache.clear();
      pending.clear();
      beforeRef.current = null;
    };
  }, [active]);

  const prevReloadKey = useRef(reloadKey);
  useEffect(() => {
    if (prevReloadKey.current === reloadKey) return;
    prevReloadKey.current = reloadKey;
    cacheRef.current.forEach(revokeEntry);
    cacheRef.current.clear();
    pendingRef.current.clear();
    beforeRef.current = null;
    setNonce((n) => n + 1);
  }, [reloadKey]);

  const runBefore = useCallback(() => {
    if (!beforeRef.current) {
      const fn = beforeLoadRef.current;
      beforeRef.current = Promise.resolve()
        .then(() => (fn ? fn() : null))
        .catch(() => setBeforeFailed(true));
    }
    return beforeRef.current;
  }, []);

  const fetchEntry = useCallback((key, def, pap, signal) => {
    const cache = cacheRef.current;
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    const pending = pendingRef.current;
    let p = pending.get(key);
    if (!p) {
      p = runBefore()
        .then(() => def.load(signal))
        .then((source) => {
          if (signal.aborted) throw new DOMException('Annulé', 'AbortError');
          const e = makeEntry(source, pap);
          cache.set(key, e);
          return e;
        });
      // Retiré dès l'annulation (synchrone) : un demandeur suivant ne doit pas hériter d'une requête annulée
      const drop = () => { if (pending.get(key) === p) pending.delete(key); };
      pending.set(key, p);
      signal.addEventListener('abort', drop, { once: true });
      p.catch(() => {}).finally(() => {
        signal.removeEventListener('abort', drop);
        drop();
      });
    }
    return p;
  }, [runBefore]);

  // Chargement du document actif
  useEffect(() => {
    if (!active || !doc || !fmt) return undefined;
    const key = cacheKey;
    if (fmt.source) {
      let e = staticRef.current.get(fmt.source);
      if (!e) {
        e = makeEntry(fmt.source, paper);
        staticRef.current.set(fmt.source, e);
      }
      setView({ key, status: 'rendering', entry: e, error: null });
      return undefined;
    }
    const cached = cacheRef.current.get(key);
    if (cached) {
      setView({ key, status: 'rendering', entry: cached, error: null });
      return undefined;
    }
    const ctrl = new AbortController();
    setView({ key, status: 'loading', entry: null, error: null });
    fetchEntry(key, fmt, paper, ctrl.signal).then(
      (e) => { if (!ctrl.signal.aborted) setView({ key, status: 'rendering', entry: e, error: null }); },
      (err) => {
        if (ctrl.signal.aborted) return;
        const message = errorMessage(err);
        setView({ key, status: 'error', entry: null, error: message });
        setAnnounce(`Erreur : ${message}`);
      },
    );
    return () => ctrl.abort();
  }, [active, cacheKey, fmt?.source, nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Préchargement discret des documents probables (cache partagé)
  useEffect(() => {
    if (!active || !ready || !prefetchIds.length) return undefined;
    const ctrl = prefetchCtrlRef.current;
    const run = () => {
      for (const id of prefetchIds) {
        const d = documents.find((x) => x.id === id);
        const fk = resolveFormat(d, 'thermal');
        const def = d?.formats?.[fk];
        if (!def?.load || !ctrl || ctrl.signal.aborted) continue;
        fetchEntry(`${id}:${fk}`, def, PAPERS[def.paper] || PAPERS.a4, ctrl.signal).catch(() => {});
      }
    };
    const t = setTimeout(run, 400);
    return () => clearTimeout(t);
  }, [active, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { onReadyChange?.(ready); }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFrameLoad = (e, ent, key) => {
    const frame = e.currentTarget;
    if (ent.kind === 'pdf') {
      setLayout({ entryId: ent.id, warnings: [] });
      setView((v) => (v.key === key ? { ...v, status: 'ready' } : v));
      setAnnounce(`Aperçu « ${doc?.label || 'document'} » prêt.`);
      return;
    }
    let fdoc = null;
    try { fdoc = frame.contentDocument; } catch { fdoc = null; }
    if (!fdoc || !fdoc.body) {
      setView((v) => (v.key === key ? { ...v, status: 'error', error: "Le navigateur a bloqué l'affichage de l'aperçu." } : v));
      return;
    }
    if (fdoc.URL && fdoc.URL !== 'about:srcdoc') return;
    waitForAssets(fdoc).then((missing) => {
      if (keyRef.current !== key || frame.contentDocument !== fdoc) return;
      const res = layoutFrame(fdoc, paper);
      const warnings = [];
      if (missing.length) warnings.push(`Image manquante : ${missing.join(', ')}.`);
      if (res.overflowX) warnings.push('Une partie du contenu dépasse la largeur du papier et sera coupée à l\'impression.');
      const contentPx = res.heightPx - mmToPx((ent.margins?.top || 0) + (ent.margins?.bottom || 0));
      const perPagePx = paper.h ? mmToPx(paper.h - (ent.margins?.top || 0) - (ent.margins?.bottom || 0)) : 0;
      const pages = paper.roll ? (res.heightsMm?.length || 1) : Math.max(1, Math.ceil((contentPx - 1) / (perPagePx || 1)));
      const lengthMm = res.heightsMm ? res.heightsMm.reduce((a, b) => a + b, 0) : null;
      setLayout({ entryId: ent.id, heightPx: res.heightPx, heightsMm: res.heightsMm, lengthMm, pages, perPagePx, warnings });
      setView((v) => (v.key === key ? { ...v, status: 'ready' } : v));
      const extra = lengthMm ? `, longueur environ ${formatCm(lengthMm)} cm` : pages > 1 ? `, environ ${pages} pages` : '';
      setAnnounce(`Aperçu « ${doc?.label || 'document'} » prêt${extra}.`);
    });
  };

  const openStandalone = useCallback(() => {
    if (!entry) return;
    let url;
    if (entry.kind === 'pdf') {
      url = entry.url;
    } else {
      let html = entry.html;
      const fdoc = frameRef.current?.contentDocument;
      if (fdoc?.documentElement) {
        const clone = fdoc.documentElement.cloneNode(true);
        clone.querySelector('#kp-preview-screen')?.remove();
        html = `<!DOCTYPE html>${clone.outerHTML}`;
      }
      url = URL.createObjectURL(new Blob([buildStandaloneHtml(html, currentOrigin())], { type: 'text/html;charset=utf-8' }));
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
    }
    const w = window.open(url, '_blank');
    if (!w) {
      notify('error', 'Fenêtre bloquée par le navigateur : autorisez les fenêtres pour ce site.');
      return false;
    }
    try { w.opener = null; } catch { /* noop */ }
    return true;
  }, [entry, notify]);

  const restoreFocus = useCallback((back) => {
    const usable = (el) => el && el !== document.body && el.tagName !== 'IFRAME' && el.isConnected && typeof el.focus === 'function';
    const scope = panelRef.current || canvasRef.current?.parentElement;
    const target = usable(back) ? back
      : scope?.querySelector('[data-pp-print]:not(:disabled)') || scope?.querySelector('[data-pp-close]') || canvasRef.current;
    target?.focus({ preventScroll: true });
  }, []);

  // Appelé dans le geste utilisateur (clic, Ctrl+P) : pas de fetch ni d'await avant print()
  const doPrint = useCallback(() => {
    if (!ready || !entry) {
      setAnnounce('Aperçu en cours de chargement, impression impossible pour le moment.');
      return;
    }
    if (ios) {
      if (openStandalone()) notify('info', 'Document ouvert dans un onglet : touchez Partager puis Imprimer.');
    } else if (entry.kind === 'pdf' && safariDesktop) {
      if (openStandalone()) notify('info', 'PDF ouvert dans un onglet : imprimez-le avec Fichier › Imprimer (⌘P).');
    } else {
      const win = frameRef.current?.contentWindow;
      const back = document.activeElement;
      try {
        win.focus();
        win.print();
      } catch {
        if (!openStandalone()) return;
      } finally {
        // print() rend la main à la fermeture de la boîte : sans ça, le focus reste dans l'iframe
        // et Échap / Ctrl+P n'atteignent plus le dialogue (Ctrl+P imprimerait la page de l'app).
        restoreFocus(back);
      }
    }
    onPrinted?.({ docId: doc?.id, format: formatKey });
  }, [ready, entry, ios, safariDesktop, openStandalone, restoreFocus, notify, onPrinted, doc?.id, formatKey]);

  const doPrintRef = useRef(doPrint);
  doPrintRef.current = doPrint;
  const readyRef = useRef(ready);
  readyRef.current = ready;

  useImperativeHandle(ref, () => ({
    print: () => doPrintRef.current(),
    isReady: () => readyRef.current,
  }), []);

  // Ctrl/Cmd+P imprime le document de l'aperçu, pas la page de l'application
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        e.stopPropagation();
        doPrintRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);

  // Dialogue : focus piégé, Échap, fond inerte, défilement bloqué, focus rendu à la fermeture
  useEffect(() => {
    if (!isDialog || !active) return undefined;
    const previous = document.activeElement;
    const root = document.getElementById('root');
    const panel = panelRef.current;
    const rootWasInert = root ? !!root.inert : false;
    if (root && panel && !root.contains(panel)) root.inert = true;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const raf = nextFrame(() => {
      const target = panel?.querySelector('[role="tab"][aria-selected="true"]') || panel?.querySelector('[data-pp-close]');
      target?.focus();
    });
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (onEscapeRef.current?.()) return;
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = focusableIn(panel);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const cur = document.activeElement;
      if (e.shiftKey && (cur === first || !panel.contains(cur))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (cur === last || !panel.contains(cur))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelFrame(raf);
      document.removeEventListener('keydown', onKey);
      if (root) root.inert = rootWasInert;
      document.body.style.overflow = prevOverflow;
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [isDialog, active]);

  // Largeur disponible pour le zoom « Ajuster »
  useLayoutEffect(() => {
    if (!active) return undefined;
    const el = canvasRef.current;
    if (!el) return undefined;
    setAvail(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setAvail(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);

  const paperPx = Math.round(mmToPx(paper.w));
  const zoomMode = zoomModes[paper.id] ?? 'fit';
  const fitZoom = computeFitZoom(avail - 32, paperPx, paper.roll ? 1.5 : 2);
  const zoom = zoomMode === 'fit' ? fitZoom : zoomMode;
  const setZoom = (value) => setZoomModes((m) => ({ ...m, [paper.id]: value }));

  const onRootKeyDown = (e) => {
    if (isPdf || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(stepZoom(zoom, 1)); }
    else if (e.key === '-') { e.preventDefault(); setZoom(stepZoom(zoom, -1)); }
    else if (e.key === '0') { e.preventDefault(); setZoom('fit'); }
  };

  const selectDoc = (id) => {
    if (id === doc?.id) return;
    setDocId(id);
  };

  const onTabKeyDown = (e) => {
    const idx = documents.findIndex((d) => d.id === doc?.id);
    let next = null;
    if (e.key === 'ArrowRight') next = (idx + 1) % documents.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + documents.length) % documents.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = documents.length - 1;
    if (next === null) return;
    e.preventDefault();
    const id = documents[next].id;
    selectDoc(id);
    const list = e.currentTarget.closest('[role="tablist"]');
    nextFrame(() => list?.querySelectorAll('[role="tab"]')[next]?.focus());
  };

  const onRadioKeyDown = (e) => {
    const idx = formatKeys.indexOf(formatKey);
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % formatKeys.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + formatKeys.length) % formatKeys.length;
    if (next === null) return;
    e.preventDefault();
    setFormatPref(formatKeys[next]);
    const group = e.currentTarget.closest('[role="radiogroup"]');
    nextFrame(() => group?.querySelectorAll('[role="radio"]')[next]?.focus());
  };

  const retry = () => {
    if (cacheKey) {
      revokeEntry(cacheRef.current.get(cacheKey));
      cacheRef.current.delete(cacheKey);
      pendingRef.current.delete(cacheKey);
    }
    setNonce((n) => n + 1);
  };

  if (!active || !doc) return null;

  const hasTabs = documents.length > 1;
  const paperLabel = isPdf ? `PDF ${paper.short}` : paper.label;
  const frameHeight = lay?.heightPx ? Math.max(lay.heightPx, paper.h ? Math.round(mmToPx(paper.h)) : 0)
    : (paper.h ? Math.round(mmToPx(paper.h)) : 600);
  const description = isPdf
    ? `PDF A4 généré par le serveur.${safariDesktop || ios ? ' Sur ce navigateur, l\'impression s\'ouvre dans un nouvel onglet.' : ''}`
    : paper.roll
      ? `Ticket thermique 80 mm (zone imprimable ${paper.printable} mm)${lay?.lengthMm ? ` — longueur ≈ ${formatCm(lay.lengthMm)} cm` : ''}.`
      : `${paper.label}${lay?.pages ? ` — ≈ ${lay.pages} page${lay.pages > 1 ? 's' : ''}` : ''}.`;
  const kbd = isMacLike() ? '⌘P' : 'Ctrl+P';
  const actionCtx = { doc, formatKey, paper, isPdf, ready, notify };

  const canvas = (
    <div ref={canvasRef} id={panelId}
      role={hasTabs ? 'tabpanel' : 'region'}
      aria-labelledby={hasTabs ? tabId(doc.id) : undefined}
      aria-label={hasTabs ? undefined : `Aperçu : ${doc.label}`}
      aria-busy={!ready}
      tabIndex={0}
      className={`relative overflow-auto bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 ${isDialog ? 'flex-1 min-h-0' : canvasClassName}`}>
      {(lay?.warnings?.length > 0 || beforeFailed) && (
        <div className="sticky top-0 z-10 mx-3 mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 shadow-sm">
          {beforeFailed && (
            <p className="flex gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />Les dernières modifications n'ont peut-être pas été enregistrées avant l'aperçu.</p>
          )}
          {lay?.warnings?.map((w) => (
            <p key={w} className="flex gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />{w}</p>
          ))}
        </div>
      )}

      {current.status === 'error' ? (
        <div className="flex h-full min-h-[320px] items-center justify-center p-6">
          <div role="alert" className="max-w-sm rounded-xl bg-white p-6 text-center shadow-xs border border-slate-200">
            <AlertCircle className="mx-auto mb-3 h-8 w-8 text-red-600" aria-hidden="true" />
            <p className="t-h2">Impossible d'afficher l'aperçu</p>
            <p className="mt-1 text-sm text-slate-600">{current.error}</p>
            <button type="button" onClick={retry} className="btn-secondary mt-4">
              <RefreshCw aria-hidden="true" /> Réessayer
            </button>
          </div>
        </div>
      ) : isPdf && entry ? (
        <div className="h-full min-h-[420px] p-3 sm:p-4">
          <iframe key={entry.id} ref={frameRef} src={entry.url}
            title={`Aperçu : ${doc.label}, ${paperLabel}`}
            onLoad={(e) => handleFrameLoad(e, entry, cacheKey)}
            className="h-full w-full rounded bg-white shadow-xl" />
        </div>
      ) : (
        <div className="w-fit min-w-full px-4 py-5">
          <div className="mx-auto" style={{ width: Math.round(paperPx * zoom) }}>
            {paper.roll && (
              <div aria-hidden="true" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                <span className="h-px flex-1 bg-slate-400" />{paper.w} mm<span className="h-px flex-1 bg-slate-400" />
              </div>
            )}
            <div className="relative bg-white shadow-xl ring-1 ring-slate-900/10"
              style={{ width: Math.round(paperPx * zoom), height: Math.round(frameHeight * zoom) }}>
              {entry && (
                <div style={{ width: paperPx, height: frameHeight, transform: `scale(${zoom})`, transformOrigin: '0 0' }}>
                  <iframe key={entry.id} ref={frameRef} srcDoc={entry.html}
                    sandbox="allow-same-origin allow-modals"
                    title={`Aperçu : ${doc.label}, ${paperLabel}`}
                    tabIndex={-1}
                    onLoad={(e) => handleFrameLoad(e, entry, cacheKey)}
                    style={{ width: paperPx, height: frameHeight, border: 0, display: 'block', pointerEvents: 'none', background: '#fff' }} />
                </div>
              )}
              {paper.roll && ready && (
                <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 border-x border-dashed border-sky-500/60"
                  style={{ left: mmToPx((paper.w - paper.printable) / 2) * zoom, right: mmToPx((paper.w - paper.printable) / 2) * zoom }} />
              )}
              {!paper.roll && ready && lay?.pages > 1 && Array.from({ length: lay.pages - 1 }, (_, k) => (
                <div key={k} aria-hidden="true" className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-sky-500/70"
                  style={{ top: (mmToPx(entry?.margins?.top || 0) + (k + 1) * lay.perPagePx) * zoom }}>
                  <span className="absolute right-1 -top-5 rounded bg-sky-700 px-1.5 py-0.5 text-xs font-semibold text-white">Page {k + 2} ≈</span>
                </div>
              ))}
              {!ready && (
                <div className="absolute inset-0 flex flex-col items-center justify-start gap-3 bg-white pt-16">
                  <div className="w-3/4 space-y-3 motion-safe:animate-pulse" aria-hidden="true">
                    <div className="mx-auto h-10 w-1/2 rounded bg-slate-200" />
                    <div className="h-3 rounded bg-slate-200" />
                    <div className="h-3 w-5/6 rounded bg-slate-200" />
                    <div className="h-3 w-2/3 rounded bg-slate-200" />
                  </div>
                  <p className="flex items-center gap-2 text-sm text-slate-600">
                    <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> Chargement de l'aperçu…
                  </p>
                </div>
              )}
            </div>
            {paper.roll && ready && lay?.lengthMm && (
              <p className="mt-2 text-center text-xs font-medium text-slate-700">
                Longueur ≈ {formatCm(lay.lengthMm)} cm
                {lay.heightsMm.length > 1 && ` (${lay.heightsMm.map(formatCm).join(' + ')} cm)`}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );

  const toolbar = (
    <div className="shrink-0 border-b border-slate-200 bg-slate-50">
      {hasTabs && (
        /* Sous sm les icônes (décoratives) sont masquées pour que les 5 onglets tiennent sur 390 px ;
           si ça déborde quand même (petit écran, police plus large), le fondu à droite signale le
           défilement et le pr-8 laisse le dernier onglet sortir du fondu une fois tout à droite. */
        <div className="scroll-fade-x">
          <div role="tablist" aria-label="Document à imprimer"
            className="page-tabs snap-x pl-3 pr-8 sm:px-4">
            {documents.map((d) => {
              const Icon = d.icon;
              const sel = d.id === doc.id;
              return (
                <button key={d.id} type="button" role="tab" id={tabId(d.id)} aria-selected={sel} aria-controls={panelId}
                  tabIndex={sel ? 0 : -1} title={d.desc} onClick={() => selectDoc(d.id)} onKeyDown={onTabKeyDown}
                  className={`page-tab shrink-0 snap-start ${sel ? 'page-tab-active' : ''}`}>
                  {Icon && <Icon className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden="true" />}
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 sm:px-4">
        {formatKeys.length > 1 ? (
          <div role="radiogroup" aria-label="Format d'impression" className="segmented">
            {formatKeys.map((k) => {
              const def = doc.formats[k];
              const p = PAPERS[def.paper] || PAPERS.a4;
              const sel = k === formatKey;
              return (
                <button key={k} type="button" role="radio" aria-checked={sel} tabIndex={sel ? 0 : -1}
                  onClick={() => setFormatPref(k)} onKeyDown={onRadioKeyDown}
                  className={`segmented-item min-w-11 ${sel ? 'segmented-item-active' : ''}`}>
                  {def.label || (p.roll ? 'Ticket 80 mm' : p.short)}
                </button>
              );
            })}
          </div>
        ) : (
          <span className="text-sm font-semibold text-slate-700">{paperLabel}</span>
        )}
        {!isPdf && (
          <div role="group" aria-label="Zoom" className="ml-auto flex items-center gap-2">
            <span className="min-w-[3.25rem] text-right t-caption tabular-nums" aria-hidden="true">
              {Math.round(zoom * 100)} %
            </span>
            <div className="segmented">
              {ZOOM_PRESETS.map((z) => (
                <button key={String(z.value)} type="button" aria-pressed={zoomMode === z.value}
                  onClick={() => setZoom(z.value)}
                  className={`segmented-item min-w-11 px-2.5 ${zoomMode === z.value ? 'segmented-item-active' : ''}`}>
                  {z.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const footer = showFooter && (
    <div className="shrink-0 border-t border-slate-200 bg-white px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" data-pp-print onClick={doPrint} disabled={!ready}
          className="btn-primary flex-1">
          <Printer aria-hidden="true" />
          Imprimer <span className="whitespace-nowrap font-medium opacity-90">({isPdf ? 'PDF A4' : paper.short})</span>
          <kbd className="ml-1 hidden rounded border border-white/40 px-1.5 py-0.5 text-xs font-semibold lg:inline">{kbd}</kbd>
        </button>
        {isPdf && entry?.url && (
          <a href={entry.url} download={entry.filename} className="btn-secondary">
            <Download aria-hidden="true" /> PDF
          </a>
        )}
        {renderActions?.(actionCtx)}
        <button type="button" onClick={openStandalone} disabled={!ready}
          aria-label="Ouvrir le document dans un nouvel onglet" title="Ouvrir dans un nouvel onglet"
          className="btn-secondary btn-icon">
          <ExternalLink aria-hidden="true" />
        </button>
      </div>
      <p id={descId} className="mt-2 text-center t-caption">{description}</p>
    </div>
  );

  const toastEl = toast && (
    <div className={`pointer-events-none absolute inset-x-0 z-20 flex justify-center px-4 ${isDialog ? 'bottom-28' : 'bottom-4'}`}>
      <div role={toast.type === 'error' ? 'alert' : 'status'}
        className={`pointer-events-auto flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg motion-safe:animate-[ppToastIn_200ms_ease-out] ${
          toast.type === 'error' ? 'bg-red-700' : toast.type === 'success' ? 'bg-emerald-700' : 'bg-slate-800'}`}>
        {toast.type === 'error'
          ? <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
          : <CheckCircle className="h-5 w-5 shrink-0" aria-hidden="true" />}
        <span>{toast.message}</span>
        <button type="button" onClick={() => setToast(null)} aria-label="Fermer la notification"
          className={`-mr-1 inline-flex h-11 w-11 items-center justify-center rounded-lg hover:bg-white/15 ${FOCUS_RING}`}>
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );

  const styles = (
    <style>{`
      @keyframes ppSlideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
      @keyframes ppToastIn { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    `}</style>
  );

  const live = <p className="sr-only" aria-live="polite">{announce}</p>;

  if (!isDialog) {
    return (
      <section className="relative flex flex-col" aria-label={title} aria-describedby={descId} onKeyDown={onRootKeyDown}>
        {toolbar}
        {canvas}
        {footer || <p id={descId} className="sr-only">{description}</p>}
        {toastEl}
        {live}
        {styles}
      </section>
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[110] flex justify-end">
      <div className="absolute inset-0 bg-slate-900/50 motion-safe:backdrop-blur-sm" aria-hidden="true" onClick={() => onCloseRef.current?.()} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId}
        onKeyDown={onRootKeyDown}
        className="relative flex h-full w-full flex-col bg-white shadow-lg motion-safe:animate-[ppSlideIn_200ms_ease-out] lg:w-[680px]">
        <div className="flex shrink-0 min-h-14 items-center justify-between gap-3 border-b border-slate-200 px-4 py-2 sm:px-5">
          <div className="min-w-0">
            <h2 id={titleId} className="t-h2">{title}</h2>
            {subtitle && <p className="truncate t-small">{subtitle}</p>}
          </div>
          <button type="button" data-pp-close onClick={() => onCloseRef.current?.()} aria-label="Fermer l'aperçu"
            className="btn-ghost btn-icon shrink-0">
            <X className="!h-5 !w-5" aria-hidden="true" />
          </button>
        </div>
        {toolbar}
        {canvas}
        {footer || <p id={descId} className="sr-only">{description}</p>}
        {toastEl}
        {live}
      </div>
      {styles}
    </div>,
    document.body,
  );
});

export default PrintPreview;
