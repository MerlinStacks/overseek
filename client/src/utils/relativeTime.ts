/**
 * Converts an ISO timestamp to a human-friendly relative string.
 *
 * Why: Raw ISO strings are unreadable for users. Relative timestamps
 * ("3 min ago") provide instant context about data freshness without
 * requiring the user to compute the difference mentally.
 */
export function formatRelativeTime(isoString: string | null | undefined): string {
    if (!isoString) return 'Never';

    const date = new Date(isoString);
    const now = Date.now();
    const diffMs = now - date.getTime();

    if (diffMs < 0) return 'Just now';

    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;

    return date.toLocaleDateString();
}

/**
 * Returns a staleness level based on how old a timestamp is.
 *
 * Why: Different UI treatments (green/amber/red dots) depend on how
 * fresh the data is. Centralising the threshold logic prevents
 * inconsistencies between components.
 */
export function getStalenessLevel(isoString: string | null | undefined): 'fresh' | 'stale' | 'critical' | 'never' {
    if (!isoString) return 'never';

    const diffMs = Date.now() - new Date(isoString).getTime();
    const hours = diffMs / (1000 * 60 * 60);

    if (hours < 1) return 'fresh';
    if (hours < 6) return 'stale';
    return 'critical';
}
