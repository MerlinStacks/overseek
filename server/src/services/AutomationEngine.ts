/**
 * Automation Engine
 * 
 * Core orchestrator for marketing automation workflows.
 * Delegates node execution and flow navigation to specialized modules.
 */

import { MarketingAutomation } from '@prisma/client';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { FlowDefinition } from './automation/types';
import { NodeExecutor } from './automation/NodeExecutor';
import { findNextNodeId, calculateDelayDuration } from './automation/FlowNavigator';
import { automationEnrollmentService } from './AutomationEnrollmentService';
import { automationQueueService } from './AutomationQueueService';

export class AutomationEngine {
    private nodeExecutor = new NodeExecutor();
    private accountTimezoneCache = new Map<string, string>();

    private static getNodeConfig(node: any): any {
        return node?.data?.config || node?.data || {};
    }

    /**
     * Called when an event happens (e.g. Order Created)
     */
    async processTrigger(accountId: string, triggerType: string, data: any) {
        Logger.info(`Processing Trigger: ${triggerType}`, { accountId, triggerType });

        if (triggerType.startsWith('ORDER')) {
            const purchaserEmail = data?.billing?.email || data?.email || data?.billingEmail;
            if (purchaserEmail) {
                await automationEnrollmentService.cancelActiveAbandonedCartEnrollments(accountId, purchaserEmail, {
                    triggerType,
                    orderId: data?.id || data?.wooId || null
                });
            }
        }

        const automations = await prisma.marketingAutomation.findMany({
            where: { accountId, triggerType, isActive: true }
        });

        for (const automation of automations) {
            const passesFilters = this.checkTriggerFilters(automation, data);

            if (passesFilters) {
                await this.enroll(automation, data);
            } else {
                Logger.debug(`Automation ${automation.name} skipped due to filters.`);
            }
        }
    }

    /**
     * Enroll a customer in an automation workflow.
     */
    async enroll(automation: MarketingAutomation, data: any) {
        Logger.info(`Enrolling ${data.email || 'customer'} in ${automation.name}`);

        let targetEmail = data.email;
        let wooCustomerId = data.wooCustomerId;

        if (!targetEmail && data.billing?.email) targetEmail = data.billing.email;

        if (!targetEmail) {
            Logger.warn('Cannot enroll: No email found in data', { automation: automation.name });
            return;
        }

        const flow = automation.flowDefinition as unknown as FlowDefinition | null;
        if (!flow?.nodes) {
            Logger.warn('No flow definition for automation', { automation: automation.name });
            return;
        }

        const triggerNodeId = automationEnrollmentService.getTriggerNodeId(flow);
        if (!triggerNodeId) {
            Logger.warn('No Trigger Node found in flow', { automation: automation.name });
            return;
        }

        const triggerEntityId = this.getTriggerEntityId(data);
        const triggerEntityType = this.getTriggerEntityType(automation.triggerType, data);
        const dedupeKey = this.buildDedupeKey(automation.triggerType, targetEmail, triggerEntityId, data);

        const enrollmentResult = await automationEnrollmentService.createEnrollment({
            automation,
            email: targetEmail,
            wooCustomerId,
            contextData: data,
            currentNodeId: triggerNodeId,
            nextRunAt: new Date(),
            triggerEntityType,
            triggerEntityId,
            dedupeKey,
            dedupeLookbackHours: this.getDedupeLookbackHours(automation, data),
            frequencyCapHours: this.getFrequencyCapHours(automation)
        });

        if (!enrollmentResult.created) {
            Logger.debug('[AutomationEngine] Enrollment skipped before queueing', {
                automationId: automation.id,
                automationName: automation.name,
                email: targetEmail,
                reason: enrollmentResult.skipReason
            });
            return;
        }

        await automationQueueService.enqueueEnrollment({
            enrollmentId: enrollmentResult.enrollment.id,
            runAt: enrollmentResult.enrollment.nextRunAt
        });
    }

