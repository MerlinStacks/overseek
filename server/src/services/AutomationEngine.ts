
import { PrismaClient, AutomationEnrollment, MarketingAutomation } from '@prisma/client';
import { EmailService } from './EmailService';
import { InvoiceService } from './InvoiceService';

const prisma = new PrismaClient();

interface FlowNode {
    id: string;
    type: string; // 'trigger', 'action', 'delay', 'condition'
    data: any; // { config: {...} }
}

interface FlowEdge {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string | null; // 'true', 'false' for conditions
}

interface FlowDefinition {
    nodes: FlowNode[];
    edges: FlowEdge[];
}

export class AutomationEngine {
    private emailService = new EmailService();
    private invoiceService = new InvoiceService();

    // Called when an event happens (e.g. Order Created)
    async processTrigger(accountId: string, triggerType: string, data: any) {
        console.log(`[AutomationEngine] Processing Trigger: ${triggerType} for Account ${accountId}`);

        // Find active automations for this trigger
        const automations = await prisma.marketingAutomation.findMany({
            where: {
                accountId,
                triggerType,
                isActive: true
            }
        });

        for (const automation of automations) {
            // Check filters (e.g. min order value) provided in triggerConfig or Trigger Node
            const passesFilters = this.checkTriggerFilters(automation, data);

            if (passesFilters) {
                await this.enroll(automation, data);
            } else {
                console.log(`[AutomationEngine] Automation ${automation.name} skipped due to filters.`);
            }
        }
    }

    async enroll(automation: MarketingAutomation, data: any) {
        console.log(`[AutomationEngine] Enrolling ${data.email || 'customer'} in ${automation.name}`);

        let targetEmail = data.email;
        let wooCustomerId = data.wooCustomerId;

        // Extract email from data
        if (!targetEmail && data.billing && data.billing.email) targetEmail = data.billing.email;

        if (!targetEmail) {
            console.warn(`[AutomationEngine] Cannot enroll: No email found in data`);
            return;
        }

        const flow = automation.flowDefinition as unknown as FlowDefinition | null;
        if (!flow || !flow.nodes) {
            console.warn(`[AutomationEngine] No flow definition for ${automation.name}`);
            return;
        }

        // Find Trigger Node to start
        const triggerNode = flow.nodes.find(n => n.type === 'trigger' || n.type === 'TRIGGER');
        if (!triggerNode) {
            console.warn(`[AutomationEngine] No Trigger Node found in flow`);
            return;
        }

        // Create Enrollment
        const enrollment = await prisma.automationEnrollment.create({
            data: {
                automationId: automation.id,
                email: targetEmail,
                wooCustomerId: wooCustomerId,
                contextData: data,
                status: 'ACTIVE',
                currentNodeId: triggerNode.id,
                nextRunAt: new Date() // Ready to run immediately
            }
        });

        // Trigger processing immediately
        await this.processEnrollment(enrollment.id);
    }

    // Cron job or called immediately
    async processEnrollment(enrollmentId: string) {
        const enrollment = await prisma.automationEnrollment.findUnique({
            where: { id: enrollmentId },
            include: { automation: true }
        });

        if (!enrollment || enrollment.status !== 'ACTIVE') return;

        // Check scheduling
        if (enrollment.nextRunAt && enrollment.nextRunAt > new Date()) return;

        const flow = enrollment.automation.flowDefinition as unknown as FlowDefinition | null;
        if (!flow) return;

        let currentNodeId = enrollment.currentNodeId;

        // Loop to process consecutive immediate nodes
        // Safety Break: max 20 steps to prevent infinite loops
        let stepsProcessed = 0;
        const MAX_STEPS = 20;

        while (currentNodeId && stepsProcessed < MAX_STEPS) {
            const node = flow.nodes.find(n => n.id === currentNodeId);
            if (!node) {
                // End of flow or invalid node
                await this.completeEnrollment(enrollmentId);
                return;
            }

            console.log(`[AutomationEngine] Processing Node ${node.id} (${node.type})`);

            // Execute Logic based on Type
            const result = await this.executeNodeLogic(node, enrollment);

            if (result.action === 'WAIT') {
                // Stop processing, we are waiting (Delay)
                return;
            }

            if (result.action === 'NEXT') {
                // Find next node
                const nextNodeId = this.findNextNodeId(flow, node.id, result.outcome);

                if (!nextNodeId) {
                    await this.completeEnrollment(enrollmentId);
                    return;
                }

                // Prepare to move to next node
                const nextNode = flow.nodes.find(n => n.id === nextNodeId);
                let nextRunAt = new Date(); // Default: Run immediately

                if (nextNode && (nextNode.type === 'delay' || nextNode.type === 'DELAY')) {
                    // Calculate Delay
                    const durationMs = this.calculateDelayDuration(nextNode.data);
                    nextRunAt = new Date(Date.now() + durationMs);
                    console.log(`[AutomationEngine] Next is Delay. Scheduling for ${nextRunAt.toISOString()}`);
                }

                // Update DB to move pointer
                await prisma.automationEnrollment.update({
                    where: { id: enrollmentId },
                    data: {
                        currentNodeId: nextNodeId,
                        nextRunAt: nextRunAt
                    }
                });

                currentNodeId = nextNodeId;
                enrollment.currentNodeId = nextNodeId; // Local update for loop

                // If it's a future wait, break loop
                if (nextRunAt > new Date()) return;
            }

            stepsProcessed++;
        }
    }

