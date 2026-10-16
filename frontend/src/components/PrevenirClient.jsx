import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  BellRing, Send, Mail, MessageCircle, CircleCheckBig, AlertTriangle, Info, Loader2, ArrowLeft,
} from 'lucide-react';
import api from '../lib/api';
import { envoyerSms, messageSmsEnvoye } from '../lib/sms';
import {
  DEFAULT_TEMPLATES, LIEN_AVIS_DEFAUT, CANAUX_MESSAGE, messagePret, modelePret, ligneJournal, lienWhatsApp,
  numeroSms, emailValide, canalPrevenir, dernierAvisPret, texteDejaPrevenu, texteEchecSms, erreurEnvoi,
} from '../lib/messages';
import { useToast } from './Toast';

// Grille de tous les modèles (« Choisir un autre message ») : chargée à la demande
const MessageComposer = lazy(() => import('./MessageComposer'));

const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2';
const LIBELLE_PRET_DEFAUT = modelePret(DEFAULT_TEMPLATES).label;

/** Modèles de la boutique (Config > Messages) et lien d'avis Google ; valeurs par défaut en cas d'erreur. */
export async function chargerContexteMessage() {
  // Erreur synchrone comprise (client d'API simulé sans la méthode)
  const lire = (fn) => Promise.resolve().then(fn).catch(() => null);
  const [templates, cfg] = await Promise.all([
    lire(() => api.getMessageTemplates()),
    lire(() => api.getCached('/api/config', 5 * 60_000)),
  ]);
  const params = {};
  (Array.isArray(cfg) ? cfg : []).forEach((p) => { if (p?.cle) params[p.cle] = p.valeur; });
  return {
    templates: Array.isArray(templates) && templates.length ? templates : DEFAULT_TEMPLATES,
    lienAvis: params.GOOGLE_REVIEW_LINK || LIEN_AVIS_DEFAUT,
  };
}

const CANAUX = [
  { id: 'sms', label: 'SMS', Icon: Send },
  { id: 'email', label: 'E-mail', Icon: Mail },
  { id: 'whatsapp', label: 'WhatsApp', Icon: MessageCircle },
];

const TONS = {
  ok: { cls: 'text-emerald-900', Icon: CircleCheckBig },
  warn: { cls: 'text-amber-900', Icon: AlertTriangle },
  info: { cls: 'text-slate-800', Icon: Info },
  neutre: { cls: 'text-slate-700', Icon: Info },
};

/**
 * Carte « Prévenir le client » du scan comptoir (ticket « Réparation terminée ») : aperçu du
 * message « appareil prêt » (version SMS courte), envoi par SMS / e-mail / WhatsApp, rappel de
 * ce qui a déjà été envoyé (notes du ticket) et confirmation avant un renvoi.
 *
 * auto : issue de « Terminé + prévenir le client » ({ etat: 'envoi' | 'envoye' | 'manuel' |
 * 'echec' | 'impossible' | 'sans_tarif', canal, incertain?, message }). ouverte / onOuvrir / onReplier : carte
 * dépliée ou réduite à une ligne. onEnvoye : message parti depuis la carte ; onNotesChange :
 * les notes du ticket ont changé (refus de Brevo noté par le serveur, autre message envoyé).
 */
