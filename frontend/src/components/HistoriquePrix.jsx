/**
 * Prix : date, fraîcheur, verrou et historique des changements.
 *
 * Exports partagés par les écrans de prix (TarifsPage, grilles boutique) :
 * - fraicheurPrix(row) : âge du prix et niveau 'ok' | 'a_revoir' | 'perime' | 'inconnu' ;
 * - BadgeDatePrix : « Prix du 15/02/2026 » gris / orange / rouge, mention « estimé » ;
 * - BoutonVerrou : cadenas d'une ligne (44 px) ;
 * - FiltreAnciens : bascule « Plus de 3 mois » ;
 * - FenetrePrix : fenêtre modale accessible (focus piégé, Échap, bulle du chat masquée) ;
 * - REGLES_DEFAUT, prixClientPiece, prixClientApple, alertesPrix : calculs du serveur (services/prix) ;
 * - euros, dateFr, libelleSource.
 * Défaut : HistoriquePrix, la liste des changements groupés par lot avec « Annuler ce lot ».
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ChevronDown, ChevronRight, Clock, History, Loader2, Lock, RotateCcw, Unlock, X,
} from 'lucide-react';
import api from '../lib/api';
import { useToast } from './Toast';
import { useFocusTrap } from '../hooks/useFocusTrap';

// Sans élévation fournie, l'action est appelée telle quelle. Constante : une valeur par défaut
// recréée à chaque rendu relancerait sans fin les effets qui en dépendent.
export const SANS_ELEVATION = (fn) => fn();

// ─── Dates et fraîcheur ──────────────────────────
export const SEUILS_FRAICHEUR = { jours_a_revoir: 90, jours_perime: 180 };
export const SOURCE_ESTIMATION = 'estimation_2026_02';
const JOUR_MS = 86_400_000;

// ISO du serveur (« 2026-02-15T19:27:49.972983 » ou avec espace) → Date ; null si illisible.
// Une date-heure sans fuseau est en UTC (même convention que lib/utils.parseUTC).
export function lireDate(valeur) {
  if (!valeur) return null;
  if (valeur instanceof Date) return Number.isNaN(valeur.getTime()) ? null : valeur;
  let s = String(valeur).trim().replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1');
  if (s.includes('T') && !/([zZ]|[+-]\d{2}:?\d{2})$/.test(s)) s += 'Z';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const deux = (n) => String(n).padStart(2, '0');

// 15/02/2026 (court : 15/02/26)
export function dateFr(valeur, { court = false } = {}) {
  const d = lireDate(valeur);
  if (!d) return '';
  const annee = court ? deux(d.getFullYear() % 100) : d.getFullYear();
  return `${deux(d.getDate())}/${deux(d.getMonth() + 1)}/${annee}`;
}

export function dateHeureFr(valeur) {
  const d = lireDate(valeur);
  return d ? `${dateFr(d)} à ${deux(d.getHours())}h${deux(d.getMinutes())}` : '';
}

export function datePrix(row) {
  return row?.prix_maj_le || row?.updated_at || null;
}

/**
 * Fraîcheur d'un prix. Le serveur peut la fournir (fraicheur, age_jours, estime) ; sinon elle se
 * calcule depuis prix_maj_le (repli : updated_at) et prix_source.
 */
export function fraicheurPrix(row, seuils = SEUILS_FRAICHEUR, maintenant = Date.now()) {
  const date = datePrix(row);
  const d = lireDate(date);
  const estime = row?.estime === true || row?.prix_source === SOURCE_ESTIMATION;
  const aRevoir = Number(seuils?.jours_a_revoir) || SEUILS_FRAICHEUR.jours_a_revoir;
  const perime = Number(seuils?.jours_perime) || SEUILS_FRAICHEUR.jours_perime;
  let jours = Number.isFinite(row?.age_jours) ? row.age_jours : null;
  if (jours == null && d) jours = Math.max(0, Math.floor((maintenant - d.getTime()) / JOUR_MS));
  let niveau = 'inconnu';
  if (['ok', 'a_revoir', 'perime'].includes(row?.fraicheur)) niveau = row.fraicheur;
  else if (jours != null) niveau = jours > perime ? 'perime' : jours > aRevoir ? 'a_revoir' : 'ok';
  return { niveau, jours, date, estime };
}

export function plusDeTroisMois(row, seuils = SEUILS_FRAICHEUR) {
  const f = fraicheurPrix(row, seuils);
  return f.niveau === 'a_revoir' || f.niveau === 'perime';
}

