
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import https from 'https';

const prisma = new PrismaClient();

async function main() {
    const log = await prisma.syncLog.findFirst({
        where: { status: 'FAILED' },
        include: { account: true }
    });

    if (!log || !log.account) {
        console.log("No failed log found with account.");
        return;
    }

    const { wooUrl, wooConsumerKey, wooConsumerSecret } = log.account;
    console.log(`Testing connection to: ${wooUrl}`);

    const agent = new https.Agent({
        rejectUnauthorized: false
    });

    try {
        const response = await axios.get(`${wooUrl}/wp-json/wc/v3/system_status`, {
            params: {
                consumer_key: wooConsumerKey,
                consumer_secret: wooConsumerSecret
            },
            httpsAgent: agent
        });
        console.log("Success:", response.status);
    } catch (error: any) {
        console.error("Standard Agent connection failed:", error.message);
        if (error.code) console.error("Code:", error.code);
    }

    // Try with custom options if first fails
    console.log("\n--- Retrying with common fixes ---");

    // Fix 1: Set servername manually (sometimes helps if SNI is wrong)
    const url = new URL(wooUrl!);
    const agent2 = new https.Agent({
        rejectUnauthorized: false,
        servername: url.hostname // Explicitly set SNI
    });

    try {
        console.log("Attempt 2: Explicit servername");
        await axios.get(`${wooUrl}/wp-json/wc/v3/system_status`, {
            params: { consumer_key: wooConsumerKey, consumer_secret: wooConsumerSecret },
            httpsAgent: agent2
        });
        console.log("Success with explicit servername!");
    } catch (e: any) { console.log("Failed 2:", e.message); }

    // Fix 3: No SNI? (rarely supported by modern servers but worth a shot if 112)
    // Actually we can't easily disable SNI in agent options without internal hacks or IP usage.
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
