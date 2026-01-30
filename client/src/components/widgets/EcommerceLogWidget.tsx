
import { useState, useCallback } from 'react';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';
import { Logger } from '../../utils/logger';
import { ShoppingCart, CreditCard, LogOut, CheckCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface AnalyticsEvent {
    id: string;
    type: string;
    createdAt: string;
    payload?: any;
    pageTitle?: string;
    session?: {
        visitorId: string;
        email?: string;
        city?: string;
        country?: string;
    };
}

const EcommerceLogWidget = () => {
    const [events, setEvents] = useState<AnalyticsEvent[]>([]);
    const [loading, setLoading] = useState(true);

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
            if (res.ok) {
                const json = await res.json();
                setEvents(json.data);
            }
        } catch (err) {
            Logger.error('An error occurred', { error: err });
        } finally {
            setLoading(false);
        }
    }, [token, currentAccount]);

    // Use visibility-aware polling with tab coordination
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
            default: return <ShoppingCart className="w-4 h-4 text-gray-400" />;
        }
    };

    const getLabel = (e: AnalyticsEvent) => {
        const who = e.session?.email || 'Guest';
        switch (e.type) {
            case 'add_to_cart':
                const products = e.payload?.items?.map((item: any) => item.name).filter(Boolean).slice(0, 2);
                const productLabel = products?.length
                    ? products.join(', ') + (e.payload?.items?.length > 2 ? ` +${e.payload.items.length - 2} more` : '')
                    : 'items';
                const total = e.payload?.total ? ` ($${e.payload.total})` : '';
                return <span><span className="font-semibold text-gray-800">{who}</span> added <span className="text-gray-700">{productLabel}</span>{total}</span>;
            case 'remove_from_cart':
                return <span><span className="font-semibold text-gray-800">{who}</span> removed items from cart</span>;
            case 'checkout_start':
                return <span><span className="font-semibold text-gray-800">{who}</span> started checkout</span>;
            case 'checkout_success':
            case 'purchase':
                return <span><span className="font-semibold text-emerald-700">{who} completed a purchase!</span></span>;
            case 'cart_view':
                const cartTotal = e.payload?.total ? ` ($${e.payload.total})` : '';
                return <span><span className="font-semibold text-gray-800">{who}</span> viewed cart{cartTotal}</span>;
            case 'checkout_view':
                const checkoutTotal = e.payload?.total ? ` ($${e.payload.total})` : '';
                return <span><span className="font-semibold text-gray-800">{who}</span> viewing checkout{checkoutTotal}</span>;
            default:
                return <span>{who} performed {e.type}</span>;
        }
    };

    if (loading && events.length === 0) return <div className="p-4 text-xs text-gray-500">Loading stream...</div>;

    return (
        <div className="h-full overflow-y-auto custom-scrollbar p-2 space-y-2">
            {events.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                    <ShoppingCart className="w-6 h-6 mb-2 opacity-50" />
                    <span className="text-xs">No recent commerce activity</span>
                </div>
            ) : (
                events.map(e => (
                    <div key={e.id} className="flex gap-3 p-3 bg-white border border-gray-100 rounded-lg shadow-xs">
                        <div className="mt-0.5 shrink-0 bg-gray-50 p-2 rounded-full h-fit">
                            {getIcon(e.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-sm text-gray-600 truncate">
                                {getLabel(e)}
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-400">
                                <span>{formatDistanceToNow(new Date(e.createdAt), { addSuffix: true })}</span>
                                {e.session?.country && (
                                    <>
                                        <span>•</span>
                                        <span>{e.session.city ? `${e.session.city}, ` : ''}{e.session.country}</span>
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
