
import { createPrismaClient } from '../utils/prisma';

const prisma = createPrismaClient();

async function main() {
    try {
        const count = await prisma.user.count();
        console.log(`User Count: ${count}`);

        if (count > 0) {
            const users = await prisma.user.findMany({
                select: { id: true, email: true, fullName: true, createdAt: true }
            });
            console.log('Users found:', JSON.stringify(users, null, 2));
        } else {
            console.log('NO USERS FOUND in this database.');
        }
    } catch (e) {
        console.error('Connection failed:', e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
