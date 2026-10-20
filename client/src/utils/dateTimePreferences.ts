export interface DateTimePreferences {
    timezone?: string | null;
    dateFormat?: 'dmy' | 'mdy' | 'ymd' | null;
    timeFormat?: '12h' | '24h' | null;
}

export function getDateTimePreferences(): DateTimePreferences {
    try {
        return JSON.parse(localStorage.getItem('user') || 'null') || {};
    } catch { return {}; }
}

/** Keep date-only calendar values stable; only timestamps are timezone-adjusted. */
export function formatPreferredDateTime(
    date: Date,
    kind: 'date' | 'time' | 'datetime',
    defaults: Intl.DateTimeFormatOptions,
    preferences = getDateTimePreferences(),
    dateOnly = false,
): string {
    const options = { ...defaults };
    if (preferences.timezone && !dateOnly) options.timeZone = preferences.timezone;
    if (kind !== 'date' && preferences.timeFormat) options.hour12 = preferences.timeFormat === '12h';
    if (kind !== 'time' && preferences.dateFormat) {
        options.year = 'numeric';
        options.month = '2-digit';
        options.day = '2-digit';
    }
    const formatter = new Intl.DateTimeFormat('en-AU', options);
    if (kind === 'time' || !preferences.dateFormat) return formatter.format(date);

    const parts = formatter.formatToParts(date);
    const part = (type: string) => parts.find(p => p.type === type)?.value || '';
    const order = preferences.dateFormat === 'ymd' ? ['year', 'month', 'day']
        : preferences.dateFormat === 'mdy' ? ['month', 'day', 'year'] : ['day', 'month', 'year'];
    const formattedDate = order.map(part).join(preferences.dateFormat === 'ymd' ? '-' : '/');
    if (kind === 'date') return formattedDate;
    return `${formattedDate}, ${new Intl.DateTimeFormat('en-AU', {
        timeZone: options.timeZone, hour: options.hour ?? 'numeric', minute: options.minute ?? '2-digit',
        ...(options.second ? { second: options.second } : {}),
        ...(preferences.timeFormat ? { hour12: preferences.timeFormat === '12h' } : {}),
    }).format(date)}`;
}
