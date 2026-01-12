import { ReactNode, useState, useEffect, useCallback } from 'react';
import { useLocation, Outlet } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { MobileNav } from './MobileNav';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';

/**
 * MobileLayout - Touch-optimized layout for the PWA companion app.
 * 
 * Features:
 * - Bottom navigation with badge counts
 * - iOS safe areas handling
 * - Pull-to-refresh with visual feedback
 * - Haptic feedback where supported
 */

interface MobileLayoutProps {
    children?: ReactNode;
}

export function MobileLayout({ children }: MobileLayoutProps) {
    const location = useLocation();
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    // Pull-to-refresh state
    const [refreshing, setRefreshing] = useState(false);
    const [startY, setStartY] = useState(0);
    const [pullDistance, setPullDistance] = useState(0);

    // Badge counts
    const [inboxBadge, setInboxBadge] = useState(0);
    const [ordersBadge, setOrdersBadge] = useState(0);

    // Fetch badge counts
    const fetchBadgeCounts = useCallback(async () => {
        if (!token || !currentAccount) return;

        const headers = {
            'Authorization': `Bearer ${token}`,
            'X-Account-ID': currentAccount.id
        };

        try {
            // Fetch unread conversation count
            const convRes = await fetch('/api/chat/unread-count', { headers });
            if (convRes.ok) {
                const data = await convRes.json();
                setInboxBadge(data.count || 0);
            }

            // Fetch pending orders count
            const ordersRes = await fetch('/api/sync/orders/search?limit=1&status=pending', { headers });
            if (ordersRes.ok) {
                const data = await ordersRes.json();
                setOrdersBadge(data.totalPending || data.total || 0);
            }
        } catch (error) {
            // Silently fail - badges are enhancement only
        }
    }, [token, currentAccount]);

    useEffect(() => {
        fetchBadgeCounts();
        // Poll every 30 seconds
        const interval = setInterval(fetchBadgeCounts, 30000);
        return () => clearInterval(interval);
    }, [fetchBadgeCounts]);

    // Pull-to-refresh handlers
    const handleTouchStart = (e: React.TouchEvent) => {
        if (window.scrollY === 0) {
            setStartY(e.touches[0].clientY);
        }
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (startY === 0 || window.scrollY > 0) return;
        const currentY = e.touches[0].clientY;
        const distance = Math.max(0, currentY - startY);
        setPullDistance(Math.min(distance, 120));
    };

    const handleTouchEnd = async () => {
        if (pullDistance > 70) {
            setRefreshing(true);
            // Haptic feedback
            if ('vibrate' in navigator) {
                navigator.vibrate(15);
            }
            // Refresh badge counts
            await fetchBadgeCounts();
            // Dispatch custom event for pages to refresh their data
            window.dispatchEvent(new CustomEvent('mobile-refresh'));
            // Wait a bit for visual feedback
            await new Promise(resolve => setTimeout(resolve, 800));
            setRefreshing(false);
        }
        setStartY(0);
        setPullDistance(0);
    };

    const getActiveTab = () => {
        const path = location.pathname;
        if (path.includes('/m/orders')) return 'orders';
        if (path.includes('/m/inbox')) return 'inbox';
        if (path.includes('/m/analytics')) return 'analytics';
        if (path.includes('/m/more')) return 'more';
        return 'dashboard';
    };

    const pullProgress = Math.min(pullDistance / 70, 1);

    return (
        <div
            className="min-h-screen bg-gray-50 flex flex-col"
            style={{
                paddingTop: 'env(safe-area-inset-top)',
                paddingBottom: 'calc(env(safe-area-inset-bottom) + 64px)'
            }}
        >
            {/* Pull-to-refresh indicator */}
            <div
                className={`fixed top-0 left-0 right-0 flex items-center justify-center z-50 transition-all duration-200 ${pullDistance > 0 ? 'bg-indigo-600' : 'bg-transparent'
                    }`}
                style={{
                    height: Math.max(pullDistance, 0),
                    paddingTop: 'env(safe-area-inset-top)',
                    opacity: pullProgress
                }}
            >
                <div
                    className={`p-2 rounded-full bg-white/20 ${refreshing ? 'animate-spin' : ''}`}
                    style={{
                        transform: `rotate(${pullProgress * 360}deg) scale(${0.5 + pullProgress * 0.5})`,
                        transition: refreshing ? 'none' : 'transform 0.1s'
                    }}
                >
                    <RefreshCw size={24} className="text-white" />
                </div>
                {pullProgress >= 1 && !refreshing && (
                    <span className="text-white text-sm ml-3 font-medium">Release to refresh</span>
                )}
                {refreshing && (
                    <span className="text-white text-sm ml-3 font-medium">Refreshing...</span>
                )}
            </div>

            {/* Main content */}
            <main
                className="flex-1 overflow-x-hidden"
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                <div className="p-4">
                    {children || <Outlet />}
                </div>
            </main>

            {/* Bottom navigation with badges */}
            <MobileNav
                activeTab={getActiveTab()}
                inboxBadge={inboxBadge}
                ordersBadge={ordersBadge}
            />
        </div>
    );
}
