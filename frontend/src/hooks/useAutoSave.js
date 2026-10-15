import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Enregistrement automatique d'un formulaire, sans perte.
 *
 * - schedule(partiel, { wait }) : fusionne les champs modifiés et programme l'envoi
 *   (wait en ms, défaut `delay` ; 0 pour un select, un toggle, un ajout de ligne).
 * - Un seul envoi à la fois : ce qui est modifié pendant un envoi part juste après, regroupé.
 * - flush() : envoie tout de suite ce qui reste et attend la fin (rejette si l'envoi échoue).
 * - Démontage : ce qui reste est envoyé par `onUnload` (fetch keepalive), après l'envoi en cours.
 * - pagehide : envoi en cours + modifications en attente renvoyés par `onUnload`.
 *
 * status : null | 'dirty' | 'saving' | 'saved' | 'error'
 */
export function useAutoSave(saveFn, { delay = 500, savedMs = 2000, onUnload, onError } = {}) {
  const saveRef = useRef(saveFn);
  saveRef.current = saveFn;
  const unloadRef = useRef(onUnload);
  unloadRef.current = onUnload;
  const errorRef = useRef(onError);
  errorRef.current = onError;

  const pending = useRef(null);
  const inflight = useRef(null);
  const loop = useRef(null);
  const timer = useRef(null);
  const savedTimer = useRef(null);
  const mounted = useRef(true);

  const [status, setStatusState] = useState(null);
  const [error, setError] = useState(null);

  const setStatus = useCallback((s) => {
    if (mounted.current) setStatusState(s);
  }, []);

  const drain = useCallback(() => {
    if (loop.current) return loop.current;
    const run = async () => {
      try {
        // Une modification encore dans son délai (timer armé) attend son tour, sauf flush()
        while (pending.current && !timer.current && mounted.current) {
          const patch = pending.current;
          pending.current = null;
          setStatus('saving');
          const promise = Promise.resolve().then(() => saveRef.current(patch));
          inflight.current = { patch, promise };
          try {
            await promise;
          } catch (err) {
            pending.current = { ...patch, ...(pending.current || {}) };
            inflight.current = null;
            if (mounted.current) {
              setError(err);
              setStatusState('error');
              errorRef.current?.(err);
            }
            throw err;
          }
          inflight.current = null;
        }
        if (!mounted.current) return;
        if (pending.current) {
          setStatusState('dirty');
          return;
        }
        setError(null);
        setStatusState('saved');
        clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => {
          if (mounted.current) setStatusState((s) => (s === 'saved' ? null : s));
        }, savedMs);
      } finally {
        loop.current = null;
      }
    };
    loop.current = run();
    return loop.current;
  }, [savedMs, setStatus]);

  const schedule = useCallback((partiel, { wait } = {}) => {
    if (!partiel || Object.keys(partiel).length === 0) return;
    pending.current = { ...(pending.current || {}), ...partiel };
    clearTimeout(savedTimer.current);
    setStatus('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      drain().catch(() => {});
    }, wait ?? delay);
  }, [delay, drain, setStatus]);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = null;
    if (!pending.current && !loop.current) return Promise.resolve();
    return drain();
  }, [drain]);

  /** Clés pas encore confirmées par le serveur (en attente, et en cours d'envoi si demandé). */
  const pendingKeys = useCallback(({ inflight: avecEnvoi = true } = {}) => {
    const keys = new Set(Object.keys(pending.current || {}));
    if (avecEnvoi && inflight.current) Object.keys(inflight.current.patch).forEach((k) => keys.add(k));
    return keys;
  }, []);

  const hasPending = useCallback(() => !!pending.current || !!inflight.current, []);

  useEffect(() => {
    mounted.current = true;
    const onPageHide = () => {
      const patch = { ...(inflight.current?.patch || {}), ...(pending.current || {}) };
      if (Object.keys(patch).length === 0) return;
      clearTimeout(timer.current);
      timer.current = null;
      pending.current = null;
      unloadRef.current?.(patch);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush().catch(() => {});
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [flush]);

  useEffect(() => () => {
    mounted.current = false;
    clearTimeout(timer.current);
    timer.current = null;
    clearTimeout(savedTimer.current);
    const envoyerLeReste = () => {
      const patch = pending.current;
      pending.current = null;
      if (!patch) return;
      if (unloadRef.current) unloadRef.current(patch);
      else Promise.resolve().then(() => saveRef.current(patch)).catch(() => {});
    };
    if (loop.current) loop.current.catch(() => {}).then(envoyerLeReste);
    else envoyerLeReste();
  }, []);

  return { status, error, schedule, flush, retry: flush, pendingKeys, hasPending };
}

export default useAutoSave;
