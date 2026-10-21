export type SyncErrorCode = 'CONNECTION' | 'AUTH' | 'RATE_LIMIT' | 'REMOTE_ERROR' | 'DATABASE' | 'UNKNOWN';
interface SyncErrorInfo { code: SyncErrorCode; friendlyMessage: string }

/** Prefer structured failures; historical log strings are matched only at code boundaries. */
export function mapSyncError(error: unknown): SyncErrorInfo {
    const record = error && typeof error === 'object' ? error as { message?: unknown; code?: unknown; status?: unknown; response?: { status?: unknown } } : {};
    const message = (typeof error === 'string' ? error : typeof record.message === 'string' ? record.message : '').toLowerCase();
    const status = Number(record.response?.status ?? record.status);
    const code = typeof record.code === 'string' ? record.code.toUpperCase() : '';
    const hasStatus = (codes: number[]) => codes.includes(status) || codes.some(value => new RegExp(`(?:status(?: code)?[:= ]+|http[ /]+)${value}\\b`, 'i').test(message));
    if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET'].includes(code) || /\b(econnrefused|enotfound|etimedout|socket hang up)\b/.test(message)) return { code: 'CONNECTION', friendlyMessage: 'Could not reach the remote service. Check store URL and connectivity.' };
    if (hasStatus([401, 403]) || /\b(unauthorized|forbidden)\b/.test(message)) return { code: 'AUTH', friendlyMessage: 'Authentication failed. Check your WooCommerce connection permissions.' };
    if (hasStatus([429]) || /\b(too many requests|rate limit)\b/.test(message)) return { code: 'RATE_LIMIT', friendlyMessage: 'WooCommerce rate limit reached. Check sync status for retry scheduling.' };
    if (hasStatus([500, 502, 503, 504]) || /\bmaintenance mode\b/.test(message)) return { code: 'REMOTE_ERROR', friendlyMessage: 'WooCommerce is temporarily unavailable. Check sync status before retrying.' };
    if (/^P\d{4}$/.test(code) || /\b(prisma|database)\b/.test(message)) return { code: 'DATABASE', friendlyMessage: 'Database error. Please retry or contact support.' };
    return { code: 'UNKNOWN', friendlyMessage: message ? 'Sync failed. Check sync status or logs for details.' : 'Unknown error. Check sync status or logs.' };
}
