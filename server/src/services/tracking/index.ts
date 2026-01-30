/**
 * Tracking module barrel export.
 *
 * Re-exports all tracking-related services for convenient imports.
 */

// Event processing
export { processEvent, TrackingEventPayload } from './EventProcessor';

// Traffic analysis utilities
export { parseTrafficSource, isBot, maskIpAddress } from './TrafficAnalyzer';

// Live analytics
export { getLiveVisitors, getLiveCarts, getSessionHistory, getVisitorCount24h, LiveCartItem, LiveCartSession } from './LiveAnalytics';

// Abandoned cart detection
export { findAbandonedCarts, markAbandonedNotificationSent, getHighValueCarts, triggerAbandonedCartAutomations } from './AbandonedCartService';

// Aggregated metrics
export {
    getStats,
    getFunnel,
    getRevenue,
    getAttribution,
    getAbandonmentRate,
    getSearches,
    getExitPages
} from './MetricsService';

// Cohort and LTV analysis
export { getCohorts, getLTV, calculatePurchaseIntent } from './CohortLTVService';

// IP Exclusion
export { isExcludedIp, getExcludedIps, matchesExclusionList, normalizeIp } from './IpExclusionService';
