import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
    buildDraftKey,
    readDraft,
    writeDraft,
    usePODraftPersistence,
    PODraftState,
} from './usePODraftPersistence';

/** Factory for a valid draft snapshot */
function makeDraft(overrides: Partial<PODraftState> = {}): PODraftState {
    return {
        supplierId: 'sup-1',
        status: 'DRAFT',
        notes: 'test notes',
        orderDate: '2026-01-01',
        expectedDate: '2026-02-01',
        trackingNumber: '',
        trackingLink: '',
        items: [{ name: 'Widget', quantity: 10, unitCost: 5, totalCost: 50 }],
        savedAt: Date.now(),
        ...overrides,
    };
}

describe('buildDraftKey', () => {
    it('scopes key by account and PO id', () => {
        expect(buildDraftKey('acc-1', 'po-42')).toBe('po-draft:acc-1:po-42');
    });

    it('uses "new" for unsaved POs', () => {
        expect(buildDraftKey('acc-1', 'new')).toBe('po-draft:acc-1:new');
    });
});

describe('readDraft / writeDraft', () => {
    const key = 'po-draft:test:1';

    beforeEach(() => localStorage.clear());

    it('returns null when no draft exists', () => {
        expect(readDraft(key)).toBeNull();
    });

    it('round-trips a draft through write + read', () => {
        const draft = makeDraft();
        writeDraft(key, draft);
        const loaded = readDraft(key);
        expect(loaded).toEqual(draft);
    });

    it('discards drafts older than 24 hours', () => {
        const stale = makeDraft({ savedAt: Date.now() - 25 * 60 * 60 * 1000 });
        writeDraft(key, stale);
        expect(readDraft(key)).toBeNull();
        // Key should also be removed from storage
        expect(localStorage.getItem(key)).toBeNull();
    });

    it('handles corrupt JSON gracefully', () => {
        localStorage.setItem(key, '{not valid json!!!');
        expect(readDraft(key)).toBeNull();
        expect(localStorage.getItem(key)).toBeNull();
    });
});

describe('usePODraftPersistence', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    const baseFormState = {
        supplierId: 'sup-1',
        status: 'DRAFT',
        notes: '',
        orderDate: '',
        expectedDate: '',
        trackingNumber: '',
        trackingLink: '',
        items: [] as PODraftState['items'],
    };

    it('auto-saves to localStorage after debounce', () => {
        renderHook(() =>
            usePODraftPersistence({
                accountId: 'acc-1',
                poId: 'new',
                formState: baseFormState,
                enabled: true,
            }),
        );

        // Before debounce fires, nothing stored
        expect(localStorage.getItem('po-draft:acc-1:new')).toBeNull();

        act(() => { vi.advanceTimersByTime(600); });

        const stored = localStorage.getItem('po-draft:acc-1:new');
        expect(stored).not.toBeNull();
        const parsed = JSON.parse(stored!);
        expect(parsed.supplierId).toBe('sup-1');
    });

    it('does not save when enabled=false', () => {
        renderHook(() =>
            usePODraftPersistence({
                accountId: 'acc-1',
                poId: 'new',
                formState: baseFormState,
                enabled: false,
            }),
        );

        act(() => { vi.advanceTimersByTime(1000); });
        expect(localStorage.getItem('po-draft:acc-1:new')).toBeNull();
    });

    it('loadDraft returns stored draft', () => {
        const draft = makeDraft();
        writeDraft('po-draft:acc-1:new', draft);

        const { result } = renderHook(() =>
            usePODraftPersistence({
                accountId: 'acc-1',
                poId: 'new',
                formState: baseFormState,
                enabled: true,
            }),
        );

        const loaded = result.current.loadDraft();
        expect(loaded).toEqual(draft);
    });

    it('clearDraft removes the entry from localStorage', () => {
        writeDraft('po-draft:acc-1:new', makeDraft());

        const { result } = renderHook(() =>
            usePODraftPersistence({
                accountId: 'acc-1',
                poId: 'new',
                formState: baseFormState,
                enabled: true,
            }),
        );

        act(() => { result.current.clearDraft(); });
        expect(localStorage.getItem('po-draft:acc-1:new')).toBeNull();
    });
});
