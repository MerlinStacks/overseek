import React, { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { useAccount } from '../../context/AccountContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { DateRangeFilter } from '../../components/analytics/DateRangeFilter';
import {
    BarChart3, ShoppingCart, TrendingDown, Search,
    ArrowUpRight
} from 'lucide-react';
import FunnelWidget from '../../components/widgets/FunnelWidget';
import AnalyticsStatsWidget from '../../components/widgets/AnalyticsStatsWidget';

interface AbandonmentData {
    addedToCartCount: number;
    purchasedCount: number;
    abandonedCount: number;
    abandonmentRate: number;
}

interface SearchData {
    topQueries: { query: string; count: number }[];
    totalSearches: number;
}

interface ExitData {
    topExitPages: { page: string; count: number }[];
}

export const AnalyticsOverviewPage: React.FC = () => {
    const [days, setDays] = useState(1); // Default to Today
    const { currentAccount } = useAccount();
    const { token } = useAuth();
    const [abandonment, setAbandonment] = useState<AbandonmentData | null>(null);
    const [searches, setSearches] = useState<SearchData | null>(null);
    const [exits, setExits] = useState<ExitData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            if (!currentAccount || !token) return;
            setLoading(true);
            try {
                const [abandonmentRes, searchesRes, exitsRes] = await Promise.all([
                    api.get<AbandonmentData>(`/api/tracking/abandonment?days=${days}`, token, currentAccount.id),
                    api.get<SearchData>(`/api/tracking/searches?days=${days}`, token, currentAccount.id),
                    api.get<ExitData>(`/api/tracking/exits?days=${days}`, token, currentAccount.id)
                ]);
                setAbandonment(abandonmentRes);
                setSearches(searchesRes);
                setExits(exitsRes);
            } catch (error) {
                Logger.error('Failed to fetch overview:', { error: error });
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [currentAccount, token, days]);

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900">Analytics Overview</h1>
                <DateRangeFilter value={days} onChange={setDays} />
            </div>

            {/* Top Row - Funnel & Stats */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="border-0 shadow-xs">
                    <CardHeader>
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                            <TrendingDown className="w-4 h-4 text-green-500" />
                            Conversion Funnel
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <FunnelWidget days={days} />
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-xs">
                    <CardHeader>
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                            <BarChart3 className="w-4 h-4 text-purple-500" />
                            Audience Insights
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <AnalyticsStatsWidget days={days} />
                    </CardContent>
                </Card>
            </div>

            {/* Middle Row - Cart Abandonment */}
            {abandonment && (
                <Card className="border-0 shadow-xs">
                    <CardHeader>
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                            <ShoppingCart className="w-4 h-4 text-orange-500" />
                            Cart Abandonment
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="bg-blue-50 rounded-xl p-4 text-center">
                                <p className="text-2xl font-bold text-blue-600">{abandonment.addedToCartCount}</p>
                                <p className="text-xs text-gray-500">Added to Cart</p>
                            </div>
                            <div className="bg-green-50 rounded-xl p-4 text-center">
                                <p className="text-2xl font-bold text-green-600">{abandonment.purchasedCount}</p>
                                <p className="text-xs text-gray-500">Purchased</p>
                            </div>
                            <div className="bg-orange-50 rounded-xl p-4 text-center">
                                <p className="text-2xl font-bold text-orange-600">{abandonment.abandonedCount}</p>
                                <p className="text-xs text-gray-500">Abandoned</p>
                            </div>
                            <div className="bg-red-50 rounded-xl p-4 text-center">
                                <p className="text-2xl font-bold text-red-600">{abandonment.abandonmentRate}%</p>
                                <p className="text-xs text-gray-500">Abandonment Rate</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Bottom Row - Searches & Exits */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {searches && (
                    <Card className="border-0 shadow-xs">
                        <CardHeader>
                            <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                <Search className="w-4 h-4 text-blue-500" />
                                Top Search Terms
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {searches.topQueries.length === 0 ? (
                                <p className="text-sm text-gray-500 italic">No search data yet</p>
                            ) : (
                                <div className="space-y-2">
                                    {searches.topQueries.slice(0, 8).map((item, i) => (
                                        <div key={item.query} className="flex justify-between text-sm py-1.5 border-b border-gray-50 last:border-0">
                                            <span className="text-gray-700">{item.query}</span>
                                            <span className="text-gray-400">{item.count}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                {exits && (
                    <Card className="border-0 shadow-xs">
                        <CardHeader>
                            <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                <ArrowUpRight className="w-4 h-4 text-red-500" />
                                Top Exit Pages
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {exits.topExitPages.length === 0 ? (
                                <p className="text-sm text-gray-500 italic">No exit data yet</p>
                            ) : (
                                <div className="space-y-2">
                                    {exits.topExitPages.slice(0, 8).map((item, i) => (
                                        <div key={item.page} className="flex justify-between text-sm py-1.5 border-b border-gray-50 last:border-0">
                                            <span className="text-gray-700 truncate max-w-[250px]">{item.page}</span>
                                            <span className="text-gray-400">{item.count}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
};

export default AnalyticsOverviewPage;
