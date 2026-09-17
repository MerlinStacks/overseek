import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { esClient } from '../utils/elastic';

// SyncState's existing (accountId, entityType) key is a durable, coalescing projection
// checkpoint. cursor is an opaque generation, not a Woo pagination cursor here.
export const CONTACT_PROJECTION_PREFIX = 'contact-projection:';

export async function queueContactKeys(tx: Prisma.TransactionClient, accountId: string, wooIds: number[]) {
    for (const wooId of new Set(wooIds)) {
        const entityType = `${CONTACT_PROJECTION_PREFIX}${wooId}`;
        const cursor = randomUUID();
        await tx.syncState.upsert({
            where: { accountId_entityType: { accountId, entityType } },
            create: { accountId, entityType, cursor }, update: { cursor }
        });
    }
}

/** Transactional intent only: neither Redis nor ES is needed to persist a contact/enrollment. */
export async function queueContactProjection(tx: Prisma.TransactionClient, accountId: string, ids: string[]) {
    if (!ids.length) return;
    const contacts = await tx.wooCustomer.findMany({
        where: { accountId, id: { in: [...new Set(ids)] } }, select: { wooId: true }
    });
    await queueContactKeys(tx, accountId, contacts.map(c => c.wooId));
}

let lockPool: Pool | undefined;
export async function closeContactProjectionPool() {
    const pool = lockPool;
    lockPool = undefined;
    await pool?.end();
}

/**
 * One bounded page of COMMITTED state, outside database transactions. A session lock
 * serializes projectors across processes; writers remain independent of ES availability.
 * Generation-CAS acknowledgement cannot erase a write committed while ES was in flight.
 * Pending rows survive crashes, Redis loss, disabled Woo sync, and partial ES success.
 */
export async function drainContactProjections(limit = 100, accountId?: string): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid projection batch size');
    lockPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 2, allowExitOnIdle: true });
    const connection = await lockPool.connect();
    let locked = false;
    try {
        const result = await connection.query("SELECT pg_try_advisory_lock(hashtextextended('contact-projection-worker', 0)) AS locked");
        locked = result.rows[0].locked;
        if (!locked) return 0;
        const pending = await prisma.syncState.findMany({
            where: { entityType: { startsWith: CONTACT_PROJECTION_PREFIX }, ...(accountId ? { accountId } : {}) },
            orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: limit
        });
        if (!pending.length) return 0;
        const keys = pending.map(p => ({ accountId: p.accountId, wooId: Number(p.entityType.slice(CONTACT_PROJECTION_PREFIX.length)) }));
        const contacts = await prisma.wooCustomer.findMany({ where: { OR: keys } });
        const byKey = new Map(contacts.map(c => [`${c.accountId}_${c.wooId}`, c]));
        const operations = keys.flatMap<Record<string, unknown>>(key => {
            const id = `${key.accountId}_${key.wooId}`;
            const c = byKey.get(id);
            if (!c) return [{ delete: { _index: 'customers', _id: id } }];
            return [
                { index: { _index: 'customers', _id: id } },
                { accountId: c.accountId, id: c.id, wooId: c.wooId, email: c.email,
                    firstName: c.firstName, lastName: c.lastName, totalSpent: Number(c.totalSpent),
                    ordersCount: c.ordersCount, dateCreated: c.createdAt, rawData: c.rawData,
                    contactStatus: (c.rawData as Prisma.JsonObject)?.contactStatus }
            ];
        });
        const indexed = await esClient.bulk({ operations, refresh: false }, { requestTimeout: 10000, maxRetries: 0 });
        const failed = pending.filter((_, index) => {
            if (!indexed.errors) return false;
            const item = indexed.items?.[index];
            const operation = item?.index ?? item?.delete;
            return !operation || (operation.error && !(item.delete && operation.status === 404));
        });
        // Some legacy profile editors write directly rather than queueing projection intent.
        // Do not acknowledge their older snapshot if they committed while ES was in flight.
        const latest = await prisma.wooCustomer.findMany({ where: { OR: keys } });
        const latestByKey = new Map(latest.map(c => [`${c.accountId}_${c.wooId}`, c]));
        const failedIds = new Set(failed.map(p => p.id));
        const acknowledged = pending.filter(p => {
            const key = `${p.accountId}_${Number(p.entityType.slice(CONTACT_PROJECTION_PREFIX.length))}`;
            return !failedIds.has(p.id) && JSON.stringify(byKey.get(key)) === JSON.stringify(latestByKey.get(key));
        });
        if (acknowledged.length) await prisma.syncState.deleteMany({
            where: { OR: acknowledged.map(p => ({ id: p.id, cursor: p.cursor })) }
        });
        if (failed.length) {
            // A permanently invalid document must not starve later pending keys.
            await prisma.syncState.updateMany({ where: { OR: failed.map(p => ({ id: p.id, cursor: p.cursor })) },
                data: { updatedAt: new Date() } });
            throw new Error('Contact projection failed; durable pending keys retained');
        }
        return pending.length;
    } finally {
        // A broken session must be destroyed, never returned to the pool with a held lock.
        let releaseError: Error | undefined;
        if (locked) {
            try { await connection.query("SELECT pg_advisory_unlock(hashtextextended('contact-projection-worker', 0))"); }
            catch (error) { releaseError = error as Error; }
        }
        connection.release(releaseError);
    }
}
