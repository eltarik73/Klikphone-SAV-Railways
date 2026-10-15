import { useEffect, useRef, useCallback } from 'react';

const getDocument = () => (typeof document !== 'undefined' ? document : null);

/**
 * Rafraîchissement périodique sans chevauchement : le tour suivant n'est programmé
 * qu'une fois la promesse du précédent terminée (un serveur lent n'empile pas les requêtes).
 * - Onglet masqué : aucune requête, minuterie arrêtée.
 * - Retour sur l'onglet : appel immédiat, puis reprise du rythme.
 * - setDelay(ms) change le rythme sans appel supplémentaire.
 */
export function createPoller(fn, delayMs, { immediate = true, doc = getDocument() } = {}) {
  let delay = delayMs;
  let timer = null;
  let active = false;
  let running = false;

  const hidden = () => Boolean(doc?.hidden);
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    clear();
    if (active && !hidden()) timer = setTimeout(tick, delay);
  };
  async function tick() {
    // Annule un tour déjà programmé (appel direct au retour sur l'onglet) : une seule chaîne
    clear();
    if (!active || hidden() || running) return;
    running = true;
    try {
      await fn();
    } catch {
      /* chaque appelant gère ses erreurs ; le tour suivant aura lieu quand même */
    } finally {
      running = false;
      schedule();
    }
  }
  const onVisibility = () => {
    if (!active) return;
    if (hidden()) clear();
    else if (!running) tick();
  };

  return {
    start() {
      if (active) return;
      active = true;
      doc?.addEventListener('visibilitychange', onVisibility);
      if (immediate) tick();
      else schedule();
    },
    stop() {
      active = false;
      clear();
      doc?.removeEventListener('visibilitychange', onVisibility);
    },
    setDelay(next) {
      if (next === delay) return;
      delay = next;
      if (!running) schedule();
    },
    // Appel immédiat (ex. après un envoi) ; ignoré si un appel est déjà en cours
    trigger() {
      if (!running) {
        clear();
        tick();
      }
    },
    get delay() { return delay; },
  };
}

/**
 * Hook : appelle `fn` toutes les `ms` millisecondes tant que `enabled`.
 * `fn` peut changer à chaque rendu sans relancer la minuterie. Renvoie `refresh()`.
 */
export function usePolling(fn, ms, { enabled = true, immediate = true } = {}) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const msRef = useRef(ms);
  msRef.current = ms;
  const pollerRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const poller = createPoller(() => fnRef.current?.(), msRef.current, { immediate });
    pollerRef.current = poller;
    poller.start();
    return () => {
      poller.stop();
      if (pollerRef.current === poller) pollerRef.current = null;
    };
  }, [enabled, immediate]);

  useEffect(() => {
    pollerRef.current?.setDelay(ms);
  }, [ms]);

  return useCallback(() => pollerRef.current?.trigger(), []);
}

export default usePolling;
