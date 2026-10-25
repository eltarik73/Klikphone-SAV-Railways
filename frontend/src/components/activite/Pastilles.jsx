import { Monitor, Smartphone, Tablet, MonitorSmartphone, HelpCircle } from 'lucide-react';
import { familleAppareil, libelleAppareil, statutPresence, libellePresence } from '../../lib/activiteEquipe';

const ICONES = { ordinateur: Monitor, mobile: Smartphone, tablette: Tablet, inconnu: HelpCircle };

/** Icône d'appareil (décorative : le libellé complet est porté par le texte voisin ou `title`). */
export function IconeAppareil({ appareil, className = 'w-3.5 h-3.5' }) {
  const Icone = ICONES[familleAppareil(appareil?.type)] || HelpCircle;
  return <Icone className={`${className} shrink-0 text-slate-500`} aria-hidden="true" focusable="false" />;
}

/** Appareil(s) d'une journée en UNE icône : celle du type, ou « plusieurs appareils » (le détail
 * complet est dans `title` et dans le panneau du jour). */
export function IconesAppareils({ appareils }) {
  const liste = Array.isArray(appareils) ? appareils : [];
  if (!liste.length) return null;
  const familles = new Set(liste.map((a) => familleAppareil(a?.type)));
  const titre = liste.map(libelleAppareil).join(' / ');
  if (familles.size > 1) {
    return (
      <span title={titre} aria-hidden="true" className="inline-flex">
        <MonitorSmartphone className="w-3.5 h-3.5 shrink-0 text-slate-500" focusable="false" />
      </span>
    );
  }
  return <span title={titre} aria-hidden="true" className="inline-flex"><IconeAppareil appareil={liste[0]} /></span>;
}

/** Point de présence coloré ; rien quand aucun pointage n'a été fait. */
export function PointPresence({ statut, distance, className = 'w-2 h-2' }) {
  const s = statutPresence(statut);
  if (!s) return null;
  return (
    <span
      className={`inline-block rounded-full shrink-0 ${className} ${s.point}`}
      title={libellePresence(statut, distance)}
      aria-hidden="true"
    />
  );
}
