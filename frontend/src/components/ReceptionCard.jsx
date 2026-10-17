import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  ClipboardCheck, ChevronDown, RotateCcw, AlertTriangle, CheckCircle2, ScanLine, PowerOff, HardDriveDownload, ListChecks,
  Check, X, Circle,
} from 'lucide-react';
import api from '../lib/api';
import { useAutoSave } from '../hooks/useAutoSave';
import { luhnOk } from '../lib/scan';
import { formatDate } from '../lib/utils';

// ─── Modèle (contrat GET/PUT /api/tickets/{id}/reception) ─────────
export const ACCESSOIRES = [
  ['chargeur', 'Chargeur'], ['cable', 'Câble'], ['coque', 'Coque'], ['protection', 'Protection d’écran'],
  ['carte_sim', 'Carte SIM'], ['carte_sd', 'Carte SD'], ['boite', 'Boîte'], ['stylet', 'Stylet'], ['autre', 'Autre'],
];
const ETAT_FACE = [['ok', 'OK'], ['raye', 'Rayé'], ['fissure', 'Fissuré'], ['casse', 'Cassé']];
export const ETATS = [
  ['ecran', 'Écran', ETAT_FACE],
  ['dos', 'Dos', ETAT_FACE],
  ['chassis', 'Châssis', [['ok', 'OK'], ['raye', 'Rayé'], ['choc', 'Choc'], ['tordu', 'Tordu']]],
];
export const TESTS = [
  ['allume', 'S’allume'], ['tactile', 'Tactile'], ['face_touch_id', 'Face ID / Touch ID'],
  ['camera_avant', 'Caméra avant'], ['camera_arriere', 'Caméra arrière'], ['micro', 'Micro'],
  ['haut_parleur', 'Haut-parleur'], ['ecouteur', 'Écouteur'], ['charge', 'Charge'],
  ['wifi', 'Wi-Fi'], ['reseau', 'Réseau / SIM'], ['boutons', 'Boutons'],
];
const CLES_ACCESSOIRES = new Set(ACCESSOIRES.map(([k]) => k));

/** Fiche neuve : TOUT décoché — aucun accessoire, aucun état présélectionné, aucun test fait. */
export function itemsVides() {
  return {
    accessoires: [],
    accessoires_autre: '',
    etat: { ecran: null, dos: null, chassis: null, notes: '' },
    tests: Object.fromEntries(TESTS.map(([k]) => [k, null])),
    imei_verifie: null,
    appareil_eteint: false,
    sauvegarde_conseillee: false,
  };
}

const objet = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
// Partie non renseignée : null (aucun choix), jamais « OK » d'office
const parmi = (v, options) => (options.some(([k]) => k === v) ? v : null);

/** Items reçus du serveur → forme complète et valide (les clés inconnues sont gardées telles quelles). */
export function normaliserItems(brut) {
  const b = objet(brut);
  const etat = objet(b.etat);
  const tests = objet(b.tests);
  return {
    ...b,
    accessoires: [...new Set((Array.isArray(b.accessoires) ? b.accessoires : []).filter(a => CLES_ACCESSOIRES.has(a)))],
    accessoires_autre: typeof b.accessoires_autre === 'string' ? b.accessoires_autre : '',
    etat: {
      ...etat,
      ...Object.fromEntries(ETATS.map(([k, , options]) => [k, parmi(etat[k], options)])),
      notes: typeof etat.notes === 'string' ? etat.notes : '',
    },
    tests: { ...tests, ...Object.fromEntries(TESTS.map(([k]) => [k, tests[k] === true ? true : tests[k] === false ? false : null])) },
    imei_verifie: typeof b.imei_verifie === 'string' && b.imei_verifie.trim() ? b.imei_verifie.trim() : null,
    appareil_eteint: b.appareil_eteint === true,
    sauvegarde_conseillee: b.sauvegarde_conseillee === true,
  };
}

/** Espaces, tirets, points et barres retirés, majuscules (même nettoyage que le serveur). */
export function identifiantPropre(valeur) {
  return String(valeur ?? '').replace(/[\s\-./]+/g, '').toUpperCase();
}

