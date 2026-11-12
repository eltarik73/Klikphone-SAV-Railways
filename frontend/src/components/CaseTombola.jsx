import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { dateTirage, paragraphes, resumeLots, useTombolaEnCours } from '../lib/tombola';

/**
 * Règlement de la tombola dans une fenêtre : la borne garde le dépôt en cours (pas de changement
 * de page). Rendue dans <body>, comme la politique de confidentialité.
 */
export function ReglementTombola({ open, onClose, tombola }) {
  const boxRef = useRef(null);
  const titreId = useId();
  useFocusTrap(boxRef, open, { onEscape: () => onClose?.() });
  if (!open || !tombola || typeof document === 'undefined') return null;
  return createPortal(
    <div className="modal-overlay z-[60]" onClick={onClose}>
      <div ref={boxRef} role="dialog" aria-modal="true" aria-labelledby={titreId}
        onClick={(e) => e.stopPropagation()} className="modal sm:max-w-2xl max-h-[90vh]">
        <div className="modal-header">
          <h2 id={titreId} className="t-h2">Règlement de la tombola</h2>
          <button type="button" onClick={onClose} aria-label="Fermer le règlement"
            className="btn-ghost btn-icon min-w-11 min-h-11">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <div className="modal-body overscroll-contain space-y-3">
          <p className="t-body font-semibold text-slate-900">{tombola.titre}</p>
          {paragraphes(tombola.reglement).map((bloc, i) => (
            <p key={i} className="t-body whitespace-pre-line [overflow-wrap:anywhere]">{bloc}</p>
          ))}
        </div>
        <div className="modal-footer">
          <button type="button" onClick={onClose} className="btn-primary min-h-11">Fermer</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Case « Je participe à la tombola » des formulaires de dépôt (borne, comptoir, dépôt en ligne).
 * FACULTATIVE, jamais pré-cochée, sans effet sur la réparation ; rien ne s'affiche s'il n'y a pas
 * de tombola ouverte. Gratuite et sans obligation d'achat : la case le dit, le règlement aussi.
 */
export default function CaseTombola({ id, checked, onChange }) {
  const tombola = useTombolaEnCours();
  const [reglement, setReglement] = useState(false);
  if (!tombola) return null;
  const aideId = `${id}-aide`;
  const lots = resumeLots(tombola.lots);
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <label htmlFor={id} className="flex items-start gap-3 min-h-11 cursor-pointer">
        <input id={id} type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)}
          aria-describedby={aideId} className="checkbox w-6 h-6 mt-0.5" />
        <span className="text-base font-medium leading-snug text-slate-800 pt-0.5">
          Je participe à la tombola{lots ? <> : <span className="font-semibold text-slate-900">{lots}</span> à gagner</> : ''}
        </span>
      </label>
      {/* <span> et non <p> : `.depot-form p` imposerait 16 px slate-700 à cette aide */}
      <span id={aideId} className="block mt-1 pl-9 text-sm leading-snug text-slate-500">
        Gratuit, sans obligation d'achat et sans effet sur votre réparation. Tirage au sort le {dateTirage(tombola.tirage_le)}.
      </span>
      <button type="button" onClick={() => setReglement(true)}
        className="ml-9 inline-flex items-center min-h-11 text-sm font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded">
        Règlement de la tombola
      </button>
      <ReglementTombola open={reglement} onClose={() => setReglement(false)} tombola={tombola} />
    </div>
  );
}
