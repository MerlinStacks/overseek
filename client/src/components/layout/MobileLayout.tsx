import { ReactNode, useState } from 'react';
import { useLocation, Outlet } from 'react-router-dom';
import { MobileNav } from './MobileNav';

/**
 * MobileLayout - Touch-optimized layout for the PWA companion app.
 * 
 * Features:
 * - Bottom navigation for thumb-friendly access
 * - iOS safe areas handling (notch, home indicator)
 * - Pull-to-refresh support
 * - Haptic feedback where supported
 */

interface MobileLayoutProps {
    children?: ReactNode;
}

export function MobileLayout({ children }: MobileLayoutProps) {
    const location = useLocation();
    const [refreshing, setRefreshing] = useState(false);
    const [startY, setStartY] = useState(0);
    const [pullDistance, setPullDistance] = useState(0);

    // Note: usePushNotifications moved to individual pages to prevent blocking initial render

    // Pull-to-refresh handler
    const handleTouchStart = (e: React.TouchEvent) => {
        if (window.scrollY === 0) {
            setStartY(e.touches[0].clientY);
        }
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (startY === 0 || window.scrollY > 0) return;

        const currentY = e.touches[0].clientY;
        const distance = Math.max(0, currentY - startY);
        setPullDistance(Math.min(distance, 100));
    };

    const handleTouchEnd = async () => {
        if (pullDistance > 60) {
            setRefreshing(true);
            // Trigger haptic feedback if available
            if ('vibrate' in navigator) {
                navigator.vibrate(10);
            }
            // Wait for data refresh (handled by child components via polling/socket)
            await new Promise(resolve => setTimeout(resolve, 1000));
            setRefreshing(false);
        }
        setStartY(0);
        setPullDistance(0);
    };

    // Determine current active nav item from path
    const getActiveTab = () => {
        const path = location.pathname;
        if (path.includes('/m/orders')) return 'orders';
        if (path.includes('/m/inbox')) return 'inbox';
        if (path.includes('/m/analytics')) return 'analytics';
        if (path.includes('/m/more')) return 'more';
        return 'dashboard';
    };

    return (
        <div
            className="min-h-screen bg-gray-50 flex flex-col"
            style={{
                paddingTop: 'env(safe-area-inset-top)',
                paddingBottom: 'calc(env(safe-area-inset-bottom) + 64px)' // Nav height + safe area
            }}
        >
            {/* Pull-to-refresh indicator */}
            {pullDistance > 0 && (
                <div
                    className="fixed top-0 left-0 right-0 flex items-center justify-center bg-indigo-500 text-white z-50 transition-all"
                    style={{
                        height: pullDistance,
                        paddingTop: 'env(safe-area-inset-top)'
                    }}
                >
                    <div className={`${refreshing ? 'animate-spin' : ''}`}>
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </div>
                </div>
            )}

            {/* Main content area */}
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

            {/* Bottom navigation */}
            <MobileNav activeTab={getActiveTab()} />
        </div>
    );
}
