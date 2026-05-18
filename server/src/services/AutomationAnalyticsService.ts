import { prisma } from '../utils/prisma';

export class AutomationAnalyticsService {
    private getNodeOutcomeWhere(status: string) {
        if (status === 'failed') {
            return {
                OR: [
                    { outcome: { contains: 'FAILED' } },
                    { outcome: 'EMAIL_NOT_CONFIGURED' }
                ]
            };
        }

        if (status === 'skipped') {
            return { outcome: { contains: 'SKIPPED' } };
        }

        return {
            NOT: [
                { outcome: { contains: 'FAILED' } },
                { outcome: { contains: 'SKIPPED' } },
                { outcome: 'EMAIL_NOT_CONFIGURED' }
            ]
        };
    }

    async getAutomationAnalytics(accountId: string, automationId: string) {
        const [enrollmentGroups, eventGroups, goalAggregate, recentRuns, runEventGroups, nodeEvents] = await Promise.all([
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
            }),
            prisma.automationRunEvent.findMany({
                where: {
                    accountId,
                    automationId,
                    eventType: 'NODE_EXECUTED',
                    nodeId: { not: null }
                },
                select: {
                    nodeId: true,
                    outcome: true,
                    metadata: true,
                    createdAt: true
                },
                orderBy: { createdAt: 'desc' },
                take: 5000
            })
        ]);

        const enrollmentStats = Object.fromEntries(enrollmentGroups.map(group => [group.status, group._count]));
        const eventStats = Object.fromEntries(eventGroups.map(group => [group.eventType, group._count]));
        const runStats = runEventGroups.reduce<Record<string, number>>((accumulator, group) => {
            const key = group.outcome || group.eventType;
            accumulator[key] = (accumulator[key] || 0) + group._count;
            return accumulator;
        }, {});

        const nodePerformanceMap = new Map<string, {
            nodeId: string;
            total: number;
            failed: number;
            skipped: number;
            durationSamples: number;
            totalDurationMs: number;
            lastOutcome: string | null;
            lastSeenAt: Date;
        }>();

        for (const event of nodeEvents) {
            const nodeId = event.nodeId;
            if (!nodeId) continue;

            const stats = nodePerformanceMap.get(nodeId) || {
                nodeId,
                total: 0,
                failed: 0,
                skipped: 0,
                durationSamples: 0,
                totalDurationMs: 0,
                lastOutcome: null,
                lastSeenAt: event.createdAt
            };

            stats.total += 1;
            const outcome = String(event.outcome || '').toUpperCase();
            if (outcome.includes('FAILED')) stats.failed += 1;
            if (outcome.includes('SKIPPED')) stats.skipped += 1;

            const metadata = (event.metadata as Record<string, unknown> | null) || null;
            const executionMsRaw = metadata?.executionMs;
            if (typeof executionMsRaw === 'number' && Number.isFinite(executionMsRaw)) {
                stats.totalDurationMs += executionMsRaw;
                stats.durationSamples += 1;
            }

            if (event.createdAt >= stats.lastSeenAt) {
                stats.lastSeenAt = event.createdAt;
                stats.lastOutcome = event.outcome || null;
            }

            nodePerformanceMap.set(nodeId, stats);
        }

        const nodePerformance = Array.from(nodePerformanceMap.values())
            .map((stats) => ({
                nodeId: stats.nodeId,
                executions: stats.total,
                failed: stats.failed,
                skipped: stats.skipped,
                failureRate: stats.total > 0 ? stats.failed / stats.total : 0,
                avgExecutionMs: stats.durationSamples > 0 ? Math.round(stats.totalDurationMs / stats.durationSamples) : null,
                lastOutcome: stats.lastOutcome,
                lastSeenAt: stats.lastSeenAt
            }))
            .sort((a, b) => {
                if (b.failureRate !== a.failureRate) return b.failureRate - a.failureRate;
                if (b.executions !== a.executions) return b.executions - a.executions;
                return b.lastSeenAt.getTime() - a.lastSeenAt.getTime();
            })
            .slice(0, 12);

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
            nodePerformance,
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

    async getNodeAnalytics(accountId: string, automationId: string, nodeId: string, status = 'completed', page = 1, perPage = 10) {
        const safePage = Math.max(1, page);
        const safePerPage = Math.min(100, Math.max(1, perPage));
        const normalizedStatus = ['completed', 'skipped', 'failed'].includes(status) ? status : 'completed';
        const baseWhere = {
            accountId,
            automationId,
            nodeId,
            eventType: 'NODE_EXECUTED'
        };
        const statusWhere = this.getNodeOutcomeWhere(normalizedStatus);

        const [completed, skipped, failed, total, events] = await Promise.all([
            prisma.automationRunEvent.count({ where: { ...baseWhere, ...this.getNodeOutcomeWhere('completed') } }),
            prisma.automationRunEvent.count({ where: { ...baseWhere, ...this.getNodeOutcomeWhere('skipped') } }),
            prisma.automationRunEvent.count({ where: { ...baseWhere, ...this.getNodeOutcomeWhere('failed') } }),
            prisma.automationRunEvent.count({ where: { ...baseWhere, ...statusWhere } }),
            prisma.automationRunEvent.findMany({
                where: { ...baseWhere, ...statusWhere },
                orderBy: { createdAt: 'desc' },
                skip: (safePage - 1) * safePerPage,
                take: safePerPage,
                select: {
                    id: true,
                    enrollmentId: true,
                    outcome: true,
                    metadata: true,
                    createdAt: true,
                    enrollment: {
                        select: {
                            email: true,
                            contextData: true,
                            triggerEntityId: true
                        }
                    }
                }
            })
        ]);

        const enrollmentIds = Array.from(new Set(events.map((event) => event.enrollmentId)));
        const journeyEvents = enrollmentIds.length > 0
            ? await prisma.automationRunEvent.findMany({
                where: {
                    accountId,
                    automationId,
                    enrollmentId: { in: enrollmentIds }
                },
                orderBy: { createdAt: 'asc' },
                select: {
                    enrollmentId: true,
                    nodeId: true,
                    eventType: true,
                    outcome: true,
                    createdAt: true
                }
            })
            : [];

        const journeysByEnrollment = journeyEvents.reduce<Record<string, typeof journeyEvents>>((accumulator, event) => {
            accumulator[event.enrollmentId] = accumulator[event.enrollmentId] || [];
            accumulator[event.enrollmentId].push(event);
            return accumulator;
        }, {});

        const contacts = events.map((event) => {
            const context = (event.enrollment.contextData as Record<string, any> | null) || {};
            const billing = context.billing || {};
            const firstName = context.first_name || context.firstName || billing.first_name || billing.firstName || '';
            const lastName = context.last_name || context.lastName || billing.last_name || billing.lastName || '';
            const name = [firstName, lastName].filter(Boolean).join(' ').trim()
                || context.name
                || billing.name
                || event.enrollment.email;

            return {
                id: event.id,
                enrollmentId: event.enrollmentId,
                name,
                email: event.enrollment.email,
                outcome: event.outcome,
                occurredAt: event.createdAt,
                triggerEntityId: event.enrollment.triggerEntityId,
                metadata: event.metadata,
                journey: journeysByEnrollment[event.enrollmentId] || []
            };
        });

        return {
            nodeId,
            status: normalizedStatus,
            counts: { completed, skipped, failed },
            pagination: {
                page: safePage,
                perPage: safePerPage,
                total,
                totalPages: Math.max(1, Math.ceil(total / safePerPage))
            },
            contacts
        };
    }
}

export const automationAnalyticsService = new AutomationAnalyticsService();
