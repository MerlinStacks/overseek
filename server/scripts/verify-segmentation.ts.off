
import { PrismaClient } from '@prisma/client';
import { SegmentService } from '../src/services/SegmentService';
import { MarketingService } from '../src/services/MarketingService';

const prisma = new PrismaClient();
// const segmentService = new SegmentService(); // MarketingService creates its own, but we need one for setup
const segmentService = new SegmentService();
const marketingService = new MarketingService();

async function main() {
    console.log('--- Starting Segmentation Verification ---');

    // 1. Setup Test Account
    const account = await prisma.account.findFirst();
    if (!account) throw new Error('No account found to test with');
    const accountId = account.id;
    console.log(`Using Account: ${accountId}`);

    // Clean previous runs
    await prisma.wooCustomer.deleteMany({ where: { email: { in: ['spender@test.com', 'cheap@test.com'] } } });

    // 2. Setup Test Customers
    // Customer A: Spender (Should match)
    const customerA = await prisma.wooCustomer.create({
        data: {
            id: 'test-cust-a',
            accountId,
            email: 'spender@test.com',
            firstName: 'Big',
            lastName: 'Spender',
            totalSpent: 500,
            ordersCount: 5,
            wooId: 99901,
        }
    });

    // Customer B: Cheap (Should not match)
    const customerB = await prisma.wooCustomer.create({
        data: {
            id: 'test-cust-b',
            accountId,
            email: 'cheap@test.com',
            firstName: 'Small',
            lastName: 'Spender',
            totalSpent: 50,
            ordersCount: 1,
            wooId: 99902,
        }
    });
    console.log('Created Test Customers');

    try {
        // 3. Create Segment (Spent > 100)
        // Check if exists first
        const existing = await prisma.customerSegment.findFirst({ where: { accountId, name: 'High Value Test' } });
        if (existing) await segmentService.deleteSegment(accountId, existing.id);

        const segment = await segmentService.createSegment(accountId, {
            name: 'High Value Test',
            description: 'Test Segment',
            criteria: {
                type: 'AND',
                rules: [{ field: 'totalSpent', operator: 'gt', value: 100 }]
            }
        });
        console.log(`Created Segment: ${segment.id}`);

        // 4. Verify Preview
        const preview = await segmentService.previewCustomers(accountId, segment.id);
        console.log(`Segment Preview Count: ${preview.length}`);

        if (preview.length === 1 && preview[0].id === customerA.id) {
            console.log('✅ Segment matched correctly (Only Customer A)');
        } else {
            console.error('❌ Segment match FAILED', preview.map(c => c.email));
        }

        // 5. Create Campaign with Segment
        const campaign = await prisma.marketingCampaign.create({
            data: {
                accountId,
                name: 'Segment Test Campaign',
                subject: 'Hello VIPs',
                content: '<p>Hi</p>',
                status: 'DRAFT',
                segmentId: segment.id
            }
        });
        console.log(`Created Campaign: ${campaign.id} linked to Segment ${segment.id}`);

        // 6. Send Campaign
        const result = await marketingService.sendCampaign(campaign.id, accountId);
        console.log('Send Result:', result);

        if (result.count === 1) {
            console.log('✅ Campaign sent to correct number of recipients');
        } else {
            console.error('❌ Campaign send count mismatch', result);
        }

        // 7. Cleanup
        await prisma.marketingCampaign.delete({ where: { id: campaign.id } });
        await segmentService.deleteSegment(accountId, segment.id);
        await prisma.wooCustomer.delete({ where: { id: customerA.id } });
        await prisma.wooCustomer.delete({ where: { id: customerB.id } });
        console.log('Cleanup Complete');

    } catch (e) {
        console.error('Verification Failed:', e);
        // Attempt cleanup
        try {
            await prisma.wooCustomer.deleteMany({ where: { email: { in: ['spender@test.com', 'cheap@test.com'] } } });
        } catch { }
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
