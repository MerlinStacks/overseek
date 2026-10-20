import { runScript, withScriptPrisma } from './scriptUtils';

export async function main() {
    await withScriptPrisma(async prisma => {
        const accounts = await prisma.account.findMany({ select: { id: true, name: true }, orderBy: { id: 'asc' } });
        console.log(`Scanning ${accounts.length} accounts:`);
        for (const account of accounts) console.log(`[${account.name}] ID: ${JSON.stringify(account.id)}`);
    });
}

if (require.main === module) void runScript(main);
