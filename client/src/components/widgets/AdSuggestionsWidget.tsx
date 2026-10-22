import { useState, useCallback, useEffect, useRef } from 'react';
import { usePermissions } from '../../hooks/usePermissions';
import { useVisibilityPolling } from '../../hooks/useVisibilityPolling';
import { Lightbulb, TrendingUp, ExternalLink, RefreshCw, MessageCirclePlus } from 'lucide-react';
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
    availability?: { optimizer: boolean; pipeline: boolean };
}

/**
 * Widget displaying AI-powered ad optimization suggestions.
 * Shows top recommendations from Google and Meta Ads analysis.
 */
export function AdSuggestionsWidget(_props: WidgetProps) {
    const { user, token } = useAuth(); const { currentAccount } = useAccount();
    const { hasPermission } = usePermissions();
    if (!token || !currentAccount) return <p role="status">Select an account to load suggestions.</p>;
    if (!hasPermission('view_marketing')) return <p role="status">Marketing view permission required.</p>;
    return <ScopedAdSuggestionsWidget key={JSON.stringify([user?.id, token, currentAccount.id])} />;
}
function ScopedAdSuggestionsWidget() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const navigate = useNavigate();
    const { hasPermission } = usePermissions();
    const active = useRef(false), pending = useRef<AbortController | null>(null);
    useEffect(() => { active.current = true; return () => { active.current = false; pending.current?.abort(); }; }, []);

    const [data, setData] = useState<AdSuggestionsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showContextModal, setShowContextModal] = useState(false);
    const [observedAt, setObservedAt] = useState<string | null>(null);

    const fetchSuggestions = useCallback(async (isRefresh = false) => {
        if (!currentAccount || !token) return;
        if (pending.current) return;
        const controller = new AbortController(); pending.current = controller;
        const timer = setTimeout(() => controller.abort(), 30000);

        if (isRefresh) setRefreshing(true);

        try {
            const res = await fetch('/api/dashboard/ad-suggestions', {
                signal: controller.signal,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                const result = await res.json() as AdSuggestionsData;
                const list = (value: unknown) => Array.isArray(value) && value.length <= 100 && value.every(item => typeof item === 'string' && item.length <= 10000);
                if (!result || !list(result.suggestions) || !list(result.action_items) || result.message !== undefined && (typeof result.message !== 'string' || result.message.length > 2000)) throw new Error('Invalid suggestions');
                if (result.availability !== undefined && (!result.availability || typeof result.availability.optimizer !== 'boolean' || typeof result.availability.pipeline !== 'boolean')) throw new Error('Invalid coverage');
                if (!active.current || controller.signal.aborted) return;
                setData(result);
                setObservedAt(new Date().toLocaleTimeString());
                setError(null);
            } else {
                if (active.current) { setError('Failed to load suggestions'); setData(null); }
            }
        } catch (err) {
            if (active.current) { setError('Failed to load suggestions'); setData(null); }
        } finally {
            clearTimeout(timer); pending.current = null;
            if (active.current) { setLoading(false); setRefreshing(false); }
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
        return <Lightbulb size={16} className="text-amber-500 shrink-0" />;
    };

    const cleanSuggestion = (text: string) => {
        return text
            .replace(/[\u{1F534}\u{1F7E2}\u{1F4CA}\u{1F4B0}\u{1F680}\u{1F4C1}\u{2705}\u{1F6D2}\u{1F50D}\u{2B50}]/gu, '')
            .replace(/\*\*/g, '')
            .trim();
    };

    const handleNavigate = () => {
        navigate('/marketing?tab=performance');
    };

    if (loading) {
        return (
            <div className={`${widgetGlassCardClass} p-6 h-full flex items-center justify-center`}>
                <div role="status" aria-label="Loading ad suggestions" className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
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
                    <p role="status" className="text-sm text-slate-600 dark:text-slate-300">{data.message}</p>
                    <button type="button"
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
                <p role="alert" className="text-sm text-slate-600 dark:text-slate-300">{error || 'No data available'}</p>
                <button type="button" onClick={() => void fetchSuggestions(true)} disabled={refreshing}>Retry suggestions</button>
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
                    {hasPermission('manage_marketing') && <button type="button" aria-label="Add business context"
                        onClick={() => setShowContextModal(true)}
                        className="p-1.5 text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                        title="Add business context"
                    >
                        <MessageCirclePlus size={16} />
                    </button>}
                    <button type="button" aria-label="Refresh suggestions"
                        onClick={() => fetchSuggestions(true)}
                        disabled={refreshing}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                        title="Refresh suggestions"
                    >
                        <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                    </button>
                    <button type="button"
                        onClick={handleNavigate}
                        className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 ml-1"
                    >
                        View All <ExternalLink size={12} />
                    </button>
                </div>
            </div>

            {hasPermission('manage_marketing') && showContextModal && <AdContextModal
                isOpen={showContextModal}
                onClose={() => setShowContextModal(false)}
                onSaved={() => fetchSuggestions(true)}
            />}

            <p role="status" className="text-xs text-slate-600 dark:text-slate-300">Fetched {observedAt}. Advice only, not completed actions. {data.availability && (!data.availability.optimizer || !data.availability.pipeline) ? 'Some analysis sources are unavailable.' : ''}</p>
            <div className="flex-1 space-y-3 overflow-y-auto">
                {data.suggestions.slice(0, 4).map((suggestion, idx) => (
                    <div
                        key={idx}
                        className="flex items-start gap-2 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg transition-colors"
                    >
                        {getSuggestionIcon(suggestion)}
                        <p className="text-sm text-slate-700 dark:text-slate-200 line-clamp-2">
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
