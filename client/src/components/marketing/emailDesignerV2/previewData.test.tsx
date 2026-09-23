import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPreviewTestOrderId, loadEmailPreviewData, useScopedEmailPreview, type PreviewOrderMode, type PreviewOrderSelection } from './previewData';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

afterEach(() => vi.unstubAllGlobals());

describe('email preview request cancellation', () => {
    it.each(['products', 'list', 'detail'] as const)('ignores late %s JSON after account cleanup', async (stage) => {
        const pending = deferred<unknown>();
        const payloads = [{ products: [{ name: 'Old product' }] }, { orders: [{ id: 'old-order' }] }, { deliveryEstimateSnapshot: { version: 1 } }];
        const index = ['products', 'list', 'detail'].indexOf(stage);
        const parsers = payloads.map((payload, i) => vi.fn(() => i === index ? pending.promise : Promise.resolve(payload)));
        const fetchMock = vi.fn();
        parsers.forEach(json => fetchMock.mockResolvedValueOnce({ ok: true, json }));
        vi.stubGlobal('fetch', fetchMock);
        const controller = new AbortController();
        const onProducts = vi.fn();
        const onOrder = vi.fn();
        const loading = loadEmailPreviewData({ accountId: 'old', token: 'token', mode: 'latest', signal: controller.signal, onProducts, onOrder });
        await waitFor(() => expect(parsers[index]).toHaveBeenCalledOnce());
        controller.abort();
        onProducts.mockClear();
        pending.resolve(payloads[index]);
        await loading;
        expect(onProducts).not.toHaveBeenCalled();
        expect(onOrder).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(index + 1);
    });

    it('does not parse a late response from an aborted transport', async () => {
        const pending = deferred<unknown>();
        vi.stubGlobal('fetch', vi.fn(() => pending.promise));
        const controller = new AbortController();
        const json = vi.fn();
        const onProducts = vi.fn();
        const onOrder = vi.fn();
        const loading = loadEmailPreviewData({ accountId: 'old', token: 'token', mode: 'latest', signal: controller.signal, onProducts, onOrder });
        controller.abort();
        pending.resolve({ ok: true, json });
        await loading;
        expect(json).not.toHaveBeenCalled();
        expect(onProducts).not.toHaveBeenCalled();
        expect(onOrder).not.toHaveBeenCalled();
    });

    it('keeps product loading in no-order mode and fetches no orders', async () => {
        const products = [{ name: 'Current product' }];
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ products }) });
        vi.stubGlobal('fetch', fetchMock);
        const onProducts = vi.fn();
        const onOrder = vi.fn();
        await loadEmailPreviewData({ accountId: 'current', token: 'token', mode: 'none', signal: new AbortController().signal, onProducts, onOrder });
        expect(onProducts).toHaveBeenCalledWith(products);
        expect(onOrder).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock).toHaveBeenCalledWith('/api/products?limit=6', expect.objectContaining({ headers: { Authorization: 'Bearer token', 'X-Account-ID': 'current' } }));
    });

    it('passes the exact loaded order and snapshot after the product preview', async () => {
        const order = { id: 98765, deliveryEstimateSnapshot: { version: 1, capturedAt: 'saved' } };
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ products: [] }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ orders: [{ id: 'current-order' }] }) })
            .mockResolvedValueOnce({ ok: true, json: async () => order });
        vi.stubGlobal('fetch', fetchMock);
        const onOrder = vi.fn();
        await loadEmailPreviewData({ accountId: 'current', token: 'token', mode: 'latest', signal: new AbortController().signal, onProducts: vi.fn(), onOrder });
        expect(onOrder.mock.calls[0][0]).toBe(order);
        expect(onOrder.mock.calls[0][1]).toBe('current-order');
        expect(getPreviewTestOrderId('latest', { order, orderId: onOrder.mock.calls[0][1] })).toBe('current-order');
        expect(fetchMock.mock.calls[2][0]).toBe('/api/orders/current-order');
    });
});

describe('test-send order selection', () => {
    it('always serializes an explicit null when there is no loaded internal order selection', () => {
        for (const preview of [null, {}, { orderId: 'loading' }, { order: { id: 123 } }, { order: { id: 'raw-woo-id' } }, { order: null, orderId: 'old' }]) {
            expect(JSON.parse(JSON.stringify({ orderId: getPreviewTestOrderId('latest', preview) }))).toEqual({ orderId: null });
        }
        expect(getPreviewTestOrderId('none', { order: { id: 123 }, orderId: 'internal' })).toBeNull();
        expect(getPreviewTestOrderId('latest', { order: { id: 123 }, orderId: 'internal' })).toBe('internal');
    });

    it('cannot send the prior account or mode selection before effects reset the preview', () => {
        const { result, rerender } = renderHook(({ accountId, mode }) => {
            const [preview, setPreview] = useScopedEmailPreview<PreviewOrderSelection>(accountId, mode, 'token');
            return { setPreview, payload: { orderId: getPreviewTestOrderId(mode, preview) } };
        }, { initialProps: { accountId: 'first', mode: 'latest' as PreviewOrderMode } });
        act(() => result.current.setPreview({ order: { id: 123 }, orderId: 'first-internal' }));
        expect(result.current.payload).toEqual({ orderId: 'first-internal' });
        rerender({ accountId: 'second', mode: 'latest' });
        expect(result.current.payload).toEqual({ orderId: null });
        act(() => result.current.setPreview({ order: { id: 456 }, orderId: 'second-internal' }));
        expect(result.current.payload).toEqual({ orderId: 'second-internal' });
        rerender({ accountId: 'second', mode: 'none' });
        expect(result.current.payload).toEqual({ orderId: null });
    });

    it('rejects a numeric list ID rather than using it as an internal ID', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ products: [] }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ orders: [{ id: 123 }] }) });
        vi.stubGlobal('fetch', fetchMock);
        const onOrder = vi.fn();
        await loadEmailPreviewData({ accountId: 'current', token: 'token', mode: 'latest', signal: new AbortController().signal, onProducts: vi.fn(), onOrder });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(onOrder).not.toHaveBeenCalled();
    });
});

describe('render-time preview scope', () => {
    it.each([
        { accountId: 'other', mode: 'latest' as PreviewOrderMode, token: 'token' },
        { accountId: 'current', mode: 'none' as PreviewOrderMode, token: 'token' },
        { accountId: undefined, mode: 'latest' as PreviewOrderMode, token: null },
    ])('hides all previous preview content immediately for scope $accountId/$mode', (next) => {
        const renders: unknown[] = [];
        const initialProps: { accountId: string | undefined; mode: PreviewOrderMode; token: string | null } = { accountId: 'current', mode: 'latest', token: 'token' };
        const { result, rerender } = renderHook(({ accountId, mode, token }) => {
            const state = useScopedEmailPreview<unknown>(accountId, mode, token);
            renders.push(state[0]);
            return state;
        }, { initialProps });
        const oldSet = result.current[1];
        const oldPreview = { newProducts: ['Old product'], order: { deliveryEstimateSnapshot: { version: 1 } } };
        act(() => oldSet(oldPreview));
        expect(result.current[0]).toBe(oldPreview);
        renders.length = 0;
        rerender(next);
        expect(renders.every(value => value === null)).toBe(true);
        // Even a stale callback cannot make old-account data visible in the new scope.
        act(() => oldSet(oldPreview));
        expect(result.current[0]).toBeNull();
        act(() => result.current[1]({ newProducts: ['Current product'] }));
        expect(result.current[0]).toEqual({ newProducts: ['Current product'] });
    });
});
