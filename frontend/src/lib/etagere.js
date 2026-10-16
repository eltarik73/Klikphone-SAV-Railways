/**
 * Étagère « À récupérer » du dashboard (GET /api/tickets/stats/dashboard?vue=a_recuperer).
 * jours_attente : jours calendaires depuis la fin de réparation, calculés par le serveur,
 * comme emplacement, nb_relances, derniere_relance et relance_due (paliers ETAGERE_RELANCE_PALIERS).
 */

// Repli si ni la vue ni /api/etagere/config ne donnent delai_abandon_jours : loi du
// 31 décembre 1903, un an avant toute vente, et seulement sur autorisation du juge
export const DELAI_ABANDON_JOURS = 365;
export const SEUILS_ATTENTE = [3, 10, 30];
export const RELANCE_PALIERS = [3, 10, 30, 90, 180, 330];
// Courrier de mise en demeure proposé à partir de J+90 (appareils encore en boutique)
export const SEUIL_MISE_EN_DEMEURE = 90;
export const EMPLACEMENT_MAX = 20;

export const ORDRES = [
  { id: 'anciens', label: 'Plus anciens' },
  { id: 'relances', label: 'Relances à faire d’abord' },
  { id: 'emplacement', label: 'Par emplacement' },
];

// Contrastes AA : texte 800/900 sur fond 100
const CLASSES = [
  'bg-slate-100 text-slate-700 ring-slate-200',
  'bg-amber-100 text-amber-900 ring-amber-300',
  'bg-orange-100 text-orange-900 ring-orange-300',
  'bg-red-100 text-red-800 ring-red-300',
];

/** Badge « J+N » : neutre, puis coloré à partir de J+3, J+10 et J+30. null si inconnu. */
export function badgeAttente(jours) {
  const n = Number(jours);
  if (jours == null || jours === '' || !Number.isFinite(n)) return null;
  const j = Math.max(0, Math.floor(n));
  const niveau = SEUILS_ATTENTE.filter((s) => j >= s).length;
  return { label: `J+${j}`, jours: j, niveau, classe: CLASSES[niveau] };
}

/** « 1 an » pour 365 jours, « 2 ans », « 3 mois » pour 90, sinon « 45 jours ». */
export function formatDelai(jours) {
  const j = Math.round(Number(jours)) || DELAI_ABANDON_JOURS;
  if (j % 365 === 0) return j === 365 ? '1 an' : `${j / 365} ans`;
  return j % 30 === 0 ? `${j / 30} mois` : `${j} jours`;
}

/** Situation d'un appareil terminé au regard du délai d'abandon. */
export function situationAbandon(jours, delai = DELAI_ABANDON_JOURS) {
  const j = Number(jours);
  if (jours == null || jours === '' || !Number.isFinite(j)) return null;
  const d = Number(delai) || DELAI_ABANDON_JOURS;
  return { atteint: j >= d, restant: Math.max(0, d - j) };
}