    private async executeNodeLogic(node: FlowNode, enrollment: any): Promise<{ action: 'NEXT' | 'WAIT', outcome?: string }> {
        const type = node.type.toUpperCase();

        if (type === 'TRIGGER') {
            return { action: 'NEXT' };
        }

        // Special handling for Abandoned Cart context?
        // Usually handled in processTrigger filters.

        if (type === 'DELAY') {
            return { action: 'NEXT' };
        }

        if (type === 'ACTION') {
            // e.g. Send Email, Add Tag
            const actionType = node.data?.actionType || 'SEND_EMAIL';

            if (actionType === 'SEND_EMAIL') {
                const config = node.data; // { templateId: "...", subject: "...", body: "..." }
                console.log(`[AutomationEngine] Sending Email: ${config.templateId} to ${enrollment.email}`);

                try {
                    // Resolve Email Account (prefer config, fallback to first available)
                    let emailAccountId = config.emailAccountId;
                    if (!emailAccountId) {
                        const defaultAccount = await prisma.emailAccount.findFirst({
                            where: { accountId: enrollment.automation.accountId }
                        });
                        emailAccountId = defaultAccount?.id;
                    }

                    if (emailAccountId) {
                        // Render Templates
                        const context = {
                            customer: {
                                email: enrollment.email,
                                id: enrollment.wooCustomerId
                            },
                            ...enrollment.contextData // Flatten context data (e.g. order details)
                        };

                        const subject = this.renderTemplate(config.subject || 'Automated Email', context);
                        const body = this.renderTemplate(config.body || config.html || '', context);

                        await this.emailService.sendEmail(
                            enrollment.automation.accountId,
                            emailAccountId,
                            enrollment.email,
                            subject,
                            body || `<p>Email Template: ${config.templateId}</p>`,
                            enrollment.contextData?.attachments
                        );
                    } else {
                        console.warn(`[AutomationEngine] Cannot send email: No Email Account found for Account ${enrollment.automation.accountId}`);
                    }
                } catch (err) {
                    console.error(`[AutomationEngine] Failed to send email`, err);
                }
            }

            if (actionType === 'GENERATE_INVOICE') {
                const config = node.data; // { templateId: "..." }
                console.log(`[AutomationEngine] Generating Invoice: Template ${config.templateId} for ${enrollment.email}`);

                try {
                    // Assuming we have an Order ID in context
                    const orderId = enrollment.contextData?.id || enrollment.contextData?.orderId || enrollment.contextData?.wooId;

                    if (!orderId) {
                        console.warn(`[AutomationEngine] Cannot generate invoice: No Order ID in context`);
                    } else {
                        const pdfUrl = await this.invoiceService.generateInvoicePdf(
                            enrollment.automation.accountId,
                            String(orderId),
                            config.templateId
                        );

                        // Store in context for subsequent steps (like Email)
                        // Update Enrollment Context in DB
                        const newContext = {
                            ...enrollment.contextData,
                            invoicePdfUrl: pdfUrl,
                            attachments: [
                                ...(enrollment.contextData?.attachments || []),
                                { filename: 'Invoice.pdf', path: pdfUrl }
                            ]
                        };

                        await prisma.automationEnrollment.update({
                            where: { id: enrollment.id },
                            data: { contextData: newContext }
                        });

                        // Update local object for this run
                        enrollment.contextData = newContext;
                    }

                } catch (err) {
                    console.error(`[AutomationEngine] Failed to generate invoice`, err);
                }
            }

            return { action: 'NEXT' };
        }

        if (type === 'CONDITION') {
            // Evaluate logic
            // e.g. "Order Total > 100"
            const outcome = await this.evaluateCondition(node.data, enrollment.contextData);
            return { action: 'NEXT', outcome: outcome ? 'true' : 'false' };
        }

        return { action: 'NEXT' };
    }

