
import { QueueFactory, QUEUES } from '../../services/queue/QueueFactory';
import { createPrismaClient } from '../../utils/prisma';

const prisma = createPrismaClient();

async function main() {
    // Find an account
    const account = await prisma.account.findFirst();
    if (!account) return console.log("No account found");

    console.log(`Triggering Sync for ${account.id} (${account.wooUrl})...`);

    // Create connection to Redis
    const queue = QueueFactory.createQueue(QUEUES.ORDERS);

    // Add job
    const job = await queue.add('sync-orders', {
        accountId: account.id,
        incremental: false
    }, {
        priority: 1,
        jobId: `manual_test_${Date.now()}`
    });

    console.log(`Job added with ID: ${job.id}`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        // Allow time for Redis command to flush
        await new Promise(resolve => setTimeout(resolve, 1000));
        await prisma.$disconnect();
        process.exit(0);
    });
