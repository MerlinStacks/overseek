import { Prisma } from '@prisma/client';

/** Caller holds Account. A settings save never invents merchant activation intent. */
export async function requestSettingsRevalidation(tx: Prisma.TransactionClient, accountId: string) {
    await tx.receiptAccount.updateMany({ where: { accountId, desiredActive: true, receivingFrozen: false,
        OR: [{ controlAction: null }, { controlAction: 'activate' }] }, data: {
        revalidationRequested: true, controlAction: 'activate', controlRevision: { increment: 1 }, controlPayload: Prisma.DbNull,
        controlAttempts: 0, controlNextAttemptAt: new Date(), controlError: 'Settings changed; awaiting synchronization and readiness revalidation.',
    } });
}
