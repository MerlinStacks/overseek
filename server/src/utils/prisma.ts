/**
 * Prisma Client with PostgreSQL Driver Adapter
 * 
 * Prisma ORM v7 requires explicit driver adapters. This module
 * configures the PostgreSQL adapter for database connections.
 * 
 * @module utils/prisma
 */

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

// Re-export types from @prisma/client for consumers
export * from '@prisma/client';

// Create PostgreSQL connection pool with optimized settings for batch syncs
const connectionString = process.env.DATABASE_URL;
const pool = new Pool({
    connectionString,
    // Increase pool size to handle concurrent sync operations
    // Default is 10, which is too low for parallel batch transactions
    // 50 connections supports multiple concurrent account syncs
    max: parseInt(process.env.DATABASE_POOL_SIZE || '50', 10),
    // Connection idle timeout (10 seconds)
    idleTimeoutMillis: 10000,
    // Connection timeout (30 seconds - matches Prisma's default transaction timeout)
    connectionTimeoutMillis: 30000,
});

// Create Prisma adapter
const adapter = new PrismaPg(pool);

// Export configured Prisma client singleton
export const prisma = new PrismaClient({ adapter });

/**
 * Create a new PrismaClient instance with driver adapter.
 * Use this for scripts that need their own client instance.
 */
export function createPrismaClient(): PrismaClient {
    const scriptPool = new Pool({ connectionString: process.env.DATABASE_URL });
    const scriptAdapter = new PrismaPg(scriptPool);
    return new PrismaClient({ adapter: scriptAdapter });
}
