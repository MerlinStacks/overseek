/**
 * Marketing Co-Pilot Configuration
 * 
 * Centralized configuration for all AI Marketing Co-Pilot thresholds,
 * periods, and constants. Eliminates magic numbers across analyzers.
 */


export const THRESHOLDS = {
    // ROAS thresholds
    roasCrashPercent: 30,           // % drop to trigger critical alert
    roasWarningPercent: 20,         // % drop to trigger warning
    roasGood: 2.0,                  // ROAS considered healthy
    roasPoor: 1.0,                  // ROAS considered problematic

    // CTR thresholds (percentages)
    ctrLow: 0.5,                    // CTR below this needs attention
    ctrVeryLow: 0.3,                // CTR below this is critical
    ctrGood: 1.5,                   // CTR considered healthy
    ctrDropPercent: 40,             // % CTR drop to alert

    // CPA thresholds
    cpaSpikePercent: 50,            // % CPA increase to alert

    // Conversion thresholds
    lowConversionVolume: 30,        // PMax needs 30+ conversions
    minConversionsForConfidence: 10, // Min conversions for reliable analysis
    zeroConversionSpendThreshold: 100, // $ spent to alert on 0 conversions

    // Budget thresholds
    budgetDepletionPercent: 80,     // % spent to warn about depletion
    minSpendForAnalysis: 50,        // Minimum $ spend to analyze

    // Repeat/LTV
    lowRepeatRate: 15,              // % repeat rate considered low
    highRepeatRate: 30,             // % repeat rate considered good

    // Audience
    highFrequency: 3.0,             // Frequency above this = fatigue risk
    creativeFrequencyLimit: 5.0,    // Creative definitely fatigued

    // Learning phase
    pmaxLearningDays: 14,           // PMax learning period
    metaLearningEvents: 50,         // Events for Meta learning
} as const;


export const PERIODS = {
    short: 7,   // 7 days
    medium: 30, // 30 days  
    long: 90,   // 90 days

    // Specific use cases
    alertCheck: 7,
    trendAnalysis: 30,
    ltvAnalysis: 365,
    recommendationExpiry: 7,
} as const;


export const CONFIDENCE = {
    // Sample size weights
    minSampleForHigh: 100,        // Conversions for high confidence
    minSampleForMedium: 30,       // Conversions for medium confidence

    // Spend weights
    minSpendForHigh: 1000,        // $ spend for high confidence
    minSpendForMedium: 200,       // $ spend for medium confidence

    // Trend weights (how much trend improves confidence)
    trendBonus: 10,               // Points if trend is clear
    priorityBonus: 5,             // Points per priority level

    // Thresholds
    highScore: 70,
    mediumScore: 40,
} as const;


export const FUNNEL_STAGES = ['awareness', 'consideration', 'conversion', 'retention'] as const;
export type FunnelStage = typeof FUNNEL_STAGES[number];

// Benchmarks by funnel stage
export const FUNNEL_BENCHMARKS: Record<FunnelStage, { ctr: number; roas: number; cpc: number }> = {
    awareness: { ctr: 0.5, roas: 0.5, cpc: 2.0 },
    consideration: { ctr: 1.0, roas: 1.5, cpc: 1.5 },
    conversion: { ctr: 2.0, roas: 3.0, cpc: 1.0 },
    retention: { ctr: 3.0, roas: 5.0, cpc: 0.5 },
};


export const PRIORITY = {
    URGENT: 1,
    IMPORTANT: 2,
    INFO: 3,
} as const;

export const CATEGORIES = [
    'performance',
    'budget',
    'creative',
    'audience',
    'structure',
    'optimization',
] as const;

export type SuggestionCategory = typeof CATEGORIES[number];
