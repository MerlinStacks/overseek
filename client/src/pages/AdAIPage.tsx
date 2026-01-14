/**
 * AI Ad Management Page
 * 
 * Dedicated page for AI-powered ad optimization with priority-sorted suggestions.
 * Features glassmorphism UI and actionable recommendation cards.
 */

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAccount } from '../context/AccountContext';
import {
    AlertTriangle,
    Lightbulb,
    RefreshCw,
    ArrowLeft,
    CheckCircle,
    AlertCircle,
    Info,
    MessageCirclePlus,
    Sparkles,
    Zap
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AdContextModal } from '../components/marketing/AdContextModal';
import { ActionableRecommendationCard } from '../components/marketing/ActionableRecommendationCard';
import { ActionableRecommendation } from '../types/ActionableTypes';
import { AddKeywordModal } from '../components/marketing/AddKeywordModal';

import { CampaignWizard } from '../components/marketing/CampaignWizard/CampaignWizard';

interface PrioritizedSuggestion {
    text: string;
    priority: 1 | 2 | 3;
    category: string;
}

interface SuggestionsData {
    suggestions: string[]; // Legacy
    prioritized: PrioritizedSuggestion[]; // Legacy
    actionableRecommendations?: ActionableRecommendation[]; // New structured data
    summary?: any;
    action_items?: string[];
    message?: string;
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

    // Keyword Modal State
    const [keywordModalOpen, setKeywordModalOpen] = useState(false);
    const [activeKeywordRec, setActiveKeywordRec] = useState<ActionableRecommendation | null>(null);

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

