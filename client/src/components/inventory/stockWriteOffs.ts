export const reasons = { MISSING: 'Missing', DAMAGED: 'Damaged', ENTRY_ERROR: 'Entry error', EXPIRED: 'Expired', OTHER: 'Other' } as const;
export type Reason = keyof typeof reasons;
export interface WriteOffProduct {
    productId?: string | null;
    variationId?: number | null;
    internalProductId?: string | null;
    name: string;
    sku: string | null;
    type: string;
    stockQuantity?: number;
    unitCost: number | null;
}
export interface WriteOffItem extends WriteOffProduct {
    id: string;
    quantity: number;
    unitCostOverride: number | null;
    totalCost: number;
    stockBefore?: number | null;
    stockAfter?: number | null;
    cascadeError?: string | null;
}
export interface WriteOff {
    id: string;
    reference: string;
    status: 'DRAFT' | 'FINALIZED';
    reason: Reason;
    notes: string | null;
    createdAt: string;
    finalizedAt: string | null;
    totalCost: number;
    items: WriteOffItem[];
    syncStatus: 'NOT_REQUIRED' | 'PENDING' | 'NEEDS_ATTENTION' | 'SYNCED';
    syncOperations?: { operationId: string; lastError?: string | null; cascadeError?: string | null }[];
}
export interface WriteOffList {
    items: WriteOff[];
    total: number;
    page: number;
    pageSize: number;
    summary: { quantity: number; totalCost: number; count: number };
}
export type WriteOffRequest = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
export const productKey = (p: WriteOffProduct) => `${p.internalProductId ? 'internal' : 'woo'}:${p.internalProductId || p.productId}:${p.variationId || 0}`;

interface ReportRow {
    id: string; itemId: string; reference: string; finalizedAt: string; reason: Reason;
    name: string; sku: string | null; type: string; quantity: number; unitCost: number; totalCost: number;
}

/** Quote every field and neutralize spreadsheet formulas, including leading whitespace. */
export function csvCell(value: unknown): string {
    const text = String(value ?? '');
    // Spreadsheets can ignore leading whitespace/control bytes before a formula.
    let start = 0;
    while (start < text.length && (/\s/.test(text[start]) || text.charCodeAt(start) < 32)) start++;
    const safe = /^[=+\-@]/.test(text.slice(start)) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
}

export async function writeOffCsv(request: WriteOffRequest, filters: { reason: string; from: string; to: string }, currency: string) {
    const rows: ReportRow[] = [];
    let page = 1;
    let asOf = '';
    while (true) {
        const params = new URLSearchParams({ page: String(page) });
        Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
        if (asOf) params.set('asOf', asOf);
        const data = await request<{ items: ReportRow[]; total: number; pageSize: number; asOf: string }>(`/report?${params}`);
        rows.push(...data.items);
        if (!asOf) asOf = data.asOf;
        if (page * data.pageSize >= data.total) break;
        if (!asOf || data.pageSize <= 0 || !data.items.length) throw new Error('Incomplete report response. Please retry the export.');
        page++;
    }
    return [
        ['Reference', 'Finalized at (UTC)', 'Reason', 'Product', 'SKU', 'Type', 'Quantity', 'Unit cost (including extras)', 'Total loss', 'Currency', 'Write-off ID', 'Item ID'],
        ...rows.map(r => [r.reference, r.finalizedAt, reasons[r.reason], r.name, r.sku, r.type, r.quantity, r.unitCost, r.totalCost, currency, r.id, r.itemId])
    ].map(row => row.map(csvCell).join(',')).join('\r\n');
}
