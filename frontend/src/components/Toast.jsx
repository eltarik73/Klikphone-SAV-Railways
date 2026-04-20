import { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext } from 'react';
import { CheckCircle2, AlertTriangle, X, Info } from 'lucide-react';

const ToastContext = createContext(null);

// Default display duration (ms) — kept consistent across call sites
const DEFAULT_DURATION = 4000;
// Exit animation duration (ms) — MUST match the CSS transition below
const EXIT_ANIMATION_MS = 250;

const ICONS = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
  warning: AlertTriangle,
};

const STYLES = {
  success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  error: 'bg-red-50 border-red-200 text-red-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
};

const ICON_STYLES = {
  success: 'text-emerald-500',
  error: 'text-red-500',
  info: 'text-blue-500',
  warning: 'text-amber-500',
};

function ToastItem({ toast, onDismiss }) {
  const [exiting, setExiting] = useState(false);
  const Icon = ICONS[toast.type] || Info;
  const autoDismissRef = useRef(null);
  const exitTimerRef = useRef(null);

  const beginExit = useCallback(() => {
    if (exitTimerRef.current) return;
    setExiting(true);
    exitTimerRef.current = setTimeout(() => onDismiss(toast.id), EXIT_ANIMATION_MS);
  }, [onDismiss, toast.id]);

  useEffect(() => {
    const duration = toast.duration || DEFAULT_DURATION;
    autoDismissRef.current = setTimeout(beginExit, duration);
    return () => {
      if (autoDismissRef.current) clearTimeout(autoDismissRef.current);
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, [toast.id, toast.duration, beginExit]);

  const isError = toast.type === 'error' || toast.type === 'warning';

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-atomic="true"
      className={`flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg transition-all duration-[250ms] ${
        STYLES[toast.type] || STYLES.info
      } ${exiting ? 'opacity-0 translate-x-8' : 'opacity-100 translate-x-0'}`}
      style={{ animation: exiting ? undefined : 'slideInToast 0.3s ease-out' }}
    >
      <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${ICON_STYLES[toast.type] || ICON_STYLES.info}`} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        {toast.title && <p className="font-semibold text-sm">{toast.title}</p>}
        <p className="text-sm">{toast.message}</p>
      </div>
      <button
        type="button"
        onClick={beginExit}
        aria-label="Fermer la notification"
        className="p-0.5 rounded hover:bg-black/5 transition-colors shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-current/40"
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
    setToasts(prev => [...prev, { id, type, message, ...options }]);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useMemo(() => ({
    success: (message, opts) => addToast('success', message, opts),
    error: (message, opts) => addToast('error', message, opts),
    info: (message, opts) => addToast('info', message, opts),
    warning: (message, opts) => addToast('warning', message, opts),
  }), [addToast]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* Toast container */}
      <div
        className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-[calc(100vw-2rem)] w-80 pointer-events-none"
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
    };
  }
  return ctx;
}
