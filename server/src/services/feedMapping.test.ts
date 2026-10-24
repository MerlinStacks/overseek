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

describe('grouped feed bulk optimization', () => {
    it('optimizes one parent description and keeps titles variant-specific', async () => {
        const optimize = vi.spyOn(FeedMappingService, 'optimizeRowFields').mockResolvedValue({ description: 'Shared AI description', title: 'Variant title' });
        try {
            const updateProgress = vi.fn();
            const result = await FeedMappingService.processOptimizeBulkJob({
                accountId: 'account-1', channel: 'google', fields: ['title', 'description'], sharedDescriptions: true,
                rows: [{ wooId: 1, variationWooId: 11 }, { wooId: 1, variationWooId: 12 }],
            }, { updateProgress } as any);
            expect(optimize.mock.calls).toEqual([
                ['account-1', 'google', 1, ['description']],
                ['account-1', 'google', 1, ['title'], 11],
                ['account-1', 'google', 1, ['title'], 12],
            ]);
            expect(result).toMatchObject({ total: 2, succeeded: 2, failed: 0 });
            expect(updateProgress).toHaveBeenLastCalledWith({ completed: 2, total: 2, pct: 100 });
        } finally { optimize.mockRestore(); }
    });

    it('keeps ungrouped jobs variant-specific', async () => {
        const optimize = vi.spyOn(FeedMappingService, 'optimizeRowFields').mockResolvedValue({ description: 'Variant AI description' });
        try {
            await FeedMappingService.processOptimizeBulkJob({
                accountId: 'account-1', channel: 'meta', fields: ['description'], rows: [{ wooId: 1, variationWooId: 11 }],
            }, { updateProgress: vi.fn() } as any);
            expect(optimize).toHaveBeenCalledWith('account-1', 'meta', 1, ['description'], 11);
        } finally { optimize.mockRestore(); }
    });
});

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

describe('FeedMappingService Google online feed mappings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not include local inventory fields by default', async () => {
        mockPrisma.accountFeature.findUnique.mockResolvedValue(null);

        const mappings = await FeedMappingService.getMappings('account-1', 'google');

        expect(mappings.some((mapping) => mapping.targetField === 'store_code')).toBe(false);
        expect(mappings.some((mapping) => mapping.sourceField === 'storeCode')).toBe(false);
    });

    it('removes legacy store code mappings from existing account settings', async () => {
        mockPrisma.accountFeature.findUnique.mockResolvedValue({
            config: {
                mappings: {
                    google: [
                        { targetField: 'id', sourceField: 'wooId', required: true },
                        { targetField: 'store_code', sourceField: 'storeCode' },
                    ],
                },
            },
        });

        const mappings = await FeedMappingService.getMappings('account-1', 'google');

        expect(mappings.some((mapping) => mapping.targetField === 'store_code')).toBe(false);
        expect(mappings.some((mapping) => mapping.sourceField === 'storeCode')).toBe(false);
    });

    it('does not persist store code mappings in the online product feed', async () => {
        mockPrisma.accountFeature.findUnique.mockResolvedValue(null);

        const mappings = await FeedMappingService.saveMappings('account-1', 'google', [
            { targetField: 'id', sourceField: 'wooId', required: true },
            { targetField: 'store_code', sourceField: 'storeCode' },
        ]);

        expect(mappings).toEqual([{ targetField: 'id', sourceField: 'wooId', required: true }]);
        expect(mockPrisma.accountFeature.upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: expect.objectContaining({
                config: expect.objectContaining({
                    mappings: { google: [{ targetField: 'id', sourceField: 'wooId', required: true }] },
                }),
            }),
        }));
    });
});

