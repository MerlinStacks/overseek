import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useReportRequest } from './useReportRequest';

interface VelocityItem { id: string; name: string; sku: string; image: string | null; stock: number; soldLast30d: number; dailyVelocity: number; daysRemaining: number }
type SortColumn = 'name' | 'stock' | 'soldLast30d' | 'dailyVelocity' | 'daysRemaining';
function decodeVelocity(value: unknown): VelocityItem[] {
    if (!Array.isArray(value) || !value.every(item => item && typeof item.id === 'string' && typeof item.name === 'string' && ['stock', 'soldLast30d', 'dailyVelocity', 'daysRemaining'].every(key => typeof item[key] === 'number' && Number.isFinite(item[key])))) throw new Error('Invalid stock velocity response');
    return value;
}

export function StockVelocityReport() {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p role="status">Select an account to view stock velocity.</p>;
    return <AccountVelocity key={JSON.stringify([currentAccount.id, token])} accountId={currentAccount.id} token={token} />;
}

function AccountVelocity({ accountId, token }: { accountId: string; token: string }) {
    const { data, loading, error, retry } = useReportRequest('/api/analytics/inventory/stock-velocity', accountId, token, decodeVelocity);
    const [sort, setSort] = useState<SortColumn>('daysRemaining'); const [ascending, setAscending] = useState(true);
    const rows = useMemo(() => [...(data ?? [])].sort((a, b) => {
        const value = (item: VelocityItem) => sort === 'name' ? item.name.toLowerCase() : sort === 'daysRemaining' && item.soldLast30d <= 0 && item.stock > 0 ? Infinity : item[sort];
        const first = value(a); const second = value(b);
        return (first < second ? -1 : first > second ? 1 : a.name.localeCompare(b.name)) * (ascending ? 1 : -1);
    }), [data, sort, ascending]);
    if (loading) return <p role="status">Calculating inventory velocity...</p>;
    if (error || !data) return <p role="alert">Could not load stock velocity. <button type="button" onClick={retry}>Retry stock velocity</button></p>;
    const columns: Array<[SortColumn, string]> = [['name', 'Product'], ['stock', 'Stock'], ['soldLast30d', '30d Sales'], ['dailyVelocity', 'Velocity'], ['daysRemaining', 'Days Left']];
    return <section aria-label="Stock velocity report" className="space-y-4 text-slate-900 dark:text-slate-100">
        <h2 className="text-xl font-bold">Stock Velocity</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Estimated inventory runway based on the last 30 days. No recent sales means there is insufficient demand data to forecast depletion.</p>
        <p className="text-sm">Products tracked: {data.length}</p>
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700"><table className="w-full text-left text-sm"><caption className="sr-only">Stock and estimated days remaining</caption>
            <thead className="bg-slate-50 dark:bg-slate-800"><tr>{columns.map(([key, label]) => <th scope="col" key={key} className="p-3" aria-sort={sort === key ? ascending ? 'ascending' : 'descending' : undefined}><button type="button" className="font-semibold" onClick={() => { if (sort === key) setAscending(!ascending); else { setSort(key); setAscending(true); } }}>{label}{sort === key ? ascending ? ' ↑' : ' ↓' : ''}</button></th>)}</tr></thead>
            <tbody>{rows.map(item => <tr key={item.id} className="border-t border-slate-100 dark:border-slate-700">
                <th scope="row" className="p-3 font-medium"><div className="flex items-center gap-3">{typeof item.image === 'string' && /^https?:\/\//i.test(item.image) && <img src={item.image} alt="" loading="lazy" className="w-10 h-10 shrink-0 rounded object-cover" />}<div>{item.name}<div className="text-xs text-slate-500 dark:text-slate-400">{typeof item.sku === 'string' && item.sku || 'No SKU'}</div></div></div></th>
                <td className="p-3">{item.stock}</td><td className="p-3">{item.soldLast30d}</td><td className="p-3">{item.dailyVelocity}</td>
                <td className="p-3">{item.stock <= 0 ? <span className="text-red-700 dark:text-red-300">Out of stock</span> : item.soldLast30d <= 0 ? 'No recent sales' : `${Math.max(0, item.daysRemaining)} Days`}</td>
            </tr>)}{rows.length === 0 && <tr><td colSpan={5} className="p-8 text-center">No stock data available. Ensure products have Manage Stock enabled.</td></tr>}</tbody>
        </table></div>
    </section>;
}
