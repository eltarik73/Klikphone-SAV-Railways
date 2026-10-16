import { useId } from 'react';
import api from '../lib/api';
import { useApi } from '../hooks/useApi';
import { formatDateShort, formatPrix } from '../lib/utils';
import {
  DELAI_ABANDON_JOURS, SEUILS_ATTENTE, badgeAttente, formatDelai, groupesEtagere, situationAbandon,
} from '../lib/etagere';
import { AlertTriangle, Clock, PackageCheck, RefreshCw, X } from 'lucide-react';

// Filtre et tri côté serveur (services/etagere.py) : terminés puis rendus non payés, plus anciens d'abord
const PARAMS = { vue: 'a_recuperer', limit: 500 };
const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

function appareil(t) {
  const modele = t.modele && t.modele !== 'Autre' ? t.modele : t.modele_autre;
  return [t.marque, modele].filter((v) => String(v ?? '').trim()).join(' ') || t.categorie || 'Appareil';
}

function pluriel(n, mot, motPluriel = `${mot}s`) {
  return `${n} ${n > 1 ? motPluriel : mot}`;
}

function Ligne({ t, impaye, delai, basePath, onOpenTicket, onRemettre }) {
  const badge = badgeAttente(t.jours_attente);
  const abandon = impaye ? null : situationAbandon(t.jours_attente, delai);
  const client = `${t.client_prenom || ''} ${t.client_nom || ''}`.trim() || 'Client';
  const reste = Number(t.reste_du) || 0;
  const action = impaye ? (reste > 0 ? 'Encaisser' : 'Ouvrir') : 'Remettre';
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 sm:px-5 py-3">
      {badge ? (
        <span className={`inline-flex min-w-[3.75rem] items-center justify-center rounded-lg px-2 py-1 font-mono text-sm font-bold tabular-nums ring-1 ${badge.classe}`}>
          <span aria-hidden="true">{badge.label}</span>
          <span className="sr-only">Réparation terminée depuis {pluriel(badge.jours, 'jour')}</span>
        </span>
      ) : (
        <span className="inline-flex min-w-[3.75rem] items-center justify-center rounded-lg bg-slate-100 px-2 py-1 font-mono text-sm text-slate-700 ring-1 ring-slate-200">
          <span aria-hidden="true">J+?</span><span className="sr-only">Date de fin de réparation inconnue</span>
        </span>
      )}
      <div className="min-w-0 flex-1 basis-48">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <a href={`${basePath}/ticket/${t.id}`}
            onClick={(e) => {
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              onOpenTicket(t.id);
            }}
            className={`inline-flex min-h-[32px] items-center rounded font-mono font-bold text-brand-700 hover:underline ${FOCUS_RING}`}>
            {t.ticket_code || `#${t.id}`}
          </a>
          <span className="min-w-0 truncate font-semibold text-slate-900">{client}</span>
        </p>
        <p className="truncate text-xs text-slate-600">
          {appareil(t)}{t.fin_reparation ? ` · terminé le ${formatDateShort(t.fin_reparation)}` : ''}
        </p>
      </div>
      {impaye ? (
        <span className={`text-sm font-bold tabular-nums ${reste > 0 ? 'text-red-700' : 'text-slate-600'}`}>
          {reste > 0 ? `Reste ${formatPrix(reste)}` : 'Rien à payer'}
        </span>
      ) : abandon?.atteint ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-800 ring-1 ring-red-200">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Délai d’abandon atteint
        </span>
      ) : null}
      <button type="button" onClick={() => onRemettre(t)}
        aria-label={`${action} ${t.ticket_code || `#${t.id}`}`}
        className={`min-h-[44px] rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 ${FOCUS_RING}`}>
        {action}
      </button>
    </li>
  );
}

