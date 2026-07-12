import { useCallback, useEffect, useState } from 'react';
import { Megaphone, MousePointerClick, ShoppingBag } from 'lucide-react';
import { WidgetProps } from './WidgetRegistry';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { api } from '../../services/api';
import { Logger } from '../../utils/logger';
import { WidgetEmptyState, WidgetErrorState, WidgetLoadingState } from './WidgetState';
import {
    widgetCardClass,
    widgetHeaderIconBadgeClass,
    widgetHeaderRowClass,
    widgetListRowClass,
    widgetMicroLabelClass,
    widgetTitleClass
} from './widgetStyles';

interface UtmCampaign {
    campaign: string;
    traffic: number;
    conversions: number;
    conversionRate: number;
}

interface UtmCampaignsResponse {
    campaigns: UtmCampaign[];
    totalTraffic: number;
    totalConversions: number;
}

function formatRate(value: number) {
    return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

export function UtmCampaignsWidget({ className, dateRange }: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [data, setData] = useState<UtmCampaignsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchCampaigns = useCallback(async () => {
        if (!currentAccount || !token) return;

        setLoading(true);
        setError(null);

        try {
            const params = new URLSearchParams({
                startDate: dateRange.startDate,
                endDate: dateRange.endDate,
                limit: '8'
            });
            const response = await api.get<UtmCampaignsResponse>(`/api/analytics/utm-campaigns?${params.toString()}`, token, currentAccount.id);
            setData(response);
        } catch (err) {
            Logger.error('Failed to fetch UTM campaigns', { error: err });
            setError('Failed to load UTM campaigns');
        } finally {
            setLoading(false);
        }
    }, [currentAccount, dateRange.endDate, dateRange.startDate, token]);

    useEffect(() => {
        fetchCampaigns();
    }, [fetchCampaigns]);

    const maxTraffic = Math.max(...(data?.campaigns.map((campaign) => campaign.traffic) || [1]), 1);

    return (
        <div className={`${widgetCardClass} h-full w-full p-5 flex flex-col overflow-hidden ${className || ''}`}>
            <div className={widgetHeaderRowClass}>
                <div>
                    <h3 className={widgetTitleClass}>UTM Campaigns</h3>
                    <p className={widgetMicroLabelClass}>Traffic and conversions for selected dates</p>
                </div>
                <div className={`${widgetHeaderIconBadgeClass} bg-gradient-to-br from-cyan-400 to-blue-600 shadow-blue-500/20`}>
                    <Megaphone size={16} />
                </div>
            </div>

            {loading ? (
                <WidgetLoadingState message="Loading campaigns..." className="flex-1" />
            ) : error ? (
                <WidgetErrorState message={error} onRetry={fetchCampaigns} className="flex-1" />
            ) : !data || data.campaigns.length === 0 ? (
                <WidgetEmptyState message="No UTM campaign traffic found" className="flex-1" />
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                        <div className="rounded-xl bg-blue-50 p-3 dark:bg-blue-500/10">
                            <div className="flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-300">
                                <MousePointerClick size={13} /> Traffic
                            </div>
                            <div className="mt-1 text-2xl font-bold text-blue-700 dark:text-blue-200">
                                {data.totalTraffic.toLocaleString()}
                            </div>
                        </div>
                        <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-500/10">
                            <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-300">
                                <ShoppingBag size={13} /> Conversions
                            </div>
                            <div className="mt-1 text-2xl font-bold text-emerald-700 dark:text-emerald-200">
                                {data.totalConversions.toLocaleString()}
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-2">
                        {data.campaigns.map((campaign, index) => (
                            <div key={campaign.campaign} className={`${widgetListRowClass} bg-slate-50/70 dark:bg-slate-900/25`}>
                                <div className="flex items-center justify-between gap-3 text-sm">
                                    <div className="min-w-0">
                                        <div className="font-medium text-slate-900 dark:text-white truncate" title={campaign.campaign}>
                                            {index + 1}. {campaign.campaign}
                                        </div>
                                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                                            <div
                                                className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500"
                                                style={{ width: `${Math.max((campaign.traffic / maxTraffic) * 100, 4)}%` }}
                                            />
                                        </div>
                                    </div>
                                    <div className="shrink-0 text-right">
                                        <div className="font-semibold text-slate-700 dark:text-slate-200">
                                            {campaign.traffic.toLocaleString()} / {campaign.conversions.toLocaleString()}
                                        </div>
                                        <div className={widgetMicroLabelClass}>{formatRate(campaign.conversionRate)} CVR</div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
