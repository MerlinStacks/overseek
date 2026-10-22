import crypto from 'node:crypto';
import { prisma } from '../../utils/prisma';
import { trustedAccount } from './analysisObservations';
/** Durable admission, not a refund-on-error counter: provider cost can be ambiguous. */
export async function claimAdCopyGeneration(accountId: string, units: number) {
    trustedAccount(accountId);
    if (!Number.isInteger(units) || units < 1 || units > 20) throw new Error('Invalid generation work');
    const owner = crypto.randomUUID(), now = new Date(), windowStart = new Date(Math.floor(now.getTime() / 3600000) * 3600000);
    await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`ad-copy:${accountId}`}, 0))`;
        const row = await tx.adCopyGenerationQuota.findUnique({ where: { accountId } });
        const count = row?.windowStart.getTime() === windowStart.getTime() ? row.units : 0;
        if (row && row.leaseUntil > now || count + units > 40) throw Object.assign(new Error('Generation is busy or hourly work limit reached'), { statusCode: 429 });
        const data = { windowStart, units: count + units, leaseOwner: owner, leaseUntil: new Date(now.getTime() + 600000) };
        await tx.adCopyGenerationQuota.upsert({ where: { accountId }, create: { accountId, ...data }, update: data });
    });
    return async () => { await prisma.adCopyGenerationQuota.updateMany({ where: { accountId, leaseOwner: owner }, data: { leaseUntil: new Date(0), leaseOwner: null } }); };
}
