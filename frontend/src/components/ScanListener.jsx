import { lazy, Suspense, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useToast } from './Toast';
import {
  SCAN_EVENT, SCAN_TIMING, createScanBuffer, parseScan, scanQuery, scanLabel, typeaheadIndex,
} from '../lib/scan';

const QuickScanPanel = lazy(() => import('./QuickScanPanel'));

// Une douchette USB / Bluetooth en émulation clavier tape le code en quelques
// millisecondes par touche puis envoie Entrée ou Tab (ou rien). La rafale est
// reconnue à sa cadence ; ses caractères ne doivent jamais rester dans le champ
// qui avait le focus (sinon l'auto-save de la fiche les enregistre).

const STAFF_ROUTE_RE = /^\/(accueil|tech)(\/|$)/;
const LOGIN_ROUTE_RE = /^\/login(\/|$)/;
const DEDUPE_MS = 1500;
// 2e touche d'un suffixe double (CR+LF, Tab+Entrée) : bloquée pendant ce délai après le scan
const SUFFIX_MS = 80;
// En dessous, une rafale non reconnue peut venir d'un humain très rapide : on lui rend ses caractères
const UNKNOWN_MIN_LENGTH = 6;
// Champs où un IMEI ou un numéro de série scanné doit s'écrire normalement
const SCAN_FIELD_RE = /imei|s[ée]rie|serial|code[\s-]?barre|\bean\b/i;
const NEUTRAL_KEYS = new Set(['Shift', 'CapsLock', 'Dead', 'Unidentified', 'AltGraph', 'NumLock']);
const NON_TEXT_INPUTS = new Set([
  'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image', 'range', 'color', 'hidden',
]);

// ─── Retour sonore (réglage par poste) ───────────────────────────────────────

const SOUND_KEY = 'kp_scan_sound';
let audioCtx = null;

export function isScanSoundOn() {
  try {
    return localStorage.getItem(SOUND_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setScanSoundOn(on) {
  try {
    localStorage.setItem(SOUND_KEY, on ? '1' : '0');
  } catch { /* stockage indisponible : réglage non mémorisé */ }
}

// Le contexte audio doit naître ou reprendre pendant une frappe (activation utilisateur)
export function primeScanAudio() {
  try {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  } catch {
    audioCtx = null;
  }
}

const SOUNDS = {
  ok: { type: 'sine', gain: 0.2, notes: [[1200, 0, 0.07]] },
  warn: { type: 'sine', gain: 0.2, notes: [[880, 0, 0.09], [880, 0.15, 0.09]] },
  error: { type: 'square', gain: 0.1, notes: [[220, 0, 0.3]] },
};

// Volontairement indépendant de prefers-reduced-motion : c'est un retour fonctionnel
export function playScanSound(kind = 'ok') {
  if (!isScanSoundOn()) return;
  primeScanAudio();
  if (!audioCtx) return;
  try {
    const s = SOUNDS[kind] || SOUNDS.ok;
    const t0 = audioCtx.currentTime;
    for (const [freq, delay, dur] of s.notes) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = s.type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + delay);
      gain.gain.exponentialRampToValueAtTime(s.gain, t0 + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + dur);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0 + delay);
      osc.stop(t0 + delay + dur + 0.02);
    }
  } catch { /* audio indisponible */ }
}

// ─── Scan en attente (panneau pas encore chargé) ─────────────────────────────

let pendingScan = null;

/** Dernier scan émis alors qu'aucun panneau ne l'écoutait encore (chargement différé). */
export function takePendingScan() {
  const s = pendingScan;
  pendingScan = null;
  return s && Date.now() - s.at < 10_000 ? s.detail : null;
}

function emitScan(detail) {
  const payload = { ...detail, accepted: false };
  window.dispatchEvent(new CustomEvent(SCAN_EVENT, { detail: payload }));
  pendingScan = payload.accepted ? null : { detail, at: Date.now() };
}

