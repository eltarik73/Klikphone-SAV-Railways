import { Component } from 'react';
import { AlertTriangle, ArrowLeft, RefreshCw, Copy } from 'lucide-react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    this.setState({ errorInfo: info });
    console.error('[ErrorBoundary]', error?.message, error?.stack, info?.componentStack);
  }

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
    navigator.clipboard.writeText(text).catch(() => {});
  };

  render() {
    if (this.state.hasError) {
      const msg = this.state.error?.message || '';
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl shadow-lg border border-slate-200 max-w-md w-full p-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-red-100 flex items-center justify-center mx-auto mb-5">
              <AlertTriangle className="w-7 h-7 text-red-500" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 mb-2">Oups, une erreur</h2>
            {msg && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-left">
                <p className="text-xs font-mono text-red-700 break-all">{msg}</p>
              </div>
            )}
            <p className="text-sm text-slate-500 mb-6">
              Pas de panique, vous pouvez revenir en arrière ou recharger.
            </p>
            <div className="space-y-2">
              <button onClick={this.handleReload}
                className="w-full py-3 px-4 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4" /> Recharger la page
              </button>
              <button onClick={this.handleBack}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium transition-colors flex items-center justify-center gap-2">
                <ArrowLeft className="w-4 h-4" /> Retour
              </button>
              <button onClick={this.handleCopy}
                className="w-full py-2 px-4 rounded-xl text-slate-400 hover:text-slate-600 text-xs font-medium transition-colors flex items-center justify-center gap-1">
                <Copy className="w-3 h-3" /> Copier le détail de l'erreur
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
