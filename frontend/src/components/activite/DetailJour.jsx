import { useEffect, useRef } from 'react';
import { X, Loader2, MapPin } from 'lucide-react';
import {
  enteteJour, formatDistance, formatMinutes, heureParis, libelleAppareil, libellePresence, lienCarte, MOTIFS_FIN,
} from '../../lib/activiteEquipe';
import { IconeAppareil, PointPresence } from './Pastilles';

/**
 * Détail d'une journée d'un salarié : panneau sous la grille (feuille en bas d'écran sur mobile).
 * Échap ou le bouton ferme ; le focus revient sur la cellule (géré par la page).
 */
export default function DetailJour({ selection, etat, onFermer, onReessayer }) {
  const titreRef = useRef(null);
  const { utilisateur, jour, resume } = selection;
  const e = enteteJour(jour);

  useEffect(() => {
    titreRef.current?.focus({ preventScroll: false });
  }, [utilisateur, jour]);

  useEffect(() => {
    const onKey = (ev) => {
      if (ev.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) {
        ev.preventDefault();
        onFermer();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onFermer]);

  const sessions = Array.isArray(etat.sessions) ? etat.sessions : [];
  const nb = (v) => Math.max(0, Number(v) || 0);

  return (
    <>
      <div className="sm:hidden fixed inset-0 z-40 bg-slate-900/40" aria-hidden="true" onClick={onFermer} />
      <section
        aria-labelledby="detail-jour-titre"
        className="card mt-3 overflow-hidden
          max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-50 max-sm:mt-0 max-sm:rounded-b-none
          max-sm:max-h-[75vh] max-sm:flex max-sm:flex-col max-sm:shadow-lg"
      >
        <div className="flex items-center gap-3 pl-4 pr-1.5 py-1.5 border-b border-slate-100">
          <div className="min-w-0 flex-1">
            <h2 id="detail-jour-titre" ref={titreRef} tabIndex={-1}
              className="text-sm font-semibold text-slate-900 focus:outline-none first-letter:uppercase">
              {utilisateur} · {e.long}
            </h2>
            {resume && (
              <p className="text-xs text-slate-600 tabular-nums">
                {heureParis(resume.arrivee)} – {resume.en_cours ? 'en cours' : heureParis(resume.depart)}
                {' · '}{formatMinutes(resume.duree_min)}
                {' · '}{nb(resume.sessions)} session{nb(resume.sessions) > 1 ? 's' : ''}
                {' · '}{nb(resume.actions)} action{nb(resume.actions) > 1 ? 's' : ''}
                {resume.tickets_crees !== undefined && resume.tickets_crees !== null
                  && ` · ${nb(resume.tickets_crees)} ticket${nb(resume.tickets_crees) > 1 ? 's' : ''} créé${nb(resume.tickets_crees) > 1 ? 's' : ''}`}
              </p>
            )}
          </div>
          <button type="button" onClick={onFermer} className="btn-ghost btn-icon w-11 h-11 min-w-[44px]"
            aria-label="Fermer le détail (Échap)">
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="max-sm:overflow-y-auto">
          {etat.statut === 'chargement' && (
            <p className="loading-inline px-4 py-3" role="status">
              <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> Chargement des sessions…
            </p>
          )}
          {etat.statut === 'erreur' && (
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm text-red-700" role="alert">
              {etat.erreur}
              <button type="button" className="btn-secondary btn-sm" onClick={onReessayer}>Réessayer</button>
            </div>
          )}
          {etat.statut === 'pret' && !sessions.length && (
            <p className="px-4 py-3 text-sm text-slate-500">Aucune session ce jour-là.</p>
          )}
          {etat.statut === 'pret' && sessions.length > 0 && (
            <ol className="divide-y divide-slate-100" aria-label="Sessions de la journée">
              {sessions.map((s, i) => (
                <li key={`${s.debut}-${i}`}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-4 py-2 text-[13px] text-slate-700">
                  <span className="font-semibold tabular-nums text-slate-900 whitespace-nowrap">
                    {heureParis(s.debut)} → {finSession(s)}
                  </span>
                  <Sep /><span className="tabular-nums">{formatMinutes(s.duree_min)}</span>
                  {s.poste && (<><Sep /><span className="font-medium">{s.poste}</span></>)}
                  <Sep />
                  <span className="inline-flex items-center gap-1">
                    <IconeAppareil appareil={s.appareil} />
                    {libelleAppareil(s.appareil).replace(/ · /g, ' ')}
                  </span>
                  <Sep /><span className="tabular-nums">{nb(s.actions)} action{nb(s.actions) > 1 ? 's' : ''}</span>
                  <Sep />
                  <span className="inline-flex items-center gap-1.5">
                    <PointPresence statut={s.geo_statut} distance={s.geo_distance_m} className="w-2.5 h-2.5" />
                    {libellePresence(s.geo_statut, s.geo_distance_m)}
                  </span>
                  {/* Lieu de la connexion hors de la boutique : l'adresse d'abord, la carte au clic */}
                  {lienCarte(s.geo_lat, s.geo_lng) && (
                    <a href={lienCarte(s.geo_lat, s.geo_lng)} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 min-h-11 text-slate-800 font-medium underline decoration-slate-300 underline-offset-2 hover:text-brand-800 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                      aria-label={`${s.geo_lieu ? `Près de ${s.geo_lieu}` : 'Position approximative'} à ${s.debut} : voir sur la carte (s’ouvre dans un nouvel onglet)`}>
                      <MapPin className="w-3.5 h-3.5 text-brand-700 shrink-0" aria-hidden="true" />
                      {s.geo_lieu ? `Près de ${s.geo_lieu}` : 'Voir sur la carte'}
                    </a>
                  )}
                  {lienCarte(s.geo_lat, s.geo_lng) && s.geo_precision_m > 200 && (
                    <span className="text-xs text-slate-500">± {formatDistance(s.geo_precision_m)}</span>
                  )}
                  {s.fin && s.fin_motif && (
                    <span className="sm:ml-auto text-xs text-slate-500">{MOTIFS_FIN[s.fin_motif] || s.fin_motif}</span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </>
  );
}

// Fin de session : heure de fin ; ouverte et active : « en cours » ; ouverte mais inactive : dernière activité
function finSession(s) {
  if (s.fin) return heureParis(s.fin);
  if (s.en_cours || !s.derniere_activite) return <span className="text-emerald-700">en cours</span>;
  return <>{heureParis(s.derniere_activite)} <span className="font-normal text-slate-500">(sans déconnexion)</span></>;
}

function Sep() {
  return <span aria-hidden="true" className="text-slate-400">·</span>;
}
