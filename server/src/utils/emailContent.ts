import { convert } from 'html-to-text';

/** Inbox editors produce fragments; transports should send complete documents. */
export function ensureEmailDocument(html: string): string {
    return /<html\b/i.test(html)
        ? html
        : `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
}

/** Preserve readable links while excluding tracking images and hidden preview text. */
export function emailPlainText(html: string): string {
    return convert(html, {
        wordwrap: 78,
        selectors: [
            { selector: 'img', format: 'skip' },
            { selector: '[style*="display:none"]', format: 'skip' },
            { selector: '[style*="display: none"]', format: 'skip' },
            { selector: 'a', options: { hideLinkHrefIfSameAsText: true } }
        ]
    });
}
