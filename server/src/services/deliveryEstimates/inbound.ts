import { Prisma } from '@prisma/client';
import { attachReceiptProof } from './receiptProof';
import { stockDerivedBomItemWhere } from './stockDerivedBom';

export const MAX_INBOUND_TARGETS = 1001;
export const MAX_INBOUND_BATCHES = 1000;
// Bound source work as well as wire output, even if many lines share a date.
export const MAX_INBOUND_LINES = 1000;
type LeadSource = { accountId: string; leadTimeMin: number | null; leadTimeMax: number | null; leadTimeDefault: number | null };
type Target = { wooId: number; stockOwnerWooId: number | null; state: 'pending' | 'unsupported' | 'integrity_error'; supplierLead: { min: number; max: number } | null; batches: { dueDate: string; quantity: number }[] };
export type InboundPayload = { wooId: number; generatedAt: string; expiresAt: string; receiptSafety: 'unverified'; targets: Target[] };
type Source = {
    id: string; accountId: string; wooId: number; supplierId: string | null; supplier: LeadSource | null;
    // boms contains only stock-derived BOMs, not cost-only SupplierItem/labour BOMs.
    manageStock: boolean; rawData: unknown; boms: { id: string }[];
    variations: { wooId: number; productId: string; supplierId: string | null; supplier: LeadSource | null; manageStock: boolean; rawData: unknown }[];
};
type Line = { productId: string | null; variationWooId: number | null; quantity: number; purchaseOrder: { accountId: string; status: string; expectedDate: Date | null } };
const identity = (n: number) => Number.isSafeInteger(n) && n > 0;
const days = (n: unknown): n is number => Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 3650;
export function supplierLead(source: LeadSource | null, accountId: string) {
    if (!source) return { lead: null, invalid: false };
    if (source.accountId !== accountId) return { lead: null, invalid: true };
    const { leadTimeMin: min, leadTimeMax: max, leadTimeDefault: fallback } = source;
    if (min != null || max != null) return days(min) && days(max) && min <= max
        ? { lead: { min, max }, invalid: false } : { lead: null, invalid: true };
    return fallback == null ? { lead: null, invalid: false } : days(fallback)
        ? { lead: { min: fallback, max: fallback }, invalid: false } : { lead: null, invalid: true };
}

