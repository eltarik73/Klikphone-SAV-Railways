/**
 * Symptôme (tickets.panne, choisi par le client) → prestation (libellé de la ligne facturée).
 *
 * La table vient de GET /api/catalog/prestations (backend/app/services/prestations.py, source
 * unique). Les règles ci-dessous en sont le miroir exact : correspondance après normalisation
 * (accents, casse, ponctuation), jamais par sous-chaîne ; le forfait ne s'applique qu'à la
 * ligne par défaut d'un ticket sans lignes JSON ; une ligne enregistrée n'est jamais réécrite.
 */
import api from './api';

const CHEMIN = '/api/catalog/prestations';
const TTL = 10 * 60_000;

// Miroir de FORFAITS_DEPUIS (prestations.py) : un document déjà remis avant cette date
// (rendu, clôturé, facturé ou payé) garde le symptôme brut pour ne pas changer à la réimpression.
export const FORFAITS_DEPUIS = '2026-10-15';
const STATUTS_EMIS = new Set(['Rendu au client', 'Clôturé']);
const AUTRE_MAX = 35;
const PIECE_MAX = 60;

export function normaliser(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function uneLigne(texte) {
  return String(texte ?? '').split(/\s+/).filter(Boolean).join(' ');
}

function tronquer(texte, n) {
  if (texte.length <= n) return texte;
  const debut = texte.slice(0, n - 3);
  const i = debut.lastIndexOf(' ');
  const coupe = (i >= 0 ? debut.slice(0, i) : debut) || debut;
  return coupe.replace(/[ ,;:-]+$/, '') + '...';
}

/** Index de recherche construit à partir de la réponse de /api/catalog/prestations. */
export function construireCatalogue(data) {
  if (!data || !Array.isArray(data.prestations)) return null;
  const parCle = {};
  const index = new Map();
  for (const p of data.prestations) {
    if (!p || !p.cle) continue;
    parCle[p.cle] = { prestation: p.prestation, court: p.court, symptome: p.symptome ?? null };
    for (const v of [p.symptome, p.prestation, p.court, ...(Array.isArray(p.alias) ? p.alias : [])]) {
      if (!v) continue;
      const n = normaliser(v);
      if (!index.has(n)) index.set(n, p.cle);
    }
  }
  return {
    pannes: Array.isArray(data.pannes) ? data.pannes : [],
    prestations: data.prestations.filter(p => p && p.cle),
    parCle,
    index,
  };
}

let _catalogue = null;
let _chargeLe = 0;
let _chargement = null;

/** Charge (une fois, cache 10 min) la table ; ne rejette jamais : null si indisponible. */
export function chargerPrestations() {
  if (_catalogue && Date.now() - _chargeLe < TTL) return Promise.resolve(_catalogue);
  if (!_chargement) {
    _chargement = api.getCached(CHEMIN, TTL)
      .then((data) => {
        const cat = construireCatalogue(data);
        if (cat) { _catalogue = cat; _chargeLe = Date.now(); }
        return _catalogue;
      })
      .catch(() => _catalogue)
      .finally(() => { _chargement = null; });
  }
  return _chargement;
}

export function cataloguePrestations() {
  return _catalogue;
}

/** Tests : remplace la table en mémoire (null pour la vider). */
export function definirCatalogue(data) {
  _catalogue = data ? construireCatalogue(data) : null;
  _chargeLe = _catalogue ? Date.now() : 0;
  return _catalogue;
}

export function clePanne(texte, cat = _catalogue) {
  if (!cat) return null;
  return cat.index.get(normaliser(texte)) ?? null;
}

/** Libellé de la ligne par défaut, dérivé du symptôme. */
export function libellePrestation(panne, panneDetail = '', cat = _catalogue) {
  const cle = clePanne(panne, cat);
  if (cle) return cat.parCle[cle].prestation;
  const n = normaliser(panne);
  if (n === 'autre') {
    const d = uneLigne(panneDetail);
    return d ? `Réparation - ${tronquer(d, AUTRE_MAX)}` : 'Réparation';
  }
  if (n === 'piece a commander') {
    // panne_detail = « nom de la pièce — notes internes » : seule la pièce sort
    const nom = uneLigne(String(panneDetail ?? '').split(/\s*[—–]\s*/)[0]);
    return nom ? tronquer(nom, PIECE_MAX) : 'Pièce à commander';
  }
  return uneLigne(panne) || 'Réparation';
}

/** Libellé court (listes, désignation des commandes de pièces). */
export function libelleCourt(label, cat = _catalogue) {
  const cle = clePanne(label, cat);
  return cle ? cat.parCle[cle].court : uneLigne(label);
}

/** Même élément : libellés identiques ou même clé de prestation (« Batterie » ≡ « Forfait remplacement batterie »). */
export function memeElement(a, b, cat = _catalogue) {
  const la = uneLigne(a);
  if (!la) return false;
  if (la === uneLigne(b)) return true;
  const ka = clePanne(a, cat);
  return !!ka && ka === clePanne(b, cat);
}

export function prixNombre(v) {
  if (v === null || v === undefined || typeof v === 'boolean') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v).trim().replace(/[\s €]/g, '').replace(',', '.');
  if (!s) return 0;
  const f = Number(s);
  return Number.isFinite(f) ? f : 0;
}

export function documentEmis(t) {
  return STATUTS_EMIS.has(t?.statut)
    || String(t?.type_document || '').trim().toLowerCase() === 'facture'
    || !!t?.paye;
}