describe('FeedMappingService product exclusions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockPrisma.account.findUnique.mockResolvedValue({ name: 'CustomKings', currency: 'AUD' });
    });

    it('defaults exclusions off and preserves other feed settings when saving', async () => {
        mockPrisma.accountFeature.findUnique.mockResolvedValueOnce(null);
        await expect(FeedMappingService.getProductFilters('account-1')).resolves.toEqual({
            excludeOutOfStockProducts: false,
            excludeUnpublishedProducts: false,
            backordersAsInStock: false,
        });

        mockPrisma.accountFeature.findUnique.mockResolvedValueOnce({ config: { maxBulkOptimizeRows: 2000 } });
        const filters = await FeedMappingService.setProductFilters('account-1', {
            excludeOutOfStockProducts: true,
            excludeUnpublishedProducts: true,
        });

        expect(filters).toEqual({
            excludeOutOfStockProducts: true,
            excludeUnpublishedProducts: true,
            backordersAsInStock: false,
        });
        expect(mockPrisma.accountFeature.upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: {
                config: {
                    maxBulkOptimizeRows: 2000,
                    excludeOutOfStockProducts: true,
                    excludeUnpublishedProducts: true,
                    backordersAsInStock: false,
                },
            },
        }));
    });

    it('persists a product-level feed exclusion without replacing other SEO data', async () => {
        mockPrisma.wooProduct.findUnique.mockResolvedValue({
            seoData: { focusKeyword: 'glass', feedOverrides: { shared: { title: 'Custom title' } } },
        });

        await expect(FeedMappingService.getProductFeedExclusion('account-1', 61082)).resolves.toBe(false);
        await expect(FeedMappingService.setProductFeedExclusion('account-1', 61082, true)).resolves.toBe(true);

        expect(mockPrisma.wooProduct.update).toHaveBeenCalledWith({
            where: { accountId_wooId: { accountId: 'account-1', wooId: 61082 } },
            data: {
                seoData: {
                    focusKeyword: 'glass',
                    feedOverrides: { shared: { title: 'Custom title' } },
                    excludeFromProductFeeds: true,
                },
            },
        });
    });

    it('removes explicitly excluded products from rows and bulk row references', async () => {
        mockPrisma.accountFeature.findUnique.mockResolvedValue(null);
        mockPrisma.wooProduct.findMany.mockResolvedValue([{
            id: 'product-1', wooId: 1, name: 'Excluded', sku: 'ONE', price: '10', status: 'publish',
            stockStatus: 'instock', permalink: null, mainImage: null, rawData: { type: 'simple' },
            seoData: { excludeFromProductFeeds: true }, variations: [],
        }]);

        const feed = await FeedMappingService.getFeedRows('account-1', 'google', 1, 50, '', 'variable_parent');
        const refs = await FeedMappingService.getFeedRowRefs('account-1', 'google', '', 'variable_parent');

        expect(feed).toMatchObject({ total: 0, rows: [] });
        expect(refs).toEqual({ total: 0, rows: [] });
    });

    it('excludes unpublished and out-of-stock parent and variation rows consistently', async () => {
        mockPrisma.accountFeature.findUnique.mockResolvedValue({
            config: {
                excludeOutOfStockProducts: true,
                excludeUnpublishedProducts: true,
            },
        });
        mockPrisma.wooProduct.findMany.mockResolvedValue([
            {
                id: 'product-1', wooId: 1, name: 'Published', sku: 'ONE', price: '10', status: 'publish',
                stockStatus: 'instock', permalink: null, mainImage: null, rawData: { type: 'simple' }, seoData: {}, variations: [],
            },
            {
                id: 'product-2', wooId: 2, name: 'Draft', sku: 'TWO', price: '10', status: 'draft',
                stockStatus: 'instock', permalink: null, mainImage: null, rawData: { type: 'simple' }, seoData: {}, variations: [],
            },
            {
                id: 'product-3', wooId: 3, name: 'Sold out', sku: 'THREE', price: '10', status: 'publish',
                stockStatus: 'outofstock', permalink: null, mainImage: null, rawData: { type: 'simple' }, seoData: {}, variations: [],
            },
            {
                id: 'product-4', wooId: 4, name: 'Variable', sku: 'FOUR', price: '10', status: 'publish',
                stockStatus: 'outofstock', permalink: null, mainImage: null, rawData: { type: 'variable' }, seoData: {},
                variations: [
                    { wooId: 41, sku: 'FOUR-A', price: '10', stockStatus: 'instock', rawData: {} },
                    { wooId: 42, sku: 'FOUR-B', price: '10', stockStatus: 'out_of_stock', rawData: {} },
                ],
            },
        ]);

        const feed = await FeedMappingService.getFeedRows('account-1', 'google', 1, 50, '', 'variable_and_variations');
        const refs = await FeedMappingService.getFeedRowRefs('account-1', 'google', '', 'variable_and_variations');

        expect(feed.rows.map((row) => row.rowId)).toEqual(['p:1', 'v:4-41']);
        expect(feed.total).toBe(2);
        expect(refs.rows.map((row) => row.rowId)).toEqual(['p:1', 'v:4-41']);
        expect(refs.total).toBe(2);
    });

    it('keeps excluded products available in the product-specific feed editor', async () => {
        mockPrisma.accountFeature.findUnique.mockResolvedValue({
            config: {
                excludeOutOfStockProducts: true,
                excludeUnpublishedProducts: true,
            },
        });
        mockPrisma.wooProduct.findMany.mockResolvedValue([{
            id: 'product-2', wooId: 2, name: 'Draft', sku: 'TWO', price: '10', status: 'draft',
            stockStatus: 'outofstock', permalink: null, mainImage: null, rawData: { type: 'simple' },
            seoData: { excludeFromProductFeeds: true }, variations: [],
        }]);

        const result = await FeedMappingService.getFeedRows('account-1', 'google', 1, 50, '', 'variable_parent', 2);

        expect(result.rows.map((row) => row.rowId)).toEqual(['p:2']);
    });
});

