import { useState, useEffect } from 'react';
import { RefreshCw, AlertTriangle, Download, X, Sparkles } from 'lucide-react';
import { Logger } from '../../utils/logger';

/**
 * PWAUpdateModal - Prominent update notification for PWA users.
 * 
 * Features:
 * - Detects service worker updates
 * - Checks app version against server
 * - Shows modal for major updates
 * - Banner for minor updates
 * - Force update option for critical updates
 */

// Vite-injected build version (auto-generated at build time)
declare const __APP_VERSION__: string;
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '2026.01.22';

interface UpdateInfo {
    type: 'minor' | 'major' | 'critical';
    message?: string;
    features?: string[];
}

interface PWAUpdateModalProps {
    isOpen: boolean;
    onClose: () => void;
    onUpdate: () => void;
    updateInfo?: UpdateInfo;
}

export function PWAUpdateModal({ isOpen, onClose, onUpdate, updateInfo }: PWAUpdateModalProps) {
    if (!isOpen) return null;

    const isCritical = updateInfo?.type === 'critical';
    const isMajor = updateInfo?.type === 'major' || isCritical;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={isCritical ? undefined : onClose}
            />

            {/* Modal */}
            <div className="relative bg-slate-800 border border-white/10 rounded-3xl p-6 max-w-sm w-full shadow-2xl animate-scale-in">
                {/* Close button (not for critical updates) */}
                {!isCritical && (
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 p-2 rounded-xl hover:bg-white/10 transition-colors"
                    >
                        <X size={20} className="text-slate-400" />
                    </button>
                )}

                {/* Icon */}
                <div className={`
                    w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4
                    ${isCritical
                        ? 'bg-rose-500/20'
                        : isMajor
                            ? 'bg-amber-500/20'
                            : 'bg-indigo-500/20'
                    }
                `}>
                    {isCritical ? (
                        <AlertTriangle size={32} className="text-rose-400" />
                    ) : isMajor ? (
                        <Sparkles size={32} className="text-amber-400" />
                    ) : (
                        <Download size={32} className="text-indigo-400" />
                    )}
                </div>

                {/* Title */}
                <h2 className="text-xl font-bold text-white text-center mb-2">
                    {isCritical
                        ? 'Critical Update Required'
                        : isMajor
                            ? 'New Version Available!'
                            : 'Update Available'
                    }
                </h2>

                {/* Description */}
                <p className="text-slate-400 text-center text-sm mb-4">
                    {isCritical
                        ? 'Your app version is outdated and may not work correctly. Please update now.'
                        : updateInfo?.message || 'A new version of OverSeek is available with improvements and bug fixes.'
                    }
                </p>

                {/* Features list for major updates */}
                {updateInfo?.features && updateInfo.features.length > 0 && (
                    <div className="bg-slate-700/50 rounded-xl p-3 mb-4">
                        <p className="text-xs font-medium text-slate-300 mb-2">What's new:</p>
                        <ul className="space-y-1">
                            {updateInfo.features.slice(0, 4).map((feature, i) => (
                                <li key={i} className="text-xs text-slate-400 flex items-center gap-2">
                                    <span className="text-emerald-400">✓</span>
                                    {feature}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Actions */}
                <div className="space-y-2">
                    <button
                        onClick={onUpdate}
                        className={`
                            w-full py-3 px-4 rounded-xl font-semibold text-white
                            flex items-center justify-center gap-2
                            active:scale-[0.98] transition-all
                            ${isCritical
                                ? 'bg-gradient-to-r from-rose-500 to-pink-600 shadow-lg shadow-rose-500/30'
                                : 'bg-gradient-to-r from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/30'
                            }
                        `}
                    >
                        <RefreshCw size={18} />
                        Update Now
                    </button>

                    {!isCritical && (
                        <button
                            onClick={onClose}
                            className="w-full py-3 px-4 rounded-xl font-medium text-slate-400 hover:text-slate-300 hover:bg-white/5 transition-colors"
                        >
                            Maybe Later
                        </button>
                    )}
                </div>

                {/* Version info */}
                <p className="text-[10px] text-slate-500 text-center mt-4">
                    Current: v{APP_VERSION}
                </p>
            </div>
        </div>
    );
}

/**
 * Hook to manage PWA update state
 */
export function usePWAUpdate() {
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo>({ type: 'minor' });

    useEffect(() => {
        // Listen for service worker updates
        const handleSWUpdate = (event: MessageEvent) => {
            if (event.data?.type === 'SW_UPDATED') {
                Logger.info('[PWA] Service worker updated');
                setUpdateAvailable(true);

                // Check if this is a major update
                const storedVersion = localStorage.getItem('pwa-version');
                if (storedVersion && storedVersion !== APP_VERSION) {
                    const [storedMajor] = storedVersion.split('.');
                    const [currentMajor] = APP_VERSION.split('.');

                    if (storedMajor !== currentMajor) {
                        setUpdateInfo({ type: 'major' });
                        setShowModal(true);
                    }
                }
            }
        };

        navigator.serviceWorker?.addEventListener('message', handleSWUpdate);

        // Check version on mount
        checkVersion();

        return () => {
            navigator.serviceWorker?.removeEventListener('message', handleSWUpdate);
        };
    }, []);

    const checkVersion = async () => {
        try {
            // Check version from server
            const response = await fetch('/health/version', {
                headers: { 'Cache-Control': 'no-cache' }
            }).catch(() => null);

            if (response?.ok) {
                const data = await response.json();
                const serverVersion = data.version;

                if (serverVersion && serverVersion !== APP_VERSION) {
                    // Determine update type based on version difference
                    const [serverYear, serverMonth, serverDay] = serverVersion.split('.').map(Number);
                    const [appYear, appMonth, appDay] = APP_VERSION.split('.').map(Number);

                    // Critical if more than 30 days old
                    const serverDate = new Date(serverYear, serverMonth - 1, serverDay);
                    const appDate = new Date(appYear, appMonth - 1, appDay);
                    const daysDiff = Math.floor((serverDate.getTime() - appDate.getTime()) / (1000 * 60 * 60 * 24));

                    if (daysDiff > 30) {
                        setUpdateInfo({
                            type: 'critical',
                            message: 'Your app is significantly outdated. Some features may not work correctly.'
                        });
                        setShowModal(true);
                    } else if (daysDiff > 7) {
                        setUpdateInfo({
                            type: 'major',
                            message: data.message,
                            features: data.features
                        });

                        // Show modal if not dismissed recently
                        const lastDismissed = localStorage.getItem('pwa-update-dismissed');
                        const hoursSinceDismissed = lastDismissed
                            ? (Date.now() - parseInt(lastDismissed)) / (1000 * 60 * 60)
                            : 999;

                        if (hoursSinceDismissed > 24) {
                            setShowModal(true);
                        }
                    }

                    setUpdateAvailable(true);
                }
            }
        } catch (err) {
            Logger.warn('[PWA] Version check failed', { error: err });
        }

        // Store current version
        localStorage.setItem('pwa-version', APP_VERSION);
    };

    const handleUpdate = () => {
        // Clear caches and reload
        if ('caches' in window) {
            caches.keys().then(names => {
                names.forEach(name => caches.delete(name));
            });
        }

        // Force service worker update
        navigator.serviceWorker?.ready.then(registration => {
            registration.update();
        });

        // Reload the page
        window.location.reload();
    };

    const dismissModal = () => {
        if (updateInfo.type !== 'critical') {
            setShowModal(false);
            localStorage.setItem('pwa-update-dismissed', Date.now().toString());
        }
    };

    return {
        updateAvailable,
        showModal,
        updateInfo,
        handleUpdate,
        dismissModal,
        setShowModal
    };
}

/**
 * Compact update banner for the header
 */
export function PWAUpdateBanner({
    onTap,
    className = ''
}: {
    onTap: () => void;
    className?: string;
}) {
    return (
        <button
            onClick={onTap}
            className={`
                w-full bg-gradient-to-r from-indigo-500 to-purple-600 
                text-white text-center py-3 px-4 
                flex items-center justify-center gap-2 
                text-sm font-medium 
                hover:from-indigo-600 hover:to-purple-700 
                active:scale-[0.99] transition-all
                ${className}
            `}
        >
            <RefreshCw size={16} className="animate-spin-slow" />
            New version available — tap to update
        </button>
    );
}
