/**
 * Node Executor
 * 
 * Executes individual automation flow nodes (actions, conditions, etc.)
 */

import { Logger } from '../../utils/logger';
import { prisma } from '../../utils/prisma';
import { EmailService } from '../EmailService';
import { InvoiceService } from '../InvoiceService';
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
     * Execute action nodes (email, invoice, etc.)
     */
    private async executeAction(node: FlowNode, enrollment: any): Promise<void> {
        const actionType = node.data?.actionType || 'SEND_EMAIL';

        if (actionType === 'SEND_EMAIL') {
            await this.executeSendEmail(node.data, enrollment);
        }

        if (actionType === 'GENERATE_INVOICE') {
            await this.executeGenerateInvoice(node.data, enrollment);
        }
    }

    /**
     * Send Email Action
     */
    private async executeSendEmail(config: any, enrollment: any): Promise<void> {
        Logger.info(`Sending Email: ${config.templateId} to ${enrollment.email}`);

        try {
            let emailAccountId = config.emailAccountId;
            if (!emailAccountId) {
                const defaultAccount = await prisma.emailAccount.findFirst({
                    where: { accountId: enrollment.automation.accountId }
                });
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

            const pdfUrl = await this.invoiceService.generateInvoicePdf(
                enrollment.automation.accountId,
                String(orderId),
                config.templateId
            );

            // Update context with invoice attachment
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

        } catch (err) {
            Logger.error('Failed to generate invoice', { error: err });
        }
    }
}
