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
import { cartRecoveryService } from '../CartRecoveryService';
import { automationConditionService } from '../AutomationConditionService';
import { automationContextService } from '../AutomationContextService';
import { automationCouponService } from '../AutomationCouponService';
import { resolveMergeTags } from '../MergeTagResolver';
import { WooService } from '../woo';
import { FlowNode, NodeExecutionResult } from './types';
import { renderTemplate } from './FlowNavigator';

export class NodeExecutor {
    private emailService = new EmailService();
    private invoiceService = new InvoiceService();

    /**
     * Execute the logic for a single flow node.
     */
    async execute(node: FlowNode, enrollment: any): Promise<NodeExecutionResult> {
        const type = node.type.toUpperCase();
        const config = node.data?.config || node.data || {};

        if (type === 'TRIGGER') {
            return { action: 'NEXT' };
        }

        if (type === 'DELAY') {
            return { action: 'NEXT' };
        }

        if (type === 'ACTION') {
            const actionResult = await this.executeAction(config, enrollment);
            return actionResult || { action: 'NEXT' };
        }

        if (type === 'CONDITION') {
            const evaluationContext = await automationContextService.buildContext({
                accountId: enrollment.automation.accountId,
                wooCustomerId: enrollment.wooCustomerId,
                email: enrollment.email,
                contextData: enrollment.contextData,
                requiredFields: this.getRequiredConditionFields(config)
            });
            const outcome = automationConditionService.evaluate(config, evaluationContext);
            return { action: 'NEXT', outcome: outcome ? 'true' : 'false' };
        }

        return { action: 'NEXT' };
    }

    /**
     * Execute action nodes (email, invoice, inbox actions, etc.)
     */
    private async executeAction(config: any, enrollment: any): Promise<NodeExecutionResult | void> {
        const actionType = config?.actionType || 'SEND_EMAIL';

        if (actionType === 'SEND_EMAIL') {
            return this.executeSendEmail(config, enrollment);
        }

        if (actionType === 'GENERATE_INVOICE') {
            await this.executeGenerateInvoice(config, enrollment);
        }

        // Inbox Actions
        if (actionType === 'ASSIGN_CONVERSATION') {
            await this.executeAssignConversation(config, enrollment);
        }

        if (actionType === 'ADD_TAG') {
            await this.executeAddTag(config, enrollment);
        }

        if (actionType === 'CLOSE_CONVERSATION') {
            await this.executeCloseConversation(enrollment);
        }

        if (actionType === 'ADD_NOTE') {
            await this.executeAddNote(config, enrollment);
        }

        if (actionType === 'SEND_CANNED_RESPONSE') {
            await this.executeSendCannedResponse(config, enrollment);
        }

        if (actionType === 'SEND_SMS') {
            await this.executeSendSms(config, enrollment);
        }

        if (actionType === 'GENERATE_COUPON') {
            await this.executeGenerateCoupon(config, enrollment);
        }

        if (actionType === 'ADD_ORDER_NOTE') {
            await this.executeAddOrderNote(config, enrollment);
        }

        if (actionType === 'UPDATE_ORDER_STATUS') {
            await this.executeUpdateOrderStatus(config, enrollment);
        }
    }

    private async executeAssignConversation(config: any, enrollment: any): Promise<void> {
        const conversationId = enrollment.contextData?.conversationId;
        if (!conversationId || !config.userId) return;

        const scopedConversationId = await this.getScopedConversationId(enrollment, conversationId);
        if (!scopedConversationId) return;

        Logger.info(`Assigning conversation ${scopedConversationId} to ${config.userId}`);
        await prisma.conversation.updateMany({
            where: {
                id: scopedConversationId,
                accountId: enrollment.automation.accountId
            },
            data: { assignedTo: config.userId }
        });
    }

    private async executeAddTag(config: any, enrollment: any): Promise<void> {
        const conversationId = enrollment.contextData?.conversationId;
        if (!conversationId || !config.labelId) return;

        const scopedConversationId = await this.getScopedConversationId(enrollment, conversationId);
        if (!scopedConversationId) return;

        const label = await prisma.conversationLabel.findFirst({
            where: { id: config.labelId, accountId: enrollment.automation.accountId },
            select: { id: true }
        });
        if (!label) {
            Logger.warn('Cannot add tag: label not found in account scope', {
                labelId: config.labelId,
                accountId: enrollment.automation.accountId
            });
            return;
        }

        Logger.info(`Adding tag ${config.labelId} to ${scopedConversationId}`);
        await prisma.conversationLabelAssignment.upsert({
            where: { conversationId_labelId: { conversationId: scopedConversationId, labelId: config.labelId } },
            create: { conversationId: scopedConversationId, labelId: config.labelId },
            update: {}
        });
    }

