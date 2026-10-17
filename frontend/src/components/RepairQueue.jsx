import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Play, Wrench, Clock, AlertTriangle, ChevronDown, Loader2 } from 'lucide-react';
import api from '../lib/api';
import { useApi } from '../hooks/useApi';
import StatusBadge from './StatusBadge';
import { PrioriteBadge, comparerPriorite } from './PrioriteBadge';

// Le serveur trie déjà (priorité, heure promise, statut, dépôt) ; tri stable de secours sur la
// seule priorité, qui garde l'ordre serveur à priorité égale.
export function trierFile(tickets) {
  return [...(tickets || [])].sort((a, b) => comparerPriorite(a?.priorite, b?.priorite));
}

function parseDateForCountdown(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function formatShortCountdown(ms) {
  const abs = Math.abs(ms);
  const totalH = Math.floor(abs / 3600000);
  if (totalH >= 24) {
    const d = Math.floor(totalH / 24);
    return `${d}j ${totalH % 24}h`;
  }
  const m = Math.floor((abs % 3600000) / 60000);
  return `${totalH}h${String(m).padStart(2, '0')}`;
}

function QueueList({ queue, currentTicketId, basePath, isTech, onClose, navigate }) {
  return (
    <div className="space-y-1.5">
      {queue.map((t, i) => {
        const isCurrent = t.id === currentTicketId;
        const isInProgress = t.statut === 'En cours de réparation';
        const recupDate = parseDateForCountdown(t.date_recuperation);
        const now = new Date();
        const countdownMs = recupDate ? recupDate - now : null;
        const isOverdue = countdownMs !== null && countdownMs < 0;
        const isUrgent = countdownMs !== null && countdownMs > 0 && countdownMs < 6 * 3600000;

        return (
          <button
            key={t.id}
            type="button"
            onClick={() => { onClose(); navigate(`${basePath}/ticket/${t.id}`); }}
            className={`w-full text-left p-3 rounded-lg border transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
              isCurrent
                ? 'border-brand-300 bg-brand-50/60'
                : 'border-transparent hover:bg-slate-50'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {/* Rang dans la file : en cours (brand), prochain (rouge), suivants (neutre) */}
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold tabular-nums ${
                isInProgress
                  ? 'bg-brand-600 text-white'
                  : i === 0
                    ? 'bg-red-600 text-white'
                    : 'bg-slate-200 text-slate-700'
              }`} aria-hidden="true">
                {isInProgress ? <Play className="w-3 h-3 fill-current" /> : i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="t-mono text-xs font-semibold text-slate-500">{t.ticket_code}</span>
                  <span className="text-sm font-semibold text-slate-900 truncate">
                    {t.client_prenom} {t.client_nom}
                  </span>
                  {isUrgent && (
                    <span className="badge badge-sm badge-danger shrink-0">
                      Urgent
                    </span>
                  )}
                </div>
                <div className="t-small truncate mb-1.5">
                  {t.modele || t.marque} {t.panne ? `• ${t.panne}` : ''}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <PrioriteBadge priorite={t.priorite} court />
                  {!isTech && t.technicien_assigne && (
                    <span className="t-caption">{t.technicien_assigne}</span>
                  )}
                  <StatusBadge statut={t.statut} />
                  {countdownMs !== null && (
                    <span className={`badge badge-sm ${
                      isOverdue ? 'badge-danger' : isUrgent ? 'badge-warning' : 'badge-success'
                    }`}>
                      {isOverdue ? (
                        <><AlertTriangle className="w-3 h-3" aria-hidden="true" /> Dépassé</>
                      ) : (
                        <><Clock className="w-3 h-3" aria-hidden="true" /> {formatShortCountdown(countdownMs)}</>
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Chargement({ className = 'py-8' }) {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <span className="loading-inline"><Loader2 aria-hidden="true" /> Chargement…</span>
    </div>
  );
}

function Vide({ className = 'py-8' }) {
  return (
    <div className={`text-center ${className}`}>
      <Wrench className="w-8 h-8 text-slate-400 mx-auto mb-2" aria-hidden="true" />
      <p className="text-sm text-slate-500 font-medium">Aucune réparation en attente</p>
    </div>
  );
}

export default function RepairQueue({ open, onClose, currentTicketId, basePath, user, inline }) {
  const navigate = useNavigate();
  const isTech = user?.target === 'tech';
  const techFilter = isTech ? user.utilisateur : null;
  const [collapsed, setCollapsed] = useState(false);

  const { data: tickets, loading } = useApi(
    open ? `queue:repair:${techFilter || 'all'}` : null,
    () => api.getRepairQueue(techFilter),
    { tags: ['tickets'], ttl: 15000 }
  );

  // Close on Escape (panel mode only)
  useEffect(() => {
    if (!open || inline) return;
    const handler = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, inline]);

  const queue = useMemo(() => trierFile(tickets), [tickets]);

  if (!open) return null;

  // En-tête : sombre côté atelier (/tech, identité de la file), blanc côté accueil
  const titre = isTech ? 'Mes réparations' : "File d'attente";
  const headerCls = isTech ? 'bg-slate-900 text-white' : 'bg-white text-slate-900';
  const headerIconCls = isTech ? 'text-slate-300' : 'text-slate-400';
  const headerFocus = isTech ? 'focus-visible:ring-white/70' : 'focus-visible:ring-brand-500';
  const compteur = queue.length > 0 && (
    <span className="badge-count badge-count-brand">{queue.length}</span>
  );

  // ─── Inline widget mode ─────────────────────────────────────
  if (inline) {
    return (
      <div className="card overflow-hidden">
        {/* Header */}
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          aria-expanded={!collapsed}
          className={`w-full min-h-14 px-4 sm:px-5 py-3 flex items-center justify-between gap-3 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset ${headerCls} ${headerFocus} ${
            collapsed ? '' : 'border-b border-slate-100'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Wrench className={`w-4 h-4 shrink-0 ${headerIconCls}`} aria-hidden="true" />
            <span className="t-h2 text-inherit truncate">
              {titre}
            </span>
            {compteur}
          </div>
          <ChevronDown className={`w-4 h-4 shrink-0 ${headerIconCls} transition-transform duration-150 ${collapsed ? '-rotate-90' : ''}`} aria-hidden="true" />
        </button>

        {/* Content */}
        {!collapsed && (
          <div className="p-3 max-h-[500px] overflow-y-auto">
            {loading ? (
              <Chargement />
            ) : queue.length === 0 ? (
              <Vide />
            ) : (
              <QueueList
                queue={queue}
                currentTicketId={currentTicketId}
                basePath={basePath}
                isTech={isTech}
                onClose={() => {}}
                navigate={navigate}
              />
            )}
          </div>
        )}

        {/* Footer */}
        {!collapsed && (
          <div className="px-4 sm:px-5 py-2.5 border-t border-slate-100 t-caption text-center">
            {isTech ? 'Vos tickets assignés en cours' : 'Tous les tickets en attente de traitement'}
          </div>
        )}
      </div>
    );
  }

  // ─── Panel mode (slide-in) ──────────────────────────────────
  return (
    <>
      <div className="fixed inset-0 bg-slate-900/50 z-40" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-label={titre} className="drawer sm:w-[400px]">
        <div className={`min-h-14 px-4 sm:px-5 flex items-center justify-between gap-3 shrink-0 ${headerCls} ${isTech ? '' : 'border-b border-slate-100'}`}>
          <div className="flex items-center gap-2.5 min-w-0">
            <Wrench className={`w-4 h-4 shrink-0 ${headerIconCls}`} aria-hidden="true" />
            <span className="t-h2 text-inherit truncate">
              {titre}
            </span>
            {compteur}
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer la file d'attente"
            className={`btn-ghost btn-icon -mr-2 ${isTech ? 'text-slate-300 hover:bg-white/10 hover:text-white focus-visible:ring-white/70' : ''}`}>
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <Chargement className="py-12" />
          ) : queue.length === 0 ? (
            <Vide className="py-12" />
          ) : (
            <QueueList
              queue={queue}
              currentTicketId={currentTicketId}
              basePath={basePath}
              isTech={isTech}
              onClose={onClose}
              navigate={navigate}
            />
          )}
        </div>
        <div className="px-4 sm:px-5 py-3 border-t border-slate-100 t-caption text-center shrink-0">
          {isTech ? 'Vos tickets assignés en cours' : 'Tous les tickets en attente de traitement'}
        </div>
      </div>
    </>
  );
}
