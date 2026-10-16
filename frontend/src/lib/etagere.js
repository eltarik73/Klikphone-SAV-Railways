/**
 * Étagère « À récupérer » du dashboard (GET /api/tickets/stats/dashboard?vue=a_recuperer).
 * jours_attente : jours calendaires depuis la fin de réparation, calculés par le serveur.
 */

// Repli si la réponse ne donne pas delai_abandon_jours (conditions du ticket de dépôt : 3 mois)
export const DELAI_ABANDON_JOURS = 90;
export const SEUILS_ATTENTE = [3, 10, 30];

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

/** « 3 mois » pour 90 jours, sinon « 45 jours ». */
export function formatDelai(jours) {
  const j = Number(jours) || DELAI_ABANDON_JOURS;
  return j % 30 === 0 ? `${j / 30} mois` : `${j} jours`;
}

/** Situation d'un appareil terminé au regard du délai d'abandon. */
export function situationAbandon(jours, delai = DELAI_ABANDON_JOURS) {
  const j = Number(jours);
  if (jours == null || jours === '' || !Number.isFinite(j)) return null;
  const d = Number(delai) || DELAI_ABANDON_JOURS;
  return { atteint: j >= d, restant: Math.max(0, d - j) };
}

/** Sépare la réponse en appareils en boutique (terminés) et rendus non payés, ordre du serveur gardé. */
export function groupesEtagere(tickets) {
  const liste = Array.isArray(tickets) ? tickets : [];
  return {
    enBoutique: liste.filter((t) => t?.statut === 'Réparation terminée'),
    impayes: liste.filter((t) => t?.statut === 'Rendu au client'),
  };
}
