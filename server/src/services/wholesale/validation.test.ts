import { describe, expect, it } from 'vitest';
import {
    deriveWooCategory,
    getProductReadiness,
    inferTierRanges,
    normalizeNotes,
    priceTiersSchema,
    stableHash,
} from './validation';

describe('wholesale tier validation', () => {
    it('accepts descending numeric prices followed by POA', () => {
        const result = priceTiersSchema.safeParse([
            { minimumQuantity: 10, unitPrice: '12.5000', isPoa: false },
            { minimumQuantity: 25, unitPrice: 10, isPoa: false },
            { minimumQuantity: 100, unitPrice: null, isPoa: true },
        ]);
        expect(result.success).toBe(true);
    });

    it.each([
        [[{ minimumQuantity: 10, unitPrice: 10, isPoa: false }, { minimumQuantity: 5, unitPrice: 9, isPoa: false }]],
        [[{ minimumQuantity: 10, unitPrice: 10, isPoa: false }, { minimumQuantity: 20, unitPrice: 11, isPoa: false }]],
        [[{ minimumQuantity: 10, unitPrice: null, isPoa: true }, { minimumQuantity: 20, unitPrice: 9, isPoa: false }]],
        [[{ minimumQuantity: 10, unitPrice: 10, isPoa: true }]],
        [[{ minimumQuantity: 10, unitPrice: null, isPoa: false }]],
    ])('rejects invalid tier sequences', tiers => {
        expect(priceTiersSchema.safeParse(tiers).success).toBe(false);
    });

    it('infers bounded and open-ended quantity labels', () => {
        expect(inferTierRanges([
            { minimumQuantity: 1 },
            { minimumQuantity: 10 },
            { minimumQuantity: 25 },
        ])).toEqual([
            { minimumQuantity: 1, rangeLabel: '1-9' },
            { minimumQuantity: 10, rangeLabel: '10-24' },
            { minimumQuantity: 25, rangeLabel: '25+' },
        ]);
    });
});

describe('wholesale product helpers', () => {
    it('uses in-stock variations while retaining parent requirements', () => {
        expect(getProductReadiness({
            status: 'publish',
            sku: 'PARENT-1',
            stockStatus: 'outofstock',
            mainImage: 'https://example.test/image.jpg',
            variations: [{ stockStatus: 'instock' }],
            wholesaleProfile: { priceTiers: [{}] },
        }).eligible).toBe(true);
    });

    it('does not require an RRP and rejects missing parent SKU', () => {
        const readiness = getProductReadiness({
            status: 'publish',
            sku: null,
            stockStatus: 'instock',
            wholesaleProfile: { imageUrl: 'https://example.test/profile.jpg', priceTiers: [{}] },
        });
        expect(readiness).toMatchObject({ eligible: false, hasSku: false, hasImage: true, hasPriceTiers: true });
    });

    it('normalizes plain notes and derives the first safe Woo category', () => {
        expect(normalizeNotes('  Add   tissue paper  ')).toBe('Add tissue paper');
        expect(deriveWooCategory({ categories: [null, { id: 7, name: ' Awards ', menu_order: 3 }, { id: 8, name: 'Other' }] }))
            .toEqual({ key: '7', label: 'Awards', sortOrder: 3 });
    });

    it('creates stable hashes independent of object key insertion order', () => {
        expect(stableHash({ b: 2, a: { d: 4, c: 3 } })).toBe(stableHash({ a: { c: 3, d: 4 }, b: 2 }));
    });
});
