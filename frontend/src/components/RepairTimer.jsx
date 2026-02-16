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
    const start = new Date(ticket.reparation_debut).getTime();
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

  return (
    <div className={`mt-3 px-4 py-3 rounded-xl flex items-center justify-between ${
      hasFinished
        ? 'bg-emerald-50 border border-emerald-200'
        : 'bg-violet-50/60 border border-violet-200/60'
    }`}>
      <div className="flex items-center gap-2.5">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
          hasFinished ? 'bg-emerald-100' : 'bg-violet-100'
        }`}>
          {hasFinished
            ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            : <Timer className="w-4 h-4 text-violet-600" />
          }
        </div>
        <div>
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            {hasFinished ? 'Réparé en' : 'Temps de réparation'}
          </div>
          <div className={`text-lg font-extrabold font-mono tracking-wide ${
            hasFinished ? 'text-emerald-600' : 'text-violet-600'
          }`}>
            {display}
          </div>
        </div>
      </div>
      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${
        hasFinished
          ? 'bg-emerald-100 text-emerald-600'
          : 'bg-violet-100 text-violet-600'
      }`}>
        {isRepairing && (
          <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
        )}
        {hasFinished ? 'TERMINÉ' : 'EN COURS'}
      </div>
    </div>
  );
}
