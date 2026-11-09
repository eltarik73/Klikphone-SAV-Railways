import { forwardRef, useId, useRef } from 'react';

/**
 * Interrupteur accessible (role="switch") : cible 44 px, piste 44 × 24 px, pastille blanche 20 px.
 *
 * Deux emplois :
 *  - avec `label` (cas courant) : le composant pose la ligne entière — libellé cliquable (<label for>,
 *    relié par aria-labelledby), description facultative (aria-describedby) et l'interrupteur à droite
 *    (`placement="fin"`, défaut) ou à gauche du libellé (`placement="debut"`, barre de filtres) ;
 *  - sans `label` : seul le bouton est rendu, nommé par un titre voisin (`aria-labelledby`, `aria-describedby`)
 *    ou par `aria-label` — quand le libellé est un titre de section qui doit le rester.
 *
 * Props : checked, onChange(suivant) (appelé avec la nouvelle valeur), label, description, icone (composant
 * lucide posé devant le libellé), disabled, busy (aria-busy pendant un enregistrement), id (sinon généré),
 * placement, className (classes de la ligne), aria-label / aria-labelledby / aria-describedby. Le ref
 * (forwardRef) désigne le bouton, pour lui rendre le focus après une confirmation.
 *
 * Clavier : Espace et Entrée basculent (comme un bouton natif, sans double déclenchement).
 * Couleurs : coché brand-600 (5,7:1 sur blanc), décoché slate-500 (4,8:1 : une piste slate-300, 1,5:1,
 * se perd sur le blanc — WCAG 1.4.11 demande 3:1), désactivé à 60 % d'opacité.
 */
const Interrupteur = forwardRef(function Interrupteur({
  checked = false,
  onChange,
  label,
  description,
  icone: Icone,
  disabled = false,
  busy = false,
  id,
  placement = 'fin',
  className = '',
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
}, ref) {
  const auto = useId();
  const idBouton = id || `interrupteur${auto.replace(/:/g, '-')}`;
  const idLibelle = `${idBouton}-libelle`;
  const idDescription = `${idBouton}-description`;
  const actif = !!checked;
  const avecLibelle = label !== undefined && label !== null && label !== '';
  const avecDescription = description !== undefined && description !== null && description !== '';
  // Espace : bascule au relâchement, seulement si la touche a été enfoncée sur l'interrupteur
  const espace = useRef(false);

  const basculer = () => {
    if (!disabled) onChange?.(!actif);
  };

  // Le bouton natif cliquerait déjà sur Entrée (appui) et Espace (relâchement) ; on prend la main
  // (preventDefault) pour un comportement identique partout et un seul basculement
  const toucheEnfoncee = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!e.repeat) basculer();
    } else if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      espace.current = true;
    }
  };
  const toucheRelachee = (e) => {
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      if (espace.current) basculer();
      espace.current = false;
    }
  };

  const decritPar = [avecDescription ? idDescription : null, ariaDescribedby].filter(Boolean).join(' ') || undefined;

  const bouton = (
    <button
      ref={ref}
      type="button"
      role="switch"
      id={idBouton}
      aria-checked={actif}
      aria-label={avecLibelle ? undefined : ariaLabel}
      aria-labelledby={avecLibelle ? idLibelle : ariaLabelledby}
      aria-describedby={decritPar}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={basculer}
      onKeyDown={toucheEnfoncee}
      onKeyUp={toucheRelachee}
      onBlur={() => { espace.current = false; }}
      className="inline-flex min-h-11 min-w-14 shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed"
    >
      <span
        aria-hidden="true"
        className={`relative block h-6 w-11 rounded-full transition-colors duration-150 motion-reduce:transition-none ${actif ? 'bg-brand-600' : 'bg-slate-500'} ${disabled ? 'opacity-60' : ''}`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-xs transition-transform duration-150 motion-reduce:transition-none ${actif ? 'translate-x-5' : 'translate-x-0'}`}
        />
      </span>
    </button>
  );

  if (!avecLibelle) return bouton;

  const curseur = disabled ? 'cursor-not-allowed' : 'cursor-pointer';
  const descriptionNoeud = avecDescription && (
    <p id={idDescription} className={`t-caption mt-0.5 ${Icone && placement === 'fin' ? 'pl-6' : ''}`}>{description}</p>
  );

  if (placement === 'debut') {
    return (
      <div className={`flex items-center gap-3 min-h-11 ${className}`}>
        {bouton}
        <div className="min-w-0">
          <label id={idLibelle} htmlFor={idBouton} className={`block text-sm text-slate-700 select-none ${curseur}`}>
            {label}
          </label>
          {descriptionNoeud}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <label
          id={idLibelle}
          htmlFor={idBouton}
          className={`text-sm font-medium text-slate-800 ${curseur} ${Icone ? 'flex items-center gap-2' : 'block'}`}
        >
          {Icone && <Icone className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />}
          {label}
        </label>
        {descriptionNoeud}
      </div>
      {bouton}
    </div>
  );
});

export default Interrupteur;