    const handleKeywordConfirm = async (rec: ActionableRecommendation, keywordData: { keyword: string; matchType: string; bid: number; adGroupId: string }) => {
        if (!token || !currentAccount) return;

        // Optimistic update
        const originalData = data;
        if (data && data.actionableRecommendations) {
            const newData = {
                ...data,
                actionableRecommendations: data.actionableRecommendations.filter(r => r.id !== rec.id)
            };
            setData(newData);
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
                        adAccountId: (rec as any).adAccountId // If available, otherwise backend finds it
                    }
                })
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Failed to add keyword');
            }
            console.log('Keyword added successfully');
        } catch (err: any) {
            console.error('Failed to add keyword', err);
            setData(originalData); // Revert
            alert(`Failed to add keyword: ${err.message}`);
        }
    };

    const handleApply = async (rec: ActionableRecommendation) => {
        if (!token || !currentAccount) return;

        // Special handling for keyword additions - needs modal
        if (rec.action.actionType === 'add_keyword') {
            setActiveKeywordRec(rec);
            setKeywordModalOpen(true);
            return;
        }

        // Optimistically remove from UI to feel instant
        // In a real app, we might show a spinner on the card instead
        const originalData = data;

        // Remove the item from the list visually
        if (data && data.actionableRecommendations) {
            const newData = {
                ...data,
                actionableRecommendations: data.actionableRecommendations.filter(r => r.id !== rec.id)
            };
            setData(newData);
        }

        try {
            let parameters: any = {};
            let actionType = '';

            // Map frontend action to backend parameters
            if (rec.action.actionType === 'budget_increase' || rec.action.actionType === 'budget_decrease') {
                // TS check or cast - we know it's BudgetAction if types match
                const budgetAction = rec.action as any;
                parameters.amount = budgetAction.suggestedBudget;
                actionType = budgetAction.actionType;
            } else if (rec.action.actionType === 'pause' || rec.action.actionType === 'enable') {
                actionType = rec.action.actionType;
            } else {
                console.warn('Action type not yet supported for execution:', rec.action.actionType);
                // Revert optimistic update
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
                    actionType: actionType,
                    platform: rec.platform,
                    campaignId: (rec.action as any).campaignId, // BudgetAction has campaignId
                    parameters
                })
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Failed to execute action');
            }

            // Success - maybe show a toast
            console.log('Action executed successfully');

        } catch (err: any) {
            console.error('Failed to apply recommendation', err);
            // Revert optimistic update on error
            setData(originalData);
            alert(`Failed to apply action: ${err.message}`);
        }
    };

    const handleDismiss = (rec: ActionableRecommendation) => {
        console.log('Dismissing recommendation:', rec);
        // Could remove from list locally
    };

    // Separate recommendations by priority
    const actionableRecs = data?.actionableRecommendations || [];
    const urgentItems = actionableRecs.filter(s => s.priority === 1);
    const importantItems = actionableRecs.filter(s => s.priority === 2);
    const opportunityItems = actionableRecs.filter(s => s.priority === 3);

    // Fallback to legacy items if no actionable ones (backward compatibility)
    const hasLegacyOnly = actionableRecs.length === 0 && (data?.prioritized?.length || 0) > 0;

    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 p-8 flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                        <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <Sparkles className="w-6 h-6 text-blue-500 animate-pulse" />
                        </div>
                    </div>
                    <p className="text-gray-500 font-medium">Analyzing campaign performance...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6 md:p-8">
            <div className="max-w-5xl mx-auto space-y-8">

                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => navigate('/marketing?tab=ads')}
                            className="p-2 hover:bg-white rounded-xl transition-all shadow-sm hover:shadow text-gray-600"
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                                <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-2 rounded-lg text-white shadow-lg shadow-blue-500/20">
                                    <Zap size={24} fill="currentColor" />
                                </div>
                                AI Co-pilot
                            </h1>
                            <p className="text-gray-500 mt-1">Real-time actionable insights for your campaigns</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setShowCampaignWizard(true)}
                            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-all shadow-md shadow-blue-500/20"
                        >
                            <Sparkles size={18} />
                            Create Campaign
                        </button>
                        <button
                            onClick={() => setShowContextModal(true)}
                            className="flex items-center gap-2 px-4 py-2.5 bg-white text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-all border border-gray-200 shadow-sm"
                        >
                            <MessageCirclePlus size={18} />
                            Add Context
                        </button>
                        <button
                            onClick={() => fetchSuggestions(true)}
                            disabled={refreshing}
                            className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-white font-medium rounded-xl hover:bg-gray-800 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-70 disabled:hover:translate-y-0"
                        >
                            <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
                            {refreshing ? 'Analyzing...' : 'Refresh Analysis'}
                        </button>
                    </div>
                </div>

                <CampaignWizard
                    isOpen={showCampaignWizard}
                    onClose={() => setShowCampaignWizard(false)}
                />

                <AdContextModal
                    isOpen={showContextModal}
                    onClose={() => setShowContextModal(false)}
                    onSaved={() => fetchSuggestions(true)}
                />

                {/* Keyword Addition Modal */}
                {activeKeywordRec && (
                    <AddKeywordModal
                        isOpen={keywordModalOpen}
                        onClose={() => setKeywordModalOpen(false)}
                        recommendation={activeKeywordRec}
                        onConfirm={async (data) => {
                            await handleKeywordConfirm(activeKeywordRec, data);
                            setKeywordModalOpen(false);
                            setActiveKeywordRec(null);
                        }}
                    />
                )}

                {/* Error state */}
                {error && (
                    <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-red-700 flex items-start gap-3">
                        <AlertCircle className="shrink-0 mt-0.5" />
                        <div>
                            <h3 className="font-semibold">Analysis Failed</h3>
                            <p className="text-sm opacity-90">{error}</p>
                        </div>
                    </div>
                )}

                {/* Main Content */}
                <div className="space-y-8">

                    {/* Urgent Section */}
                    {urgentItems.length > 0 && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 text-red-600 font-bold uppercase tracking-wider text-sm ml-1">
                                <AlertTriangle size={16} />
                                Requires Attention
                            </div>
                            <div className="grid gap-4">
                                {urgentItems.map(rec => (
                                    <ActionableRecommendationCard
                                        key={rec.id}
                                        recommendation={rec}
                                        onApply={handleApply}
                                        onDismiss={handleDismiss}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Important Section */}
                    {importantItems.length > 0 && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 text-amber-600 font-bold uppercase tracking-wider text-sm ml-1">
                                <Zap size={16} />
                                High Impact Opportunities
                            </div>
                            <div className="grid gap-4">
                                {importantItems.map(rec => (
                                    <ActionableRecommendationCard
                                        key={rec.id}
                                        recommendation={rec}
                                        onApply={handleApply}
                                        onDismiss={handleDismiss}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Optimization Section */}
                    {opportunityItems.length > 0 && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 text-blue-600 font-bold uppercase tracking-wider text-sm ml-1">
                                <Lightbulb size={16} />
                                Optimizations & Insights
                            </div>
                            <div className="grid gap-4">
                                {opportunityItems.map(rec => (
                                    <ActionableRecommendationCard
                                        key={rec.id}
                                        recommendation={rec}
                                        onApply={handleApply}
                                        onDismiss={handleDismiss}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Empty State */}
                    {!loading && !error && actionableRecs.length === 0 && !hasLegacyOnly && (
                        <div className="bg-white/50 backdrop-blur-sm border border-white/60 rounded-3xl p-12 text-center shadow-sm">
                            <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                                <CheckCircle size={40} />
                            </div>
                            <h3 className="text-xl font-bold text-gray-900 mb-2">All Systems Optimized</h3>
                            <p className="text-gray-500 max-w-md mx-auto">
                                Your campaigns are running smoothly. The AI Co-pilot analyzes your data 24/7 and will alert you when opportunities arise.
                            </p>
                            <button
                                onClick={() => fetchSuggestions(true)}
                                className="mt-8 text-blue-600 hover:text-blue-700 font-medium hover:underline"
                            >
                                Force Re-analysis
                            </button>
                        </div>
                    )}

                    {/* Legacy Items Fallback */}
                    {hasLegacyOnly && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 text-gray-500 font-bold uppercase tracking-wider text-sm ml-1">
                                <Info size={16} />
                                General Suggestions
                            </div>
                            <div className="grid gap-4">
                                {data?.prioritized?.map((item, idx) => (
                                    <div key={idx} className="bg-white/80 backdrop-blur border border-white/20 p-6 rounded-2xl shadow-sm">
                                        <div className="flex gap-4">
                                            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl h-fit">
                                                <Info size={24} />
                                            </div>
                                            <div>
                                                <h3 className="font-medium text-gray-900 mb-1">{item.text}</h3>
                                                <span className="text-xs font-medium px-2 py-1 bg-gray-100 text-gray-600 rounded-md uppercase tracking-wider">
                                                    {item.category}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
}
