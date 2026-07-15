import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/prisma', () => ({
    prisma: {
        wooProduct: {
            findMany: vi.fn(),
        },
    },
}));

import { prisma } from '../../utils/prisma';
import { loadDynamicEmailProducts, resolveMergeTagsWithDynamicProducts } from '../MergeTagResolver';

const product = {
    name: 'Public product',
    price: '29.95',
    permalink: 'https://shop.example.com/product/public-product',
    mainImage: 'https://shop.example.com/product.jpg',
    images: [],
    rawData: {
        short_description: '<p>A useful product.</p>',
    },
};

describe('dynamic new product merge tags', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(prisma.wooProduct.findMany).mockResolvedValue([product] as any);
    });

    it('loads only public catalog products in WooCommerce creation order', async () => {
        await loadDynamicEmailProducts('account-1');

        expect(prisma.wooProduct.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                accountId: 'account-1',
                status: 'publish',
                catalogVisibility: { in: ['visible', 'catalog', 'search'] },
                permalink: { not: null },
            },
            orderBy: { dateCreated: { sort: 'desc', nulls: 'last' } },
            take: 6,
        }));
    });

    it('renders responsive themed cells using the account currency', async () => {
        const html = await resolveMergeTagsWithDynamicProducts(
            '{{new_products count:1 columns:2 showDescription:true showButton:true buttonLabel:Shop%20now textColor:%23112233 mutedTextColor:%23445566 primaryColor:%23778899 borderRadius:4}}',
            { accountId: 'account-1', currency: 'GBP' },
            [product]
        );

        expect(html).toContain('class="os-mobile-block"');
        expect(html).toContain('class="os-mobile-hidden"');
        expect(html).toContain('color:#112233');
        expect(html).toContain('background:#778899');
        expect(html).toContain('border-radius:4px');
        expect(html).toContain('GBP');
        expect(html).not.toContain('AUD');
        expect(html).toContain('Shop now');
        expect(prisma.wooProduct.findMany).not.toHaveBeenCalled();
    });

    it('falls back safely for malformed encoded options and unsafe links', async () => {
        const html = await resolveMergeTagsWithDynamicProducts(
            '{{new_products columns:1 buttonLabel:%E0%A4%A}}',
            { accountId: 'account-1', currency: 'USD' },
            [{ ...product, permalink: 'javascript:alert(1)' }]
        );

        expect(html).toContain('View Product');
        expect(html).toContain('href="#"');
    });
});
