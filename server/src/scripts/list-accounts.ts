
import dotenv from 'dotenv';
dotenv.config();
import { createPrismaClient } from '../utils/prisma';
const prisma = createPrismaClient();

async function main() {
    const accounts = await prisma.account.findMany();
    console.log(`Found ${accounts.length} accounts:`);
    accounts.forEach(a => {
        console.log(`ID: ${a.id} | Name: ${a.name} | URL: ${a.wooUrl}`);
    });
    await prisma.$disconnect();
}
main();
