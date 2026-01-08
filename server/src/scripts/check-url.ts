
import dotenv from 'dotenv';
dotenv.config();
import { createPrismaClient } from '../utils/prisma';
const prisma = createPrismaClient();
async function main() {
    const account = await prisma.account.findFirst();
    console.log("Woo URL:", account?.wooUrl);
    await prisma.$disconnect();
}
main();