    /**
     * Process a single enrollment - advances through flow nodes.
     */
    async processEnrollment(enrollmentId: string) {
        const enrollment = await prisma.automationEnrollment.findUnique({
            where: { id: enrollmentId },
            include: { automation: true }
        });

        if (!enrollment || enrollment.status !== 'ACTIVE') return;
        if (enrollment.nextRunAt && enrollment.nextRunAt > new Date()) return;

        const flow = enrollment.automation.flowDefinition as unknown as FlowDefinition | null;
        if (!flow) return;

        let currentNodeId = enrollment.currentNodeId;
        let stepsProcessed = 0;
        const MAX_STEPS = parseInt(process.env.AUTOMATION_MAX_STEPS || '20', 10);

        while (currentNodeId && stepsProcessed < MAX_STEPS) {
            const node = flow.nodes.find(n => n.id === currentNodeId);
            if (!node) {
                await automationEnrollmentService.completeEnrollment(enrollmentId, {
                    accountId: enrollment.automation.accountId,
                    automationId: enrollment.automationId,
                    nodeId: currentNodeId
                });
                return;
            }

            Logger.debug(`Processing Node ${node.id} (${node.type})`);

            const accountWideCooldownDelay = await this.getAccountWideEmailCooldownDelay(
                enrollment.automation.accountId,
                enrollment.automation.triggerConfig,
                enrollment.email,
                node
            );
            if (accountWideCooldownDelay) {
                const updatedEnrollment = await automationEnrollmentService.updateProgress(enrollmentId, {
                    currentNodeId: node.id,
                    nextRunAt: accountWideCooldownDelay
                });
                await automationEnrollmentService.markWaiting(enrollmentId, {
                    accountId: enrollment.automation.accountId,
                    automationId: enrollment.automationId,
                    nodeId: node.id,
                    nextRunAt: accountWideCooldownDelay,
                    metadata: {
                        waitingForNodeId: node.id,
                        reason: 'ACCOUNT_EMAIL_COOLDOWN'
                    }
                });
                await automationQueueService.enqueueEnrollment({
                    enrollmentId,
                    runAt: updatedEnrollment.nextRunAt
                });
                return;
            }

            const quietHoursDelay = await this.getQuietHoursDelay(enrollment.automation.accountId, enrollment.automation.triggerConfig, node);
            if (quietHoursDelay) {
                const updatedEnrollment = await automationEnrollmentService.updateProgress(enrollmentId, {
                    currentNodeId: node.id,
                    nextRunAt: quietHoursDelay
                });
                await automationEnrollmentService.markWaiting(enrollmentId, {
                    accountId: enrollment.automation.accountId,
                    automationId: enrollment.automationId,
                    nodeId: node.id,
                    nextRunAt: quietHoursDelay,
                    metadata: {
                        waitingForNodeId: node.id,
                        reason: 'QUIET_HOURS'
                    }
                });
                await automationQueueService.enqueueEnrollment({
                    enrollmentId,
                    runAt: updatedEnrollment.nextRunAt
                });
                return;
            }

            const result = await this.nodeExecutor.execute(node, enrollment);
            await automationEnrollmentService.recordRunEvent({
                accountId: enrollment.automation.accountId,
                automationId: enrollment.automationId,
                enrollmentId,
                nodeId: node.id,
                eventType: 'NODE_EXECUTED',
                outcome: result.outcome || result.action,
                metadata: {
                    nodeType: node.type,
                    ...(result.metadata || {})
                }
            });

            if (result.action === 'WAIT') {
                await automationEnrollmentService.markWaiting(enrollmentId, {
                    accountId: enrollment.automation.accountId,
                    automationId: enrollment.automationId,
                    nodeId: node.id
                });
                return;
            }

            if (result.action === 'NEXT') {
                const nextNodeId = findNextNodeId(flow, node.id, result.outcome);

                if (!nextNodeId) {
                    await automationEnrollmentService.completeEnrollment(enrollmentId, {
                        accountId: enrollment.automation.accountId,
                        automationId: enrollment.automationId,
                        nodeId: node.id
                    });
                    return;
                }

                const nextNode = flow.nodes.find(n => n.id === nextNodeId);
                let nextRunAt = new Date();

                if (nextNode && (nextNode.type === 'delay' || nextNode.type === 'DELAY')) {
                    const durationMs = calculateDelayDuration(AutomationEngine.getNodeConfig(nextNode));
                    nextRunAt = new Date(Date.now() + durationMs);
                    Logger.debug(`Next is Delay. Scheduling for ${nextRunAt.toISOString()}`);
                }

                const updatedEnrollment = await automationEnrollmentService.updateProgress(enrollmentId, {
                    currentNodeId: nextNodeId,
                    lastProcessedNodeId: node.id,
                    nextRunAt
                });

                currentNodeId = nextNodeId;
                enrollment.currentNodeId = nextNodeId;

                if (nextRunAt > new Date()) {
                    await automationEnrollmentService.markWaiting(enrollmentId, {
                        accountId: enrollment.automation.accountId,
                        automationId: enrollment.automationId,
                        nodeId: nextNodeId,
                        nextRunAt,
                        metadata: { waitingForNodeId: nextNodeId }
                    });
                    await automationQueueService.enqueueEnrollment({
                        enrollmentId,
                        runAt: updatedEnrollment.nextRunAt
                    });
                    return;
                }
            }

            stepsProcessed++;
        }

        if (stepsProcessed >= MAX_STEPS) {
            Logger.warn(`[AutomationEngine] Enrollment ${enrollmentId} hit MAX_STEPS limit`, { stepsProcessed });
        }
    }

