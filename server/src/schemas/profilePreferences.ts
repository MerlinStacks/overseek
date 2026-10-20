import { z } from 'zod';

export const profilePreferencesSchema = z.object({
    timezone: z.string().min(1).max(100).refine(value => {
        if (/^[+-]/.test(value)) return false;
        try {
            new Intl.DateTimeFormat('en', { timeZone: value });
            return true;
        } catch { return false; }
    }, 'Enter a valid IANA time zone.').nullable().optional(),
    dateFormat: z.enum(['dmy', 'mdy', 'ymd']).nullable().optional(),
    timeFormat: z.enum(['12h', '24h']).nullable().optional(),
});
