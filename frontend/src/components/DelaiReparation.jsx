import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Clock, CalendarClock, CalendarDays, CalendarCheck, AlertTriangle, Check } from 'lucide-react';
import {
  delaiTicket, infoDelai, dateDelai, valeurDelai, libelleEcheance, phrasePret,
} from '../lib/delai';

// ─── Heures d'ouverture de la boutique (Chambéry) ─────────────────────────────
// Lundi au samedi, 10:00 – 19:00 ; fermé le dimanche. Un délai qui déborde la journée reprend
// le jour ouvré suivant à l'ouverture ; à modifier ici si les horaires changent.
export const HEURE_OUVERTURE = 10; // 10:00
export const HEURE_FERMETURE = 19; // 19:00
export const JOURS_FERMES = [0]; // Date.getDay() : 0 = dimanche
// Un délai « en heures » qui finit à peine après la fermeture (19:00 → 19:05 au plus) est promis à
// 19:00 plutôt que le lendemain matin : « 3h » choisi à 16:02 donne 19:00, pas « demain à 10:05 ».
export const TOLERANCE_FERMETURE_MIN = 5;

/** Puces proposées : délais « en heures » (temps d'ouverture) puis « en jours ouvrés ». */
export const DELAIS = [
  { cle: '1h', libelle: '1h', minutes: 60, Icone: Clock, parle: '1 heure' },
  { cle: '1h30', libelle: '1h30', minutes: 90, Icone: Clock, parle: '1 heure 30' },
  { cle: '2h', libelle: '2h', minutes: 120, Icone: Clock, parle: '2 heures' },
  { cle: '2h30', libelle: '2h30', minutes: 150, Icone: Clock, parle: '2 heures 30' },
  { cle: '3h', libelle: '3h', minutes: 180, Icone: Clock, parle: '3 heures' },
  { cle: '3h30', libelle: '3h30', minutes: 210, Icone: Clock, parle: '3 heures 30' },
  { cle: '24h', libelle: '24h', jours: 1, Icone: CalendarClock, parle: '24 heures' },
  { cle: '48h', libelle: '48h', jours: 2, Icone: CalendarClock, parle: '48 heures' },
];
export const CLE_AUTRE = 'autre';

const estOuvert = (d) => !JOURS_FERMES.includes(d.getDay());
const aHeure = (d, h) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x; };

function jourOuvreSuivant(d) {
  const x = new Date(d);
  x.setDate(x.getDate() + 1);
  x.setHours(HEURE_OUVERTURE, 0, 0, 0);
  for (let i = 0; i < 7 && !estOuvert(x); i += 1) x.setDate(x.getDate() + 1);
  return x;
}

// Instant ramené dans les heures d'ouverture (avant 10:00 → 10:00 ; après 19:00 ou jour fermé → jour ouvré suivant)
function dansOuverture(d) {
  if (!estOuvert(d) || d >= aHeure(d, HEURE_FERMETURE)) return jourOuvreSuivant(d);
  if (d < aHeure(d, HEURE_OUVERTURE)) return aHeure(d, HEURE_OUVERTURE);
  return new Date(d);
}

// Arrondi aux 5 minutes supérieures (11:02 → 11:05, 11:00 reste 11:00)
function arrondi5(d) {
  const x = new Date(d);
  const ms = x.getMinutes() * 60_000 + x.getSeconds() * 1000 + x.getMilliseconds();
  x.setMinutes(Math.ceil(ms / 300_000) * 5, 0, 0);
  return x;
}

/**
 * Heure promise pour une puce : { date, valeur ('AAAA-MM-JJTHH:MM'), libelle } ou null (clé inconnue).
 * - « 1h » … « 3h30 » : maintenant + durée en temps d'ouverture, arrondi aux 5 minutes supérieures ;
 *   ce qui dépasse 19:00 (ou tombe un dimanche) reprend le jour ouvré suivant à 10:00
 *   (18:30 + 1h → lendemain 10:30 ; samedi 18:00 + 2h → lundi 11:00) ; un dépassement de
 *   TOLERANCE_FERMETURE_MIN minutes au plus est ramené à 19:00 (16:02 + 3h → 19:00).
 * - « 24h » / « 48h » : même heure 1 / 2 jours ouvrés plus tard (dimanche sauté), ramenée dans 10:00–19:00.
 */
