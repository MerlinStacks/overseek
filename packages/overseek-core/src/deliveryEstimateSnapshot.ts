/** Existing-order promises only. No live settings, products or date calculations. */
export type DeliveryDateRange = { min: string; max: string };
export type DeliveryEstimateSnapshot = {
    version: 1;
    capturedAt: string;
    timezone: string;
    fulfilmentType: 'delivery' | 'collection';
    method: { methodId: string; instanceId: number; rateId: string; title: string };
    dispatch: DeliveryDateRange;
    delivery: DeliveryDateRange | null;
    collection: DeliveryDateRange | null;
};
export type DeliveryEstimateEmailOptions = {
    heading?: string;
    showDispatch?: boolean;
    textColor?: string;
    mutedColor?: string;
    backgroundColor?: string;
    accentColor?: string;
    fontFamily?: string;
};

const META_KEY = '_overseek_delivery_estimate_v1';
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (v: object, k: string) => Object.prototype.hasOwnProperty.call(v, k);
const keys = (v: unknown, names: string[]): v is Record<string, unknown> => record(v) && Object.keys(v).length === names.length && names.every(k => own(v, k));
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v);
function date(v: unknown): v is string {
    if (typeof v !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v) || v.startsWith('0000')) return false;
    const parsed = new Date(`${v}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v;
}
function range(v: unknown): v is DeliveryDateRange {
    return keys(v, ['min', 'max']) && date(v.min) && date(v.max) && v.min <= v.max;
}

export function parseDeliveryEstimateSnapshot(value: unknown): DeliveryEstimateSnapshot | null {
    try {
        const encoded = typeof value === 'string' ? value : JSON.stringify(value);
        if (!encoded || encoded.length > 8192 || new TextEncoder().encode(encoded).length > 8192) return null;
        const v: unknown = typeof value === 'string' ? JSON.parse(encoded) : value;
        if (!keys(v, ['version', 'capturedAt', 'timezone', 'fulfilmentType', 'method', 'dispatch', 'delivery', 'collection']) || v.version !== 1) return null;
        if (typeof v.capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(v.capturedAt) || !date(v.capturedAt.slice(0, 10)) || !Number.isFinite(Date.parse(v.capturedAt))) return null;
        if (!text(v.timezone, 100) || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(v.timezone)) return null;
        new Intl.DateTimeFormat('en-AU', { timeZone: v.timezone });
        const m = v.method;
        if (!keys(m, ['methodId', 'instanceId', 'rateId', 'title']) || !text(m.methodId, 100) || !/^[a-zA-Z0-9_\-]+$/.test(m.methodId) || !Number.isSafeInteger(m.instanceId) || (m.instanceId as number) < 0 || !text(m.rateId, 200) || !/^[\x21-\x7e]{1,200}$/.test(m.rateId) || !text(m.title, 300)) return null;
        // Opaque Woo rate ID. Discrete metadata is authoritative; parsing is not eligibility certification.
        if (!range(v.dispatch)) return null;
        const arrival = v.fulfilmentType === 'delivery' && v.collection === null ? v.delivery
            : v.fulfilmentType === 'collection' && v.delivery === null ? v.collection : null;
        if (!range(arrival) || arrival.min < v.dispatch.min || arrival.max < v.dispatch.max) return null;
        return JSON.parse(encoded) as DeliveryEstimateSnapshot;
    } catch { return null; }
}

export function getOrderDeliveryEstimateSnapshot(order: unknown): DeliveryEstimateSnapshot | null {
    if (!record(order)) return null;
    if (own(order, 'deliveryEstimateSnapshot')) return parseDeliveryEstimateSnapshot(order.deliveryEstimateSnapshot);
    const raw = record(order.rawData) ? order.rawData : undefined;
    if (raw && own(raw, 'deliveryEstimateSnapshot')) return parseDeliveryEstimateSnapshot(raw.deliveryEstimateSnapshot);
    let snapshot: DeliveryEstimateSnapshot | null = null;
    for (const metadata of [order.meta_data, raw?.meta_data]) {
        if (metadata !== undefined && !Array.isArray(metadata)) return null;
        for (const entry of (metadata || []) as unknown[]) {
            if (!record(entry) || entry.key !== META_KEY) continue;
            const parsed = parseDeliveryEstimateSnapshot(entry.value);
            if (!parsed || (snapshot && canonical(snapshot) !== canonical(parsed))) return null;
            snapshot = parsed;
        }
    }
    return snapshot;
}
function canonical(s: DeliveryEstimateSnapshot): string {
    return JSON.stringify([s.version, s.capturedAt, s.timezone, s.fulfilmentType, s.method.methodId, s.method.instanceId, s.method.rateId, s.method.title, s.dispatch.min, s.dispatch.max, s.delivery?.min, s.delivery?.max, s.collection?.min, s.collection?.max]);
}
const formatDate = (v: string) => new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${v}T00:00:00Z`));
const formatRange = (r: DeliveryDateRange | null) => !r ? '' : r.min === r.max ? formatDate(r.min) : `${formatDate(r.min)} – ${formatDate(r.max)}`;
export function getDeliveryEstimateTagValues(order: unknown): Record<string, string> {
    const s = getOrderDeliveryEstimateSnapshot(order);
    const values: Record<string, string> = {};
    for (const branch of ['Delivery', 'Dispatch', 'Collection'] as const) {
        const r = s?.[branch.toLowerCase() as 'delivery' | 'dispatch' | 'collection'] || null;
        values[`order.estimated${branch}`] = formatRange(r);
        values[`order.estimated${branch}Start`] = r ? formatDate(r.min) : '';
        values[`order.estimated${branch}End`] = r ? formatDate(r.max) : '';
    }
    values['order.estimatedFulfilment'] = formatRange(s ? s[s.fulfilmentType] : null);
    return values;
}
// Encode braces too: escaped merchant text must not become a second-pass merge token.
const escape = (s: string) => s.replace(/[&<>"'{}]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '{': '&#123;', '}': '&#125;' }[c]!));
const color = (v: unknown, fallback: string) => typeof v === 'string' && /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(v) ? v : fallback;
// Font stacks only: no URLs, functions, declarations, controls or arbitrary CSS.
const font = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9 ,"'_-]{1,160}$/.test(value) && value.trim()
    ? escape(value.trim()) : 'Arial, Helvetica, sans-serif';
export function renderDeliveryEstimateEmailBlock(order: unknown, options: DeliveryEstimateEmailOptions = {}): string {
    const s = getOrderDeliveryEstimateSnapshot(order);
    if (!s) return '';
    const heading = text(options.heading, 300) ? options.heading : `Estimated ${s.fulfilmentType}`;
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background-color:${color(options.backgroundColor, '#f8fafc')};border-left:3px solid ${color(options.accentColor, '#64748b')};"><tbody><tr><td style="padding:16px;font-family:${font(options.fontFamily)};color:${color(options.textColor, '#0f172a')};font-size:14px;line-height:1.5;"><strong>${escape(heading)}</strong><br>${escape(formatRange(s[s.fulfilmentType]))}${options.showDispatch === true ? `<br><span style="color:${color(options.mutedColor, '#64748b')};font-size:12px;">Estimated dispatch: ${escape(formatRange(s.dispatch))}</span>` : ''}</td></tr></tbody></table>`;
}
export function resolveDeliveryEstimateEmailTokens(template: string, order: unknown): string {
    const values = getDeliveryEstimateTagValues(order);
    let result = template.replace(/\{\{\s*delivery_estimate\b([^}]*?)\}\}/g, (_match, params: string) => {
        const options: DeliveryEstimateEmailOptions = {};
        if (params.length <= 4096) {
            const seen = new Set<string>();
            for (const part of params.trim().split(/\s+/)) {
                const match = /^(heading|showDispatch|textColor|mutedColor|backgroundColor|accentColor|fontFamily):(.*)$/.exec(part);
                if (!match || seen.has(match[1])) continue;
                seen.add(match[1]);
                try {
                    const value = decodeURIComponent(match[2]);
                    if (match[1] === 'showDispatch') options.showDispatch = value === 'true';
                    else if (value.length <= 300) options[match[1] as Exclude<keyof DeliveryEstimateEmailOptions, 'showDispatch'>] = value;
                } catch { /* Invalid URI values use restrained defaults. */ }
            }
        }
        return renderDeliveryEstimateEmailBlock(order, options);
    });
    for (const [tag, value] of Object.entries(values)) {
        const pattern = new RegExp(`\\{\\{\\s*${tag.replace('.', '\\.')}\\s*(?:\\|\\s*fallback\\s*:\\s*((?:"[^"]*")|(?:'[^']*')|[^}]*?))?\\s*\\}\\}`, 'g');
        result = result.replace(pattern, (_match, fallback: string | undefined) => {
            let label = (fallback || '').trim();
            if ((label.startsWith('"') && label.endsWith('"')) || (label.startsWith("'") && label.endsWith("'"))) label = label.slice(1, -1);
            return escape(value || label);
        });
    }
    return result;
}
