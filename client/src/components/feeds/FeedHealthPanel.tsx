import { useApiQuery } from '../../hooks/useApiQuery';
import { useState } from 'react';

interface ExportEvent { at: string; status: 'generated' | 'failed'; message: string }
export interface FeedHealthReport {
    generatedAt: string;
    scannedProducts: number;
    included: number;
    excluded: number;
    exclusions: Record<string, number>;
    errors: number;
    warnings: number;
    issues: Array<{ severity: 'error' | 'warning'; rowId: string; name: string; field: string; message: string }>;
    excludedExamples: Array<{ rowId: string; name: string; reason: string }>;
    lastProductSyncAt: string | null;
    lastAttempt: ExportEvent | null;
    lastSuccess: ExportEvent | null;
    lastFailure: ExportEvent | null;
}

const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleString() : 'Not recorded';

export function FeedHealthResults({ report }: { report: FeedHealthReport }) {
    return (
        <div className="space-y-3 text-sm text-slate-700 dark:text-slate-200">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {([['Included rows', report.included], ['Excluded rows', report.excluded], ['Validation errors', report.errors], ['Warnings', report.warnings]] as const).map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900/50">
                        <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
                        <div className="text-xl font-semibold">{value.toLocaleString()}</div>
                    </div>
                ))}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
                {report.scannedProducts.toLocaleString()} products scanned at {dateLabel(report.generatedAt)}. Counts apply to the selected variation mode, not your search. Checks are read-only and do not remove invalid items. Results are cached for up to 60 seconds.
            </p>
            <dl className="grid gap-1 text-xs">
                <div><dt className="inline font-medium">Last successful product sync: </dt><dd className="inline">{dateLabel(report.lastProductSyncAt)}</dd></div>
                <div><dt className="inline font-medium">Last local export attempt: </dt><dd className="inline">{dateLabel(report.lastAttempt?.at)}{report.lastAttempt ? ` (${report.lastAttempt.status})` : ''}</dd></div>
                <div><dt className="inline font-medium">Last locally generated export: </dt><dd className="inline">{dateLabel(report.lastSuccess?.at)}</dd></div>
                <div><dt className="inline font-medium">Last export failure: </dt><dd className="inline">{dateLabel(report.lastFailure?.at)}</dd></div>
            </dl>
            {report.lastAttempt?.status === 'failed' && <p role="alert" className="text-rose-600 dark:text-rose-400">{report.lastAttempt.message}</p>}
            <p className="text-xs text-slate-500 dark:text-slate-400">Export history is retained for 30 days from this release. Local generation does not verify delivery or Google/Meta acceptance. Check Merchant Center or Commerce Manager for platform diagnostics. Live product pages have not been checked.</p>
            {report.excluded > 0 && (
                <details>
                    <summary className="cursor-pointer font-medium">Exclusion reasons</summary>
                    <ul className="mt-2 list-disc pl-5">{Object.entries(report.exclusions).map(([reason, count]) => <li key={reason}>{reason}: {count}</li>)}</ul>
                    <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
                        {report.excludedExamples.map((item) => <li key={item.rowId}>{item.name} ({item.rowId}): {item.reason}</li>)}
                    </ul>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Showing up to 50 excluded rows. Each row is counted once using its first applicable exclusion reason.</p>
                </details>
            )}
            {report.issues.length > 0 && (
                <details>
                    <summary className="cursor-pointer font-medium">Validation details ({report.errors + report.warnings} issues)</summary>
                    <ul className="mt-2 max-h-96 space-y-3 overflow-y-auto">
                        {report.issues.map((issue, index) => (
                            <li key={`${issue.rowId}-${issue.field}-${index}`} className="text-xs">
                                <p className={issue.severity === 'error' ? 'font-medium text-rose-600 dark:text-rose-400' : 'font-medium text-amber-700 dark:text-amber-300'}>
                                    {issue.severity === 'error' ? 'Error' : 'Warning'}: {issue.name} ({issue.rowId}) · {issue.field}
                                </p>
                                <p>{issue.message}</p>
                            </li>
                        ))}
                    </ul>
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Showing the first 100 issues. Edit the corresponding fields in the spreadsheet or product feed editor.</p>
                </details>
            )}
        </div>
    );
}

export function FeedHealthPanel({ accountId, channel, variationMode, headers }: {
    accountId: string; channel: string; variationMode: string; headers: Record<string, string>;
}) {
    return <ScopedFeedHealth key={JSON.stringify([accountId, channel, variationMode, headers.Authorization ?? headers.authorization])} accountId={accountId} channel={channel} variationMode={variationMode} headers={headers} />;
}
function ScopedFeedHealth({ accountId, channel, variationMode, headers }: { accountId: string; channel: string; variationMode: string; headers: Record<string, string> }) {
    const [isChecking, setIsChecking] = useState(false);
    const [scopeKey] = useState(() => crypto.randomUUID());
    const ready = !!accountId && !!(headers.Authorization ?? headers.authorization);
    const { data, error, refetch } = useApiQuery<FeedHealthReport>({
        queryKey: ['feed-health', scopeKey, accountId, channel, variationMode],
        enabled: false,
        manual: ready,
        queryFn: async signal => {
            const res = await fetch(`/api/feeds/${channel}/health?variationMode=${encodeURIComponent(variationMode)}`, { headers, signal });
            if (!res.ok) throw new Error('Failed to check feed health. Please try again.');
            return res.json();
        },
    });
    return (
        <section className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700" aria-label="Feed health">
            <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold text-slate-900 dark:text-white">Feed health ({channel})</h2>
                <button type="button" disabled={isChecking || !ready} onClick={async () => {
                    setIsChecking(true);
                    try { await refetch(); } catch { /* The query's error state below is the acknowledgement failure. */ } finally { setIsChecking(false); }
                }} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50">
                    {isChecking ? 'Checking...' : 'Check feed health'}
                </button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">On-demand catalogue checks for the selected variation mode. No changes are made to your feed or WooCommerce.</p>
            {error && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{error instanceof Error ? error.message : 'Feed health check failed.'}</p>}
            {data && <FeedHealthResults report={data} />}
        </section>
    );
}
