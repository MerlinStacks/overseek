
import dotenv from 'dotenv';
dotenv.config();
import { createPrismaClient } from '../utils/prisma';
const prisma = createPrismaClient();

async function main() {
    const allAccounts = await prisma.account.findMany();
    console.log(`Scanning ${allAccounts.length} accounts:`);
    allAccounts.forEach(a => {
        console.log(`[${a.name}] ID: ${JSON.stringify(a.id)}`);
    });
    await prisma.$disconnect();
}
main();
