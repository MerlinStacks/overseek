import type { SettingsFieldsProps } from './types';
import { HolidayCalendar } from './HolidayCalendar';

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Separate production/transit calendars, with local date-only closures. */
export function CalendarSettings({ settings, onChange }: SettingsFieldsProps) {
    return <section className="space-y-4">
        <h3 className="text-lg font-semibold">Timing & calendars</h3>
        <div className="grid gap-4 sm:grid-cols-3">
            <label>Daily cutoff<input type="time" required value={settings.cutoffTime}
                onChange={e => onChange({ ...settings, cutoffTime: e.target.value })} /></label>
            <label>Store timezone (IANA)<input required maxLength={100} placeholder="Australia/Sydney" value={settings.timezone}
                onChange={e => onChange({ ...settings, timezone: e.target.value })} /></label>
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
        <p className="text-sm text-slate-500 dark:text-slate-400">Choose local calendar dates and which calendar they close. Weekends are controlled independently above.</p>
        <HolidayCalendar closures={settings.closures} timezone={settings.timezone} onChange={closures => onChange({ ...settings, closures })} />
        {settings.closures.length === 0 && <p className="text-sm">No closures configured.</p>}
        <div className="space-y-3">{settings.closures.map((closure, index) => <div key={index} className="grid gap-2 sm:grid-cols-4">
            <label>Date<input aria-label={`Closure ${index + 1} date`} type="date" required min="0001-01-01" max="9999-12-31" value={closure.date}
                onChange={e => onChange({ ...settings, closures: settings.closures.map((c, i) => i === index ? { ...c, date: e.target.value } : c) })} /></label>
            <label>Closes<select aria-label={`Closure ${index + 1} scope`} value={closure.scope}
                onChange={e => onChange({ ...settings, closures: settings.closures.map((c, i) => i === index ? { ...c, scope: e.target.value as typeof c.scope } : c) })}>
                <option value="work">Work only</option><option value="transit">Transit only</option><option value="both">Both</option>
            </select></label>
            <label>Label (optional)<input maxLength={100} value={closure.label ?? ''}
                onChange={e => onChange({ ...settings, closures: settings.closures.map((c, i) => i === index ? { ...c, label: e.target.value } : c) })} /></label>
            <button type="button" aria-label={`Remove closure ${index + 1}`} onClick={() => onChange({ ...settings, closures: settings.closures.filter((_, i) => i !== index) })}>Remove</button>
        </div>)}</div>
        <button type="button" disabled={settings.closures.length >= 3660} onClick={() => onChange({ ...settings, closures: [...settings.closures, { date: '', scope: 'both' }] })}>Add closure</button>
    </section>;
}
