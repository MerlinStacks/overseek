/**
 * Node Executor
 * 
 * Executes individual automation flow nodes (actions, conditions, etc.)
 */

import { Logger } from '../../utils/logger';
import { prisma } from '../../utils/prisma';
import { EmailService } from '../EmailService';
import { InvoiceService } from '../InvoiceService';
import { smsService } from '../SmsService';
import { campaignTrackingService } from '../CampaignTrackingService';
import { FlowNode, NodeExecutionResult } from './types';
import { renderTemplate, evaluateCondition } from './FlowNavigator';

export class NodeExecutor {
    private emailService = new EmailService();
    private invoiceService = new InvoiceService();

    /**
     * Execute the logic for a single flow node.
     */
    async execute(node: FlowNode, enrollment: any): Promise<NodeExecutionResult> {
        const type = node.type.toUpperCase();

        if (type === 'TRIGGER') {
            return { action: 'NEXT' };
        }

        if (type === 'DELAY') {
            return { action: 'NEXT' };
        }

        if (type === 'ACTION') {
            await this.executeAction(node, enrollment);
            return { action: 'NEXT' };
        }

        if (type === 'CONDITION') {
            const outcome = evaluateCondition(node.data, enrollment.contextData);
            return { action: 'NEXT', outcome: outcome ? 'true' : 'false' };
        }

        return { action: 'NEXT' };
    }

    /**
     * Execute action nodes (email, invoice, inbox actions, etc.)
     */
    private async executeAction(node: FlowNode, enrollment: any): Promise<void> {
        const actionType = node.data?.actionType || 'SEND_EMAIL';

        if (actionType === 'SEND_EMAIL') {
            await this.executeSendEmail(node.data, enrollment);
        }

        if (actionType === 'GENERATE_INVOICE') {
            await this.executeGenerateInvoice(node.data, enrollment);
        }

        // Inbox Actions
        if (actionType === 'ASSIGN_CONVERSATION') {
            await this.executeAssignConversation(node.data, enrollment);
        }

        if (actionType === 'ADD_TAG') {
            await this.executeAddTag(node.data, enrollment);
        }

        if (actionType === 'CLOSE_CONVERSATION') {
            await this.executeCloseConversation(enrollment);
        }

        if (actionType === 'ADD_NOTE') {
            await this.executeAddNote(node.data, enrollment);
        }

        if (actionType === 'SEND_CANNED_RESPONSE') {
            await this.executeSendCannedResponse(node.data, enrollment);
        }

        if (actionType === 'SEND_SMS') {
            await this.executeSendSms(node.data, enrollment);
        }
    }

        private async executeAssignConversation(config: any, enrollment: any): Promise<void> {
        const conversationId = enrollment.contextData?.conversationId;
        if (!conversationId || !config.userId) return;

        Logger.info(`Assigning conversation ${conversationId} to ${config.userId}`);
        await prisma.conversation.update({
            where: { id: conversationId },
            data: { assignedTo: config.userId }
        });
    }

    private async executeAddTag(config: any, enrollment: any): Promise<void> {
        const conversationId = enrollment.contextData?.conversationId;
        if (!conversationId || !config.labelId) return;

        Logger.info(`Adding tag ${config.labelId} to ${conversationId}`);
        await prisma.conversationLabelAssignment.upsert({
            where: { conversationId_labelId: { conversationId, labelId: config.labelId } },
            create: { conversationId, labelId: config.labelId },
            update: {}
        });
    }

    private async executeCloseConversation(enrollment: any): Promise<void> {
        const conversationId = enrollment.contextData?.conversationId;
        if (!conversationId) return;

        Logger.info(`Closing conversation ${conversationId}`);
        await prisma.conversation.update({
            where: { id: conversationId },
            data: { status: 'CLOSED' }
        });
    }

    private async executeAddNote(config: any, enrollment: any): Promise<void> {
        const conversationId = enrollment.contextData?.conversationId;
        if (!conversationId || !config.content) return;

        Logger.info(`Adding note to ${conversationId}`);
        await prisma.conversationNote.create({
            data: {
                conversationId,
                content: renderTemplate(config.content, enrollment.contextData),
                createdById: config.createdById || enrollment.contextData?.assignedTo || 'system'
            }
        });
    }

