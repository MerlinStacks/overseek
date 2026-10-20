/**
 * Order Tracking Extraction Utility
 *
 * Why: WooCommerce tracking plugins (AST, WooCommerce Shipment Tracking) store
 * shipment data inside order `meta_data` under known keys. This utility extracts
 * that data into a normalised format so the API can surface it cleanly.
 */

/** Normalised tracking item returned to the client. */
export interface TrackingItem {
    provider: string;
    trackingNumber: string;
    trackingUrl: string | null;
    dateShipped: string | null;
}

function scalar(value: unknown): string {
    return typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function trackingUrl(value: unknown): string | null {
    const text = scalar(value);
    try {
        const url = new URL(text);
        return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
}

function shippedDate(value: unknown): string | null {
    const text = scalar(value);
    if (!text) return null;
    const numeric = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
    const date = new Date(numeric === null ? text : numeric < 1e12 ? numeric * 1000 : numeric);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/**
 * Extracts tracking items from WooCommerce order raw data.
 *
 * Supports:
 * - AST (Advanced Shipment Tracking) / WooCommerce Shipment Tracking:
 *   `meta_data[].key === '_wc_shipment_tracking_items'`
 * - Generic fallback: scans for keys containing `tracking_number` / `tracking_url`
 */
export function extractOrderTracking(rawData: unknown): TrackingItem[] {
    if (!rawData || typeof rawData !== 'object') return [];

    const order = rawData as Record<string, unknown>;
    if (!Array.isArray(order.meta_data)) return [];
    const metaData = order.meta_data.filter((meta): meta is { key: string; value: unknown } =>
        !!meta && typeof meta === 'object' && typeof meta.key === 'string');

    const items: TrackingItem[] = [];

    // --- AST / WooCommerce Shipment Tracking plugin ---
    const astEntry = metaData.find(
        (m) => m.key === '_wc_shipment_tracking_items'
    );

    if (astEntry && Array.isArray(astEntry.value)) {
        for (const entry of astEntry.value) {
            if (!entry || typeof entry !== 'object') continue;
            const e = entry as Record<string, unknown>;
            const trackingNumber = scalar(e.tracking_number);
            if (!trackingNumber) continue;

            items.push({
                provider: scalar(e.tracking_provider) || scalar(e.custom_tracking_provider) || 'Unknown',
                trackingNumber,
                trackingUrl: trackingUrl(e.tracking_link) || trackingUrl(e.custom_tracking_link),
                dateShipped: shippedDate(e.date_shipped),
            });
        }
    }

    // If AST found results, return early — no need for fallback scanning
    if (items.length > 0) return items;

    // --- Fallback: scan meta_data for generic tracking keys ---
    let fallbackNumber: string | null = null;
    let fallbackUrl: string | null = null;
    let fallbackProvider: string | null = null;

    for (const meta of metaData) {
        const key = String(meta.key).toLowerCase();
        const val = scalar(meta.value);
        if (!val) continue;

        if (key.includes('tracking_number') || key === '_tracking_number') {
            fallbackNumber = val;
        } else if (key.includes('tracking_url') || key.includes('tracking_link') || key === '_tracking_url') {
            fallbackUrl = trackingUrl(val);
        } else if (key.includes('tracking_provider') || key.includes('shipping_provider')) {
            fallbackProvider = val;
        }
    }

    if (fallbackNumber) {
        items.push({
            provider: fallbackProvider ?? 'Unknown',
            trackingNumber: fallbackNumber,
            trackingUrl: fallbackUrl,
            dateShipped: null,
        });
    }

    return items;
}
