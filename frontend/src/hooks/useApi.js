import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Global in-memory cache ────────────────────────────────
const _cache = new Map();
const _subs = new Set();

function _emit(tags) {
  _subs.forEach(fn => fn(tags));
}

/**
 * Invalidate cache entries matching any of the given tags.
 * Mounted hooks using those tags will revalidate automatically.
 */
export function invalidateCache(...tags) {
  if (!tags.length) return;
  for (const [, e] of _cache) {
    if (e.tags?.some(t => tags.includes(t))) e.stale = true;
  }
  _emit(tags);
}

/**
 * Clear all cache entries (call on logout).
 */
export function clearCache() {
  _cache.clear();
}

/**
 * Prefetch data into cache without rendering.
 */
export function prefetch(key, fetcher, opts = {}) {
  const { tags = [], ttl = 60000 } = opts;
  const c = _cache.get(key);
  if (c && !c.stale && Date.now() - c.ts < c.ttl) return;
  fetcher().then(data => {
    _cache.set(key, { data, ts: Date.now(), tags, ttl, stale: false });
  }).catch(() => {});
}

/**
 * SWR cache hook.
 *
 * @param {string|null} key   Cache key. Pass null to skip fetching.
 * @param {Function}    fetcher  Async function that returns data.
 * @param {Object}      opts     { tags: string[], ttl: number (ms) }
 * @returns {{ data, error, loading, isRevalidating, mutate }}
 *
 * - `loading`        true only on FIRST load (no cached data).
 * - `isRevalidating` true when refreshing in background (stale data shown).
 * - `mutate()`       re-fetch in background.
 * - `mutate(val)`    optimistic update (value or updater function).
 */
export function useApi(key, fetcher, opts = {}) {
  const { tags = [], ttl = 60000 } = opts;

  // Stable refs (don't trigger re-fetches)
  const fr = useRef(fetcher); fr.current = fetcher;
  const tr = useRef(tags);    tr.current = tags;
  const tlr = useRef(ttl);   tlr.current = ttl;
  const kr = useRef(key);
  const dataRef = useRef(null);

  // Initialise from cache
  const [data, setData] = useState(() => {
    const d = key ? _cache.get(key)?.data ?? null : null;
    dataRef.current = d;
    return d;
  });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(() => !!key && !_cache.get(key)?.data);
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [prevKey, setPrevKey] = useState(key);

  // Sync state when key changes (React "derived state from props" pattern)
  if (key !== prevKey) {
    setPrevKey(key);
    kr.current = key;
    const c = key ? _cache.get(key)?.data ?? null : null;
    dataRef.current = c;
    setData(c);
    setError(null);
    setLoading(!!key && !c);
    setIsRevalidating(false);
  }

  // Core fetch — stable callback (no state deps)
  const doFetch = useCallback(async (bg, fk) => {
    if (!fk) return;
    if (bg) setIsRevalidating(true); else setLoading(true);
    try {
      const result = await fr.current();
      if (kr.current !== fk) return; // key changed, discard
      _cache.set(fk, {
        data: result, ts: Date.now(),
        tags: tr.current, ttl: tlr.current, stale: false,
      });
      dataRef.current = result;
      setData(result);
      setError(null);
    } catch (err) {
      if (kr.current !== fk) return;
      setError(err);
    } finally {
      if (kr.current === fk) {
        setLoading(false);
        setIsRevalidating(false);
      }
    }
  }, []);

  // Fetch on mount / key change
  useEffect(() => {
    if (!key) return;
    const c = _cache.get(key);
    const hasCached = c?.data != null;
    const fresh = hasCached && !c.stale && Date.now() - c.ts < c.ttl;
    if (!fresh) doFetch(hasCached, key);
  }, [key, doFetch]);

  // Listen for tag-based invalidation
  useEffect(() => {
    if (!key) return;
    const handler = (invTags) => {
      if (!kr.current) return;
      if (invTags.some(t => tr.current.includes(t))) doFetch(true, kr.current);
    };
    _subs.add(handler);
    return () => _subs.delete(handler);
  }, [key, doFetch]);

  // Mutate: no args = revalidate, value = optimistic set
  const mutate = useCallback((v) => {
    if (v === undefined) return doFetch(true, kr.current);
    const val = typeof v === 'function' ? v(dataRef.current) : v;
    const k = kr.current;
    if (k) {
      _cache.set(k, {
        data: val, ts: Date.now(),
        tags: tr.current, ttl: tlr.current, stale: false,
      });
    }
    dataRef.current = val;
    setData(val);
  }, [doFetch]);

  return { data, error, loading, isRevalidating, mutate };
}

export default useApi;