describe('FeedMappingService backorder availability override', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockPrisma.account.findUnique.mockResolvedValue({ name: 'Store', currency: 'AUD' });
    });

    const product = (wooId: number, stockStatus: string, rawData: Record<string, unknown> = {}) => ({
        id: `product-${wooId}`, wooId, name: `Product ${wooId}`, sku: String(wooId), price: '10',
        status: 'publish', stockStatus, rawData: { type: 'simple', ...rawData }, seoData: {}, variations: [],
    });

    it.each(['google', 'meta'])('includes allow and notify backorders as in stock for %s', async (channel) => {
        mockPrisma.accountFeature.findUnique.mockResolvedValue({ config: {
            backordersAsInStock: true, excludeOutOfStockProducts: true,
        } });
        const products = [
            product(1, 'outofstock', { backorders: 'yes' }),
            product(2, 'onbackorder', { backorders: 'notify' }),
            product(3, 'outofstock', { backorders: 'no' }),
            product(4, 'outofstock', { backorders_allowed: true }),
            product(5, 'instock', { backorders: 'no' }),
        ];
        mockPrisma.wooProduct.findMany.mockResolvedValue(products);

        const feed = await FeedMappingService.getFeedRows('account-1', channel, 1, 50, '', 'variable_parent');
        const refs = await FeedMappingService.getFeedRowRefs('account-1', channel, '', 'variable_parent');
        expect(feed.rows.map((row) => row.rowId)).toEqual(['p:1', 'p:2', 'p:4', 'p:5']);
        expect(refs.rows.map((row) => row.rowId)).toEqual(feed.rows.map((row) => row.rowId));
        for (const row of feed.rows) {
            expect(row.columns.find((column: any) => column.targetField === 'availability')?.finalValue).toBe(channel === 'meta' ? 'in stock' : 'in_stock');
        }
        expect(products[0].stockStatus).toBe('outofstock');
        if (channel === 'google') {
            expect(await FeedMappingService.getFeedExportXml('account-1', channel)).toContain('<g:availability>in_stock</g:availability>');
        } else {
            expect(await FeedMappingService.getFeedExportCsv('account-1', channel)).toContain('"in stock"');
        }
    });

    it.each([
        ['google', false], ['meta', false], ['pinterest', true],
    ])('preserves existing availability for %s when override is %s', async (channel, enabled) => {
        mockPrisma.accountFeature.findUnique.mockResolvedValue({ config: { backordersAsInStock: enabled } });
        mockPrisma.wooProduct.findMany.mockResolvedValue([product(1, 'onbackorder', { backorders: 'yes' })]);
        const feed = await FeedMappingService.getFeedRows('account-1', String(channel), 1, 50, '', 'variable_parent');
        expect(feed.rows[0].columns.find((column: any) => column.targetField === 'availability')?.finalValue).toBe(channel === 'meta' ? 'available for order' : 'backorder');
    });

    it('resolves variation permissions and parent-managed stock without overriding explicit no', async () => {
        mockPrisma.accountFeature.findUnique.mockResolvedValue({ config: {
            backordersAsInStock: true, excludeOutOfStockProducts: true,
        } });
        mockPrisma.wooProduct.findMany.mockResolvedValue([{
            ...product(1, 'outofstock', { type: 'variable', backorders: 'notify' }),
            variations: [
                { wooId: 11, stockStatus: 'outofstock', rawData: { backorders: 'yes' } },
                { wooId: 12, stockStatus: 'outofstock', rawData: { backorders: 'notify' } },
                { wooId: 13, stockStatus: 'outofstock', rawData: { backorders: 'no' } },
                { wooId: 14, stockStatus: 'outofstock', rawData: { manage_stock: 'parent', backorders: 'no' } },
            ],
        }]);
        const feed = await FeedMappingService.getFeedRows('account-1', 'google', 1, 50, '', 'all_variations');
        const refs = await FeedMappingService.getFeedRowRefs('account-1', 'google', '', 'all_variations');
        expect(feed.rows.map((row) => row.rowId)).toEqual(['v:1-11', 'v:1-12', 'v:1-14']);
        expect(refs.rows.map((row) => row.rowId)).toEqual(feed.rows.map((row) => row.rowId));
        expect(feed.rows.every((row) => row.columns.find((column: any) => column.targetField === 'availability')?.finalValue === 'in_stock')).toBe(true);
        const preview = await FeedMappingService.getFeedRows('account-1', 'google', 1, 50, '', 'variable_parent', 1);
        expect(preview.rows[0].columns.find((column: any) => column.targetField === 'availability')?.finalValue).toBe('in_stock');
    });

    it('persists the override alongside existing account configuration', async () => {
        mockPrisma.accountFeature.findUnique.mockResolvedValue({ config: { maxBulkOptimizeRows: 2000 } });
        const saved = await FeedMappingService.setProductFilters('account-1', {
            excludeOutOfStockProducts: true, excludeUnpublishedProducts: false, backordersAsInStock: true,
        });
        expect(saved.backordersAsInStock).toBe(true);
        expect(mockPrisma.accountFeature.upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: { config: { ...saved, maxBulkOptimizeRows: 2000 } },
        }));
    });
});

