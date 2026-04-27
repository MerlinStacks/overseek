import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, CheckCircle, Clock, Settings, Loader2 } from 'lucide-react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import { echarts, type EChartsOption } from '../utils/echarts';
import { useApi } from '../hooks/useApi';

// ─── Types ──────────────────────────────────────────────────────────────────

interface PlatformSummaryRow {
    platform: string;
    status: string;
    count: number;
}

interface FailureTrendRow {
    date: string;
    count: number;
}

interface EventBreakdownRow {
    platform: string;
    eventName: string;
    status: string;
    count: number;
}

interface RecentFailure {
    id: string;
    platform: string;
    eventName: string;
    eventId: string;
    httpStatus: number | null;
    lastError: string | null;
    attempts: number;
    createdAt: string;
}

interface HealthResponse {
    platformSummary: PlatformSummaryRow[];
    failureTrend: FailureTrendRow[];
    eventBreakdown: EventBreakdownRow[];
    recentFailures: RecentFailure[];
    range: string;
}

interface TrendTooltipParam {
    name: string;
    value: number | string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PLATFORM_COLORS: Record<string, string> = {
    META: 'bg-blue-500',
    TIKTOK: 'bg-gray-900 dark:bg-gray-100',
    GOOGLE: 'bg-green-500',
    PINTEREST: 'bg-red-500',
    GA4: 'bg-amber-500',
    SNAPCHAT: 'bg-yellow-400',
    MICROSOFT: 'bg-cyan-600',
    TWITTER: 'bg-slate-800 dark:bg-slate-200',
};

const RANGES = ['24h', '7d', '30d'] as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

function computePlatformHealth(summary: PlatformSummaryRow[]) {
    const platforms = new Map<string, { sent: number; failed: number; pending: number }>();

    for (const row of summary) {
        if (!platforms.has(row.platform)) {
            platforms.set(row.platform, { sent: 0, failed: 0, pending: 0 });
        }
        const p = platforms.get(row.platform)!;
        if (row.status === 'SENT') p.sent += row.count;
        else if (row.status === 'FAILED') p.failed += row.count;
        else if (row.status === 'PENDING') p.pending += row.count;
    }

    return Array.from(platforms.entries())
        .map(([platform, { sent, failed, pending }]) => {
            const total = sent + failed;
            const score = total > 0 ? Math.round((sent / total) * 100) : -1;
            return { platform, sent, failed, pending, score };
        })
        .sort((a, b) => (b.sent + b.failed + b.pending) - (a.sent + a.failed + a.pending));
}

function scoreColor(score: number): string {
    if (score < 0) return 'text-slate-400';
    if (score >= 95) return 'text-emerald-500';
    if (score >= 80) return 'text-amber-500';
    return 'text-red-500';
}

function scoreLabel(score: number): string {
    if (score < 0) return 'No Data';
    if (score >= 95) return 'Healthy';
    if (score >= 80) return 'Degraded';
    return 'Unhealthy';
}

function formatTime(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
}

// ─── Component ──────────────────────────────────────────────────────────────

export function CAPIHealthPage() {
    const { get, accountId, isReady } = useApi();
    const [data, setData] = useState<HealthResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [range, setRange] = useState<string>('7d');

    const fetchHealth = useCallback(async () => {
        if (!isReady) return;
        setLoading(true);
        try {
            const res = await get<HealthResponse>(`/api/capi/health?accountId=${accountId}&range=${range}`);
            setData(res);
        } catch { /* handled by api layer */ }
        finally { setLoading(false); }
    }, [get, accountId, isReady, range]);

    useEffect(() => { fetchHealth(); }, [fetchHealth]);

    const platforms = data ? computePlatformHealth(data.platformSummary) : [];

    // ─── Failure Trend Chart ────────────────────────────────────────────

    const trendOption: EChartsOption = {
        grid: { top: 10, right: 16, bottom: 24, left: 40 },
        tooltip: {
            trigger: 'axis',
            formatter: (params: unknown) => {
                const p = (Array.isArray(params) ? params[0] : params) as TrendTooltipParam;
                return `<b>${p.name}</b><br/>Failures: ${p.value}`;
            },
        },
        xAxis: {
            type: 'category',
            data: (data?.failureTrend || []).map(r => {
                const d = new Date(r.date);
                return `${d.getMonth() + 1}/${d.getDate()}`;
            }),
            axisLabel: { fontSize: 10, color: '#94a3b8' },
            axisLine: { show: false },
            axisTick: { show: false },
        },
        yAxis: {
            type: 'value',
            minInterval: 1,
            axisLabel: { fontSize: 10, color: '#94a3b8' },
            splitLine: { lineStyle: { color: '#e2e8f0', type: 'dashed' } },
        },
        series: [{
            type: 'bar',
            data: (data?.failureTrend || []).map(r => r.count),
            itemStyle: { color: '#ef4444', borderRadius: [3, 3, 0, 0] },
            barMaxWidth: 20,
        }],
    };

    // ─── Event Breakdown by Platform ────────────────────────────────────

    const eventsByPlatform = new Map<string, Array<{ event: string; sent: number; failed: number }>>();
    for (const row of data?.eventBreakdown || []) {
        if (!eventsByPlatform.has(row.platform)) eventsByPlatform.set(row.platform, []);
        const list = eventsByPlatform.get(row.platform)!;
        let entry = list.find(e => e.event === row.eventName);
        if (!entry) { entry = { event: row.eventName, sent: 0, failed: 0 }; list.push(entry); }
        if (row.status === 'SENT') entry.sent += row.count;
        else if (row.status === 'FAILED') entry.failed += row.count;
    }

    // ─── Render ─────────────────────────────────────────────────────────

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-3">
                    <Activity className="w-6 h-6 text-indigo-600" />
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">CAPI Delivery Health</h1>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Server-side conversion delivery across all platforms.</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                        {RANGES.map(r => (
                            <button
                                key={r}
                                onClick={() => setRange(r)}
                                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                                    range === r
                                        ? 'bg-indigo-600 text-white'
                                        : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                                }`}
                            >
                                {r}
                            </button>
                        ))}
                    </div>
                    <Link
                        to="/settings?tab=conversions"
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                    >
                        <Settings className="w-3.5 h-3.5" />
                        Configure
                    </Link>
                </div>
            </div>

            {loading && !data ? (
                <div className="flex justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                </div>
            ) : !data || platforms.length === 0 ? (
                <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-lg rounded-xl border border-slate-200/50 dark:border-slate-700/50 shadow-lg p-12 text-center">
                    <Activity className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-3" />
                    <p className="text-slate-500 dark:text-slate-400">No delivery data yet. Configure your CAPI platforms and send some events first.</p>
                    <Link to="/settings?tab=conversions" className="inline-block mt-4 text-indigo-600 hover:text-indigo-700 text-sm font-medium">
                        Go to CAPI Settings
                    </Link>
                </div>
            ) : (
                <>
                    {/* Platform Health Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {platforms.map(p => (
                            <div key={p.platform} className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-lg rounded-xl border border-slate-200/50 dark:border-slate-700/50 shadow-lg p-5">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                        <span className={`w-2.5 h-2.5 rounded-full ${PLATFORM_COLORS[p.platform] || 'bg-slate-400'}`} />
                                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{p.platform}</span>
                                    </div>
                                    <span className={`text-xs font-medium ${scoreColor(p.score)}`}>{scoreLabel(p.score)}</span>
                                </div>
                                <div className={`text-3xl font-bold mb-1 ${scoreColor(p.score)}`}>
                                    {p.score >= 0 ? `${p.score}%` : '—'}
                                </div>
                                <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                                    <span className="flex items-center gap-1"><CheckCircle className="w-3 h-3 text-emerald-500" />{p.sent.toLocaleString()}</span>
                                    <span className="flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-red-500" />{p.failed.toLocaleString()}</span>
                                    {p.pending > 0 && <span className="flex items-center gap-1"><Clock className="w-3 h-3 text-amber-500" />{p.pending.toLocaleString()}</span>}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Failure Trend */}
                    <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-lg rounded-xl border border-slate-200/50 dark:border-slate-700/50 shadow-lg p-5">
                        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3">Failure Trend (30 days)</h2>
                        {(data?.failureTrend?.length ?? 0) > 0 ? (
                            <ReactEChartsCore
                                echarts={echarts}
                                option={trendOption}
                                style={{ height: 200, width: '100%' }}
                                opts={{ renderer: 'svg' }}
                            />
                        ) : (
                            <div className="h-[200px] flex items-center justify-center text-sm text-slate-400">No failures in the last 30 days</div>
                        )}
                    </div>

                    {/* Event Type Breakdown */}
                    <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-lg rounded-xl border border-slate-200/50 dark:border-slate-700/50 shadow-lg p-5">
                        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3">Event Breakdown by Platform</h2>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-slate-200 dark:border-slate-700">
                                        <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">Platform</th>
                                        <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">Event</th>
                                        <th className="text-right py-2 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">Sent</th>
                                        <th className="text-right py-2 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">Failed</th>
                                        <th className="text-right py-2 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">Rate</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {Array.from(eventsByPlatform.entries()).flatMap(([platform, events]) =>
                                        events.sort((a, b) => (b.sent + b.failed) - (a.sent + a.failed)).map((e, i) => {
                                            const total = e.sent + e.failed;
                                            const rate = total > 0 ? Math.round((e.sent / total) * 100) : -1;
                                            return (
                                                <tr key={`${platform}-${e.event}`} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                                                    <td className="py-2 px-3">
                                                        {i === 0 && (
                                                            <div className="flex items-center gap-1.5">
                                                                <span className={`w-2 h-2 rounded-full ${PLATFORM_COLORS[platform] || 'bg-slate-400'}`} />
                                                                <span className="font-medium text-slate-700 dark:text-slate-300">{platform}</span>
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="py-2 px-3 text-slate-600 dark:text-slate-400">{e.event}</td>
                                                    <td className="py-2 px-3 text-right text-slate-700 dark:text-slate-300">{e.sent.toLocaleString()}</td>
                                                    <td className="py-2 px-3 text-right text-slate-700 dark:text-slate-300">{e.failed.toLocaleString()}</td>
                                                    <td className={`py-2 px-3 text-right font-medium ${rate >= 95 ? 'text-emerald-500' : rate >= 80 ? 'text-amber-500' : rate >= 0 ? 'text-red-500' : 'text-slate-400'}`}>
                                                        {rate >= 0 ? `${rate}%` : '—'}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Recent Failures */}
                    {(data?.recentFailures?.length ?? 0) > 0 && (
                        <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-lg rounded-xl border border-slate-200/50 dark:border-slate-700/50 shadow-lg p-5">
                            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3">Recent Failures</h2>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-200 dark:border-slate-700">
                                            <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">Platform</th>
                                            <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">Event</th>
                                            <th className="text-right py-2 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">HTTP</th>
                                            <th className="text-right py-2 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">Attempts</th>
                                            <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">Error</th>
                                            <th className="text-right py-2 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">Time</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data!.recentFailures.map(f => (
                                            <tr key={f.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                                                <td className="py-2 px-3">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className={`w-2 h-2 rounded-full ${PLATFORM_COLORS[f.platform] || 'bg-slate-400'}`} />
                                                        <span className="text-slate-700 dark:text-slate-300">{f.platform}</span>
                                                    </div>
                                                </td>
                                                <td className="py-2 px-3 text-slate-600 dark:text-slate-400">{f.eventName}</td>
                                                <td className="py-2 px-3 text-right text-slate-600 dark:text-slate-400">{f.httpStatus ?? '—'}</td>
                                                <td className="py-2 px-3 text-right text-slate-600 dark:text-slate-400">{f.attempts}</td>
                                                <td className="py-2 px-3 text-slate-600 dark:text-slate-400 max-w-xs truncate" title={f.lastError || ''}>
                                                    {f.lastError ? f.lastError.substring(0, 80) : '—'}
                                                </td>
                                                <td className="py-2 px-3 text-right text-slate-500 dark:text-slate-500 whitespace-nowrap">{formatTime(f.createdAt)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
