/**
 * Decode HTML entities (&#NNN; and common named entities) to actual characters.
 * WooCommerce metadata often contains raw HTML entities that should display as symbols.
 */
export const decodeInvoiceEntities = (text: string): string => {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
};

/**
 * Safely converts any value to a displayable string.
 * Handles nested objects, arrays, and primitive types.
 * Decodes HTML entities in the final output.
 */
export const stringifyInvoiceValue = (val: unknown): string => {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return decodeInvoiceEntities(val);
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) return val.map((value) => stringifyInvoiceValue(value)).join(', ');
  if (typeof val === 'object') {
    const entries = Object.entries(val);
    if (entries.length === 0) return '';
    return entries
      .map(([, value]) => stringifyInvoiceValue(value))
      .filter(Boolean)
      .join(', ');
  }
  return String(val);
};

const EXCLUDED_KEY_PATTERNS = [
  /^_/,
  /^pa_/,
  /wcpa/i,
  /meta_data/i,
  /^reduced_stock/i,
  /label_map/i,
  /droppable/i,
  /^id$/i,
  /^key$/i,
];

const isExcludedInvoiceMetaKey = (key: string) =>
  EXCLUDED_KEY_PATTERNS.some((pattern) => pattern.test(key));

interface InvoiceMetaEntry {
  key?: string;
  value?: unknown;
  display_key?: string;
  display_value?: unknown;
}

export interface InvoiceLineItemLike {
  sku?: string;
  variation_id?: number;
  meta_data?: InvoiceMetaEntry[];
  [key: string]: unknown;
}

export interface InvoiceItemMeta {
  label: string;
  value: string;
}

/**
 * Extracts user-facing metadata from an order line item.
 * Filters out internal plugin/system keys and prevents duplicate labels.
 */
export const getInvoiceItemMeta = (item: InvoiceLineItemLike): InvoiceItemMeta[] => {
  const meta: InvoiceItemMeta[] = [];
  const seenLabels = new Set<string>();

  const addMeta = (label: string, value: string) => {
    const normalizedLabel = label.toLowerCase().trim();
    if (!seenLabels.has(normalizedLabel) && value.length > 0 && value.length < 200) {
      seenLabels.add(normalizedLabel);
      meta.push({ label: label.charAt(0).toUpperCase() + label.slice(1), value });
    }
  };

  if (item.sku) addMeta('SKU', item.sku);

  if (item.variation_id && item.variation_id > 0) {
    const attrs =
      item.meta_data?.filter((entry) => entry.key?.startsWith('pa_')) || [];

    attrs.forEach((attr) => {
      const label =
        attr.display_key || (attr.key || '').replace('pa_', '').replace(/_/g, ' ');
      const rawValue = attr.display_value || attr.value;
      addMeta(label, stringifyInvoiceValue(rawValue));
    });
  }

  const customMeta =
    item.meta_data?.filter((entry) => {
      const key = entry.key || '';
      if (isExcludedInvoiceMetaKey(key)) return false;
      if (key.startsWith('pa_')) return false;
      if (!entry.display_key && !entry.display_value) return false;
      return true;
    }) || [];

  customMeta.forEach((entry) => {
    const rawValue = entry.display_value || entry.value;
    const value = stringifyInvoiceValue(rawValue);
    if (value.length > 0) {
      const label = entry.display_key || (entry.key || '').replace(/_/g, ' ');
      addMeta(label, value);
    }
  });

  return meta;
};