/**
 * Ouvre le panneau d'action rapide sur un ticket connu, par le même événement qu'un scan
 * (remise au client demandée depuis le dashboard). ticketId : pas de résolution du code,
 * pas de bip, jamais compté comme « 2e scan identique ».
 */
export function openQuickScan({ id, code }) {
  if (!id) return;
  const label = String(code || `#${id}`);
  emitScan({ kind: 'ticket', code: label, query: label, label, ticketId: id, source: 'manuel' });
}

// ─── Champs de saisie ────────────────────────────────────────────────────────

function isTextField(el) {
  if (!el || !el.tagName) return false;
  if (el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && !NON_TEXT_INPUTS.has(String(el.type || 'text').toLowerCase());
}

export function isEditable(el) {
  return !!el && (isTextField(el) || el.tagName === 'SELECT' || el.isContentEditable === true);
}

/** Champ qui attend une valeur scannée (IMEI, n° de série) : marqué data-scan-target ou libellé explicite. */
export function isScanField(el) {
  if (!isTextField(el)) return false;
  if (el.closest('[data-scan-target]')) return true;
  const hints = [el.name, el.id, el.placeholder, el.getAttribute('aria-label')];
  for (const l of el.labels || []) hints.push(l.textContent);
  const sibling = el.parentElement?.querySelector(':scope > label');
  if (sibling) hints.push(sibling.textContent);
  return SCAN_FIELD_RE.test(hints.filter(Boolean).join(' '));
}

function nativeValueSetter(el) {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype
    : el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
  return Object.getOwnPropertyDescriptor(proto, 'value')?.set;
}

// Le setter natif contourne le suivi de valeur de React : l'événement input
// déclenche alors bien onChange avec la valeur rétablie.
function writeValue(el, value) {
  const set = nativeValueSetter(el);
  if (set) set.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}

function selection(el) {
  try {
    return [el.selectionStart, el.selectionEnd];
  } catch {
    return [null, null];
  }
}

export function snapshotField(el) {
  if (!isTextField(el) && el?.tagName !== 'SELECT') return null;
  const [start, end] = el.tagName === 'SELECT' ? [null, null] : selection(el);
  return { el, value: el.value, start, end };
}

export function restoreField(snap) {
  const { el, value, start, end } = snap;
  if (!el.isConnected || el.value === value) return;
  writeValue(el, value);
  if (start != null) {
    try {
      el.setSelectionRange(start, end ?? start);
    } catch { /* type sans sélection (email, number) */ }
  }
}

/** Rejoue sur un <select> la recherche par lettre retenue pendant une rafale qui s'avère humaine. */
export function selectTypeahead(el, text) {
  if (el?.tagName !== 'SELECT' || !el.isConnected || el.disabled) return;
  const labels = [...el.options].map((o) => (o.disabled ? null : o.text));
  const i = typeaheadIndex(labels, el.selectedIndex, text);
  if (i >= 0 && i !== el.selectedIndex) writeValue(el, el.options[i].value);
}

/** Rend au champ les caractères retenus pendant une rafale qui s'avère humaine. */
export function insertIntoField(el, text) {
  if (!text || !isTextField(el) || !el.isConnected || el.readOnly || el.disabled) return;
  if (el.maxLength > 0 && el.value.length + text.length > el.maxLength) return;
  const [start, end] = selection(el);
  if (start != null && typeof el.setRangeText === 'function') {
    el.setRangeText(text, start, end ?? start, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    writeValue(el, el.value + text);
  }
}

function paletteOpen() {
  return !!document.querySelector('[data-search-palette]');
}

function ignoredZone(el) {
  return !!el?.closest?.('[data-scan-ignore], [data-search-palette]');
}

// Une autre fenêtre (impression, notifications, modale) est ouverte ou contient le focus
function blockingDialogOpen(focused) {
  const own = '[data-scan-panel], [data-search-palette]';
  const inDialog = focused?.closest?.('[role="dialog"], [role="alertdialog"]');
  if (inDialog && !inDialog.closest(own)) return true;
  for (const d of document.querySelectorAll('[aria-modal="true"], [role="alertdialog"]')) {
    if (!d.closest(own)) return true;
  }
  return false;
}

function block(e) {
  e.preventDefault();
  e.stopPropagation();
}

/** Panneau d'action rapide : chargé seulement pour le personnel connecté (ni kiosque, ni suivi, ni dépôt). */
export function QuickScanMount() {
  const { user } = useAuth();
  if (user?.target !== 'accueil' && user?.target !== 'tech') return null;
  return <Suspense fallback={null}><QuickScanPanel /></Suspense>;
}

export default function ScanListener() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const staff = user?.target === 'accueil' || user?.target === 'tech';
  // Pages publiques (suivi, kiosque, dépôt) : la douchette tape normalement.
  // Page de connexion : le scan est bloqué pour ne pas remplir le PIN.
  const mode = staff && STAFF_ROUTE_RE.test(pathname) ? 'staff'
    : LOGIN_ROUTE_RE.test(pathname) ? 'login' : null;

  useEffect(() => {
    if (!mode) return undefined;
    const T = SCAN_TIMING;
    const buf = createScanBuffer(T);
    let snaps = new Map();
    let swallowed = '';
    let target = null;
    let scanField = false;
    // <select> focalisé : sa recherche par lettre changerait la valeur (et l'enregistrerait)
    // dès la 1re touche, donc toutes les touches sont retenues puis rejouées si la frappe est humaine
    let holdAll = false;
    // Rafale courte juste avant (touche lente Bluetooth en début de scan) : { text, snaps }
    let prev = null;
    let idleTimer = null;
    let suffixUntil = 0;
    let last = { query: '', at: 0 };

    const clearIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
    };
    const resetBurst = () => {
      clearIdle();
      buf.reset();
      snaps = new Map();
      swallowed = '';
      target = null;
      scanField = false;
      holdAll = false;
      prev = null;
    };
    const giveBack = () => {
      const text = swallowed;
      swallowed = '';
      if (!text) return;
      if (holdAll) selectTypeahead(target, text);
      else insertIntoField(document.activeElement, text);
    };
    const restoreAll = () => {
      [...snaps.values()].reverse().forEach(restoreField);
      if (target?.isConnected && document.activeElement !== target && typeof target.focus === 'function') {
        target.focus();
      }
    };

    const notify = (kind, message) => {
      playScanSound('error');
      toastRef.current[kind](message);
    };

    // La rafale seule, ou précédée de la rafale courte d'avant quand c'est ensemble qu'elles forment un code
    const readBurst = () => {
      const direct = parseScan(buf.text);
      if (prev) {
        const text = prev.text + buf.text;
        const joined = parseScan(text);
        const q = scanQuery(joined);
        if (q && (!scanQuery(direct) || scanQuery(direct) === q)) {
          for (const [el, snap] of prev.snaps) snaps.set(el, snap);
          return { parsed: joined, text };
        }
      }
      return { parsed: direct, text: buf.text };
    };

    // true : le scan est pris en charge (champ rétabli, suffixe neutralisé)
    const dispatch = ({ parsed, text }) => {
      const query = scanQuery(parsed);
      const label = scanLabel(parsed);
      if (scanField && parsed.kind !== 'ticket') {
        if (parsed.kind === 'imei') playScanSound('ok');
        return false;
      }
      const editable = isEditable(target);
      // Résultat peu distinctif (inconnu, n° de série) d'une frappe humaine qui a démarré vite :
      // rendu au champ, sans message
      if ((!query || parsed.kind === 'serial') && !buf.scanLike()) return false;
      if (!query) {
        if (editable && text.length < UNKNOWN_MIN_LENGTH) return false;
        restoreAll();
        if (parsed.kind === 'ean') notify('warning', `Code-barres produit (EAN) : ce n'est pas un ticket (${label}).`);
        else if (parsed.reason === 'imei_invalide') notify('warning', `IMEI illisible ou invalide : ${label}.`);
        else notify('warning', `Code non reconnu : ${label}`);
        return true;
      }
      restoreAll();
      if (mode === 'login') {
        notify('info', 'Connectez-vous pour utiliser la douchette.');
        return true;
      }
      if (blockingDialogOpen(target)) {
        notify('warning', 'Terminez ou fermez la fenêtre ouverte avant de scanner.');
        return true;
      }
      const now = Date.now();
      if (query === last.query && now - last.at < DEDUPE_MS) return true;
      last = { query, at: now };
      emitScan({ ...parsed, query, label });
      return true;
    };

    const finalize = (e) => {
      clearIdle();
      const editable = isEditable(target);
      const handled = dispatch(readBurst());
      let blocked = handled;
      if (!handled) {
        if (!scanField) giveBack();
        // Entrée de la douchette sur un bouton ou un lien : ne jamais déclencher l'action ciblée
        blocked = !editable || (scanField && e?.key === 'Enter' && !!target?.form);
      }
      if (e && blocked) {
        block(e);
        suffixUntil = performance.now() + SUFFIX_MS;
      }
      resetBurst();
    };

    const onKeyDown = (e) => {
      if (e.isComposing) return;
      const el = document.activeElement;
      if (paletteOpen() || ignoredZone(el)) {
        if (buf.text) resetBurst();
        return;
      }
      const key = e.key || '';
      if (NEUTRAL_KEYS.has(key)) return;
      const now = performance.now();
      if (now < suffixUntil && !buf.text
        && (key === 'Enter' || key === 'Tab' || (e.ctrlKey && /^[jm]$/i.test(key)))) {
        block(e);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) {
        giveBack();
        resetBurst();
        return;
      }
      if (key === 'Enter' || key === 'Tab') {
        if (buf.qualified && buf.continues(now)) finalize(e);
        else {
          giveBack();
          resetBurst();
        }
        return;
      }
      // Espace en début de frappe sur un <select> : ouvre la liste, comme d'habitude
      const opensSelect = key === ' ' && el?.tagName === 'SELECT' && !buf.continues(now);
      if (key.length !== 1 || opensSelect) {
        giveBack();
        resetBurst();
        return;
      }
      if (!buf.continues(now)) {
        const prefix = (prev?.text || '') + buf.text;
        const near = !buf.qualified && buf.text.length > 0 && target === el && now - buf.lastAt <= T.scanGap;
        const short = near && prefix.length < T.minLength;
        const carried = short ? { text: prefix, snaps: prev ? new Map([...snaps, ...prev.snaps]) : snaps } : null;
        // <select> : la recherche par lettre se poursuit tant que les touches se suivent
        const held = near && holdAll ? swallowed : '';
        if (buf.qualified) finalize(null);
        else if (!held) giveBack();
        resetBurst();
        prev = carried;
        swallowed = held;
        target = el;
        scanField = isScanField(el);
        holdAll = el?.tagName === 'SELECT';
      }
      if (el && !snaps.has(el)) {
        const snap = snapshotField(el);
        if (snap) snaps.set(el, snap);
      }
      const r = buf.push(key, now);
      if (r.disqualified && !holdAll) giveBack();
      if (r.qualified) primeScanAudio();
      if (!scanField && (buf.qualified || holdAll)) {
        block(e);
        swallowed += key;
      }
      clearIdle();
      if (buf.qualified) {
        idleTimer = setTimeout(() => finalize(null), T.scanGap);
      } else if (holdAll) {
        idleTimer = setTimeout(() => {
          giveBack();
          resetBurst();
        }, T.scanGap);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      clearIdle();
    };
  }, [mode]);

  return null;
}
