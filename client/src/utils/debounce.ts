/**
 * Lightweight debounce utility - replaces lodash debounce
 * 
 * Creates a debounced function that delays invoking `fn` until after `ms` milliseconds
 * have elapsed since the last time the debounced function was invoked.
 */
export function debounce<T extends (...args: any[]) => any>(
    fn: T,
    ms: number
): T & { cancel: () => void } {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const debounced = (...args: Parameters<T>) => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => {
            fn(...args);
            timeoutId = null;
        }, ms);
    };

    debounced.cancel = () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
    };

    return debounced as T & { cancel: () => void };
}

/**
 * Deep equality check for objects - replaces lodash isEqual
 * Uses JSON.stringify for simple object comparison.
 * Note: This is sufficient for plain objects but won't handle:
 * - Functions, Dates, RegExp, Maps, Sets (use structured equality for those)
 * - Circular references
 */
export function isEqual<T>(a: T, b: T): boolean {
    if (a === b) return true;
    if (a === null || b === null) return false;
    if (typeof a !== 'object' || typeof b !== 'object') return false;

    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch {
        return false;
    }
}
