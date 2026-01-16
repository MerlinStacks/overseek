/**
 * AI Co-Pilot Page
 * 
 * Premium "card hand" style interface for AI-powered ad recommendations.
 * Non-scrollable viewport with horizontal card carousel for recommendations.
 * Each card shows projected revenue impact backed by real data.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Logger } from '../utils/logger';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import {
    ArrowLeft,
    RefreshCw,
    MessageCirclePlus,
    Sparkles,
    Zap,
    ChevronLeft,
    ChevronRight,
    DollarSign,
    TrendingUp,
    Search,
    ShoppingBag,
    Target,
    AlertTriangle,
    CheckCircle,
    ArrowUpRight,
    Layers,
    BarChart3,
    FileText
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AdContextModal } from '../components/marketing/AdContextModal';
import { ActionableRecommendation, isBudgetAction, isKeywordAction, isProductAction } from '../types/ActionableTypes';
import { AddKeywordModal } from '../components/marketing/AddKeywordModal';
import { RecommendationFeedbackModal } from '../components/marketing/RecommendationFeedbackModal';
import { ScheduleActionModal } from '../components/marketing/ScheduleActionModal';
import { CampaignWizard } from '../components/marketing/CampaignWizard/CampaignWizard';
import { ImplementationGuideModal } from '../components/marketing/ImplementationGuideModal';

// Cache duration: 5 minutes (in milliseconds)
const CACHE_DURATION_MS = 5 * 60 * 1000;
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
 * Calculate the total potential revenue from all recommendations.
 */
function calculateTotalPotentialRevenue(recs: ActionableRecommendation[]): number {
    return recs.reduce((sum, rec) => {
        return sum + (rec.estimatedImpact?.revenueChange || 0);
    }, 0);
}

/**
 * Get a color scheme based on the recommendation type and priority.
 */
function getCardGradient(rec: ActionableRecommendation): string {
    if (rec.priority === 1) {
        return 'from-rose-500 via-red-500 to-orange-500';
    }
    if (isKeywordAction(rec.action)) {
        return 'from-violet-500 via-purple-500 to-indigo-500';
    }
    if (isProductAction(rec.action)) {
        return 'from-emerald-500 via-teal-500 to-cyan-500';
    }
    if (isBudgetAction(rec.action)) {
        if (rec.action.changeAmount > 0) {
            return 'from-green-500 via-emerald-500 to-teal-500';
        }
        return 'from-amber-500 via-orange-500 to-yellow-500';
    }
    return 'from-blue-500 via-indigo-500 to-purple-500';
}

/**
 * Get the icon component for a recommendation.
 */
