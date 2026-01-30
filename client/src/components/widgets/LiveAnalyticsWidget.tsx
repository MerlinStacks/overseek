
import { useState, useCallback } from 'react';
import { Logger } from '../../utils/logger';
import { formatCurrency } from '../../utils/format';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';
import { Users, ShoppingCart, Activity, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

interface LiveSession {
    country: string;
    city: string;
    lastActiveAt: string;
    cartValue: number;
}

export function LiveAnalyticsWidget() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const navigate = useNavigate();

    const [visitors, setVisitors] = useState<LiveSession[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchLiveStats = useCallback(async () => {
        if (!currentAccount || !token) return;

        try {
            const res = await fetch('/api/tracking/live', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                const data = await res.json();
                setVisitors(data || []);
            }
        } catch (error) {
            Logger.error('Failed to fetch live stats', { error: error });
        } finally {
            setLoading(false);
        }
    }, [currentAccount, token]);

    // Use visibility-aware polling with tab coordination
    useVisibilityPolling(fetchLiveStats, 10000, [fetchLiveStats], 'live-analytics');

    const activeCarts = visitors.filter(v => Number(v.cartValue) > 0);
    const totalCartValue = activeCarts.reduce((acc, curr) => acc + Number(curr.cartValue), 0);

    return (
        <div className="bg-white p-6 rounded-xl shadow-xs border border-gray-200 flex flex-col h-full relative overflow-hidden">
            {/* Header */}
            <div className="flex justify-between items-start mb-4 relative z-10">
                <div>
                    <h3 className="text-gray-500 text-sm font-medium">Live Now</h3>
                    <div className="flex items-baseline gap-2 mt-1">
                        <span className="text-3xl font-bold text-gray-900">{visitors.length}</span>
                        <span className="text-sm text-green-600 flex items-center gap-1 font-medium animate-pulse">
                            <span className="w-2 h-2 rounded-full bg-green-500"></span>
                            Active Visitors
                        </span>
                    </div>
                </div>
                <div className="bg-blue-50 p-2 rounded-lg">
                    <Activity className="w-5 h-5 text-blue-600" />
                </div>
            </div>

            {/* Cart Stats */}
            <div className="grid grid-cols-2 gap-4 mb-4 relative z-10">
                <div className="bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                        <ShoppingCart className="w-4 h-4 text-orange-500" />
                        <span className="text-xs font-medium text-gray-600">Active Carts</span>
                    </div>
                    <p className="text-lg font-bold text-gray-900">{activeCarts.length}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-gray-600">Potential Revenue</span>
                    </div>
                    <p className="text-lg font-bold text-gray-900">
                        {formatCurrency(totalCartValue)}
                    </p>
                </div>
            </div>

            {/* Footer / CTA */}
            <div className="mt-auto relative z-10">
                <button
                    onClick={() => navigate('/analytics/live')}
                    className="text-sm text-blue-600 font-medium hover:text-blue-700 flex items-center gap-1 transition-colors"
                >
                    View Real-time Report <ArrowRight size={16} />
                </button>
            </div>

            {/* Background Decoration */}
            <div className="absolute -bottom-6 -right-6 text-gray-50 opacity-50 z-0">
                <Users size={120} />
            </div>
        </div>
    );
}
