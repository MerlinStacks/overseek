import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { isRecord } from '../../utils/responseValidation';
import type { WidgetProps } from './WidgetRegistry';
import { WidgetErrorState, WidgetLoadingState } from './WidgetState';
import { widgetCardClass, widgetTitleClass } from './widgetStyles';

interface Summary { totalCount: number; productCount: number; variationCount: number; sampledCount: number; unavailableCount: number; lowestMarginItems: Array<{ name: string; margin: number }> }
function decode(value: unknown): Summary {
    if (!isRecord(value) || !['totalCount', 'productCount', 'variationCount', 'sampledCount', 'unavailableCount'].every(key => typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && (value[key] as number) >= 0) || !Array.isArray(value.lowestMarginItems) || !value.lowestMarginItems.every(item => isRecord(item) && typeof item.name === 'string' && typeof item.margin === 'number' && Number.isFinite(item.margin))) throw new Error('Invalid gold summary');
    const data = value as unknown as Summary;
    if (data.totalCount !== data.productCount + data.variationCount || data.sampledCount > data.totalCount || data.unavailableCount > data.sampledCount || data.lowestMarginItems.length > data.sampledCount - data.unavailableCount) throw new Error('Inconsistent gold summary');
    return data;
}
export function GoldPriceMarginWidget(props: WidgetProps) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p role="status">Select an account to view gold margins.</p>;
    return <AccountGold key={JSON.stringify([token, currentAccount.id])} accountId={currentAccount.id} token={token} className={props.className} />;
}
function AccountGold({ accountId, token, className = '' }: { accountId: string; token: string; className?: string }) {
    const read = useScopedRequest('/api/reports/gold-price/summary', accountId, token, decode);
    return <section aria-label="Gold price margins" className={`${widgetCardClass} p-4 h-full text-slate-900 dark:text-white space-y-3 ${className}`}>
        <h3 className={widgetTitleClass}>Gold Price Margins</h3>
        {read.loading ? <WidgetLoadingState message="Loading gold margins..." /> : read.error || !read.data ? <WidgetErrorState message="Could not load gold margins." onRetry={read.retry} /> : read.data.totalCount === 0 ? <p>No Gold Products</p> : <>
            <p>{read.data.totalCount} items · {read.data.sampledCount} sampled</p>
            <p className="text-xs">Lowest known margins in sample, not a store-wide ranking.</p>
            {read.data.unavailableCount > 0 && <p>{read.data.unavailableCount} sampled margins unavailable (missing or invalid inputs).</p>}
            {!read.data.lowestMarginItems.length && <p>No calculable margins in sample.</p>}
            <ul className="space-y-2">{read.data.lowestMarginItems.map((item, index) => <li key={index} className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-700/50"><span className="min-w-0 break-words text-xs font-medium">{item.name}</span><span className={`shrink-0 text-sm font-semibold tabular-nums ${item.margin < 20 ? 'text-red-600 dark:text-red-400' : item.margin < 40 ? 'text-amber-700 dark:text-amber-400' : 'text-green-700 dark:text-green-400'}`}>{item.margin.toFixed(1)}%</span></li>)}</ul>
        </>}
        <Link to="/reports/gold-price-margin" className="text-[var(--brand-text)] hover:underline focus-visible:outline-[var(--focus-color)]">View Full Report</Link>
    </section>;
}