    private async executeCloseConversation(enrollment: any): Promise<void> {
        const conversationId = enrollment.contextData?.conversationId;
        if (!conversationId) return;

        const scopedConversationId = await this.getScopedConversationId(enrollment, conversationId);
        if (!scopedConversationId) return;

        Logger.info(`Closing conversation ${scopedConversationId}`);
        await prisma.conversation.updateMany({
            where: {
                id: scopedConversationId,
                accountId: enrollment.automation.accountId
            },
            data: { status: 'CLOSED' }
        });
    }

    private async executeAddNote(config: any, enrollment: any): Promise<void> {
        const conversationId = enrollment.contextData?.conversationId;
        if (!conversationId || !config.content) return;

        const scopedConversationId = await this.getScopedConversationId(enrollment, conversationId);
        if (!scopedConversationId) return;

        Logger.info(`Adding note to ${scopedConversationId}`);
        await prisma.conversationNote.create({
            data: {
                conversationId: scopedConversationId,
                content: renderTemplate(config.content, enrollment.contextData),
                createdById: config.createdById || enrollment.contextData?.assignedTo || 'system'
            }
        });
    }

    private async executeSendCannedResponse(config: any, enrollment: any): Promise<void> {
        const conversationId = enrollment.contextData?.conversationId;
        if (!conversationId || !config.cannedResponseId) return;

        const scopedConversationId = await this.getScopedConversationId(enrollment, conversationId);
        if (!scopedConversationId) return;

        const canned = await prisma.cannedResponse.findFirst({
            where: { id: config.cannedResponseId, accountId: enrollment.automation.accountId }
        });
        if (!canned) return;

        Logger.info(`Sending canned response to ${scopedConversationId}`);
        const content = renderTemplate(canned.content, enrollment.contextData);
        await prisma.message.create({
            data: {
                conversationId: scopedConversationId,
                content,
                senderType: 'AGENT',
                contentType: 'TEXT'
            }
        });
    }