    /**
     * Global ticker - processes due enrollments.
     * Logs warning if backlog exceeds threshold.
     */
    async runTicker() {
        const now = new Date();

        // Check for backlog (overflow detection)
        const backlogCount = await prisma.automationEnrollment.count({
            where: { status: 'ACTIVE', nextRunAt: { lte: now } }
        });

        if (backlogCount > 100) {
            Logger.warn('[AutomationEngine] Enrollment backlog detected - processing may be falling behind', {
                backlogCount,
                threshold: 100
            });
        }

        const due = await prisma.automationEnrollment.findMany({
            where: { status: 'ACTIVE', nextRunAt: { lte: now } },
            select: { id: true, nextRunAt: true },
            take: 100
        });

        for (const enr of due) {
            await automationQueueService.enqueueEnrollment({
                enrollmentId: enr.id,
                runAt: enr.nextRunAt
            });
        }
    }

    /**
     * Check if data meets trigger filters.
     */
    private checkTriggerFilters(automation: MarketingAutomation, data: any): boolean {
        const flow = automation.flowDefinition as unknown as FlowDefinition;
        if (!flow?.nodes) return true;

        const triggerNode = flow.nodes.find(n =>
            n.type === 'trigger' || n.type === 'TRIGGER'
        );
        const config = AutomationEngine.getNodeConfig(triggerNode);
        if (!config) return true;

        const orderTotalRaw = data.total ?? data?.cart?.total ?? data?.order?.total;
        const orderTotal = Number(orderTotalRaw);

        const minOrderValue = config.minOrderValue
            ?? (config.filterByValue ? config.filterValue : undefined);
        const filterOperator = config.filterOperator || 'gte';

        if (minOrderValue !== undefined && Number.isFinite(orderTotal)) {
            const threshold = Number(minOrderValue);
            if (Number.isFinite(threshold)) {
                const passesThreshold =
                    (filterOperator === 'gt' && orderTotal > threshold)
                    || (filterOperator === 'gte' && orderTotal >= threshold)
                    || (filterOperator === 'lt' && orderTotal < threshold)
                    || (filterOperator === 'lte' && orderTotal <= threshold)
                    || (filterOperator === 'eq' && orderTotal === threshold);

                if (!passesThreshold) {
                    return false;
                }
            }
        }

        if (config.requiredProductIds?.length > 0) {
            const orderItems = data.line_items || data?.cart?.items || data?.order?.line_items || [];
            const hasProduct = orderItems.some((item: any) => {
                const productId = String(item.product_id ?? item.id ?? '');
                return config.requiredProductIds.includes(productId);
            });
            if (!hasProduct) return false;
        }

        if (config.tagName && data?.tagName && String(config.tagName) !== String(data.tagName)) {
            return false;
        }

        if (config.targetOrderStatus) {
            const currentStatus = String(data?.newStatus ?? data?.status ?? '').toLowerCase();
            if (currentStatus !== String(config.targetOrderStatus).toLowerCase()) {
                return false;
            }
        }

        if (config.emailDomain && data?.email) {
            const recipientDomain = String(data.email).split('@')[1]?.toLowerCase();
            if (recipientDomain !== String(config.emailDomain).toLowerCase()) {
                return false;
            }
        }

        return true;
    }

    private getTriggerEntityId(data: any): string | undefined {
        const candidate = data?.id
            ?? data?.wooId
            ?? data?.reviewId
            ?? data?.sessionId
            ?? data?.visitorId
            ?? data?.orderId;
        return candidate !== undefined && candidate !== null ? String(candidate) : undefined;
    }

    private getTriggerEntityType(triggerType: string, data: any): string | undefined {
        if (triggerType.includes('ORDER')) return 'ORDER';
        if (triggerType === 'ABANDONED_CART') return 'CART';
        if (triggerType.includes('REVIEW')) return 'REVIEW';
        if (data?.wooCustomerId || data?.customerId) return 'CUSTOMER';
        return undefined;
    }

    private buildDedupeKey(triggerType: string, email: string, entityId?: string, data?: any): string {
        if (triggerType === 'ABANDONED_CART') {
            return `${triggerType}:${entityId || data?.visitorId || email.toLowerCase()}`;
        }
        if (triggerType === 'NO_PURCHASE_IN_X_DAYS') {
            return `${triggerType}:${entityId || email.toLowerCase()}`;
        }
        if (entityId) {
            return `${triggerType}:${entityId}:${email.toLowerCase()}`;
        }
        return `${triggerType}:${email.toLowerCase()}`;
    }

