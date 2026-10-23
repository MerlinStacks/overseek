export function parseWooOrderId(value: unknown): number | null {
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value.trim()))) return null;
    const orderId = Number(value);
    // WooCommerce IDs are positive; local wooId/orderId columns are Prisma Ints.
    return Number.isInteger(orderId) && orderId > 0 && orderId <= 2147483647 ? orderId : null;
}

export function getPayloadWooOrderId(payload: unknown): number | null {
    const data = payload as Record<string, unknown> | null;
    return parseWooOrderId(data?.orderId ?? data?.order_id);
}

export function getPayloadWooOrderIdString(payload: unknown): string | null {
    const orderId = getPayloadWooOrderId(payload);
    return orderId === null ? null : String(orderId);
}
