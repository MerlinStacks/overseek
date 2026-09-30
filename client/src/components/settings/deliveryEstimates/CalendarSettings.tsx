import type { SettingsFieldsProps } from './types';
import { useMemo } from 'react';
import { HolidayCalendar } from './HolidayCalendar';

// Include UTC and the saved identifier: Intl omits UTC and some valid legacy aliases.
const supportedTimezones = (Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] })
    .supportedValuesOf?.('timeZone') ?? ['Australia/Sydney', 'Australia/Brisbane', 'Australia/Perth', 'Pacific/Auckland',
        'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Asia/Tokyo', 'Asia/Singapore'];

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Separate production/transit calendars, with local date-only closures. */
export function CalendarSettings({ settings, onChange }: SettingsFieldsProps) {
    const timezones = useMemo(() => [...new Set(['UTC', ...supportedTimezones, settings.timezone].filter(Boolean))].sort(), [settings.timezone]);
    return <section className="space-y-4">
        <h3 className="text-lg font-semibold">When do you dispatch?</h3>
        <div className="grid gap-4 sm:grid-cols-2">
            <label>Daily cutoff<input type="time" required value={settings.cutoffTime}
                onChange={e => onChange({ ...settings, cutoffTime: e.target.value })} /></label>
            <label>Store timezone<select required value={settings.timezone}
                onChange={e => onChange({ ...settings, timezone: e.target.value })}>
                <option value="" disabled>Select a timezone</option>
                {timezones.map(timezone => <option key={timezone} value={timezone}>{timezone.replace(/_/g, ' ')}</option>)}
            </select></label>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">Orders after cutoff start from the next working day.</p>
        {(['productionWeekdays', 'transitWeekdays'] as const).map(key => <fieldset key={key}>
            <legend className="font-medium mb-2">{key === 'productionWeekdays' ? 'Working days' : 'Shipping days'}</legend>
            <div className="flex flex-wrap gap-3">{weekdays.map((day, index) => <label key={day} className="flex items-center gap-2">
                <input type="checkbox" checked={settings[key].includes(index)} onChange={e => onChange({ ...settings,
                    [key]: e.target.checked ? [...settings[key], index].sort() : settings[key].filter(d => d !== index),
                })} />{day}
            </label>)}</div>
        </fieldset>)}
        <details className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <summary className="cursor-pointer text-sm font-medium">Holidays and closures ({settings.closures.length})</summary>
            <p className="my-3 text-sm text-slate-500 dark:text-slate-400">Choose dates to exclude from production or transit time. Select a date in both calendars when both are closed.</p>
            <div className="grid gap-4 lg:grid-cols-2">{(['work', 'transit'] as const).map(scope => <HolidayCalendar key={scope}
                scope={scope} timezone={settings.timezone} closures={settings.closures}
                onChange={closures => onChange({ ...settings, closures })} />)}</div>
        </details>
    </section>;
}
