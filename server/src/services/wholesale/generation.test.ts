import path from 'path';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { normalizeWholesaleSnapshot } from './snapshot';
import { WholesaleGenerationService } from './generations';
import { imageCacheEntryFresh, imageDimensions, normalizeImageForPdf, oldestCacheEvictionCount } from './secureImage';
import { assertPrivateGenerationPath, generationPdfPath } from './storage';
import { validateSnapshotForRender, validateTermsFit, WholesaleRenderValidationError } from './renderer';

function snapshotFixture() {
    return normalizeWholesaleSnapshot({
        account: { id: 'account-1', name: 'Example Co', currency: 'aud', timezone: 'Australia/Sydney' },
        effectiveDate: new Date('2026-08-01T00:00:00.000Z'),
        validUntil: new Date('2026-08-30T23:59:59.999Z'),
        branding: { logoUrl: null, primaryColor: '#112233', accentColor: '#445566', businessDetails: {}, reviewedAt: new Date('2026-07-01') },
        defaults: {
            priceTaxBasis: 'EXCLUSIVE', gstRate: { toString: () => '10' },
            termsDocument: { sections: [{ heading: 'Orders', content: 'Order terms.' }] },
            confidentialityNotice: '', privacyNotice: '', version: 'v1', termsHash: 'hash', approvedAt: new Date('2026-07-01'),
        },
        catalog: {
            name: 'Trade', publicTitle: 'Trade 2026', subtitle: null, coverText: null, pricesIncludeTax: true,
            supplementaryPriceNotice: null, paymentCallout: { heading: 'Payment', content: 'Prepaid' }, termsSections: [{ heading: 'Orders', content: 'Order terms.' }],
            footerDetails: {}, defaultsVersion: 'v1',
            products: [{
                categoryLabel: null, isSuspended: false,
                product: {
                    id: 'product-1', wooId: 9, name: 'Zulu Cup', sku: 'zc-1', status: 'publish', stockStatus: 'instock', baseTurnaroundDays: 4,
                    mainImage: 'https://images.example.test/cup.jpg',
                    rawData: { regular_price: '19.9', categories: [{ id: 2, slug: 'awards', name: 'Awards' }] },
                    variations: [
                        { sku: 'BLUE', stockStatus: 'instock', images: [], rawData: { menu_order: 2, image: { src: 'https://images.example.test/blue.jpg' }, attributes: [{ name: 'Colour', option: 'Blue' }] } },
                        { sku: 'NAVY', stockStatus: 'instock', images: [], rawData: { menu_order: 1, image: { src: 'https://images.example.test/blue.jpg' }, attributes: [{ name: 'Colour', option: 'Navy' }] } },
                        { sku: 'RED', stockStatus: 'outofstock', images: [], rawData: {} },
                    ],
                    wholesaleProfile: {
                        imageUrl: null, notesDocument: '  Gift boxed  ', personalisationTypes: ['UV'], priceTaxBasis: 'INCLUSIVE', priceSetVersion: 3,
                        priceTiers: [{ minimumQuantity: 10, unitPrice: { toString: () => '7.5' }, isPoa: false, leadTimeDays: 7 }],
                    },
                },
            }],
        },
    });
}

describe('wholesale generation snapshot', () => {
    it('normalizes immutable pricing, category, RRP and unique in-stock variants', () => {
        const snapshot = snapshotFixture();
        expect(snapshot.account.currency).toBe('AUD');
        expect(snapshot.categories[0].label).toBe('Awards');
        expect(snapshot.categories[0].products[0]).toMatchObject({
            name: 'Zulu Cup', sku: 'zc-1', displayRrp: '$21.89', rrpAmount: '21.89', notes: 'Gift boxed',
            gstStatement: 'Prices include 10% GST',
            baseTurnaroundDays: 4,
            tiers: [{ minimumQuantity: 10, rangeLabel: '10+', unitPriceAmount: '8.25', displayUnitPrice: '$8.25', displaySaving: 'Save $13.64/unit', isPoa: false, leadTimeDays: 7 }],
            variantGroups: [{ imageUrl: 'https://images.example.test/blue.jpg', labels: ['Colour: Navy | SKU NAVY', 'Colour: Blue | SKU BLUE'] }],
        });
    });

    it('uses stored category order, Products fallback, alphabetical products and raw Woo image fallback', () => {
        const input: any = snapshotFixture();
        input.categories = [
            { key: 'late', label: 'Late', products: [{ ...input.categories[0].products[0], id: 'z', name: 'Zulu' }] },
        ];
        const base: any = {
            id: 'p', wooId: 1, sku: 'SKU', status: 'publish', stockStatus: 'instock', mainImage: null,
            rawData: { images: [{ src: 'https://images.example.test/raw.jpg' }], categories: [] }, variations: [],
            wholesaleProfile: { imageUrl: 'https://images.example.test/legacy-override.jpg', notesDocument: null, personalisationTypes: [], priceTaxBasis: 'EXCLUSIVE', priceSetVersion: 1, priceTiers: [{ minimumQuantity: 1, unitPrice: 1, isPoa: false }] },
        };
        const source: any = {
            account: { id: 'a', name: 'A', currency: 'USD', timezone: 'UTC' }, effectiveDate: new Date(), validUntil: new Date(Date.now() + 1000),
            branding: {}, defaults: { gstRate: 10, priceTaxBasis: 'EXCLUSIVE' },
            catalog: { products: [
                { categoryKey: 'second', categoryLabel: 'Second', categorySortOrder: 2, product: { ...base, id: '2', name: 'Bravo' } },
                { categoryKey: null, categoryLabel: null, categorySortOrder: 0, product: { ...base, id: '1', name: 'Zulu' } },
                { categoryKey: null, categoryLabel: null, categorySortOrder: 0, product: { ...base, id: '3', name: 'Alpha' } },
            ] },
        };
        const snapshot = normalizeWholesaleSnapshot(source);
        expect(snapshot.categories.map(category => category.label)).toEqual(['Products', 'Second']);
        expect(snapshot.categories[0].products.map(product => product.name)).toEqual(['Alpha', 'Zulu']);
        expect(snapshot.categories[0].products[0].imageUrl).toBe('https://images.example.test/raw.jpg');
        expect(snapshot.categories[0].products[0]).not.toHaveProperty('displayRrp');
    });
});