export function calculerHeurePromise(maintenant, cle) {
  const delai = DELAIS.find((d) => d.cle === cle);
  const base = maintenant instanceof Date ? maintenant : new Date(maintenant ?? Date.now());
  if (!delai || Number.isNaN(base.getTime())) return null;
  let date;
  if (delai.minutes) {
    let t = dansOuverture(base);
    let reste = delai.minutes * 60_000;
    for (let i = 0; i < 14; i += 1) {
      const dispo = aHeure(t, HEURE_FERMETURE) - t;
      if (reste <= dispo) break;
      // Quelques minutes après la fermeture : promis à 19:00 le jour même
      if (reste - dispo <= TOLERANCE_FERMETURE_MIN * 60_000) { reste = dispo; break; }
      reste -= dispo;
      t = jourOuvreSuivant(t);
    }
    date = arrondi5(new Date(t.getTime() + reste));
  } else {
    const x = new Date(base);
    for (let n = delai.jours, i = 0; n > 0 && i < 14; i += 1) {
      x.setDate(x.getDate() + 1);
      if (estOuvert(x)) n -= 1;
    }
    date = arrondi5(x);
    if (date < aHeure(date, HEURE_OUVERTURE)) date = aHeure(date, HEURE_OUVERTURE);
    else if (date > aHeure(date, HEURE_FERMETURE)) date = aHeure(date, HEURE_FERMETURE);
  }
  return { date, valeur: valeurDelai(date), libelle: libelleEcheance(date, base) };
}

// ─── Horloge partagée : toutes les pastilles avancent ensemble, une seule minuterie ───
const PAS_HORLOGE_MS = 30_000;
let instantHorloge = 0;
let minuterie = null;
const abonnes = new Set();
function abonnerHorloge(cb) {
  abonnes.add(cb);
  if (!minuterie) {
    minuterie = setInterval(() => {
      instantHorloge = Date.now();
      abonnes.forEach((f) => f());
    }, PAS_HORLOGE_MS);
  }
  return () => {
    abonnes.delete(cb);
    if (!abonnes.size && minuterie) {
      clearInterval(minuterie);
      minuterie = null;
    }
  };
}
const lireHorloge = () => instantHorloge;

/** Date courante, rafraîchie toutes les 30 s (horloge commune à tous les composants abonnés). */
export function useMaintenant() {
  const [auMontage] = useState(() => Date.now());
  const tic = useSyncExternalStore(abonnerHorloge, lireHorloge, lireHorloge);
  const t = Math.max(tic, auMontage);
  return useMemo(() => new Date(t), [t]);
}

// ─── Pastille ────────────────────────────────────────────────────────────────
const STYLES_CLAIR = {
  ok: 'bg-slate-100 text-slate-700',
  bientot: 'bg-orange-100 text-orange-800',
  retard: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
  aucun: 'bg-amber-50 text-amber-800 border border-dashed border-amber-400',
  texte: 'bg-slate-100 text-slate-700',
};
// Sur l'en-tête sombre de la fiche (slate-900)
const STYLES_SOMBRE = {
  ok: 'bg-white/10 text-white',
  bientot: 'bg-orange-400/20 text-orange-100',
  retard: 'bg-red-500/25 text-red-100 ring-1 ring-inset ring-red-400/40',
  aucun: 'bg-amber-400/10 text-amber-200 border border-dashed border-amber-300/60',
  texte: 'bg-white/10 text-slate-100',
};
const TAILLES = { sm: 'badge-sm', md: '', lg: 'badge-lg' };
const ICONES_ETAT = { ok: Clock, bientot: Clock, retard: AlertTriangle, aucun: CalendarClock, texte: CalendarDays };

/**
 * Pastille de délai : « 15:30 · dans 1 h 20 », « En retard de 25 min », « Délai à fixer »…
 * `ticket` : règles de delaiTicket (rien une fois la réparation terminée) ; sinon `valeur` brute.
 */
