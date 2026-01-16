import React, { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { DateRangeFilter } from '../../components/analytics/DateRangeFilter';
import { GitBranch, ArrowRight } from 'lucide-react';

interface AttributionData {
    firstTouch: { source: string; count: number }[];
    lastTouch: { source: string; count: number }[];
    totalSessions: number;
}

export const AttributionPage: React.FC = () => {
    const [days, setDays] = useState(30);
    const { currentAccount } = useAccount();
    const { token } = useAuth();
    const [data, setData] = useState<AttributionData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            if (!currentAccount || !token) return;
            setLoading(true);
            try {
                const result = await api.get<AttributionData>(`/api/tracking/attribution?days=${days}`, token, currentAccount.id);
                setData(result);
            } catch (error) {
                Logger.error('Failed to fetch attribution:', { error: error });
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

    const getSourceColor = (source: string, index: number) => {
        const colors = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500', 'bg-pink-500', 'bg-yellow-500', 'bg-teal-500'];
        return colors[index % colors.length];
    };

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Attribution Analysis</h1>
                    <p className="text-sm text-gray-500 mt-1">Compare first-touch vs last-touch attribution.</p>
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
        </div>
    );
};

export default AttributionPage;
