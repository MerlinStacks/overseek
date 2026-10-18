import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultEmailDesignV2 } from '../../../lib/emailDesignerV2';
import { useEmailAutosave } from './useEmailAutosave';

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { resolve, promise };
}
const design = (title: string) => createDefaultEmailDesignV2({ title });
afterEach(() => vi.useRealTimers());

describe('email autosave', () => {
    it('does not save an unchanged design and debounces edits', async () => {
        vi.useFakeTimers();
        const save = vi.fn();
        const snapshot = vi.fn();
        const original = design('Initial');
        const hook = renderHook(({ value }) => useEmailAutosave(value, value.document.meta.title, save, snapshot), { initialProps: { value: original } });
        await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
        expect(save).not.toHaveBeenCalled();
        hook.rerender({ value: { ...original, document: { ...original.document, meta: { title: 'Changed' } } } });
        await act(async () => { await vi.advanceTimersByTimeAsync(999); });
        expect(save).not.toHaveBeenCalled();
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(save).toHaveBeenCalledOnce();
        expect(hook.result.current.hasUnsavedChanges).toBe(false);
        expect(snapshot).toHaveBeenCalledOnce();
    });

    it('flush waits for an in-flight save AND a newer edit without overlapping requests', async () => {
        const first = deferred();
        const second = deferred();
        const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const original = design('Initial');
        const changed = (title: string) => ({ ...original, document: { ...original.document, meta: { title } } });
        const { result, rerender } = renderHook(({ value }) => useEmailAutosave(value, value.document.meta.title, save, vi.fn()), { initialProps: { value: original } });
        rerender({ value: changed('First') });
        let firstFlush!: Promise<boolean>;
        await act(async () => { firstFlush = result.current.flush(); await Promise.resolve(); });
        rerender({ value: changed('Latest') });
        const closeFlush = result.current.flush();
        expect(closeFlush).toBe(firstFlush);
        expect(save).toHaveBeenCalledOnce();
        let completed = false;
        void closeFlush.then(() => { completed = true; });
        await act(async () => { first.resolve(); await first.promise; });
        expect(save).toHaveBeenCalledTimes(2);
        expect(save.mock.calls[1][2]).toMatchObject({ subject: 'Latest' });
        expect(completed).toBe(false);
        await act(async () => { second.resolve(); expect(await closeFlush).toBe(true); });
        expect(result.current.hasUnsavedChanges).toBe(false);
    });

    it('keeps a failed revision dirty and permits an explicit retry', async () => {
        const original = design('Initial');
        const save = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(undefined);
        const { result, rerender } = renderHook(({ value }) => useEmailAutosave(value, 'html', save, vi.fn()), { initialProps: { value: original } });
        rerender({ value: { ...original, document: { ...original.document, meta: { title: 'Keep me' } } } });
        await act(async () => { expect(await result.current.flush()).toBe(false); });
        expect(result.current.saveError).toBe(true);
        expect(result.current.hasUnsavedChanges).toBe(true);
        await act(async () => { expect(await result.current.flush()).toBe(true); });
        expect(result.current.saveError).toBe(false);
        expect(result.current.hasUnsavedChanges).toBe(false);
    });
});
