import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellRing, Check, CheckCheck, ExternalLink, X, Inbox } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { usePolling } from '../hooks/usePolling';
import { useToast } from './Toast';
import { useFocusTrap } from '../hooks/useFocusTrap';

// Une seule requête toutes les 30 s (onglet visible) : la liste porte le nombre de non lues
// (X-Unread-Count) et un ETag, le serveur répond 304 sans corps tant que rien ne change.
// Toute nouvelle notification est donc vue au tour suivant, même si le compteur reste stable.
const POLL_MS = 30_000;

/**
 * NotificationCenter — cloche dans la Navbar (sidebar).
 *
 * - Lit l'utilisateur via useAuth() (réactif si l'user change via switchUser).
 * - Polling 30s de la liste + compteur ; pas de rendu si rien n'a changé.
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
  const listSigRef = useRef('');
  const listAtRef = useRef(0);
  const dropdownRef = useRef(null);
  const buttonRef = useRef(null);

  const { user } = useAuth();
  const currentUser = user?.utilisateur || null;
  const toast = useToast();
  const navigate = useNavigate();
  // navigate change d'identité à chaque changement de route : en ref, il ne relance plus le polling
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // ─── Liste + détection des nouvelles notifs importantes ───────────
  const applyList = useCallback((list) => {
    const safe = Array.isArray(list) ? list : [];
    if (!firstLoadRef.current) {
      const fresh = safe.filter(n => n.id > lastSeenIdRef.current && n.important && !n.is_read);
      fresh.forEach(n => {
        toastRef.current.important(n.message, {
          title: n.title,
          onClick: n.action_url ? () => {
            api.notifsMarkRead(n.id, currentUser).catch(() => {});
            navigateRef.current(n.action_url);
          } : undefined,
        });
      });
    }
    if (safe.length > 0) lastSeenIdRef.current = Math.max(lastSeenIdRef.current, safe[0].id);
    firstLoadRef.current = false;
    listAtRef.current = Date.now();
    // Rien de changé : pas de nouveau rendu de la cloche
    const sig = safe.map(n => `${n.id}:${n.is_read ? 1 : 0}`).join(',');
    if (sig !== listSigRef.current) {
      listSigRef.current = sig;
      setItems(safe);
    }
  }, [currentUser]);

  const poll = useCallback(async () => {
    if (!currentUser) return;
    try {
      const { items: list, unread: count } = await api.background(() => api.notifsFeed(30));
      applyList(list);
      setUnread(count);
      setDebugLastError(null);
    } catch (err) {
      console.error('[NotificationCenter] fetch failed', err);
      setDebugLastError(err?.message || 'Erreur réseau');
    }
  }, [currentUser, applyList]);

  // Pause onglet masqué, appel immédiat au retour ; pas de refetch à chaque navigation
  const refresh = usePolling(poll, POLL_MS, { enabled: Boolean(currentUser) });

  // Changement d'utilisateur (switchUser) : on repart de zéro, sans toast pour l'historique
  const userRef = useRef(currentUser);
  useEffect(() => {
    if (userRef.current === currentUser) return;
    userRef.current = currentUser;
    lastSeenIdRef.current = 0;
    firstLoadRef.current = true;
    listSigRef.current = '';
    listAtRef.current = 0;
    setItems([]);
    refresh();
  }, [currentUser, refresh]);

  // Ouverture de la cloche : liste à jour si elle date un peu
  useEffect(() => {
    if (open && Date.now() - listAtRef.current > 10_000) refresh();
  }, [open, refresh]);

  // Fenêtre modale : focus piégé, retour sur la cloche à la fermeture (Échap géré ci-dessous)
  useFocusTrap(dropdownRef, open);

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
      {/* Bouton cloche dans la sidebar : même rendu que les entrées de menu */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={`Notifications${unread > 0 ? ` (${unread} non lue${unread > 1 ? 's' : ''})` : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={unread > 0 ? `${unread} notification${unread > 1 ? 's' : ''} non lue${unread > 1 ? 's' : ''}` : 'Notifications'}
        className={`relative flex items-center rounded-lg text-[13px] font-medium transition-colors duration-150
          ${collapsed ? 'w-11 h-11 justify-center' : 'w-full min-h-11 gap-3 px-3 py-2.5'}
          focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400
          ${unread > 0
            ? 'text-brand-300 hover:text-white hover:bg-white/[0.06]'
            : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'}
          ${open ? 'bg-white/[0.08] text-white' : ''}
        `}
      >
        {unread > 0
          ? <BellRing className="w-5 h-5 shrink-0" aria-hidden="true" />
          : <Bell className="w-5 h-5 shrink-0 text-slate-400" aria-hidden="true" />
        }
        {!collapsed && <span className="flex-1 text-left">Notifications</span>}
        {unread > 0 && (
          <span className={`badge-count badge-count-danger ${collapsed ? 'absolute -top-1 -right-1' : ''}`}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {/* Backdrop + Drawer (positionné en FIXED, indépendant de la sidebar) */}
      {open && (
        <>
          {/* Backdrop mobile uniquement (sur desktop, clic-outside via listener) */}
          <div
            className="lg:hidden fixed inset-0 bg-slate-900/50 z-[55]"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer */}
          <div
            ref={dropdownRef}
            role="dialog"
            aria-modal="true"
            aria-label="Centre de notifications"
            className="fixed z-[60] bg-white rounded-xl shadow-lg border border-slate-200 flex flex-col overflow-hidden
                       inset-x-2 top-16 lg:inset-x-auto lg:top-4
                       lg:w-[420px] max-h-[calc(100vh-2rem)] lg:max-h-[calc(100vh-2rem)] motion-safe:animate-scale-in"
            style={typeof window !== 'undefined' && window.innerWidth >= 1024
              ? { left: `${dropdownLeftDesktop}px` }
              : undefined}
          >
            {/* Header */}
            <div className="px-4 sm:px-5 py-3 border-b border-slate-100">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <BellRing className="w-5 h-5 shrink-0 text-brand-600" aria-hidden="true" />
                  <span className="t-h2 truncate">Centre de notifications</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {unread > 0 && (
                    <button
                      type="button"
                      onClick={onMarkAll}
                      disabled={loading}
                      title="Tout marquer comme lu"
                      aria-label="Marquer toutes les notifications comme lues"
                      className="btn-ghost btn-icon"
                    >
                      <CheckCheck aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Fermer le centre de notifications"
                    className="btn-ghost btn-icon -mr-2"
                  >
                    <X aria-hidden="true" />
                  </button>
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-500 leading-relaxed">
                Devis validés, messages clients, alertes — tout ce qu'il faut suivre,
                au même endroit. Connecté : <span className="font-semibold text-slate-700">{currentUser}</span>
                {unread > 0 && <> · <span className="font-semibold text-slate-700">{unread} non lue{unread > 1 ? 's' : ''}</span></>}
              </p>
            </div>

            {/* Banner debug si erreur (dev/troubleshooting) */}
            {debugLastError && (
              <div className="px-4 py-2 bg-red-50 border-b border-red-100 text-xs font-medium text-red-700">
                ⚠ Erreur de chargement : {debugLastError}
              </div>
            )}

            {/* Liste */}
            <div className="flex-1 overflow-y-auto">
              {items.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon" aria-hidden="true">
                    <Inbox />
                  </div>
                  <p className="t-h2">Aucune notification</p>
                  <p className="t-body text-slate-500 max-w-sm">
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
                        className={`w-full min-h-14 flex items-start gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500
                          ${!n.is_read ? 'bg-brand-50/40' : ''}
                        `}
                      >
                        <div className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-lg
                          ${n.important
                            ? 'bg-brand-50 text-brand-700'
                            : 'bg-slate-100 text-slate-600'}
                        `}>
                          <span aria-hidden="true">{n.icon || '🔔'}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className={`text-sm leading-snug ${!n.is_read ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
                              {n.title}
                            </p>
                            {!n.is_read && (
                              <span className="shrink-0 w-2 h-2 bg-brand-600 rounded-full mt-1.5" aria-label="Non lu" />
                            )}
                          </div>
                          <p className={`text-[13px] mt-1 leading-snug ${!n.is_read ? 'text-slate-600' : 'text-slate-500'}`}>
                            {n.message}
                          </p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="t-caption">{fmtTime(n.created_at)}</span>
                            {n.action_url && (
                              <span className="text-xs text-brand-700 font-medium flex items-center gap-1">
                                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
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
                  className="btn-ghost btn-sm btn-block"
                >
                  <Check aria-hidden="true" />
                  Tout marquer comme lu ({unread})
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
