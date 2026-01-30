import { useState, useCallback } from 'react';
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
    ChevronRight,
    ExternalLink,
    Clock,
    Zap
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';

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
    textColor: string;
    bgColor: string;
    bgGradient: string;
    borderColor: string;
    icon: typeof CheckCircle;
    label: string;
    pulse: boolean;
}> = {
    healthy: {
        color: 'text-emerald-600',
        textColor: 'text-emerald-700',
        bgColor: 'bg-emerald-50',
        bgGradient: 'from-emerald-500 to-green-600',
        borderColor: 'border-emerald-200',
        icon: CheckCircle,
        label: 'All Systems Operational',
        pulse: false
    },
    warning: {
        color: 'text-amber-600',
        textColor: 'text-amber-700',
        bgColor: 'bg-amber-50',
        bgGradient: 'from-amber-500 to-orange-500',
        borderColor: 'border-amber-200',
        icon: AlertTriangle,
        label: 'Some Issues Detected',
        pulse: true
    },
    critical: {
        color: 'text-red-600',
        textColor: 'text-red-700',
        bgColor: 'bg-red-50',
        bgGradient: 'from-red-500 to-rose-600',
        borderColor: 'border-red-200',
        icon: XCircle,
        label: 'Attention Required',
        pulse: true
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
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
}

/**
 * StatusCenterPanel - Full-featured status center panel for settings or standalone use.
 * Provides detailed view with action buttons and navigation.
 */
export function StatusCenterPanel() {
    const navigate = useNavigate();
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [data, setData] = useState<StatusCenterData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchStatus = useCallback(async (showRefreshState = false) => {
        if (!token || !currentAccount?.id) return;

        if (showRefreshState) setIsRefreshing(true);

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
            setIsRefreshing(false);
        }
    }, [token, currentAccount?.id]);

    // Visibility-aware polling with tab coordination
    useVisibilityPolling(() => fetchStatus(false), 60000, [fetchStatus], 'status-center-panel');

    const renderCard = (
        section: StatusSection,
        icon: typeof Activity,
        title: string,
        settingsPath?: string,
        actionLabel?: string
    ) => {
        const config = STATUS_CONFIG[section.status];
        const StatusIcon = config.icon;
        const ItemIcon = icon;

        return (
            <div className={`rounded-xl border-2 ${config.borderColor} ${config.bgColor} overflow-hidden transition-all duration-300 hover:shadow-lg`}>
                {/* Card Header */}
                <div className="p-4">
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                            <div className={`p-3 rounded-xl bg-white shadow-sm ${config.color}`}>
                                <ItemIcon size={24} />
                            </div>
                            <div>
                                <h3 className="font-semibold text-gray-900">{title}</h3>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                    <StatusIcon size={14} className={config.color} />
                                    <span className={`text-sm ${config.color}`}>{config.label.split(' ')[0]}</span>
                                </div>
                            </div>
                        </div>
                        {config.pulse && (
                            <div className={`w-3 h-3 rounded-full bg-gradient-to-r ${config.bgGradient} animate-pulse`} />
                        )}
                    </div>

                    {/* Message */}
                    <p className={`mt-3 text-sm ${config.textColor}`}>{section.message}</p>

                    {/* Details Grid */}
                    {section.details && Object.keys(section.details).length > 0 && (
                        <div className="mt-4 grid grid-cols-2 gap-2">
                            {Object.entries(section.details).slice(0, 4).map(([key, value]) => {
                                if (key === 'configured' || key === 'connected' || key === 'error') return null;

                                const label = key
                                    .replace(/([A-Z])/g, ' $1')
                                    .replace(/24h/g, '(24h)')
                                    .replace(/^./, str => str.toUpperCase())
                                    .trim();

                                let displayValue: string;
                                if (value === null || value === undefined) {
                                    displayValue = '—';
                                } else if (typeof value === 'number') {
                                    if (key.toLowerCase().includes('revenue')) {
                                        displayValue = `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                                    } else if (key.includes('Rate') || key.includes('Change')) {
                                        displayValue = `${value}%`;
                                    } else if (key.includes('Ms')) {
                                        displayValue = `${value}ms`;
                                    } else {
                                        displayValue = value.toLocaleString();
                                    }
                                } else if (typeof value === 'boolean') {
                                    displayValue = value ? '✓' : '✗';
                                } else if (typeof value === 'string' && value.includes('T') && value.includes('Z')) {
                                    displayValue = formatRelativeTime(value);
                                } else {
                                    displayValue = String(value).slice(0, 20);
                                }

                                return (
                                    <div key={key} className="bg-white/60 rounded-lg px-3 py-2">
                                        <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
                                        <p className="text-sm font-medium text-gray-800 truncate">{displayValue}</p>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Action Footer */}
                {settingsPath && (
                    <button
                        onClick={() => navigate(settingsPath)}
                        className="w-full px-4 py-3 bg-white/50 border-t border-white/80 flex items-center justify-between text-sm font-medium text-gray-600 hover:bg-white/80 transition-colors"
                    >
                        <span>{actionLabel || 'Configure Settings'}</span>
                        <ChevronRight size={16} />
                    </button>
                )}
            </div>
        );
    };

    if (isLoading) {
        return (
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                            <Activity className="text-blue-600" size={20} />
                            Status Center
                        </h2>
                        <p className="text-sm text-gray-500">Unified health monitoring for your store</p>
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-pulse">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="h-48 bg-gray-100 rounded-xl" />
                    ))}
                </div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                            <Activity className="text-blue-600" size={20} />
                            Status Center
                        </h2>
                        <p className="text-sm text-gray-500">Unified health monitoring for your store</p>
                    </div>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center">
                    <XCircle className="mx-auto text-red-400 mb-3" size={48} />
                    <p className="text-red-700 font-medium">{error || 'Unable to load status'}</p>
                    <button
                        onClick={() => {
                            setIsLoading(true);
                            fetchStatus();
                        }}
                        className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                    >
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    const overallConfig = STATUS_CONFIG[data.overallHealth];
    const OverallIcon = overallConfig.icon;

    return (
        <div className="space-y-6">
            {/* Header with Overall Status */}
            <div className={`rounded-xl bg-gradient-to-r ${overallConfig.bgGradient} p-6 text-white shadow-lg`}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm">
                            <OverallIcon size={32} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold">{overallConfig.label}</h2>
                            <p className="text-white/80 text-sm flex items-center gap-1.5 mt-1">
                                <Clock size={12} />
                                Last updated {formatRelativeTime(data.lastUpdated)}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => fetchStatus(true)}
                        disabled={isRefreshing}
                        className="p-3 bg-white/20 hover:bg-white/30 rounded-xl transition-colors backdrop-blur-sm disabled:opacity-50"
                        title="Refresh status"
                    >
                        <RefreshCw size={20} className={isRefreshing ? 'animate-spin' : ''} />
                    </button>
                </div>

                {/* Quick Stats */}
                <div className="grid grid-cols-4 gap-3 mt-6">
                    {[
                        { label: 'Sync', status: data.sync.status },
                        { label: 'Webhooks', status: data.webhooks.status },
                        { label: 'Store', status: data.storeHealth.status },
                        { label: 'Revenue', status: data.revenueAlerts.status }
                    ].map(item => {
                        const itemConfig = STATUS_CONFIG[item.status];
                        const ItemIcon = itemConfig.icon;
                        return (
                            <div key={item.label} className="bg-white/10 backdrop-blur-sm rounded-lg p-3 text-center">
                                <ItemIcon size={20} className="mx-auto mb-1 opacity-90" />
                                <p className="text-xs font-medium opacity-80">{item.label}</p>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Status Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {renderCard(
                    data.sync,
                    RefreshCw,
                    'Data Synchronization',
                    '/settings?tab=sync',
                    'Sync Settings'
                )}
                {renderCard(
                    data.webhooks,
                    Webhook,
                    'Webhook Delivery',
                    '/settings?tab=webhooks',
                    'Webhook Settings'
                )}
                {renderCard(
                    data.storeHealth,
                    Store,
                    'WooCommerce Store',
                    '/settings?tab=general',
                    'Connection Settings'
                )}
                {renderCard(
                    data.revenueAlerts,
                    data.revenueAlerts.details?.direction === 'above' ? TrendingUp : TrendingDown,
                    'Revenue Monitoring',
                    '/analytics/revenue',
                    'View Analytics'
                )}
            </div>

            {/* Quick Actions */}
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <Zap size={16} className="text-amber-500" />
                    Quick Actions
                </h3>
                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={() => navigate('/settings?tab=sync')}
                        className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2"
                    >
                        <RefreshCw size={14} />
                        Force Full Sync
                    </button>
                    <button
                        onClick={() => navigate('/settings?tab=webhooks')}
                        className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2"
                    >
                        <Webhook size={14} />
                        Test Webhooks
                    </button>
                    <a
                        href={currentAccount?.wooUrl || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2"
                    >
                        <ExternalLink size={14} />
                        Open Store
                    </a>
                </div>
            </div>
        </div>
    );
}

export default StatusCenterPanel;
