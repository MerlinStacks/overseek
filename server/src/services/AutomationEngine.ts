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

export class AutomationEngine {
    private nodeExecutor = new NodeExecutor();

    /**
     * Called when an event happens (e.g. Order Created)
     */
    async processTrigger(accountId: string, triggerType: string, data: any) {
        Logger.info(`Processing Trigger: ${triggerType}`, { accountId, triggerType });

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

        const triggerNode = flow.nodes.find(n =>
            n.type === 'trigger' || n.type === 'TRIGGER'
        );
        if (!triggerNode) {
            Logger.warn('No Trigger Node found in flow', { automation: automation.name });
            return;
        }

        const enrollment = await prisma.automationEnrollment.create({
            data: {
                automationId: automation.id,
                email: targetEmail,
                wooCustomerId,
                contextData: data,
                status: 'ACTIVE',
                currentNodeId: triggerNode.id,
                nextRunAt: new Date()
            }
        });

        await this.processEnrollment(enrollment.id);
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
                await this.completeEnrollment(enrollmentId);
                return;
            }

            Logger.debug(`Processing Node ${node.id} (${node.type})`);

            const result = await this.nodeExecutor.execute(node, enrollment);

            if (result.action === 'WAIT') return;

            if (result.action === 'NEXT') {
                const nextNodeId = findNextNodeId(flow, node.id, result.outcome);

                if (!nextNodeId) {
                    await this.completeEnrollment(enrollmentId);
                    return;
                }

                const nextNode = flow.nodes.find(n => n.id === nextNodeId);
                let nextRunAt = new Date();

                if (nextNode && (nextNode.type === 'delay' || nextNode.type === 'DELAY')) {
                    const durationMs = calculateDelayDuration(nextNode.data);
                    nextRunAt = new Date(Date.now() + durationMs);
                    Logger.debug(`Next is Delay. Scheduling for ${nextRunAt.toISOString()}`);
                }

                await prisma.automationEnrollment.update({
                    where: { id: enrollmentId },
                    data: { currentNodeId: nextNodeId, nextRunAt }
                });

                currentNodeId = nextNodeId;
                enrollment.currentNodeId = nextNodeId;

                if (nextRunAt > new Date()) return;
            }

            stepsProcessed++;
        }

        if (stepsProcessed >= MAX_STEPS) {
            Logger.warn(`[AutomationEngine] Enrollment ${enrollmentId} hit MAX_STEPS limit`, { stepsProcessed });
        }
    }

    /**
     * Mark enrollment as completed.
     */
    private async completeEnrollment(id: string) {
        Logger.info(`Enrollment ${id} Completed.`);
        await prisma.automationEnrollment.update({
            where: { id },
            data: { status: 'COMPLETED', nextRunAt: null, currentNodeId: null }
        });
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
            take: 50
        });

        for (const enr of due) {
            await this.processEnrollment(enr.id);
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
        if (!triggerNode?.data) return true;

        const config = triggerNode.data;

        if (config.minOrderValue && data.total) {
            if (parseFloat(data.total) < parseFloat(config.minOrderValue)) {
                return false;
            }
        }

        if (config.requiredProductIds?.length > 0) {
            const orderItems = data.line_items || [];
            const hasProduct = orderItems.some((item: any) =>
                config.requiredProductIds.includes(String(item.product_id))
            );
            if (!hasProduct) return false;
        }

        return true;
    }
}
