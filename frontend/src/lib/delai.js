/**
 * Délai de réparation promis au client (tickets.date_recuperation).
 *
 * date_recuperation est du TEXTE libre côté serveur (jamais de ::date) : les écrans y écrivent le
 * format datetime-local « AAAA-MM-JJTHH:MM » (heure locale), mais d'anciens tickets portent
 * « 2026-10-15 14:30:00 », « 15/10/2026 », voire « Jeudi 17h ». Tout ce qui n'est pas datable
 * reste affiché tel quel (état 'texte').
 *
 * infoDelai(valeur, maintenant) → { etat, libelle, titre, date } est la seule source des pastilles
 * (tableau de bord, file atelier, fiche, panneau de scan) :
 *   'aucun'   → « Délai à fixer » (dépôt à la borne, anciens tickets)
 *   'ok'      → « 15:30 · dans 1 h 20 », « demain 11:00 », « mar. 21/10 14:00 »
 *   'bientot' → moins de 30 min
 *   'retard'  → « En retard de 25 min »
 *   'texte'   → l'ancien texte libre
 */

export const SEUIL_BIENTOT_MS = 30 * 60 * 1000;

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const JOURS_COURTS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

const deux = (n) => String(n).padStart(2, '0');

/** « 15:30 » (heure locale). */
export const heureMinute = (d) => `${deux(d.getHours())}:${deux(d.getMinutes())}`;

/** « 21/10 » */
const jourMois = (d) => `${deux(d.getDate())}/${deux(d.getMonth() + 1)}`;

/** « 21/10 14:00 » */
export const dateHeureCourte = (d) => `${jourMois(d)} ${heureMinute(d)}`;

/** Valeur enregistrée : « AAAA-MM-JJTHH:MM », heure locale (format des champs datetime-local). */
export function valeurDelai(d) {
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}T${heureMinute(d)}`;
}

// Date locale construite à partir de ses composants, null si elle « déborde » (31/02…)
function dateLocale(an, mois, jour, h = 0, min = 0, s = 0) {
  const d = new Date(an, mois - 1, jour, h, min, s, 0);
  if (d.getFullYear() !== an || d.getMonth() !== mois - 1 || d.getDate() !== jour) return null;
  if (h > 23 || min > 59 || s > 59) return null;
  return d;
}

// Heure retenue pour une date sans heure : la fermeture de la boutique (19:00)
const HEURE_PAR_DEFAUT = 19;

const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
const RE_FR = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(?:à\s+)?(\d{1,2})[h:](\d{2})?)?$/i;

/** Date d'une valeur datable (ISO, « AAAA-MM-JJ HH:MM:SS », « JJ/MM/AAAA [HHhMM] »), sinon null. */
export function dateDelai(valeur) {
  if (valeur instanceof Date) return Number.isNaN(valeur.getTime()) ? null : valeur;
  const s = typeof valeur === 'string' ? valeur.trim() : '';
  if (!s) return null;
  let m = RE_ISO.exec(s);
  if (m) {
    if (m[7]) {
      // Fuseau explicite (« …Z », « …+02:00 ») : le moteur sait faire
      const d = new Date(s.replace(' ', 'T'));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const [an, mois, jour] = [m[1], m[2], m[3]].map(Number);
    if (m[4] === undefined) return dateLocale(an, mois, jour, HEURE_PAR_DEFAUT);
    return dateLocale(an, mois, jour, Number(m[4]), Number(m[5]), Number(m[6] || 0));
  }
  m = RE_FR.exec(s);
  if (m) {
    const h = m[4] === undefined ? HEURE_PAR_DEFAUT : Number(m[4]);
    return dateLocale(Number(m[3]), Number(m[2]), Number(m[1]), h, Number(m[5] || 0));
  }
  return null;
}

// Écart en jours calendaires (0 = même jour, 1 = demain, -1 = hier)
function ecartJours(d, maintenant) {
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate());
  return Math.round((a - b) / 86_400_000);
}

/** Durée lisible, arrondie à la minute supérieure : « 25 min », « 1 h 20 », « 2 h », « 1 j 3 h », « 4 j ». */
export function dureeCourte(ms) {
  const minutes = Math.max(1, Math.ceil(Math.abs(ms) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const r = minutes % 60;
  if (h < 24) return r ? `${h} h ${deux(r)}` : `${h} h`;
  const j = Math.floor(h / 24);
  const hr = h % 24;
  return hr && j < 3 ? `${j} j ${hr} h` : `${j} j`;
}

/** Échéance en clair : « 15:30 aujourd'hui », « demain à 11:00 », « mardi 21/10 à 14:00 ». */
export function libelleEcheance(d, maintenant = new Date()) {
  const ecart = ecartJours(d, maintenant);
  if (ecart === 0) return `${heureMinute(d)} aujourd'hui`;
  if (ecart === 1) return `demain à ${heureMinute(d)}`;
  if (ecart === -1) return `hier à ${heureMinute(d)}`;
  return `${JOURS[d.getDay()]} ${jourMois(d)} à ${heureMinute(d)}`;
}

