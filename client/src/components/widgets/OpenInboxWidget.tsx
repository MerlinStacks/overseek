import { useState, useCallback } from 'react';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';
import { Inbox } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useNavigate } from 'react-router-dom';
import { WidgetProps } from './WidgetRegistry';
import { useWidgetSocket } from '../../hooks/useWidgetSocket';
import { widgetGlassCardClass, widgetSubtleTextClass } from './widgetStyles';

/**
 * Compact widget displaying the count of open inbox conversations.
 * Updates in real-time via socket events.
 */
export function OpenInboxWidget(_props: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const accountId = currentAccount?.id;
    const navigate = useNavigate();

    const [count, setCount] = useState<number>(0);
    const [loading, setLoading] = useState(true);

    const fetchCount = useCallback(async () => {
        if (!accountId || !token) return;

        try {
            const res = await fetch('/api/dashboard/inbox-count', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': accountId
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
    }, [accountId, token]);

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
            className={`${widgetGlassCardClass} p-6 flex flex-col h-full justify-center items-center relative overflow-hidden cursor-pointer`}
        >
            {/* Notification Indicator */}
            {count > 0 && (
                <div className="absolute top-4 right-4 flex items-center gap-2">
                    <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
                    </span>
                    <span className="text-xs font-medium text-blue-600 dark:text-blue-400">Active</span>
                </div>
            )}

            {/* Count Display */}
            <div className="text-center">
                {loading ? (
                    <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto"></div>
                ) : (
                    <span className="text-5xl font-bold text-slate-900 dark:text-white">{count}</span>
                )}
                <p className={`${widgetSubtleTextClass} mt-2 font-medium`}>Open Conversations</p>
            </div>

            {/* Background Icon */}
            <div className="absolute -bottom-4 -right-4 opacity-[0.06] dark:opacity-[0.08] z-0">
                <Inbox size={80} className="text-blue-600 dark:text-blue-400" />
            </div>
        </div>
    );
}
