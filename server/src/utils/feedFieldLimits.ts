export const FEED_FIELD_CHARACTER_LIMITS: Readonly<Record<string, number>> = {
    title: 150,
    description: 5_000,
};

export function getFeedFieldCharacterLimit(field: string): number | undefined {
    const parts = field.split(':');
    return FEED_FIELD_CHARACTER_LIMITS[parts[parts.length - 1] || field];
}

export function getFeedFieldLengthError(field: string, value: string | null): string | undefined {
    const limit = getFeedFieldCharacterLimit(field);
    if (value == null || limit == null || value.length <= limit) return undefined;

    const parts = field.split(':');
    const label = parts[parts.length - 1] || field;
    return `${label.charAt(0).toUpperCase()}${label.slice(1)} must be ${limit.toLocaleString('en-GB')} characters or fewer.`;
}
