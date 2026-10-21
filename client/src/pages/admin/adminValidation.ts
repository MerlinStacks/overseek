import { isRecord } from '../../utils/responseValidation';
import type { SystemHealthData, PushSubscriptionData, TestPushResult, Account } from './useDiagnostics';

export const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const strings = (row: Record<string, unknown>, keys: string[]) => keys.every(key => typeof row[key] === 'string');
const counts = (row: Record<string, unknown>, keys: string[]) => keys.every(key => isCount(row[key]));
export function decodeHealth(value: unknown): SystemHealthData {
    const status = (value: unknown) => ['healthy', 'degraded', 'unhealthy'].includes(String(value));
    if (!isRecord(value) || !status(value.status) || typeof value.timestamp !== 'string' || !isRecord(value.version) || !strings(value.version, ['app', 'node', 'uptimeFormatted']) || !isRecord(value.services) || !Object.values(value.services).every(service => isRecord(service) && status(service.status) && (service.latencyMs == null || (typeof service.latencyMs === 'number' && Number.isFinite(service.latencyMs) && service.latencyMs >= 0)) && (service.details == null || typeof service.details === 'string')) || !isRecord(value.queues) || !Object.values(value.queues).every(queue => isRecord(queue) && counts(queue, ['waiting', 'active', 'completed', 'failed'])) || !isRecord(value.webhooks) || !counts(value.webhooks, ['failed24h', 'processed24h', 'received24h']) || !isRecord(value.sync) || !isCount(value.sync.totalAccounts) || !Array.isArray(value.sync.entityTypes) || !value.sync.entityTypes.every(entity => isRecord(entity) && typeof entity.type === 'string' && counts(entity, ['accountsTracked', 'accountsSynced']) && ['oldestSync', 'newestSync'].every(key => entity[key] === null || typeof entity[key] === 'string'))) throw new Error('Invalid system health');
    return value as unknown as SystemHealthData;
}
export function decodeAccounts(value: unknown): Account[] {
    if (!Array.isArray(value) || !value.every(row => isRecord(row) && strings(row, ['id', 'name']))) throw new Error('Invalid accounts');
    return value;
}
export function decodeSubscriptions(value: unknown): PushSubscriptionData {
    if (!isRecord(value) || !counts(value, ['totalSubscriptions', 'uniqueAccounts']) || !isRecord(value.byAccount) || !Object.values(value.byAccount).every(rows => Array.isArray(rows) && rows.every(row => isRecord(row) && strings(row, ['id', 'userId', 'userEmail', 'accountId', 'accountName', 'endpointShort', 'updatedAt']) && (row.userName === null || typeof row.userName === 'string') && typeof row.notifyOrders === 'boolean' && typeof row.notifyMessages === 'boolean'))) throw new Error('Invalid subscriptions');
    return value as unknown as PushSubscriptionData;
}
export function decodeTest(value: unknown): TestPushResult {
    if (!isRecord(value) || typeof value.success !== 'boolean' || !strings(value, ['accountId', 'accountName']) || !counts(value, ['sent', 'failed', 'eligibleSubscriptions']) || !Array.isArray(value.subscriptionIds) || !value.subscriptionIds.every(row => isRecord(row) && strings(row, ['id', 'userId', 'endpointShort']))) throw new Error('Invalid push result');
    return value as unknown as TestPushResult;
}
