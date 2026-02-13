import { Search, FileText, Wrench, CheckCircle2, Package, Truck } from 'lucide-react';

const STEPS_NORMAL = [
  { label: 'Diagnostic', icon: Search },
  { label: 'Devis', icon: FileText },
  { label: 'Réparation', icon: Wrench },
  { label: 'Terminé', icon: CheckCircle2 },
  { label: 'Rendu', icon: Package },
];

const STEPS_PIECE = [
  { label: 'Diagnostic', icon: Search },
  { label: 'Devis', icon: FileText },
  { label: 'Pièce', icon: Truck },
  { label: 'Réparation', icon: Wrench },
  { label: 'Terminé', icon: CheckCircle2 },
  { label: 'Rendu', icon: Package },
];

const STATUS_TO_STEP_NORMAL = {
  'En attente de diagnostic': 0,
  'En attente de pièce': 1,
  'Pièce reçue': 1,
  "En attente d'accord client": 1,
  'En cours de réparation': 2,
  'Réparation terminée': 3,
  'Rendu au client': 4,
  'Clôturé': 4,
};

const STATUS_TO_STEP_PIECE = {
  'En attente de diagnostic': 0,
  "En attente d'accord client": 1,
  'En attente de pièce': 2,
  'Pièce reçue': 2,
  'En cours de réparation': 3,
  'Réparation terminée': 4,
  'Rendu au client': 5,
  'Clôturé': 5,
};

export default function ProgressTracker({ statut, hasPiece }) {
  const steps = hasPiece ? STEPS_PIECE : STEPS_NORMAL;
  const statusMap = hasPiece ? STATUS_TO_STEP_PIECE : STATUS_TO_STEP_NORMAL;
  const currentStep = statusMap[statut] ?? -1;

  return (
    <div className="flex items-center justify-between w-full">
      {steps.map((step, i) => {
        const Icon = step.icon;
        const done = i <= currentStep;
        const isCurrent = i === currentStep;
        return (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all
                ${done
                  ? 'bg-brand-600 text-white shadow-md shadow-brand-600/30'
                  : 'bg-slate-100 text-slate-400'
                }
                ${isCurrent ? 'ring-4 ring-brand-100 scale-110' : ''}
              `}>
                <Icon className="w-4.5 h-4.5" />
              </div>
              <span className={`text-[10px] mt-1.5 font-medium ${done ? 'text-brand-700' : 'text-slate-400'}`}>
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-0.5 mx-2 rounded-full transition-colors ${
                i < currentStep ? 'bg-brand-500' : 'bg-slate-200'
              }`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
