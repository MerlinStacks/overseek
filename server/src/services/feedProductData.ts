import { normalizeTimezone } from '../utils/timezone';
import { variantAttributeField } from './feedVariants';

type RawProduct = Record<string, any>;

export function feedMeta(raw: RawProduct, keys: string[]): string | null {
    for (const key of keys) {
        const direct = raw?.[key];
        if (direct != null && String(direct).trim() !== '') return String(direct).trim();
    }
    const names = new Set(keys.map((key) => key.toLowerCase()));
    const entry = Array.isArray(raw?.meta_data)
        ? raw.meta_data.find((item: any) => names.has(String(item?.key).toLowerCase()) && item?.value != null && String(item.value).trim() !== '')
        : null;
    return entry ? String(entry.value).trim() : null;
}

export function feedIdentifier(raw: RawProduct, type: 'gtin' | 'mpn'): string | null {
    return feedMeta(raw, type === 'gtin'
        ? ['global_unique_id', 'gtin', '_gtin', '_global_unique_id', '_wpm_gtin_code', '_alg_ean', 'ean', 'upc']
        : ['mpn', '_mpn', '_wpm_mpn']);
}

export function validGtin(value: string): boolean {
    if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value) || /^0+$/.test(value)) return false;
    const digits = value.split('').map(Number);
    const check = digits.pop()!;
    const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
    return (10 - sum % 10) % 10 === check;
}

/** Missing identifiers are unknown, not proof that the manufacturer assigned none. */
export function feedIdentifierExists(raw: RawProduct): string | null {
    const explicit = feedMeta(raw, ['identifier_exists', '_identifier_exists']);
    if (explicit != null) {
        if (/^(?:no|false|0)$/i.test(explicit)) return 'no';
        if (/^(?:yes|true|1)$/i.test(explicit)) return 'yes';
        return explicit; // Keep invalid user data visible to diagnostics.
    }
    return feedIdentifier(raw, 'gtin') || feedIdentifier(raw, 'mpn') ? 'yes' : null;
}

export function feedAttribute(raw: RawProduct, field: string): string | null {
    const names = field === 'color' ? ['color', 'colour'] : [field];
    const direct = feedMeta(raw, names);
    if (direct) return direct;
    const attr = Array.isArray(raw?.attributes) ? raw.attributes.find((item: any) =>
        variantAttributeField(item) === field,
    ) : null;
    if (attr?.option) return String(attr.option);
    // A parent with several choices does not describe one particular variant.
    return Array.isArray(attr?.options) && attr.options.length === 1 ? String(attr.options[0]) : null;
}

export function feedAmount(value: unknown): number | null {
    if (value == null || String(value).trim() === '' || !/^\d+(?:\.\d+)?$/.test(String(value).trim())) return null;
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

/** Parse explicit offsets or Woo local timestamps in the account's IANA zone. */
export function feedDate(value: unknown, timezone = 'UTC'): Date | null {
    if (typeof value !== 'string') return null;
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?(Z|[+-]\d{2}:?\d{2})?$/);
    if (!match) return null;
    const [, y, m, d, h = '00', min = '00', sec = '00', offset] = match;
    const wall = `${y}-${m}-${d}T${h}:${min}:${sec}`;
    const target = Date.parse(`${wall}Z`);
    if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 19) !== wall) return null;
    if (offset) {
        const parsed = new Date(`${wall}${offset}`);
        return Number.isFinite(parsed.getTime()) ? parsed : null;
    }
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: normalizeTimezone(timezone), year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    let instant = target;
    for (let i = 0; i < 4; i++) {
        const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
        const represented = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
        const correction = target - represented;
        if (!correction) return new Date(instant);
        instant += correction;
    }
    return null; // Reject non-existent DST wall times rather than guessing.
}

function saleDate(raw: RawProduct, endpoint: 'from' | 'to', timezone: string): { date: Date | null; supplied: boolean } {
    const gmt = raw[`date_on_sale_${endpoint}_gmt`];
    const local = raw[`date_on_sale_${endpoint}`];
    const supplied = !!(gmt || local);
    const date = gmt ? feedDate(/[Zz]|[+-]\d{2}:?\d{2}$/.test(gmt) ? gmt : `${gmt}Z`) : feedDate(local, timezone);
    return { date, supplied };
}

const iso = (date: Date): string => date.toISOString().replace('.000Z', 'Z');

export function feedPricing(product: { price?: unknown; rawData?: unknown }, timezone = 'UTC', now = new Date()) {
    const raw = (product.rawData || {}) as RawProduct;
    const current = feedAmount(product.price ?? raw.price);
    const regular = feedAmount(raw.regular_price);
    const sale = feedAmount(raw.sale_price);
    const start = saleDate(raw, 'from', timezone);
    const end = saleDate(raw, 'to', timezone);
    const validWindow = (!start.supplied || !!start.date) && (!end.supplied || !!end.date)
        && (!start.date || !end.date || start.date <= end.date);
    const active = validWindow && (!start.date || start.date <= now) && (!end.date || now <= end.date)
        && raw.on_sale !== false && regular != null && sale != null && sale < regular
        && (current === sale || (current == null && raw.on_sale === true));
    return {
        price: active ? regular : current,
        salePrice: active ? sale : null,
        salePriceEffectiveDate: active && start.date && end.date ? `${iso(start.date)}/${iso(end.date)}` : null,
        invalidSaleWindow: !validWindow,
    };
}

export function feedAvailabilityDate(raw: RawProduct, timezone = 'UTC'): string | null {
    const value = feedMeta(raw, ['availability_date', '_availability_date', 'availabilityDate']);
    if (!value) return null;
    const date = feedDate(value, timezone);
    return date ? iso(date) : value;
}
