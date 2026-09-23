import { describe, expect, it } from 'vitest';
import { defaultSettings, DELIVERY_INPUT_MAX_BYTES, productInputSchema, settingsSchema } from './validation';

describe('delivery input validation', () => {
    it.each([[0, 0], [0, 3650], [null, null]])('accepts paired %s–%s', (productionMinDays, productionMaxDays) => {
        expect(productInputSchema.safeParse({ productionMinDays, productionMaxDays }).success).toBe(true);
    });
    it.each([[null, 1], [1, null], [-1, 2], [2, 1], [0, 3651], [0.5, 1], [undefined, undefined]])('rejects %s–%s', (productionMinDays, productionMaxDays) => {
        expect(productInputSchema.safeParse({ productionMinDays, productionMaxDays }).success).toBe(false);
    });
    it('accepts independent weekend calendars, real leap dates and IANA timezone', () => {
        expect(settingsSchema.parse({ ...defaultSettings(), timezone: 'Australia/Sydney', productionWeekdays: [0], transitWeekdays: [6],
            closures: [{ date: '2028-02-29', scope: 'work' }] }).fallbackSupplierLeadTimeDays).toBe(30);
    });
    it('canonicalises legacy timezone aliases before they reach PHP', () => {
        expect(settingsSchema.parse({ ...defaultSettings(), timezone: 'US/Pacific-New' }).timezone).toBe('America/Los_Angeles');
        expect(defaultSettings('US/Pacific-New').timezone).toBe('America/Los_Angeles');
        expect(settingsSchema.parse({ ...defaultSettings(), timezone: 'australia/sydney' }).timezone).toBe('Australia/Sydney');
    });
    it('reserves space for the full sync envelope, not just the settings JSON', () => {
        const settings = { ...defaultSettings(), closures: Array.from({ length: 3660 }, () => ({ date: '2026-12-25', scope: 'both' as const, label: '' })) };
        let remaining = DELIVERY_INPUT_MAX_BYTES - 40 - Buffer.byteLength(JSON.stringify(settings));
        for (const closure of settings.closures) {
            const length = Math.min(100, remaining);
            closure.label = 'a'.repeat(length);
            remaining -= length;
        }
        expect(remaining).toBe(0);
        expect(Buffer.byteLength(JSON.stringify(settings))).toBeLessThan(DELIVERY_INPUT_MAX_BYTES);
        const result = settingsSchema.safeParse(settings);
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues.some(issue => issue.message.includes('sync size limit'))).toBe(true);
        settings.closures.shift();
        expect(settingsSchema.safeParse(settings).success).toBe(true);
    });
    it('rejects malformed and duplicate variation overrides', () => {
        const range = { productionMinDays: null, productionMaxDays: null };
        const variation = { id: 'v', productionMinDays: 0, productionMaxDays: 0 };
        expect(productInputSchema.safeParse({ ...range, variations: [variation, variation] }).success).toBe(false);
        expect(productInputSchema.safeParse({ ...range, variations: [{ ...variation, productionMaxDays: null }] }).success).toBe(false);
    });
    it('limits branding to restrained typed values without arbitrary CSS', () => {
        const settings = defaultSettings();
        expect(settingsSchema.safeParse({ ...settings, branding: { ...settings.branding, textColor: 'url(evil)' } }).success).toBe(false);
        expect(settingsSchema.safeParse({ ...settings, branding: { ...settings.branding, fontSize: 40 } }).success).toBe(false);
    });
    it.each([
        { cutoffTime: '24:00' }, { cutoffTime: '9:00' }, { timezone: 'Fake/Zone' }, { timezone: '+02:00' },
        { productionWeekdays: [] }, { transitWeekdays: [1, 1] }, { productionWeekdays: [7] },
        { closures: [{ date: '2027-02-29', scope: 'both' }] },
        { closures: [{ date: '2028-02-29T00:00:00Z', scope: 'both' }] },
        { fallbackSupplierLeadTimeDays: -1 }, { storefrontActivated: true },
    ])('rejects invalid settings %j', patch => {
        expect(settingsSchema.safeParse({ ...defaultSettings(), ...patch }).success).toBe(false);
    });
    it('validates stable grid identities and enabled default references, not labels', () => {
        const row = { methodId: 'flat_rate', instanceId: 1, zoneId: 0, zoneName: 'World', title: 'Standard', enabled: true,
            minTransitDays: 0, maxTransitDays: 2, fulfilmentType: 'delivery' };
        const settings = { ...defaultSettings(), shippingMethods: [row, { ...row, instanceId: 2 }], defaultMethod: { methodId: 'flat_rate', instanceId: 2 } };
        expect(settingsSchema.safeParse(settings).success).toBe(true);
        expect(settingsSchema.safeParse({ ...settings, shippingMethods: [row, row] }).success).toBe(false);
        expect(settingsSchema.safeParse({ ...settings, shippingMethods: [row] }).success).toBe(false);
        expect(settingsSchema.safeParse({ ...settings, shippingMethods: [row, { ...row, instanceId: 2, enabled: false }] }).success).toBe(false);
        expect(settingsSchema.safeParse({ ...settings, shippingMethods: [{ ...row, minTransitDays: 3 }] }).success).toBe(false);
    });
});
