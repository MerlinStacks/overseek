import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { formatDateTimeSafe } from '../../utils/format';
import { reportMoney, useReportRequest } from './useReportRequest';

interface ProfitItem {
    orderId: string; orderNumber: string; date: string; productId: number; variationId: number;
    name: string; sku: string; quantity: number; revenue: number; cogsUnit: number; cost: number; profit: number; margin: number;
}
interface ProfitSummary { revenue: number; cost: number; profit: number; margin: number }
interface Report { breakdown: ProfitItem[]; summary: ProfitSummary }
interface Props { startDate: string; endDate: string }
type SortColumn = 'date' | 'name' | 'revenue' | 'cost' | 'profit' | 'margin';
function decodeReport(value: unknown): Report {
    const report = value as Report;
    if (!report || !Array.isArray(report.breakdown) || !report.summary || !['revenue', 'cost', 'profit', 'margin'].every(key => Number.isFinite(report.summary[key as keyof ProfitSummary])) ||
        !report.breakdown.every(item => item && typeof item.name === 'string' && typeof item.date === 'string' && (typeof item.orderNumber === 'string' || typeof item.orderNumber === 'number') && (item.sku == null || typeof item.sku === 'string') && ['quantity', 'revenue', 'cogsUnit', 'cost', 'profit', 'margin'].every(key => Number.isFinite(item[key as keyof ProfitItem])))) throw new Error('Invalid profitability response');
    return report;
}

export function ProfitabilityReport(props: Props) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p role="status">Select an account to view profitability.</p>;
    return <AccountProfitability key={JSON.stringify([currentAccount.id, token, props.startDate, props.endDate])} {...props} token={token} accountId={currentAccount.id} currency={currentAccount.currency} />;
}

function AccountProfitability({ startDate, endDate, token, accountId, currency }: Props & { token: string; accountId: string; currency: string }) {
    const query = new URLSearchParams({ startDate, endDate });
    const { data, loading, error, retry } = useReportRequest(`/api/analytics/profitability?${query}`, accountId, token, decodeReport);
    const [sort, setSort] = useState<SortColumn>('date'); const [ascending, setAscending] = useState(false);
    const rows = useMemo(() => [...(data?.breakdown ?? [])].sort((first, second) => {
        const value = (item: ProfitItem) => sort === 'date' ? (Date.parse(item.date) || 0) : sort === 'name' ? item.name.toLowerCase() : item[sort];
        const a = value(first); const b = value(second);
        return (a < b ? -1 : a > b ? 1 : 0) * (ascending ? 1 : -1);
    }), [data, sort, ascending]);
    if (loading) return <p role="status">Calculating profitability...</p>;
    if (error || !data) return <p role="alert">Could not load profitability. <button type="button" onClick={retry}>Retry profitability</button></p>;
    const columns: Array<[SortColumn | 'quantity', string]> = [['date', 'Date'], ['name', 'Product'], ['quantity', 'Qty'], ['revenue', 'Revenue'], ['cost', 'COGS'], ['profit', 'Profit'], ['margin', 'Margin %']];
    return <section aria-label="Profitability report" className="space-y-4 text-slate-900 dark:text-slate-100">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {(['revenue', 'cost', 'profit', 'margin'] as const).map(key => <div key={key} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4"><p className="text-sm text-slate-500 dark:text-slate-400">{{ revenue: 'Total Revenue', cost: 'Total Cost (COGS)', profit: 'Gross Profit', margin: 'Overall Margin' }[key]}</p><p className="text-2xl font-semibold">{key === 'margin' ? `${data.summary.margin.toFixed(1)}%` : reportMoney(data.summary[key], currency)}</p></div>)}
        </div>
        <h2 className="text-xl font-bold">Profitability Breakdown</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Gross profit per sold item. Amounts are labelled with account currency; no currency conversion is performed here.</p>
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700"><table className="w-full text-left text-sm"><caption className="sr-only">Profitability per sold item</caption>
            <thead className="bg-slate-50 dark:bg-slate-800"><tr>{columns.map(([key, label]) => <th key={key} scope="col" className="p-3" aria-sort={sort === key ? ascending ? 'ascending' : 'descending' : undefined}>{key === 'quantity' ? label : <button type="button" className="font-semibold" onClick={() => { if (sort === key) setAscending(!ascending); else { setSort(key); setAscending(false); } }}>{label}{sort === key ? ascending ? ' ↑' : ' ↓' : ''}</button>}</th>)}</tr></thead>
            <tbody>{rows.map((item, index) => <tr key={`${item.orderId}-${item.productId}-${item.variationId}-${index}`} className="border-t border-slate-100 dark:border-slate-700">
                <td className="p-3 whitespace-nowrap">{formatDateTimeSafe(item.date, 'Date unavailable')}<div className="text-xs text-blue-600 dark:text-blue-400">#{item.orderNumber}</div></td>
                <th scope="row" className="p-3 font-medium">{item.name}<div className="text-xs text-slate-500 dark:text-slate-400">{item.sku || 'No SKU'}</div></th>
                <td className="p-3">{item.quantity}</td><td className="p-3">{reportMoney(item.revenue, currency)}</td>
                <td className="p-3">{reportMoney(item.cost, currency)}<div className="text-xs">({reportMoney(item.cogsUnit, currency)} ea)</div></td>
                <td className="p-3">{reportMoney(item.profit, currency)}</td><td className="p-3">{item.margin.toFixed(1)}%</td>
            </tr>)}{rows.length === 0 && <tr><td colSpan={7} className="p-8 text-center">No sales found in this period.</td></tr>}</tbody>
        </table></div>
    </section>;
}
