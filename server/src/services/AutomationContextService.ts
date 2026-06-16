import { prisma } from '../utils/prisma';
import { SegmentService } from './SegmentService';

const PURCHASE_STATUSES = ['processing', 'on-hold', 'completed'];

interface BuildContextInput {
    accountId: string;
    wooCustomerId?: number | null;
    email?: string | null;
    contextData?: Record<string, any> | null;
    requiredFields?: string[];
}

export class AutomationContextService {
    private segmentService = new SegmentService();

    async buildContext(input: BuildContextInput) {
        const baseContext = { ...(input.contextData || {}) };
        const requiredFields = new Set(input.requiredFields || []);
        const needsOrder = this.needsOrderContext(baseContext, requiredFields);
        const normalizedEmail = this.normalizeEmail(
            input.email
            || baseContext.email
            || baseContext.customer?.email
            || baseContext.billing?.email
            || baseContext.order?.billing?.email
        );

        const needsCustomer =
            input.wooCustomerId
            || normalizedEmail
            || Array.from(requiredFields).some((field) => field.startsWith('customer.') || field === 'segment.id' || field === 'inbox.customerSentEmail');

        if (!needsCustomer && !needsOrder) {
            return baseContext;
        }

        if (!input.wooCustomerId && !normalizedEmail) {
            const orderRaw = needsOrder
                ? await this.getOrderRawData(input.accountId, baseContext)
                : undefined;

            return {
                ...baseContext,
                order: this.mergeOrderContext(baseContext.order, orderRaw) || baseContext.order,
                billing: baseContext.billing || orderRaw?.billing || undefined,
                customer: {
                    ...(baseContext.customer || {}),
                    emailDomain: baseContext.customer?.emailDomain || ''
                },
                segmentIds: baseContext.segmentIds || []
            };
        }

        const customer = await prisma.wooCustomer.findFirst({
            where: {
                accountId: input.accountId,
                OR: [
                    ...(input.wooCustomerId ? [{ wooId: input.wooCustomerId }] : []),
                    ...(normalizedEmail ? [{ email: normalizedEmail }] : [])
                ]
            },
            select: {
                id: true,
                wooId: true,
                email: true,
                firstName: true,
                lastName: true,
                totalSpent: true,
                ordersCount: true,
                rawData: true
            }
        });

        const order = needsOrder
            ? await this.getOrder(input.accountId, baseContext, input.wooCustomerId ?? customer?.wooId ?? null, normalizedEmail)
            : await this.getLatestOrder(input.accountId, input.wooCustomerId ?? customer?.wooId ?? null, normalizedEmail);
        const segmentIds = customer && requiredFields.has('segment.id')
            ? await this.segmentService.getMatchingSegmentIdsForCustomer(input.accountId, customer.id)
            : undefined;
        const hasInboxEmail = requiredFields.has('inbox.customerSentEmail')
            ? await this.hasCustomerInboxEmail(input.accountId, customer?.id || null, normalizedEmail)
            : undefined;
        const latestReview = (requiredFields.has('customer.reviewedInLastDays') || requiredFields.has('customer.latestReviewRating'))
            ? await this.getLatestReview(input.accountId, customer?.id || null, normalizedEmail)
            : undefined;

        const orderRaw = await this.enrichOrderLineItemPermalinks(input.accountId, this.asRecord(order?.rawData));
        const customerRaw = this.asRecord(customer?.rawData);
        const lastPurchaseDate = order?.dateCreated || null;

        return {
            ...baseContext,
            email: baseContext.email || normalizedEmail || customer?.email,
            customer: {
                ...customerRaw,
                ...(baseContext.customer || {}),
                id: baseContext.customer?.id || customer?.wooId || input.wooCustomerId || null,
                wooCustomerRecordId: customer?.id || null,
                email: baseContext.customer?.email || normalizedEmail || customer?.email || '',
                firstName: baseContext.customer?.firstName || customer?.firstName || '',
                lastName: baseContext.customer?.lastName || customer?.lastName || '',
                totalSpent: baseContext.customer?.totalSpent ?? (customer ? Number(customer.totalSpent) : 0),
                ordersCount: baseContext.customer?.ordersCount ?? customer?.ordersCount ?? 0,
                phone: baseContext.customer?.phone || customerRaw?.billing?.phone || customerRaw?.phone || '',
                country: baseContext.customer?.country || customerRaw?.billing?.country || customerRaw?.shipping?.country || '',
                state: baseContext.customer?.state || customerRaw?.billing?.state || customerRaw?.shipping?.state || '',
                city: baseContext.customer?.city || customerRaw?.billing?.city || customerRaw?.shipping?.city || '',
                postcode: baseContext.customer?.postcode || customerRaw?.billing?.postcode || customerRaw?.shipping?.postcode || '',
                emailDomain: normalizedEmail?.split('@')[1] || '',
                lastOrderDate: baseContext.customer?.lastOrderDate || lastPurchaseDate?.toISOString() || null,
                daysSinceLastOrder: baseContext.customer?.daysSinceLastOrder ?? this.getDaysSince(lastPurchaseDate),
                latestReviewDate: baseContext.customer?.latestReviewDate || latestReview?.dateCreated?.toISOString() || null,
                latestReviewRating: baseContext.customer?.latestReviewRating ?? latestReview?.rating ?? null,
                hasInboxEmail: baseContext.customer?.hasInboxEmail ?? hasInboxEmail ?? false
            },
            order: this.mergeOrderContext(baseContext.order, orderRaw) || baseContext.order || undefined,
            billing: baseContext.billing || orderRaw?.billing || undefined,
            segmentIds: baseContext.segmentIds || segmentIds || [],
            inbox: {
                ...(this.asRecord(baseContext.inbox) || {}),
                customerSentEmail: baseContext.inbox?.customerSentEmail ?? hasInboxEmail ?? false
            }
        };
    }

