import { useState, useCallback } from 'react';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';
import {
    RefreshCw,
    CheckCircle,
    AlertTriangle,
    XCircle,
    Activity,
    Webhook,
    Store,
    TrendingUp,
    TrendingDown,
    ChevronDown,
    ChevronUp,
    ExternalLink
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { WidgetProps } from './WidgetRegistry';

/**
 * Health status levels matching backend API response.
 */
type HealthLevel = 'healthy' | 'warning' | 'critical';

/**
 * Individual status section from the API.
 */
interface StatusSection {
    status: HealthLevel;
    message: string;
    lastChecked: string;
    details?: Record<string, unknown>;
}

/**
 * Full status center response from the API.
 */
interface StatusCenterData {
    overallHealth: HealthLevel;
    lastUpdated: string;
    sync: StatusSection;
    webhooks: StatusSection;
    storeHealth: StatusSection;
    revenueAlerts: StatusSection;
}

/**
 * Visual configuration for each health level.
 */
const STATUS_CONFIG: Record<HealthLevel, {
    color: string;
    bgColor: string;
    borderColor: string;
    icon: typeof CheckCircle;
    label: string;
}> = {
    healthy: {
        color: 'text-emerald-600 dark:text-emerald-400',
        bgColor: 'bg-emerald-50 dark:bg-emerald-500/10',
        borderColor: 'border-emerald-200 dark:border-emerald-500/20',
        icon: CheckCircle,
        label: 'Healthy'
    },
    warning: {
        color: 'text-amber-600 dark:text-amber-400',
        bgColor: 'bg-amber-50 dark:bg-amber-500/10',
        borderColor: 'border-amber-200 dark:border-amber-500/20',
        icon: AlertTriangle,
        label: 'Warning'
    },
    critical: {
        color: 'text-rose-600 dark:text-rose-400',
        bgColor: 'bg-rose-50 dark:bg-rose-500/10',
        borderColor: 'border-rose-200 dark:border-rose-500/20',
        icon: XCircle,
        label: 'Critical'
    }
};

/**
 * Format a date string to relative time (e.g., "2 minutes ago").
 */
function formatRelativeTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);

    if (diffSecs < 60) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
}

/**
 * StatusCenterWidget - Unified system health dashboard panel.
 * Displays sync, webhooks, store health, and revenue alerts in one place.
 */