function getCardIcon(rec: ActionableRecommendation) {
    if (isKeywordAction(rec.action)) return Search;
    if (isProductAction(rec.action)) return ShoppingBag;
    if (isBudgetAction(rec.action)) return DollarSign;
    return Target;
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

    // Active card index for the carousel
    const [activeIndex, setActiveIndex] = useState(0);

    // Modal states
    const [keywordModalOpen, setKeywordModalOpen] = useState(false);
    const [activeKeywordRec, setActiveKeywordRec] = useState<ActionableRecommendation | null>(null);
    const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
    const [activeFeedbackRec, setActiveFeedbackRec] = useState<ActionableRecommendation | null>(null);
    const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
    const [activeScheduleRec, setActiveScheduleRec] = useState<ActionableRecommendation | null>(null);
    const [guideModalOpen, setGuideModalOpen] = useState(false);
    const [activeGuideRec, setActiveGuideRec] = useState<ActionableRecommendation | null>(null);

    const fetchSuggestions = useCallback(async (isRefresh = false) => {
        if (!currentAccount || !token) return;

        const cacheKey = `${CACHE_KEY_PREFIX}${currentAccount.id}`;

        // Check cache first (unless explicitly refreshing)
        if (!isRefresh) {
            try {
                const cached = localStorage.getItem(cacheKey);
                if (cached) {
                    const parsedCache: CachedData = JSON.parse(cached);
                    const now = Date.now();

                    // Use cached data if it's still valid and for the same account
                    if (parsedCache.accountId === currentAccount.id &&
                        (now - parsedCache.timestamp) < CACHE_DURATION_MS) {
                        setData(parsedCache.data);
                        setError(null);
                        setLoading(false);
                        return;
                    }
                }
            } catch (e) {
                // Cache read failed, continue to fetch
            }
        }

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
                setActiveIndex(0); // Reset to first card on refresh

                // Cache the result
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

    // Get actionable recommendations, sorted by priority and potential impact
    const recommendations = useMemo(() => {
        const recs = data?.actionableRecommendations || [];
        return recs.sort((a, b) => {
            // Priority first
            if (a.priority !== b.priority) return a.priority - b.priority;
            // Then by revenue impact
            const aRev = a.estimatedImpact?.revenueChange || 0;
            const bRev = b.estimatedImpact?.revenueChange || 0;
            return bRev - aRev;
        });
    }, [data?.actionableRecommendations]);

    // Calculate total potential revenue
    const totalPotentialRevenue = useMemo(() => calculateTotalPotentialRevenue(recommendations), [recommendations]);

    // Navigation handlers
    const goToPrevious = () => {
        setActiveIndex(prev => (prev > 0 ? prev - 1 : recommendations.length - 1));
    };

    const goToNext = () => {
        setActiveIndex(prev => (prev < recommendations.length - 1 ? prev + 1 : 0));
    };

    // Action handlers
    const handleKeywordConfirm = async (rec: ActionableRecommendation, keywordData: { keyword: string; matchType: string; bid: number; adGroupId: string }) => {
        if (!token || !currentAccount) return;

        const originalData = data;
        if (data && data.actionableRecommendations) {
            const newRecs = data.actionableRecommendations.filter(r => r.id !== rec.id);
            setData({ ...data, actionableRecommendations: newRecs });
            if (activeIndex >= newRecs.length && newRecs.length > 0) {
                setActiveIndex(newRecs.length - 1);
            }
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
            if (activeIndex >= newRecs.length && newRecs.length > 0) {
                setActiveIndex(newRecs.length - 1);
            }
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
            if (activeIndex >= newRecs.length && newRecs.length > 0) {
                setActiveIndex(newRecs.length - 1);
            }
        }
        setActiveFeedbackRec(null);
    };

    const handleSchedule = (rec: ActionableRecommendation) => {
        setActiveScheduleRec(rec);
        setScheduleModalOpen(true);
    };

    const handleScheduleComplete = () => {
        if (data && data.actionableRecommendations && activeScheduleRec) {
            const newRecs = data.actionableRecommendations.filter(r => r.id !== activeScheduleRec.id);
            setData({ ...data, actionableRecommendations: newRecs });
            if (activeIndex >= newRecs.length && newRecs.length > 0) {
                setActiveIndex(newRecs.length - 1);
            }
        }
        setActiveScheduleRec(null);
    };

    // Loading state with premium animation
    if (loading) {
        return (
            <div className="-m-4 md:-m-6 lg:-m-8 min-h-[calc(100vh-4rem)] bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center overflow-hidden relative">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-500/10 via-transparent to-transparent" />
                <div className="relative flex flex-col items-center gap-6 z-10">
                    <div className="relative">
                        <div className="w-20 h-20 rounded-full border-4 border-indigo-500/30 border-t-indigo-400 animate-spin" />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <Sparkles className="w-8 h-8 text-indigo-400 animate-pulse" />
                        </div>
                    </div>
                    <div className="text-center">
                        <p className="text-xl font-semibold text-white mb-2">Analyzing Your Campaigns</p>
                        <p className="text-indigo-300/70">Finding revenue opportunities...</p>
                    </div>
                </div>
            </div>
        );
    }

    // Main render
    const currentRec = recommendations[activeIndex];

    return (
        <div className="-m-4 md:-m-6 lg:-m-8 min-h-[calc(100vh-4rem)] bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 overflow-hidden relative flex flex-col">
            {/* Ambient background effects */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-purple-500/10 to-transparent rounded-full blur-3xl" />
                <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-to-tl from-blue-500/10 to-transparent rounded-full blur-3xl" />
                <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl animate-pulse" />
            </div>

            {/* Header */}
            <header className="relative z-20 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => navigate('/marketing?tab=ads')}
                        className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all border border-white/10"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/25">
                                <Zap size={20} fill="currentColor" />
                            </div>
                            AI Co-Pilot
                        </h1>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setShowCampaignWizard(true)}
                        className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium rounded-xl hover:from-indigo-600 hover:to-purple-700 transition-all shadow-lg shadow-indigo-500/25"
                    >
                        <Sparkles size={18} />
                        Create Campaign
                    </button>
                    <button
                        onClick={() => setShowContextModal(true)}
                        className="flex items-center gap-2 px-4 py-2.5 bg-white/10 text-white font-medium rounded-xl hover:bg-white/15 transition-all border border-white/10"
                    >
                        <MessageCirclePlus size={18} />
                        Context
                    </button>
                    <button
                        onClick={() => fetchSuggestions(true)}
                        disabled={refreshing}
                        className="flex items-center gap-2 px-4 py-2.5 bg-white/10 text-white font-medium rounded-xl hover:bg-white/15 transition-all border border-white/10 disabled:opacity-50"
                    >
                        <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
                        {refreshing ? 'Analyzing...' : 'Refresh'}
                    </button>
                </div>
            </header>

            {/* Modals */}
            <CampaignWizard isOpen={showCampaignWizard} onClose={() => setShowCampaignWizard(false)} />
            <AdContextModal isOpen={showContextModal} onClose={() => setShowContextModal(false)} onSaved={() => fetchSuggestions(true)} />

            {activeKeywordRec && (
                <AddKeywordModal
                    isOpen={keywordModalOpen}
                    onClose={() => setKeywordModalOpen(false)}
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

            {/* Error state */}
            {error && (
                <div className="relative z-20 mx-6 mb-4 bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-red-300 flex items-center gap-3">
                    <AlertTriangle size={20} />
                    <span>{error}</span>
                </div>
            )}

            {/* Main Content */}
            {recommendations.length === 0 ? (
                /* Empty State */
                <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6">
                    <div className="text-center max-w-md">
                        <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center">
                            <CheckCircle className="w-12 h-12 text-emerald-400" />
                        </div>
                        <h2 className="text-2xl font-bold text-white mb-3">All Systems Optimized</h2>
                        <p className="text-white/60 mb-8">
                            Your campaigns are running smoothly. The AI Co-pilot monitors your data 24/7 and will alert you when new opportunities arise.
                        </p>
                        <button
                            onClick={() => fetchSuggestions(true)}
                            className="px-6 py-3 bg-white/10 hover:bg-white/15 text-white font-medium rounded-xl transition-all border border-white/10"
                        >
                            Force Re-analysis
                        </button>
                    </div>
                </div>
            ) : (
                /* Card Carousel */
                <div className="relative z-10 flex-1 flex flex-col">
                    {/* Revenue Summary Bar */}
                    <div className="px-6 py-4">
                        <div className="flex items-center justify-between bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-cyan-500/10 rounded-2xl p-4 border border-emerald-500/20">
                            <div className="flex items-center gap-4">
                                <div className="p-3 rounded-xl bg-emerald-500/20">
                                    <TrendingUp className="w-6 h-6 text-emerald-400" />
                                </div>
                                <div>
                                    <p className="text-white/60 text-sm">Total Potential Revenue Increase</p>
                                    <p className="text-3xl font-bold text-white">
                                        +${totalPotentialRevenue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-6">
                                <div className="text-center">
                                    <p className="text-2xl font-bold text-white">{recommendations.length}</p>
                                    <p className="text-white/60 text-sm">Opportunities</p>
                                </div>
                                <div className="text-center">
                                    <p className="text-2xl font-bold text-rose-400">{recommendations.filter(r => r.priority === 1).length}</p>
                                    <p className="text-white/60 text-sm">Urgent</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Cards Area */}
                    <div className="flex-1 flex items-center justify-center px-6 pb-6">
                        <div className="relative w-full max-w-4xl h-full flex items-center">
                            {/* Previous Button */}
                            <button
                                onClick={goToPrevious}
                                disabled={recommendations.length <= 1}
                                className="absolute left-0 z-30 p-4 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-2xl backdrop-blur-sm border border-white/10"
                            >
                                <ChevronLeft size={28} />
                            </button>

                            {/* Card Stack */}
                            <div className="flex-1 flex justify-center items-center perspective-1000 mx-16">
                                {recommendations.map((rec, index) => {
                                    const offset = index - activeIndex;
                                    const isActive = index === activeIndex;
                                    const isVisible = Math.abs(offset) <= 2;

                                    if (!isVisible) return null;

                                    const Icon = getCardIcon(rec);
                                    const gradient = getCardGradient(rec);
                                    const revenueImpact = rec.estimatedImpact?.revenueChange || 0;

                                    return (
                                        <div
                                            key={rec.id}
                                            className="absolute w-full max-w-2xl transition-all duration-500 ease-out"
                                            style={{
                                                transform: `
                                                    translateX(${offset * 60}px) 
                                                    translateZ(${-Math.abs(offset) * 100}px) 
                                                    rotateY(${offset * -5}deg)
                                                    scale(${1 - Math.abs(offset) * 0.1})
                                                `,
                                                zIndex: 10 - Math.abs(offset),
                                                opacity: 1 - Math.abs(offset) * 0.3,
                                                pointerEvents: isActive ? 'auto' : 'none',
                                            }}
                                        >
                                            <div
                                                className={`
                                                    relative rounded-3xl p-8 backdrop-blur-xl
                                                    ${isActive ? 'shadow-2xl' : 'shadow-lg'}
                                                    bg-gradient-to-br ${gradient}
                                                    transition-shadow duration-300
                                                `}
                                            >
                                                {/* Card Header */}
                                                <div className="flex items-start justify-between mb-6">
                                                    <div className="flex items-center gap-4">
                                                        <div className="p-3 rounded-2xl bg-white/20 backdrop-blur-sm">
                                                            <Icon className="w-7 h-7 text-white" />
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <span className="text-white/80 text-sm font-medium uppercase tracking-wider">
                                                                    {rec.platform} • {rec.category}
                                                                </span>
                                                                {rec.priority === 1 && (
                                                                    <span className="px-2 py-0.5 bg-white/20 rounded-full text-xs font-bold text-white flex items-center gap-1">
                                                                        <AlertTriangle size={12} /> URGENT
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-white/60 text-xs uppercase tracking-wider mb-1">Confidence</p>
                                                        <div className="flex items-center gap-1">
                                                            <div className="w-16 h-2 rounded-full bg-white/20 overflow-hidden">
                                                                <div
                                                                    className="h-full bg-white rounded-full"
                                                                    style={{ width: `${rec.confidence}%` }}
                                                                />
                                                            </div>
                                                            <span className="text-white font-bold text-sm">{rec.confidence}%</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Headline */}
                                                <h3 className="text-2xl font-bold text-white mb-3 leading-tight">
                                                    {rec.headline.replace(/^[^\w]+/, '')}
                                                </h3>

                                                {/* Explanation */}
                                                <p className="text-white/80 text-base mb-6 leading-relaxed">
                                                    {rec.explanation}
                                                </p>

                                                {/* Revenue Impact */}
                                                {revenueImpact > 0 && (
                                                    <div className="mb-6 p-4 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/10">
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex items-center gap-3">
                                                                <ArrowUpRight className="w-6 h-6 text-white" />
                                                                <div>
                                                                    <p className="text-white/60 text-sm">Projected Revenue Increase</p>
                                                                    <p className="text-3xl font-bold text-white">
                                                                        +${revenueImpact.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                            <div className="text-right">
                                                                <p className="text-white/60 text-sm">Timeframe</p>
                                                                <p className="text-white font-medium">{rec.estimatedImpact?.timeframe === '7d' ? '7 Days' : '30 Days'}</p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Inline Implementation Specs */}
                                                {rec.implementationDetails && (
                                                    <div className="mb-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
                                                        {rec.implementationDetails.budgetSpec && (
                                                            <>
                                                                <div className="px-4 py-3 rounded-xl bg-white/10 backdrop-blur-sm border border-white/10">
                                                                    <p className="text-white/50 text-xs uppercase tracking-wider mb-0.5">Daily Budget</p>
                                                                    <p className="text-white font-bold text-lg">${rec.implementationDetails.budgetSpec.dailyBudget}</p>
                                                                </div>
                                                                {rec.implementationDetails.budgetSpec.targetRoas && (
                                                                    <div className="px-4 py-3 rounded-xl bg-white/10 backdrop-blur-sm border border-white/10">
                                                                        <p className="text-white/50 text-xs uppercase tracking-wider mb-0.5">Target ROAS</p>
                                                                        <p className="text-emerald-300 font-bold text-lg">{rec.implementationDetails.budgetSpec.targetRoas}x</p>
                                                                    </div>
                                                                )}
                                                            </>
                                                        )}
                                                        {rec.implementationDetails.suggestedKeywords && rec.implementationDetails.suggestedKeywords.length > 0 && (
                                                            <div className="px-4 py-3 rounded-xl bg-white/10 backdrop-blur-sm border border-white/10">
                                                                <p className="text-white/50 text-xs uppercase tracking-wider mb-0.5">Keywords</p>
                                                                <p className="text-white font-bold text-lg">{rec.implementationDetails.suggestedKeywords.length} suggested</p>
                                                            </div>
                                                        )}
                                                        {rec.implementationDetails.difficulty && (
                                                            <div className="px-4 py-3 rounded-xl bg-white/10 backdrop-blur-sm border border-white/10">
                                                                <p className="text-white/50 text-xs uppercase tracking-wider mb-0.5">Difficulty</p>
                                                                <p className={`font-bold text-lg ${rec.implementationDetails.difficulty === 'easy' ? 'text-emerald-300' :
                                                                        rec.implementationDetails.difficulty === 'medium' ? 'text-amber-300' :
                                                                            'text-rose-300'
                                                                    }`}>
                                                                    {rec.implementationDetails.difficulty.charAt(0).toUpperCase() + rec.implementationDetails.difficulty.slice(1)}
                                                                </p>
                                                            </div>
                                                        )}
                                                        {rec.implementationDetails.estimatedTimeMinutes && (
                                                            <div className="px-4 py-3 rounded-xl bg-white/10 backdrop-blur-sm border border-white/10">
                                                                <p className="text-white/50 text-xs uppercase tracking-wider mb-0.5">Est. Time</p>
                                                                <p className="text-white font-bold text-lg">~{rec.implementationDetails.estimatedTimeMinutes} min</p>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {/* Data Points */}
                                                {rec.dataPoints.length > 0 && (
                                                    <div className="flex flex-wrap gap-2 mb-6">
                                                        {rec.dataPoints.slice(0, 4).map((dp, i) => (
                                                            <span key={i} className="px-3 py-1.5 rounded-full bg-white/10 text-white/90 text-sm font-medium backdrop-blur-sm">
                                                                {dp}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Action Buttons */}
                                                <div className="flex items-center gap-3">
                                                    <button
                                                        onClick={() => {
                                                            setActiveGuideRec(rec);
                                                            setGuideModalOpen(true);
                                                        }}
                                                        className="flex-1 py-3.5 px-6 bg-white text-slate-900 font-bold rounded-xl hover:bg-white/90 transition-all shadow-lg flex items-center justify-center gap-2"
                                                    >
                                                        <FileText size={20} />
                                                        Implementation Guide
                                                    </button>
                                                    <button
                                                        onClick={() => handleApply(rec)}
                                                        className="py-3.5 px-5 bg-white/20 text-white font-medium rounded-xl hover:bg-white/30 transition-all flex items-center gap-2"
                                                    >
                                                        <CheckCircle size={18} />
                                                        Apply
                                                    </button>
                                                    <button
                                                        onClick={() => handleDismiss(rec)}
                                                        className="py-3.5 px-5 bg-white/10 text-white/80 font-medium rounded-xl hover:bg-white/20 hover:text-white transition-all"
                                                    >
                                                        Skip
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Next Button */}
                            <button
                                onClick={goToNext}
                                disabled={recommendations.length <= 1}
                                className="absolute right-0 z-30 p-4 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-2xl backdrop-blur-sm border border-white/10"
                            >
                                <ChevronRight size={28} />
                            </button>
                        </div>
                    </div>

                    {/* Card Indicators */}
                    {recommendations.length > 1 && (
                        <div className="flex justify-center gap-2 pb-6">
                            {recommendations.map((_, index) => (
                                <button
                                    key={index}
                                    onClick={() => setActiveIndex(index)}
                                    className={`
                                        w-2.5 h-2.5 rounded-full transition-all
                                        ${index === activeIndex
                                            ? 'bg-white w-8'
                                            : 'bg-white/30 hover:bg-white/50'}
                                    `}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
