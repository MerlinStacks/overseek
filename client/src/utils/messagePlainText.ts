import DOMPurify from 'dompurify';

/** Convert rich-text reply sources for the mobile plain-text composer, not typed drafts. */
export function messageToPlainText(value: string): string {
    // Leave actual plain text (including angle brackets and whitespace) alone.
    if (!/<\/?[a-z][^>]*>/i.test(value)) return value;

    const fragment = DOMPurify.sanitize(value, { RETURN_DOM_FRAGMENT: true });
    const read = (node: Node): string => {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
        if (!(node instanceof Element)) return Array.from(node.childNodes).map(read).join('');
        const text = Array.from(node.childNodes).map(read).join('');
        const tag = node.tagName.toLowerCase();
        if (tag === 'br') return '\n';
        if (tag === 'a') {
            const href = node.getAttribute('href');
            return href && /^(https?:|mailto:|tel:)/i.test(href) && text.trim() !== href
                ? `${text} (${href})` : text;
        }
        if (tag === 'li') return `\n• ${text.trim()}\n`;
        if (/^(p|div|h[1-6]|blockquote|ul|ol|pre|tr)$/.test(tag)) return `\n${text}\n`;
        if (tag === 'td' || tag === 'th') return `${text}\t`;
        return text;
    };

    return read(fragment)
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
