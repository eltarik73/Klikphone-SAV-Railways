/**
 * Douchette (lecteur QR / code-barres en émulation clavier) : décodage des codes scannés
 * et détection des rafales de frappe. Fonctions pures, testées dans tests/scan.test.js.
 */

// Événement émis par ScanListener et écouté par QuickScanPanel
export const SCAN_EVENT = 'kp:scan';

export const SCAN_TIMING = {
  // Nombre de touches avant de considérer la rafale comme un scan
  minLength: 4,
  // Intervalle médian maximal entre deux touches (douchette USB : 1-30 ms, Bluetooth lente : 45-60 ms)
  maxMedianGap: 60,
  // Au-delà, l'intervalle est humain : deux de suite (ou une médiane au-delà) déqualifient la rafale
  humanGap: 100,
  // Silence qui interrompt une rafale pas encore reconnue comme un scan
  burstGap: 120,
  // Une fois le scan reconnu : tolérance d'une touche lente (Bluetooth) et fin de scan sans suffixe
  scanGap: 300,
};

// Douchette réglée en QWERTY sur un poste AZERTY : la rangée des chiffres sort sans Maj
// (Windows : à & é " ' ( - è _ ç ; Mac : § pour 6 et ! pour 8) et le tiret devient « ) ».
// Verr. Maj sous Windows : les chiffres sortent justes mais le tiret devient « ° ».
const AZERTY_TO_QWERTY = {
  'à': '0', 'À': '0', '&': '1', 'é': '2', 'É': '2', '"': '3', "'": '4', '(': '5',
  '-': '6', '§': '6', 'è': '7', 'È': '7', '_': '8', '!': '8', 'ç': '9', 'Ç': '9', ')': '-', '°': '-',
};