/** Pure complete replacement. No receipt acknowledgement or live readiness is inferred. */
export function projectInbound(wooId: number, product: Source | null, lines: Line[], now = new Date()): InboundPayload {
    if (!identity(wooId)) throw new Error('Invalid inbound parent identity');
    const payload: InboundPayload = { wooId, generatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), receiptSafety: 'unverified', targets: [] };
    if (!product) return payload;
    const errorTarget = (): Target => ({ wooId, stockOwnerWooId: null, state: 'integrity_error', supplierLead: null, batches: [] });
    const fail = () => ({ ...payload, targets: [errorTarget()] });
    if (product.wooId !== wooId || product.variations.length + 1 > MAX_INBOUND_TARGETS || lines.length > MAX_INBOUND_LINES) return fail();
    const lead = supplierLead(product.supplierId ? product.supplier : null, product.accountId);
    if (lead.invalid || (product.supplierId && !product.supplier)) return fail();
    const raw = product.rawData as Record<string, unknown> | null;
    const variable = raw?.type === 'variable';
    const unsupported = product.boms.length > 0 || !['simple', 'variable'].includes(String(raw?.type));
    const parentManaged = product.manageStock || raw?.manage_stock === true;
    const targets = new Map<number, Target>();
    targets.set(wooId, { wooId, stockOwnerWooId: unsupported || variable ? null : wooId, state: unsupported || variable ? 'unsupported' : 'pending', supplierLead: unsupported || variable ? null : lead.lead, batches: [] });
    for (const variation of product.variations) {
        if (!identity(variation.wooId) || variation.productId !== product.id || targets.has(variation.wooId) || !variable) return fail();
        const variationRaw = variation.rawData as Record<string, unknown> | null;
        const inherited = variationRaw?.manage_stock === 'parent' || (!variation.manageStock && variationRaw?.manage_stock !== true && parentManaged);
        const unknown = !variationRaw || ![true, false, 'parent'].includes(variationRaw.manage_stock as boolean | string);
        const blocked = unsupported || unknown || (inherited && !parentManaged);
        // Supplier inheritance is independent of stock ownership. An override with
        // no lead time stays unset; it must not fall back to the parent's supplier.
        const variationLead = variation.supplierId == null ? lead : supplierLead(variation.supplier, product.accountId);
        if (variationLead.invalid || (variation.supplierId != null && !variation.supplier)) return fail();
        targets.set(variation.wooId, { wooId: variation.wooId, stockOwnerWooId: blocked ? null : inherited ? wooId : variation.wooId, state: blocked ? 'unsupported' : 'pending', supplierLead: blocked ? null : variationLead.lead, batches: [] });
    }
    // One source pool per effective owner. Targets reference identical pools; consumers
    // allocate once per owner, never sum copies carried by sibling variations.
    const pools = new Map<number, Target['batches']>();
    for (const target of targets.values()) if (target.stockOwnerWooId != null) {
        if (!pools.has(target.stockOwnerWooId)) pools.set(target.stockOwnerWooId, []);
        target.batches = pools.get(target.stockOwnerWooId)!;
    }
    const today = now.toISOString().slice(0, 10);
    for (const line of lines) {
        if (line.purchaseOrder.accountId !== product.accountId || line.purchaseOrder.status !== 'ORDERED') continue;
        const target = targets.get(line.variationWooId ?? wooId);
        if (line.productId !== product.id || !target || !Number.isSafeInteger(line.quantity) || line.quantity <= 0 || line.quantity > 1_000_000) return fail();
        const batches = target.stockOwnerWooId == null ? (target.wooId === wooId && parentManaged && !unsupported ? pools.get(wooId) : undefined) : pools.get(target.stockOwnerWooId);
        if (!batches || !line.purchaseOrder.expectedDate) continue;
        const date = line.purchaseOrder.expectedDate;
        if (!Number.isFinite(date.getTime())) return fail();
        // Stored PO date label is UTC, independent of account/server timezone.
        const dueDate = date.toISOString().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return fail();
        if (dueDate < today) continue;
        const batch = batches.find(b => b.dueDate === dueDate);
        if (batch) { batch.quantity += line.quantity; if (batch.quantity > 1_000_000) return fail(); }
        else batches.push({ dueDate, quantity: line.quantity });
    }
    payload.targets = [...targets.values()];
    if ([...pools.values()].reduce((sum, batches) => sum + batches.length, 0) > MAX_INBOUND_BATCHES) return fail();
    for (const target of payload.targets) target.batches.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return payload;
}

/** Bounded nested reads; no supplier names, costs, SKU matching or SupplierItem inference. */
export async function buildInbound(tx: Prisma.TransactionClient, accountId: string, wooId: number) {
    const product = await tx.wooProduct.findFirst({ where: { accountId, wooId }, select: {
        id: true, accountId: true, wooId: true, supplierId: true, manageStock: true, rawData: true,
        supplier: { select: { accountId: true, leadTimeMin: true, leadTimeMax: true, leadTimeDefault: true } },
        boms: { where: { items: { some: stockDerivedBomItemWhere } }, take: 1, select: { id: true } },
        variations: { take: MAX_INBOUND_TARGETS, orderBy: { wooId: 'asc' }, select: {
            wooId: true, productId: true, supplierId: true, manageStock: true, rawData: true,
            supplier: { select: { accountId: true, leadTimeMin: true, leadTimeMax: true, leadTimeDefault: true } },
        } },
    } });
    const lines = product ? await tx.purchaseOrderItem.findMany({
        where: { productId: product.id, purchaseOrder: { accountId, status: 'ORDERED' } }, take: MAX_INBOUND_LINES + 1,
        select: { productId: true, variationWooId: true, quantity: true, purchaseOrder: { select: { accountId: true, status: true, expectedDate: true } } },
    }) : [];
    return attachReceiptProof(tx, accountId, projectInbound(wooId, product, lines));
}