// ─── Règles de prix (mêmes calculs que backend/app/services/prix.py) ───
export const REGLES_DEFAUT = Object.freeze({
  tva: 1.2,
  ecran: Object.freeze({ standard: 60, haut_de_gamme: 70, pliant: 100 }),
  autre: 60,
  ipad: 110,
  macbook: 120,
  arrondi: '9_sup',
  seuil_marge_alerte: 40,
  variation_alerte_pct: 25,
  variation_alerte_eur: 30,
  jours_a_revoir: 90,
  jours_perime: 180,
});

export function fusionnerRegles(r) {
  const src = r && typeof r === 'object' ? r : {};
  return { ...REGLES_DEFAUT, ...src, ecran: { ...REGLES_DEFAUT.ecran, ...(src.ecran || {}) } };
}

// Plus petit entier finissant par 9, supérieur ou égal (61 → 69, 90 → 99)
export function arrondi9(prix) {
  const candidat = Math.floor(prix / 10) * 10 + 9;
  return candidat >= prix ? candidat : candidat + 10;
}

function arrondirPrix(prix, mode) {
  if (mode === 'entier') return Math.ceil(prix);
  return arrondi9(prix);
}

export const estEcran = (typePiece) => /ecran|écran/i.test(String(typePiece || ''));

/** Prix client d'une pièce fournisseur : HT × TVA + marge (écran selon la catégorie), arrondi. */
export function prixClientPiece(ht, typePiece, categorie, regles) {
  const r = fusionnerRegles(regles);
  const cat = String(categorie || 'standard').toLowerCase();
  const marge = estEcran(typePiece) ? (r.ecran[cat] ?? r.ecran.standard) : r.autre;
  return arrondirPrix(Number(ht) * r.tva + marge, r.arrondi);
}

/** Prix de vente iPad / MacBook. */
export function prixClientApple(ht, categorie, regles) {
  const r = fusionnerRegles(regles);
  return arrondirPrix(Number(ht) * r.tva + (categorie === 'ipad' ? r.ipad : r.macbook), r.arrondi);
}

/**
 * Alertes d'un nouveau prix d'achat : 'variation' (écart > seuil en € ou en %), 'marge' (écran sous la
 * marge minimale). Mêmes seuils que le serveur (alertes_variation, seuil_marge_alerte).
 */
export function alertesPrix({ ancienHt, nouveauHt, client, ecran }, regles) {
  const r = fusionnerRegles(regles);
  const out = [];
  const a = Number(ancienHt);
  const n = Number(nouveauHt);
  if (ancienHt != null && ancienHt !== '' && Number.isFinite(a) && Number.isFinite(n)) {
    const delta = Math.abs(n - a);
    if (delta > r.variation_alerte_eur || (a > 0 && (delta / a) * 100 > r.variation_alerte_pct)) out.push('variation');
  }
  if (ecran && Number.isFinite(n) && Number.isFinite(Number(client))
      && Math.round((Number(client) - n * r.tva) * 100) / 100 < r.seuil_marge_alerte) out.push('marge');
  return out;
}

// ─── Montants et libellés ─────────────────────────
export function euros(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return '—';
  const n = Number(valeur);
  if (!Number.isFinite(n)) return '—';
  const texte = Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
  return `${texte.replace('-', '−')} €`;
}

export function variationTexte(ancien, nouveau) {
  const a = Number(ancien);
  const n = Number(nouveau);
  if (!Number.isFinite(a) || !Number.isFinite(n)) return '';
  const diff = n - a;
  const signe = diff > 0 ? '+' : diff < 0 ? '−' : '';
  const abs = Math.abs(diff);
  const montant = Number.isInteger(abs) ? String(abs) : abs.toFixed(2).replace('.', ',');
  const pct = a ? ` (${signe}${Math.abs((diff / a) * 100).toFixed(0)} %)` : '';
  return `${signe}${montant} €${pct}`;
}

const SOURCES = {
  [SOURCE_ESTIMATION]: 'Estimation de févr. 2026',
  import: 'Import d’un fichier',
  commande: 'Commande de pièce',
  formule: 'Règles de prix',
  manuel: 'Saisie à la main',
  ajustement: 'Ajustement global',
  annulation: 'Annulation d’un lot',
  recalcul: 'Recalcul',
};
export function libelleSource(source) {
  if (!source) return 'Source inconnue';
  return SOURCES[source] || source;
}

