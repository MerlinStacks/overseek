import { useState, useMemo } from 'react';
import { useSyncStatus, SyncLog } from '../../context/SyncStatusContext';
import { formatRelativeTime, getStalenessLevel } from '../../utils/relativeTime';
import {
    RefreshCw, CheckCircle, XCircle, Clock, Package,
    ShoppingCart, Users, Star, Layers, Filter,
    ChevronDown, ChevronUp, AlertTriangle, Loader2,
    Pause, Play, X, RotateCcw, Database, Activity,
    TrendingDown
} from 'lucide-react';
import { Logger } from '../../utils/logger';

/** Entity types available for sync */
const SYNC_ENTITIES = [
    { key: 'orders', label: 'Orders', icon: ShoppingCart, color: 'blue' },
    { key: 'products', label: 'Products', icon: Package, color: 'violet' },
    { key: 'customers', label: 'Customers', icon: Users, color: 'emerald' },
    { key: 'reviews', label: 'Reviews', icon: Star, color: 'amber' },
] as const;

/** BOM is handled separately — always full sync via dedicated queue */
const BOM_ENTITY = { key: 'bom', label: 'BOM Inventory', icon: Layers, color: 'teal' } as const;

type SyncEntityKey = typeof SYNC_ENTITIES[number]['key'];

/** Staleness → dot color mapping */
const STALENESS_COLORS = {
    fresh: 'bg-green-500',
    stale: 'bg-amber-500',
    critical: 'bg-red-500',
    never: 'bg-slate-400 dark:bg-slate-500',
} as const;

const STALENESS_LABELS = {
    fresh: 'Up to date',
    stale: 'Getting stale',
    critical: 'Needs sync',
    never: 'Never synced',
} as const;

/**
 * Full-featured sync dashboard used in the Settings → Sync tab.
 *
 * Why separate from the sidebar indicator: the sidebar shows health-at-a-glance,
 * while this panel gives full control over sync operations, queue management,
 * retry logic, and search reindexing.
 */
