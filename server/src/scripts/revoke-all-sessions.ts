import type { PrismaClient } from '@prisma/client';
import { operationalOptions, safeDestination, usage, type OperationalOptions } from './operationalSafety';

/** Revokes only the explicitly selected, cutoff-bounded set. Safe to import. */
export async function revokeSessions(options: OperationalOptions, db: PrismaClient) {
    const base = { revokedAt: null, createdAt: { lte: options.before }, ...(options.userId ? { userId: options.userId } : {}) };
    const top = await db.refreshToken.findFirst({ where: base, orderBy: { id: 'desc' }, select: { id: true } });
    const summary = { matched: 0, scanned: 0, revoked: 0, remaining: 0, dryRun: !options.apply };
    if (!top) return summary;
    const bounded = { ...base, id: { lte: top.id } };
    summary.matched = await db.refreshToken.count({ where: bounded });
    if (!options.apply) { summary.remaining = summary.matched; return summary; }
    let lastId: string | undefined;
    while (summary.scanned < options.limit) {
        const rows = await db.refreshToken.findMany({ where: { ...base, id: { lte: top.id, ...(lastId ? { gt: lastId } : {}) } }, orderBy: { id: 'asc' }, take: Math.min(options.batchSize, options.limit - summary.scanned), select: { id: true } });
        if (!rows.length) break;
        const result = await db.refreshToken.updateMany({ where: { ...base, id: { in: rows.map(row => row.id) } }, data: { revokedAt: new Date() } });
        summary.revoked += result.count; summary.scanned += rows.length;
        const nextId = rows[rows.length - 1].id;
        if (lastId && nextId <= lastId) throw new Error('Session traversal did not advance');
        lastId = nextId;
    }
    summary.remaining = await db.refreshToken.count({ where: bounded });
    return summary;
}
export async function main(args = process.argv.slice(2)) {
    if (args.includes('--help')) { console.info(usage('revoke-all-sessions')); return; }
    (await import('dotenv')).config(); const options = operationalOptions('revoke-all-sessions', args);
    const { createPrismaClient } = await import('../utils/prisma'); const db = createPrismaClient();
    try { const summary = await revokeSessions(options, db); console.info('Session revocation outcome', { destination: safeDestination(process.env.DATABASE_URL), cutoff: options.before.toISOString(), ...summary }); if (options.apply && summary.remaining) process.exitCode = 2; }
    finally { await db.$disconnect(); }
}
if (require.main === module) void main().catch(() => { console.error('Session revocation failed. Check scope and confirmation with --help.'); process.exitCode = 1; });
