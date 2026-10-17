import { useState, useEffect, useRef } from 'react';
import api from '../lib/api';
import { envoyerSms, messageSmsEnvoye, versionCourteSms, smsSegments } from '../lib/sms';
import { useSmsServeur } from '../hooks/useSmsServeur';
import { useToast } from './Toast';
import { useAuth } from '../hooks/useAuth';
import {
  modelePourStatut, DEFAULT_TEMPLATES, LIEN_AVIS_DEFAUT, contexteMessage, remplirModele, ajouterLienSuivi, ligneJournal,
  lienWhatsApp,
} from '../lib/messages';
import {
  MessageCircle, Send, Mail, Check,
  Smartphone, Search, FileText, Wrench, Hourglass, CheckCircle2, Package, XCircle, CalendarClock, PenLine, Star, Handshake,
} from 'lucide-react';

// Icône lucide par modèle (design V2 : plus d'emoji système, le libellé du bouton est inchangé)
const TEMPLATE_ICONS = {
  1: Smartphone, 2: Search, 3: FileText, 4: Wrench, 5: Hourglass,
  6: CheckCircle2, 7: Package, 8: XCircle, 9: CalendarClock, 10: PenLine, 11: Star, 12: Handshake,
};

/**
 * Messages au client (WhatsApp / SMS ouverts pré-remplis, email envoyé par le serveur).
 * statutPropose : modèle pré-sélectionné après un changement de statut (lib/messages) ;
 * integre : sans cadre ni titre, dans une modale ou le scan comptoir.
 */
