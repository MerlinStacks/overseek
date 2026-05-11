import React, { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { DateRangeFilter } from '../../components/analytics/DateRangeFilter';
import { GitBranch, ArrowRight, TrendingUp } from 'lucide-react';

interface AttributionData {
    firstTouch: { source: string; count: number }[];
    lastTouch: { source: string; count: number }[];
    totalSessions: number;
}

interface CohortData {
    cohorts: {
        week: string;
        totalVisitors: number;
        retention: { week: number; count: number; rate: number }[];
    }[];
}

export const AttributionPage: React.FC = () => {
    const [days, setDays] = useState(1); // Default to Today
    const { currentAccount } = useAccount();
    const { token } = useAuth();
    const [data, setData] = useState<AttributionData | null>(null);
    const [cohortData, setCohortData] = useState<CohortData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            if (!currentAccount || !token) return;
            setLoading(true);
            try {
                const [attributionResult, cohortsResult] = await Promise.all([
                    api.get<AttributionData>(`/api/tracking/attribution?days=${days}`, token, currentAccount.id),
                    api.get<CohortData>('/api/tracking/cohorts', token, currentAccount.id),
                ]);

                setData(attributionResult);
                setCohortData(cohortsResult);
            } catch (error) {
                Logger.error('Failed to fetch attribution/cohorts analytics:', { error: error });
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [currentAccount, token, days]);

    if (loading) {
        return (
            <div className="p-6 flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    if (!data) {
        return <div className="p-6 text-gray-500">No data available</div>;
    }

    const getSourceColor = (_source: string, index: number) => {
        const colors = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500', 'bg-pink-500', 'bg-yellow-500', 'bg-teal-500'];
        return colors[index % colors.length];
    };

    const getRetentionColor = (rate: number) => {
        if (rate >= 70) return 'bg-green-500 text-white';
        if (rate >= 50) return 'bg-green-400 text-white';
        if (rate >= 30) return 'bg-yellow-400 text-gray-900';
        if (rate >= 15) return 'bg-orange-400 text-white';
        return 'bg-red-400 text-white';
    };

    const formatWeek = (week: string) => {
        const date = new Date(week);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Attribution & Cohort Analysis</h1>
                    <p className="text-sm text-gray-500 mt-1">Compare attribution channels and track retention by cohort in one place.</p>
                </div>
                <DateRangeFilter value={days} onChange={setDays} />
            </div>

            {/* Summary */}
            <Card className="border-0 shadow-xs bg-linear-to-r from-blue-50 to-purple-50">
                <CardContent className="p-6">
                    <div className="flex items-center justify-center gap-4">
                        <div className="text-center">
                            <p className="text-3xl font-bold text-gray-900">{data.totalSessions.toLocaleString()}</p>
                            <p className="text-sm text-gray-500">Total Sessions</p>
                        </div>
                        <ArrowRight className="w-6 h-6 text-gray-400" />
                        <div className="text-center">
                            <p className="text-3xl font-bold text-blue-600">{data.firstTouch.length}</p>
                            <p className="text-sm text-gray-500">Traffic Sources</p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Comparison */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="border-0 shadow-xs">
                    <CardHeader>
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                            <GitBranch className="w-4 h-4 text-blue-500" />
                            First Touch Attribution
                        </CardTitle>
                        <p className="text-xs text-gray-500">The first channel that brought users to your site</p>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            {data.firstTouch.slice(0, 10).map((item, index) => {
                                const percentage = (item.count / data.totalSessions) * 100;
                                return (
                                    <div key={item.source}>
                                        <div className="flex justify-between text-sm mb-1">
                                            <span className="capitalize text-gray-700 flex items-center gap-2">
                                                <div className={`w-2 h-2 rounded-full ${getSourceColor(item.source, index)}`} />
                                                {item.source}
                                            </span>
                                            <span className="text-gray-500">
                                                {item.count.toLocaleString()} <span className="text-xs">({percentage.toFixed(1)}%)</span>
                                            </span>
                                        </div>
                                        <div className="w-full bg-gray-100 rounded-full h-2">
                                            <div
                                                className={`h-2 rounded-full transition-all ${getSourceColor(item.source, index)}`}
                                                style={{ width: `${percentage}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-xs">
                    <CardHeader>
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                            <GitBranch className="w-4 h-4 text-green-500 rotate-180" />
                            Last Touch Attribution
                        </CardTitle>
                        <p className="text-xs text-gray-500">The last channel before conversion</p>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            {data.lastTouch.slice(0, 10).map((item, index) => {
                                const percentage = (item.count / data.totalSessions) * 100;
                                return (
                                    <div key={item.source}>
                                        <div className="flex justify-between text-sm mb-1">
                                            <span className="capitalize text-gray-700 flex items-center gap-2">
                                                <div className={`w-2 h-2 rounded-full ${getSourceColor(item.source, index)}`} />
                                                {item.source}
                                            </span>
                                            <span className="text-gray-500">
                                                {item.count.toLocaleString()} <span className="text-xs">({percentage.toFixed(1)}%)</span>
                                            </span>
                                        </div>
                                        <div className="w-full bg-gray-100 rounded-full h-2">
                                            <div
                                                className={`h-2 rounded-full transition-all ${getSourceColor(item.source, index)}`}
                                                style={{ width: `${percentage}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Insight */}
            <Card className="border-0 shadow-xs border-l-4 border-l-blue-500 bg-blue-50/50">
                <CardContent className="p-4">
                    <p className="text-sm text-blue-800">
                        <strong>Tip:</strong> If first-touch and last-touch differ significantly, your customers have a multi-step journey.
                        Consider investing more in top-of-funnel channels that introduce customers to your brand.
                    </p>
                </CardContent>
            </Card>

            <Card className="border-0 shadow-xs overflow-hidden">
                <CardHeader>
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-indigo-500" />
                        Cohort Retention Matrix
                    </CardTitle>
                    <p className="text-xs text-gray-500">Track visitor retention over time by signup week.</p>
                </CardHeader>
                <CardContent className="p-0">
                    {!cohortData || !cohortData.cohorts.length ? (
                        <div className="p-6 text-sm text-gray-500">No cohort data available yet. Check back after a few weeks.</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-gray-50">
                                        <th className="text-left px-4 py-3 font-medium text-gray-600">Cohort</th>
                                        <th className="text-center px-4 py-3 font-medium text-gray-600">Users</th>
                                        <th className="text-center px-4 py-3 font-medium text-gray-600">Week 0</th>
                                        <th className="text-center px-4 py-3 font-medium text-gray-600">Week 1</th>
                                        <th className="text-center px-4 py-3 font-medium text-gray-600">Week 2</th>
                                        <th className="text-center px-4 py-3 font-medium text-gray-600">Week 3</th>
                                        <th className="text-center px-4 py-3 font-medium text-gray-600">Week 4</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {cohortData.cohorts.map((cohort, i) => (
                                        <tr key={cohort.week} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                                            <td className="px-4 py-3 font-medium text-gray-900">{formatWeek(cohort.week)}</td>
                                            <td className="text-center px-4 py-3 text-gray-600">{cohort.totalVisitors}</td>
                                            {[0, 1, 2, 3, 4].map(weekNum => {
                                                const retention = cohort.retention.find(r => r.week === weekNum);
                                                if (!retention) return <td key={weekNum} className="text-center px-4 py-3 text-gray-300">-</td>;
                                                return (
                                                    <td key={weekNum} className="text-center px-2 py-2">
                                                        <span className={`inline-block px-3 py-1 rounded-md text-xs font-medium ${getRetentionColor(retention.rate)}`}>
                                                            {retention.rate}%
                                                        </span>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {cohortData && cohortData.cohorts.length > 0 && (
                <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span>Retention:</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-500 rounded-sm"></span> 70%+</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-400 rounded-sm"></span> 50-69%</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 bg-yellow-400 rounded-sm"></span> 30-49%</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 bg-orange-400 rounded-sm"></span> 15-29%</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-400 rounded-sm"></span> &lt;15%</span>
                </div>
            )}
        </div>
    );
};

export default AttributionPage;
