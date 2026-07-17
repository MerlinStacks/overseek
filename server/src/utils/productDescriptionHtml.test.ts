import { describe, expect, it } from 'vitest';
import { validateProductDescriptionHtml } from './productDescriptionHtml';

describe('validateProductDescriptionHtml', () => {
    it('accepts supported product description markup', () => {
        const html = '<p><strong>Durable</strong> and <em>comfortable</em>.</p><ul><li>One</li></ul>';

        expect(validateProductDescriptionHtml(html)).toBe(html);
    });

    it('accepts safe absolute and relative links', () => {
        const html = '<p><a href="https://example.com/item">Item</a> <a href="/category">Category</a></p>';

        expect(validateProductDescriptionHtml(html)).toBe(html);
    });

    it('removes an enclosing HTML code fence', () => {
        expect(validateProductDescriptionHtml('```html\n<p>Product</p>\n```')).toBe('<p>Product</p>');
    });

    it.each([
        '<script>alert(1)</script>',
        '<p onclick="alert(1)">Product</p>',
        '<a href="javascript:alert(1)">Product</a>',
        '<img src="https://example.com/tracker.gif">',
        '<p>Product</p><script',
    ])('rejects unsafe or malformed markup: %s', (html) => {
        expect(() => validateProductDescriptionHtml(html)).toThrow();
    });
});
