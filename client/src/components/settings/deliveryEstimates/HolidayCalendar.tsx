import { useId, useRef, useState } from 'react';
import type { DeliverySettings } from './types';

type Closure = DeliverySettings['closures'][number];
const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const parseDate = (date: string) => new Date(`${date}T12:00:00Z`);
const dateFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fullDate = (date: Date) => dateFormatter.format(date);
const scopes = { work: 'Work only', transit: 'Transit only', both: 'Work and transit' };

/** Date labels, not instants in the browser timezone. Native buttons provide
 * Enter/Space activation; arrows/Home/End/PageUp/PageDown move calendar focus.
 * An enclosing disabled fieldset enforces the settings form's read-only state.
 */
export function HolidayCalendar({ closures, onChange, timezone }: {
    closures: Closure[]; onChange: (closures: Closure[]) => void; timezone: string;
}) {
    const today = () => {
        try { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
        catch { return dateKey(new Date()); }
    };
    const [selected, setSelected] = useState(today);
    const [month, setMonth] = useState(() => selected.slice(0, 7));
    const [scope, setScope] = useState<Closure['scope']>(() => closures.find(c => c.date === selected)?.scope ?? 'both');
    const [label, setLabel] = useState(() => closures.find(c => c.date === selected)?.label ?? '');
    const grid = useRef<HTMLDivElement>(null);
    const heading = useId();
    const first = parseDate(`${month}-01`);
    const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    const existing = closures.find(c => c.date === selected);
    const select = (date: string) => {
        setSelected(date);
        const closure = closures.find(c => c.date === date);
        setScope(closure?.scope ?? 'both'); setLabel(closure?.label ?? '');
    };
    const moveMonth = (delta: number) => {
        const next = parseDate(`${month}-01`); next.setUTCMonth(next.getUTCMonth() + delta);
        if (next.getUTCFullYear() < 1 || next.getUTCFullYear() > 9999) return;
        setMonth(dateKey(next).slice(0, 7));
    };
    return <div className="max-w-lg space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 p-2 sm:p-4">
        <div className="flex items-center justify-between gap-1">
            <button type="button" aria-label="Previous month" onClick={() => moveMonth(-1)}>‹</button>
            <h5 id={heading} aria-live="polite" className="font-semibold">{first.toLocaleDateString('en', { timeZone: 'UTC', month: 'long', year: 'numeric' })}</h5>
            <button type="button" aria-label="Next month" onClick={() => moveMonth(1)}>›</button>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">Select a date to add or edit a closure. Arrow keys move by day or week; Page Up/Down changes month.</p>
        <div ref={grid} role="group" aria-labelledby={heading} className="grid grid-cols-7 gap-1 [&_button]:!px-0 [&_button]:min-h-11">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <span key={day} className="text-center text-xs" aria-hidden="true">{day}</span>)}
            {Array.from({ length: first.getUTCDay() }, (_, i) => <span key={`blank-${i}`} />)}
            {Array.from({ length: count }, (_, i) => {
                const date = `${month}-${String(i + 1).padStart(2, '0')}`;
                const closure = closures.find(c => c.date === date);
                return <button key={date} type="button" data-date={date} aria-pressed={selected === date}
                    aria-label={`${fullDate(parseDate(date))}${closure ? `: ${scopes[closure.scope]} closure${closure.label ? `, ${closure.label}` : ''}` : ': No closure'}`}
                    className={`text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 ${selected === date ? 'bg-indigo-600 text-white' : closure ? 'bg-amber-100 dark:bg-amber-950' : 'bg-white dark:bg-slate-900'}`}
                    onClick={() => select(date)} onKeyDown={event => {
                        const next = parseDate(date);
                        const shift = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -next.getUTCDay(), End: 6 - next.getUTCDay() } as Record<string, number>)[event.key];
                        if (shift !== undefined) next.setUTCDate(next.getUTCDate() + shift);
                        else if (event.key === 'PageUp' || event.key === 'PageDown') {
                            next.setUTCDate(1); next.setUTCMonth(next.getUTCMonth() + (event.key === 'PageUp' ? -1 : 1));
                        } else return;
                        event.preventDefault();
                        if (next.getUTCFullYear() < 1 || next.getUTCFullYear() > 9999) return;
                        const key = dateKey(next); setMonth(key.slice(0, 7)); select(key);
                        requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>(`[data-date="${key}"]`)?.focus());
                    }}>{i + 1}{closure && <span aria-hidden="true" className="block text-[10px]">{closure.scope === 'both' ? 'W+T' : closure.scope === 'work' ? 'W' : 'T'}</span>}</button>;
            })}
        </div>
        <p className="text-xs">W = work · T = transit. Weekday settings are unchanged by closures.</p>
        <p aria-live="polite" className="text-sm font-medium">Selected: {fullDate(parseDate(selected))}</p>
        <div className="grid gap-2 sm:grid-cols-2">
            <label>Selected date closes<select aria-label="Selected date closure scope" value={scope} onChange={e => setScope(e.target.value as Closure['scope'])}>
                <option value="work">Work only</option><option value="transit">Transit only</option><option value="both">Both</option>
            </select></label>
            <label>Closure label<input aria-label="Selected date closure label" maxLength={100} value={label} onChange={e => setLabel(e.target.value)} /></label>
        </div>
        <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!existing && closures.length >= 3660} onClick={() => onChange([
                ...closures.filter(c => c.date !== selected), { date: selected, scope, ...(label ? { label } : {}) },
            ].sort((a, b) => a.date.localeCompare(b.date)))}>{existing ? 'Update selected closure' : 'Add selected closure'}</button>
            {existing && <button type="button" onClick={() => onChange(closures.filter(c => c.date !== selected))}>Remove selected closure</button>}
        </div>
    </div>;
}