/** Phrase affichée sous les puces et au récapitulatif : « Prêt vers 15:30 aujourd'hui », « Prêt demain à 11:00 ». */
export function phrasePret(d, maintenant = new Date()) {
  return ecartJours(d, maintenant) === 0
    ? `Prêt vers ${heureMinute(d)} aujourd'hui`
    : `Prêt ${libelleEcheance(d, maintenant)}`;
}

/**
 * État du délai d'un ticket. `valeur` = date_recuperation (texte libre, Date ou vide).
 * Jamais d'exception : une valeur inattendue est rendue telle quelle (état 'texte').
 */
export function infoDelai(valeur, maintenant = new Date()) {
  const brut = valeur instanceof Date
    ? (Number.isNaN(valeur.getTime()) ? '' : valeur)
    : (valeur == null ? '' : String(valeur).trim());
  if (!brut) {
    return { etat: 'aucun', libelle: 'Délai à fixer', titre: 'Aucun délai de réparation fixé', date: null };
  }
  const d = dateDelai(brut);
  if (!d) return { etat: 'texte', libelle: brut, titre: `Récupération prévue : ${brut}`, date: null };
  const ecart = d.getTime() - maintenant.getTime();
  if (ecart < 0) {
    const duree = dureeCourte(ecart);
    return {
      etat: 'retard',
      libelle: `En retard de ${duree}`,
      titre: `Prévu ${libelleEcheance(d, maintenant)} : en retard de ${duree}`,
      date: d,
    };
  }
  const jours = ecartJours(d, maintenant);
  const heure = heureMinute(d);
  const libelle = jours === 0
    ? `${heure} · dans ${dureeCourte(ecart)}`
    : jours === 1 ? `demain ${heure}` : `${JOURS_COURTS[d.getDay()]} ${jourMois(d)} ${heure}`;
  return {
    etat: ecart < SEUIL_BIENTOT_MS ? 'bientot' : 'ok',
    libelle,
    titre: `${phrasePret(d, maintenant)} (dans ${dureeCourte(ecart)})`,
    date: d,
  };
}

// Statuts où le délai n'a plus d'objet : l'appareil est réparé ou rendu
export const STATUTS_SANS_DELAI = new Set(['Réparation terminée', 'Rendu au client', 'Clôturé']);

/**
 * Pastille à afficher pour un ticket, ou null : rien une fois la réparation terminée ; un ticket
 * sans délai n'est « à fixer » que s'il s'agit d'une réparation présente en boutique (pas un achat,
 * une commande de pièce ni un dépôt à distance pas encore arrivé).
 */
export function delaiTicket(t, maintenant = new Date()) {
  if (!t || STATUTS_SANS_DELAI.has(t.statut)) return null;
  const info = infoDelai(t.date_recuperation, maintenant);
  if (info.etat !== 'aucun') return info;
  // La file atelier ne renvoie pas la catégorie : une commande de pièce s'y reconnaît sans marque
  const commande = t.categorie === 'Commande'
    || (t.categorie === undefined && !t.marque && t.panne === 'Pièce à commander');
  if (t.statut === 'Pré-enregistré' || t.categorie === 'Achat' || commande) return null;
  return info;
}

/** Clé de tri « Récupération » : instant promis (ms), les valeurs non datables en dernier. */
export function instantDelai(valeur) {
  const d = dateDelai(valeur);
  return d ? d.getTime() : Number.POSITIVE_INFINITY;
}
