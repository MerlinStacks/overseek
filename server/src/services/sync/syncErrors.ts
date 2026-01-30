export type SyncErrorCode =
    | 'CONNECTION'
    | 'AUTH'
    | 'RATE_LIMIT'
    | 'REMOTE_ERROR'
    | 'DATABASE'
    | 'UNKNOWN';

interface SyncErrorInfo {
    code: SyncErrorCode;
    friendlyMessage: string;
}

export function mapSyncError(errorMessage?: string | null): SyncErrorInfo {
    const message = (errorMessage || '').toLowerCase();

    if (!message) {
        return {
            code: 'UNKNOWN',
            friendlyMessage: 'Unknown error. Try again or check logs.'
        };
    }

    if (message.includes('econnrefused') || message.includes('enotfound') || message.includes('etimedout') || message.includes('socket hang up')) {
        return {
            code: 'CONNECTION',
            friendlyMessage: 'Could not reach WooCommerce. Check store URL and connectivity.'
        };
    }

    if (message.includes('401') || message.includes('403') || message.includes('unauthorized') || message.includes('forbidden')) {
        return {
            code: 'AUTH',
            friendlyMessage: 'Authentication failed. Reconnect your WooCommerce credentials.'
        };
    }

    if (message.includes('429') || message.includes('too many requests') || message.includes('rate limit')) {
        return {
            code: 'RATE_LIMIT',
            friendlyMessage: 'WooCommerce rate limit hit. Retrying automatically.'
        };
    }

    if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) {
        return {
            code: 'REMOTE_ERROR',
            friendlyMessage: 'WooCommerce is temporarily unavailable. Retrying soon.'
        };
    }

    if (message.includes('prisma') || message.includes('database') || message.includes('db')) {
        return {
            code: 'DATABASE',
            friendlyMessage: 'Database error. Please retry or contact support.'
        };
    }

    return {
        code: 'UNKNOWN',
        friendlyMessage: 'Sync failed. Try again or check logs for details.'
    };
}