    /**
     * Send Email Action
     */
    private async executeSendEmail(config: any, enrollment: any): Promise<NodeExecutionResult> {
        const recoveryUrl = cartRecoveryService.createRecoveryUrl({
            accountId: enrollment.automation.accountId,
            enrollmentId: enrollment.id,
            sessionId: enrollment.contextData?.sessionId,
            email: enrollment.email,
            checkoutUrl: enrollment.contextData?.cart?.checkoutUrl || enrollment.contextData?.checkoutUrl || null
        });

        const context = {
            customer: {
                email: enrollment.email,
                id: enrollment.wooCustomerId
            },
            coupon: enrollment.contextData?.coupon,
            cart: enrollment.contextData?.cart
                ? {
                    ...enrollment.contextData.cart,
                    recoveryUrl,
                    checkoutUrl: enrollment.contextData?.cart?.checkoutUrl || enrollment.contextData?.checkoutUrl || ''
                }
                : undefined,
            ...enrollment.contextData
        };

        const recipientTemplate = config.to || enrollment.email;
        const recipientEmail = renderTemplate(String(recipientTemplate || ''), context).trim() || enrollment.email;
        Logger.info(`Sending Email: ${config.templateId || 'inline'} to ${recipientEmail}`);

        try {
            let emailAccountId = config.emailAccountId;
            if (!emailAccountId) {
                const { getDefaultEmailAccount } = await import('../../utils/getDefaultEmailAccount');
                const defaultAccount = await getDefaultEmailAccount(enrollment.automation.accountId);
                emailAccountId = defaultAccount?.id;
            }

            if (emailAccountId) {
                const subject = resolveMergeTags(
                    renderTemplate(config.subject || 'Automated Email', context),
                    context
                );
                const bodyTemplate = config.htmlContent || config.body || config.html || '';
                const body = resolveMergeTags(
                    renderTemplate(bodyTemplate, context),
                    context
                );

                const sendResult = await this.emailService.sendEmail(
                    enrollment.automation.accountId,
                    emailAccountId,
                    recipientEmail,
                    subject,
                    body || `<p>Email Template: ${config.templateId}</p>`,
                    enrollment.contextData?.attachments,
                    {
                        source: 'AUTOMATION',
                        sourceId: enrollment.automationId,
                        category: config.emailCategory === 'TRANSACTIONAL' ? 'TRANSACTIONAL' : 'MARKETING'
                    }
                );

                if (sendResult && typeof sendResult === 'object' && 'skipped' in sendResult && sendResult.skipped) {
                    const reason = 'reason' in sendResult ? sendResult.reason : undefined;
                    Logger.info('Automation email skipped', {
                        accountId: enrollment.automation.accountId,
                        automationId: enrollment.automationId,
                        recipient: recipientEmail,
                        reason
                    });
                    return {
                        action: 'NEXT',
                        outcome: 'EMAIL_SKIPPED',
                        metadata: {
                            recipientEmail,
                            reason: reason || 'unknown'
                        }
                    };
                }

                // Track send event for ROI
                await campaignTrackingService.trackSend(
                    enrollment.automation.accountId,
                    enrollment.automationId,
                    'automation',
                    recipientEmail
                );
                return {
                    action: 'NEXT',
                    outcome: 'EMAIL_SENT',
                    metadata: {
                        recipientEmail,
                        emailAccountId
                    }
                };
            } else {
                Logger.warn('Cannot send email: No Email Account found', {
                    accountId: enrollment.automation.accountId
                });
                return {
                    action: 'NEXT',
                    outcome: 'EMAIL_NOT_CONFIGURED',
                    metadata: {
                        recipientEmail
                    }
                };
            }
        } catch (err) {
            Logger.error('Failed to send email', { error: err });
            return {
                action: 'NEXT',
                outcome: 'EMAIL_FAILED',
                metadata: {
                    recipientEmail,
                    error: err instanceof Error ? err.message : String(err)
                }
            };
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

        const body = renderTemplate(config.smsMessage || config.body || config.message || '', enrollment.contextData);

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

    private async executeGenerateCoupon(config: any, enrollment: any): Promise<void> {
        try {
            const coupon = await automationCouponService.generateCoupon({
                accountId: enrollment.automation.accountId,
                automationId: enrollment.automationId,
                enrollmentId: enrollment.id,
                email: enrollment.email,
                config: {
                    codePrefix: config.codePrefix,
                    amount: config.amount,
                    discountType: config.discountType,
                    expiryDays: config.expiryDays,
                    description: config.description,
                    individualUse: config.individualUse
                }
            });

            const nextContext = {
                ...(enrollment.contextData || {}),
                coupon
            };

            await prisma.automationEnrollment.update({
                where: { id: enrollment.id },
                data: { contextData: nextContext }
            });

            enrollment.contextData = nextContext;
        } catch (error) {
            Logger.error('Failed to generate coupon', {
                accountId: enrollment.automation?.accountId,
                automationId: enrollment.automationId,
                enrollmentId: enrollment.id,
                error
            });
        }
    }

    private async executeAddOrderNote(config: any, enrollment: any): Promise<void> {
        const orderId = this.getOrderIdFromEnrollment(enrollment);
        if (!orderId || !config.noteContent) {
            Logger.warn('Cannot add order note: Missing order id or note content', {
                automationId: enrollment.automationId,
                enrollmentId: enrollment.id
            });
            return;
        }

        const woo = await WooService.forAccount(enrollment.automation.accountId);
        const payload = {
            note: renderTemplate(String(config.noteContent), enrollment.contextData || {}),
            customer_note: Boolean(config.customerVisible)
        };

        try {
            await woo.createOrderNote(orderId, payload);
        } catch (error) {
            Logger.error('Failed to add order note', {
                accountId: enrollment.automation.accountId,
                orderId,
                error
            });
        }
    }

    private async executeUpdateOrderStatus(config: any, enrollment: any): Promise<void> {
        const orderId = this.getOrderIdFromEnrollment(enrollment);
        if (!orderId || !config.orderStatus) {
            Logger.warn('Cannot update order status: Missing order id or target status', {
                automationId: enrollment.automationId,
                enrollmentId: enrollment.id
            });
            return;
        }

        const woo = await WooService.forAccount(enrollment.automation.accountId);

        try {
            await woo.updateOrder(orderId, { status: config.orderStatus });
        } catch (error) {
            Logger.error('Failed to update order status', {
                accountId: enrollment.automation.accountId,
                orderId,
                targetStatus: config.orderStatus,
                error
            });
        }
    }

    private getRequiredConditionFields(config: any): string[] {
        if (Array.isArray(config?.conditions) && config.conditions.length > 0) {
            return config.conditions
                .map((condition: any) => condition?.field)
                .filter((field: unknown): field is string => typeof field === 'string' && field.length > 0);
        }

        if (typeof config?.field === 'string' && config.field.length > 0) {
            return [config.field];
        }

        return [];
    }

    private getOrderIdFromEnrollment(enrollment: any): number | null {
        const candidate = enrollment.contextData?.id
            || enrollment.contextData?.orderId
            || enrollment.contextData?.wooId
            || enrollment.contextData?.order?.id;
        const parsed = Number(candidate);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }

    private async getScopedConversationId(enrollment: any, conversationId?: string): Promise<string | null> {
        if (!conversationId) return null;

        const conversation = await prisma.conversation.findFirst({
            where: {
                id: conversationId,
                accountId: enrollment.automation.accountId
            },
            select: { id: true }
        });

        if (!conversation) {
            Logger.warn('Skipping automation conversation action: conversation outside account scope', {
                conversationId,
                accountId: enrollment.automation.accountId,
                automationId: enrollment.automationId
            });
            return null;
        }

        return conversation.id;
    }
}