// Caractères qu'une douchette bien configurée n'envoie jamais dans nos codes (le tiret seul ne compte pas)
const AZERTY_MARKERS = /[àÀ&éÉ"'(§èÈ_!çÇ)°]/;
const URL_TICKET_RE = /[?&]ticket=([^&#\s]+)/i;
// « KP-000123 », « kp123 », « KP 000123 », « KP.123 », « #123 »
const TICKET_RE = /^(?:kp|#)[._#:-]*0*(\d{1,7})$/i;
// « 000123 » : code imprimé sans préfixe (un téléphone ne commence jamais par 00 sur 6-7 chiffres)
const PADDED_RE = /^00\d{4,5}$/;
// Fin d'une URL de QR tapée en AZERTY : « …suivi§ticket=KP)ààà&é" » une fois corrigée
const TAIL_KP_RE = /kp[^a-z0-9]{0,2}0*(\d{1,7})$/i;
// Numéro de série constructeur : 10-12 alphanumériques dont au moins 2 lettres et 2 chiffres
const SERIAL_RE = /^(?=(?:.*\d){2})(?=(?:.*[a-z]){2})[a-z0-9]{10,12}$/i;

/** Retire les caractères de contrôle (préfixe/suffixe de certaines douchettes) et les espaces de bord. */
export function cleanScan(raw) {
  return String(raw ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
}

/** Rétablit les chiffres et le tiret d'un code tapé par une douchette QWERTY sur un poste AZERTY. */
export function descrambleAzerty(text) {
  let out = '';
  for (const ch of String(text ?? '')) out += AZERTY_TO_QWERTY[ch] ?? ch;
  return out;
}

export function luhnOk(digits) {
  const d = String(digits ?? '');
  if (!/^\d+$/.test(d) || /^0+$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = d.charCodeAt(d.length - 1 - i) - 48;
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/** Clé de contrôle GS1 (EAN-8, UPC-A, EAN-13, GTIN-14) : code-barres produit. */
export function gtinOk(digits) {
  const d = String(digits ?? '');
  if (![8, 12, 13, 14].includes(d.length) || !/^\d+$/.test(d) || /^0+$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < d.length - 1; i++) {
    const n = d.charCodeAt(d.length - 2 - i) - 48;
    sum += i % 2 === 0 ? n * 3 : n;
  }
  return (10 - (sum % 10)) % 10 === d.charCodeAt(d.length - 1) - 48;
}

function padTicket(n) {
  const id = parseInt(n, 10);
  return id > 0 ? `KP-${String(id).padStart(6, '0')}` : null;
}

/** Code ticket canonique (« KP-000123 ») ou null. `bare` accepte un nombre nu (valeur issue d'une URL de QR). */
export function normalizeTicketCode(value, { bare = false } = {}) {
  const s = String(value ?? '').replace(/\s+/g, '');
  if (!s) return null;
  const m = s.match(TICKET_RE);
  if (m) return padTicket(m[1]);
  if (PADDED_RE.test(s)) return padTicket(s);
  if (bare && /^\d{1,7}$/.test(s)) return padTicket(s);
  return null;
}

function decodeParam(v) {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function parsePlain(s) {
  const url = s.match(URL_TICKET_RE);
  if (url) {
    const code = normalizeTicketCode(decodeParam(url[1]).trim(), { bare: true });
    return code ? { kind: 'ticket', code, source: 'url' } : { kind: 'unknown' };
  }
  const compact = s.replace(/\s+/g, '');
  const code = normalizeTicketCode(compact);
  if (code) return { kind: 'ticket', code };
  const digits = compact.replace(/[.\-/]/g, '');
  if (/^\d+$/.test(digits)) {
    if (digits.length === 15) {
      return luhnOk(digits) ? { kind: 'imei', imei: digits } : { kind: 'unknown', reason: 'imei_invalide' };
    }
    if (gtinOk(digits)) return { kind: 'ean' };
    return { kind: 'unknown' };
  }
  if (SERIAL_RE.test(compact)) return { kind: 'serial', serial: compact.toUpperCase() };
  return { kind: 'unknown' };
}

/**
 * Nature d'un texte scanné : ticket (URL du QR ou code), IMEI (15 chiffres, Luhn),
 * numéro de série, code-barres produit (EAN) ou inconnu.
 * Tolère Verr. Maj et une douchette QWERTY sur un poste AZERTY.
 */
export function parseScan(raw) {
  const text = cleanScan(raw);
  if (!text) return { kind: 'empty', raw: '' };
  const direct = parsePlain(text);
  if (direct.kind !== 'unknown') return { ...direct, raw: text };
  const fixed = descrambleAzerty(text);
  if (fixed !== text && AZERTY_MARKERS.test(text)) {
    const alt = parsePlain(fixed);
    // Un n° de série « corrigé » n'est pas fiable (les lettres A/Q, Z/W sont aussi permutées)
    if (alt.kind !== 'unknown' && alt.kind !== 'serial') return { ...alt, raw: text, azerty: true };
    const tail = fixed.match(TAIL_KP_RE);
    const code = tail && padTicket(tail[1]);
    if (code && /ticket|suivi|http/i.test(fixed)) return { kind: 'ticket', code, raw: text, azerty: true };
  }
  return { ...direct, raw: text };
}

/** Valeur à envoyer à GET /api/search/resolve pour un scan reconnu, sinon null. */
export function scanQuery(parsed) {
  if (!parsed) return null;
  if (parsed.kind === 'ticket') return parsed.code;
  if (parsed.kind === 'imei') return parsed.imei;
  if (parsed.kind === 'serial') return parsed.serial;
  return null;
}

/** Libellé court du scan pour les messages (« KP-000123 », « IMEI 3567… »). */
export function scanLabel(parsed) {
  if (!parsed) return '';
  if (parsed.kind === 'ticket') return parsed.code;
  if (parsed.kind === 'imei') return `IMEI ${parsed.imei}`;
  if (parsed.kind === 'serial') return `n° de série ${parsed.serial}`;
  const raw = String(parsed.raw || '');
  return raw.length > 30 ? `${raw.slice(0, 30)}…` : raw;
}

export function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function fold(s) {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/**
 * Option qu'aurait choisie la recherche par lettre d'un <select> (comme le navigateur) : index ou -1.
 * `labels` : libellés des options (null pour une option désactivée), `current` : index sélectionné.
 */
export function typeaheadIndex(labels, current, typed) {
  const q = fold(typed);
  if (!q) return -1;
  const n = labels.length;
  if ([...q].every((c) => c === q[0])) {
    // Même lettre répétée : passe à l'option suivante qui commence par cette lettre, à chaque frappe
    const cands = labels.map((l, i) => (l != null && fold(l).startsWith(q[0]) ? i : -1)).filter((i) => i >= 0);
    if (!cands.length) return -1;
    let idx = current;
    for (let k = 0; k < q.length; k++) idx = cands.find((i) => i > idx) ?? cands[0];
    return idx;
  }
  for (let k = 0; k < n; k++) {
    const i = (Math.max(0, current) + k) % n;
    if (labels[i] != null && fold(labels[i]).startsWith(q)) return i;
  }
  return -1;
}

/**
 * Rafale de frappe en cours. `push` renvoie :
 *  - fresh : la touche ouvre une nouvelle rafale (silence précédent trop long)
 *  - qualified : la rafale a la cadence d'une douchette (≥ minLength touches, médiane ≤ maxMedianGap)
 *  - disqualified : la rafale semblait un scan mais la cadence est devenue humaine
 * `scanLike()` vérifie la cadence sur toute la rafale (au plus 1 intervalle lent sur 10, au moins 1
 * toléré) : une frappe humaine qui démarre vite puis ralentit garde une médiane basse mais échoue.
 */
export function createScanBuffer(timing = SCAN_TIMING) {
  let chars = '';
  let gaps = [];
  let last = -Infinity;
  let qualified = false;
  let human = false;

  const reset = () => {
    chars = '';
    gaps = [];
    last = -Infinity;
    qualified = false;
    human = false;
  };

  return {
    get text() { return chars; },
    get qualified() { return qualified; },
    get lastAt() { return last; },
    // La touche reçue à `now` prolonge-t-elle la rafale en cours ?
    continues(now) {
      return chars.length > 0 && now - last <= (qualified ? timing.scanGap : timing.burstGap);
    },
    push(ch, now) {
      const fresh = !this.continues(now);
      if (fresh) reset();
      else gaps.push(now - last);
      chars += ch;
      last = now;
      let disqualified = false;
      const n = gaps.length;
      const slowTail = n >= 2 && gaps[n - 1] > timing.humanGap && gaps[n - 2] > timing.humanGap;
      if (qualified && (median(gaps) > timing.humanGap || slowTail)) {
        qualified = false;
        human = true;
        disqualified = true;
      } else if (!qualified && !human && chars.length >= timing.minLength
        && median(gaps) <= timing.maxMedianGap) {
        qualified = true;
      }
      return { fresh, qualified, disqualified };
    },
    scanLike() {
      if (!gaps.length) return false;
      const slow = gaps.filter((g) => g > timing.maxMedianGap).length;
      return slow <= Math.max(1, Math.floor(gaps.length / 10));
    },
    reset,
  };
}
