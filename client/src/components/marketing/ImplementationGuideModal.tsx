/**
 * Implementation Guide Modal
 * 
 * Displays detailed implementation specifications for AI Co-Pilot recommendations.
 * Shows keyword suggestions, budget specs, creative guidelines, and step-by-step instructions.
 */

import { useState } from 'react';
import { formatCurrency } from '../../utils/format';
import {
    X,
    Clock,
    CheckCircle2,
    Target,
    DollarSign,
    Search,
    Sparkles,
    FileText,
    Copy,
    ExternalLink,
    Zap,
    TrendingUp,
    Tag,
    Check,
    AlertTriangle,
    Wand2
} from 'lucide-react';
import {
    ActionableRecommendation,
    KeywordSpec,
    BudgetSpec,
    isBudgetAction,
    isKeywordAction,
    isProductAction
} from '../../types/ActionableTypes';

interface ImplementationGuideModalProps {
    isOpen: boolean;
    onClose: () => void;
    recommendation: ActionableRecommendation;
    onApply?: () => void;
}

/**
 * Get bid strategy display name
 */
function getBidStrategyLabel(strategy: BudgetSpec['bidStrategy']): string {
    const labels: Record<string, string> = {
        'maximize_conversions': 'Maximize Conversions',
        'maximize_clicks': 'Maximize Clicks',
        'target_cpa': 'Target CPA',
        'target_roas': 'Target ROAS',
        'manual_cpc': 'Manual CPC'
    };
    return labels[strategy] || strategy;
}

/**
 * Get match type badge color
 */
function getMatchTypeBadge(matchType: string): { bg: string; text: string } {
    switch (matchType) {
        case 'exact': return { bg: 'bg-emerald-100', text: 'text-emerald-700' };
        case 'phrase': return { bg: 'bg-blue-100', text: 'text-blue-700' };
        case 'broad': return { bg: 'bg-amber-100', text: 'text-amber-700' };
        default: return { bg: 'bg-gray-100', text: 'text-gray-700' };
    }
}

/**
 * Get difficulty badge style
 */