/**
 * IMEI (15 chiffres, clé de Luhn) ou numéro de série (tablette, montre sans IMEI : lettres et
 * chiffres, 8 à 20 caractères). Une suite de chiffres seule doit être un IMEI valide.
 */
export function imeiValide(valeur) {
  const s = identifiantPropre(valeur);
  if (/^\d+$/.test(s)) return s.length === 15 && luhnOk(s);
  return /^[A-Z0-9]{8,20}$/.test(s) && /[A-Z]/.test(s);
}

const libelle = (liste, cle) => liste.find(([k]) => k === cle)?.[1] ?? cle;

/** Résumé structuré (mêmes informations que l'encadré imprimé). */
export function resumeReception(items) {
  const it = normaliserItems(items);
  const accessoires = it.accessoires.map(a => (a === 'autre' && it.accessoires_autre.trim() ? it.accessoires_autre.trim() : libelle(ACCESSOIRES, a)));
  const etat = ETATS.map(([k, nom, options]) => ({
    cle: k, nom, valeur: it.etat[k] ? libelle(options, it.etat[k]) : 'non renseigné', ok: it.etat[k] === 'ok',
  }));
  const ko = TESTS.filter(([k]) => it.tests[k] === false).map(([, nom]) => nom);
  const nonTestes = TESTS.filter(([k]) => it.tests[k] === null).length;
  return { accessoires, etat, ko, nonTestes, notes: it.etat.notes.trim(), imei: it.imei_verifie };
}

const minuscule = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const majuscule = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Résumé d'une ligne pour l'en-tête replié : « Coque, chargeur · écran rayé · 3 tests KO ».
 * Ne dit que ce qui a été constaté : rien sur l'état tant qu'aucune partie n'est renseignée
 * (jamais « non renseigné »), rien sur les tests tant qu'aucun n'est fait.
 */
export function resumeCourt(items) {
  const r = resumeReception(items);
  const parts = [];
  parts.push(r.accessoires.length ? r.accessoires.map((a, i) => (i === 0 ? a : minuscule(a))).join(', ') : 'aucun accessoire');
  const defauts = r.etat.filter(e => !e.ok && e.valeur !== 'non renseigné').map(e => `${minuscule(e.nom)} ${e.valeur.toLowerCase()}`);
  if (defauts.length) parts.push(defauts.join(', '));
  else if (r.etat.every(e => e.ok)) parts.push('état OK');
  if (r.ko.length) parts.push(`${r.ko.length} test${r.ko.length > 1 ? 's' : ''} KO`);
  else if (r.nonTestes === 0) parts.push('tests OK');
  else if (r.nonTestes < TESTS.length) parts.push(`${r.nonTestes} non testé${r.nonTestes > 1 ? 's' : ''}`);
  if (r.imei) parts.push('IMEI vérifié');
  if (r.notes) parts.push(r.notes);
  return majuscule(parts.join(' · '));
}

// ─── État déplié mémorisé par ticket (session du navigateur, jamais bloquant) ──
const cleSession = (ticketId) => `kp_reception_ouverte:${ticketId}`;
export function lireOuvert(ticketId) {
  try { return sessionStorage.getItem(cleSession(ticketId)) === '1'; } catch { return false; }
}
function memoriserOuvert(ticketId, ouvert) {
  try {
    if (ouvert) sessionStorage.setItem(cleSession(ticketId), '1');
    else sessionStorage.removeItem(cleSession(ticketId));
  } catch { /* stockage indisponible */ }
}

// ─── Petits éléments ─────────────────────────────────────────────
function Indicateur({ etat }) {
  const s = etat?.status;
  if (!s) return null;
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs font-medium shrink-0">
      {s === 'dirty' && <span className="text-slate-500">Modifié…</span>}
      {s === 'saving' && <span className="text-amber-800">Enregistrement…</span>}
      {s === 'saved' && <span className="text-emerald-700">Enregistré ✓</span>}
      {s === 'error' && (
        <>
          <AlertTriangle className="w-3.5 h-3.5 text-red-600" aria-hidden="true" />
          <span className="text-red-700">Non enregistré</span>
          <button
            type="button"
            onClick={() => etat.retry().catch(() => {})}
            className="btn-secondary btn-sm ml-1 text-red-700"
          >
            <RotateCcw aria-hidden="true" /> Réessayer
          </button>
        </>
      )}
    </span>
  );
}

