

import { Pool } from 'pg';
import { SerializedPrismaPg } from './serializedPrismaPg';
import { PrismaClient } from '@prisma/client';


export * from '@prisma/client';


function createPrismaClientWithPool(): PrismaClient {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        // default 10 is too low for parallel syncs
        max: parseInt(process.env.DATABASE_POOL_SIZE || '50', 10),

        idleTimeoutMillis: 10000,

        connectionTimeoutMillis: 30000,
    });

    const adapter = new SerializedPrismaPg(pool);
    return new PrismaClient({ adapter });
}

let prismaInstance: PrismaClient | null = null;

function getPrismaClient(): PrismaClient {
    if (!prismaInstance) {
        prismaInstance = createPrismaClientWithPool();
    }
    return prismaInstance;
}

export const prisma = new Proxy({} as PrismaClient, {
    get(_target, prop, receiver) {
        return Reflect.get(getPrismaClient(), prop, receiver);
    },
    set(_target, prop, value, receiver) {
        return Reflect.set(getPrismaClient(), prop, value, receiver);
    },
});

/** standalone client for scripts that need their own connection */
export function createPrismaClient(): PrismaClient {
    const scriptPool = new Pool({ connectionString: process.env.DATABASE_URL });
    const scriptAdapter = new SerializedPrismaPg(scriptPool, { disposeExternalPool: true });
    return new PrismaClient({ adapter: scriptAdapter });
}
