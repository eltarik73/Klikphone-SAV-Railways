import { useState, useEffect } from 'react';
import { Timer, CheckCircle2 } from 'lucide-react';

export default function RepairTimer({ ticket, visible }) {
  const [elapsed, setElapsed] = useState(0);

  const isRepairing =
    ticket?.statut === 'En cours de réparation' &&
    ticket?.reparation_debut &&
    !ticket?.reparation_fin;
  const previousDuration = ticket?.reparation_duree || 0;
  const hasFinished = !isRepairing && previousDuration > 0;

  useEffect(() => {
    if (!isRepairing || !ticket.reparation_debut) return;
    // Ensure UTC parsing: backend sends ISO without timezone suffix
    const raw = ticket.reparation_debut;
    const start = new Date(raw.endsWith('Z') || raw.includes('+') ? raw : raw + 'Z').getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isRepairing, ticket?.reparation_debut]);

  if (!visible) return null;
  if (!isRepairing && !hasFinished) return null;

  const totalSec = isRepairing ? previousDuration + elapsed : previousDuration;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const display = h > 0
    ? `${h}h ${String(m).padStart(2, '0')}min`
    : `${m}min ${String(s).padStart(2, '0')}s`;

  // Design épuré : encart neutre (.card-section), chiffres tabulaires ; la couleur ne porte que le sens
  // (vert = terminé), aucune pulsation — le temps qui défile dit déjà que la réparation est en cours.
  return (
    <div className="card-section mt-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        {hasFinished
          ? <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-700" aria-hidden="true" />
          : <Timer className="w-5 h-5 shrink-0 text-slate-500" aria-hidden="true" />}
        <div className="min-w-0">
          <div className="t-caption">
            {hasFinished ? 'Réparé en' : 'Temps de réparation'}
          </div>
          <div className={`text-base font-semibold tabular-nums leading-tight ${
            hasFinished ? 'text-emerald-700' : 'text-slate-900'
          }`}>
            {display}
          </div>
        </div>
      </div>
      <span className={`badge shrink-0 ${hasFinished ? 'badge-success' : 'badge-neutral'}`}>
        {isRepairing && <span className="badge-dot" aria-hidden="true" />}
        {hasFinished ? 'Terminé' : 'En cours'}
      </span>
    </div>
  );
}
