
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log("Fetching recent Review Sync logs...");
    const logs = await prisma.syncLog.findMany({
        where: { entityType: 'reviews' },
        orderBy: { startedAt: 'desc' },
        take: 5
    });

    console.log(JSON.stringify(logs, null, 2));
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
