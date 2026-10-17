import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  BellRing, Send, Mail, MessageCircle, CircleCheckBig, AlertTriangle, Info, Loader2, ArrowLeft,
} from 'lucide-react';
import api from '../lib/api';
import { envoyerSms, messageSmsEnvoye } from '../lib/sms';
import {
  DEFAULT_TEMPLATES, LIEN_AVIS_DEFAUT, CANAUX_MESSAGE, messagePret, modelePret, ligneJournal, lienWhatsApp,
  numeroSms, emailValide, canalPrevenir, dernierAvisPret, texteDejaPrevenu, texteEchecSms, erreurEnvoi,
  MENTION_MONTANT_RETIRE,
} from '../lib/messages';
import { telJoignable, avecTelJoignable, estAutreNumero, libelleJoignable } from '../lib/contact';
import { useToast } from './Toast';

// Grille de tous les modèles (« Choisir un autre message ») : chargée à la demande
const MessageComposer = lazy(() => import('./MessageComposer'));

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

// Icône teintée par canal sur les boutons secondaires ; le canal recommandé est le seul bouton plein
const CANAUX = [
  { id: 'sms', label: 'SMS', Icon: Send, teinte: 'text-blue-700' },
  { id: 'email', label: 'E-mail', Icon: Mail, teinte: 'text-slate-600' },
  { id: 'whatsapp', label: 'WhatsApp', Icon: MessageCircle, teinte: 'text-emerald-700' },
];

const TONS = {
  ok: { cls: 'text-emerald-800', icone: 'text-emerald-700', Icon: CircleCheckBig },
  warn: { cls: 'text-amber-900', icone: 'text-amber-700', Icon: AlertTriangle },
  info: { cls: 'text-slate-800', icone: 'text-slate-500', Icon: Info },
  neutre: { cls: 'text-slate-700', icone: 'text-slate-500', Icon: Info },
};

/**
 * Carte « Prévenir le client » du scan comptoir (ticket « Réparation terminée ») : aperçu du
 * message « appareil prêt » (version SMS courte), envoi par SMS / e-mail / WhatsApp, rappel de
 * ce qui a déjà été envoyé (notes du ticket) et confirmation avant un renvoi.
 *
 * auto : issue de « Terminé + prévenir le client » ({ etat: 'envoi' | 'envoye' | 'manuel' |
 * 'echec' | 'impossible', canal, incertain?, message }). ouverte / onOuvrir / onReplier : carte
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

  // Second numéro du ticket (« pour vous joindre si différent ») avant celui de la fiche
  const tel = telJoignable(t);
  const email = String(t.client_email ?? '').trim();
  const numero = numeroSms(tel);
  const aEmail = emailValide(email);
  const canal = canalPrevenir(avecTelJoignable(t));
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
  const recommande = smsRefuse && possible.email ? 'email' : canal;
  const apercuSms = recommande === 'sms';
  const raisons = [];
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
  // Montant à 0 € (tarif oublié ?) : la phrase du montant n'est pas dans le message, l'envoi reste possible
  if (msg.montantRetire) lignes.push({ id: 'montant', ton: 'neutre', texte: MENTION_MONTANT_RETIRE });

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
    <section aria-labelledby={titreId} className="card p-4" data-carte-prevenir="">
      <div className="flex items-start justify-between gap-3">
        <h3 id={titreId} ref={titreRef} tabIndex={-1}
          className="flex min-h-[40px] items-center gap-2 rounded t-h2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
          <BellRing className="h-5 w-5 shrink-0 text-brand-600" aria-hidden="true" />
          Prévenir {prenom || 'le client'}
        </h3>
        <button type="button" aria-expanded={ouverte} aria-controls={corpsId}
          onClick={ouverte ? onReplier : onOuvrir}
          className="btn-secondary btn-sm shrink-0">
          {libelleBascule}
        </button>
      </div>

      <div role="status" aria-live="polite">
        <ul className="mt-1 space-y-1">
          {lignes.map((l) => {
            const { cls, icone, Icon } = TONS[l.ton];
            return (
              <li key={l.id} className={`flex items-start gap-2 text-sm font-medium ${cls}`}>
                {l.spin
                  ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none text-slate-500" aria-hidden="true" />
                  : <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${icone}`} aria-hidden="true" />}
                <span className="min-w-0 break-words">{l.texte}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div id={corpsId} hidden={!ouverte} className="mt-3">
        {composer ? (
          <div className="card-section p-3">
            <button type="button" onClick={() => setComposer(false)} className="btn-ghost btn-sm mb-2 -ml-2 text-brand-700 hover:text-brand-800">
              <ArrowLeft aria-hidden="true" /> Message « appareil prêt »
            </button>
            <Suspense fallback={<p className="text-sm text-slate-700">Chargement des modèles…</p>}>
              <MessageComposer ticket={t} integre
                onMessageSent={(r) => { onNotesChange?.(); if (!r?.echec) setComposer(false); }} />
            </Suspense>
          </div>
        ) : (
          <>
            <div className="card-section p-3">
              <p className="t-h3">
                {apercuSms ? (
                  <>
                    Texte du SMS · <span className="text-slate-900">{msg.segments.segments} SMS</span>
                    <span className="font-normal">
                      {' '}({msg.segments.caracteres} caractères{msg.segments.unicode ? ', unicode : 70 par SMS' : ''})
                    </span>
                  </>
                ) : recommande === 'email' ? 'Texte de l’e-mail' : 'Texte du message'}
              </p>
              <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-slate-800">
                {apercuSms ? msg.sms : msg.texte}
              </p>
              {estAutreNumero(t) && (
                <p className="mt-1.5 text-xs font-medium text-amber-900">
                  SMS et WhatsApp au {libelleJoignable(t)}, pas à l’appareil déposé.
                </p>
              )}
              {apercuSms && (
                <p className="mt-1.5 t-caption">E-mail et WhatsApp : texte complet, avec le lien de suivi.</p>
              )}
            </div>

            {/* Canal recommandé = seul bouton plein (vert : le client est prévenu, l'appareil part) */}
            <div role="group" aria-label="Envoyer le message" aria-busy={occupe} className="mt-3 grid grid-cols-3 gap-2">
              {CANAUX.map(({ id, label, Icon, teinte }) => {
                const bloque = !possible[id];
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
                    className={`btn-lg px-2 ${
                      enAvant
                        ? 'btn bg-emerald-700 text-white shadow-xs hover:bg-emerald-800 disabled:border disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none disabled:hover:bg-slate-100'
                        : 'btn-secondary'
                    }`}>
                    {sending === id
                      ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      : <Icon className={enAvant ? '' : teinte} aria-hidden="true" />}
                    {label}
                  </button>
                );
              })}
            </div>

            {raisons.length > 0 && (
              <ul id={raisonsId} className="mt-2 space-y-0.5 text-xs font-medium text-slate-600">
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
                className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p id={confirmId} className="text-sm font-semibold text-amber-900">{texteConfirmation()}</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button ref={nonRef} type="button" onClick={annulerConfirmation} className="btn-secondary">
                    Non, ne pas renvoyer
                  </button>
                  <button type="button" onClick={() => envoyer(confirmer)} disabled={occupe} className="btn-primary">
                    Oui, renvoyer
                  </button>
                </div>
              </div>
            )}

            <button type="button" onClick={() => { setConfirmer(null); setComposer(true); }} disabled={occupe}
              className="btn-ghost btn-sm mt-2 -ml-2 text-brand-700 underline underline-offset-2 hover:text-brand-800">
              Choisir un autre message
            </button>
          </>
        )}
      </div>
    </section>
  );
}
