import { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext } from 'react';
import { CheckCircle2, AlertTriangle, X, Info, Sparkles } from 'lucide-react';

const ToastContext = createContext(null);

// Default display duration (ms) — kept consistent across call sites
const DEFAULT_DURATION = 4000;
// Durée plus longue pour les toasts "important" — l'utilisateur doit avoir le temps de cliquer
const IMPORTANT_DURATION = 8000;
// Exit animation duration (ms) — MUST match the CSS transition below
const EXIT_ANIMATION_MS = 250;

// ─── Sons (Web Audio API) ───────────────────────────────
function playToastSound(important = false) {
  if (typeof window === 'undefined') return;
  // Respecte prefers-reduced-motion (les utilisateurs sensibles préfèrent souvent moins de sons aussi)
  try {
    const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;
  } catch { /* noop */ }
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (important) {
      // Double bip plus marqué pour les notifs importantes
      [0, 0.18].forEach((delay, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = i === 0 ? 880 : 1100;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.25);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + 0.25);
      });
    } else {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 720;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
    }
  } catch { /* silent fallback */ }
}

const ICONS = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
  warning: AlertTriangle,
  important: Sparkles,
};

// Design V2 : toast blanc, bordure gauche 4 px sémantique, icône -700 (AA), texte slate-800.
const STYLES = {
  success: 'border-l-emerald-600',
  error: 'border-l-red-600',
  info: 'border-l-blue-600',
  warning: 'border-l-amber-500',
  important: 'border-l-brand-600',
};

const ICON_STYLES = {
  success: 'text-emerald-700',
  error: 'text-red-700',
  info: 'text-blue-700',
  warning: 'text-amber-700',
  important: 'text-brand-600',
};

function ToastItem({ toast, onDismiss }) {
  const [exiting, setExiting] = useState(false);
  const Icon = ICONS[toast.type] || Info;
  const autoDismissRef = useRef(null);
  const exitTimerRef = useRef(null);

  const isImportant = toast.type === 'important' || toast.important;
  const isError = toast.type === 'error' || toast.type === 'warning';

  const beginExit = useCallback(() => {
    if (exitTimerRef.current) return;
    setExiting(true);
    exitTimerRef.current = setTimeout(() => onDismiss(toast.id), EXIT_ANIMATION_MS);
  }, [onDismiss, toast.id]);

  useEffect(() => {
    const duration = toast.duration || (isImportant ? IMPORTANT_DURATION : DEFAULT_DURATION);
    autoDismissRef.current = setTimeout(beginExit, duration);
    return () => {
      if (autoDismissRef.current) clearTimeout(autoDismissRef.current);
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, [toast.id, toast.duration, beginExit, isImportant]);

  const handleClick = () => {
    if (toast.onClick) toast.onClick();
    if (toast.dismissOnClick !== false) beginExit();
  };

  // role/aria-live : assertive pour important ou erreurs (annonce immédiate au lecteur d'écran)
  const role = (isImportant || isError) ? 'alert' : 'status';
  const ariaLive = (isImportant || isError) ? 'assertive' : 'polite';

  return (
    <div
      role={role}
      aria-live={ariaLive}
      aria-atomic="true"
      onClick={toast.onClick ? handleClick : undefined}
      className={`toast transition-[opacity,transform] duration-[250ms] ${
        STYLES[toast.type] || STYLES.info
      } ${exiting ? 'opacity-0 translate-x-8' : 'opacity-100 translate-x-0'} ${
        isImportant ? 'border-brand-200' : ''
      } ${toast.onClick ? 'cursor-pointer' : ''}`}
      style={{ animation: exiting ? undefined : (isImportant ? 'importantToastIn 0.35s cubic-bezier(0.22, 1, 0.36, 1)' : 'slideInToast 0.25s ease-out') }}
    >
      <Icon
        aria-hidden="true"
        className={`w-5 h-5 shrink-0 mt-2.5 ${ICON_STYLES[toast.type] || ICON_STYLES.info}`}
      />
      <div className="flex-1 min-w-0 py-2">
        {toast.title && <p className="font-semibold text-sm text-slate-900">{toast.title}</p>}
        <p className="text-sm leading-relaxed">{toast.message}</p>
        {toast.onClick && (
          <p className="text-xs mt-1 font-semibold text-brand-700 underline underline-offset-2">
            Cliquer pour voir →
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); beginExit(); }}
        aria-label="Fermer la notification"
        className="btn-ghost btn-icon shrink-0 text-slate-500"
      >
        <X aria-hidden="true" />
      </button>
    </div>
  );
}

let _toastIdCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((type, message, options = {}) => {
    const id = Date.now() + (_toastIdCounter++);
    const toastObj = { id, type, message, ...options };
    setToasts(prev => [...prev, toastObj]);
    // Son automatique pour important (sauf si playSound: false)
    if ((type === 'important' || options.important) && options.playSound !== false) {
      playToastSound(true);
    } else if (options.playSound === true) {
      playToastSound(false);
    }
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useMemo(() => ({
    success: (message, opts) => addToast('success', message, opts),
    error: (message, opts) => addToast('error', message, opts),
    info: (message, opts) => addToast('info', message, opts),
    warning: (message, opts) => addToast('warning', message, opts),
    important: (message, opts) => addToast('important', message, opts),
  }), [addToast]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* Conteneur : sous la barre mobile (top-16) sur téléphone, en bas à droite dès 640 px, au-dessus
          du bouton de chat (56 px + marge) à partir de lg ; au-dessus des modales (z-60) */}
      <div
        className="fixed z-[60] flex flex-col items-end gap-2 pointer-events-none
          top-16 left-4 right-4 sm:top-auto sm:left-auto sm:bottom-4 sm:right-4 lg:bottom-20 lg:right-6"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map(t => (
          <div key={t.id} className="pointer-events-auto max-w-full">
            <ToastItem toast={t} onDismiss={dismissToast} />
          </div>
        ))}
      </div>
      <style>{`
        @keyframes slideInToast {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes importantToastIn {
          0% { opacity: 0; transform: translateY(8px) scale(0.97); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes importantToastIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes slideInToast {
            from { opacity: 0; }
            to { opacity: 1; }
          }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback — no-op toasts if provider not found
    return {
      success: () => {},
      error: () => {},
      info: () => {},
      warning: () => {},
      important: () => {},
    };
  }
  return ctx;
}