/** Délai d'abandon : celui de la vue, sinon celui de /api/etagere/config, sinon un an. */
export function delaiAbandon(...sources) {
  for (const s of sources) {
    const n = Number(s?.delai_abandon_jours);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return DELAI_ABANDON_JOURS;
}

/** Sépare la réponse en appareils en boutique (terminés) et rendus non payés, ordre du serveur gardé. */
export function groupesEtagere(tickets) {
  const liste = Array.isArray(tickets) ? tickets : [];
  return {
    enBoutique: liste.filter((t) => t?.statut === 'Réparation terminée'),
    impayes: liste.filter((t) => t?.statut === 'Rendu au client'),
  };
}

// ─── Emplacement physique ─────────────────────────────────────────────────────

/** Comme le serveur : espaces rognés, majuscules, 20 caractères ; null si vide. */
export function normaliserEmplacement(valeur) {
  const v = String(valeur ?? '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, EMPLACEMENT_MAX).trim();
  return v || null;
}

/** Emplacements proposés en boutons (paramètre ETAGERE_EMPLACEMENTS), normalisés et sans doublon. */
export function listeEmplacements(config) {
  const brut = Array.isArray(config?.emplacements)
    ? config.emplacements
    : String(config?.emplacements ?? '').split(',');
  const vus = new Set();
  const out = [];
  for (const e of brut) {
    const n = normaliserEmplacement(e);
    if (n && !vus.has(n)) { vus.add(n); out.push(n); }
  }
  return out;
}

const COLLATOR = typeof Intl !== 'undefined' ? new Intl.Collator('fr', { numeric: true, sensitivity: 'base' }) : null;
const comparer = (a, b) => (COLLATOR ? COLLATOR.compare(a, b) : String(a).localeCompare(String(b)));

/** Groupes par emplacement (A2 avant A10), « sans emplacement » en dernier ; ordre du serveur dans chaque groupe. */
export function grouperParEmplacement(tickets) {
  const groupes = new Map();
  for (const t of Array.isArray(tickets) ? tickets : []) {
    const e = normaliserEmplacement(t?.emplacement);
    if (!groupes.has(e)) groupes.set(e, []);
    groupes.get(e).push(t);
  }
  return [...groupes.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : comparer(a, b)))
    .map(([emplacement, liste]) => ({ emplacement, tickets: liste }));
}

// ─── Recherche, tri ───────────────────────────────────────────────────────────

const sansAccent = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Recherche locale : emplacement, n° de ticket, client, appareil, téléphone. */
export function filtrerEtagere(tickets, recherche) {
  const liste = Array.isArray(tickets) ? tickets : [];
  const mots = sansAccent(recherche).split(/\s+/).filter(Boolean);
  if (!mots.length) return liste;
  return liste.filter((t) => {
    const tel = String(t?.client_tel ?? '').replace(/\D/g, '');
    const texte = sansAccent([
      t?.emplacement, t?.ticket_code, t?.id != null ? `#${t.id}` : '', t?.client_prenom, t?.client_nom,
      t?.client_societe, t?.marque, t?.modele, t?.modele_autre, t?.categorie,
    ].filter(Boolean).join(' '));
    return mots.every((m) => texte.includes(m) || (/^\d{3,}$/.test(m) && tel.includes(m)));
  });
}

/** Relances à faire d'abord (ordre du serveur gardé dans chaque moitié), sinon ordre du serveur. */
export function trierEtagere(tickets, ordre) {
  const liste = Array.isArray(tickets) ? tickets : [];
  if (ordre !== 'relances') return liste;
  return [...liste.filter((t) => t?.relance_due), ...liste.filter((t) => !t?.relance_due)];
}

export function compterRelancesDues(tickets) {
  return (Array.isArray(tickets) ? tickets : []).filter((t) => t?.relance_due).length;
}

// ─── Relances ─────────────────────────────────────────────────────────────────

/**
 * Ligne mise à jour après une relance tracée : réponse de POST /api/etagere/{id}/relance
 * ({ nb_relances, derniere_relance }), ou rien (SMS envoyé par le serveur, déjà noté) :
 * le compteur avance d'un et la date devient maintenant.
 */
export function appliquerRelance(ticket, reponse, maintenant = new Date()) {
  const nb = Number(reponse?.nb_relances);
  return {
    ...ticket,
    nb_relances: Number.isFinite(nb) ? nb : (Number(ticket?.nb_relances) || 0) + 1,
    derniere_relance: reponse?.derniere_relance || maintenant.toISOString(),
    relance_due: false,
  };
}

/** « Aucune relance », « 1 relance le 12/10/2026 », « 3 relances, dernière le 12/10/2026 ». null si inconnu. */
export function libelleRelances(nb, derniere, formatDate) {
  if (nb == null || nb === '') return null;
  const n = Math.max(0, Math.floor(Number(nb) || 0));
  if (n === 0) return 'Aucune relance';
  const date = derniere ? formatDate(derniere) : null;
  if (n === 1) return date ? `1 relance le ${date}` : '1 relance';
  return date ? `${n} relances, dernière le ${date}` : `${n} relances`;
}

/** Courrier proposé pour un appareil en boutique à partir de J+90 (mise_en_demeure_jours de la config). */
export function miseEnDemeureProposee(ticket, seuil = SEUIL_MISE_EN_DEMEURE) {
  const j = Number(ticket?.jours_attente);
  const s = Number(seuil) > 0 ? Number(seuil) : SEUIL_MISE_EN_DEMEURE;
  return ticket?.statut === 'Réparation terminée' && Number.isFinite(j) && j >= s;
}

/** Texte de secours si GET /api/etagere/{id}/message-relance ne répond pas. */
export function messageRelanceSecours(ticket) {
  const prenom = String(ticket?.client_prenom || '').trim();
  const modele = ticket?.modele && ticket.modele !== 'Autre' ? ticket.modele : ticket?.modele_autre;
  const appareil = [ticket?.marque, modele].filter((v) => String(v ?? '').trim()).join(' ') || 'appareil';
  const j = Number(ticket?.jours_attente);
  const depuis = Number.isFinite(j) && j > 0 ? ` depuis ${j} jour${j > 1 ? 's' : ''}` : '';
  return `Bonjour${prenom ? ` ${prenom}` : ''}, votre ${appareil} est réparé et vous attend chez Klikphone${depuis}. `
    + 'Merci de passer le récupérer : 79 Place Saint-Léger, Chambéry, du lundi au samedi de 10h à 19h. '
    + 'Klikphone 04 79 60 89 22';
}

/** Contenu tracé avec la relance (court : l'historique ne garde pas tout le message). */
export function contenuRelance(message, jours, max = 200) {
  const t = String(message ?? '').replace(/\s+/g, ' ').trim();
  const court = t.length > max ? `${t.slice(0, max - 1)}…` : t;
  const j = Number(jours);
  return `${Number.isFinite(j) ? `[Relance J+${Math.max(0, Math.floor(j))}] ` : '[Relance] '}${court}`;
}
