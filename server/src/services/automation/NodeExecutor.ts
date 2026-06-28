/**
 * Node Executor
 * 
 * Executes individual automation flow nodes (actions, conditions, etc.)
 */

import { Logger } from '../../utils/logger';
import { prisma } from '../../utils/prisma';
import { EmailService } from '../EmailService';
import { canonicalInvoiceAttachmentService } from '../CanonicalInvoiceAttachmentService';
import { smsService } from '../SmsService';
import { campaignTrackingService } from '../CampaignTrackingService';
import { cartRecoveryService } from '../CartRecoveryService';
import { automationConditionService } from '../AutomationConditionService';
import { automationContextService } from '../AutomationContextService';
import { automationCouponService } from '../AutomationCouponService';
import { applyPreviewText, resolveMergeTags } from '../MergeTagResolver';
import { WooService } from '../woo';
import { FlowNode, NodeExecutionResult } from './types';
import { renderTemplate } from './FlowNavigator';
import crypto from 'crypto';

export class NodeExecutor {
    private static readonly REVIEW_REQUEST_TTL_MS = 90 * 24 * 60 * 60 * 1000;

    private emailService = new EmailService();

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

        if (actionType === 'UNSUBSCRIBE') {
            return this.executeUnsubscribe(enrollment);
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
        const labelName = typeof config.tagName === 'string' ? config.tagName.trim() : '';
        if (!conversationId || (!config.labelId && !labelName)) return;

        const scopedConversationId = await this.getScopedConversationId(enrollment, conversationId);
        if (!scopedConversationId) return;

        const label = config.labelId ? await prisma.conversationLabel.findFirst({
            where: { id: config.labelId, accountId: enrollment.automation.accountId },
            select: { id: true }
        }) : await prisma.conversationLabel.upsert({
            where: { accountId_name: { accountId: enrollment.automation.accountId, name: labelName } },
            create: { accountId: enrollment.automation.accountId, name: labelName },
            update: {},
            select: { id: true }
        });
        if (!label) {
            Logger.warn('Cannot add tag: label not found in account scope', {
                labelId: config.labelId,
                tagName: labelName || undefined,
                accountId: enrollment.automation.accountId
            });
            return;
        }

        Logger.info(`Adding tag ${label.id} to ${scopedConversationId}`);
        await prisma.conversationLabelAssignment.upsert({
            where: { conversationId_labelId: { conversationId: scopedConversationId, labelId: label.id } },
            create: { conversationId: scopedConversationId, labelId: label.id },
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
        const account = await prisma.account.findFirst({
            where: { id: enrollment.automation.accountId },
            select: { wooUrl: true, domain: true }
        });
        const storeUrl = account?.wooUrl || account?.domain || '';
        const normalizedStoreUrl = storeUrl && !/^https?:\/\//i.test(storeUrl) ? `https://${storeUrl}` : storeUrl;

        const baseContextData = enrollment.contextData || {};
        const rawCheckoutUrl = baseContextData?.cart?.checkoutUrl || baseContextData?.checkoutUrl || null;
        let checkoutUrl = rawCheckoutUrl;
        if (typeof rawCheckoutUrl === 'string' && rawCheckoutUrl && !/^https?:\/\//i.test(rawCheckoutUrl) && normalizedStoreUrl) {
            try {
                checkoutUrl = new URL(rawCheckoutUrl, normalizedStoreUrl).toString();
            } catch {
                checkoutUrl = null;
            }
        }
        const recoveryUrl = cartRecoveryService.createRecoveryUrl({
            accountId: enrollment.automation.accountId,
            enrollmentId: enrollment.id,
            sessionId: baseContextData?.sessionId,
            email: enrollment.email,
            checkoutUrl
        });

        const contextData = await automationContextService.buildContext({
            accountId: enrollment.automation.accountId,
            wooCustomerId: enrollment.wooCustomerId,
            email: enrollment.email,
            contextData: baseContextData,
        });
        const orderContext = contextData.order || contextData.rawOrder || contextData.rawData || (
            contextData.line_items || contextData.lineItems || contextData.items || contextData.wooId || contextData.orderId
                ? contextData
                : undefined
        );
        const customerContext = await this.buildCustomerMergeContext(enrollment, contextData, orderContext);

        const context = {
            ...contextData,
            customer: customerContext,
            order: orderContext,
            coupon: contextData.coupon,
            cart: contextData.cart
                ? {
                    ...contextData.cart,
                    recoveryUrl,
                    checkoutUrl: contextData.cart?.checkoutUrl || contextData.checkoutUrl || ''
                }
                : undefined,
            store: { url: normalizedStoreUrl },
            storeUrl: normalizedStoreUrl,
            store_url: normalizedStoreUrl
        };

        const recipientTemplate = config.to || enrollment.email;
        const resolvedRecipients = resolveMergeTags(
            renderTemplate(String(recipientTemplate || ''), context),
            context
        );

        const recipientCandidates = String(resolvedRecipients || '')
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean);

        const isEmailLike = (value: string) => /^\S+@\S+\.\S+$/.test(value);
        const recipientList = recipientCandidates.filter((email) => isEmailLike(email));

        if (recipientList.length === 0 && typeof enrollment.email === 'string' && isEmailLike(enrollment.email)) {
            recipientList.push(enrollment.email);
        }

        if (recipientList.length === 0) {
            Logger.warn('Cannot send email: No valid recipient resolved', {
                accountId: enrollment.automation.accountId,
                automationId: enrollment.automationId,
                configuredRecipient: config.to,
                enrollmentEmail: enrollment.email
            });
            return {
                action: 'NEXT',
                outcome: 'EMAIL_FAILED',
                metadata: {
                    error: 'No valid email recipient resolved'
                }
            };
        }

        Logger.info(`Sending Email: ${config.templateId || 'inline'} to ${recipientList.join(', ')}`);

        try {
            let emailAccountId = config.emailAccountId;
            if (!emailAccountId) {
                const { getDefaultEmailAccount } = await import('../../utils/getDefaultEmailAccount');
                const defaultAccount = await getDefaultEmailAccount(enrollment.automation.accountId);
                emailAccountId = defaultAccount?.id;
            }

            if (emailAccountId) {
                const subject = resolveMergeTags(
                    renderTemplate(config.subject || 'Automated Email', context, { preserveUnknown: true }),
                    context
                );
                const bodyTemplate = config.htmlContent || config.body || config.html || '';
                const body = resolveMergeTags(
                    renderTemplate(bodyTemplate, context, { preserveUnknown: true }),
                    context
                );
                const previewText = resolveMergeTags(
                    renderTemplate(config.previewText || '', context, { preserveUnknown: true }),
                    context
                );
                const finalBodyBase = body
                    ? applyPreviewText(body, previewText)
                    : `<p>Email Template: ${config.templateId}</p>`;
                const reviewRequestMarker = this.buildReviewReplyMarker(finalBodyBase, context, enrollment.email);
                const finalBody = reviewRequestMarker.html;

                let skippedCount = 0;
                let sentCount = 0;
                const skippedReasons = new Set<string>();

                const configuredEmailCategory = String(config.emailCategory || (config.isTransactional ? 'TRANSACTIONAL' : 'MARKETING')).toUpperCase();
                const emailCategory = configuredEmailCategory === 'TRANSACTIONAL'
                    ? 'TRANSACTIONAL'
                    : 'MARKETING';

                for (const recipientEmail of recipientList) {
                    const sendResult = await this.emailService.sendEmail(
                        enrollment.automation.accountId,
                        emailAccountId,
                        recipientEmail,
                        subject,
                        finalBody,
                        enrollment.contextData?.attachments,
                        {
                            source: 'AUTOMATION',
                            sourceId: enrollment.automationId,
                            category: emailCategory,
                            fromName: config.overrideFrom ? config.fromName : undefined,
                            fromEmail: config.overrideFrom ? config.fromEmail : undefined,
                            replyToEmail: config.overrideFrom ? config.replyToEmail : undefined
                        }
                    );

                    if (sendResult && typeof sendResult === 'object' && 'skipped' in sendResult && sendResult.skipped) {
                        skippedCount += 1;
                        const reason = 'reason' in sendResult ? sendResult.reason : undefined;
                        if (reason) skippedReasons.add(String(reason));
                        continue;
                    }

                    sentCount += 1;
                    if (reviewRequestMarker.request) {
                        await this.recordReviewRequest(
                            enrollment.automation.accountId,
                            recipientEmail,
                            reviewRequestMarker.request,
                            sendResult
                        );
                    }
                    await campaignTrackingService.trackSend(
                        enrollment.automation.accountId,
                        enrollment.automationId,
                        'automation',
                        recipientEmail
                    );
                }

                if (sentCount === 0 && skippedCount > 0) {
                    return {
                        action: 'NEXT',
                        outcome: 'EMAIL_SKIPPED',
                        metadata: {
                            recipientEmail: recipientList.join(', '),
                            reason: Array.from(skippedReasons).join(', ') || 'unknown'
                        }
                    };
                }

                return {
                    action: 'NEXT',
                    outcome: sentCount > 0 ? 'EMAIL_SENT' : 'EMAIL_SKIPPED',
                    metadata: {
                        recipientEmail: recipientList.join(', '),
                        emailAccountId,
                        sentCount,
                        skippedCount
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
                        recipientEmail: recipientList.join(', ')
                    }
                };
            }
        } catch (err) {
            Logger.error('Failed to send email', { error: err });
            return {
                action: 'NEXT',
                outcome: 'EMAIL_FAILED',
                metadata: {
                    recipientEmail: recipientList.join(', '),
                    error: err instanceof Error ? err.message : String(err)
                }
            };
        }
    }

    private async buildCustomerMergeContext(enrollment: any, contextData: any, orderContext: any): Promise<Record<string, any>> {
        const payloadCustomer = isPlainObject(contextData?.customer) ? contextData.customer : {};
        const billing = firstPlainObject(
            contextData?.billing,
            orderContext?.billing,
            payloadCustomer.billing
        );
        const shipping = firstPlainObject(
            contextData?.shipping,
            orderContext?.shipping,
            payloadCustomer.shipping
        );

        const wooCustomer = await this.findWooCustomerForEnrollment(enrollment);
        const rawCustomer = isPlainObject(wooCustomer?.rawData) ? wooCustomer.rawData : {};

        const firstName = firstString(
            payloadCustomer.firstName,
            payloadCustomer.first_name,
            contextData?.firstName,
            contextData?.first_name,
            billing.first_name,
            shipping.first_name,
            wooCustomer?.firstName,
            rawCustomer.first_name,
            rawCustomer.firstName
        );
        const lastName = firstString(
            payloadCustomer.lastName,
            payloadCustomer.last_name,
            contextData?.lastName,
            contextData?.last_name,
            billing.last_name,
            shipping.last_name,
            wooCustomer?.lastName,
            rawCustomer.last_name,
            rawCustomer.lastName
        );
        const email = firstString(
            payloadCustomer.email,
            contextData?.email,
            billing.email,
            wooCustomer?.email,
            rawCustomer.email,
            enrollment.email
        );

        return {
            ...payloadCustomer,
            id: firstString(payloadCustomer.id, wooCustomer?.id, enrollment.wooCustomerId),
            wooId: payloadCustomer.wooId ?? payloadCustomer.woo_id ?? wooCustomer?.wooId ?? enrollment.wooCustomerId,
            firstName,
            first_name: firstString(payloadCustomer.first_name, firstName),
            lastName,
            last_name: firstString(payloadCustomer.last_name, lastName),
            email,
            phone: firstString(payloadCustomer.phone, billing.phone, shipping.phone, rawCustomer.phone)
        };
    }

    private buildReviewReplyMarker(html: string, context: any, email: string): { html: string; request?: { token: string; productId: number; orderId?: string | number | null } } {
        if (!html.includes('overseek_review_request=1')) return { html };

        const order = context.order || {};
        const items = order.lineItems || order.line_items || order.items || [];
        const firstItem = Array.isArray(items) ? items[0] : null;
        const productId = context.product?.id
            || context.product?.productId
            || context.product?.product_id
            || context.review?.productId
            || context.review?.product_id
            || firstItem?.product_id
            || firstItem?.productId
            || firstItem?.id;

        if (!productId) return { html };

        const token = crypto.randomUUID();

        const marker = Buffer.from(JSON.stringify({
            type: 'overseek_review_request',
            token,
            productId: Number(productId),
            orderId: order.id || order.orderId || order.order_id || order.wooId || order.woo_id || null,
            email,
            createdAt: new Date().toISOString()
        })).toString('base64url');

        return {
            html: `${html}\n<!-- overseek-review-request:${marker} -->`,
            request: {
                token,
                productId: Number(productId),
                orderId: order.id || order.orderId || order.order_id || order.wooId || order.woo_id || null
            }
        };
    }

    private async recordReviewRequest(accountId: string, recipientEmail: string, request: { token: string; productId: number; orderId?: string | number | null }, sendResult: any) {
        const messageId = sendResult?.messageId || sendResult?.message_id || null;
        const expiresAt = new Date(Date.now() + NodeExecutor.REVIEW_REQUEST_TTL_MS);
        const emailLog = messageId
            ? await prisma.emailLog.findFirst({
                where: { accountId, messageId },
                select: { id: true }
            })
            : null;

        await prisma.reviewRequest.upsert({
            where: { token: request.token },
            create: {
                accountId,
                token: request.token,
                email: recipientEmail,
                productId: request.productId,
                orderId: request.orderId ? String(request.orderId) : null,
                emailLogId: emailLog?.id || null,
                emailMessageId: messageId,
                expiresAt,
                metadata: { source: 'automation' }
            },
            update: {
                emailLogId: emailLog?.id || undefined,
                emailMessageId: messageId || undefined,
                expiresAt,
                status: 'sent'
            }
        });
    }

    private async findWooCustomerForEnrollment(enrollment: any): Promise<{ id: string; wooId: number; email: string; firstName: string | null; lastName: string | null; rawData: any } | null> {
        const accountId = enrollment?.automation?.accountId;
        if (!accountId) return null;

        const filters: any[] = [];
        const wooCustomerId = Number(enrollment.wooCustomerId);
        if (Number.isFinite(wooCustomerId)) {
            filters.push({ wooId: wooCustomerId });
        }
        if (typeof enrollment.email === 'string' && enrollment.email.trim()) {
            filters.push({ email: { equals: enrollment.email.trim(), mode: 'insensitive' } });
        }
        if (filters.length === 0) return null;

        return prisma.wooCustomer.findFirst({
            where: {
                accountId,
                OR: filters
            },
            select: {
                id: true,
                wooId: true,
                email: true,
                firstName: true,
                lastName: true,
                rawData: true
            }
        });
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

            let relativeUrl = '';
            let absolutePath = '';
            const resolved = await canonicalInvoiceAttachmentService.resolveAbsolutePath(
                enrollment.automation.accountId,
                String(orderId)
            );
            absolutePath = resolved.absolutePath || '';

            if (!absolutePath) {
                Logger.warn('Cannot generate invoice: canonical invoice artifact not ready', {
                    accountId: enrollment.automation.accountId,
                    orderId: String(orderId),
                });
                return;
            }

            const filename = absolutePath.split('/').pop() || 'Invoice.pdf';
            relativeUrl = `/uploads/invoices/${filename}`;

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

    private async executeUnsubscribe(enrollment: any): Promise<NodeExecutionResult> {
        const email = typeof enrollment.email === 'string' ? enrollment.email.trim().toLowerCase() : '';

        if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
            Logger.warn('Cannot unsubscribe customer: No valid email in enrollment', {
                accountId: enrollment.automation?.accountId,
                automationId: enrollment.automationId,
                enrollmentId: enrollment.id
            });
            return {
                action: 'NEXT',
                outcome: 'UNSUBSCRIBE_FAILED',
                metadata: { error: 'No valid email in enrollment' }
            };
        }

        const accountId = enrollment.automation.accountId;

        await prisma.$transaction([
            prisma.emailUnsubscribe.upsert({
                where: { accountId_email: { accountId, email } },
                create: {
                    accountId,
                    email,
                    scope: 'ALL',
                    reason: 'Automation unsubscribe action'
                },
                update: {
                    scope: 'ALL',
                    reason: 'Automation unsubscribe action'
                }
            }),
            prisma.emailListMember.updateMany({
                where: {
                    accountId,
                    email: { equals: email, mode: 'insensitive' },
                    isSubscribed: true
                },
                data: {
                    isSubscribed: false,
                    unsubscribedAt: new Date(),
                    source: 'AUTOMATION'
                }
            })
        ]);

        Logger.info('Customer unsubscribed by automation action', {
            accountId,
            automationId: enrollment.automationId,
            enrollmentId: enrollment.id,
            email
        });

        return {
            action: 'NEXT',
            outcome: 'UNSUBSCRIBED',
            metadata: { email, scope: 'ALL' }
        };
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

function isPlainObject(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstPlainObject(...values: unknown[]): Record<string, any> {
    return values.find(isPlainObject) || {};
}

function firstString(...values: unknown[]): string {
    for (const value of values) {
        if (typeof value !== 'string' && typeof value !== 'number') continue;
        const stringValue = String(value).trim();
        if (stringValue) return stringValue;
    }

    return '';
}
