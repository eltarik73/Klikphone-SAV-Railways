/**
 * SMS clients : envoi par le serveur (Brevo) quand il est activé, sinon lien sms:
 * qui ouvre l'app Messages du poste. Estimation du nombre de SMS facturés
 * (miroir de backend/app/services/sms.py : normaliser_texte, segments).
 */
import api from './api';
import { smsLink } from './utils';

// Ponctuation typographique ramenée à l'ASCII : un seul « ’ » ferait passer le SMS en Unicode
const TYPO = {
  '’': "'", '‘': "'", 'ʼ': "'", '“': '"', '”': '"', '«': '"', '»': '"',
  '–': '-', '—': '-', '‑': '-', '…': '...',
  ' ': ' ', ' ': ' ', ' ': ' ', '\r': '',
};
const TYPO_RE = new RegExp(`[${Object.keys(TYPO).join('')}]`, 'g');

// Alphabet GSM 03.38 : jeu de base (1 caractère) et extension (2 caractères)
const GSM_BASE = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?'
  + '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
);
const GSM_EXT = new Set('^{}\\[~]|€\f');

export function normaliserSms(texte) {
  return String(texte ?? '').replace(TYPO_RE, (c) => TYPO[c]).trim();
}

export function estGsm(texte) {
  for (const c of texte) if (!GSM_BASE.has(c) && !GSM_EXT.has(c)) return false;
  return true;
}

const TEL_BOUTIQUE = '04 79 60 89 22';

// Lettres hors alphabet GSM : une seule suffit à facturer le SMS en Unicode (70 caractères au lieu de 160)
const LETTRES_GSM = {
  'â': 'a', 'ê': 'e', 'ë': 'e', 'î': 'i', 'ï': 'i', 'ô': 'o', 'û': 'u', 'ç': 'c', 'œ': 'oe',
  'á': 'a', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ÿ': 'y',
  'Â': 'A', 'Ê': 'E', 'Ë': 'E', 'Î': 'I', 'Ï': 'I', 'Ô': 'O', 'Û': 'U', 'Œ': 'OE',
  'À': 'A', 'È': 'E', 'Ù': 'U', 'Ì': 'I', 'Ò': 'O',
};

// Lien de suivi (…/suivi?…) jusqu'à la fin de sa phrase, sans avaler la phrase suivante
const PHRASE_LIEN_SUIVI = /[^.!?\n]*https?:\/\/\S*?\/suivi\S*?(?=[.!?,;:]?(?:\s|$))[.!?]?/gi;

/**
 * Version facturée au plus juste d'un message client envoyé par SMS : sans lien de suivi
 * (adresse trop longue, inutile par SMS), en alphabet GSM, sans emoji ni lignes vides.
 * Une demande d'accord perd son lien : on renvoie vers le téléphone de la boutique,
 * un SMS venant de « KLIKPHONE » ne pouvant pas recevoir de réponse.
 */
export function versionCourteSms(texte) {
  let t = normaliserSms(texte);
  let accordRetire = false;
  t = t.replace(PHRASE_LIEN_SUIVI, (phrase) => {
    if (/accord|accepter|refuser|valider/i.test(phrase)) accordRetire = true;
    return '';
  });
  t = t.replace(/[^\n]*Suivez votre r[ée]paration[^\n]*/gi, '');
  t = [...t].map((c) => LETTRES_GSM[c] ?? c).filter((c) => GSM_BASE.has(c) || GSM_EXT.has(c)).join('');
  t = t.replace(/\s*\n\s*/g, ' ').replace(/ {2,}/g, ' ').replace(/ +([.,!?])/g, '$1').trim();
  if (accordRetire && !t.includes(TEL_BOUTIQUE)) t = `${t} Merci de nous donner votre accord au ${TEL_BOUTIQUE}.`;
  return t;
}

// { segments, unicode, caracteres } du texte tel que le serveur l'enverra
export function smsSegments(texte) {
  const t = normaliserSms(texte);
  if (!t) return { segments: 0, unicode: false, caracteres: 0 };
  if (estGsm(t)) {
    let n = 0;
    for (const c of t) n += GSM_EXT.has(c) ? 2 : 1;
    return { segments: n <= 160 ? 1 : Math.ceil(n / 153), unicode: false, caracteres: n };
  }
  // UCS-2 : length JS = unités UTF-16, un emoji compte pour deux
  const n = t.length;
  return { segments: n <= 70 ? 1 : Math.ceil(n / 67), unicode: true, caracteres: n };
}

// Toast après un envoi serveur : « SMS envoyé au 06 12 34 56 78 (2 SMS) »
export function messageSmsEnvoye(res) {
  const n = Number(res?.segments) || 0;
  return `SMS envoyé${res?.destinataire ? ` au ${res.destinataire}` : ''}${n > 1 ? ` (${n} SMS)` : ''}`;
}

/**
 * Envoie le SMS au client du ticket.
 * - `serveur` (envoi Brevo activé) et `ticketId` : POST /api/notifications/sms
 *   → { mode: 'serveur', segments, destinataire }. Une erreur lisible est levée en cas de refus
 *   (doublon, numéro fixe, crédits épuisés…) ; le serveur a déjà noté l'échec sur le ticket.
 * - sinon, ou si le serveur répond « sms_non_configure » : ouvre le lien sms: → { mode: 'lien' }.
 *   Sans envoi serveur, window.open part avant tout await (dans le geste de l'utilisateur).
 */
export async function envoyerSms({ serveur, ticketId, tel, message, libelle }) {
  if (!serveur || !ticketId) {
    window.open(smsLink(String(tel || ''), message), '_blank');
    return { mode: 'lien' };
  }
  try {
    const res = await api.envoyerSms(ticketId, message, libelle);
    return { mode: 'serveur', ...res };
  } catch (err) {
    if (err?.code !== 'sms_non_configure') throw err;
    api.getSmsEtat({ fresh: true }).catch(() => {});
    window.open(err.detail?.link || smsLink(String(tel || ''), message), '_blank');
    return { mode: 'lien', repli: true };
  }
}