function getDifficultyBadge(difficulty: 'easy' | 'medium' | 'advanced'): { bg: string; text: string; label: string } {
    switch (difficulty) {
        case 'easy': return { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Easy' };
        case 'medium': return { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Medium' };
        case 'advanced': return { bg: 'bg-rose-100', text: 'text-rose-700', label: 'Advanced' };
    }
}

export function ImplementationGuideModal({
    isOpen,
    onClose,
    recommendation,
    onApply
}: ImplementationGuideModalProps) {
    const [copiedKeyword, setCopiedKeyword] = useState<string | null>(null);

    if (!isOpen) return null;

    const details = recommendation.implementationDetails;
    const action = recommendation.action;

    // Generate default steps if not provided
    const defaultSteps = generateDefaultSteps(recommendation);
    const steps = details?.steps || defaultSteps;

    // Copy keyword to clipboard
    const copyKeyword = (keyword: string) => {
        navigator.clipboard.writeText(keyword);
        setCopiedKeyword(keyword);
        setTimeout(() => setCopiedKeyword(null), 1500);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-5">
                    <div className="flex items-start justify-between">
                        <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 rounded-xl bg-white/20">
                                    <FileText className="w-5 h-5 text-white" />
                                </div>
                                <h3 className="text-xl font-bold text-white">
                                    Implementation Guide
                                </h3>
                            </div>
                            <p className="text-white/80 text-sm line-clamp-2">
                                {recommendation.headline.replace(/^[^\w]+/, '')}
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                        >
                            <X className="w-5 h-5 text-white" />
                        </button>
                    </div>

                    {/* Quick Stats */}
                    <div className="flex items-center gap-4 mt-4">
                        {details?.estimatedTimeMinutes && (
                            <div className="flex items-center gap-1.5 text-white/80 text-sm">
                                <Clock className="w-4 h-4" />
                                <span>~{details.estimatedTimeMinutes} min</span>
                            </div>
                        )}
                        {details?.difficulty && (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getDifficultyBadge(details.difficulty).bg} ${getDifficultyBadge(details.difficulty).text}`}>
                                {getDifficultyBadge(details.difficulty).label}
                            </span>
                        )}
                        {recommendation.estimatedImpact?.revenueChange && (
                            <div className="flex items-center gap-1.5 text-emerald-200 text-sm">
                                <TrendingUp className="w-4 h-4" />
                                <span>+{formatCurrency(recommendation.estimatedImpact.revenueChange)}/mo potential</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Content */}
                <div className="px-6 py-5 max-h-[60vh] overflow-y-auto">
                    <div className="space-y-6">
                        {/* Keywords Section */}
                        {details?.suggestedKeywords && details.suggestedKeywords.length > 0 && (
                            <section>
                                <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-3">
                                    <Search className="w-5 h-5 text-indigo-600" />
                                    Suggested Keywords
                                </h3>
                                <div className="bg-gray-50 rounded-xl border border-gray-200 overflow-hidden">
                                    <table className="w-full text-sm">
                                        <thead className="bg-gray-100 border-b border-gray-200">
                                            <tr>
                                                <th className="text-left px-4 py-2.5 font-medium text-gray-600">Keyword</th>
                                                <th className="text-left px-4 py-2.5 font-medium text-gray-600">Match Type</th>
                                                <th className="text-right px-4 py-2.5 font-medium text-gray-600">Suggested CPC</th>
                                                <th className="text-right px-4 py-2.5 font-medium text-gray-600">Est. Clicks</th>
                                                <th className="px-4 py-2.5"></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200">
                                            {details.suggestedKeywords.map((kw, idx) => {
                                                const badge = getMatchTypeBadge(kw.matchType);
                                                return (
                                                    <tr key={idx} className="hover:bg-white transition-colors">
                                                        <td className="px-4 py-3 font-medium text-gray-900">
                                                            {kw.keyword}
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge.bg} ${badge.text}`}>
                                                                {kw.matchType}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3 text-right text-gray-700">
                                                            {formatCurrency(kw.suggestedCpc)}
                                                        </td>
                                                        <td className="px-4 py-3 text-right text-gray-500">
                                                            {kw.estimatedClicks ? `~${kw.estimatedClicks}` : '-'}
                                                        </td>
                                                        <td className="px-4 py-3 text-right">
                                                            <button
                                                                onClick={() => copyKeyword(kw.keyword)}
                                                                className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                                                                title="Copy keyword"
                                                            >
                                                                {copiedKeyword === kw.keyword ? (
                                                                    <Check className="w-4 h-4 text-emerald-500" />
                                                                ) : (
                                                                    <Copy className="w-4 h-4" />
                                                                )}
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </section>
                        )}

                        {/* Budget & Bidding Section */}
                        {details?.budgetSpec && (
                            <section>
                                <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-3">
                                    <DollarSign className="w-5 h-5 text-emerald-600" />
                                    Budget & Bidding
                                </h3>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                                        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Daily Budget</p>
                                        <p className="text-xl font-bold text-gray-900">
                                            {formatCurrency(details.budgetSpec.dailyBudget)}
                                        </p>
                                    </div>
                                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                                        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Bid Strategy</p>
                                        <p className="text-lg font-semibold text-gray-900">
                                            {getBidStrategyLabel(details.budgetSpec.bidStrategy)}
                                        </p>
                                    </div>
                                    {details.budgetSpec.targetRoas && (
                                        <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                                            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Target ROAS</p>
                                            <p className="text-xl font-bold text-emerald-600">
                                                {details.budgetSpec.targetRoas}x
                                            </p>
                                        </div>
                                    )}
                                    {details.budgetSpec.targetCpa && (
                                        <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                                            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Target CPA</p>
                                            <p className="text-xl font-bold text-blue-600">
                                                {formatCurrency(details.budgetSpec.targetCpa)}
                                            </p>
                                        </div>
                                    )}
                                    {details.budgetSpec.maxCpc && (
                                        <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                                            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Max CPC</p>
                                            <p className="text-xl font-bold text-gray-900">
                                                {formatCurrency(details.budgetSpec.maxCpc)}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </section>
                        )}

                        {/* Full Ad Spec (for new campaigns) */}
                        {details?.adSpec && (
                            <section>
                                <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-3">
                                    <Sparkles className="w-5 h-5 text-purple-600" />
                                    Ad Creative Specification
                                </h3>
                                <div className="space-y-4">
                                    {/* Final URL & Display Path */}
                                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Final URL</p>
                                                <p className="text-sm font-medium text-blue-600 break-all">{details.adSpec.finalUrl}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Display Path</p>
                                                <p className="text-sm font-medium text-gray-700">
                                                    {new URL(details.adSpec.finalUrl).hostname.replace('www.', '')}/<span className="text-emerald-600">{details.adSpec.displayPath.join('/')}</span>
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Headlines */}
                                    {details.adSpec.headlines.length > 0 && (
                                        <div>
                                            <p className="text-sm font-medium text-gray-600 mb-2">Headlines (RSA - use 3-15)</p>
                                            <div className="flex flex-wrap gap-2">
                                                {details.adSpec.headlines.map((h, idx) => (
                                                    <span key={idx} className="px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-sm font-medium border border-indigo-100">
                                                        {h}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Descriptions */}
                                    {details.adSpec.descriptions.length > 0 && (
                                        <div>
                                            <p className="text-sm font-medium text-gray-600 mb-2">Descriptions (RSA - use 2-4)</p>
                                            <div className="space-y-2">
                                                {details.adSpec.descriptions.map((d, idx) => (
                                                    <p key={idx} className="px-3 py-2 bg-gray-50 text-gray-700 rounded-lg text-sm border border-gray-200">
                                                        {d}
                                                    </p>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Sitelinks */}
                                    {details.adSpec.sitelinks && details.adSpec.sitelinks.length > 0 && (
                                        <div>
                                            <p className="text-sm font-medium text-gray-600 mb-2">Sitelink Extensions</p>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                {details.adSpec.sitelinks.map((sl, idx) => (
                                                    <div key={idx} className="p-3 bg-white rounded-xl border border-gray-200 hover:border-indigo-300 transition-colors">
                                                        <p className="font-medium text-indigo-600 mb-1">{sl.text}</p>
                                                        {sl.description1 && (
                                                            <p className="text-xs text-gray-500">{sl.description1}</p>
                                                        )}
                                                        <p className="text-xs text-blue-500 mt-1 truncate">{sl.finalUrl}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </section>
                        )}

                        {/* Legacy Creative Suggestions (fallback) */}
                        {!details?.adSpec && details?.creativeSpec && (
                            <section>
                                <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-3">
                                    <Sparkles className="w-5 h-5 text-purple-600" />
                                    Ad Creative Suggestions
                                </h3>
                                <div className="space-y-4">
                                    {details.creativeSpec.headlines.length > 0 && (
                                        <div>
                                            <p className="text-sm font-medium text-gray-600 mb-2">Headlines</p>
                                            <div className="flex flex-wrap gap-2">
                                                {details.creativeSpec.headlines.map((h, idx) => (
                                                    <span key={idx} className="px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-sm font-medium border border-indigo-100">
                                                        {h}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {details.creativeSpec.descriptions.length > 0 && (
                                        <div>
                                            <p className="text-sm font-medium text-gray-600 mb-2">Descriptions</p>
                                            <div className="space-y-2">
                                                {details.creativeSpec.descriptions.map((d, idx) => (
                                                    <p key={idx} className="px-3 py-2 bg-gray-50 text-gray-700 rounded-lg text-sm border border-gray-200">
                                                        {d}
                                                    </p>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </section>
                        )}

                        {/* Target Products */}
                        {details?.targetProducts && details.targetProducts.length > 0 && (
                            <section>
                                <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-3">
                                    <Tag className="w-5 h-5 text-orange-600" />
                                    Target Products
                                </h3>
                                <div className="flex flex-wrap gap-2">
                                    {details.targetProducts.map((p, idx) => (
                                        <span key={idx} className="px-3 py-1.5 bg-orange-50 text-orange-700 rounded-lg text-sm font-medium border border-orange-100">
                                            {p.name} {p.sku && `(${p.sku})`}
                                        </span>
                                    ))}
                                </div>
                            </section>
                        )}

                        {/* Structure Notes */}
                        {details?.structureNotes && (
                            <section className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                                <h3 className="flex items-center gap-2 text-sm font-semibold text-blue-800 mb-2">
                                    <Zap className="w-4 h-4" />
                                    Campaign Structure Notes
                                </h3>
                                <p className="text-sm text-blue-700">{details.structureNotes}</p>
                            </section>
                        )}

                        {/* Data Source Notes */}
                        {details?.dataSourceNotes && (
                            <section className="bg-amber-50 rounded-xl p-4 border border-amber-200">
                                <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-800 mb-3">
                                    <AlertTriangle className="w-4 h-4" />
                                    Data Source Notes
                                    {details.copySource === 'ai' && (
                                        <span className="ml-auto flex items-center gap-1 text-xs text-purple-600 font-normal">
                                            <Wand2 className="w-3 h-3" />
                                            AI Generated
                                        </span>
                                    )}
                                </h3>
                                <div className="space-y-2 text-sm">
                                    {details.dataSourceNotes.cpc && (
                                        <div className="flex items-start gap-2">
                                            <DollarSign className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                                            <p className="text-amber-800">
                                                <span className="font-medium">CPC:</span> {details.dataSourceNotes.cpc}
                                            </p>
                                        </div>
                                    )}
                                    {details.dataSourceNotes.keywords && (
                                        <div className="flex items-start gap-2">
                                            <Search className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                                            <p className="text-amber-800">
                                                <span className="font-medium">Keywords:</span> {details.dataSourceNotes.keywords}
                                            </p>
                                        </div>
                                    )}
                                    {details.dataSourceNotes.copy && (
                                        <div className="flex items-start gap-2">
                                            <Sparkles className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                                            <p className="text-amber-800">
                                                <span className="font-medium">Ad Copy:</span> {details.dataSourceNotes.copy}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </section>
                        )}

                        {/* Implementation Steps */}
                        <section>
                            <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-3">
                                <Target className="w-5 h-5 text-rose-600" />
                                Implementation Steps
                            </h3>
                            <div className="space-y-3">
                                {steps.map((step, idx) => (
                                    <div key={idx} className="flex items-start gap-3">
                                        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-bold">
                                            {idx + 1}
                                        </div>
                                        <p className="text-gray-700 pt-0.5">{step}</p>
                                    </div>
                                ))}
                            </div>
                        </section>
                    </div>
                </div>

                {/* Footer */}
                <div className="bg-gray-50 px-6 py-4 border-t border-gray-200 flex items-center justify-between">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium transition-colors"
                    >
                        Close
                    </button>
                    <div className="flex items-center gap-3">
                        <a
                            href={recommendation.platform === 'google'
                                ? 'https://ads.google.com/aw/overview'
                                : 'https://business.facebook.com/adsmanager'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-4 py-2 text-indigo-600 hover:text-indigo-700 font-medium transition-colors"
                        >
                            Open Ads Manager
                            <ExternalLink className="w-4 h-4" />
                        </a>
                        {onApply && (
                            <button
                                onClick={onApply}
                                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors"
                            >
                                <CheckCircle2 className="w-4 h-4" />
                                Apply Now
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * Generate default implementation steps based on recommendation type
 */
function generateDefaultSteps(rec: ActionableRecommendation): string[] {
    const action = rec.action;

    if (isBudgetAction(action)) {
        if (action.actionType === 'budget_increase') {
            return [
                `Open ${rec.platform === 'google' ? 'Google Ads' : 'Meta Ads Manager'} and navigate to Campaigns`,
                `Find campaign "${action.campaignName}"`,
                `Click on the budget column to edit`,
                `Change daily budget from ${formatCurrency(action.currentBudget)} to ${formatCurrency(action.suggestedBudget)}`,
                `Save changes and monitor performance over 7 days`
            ];
        } else if (action.actionType === 'budget_decrease') {
            return [
                `Open ${rec.platform === 'google' ? 'Google Ads' : 'Meta Ads Manager'} and navigate to Campaigns`,
                `Find campaign "${action.campaignName}"`,
                `Click on the budget column to edit`,
                `Reduce daily budget to ${formatCurrency(action.suggestedBudget)}`,
                `Consider pausing underperforming ad groups first`
            ];
        }
    }

    if (isKeywordAction(action)) {
        return [
            `Open Google Ads and navigate to Keywords`,
            `Click "+ Keywords" to add new keywords`,
            `Add keyword "${action.keyword}" with ${action.matchType} match type`,
            `Set initial CPC bid to ${formatCurrency(action.suggestedCpc)}`,
            `Assign to relevant ad group and save`,
            `Monitor performance after 100+ impressions`
        ];
    }

    if (isProductAction(action)) {
        if (action.actionType === 'create_campaign') {
            return [
                'Open Google Ads and click "+ New Campaign"',
                'Select "Sales" as your campaign objective',
                'Choose "Shopping" or "Performance Max" campaign type',
                `Set daily budget based on product margin (suggested: ${action.suggestedBudget ? formatCurrency(action.suggestedBudget) : '$50-100'}/day)`,
                `Add product "${action.productName}" to the campaign`,
                'Set bidding strategy (recommended: Maximize Conversion Value)',
                'Review and launch campaign'
            ];
        }
    }

    // Default generic steps
    return [
        `Review the recommendation details above`,
        `Open your ${rec.platform === 'google' ? 'Google Ads' : 'Meta Ads Manager'} account`,
        `Navigate to the relevant campaign or ad group`,
        `Apply the suggested changes`,
        `Monitor performance for 7-14 days before further optimization`
    ];
}