    private findNextNodeId(flow: FlowDefinition, currentNodeId: string, outcome?: string): string | null {
        // Find edges starting from this node
        const edges = flow.edges.filter(e => e.source === currentNodeId);

        if (edges.length === 0) return null;

        if (edges.length === 1 && !outcome) {
            return edges[0].target;
        }

        // Handle Conditional Edges
        if (outcome) {
            const match = edges.find(e => e.sourceHandle === outcome || e.id === outcome);
            if (match) return match.target;
        }

        // Fallback: Return first
        return edges[0].target;
    }

    private calculateDelayDuration(data: any): number {
        // data: { duration: 1, unit: 'hours' }
        const val = parseInt(data.value || data.duration || '0');
        const unit = data.unit || 'minutes';

        const multi: any = {
            'minutes': 60000,
            'hours': 3600000,
            'days': 86400000
        };

        return val * (multi[unit] || 60000);
    }

    private async evaluateCondition(data: any, context: any): Promise<boolean> {
        // data: { field: 'total', operator: 'gt', value: 100 }
        if (!data || !context) return true;

        const fieldVal = context[data.field];
        const targetVal = data.value;

        switch (data.operator) {
            case 'gt': return fieldVal > targetVal;
            case 'lt': return fieldVal < targetVal;
            case 'eq': return fieldVal == targetVal;
            case 'contains': return String(fieldVal).includes(targetVal);
            default: return true;
        }
    }

    private async completeEnrollment(id: string) {
        console.log(`[AutomationEngine] Enrollment ${id} Completed.`);
        await prisma.automationEnrollment.update({
            where: { id },
            data: { status: 'COMPLETED', nextRunAt: null, currentNodeId: null }
        });
    }

    // Global ticker
    async runTicker() {
        const now = new Date();
        const due = await prisma.automationEnrollment.findMany({
            where: {
                status: 'ACTIVE',
                nextRunAt: { lte: now }
            },
            take: 50
        });

        for (const enr of due) {
            await this.processEnrollment(enr.id);
        }
    }

    /**
     * Replaces {{variable}} placeholders with values from context
     */
    private renderTemplate(template: string, context: any): string {
        if (!template) return '';

        return template.replace(/\{\{(.*?)\}\}/g, (match, path) => {
            const keys = path.trim().split('.');
            let value = context;

            for (const key of keys) {
                if (value === undefined || value === null) return '';
                value = value[key];
            }

            return value !== undefined && value !== null ? String(value) : '';
        });
    }

    /**
     * Checks if data meets the Trigger Config filters (e.g. Min Order Total)
     */
    private checkTriggerFilters(automation: MarketingAutomation, data: any): boolean {
        // Get Trigger Node configuration
        const flow = automation.flowDefinition as unknown as FlowDefinition;
        if (!flow || !flow.nodes) return true; // Loose default

        const triggerNode = flow.nodes.find(n => n.type === 'trigger' || n.type === 'TRIGGER');
        if (!triggerNode || !triggerNode.data) return true;

        const config = triggerNode.data; // { minOrderValue: 50, requiredProducts: [123] }

        // Example: Min Order Value
        if (config.minOrderValue && data.total) {
            if (parseFloat(data.total) < parseFloat(config.minOrderValue)) {
                return false;
            }
        }

        // Example: Required Products (if data is Order)
        if (config.requiredProductIds && Array.isArray(config.requiredProductIds) && config.requiredProductIds.length > 0) {
            const orderItems = data.line_items || [];
            const hasProduct = orderItems.some((item: any) =>
                config.requiredProductIds.includes(String(item.product_id))
            );
            if (!hasProduct) return false;
        }

        return true;
    }
}
