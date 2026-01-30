/**
 * Statistical Utilities for AI Marketing Co-Pilot
 * 
 * Provides statistical significance testing and confidence scoring
 * for ad performance recommendations.
 */

// =============================================================================
// TYPES
// =============================================================================

export interface ConfidenceResult {
    isSignificant: boolean;
    confidence: 'low' | 'medium' | 'high';
    score: number;           // 0-100
    sampleSize: number;
    pValue?: number;
    minSampleNeeded?: number;
    factors: string[];       // What contributed to confidence
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

// =============================================================================
// STATISTICAL TESTS
// =============================================================================

/**
 * Calculate z-score for a proportion change.
 * Used for conversion rate and CTR comparisons.
 */
function calculateZScore(
    trials1: number, successes1: number,
    trials2: number, successes2: number
): number {
    if (trials1 === 0 || trials2 === 0) return 0;

    const p1 = successes1 / trials1;
    const p2 = successes2 / trials2;
    const pooledP = (successes1 + successes2) / (trials1 + trials2);
    const pooledSE = Math.sqrt(pooledP * (1 - pooledP) * (1 / trials1 + 1 / trials2));

    if (pooledSE === 0) return 0;
    return (p1 - p2) / pooledSE;
}

/**
 * Convert z-score to p-value (two-tailed).
 */
function zScoreToPValue(z: number): number {
    // Approximation using error function
    const absZ = Math.abs(z);
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const t = 1 / (1 + p * absZ / Math.SQRT2);
    const erf = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absZ * absZ / 2);

    return 1 - erf; // Two-tailed p-value
}

/**
 * Test if a conversion rate change is statistically significant.
 * Uses two-proportion z-test.
 */
export function testConversionRateChange(
    controlClicks: number, controlConversions: number,
    testClicks: number, testConversions: number
): ConfidenceResult {
    const factors: string[] = [];
    const totalSample = controlClicks + testClicks;

    // Minimum sample size check
    const minSampleNeeded = 100;
    if (totalSample < minSampleNeeded) {
        factors.push(`Sample size ${totalSample} is below minimum ${minSampleNeeded}`);
        return {
            isSignificant: false,
            confidence: 'low',
            score: Math.min(30, (totalSample / minSampleNeeded) * 30),
            sampleSize: totalSample,
            minSampleNeeded,
            factors
        };
    }

    factors.push(`Total sample size: ${totalSample} clicks`);

    const zScore = calculateZScore(controlClicks, controlConversions, testClicks, testConversions);
    const pValue = zScoreToPValue(zScore);

    factors.push(`z-score: ${zScore.toFixed(2)}, p-value: ${pValue.toFixed(4)}`);

    // Determine significance and confidence
    const isSignificant = pValue < 0.05;
    let confidence: 'low' | 'medium' | 'high' = 'low';
    let score = 30;

    if (pValue < 0.01 && totalSample >= 500) {
        confidence = 'high';
        score = 90 + Math.min(10, (totalSample - 500) / 100);
        factors.push('High statistical significance (p < 0.01) with large sample');
    } else if (pValue < 0.05 && totalSample >= 200) {
        confidence = 'medium';
        score = 60 + Math.min(25, (totalSample - 200) / 20);
        factors.push('Statistically significant (p < 0.05)');
    } else if (pValue < 0.10) {
        confidence = 'low';
        score = 40;
        factors.push('Marginally significant (p < 0.10) - more data needed');
    }

    return {
        isSignificant,
        confidence,
        score: Math.round(score),
        sampleSize: totalSample,
        pValue,
        factors
    };
}

/**
 * Test if a ROAS change between periods is significant.
 * Uses heuristic approach based on variance and sample size.
 */
