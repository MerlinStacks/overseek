/**
 * Shared utilities for invoice item metadata extraction.
 * Used by both InvoiceRenderer (HTML preview) and InvoiceGenerator (PDF).
 */

/**
 * Safely converts any value to a displayable string.
 * Handles nested objects, arrays, and primitive types.
 */
export const safeStringify = (val: any): string => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (Array.isArray(val)) return val.map(v => safeStringify(v)).join(', ');
    if (typeof val === 'object') {
        const entries = Object.entries(val);
        if (entries.length === 0) return '';
        return entries.map(([_k, v]) => safeStringify(v)).filter(Boolean).join(', ');
    }
    return String(val);
};

// Keys to always exclude from invoice line item metadata (internal plugin/system keys)
const EXCLUDED_KEY_PATTERNS = [
    /^_/,                    // Internal underscore-prefixed keys
    /^pa_/,                  // Already handled separately for variations
    /wcpa/i,                 // WCPA plugin internal data
    /meta_data/i,            // Nested meta references
    /^reduced_stock/i,       // Stock management internal
    /label_map/i,            // Internal mappings
    /droppable/i,            // UI state fields
    /^id$/i,                 // Internal IDs
    /^key$/i,                // Internal keys
];

const isExcludedKey = (key: string) =>
    EXCLUDED_KEY_PATTERNS.some(pattern => pattern.test(key));

/**
 * Extracts user-facing metadata from an order line item.
 * Filters out internal plugin/system keys and returns label/value pairs.
 * Prevents duplicate entries by tracking seen labels.
 */
export const getItemMeta = (item: any): { label: string; value: string }[] => {
    const meta: { label: string; value: string }[] = [];
    const seenLabels = new Set<string>();

    const addMeta = (label: string, value: string) => {
        const normalizedLabel = label.toLowerCase().trim();
        if (!seenLabels.has(normalizedLabel) && value.length > 0 && value.length < 200) {
            seenLabels.add(normalizedLabel);
            meta.push({ label: label.charAt(0).toUpperCase() + label.slice(1), value });
        }
    };

    // Standard fields
    if (item.sku) addMeta('SKU', item.sku);

    // Variation attributes (pa_ prefixed keys)
    if (item.variation_id && item.variation_id > 0) {
        const attrs = item.meta_data?.filter((m: any) =>
            m.key?.startsWith('pa_')
        ) || [];
        attrs.forEach((attr: any) => {
            const label = attr.display_key || attr.key.replace('pa_', '').replace(/_/g, ' ');
            const rawValue = attr.display_value || attr.value;
            const strValue = safeStringify(rawValue);
            addMeta(label, strValue);
        });
    }

    // Custom meta fields — strict filtering (non pa_ keys with display values)
    const customMeta = item.meta_data?.filter((m: any) => {
        const key = m.key || '';
        if (isExcludedKey(key)) return false;
        if (key.startsWith('pa_')) return false;
        if (!m.display_key && !m.display_value) return false;
        return true;
    }) || [];

    customMeta.forEach((m: any) => {
        const rawValue = m.display_value || m.value;
        const strValue = safeStringify(rawValue);
        if (strValue.length > 0) {
            const label = m.display_key || m.key.replace(/_/g, ' ');
            addMeta(label, strValue);
        }
    });

    return meta;
};

/**
 * Resolves handlebars-style template placeholders against order data.
 * Supports both top-level (`{{number}}`) and dot-notation (`{{billing.email}}`).
 */
export const resolveHandlebars = (text: string, data: Record<string, any>): string => {
    return text.replace(/{{(.*?)}}/g, (_: any, key: string) => {
        const k = key.trim();
        if (k.includes('.')) {
            const parts = k.split('.');
            let value: any = data;
            for (const part of parts) {
                value = value?.[part];
            }
            return value != null ? String(value) : `{{${k}}}`;
        }
        return data[k] != null ? String(data[k]) : `{{${k}}}`;
    });
};
