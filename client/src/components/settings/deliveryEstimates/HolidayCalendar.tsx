import { useId, useRef, useState } from 'react';
import type { DeliverySettings } from './types';

type Closure = DeliverySettings['closures'][number];
const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const parseDate = (date: string) => new Date(`${date}T12:00:00Z`);
const dateFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fullDate = (date: Date) => dateFormatter.format(date);

/** Date labels, not instants in the browser timezone. Native buttons provide
 * Enter/Space activation; arrows/Home/End/PageUp/PageDown move calendar focus.
 * An enclosing disabled fieldset enforces the settings form's read-only state.
 */
export function HolidayCalendar({ closures, onChange, timezone, scope }: {
    closures: Closure[]; onChange: (closures: Closure[]) => void; timezone: string; scope: 'work' | 'transit';
}) {
    const today = () => {
        try { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
        catch { return dateKey(new Date()); }
    };
    const [month, setMonth] = useState(() => today().slice(0, 7));
    const grid = useRef<HTMLDivElement>(null);
    const heading = useId();
    const first = parseDate(`${month}-01`);
    const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    const title = scope === 'work' ? 'Production' : 'Transit';
    const toggle = (date: string) => {
        const existing = closures.find(c => c.date === date);
        if (!existing && closures.length >= 3660) return;
        const remaining = closures.filter(c => c.date !== date);
        if (!existing) remaining.push({ date, scope });
        else if (existing.scope === 'both') remaining.push({ ...existing, scope: scope === 'work' ? 'transit' : 'work' });
        else if (existing.scope !== scope) remaining.push({ ...existing, scope: 'both' });
        onChange(remaining.sort((a, b) => a.date.localeCompare(b.date)));
    };
    const moveMonth = (delta: number) => {
        const next = parseDate(`${month}-01`); next.setUTCMonth(next.getUTCMonth() + delta);
        if (next.getUTCFullYear() < 1 || next.getUTCFullYear() > 9999) return;
        setMonth(dateKey(next).slice(0, 7));
    };
    return <section aria-label={`${title} closures`} className="min-w-0 space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 p-2 sm:p-4">
        <h5 className="font-semibold">{title}</h5>
        <div className="flex items-center justify-between gap-1">
            <button type="button" aria-label="Previous month" onClick={() => moveMonth(-1)}>‹</button>
            <h5 id={heading} aria-live="polite" className="font-semibold">{first.toLocaleDateString('en', { timeZone: 'UTC', month: 'long', year: 'numeric' })}</h5>
            <button type="button" aria-label="Next month" onClick={() => moveMonth(1)}>›</button>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">Click a date to toggle a closure. Arrow keys move by day or week; Page Up/Down changes month.</p>
        <div ref={grid} role="group" aria-labelledby={heading} className="grid grid-cols-7 gap-1 [&_button]:!px-0 [&_button]:min-h-11">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <span key={day} className="text-center text-xs" aria-hidden="true">{day}</span>)}
            {Array.from({ length: first.getUTCDay() }, (_, i) => <span key={`blank-${i}`} />)}
            {Array.from({ length: count }, (_, i) => {
                const date = `${month}-${String(i + 1).padStart(2, '0')}`;
                const closure = closures.find(c => c.date === date);
                const closed = closure?.scope === scope || closure?.scope === 'both';
                return <button key={date} type="button" data-date={date} aria-pressed={closed}
                    disabled={!closure && closures.length >= 3660}
                    aria-label={`${fullDate(parseDate(date))}${closed ? `: ${title} closure${closure?.label ? `, ${closure.label}` : ''}` : ': No closure'}`}
                    className={`text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 ${closed ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-900'}`}
                    onClick={() => toggle(date)} onKeyDown={event => {
                        const next = parseDate(date);
                        const shift = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -next.getUTCDay(), End: 6 - next.getUTCDay() } as Record<string, number>)[event.key];
                        if (shift !== undefined) next.setUTCDate(next.getUTCDate() + shift);
                        else if (event.key === 'PageUp' || event.key === 'PageDown') {
                            next.setUTCDate(1); next.setUTCMonth(next.getUTCMonth() + (event.key === 'PageUp' ? -1 : 1));
                        } else return;
                        event.preventDefault();
                        if (next.getUTCFullYear() < 1 || next.getUTCFullYear() > 9999) return;
                        const key = dateKey(next); setMonth(key.slice(0, 7));
                        requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>(`[data-date="${key}"]`)?.focus());
                    }}>{i + 1}{closed && <span aria-hidden="true" className="block text-[10px]">Closed</span>}</button>;
            })}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">Highlighted dates are closed for {title.toLowerCase()}. Click again to remove.</p>
    </section>;
}
