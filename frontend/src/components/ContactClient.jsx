import { useEffect, useRef, useState } from 'react';
import { Loader2, Mail, MessageCircle, MessageSquare, Phone, PhoneCall } from 'lucide-react';
import api from '../lib/api';
import { useToast } from './Toast';
import {
  CANAUX_CONTACT, appliquerContact, libelleContact, normaliserContact, titreCanal,
} from '../lib/contact';

/**
 * « Client contacté » — une seule ligne discrète, la même partout (scan, dashboard, étagère, fiche) :
 * 4 icônes 16 px (SMS, e-mail, WhatsApp, appel) allumées quand un contact est parti par ce canal
 * depuis le dernier changement de statut (ticket.contact, calculé par le serveur), le dernier contact
 * en clair, et « Contacté par tél. » qui note l'appel (POST /api/tickets/{id}/contact).
 *
 * props : ticket (avec contact), onContacte(contact) facultatif, taille 'ligne' | 'carte', auteur
 * (nom affiché si le serveur ne renvoie pas le contact), className.
 */

const ICONES = { sms: MessageSquare, email: Mail, whatsapp: MessageCircle, appel: Phone };

/**
 * Les 4 icônes seules (lecture). Info-bulle sur chacune ; seules les icônes allumées sont lues (le
 * texte visible dit déjà « Pas encore contacté »). `decoratif` : ni info-bulle ni texte lu (dans un
 * bouton dont le libellé visible dit déjà l'essentiel, comme la file atelier).
 */
export function IconesContact({ contact, decoratif = false, className = '' }) {
  const c = normaliserContact(contact);
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} aria-hidden={decoratif ? 'true' : undefined}>
      {CANAUX_CONTACT.map((canal) => {
        const Icone = ICONES[canal];
        const allume = !!c.canaux[canal];
        const titre = decoratif ? undefined : titreCanal(c, canal);
        return (
          <span key={canal} className="inline-flex h-5 w-5 items-center justify-center" title={titre}>
            <Icone className={`h-4 w-4 ${allume ? 'text-emerald-600' : 'text-slate-300'}`} aria-hidden="true" />
            {titre && allume && <span className="sr-only">{titre}</span>}
          </span>
        );
      })}
    </span>
  );
}

export default function ContactClient({ ticket, onContacte, taille = 'ligne', auteur = null, className = '' }) {
  const toast = useToast();
  // Contact noté ici, le temps que le parent (s'il écoute onContacte) renvoie le ticket mis à jour
  const [local, setLocal] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const [annonce, setAnnonce] = useState('');
  // Garde « composant encore monté » pour ne pas prévenir après un démontage pendant l'appel réseau.
  // Remis à vrai à CHAQUE montage : en dev, <React.StrictMode> (main.jsx) monte, nettoie puis remonte
  // les effets — un simple nettoyage laisserait le garde à faux et l'appel noté ne s'afficherait jamais.
  const vivant = useRef(true);
  useEffect(() => {
    vivant.current = true;
    return () => { vivant.current = false; };
  }, []);
  useEffect(() => { setLocal(null); }, [ticket?.id, ticket?.contact]);

  const contact = normaliserContact(local ?? ticket?.contact);
  const carte = taille === 'carte';

  async function noterAppel() {
    if (envoi || !ticket?.id) return;
    setEnvoi(true);
    try {
      const res = await api.contacterClient(ticket.id);
      const maj = res?.contact ? normaliserContact(res.contact) : appliquerContact(contact, 'appel', undefined, auteur);
      if (!vivant.current) return;
      setLocal(maj);
      setAnnonce('Appel noté');
      toast.success('Appel noté');
      onContacte?.(maj);
    } catch (err) {
      if (vivant.current) toast.error(err?.message || 'Appel non noté');
    } finally {
      if (vivant.current) setEnvoi(false);
    }
  }

  const libelle = libelleContact(contact);
  // 44 px au doigt dans les deux tailles (scan, étagère, fiche) : le composant s'en charge, pas ses hôtes
  const bouton = (
    <button type="button" onClick={noterAppel} disabled={envoi} aria-busy={envoi}
      className={carte ? 'btn-secondary min-h-11 shrink-0' : 'btn-ghost btn-sm min-h-11 shrink-0 text-brand-700 hover:bg-brand-50'}>
      {envoi
        ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
        : <PhoneCall aria-hidden="true" />}
      Contacté par tél.
    </button>
  );

  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${carte ? 'rounded-lg border border-slate-200 bg-white px-3 py-2' : ''} ${className}`}>
      <IconesContact contact={contact} />
      {/* Largeur naturelle : quand la place manque, c'est le bouton qui passe à la ligne, pas le texte */}
      <span className={`min-w-0 ${carte ? 'text-sm font-medium text-slate-800' : 't-small'} ${contact.dernier ? '' : 'text-slate-500'}`}>
        {libelle}
      </span>
      {bouton}
      <span role="status" aria-live="polite" className="sr-only">{annonce}</span>
    </div>
  );
}
