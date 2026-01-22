import { esClient } from '../utils/elastic';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

export class CustomersService {
    static async searchCustomers(accountId: string, query: string = '', page: number = 1, limit: number = 20) {
        const from = (page - 1) * limit;

        const must: any[] = [
            { term: { accountId } }
        ];

        if (query) {
            must.push({
                multi_match: {
                    query,
                    fields: ['firstName', 'lastName', 'email'],
                    fuzziness: 'AUTO'
                }
            });
        }

        try {
            const response = await esClient.search({
                index: 'customers',
                query: {
                    bool: { must }
                },
                from,
                size: limit,
                sort: [
                    { firstName: { order: 'asc', unmapped_type: 'keyword' } },
                    { lastName: { order: 'asc', unmapped_type: 'keyword' } }
                ],
                track_total_hits: true
            });

            const hits = response.hits.hits.map(hit => ({
                id: hit._id,
                ...(hit._source as any)
            }));

            const total = (response.hits.total as any).value || 0;
            Logger.debug(`CustomerSearch`, { query, page, total });

            return {
                customers: hits,
                total,
                page,
                totalPages: Math.ceil(total / limit)
            };
        } catch (error) {
            Logger.error('Elasticsearch Customer Search Error', { error });
            return { customers: [], total: 0, page, totalPages: 0 };
        }
    }

