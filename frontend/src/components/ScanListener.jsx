import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';

// Une douchette USB (émulation clavier) tape les caractères en < 50 ms
// d'intervalle puis envoie Entrée — aucun humain ne tient cette cadence
// sur 6+ caractères, ce qui évite les faux positifs sur la saisie normale.
const SCAN_MAX_KEY_INTERVAL = 50;
const SCAN_MIN_LENGTH = 6;

// Le QR contient l'URL publique de suivi (…/suivi?ticket=KP-000123) ;
// on accepte aussi un code ticket brut pour les codes-barres simples.
function extractTicketCode(scanned) {
  const m = scanned.match(/[?&]ticket=([A-Za-z0-9%_-]+)/);
  if (m) {
    try { return decodeURIComponent(m[1]).toUpperCase(); } catch { return null; }
  }
  const raw = scanned.trim().toUpperCase();
  if (/^KP-\d{4,}$/.test(raw)) return raw;
  return null;
}

export default function ScanListener() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const bufRef = useRef({ chars: '', last: 0 });

  useEffect(() => {
    if (!user?.target || !['accueil', 'tech'].includes(user.target)) return;

    const handleScan = async (ticketCode) => {
      try {
        const t = await api.getTicketByCode(ticketCode);
        if (t?.id) navigate(`/${user.target}/ticket/${t.id}`);
      } catch {
        // Code inconnu — on ignore silencieusement
      }
    };

    const onKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const buf = bufRef.current;
      const now = performance.now();
      if (now - buf.last > SCAN_MAX_KEY_INTERVAL) buf.chars = '';
      buf.last = now;

      if (e.key === 'Enter') {
        const scanned = buf.chars;
        buf.chars = '';
        if (scanned.length < SCAN_MIN_LENGTH) return;
        const ticketCode = extractTicketCode(scanned);
        if (!ticketCode) return;
        // Empêche l'Entrée de la douchette de soumettre un formulaire en cours
        e.preventDefault();
        e.stopPropagation();
        handleScan(ticketCode);
      } else if (e.key.length === 1) {
        buf.chars += e.key;
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [user?.target, navigate]);

  return null;
}
