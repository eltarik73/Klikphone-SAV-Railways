import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Play, Wrench, Clock, AlertTriangle, ChevronDown } from 'lucide-react';
import api from '../lib/api';
import { useApi } from '../hooks/useApi';
import { getStatusConfig } from '../lib/utils';

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
        const statusConf = getStatusConfig(t.statut);

        return (
          <button
            key={t.id}
            onClick={() => { onClose(); navigate(`${basePath}/ticket/${t.id}`); }}
            className={`w-full text-left p-3 rounded-xl transition-all ${
              isCurrent
                ? 'bg-violet-50 ring-2 ring-violet-400'
                : isInProgress
                  ? 'bg-blue-50/50 hover:bg-blue-50'
                  : 'hover:bg-slate-50'
            }`}
          >
            <div className="flex items-start gap-2.5">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-extrabold ${
                isInProgress
                  ? 'bg-violet-600 text-white'
                  : i === 0
                    ? 'bg-red-500 text-white'
                    : 'bg-slate-200 text-slate-500'
              }`}>
                {isInProgress ? <Play className="w-3 h-3 fill-current" /> : i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[11px] font-semibold text-slate-400 font-mono">{t.ticket_code}</span>
                  <span className="text-[13px] font-bold text-slate-800 truncate">
                    {t.client_prenom} {t.client_nom}
                  </span>
                  {isUrgent && (
                    <span className="shrink-0 bg-red-50 text-red-500 text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase">
                      Urgent
                    </span>
                  )}
                </div>
                <div className="text-[12px] text-slate-500 truncate mb-1">
                  {t.modele || t.marque} {t.panne ? `• ${t.panne}` : ''}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {!isTech && t.technicien_assigne && (
                    <span className="text-[10px] text-slate-400">{t.technicien_assigne}</span>
                  )}
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: statusConf.color + '15', color: statusConf.color }}
                  >
                    {t.statut}
                  </span>
                  {countdownMs !== null && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      isOverdue ? 'bg-red-50 text-red-500' : isUrgent ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'
                    }`}>
                      {isOverdue ? (
                        <><AlertTriangle className="w-2.5 h-2.5 inline" /> Dépassé</>
                      ) : (
                        <><Clock className="w-2.5 h-2.5 inline" /> {formatShortCountdown(countdownMs)}</>
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

  if (!open) return null;

  const queue = tickets || [];

  // ─── Inline widget mode ─────────────────────────────────────
  if (inline) {
    return (
      <div className="card overflow-hidden">
        {/* Header */}
        <button
          onClick={() => setCollapsed(c => !c)}
          className="w-full px-5 py-4 bg-gradient-to-r from-slate-800 to-slate-900 flex items-center justify-between"
        >
          <div className="flex items-center gap-2.5">
            <Wrench className="w-4 h-4 text-white/80" />
            <span className="text-white text-sm font-bold">
              {isTech ? 'Mes réparations' : "File d'attente"}
            </span>
            {queue.length > 0 && (
              <span className="bg-amber-400 text-slate-900 text-[11px] font-extrabold px-2 py-0.5 rounded-full">
                {queue.length}
              </span>
            )}
          </div>
          <ChevronDown className={`w-4 h-4 text-white/60 transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`} />
        </button>

        {/* Content */}
        {!collapsed && (
          <div className="p-3 max-h-[500px] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : queue.length === 0 ? (
              <div className="text-center py-8">
                <Wrench className="w-7 h-7 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-400 font-medium">Aucune réparation en attente</p>
              </div>
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
          <div className="px-5 py-2.5 border-t border-slate-100 text-[11px] text-slate-400 text-center">
            {isTech ? 'Vos tickets assignés en cours' : 'Tous les tickets en attente de traitement'}
          </div>
        )}
      </div>
    );
  }

  // ─── Panel mode (slide-in) ──────────────────────────────────
  return (
    <>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-[2px] z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full sm:w-[400px] bg-white shadow-2xl z-50 flex flex-col animate-in">
        <div className="px-5 py-4 bg-gradient-to-r from-slate-800 to-slate-900 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <Wrench className="w-4 h-4 text-white/80" />
            <span className="text-white text-sm font-bold">
              {isTech ? 'Mes réparations' : "File d'attente"}
            </span>
            {queue.length > 0 && (
              <span className="bg-amber-400 text-slate-900 text-[11px] font-extrabold px-2 py-0.5 rounded-full">
                {queue.length}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : queue.length === 0 ? (
            <div className="text-center py-12">
              <Wrench className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400 font-medium">Aucune réparation en attente</p>
            </div>
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
        <div className="px-5 py-3 border-t border-slate-100 text-[11px] text-slate-400 text-center shrink-0">
          {isTech ? 'Vos tickets assignés en cours' : 'Tous les tickets en attente de traitement'}
        </div>
      </div>
    </>
  );
}
