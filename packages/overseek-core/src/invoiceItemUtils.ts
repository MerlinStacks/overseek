/**
 * Decode HTML entities (&#NNN; and common named entities) to actual characters.
 * WooCommerce metadata often contains raw HTML entities that should display as symbols.
 */
export const decodeInvoiceEntities = (text: string): string => {
  const namedEntities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ensp: ' ',
    emsp: ' ',
    copy: '©',
    reg: '®',
    trade: '™',
    euro: '€',
    pound: '£',
    yen: '¥',
    cent: '¢',
    deg: '°',
    hellip: '…',
    ndash: '–',
    mdash: '—',
    lsquo: "'",
    rsquo: "'",
    ldquo: '"',
    rdquo: '"',
    bull: '•',
    middot: '·',
    eacute: 'é',
    egrave: 'è',
    ecirc: 'ê',
    euml: 'ë',
    aacute: 'á',
    agrave: 'à',
    acirc: 'â',
    atilde: 'ã',
    auml: 'ä',
    aring: 'å',
    iacute: 'í',
    igrave: 'ì',
    icirc: 'î',
    iuml: 'ï',
    oacute: 'ó',
    ograve: 'ò',
    ocirc: 'ô',
    otilde: 'õ',
    ouml: 'ö',
    uacute: 'ú',
    ugrave: 'ù',
    ucirc: 'û',
    uuml: 'ü',
    ntilde: 'ñ',
    ccedil: 'ç',
    yacute: 'ý',
    yuml: 'ÿ',
    szlig: 'ß',
    oslash: 'ø',
    aelig: 'æ',
    Eacute: 'É',
    Egrave: 'È',
    Ecirc: 'Ê',
    Euml: 'Ë',
    Aacute: 'Á',
    Agrave: 'À',
    Acirc: 'Â',
    Atilde: 'Ã',
    Auml: 'Ä',
    Aring: 'Å',
    Iacute: 'Í',
    Igrave: 'Ì',
    Icirc: 'Î',
    Iuml: 'Ï',
    Oacute: 'Ó',
    Ograve: 'Ò',
    Ocirc: 'Ô',
    Otilde: 'Õ',
    Ouml: 'Ö',
    Uacute: 'Ú',
    Ugrave: 'Ù',
    Ucirc: 'Û',
    Uuml: 'Ü',
    Ntilde: 'Ñ',
    Ccedil: 'Ç',
    Yacute: 'Ý',
    Oslash: 'Ø',
    AElig: 'Æ',
  };
  const decodeNumericEntity = (rawCode: string, radix: number, fallback: string) => {
    const codePoint = Number.parseInt(rawCode, radix);
    if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
      return fallback;
    }

    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return fallback;
    }
  };

  return text
    .replace(/&#(\d+);/g, (match, code) => decodeNumericEntity(code, 10, match))
    .replace(/&#x([0-9a-fA-F]+);/g, (match, code) => decodeNumericEntity(code, 16, match))
    .replace(/&([a-zA-Z][a-zA-Z0-9]+);?/g, (match, name) => namedEntities[name] ?? match);
};

const sanitizeInvoiceDisplayText = (text: string): string => {
  return decodeInvoiceEntities(text)
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/www\.\S+/gi, ' ')
    .replace(/\b\S*wp-content\/uploads\/\S*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Safely converts any value to a displayable string.
 * Handles nested objects, arrays, and primitive types.
 * Decodes HTML entities in the final output.
 */
export const stringifyInvoiceValue = (val: unknown): string => {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return sanitizeInvoiceDisplayText(val);
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
  name?: string;
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

export interface InvoiceOrderLike {
  meta_data?: InvoiceMetaEntry[];
  [key: string]: unknown;
}

const GIFT_WRAP_KEY_PATTERN = /(gift[\s_-]*wrap(?:p?ing)?|giftwrapp?ing)/i;

const isFalsyGiftWrapValue = (value: string) => {
  const normalized = value.trim().toLowerCase();
  return normalized === ''
    || normalized === '0'
    || normalized === 'false'
    || normalized === 'no'
    || normalized === 'none'
    || normalized === 'n/a';
};

export const getOrderGiftWrappingMeta = (order: InvoiceOrderLike): InvoiceItemMeta | null => {
  const rawData = order?.rawData as InvoiceOrderLike | undefined;
  const metaEntries = Array.isArray(order?.meta_data)
    ? order.meta_data
    : (Array.isArray(rawData?.meta_data) ? rawData.meta_data : []);
  for (const entry of metaEntries) {
    const rawKey = String(entry?.key || entry?.name || entry?.display_key || '').trim();
    if (!rawKey || !GIFT_WRAP_KEY_PATTERN.test(rawKey)) continue;

    const value = stringifyInvoiceValue(entry?.display_value ?? entry?.value).trim();
    if (isFalsyGiftWrapValue(value)) continue;

    const label = sanitizeInvoiceDisplayText(String(entry?.display_key || rawKey).replace(/_/g, ' ')) || 'Gift Wrapping';
    return {
      label: label.charAt(0).toUpperCase() + label.slice(1),
      value,
    };
  }

  return null;
};

/**
 * Extracts user-facing metadata from an order line item.
 * Filters out internal plugin/system keys and prevents duplicate labels.
 */
export const getInvoiceItemMeta = (item: InvoiceLineItemLike): InvoiceItemMeta[] => {
  const meta: InvoiceItemMeta[] = [];
  const seenEntries = new Set<string>();

  const addMeta = (label: string, value: string) => {
    const normalizedLabel = label.toLowerCase().trim();
    const normalizedValue = value.replace(/\s+/g, ' ').trim();
    if (!normalizedLabel || !normalizedValue) return;

    const dedupeKey = `${normalizedLabel}::${normalizedValue.toLowerCase()}`;
    if (seenEntries.has(dedupeKey)) return;

    seenEntries.add(dedupeKey);
    meta.push({
      label: label.charAt(0).toUpperCase() + label.slice(1),
      value: normalizedValue,
    });
  };

  if (item.sku) addMeta('SKU', item.sku);

  const attrs =
    item.meta_data?.filter((entry) => {
      const key = String(entry.key || '').toLowerCase();
      return key.startsWith('pa_') || key.startsWith('attribute_pa_');
    }) || [];

  attrs.forEach((attr) => {
    const fallbackLabel = (attr.key || '')
      .replace(/^attribute_pa_/i, '')
      .replace(/^pa_/i, '')
      .replace(/[_-]/g, ' ')
      .trim();
    const label = sanitizeInvoiceDisplayText(attr.display_key || fallbackLabel);
    const rawValue = attr.display_value || attr.value;
    addMeta(label, stringifyInvoiceValue(rawValue));
  });

  const customMeta =
    item.meta_data?.filter((entry) => {
      const key = String(entry.key || entry.name || '');
      const displayLabel = String(entry.display_key || '').trim();

      if (key && isExcludedInvoiceMetaKey(key)) {
        const labelLooksInternal = !displayLabel
          || isExcludedInvoiceMetaKey(displayLabel)
          || /^wcpa/i.test(displayLabel);
        if (labelLooksInternal) return false;
      }
      const loweredKey = key.toLowerCase();
      if (loweredKey.startsWith('pa_') || loweredKey.startsWith('attribute_pa_')) return false;

      const rawValue = entry.display_value ?? entry.value;
      const value = stringifyInvoiceValue(rawValue).trim();
      if (!value) return false;

      const label = sanitizeInvoiceDisplayText(String(entry.display_key || key));
      if (!label) return false;
      return true;
    }) || [];

  customMeta.forEach((entry) => {
    const rawValue = entry.display_value ?? entry.value;
    const value = stringifyInvoiceValue(rawValue);
    if (value.length > 0) {
      const baseLabel = entry.display_key || entry.key || entry.name || '';
      const label = sanitizeInvoiceDisplayText(String(baseLabel).replace(/_/g, ' '));
      addMeta(label, value);
    }
  });

  return meta;
};
