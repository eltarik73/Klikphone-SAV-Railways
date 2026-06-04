import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellRing, Check, CheckCheck, ExternalLink, X, Inbox } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useToast } from './Toast';

/**
 * NotificationCenter — cloche dans la Navbar (sidebar).
 *
 * - Lit l'utilisateur via useAuth() (réactif si l'user change via switchUser).
 * - Polling 12s : récupère les notifs visibles pour cet user.
 * - Détecte les NOUVELLES notifs important → trigger un toast via useToast.
 * - Dropdown : positionné en FIXED à côté de la sidebar, qu'elle soit
 *   collapsed (68px) ou étendue (256px). Pas de positioning relatif au
 *   bouton qui causerait des problèmes de scroll/clipping dans la sidebar.
 */
export default function NotificationCenter({ collapsed = false }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [debugLastError, setDebugLastError] = useState(null); // pour faciliter le debug

  const lastSeenIdRef = useRef(0);
  const firstLoadRef = useRef(true);
  const dropdownRef = useRef(null);
  const buttonRef = useRef(null);

  const { user } = useAuth();
  const currentUser = user?.utilisateur || null;
  const toast = useToast();
  const navigate = useNavigate();

  // ─── Fetch + détection nouvelles notifs importantes ────────────────
  const fetchNotifs = useCallback(async () => {
    if (!currentUser) return;
    try {
      const list = await api.notifsList(currentUser, false, 30);
      const safe = Array.isArray(list) ? list : [];

      // Trigger un toast pour les nouvelles notifs importantes non lues
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
      setDebugLastError(null);
    } catch (err) {
      console.error('[NotificationCenter] fetch failed', err);
      setDebugLastError(err?.message || 'Erreur réseau');
    }
  }, [currentUser, toast, navigate]);

  // ─── Polling 12s + arrêt si onglet caché ───────────────────────────
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

  // ─── Fermer au clic extérieur + Escape ─────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target) &&
        buttonRef.current && !buttonRef.current.contains(e.target)
      ) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onClickItem = (n) => {
    if (!n.is_read) {
      api.notifsMarkRead(n.id, currentUser)
        .then(() => {
          setItems(prev => prev.map(it => it.id === n.id ? { ...it, is_read: true } : it));
          setUnread(c => Math.max(0, c - 1));
        })
        .catch((err) => console.error('[NotificationCenter] markRead failed', err));
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
    } catch (err) {
      console.error('[NotificationCenter] markAllRead failed', err);
    }
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

  // On affiche TOUJOURS le bouton si user connecté (plus de "Utilisateur" trap)
  if (!currentUser) return null;

  // Positionnement FIXED du dropdown à côté de la sidebar.
  // collapsed = sidebar 68px → dropdown à left: 76px
  // étendu  = sidebar 256px → dropdown à left: 264px
  const dropdownLeftDesktop = collapsed ? 76 : 264;

  return (
    <>
      {/* Bouton cloche dans la sidebar */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={`Notifications${unread > 0 ? ` (${unread} non lue${unread > 1 ? 's' : ''})` : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={unread > 0 ? `${unread} notification${unread > 1 ? 's' : ''} non lue${unread > 1 ? 's' : ''}` : 'Notifications'}
        className={`relative flex items-center rounded-lg transition-all
          ${collapsed ? 'w-9 h-9 justify-center' : 'w-full gap-3 px-3 py-2.5'}
          ${unread > 0
            ? 'text-brand-300 hover:bg-brand-600/15 ring-1 ring-brand-500/30'
            : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'}
          ${open ? 'bg-white/[0.08]' : ''}
        `}
      >
        {unread > 0
          ? <BellRing className="w-[18px] h-[18px] motion-safe:animate-[wiggle_1.5s_ease-in-out_infinite] shrink-0" aria-hidden="true" />
          : <Bell className="w-[18px] h-[18px] shrink-0" aria-hidden="true" />
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

      {/* Backdrop + Drawer (positionné en FIXED, indépendant de la sidebar) */}
      {open && (
        <>
          {/* Backdrop mobile uniquement (sur desktop, clic-outside via listener) */}
          <div
            className="lg:hidden fixed inset-0 bg-black/40 backdrop-blur-sm z-[55]"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer */}
          <div
            ref={dropdownRef}
            role="dialog"
            aria-modal="true"
            aria-label="Centre de notifications"
            className="fixed z-[60] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden
                       inset-x-2 top-16 lg:inset-x-auto lg:top-4
                       lg:w-[420px] max-h-[calc(100vh-2rem)] lg:max-h-[calc(100vh-2rem)]"
            style={{
              animation: 'notifSlideIn 0.2s ease-out',
              ...(typeof window !== 'undefined' && window.innerWidth >= 1024
                ? { left: `${dropdownLeftDesktop}px` }
                : {}),
            }}
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-brand-600 to-fuchsia-600 text-white">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <BellRing className="w-5 h-5" aria-hidden="true" />
                  <span className="font-display font-bold text-base">Centre de notifications</span>
                </div>
                <div className="flex items-center gap-1">
                  {unread > 0 && (
                    <button
                      type="button"
                      onClick={onMarkAll}
                      disabled={loading}
                      title="Tout marquer comme lu"
                      aria-label="Marquer toutes les notifications comme lues"
                      className="p-1.5 rounded-lg hover:bg-white/20 transition disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                    >
                      <CheckCheck className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Fermer le centre de notifications"
                    className="p-1.5 rounded-lg hover:bg-white/20 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-white/80 leading-relaxed">
                Devis validés, messages clients, alertes — tout ce qu'il faut suivre,
                au même endroit. Connecté : <span className="font-semibold">{currentUser}</span>
                {unread > 0 && <> · <span className="font-bold">{unread} non lue{unread > 1 ? 's' : ''}</span></>}
              </p>
            </div>

            {/* Banner debug si erreur (dev/troubleshooting) */}
            {debugLastError && (
              <div className="px-3 py-1.5 bg-red-50 border-b border-red-100 text-[11px] text-red-700">
                ⚠ Erreur de chargement : {debugLastError}
              </div>
            )}

            {/* Liste */}
            <div className="flex-1 overflow-y-auto">
              {items.length === 0 ? (
                <div className="text-center py-12 px-6">
                  <Inbox className="w-12 h-12 text-slate-300 mx-auto mb-3" aria-hidden="true" />
                  <p className="text-sm font-semibold text-slate-600">Aucune notification</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Tu seras prévenu ici quand un client valide un devis,
                    envoie un message, ou laisse un avis.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {items.map(n => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => onClickItem(n)}
                        className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-100
                          ${!n.is_read ? 'bg-brand-50/40' : ''}
                        `}
                      >
                        <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-lg
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
                          <p className={`text-xs mt-1 leading-relaxed ${!n.is_read ? 'text-slate-600' : 'text-slate-400'}`}>
                            {n.message}
                          </p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="text-[10px] text-slate-400">{fmtTime(n.created_at)}</span>
                            {n.action_url && (
                              <span className="text-[10px] text-brand-600 font-medium flex items-center gap-0.5">
                                <ExternalLink className="w-2.5 h-2.5" aria-hidden="true" />
                                Voir le ticket
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
              <div className="px-3 py-2 border-t border-slate-100 bg-slate-50/60">
                <button
                  type="button"
                  onClick={onMarkAll}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 transition disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                >
                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                  Tout marquer comme lu ({unread})
                </button>
              </div>
            )}
          </div>
        </>
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
          @keyframes notifSlideIn { from { opacity: 0; } to { opacity: 1; } }
          @keyframes wiggle { 0%, 100% { transform: rotate(0deg); } }
        }
      `}</style>
    </>
  );
}
