import type { SettingsFieldsProps } from './types';
import { HolidayCalendar } from './HolidayCalendar';
import { useMemo } from 'react';

// Include UTC and the saved identifier: Intl omits UTC and some valid legacy aliases.
const supportedTimezones = (Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] })
    .supportedValuesOf?.('timeZone') ?? ['Australia/Sydney', 'Australia/Brisbane', 'Australia/Perth', 'Pacific/Auckland',
        'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Asia/Tokyo', 'Asia/Singapore'];

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Separate production/transit calendars, with local date-only closures. */
export function CalendarSettings({ settings, onChange }: SettingsFieldsProps) {
    const timezones = useMemo(() => [...new Set(['UTC', ...supportedTimezones, settings.timezone].filter(Boolean))].sort(), [settings.timezone]);
    return <section className="space-y-4">
        <h3 className="text-lg font-semibold">Timing & calendars</h3>
        <div className="grid gap-4 sm:grid-cols-3">
            <label>Daily cutoff<input type="time" required value={settings.cutoffTime}
                onChange={e => onChange({ ...settings, cutoffTime: e.target.value })} /></label>
            <label>Store timezone (IANA)<select required value={settings.timezone}
                onChange={e => onChange({ ...settings, timezone: e.target.value })}>
                <option value="" disabled>Select a timezone</option>
                {timezones.map(timezone => <option key={timezone} value={timezone}>{timezone.replace(/_/g, ' ')}</option>)}
            </select></label>
            <label>Supplier fallback (calendar days)<input type="number" required min={0} max={3650} step={1}
                value={Number.isNaN(settings.fallbackSupplierLeadTimeDays) ? '' : settings.fallbackSupplierLeadTimeDays}
                onChange={e => onChange({ ...settings, fallbackSupplierLeadTimeDays: e.target.valueAsNumber })} /></label>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">After cutoff, orders move to the next calendar date before workday rules apply. Supplier fallback includes weekends and holidays.</p>
        {(['productionWeekdays', 'transitWeekdays'] as const).map(key => <fieldset key={key}>
            <legend className="font-medium mb-2">{key === 'productionWeekdays' ? 'Production / work days' : 'Transit days'}</legend>
            <div className="flex flex-wrap gap-3">{weekdays.map((day, index) => <label key={day} className="flex items-center gap-2">
                <input type="checkbox" checked={settings[key].includes(index)} onChange={e => onChange({ ...settings,
                    [key]: e.target.checked ? [...settings[key], index].sort() : settings[key].filter(d => d !== index),
                })} />{day}
            </label>)}</div>
        </fieldset>)}
        <h4 className="font-medium">Holidays & closures</h4>
        <p className="text-sm text-slate-500 dark:text-slate-400">Toggle local dates independently for production and transit. Weekday settings are unchanged. Use Save delivery settings to save your changes.</p>
        <div className="grid gap-4 lg:grid-cols-2">
            {(['work', 'transit'] as const).map(scope => <HolidayCalendar key={scope} scope={scope} closures={settings.closures} timezone={settings.timezone} onChange={closures => onChange({ ...settings, closures })} />)}
        </div>
        {settings.closures.length === 0 && <p className="text-sm">No closures configured.</p>}
    </section>;
}
