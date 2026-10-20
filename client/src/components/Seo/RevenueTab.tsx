/** Displays stored keyword estimates without inventing missing attribution metrics. */
import { Loader2, DollarSign } from 'lucide-react';
import { useKeywordRevenue, type KeywordRevenue } from '../../hooks/useSeoKeywords';

function available(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function metric(value: unknown, money = false): string {
    return available(value) ? value.toLocaleString(undefined, money ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : undefined) : 'Unavailable';
}
function sum(rows: KeywordRevenue[], key: keyof KeywordRevenue): number | null {
    if (!rows.every(row => available(row[key]))) return null;
    const total = rows.reduce((value, row) => value + Number(row[key]), 0);
    return Number.isFinite(total) ? total : null;
}

export function RevenueTab() {
    const { data, isLoading, error, refetch } = useKeywordRevenue();
    const keywords = data?.keywords || [];
    return <div className="space-y-6 animate-fade-slide-up motion-reduce:animate-none">
        <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Estimated Keyword Revenue</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">Stored estimates may overlap across keywords and are not total measured organic revenue. Currency and reporting period are not recorded for these estimates.</p>
        </div>
        {isLoading ? <div role="status" aria-label="Loading keyword revenue" className="flex justify-center py-12"><Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" /></div>
            : error ? <div role="alert">Could not load keyword revenue. <button type="button" onClick={() => void refetch()}>Retry revenue</button></div>
            : keywords.length === 0 ? <div className="glass-panel rounded-2xl text-center py-14 px-6"><DollarSign aria-hidden="true" className="mx-auto mb-3 text-slate-400" /><p>No keyword revenue estimates available.</p></div>
            : <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {[
                        ['Sum of keyword estimates (may overlap)', metric(sum(keywords, 'estimatedRevenue'), true)],
                        ['Reported Clicks', metric(sum(keywords, 'clicks'))],
                        ['Reported Conversions', metric(sum(keywords, 'conversions'))],
                    ].map(([label, value]) => <div key={label} className="glass-panel p-4 rounded-xl"><p className="text-xs text-slate-500 dark:text-slate-400">{label}</p><p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</p></div>)}
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Unavailable means the metric was not measured or returned, not zero.</p>
                <div className="glass-panel rounded-2xl overflow-x-auto">
                    <table className="w-full text-sm text-slate-700 dark:text-slate-200">
                        <caption className="sr-only">Keyword revenue estimates and available metrics</caption>
                        <thead><tr>{['Keyword', 'Clicks', 'Sessions', 'Conversions', 'Estimated Revenue', 'Revenue/Click'].map(label => <th scope="col" key={label} className="p-4 text-left">{label}</th>)}</tr></thead>
                        <tbody>{keywords.map(keyword => <tr key={keyword.keyword} className="border-t border-slate-200 dark:border-slate-700">
                            <th scope="row" className="p-4 text-left font-medium">{keyword.keyword}</th>
                            <td className="p-4">{metric(keyword.clicks)}</td><td className="p-4">{metric(keyword.sessions)}</td><td className="p-4">{metric(keyword.conversions)}</td>
                            <td className="p-4">{metric(keyword.estimatedRevenue, true)}</td><td className="p-4">{metric(keyword.revenuePerClick, true)}</td>
                        </tr>)}</tbody>
                    </table>
                </div>
            </>}
    </div>;
}
