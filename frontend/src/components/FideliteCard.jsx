import { useState, useEffect } from 'react';
import api from '../lib/api';
import { Gift, Loader2, Star } from 'lucide-react';

// Montants au format français : « 1 234,50 € », « 10 € » pour un montant rond
const euros = (v) => {
  const n = Number(v) || 0;
  return n.toLocaleString('fr-FR', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2,
  });
};
const nombre = (v) => (Number(v) || 0).toLocaleString('fr-FR');

// Suivi public (ticketCode) : `preuve` = { t } jeton du lien ou { tel } numéro complet, exigée par le serveur
export default function FideliteCard({ clientId, ticketCode, preuve = null, compact = false }) {
  const [fidelite, setFidelite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [using, setUsing] = useState(false);
  const [erreur, setErreur] = useState('');

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
        <Loader2 className="w-5 h-5 motion-safe:animate-spin text-slate-500" aria-hidden="true" />
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
    setErreur('');
    try {
      await api.utiliserPoints({ client_id: cid, type });
      // Refresh
      const data = clientId
        ? await api.getFidelite(clientId)
        : await api.getFideliteByTicket(ticketCode, preuve);
      setFidelite(data);
    } catch (err) {
      setErreur(err?.message || 'La récompense n’a pas pu être utilisée. Réessayez.');
    } finally {
      setUsing(false);
    }
  };

  // Barre de progression : monochrome slate sur slate-100, hauteur 8 px (le violet reste aux actions)
  const barre = (pourcent) => (
    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden" aria-hidden="true">
      <div className="h-full bg-slate-700 rounded-full transition-[width] duration-150 motion-reduce:transition-none"
        style={{ width: `${pourcent}%` }} />
    </div>
  );

  if (compact) {
    return (
      <div className="card p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <span className="t-h2 flex items-center gap-2">
            <Star className="w-4 h-4 text-slate-500" aria-hidden="true" /> Fidélité
          </span>
          <span className="text-lg font-semibold tabular-nums text-slate-900">{nombre(points)} pts</span>
        </div>
        <div className="mb-3">
          <div className="flex justify-between t-caption mb-1">
            <span>Film verre trempé</span>
            <span className="tabular-nums">{nombre(Math.min(points, palier_film))} / {nombre(palier_film)}</span>
          </div>
          {barre(progressFilm)}
        </div>
        <div>
          <div className="flex justify-between t-caption mb-1">
            <span>Réduction de {euros(montant_reduction)}</span>
            <span className="tabular-nums">{nombre(Math.min(points, palier_reduction))} / {nombre(palier_reduction)}</span>
          </div>
          {barre(progressReduction)}
        </div>
        {prochaine_recompense.points_restants > 0 && (
          <p className="text-center t-caption mt-3">
            Plus que <strong className="font-semibold text-slate-900 tabular-nums">{nombre(prochaine_recompense.points_restants)} pts</strong> pour : {prochaine_recompense.type}
          </p>
        )}
        {(recompenses_disponibles?.film || recompenses_disponibles?.reduction) && (
          <p className="mt-3 callout callout-info py-2">
            <Gift aria-hidden="true" />
            <span>Récompense valable pour votre prochaine réparation</span>
          </p>
        )}
      </div>
    );
  }

  return (
    <section className="card p-4 sm:p-5" aria-label="Programme fidélité">
      <h3 className="t-h2 mb-4 flex items-center gap-2">
        <Star className="w-4 h-4 text-slate-500" aria-hidden="true" /> Programme fidélité
      </h3>

      {/* Points */}
      <div className="card-section text-center mb-4">
        <div className="text-2xl font-semibold tabular-nums text-slate-900 leading-none">{nombre(points)}</div>
        <div className="text-sm text-slate-600 mt-1">points fidélité</div>
        <div className="text-xs text-slate-600 mt-1 tabular-nums">Total dépensé : {euros(total_depense)}</div>
      </div>

      {/* Film progress */}
      <div className="mb-4">
        <div className="flex justify-between t-caption mb-1.5">
          <span>Film verre trempé</span>
          <span className="tabular-nums">{nombre(Math.min(points, palier_film))} / {nombre(palier_film)} pts</span>
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
          <span>Réduction de {euros(montant_reduction)}</span>
          <span className="tabular-nums">{nombre(Math.min(points, palier_reduction))} / {nombre(palier_reduction)} pts</span>
        </div>
        {barre(progressReduction)}
        {recompenses_disponibles.reduction && clientId && (
          <button type="button" onClick={() => utiliserRecompense('reduction')} disabled={using} aria-busy={using || undefined}
            className="btn-secondary btn-block mt-2">
            {using ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : `Utiliser la réduction de ${euros(montant_reduction)}`}
          </button>
        )}
        {erreur && <p role="alert" className="input-error">{erreur}</p>}
      </div>

      {/* Prochaine récompense */}
      {prochaine_recompense.points_restants > 0 && (
        <p className="text-center t-caption mt-2">
          Plus que <strong className="font-semibold text-slate-900 tabular-nums">{nombre(prochaine_recompense.points_restants)} pts</strong>
          {' '}pour obtenir : {prochaine_recompense.type}
        </p>
      )}

      {/* Rappel : les récompenses sont appliquées à la prochaine réparation */}
      {(recompenses_disponibles?.film || recompenses_disponibles?.reduction) && (
        <p className="mt-3 callout callout-info">
          <Gift aria-hidden="true" />
          <span>À utiliser lors de la prochaine réparation</span>
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
