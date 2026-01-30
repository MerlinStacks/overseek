
import dotenv from 'dotenv';
dotenv.config();
import { createPrismaClient } from '../utils/prisma';
const prisma = createPrismaClient();

async function main() {
    const linkedToCustomer = await prisma.wooReview.count({
        where: { wooCustomerId: { not: null } }
    });
    const linkedToOrder = await prisma.wooReview.count({
        where: { wooOrderId: { not: null } }
    });

    console.log(`Linked to Customer: ${linkedToCustomer}`);
    console.log(`Linked to Order: ${linkedToOrder}`);

    // Sample
    if (linkedToCustomer > 0) {
        const sample = await prisma.wooReview.findFirst({
            where: { wooOrderId: { not: null } },
            include: { customer: true, order: true }
        });
        if (sample) {
            console.log("Sample Linked Review:", {
                importer: sample.reviewer,
                customer: sample.customer?.email,
                order: sample.order?.number
            });
        }
    }

    await prisma.$disconnect();
}
main();
