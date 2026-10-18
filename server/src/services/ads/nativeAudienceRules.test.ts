import { describe, expect, it } from 'vitest';
import { buildGoogleWebsiteList, buildMetaWebsiteRule, parseLookalikeDefinition, parseWebsiteDefinition } from './nativeAudienceRules';

const meta = { pixelId: '123', event: 'AddToCart', retentionDays: 14, exclusionDays: 30, excludePurchasers: true };
const google = { urlContains: '/checkout/', purchaseUrlContains: '/order-received/', retentionDays: 14, exclusionDays: 30, excludePurchasers: true, tagConfirmed: true };

describe('Native website and lookalike audience rules', () => {
    it('builds Meta event inclusion and a separate purchaser exclusion on the same pixel', () => {
        const rule = buildMetaWebsiteRule(parseWebsiteDefinition('META', meta));
        expect(rule.inclusions.rules[0]).toMatchObject({ event_sources: [{ type: 'pixel', id: '123' }], retention_seconds: 14 * 86400, filter: { filters: [{ field: 'event', operator: 'eq', value: 'AddToCart' }] } });
        expect(rule.exclusions?.rules[0]).toMatchObject({ retention_seconds: 30 * 86400, filter: { filters: [{ field: 'event', operator: 'eq', value: 'Purchase' }] } });
    });
    it('allows a product/category URL constraint without turning exclusions into URL-only rules', () => {
        const rule = buildMetaWebsiteRule(parseWebsiteDefinition('META', { ...meta, urlContains: '/gifts/' }));
        expect(rule.inclusions.rules[0].filter.filters).toContainEqual({ field: 'url', operator: 'i_contains', value: '/gifts/' });
        expect(rule.exclusions?.rules[0].filter.filters).toHaveLength(1);
    });
    it('builds Google flexible URL-based lists rather than inventing event/GA4 audience rules', () => {
        const list = buildGoogleWebsiteList('Checkout visitors', parseWebsiteDefinition('GOOGLE', google));
        const rules = list.ruleBasedUserList.flexibleRuleUserList;
        expect(list.membershipLifeSpan).toBe(14);
        expect(rules.inclusiveOperands[0].rule.ruleItemGroups[0].ruleItems[0]).toEqual({ name: 'url__', stringRuleItem: { operator: 'CONTAINS', value: '/checkout/' } });
        expect(rules.exclusiveOperands[0]).toMatchObject({ lookbackWindowDays: 30 });
        expect(rules.exclusiveOperands[0].rule.ruleItemGroups[0].ruleItems[0].stringRuleItem.value).toBe('/order-received/');
    });
    it.each([0, -1, 1.5, 181, '30'])('rejects invalid Meta retention %s', retentionDays => {
        expect(() => parseWebsiteDefinition('META', { ...meta, retentionDays })).toThrow();
    });
    it('caps Google windows at 540 and requires tag confirmation', () => {
        expect(() => parseWebsiteDefinition('GOOGLE', { ...google, retentionDays: 541 })).toThrow();
        expect(() => parseWebsiteDefinition('GOOGLE', { ...google, tagConfirmed: false })).toThrow(/remarketing tag/);
        expect(() => parseWebsiteDefinition('GOOGLE', { ...google, retentionDays: 540 })).not.toThrow();
    });
    it('rejects arbitrary source IDs, event fields and contradictory rules', () => {
        expect(() => parseWebsiteDefinition('META', { ...meta, pixelId: '../other' })).toThrow();
        expect(() => parseWebsiteDefinition('META', { ...meta, event: 'unknown' })).toThrow();
        expect(() => parseWebsiteDefinition('META', { ...meta, event: 'Purchase' })).toThrow();
        expect(() => parseWebsiteDefinition('GOOGLE', { ...google, purchaseUrlContains: '' })).toThrow();
        expect(() => parseWebsiteDefinition('GOOGLE', { ...google, purchaseUrlContains: '/checkout/' })).toThrow();
    });
    it('omits exclusions entirely when they are disabled', () => {
        expect(buildMetaWebsiteRule(parseWebsiteDefinition('META', { ...meta, excludePurchasers: false })).exclusions).toBeUndefined();
        expect(buildGoogleWebsiteList('Visitors', parseWebsiteDefinition('GOOGLE', { ...google, excludePurchasers: false })).ruleBasedUserList.flexibleRuleUserList.exclusiveOperands).toEqual([]);
    });
    it('accepts only managed source types, supported target countries and sizes', () => {
        expect(parseLookalikeDefinition({ sourceType: 'WEBSITE', sourceId: 'source', country: 'au', percent: 3 })).toEqual({ sourceType: 'WEBSITE', sourceId: 'source', country: 'AU', percent: 3 });
        for (const override of [{ country: 'ZZ' }, { percent: 100 }, { percent: '1' }, { sourceType: 'EXTERNAL' }, { sourceId: '' }]) {
            expect(() => parseLookalikeDefinition({ sourceType: 'CUSTOMER_LIST', sourceId: 'source', country: 'AU', percent: 1, ...override })).toThrow();
        }
    });
    it('drops client-supplied platform JSON, external IDs and secrets', () => {
        const definition = parseWebsiteDefinition('META', { ...meta, rule: { attack: true }, accessToken: 'secret', externalId: 'foreign' });
        expect(definition).not.toHaveProperty('rule');
        expect(definition).not.toHaveProperty('accessToken');
        expect(definition).not.toHaveProperty('externalId');
    });
});
