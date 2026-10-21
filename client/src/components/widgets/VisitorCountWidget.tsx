import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import type { WidgetProps } from './WidgetRegistry';
import { useWidgetRead } from '../../hooks/useWidgetRead';
import { isRecord } from '../../utils/responseValidation';
import { WidgetErrorState, WidgetLoadingState } from './WidgetState';
import { widgetGlassCardClass } from './widgetStyles';

function liveCount(value: unknown): number {
    if (!Array.isArray(value) || !value.every(row => isRecord(row) && typeof row.id === 'string' && typeof row.visitorId === 'string')) throw new Error('Invalid live visitors');
    return value.length;
}
function dailyCount(value: unknown): number {
    if (!isRecord(value) || typeof value.count !== 'number' || !Number.isSafeInteger(value.count) || value.count < 0) throw new Error('Invalid visitor count');
    return value.count;
}
export function VisitorCountWidget(props: WidgetProps) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p role="status">Select an account to view visitors.</p>;
    return <AccountVisitors key={JSON.stringify([token, currentAccount.id])} token={token} accountId={currentAccount.id} className={props.className} />;
}
function AccountVisitors({ token, accountId, className = '' }: { token: string; accountId: string; className?: string }) {
    const live = useWidgetRead('/api/tracking/live', accountId, token, liveCount, 10000);
    const daily = useWidgetRead('/api/tracking/visitors-24h', accountId, token, dailyCount, 10000);
    return <section aria-label="Visitor counts" className={`${widgetGlassCardClass} p-6 h-full text-center text-slate-900 dark:text-white ${className}`}>
        <h3>Active Visitors</h3>
        {live.error && <WidgetErrorState message={`Live visitors: ${live.error}`} onRetry={() => void live.refresh()} />}
        {live.data === null && !live.error ? <WidgetLoadingState message="Loading active visitors..." /> : <p className="text-5xl font-bold">{live.data === null ? 'Unavailable' : `${live.data}${live.data >= 50 ? '+' : ''}`}</p>}
        <p className="text-xs text-slate-500 dark:text-slate-400">Visible live sessions (up to 50 returned)</p>
        {daily.error && <WidgetErrorState message={`24-hour visitors: ${daily.error}`} onRetry={() => void daily.refresh()} />}
        {daily.data === null && !daily.error ? <WidgetLoadingState message="Loading 24-hour visitors..." /> : <p>{daily.data?.toLocaleString() ?? 'Unavailable'} in last 24h</p>}
    </section>;
}
