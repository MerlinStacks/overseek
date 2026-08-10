import { describe, expect, it, vi } from 'vitest';
import { buildCatalogSnapshot, catalogInputSchema, syncAutomaticCatalogProducts } from './catalogs';

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

describe('automatic wholesale catalog products', () => {
    it('derives membership from configured wholesale price tiers', async () => {
        const tx = {
            wholesaleCatalog: { findFirst: vi.fn().mockResolvedValue({ status: 'DRAFT' }) },
            wooProduct: { findMany: vi.fn().mockResolvedValue([
                { id: 'priced', stockStatus: 'instock', rawData: { categories: [{ slug: 'awards', name: 'Awards' }] }, variations: [], wholesaleProfile: { priceTiers: [{ id: 'tier-1' }] } },
                { id: 'priced-oos', stockStatus: 'outofstock', rawData: {}, variations: [], wholesaleProfile: { priceTiers: [{ id: 'tier-2' }] } },
                { id: 'retail-only', stockStatus: 'instock', rawData: {}, variations: [], wholesaleProfile: { priceTiers: [] } },
            ]) },
            wholesaleCatalogProduct: { deleteMany: vi.fn(), upsert: vi.fn() },
        };

        await syncAutomaticCatalogProducts(tx, 'account-1', 'catalog-1');

        expect(tx.wholesaleCatalogProduct.deleteMany).toHaveBeenCalledWith({
            where: { accountId: 'account-1', catalogId: 'catalog-1', productId: { notIn: ['priced', 'priced-oos'] } },
        });
        expect(tx.wholesaleCatalogProduct.upsert).toHaveBeenCalledTimes(2);
        expect(tx.wholesaleCatalogProduct.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { catalogId_productId: { catalogId: 'catalog-1', productId: 'priced-oos' } },
            update: expect.objectContaining({ isSuspended: true, suspensionReason: 'OUT_OF_STOCK' }),
        }));
    });
});
