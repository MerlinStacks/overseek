import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { evaluateEmailPreflight } from '../../utils/emailPreflight';
import { Modal } from '../ui/Modal';
import { SubjectExperimentPanel } from './SubjectExperimentPanel';

interface AudienceReadiness {
    matched: number; eligible: number; complete: boolean; excluded: Record<string, number>; note: string;
    sender: { name: string; email: string } | null;
}
export function CampaignReviewModal({ campaignId, onClose, onChanged }: { campaignId: string; onClose: () => void; onChanged: () => void }) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const accountId = currentAccount?.id;
    const [audience, setAudience] = useState<AudienceReadiness | null>(null);
    const [campaign, setCampaign] = useState<{ name: string; subject: string; subjectB?: string; content: string; status: string; scheduledAt?: string; scheduleTimezone?: string } | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [localTime, setLocalTime] = useState('');
    const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    const [notice, setNotice] = useState('');
    const [reload, setReload] = useState(0);
    const headers = { Authorization: `Bearer ${token}`, 'x-account-id': accountId || '', 'Content-Type': 'application/json' };

    useEffect(() => {
        const controller = new AbortController();
        setAudience(null); setCampaign(null); setError('');
        if (!accountId || !token) return;
        const get = async (path: string) => {
            const response = await fetch(path, { signal: controller.signal, headers });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Review data unavailable');
            return result;
        };
        void Promise.all([get(`/api/marketing/campaigns/${campaignId}`), get(`/api/marketing/campaigns/${campaignId}/audience-readiness`)]).then(([item, readiness]) => {
            if (!controller.signal.aborted) { setCampaign(item); setAudience(readiness); }
        }).catch(err => { if (!controller.signal.aborted) setError(err.message); });
        return () => controller.abort();
    }, [accountId, token, campaignId, reload]);

    const issues = campaign ? [
        ...evaluateEmailPreflight({ html: campaign.content, subject: campaign.subject }),
        ...(campaign.subjectB ? evaluateEmailPreflight({ html: campaign.content, subject: campaign.subjectB }).map(issue => ({ ...issue, id: `b-${issue.id}`, message: `Variant B: ${issue.message}` })) : []),
    ] : [];
    const blockers = issues.filter(issue => issue.severity === 'blocking');
    const canSend = !!audience?.sender && !!audience.eligible && !blockers.length && campaign && ['DRAFT', 'FAILED'].includes(campaign.status);
    const submit = async (schedule: boolean) => {
        if (!canSend || busy) return;
        if (!window.confirm(schedule ? `Schedule this broadcast for ${localTime} in ${timezone}? Eligibility will be rechecked at delivery.` : 'Send this broadcast now to eligible recipients? This cannot be undone.')) return;
        setBusy(true); setError('');
        try {
            const response = await fetch(`/api/marketing/campaigns/${campaignId}/${schedule ? 'schedule' : 'send'}`, { method: 'POST', headers, ...(schedule ? { body: JSON.stringify({ localTime, timezone }) } : {}) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Could not queue broadcast');
            setNotice(schedule ? `Scheduled: ${new Date(result.scheduledAt).toLocaleString(undefined, { timeZone: timezone })} (${timezone})` : 'Broadcast queued. Follow progress in Message Logs.');
            onChanged();
        } catch (err) { setError((err as Error).message); }
        finally { setBusy(false); }
    };
    const unschedule = async () => {
        if (busy || !window.confirm('Cancel this scheduled broadcast? Messages already handed to a sending worker cannot be recalled.')) return;
        setBusy(true); setError('');
        try {
            const response = await fetch(`/api/marketing/campaigns/${campaignId}/schedule`, { method: 'DELETE', headers });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Could not cancel the schedule');
            setNotice('Schedule cancelled. Reopen review to edit or schedule again.'); onChanged();
        } catch (err) { setError((err as Error).message); }
        finally { setBusy(false); }
    };
    return <Modal isOpen onClose={busy ? () => {} : onClose} title="Review broadcast" maxWidth="max-w-3xl">
        <div className="space-y-4">
            {error && <p role="alert" className="text-sm text-red-700">{error} <button type="button" onClick={() => setReload(value => value + 1)} className="underline">Retry review</button></p>}
            {!campaign || !audience ? !error && <p role="status">Checking content, sender and audience…</p> : <>
                <div><h3 className="font-semibold">{campaign.name}</h3><p className="text-sm text-gray-600">Subject: {campaign.subject || 'Missing'}</p><p className="text-sm text-gray-600">From: {audience.sender ? `${audience.sender.name} <${audience.sender.email}>` : 'No sending account configured'}</p></div>
                {campaign.status === 'SCHEDULED' && campaign.scheduledAt && <p className="text-sm text-indigo-800">Scheduled: {new Date(campaign.scheduledAt).toLocaleString(undefined, { timeZone: campaign.scheduleTimezone || 'UTC' })} ({campaign.scheduleTimezone || 'UTC'})</p>}
                <div className="grid grid-cols-2 gap-3"><div className="rounded-lg bg-gray-100 p-3 text-sm">{audience.matched} matched{!audience.complete && ' (first 10,000 only)'}</div><div className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{audience.eligible} eligible{!audience.complete && ' in checked sample'}</div></div>
                <ul className="grid grid-cols-2 gap-2 text-xs text-gray-600">{Object.entries(audience.excluded).map(([reason, count]) => <li key={reason}>{reason.replace(/_/g, ' ')}: {count}</li>)}</ul>
                <p className="text-xs text-gray-500">{audience.note}</p>
                {issues.length > 0 && <ul className="space-y-1">{issues.map(issue => <li key={issue.id} className={`text-sm ${issue.severity === 'blocking' ? 'text-red-700' : 'text-amber-800'}`}>{issue.severity === 'blocking' ? 'Required' : 'Suggestion'}: {issue.message}</li>)}</ul>}
                <p className="text-xs text-gray-500">Preview and send a test in the content editor before sending to your audience. Open rates can include privacy-proxy activity.</p>
                <SubjectExperimentPanel campaignId={campaignId} subjectB={campaign.subjectB} editable={campaign.status === 'DRAFT' && !busy && !notice} onSaved={value => setCampaign(previous => previous ? { ...previous, subjectB: value } : previous)} />
                {campaign.status === 'SCHEDULED' && !notice && <button type="button" disabled={busy} onClick={() => void unschedule()} className="rounded-lg border border-amber-300 px-3 py-2 text-sm text-amber-800">Cancel scheduled send</button>}
                {notice ? <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p> : <>
                    <fieldset className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2"><legend className="px-1 text-sm font-medium">Schedule in an explicit timezone</legend><label className="text-sm">Date and time<input type="datetime-local" value={localTime} onChange={event => setLocalTime(event.target.value)} className="mt-1 block w-full rounded border p-2" /></label><label className="text-sm">IANA timezone<input value={timezone} onChange={event => setTimezone(event.target.value)} placeholder="Australia/Sydney" className="mt-1 block w-full rounded border p-2" /></label></fieldset>
                    <div className="flex flex-wrap justify-end gap-2"><button disabled={!canSend || busy || !localTime || !timezone} onClick={() => void submit(true)} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">Schedule</button><button disabled={!canSend || busy} onClick={() => void submit(false)} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? 'Queueing…' : 'Send now'}</button></div>
                </>}
            </>}
        </div>
    </Modal>;
}
