import { X, Timer, Clock, ListOrdered, RotateCcw, Info, Shuffle } from 'lucide-react';

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

function ToggleSwitch({ icon: Icon, label, desc, value, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-slate-100 last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          {typeof Icon === 'string'
            ? <span className="text-sm" aria-hidden="true">{Icon}</span>
            : <Icon className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
          }
          {label}
        </div>
        <div className="t-caption mt-0.5 ml-6">{desc}</div>
      </div>
      {/* Interrupteur : zone tactile 44 px autour d'un rail 44 × 24 */}
      <button
        type="button"
        role="switch"
        aria-checked={!!value}
        aria-label={label}
        onClick={onChange}
        className="relative flex items-center justify-center w-11 h-11 shrink-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <span className={`relative block w-11 h-6 rounded-full transition-colors duration-150 ${value ? 'bg-brand-600' : 'bg-slate-300'}`} aria-hidden="true">
          <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-xs transition-transform duration-150 ${
            value ? 'translate-x-5' : ''
          }`} />
        </span>
      </button>
    </div>
  );
}

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
            <div className="t-caption mt-0.5">Tes préférences d'affichage</div>
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
            <ToggleSwitch
              icon={Timer}
              label="Timer de réparation"
              desc="Chrono du temps passé sur la réparation"
              value={prefs.timer}
              onChange={() => handleToggle('timer')}
            />
            <ToggleSwitch
              icon={Clock}
              label="Compte à rebours"
              desc="Temps restant avant récupération"
              value={prefs.countdown}
              onChange={() => handleToggle('countdown')}
            />
            <ToggleSwitch
              icon={ListOrdered}
              label="File d'attente"
              desc="Widget avec les prochaines réparations"
              value={prefs.queue}
              onChange={() => handleToggle('queue')}
            />
          </div>

          {/* Disposition section */}
          <div className="px-4 sm:px-5 py-4 border-b border-slate-100">
            <div className="t-h3 mb-1">
              Disposition
            </div>
            <ToggleSwitch
              icon={Shuffle}
              label="Mode édition"
              desc="Déplacer les widgets entre colonnes"
              value={editMode}
              onChange={() => { onToggleEditMode(); onClose(); }}
            />
            {editMode && (
              <div className="callout callout-info mt-2 items-start">
                <Info aria-hidden="true" />
                <div>
                  <div className="text-sm font-semibold">Mode édition activé</div>
                  <div className="text-xs mt-0.5">
                    Glisse les widgets sur la page. Désactive quand c'est bon.
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
                    <div key={key} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-50 text-xs font-medium text-slate-700">
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
                    <div key={key} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-50 text-xs font-medium text-slate-700">
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
                Même si un widget est masqué, les données sont sauvegardées pour le reporting.
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
