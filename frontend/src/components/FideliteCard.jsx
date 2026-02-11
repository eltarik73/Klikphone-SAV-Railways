import { useState, useEffect } from 'react';
import api from '../lib/api';
import { Loader2 } from 'lucide-react';

export default function FideliteCard({ clientId, ticketCode, compact = false }) {
  const [fidelite, setFidelite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [using, setUsing] = useState(false);

  useEffect(() => {
    if (!clientId && !ticketCode) return;
    setLoading(true);
    const promise = clientId
      ? api.getFidelite(clientId)
      : api.getFideliteByTicket(ticketCode);
    promise
      .then(setFidelite)
      .catch(() => setFidelite(null))
      .finally(() => setLoading(false));
  }, [clientId, ticketCode]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
      </div>
    );
  }

  if (!fidelite || !fidelite.active) return null;

  const { points, total_depense, palier_film, palier_reduction, montant_reduction, prochaine_recompense, recompenses_disponibles, historique } = fidelite;

  const progressFilm = Math.min((points / palier_film) * 100, 100);
  const progressReduction = Math.min((points / palier_reduction) * 100, 100);

  const utiliserRecompense = async (type) => {
    if (using) return;
    const cid = clientId || fidelite._client_id;
    if (!cid) return;
    setUsing(true);
    try {
      await api.utiliserPoints({ client_id: cid, type });
      // Refresh
      const data = clientId
        ? await api.getFidelite(clientId)
        : await api.getFideliteByTicket(ticketCode);
      setFidelite(data);
    } catch (err) {
      alert(err.message || 'Erreur');
    } finally {
      setUsing(false);
    }
  };

  if (compact) {
    return (
      <div className="bg-gradient-to-br from-violet-50 to-indigo-50 rounded-xl border border-violet-200/60 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-violet-700 flex items-center gap-1.5">
            <span className="text-base">&#11088;</span> Fidélité
          </span>
          <span className="text-lg font-extrabold text-violet-600">{points} pts</span>
        </div>
        <div className="mb-2">
          <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
            <span>Film verre trempé</span>
            <span>{Math.min(points, palier_film)} / {palier_film.toLocaleString()}</span>
          </div>
          <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-violet-500 to-violet-600 rounded-full transition-all duration-500"
              style={{ width: `${progressFilm}%` }} />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
            <span>Réduction {montant_reduction}€</span>
            <span>{Math.min(points, palier_reduction)} / {palier_reduction.toLocaleString()}</span>
          </div>
          <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-full transition-all duration-500"
              style={{ width: `${progressReduction}%` }} />
          </div>
        </div>
        {prochaine_recompense.points_restants > 0 && (
          <p className="text-center text-[10px] text-slate-500 mt-2">
            Plus que <strong className="text-violet-600">{prochaine_recompense.points_restants} pts</strong> pour : {prochaine_recompense.type}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-violet-50 to-indigo-50 rounded-xl border border-violet-200 p-5">
      <h3 className="text-sm font-bold text-violet-700 mb-3 flex items-center gap-2">
        <span className="text-base">&#11088;</span> Programme Fidélité
      </h3>

      {/* Points */}
      <div className="text-center mb-4">
        <div className="text-4xl font-extrabold text-violet-600">{points.toLocaleString()}</div>
        <div className="text-sm text-slate-500">points fidélité</div>
        <div className="text-xs text-slate-400 mt-1">Total dépensé : {total_depense.toFixed(2)} €</div>
      </div>

      {/* Film progress */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span>Film verre trempé</span>
          <span>{Math.min(points, palier_film).toLocaleString()} / {palier_film.toLocaleString()} pts</span>
        </div>
        <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-violet-500 to-violet-600 rounded-full transition-all duration-500"
            style={{ width: `${progressFilm}%` }} />
        </div>
        {recompenses_disponibles.film && clientId && (
          <button onClick={() => utiliserRecompense('film')} disabled={using}
            className="mt-2 w-full py-2 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700 transition disabled:opacity-50">
            {using ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Offrir le film verre trempé'}
          </button>
        )}
      </div>

      {/* Reduction progress */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span>Réduction {montant_reduction}€</span>
          <span>{Math.min(points, palier_reduction).toLocaleString()} / {palier_reduction.toLocaleString()} pts</span>
        </div>
        <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-full transition-all duration-500"
            style={{ width: `${progressReduction}%` }} />
        </div>
        {recompenses_disponibles.reduction && clientId && (
          <button onClick={() => utiliserRecompense('reduction')} disabled={using}
            className="mt-2 w-full py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition disabled:opacity-50">
            {using ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : `Utiliser la réduction ${montant_reduction}€`}
          </button>
        )}
      </div>

      {/* Prochaine récompense */}
      {prochaine_recompense.points_restants > 0 && (
        <div className="text-center text-xs text-slate-500 bg-white/60 rounded-lg p-2 mt-2">
          Plus que <strong className="text-violet-600">{prochaine_recompense.points_restants} pts</strong>
          {' '}pour obtenir : {prochaine_recompense.type}
        </div>
      )}

      {/* Historique */}
      {historique && historique.length > 0 && (
        <div className="mt-4 pt-3 border-t border-violet-200/50">
          <p className="text-[10px] font-semibold text-violet-600 uppercase tracking-wider mb-2">Dernières opérations</p>
          <div className="space-y-1">
            {historique.slice(0, 5).map((h, i) => (
              <div key={i} className="flex items-center justify-between text-[11px]">
                <span className="text-slate-600 truncate flex-1">{h.description}</span>
                <span className={`font-bold ml-2 ${h.points > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {h.points > 0 ? '+' : ''}{h.points}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
