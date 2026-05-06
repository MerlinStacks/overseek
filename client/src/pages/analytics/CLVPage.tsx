import React, { useState, useEffect, useMemo } from 'react';
import { Logger } from '../../utils/logger';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { DateRangeFilter } from '../../components/analytics/DateRangeFilter';
import { Heart, Users, Repeat, TrendingUp, DollarSign } from 'lucide-react';

interface CLVData {
    averageCLV: number;
    medianCLV: number;
    distribution: { label: string; count: number; percentage: number }[];
    newVsReturning: {
        newCustomers: number;
        returningCustomers: number;
        ratio: number;
    };
    tenureDistribution: { tenureDays: string; count: number; avgCLV: number }[];
    clvBySource: { source: string; customerCount: number; avgCLV: number; totalRevenue: number }[];
    monthlyTrend: { month: string; avgCLV: number; customerCount: number }[];
}

export const CLVPage: React.FC = () => {
    const [days, setDays] = useState(30);
    const { currentAccount } = useAccount();
    const { token } = useAuth();
    const [data, setData] = useState<CLVData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            if (!currentAccount || !token) return;
            setLoading(true);
            setError(null);
            try {
                const result = await api.get<CLVData>(`/api/analytics/clv?monthsBack=${days}`, token, currentAccount.id);
                setData(result);
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                Logger.error('Failed to fetch CLV data:', { error });
                setError(msg);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [currentAccount, token, days]);

    const maxCLV = useMemo(() => {
        if (!data?.monthlyTrend.length) return 0;
        return Math.max(...data.monthlyTrend.map(m => m.avgCLV), 1);
    }, [data]);

    if (loading) {
        return (
            <div className="p-6 flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-6">
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6 text-center">
                    <p className="text-red-600 dark:text-red-400 font-medium">Failed to load CLV data</p>
                    <p className="text-red-500 dark:text-red-500 text-sm mt-1">{error}</p>
                    <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition-colors">Retry</button>
                </div>
            </div>
        );
    }

    if (!data) {
        return <div className="p-6 text-gray-500 dark:text-slate-400">No CLV data available</div>;
    }

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Customer Lifetime Value</h1>
                <DateRangeFilter value={days} onChange={setDays} />
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="border-0 shadow-xs">
                    <CardContent className="p-5">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl">
                                <Heart className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                            </div>
                            <div>
                                <p className="text-xs text-gray-500 dark:text-slate-400">Average CLV</p>
                                <p className="text-xl font-bold text-gray-900 dark:text-slate-100">${data.averageCLV.toFixed(2)}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-0 shadow-xs">
                    <CardContent className="p-5">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-xl">
                                <DollarSign className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                            </div>
                            <div>
                                <p className="text-xs text-gray-500 dark:text-slate-400">Median CLV</p>
                                <p className="text-xl font-bold text-gray-900 dark:text-slate-100">${data.medianCLV.toFixed(2)}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-0 shadow-xs">
                    <CardContent className="p-5">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-xl">
                                <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                            </div>
                            <div>
                                <p className="text-xs text-gray-500 dark:text-slate-400">Total Customers</p>
                                <p className="text-xl font-bold text-gray-900 dark:text-slate-100">{(data.newVsReturning.newCustomers + data.newVsReturning.returningCustomers).toLocaleString()}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-0 shadow-xs">
                    <CardContent className="p-5">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-xl">
                                <Repeat className="w-5 h-5 text-green-600 dark:text-green-400" />
                            </div>
                            <div>
                                <p className="text-xs text-gray-500 dark:text-slate-400">Repeat Rate</p>
                                <p className="text-xl font-bold text-gray-900 dark:text-slate-100">{data.newVsReturning.ratio.toFixed(1)}%</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* CLV Distribution + Monthly Trend */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="border-0 shadow-xs">
                    <CardHeader>
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-indigo-500" />
                            CLV Distribution
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {data.distribution.length === 0 ? (
                            <p className="text-sm text-gray-500 dark:text-slate-400 italic">No distribution data yet</p>
                        ) : (
                            <div className="space-y-3">
                                {data.distribution.map((bucket, i) => {
                                    const maxCount = Math.max(...data.distribution.map(b => b.count), 1);
                                    const pct = (bucket.count / maxCount) * 100;
                                    return (
                                        <div key={i}>
                                            <div className="flex justify-between text-sm mb-1">
                                                <span className="text-gray-600 dark:text-slate-300">{bucket.label}</span>
                                                <span className="text-gray-400 dark:text-slate-500">{bucket.count} customers</span>
                                            </div>
                                            <div className="w-full bg-gray-100 dark:bg-slate-700 rounded-full h-2">
                                                <div
                                                    className="bg-indigo-500 h-2 rounded-full transition-all"
                                                    style={{ width: `${pct}%` }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-xs">
                    <CardHeader>
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-green-500" />
                            Monthly CLV Trend
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {data.monthlyTrend.length === 0 ? (
                            <p className="text-sm text-gray-500 dark:text-slate-400 italic">No trend data yet</p>
                        ) : (
                            <div className="space-y-3">
                                <div className="flex items-end gap-1 h-24">
                                    {data.monthlyTrend.map((m, i) => (
                                        <div key={i} className="flex-1 flex flex-col items-center gap-1">
                                            <div
                                                className="w-full rounded-t-md bg-gradient-to-t from-indigo-500 to-indigo-400 transition-all"
                                                style={{ height: `${Math.max((m.avgCLV / maxCLV) * 100, 4)}%` }}
                                                title={`${m.month}: $${m.avgCLV.toFixed(2)}`}
                                            />
                                            <span className="text-[10px] text-gray-400 dark:text-slate-500 truncate w-full text-center">{m.month.slice(0, 3)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* CLV by Source */}
            <Card className="border-0 shadow-xs">
                <CardHeader>
                    <CardTitle className="text-sm font-semibold">CLV by Acquisition Source</CardTitle>
                </CardHeader>
                <CardContent>
                    {data.clvBySource.length === 0 ? (
                        <p className="text-sm text-gray-500 dark:text-slate-400 italic">No source data yet</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-gray-100 dark:border-slate-700">
                                        <th className="text-left py-2 px-3 text-gray-500 dark:text-slate-400 font-medium">Source</th>
                                        <th className="text-right py-2 px-3 text-gray-500 dark:text-slate-400 font-medium">Avg CLV</th>
                                        <th className="text-right py-2 px-3 text-gray-500 dark:text-slate-400 font-medium">Customers</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.clvBySource.map(item => (
                                        <tr key={item.source} className="border-b border-gray-50 dark:border-slate-800 last:border-0">
                                            <td className="py-2.5 px-3 capitalize text-gray-700 dark:text-slate-300">{item.source}</td>
                                            <td className="py-2.5 px-3 text-right font-medium text-gray-900 dark:text-slate-100">${item.avgCLV.toFixed(2)}</td>
                                            <td className="py-2.5 px-3 text-right text-gray-500 dark:text-slate-400">{item.customerCount.toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default CLVPage;
