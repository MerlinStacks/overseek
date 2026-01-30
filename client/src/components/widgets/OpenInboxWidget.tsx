import { useState, useCallback } from 'react';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';
import { Inbox } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useNavigate } from 'react-router-dom';
import { WidgetProps } from './WidgetRegistry';
import { useWidgetSocket } from '../../hooks/useWidgetSocket';

/**
 * Compact widget displaying the count of open inbox conversations.
 * Updates in real-time via socket events.
 */
export function OpenInboxWidget(_props: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const navigate = useNavigate();

    const [count, setCount] = useState<number>(0);
    const [loading, setLoading] = useState(true);

    const fetchCount = useCallback(async () => {
        if (!currentAccount || !token) return;

        try {
            const res = await fetch('/api/dashboard/inbox-count', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                const data = await res.json();
                setCount(data.open ?? 0);
            }
        } catch (error) {
            // Silent fail
        } finally {
            setLoading(false);
        }
    }, [currentAccount, token]);

    // Use visibility-aware polling with tab coordination
    useVisibilityPolling(fetchCount, 60000, [fetchCount], 'open-inbox');

    // Real-time: Update count on conversation changes
    useWidgetSocket('conversation:updated', () => {
        fetchCount();
    });


    const handleClick = () => {
        navigate('/inbox');
    };

    return (
        <div
            onClick={handleClick}
            className="bg-white/80 backdrop-blur-md p-6 rounded-xl shadow-xs border border-gray-200/50 flex flex-col h-full justify-center items-center relative overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
        >
            {/* Notification Indicator */}
            {count > 0 && (
                <div className="absolute top-4 right-4 flex items-center gap-2">
                    <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
                    </span>
                    <span className="text-xs font-medium text-blue-600">Active</span>
                </div>
            )}

            {/* Count Display */}
            <div className="text-center">
                {loading ? (
                    <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto"></div>
                ) : (
                    <span className="text-5xl font-bold text-gray-900">{count}</span>
                )}
                <p className="text-sm text-gray-500 mt-2 font-medium">Open Conversations</p>
            </div>

            {/* Background Icon */}
            <div className="absolute -bottom-4 -right-4 text-gray-100 opacity-40 z-0">
                <Inbox size={80} />
            </div>
        </div>
    );
}
