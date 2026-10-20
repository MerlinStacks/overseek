import 'dotenv/config';
import { createPrismaClient, type PrismaClient } from '../utils/prisma';

export class ScriptUsageError extends Error {}

/** A script owns its adapter-backed client and always awaits its release. */
export async function withScriptPrisma<T>(work: (prisma: PrismaClient) => Promise<T>): Promise<T> {
    const prisma = createPrismaClient();
    try {
        return await work(prisma);
    } finally {
        await prisma.$disconnect();
    }
}

export async function runScript(work: () => Promise<number | void>): Promise<void> {
    try {
        const code = await work();
        process.exitCode = typeof code === 'number' ? code : 0;
    } catch (error) {
        // ORM errors can embed query arguments, including credentials or customer data.
        console.error(error instanceof ScriptUsageError ? error.message : 'Script failed. Check service availability and configuration.');
        process.exitCode = 1;
    }
}

export function requiredAccountId(args: string[]): string {
    const index = args.indexOf('--account-id');
    const value = index >= 0 ? args[index + 1]?.trim() : '';
    if (!value || value.startsWith('--')) throw new ScriptUsageError('Usage: --account-id <account-id>');
    return value;
}
