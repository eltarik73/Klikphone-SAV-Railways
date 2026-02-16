import { X, Timer, Clock, ListOrdered, GripVertical, RotateCcw, Save, Info } from 'lucide-react';

function ToggleSwitch({ icon: Icon, label, desc, value, onChange }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-100 last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Icon className="w-4 h-4 text-slate-500 shrink-0" />
          {label}
        </div>
        <div className="text-[11px] text-slate-400 mt-0.5 ml-6">{desc}</div>
      </div>
      <button
        onClick={onChange}
        className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ml-3 ${
          value ? 'bg-emerald-500' : 'bg-slate-300'
        }`}
      >
        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-200 ${
          value ? 'left-6' : 'left-1'
        }`} />
      </button>
    </div>
  );
}

export default function PersonnaliserPanel({
  open,
  onClose,
  prefs,
  onPrefsChange,
  layoutEditMode,
  onToggleEditMode,
  onSaveLayout,
  onResetLayout,
}) {
  if (!open) return null;

  const handleToggle = (key) => {
    onPrefsChange({ ...prefs, [key]: !prefs[key] });
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 backdrop-blur-[2px] z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-full sm:w-[340px] bg-white shadow-2xl z-50 flex flex-col animate-in">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div>
            <div className="text-base font-extrabold text-slate-800">Personnaliser</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Tes préférences d'affichage</div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Toggles section */}
          <div className="px-5 py-4 border-b border-slate-100">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
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
              desc="Bouton pour voir les prochaines réparations"
              value={prefs.queue}
              onChange={() => handleToggle('queue')}
            />
          </div>

          {/* Layout section */}
          <div className="px-5 py-4">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">
              Sections de la fiche
            </div>
            <button
              onClick={() => { onToggleEditMode(); onClose(); }}
              className={`w-full flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-semibold transition-colors ${
                layoutEditMode
                  ? 'bg-brand-50 text-brand-700 border border-brand-200'
                  : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <GripVertical className="w-4 h-4" />
              {layoutEditMode ? 'Mode édition actif' : 'Réorganiser les sections'}
            </button>
            <p className="text-[11px] text-slate-400 mt-2 ml-1">
              Glissez-déposez les blocs, changez leur taille (S/M/L) et déplacez-les entre colonnes.
            </p>

            {layoutEditMode && (
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => { onSaveLayout(); onClose(); }}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700 transition-colors"
                >
                  <Save className="w-3.5 h-3.5" /> Sauver
                </button>
                <button
                  onClick={() => { onResetLayout(); onClose(); }}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold hover:bg-slate-200 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Réinitialiser
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer note */}
        <div className="px-5 py-3 border-t border-slate-100 bg-emerald-50/50 shrink-0">
          <div className="flex items-start gap-2">
            <Info className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
            <div>
              <div className="text-[11px] font-semibold text-emerald-700">
                Les données sont toujours enregistrées
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                Même si un widget est masqué, les données sont sauvegardées pour le reporting.
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
