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
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  } catch {
    return d;
  }
}

export function formatPrix(p) {
  if (p === null || p === undefined) return '—';
  return `${Number(p).toFixed(2)} €`;
}

export const STATUTS = [
  'En attente de diagnostic',
  'En attente de pièce',
  'Pièce reçue',
  "En attente d'accord client",
  'En cours de réparation',
  'Réparation terminée',
  'Rendu au client',
  'Clôturé',
];

export function getStatusStyle(statut) {
  const map = {
    'En attente de diagnostic': 'badge-warning',
    'En attente de pièce': 'badge-info',
    'Pièce reçue': 'badge-info',
    "En attente d'accord client": 'badge-brand',
    'En cours de réparation': 'badge-info',
    'Réparation terminée': 'badge-success',
    'Rendu au client': 'badge-neutral',
    'Clôturé': 'badge-neutral',
  };
  return map[statut] || 'badge-neutral';
}

export function getStatusIcon(statut) {
  const map = {
    'En attente de diagnostic': '🔍',
    'En attente de pièce': '📦',
    'Pièce reçue': '📬',
    "En attente d'accord client": '⏳',
    'En cours de réparation': '🔧',
    'Réparation terminée': '✅',
    'Rendu au client': '🤝',
    'Clôturé': '📁',
  };
  return map[statut] || '📋';
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
