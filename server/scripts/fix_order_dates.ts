/**
 * Migration Script: Fix Order DateCreated Timezone Offset
 * 
 * Problem: Orders were synced using date_created (store local time) instead of
 * date_created_gmt (UTC), causing an 11-hour timezone offset in stored dates.
 * 
 * Solution: This script updates the dateCreated field by extracting the correct
 * UTC date from rawData.date_created_gmt.
 * 
 * Usage: npx tsx scripts/fix_order_dates.ts [--dry-run]
 */

import { prisma } from '../src/utils/prisma';

async function main() {
    const isDryRun = process.argv.includes('--dry-run');

    console.log(`\n🔧 Order Date Fix Migration ${isDryRun ? '(DRY RUN)' : ''}\n`);
    console.log('This script fixes the dateCreated timezone offset by using rawData.date_created_gmt');
    console.log('─'.repeat(60));

    // Get all orders that have date_created_gmt in rawData
    const orders = await prisma.wooOrder.findMany({
        select: {
            id: true,
            wooId: true,
            accountId: true,
            dateCreated: true,
            rawData: true
        }
    });

    console.log(`\nFound ${orders.length} total orders to check\n`);

    let fixedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const order of orders) {
        try {
            const rawData = order.rawData as any;
            const dateCreatedGmt = rawData?.date_created_gmt;

            if (!dateCreatedGmt) {
                skippedCount++;
                continue;
            }

            const correctDate = new Date(dateCreatedGmt);
            const storedDate = new Date(order.dateCreated);

            // Check if dates differ by more than 1 minute
            const diffMs = Math.abs(correctDate.getTime() - storedDate.getTime());
            const diffHours = diffMs / (1000 * 60 * 60);

            if (diffHours > 0.1) { // More than 6 minutes difference
                if (!isDryRun) {
                    await prisma.wooOrder.update({
                        where: { id: order.id },
                        data: { dateCreated: correctDate }
                    });
                }

                fixedCount++;

                if (fixedCount <= 5) {
                    console.log(`  ✓ Order ${order.wooId}: ${storedDate.toISOString()} → ${correctDate.toISOString()} (${diffHours.toFixed(1)}h diff)`);
                }
            }
        } catch (error: any) {
            errorCount++;
            console.error(`  ✗ Error processing order ${order.wooId}: ${error.message}`);
        }
    }

    console.log('\n' + '─'.repeat(60));
    console.log(`\n📊 Summary:`);
    console.log(`   Fixed:   ${fixedCount} orders`);
    console.log(`   Skipped: ${skippedCount} orders (no date_created_gmt in rawData)`);
    console.log(`   Errors:  ${errorCount} orders`);

    if (isDryRun) {
        console.log(`\n⚠️  DRY RUN - no changes were made. Run without --dry-run to apply fixes.\n`);
    } else {
        console.log(`\n✅ Migration complete!\n`);
    }
}

main()
    .catch((e) => {
        console.error('Migration failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