describe('FeedMappingService channel data and health', () => {
    const base = (wooId: number, rawData: Record<string, unknown> = {}) => ({
        id: `product-${wooId}`, wooId, name: `Product ${wooId}`, sku: `SKU-${wooId}`, price: '8',
        status: 'publish', stockStatus: 'instock', permalink: 'https://example.com/product', mainImage: 'https://example.com/image.jpg',
        rawData: { type: 'simple', description: 'A useful product', regular_price: '10', sale_price: '8', on_sale: true, ...rawData },
        seoData: {}, variations: [],
    });
    const value = (row: any, field: string) => row.columns.find((column: any) => column.targetField === field)?.finalValue;

    beforeEach(() => {
        vi.clearAllMocks();
        mockPrisma.accountFeature.findUnique.mockResolvedValue(null);
        mockPrisma.account.findUnique.mockResolvedValue({ name: 'Store', currency: 'AUD', timezone: 'Australia/Sydney' });
    });

    it.each(['google', 'meta'])('exports regular/sale prices without SKU-as-MPN or invented identifiers for %s', async (channel) => {
        mockPrisma.wooProduct.findMany.mockResolvedValue([base(1)]);
        const result = await FeedMappingService.getFeedRows('account-1', channel, 1, 50, '', 'variable_parent');
        expect(value(result.rows[0], 'price')).toBe('10.00 AUD');
        expect(value(result.rows[0], 'sale_price')).toBe('8.00 AUD');
        expect(value(result.rows[0], 'mpn')).toBeNull();
        expect(value(result.rows[0], 'brand')).toBeNull();
        if (channel === 'google') expect(value(result.rows[0], 'identifier_exists')).toBeNull();
    });

    it.each(['google', 'meta'])('paginates grouped %s UI rows by product without splitting variants or exporting group editors', async (channel) => {
        mockPrisma.wooProduct.findMany.mockResolvedValue([
            { ...base(1, { type: 'variable' }), variations: [11, 12, 13].map((wooId) => ({ wooId, price: '12', rawData: {} })) },
            base(2),
        ]);
        const first = await FeedMappingService.getFeedRows('account-1', channel, 1, 1, '', 'automatic', undefined, false, true);
        expect(first.total).toBe(2);
        expect(first.rows.map((row) => row.rowId)).toEqual(['v:1-11', 'v:1-12', 'v:1-13']);
        expect(first.groups).toMatchObject([{ rowId: 'g:1', rowType: 'group', wooId: 1 }]);
        expect(value(first.groups![0], 'description')).toBe('A useful product');
        const second = await FeedMappingService.getFeedRows('account-1', channel, 2, 1, '', 'automatic', undefined, false, true);
        expect(second.rows.map((row) => row.rowId)).toEqual(['p:2']);
        expect(second.groups).toEqual([]);
        const exported = await FeedMappingService.getFeedRows('account-1', channel, 1, 50, '', 'automatic');
        expect(exported.total).toBe(4);
        expect(exported.groups).toBeUndefined();
        expect(exported.rows.some((row) => row.rowType === 'group')).toBe(false);
    });

    it.each(['google', 'meta', 'pinterest', 'similar'])('shares parent descriptions on %s while preserving explicit variant copy and titles', async (channel) => {
        mockPrisma.wooProduct.findMany.mockResolvedValue([{
            ...base(1, { type: 'variable' }),
            seoData: {
                feedOverrides: { shared: { description: 'Shared product copy', '1-12:description': 'Custom variant copy' } },
                feedAiSuggestions: { shared: { '1-13:description': 'Variant AI copy' } },
            },
            variations: [11, 12, 13].map((wooId) => ({ wooId, price: '12', rawData: {
                description: 'Woo variant copy', attributes: [{ name: 'Color', option: `Color ${wooId}` }],
            } })),
        }]);
        const result = await FeedMappingService.getFeedRows('account-1', channel, 1, 50, '', 'all_variations');
        expect(result.rows.map((row) => value(row, 'description'))).toEqual(['Shared product copy', 'Custom variant copy', 'Variant AI copy']);
        expect(result.rows.map((row) => value(row, 'title'))).toEqual(['Product 1 - Color 11', 'Product 1 - Color 12', 'Product 1 - Color 13']);
    });

    it('restores parent inheritance by clearing only the requested variant description and AI copy', async () => {
        const seoData = {
            feedOverrides: { shared: { description: 'Parent', '1-11:description': 'Variant' } },
            feedAiSuggestions: { shared: { '1-11:description': 'AI copy', '1-12:description': 'Keep sibling' }, google: { '1-11:description': 'Legacy AI copy' } },
        };
        mockPrisma.wooProduct.findUnique.mockResolvedValue({ seoData });
        await FeedMappingService.saveRowOverrides('account-1', 'google', 1, { '1-11:description': null });
        const saved = mockPrisma.wooProduct.update.mock.calls[0][0].data.seoData;
        expect(saved.feedOverrides.shared).toEqual({ description: 'Parent' });
        expect(saved.feedAiSuggestions.shared).toEqual({ '1-12:description': 'Keep sibling' });
        expect(saved.feedAiSuggestions.google).toEqual({});
        expect(saved.feedDescriptionInheritance).toEqual({ '1-11': true });
        mockPrisma.wooProduct.findMany.mockResolvedValue([{
            ...base(1, { type: 'variable' }), seoData: { ...saved, feedOverrides: { shared: {} } },
            variations: [{ wooId: 11, price: '12', rawData: { description: 'Woo variant copy' } }],
        }]);
        const inherited = await FeedMappingService.getFeedRows('account-1', 'google', 1, 50, '', 'automatic');
        expect(value(inherited.rows[0], 'description')).toBe('A useful product');
    });

    it.each(['google', 'meta'])('does not invent a sale from a price fallback for non-sale products or variations on %s', async (channel) => {
        mockPrisma.accountFeature.findUnique.mockResolvedValue({ config: { mappings: { [channel]: [
            { targetField: 'sale_price', sourceField: 'salePrice', fallbackSourceField: 'price' },
        ] } } });
        mockPrisma.wooProduct.findMany.mockResolvedValue([
            base(1, { sale_price: '', on_sale: false }),
            { ...base(2, { type: 'variable' }), variations: [
                { wooId: 21, price: '12', rawData: { regular_price: '12', sale_price: '', on_sale: false } },
            ] },
        ]);
        const result = await FeedMappingService.getFeedRows('account-1', channel, 1, 50, '', 'automatic', undefined, true);
        expect(result.rows).toHaveLength(2);
        for (const row of result.rows) {
            expect(value(row, 'sale_price')).toBeNull();
            expect(row.issues.some((issue: any) => issue.field === 'sale_price')).toBe(false);
        }
        expect(result.health?.issues.some((issue) => issue.field === 'sale_price')).toBe(false);
        const xml = await FeedMappingService.getFeedExportXml('account-1', channel);
        expect(xml).not.toContain('<g:sale_price>');
    });

    it('keeps explicit sale overrides visible for validation when Woo has no sale', async () => {
        mockPrisma.wooProduct.findMany.mockResolvedValue([{
            ...base(1, { sale_price: '', on_sale: false }),
            seoData: { feedOverrides: { google: { sale_price: '8.00 AUD' } } },
        }]);
        const result = await FeedMappingService.getFeedRows('account-1', 'google', 1, 50, '', 'automatic');
        expect(value(result.rows[0], 'sale_price')).toBe('8.00 AUD');
        expect(result.rows[0].issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid_sale_price' })]));
    });

    it.each(['google', 'meta', 'pinterest', 'similar'])('resolves explicit SKU mappings from the product or variation on %s', async (channel) => {
        mockPrisma.accountFeature.findUnique.mockResolvedValue({ config: { mappings: { [channel]: [
            { targetField: 'mpn', sourceField: 'sku' },
            { targetField: 'gtin', sourceField: 'sku' },
        ] } } });
        mockPrisma.wooProduct.findMany.mockResolvedValue([{
            ...base(1), sku: '4006381333931', variations: [
                { wooId: 11, sku: '96385074', price: '12', rawData: {} },
                { wooId: 12, sku: '', price: '12', rawData: {} },
            ],
        }]);
        const result = await FeedMappingService.getFeedRows('account-1', channel, 1, 50, '', 'variable_and_variations');
        expect(result.rows.map((row) => value(row, 'mpn'))).toEqual(['4006381333931', '96385074', null]);
        expect(result.rows.map((row) => value(row, 'gtin'))).toEqual(['4006381333931', '96385074', null]);
        expect(result.rows[2].issues.some((issue: any) => issue.code === 'missing_identifiers')).toBe(false);
    });

    it('preserves explicit mapping, identifier and pricing overrides while reporting conflicts', async () => {
        mockPrisma.accountFeature.findUnique.mockResolvedValue({ config: { mappings: { google: [
            { targetField: 'sale_price', sourceField: 'salePrice', fallbackSourceField: 'price' },
        ] } } });
        mockPrisma.wooProduct.findMany.mockResolvedValue([{
            ...base(1), seoData: { feedOverrides: { google: { price: '20.00 AUD', mpn: 'REAL-MPN', identifier_exists: 'no' } } },
        }]);
        const result = await FeedMappingService.getFeedRows('account-1', 'google', 1, 50, '', 'variable_parent');
        expect(value(result.rows[0], 'price')).toBe('20.00 AUD');
        expect(value(result.rows[0], 'mpn')).toBe('REAL-MPN');
        expect(value(result.rows[0], 'identifier_exists')).toBe('no');
        expect(result.rows[0].issues.some((issue: any) => issue.code === 'identifier_conflict')).toBe(true);
        expect(result.mappings.find((mapping) => mapping.targetField === 'sale_price')?.fallbackSourceField).toBe('price');
    });

    it('groups Meta variants and exports real attributes without parent GTIN or parent sale inheritance', async () => {
        mockPrisma.wooProduct.findMany.mockResolvedValue([{
            ...base(1, { type: 'variable', global_unique_id: '4006381333931', attributes: [{ name: 'Material', options: ['Cotton'] }] }),
            variations: [{ wooId: 11, price: '12', stockStatus: 'instock', rawData: { attributes: [{ name: 'Colour', option: 'Blue' }, { name: 'Size', option: 'Large' }] } }],
        }]);
        const result = await FeedMappingService.getFeedRows('account-1', 'meta', 1, 50, '', 'all_variations');
        const row = result.rows[0];
        expect(value(row, 'id')).toBe('1-11');
        expect(value(row, 'item_group_id')).toBe('1');
        expect(value(row, 'color')).toBe('Blue');
        expect(value(row, 'size')).toBe('Large');
        expect(value(row, 'material')).toBe('Cotton');
        expect(value(row, 'gtin')).toBeNull();
        expect(value(row, 'sale_price')).toBeNull();
        expect(value(row, 'price')).toBe('12.00 AUD');
    });

    it('exports explicit backorder dates and suppresses them under the in-stock override', async () => {
        mockPrisma.wooProduct.findMany.mockResolvedValue([{ ...base(1, { backorders: 'yes', availability_date: '2026-12-01T12:00:00+1100' }), stockStatus: 'onbackorder' }]);
        let result = await FeedMappingService.getFeedRows('account-1', 'google', 1, 50, '', 'variable_parent');
        expect(value(result.rows[0], 'availability_date')).toBe('2026-12-01T01:00:00Z');
        mockPrisma.accountFeature.findUnique.mockResolvedValue({ config: { backordersAsInStock: true } });
        result = await FeedMappingService.getFeedRows('account-1', 'google', 1, 50, '', 'variable_parent');
        expect(value(result.rows[0], 'availability_date')).toBeNull();
        expect(result.rows[0].issues.some((issue: any) => issue.code === 'backorder_override')).toBe(true);
    });

    it('reports read-only health with exclusion reasons, context and duplicate GTINs', async () => {
        mockPrisma.accountFeature.findUnique.mockResolvedValue({ config: { excludeOutOfStockProducts: true, excludeUnpublishedProducts: true } });
        mockPrisma.wooProduct.findMany.mockResolvedValue([
            base(1, { global_unique_id: '4006381333931' }), base(2, { global_unique_id: '4006381333931' }),
            { ...base(3), stockStatus: 'outofstock' }, { ...base(4), status: 'draft' },
            { ...base(5), seoData: { excludeFromProductFeeds: true } },
        ]);
        const result = await FeedMappingService.getFeedRows('account-1', 'google', 1, 0, '', 'all_variations', undefined, true);
        expect(result.rows).toEqual([]);
        expect(result.health).toMatchObject({ scannedProducts: 5, included: 2, excluded: 3,
            exclusions: { 'Out of stock': 1, 'Unpublished product': 1, 'Explicit product exclusion': 1 } });
        expect(result.health?.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'duplicate_gtin', rowId: 'p:2', wooId: 2 })]));
        expect(mockPrisma.wooProduct.update).not.toHaveBeenCalled();
    });

    it('does not silently drop invalid products and permits explicit identifier controls', async () => {
        mockPrisma.wooProduct.findMany.mockResolvedValue([{ ...base(1), price: '', mainImage: null, rawData: { type: 'simple' } }]);
        const result = await FeedMappingService.getFeedRows('account-1', 'google', 1, 50, '', 'all_variations', undefined, true);
        expect(result.total).toBe(1);
        expect(result.health?.errors).toBeGreaterThan(0);
        expect(result.rows[0].issues.some((issue: any) => issue.field === 'price' && issue.code === 'missing_required')).toBe(true);
        mockPrisma.wooProduct.findUnique.mockResolvedValue({ seoData: { focusKeyword: 'mug' } });
        await FeedMappingService.saveRowOverrides('account-1', 'google', 1, { mpn: 'MAKER-1', identifier_exists: 'no', id: 'changed' });
        expect(mockPrisma.wooProduct.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { accountId_wooId: { accountId: 'account-1', wooId: 1 } },
            data: { seoData: { focusKeyword: 'mug', feedOverrides: { google: { mpn: 'MAKER-1', identifier_exists: 'no' }, shared: {} } } },
        }));
    });

    it.each([
        ['automatic', ['v:1-11', 'v:1-12']],
        ['variable_parent', ['p:1']], ['all_variations', ['v:1-11', 'v:1-12']],
        ['default_variation', ['v:1-12']], ['first_variation', ['v:1-11']],
        ['last_variation', ['v:1-12']], ['variable_and_variations', ['p:1', 'v:1-11', 'v:1-12']],
    ] as const)('keeps rows, references and health consistent for %s', async (mode, ids) => {
        mockPrisma.wooProduct.findMany.mockResolvedValue([{
            ...base(1, { type: 'variable', default_attributes: [{ name: 'Colour', option: 'Blue' }] }),
            variations: [
                { wooId: 11, price: '10', stockStatus: 'instock', rawData: { attributes: [{ name: 'Colour', option: 'Red' }] } },
                { wooId: 12, price: '10', stockStatus: 'instock', rawData: { attributes: [{ name: 'Colour', option: 'Blue' }] } },
            ],
        }]);
        const result = await FeedMappingService.getFeedRows('account-1', 'google', 1, 50, '', mode, undefined, true);
        const refs = await FeedMappingService.getFeedRowRefs('account-1', 'google', '', mode);
        expect(result.rows.map((row) => row.rowId)).toEqual(ids);
        expect(refs.rows.map((row) => row.rowId)).toEqual(ids);
        expect(result.health?.included).toBe(ids.length);
    });

    it('scans raw products in bounded batches and only retains requested rows', async () => {
        mockPrisma.wooProduct.findMany.mockResolvedValueOnce(Array.from({ length: 250 }, (_, index) => base(index + 1)))
            .mockResolvedValueOnce([base(251)]);
        const result = await FeedMappingService.getFeedRows('account-1', 'google', 2, 1, '', 'variable_parent');
        expect(result.total).toBe(251);
        expect(result.rows.map((row) => row.rowId)).toEqual(['p:2']);
        expect(mockPrisma.wooProduct.findMany.mock.calls[0][0]).toMatchObject({ where: { accountId: 'account-1' }, take: 250 });
        expect(mockPrisma.wooProduct.findMany.mock.calls[1][0]).toMatchObject({ cursor: { id: 'product-250' }, skip: 1, take: 250 });
    });

    it.each(['google', 'meta'])('automatically aligns mixed simple/variable records for %s without duplicate parent offers', async (channel) => {
        mockPrisma.wooProduct.findMany.mockResolvedValue([
            base(1),
            { ...base(2, { type: 'variable', attributes: [
                { id: 7, name: 'Colour', slug: 'pa_colour', variation: true, options: ['Blue', 'Red'] },
                { id: 8, name: 'Age Group', variation: true, options: ['Adult'] },
            ] }), variations: [
                { wooId: 21, price: '12', stockStatus: 'instock', rawData: { status: 'publish',
                    permalink: 'https://example.com/product/?attribute_pa_colour=blue', image: { src: 'https://example.com/blue.jpg' },
                    attributes: [{ id: 7, option: 'Blue' }, { id: 8, option: 'Adult' }], global_unique_id: '4006381333931' } },
                { wooId: 22, price: '15', stockStatus: 'outofstock', rawData: { status: 'publish',
                    permalink: 'https://example.com/product/?attribute_pa_colour=red', attributes: [{ id: 7, option: 'Red' }, { id: 8, option: 'Adult' }] } },
                { wooId: 23, price: '15', stockStatus: 'instock', rawData: { status: 'private' } },
            ] },
            { ...base(3), variations: [{ wooId: 31, price: '20', stockStatus: 'instock', rawData: {} }] },
        ]);
        const result = await FeedMappingService.getFeedRows('account-1', channel, 1, 50, '', 'automatic', undefined, true);
        const refs = await FeedMappingService.getFeedRowRefs('account-1', channel, '', 'automatic');
        expect(result.rows.map((row) => row.rowId)).toEqual(['p:1', 'v:2-21', 'v:2-22', 'v:3-31']);
        expect(refs.rows.map((row) => row.rowId)).toEqual(result.rows.map((row) => row.rowId));
        expect(result.health?.exclusions).toEqual({ 'Disabled or unpublished variation': 1 });
        expect(value(result.rows[0], 'item_group_id')).toBeNull();
        const blue = result.rows[1];
        expect(value(blue, 'item_group_id')).toBe('2');
        expect(value(blue, 'color')).toBe('Blue');
        expect(value(blue, 'age_group')).toBe('adult');
        expect(value(blue, 'price')).toBe('12.00 AUD');
        expect(value(blue, 'image_link')).toBe('https://example.com/blue.jpg');
        expect(value(blue, 'gtin')).toBe('4006381333931');
        expect(value(blue, 'link')).toBe('https://example.com/product/?attribute_pa_colour=blue');
        expect(value(result.rows[2], 'gtin')).toBeNull();
        expect(value(result.rows[2], 'availability')).toBe(channel === 'meta' ? 'out of stock' : 'out_of_stock');
        const exported = channel === 'google' ? await FeedMappingService.getFeedExportXml('account-1', channel)
            : await FeedMappingService.getFeedExportCsv('account-1', channel);
        expect(exported).toContain(channel === 'google' ? '<g:item_group_id>2</g:item_group_id>' : '"item_group_id"');
        expect(exported).not.toContain(channel === 'google' ? '<g:id>2</g:id>' : '"SKU-2"');
    });

    it.each(['google', 'meta'])('uses each parent title in automatic %s offers while retaining variant data', async (channel) => {
        const names = ['Ultimate Car Pack Bundle', "Personalised Shirt for Buck's Party", "Personalised Shirt for Hen's Night"];
        mockPrisma.wooProduct.findMany.mockResolvedValue(names.map((name, index) => ({
            ...base(index + 1, { type: 'variable' }), name,
            variations: ['Large', 'X-Large', '2X-Large'].map((size, option) => ({
                wooId: (index + 1) * 10 + option, price: String(12 + option),
                stockStatus: option === 2 ? 'outofstock' : 'instock',
                rawData: { attributes: [{ name: 'Size', option: size }, { name: 'Colour', option: 'Black' }] },
            })),
        })));
        const result = await FeedMappingService.getFeedRows('account-1', channel, 1, 50, '', 'automatic');
        expect(result.rows).toHaveLength(9);
        result.rows.forEach((row, index) => {
            const parent = Math.floor(index / 3);
            const option = index % 3;
            expect(value(row, 'title')).toBe(names[parent]);
            expect(value(row, 'item_group_id')).toBe(String(parent + 1));
            expect(value(row, 'id')).toBe(`${parent + 1}-${(parent + 1) * 10 + option}`);
            expect(value(row, 'size')).toBe(['Large', 'X-Large', '2X-Large'][option]);
            expect(value(row, 'color')).toBe('Black');
            expect(value(row, 'price')).toBe(`${12 + option}.00 AUD`);
            expect(value(row, 'availability')).toBe(option === 2
                ? channel === 'meta' ? 'out of stock' : 'out_of_stock'
                : channel === 'meta' ? 'in stock' : 'in_stock');
            expect(value(row, 'link')).toContain(`variation_id=${(parent + 1) * 10 + option}`);
        });
        const exported = channel === 'google' ? await FeedMappingService.getFeedExportXml('account-1', channel)
            : await FeedMappingService.getFeedExportCsv('account-1', channel);
        expect(exported).toContain('Ultimate Car Pack Bundle');
        expect(exported).not.toContain('Ultimate Car Pack Bundle -');

        const manual = await FeedMappingService.getFeedRows('account-1', channel, 1, 50, '', 'all_variations');
        expect(value(manual.rows[0], 'title')).toBe('Ultimate Car Pack Bundle - Large / Black');
        const pinterest = await FeedMappingService.getFeedRows('account-1', 'pinterest', 1, 50, '', 'automatic');
        expect(value(pinterest.rows[0], 'title')).toBe('Ultimate Car Pack Bundle - Large / Black');
    });

    it.each(['google', 'meta'])('preserves explicit and AI variant titles in automatic %s offers', async (channel) => {
        mockPrisma.wooProduct.findMany.mockResolvedValue([{
            ...base(1, { type: 'variable' }),
            seoData: {
                feedOverrides: { [channel]: { '1-11:title': 'Custom title' } },
                feedAiSuggestions: { [channel]: { '1-12:title': 'Saved AI title' } },
            },
            variations: [11, 12].map((wooId) => ({ wooId, price: '10', stockStatus: 'instock', rawData: {} })),
        }]);
        const result = await FeedMappingService.getFeedRows('account-1', channel, 1, 50, '', 'automatic');
        expect(result.rows.map((row) => value(row, 'title'))).toEqual(['Custom title', 'Saved AI title']);
    });

    it('reports missing synced variants and ambiguous options rather than inventing offers', async () => {
        mockPrisma.wooProduct.findMany.mockResolvedValue([
            base(1, { type: 'variable', variations: [11] }),
            { ...base(2, { type: 'variable', attributes: [{ id: 7, name: 'Colour', variation: true, options: ['Red', 'Blue'] }] }), variations: [
                { wooId: 21, price: '', stockStatus: 'instock', rawData: { attributes: [{ id: 7, option: '' }, { name: 'Engraving', option: 'Script' }] } },
            ] },
        ]);
        const result = await FeedMappingService.getFeedRows('account-1', 'google', 1, 50, '', 'automatic', undefined, true);
        expect(result.rows.map((row) => row.rowId)).toEqual(['v:2-21']);
        expect(result.health?.exclusions).toEqual({ 'Missing synced variations': 1 });
        expect(result.health?.issues.some((issue) => issue.code === 'missing_variations')).toBe(true);
        expect(result.rows[0].issues.map((issue: any) => issue.code)).toEqual(expect.arrayContaining(['missing_variant_attribute', 'ambiguous_variant_selection', 'unsupported_variant_dimensions', 'variant_link_selection']));
        expect(value(result.rows[0], 'color')).toBeNull();
        expect(value(result.rows[0], 'price')).toBeNull();
    });

    it('preserves manual modes, explicit variant overrides and other channels', async () => {
        mockPrisma.wooProduct.findMany.mockResolvedValue([{
            ...base(1, { type: 'variable' }), seoData: { feedOverrides: { google: { '1-11:color': 'Custom blue', '1-11:link': 'https://example.com/selected-blue' } } },
            variations: [{ wooId: 11, price: '10', stockStatus: 'instock', rawData: { status: 'private', attributes: [{ name: 'Colour', option: 'Blue' }] } }],
        }]);
        const manual = await FeedMappingService.getFeedRows('account-1', 'google', 1, 50, '', 'all_variations');
        expect(value(manual.rows[0], 'color')).toBe('Custom blue');
        expect(value(manual.rows[0], 'link')).toBe('https://example.com/selected-blue');
        expect((await FeedMappingService.getFeedRows('account-1', 'google', 1, 50, '', 'automatic')).rows).toEqual([]);
        expect((await FeedMappingService.getFeedRows('account-1', 'pinterest', 1, 50, '', 'automatic')).rows).toHaveLength(1);
    });
    it('flags inconsistent sibling dimensions and avoids duplicate or known other-variant gallery images', async () => {
        mockPrisma.wooProduct.findMany.mockResolvedValue([{
            ...base(1, { type: 'variable', images: [{ src: 'https://example.com/blue.jpg' }, { src: 'https://example.com/red.jpg' }, { src: 'https://example.com/shared.jpg' }, { src: 'https://example.com/shared.jpg' }] }),
            variations: [
                { wooId: 11, price: '10', stockStatus: 'instock', rawData: { image: { src: 'https://example.com/blue.jpg' }, attributes: [{ name: 'Colour', option: 'Blue' }] } },
                { wooId: 12, price: '10', stockStatus: 'instock', rawData: { image: { src: 'https://example.com/red.jpg' }, attributes: [{ name: 'Colour', option: 'Red' }, { name: 'Size', option: 'Large' }] } },
            ],
        }]);
        const result = await FeedMappingService.getFeedRows('account-1', 'google', 1, 50, '', 'automatic');
        expect(value(result.rows[0], 'additional_image_link')).toBe('https://example.com/shared.jpg');
        expect(result.rows[0].issues.some((issue: any) => issue.code === 'missing_variant_attribute' && issue.field === 'size')).toBe(true);
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
                meta_data: [{ key: '_tvpg_video_url', value: 'https://example.com/product.mp4' }],
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

    it('uses the main TVPG video for variations when inheritance is enabled', async () => {
        mockPrisma.wooProduct.findMany.mockResolvedValue([{
            id: 'product-1',
            wooId: 61082,
            name: 'Variable product',
            sku: 'VARIABLE',
            price: '39.95',
            stockStatus: 'instock',
            permalink: 'https://example.com/product',
            mainImage: 'https://example.com/image.jpg',
            seoData: {},
            rawData: {
                description: 'Description',
                meta_data: [
                    { key: '_tvpg_video_url', value: 'https://example.com/main.mp4' },
                    { key: '_tvpg_use_same_video', value: 'yes' },
                ],
            },
            variations: [{
                wooId: 61083,
                sku: 'VARIABLE-A',
                price: '39.95',
                stockStatus: 'instock',
                rawData: { meta_data: [{ key: '_tvpg_video_url', value: 'https://example.com/variation.mp4' }] },
            }],
        }]);

        const google = await FeedMappingService.getFeedRows('account-1', 'google', 1, 50, '', 'all_variations');

        expect(google.rows[0].columns.find((column: any) => column.targetField === 'video_link').finalValue)
            .toBe('https://example.com/main.mp4');
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
