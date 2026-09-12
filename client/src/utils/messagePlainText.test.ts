import { describe, expect, it } from 'vitest';
import { messageToPlainText } from './messagePlainText';

describe('messageToPlainText', () => {
    it('preserves paragraphs, line breaks and decoded entities without markup', () => {
        expect(messageToPlainText('<p>Hello <strong>Sam</strong> &amp; Alex,</p><p>Thanks!<br>Support&nbsp;team &#128075;</p>'))
            .toBe('Hello Sam & Alex,\n\nThanks!\nSupport team 👋');
    });

    it('keeps useful link destinations and list items', () => {
        expect(messageToPlainText('<ul><li>Check <a href="https://example.com/order">your order</a></li><li>Reply here</li></ul>'))
            .toBe('• Check your order (https://example.com/order)\n\n• Reply here');
    });

    it('drops unsafe content without interpreting escaped literal markup', () => {
        expect(messageToPlainText('<p>&lt;strong&gt;example&lt;/strong&gt;</p><script>alert(1)</script><a href="javascript:alert(1)">Link</a>'))
            .toBe('<strong>example</strong>\nLink');
    });

    it('leaves plain-text drafts unchanged', () => {
        const text = 'Hello\n\n  2 < 3 & 4 > 1\nThanks!';
        expect(messageToPlainText(text)).toBe(text);
    });
});
