import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';

interface Freshness {
    signals: number; imported: number; pending: number; failed: number; overdue: number; missing: number;
    p95LatencyMs: number | null; truncated: boolean; sampleLimit: number;
    recentIssues: Array<{ orderId: number; status: string; presentLocally: boolean; ageMs: number }>;
}

export function SyncFreshnessPanel() {
    const { currentAccount } = useAccount();
    const { token } = useAuth();
    return currentAccount && token ? <FreshnessData key={`${currentAccount.id}:${token}`} accountId={currentAccount.id} token={token} /> : null;
}

function FreshnessData({ accountId, token }: { accountId: string; token: string }) {
    const [data, setData] = useState<Freshness | null>(null);
    const [error, setError] = useState(false);
    const [busy, setBusy] = useState(false);
    const request = useRef<AbortController | null>(null);
    const refresh = useCallback(async () => {
        request.current?.abort();
        const controller = new AbortController();
        request.current = controller;
        setBusy(true);
        try {
            const response = await fetch('/api/sync/freshness', {
                headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId }, signal: controller.signal
            });
            if (!response.ok) throw new Error('Freshness unavailable');
            const next: Freshness = await response.json();
            if (!controller.signal.aborted) { setData(next); setError(false); }
        } catch {
            if (!controller.signal.aborted) setError(true);
        } finally {
            if (!controller.signal.aborted) setBusy(false);
        }
    }, [accountId, token]);
    useVisibilityPolling(refresh, 30000, [accountId, token]);
    useEffect(() => () => request.current?.abort(), []);

    return <section aria-label="Live order sync freshness" className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold text-slate-900 dark:text-white">Live order sync freshness</h3>
            <button type="button" disabled={busy} onClick={() => void refresh()} className="rounded-md border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm disabled:opacity-50">Refresh freshness</button>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300">Purchase signals received in the last 24 hours. Latency measures server receipt to local order import, not checkout time or stock-refresh completion.</p>
        {busy && !data && <p role="status">Loading freshness…</p>}
        {error && <p role="alert" className="text-red-700 dark:text-red-300">Freshness is unavailable. {data ? 'Showing the last successful result.' : 'Try refreshing.'}</p>}
        {data && <>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                {[
                    ['Purchase signals', data.signals], ['Imported', data.imported], ['Pending / retrying / failed', data.pending],
                    ['Failed imports', data.failed], ['Overdue (>2 min)', data.overdue], ['Missing locally (>2 min)', data.missing],
                    ['95% imported within', data.p95LatencyMs === null ? 'No samples' : `${(data.p95LatencyMs / 1000).toFixed(1)}s`]
                ].map(([label, value]) => <div key={label}><dt className="text-slate-600 dark:text-slate-300">{label}</dt><dd className="font-semibold tabular-nums text-slate-900 dark:text-white">{value}</dd></div>)}
            </dl>
            {!data.signals && <p className="text-sm">No purchase signals received in this window. This alone does not confirm tracking is healthy.</p>}
            {data.truncated && <p className="text-sm">Showing the latest {data.sampleLimit} signals only; these are sample counts, not store-wide totals.</p>}
            {data.recentIssues.length > 0 && <details><summary className="cursor-pointer text-sm font-medium">Orders needing attention ({data.recentIssues.length})</summary>
                <ul className="mt-2 space-y-1 text-sm">{data.recentIssues.map(issue => <li key={issue.orderId}>Woo order #{issue.orderId} — {issue.status.toLowerCase()}; {issue.presentLocally ? 'present locally' : 'missing locally'}; received {Math.floor(issue.ageMs / 60000)} min ago.</li>)}</ul>
            </details>}
        </>}
        <p className="text-sm text-slate-500 dark:text-slate-400">Webhooks and scheduled sync remain safety nets. Stock refreshes run separately; inspect product jobs for stock-refresh failures. New store-change hooks require the updated WooCommerce plugin.</p>
    </section>;
}