    private async executeSendCannedResponse(config: any, enrollment: any): Promise<void> {
        const conversationId = enrollment.contextData?.conversationId;
        if (!conversationId || !config.cannedResponseId) return;

        const canned = await prisma.cannedResponse.findUnique({
            where: { id: config.cannedResponseId }
        });
        if (!canned) return;

        Logger.info(`Sending canned response to ${conversationId}`);
        const content = renderTemplate(canned.content, enrollment.contextData);
        await prisma.message.create({
            data: {
                conversationId,
                content,
                senderType: 'AGENT',
                contentType: 'TEXT'
            }
        });
    }

    /**
     * Send Email Action
     */
    private async executeSendEmail(config: any, enrollment: any): Promise<void> {
        Logger.info(`Sending Email: ${config.templateId} to ${enrollment.email}`);

        try {
            let emailAccountId = config.emailAccountId;
            if (!emailAccountId) {
                const { getDefaultEmailAccount } = await import('../../utils/getDefaultEmailAccount');
                const defaultAccount = await getDefaultEmailAccount(enrollment.automation.accountId);
                emailAccountId = defaultAccount?.id;
            }

            if (emailAccountId) {
                const context = {
                    customer: {
                        email: enrollment.email,
                        id: enrollment.wooCustomerId
                    },
                    ...enrollment.contextData
                };

                const subject = renderTemplate(config.subject || 'Automated Email', context);
                const body = renderTemplate(config.body || config.html || '', context);

                await this.emailService.sendEmail(
                    enrollment.automation.accountId,
                    emailAccountId,
                    enrollment.email,
                    subject,
                    body || `<p>Email Template: ${config.templateId}</p>`,
                    enrollment.contextData?.attachments
                );

                // Track send event for ROI
                await campaignTrackingService.trackSend(
                    enrollment.automation.accountId,
                    enrollment.automationId,
                    'automation',
                    enrollment.email
                );
            } else {
                Logger.warn('Cannot send email: No Email Account found', {
                    accountId: enrollment.automation.accountId
                });
            }
        } catch (err) {
            Logger.error('Failed to send email', { error: err });
        }
    }

    /**
     * Generate Invoice Action
     */
    private async executeGenerateInvoice(config: any, enrollment: any): Promise<void> {
        Logger.info(`Generating Invoice: Template ${config.templateId} for ${enrollment.email}`);

        try {
            const orderId = enrollment.contextData?.id
                || enrollment.contextData?.orderId
                || enrollment.contextData?.wooId;

            if (!orderId) {
                Logger.warn('Cannot generate invoice: No Order ID in context');
                return;
            }

            const { relativeUrl, absolutePath } = await this.invoiceService.generateInvoicePdf(
                enrollment.automation.accountId,
                String(orderId),
                config.templateId
            );

            // Update context with invoice attachment
            const newContext = {
                ...enrollment.contextData,
                invoicePdfUrl: relativeUrl,
                attachments: [
                    ...(enrollment.contextData?.attachments || []),
                    { filename: 'Invoice.pdf', path: absolutePath }
                ]
            };

            await prisma.automationEnrollment.update({
                where: { id: enrollment.id },
                data: { contextData: newContext }
            });

            // Update local object for this run
            enrollment.contextData = newContext;

        } catch (err) {
            Logger.error('Failed to generate invoice', { error: err });
        }
    }

    /**
     * Send SMS Action
     */
    private async executeSendSms(config: any, enrollment: any): Promise<void> {
        const phone = config.phone
            || enrollment.contextData?.phone
            || enrollment.contextData?.billing?.phone
            || enrollment.contextData?.customer?.phone;

        if (!phone) {
            Logger.warn('Cannot send SMS: No phone number in context', {
                accountId: enrollment.automation?.accountId
            });
            return;
        }

        const body = renderTemplate(config.body || config.message || '', enrollment.contextData);

        if (!body) {
            Logger.warn('Cannot send SMS: Empty message body');
            return;
        }

        Logger.info(`Sending SMS to ${phone}`);

        const result = await smsService.sendSms(
            phone,
            body,
            enrollment.automation?.accountId
        );

        if (!result.success) {
            Logger.error('SMS send failed', { error: result.error, phone });
        }
    }
}
