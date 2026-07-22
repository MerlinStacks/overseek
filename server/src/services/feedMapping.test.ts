import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
    accountFeature: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
    },
    account: { findUnique: vi.fn() },
    wooProduct: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
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

    it('includes Pinterest product video links', async () => {
        const getFeedRows = vi.spyOn(FeedMappingService, 'getFeedRows').mockResolvedValueOnce({
            rows: [{
                columns: [
                    { targetField: 'link', finalValue: 'https://example.com/product' },
                    { targetField: 'video_link', finalValue: 'https://example.com/product.mp4' },
                ],
            }],
            total: 1,
        } as any);

        const xml = await FeedMappingService.getFeedExportXml('account-1', 'pinterest');

        expect(xml).toContain('<g:video_link>https://example.com/product.mp4</g:video_link>');
        getFeedRows.mockRestore();
    });
});

describe('FeedMappingService.getFeedExportCsv', () => {
    it('uses Meta catalog product video headers', async () => {
        const getFeedRows = vi.spyOn(FeedMappingService, 'getFeedRows').mockResolvedValueOnce({
            mappings: [
                { targetField: 'id', sourceField: 'wooId' },
                { targetField: 'description', sourceField: 'description' },
                { targetField: 'video[0].url', sourceField: 'videoLink' },
            ],
            rows: [{
                columns: [
                    { targetField: 'id', finalValue: '61082' },
                    { targetField: 'description', finalValue: '<p>Product, description</p>' },
                    { targetField: 'video[0].url', finalValue: 'https://example.com/product.mp4' },
                ],
            }],
            total: 1,
        } as any);

        const csv = await FeedMappingService.getFeedExportCsv('account-1', 'meta');

        expect(csv).toBe([
            '"id","description","video[0].url"',
            '"61082","Product, description","https://example.com/product.mp4"',
        ].join('\n'));
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

    it('uses shared rewrites and maps videos to each platform field', async () => {
        mockPrisma.wooProduct.findMany.mockResolvedValue([{
            id: 'product-1',
            wooId: 61082,
            name: 'Original title',
            sku: 'RSG-1',
            price: '39.95',
            stockStatus: 'instock',
            permalink: 'https://example.com/product',
            mainImage: 'https://example.com/image.jpg',
            variations: [],
            seoData: {
                feedOverrides: {
                    shared: { title: 'One title for every platform' },
                    google: { title: 'Old Google title' },
                },
            },
            rawData: {
                description: 'Description',
                video_link: 'https://example.com/product.mp4',
            },
        }]);

        const meta = await FeedMappingService.getFeedRows('account-1', 'meta', 1, 50, '', 'variable_parent');
        const pinterest = await FeedMappingService.getFeedRows('account-1', 'pinterest', 1, 50, '', 'variable_parent');

        expect(meta.rows[0].columns.find((column: any) => column.targetField === 'title').finalValue)
            .toBe('One title for every platform');
        expect(meta.rows[0].columns.find((column: any) => column.targetField === 'video[0].url').finalValue)
            .toBe('https://example.com/product.mp4');
        expect(pinterest.rows[0].columns.find((column: any) => column.targetField === 'video_link').finalValue)
            .toBe('https://example.com/product.mp4');
    });

    it('reuses existing Google rewrites on other platforms', async () => {
        const product = {
            id: 'product-1',
            wooId: 61082,
            name: 'Original title',
            sku: 'RSG-1',
            price: '39.95',
            stockStatus: 'instock',
            permalink: 'https://example.com/product',
            mainImage: 'https://example.com/image.jpg',
            variations: [],
            seoData: { feedOverrides: { google: { title: 'Existing Google rewrite' } } },
            rawData: { description: 'Description' },
        };
        mockPrisma.wooProduct.findMany.mockResolvedValue([product]);

        const meta = await FeedMappingService.getFeedRows('account-1', 'meta', 1, 50, '', 'variable_parent');

        expect(meta.rows[0].columns.find((column: any) => column.targetField === 'title').finalValue)
            .toBe('Existing Google rewrite');
    });

    it('saves title and description overrides once for every platform', async () => {
        mockPrisma.wooProduct.findUnique.mockResolvedValue({
            seoData: {
                feedOverrides: {
                    google: { title: 'Google title' },
                    meta: { title: 'Meta title' },
                },
            },
        });

        await FeedMappingService.saveRowOverrides('account-1', 'google', 61082, {
            title: 'Shared title',
        });

        const seoData = mockPrisma.wooProduct.update.mock.calls[0][0].data.seoData;
        expect(seoData.feedOverrides.shared.title).toBe('Shared title');
        expect(seoData.feedOverrides.google.title).toBeUndefined();
        expect(seoData.feedOverrides.meta.title).toBeUndefined();
    });
});
