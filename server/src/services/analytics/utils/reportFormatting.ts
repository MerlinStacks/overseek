export const escapeReportHtml = (value: unknown): string => String(value ?? 'Unavailable').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
export function reportCurrency(currency: unknown): string {
    if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency) || !Intl.supportedValuesOf('currency').includes(currency)) throw new Error('Report currency unavailable or unsupported');
    return currency;
}
export function reportNumber(value: unknown): string { return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US') : 'Unavailable'; }
