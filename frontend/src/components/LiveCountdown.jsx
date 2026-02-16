import { useState, useEffect } from 'react';

/**
 * Parse date_recuperation (free text field) into a Date object.
 * Handles: ISO, FR DD/MM/YYYY, "demain", "aujourd'hui", day names.
 * Returns null if unparseable.
 */
function parseDateRecup(str) {
  if (!str) return null;
  const trimmed = str.trim();

  // 1. ISO or standard format
  const d1 = new Date(trimmed);
  if (!isNaN(d1.getTime()) && trimmed.length >= 8) return d1;

  // 2. French DD/MM/YYYY [HH:MM or HHhMM]
  const frMatch = trimmed.match(
    /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\s+(\d{1,2})[h:](\d{2}))?/
  );
  if (frMatch) {
    const year = frMatch[3].length === 2 ? '20' + frMatch[3] : frMatch[3];
    const d = new Date(
      `${year}-${frMatch[2].padStart(2, '0')}-${frMatch[1].padStart(2, '0')}T${
        (frMatch[4] || '18').padStart(2, '0')
      }:${frMatch[5] || '00'}:00`
    );
    if (!isNaN(d.getTime())) return d;
  }

  // 3. Relative words (French)
  const lower = trimmed.toLowerCase();
  const now = new Date();

  if (lower === 'demain') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(18, 0, 0, 0);
    return d;
  }
  if (lower === "aujourd'hui" || lower === 'aujourdhui' || lower === 'ce soir') {
    const d = new Date(now);
    d.setHours(18, 0, 0, 0);
    return d;
  }

  // 4. Day names
  const days = { lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6, dimanche: 0 };
  for (const [name, target] of Object.entries(days)) {
    if (lower.includes(name)) {
      const d = new Date(now);
      const diff = (target - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      d.setHours(18, 0, 0, 0);
      return d;
    }
  }

  return null;
}

function formatCountdown(ms) {
  const abs = Math.abs(ms);
  const totalH = Math.floor(abs / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  if (totalH >= 24) {
    const d = Math.floor(totalH / 24);
    const rh = totalH % 24;
    return `${d}j ${rh}h`;
  }
  return `${totalH}h${String(m).padStart(2, '0')}`;
}

export default function LiveCountdown({ dateStr, visible }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  if (!visible || !dateStr) return null;

  const target = parseDateRecup(dateStr);
  if (!target) return null;

  const diff = target - now;
  const isOverdue = diff < 0;
  const isUrgent = diff > 0 && diff < 2 * 3600000; // < 2h

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
      isOverdue
        ? 'bg-red-50 text-red-600'
        : isUrgent
          ? 'bg-amber-50 text-amber-600'
          : 'bg-emerald-50 text-emerald-600'
    }`}>
      {isOverdue ? 'Dépassé ' : 'dans '}
      {formatCountdown(diff)}
    </span>
  );
}
