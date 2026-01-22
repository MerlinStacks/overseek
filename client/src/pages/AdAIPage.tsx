/**
 * AI Co-Pilot Page - Strategic Insight Deck
 * 
 * Light mode dashboard with horizontal Strategic Themes and Actionable Changes grid.
 * Provides detailed implementation guidance for each recommendation.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Logger } from '../utils/logger';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import {
    ArrowLeft,
    RefreshCw,
    Sparkles,
    Calendar,
    Download,
    FileText,
    ChevronLeft,
    ChevronRight,
    AlertTriangle
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AdContextModal } from '../components/marketing/AdContextModal';
import { ActionableRecommendation, isBudgetAction, isKeywordAction, isProductAction } from '../types/ActionableTypes';
import { AddKeywordModal } from '../components/marketing/AddKeywordModal';
import { RecommendationFeedbackModal } from '../components/marketing/RecommendationFeedbackModal';
import { ScheduleActionModal } from '../components/marketing/ScheduleActionModal';
import { CampaignWizard } from '../components/marketing/CampaignWizard/CampaignWizard';
import { ImplementationGuideModal } from '../components/marketing/ImplementationGuideModal';
import { StrategicThemeCard, StrategicTheme } from '../components/marketing/StrategicThemeCard';
import { ActionableChangeCard } from '../components/marketing/ActionableChangeCard';

// Cache duration: 15 minutes for stale threshold (in milliseconds)
// Data older than this triggers a background refresh
const STALE_THRESHOLD_MS = 15 * 60 * 1000;
const CACHE_KEY_PREFIX = 'adai_suggestions_';

interface CachedData {
    data: SuggestionsData;
    timestamp: number;
    accountId: string;
}

interface SuggestionsData {
    suggestions: string[];
    prioritized: { text: string; priority: 1 | 2 | 3; category: string }[];
    actionableRecommendations?: ActionableRecommendation[];
    summary?: any;
    action_items?: string[];
    message?: string;
}

/**
 * Group recommendations into strategic themes by category
 */
