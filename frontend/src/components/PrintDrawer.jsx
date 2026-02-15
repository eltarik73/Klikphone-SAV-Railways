import { useState, useRef, useEffect } from 'react';
import { X, Printer, ExternalLink, FileText, Receipt, ClipboardList, Copy as CopyIcon, Send, MessageCircle, Mail, ChevronDown, Download, CheckCircle, AlertCircle } from 'lucide-react';
import api from '../lib/api';
import { waLink, smsLink } from '../lib/utils';

const PRINT_TYPES = [
  { type: 'client', label: 'Client', desc: 'Reçu de dépôt', icon: Receipt },
  { type: 'staff', label: 'Atelier', desc: 'Fiche technicien', icon: ClipboardList },
  { type: 'combined', label: 'Double', desc: 'Client + Atelier', icon: CopyIcon },
  { type: 'devis', label: 'Devis', desc: 'Devis détaillé', icon: FileText },
  { type: 'recu', label: 'Reçu', desc: 'Reçu de paiement', icon: Receipt },
];

// Devis/Recu support both thermal and PDF — default is thermal like all others
const PDF_TYPES = new Set(['devis', 'recu']);

export default function PrintDrawer({ open, onClose, ticketId, ticketCode, clientTel, clientEmail }) {
  const [activeType, setActiveType] = useState('client');
  const iframeRef = useRef(null);
  const [iframeLoading, setIframeLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState(null);
  const [useA4, setUseA4] = useState(false);

  const printUrl = api.getPrintUrl(ticketId, activeType);
  const currentType = PRINT_TYPES.find(p => p.type === activeType);
  const canPdf = PDF_TYPES.has(activeType);
  const hasPdf = canPdf && useA4;

  // Reset to thermal tab each time drawer opens
  useEffect(() => {
    if (open) {
      setActiveType('client');
      setUseA4(false);
      setToast(null);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // Reload iframe when tab changes — reset to thermal
  useEffect(() => {
    if (open) { setIframeLoading(true); setUseA4(false); }
  }, [activeType]);

  // Reload iframe when format changes
  useEffect(() => {
    if (open) setIframeLoading(true);
  }, [useA4]);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Print via window.open — works reliably across browsers
  const handlePrint = async () => {
    setPrinting(true);
    try {
      const res = await fetch(printUrl);
      const html = await res.text();
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
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
      window.open(printUrl, '_blank');
    } finally {
      setPrinting(false);
    }
  };

  const handleOpenTab = () => {
    window.open(printUrl, '_blank');
  };

  const handleOpenPdf = () => {
    window.open(api.getPdfUrl(ticketId, activeType), '_blank');
  };

  // Share URLs — PDF for devis/recu, print HTML for others
  const getShareUrl = () => {
    if (hasPdf) return api.getSharePdfUrl(ticketId, activeType);
    return api.getSharePrintUrl(ticketId, activeType);
  };

  const handleSendWhatsApp = () => {
    if (!clientTel) return;
    const url = getShareUrl();
    const msg = `Bonjour, voici votre ${currentType?.desc || 'document'} pour le ticket ${ticketCode}.\n\n${url.trim()}`;
    window.open(waLink(clientTel, msg), '_blank');
    setSendOpen(false);
  };

  const handleSendSMS = () => {
    if (!clientTel) return;
    const url = getShareUrl();
    const msg = `Klikphone - ${currentType?.desc || 'document'} ${ticketCode}\n${url.trim()}`;
    window.open(smsLink(clientTel, msg), '_blank');
    setSendOpen(false);
  };

  const handleSendEmail = async () => {
    if (!clientEmail) return;
    setSending(true);
    try {
      const res = await api.sendDocument(ticketId, activeType, clientEmail);
      if (res.status === 'ok') {
        setSendOpen(false);
        setToast({ type: 'success', message: `Email envoy\u00e9 avec succ\u00e8s \u00e0 ${clientEmail}` });
      } else {
        setToast({ type: 'error', message: res.detail || "Erreur lors de l'envoi de l'email" });
      }
    } catch {
      setToast({ type: 'error', message: "Erreur lors de l'envoi de l'email" });
    } finally {
      setSending(false);
    }
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
              }`}>{(activeType === type && useA4 && PDF_TYPES.has(type)) ? 'A4' : '80mm'}</span>
            </button>
          ))}
        </div>

        {/* Preview area */}
        <div className="flex-1 relative bg-slate-100 overflow-hidden">
          {/* Format indicator + toggle */}
          <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
            <span className="text-[10px] font-semibold px-2 py-1 rounded-md shadow-sm bg-slate-800 text-white">
              {hasPdf ? 'PDF A4' : 'THERMIQUE 80mm'}
            </span>
            {canPdf && (
              <button
                onClick={() => { setUseA4(!useA4); setIframeLoading(true); }}
                className={`text-[10px] font-semibold px-2 py-1 rounded-md shadow-sm transition-colors ${useA4 ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
              >
                {useA4 ? 'Passer en 80mm' : 'Passer en A4'}
              </button>
            )}
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

          {/* Iframe container */}
          <div className="h-full overflow-auto flex justify-center pt-4 pb-8">
            <div className={`bg-white shadow-xl rounded-lg overflow-hidden shrink-0 ${hasPdf ? 'w-[480px]' : 'w-[320px]'}`}>
              <iframe
                ref={iframeRef}
                src={hasPdf ? api.getPdfUrl(ticketId, activeType) : printUrl}
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
          <div className="flex items-center gap-2">
            {/* Print button (thermal) */}
            <button
              onClick={handlePrint}
              disabled={printing}
              className={`flex-1 justify-center ${hasPdf ? 'btn-ghost border border-slate-200' : 'btn-primary shadow-lg shadow-brand-600/20'}`}
            >
              <Printer className="w-4 h-4" />
              {printing ? 'Ouverture...' : 'Imprimer 80mm'}
            </button>

            {/* PDF A4 button — for devis/recu when in A4 mode */}
            {canPdf && (
              <button
                onClick={handleOpenPdf}
                className={`${hasPdf ? 'btn-primary shadow-lg shadow-brand-600/20' : 'btn-ghost border border-slate-200'} flex-1 justify-center`}
              >
                <Download className="w-4 h-4" />
                PDF A4
              </button>
            )}

            {/* Send dropdown */}
            <div className="relative">
              <button
                onClick={() => setSendOpen(!sendOpen)}
                className="btn-ghost border border-slate-200 px-3 gap-1"
              >
                <Send className="w-4 h-4" />
                <ChevronDown className="w-3 h-3" />
              </button>
              {sendOpen && (
                <div className="absolute bottom-full right-0 mb-2 w-48 bg-white rounded-lg shadow-xl border border-slate-200 py-1 z-50">
                  <button
                    onClick={handleSendWhatsApp}
                    disabled={!clientTel}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <MessageCircle className="w-4 h-4 text-green-600" />
                    WhatsApp
                  </button>
                  <button
                    onClick={handleSendSMS}
                    disabled={!clientTel}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <Send className="w-4 h-4 text-blue-600" />
                    SMS
                  </button>
                  <button
                    onClick={handleSendEmail}
                    disabled={!clientEmail || sending}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <Mail className="w-4 h-4 text-red-500" />
                    {sending ? 'Envoi...' : hasPdf ? 'Email (PDF)' : 'Email'}
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={handleOpenTab}
              className="btn-ghost border border-slate-200 px-3"
              title="Ouvrir dans un nouvel onglet"
            >
              <ExternalLink className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[10px] text-slate-400 text-center mt-2">
            {hasPdf ? 'Document PDF format A4 professionnel' : 'Format optimisé pour imprimante thermique 80mm'}
          </p>
        </div>
      </div>

      {/* Toast notification — inside drawer, above footer */}
      {toast && (
        <div className="fixed inset-x-0 bottom-24 z-[60] flex justify-center pointer-events-none">
          <div className={`pointer-events-auto flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl border transition-all ${
            toast.type === 'success'
              ? 'bg-emerald-600 border-emerald-700 text-white'
              : 'bg-red-600 border-red-700 text-white'
          }`}
            style={{ animation: 'toastIn 300ms ease-out' }}
          >
            {toast.type === 'success'
              ? <CheckCircle className="w-5 h-5 shrink-0" />
              : <AlertCircle className="w-5 h-5 shrink-0" />
            }
            <span className="text-sm font-semibold">{toast.message}</span>
            <button onClick={() => setToast(null)} className="ml-2 p-0.5 rounded hover:bg-white/20">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Animation keyframe */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes toastIn {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </>
  );
}
