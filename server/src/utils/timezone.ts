const DATE_PARTS_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

export function normalizeTimezone(timezone: string | null | undefined): string {
    if (!timezone) return 'UTC';
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
        return timezone;
    } catch {
        return 'UTC';
    }
}

function getFormatter(timezone: string): Intl.DateTimeFormat {
    let formatter = DATE_PARTS_FORMATTERS.get(timezone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23'
        });
        DATE_PARTS_FORMATTERS.set(timezone, formatter);
    }
    return formatter;
}

function zonedParts(date: Date, timezone: string): Record<string, number> {
    return Object.fromEntries(
        getFormatter(timezone).formatToParts(date)
            .filter(part => part.type !== 'literal')
            .map(part => [part.type, Number(part.value)])
    );
}

/** Returns the store-local calendar date for an instant as YYYY-MM-DD. */
export function dateKeyInTimezone(date: Date, timezone: string): string {
    const parts = zonedParts(date, normalizeTimezone(timezone));
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

/** Converts a calendar date in an IANA timezone to its UTC midnight instant. */
export function startOfDateInTimezone(dateKey: string, timezone: string): Date {
    return dateAtTimeInTimezone(dateKey, timezone, 0, 0, 0, 0);
}

/** The reference's store-local wall-clock time on another date; DST gaps move forward. */
export function sameTimeOnDateInTimezone(reference: Date, dateKey: string, timezone: string): Date {
    const parts = zonedParts(reference, normalizeTimezone(timezone));
    return dateAtTimeInTimezone(dateKey, timezone, parts.hour, parts.minute, parts.second, reference.getUTCMilliseconds());
}

function dateAtTimeInTimezone(dateKey: string, timezone: string, hour: number, minute: number, second: number, millisecond: number): Date {
    const [year, month, day] = dateKey.split('-').map(Number);
    const normalizedTimezone = normalizeTimezone(timezone);
    const desiredWallTime = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
    let result = new Date(desiredWallTime);
    const visited = new Set<number>();

    // Recalculate to account for the offset at the target instant (including DST changes).
    for (let attempt = 0; attempt < 3; attempt++) {
        visited.add(result.getTime());
        const parts = zonedParts(result, normalizedTimezone);
        const actualWallTime = Date.UTC(
            parts.year,
            parts.month - 1,
            parts.day,
            parts.hour,
            parts.minute,
            parts.second,
            result.getUTCMilliseconds()
        );
        const correction = desiredWallTime - actualWallTime;
        if (correction === 0) break;
        const next = result.getTime() + correction;
        // A nonexistent DST wall time oscillates between the surrounding offsets.
        if (visited.has(next)) return new Date(Math.max(next, result.getTime()));
        result = new Date(next);
    }

    return result;
}