function Groupe({ titre, aide, tickets, ...props }) {
  const titreId = useId();
  if (!tickets.length) return null;
  return (
    <section aria-labelledby={titreId}>
      <h3 id={titreId} className="sticky top-0 z-[1] bg-slate-50 px-4 sm:px-5 py-2 text-xs font-semibold text-slate-700">
        {titre} <span className="font-normal text-slate-600">— {aide}</span>
      </h3>
      <ul className="divide-y divide-slate-100">
        {tickets.map((t) => <Ligne key={t.id} t={t} {...props} />)}
      </ul>
    </section>
  );
}

/** Étagère « À récupérer » : ouverte par la carte KPI du dashboard. */
export default function EtagereARecuperer({ id, basePath, onOpenTicket, onRemettre, onClose }) {
  const titreId = useId();
  const { data, error, loading, isRevalidating, mutate } = useApi(
    'dashboard:a_recuperer',
    () => api.getDashboard(PARAMS),
    { tags: ['dashboard', 'tickets'], ttl: 45_000 },
  );
  const delai = Number(data?.delai_abandon_jours) || DELAI_ABANDON_JOURS;
  const { enBoutique, impayes } = groupesEtagere(data?.tickets);
  const recus = data?.tickets?.length || 0;
  const total = typeof data?.total === 'number' ? data.total : recus;
  const props = { delai, basePath, onOpenTicket, onRemettre };

  return (
    <section id={id} aria-labelledby={titreId} aria-busy={loading || isRevalidating}
      className="card mb-6 overflow-hidden motion-safe:animate-[fadeIn_0.3s_ease-out_both]">
      <div className="border-b border-slate-100 px-4 sm:px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100" aria-hidden="true">
            <PackageCheck className="h-4 w-4 text-emerald-700" />
          </div>
          <h2 id={titreId} className="min-w-0 flex-1 text-sm font-semibold text-slate-900">À récupérer</h2>
          <button type="button" onClick={() => mutate()} aria-label="Rafraîchir l’étagère"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 ${FOCUS_RING}`}>
            <RefreshCw className={`h-4 w-4 ${isRevalidating ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
          </button>
          <button type="button" onClick={onClose} aria-label="Fermer l’étagère À récupérer"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 ${FOCUS_RING}`}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-600">
          {data
            ? `${pluriel(enBoutique.length, 'appareil réparé', 'appareils réparés')} en boutique · `
              + `${pluriel(impayes.length, 'rendu non payé', 'rendus non payés')}`
              + `${total > recus ? ` (${recus} premiers sur ${total})` : ''}`
              + ' — du plus ancien au plus récent depuis la fin de réparation.'
            : 'Chargement…'}
        </p>
        <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-600">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Délai d’abandon : {formatDelai(delai)} après la fin de réparation (conditions du ticket de dépôt).
            Couleurs à partir de {SEUILS_ATTENTE.map((s) => `J+${s}`).join(', ')}.
          </span>
        </p>
      </div>

      {!data && loading ? (
        <div className="divide-y divide-slate-100" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 sm:px-5 py-3">
              <div className="h-7 w-14 rounded-lg animate-shimmer" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-40 rounded animate-shimmer" />
                <div className="h-3 w-56 rounded animate-shimmer" />
              </div>
            </div>
          ))}
        </div>
      ) : error && !data ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 px-4 sm:px-5 py-4 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">Étagère indisponible : {error.message || 'erreur réseau'}</span>
          <button type="button" onClick={() => mutate()}
            className={`min-h-[44px] rounded-lg border border-red-200 bg-white px-3 font-semibold hover:bg-red-50 ${FOCUS_RING}`}>
            Réessayer
          </button>
        </div>
      ) : recus === 0 ? (
        <p role="status" className="px-4 sm:px-5 py-6 text-center text-sm text-slate-600">
          Rien à récupérer : aucun appareil terminé ni rendu non payé.
        </p>
      ) : (
        <div className="max-h-[32rem] overflow-y-auto overscroll-contain">
          <Groupe titre="En boutique" aide="réparation terminée, client à prévenir ou à relancer"
            tickets={enBoutique} impaye={false} {...props} />
          <Groupe titre="Rendus non payés" aide="appareil rendu, reste à encaisser"
            tickets={impayes} impaye {...props} />
        </div>
      )}
    </section>
  );
}
