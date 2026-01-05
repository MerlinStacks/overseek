import { useEffect, useState, useMemo } from 'react';
import { Wifi, WifiOff, AlertCircle, Clock } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useSyncStatus } from '../../context/SyncStatusContext';

interface SidebarSyncStatusProps {
    collapsed: boolean;
}

type SyncHealthState = 'OFFLINE' | 'SYNCING' | 'FAILED' | 'LAGGING' | 'HEALTHY';

export function SidebarSyncStatus({ collapsed }: SidebarSyncStatusProps) {
    const { isSyncing, logs, syncState } = useSyncStatus();
    const [isOffline, setIsOffline] = useState(!navigator.onLine);

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

    const healthState: SyncHealthState = useMemo(() => {
        if (isOffline) return 'OFFLINE';
        if (isSyncing) return 'SYNCING';

        // Check for failures
        // We only care about the latest log for critical entities
        const criticalEntities = ['orders', 'products', 'inventory'];
        // logs is potentially undefined if context update pending? No, defaulted to [] in provider.
        const relevantLogs = (logs || []).filter(l => criticalEntities.includes(l.entityType));

        // Take the latest 5 to catch recent failures
        const latestLogs = relevantLogs.slice(0, 5);
        if (latestLogs.some(l => l.status === 'FAILED')) {
            return 'FAILED';
        }

        // Check for lagging
        const now = Date.now();
        const oneHour = 60 * 60 * 1000;
        const lagging = (syncState || [])
            .filter(s => criticalEntities.includes(s.entityType))
            .some(s => {
                if (!s.lastSyncedAt) return true; // Never synced is lagging
                return now - new Date(s.lastSyncedAt).getTime() > oneHour;
            });

        if (lagging) return 'LAGGING';

        return 'HEALTHY';
    }, [isOffline, isSyncing, logs, syncState]);

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
            icon: Wifi, // Or refresh icon
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

    return (
        <div className={cn(
            "flex items-center gap-2 px-2 py-2 rounded-lg transition-colors mx-2 mb-2",
            current.bg,
            current.text
        )}>
            <div className="relative flex items-center justify-center shrink-0 w-8 h-8">
                <div className="relative">
                    <div className={cn("absolute inset-0 opacity-20 rounded-full", isSyncing ? "animate-ping" : "animate-pulse", current.dot.replace('bg-', 'bg-'))} />
                    <Icon size={18} strokeWidth={2} className={isSyncing ? "animate-spin" : ""} />
                </div>

                {/* Dot indicator for status */}
                <div className={cn(
                    "absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white",
                    current.dot
                )} />
            </div>

            {!collapsed && (
                <div className="flex flex-col overflow-hidden">
                    <span className="text-sm font-medium whitespace-nowrap">
                        {current.label}
                    </span>
                    <span className="text-[10px] opacity-75 whitespace-nowrap">
                        {current.subtext}
                    </span>
                </div>
            )}
        </div>
    );
}
