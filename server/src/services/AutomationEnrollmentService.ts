import { MarketingAutomation, Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';
import { FlowDefinition } from './automation/types';

interface CreateEnrollmentInput {
    automation: MarketingAutomation;
    email: string;
    wooCustomerId?: number | null;
    contextData?: Prisma.InputJsonValue;
    currentNodeId?: string | null;
    nextRunAt?: Date;
    triggerEntityType?: string;
    triggerEntityId?: string;
    dedupeKey?: string;
    dedupeLookbackHours?: number;
    frequencyCapHours?: number;
}

interface CreateEnrollmentResult {
    enrollment: any;
    created: boolean;
    skipReason?: 'FREQUENCY_CAPPED' | 'DUPLICATE_ENROLLMENT';
}

export class AutomationEnrollmentService {
    async createEnrollment(input: CreateEnrollmentInput): Promise<CreateEnrollmentResult> {
        const frequencyCapWhere = input.frequencyCapHours && input.frequencyCapHours > 0
            ? await prisma.automationEnrollment.findFirst({
                where: {
                    accountId: input.automation.accountId,
                    automationId: input.automation.id,
                    email: { equals: input.email, mode: 'insensitive' },
                    createdAt: {
                        gte: new Date(Date.now() - input.frequencyCapHours * 60 * 60 * 1000)
                    }
                },
                orderBy: { createdAt: 'desc' }
            })
            : null;

        if (frequencyCapWhere) {
            await this.recordRunEvent({
                accountId: input.automation.accountId,
                automationId: input.automation.id,
                enrollmentId: frequencyCapWhere.id,
                eventType: 'SKIPPED',
                outcome: 'FREQUENCY_CAPPED',
                metadata: {
                    email: input.email,
                    frequencyCapHours: input.frequencyCapHours
                }
            });
            return {
                enrollment: frequencyCapWhere,
                created: false,
                skipReason: 'FREQUENCY_CAPPED'
            };
        }

        const existingWhere = input.dedupeKey
            ? await prisma.automationEnrollment.findFirst({
                where: {
                    accountId: input.automation.accountId,
                    automationId: input.automation.id,
                    dedupeKey: input.dedupeKey,
                    ...(input.dedupeLookbackHours && input.dedupeLookbackHours > 0
                        ? {
                            createdAt: {
                                gte: new Date(Date.now() - input.dedupeLookbackHours * 60 * 60 * 1000)
                            }
                        }
                        : { status: 'ACTIVE' })
                }
            })
            : null;

        if (existingWhere) {
            await this.recordRunEvent({
                accountId: input.automation.accountId,
                automationId: input.automation.id,
                enrollmentId: existingWhere.id,
                eventType: 'SKIPPED',
                outcome: 'DUPLICATE_ENROLLMENT',
                metadata: {
                    dedupeKey: input.dedupeKey,
                    dedupeLookbackHours: input.dedupeLookbackHours ?? null
                }
            });
            return {
                enrollment: existingWhere,
                created: false,
                skipReason: 'DUPLICATE_ENROLLMENT'
            };
        }

        const enrollment = await prisma.automationEnrollment.create({
            data: {
                automationId: input.automation.id,
                accountId: input.automation.accountId,
                email: input.email,
                wooCustomerId: input.wooCustomerId ?? null,
                contextData: input.contextData,
                status: 'ACTIVE',
                currentNodeId: input.currentNodeId ?? null,
                nextRunAt: input.nextRunAt ?? new Date(),
                triggerEntityType: input.triggerEntityType ?? null,
                triggerEntityId: input.triggerEntityId ?? null,
                dedupeKey: input.dedupeKey ?? null
            }
        });

        await this.recordRunEvent({
            accountId: input.automation.accountId,
            automationId: input.automation.id,
            enrollmentId: enrollment.id,
            nodeId: input.currentNodeId ?? null,
            eventType: 'ENROLLED',
            metadata: {
                triggerEntityType: input.triggerEntityType,
                triggerEntityId: input.triggerEntityId
            }
        });

        return {
            enrollment,
            created: true
        };
    }

    async updateProgress(enrollmentId: string, data: {
        currentNodeId?: string | null;
        lastProcessedNodeId?: string | null;
        nextRunAt?: Date | null;
        status?: string;
        statusReason?: string | null;
    }) {
        return prisma.automationEnrollment.update({
            where: { id: enrollmentId },
            data
        });
    }

    async markWaiting(enrollmentId: string, details: {
        accountId: string;
        automationId: string;
        nodeId?: string | null;
        nextRunAt?: Date | null;
        metadata?: Prisma.InputJsonValue;
    }) {
        if (details.nextRunAt) {
            await prisma.automationEnrollment.update({
                where: { id: enrollmentId },
                data: { nextRunAt: details.nextRunAt }
            });
        }

        await this.recordRunEvent({
            accountId: details.accountId,
            automationId: details.automationId,
            enrollmentId,
            nodeId: details.nodeId ?? null,
            eventType: 'WAITING',
            metadata: details.metadata
        });
    }

    async completeEnrollment(enrollmentId: string, details: {
        accountId: string;
        automationId: string;
        nodeId?: string | null;
    }) {
        await prisma.automationEnrollment.update({
            where: { id: enrollmentId },
            data: {
                status: 'COMPLETED',
                statusReason: 'FLOW_COMPLETED',
                nextRunAt: null,
                currentNodeId: null,
                completedAt: new Date()
            }
        });

        await this.recordRunEvent({
            accountId: details.accountId,
            automationId: details.automationId,
            enrollmentId,
            nodeId: details.nodeId ?? null,
            eventType: 'COMPLETED'
        });
    }

    async cancelActiveAbandonedCartEnrollments(accountId: string, email: string, orderContext?: Record<string, unknown>) {
        const activeEnrollments = await prisma.automationEnrollment.findMany({
            where: {
                accountId,
                email: { equals: email, mode: 'insensitive' },
                status: 'ACTIVE',
                automation: {
                    triggerType: 'ABANDONED_CART'
                }
            },
            include: {
                automation: {
                    select: { id: true }
                }
            }
        });

        for (const enrollment of activeEnrollments) {
            await prisma.automationEnrollment.update({
                where: { id: enrollment.id },
                data: {
                    status: 'CANCELLED',
                    statusReason: 'PURCHASED_AFTER_ABANDONMENT',
                    nextRunAt: null,
                    cancelledAt: new Date()
                }
            });

            await this.recordRunEvent({
                accountId,
                automationId: enrollment.automationId,
                enrollmentId: enrollment.id,
                nodeId: enrollment.currentNodeId,
                eventType: 'CANCELLED',
                outcome: 'PURCHASED_AFTER_ABANDONMENT',
                metadata: (orderContext ?? {}) as Prisma.InputJsonValue
            });
        }

        if (activeEnrollments.length > 0) {
            Logger.info('[AutomationEnrollmentService] Cancelled abandoned-cart enrollments after purchase', {
                accountId,
                email,
                count: activeEnrollments.length
            });
        }
    }

    async recordGoal(details: {
        accountId: string;
        automationId: string;
        enrollmentId: string;
        goalType: string;
        orderId?: string | null;
        revenue?: number | null;
        attributionWindowHours?: number;
        metadata?: Prisma.InputJsonValue;
    }) {
        await prisma.automationGoalEvent.create({
            data: {
                accountId: details.accountId,
                automationId: details.automationId,
                enrollmentId: details.enrollmentId,
                goalType: details.goalType,
                orderId: details.orderId ?? null,
                revenue: details.revenue ?? null,
                attributionWindowHours: details.attributionWindowHours ?? 168,
                metadata: details.metadata
            }
        });

        await prisma.automationEnrollment.update({
            where: { id: details.enrollmentId },
            data: {
                conversionAt: new Date(),
                convertedOrderId: details.orderId ?? null,
                convertedRevenue: details.revenue ?? null
            }
        });
    }

    async recordRunEvent(details: {
        accountId: string;
        automationId: string;
        enrollmentId: string;
        nodeId?: string | null;
        eventType: string;
        outcome?: string | null;
        metadata?: Prisma.InputJsonValue;
    }) {
        await prisma.automationRunEvent.create({
            data: {
                accountId: details.accountId,
                automationId: details.automationId,
                enrollmentId: details.enrollmentId,
                nodeId: details.nodeId ?? null,
                eventType: details.eventType,
                outcome: details.outcome ?? null,
                metadata: details.metadata
            }
        });
    }

    getTriggerNodeId(flow: FlowDefinition | null): string | null {
        if (!flow?.nodes) return null;
        const triggerNode = flow.nodes.find(n => n.type === 'trigger' || n.type === 'TRIGGER');
        return triggerNode?.id ?? null;
    }
}

export const automationEnrollmentService = new AutomationEnrollmentService();
