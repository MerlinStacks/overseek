function localParts(date: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    const value = (key: string) => parts.find(part => part.type === key)!.value;
    return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`;
}

/** Reject nonexistent AND ambiguous DST wall times instead of guessing. */
export function resolveMarketingSchedule(localTime: string, timeZone: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localTime) || typeof timeZone !== 'string' || timeZone.length > 100) throw new Error('Invalid local date/time or timezone');
    const guess = new Date(`${localTime}:00Z`);
    if (!Number.isFinite(guess.getTime()) || guess.toISOString().slice(0, 16) !== localTime) throw new Error('Invalid local date/time');
    const offsets = new Set<number>();
    for (let hours = -36; hours <= 36; hours += 6) {
        const probe = new Date(guess.getTime() + hours * 3600000);
        offsets.add(new Date(`${localParts(probe, timeZone)}:00Z`).getTime() - probe.getTime());
    }
    const candidates = [...offsets].map(offset => new Date(guess.getTime() - offset)).filter(date => localParts(date, timeZone) === localTime);
    if (candidates.length !== 1) throw new Error('This local time is ambiguous or does not exist due to daylight saving. Choose another time.');
    return candidates[0];
}
