/**
 * Actionable Change Card
 * 
 * Displays detailed actionable recommendations in the bottom grid section.
 * Shows platform, campaign type, score, headline, metrics, and action buttons.
 */

import {
    ArrowRight,
    Eye,
    CheckCircle2
} from 'lucide-react';
import { ActionableRecommendation, isBudgetAction, isKeywordAction } from '../../types/ActionableTypes';

interface ActionableChangeCardProps {
    recommendation: ActionableRecommendation;
    onImplementationGuide: () => void;
    onApply: () => void;
}

/**
 * Get platform badge configuration
 */
function getPlatformConfig(platform: string): { letter: string; bg: string; text: string } {
    switch (platform) {
        case 'google':
            return { letter: 'G', bg: 'bg-gray-100', text: 'text-gray-700' };
        case 'meta':
            return { letter: 'M', bg: 'bg-blue-100', text: 'text-blue-700' };
        default:
            return { letter: 'G', bg: 'bg-gray-100', text: 'text-gray-600' };
    }
}

/**
 * Get campaign type from recommendation
 */
function getCampaignType(rec: ActionableRecommendation): string {
    if (rec.tags?.includes('search')) return 'SEARCH';
    if (rec.tags?.includes('shopping')) return 'SHOPPING';
    if (rec.tags?.includes('pmax')) return 'PMAX';
    if (rec.category === 'creative') return 'CREATIVE';
    if (rec.category === 'budget') return 'BUDGET';
    if (rec.category === 'audience') return 'AUDIENCE';
    return rec.category.toUpperCase();
}

/**
 * Get score color based on value
 */
function getScoreColor(score: number): string {
    if (score >= 80) return 'text-emerald-600';
    if (score >= 60) return 'text-blue-600';
    if (score >= 40) return 'text-amber-600';
    return 'text-gray-500';
}

/**
 * Extract key metrics from recommendation for display
 */
function extractMetrics(rec: ActionableRecommendation): { label: string; value: string; highlight?: boolean }[] {
    const metrics: { label: string; value: string; highlight?: boolean }[] = [];
    const action = rec.action;
    const details = rec.implementationDetails;

    if (isBudgetAction(action)) {
        if (action.actionType === 'budget_increase' || action.actionType === 'budget_decrease') {
            metrics.push({ label: 'Current Budget', value: `$${action.currentBudget.toFixed(0)}` });
            metrics.push({ label: 'Suggested Budget', value: `$${action.suggestedBudget.toFixed(0)}`, highlight: true });
            metrics.push({ label: 'Change', value: `${action.changePercent > 0 ? '+' : ''}${action.changePercent}%` });
        }
    }

    if (isKeywordAction(action)) {
        metrics.push({ label: 'Keyword', value: `"${action.keyword}"` });
        metrics.push({ label: 'Match Type', value: action.matchType });
        metrics.push({ label: 'Suggested CPC', value: `$${action.suggestedCpc.toFixed(2)}`, highlight: true });
    }

    // Add from implementation details
    if (details?.budgetSpec) {
        if (metrics.length === 0) {
            metrics.push({ label: 'Daily Budget', value: `$${details.budgetSpec.dailyBudget}` });
        }
        if (details.budgetSpec.targetRoas) {
            metrics.push({ label: 'Target ROAS', value: `${details.budgetSpec.targetRoas}x`, highlight: true });
        }
    }

    if (details?.suggestedKeywords && details.suggestedKeywords.length > 0) {
        metrics.push({ label: 'Keywords', value: `${details.suggestedKeywords.length} suggested` });
    }

    if (details?.difficulty) {
        const diffLabel = details.difficulty.charAt(0).toUpperCase() + details.difficulty.slice(1);
        metrics.push({ label: 'Difficulty', value: diffLabel });
    }

    // Fill remaining slots with data points
    if (metrics.length < 3 && rec.dataPoints.length > 0) {
        for (const dp of rec.dataPoints) {
            if (metrics.length >= 3) break;
            const parts = dp.split(':');
            if (parts.length === 2) {
                metrics.push({ label: parts[0].trim(), value: parts[1].trim() });
            }
        }
    }

    return metrics.slice(0, 4);
}

export function ActionableChangeCard({
    recommendation,
    onImplementationGuide,
    onApply
}: ActionableChangeCardProps) {
    const platformConfig = getPlatformConfig(recommendation.platform === 'both' ? 'google' : recommendation.platform);
    const campaignType = getCampaignType(recommendation);
    const metrics = extractMetrics(recommendation);
    const hasGuide = !!recommendation.implementationDetails;

    return (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 hover:shadow-lg hover:border-gray-300 transition-all">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <span className={`w-6 h-6 rounded-full ${platformConfig.bg} flex items-center justify-center text-xs font-bold ${platformConfig.text}`}>
                        {platformConfig.letter}
                    </span>
                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {campaignType}
                    </span>
                </div>
                <span className={`text-sm font-bold ${getScoreColor(recommendation.confidence)}`}>
                    Score: {recommendation.confidence}
                </span>
            </div>

            {/* Headline */}
            <h3 className="font-bold text-gray-900 mb-4 line-clamp-2">
                {recommendation.headline.replace(/^[^\w]+/, '')}
            </h3>

            {/* Metrics Grid */}
            {metrics.length > 0 && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-5">
                    {metrics.map((metric, idx) => (
                        <div key={idx} className="flex justify-between items-baseline">
                            <span className="text-sm text-gray-500">{metric.label}</span>
                            <span className={`text-sm font-semibold ${metric.highlight ? 'text-emerald-600' : 'text-gray-900'}`}>
                                {metric.value}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {/* Action Button */}
            {hasGuide ? (
                <button
                    onClick={onImplementationGuide}
                    className="w-full py-3 px-4 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium transition-colors flex items-center justify-center gap-2"
                >
                    Implementation Guide
                    <ArrowRight className="w-4 h-4" />
                </button>
            ) : (
                <button
                    onClick={onApply}
                    className="w-full py-3 px-4 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium transition-colors flex items-center justify-center gap-2"
                >
                    View Details
                    <Eye className="w-4 h-4" />
                </button>
            )}
        </div>
    );
}
