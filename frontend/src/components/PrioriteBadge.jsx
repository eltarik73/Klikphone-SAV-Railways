import { useId } from 'react';
import { Circle, Zap, Hourglass, Briefcase } from 'lucide-react';

/**
 * Priorité atelier d'un ticket (colonne tickets.priorite).
 * Valeurs du serveur : 'normal' | 'express' | 'attente' (client qui attend sur place) | 'pro'.
 * La file atelier les trie dans l'ordre ORDRE_PRIORITE (attente, express, pro, normal).
 *
 * - <PrioriteBadge priorite="attente" /> : rien pour « normal » (sauf afficherNormal).
 * - <PrioriteSelecteur value={...} onChange={(valeur) => ...} /> : 4 boutons radio (flèches au clavier).
 *
 * Design V2 : badges uniformes (.badge-neutral / .badge-warning / .badge-danger-solid / .badge-info,
 * sans bordure) ; le sélecteur est un segmented control neutre où seule l'icône porte la couleur.
 */
export const PRIORITES = [
  {
    valeur: 'normal', libelle: 'Normal', court: 'Normal', icone: Circle,
    badge: 'bg-slate-100 text-slate-700',
    icone_couleur: 'text-slate-700',
  },
  {
    valeur: 'express', libelle: 'Express', court: 'Express', icone: Zap,
    badge: 'bg-amber-50 text-amber-800',
    icone_couleur: 'text-amber-700',
  },
  {
    valeur: 'attente', libelle: 'Client attend sur place', court: 'Attend sur place', icone: Hourglass,
    badge: 'bg-red-600 text-white',
    icone_couleur: 'text-red-700',
  },
  {
    valeur: 'pro', libelle: 'Pro', court: 'Pro', icone: Briefcase,
    badge: 'bg-blue-50 text-blue-700',
    icone_couleur: 'text-blue-700',
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

// Jamais moins de 12 px (plancher de lisibilité)
const TAILLES = {
  sm: 'text-xs h-5 px-2 gap-1',
  md: 'text-xs h-6 px-2.5 gap-1.5',
  lg: 'text-sm h-8 px-3 gap-1.5',
};
const ICONES = { sm: 'w-3 h-3', md: 'w-3.5 h-3.5', lg: 'w-4 h-4' };

export function PrioriteBadge({ priorite, taille = 'sm', afficherNormal = false, court = false, className = '' }) {
  const p = prioriteConfig(priorite);
  if (p.valeur === 'normal' && !afficherNormal) return null;
  const Icone = p.icone;
  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold whitespace-nowrap leading-none ${TAILLES[taille] || TAILLES.sm} ${p.badge} ${className}`}
      title={`Priorité : ${p.libelle}`}
    >
      <Icone className={`shrink-0 ${ICONES[taille] || ICONES.sm}`} aria-hidden="true" />
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
      <legend className={masquerLegende ? 'sr-only' : 'block t-label mb-1.5'}>{legende}</legend>
      <div className={`segmented flex-wrap ${disabled ? 'opacity-60' : ''}`}>
        {PRIORITES.map(p => {
          const Icone = p.icone;
          const choisi = courant === p.valeur;
          return (
            <label key={p.valeur} className={`relative min-w-0 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
              <input
                type="radio"
                name={nom}
                value={p.valeur}
                checked={choisi}
                onChange={() => onChange?.(p.valeur)}
                className="peer sr-only"
              />
              <span
                className={`segmented-item min-h-10 w-full peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 ${
                  choisi ? 'segmented-item-active font-semibold' : ''}`}
              >
                <Icone className={`w-4 h-4 shrink-0 ${choisi ? p.icone_couleur : 'text-slate-500'}`} aria-hidden="true" />
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
