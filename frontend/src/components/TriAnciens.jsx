import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import api from '../lib/api';
import { invalidateCache } from '../hooks/useApi';
import { useAdminElevation } from '../hooks/useAdminElevation';
import { useToast } from './Toast';
import StatusBadge from './StatusBadge';
import { formatDateShort } from '../lib/utils';
import { AlertTriangle, CheckCircle2, RefreshCw, Square, SquareCheck, X } from 'lucide-react';

/**
 * Tri des réparations oubliées (admin) : dossiers ouverts déposés depuis plus de N jours, passés
 * en « Clôturé » d'un coup avec la note « Clôturé car plus de N jours » (GET/POST /api/admin/anciens).
 * Aucun paiement, aucun message au client ; un téléphone de prêt dehors bloque le dossier.
 */
export const JOURS_CHOIX = [60, 90, 180, 365];
const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

function appareil(t) {
  const modele = t.modele && t.modele !== 'Autre' ? t.modele : t.modele_autre;
  const marque = t.marque && t.marque !== 'Autre' ? t.marque : '';
  return [marque, modele].filter((v) => String(v ?? '').trim()).join(' ') || 'Appareil';
}

function joursDepuis(d) {
  if (!d) return null;
  const ms = Date.now() - new Date(d.endsWith?.('Z') || d.includes?.('+') ? d : `${d}Z`).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : null;
}

/** Dossiers cochés par défaut : tout sauf ceux qu'un téléphone de prêt dehors bloque. */
export function selectionParDefaut(tickets) {
  return new Set((tickets || []).filter((t) => !t.pret_dehors).map((t) => t.id));
}

/** « 12 dossiers clôturés (Réparation terminée : 7, En attente de pièce : 5) » */
export function resumeCloture(r) {
  const n = Number(r?.clotures) || 0;
  const detail = (r?.par_statut || []).map((s) => `${s.statut} : ${s.n}`).join(', ');
  let texte = n ? `${n} dossier${n > 1 ? 's' : ''} clôturé${n > 1 ? 's' : ''}` : 'Aucun dossier clôturé';
  if (detail) texte += ` (${detail})`;
  if (r?.ignores) texte += ` · ${r.ignores} laissé${r.ignores > 1 ? 's' : ''} tel${r.ignores > 1 ? 's' : ''} quel${r.ignores > 1 ? 's' : ''}`;
  return texte;
}