export default function PrevenirClient({
  ticket, notes, auto = null, smsServeur = false, auteur, ouverte = true,
  onOuvrir, onReplier, onEnvoye, onNotesChange, titreRef, boutonRef,
}) {
  const t = ticket || {};
  const toast = useToast();
  const ids = useId();
  const titreId = `${ids}-titre`;
  const corpsId = `${ids}-corps`;
  const raisonsId = `${ids}-raisons`;
  const confirmId = `${ids}-confirm`;

  const [ctx, setCtx] = useState({ templates: DEFAULT_TEMPLATES, lienAvis: LIEN_AVIS_DEFAUT });
  const [sending, setSending] = useState(null);
  const sendingRef = useRef(false);
  const [confirmer, setConfirmer] = useState(null);
  const [composer, setComposer] = useState(false);
  const [dernier, setDernier] = useState(null);
  // Envoi interrompu (délai dépassé, coupure) : le message est peut-être parti
  const [incertain, setIncertain] = useState(null);
  // Serveur « SMS désactivé » alors que l'état en cache le disait actif : lien sms: au prochain clic
  const [smsSansServeur, setSmsSansServeur] = useState(false);
  const boutons = useRef({});
  const nonRef = useRef(null);

  useEffect(() => {
    let vivant = true;
    chargerContexteMessage().then((c) => { if (vivant) setCtx(c); });
    return () => { vivant = false; };
  }, []);

  useEffect(() => {
    if (confirmer) nonRef.current?.focus();
  }, [confirmer]);

  const msg = useMemo(() => messagePret(ctx.templates, t, { lienAvis: ctx.lienAvis }), [ctx, t]);
  const libelles = useMemo(() => [...new Set([msg.libelle, LIBELLE_PRET_DEFAUT])], [msg.libelle]);
  const historique = useMemo(() => dernierAvisPret(notes, libelles), [notes, libelles]);

  const tel = String(t.client_tel ?? '').trim();
  const email = String(t.client_email ?? '').trim();
  const numero = numeroSms(tel);
  const aEmail = emailValide(email);
  const canal = canalPrevenir(t);
  // Envoi automatique refusé faute de configuration : le bouton SMS ouvre l'app Messages
  const serveur = smsServeur && auto?.etat !== 'manuel' && !smsSansServeur;
  const autoEnvoi = auto?.etat === 'envoi';
  const occupe = !!sending || autoEnvoi;
  const resultat = dernier || (auto?.etat === 'envoye' ? auto : null);
  const envoiIncertain = !resultat && (incertain || (auto?.etat === 'echec' && auto.incertain ? auto.message : null));
  // Déjà prévenu, ou peut-être (envoi interrompu) : confirmation avant de renvoyer
  const deja = !!(resultat || historique.envoye || envoiIncertain);
  const prenom = String(t.client_prenom ?? '').trim();

  const possible = { sms: numero.portable, email: aEmail, whatsapp: !!tel };
  // SMS refusé (envoi automatique ou note du serveur) : l'e-mail est mis en avant à la place
  const smsRefuse = !resultat && ((auto?.etat === 'echec' && auto.canal === 'sms' && !auto.incertain)
    || (!auto && !!historique.echec));
  const recommande = smsRefuse && possible.email && !msg.sansTarif ? 'email' : canal;
  const apercuSms = recommande === 'sms';
  const raisons = [];
  if (msg.sansTarif) raisons.push('Montant à 0 € : renseignez le tarif sur la fiche, ou choisissez un autre message.');
  if (!possible.sms) raisons.push(`SMS : ${numero.raison}.`);
  if (!possible.email) raisons.push(email ? `E-mail : adresse « ${email} » invalide.` : 'E-mail : aucune adresse sur la fiche.');
  if (!possible.whatsapp) raisons.push('WhatsApp : pas de numéro sur la fiche.');

  const lignes = [];
  if (autoEnvoi) {
    lignes.push({ id: 'envoi', ton: 'info', spin: true, texte: auto.message });
  } else if (resultat) {
    lignes.push({ id: 'ok', ton: 'ok', texte: resultat.message });
  } else {
    if (auto?.message) lignes.push({ id: 'auto', ton: auto.etat === 'manuel' ? 'info' : 'warn', texte: auto.message });
    if (incertain) lignes.push({ id: 'incertain', ton: 'warn', texte: incertain });
    if (historique.envoye) {
      lignes.push({ id: 'deja', ton: historique.envoye.manuel ? 'info' : 'ok', texte: texteDejaPrevenu(historique.envoye) });
    }
    // Refus déjà décrit par l'envoi automatique : pas deux fois la même information
    if (historique.echec && auto?.etat !== 'echec') lignes.push({ id: 'echec', ton: 'warn', texte: texteEchecSms(historique.echec) });
    if (!lignes.length) lignes.push({ id: 'rien', ton: 'neutre', texte: 'Pas encore prévenu que l’appareil est prêt.' });
  }

  const envoyer = async (c) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setConfirmer(null);
    setSending(c);
    try {
      let smsParServeur = null;
      if (c === 'whatsapp') {
        window.open(lienWhatsApp(tel, msg.texte), '_blank');
      } else if (c === 'sms' && serveur) {
        try {
          smsParServeur = (await api.envoyerSms(t.id, msg.sms, msg.libelle)) || {};
        } catch (err) {
          if (err?.code !== 'sms_non_configure') throw err;
          // Pas de lien sms: après cet await (bloqué hors geste) : le prochain clic l'ouvrira
          Promise.resolve().then(() => api.getSmsEtat({ fresh: true })).catch(() => {});
          setSmsSansServeur(true);
          toast.info('Envoi automatique des SMS désactivé : appuyez à nouveau sur « SMS » pour l’envoyer depuis Messages.');
          requestAnimationFrame(() => boutons.current.sms?.focus());
          return;
        }
      } else if (c === 'sms') {
        // Sans envoi serveur, le lien sms: s'ouvre avant tout await (dans le geste de l'utilisateur)
        await envoyerSms({ serveur: false, ticketId: t.id, tel, message: msg.sms, libelle: msg.libelle });
      } else {
        const r = await api.envoyerEmail(email, msg.sujet, msg.texte);
        if (r?.status !== 'ok') throw new Error(r?.message || 'Erreur d’envoi de l’e-mail');
      }
      const message = smsParServeur ? messageSmsEnvoye(smsParServeur)
        : c === 'sms' ? 'SMS ouvert dans Messages : appuyez sur Envoyer'
          : c === 'email' ? `E-mail envoyé à ${email}` : 'WhatsApp ouvert avec le message';
      // Même journal que MessageComposer ; un SMS parti par le serveur y est déjà noté
      if (!smsParServeur) {
        try {
          await api.logMessage(t.id, auteur || 'Accueil', ligneJournal(msg.libelle, msg.texte), c);
        } catch {
          toast.warning(`${t.ticket_code || 'Ticket'} : envoi non noté sur le ticket.`);
        }
      }
      toast.success(message);
      setIncertain(null);
      setDernier({ canal: c, message });
      onEnvoye?.({ canal: c });
    } catch (err) {
      const e = erreurEnvoi(err);
      const vers = CANAUX_MESSAGE[c] || c;
      if (e.incertain) {
        // Le message a pu partir : on relit les notes et on demandera confirmation avant un renvoi
        const texte = `Envoi par ${vers} incertain (${e.raison}) : vérifiez avant de le renvoyer.`;
        setIncertain(texte);
        toast.warning(texte);
        onNotesChange?.();
      } else {
        toast.error(e.raison);
        // Refus de Brevo : l'échec est noté sur le ticket par le serveur
        if (err?.status === 424) onNotesChange?.();
      }
    } finally {
      sendingRef.current = false;
      setSending(null);
    }
  };

  const demander = (c) => {
    if (sendingRef.current || autoEnvoi) return;
    // Déjà prévenu : seul « Oui, renvoyer » envoie (un double clic sur le canal ne passe pas outre)
    if (deja) {
      if (confirmer !== c) setConfirmer(c);
      return;
    }
    envoyer(c);
  };

  const annulerConfirmation = () => {
    const c = confirmer;
    setConfirmer(null);
    requestAnimationFrame(() => boutons.current[c]?.focus());
  };

  const texteConfirmation = () => {
    const vers = CANAUX_MESSAGE[confirmer] || confirmer;
    let avant;
    if (resultat) avant = `${prenom || 'Le client'} vient d’être prévenu (${resultat.message}).`;
    else if (historique.envoye) avant = `${texteDejaPrevenu(historique.envoye)}.`;
    else avant = 'Le dernier envoi a peut-être abouti (connexion interrompue).';
    return `${avant} Renvoyer par ${vers} ?`;
  };

  const libelleBascule = ouverte ? (deja ? 'Replier' : 'Plus tard') : (deja ? 'Renvoyer…' : 'Prévenir…');

  return (
    <section aria-labelledby={titreId} className="rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-200" data-carte-prevenir="">
      <div className="flex items-start justify-between gap-3">
        <h3 id={titreId} ref={titreRef} tabIndex={-1}
          className="flex min-h-[44px] items-center gap-2 rounded text-base font-bold text-emerald-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
          <BellRing className="h-5 w-5 shrink-0" aria-hidden="true" />
          Prévenir {prenom || 'le client'}
        </h3>
        <button type="button" aria-expanded={ouverte} aria-controls={corpsId}
          onClick={ouverte ? onReplier : onOuvrir}
          className={`min-h-[44px] shrink-0 rounded-xl bg-white px-3 text-sm font-bold text-emerald-900 ring-1 ring-emerald-300 hover:bg-emerald-100 ${FOCUS_RING}`}>
          {libelleBascule}
        </button>
      </div>

      <div role="status" aria-live="polite">
        <ul className="mt-1 space-y-1">
          {lignes.map((l) => {
            const { cls, Icon } = TONS[l.ton];
            return (
              <li key={l.id} className={`flex items-start gap-2 text-sm font-semibold ${cls}`}>
                {l.spin
                  ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  : <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                <span className="min-w-0 break-words">{l.texte}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div id={corpsId} hidden={!ouverte} className="mt-3">
        {composer ? (
          <div className="rounded-xl bg-white p-3">
            <button type="button" onClick={() => setComposer(false)}
              className={`mb-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-1 text-sm font-semibold text-emerald-900 hover:underline ${FOCUS_RING}`}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Message « appareil prêt »
            </button>
            <Suspense fallback={<p className="text-sm text-slate-700">Chargement des modèles…</p>}>
              <MessageComposer ticket={t} integre
                onMessageSent={(r) => { onNotesChange?.(); if (!r?.echec) setComposer(false); }} />
            </Suspense>
          </div>
        ) : (
          <>
            <div className="rounded-xl bg-white p-3 ring-1 ring-emerald-100">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-600">
                {apercuSms ? (
                  <>
                    Texte du SMS · <span className="text-slate-900">{msg.segments.segments} SMS</span>
                    <span className="font-semibold normal-case tracking-normal">
                      {' '}({msg.segments.caracteres} caractères{msg.segments.unicode ? ', unicode : 70 par SMS' : ''})
                    </span>
                  </>
                ) : recommande === 'email' ? 'Texte de l’e-mail' : 'Texte du message'}
              </p>
              <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-slate-800">
                {apercuSms ? msg.sms : msg.texte}
              </p>
              {apercuSms && (
                <p className="mt-1.5 text-xs text-slate-600">E-mail et WhatsApp : texte complet, avec le lien de suivi.</p>
              )}
            </div>

            <div role="group" aria-label="Envoyer le message" aria-busy={occupe} className="mt-3 grid grid-cols-3 gap-2">
              {CANAUX.map(({ id, label, Icon }) => {
                const bloque = !possible[id] || msg.sansTarif;
                const enAvant = recommande === id;
                return (
                  <button key={id} type="button"
                    ref={(el) => {
                      boutons.current[id] = el;
                      if (boutonRef && id === (recommande || 'sms')) boutonRef.current = el;
                    }}
                    onClick={() => demander(id)}
                    disabled={occupe || bloque}
                    aria-describedby={bloque ? raisonsId : undefined}
                    className={`inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 ${
                      enAvant ? 'bg-emerald-700 text-white hover:bg-emerald-800' : 'bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50'
                    } ${FOCUS_RING}`}>
                    {sending === id
                      ? <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      : <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
                    {label}
                  </button>
                );
              })}
            </div>

            {raisons.length > 0 && (
              <ul id={raisonsId} className="mt-2 space-y-0.5 text-xs font-semibold text-slate-700">
                {raisons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            )}

            {confirmer && (
              <div role="group" aria-labelledby={confirmId}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return;
                  e.preventDefault();
                  e.stopPropagation();
                  annulerConfirmation();
                }}
                className="mt-3 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-300">
                <p id={confirmId} className="text-sm font-semibold text-amber-950">{texteConfirmation()}</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button ref={nonRef} type="button" onClick={annulerConfirmation}
                    className={`min-h-[44px] rounded-xl bg-white px-3 text-sm font-bold text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 ${FOCUS_RING}`}>
                    Non, ne pas renvoyer
                  </button>
                  <button type="button" onClick={() => envoyer(confirmer)} disabled={occupe}
                    className={`min-h-[44px] rounded-xl bg-amber-700 px-3 text-sm font-bold text-white hover:bg-amber-800 disabled:opacity-60 ${FOCUS_RING}`}>
                    Oui, renvoyer
                  </button>
                </div>
              </div>
            )}

            <button type="button" onClick={() => { setConfirmer(null); setComposer(true); }} disabled={occupe}
              className={`mt-2 inline-flex min-h-[44px] items-center rounded-lg px-1 text-sm font-semibold text-emerald-900 underline underline-offset-2 hover:text-emerald-950 disabled:opacity-50 ${FOCUS_RING}`}>
              Choisir un autre message
            </button>
          </>
        )}
      </div>
    </section>
  );
}
