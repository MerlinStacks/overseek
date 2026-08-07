import { describe, expect, it } from 'vitest';
import type { WholesaleBranding, WholesaleCatalog, WholesaleDefaults, WholesaleProductSummary } from '../../types/wholesaleCatalog';
import { buildCatalogPreview } from './catalogPreviewHelpers';

const catalog = { publicTitle: 'Trade 2026', subtitle: null, coverText: null, termsSections: [], paymentCallout: {}, footerDetails: {}, pricesIncludeTax: false, supplementaryPriceNotice: null } as WholesaleCatalog;
const defaults = { priceTaxBasis: 'EXCLUSIVE', gstRate: '10', termsDocument: { sections: [] }, confidentialityNotice: '', privacyNotice: '', setupChecklist: [] } as WholesaleDefaults;
const branding = { logoUrl: null, primaryColor: null, accentColor: null, headingFont: null, bodyFont: null, businessDetails: {} } as WholesaleBranding;
const product = (id: number, categoryLabel: string): WholesaleProductSummary => ({ id: String(id), wooId: id, name: `Product ${String(id).padStart(2, '0')}`, sku: `SKU-${id}`, imageUrl: null, categoryLabel, readiness: {} as WholesaleProductSummary['readiness'], profile: null });

describe('approximate catalog preview pagination', () => {
    it('groups categories and limits each product page to eight cards', () => {
        const preview = buildCatalogPreview(catalog, [...Array.from({ length: 10 }, (_, index) => product(index, 'Awards')), product(20, 'Drinkware')], defaults, branding);
        const pages = preview.pages.filter(page => page.kind === 'products');
        expect(pages.map(page => [page.category, page.continued, page.products.length])).toEqual([
            ['Awards', false, 8], ['Awards', true, 2], ['Drinkware', false, 1],
        ]);
        expect(preview.pages[0].kind).toBe('cover');
        expect(preview.pages.at(-1)?.kind).toBe('terms');
    });
});
