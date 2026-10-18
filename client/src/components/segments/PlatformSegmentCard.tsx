import { Globe, Copy } from 'lucide-react';

export interface PlatformSegment {
    id: string;
    name: string;
    kind: 'WEBSITE' | 'LOOKALIKE';
    platform: string;
    status: string;
    externalId: string | null;
    lastError: string | null;
    definition: { retentionDays?: number; exclusionDays?: number; excludePurchasers?: boolean; event?: string; urlContains?: string; country?: string; percent?: number };
    adAccount: { name: string | null };
}

export function PlatformSegmentCard({ segment, busy, onRetry, onReconcile }: {
    segment: PlatformSegment;
    busy: boolean;
    onRetry: (id: string) => void;
    onReconcile: (id: string) => void;
}) {
    return <article className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-start justify-between gap-3">
            <div className="rounded-lg bg-indigo-50 p-3 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
                {segment.kind === 'LOOKALIKE' ? <Copy size={24} /> : <Globe size={24} />}
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium dark:bg-slate-700">{segment.status === 'CREATED' ? 'Created · platform managed' : segment.status.replace(/_/g, ' ')}</span>
        </div>
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{segment.name}</h3>
        <p className="text-sm text-slate-600 dark:text-slate-300">{segment.platform} · {segment.adAccount.name || 'Advertising account'} · {segment.kind === 'LOOKALIKE' ? 'Lookalike segment' : 'Website segment'}</p>
        <p className="text-sm text-slate-600 dark:text-slate-300">{segment.kind === 'LOOKALIKE'
            ? `${segment.definition.country} · ${segment.definition.percent}% · platform-maintained source expansion`
            : `${segment.definition.event || 'URL contains'}${segment.definition.urlContains ? ` · ${segment.definition.urlContains}` : ''} · ${segment.definition.retentionDays} days${segment.definition.excludePurchasers ? ` · excluding purchasers (${segment.definition.exclusionDays} days)` : ''}`}</p>
        {segment.externalId && <p className="break-all text-xs text-slate-500 dark:text-slate-400">Platform ID: {segment.externalId}</p>}
        {segment.lastError && <p className="text-sm text-red-600 dark:text-red-400">{segment.lastError}</p>}
        {segment.status === 'FAILED' && <button onClick={() => onRetry(segment.id)} disabled={busy} className="text-sm font-medium text-indigo-600 disabled:opacity-50 dark:text-indigo-300">Retry creation</button>}
        {segment.status === 'NEEDS_REVIEW' && <button onClick={() => onReconcile(segment.id)} disabled={busy} className="text-sm font-medium text-indigo-600 disabled:opacity-50 dark:text-indigo-300">Check platform result</button>}
        <p className="border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">Membership updates in {segment.platform === 'META' ? 'Meta' : 'Google'}. Individual visitors cannot be previewed or used for email broadcasts. Campaign targeting is managed in the platform.</p>
    </article>;
}
