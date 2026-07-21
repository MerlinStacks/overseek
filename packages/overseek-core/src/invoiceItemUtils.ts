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
  /^estimate_details$/i,
  /^pi_item_/i,
  /^reduced_stock/i,
  /label_map/i,
  /droppable/i,
  /^id$/i,
  /^key$/i,
];

const isExcludedInvoiceMetaKey = (key: string) =>
  EXCLUDED_KEY_PATTERNS.some((pattern) => pattern.test(key));

const normalizeInvoiceMetaKey = (key: string) => key.toLowerCase().trim().replace(/[\s-]+/g, '_');

const isHiddenDeliveryEstimateMetaKey = (key: string) => {
  const normalized = normalizeInvoiceMetaKey(key);
  return normalized === 'estimate_details' || normalized.startsWith('pi_item_');
};

interface InvoiceMetaEntry {
  key?: string;
  name?: string;
  value?: unknown;
  display_key?: string;
  display_value?: unknown;
}

export interface InvoiceLineItemLike {
  sku?: string | null;
  variation_id?: number;
  meta_data?: InvoiceMetaEntry[];
  [key: string]: unknown;
}

export interface InvoiceItemMeta {
  label: string;
  value: string;
}

const PERSONALISEIT_CUSTOMISATION_KEY = '_oc_customisation';

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const parseMaybeJsonRecord = (value: unknown): Record<string, unknown> | null => {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return null;

  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const humanizePersonaliseItLabel = (value: unknown, fallback: string): string => {
  const raw = typeof value === 'string' ? value.trim() : '';
  const label = raw || fallback;
  return label.replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
};

const getPersonaliseItLayerMeta = (
  layer: Record<string, unknown>,
  label: string,
): InvoiceItemMeta[] => {
  const type = String(layer.type || '').toLowerCase();
  const input = isRecord(layer.input) ? layer.input : layer;
  const meta: InvoiceItemMeta[] = [];

  if (type === 'text' || type === 'textarea' || type === 'spotify') {
    const value = stringifyInvoiceValue(input.value).trim();
    if (value) meta.push({ label, value });

    if (type === 'text' || type === 'textarea') {
      const fontName = stringifyInvoiceValue(input.fontName ?? input.font_name).trim();
      const fontId = Number(input.fontId ?? input.font_id ?? 0);
      const font = fontName || (fontId > 0 ? `Font #${fontId}` : '');
      if (font) meta.push({ label: `${label} Font`, value: font });

      const colour = stringifyInvoiceValue(
        input.colorHex ?? input.colourHex ?? input.color ?? input.colour,
      ).trim();
      const colourName = stringifyInvoiceValue(input.colorName ?? input.colourName ?? input.color_name ?? input.colour_name).trim();
      const colourValue = colourName && colour ? `${colourName} (${colour})` : (colourName || colour);
      if (colourValue) meta.push({ label: `${label} Colour`, value: colourValue });
    }

    return meta;
  }

  if ((type === 'image' || type === 'clipmask') && Number(input.attachmentId || layer.artworkAttachmentId || 0) > 0) {
    return [{ label, value: 'Image uploaded' }];
  }

  if (type === 'clipart' && Number(input.clipartId || 0) > 0) {
    return [{ label, value: 'Clipart selected' }];
  }

  return meta;
};

const addPersonaliseItMeta = (
  meta: InvoiceItemMeta[],
  seenEntries: Set<string>,
  label: string,
  value: string,
) => {
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

export const getPersonaliseItItemMeta = (item: InvoiceLineItemLike): InvoiceItemMeta[] => {
  const meta: InvoiceItemMeta[] = [];
  const seenEntries = new Set<string>();
  const entries = Array.isArray(item.meta_data) ? item.meta_data : [];
  const customisationEntry = entries.find((entry) => String(entry?.key || entry?.name || '') === PERSONALISEIT_CUSTOMISATION_KEY);
  const customisation = parseMaybeJsonRecord(customisationEntry?.value);
  if (!customisation) return meta;

  const designVariantLabel = stringifyInvoiceValue(customisation.designVariantLabel).trim();
  if (designVariantLabel) {
    addPersonaliseItMeta(meta, seenEntries, 'Artwork Option', designVariantLabel);
  }

  const renderSpec = isRecord(customisation.renderSpec) ? customisation.renderSpec : null;
  const areas = isRecord(renderSpec?.areas) ? renderSpec.areas : null;
  if (areas) {
    const beforeAreaMetaCount = meta.length;
    Object.values(areas).forEach((area) => {
      if (!isRecord(area) || !Array.isArray(area.layers)) return;

      area.layers.forEach((rawLayer) => {
        if (!isRecord(rawLayer)) return;
        const label = humanizePersonaliseItLabel(rawLayer.label, `Layer ${String(rawLayer.id || '').trim() || rawLayer.type || ''}`);
        getPersonaliseItLayerMeta(rawLayer, label).forEach((entry) => {
          addPersonaliseItMeta(meta, seenEntries, entry.label, entry.value);
        });
      });
    });

    if (meta.length > beforeAreaMetaCount) return meta;
  }

  const layers = isRecord(customisation.layers) ? customisation.layers : null;
  if (layers) {
    Object.entries(layers).forEach(([layerId, rawLayer]) => {
      if (!isRecord(rawLayer)) return;
      const label = humanizePersonaliseItLabel(rawLayer.label, `Layer ${layerId}`);
      getPersonaliseItLayerMeta(rawLayer, label).forEach((entry) => {
        addPersonaliseItMeta(meta, seenEntries, entry.label, entry.value);
      });
    });

    if (meta.length > 0) return meta;
  }

  Object.entries(customisation).forEach(([areaKey, rawArea]) => {
    if (!isRecord(rawArea) || !('text' in rawArea)) return;

    const areaLabel = humanizePersonaliseItLabel(areaKey, areaKey);
    const label = `Personalisation (${areaLabel.charAt(0).toUpperCase()}${areaLabel.slice(1)})`;
    const value = stringifyInvoiceValue(rawArea.text).trim();
    if (value) addPersonaliseItMeta(meta, seenEntries, label, value);

    const fontName = stringifyInvoiceValue(rawArea.fontName ?? rawArea.font_name).trim();
    const fontId = Number(rawArea.fontId ?? rawArea.font_id ?? 0);
    const font = fontName || (fontId > 0 ? `Font #${fontId}` : '');
    if (font) addPersonaliseItMeta(meta, seenEntries, `${label} Font`, font);

    const colour = stringifyInvoiceValue(rawArea.colorHex ?? rawArea.colourHex ?? rawArea.color ?? rawArea.colour).trim();
    const colourName = stringifyInvoiceValue(rawArea.colorName ?? rawArea.colourName ?? rawArea.color_name ?? rawArea.colour_name).trim();
    const colourValue = colourName && colour ? `${colourName} (${colour})` : (colourName || colour);
    if (colourValue) addPersonaliseItMeta(meta, seenEntries, `${label} Colour`, colourValue);
  });

  return meta;
};

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

  getPersonaliseItItemMeta(item).forEach((entry) => addMeta(entry.label, entry.value));

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

      if (isHiddenDeliveryEstimateMetaKey(key) || isHiddenDeliveryEstimateMetaKey(displayLabel)) return false;

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
