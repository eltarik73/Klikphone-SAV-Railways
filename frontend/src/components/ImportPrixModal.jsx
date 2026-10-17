/**
 * « Importer une liste de prix » : fichier fournisseur (Excel ou CSV) → aperçu → application → annulation.
 *
 * 1. Fichier : déposer ou choisir, fournisseur, catalogue (pièces téléphones ou iPad/MacBook).
 * 2. Aperçu (rien n'est écrit) : correspondance des colonnes préremplie et mémorisée par le serveur
 *    pour ce fournisseur, prix reconnus (alertes en haut, grosses variations décochées), nouvelles
 *    pièces, lignes à associer à la main, pièces absentes du fichier (obsolètes si l'admin le coche).
 *    Une ligne associée à la main montre le prix du fichier puis, dès la pièce choisie, son aperçu
 *    « avant → après » chiffré par le serveur (POST /evaluer : achat HT, prix client, alertes ; calcul
 *    local en repli). Cochée par défaut seulement sans alerte ; en alerte, appliquée seulement cochée
 *    explicitement (envoyée dans `confirmees`).
 * 3. Terminé : bilan et « Annuler cet import ».
 * props : open, onClose, sensible (useAdminElevation), catalogue { tarifs, appleDevices }, regles (règles de
 * prix en vigueur ; lues à l'aperçu à défaut), onApplique().
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronRight, FileSpreadsheet, Link2, Loader2, Lock, Search, Undo2, Upload, X,
} from 'lucide-react';
import api from '../lib/api';
import { useToast } from './Toast';
import {
  FenetrePrix, SANS_ELEVATION, alertesPrix, clavierOnglets, euros, fusionnerRegles, messageAnnulation, messageErreurPrix,
  prixClientApple, prixClientPiece, variationTexte,
} from './HistoriquePrix';

const FOURNISSEUR_CLE = 'kp_import_prix_fournisseur';
const CATALOGUE_VIDE = Object.freeze({});
const TAILLE_MAX = 5 * 1024 * 1024; // services/import_prix.MAX_OCTETS
const PAR_PAGE = 100;

export const CHAMPS_COLONNES = [
  { key: 'reference', label: 'Référence fournisseur', aide: 'Code article (le plus sûr pour reconnaître une pièce)' },
  { key: 'designation', label: 'Désignation', aide: 'Libellé complet de la pièce' },
  { key: 'marque', label: 'Marque' },
  { key: 'modele', label: 'Modèle' },
  { key: 'type_piece', label: 'Type de pièce', aide: 'Écran, batterie…' },
  { key: 'qualite', label: 'Qualité', aide: 'Original, OLED, Incell…' },
  { key: 'categorie', label: 'Catégorie d’écran', aide: 'standard, haut de gamme, pliant' },
  { key: 'prix_ht', label: 'Prix d’achat HT', requis: true },
];

// Codes d'alerte du serveur (services/import_prix, services/prix) → libellés
const ALERTES = {
  variation: 'Grosse variation',
  marge: 'Marge trop faible',
  verrou: 'Prix verrouillé',
  conflit: 'Plusieurs lignes, prix différents',
  doublon: 'Ligne en double',
  prix_inconnu: 'Prix du fichier non lu',
  ht_inconnu: 'Prix d’achat actuel non lu',
};
const libelleAlerte = (code) => ALERTES[code] || code;

const sansAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function lireFournisseur() {
  try { return localStorage.getItem(FOURNISSEUR_CLE) || 'Mobilax'; } catch { return 'Mobilax'; }
}
function retenirFournisseur(f) {
  try { localStorage.setItem(FOURNISSEUR_CLE, f); } catch { /* stockage indisponible */ }
}

function extensionValide(nom) {
  return /\.(xlsx|csv)$/i.test(nom || '');
}

// Libellé d'une ligne brute du fichier (objet colonne → valeur, tableau ou texte)
export function texteBrut(brut) {
  if (brut == null) return '';
  if (typeof brut === 'string') return brut;
  if (Array.isArray(brut)) return brut.filter((v) => v !== null && v !== '').join(' · ');
  if (typeof brut === 'object') return Object.values(brut).filter((v) => v !== null && v !== '').join(' · ');
  return String(brut);
}

// Libellé des alertes d'une ligne (tableau `alertes` ou code `alerte`)
function texteAlerte(alerte, alertes) {
  const codes = Array.isArray(alertes) && alertes.length ? alertes : alerte ? [alerte] : [];
  return codes.map((a) => (typeof a === 'object' && a ? (a.message || a.code) : libelleAlerte(a))).filter(Boolean).join(', ');
}
const alerteDe = (l) => texteAlerte(l.alerte, l.alertes);
const libelleNouvelle = (l) => l.label
  || [l.marque, l.modele].filter(Boolean).join(' ') + (l.type_piece ? ` · ${l.type_piece}${l.qualite ? ` ${l.qualite}` : ''}` : '')
  || texteBrut(l.designation || l.brut);

function ecartRelatif(l) {
  const a = Number(l.ancien_ht);
  const n = Number(l.nouveau_ht);
  if (!Number.isFinite(a) || !Number.isFinite(n)) return 0;
  return a ? Math.abs(n - a) / a : Math.abs(n - a);
}

const change = (l) => (typeof l.change === 'boolean'
  ? l.change
  : Number(l.ancien_ht) !== Number(l.nouveau_ht) || Number(l.ancien_client) !== Number(l.nouveau_client));
const cleLigne = (l) => `${l.n}:${l.cle}`;

