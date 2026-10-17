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
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6" role="alert" aria-live="assertive">
          <div className="card shadow-lg max-w-md w-full p-6 sm:p-8">
            <div className="empty-state min-h-0 max-h-none py-0 px-0 mb-5">
              <div className="empty-state-icon bg-red-50 text-red-700">
                <AlertTriangle aria-hidden="true" />
              </div>
              <h2 className="t-h2">Oups, une erreur est survenue</h2>
              <p className="t-body text-slate-500 max-w-sm">
                L'application a rencontré un problème inattendu. Vous pouvez réessayer, recharger ou revenir en arrière.
              </p>
            </div>
            {msg && (
              <div className="error-state mb-5 text-left">
                <AlertTriangle aria-hidden="true" />
                <p className="t-mono text-red-800 break-all min-w-0">{msg}</p>
              </div>
            )}
            <div className="space-y-2">
              <button
                type="button"
                onClick={this.handleRetry}
                className="btn-secondary btn-block"
                aria-label="Réessayer"
              >
                <RefreshCw aria-hidden="true" /> Réessayer
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                className="btn-secondary btn-block"
                aria-label="Recharger la page"
              >
                <RefreshCw aria-hidden="true" /> Recharger la page
              </button>
              <button
                type="button"
                onClick={this.handleBack}
                className="btn-ghost btn-block"
                aria-label="Retour à la page précédente"
              >
                <ArrowLeft aria-hidden="true" /> Retour
              </button>
              <button
                type="button"
                onClick={this.handleCopy}
                className="btn-ghost btn-sm btn-block text-slate-500"
                aria-label="Copier le détail de l'erreur"
              >
                <Copy aria-hidden="true" /> {this.state.copied ? 'Copié' : "Copier le détail de l'erreur"}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
