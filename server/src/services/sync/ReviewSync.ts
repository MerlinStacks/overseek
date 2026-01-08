import { BaseSync } from './BaseSync';
import { WooService } from '../woo';
import { prisma } from '../../utils/prisma';
import { EventBus, EVENTS } from '../events';
import { Logger } from '../../utils/logger';
import { IndexingService } from '../search/IndexingService';


interface OrderMatchResult {
    orderId: string;
    orderNumber: string;
    score: number;
    daysDiff: number;
}

/**
 * Normalizes email for comparison: lowercase, trim, remove + addressing.
 * E.g., "User+test@Gmail.com " → "user@gmail.com"
 */
function normalizeEmail(email: string | null | undefined): string | null {
    if (!email) return null;
    const trimmed = email.trim().toLowerCase();
    // Handle + addressing (e.g., user+tag@domain.com → user@domain.com)
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
 * Returns true if names are similar enough to suggest same person.
 */
function namesMatch(reviewerName: string, billingFirst: string | undefined, billingLast: string | undefined): boolean {
    if (!reviewerName) return false;
    const normalizedReviewer = reviewerName.toLowerCase().trim();
    const fullBilling = `${billingFirst || ''} ${billingLast || ''}`.toLowerCase().trim();

    // Exact full name match
    if (normalizedReviewer === fullBilling) return true;

    // Reviewer contains both billing parts
    const first = (billingFirst || '').toLowerCase().trim();
    const last = (billingLast || '').toLowerCase().trim();
    if (first && last && normalizedReviewer.includes(first) && normalizedReviewer.includes(last)) {
        return true;
    }

    // Split reviewer name and check if any part matches last name (most reliable)
    const reviewerParts = normalizedReviewer.split(/\s+/);
    if (last && reviewerParts.some(part => part === last)) {
        return true;
    }

    return false;
}


export class ReviewSync extends BaseSync {
    protected entityType = 'reviews';

    protected async sync(woo: WooService, accountId: string, incremental: boolean, job?: any): Promise<void> {
        const after = incremental ? await this.getLastSync(accountId) : undefined;
        let page = 1;
        let hasMore = true;
        let totalProcessed = 0;

        while (hasMore) {
            const { data: reviews, totalPages } = await woo.getReviews({ page, after, per_page: 50 });
            if (!reviews.length) {
                hasMore = false;
                break;
            }

            for (const r of reviews) {

                const reviewData = r as any;
                const reviewerEmail = reviewData.reviewer_email;

                // 1. Find Customer
                let wooCustomerId: string | null = null;
                if (reviewerEmail) {
                    const customer = await prisma.wooCustomer.findFirst({
                        where: { accountId, email: reviewerEmail }
                    });
                    if (customer) wooCustomerId = customer.id;
                }

                // 2. Find Order - Improved matching algorithm
                let wooOrderId: string | null = null;
                const reviewDate = new Date(r.date_created);
                const lookbackDate = new Date(reviewDate);
                lookbackDate.setDate(lookbackDate.getDate() - 180); // 180-day lookback window

                // Get potential matching orders based on date range and product
                // We'll query orders that:
                // 1. Were created before the review date
                // 2. Are within the lookback window
                // Then filter by customer/email and product match

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

                // Find the best matching order
                // Priority: Exact customer match > Email match > Guest email match
                // Secondary: Closest to review date

                const matches: OrderMatchResult[] = [];

                for (const order of potentialOrders) {
                    const data = order.rawData as any;
                    const lineItems = data.line_items || [];

                    // Check if order contains the reviewed product (or its variation)
                    const hasProduct = lineItems.some((item: any) => {
                        // Exact product match
                        if (item.product_id === r.product_id) return true;
                        // Variation match - review on parent, order has variation
                        if (item.variation_id && item.product_id === r.product_id) return true;
                        // Variation match - review on variation, order has parent
                        // WooCommerce: variation_id is the actual variation, product_id is parent
                        if (item.variation_id === r.product_id) return true;
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
                            matchScore = 90; // Email match via customer record
                        }
                    }

                    // Priority 2: Direct email match with normalization (score 80)
                    if (matchScore === 0 && normalizedReviewerEmail && normalizedOrderEmail === normalizedReviewerEmail) {
                        matchScore = 80;
                    }

                    // Priority 3: Name-based match fallback (score 60)
                    if (matchScore === 0 && r.reviewer && namesMatch(r.reviewer, billingFirst, billingLast)) {
                        matchScore = 60;
                    }

                    // Priority 4: Product-only match with tight temporal proximity (score 40)
                    // Useful for gift purchases where reviewer ≠ purchaser
                    if (matchScore === 0) {
                        const daysDiff = (reviewDate.getTime() - new Date(order.dateCreated).getTime()) / (1000 * 60 * 60 * 24);
                        // Only allow if review is 7-60 days after order (typical usage/shipping time)
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

                // Sort by score (highest first), then by date proximity (closest first)
                matches.sort((a, b) => {
                    if (b.score !== a.score) return b.score - a.score;
                    return a.daysDiff - b.daysDiff;
                });

                if (matches.length > 0) {
                    wooOrderId = matches[0].orderId;
                    Logger.debug(`Matched review ${r.id} to order ${matches[0].orderNumber}`, {
                        accountId,
                        matchScore: matches[0].score,
                        daysDiff: matches[0].daysDiff.toFixed(1),
                        totalMatches: matches.length
                    });
                }

                const existingReview = await prisma.wooReview.findUnique({
                    where: { accountId_wooId: { accountId, wooId: r.id } }
                });

                await prisma.wooReview.upsert({
                    where: { accountId_wooId: { accountId, wooId: r.id } },
                    update: {
                        status: r.status,
                        content: r.review,
                        rating: r.rating,
                        rawData: r as any,
                        reviewerEmail: reviewerEmail || null,
                        wooCustomerId,
                        wooOrderId
                    },
                    create: {
                        accountId,
                        wooId: r.id,
                        productId: r.product_id,
                        productName: r.product_name,
                        reviewer: r.reviewer,
                        rating: r.rating,
                        content: r.review,
                        status: r.status,
                        dateCreated: new Date(r.date_created),
                        rawData: r as any,
                        reviewerEmail: reviewerEmail || null,
                        wooCustomerId,
                        wooOrderId
                    }
                });

                // Emit Event
                EventBus.emit(EVENTS.REVIEW.SYNCED, { accountId, review: r });

                // Detect "Review Left" for triggers
                const isRecent = (new Date().getTime() - reviewDate.getTime()) < 24 * 60 * 60 * 1000;

                if (isRecent && !existingReview) {
                    EventBus.emit(EVENTS.REVIEW.LEFT, { accountId, review: r });
                }

                // Index into Elasticsearch
                // Index into Elasticsearch
                try {
                    await IndexingService.indexReview(accountId, r);
                } catch (error: any) {
                    Logger.warn(`Failed to index review ${r.id}`, { accountId, error: error.message });
                }

                totalProcessed++;
            }

            Logger.info(`Synced batch of ${reviews.length} reviews`, { accountId, page, totalPages });
            if (reviews.length < 50) hasMore = false;

            if (job) {
                const progress = totalPages > 0 ? Math.round((page / totalPages) * 100) : 100;
                await job.updateProgress(progress);
                if (!(await job.isActive())) throw new Error('Cancelled');
            }

            page++;
        }

        Logger.info(`Review Sync Complete. Total: ${totalProcessed}`, { accountId });
    }
}
