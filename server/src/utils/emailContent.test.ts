import { describe, expect, it } from 'vitest';
import { emailPlainText, ensureEmailDocument } from './emailContent';

describe('email content', () => {
    it('preserves complete templates and wraps inbox fragments once', () => {
        const html = ensureEmailDocument('<p>Reply</p>');
        expect(html).toContain('<body><p>Reply</p></body>');
        expect(ensureEmailDocument(html)).toBe(html);
    });

    it('converts entities and links without CSS, hidden preheaders or tracking images', () => {
        const text = emailPlainText('<html><head><style>body {color:red}</style></head><body><div style="display:none">Hidden preview</div><p>Thanks &amp; welcome!</p><a href="https://shop.test/preferences">Preferences</a><img src="https://track.test/pixel" alt="tracking"></body></html>');
        expect(text).toContain('Thanks & welcome!');
        expect(text).toContain('https://shop.test/preferences');
        expect(text).not.toMatch(/Hidden preview|color:red|track.test|tracking/);
    });
});
