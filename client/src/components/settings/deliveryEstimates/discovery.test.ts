import { describe, expect, it } from 'vitest';
import { mergeDiscoveredMethods, type DiscoveredMethod } from './discovery';
import { responseFixture } from './fixtures.test-support';

const method: DiscoveredMethod = { methodId: 'flat_rate', instanceId: 3, zoneId: 2, zoneName: 'Changed zone', title: 'Changed title', enabled: false, provider: 'woocommerce', rateIdentityScope: 'method_instance', requiresRateVerification: false };

describe('shipping discovery draft merge', () => {
    it('preserves all existing fields including unsaved edits, defaults and missing/disabled rows', () => {
        const settings = responseFixture().settings;
        settings.cutoffTime = '18:00'; settings.shippingMethods[0].title = 'Merchant title';
        expect(mergeDiscoveredMethods(settings, [method])).toEqual(settings);
        expect(mergeDiscoveredMethods(settings, [])).toEqual(settings);
    });
    it('matches identity rather than title, deduplicates imports and omits discovery metadata', () => {
        const settings = responseFixture().settings;
        const discovered = { ...method, instanceId: 4, title: 'Standard', provider: 'weight_based' as const, requiresRateVerification: true };
        const merged = mergeDiscoveredMethods(settings, [method, discovered, discovered]);
        expect(merged.shippingMethods).toHaveLength(2);
        expect(merged.shippingMethods[1]).toEqual({ methodId: 'flat_rate', instanceId: 4, zoneId: 2, zoneName: 'Changed zone', title: 'Standard', enabled: false, minTransitDays: 0, maxTransitDays: 0, fulfilmentType: 'delivery' });
        expect(mergeDiscoveredMethods(merged, [discovered])).toEqual(merged);
        expect(settings.shippingMethods).toHaveLength(1);
        expect(merged.defaultMethod).toEqual(settings.defaultMethod);
    });
});
