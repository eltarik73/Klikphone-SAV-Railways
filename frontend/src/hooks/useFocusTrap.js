import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]', 'area[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', 'iframe', '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function focusableIn(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE))
    .filter((el) => !el.hasAttribute('inert') && el.getAttribute('aria-hidden') !== 'true');
}

/**
 * Fenêtre modale accessible : tant que `active`, Tab et Maj+Tab restent dans `ref`, Échap appelle
 * `onEscape`, et à la fermeture le focus revient sur l'élément qui l'avait avant l'ouverture.
 * `initialFocus` : sélecteur de l'élément à focaliser à l'ouverture (sinon le premier focusable).
 */
export function useFocusTrap(ref, active, { onEscape, initialFocus } = {}) {
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined;
    const previous = document.activeElement;
    const container = ref.current;

    if (container && !container.contains(document.activeElement)) {
      const target = (initialFocus && container.querySelector(initialFocus)) || focusableIn(container)[0] || container;
      if (target === container && !container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
      target.focus?.({ preventScroll: true });
    }

    const onKeyDown = (e) => {
      const box = ref.current;
      if (!box) return;
      if (e.key === 'Escape' && escapeRef.current) {
        e.stopPropagation();
        escapeRef.current(e);
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusableIn(box);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (e.shiftKey && (current === first || !box.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !box.contains(current))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) {
        previous.focus({ preventScroll: true });
      }
    };
  // initialFocus est lu à l'ouverture seulement
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ref]);
}

export default useFocusTrap;
