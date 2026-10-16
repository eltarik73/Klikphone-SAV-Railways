import { useEffect, useId, useRef, useState } from 'react';
import api from '../lib/api';
import { envoyerSms, messageSmsEnvoye, versionCourteSms } from '../lib/sms';
import { waLink } from '../lib/utils';
import { contenuRelance, messageRelanceSecours } from '../lib/etagere';
import { useToast } from './Toast';
import { AlertTriangle, Loader2, Mail, MessageCircle, MessageSquare, Phone, X } from 'lucide-react';

const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1';
const BOUTON = `inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`;

/**
 * Relance d'un client depuis l'étagère : message du palier (GET /api/etagere/{id}/message-relance,
 * modifiable) puis un clic sur le canal. Chaque relance est tracée (POST /api/etagere/{id}/relance),
 * sauf le SMS parti par le serveur, déjà noté sur le ticket : onDone(null) avance alors le compteur.
 */
export default function RelanceClient({ id, ticket: t, smsServeur = false, onDone, onCancel }) {
  const toast = useToast();
  const uid = useId();
  const messageId = `${uid}-message`;
  const noteId = `${uid}-note`;
  const aideId = `${uid}-aide`;
  const code = t.ticket_code || `#${t.id}`;
  const tel = String(t.client_tel || '').trim();
  const email = String(t.client_email || '').trim();

  const [message, setMessage] = useState('');
  const [jours, setJours] = useState(t.jours_attente);
  const [chargement, setChargement] = useState(true);
  const [secours, setSecours] = useState(false);
  const [note, setNote] = useState('');
  const [envoi, setEnvoi] = useState(null);
  const champRef = useRef(null);

  useEffect(() => {
    let vivant = true;
    Promise.resolve()
      .then(() => api.getMessageRelance(t.id))
      .then((res) => {
        if (!vivant) return;
        const texte = String(res?.message ?? '').trim();
        setMessage(texte || messageRelanceSecours(t));
        setSecours(!texte);
        if (Number.isFinite(Number(res?.jours))) setJours(Number(res.jours));
      })
      .catch(() => {
        if (!vivant) return;
        setMessage(messageRelanceSecours(t));
        setSecours(true);
      })
      .finally(() => { if (vivant) setChargement(false); });
    return () => { vivant = false; };
    // Une lecture par ouverture du panneau (pas à chaque mise à jour de la ligne)
  }, [t.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!chargement) champRef.current?.focus({ preventScroll: true });
  }, [chargement]);

  const texte = message.trim();
  const court = versionCourteSms(texte);

  async function tracer(canal, contenu) {
    const res = await api.logRelance(t.id, canal, contenu);
    onDone?.(res || null, canal);
  }

  async function relancer(canal) {
    if (envoi) return;
    if (canal !== 'appel' && !texte) { toast.error('Message vide'); return; }
    // WhatsApp : fenêtre ouverte dans le geste de l'utilisateur, avant tout await (bloqueur de fenêtres)
    if (canal === 'whatsapp') window.open(waLink(tel, texte), '_blank', 'noopener');
    setEnvoi(canal);
    try {
      if (canal === 'sms') {
        const res = await envoyerSms({ serveur: smsServeur, ticketId: t.id, tel, message: court, libelle: 'Relance' });
        if (res.mode === 'serveur') {
          toast.success(messageSmsEnvoye(res));
          onDone?.(null, canal);
          return;
        }
        await tracer('sms', contenuRelance(court, jours));
        toast.success('Relance SMS notée');
      } else if (canal === 'whatsapp') {
        await tracer('whatsapp', contenuRelance(texte, jours));
        toast.success('Relance WhatsApp notée');
      } else if (canal === 'email') {
        const res = await api.envoyerEmail(email, `Klikphone - Votre appareil vous attend (${code})`, texte);
        if (res?.status !== 'ok') {
          toast.error(res?.message || 'E-mail non envoyé');
          return;
        }
        await tracer('email', contenuRelance(texte, jours));
        toast.success('E-mail de relance envoyé');
      } else {
        await tracer('appel', note.trim());
        toast.success('Appel noté');
      }
    } catch (err) {
      toast.error(err?.message || 'Relance non enregistrée');
    } finally {
      setEnvoi(null);
    }
  }

  const icone = (canal, Icone) => (envoi === canal
    ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
    : <Icone className="h-4 w-4" aria-hidden="true" />);

  return (
    <div id={id} role="group" aria-label={`Relancer le client du ticket ${code}`} aria-busy={chargement || !!envoi}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !envoi) { e.stopPropagation(); onCancel?.(); }
      }}
      className="mt-2 basis-full rounded-xl border border-brand-200 bg-brand-50/60 p-3">
      <div className="flex items-start gap-2">
        <label htmlFor={messageId} className="flex-1 text-xs font-semibold text-slate-800">
          Message de relance{Number.isFinite(Number(jours)) ? ` (J+${jours})` : ''}
        </label>
        <button type="button" onClick={onCancel} disabled={!!envoi} aria-label={`Fermer la relance ${code}`}
          className={`-mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-white ${FOCUS_RING}`}>
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {chargement ? (
        <div className="mt-1 h-24 rounded-lg bg-white/70 animate-shimmer" aria-hidden="true" />
      ) : (
        <textarea ref={champRef} id={messageId} value={message} rows={4}
          onChange={(e) => setMessage(e.target.value)}
          aria-describedby={aideId}
          className={`mt-1 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 ${FOCUS_RING}`} />
      )}
      <p id={aideId} className="mt-1 text-xs text-slate-700">
        {secours && !chargement && (
          <span className="mr-1 inline-flex items-center gap-1 font-semibold text-amber-900">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Modèle indisponible, texte de secours.
          </span>
        )}
        Par SMS : version courte de {court.length} caractères{smsServeur ? ', envoyée par la boutique' : ', ouverte dans Messages'}.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <button type="button" onClick={() => relancer('sms')} disabled={!!envoi || chargement || !tel}
          className={`${BOUTON} bg-brand-700 text-white hover:bg-brand-800`}>
          {icone('sms', MessageSquare)} SMS
        </button>
        <button type="button" onClick={() => relancer('whatsapp')} disabled={!!envoi || chargement || !tel}
          className={`${BOUTON} bg-green-700 text-white hover:bg-green-800`}>
          {icone('whatsapp', MessageCircle)} WhatsApp
        </button>
        <button type="button" onClick={() => relancer('email')} disabled={!!envoi || chargement || !email}
          title={email ? undefined : 'Pas d’adresse e-mail'}
          className={`${BOUTON} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50`}>
          {icone('email', Mail)} E-mail
        </button>
        <button type="button" onClick={() => relancer('appel')} disabled={!!envoi}
          className={`${BOUTON} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50`}>
          {icone('appel', Phone)} J’ai appelé
        </button>
      </div>
      {(!tel || !email) && (
        <p className="mt-1.5 text-xs text-slate-700">
          {!tel ? 'Pas de téléphone : SMS et WhatsApp indisponibles. ' : ''}
          {!email ? 'Pas d’adresse e-mail.' : ''}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label htmlFor={noteId} className="text-xs font-semibold text-slate-800">Note d’appel (facultatif)</label>
        <input id={noteId} type="text" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); relancer('appel'); } }}
          placeholder="ex. passe samedi, messagerie"
          className={`h-11 min-w-0 flex-1 basis-48 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500 ${FOCUS_RING}`} />
        {tel && (
          <a href={`tel:${tel.replace(/[^\d+]/g, '')}`}
            className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-brand-800 underline-offset-2 hover:underline ${FOCUS_RING}`}>
            <Phone className="h-4 w-4" aria-hidden="true" /> {tel}
          </a>
        )}
      </div>
    </div>
  );
}