    private getDedupeLookbackHours(automation: MarketingAutomation, data?: any): number | undefined {
        if (automation.triggerType === 'NO_PURCHASE_IN_X_DAYS') {
            const config = (automation.triggerConfig as Record<string, unknown> | null) || {};
            const daysWithoutPurchase = Number(config.daysWithoutPurchase || data?.daysSinceLastPurchase || 90);
            return Math.max(24, daysWithoutPurchase * 24);
        }
        return undefined;
    }

    private getFrequencyCapHours(automation: MarketingAutomation): number | undefined {
        const config = (automation.triggerConfig as Record<string, unknown> | null) || {};
        const hours = Number(config.frequencyCapHours || 0);
        return Number.isFinite(hours) && hours > 0 ? hours : undefined;
    }

    private async getQuietHoursDelay(
        accountId: string,
        triggerConfig: MarketingAutomation['triggerConfig'],
        node: FlowDefinition['nodes'][number] | undefined
    ): Promise<Date | null> {
        const nodeType = String(node?.type || '').toUpperCase();
        const nodeConfig = AutomationEngine.getNodeConfig(node);
        if (nodeType !== 'ACTION' || nodeConfig?.actionType !== 'SEND_EMAIL') {
            return null;
        }

        const config = (triggerConfig as Record<string, unknown> | null) || {};
        if (!config.quietHoursEnabled) {
            return null;
        }

        const startHour = Number(config.quietHoursStart);
        const endHour = Number(config.quietHoursEnd);
        if (!Number.isFinite(startHour) || !Number.isFinite(endHour) || startHour === endHour) {
            return null;
        }

        const timezone = await this.getAccountTimezone(accountId);
        const now = new Date();
        if (!this.isInQuietHours(now, timezone, startHour, endHour)) {
            return null;
        }

        return this.findNextAllowedTime(now, timezone, startHour, endHour);
    }

    private async getAccountWideEmailCooldownDelay(
        accountId: string,
        triggerConfig: MarketingAutomation['triggerConfig'],
        recipientEmail: string | null | undefined,
        node: FlowDefinition['nodes'][number] | undefined
    ): Promise<Date | null> {
        const nodeType = String(node?.type || '').toUpperCase();
        const nodeConfig = AutomationEngine.getNodeConfig(node);
        if (nodeType !== 'ACTION' || nodeConfig?.actionType !== 'SEND_EMAIL' || !recipientEmail) {
            return null;
        }

        const config = (triggerConfig as Record<string, unknown> | null) || {};
        const cooldownHours = Number(config.accountWideEmailCapHours || 0);
        if (!Number.isFinite(cooldownHours) || cooldownHours <= 0) {
            return null;
        }

        const cooldownWindowStart = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);
        const recentAutomationEmail = await prisma.emailLog.findFirst({
            where: {
                accountId,
                to: { equals: recipientEmail, mode: 'insensitive' },
                source: 'AUTOMATION',
                status: 'SUCCESS',
                createdAt: { gte: cooldownWindowStart }
            },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true }
        });

        if (!recentAutomationEmail) {
            return null;
        }

        return new Date(recentAutomationEmail.createdAt.getTime() + cooldownHours * 60 * 60 * 1000);
    }

    private async getAccountTimezone(accountId: string): Promise<string> {
        const cached = this.accountTimezoneCache.get(accountId);
        if (cached) {
            return cached;
        }

        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { timezone: true }
        });
        const timezone = account?.timezone || 'UTC';
        this.accountTimezoneCache.set(accountId, timezone);
        return timezone;
    }

    private isInQuietHours(date: Date, timezone: string, startHour: number, endHour: number): boolean {
        const localHour = this.getLocalHour(date, timezone);

        if (startHour < endHour) {
            return localHour >= startHour && localHour < endHour;
        }

        return localHour >= startHour || localHour < endHour;
    }

    private findNextAllowedTime(date: Date, timezone: string, startHour: number, endHour: number): Date {
        let candidate = new Date(date.getTime());
        candidate.setSeconds(0, 0);

        for (let minute = 0; minute < 24 * 60 + 5; minute++) {
            if (!this.isInQuietHours(candidate, timezone, startHour, endHour)) {
                return candidate;
            }
            candidate = new Date(candidate.getTime() + 60 * 1000);
        }

        return candidate;
    }

    private getLocalHour(date: Date, timezone: string): number {
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            hour: 'numeric',
            hour12: false
        });
        const formattedHour = formatter.format(date);
        const parsedHour = Number(formattedHour);
        return Number.isFinite(parsedHour) ? parsedHour : 0;
    }
}

export const automationEngine = new AutomationEngine();