export function StatusCenterWidget({ className }: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [data, setData] = useState<StatusCenterData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

    const fetchStatus = useCallback(async () => {
        if (!token || !currentAccount?.id) return;

        try {
            const res = await fetch('/api/status-center', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Account-ID': currentAccount.id
                }
            });

            if (!res.ok) {
                throw new Error('Failed to fetch status');
            }

            const json = await res.json();
            setData(json);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setIsLoading(false);
        }
    }, [token, currentAccount?.id]);

    // Use visibility-aware polling with tab coordination
    useVisibilityPolling(fetchStatus, 60000, [fetchStatus], 'status-center');

    const toggleSection = (section: string) => {
        setExpandedSections(prev => {
            const next = new Set(prev);
            if (next.has(section)) {
                next.delete(section);
            } else {
                next.add(section);
            }
            return next;
        });
    };

    const renderStatusItem = (
        key: string,
        section: StatusSection,
        icon: typeof Activity,
        title: string
    ) => {
        const config = STATUS_CONFIG[section.status];
        const StatusIcon = config.icon;
        const ItemIcon = icon;
        const isExpanded = expandedSections.has(key);
        const hasDetails = section.details && Object.keys(section.details).length > 0;

        return (
            <div
                key={key}
                className={`rounded-xl border ${config.borderColor} ${config.bgColor} transition-all duration-300 overflow-hidden group`}
            >
                <button
                    onClick={() => hasDetails && toggleSection(key)}
                    className={`w-full p-3 flex items-center gap-3 text-left ${hasDetails ? 'cursor-pointer hover:bg-white/40 dark:hover:bg-black/10' : 'cursor-default'} transition-colors`}
                    disabled={!hasDetails}
                >
                    <div className={`p-2.5 rounded-lg bg-white/60 dark:bg-slate-800/60 shadow-sm ${config.color}`}>
                        <ItemIcon size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
                            <StatusIcon size={14} className={config.color} />
                        </div>
                        <p className={`text-xs font-medium opacity-90 truncate ${config.color}`}>{section.message}</p>
                    </div>
                    {hasDetails && (
                        <div className={`text-slate-400 dark:text-slate-500 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                            <ChevronDown size={16} />
                        </div>
                    )}
                </button>

                <div className={`grid transition-all duration-300 ease-in-out ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                    <div className="overflow-hidden">
                        <div className="px-3 pb-3 pt-1 border-t border-slate-200/50 dark:border-slate-700/50">
                            <div className="grid grid-cols-2 gap-2 mt-2">
                                {section.details && Object.entries(section.details).map(([detailKey, value]) => {
                                    if (detailKey === 'configured' || detailKey === 'connected' || detailKey === 'error') return null;

                                    const label = detailKey
                                        .replace(/([A-Z])/g, ' $1')
                                        .replace(/24h/g, '(24h)')
                                        .replace(/^./, str => str.toUpperCase())
                                        .trim();

                                    let displayValue: string;
                                    if (value === null || value === undefined) {
                                        displayValue = '—';
                                    } else if (typeof value === 'number') {
                                        if (detailKey.toLowerCase().includes('revenue')) {
                                            displayValue = `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                                        } else if (detailKey.includes('Rate') || detailKey.includes('Change')) {
                                            displayValue = `${value}%`;
                                        } else if (detailKey.includes('Ms')) {
                                            displayValue = `${value}ms`;
                                        } else {
                                            displayValue = value.toLocaleString();
                                        }
                                    } else if (typeof value === 'boolean') {
                                        displayValue = value ? 'Yes' : 'No';
                                    } else if (typeof value === 'string' && value.includes('T') && value.includes('Z')) {
                                        displayValue = formatRelativeTime(value);
                                    } else {
                                        displayValue = String(value);
                                    }

                                    return (
                                        <div key={detailKey} className="bg-white/60 dark:bg-slate-800/60 rounded-md px-2.5 py-1.5 backdrop-blur-sm">
                                            <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">{label}</p>
                                            <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate" title={displayValue}>{displayValue}</p>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    if (isLoading) {
        return (
            <div className={`bg-white dark:bg-slate-800/90 rounded-2xl border border-slate-200/80 dark:border-slate-700/50 shadow-sm p-6 ${className || ''}`}>
                <div className="flex items-center gap-3 mb-5">
                    <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                        <Activity className="text-blue-600 dark:text-blue-400 animate-pulse" size={20} />
                    </div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Status Center</h3>
                </div>
                <div className="space-y-3">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="h-20 bg-slate-100 dark:bg-slate-700/50 rounded-xl animate-pulse" />
                    ))}
                </div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className={`bg-white dark:bg-slate-800/90 rounded-2xl border border-slate-200/80 dark:border-slate-700/50 shadow-sm p-6 ${className || ''}`}>
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg">
                        <Activity className="text-blue-600 dark:text-blue-400" size={20} />
                    </div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Status Center</h3>
                </div>
                <div className="text-center py-10 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700">
                    <div className="inline-flex p-3 bg-red-50 dark:bg-red-500/10 rounded-full mb-3">
                        <XCircle className="text-red-500 dark:text-red-400" size={32} />
                    </div>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400">{error || 'Unable to load status'}</p>
                    <button
                        onClick={fetchStatus}
                        className="mt-4 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm"
                    >
                        Try again
                    </button>
                </div>
            </div>
        );
    }

    const overallConfig = STATUS_CONFIG[data.overallHealth];
    const OverallIcon = overallConfig.icon;

    return (
        <div className={`bg-white dark:bg-slate-800/90 rounded-2xl border border-slate-200/80 dark:border-slate-700/50 shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)] overflow-hidden transition-all duration-300 hover:shadow-[0_10px_40px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_10px_40px_rgba(0,0,0,0.3)] flex flex-col h-full ${className || ''}`}>
            {/* Header with overall status */}
            <div className={`px-5 py-4 ${overallConfig.bgColor} border-b ${overallConfig.borderColor}`}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className={`p-2.5 rounded-xl bg-white/70 dark:bg-slate-800/70 shadow-sm ${overallConfig.color}`}>
                            <Activity size={22} />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">Status Center</h3>
                            <div className="flex items-center gap-1.5 mt-0.5">
                                <OverallIcon size={14} className={overallConfig.color} />
                                <span className={`text-xs font-bold ${overallConfig.color}`}>
                                    {overallConfig.label}
                                </span>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={() => {
                            setIsLoading(true);
                            fetchStatus();
                        }}
                        className="p-2 hover:bg-white/50 dark:hover:bg-black/20 rounded-lg transition-colors text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                        title="Refresh status"
                    >
                        <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* Status sections */}
            <div className="p-4 space-y-3 flex-1 overflow-y-auto custom-scrollbar">
                {renderStatusItem('sync', data.sync, RefreshCw, 'Data Sync')}
                {renderStatusItem('webhooks', data.webhooks, Webhook, 'Webhooks')}
                {renderStatusItem('storeHealth', data.storeHealth, Store, 'Store Health')}
                {renderStatusItem(
                    'revenueAlerts',
                    data.revenueAlerts,
                    data.revenueAlerts.details?.direction === 'above' ? TrendingUp : TrendingDown,
                    'Revenue Alerts'
                )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-between">
                <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
                    Updated {formatRelativeTime(data.lastUpdated)}
                </p>
                <a
                    href="/settings?tab=sync"
                    className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-1 transition-colors"
                >
                    Settings <ExternalLink size={10} />
                </a>
            </div>
        </div>
    );
}

export default StatusCenterWidget;