// En-tête « carte large » : variantes `[@container(min-width:34rem)]:` écrites en toutes lettres dans le JSX
// (Tailwind ne voit que les classes littérales) ; sans prise en charge des requêtes de conteneur : disposition étroite.
// Puces = `.choice` partagée, resserrée : 36 px à la souris, 44 px au doigt (pointer: coarse, index.css).
// Ce sont de vrais <button> (pas de peer) : l'anneau de focus est posé ici, pas par `.choice`.
const PUCE = 'choice min-h-9 px-2.5 text-[13px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1';
// Ligne « libellé + puces » : colonne de libellé (5,5 rem) quand la CARTE fait ≥ 30 rem (colonne de la fiche en 1440),
// libellé au-dessus des puces sinon (en 1024 la carte ne fait que 370 px : la colonne ferait plier chaque ligne)
const LIGNE = 'flex flex-wrap items-center gap-x-3 gap-y-1';
const ETIQUETTE = 'basis-full [@container(min-width:30rem)]:basis-auto [@container(min-width:30rem)]:w-[5.5rem] shrink-0 text-[13px] font-semibold leading-tight text-slate-700';
const PUCES = 'flex flex-1 flex-wrap gap-1.5 min-w-0';
// En-tête de section : titre + actions, 28 px. Un bouton btn-sm (36 px) y déborde de 4 px par une marge
// négative : `-my-1` (haut et bas) quand la ligne du dessous ne remplit pas la largeur (état constaté),
// `-mt-1` seulement (haut) quand la grille du dessous remplit la largeur (tests d'entrée) — sinon les
// 4 px bas du bouton passeraient sous la première puce, qui les masquerait.
const TITRE_SECTION = 'flex flex-wrap items-center gap-x-2 gap-y-0.5 min-h-7';
const TOUT_OK = 'btn-ghost btn-sm text-emerald-800 hover:bg-emerald-50 hover:text-emerald-900';

// Saisies compactes : 36 px à la souris, 44 px au doigt (comme les puces). Sur un <input class="input">
// l'utilitaire suffit (même spécificité, déclaré après) ; sur le <textarea class="input">, `textarea.input`
// (0,1,1 : 96 px) l'emporterait, d'où les formes importantes.
const CHAMP = 'min-h-9 [@media(pointer:coarse)]:min-h-11';
const CHAMP_TEXTAREA = '!min-h-9 [@media(pointer:coarse)]:!min-h-11';

