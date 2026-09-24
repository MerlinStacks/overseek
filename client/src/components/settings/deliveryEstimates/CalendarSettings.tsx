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
        <h3 className="text-lg font-semibold">When do you dispatch?</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">Estimates use the production times already set on your products and variations, followed by shipping time. Choose the days your team works and your daily order cutoff.</p>
        <div className="grid gap-4 sm:grid-cols-2">
            <label>Daily cutoff<input type="time" required value={settings.cutoffTime}
                onChange={e => onChange({ ...settings, cutoffTime: e.target.value })} /></label>
            <label>Store timezone (IANA)<select required value={settings.timezone}
                onChange={e => onChange({ ...settings, timezone: e.target.value })}>
                <option value="" disabled>Select a timezone</option>
                {timezones.map(timezone => <option key={timezone} value={timezone}>{timezone.replace(/_/g, ' ')}</option>)}
            </select></label>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">Orders after cutoff start from the next working day.</p>
        {(['productionWeekdays', 'transitWeekdays'] as const).map(key => <fieldset key={key}>
            <legend className="font-medium mb-2">{key === 'productionWeekdays' ? 'Production / work days' : 'Transit days'}</legend>
            <div className="flex flex-wrap gap-3">{weekdays.map((day, index) => <label key={day} className="flex items-center gap-2">
                <input type="checkbox" checked={settings[key].includes(index)} onChange={e => onChange({ ...settings,
                    [key]: e.target.checked ? [...settings[key], index].sort() : settings[key].filter(d => d !== index),
                })} />{day}
            </label>)}</div>
        </fieldset>)}
        <details className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
        <summary className="cursor-pointer font-medium">Holidays &amp; supplier timing <span className="text-sm font-normal">({settings.closures.length} saved closures · supplier fallback {settings.fallbackSupplierLeadTimeDays} days)</span></summary>
        <div className="mt-4 space-y-4">
        <label>Supplier fallback (calendar days)<input type="number" required min={0} max={3650} step={1}
            value={Number.isNaN(settings.fallbackSupplierLeadTimeDays) ? '' : settings.fallbackSupplierLeadTimeDays}
            onChange={e => onChange({ ...settings, fallbackSupplierLeadTimeDays: e.target.valueAsNumber })} /></label>
        <p className="text-sm text-slate-500 dark:text-slate-400">Supplier fallback includes weekends and holidays.</p>
        <h4 className="font-medium">Holidays & closures</h4>
        <p className="text-sm text-slate-500 dark:text-slate-400">Toggle local dates independently for production and transit. Weekday settings are unchanged. Use Save delivery settings to save your changes.</p>
        <div className="grid gap-4 lg:grid-cols-2">
            {(['work', 'transit'] as const).map(scope => <HolidayCalendar key={scope} scope={scope} closures={settings.closures} timezone={settings.timezone} onChange={closures => onChange({ ...settings, closures })} />)}
        </div>
        {settings.closures.length === 0 && <p className="text-sm">No closures configured.</p>}
        </div>
        </details>
    </section>;
}
