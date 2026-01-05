import React, { useEffect, useState } from 'react';
import { ShoppingCart, Clock, User as UserIcon } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card'; // Adjust generic UI imports
import { formatDistanceToNow } from 'date-fns';

interface CartSession {
    id: string;
    visitorId: string;
    email?: string;
    cartValue: number;
    cartItems: any[];
    currency: string;
    lastActiveAt: string;
    country?: string;
    city?: string;
}

const LiveCartsWidget: React.FC = () => {
    const [carts, setCarts] = useState<CartSession[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchCarts = async () => {
        try {
            const res = await fetch('/api/tracking/carts', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`, // Basic auth assumption
                    'x-account-id': localStorage.getItem('accountId') || ''
                }
            });
            if (res.ok) {
                const data = await res.json();
                setCarts(data);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCarts();
        const interval = setInterval(fetchCarts, 30000); // Poll every 30s
        return () => clearInterval(interval);
    }, []);

    if (loading && carts.length === 0) return <div className="p-4 text-sm text-gray-500">Loading carts...</div>;

    return (
        <div className="h-full overflow-y-auto">
            {carts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                    <ShoppingCart className="w-8 h-8 mb-2 opacity-50" />
                    <span className="text-xs">No active carts</span>
                </div>
            ) : (
                <div className="space-y-2 p-2">
                    {carts.map(cart => (
                        <div key={cart.id} className="flex items-center justify-between p-3 bg-white/5 border rounded-md hover:bg-white/10 transition-colors">
                            <div className="flex items-center space-x-3">
                                <div className="bg-primary/10 p-2 rounded-full">
                                    <ShoppingCart className="w-4 h-4 text-primary" />
                                </div>
                                <div>
                                    <div className="text-sm font-medium text-gray-200">
                                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: cart.currency }).format(cart.cartValue)}
                                    </div>
                                    <div className="text-xs text-gray-500 flex items-center gap-1">
                                        <UserIcon className="w-3 h-3" />
                                        {cart.email || `Visitor ${cart.visitorId.slice(0, 6)}...`}
                                    </div>
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-xs text-gray-400 flex items-center justify-end gap-1">
                                    <Clock className="w-3 h-3" />
                                    {formatDistanceToNow(new Date(cart.lastActiveAt), { addSuffix: true })}
                                </div>
                                {(cart.city || cart.country) && (
                                    <div className="text-[10px] text-gray-600 uppercase mt-0.5">
                                        {cart.city}, {cart.country}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default LiveCartsWidget;
