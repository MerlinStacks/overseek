import { Edit2, Trash2, Loader2, ArrowRight, RefreshCw } from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import { useApiQuery } from '../../hooks/useApiQuery';
import type { SegmentCriteria } from './SegmentBuilder';

export interface CustomerSegmentSummary {
    id: string;
    name: string;
    description?: string | null;
    criteria: SegmentCriteria;
    updatedAt?: string;
    _count?: { campaigns: number };
    audienceSyncs?: { autoSyncEnabled: boolean }[];
}

export function CustomerSegmentCard({ segment, selected, refreshVersion, onEdit, onDelete, onPreview, onAdvertising }: {
    segment: CustomerSegmentSummary;
    selected: boolean;
    refreshVersion: number;
    onEdit: () => void;
    onDelete: () => void;
    onPreview: () => void;
    onAdvertising: () => void;
}) {
    const api = useApi();
    const { data, isLoading, error, refetch } = useApiQuery<{ count: number }>({
        queryKey: ['segment-customer-count', api.accountId, segment.id, segment.updatedAt || JSON.stringify(segment.criteria), refreshVersion],
        queryFn: async () => {
            const result = await api.get<{ count: number }>(`/api/segments/${encodeURIComponent(segment.id)}/count`);
            if (!Number.isInteger(result.count) || result.count < 0) throw new Error('Invalid segment count');
            return result;
        },
        enabled: api.isReady, staleTime: 30000, refetchInterval: 60000
    });
    const rules = segment.criteria?.rules?.length || 0;
    const campaigns = segment._count?.campaigns || 0;
    const syncing = segment.audienceSyncs?.some(sync => sync.autoSyncEnabled);

    return <article aria-label={segment.name} className={`flex flex-col rounded-xl border bg-white p-5 shadow-xs transition dark:bg-slate-800 ${selected ? 'border-[var(--brand-border)] ring-2 ring-[var(--focus-color)]' : 'border-gray-200 hover:border-gray-300 dark:border-slate-700'}`}>
        <div className="flex items-start justify-between gap-3">
            <span className="text-xs font-medium text-gray-500 dark:text-slate-400">Customer segment</span>
            <div className="-mr-1 -mt-1 flex items-center gap-1">
                <button onClick={onEdit} aria-label={`Edit ${segment.name}`} title="Edit segment" className="rounded-lg p-2 text-gray-400 hover:bg-[var(--brand-subtle)] hover:text-[var(--brand-text)] dark:hover:bg-slate-700"><Edit2 size={16} /></button>
                <button onClick={onDelete} aria-label={`Delete ${segment.name}`} title="Delete segment" className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-slate-700"><Trash2 size={16} /></button>
            </div>
        </div>
        <h3 className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{segment.name}</h3>
        {segment.description && <p className="mt-1 line-clamp-2 text-sm text-gray-500 dark:text-slate-400">{segment.description}</p>}
        <div className="my-3" aria-live="polite" aria-atomic="true">
            {isLoading ? <div className="flex min-h-14 items-center gap-2 text-sm text-gray-400"><Loader2 size={18} className="animate-spin" />Counting customers…</div> : <>
                <p className="text-xl font-semibold tracking-tight text-gray-900 tabular-nums dark:text-white">{data ? data.count.toLocaleString() : '—'}</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">{error && data ? 'Last count · refresh failed' : data?.count === 1 ? 'matching customer' : 'matching customers'}</p>
            </>}
            {error && <p className="mt-2 flex items-center gap-2 text-xs text-red-600 dark:text-red-400">{data ? 'Could not refresh count.' : 'Count unavailable.'}<button onClick={() => void refetch()} className="inline-flex items-center gap-1 font-medium underline"><RefreshCw size={12} />Retry count</button></p>}
        </div>
        <div className="mt-auto space-y-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-slate-400">
                <span>{rules === 0 ? 'All customers' : `Match ${segment.criteria.type === 'OR' ? 'any' : 'all'} · ${rules} ${rules === 1 ? 'rule' : 'rules'}`}</span>
                {campaigns > 0 && <span>{campaigns} {campaigns === 1 ? 'campaign' : 'campaigns'}</span>}
                {syncing && <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Auto-sync on</span>}
            </div>
            <div className="flex gap-2 border-t border-gray-100 pt-4 dark:border-slate-700">
                <button onClick={onPreview} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--brand-subtle)] px-3 py-2 text-sm font-medium text-[var(--brand-text)] hover:bg-[var(--brand-subtle)]">View Members<ArrowRight size={15} /></button>
                <button onClick={onAdvertising} title="Advertising exports & sync" className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">Advertising</button>
            </div>
        </div>
    </article>;
}
