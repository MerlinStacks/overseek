import { Fragment, useEffect, useState } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { formatCurrency } from '../../utils/format';
import { MetaCreativePanel } from './MetaCreativePanel';

interface MetaEntity {
    campaignId: string;
    campaignName: string;
    status: string;
    spend: number;
    conversions: number;
    conversionsValue: number;
    roas: number;
    currency: string;
}

interface Props {
    adAccountId: string;
    parentId: string;
    level: 'adset' | 'ad';
    days: number;
}

/** Lazy, account-scoped Meta hierarchy. Only entities with period activity are shown. */
export function MetaAdsDrilldown({ adAccountId, parentId, level, days }: Props) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [rows, setRows] = useState<MetaEntity[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const label = level === 'adset' ? 'Ad sets' : 'Ads';

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError(null);
        setRows([]);
        setExpanded(null);
        async function load() {
            try {
                const params = new URLSearchParams({ level, parentId, days: String(days) });
                const res = await fetch(`/api/ads/${adAccountId}/meta-entities?${params}`, {
                    headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': currentAccount?.id || '' },
                    signal: controller.signal
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || `Unable to load ${label.toLowerCase()}`);
                if (!controller.signal.aborted) setRows(data);
            } catch (err) {
                if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to load Meta data');
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }
        void load();
        return () => controller.abort();
    }, [adAccountId, parentId, level, days, token, currentAccount?.id, attempt, label]);

    return (
        <section aria-label={label} className="p-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">{label}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">Last {days} days · Only entities with reporting activity · Current delivery status</p>
            {loading ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin" />Loading {label.toLowerCase()}...</p> : error ? (
                <div role="alert" className="text-sm text-red-600 dark:text-red-400">{error} <button onClick={() => setAttempt(value => value + 1)} className="underline ml-2">Retry</button></div>
            ) : rows.length === 0 ? <p className="text-sm text-slate-500">No {label.toLowerCase()} with activity in this period.</p> : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase">
                            <tr>{[label, 'Delivery', 'Spend', 'Purchases', 'Revenue', 'ROAS'].map(title => <th key={title} className="p-2">{title}</th>)}</tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                            {rows.map(row => (
                                <Fragment key={row.campaignId}>
                                    <tr className="text-slate-800 dark:text-slate-200">
                                        <td className="p-2">{level === 'adset' ? (
                                            <button aria-expanded={expanded === row.campaignId} onClick={() => setExpanded(expanded === row.campaignId ? null : row.campaignId)} className="flex items-center gap-2 font-medium text-[var(--brand-text)]">
                                                <ChevronRight size={16} className={expanded === row.campaignId ? 'rotate-90' : ''} />{row.campaignName}
                                            </button>
                                        ) : row.campaignName}</td>
                                        <td className="p-2">{row.status}</td>
                                        <td className="p-2 whitespace-nowrap">{formatCurrency(row.spend, row.currency)}</td>
                                        <td className="p-2">{row.conversions}</td>
                                        <td className="p-2 whitespace-nowrap">{formatCurrency(row.conversionsValue, row.currency)}</td>
                                        <td className="p-2">{row.roas.toFixed(2)}x</td>
                                    </tr>
                                    {level === 'adset' && expanded === row.campaignId && <tr><td colSpan={6}><MetaAdsDrilldown adAccountId={adAccountId} parentId={row.campaignId} level="ad" days={days} /></td></tr>}
                                </Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {level === 'ad' && !loading && !error && <MetaCreativePanel key={`${currentAccount?.id}-${adAccountId}-${parentId}-${days}`} adAccountId={adAccountId} adsetId={parentId} days={days} />}
        </section>
    );
}
