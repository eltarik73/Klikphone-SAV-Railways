import { clsx } from 'clsx';

export function cn(...classes) {
  return clsx(...classes);
}

export function formatDate(d) {
  if (!d) return '—';
  try {
    const date = new Date(d);
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
    const date = new Date(d);
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return d;
  }
}

export function formatPrix(p) {
  if (p === null || p === undefined) return '—';
  return `${Number(p).toFixed(2)} \u20AC`;
}

export const STATUTS = [
  'En attente de diagnostic',
  'En attente de pi\u00E8ce',
  'Pi\u00E8ce re\u00E7ue',
  "En attente d'accord client",
  'En cours de r\u00E9paration',
  'R\u00E9paration termin\u00E9e',
  'Rendu au client',
  'Cl\u00F4tur\u00E9',
];

const STATUS_CONFIG = {
  'En attente de diagnostic': {
    bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-200/80',
    dot: 'bg-amber-500', icon: '\uD83D\uDD0D',
  },
  'En attente de pi\u00E8ce': {
    bg: 'bg-violet-50', text: 'text-violet-700', ring: 'ring-violet-200/80',
    dot: 'bg-violet-500', icon: '\uD83D\uDCE6',
  },
  'Pi\u00E8ce re\u00E7ue': {
    bg: 'bg-blue-50', text: 'text-blue-700', ring: 'ring-blue-200/80',
    dot: 'bg-blue-500', icon: '\uD83D\uDCEC',
  },
  "En attente d'accord client": {
    bg: 'bg-pink-50', text: 'text-pink-700', ring: 'ring-pink-200/80',
    dot: 'bg-pink-500', icon: '\u23F3',
  },
  'En cours de r\u00E9paration': {
    bg: 'bg-sky-50', text: 'text-sky-700', ring: 'ring-sky-200/80',
    dot: 'bg-sky-500', icon: '\uD83D\uDD27',
  },
  'R\u00E9paration termin\u00E9e': {
    bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200/80',
    dot: 'bg-emerald-500', icon: '\u2705',
  },
  'Rendu au client': {
    bg: 'bg-cyan-50', text: 'text-cyan-700', ring: 'ring-cyan-200/80',
    dot: 'bg-cyan-500', icon: '\uD83E\uDD1D',
  },
  'Cl\u00F4tur\u00E9': {
    bg: 'bg-slate-100', text: 'text-slate-500', ring: 'ring-slate-200/80',
    dot: 'bg-slate-400', icon: '\uD83D\uDCC1',
  },
};

const DEFAULT_STATUS = {
  bg: 'bg-slate-100', text: 'text-slate-500', ring: 'ring-slate-200/80',
  dot: 'bg-slate-400', icon: '\uD83D\uDCCB',
};

export function getStatusConfig(statut) {
  return STATUS_CONFIG[statut] || DEFAULT_STATUS;
}

export function getStatusStyle(statut) {
  const c = getStatusConfig(statut);
  return `${c.bg} ${c.text} ring-1 ${c.ring}`;
}

export function getStatusIcon(statut) {
  return getStatusConfig(statut).icon;
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
