import { useId } from 'react';
import { Circle, Zap, Hourglass, Briefcase } from 'lucide-react';

/**
 * Priorité atelier d'un ticket (colonne tickets.priorite).
 * Valeurs du serveur : 'normal' | 'express' | 'attente' (client qui attend sur place) | 'pro'.
 * La file atelier les trie dans l'ordre ORDRE_PRIORITE (attente, express, pro, normal).
 *
 * - <PrioriteBadge priorite="attente" /> : rien pour « normal » (sauf afficherNormal).
 * - <PrioriteSelecteur value={...} onChange={(valeur) => ...} /> : 4 boutons radio (flèches au clavier).
 */
export const PRIORITES = [
  {
    valeur: 'normal', libelle: 'Normal', court: 'Normal', icone: Circle,
    badge: 'bg-slate-100 text-slate-700 ring-slate-300',
    choisi: 'bg-slate-700 text-white border-slate-700',
    libre: 'text-slate-700',
  },
  {
    valeur: 'express', libelle: 'Express', court: 'Express', icone: Zap,
    badge: 'bg-amber-100 text-amber-900 ring-amber-400',
    choisi: 'bg-amber-400 text-amber-950 border-amber-500',
    libre: 'text-amber-900',
  },
  {
    valeur: 'attente', libelle: 'Client attend sur place', court: 'Attend sur place', icone: Hourglass,
    badge: 'bg-red-600 text-white ring-red-700',
    choisi: 'bg-red-600 text-white border-red-700 shadow-md shadow-red-600/30',
    libre: 'text-red-700',
  },
  {
    valeur: 'pro', libelle: 'Pro', court: 'Pro', icone: Briefcase,
    badge: 'bg-sky-100 text-sky-900 ring-sky-300',
    choisi: 'bg-sky-700 text-white border-sky-700',
    libre: 'text-sky-800',
  },
];

export const VALEURS_PRIORITE = PRIORITES.map(p => p.valeur);
export const ORDRE_PRIORITE = { attente: 0, express: 1, pro: 2, normal: 3 };

const PAR_VALEUR = Object.fromEntries(PRIORITES.map(p => [p.valeur, p]));

/** Valeur connue, sinon 'normal' (ancienne ligne sans colonne, valeur inattendue). */
export function normaliserPriorite(valeur) {
  const v = String(valeur ?? '').trim().toLowerCase();
  return PAR_VALEUR[v] ? v : 'normal';
}

export function prioriteConfig(valeur) {
  return PAR_VALEUR[normaliserPriorite(valeur)];
}

export function libellePriorite(valeur) {
  return prioriteConfig(valeur).libelle;
}

/** Tri de file : attente, express, pro, normal. */
export function comparerPriorite(a, b) {
  return ORDRE_PRIORITE[normaliserPriorite(a)] - ORDRE_PRIORITE[normaliserPriorite(b)];
}

const TAILLES = {
  sm: 'text-[11px] px-2 py-0.5 gap-1',
  md: 'text-xs px-2.5 py-1 gap-1.5',
  lg: 'text-sm px-3 py-1.5 gap-1.5',
};
const ICONES = { sm: 'w-3 h-3', md: 'w-3.5 h-3.5', lg: 'w-4 h-4' };

export function PrioriteBadge({ priorite, taille = 'sm', afficherNormal = false, court = false, className = '' }) {
  const p = prioriteConfig(priorite);
  if (p.valeur === 'normal' && !afficherNormal) return null;
  const Icone = p.icone;
  return (
    <span
      className={`inline-flex items-center rounded-full font-bold ring-1 whitespace-nowrap ${TAILLES[taille] || TAILLES.sm} ${p.badge} ${className}`}
      title={`Priorité : ${p.libelle}`}
    >
      <Icone className={ICONES[taille] || ICONES.sm} aria-hidden="true" />
      <span className="sr-only">Priorité : </span>
      {court ? p.court : p.libelle}
    </span>
  );
}

export function PrioriteSelecteur({ value, onChange, disabled = false, legende = 'Priorité atelier', masquerLegende = false, className = '' }) {
  const nom = useId();
  const courant = normaliserPriorite(value);
  return (
    <fieldset className={`min-w-0 ${className}`} disabled={disabled}>
      <legend className={masquerLegende ? 'sr-only' : 'block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5'}>{legende}</legend>
      <div className="flex flex-wrap gap-2">
        {PRIORITES.map(p => {
          const Icone = p.icone;
          const choisi = courant === p.valeur;
          return (
            <label key={p.valeur} className={`relative ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
              <input
                type="radio"
                name={nom}
                value={p.valeur}
                checked={choisi}
                onChange={() => onChange?.(p.valeur)}
                className="peer sr-only"
              />
              <span
                className={`inline-flex items-center gap-1.5 min-h-11 px-3.5 rounded-xl border-2 text-sm font-bold transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-2 ${
                  choisi ? p.choisi : `bg-white border-slate-200 hover:bg-slate-50 ${p.libre}`}`}
              >
                <Icone className="w-4 h-4 shrink-0" aria-hidden="true" />
                {p.libelle}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export default PrioriteBadge;
