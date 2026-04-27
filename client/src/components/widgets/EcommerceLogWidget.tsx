import { useState, useCallback } from 'react';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';
import { Logger } from '../../utils/logger';
import { ShoppingCart, CreditCard, LogOut, CheckCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { WidgetLoadingState, WidgetEmptyState, WidgetErrorState } from './WidgetState';

interface EcommerceItem {
    name?: string;
}

interface EcommercePayload {
    items?: EcommerceItem[];
    total?: number;
}

interface AnalyticsEvent {
    id: string;
    type: string;
    createdAt: string;
    payload?: EcommercePayload;
    pageTitle?: string;
    session?: {
        visitorId: string;
        email?: string;
        city?: string;
        country?: string;
    };
}

interface EcommerceLogResponse {
    data?: AnalyticsEvent[];
}

const EcommerceLogWidget = () => {
    const [events, setEvents] = useState<AnalyticsEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const fetchLog = useCallback(async () => {
        if (!token || !currentAccount) return;

        try {
            const res = await fetch('/api/analytics/ecommerce/log?limit=20&live=true', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const json = await res.json() as EcommerceLogResponse;
            setEvents(Array.isArray(json.data) ? json.data : []);
            setError(null);
        } catch (err) {
            Logger.error('An error occurred', { error: err });
            setError('Failed to load ecommerce stream');
        } finally {
            setLoading(false);
        }
    }, [currentAccount, token]);

    useVisibilityPolling(fetchLog, 15000, [fetchLog], 'ecommerce-log');

    const getIcon = (type: string) => {
        switch (type) {
            case 'add_to_cart': return <ShoppingCart className="w-4 h-4 text-emerald-500" />;
            case 'remove_from_cart': return <LogOut className="w-4 h-4 text-rose-400" />;
            case 'cart_view': return <ShoppingCart className="w-4 h-4 text-amber-500" />;
            case 'checkout_view': return <CreditCard className="w-4 h-4 text-amber-500" />;
            case 'checkout_start': return <CreditCard className="w-4 h-4 text-blue-500" />;
            case 'checkout_success':
            case 'purchase': return <CheckCircle className="w-4 h-4 text-green-600" />;
            default: return <ShoppingCart className="w-4 h-4 text-slate-400 dark:text-slate-500" />;
        }
    };

    const getLabel = (event: AnalyticsEvent) => {
        const who = event.session?.email || 'Guest';
        switch (event.type) {
            case 'add_to_cart': {
                const products = event.payload?.items?.map((item) => item.name).filter(Boolean).slice(0, 2);
                const productLabel = products?.length
                    ? products.join(', ') + ((event.payload?.items?.length || 0) > 2 ? ` +${(event.payload?.items?.length || 0) - 2} more` : '')
                    : 'items';
                const total = event.payload?.total ? ` ($${event.payload.total})` : '';
                return <span><span className="font-semibold text-slate-800 dark:text-slate-200">{who}</span> added <span className="text-slate-700 dark:text-slate-300">{productLabel}</span>{total}</span>;
            }
            case 'remove_from_cart':
                return <span><span className="font-semibold text-slate-800 dark:text-slate-200">{who}</span> removed items from cart</span>;
            case 'checkout_start':
                return <span><span className="font-semibold text-slate-800 dark:text-slate-200">{who}</span> started checkout</span>;
            case 'checkout_success':
            case 'purchase':
                return <span><span className="font-semibold text-emerald-700 dark:text-emerald-400">{who} completed a purchase!</span></span>;
            case 'cart_view': {
                const cartTotal = event.payload?.total ? ` ($${event.payload.total})` : '';
                return <span><span className="font-semibold text-slate-800 dark:text-slate-200">{who}</span> viewed cart{cartTotal}</span>;
            }
            case 'checkout_view': {
                const checkoutTotal = event.payload?.total ? ` ($${event.payload.total})` : '';
                return <span><span className="font-semibold text-slate-800 dark:text-slate-200">{who}</span> viewing checkout{checkoutTotal}</span>;
            }
            default:
                return <span>{who} performed {event.type}</span>;
        }
    };

    if (loading && events.length === 0) {
        return <WidgetLoadingState message="Loading stream..." />;
    }

    if (error && events.length === 0) {
        return <WidgetErrorState message={error} onRetry={fetchLog} />;
    }

    return (
        <div className="h-full overflow-y-auto custom-scrollbar p-2 space-y-2">
            {events.length === 0 ? (
                <WidgetEmptyState message="No recent commerce activity" />
            ) : (
                events.map((event) => (
                    <div key={event.id} className="flex gap-3 p-3 bg-white dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/50 rounded-lg shadow-xs">
                        <div className="mt-0.5 shrink-0 bg-slate-50 dark:bg-slate-700/50 p-2 rounded-full h-fit">
                            {getIcon(event.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-sm text-slate-600 dark:text-slate-300 truncate">
                                {getLabel(event)}
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400 dark:text-slate-500">
                                <span>{formatDistanceToNow(new Date(event.createdAt), { addSuffix: true })}</span>
                                {event.session?.country && (
                                    <>
                                        <span>&middot;</span>
                                        <span>{event.session.city ? `${event.session.city}, ` : ''}{event.session.country}</span>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                ))
            )}
        </div>
    );
};

export default EcommerceLogWidget;