function groupIntoThemes(recs: ActionableRecommendation[]): StrategicTheme[] {
    const categoryGroups: Record<string, ActionableRecommendation[]> = {};

    recs.forEach(rec => {
        const cat = rec.category || 'optimization';
        if (!categoryGroups[cat]) categoryGroups[cat] = [];
        categoryGroups[cat].push(rec);
    });

    const themes: StrategicTheme[] = [];

    // Map categories to strategic themes
    const categoryMeta: Record<string, { title: string; description: string }> = {
        budget: {
            title: 'Budget Optimization',
            description: 'Reallocate spend to high-performing campaigns and reduce waste on underperformers.'
        },
        keywords: {
            title: 'Search Intent Harvesting',
            description: 'Capture high-intent search traffic with targeted keyword expansion.'
        },
        optimization: {
            title: 'Performance Tuning',
            description: 'Fine-tune campaigns for better conversion rates and ROAS.'
        },
        creative: {
            title: 'Creative Refresh',
            description: 'Update ad creatives to improve engagement and click-through rates.'
        },
        audience: {
            title: 'Audience Expansion',
            description: 'Reach new customer segments with refined targeting.'
        },
        structure: {
            title: 'Campaign Structure',
            description: 'Create new campaigns to capture untapped opportunities.'
        }
    };

    Object.entries(categoryGroups).forEach(([cat, catRecs]) => {
        if (catRecs.length === 0) return;

        const meta = categoryMeta[cat] || { title: cat, description: '' };
        const platforms = [...new Set(catRecs.map(r => r.platform === 'both' ? ['google', 'meta'] : [r.platform]).flat())] as ('google' | 'meta')[];
        const totalRevenue = catRecs.reduce((sum, r) => sum + (r.estimatedImpact?.revenueChange || 0), 0);
        const avgConfidence = Math.round(catRecs.reduce((sum, r) => sum + r.confidence, 0) / catRecs.length);

        themes.push({
            id: cat,
            category: cat as any,
            title: meta.title,
            description: meta.description,
            platforms,
            estimatedImprovement: {
                value: totalRevenue > 0 ? `+$${(totalRevenue).toLocaleString()}` : `${avgConfidence}% conf.`,
                label: totalRevenue > 0 ? 'Revenue' : 'Confidence'
            },
            recommendationCount: catRecs.length
        });
    });

    return themes.sort((a, b) => b.recommendationCount - a.recommendationCount);
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
    const [showCampaignWizard, setShowCampaignWizard] = useState(false);
    const [activeTheme, setActiveTheme] = useState<string | null>(null);

    // Modal states
    const [keywordModalOpen, setKeywordModalOpen] = useState(false);
    const [activeKeywordRec, setActiveKeywordRec] = useState<ActionableRecommendation | null>(null);
    const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
    const [activeFeedbackRec, setActiveFeedbackRec] = useState<ActionableRecommendation | null>(null);
    const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
    const [activeScheduleRec, setActiveScheduleRec] = useState<ActionableRecommendation | null>(null);
    const [guideModalOpen, setGuideModalOpen] = useState(false);
    const [activeGuideRec, setActiveGuideRec] = useState<ActionableRecommendation | null>(null);

    /**
     * Stale-while-revalidate pattern:
     * 1. Show cached data immediately if available (instant load)
     * 2. If cache is stale, refresh in background without spinner
     * 3. Only show loading spinner if no cached data exists
     */
    const fetchSuggestions = useCallback(async (isManualRefresh = false) => {
        if (!currentAccount || !token) return;

        const cacheKey = `${CACHE_KEY_PREFIX}${currentAccount.id}`;

        /**
         * Fetch fresh data from API and update cache
         * Why: Inlined to avoid useCallback dependency cycle that could cause infinite re-renders
         */
        const fetchFromApi = async (isBackgroundRefresh = false): Promise<SuggestionsData | null> => {
            try {
                const res = await fetch('/api/dashboard/ad-suggestions', {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'x-account-id': currentAccount.id
                    }
                });

                if (!res.ok) {
                    const errorBody = await res.text();
                    Logger.error('Ad suggestions API error', {
                        status: res.status,
                        statusText: res.statusText,
                        body: errorBody,
                        isBackground: isBackgroundRefresh
                    });
                    return null;
                }

                const result = await res.json();

                // Update cache
                try {
                    const cacheEntry: CachedData = {
                        data: result,
                        timestamp: Date.now(),
                        accountId: currentAccount.id
                    };
                    localStorage.setItem(cacheKey, JSON.stringify(cacheEntry));
                } catch (e) {
                    // Cache write failed, ignore
                }

                return result;
            } catch (err) {
                Logger.error('Failed to fetch ad suggestions', { error: err, isBackground: isBackgroundRefresh });
                return null;
            }
        };

        // For manual refresh, show refreshing indicator and fetch fresh
        if (isManualRefresh) {
            setRefreshing(true);
            const freshData = await fetchFromApi(false);
            if (freshData) {
                setData(freshData);
                setError(null);
            } else {
                setError('Failed to load suggestions');
            }
            setRefreshing(false);
            return;
        }

        // Check cache first
        try {
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const parsedCache: CachedData = JSON.parse(cached);
                const now = Date.now();
                const cacheAge = now - parsedCache.timestamp;

                if (parsedCache.accountId === currentAccount.id) {
                    // Show cached data immediately (no loading spinner)
                    setData(parsedCache.data);
                    setError(null);
                    setLoading(false);

                    // If stale, revalidate in background silently
                    if (cacheAge >= STALE_THRESHOLD_MS) {
                        fetchFromApi(true).then(freshData => {
                            if (freshData) {
                                setData(freshData);
                            }
                        });
                    }
                    return;
                }
            }
        } catch (e) {
            // Cache read failed, continue to fetch
        }

        // No valid cache - show loading and fetch
        setLoading(true);
        const freshData = await fetchFromApi(false);
        if (freshData) {
            setData(freshData);
            setError(null);
        } else {
            setError('Failed to load suggestions');
        }
        setLoading(false);
    }, [currentAccount, token]);

    useEffect(() => {
        fetchSuggestions();
    }, [fetchSuggestions]);

    // Get actionable recommendations, sorted by priority and potential impact
    const recommendations = useMemo(() => {
        const recs = data?.actionableRecommendations || [];
        return recs.sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            const aRev = a.estimatedImpact?.revenueChange || 0;
            const bRev = b.estimatedImpact?.revenueChange || 0;
            return bRev - aRev;
        });
    }, [data?.actionableRecommendations]);

    // Group into strategic themes
    const themes = useMemo(() => groupIntoThemes(recommendations), [recommendations]);

    // Filter recommendations by active theme
    const filteredRecommendations = useMemo(() => {
        if (!activeTheme) return recommendations;
        return recommendations.filter(r => r.category === activeTheme);
    }, [recommendations, activeTheme]);

    // Action handlers
    const handleKeywordConfirm = async (rec: ActionableRecommendation, keywordData: { keyword: string; matchType: string; bid: number; adGroupId: string }) => {
        if (!token || !currentAccount) return;

        const originalData = data;
        if (data && data.actionableRecommendations) {
            const newRecs = data.actionableRecommendations.filter(r => r.id !== rec.id);
            setData({ ...data, actionableRecommendations: newRecs });
        }

        try {
            const res = await fetch('/api/ads/execute-action', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify({
                    recommendationId: rec.id,
                    actionType: 'add_keyword',
                    platform: rec.platform,
                    campaignId: (rec.action as any).campaignId,
                    parameters: {
                        keyword: keywordData.keyword,
                        matchType: keywordData.matchType,
                        bid: keywordData.bid,
                        adGroupId: keywordData.adGroupId,
                        adAccountId: (rec as any).adAccountId
                    }
                })
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Failed to add keyword');
            }
            Logger.info('Keyword added successfully');
        } catch (err: any) {
            Logger.error('Failed to add keyword', { error: err });
            setData(originalData);
            alert(`Failed to add keyword: ${err.message}`);
        }
    };

    const handleApply = async (rec: ActionableRecommendation) => {
        if (!token || !currentAccount) return;

        if (rec.action.actionType === 'add_keyword') {
            setActiveKeywordRec(rec);
            setKeywordModalOpen(true);
            return;
        }

        const originalData = data;
        if (data && data.actionableRecommendations) {
            const newRecs = data.actionableRecommendations.filter(r => r.id !== rec.id);
            setData({ ...data, actionableRecommendations: newRecs });
        }

        try {
            let parameters: any = {};
            let actionType = '';

            if (rec.action.actionType === 'budget_increase' || rec.action.actionType === 'budget_decrease') {
                const budgetAction = rec.action as any;
                parameters.amount = budgetAction.suggestedBudget;
                actionType = budgetAction.actionType;
            } else if (rec.action.actionType === 'pause' || rec.action.actionType === 'enable') {
                actionType = rec.action.actionType;
            } else {
                setData(originalData);
                alert('This action type is not yet fully connected to the API.');
                return;
            }

            const res = await fetch('/api/ads/execute-action', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-account-id': currentAccount.id
                },
                body: JSON.stringify({
                    recommendationId: rec.id,
                    actionType,
                    platform: rec.platform,
                    campaignId: (rec.action as any).campaignId,
                    parameters
                })
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Failed to execute action');
            }

            Logger.info('Action executed successfully');
        } catch (err: any) {
            Logger.error('Failed to apply recommendation', { error: err });
            setData(originalData);
            alert(`Failed to apply action: ${err.message}`);
        }
    };

    const handleDismiss = (rec: ActionableRecommendation) => {
        setActiveFeedbackRec(rec);
        setFeedbackModalOpen(true);
    };

    const handleFeedbackSubmitted = () => {
        if (data && data.actionableRecommendations && activeFeedbackRec) {
            const newRecs = data.actionableRecommendations.filter(r => r.id !== activeFeedbackRec.id);
            setData({ ...data, actionableRecommendations: newRecs });
        }
        setActiveFeedbackRec(null);
    };

    const handleScheduleComplete = () => {
        if (data && data.actionableRecommendations && activeScheduleRec) {
            const newRecs = data.actionableRecommendations.filter(r => r.id !== activeScheduleRec.id);
            setData({ ...data, actionableRecommendations: newRecs });
        }
        setActiveScheduleRec(null);
    };

    // Loading state 
    if (loading) {
        return (
            <div className="-m-4 md:-m-6 lg:-m-8 min-h-[calc(100vh-4rem)] bg-gray-50 flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                        <div className="w-16 h-16 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin" />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <Sparkles className="w-6 h-6 text-indigo-600" />
                        </div>
                    </div>
                    <div className="text-center">
                        <p className="text-lg font-semibold text-gray-900">Analyzing Your Campaigns</p>
                        <p className="text-gray-500">Finding revenue opportunities...</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="-m-4 md:-m-6 lg:-m-8 min-h-[calc(100vh-4rem)] bg-gray-50">
            {/* Modals */}
            {showContextModal && (
                <AdContextModal
                    isOpen={showContextModal}
                    onClose={() => setShowContextModal(false)}
                />
            )}

            {showCampaignWizard && (
                <CampaignWizard
                    isOpen={showCampaignWizard}
                    onClose={() => setShowCampaignWizard(false)}
                />
            )}

            {activeKeywordRec && (
                <AddKeywordModal
                    isOpen={keywordModalOpen}
                    onClose={() => { setKeywordModalOpen(false); setActiveKeywordRec(null); }}
                    recommendation={activeKeywordRec}
                    onConfirm={async (d) => {
                        await handleKeywordConfirm(activeKeywordRec, d);
                        setKeywordModalOpen(false);
                        setActiveKeywordRec(null);
                    }}
                />
            )}

            {activeFeedbackRec && (
                <RecommendationFeedbackModal
                    isOpen={feedbackModalOpen}
                    onClose={() => { setFeedbackModalOpen(false); setActiveFeedbackRec(null); }}
                    recommendation={activeFeedbackRec}
                    action="dismiss"
                    onSubmitted={handleFeedbackSubmitted}
                />
            )}

            {activeScheduleRec && (
                <ScheduleActionModal
                    isOpen={scheduleModalOpen}
                    onClose={() => { setScheduleModalOpen(false); setActiveScheduleRec(null); }}
                    recommendation={activeScheduleRec}
                    onScheduled={handleScheduleComplete}
                />
            )}

            {activeGuideRec && (
                <ImplementationGuideModal
                    isOpen={guideModalOpen}
                    onClose={() => { setGuideModalOpen(false); setActiveGuideRec(null); }}
                    recommendation={activeGuideRec}
                    onApply={() => {
                        setGuideModalOpen(false);
                        handleApply(activeGuideRec);
                    }}
                />
            )}

            {/* Header */}
            <header className="bg-white border-b border-gray-200 px-6 py-5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => navigate('/marketing')}
                            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Strategic Insight Deck</h1>
                            <p className="text-gray-500 text-sm">High-level optimization themes for the current billing cycle</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 font-medium transition-colors">
                            <Calendar className="w-4 h-4" />
                            Last 7 Days
                        </button>
                        <button
                            onClick={() => fetchSuggestions(true)}
                            disabled={refreshing}
                            className="p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-500 transition-colors disabled:opacity-50"
                        >
                            <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </div>
            </header>

            {/* Error state */}
            {error && (
                <div className="mx-6 mt-4 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 flex items-center gap-3">
                    <AlertTriangle size={20} />
                    <span>{error}</span>
                </div>
            )}

            {/* Strategic Themes Section */}
            {themes.length > 0 && (
                <section className="px-6 py-6">
                    <div className="relative">
                        {/* Horizontal scroll container */}
                        <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
                            {themes.map(theme => (
                                <StrategicThemeCard
                                    key={theme.id}
                                    theme={theme}
                                    isActive={activeTheme === theme.id}
                                    onClick={() => setActiveTheme(activeTheme === theme.id ? null : theme.id)}
                                />
                            ))}
                        </div>
                    </div>
                </section>
            )}

            {/* Actionable Changes Section */}
            <section className="px-6 pb-8">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <h2 className="text-lg font-bold text-gray-900">Actionable Changes</h2>
                        <span className="px-2.5 py-1 rounded-full bg-gray-200 text-gray-600 text-sm font-medium">
                            {filteredRecommendations.length} PENDING
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        <button className="flex items-center gap-2 px-3 py-1.5 text-gray-600 hover:text-gray-900 font-medium transition-colors">
                            <Download className="w-4 h-4" />
                            Export CSV
                        </button>
                        <button className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors">
                            <FileText className="w-4 h-4" />
                            Implementation Log
                        </button>
                    </div>
                </div>

                {/* Cards Grid */}
                {filteredRecommendations.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {filteredRecommendations.map(rec => (
                            <ActionableChangeCard
                                key={rec.id}
                                recommendation={rec}
                                onImplementationGuide={() => {
                                    setActiveGuideRec(rec);
                                    setGuideModalOpen(true);
                                }}
                                onApply={() => handleApply(rec)}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
                        <div className="w-16 h-16 rounded-full bg-gray-100 mx-auto mb-4 flex items-center justify-center">
                            <Sparkles className="w-8 h-8 text-gray-400" />
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">
                            {activeTheme ? 'No recommendations in this category' : 'No recommendations available'}
                        </h3>
                        <p className="text-gray-500 mb-4">
                            {activeTheme
                                ? 'Try selecting a different theme or clear the filter.'
                                : 'We\'ll analyze your campaigns and surface opportunities here.'
                            }
                        </p>
                        {activeTheme && (
                            <button
                                onClick={() => setActiveTheme(null)}
                                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl transition-colors"
                            >
                                Clear Filter
                            </button>
                        )}
                    </div>
                )}
            </section>
        </div>
    );
}
