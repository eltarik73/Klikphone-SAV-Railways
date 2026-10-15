import { useCallback, useRef, useState } from 'react';
import AdminLoginModal from '../components/AdminLoginModal';

/**
 * Actions sensibles (élévation admin de 10 min, en-tête X-Admin-Token).
 * `sensible(fn)` : si le serveur refuse faute d'élévation (err.code === 'admin_required'),
 * ouvre l'identification admin puis rejoue `fn` une seule fois. Plusieurs refus simultanés
 * attendent la même fenêtre. Annulation : erreur `code: 'admin_cancelled'`.
 * `adminPrompt` est l'élément à placer dans le rendu de la page.
 */
export function useAdminElevation() {
  const [open, setOpen] = useState(false);
  const waitersRef = useRef([]);

  const sensible = useCallback(async (fn) => {
    try {
      return await fn();
    } catch (err) {
      if (err?.code !== 'admin_required') throw err;
      await new Promise((resolve, reject) => {
        waitersRef.current.push({ resolve, reject });
        setOpen(true);
      });
      return fn();
    }
  }, []);

  const close = useCallback((ok) => {
    const waiters = waitersRef.current;
    waitersRef.current = [];
    setOpen(false);
    const annule = Object.assign(new Error('Identification administrateur annulée'), { code: 'admin_cancelled' });
    waiters.forEach((w) => (ok ? w.resolve() : w.reject(annule)));
  }, []);

  const adminPrompt = (
    <AdminLoginModal open={open} onClose={() => close(false)} onSuccess={() => close(true)} />
  );

  return { sensible, adminPrompt };
}

export default useAdminElevation;
