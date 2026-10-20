import { runScript, withScriptPrisma } from './scriptUtils';

export async function main() {
    await withScriptPrisma(async prisma => {
        const accounts = await prisma.account.findMany({ select: { id: true, name: true, wooUrl: true }, orderBy: { id: 'asc' } });
        console.log(`Found ${accounts.length} accounts:`);
        for (const account of accounts) console.log(`ID: ${account.id} | Name: ${account.name} | URL: ${account.wooUrl}`);
    });
}

if (require.main === module) void runScript(main);
