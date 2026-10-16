import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  ClipboardCheck, Edit3, RotateCcw, AlertTriangle, CheckCircle2, ScanLine, PowerOff, HardDriveDownload, ListChecks,
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
const REPONSES = [['oui', 'Oui', true], ['non', 'Non', false], ['nt', 'Non testé', null]];
const CLES_ACCESSOIRES = new Set(ACCESSOIRES.map(([k]) => k));

/** Fiche neuve : état « OK » par défaut (saisie rapide), tests non faits. */
export function itemsVides() {
  return {
    accessoires: [],
    accessoires_autre: '',
    etat: { ecran: 'ok', dos: 'ok', chassis: 'ok', notes: '' },
    tests: Object.fromEntries(TESTS.map(([k]) => [k, null])),
    imei_verifie: null,
    appareil_eteint: false,
    sauvegarde_conseillee: false,
  };
}

const objet = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
// Partie non renseignée par un autre poste : null (aucun choix), jamais « OK » d'office
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

const RECENTE_MS = 24 * 3600_000;

/**
 * Réception encore d'actualité (formulaire déplié à l'ouverture) : appareil en attente de
 * diagnostic, ou déposé depuis moins de 24 h. Pas pour un pré-enregistrement (appareil absent).
 */
export function receptionAttendue(statut, dateDepot, maintenant = Date.now()) {
  if (statut === 'Pré-enregistré') return false;
  if (statut === 'En attente de diagnostic') return true;
  const s = String(dateDepot ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return false;
  const depot = Date.parse(s.replace(' ', 'T'));
  return Number.isFinite(depot) && Math.abs(maintenant - depot) < RECENTE_MS;
}

const libelle = (liste, cle) => liste.find(([k]) => k === cle)?.[1] ?? cle;

/** Résumé lisible (vue repliée, mêmes informations que l'encadré imprimé). */
export function resumeReception(items) {
  const it = normaliserItems(items);
  const accessoires = it.accessoires.map(a => (a === 'autre' && it.accessoires_autre.trim() ? it.accessoires_autre.trim() : libelle(ACCESSOIRES, a)));
  const etat = ETATS.map(([k, nom, options]) => ({
    cle: k, nom, valeur: it.etat[k] ? libelle(options, it.etat[k]) : 'non renseigné', ok: it.etat[k] === 'ok',
  }));
  const ko = TESTS.filter(([k]) => it.tests[k] === false).map(([, nom]) => nom);
  const nonTestes = TESTS.filter(([k]) => it.tests[k] === null).length;
  return { accessoires, etat, ko, nonTestes, notes: it.etat.notes.trim() };
}

// ─── Petits éléments ─────────────────────────────────────────────
function Indicateur({ etat }) {
  const s = etat?.status;
  if (!s) return null;
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-[11px] font-medium">
      {s === 'dirty' && <span className="text-slate-600">Modifié…</span>}
      {s === 'saving' && <span className="text-amber-800">Enregistrement…</span>}
      {s === 'saved' && <span className="text-emerald-700">Enregistré ✓</span>}
      {s === 'error' && (
        <>
          <AlertTriangle className="w-3.5 h-3.5 text-red-600" aria-hidden="true" />
          <span className="text-red-700">Non enregistré</span>
          <button
            type="button"
            onClick={() => etat.retry().catch(() => {})}
            className="ml-1 inline-flex items-center gap-1 min-h-11 px-3 rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs font-bold hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Réessayer
          </button>
        </>
      )}
    </span>
  );
}

const PUCE = 'inline-flex items-center justify-center gap-1.5 min-h-11 min-w-11 px-2.5 rounded-xl border-2 text-sm font-semibold transition-colors '
  + 'peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-1';
// Colonnes selon la largeur réelle de la carte (colonne étroite de la fiche, iPad, plein écran)
const GRILLE_CHOIX = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))] gap-x-6 gap-y-1.5';

