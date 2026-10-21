import type { PrismaClient } from '@prisma/client';
import { operationalOptions, safeDestination, usage, type OperationalOptions } from './operationalSafety';

/** Aggregate-only diagnostics. Never dumps rows, tokens, hashes, URLs or raw errors. */
export async function diagnose(options: OperationalOptions, db: PrismaClient) {
    const where = options.accountId ? { accountId: options.accountId } : {};
    const counts: Record<string, number> = {
        accounts: await db.account.count({ where: options.accountId ? { id: options.accountId } : {} }),
        orders: await db.wooOrder.count({ where }), products: await db.wooProduct.count({ where }),
    };
    if (options.all) { counts.users = await db.user.count(); counts.activeRefreshTokens = await db.refreshToken.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }); }
    return counts;
}
export async function main(args = process.argv.slice(2)) {
    if (args.includes('--help')) { console.info(usage('deep-diagnostic')); return; }
    (await import('dotenv')).config();
    const options = operationalOptions('deep-diagnostic', args);
    const { createPrismaClient } = await import('../utils/prisma'); const db = createPrismaClient();
    try { console.info('Aggregate diagnostics', { destination: safeDestination(process.env.DATABASE_URL), counts: await diagnose(options, db) }); }
    finally { await db.$disconnect(); }
}
if (require.main === module) void main().catch(() => { console.error('Diagnostics failed. No row samples or connection secrets were logged. Use --help to check options.'); process.exitCode = 1; });
