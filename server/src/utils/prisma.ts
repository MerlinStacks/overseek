

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';


export * from '@prisma/client';


const connectionString = process.env.DATABASE_URL;
const pool = new Pool({
    connectionString,
    // default 10 is too low for parallel syncs
    max: parseInt(process.env.DATABASE_POOL_SIZE || '50', 10),

    idleTimeoutMillis: 10000,

    connectionTimeoutMillis: 30000,
});


const adapter = new PrismaPg(pool);


export const prisma = new PrismaClient({ adapter });

/** standalone client for scripts that need their own connection */
export function createPrismaClient(): PrismaClient {
    const scriptPool = new Pool({ connectionString: process.env.DATABASE_URL });
    const scriptAdapter = new PrismaPg(scriptPool);
    return new PrismaClient({ adapter: scriptAdapter });
}