const COLONNES = {
  prix_fournisseur_ht: 'Prix d’achat HT',
  prix_client: 'Prix client',
  ecran_prix_ht: 'Écran — achat HT',
  batterie_prix_ht: 'Batterie — achat HT',
  ecran_prix_vente: 'Écran — prix client',
  batterie_prix_vente: 'Batterie — prix client',
  ecran_generique: 'Écran générique',
  ecran_confort: 'Écran confort',
  ecran_apple: 'Écran Apple',
  batterie: 'Batterie',
  desoxydation: 'Désoxydation',
  connecteur_charge: 'Connecteur',
  reparation_divers: 'Réparation',
  ecouteur_apn: 'Écouteur / APN',
  vitre_arriere: 'Vitre arrière',
  chassis: 'Châssis',
  prix_1: 'Prix 1',
  prix_2: 'Prix 2',
  prix_3: 'Prix 3',
};
export function libelleColonne(colonne) {
  if (!colonne) return '';
  if (COLONNES[colonne]) return COLONNES[colonne];
  if (colonne.endsWith('_barre')) return `${libelleColonne(colonne.slice(0, -6))} (barré)`;
  return colonne.replace(/_/g, ' ');
}

const TABLES = {
  tarifs: 'Pièce fournisseur',
  tarifs_apple_devices: 'iPad / MacBook',
  tarifs_reparation: 'Grille iPhone boutique',
  iphone_tarifs: 'iPhone à vendre',
  smartphones_tarifs: 'Smartphone à vendre',
};

// ─── Badge « Prix du … » ──────────────────────────
const TONS = {
  clair: {
    ok: 'badge-neutral',
    a_revoir: 'badge-warning',
    perime: 'badge-danger',
    inconnu: 'badge-neutral text-slate-500',
    estime: 'bg-white text-slate-600 border border-dashed border-slate-300',
  },
  sombre: {
    ok: 'bg-slate-800 text-slate-200',
    a_revoir: 'bg-amber-500/15 text-amber-200',
    perime: 'bg-red-500/15 text-red-200',
    inconnu: 'bg-slate-800 text-slate-300',
    estime: 'bg-slate-900/60 text-slate-200 border border-dashed border-slate-500',
  },
};

function phraseFraicheur(f, seuils = SEUILS_FRAICHEUR) {
  const morceaux = [];
  morceaux.push(f.date ? `Prix du ${dateFr(f.date)}` : 'Date du prix inconnue');
  if (f.estime) morceaux.push('estimé, jamais vérifié');
  if (f.niveau === 'perime') morceaux.push(`plus de ${Math.round(seuils.jours_perime / 30)} mois : périmé`);
  else if (f.niveau === 'a_revoir') morceaux.push(`plus de ${Math.round(seuils.jours_a_revoir / 30)} mois : à revoir`);
  return morceaux.join(', ');
}

export function BadgeDatePrix({ row, seuils = SEUILS_FRAICHEUR, theme = 'clair', court = false, className = '' }) {
  const f = fraicheurPrix(row, seuils);
  const tons = TONS[theme] || TONS.clair;
  const phrase = phraseFraicheur(f, seuils);
  const Icone = f.niveau === 'perime' ? AlertTriangle : f.niveau === 'a_revoir' ? Clock : null;
  return (
    <span className={`inline-flex items-center gap-1 flex-wrap ${className}`} title={phrase}>
      <span className={`badge badge-sm tabular-nums ${tons[f.niveau]}`}>
        {Icone && <Icone className="w-3 h-3 shrink-0" aria-hidden="true" />}
        <span aria-hidden="true">{f.date ? (court ? dateFr(f.date, { court: true }) : `Prix du ${dateFr(f.date)}`) : 'Date inconnue'}</span>
        <span className="sr-only">{phrase}</span>
      </span>
      {f.estime && (
        <span aria-hidden="true" className={`badge badge-sm ${tons.estime}`}>
          estimé
        </span>
      )}
    </span>
  );
}

