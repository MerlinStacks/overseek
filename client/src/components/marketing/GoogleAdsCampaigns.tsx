import { Fragment, useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { Logger } from '../../utils/logger';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import {
    TrendingUp,
    TrendingDown,
    Loader2,
    ChevronLeft,
    ChevronRight,
    DollarSign,
    MousePointerClick,
    Eye,
    Target,
    RefreshCw,
    Lightbulb,
    ChevronDown,
    ChevronUp,
    MessageCirclePlus
} from 'lucide-react';
import { AdContextModal } from './AdContextModal';
import { CampaignProductsPanel } from './CampaignProductsPanel';
import { formatCurrency, formatCompact } from '../../utils/format';

interface CampaignInsight {
    campaignId: string;
    campaignName: string;
    status: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionsValue: number;
    roas: number;
    ctr: number;
    cpc: number;
    cpa: number;
    currency: string;
    dateStart: string;
    dateStop: string;
}

interface DailyTrend {
    date: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionsValue: number;
}

interface GoogleAdsCampaignsProps {
    adAccountId: string;
    accountName: string;
    onBack: () => void;
    hideBackButton?: boolean;
}

export function GoogleAdsCampaigns({ adAccountId, accountName, onBack, hideBackButton }: GoogleAdsCampaignsProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const [campaigns, setCampaigns] = useState<CampaignInsight[]>([]);
    const [trends, setTrends] = useState<DailyTrend[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState<keyof CampaignInsight>('spend');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [days, setDays] = useState(30);

    // AI Suggestions state
    const [suggestions, setSuggestions] = useState<any>(null);
    const [loadingSuggestions, setLoadingSuggestions] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(true);
    const [showContextModal, setShowContextModal] = useState(false);

    // Expanded campaigns for product view
    const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(new Set());

    useEffect(() => {
        fetchData();
    }, [adAccountId, days]);

    async function fetchData() {
        setIsLoading(true);
        setError(null);
        try {
            const headers = {
                'Authorization': `Bearer ${token}`,
                'X-Account-ID': currentAccount?.id || ''
            };

            const [campaignsRes, trendsRes] = await Promise.all([
                fetch(`/api/ads/${adAccountId}/campaigns?days=${days}`, { headers }),
                fetch(`/api/ads/${adAccountId}/trends?days=${days}`, { headers })
            ]);

            if (!campaignsRes.ok) {
                const err = await campaignsRes.json();
                throw new Error(err.error || 'Failed to load campaigns');
            }

            const campaignsData = await campaignsRes.json();
            const trendsData = trendsRes.ok ? await trendsRes.json() : [];

            setCampaigns(campaignsData);
            setTrends(trendsData);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }

    async function fetchSuggestions() {
        setLoadingSuggestions(true);
        try {
            const headers = {
                'Authorization': `Bearer ${token}`,
                'X-Account-ID': currentAccount?.id || ''
            };
            const res = await fetch(`/api/ads/${adAccountId}/analysis`, { headers });
            if (res.ok) {
                const data = await res.json();
                setSuggestions(data);
            }
        } catch (err) {
            Logger.error('Failed to fetch suggestions', { error: err });
        } finally {
            setLoadingSuggestions(false);
        }
    }

    useEffect(() => {
        fetchSuggestions();
    }, [adAccountId]);

    function handleSort(column: keyof CampaignInsight) {
        if (sortBy === column) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(column);
            setSortOrder('desc');
        }
    }

    const sortedCampaigns = [...campaigns].sort((a, b) => {
        const aVal = a[sortBy];
        const bVal = b[sortBy];
        if (typeof aVal === 'number' && typeof bVal === 'number') {
            return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
        }
        return sortOrder === 'asc'
            ? String(aVal).localeCompare(String(bVal))
            : String(bVal).localeCompare(String(aVal));
    });

    const totals = campaigns.reduce((acc, c) => ({
        spend: acc.spend + (c.spend || 0),
        impressions: acc.impressions + (c.impressions || 0),
        clicks: acc.clicks + (c.clicks || 0),
        conversions: acc.conversions + (c.conversions || 0),
        conversionsValue: acc.conversionsValue + (c.conversionsValue || 0)
    }), { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionsValue: 0 });

    const formatNumber = (v: number) => formatCompact(v);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    {!hideBackButton && (
                        <button
                            onClick={onBack}
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            <ChevronLeft size={20} />
                        </button>
                    )}
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">{accountName}</h2>
                        <p className="text-sm text-gray-500">Campaign Performance Breakdown</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <select
                        value={days}
                        onChange={(e) => setDays(Number(e.target.value))}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    >
                        <option value={7}>Last 7 days</option>
                        <option value={14}>Last 14 days</option>
                        <option value={30}>Last 30 days</option>
                        <option value={60}>Last 60 days</option>
                        <option value={90}>Last 90 days</option>
                    </select>
                    <button
                        onClick={fetchData}
                        className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                    >
                        <RefreshCw size={18} />
                    </button>
                </div>
            </div>

            {error && (
                <div className="p-4 bg-red-50 text-red-700 rounded-lg">
                    {error}
                </div>
            )}

            {/* AI Suggestions Panel - at top for prominence */}
            <div className="bg-linear-to-r from-purple-50 to-indigo-50 rounded-xl border border-purple-200 shadow-xs overflow-hidden">
                <div className="p-4 flex items-center justify-between">
                    <button
                        onClick={() => setShowSuggestions(!showSuggestions)}
                        className="flex items-center gap-3 hover:opacity-80 transition-opacity"
                    >
                        <div className="p-2 bg-purple-500 rounded-lg">
                            <Lightbulb size={20} className="text-white" />
                        </div>
                        <div className="text-left">
                            <h3 className="font-semibold text-gray-900">AI Optimization Suggestions</h3>
                            <p className="text-sm text-gray-600">Smart recommendations based on your campaign data</p>
                        </div>
                    </button>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowContextModal(true)}
                            className="p-2 text-purple-600 hover:bg-purple-100 rounded-lg transition-colors"
                            title="Add business context"
                        >
                            <MessageCirclePlus size={18} />
                        </button>
                        <button
                            onClick={fetchSuggestions}
                            disabled={loadingSuggestions}
                            className="p-2 text-purple-600 hover:bg-purple-100 rounded-lg transition-colors disabled:opacity-50"
                            title="Refresh suggestions"
                        >
                            <RefreshCw size={18} className={loadingSuggestions ? 'animate-spin' : ''} />
                        </button>
                        <button
                            onClick={() => setShowSuggestions(!showSuggestions)}
                            className="p-2 text-gray-500 hover:bg-purple-100 rounded-lg transition-colors"
                        >
                            {showSuggestions ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                        </button>
                    </div>
                </div>

                {showSuggestions && suggestions && (
                    <div className="px-4 pb-4 space-y-3">
                        {suggestions.suggestions?.map((suggestion: string, i: number) => (
                            <div key={i} className="bg-white p-4 rounded-lg border border-purple-100">
                                <p className="text-gray-800" dangerouslySetInnerHTML={{
                                    __html: DOMPurify.sanitize(
                                        suggestion.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'),
                                        { ALLOWED_TAGS: ['strong', 'b', 'em', 'i'] }
                                    )
                                }} />
                            </div>
                        ))}

                        {suggestions.action_items && suggestions.action_items.length > 0 && (
                            <div className="bg-white p-4 rounded-lg border border-purple-100">
                                <h4 className="font-medium text-gray-900 mb-2">Quick Action Items:</h4>
                                <ul className="space-y-1">
                                    {suggestions.action_items.map((item: string, i: number) => (
                                        <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                                            <span className="text-purple-500 mt-1">•</span>
                                            {item}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                )}

                {showSuggestions && !suggestions && !loadingSuggestions && (
                    <div className="px-4 pb-4">
                        <p className="text-gray-500 text-sm">No suggestions available. Try refreshing the data.</p>
                    </div>
                )}
            </div>

            {/* Context Modal */}
            <AdContextModal
                isOpen={showContextModal}
                onClose={() => setShowContextModal(false)}
                onSaved={fetchSuggestions}
            />

            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-white p-4 rounded-xl border shadow-xs">
                    <div className="flex items-center gap-2 text-gray-500 text-xs uppercase mb-1">
                        <DollarSign size={14} />
                        Total Spend
                    </div>
                    <div className="text-2xl font-bold text-gray-900">
                        {formatCurrency(totals.spend, campaigns[0]?.currency)}
                    </div>
                </div>
                <div className="bg-white p-4 rounded-xl border shadow-xs">
                    <div className="flex items-center gap-2 text-gray-500 text-xs uppercase mb-1">
                        <Eye size={14} />
                        Impressions
                    </div>
                    <div className="text-2xl font-bold text-gray-900">
                        {formatNumber(totals.impressions)}
                    </div>
                </div>
                <div className="bg-white p-4 rounded-xl border shadow-xs">
                    <div className="flex items-center gap-2 text-gray-500 text-xs uppercase mb-1">
                        <MousePointerClick size={14} />
                        Clicks
                    </div>
                    <div className="text-2xl font-bold text-gray-900">
                        {formatNumber(totals.clicks)}
                    </div>
                </div>
                <div className="bg-white p-4 rounded-xl border shadow-xs">
                    <div className="flex items-center gap-2 text-gray-500 text-xs uppercase mb-1">
                        <Target size={14} />
                        Conversions
                    </div>
                    <div className="text-2xl font-bold text-gray-900">
                        {formatNumber(totals.conversions)}
                    </div>
                </div>
                <div className="bg-white p-4 rounded-xl border shadow-xs">
                    <div className="flex items-center gap-2 text-gray-500 text-xs uppercase mb-1">
                        <TrendingUp size={14} />
                        ROAS
                    </div>
                    <div className="text-2xl font-bold text-gray-900">
                        {totals.spend > 0 ? (totals.conversionsValue / totals.spend).toFixed(2) : '0.00'}x
                    </div>
                </div>
            </div>

            {/* Campaigns Table */}
            <div className="bg-white rounded-xl border shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="w-8"></th>
                                {[
                                    { key: 'campaignName', label: 'Campaign' },
                                    { key: 'status', label: 'Status' },
                                    { key: 'spend', label: 'Spend' },
                                    { key: 'impressions', label: 'Impressions' },
                                    { key: 'clicks', label: 'Clicks' },
                                    { key: 'ctr', label: 'CTR' },
                                    { key: 'cpc', label: 'CPC' },
                                    { key: 'conversions', label: 'Conv.' },
                                    { key: 'roas', label: 'ROAS' }
                                ].map(col => (
                                    <th
                                        key={col.key}
                                        onClick={() => handleSort(col.key as keyof CampaignInsight)}
                                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                    >
                                        <div className="flex items-center gap-1">
                                            {col.label}
                                            {sortBy === col.key && (
                                                sortOrder === 'desc' ? <TrendingDown size={12} /> : <TrendingUp size={12} />
                                            )}
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {sortedCampaigns.length === 0 ? (
                                <tr>
                                    <td colSpan={10} className="px-4 py-8 text-center text-gray-500">
                                        No campaigns found for this period
                                    </td>
                                </tr>
                            ) : sortedCampaigns.map(campaign => {
                                const isExpanded = expandedCampaigns.has(campaign.campaignId);
                                return (
                                    <Fragment key={campaign.campaignId}>
                                        <tr
                                            className={`hover:bg-gray-50 cursor-pointer ${isExpanded ? 'bg-blue-50' : ''}`}
                                            onClick={() => {
                                                const newExpanded = new Set(expandedCampaigns);
                                                if (isExpanded) {
                                                    newExpanded.delete(campaign.campaignId);
                                                } else {
                                                    newExpanded.add(campaign.campaignId);
                                                }
                                                setExpandedCampaigns(newExpanded);
                                            }}
                                        >
                                            <td className="px-2 py-3 text-gray-400">
                                                <ChevronRight
                                                    size={16}
                                                    className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                                />
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="font-medium text-gray-900 truncate max-w-xs" title={campaign.campaignName}>
                                                    {campaign.campaignName}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-1 text-xs rounded-full ${campaign.status === 'ENABLED'
                                                    ? 'bg-green-100 text-green-800'
                                                    : 'bg-gray-100 text-gray-600'
                                                    }`}>
                                                    {campaign.status}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 font-medium">
                                                {formatCurrency(campaign.spend, campaign.currency)}
                                            </td>
                                            <td className="px-4 py-3 text-gray-600">
                                                {formatNumber(campaign.impressions)}
                                            </td>
                                            <td className="px-4 py-3 text-gray-600">
                                                {formatNumber(campaign.clicks)}
                                            </td>
                                            <td className="px-4 py-3 text-gray-600">
                                                {(campaign.ctr || 0).toFixed(2)}%
                                            </td>
                                            <td className="px-4 py-3 text-gray-600">
                                                {formatCurrency(campaign.cpc || 0, campaign.currency)}
                                            </td>
                                            <td className="px-4 py-3 text-gray-600">
                                                {(campaign.conversions || 0).toFixed(0)}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`font-medium ${(campaign.roas || 0) >= 3 ? 'text-green-600' :
                                                    (campaign.roas || 0) >= 1 ? 'text-yellow-600' :
                                                        'text-red-600'
                                                    }`}>
                                                    {(campaign.roas || 0).toFixed(2)}x
                                                </span>
                                            </td>
                                        </tr>
                                        {isExpanded && (
                                            <tr key={`${campaign.campaignId}-products`}>
                                                <td colSpan={10} className="p-0">
                                                    <CampaignProductsPanel
                                                        adAccountId={adAccountId}
                                                        campaignId={campaign.campaignId}
                                                        days={days}
                                                    />
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Daily Trend Chart (Simple Bar Chart) */}
            {trends.length > 0 && (
                <div className="bg-white rounded-xl border shadow-xs p-6">
                    <h3 className="text-lg font-semibold mb-4">Daily Spend Trend</h3>
                    <div className="flex items-end gap-1 h-40">
                        {trends.map((day, i) => {
                            const maxSpend = Math.max(...trends.map(t => t.spend));
                            const height = maxSpend > 0 ? (day.spend / maxSpend) * 100 : 0;
                            return (
                                <div
                                    key={i}
                                    className="flex-1 bg-blue-500 rounded-t hover:bg-blue-600 transition-colors cursor-pointer group relative"
                                    style={{ height: `${height}%`, minHeight: day.spend > 0 ? '4px' : '0' }}
                                    title={`${day.date}: ${formatCurrency(day.spend, campaigns[0]?.currency)}`}
                                >
                                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded-sm opacity-0 group-hover:opacity-100 whitespace-nowrap z-10">
                                        {day.date}<br />
                                        {formatCurrency(day.spend, campaigns[0]?.currency)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div className="flex justify-between text-xs text-gray-500 mt-2">
                        <span>{trends[0]?.date}</span>
                        <span>{trends[trends.length - 1]?.date}</span>
                    </div>
                </div>
            )}
        </div>
    );
}