// Notes : la zone grandit avec le texte grâce à `field-sizing: content` (Chrome 123+, Safari 26+) ; ailleurs
// (Firefox, Safari antérieurs) un repli JS ajuste la hauteur au contenu, même plafond que `max-h-24`.
const NOTES_MAX_PX = 96;
function supporteFieldSizing() {
  try { return typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content'); } catch { return false; }
}
export function ajusterHauteurNotes(el) {
  if (!el || supporteFieldSizing()) return;
  el.style.height = 'auto';
  if (!el.scrollHeight) return; // non rendu (jsdom, display: none)
  const bordures = el.offsetHeight - el.clientHeight;
  el.style.height = `${Math.min(el.scrollHeight + bordures, NOTES_MAX_PX)}px`;
}

/** Puce à bascule (multi) : bouton avec aria-pressed. */
function Bascule({ actif, onClick, ton = 'choice-on', className = '', children }) {
  return (
    <button type="button" aria-pressed={actif} onClick={onClick} className={`${PUCE} ${actif ? ton : ''} ${className}`}>
      {children}
    </button>
  );
}

// OK = vert plein, défaut constaté = ambre doux (attention)
const tonEtat = (k) => (k === 'ok' ? 'choice-ok' : 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-50');

/**
 * Puces exclusives (radiogroup ARIA) : aucune sélection par défaut. Clic, Entrée ou Espace choisit ;
 * les flèches passent d'une puce à l'autre (tabulation unique, comme des boutons radio natifs).
 */
function Exclusif({ legende, id, options, valeur, onChange, tonChoisi }) {
  const legendeId = `${id}-legende`;
  const aucune = !options.some(([k]) => k === valeur);
  const onKeyDown = (e) => {
    const pas = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!pas) return;
    e.preventDefault();
    const i = options.findIndex(([k]) => k === valeur);
    const j = i < 0 ? (pas > 0 ? 0 : options.length - 1) : (i + pas + options.length) % options.length;
    onChange(options[j][0]);
    e.currentTarget.querySelectorAll('[role="radio"]')[j]?.focus();
  };
  return (
    <div className={LIGNE}>
      <span id={legendeId} className={ETIQUETTE}>{legende}</span>
      <div role="radiogroup" aria-labelledby={legendeId} onKeyDown={onKeyDown} className={PUCES}>
        {options.map(([k, texte], i) => {
          const choisi = valeur === k;
          return (
            <button
              key={k} type="button" role="radio" aria-checked={choisi}
              tabIndex={choisi || (aucune && i === 0) ? 0 : -1}
              onClick={() => onChange(k)}
              className={`${PUCE} ${choisi ? tonChoisi(k) : ''}`}
            >
              {texte}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Test d'entrée : un tap cycle non testé (gris) → OK (vert) → KO (rouge) → non testé
const ETAT_TEST = {
  nul: { texte: 'non testé', ton: '', Icone: Circle, icone: 'w-3 h-3 text-slate-500' }, // 4,76:1 sur blanc (≥ 3:1 non textuel)
  ok: { texte: 'OK', ton: 'choice-ok', Icone: Check, icone: 'w-3.5 h-3.5' },
  ko: { texte: 'KO', ton: 'choice-ko', Icone: X, icone: 'w-3.5 h-3.5' },
};
const etatTest = (v) => (v === true ? ETAT_TEST.ok : v === false ? ETAT_TEST.ko : ETAT_TEST.nul);
const suivantTest = (v) => (v === null ? true : v === true ? false : null);

/**
 * Fiche de réception (phase d'entrée, facultative) : accessoires, état, tests, IMEI vérifié.
 * Carte déroulante, REPLIÉE par défaut quel que soit le statut : un en-tête d'une ligne
 * (badge + résumé), le formulaire sur demande. L'état déplié est mémorisé par ticket dans la
 * session du navigateur (un rechargement ne referme pas une saisie en cours).
 * Tout est décoché à l'ouverture d'une fiche vide ; rien n'est envoyé tant que rien n'est modifié.
 * Enregistrement automatique (PUT complet, un envoi à la fois) ; « Valider la réception » pose complete.
 * onEtat({ charge: 'chargement'|'ok'|'erreur', complete }) informe la fiche (badge « à compléter »).
 * controleRef reçoit { flush, ouvrir } : la fiche envoie la réception avant d'imprimer.
 */
export default function ReceptionCard({
  ticketId, imeiTicket = '', remis = false, controleRef, onEtat, onUtiliserImei, id: ancre,
}) {
  const uid = useId();
  const mountedRef = useRef(true);
  const itemsRef = useRef(itemsVides());
  const completeRef = useRef(false);
  const [items, setItems] = useState(itemsRef.current);
  const [complete, setComplete] = useState(false);
  const [auteur, setAuteur] = useState(null);
  const [dateMaj, setDateMaj] = useState(null);
  const [charge, setCharge] = useState('chargement');
  // Une fiche existe en base (ou vient d'être modifiée) : sinon l'en-tête dit ce que la fiche contient
  const [rempli, setRempli] = useState(false);
  const [ouvert, setOuvert] = useState(() => lireOuvert(ticketId));
  const [imeiSaisi, setImeiSaisi] = useState('');
  const [imeiVu, setImeiVu] = useState(false);
  const [essai, setEssai] = useState(0);
  const notesRef = useRef(null);
  // Repli sans field-sizing : à chaque changement du texte et à l'affichage de la zone (ouverture, chargement)
  useLayoutEffect(() => { ajusterHauteurNotes(notesRef.current); }, [items.etat.notes, ouvert, charge]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const save = useAutoSave(useCallback(async (patch) => {
    const res = await api.saveReception(ticketId, { items: patch.items, complete: !!patch.complete });
    if (mountedRef.current && res && typeof res === 'object' && !Array.isArray(res)) {
      if ('auteur' in res) setAuteur(res.auteur ?? null);
      if ('date_maj' in res) setDateMaj(res.date_maj ?? null);
    }
    return res;
  }, [ticketId]), {
    delay: 600,
    onUnload: (patch) => { api.saveReception(ticketId, { items: patch.items, complete: !!patch.complete }, { keepalive: true }); },
  });

  const regler = useCallback((valeur) => {
    setOuvert(valeur);
    memoriserOuvert(ticketId, valeur);
  }, [ticketId]);
  const ouvrir = useCallback(() => regler(true), [regler]);
  const fermer = () => regler(false);
  const basculer = () => regler(!ouvert);

  useEffect(() => {
    if (!controleRef) return undefined;
    const ctrl = { flush: save.flush, ouvrir };
    controleRef.current = ctrl;
    return () => { if (controleRef.current === ctrl) controleRef.current = null; };
  }, [controleRef, save.flush, ouvrir]);

  // Changement de ticket : état déplié de ce ticket-là (jamais ouverte d'office)
  useEffect(() => { setOuvert(lireOuvert(ticketId)); }, [ticketId]);

  useEffect(() => {
    let actif = true;
    setCharge('chargement');
    api.getReception(ticketId)
      .then((data) => {
        if (!actif) return;
        const d = objet(data);
        const existe = !!d.items && typeof d.items === 'object' && !Array.isArray(d.items);
        const it = existe ? normaliserItems(d.items) : itemsVides();
        itemsRef.current = it;
        completeRef.current = d.complete === true;
        setItems(it);
        setComplete(completeRef.current);
        setAuteur(d.auteur ?? null);
        setDateMaj(d.date_maj ?? null);
        setImeiSaisi(it.imei_verifie || '');
        setRempli(existe || completeRef.current);
        setCharge('ok');
      })
      .catch(() => { if (actif) setCharge('erreur'); });
    return () => { actif = false; };
  }, [ticketId, essai]);

  const onEtatRef = useRef(onEtat);
  onEtatRef.current = onEtat;
  useEffect(() => { onEtatRef.current?.({ charge, complete }); }, [charge, complete]);

  // Seule porte d'entrée vers l'auto-save : appelée uniquement sur une action de l'utilisateur
  const modifier = (changes, opts) => {
    const next = { ...itemsRef.current, ...changes };
    itemsRef.current = next;
    setItems(next);
    setRempli(true);
    save.schedule({ items: next, complete: completeRef.current }, opts);
  };
  const flushSilencieux = () => { save.flush().catch(() => {}); };

  const basculerAccessoire = (cle) => {
    const actuels = itemsRef.current.accessoires;
    const accessoires = actuels.includes(cle) ? actuels.filter(a => a !== cle) : [...actuels, cle];
    modifier({ accessoires }, { wait: 300 });
  };
  const changerEtat = (cle, valeur, opts = { wait: 300 }) => modifier({ etat: { ...itemsRef.current.etat, [cle]: valeur } }, opts);
  const etatToutOk = () => modifier({ etat: { ...itemsRef.current.etat, ...Object.fromEntries(ETATS.map(([k]) => [k, 'ok'])) } }, { wait: 0 });
  const cyclerTest = (cle) => modifier({ tests: { ...itemsRef.current.tests, [cle]: suivantTest(itemsRef.current.tests[cle]) } }, { wait: 300 });
  // « Tout OK » : les tests encore neutres passent OK, les KO constatés restent KO
  const testsToutOk = () => {
    const tests = { ...itemsRef.current.tests };
    for (const [k] of TESTS) if (tests[k] === null) tests[k] = true;
    modifier({ tests }, { wait: 0 });
  };

  // IMEI : enregistré seulement vide ou valide ; une saisie invalide reste à l'écran
  const changerImei = (valeur) => {
    setImeiSaisi(valeur);
    const propre = identifiantPropre(valeur);
    if (!propre) {
      if (itemsRef.current.imei_verifie !== null) modifier({ imei_verifie: null });
    } else if (imeiValide(propre) && propre !== itemsRef.current.imei_verifie) {
      modifier({ imei_verifie: propre }, { wait: 0 });
    }
  };

  const changerValidation = (valeur) => {
    completeRef.current = valeur;
    setComplete(valeur);
    setRempli(true);
    save.schedule({ items: itemsRef.current, complete: valeur }, { wait: 0 });
    save.flush().then(() => { if (mountedRef.current && valeur) regler(false); }).catch(() => {});
  };

  const titreId = `${uid}-titre`;
  const nomId = `${uid}-nom`;
  const badgeId = `${uid}-badge`;
  const resumeId = `${uid}-resume`;
  const corpsId = `${uid}-corps`;
  const imeiTicketPropre = identifiantPropre(imeiTicket);
  const imeiPropre = identifiantPropre(imeiSaisi);
  const imeiFaux = !!imeiPropre && !imeiValide(imeiPropre) && (imeiVu || imeiPropre.length >= 15);
  const imeiDifferent = !!items.imei_verifie && !!imeiTicketPropre && items.imei_verifie !== imeiTicketPropre;
  const imeiMessage = imeiFaux ? 'IMEI invalide (15 chiffres, clé de contrôle) ou n° de série incorrect : non enregistré'
    : imeiDifferent ? `Différent de l’IMEI de la fiche (${imeiTicketPropre})` : '';

  const nbOk = TESTS.filter(([k]) => items.tests[k] === true).length;
  const nbKo = TESTS.filter(([k]) => items.tests[k] === false).length;
  const nbNonTestes = TESTS.length - nbOk - nbKo;
  const compteur = [
    nbOk ? `${nbOk} OK` : '', nbKo ? `${nbKo} KO` : '', nbNonTestes ? `${nbNonTestes} non testé${nbNonTestes > 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(' · ');

  const badge = charge !== 'ok' ? null : complete ? (
    <span id={badgeId} className="badge badge-success">
      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> Validée
    </span>
  ) : remis ? (
    <span id={badgeId} className="badge badge-neutral">Non validée</span>
  ) : (
    <span id={badgeId} className="badge badge-warning">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> Réception à compléter
    </span>
  );

  const resume = charge === 'chargement' ? 'Chargement…'
    : charge === 'erreur' ? 'Indisponible'
      : rempli ? resumeCourt(items)
        : 'Accessoires, état, tests d’entrée, IMEI';

  return (
    <section
      id={ancre} tabIndex={-1} aria-labelledby={titreId} aria-busy={charge === 'chargement' || undefined}
      className="card [container-type:inline-size] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      {/* En-tête : tout l'en-tête déplie / replie (nom accessible : « Réception », description : badge + résumé) ;
          l'indicateur d'enregistrement reste à part (son bouton Réessayer).
          Une seule ligne quand la CARTE fait ≥ 34 rem (colonne de la fiche en 1440), sinon le résumé passe
          dessous : c'est la largeur de la carte qui compte (en 1024 la colonne ne fait que 370 px), d'où
          la requête de conteneur plutôt qu'un point de rupture d'écran. */}
      <div className="flex items-center gap-2 pr-2 sm:pr-3">
        <h2 id={titreId} className="t-h2 min-w-0 flex-1">
          <button
            type="button"
            onClick={basculer}
            aria-expanded={ouvert}
            aria-controls={ouvert ? corpsId : undefined}
            aria-labelledby={nomId}
            aria-describedby={badge ? `${badgeId} ${resumeId}` : resumeId}
            className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 min-h-12 px-3 sm:px-4 py-2 rounded-xl text-left
                       transition-colors duration-150 hover:bg-slate-50
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500
                       [@container(min-width:34rem)]:flex-nowrap"
          >
            <ClipboardCheck className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
            <span id={nomId}>Réception</span>
            <span className="hidden [@container(min-width:34rem)]:inline t-caption font-normal">facultatif</span>
            {badge}
            <ChevronDown
              className={`w-4 h-4 text-slate-500 shrink-0 ml-auto [@container(min-width:34rem)]:order-last [@container(min-width:34rem)]:ml-0
                          transition-transform duration-150 motion-reduce:transition-none ${ouvert ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
            <span id={resumeId} className="basis-full [@container(min-width:34rem)]:basis-auto [@container(min-width:34rem)]:flex-1 min-w-0 truncate text-[13px] font-normal text-slate-600">
              <span className="[@container(min-width:34rem)]:hidden">facultatif · </span>{resume}
            </span>
          </button>
        </h2>
        <Indicateur etat={save} />
      </div>

      {charge === 'erreur' && (
        <div className="callout callout-warning flex-wrap items-center mx-3 sm:mx-4 mb-3">
          <AlertTriangle aria-hidden="true" />
          <span className="flex-1">Fiche de réception indisponible.</span>
          <button type="button" onClick={() => setEssai(n => n + 1)} className="btn-secondary btn-sm">
            <RotateCcw aria-hidden="true" /> Réessayer
          </button>
        </div>
      )}

      {charge === 'ok' && ouvert && (
        <div id={corpsId} className="px-3 sm:px-4 pb-3 sm:pb-4 pt-1 space-y-2.5">
          {/* Accessoires : puces à bascule, aucune cochée par défaut */}
          <div className={LIGNE}>
            <span id={`${uid}-acc`} className={ETIQUETTE}>Accessoires</span>
            <div role="group" aria-labelledby={`${uid}-acc`} className={PUCES}>
              {ACCESSOIRES.map(([k, texte]) => {
                const coche = items.accessoires.includes(k);
                return (
                  <Bascule key={k} actif={coche} onClick={() => basculerAccessoire(k)}>
                    {coche && <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}{texte}
                  </Bascule>
                );
              })}
              {items.accessoires.includes('autre') && (
                <span className="flex-1 min-w-[10rem] basis-40">
                  <label htmlFor={`${uid}-acc-autre`} className="sr-only">Autre accessoire</label>
                  <input id={`${uid}-acc-autre`} value={items.accessoires_autre} onChange={e => modifier({ accessoires_autre: e.target.value }, { wait: 800 })}
                    onBlur={flushSilencieux} className={`input ${CHAMP} !py-1 text-sm`} placeholder="Précisez l’accessoire" autoComplete="off" />
                </span>
              )}
            </div>
          </div>

          {/* État : une ligne par partie, puces exclusives sans sélection par défaut */}
          <div>
            <div className={TITRE_SECTION}>
              <p className="t-h3">État constaté</p>
              <button type="button" onClick={etatToutOk} aria-label="Tout OK : état constaté" className={`${TOUT_OK} -my-1 ml-auto`}>
                <ListChecks aria-hidden="true" /> Tout OK
              </button>
            </div>
            <div className="space-y-1">
              {ETATS.map(([k, nom, options]) => (
                <Exclusif key={k} legende={nom} id={`${uid}-etat-${k}`} options={options} valeur={items.etat[k]} onChange={v => changerEtat(k, v)} tonChoisi={tonEtat} />
              ))}
            </div>
          </div>

          {/* Tests d'entrée : puces à un tap qui cyclent non testé → OK → KO */}
          <div>
            <div className={TITRE_SECTION}>
              <p className="t-h3">Tests d’entrée</p>
              <span className="t-caption font-normal">
                {items.appareil_eteint ? 'reçu éteint : « non testé » si invérifiable' : '1 tap OK · 2 taps KO'}
              </span>
              <span className="t-caption ml-auto tabular-nums" aria-live="polite">{compteur}</span>
              <button type="button" onClick={testsToutOk} aria-label="Tout OK : tests d’entrée" className={`${TOUT_OK} -mt-1`}>
                <ListChecks aria-hidden="true" /> Tout OK
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TESTS.map(([k, nom]) => {
                const { texte, ton, Icone, icone } = etatTest(items.tests[k]);
                return (
                  <button key={k} type="button" aria-label={`${nom} : ${texte}`} onClick={() => cyclerTest(k)} className={`${PUCE} ${ton}`}>
                    <Icone className={`${icone} shrink-0`} aria-hidden="true" />{nom}
                  </button>
                );
              })}
            </div>
          </div>

          {/* IMEI : une ligne ; l'aide n'apparaît que pour une erreur ou une différence avec la fiche */}
          <div>
            <div className={LIGNE}>
              <label htmlFor={`${uid}-imei`} className={`${ETIQUETTE} flex items-center gap-1.5`}>
                <ScanLine className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" /> IMEI<span className="sr-only"> / n° de série vérifié</span>
              </label>
              <input
                id={`${uid}-imei`} data-scan-target="imei" value={imeiSaisi}
                autoCapitalize="characters" spellCheck={false}
                onChange={e => changerImei(e.target.value)}
                onBlur={() => { setImeiVu(true); flushSilencieux(); }}
                aria-invalid={imeiFaux || undefined} aria-describedby={imeiMessage ? `${uid}-imei-aide` : undefined}
                className={`input flex-1 min-w-[11rem] ${CHAMP} !py-1 font-mono tabular-nums`}
                placeholder="*#06#, douchette ou n° de série"
                autoComplete="off"
              />
              {imeiValide(imeiTicketPropre) && imeiTicketPropre !== items.imei_verifie && (
                <button type="button" onClick={() => changerImei(imeiTicketPropre)} className="btn-ghost btn-sm -my-1 text-brand-700 hover:text-brand-800 hover:bg-brand-50">
                  Reprendre l’IMEI de la fiche
                </button>
              )}
              {!imeiTicketPropre && items.imei_verifie && onUtiliserImei && (
                <button type="button" onClick={() => onUtiliserImei(items.imei_verifie)} className="btn-ghost btn-sm -my-1 text-brand-700 hover:text-brand-800 hover:bg-brand-50">
                  Copier dans la fiche appareil
                </button>
              )}
            </div>
            {imeiMessage && (
              <p id={`${uid}-imei-aide`} role={imeiFaux ? 'alert' : undefined}
                className={imeiFaux ? 'input-error' : 'input-help font-semibold text-amber-800'}>
                {imeiMessage}
              </p>
            )}
          </div>

          {/* Notes + deux cases (puces à bascule) sur une ligne */}
          <div className={LIGNE}>
            <label htmlFor={`${uid}-notes`} className={ETIQUETTE}>Notes</label>
            <textarea id={`${uid}-notes`} ref={notesRef} value={items.etat.notes} onChange={e => changerEtat('notes', e.target.value, { wait: 800 })}
              onBlur={flushSilencieux} rows={1} placeholder="Oxydation…"
              className={`input flex-1 min-w-[8rem] resize-none ${CHAMP_TEXTAREA} !py-1.5 text-sm leading-snug [field-sizing:content] max-h-24`} />
            <Bascule actif={items.appareil_eteint} onClick={() => modifier({ appareil_eteint: !itemsRef.current.appareil_eteint }, { wait: 300 })}>
              <PowerOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> Reçu éteint
            </Bascule>
            <Bascule actif={items.sauvegarde_conseillee} onClick={() => modifier({ sauvegarde_conseillee: !itemsRef.current.sauvegarde_conseillee }, { wait: 300 })}>
              <HardDriveDownload className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> Sauvegarde conseillée
            </Bascule>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {!complete ? (
              <>
                <button type="button" onClick={() => changerValidation(true)} className="btn-success flex-1 min-w-[12rem]">
                  <CheckCircle2 aria-hidden="true" /> Valider la réception
                </button>
                <button type="button" onClick={() => { flushSilencieux(); fermer(); }} className="btn-ghost btn-sm">Réduire</button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => { flushSilencieux(); fermer(); }} className="btn-secondary flex-1">Réduire</button>
                <button type="button" onClick={() => changerValidation(false)} className="btn-ghost btn-sm">Repasser « à compléter »</button>
              </>
            )}
            {complete && (auteur || dateMaj) && (
              <p className="t-caption basis-full">Validée{auteur ? ` par ${auteur}` : ''}{dateMaj ? ` · ${formatDate(dateMaj)}` : ''}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
