import { useState, useEffect } from 'react';
import api from '../lib/api';
import { useToast } from './Toast';
import { useAuth } from '../hooks/useAuth';
import { MessageCircle, Send, Mail, Check } from 'lucide-react';

const DEFAULT_TEMPLATES = [
  { id: 1, label: "Appareil recu", message: "Bonjour {prenom}, votre {appareil} a bien ete pris en charge sous le numero {code}. Nous vous tiendrons informe de l'avancement. Klikphone 04 79 60 89 22" },
  { id: 2, label: "Diagnostic en cours", message: "Bonjour {prenom}, le diagnostic de votre {appareil} est en cours. Nous reviendrons vers vous rapidement. Klikphone" },
  { id: 3, label: "Devis a valider", message: "Bonjour {prenom}, le devis pour votre {appareil} est de {montant} EUR. Merci de nous confirmer votre accord. Klikphone 04 79 60 89 22" },
  { id: 4, label: "En cours de reparation", message: "Bonjour {prenom}, la reparation de votre {appareil} est en cours. Klikphone" },
  { id: 5, label: "Attente piece", message: "Bonjour {prenom}, nous sommes en attente d'une piece pour votre {appareil}. Nous vous previendrons des reception. Klikphone" },
  { id: 6, label: "Appareil pret", message: "Bonjour {prenom}, votre {appareil} est pret ! Vous pouvez venir le recuperer a la boutique. Montant : {montant} EUR. Klikphone 79 Place Saint Leger, Chambery" },
  { id: 7, label: "Commande arrivee", message: "Bonjour {prenom}, la piece commandee pour votre {appareil} est arrivee. Nous lancons la reparation. Klikphone 04 79 60 89 22" },
  { id: 8, label: "Non reparable", message: "Bonjour {prenom}, malheureusement votre {appareil} n'est pas reparable. Vous pouvez passer recuperer votre appareil en boutique. Klikphone" },
  { id: 9, label: "Rappel RDV", message: "Bonjour {prenom}, nous vous rappelons votre rendez-vous demain pour votre {appareil}. Klikphone 79 Place Saint Leger, Chambery" },
  { id: 10, label: "Personnalise", message: "" },
];

const TEMPLATE_ICONS = {
  1: '📱', 2: '🔍', 3: '📋', 4: '🔧', 5: '⏳',
  6: '✅', 7: '📦', 8: '❌', 9: '📅', 10: '✏️',
};

