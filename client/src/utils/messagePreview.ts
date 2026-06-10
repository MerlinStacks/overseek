export function decodeHtmlEntities(value: string): string {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
        .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)));
}

export function htmlToPreviewText(value: string): string {
    return decodeHtmlEntities(value)
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<br\s*\/?\s*>/gi, ' ')
        .replace(/<\/(p|div|li|tr|td|th|h[1-6])>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
