
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const args = process.argv.slice(2);
    const customerId = args[0];

    if (!customerId) {
        console.error('Please provide a customer ID');
        return;
    }

    console.log(`Searching for customer: ${customerId}`);

    // Check if numeric
    const isWooId = !isNaN(Number(customerId));
    console.log(`Is WooId (Numeric): ${isWooId}`);

    // Search by WooId
    if (isWooId) {
        console.log('Querying by wooId...');
        const byWooId = await prisma.wooCustomer.findFirst({
            where: { wooId: Number(customerId) }
        });
        console.log('Result by wooId:', byWooId ? 'FOUND' : 'NOT FOUND');
        if (byWooId) console.log(byWooId);
    }

    // Search by UUID
    console.log('Querying by id (UUID)...');
    try {
        const byUuid = await prisma.wooCustomer.findFirst({
            where: { id: customerId }
        });
        console.log('Result by UUID:', byUuid ? 'FOUND' : 'NOT FOUND');
        if (byUuid) console.log(byUuid);
    } catch (e) {
        console.log('Invalid UUID format or query error:', e.message);
    }

    // List all customers to verify generic access
    const count = await prisma.wooCustomer.count();
    console.log(`Total customers in DB: ${count}`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