export default function MessageComposer({ ticket, onMessageSent }) {
  const toast = useToast();
  const { user } = useAuth();
  const [templates, setTemplates] = useState(DEFAULT_TEMPLATES);
  const [selectedId, setSelectedId] = useState(null);
  const [customText, setCustomText] = useState('');
  const [sending, setSending] = useState(null);

  useEffect(() => {
    api.getMessageTemplates()
      .then(data => {
        if (data && data.length > 0) setTemplates(data);
      })
      .catch(() => {});
  }, []);

  const t = ticket;
  const appareil = t.modele_autre || `${t.marque || ''} ${t.modele || ''}`.trim() || 'appareil';
  const baseMontant = parseFloat(t.tarif_final) || parseFloat(t.devis_estime) || 0;
  const redPct = parseFloat(t.reduction_pourcentage) || 0;
  const redMnt = parseFloat(t.reduction_montant) || 0;
  const reduction = redPct > 0 ? baseMontant * (redPct / 100) : redMnt;
  const montant = Math.max(0, baseMontant - reduction);

  const replaceVars = (msg) => {
    return msg
      .replace(/\{prenom\}/g, t.client_prenom || '')
      .replace(/\{nom\}/g, t.client_nom || '')
      .replace(/\{appareil\}/g, appareil)
      .replace(/\{code\}/g, t.ticket_code || '')
      .replace(/\{montant\}/g, String(montant))
      .replace(/\{adresse\}/g, '79 Place Saint Leger, 73000 Chambery')
      .replace(/\{horaires\}/g, 'Lundi-Samedi 10h-19h')
      .replace(/\{tel_boutique\}/g, '04 79 60 89 22');
  };

  const selected = templates.find(tp => tp.id === selectedId);
  const isCustom = selectedId === 10;
  const previewText = isCustom ? customText : (selected ? replaceVars(selected.message) : '');

  const sendWhatsApp = (telephone, message) => {
    let tel = telephone.replace(/[\s\-\.]/g, '');
    if (tel.startsWith('0')) tel = '33' + tel.substring(1);
    if (!tel.startsWith('+') && !tel.startsWith('33')) tel = '33' + tel;
    tel = tel.replace('+', '');
    window.open(`https://wa.me/${tel}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const sendSMS = (telephone, message) => {
    window.open(`sms:${telephone}?body=${encodeURIComponent(message)}`, '_blank');
  };

  const sendMessage = async (canal) => {
    if (!previewText.trim()) {
      toast.error('Message vide');
      return;
    }
    setSending(canal);
    try {
      const tel = t.client_tel;
      const email = t.client_email;

      if (canal === 'whatsapp') {
        if (!tel) { toast.error('Pas de telephone'); return; }
        sendWhatsApp(tel, previewText);
      } else if (canal === 'sms') {
        if (!tel) { toast.error('Pas de telephone'); return; }
        sendSMS(tel, previewText);
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
      const label = selected ? selected.label : 'Message';
      const logText = `[${label}] ${previewText.substring(0, 120)}${previewText.length > 120 ? '...' : ''}`;
      await api.logMessage(t.id, auteur, logText, canal);

      toast.success(canal === 'email' ? 'Email envoyé avec succès' : `Message ${canal} envoyé`);
      if (onMessageSent) onMessageSent();
    } catch (err) {
      toast.error(err.message || 'Erreur envoi');
      console.error(err);
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
          <MessageCircle className="w-4 h-4 text-green-600" />
        </div>
        <h2 className="text-sm font-semibold text-slate-800">Messages</h2>
      </div>

      {/* Template grid */}
      <div className="grid grid-cols-2 gap-1.5 mb-3">
        {templates.map(tp => (
          <button
            key={tp.id}
            onClick={() => setSelectedId(tp.id === selectedId ? null : tp.id)}
            className={`text-left px-2.5 py-2 rounded-lg text-xs font-medium transition-all border ${
              selectedId === tp.id
                ? 'bg-brand-50 border-brand-300 text-brand-700 shadow-sm'
                : 'bg-white border-slate-150 text-slate-600 hover:bg-slate-50 hover:border-slate-200'
            }`}
          >
            <span className="mr-1">{TEMPLATE_ICONS[tp.id] || '💬'}</span>
            {tp.label}
          </button>
        ))}
      </div>

      {/* Preview */}
      {selectedId && (
        <div className="animate-in">
          {isCustom ? (
            <textarea
              value={customText}
              onChange={e => setCustomText(e.target.value)}
              placeholder="Tapez votre message..."
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 mb-3"
            />
          ) : (
            <div className="p-3 bg-slate-50 rounded-lg text-sm text-slate-700 leading-relaxed mb-3 border border-slate-100">
              {previewText}
            </div>
          )}

          {/* Send buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => sendMessage('whatsapp')}
              disabled={!!sending}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-green-500 hover:bg-green-600 text-white text-xs font-bold transition-colors disabled:opacity-50"
            >
              {sending === 'whatsapp' ? <Check className="w-3.5 h-3.5" /> : <MessageCircle className="w-3.5 h-3.5" />}
              WhatsApp
            </button>
            <button
              onClick={() => sendMessage('sms')}
              disabled={!!sending}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-white hover:bg-slate-50 text-slate-600 text-xs font-bold border border-slate-200 transition-colors disabled:opacity-50"
            >
              {sending === 'sms' ? <Check className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
              SMS
            </button>
            <button
              onClick={() => sendMessage('email')}
              disabled={!!sending}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-white hover:bg-slate-50 text-slate-600 text-xs font-bold border border-slate-200 transition-colors disabled:opacity-50"
            >
              {sending === 'email' ? <Check className="w-3.5 h-3.5" /> : <Mail className="w-3.5 h-3.5" />}
              Email
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
