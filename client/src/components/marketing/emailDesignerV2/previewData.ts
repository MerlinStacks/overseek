import { useCallback, useState } from 'react';

export type PreviewOrderMode = 'latest' | 'none';

export interface PreviewOrderSelection {
    order?: unknown;
    /** Internal ID from the account-scoped list, never the Woo ID in order details. */
    orderId?: string;
}

export function getPreviewTestOrderId(mode: PreviewOrderMode, preview: PreviewOrderSelection | null): string | null {
    return mode === 'latest' && preview?.order && typeof preview.order === 'object' && !Array.isArray(preview.order)
        && typeof preview.orderId === 'string' && preview.orderId.trim()
        ? preview.orderId : null;
}

/** Gate during render, before effect cleanup/reset can run after an account switch. */
export function useScopedEmailPreview<T>(accountId: string | undefined, mode: PreviewOrderMode, token?: string | null) {
    const [state, setState] = useState<{ accountId: string | undefined; mode: PreviewOrderMode; token?: string | null; value: T } | null>(null);
    const setPreview = useCallback((value: T) => {
        setState({ accountId, mode, token, value });
    }, [accountId, mode, token]);
    const preview = state?.accountId === accountId && state?.mode === mode && state?.token === token ? state.value : null;
    return [preview, setPreview] as const;
}

/** Abort checks also cover transports whose pending JSON parsing ignores cancellation. */
export async function loadEmailPreviewData({ accountId, token, mode, signal, onProducts, onOrder }: {
    accountId: string;
    token: string;
    mode: PreviewOrderMode;
    signal: AbortSignal;
    onProducts: (products: Array<Record<string, unknown>>) => void;
    onOrder: (order: Record<string, unknown>, internalOrderId: string) => void;
}): Promise<void> {
    const options = { headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId }, signal };
    if (signal.aborted) return;
    const productsResponse = await fetch('/api/products?limit=6', options);
    if (signal.aborted) return;
    if (productsResponse.ok) {
        const payload = await productsResponse.json() as { products?: Array<Record<string, unknown>> };
        if (signal.aborted) return;
        onProducts(payload.products || []);
    }
    if (mode === 'none' || signal.aborted) return;
    const listResponse = await fetch('/api/orders?limit=1', options);
    if (signal.aborted || !listResponse.ok) return;
    const list = await listResponse.json() as { orders?: Array<{ id?: string }> };
    if (signal.aborted) return;
    const newest = list.orders?.[0];
    if (typeof newest?.id !== 'string' || !newest.id.trim()) return;
    const internalOrderId = newest.id;
    const detailResponse = await fetch(`/api/orders/${encodeURIComponent(internalOrderId)}`, options);
    if (signal.aborted || !detailResponse.ok) return;
    const order: unknown = await detailResponse.json();
    if (signal.aborted) return;
    if (!order || typeof order !== 'object' || Array.isArray(order)) return;
    onOrder(order as Record<string, unknown>, internalOrderId);
}
