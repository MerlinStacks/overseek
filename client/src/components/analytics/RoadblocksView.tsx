/**
 * RoadblocksView Component
 * Displays pages where visitors with cart value exit, indicating friction points
 */

import { useState, useEffect } from 'react';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { AlertTriangle, TrendingDown, DollarSign, ExternalLink } from 'lucide-react';
import { getDateRange } from '../../utils/dateUtils';
import { formatCurrency } from '../../utils/format';

interface RoadblockPage {
    url: string;
    pageTitle: string;
    totalVisits: number;
    exits: number;
    exitRate: number;
    avgCartValue: number;
    potentialRevenueLost: number;
}

interface FunnelStage {
    stage: string;
    count: number;
    dropOff: number | null;
}

interface RoadblocksViewProps {
    dateRange: string;
}

export const RoadblocksView = ({ dateRange }: RoadblocksViewProps) => {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [roadblocks, setRoadblocks] = useState<RoadblockPage[]>([]);
    const [funnel, setFunnel] = useState<{ funnel: FunnelStage[]; overallConversionRate: number } | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!token || !currentAccount) return;
        fetchData();
    }, [token, currentAccount, dateRange]);

    const fetchData = async () => {
        setLoading(true);
        try {
            // Use shared date utility for consistent timezone handling
            const range = getDateRange(dateRange as any);

            const [roadblocksRes, funnelRes] = await Promise.all([
                fetch(`/api/analytics/behaviour/roadblocks?startDate=${range.startDate}&endDate=${range.endDate}`, {
                    headers: { Authorization: `Bearer ${token}`, 'x-account-id': currentAccount!.id }
                }),
                fetch(`/api/analytics/behaviour/funnel-dropoff?startDate=${range.startDate}&endDate=${range.endDate}`, {
                    headers: { Authorization: `Bearer ${token}`, 'x-account-id': currentAccount!.id }
                })
            ]);

            if (roadblocksRes.ok) setRoadblocks(await roadblocksRes.json());
            if (funnelRes.ok) setFunnel(await funnelRes.json());
        } catch (e) {
            Logger.error('Failed to fetch roadblocks:', { error: e });
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-5">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-red-50 rounded-lg">
                            <AlertTriangle className="w-5 h-5 text-red-500" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-gray-900">{roadblocks.length}</p>
                            <p className="text-sm text-gray-500">Friction Points</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-5">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-orange-50 rounded-lg">
                            <DollarSign className="w-5 h-5 text-orange-500" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-gray-900">
                                {formatCurrency(roadblocks.reduce((sum, r) => sum + r.potentialRevenueLost, 0))}
                            </p>
                            <p className="text-sm text-gray-500">Potential Lost Revenue</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-5">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-green-50 rounded-lg">
                            <TrendingDown className="w-5 h-5 text-green-500" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-gray-900">
                                {funnel?.overallConversionRate ?? 0}%
                            </p>
                            <p className="text-sm text-gray-500">Overall Conversion Rate</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Drop-off Funnel */}
            {funnel && funnel.funnel.length > 0 && (
                <div className="bg-white rounded-xl shadow-xs border border-gray-200 p-5">
                    <h3 className="text-sm font-semibold text-gray-900 mb-4">Checkout Funnel Drop-off</h3>
                    <div className="flex items-end justify-between gap-4 h-32">
                        {funnel.funnel.map((stage, i) => {
                            const maxCount = Math.max(...funnel.funnel.map(s => s.count));
                            const height = maxCount > 0 ? (stage.count / maxCount) * 100 : 0;
                            return (
                                <div key={stage.stage} className="flex-1 flex flex-col items-center">
                                    <div
                                        className="w-full bg-linear-to-t from-blue-500 to-blue-400 rounded-t-md transition-all"
                                        style={{ height: `${Math.max(height, 5)}%` }}
                                    />
                                    <div className="mt-2 text-center">
                                        <p className="text-xs font-medium text-gray-700">{stage.stage}</p>
                                        <p className="text-sm font-bold text-gray-900">{stage.count.toLocaleString()}</p>
                                        {stage.dropOff !== null && (
                                            <p className="text-xs text-red-500">↓ {stage.dropOff}%</p>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Roadblock Pages Table */}
            <div className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                    <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                        High-Exit Pages with Cart Value
                    </h3>
                    <p className="text-xs text-gray-500 mt-1">Pages where visitors with items in cart left without buying</p>
                </div>
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 text-gray-500 border-b border-gray-100">
                        <tr>
                            <th className="p-4">Page</th>
                            <th className="p-4 text-right">Visits</th>
                            <th className="p-4 text-right">Exit Rate</th>
                            <th className="p-4 text-right">Avg Cart</th>
                            <th className="p-4 text-right">Lost Revenue</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {roadblocks.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="p-8 text-center text-gray-500">
                                    <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                                    No roadblocks detected. Great news!
                                </td>
                            </tr>
                        ) : (
                            roadblocks.map((page, i) => (
                                <tr key={i} className="hover:bg-gray-50">
                                    <td className="p-4">
                                        <div className="font-medium text-gray-900 truncate max-w-xs" title={page.url}>
                                            {page.pageTitle || page.url}
                                        </div>
                                        <div className="text-xs text-gray-400 truncate max-w-xs flex items-center gap-1">
                                            {page.url}
                                            <ExternalLink className="w-3 h-3" />
                                        </div>
                                    </td>
                                    <td className="p-4 text-right text-gray-600">{page.totalVisits.toLocaleString()}</td>
                                    <td className="p-4 text-right">
                                        <span className={`font-medium ${page.exitRate > 70 ? 'text-red-600' : page.exitRate > 50 ? 'text-orange-500' : 'text-gray-600'}`}>
                                            {page.exitRate}%
                                        </span>
                                    </td>
                                    <td className="p-4 text-right text-gray-600">{formatCurrency(page.avgCartValue)}</td>
                                    <td className="p-4 text-right font-semibold text-red-600">
                                        {formatCurrency(page.potentialRevenueLost)}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
