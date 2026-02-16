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

export function formatPrix(p) {
  if (p === null || p === undefined) return '—';
  return `${Number(p).toFixed(2)} €`;
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

const STATUS_CONFIG = {
  'Pré-enregistré': {
    bg: 'bg-indigo-50', text: 'text-indigo-700', ring: 'ring-indigo-200/80',
    dot: 'bg-indigo-500', color: '#6366F1',
  },
  'En attente de diagnostic': {
    bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-200/80',
    dot: 'bg-amber-500', color: '#F59E0B',
  },
  'En attente de pièce': {
    bg: 'bg-violet-50', text: 'text-violet-700', ring: 'ring-violet-200/80',
    dot: 'bg-violet-500', color: '#8B5CF6',
  },
  'Pièce reçue': {
    bg: 'bg-cyan-50', text: 'text-cyan-700', ring: 'ring-cyan-200/80',
    dot: 'bg-cyan-500', color: '#06B6D4',
  },
  "En attente d'accord client": {
    bg: 'bg-orange-50', text: 'text-orange-700', ring: 'ring-orange-200/80',
    dot: 'bg-orange-500', color: '#F97316',
  },
  'En cours de réparation': {
    bg: 'bg-blue-50', text: 'text-blue-700', ring: 'ring-blue-200/80',
    dot: 'bg-blue-500', color: '#3B82F6',
  },
  'Réparation terminée': {
    bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200/80',
    dot: 'bg-emerald-500', color: '#10B981',
  },
  'Rendu au client': {
    bg: 'bg-gray-50', text: 'text-gray-600', ring: 'ring-gray-200/80',
    dot: 'bg-gray-500', color: '#6B7280',
  },
  'Clôturé': {
    bg: 'bg-slate-100', text: 'text-slate-600', ring: 'ring-slate-200/80',
    dot: 'bg-slate-800', color: '#1E293B',
  },
};

const DEFAULT_STATUS = {
  bg: 'bg-slate-100', text: 'text-slate-500', ring: 'ring-slate-200/80',
  dot: 'bg-slate-400', color: '#94A3B8',
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
