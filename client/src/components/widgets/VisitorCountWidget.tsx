import { useEffect, useState, useCallback } from 'react';
import { Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { WidgetProps } from './WidgetRegistry';

/**
 * Compact widget displaying the current count of live visitors.
 * Polls the tracking API every 10 seconds for real-time updates.
 */
export function VisitorCountWidget(_props: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [count, setCount] = useState<number>(0);
    const [loading, setLoading] = useState(true);

    const fetchCount = useCallback(async () => {
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
                setCount(Array.isArray(data) ? data.length : 0);
            }
        } catch (error) {
            console.error('Failed to fetch live visitor count', error);
        } finally {
            setLoading(false);
        }
    }, [currentAccount, token]);

    useEffect(() => {
        fetchCount();
        const interval = setInterval(fetchCount, 10000);
        return () => clearInterval(interval);
    }, [fetchCount]);

    return (
        <div className="bg-white/80 backdrop-blur-md p-6 rounded-xl shadow-sm border border-gray-200/50 flex flex-col h-full justify-center items-center relative overflow-hidden">
            {/* Pulsing Indicator */}
            <div className="absolute top-4 right-4 flex items-center gap-2">
                <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                </span>
                <span className="text-xs font-medium text-green-600">Live</span>
            </div>

            {/* Count Display */}
            <div className="text-center">
                {loading ? (
                    <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto"></div>
                ) : (
                    <span className="text-5xl font-bold text-gray-900">{count}</span>
                )}
                <p className="text-sm text-gray-500 mt-2 font-medium">Active Visitors</p>
            </div>

            {/* Background Icon */}
            <div className="absolute -bottom-4 -right-4 text-gray-100 opacity-40 z-0">
                <Users size={80} />
            </div>
        </div>
    );
}
