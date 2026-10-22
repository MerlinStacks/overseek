/** Account-calendar windows expressed as explicit UTC instants for every endpoint. */
export function reportingWindow(days: number, timezone: string | undefined, now = new Date()) {
    if (days !== -1 && (!Number.isInteger(days) || days < 1 || days > 365)) throw new Error('Invalid reporting days');
    const zone = timezone || 'UTC';
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    const parts = (date: Date) => Object.fromEntries(formatter.formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
    const current = parts(now); const today = Date.UTC(current.year, current.month - 1, current.day);
    const day = 86400000;
    const midnight = (calendar: number) => {
        let instant = calendar;
        for (let i = 0; i < 6; i++) {
            const local = parts(new Date(instant)); const represented = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
            const next = instant + calendar - represented;
            if (next === instant) return new Date(instant).toISOString(); instant = next;
        }
        throw new Error('Calendar boundary unavailable for this timezone');
    };
    const endDay = today + (days === -1 ? -day : 0);
    return { startDate: midnight(days === -1 ? endDay : endDay - (days - 1) * day), endDate: new Date(Date.parse(midnight(endDay + day)) - 1).toISOString(), timezone: zone, timezoneUnavailable: !timezone };
}
