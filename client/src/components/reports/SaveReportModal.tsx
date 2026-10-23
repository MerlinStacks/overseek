import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { useScopedMutation } from '../../hooks/useScopedMutation';

export interface ReportSchedule { frequency: string; dayOfWeek?: number; dayOfMonth?: number; time: string; emailRecipients: string[] }
export interface SaveReportPayload { name: string; schedule: ReportSchedule | null }
interface Props { isOpen: boolean; onClose: () => void; onSave: (data: SaveReportPayload, signal?: AbortSignal) => Promise<void>; savedTemplateName?: string; completed?: boolean }
export function SaveReportModal(props: Props) {
    if (!props.isOpen) return null;
    return <SaveForm {...props} />;
}
function SaveForm({ onClose, onSave, savedTemplateName, completed }: Props) {
    const [name, setName] = useState(''); const [scheduled, setScheduled] = useState(false);
    const [frequency, setFrequency] = useState('WEEKLY'); const [day, setDay] = useState(1);
    const [time, setTime] = useState('09:00'); const [recipients, setRecipients] = useState('');
    const mutation = useScopedMutation(); const [validation, setValidation] = useState(''); const [done, setDone] = useState(false);
    const save = async () => {
        if (mutation.isPending() || completed || done) return;
        const emails = [...new Set(recipients.split(',').map(email => email.trim()).filter(Boolean))];
        if (!(savedTemplateName || name.trim())) { setValidation('Enter a template name.'); return; }
        if (scheduled && (!emails.length || emails.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !Number.isInteger(day) || day < 1 || day > (frequency === 'WEEKLY' ? 7 : 28))) { setValidation('Enter valid recipients, time and schedule day.'); return; }
        setValidation('');
        const result = await mutation.run(signal => onSave({ name: savedTemplateName || name.trim(), schedule: scheduled ? { frequency, dayOfWeek: frequency === 'WEEKLY' ? day : undefined, dayOfMonth: frequency === 'MONTHLY' ? day : undefined, time, emailRecipients: emails } : null }, signal), 'Could not confirm the save. Your input is retained. Check saved reports before retrying.');
        if (result.ok) setDone(true);
    };
    const input = 'block w-full border border-slate-300 dark:border-slate-700 rounded-lg p-2 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-[var(--brand-border)] focus:border-[var(--primary-color)]';
    return <Modal isOpen onClose={mutation.busy ? undefined : onClose} title="Save Report Template"><div className="space-y-4 text-slate-900 dark:text-slate-100">
        {savedTemplateName && <p role="status">Template “{savedTemplateName}” is already saved. Retrying will not create another template. If a schedule request was sent but not confirmed, check schedules before retrying.</p>}
        <fieldset disabled={mutation.busy || done || completed} className="space-y-4">
            <label className="block">Template Name<input className={input} disabled={!!savedTemplateName} value={savedTemplateName || name} onChange={event => setName(event.target.value)} /></label>
            <label className="flex gap-2"><input type="checkbox" className="accent-[var(--primary-color)] focus-visible:outline-[var(--focus-color)]" checked={scheduled} onChange={event => setScheduled(event.target.checked)} />Schedule Email Report</label>
            {scheduled && <>
                <label className="block">Frequency<select className={input} value={frequency} onChange={event => { setFrequency(event.target.value); setDay(1); }}><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></select></label>
                <label className="block">{frequency === 'WEEKLY' ? 'Day of Week' : 'Day of Month'}<select className={input} value={day} onChange={event => setDay(Number(event.target.value))}>{frequency === 'WEEKLY' ? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((label, i) => <option key={label} value={i + 1}>{label}</option>) : Array.from({ length: 28 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>
                <label className="block">Time<input className={input} type="time" value={time} onChange={event => setTime(event.target.value)} /></label>
                <p className="text-sm">Schedule times use the server’s configured timezone, which may differ from your local timezone. Monthly schedules use days 1–28.</p>
                <label className="block">Recipients (comma separated)<input className={input} value={recipients} onChange={event => setRecipients(event.target.value)} /></label>
            </>}
            <button type="button" className="rounded-lg px-4 py-2 text-sm font-medium bg-[var(--primary-color)] text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)] disabled:opacity-50 focus-visible:outline-[var(--focus-color)]" disabled={!savedTemplateName && !name.trim()} onClick={() => void save()}>{mutation.busy ? 'Saving...' : 'Save Template'}</button>
        </fieldset>
        {validation && <p role="alert">{validation}</p>}{mutation.error && <p role="alert">{mutation.error}</p>}{(done || completed) && <p role="status">Save confirmed.</p>}
        <button type="button" disabled={mutation.busy} onClick={onClose}>{done || completed ? 'Close' : 'Cancel'}</button>
    </div></Modal>;
}
