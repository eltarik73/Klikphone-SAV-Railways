/**
 * Catalogue marques / modèles : fonctions pures (recherche, regroupement, règles de saisie).
 * Les modèles sont au format de /api/catalog/tree : [{ m: 'iPhone 15 Pro', a: 2023 }, ...]
 */

// Catégories sans étape « modèle » obligatoire (commande de pièce, achat, divers)
export const CATEGORIES_SANS_MODELE = ['Commande', 'Autre', 'Achat'];

export const MARQUE_AUTRE = 'Autre';

export function modeleRequis(categorie) {
  return !!categorie && !CATEGORIES_SANS_MODELE.includes(categorie);
}

/**
 * Clé de comparaison : sans accents, minuscules, « + » → « plus »,
 * tout caractère non alphanumérique remplacé par un espace (espaces fusionnés).
 */
export function normKey(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const labelOf = (item) => (typeof item === 'string' ? item : item?.m ?? '');

const compact = (key) => key.replace(/ /g, '');

// Chaque mot de la requête est le début du mot de même rang (la chaîne « commence par » la requête)
function startsWithWords(words, qWords) {
  if (qWords.length > words.length) return false;
  return qWords.every((qw, i) => words[i].startsWith(qw));
}

// Égalité avec le modèle seul ou « marque + modèle », espaces compris ou non (« iphone13 »)
function egalite(qKey, qCompact, key, full) {
  return qKey === key || qKey === full || qCompact === compact(key) || qCompact === compact(full);
}

/** Modèle du catalogue identique à la saisie (même règle que le rang 0 de searchModeles), sinon null. */
export function trouverExact(modeles, marque, q) {
  const qKey = normKey(q);
  if (!qKey) return null;
  const qCompact = compact(qKey);
  const marqueKey = normKey(marque);
  for (const item of Array.isArray(modeles) ? modeles : []) {
    const key = normKey(labelOf(item));
    if (key && egalite(qKey, qCompact, key, marqueKey ? `${marqueKey} ${key}` : key)) return item;
  }
  return null;
}

/**
 * Filtre et classe les modèles d'une marque pour une requête libre.
 * Correspondance : chaque mot de la requête commence un mot de « marque + modèle »,
 * ou la requête sans espaces est contenue dans « marque + modèle » sans espaces (« s24u »).
 * Classement : égalité exacte > préfixe > contient (mots, puis caractères),
 * puis le libellé le plus court, puis l'ordre d'origine (récence).
 */
export function searchModeles(modeles, marque, q, limit = 60) {
  const list = Array.isArray(modeles) ? modeles : [];
  const qKey = normKey(q);
  if (!qKey) return list.slice(0, limit);

  const qWords = qKey.split(' ');
  const qCompact = compact(qKey);
  const marqueKey = normKey(marque);

  const scored = [];
  list.forEach((item, index) => {
    const key = normKey(labelOf(item));
    if (!key) return;
    const full = marqueKey ? `${marqueKey} ${key}` : key;
    const words = key.split(' ');
    const fullWords = full.split(' ');
    const keyCompact = compact(key);
    const fullCompact = compact(full);

    const wordMatch = qWords.every((qw) => fullWords.some((w) => w.startsWith(qw)));
    if (!wordMatch && !fullCompact.includes(qCompact)) return;

    let rank;
    if (egalite(qKey, qCompact, key, full)) rank = 0;
    else if (startsWithWords(words, qWords) || startsWithWords(fullWords, qWords)
      || keyCompact.startsWith(qCompact) || fullCompact.startsWith(qCompact)) rank = 1;
    else if (wordMatch) rank = 2;
    else rank = 3;

    scored.push({ item, index, rank, len: key.length });
  });

  scored.sort((x, y) => (x.rank - y.rank) || (x.len - y.len) || (x.index - y.index));
  return scored.slice(0, limit).map((s) => s.item);
}

/**
 * Regroupe une liste déjà triée par année décroissante : [{ annee, items }].
 * Les modèles sans année forment le dernier groupe (annee = null).
 */
export function groupByAnnee(modeles) {
  const groups = new Map();
  for (const item of Array.isArray(modeles) ? modeles : []) {
    const a = typeof item === 'object' && item !== null && Number.isFinite(item.a) ? item.a : null;
    if (!groups.has(a)) groups.set(a, []);
    groups.get(a).push(item);
  }
  const out = [...groups.entries()].map(([annee, items]) => ({ annee, items }));
  const sansAnnee = out.findIndex((g) => g.annee === null);
  if (sansAnnee >= 0 && sansAnnee !== out.length - 1) out.push(out.splice(sansAnnee, 1)[0]);
  return out;
}

export function estDansCatalogue(modeles, texte) {
  const key = normKey(texte);
  if (!key) return false;
  return (Array.isArray(modeles) ? modeles : []).some((item) => normKey(labelOf(item)) === key);
}

/**
 * Champs modele / modele_autre à envoyer au backend.
 * Marque « Autre » : le texte va dans modele_autre ; sinon dans modele (catalogue ou saisie libre).
 */
export function champsModele(marque, modele, modeleAutre) {
  if (marque === MARQUE_AUTRE) return { modele: '', modele_autre: String(modeleAutre ?? '').trim() };
  return { modele: String(modele ?? '').trim(), modele_autre: '' };
}

/** true si le formulaire de dépôt n'a pas encore de modèle alors qu'il en faut un. */
export function modeleManquant({ categorie, marque, modele, modele_autre }) {
  if (marque === MARQUE_AUTRE) return !String(modele_autre ?? '').trim();
  if (!modeleRequis(categorie)) return false;
  return !String(modele ?? '').trim();
}

/** Retire un éventuel préfixe de marque (« Samsung Galaxy S24 » → « Galaxy S24 »). */
export function sansPrefixeMarque(marque, modele) {
  const texte = String(modele ?? '').replace(/\s+/g, ' ').trim();
  const m = String(marque ?? '').trim();
  if (m && texte.toLowerCase().startsWith(`${m.toLowerCase()} `)) return texte.slice(m.length).trim();
  return texte;
}

/**
 * Découpe la saisie « ajout en masse » : une ligne = un modèle.
 * Retire lignes vides, doublons, « Autre » et préfixe de marque ; signale les lignes trop longues.
 */
export function parseModelesEnMasse(texte, marque = '', maxLen = 80) {
  const seen = new Set();
  const modeles = [];
  const tropLongs = [];
  for (const raw of String(texte ?? '').split(/\r?\n/)) {
    const line = sansPrefixeMarque(marque, raw);
    if (!line) continue;
    if (line.length > maxLen) { tropLongs.push(line); continue; }
    const key = normKey(line);
    if (!key || key === 'autre' || seen.has(key)) continue;
    seen.add(key);
    modeles.push(line);
  }
  return { modeles, tropLongs };
}
