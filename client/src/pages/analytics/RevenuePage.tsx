import { useState } from 'react';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { DateRangeFilter } from '../../components/analytics/DateRangeFilter';
import { Metric, MetricStrip } from '../../components/ui/MetricStrip';
import { AOVTrendView } from '../../components/analytics/AOVTrendView';
import { record, metric, count, rows, label, money, validDays } from '../../components/analytics/analyticsRead';

function decodeRevenue(value: unknown) {
    const data = record(value);
    const breakdown = (key: string, field: string) => rows(data[key]).map(row => ({ label: label(row[field]), revenue: metric(row.revenue) })).sort((a, b) => b.revenue - a.revenue);
    return { totalRevenue: metric(data.totalRevenue), orderCount: count(data.orderCount), aov: metric(data.aov),
        groups: [{ title: 'Revenue by First Touch', rows: breakdown('byFirstTouch', 'source') }, { title: 'Revenue by Last Touch', rows: breakdown('byLastTouch', 'source') },
            { title: 'Revenue by Country', rows: breakdown('byCountry', 'country') }, { title: 'Revenue by Device', rows: breakdown('byDevice', 'device') }] };
}

export function RevenuePage() {
    const [days, setDays] = useState(30);
    const { currentAccount } = useAccount(); const { token } = useAuth();
    return <div className="p-6 space-y-6 text-slate-900 dark:text-slate-100">
        <div className="flex flex-wrap justify-between gap-4"><h1 className="text-2xl font-bold">Revenue Analytics</h1><DateRangeFilter value={days} onChange={setDays} /></div>
        {!currentAccount || !token ? <p>Select an account and sign in to view revenue.</p> : !validDays(days) ? <p role="alert">Invalid reporting range.</p> :
            <RevenueContent key={`${currentAccount.id}:${token}:${days}:${currentAccount.currency}`} accountId={currentAccount.id} token={token} days={days} currency={currentAccount.currency} />}
    </div>;
}
function RevenueContent({ accountId, token, days, currency }: { accountId: string; token: string; days: number; currency: string }) {
    const { data, loading, error, retry } = useScopedRequest(`/api/tracking/revenue?days=${days}`, accountId, token, decodeRevenue);
    if (loading) return <p role="status">Loading revenue…</p>;
    if (error || !data) return <div role="alert">Revenue unavailable. <button onClick={retry}>Retry revenue</button></div>;
    return <>
        <MetricStrip label="Revenue summary">{[
            ['Total Revenue', money(data.totalRevenue, currency)], ['Orders', data.orderCount.toLocaleString()], ['Avg Order Value', data.orderCount ? money(data.aov, currency) : 'Unavailable (no orders)'],
        ].map(([title, value]) => <Metric key={title} label={title} value={value} />)}</MetricStrip>
        <AOVTrendView days={days} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">{data.groups.map(group => <Card key={group.title}><CardHeader><CardTitle>{group.title}</CardTitle></CardHeader><CardContent>
            {!group.rows.length ? <p>No attributed revenue in this range.</p> : group.rows.slice(0, 8).map((row, index) => <div key={`${row.label}:${index}`} className="mb-3">
                <div className="flex justify-between gap-4 text-sm"><span>{row.label}</span><span>{money(row.revenue, currency)}</span></div>
                <div aria-hidden="true" className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full"><div className="h-2 bg-blue-500 rounded-full" style={{ width: `${group.rows[0].revenue > 0 ? Math.min(100, row.revenue / group.rows[0].revenue * 100) : 0}%` }} /></div>
            </div>)}
        </CardContent></Card>)}</div>
    </>;
}
export default RevenuePage;