export function PastilleDelai({ ticket, valeur, maintenant, taille = 'sm', sombre = false, className = '' }) {
  const horloge = useMaintenant();
  const now = maintenant || horloge;
  const info = ticket !== undefined ? delaiTicket(ticket, now) : infoDelai(valeur, now);
  if (!info) return null;
  const Icone = ICONES_ETAT[info.etat] || Clock;
  const styles = (sombre ? STYLES_SOMBRE : STYLES_CLAIR)[info.etat];
  const icone = taille === 'lg' ? 'w-4 h-4' : 'w-3.5 h-3.5';
  return (
    <span title={info.titre} data-delai={info.etat}
      className={`badge ${TAILLES[taille] || ''} ${styles} tabular-nums shrink-0 max-w-full ${className}`}>
      <Icone className={`${icone} shrink-0`} aria-hidden="true" />
      <span className="sr-only">Délai de réparation : </span>
      <span className={info.etat === 'texte' ? 'truncate max-w-[12rem]' : ''}>{info.libelle}</span>
    </span>
  );
}

// ─── Choix du délai ──────────────────────────────────────────────────────────

/** Clé de la puce qui donne exactement `valeur` maintenant ; 'autre' pour toute autre date ; null si vide. */
export function cleDeValeur(valeur, maintenant = new Date()) {
  if (!valeur) return null;
  const d = DELAIS.find((x) => calculerHeurePromise(maintenant, x.cle)?.valeur === valeur);
  return d ? d.cle : CLE_AUTRE;
}

/**
 * Délai de réparation en puces exclusives : 1h, 1h30, 2h, 2h30, 3h, 3h30, 24h, 48h et « Autre… »
 * (date et heure libres). L'heure calculée s'affiche en clair dessous (« Prêt vers 15:30 aujourd'hui »).
 *
 * Props : value (texte datetime-local ou ''), onChange(valeur, { libelle, cle }), cle (puce choisie,
 * facultatif : déduite de value sinon), required, error, maintenant (Date injectable),
 * taille 'borne' | 'compact', idPrefix, legende.
 * Les flèches déplacent le focus d'une puce à l'autre ; Entrée / Espace choisit (aucun
 * enregistrement involontaire là où le choix s'enregistre aussitôt : fiche, panneau de scan).
 */
