import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import type { WidgetProps } from './WidgetRegistry';
import { useWidgetSocket } from '../../hooks/useWidgetSocket';
import { useWidgetRead } from '../../hooks/useWidgetRead';
import { isRecord } from '../../utils/responseValidation';
import { WidgetErrorState, WidgetLoadingState } from './WidgetState';
import { widgetGlassCardClass } from './widgetStyles';

function decode(value: unknown): number {
    if (!isRecord(value) || typeof value.open !== 'number' || !Number.isSafeInteger(value.open) || value.open < 0) throw new Error('Invalid count');
    return value.open;
}
export function OpenInboxWidget(props: WidgetProps) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p role="status">Select an account to view conversations.</p>;
    return <AccountInbox key={JSON.stringify([token, currentAccount.id])} token={token} accountId={currentAccount.id} className={props.className} />;
}
function AccountInbox({ token, accountId, className = '' }: { token: string; accountId: string; className?: string }) {
    const read = useWidgetRead('/api/dashboard/inbox-count', accountId, token, decode, 60000);
    // Events only invalidate: never trust an event's count or tenant as displayed data.
    useWidgetSocket('conversation:updated', () => { void read.refresh(); });
    return <section aria-label="Open conversations" className={`${widgetGlassCardClass} p-6 h-full text-center ${className}`}>
        {read.error && <WidgetErrorState message={read.error} onRetry={() => void read.refresh()} />}
        {read.data === null && !read.error ? <WidgetLoadingState message="Loading conversations..." /> : <Link to="/inbox" className="block text-slate-900 dark:text-white"><span className="text-5xl font-bold">{read.data ?? 'Unavailable'}</span><span className="block mt-2">Open Conversations</span></Link>}
    </section>;
}
