import type { WidgetProps } from './WidgetRegistry';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useScopedRequest } from '../../hooks/useScopedRequest';
import { isRecord } from '../../utils/responseValidation';
import { reportMoney } from '../analytics/useReportRequest';
import { widgetCardClass, widgetTitleClass } from './widgetStyles';

interface Data { spend?: number | null; currency?: string | null; roas?: number | null; clicks?: number | null; hasData?: boolean }
function decode(value: unknown): Data {
    if (!isRecord(value) || (value.hasData !== undefined && typeof value.hasData !== 'boolean') || !['spend', 'roas', 'clicks'].every(key => value[key] == null || (typeof value[key] === 'number' && Number.isFinite(value[key]))) || (value.currency != null && (typeof value.currency !== 'string' || !/^[A-Z]{3}$/i.test(value.currency)))) throw new Error('Invalid ad metrics');
    return value;
}
export function AdSpendWidget(props: WidgetProps) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p role="status">Select an account to view ad spend.</p>;
    return <AccountAdSpend key={JSON.stringify([token, currentAccount.id, props.dateRange.startDate, props.dateRange.endDate])} {...props} token={token} accountId={currentAccount.id} />;
}
function AccountAdSpend({ className = '', dateRange, token, accountId }: WidgetProps & { token: string; accountId: string }) {
    const query = new URLSearchParams({ startDate: dateRange.startDate, endDate: dateRange.endDate });
    const { data, loading, error, retry } = useScopedRequest(`/api/analytics/ads-summary?${query}`, accountId, token, decode);
    return <section aria-label="Ad spend" className={`${widgetCardClass} h-full w-full p-6 space-y-4 ${className}`}>
        <h3 className={widgetTitleClass}>Ad Spend</h3>
        {loading ? <p role="status">Loading ad metrics...</p> : error || !data ? <p role="alert">Could not load ad spend. <button type="button" onClick={retry}>Retry ad spend</button></p> : data.hasData === false ? <p>No connected advertising accounts.</p> : <>
            <p className="text-xl font-semibold tabular-nums text-slate-900 dark:text-white">{data.spend == null ? 'Unavailable' : reportMoney(data.spend, data.currency ?? undefined)}</p>
            <dl className="flex justify-between text-slate-900 dark:text-white"><div><dt>ROAS</dt><dd>{data.roas == null ? 'Unavailable' : `${data.roas.toFixed(2)}x`}</dd></div><div><dt>Clicks</dt><dd>{data.clicks == null ? 'Unavailable' : data.clicks.toLocaleString()}</dd></div></dl>
        </>}
    </section>;
}