describe('wholesale validity timezone', () => {
    it('resolves end-of-day across Sydney daylight saving boundaries', () => {
        expect(WholesaleGenerationService.endOfDayInTimezone('2026-10-04', 'Australia/Sydney').toISOString()).toBe('2026-10-04T12:59:59.999Z');
        expect(WholesaleGenerationService.endOfDayInTimezone('2026-04-05', 'Australia/Sydney').toISOString()).toBe('2026-04-05T13:59:59.999Z');
    });
});

describe('wholesale image dimensions', () => {
    it('expires private cache entries at their bounded TTL', () => {
        expect(imageCacheEntryFresh(1_001, 1_000)).toBe(true);
        expect(imageCacheEntryFresh(1_000, 1_000)).toBe(false);
        expect(oldestCacheEvictionCount([40, 40, 40], 100)).toBe(1);
        expect(oldestCacheEvictionCount([50, 60, 70], 100)).toBe(2);
    });
    it('parses PNG dimensions and rejects decompression-bomb dimensions', () => {
        const png = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png); png.writeUInt32BE(1200, 16); png.writeUInt32BE(800, 20);
        expect(imageDimensions(png)).toEqual({ width: 1200, height: 800, type: 'png' });
        png.writeUInt32BE(10000, 16); png.writeUInt32BE(5000, 20);
        expect(() => imageDimensions(png)).toThrow(/dimensions/);
    });

    it('parses WebP canvas dimensions before handing image data to PDFKit', () => {
        const webp = Buffer.alloc(30); webp.write('RIFF', 0, 'ascii'); webp.write('WEBP', 8, 'ascii'); webp.write('VP8X', 12, 'ascii'); webp.writeUIntLE(639, 24, 3); webp.writeUIntLE(479, 27, 3);
        expect(imageDimensions(webp)).toEqual({ width: 640, height: 480, type: 'webp' });
    });

    it('converts WebP image data to a PDFKit-compatible PNG', async () => {
        const webp = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#336699' } }).webp().toBuffer();
        const normalized = await normalizeImageForPdf(webp);
        expect(imageDimensions(normalized)).toEqual({ width: 2, height: 2, type: 'png' });
        const doc = new PDFDocument();
        expect(() => doc.image(normalized)).not.toThrow();
        doc.end();
    });
});

describe('wholesale private storage', () => {
    it('contains generated UUID paths beneath the configured private root', () => {
        const root = path.resolve('/tmp/overseek-private-test');
        const generated = generationPdfPath('123e4567-e89b-42d3-a456-426614174000', false, root);
        expect(generated.startsWith(`${root}${path.sep}`)).toBe(true);
        expect(assertPrivateGenerationPath(generated, root)).toBe(generated);
        expect(() => assertPrivateGenerationPath('/tmp/public/master.pdf', root)).toThrow(/escapes storage root/);
        expect(() => generationPdfPath('../public', false, root)).toThrow(/identifier/);
    });
});

describe('wholesale renderer validation', () => {
    it('accepts a complete snapshot and blocks terms that cannot fit at 8pt', () => {
        const snapshot = snapshotFixture();
        expect(validateSnapshotForRender(snapshot).products).toHaveLength(1);
        const overflowing = { ...snapshot, catalog: { ...snapshot.catalog, termsSections:
            Array.from({ length: 12 }, (_, index) => ({ heading: `Long term ${index + 1}`, content: 'word '.repeat(1000) })),
        } };
        const doc = new PDFDocument({ size: 'A4', layout: 'landscape' });
        expect(() => validateTermsFit(doc, overflowing, 8)).toThrow(WholesaleRenderValidationError);
        doc.end();
    });
});
