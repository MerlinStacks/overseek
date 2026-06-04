import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle,
    ArrowRight,
    BadgePercent,
    Boxes,
    CalendarClock,
    FileDown,
    Loader2,
    Megaphone,
    RefreshCw,
    RotateCcw,
    Search,
    ShieldAlert,
    Sparkles,
    TrendingDown,
    Users
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useAccount } from '../../../context/AccountContext';
import { DateRangeOption } from '../../../utils/dateUtils';
import { formatCompact, formatCurrency, formatNumber } from '../../../utils/format';

interface ReportsActionCenterProps {
    dateOption: DateRangeOption;
    startDate: string;
    endDate: string;
    totalRevenue: number;
    totalOrders: number;
    newCustomers: number;
    currency: string;
    templateCount: number;
    onOpenLibrary: () => void;
    onOpenCustomBuilder: () => void;
}

interface ProfitItem {
    orderId: string;
    orderNumber: string;
    name: string;
    sku?: string;
    quantity: number;
    revenue: number;
    cost: number;
    profit: number;
    margin: number;
}

interface ProfitabilityData {
    summary?: {
        revenue: number;
        cost: number;
        profit: number;
        margin: number;
    };
    breakdown?: ProfitItem[];
}

interface VelocityItem {
    id: string;
    name: string;
    sku?: string;
    stock: number;
    soldLast30d: number;
    dailyVelocity: number;
    daysRemaining: number;
}

interface AttributionData {
    firstTouch?: Array<{ source: string; count: number }>;
    lastTouch?: Array<{ source: string; count: number }>;
    totalSessions?: number;
}

interface SearchData {
    topQueries?: Array<{ query: string; count: number }>;
    totalSearches?: number;
}

interface LtvData {
    avgLTV?: number;
    totalCustomers?: number;
    repeatCustomers?: number;
    repeatRate?: number;
}

interface CohortData {
    cohorts?: Array<{
        week: string;
        totalVisitors: number;
        retention: Array<{ week: number; count: number; rate: number }>;
    }>;
}

interface ScheduleData {
    id: string;
    frequency: string;
    isActive: boolean;
}

interface ActionData {
    profitability: ProfitabilityData | null;
    velocity: VelocityItem[];
    attribution: AttributionData | null;
    searches: SearchData | null;
    ltv: LtvData | null;
    cohorts: CohortData | null;
    schedules: ScheduleData[];
    digests: ScheduleData[];
}

function daysFromDateOption(option: DateRangeOption): number {
    if (option === 'today' || option === 'yesterday') return 1;
    if (option === '7d') return 7;
    if (option === '90d') return 90;
    if (option === 'ytd') return Math.max(1, Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000));
    if (option === 'all') return 3650;
    return 30;
}

function safeNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function ReportModule({ icon, title, status, description, children }: {
    icon: ReactNode;
    title: string;
    status: 'live' | 'partial' | 'planned';
    description: string;
    children: ReactNode;
}) {
    const statusClass = status === 'live'
        ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
        : status === 'partial'
            ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
            : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';

    return (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-xs dark:border-slate-700 dark:bg-slate-800/70">
            <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 gap-3">
                    <div className="rounded-xl bg-blue-50 p-2.5 text-blue-600 dark:bg-blue-900/30">{icon}</div>
                    <div className="min-w-0">
                        <h3 className="font-bold text-gray-950 dark:text-white">{title}</h3>
                        <p className="mt-1 text-sm leading-5 text-gray-500 dark:text-slate-400">{description}</p>
                    </div>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${statusClass}`}>{status}</span>
            </div>
            <div className="mt-5">{children}</div>
        </div>
    );
}

function MiniMetric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'good' | 'risk' }) {
    const toneClass = tone === 'good' ? 'text-green-600' : tone === 'risk' ? 'text-red-600' : 'text-gray-950 dark:text-white';
    return (
        <div className="rounded-xl bg-gray-50 p-3 dark:bg-slate-900/60">
            <p className="text-xs font-medium text-gray-500 dark:text-slate-400">{label}</p>
            <p className={`mt-1 text-lg font-bold ${toneClass}`}>{value}</p>
        </div>
    );
}

function EmptyLine({ text }: { text: string }) {
    return <p className="rounded-xl border border-dashed border-gray-200 px-3 py-4 text-center text-sm text-gray-500 dark:border-slate-700 dark:text-slate-400">{text}</p>;
}

export function ReportsActionCenter({
    dateOption,
    startDate,
    endDate,
    totalRevenue,
    totalOrders,
    newCustomers,
    currency,
    templateCount,
    onOpenLibrary,
    onOpenCustomBuilder
}: ReportsActionCenterProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<ActionData>({
        profitability: null,
        velocity: [],
        attribution: null,
        searches: null,
        ltv: null,
        cohorts: null,
        schedules: [],
        digests: []
    });

    const fetchJson = useCallback(async <T,>(path: string): Promise<T | null> => {
        if (!token || !currentAccount) return null;
        const res = await fetch(path, {
            headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': currentAccount.id }
        });
        if (!res.ok) return null;
        return await res.json() as T;
    }, [currentAccount, token]);

    const fetchActionData = useCallback(async () => {
        if (!token || !currentAccount) return;
        setIsLoading(true);
        setError(null);
        const days = daysFromDateOption(dateOption);

        try {
            const [profitability, velocity, attribution, searches, ltv, cohorts, schedules, digests] = await Promise.all([
                fetchJson<ProfitabilityData>(`/api/analytics/profitability?startDate=${startDate}&endDate=${endDate}`),
                fetchJson<VelocityItem[]>('/api/analytics/inventory/stock-velocity'),
                fetchJson<AttributionData>(`/api/tracking/attribution?days=${days}`),
                fetchJson<SearchData>(`/api/tracking/searches?days=${days}`),
                fetchJson<LtvData>('/api/tracking/ltv'),
                fetchJson<CohortData>('/api/tracking/cohorts'),
                fetchJson<ScheduleData[]>('/api/analytics/schedules'),
                fetchJson<ScheduleData[]>('/api/analytics/digests')
            ]);

            setData({
                profitability,
                velocity: velocity || [],
                attribution,
                searches,
                ltv,
                cohorts,
                schedules: schedules || [],
                digests: digests || []
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load report action data');
        } finally {
            setIsLoading(false);
        }
    }, [currentAccount, dateOption, endDate, fetchJson, startDate, token]);

    useEffect(() => {
        void fetchActionData();
    }, [fetchActionData]);

    const lowMarginItems = useMemo(() => {
        return (data.profitability?.breakdown || [])
            .filter((item) => item.margin < 15 || item.profit <= 0)
            .sort((a, b) => a.margin - b.margin)
            .slice(0, 5);
    }, [data.profitability]);

    const inventoryRisks = useMemo(() => {
        const tracked = data.velocity.length;
        const critical = data.velocity.filter((item) => item.daysRemaining < 7 && item.daysRemaining >= 0).length;
        const watch = data.velocity.filter((item) => item.daysRemaining >= 7 && item.daysRemaining < 21).length;
        const deadStock = data.velocity.filter((item) => item.soldLast30d === 0 && item.stock > 0).length;
        const topRisk = data.velocity.filter((item) => item.daysRemaining < 21).slice(0, 4);
        return { tracked, critical, watch, deadStock, topRisk };
    }, [data.velocity]);

    const activeSchedules = data.schedules.filter((schedule) => schedule.isActive).length;
    const activeDigests = data.digests.filter((digest) => digest.isActive).length;
    const margin = safeNumber(data.profitability?.summary?.margin);
    const repeatRate = safeNumber(data.ltv?.repeatRate);
    const topSource = data.attribution?.lastTouch?.[0];
    const topSearch = data.searches?.topQueries?.[0];

    const insightCards = [
        {
            title: margin > 0 ? `Margin is ${margin.toFixed(1)}%` : 'Margin data needs COGS coverage',
            body: margin > 0 && margin < 20 ? 'Gross margin is below the usual safe zone. Start with the profit leak report.' : 'Use profitability and leak reports to protect revenue quality.',
            tone: margin > 0 && margin < 20 ? 'risk' : 'default'
        },
        {
            title: `${inventoryRisks.critical} urgent stock risks`,
            body: inventoryRisks.critical > 0 ? 'Several products may sell out within 7 days.' : 'No urgent stock velocity risk detected from current inventory data.',
            tone: inventoryRisks.critical > 0 ? 'risk' : 'good'
        },
        {
            title: topSource ? `${topSource.source} leads last touch` : 'Attribution is waiting for sessions',
            body: topSource ? `${formatNumber(topSource.count)} sessions are attributed to this source.` : 'Install or validate tracking to unlock channel insights.',
            tone: 'default'
        },
        {
            title: `${activeSchedules + activeDigests} active scheduled reports`,
            body: activeSchedules + activeDigests > 0 ? 'Scheduled reporting is configured.' : 'Create a weekly digest so insights reach the team automatically.',
            tone: activeSchedules + activeDigests > 0 ? 'good' : 'default'
        }
    ];

    return (
        <div className="space-y-6">
            <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-xs dark:border-slate-700 dark:bg-slate-900/80">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-purple-50 px-3 py-1 text-xs font-semibold text-purple-700 dark:bg-purple-900/30 dark:text-purple-200">
                            <Sparkles size={14} />
                            Action Center
                        </div>
                        <h2 className="text-2xl font-bold tracking-tight text-gray-950 dark:text-white">Everything reports should answer</h2>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500 dark:text-slate-400">
                            This pulls together executive health, profit leaks, inventory actions, retention, demand, attribution, scheduling, and export readiness. Live modules use existing data. Planned modules show the next data model needed.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button onClick={onOpenLibrary} className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                            Open Library
                            <ArrowRight size={16} />
                        </button>
                        <button onClick={onOpenCustomBuilder} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700">
                            Build Custom Report
                            <ArrowRight size={16} />
                        </button>
                    </div>
                </div>

                {isLoading ? (
                    <div className="mt-6 flex items-center justify-center rounded-2xl border border-dashed border-gray-200 py-12 text-gray-400 dark:border-slate-700">
                        <Loader2 className="mr-2 animate-spin" size={18} />
                        Loading report intelligence...
                    </div>
                ) : error ? (
                    <div className="mt-6 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
                        {error}
                    </div>
                ) : (
                    <>
                        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                            {insightCards.map((insight) => (
                                <div key={insight.title} className="rounded-2xl bg-gray-50 p-4 dark:bg-slate-800/80">
                                    <p className={`font-bold ${insight.tone === 'risk' ? 'text-red-600' : insight.tone === 'good' ? 'text-green-600' : 'text-gray-950 dark:text-white'}`}>{insight.title}</p>
                                    <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">{insight.body}</p>
                                </div>
                            ))}
                        </div>

                        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <MiniMetric label="Revenue" value={formatCurrency(totalRevenue, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} />
                            <MiniMetric label="Orders" value={formatNumber(totalOrders)} />
                            <MiniMetric label="New Customers" value={formatNumber(newCustomers)} />
                            <MiniMetric label="Templates" value={formatNumber(templateCount)} />
                        </div>
                    </>
                )}
            </div>

            {!isLoading && (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                    <ReportModule
                        icon={<ShieldAlert size={20} />}
                        title="Profit Leak Report"
                        status="live"
                        description="Low-margin and negative-profit sold items that deserve pricing, COGS, or discount review."
                    >
                        <div className="grid grid-cols-3 gap-3">
                            <MiniMetric label="Gross Profit" value={formatCurrency(safeNumber(data.profitability?.summary?.profit), currency)} tone={safeNumber(data.profitability?.summary?.profit) >= 0 ? 'good' : 'risk'} />
                            <MiniMetric label="Margin" value={`${margin.toFixed(1)}%`} tone={margin >= 20 ? 'good' : 'risk'} />
                            <MiniMetric label="Leak Items" value={formatNumber(lowMarginItems.length)} tone={lowMarginItems.length > 0 ? 'risk' : 'good'} />
                        </div>
                        <div className="mt-4 space-y-2">
                            {lowMarginItems.length === 0 ? <EmptyLine text="No low-margin items found in this period." /> : lowMarginItems.map((item) => (
                                <div key={`${item.orderId}-${item.name}`} className="flex items-center justify-between gap-4 rounded-xl bg-gray-50 px-3 py-2 dark:bg-slate-900/60">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{item.name}</p>
                                        <p className="text-xs text-gray-500">#{item.orderNumber} {item.sku ? `, ${item.sku}` : ''}</p>
                                    </div>
                                    <span className="shrink-0 text-sm font-bold text-red-600">{item.margin.toFixed(1)}%</span>
                                </div>
                            ))}
                        </div>
                    </ReportModule>

                    <ReportModule
                        icon={<Boxes size={20} />}
                        title="Inventory Action Report"
                        status="live"
                        description="Stockout risk, dead stock, and reorder signals from stock velocity."
                    >
                        <div className="grid grid-cols-3 gap-3">
                            <MiniMetric label="Tracked" value={formatNumber(inventoryRisks.tracked)} />
                            <MiniMetric label="Critical" value={formatNumber(inventoryRisks.critical)} tone={inventoryRisks.critical > 0 ? 'risk' : 'good'} />
                            <MiniMetric label="Dead Stock" value={formatNumber(inventoryRisks.deadStock)} tone={inventoryRisks.deadStock > 0 ? 'risk' : 'good'} />
                        </div>
                        <div className="mt-4 space-y-2">
                            {inventoryRisks.topRisk.length === 0 ? <EmptyLine text="No near-term stockout risks found." /> : inventoryRisks.topRisk.map((item) => (
                                <div key={item.id} className="flex items-center justify-between gap-4 rounded-xl bg-gray-50 px-3 py-2 dark:bg-slate-900/60">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{item.name}</p>
                                        <p className="text-xs text-gray-500">Stock {item.stock}, selling {item.dailyVelocity}/day</p>
                                    </div>
                                    <span className="shrink-0 rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600 dark:bg-red-900/30">{item.daysRemaining}d left</span>
                                </div>
                            ))}
                        </div>
                    </ReportModule>

                    <ReportModule
                        icon={<Users size={20} />}
                        title="Cohorts & Retention"
                        status="live"
                        description="Repeat behaviour, LTV, and cohort health from tracked purchase and session events."
                    >
                        <div className="grid grid-cols-3 gap-3">
                            <MiniMetric label="Avg LTV" value={formatCurrency(safeNumber(data.ltv?.avgLTV), currency)} />
                            <MiniMetric label="Repeat Rate" value={`${repeatRate.toFixed(1)}%`} tone={repeatRate >= 20 ? 'good' : 'default'} />
                            <MiniMetric label="Cohorts" value={formatNumber(data.cohorts?.cohorts?.length || 0)} />
                        </div>
                    </ReportModule>

                    <ReportModule
                        icon={<Search size={20} />}
                        title="Search Demand Report"
                        status="partial"
                        description="On-site search demand, top queries, and gaps that should become products or content."
                    >
                        <div className="grid grid-cols-2 gap-3">
                            <MiniMetric label="Searches" value={formatNumber(data.searches?.totalSearches || 0)} />
                            <MiniMetric label="Top Query" value={topSearch ? topSearch.query : 'None yet'} />
                        </div>
                        <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">Next step: enrich search events with result count and conversion outcome to detect zero-result and high-intent gaps.</p>
                    </ReportModule>

                    <ReportModule
                        icon={<Megaphone size={20} />}
                        title="Marketing Attribution"
                        status="partial"
                        description="First-touch and last-touch sources from tracking sessions."
                    >
                        <div className="grid grid-cols-2 gap-3">
                            <MiniMetric label="Sessions" value={formatCompact(data.attribution?.totalSessions || 0)} />
                            <MiniMetric label="Top Last Touch" value={topSource ? topSource.source : 'Direct'} />
                        </div>
                        <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">Next step: join ad spend and order margin by campaign for ROAS, CAC, and profit attribution.</p>
                    </ReportModule>

                    <ReportModule
                        icon={<BadgePercent size={20} />}
                        title="Discount Performance"
                        status="planned"
                        description="Coupon revenue, discount leakage, margin after promo, and repeat purchase impact."
                    >
                        <EmptyLine text="Needs coupon-level order aggregation and discount-to-margin attribution before this can be live." />
                    </ReportModule>

                    <ReportModule
                        icon={<RotateCcw size={20} />}
                        title="Refunds & Returns"
                        status="planned"
                        description="Refund rate by product, category, customer segment, and channel."
                    >
                        <EmptyLine text="Needs normalized refund line items or refund events to avoid guessing from order status alone." />
                    </ReportModule>

                    <ReportModule
                        icon={<TrendingDown size={20} />}
                        title="Product Lifecycle"
                        status="partial"
                        description="Winners, declining products, dead stock, and products needing pricing or marketing support."
                    >
                        <div className="grid grid-cols-3 gap-3">
                            <MiniMetric label="Dead Stock" value={formatNumber(inventoryRisks.deadStock)} tone={inventoryRisks.deadStock > 0 ? 'risk' : 'good'} />
                            <MiniMetric label="Watchlist" value={formatNumber(inventoryRisks.watch)} />
                            <MiniMetric label="Critical" value={formatNumber(inventoryRisks.critical)} tone={inventoryRisks.critical > 0 ? 'risk' : 'good'} />
                        </div>
                    </ReportModule>

                    <ReportModule
                        icon={<CalendarClock size={20} />}
                        title="Scheduled Reports"
                        status="live"
                        description="Weekly and monthly report delivery for owners, finance, marketing, and inventory roles."
                    >
                        <div className="grid grid-cols-3 gap-3">
                            <MiniMetric label="Active Schedules" value={formatNumber(activeSchedules)} />
                            <MiniMetric label="Active Digests" value={formatNumber(activeDigests)} />
                            <MiniMetric label="Total" value={formatNumber(data.schedules.length + data.digests.length)} />
                        </div>
                    </ReportModule>

                    <ReportModule
                        icon={<FileDown size={20} />}
                        title="Export Center"
                        status="partial"
                        description="JSON export exists for tracking data. CSV, XLSX, PDF, and export history are the next layer."
                    >
                        <div className="flex items-center justify-between gap-4 rounded-xl bg-gray-50 p-3 dark:bg-slate-900/60">
                            <div>
                                <p className="text-sm font-semibold text-gray-900 dark:text-white">Analytics export endpoint available</p>
                                <p className="text-xs text-gray-500 dark:text-slate-400">Next: authenticated download UI and generated export history.</p>
                            </div>
                            <FileDown size={18} className="text-gray-400" />
                        </div>
                    </ReportModule>

                    <ReportModule
                        icon={<RefreshCw size={20} />}
                        title="Saved Views & Compare Mode"
                        status="partial"
                        description="Templates already save custom reports. Compare mode needs previous-period calculations across modules."
                    >
                        <div className="grid grid-cols-2 gap-3">
                            <MiniMetric label="Saved Templates" value={formatNumber(templateCount)} />
                            <MiniMetric label="Compare Mode" value="Planned" />
                        </div>
                    </ReportModule>

                    <ReportModule
                        icon={<AlertTriangle size={20} />}
                        title="Report Health"
                        status="partial"
                        description="Flags missing COGS, tracking gaps, stock sync coverage, and schedule health."
                    >
                        <div className="grid grid-cols-3 gap-3">
                            <MiniMetric label="COGS Coverage" value={margin > 0 ? 'Available' : 'Review'} tone={margin > 0 ? 'good' : 'risk'} />
                            <MiniMetric label="Tracking" value={(data.attribution?.totalSessions || 0) > 0 ? 'Active' : 'Quiet'} />
                            <MiniMetric label="Inventory" value={inventoryRisks.tracked > 0 ? 'Active' : 'Missing'} tone={inventoryRisks.tracked > 0 ? 'good' : 'risk'} />
                        </div>
                    </ReportModule>
                </div>
            )}
        </div>
    );
}
