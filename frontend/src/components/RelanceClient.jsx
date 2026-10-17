import { useEffect, useId, useRef, useState } from 'react';
import api from '../lib/api';
import { envoyerSms, messageSmsEnvoye, versionCourteSms } from '../lib/sms';
import { waLink } from '../lib/utils';
import { contenuRelance, messageRelanceSecours } from '../lib/etagere';
import { telJoignable, libelleJoignable } from '../lib/contact';
import { useToast } from './Toast';
import { AlertTriangle, Loader2, Mail, MessageCircle, MessageSquare, Phone, X } from 'lucide-react';

const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1';

/**
 * Relance d'un client depuis l'étagère : message du palier (GET /api/etagere/{id}/message-relance,
 * modifiable) puis un clic sur le canal. Chaque relance est tracée (POST /api/etagere/{id}/relance),
 * sauf le SMS parti par le serveur, déjà noté sur le ticket : onDone(null) avance alors le compteur.
 * « J'ai appelé » passe par POST /api/tickets/{id}/contact (note 'appel', la même que « Contacté par
 * tél. » partout ailleurs) : onDone(null, 'appel', contact) avance le compteur et allume l'icône.
 */
export default function RelanceClient({ id, ticket: t, smsServeur = false, onDone, onCancel }) {
  const toast = useToast();
  const uid = useId();
  const messageId = `${uid}-message`;
  const noteId = `${uid}-note`;
  const aideId = `${uid}-aide`;
  const code = t.ticket_code || `#${t.id}`;
  // Second numéro du ticket s'il existe (« pour vous joindre si différent »), sinon la fiche
  const tel = telJoignable(t);
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
        const res = await api.contacterClient(t.id, note.trim() || undefined);
        onDone?.(null, 'appel', res?.contact || null);
        toast.success('Appel noté');
      }
    } catch (err) {
      toast.error(err?.message || 'Relance non enregistrée');
    } finally {
      setEnvoi(null);
    }
  }

  const icone = (canal, Icone) => (envoi === canal
    ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
    : <Icone aria-hidden="true" />);

  return (
    <div id={id} role="group" aria-label={`Relancer le client du ticket ${code}`} aria-busy={chargement || !!envoi}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !envoi) { e.stopPropagation(); onCancel?.(); }
      }}
      className="mt-3 basis-full rounded-xl border border-brand-200 bg-brand-50/50 p-3 sm:p-4">
      <div className="flex items-start gap-2">
        <label htmlFor={messageId} className="flex-1 t-label pt-2">
          Message de relance{Number.isFinite(Number(jours)) ? ` (J+${jours})` : ''}
        </label>
        <button type="button" onClick={onCancel} disabled={!!envoi} aria-label={`Fermer la relance ${code}`}
          className="btn-ghost btn-icon -mr-1 -mt-1 hover:bg-white">
          <X aria-hidden="true" />
        </button>
      </div>
      {chargement ? (
        <div className="mt-1 h-24 skeleton" aria-hidden="true" />
      ) : (
        <textarea ref={champRef} id={messageId} value={message} rows={4}
          onChange={(e) => setMessage(e.target.value)}
          aria-describedby={aideId}
          className="textarea mt-1 resize-y" />
      )}
      <p id={aideId} className="mt-1.5 text-xs text-slate-600">
        {secours && !chargement && (
          <span className="mr-1 inline-flex items-center gap-1 font-semibold text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Modèle indisponible, texte de secours.
          </span>
        )}
        Par SMS : version courte de {court.length} caractères{smsServeur ? ', envoyée par la boutique' : ', ouverte dans Messages'}.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <button type="button" onClick={() => relancer('sms')} disabled={!!envoi || chargement || !tel}
          className="btn-primary">
          {icone('sms', MessageSquare)} SMS
        </button>
        <button type="button" onClick={() => relancer('whatsapp')} disabled={!!envoi || chargement || !tel}
          className="btn-whatsapp">
          {icone('whatsapp', MessageCircle)} WhatsApp
        </button>
        <button type="button" onClick={() => relancer('email')} disabled={!!envoi || chargement || !email}
          title={email ? undefined : 'Pas d’adresse e-mail'}
          className="btn-secondary">
          {icone('email', Mail)} E-mail
        </button>
        <button type="button" onClick={() => relancer('appel')} disabled={!!envoi}
          className="btn-secondary">
          {icone('appel', Phone)} J’ai appelé
        </button>
      </div>
      {(!tel || !email) && (
        <p className="mt-1.5 text-xs text-slate-600">
          {!tel ? 'Pas de téléphone : SMS et WhatsApp indisponibles. ' : ''}
          {!email ? 'Pas d’adresse e-mail.' : ''}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor={noteId} className="t-label">Note d’appel (facultatif)</label>
        <input id={noteId} type="text" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); relancer('appel'); } }}
          placeholder="ex. passe samedi, messagerie"
          className="input min-w-0 flex-1 basis-48" />
        {tel && (
          <a href={`tel:${tel.replace(/[^\d+]/g, '')}`}
            className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-semibold tabular-nums text-brand-700 underline-offset-2 hover:underline ${FOCUS_RING}`}>
            <Phone className="h-4 w-4" aria-hidden="true" /> {libelleJoignable(t)}
          </a>
        )}
      </div>
    </div>
  );
}
