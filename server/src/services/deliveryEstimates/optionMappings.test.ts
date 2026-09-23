import { expect, it } from 'vitest';
import { defaultSettings, settingsSchema } from './validation';

const row = { methodId: 'wbs', instanceId: 0, zoneId: 0, zoneName: 'Global', title: 'Standard', enabled: true, minTransitDays: 4, maxTransitDays: 6, fulfilmentType: 'delivery' as const };
it('retains old core and unverified WBS documents without silently adding policy', () => {
    const settings = { ...defaultSettings(), shippingMethods: [row] };
    expect(settingsSchema.parse(settings).shippingMethods[0]).toEqual(row);
});
it('accepts multiple opaque exact options and a default referencing one mapping', () => {
    const standard = { ...row, mappingKind: 'exact_rate' as const, rateId: 'wbs:hash_standard' };
    const express = { ...standard, rateId: 'actual/opaque::express?x=1', minTransitDays: 1, maxTransitDays: 2 };
    const settings = { ...defaultSettings(), shippingMethods: [standard, express], defaultMethod: { methodId: 'wbs', instanceId: 0, mappingKind: 'exact_rate', rateId: express.rateId } };
    expect(settingsSchema.safeParse(settings).success).toBe(true);
    expect(settingsSchema.safeParse({ ...settings, defaultMethod: { ...settings.defaultMethod, rateId: 'unknown' } }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...settings, shippingMethods: [standard, standard] }).success).toBe(false);
});
it('requires explicit instance-wide confirmation and bounds option identities', () => {
    const broad = { ...row, mappingKind: 'all_provider_rates', allRatesConfirmed: true };
    const settings = { ...defaultSettings(), shippingMethods: [broad], defaultMethod: { methodId: 'wbs', instanceId: 0, mappingKind: 'all_provider_rates', rateId: 'wbs:hash_standard' } };
    expect(settingsSchema.safeParse(settings).success).toBe(true);
    for (const bad of [{ ...broad, allRatesConfirmed: false }, { ...broad, allRatesConfirmed: undefined }, { ...broad, rateId: 'not-an-exact-row' }, { ...row, mappingKind: 'exact_rate' }, { ...row, mappingKind: 'exact_rate', rateId: 'a'.repeat(201) }, { ...row, mappingKind: 'exact_rate', rateId: 'bad\nrate' }, { ...row, mappingKind: 'exact_rate', rateId: 'valid\n' }]) {
        expect(settingsSchema.safeParse({ ...defaultSettings(), shippingMethods: [bad] }).success).toBe(false);
    }
});
