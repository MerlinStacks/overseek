/**
 * String Utilities
 * 
 * Centralized string manipulation functions.
 */

/**
 * Get initials from a name string or first/last name components.
 * Handles various input formats flexibly.
 * 
 * @example
 * getInitials('John Doe') // 'JD'
 * getInitials('John', 'Doe') // 'JD'
 * getInitials('John') // 'J'
 * getInitials({ firstName: 'John', lastName: 'Doe' }) // 'JD'
 */
export function getInitials(
    firstNameOrFullName: string | { firstName?: string; lastName?: string; name?: string },
    lastName?: string
): string {
    // Handle object input
    if (typeof firstNameOrFullName === 'object') {
        const obj = firstNameOrFullName;
        if (obj.firstName || obj.lastName) {
            const first = obj.firstName?.trim().charAt(0).toUpperCase() || '';
            const last = obj.lastName?.trim().charAt(0).toUpperCase() || '';
            return first + last || '?';
        }
        if (obj.name) {
            return getInitials(obj.name);
        }
        return '?';
    }

    const name = firstNameOrFullName?.trim() || '';

    // If lastName is provided separately
    if (lastName) {
        const first = name.charAt(0).toUpperCase();
        const last = lastName.trim().charAt(0).toUpperCase();
        return first + last || '?';
    }

    // Split full name and extract initials
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();

    // Return first and last initials
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * Truncate a string to a maximum length with ellipsis.
 * 
 * @param str - The string to truncate
 * @param maxLength - Maximum length including ellipsis
 * @param ellipsis - The ellipsis string (default: '...')
 */
export function truncate(str: string, maxLength: number, ellipsis = '...'): string {
    if (!str || str.length <= maxLength) return str || '';
    return str.slice(0, maxLength - ellipsis.length) + ellipsis;
}

/**
 * Capitalize the first letter of a string.
 */
export function capitalize(str: string): string {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Convert a string to title case.
 */
export function toTitleCase(str: string): string {
    if (!str) return '';
    return str
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/**
 * Slugify a string (convert to URL-safe format).
 */
export function slugify(str: string): string {
    if (!str) return '';
    return str
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Escapes special regex characters in a string for safe use in RegExp constructor.
 * 
 * @param str - The string to escape
 * @returns The escaped string safe for use in regex patterns
 * @example
 * escapeRegex('Hello (world)') // Returns 'Hello \\(world\\)'
 */
export function escapeRegex(str: string): string {
    if (!str) return '';
    try {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    } catch {
        // Return original string if escape fails (shouldn't happen with valid input)
        return str;
    }
}

