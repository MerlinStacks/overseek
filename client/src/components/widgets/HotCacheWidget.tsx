import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { getCacheStats, clearAccountCache } from '../../services/db';
import { useScopedMutation } from '../../hooks/useScopedMutation';
import type { WidgetProps } from './WidgetRegistry';
import { WidgetErrorState, WidgetLoadingState } from './WidgetState';
import { widgetCardClass, widgetTitleClass } from './widgetStyles';
import { workspaceStyles as ui } from '../ui/workspaceStyles';

export function HotCacheWidget(props: WidgetProps) {
    const { currentAccount } = useAccount(); const { token } = useAuth();
    if (!currentAccount || !token) return <p role="status">Select an account to view its local cache.</p>;
    return <AccountCache key={JSON.stringify([currentAccount.id, token])} accountId={currentAccount.id} className={props.className} />;
}
function AccountCache({ accountId, className = '' }: { accountId: string; className?: string }) {
    const [stats, setStats] = useState<Awaited<ReturnType<typeof getCacheStats>> | null>(null);
    const [confirm, setConfirm] = useState(false); const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const { run, busy, error, isPending, isActive } = useScopedMutation();
    const load = useCallback(async () => {
        const result = await run(() => getCacheStats(accountId), 'Could not refresh cache statistics. Any counts shown are from the last successful refresh.');
        if (result.ok) setStats(result.value);
    }, [accountId, run]);
    useEffect(() => {
        let disposed = false;
        queueMicrotask(() => { if (!disposed) void load(); });
        return () => { disposed = true; if (timer.current) clearTimeout(timer.current); };
    }, [load]);
    const clear = async () => {
        if (isPending()) return;
        if (!confirm) { setConfirm(true); timer.current = setTimeout(() => setConfirm(false), 3000); return; }
        setConfirm(false); if (timer.current) clearTimeout(timer.current);
        const result = await run(async signal => {
            await clearAccountCache(accountId);
            signal.throwIfAborted();
            return getCacheStats(accountId);
        }, 'Could not confirm cache clearing and refreshed statistics. Refresh before trying again.');
        if (result.ok) setStats(result.value);
        else if (isActive()) setStats(null);
    };
    return <section aria-label="Hot cache" className={`${widgetCardClass} p-4 h-full text-slate-900 dark:text-white space-y-3 ${className}`}>
        <h3 className={widgetTitleClass}>Hot Cache</h3>
        <div className="flex flex-wrap gap-2"><button className={`${ui.secondary} py-1.5 text-xs`} type="button" disabled={busy} onClick={() => void load()}>Refresh stats</button><button className={`${ui.danger} py-1.5 text-xs`} type="button" disabled={busy || !stats} onClick={() => void clear()}>{confirm ? 'Confirm clear cache' : 'Clear cache'}</button></div>
        {confirm && <p role="status">Clear this account’s local cache? Select confirm within 3 seconds.</p>}
        {error && <WidgetErrorState message={error} onRetry={() => void load()} />}
        {busy && <WidgetLoadingState message="Updating cache statistics..." />}
        {stats && <dl className="metric-strip" aria-label="Cache summary">{(['products', 'orders', 'customers'] as const).map(table => <div className="metric-strip-item" key={table}><dt className={`capitalize ${ui.muted}`}>{table}</dt><dd><span className="mt-1 block text-xl font-semibold tabular-nums">{stats[table].toLocaleString()} cached</span><span className={`mt-1 block ${ui.muted}`}>Last sync: {stats.lastSync[table] === null ? 'Never' : new Date(stats.lastSync[table]!).toLocaleString()}</span></dd></div>)}</dl>}
    </section>;
}
export default HotCacheWidget;
