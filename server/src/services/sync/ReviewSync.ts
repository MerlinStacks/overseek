import { BaseSync, SyncResult } from './BaseSync';
import { WooService } from '../woo';
import { prisma } from '../../utils/prisma';
import { EventBus, EVENTS } from '../events';
import { Logger } from '../../utils/logger';
import { IndexingService } from '../search/IndexingService';
import { WooReviewSchema, WooReview } from './wooSchemas';


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
    if (first && last && normalizedReviewer.includes(first) && normalizedReviewer.includes(last)) {
        return true;
    }

    const reviewerParts = normalizedReviewer.split(/\s+/);
    if (last && reviewerParts.some(part => part === last)) {
        return true;
    }

    return false;
}


export class ReviewSync extends BaseSync {
    protected entityType = 'reviews';

    protected async sync(woo: WooService, accountId: string, incremental: boolean, job?: any, syncId?: string): Promise<SyncResult> {
        const after = incremental ? await this.getLastSync(accountId) : undefined;
        let page = 1;
        let hasMore = true;
        let totalProcessed = 0;
        let totalDeleted = 0;
        let totalSkipped = 0;

        const wooReviewIds = new Set<number>();

        while (hasMore) {
            const { data: rawReviews, totalPages } = await woo.getReviews({ page, after, per_page: 25 });
            if (!rawReviews.length) {
                hasMore = false;
                break;
            }

            // Validate reviews with Zod schema
            const reviews: WooReview[] = [];
            for (const raw of rawReviews) {
                const result = WooReviewSchema.safeParse(raw);
                if (result.success) {
                    reviews.push(result.data);
                } else {
                    totalSkipped++;
                    Logger.warn(`Skipping invalid review`, {
                        accountId, syncId, reviewId: raw?.id,
                        errors: result.error.issues.map(i => i.message).slice(0, 3)
                    });
                }
            }

            if (!reviews.length) {
                page++;
                continue;
            }

            const indexPromises: Promise<any>[] = [];

            for (const r of reviews) {
                wooReviewIds.add(r.id);

                const reviewData = r as any;
                const reviewerEmail = reviewData.reviewer_email;

                // 1. Find Customer (pre-fetch once, avoiding N+1)
                let wooCustomerId: string | null = null;
                let customerData: { id: string; wooId: number; email: string } | null = null;
                if (reviewerEmail) {
                    customerData = await prisma.wooCustomer.findFirst({
                        where: { accountId, email: reviewerEmail },
                        select: { id: true, wooId: true, email: true }
                    });
                    if (customerData) wooCustomerId = customerData.id;
                }

                // 2. Find Order - Improved matching algorithm
                let wooOrderId: string | null = null;
                // Use date_created_gmt for accurate UTC timestamp
                const reviewDate = new Date(reviewData.date_created_gmt || r.date_created);
                const lookbackDate = new Date(reviewDate);
                lookbackDate.setDate(lookbackDate.getDate() - 180); // 180-day lookback window

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
                const matches: OrderMatchResult[] = [];

                for (const order of potentialOrders) {
                    const data = order.rawData as any;
                    const lineItems = data.line_items || [];

                    // Check if order contains the reviewed product (or its variation)
                    const hasProduct = lineItems.some((item: any) => {
                        if (item.product_id === r.product_id) return true;
                        if (item.variation_id && item.product_id === r.product_id) return true;
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
                    // Use pre-fetched customerData instead of querying again (N+1 fix)
                    if (customerData) {
                        if (orderCustomerId === customerData.wooId) {
                            matchScore = 100;
                        } else if (normalizedOrderEmail === normalizeEmail(customerData.email)) {
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
                    if (matchScore === 0) {
                        const daysDiff = (reviewDate.getTime() - new Date(order.dateCreated).getTime()) / (1000 * 60 * 60 * 24);
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
                        syncId,
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
                        // Use date_created_gmt for accurate UTC timestamp
                        dateCreated: new Date((r as any).date_created_gmt || r.date_created),
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

                // Index into Elasticsearch (parallel)
                indexPromises.push(
                    IndexingService.indexReview(accountId, r)
                        .catch((error: any) => {
                            Logger.warn(`Failed to index review ${r.id}`, { accountId, syncId, error: error.message });
                        })
                );

                totalProcessed++;
            }

            // Wait for all indexing operations
            await Promise.allSettled(indexPromises);

            Logger.info(`Synced batch of ${reviews.length} reviews`, { accountId, syncId, page, totalPages });
            if (reviews.length < 25) hasMore = false;

            if (job) {
                const progress = totalPages > 0 ? Math.round((page / totalPages) * 100) : 100;
                await job.updateProgress(progress);
                if (!(await job.isActive())) throw new Error('Cancelled');
            }

            page++;
        }

        // --- Reconciliation: Remove deleted reviews ---
        // Only run on full sync (non-incremental) to ensure we have all WooCommerce IDs
        if (!incremental && wooReviewIds.size > 0) {
            const localReviews = await prisma.wooReview.findMany({
                where: { accountId },
                select: { id: true, wooId: true }
            });

            const deletePromises: Promise<any>[] = [];
            for (const local of localReviews) {
                if (!wooReviewIds.has(local.wooId)) {
                    // Review exists locally but not in WooCommerce - delete it
                    deletePromises.push(
                        prisma.wooReview.delete({ where: { id: local.id } })
                    );
                    totalDeleted++;
                }
            }

            if (deletePromises.length > 0) {
                await Promise.allSettled(deletePromises);
                Logger.info(`Reconciliation: Deleted ${totalDeleted} orphaned reviews`, { accountId, syncId });
            }
        }

        return { itemsProcessed: totalProcessed, itemsDeleted: totalDeleted };
    }
}

