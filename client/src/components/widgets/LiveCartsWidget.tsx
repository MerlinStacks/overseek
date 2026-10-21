import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import type { WidgetProps } from './WidgetRegistry';
import { useWidgetRead } from '../../hooks/useWidgetRead';
import { isRecord, nonnegativeNumber } from '../../utils/responseValidation';
import { toValidDate } from '../../utils/format';
import { RelativeTime } from '../ui/RelativeTime';
import { reportMoney } from '../analytics/useReportRequest';
import { WidgetErrorState, WidgetLoadingState } from './WidgetState';
import { widgetCardClass, widgetTitleClass } from './widgetStyles';

interface Cart { id: string; visitorId: string; customerName?: string | null; email?: string | null; city?: string | null; country?: string | null; cartValue: number | null; currency?: string | null; lastActiveAt: string; itemCount: number | null; purchaseIntentScore: number | null; cartItems: Array<{ name: string }> }
function decode(value: unknown): Cart[] {
    if (!Array.isArray(value)) throw new Error('Invalid carts');
    return value.map(row => {
        if (!isRecord(row) || !['id', 'visitorId', 'lastActiveAt'].every(key => typeof row[key] === 'string') || !['customerName', 'email', 'city', 'country', 'currency'].every(key => row[key] == null || typeof row[key] === 'string') || !Array.isArray(row.cartItems) || !row.cartItems.every(item => isRecord(item) && typeof item.name === 'string')) throw new Error('Invalid cart');
        const total = row.cartValue == null ? null : nonnegativeNumber(row.cartValue);
        const count = row.itemCount == null ? null : nonnegativeNumber(row.itemCount);
        const intent = row.purchaseIntentScore == null ? null : nonnegativeNumber(row.purchaseIntentScore);
        if ((row.cartValue != null && total === null) || (row.itemCount != null && (count === null || !Number.isSafeInteger(count)))) throw new Error('Invalid cart metrics');
        if (row.purchaseIntentScore != null && (intent === null || intent > 100)) throw new Error('Invalid purchase intent');
        return { ...row, cartValue: total, itemCount: count, purchaseIntentScore: intent } as unknown as Cart;
    });
}
export default function LiveCartsWidget(props: WidgetProps) {
    const { token } = useAuth(); const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <p role="status">Select an account to view carts.</p>;
    return <AccountCarts key={JSON.stringify([token, currentAccount.id])} token={token} accountId={currentAccount.id} className={props.className} />;
}
function AccountCarts({ token, accountId, className = '' }: { token: string; accountId: string; className?: string }) {
    const read = useWidgetRead('/api/tracking/carts', accountId, token, decode, 30000);
    return <section aria-label="Live carts" className={`${widgetCardClass} p-4 h-full overflow-y-auto text-slate-900 dark:text-white ${className}`}>
        <h3 className={widgetTitleClass}>Live Carts</h3>
        {read.error && <WidgetErrorState message={read.error} onRetry={() => void read.refresh()} />}
        {read.data === null && !read.error && <WidgetLoadingState message="Loading carts..." />}
        {read.data?.length === 0 && <p>No active carts</p>}
        <ul className="space-y-2">{read.data?.map(cart => <li key={cart.id} className="p-3 rounded-lg bg-slate-50 dark:bg-slate-700/40">
            <p className="font-semibold">{cart.cartValue === null ? 'Value unavailable' : reportMoney(cart.cartValue, cart.currency ?? undefined)}</p>
            <p>{cart.customerName || cart.email || `Visitor ${cart.visitorId.slice(0, 6)}`}</p>
            {cart.purchaseIntentScore !== null && cart.purchaseIntentScore >= 70 && <p className="text-xs text-amber-700 dark:text-amber-400">High purchase intent · {cart.purchaseIntentScore}/100</p>}
            <p className="text-xs">{cart.itemCount === null ? 'Item count unavailable' : `${cart.itemCount} items`}{cart.cartItems[0] ? ` · ${cart.cartItems[0].name}` : ''}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{toValidDate(cart.lastActiveAt) ? <RelativeTime date={cart.lastActiveAt} /> : 'Date unavailable'}{cart.city || cart.country ? ` · ${[cart.city, cart.country].filter(Boolean).join(', ')}` : ''}</p>
        </li>)}</ul>
    </section>;
}
