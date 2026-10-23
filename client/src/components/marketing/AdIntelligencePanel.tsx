import { useId, useState } from 'react';
import { Metric, MetricStrip } from '../ui/MetricStrip';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { finiteFields, isRecord } from '../../utils/responseValidation';
import { reportMoney } from '../analytics/useReportRequest';

interface Summary { currency?: string | null; overlapCount: number; organicOnlyCount: number; estimatedWastedSpend: number; cannibalizationCount: number; negativeCandidates: number; hasData: boolean }
interface Overlap { query: string; organic: { position: number; ctr: number }; paid: { spend: number; roas: number }; estimatedWastedSpend: number; cannibalizationScore: number }
interface Organic { query: string; position: number; clicks: number; ctr: number; estimatedPaidValue: number }
interface Correlation { currency?: string | null; overlap: Overlap[]; organicOnly: Organic[] }
const validCurrency = (value: unknown) => value == null || (typeof value === 'string' && /^[A-Z]{3}$/i.test(value));
function decodeSummary(value: unknown): Summary {
    if (!isRecord(value) || typeof value.hasData !== 'boolean' || !validCurrency(value.currency) || !finiteFields(value, ['overlapCount', 'organicOnlyCount', 'estimatedWastedSpend', 'cannibalizationCount', 'negativeCandidates'])) throw new Error('Invalid intelligence summary');
    return value as unknown as Summary;
}
function decodeCorrelation(value: unknown): Correlation {
    if (!isRecord(value) || !validCurrency(value.currency) || !Array.isArray(value.overlap) || !Array.isArray(value.organicOnly) ||
        !value.overlap.every(item => isRecord(item) && typeof item.query === 'string' && finiteFields(item, ['estimatedWastedSpend', 'cannibalizationScore']) && isRecord(item.organic) && finiteFields(item.organic, ['position', 'ctr']) && isRecord(item.paid) && finiteFields(item.paid, ['spend', 'roas'])) ||
        !value.organicOnly.every(item => isRecord(item) && typeof item.query === 'string' && finiteFields(item, ['position', 'clicks', 'ctr', 'estimatedPaidValue']))) throw new Error('Invalid correlation');
    return value as unknown as Correlation;
}
function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
    const [open, setOpen] = useState(true); const id = useId();
    return <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3"><button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="font-semibold">{title} ({count}) {open ? '−' : '+'}</button><div id={id} hidden={!open}>{children}</div></section>;
}
export function AdIntelligencePanel() {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p role="status">Select an account to view search intelligence.</p>;
    return <AccountIntelligence key={JSON.stringify([token, currentAccount.id])} token={token} accountId={currentAccount.id} />;
}
function AccountIntelligence({ accountId, token }: { accountId: string; token: string }) {
    const summary = useScopedRequest('/api/ads/intelligence/summary', accountId, token, decodeSummary);
    const correlation = useScopedRequest(summary.data?.hasData ? '/api/ads/intelligence/correlation' : null, accountId, token, decodeCorrelation);
    if (summary.loading) return <p role="status">Loading search intelligence...</p>;
    if (summary.error || !summary.data) return <p role="alert">Could not load search intelligence. <button type="button" onClick={summary.retry}>Retry intelligence</button></p>;
    if (!summary.data.hasData) return <p>No search intelligence data yet. Connect Search Console and Google Ads to see organic and paid insights.</p>;
    const data = summary.data; const rows = correlation.data;
    const cannibalized = rows?.overlap.filter(item => item.cannibalizationScore >= 50) ?? [];
    return <div className="space-y-4 text-slate-900 dark:text-slate-100">
        <h2 className="text-lg font-semibold">Search Intelligence</h2>
        <MetricStrip label="Search intelligence summary">{[
            ['Cannibalized Keywords', data.cannibalizationCount], ['Est. Wasted Spend', reportMoney(data.estimatedWastedSpend, data.currency ?? undefined)],
            ['Organic Opportunities', data.organicOnlyCount], ['Neg Keyword Candidates', data.negativeCandidates]
        ].map(([label, value]) => <Metric key={label} label={label} value={value} />)}</MetricStrip>
        <p className="text-xs text-slate-500 dark:text-slate-400">Estimates use the reporting window and ad currency, without currency conversion. Scores are heuristic indicators, not statistical confidence.</p>
        {correlation.loading && <p role="status">Loading correlation details...</p>}
        {correlation.error && <p role="alert">Could not load correlation details. <button type="button" onClick={correlation.retry}>Retry correlation</button></p>}
        {!correlation.loading && !correlation.error && rows && <>
            {cannibalized.length > 0 && <Section title="Cannibalized Keywords" count={cannibalized.length}><ul className="space-y-3">{cannibalized.slice(0, 10).map(item => <li key={item.query}><p className="font-medium">{item.query}</p><p className="text-sm">Organic #{item.organic.position.toFixed(0)} · {item.organic.ctr.toFixed(1)}% CTR · Paid {reportMoney(item.paid.spend, rows.currency ?? undefined)} · {item.paid.roas.toFixed(1)}x ROAS</p><p className="text-sm">Estimated overlap spend: {reportMoney(item.estimatedWastedSpend, rows.currency ?? undefined)} · Score {item.cannibalizationScore}/100</p></li>)}</ul></Section>}
            {rows.organicOnly.length > 0 && <Section title="Organic Keyword Opportunities" count={rows.organicOnly.length}><ul className="space-y-3">{rows.organicOnly.slice(0, 10).map(item => <li key={item.query}><p className="font-medium">{item.query}</p><p className="text-sm">Position #{item.position.toFixed(0)} · {item.clicks} clicks · {item.ctr.toFixed(1)}% CTR · Estimated paid value {reportMoney(item.estimatedPaidValue, rows.currency ?? undefined)}</p></li>)}</ul></Section>}
            {!cannibalized.length && !rows.organicOnly.length && <p>No overlap or organic opportunities found in this reporting window.</p>}
        </>}
    </div>;
}
