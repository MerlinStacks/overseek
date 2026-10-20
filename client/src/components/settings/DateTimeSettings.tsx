import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { formatPreferredDateTime, type DateTimePreferences } from '../../utils/dateTimePreferences';

export function DateTimeSettings() {
    const { user } = useAuth();
    // Never carry an unsaved draft across users.
    return <DateTimeSettingsForm key={user?.id ?? 'signed-out'} />;
}

function DateTimeSettingsForm() {
    const { user, token, updateUser } = useAuth();
    const [preferences, setPreferences] = useState<DateTimePreferences>(() => ({
        timezone: user?.timezone ?? null, dateFormat: user?.dateFormat ?? null, timeFormat: user?.timeFormat ?? null,
    }));
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const supported = (Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] })
        .supportedValuesOf?.('timeZone') ?? ['Australia/Sydney', 'America/New_York', 'Europe/London', 'Asia/Tokyo'];
    const timezones = [...new Set(['UTC', Intl.DateTimeFormat().resolvedOptions().timeZone, ...supported, preferences.timezone].filter((zone): zone is string => Boolean(zone)))].sort();
    const change = (next: DateTimePreferences) => { setPreferences(next); setMessage(''); setError(''); };
    const save = async () => {
        if (!user || !token) return;
        setSaving(true);
        setError('');
        setMessage('');
        try {
            const response = await fetch('/api/auth/me', {
                method: 'PUT',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(preferences),
            });
            if (!response.ok) throw new Error('Unable to save date and time preferences. Please try again.');
            updateUser(await response.json());
            setMessage('Date and time preferences saved.');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to save preferences.');
        } finally { setSaving(false); }
    };
    const selectClass = 'mt-1 w-full rounded-lg border border-gray-300 bg-white p-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white';

    return <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Date & Time</h2>
        <p className="text-sm text-gray-500 dark:text-slate-400">Personal display preferences for dates and times. These do not change your store’s business timezone or schedules.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="text-sm text-gray-700 dark:text-slate-300">Time zone
                <select className={selectClass} value={preferences.timezone ?? ''} disabled={saving} onChange={e => change({ ...preferences, timezone: e.target.value || null })}>
                    <option value="">Automatic (browser)</option>
                    {timezones.map(zone => <option key={zone} value={zone}>{zone.replace(/_/g, ' ')}</option>)}
                </select>
            </label>
            <label className="text-sm text-gray-700 dark:text-slate-300">Date format
                <select className={selectClass} value={preferences.dateFormat ?? ''} disabled={saving} onChange={e => change({ ...preferences, dateFormat: (e.target.value || null) as DateTimePreferences['dateFormat'] })}>
                    <option value="">Default</option>
                    <option value="dmy">DD/MM/YYYY</option><option value="mdy">MM/DD/YYYY</option><option value="ymd">YYYY-MM-DD</option>
                </select>
            </label>
            <label className="text-sm text-gray-700 dark:text-slate-300">Time format
                <select className={selectClass} value={preferences.timeFormat ?? ''} disabled={saving} onChange={e => change({ ...preferences, timeFormat: (e.target.value || null) as DateTimePreferences['timeFormat'] })}>
                    <option value="">Default</option><option value="12h">12-hour (3:30 pm)</option><option value="24h">24-hour (15:30)</option>
                </select>
            </label>
        </div>
        <p className="text-sm text-gray-600 dark:text-slate-300">Preview: {formatPreferredDateTime(new Date('2026-11-22T15:30:00Z'), 'datetime', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, preferences)}</p>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <p role="status" className="text-sm text-emerald-600 dark:text-emerald-400">{message}</p>
        <button type="button" onClick={save} disabled={saving || !user || !token} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Saving...' : 'Save date & time'}</button>
    </section>;
}
