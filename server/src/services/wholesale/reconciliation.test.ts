import { describe, expect, it } from 'vitest';
import { wholesaleDisplayChanged } from './reconciliation';

const product = {
    id: 'product-1', name: 'Cup', sku: 'CUP-1', stockStatus: 'instock', mainImage: 'main.jpg',
    rawData: { regular_price: '20', images: [{ src: 'main.jpg' }], categories: [{ slug: 'cups', name: 'Cups' }] },
    wholesaleProfile: { imageUrl: null },
    variations: [{ sku: 'BLUE', stockStatus: 'instock', images: [], rawData: { image: { src: 'blue.jpg' }, attributes: [{ name: 'Colour', option: 'Blue' }] } }],
};
const snapshotProduct = {
    id: 'product-1', name: 'Cup', sku: 'CUP-1', sourceRrp: '20', imageUrl: 'main.jpg',
    stockFingerprint: 'instock|instock', variantGroups: [{ imageUrl: 'blue.jpg', labels: ['Colour: Blue | SKU BLUE'] }],
};

describe('wholesale Woo display reconciliation', () => {
    it('recognizes unchanged displayed product data', () => {
        expect(wholesaleDisplayChanged(snapshotProduct, { key: 'cups', label: 'Cups' }, product)).toBe(false);
    });

    it.each([
        ['name', { name: 'New Cup' }],
        ['sku', { sku: 'NEW-SKU' }],
        ['stock', { stockStatus: 'outofstock' }],
        ['image', { mainImage: 'new.jpg', rawData: { ...product.rawData, images: [{ src: 'new.jpg' }] } }],
        ['RRP', { rawData: { ...product.rawData, regular_price: '21' } }],
    ])('marks a generation stale for a displayed %s change', (_label, change) => {
        expect(wholesaleDisplayChanged(snapshotProduct, { key: 'cups', label: 'Cups' }, { ...product, ...change })).toBe(true);
    });

    it('detects first-category and variation option changes', () => {
        expect(wholesaleDisplayChanged(snapshotProduct, { key: 'old', label: 'Old' }, product)).toBe(true);
        const changed = { ...product, variations: [{ ...product.variations[0], sku: 'NAVY' }] };
        expect(wholesaleDisplayChanged(snapshotProduct, { key: 'cups', label: 'Cups' }, changed)).toBe(true);
    });
});
