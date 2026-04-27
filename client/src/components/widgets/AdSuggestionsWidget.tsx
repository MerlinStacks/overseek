import { useState, useCallback } from 'react';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';
import { Lightbulb, TrendingUp, CheckCircle, ExternalLink, RefreshCw, MessageCirclePlus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAccount } from '../../context/AccountContext';
import { useNavigate } from 'react-router-dom';
import { WidgetProps } from './WidgetRegistry';
import { AdContextModal } from '../marketing/AdContextModal';
import { widgetGlassCardClass, widgetTitleClass, widgetHeaderRowClass, widgetHeaderIconBadgeClass } from './widgetStyles';

interface AdSuggestionsData {
    suggestions: string[];
    action_items: string[];
    summary?: Record<string, unknown>;
    message?: string;
}

/**
 * Widget displaying AI-powered ad optimization suggestions.
 * Shows top recommendations from Google and Meta Ads analysis.
 */
export function AdSuggestionsWidget(_props: WidgetProps) {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const navigate = useNavigate();

    const [data, setData] = useState<AdSuggestionsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showContextModal, setShowContextModal] = useState(false);

    const fetchSuggestions = useCallback(async (isRefresh = false) => {
        if (!currentAccount || !token) return;

        if (isRefresh) setRefreshing(true);

        try {
            const res = await fetch('/api/dashboard/ad-suggestions', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                const result = await res.json() as AdSuggestionsData;
                setData(result);
                setError(null);
            } else {
                setError('Failed to load suggestions');
            }
        } catch (err) {
            setError('Failed to load suggestions');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [currentAccount, token]);

    useVisibilityPolling(fetchSuggestions, 300000, [fetchSuggestions], 'ad-suggestions');

    const getSuggestionIcon = (suggestion: string) => {
        const normalized = suggestion.toLowerCase();
        if (normalized.includes('underperforming') || normalized.includes('declining') || normalized.includes('drop')) {
            return <TrendingUp size={16} className="text-red-500 shrink-0" />;
        }
        if (normalized.includes('high performer') || normalized.includes('best') || normalized.includes('winning')) {
            return <TrendingUp size={16} className="text-green-500 shrink-0" />;
        }
        if (normalized.includes('complete') || normalized.includes('done')) {
            return <CheckCircle size={16} className="text-green-500 shrink-0" />;
        }
        return <Lightbulb size={16} className="text-amber-500 shrink-0" />;
    };

    const cleanSuggestion = (text: string) => {
        return text
            .replace(/[\u{1F534}\u{1F7E2}\u{1F4CA}\u{1F4B0}\u{1F680}\u{1F4C1}\u{2705}\u{1F6D2}\u{1F50D}\u{2B50}]/gu, '')
            .replace(/\*\*/g, '')
            .trim();
    };

    const handleNavigate = () => {
        navigate('/marketing/ai');
    };

    if (loading) {
        return (
            <div className={`${widgetGlassCardClass} p-6 h-full flex items-center justify-center`}>
                <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
            </div>
        );
    }

    if (data?.message) {
        return (
            <div className={`${widgetGlassCardClass} p-6 h-full flex flex-col`}>
                <div className={`${widgetHeaderRowClass} justify-start gap-2`}>
                    <div className={`${widgetHeaderIconBadgeClass} bg-gradient-to-br from-amber-400 to-orange-500 shadow-amber-500/20`}>
                        <Lightbulb size={16} />
                    </div>
                    <h3 className={widgetTitleClass}>Ad Suggestions</h3>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
                    <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-3">
                        <Lightbulb size={24} className="text-gray-400" />
                    </div>
                    <p className="text-sm text-gray-500">{data.message}</p>
                    <button
                        onClick={handleNavigate}
                        className="mt-4 text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                    >
                        Connect Ads <ExternalLink size={14} />
                    </button>
                </div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className={`${widgetGlassCardClass} p-6 h-full flex flex-col items-center justify-center`}>
                <p className="text-sm text-gray-500">{error || 'No data available'}</p>
            </div>
        );
    }

    return (
        <div className={`${widgetGlassCardClass} p-6 h-full flex flex-col overflow-hidden`}>
            <div className={widgetHeaderRowClass}>
                <div className="flex items-center gap-2">
                    <div className={`${widgetHeaderIconBadgeClass} bg-gradient-to-br from-amber-400 to-orange-500 shadow-amber-500/20`}>
                        <Lightbulb size={16} />
                    </div>
                    <h3 className={widgetTitleClass}>Ad Suggestions</h3>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setShowContextModal(true)}
                        className="p-1.5 text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                        title="Add business context"
                    >
                        <MessageCirclePlus size={16} />
                    </button>
                    <button
                        onClick={() => fetchSuggestions(true)}
                        disabled={refreshing}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                        title="Refresh suggestions"
                    >
                        <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                    </button>
                    <button
                        onClick={handleNavigate}
                        className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 ml-1"
                    >
                        View All <ExternalLink size={12} />
                    </button>
                </div>
            </div>

            <AdContextModal
                isOpen={showContextModal}
                onClose={() => setShowContextModal(false)}
                onSaved={() => fetchSuggestions(true)}
            />

            <div className="flex-1 space-y-3 overflow-y-auto">
                {data.suggestions.slice(0, 4).map((suggestion, idx) => (
                    <div
                        key={idx}
                        className="flex items-start gap-2 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                        {getSuggestionIcon(suggestion)}
                        <p className="text-sm text-gray-700 line-clamp-2">
                            {cleanSuggestion(suggestion)}
                        </p>
                    </div>
                ))}
            </div>

            {data.action_items && data.action_items.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                    <p className="text-xs font-medium text-gray-500 mb-2">TOP ACTIONS</p>
                    <div className="flex flex-wrap gap-2">
                        {data.action_items.slice(0, 3).map((item, idx) => (
                            <span
                                key={idx}
                                className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-full"
                            >
                                {item.replace(/^\d+\.\s*/, '')}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