// Libellé à gauche, boutons à droite (retour à la ligne si la carte est étroite)
function Choix({ legende, nom, options, valeur, onChange, tonChoisi }) {
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">{legende}</legend>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="w-28 shrink-0 text-sm font-medium text-slate-800" aria-hidden="true">{legende}</span>
        <div className="flex flex-wrap gap-1.5">
          {options.map(([k, texte]) => {
            const choisi = valeur === k;
            return (
              <label key={k} className="cursor-pointer">
                <input type="radio" name={nom} value={k} checked={choisi} onChange={() => onChange(k)} className="peer sr-only" />
                <span className={`${PUCE} ${choisi ? tonChoisi(k) : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}>{texte}</span>
              </label>
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}

const tonEtat = (k) => (k === 'ok' ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-amber-400 border-amber-500 text-amber-950');
const tonTest = (k) => (k === 'oui' ? 'bg-emerald-600 border-emerald-600 text-white'
  : k === 'non' ? 'bg-red-600 border-red-600 text-white'
    : 'bg-slate-600 border-slate-600 text-white');
const reponseDe = (v) => (v === true ? 'oui' : v === false ? 'non' : 'nt');

/**
 * Fiche de réception (phase d'entrée) : accessoires, état, tests, IMEI vérifié.
 * Enregistrement automatique (PUT complet, un envoi à la fois) ; « Valider la réception » pose complete.
 * onEtat({ charge: 'chargement'|'ok'|'erreur', complete }) informe la fiche (badge « à compléter »).
 * controleRef reçoit { flush, ouvrir } : la fiche envoie la réception avant d'imprimer.
 */
export default function ReceptionCard({
  ticketId, imeiTicket = '', remis = false, statut = '', dateDepot = null, controleRef, onEtat, onUtiliserImei, id: ancre,
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
  // Une fiche existe en base (ou vient d'être modifiée) : sinon la vue repliée dit « non remplie »
  const [rempli, setRempli] = useState(false);
  const [ouvert, setOuvert] = useState(false);
  const [imeiSaisi, setImeiSaisi] = useState('');
  const [imeiVu, setImeiVu] = useState(false);
  const [essai, setEssai] = useState(0);

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

  // « Réception à compléter » cliqué pendant le chargement : le formulaire s'ouvre à l'arrivée
  const demandeOuvertureRef = useRef(false);
  const ouvrir = useCallback(() => {
    demandeOuvertureRef.current = true;
    setOuvert(true);
  }, []);

  useEffect(() => {
    if (!controleRef) return undefined;
    const ctrl = { flush: save.flush, ouvrir };
    controleRef.current = ctrl;
    return () => { if (controleRef.current === ctrl) controleRef.current = null; };
  }, [controleRef, save.flush, ouvrir]);

  useEffect(() => {
    let actif = true;
    demandeOuvertureRef.current = false;
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
        // Fiche ancienne ou appareil déjà en réparation : repliée (« Remplir »), la fiche reste courte
        setOuvert(demandeOuvertureRef.current
          || (!completeRef.current && !remis && receptionAttendue(statut, dateDepot)));
        demandeOuvertureRef.current = false;
        setCharge('ok');
      })
      .catch(() => { if (actif) setCharge('erreur'); });
    return () => { actif = false; };
  // remis, statut et dateDepot ne sont lus qu'au chargement (repli initial)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId, essai]);

  const onEtatRef = useRef(onEtat);
  onEtatRef.current = onEtat;
  useEffect(() => { onEtatRef.current?.({ charge, complete }); }, [charge, complete]);

  const modifier = (changes, opts) => {
    const next = { ...itemsRef.current, ...changes };
    itemsRef.current = next;
    setItems(next);
    setRempli(true);
    save.schedule({ items: next, complete: completeRef.current }, opts);
  };
  const flushSilencieux = () => { save.flush().catch(() => {}); };

  const basculerAccessoire = (cle, coche) => {
    const actuels = itemsRef.current.accessoires;
    const accessoires = coche ? [...new Set([...actuels, cle])] : actuels.filter(a => a !== cle);
    modifier({ accessoires }, { wait: 300 });
  };
  const changerEtat = (cle, valeur, opts = { wait: 300 }) => modifier({ etat: { ...itemsRef.current.etat, [cle]: valeur } }, opts);
  const changerTest = (cle, rep) => {
    const valeur = REPONSES.find(([k]) => k === rep)?.[2] ?? null;
    modifier({ tests: { ...itemsRef.current.tests, [cle]: valeur } }, { wait: 300 });
  };
  const testsRestantsOk = () => {
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
    save.flush().then(() => { if (mountedRef.current && valeur) setOuvert(false); }).catch(() => {});
  };

  const titreId = `${uid}-titre`;
  const imeiTicketPropre = identifiantPropre(imeiTicket);
  const imeiPropre = identifiantPropre(imeiSaisi);
  const imeiFaux = !!imeiPropre && !imeiValide(imeiPropre) && (imeiVu || imeiPropre.length >= 15);
  const imeiDifferent = !!items.imei_verifie && !!imeiTicketPropre && items.imei_verifie !== imeiTicketPropre;
  const resume = resumeReception(items);

  const badge = charge !== 'ok' ? null : complete ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 px-2 py-0.5 text-[11px] font-bold">
      <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> Validée
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 ring-1 ring-amber-300 px-2 py-0.5 text-[11px] font-bold">
      <AlertTriangle className="w-3 h-3" aria-hidden="true" /> Réception à compléter
    </span>
  );

  return (
    <section id={ancre} tabIndex={-1} className="card p-5 focus:outline-none" aria-labelledby={titreId}>
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center">
            <ClipboardCheck className="w-4 h-4 text-teal-700" aria-hidden="true" />
          </div>
          <h2 id={titreId} className="text-sm font-semibold text-slate-800">Réception</h2>
          {badge}
          <Indicateur etat={save} />
        </div>
        {charge === 'ok' && !ouvert && (
          <button type="button" onClick={() => setOuvert(true)} className="btn-ghost text-xs px-3 min-h-11 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
            <Edit3 className="w-3.5 h-3.5" aria-hidden="true" /> {rempli ? 'Modifier' : 'Remplir'}
          </button>
        )}
      </div>

      {charge === 'chargement' && (
        <div className="space-y-2" aria-busy="true" aria-label="Chargement de la réception">
          <div className="h-4 w-2/3 bg-slate-100 rounded motion-safe:animate-pulse" />
          <div className="h-4 w-1/2 bg-slate-100 rounded motion-safe:animate-pulse" />
        </div>
      )}

      {charge === 'erreur' && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
          <AlertTriangle className="w-4 h-4 text-amber-600" aria-hidden="true" />
          <span>Fiche de réception indisponible.</span>
          <button type="button" onClick={() => setEssai(n => n + 1)} className="btn-secondary min-h-11 text-xs">
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Réessayer
          </button>
        </div>
      )}

      {charge === 'ok' && !ouvert && !rempli && (
        <p className="text-sm text-slate-600">Aucune fiche de réception remplie (accessoires, état, tests d’entrée).</p>
      )}

      {charge === 'ok' && !ouvert && rempli && (
        <dl className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-slate-600">Accessoires déposés :</dt>
            <dd className="font-medium text-slate-800">{resume.accessoires.length ? resume.accessoires.join(', ') : 'aucun'}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-slate-600">État :</dt>
            <dd className="font-medium text-slate-800">
              {resume.etat.map((e, i) => (
                <span key={e.cle} className={e.ok ? '' : 'text-amber-800 font-semibold'}>{i > 0 ? ' · ' : ''}{e.nom} {e.ok ? 'OK' : e.valeur.toLowerCase()}</span>
              ))}
            </dd>
          </div>
          {resume.notes && (
            <div className="flex flex-wrap gap-x-2"><dt className="text-slate-600">Notes :</dt><dd className="text-slate-800">{resume.notes}</dd></div>
          )}
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-slate-600">Tests :</dt>
            <dd className={resume.ko.length ? 'font-semibold text-red-700' : 'font-medium text-slate-800'}>
              {resume.ko.length ? `KO : ${resume.ko.join(', ')}` : 'aucun test KO'}
              {resume.nonTestes > 0 && <span className="font-normal text-slate-600"> ({resume.nonTestes} non testé{resume.nonTestes > 1 ? 's' : ''})</span>}
            </dd>
          </div>
          {items.imei_verifie && (
            <div className="flex flex-wrap gap-x-2"><dt className="text-slate-600">IMEI / n° de série vérifié :</dt><dd className="font-mono text-xs text-slate-800 self-center">{items.imei_verifie}</dd></div>
          )}
          {(items.appareil_eteint || items.sauvegarde_conseillee) && (
            <div className="flex flex-wrap gap-2 pt-1">
              {items.appareil_eteint && <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">Reçu éteint</span>}
              {items.sauvegarde_conseillee && <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-800">Sauvegarde conseillée</span>}
            </div>
          )}
          {complete && (auteur || dateMaj) && (
            <p className="text-[11px] text-slate-500 pt-1">Validée{auteur ? ` par ${auteur}` : ''}{dateMaj ? ` · ${formatDate(dateMaj)}` : ''}</p>
          )}
        </dl>
      )}

      {charge === 'ok' && ouvert && (
        <div className="space-y-5">
          <fieldset className="min-w-0">
            <legend className="input-label">Accessoires déposés</legend>
            <div className="flex flex-wrap gap-1.5">
              {ACCESSOIRES.map(([k, texte]) => {
                const coche = items.accessoires.includes(k);
                return (
                  <label key={k} className="cursor-pointer">
                    <input type="checkbox" checked={coche} onChange={e => basculerAccessoire(k, e.target.checked)} className="peer sr-only" />
                    <span className={`${PUCE} ${coche ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
                      {coche && <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />}{texte}
                    </span>
                  </label>
                );
              })}
            </div>
            {items.accessoires.includes('autre') && (
              <div className="mt-2">
                <label htmlFor={`${uid}-acc-autre`} className="sr-only">Autre accessoire</label>
                <input id={`${uid}-acc-autre`} value={items.accessoires_autre} onChange={e => modifier({ accessoires_autre: e.target.value }, { wait: 800 })}
                  onBlur={flushSilencieux} className="input min-h-11" placeholder="Précisez l’accessoire" autoComplete="off" />
              </div>
            )}
          </fieldset>

          <div>
            <p className="input-label">État constaté</p>
            <div className={GRILLE_CHOIX}>
              {ETATS.map(([k, nom, options]) => (
                <Choix key={k} legende={nom} nom={`${uid}-etat-${k}`} options={options} valeur={items.etat[k]} onChange={v => changerEtat(k, v)} tonChoisi={tonEtat} />
              ))}
            </div>
            <label htmlFor={`${uid}-notes`} className="block text-xs font-semibold text-slate-700 mt-3 mb-1.5">Notes sur l’état (oxydation, taches, pixels morts…)</label>
            <textarea id={`${uid}-notes`} value={items.etat.notes} onChange={e => changerEtat('notes', e.target.value, { wait: 800 })}
              onBlur={flushSilencieux} className="input resize-none" rows={2} />
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <p className="input-label mb-0">Tests d’entrée</p>
              <button type="button" onClick={testsRestantsOk} className="btn-ghost text-xs px-3 min-h-11 text-emerald-800 hover:bg-emerald-50">
                <ListChecks className="w-3.5 h-3.5" aria-hidden="true" /> Tests restants OK
              </button>
            </div>
            {items.appareil_eteint && (
              <p className="text-[11px] text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-2">Appareil reçu éteint : laissez « Non testé » pour ce qui n’a pas pu être vérifié.</p>
            )}
            <div className={GRILLE_CHOIX}>
              {TESTS.map(([k, nom]) => (
                <Choix key={k} legende={nom} nom={`${uid}-test-${k}`} options={REPONSES} valeur={reponseDe(items.tests[k])} onChange={v => changerTest(k, v)} tonChoisi={tonTest} />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-3">
            <div>
              <label htmlFor={`${uid}-imei`} className="input-label flex items-center gap-1"><ScanLine className="w-3 h-3" aria-hidden="true" /> IMEI / n° de série vérifié</label>
              <input
                id={`${uid}-imei`} data-scan-target="imei" value={imeiSaisi}
                autoCapitalize="characters" spellCheck={false}
                onChange={e => changerImei(e.target.value)}
                onBlur={() => { setImeiVu(true); flushSilencieux(); }}
                aria-invalid={imeiFaux || undefined} aria-describedby={`${uid}-imei-aide`}
                className={`input font-mono min-h-11 ${imeiFaux ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20' : ''}`}
                autoComplete="off"
              />
              <p id={`${uid}-imei-aide`} role={imeiFaux ? 'alert' : undefined}
                className={`text-[11px] mt-1 ${imeiFaux ? 'font-semibold text-red-700' : imeiDifferent ? 'font-semibold text-amber-800' : 'text-slate-600'}`}>
                {imeiFaux ? 'IMEI invalide (15 chiffres, clé de contrôle) ou n° de série incorrect : non enregistré'
                  : imeiDifferent ? `Différent de l’IMEI de la fiche (${imeiTicketPropre})`
                    : '*#06# sur l’appareil, scannable à la douchette'}
              </p>
              <div className="flex flex-wrap gap-2 mt-1">
                {imeiValide(imeiTicketPropre) && imeiTicketPropre !== items.imei_verifie && (
                  <button type="button" onClick={() => changerImei(imeiTicketPropre)} className="btn-ghost text-xs px-3 min-h-11 text-brand-700">
                    Reprendre l’IMEI de la fiche
                  </button>
                )}
                {!imeiTicketPropre && items.imei_verifie && onUtiliserImei && (
                  <button type="button" onClick={() => onUtiliserImei(items.imei_verifie)} className="btn-ghost text-xs px-3 min-h-11 text-brand-700">
                    Copier dans la fiche appareil
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-2 self-start">
              <label className="flex items-center gap-2 min-h-11 px-3 rounded-lg border border-slate-200 text-sm font-medium text-slate-800 cursor-pointer hover:bg-slate-50">
                <input type="checkbox" checked={items.appareil_eteint} onChange={e => modifier({ appareil_eteint: e.target.checked }, { wait: 300 })}
                  className="w-5 h-5 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                <PowerOff className="w-4 h-4 text-slate-500" aria-hidden="true" /> Reçu éteint (tests impossibles)
              </label>
              <label className="flex items-center gap-2 min-h-11 px-3 rounded-lg border border-slate-200 text-sm font-medium text-slate-800 cursor-pointer hover:bg-slate-50">
                <input type="checkbox" checked={items.sauvegarde_conseillee} onChange={e => modifier({ sauvegarde_conseillee: e.target.checked }, { wait: 300 })}
                  className="w-5 h-5 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                <HardDriveDownload className="w-4 h-4 text-slate-500" aria-hidden="true" /> Sauvegarde des données conseillée
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {!complete ? (
              <button type="button" onClick={() => changerValidation(true)}
                className="flex-1 min-w-[12rem] min-h-12 inline-flex items-center justify-center gap-2 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2">
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Valider la réception
              </button>
            ) : (
              <>
                <button type="button" onClick={() => { flushSilencieux(); setOuvert(false); }} className="btn-secondary min-h-11 flex-1">Fermer</button>
                <button type="button" onClick={() => changerValidation(false)} className="btn-ghost min-h-11 text-xs">Repasser « à compléter »</button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
