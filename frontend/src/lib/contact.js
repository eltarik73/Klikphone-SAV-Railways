/**
 * Où joindre le client d'un ticket.
 *
 * Deux numéros peuvent exister : celui de la fiche client (clients.telephone, l'identifiant du
 * client — souvent l'appareil déposé) et tickets.tel_contact, le « numéro pour vous joindre si
 * différent » saisi au dépôt (« si votre téléphone reste chez nous »). Tout message au client
 * part vers tel_contact s'il est renseigné, sinon vers le téléphone de la fiche — même règle que
 * le serveur (POST /api/notifications/sms). Les liens sms:/wa.me/tel: et les libellés
 * « SMS au 06… » des écrans passent par ici, jamais par t.client_tel directement.
 */
const texte = (v) => String(v ?? '').trim();
const chiffres = (v) => texte(v).replace(/\D/g, '');

/** Téléphone de la fiche client (ligne de dashboard, ticket complet ou objet client imbriqué). */
export function telFiche(t) {
  return texte(t?.client_tel) || texte(t?.client?.telephone) || texte(t?.telephone);
}

/** Numéro où joindre le client : le second numéro du ticket s'il existe, sinon celui de la fiche. */
export function telJoignable(t) {
  return texte(t?.tel_contact) || telFiche(t);
}

/** Vrai quand le client se joint sur un autre numéro que celui de sa fiche. */
export function estAutreNumero(t) {
  const contact = texte(t?.tel_contact);
  return !!contact && chiffres(contact) !== chiffres(telFiche(t));
}

/** « 06 12 34 56 78 » pour un numéro français à 10 chiffres, sinon la valeur telle quelle. */
export function formatTel(tel) {
  const s = texte(tel);
  const d = s.replace(/\D/g, '');
  if (d.length === 10 && !s.startsWith('+')) return d.replace(/(\d{2})(?=\d)/g, '$1 ');
  return s;
}

/** « 06 12 34 56 78 », suivi de « (autre numéro) » quand c'est le second numéro ; '' sans numéro. */
export function libelleJoignable(t) {
  const tel = telJoignable(t);
  if (!tel) return '';
  return `${formatTel(tel)}${estAutreNumero(t) ? ' (autre numéro)' : ''}`;
}

/**
 * Le ticket avec client_tel remplacé par le numéro joignable : pour les aides qui lisent
 * t.client_tel (canalPrevenir, raisonSansCanal, messagePret…) sans les dupliquer.
 */
export function avecTelJoignable(t) {
  if (!t) return t;
  const tel = telJoignable(t);
  return tel === texte(t.client_tel) ? t : { ...t, client_tel: tel };
}

// ─── Client contacté (tickets.contact, calculé par le serveur) ────────────────
//
// contact = { depuis_statut: bool, dernier: { canal, date, auteur } | null,
//             canaux: { sms, email, whatsapp, appel } } — dates ISO du dernier contact de chaque
// canal DEPUIS LE DERNIER CHANGEMENT DE STATUT (une seule vérité : dashboard, scan, étagère, fiche).

export const CANAUX_CONTACT = ['sms', 'email', 'whatsapp', 'appel'];
const LIBELLES_CANAL = { sms: 'SMS', email: 'e-mail', whatsapp: 'WhatsApp', appel: 'téléphone' };
const VERBES_CANAL = { sms: 'SMS envoyé', email: 'E-mail envoyé', whatsapp: 'WhatsApp envoyé', appel: 'Appel passé' };
const NOMS_CANAL = { sms: 'SMS', email: 'e-mail', whatsapp: 'WhatsApp', appel: 'appel' };

/** « SMS », « e-mail », « WhatsApp », « téléphone » (après « Contacté par … »). */
export function canalLibelle(canal) {
  return LIBELLES_CANAL[canal] || texte(canal);
}

// Horodatage naïf du serveur = UTC (comme parseUTC de lib/utils)
function dateContact(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = texte(v);
  if (!s) return null;
  const d = new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** « 17/10 à 14:32 » (heure locale), '' si la date est absente ou invalide. */
export function formatDateHeure(v) {
  const d = dateContact(v);
  if (!d) return '';
  const jour = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${jour} à ${heure}`;
}

/** Contact normalisé : toujours les 4 canaux, dernier null si rien depuis le dernier statut. */
export function normaliserContact(contact) {
  const src = contact && typeof contact === 'object' ? contact : {};
  const canaux = {};
  for (const c of CANAUX_CONTACT) canaux[c] = src.canaux?.[c] || null;
  let dernier = src.dernier && src.dernier.canal && src.dernier.date
    ? { canal: src.dernier.canal, date: src.dernier.date, auteur: src.dernier.auteur || null }
    : null;
  if (!dernier) {
    // Sans « dernier » (ligne mise à jour localement) : le canal le plus récent
    for (const c of CANAUX_CONTACT) {
      const d = dateContact(canaux[c]);
      if (d && (!dernier || d > dateContact(dernier.date))) dernier = { canal: c, date: canaux[c], auteur: null };
    }
  }
  return { depuis_statut: CANAUX_CONTACT.some((c) => !!canaux[c]), dernier, canaux };
}

/** « Contacté par SMS le 17/10 à 14:32 », sinon « Pas encore contacté ». */
export function libelleContact(contact) {
  const c = normaliserContact(contact);
  if (!c.dernier) return 'Pas encore contacté';
  const quand = formatDateHeure(c.dernier.date);
  return `Contacté par ${canalLibelle(c.dernier.canal)}${quand ? ` le ${quand}` : ''}`;
}

/**
 * Info-bulle d'une icône de canal : « SMS envoyé le 17/10 à 14:32 par Léa » (l'auteur n'est connu
 * que pour le dernier contact), sinon « Pas de SMS depuis le dernier changement de statut ».
 */
export function titreCanal(contact, canal) {
  const c = normaliserContact(contact);
  const date = c.canaux[canal];
  if (!date) return `Pas d${canal === 'appel' || canal === 'email' ? "'" : 'e '}${NOMS_CANAL[canal] || canalLibelle(canal)} depuis le dernier changement de statut`;
  const quand = formatDateHeure(date);
  const auteur = c.dernier?.canal === canal && c.dernier.date === date ? texte(c.dernier.auteur) : '';
  return `${VERBES_CANAL[canal] || canalLibelle(canal)}${quand ? ` le ${quand}` : ''}${auteur ? ` par ${auteur}` : ''}`;
}

/** Contact après un envoi ou un appel noté localement (sans relire le serveur). */
export function appliquerContact(contact, canal, date = new Date().toISOString(), auteur = null) {
  const c = normaliserContact(contact);
  if (!CANAUX_CONTACT.includes(canal)) return c;
  const canaux = { ...c.canaux, [canal]: date };
  return { depuis_statut: true, dernier: { canal, date, auteur: auteur || null }, canaux };
}
