
import { prisma } from '../src/utils/prisma';

async function main() {
    console.log('Checking Audit Logs...');
    try {
        const count = await prisma.auditLog.count();
        console.log(`Total Audit Logs: ${count}`);

        const logs = await prisma.auditLog.findMany({
            take: 5,
            include: { user: true }
        });
        console.log('Sample logs:', JSON.stringify(logs, null, 2));

    } catch (error) {
        console.error('Error querying AuditLog:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
