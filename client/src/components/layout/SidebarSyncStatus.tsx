import { useEffect, useState, useMemo } from 'react';
import { Wifi, WifiOff, AlertCircle, Clock, X, Loader2 } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useSyncStatus } from '../../context/SyncStatusContext';

interface SidebarSyncStatusProps {
    collapsed: boolean;
}

type SyncHealthState = 'OFFLINE' | 'SYNCING' | 'FAILED' | 'LAGGING' | 'HEALTHY';

/**
 * Compact sync status indicator with hover-to-reveal progress details.
 * Shows current sync health and active sync jobs on hover.
 */
export function SidebarSyncStatus({ collapsed }: SidebarSyncStatusProps) {
    const { isSyncing, logs, syncState, activeJobs, controlSync } = useSyncStatus();
    const [isOffline, setIsOffline] = useState(!navigator.onLine);
    const [isHovered, setIsHovered] = useState(false);

    useEffect(() => {
        const handleOnline = () => setIsOffline(false);
        const handleOffline = () => setIsOffline(true);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    // Track current time for staleness checks (updated every minute to avoid impure function during render)
    const [currentTime, setCurrentTime] = useState<number>(() => Date.now());

    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentTime(Date.now());
        }, 60 * 1000); // Update every minute
        return () => clearInterval(interval);
    }, []);

    const healthState: SyncHealthState = useMemo(() => {
        if (isOffline) return 'OFFLINE';
        if (isSyncing) return 'SYNCING';

        const criticalEntities = ['orders', 'products', 'inventory'];
        const relevantLogs = (logs || []).filter(l => criticalEntities.includes(l.entityType));
        const latestLogs = relevantLogs.slice(0, 5);
        if (latestLogs.some(l => l.status === 'FAILED')) {
            return 'FAILED';
        }

        const oneHour = 60 * 60 * 1000;
        const lagging = (syncState || [])
            .filter(s => criticalEntities.includes(s.entityType))
            .some(s => {
                if (!s.lastSyncedAt) return true;
                return currentTime - new Date(s.lastSyncedAt).getTime() > oneHour;
            });

        if (lagging) return 'LAGGING';

        return 'HEALTHY';
    }, [isOffline, isSyncing, logs, syncState, currentTime]);

    const config = {
        OFFLINE: {
            bg: "bg-red-50",
            text: "text-red-600",
            icon: WifiOff,
            dot: "bg-red-500",
            label: "Disconnected",
            subtext: "Check connection"
        },
        FAILED: {
            bg: "bg-red-50",
            text: "text-red-600",
            icon: AlertCircle,
            dot: "bg-red-500",
            label: "Sync Failed",
            subtext: "Check logs"
        },
        LAGGING: {
            bg: "bg-orange-50",
            text: "text-orange-600",
            icon: Clock,
            dot: "bg-orange-500",
            label: "Sync Lagging",
            subtext: "Last sync > 1h ago"
        },
        SYNCING: {
            bg: "bg-blue-50",
            text: "text-blue-600",
            icon: Wifi,
            dot: "bg-blue-500",
            label: "Syncing...",
            subtext: "Updating data"
        },
        HEALTHY: {
            bg: "bg-green-50",
            text: "text-green-600",
            icon: Wifi,
            dot: "bg-green-500",
            label: "Sync Active",
            subtext: "System online"
        }
    };

    const current = config[healthState];
    const Icon = current.icon;
    const hasActiveJobs = activeJobs && activeJobs.length > 0;

    return (
        <div
            className="relative"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Main Status Indicator */}
            <div className={cn(
                "flex items-center gap-2 px-2 py-2 rounded-lg transition-colors cursor-pointer",
                current.bg,
                current.text
            )}>
                <div className="relative flex items-center justify-center shrink-0 w-8 h-8">
                    <div className="relative">
                        <div className={cn("absolute inset-0 opacity-20 rounded-full", isSyncing ? "animate-ping" : "animate-pulse", current.dot.replace('bg-', 'bg-'))} />
                        <Icon size={18} strokeWidth={2} className={isSyncing ? "animate-spin" : ""} />
                    </div>

                    <div className={cn(
                        "absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white",
                        current.dot
                    )} />
                </div>

                {!collapsed && (
                    <div className="flex flex-col overflow-hidden flex-1">
                        <span className="text-sm font-medium whitespace-nowrap">
                            {current.label}
                        </span>
                        <span className="text-[10px] opacity-75 whitespace-nowrap">
                            {hasActiveJobs ? `${activeJobs.length} job${activeJobs.length > 1 ? 's' : ''} running` : current.subtext}
                        </span>
                    </div>
                )}
            </div>

            {/* Hover Popover with Progress Details */}
            {isHovered && hasActiveJobs && (
                <div className={cn(
                    "absolute z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-3 min-w-[220px]",
                    collapsed ? "left-full ml-2 bottom-0" : "bottom-full mb-2 left-0 right-0"
                )}>
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Sync Progress</span>
                    </div>

                    <div className="space-y-2">
                        {activeJobs.map((job) => (
                            <div key={job.id} className="bg-gray-50 p-2 rounded-sm border border-gray-100">
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-2">
                                        <Loader2 size={12} className="animate-spin text-blue-500" />
                                        <span className="text-xs font-medium capitalize text-gray-700">
                                            {job.queue.replace('sync-', '')}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-gray-500 font-mono">{job.progress}%</span>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                controlSync('cancel', job.queue, job.id);
                                            }}
                                            className="text-gray-400 hover:text-red-500 transition-colors p-0.5"
                                            title="Cancel Sync"
                                        >
                                            <X size={12} />
                                        </button>
                                    </div>
                                </div>
                                <div className="w-full bg-gray-200 h-1 rounded-full overflow-hidden">
                                    <div
                                        className="bg-blue-500 h-full transition-all duration-300 rounded-full"
                                        style={{ width: `${job.progress}%` }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Collapsed tooltip (when no active jobs) */}
            {collapsed && isHovered && !hasActiveJobs && (
                <div className="absolute left-full ml-2 bottom-0 px-3 py-2 bg-gray-900 text-white text-xs rounded-sm z-50 whitespace-nowrap">
                    {current.label}
                    <span className="block text-gray-400">{current.subtext}</span>
                </div>
            )}
        </div>
    );
}
