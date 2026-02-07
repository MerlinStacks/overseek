/**
 * Analysis Types
 * 
 * Shared type definitions for the AI Marketing Co-Pilot analysis pipeline.
 */

import { SuggestionCategory } from '../config/MarketingCopilotConfig';


import { ActionableRecommendation } from './ActionableTypes';

/**
 * Unified suggestion format used across all analyzers.
 */
export interface Suggestion {
    id: string;
    priority: 1 | 2 | 3;              // 1=urgent, 2=important, 3=info
    category: SuggestionCategory;
    text: string;
    explanation?: string;
    dataPoints?: string[];
    confidence: number;               // 0-100
    source: string;                   // Analyzer that generated this
    platform?: 'google' | 'meta' | 'both';
    campaignId?: string;
    campaignName?: string;
    tags?: string[];
}

/**
 * Helper to create suggestions with defaults.
 */
export function createSuggestion(
    partial: Partial<Suggestion> & Pick<Suggestion, 'id' | 'text' | 'source'>
): Suggestion {
    return {
        priority: 3,
        category: 'optimization',
        confidence: 50,
        ...partial,
    };
}


/**
 * Base interface for all analyzer results.
 */
export interface BaseAnalysisResult {
    hasData: boolean;
    suggestions: Suggestion[];
    actionableRecommendations?: ActionableRecommendation[];
    metadata: AnalysisMetadata;
}

export interface AnalysisMetadata {
    analyzedAt: Date;
    durationMs: number;
    source: string;
    accountId: string;
}


export interface UnifiedAnalysis {
    hasData: boolean;
    suggestions: Suggestion[];
    actionableRecommendations?: any[]; // From ProductOpportunityAnalyzer, KeywordOpportunityAnalyzer

    // Individual analyzer results
    results: {
        multiPeriod?: BaseAnalysisResult;
        crossChannel?: BaseAnalysisResult;
        ltv?: BaseAnalysisResult;
        funnel?: BaseAnalysisResult;
        audience?: BaseAnalysisResult;
        knowledgeBase?: BaseAnalysisResult;
    };

    // Aggregate metrics
    summary: {
        totalSuggestions: number;
        urgentCount: number;
        importantCount: number;
        infoCount: number;
        topConfidence: number;
        analyzersRun: number;
        totalDurationMs: number;
    };

    metadata: AnalysisMetadata;
}


export interface CampaignInsight {
    campaignId: string;
    campaignName: string;
    platform: 'google' | 'meta';
    campaignType?: string;

    // Core metrics
    spend: number;
    revenue: number;
    conversions: number;
    clicks: number;
    impressions: number;

    // Calculated metrics  
    roas: number;
    ctr: number;
    cpc: number;
    cpa: number;

    // Optional context
    status?: string;
    startDate?: Date;
    daysActive?: number;
}


export type TrendDirection = 'improving' | 'stable' | 'declining';

export interface Trend {
    direction: TrendDirection;
    changePercent: number;
    isSignificant: boolean;
}


export interface PeriodMetrics {
    spend: number;
    revenue: number;
    clicks: number;
    impressions: number;
    conversions: number;
    roas: number;
    ctr: number;
    cpc: number;
    cpa: number;
}

export function emptyPeriodMetrics(): PeriodMetrics {
    return {
        spend: 0,
        revenue: 0,
        clicks: 0,
        impressions: 0,
        conversions: 0,
        roas: 0,
        ctr: 0,
        cpc: 0,
        cpa: 0,
    };
}
