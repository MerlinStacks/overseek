import { prisma } from '../utils/prisma';
import { WooService } from './woo';

export class ReviewServiceError extends Error {
    constructor(public code: string, message: string) {
        super(message);
        this.name = 'ReviewServiceError';
    }
}

export class ReviewService {

    async getReviews(accountId: string, params: { page?: number; limit?: number; status?: string; search?: string }) {
        const page = params.page || 1;
        const limit = params.limit || 20;
        const skip = (page - 1) * limit;

        const where: any = { accountId };

        if (params.status && params.status !== 'all') {
            where.status = params.status;
        }

        if (params.search) {
            where.OR = [
                { content: { contains: params.search, mode: 'insensitive' } },
                { reviewer: { contains: params.search, mode: 'insensitive' } },
                { productName: { contains: params.search, mode: 'insensitive' } },
            ];
        }

        const [reviews, total, counts] = await Promise.all([
            prisma.wooReview.findMany({
                where,
                orderBy: { dateCreated: 'desc' },
                skip,
                take: limit,
                include: {
                    customer: true,
                    order: true
                }
            }),
            prisma.wooReview.count({ where }),
            this.getStatusCounts(accountId, params.search),
        ]);

        const productIds = Array.from(new Set(reviews.map((review) => review.productId).filter(Boolean)));
        const products = productIds.length > 0
            ? await prisma.wooProduct.findMany({
                where: { accountId, wooId: { in: productIds } },
                select: { wooId: true, permalink: true, mainImage: true }
            })
            : [];
        const productsByWooId = new Map(products.map((product) => [product.wooId, product]));

        return {
            reviews: reviews.map((review) => {
                const rawData = review.rawData && typeof review.rawData === 'object' && !Array.isArray(review.rawData)
                    ? review.rawData as Record<string, unknown>
                    : {};
                const product = productsByWooId.get(review.productId);

                return {
                    ...review,
                    media: Array.isArray(rawData.media) ? rawData.media : [],
                    replies: Array.isArray(rawData.replies) ? rawData.replies : [],
                    productUrl: product?.permalink || null,
                    productImage: product?.mainImage || null,
                };
            }),
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit),
            },
            statusCounts: counts,
        };
    }

    async getStatusCounts(accountId: string, search?: string) {
        const where: any = { accountId };

        if (search) {
            where.OR = [
                { content: { contains: search, mode: 'insensitive' } },
                { reviewer: { contains: search, mode: 'insensitive' } },
                { productName: { contains: search, mode: 'insensitive' } },
            ];
        }

        const grouped = await prisma.wooReview.groupBy({
            by: ['status'],
            where,
            _count: { status: true },
        });

        const counts = grouped.reduce<Record<string, number>>((acc, item) => {
            acc[item.status || 'unknown'] = item._count.status;
            return acc;
        }, {});

        return {
            total: Object.values(counts).reduce((sum, count) => sum + count, 0),
            counts,
        };
    }



    async replyToReview(accountId: string, reviewId: string, reply: string) {
        const review = await this.getOwnedReview(accountId, reviewId);
        const replyText = String(reply || '').trim();
        if (!replyText) throw new ReviewServiceError('REVIEW_REPLY_REQUIRED', 'Reply is required');

        const woo = await WooService.forAccount(accountId);
        const result = await woo.replyToReview(review.wooId, replyText);
        await this.mergeRawReviewData(review.id, result?.review);

        return result;
    }

    async updateReview(accountId: string, reviewId: string, data: { status?: string; content?: string; rating?: number }) {
        const review = await this.getOwnedReview(accountId, reviewId);
        const updateData: { status?: string; content?: string; rating?: number } = {};

        if (data.status !== undefined) {
            updateData.status = this.normalizeStatus(data.status);
        }

        if (data.content !== undefined) {
            const content = String(data.content || '').trim();
            if (!content) throw new ReviewServiceError('REVIEW_CONTENT_REQUIRED', 'Review content is required');
            updateData.content = content;
        }

        if (data.rating !== undefined) {
            const rating = Number(data.rating);
            if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
                throw new ReviewServiceError('REVIEW_RATING_INVALID', 'Rating must be between 1 and 5');
            }
            updateData.rating = rating;
        }

        if (Object.keys(updateData).length === 0) {
            throw new ReviewServiceError('REVIEW_NO_CHANGES', 'No review changes provided');
        }

        const woo = await WooService.forAccount(accountId);
        const result = await woo.updateReview(review.wooId, updateData);

        await prisma.wooReview.update({
            where: { id: review.id },
            data: {
                ...(updateData.status ? { status: updateData.status } : {}),
                ...(updateData.content ? { content: updateData.content } : {}),
                ...(updateData.rating ? { rating: updateData.rating } : {}),
                ...(result?.review ? { rawData: { ...(review.rawData as any), ...result.review } } : {})
            }
        });

        return result;
    }

    async moderateReview(accountId: string, reviewId: string, status: string) {
        return this.updateReview(accountId, reviewId, { status });
    }

    async bulkModerateReviews(accountId: string, reviewIds: string[], status: string) {
        const normalizedStatus = this.normalizeStatus(status);
        const uniqueReviewIds = Array.from(new Set(reviewIds.map((id) => String(id || '').trim()).filter(Boolean)));
        if (uniqueReviewIds.length === 0) throw new ReviewServiceError('REVIEW_IDS_REQUIRED', 'At least one review is required');
        if (uniqueReviewIds.length > 100) throw new ReviewServiceError('REVIEW_BULK_LIMIT', 'Bulk moderation is limited to 100 reviews');

        const reviews = await prisma.wooReview.findMany({
            where: { accountId, id: { in: uniqueReviewIds } },
            select: { id: true, wooId: true }
        });

        if (reviews.length !== uniqueReviewIds.length) {
            throw new ReviewServiceError('REVIEW_NOT_FOUND', 'One or more reviews were not found');
        }

        const woo = await WooService.forAccount(accountId);
        const results = await Promise.allSettled(
            reviews.map((review) => woo.updateReview(review.wooId, { status: normalizedStatus }))
        );
        const failed = results.filter((result) => result.status === 'rejected').length;
        const successfulIds = reviews
            .filter((_, index) => results[index].status === 'fulfilled')
            .map((review) => review.id);

        if (successfulIds.length > 0) {
            await prisma.wooReview.updateMany({
                where: { accountId, id: { in: successfulIds } },
                data: { status: normalizedStatus }
            });
        }

        return { success: failed === 0, updated: successfulIds.length, failed, status: normalizedStatus };
    }

    /**
     * Re-matches all reviews to orders using enhanced matching algorithm.
     * Runs in background and returns statistics.
     */
    async rematchAllReviews(accountId: string): Promise<{
        totalReviews: number;
        matchedReviews: number;
        updatedReviews: number;
        matchRate: string;
    }> {
        const reviews = await prisma.wooReview.findMany({
            where: { accountId },
            include: { customer: true }
        });

        // Pre-fetch all customers for this account to avoid N+1 per review and per order.
        // Why: rematchAllReviews iterates every review and inner-loops every order;
        // customer lookups inside those loops would issue hundreds of DB queries.
        const allCustomers = await prisma.wooCustomer.findMany({
            where: { accountId }
        });
        // Maps for O(1) lookup — same customer may appear under multiple normalized emails
        const customerByEmail = new Map<string, typeof allCustomers[0]>();
        const customerById = new Map<string, typeof allCustomers[0]>();
        for (const c of allCustomers) {
            customerById.set(c.id, c);
            const norm = this.normalizeEmail(c.email);
            if (norm) customerByEmail.set(norm, c);
        }

        const reviewDates = reviews.map((review) => review.dateCreated.getTime());
        const earliestReviewDate = reviewDates.length > 0 ? new Date(Math.min(...reviewDates)) : null;
        const latestReviewDate = reviewDates.length > 0 ? new Date(Math.max(...reviewDates)) : null;
        const orderLookbackDate = earliestReviewDate ? new Date(earliestReviewDate) : null;
        if (orderLookbackDate) orderLookbackDate.setDate(orderLookbackDate.getDate() - 180);
        const allPotentialOrders = orderLookbackDate && latestReviewDate
            ? await prisma.wooOrder.findMany({
                where: {
                    accountId,
                    dateCreated: { gte: orderLookbackDate, lte: latestReviewDate }
                },
                orderBy: { dateCreated: 'desc' },
                select: { id: true, number: true, dateCreated: true, rawData: true }
            })
            : [];

        let matchedReviews = 0;
        let updatedReviews = 0;

        for (const review of reviews) {
            const reviewerEmail = review.reviewerEmail;
            const wooCustomerId = review.wooCustomerId;
            const productId = review.productId;
            const reviewDate = review.dateCreated;

            // Try to find/link customer by email if not already linked
            let newCustomerId: string | null = wooCustomerId;
            if (!wooCustomerId && reviewerEmail) {
                const normalizedEmail = this.normalizeEmail(reviewerEmail);
                if (normalizedEmail) {
                    // Map lookup — no DB query per review
                    const customer = customerByEmail.get(normalizedEmail) ?? null;
                    if (customer) {
                        newCustomerId = customer.id;
                    }
                }
            }

            // 180-day lookback window
            const lookbackDate = new Date(reviewDate);
            lookbackDate.setDate(lookbackDate.getDate() - 180);

            const potentialOrders = allPotentialOrders.filter((order) => order.dateCreated >= lookbackDate && order.dateCreated <= reviewDate);

            interface OrderMatch { orderId: string; orderNumber: string; score: number; daysDiff: number; }
            const matches: OrderMatch[] = [];

            for (const order of potentialOrders) {
                const data = order.rawData as any;
                const lineItems = data.line_items || [];

                // Product matching (including variations)
                const hasProduct = lineItems.some((item: any) => {
                    if (item.product_id === productId) return true;
                    if (item.variation_id && item.product_id === productId) return true;
                    if (item.variation_id === productId) return true;
                    return false;
                });
                if (!hasProduct) continue;

                // Tiered scoring
                let matchScore = 0;
                const normalizedOrderEmail = this.normalizeEmail(data.billing?.email);
                const normalizedReviewerEmail = this.normalizeEmail(reviewerEmail);
                const orderCustomerId = data.customer_id;
                const billingFirst = data.billing?.first_name;
                const billingLast = data.billing?.last_name;

                // Priority 1: Customer ID match (100) — Map lookup, no DB query
                if (newCustomerId) {
                    const customer = customerById.get(newCustomerId) ?? null;
                    if (customer && orderCustomerId === customer.wooId) {
                        matchScore = 100;
                    } else if (customer && normalizedOrderEmail === this.normalizeEmail(customer.email)) {
                        matchScore = 90;
                    }
                }

                // Priority 2: Direct email match (80)
                if (matchScore === 0 && normalizedReviewerEmail && normalizedOrderEmail === normalizedReviewerEmail) {
                    matchScore = 80;
                }

                // Priority 3: Name match (60)
                if (matchScore === 0 && review.reviewer && this.namesMatch(review.reviewer, billingFirst, billingLast)) {
                    matchScore = 60;
                }

                // Priority 4: Product-only temporal match (40)
                if (matchScore === 0) {
                    const daysDiff = (reviewDate.getTime() - new Date(order.dateCreated).getTime()) / (1000 * 60 * 60 * 24);
                    if (daysDiff >= 7 && daysDiff <= 60) {
                        matchScore = 40;
                    }
                }

                if (matchScore > 0) {
                    const daysDiff = Math.abs((reviewDate.getTime() - new Date(order.dateCreated).getTime()) / (1000 * 60 * 60 * 24));
                    matches.push({ orderId: order.id, orderNumber: order.number, score: matchScore, daysDiff });
                }
            }

            matches.sort((a, b) => b.score !== a.score ? b.score - a.score : a.daysDiff - b.daysDiff);

            // Build update data
            const updateData: { wooOrderId?: string | null; wooCustomerId?: string | null } = {};
            let needsUpdate = false;

            // Update customer link if changed
            if (newCustomerId !== review.wooCustomerId) {
                updateData.wooCustomerId = newCustomerId;
                needsUpdate = true;
            }

            // Update order link
            if (matches.length > 0) {
                matchedReviews++;
                const bestMatch = matches[0];
                if (review.wooOrderId !== bestMatch.orderId) {
                    updateData.wooOrderId = bestMatch.orderId;
                    needsUpdate = true;
                }
            } else if (review.wooOrderId) {
                updateData.wooOrderId = null;
                needsUpdate = true;
            }

            if (needsUpdate) {
                await prisma.wooReview.update({
                    where: { id: review.id },
                    data: updateData
                });
                updatedReviews++;
            }
        }

        return {
            totalReviews: reviews.length,
            matchedReviews,
            updatedReviews,
            matchRate: reviews.length > 0 ? `${((matchedReviews / reviews.length) * 100).toFixed(1)}%` : 'N/A'
        };
    }

    private normalizeEmail(email: string | null | undefined): string | null {
        if (!email) return null;
        const trimmed = email.trim().toLowerCase();
        const atIndex = trimmed.indexOf('@');
        if (atIndex === -1) return trimmed;
        const localPart = trimmed.substring(0, atIndex);
        const domain = trimmed.substring(atIndex);
        const plusIndex = localPart.indexOf('+');
        return plusIndex !== -1 ? localPart.substring(0, plusIndex) + domain : trimmed;
    }

    private async getOwnedReview(accountId: string, reviewId: string) {
        const review = await prisma.wooReview.findUnique({ where: { id: reviewId } });
        if (!review || review.accountId !== accountId) {
            throw new ReviewServiceError('REVIEW_NOT_FOUND', 'Review not found');
        }
        return review;
    }

    private normalizeStatus(status: string): string {
        const normalized = String(status || '').toLowerCase().trim();
        const allowed = new Set(['approved', 'hold', 'spam', 'trash']);
        if (!allowed.has(normalized)) {
            throw new ReviewServiceError('REVIEW_STATUS_INVALID', 'Invalid review status');
        }
        return normalized;
    }

    private async mergeRawReviewData(reviewId: string, reviewData: unknown) {
        if (!reviewData || typeof reviewData !== 'object') return;

        const review = await prisma.wooReview.findUnique({ where: { id: reviewId }, select: { rawData: true } });
        if (!review) return;

        const currentRawData = review.rawData && typeof review.rawData === 'object' && !Array.isArray(review.rawData)
            ? review.rawData as Record<string, unknown>
            : {};

        await prisma.wooReview.update({
            where: { id: reviewId },
            data: { rawData: { ...currentRawData, ...(reviewData as Record<string, unknown>) } as any }
        });
    }

    private namesMatch(reviewerName: string, billingFirst: string | undefined, billingLast: string | undefined): boolean {
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
}
