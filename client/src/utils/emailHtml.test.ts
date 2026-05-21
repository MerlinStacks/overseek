import { describe, expect, it } from 'vitest';
import { getEmailDesignWarnings, sanitizeEmailHtml, sanitizeEmailPaste } from './emailHtml';

describe('emailHtml', () => {
    it('removes unsafe tags, handlers, and javascript links', () => {
        const result = sanitizeEmailHtml('<p onclick="bad()">Hi <script>alert(1)</script><a href="javascript:alert(1)">click</a></p>');

        expect(result).toBe('<p>Hi <a>click</a></p>');
    });

    it('keeps selected email-safe inline formatting and styles', () => {
        const result = sanitizeEmailHtml('<p><strong>Bold</strong> <span style="font-size:18px;position:absolute;color:#111">text</span></p>');

        expect(result).toBe('<p><strong>Bold</strong> <span style="font-size:18px;color:#111">text</span></p>');
    });

    it('converts plain text paste to paragraphs', () => {
        const result = sanitizeEmailPaste('', 'Line one\nLine two\n\nNext');

        expect(result).toBe('<p>Line one<br>Line two</p><p>Next</p>');
    });

    it('reports common designer edge cases', () => {
        const warnings = getEmailDesignWarnings({
            document: {
                sections: [{
                    id: 'section-1',
                    name: 'Hero',
                    visibility: 'desktop',
                    columns: [{
                        id: 'column-1',
                        blocks: [
                            { id: 'image-1', type: 'image', props: { alt: '' } },
                            { id: 'button-1', type: 'button', props: { href: '' } },
                            { id: 'text-1', type: 'text', visibility: 'mobile', props: { html: '<script>bad()</script>' } },
                        ],
                    }],
                }],
            },
        });

        expect(warnings.map((warning) => warning.id)).toEqual(['alt-image-1', 'button-link-button-1', 'unsafe-text-text-1', 'hidden-text-1']);
    });
});
