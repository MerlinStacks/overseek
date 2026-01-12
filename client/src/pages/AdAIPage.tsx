/**
 * AI Ad Management Page
 * 
 * Dedicated page for AI-powered ad optimization with priority-sorted suggestions.
 * Shows urgent alerts prominently and provides full detail view of all recommendations.
 */

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import {
    AlertTriangle,
    TrendingUp,
    TrendingDown,
    Lightbulb,
    RefreshCw,
    ArrowLeft,
    CheckCircle,
    AlertCircle,
    Info,
    MessageCirclePlus,
    DollarSign,
    Package,
    Palette,
    Calendar
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AdContextModal } from '../components/marketing/AdContextModal';

interface PrioritizedSuggestion {
    text: string;
    priority: 1 | 2 | 3;
    category: 'stock' | 'performance' | 'budget' | 'creative' | 'seasonal' | 'info';
}

interface SuggestionsData {
    suggestions: string[];
    prioritized: PrioritizedSuggestion[];
    summary?: any;
    action_items?: string[];
    message?: string;
}

/**
 * Returns icon and colors based on suggestion category and priority.
 */
function getSuggestionStyle(suggestion: PrioritizedSuggestion) {
    const { priority, category } = suggestion;

    if (priority === 1) {
        return {
            icon: <AlertTriangle className="w-5 h-5" />,
            bg: 'bg-red-50 border-red-200',
            iconColor: 'text-red-600',
            badge: 'bg-red-100 text-red-800',
            badgeText: 'Urgent'
        };
    }

    if (priority === 2) {
        const iconMap: Record<string, JSX.Element> = {
            budget: <DollarSign className="w-5 h-5" />,
            creative: <Palette className="w-5 h-5" />,
            performance: <TrendingDown className="w-5 h-5" />,
            stock: <Package className="w-5 h-5" />,
        };
        return {
            icon: iconMap[category] || <AlertCircle className="w-5 h-5" />,
            bg: 'bg-amber-50 border-amber-200',
            iconColor: 'text-amber-600',
            badge: 'bg-amber-100 text-amber-800',
            badgeText: 'Important'
        };
    }

    // Priority 3 - Info
    const iconMap: Record<string, JSX.Element> = {
        seasonal: <Calendar className="w-5 h-5" />,
        info: <Info className="w-5 h-5" />,
        performance: <TrendingUp className="w-5 h-5" />,
    };
    return {
        icon: iconMap[category] || <Lightbulb className="w-5 h-5" />,
        bg: 'bg-blue-50 border-blue-200',
        iconColor: 'text-blue-600',
        badge: 'bg-blue-100 text-blue-800',
        badgeText: 'Info'
    };
}

/**
 * Clean markdown and emoji from text for display.
 */
function cleanText(text: string): string {
    return text
        .replace(/\*\*/g, '')
        .replace(/[🔴🟢📊💰🚀📁✅🛒🔍⭐🚫⚠️📝📉📈🎨👥💵ℹ️📅]/gu, '')
        .trim();
}

