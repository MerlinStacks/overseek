import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { EmailCommandMetaSchema } from '../routes/email/schemas';
export async function emailAccountCommand(accountId: string, actorId: string, resourceId: string | null, action: string, meta: unknown, data: unknown, work: (tx: Prisma.TransactionClient) => Promise<unknown>) {
    if (!accountId?.trim() || accountId.length > 200 || !actorId?.trim() || actorId.length > 200) throw new Error('Email command scope required');
    const command = EmailCommandMetaSchema.parse(meta), id = `email-account:${accountId}:${command.operationId}`;
    const digest = createHash('sha256').update(JSON.stringify([actorId, resourceId, action, command, data])).digest('hex');
    return prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`email-account:${accountId}`}, 0))`;
        const receipt = await tx.scopedOperation.findUnique({ where: { id } });
        if (receipt) { const result = receipt.result as any; if (result.digest !== digest) throw new Error('Email command occurrence conflict'); return result.value; }
        const resource = resourceId ? await tx.emailAccount.findFirst({ where: { accountId, id: resourceId } }) : null;
        if (resourceId && !resource || (resource?.updatedAt.toISOString() ?? null) !== command.version) throw new Error('Email account version changed');
        const value = { ...JSON.parse(JSON.stringify(await work(tx))), operationId: command.operationId };
        await tx.scopedOperation.create({ data: { id, accountId, kind: 'email-account-command', result: { digest, value } } });
        return value;
    });
}