// ─── Cadenas d'une ligne ───────────────────────────
export function BoutonVerrou({ verrouille, onClick, disabled = false, nom = 'ce prix', theme = 'clair', lectureSeule = false, aide }) {
  const sombre = theme === 'sombre';
  const explication = aide || (verrouille
    ? 'Verrouillé : jamais modifié automatiquement (import, règles, commandes).'
    : 'Non verrouillé : peut être mis à jour par un import, les règles ou une commande.');
  const classes = verrouille
    ? (sombre ? 'bg-amber-500/20 text-amber-200 hover:bg-amber-500/30' : 'bg-amber-50 text-amber-800 hover:bg-amber-100 hover:text-amber-900')
    : (sombre ? 'bg-transparent text-slate-400 hover:text-white hover:bg-slate-800' : 'text-slate-500');
  const Icone = verrouille ? Lock : Unlock;
  if (lectureSeule) {
    if (!verrouille) return null;
    return (
      <span title={explication} className={`badge badge-sm ${sombre ? 'bg-amber-500/20 text-amber-200' : 'badge-warning'}`}>
        <Lock className="w-3 h-3" aria-hidden="true" />
        <span className="sr-only">{`${nom} : verrouillé`}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      disabled={disabled}
      aria-pressed={!!verrouille}
      aria-label={verrouille ? `Déverrouiller ${nom}` : `Verrouiller ${nom}`}
      title={explication}
      className={`btn-ghost btn-icon disabled:cursor-wait ${classes}`}
    >
      {disabled ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <Icone aria-hidden="true" />}
    </button>
  );
}

// ─── Bascule « Plus de 3 mois » ───────────────────
export function FiltreAnciens({ actif, onChange, nombre, theme = 'clair', libelle = 'Plus de 3 mois' }) {
  const sombre = theme === 'sombre';
  const classes = actif
    ? (sombre ? 'bg-amber-500/20 text-amber-100 border-amber-500/60' : 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100 hover:border-amber-300')
    : (sombre ? 'bg-slate-900 text-slate-300 border-slate-700 hover:text-white' : '');
  return (
    <button
      type="button"
      onClick={() => onChange(!actif)}
      aria-pressed={!!actif}
      className={`btn-secondary ${classes}`}
    >
      <Clock aria-hidden="true" />
      {libelle}
      {Number.isFinite(nombre) && (
        <span className={`badge-count ${sombre ? 'bg-white/10' : actif ? 'bg-amber-800 text-white' : ''}`}>{nombre}</span>
      )}
    </button>
  );
}

// ─── Fenêtre modale ───────────────────────────────
// La bulle du chat (ChatWidget, z-[100], en bas à droite) couvrirait le bouton « Appliquer » du pied de
// fenêtre sur tablette et mobile : elle est masquée tant qu'une fenêtre de prix est ouverte. La fenêtre
// reste en z-[55], sous l'identification admin (AdminLoginModal, z-[60]) qu'elle peut déclencher.
export const CSS_SANS_BULLE_CHAT = 'button[aria-haspopup="dialog"][aria-label^="Ouvrir le chat"]{visibility:hidden!important}';

export function FenetrePrix({ open, onClose, titre, sousTitre, icone: Icone, children, pied, largeur = 'max-w-4xl', bloquer = false }) {
  const boite = useRef(null);
  const idTitre = useId();
  const fermer = useCallback(() => { if (!bloquer) onClose?.(); }, [bloquer, onClose]);
  useFocusTrap(boite, open, { onEscape: fermer });
  if (!open) return null;
  return (
    <div className="modal-overlay z-[55] items-stretch sm:items-center" onClick={fermer} data-fenetre-prix="">
      <style>{CSS_SANS_BULLE_CHAT}</style>
      <div
        ref={boite}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
        onClick={(e) => e.stopPropagation()}
        className={`modal ${largeur} max-sm:rounded-none max-h-full sm:max-h-[92vh] overflow-hidden`}
      >
        <div className="modal-header items-start">
          {Icone && (
            <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
              <Icone className="w-5 h-5" aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 id={idTitre} className="t-h2">{titre}</h2>
            {sousTitre && <p className="text-sm text-slate-500 mt-0.5">{sousTitre}</p>}
          </div>
          <button
            type="button"
            onClick={fermer}
            disabled={bloquer}
            aria-label="Fermer"
            className="btn-ghost btn-icon shrink-0"
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="modal-body flex-1">{children}</div>
        {pied && <div className="border-t border-slate-100 px-5 py-4 bg-slate-50/60 shrink-0">{pied}</div>}
      </div>
    </div>
  );
}

// Onglets ARIA : flèches gauche / droite, Début, Fin (l'onglet actif seul est dans l'ordre de tabulation)
export function clavierOnglets(e, cles, actuel, choisir) {
  const i = cles.indexOf(actuel);
  let j = null;
  if (e.key === 'ArrowRight') j = (i + 1) % cles.length;
  else if (e.key === 'ArrowLeft') j = (i - 1 + cles.length) % cles.length;
  else if (e.key === 'Home') j = 0;
  else if (e.key === 'End') j = cles.length - 1;
  if (j === null) return;
  e.preventDefault();
  choisir(cles[j]);
  const onglets = e.currentTarget.closest('[role="tablist"]')?.querySelectorAll('[role="tab"]');
  onglets?.[j]?.focus();
}

// Message lisible d'une erreur d'enregistrement (403 de rôle, réseau, serveur)
export function messageErreurPrix(err, action = 'Enregistrement impossible') {
  if (err?.code === 'admin_cancelled') return null;
  if (err?.status === 403) {
    const detail = err.message && !/^(Erreur 403|Admin requis)$/i.test(err.message.trim()) ? ` ${err.message}` : '';
    return `${action} : réservé à l’administrateur.${detail}`;
  }
  if (err?.status === 404) return `${action} : élément introuvable (déjà supprimé ?).`;
  // Cadenas (pièce verrouillée, ligne cadenassée d'une grille boutique) : message du serveur s'il est
  // parlant, sinon une consigne claire plutôt que « Erreur 409 (verrouille) »
  if (err?.status === 409 && err?.code === 'verrouille') {
    const parlant = err.message && !/^Erreur(\s+\d+)?(\s+\(verrouille\))?$/i.test(err.message.trim());
    return `${action} : ${parlant ? err.message : 'prix verrouillé (cadenas fermé). Ouvrez le cadenas de la ligne pour le modifier.'}`;
  }
  if (err?.status === 409) return `${action} : ${err.message || 'conflit, rechargez la page.'}`;
  if (err?.status === 410) return `${action} : cette fonction a été retirée.`;
  if (!err?.status && err?.code !== 'timeout' && /fetch|network|injoignable/i.test(err?.message || '')) {
    return `${action} : serveur injoignable, vérifiez la connexion puis réessayez.`;
  }
  return `${action} : ${err?.message || 'erreur inconnue'}`;
}

// ─── Bilan d'une annulation de lot ─────────────────
const accord = (n, un, plusieurs) => (n > 1 ? plusieurs : un);

/**
 * Réponse de POST /api/tarifs/historique/annuler-lot/{id} (services/prix.annuler_lot) :
 * { restaures, conflits: [clé], verrouilles: ['table:id'], propositions_rouvertes, propositions_annulees, regles? }.
 * « conflits » regroupe les prix modifiés depuis le lot ET ceux des lignes verrouillées (verrou d'une pièce,
 * cadenas d'une grille boutique) : ces dernières sont comptées à part, « modifié depuis » ne vaut que pour
 * les autres. → { complet, modifies, verrouillees, rouvertes, annulees, details: [phrase], propositions: [phrase] }
 */
export function bilanAnnulation(res) {
  const verrous = [...new Set((Array.isArray(res?.verrouilles) ? res.verrouilles : []).map(String))];
  const conflits = [...new Set((Array.isArray(res?.conflits) ? res.conflits : []).map(String))];
  const deVerrou = (c) => verrous.some((v) => c === v || c.startsWith(`${v}:`));
  const modifies = conflits.filter((c) => !deVerrou(c)).length;
  const verrouillees = verrous.length;
  const rouvertes = Number(res?.propositions_rouvertes) || 0;
  const annulees = Number(res?.propositions_annulees) || 0;
  const details = [];
  if (modifies) {
    details.push(`${modifies} prix ${accord(modifies, 'modifié', 'modifiés')} depuis, ${accord(modifies, 'laissé tel quel', 'laissés tels quels')}`);
  }
  if (verrouillees) {
    details.push(`${verrouillees} ${accord(verrouillees, 'ligne verrouillée, non rétablie', 'lignes verrouillées, non rétablies')} : ouvrez le cadenas pour ${accord(verrouillees, 'la', 'les')} modifier`);
  }
  if (res?.regles === 'conflit') details.push('règles de marge modifiées depuis, gardées telles quelles');
  const propositions = [];
  if (rouvertes) propositions.push(`${rouvertes} ${accord(rouvertes, 'proposition de prix remise', 'propositions de prix remises')} en attente`);
  if (annulees) propositions.push(`${annulees} ${accord(annulees, 'proposition de prix annulée', 'propositions de prix annulées')}`);
  return { complet: details.length === 0, modifies, verrouillees, rouvertes, annulees, details, propositions };
}

/**
 * Message d'une annulation de lot. `succes` : phrase quand tout est rétabli (sinon « <sujet> : les prix sont
 * revenus à leur valeur d'avant. ») ; `restaures` : nombre de prix remis (défaut res.restaures).
 * → { ton: 'success' | 'warning', texte, bilan }
 */
export function messageAnnulation(res, { sujet = 'Changement annulé', succes, restaures } = {}) {
  const bilan = bilanAnnulation(res);
  const n = Number(restaures ?? res?.restaures) || 0;
  const suite = bilan.propositions.length
    ? ` ${bilan.propositions.join(' ; ').replace(/^./, (c) => c.toUpperCase())}.` : '';
  if (bilan.complet) {
    return { ton: 'success', texte: `${succes || `${sujet} : les prix sont revenus à leur valeur d’avant.`}${suite}`, bilan };
  }
  const debut = n > 0 ? `${sujet} en partie : ${n} prix remis à leur valeur d’avant ; ` : 'Aucun prix rétabli : ';
  return { ton: 'warning', texte: `${debut}${bilan.details.join(' ; ')}.${suite}`, bilan };
}

// ─── Historique ───────────────────────────────────
const PREFIXE_ANNULATION = 'annulation:';

function grouperParLot(lignes) {
  const lots = new Map();
  for (const l of lignes || []) {
    const cle = l.lot_id || `seul-${l.id}`;
    if (!lots.has(cle)) {
      lots.set(cle, { cle, lot_id: l.lot_id || null, le: l.le, source: l.source, par: l.par, lignes: [] });
    }
    const lot = lots.get(cle);
    lot.lignes.push(l);
    if (lireDate(l.le) > lireDate(lot.le)) lot.le = l.le;
  }
  const annulations = new Map();
  for (const lot of lots.values()) {
    if (lot.lot_id?.startsWith(PREFIXE_ANNULATION)) annulations.set(lot.lot_id.slice(PREFIXE_ANNULATION.length), lot.le);
  }
  return [...lots.values()]
    .map((lot) => ({
      ...lot,
      nb: new Set(lot.lignes.map((l) => `${l.table_nom}:${l.ligne_id}`)).size,
      annule: lot.lot_id ? annulations.has(lot.lot_id) : false,
      annule_le: lot.lot_id ? annulations.get(lot.lot_id) || null : null,
    }))
    .sort((a, b) => (lireDate(b.le)?.getTime() || 0) - (lireDate(a.le)?.getTime() || 0));
}

// Résumé des lots (GET /historique/lots) → même forme que grouperParLot, détail chargé à l'ouverture
function lotsDepuisResume(data) {
  const liste = Array.isArray(data) ? data : [];
  const annulations = new Map(
    liste.filter((l) => l.lot_id?.startsWith(PREFIXE_ANNULATION)).map((l) => [l.lot_id.slice(PREFIXE_ANNULATION.length), l.le]),
  );
  return liste.map((l) => ({
    cle: l.lot_id,
    lot_id: l.lot_id,
    le: l.le,
    source: l.source,
    par: l.par,
    nb: Number(l.lignes ?? l.valeurs) || 0,
    annule: !!l.annule,
    annule_le: annulations.get(l.lot_id) || null,
    lignes: null,
  }));
}

/**
 * Historique des changements de prix, groupés par lot (un import, une application de règles…).
 * Sans filtre : résumé des derniers lots (détail chargé à l'ouverture d'un lot). Avec filtre { table, ligne_id } :
 * changements de cette table ou de cette ligne.
 * props : open, onClose, sensible (useAdminElevation), filtre, nommer(ligne) → libellé, onAnnule() après une annulation.
 */
export default function HistoriquePrix({ open, onClose, sensible = SANS_ELEVATION, filtre = {}, nommer, onAnnule, titre = 'Historique des prix' }) {
  const toast = useToast();
  const parLots = !filtre.table && !filtre.ligne_id;
  const [lots, setLots] = useState([]);
  const [details, setDetails] = useState({}); // lot_id → { lignes } | { chargement } | { erreur }
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState('');
  const [source, setSource] = useState('');
  const [ouverts, setOuverts] = useState(() => new Set());
  const [aConfirmer, setAConfirmer] = useState(null);
  const [annulation, setAnnulation] = useState(null);
  // Le serveur renvoie au plus 1 000 changements (ou 200 lots) par lecture
  const [limite, setLimite] = useState(parLots ? 50 : 500);
  const maximum = parLots ? 200 : 1000;
  const [complet, setComplet] = useState(true);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur('');
    try {
      if (parLots) {
        const data = await sensible(() => api.getLotsPrix(limite));
        setLots(lotsDepuisResume(data));
        setComplet((Array.isArray(data) ? data.length : 0) < limite);
      } else {
        const data = await sensible(() => api.getHistoriquePrix({ table: filtre.table, ligne_id: filtre.ligne_id, limit: limite }));
        const lignes = Array.isArray(data) ? data : (data?.lignes || data?.items || []);
        setLots(grouperParLot(lignes));
        setComplet(lignes.length < limite);
      }
      setDetails({});
    } catch (e) {
      const msg = messageErreurPrix(e, 'Lecture de l’historique impossible');
      if (msg) setErreur(msg);
    } finally {
      setChargement(false);
    }
  }, [sensible, parLots, filtre.table, filtre.ligne_id, limite]);

  useEffect(() => { if (open) charger(); }, [open, charger]);
  useEffect(() => { if (!open) { setAConfirmer(null); setOuverts(new Set()); } }, [open]);

  const lotsVisibles = useMemo(() => (source ? lots.filter((l) => l.source === source) : lots), [lots, source]);
  const sources = useMemo(() => [...new Set(lots.map((l) => l.source).filter(Boolean))], [lots]);

  async function chargerDetail(lot) {
    if (!lot.lot_id || lot.lignes || details[lot.lot_id]?.lignes || details[lot.lot_id]?.chargement) return;
    setDetails((d) => ({ ...d, [lot.lot_id]: { chargement: true } }));
    try {
      const data = await sensible(() => api.getHistoriquePrix({ lot_id: lot.lot_id, limit: 1000 }));
      setDetails((d) => ({ ...d, [lot.lot_id]: { lignes: Array.isArray(data) ? data : [] } }));
    } catch (e) {
      setDetails((d) => ({ ...d, [lot.lot_id]: { erreur: messageErreurPrix(e, 'Détail indisponible') || 'Détail indisponible' } }));
    }
  }

  const basculer = (lot) => {
    setOuverts((prev) => {
      const n = new Set(prev);
      if (n.has(lot.cle)) n.delete(lot.cle); else n.add(lot.cle);
      return n;
    });
    chargerDetail(lot);
  };

  async function annulerLot(lot) {
    setAnnulation(lot.lot_id);
    try {
      const res = await sensible(() => api.annulerLotPrix(lot.lot_id));
      const n = res?.restaures ?? res?.annules ?? res?.modifies ?? lot.nb;
      // Lignes verrouillées distinguées des prix modifiés depuis ; propositions rouvertes ou annulées signalées
      const m = messageAnnulation(res, { sujet: 'Lot annulé', succes: `Lot annulé : ${n} prix remis à leur valeur d’avant.`, restaures: n });
      if (m.ton === 'warning') toast.warning(m.texte); else toast.success(m.texte);
      setAConfirmer(null);
      await charger();
      onAnnule?.(res);
    } catch (e) {
      const msg = messageErreurPrix(e, 'Annulation impossible');
      if (msg) toast.error(msg);
    } finally {
      setAnnulation(null);
    }
  }

  const libelle = (l) => nommer?.(l) || `${TABLES[l.table_nom] || l.table_nom || 'Prix'} n° ${l.ligne_id}`;

  return (
    <FenetrePrix
      open={open}
      onClose={onClose}
      titre={titre}
      sousTitre="Chaque changement de prix : quand, par qui, d’où il vient. Un lot entier peut être annulé."
      icone={History}
      bloquer={!!annulation}
    >
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <label htmlFor="historique-source" className="t-label">Origine</label>
        <select
          id="historique-source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="select w-auto"
        >
          <option value="">Toutes</option>
          {sources.map((s) => <option key={s} value={s}>{libelleSource(s)}</option>)}
        </select>
        <span className="text-sm text-slate-500" aria-live="polite">
          {chargement ? 'Chargement…' : `${lotsVisibles.length} lot${lotsVisibles.length > 1 ? 's' : ''} de changements`}
        </span>
      </div>

      {erreur && (
        <div role="alert" className="callout callout-danger items-center mb-4">
          <span className="flex-1">{erreur}</span>
          <button type="button" onClick={charger} className="btn-secondary btn-sm">Réessayer</button>
        </div>
      )}

      {!chargement && !erreur && lotsVisibles.length === 0 && (
        <p className="py-10 text-center text-sm text-slate-500">Aucun changement de prix enregistré pour l’instant.</p>
      )}

      <ul className="space-y-3">
        {lotsVisibles.map((lot) => {
          const ouvert = ouverts.has(lot.cle);
          const idDetail = `detail-${lot.cle}`.replace(/[^a-zA-Z0-9_-]/g, '-');
          const confirmer = aConfirmer === lot.cle;
          const annulable = !!lot.lot_id && lot.source !== 'annulation' && !lot.lot_id.startsWith(PREFIXE_ANNULATION) && !lot.annule;
          const detail = lot.lignes ? { lignes: lot.lignes } : details[lot.lot_id] || {};
          return (
            <li key={lot.cle} className="card">
              <div className="flex flex-wrap items-center gap-2 p-3">
                <button
                  type="button"
                  onClick={() => basculer(lot)}
                  aria-expanded={ouvert}
                  aria-controls={idDetail}
                  className="flex-1 min-w-[200px] min-h-[44px] flex items-center gap-2 text-left rounded-lg px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  {ouvert ? <ChevronDown className="w-4 h-4 text-brand-600 shrink-0" aria-hidden="true" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />}
                  <span className="min-w-0">
                    <span className="block font-semibold text-sm text-slate-900">
                      {libelleSource(lot.source)} — {lot.nb} prix modifié{lot.nb > 1 ? 's' : ''}
                    </span>
                    <span className="block t-caption">
                      {dateHeureFr(lot.le)}{lot.par ? ` · par ${lot.par}` : ''}
                      {lot.annule && (
                        <span className="ml-1 font-semibold text-slate-700">
                          · annulé{lot.annule_le ? ` le ${dateHeureFr(lot.annule_le)}` : ''}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
                {annulable && !confirmer && (
                  <button
                    type="button"
                    onClick={() => setAConfirmer(lot.cle)}
                    className="btn-secondary btn-sm"
                  >
                    <RotateCcw aria-hidden="true" /> Annuler ce lot
                  </button>
                )}
              </div>
              {confirmer && (
                <div role="alertdialog" aria-label="Confirmer l’annulation du lot" className="mx-3 mb-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  <p className="font-semibold">Remettre ces {lot.nb} prix à leur valeur d’avant ?</p>
                  <p className="mt-1">Les tickets déjà créés gardent leur prix. Un prix modifié depuis n’est pas touché. L’annulation est elle-même notée dans l’historique.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setAConfirmer(null)}
                      disabled={annulation === lot.lot_id}
                      className="btn-ghost"
                    >
                      Non, garder
                    </button>
                    <button
                      type="button"
                      onClick={() => annulerLot(lot)}
                      disabled={annulation === lot.lot_id}
                      className="btn-primary"
                    >
                      {annulation === lot.lot_id && <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />}
                      Oui, annuler le lot
                    </button>
                  </div>
                </div>
              )}
              {ouvert && (
                <div id={idDetail} className="border-t border-slate-100 overflow-x-auto">
                  {detail.chargement && (
                    <p className="loading-inline px-3 py-4" role="status">
                      <Loader2 aria-hidden="true" /> Chargement du détail…
                    </p>
                  )}
                  {detail.erreur && <p role="alert" className="px-3 py-4 text-sm font-medium text-red-700">{detail.erreur}</p>}
                  {detail.lignes && (
                    <table className="table table-dense">
                      <caption className="sr-only">Détail du lot</caption>
                      <thead className="bg-slate-50">
                        <tr>
                          <th scope="col" className="table-header">Prix</th>
                          <th scope="col" className="table-header text-right">Avant</th>
                          <th scope="col" className="table-header text-right">Après</th>
                          <th scope="col" className="table-header text-right">Écart</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.lignes.map((l) => (
                          <tr key={l.id} className="table-row">
                            <td>
                              <span className="font-medium text-slate-900">{libelle(l)}</span>
                              {l.colonne && <span className="block t-caption">{libelleColonne(l.colonne)}</span>}
                            </td>
                            <td className="text-right tabular-nums text-slate-500">{euros(l.ancien)}</td>
                            <td className="table-cell-num">{euros(l.nouveau)}</td>
                            <td className="text-right tabular-nums text-slate-700 whitespace-nowrap">{variationTexte(l.ancien, l.nouveau)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {!complet && limite < maximum && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => setLimite(maximum)}
            className="btn-secondary"
          >
            Afficher les changements plus anciens
          </button>
        </div>
      )}
    </FenetrePrix>
  );
}
