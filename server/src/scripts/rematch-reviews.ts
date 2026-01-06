/**
 * Script to re-match existing reviews to orders using the improved matching algorithm.
 * This will update the wooOrderId on all existing reviews.
 * 
 * Usage: npx ts-node src/scripts/rematch-reviews.ts
 */

import { PrismaClient } from '@prisma/client';
import { Logger } from '../utils/logger';

const prisma = new PrismaClient();

interface OrderMatchResult {
    orderId: string;
    orderNumber: string;
    score: number;
    daysDiff: number;
}

async function rematchReviewsToOrders() {
    Logger.info('Starting review-to-order re-matching...');

    // Get all accounts
    const accounts = await prisma.account.findMany({ select: { id: true, name: true } });

    let totalReviews = 0;
    let matchedReviews = 0;
    let updatedReviews = 0;

    for (const account of accounts) {
        const accountId = account.id;
        Logger.info(`Processing account: ${account.name}`, { accountId });

        // Get all reviews for this account
        const reviews = await prisma.wooReview.findMany({
            where: { accountId },
            include: { customer: true }
        });

        Logger.info(`Found ${reviews.length} reviews`, { accountId });
        totalReviews += reviews.length;

        for (const review of reviews) {
            const reviewerEmail = review.reviewerEmail;
            const wooCustomerId = review.wooCustomerId;
            const productId = review.productId;

            // Calculate date range
            const reviewDate = review.dateCreated;
            const lookbackDate = new Date(reviewDate);
            lookbackDate.setDate(lookbackDate.getDate() - 180);

            // Get potential matching orders
            const potentialOrders = await prisma.wooOrder.findMany({
                where: {
                    accountId,
                    dateCreated: {
                        gte: lookbackDate,
                        lte: reviewDate
                    }
                },
                orderBy: { dateCreated: 'desc' }
            });

            const matches: OrderMatchResult[] = [];

            for (const order of potentialOrders) {
                const data = order.rawData as any;
                const lineItems = data.line_items || [];

                // Check if order contains the reviewed product
                const hasProduct = lineItems.some((item: any) => {
                    if (item.product_id === productId) return true;
                    if (item.variation_id && item.product_id === productId) return true;
                    return false;
                });

                if (!hasProduct) continue;

                // Check customer/email match
                let matchScore = 0;
                const orderEmail = data.billing?.email?.toLowerCase();
                const orderCustomerId = data.customer_id;

                // Priority 1: Exact WooCommerce customer ID match
                if (wooCustomerId) {
                    const customer = await prisma.wooCustomer.findUnique({ where: { id: wooCustomerId } });
                    if (customer && orderCustomerId === customer.wooId) {
                        matchScore = 100;
                    } else if (customer && orderEmail === customer.email?.toLowerCase()) {
                        matchScore = 90;
                    }
                }

                // Priority 2: Direct email match
                if (matchScore === 0 && reviewerEmail && orderEmail === reviewerEmail.toLowerCase()) {
                    matchScore = 80;
                }

                if (matchScore > 0) {
                    const daysDiff = Math.abs(
                        (reviewDate.getTime() - new Date(order.dateCreated).getTime()) / (1000 * 60 * 60 * 24)
                    );
                    matches.push({
                        orderId: order.id,
                        orderNumber: order.number,
                        score: matchScore,
                        daysDiff
                    });
                }
            }

            // Sort by score, then date proximity
            matches.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return a.daysDiff - b.daysDiff;
            });

            if (matches.length > 0) {
                matchedReviews++;
                const bestMatch = matches[0];

                // Only update if the order changed
                if (review.wooOrderId !== bestMatch.orderId) {
                    await prisma.wooReview.update({
                        where: { id: review.id },
                        data: { wooOrderId: bestMatch.orderId }
                    });
                    updatedReviews++;
                    Logger.debug(`Updated review ${review.id} -> order ${bestMatch.orderNumber}`, {
                        previousOrderId: review.wooOrderId,
                        newOrderId: bestMatch.orderId,
                        score: bestMatch.score,
                        daysDiff: bestMatch.daysDiff.toFixed(1)
                    });
                }
            } else if (review.wooOrderId) {
                // Clear invalid match
                await prisma.wooReview.update({
                    where: { id: review.id },
                    data: { wooOrderId: null }
                });
                updatedReviews++;
                Logger.debug(`Cleared invalid order match for review ${review.id}`);
            }
        }
    }

    Logger.info('Review re-matching complete', {
        totalReviews,
        matchedReviews,
        updatedReviews,
        matchRate: totalReviews > 0 ? `${((matchedReviews / totalReviews) * 100).toFixed(1)}%` : 'N/A'
    });

    await prisma.$disconnect();
}

rematchReviewsToOrders().catch((error) => {
    Logger.error('Error during re-match', { error });
    prisma.$disconnect();
    process.exit(1);
});
