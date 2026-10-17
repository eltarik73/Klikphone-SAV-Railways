import { Search, FileText, Wrench, CheckCircle2, Package, Truck, Globe, Check } from 'lucide-react';

// Stepper monochrome (design V2) : la progression se lit au poids, pas à la couleur.
// Étape faite = cercle plein brand + coche ; courante = cercle blanc cerclé brand + icône ;
// à venir = cercle slate. Libellés 12 px minimum.
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
  'Pré-enregistré': -1,
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
  'Pré-enregistré': -1,
  'En attente de diagnostic': 0,
  "En attente d'accord client": 1,
  'En attente de pièce': 2,
  'Pièce reçue': 2,
  'En cours de réparation': 3,
  'Réparation terminée': 4,
  'Rendu au client': 5,
  'Clôturé': 5,
};

export default function ProgressTracker({ statut, hasPiece, isDistance }) {
  // For distance tickets with "Pré-enregistré", show a simplified tracker
  const isPreRegistered = statut === 'Pré-enregistré';
  const steps = hasPiece ? STEPS_PIECE : STEPS_NORMAL;
  const statusMap = hasPiece ? STATUS_TO_STEP_PIECE : STATUS_TO_STEP_NORMAL;
  const currentStep = statusMap[statut] ?? -1;

  if (isPreRegistered) {
    return (
      <div className="text-center py-2">
        <div className="w-12 h-12 rounded-full mx-auto mb-2 flex items-center justify-center bg-brand-50 text-brand-600">
          <Globe className="w-6 h-6" aria-hidden="true" />
        </div>
        <p className="text-sm font-semibold text-brand-700">Pré-enregistré</p>
        <p className="t-caption mt-1">En attente de validation par l'équipe</p>
      </div>
    );
  }

  // Grille à colonnes égales : aucun chevauchement de libellés à 390 px (6 étapes) ; les connecteurs
  // relient les centres des cercles et passent sous eux.
  const cols = steps.length === 6 ? 'grid-cols-6' : 'grid-cols-5';

  return (
    <div className={`grid ${cols} w-full min-w-0`}>
      {steps.map((step, i) => {
        const Icon = step.icon;
        const done = i < currentStep;
        const isCurrent = i === currentStep;

        const circleCls = done
          ? 'bg-brand-600 text-white'
          : isCurrent
            ? 'bg-white border-2 border-brand-600 text-brand-700'
            : 'bg-slate-100 text-slate-400';
        const labelCls = done || isCurrent
          ? 'text-xs font-semibold text-brand-700'
          : 'text-xs font-medium text-slate-500';
        const lineCls = i <= currentStep ? 'bg-brand-200' : 'bg-slate-200';

        return (
          <div key={i} className="relative flex flex-col items-center min-w-0 px-0.5">
            {i > 0 && (
              <div
                className={`absolute top-[15px] h-0.5 rounded-full left-[calc(-50%_+_18px)] right-[calc(50%_+_18px)] ${lineCls}`}
                aria-hidden="true"
              />
            )}
            <div
              className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center transition-colors duration-150 ${circleCls}`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {done ? <Check className="w-4 h-4" aria-hidden="true" /> : <Icon className="w-4 h-4" aria-hidden="true" />}
            </div>
            <span lang="fr" className={`mt-1.5 max-w-full text-center leading-tight tracking-tight break-words hyphens-auto ${labelCls}`}>
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
