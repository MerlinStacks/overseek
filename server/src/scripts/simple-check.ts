import { runScript, withScriptPrisma } from './scriptUtils';

export async function main(): Promise<number> {
    try {
        return await withScriptPrisma(async prisma => {
            const count = await prisma.user.count();
            console.log(`User Count: ${count}`);
            console.log(count > 0 ? 'SUCCESS: Users found.' : 'FAILURE: No users found.');
            return count > 0 ? 0 : 1;
        });
    } catch {
        console.error('User check failed. Check database configuration and availability.');
        return 2;
    }
}

if (require.main === module) void runScript(main);