/** La ligne legacy reçoit-elle le forfait ? (cf. FORFAITS_DEPUIS) */
export function forfaitApplicable(t) {
  if (!documentEmis(t)) return true;
  const depot = String(t?.date_depot || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(depot) && depot >= FORFAITS_DEPUIS;
}

function lignesJson(brut, cat) {
  let data;
  try { data = JSON.parse(brut); } catch { return null; }
  if (!Array.isArray(data)) return null;
  const lignes = [];
  for (const r of data) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const label = String(r.label ?? '').trim();
    if (label) lignes.push({ label, prix: prixNombre(r.prix), cle: clePanne(label, cat) });
  }
  return lignes;
}

/** Lignes d'un ticket telles que les documents les impriment : [{ label, prix, cle }]. */
export function lignesReparation(t, cat = _catalogue) {
  const rs = String(t?.reparation_supp ?? '').trim();
  const json = rs.startsWith('[') || rs.startsWith('{');
  if (json) {
    const lignes = lignesJson(rs, cat);
    if (lignes) return lignes;
  }
  const lignes = [];
  const panne = t?.panne;
  if (panne && String(panne).trim()) {
    const label = forfaitApplicable(t) ? libellePrestation(panne, t?.panne_detail, cat) : uneLigne(panne);
    lignes.push({ label, prix: prixNombre(t?.devis_estime), cle: clePanne(panne, cat) });
  }
  if (rs && !json) lignes.push({ label: rs, prix: prixNombre(t?.prix_supp), cle: clePanne(rs, cat) });
  return lignes;
}

/** Lignes éditables de la fiche : une ligne vide si le ticket n'en a aucune. */
export function lignesEdition(t, cat = _catalogue) {
  const lignes = lignesReparation(t, cat).map(({ label, prix }) => ({ label, prix }));
  return lignes.length > 0 ? lignes : [{ label: '', prix: 0 }];
}

export function formatJson(t) {
  const rs = String(t?.reparation_supp ?? '').trim();
  return rs.startsWith('[') || rs.startsWith('{');
}

function avecLibelle(lignes) {
  return (Array.isArray(lignes) ? lignes : []).filter(l => uneLigne(l?.label));
}

const arrondi = (v) => Math.round(v * 100) / 100;

/**
 * Lignes éditables de la fiche, ancien format compris. Sans lignes JSON, tarif_final > 0 fait
 * foi, réduction déjà déduite (calculer_montants) : la ligne par défaut, au devis estimé (prix
 * d'avant diagnostic), est ajustée pour que la fiche affiche le même total que le serveur et
 * que le premier enregistrement des lignes ne change pas le prix.
 */
export function lignesFiche(t, cat = _catalogue) {
  const lignes = lignesEdition(t, cat);
  const final = prixNombre(t?.tarif_final);
  if (formatJson(t) || final <= 0) return lignes;
  const pct = prixNombre(t?.reduction_pourcentage);
  const eur = prixNombre(t?.reduction_montant);
  let base = final;
  if (pct > 0) { if (pct < 100) base = final / (1 - pct / 100); } else if (eur > 0) base = final + eur;
  base = arrondi(base);
  const [premiere, ...autres] = lignes;
  const autresComptees = avecLibelle(autres).reduce((s, l) => s + prixNombre(l.prix), 0);
  const prix = arrondi(Math.max(0, base - autresComptees));
  const label = uneLigne(premiere?.label) || 'Réparation';
  if (label === uneLigne(premiere?.label) && Math.abs(prixNombre(premiere?.prix) - prix) < 0.005) return lignes;
  return [{ label, prix }, ...autres];
}

/**
 * Commande de pièce de chaque ligne → fonction label → commande | null.
 * Même libellé ou même prestation ; à défaut, une commande qui ne correspond à aucune ligne
 * (créée au dépôt sous le nom de la pièce, « Écran iPhone 12 ») revient à l'unique ligne,
 * ou à la ligne du symptôme (« Forfait remplacement écran » pour « Écran cassé »).
 */
export function rattachementCommandes(lignes, cmds, panne, cat = _catalogue) {
  const liste = Array.isArray(cmds) ? cmds : [];
  const comptees = avecLibelle(lignes);
  const orphelines = liste.filter(c => !comptees.some(l => memeElement(c?.description, l.label, cat)));
  const cible = orphelines.length === 0 ? null
    : comptees.length === 1 ? comptees[0]
    : comptees.find(l => memeElement(l.label, panne, cat)) || null;
  const cibleLabel = cible ? uneLigne(cible.label) : null;
  return (label) => {
    const lb = uneLigne(label);
    if (!lb) return null;
    return liste.find(c => memeElement(c?.description, lb, cat))
      || (cibleLabel === lb ? orphelines[0] : null);
  };
}

/** Ligne qui porte le badge type d'écran : clé 'ecran', sinon le mot « écran ». */
export function indexLigneEcran(lignes, cat = _catalogue) {
  const liste = Array.isArray(lignes) ? lignes : [];
  for (let i = 0; i < liste.length; i++) {
    const l = liste[i];
    if ((l?.cle ?? clePanne(l?.label, cat)) === 'ecran') return i;
  }
  for (let i = 0; i < liste.length; i++) {
    if (normaliser(liste[i]?.label).split(' ').includes('ecran')) return i;
  }
  return null;
}
