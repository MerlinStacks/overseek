import { prisma } from '../utils/prisma';

export class AutomationAnalyticsService {
    async getAutomationAnalytics(accountId: string, automationId: string) {
        const [enrollmentGroups, eventGroups, goalAggregate, recentRuns, runEventGroups] = await Promise.all([
            prisma.automationEnrollment.groupBy({
                by: ['status'],
                where: { accountId, automationId },
                _count: true
            }),
            prisma.campaignEvent.groupBy({
                by: ['eventType'],
                where: { accountId, campaignId: automationId },
                _count: true
            }),
            prisma.automationGoalEvent.aggregate({
                where: { accountId, automationId },
                _count: true,
                _sum: { revenue: true }
            }),
            prisma.automationRunEvent.findMany({
                where: { accountId, automationId },
                orderBy: { createdAt: 'desc' },
                take: 20
            }),
            prisma.automationRunEvent.groupBy({
                by: ['eventType', 'outcome'],
                where: { accountId, automationId },
                _count: true
            })
        ]);

        const enrollmentStats = Object.fromEntries(enrollmentGroups.map(group => [group.status, group._count]));
        const eventStats = Object.fromEntries(eventGroups.map(group => [group.eventType, group._count]));
        const runStats = runEventGroups.reduce<Record<string, number>>((accumulator, group) => {
            const key = group.outcome || group.eventType;
            accumulator[key] = (accumulator[key] || 0) + group._count;
            return accumulator;
        }, {});

        return {
            enrollments: {
                active: enrollmentStats.ACTIVE || 0,
                completed: enrollmentStats.COMPLETED || 0,
                cancelled: enrollmentStats.CANCELLED || 0,
                total: enrollmentGroups.reduce((sum, group) => sum + group._count, 0)
            },
            email: {
                sends: eventStats.send || 0,
                opens: eventStats.open || 0,
                clicks: eventStats.click || 0,
                unsubscribes: eventStats.unsubscribe || 0
            },
            goals: {
                conversions: goalAggregate._count || 0,
                revenue: Number(goalAggregate._sum.revenue || 0)
            },
            execution: {
                queued: runStats.ENROLLED || 0,
                waiting: runStats.WAITING || 0,
                sent: runStats.EMAIL_SENT || 0,
                skipped: runStats.EMAIL_SKIPPED || 0,
                failed: runStats.EMAIL_FAILED || 0,
                notConfigured: runStats.EMAIL_NOT_CONFIGURED || 0,
                cooldownBlocked: runStats.ACCOUNT_EMAIL_COOLDOWN || 0,
                quietHoursBlocked: runStats.QUIET_HOURS || 0,
                frequencyCapped: runStats.FREQUENCY_CAPPED || 0,
                duplicateEnrollments: runStats.DUPLICATE_ENROLLMENT || 0,
                recoveredOrders: runStats.PURCHASE_ATTRIBUTED || 0
            },
            recentRuns
        };
    }

    async listEnrollments(accountId: string, automationId: string, limit = 50) {
        return prisma.automationEnrollment.findMany({
            where: { accountId, automationId },
            orderBy: { createdAt: 'desc' },
            take: limit,
            select: {
                id: true,
                email: true,
                status: true,
                statusReason: true,
                currentNodeId: true,
                lastProcessedNodeId: true,
                triggerEntityType: true,
                triggerEntityId: true,
                nextRunAt: true,
                enteredAt: true,
                completedAt: true,
                cancelledAt: true,
                conversionAt: true,
                convertedOrderId: true,
                convertedRevenue: true,
                createdAt: true,
                updatedAt: true
            }
        });
    }

    async listRunEvents(accountId: string, automationId: string, limit = 50) {
        return prisma.automationRunEvent.findMany({
            where: { accountId, automationId },
            orderBy: { createdAt: 'desc' },
            take: limit,
            select: {
                id: true,
                enrollmentId: true,
                nodeId: true,
                eventType: true,
                outcome: true,
                metadata: true,
                createdAt: true
            }
        });
    }
}

export const automationAnalyticsService = new AutomationAnalyticsService();
