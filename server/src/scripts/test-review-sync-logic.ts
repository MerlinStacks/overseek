
import dotenv from 'dotenv';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Keep for safety
dotenv.config();

import { createPrismaClient } from '../utils/prisma';
import { WooService } from '../services/woo';
import { ReviewSync } from '../services/sync/ReviewSync';

const prisma = createPrismaClient();

// Expose protected method
class TestReviewSync extends ReviewSync {
    public async runTest(accountId: string) {
        console.log("Initializing Test Sync for", accountId);
        const woo = await WooService.forAccount(accountId);

        console.log("Starting Sync Logic...");
        await this.sync(woo, accountId, false); // Full sync, not incremental
        console.log("Sync Logic Complete.");
    }
}

async function main() {
    const accountId = '61ccd014-6dcc-4c43-8c8c-970d29f9eadb';

    // Check count before
    const countBefore = await prisma.wooReview.count({ where: { accountId } });
    console.log(`Reviews in DB before: ${countBefore}`);

    const syncer = new TestReviewSync();

    try {
        await syncer.runTest(accountId);
    } catch (e: any) {
        console.error("Sync Failed:", e);
    }

    // Check count after
    const countAfter = await prisma.wooReview.count({ where: { accountId } });
    console.log(`Reviews in DB after: ${countAfter}`);

    await prisma.$disconnect();
}

main();