// Prix d'achat HT d'une ligne du fichier (non reconnue) tel que lu par le serveur
export function htDuFichier(l) {
  const v = l?.nouveau_ht ?? l?.prix_ht ?? l?.ht;
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Aperçu d'une ligne associée à la main : ancien → nouveau prix d'achat et prix client (règles en
 * vigueur), alertes comme pour un prix reconnu (variation, marge d'un écran, pièce verrouillée).
 */
export function apercuAssociation(ligne, piece, regles) {
  const nouveauHt = htDuFichier(ligne);
  const alertes = [];
  if (piece.verrou) alertes.push('verrou');
  if (nouveauHt == null) return { nouveauHt: null, nouveauClient: null, alertes: [...alertes, 'prix_inconnu'] };
  // Prix d'achat actuel masqué (code admin pas encore saisi) : pas de comparaison possible, à vérifier
  if (piece.ht === undefined) alertes.push('ht_inconnu');
  const nouveauClient = piece.table === 'tarifs_apple_devices'
    ? prixClientApple(nouveauHt, piece.categorie, regles)
    : prixClientPiece(nouveauHt, piece.type_piece, piece.categorie, regles);
  alertes.push(...alertesPrix({ ancienHt: piece.ht, nouveauHt, client: nouveauClient, ecran: piece.ecran }, regles));
  return { nouveauHt, nouveauClient, alertes };
}

const nombreOuNull = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * Ligne de grille d'une clé de pièce : « tarifs:12 » → « tarifs:12 », « tarifs_apple_devices:5:ecran »
 * → « tarifs_apple_devices:5 ». Un iPad / MacBook n'est obsolète qu'en entier : le serveur
 * (services/import_prix.appliquer) garde toute la ligne dès qu'une de ses pièces est visée.
 */
export const ligneDeCle = (cle) => String(cle || '').split(':').slice(0, 2).join(':');

/**
 * Pièces « absentes du fichier » telles que le serveur les traitera à l'application :
 * - retirees : visées par une association appliquée (cochée), donc jamais marquées obsolètes ;
 * - visibles : les autres (liste, compteurs) ; aMarquer : celles que « Marquer comme obsolètes »
 *   marquera vraiment (une pièce verrouillée ne l'est jamais).
 */
export function absentesApresAssociations(absentes, clesAssociees) {
  const lignes = new Set((clesAssociees || []).map(ligneDeCle));
  const visibles = (absentes || []).filter((a) => !lignes.has(ligneDeCle(a.cle)));
  return {
    visibles,
    aMarquer: visibles.filter((a) => !a.verrou),
    retirees: (absentes || []).length - visibles.length,
  };
}
const ALERTES_A_CONFIRMER = ['variation', 'marge']; // services/import_prix.ALERTES_A_CONFIRMER

/**
 * Réponse de POST /api/tarifs/import-fichier/{id}/evaluer ([{ n, cle, ancien_ht, nouveau_ht, ancien_client,
 * nouveau_client, verrou, obsolete, alerte, alertes, confirmation_requise }] ou { n, cle, erreur }) pour la
 * ligne n associée à cle → { nouveauHt, nouveauClient, ancienHt, ancienClient, alertes, verrou, obsolete,
 * confirmation, erreur, serveur: true } ; null si le serveur n'a rien renvoyé pour cette ligne.
 */
export function lireEvaluation(res, n, cle) {
  const liste = Array.isArray(res) ? res : Array.isArray(res?.associations) ? res.associations : [];
  const e = liste.find((x) => x && typeof x === 'object' && Number(x.n) === Number(n) && (!x.cle || !cle || x.cle === cle));
  if (!e) return null;
  if (e.erreur) {
    const message = String(e.erreur);
    return { serveur: true, erreur: message, alertes: [{ code: 'erreur', message }], nouveauHt: nombreOuNull(e.nouveau_ht) };
  }
  const alertes = (Array.isArray(e.alertes) ? e.alertes : e.alerte ? [e.alerte] : []).filter(Boolean);
  return {
    serveur: true,
    nouveauHt: nombreOuNull(e.nouveau_ht),
    nouveauClient: nombreOuNull(e.nouveau_client),
    ancienHt: nombreOuNull(e.ancien_ht),
    ancienClient: nombreOuNull(e.ancien_client),
    alertes,
    verrou: e.verrou === true,
    obsolete: e.obsolete === true,
    confirmation: typeof e.confirmation_requise === 'boolean'
      ? e.confirmation_requise : alertes.some((a) => ALERTES_A_CONFIRMER.includes(a)),
  };
}

// Valeur de correspondance (nom de colonne, ou index renvoyé par le serveur) → nom de colonne
function nomColonne(valeur, colonnes) {
  if (valeur === null || valeur === undefined || valeur === '') return '';
  if (typeof valeur === 'number') return colonnes[valeur] ?? '';
  return String(valeur);
}

function Tuile({ label, valeur, ton = 'slate', detail }) {
  const tons = {
    slate: 'bg-slate-50 text-slate-900',
    violet: 'bg-brand-50 text-brand-800',
    amber: 'bg-amber-50 text-amber-800',
    red: 'bg-red-50 text-red-800',
  };
  return (
    <div className={`rounded-lg px-3 py-2 ${tons[ton]}`}>
      <div className="text-xs font-medium opacity-80">{label}</div>
      <div className="text-xl font-semibold tabular-nums leading-tight">{valeur}</div>
      {detail && <div className="text-xs font-medium opacity-80">{detail}</div>}
    </div>
  );
}

// Recherche d'une pièce du catalogue pour une ligne non reconnue, puis aperçu « avant → après »
function AssocierLigne({ ligne, options, valeur, onChoisir, apercu, coche, onCocher, absente = false, obsoletes = false }) {
  const [q, setQ] = useState('');
  const id = useId();
  const choisie = valeur ? options.find((o) => o.cle === valeur) : null;
  // Clavier : le bouton cliqué disparaît (pièce choisie, ou retirée) ; le focus passe à l'élément qui le remplace
  const retirerRef = useRef(null);
  const rechercheRef = useRef(null);
  const focusApres = useRef(null); // 'retirer' | 'recherche'
  useEffect(() => {
    const cible = focusApres.current === 'retirer' ? retirerRef.current : focusApres.current === 'recherche' ? rechercheRef.current : null;
    focusApres.current = null;
    cible?.focus();
  }, [choisie]);
  const resultats = useMemo(() => {
    const mots = sansAccents(q).split(/\s+/).filter(Boolean);
    if (!mots.length) return [];
    return options.filter((o) => mots.every((m) => o.recherche.includes(m))).slice(0, 6);
  }, [q, options]);

  if (choisie) {
    const enCours = !!apercu?.enCours;
    const erreur = apercu?.erreur || '';
    const alerte = enCours ? '' : texteAlerte(null, (apercu?.alertes || []).filter((a) => a !== 'verrou' && a?.code !== 'erreur'));
    const verrou = !!choisie.verrou || !!apercu?.verrou;
    const sansPrix = apercu?.nouveauHt == null;
    // Prix actuels : ceux du serveur (lus avec le code admin) à défaut ceux de la grille affichée
    const ancienHt = apercu?.ancienHt !== undefined ? apercu.ancienHt : choisie.ht;
    const ancienClient = apercu?.ancienClient !== undefined ? apercu.ancienClient : choisie.client;
    const ton = erreur ? 'border-red-200 bg-red-50' : enCours || verrou ? 'border-slate-200 bg-slate-50'
      : alerte ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50';
    return (
      <div className={`rounded-lg border p-3 ${ton}`} aria-busy={enCours || undefined}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 min-w-0">
            <Link2 className="w-4 h-4 shrink-0 text-emerald-700" aria-hidden="true" /> {choisie.label}
          </span>
          <button
            ref={retirerRef}
            type="button"
            onClick={() => { focusApres.current = 'recherche'; onChoisir(null); }}
            className="btn-secondary btn-sm ml-auto"
            aria-label={`Retirer l’association de la ligne ${ligne.n}`}
          >
            Retirer
          </button>
        </div>
        {erreur ? (
          <p role="alert" className="mt-1 text-sm font-semibold text-red-800 inline-flex items-start gap-1">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{`Association impossible : ${erreur}`}</span>
          </p>
        ) : (
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm tabular-nums">
            <dt className="text-slate-700">Achat HT</dt>
            <dd>
              <span className="text-slate-600">{euros(ancienHt)}</span> → <strong>{sansPrix ? 'non lu' : euros(apercu.nouveauHt)}</strong>
              {!sansPrix && ancienHt != null && <span className="ml-1 text-slate-700">({variationTexte(ancienHt, apercu.nouveauHt)})</span>}
            </dd>
            <dt className="text-slate-700">Prix client</dt>
            <dd>
              <span className="text-slate-600">{euros(ancienClient)}</span> → <strong>{sansPrix || apercu?.nouveauClient == null ? '—' : euros(apercu.nouveauClient)}</strong>
            </dd>
          </dl>
        )}
        <p className="mt-1 text-xs text-slate-700" aria-live="polite">
          {enCours ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="w-3 h-3 motion-safe:animate-spin" aria-hidden="true" /> Calcul du prix par le serveur…
            </span>
          ) : apercu?.serveur ? (
            !erreur && 'Prix calculé par le serveur avec vos règles.'
          ) : apercu?.repli ? (
            `Aperçu calculé sur ce poste${apercu.repli === true ? '' : ` (${apercu.repli})`}.`
          ) : null}
        </p>
        {alerte && (
          <p className="badge badge-sm badge-warning mt-1 bg-white">
            <AlertTriangle className="w-3 h-3" aria-hidden="true" /> {alerte}
          </p>
        )}
        {apercu?.obsolete && !verrou && !erreur && (
          <p className="mt-1 text-xs text-slate-700">Pièce marquée obsolète : appliquer ce prix la remet dans la grille.</p>
        )}
        {erreur ? null : verrou ? (
          <p className="mt-1 text-xs font-semibold text-slate-700 inline-flex items-center gap-1 ml-1">
            <Lock className="w-3 h-3" aria-hidden="true" /> Pièce verrouillée : son prix ne sera pas modifié.
          </p>
        ) : (
          <label className={`mt-1 flex items-center gap-3 min-h-[44px] text-sm font-semibold text-slate-900 ${enCours ? 'cursor-wait' : 'cursor-pointer'}`}>
            <input
              type="checkbox"
              checked={!!coche}
              disabled={enCours}
              onChange={(e) => onCocher(e.target.checked)}
              className="checkbox"
              aria-label={`Appliquer le prix de la ligne ${ligne.n} à ${choisie.label}`}
            />
            {alerte ? 'Appliquer quand même (j’ai vérifié ce prix)' : 'Appliquer ce prix'}
          </label>
        )}
        {absente && !coche && !enCours && !verrou && (
          // Association non appliquée : la pièce reste « absente du fichier » (obsolète si l'admin le demande)
          <p className={`mt-1 text-xs ${obsoletes ? 'font-semibold text-amber-800' : 'text-slate-700'}`}>
            {obsoletes
              ? 'Non appliquée : cette pièce est absente du fichier et sera marquée obsolète (onglet « Absentes du fichier »).'
              : 'Non appliquée : cette pièce reste dans l’onglet « Absentes du fichier ».'}
          </p>
        )}
      </div>
    );
  }
  return (
    <div>
      <label htmlFor={id} className="sr-only">{`Associer la ligne ${ligne.n} à une pièce`}</label>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" aria-hidden="true" />
        <input
          ref={rechercheRef}
          id={id}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Chercher la pièce (ex. iphone 13 batterie)"
          className="input pl-9"
        />
      </div>
      {q.trim() && (
        <ul className="mt-1 space-y-1" aria-label="Pièces trouvées">
          {resultats.length === 0 && <li className="t-caption px-1 py-2">Aucune pièce trouvée.</li>}
          {resultats.map((o) => (
            <li key={o.cle}>
              <button
                type="button"
                onClick={() => { focusApres.current = 'retirer'; onChoisir(o.cle); setQ(''); }}
                className="w-full min-h-[44px] text-left px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 hover:bg-brand-50 hover:border-brand-300 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ONGLETS = [
  ['reconnues', 'Prix reconnus'],
  ['nouvelles', 'Nouvelles pièces'],
  ['non_reconnues', 'À associer'],
  ['absentes', 'Absentes du fichier'],
];
const FILTRES = [
  ['tout', 'Toutes'],
  ['alertes', 'À vérifier'],
  ['hausses', 'Hausses'],
  ['baisses', 'Baisses'],
  ['decochees', 'Décochées'],
];

export default function ImportPrixModal({ open, onClose, sensible = SANS_ELEVATION, catalogue = CATALOGUE_VIDE, regles = null, onApplique }) {
  const toast = useToast();
  const inputRef = useRef(null);
  const idFichier = useId();
  const [etape, setEtape] = useState('fichier');
  const [fichier, setFichier] = useState(null);
  const [fournisseur, setFournisseur] = useState(lireFournisseur);
  const [cible, setCible] = useState('tarifs');
  const [survol, setSurvol] = useState(false);
  const [erreur, setErreur] = useState('');
  const [occupe, setOccupe] = useState(null); // 'apercu' | 'appliquer' | 'annuler'
  const [apercu, setApercu] = useState(null);
  const [mapping, setMapping] = useState({});
  const [cochees, setCochees] = useState(() => new Set());
  const [nouvellesCochees, setNouvellesCochees] = useState(() => new Set());
  const [associations, setAssociations] = useState({});
  // Choix explicite par ligne associée (n → true | false) ; sans choix : cochée seulement sans alerte
  const [choixAssociations, setChoixAssociations] = useState({});
  // Aperçu chiffré par le serveur de chaque ligne associée : n → { cle, etat: 'encours'|'ok'|'repli', ev, motif }
  const [evaluations, setEvaluations] = useState({});
  const [reglesLues, setReglesLues] = useState(null);
  const [obsoletes, setObsoletes] = useState(false);
  const [ignorerInvalides, setIgnorerInvalides] = useState(false);
  const [onglet, setOnglet] = useState('reconnues');
  const [filtre, setFiltre] = useState('tout');
  const [recherche, setRecherche] = useState('');
  const [page, setPage] = useState(1);
  const [resultat, setResultat] = useState(null);
  const [annule, setAnnule] = useState(false); // false, puis le message de l'annulation ({ ton, texte })
  const [confirmerAnnulation, setConfirmerAnnulation] = useState(false);

  // Réouverture : on repart du début (un import terminé reste annulable depuis l'historique)
  useEffect(() => {
    if (!open) return;
    setEtape('fichier'); setFichier(null); setErreur(''); setApercu(null); setResultat(null);
    setAnnule(false); setConfirmerAnnulation(false); setMapping({}); setAssociations({}); setObsoletes(false);
    setChoixAssociations({}); setIgnorerInvalides(false); setEvaluations({});
  }, [open]);

  // Pièces du catalogue proposées à l'association, avec leur prix actuel (aperçu « avant → après »)
  const options = useMemo(() => {
    if (cible === 'tarifs_apple_devices') {
      return (catalogue.appleDevices || []).flatMap((d) => ['ecran', 'batterie'].map((p) => ({
        cle: `tarifs_apple_devices:${d.id}:${p}`,
        label: `${d.modele} · ${p === 'ecran' ? 'Écran' : 'Batterie'}`,
        table: 'tarifs_apple_devices', categorie: d.categorie, ecran: p === 'ecran',
        // undefined : HT masqué par le serveur (sans le code admin) ; null : pas de prix d'achat
        ht: `${p}_prix_ht` in d ? d[`${p}_prix_ht`] : undefined, client: d[`${p}_prix_vente`] ?? null, verrou: !!d.verrou_manuel,
      }))).map((o) => ({ ...o, recherche: sansAccents(o.label) }));
    }
    return (catalogue.tarifs || []).filter((t) => !t.obsolete).map((t) => {
      const label = `${t.marque} ${t.modele} · ${t.type_piece}${t.qualite ? ` ${t.qualite}` : ''}`;
      return {
        cle: `tarifs:${t.id}`, label, recherche: sansAccents(label), table: 'tarifs',
        type_piece: t.type_piece, categorie: t.categorie, ecran: /ecran|écran/i.test(t.type_piece || ''),
        ht: 'prix_fournisseur_ht' in t ? t.prix_fournisseur_ht : undefined, client: t.prix_client ?? null, verrou: !!t.verrou_manuel,
      };
    });
  }, [cible, catalogue.tarifs, catalogue.appleDevices]);
  const optionsParCle = useMemo(() => new Map(options.map((o) => [o.cle, o])), [options]);
  const reglesEnVigueur = useMemo(() => fusionnerRegles(regles || reglesLues), [regles, reglesLues]);

  function choisirFichier(f) {
    setErreur('');
    if (!f) return;
    if (!extensionValide(f.name)) { setErreur('Format non pris en charge : choisissez un fichier Excel (.xlsx) ou CSV (.csv).'); return; }
    if (f.size > TAILLE_MAX) { setErreur('Fichier trop lourd (5 Mo au maximum).'); return; }
    setFichier(f);
  }

  function initialiserSelection(data) {
    const reconnues = data?.reconnues || [];
    // Une ligne du fichier (n) peut viser plusieurs pièces (« iPhone 12/12 Pro ») : la sélection se fait par ligne.
    // Coche du serveur ; à défaut, toute ligne en alerte reste décochée. Un prix inchangé reste coché :
    // l'appliquer le confirme (daté du jour, il n'est plus « estimé »).
    // Une pièce verrouillée ne compte pas : le serveur l'écarte et applique les autres pièces de la ligne.
    const cocheParDefaut = (l) => (typeof l.coche === 'boolean' ? l.coche : !alerteDe(l));
    const parLigne = new Map();
    for (const l of reconnues) {
      if (l.verrou) continue;
      parLigne.set(l.n, (parLigne.get(l.n) ?? true) && cocheParDefaut(l));
    }
    setCochees(new Set([...parLigne].filter(([, ok]) => ok).map(([n]) => n)));
    setNouvellesCochees(new Set((data?.nouvelles || []).filter((l) => l.coche === true).map((l) => l.n)));
    setAssociations({});
    setChoixAssociations({});
    setEvaluations({});
    setIgnorerInvalides(false);
    setPage(1);
    setFiltre(reconnues.some((l) => alerteDe(l)) ? 'alertes' : 'tout');
    setOnglet(reconnues.length ? 'reconnues' : (data?.non_reconnues || []).length ? 'non_reconnues' : 'nouvelles');
  }

  async function lancerApercu(mappingChoisi) {
    if (!fichier) return;
    setOccupe('apercu');
    setErreur('');
    try {
      const data = await sensible(() => api.apercuImportPrix({ fichier, fournisseur: fournisseur.trim(), cible, mapping: mappingChoisi }));
      retenirFournisseur(fournisseur.trim());
      setApercu(data);
      const colonnes = data?.colonnes || [];
      const m = {};
      for (const [k, v] of Object.entries(data?.mapping || {})) m[k] = nomColonne(v, colonnes);
      setMapping(m);
      initialiserSelection(data);
      setEtape('apercu');
      // Règles en vigueur pour l'aperçu des lignes associées à la main (élévation déjà accordée)
      if (!regles) sensible(() => api.getReglesPrix()).then(setReglesLues).catch(() => {});
    } catch (e) {
      const msg = messageErreurPrix(e, 'Lecture du fichier impossible');
      if (msg) setErreur(msg);
    } finally {
      setOccupe(null);
    }
  }

  const champsMapping = useMemo(() => {
    const connus = CHAMPS_COLONNES.map((c) => c.key);
    const autres = Object.keys(apercu?.mapping || {}).filter((k) => !connus.includes(k));
    return [...CHAMPS_COLONNES, ...autres.map((k) => ({ key: k, label: k }))];
  }, [apercu]);

  const mappingServeur = useMemo(() => {
    const colonnes = apercu?.colonnes || [];
    const m = {};
    for (const [k, v] of Object.entries(apercu?.mapping || {})) m[k] = nomColonne(v, colonnes);
    return m;
  }, [apercu]);
  const mappingModifie = JSON.stringify(Object.entries(mapping).filter(([, v]) => v).sort())
    !== JSON.stringify(Object.entries(mappingServeur).filter(([, v]) => v).sort());
  const mappingIncomplet = !mapping.prix_ht || !(mapping.reference || mapping.designation || mapping.modele);

  const reconnues = apercu?.reconnues || [];
  const nouvelles = apercu?.nouvelles || [];
  const nonReconnues = apercu?.non_reconnues || [];
  const absentes = apercu?.absentes || [];
  const invalides = apercu?.invalides || [];
  const nbAlertes = reconnues.filter((l) => alerteDe(l)).length;
  const nbDecocheesAlerte = reconnues.filter((l) => alerteDe(l) && !l.verrou && !cochees.has(l.n)).length;
  const nbInchanges = reconnues.filter((l) => !change(l)).length;
  // Nombre de pièces visées par chaque ligne du fichier (une ligne « 12/12 Pro » en vise deux)
  const piecesParLigne = useMemo(() => {
    const m = new Map();
    for (const l of reconnues) m.set(l.n, (m.get(l.n) || 0) + 1);
    return m;
  }, [reconnues]);

  const reconnuesVisibles = useMemo(() => {
    const mots = sansAccents(recherche).split(/\s+/).filter(Boolean);
    const liste = reconnues.filter((l) => {
      if (mots.length && !mots.every((m) => sansAccents(`${l.label} ${l.designation || ''}`).includes(m))) return false;
      if (filtre === 'alertes') return !!alerteDe(l);
      if (filtre === 'hausses') return Number(l.nouveau_ht) > Number(l.ancien_ht);
      if (filtre === 'baisses') return Number(l.nouveau_ht) < Number(l.ancien_ht);
      if (filtre === 'decochees') return !l.verrou && !cochees.has(l.n);
      return true;
    });
    // Alertes en haut, puis les plus gros écarts, les prix inchangés à la fin
    return liste.sort((a, b) => {
      const alerteA = alerteDe(a) ? 1 : 0;
      const alerteB = alerteDe(b) ? 1 : 0;
      if (alerteA !== alerteB) return alerteB - alerteA;
      const changeA = change(a) ? 1 : 0;
      const changeB = change(b) ? 1 : 0;
      if (changeA !== changeB) return changeB - changeA;
      return ecartRelatif(b) - ecartRelatif(a);
    });
  }, [reconnues, filtre, recherche, cochees]);

  const pageVisible = reconnuesVisibles.slice(0, page * PAR_PAGE);
  // Aperçu de chaque ligne associée à la main (n → { nouveauHt, nouveauClient, ancienHt?, ancienClient?, alertes, … }) :
  // celui du serveur dès qu'il répond ; en attendant (enCours) ou s'il ne répond pas (repli), le calcul local
  const apercusAssociations = useMemo(() => {
    const out = {};
    for (const l of nonReconnues) {
      const cle = associations[l.n];
      const piece = cle ? optionsParCle.get(cle) : null;
      if (!piece) continue;
      const ev = evaluations[l.n]?.cle === cle ? evaluations[l.n] : null;
      if (ev?.etat === 'ok') out[l.n] = ev.ev;
      else {
        const local = apercuAssociation(l, piece, reglesEnVigueur);
        out[l.n] = ev?.etat === 'encours' ? { ...local, enCours: true } : { ...local, repli: ev?.etat === 'repli' ? (ev.motif || true) : false };
      }
    }
    return out;
  }, [nonReconnues, associations, optionsParCle, reglesEnVigueur, evaluations]);
  // Alertes qui comptent pour la coche (le cadenas est traité à part : jamais appliqué)
  const alertesAssociation = (n) => (apercusAssociations[n]?.alertes || []).filter((a) => a !== 'verrou');
  const associationApplicable = (n) => {
    const cle = associations[n];
    const piece = cle ? optionsParCle.get(cle) : null;
    const ap = apercusAssociations[n];
    return !!piece && !piece.verrou && !ap?.verrou && !ap?.erreur;
  };
  const associationCochee = (n) => {
    if (!associationApplicable(n) || apercusAssociations[n]?.enCours) return false;
    if (typeof choixAssociations[n] === 'boolean') return choixAssociations[n];
    return !alertesAssociation(n).length;
  };
  const associationsAppliquees = Object.entries(associations).filter(([n, cle]) => cle && associationCochee(Number(n)));
  const nbAssociations = associationsAppliquees.length;
  const nbAssociationsAlerte = Object.entries(associations)
    .filter(([n, cle]) => cle && associationApplicable(Number(n)) && !apercusAssociations[n]?.enCours
      && alertesAssociation(Number(n)).length && !associationCochee(Number(n))).length;
  const nbEvaluationsEnCours = Object.entries(associations)
    .filter(([n, cle]) => cle && apercusAssociations[n]?.enCours).length;
  // Absentes : une pièce associée (cochée) à une ligne du fichier n'est plus absente — le serveur ne la
  // marque jamais obsolète ; la liste, les compteurs et « Marquer comme obsolètes » le reflètent
  const absentesVues = absentesApresAssociations(absentes, associationsAppliquees.map(([, cle]) => cle));
  const absentesVisibles = absentesVues.visibles;
  const absentesAMarquer = absentesVues.aMarquer;
  const nbAbsentesVerrou = absentesVisibles.length - absentesAMarquer.length;
  const lignesAbsentes = useMemo(() => new Set(absentes.map((a) => ligneDeCle(a.cle))), [absentes]);
  const marquerObsoletes = obsoletes && absentesAMarquer.length > 0;

  // Pièce choisie pour une ligne « À associer » : aperçu chiffré et alertes demandés au serveur (rien n'est écrit)
  async function evaluerAssociation(n, cle) {
    if (!cle || !apercu?.import_id || typeof api.evaluerAssociationsImport !== 'function') return;
    const importId = apercu.import_id;
    setEvaluations((e) => ({ ...e, [n]: { cle, etat: 'encours' } }));
    let suite;
    try {
      const res = await sensible(() => api.evaluerAssociationsImport(importId, [{ n: Number(n), cle }]));
      const ev = lireEvaluation(res, n, cle);
      suite = ev ? { cle, etat: 'ok', ev } : { cle, etat: 'repli' };
    } catch (err) {
      // Serveur sans cette route (404) ou identification annulée : calcul local, sans message bloquant
      const motif = err?.code === 'admin_cancelled' || err?.status === 404 ? null : (messageErreurPrix(err, 'Vérification impossible') || null);
      suite = { cle, etat: 'repli', motif };
    }
    // Réponse tardive d'une pièce remplacée entre-temps : ignorée
    setEvaluations((e) => (e[n]?.cle === cle && e[n]?.etat === 'encours' ? { ...e, [n]: suite } : e));
  }

  function associer(n, cle) {
    setAssociations((a) => ({ ...a, [n]: cle }));
    // Nouvelle pièce choisie : la coche repart de l'aperçu (sans alerte = cochée)
    setChoixAssociations((c) => { const s = { ...c }; delete s[n]; return s; });
    if (cle) evaluerAssociation(n, cle);
    else setEvaluations((e) => { const s = { ...e }; delete s[n]; return s; });
  }

  const nbConfirmes = useMemo(() => {
    const changees = new Set(reconnues.filter((l) => change(l)).map((l) => l.n));
    return [...cochees].filter((n) => !changees.has(n)).length;
  }, [reconnues, cochees]);
  const totalApplique = cochees.size + nouvellesCochees.size + nbAssociations + (marquerObsoletes ? absentesAMarquer.length : 0);
  const bloqueParInvalides = invalides.length > 0 && !ignorerInvalides;

  const basculer = (setter, n) => setter((prev) => {
    const s = new Set(prev);
    if (s.has(n)) s.delete(n); else s.add(n);
    return s;
  });
  function cocherVisibles(oui) {
    setCochees((prev) => {
      const s = new Set(prev);
      for (const l of reconnuesVisibles) {
        if (l.verrou) continue;
        if (oui) s.add(l.n); else s.delete(l.n);
      }
      return s;
    });
  }

  async function appliquer() {
    setOccupe('appliquer');
    try {
      // Association cochée malgré une alerte (grosse variation, marge) : confirmée explicitement, sinon
      // le serveur l'écarte (associations_ignorees)
      const confirmees = associationsAppliquees.map(([n]) => Number(n)).filter((n) => alertesAssociation(n).length > 0);
      const body = {
        lignes: [...cochees],
        associations: associationsAppliquees.map(([n, cle]) => ({ n: Number(n), cle })),
        nouvelles: [...nouvellesCochees],
        marquer_obsoletes: marquerObsoletes,
        ignorer_invalides: !!ignorerInvalides,
        ...(confirmees.length ? { confirmees } : {}),
      };
      const res = await sensible(() => api.appliquerImportPrix(apercu.import_id, body));
      setResultat(res || {});
      setEtape('termine');
      toast.success(`Import appliqué : ${Number(res?.modifies) || 0} prix mis à jour.`);
      onApplique?.(res);
    } catch (e) {
      const msg = messageErreurPrix(e, 'Import non appliqué (aucun prix modifié)');
      if (msg) { setErreur(msg); toast.error(msg); }
    } finally {
      setOccupe(null);
    }
  }

  async function annulerImport() {
    if (!resultat?.lot_id) return;
    setOccupe('annuler');
    try {
      const res = await sensible(() => api.annulerLotPrix(resultat.lot_id));
      // Prix modifiés depuis l'import ou lignes verrouillées depuis : laissés tels quels, et dits
      const m = messageAnnulation(res, { sujet: 'Import annulé' });
      setAnnule(m);
      setConfirmerAnnulation(false);
      if (m.ton === 'warning') toast.warning(m.texte); else toast.success(m.texte);
      onApplique?.();
    } catch (e) {
      const msg = messageErreurPrix(e, 'Annulation impossible');
      if (msg) toast.error(msg);
    } finally {
      setOccupe(null);
    }
  }

  const bouton = 'btn-secondary';
  const boutonSecondaire = 'btn-secondary';
  const boutonPrincipal = 'btn-primary';

  // ─── Pied de fenêtre selon l'étape ───
  let pied = null;
  if (etape === 'fichier') {
    pied = (
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <p className="text-sm text-slate-500 sm:mr-auto">Rien n’est modifié à cette étape : vous verrez d’abord un aperçu.</p>
        <button type="button" onClick={() => lancerApercu()} disabled={!fichier || !fournisseur.trim() || !!occupe} className={boutonPrincipal}>
          {occupe === 'apercu' && <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />}
          Lire le fichier
        </button>
      </div>
    );
  } else if (etape === 'apercu') {
    pied = (
      <div className="flex flex-col lg:flex-row lg:items-center gap-2">
        <p className="text-sm text-slate-700 lg:mr-auto" aria-live="polite">
          À appliquer : <strong>{cochees.size}</strong> prix{nbConfirmes > 0 && <> (dont {nbConfirmes} inchangé{nbConfirmes > 1 ? 's' : ''}, daté{nbConfirmes > 1 ? 's' : ''} du jour)</>}, <strong>{nouvellesCochees.size}</strong> nouvelle{nouvellesCochees.size > 1 ? 's' : ''} pièce{nouvellesCochees.size > 1 ? 's' : ''},
          {' '}<strong>{nbAssociations}</strong> association{nbAssociations > 1 ? 's' : ''}{nbAssociationsAlerte > 0 && <> ({nbAssociationsAlerte} à vérifier, non cochée{nbAssociationsAlerte > 1 ? 's' : ''})</>}{nbEvaluationsEnCours > 0 && <> ({nbEvaluationsEnCours} en cours de calcul)</>}{marquerObsoletes ? <>, <strong>{absentesAMarquer.length}</strong> obsolète{absentesAMarquer.length > 1 ? 's' : ''}</> : null}.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => { setEtape('fichier'); setErreur(''); }} disabled={!!occupe} className={`${boutonSecondaire} flex-1 lg:flex-none`}>
            Changer de fichier
          </button>
          <button type="button" onClick={appliquer} disabled={!totalApplique || !!occupe || mappingModifie || bloqueParInvalides || nbEvaluationsEnCours > 0} className={`${boutonPrincipal} flex-1 lg:flex-none`}>
            {occupe === 'appliquer' && <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />}
            Appliquer
          </button>
        </div>
      </div>
    );
  } else {
    pied = (
      <div className="flex justify-end">
        <button type="button" onClick={onClose} disabled={!!occupe} className={boutonPrincipal}>Fermer</button>
      </div>
    );
  }

  return (
    <FenetrePrix
      open={open}
      onClose={onClose}
      titre="Importer une liste de prix"
      sousTitre="Fichier Excel ou CSV de votre fournisseur : aperçu « avant → après », puis vous choisissez ce qui s’applique."
      icone={FileSpreadsheet}
      largeur="max-w-6xl"
      pied={pied}
      bloquer={occupe === 'appliquer' || occupe === 'annuler'}
    >
      {erreur && (
        <div role="alert" className="callout callout-danger mb-4 items-start">
          <AlertTriangle aria-hidden="true" />
          <span className="flex-1 whitespace-pre-line">{erreur}</span>
          <button type="button" onClick={() => setErreur('')} aria-label="Masquer le message" className="btn-ghost btn-icon shrink-0 -my-2 -mr-2 text-red-700 hover:bg-red-100 hover:text-red-800">
            <X aria-hidden="true" />
          </button>
        </div>
      )}

      {etape === 'fichier' && (
        <div className="space-y-5">
          <div
            onDragOver={(e) => { e.preventDefault(); setSurvol(true); }}
            onDragLeave={() => setSurvol(false)}
            onDrop={(e) => { e.preventDefault(); setSurvol(false); choisirFichier(e.dataTransfer?.files?.[0]); }}
            className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors duration-150 ${survol ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-slate-50'}`}
          >
            <Upload className="w-8 h-8 mx-auto text-brand-600" aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold text-slate-900">Déposez le fichier ici</p>
            <p className="t-caption">Excel (.xlsx) ou CSV (séparateur ; ou ,), 5 Mo au maximum</p>
            <input
              ref={inputRef}
              id={idFichier}
              type="file"
              accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(e) => { choisirFichier(e.target.files?.[0]); e.target.value = ''; }}
            />
            <label htmlFor={idFichier} className={`${boutonSecondaire} mt-3 cursor-pointer`}>
              Choisir un fichier
            </label>
            {fichier && (
              <p className="mt-3 text-sm text-slate-900" role="status">
                <FileSpreadsheet className="inline w-4 h-4 mr-1 text-emerald-700" aria-hidden="true" />
                <strong>{fichier.name}</strong> ({Math.max(1, Math.round(fichier.size / 1024))} Ko)
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="import-fournisseur" className="input-label">Fournisseur</label>
              <input
                id="import-fournisseur"
                type="text"
                list="import-fournisseurs"
                value={fournisseur}
                onChange={(e) => setFournisseur(e.target.value)}
                className="input"
              />
              <datalist id="import-fournisseurs">
                <option value="Mobilax" />
                <option value="Utopya" />
              </datalist>
              <p className="input-help">La correspondance des colonnes est retenue pour ce fournisseur.</p>
            </div>
            <fieldset>
              <legend className="input-label">Le fichier contient</legend>
              <div className="flex flex-wrap gap-2">
                {[['tarifs', 'Pièces téléphones'], ['tarifs_apple_devices', 'Pièces iPad / MacBook']].map(([v, l]) => (
                  <label key={v} className={`choice ${cible === v ? 'border-brand-300 bg-brand-50 text-brand-800' : ''}`}>
                    <input type="radio" name="import-cible" value={v} checked={cible === v} onChange={() => setCible(v)} className="radio" />
                    {l}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </div>
      )}

      {etape === 'apercu' && apercu && (
        <div>
          <p className="text-sm text-slate-700 mb-3">
            <FileSpreadsheet className="inline w-4 h-4 mr-1 text-emerald-700" aria-hidden="true" />
            <strong>{fichier?.name}</strong> · {fournisseur} · {cible === 'tarifs' ? 'pièces téléphones' : 'iPad / MacBook'}
            {apercu.resume?.lignes != null && <> · {apercu.resume.lignes} lignes lues</>}
          </p>

          <details open={mappingIncomplet || mappingModifie} className="group mb-4 rounded-lg border border-slate-200 p-4">
            <summary className="cursor-pointer min-h-[44px] flex items-center gap-1.5 t-h3 text-slate-900 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"><ChevronRight className="w-4 h-4 text-slate-400 transition-transform duration-150 group-open:rotate-90" aria-hidden="true" />
              Correspondance des colonnes {mappingIncomplet ? '— à compléter' : '— reconnue'}
            </summary>
            <p className="t-caption mb-3">Indiquez quelle colonne du fichier contient chaque information. Ce choix sera retenu pour « {fournisseur} » à l’application.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {champsMapping.map((c) => (
                <div key={c.key}>
                  <label htmlFor={`map-${c.key}`} className="input-label">
                    {c.label}{c.requis && <span aria-hidden="true"> *</span>}{c.requis && <span className="sr-only"> (obligatoire)</span>}
                  </label>
                  <select
                    id={`map-${c.key}`}
                    value={mapping[c.key] || ''}
                    onChange={(e) => setMapping((m) => ({ ...m, [c.key]: e.target.value }))}
                    className="select"
                  >
                    <option value="">— aucune —</option>
                    {(apercu.colonnes || []).map((col) => <option key={col} value={col}>{col}</option>)}
                  </select>
                </div>
              ))}
            </div>
            {(mappingModifie || mappingIncomplet) && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => lancerApercu(Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)))}
                  disabled={!!occupe || !mapping.prix_ht}
                  className={boutonPrincipal}
                >
                  {occupe === 'apercu' && <Loader2 className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />}
                  Relire avec ces colonnes
                </button>
                {mappingModifie && <span className="text-sm font-medium text-amber-800">Relisez le fichier avant d’appliquer.</span>}
              </div>
            )}
          </details>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
            <Tuile label="Prix reconnus" valeur={reconnues.length} ton="violet" detail={nbInchanges ? `${nbInchanges} inchangé${nbInchanges > 1 ? 's' : ''} (confirmé${nbInchanges > 1 ? 's' : ''})` : null} />
            <Tuile label="À vérifier" valeur={nbAlertes} ton={nbAlertes ? 'amber' : 'slate'} detail={nbDecocheesAlerte ? `${nbDecocheesAlerte} décoché${nbDecocheesAlerte > 1 ? 's' : ''}` : null} />
            <Tuile label="Nouvelles pièces" valeur={nouvelles.length} />
            <Tuile label="À associer" valeur={nonReconnues.length} ton={nonReconnues.length ? 'amber' : 'slate'} detail={absentesVisibles.length ? `${absentesVisibles.length} absente${absentesVisibles.length > 1 ? 's' : ''} du fichier` : null} />
          </div>

          {invalides.length > 0 && (
            <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <p className="font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                {invalides.length} ligne{invalides.length > 1 ? 's' : ''} illisible{invalides.length > 1 ? 's' : ''} dans le fichier : rien n’est appliqué tant qu’elles y sont.
              </p>
              <ul className="mt-1 ml-6 list-disc">
                {invalides.slice(0, 5).map((l) => (
                  <li key={l.n}>Ligne {l.n} : {l.raison || 'illisible'}{l.brut ? ` — ${texteBrut(l.brut).slice(0, 80)}` : ''}</li>
                ))}
                {invalides.length > 5 && <li>… et {invalides.length - 5} autres</li>}
              </ul>
              <label className="mt-2 flex items-center gap-3 min-h-[44px] cursor-pointer font-semibold">
                <input type="checkbox" checked={ignorerInvalides} onChange={(e) => setIgnorerInvalides(e.target.checked)} className="checkbox accent-red-700" />
                Appliquer quand même, sans ces lignes
              </label>
            </div>
          )}

          {nbAlertes > 0 && (
            <div role="note" className="callout callout-warning mb-4">
              <AlertTriangle aria-hidden="true" />
              <span>
                <strong>{nbAlertes} prix à vérifier</strong> (grosse variation, marge trop faible, ligne en double…)
                {nbDecocheesAlerte > 0 && <>, dont <strong>{nbDecocheesAlerte}</strong> décoché{nbDecocheesAlerte > 1 ? 's' : ''} par défaut</>}.
                Cochez-les un par un si le nouveau prix est juste.
              </span>
            </div>
          )}

          <div role="tablist" aria-label="Contenu du fichier" className="page-tabs mb-3">
            {ONGLETS.map(([v, l]) => {
              const n = { reconnues: reconnues.length, nouvelles: nouvelles.length, non_reconnues: nonReconnues.length, absentes: absentesVisibles.length }[v];
              return (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  id={`import-onglet-${v}`}
                  aria-selected={onglet === v}
                  aria-controls={`import-panneau-${v}`}
                  tabIndex={onglet === v ? 0 : -1}
                  onClick={() => setOnglet(v)}
                  onKeyDown={(e) => clavierOnglets(e, ONGLETS.map(([c]) => c), onglet, setOnglet)}
                  className={`page-tab ${onglet === v ? 'page-tab-active' : ''}`}
                >
                  {l} ({n})
                </button>
              );
            })}
          </div>

          <div role="tabpanel" id={`import-panneau-${onglet}`} aria-labelledby={`import-onglet-${onglet}`}>
            {onglet === 'reconnues' && (
              <div>
                <div className="flex flex-col lg:flex-row lg:items-center gap-2 mb-3">
                  <div role="group" aria-label="Filtrer les prix" className="segmented">
                    {FILTRES.map(([v, l]) => (
                      <button
                        key={v}
                        type="button"
                        aria-pressed={filtre === v}
                        onClick={() => { setFiltre(v); setPage(1); }}
                        className={`segmented-item ${filtre === v ? 'segmented-item-active' : ''}`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                  <div className="relative lg:ml-auto lg:w-64">
                    <label htmlFor="import-recherche" className="sr-only">Rechercher une pièce dans l’aperçu</label>
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" aria-hidden="true" />
                    <input
                      id="import-recherche"
                      type="search"
                      value={recherche}
                      onChange={(e) => { setRecherche(e.target.value); setPage(1); }}
                      placeholder="Rechercher…"
                      className="input pl-9"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mb-2">
                  <button type="button" onClick={() => cocherVisibles(true)} className="btn-secondary btn-sm">Tout cocher</button>
                  <button type="button" onClick={() => cocherVisibles(false)} className="btn-secondary btn-sm">Tout décocher</button>
                  <span className="self-center text-sm text-slate-500">{reconnuesVisibles.length} ligne{reconnuesVisibles.length > 1 ? 's' : ''} affichée{reconnuesVisibles.length > 1 ? 's' : ''}</span>
                </div>
                <div className="table-wrap scroll-fade-x">
                  <table className="table table-dense min-w-[720px]">
                    <caption className="sr-only">Prix reconnus : cochez ceux à appliquer</caption>
                    <thead className="bg-slate-50">
                      <tr>
                        <th scope="col" className="table-header w-14"><span className="sr-only">Appliquer</span></th>
                        <th scope="col" className="table-header">Pièce</th>
                        <th scope="col" className="table-header text-right">Achat HT</th>
                        <th scope="col" className="table-header text-right">Prix client</th>
                        <th scope="col" className="table-header text-right">Écart</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageVisible.length === 0 && (
                        <tr><td colSpan={5} className="py-8 text-center text-slate-500">Aucune ligne pour ce filtre.</td></tr>
                      )}
                      {pageVisible.map((l) => {
                        const alerte = alerteDe(l);
                        const verrou = !!l.verrou;
                        const modifie = change(l);
                        const coche = cochees.has(l.n);
                        const multiple = (piecesParLigne.get(l.n) || 0) > 1;
                        return (
                          <tr key={cleLigne(l)} className={`table-row ${alerte ? 'bg-amber-50 hover:bg-amber-50' : ''} ${!modifie ? 'text-slate-500' : ''}`}>
                            <td className="!px-1 !py-1 text-center">
                              <label className="inline-flex items-center justify-center w-11 h-11 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={coche && !verrou}
                                  disabled={!!verrou}
                                  onChange={() => basculer(setCochees, l.n)}
                                  aria-label={`Appliquer le nouveau prix de ${l.label}`}
                                  className="checkbox"
                                />
                              </label>
                            </td>
                            <td>
                              <span className="font-medium text-slate-900">{l.label || l.cle}</span>
                              {l.designation && <span className="block t-caption truncate max-w-[360px]" title={l.designation}>Ligne {l.n} : {l.designation}</span>}
                              <span className="flex flex-wrap gap-1 mt-0.5">
                                {multiple && <span className="text-xs text-slate-700">(même ligne du fichier que d’autres pièces)</span>}
                                {alerte && (
                                  <span className="badge badge-sm badge-warning bg-white">
                                    <AlertTriangle className="w-3 h-3" aria-hidden="true" /> {alerte}
                                  </span>
                                )}
                                {verrou && (
                                  <span className="badge badge-sm badge-neutral">
                                    <Lock className="w-3 h-3" aria-hidden="true" /> ne sera pas modifié
                                  </span>
                                )}
                                {!modifie && <span className="text-xs">inchangé{!verrou ? ' : coché, il sera daté du jour' : ''}</span>}
                              </span>
                            </td>
                            <td className="text-right tabular-nums whitespace-nowrap">
                              <span className="text-slate-500">{euros(l.ancien_ht)}</span> → <strong className="text-slate-900">{euros(l.nouveau_ht)}</strong>
                            </td>
                            <td className="text-right tabular-nums whitespace-nowrap">
                              <span className="text-slate-500">{euros(l.ancien_client)}</span> → <strong className="text-slate-900">{euros(l.nouveau_client)}</strong>
                            </td>
                            <td className="text-right tabular-nums whitespace-nowrap">{modifie ? variationTexte(l.ancien_ht, l.nouveau_ht) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {reconnuesVisibles.length > pageVisible.length && (
                  <div className="mt-3 text-center">
                    <button type="button" onClick={() => setPage((p) => p + 1)} className="btn-secondary">
                      Afficher {Math.min(PAR_PAGE, reconnuesVisibles.length - pageVisible.length)} lignes de plus
                    </button>
                  </div>
                )}
              </div>
            )}

            {onglet === 'nouvelles' && (
              <div>
                <p className="text-sm text-slate-700 mb-2">Pièces du fichier absentes de votre grille. Cochez celles à ajouter (prix client calculé avec vos règles).</p>
                {nouvelles.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">Aucune nouvelle pièce.</p> : (
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {nouvelles.map((l) => (
                      <li key={l.n} className="flex items-center gap-2 px-2 py-1 min-h-12">
                        <label className="inline-flex items-center justify-center w-11 h-11 cursor-pointer shrink-0">
                          <input type="checkbox" checked={nouvellesCochees.has(l.n)} onChange={() => basculer(setNouvellesCochees, l.n)}
                            aria-label={`Ajouter ${libelleNouvelle(l)}`} className="checkbox" />
                        </label>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium text-slate-900">{libelleNouvelle(l)}</span>
                          {l.designation && <span className="block t-caption truncate">Ligne {l.n} : {texteBrut(l.designation)}</span>}
                          {alerteDe(l) && <span className="text-xs font-semibold text-amber-800">{alerteDe(l)}</span>}
                        </span>
                        <span className="text-sm tabular-nums text-right whitespace-nowrap">
                          {euros(l.nouveau_ht)} HT → <strong className="text-slate-900">{euros(l.nouveau_client)}</strong>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {onglet === 'non_reconnues' && (
              <div>
                <p className="text-sm text-slate-700 mb-2">
                  Lignes que le logiciel n’a pas su relier à une pièce. Associez-les à la main, ou laissez-les : elles seront ignorées.
                </p>
                {nonReconnues.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">Toutes les lignes ont été reconnues.</p> : (
                  <ul className="space-y-2">
                    {nonReconnues.map((l) => (
                      <li key={l.n} className="card p-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <div className="text-sm">
                          <span className="t-caption">Ligne {l.n}{l.raison ? ` · ${l.raison}` : ''}</span>
                          <span className="block text-slate-900 break-words">{texteBrut(l.brut) || '—'}</span>
                          {(() => {
                            // Prix lu dans le fichier (nouveau_ht de l'aperçu, à défaut celui de l'évaluation)
                            const ev = evaluations[l.n]?.etat === 'ok' ? evaluations[l.n].ev : null;
                            const ht = htDuFichier(l) ?? ev?.nouveauHt ?? null;
                            return ht != null
                              ? <span className="block text-slate-700 tabular-nums">Prix du fichier : <strong>{euros(ht)} HT</strong></span>
                              : <span className="block text-amber-800">Prix du fichier : <strong>non lu</strong></span>;
                          })()}
                        </div>
                        <AssocierLigne
                          ligne={l}
                          options={options}
                          valeur={associations[l.n]}
                          onChoisir={(cle) => associer(l.n, cle)}
                          apercu={apercusAssociations[l.n]}
                          coche={associationCochee(l.n)}
                          onCocher={(oui) => setChoixAssociations((c) => ({ ...c, [l.n]: oui }))}
                          absente={!!associations[l.n] && lignesAbsentes.has(ligneDeCle(associations[l.n]))}
                          obsoletes={obsoletes}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {onglet === 'absentes' && (
              <div>
                <p className="text-sm text-slate-700 mb-2">Pièces de votre grille qui ne figurent pas dans ce fichier. Elles ne sont jamais supprimées.</p>
                {absentesVues.retirees > 0 && (
                  <p role="note" className="mb-2 text-sm text-slate-700 flex items-start gap-1.5">
                    <Link2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-700" aria-hidden="true" />
                    <span>
                      {absentesVues.retirees > 1
                        ? `${absentesVues.retirees} pièces associées à une ligne du fichier (onglet « À associer ») : retirées de cette liste, elles ne seront pas marquées obsolètes.`
                        : '1 pièce associée à une ligne du fichier (onglet « À associer ») : retirée de cette liste, elle ne sera pas marquée obsolète.'}
                    </span>
                  </p>
                )}
                {absentesAMarquer.length > 0 && (
                  <label className="card-section mb-3 flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={obsoletes} onChange={(e) => setObsoletes(e.target.checked)} className="checkbox mt-0.5" />
                    <span className="text-sm">
                      <strong>{absentesAMarquer.length > 1 ? `Marquer ces ${absentesAMarquer.length} pièces comme obsolètes` : 'Marquer cette pièce comme obsolète'}</strong>
                      <span className="block text-slate-700">
                        {absentesAMarquer.length > 1 ? 'Elles ne seront plus proposées' : 'Elle ne sera plus proposée'} sur les tickets. Rien n’est supprimé et l’import reste annulable.
                        {nbAbsentesVerrou > 0 && ` ${nbAbsentesVerrou > 1 ? `Les ${nbAbsentesVerrou} pièces verrouillées restent` : 'La pièce verrouillée reste'} dans la grille.`}
                      </span>
                    </span>
                  </label>
                )}
                {absentesVisibles.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500">
                    {absentes.length ? 'Les pièces absentes du fichier sont toutes associées à une ligne : aucune ne sera marquée obsolète.' : 'Toutes vos pièces sont dans le fichier.'}
                  </p>
                ) : (
                  <ul className="columns-1 sm:columns-2 gap-4 text-sm text-slate-800">
                    {absentesVisibles.slice(0, 300).map((a) => (
                      <li key={a.cle} className="py-1 break-inside-avoid">
                        {a.label || a.cle}
                        {a.verrou && (
                          <span className="ml-1 inline-flex items-center gap-1 text-xs font-semibold text-slate-700">
                            <Lock className="w-3 h-3" aria-hidden="true" /> verrouillée : gardée
                          </span>
                        )}
                      </li>
                    ))}
                    {absentesVisibles.length > 300 && <li className="py-1 text-slate-500">… et {absentesVisibles.length - 300} autres</li>}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {etape === 'termine' && resultat && (
        <div className="py-4">
          <div role="status" className={`rounded-lg border px-4 py-3 text-sm ${annule?.ton === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800' : annule ? 'border-slate-200 bg-slate-50 text-slate-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
            <p className="font-bold flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
              {annule ? (annule.ton === 'warning' ? annule.texte : 'Import annulé : les prix sont revenus à leur valeur d’avant.') : 'Import appliqué.'}
            </p>
            {!annule && (
              <ul className="mt-2 text-sm space-y-0.5">
                <li><strong>{Number(resultat.modifies) || 0}</strong> prix mis à jour</li>
                {Number(resultat.confirmes) > 0 && <li><strong>{resultat.confirmes}</strong> prix inchangé{resultat.confirmes > 1 ? 's' : ''}, confirmé{resultat.confirmes > 1 ? 's' : ''} à la date du jour</li>}
                <li><strong>{Number(resultat.ajoutes) || 0}</strong> pièce{Number(resultat.ajoutes) > 1 ? 's' : ''} ajoutée{Number(resultat.ajoutes) > 1 ? 's' : ''}</li>
                {Number(resultat.obsoletes) > 0 && <li><strong>{resultat.obsoletes}</strong> pièce{resultat.obsoletes > 1 ? 's' : ''} marquée{resultat.obsoletes > 1 ? 's' : ''} obsolète{resultat.obsoletes > 1 ? 's' : ''}</li>}
                {Number(resultat.verrouilles) > 0 && <li><strong>{resultat.verrouilles}</strong> prix verrouillé{resultat.verrouilles > 1 ? 's' : ''}, non modifié{resultat.verrouilles > 1 ? 's' : ''}</li>}
                {Array.isArray(resultat.associations_ignorees) && resultat.associations_ignorees.length > 0 && (
                  <li className="text-amber-800">
                    <strong>{resultat.associations_ignorees.length}</strong> association{resultat.associations_ignorees.length > 1 ? 's' : ''} non appliquée{resultat.associations_ignorees.length > 1 ? 's' : ''} (à vérifier, non confirmée{resultat.associations_ignorees.length > 1 ? 's' : ''}) :
                    {' '}{resultat.associations_ignorees.slice(0, 5).map((a) => `ligne ${a.n} → ${a.label || a.cle}${alerteDe(a) ? ` (${alerteDe(a)})` : ''}`).join(' ; ')}
                    {resultat.associations_ignorees.length > 5 && ` … et ${resultat.associations_ignorees.length - 5} autres`}
                  </li>
                )}
                <li>Les tickets déjà créés gardent leur prix.</li>
              </ul>
            )}
          </div>
          {!annule && resultat.lot_id && (
            <div className="mt-4">
              {!confirmerAnnulation ? (
                <button type="button" onClick={() => setConfirmerAnnulation(true)} className={boutonSecondaire}>
                  <Undo2 className="w-4 h-4" aria-hidden="true" /> Annuler cet import
                </button>
              ) : (
                <div role="alertdialog" aria-label="Confirmer l’annulation de l’import" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <p className="font-semibold">Remettre tous les prix de cet import à leur valeur d’avant ?</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => setConfirmerAnnulation(false)} disabled={occupe === 'annuler'} className="btn-ghost">Non, garder</button>
                    <button type="button" onClick={annulerImport} disabled={occupe === 'annuler'} className="btn-primary">
                      {occupe === 'annuler' && <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />}
                      Oui, annuler l’import
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </FenetrePrix>
  );
}
