import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
    accountFeature: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
    },
    account: { findUnique: vi.fn() },
    wooProduct: { findMany: vi.fn() },
}));

vi.mock('../utils/prisma', () => ({ prisma: mockPrisma }));

import { FeedMappingService } from './feedMapping';

describe('FeedMappingService.getFeedExportXml', () => {
    it('emits CTX-compatible item fields and cleans HTML spacing', async () => {
        const getFeedRows = vi.spyOn(FeedMappingService, 'getFeedRows').mockResolvedValueOnce({
            rows: [{
                wooId: 61082,
                name: 'Couples Photo Engraved Rounded Scotch Glass',
                columns: [
                    { targetField: 'id', finalValue: '61082' },
                    { targetField: 'title', finalValue: 'Couples Photo Engraved Rounded Scotch Glass' },
                    { targetField: 'description', finalValue: 'See our <a href="/gifts">engagement gifts</a>.' },
                    { targetField: 'link', finalValue: 'https://example.com/product' },
                    { targetField: 'product_type', finalValue: 'Wedding Gifts > Gifts for Couples > Bar Gifts' },
                    { targetField: 'additional_image_link', finalValue: 'https://example.com/2.jpg, ,https://example.com/3.jpg' },
                ],
            }],
            total: 1,
        } as any);

        const xml = await FeedMappingService.getFeedExportXml('account-1', 'google');

        expect(xml).toContain('<g:title>Couples Photo Engraved Rounded Scotch Glass</g:title>');
        expect(xml).toContain('<g:description>See our engagement gifts.</g:description>');
        expect(xml).toContain('<link>https://example.com/product</link>');
        expect(xml).toContain('<g:product_type>Wedding Gifts &gt; Gifts for Couples &gt; Bar Gifts</g:product_type>');
        expect(xml.match(/<g:additional_image_link>/g)).toHaveLength(2);
        expect(xml).not.toContain('<title>Couples Photo Engraved Rounded Scotch Glass</title>');
        expect(xml).not.toContain('<description>See our engagement gifts.</description>');
        expect(xml).not.toContain('<g:link>');
        expect(xml).not.toContain('<g:additional_image_link></g:additional_image_link>');
        getFeedRows.mockRestore();
    });
});

describe('FeedMappingService product type category priority', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockPrisma.accountFeature.findUnique.mockResolvedValue({
            config: {
                productTypeCategoryPriority: [
                    'Personalised Wedding Gifts',
                    'Gifts for Couples',
                    'Personalised Engagement Gifts',
                ],
            },
        });
        mockPrisma.account.findUnique.mockResolvedValue({ name: 'CustomKings', currency: 'AUD' });
        mockPrisma.wooProduct.findMany.mockResolvedValue([{
            id: 'product-1',
            wooId: 61082,
            name: 'Scotch Glass',
            sku: 'RSG-1',
            price: '39.95',
            stockStatus: 'instock',
            permalink: 'https://example.com/product',
            mainImage: 'https://example.com/image.jpg',
            seoData: {},
            variations: [],
            rawData: {
                type: 'simple',
                categories: [
                    { name: 'Gifts for Couples' },
                    { name: 'Bar Gifts' },
                    { name: 'Birthday Gifts' },
                    { name: 'Personalised Engagement Gifts' },
                    { name: 'Personalised Wedding Gifts' },
                ],
            },
        }]);
    });

    it('places configured categories first and preserves unmatched source order', async () => {
        const result = await FeedMappingService.getFeedRows('account-1', 'google', 1, 50, '', 'variable_parent');
        const productType = result.rows[0].columns.find((column: any) => column.targetField === 'product_type');

        expect(productType.finalValue).toBe(
            'Personalised Wedding Gifts > Gifts for Couples > Personalised Engagement Gifts > Bar Gifts > Birthday Gifts',
        );
    });

    it('normalizes and stores category priority without replacing other feed settings', async () => {
        mockPrisma.accountFeature.findUnique.mockResolvedValueOnce({ config: { maxBulkOptimizeRows: 2000 } });

        const saved = await FeedMappingService.setProductTypeCategoryPriority('account-1', [
            ' Wedding Gifts ',
            'Bar Gifts',
            'wedding gifts',
            '',
        ]);

        expect(saved).toEqual(['Wedding Gifts', 'Bar Gifts']);
        expect(mockPrisma.accountFeature.upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: {
                config: {
                    maxBulkOptimizeRows: 2000,
                    productTypeCategoryPriority: ['Wedding Gifts', 'Bar Gifts'],
                },
            },
        }));
    });
});
