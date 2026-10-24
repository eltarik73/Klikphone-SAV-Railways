/**
 * useAutoSave : regroupement, un seul envoi à la fois, flush, erreur + réessai,
 * démontage et pagehide sans perte.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoSave, DELAI_FRAPPE } from '../hooks/useAutoSave';

function differe() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Laisse passer les microtâches (await internes du hook)
async function vider() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('useAutoSave', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('regroupe les modifications successives en un seul envoi après le délai', async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useAutoSave(save, { delay: 500 }));

    act(() => {
      result.current.schedule({ prix: 10 });
      vi.advanceTimersByTime(300);
      result.current.schedule({ prix: 12, acompte: 5 });
    });
    expect(result.current.status).toBe('dirty');
    expect(save).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(500); await vider(); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ prix: 12, acompte: 5 });
    expect(result.current.status).toBe('saved');

    await act(async () => { vi.advanceTimersByTime(2500); });
    expect(result.current.status).toBe(null);
  });

  it('affiche « saving » pendant l’envoi', async () => {
    const d = differe();
    const save = vi.fn(() => d.promise);
    const { result } = renderHook(() => useAutoSave(save, { delay: 500 }));
    act(() => { result.current.schedule({ a: 1 }, { wait: 0 }); });
    await act(async () => { vi.advanceTimersByTime(0); await vider(); });
    expect(result.current.status).toBe('saving');
    await act(async () => { d.resolve({}); await vider(); });
    expect(result.current.status).toBe('saved');
  });

  it('n’envoie qu’une requête à la fois et regroupe ce qui arrive pendant l’envoi', async () => {
    const premiers = differe();
    const save = vi.fn()
      .mockImplementationOnce(() => premiers.promise)
      .mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useAutoSave(save, { delay: 500 }));

    act(() => { result.current.schedule({ a: 1 }, { wait: 0 }); });
    await act(async () => { vi.advanceTimersByTime(0); await vider(); });
    expect(save).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.schedule({ b: 2 }, { wait: 0 });
      result.current.schedule({ c: 3 }, { wait: 0 });
    });
    await act(async () => { vi.advanceTimersByTime(0); await vider(); });
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => { premiers.resolve({}); await vider(); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ b: 2, c: 3 });
    expect(result.current.status).toBe('saved');
  });

  it('flush envoie tout de suite, sans attendre le délai, et attend la fin', async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useAutoSave(save, { delay: 5000 }));
    act(() => { result.current.schedule({ label: 'Forfait remplacement batterie' }); });
    let fini = false;
    await act(async () => {
      await result.current.flush().then(() => { fini = true; });
    });
    expect(fini).toBe(true);
    expect(save).toHaveBeenCalledWith({ label: 'Forfait remplacement batterie' });
    expect(result.current.hasPending()).toBe(false);
  });

  it('flush sans rien en attente se résout immédiatement', async () => {
    const save = vi.fn();
    const { result } = renderHook(() => useAutoSave(save));
    await act(async () => { await result.current.flush(); });
    expect(save).not.toHaveBeenCalled();
  });

  it('en cas d’erreur : statut error, rien n’est perdu et le réessai fusionne avec les saisies plus récentes', async () => {
    const onError = vi.fn();
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('réseau'))
      .mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useAutoSave(save, { delay: 500, onError }));

    act(() => { result.current.schedule({ prix: 10, acompte: 5 }, { wait: 0 }); });
    await act(async () => { vi.advanceTimersByTime(0); await vider(); });
    expect(result.current.status).toBe('error');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current.hasPending()).toBe(true);

    act(() => { result.current.schedule({ prix: 15 }); });
    await act(async () => { await result.current.retry(); });
    expect(save).toHaveBeenLastCalledWith({ prix: 15, acompte: 5 });
    expect(result.current.status).toBe('saved');
  });

  it('flush rejette si l’envoi échoue (impression bloquée sur des prix non enregistrés)', async () => {
    const save = vi.fn().mockRejectedValue(new Error('500'));
    const { result } = renderHook(() => useAutoSave(save));
    act(() => { result.current.schedule({ prix: 1 }); });
    let erreur = null;
    await act(async () => { await result.current.flush().catch((e) => { erreur = e; }); });
    expect(erreur?.message).toBe('500');
  });

  it('au démontage, ce qui reste part par onUnload (sans attendre le délai)', async () => {
    const save = vi.fn().mockResolvedValue({});
    const onUnload = vi.fn();
    const { result, unmount } = renderHook(() => useAutoSave(save, { delay: 1500, onUnload }));
    act(() => { result.current.schedule({ panne_detail: 'écran fissuré' }); });
    unmount();
    await act(async () => { await vider(); });
    expect(onUnload).toHaveBeenCalledWith({ panne_detail: 'écran fissuré' });
    expect(save).not.toHaveBeenCalled();
  });

  it('au démontage pendant un envoi, le reste part après la fin de cet envoi', async () => {
    const d = differe();
    const save = vi.fn(() => d.promise);
    const onUnload = vi.fn();
    const { result, unmount } = renderHook(() => useAutoSave(save, { delay: 500, onUnload }));
    act(() => { result.current.schedule({ a: 1 }, { wait: 0 }); });
    await act(async () => { vi.advanceTimersByTime(0); await vider(); });
    act(() => { result.current.schedule({ b: 2 }); });
    unmount();
    await vider();
    expect(onUnload).not.toHaveBeenCalled();
    d.resolve({});
    await vider();
    await vider();
    expect(onUnload).toHaveBeenCalledWith({ b: 2 });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('pagehide renvoie l’envoi en cours et les modifications en attente (keepalive)', async () => {
    const d = differe();
    const save = vi.fn(() => d.promise);
    const onUnload = vi.fn();
    const { result } = renderHook(() => useAutoSave(save, { delay: 500, onUnload }));
    act(() => { result.current.schedule({ a: 1 }, { wait: 0 }); });
    await act(async () => { vi.advanceTimersByTime(0); await vider(); });
    act(() => { result.current.schedule({ b: 2, a: 3 }); });
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(onUnload).toHaveBeenCalledWith({ a: 3, b: 2 });
    await act(async () => { d.resolve({}); await vider(); });
  });

  it('pendingKeys distingue l’attente et l’envoi en cours', async () => {
    const d = differe();
    const save = vi.fn(() => d.promise);
    const { result } = renderHook(() => useAutoSave(save, { delay: 500 }));
    act(() => { result.current.schedule({ a: 1 }, { wait: 0 }); });
    await act(async () => { vi.advanceTimersByTime(0); await vider(); });
    act(() => { result.current.schedule({ b: 2 }); });
    expect([...result.current.pendingKeys()].sort()).toEqual(['a', 'b']);
    expect([...result.current.pendingKeys({ inflight: false })]).toEqual(['b']);
    await act(async () => { d.resolve({}); await result.current.flush(); });
    expect(result.current.pendingKeys().size).toBe(0);
  });

  it('utilise toujours la dernière fonction d’enregistrement (pas de closure périmée)', async () => {
    const v1 = vi.fn().mockResolvedValue({});
    const v2 = vi.fn().mockResolvedValue({});
    const { result, rerender } = renderHook(({ fn }) => useAutoSave(fn, { delay: 500 }), { initialProps: { fn: v1 } });
    act(() => { result.current.schedule({ mode: 'eur' }); });
    rerender({ fn: v2 });
    await act(async () => { vi.advanceTimersByTime(500); await vider(); });
    expect(v1).not.toHaveBeenCalled();
    expect(v2).toHaveBeenCalledWith({ mode: 'eur' });
  });

  it('délai par défaut court (DELAI_FRAPPE = 250 ms, 500 ms avant) ; wait: 0 envoie aussitôt', async () => {
    expect(DELAI_FRAPPE).toBe(250);
    const save = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useAutoSave(save));
    act(() => { result.current.schedule({ prix: 10 }); });
    expect(result.current.status).toBe('dirty');
    await act(async () => { vi.advanceTimersByTime(DELAI_FRAPPE - 1); await vider(); });
    expect(save).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); await vider(); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('saved');

    act(() => { result.current.schedule({ priorite: 'urgente' }, { wait: 0 }); });
    await act(async () => { vi.advanceTimersByTime(0); await vider(); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ priorite: 'urgente' });
  });
});
