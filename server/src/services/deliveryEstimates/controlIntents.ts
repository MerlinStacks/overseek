import { Prisma } from '@prisma/client';

/** Caller holds Account. Independent of settings/configuration capability or build state.
 * Preserve active leases; revision fencing prevents an older activation ACK from winning.
 */
export async function queueDeliveryDisable(tx: Prisma.TransactionClient, accountId: string) {
    return tx.receiptAccount.upsert({ where: { accountId },
        create: { accountId, desiredActive: false, controlAction: 'disable', controlRevision: 1 },
        update: { desiredActive: false, revalidationRequested: false, controlAction: 'disable', controlRevision: { increment: 1 },
            controlPayload: Prisma.DbNull, controlAttempts: 0, controlError: null, controlNextAttemptAt: new Date() },
    });
}
