const SIMPLE_TAG = /^<\/?(?:p|strong|em|u|ul|ol|li)>$/i;
const LINE_BREAK_TAG = /^<br\s*\/?>$/i;
const CLOSING_LINK_TAG = /^<\/a>$/i;
const OPENING_LINK_TAG = /^<a href="(https?:\/\/[^"<>\s]+|\/[^"<>\s]*)">$/i;

export function validateProductDescriptionHtml(value: string): string {
    const html = value
        .trim()
        .replace(/^```html\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();

    if (!html) {
        throw new Error('AI returned an empty product description');
    }

    let textStart = 0;
    for (const match of html.matchAll(/<[^>]*>/g)) {
        const text = html.slice(textStart, match.index);
        if (text.includes('<')) {
            throw new Error('AI returned malformed HTML');
        }

        const tag = match[0];
        if (
            !SIMPLE_TAG.test(tag)
            && !LINE_BREAK_TAG.test(tag)
            && !CLOSING_LINK_TAG.test(tag)
            && !OPENING_LINK_TAG.test(tag)
        ) {
            throw new Error(`AI returned unsupported HTML: ${tag}`);
        }

        textStart = match.index + tag.length;
    }

    if (html.slice(textStart).includes('<')) {
        throw new Error('AI returned malformed HTML');
    }

    return html;
}
