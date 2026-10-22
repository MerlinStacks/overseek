import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { record, rows, label, metric, count, money } from '../../components/analytics/analyticsRead';
function decode(value: unknown) {
    const data = record(value); const observation = record(data.observation); const returning = record(data.newVsReturning);
    if (observation.basis !== 'observed-window-spend' || typeof observation.start !== 'string' || typeof observation.end !== 'string' ||
        !Number.isFinite(Date.parse(observation.start)) || !Number.isFinite(Date.parse(observation.end)) || Date.parse(observation.end) < Date.parse(observation.start) ||
        typeof observation.ordersTruncated !== 'boolean' || typeof observation.sessionsTruncated !== 'boolean') throw new Error('Missing spend methodology');
    const newCustomers = count(returning.newCustomers), returningCustomers = count(returning.returningCustomers);
    return { observation: { start: observation.start, end: observation.end, currency: typeof observation.currency === 'string' && /^[A-Z]{3}$/.test(observation.currency) ? observation.currency : null,
        incomplete: observation.ordersTruncated || observation.sessionsTruncated, excludedOrders: count(observation.excludedOrders) },
        average: metric(data.averageCLV), median: metric(data.medianCLV), newCustomers, returningCustomers,
        distribution: rows(data.distribution).map(row => ({ label: label(row.label), count: count(row.count) })),
        sources: rows(data.clvBySource).map(row => ({ source: label(row.source), average: metric(row.avgCLV), customers: count(row.customerCount) })),
        trend: rows(data.monthlyTrend).map(row => { const month = label(row.month); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid cohort month'); return { month, average: metric(row.avgCLV), customers: count(row.customerCount) }; }).sort((a, b) => a.month.localeCompare(b.month)),
    };
}
export const CLVPage = () => {
    const { token, user } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p>Sign in and select an account to view observed customer spend.</p>;
    return <ScopedCLV key={JSON.stringify([user?.id, token, currentAccount.id])} accountId={currentAccount.id} token={token} />;
};
function ScopedCLV({ accountId, token }: { accountId: string; token: string }) {
    const [months, setMonths] = useState(1);
    return <div className="p-4 space-y-5 text-slate-900 dark:text-slate-100">
        <header className="flex flex-wrap justify-between gap-3"><h1 className="text-2xl font-bold">Observed Customer Spend</h1>
            <label>Window starts at first UTC day of <select value={months} onChange={event => setMonths(Number(event.target.value))} className="bg-white dark:bg-slate-800">{[1, 3, 6, 12].map(value => <option key={value} value={value}>{value} {value === 1 ? 'month' : 'months'} ago</option>)}</select></label></header>
        <SpendContent key={months} accountId={accountId} token={token} months={months} />
    </div>;
}
function SpendContent({ accountId, token, months }: { accountId: string; token: string; months: number }) {
    const read = useScopedRequest(`/api/analytics/clv?monthsBack=${months}`, accountId, token, decode);
    if (read.loading) return <p role="status">Loading observed customer spend…</p>;
    if (read.error || !read.data) return <p role="alert">Customer spend unavailable. <button type="button" onClick={read.retry}>Retry customer spend</button></p>;
    const data = read.data; const observation = data.observation; const total = data.newCustomers + data.returningCustomers;
    const monetary = (value: number) => observation.currency ? money(value, observation.currency) : 'Unavailable (mixed or unknown currency)';
    const maximum = data.trend.reduce((max, row) => Math.max(max, row.average), 0);
    return <div className="space-y-5">
        <p>Observed revenue per email-identified customer in {observation.start.slice(0, 10)} through {observation.end.slice(0, 10)} (UTC), not complete lifetime value or a forecast. Repeat means multiple orders within this window, not lifetime returning-customer status.</p>
        {(observation.incomplete || observation.excludedOrders > 0) && <p role="alert">Coverage is partial: {observation.incomplete ? 'a source row limit was reached; ' : ''}{observation.excludedOrders} orders without customer email excluded. Attribution uses the earliest returned in-window session, not proven lifetime acquisition.</p>}
        {!observation.currency && <p role="status">Monetary summaries are withheld because the returned orders do not establish one known currency.</p>}
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4"><div><dt>Average observed spend</dt><dd>{total ? monetary(data.average) : 'Unavailable (no customers)'}</dd></div><div><dt>Median observed spend</dt><dd>{total ? monetary(data.median) : 'Unavailable (no customers)'}</dd></div><div><dt>Observed customers</dt><dd>{total}</dd></div><div><dt>Multi-order share in window</dt><dd>{total ? `${(data.returningCustomers / total * 100).toFixed(1)}%` : 'Unavailable (no customers)'}</dd></div></dl>
        {observation.currency && <section aria-label="Observed spend distribution"><h2>Spend distribution ({observation.currency})</h2><ul>{data.distribution.map((row, index) => <li key={index}>{row.label}: {row.count} customers</li>)}</ul></section>}
        <section aria-label="Customer cohort spend"><h2>Spend by first observed order month in this window</h2><ul>{data.trend.map(row => <li key={row.month} className="mb-3"><p>{row.month}: {monetary(row.average)} · {row.customers} customers</p><div aria-hidden="true" className="h-2 bg-slate-100 dark:bg-slate-800"><div className="h-2 bg-indigo-500" style={{ width: `${observation.currency && maximum > 0 ? row.average / maximum * 100 : 0}%` }} /></div></li>)}</ul></section>
        <section><h2>Spend by observed source</h2><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="text-left">Source</th><th>Average observed spend</th><th>Customers</th></tr></thead><tbody>{data.sources.map(row => <tr key={row.source}><td>{row.source}</td><td className="text-center">{monetary(row.average)}</td><td className="text-center">{row.customers}</td></tr>)}</tbody></table></div></section>
    </div>;
}
export default CLVPage;
