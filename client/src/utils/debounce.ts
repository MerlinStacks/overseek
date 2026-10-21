/**
 * Lightweight debounce utility - replaces lodash debounce
 * 
 * Creates a debounced function that delays invoking `fn` until after `ms` milliseconds
 * have elapsed since the last time the debounced function was invoked.
 */
export function debounce<T extends (...args: never[]) => unknown>(
    fn: T,
    ms: number
): ((...args: Parameters<T>) => void) & { cancel: () => void } {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const delay = Number.isFinite(ms) ? Math.min(2147483647, Math.max(0, ms)) : 0;
    const debounced = function (this: ThisParameterType<T>, ...args: Parameters<T>) {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => {
            timeoutId = null;
            fn.apply(this, args);
        }, delay);
    };

    debounced.cancel = () => {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
    };

    return debounced;
}

/**
 * Deep equality check for objects - replaces lodash isEqual
 * Structural comparison for plain records and arrays; key order is irrelevant.
 * Unsupported object types are only equal by reference. Cycles are supported.
 */
export function isEqual<T>(a: T, b: T): boolean {
    const seen = new WeakMap<object, object>();
    const compare = (left: unknown, right: unknown): boolean => {
        if (Object.is(left, right)) return true;
        if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
        if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false;
        if (!Array.isArray(left) && Object.getPrototypeOf(left) !== Object.prototype && Object.getPrototypeOf(left) !== null) return false;
        if (Array.isArray(left) && (!Array.isArray(right) || left.length !== right.length)) return false;
        if (seen.has(left)) return seen.get(left) === right;
        seen.set(left, right);
        const keys = Object.keys(left);
        return keys.length === Object.keys(right).length && keys.every(key => Object.prototype.hasOwnProperty.call(right, key) && compare((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
    };
    return compare(a, b);
}
