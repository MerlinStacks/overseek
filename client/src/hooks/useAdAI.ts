/**
 * useAdAI Hook
 *
 * Manages state, data fetching (with SWR caching), and action handlers for Ad AI page.
 * Extracted from AdAIPage.tsx for maintainability.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import { Logger } from '../utils/logger';
import { ActionableRecommendation } from '../types/ActionableTypes';
import { StrategicTheme } from '../components/marketing/StrategicThemeCard';

// Cache configuration
const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
const CACHE_KEY_PREFIX = 'adai_suggestions_';

interface CachedData {
    data: SuggestionsData;
    timestamp: number;
    accountId: string;
}

export interface SuggestionsData {
    suggestions: string[];
    prioritized: { text: string; priority: 1 | 2 | 3; category: string }[];
    actionableRecommendations?: ActionableRecommendation[];
    summary?: any;
    action_items?: string[];
    message?: string;
}

/**
 * Group recommendations into strategic themes by category.
 */
function groupIntoThemes(recs: ActionableRecommendation[]): StrategicTheme[] {
    const categoryGroups: Record<string, ActionableRecommendation[]> = {};

    recs.forEach(rec => {
        const cat = rec.category || 'optimization';
        if (!categoryGroups[cat]) categoryGroups[cat] = [];
        categoryGroups[cat].push(rec);
    });

    const categoryMeta: Record<string, { title: string; description: string }> = {
        budget: { title: 'Budget Optimization', description: 'Reallocate spend to high-performing campaigns and reduce waste on underperformers.' },
        keywords: { title: 'Search Intent Harvesting', description: 'Capture high-intent search traffic with targeted keyword expansion.' },
        optimization: { title: 'Performance Tuning', description: 'Fine-tune campaigns for better conversion rates and ROAS.' },
        creative: { title: 'Creative Refresh', description: 'Update ad creatives to improve engagement and click-through rates.' },
        audience: { title: 'Audience Expansion', description: 'Reach new customer segments with refined targeting.' },
        structure: { title: 'Campaign Structure', description: 'Create new campaigns to capture untapped opportunities.' }
    };

    const themes: StrategicTheme[] = [];

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
                value: totalRevenue > 0 ? `+$${totalRevenue.toLocaleString()}` : `${avgConfidence}% conf.`,
                label: totalRevenue > 0 ? 'Revenue' : 'Confidence'
            },
            recommendationCount: catRecs.length
        });
    });

    return themes.sort((a, b) => b.recommendationCount - a.recommendationCount);
}

