import { z } from 'zod';
import { createHash } from 'crypto';
import { prisma } from '../utils/prisma';
export async function saveOnboardingMetaConnection(accountId: string, actorId: string, input: unknown) {
    const body = z.object({ operationId: z.string().uuid(), externalId: z.string().trim().regex(/^act_\d{1,30}$/), accessToken: z.string().trim().min(10).max(4096) }).strict().parse(input);
    const digest = createHash('sha256').update(JSON.stringify([actorId, body])).digest('hex'), id = `onboarding-meta:${accountId}:${body.operationId}`;
    return prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`onboarding-meta:${accountId}`}, 0))`;
        const receipt = await tx.scopedOperation.findUnique({ where: { id } });
        if (receipt) { const result = receipt.result as any; if (result.digest !== digest) throw Object.assign(new Error('Operation changed'), { statusCode: 409 }); return result.connection; }
        if (await tx.adAccount.findFirst({ where: { accountId, platform: 'META', externalId: body.externalId } })) throw Object.assign(new Error('Existing connection must be reconciled in account settings'), { statusCode: 409 });
        const row = await tx.adAccount.create({ data: { accountId, platform: 'META', externalId: body.externalId, accessToken: body.accessToken, name: 'META Account' }, select: { id: true, platform: true, externalId: true } });
        const connection = { ...row, credentialState: 'saved-unverified' };
        await tx.scopedOperation.create({ data: { id, accountId, kind: 'onboarding-meta-connect', result: { digest, connection } } });
        return connection;
    });
}
