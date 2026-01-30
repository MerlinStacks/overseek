import { useState, useCallback } from 'react';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';
import { Logger } from '../../utils/logger';
import { formatCurrency } from '../../utils/format';
import { ShoppingCart, Clock, User as UserIcon, Loader2, Package, Flame } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { WidgetProps } from './WidgetRegistry';

interface CartItem {
    productId: number;
    variationId?: number;
    name: string;
    sku?: string;
    thumbnail?: string;
    quantity: number;
    price: number;
    total: number;
}

interface CartSession {
    id: string;
    visitorId: string;
    email?: string | null;
    cartValue: number;
    cartItems: CartItem[];
    itemCount: number;
    currency: string;
    lastActiveAt: string;
    country?: string | null;
    city?: string | null;
    customerName?: string | null;
    customerId?: number | null;
    purchaseIntentScore: number;
    minutesSinceActivity: number;
}

/**
 * Get intent level and color based on purchase intent score.
 */
function getIntentLevel(score: number): { label: string; color: string; bgColor: string } {
    if (score >= 70) return { label: 'Hot', color: 'text-red-600', bgColor: 'bg-red-100' };
    if (score >= 40) return { label: 'Warm', color: 'text-orange-500', bgColor: 'bg-orange-100' };
    return { label: 'Cold', color: 'text-blue-500', bgColor: 'bg-blue-100' };
}

const LiveCartsWidget = ({ className }: WidgetProps) => {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [carts, setCarts] = useState<CartSession[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchCarts = useCallback(async () => {
        if (!currentAccount || !token) return;

        try {
            const res = await fetch('/api/tracking/carts', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });
            if (res.ok) {
                const data = await res.json();
                setCarts(Array.isArray(data) ? data : []);
            }
        } catch (err) {
            Logger.error('An error occurred', { error: err });
        } finally {
            setLoading(false);
        }
    }, [currentAccount, token]);

    // Use visibility-aware polling with tab coordination
    useVisibilityPolling(fetchCarts, 30000, [fetchCarts], 'live-carts');

    if (loading && carts.length === 0) {
        return (
            <div className={`bg-white h-full w-full p-4 flex flex-col rounded-xl shadow-xs border border-gray-200 overflow-hidden ${className}`}>
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-semibold text-gray-900">Live Carts</h3>
                    <ShoppingCart size={18} className="text-gray-400" />
                </div>
                <div className="flex-1 flex justify-center items-center">
                    <Loader2 className="animate-spin text-gray-400" />
                </div>
            </div>
        );
    }

    return (
        <div className={`bg-white h-full w-full p-4 flex flex-col rounded-xl shadow-xs border border-gray-200 overflow-hidden ${className}`}>
            <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">Live Carts</h3>
                    {carts.length > 0 && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">
                            {carts.length}
                        </span>
                    )}
                </div>
                <ShoppingCart size={18} className="text-gray-400" />
            </div>
            <div className="flex-1 overflow-y-auto">
                {carts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                        <ShoppingCart className="w-8 h-8 mb-2 opacity-50" />
                        <span className="text-xs">No active carts</span>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {carts.map(cart => {
                            const intent = getIntentLevel(cart.purchaseIntentScore);
                            const firstItem = cart.cartItems?.[0];
                            const hasMultipleItems = cart.cartItems?.length > 1;

                            return (
                                <div key={cart.id} className="flex items-center justify-between p-3 bg-gray-50 border border-gray-100 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer">
                                    <div className="flex items-center space-x-3">
                                        {/* Product thumbnail or placeholder */}
                                        <div className="relative">
                                            {firstItem?.thumbnail ? (
                                                <img
                                                    src={firstItem.thumbnail}
                                                    alt={firstItem.name}
                                                    className="w-10 h-10 rounded-lg object-cover bg-gray-100"
                                                    onError={(e) => {
                                                        (e.target as HTMLImageElement).style.display = 'none';
                                                    }}
                                                />
                                            ) : (
                                                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                                                    <Package className="w-5 h-5 text-blue-400" />
                                                </div>
                                            )}
                                            {/* Item count badge */}
                                            {cart.itemCount > 1 && (
                                                <span className="absolute -top-1 -right-1 bg-gray-700 text-white text-[10px] font-medium w-4 h-4 rounded-full flex items-center justify-center">
                                                    {cart.itemCount > 9 ? '9+' : cart.itemCount}
                                                </span>
                                            )}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-sm font-semibold text-gray-900">
                                                    {formatCurrency(cart.cartValue, cart.currency || 'USD')}
                                                </span>
                                                {/* Purchase intent indicator */}
                                                {cart.purchaseIntentScore >= 70 && (
                                                    <Flame className="w-3.5 h-3.5 text-red-500" />
                                                )}
                                            </div>
                                            <div className="text-xs text-gray-500 flex items-center gap-1 truncate">
                                                <UserIcon className="w-3 h-3 shrink-0" />
                                                <span className="truncate">
                                                    {cart.customerName || cart.email || `Visitor ${cart.visitorId?.slice(0, 6) || 'Unknown'}...`}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <div className="text-xs text-gray-400 flex items-center justify-end gap-1">
                                            <Clock className="w-3 h-3" />
                                            {cart.minutesSinceActivity < 1
                                                ? 'Just now'
                                                : cart.minutesSinceActivity < 60
                                                    ? `${cart.minutesSinceActivity}m ago`
                                                    : formatDistanceToNow(new Date(cart.lastActiveAt), { addSuffix: true })}
                                        </div>
                                        {(cart.city || cart.country) && (
                                            <div className="text-[10px] text-gray-500 uppercase mt-0.5">
                                                {cart.city}{cart.city && cart.country ? ', ' : ''}{cart.country}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default LiveCartsWidget;

