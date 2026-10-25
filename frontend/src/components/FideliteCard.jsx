import { useState, useEffect } from 'react';
import api from '../lib/api';
import { Loader2, Star, Sparkles } from 'lucide-react';

// Suivi public (ticketCode) : `preuve` = { t } jeton du lien ou { tel } numéro complet, exigée par le serveur
export default function FideliteCard({ clientId, ticketCode, preuve = null, compact = false }) {
  const [fidelite, setFidelite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [using, setUsing] = useState(false);

  useEffect(() => {
    if (!clientId && !ticketCode) return;
    setLoading(true);
    const promise = clientId
      ? api.getFidelite(clientId)
      : api.getFideliteByTicket(ticketCode, preuve);
    promise
      .then(setFidelite)
      .catch(() => setFidelite(null))
      .finally(() => setLoading(false));
  }, [clientId, ticketCode, preuve]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4" aria-busy="true">
        <Loader2 className="w-5 h-5 motion-safe:animate-spin text-brand-600" aria-hidden="true" />
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
        : await api.getFideliteByTicket(ticketCode, preuve);
      setFidelite(data);
    } catch (err) {
      alert(err.message || 'Erreur');
    } finally {
      setUsing(false);
    }
  };

  // Barre de progression : monochrome brand sur slate-100, hauteur 8 px
  const barre = (pourcent) => (
    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden" aria-hidden="true">
      <div className="h-full bg-brand-600 rounded-full transition-[width] duration-500 motion-reduce:transition-none"
        style={{ width: `${pourcent}%` }} />
    </div>
  );

  if (compact) {
    return (
      <div className="card p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <span className="t-h2 flex items-center gap-2">
            <Star className="w-4 h-4 text-brand-600" aria-hidden="true" /> Fidélité
          </span>
          <span className="text-lg font-bold tabular-nums text-brand-700">{points} pts</span>
        </div>
        <div className="mb-3">
          <div className="flex justify-between t-caption mb-1">
            <span>Film verre trempé</span>
            <span className="tabular-nums">{Math.min(points, palier_film)} / {palier_film.toLocaleString()}</span>
          </div>
          {barre(progressFilm)}
        </div>
        <div>
          <div className="flex justify-between t-caption mb-1">
            <span>Réduction {montant_reduction}€</span>
            <span className="tabular-nums">{Math.min(points, palier_reduction)} / {palier_reduction.toLocaleString()}</span>
          </div>
          {barre(progressReduction)}
        </div>
        {prochaine_recompense.points_restants > 0 && (
          <p className="text-center t-caption mt-3">
            Plus que <strong className="text-brand-700">{prochaine_recompense.points_restants} pts</strong> pour : {prochaine_recompense.type}
          </p>
        )}
        {(recompenses_disponibles?.film || recompenses_disponibles?.reduction) && (
          <p className="mt-3 callout bg-brand-50 border-brand-200 text-brand-800 py-2 text-xs font-semibold">
            <Sparkles aria-hidden="true" />
            <span>Valable pour votre <strong>prochaine réparation</strong></span>
          </p>
        )}
      </div>
    );
  }

  return (
    <section className="card p-4 sm:p-5" aria-label="Programme Fidélité">
      <h3 className="t-h2 mb-4 flex items-center gap-2">
        <Star className="w-4 h-4 text-brand-600" aria-hidden="true" /> Programme Fidélité
      </h3>

      {/* Points */}
      <div className="card-section text-center mb-4">
        <div className="text-2xl font-bold tabular-nums text-brand-700 leading-none">{points.toLocaleString()}</div>
        <div className="text-sm text-slate-600 mt-1">points fidélité</div>
        <div className="t-caption mt-1">Total dépensé : {total_depense.toFixed(2)} €</div>
      </div>

      {/* Film progress */}
      <div className="mb-4">
        <div className="flex justify-between t-caption mb-1.5">
          <span>Film verre trempé</span>
          <span className="tabular-nums">{Math.min(points, palier_film).toLocaleString()} / {palier_film.toLocaleString()} pts</span>
        </div>
        {barre(progressFilm)}
        {recompenses_disponibles.film && clientId && (
          <button type="button" onClick={() => utiliserRecompense('film')} disabled={using} aria-busy={using || undefined}
            className="btn-secondary btn-block mt-2">
            {using ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : 'Offrir le film verre trempé'}
          </button>
        )}
      </div>

      {/* Reduction progress */}
      <div className="mb-3">
        <div className="flex justify-between t-caption mb-1.5">
          <span>Réduction {montant_reduction}€</span>
          <span className="tabular-nums">{Math.min(points, palier_reduction).toLocaleString()} / {palier_reduction.toLocaleString()} pts</span>
        </div>
        {barre(progressReduction)}
        {recompenses_disponibles.reduction && clientId && (
          <button type="button" onClick={() => utiliserRecompense('reduction')} disabled={using} aria-busy={using || undefined}
            className="btn-secondary btn-block mt-2">
            {using ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : `Utiliser la réduction ${montant_reduction}€`}
          </button>
        )}
      </div>

      {/* Prochaine récompense */}
      {prochaine_recompense.points_restants > 0 && (
        <p className="text-center t-caption mt-2">
          Plus que <strong className="text-brand-700">{prochaine_recompense.points_restants} pts</strong>
          {' '}pour obtenir : {prochaine_recompense.type}
        </p>
      )}

      {/* Rappel : les recompenses sont appliquees a la prochaine reparation */}
      {(recompenses_disponibles?.film || recompenses_disponibles?.reduction) && (
        <p className="mt-3 callout bg-brand-50 border-brand-200 text-brand-800 font-semibold">
          <Sparkles aria-hidden="true" />
          <span>À utiliser lors de la <strong>prochaine réparation</strong></span>
        </p>
      )}

      {/* Historique */}
      {historique && historique.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <p className="t-h3 mb-2">Dernières opérations</p>
          <ul className="space-y-1.5">
            {historique.slice(0, 5).map((h, i) => (
              <li key={i} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-slate-600 truncate flex-1 min-w-0">{h.description}</span>
                <span className={`font-semibold tabular-nums shrink-0 ${h.points > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {h.points > 0 ? '+' : ''}{h.points}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