export function testRoasChange(
    period1: PeriodMetrics,
    period2: PeriodMetrics
): ConfidenceResult {
    const factors: string[] = [];

    // Calculate ROAS if not set
    const roas1 = period1.roas || (period1.spend > 0 ? period1.revenue / period1.spend : 0);
    const roas2 = period2.roas || (period2.spend > 0 ? period2.revenue / period2.spend : 0);

    const roasChange = roas1 > 0 ? ((roas2 - roas1) / roas1) * 100 : 0;
    const conversions = period1.conversions + period2.conversions;
    const totalSpend = period1.spend + period2.spend;

    factors.push(`ROAS changed from ${roas1.toFixed(2)}x to ${roas2.toFixed(2)}x (${roasChange > 0 ? '+' : ''}${roasChange.toFixed(1)}%)`);

    // Minimum conversion check
    if (conversions < 10) {
        factors.push(`Only ${conversions.toFixed(0)} conversions - too few for reliable analysis`);
        return {
            isSignificant: false,
            confidence: 'low',
            score: 20,
            sampleSize: conversions,
            minSampleNeeded: 10,
            factors
        };
    }

    factors.push(`Based on ${conversions.toFixed(0)} conversions, $${totalSpend.toFixed(0)} spend`);

    // Heuristic confidence scoring
    let score = 50;
    let confidence: 'low' | 'medium' | 'high' = 'medium';
    const isSignificant = Math.abs(roasChange) > 15;

    // Adjust based on magnitude of change
    if (Math.abs(roasChange) > 30) {
        score += 20;
        factors.push('Large magnitude change (>30%)');
    } else if (Math.abs(roasChange) > 20) {
        score += 10;
        factors.push('Moderate magnitude change (>20%)');
    }

    // Adjust based on sample size
    if (conversions >= 100) {
        score += 20;
        confidence = 'high';
        factors.push('High conversion count (100+)');
    } else if (conversions >= 30) {
        score += 10;
        factors.push('Adequate conversion count (30+)');
    }

    // Adjust based on spend (more spend = more reliable)
    if (totalSpend >= 1000) {
        score += 10;
        factors.push('Substantial spend volume ($1000+)');
    }

    if (score >= 80) confidence = 'high';
    else if (score >= 55) confidence = 'medium';
    else confidence = 'low';

    return {
        isSignificant,
        confidence,
        score: Math.min(100, Math.round(score)),
        sampleSize: conversions,
        factors
    };
}

/**
 * Calculate anomaly score for a metric value against historical data.
 * Returns number of standard deviations from mean.
 */
export function calculateAnomalyScore(
    currentValue: number,
    historicalValues: number[]
): { zScore: number; isAnomaly: boolean; direction: 'above' | 'below' | 'normal' } {
    if (historicalValues.length < 3) {
        return { zScore: 0, isAnomaly: false, direction: 'normal' };
    }

    const mean = historicalValues.reduce((a, b) => a + b, 0) / historicalValues.length;
    const variance = historicalValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / historicalValues.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) {
        return { zScore: 0, isAnomaly: false, direction: 'normal' };
    }

    const zScore = (currentValue - mean) / stdDev;
    const isAnomaly = Math.abs(zScore) > 2;

    let direction: 'above' | 'below' | 'normal' = 'normal';
    if (zScore > 2) direction = 'above';
    else if (zScore < -2) direction = 'below';

    return { zScore, isAnomaly, direction };
}

/**
 * Calculate overall confidence score for a recommendation.
 * Combines multiple factors into a 0-100 score.
 */
export function calculateRecommendationConfidence(params: {
    sampleSize: number;
    daysCovered: number;
    hasMultiplePeriods: boolean;
    changePercentage: number;
    previousSuccessRate?: number;  // From learning loop
}): ConfidenceResult {
    const factors: string[] = [];
    let score = 50; // Base score

    // Sample size contribution (up to +25)
    if (params.sampleSize >= 100) {
        score += 25;
        factors.push('Large sample size (100+ conversions)');
    } else if (params.sampleSize >= 30) {
        score += 15;
        factors.push('Adequate sample size (30+ conversions)');
    } else if (params.sampleSize >= 10) {
        score += 5;
        factors.push('Minimum sample size (10+ conversions)');
    } else {
        score -= 20;
        factors.push('Insufficient sample size (<10 conversions)');
    }

    // Time coverage contribution (up to +15)
    if (params.daysCovered >= 30) {
        score += 15;
        factors.push('30+ days of data');
    } else if (params.daysCovered >= 14) {
        score += 10;
        factors.push('2+ weeks of data');
    } else if (params.daysCovered >= 7) {
        score += 5;
        factors.push('1 week of data');
    }

    // Multi-period validation (+10)
    if (params.hasMultiplePeriods) {
        score += 10;
        factors.push('Validated across multiple time periods');
    }

    // Change magnitude (larger = more actionable up to +10)
    if (Math.abs(params.changePercentage) > 30) {
        score += 10;
        factors.push('Large performance variance (>30%)');
    } else if (Math.abs(params.changePercentage) > 15) {
        score += 5;
        factors.push('Notable performance variance (>15%)');
    }

    // Historical success rate (up to +10 or -10)
    if (params.previousSuccessRate !== undefined) {
        if (params.previousSuccessRate > 0.7) {
            score += 10;
            factors.push(`Similar recommendations had ${Math.round(params.previousSuccessRate * 100)}% success rate`);
        } else if (params.previousSuccessRate < 0.3) {
            score -= 10;
            factors.push(`Warning: Similar recommendations had low success rate`);
        }
    }

    // Clamp and determine level
    score = Math.max(10, Math.min(100, score));

    let confidence: 'low' | 'medium' | 'high' = 'low';
    if (score >= 75) confidence = 'high';
    else if (score >= 50) confidence = 'medium';

    return {
        isSignificant: score >= 50,
        confidence,
        score: Math.round(score),
        sampleSize: params.sampleSize,
        factors
    };
}
