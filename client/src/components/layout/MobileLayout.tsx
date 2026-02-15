import { ReactNode, useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, Outlet } from 'react-router-dom';
import { RefreshCw, WifiOff, Download, X, Loader2 } from 'lucide-react';
import { MobileNav } from './MobileNav';
import { MobileErrorBoundary } from '../mobile/MobileErrorBoundary';

import { PWAUpdateModal, usePWAUpdate, PWAUpdateBanner } from '../mobile/PWAUpdateModal';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';
import { useHaptic } from '../../hooks/useHaptic';

/**
 * MobileLayout - Premium dark glassmorphism layout for the PWA companion app.
 * 
 * Features:
 * - Dark theme with gradient backgrounds
 * - Glassmorphism cards throughout
 * - Bottom navigation with badge counts
 * - iOS safe areas handling
 * - Enhanced pull-to-refresh with custom spinner
 * - Smooth page transitions
 * - Custom install prompt
 * - Haptic feedback where supported
 */

interface MobileLayoutProps {
    children?: ReactNode;
}

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function MobileLayout({ children }: MobileLayoutProps) {
    const location = useLocation();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const { triggerHaptic } = useHaptic();

    // Page transition state
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [displayLocation, setDisplayLocation] = useState(location);
    const prevPathRef = useRef(location.pathname);

    // Pull-to-refresh state
    const [refreshing, setRefreshing] = useState(false);
    const [startY, setStartY] = useState(0);
    const [pullDistance, setPullDistance] = useState(0);

    // Badge counts
    const [inboxBadge, setInboxBadge] = useState(0);
    const [ordersBadge, setOrdersBadge] = useState(0);

    // Network status
    const [isOnline, setIsOnline] = useState(navigator.onLine);

    // PWA update system
    const {
        updateAvailable,
        showModal: showUpdateModal,
        updateInfo,
        handleUpdate,
        dismissModal
    } = usePWAUpdate();

    // Install prompt
    const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [showInstallBanner, setShowInstallBanner] = useState(false);

    // Page transition effect
    useEffect(() => {
        if (location.pathname !== prevPathRef.current) {
            // Defer initial state update to avoid cascading renders
            const initialTimer = setTimeout(() => {
                setIsTransitioning(true);

                // Short delay for exit animation
                const exitTimer = setTimeout(() => {
                    setDisplayLocation(location);
                    prevPathRef.current = location.pathname;

                    // Allow enter animation
                    const enterTimer = setTimeout(() => {
                        setIsTransitioning(false);
                    }, 50);

                    return () => clearTimeout(enterTimer);
                }, 150);

                return () => clearTimeout(exitTimer);
            }, 0);

            return () => clearTimeout(initialTimer);
        }
    }, [location]);

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
                setOrdersBadge(data.total || 0);
            }
        } catch (error) {
            // Silently fail - badges are enhancement only
        }
    }, [token, currentAccount]);

    // Visibility-aware polling: pauses when app is backgrounded
    useVisibilityPolling(fetchBadgeCounts, 30000, [fetchBadgeCounts]);

    // Network status listeners
    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    // Install prompt listener
    useEffect(() => {
        const handleBeforeInstall = (e: Event) => {
            e.preventDefault();
            setInstallPrompt(e as BeforeInstallPromptEvent);
            // Check if user hasn't dismissed recently
            const dismissed = localStorage.getItem('pwa-install-dismissed');
            const dismissedTime = dismissed ? parseInt(dismissed) : 0;
            const hoursSinceDismissed = (Date.now() - dismissedTime) / (1000 * 60 * 60);
            if (hoursSinceDismissed > 24) {
                setShowInstallBanner(true);
            }
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstall);
        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
        };
    }, []);

    // Handle install
    const handleInstall = async () => {
        if (!installPrompt) return;
        installPrompt.prompt();
        const { outcome } = await installPrompt.userChoice;
        if (outcome === 'accepted') {
            setShowInstallBanner(false);
        }
        setInstallPrompt(null);
    };

    // Dismiss install banner
    const dismissInstallBanner = () => {
        setShowInstallBanner(false);
        localStorage.setItem('pwa-install-dismissed', Date.now().toString());
    };

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
        // Apply resistance for more natural feel
        const resistance = 0.5;
        const resistedDistance = distance * resistance;
        setPullDistance(Math.min(resistedDistance, 100));
    };

    const handleTouchEnd = async () => {
        if (pullDistance > 50) {
            setRefreshing(true);
            triggerHaptic(20);

            // Refresh badge counts
            await fetchBadgeCounts();
            // Dispatch custom event for pages to refresh their data
            window.dispatchEvent(new CustomEvent('mobile-refresh'));
            // Wait for visual feedback
            await new Promise(resolve => setTimeout(resolve, 1000));

            triggerHaptic(15);
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

    const pullProgress = Math.min(pullDistance / 50, 1);
    const pullThresholdMet = pullProgress >= 1;

    return (
        <div
            className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800/90 to-slate-800 flex flex-col"
            style={{
                paddingTop: 'env(safe-area-inset-top)',
                paddingBottom: 'calc(env(safe-area-inset-bottom) + 64px)'
            }}
        >
            {/* Offline Banner */}
            {!isOnline && (
                <div className="bg-amber-500/90 backdrop-blur-sm text-white text-center py-2.5 px-4 flex items-center justify-center gap-2 text-sm font-medium animate-fade-slide-up">
                    <WifiOff size={16} />
                    You're offline - some features may be unavailable
                </div>
            )}

            {/* PWA Update Modal */}
            <PWAUpdateModal
                isOpen={showUpdateModal}
                onClose={dismissModal}
                onUpdate={handleUpdate}
                updateInfo={updateInfo}
            />

            {/* PWA Update Available Banner (only if modal not shown) */}
            {updateAvailable && isOnline && !showUpdateModal && (
                <PWAUpdateBanner onTap={handleUpdate} />
            )}

            {/* Install App Banner */}
            {showInstallBanner && installPrompt && (
                <div className="bg-gradient-to-r from-emerald-500/90 to-teal-500/90 backdrop-blur-sm text-white py-3 px-4 flex items-center justify-between gap-3 animate-fade-slide-up">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-white/20 rounded-xl">
                            <Download size={20} />
                        </div>
                        <div>
                            <p className="text-sm font-semibold">Install OverSeek</p>
                            <p className="text-xs text-white/80">Add to home screen for the best experience</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleInstall}
                            className="px-4 py-1.5 bg-white text-emerald-600 rounded-lg text-sm font-semibold hover:bg-white/90 active:scale-95 transition-all"
                        >
                            Install
                        </button>
                        <button
                            onClick={dismissInstallBanner}
                            className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>
            )}

            {/* Enhanced Pull-to-refresh indicator */}
            <div
                className="fixed top-0 left-0 right-0 flex flex-col items-center justify-center z-50 overflow-hidden transition-all duration-300 ease-out"
                style={{
                    height: refreshing ? 80 : Math.max(pullDistance, 0),
                    paddingTop: 'env(safe-area-inset-top)',
                    opacity: pullProgress > 0.1 || refreshing ? 1 : 0,
                    background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.95) 0%, rgba(139, 92, 246, 0.95) 100%)',
                }}
            >
                <div className="relative">
                    {/* Outer ring */}
                    <div
                        className={`w-12 h-12 rounded-full border-3 border-white/30 flex items-center justify-center ${refreshing ? '' : 'transition-transform duration-100'
                            }`}
                        style={{
                            transform: refreshing
                                ? 'scale(1)'
                                : `scale(${0.6 + pullProgress * 0.4})`,
                            borderWidth: '3px',
                        }}
                    >
                        {/* Inner spinner/icon */}
                        {refreshing ? (
                            <Loader2 size={24} className="text-white animate-spin" />
                        ) : (
                            <RefreshCw
                                size={22}
                                className="text-white transition-transform duration-100"
                                style={{
                                    transform: `rotate(${pullProgress * 180}deg)`,
                                }}
                            />
                        )}
                    </div>

                    {/* Progress ring */}
                    {!refreshing && pullProgress > 0 && (
                        <svg
                            className="absolute inset-0 w-12 h-12 -rotate-90"
                            viewBox="0 0 48 48"
                        >
                            <circle
                                cx="24"
                                cy="24"
                                r="21"
                                fill="none"
                                stroke="white"
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeDasharray={`${pullProgress * 132} 132`}
                                className="transition-all duration-100"
                            />
                        </svg>
                    )}
                </div>

                {/* Status text */}
                <span className={`text-white text-xs font-medium mt-2 transition-all duration-200 ${(pullThresholdMet || refreshing) ? 'opacity-100' : 'opacity-0'
                    }`}>
                    {refreshing ? 'Refreshing...' : 'Release to refresh'}
                </span>
            </div>

            {/* Main content with page transitions */}
            <main
                className="flex-1 overflow-x-hidden"
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                <div
                    className={`p-4 transition-all duration-150 ease-out ${isTransitioning
                        ? 'opacity-0 translate-x-4'
                        : 'opacity-100 translate-x-0'
                        }`}
                >
                    <MobileErrorBoundary>
                        {children || <Outlet />}
                    </MobileErrorBoundary>
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
