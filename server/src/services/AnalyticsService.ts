
import { prisma } from '../utils/prisma';

export class AnalyticsService {

    /**
     * Get Visitor Log (Real-time Traffic)
     * Includes last 10 events per session for action display
     */
    static async getVisitorLog(accountId: string, page = 1, limit = 50) {
        if (!accountId) throw new Error("Account ID is required");
        const skip = (page - 1) * limit;

        const [data, total] = await Promise.all([
            prisma.analyticsSession.findMany({
                where: { accountId },
                orderBy: { lastActiveAt: 'desc' },
                skip,
                take: limit,
                include: {
                    _count: {
                        select: { events: true }
                    },
                    events: {
                        orderBy: { createdAt: 'desc' },
                        take: 10,
                        select: {
                            id: true,
                            type: true,
                            url: true,
                            pageTitle: true,
                            createdAt: true
                        }
                    }
                }
            }),
            prisma.analyticsSession.count({ where: { accountId } })
        ]);

        return { data, total, page, totalPages: Math.ceil(total / limit) };
    }

    /**
     * Get Ecommerce Log (Transaction/Event Stream)
     */
    static async getEcommerceLog(accountId: string, page = 1, limit = 50) {
        const skip = (page - 1) * limit;

        const commerceTypes = ['add_to_cart', 'remove_from_cart', 'checkout_start', 'checkout_success', 'purchase'];

        const [data, total] = await Promise.all([
            prisma.analyticsEvent.findMany({
                where: {
                    session: { accountId },
                    type: { in: commerceTypes }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
                include: {
                    session: {
                        select: {
                            visitorId: true,
                            email: true,
                            city: true,
                            country: true
                        }
                    }
                }
            }),
            prisma.analyticsEvent.count({
                where: {
                    session: { accountId },
                    type: { in: commerceTypes }
                }
            })
        ]);

        return { data, total, page, totalPages: Math.ceil(total / limit) };
    }

    /**
     * Get Visitor Profile
     */
    static async getVisitorProfile(visitorId: string, accountId: string) {
        const session = await prisma.analyticsSession.findUnique({
            where: { accountId_visitorId: { accountId, visitorId } },
            include: {
                events: {
                    orderBy: { createdAt: 'desc' },
                    take: 100 // Last 100 events
                }
            }
        });

        if (!session) return null;

        // Calculate stats
        // Total Spent? We don't strictly track historical order sum in AnalyticsSession yet, 
        // unless we link to WooCustomer.
        let customerData = null;
        if (session.wooCustomerId) {
            customerData = await prisma.wooCustomer.findUnique({
                where: { accountId_wooId: { accountId, wooId: session.wooCustomerId } }
            });
        }

        return {
            session,
            customer: customerData,
            stats: {
                totalEvents: await prisma.analyticsEvent.count({ where: { sessionId: session.id } }),
                firstSeen: await prisma.analyticsEvent.findFirst({
                    where: { sessionId: session.id },
                    orderBy: { createdAt: 'asc' },
                    select: { createdAt: true }
                })
            }
        };
    }

    /**
     * Get Channel Breakdown (Attribution)
     */
    static async getChannelBreakdown(accountId: string) {
        // Group by utmSource or Referrer
        // Prisma groupBy is good here
        const sources = await prisma.analyticsSession.groupBy({
            by: ['utmSource'],
            where: { accountId },
            _count: {
                _all: true
            },
            orderBy: {
                _count: {
                    utmSource: 'desc'
                }
            },
            take: 10
        });

        // Also referrers if utmSource is null?
        // For simple widget, let's return direct source breakdown
        // Formatting: [{ name: 'google', count: 123 }, { name: 'Direct', count: 50 }]

        return sources.map(s => ({
            name: s.utmSource || 'Direct / None',
            count: s._count._all
        }));
    }

    /**
     * Get Search Insights
     */
    static async getSearchTerms(accountId: string) {
        // We stored search terms in payload: { term: "..." } or similar
        // Querying JSON fields in prisma aggregation is tricky.
        // We might need raw query or just fetch recent search events and aggregate in memory for now (if low volume)
        // Or if we had a dedicated SearchEvent table.

        // For MVP: Fetch last 500 search events and aggregate.
        const events = await prisma.analyticsEvent.findMany({
            where: {
                session: { accountId },
                type: 'search'
            },
            orderBy: { createdAt: 'desc' },
            take: 500,
            select: { payload: true }
        });

        const termCounts: Record<string, number> = {};

        events.forEach(e => {
            const term = (e.payload as any)?.term;
            if (term) {
                const lower = String(term).toLowerCase().trim();
                termCounts[lower] = (termCounts[lower] || 0) + 1;
            }
        });

        // Sort
        const sorted = Object.entries(termCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([term, count]) => ({ term, count }));

        return sorted;
    }
}
