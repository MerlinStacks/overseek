import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { getDateRange } from '../../utils/dateUtils';
import { record, rows, label, metric, count } from './analyticsRead';
const decodeDevices = (value: unknown) => decodeRates(value, 'device');
const decodeSources = (value: unknown) => decodeRates(value, 'source');
function decodeRates(value: unknown, field: string) { return rows(value).map(row => ({ label: label(row[field]), sessions: count(row.sessions), conversions: count(row.conversions), conversionRate: metric(row.conversionRate) })); }
function decodeBounce(value: unknown) { const data = record(value); const rate = metric(data.overallBounceRate); if (rate > 100) throw new Error('Invalid bounce rate'); return { rate: data.totalSessions === 0 ? null : rate }; }
export function CROView({ dateRange, explicitRange }: { dateRange: string; explicitRange?: { startDate: string; endDate: string } }) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p>Select an account and sign in to view conversion data.</p>;
    if (!['today', 'yesterday', '7d', '30d', '90d', 'ytd', 'all'].includes(dateRange)) return <p role="alert">Invalid conversion reporting range.</p>;
    return <CROContent key={`${currentAccount.id}:${token}:${dateRange}:${explicitRange?.startDate}:${explicitRange?.endDate}`} accountId={currentAccount.id} token={token} dateRange={dateRange} explicitRange={explicitRange} />;
}
function CROContent({ accountId, token, dateRange, explicitRange }: { accountId: string; token: string; dateRange: string; explicitRange?: { startDate: string; endDate: string } }) {
    const range = explicitRange ?? getDateRange(dateRange);
    const query = `startDate=${encodeURIComponent(range.startDate)}&endDate=${encodeURIComponent(range.endDate)}`;
    const devices = useScopedRequest(`/api/analytics/cro/device?${query}`, accountId, token, decodeDevices);
    const sources = useScopedRequest(`/api/analytics/cro/source?${query}`, accountId, token, decodeSources);
    const bounce = useScopedRequest(`/api/analytics/cro/bounce-rate?${query}`, accountId, token, decodeBounce);
    return <div className="space-y-6 text-slate-900 dark:text-slate-100">
        <Card><CardHeader><CardTitle>Bounce Rate</CardTitle></CardHeader><CardContent>{bounce.loading ? <p role="status">Loading bounce rate…</p> : bounce.error || bounce.data == null ? <div role="alert">Bounce rate unavailable. <button onClick={bounce.retry}>Retry bounce rate</button></div> : <p>{bounce.data.rate == null ? 'Unavailable (no tracked sessions)' : `${bounce.data.rate.toFixed(1)}%`}</p>}</CardContent></Card>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">{[{ title: 'Conversion Rate by Device', result: devices }, { title: 'Conversion Rate by Source', result: sources }].map(({ title, result }) => {
            const maximum = Math.max(...(result.data || []).map(row => row.conversionRate), 1);
            return <Card key={title}><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent>
                {result.loading ? <p role="status">Loading {title.toLowerCase()}…</p> : result.error ? <div role="alert">{title} unavailable. <button onClick={result.retry}>Retry {title.toLowerCase()}</button></div> : !result.data?.length ? <p>No observations in this range.</p> : result.data.map((row, index) => <div key={`${row.label}:${index}`} className="mb-4">
                    <div className="flex justify-between gap-4"><span>{row.label}</span><span>{row.sessions ? `${row.conversionRate.toFixed(2)}%` : 'Unavailable (no sessions)'}</span></div>
                    <div aria-hidden="true" className="h-2 rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-2 rounded-full bg-indigo-500" style={{ width: `${row.sessions ? Math.max(0, Math.min(100, row.conversionRate / maximum * 100)) : 0}%` }} /></div>
                    <p className="text-xs text-slate-500">{row.sessions.toLocaleString()} sessions · {row.conversions.toLocaleString()} conversions</p>
                </div>)}
            </CardContent></Card>;
        })}</div>
        <p className="text-xs text-slate-500">Rates use the server's tracked-session definitions; missing or excluded tracking is not proof of zero activity.</p>
    </div>;
}
