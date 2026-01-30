
import dotenv from 'dotenv';
dotenv.config();
import { createPrismaClient } from '../utils/prisma';
const prisma = createPrismaClient();

async function main() {
    const review = await prisma.wooReview.findFirst();
    if (review) {
        console.log("Review Raw Data Keys:", Object.keys(review.rawData as object));
        console.log("Reviewer Email:", (review.rawData as any).reviewer_email);
        console.log("Full Raw Data:", JSON.stringify(review.rawData, null, 2));
    } else {
        console.log("No reviews found");
    }
    await prisma.$disconnect();
}
main();