export function useAdAI() {
    const { token } = useAuth();
    const { currentAccount } = useAccount();

    const [data, setData] = useState<SuggestionsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
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
     * Stale-while-revalidate fetch pattern.
     */
    const fetchSuggestions = useCallback(async (isManualRefresh = false) => {
        if (!currentAccount || !token) return;

        const cacheKey = `${CACHE_KEY_PREFIX}${currentAccount.id}`;

        const fetchFromApi = async (isBackgroundRefresh = false): Promise<SuggestionsData | null> => {
            try {
                const res = await fetch('/api/dashboard/ad-suggestions', {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'x-account-id': currentAccount.id
                    }
                });

                if (!res.ok) {
                    Logger.error('Ad suggestions API error', { status: res.status, isBackground: isBackgroundRefresh });
                    return null;
                }

                const result = await res.json();

                try {
                    const cacheEntry: CachedData = { data: result, timestamp: Date.now(), accountId: currentAccount.id };
                    localStorage.setItem(cacheKey, JSON.stringify(cacheEntry));
                } catch { /* ignore cache write failure */ }

                return result;
            } catch (err) {
                Logger.error('Failed to fetch ad suggestions', { error: err, isBackground: isBackgroundRefresh });
                return null;
            }
        };

        if (isManualRefresh) {
            setRefreshing(true);
            const freshData = await fetchFromApi(false);
            if (freshData) { setData(freshData); setError(null); }
            else setError('Failed to load suggestions');
            setRefreshing(false);
            return;
        }

        // Check cache
        try {
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const parsedCache: CachedData = JSON.parse(cached);
                if (parsedCache.accountId === currentAccount.id) {
                    setData(parsedCache.data);
                    setError(null);
                    setLoading(false);

                    if (Date.now() - parsedCache.timestamp >= STALE_THRESHOLD_MS) {
                        fetchFromApi(true).then(freshData => { if (freshData) setData(freshData); });
                    }
                    return;
                }
            }
        } catch { /* ignore */ }

        setLoading(true);
        const freshData = await fetchFromApi(false);
        if (freshData) { setData(freshData); setError(null); }
        else setError('Failed to load suggestions');
        setLoading(false);
    }, [currentAccount, token]);

    useEffect(() => { fetchSuggestions(); }, [fetchSuggestions]);

    // Derived state
    const recommendations = useMemo(() => {
        const recs = data?.actionableRecommendations || [];
        return recs.sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            return (b.estimatedImpact?.revenueChange || 0) - (a.estimatedImpact?.revenueChange || 0);
        });
    }, [data?.actionableRecommendations]);

    const themes = useMemo(() => groupIntoThemes(recommendations), [recommendations]);

    const filteredRecommendations = useMemo(() => {
        if (!activeTheme) return recommendations;
        return recommendations.filter(r => r.category === activeTheme);
    }, [recommendations, activeTheme]);

    // Action handlers
    const handleKeywordConfirm = useCallback(async (rec: ActionableRecommendation, keywordData: { keyword: string; matchType: string; bid: number; adGroupId: string }) => {
        if (!token || !currentAccount) return;

        const originalData = data;
        if (data?.actionableRecommendations) {
            setData({ ...data, actionableRecommendations: data.actionableRecommendations.filter(r => r.id !== rec.id) });
        }

        try {
            const res = await fetch('/api/ads/execute-action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'x-account-id': currentAccount.id },
                body: JSON.stringify({
                    recommendationId: rec.id,
                    actionType: 'add_keyword',
                    platform: rec.platform,
                    campaignId: (rec.action as any).campaignId,
                    parameters: { keyword: keywordData.keyword, matchType: keywordData.matchType, bid: keywordData.bid, adGroupId: keywordData.adGroupId, adAccountId: (rec as any).adAccountId }
                })
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Failed to add keyword');
            Logger.info('Keyword added successfully');
        } catch (err: any) {
            Logger.error('Failed to add keyword', { error: err });
            setData(originalData);
            alert(`Failed to add keyword: ${err.message}`);
        }
    }, [token, currentAccount, data]);

    const handleApply = useCallback(async (rec: ActionableRecommendation) => {
        if (!token || !currentAccount) return;

        if (rec.action.actionType === 'add_keyword') {
            setActiveKeywordRec(rec);
            setKeywordModalOpen(true);
            return;
        }

        const originalData = data;
        if (data?.actionableRecommendations) {
            setData({ ...data, actionableRecommendations: data.actionableRecommendations.filter(r => r.id !== rec.id) });
        }

        try {
            let parameters: any = {};
            let actionType = '';

            if (rec.action.actionType === 'budget_increase' || rec.action.actionType === 'budget_decrease') {
                parameters.amount = (rec.action as any).suggestedBudget;
                actionType = rec.action.actionType;
            } else if (rec.action.actionType === 'pause' || rec.action.actionType === 'enable') {
                actionType = rec.action.actionType;
            } else {
                setData(originalData);
                alert('This action type is not yet fully connected to the API.');
                return;
            }

            const res = await fetch('/api/ads/execute-action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'x-account-id': currentAccount.id },
                body: JSON.stringify({ recommendationId: rec.id, actionType, platform: rec.platform, campaignId: (rec.action as any).campaignId, parameters })
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Failed to execute action');
            Logger.info('Action executed successfully');
        } catch (err: any) {
            Logger.error('Failed to apply recommendation', { error: err });
            setData(originalData);
            alert(`Failed to apply action: ${err.message}`);
        }
    }, [token, currentAccount, data]);

    const handleDismiss = useCallback((rec: ActionableRecommendation) => {
        setActiveFeedbackRec(rec);
        setFeedbackModalOpen(true);
    }, []);

    const handleFeedbackSubmitted = useCallback(() => {
        if (data?.actionableRecommendations && activeFeedbackRec) {
            setData({ ...data, actionableRecommendations: data.actionableRecommendations.filter(r => r.id !== activeFeedbackRec.id) });
        }
        setActiveFeedbackRec(null);
    }, [data, activeFeedbackRec]);

    const handleScheduleComplete = useCallback(() => {
        if (data?.actionableRecommendations && activeScheduleRec) {
            setData({ ...data, actionableRecommendations: data.actionableRecommendations.filter(r => r.id !== activeScheduleRec.id) });
        }
        setActiveScheduleRec(null);
    }, [data, activeScheduleRec]);

    const openGuideModal = useCallback((rec: ActionableRecommendation) => {
        setActiveGuideRec(rec);
        setGuideModalOpen(true);
    }, []);

    const closeGuideModal = useCallback(() => {
        setGuideModalOpen(false);
        setActiveGuideRec(null);
    }, []);

    const closeKeywordModal = useCallback(() => {
        setKeywordModalOpen(false);
        setActiveKeywordRec(null);
    }, []);

    const closeFeedbackModal = useCallback(() => {
        setFeedbackModalOpen(false);
        setActiveFeedbackRec(null);
    }, []);

    const closeScheduleModal = useCallback(() => {
        setScheduleModalOpen(false);
        setActiveScheduleRec(null);
    }, []);

    return {
        // State
        loading, refreshing, error, data,
        activeTheme, setActiveTheme,
        recommendations, themes, filteredRecommendations,

        // Modal state
        keywordModalOpen, activeKeywordRec, closeKeywordModal,
        feedbackModalOpen, activeFeedbackRec, closeFeedbackModal,
        scheduleModalOpen, activeScheduleRec, closeScheduleModal,
        guideModalOpen, activeGuideRec, openGuideModal, closeGuideModal,

        // Actions
        fetchSuggestions,
        handleApply,
        handleDismiss,
        handleKeywordConfirm,
        handleFeedbackSubmitted,
        handleScheduleComplete
    };
}
