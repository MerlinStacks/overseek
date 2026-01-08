
import dotenv from 'dotenv';
dotenv.config();
import { createPrismaClient } from '../utils/prisma';
const prisma = createPrismaClient();

async function main() {
    const accountId = '61ccd014-6dcc-4c43-8c8c-970d29f9eadb';
    const count = await prisma.wooReview.count({ where: { accountId } });
    console.log(`Current Reviews in DB: ${count}`);
    await prisma.$disconnect();
}
main();
