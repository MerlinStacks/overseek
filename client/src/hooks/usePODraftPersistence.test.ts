import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePODraftPersistence } from './usePODraftPersistence';

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
        localStorage.setItem('po-draft:acc-1:new', JSON.stringify(draft));

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
        localStorage.setItem('po-draft:acc-1:new', JSON.stringify(makeDraft()));

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

    it('drops stale drafts older than 24 hours', () => {
        const stale = makeDraft({ savedAt: Date.now() - 25 * 60 * 60 * 1000 });
        localStorage.setItem('po-draft:acc-1:new', JSON.stringify(stale));

        const { result } = renderHook(() =>
            usePODraftPersistence({
                accountId: 'acc-1',
                poId: 'new',
                formState: baseFormState,
                enabled: true,
            }),
        );

        expect(result.current.loadDraft()).toBeNull();
        expect(localStorage.getItem('po-draft:acc-1:new')).toBeNull();
    });

    it('clears corrupt draft payloads', () => {
        localStorage.setItem('po-draft:acc-1:new', '{not valid json!!!');

        const { result } = renderHook(() =>
            usePODraftPersistence({
                accountId: 'acc-1',
                poId: 'new',
                formState: baseFormState,
                enabled: true,
            }),
        );

        expect(result.current.loadDraft()).toBeNull();
        expect(localStorage.getItem('po-draft:acc-1:new')).toBeNull();
    });
});
