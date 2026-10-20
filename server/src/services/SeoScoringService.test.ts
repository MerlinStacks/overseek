import { Prisma, type WooProduct } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { SeoScoringService } from './SeoScoringService';

function product(overrides: Record<string, unknown> = {}): Partial<WooProduct> {
    return {
        name: 'Travel Mug', permalink: 'https://example.com/travel-mug', price: new Prisma.Decimal('29.95'),
        rawData: {
            description: 'A travel mug that keeps your favourite coffee warm on the way to work every morning.',
            images: [{ src: 'https://example.com/mug.jpg' }],
        },
        ...overrides,
    } as Partial<WooProduct>;
}

const calculate = SeoScoringService.calculateScore;

describe('SeoScoringService', () => {
    it('preserves complete-product scoring and returns positive messages for passing checks', () => {
        const result = calculate(product(), 'travel mug');
        expect(result.score).toBe(100);
        expect(result.tests).toHaveLength(7);
        expect(result.tests.every(test => test.passed && test.message.endsWith('passed.'))).toBe(true);
    });

    it('preserves existing scoring weights and no-keyword penalty', () => {
        expect(calculate(product()).score).toBe(47);
        expect(calculate(product({ name: '' }), 'travel mug').score).toBe(65);
        expect(calculate({}).score).toBe(0);
    });

    it.each([null, [], 'invalid', 42, { description: {}, short_description: 42, images: {} }])(
        'handles malformed WooCommerce JSON without throwing: %j', rawData => {
            const result = calculate(product({ rawData }), 'travel mug');
            expect(result.tests.find(test => test.test === 'Product Description')?.passed).toBe(false);
            expect(result.tests.find(test => test.test === 'Images')?.passed).toBe(false);
        },
    );

    it('does not count HTML markup, link destinations, images, scripts or styles as description content', () => {
        const description = '<p data-keyword="travel mug">Hi</p><a href="https://example.com/travel-mug">Link</a>' +
            '<img alt="travel mug"><script>travel mug</script><style>/* travel mug */</style>';
        const result = calculate(product({ rawData: { description } }), 'travel mug');
        expect(result.tests.find(test => test.test === 'Product Description')?.passed).toBe(false);
        expect(result.tests.find(test => test.test === 'Keyword in Description')?.passed).toBe(false);
    });

    it('decodes entities and preserves word boundaries between HTML blocks', () => {
        const result = calculate(product({ rawData: { description: '<p>Travel</p><p>Mug &amp; Coffee</p>' } }), 'mug & coffee');
        expect(result.tests.find(test => test.test === 'Keyword in Description')?.passed).toBe(true);
    });

    it('does not form a keyword by joining long and short descriptions without a space', () => {
        const result = calculate(product({ rawData: { description: 'travel', short_description: 'mug' } }), 'travelmug');
        expect(result.tests.find(test => test.test === 'Keyword in Description')?.passed).toBe(false);
    });

    it('still accepts sufficient short-description content', () => {
        const result = calculate(product({ rawData: { short_description: 'A'.repeat(51) } }));
        expect(result.tests.find(test => test.test === 'Product Description')?.passed).toBe(true);
    });

    it.each(['', ' ', '\t\n'])('treats blank keywords as missing: %j', keyword => {
        expect(calculate(product(), keyword)).toEqual(calculate(product()));
    });

    it('trims and normalizes keyword whitespace', () => {
        expect(calculate(product(), '  travel   mug  ')).toEqual(calculate(product(), 'travel mug'));
    });

    it.each([[], [null], [{ src: ' ' }], 'not-an-array'])('rejects unusable images: %j', images => {
        const result = calculate(product({ rawData: { images } }));
        expect(result.tests.find(test => test.test === 'Images')?.passed).toBe(false);
    });

    it.each([0, new Prisma.Decimal(0)])('recognizes a zero price as supplied: %s', price => {
        expect(calculate(product({ price })).tests.find(test => test.test === 'Price')?.passed).toBe(true);
    });

    it.each([null, -1, new Prisma.Decimal(-1), '', 'invalid', Infinity])('rejects invalid prices: %s', price => {
        expect(calculate(product({ price })).tests.find(test => test.test === 'Price')?.passed).toBe(false);
    });
});
