import { describe, expect, it } from 'vitest';
import { buildCatalogSnapshot, catalogInputSchema } from './catalogs';

describe('wholesale catalog snapshots', () => {
    it('captures editable state and placements without unrelated relation data', () => {
        const snapshot = buildCatalogSnapshot({
            id: 'catalog-1',
            name: 'Trade 2026',
            publicTitle: 'Trade',
            subtitle: null,
            coverText: null,
            pricesIncludeTax: false,
            supplementaryPriceNotice: null,
            brandingOverrides: {},
            paymentCallout: {},
            termsSections: [],
            footerDetails: {},
            defaultsVersion: 'abc',
            status: 'DRAFT',
            generations: [{ id: 'secret' }],
            products: [{
                id: 'placement-1',
                productId: 'product-1',
                categoryKey: '7',
                categoryLabel: 'Awards',
                categorySortOrder: 2,
                isSuspended: false,
                suspensionReason: null,
                suspendedAt: null,
                restoreAllowed: true,
                product: { rawData: { secret: true } },
            }],
        });
        expect(snapshot).toMatchObject({
            catalog: { name: 'Trade 2026', defaultsVersion: 'abc' },
            products: [{ productId: 'product-1', categoryLabel: 'Awards' }],
        });
        expect(snapshot).not.toHaveProperty('catalog.id');
        expect(snapshot).not.toHaveProperty('catalog.generations');
        expect(snapshot).not.toHaveProperty('products.0.product');
    });

    it('limits legal sections to twelve', () => {
        const payload = {
            name: 'Trade', publicTitle: 'Trade', pricesIncludeTax: false,
            brandingOverrides: {}, paymentCallout: {}, footerDetails: {}, status: 'DRAFT',
            termsSections: Array.from({ length: 13 }, (_, index) => ({ heading: `H${index}`, content: 'Text' })),
        };
        expect(catalogInputSchema.safeParse(payload).success).toBe(false);
    });
});
