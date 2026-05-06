import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { api } from '../../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Logger } from '../../utils/logger';
import { TrendingUp, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface AOVPoint {
    date: string;
    aov: number;
    orders: number;
}

interface AOVComparison {
    current: number;
    previous: number;
    change: number;
    changePercent: number;
}

export const AOVTrendView: React.FC<{ days: number }> = ({ days }) => {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [trend, setTrend] = useState<AOVPoint[]>([]);
    const [comparison, setComparison] = useState<AOVComparison | null>(null);
    const [loading, setLoading] = useState(false);

    const fetchData = useCallback(async () => {
        if (!token || !currentAccount?.id) return;
        setLoading(true);
        try {
            const [trendRes, compRes] = await Promise.all([
                api.get<AOVPoint[]>(`/api/analytics/aov-trend?days=${days}`, token, currentAccount.id),
                api.get<AOVComparison>(`/api/analytics/aov-trend/comparison?days=${days}`, token, currentAccount.id),
            ]);
            setTrend(trendRes || []);
            setComparison(compRes);
        } catch (e) {
            Logger.error('Failed to fetch AOV trend:', { error: e });
        } finally {
            setLoading(false);
        }
    }, [days, token, currentAccount?.id]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const chartData = useMemo(() => {
        if (trend.length === 0) return { points: [], max: 0, min: 0 };
        const values = trend.map(t => t.aov);
        const max = Math.max(...values);
        const min = Math.min(...values);
        const range = max - min || 1;
        const width = 100;
        const height = 40;
        const padding = 2;
        const points = trend.map((t, i) => ({
            x: (i / (trend.length - 1 || 1)) * (width - padding * 2) + padding,
            y: height - padding - ((t.aov - min) / range) * (height - padding * 2),
            value: t.aov,
            date: t.date,
        }));
        return { points, max, min };
    }, [trend]);

    const svgPath = chartData.points.length > 1
        ? chartData.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
        : '';

    return (
        <Card className="border-0 shadow-xs">
            <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-indigo-500" />
                    AOV Trend
                </CardTitle>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="flex justify-center py-8">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                    </div>
                ) : trend.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-slate-400 italic">No AOV trend data yet</p>
                ) : (
                    <div className="space-y-4">
                        {/* Comparison badges */}
                        {comparison && (
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-gray-500 dark:text-slate-400">Current:</span>
                                    <span className="text-lg font-bold text-gray-900 dark:text-slate-100">${comparison.current.toFixed(2)}</span>
                                </div>
                                <div className={`flex items-center gap-1 text-sm font-medium ${comparison.changePercent >= 0
                                    ? 'text-green-600 dark:text-green-400'
                                    : 'text-red-600 dark:text-red-400'
                                    }`}>
                                    {comparison.changePercent >= 0
                                        ? <ArrowUpRight className="w-4 h-4" />
                                        : <ArrowDownRight className="w-4 h-4" />
                                    }
                                    {Math.abs(comparison.changePercent).toFixed(1)}%
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-gray-500 dark:text-slate-400">Previous:</span>
                                    <span className="text-sm text-gray-400 dark:text-slate-500">${comparison.previous.toFixed(2)}</span>
                                </div>
                            </div>
                        )}

                        {/* SVG Line Chart */}
                        <div className="bg-gray-50 dark:bg-slate-800/50 rounded-xl p-4">
                            <svg viewBox={`0 0 100 44`} className="w-full h-24" preserveAspectRatio="none">
                                <defs>
                                    <linearGradient id="aovGradient" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3" />
                                        <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
                                    </linearGradient>
                                </defs>
                                {chartData.points.length > 1 && (
                                    <>
                                        <path
                                            d={`${svgPath} L 100 ${44 - 2} L ${chartData.points[0].x} ${44 - 2} Z`}
                                            fill="url(#aovGradient)"
                                        />
                                        <path
                                            d={svgPath}
                                            fill="none"
                                            stroke="#6366f1"
                                            strokeWidth="0.8"
                                            vectorEffect="non-scaling-stroke"
                                        />
                                        {chartData.points.map((p, i) => (
                                            <circle
                                                key={i}
                                                cx={p.x}
                                                cy={p.y}
                                                r="1"
                                                fill="#6366f1"
                                                className="opacity-0 hover:opacity-100 transition-opacity"
                                            >
                                                <title>{`${p.date}: $${p.value.toFixed(2)}`}</title>
                                            </circle>
                                        ))}
                                    </>
                                )}
                            </svg>
                            <div className="flex justify-between mt-2 text-[10px] text-gray-400 dark:text-slate-500">
                                <span>{trend[0]?.date || ''}</span>
                                <span>{trend[trend.length - 1]?.date || ''}</span>
                            </div>
                        </div>

                        {/* Stats row */}
                        <div className="grid grid-cols-3 gap-4 text-center">
                            <div>
                                <p className="text-xs text-gray-500 dark:text-slate-400">Highest AOV</p>
                                <p className="text-sm font-bold text-green-600 dark:text-green-400">${chartData.max.toFixed(2)}</p>
                            </div>
                            <div>
                                <p className="text-xs text-gray-500 dark:text-slate-400">Average</p>
                                <p className="text-sm font-bold text-gray-900 dark:text-slate-100">
                                    ${(trend.reduce((s, t) => s + t.aov, 0) / trend.length).toFixed(2)}
                                </p>
                            </div>
                            <div>
                                <p className="text-xs text-gray-500 dark:text-slate-400">Lowest AOV</p>
                                <p className="text-sm font-bold text-red-600 dark:text-red-400">${chartData.min.toFixed(2)}</p>
                            </div>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

export default AOVTrendView;
