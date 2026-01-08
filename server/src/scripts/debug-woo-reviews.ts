
import dotenv from 'dotenv';
import https from 'https';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
https.globalAgent.options.rejectUnauthorized = false;
dotenv.config();

import { createPrismaClient } from '../utils/prisma';
import { WooService } from '../services/woo';

const prisma = createPrismaClient();

async function main() {
    console.log("Starting Debug Script...");

    // Get the REAL account
    const account = await prisma.account.findUnique({ where: { id: '61ccd014-6dcc-4c43-8c8c-970d29f9eadb' } });
    if (!account) {
        console.error("No account found!");
        return;
    }

    console.log(`Testing with Account: ${account.id} (${account.wooUrl})`);

    try {
        const woo = await WooService.forAccount(account.id);
        console.log("WooService initialized.");

        console.log("Fetching reviews...");
        const reviews = await woo.getReviews({ per_page: 5 });

        console.log(`Success! Found ${reviews.length} reviews.`);
        if (reviews.length > 0) {
            console.log("Sample Review:", JSON.stringify(reviews[0], null, 2));
        } else {
            console.log("No reviews returned from API.");
        }

    } catch (error: any) {
        console.error("Error fetching reviews:", error.message);
        if (error.response) {
            console.error("Response Status:", error.response.status);
            console.error("Response Data:", error.response.data);
        }
    } finally {
        await prisma.$disconnect();
    }
}

main();
