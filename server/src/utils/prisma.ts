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

// Re-export types from generated client for consumers
export * from '@prisma/client';

// Create PostgreSQL connection pool
const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });

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
