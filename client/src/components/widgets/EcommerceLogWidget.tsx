
import React, { useEffect, useState } from 'react';
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

const EcommerceLogWidget: React.FC = () => {
    const [events, setEvents] = useState<AnalyticsEvent[]>([]);
    const [loading, setLoading] = useState(true);

    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const fetchLog = async () => {
        if (!token || !currentAccount) return;

        try {
            const res = await fetch('/api/analytics/ecommerce/log?limit=20', {
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
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLog();
        const interval = setInterval(fetchLog, 15000);
        return () => clearInterval(interval);
    }, []);

    const getIcon = (type: string) => {
        switch (type) {
            case 'add_to_cart': return <ShoppingCart className="w-4 h-4 text-emerald-500" />;
            case 'remove_from_cart': return <LogOut className="w-4 h-4 text-rose-400" />; // Or trash icon
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
                const total = e.payload?.total ? `($${e.payload.total})` : '';
                return <span><span className="font-semibold text-gray-800">{who}</span> added items to cart {total}</span>;
            case 'remove_from_cart':
                return <span><span className="font-semibold text-gray-800">{who}</span> removed items from cart</span>;
            case 'checkout_start':
                return <span><span className="font-semibold text-gray-800">{who}</span> started checkout</span>;
            case 'checkout_success':
                return <span><span className="font-semibold text-emerald-700">{who} completed a purchase!</span></span>;
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
                    <div key={e.id} className="flex gap-3 p-3 bg-white border border-gray-100 rounded-lg shadow-sm">
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
