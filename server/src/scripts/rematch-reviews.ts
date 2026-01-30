/**
 * Script to re-match existing reviews to orders using the improved matching algorithm.
 * This will update the wooOrderId on all existing reviews.
 * 
 * Usage: npx ts-node src/scripts/rematch-reviews.ts
 */

import { createPrismaClient } from '../utils/prisma';
import { Logger } from '../utils/logger';

const prisma = createPrismaClient();

interface OrderMatchResult {
    orderId: string;
    orderNumber: string;
    score: number;
    daysDiff: number;
}

/**
 * Normalizes email for comparison: lowercase, trim, remove + addressing.
 */
function normalizeEmail(email: string | null | undefined): string | null {
    if (!email) return null;
    const trimmed = email.trim().toLowerCase();
    const atIndex = trimmed.indexOf('@');
    if (atIndex === -1) return trimmed;
    const localPart = trimmed.substring(0, atIndex);
    const domain = trimmed.substring(atIndex);
    const plusIndex = localPart.indexOf('+');
    if (plusIndex !== -1) {
        return localPart.substring(0, plusIndex) + domain;
    }
    return trimmed;
}

/**
 * Compares reviewer name against order billing name.
 */
function namesMatch(reviewerName: string, billingFirst: string | undefined, billingLast: string | undefined): boolean {
    if (!reviewerName) return false;
    const normalizedReviewer = reviewerName.toLowerCase().trim();
    const fullBilling = `${billingFirst || ''} ${billingLast || ''}`.toLowerCase().trim();
    if (normalizedReviewer === fullBilling) return true;
    const first = (billingFirst || '').toLowerCase().trim();
    const last = (billingLast || '').toLowerCase().trim();
    if (first && last && normalizedReviewer.includes(first) && normalizedReviewer.includes(last)) return true;
    const reviewerParts = normalizedReviewer.split(/\s+/);
    if (last && reviewerParts.some(part => part === last)) return true;
    return false;
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

                // Check if order contains the reviewed product (including variations)
                const hasProduct = lineItems.some((item: any) => {
                    if (item.product_id === productId) return true;
                    if (item.variation_id && item.product_id === productId) return true;
                    // Variation match - review on variation, order has parent
                    if (item.variation_id === productId) return true;
                    return false;
                });

                if (!hasProduct) continue;

                // Check customer/email/name match with tiered scoring
                let matchScore = 0;
                const normalizedOrderEmail = normalizeEmail(data.billing?.email);
                const normalizedReviewerEmail = normalizeEmail(reviewerEmail);
                const orderCustomerId = data.customer_id;
                const billingFirst = data.billing?.first_name;
                const billingLast = data.billing?.last_name;

                // Priority 1: Exact WooCommerce customer ID match (score 100)
                if (wooCustomerId) {
                    const customer = await prisma.wooCustomer.findUnique({ where: { id: wooCustomerId } });
                    if (customer && orderCustomerId === customer.wooId) {
                        matchScore = 100;
                    } else if (customer && normalizedOrderEmail === normalizeEmail(customer.email)) {
                        matchScore = 90;
                    }
                }

                // Priority 2: Direct email match with normalization (score 80)
                if (matchScore === 0 && normalizedReviewerEmail && normalizedOrderEmail === normalizedReviewerEmail) {
                    matchScore = 80;
                }

                // Priority 3: Name-based match fallback (score 60)
                if (matchScore === 0 && review.reviewer && namesMatch(review.reviewer, billingFirst, billingLast)) {
                    matchScore = 60;
                }

                // Priority 4: Product-only match with tight temporal proximity (score 40)
                if (matchScore === 0) {
                    const daysDiff = (reviewDate.getTime() - new Date(order.dateCreated).getTime()) / (1000 * 60 * 60 * 24);
                    // Only allow if review is 7-60 days after order
                    if (daysDiff >= 7 && daysDiff <= 60) {
                        matchScore = 40;
                    }
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
