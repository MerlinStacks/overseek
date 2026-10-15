import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
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
    AlertCircle
} from 'lucide-react';
import { CampaignProductsPanel } from './CampaignProductsPanel';
import { MetaAdsDrilldown } from './MetaAdsDrilldown';
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

interface SuggestionsPayload {
    suggestions?: string[];
    action_items?: string[];
}

interface GoogleAdsCampaignsProps {
    platform?: string;
    adAccountId: string;
    accountName: string;
    onBack: () => void;
    hideBackButton?: boolean;
    /** Callback to initiate OAuth reconnection when tokens are expired */
    onReconnect?: () => void;
}

export function GoogleAdsCampaigns({ adAccountId, accountName, platform = 'GOOGLE', onBack, hideBackButton, onReconnect }: GoogleAdsCampaignsProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const accountId = currentAccount?.id;
    const [campaigns, setCampaigns] = useState<CampaignInsight[]>([]);
    const [trends, setTrends] = useState<DailyTrend[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState<keyof CampaignInsight>('spend');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [days, setDays] = useState(30);

    // AI Suggestions state
    const [suggestions, setSuggestions] = useState<SuggestionsPayload | null>(null);
    const [loadingSuggestions, setLoadingSuggestions] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(true);
    const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
    const [trendError, setTrendError] = useState(false);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('ALL');

    // Expanded campaigns for product view
    const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(new Set());
    const dataRequest = useRef(0);
    const suggestionsRequest = useRef(0);

    const fetchData = useCallback(async (signal?: AbortSignal) => {
        const request = ++dataRequest.current;
        setIsLoading(true);
        setError(null);
        setCampaigns([]);
        setTrends([]);
        setTrendError(false);
        try {
            const headers = {
                'Authorization': `Bearer ${token}`,
                'X-Account-ID': accountId || ''
            };

            const [campaignsRes, trendsRes] = await Promise.all([
                fetch(`/api/ads/${adAccountId}/campaigns?days=${days}`, { headers, signal }),
                fetch(`/api/ads/${adAccountId}/trends?days=${days}`, { headers, signal })
            ]);

            if (!campaignsRes.ok) {
                const err = await campaignsRes.json();
                throw new Error(err.error || 'Failed to load campaigns');
            }

            const campaignsData = await campaignsRes.json();
            const trendsData = trendsRes.ok ? await trendsRes.json() : [];

            if (signal?.aborted || request !== dataRequest.current) return;
            setTrendError(!trendsRes.ok);
            setCampaigns(campaignsData);
            setTrends(trendsData);
        } catch (err: unknown) {
            if (signal?.aborted || request !== dataRequest.current) return;
            const message = err instanceof Error ? err.message : 'Failed to load campaigns';
            setError(message);
        } finally {
            if (!signal?.aborted && request === dataRequest.current) setIsLoading(false);
        }
    }, [adAccountId, accountId, days, token]);

    const fetchSuggestions = useCallback(async (signal?: AbortSignal) => {
        const request = ++suggestionsRequest.current;
        setLoadingSuggestions(true);
        setSuggestions(null);
        setSuggestionsError(null);
        try {
            const headers = {
                'Authorization': `Bearer ${token}`,
                'X-Account-ID': accountId || ''
            };
            const res = await fetch(`/api/ads/${adAccountId}/analysis?days=${days}`, { headers, signal });
            if (!res.ok) throw new Error('Recommendations could not be loaded. Please retry.');
            const data = await res.json();
            if (!signal?.aborted && request === suggestionsRequest.current) setSuggestions(data);
        } catch (err) {
            if (signal?.aborted || request !== suggestionsRequest.current) return;
            setSuggestionsError('Recommendations could not be loaded. Please retry.');
            Logger.error('Failed to fetch suggestions', { error: err });
        } finally {
            if (!signal?.aborted && request === suggestionsRequest.current) setLoadingSuggestions(false);
        }
    }, [adAccountId, accountId, days, token]);

    useEffect(() => {
        const controller = new AbortController();
        fetchData(controller.signal);
        return () => { controller.abort(); dataRequest.current++; };
    }, [fetchData]);

    useEffect(() => {
        const controller = new AbortController();
        fetchSuggestions(controller.signal);
        return () => { controller.abort(); suggestionsRequest.current++; };
    }, [fetchSuggestions]);

    function handleSort(column: keyof CampaignInsight) {
        if (sortBy === column) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(column);
            setSortOrder('desc');
        }
    }

    function toggleCampaign(campaignId: string) {
        setExpandedCampaigns(previous => {
            const next = new Set(previous);
            if (next.has(campaignId)) next.delete(campaignId);
            else next.add(campaignId);
            return next;
        });
    }

    const sortedCampaigns = campaigns.filter(c =>
        c.campaignName.toLowerCase().includes(search.toLowerCase()) &&
        (statusFilter === 'ALL' || c.status === statusFilter)
    ).sort((a, b) => {
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
                        aria-label="Reporting period"
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
                        onClick={() => { void fetchData(); void fetchSuggestions(); }}
                        aria-label="Refresh performance"
                        className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                    >
                        <RefreshCw size={18} />
                    </button>
                </div>
            </div>

            {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2">
                        <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={18} />
                        <div>
                            <p className="font-medium text-red-700">Failed to load campaign data</p>
                            <p className="text-sm text-red-600 mt-0.5">{error}</p>
                        </div>
                    </div>
                    {onReconnect && (
                        <button
                            onClick={onReconnect}
                            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 shrink-0"
                        >
                            <RefreshCw size={14} />
                            Reconnect
                        </button>
                    )}
                </div>
            )}

            {!error && <>
            {/* Recommendations are scoped to the selected account and reporting period. */}
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
                            <h3 className="font-semibold text-gray-900">Performance Recommendations</h3>
                            <p className="text-sm text-gray-600">Rule-based insights for {accountName} · Last {days} days</p>
                        </div>
                    </button>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => void fetchSuggestions()}
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

                {showSuggestions && loadingSuggestions && <p className="px-4 pb-4 text-sm text-gray-500" role="status">Loading recommendations...</p>}
                {showSuggestions && suggestionsError && <p className="px-4 pb-4 text-sm text-red-600" role="alert">{suggestionsError}</p>}
                {showSuggestions && !suggestionsError && !loadingSuggestions && !suggestions?.suggestions?.length && (
                    <div className="px-4 pb-4">
                        <p className="text-gray-500 text-sm">No suggestions available. Try refreshing the data.</p>
                    </div>
                )}
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-4">
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
                        {platform === 'META' ? 'Purchases' : 'Conversions'}
                    </div>
                    <div className="text-2xl font-bold text-gray-900">
                        {formatNumber(totals.conversions)}
                    </div>
                </div>
                <div className="bg-white p-4 rounded-xl border shadow-xs">
                    <div className="text-gray-500 text-xs uppercase mb-1">{platform === 'META' ? 'Purchase Revenue' : 'Conversion Value'}</div>
                    <div className="text-2xl font-bold text-gray-900">{formatCurrency(totals.conversionsValue, campaigns[0]?.currency)}</div>
                </div>
                <div className="bg-white p-4 rounded-xl border shadow-xs">
                    <div className="text-gray-500 text-xs uppercase mb-1">{platform === 'META' ? 'Cost per Purchase' : 'Cost per Conversion'}</div>
                    <div className="text-2xl font-bold text-gray-900">{totals.conversions > 0 ? formatCurrency(totals.spend / totals.conversions, campaigns[0]?.currency) : '—'}</div>
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
            <div className="flex flex-wrap items-center gap-3">
                <input aria-label="Search campaigns" placeholder="Search campaigns..." value={search} onChange={e => setSearch(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
                <select aria-label="Filter campaign status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-3 py-2 border rounded-lg text-sm">
                    <option value="ALL">All statuses</option>
                    {[...new Set(campaigns.map(c => c.status))].sort().map(status => <option key={status} value={status}>{status}</option>)}
                </select>
                <span className="text-sm text-gray-500">{sortedCampaigns.length} of {campaigns.length} campaigns · Totals include all returned campaigns{platform === 'META' ? ' with reporting activity · Current delivery status' : ''}</span>
            </div>
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
                                            onClick={() => toggleCampaign(campaign.campaignId)}
                                        >
                                            <td className="px-2 py-3 text-gray-400">
                                                <button
                                                    type="button"
                                                    aria-label={`Expand ${campaign.campaignName}`}
                                                    aria-expanded={isExpanded}
                                                    onClick={event => {
                                                        event.stopPropagation();
                                                        toggleCampaign(campaign.campaignId);
                                                    }}
                                                >
                                                <ChevronRight
                                                    size={16}
                                                    className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                                />
                                                </button>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="font-medium text-gray-900 truncate max-w-xs" title={campaign.campaignName}>
                                                    {campaign.campaignName}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`px-2 py-1 text-xs rounded-full ${['ENABLED', 'ACTIVE'].includes(campaign.status)
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
                                                    {platform === 'META' ? <MetaAdsDrilldown adAccountId={adAccountId} parentId={campaign.campaignId} level="adset" days={days} /> : <CampaignProductsPanel
                                                        adAccountId={adAccountId}
                                                        campaignId={campaign.campaignId}
                                                        days={days}
                                                    />}
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
            {trendError && <p role="alert" className="text-sm text-amber-700">Daily trends could not be loaded. Campaign metrics are still available; refresh to retry.</p>}
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
            </>}
        </div>
    );
}
