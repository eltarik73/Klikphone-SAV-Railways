import { Component } from 'react';
import { AlertTriangle, ArrowLeft, RefreshCw, Copy } from 'lucide-react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, copied: false };
    this._copyResetTimer = null;
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    this.setState({ errorInfo: info });
    // Structured log for observability (Sentry, Railway logs, etc.)
    console.error('[ErrorBoundary]', error?.message, error?.stack, info?.componentStack);

    // Auto-reload si erreur de chunk dynamique (hash change apres deploy)
    // Protege contre boucle infinie : max 1 reload par 10s via sessionStorage
    const msg = (error?.message || '').toLowerCase();
    const isChunkError = (
      msg.includes('chunkloaderror') ||
      msg.includes("failed to fetch dynamically imported module") ||
      msg.includes("importing a module script failed") ||
      msg.includes("loading chunk") ||
      /loading css chunk \d+ failed/.test(msg)
    );
    if (isChunkError) {
      try {
        const KEY = '__kp_chunk_reload_at__';
        const last = parseInt(sessionStorage.getItem(KEY) || '0', 10);
        if (Date.now() - last >= 10_000) {
          sessionStorage.setItem(KEY, String(Date.now()));
          window.location.reload();
        }
      } catch {
        window.location.reload();
      }
    }
  }

  componentWillUnmount() {
    if (this._copyResetTimer) clearTimeout(this._copyResetTimer);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, copied: false });
  };

  handleBack = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = '/';
    }
  };

  handleReload = () => {
    window.location.reload();
  };

  handleCopy = () => {
    const err = this.state.error;
    const info = this.state.errorInfo;
    const text = `${err?.message || 'Unknown error'}\n\n${err?.stack || ''}\n\nComponent:\n${info?.componentStack || ''}`;
    const show = () => {
      this.setState({ copied: true });
      if (this._copyResetTimer) clearTimeout(this._copyResetTimer);
      this._copyResetTimer = setTimeout(() => this.setState({ copied: false }), 2000);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(show).catch((err) => {
        console.warn('[ErrorBoundary] clipboard write failed', err);
      });
    }
  };

  render() {
    if (this.state.hasError) {
      const msg = this.state.error?.message || '';
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6" role="alert" aria-live="assertive">
          <div className="bg-white rounded-2xl shadow-lg border border-slate-200 max-w-md w-full p-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-red-100 flex items-center justify-center mx-auto mb-5">
              <AlertTriangle className="w-7 h-7 text-red-500" aria-hidden="true" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 mb-2">Oups, une erreur est survenue</h2>
            <p className="text-sm text-slate-500 mb-4">
              L'application a rencontré un problème inattendu. Vous pouvez réessayer, recharger ou revenir en arrière.
            </p>
            {msg && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-left">
                <p className="text-xs font-mono text-red-700 break-all">{msg}</p>
              </div>
            )}
            <div className="space-y-2">
              <button
                type="button"
                onClick={this.handleRetry}
                className="w-full py-3 px-4 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
                aria-label="Réessayer"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" /> Réessayer
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold transition-colors flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
                aria-label="Recharger la page"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" /> Recharger la page
              </button>
              <button
                type="button"
                onClick={this.handleBack}
                className="w-full py-2.5 px-4 rounded-xl text-slate-600 hover:bg-slate-100 text-sm font-medium transition-colors flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
                aria-label="Retour à la page précédente"
              >
                <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Retour
              </button>
              <button
                type="button"
                onClick={this.handleCopy}
                className="w-full py-2 px-4 rounded-xl text-slate-400 hover:text-slate-600 text-xs font-medium transition-colors flex items-center justify-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2"
                aria-label="Copier le détail de l'erreur"
              >
                <Copy className="w-3 h-3" aria-hidden="true" /> {this.state.copied ? 'Copié' : "Copier le détail de l'erreur"}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
