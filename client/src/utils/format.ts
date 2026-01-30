const DEFAULT_LOCALE = 'en-AU';

/**
 * Format a date string into a date-only format.
 * @param dateString - ISO date string to format
 * @returns Formatted date string (e.g., "Jan 15, 2026")
 */
export function formatDate(dateString: string): string {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString(DEFAULT_LOCALE, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

/**
 * Format a date string into a date-time format.
 * @param dateString - ISO date string to format
 * @returns Formatted date string (e.g., "Jan 15, 2026, 3:30 pm")
 */
export function formatDateTime(dateString: string): string {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString(DEFAULT_LOCALE, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: 'numeric'
    });
}

/**
 * Format a date as relative time (e.g., "5m ago", "2h ago", "3d ago").
 * @param date - Date string or Date object
 * @returns Relative time string
 */
export function formatTimeAgo(date: string | Date): string {
    if (!date) return '';
    const now = new Date();
    const then = typeof date === 'string' ? new Date(date) : date;
    const diff = Math.floor((now.getTime() - then.getTime()) / 1000);

    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

/**
 * Format a number as currency.
 * @param amount - Numeric amount to format
 * @param currency - Currency code (default: 'USD')
 * @param options - Optional Intl.NumberFormat options
 * @returns Formatted currency string
 */
export function formatCurrency(
    amount: number,
    currency: string = 'USD',
    options?: { minimumFractionDigits?: number; maximumFractionDigits?: number }
): string {
    return new Intl.NumberFormat('en-AU', {
        style: 'currency',
        currency,
        minimumFractionDigits: options?.minimumFractionDigits ?? 2,
        maximumFractionDigits: options?.maximumFractionDigits ?? 2
    }).format(amount);
}

/**
 * Format a number in compact notation (e.g., 1.2K, 3.4M).
 * @param value - Number to format
 * @returns Compact formatted string
 */
export function formatCompact(value: number): string {
    return new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: 1
    }).format(value);
}

/**
 * Format a number as a percentage.
 * @param value - Number to format (0.15 = 15%)
 * @param decimals - Decimal places (default: 1)
 * @returns Formatted percentage string
 */
export function formatPercent(value: number, decimals: number = 1): string {
    return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Format a number with thousands separators.
 * @param value - Number to format
 * @returns Formatted number string
 */
export function formatNumber(value: number): string {
    return new Intl.NumberFormat('en-US').format(value);
}

/**
 * Fix mojibake - text that was incorrectly decoded from UTF-8 to Latin-1/Windows-1252.
 * This commonly happens with emoji and special characters from external sources like WooCommerce.
 * Example: "🫶🏼" → "🫶🏼" (actual emoji)
 * @param text - Text that may contain mojibake
 * @returns Properly decoded text, or original text if no mojibake detected
 */
export function fixMojibake(text: string): string {
    if (!text || typeof text !== 'string') return text;

    try {
        // Check if the string contains typical mojibake patterns (multi-byte UTF-8 as Latin-1)
        // UTF-8 encoded bytes interpreted as Latin-1 produce characters in the 0xC0-0xFF range
        const hasMojibake = /[\u00C0-\u00FF]{2,}/.test(text);

        if (hasMojibake) {
            // Convert: treat string as Latin-1, get bytes, decode as UTF-8
            const bytes = new Uint8Array([...text].map(c => c.charCodeAt(0)));
            const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);

            // Only return decoded if it actually produced valid characters
            // and doesn't contain replacement characters
            if (decoded && !decoded.includes('\uFFFD') && decoded !== text) {
                return decoded;
            }
        }
    } catch {
        // If decoding fails, return original text
    }

    return text;
}
