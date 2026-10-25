// Fonctions pures partagées par la recherche staff (SearchPalette) et le suivi public (SuiviPage).
// Module léger à part : le suivi client n'embarque pas la palette de recherche du personnel.

export function digitsOnly(s) {
  return String(s ?? '').replace(/\D+/g, '');
}

const TICKET_URL_RE = /[?&]ticket=([^&#\s]+)/i;
// « KP-000123 », « kp123 », « KP.123 » (douchette QWERTY sur poste AZERTY), « #123 »
const TICKET_PREFIXED_RE = /^(?:kp|#)[._#-]*0*(\d{1,7})$/i;
// Numéro complété de zéros (« 000123 », « 002301 ») : un téléphone ne commence jamais par 00 sur 6-7 chiffres
const TICKET_PADDED_RE = /^00\d{4,5}$/;

export function extractTicketFromUrl(raw) {
  const m = String(raw ?? '').match(TICKET_URL_RE);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).trim();
  } catch {
    return null;
  }
}

function padTicketCode(n) {
  return `KP-${String(parseInt(n, 10)).padStart(6, '0')}`;
}

/**
 * Forme explicite d'un code ticket → « KP-000123 », sinon null.
 * `allowBareNumber` accepte aussi « 123 » (suivi public, où un téléphone fait ≥ 9 chiffres).
 */
export function normalizeTicketCode(raw, { allowBareNumber = false } = {}) {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  const fromUrl = extractTicketFromUrl(s);
  if (fromUrl) s = fromUrl;
  const compact = s.replace(/\s+/g, '');
  const m = compact.match(TICKET_PREFIXED_RE);
  if (m && parseInt(m[1], 10) > 0) return padTicketCode(m[1]);
  if (TICKET_PADDED_RE.test(compact) && parseInt(compact, 10) > 0) return padTicketCode(compact);
  if (allowBareNumber && /^\d{1,7}$/.test(compact) && parseInt(compact, 10) > 0) return padTicketCode(compact);
  return null;
}

/** Téléphone saisi → chiffres nationaux (« +33 6 12… » → « 0612… »). */
export function normalizePhoneInput(raw) {
  let d = digitsOnly(raw);
  if (d.startsWith('0033')) d = `0${d.slice(4)}`;
  else if (String(raw ?? '').trim().startsWith('+33') && d.startsWith('33')) d = `0${d.slice(2)}`;
  return d;
}

/**
 * URL publique de suivi d'un ticket. Le jeton du lien (`t`, tickets.suivi_token) ouvre le suivi
 * sans rien demander ; sans jeton, le client saisit le téléphone donné au dépôt. Le code reste en
 * fin d'URL : la douchette QWERTY sur un poste AZERTY n'est reconnue que par la fin du texte.
 */
export function lienSuivi(origin, code, token) {
  const base = String(origin ?? '').replace(/\/+$/, '');
  const jeton = token ? `t=${encodeURIComponent(token)}&` : '';
  return `${base}/suivi?${jeton}ticket=${encodeURIComponent(String(code ?? '').trim())}`;
}