export default function TriAnciens({ id, basePath, onOpenTicket, onClose, onDone }) {
  const titreId = useId();
  const toast = useToast();
  const { sensible, adminPrompt } = useAdminElevation();
  const [jours, setJours] = useState(60);
  const [etat, setEtat] = useState({ chargement: true, data: null, erreur: '' });
  const [coches, setCoches] = useState(new Set());
  const [confirmation, setConfirmation] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [resultat, setResultat] = useState(null);

  const charger = useCallback(async (j) => {
    setEtat((e) => ({ ...e, chargement: true, erreur: '' }));
    setConfirmation(false);
    try {
      const data = await sensible(() => api.getAnciens(j));
      setEtat({ chargement: false, data, erreur: '' });
      setCoches(selectionParDefaut(data?.tickets));
    } catch (err) {
      if (err?.code === 'admin_cancelled') { onClose?.(); return; }
      setEtat({ chargement: false, data: null, erreur: err?.message || 'Lecture impossible' });
    }
  }, [sensible, onClose]);

  useEffect(() => { charger(jours); }, [jours]); // eslint-disable-line react-hooks/exhaustive-deps

  const tickets = etat.data?.tickets || [];
  const selectionnables = useMemo(() => tickets.filter((t) => !t.pret_dehors), [tickets]);
  const nbCoches = selectionnables.filter((t) => coches.has(t.id)).length;
  const toutCoche = selectionnables.length > 0 && nbCoches === selectionnables.length;

  const basculer = (tid) => setCoches((prev) => {
    const next = new Set(prev);
    if (next.has(tid)) next.delete(tid); else next.add(tid);
    return next;
  });
  const basculerTout = () => setCoches(toutCoche ? new Set() : selectionParDefaut(tickets));

  const cloturer = async () => {
    const ids = selectionnables.filter((t) => coches.has(t.id)).map((t) => t.id);
    if (!ids.length || envoi) return;
    setEnvoi(true);
    try {
      const r = await sensible(() => api.cloturerAnciens(jours, ids));
      setResultat(r);
      setConfirmation(false);
      invalidateCache('tickets', 'dashboard', 'interactions');
      toast.success(resumeCloture(r));
      onDone?.(r);
      await charger(jours);
    } catch (err) {
      if (err?.code !== 'admin_cancelled') toast.error(err?.message || 'Clôture impossible');
    } finally {
      setEnvoi(false);
    }
  };

  const total = etat.data?.total ?? 0;

  return (
    <section id={id} aria-labelledby={titreId} aria-busy={etat.chargement}
      className="card mb-6 overflow-hidden motion-safe:animate-in">
      <div className="border-b border-slate-100 px-4 sm:px-5 py-3 sm:py-4">
        <div className="flex items-center gap-3">
          <div className="kpi-icon bg-amber-50 text-amber-700" aria-hidden="true">
            <AlertTriangle />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id={titreId} className="t-h2">Réparations oubliées</h2>
            <p className="t-caption">
              Dossiers ni rendus ni clôturés, déposés depuis plus de {jours} jours. La clôture ajoute la note
              « Clôturé car plus de {jours} jours » ; ni paiement, ni message au client.
            </p>
          </div>
          <button type="button" onClick={() => charger(jours)} aria-label="Rafraîchir la liste" className="btn-ghost btn-icon">
            <RefreshCw className={etat.chargement ? 'motion-safe:animate-spin' : ''} aria-hidden="true" />
          </button>
          <button type="button" onClick={onClose} aria-label="Fermer le tri des réparations oubliées" className="btn-ghost btn-icon">
            <X aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="px-4 sm:px-5 py-3 flex flex-wrap items-center gap-3 border-b border-slate-100 bg-slate-50/60">
        <div className="segmented" role="group" aria-label="Ancienneté minimale">
          {JOURS_CHOIX.map((j) => (
            <button key={j} type="button" aria-pressed={jours === j} onClick={() => setJours(j)}
              className={`segmented-item ${jours === j ? 'segmented-item-active' : ''}`}>
              + {j} j
            </button>
          ))}
        </div>
        <p className="text-sm text-slate-700" role="status">
          {etat.chargement && !etat.data
            ? 'Lecture…'
            : <><strong className="text-slate-900">{total}</strong> dossier{total > 1 ? 's' : ''}
              {etat.data?.bloques ? ` · ${etat.data.bloques} avec un téléphone de prêt dehors (non clôturable)` : ''}
              {etat.data?.tronque ? ` · ${tickets.length} premiers affichés` : ''}</>}
        </p>
        {selectionnables.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            {confirmation ? (
              <>
                <span className="text-sm font-semibold text-amber-800">
                  Clôturer {nbCoches} dossier{nbCoches > 1 ? 's' : ''} ?
                </span>
                <button type="button" onClick={cloturer} disabled={envoi} className="btn-primary btn-sm">
                  {envoi ? <><RefreshCw className="motion-safe:animate-spin" aria-hidden="true" /> Clôture…</> : 'Oui, clôturer'}
                </button>
                <button type="button" onClick={() => setConfirmation(false)} disabled={envoi} className="btn-secondary btn-sm">
                  Annuler
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmation(true)} disabled={nbCoches === 0 || etat.chargement}
                className="btn-primary btn-sm">
                <CheckCircle2 aria-hidden="true" /> Clôturer {nbCoches} dossier{nbCoches > 1 ? 's' : ''}
              </button>
            )}
          </div>
        )}
      </div>

      {etat.erreur && (
        <p className="px-4 sm:px-5 py-3 text-sm text-red-700" role="alert">{etat.erreur}</p>
      )}

      {resultat && (
        <p className="px-4 sm:px-5 py-2 text-sm text-emerald-800 bg-emerald-50 border-b border-emerald-100" role="status">
          {resumeCloture(resultat)}
        </p>
      )}

      {!etat.chargement && !etat.erreur && tickets.length === 0 && (
        <p className="empty-state px-4 sm:px-5 py-8">Aucun dossier ouvert de plus de {jours} jours. Tout est à jour.</p>
      )}

      {tickets.length > 0 && (
        <ul className="divide-y divide-slate-100" aria-label="Dossiers à trier">
          <li className="px-4 sm:px-5 py-2 flex items-center gap-3 bg-white">
            <button type="button" onClick={basculerTout} aria-pressed={toutCoche}
              className={`btn-ghost btn-icon btn-sm ${FOCUS_RING}`}
              aria-label={toutCoche ? 'Tout décocher' : 'Tout cocher'}>
              {toutCoche ? <SquareCheck className="text-brand-600" aria-hidden="true" /> : <Square aria-hidden="true" />}
            </button>
            <span className="t-caption">{nbCoches} sur {selectionnables.length} coché{nbCoches > 1 ? 's' : ''}</span>
          </li>
          {tickets.map((t) => {
            const coche = !t.pret_dehors && coches.has(t.id);
            const nbJours = joursDepuis(t.date_depot);
            const client = [t.client_nom, t.client_prenom].filter(Boolean).join(' ') || 'Client inconnu';
            return (
              <li key={t.id} className={`px-4 sm:px-5 py-2 flex items-center gap-3 ${t.pret_dehors ? 'bg-slate-50/60' : ''}`}>
                <button type="button" onClick={() => basculer(t.id)} disabled={t.pret_dehors}
                  aria-pressed={coche} aria-label={`${coche ? 'Décocher' : 'Cocher'} ${t.ticket_code || `#${t.id}`}`}
                  className={`btn-ghost btn-icon btn-sm shrink-0 ${FOCUS_RING}`}>
                  {coche ? <SquareCheck className="text-brand-600" aria-hidden="true" /> : <Square aria-hidden="true" />}
                </button>
                <a href={`${basePath}/ticket/${t.id}`}
                  onClick={(e) => { if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); onOpenTicket?.(t.id); } }}
                  className={`font-mono text-sm font-semibold text-brand-700 hover:underline rounded ${FOCUS_RING}`}>
                  {t.ticket_code || `#${t.id}`}
                </a>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900 truncate">{client} · {appareil(t)}</p>
                  <p className="t-caption truncate">
                    Déposé le {formatDateShort(t.date_depot)}{nbJours !== null ? ` (${nbJours} j)` : ''}
                    {t.technicien_assigne ? ` · ${t.technicien_assigne}` : ''}
                    {t.emplacement ? ` · ${t.emplacement}` : ''}
                    {t.pret_dehors ? ' · téléphone de prêt chez le client' : ''}
                  </p>
                </div>
                <StatusBadge statut={t.statut} />
              </li>
            );
          })}
        </ul>
      )}
      {adminPrompt}
    </section>
  );
}
