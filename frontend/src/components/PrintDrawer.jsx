import { useState, useRef, useEffect } from 'react';
import { X, Printer, ExternalLink, FileText, Receipt, ClipboardList, Copy as CopyIcon } from 'lucide-react';
import api from '../lib/api';

const PRINT_TYPES = [
  { type: 'client', label: 'Client', desc: 'Reçu de dépôt', icon: Receipt },
  { type: 'staff', label: 'Atelier', desc: 'Fiche technicien', icon: ClipboardList },
  { type: 'combined', label: 'Double', desc: 'Client + Atelier', icon: CopyIcon },
  { type: 'devis', label: 'Devis', desc: 'Devis détaillé', icon: FileText },
  { type: 'recu', label: 'Reçu', desc: 'Reçu de paiement', icon: Receipt },
];

export default function PrintDrawer({ open, onClose, ticketId, ticketCode }) {
  const [activeType, setActiveType] = useState('client');
  const iframeRef = useRef(null);
  const [iframeLoading, setIframeLoading] = useState(true);
  const [printing, setPrinting] = useState(false);

  const printUrl = api.getPrintUrl(ticketId, activeType);
  const currentType = PRINT_TYPES.find(p => p.type === activeType);

  useEffect(() => {
    if (open) {
      setIframeLoading(true);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open, activeType]);

  // Print via window.open — works reliably across browsers
  const handlePrint = async () => {
    setPrinting(true);
    try {
      const res = await fetch(printUrl);
      const html = await res.text();
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        // Popup blocked — fallback to new tab
        window.open(printUrl, '_blank');
        return;
      }
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
      }, 300);
    } catch {
      // Fallback — open in new tab
      window.open(printUrl, '_blank');
    } finally {
      setPrinting(false);
    }
  };

  const handleOpenTab = () => {
    window.open(printUrl, '_blank');
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 w-full sm:w-[520px] lg:w-[600px] bg-white shadow-2xl z-50 flex flex-col animate-in"
        style={{ animationName: 'slideInRight', animationDuration: '300ms' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="text-base font-display font-bold text-slate-900">Impression</h2>
            <p className="text-xs text-slate-400 mt-0.5">Ticket {ticketCode}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Type tabs */}
        <div className="flex gap-1 px-5 py-3 border-b border-slate-100 overflow-x-auto scrollbar-none shrink-0 bg-slate-50/50">
          {PRINT_TYPES.map(({ type, label, icon: Icon }) => (
            <button
              key={type}
              onClick={() => { setActiveType(type); setIframeLoading(true); }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                activeType === type
                  ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/25'
                  : 'text-slate-500 hover:bg-white hover:text-slate-700 hover:shadow-sm'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
              <span className={`text-[9px] px-1 py-0.5 rounded ${
                activeType === type ? 'bg-white/20' : 'bg-slate-200 text-slate-500'
              }`}>80mm</span>
            </button>
          ))}
        </div>

        {/* Preview area */}
        <div className="flex-1 relative bg-slate-100 overflow-hidden">
          {/* Format indicator */}
          <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
            <span className="text-[10px] font-semibold px-2 py-1 rounded-md shadow-sm bg-slate-800 text-white">
              THERMIQUE 80mm
            </span>
          </div>

          {/* Loading */}
          {iframeLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-100 z-10">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-slate-400">Chargement de l'aperçu...</p>
              </div>
            </div>
          )}

          {/* Iframe container — thermal centered */}
          <div className="h-full overflow-auto flex justify-center pt-4 pb-8">
            <div className="w-[320px] bg-white shadow-xl rounded-lg overflow-hidden shrink-0">
              <iframe
                ref={iframeRef}
                src={printUrl}
                className="w-full h-full border-0"
                style={{ minHeight: '600px' }}
                title={`Aperçu ${currentType?.label}`}
                onLoad={() => setIframeLoading(false)}
              />
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-5 py-4 border-t border-slate-100 bg-white shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={handlePrint}
              disabled={printing}
              className="btn-primary flex-1 justify-center shadow-lg shadow-brand-600/20"
            >
              <Printer className="w-4 h-4" />
              {printing ? 'Ouverture...' : 'Imprimer'}
            </button>
            <button
              onClick={handleOpenTab}
              className="btn-ghost border border-slate-200 px-4"
              title="Ouvrir dans un nouvel onglet"
            >
              <ExternalLink className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[10px] text-slate-400 text-center mt-2">
            Format optimisé pour imprimante thermique 80mm
          </p>
        </div>
      </div>

      {/* Animation keyframe */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}
