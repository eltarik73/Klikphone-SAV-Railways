/**
 * Message proposé au client après un changement de statut (fiche ticket, scan comptoir).
 * Le serveur décide s'il faut le proposer (paramètre NOTIFICATIONS_STATUTS, champ
 * `proposer_message` de PATCH /statut) ; ici on choisit le modèle à pré-remplir.
 * Rien n'est jamais envoyé sans un clic sur WhatsApp, SMS ou Email.
 */

// Même valeur par défaut que le serveur (api/tickets.py) quand le paramètre est absent
export const NOTIFICATIONS_STATUTS_DEFAUT = 'Réparation terminée';

const sansAccents = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// id des modèles par défaut (MessageComposer, Config > Messages) ; mots du libellé en repli
export const MODELE_PAR_STATUT = {
  'En attente de diagnostic': { id: 2, mots: ['diagnostic'] },
  'En attente de pièce': { id: 5, mots: ['attente', 'piece'] },
  'Pièce reçue': { id: 7, mots: ['arrivee'] },
  "En attente d'accord client": { id: 12, mots: ['accord'] },
  'En cours de réparation': { id: 4, mots: ['en cours'] },
  'Réparation terminée': { id: 6, mots: ['pret'] },
};

// Statuts réglables dans Config > Notifs (ordre du parcours de réparation)
export const STATUTS_MESSAGE = Object.keys(MODELE_PAR_STATUT);

const aUnTexte = (tp) => !!String(tp?.message ?? '').trim();

/** id du modèle à pré-sélectionner pour `statut` parmi `templates`, ou null. */
export function modelePourStatut(templates, statut) {
  const regle = MODELE_PAR_STATUT[statut];
  if (!regle || !Array.isArray(templates)) return null;
  const parId = templates.find((tp) => tp?.id === regle.id && aUnTexte(tp));
  if (parId) return parId.id;
  const parLibelle = templates.find((tp) => aUnTexte(tp) && regle.mots.every((m) => sansAccents(tp.label).includes(m)));
  return parLibelle ? parLibelle.id : null;
}

/** Liste des statuts du paramètre (absent : valeur par défaut du serveur ; vide : aucun). */
export function statutsNotifies(valeur) {
  const v = valeur == null ? NOTIFICATIONS_STATUTS_DEFAUT : String(valeur);
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Nouvelle valeur du paramètre après avoir coché / décoché `statut` (statuts inconnus conservés). */
export function basculerStatutNotifie(valeur, statut, actif) {
  const liste = statutsNotifies(valeur).filter((s) => s !== statut);
  if (actif) liste.push(statut);
  const connus = STATUTS_MESSAGE.filter((s) => liste.includes(s));
  const autres = liste.filter((s) => !STATUTS_MESSAGE.includes(s));
  return [...connus, ...autres].join(',');
}
