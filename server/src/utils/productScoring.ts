import { Prisma } from '@prisma/client';
import { convert } from 'html-to-text';

/** WooCommerce JSON is external input, even when read back from the database. */
export function scoringRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}

export function scoringText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export function scoringPlainText(value: unknown): string {
    const html = scoringText(value);
    if (!html) return '';
    return convert(html, {
        wordwrap: false,
        selectors: [
            { selector: 'a', options: { ignoreHref: true } },
            { selector: 'img', format: 'skip' },
            { selector: 'script', format: 'skip' },
            { selector: 'style', format: 'skip' },
        ],
    }).replace(/\s+/g, ' ').trim();
}

export function scoringHasImage(value: unknown): boolean {
    return Array.isArray(value) && value.some(image => scoringText(scoringRecord(image).src) !== '');
}

/** Zero is a supplied price; blank, negative and non-finite values are not. */
export function scoringHasPrice(value: unknown): boolean {
    if (Prisma.Decimal.isDecimal(value)) return value.isFinite() && !value.isNegative();
    if (typeof value !== 'number' && typeof value !== 'string') return false;
    if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value.trim())) return false;
    return Number.isFinite(Number(value)) && Number(value) >= 0;
}
