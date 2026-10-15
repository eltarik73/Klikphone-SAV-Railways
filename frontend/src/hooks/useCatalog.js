import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../lib/api';
import { MARQUE_AUTRE, normKey } from '../lib/catalog';

const EMPTY = Object.freeze([]);
const EMPTY_MAP = new Map();
const INITIAL = { marques: EMPTY, byMarque: EMPTY_MAP, byKey: EMPTY_MAP, version: null, repli: false, loading: false, error: null };

const clean = (s) => String(s ?? '').trim();
const estAutre = (marque) => normKey(marque) === normKey(MARQUE_AUTRE);

function normaliserArbre(tree) {
  const byMarque = new Map();
  for (const entry of Array.isArray(tree?.marques) ? tree.marques : []) {
    const marque = clean(entry?.marque);
    if (!marque || marque === MARQUE_AUTRE || byMarque.has(marque)) continue;
    const modeles = (Array.isArray(entry.modeles) ? entry.modeles : [])
      .filter((x) => x && clean(x.m) && clean(x.m) !== MARQUE_AUTRE)
      .map((x) => ({ m: clean(x.m), a: Number.isFinite(x.a) ? x.a : null }));
    byMarque.set(marque, modeles);
  }
  return byMarque;
}

// Index secondaire par clé normalisée : marque saisie à la main (« apple », « SAMSUNG »)
function indexerParCle(byMarque) {
  const byKey = new Map();
  for (const [marque, modeles] of byMarque) {
    const key = normKey(marque);
    if (key && !byKey.has(key)) byKey.set(key, modeles);
  }
  return byKey;
}

/**
 * Catalogue d'une catégorie : marques dans l'ordre du backend + modèles [{ m, a }] par marque.
 * S'appuie sur /api/catalog/tree ; si l'arbre échoue, repli sur /marques puis /modeles
 * (modèles chargés pour `marqueActive` seulement, sans année).
 *
 * @param {string|null} categorie    null → rien n'est chargé
 * @param {string}      marqueActive marque dont les modèles doivent être prêts en mode repli
 * @returns {{ marques: string[], modelesDe: (marque: string) => {m: string, a: number|null}[], version: string|null, loading: boolean, error: Error|null }}
 */
export function useCatalog(categorie, marqueActive = '') {
  const [state, setState] = useState(() => ({ ...INITIAL, loading: !!categorie }));
  // Repli : clé `${categorie}|${normKey(marque)}` → modèles
  const repliCache = useRef(new Map());
  const [repliTick, setRepliTick] = useState(0);

  useEffect(() => {
    if (!categorie) {
      setState(INITIAL);
      return undefined;
    }
    let cancelled = false;
    setState({ ...INITIAL, loading: true });

    api.getCatalogTree(categorie)
      .then((tree) => {
        if (cancelled) return;
        const byMarque = normaliserArbre(tree);
        setState({ ...INITIAL, marques: [...byMarque.keys()], byMarque, byKey: indexerParCle(byMarque), version: tree?.version ?? null });
      })
      .catch(() => {
        if (cancelled) return;
        api.getMarques(categorie)
          .then((list) => {
            if (cancelled) return;
            const marques = [...new Set((Array.isArray(list) ? list : []).map(clean))]
              .filter((m) => m && m !== MARQUE_AUTRE);
            setState({ ...INITIAL, marques, repli: true });
          })
          .catch((err) => {
            if (!cancelled) setState({ ...INITIAL, repli: true, error: err });
          });
      });

    return () => { cancelled = true; };
  }, [categorie]);

  const marqueRepli = state.repli && categorie && clean(marqueActive) && !estAutre(marqueActive)
    ? clean(marqueActive) : '';
  const repliKey = marqueRepli ? `${categorie}|${normKey(marqueRepli)}` : '';

  useEffect(() => {
    if (!repliKey || repliCache.current.has(repliKey)) return;
    api.getModeles(categorie, marqueRepli)
      .then((list) => (Array.isArray(list) ? list : [])
        .map(clean)
        .filter((m) => m && m !== MARQUE_AUTRE)
        .map((m) => ({ m, a: null })))
      .catch(() => EMPTY)
      .then((modeles) => {
        repliCache.current.set(repliKey, modeles);
        setRepliTick((t) => t + 1);
      });
  }, [categorie, marqueRepli, repliKey]);

  const modelesDe = useCallback((marque) => {
    const key = clean(marque);
    if (!key || estAutre(key)) return EMPTY;
    if (state.repli) return repliCache.current.get(`${categorie}|${normKey(key)}`) || EMPTY;
    return state.byMarque.get(key) || state.byKey.get(normKey(key)) || EMPTY;
    // repliTick : force un nouveau modelesDe quand le cache de repli se remplit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.repli, state.byMarque, state.byKey, categorie, repliTick]);

  return {
    marques: state.marques,
    modelesDe,
    version: state.version,
    loading: state.loading || (!!repliKey && !repliCache.current.has(repliKey)),
    error: state.error,
  };
}

export default useCatalog;
