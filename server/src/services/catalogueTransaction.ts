import type { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { retryWithBackoff } from '../utils/retryWithBackoff';
import { lockDeliveryAccount } from './deliveryEstimates/intents';

/** Retry the whole transaction, never a statement in an aborted/superseded
 * serializable snapshot. Callers must keep HTTP/indexing outside this callback. */
export function catalogueTransaction<T>(accountId: string, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return retryWithBackoff(() => prisma.$transaction(async tx => {
        await lockDeliveryAccount(tx, accountId);
        return work(tx);
    }, { isolationLevel: 'Serializable', timeout: 15_000 }), {
        maxRetries: 3, baseDelayMs: 25, maxDelayMs: 250, context: 'Catalogue transaction',
        retryOn: error => ['P2034', '40001', '40P01'].includes(error?.code)
            || ['40001', '40P01'].includes(error?.meta?.code)
            // Prisma 7's pg adapter wraps a raw account-lock failure as P2010.
            || ['40001', '40P01'].includes(error?.meta?.driverAdapterError?.cause?.originalCode),
    });
}