export function AdAIPage() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();
    const navigate = useNavigate();

    const [data, setData] = useState<SuggestionsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showContextModal, setShowContextModal] = useState(false);

    const fetchSuggestions = useCallback(async (isRefresh = false) => {
        if (!currentAccount || !token) return;

        if (isRefresh) setRefreshing(true);
        else setLoading(true);

        try {
            const res = await fetch('/api/dashboard/ad-suggestions', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                }
            });
            if (res.ok) {
                const result = await res.json();
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

    useEffect(() => {
        fetchSuggestions();
    }, [fetchSuggestions]);

    // Separate by priority
    const urgentItems = data?.prioritized?.filter(s => s.priority === 1) || [];
    const importantItems = data?.prioritized?.filter(s => s.priority === 2) || [];
    const infoItems = data?.prioritized?.filter(s => s.priority === 3) || [];

    if (loading) {
        return (
            <div className="flex items-center justify-center h-96">
                <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => navigate('/marketing?tab=ads')}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <Lightbulb className="text-amber-500" />
                            AI Ad Suggestions
                        </h1>
                        <p className="text-gray-500">Priority-sorted recommendations for your ad campaigns</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowContextModal(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 transition-colors"
                    >
                        <MessageCirclePlus size={18} />
                        Add Context
                    </button>
                    <button
                        onClick={() => fetchSuggestions(true)}
                        disabled={refreshing}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                        <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                </div>
            </div>

            <AdContextModal
                isOpen={showContextModal}
                onClose={() => setShowContextModal(false)}
                onSaved={() => fetchSuggestions(true)}
            />

            {/* No accounts message */}
            {data?.message && (
                <div className="bg-gray-50 rounded-xl p-8 text-center">
                    <Lightbulb className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-600">{data.message}</p>
                    <button
                        onClick={() => navigate('/marketing?tab=ads')}
                        className="mt-4 text-blue-600 hover:text-blue-700 font-medium"
                    >
                        Connect Ad Accounts →
                    </button>
                </div>
            )}

            {/* Error state */}
            {error && (
                <div className="bg-red-50 rounded-xl p-6 text-red-700">
                    <AlertCircle className="inline mr-2" />
                    {error}
                </div>
            )}

            {/* Summary Stats */}
            {data?.summary && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-white rounded-xl p-4 border shadow-sm">
                        <p className="text-sm text-gray-500">Urgent Issues</p>
                        <p className={`text-2xl font-bold ${urgentItems.length > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {urgentItems.length}
                        </p>
                    </div>
                    <div className="bg-white rounded-xl p-4 border shadow-sm">
                        <p className="text-sm text-gray-500">Important Actions</p>
                        <p className="text-2xl font-bold text-amber-600">{importantItems.length}</p>
                    </div>
                    <div className="bg-white rounded-xl p-4 border shadow-sm">
                        <p className="text-sm text-gray-500">Insights</p>
                        <p className="text-2xl font-bold text-blue-600">{infoItems.length}</p>
                    </div>
                    {data.summary.seasonal && (
                        <div className="bg-white rounded-xl p-4 border shadow-sm">
                            <p className="text-sm text-gray-500">Season</p>
                            <p className="text-sm font-semibold text-purple-600">{data.summary.seasonal.period}</p>
                        </div>
                    )}
                </div>
            )}

            {/* Urgent Alerts */}
            {urgentItems.length > 0 && (
                <div className="space-y-3">
                    <h2 className="text-lg font-semibold text-red-700 flex items-center gap-2">
                        <AlertTriangle size={20} />
                        Urgent - Requires Immediate Attention
                    </h2>
                    <div className="space-y-3">
                        {urgentItems.map((item, idx) => {
                            const style = getSuggestionStyle(item);
                            return (
                                <div key={idx} className={`p-4 rounded-xl border ${style.bg} flex items-start gap-3`}>
                                    <div className={style.iconColor}>{style.icon}</div>
                                    <div className="flex-1">
                                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${style.badge} mb-2`}>
                                            {style.badgeText}
                                        </span>
                                        <p className="text-gray-800">{cleanText(item.text)}</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Important Items */}
            {importantItems.length > 0 && (
                <div className="space-y-3">
                    <h2 className="text-lg font-semibold text-amber-700 flex items-center gap-2">
                        <AlertCircle size={20} />
                        Important - Action Recommended
                    </h2>
                    <div className="space-y-3">
                        {importantItems.map((item, idx) => {
                            const style = getSuggestionStyle(item);
                            return (
                                <div key={idx} className={`p-4 rounded-xl border ${style.bg} flex items-start gap-3`}>
                                    <div className={style.iconColor}>{style.icon}</div>
                                    <div className="flex-1">
                                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${style.badge} mb-2`}>
                                            {style.badgeText}
                                        </span>
                                        <p className="text-gray-800">{cleanText(item.text)}</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Info Items */}
            {infoItems.length > 0 && (
                <div className="space-y-3">
                    <h2 className="text-lg font-semibold text-blue-700 flex items-center gap-2">
                        <Info size={20} />
                        Insights & Information
                    </h2>
                    <div className="space-y-3">
                        {infoItems.map((item, idx) => {
                            const style = getSuggestionStyle(item);
                            return (
                                <div key={idx} className={`p-4 rounded-xl border ${style.bg} flex items-start gap-3`}>
                                    <div className={style.iconColor}>{style.icon}</div>
                                    <div className="flex-1">
                                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${style.badge} mb-2`}>
                                            {style.badgeText}
                                        </span>
                                        <p className="text-gray-800">{cleanText(item.text)}</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* All clear state */}
            {data?.prioritized && data.prioritized.length === 0 && (
                <div className="bg-green-50 rounded-xl p-8 text-center">
                    <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-green-700">All Clear!</h3>
                    <p className="text-green-600">Your ad campaigns are performing well with no issues detected.</p>
                </div>
            )}
        </div>
    );
}
