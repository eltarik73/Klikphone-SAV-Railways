import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Receipt, ClipboardList, Copy as CopyIcon, FileText, Send, MessageCircle, Mail, ChevronDown, Loader2, Lock, RefreshCw,
} from 'lucide-react';
import api from '../lib/api';
import { waLink, smsLink } from '../lib/utils';
import PrintPreview, { nextFrame, cancelFrame } from './PrintPreview';

// shareable:false → la fiche atelier (PIN, schéma, notes internes) ne part jamais chez le client
export const TICKET_DOCUMENTS = [
  { id: 'client', label: 'Client', desc: 'Reçu de dépôt', shareLabel: 'reçu de dépôt', icon: Receipt, shareable: true, pdf: false },
  { id: 'staff', label: 'Atelier', desc: 'Fiche technicien (interne)', icon: ClipboardList, shareable: false, pdf: false },
  { id: 'combined', label: 'Double', desc: 'Ticket client + fiche atelier', icon: CopyIcon, shareable: false, pdf: false },
  { id: 'devis', label: 'Devis', desc: 'Devis détaillé', shareLabel: 'devis', icon: FileText, shareable: true, pdf: true },
  { id: 'recu', label: 'Reçu', desc: 'Reçu de paiement', shareLabel: 'reçu de paiement', icon: Receipt, shareable: true, pdf: true },
];

export function buildTicketDocuments(ticketId, ticketCode) {
  return TICKET_DOCUMENTS.map((d) => {
    const formats = {
      thermal: {
        paper: 'thermal80',
        label: 'Ticket 80 mm',
        load: (signal) => api.getPrintHtml(ticketId, d.id, { signal }).then((html) => ({ kind: 'html', html })),
      },
    };
    if (d.pdf) {
      formats.a4 = {
        paper: 'a4',
        kind: 'pdf',
        label: 'A4 (PDF)',
        load: (signal) => api.getPdfBlob(ticketId, d.id, { signal })
          .then((blob) => ({ kind: 'pdf', blob, filename: `${d.id}_${ticketCode || ticketId}.pdf` })),
      };
    }
    return { ...d, formats };
  });
}

export function isAbsoluteHttpUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export function pickShareUrl(links, docId, formatKey) {
  const doc = TICKET_DOCUMENTS.find((d) => d.id === docId);
  if (!links || !doc?.shareable) return null;
  const url = formatKey === 'a4' && doc.pdf ? links[`${docId}_pdf`] : links[docId];
  return isAbsoluteHttpUrl(url) ? url : null;
}

export function canEmailDocument(docId) {
  return !!TICKET_DOCUMENTS.find((d) => d.id === docId)?.shareable;
}

export function buildShareMessage(channel, { label, ticketCode, url }) {
  if (channel === 'sms') return `Klikphone - ${label}${ticketCode ? ` ${ticketCode}` : ''} : ${url}`;
  return `Bonjour, voici votre ${label} Klikphone${ticketCode ? ` pour le ticket ${ticketCode}` : ''} :\n${url}`;
}

const LINKS_IDLE = { status: 'idle', data: null, error: null };
const ITEM_CLS = 'flex w-full min-h-11 items-center gap-2.5 px-3 text-left text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:bg-slate-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:text-slate-500';