export function SyncStatus() {
    const {
        isSyncing, syncState, logs, activeJobs, healthSummary,
        runSync, controlSync, retrySync, reindexOrders, refreshStatus
    } = useSyncStatus();

    // Per-entity full-sync toggles
    const [fullSyncTypes, setFullSyncTypes] = useState<Record<SyncEntityKey, boolean>>({
        orders: false, products: false, customers: false, reviews: false,
    });
    const [syncBOM, setSyncBOM] = useState(false);
    const [logFilter, setLogFilter] = useState<string | null>(null);
    const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
    const [syncTriggered, setSyncTriggered] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [reindexState, setReindexState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
    const [reindexResult, setReindexResult] = useState<string | null>(null);

    /** Build a fast lookup: entityType → lastSyncedAt */
    const lastSyncMap = useMemo(() => {
        const map: Record<string, string | null> = {};
        (syncState || []).forEach(s => { map[s.entityType] = s.lastSyncedAt; });
        return map;
    }, [syncState]);

    /** Which jobs are active, keyed by queue name */
    const activeJobMap = useMemo(() => {
        const map: Record<string, typeof activeJobs[number]> = {};
        (activeJobs || []).forEach(j => { map[j.queue.replace('sync-', '')] = j; });
        return map;
    }, [activeJobs]);

    const toggleFullSync = (key: SyncEntityKey) => {
        setFullSyncTypes(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const allSelected = Object.values(fullSyncTypes).every(Boolean);

    const handleSelectToggle = () => {
        const next = !allSelected;
        setFullSyncTypes({ orders: next, products: next, customers: next, reviews: next });
    };

    const handleSync = async () => {
        setSyncTriggered(true);
        const fullSyncList = SYNC_ENTITIES.filter(e => fullSyncTypes[e.key]).map(e => e.key);
        const incrementalList = SYNC_ENTITIES.filter(e => !fullSyncTypes[e.key]).map(e => e.key);

        if (fullSyncList.length > 0) await runSync(fullSyncList, false);
        if (incrementalList.length > 0) await runSync(incrementalList, true);
        if (syncBOM) await runSync(['bom'], false);

        setTimeout(() => setSyncTriggered(false), 2000);
    };

    const handlePauseResume = async () => {
        try {
            if (isPaused) {
                await controlSync('resume');
                setIsPaused(false);
            } else {
                await controlSync('pause');
                setIsPaused(true);
            }
        } catch (err) {
            Logger.error('Pause/resume failed', { error: err });
        }
    };

    const handleCancelJob = async (queueName: string, jobId: string) => {
        try {
            await controlSync('cancel', queueName, jobId);
        } catch (err) {
            Logger.error('Cancel failed', { error: err });
        }
    };

    const handleRetry = async (entityType: string, logId?: string) => {
        try {
            await retrySync(entityType, logId);
        } catch (err) {
            Logger.error('Retry failed', { error: err });
        }
    };

    const handleReindex = async () => {
        setReindexState('running');
        setReindexResult(null);
        try {
            const result = await reindexOrders();
            setReindexState('done');
            setReindexResult(`Reindexed ${result.totalIndexed} orders`);
            setTimeout(() => { setReindexState('idle'); setReindexResult(null); }, 5000);
        } catch (err) {
            setReindexState('error');
            setReindexResult(err instanceof Error ? err.message : 'Reindex failed');
            setTimeout(() => { setReindexState('idle'); setReindexResult(null); }, 5000);
        }
    };

    const filteredLogs = useMemo(() => {
        if (!logFilter) return logs || [];
        return (logs || []).filter(l => l.entityType === logFilter);
    }, [logs, logFilter]);

    return (
        <div className="space-y-6">
            {/* ── Health Summary Bar ──────────────────────── */}
            {healthSummary && <HealthSummaryBar summary={healthSummary} />}

            {/* ── Controls Toolbar ────────────────────────── */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleSelectToggle}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium transition-colors"
                    >
                        {allSelected ? 'Deselect All' : 'Select All Full Sync'}
                    </button>
                </div>

                <div className="flex items-center gap-2">
                    {/* Pause / Resume */}
                    {isSyncing && (
                        <button
                            onClick={handlePauseResume}
                            className={`
                                flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                                ${isPaused
                                    ? 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-500/25'
                                    : 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-500/25'
                                }
                            `}
                        >
                            {isPaused ? <><Play size={12} /> Resume</> : <><Pause size={12} /> Pause</>}
                        </button>
                    )}

                    {/* Refresh */}
                    <button
                        onClick={refreshStatus}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-700/50 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600/50 transition-colors"
                        title="Refresh status"
                    >
                        <RefreshCw size={12} />
                    </button>

                    {/* Sync Now */}
                    <button
                        onClick={handleSync}
                        disabled={isSyncing}
                        className={`
                            flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-300
                            ${isSyncing || syncTriggered
                                ? 'bg-blue-500/20 dark:bg-blue-500/30 text-blue-600 dark:text-blue-400 ring-2 ring-blue-500/30 dark:ring-blue-400/20'
                                : 'bg-blue-600 dark:bg-blue-500 text-white hover:bg-blue-700 dark:hover:bg-blue-600 shadow-sm shadow-blue-500/20'
                            }
                            disabled:opacity-50 disabled:cursor-not-allowed
                        `}
                    >
                        <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                        {isSyncing ? 'Syncing…' : 'Sync Now'}
                    </button>
                </div>
            </div>

            {/* ── Entity Cards ───────────────────────────── */}
            <div>
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-3">
                    Data Sources
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {SYNC_ENTITIES.map(({ key, label, icon: Icon }) => (
                        <EntityCard
                            key={key}
                            label={label}
                            Icon={Icon}
                            staleness={getStalenessLevel(lastSyncMap[key])}
                            lastSyncedAt={lastSyncMap[key]}
                            activeJob={activeJobMap[key]}
                            isFullSync={fullSyncTypes[key]}
                            onToggleFullSync={() => toggleFullSync(key)}
                            onCancel={activeJobMap[key] ? () => handleCancelJob(activeJobMap[key].queue, activeJobMap[key].id) : undefined}
                        />
                    ))}

                    <EntityCard
                        label={BOM_ENTITY.label}
                        Icon={BOM_ENTITY.icon}
                        staleness={getStalenessLevel(lastSyncMap['bom'])}
                        lastSyncedAt={lastSyncMap['bom']}
                        activeJob={activeJobMap['bom'] || activeJobMap['bom-inventory']}
                        isFullSync={syncBOM}
                        onToggleFullSync={() => setSyncBOM(prev => !prev)}
                        onCancel={
                            (activeJobMap['bom'] || activeJobMap['bom-inventory'])
                                ? () => {
                                    const job = activeJobMap['bom'] || activeJobMap['bom-inventory'];
                                    handleCancelJob(job.queue, job.id);
                                }
                                : undefined
                        }
                        alwaysFull
                    />
                </div>
            </div>

            {/* ── Sync Log ───────────────────────────────── */}
            <div className="border-t border-slate-200 dark:border-slate-700 pt-5">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
                        <Clock size={14} />
                        Recent Activity
                    </h3>
                    <LogFilterPills activeFilter={logFilter} onFilter={setLogFilter} />
                </div>

                <div className="space-y-2 max-h-72 overflow-y-auto pr-1 custom-scrollbar">
                    {filteredLogs.length === 0 && (
                        <p className="text-sm text-slate-400 dark:text-slate-500 py-4 text-center">
                            No sync activity yet.
                        </p>
                    )}
                    {filteredLogs.map(log => (
                        <LogEntry
                            key={log.id}
                            log={log}
                            isExpanded={expandedLogId === log.id}
                            onToggle={() => setExpandedLogId(prev => prev === log.id ? null : log.id)}
                            onRetry={() => handleRetry(log.entityType, log.id)}
                        />
                    ))}
                </div>
            </div>

            {/* ── Utilities ──────────────────────────────── */}
            <div className="border-t border-slate-200 dark:border-slate-700 pt-5">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Database size={14} />
                    Utilities
                </h3>
                <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                    <div>
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">Rebuild Search Index</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Re-index all orders from the database into Elasticsearch. Use when search results are stale or missing.
                        </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-4">
                        {reindexResult && (
                            <span className={`text-xs font-medium ${reindexState === 'done' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                {reindexResult}
                            </span>
                        )}
                        <button
                            onClick={handleReindex}
                            disabled={reindexState === 'running'}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors disabled:opacity-50"
                        >
                            {reindexState === 'running'
                                ? <><Loader2 size={14} className="animate-spin" /> Reindexing…</>
                                : <><Database size={14} /> Reindex</>
                            }
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ─── Sub-components ─────────────────────────────────────────────── */

/** Health summary bar showing 24h stats */
function HealthSummaryBar({ summary }: { summary: { lastSuccessAt: string | null; lastFailureAt: string | null; failureRate24h: number; activeJobs: number } }) {
    const failurePercent = Math.round(summary.failureRate24h * 100);
    const isHealthy = failurePercent < 5;
    const isWarning = failurePercent >= 5 && failurePercent < 25;

    return (
        <div className={`
            rounded-xl border p-4 flex items-center gap-4 flex-wrap
            ${isHealthy
                ? 'bg-green-50/50 dark:bg-green-500/5 border-green-200 dark:border-green-500/20'
                : isWarning
                    ? 'bg-amber-50/50 dark:bg-amber-500/5 border-amber-200 dark:border-amber-500/20'
                    : 'bg-red-50/50 dark:bg-red-500/5 border-red-200 dark:border-red-500/20'
            }
        `}>
            <div className="flex items-center gap-2">
                <Activity size={16} className={
                    isHealthy ? 'text-green-600 dark:text-green-400'
                        : isWarning ? 'text-amber-600 dark:text-amber-400'
                            : 'text-red-600 dark:text-red-400'
                } />
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {isHealthy ? 'Healthy' : isWarning ? 'Degraded' : 'Unhealthy'}
                </span>
            </div>

            <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />

            <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-400">
                <span className="flex items-center gap-1">
                    <TrendingDown size={12} />
                    {failurePercent}% failure rate (24h)
                </span>
                <span>
                    {summary.activeJobs} active {summary.activeJobs === 1 ? 'job' : 'jobs'}
                </span>
                {summary.lastSuccessAt && (
                    <span>
                        Last success: {formatRelativeTime(summary.lastSuccessAt)}
                    </span>
                )}
                {summary.lastFailureAt && (
                    <span className="text-red-500 dark:text-red-400">
                        Last failure: {formatRelativeTime(summary.lastFailureAt)}
                    </span>
                )}
            </div>
        </div>
    );
}

interface EntityCardProps {
    label: string;
    Icon: React.ElementType;
    staleness: 'fresh' | 'stale' | 'critical' | 'never';
    lastSyncedAt: string | null | undefined;
    activeJob?: { id: string; queue: string; progress: number };
    isFullSync: boolean;
    onToggleFullSync: () => void;
    onCancel?: () => void;
    alwaysFull?: boolean;
}

/**
 * Individual data-source card showing sync freshness, toggle, and
 * optional inline progress bar + cancel button when a job is active.
 */
function EntityCard({
    label, Icon, staleness, lastSyncedAt,
    activeJob, isFullSync, onToggleFullSync, onCancel, alwaysFull
}: EntityCardProps) {
    const dotColor = STALENESS_COLORS[staleness];
    const stalenessLabel = STALENESS_LABELS[staleness];
    const isActive = !!activeJob;

    return (
        <div className={`
            relative overflow-hidden rounded-xl border p-4 transition-all duration-300
            ${isActive
                ? 'border-blue-300 dark:border-blue-500/40 bg-blue-50/50 dark:bg-blue-500/5 ring-1 ring-blue-200 dark:ring-blue-500/20'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 hover:border-slate-300 dark:hover:border-slate-600'
            }
        `}>
            {/* Active job progress background fill */}
            {isActive && (
                <div
                    className="absolute inset-y-0 left-0 bg-blue-100/60 dark:bg-blue-500/10 transition-all duration-500"
                    style={{ width: `${activeJob.progress}%` }}
                />
            )}

            <div className="relative z-10">
                <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                        <div className={`
                            w-9 h-9 rounded-lg flex items-center justify-center
                            ${isActive ? 'bg-blue-100 dark:bg-blue-500/20' : 'bg-slate-100 dark:bg-slate-700/60'}
                        `}>
                            {isActive
                                ? <Loader2 size={18} className="animate-spin text-blue-600 dark:text-blue-400" />
                                : <Icon size={18} className="text-slate-600 dark:text-slate-400" />
                            }
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{label}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                                <div className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                    {isActive ? `${activeJob.progress}%` : stalenessLabel}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Cancel button for active jobs */}
                    {isActive && onCancel && (
                        <button
                            onClick={onCancel}
                            className="text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10"
                            title="Cancel sync"
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>

                <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">
                        {formatRelativeTime(lastSyncedAt)}
                    </span>
                    <button
                        onClick={onToggleFullSync}
                        className={`
                            text-[11px] font-medium px-2.5 py-1 rounded-md transition-all duration-200
                            ${isFullSync
                                ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 ring-1 ring-blue-200 dark:ring-blue-500/30'
                                : 'bg-slate-100 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600/50'
                            }
                        `}
                        title={alwaysFull ? 'BOM always runs full sync' : isFullSync ? 'Will run full sync' : 'Will run incremental sync'}
                    >
                        {alwaysFull ? (isFullSync ? '✓ Included' : 'Include') : (isFullSync ? '✓ Full' : 'Incremental')}
                    </button>
                </div>
            </div>

            {/* Inline progress bar */}
            {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-200 dark:bg-slate-700">
                    <div
                        className="h-full bg-blue-500 dark:bg-blue-400 transition-all duration-500 rounded-full"
                        style={{ width: `${activeJob.progress}%` }}
                    />
                </div>
            )}
        </div>
    );
}

/** Filter pills for the log section */
function LogFilterPills({ activeFilter, onFilter }: { activeFilter: string | null; onFilter: (f: string | null) => void }) {
    const filters = [
        { key: null, label: 'All' },
        { key: 'orders', label: 'Orders' },
        { key: 'products', label: 'Products' },
        { key: 'customers', label: 'Customers' },
        { key: 'reviews', label: 'Reviews' },
        { key: 'bom', label: 'BOM' },
    ];

    return (
        <div className="flex items-center gap-1">
            <Filter size={12} className="text-slate-400 dark:text-slate-500 mr-1" />
            {filters.map(f => (
                <button
                    key={f.key ?? 'all'}
                    onClick={() => onFilter(f.key)}
                    className={`
                        text-[11px] font-medium px-2 py-0.5 rounded-md transition-colors
                        ${activeFilter === f.key
                            ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50'
                        }
                    `}
                >
                    {f.label}
                </button>
            ))}
        </div>
    );
}

/** Single log entry row with expandable error details and retry button */
function LogEntry({ log, isExpanded, onToggle, onRetry }: {
    log: SyncLog; isExpanded: boolean; onToggle: () => void; onRetry: () => void;
}) {
    const statusConfig = {
        SUCCESS: { icon: CheckCircle, color: 'text-green-500 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-500/10' },
        FAILED: { icon: XCircle, color: 'text-red-500 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-500/10' },
        IN_PROGRESS: { icon: Loader2, color: 'text-blue-500 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-500/10' },
    };

    const cfg = statusConfig[log.status] || statusConfig.SUCCESS;
    const StatusIcon = cfg.icon;
    const hasError = !!log.errorMessage;
    const isFailed = log.status === 'FAILED';

    return (
        <div className={`
            rounded-lg border transition-all duration-200
            ${isFailed
                ? 'border-red-200 dark:border-red-500/20 bg-red-50/30 dark:bg-red-500/5'
                : 'border-slate-100 dark:border-slate-700/50 bg-white dark:bg-slate-800/40'
            }
        `}>
            <div className="flex items-center gap-3 p-3">
                <button
                    onClick={hasError ? onToggle : undefined}
                    className={`flex items-center gap-3 flex-1 min-w-0 text-left ${hasError ? 'cursor-pointer' : 'cursor-default'}`}
                >
                    <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${cfg.bg}`}>
                        <StatusIcon
                            size={14}
                            className={`${cfg.color} ${log.status === 'IN_PROGRESS' ? 'animate-spin' : ''}`}
                        />
                    </div>

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-slate-800 dark:text-slate-200 capitalize">
                                {log.entityType}
                            </span>
                            <span className="text-[11px] text-slate-400 dark:text-slate-500">
                                {formatRelativeTime(log.startedAt)}
                            </span>
                            {log.willRetry && log.nextRetryAt && (
                                <span className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-1.5 py-0.5 rounded">
                                    Retry {formatRelativeTime(log.nextRetryAt)}
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {log.itemsProcessed} items
                            {log.friendlyError
                                ? <span className="text-red-500 dark:text-red-400 ml-1">• {log.friendlyError}</span>
                                : isFailed && <span className="text-red-500 dark:text-red-400 ml-1">• Failed</span>
                            }
                        </p>
                    </div>
                </button>

                {/* Action buttons */}
                <div className="flex items-center gap-1 shrink-0">
                    {isFailed && (
                        <button
                            onClick={onRetry}
                            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 dark:hover:bg-blue-500/20 rounded-md transition-colors"
                            title="Retry this sync"
                        >
                            <RotateCcw size={11} />
                            Retry
                        </button>
                    )}
                    {hasError && (
                        <button onClick={onToggle} className="p-1">
                            {isExpanded
                                ? <ChevronUp size={14} className="text-slate-400 dark:text-slate-500" />
                                : <ChevronDown size={14} className="text-slate-400 dark:text-slate-500" />
                            }
                        </button>
                    )}
                </div>
            </div>

            {/* Expanded error details */}
            {hasError && isExpanded && (
                <div className="border-t border-red-100 dark:border-red-500/10 px-3 py-2.5 bg-red-50/50 dark:bg-red-500/5">
                    <div className="flex items-start gap-2">
                        <AlertTriangle size={12} className="text-red-500 dark:text-red-400 mt-0.5 shrink-0" />
                        <pre className="text-xs text-red-700 dark:text-red-300 font-mono whitespace-pre-wrap break-all">
                            {log.errorMessage}
                        </pre>
                    </div>
                </div>
            )}
        </div>
    );
}
