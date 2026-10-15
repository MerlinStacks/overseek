import { useEffect, useState } from 'react';
import { ImageOff, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { formatCurrency } from '../../utils/format';
import { MetaCreativeReview } from './MetaCreativeReview';
import type { CreativeReport } from './metaCreativeTypes';

interface Props { adAccountId: string; adsetId: string; days: number }
const fatigueLabels = { potential_fatigue: 'Potential fatigue', no_signal: 'No fatigue signal', insufficient_data: 'Insufficient fatigue data' };

function Preview({ url, label }: { url: string; label: string }) {
    const [failed, setFailed] = useState(false);
    return failed ? <div className="p-4 flex items-center gap-2 text-sm text-slate-500"><ImageOff size={20} />Preview unavailable</div> : (
        <img src={url} alt={label} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="max-h-64 max-w-full rounded-lg object-contain bg-slate-100 dark:bg-slate-900" />
    );
}

export function MetaCreativePanel({ adAccountId, adsetId, days }: Props) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const accountId = currentAccount?.id;
    const [report, setReport] = useState<CreativeReport | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [sort, setSort] = useState<'spend' | 'roas' | 'ctr' | 'cpa'>('spend');

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError(null);
        setReport(null);
        setSelectedId(null);
        async function load() {
            try {
                const response = await fetch(`/api/ads/${adAccountId}/creatives?${new URLSearchParams({ adsetId, days: String(days) })}`, {
                    headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': accountId || '' }, signal: controller.signal
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Unable to load creative data');
                if (!controller.signal.aborted) {
                    setReport(data);
                    setSelectedId(data.creatives[0]?.creative.id || null);
                }
            } catch (err) {
                if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to load creative data');
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }
        void load();
        return () => controller.abort();
    }, [adAccountId, adsetId, days, accountId, token, attempt]);

    const selected = report?.creatives.find(item => item.creative.id === selectedId);
    const sorted = [...(report?.creatives || [])].sort((a, b) => sort === 'cpa'
        ? (a.metrics.cpa ?? Infinity) - (b.metrics.cpa ?? Infinity)
        : b.metrics[sort] - a.metrics[sort]);
    const currency = (value: number | null) => value === null ? '—' : formatCurrency(value, report?.currency);

    return (
        <section aria-label="Creative analysis" className="mt-5 space-y-4 border-t border-slate-200 dark:border-slate-700 pt-4 text-slate-900 dark:text-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h3 className="text-lg font-semibold">Creative analysis</h3><p className="text-xs text-slate-500 dark:text-slate-400">Compare current creatives across this ad set’s ads · Last {days} days</p></div>
                <button onClick={() => setAttempt(value => value + 1)} disabled={loading} className="text-sm text-indigo-600 dark:text-indigo-400 underline disabled:opacity-50">Refresh creatives</button>
            </div>
            {loading ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin" />Loading creative previews and comparisons...</p> : error ? (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>
            ) : report && <>
                <p className="text-sm text-slate-600 dark:text-slate-400">Observational ad-level results, not asset-level attribution or an A/B test. Reused creative IDs are grouped; different audiences and placements can affect results.</p>
                {report.creatives.length === 0 ? <p className="text-sm text-slate-500">No creative reporting activity in this period.</p> : <>
                    <label className="flex items-center gap-2 text-sm">Compare by
                        <select aria-label="Compare creatives by" value={sort} onChange={event => setSort(event.target.value as typeof sort)} className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 p-2">
                            <option value="spend">Spend (highest first)</option><option value="roas">ROAS (highest first)</option><option value="ctr">CTR (highest first)</option><option value="cpa">Cost per purchase (lowest first)</option>
                        </select>
                    </label>
                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-100 dark:bg-slate-800 text-xs uppercase text-slate-500 dark:text-slate-400"><tr>{['Creative', 'Ads', 'Spend', 'Impressions', 'CTR', 'Purchases', 'Revenue', 'CPA', 'ROAS', 'Fatigue'].map(title => <th key={title} className="p-3 whitespace-nowrap">{title}</th>)}</tr></thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                                {sorted.map(item => <tr key={item.creative.id} className={selectedId === item.creative.id ? 'bg-indigo-50 dark:bg-indigo-950/40' : 'bg-white dark:bg-slate-900'}>
                                    <td className="p-3"><button aria-pressed={selectedId === item.creative.id} onClick={() => setSelectedId(item.creative.id)} className="text-indigo-600 dark:text-indigo-400 font-medium text-left">{item.creative.name} <span className="block text-xs text-slate-500">{item.creative.format} · {item.creative.id}</span></button></td>
                                    <td className="p-3">{item.ads.length}</td><td className="p-3 whitespace-nowrap">{currency(item.metrics.spend)}</td><td className="p-3">{item.metrics.impressions.toLocaleString()}</td><td className="p-3">{item.metrics.ctr.toFixed(2)}%</td><td className="p-3">{item.metrics.purchases}</td><td className="p-3 whitespace-nowrap">{currency(item.metrics.revenue)}</td><td className="p-3 whitespace-nowrap">{currency(item.metrics.cpa)}</td><td className="p-3">{item.metrics.roas.toFixed(2)}x</td><td className="p-3 whitespace-nowrap">{fatigueLabels[item.fatigue.status]}</td>
                                </tr>)}
                            </tbody>
                        </table>
                    </div>
                    {selected && <article className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-5" aria-label={`Creative details: ${selected.creative.name}`}>
                        <div><h4 className="font-semibold">{selected.creative.name}</h4><p className="text-xs text-slate-500 dark:text-slate-400">{selected.creative.format} · Current creative configuration, not a placement-exact ad rendering</p></div>
                        <div className="grid gap-5 xl:grid-cols-2">
                            <div>
                                <h5 className="text-sm font-semibold mb-2">Creative previews</h5>
                                {selected.creative.assets.length ? <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {selected.creative.assets.slice(0, 6).map((asset, index) => <figure key={asset.url}>
                                        <Preview key={asset.url} url={asset.url} label={`${selected.creative.name} preview ${index + 1}`} />
                                        <figcaption className="text-xs text-slate-500 dark:text-slate-400 mt-1">{asset.kind === 'video_thumbnail' ? 'Video thumbnail only · video/audio not reviewed' : 'Image preview'}</figcaption>
                                    </figure>)}
                                    {selected.creative.assets.length > 6 && <p className="text-xs text-slate-500">Showing 6 of {selected.creative.assets.length} available previews.</p>}
                                </div> : <p className="text-sm text-slate-500">Meta did not provide a usable preview image. Copy and performance are still shown when available.</p>}
                            </div>
                            <div className="space-y-3 text-sm">
                                {[
                                    { title: 'Primary text', values: selected.creative.primaryTexts },
                                    { title: 'Headlines', values: selected.creative.headlines },
                                    { title: 'Descriptions', values: selected.creative.descriptions },
                                    { title: 'Calls to action', values: selected.creative.callToActions }
                                ].map(({ title, values }) => <div key={title}><h5 className="font-semibold mb-1">{title}</h5>{values.length ? values.map((value, index) => <p key={index} className="whitespace-pre-wrap mb-1">{value}</p>) : <p className="text-slate-500 dark:text-slate-400">Not provided by Meta</p>}</div>)}
                                {selected.creative.destinationUrl && <a href={selected.creative.destinationUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 underline">Open destination page</a>}
                            </div>
                        </div>
                        <section aria-label="Creative fatigue signals" className="rounded-lg bg-slate-50 dark:bg-slate-900 p-3 text-sm space-y-2">
                            <h5 className="font-semibold">{fatigueLabels[selected.fatigue.status]}</h5>
                            {report.comparison && <p className="text-xs text-slate-500 dark:text-slate-400">{report.comparison.recentSince}–{report.comparison.recentUntil} vs {report.comparison.previousSince}–{report.comparison.previousUntil} · Two complete 7-day windows, excluding today</p>}
                            {!report.comparison && <p className="text-xs text-slate-500 dark:text-slate-400">Select a reporting period of at least 15 days to compare two complete weeks, excluding today.</p>}
                            <ul className="list-disc pl-5 space-y-1">{selected.fatigue.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
                            {report.comparison && <p>CTR: {selected.fatigue.previous.ctr.toFixed(2)}% → {selected.fatigue.recent.ctr.toFixed(2)}% · CPA: {currency(selected.fatigue.previous.cpa)} → {currency(selected.fatigue.recent.cpa)}</p>}
                            <ul className="space-y-1">{selected.ads.map(ad => <li key={ad.id}>{ad.name} · {ad.status} · Period ad frequency: {ad.frequency === null ? 'unavailable' : `${ad.frequency.toFixed(2)}x`}</li>)}</ul>
                        </section>
                        <MetaCreativeReview key={`${accountId}-${adAccountId}-${adsetId}-${selected.creative.id}-${days}-${attempt}`} adAccountId={adAccountId} adsetId={adsetId} creativeId={selected.creative.id} days={days} hasImages={selected.creative.assets.length > 0} />
                    </article>}
                </>}
                <details className="text-xs text-slate-500 dark:text-slate-400"><summary className="cursor-pointer font-medium">Reporting and preview limitations</summary><ul className="list-disc pl-5 mt-2 space-y-1">{report.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>
            </>}
        </section>
    );
}
