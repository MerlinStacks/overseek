import { describe, expect, it } from 'vitest';
import { brandingSchema, buildWholesaleTaxImportCandidate, defaultsSchema } from './settings';

describe('wholesale settings validation', () => {
    it('accepts safe branding values and rejects non-hex colors', () => {
        const base = { logoUrl: 'https://example.test/logo.png', businessDetails: { name: 'Example Pty Ltd' } };
        expect(brandingSchema.safeParse({ ...base, primaryColor: '#12aBcF' }).success).toBe(true);
        expect(brandingSchema.safeParse({ ...base, primaryColor: 'navy' }).success).toBe(false);
    });

    it('accepts structured defaults and bounds terms sections', () => {
        const base = {
            priceTaxBasis: 'EXCLUSIVE', gstRate: '10.0000', confidentialityNotice: '', privacyNotice: '', setupChecklist: [],
        };
        expect(defaultsSchema.safeParse({ ...base, termsDocument: { sections: [] } }).success).toBe(true);
        expect(defaultsSchema.safeParse({
            ...base,
            termsDocument: { sections: Array.from({ length: 13 }, (_, index) => ({ heading: `${index}`, content: 'Text' })) },
        }).success).toBe(false);
    });
});

describe('WooCommerce wholesale tax import parsing', () => {
    it('parses the Woo price basis and prefers a named GST rate', () => {
        const result = buildWholesaleTaxImportCandidate({
            wooSettings: [{ id: 'woocommerce_prices_include_tax', value: 'yes' }],
            wooTaxRates: [
                { name: 'Reduced rate', class: 'reduced-rate', rate: '5.0000' },
                { name: 'AU GST', class: 'standard', rate: '10.0000' },
            ],
            accountRevenueTaxInclusive: false,
        });

        expect(result).toEqual({
            priceTaxBasis: 'INCLUSIVE',
            gstRate: '10',
            source: { priceTaxBasis: 'WOOCOMMERCE_SETTINGS', gstRate: 'WOOCOMMERCE_TAX_RATES' },
            warnings: [],
        });
    });

    it('uses explicit account and GST fallbacks with warnings when remote values are unavailable or unsafe', () => {
        const result = buildWholesaleTaxImportCandidate({
            wooSettings: [{ id: 'woocommerce_prices_include_tax', value: 'sometimes' }],
            wooTaxRates: [{ name: 'GST', class: 'standard', rate: '999' }],
            accountRevenueTaxInclusive: true,
            warnings: ['WooCommerce tax settings are unavailable; review the account tax fallback before applying it.'],
        });

        expect(result.priceTaxBasis).toBe('INCLUSIVE');
        expect(result.gstRate).toBe('10');
        expect(result.source).toEqual({ priceTaxBasis: 'ACCOUNT_REVENUE_TAX_SETTING', gstRate: 'DEFAULT_GST_RATE' });
        expect(result.warnings).toHaveLength(3);
    });
});
