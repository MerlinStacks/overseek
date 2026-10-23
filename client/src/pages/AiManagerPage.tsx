import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { usePermissions } from '../hooks/usePermissions';
import { useScopedRequest } from '../hooks/useScopedRequest';
import { useRecoveryAttempt } from '../hooks/useRecoveryAttempt';
import { isRecord } from '../utils/responseValidation';
import { Bot, CheckCircle2, Clock, Flag, Globe, Lightbulb, Loader2, Megaphone, RefreshCw, Search, Sparkles } from 'lucide-react';
import { workspaceStyles as ui } from '../components/ui/workspaceStyles';
import { DataNote } from '../components/ui/DataNote';
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
    if (!token || !currentAccount) return <p className={ui.empty}>Select an account and sign in.</p>;
    if (!hasPermission('view_marketing')) return <p className={ui.notice}>Marketing view permission required.</p>;
    return <ScopedManager key={JSON.stringify([user?.id, token, currentAccount.id])} accountId={currentAccount.id} token={token} />;
}
function ScopedManager({ accountId, token }: { accountId: string; token: string }) {
    const [filter, setFilter] = useState('');
    return <main className="min-w-0 space-y-5 text-slate-900 dark:text-slate-100">
        <header className="flex items-center gap-3"><span className="rounded-2xl bg-indigo-50 p-3 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400"><Bot size={28} aria-hidden="true" /></span><div><h1 className="text-2xl font-bold">AI Manager</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Review recommendations for your store. You remain in control.</p></div></header>
        <DataNote title="How these suggestions work">Review-only local heuristics. Confidence and provider health are unverified. No actions are applied.</DataNote>
        <label className={`${ui.label} w-full sm:w-52`}>Status <select value={filter} onChange={event => setFilter(event.target.value)} className={ui.input}>{['', 'pending', 'implemented', 'dismissed', 'expired'].map(value => <option value={value} key={value}>{value ? value[0].toUpperCase() + value.slice(1) : 'All statuses'}</option>)}</select></label>
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
    const items = !list.loading && !list.error ? list.data?.items : undefined;
    const summaries = [
        { label: 'Suggestions in view', value: items?.length, Icon: Lightbulb },
        { label: 'Pending in view', value: items?.filter(item => item.status === 'pending').length, Icon: Clock },
        { label: 'High priority pending in view', value: items?.filter(item => item.status === 'pending' && item.priority === 1).length, Icon: Flag },
        { label: 'Marked implemented in view', value: items?.filter(item => item.status === 'implemented').length, Icon: CheckCircle2 },
    ];
    return <>
        <dl aria-label="Suggestion summary" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{summaries.map(({ label, value, Icon }) => <div className={`${ui.card} p-4`} key={label}><dt className={`flex items-start gap-2 ${ui.muted}`}><Icon size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-indigo-500" />{label}</dt><dd className="mt-3 text-2xl font-semibold tabular-nums">{value === undefined ? '—' : value.toLocaleString()}</dd></div>)}</dl>
        <section aria-label="Configured sources" className={`${ui.card} space-y-4`}>
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className={`${ui.title} flex items-center gap-2`}><Globe size={16} aria-hidden="true" className="text-indigo-500" />Configured sources</h2><p className={ui.muted}>Not a connection-health check.</p></div>
            {sources.loading ? <p role="status" className={ui.muted}>Loading configuration…</p> : sources.error || !sources.data ? <div role="alert" className={ui.alert}>Source configuration unavailable. <button className={ui.secondary} type="button" onClick={sources.retry}>Retry sources</button></div> : <div className="grid gap-3 sm:grid-cols-3">{[
                { label: 'Search Console', count: sources.data.searchConsole, Icon: Search },
                { label: 'Google Ads', count: sources.data.googleAds, Icon: Megaphone },
                { label: 'Meta Ads', count: sources.data.metaAds, Icon: Megaphone },
            ].map(({ label, count, Icon }) => <div className="flex min-w-0 items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40" key={label}><Icon size={18} aria-hidden="true" className="shrink-0 text-slate-400" /><div><h3 className="text-xs font-medium">{label}</h3><p className={`mt-1 ${ui.muted}`}>{count} configured {count === 1 ? 'record' : 'records'}</p></div></div>)}</div>}
        </section>
        {error && <div role="alert" className={`${ui.alert} flex flex-wrap items-center justify-between gap-3`}><p>{error}</p><button className={ui.secondary} type="button" onClick={() => window.location.reload()}>Reload AI Manager</button></div>}
        <section aria-label="Suggestions" className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><Sparkles size={18} aria-hidden="true" className="text-indigo-500" />Suggestions</h2>{items && <p className={`mt-1 ${ui.muted}`}>{items.length} shown{list.data?.coverage.truncated ? '; more records exist (bounded view)' : ''}. Counts refer only to this view.</p>}</div>{hasPermission('manage_marketing') && <button className={ui.primary} type="button" disabled={busy || !!error} onClick={() => void write()}><RefreshCw size={15} aria-hidden="true" className={busy ? 'animate-spin motion-reduce:animate-none' : ''} />Refresh Suggestions (hourly limit)</button>}</div>
            {busy && <p role="status" className={ui.muted}>Updating suggestions…</p>}
            {list.loading ? <div role="status" className={`${ui.card} flex items-center justify-center gap-2 py-12 text-sm text-slate-500 dark:text-slate-400`}><Loader2 size={18} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />Loading suggestions…</div> : list.error || !items ? <div role="alert" className={ui.alert}>Suggestions unavailable. <button className={ui.secondary} type="button" onClick={list.retry}>Retry suggestions</button></div> : <>
                {items.length === 0 && <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-200 px-4 py-12 text-center dark:border-slate-700"><Lightbulb size={30} aria-hidden="true" className="text-slate-300 dark:text-slate-600" /><p className="text-sm font-medium">No suggestions in this view.</p><p className={ui.muted}>Try another status filter or refresh suggestions if you have management access.</p></div>}
                <div className="grid items-start gap-4 lg:grid-cols-2">{items.map(item => <article className={`${ui.card} space-y-4 border-t-4 ${item.priority === 1 ? 'border-t-red-400 dark:border-t-red-500' : item.priority === 2 ? 'border-t-amber-400 dark:border-t-amber-500' : 'border-t-indigo-300 dark:border-t-indigo-700'}`} key={item.id}>
                    <div className="flex items-start justify-between gap-3"><h3 className="min-w-0 break-words text-base font-semibold">{item.title}</h3><span className={`shrink-0 rounded-full border px-2 py-1 text-xs font-semibold ${item.priority === 1 ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300' : item.priority === 2 ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300' : 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>P{item.priority}</span></div>
                    <div className="flex flex-wrap items-center gap-2"><span className={ui.badge}>{item.type}</span><span className={`break-all ${ui.muted}`}>{item.source} · confidence unavailable</span></div>
                    <p className="break-words whitespace-pre-line text-sm leading-relaxed text-slate-700 dark:text-slate-300">{item.text}</p>
                    {item.dataPoints.length > 0 && <section className="space-y-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-900/50"><h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Supporting observations</h4><ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{item.dataPoints.map((point, index) => <li className="break-words" key={index}>{point}</li>)}</ul></section>}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-700"><span className={`${ui.muted} capitalize`}>Status: {item.status}{item.status === 'implemented' ? ' (self-reported)' : ''}</span>{item.status === 'pending' && hasPermission('manage_marketing') && <div className="flex flex-wrap gap-2"><button className={`${ui.secondary} text-xs`} type="button" disabled={busy || !!error} onClick={() => void write(item, 'implemented')}>Mark implemented (self-reported)</button><button className={`${ui.secondary} text-xs`} type="button" disabled={busy || !!error} onClick={() => void write(item, 'dismissed')}>Dismiss</button></div>}</div>
                </article>)}</div>
            </>}
        </section>
    </>;
}
