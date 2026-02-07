

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Logger } from './logger';


const REPLICA_URL = process.env.REPLICA_DATABASE_URL;


function createReplicaClient(): PrismaClient {
    if (REPLICA_URL) {
        Logger.info('[Replica] Read replica configured, creating separate client');


        const replicaPool = new Pool({
            connectionString: REPLICA_URL,
            max: parseInt(process.env.REPLICA_POOL_SIZE || '25', 10),
            idleTimeoutMillis: 10000,
            connectionTimeoutMillis: 30000,
        });

        const adapter = new PrismaPg(replicaPool);
        return new PrismaClient({ adapter });
    }

    // no replica configured, use primary (lazy require to avoid circular dep)
    Logger.info('[Replica] No replica URL configured, using primary database');
    const { prisma } = require('./prisma');
    return prisma;
}


export const prismaReplica = createReplicaClient();


export const isReplicaConfigured = Boolean(REPLICA_URL);

/**
 * run a read query on the replica.
 *
 * @example
 * const orders = await withReplica(async (db) => {
 *     return db.wooOrder.findMany({ where: { accountId } });
 * });
 */
export async function withReplica<T>(
    queryFn: (replica: PrismaClient) => Promise<T>
): Promise<T> {
    const start = Date.now();
    try {
        const result = await queryFn(prismaReplica);
        const duration = Date.now() - start;

        if (isReplicaConfigured) {
            Logger.debug('[Replica] Query executed on replica', { duration: `${duration}ms` });
        }

        return result;
    } catch (error) {
        Logger.error('[Replica] Query failed', { error, isReplica: isReplicaConfigured });
        throw error;
    }
}

/** read query with auto-fallback to primary on replica failure */
export async function withReplicaFallback<T>(
    replicaQuery: (replica: PrismaClient) => Promise<T>,
    primaryQuery: (primary: PrismaClient) => Promise<T>
): Promise<T> {
    if (!isReplicaConfigured) {
        const { prisma } = require('./prisma');
        return primaryQuery(prisma);
    }

    try {
        return await replicaQuery(prismaReplica);
    } catch (error) {
        Logger.warn('[Replica] Failing over to primary database', { error });
        const { prisma } = require('./prisma');
        return primaryQuery(prisma);
    }
}


export async function getReplicaStatus(): Promise<{
    configured: boolean;
    connected: boolean;
    latencyMs?: number;
}> {
    if (!isReplicaConfigured) {
        return { configured: false, connected: false };
    }

    try {
        const start = Date.now();
        await prismaReplica.$queryRaw`SELECT 1`;
        const latencyMs = Date.now() - start;

        return { configured: true, connected: true, latencyMs };
    } catch {
        return { configured: true, connected: false };
    }
}

