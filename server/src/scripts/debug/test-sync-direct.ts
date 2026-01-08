
import { createPrismaClient } from '../../utils/prisma';
import { OrderSync } from '../../services/sync/OrderSync';
import { QueueFactory } from '../../services/queue/QueueFactory';

const prisma = createPrismaClient();

async function main() {
    // Find the account that failed (from logs) or just the first one
    // We prefer the one with customkings.com.au if possible as that had the error
    const account = await prisma.account.findFirst({
        where: { wooUrl: { contains: 'customkings' } }
    }) || await prisma.account.findFirst();

    if (!account) return console.log("No account found");

    console.log(`Running Direct Sync for ${account.id} (${account.wooUrl})...`);

    // Instantiate OrderSync
    const syncer = new OrderSync();

    // Mock Job
    const mockJob = {
        updateProgress: async (p: number) => console.log(`Progress: ${p}%`),
        isActive: async () => true
    };

    try {
        await syncer.perform({
            accountId: account.id,
            incremental: false
        }, mockJob);
        console.log("Direct Sync SUCCESS");
    } catch (error: any) {
        console.error("Direct Sync FAILED:", error.message);
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
        // QueueFactory might keep connection open
        process.exit(0);
    });
