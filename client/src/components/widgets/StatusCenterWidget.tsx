import { useEffect, useId, useState } from 'react';
import { useWidgetRead } from '../../hooks/useWidgetRead';
import { isRecord } from '../../utils/responseValidation';
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
    ExternalLink
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { formatRelativeTime } from '../../utils/relativeTime';
import { WidgetProps } from './WidgetRegistry';
import { widgetCardClass, widgetTitleClass } from './widgetStyles';

/**
 * Health status levels matching backend API response.
 */
type HealthLevel = 'healthy' | 'warning' | 'critical' | 'unknown';

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
    unknown: { color: 'text-slate-600 dark:text-slate-300', bgColor: 'bg-slate-100 dark:bg-slate-800', borderColor: 'border-slate-300 dark:border-slate-600', icon: AlertTriangle, label: 'Unknown / not current' },
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
const timestamp = (value: unknown): string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now() + 60000 ? value : '';
function decodeStatus(value: unknown): StatusCenterData {
    if (!isRecord(value)) throw new Error('Invalid status data');
    const level = (input: unknown): HealthLevel => typeof input === 'string' && Object.prototype.hasOwnProperty.call(STATUS_CONFIG, input) ? input as HealthLevel : 'unknown';
    const section = (input: unknown): StatusSection => {
        if (!isRecord(input)) return { status: 'unknown', message: 'Status data unavailable', lastChecked: '' };
        return { status: level(input.status), message: typeof input.message === 'string' && input.message.trim() ? input.message.slice(0, 1000) : 'Status data unavailable',
            lastChecked: timestamp(input.lastChecked), details: isRecord(input.details) ? input.details : undefined };
    };
    return { overallHealth: level(value.overallHealth), lastUpdated: timestamp(value.lastUpdated), sync: section(value.sync), webhooks: section(value.webhooks), storeHealth: section(value.storeHealth), revenueAlerts: section(value.revenueAlerts) };
}
function displayDetail(key: string, value: unknown, details?: Record<string, unknown>): string {
    if (value == null || typeof value === 'number' && !Number.isFinite(value)) return 'Unavailable';
    if (typeof value === 'number') {
        if (['todayRevenue', 'baselineRevenue'].includes(key)) {
            const currency = details?.currency;
            return typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? `${currency} ${value.toFixed(2)}` : `${value.toFixed(2)} (currency unavailable)`;
        }
        if (['failureRate24h', 'percentChange'].includes(key)) return `${value}%`;
        if (key === 'responseTimeMs') return `${value} ms`;
        return value.toLocaleString();
    }
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value !== 'string') return 'Unavailable';
    if (['lastSuccessAt', 'lastWebhookAt'].includes(key)) return timestamp(value) ? formatRelativeTime(value) : 'Unavailable';
    return value.slice(0, 1000);
}

/**
 * StatusCenterWidget - Unified system health dashboard panel.
 * Displays sync, webhooks, store health, and revenue alerts in one place.
 */