    static async getCustomerDetails(accountId: string, customerId: string) {
        // 1. Fetch Basic Customer Data

        // Check if looking up by WooID (numeric) or internal UUID
        const isWooId = !isNaN(Number(customerId));
        const whereClause = isWooId
            ? { accountId, wooId: Number(customerId) }
            : { accountId, id: customerId };

        Logger.debug(`CustomerDetails lookup`, { customerId, accountId, isWooId });
        Logger.debug(`CustomerDetails whereClause`, { whereClause });

        let customer = await prisma.wooCustomer.findFirst({
            where: whereClause
        });

        // FALLBACK: If still missing in DB (Consistency Issue), try to fetch from Elastic to at least show the profile
        if (!customer) {
            Logger.debug(`CustomerDetails missing in DB, trying ES fallback`, { customerId });
            try {
                // We need to find the document in ES. If isWooId, we search by wooId field.
                const esQuery = isWooId ? { term: { wooId: Number(customerId) } } : { term: { _id: customerId } };

                const esRes = await esClient.search({
                    index: 'customers',
                    query: {
                        bool: {
                            must: [
                                { term: { accountId } },
                                esQuery
                            ]
                        }
                    }
                });

                if (esRes.hits.hits.length > 0) {
                    const source = esRes.hits.hits[0]._source as any;
                    // Map ES source to match Prisma shape approx
                    customer = {
                        id: esRes.hits.hits[0]._id,
                        accountId,
                        wooId: source.wooId || Number(customerId),
                        firstName: source.firstName,
                        lastName: source.lastName,
                        email: source.email,
                        totalSpent: source.totalSpent,
                        ordersCount: source.ordersCount,
                        dateCreated: new Date(source.dateCreated || Date.now()), // Mock if missing
                        rawData: source.rawData || {}, // Might be missing
                        // Mock other required fields
                        updatedAt: new Date(),
                        createdAt: new Date()
                    } as any;
                }
            } catch (e) {
                Logger.error('CustomerDetails ES Fallback failed', { error: e });
            }
        }

        if (!customer) {
            Logger.debug('CustomerDetails not found in DB or ES');
            return null;
        }

        // 2. Fetch Recent Orders
        const orders = await prisma.wooOrder.findMany({
            where: {
                accountId,
                rawData: {
                    path: ['customer_id'],
                    equals: customer.wooId
                }
            },
            select: {
                id: true,
                wooId: true,
                number: true,
                status: true,
                total: true,
                currency: true,
                dateCreated: true
            },
            orderBy: { dateCreated: 'desc' },
            take: 10
        });

        // 3. Automation History
        const automationEnrollments = await prisma.automationEnrollment.findMany({
            where: {
                automation: { accountId },
                email: customer.email
            },
            include: {
                automation: { select: { name: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: 20
        });

        // 4. Live Activity (Analytics) - select only needed fields
        const activitySessions = await prisma.analyticsSession.findMany({
            where: {
                accountId,
                OR: [
                    { wooCustomerId: customer.wooId },
                    { email: customer.email }
                ]
            },
            select: {
                id: true,
                visitorId: true,
                currentPath: true,
                lastActiveAt: true,
                country: true,
                city: true,
                deviceType: true,
                events: {
                    select: {
                        id: true,
                        type: true,
                        createdAt: true
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 5
                }
            },
            orderBy: { lastActiveAt: 'desc' },
            take: 5
        });

        return {
            customer,
            orders,
            automations: automationEnrollments,
            activity: activitySessions
        };
    }

    /**
     * Find potential duplicate customers by email or phone.
     */
    static async findDuplicates(accountId: string, customerId: string) {
        // Get the target customer first
        const isWooId = !isNaN(Number(customerId));
        const whereClause = isWooId
            ? { accountId, wooId: Number(customerId) }
            : { accountId, id: customerId };

        const customer = await prisma.wooCustomer.findFirst({ where: whereClause });
        if (!customer) return { duplicates: [] };

        const email = customer.email;

        // Find other customers with matching email
        const duplicates = await prisma.wooCustomer.findMany({
            where: {
                accountId,
                id: { not: customer.id },
                email: email
            },
            select: {
                id: true,
                wooId: true,
                firstName: true,
                lastName: true,
                email: true,
                ordersCount: true,
                totalSpent: true
            }
        });

        return {
            target: {
                id: customer.id,
                wooId: customer.wooId,
                firstName: customer.firstName,
                lastName: customer.lastName,
                email: customer.email,
                ordersCount: customer.ordersCount,
                totalSpent: customer.totalSpent
            },
            duplicates
        };
    }

    /**
     * Merge source customer into target customer.
     * Transfers orders, conversations, automation enrollments, then deletes source.
     */
    static async mergeCustomers(accountId: string, targetId: string, sourceId: string) {
        Logger.info(`Merging customer ${sourceId} into ${targetId}`, { accountId });

        // Get both customers
        const target = await prisma.wooCustomer.findFirst({ where: { accountId, id: targetId } });
        const source = await prisma.wooCustomer.findFirst({ where: { accountId, id: sourceId } });

        if (!target || !source) {
            throw new Error('Customer not found');
        }

        // 1. Transfer Orders - find orders by iterating (simpler than JSON path query)
        const allOrders = await prisma.wooOrder.findMany({
            where: { accountId },
            select: { id: true, rawData: true }
        });

        let ordersTransferred = 0;
        for (const order of allOrders) {
            const rawData = order.rawData as any;
            if (rawData?.customer_id === source.wooId) {
                rawData.customer_id = target.wooId;
                await prisma.wooOrder.update({
                    where: { id: order.id },
                    data: { rawData }
                });
                ordersTransferred++;
            }
        }

        // 2. Transfer Conversations
        await prisma.conversation.updateMany({
            where: { accountId, wooCustomerId: source.id },
            data: { wooCustomerId: target.id }
        });

        // 3. Transfer Automation Enrollments
        await prisma.automationEnrollment.updateMany({
            where: { email: source.email },
            data: { email: target.email }
        });

        // 4. Update target totals (convert Decimal to number for arithmetic)
        const newTotalSpent = Number(target.totalSpent) + Number(source.totalSpent);
        await prisma.wooCustomer.update({
            where: { id: target.id },
            data: {
                ordersCount: target.ordersCount + source.ordersCount,
                totalSpent: newTotalSpent
            }
        });

        // 5. Delete source customer
        await prisma.wooCustomer.delete({ where: { id: source.id } });

        Logger.info(`Customer merge complete`, {
            targetId,
            sourceId,
            ordersTransferred
        });

        return {
            success: true,
            ordersTransferred,
            targetId
        };
    }
}

