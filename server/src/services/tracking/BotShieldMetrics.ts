type MetricKey =
    | 'blockedAgentsRequests'
    | 'blockedAgentsRateLimited'
    | 'blockedAgentsInvalidAccountId'
    | 'blockedAgentsAccountNotFound'
    | 'blockedAgentsSuccess'
    | 'botHitRequests'
    | 'botHitRateLimited'
    | 'botHitInvalidPayload'
    | 'botHitInvalidAccount'
    | 'botHitDroppedByAccountRateLimit'
    | 'botHitProcessed';

const counters: Record<MetricKey, number> = {
    blockedAgentsRequests: 0,
    blockedAgentsRateLimited: 0,
    blockedAgentsInvalidAccountId: 0,
    blockedAgentsAccountNotFound: 0,
    blockedAgentsSuccess: 0,
    botHitRequests: 0,
    botHitRateLimited: 0,
    botHitInvalidPayload: 0,
    botHitInvalidAccount: 0,
    botHitDroppedByAccountRateLimit: 0,
    botHitProcessed: 0,
};

export function incrementBotShieldMetric(key: MetricKey): void {
    counters[key] += 1;
}

export function getBotShieldMetrics() {
    return {
        ...counters,
        generatedAt: new Date().toISOString(),
    };
}
