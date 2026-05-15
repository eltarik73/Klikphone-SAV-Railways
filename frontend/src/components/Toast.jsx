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

const STYLES = {
  success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  error: 'bg-red-50 border-red-200 text-red-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
  important: 'bg-gradient-to-br from-brand-600 to-fuchsia-600 border-brand-700 text-white',
};

const ICON_STYLES = {
  success: 'text-emerald-500',
  error: 'text-red-500',
  info: 'text-blue-500',
  warning: 'text-amber-500',
  important: 'text-white',
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
      className={`flex items-start gap-3 px-4 py-3 rounded-xl border transition-all duration-[250ms] ${
        STYLES[toast.type] || STYLES.info
      } ${exiting ? 'opacity-0 translate-x-8' : 'opacity-100 translate-x-0'} ${
        isImportant ? 'shadow-2xl shadow-brand-600/40 ring-2 ring-brand-300/40 hover:scale-[1.02]' : 'shadow-lg'
      } ${toast.onClick ? 'cursor-pointer' : ''}`}
      style={{ animation: exiting ? undefined : (isImportant ? 'importantToastIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)' : 'slideInToast 0.3s ease-out') }}
    >
      <Icon
        aria-hidden="true"
        className={`w-5 h-5 shrink-0 mt-0.5 ${ICON_STYLES[toast.type] || ICON_STYLES.info} ${
          isImportant ? 'motion-safe:animate-pulse' : ''
        }`}
      />
      <div className="flex-1 min-w-0">
        {toast.title && <p className={`font-bold text-sm ${isImportant ? 'text-white' : ''}`}>{toast.title}</p>}
        <p className={`text-sm ${isImportant ? 'text-white/90' : ''}`}>{toast.message}</p>
        {toast.onClick && (
          <p className={`text-xs mt-1 font-semibold ${isImportant ? 'text-white/80 underline' : 'text-brand-600 underline'}`}>
            Cliquer pour voir →
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); beginExit(); }}
        aria-label="Fermer la notification"
        className={`p-1 rounded transition-colors shrink-0 min-w-[28px] min-h-[28px] flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-current/40 ${
          isImportant ? 'hover:bg-white/20' : 'hover:bg-black/5'
        }`}
      >
        <X className="w-4 h-4" aria-hidden="true" />
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
      {/* Toast container */}
      <div
        className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-[calc(100vw-2rem)] w-80 sm:w-96 pointer-events-none"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map(t => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} onDismiss={dismissToast} />
          </div>
        ))}
      </div>
      <style>{`
        @keyframes slideInToast {
          from { opacity: 0; transform: translateX(100%); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes importantToastIn {
          0% { opacity: 0; transform: translateX(100%) scale(0.8); }
          60% { opacity: 1; transform: translateX(-8px) scale(1.05); }
          100% { opacity: 1; transform: translateX(0) scale(1); }
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
