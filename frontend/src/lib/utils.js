import { clsx } from 'clsx';

export function cn(...classes) {
  return clsx(...classes);
}

// Parse backend datetime (naive UTC) → ensure UTC interpretation
function parseUTC(d) {
  if (!d) return null;
  const s = String(d);
  // Already has timezone info → parse as-is
  if (s.endsWith('Z') || s.includes('+')) return new Date(s);
  // Naive datetime from backend (UTC) → append Z
  return new Date(s + 'Z');
}

export function formatDate(d) {
  if (!d) return '—';
  try {
    const date = parseUTC(d);
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return d;
  }
}

export function formatDateShort(d) {
  if (!d) return '—';
  try {
    const date = parseUTC(d);
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return d;
  }
}

/**
 * Date de réception (dépôt) lisible d'un coup d'œil :
 * { jour: '17/10', heure: '14:32', relatif: "aujourd'hui" | 'hier' | 'il y a 3 j', complet } ou null.
 */
export function infoReception(d, maintenant = new Date()) {
  const date = parseUTC(d);
  if (!date || Number.isNaN(date.getTime())) return null;
  const jour = date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const heure = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const minuit = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const jours = Math.round((minuit(maintenant) - minuit(date)) / 86400000);
  const relatif = jours <= 0 ? "aujourd'hui" : jours === 1 ? 'hier' : `il y a ${jours} j`;
  const complet = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return { jour, heure, relatif, complet: `${complet} à ${heure}` };
}

export function formatPrix(p) {
  if (p === null || p === undefined) return '—';
  const n = Number(p);
  if (!isFinite(n)) return '—';
  return `${n.toFixed(2)} €`;
}

export const STATUTS = [
  'Pré-enregistré',
  'En attente de diagnostic',
  'En attente de pièce',
  'Pièce reçue',
  "En attente d'accord client",
  'En cours de réparation',
  'Réparation terminée',
  'Rendu au client',
  'Clôturé',
];

// Statuts en 4 teintes sémantiques (design épuré, décision 6) : la couleur dit QUI doit agir.
// neutre = à nous pas commencé / au fournisseur / fini ; bleu = à nous, en main ; ambre = au client ;
// émeraude = prêt à rendre. Jamais de rouge (réservé au retard, au refus, à l'impayé, aux erreurs).
// Clés : bg / text / ring = badge plein (en-tête de fiche) ; dot = pastille des listes (le consommateur
// pose `w-2 h-2 rounded-full`, un cercle vide est donc `bg-transparent border-2 …`) ; color = hex des
// graphiques ; icon = nom lucide-react ; groupe = onglets groupés (attente | en_cours | accord | pret |
// rendu | clos).
const STATUS_CONFIG = {
  'Pré-enregistré': {
    bg: 'bg-white', text: 'text-slate-700', ring: 'ring-slate-300/80',
    dot: 'bg-transparent border-2 border-dashed border-slate-400', color: '#94A3B8',
    icon: 'Globe', groupe: 'attente',
  },
  'En attente de diagnostic': {
    bg: 'bg-white', text: 'text-slate-700', ring: 'ring-slate-300/80',
    dot: 'bg-transparent border-2 border-slate-400', color: '#94A3B8',
    icon: 'CircleDashed', groupe: 'attente',
  },
  'En attente de pièce': {
    bg: 'bg-slate-100', text: 'text-slate-700', ring: 'ring-slate-200/80',
    dot: 'bg-slate-500', color: '#64748B',
    icon: 'Package', groupe: 'attente',
  },
  'Pièce reçue': {
    bg: 'bg-blue-50', text: 'text-blue-700', ring: 'ring-blue-200/80',
    dot: 'bg-blue-600', color: '#60A5FA',
    icon: 'PackageCheck', groupe: 'en_cours',
  },
  "En attente d'accord client": {
    bg: 'bg-amber-50', text: 'text-amber-800', ring: 'ring-amber-200/80',
    dot: 'bg-amber-600', color: '#D97706',
    icon: 'MessageSquareMore', groupe: 'accord',
  },
  'En cours de réparation': {
    bg: 'bg-blue-50', text: 'text-blue-700', ring: 'ring-blue-200/80',
    dot: 'bg-blue-600', color: '#2563EB',
    icon: 'Wrench', groupe: 'en_cours',
  },
  'Réparation terminée': {
    bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200/80',
    dot: 'bg-emerald-600', color: '#059669',
    icon: 'CircleCheck', groupe: 'pret',
  },
  'Rendu au client': {
    bg: 'bg-slate-100', text: 'text-slate-700', ring: 'ring-slate-200/80',
    dot: 'bg-slate-700', color: '#334155',
    icon: 'CheckCheck', groupe: 'rendu',
  },
  'Clôturé': {
    bg: 'bg-white', text: 'text-slate-500', ring: 'ring-slate-200/80',
    dot: 'bg-slate-300', color: '#CBD5E1',
    icon: 'Archive', groupe: 'clos',
  },
};

// Statut inconnu : neutre, jamais une couleur qui ressemble à un état réel.
const DEFAULT_STATUS = {
  bg: 'bg-slate-100', text: 'text-slate-600', ring: 'ring-slate-200/80',
  dot: 'bg-slate-400', color: '#94A3B8',
  icon: 'Circle', groupe: 'attente',
};

export function getStatusConfig(statut) {
  return STATUS_CONFIG[statut] || DEFAULT_STATUS;
}

export function getStatusStyle(statut) {
  const c = getStatusConfig(statut);
  return `${c.bg} ${c.text} ring-1 ${c.ring}`;
}

export function waLink(tel, msg) {
  let t = tel.replace(/\D/g, '');
  if (t.startsWith('0')) t = '33' + t.slice(1);
  return `https://wa.me/${t}?text=${encodeURIComponent(msg)}`;
}

export function smsLink(tel, msg) {
  const t = tel.replace(/\D/g, '');
  return `sms:${t}?body=${encodeURIComponent(msg)}`;
}

export const MESSAGE_TEMPLATES = [
  { key: 'appareil_recu', label: 'Appareil reçu' },
  { key: 'diagnostic_en_cours', label: 'Diagnostic en cours' },
  { key: 'devis_a_valider', label: 'Devis à valider' },
  { key: 'en_cours_reparation', label: 'En cours de réparation' },
  { key: 'attente_piece', label: 'Attente de pièce' },
  { key: 'appareil_pret', label: 'Appareil prêt' },
  { key: 'relance', label: 'Relance récupération' },
  { key: 'non_reparable', label: 'Non réparable' },
  { key: 'rappel_rdv', label: 'Rappel RDV' },
  { key: 'personnalise', label: 'Personnalisé' },
];