export default function MessageComposer({ ticket, onMessageSent, statutPropose = null, integre = false }) {
  const toast = useToast();
  const { user } = useAuth();
  const { actif: smsServeur } = useSmsServeur();
  const [templates, setTemplates] = useState(DEFAULT_TEMPLATES);
  const [selectedId, setSelectedId] = useState(() => modelePourStatut(DEFAULT_TEMPLATES, statutPropose));
  const [customText, setCustomText] = useState('');
  const [sending, setSending] = useState(null);
  const [googleReviewLink, setGoogleReviewLink] = useState(LIEN_AVIS_DEFAUT);
  // Modèle choisi à la main : les modèles de la boutique, arrivés après, ne le remplacent pas
  const choixManuelRef = useRef(false);
  const [choixManuel, setChoixManuel] = useState(false);
  const statutProposeRef = useRef(statutPropose);

  useEffect(() => {
    api.getMessageTemplates()
      .then(data => {
        if (!data || data.length === 0) return;
        setTemplates(data);
        if (statutProposeRef.current && !choixManuelRef.current) {
          setSelectedId(modelePourStatut(data, statutProposeRef.current));
        }
      })
      .catch(() => {});
    // Même lecture en cache que la fiche et le scan comptoir (5 min)
    api.getCached('/api/config', 5 * 60_000)
      .then(cfg => {
        const map = {};
        (Array.isArray(cfg) ? cfg : []).forEach(p => { map[p.cle] = p.valeur; });
        if (map.GOOGLE_REVIEW_LINK) setGoogleReviewLink(map.GOOGLE_REVIEW_LINK);
      })
      .catch(() => {});
  }, []);

  const t = ticket;
  // Variables et montants partagés avec le scan comptoir (lib/messages)
  const { vars, totalTicket, suiviUrl } = contexteMessage(t, { lienAvis: googleReviewLink });
  const replaceVars = (msg) => remplirModele(msg, vars);
  const appendSuiviLink = (msg) => ajouterLienSuivi(msg, t, suiviUrl);

  const selected = templates.find(tp => tp.id === selectedId);
  const isCustom = selectedId === 10;
  const isAvisTemplate = selectedId === 11;
  const rawText = isCustom ? customText : (selected ? replaceVars(selected.message) : '');
  const previewText = isAvisTemplate ? rawText : appendSuiviLink(rawText);
  const smsText = versionCourteSms(rawText);
  const smsInfo = smsSegments(smsText);

  // Normalisation du numéro partagée avec la carte « Prévenir le client » (lib/messages)
  const sendWhatsApp = (telephone, message) => {
    window.open(lienWhatsApp(telephone, message), '_blank');
  };

  // Check if the selected template uses {montant}
  const templateUsesMontant = selected && !isCustom && selected.message.includes('{montant}');

  const sendMessage = async (canal) => {
    if (!previewText.trim()) {
      toast.error('Message vide');
      return;
    }
    if (templateUsesMontant && totalTicket <= 0 && !t.paye) {
      toast.error('Renseigne un tarif avant d\'envoyer');
      return;
    }
    setSending(canal);
    const label = selected ? selected.label : 'Message';
    try {
      const tel = t.client_tel;
      const email = t.client_email;
      // SMS parti par le serveur (Brevo) : il a déjà noté l'envoi sur le ticket (pas de logMessage)
      let smsServeurEnvoye = null;

      if (canal === 'whatsapp') {
        if (!tel) { toast.error('Pas de telephone'); return; }
        sendWhatsApp(tel, previewText);
      } else if (canal === 'sms') {
        if (!tel) { toast.error('Pas de telephone'); return; }
        if (!smsText) { toast.error('Message vide'); return; }
        const res = await envoyerSms({ serveur: smsServeur, ticketId: t.id, tel, message: smsText, libelle: label });
        if (res.mode === 'serveur') smsServeurEnvoye = res;
      } else if (canal === 'email') {
        if (!email) { toast.error("Ce client n'a pas d'adresse email"); return; }
        const res = await api.envoyerEmail(email, `Klikphone SAV - ${t.ticket_code}`, previewText);
        if (res.status !== 'ok') {
          toast.error(res.message || "Erreur d'envoi email");
          return;
        }
      }

      // Log to DB
      const auteur = user?.utilisateur || 'Accueil';
      const logText = ligneJournal(label, previewText);
      if (isAvisTemplate) {
        await api.addPrivateNote(t.id, auteur, `[Demande avis Google] Envoyé par ${canal}`);
      }
      if (smsServeurEnvoye) {
        toast.success(messageSmsEnvoye(smsServeurEnvoye));
      } else {
        await api.logMessage(t.id, auteur, logText, canal);
        toast.success(canal === 'email' ? 'Email envoyé avec succès' : `Message ${canal} envoyé`);
      }
      if (onMessageSent) onMessageSent();
    } catch (err) {
      toast.error(err.message || 'Erreur envoi');
      // Refus de Brevo : l'échec est noté sur le ticket, on rafraîchit les notes
      if (err?.status === 424 && onMessageSent) onMessageSent({ echec: true });
      console.error(err);
    } finally {
      setSending(null);
    }
  };

  const grille = (
    <div role="group" aria-label="Modèles de message" className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
      {templates.map(tp => {
        const Icone = TEMPLATE_ICONS[tp.id] || MessageCircle;
        const choisi = selectedId === tp.id;
        return (
          <button
            key={tp.id}
            type="button"
            aria-pressed={choisi}
            onClick={() => {
              choixManuelRef.current = true;
              setChoixManuel(true);
              setSelectedId(tp.id === selectedId ? null : tp.id);
            }}
            className={`btn-secondary min-h-11 justify-start text-left whitespace-normal font-medium ${
              choisi ? 'bg-brand-50 border-brand-300 text-brand-700 hover:bg-brand-50 hover:border-brand-300' : ''
            }`}
          >
            <Icone className={choisi ? 'text-brand-600' : 'text-slate-500'} aria-hidden="true" />
            {tp.label}
          </button>
        );
      })}
    </div>
  );

  const apercu = selectedId ? (
    <div className="animate-in">
      {isCustom ? (
        <textarea
          value={customText}
          onChange={e => setCustomText(e.target.value)}
          placeholder="Tapez votre message..."
          aria-label="Message personnalisé"
          rows={3}
          className="textarea resize-none mb-3"
        />
      ) : (
        <div className="card-section text-sm text-slate-700 leading-relaxed mb-3 whitespace-pre-line break-words">
          {previewText}
        </div>
      )}

      {smsText && (
        <details className="mb-3 text-xs text-slate-600">
          <summary className="cursor-pointer select-none min-h-11 flex items-center rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
            <span>
              Par SMS : version courte sans lien de suivi · <strong className="font-semibold text-slate-800">{smsInfo.segments} SMS</strong>
              {' '}({smsInfo.caracteres} caractères{smsInfo.unicode ? ', unicode : 70 par SMS' : ', 160 par SMS'})
            </span>
          </summary>
          <p className="mt-1 p-3 bg-white rounded-lg border border-slate-200 break-words">{smsText}</p>
        </details>
      )}

      {/* Send buttons : WhatsApp (vert reconnaissable), SMS (primaire), Email (secondaire) */}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => sendMessage('whatsapp')} disabled={!!sending} aria-busy={sending === 'whatsapp' || undefined}
          className="btn-whatsapp flex-1 min-h-11">
          {sending === 'whatsapp' ? <Check aria-hidden="true" /> : <MessageCircle aria-hidden="true" />}
          WhatsApp
        </button>
        <button type="button" onClick={() => sendMessage('sms')} disabled={!!sending} aria-busy={sending === 'sms' || undefined}
          className="btn-primary flex-1 min-h-11">
          {sending === 'sms' ? <Check aria-hidden="true" /> : <Send aria-hidden="true" />}
          SMS
        </button>
        <button type="button" onClick={() => sendMessage('email')} disabled={!!sending} aria-busy={sending === 'email' || undefined}
          className="btn-secondary flex-1 min-h-11">
          {sending === 'email' ? <Check aria-hidden="true" /> : <Mail aria-hidden="true" />}
          Email
        </button>
      </div>
    </div>
  ) : null;

  // Proposition (modale, scan comptoir) : le message pré-rempli d'abord, les autres modèles repliés
  if (integre) {
    return apercu && !choixManuel ? (
      <div>
        {apercu}
        <details className="mt-3">
          <summary className="min-h-[44px] flex items-center cursor-pointer rounded text-sm font-semibold text-slate-700 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
            Choisir un autre modèle
          </summary>
          <div className="mt-2">{grille}</div>
        </details>
      </div>
    ) : (
      <div>
        {grille}
        {apercu}
      </div>
    );
  }

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="kp-messages-titre">
      <div className="flex items-center gap-2 mb-4">
        <MessageCircle className="w-4 h-4 text-slate-400" aria-hidden="true" />
        <h2 id="kp-messages-titre" className="t-h2">Messages</h2>
      </div>
      {grille}
      {apercu}
    </section>
  );
}
