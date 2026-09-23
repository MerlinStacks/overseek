import { z } from 'zod';

/** The receiver limits the whole JSON envelope, not only its settings document. */
export const DELIVERY_INPUT_MAX_BYTES = 512 * 1024;

/** Canonicalise ICU aliases before persistence so PHP receives a portable zone ID. */
export function canonicalDeliveryTimezone(value: string): string {
    return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
}

const days = z.number().int().min(0).max(3650);
const rangeFields = { productionMinDays: days.nullable(), productionMaxDays: days.nullable() };
const validRange = (range: Partial<ProductionRange>) =>
    range.productionMinDays === null ? range.productionMaxDays === null :
        range.productionMinDays !== undefined && range.productionMaxDays != null && range.productionMinDays <= range.productionMaxDays;
export type ProductionRange = { productionMinDays: number | null; productionMaxDays: number | null };
export const productionRangeSchema = z.object(rangeFields).strict().refine(validRange, 'Provide paired nulls or an ordered production range');
export const productInputSchema = z.object({
    ...rangeFields,
    variations: z.array(z.object({ id: z.string().min(1).max(128), ...rangeFields }).strict()
        .refine(validRange, 'Provide paired nulls or an ordered production range')).max(1000).optional(),
}).strict().refine(validRange, 'Provide paired nulls or an ordered production range')
    .refine(value => new Set(value.variations?.map(v => v.id)).size === (value.variations?.length ?? 0), 'Duplicate variation IDs');

const weekdays = z.array(z.number().int().min(0).max(6)).min(1).max(7)
    .refine(values => new Set(values).size === values.length, 'Duplicate weekdays');
const identitySchema = z.object({
    methodId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    instanceId: z.number().int().min(0).max(2147483647),
    mappingKind: z.enum(['core_instance', 'all_provider_rates', 'exact_rate']).optional(),
    rateId: z.string().regex(/^[\x21-\x7e]{1,200}(?![\s\S])/).optional(),
}).strict();
/** Woo identity deliberately excludes editable labels and unverified provider rule IDs. */
export const methodKey = (method: z.infer<typeof identitySchema>) => `${method.methodId}:${method.instanceId}${method.mappingKind === 'exact_rate' ? `|exact_rate|${method.rateId}` : method.mappingKind === 'all_provider_rates' ? '|all_provider_rates' : ''}`;
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable();
export const settingsSchema = z.object({
    cutoffTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timezone: z.string().min(1).max(100).refine(value => {
        try { new Intl.DateTimeFormat('en', { timeZone: value }); return !/^[+-]/.test(value); }
        catch { return false; }
    }, 'Invalid IANA timezone').transform(canonicalDeliveryTimezone),
    fallbackSupplierLeadTimeDays: days,
    productionWeekdays: weekdays,
    transitWeekdays: weekdays,
    closures: z.array(z.object({ date: dateOnly, scope: z.enum(['work', 'transit', 'both']), label: z.string().max(100).optional() }).strict()).max(3660),
    shippingMethods: z.array(identitySchema.extend({
        allRatesConfirmed: z.boolean().optional(),
        zoneId: z.number().int().min(0).max(2147483647),
        zoneName: z.string().max(200), title: z.string().min(1).max(200),
        enabled: z.boolean(), minTransitDays: days, maxTransitDays: days,
        fulfilmentType: z.enum(['delivery', 'collection']),
    }).refine(value => value.minTransitDays <= value.maxTransitDays, 'Transit range is reversed')).max(500),
    defaultMethod: identitySchema.nullable(),
    branding: z.object({
        textColor: colour, accentColor: colour, backgroundColor: colour,
        fontSize: z.number().int().min(12).max(20),
        spacing: z.enum(['compact', 'comfortable']), showIcon: z.boolean(),
    }).strict(),
}).strict().superRefine((value, ctx) => {
    value.shippingMethods.forEach((row, index) => {
        const kind = row.mappingKind ?? 'core_instance';
        if ((kind === 'exact_rate') !== (row.rateId !== undefined) ||
            (kind === 'all_provider_rates' && row.allRatesConfirmed !== true) ||
            (kind !== 'all_provider_rates' && row.allRatesConfirmed === true)) {
            ctx.addIssue({ code: 'custom', path: ['shippingMethods', index], message: 'Exact mappings require an actual rate ID; instance-wide mappings require explicit confirmation.' });
        }
    });
    if (value.defaultMethod?.mappingKind === 'exact_rate' && !value.defaultMethod.rateId) ctx.addIssue({ code: 'custom', path: ['defaultMethod'], message: 'Exact default requires rate ID' });
    if (value.defaultMethod?.rateId && (!value.defaultMethod.mappingKind || value.defaultMethod.mappingKind === 'core_instance')) ctx.addIssue({ code: 'custom', path: ['defaultMethod'], message: 'Core default cannot carry an option ID' });
    const keys = value.shippingMethods.map(methodKey);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', path: ['shippingMethods'], message: 'Duplicate method identity' });
    if (value.defaultMethod && !value.shippingMethods.some(method => method.enabled && methodKey(method) === methodKey(value.defaultMethod!))) {
        ctx.addIssue({ code: 'custom', path: ['defaultMethod'], message: 'Default method must reference an enabled grid row' });
    }
    const envelope = { schemaVersion: 1, scope: 'settings', entityId: 0, revision: Number.MAX_SAFE_INTEGER, payload: { enabled: false, settings: value } };
    if (Buffer.byteLength(JSON.stringify(envelope), 'utf8') > DELIVERY_INPUT_MAX_BYTES) {
        ctx.addIssue({ code: 'custom', message: 'Delivery settings exceed the sync size limit. Reduce closure labels or shipping rows.' });
    }
});
export type DeliverySettings = z.infer<typeof settingsSchema>;
export type ProductInput = z.infer<typeof productInputSchema>;

/** Draft defaults do not configure any products or activate storefront output. */
export function defaultSettings(timezone = 'UTC'): DeliverySettings {
    return {
        cutoffTime: '14:00', timezone: canonicalDeliveryTimezone(timezone), fallbackSupplierLeadTimeDays: 30,
        productionWeekdays: [1, 2, 3, 4, 5], transitWeekdays: [1, 2, 3, 4, 5],
        closures: [], shippingMethods: [], defaultMethod: null,
        branding: { textColor: null, accentColor: null, backgroundColor: null, fontSize: 14, spacing: 'compact', showIcon: false },
    };
}
