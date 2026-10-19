import { useCallback, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { RefreshCw, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useVerificationVersion, INTERVALLE_PERSONNEL_MS } from '../lib/miseAJour';

// Écrans du personnel : /accueil/… et /tech/… (ni la borne, ni les pages publiques)
const RE_ECRAN_PERSONNEL = /^\/(accueil|tech)(\/|$)/;

/**
 * Bandeau discret « Nouvelle version disponible » + « Recharger » (fixe en bas, fermable).
 * Jamais de rechargement forcé : la personne recharge quand sa saisie est enregistrée.
 * La zone role="status" existe dès que le bandeau est actif, pour que l'annonce soit lue.
 */
export function BandeauNouvelleVersion({ actif = true, intervalleMs = INTERVALLE_PERSONNEL_MS }) {
  const [disponible, setDisponible] = useState(false);
  const [ferme, setFerme] = useState(false);
  const signaler = useCallback(() => setDisponible(true), []);
  useVerificationVersion({ actif, intervalleMs, onNouvelle: signaler });

  if (!actif) return null;
  const visible = disponible && !ferme;

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print fixed inset-x-0 z-40 flex justify-center px-4 pointer-events-none
        bottom-[calc(max(1rem,env(safe-area-inset-bottom))+3.75rem)] lg:bottom-6"
    >
      {visible && (
        <div className="pointer-events-auto animate-in flex items-center gap-2 sm:gap-3 max-w-md w-full sm:w-auto
          rounded-xl bg-slate-900 text-white shadow-lg ring-1 ring-white/10 pl-4 pr-1.5 py-1.5">
          <RefreshCw className="w-4 h-4 shrink-0 text-brand-300" aria-hidden="true" />
          <p className="flex-1 min-w-0 text-sm font-semibold leading-snug">Nouvelle version disponible</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn min-h-[44px] bg-white text-slate-900 hover:bg-slate-100 shadow-xs focus-visible:ring-offset-slate-900"
          >
            Recharger
          </button>
          <button
            type="button"
            onClick={() => setFerme(true)}
            aria-label="Fermer"
            title="Fermer"
            className="btn btn-icon w-11 h-11 min-w-[44px] min-h-[44px] text-slate-300 hover:text-white hover:bg-white/10 focus-visible:ring-offset-slate-900"
          >
            <X aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

/** Monté une fois dans App.jsx : actif seulement pour une personne connectée sur un écran du personnel. */
export default function NouvelleVersion() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  return <BandeauNouvelleVersion actif={Boolean(user) && RE_ECRAN_PERSONNEL.test(pathname)} />;
}