export function StatusCenterWidget({ className }: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    if (!token || !currentAccount) return <div className={`${widgetCardClass} p-6 ${className || ''}`}>Select an account and sign in to view status.</div>;
    return <ScopedStatusCenter key={`${currentAccount.id}:${token}`} accountId={currentAccount.id} token={token} className={className} />;
}
function ScopedStatusCenter({ accountId, token, className }: { accountId: string; token: string; className?: string }) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
    const { data, busy: isLoading, error, refresh: fetchStatus } = useWidgetRead('/api/status-center', accountId, token, decodeStatus, 60000);
    const id = useId();
    const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

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
                    type="button"
                    aria-expanded={isExpanded}
                    aria-controls={`${id}-${key}`}
                    onClick={() => hasDetails && toggleSection(key)}
                    className={`w-full p-3 flex items-center gap-3 text-left ${hasDetails ? 'cursor-pointer hover:bg-white/40 dark:hover:bg-black/10' : 'cursor-default'} transition-colors`}
                    disabled={!hasDetails}
                >
                    <div className={`p-2.5 rounded-lg bg-white dark:bg-slate-800 ${config.color}`}>
                        <ItemIcon size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
                            <StatusIcon size={14} className={config.color} />
                        </div>
                        <p className={`text-xs font-medium opacity-90 truncate ${config.color}`}>{section.message}</p>
                        <p className="text-[10px] text-slate-500">Checked {section.lastChecked ? formatRelativeTime(section.lastChecked) : 'time unavailable'}</p>
                    </div>
                    {hasDetails && (
                        <div className={`text-slate-400 dark:text-slate-500 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                            <ChevronDown size={16} />
                        </div>
                    )}
                </button>

                {isExpanded && <div id={`${id}-${key}`}>
                    <div className="overflow-hidden">
                        <div className="px-3 pb-3 pt-1 border-t border-slate-200/50 dark:border-slate-700/50">
                            <div className="grid grid-cols-2 gap-2 mt-2">
                                {section.details && Object.entries(section.details).map(([detailKey, value]) => {
                                    if (detailKey === 'error') return null; // Provider errors can contain secrets; use diagnostics.

                                    const label = detailKey
                                        .replace(/([A-Z])/g, ' $1')
                                        .replace(/24h/g, '(24h)')
                                        .replace(/^./, str => str.toUpperCase())
                                        .trim();

                                    const displayValue = displayDetail(detailKey, value, section.details);

                                    return (
                                        <div key={detailKey} className="bg-white dark:bg-slate-800 rounded-md px-2.5 py-1.5">
                                            <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">{label}</p>
                                            <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate" title={displayValue}>{displayValue}</p>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>}
            </div>
        );
    };

    if (!data && !error) {
        return (
            <div className={`${widgetCardClass} p-6 ${className || ''}`}>
                <div className="flex items-center gap-3 mb-5">
                    <div className="p-2 bg-[var(--brand-subtle)] rounded-lg">
                        <Activity className="text-[var(--brand-text)] animate-pulse" size={20} />
                    </div>
                    <h3 className={`${widgetTitleClass} text-lg`}>Status Center</h3>
                </div>
                <div className="space-y-3">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="h-20 bg-slate-100 dark:bg-slate-700/50 rounded-xl animate-pulse" />
                    ))}
                </div>
            </div>
        );
    }

    if (!data) {
        return (
            <div className={`${widgetCardClass} p-6 ${className || ''}`}>
                <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg">
                        <Activity className="text-[var(--brand-text)]" size={20} />
                    </div>
                    <h3 className={`${widgetTitleClass} text-lg`}>Status Center</h3>
                </div>
                <div className="text-center py-10 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700">
                    <div className="inline-flex p-3 bg-red-50 dark:bg-red-500/10 rounded-full mb-3">
                        <XCircle className="text-red-500 dark:text-red-400" size={32} />
                    </div>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400">{error || 'Unable to load status'}</p>
                    <button
                        type="button"
                        disabled={isLoading}
                        onClick={fetchStatus}
                        className="mt-4 px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] bg-[var(--primary-color)] hover:bg-[var(--primary-hover)] focus-visible:outline-[var(--focus-color)] rounded-lg transition-colors disabled:opacity-50"
                    >
                        Try again
                    </button>
                </div>
            </div>
        );
    }

    const stale = (time: string) => !time || now - Date.parse(time) > 10 * 60 * 1000;
    const unverified = Boolean(error || isLoading || stale(data.lastUpdated) || [data.sync, data.webhooks, data.storeHealth, data.revenueAlerts].some(section => section.status === 'unknown' || stale(section.lastChecked)));
    const overallConfig = STATUS_CONFIG[unverified ? 'unknown' : data.overallHealth];
    const OverallIcon = overallConfig.icon;

    return (
        <div className={`${widgetCardClass} overflow-hidden flex flex-col h-full ${className || ''}`}>
            {/* Header with overall status */}
            <div className={`px-5 py-4 ${overallConfig.bgColor} border-b ${overallConfig.borderColor}`}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className={`p-2.5 rounded-lg bg-white dark:bg-slate-800 ${overallConfig.color}`}>
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
                        type="button"
                        aria-label="Refresh status"
                        disabled={isLoading}
                        onClick={() => void fetchStatus()}
                        className="p-2 hover:bg-white/50 dark:hover:bg-black/20 rounded-lg transition-colors text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                        title="Refresh status"
                    >
                        <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* Status sections */}
            {unverified && <p role={error ? 'alert' : 'status'} className="px-4 py-2 text-xs text-amber-700 dark:text-amber-300">{error || (isLoading ? 'Refreshing; any values shown are from the previous check.' : 'Some status observations are unavailable or stale; current health is unverified.')}</p>}
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
                    Updated {data.lastUpdated ? formatRelativeTime(data.lastUpdated) : 'time unavailable'}
                </p>
                <a
                    href="/settings?tab=sync"
                    className="text-[10px] font-semibold text-[var(--brand-text)] hover:underline focus-visible:outline-[var(--focus-color)] flex items-center gap-1 transition-colors"
                >
                    Settings <ExternalLink size={10} />
                </a>
            </div>
        </div>
    );
}

export default StatusCenterWidget;
