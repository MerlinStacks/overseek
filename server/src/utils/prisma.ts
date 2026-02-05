/**
 * Prisma Client with PostgreSQL Driver Adapter
 * 
 * Prisma ORM v7 requires explicit driver adapters. This module
 * configures the PostgreSQL adapter for database connections.
 * 
 * EDGE CASE FIX: Added pool monitoring to detect connection exhaustion.
 * 
 * @module utils/prisma
 */

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Logger } from './logger';

// Re-export types from @prisma/client for consumers
export * from '@prisma/client';

// Connection pool configuration
const maxPoolSize = parseInt(process.env.DATABASE_POOL_SIZE || '50', 10);
const connectionString = process.env.DATABASE_URL;

// Create PostgreSQL connection pool with optimized settings for batch syncs
const pool = new Pool({
    connectionString,
    // Increase pool size to handle concurrent sync operations
    // Default is 10, which is too low for parallel batch transactions
    // 50 connections supports multiple concurrent account syncs
    max: maxPoolSize,
    // Connection idle timeout (10 seconds)
    idleTimeoutMillis: 10000,
    // Connection timeout (30 seconds - matches Prisma's default transaction timeout)
    connectionTimeoutMillis: 30000,
});

// EDGE CASE FIX: Monitor pool for connection exhaustion
pool.on('error', (err) => {
    Logger.error('[Prisma Pool] Unexpected connection error', { error: err.message });
});

// EDGE CASE FIX: Log warning when pool is near capacity
pool.on('connect', () => {
    const { totalCount, idleCount, waitingCount } = pool;
    const utilization = ((totalCount - idleCount) / maxPoolSize) * 100;

    if (utilization >= 80) {
        Logger.warn('[Prisma Pool] High connection utilization', {
            utilization: `${utilization.toFixed(1)}%`,
            totalConnections: totalCount,
            activeConnections: totalCount - idleCount,
            idleConnections: idleCount,
            waitingRequests: waitingCount,
            maxPoolSize
        });
    }
});

// Create Prisma adapter
const adapter = new PrismaPg(pool);

// Export configured Prisma client singleton
export const prisma = new PrismaClient({ adapter });

/**
 * EDGE CASE FIX: Get connection pool statistics for monitoring.
 * Useful for health checks and alerting on pool exhaustion.
 */
export function getPoolStats() {
    const { totalCount, idleCount, waitingCount } = pool;
    const activeCount = totalCount - idleCount;
    const utilization = maxPoolSize > 0 ? (activeCount / maxPoolSize) * 100 : 0;

    return {
        totalConnections: totalCount,
        activeConnections: activeCount,
        idleConnections: idleCount,
        waitingRequests: waitingCount,
        maxPoolSize,
        utilizationPercent: Math.round(utilization * 10) / 10,
        isHealthy: utilization < 80 && waitingCount === 0,
    };
}

/**
 * Create a new PrismaClient instance with driver adapter.
 * Use this for scripts that need their own client instance.
 */
export function createPrismaClient(): PrismaClient {
    const scriptPool = new Pool({ connectionString: process.env.DATABASE_URL });
    const scriptAdapter = new PrismaPg(scriptPool);
    return new PrismaClient({ adapter: scriptAdapter });
}

