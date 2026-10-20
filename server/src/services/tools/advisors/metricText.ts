/** Strict parsing for the formatted metrics produced by the ads tools. */
export function metricText(value: unknown, suffix?: 'x' | '%'): number | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().replace(/^(?:[A-Z]{3}\s+|[$€£])/, '').replace(/,/g, '');
    const number = suffix ? normalized.replace(new RegExp(`${suffix}$`), '') : normalized;
    if (!/^\d+(?:\.\d+)?$/.test(number)) return null;
    const result = Number(number);
    return Number.isFinite(result) ? result : null;
}
