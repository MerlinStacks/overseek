import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { usePermissions } from '../hooks/usePermissions';
import { useScopedRequest } from '../hooks/useScopedRequest';
import { useRecoveryAttempt } from '../hooks/useRecoveryAttempt';
import { isRecord } from '../utils/responseValidation';
interface Suggestion { id: string; title: string; text: string; type: string; source: string; priority: number; confidence: null; status: string; version: string; dataPoints: string[] }
function suggestions(value: unknown): { items: Suggestion[]; coverage: { truncated: boolean; limit: number } } {
    if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 100 || !isRecord(value.coverage) || typeof value.coverage.truncated !== 'boolean' || typeof value.coverage.limit !== 'number') throw new Error('Invalid suggestions');
    for (const row of value.items) if (!isRecord(row) || !['id', 'title', 'text', 'type', 'source', 'version'].every(key => typeof row[key] === 'string' && String(row[key]).length <= 10000) || !Number.isFinite(Date.parse(String(row.version))) || !['pending', 'implemented', 'dismissed', 'expired'].includes(String(row.status)) || ![1, 2, 3].includes(Number(row.priority)) || row.confidence !== null || !Array.isArray(row.dataPoints) || row.dataPoints.length > 30 || row.dataPoints.some(point => typeof point !== 'string' || point.length > 2000)) throw new Error('Invalid suggestion');
    return value as unknown as ReturnType<typeof suggestions>;
}
function health(value: unknown): Record<string, number> {
    if (!isRecord(value) || value.providerHealth !== 'unverified' || !isRecord(value.configured) || !['searchConsole', 'googleAds', 'metaAds'].every(key => typeof value.configured === 'object' && value.configured !== null && Number.isSafeInteger((value.configured as Record<string, unknown>)[key]) && Number((value.configured as Record<string, unknown>)[key]) >= 0)) throw new Error('Invalid configuration counts');
    return value.configured as Record<string, number>;
}
export function AiManagerPage() {
    const { token, user } = useAuth(); const { currentAccount } = useAccount(); const { hasPermission } = usePermissions();
    if (!token || !currentAccount) return <p>Select an account and sign in.</p>;
    if (!hasPermission('view_marketing')) return <p>Marketing view permission required.</p>;
    return <ScopedManager key={JSON.stringify([user?.id, token, currentAccount.id])} accountId={currentAccount.id} token={token} />;
}
function ScopedManager({ accountId, token }: { accountId: string; token: string }) {
    const [filter, setFilter] = useState('');
    return <main className="space-y-4 text-slate-900 dark:text-slate-100"><h1 className="text-2xl font-bold">AI Manager</h1><p>Review-only local heuristics. Confidence and provider health are unverified. No actions are applied.</p>
        <label>Status <select value={filter} onChange={event => setFilter(event.target.value)} className="bg-white dark:bg-slate-900">{['', 'pending', 'implemented', 'dismissed', 'expired'].map(value => <option value={value} key={value}>{value || 'All'}</option>)}</select></label>
        <ManagerRead key={filter} accountId={accountId} token={token} filter={filter} />
    </main>;
}
function ManagerRead({ accountId, token, filter }: { accountId: string; token: string; filter: string }) {
    const list = useScopedRequest(`/api/ai-manager/suggestions?limit=60${filter ? `&status=${filter}` : ''}`, accountId, token, suggestions);
    const sources = useScopedRequest('/api/ai-manager/health', accountId, token, health);
    const attempt = useRecoveryAttempt(); const { hasPermission } = usePermissions();
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    async function write(item?: Suggestion, status?: string) {
        if (error || !hasPermission('manage_marketing')) return;
        const active = attempt.begin(); if (!active) return; setBusy(true);
        const timer = setTimeout(() => active.abort(), 30000);
        try {
            const response = await fetch(item ? `/api/ai-manager/suggestions/${encodeURIComponent(item.id)}/status` : '/api/ai-manager/suggestions/refresh', { method: 'POST', signal: active.signal, headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId, 'Content-Type': 'application/json' }, body: JSON.stringify(item ? { status, version: item.version } : { occurrence: crypto.randomUUID() }) });
            const result = await response.json();
            if (!response.ok || !isRecord(result) || (item ? result.success !== true || typeof result.version !== 'string' : typeof result.created !== 'number' || !Number.isInteger(result.created))) throw new Error('Unacknowledged');
            if (attempt.current(active)) list.retry();
        } catch { if (attempt.current(active, true)) setError('Write not acknowledged, conflicted or rate limited. Reload to reconcile before further writes.'); }
        finally { clearTimeout(timer); attempt.finish(); if (attempt.current(active, true)) setBusy(false); }
    }
    return <>
        {sources.loading ? <p role="status">Loading configuration…</p> : sources.error ? <p role="alert">Source configuration unavailable. <button onClick={sources.retry}>Retry sources</button></p> : <p>Configured records: Search Console {sources.data?.searchConsole}, Google Ads {sources.data?.googleAds}, Meta Ads {sources.data?.metaAds}. Not a connection-health check.</p>}
        {error && <p role="alert">{error} <button onClick={() => window.location.reload()}>Reload AI Manager</button></p>}
        {hasPermission('manage_marketing') && <button disabled={busy || !!error} onClick={() => void write()}>Refresh Suggestions (hourly limit)</button>}
        {list.loading ? <p role="status">Loading suggestions…</p> : list.error ? <p role="alert">Suggestions unavailable. <button onClick={list.retry}>Retry suggestions</button></p> : <>
            <p>{list.data?.items.length} shown{list.data?.coverage.truncated ? '; more records exist (bounded view)' : ''}. Counts refer only to this view.</p>
            {list.data?.items.length === 0 && <p>No suggestions in this view.</p>}
            {list.data?.items.map(item => <article className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-2" key={item.id}><h2 className="font-semibold">{item.title}</h2><p>{item.type} · {item.source} · P{item.priority} · confidence unavailable</p><p>{item.text}</p><ul>{item.dataPoints.map((point, index) => <li key={index}>{point}</li>)}</ul><p>Status: {item.status}</p>{item.status === 'pending' && hasPermission('manage_marketing') && <div className="flex gap-3"><button disabled={busy || !!error} onClick={() => void write(item, 'implemented')}>Mark implemented (self-reported)</button><button disabled={busy || !!error} onClick={() => void write(item, 'dismissed')}>Dismiss</button></div>}</article>)}
        </>}
    </>;
}