export default function DelaiReparation({
  value = '', onChange, cle, required = false, error, maintenant, taille = 'borne', idPrefix,
  legende = 'Délai de réparation',
}) {
  const uid = useId();
  const prefix = idPrefix || `delai-${uid}`;
  const horloge = useMaintenant();
  const now = maintenant || horloge;
  const borne = taille === 'borne';
  const [cleLocale, setCleLocale] = useState(() => cleDeValeur(value, now));
  const [indexFocus, setIndexFocus] = useState(null);
  const puces = useRef([]);
  const champAutreRef = useRef(null);
  const focusAutreRef = useRef(false);
  const courante = cle !== undefined ? (cle || (value ? cleDeValeur(value, now) : null)) : cleLocale;

  // Valeur effacée par le parent (nouveau dépôt) : plus aucune puce choisie
  useEffect(() => {
    if (!value && cleLocale && cleLocale !== CLE_AUTRE) setCleLocale(null);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (courante === CLE_AUTRE && focusAutreRef.current) {
      focusAutreRef.current = false;
      champAutreRef.current?.focus();
    }
  }, [courante]);

  const options = [...DELAIS, { cle: CLE_AUTRE, libelle: 'Autre…', Icone: CalendarDays, parle: 'date et heure au choix' }];
  const dateChoisie = dateDelai(value);

  const choisir = (opt) => {
    if (opt.cle === CLE_AUTRE) {
      setCleLocale(CLE_AUTRE);
      focusAutreRef.current = true;
      onChange?.(value || '', { libelle: dateChoisie ? libelleEcheance(dateChoisie, now) : '', cle: CLE_AUTRE });
      return;
    }
    const calcul = calculerHeurePromise(now, opt.cle);
    if (!calcul) return;
    setCleLocale(opt.cle);
    onChange?.(calcul.valeur, { libelle: calcul.libelle, cle: opt.cle });
  };

  const saisirAutre = (v) => {
    setCleLocale(CLE_AUTRE);
    const d = dateDelai(v);
    onChange?.(v, { libelle: d ? libelleEcheance(d, now) : '', cle: CLE_AUTRE });
  };

  const indexCoche = options.findIndex((o) => o.cle === courante);
  const indexTab = indexFocus ?? (indexCoche >= 0 ? indexCoche : 0);

  const surTouche = (e, i) => {
    const pas = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    let cible = null;
    if (pas) cible = (i + pas + options.length) % options.length;
    else if (e.key === 'Home') cible = 0;
    else if (e.key === 'End') cible = options.length - 1;
    if (cible === null) return;
    e.preventDefault();
    setIndexFocus(cible);
    puces.current[cible]?.focus();
  };

  const legendeId = `${prefix}-legende`;
  const aideId = `${prefix}-aide`;
  const erreurId = `${prefix}-erreur`;
  const autreId = `${prefix}-autre`;
  const passee = dateChoisie && dateChoisie.getTime() < now.getTime() - 60_000;

  return (
    <div className="space-y-3">
      <div>
        <span id={legendeId} className={`block font-semibold text-slate-900 ${borne ? 'text-base' : 'text-sm'}`}>
          {legende}{required && <span aria-hidden="true"> *</span>}
          {required && <span className="sr-only"> (obligatoire)</span>}
        </span>
        <span id={aideId} className={`block mt-0.5 text-slate-600 ${borne ? 'text-sm' : 'text-xs'}`}>
          Ouvert du lundi au samedi, {HEURE_OUVERTURE}h – {HEURE_FERMETURE}h : le délai compte les heures d'ouverture.
        </span>
      </div>

      <div role="radiogroup" aria-labelledby={legendeId} aria-required={required || undefined}
        aria-describedby={error ? `${aideId} ${erreurId}` : aideId}
        aria-invalid={error ? 'true' : undefined}
        className={`grid grid-cols-3 ${borne ? 'gap-3' : 'gap-2'}`}>
        {options.map((opt, i) => {
          const actif = courante === opt.cle;
          const calcul = opt.cle === CLE_AUTRE ? null : calculerHeurePromise(now, opt.cle);
          const { Icone } = opt;
          return (
            <button
              key={opt.cle}
              type="button"
              role="radio"
              aria-checked={actif}
              tabIndex={i === indexTab ? 0 : -1}
              ref={(el) => { puces.current[i] = el; }}
              onClick={() => choisir(opt)}
              onKeyDown={(e) => surTouche(e, i)}
              onFocus={() => setIndexFocus(i)}
              className={`relative flex items-center justify-center gap-1.5 rounded-lg border-2 font-semibold tabular-nums
                transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2
                ${borne ? 'min-h-14 px-2 text-base' : 'min-h-11 px-1.5 text-sm'}
                ${actif
                  ? 'border-brand-600 bg-brand-50 text-brand-700'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'}`}
            >
              <Icone className={`${borne ? 'w-5 h-5' : 'w-4 h-4'} shrink-0 ${actif ? 'text-brand-600' : 'text-slate-500'}`} aria-hidden="true" />
              <span>{opt.libelle}</span>
              {/* Nom accessible : « 1h, prêt vers 15:30 aujourd'hui » (le libellé visible en tête) */}
              {calcul && <span className="sr-only">, {phrasePret(calcul.date, now).toLowerCase()}</span>}
              {actif && <Check className={`absolute top-1 right-1 text-brand-600 ${borne ? 'w-4 h-4' : 'w-3 h-3'}`} aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      {courante === CLE_AUTRE && (
        <div className="animate-in">
          <label htmlFor={autreId} className="input-label">Date et heure de récupération</label>
          <input
            id={autreId}
            ref={champAutreRef}
            type="datetime-local"
            value={value || ''}
            min={valeurDelai(now)}
            step={300}
            onChange={(e) => saisirAutre(e.target.value)}
            className="input tabular-nums"
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? erreurId : undefined}
          />
        </div>
      )}

      <div aria-live="polite" aria-atomic="true">
        {dateChoisie ? (
          <span className={`flex items-center gap-2 rounded-lg px-3 py-2 font-semibold ${borne ? 'text-base' : 'text-sm'} ${
            passee ? 'bg-amber-50 text-amber-800' : 'bg-brand-50 text-brand-800'}`}>
            <CalendarCheck className={`${borne ? 'w-5 h-5' : 'w-4 h-4'} shrink-0`} aria-hidden="true" />
            <span>
              {phrasePret(dateChoisie, now)}
              {passee && <span className="block text-sm font-medium">Cette heure est déjà passée.</span>}
            </span>
          </span>
        ) : null}
      </div>

      {error && (
        <div id={erreurId} role="alert" className="input-error text-sm">{error}</div>
      )}
    </div>
  );
}
