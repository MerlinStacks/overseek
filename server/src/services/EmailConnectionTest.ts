import { prisma } from '../utils/prisma';
import { createHash } from 'crypto';
import { EmailCommandMetaSchema } from '../routes/email/schemas';
import { claimProviderWork } from './BoundedProviderWork';
export async function admittedEmailTest(accountId: string, actorId: string, resourceId: string | undefined, input: unknown, data: unknown, work: () => Promise<unknown>) {
    const meta = EmailCommandMetaSchema.parse(input), id = `email-test:${accountId}:${meta.operationId}`;
    const digest = createHash('sha256').update(JSON.stringify([actorId, resourceId, meta, data])).digest('hex');
    const existing = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
        const previous = await tx.scopedOperation.findUnique({ where: { id } });
        if (previous) { const value = previous.result as any; if (value.digest !== digest || value.state !== 'complete') throw new Error('Test pending/uncertain; reconcile original occurrence'); return value.value; }
        const resource = resourceId ? await tx.emailAccount.findFirst({ where: { accountId, id: resourceId } }) : null;
        if (resourceId && !resource || (resource?.updatedAt.toISOString() ?? null) !== meta.version) throw new Error('Email test source version changed');
        await tx.scopedOperation.create({ data: { id, accountId, kind: 'email-test', result: { digest, state: 'pending' } } });
        return null;
    });
    if (existing) return existing;
    const release = await claimProviderWork(accountId, 'email-test', 10);
    try {
        const value = JSON.parse(JSON.stringify(await work()));
        await prisma.scopedOperation.update({ where: { id }, data: { result: { digest, state: 'complete', value } } });
        return value;
    } catch { await prisma.scopedOperation.updateMany({ where: { id }, data: { result: { digest, state: 'uncertain' } } }).catch(() => undefined); throw new Error('Email test acknowledgement unavailable; reconcile occurrence'); }
    finally { await release(); }
}
export function requireEmailTestDestination(hostname: string, relay = false) {
    const configured = process.env[relay ? 'EMAIL_RELAY_TEST_ORIGINS' : 'EMAIL_CONNECTION_TEST_HOSTS'];
    if (!configured?.split(',').map(value => value.trim().toLowerCase()).includes(hostname.toLowerCase())) throw new Error('Network tests require an explicitly operator-allowlisted destination');
}
