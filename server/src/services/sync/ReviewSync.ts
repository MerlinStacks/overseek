import { BaseSync, SyncResult } from './BaseSync';
import { WooService } from '../woo';
import { prisma } from '../../utils/prisma';
import { EventBus, EVENTS } from '../events';
import { Logger } from '../../utils/logger';
import { IndexingService } from '../search/IndexingService';
import { WooReviewSchema, WooReview } from './wooSchemas';
import { Prisma } from '@prisma/client';


/**
 * Lightweight order projection for review matching.
 * Only the fields needed for scoring — excludes the full rawData blob
 * which is 10-50KB per order and caused the OOM crash.
 */
interface LightweightOrder {
    id: string;
    number: string;
    dateCreated: Date;
    customerId: number | null;
    billingEmail: string | null;
    billingFirst: string | null;
    billingLast: string | null;
    lineItems: Array<{ product_id: number; variation_id?: number }>;
}

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
            const { data: rawReviews, totalPages } = await woo.getReviews({ page, after, per_page: 100 });
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
                    Logger.debug(`Skipping invalid review`, {
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

            // --- OOM FIX: Pre-fetch orders ONCE per batch with lightweight projection ---
            // Instead of querying all orders per review (N+1), compute the widest
            // date window across the entire batch and fetch matching orders once.
            const reviewDates = reviews.map(r => {
                const rd = r as any;
                return new Date(rd.date_created_gmt || r.date_created).getTime();
            });
            const batchLookback = new Date(Math.min(...reviewDates));
            batchLookback.setDate(batchLookback.getDate() - 180);
            const batchLatest = new Date(Math.max(...reviewDates));

            // Extract only matching-relevant fields from JSONB server-side.
            // This avoids deserializing the full rawData blob (~10-50KB/order).
            const batchOrders = await prisma.$queryRaw<LightweightOrder[]>`
                SELECT
                    id,
                    number,
                    "dateCreated",
                    COALESCE(("rawData"->>'customer_id')::int, 0) AS "customerId",
                    "rawData"->'billing'->>'email'      AS "billingEmail",
                    "rawData"->'billing'->>'first_name'  AS "billingFirst",
                    "rawData"->'billing'->>'last_name'   AS "billingLast",
                    COALESCE(
                        (
                            SELECT jsonb_agg(jsonb_build_object(
                                'product_id', (li->>'product_id')::int,
                                'variation_id', (li->>'variation_id')::int
                            ))
                            FROM jsonb_array_elements("rawData"->'line_items') AS li
                        ),
                        '[]'::jsonb
                    ) AS "lineItems"
                FROM "WooOrder"
                WHERE "accountId" = ${accountId}
                  AND "dateCreated" >= ${batchLookback}
                  AND "dateCreated" <= ${batchLatest}
                ORDER BY "dateCreated" DESC
            `;

            // Build product → orders index for O(1) lookup per review
            const productOrderIndex = new Map<number, LightweightOrder[]>();
            for (const order of batchOrders) {
                // line_items may come back as a JSON string from $queryRaw
                const items = typeof order.lineItems === 'string'
                    ? JSON.parse(order.lineItems)
                    : (order.lineItems || []);
                order.lineItems = items;
                for (const item of items) {
                    const pid = item.product_id;
                    if (pid) {
                        if (!productOrderIndex.has(pid)) productOrderIndex.set(pid, []);
                        productOrderIndex.get(pid)!.push(order);
                    }
                    const vid = item.variation_id;
                    if (vid && vid !== pid) {
                        if (!productOrderIndex.has(vid)) productOrderIndex.set(vid, []);
                        productOrderIndex.get(vid)!.push(order);
                    }
                }
            }

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

                // 2. Find Order — use pre-fetched batch orders (OOM fix)
                let wooOrderId: string | null = null;
                const reviewDate = new Date(reviewData.date_created_gmt || r.date_created);
                const reviewLookback = new Date(reviewDate);
                reviewLookback.setDate(reviewLookback.getDate() - 180);

                // Get candidate orders via product index (O(1) lookup)
                const candidateOrders = productOrderIndex.get(r.product_id) || [];

                // Filter to the per-review time window
                const potentialOrders = candidateOrders.filter(o => {
                    const od = new Date(o.dateCreated).getTime();
                    return od >= reviewLookback.getTime() && od <= reviewDate.getTime();
                });

                // Find the best matching order
                const matches: OrderMatchResult[] = [];

                for (const order of potentialOrders) {
                    // Check customer/email/name match with tiered scoring
                    let matchScore = 0;
                    const normalizedOrderEmail = normalizeEmail(order.billingEmail);
                    const normalizedReviewerEmail = normalizeEmail(reviewerEmail);

                    // Priority 1: Exact WooCommerce customer ID match (score 100)
                    if (customerData) {
                        if (order.customerId === customerData.wooId) {
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
                    if (matchScore === 0 && r.reviewer && namesMatch(r.reviewer, order.billingFirst || undefined, order.billingLast || undefined)) {
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

                // EDGE CASE: Track unmatched reviews for manual review
                // This helps identify reviews that couldn't be linked to customers/orders
                const matchStatus = wooCustomerId ? 'matched' : 'unmatched';
                if (!wooCustomerId && reviewerEmail) {
                    Logger.debug('[ReviewSync] Orphaned review - no customer match', {
                        accountId,
                        syncId,
                        reviewId: r.id,
                        reviewerEmail,
                        reviewerName: r.reviewer,
                        productId: r.product_id,
                        productName: r.product_name
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
                        wooOrderId,
                        matchStatus // Track match status for filtering
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
                        wooOrderId,
                        matchStatus // Track match status for filtering
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
            // Use WooCommerce's x-wp-totalpages header instead of batch size
            // (batch size is unreliable when Zod validation skips records from a full page)
            if (page >= totalPages) hasMore = false;

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