function ShareMenu({ doc, formatKey, ticketId, ticketCode, clientTel, clientEmail, links, onNeedLinks, notify, escapeRef }) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const wrapRef = useRef(null);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const menuId = useId();

  useEffect(() => { setOpen(false); }, [doc.id, formatKey]);

  useEffect(() => {
    escapeRef.current = open ? () => { setOpen(false); triggerRef.current?.focus(); return true; } : null;
    return () => { escapeRef.current = null; };
  }, [open, escapeRef]);

  useEffect(() => {
    if (!open) return undefined;
    if (clientTel && (links.status === 'idle' || links.status === 'error')) onNeedLinks();
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    const raf = nextFrame(() => {
      menuRef.current?.querySelector('[role="menuitem"]:not([disabled])')?.focus();
    });
    return () => {
      document.removeEventListener('mousedown', onDown);
      cancelFrame(raf);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const shareUrl = pickShareUrl(links.data, doc.id, formatKey);
  const label = doc.shareLabel || doc.desc.toLowerCase();
  const waHref = clientTel && shareUrl ? waLink(clientTel, buildShareMessage('whatsapp', { label, ticketCode, url: shareUrl })) : null;
  const smsHref = clientTel && shareUrl ? smsLink(clientTel, buildShareMessage('sms', { label, ticketCode, url: shareUrl })) : null;
  const notes = [];
  if (!clientTel) notes.push('Aucun téléphone client');
  else if (links.status === 'loading' || links.status === 'idle') notes.push('Préparation du lien…');
  else if (links.status === 'ready' && !shareUrl) notes.push('Lien de partage invalide (URL non absolue)');
  if (!clientEmail) notes.push('Aucun email client');

  const onMenuKeyDown = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || [])];
    if (!items.length) return;
    e.preventDefault();
    const idx = items.indexOf(document.activeElement);
    let next = 0;
    if (e.key === 'ArrowDown') next = (idx + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (idx - 1 + items.length) % items.length;
    else if (e.key === 'End') next = items.length - 1;
    items[next].focus();
  };

  const handleEmail = async () => {
    if (!clientEmail || sending || !canEmailDocument(doc.id)) return;
    setSending(true);
    try {
      const res = await api.sendDocument(ticketId, doc.id, clientEmail);
      if (res?.status === 'ok') {
        setOpen(false);
        notify('success', `Email envoyé à ${clientEmail}`);
      } else {
        notify('error', res?.detail || "Erreur lors de l'envoi de l'email");
      }
    } catch (err) {
      notify('error', err?.message || "Erreur lors de l'envoi de l'email");
    } finally {
      setSending(false);
    }
  };

  const linkItem = (href, Icon, iconCls, text) => (href ? (
    <a role="menuitem" href={href} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className={ITEM_CLS}>
      <Icon className={`h-4 w-4 ${iconCls}`} aria-hidden="true" /> {text}
    </a>
  ) : (
    <button type="button" role="menuitem" disabled className={ITEM_CLS}>
      <Icon className="h-4 w-4" aria-hidden="true" /> {text}
      {clientTel && links.status === 'loading' && <Loader2 className="ml-auto h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />}
    </button>
  ));

  return (
    <div ref={wrapRef} className="relative">
      <button ref={triggerRef} type="button" onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        className="btn-secondary min-h-11 px-3">
        <Send aria-hidden="true" />
        Envoyer
        <ChevronDown className={`motion-safe:transition-transform duration-150 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-30 mb-2 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg animate-in">
          <p aria-hidden="true" className="px-3 pt-1.5 pb-1 t-caption">Envoyer au client : {label}</p>
          <div ref={menuRef} id={menuId} role="menu" aria-label={`Envoyer le ${label} au client`} onKeyDown={onMenuKeyDown}>
            {linkItem(waHref, MessageCircle, 'text-emerald-700', 'WhatsApp')}
            {linkItem(smsHref, Send, 'text-brand-600', 'SMS')}
            <button type="button" role="menuitem" onClick={handleEmail} disabled={!clientEmail || sending} className={ITEM_CLS}>
              {sending ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : <Mail className="h-4 w-4 text-slate-500" aria-hidden="true" />}
              {sending ? 'Envoi…' : doc.pdf ? 'Email (PDF A4)' : 'Email'}
            </button>
            {clientTel && links.status === 'error' && (
              <button type="button" role="menuitem" onClick={onNeedLinks} className={`${ITEM_CLS} text-brand-700`}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" /> Lien indisponible : réessayer
              </button>
            )}
          </div>
          <div className="px-3 pb-1.5 t-caption" aria-live="polite">
            {notes.map((n) => <p key={n}>{n}</p>)}
            {clientTel && links.status === 'error' && <p>{links.error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PrintDrawer({
  open, onClose, ticketId, ticketCode, clientTel, clientEmail,
  initialDocId = 'client', beforeOpen, onBeforePrint, reloadKey, onPrinted,
}) {
  const documents = useMemo(() => buildTicketDocuments(ticketId, ticketCode), [ticketId, ticketCode]);
  const [links, setLinks] = useState(LINKS_IDLE);
  const linksSeq = useRef(0);
  const escapeRef = useRef(null);

  const loadLinks = useCallback(() => {
    if (ticketId == null) return;
    const seq = ++linksSeq.current;
    setLinks((l) => ({ ...l, status: 'loading', error: null }));
    api.getShareLinks(ticketId).then(
      (data) => { if (seq === linksSeq.current) setLinks({ status: 'ready', data, error: null }); },
      (err) => { if (seq === linksSeq.current) setLinks({ status: 'error', data: null, error: err?.message || 'erreur' }); },
    );
  }, [ticketId]);

  // Les liens sont préparés à l'avance : le clic WhatsApp/SMS reste un lien direct (pas de popup bloquée)
  useEffect(() => {
    linksSeq.current += 1;
    setLinks(LINKS_IDLE);
    if (!open || ticketId == null || !clientTel) return undefined;
    const t = setTimeout(loadLinks, 800);
    return () => clearTimeout(t);
  }, [open, ticketId, clientTel, loadLinks]);

  const onEscape = useCallback(() => (escapeRef.current ? escapeRef.current() : false), []);

  const renderActions = ({ doc, formatKey, notify }) => (doc.shareable ? (
    <ShareMenu doc={doc} formatKey={formatKey} ticketId={ticketId} ticketCode={ticketCode}
      clientTel={clientTel} clientEmail={clientEmail} links={links} onNeedLinks={loadLinks}
      notify={notify} escapeRef={escapeRef} />
  ) : (
    <span className="inline-flex min-h-11 items-center gap-1.5 px-1 t-caption">
      <Lock className="h-4 w-4 text-slate-400" aria-hidden="true" /> Document interne, non envoyable
    </span>
  ));

  return (
    <PrintPreview
      variant="dialog"
      open={!!open && ticketId != null}
      onClose={onClose}
      title="Impression"
      subtitle={ticketCode ? `Ticket ${ticketCode}` : undefined}
      documents={documents}
      initialDocId={initialDocId}
      beforeLoad={beforeOpen || onBeforePrint}
      reloadKey={reloadKey}
      prefetchIds={initialDocId === 'client' ? ['staff'] : []}
      onEscape={onEscape}
      onPrinted={onPrinted}
      renderActions={renderActions}
    />
  );
}
