import { X, Timer, Clock, ListOrdered, RotateCcw, Info, Shuffle } from 'lucide-react';
import Interrupteur from './Interrupteur';

const WIDGET_META = {
  client: { label: 'Client' },
  device: { label: 'Appareil' },
  reception: { label: 'Réception' },
  dates: { label: 'Dates' },
  reparation: { label: 'Réparation & Tarifs' },
  status: { label: 'Statut' },
  queue: { label: "File d'attente" },
  messages: { label: 'Messages' },
  notes: { label: 'Notes internes' },
  fidelite: { label: 'Fidélité' },
};

// Ligne de réglage : libellé + icône, description, interrupteur partagé (cible 44 px, piste 44 × 24)
const LIGNE_REGLAGE = 'py-2 border-b border-slate-100 last:border-b-0';

export default function PersonnaliserPanel({
  open,
  onClose,
  prefs,
  onPrefsChange,
  layout,
  onResetLayout,
  editMode,
  onToggleEditMode,
}) {
  if (!open) return null;

  const handleToggle = (key) => {
    onPrefsChange({ ...prefs, [key]: !prefs[key] });
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-slate-900/50 z-40" onClick={onClose} aria-hidden="true" />

      {/* Panel */}
      <div className="drawer sm:w-[340px]" role="dialog" aria-label="Personnaliser">
        {/* Header */}
        <div className="drawer-header py-2">
          <div className="min-w-0">
            <div className="t-h2">Personnaliser</div>
            <div className="t-caption mt-0.5">Vos préférences d’affichage</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="btn-ghost btn-icon -mr-2"
          >
            <X aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Toggles section */}
          <div className="px-4 sm:px-5 py-4 border-b border-slate-100">
            <div className="t-h3 mb-1">
              Widgets
            </div>
            <Interrupteur
              className={LIGNE_REGLAGE}
              icone={Timer}
              label="Timer de réparation"
              description="Chrono du temps passé sur la réparation"
              checked={prefs.timer}
              onChange={() => handleToggle('timer')}
            />
            <Interrupteur
              className={LIGNE_REGLAGE}
              icone={Clock}
              label="Compte à rebours"
              description="Temps restant avant récupération"
              checked={prefs.countdown}
              onChange={() => handleToggle('countdown')}
            />
            <Interrupteur
              className={LIGNE_REGLAGE}
              icone={ListOrdered}
              label="File d'attente"
              description="Widget avec les prochaines réparations"
              checked={prefs.queue}
              onChange={() => handleToggle('queue')}
            />
          </div>

          {/* Disposition section */}
          <div className="px-4 sm:px-5 py-4 border-b border-slate-100">
            <div className="t-h3 mb-1">
              Disposition
            </div>
            <Interrupteur
              className={LIGNE_REGLAGE}
              icone={Shuffle}
              label="Mode édition"
              description="Déplacer les widgets entre colonnes"
              checked={editMode}
              onChange={() => { onToggleEditMode(); onClose(); }}
            />
            {editMode && (
              <div className="callout callout-info mt-2 items-start">
                <Info aria-hidden="true" />
                <div>
                  <div className="text-sm font-semibold">Mode édition activé</div>
                  <div className="text-xs mt-0.5">
                    Glissez les widgets sur la page, puis désactivez le mode édition.
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Current layout view */}
          {layout && (
            <div className="px-4 sm:px-5 py-4">
              <div className="t-h3 mb-3">
                Position des widgets
              </div>

              {/* Left column */}
              <div className="mb-3">
                <div className="t-caption mb-1.5">Colonne gauche</div>
                <div className="space-y-1">
                  {layout.left.map(key => (
                    <div key={key} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-slate-50 text-xs font-medium text-slate-700">
                      {WIDGET_META[key]?.label || key}
                    </div>
                  ))}
                </div>
              </div>

              {/* Right column */}
              <div className="mb-3">
                <div className="t-caption mb-1.5">Colonne droite</div>
                <div className="space-y-1">
                  {layout.right.map(key => (
                    <div key={key} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-slate-50 text-xs font-medium text-slate-700">
                      {WIDGET_META[key]?.label || key}
                    </div>
                  ))}
                </div>
              </div>

              {/* Reset button */}
              <button
                type="button"
                onClick={() => { onResetLayout(); onClose(); }}
                className="btn-secondary btn-sm btn-block"
              >
                <RotateCcw aria-hidden="true" /> Réinitialiser la disposition
              </button>
            </div>
          )}
        </div>

        {/* Footer note */}
        <div className="drawer-footer bg-slate-50">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <div className="text-xs font-semibold text-slate-700">
                Les données sont toujours enregistrées
              </div>
              <div className="t-caption mt-0.5">
                Même si un widget est masqué, ses données restent enregistrées pour le reporting.
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
