import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePODraftPersistence } from './usePODraftPersistence';
const form = { supplierId: '', status: 'DRAFT', notes: 'custom', orderDate: '', expectedDate: '', trackingNumber: '', trackingLink: '', items: [{ name: 'Custom line', quantity: 1, unitCost: 0, totalCost: 0 }] };
const options = { ownerId: 'u', accountId: 'a', poId: 'new', formState: form };
const key = `po-draft:v2:${JSON.stringify(['u', 'a', 'new'])}`;
beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('waits for restoration, preserves custom lines and cancels writes on clear', () => {
    const { result, rerender } = renderHook(p => usePODraftPersistence(p), { initialProps: options });
    act(() => vi.advanceTimersByTime(1000)); expect(localStorage.length).toBe(0);
    act(() => { result.current.loadDraft(); });
    act(() => vi.advanceTimersByTime(500)); expect(JSON.parse(localStorage.getItem(key)!).draft.items).toEqual(form.items);
    rerender({ ...options, formState: { ...form, notes: 'edited' } });
    act(() => result.current.clearDraft());
    act(() => { window.dispatchEvent(new Event('pagehide')); vi.advanceTimersByTime(1000); });
    expect(localStorage.getItem(key)).toBeNull();
});
it.each([{}, { savedAt: Date.now() + 100000 }, { savedAt: Date.now() - 90000000 }, { savedAt: Date.now(), items: [{}] }])('rejects invalid draft %j', bad => {
    localStorage.setItem(key, JSON.stringify({ version: 2, draft: { ...form, ...bad } }));
    const { result } = renderHook(() => usePODraftPersistence(options));
    act(() => { expect(result.current.loadDraft()).toBeNull(); });
});
it('does not restore another owner and flushes valid last edits on pagehide', () => {
    localStorage.setItem('po-draft:a:new', JSON.stringify({ ...form, savedAt: Date.now() }));
    const { result, rerender } = renderHook(p => usePODraftPersistence(p), { initialProps: options });
    act(() => { expect(result.current.loadDraft()).toBeNull(); });
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(localStorage.getItem(key)).not.toBeNull();
    rerender({ ...options, ownerId: 'other' });
    act(() => { expect(result.current.loadDraft()).toBeNull(); });
});
it('survives blocked reads, removals and writes', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error(); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw Error(); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error(); });
    const { result } = renderHook(() => usePODraftPersistence(options));
    act(() => { expect(result.current.loadDraft()).toBeNull(); });
    act(() => vi.advanceTimersByTime(500));
    act(() => result.current.clearDraft());
});
