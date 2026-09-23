import { prisma } from '../../utils/prisma';
import { enrichOrderLineItemPermalinks } from '../orderLineItemContext';

const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Resolve only an explicitly identified order. A failed lookup must suppress raw promises. */
export async function hydrateOrderEmailContext(accountId: string, context: Record<string, any>): Promise<Record<string, any> | undefined> {
    // Billing and generic IDs are also present on Woo customers. They are never
    // evidence of an order, even if an order with that ID exists in this account.
    const hasOrderMarkers = (v: Record<string, any>) =>
        Array.isArray(v.line_items) || Array.isArray(v.lineItems) || Array.isArray(v.items)
        || (typeof v.order_key === 'string' && v.order_key.startsWith('wc_order_'));
    const wrapper = [context.order, context.rawOrder].find(record);
    const raw = record(context.rawData) && hasOrderMarkers(context.rawData) ? context.rawData : undefined;
    const reference = context.orderId ?? context.order_id ?? context.wooOrderId ?? context.woo_order_id;
    // Reference events (shipment/artwork/etc.) own their id/status. Never overlay
    // those event fields onto the referenced order's raw data.
    const source = wrapper || raw || (reference == null && hasOrderMarkers(context) ? context : undefined);
    const candidate = source
        ? source.wooId ?? source.woo_id ?? source.id ?? source.internal_id ?? source.orderId ?? source.order_id ?? reference
        : reference;
    if (candidate === undefined || candidate === null || candidate === '') {
        return source ? enrichOrderLineItemPermalinks(accountId, { ...source, deliveryEstimateSnapshot: null }) : undefined;
    }
    const numeric = typeof candidate === 'number' || (typeof candidate === 'string' && /^\d+$/.test(candidate));
    if ((!numeric && typeof candidate !== 'string') || (numeric && (!Number.isSafeInteger(Number(candidate)) || Number(candidate) <= 0))) {
        return source ? enrichOrderLineItemPermalinks(accountId, { ...source, deliveryEstimateSnapshot: null }) : undefined;
    }
    const order = await prisma.wooOrder.findFirst({
        where: { accountId, ...(numeric ? { wooId: Number(candidate) } : { id: String(candidate) }) },
        select: { rawData: true, deliveryEstimateSnapshot: true }
    });
    if (!order && !source) return undefined;
    return enrichOrderLineItemPermalinks(accountId, {
        ...(record(order?.rawData) ? order.rawData : {}),
        ...source,
        deliveryEstimateSnapshot: order?.deliveryEstimateSnapshot ?? null
    });
}
