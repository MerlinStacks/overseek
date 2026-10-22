import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePODraftPersistence } from './usePODraftPersistence';
const key = `po-draft:v2:${JSON.stringify(['owner-1', 'acc-1', 'new'])}`;

/** Factory for a valid draft snapshot */
type DraftState = {
    supplierId: string;
    status: string;
    notes: string;
    orderDate: string;
    expectedDate: string;
    trackingNumber: string;
    trackingLink: string;
    items: Array<{ name: string; quantity: number; unitCost: number; totalCost: number }>;
    savedAt: number;
};

function makeDraft(overrides: Partial<DraftState> = {}): DraftState {
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
        items: [] as DraftState['items'],
    };

    it('auto-saves to localStorage after debounce', () => {
        const { result } = renderHook(() =>
            usePODraftPersistence({
                ownerId: 'owner-1',
                accountId: 'acc-1',
                poId: 'new',
                formState: baseFormState,
                enabled: true,
            }),
        );

        // Before debounce fires, nothing stored
        expect(localStorage.getItem(key)).toBeNull();
        act(() => { result.current.loadDraft(); });

        act(() => { vi.advanceTimersByTime(600); });

        const stored = localStorage.getItem(key);
        expect(stored).not.toBeNull();
        const parsed = JSON.parse(stored!);
        expect(parsed.version).toBe(2);
        expect(parsed.draft.supplierId).toBe('sup-1');
    });

    it('does not save when enabled=false', () => {
        renderHook(() =>
            usePODraftPersistence({
                ownerId: 'owner-1',
                accountId: 'acc-1',
                poId: 'new',
                formState: baseFormState,
                enabled: false,
            }),
        );

        act(() => { vi.advanceTimersByTime(1000); });
        expect(localStorage.getItem(key)).toBeNull();
    });

    it('loadDraft returns stored draft', () => {
        const draft = makeDraft();
        localStorage.setItem(key, JSON.stringify({ version: 2, draft }));

        const { result } = renderHook(() =>
            usePODraftPersistence({
                ownerId: 'owner-1',
                accountId: 'acc-1',
                poId: 'new',
                formState: baseFormState,
                enabled: true,
            }),
        );

        act(() => { expect(result.current.loadDraft()).toEqual(draft); });
    });

    it('clearDraft removes the entry from localStorage', () => {
        localStorage.setItem(key, JSON.stringify({ version: 2, draft: makeDraft() }));

        const { result } = renderHook(() =>
            usePODraftPersistence({
                ownerId: 'owner-1',
                accountId: 'acc-1',
                poId: 'new',
                formState: baseFormState,
                enabled: true,
            }),
        );

        act(() => { result.current.clearDraft(); });
        expect(localStorage.getItem(key)).toBeNull();
    });

    it('drops stale drafts older than 24 hours', () => {
        const stale = makeDraft({ savedAt: Date.now() - 25 * 60 * 60 * 1000 });
        localStorage.setItem(key, JSON.stringify({ version: 2, draft: stale }));

        const { result } = renderHook(() =>
            usePODraftPersistence({
                ownerId: 'owner-1',
                accountId: 'acc-1',
                poId: 'new',
                formState: baseFormState,
                enabled: true,
            }),
        );

        act(() => { expect(result.current.loadDraft()).toBeNull(); });
        expect(localStorage.getItem(key)).toBeNull();
    });

    it('clears corrupt draft payloads', () => {
        localStorage.setItem(key, '{not valid json!!!');

        const { result } = renderHook(() =>
            usePODraftPersistence({
                ownerId: 'owner-1',
                accountId: 'acc-1',
                poId: 'new',
                formState: baseFormState,
                enabled: true,
            }),
        );

        act(() => { expect(result.current.loadDraft()).toBeNull(); });
        expect(localStorage.getItem(key)).toBeNull();
    });
});
