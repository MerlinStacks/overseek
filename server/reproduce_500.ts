import { prisma } from './src/utils/prisma';
import { ChatService } from './src/services/ChatService';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
    try {
        console.log("Connecting to DB...");
        // 1. Check connection
        const userCount = await prisma.user.count();
        console.log(`Connected. Users: ${userCount}`);

        // 2. Get an account
        const account = await prisma.account.findFirst();
        if (!account) {
            console.log("No account found.");
            return;
        }
        console.log(`Testing with Account ID: ${account.id}`);

        // 3. Test getUnreadCount
        // Mock ChatService dependencies if needed.
        const mockIo = {
            to: () => ({ emit: () => { } })
        } as any;

        const chatService = new ChatService(mockIo);

        console.log("Calling getUnreadCount...");
        // We know getUnreadCount only runs a Prisma count query
        const count = await chatService.getUnreadCount(account.id);
        console.log(`Unread Count: ${count}`);

    } catch (e) {
        console.error("Error encountered:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