    private async hasCustomerInboxEmail(accountId: string, wooCustomerRecordId?: string | null, email?: string | null): Promise<boolean> {
        if (!wooCustomerRecordId && !email) return false;

        const match = await prisma.message.findFirst({
            where: {
                senderType: 'CUSTOMER',
                conversation: {
                    accountId,
                    channel: 'EMAIL',
                    OR: [
                        ...(wooCustomerRecordId ? [{ wooCustomerId: wooCustomerRecordId }] : []),
                        ...(email ? [{ guestEmail: email }, { wooCustomer: { is: { email } } }] : [])
                    ]
                }
            },
            select: { id: true }
        });

        return Boolean(match);
    }

    private async getLatestOrder(accountId: string, wooCustomerId?: number | null, email?: string | null) {
        if (!wooCustomerId && !email) return null;

        return prisma.wooOrder.findFirst({
            where: {
                accountId,
                status: { in: PURCHASE_STATUSES },
                OR: [
                    ...(wooCustomerId ? [{ wooCustomerId }] : []),
                    ...(email ? [{ billingEmail: email }] : [])
                ]
            },
            orderBy: { dateCreated: 'desc' },
            select: {
                rawData: true,
                dateCreated: true
            }
        });
    }

    private async getOrder(accountId: string, contextData: Record<string, any>, wooCustomerId?: number | null, email?: string | null) {
        const orderId = this.resolveWooOrderId(contextData);
        if (orderId) {
            const order = await prisma.wooOrder.findUnique({
                where: { accountId_wooId: { accountId, wooId: orderId } },
                select: {
                    rawData: true,
                    dateCreated: true
                }
            });

            if (order) return order;
        }

        return this.getLatestOrder(accountId, wooCustomerId, email);
    }

    private async getOrderRawData(accountId: string, contextData: Record<string, any>): Promise<Record<string, any> | undefined> {
        const order = await this.getOrder(accountId, contextData);
        return this.enrichOrderLineItemPermalinks(accountId, this.asRecord(order?.rawData));
    }

    private needsOrderContext(contextData: Record<string, any>, requiredFields: Set<string>): boolean {
        if (Array.from(requiredFields).some((field) => field.startsWith('order.'))) return true;
        return Boolean(this.resolveWooOrderId(contextData));
    }

    private resolveWooOrderId(contextData: Record<string, any>): number | null {
        const candidate = contextData.order?.wooId
            || contextData.order?.woo_id
            || contextData.order?.id
            || contextData.wooOrderId
            || contextData.woo_order_id
            || contextData.wooId
            || contextData.woo_id
            || contextData.orderId
            || contextData.order_id
            || contextData.id;
        const parsed = Number(candidate);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }

    private mergeOrderContext(baseOrder: unknown, wooOrder: Record<string, any> | undefined): Record<string, any> | undefined {
        const base = this.asRecord(baseOrder);
        if (!base && !wooOrder) return undefined;
        return {
            ...(wooOrder || {}),
            ...(base || {})
        };
    }

    private async enrichOrderLineItemPermalinks(accountId: string, order: Record<string, any>): Promise<Record<string, any>> {
        const lineItems = Array.isArray(order?.line_items)
            ? order.line_items
            : Array.isArray(order?.lineItems)
                ? order.lineItems
                : [];

        const productIds = Array.from(new Set(lineItems
            .map((item) => Number(item?.product_id || item?.productId))
            .filter((id) => Number.isFinite(id) && id > 0)));

        if (productIds.length === 0) return order;

        const products = await prisma.wooProduct.findMany({
            where: {
                accountId,
                wooId: { in: productIds }
            },
            select: {
                wooId: true,
                permalink: true
            }
        });
        const permalinkByWooId = new Map(products
            .filter((product) => product.permalink)
            .map((product) => [product.wooId, product.permalink as string]));

        if (permalinkByWooId.size === 0) return order;

        const enrichedLineItems = lineItems.map((item) => {
            const productId = Number(item?.product_id || item?.productId);
            const permalink = permalinkByWooId.get(productId);
            if (!permalink || item.permalink || item.product_permalink || item.productUrl || item.product_url) return item;
            return {
                ...item,
                permalink,
                product_permalink: permalink,
                productUrl: permalink,
                product_url: permalink
            };
        });

        return Array.isArray(order?.line_items)
            ? { ...order, line_items: enrichedLineItems }
            : { ...order, lineItems: enrichedLineItems };
    }

    private async getLatestReview(
        accountId: string,
        wooCustomerRecordId?: string | null,
        email?: string | null
    ): Promise<{ dateCreated: Date; rating: number } | null> {
        if (!wooCustomerRecordId && !email) return null;

        const review = await prisma.wooReview.findFirst({
            where: {
                accountId,
                OR: [
                    ...(wooCustomerRecordId ? [{ wooCustomerId: wooCustomerRecordId }] : []),
                    ...(email ? [{ reviewerEmail: email }] : [])
                ]
            },
            orderBy: { dateCreated: 'desc' },
            select: {
                dateCreated: true,
                rating: true
            }
        });

        return review || null;
    }

    private normalizeEmail(value: unknown): string | null {
        return typeof value === 'string' && value.trim()
            ? value.toLowerCase().trim()
            : null;
    }

    private getDaysSince(date: Date | null): number | null {
        if (!date) return null;
        return Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
    }

    private asRecord(value: unknown): Record<string, any> | undefined {
        return value && typeof value === 'object' && !Array.isArray(value)
            ? value as Record<string, any>
            : undefined;
    }
}

export const automationContextService = new AutomationContextService();
