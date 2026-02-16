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
    const metaData = order.meta_data as Array<{ key: string; value: unknown }> | undefined;

    if (!Array.isArray(metaData)) return [];

    const items: TrackingItem[] = [];

    // --- AST / WooCommerce Shipment Tracking plugin ---
    const astEntry = metaData.find(
        (m) => m.key === '_wc_shipment_tracking_items'
    );

    if (astEntry && Array.isArray(astEntry.value)) {
        for (const entry of astEntry.value) {
            if (!entry || typeof entry !== 'object') continue;
            const e = entry as Record<string, unknown>;
            const trackingNumber = String(e.tracking_number ?? '').trim();
            if (!trackingNumber) continue;

            items.push({
                provider: String(e.tracking_provider ?? e.custom_tracking_provider ?? 'Unknown').trim(),
                trackingNumber,
                trackingUrl: e.tracking_link ? String(e.tracking_link).trim() : null,
                dateShipped: e.date_shipped ? String(e.date_shipped).trim() : null,
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
        const val = meta.value != null ? String(meta.value).trim() : '';
        if (!val) continue;

        if (key.includes('tracking_number') || key === '_tracking_number') {
            fallbackNumber = val;
        } else if (key.includes('tracking_url') || key.includes('tracking_link') || key === '_tracking_url') {
            fallbackUrl = val;
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
