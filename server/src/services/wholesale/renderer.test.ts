import { describe, expect, it } from 'vitest';
import {
    distributeTermsAcrossColumns,
    GRID_PAGE_CAPACITY,
    paginateGridProducts,
    processOverflowLabels,
    productNeedsDedicatedPage,
    availableVariantGroups,
    logoFailureWarning,
    priceNoticeText,
} from './renderer';

describe('wholesale renderer layout helpers', () => {
    it('paginates simple products into deterministic eight-card pages', () => {
        const products = Array.from({ length: 18 }, (_, index) => index + 1);

        expect(GRID_PAGE_CAPACITY).toBe(8);
        expect(paginateGridProducts(products)).toEqual([
            [1, 2, 3, 4, 5, 6, 7, 8],
            [9, 10, 11, 12, 13, 14, 15, 16],
            [17, 18],
        ]);
    });

    it('uses a dedicated page for variant galleries or measured card overflow', () => {
        expect(productNeedsDedicatedPage({ variantGroups: [{ imageUrl: 'variant.jpg' }] }, 20, 200)).toBe(true);
        expect(productNeedsDedicatedPage({ variantGroups: [] }, 201, 200)).toBe(true);
        expect(productNeedsDedicatedPage({ variantGroups: [] }, 200, 200)).toBe(false);
    });

    it('balances ordered terms across exactly three fitting columns', () => {
        const columns = distributeTermsAcrossColumns([40, 40, 40, 40, 40, 40], 100);

        expect(columns).toEqual([[40, 40], [40, 40], [40, 40]]);
        expect(distributeTermsAcrossColumns([101, 10], 100)).toBeNull();
    });

    it('names only hidden process methods after the first three fixed icons', () => {
        expect(processOverflowLabels(['UV', 'ENGRAVE', 'DTF', 'EMBROIDERY', 'SUBLIMATE'])).toEqual({
            visible: ['ENGRAVE', 'SUBLIMATE', 'UV'],
            hidden: ['DTF', 'EMBROIDERY'],
            hiddenLabel: 'More processes: DTF transfer, Embroidery',
        });
        expect(processOverflowLabels(['UV'])).toMatchObject({ hidden: [], hiddenLabel: '' });
    });

    it('omits failed variation thumbnails while retaining compact option labels', () => {
        expect(availableVariantGroups([
            { imageUrl: 'ok.jpg', labels: ['Blue'] },
            { imageUrl: 'failed.jpg', labels: ['Red | SKU RED', 'Green | SKU GREEN'] },
        ], new Set(['ok.jpg']))).toEqual({
            available: [{ imageUrl: 'ok.jpg', labels: ['Blue'] }],
            omittedLabels: ['Red | SKU RED', 'Green | SKU GREEN'],
        });
        expect(logoFailureWarning('https://cdn.test/logo.svg?rev=1')).toBe('BRANDING_LOGO_SVG_UNSUPPORTED_REVIEW_REQUIRED');
        expect(priceNoticeText({ catalog: { supplementaryPriceNotice: 'Freight is additional' } } as any)).toBe('Freight is additional');
    });
});
