/** First grapheme, preserving non-BMP letters and combining marks. */
function initial(value: string): string {
    const segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: string }) => { segment: (text: string) => Iterable<{ segment: string }> } }).Segmenter;
    const first = segmenter ? Array.from(new segmenter(undefined, { granularity: 'grapheme' }).segment(value))[0]?.segment : Array.from(value)[0];
    return (first || '').toLocaleUpperCase();
}
const name = (value: unknown) => typeof value === 'string' ? value.trim() : '';
export function getInitials(value: unknown, lastName?: unknown): string {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const object = value as Record<string, unknown>;
        const first = name(object.firstName); const last = name(object.lastName);
        if (first || last) return initial(first) + initial(last) || '?';
        value = name(object.name);
    }
    const first = name(value); const last = name(lastName);
    if (last) return initial(first) + initial(last) || '?';
    const parts = first.split(/\s+/).filter(Boolean);
    return parts.length ? initial(parts[0]) + (parts.length > 1 ? initial(parts[parts.length - 1]) : '') : '?';
}
/** Invalid runtime inputs fail closed rather than returning an unescaped value. */
export function escapeRegex(value: unknown): string {
    if (typeof value !== 'string') throw new TypeError('Expected a string to escape');
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
