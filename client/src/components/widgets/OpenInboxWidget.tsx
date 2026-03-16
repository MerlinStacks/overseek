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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentAccount?.id, token]);

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
            className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md p-6 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.05)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)] border border-slate-200/50 dark:border-slate-700/50 flex flex-col h-full justify-center items-center relative overflow-hidden cursor-pointer hover:shadow-md dark:hover:shadow-[0_10px_40px_rgba(0,0,0,0.3)] transition-shadow"
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
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 font-medium">Open Conversations</p>
            </div>

            {/* Background Icon */}
            <div className="absolute -bottom-4 -right-4 opacity-[0.06] dark:opacity-[0.08] z-0">
                <Inbox size={80} className="text-blue-600 dark:text-blue-400" />
            </div>
        </div>
    );
}
