import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { getStatusConfig } from '../../utils/orderStatus';
import { readBoundedBytes } from '../../utils/boundedResponse';
import { decodeStatusCounts, normalizeStatus as normalize } from './statusCountObservation';

interface Props { selectedStatus: string; onStatusChange: (status: string) => void }
const BASE = ['all', 'pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed'];
export function OrderStatusTabs(props: Props) {
    const { token, user } = useAuth(), { currentAccount } = useAccount();
    return <ScopedFilters key={JSON.stringify([token, user?.id, currentAccount?.id])} {...props} token={token ?? ''} accountId={currentAccount?.id ?? ''} />;
}
function ScopedFilters({ selectedStatus, onStatusChange, token, accountId }: Props & { token: string; accountId: string }) {
    const [data, setData] = useState<ReturnType<typeof decodeStatusCounts> | null>(null);
    const [state, setState] = useState('loading');
    useEffect(() => {
        if (!token || !accountId) return;
        let active = true;
        const controller = new AbortController();
        void (async () => {
            try {
                const response = await fetch('/api/sync/orders/status-counts', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId } });
                if (!response.ok) throw new Error('Read unavailable');
                const result = decodeStatusCounts(JSON.parse(new TextDecoder().decode(await readBoundedBytes(response, 64000))));
                if (active) { setData(result); setState('observed'); }
            } catch { if (active) setState('unavailable'); }
        })();
        return () => { active = false; controller.abort(); };
    }, [token, accountId]);
    const selected = normalize(selectedStatus) || 'all';
    const statuses = [...new Set([...BASE, ...Object.keys(data?.counts ?? {}).sort(), selected])];
    return <section className="rounded-xl border border-slate-200 bg-white/80 p-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" aria-label="Order status filters"><p role="status" className="text-xs text-slate-500 dark:text-slate-400">{!token || !accountId ? 'Select an account to observe counts.' : state === 'observed' ? 'Locally synced order counts; not live store coverage.' : state === 'loading' ? 'Loading status counts… Filters remain available.' : 'Status counts unavailable. No zero counts are inferred.'}</p><div className="flex gap-2 overflow-x-auto" role="group" aria-label="Filter orders by status">{statuses.map(status => {
        const config = getStatusConfig(status), count = status === 'all' ? data?.total : data?.counts[status];
        const label = status === 'all' ? 'All' : config.label === 'Unknown' ? status.replace(/-/g, ' ') : config.label;
        return <button key={status} type="button" aria-pressed={selected === status} onClick={() => onStatusChange(status)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm ${selected === status ? 'bg-indigo-700 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-700'}`}>{label}{count !== undefined && <span className="ml-2 tabular-nums">{count.toLocaleString()}</span>}</button>;
    })}</div></section>;
}
