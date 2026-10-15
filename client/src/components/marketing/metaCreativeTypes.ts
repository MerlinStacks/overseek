export interface CreativeMetrics {
    spend: number;
    impressions: number;
    clicks: number;
    purchases: number;
    revenue: number;
    ctr: number;
    cpc: number | null;
    cpa: number | null;
    roas: number;
}

export interface CreativePerformance {
    creative: {
        id: string;
        name: string;
        format: 'image' | 'video' | 'carousel' | 'dynamic' | 'unknown';
        primaryTexts: string[];
        headlines: string[];
        descriptions: string[];
        callToActions: string[];
        assets: { kind: 'image' | 'video_thumbnail'; url: string }[];
        destinationUrl: string | null;
    };
    metrics: CreativeMetrics;
    ads: { id: string; name: string; status: string; frequency: number | null }[];
    fatigue: {
        status: 'potential_fatigue' | 'no_signal' | 'insufficient_data';
        reasons: string[];
        recent: CreativeMetrics;
        previous: CreativeMetrics;
    };
}

export interface CreativeReport {
    adAccountId: string;
    adsetId: string;
    days: number;
    currency: string;
    since: string;
    until: string;
    comparison: { recentSince: string; recentUntil: string; previousSince: string; previousUntil: string } | null;
    creatives: CreativePerformance[];
    warnings: string[];
}

export interface CreativeReview {
    summary: string;
    strengths: string[];
    concerns: string[];
    tests: { hypothesis: string; primaryText: string; headline: string; visualBrief: string }[];
    caveats: string[];
    model: string;
    reviewedAt: string;
    visualReview: { imagesProvided: number; videoReviewed: boolean };
}
