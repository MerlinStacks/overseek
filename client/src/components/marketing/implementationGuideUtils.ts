/**
 * Implementation Guide Utilities
 * 
 * Helper functions and default step generators for the Implementation Guide Modal.
 */

import { formatCurrency } from '../../utils/format';
import {
    ActionableRecommendation,
    isBudgetAction,
    isKeywordAction,
    isProductAction
} from '../../types/ActionableTypes';
import type { BudgetSpec } from '../../types/ActionableTypes';

/**
 * Get bid strategy display name.
 */
export function getBidStrategyLabel(strategy: BudgetSpec['bidStrategy']): string {
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
 * Get match type badge color.
 */
export function getMatchTypeBadge(matchType: string): { bg: string; text: string } {
    switch (matchType) {
        case 'exact': return { bg: 'bg-emerald-100', text: 'text-emerald-700' };
        case 'phrase': return { bg: 'bg-blue-100', text: 'text-blue-700' };
        case 'broad': return { bg: 'bg-amber-100', text: 'text-amber-700' };
        default: return { bg: 'bg-gray-100', text: 'text-gray-700' };
    }
}

/**
 * Get difficulty badge style.
 */
export function getDifficultyBadge(difficulty: 'easy' | 'medium' | 'advanced'): { bg: string; text: string; label: string } {
    switch (difficulty) {
        case 'easy': return { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Easy' };
        case 'medium': return { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Medium' };
        case 'advanced': return { bg: 'bg-rose-100', text: 'text-rose-700', label: 'Advanced' };
    }
}

/**
 * Generate default implementation steps based on recommendation type.
 */
export function generateDefaultSteps(rec: ActionableRecommendation): string[] {
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
