export function parseWooOrderId(value: unknown): number | null {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
    return null;
}

export function getPayloadWooOrderId(payload: unknown): number | null {
    const data = payload as Record<string, unknown> | null;
    return parseWooOrderId(data?.orderId ?? data?.order_id);
}

export function getPayloadWooOrderIdString(payload: unknown): string | null {
    const orderId = getPayloadWooOrderId(payload);
    return orderId === null ? null : String(orderId);
}
