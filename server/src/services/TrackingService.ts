/**
 * TrackingService - Backward-compatible facade.
 *
 * This file maintains the original class interface for existing consumers
 * while delegating to the refactored modules in the `tracking/` directory.
 *
 * New code should import directly from `./tracking` instead.
 */

// Re-export everything from the tracking modules for new code
export * from './tracking';

// Import functions for the class facade
import {
    processEvent as _processEvent,
    TrackingEventPayload,
    parseTrafficSource as _parseTrafficSource,
    isBot as _isBot,
    maskIpAddress as _maskIpAddress,
    getLiveVisitors as _getLiveVisitors,
    getLiveCarts as _getLiveCarts,
    getSessionHistory as _getSessionHistory,
    findAbandonedCarts as _findAbandonedCarts,
    markAbandonedNotificationSent as _markAbandonedNotificationSent,
    getStats as _getStats,
    getFunnel as _getFunnel,
    getRevenue as _getRevenue,
    getAttribution as _getAttribution,
    getAbandonmentRate as _getAbandonmentRate,
    getSearches as _getSearches,
    getExitPages as _getExitPages,
    getCohorts as _getCohorts,
    getLTV as _getLTV,
    calculatePurchaseIntent as _calculatePurchaseIntent
} from './tracking';

/**
 * TrackingService class facade for backward compatibility.
 *
 * @deprecated Import from `./tracking` directly for new code.
 */
export class TrackingService {
    static processEvent(data: TrackingEventPayload) {
        return _processEvent(data);
    }

    static getLiveVisitors(accountId: string) {
        return _getLiveVisitors(accountId);
    }

    static getLiveCarts(accountId: string) {
        return _getLiveCarts(accountId);
    }

    static getSessionHistory(sessionId: string) {
        return _getSessionHistory(sessionId);
    }

    static findAbandonedCarts(accountId: string, thresholdMinutes: number = 30) {
        return _findAbandonedCarts(accountId, thresholdMinutes);
    }

    static markAbandonedNotificationSent(sessionId: string) {
        return _markAbandonedNotificationSent(sessionId);
    }

    static parseTrafficSource(referrer: string): string {
        return _parseTrafficSource(referrer);
    }

    static isBot(userAgent: string): boolean {
        return _isBot(userAgent);
    }

    static maskIpAddress(ip: string): string {
        return _maskIpAddress(ip);
    }

    static getStats(accountId: string, days: number = 30, timezone: string = 'Australia/Sydney') {
        return _getStats(accountId, days, timezone);
    }

    static getFunnel(accountId: string, days: number = 30, timezone: string = 'Australia/Sydney') {
        return _getFunnel(accountId, days, timezone);
    }

    static getRevenue(accountId: string, days: number = 30, timezone: string = 'Australia/Sydney') {
        return _getRevenue(accountId, days, timezone);
    }

    static getAttribution(accountId: string, days: number = 30, timezone: string = 'Australia/Sydney') {
        return _getAttribution(accountId, days, timezone);
    }

    static getAbandonmentRate(accountId: string, days: number = 30, timezone: string = 'Australia/Sydney') {
        return _getAbandonmentRate(accountId, days, timezone);
    }

    static getSearches(accountId: string, days: number = 30) {
        return _getSearches(accountId, days);
    }

    static getExitPages(accountId: string, days: number = 30) {
        return _getExitPages(accountId, days);
    }

    static getCohorts(accountId: string) {
        return _getCohorts(accountId);
    }

    static getLTV(accountId: string) {
        return _getLTV(accountId);
    }

    static calculatePurchaseIntent(session: any): number {
        return _calculatePurchaseIntent(session);
    }
}
