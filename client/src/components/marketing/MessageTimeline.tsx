import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useToast } from '../../context/ToastContext';

interface MessageLog {
    id: string; channel: 'email' | 'sms'; to: string; subject?: string; body?: string; status: string;
    source?: string; sourceId?: string; createdAt: string; from?: string; senderName?: string;
    messageId?: string; errorMessage?: string; errorCode?: string; emailBodyExpiresAt?: string; segments?: number; statusAt?: string;
}
const statuses = ['SUCCESS', 'RETRIED', 'FAILED', 'BOUNCED', 'COMPLAINED', 'SKIPPED', 'QUEUED', 'PENDING_RETRY', 'SENDING', 'UNKNOWN', 'SENT', 'DELIVERED', 'UNDELIVERED'];
const sources = ['AUTOMATION', 'CAMPAIGN', 'MANUAL', 'INBOX', 'REPORT', 'INVENTORY_ALERT', 'TEST'];

export function MessageTimeline({ channel }: { channel: 'email' | 'both' | 'sms' }) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const toast = useToast();
    const accountId = currentAccount?.id;
    const [params, setParams] = useSearchParams();
    const search = params.get('search') || '';
    const status = params.get('status') || '';
    const source = params.get('source') || '';
    const [query, setQuery] = useState(search);
    const [offset, setOffset] = useState(0);
    const [result, setResult] = useState<{ logs: MessageLog[]; total: number } | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [refresh, setRefresh] = useState(0);
    const [busy, setBusy] = useState('');
    const [bodies, setBodies] = useState<Record<string, { html: string; truncated?: boolean }>>({});
    const headers = { Authorization: `Bearer ${token}`, 'x-account-id': accountId || '' };
    const setFilter = (key: string, value: string) => {
        const next = new URLSearchParams(params);
        if (value) next.set(key, value); else next.delete(key);
        setParams(next, { replace: key === 'search' });
        setOffset(0);
    };
    useEffect(() => { setQuery(search); }, [search]);
    useEffect(() => {
        if (query === search) return;
        const timer = window.setTimeout(() => setFilter('search', query.trim()), 350);
        return () => window.clearTimeout(timer);
    }, [query, search, params]);
    useEffect(() => { setOffset(0); setBodies({}); }, [accountId, channel, search, status, source]);
    useEffect(() => {
        const controller = new AbortController();
        setLoading(true); setError(''); setResult(null);
        if (!token || !accountId) return;
        const filter = new URLSearchParams({ channel, search, status, source, offset: String(offset), limit: '20' });
        void fetch(`/api/messages/logs?${filter}`, { signal: controller.signal, headers: { Authorization: `Bearer ${token}`, 'x-account-id': accountId } }).then(async response => {
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Messages could not be loaded');
            if (!controller.signal.aborted) setResult(data);
        }).catch(err => { if (!controller.signal.aborted) setError(err.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [accountId, token, channel, search, status, source, offset, refresh]);

    const emailAction = async (log: MessageLog, action: 'content' | 'retry' | 'BOUNCE' | 'COMPLAINT' | 'resubscribe') => {
        if (busy) return;
        if (action === 'resubscribe' && !window.confirm(`Remove the unsubscribe suppression for ${log.to}? Only do this with the recipient’s permission.`)) return;
        if ((action === 'BOUNCE' || action === 'COMPLAINT') && !window.confirm(`Mark this email as ${action.toLowerCase()}? This can suppress future marketing to ${log.to}.`)) return;
        setBusy(log.id);
        try {
            const path = action === 'BOUNCE' || action === 'COMPLAINT' ? 'delivery-event' : action;
            const response = await fetch(action === 'resubscribe' ? `/api/email/suppressions/${encodeURIComponent(log.to.trim().toLowerCase())}` : `/api/email/logs/${log.id}/${path}`, {
                method: action === 'content' ? 'GET' : action === 'resubscribe' ? 'DELETE' : 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                ...(path === 'delivery-event' ? { body: JSON.stringify({ eventType: action }) } : {}),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Action failed');
            if (action === 'content') setBodies(previous => ({ ...previous, [log.id]: data }));
            else { toast.success(action === 'retry' ? 'Retry queued' : action === 'resubscribe' ? 'Suppression removed' : 'Delivery event recorded'); setRefresh(value => value + 1); }
        } catch (err) { toast.error((err as Error).message); }
        finally { setBusy(''); }
    };
    const inputClass = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white';
    return <section aria-label="Message timeline" className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-wrap items-end gap-3 border-b border-gray-200 p-4 dark:border-slate-700">
            <label className="min-w-0 flex-1 text-sm dark:text-gray-200">Search<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Recipient, subject, message, ID or error" className={`mt-1 block w-full ${inputClass}`} /></label>
            <label className="text-sm dark:text-gray-200">Status<select value={status} onChange={event => setFilter('status', event.target.value)} className={`mt-1 block ${inputClass}`}><option value="">All statuses</option>{statuses.map(value => <option key={value}>{value}</option>)}</select></label>
            <label className="text-sm dark:text-gray-200">Type<select value={source} onChange={event => setFilter('source', event.target.value)} className={`mt-1 block ${inputClass}`}><option value="">All types</option>{sources.map(value => <option key={value}>{value}</option>)}</select></label>
            <button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)} className={inputClass}>Refresh</button>
            {(search || status || source) && <button type="button" className={inputClass} onClick={() => { const next = new URLSearchParams(params); ['search', 'status', 'source'].forEach(key => next.delete(key)); setQuery(''); setParams(next); setOffset(0); }}>Clear filters</button>}
        </div>
        {error ? <p role="alert" className="p-6 text-red-600">{error}</p> : loading ? <p role="status" className="p-6 text-gray-500">Loading messages…</p> : result?.logs.length === 0 ? <p className="p-6 text-gray-500">No matching messages.</p> : <div className="divide-y divide-gray-100 dark:divide-slate-700">
            {result?.logs.map(log => <details key={`${log.channel}:${log.id}`} className="group">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-4 hover:bg-gray-50 dark:hover:bg-slate-700">
                    <span className={`rounded px-2 py-1 text-xs font-semibold ${log.channel === 'email' ? 'bg-indigo-50 text-indigo-700' : 'bg-green-50 text-green-700'}`}>{log.channel.toUpperCase()}</span>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-gray-900 dark:text-white">{log.to}</p><p className="truncate text-sm text-gray-500 dark:text-gray-400">{log.subject || log.body}</p></div>
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{log.status.replace(/_/g, ' ')}</span>
                    <time className="text-xs text-gray-400" dateTime={log.createdAt}>{new Date(log.createdAt).toLocaleString()}</time>
                    <span aria-hidden="true" className="text-gray-400 group-open:rotate-180">⌄</span>
                </summary>
                <div className="space-y-3 border-t border-gray-100 bg-gray-50 p-4 text-sm text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-200">
                    <p><strong>From:</strong> {log.senderName} {log.from || 'Not available'}</p>
                    <p className="break-all"><strong>Message ID:</strong> {log.messageId || 'Not assigned'}</p>
                    {log.source && <p><strong>Source:</strong> {log.source} {log.sourceId && (log.source === 'AUTOMATION' ? <Link className="text-[var(--brand-text)] underline" to={`/flows?flowId=${encodeURIComponent(log.sourceId)}`}>Open flow</Link> : log.source === 'CAMPAIGN' ? <Link className="text-[var(--brand-text)] underline" to={`/broadcasts?campaignId=${encodeURIComponent(log.sourceId)}`}>Open broadcast</Link> : <span>{log.sourceId}</span>)}</p>}
                    {log.body && <p className="whitespace-pre-wrap rounded border bg-white p-3 text-gray-800">{log.body}</p>}
                    {log.channel === 'sms' && <p>Segments: {log.segments ?? 'Unknown'} · Last update: {new Date(log.statusAt || log.createdAt).toLocaleString()}</p>}
                    {(log.errorMessage || log.errorCode) && <p className="rounded bg-red-50 p-3 text-red-700">{log.errorCode} {log.errorMessage}</p>}
                    {log.channel === 'email' && <div className="flex flex-wrap gap-2">
                        {log.emailBodyExpiresAt && <button type="button" disabled={!!busy} onClick={() => void emailAction(log, 'content')} className={inputClass}>View email</button>}
                        {log.status === 'FAILED' && <button type="button" disabled={!!busy} onClick={() => void emailAction(log, 'retry')} className={inputClass}>Retry send</button>}
                        {log.status === 'SKIPPED' && log.errorMessage?.toLowerCase().includes('recipient is unsubscribed') && <button type="button" disabled={!!busy} onClick={() => void emailAction(log, 'resubscribe')} className={inputClass}>Re-subscribe recipient</button>}
                        {log.status === 'SUCCESS' && <><button type="button" disabled={!!busy} onClick={() => void emailAction(log, 'BOUNCE')} className={inputClass}>Mark bounce</button><button type="button" disabled={!!busy} onClick={() => void emailAction(log, 'COMPLAINT')} className={inputClass}>Mark complaint</button></>}
                    </div>}
                    {bodies[log.id] && <>{bodies[log.id].truncated && <p className="text-amber-700">Stored preview was truncated.</p>}<iframe title={`Sent email: ${log.subject}`} sandbox="" srcDoc={bodies[log.id].html} className="h-96 w-full rounded border bg-white" /></>}
                </div>
            </details>)}
        </div>}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 p-4 text-sm dark:border-slate-700 dark:text-gray-200"><span>{result ? `${result.total} messages · Page ${Math.floor(offset / 20) + 1} of ${Math.max(1, Math.ceil(result.total / 20))}` : 'Messages'}</span><div className="flex gap-2"><button className={inputClass} disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 20))}>Previous</button><button className={inputClass} disabled={loading || !result || offset + 20 >= result.total} onClick={() => setOffset(value => value + 20)}>Next</button></div></div>
    </section>;
}
