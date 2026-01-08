
import { createPrismaClient } from '../utils/prisma';

const prisma = createPrismaClient();

async function main() {
    try {
        const count = await prisma.user.count();
        console.log(`User Count: ${count}`);

        if (count > 0) {
            console.log('SUCCESS: Users found.');
            process.exit(0); // Success
        } else {
            console.log('FAILURE: No users found.');
            process.exit(1); // Failure (Empty)
        }
    } catch (e) {
        console.error(e);
        process.exit(2); // Error
    } finally {
        await prisma.$disconnect();
    }
}

main();
