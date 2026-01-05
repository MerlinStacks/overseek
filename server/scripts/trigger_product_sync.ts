import { PrismaClient } from '@prisma/client';
import { SyncService } from '../src/services/sync';

const prisma = new PrismaClient();
const syncService = new SyncService();

async function main() {
    const account = await prisma.account.findFirst();
    if (!account) {
        console.error('No account found');
        return;
    }

    console.log(`Triggering Product Sync for account: ${account.id}`);
    await syncService.runSync(account.id, { types: ['products'], incremental: false });
    console.log('Sync complete!');
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
