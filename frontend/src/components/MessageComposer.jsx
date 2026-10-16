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
import { MessageCircle, Send, Mail, Check } from 'lucide-react';

const TEMPLATE_ICONS = {
  1: '📱', 2: '🔍', 3: '📋', 4: '🔧', 5: '⏳',
  6: '✅', 7: '📦', 8: '❌', 9: '📅', 10: '✏️', 11: '⭐', 12: '🤝',
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
    <div role="group" aria-label="Modèles de message" className="grid grid-cols-2 gap-1.5 mb-3">
      {templates.map(tp => (
        <button
          key={tp.id}
          type="button"
          aria-pressed={selectedId === tp.id}
          onClick={() => {
            choixManuelRef.current = true;
            setChoixManuel(true);
            setSelectedId(tp.id === selectedId ? null : tp.id);
          }}
          className={`min-h-[44px] text-left px-2.5 py-2 rounded-lg text-xs font-medium transition-colors border focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
            selectedId === tp.id
              ? 'bg-brand-50 border-brand-300 text-brand-700 shadow-sm'
              : 'bg-white border-slate-150 text-slate-600 hover:bg-slate-50 hover:border-slate-200'
          }`}
        >
          <span className="mr-1" aria-hidden="true">{TEMPLATE_ICONS[tp.id] || '💬'}</span>
          {tp.label}
        </button>
      ))}
    </div>
  );

  const BOUTON = 'flex-1 min-h-[44px] flex items-center justify-center gap-1.5 px-2 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1';
  const apercu = selectedId ? (
    <div className="animate-in">
      {isCustom ? (
        <textarea
          value={customText}
          onChange={e => setCustomText(e.target.value)}
          placeholder="Tapez votre message..."
          aria-label="Message personnalisé"
          rows={3}
          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 mb-3"
        />
      ) : (
        <div className="p-3 bg-slate-50 rounded-lg text-sm text-slate-700 leading-relaxed mb-3 border border-slate-100 whitespace-pre-line break-words">
          {previewText}
        </div>
      )}

      {smsText && (
        <details className="mb-3 text-xs text-slate-600">
          <summary className="cursor-pointer select-none py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 rounded">
            Par SMS : version courte sans lien de suivi · <strong className="font-semibold text-slate-800">{smsInfo.segments} SMS</strong>
            {' '}({smsInfo.caracteres} caractères{smsInfo.unicode ? ', unicode : 70 par SMS' : ', 160 par SMS'})
          </summary>
          <p className="mt-1 p-2 bg-white rounded border border-slate-100 break-words">{smsText}</p>
        </details>
      )}

      {/* Send buttons */}
      <div className="flex gap-2">
        <button type="button" onClick={() => sendMessage('whatsapp')} disabled={!!sending}
          className={`${BOUTON} bg-green-700 hover:bg-green-800 text-white`}>
          {sending === 'whatsapp' ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />}
          WhatsApp
        </button>
        <button type="button" onClick={() => sendMessage('sms')} disabled={!!sending}
          className={`${BOUTON} bg-white hover:bg-slate-50 text-slate-700 border border-slate-200`}>
          {sending === 'sms' ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Send className="w-3.5 h-3.5" aria-hidden="true" />}
          SMS
        </button>
        <button type="button" onClick={() => sendMessage('email')} disabled={!!sending}
          className={`${BOUTON} bg-white hover:bg-slate-50 text-slate-700 border border-slate-200`}>
          {sending === 'email' ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Mail className="w-3.5 h-3.5" aria-hidden="true" />}
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
          <summary className="min-h-[44px] flex items-center cursor-pointer rounded text-xs font-semibold text-slate-700 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
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
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center" aria-hidden="true">
          <MessageCircle className="w-4 h-4 text-green-600" />
        </div>
        <h2 className="text-sm font-semibold text-slate-800">Messages</h2>
      </div>
      {grille}
      {apercu}
    </div>
  );
}
