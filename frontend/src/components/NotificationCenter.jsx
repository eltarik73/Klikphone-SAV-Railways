import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellRing, Check, CheckCheck, ExternalLink, X, Inbox } from 'lucide-react';
import api from '../lib/api';
import { useToast } from './Toast';

/**
 * NotificationCenter — cloche dans la Navbar.
 * - Polling toutes les 12s
 * - Détecte les NOUVELLES notifs important → trigger un toast via useToast
 * - Mémorise le dernier id vu pour éviter les doublons
 */
export default function NotificationCenter({ collapsed = false }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const lastSeenIdRef = useRef(0);
  const firstLoadRef = useRef(true);
  const dropdownRef = useRef(null);
  const buttonRef = useRef(null);
  const toast = useToast();
  const navigate = useNavigate();

  const currentUser = (typeof window !== 'undefined' && localStorage.getItem('kp_user')) || 'Utilisateur';

  // ─── Fetch + détecter les nouvelles importantes
  const fetchNotifs = useCallback(async () => {
    try {
      const list = await api.notifsList(currentUser, false, 30);
      const safe = Array.isArray(list) ? list : [];

      // Détecte les nouvelles notifs importantes non lues (apparues depuis le dernier fetch)
      if (!firstLoadRef.current) {
        const fresh = safe.filter(
          n => n.id > lastSeenIdRef.current && n.important && !n.is_read,
        );
        fresh.forEach(n => {
          toast.important(n.message, {
            title: n.title,
            onClick: n.action_url ? () => {
              api.notifsMarkRead(n.id, currentUser).catch(() => {});
              navigate(n.action_url);
            } : undefined,
          });
        });
      }

      if (safe.length > 0) {
        lastSeenIdRef.current = Math.max(lastSeenIdRef.current, safe[0].id);
      }
      firstLoadRef.current = false;
      setItems(safe);

      const u = await api.notifsUnreadCount(currentUser);
      setUnread(u?.count || 0);
    } catch {
      /* silent */
    }
  }, [currentUser, toast, navigate]);

  // ─── Polling 12s + arrêt si onglet caché
  useEffect(() => {
    if (!currentUser) return;
    fetchNotifs();
    let interval;
    const start = () => { clearInterval(interval); interval = setInterval(fetchNotifs, 12000); };
    const stop = () => clearInterval(interval);
    const onVisibility = () => (document.hidden ? stop() : (fetchNotifs(), start()));
    document.addEventListener('visibilitychange', onVisibility);
    start();
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [currentUser, fetchNotifs]);

  // ─── Fermer le dropdown au clic extérieur
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target) &&
        buttonRef.current && !buttonRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // ─── Fermer avec Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  const onClickItem = async (n) => {
    if (!n.is_read) {
      api.notifsMarkRead(n.id, currentUser)
        .then(() => {
          setItems(prev => prev.map(it => it.id === n.id ? { ...it, is_read: true } : it));
          setUnread(c => Math.max(0, c - 1));
        })
        .catch(() => {});
    }
    if (n.action_url) {
      setOpen(false);
      navigate(n.action_url);
    }
  };

  const onMarkAll = async () => {
    setLoading(true);
    try {
      await api.notifsMarkAllRead(currentUser);
      setItems(prev => prev.map(it => ({ ...it, is_read: true })));
      setUnread(0);
    } catch { /* silent */ }
    setLoading(false);
  };

  const fmtTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return 'à l\'instant';
    if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  if (!currentUser || currentUser === 'Utilisateur') return null;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(o => !o)}
        aria-label={`Notifications${unread > 0 ? ` (${unread} non lue${unread > 1 ? 's' : ''})` : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Notifications"
        className={`relative flex items-center justify-center rounded-lg transition-all
          ${collapsed ? 'w-9 h-9' : 'w-full gap-3 px-3 py-2.5'}
          ${unread > 0
            ? 'text-brand-300 hover:bg-brand-600/10'
            : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'}
        `}
      >
        {unread > 0
          ? <BellRing className="w-[18px] h-[18px] motion-safe:animate-[wiggle_1.5s_ease-in-out_infinite]" />
          : <Bell className="w-[18px] h-[18px]" />
        }
        {!collapsed && <span className="flex-1 text-left text-[13px] font-medium">Notifications</span>}
        {unread > 0 && (
          <span className={`bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[20px] px-1.5 py-0.5 text-center
            ${collapsed ? 'absolute -top-1 -right-1 w-4 h-4 text-[8px] p-0 flex items-center justify-center' : ''}`}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={dropdownRef}
          role="dialog"
          aria-label="Centre de notifications"
          className={`fixed sm:absolute z-[60] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden
            ${collapsed
              ? 'left-[72px] top-2'
              : 'left-2 right-2 top-12 sm:left-auto sm:right-auto sm:top-auto sm:bottom-12 sm:translate-x-2'}
            w-[calc(100vw-1rem)] sm:w-[380px] max-h-[80vh] sm:max-h-[520px]
          `}
          style={{ animation: 'notifSlideIn 0.2s ease-out' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-brand-600 to-fuchsia-600 text-white">
            <div className="flex items-center gap-2">
              <BellRing className="w-4 h-4" />
              <span className="font-display font-bold text-sm">Notifications</span>
              {unread > 0 && (
                <span className="bg-white/20 text-white text-[10px] font-bold rounded-full px-2 py-0.5">
                  {unread} non lue{unread > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button
                  onClick={onMarkAll}
                  disabled={loading}
                  title="Tout marquer comme lu"
                  className="p-1.5 rounded-lg hover:bg-white/20 transition min-w-[32px] min-h-[32px] flex items-center justify-center disabled:opacity-50"
                >
                  <CheckCheck className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                aria-label="Fermer"
                className="p-1.5 rounded-lg hover:bg-white/20 transition min-w-[32px] min-h-[32px] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Liste */}
          <div className="flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="text-center py-10 px-4">
                <Inbox className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500 font-medium">Aucune notification</p>
                <p className="text-xs text-slate-400 mt-1">Vous serez prévenu quand un devis sera validé.</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {items.map(n => (
                  <li key={n.id}>
                    <button
                      onClick={() => onClickItem(n)}
                      className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50
                        ${!n.is_read ? 'bg-brand-50/40' : ''}
                      `}
                    >
                      <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-lg
                        ${n.important
                          ? 'bg-gradient-to-br from-brand-600 to-fuchsia-600 text-white shadow-md shadow-brand-600/30'
                          : 'bg-slate-100 text-slate-600'}
                      `}>
                        <span aria-hidden="true">{n.icon || '🔔'}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-sm leading-snug ${!n.is_read ? 'font-bold text-slate-800' : 'font-semibold text-slate-600'}`}>
                            {n.title}
                          </p>
                          {!n.is_read && (
                            <span className="shrink-0 w-2 h-2 bg-brand-600 rounded-full mt-1.5" aria-label="Non lu" />
                          )}
                        </div>
                        <p className={`text-xs mt-0.5 leading-relaxed ${!n.is_read ? 'text-slate-600' : 'text-slate-400'}`}>
                          {n.message}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[10px] text-slate-400">{fmtTime(n.created_at)}</span>
                          {n.action_url && (
                            <span className="text-[10px] text-brand-600 font-medium flex items-center gap-0.5">
                              <ExternalLink className="w-2.5 h-2.5" />
                              Voir
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer */}
          {items.length > 0 && unread > 0 && (
            <div className="px-3 py-2 border-t border-slate-100 bg-slate-50/50">
              <button
                onClick={onMarkAll}
                disabled={loading}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 transition disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                Tout marquer comme lu
              </button>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes notifSlideIn {
          from { opacity: 0; transform: translateY(-8px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes wiggle {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(-10deg); }
          75% { transform: rotate(10deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes notifSlideIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes wiggle {
            0%, 100% { transform: rotate(0deg); }
          }
        }
      `}</style>
    </div>
  );
}
